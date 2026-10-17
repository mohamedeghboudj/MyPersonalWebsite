import { describe, expect, it, vi } from 'vitest';
import { mkdir, mkdtemp, writeFile, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  buildDiagnosticsSchema,
  buildDiagnosticsKey,
  diagnosticCaptureId,
  buildDiagnosticPolicy,
  type CapturedBuild,
} from '@platform/schema';
import { publishCapturePolicy, publishing } from '@platform/config';
import {
  collectBuildDiagnostics,
  storeBuildDiagnostics,
} from '../scripts/private-diagnostics';
import { capturedWorkflow } from '../scripts/captured-workflow';

const now = new Date('2026-10-17T12:00:00.000Z');
const capture: CapturedBuild = {
  schemaVersion: 1,
  id: crypto.randomUUID(),
  purpose: 'preview',
  sequence: 1,
  revision: 0,
  inputSha256: 'a'.repeat(64),
  snapshotSha256: 'b'.repeat(64),
  byteSize: 100,
  createdAt: now.toISOString(),
  expiresAt: new Date(
    now.getTime() + publishCapturePolicy.retentionMs,
  ).toISOString(),
};
const input = {
  capture,
  run: { runId: 123, attempt: 2 },
  outcomes: {
    retrieval: 'success',
    build: 'failure',
    package: 'skipped',
    upload: 'skipped',
  } as const,
};
const report = () =>
  buildDiagnosticsSchema.parse({
    ...input,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    logs: [],
  });
const config = {
  PUBLISH_DIAGNOSTICS_ENABLED: 'true',
  PUBLISH_R2_ACCOUNT_ID: 'a'.repeat(32),
  PUBLISH_R2_BUCKET: 'mohamedeghboudj-media-preview',
  DIAGNOSTICS_R2_ACCESS_KEY_ID: 'synthetic-diagnostic-id',
  DIAGNOSTICS_R2_SECRET_ACCESS_KEY: 'synthetic-diagnostic-secret',
};
async function directory() {
  await mkdir('artifacts/diagnostic-tests', { recursive: true });
  return resolve(await mkdtemp('artifacts/diagnostic-tests/run-'));
}
describe('private diagnostic collection and storage', () => {
  it('collects only bounded tails of the three credential-free stages, as text', async () => {
    const logs = await directory();
    await writeFile(
      resolve(logs, 'cv-compile.log'),
      'x'.repeat(100000) +
        '\nErreur / خطأ / <script>example</script>\u001b[31mEND\u001b[0m',
    );
    await writeFile(
      resolve(logs, 'provider.log'),
      'DO NOT INCLUDE provider credential',
    );
    await writeFile(resolve(logs, 'cv.tex'), 'DO NOT INCLUDE source');
    const value = await collectBuildDiagnostics(input, logs, now);
    expect(value.logs).toHaveLength(1);
    expect(value.logs[0]).toMatchObject({
      stage: 'cv-compile',
      truncated: true,
    });
    expect(value.logs[0]!.text).toContain('خطأ');
    expect(value.logs[0]!.text).toContain('<script>example</script>END');
    expect(value.logs[0]!.text.length).toBeLessThanOrEqual(
      buildDiagnosticPolicy.maxLogBytes,
    );
    expect(JSON.stringify(value)).not.toMatch(/DO NOT INCLUDE|\u001b/);
    expect(Buffer.byteLength(JSON.stringify(value))).toBeLessThan(
      buildDiagnosticPolicy.maxReportBytes,
    );
  });
  it('reports retrieval failures without inventing logs, and refuses linked directories or non-files', async () => {
    const base = await directory();
    expect(
      (await collectBuildDiagnostics(input, resolve(base, 'absent'), now)).logs,
    ).toEqual([]);
    const target = resolve(base, 'target'),
      linked = resolve(base, 'linked');
    await mkdir(target);
    await symlink(
      target,
      linked,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(collectBuildDiagnostics(input, linked, now)).rejects.toThrow(
      'directory',
    );
    await mkdir(resolve(target, 'cv-compile.log'));
    await expect(collectBuildDiagnostics(input, target, now)).rejects.toThrow(
      'file',
    );
  });
  it('rejects malformed, duplicate, oversized or out-of-lifetime reports and noncanonical storage keys', () => {
    const good = report();
    for (const invalid of [
      { ...good, extra: 'raw-input' },
      { ...good, run: { runId: 0, attempt: 1 } },
      { ...good, createdAt: capture.expiresAt },
      {
        ...good,
        logs: [
          { stage: 'cv-compile', text: 'x'.repeat(65537), truncated: true },
        ],
      },
      {
        ...good,
        logs: [{ stage: 'upload', text: 'secret', truncated: false }],
      },
      {
        ...good,
        logs: Array.from({ length: 2 }, () => ({
          stage: 'site-build',
          text: '',
          truncated: false,
        })),
      },
    ])
      expect(buildDiagnosticsSchema.safeParse(invalid).success).toBe(false);
    const key = buildDiagnosticsKey(capture.id, input.run);
    expect(diagnosticCaptureId(key)).toBe(capture.id);
    for (const invalid of [
      key.replace('.123.', '.0123.'),
      key.replace('.2.', '.0.'),
      key.replace('.123.', '.9007199254740992.'),
      key.replace('publish-inputs/', 'originals/'),
      key + '/extra',
      key.replace(capture.id, '../escape'),
    ])
      expect(diagnosticCaptureId(invalid)).toBeNull();
  });
  it('signs conditional creation at the fixed private destination and accepts only exact readback', async () => {
    const value = report(),
      body = JSON.stringify(value);
    for (const status of [200, 204, 412]) {
      const send = vi.fn(async (request: Request) =>
        request.method === 'PUT'
          ? new Response(null, { status })
          : new Response(body),
      );
      await storeBuildDiagnostics(config, value, send, now);
      expect(send.mock.calls.map(([request]) => request.method)).toEqual([
        'PUT',
        'GET',
      ]);
      const request = send.mock.calls[0]![0];
      expect(request.url).toBe(
        `https://${config.PUBLISH_R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${config.PUBLISH_R2_BUCKET}/${buildDiagnosticsKey(capture.id, input.run)}`,
      );
      expect(request.redirect).toBe('manual');
      expect(request.headers.get('If-None-Match')).toBe('*');
      expect(request.headers.get('Authorization')).toContain(
        'AWS4-HMAC-SHA256',
      );
      expect(await request.text()).toBe(body);
    }
    await expect(
      storeBuildDiagnostics(
        config,
        value,
        async (request) =>
          request.method === 'PUT'
            ? new Response(null, { status: 412 })
            : new Response('different'),
        now,
      ),
    ).rejects.toThrow('verification failed');
  });
  it('does not retry an ambiguous write or follow a redirect, and validates setup/expiry before storage', async () => {
    for (const status of [302, 403, 500]) {
      const send = vi.fn(
        async () => new Response('PRIVATE provider response', { status }),
      );
      await expect(
        storeBuildDiagnostics(config, report(), send, now),
      ).rejects.toThrow('upload unavailable');
      expect(send).toHaveBeenCalledTimes(1);
    }
    const lost = vi.fn(async () => {
      throw new Error('lost response');
    });
    await expect(
      storeBuildDiagnostics(config, report(), lost, now),
    ).rejects.toThrow('lost response');
    expect(lost).toHaveBeenCalledTimes(1);
    const send = vi.fn(async () => new Response());
    for (const bad of [
      { ...config, PUBLISH_DIAGNOSTICS_ENABLED: 'false' },
      { ...config, PUBLISH_R2_BUCKET: 'production' },
    ])
      await expect(
        storeBuildDiagnostics(bad, report(), send, now),
      ).rejects.toThrow();
    await expect(
      storeBuildDiagnostics(
        config,
        report(),
        send,
        new Date(capture.expiresAt),
      ),
    ).rejects.toThrow('expired');
    expect(send).not.toHaveBeenCalled();
  });
  it('requires the owner, exact workflow/main context, matching input and a concrete run attempt', async () => {
    const event = resolve(await directory(), 'event.json');
    await writeFile(
      event,
      JSON.stringify({
        inputs: { capture_id: capture.id, capture: JSON.stringify(capture) },
      }),
    );
    const env = {
      GITHUB_EVENT_NAME: 'workflow_dispatch',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_REPOSITORY: publishing.repository,
      GITHUB_ACTOR: publishing.repository.split('/')[0],
      GITHUB_RUN_ID: '123',
      GITHUB_RUN_ATTEMPT: '2',
      GITHUB_EVENT_PATH: event,
      GITHUB_WORKFLOW_REF: `${publishing.repository}/.github/workflows/${publishing.workflow}@refs/heads/main`,
    };
    expect(await capturedWorkflow(env)).toEqual({ capture, run: input.run });
    for (const change of [
      { GITHUB_EVENT_NAME: 'pull_request' },
      { GITHUB_REF: 'refs/heads/other' },
      { GITHUB_ACTOR: 'other' },
      { GITHUB_TRIGGERING_ACTOR: 'other' },
      { GITHUB_WORKFLOW_REF: 'other-workflow' },
      { GITHUB_RUN_ATTEMPT: '0' },
    ])
      await expect(capturedWorkflow({ ...env, ...change })).rejects.toThrow();
    await writeFile(
      event,
      JSON.stringify({
        inputs: {
          capture_id: crypto.randomUUID(),
          capture: JSON.stringify(capture),
        },
      }),
    );
    await expect(capturedWorkflow(env)).rejects.toThrow('mismatch');
  });
});
