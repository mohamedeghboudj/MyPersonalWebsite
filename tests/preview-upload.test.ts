import { describe, expect, it, vi, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  previewPolicy,
  publishCapturePolicy,
  publicationTargets,
  publicationPolicy,
} from '@platform/config';
import {
  uploadPrivatePreview,
  uploadPublicSite,
} from '../scripts/private-preview-upload';
import { privateNodeStage } from '../scripts/private-build';

const config = {
  PREVIEW_UPLOAD_ENABLED: 'true',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-token',
  ACCESS_ISSUER: 'https://synthetic.cloudflareaccess.com',
  ACCESS_AUDIENCE: 'synthetic-preview-audience',
  ADMIN_ACCESS_AUDIENCE: 'synthetic-admin-audience',
  OWNER_EMAIL: 'owner@example.com',
};
const hash = (value: string) =>
  createHash('sha256').update(value).digest('hex');
afterEach(() => vi.useRealTimers());
async function fixture(purpose: 'preview' | 'publish' = 'preview') {
  await mkdir('artifacts/preview-upload-tests', { recursive: true });
  const root = await mkdtemp(resolve('artifacts/preview-upload-tests/run-'));
  await mkdir(resolve(root, 'site'));
  // Upload boundary tests use an explicitly simulated sealed package. The full
  // package/TeX tests separately establish route completeness and real CV bytes.
  const page = 'Synthetic, private test page';
  await writeFile(resolve(root, 'site/index.html'), page);
  const files = [
    { path: 'index.html', sha256: hash(page), bytes: page.length },
  ];
  const createdAt = new Date();
  const capture = {
    schemaVersion: 1 as const,
    id: crypto.randomUUID(),
    purpose,
    environment: 'preview' as const,
    sequence: 1,
    revision: 1,
    inputSha256: 'b'.repeat(64),
    snapshotSha256: 'c'.repeat(64),
    byteSize: 100,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(
      createdAt.getTime() + publishCapturePolicy.retentionMs,
    ).toISOString(),
  };
  const release = {
    id: capture.id,
    sequence: capture.sequence,
    revision: capture.revision,
    snapshotSha256: capture.snapshotSha256,
    schemaVersion: 1 as const,
    bundleSha256: hash(JSON.stringify(files)),
  };
  const bundle = { schemaVersion: 1, capture, release, files };
  await writeFile(resolve(root, 'manifest.json'), JSON.stringify(bundle));
  const baseline = crypto.randomUUID(),
    candidate = crypto.randomUUID();
  const requests: Request[] = [];
  const send = async (request: Request) => {
    requests.push(request);
    expect(request.method).toBe('GET');
    expect(request.redirect).toBe('manual');
    if (request.url.endsWith('/deployments'))
      return Response.json({
        success: true,
        result: {
          deployments: [
            {
              id: crypto.randomUUID(),
              versions: [{ version_id: baseline, percentage: 100 }],
            },
          ],
        },
      });
    const id = request.url.split('/').at(-1)!;
    return Response.json({
      success: true,
      result: {
        id,
        annotations:
          purpose === 'publish'
            ? {
                'workers/message':
                  id === baseline
                    ? publicationPolicy.bootstrap
                    : JSON.stringify(release),
              }
            : {},
        resources: {
          ...(purpose === 'publish'
            ? {
                script: { etag: '', handlers: null },
                script_runtime: {
                  assets: { serve_directly: true, raw_run_worker_first: false },
                },
              }
            : {}),
          bindings:
            purpose === 'publish'
              ? []
              : Object.entries({
                  APP_ENV: 'preview',
                  ACCESS_ISSUER: config.ACCESS_ISSUER,
                  ACCESS_AUDIENCE: config.ACCESS_AUDIENCE,
                  OWNER_EMAIL: config.OWNER_EMAIL,
                  PREVIEW_RELEASE:
                    id === baseline
                      ? previewPolicy.bootstrap
                      : JSON.stringify(release),
                }).map(([name, text]) => ({ type: 'plain_text', name, text })),
        },
      },
    });
  };
  const writeReceipt: typeof privateNodeStage = async (_stage, _args, env) => {
    await writeFile(
      env.WRANGLER_OUTPUT_FILE_PATH!,
      [
        {
          type: 'wrangler-session',
          version: 1,
          command_line_args: ['PRIVATE-SYNTHETIC-ARGUMENT'],
          log_file_path: 'PRIVATE-SYNTHETIC-LOG',
        },
        {
          type: 'version-upload',
          version: 1,
          worker_name:
            purpose === 'preview'
              ? previewPolicy.workerName
              : publicationTargets.preview.workerName,
          version_id: candidate,
        },
      ]
        .map((record) => JSON.stringify(record))
        .join('\n') + '\n',
    );
  };
  return { root, bundle, release, candidate, requests, send, writeReceipt };
}
describe('private preview candidate upload', () => {
  it('uploads only a version, isolates secrets and logs, and verifies its provider receipt', async () => {
    const f = await fixture();
    let calls = 0;
    const result = await uploadPrivatePreview(
      f.root,
      {
        ...process.env,
        ...config,
        PUBLISH_GITHUB_TOKEN: 'hidden-github-token',
        PUBLISH_R2_SECRET_ACCESS_KEY: 'hidden-storage-key',
        NODE_OPTIONS: '--expose-gc',
        CLOUDFLARE_API_BASE_URL: 'https://untrusted.example',
        WRANGLER_CI_OVERRIDE_NAME: 'production-worker',
      },
      f.send,
      async (stage, args, env, logs, cwd) => {
        calls++;
        expect(args.slice(1, 3)).toEqual(['versions', 'upload']);
        expect(args).not.toContain('deploy');
        expect(args).not.toContain('--preview-alias');
        expect(args[args.indexOf('--name') + 1]).toBe(previewPolicy.workerName);
        expect(args.at(-1)).toBe(f.bundle.capture.id);
        expect(logs).toBe(resolve(f.root, 'upload'));
        expect(cwd).toBe(logs);
        expect(
          await readFile(args[args.indexOf('--env-file') + 1]!, 'utf8'),
        ).toBe('');
        for (const key of [
          'PUBLISH_GITHUB_TOKEN',
          'PUBLISH_R2_SECRET_ACCESS_KEY',
          'NODE_OPTIONS',
          'CLOUDFLARE_API_BASE_URL',
          'WRANGLER_CI_OVERRIDE_NAME',
        ])
          expect(env).not.toHaveProperty(key);
        expect(env.CLOUDFLARE_API_TOKEN).toBe(config.CLOUDFLARE_API_TOKEN);
        const raw = await readFile(args[args.indexOf('--config') + 1]!, 'utf8');
        expect(raw).not.toMatch(/hidden-|synthetic-cloudflare-token/);
        const worker = JSON.parse(raw);
        expect(worker).toMatchObject({
          name: previewPolicy.workerName,
          workers_dev: false,
          preview_urls: false,
          assets: {
            directory: resolve(f.root, 'site'),
            binding: 'ASSETS',
            run_worker_first: true,
            not_found_handling: '404-page',
          },
        });
        expect(JSON.parse(worker.vars.PREVIEW_RELEASE)).toEqual(f.release);
        expect(worker).not.toHaveProperty('d1_databases');
        expect(worker).not.toHaveProperty('r2_buckets');
        await f.writeReceipt(stage, args, env, logs, cwd);
      },
    );
    expect(result).toEqual({ versionId: f.candidate, release: f.release });
    expect(calls).toBe(1);
    expect(f.requests).toHaveLength(3);
    // A lost result must not silently upload again from the same working folder.
    await expect(
      uploadPrivatePreview(f.root, config, f.send, f.writeReceipt),
    ).rejects.toThrow();
  });
  it('refuses disabled/misconfigured uploads, changed files and expired input before touching Cloudflare', async () => {
    const f = await fixture();
    const run = vi.fn(f.writeReceipt);
    for (const invalid of [
      { ...config, PREVIEW_UPLOAD_ENABLED: 'false' },
      { ...config, ACCESS_AUDIENCE: config.ADMIN_ACCESS_AUDIENCE },
      { ...config, CLOUDFLARE_API_TOKEN: '' },
    ])
      await expect(
        uploadPrivatePreview(f.root, invalid, f.send, run),
      ).rejects.toThrow('Candidate upload failed [configuration/validation].');
    await writeFile(resolve(f.root, 'site/extra.json'), 'private');
    await expect(
      uploadPrivatePreview(f.root, config, f.send, run),
    ).rejects.toThrow('Candidate upload failed [bundle/validation].');
    const expired = await fixture();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(expired.bundle.capture.expiresAt));
    await expect(
      uploadPrivatePreview(expired.root, config, f.send, run),
    ).rejects.toThrow();
    expect(f.requests).toHaveLength(0);
    expect(run).not.toHaveBeenCalled();
  });
  it('requires an existing verifiable target and detects files changed during preflight', async () => {
    const f = await fixture();
    const run = vi.fn(f.writeReceipt);
    for (const [response, code] of [
      [new Response('not found', { status: 404 }), 'http-404'],
      [
        Response.json({ success: true, result: { deployments: [] } }),
        'validation',
      ],
    ] as const)
      await expect(
        uploadPrivatePreview(f.root, config, async () => response, run),
      ).rejects.toThrow(`Candidate upload failed [active-target/${code}].`);
    await expect(
      uploadPrivatePreview(
        f.root,
        config,
        async (request) => {
          await writeFile(resolve(f.root, 'site/index.html'), 'changed');
          return f.send(request);
        },
        run,
      ),
    ).rejects.toThrow(
      'Candidate upload failed [pre-upload-bundle/validation].',
    );
    expect(run).not.toHaveBeenCalled();
  });
  it('does not retry uploads or accept missing, duplicate, redirected or mismatched receipts', async () => {
    for (const mode of [
      'failed',
      'missing',
      'duplicate',
      'missing-session',
      'session-only',
      'duplicate-upload',
      'unknown-record',
      'reversed',
      'wrong-worker',
      'invalid-id',
      'version-url',
      'version-alias-url',
      'mismatched',
    ] as const) {
      const f = await fixture();
      let calls = 0;
      await expect(
        uploadPrivatePreview(
          f.root,
          config,
          f.send,
          async (stage, args, env, logs, cwd) => {
            calls++;
            if (mode === 'failed') throw new Error('private provider error');
            if (mode === 'missing') return;
            await f.writeReceipt(stage, args, env, logs, cwd);
            const file = env.WRANGLER_OUTPUT_FILE_PATH!;
            const raw = await readFile(file, 'utf8');
            let records = raw
              .trim()
              .split('\n')
              .map((line) => JSON.parse(line));
            if (mode === 'duplicate') records.push(...records);
            if (mode === 'missing-session') records.shift();
            if (mode === 'session-only') records.pop();
            if (mode === 'duplicate-upload') records[0] = records[1];
            if (mode === 'unknown-record') records[0].type = 'command-failed';
            if (mode === 'reversed') records = records.reverse();
            if (mode === 'wrong-worker')
              records[1].worker_name = 'other-worker';
            if (mode === 'invalid-id') records[1].version_id = null;
            if (mode === 'version-url')
              records[1].preview_url = 'https://untrusted.example';
            if (mode === 'version-alias-url')
              records[1].preview_alias_url = 'https://untrusted.example';
            await writeFile(
              file,
              records.map((record) => JSON.stringify(record)).join('\n') + '\n',
            );
            if (mode === 'mismatched') f.release.bundleSha256 = '0'.repeat(64);
          },
        ),
      ).rejects.toThrow(
        `Candidate upload failed [${mode === 'failed' ? 'wrangler-upload' : mode === 'mismatched' ? 'candidate' : 'receipt'}/validation].`,
      );
      expect(calls).toBe(1);
      expect(f.requests.every((request) => request.method === 'GET')).toBe(
        true,
      );
    }
  });

  it('identifies inspection failures without retaining private provider data or attempting an upload', async () => {
    for (const mode of [401, 403, 302, 'transport'] as const) {
      const f = await fixture();
      const run = vi.fn(f.writeReceipt);
      const send = vi.fn(async () => {
        if (mode === 'transport')
          throw new Error('PRIVATE-TOKEN and PRIVATE-REQUEST');
        return new Response('PRIVATE-PROVIDER-BODY', {
          status: mode,
          headers: { Location: 'https://private.example/sensitive' },
        });
      });
      const failure = await uploadPrivatePreview(
        f.root,
        config,
        send,
        run,
      ).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(Error);
      expect(failure).toMatchObject({
        message: `Candidate upload failed [active-target/${mode === 'transport' ? mode : `http-${mode}`}].`,
      });
      expect(failure).not.toHaveProperty('cause');
      expect(send).toHaveBeenCalledTimes(1);
      expect(run).not.toHaveBeenCalled();
    }
  });

  it('builds both generated configurations with the pinned Wrangler in an offline dry run', async () => {
    for (const purpose of ['preview', 'publish'] as const) {
      const f = await fixture(purpose);
      const upload =
        purpose === 'preview' ? uploadPrivatePreview : uploadPublicSite;
      const result = await upload(
        f.root,
        {
          ...process.env,
          ...config,
          PUBLISH_UPLOAD_ENABLED: 'true',
          DEPLOYMENT_ENVIRONMENT: 'preview',
        },
        f.send,
        async (stage, args, env, logs, cwd) => {
          await privateNodeStage(stage, [...args, '--dry-run'], env, logs, cwd);
          // Keep the real CLI's JSONL envelope, including its session record.
          // A dry run has no provider UUID; substitute only that synthetic ID.
          const output = env.WRANGLER_OUTPUT_FILE_PATH!;
          const records = (await readFile(output, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
          expect(records.map((record) => record.type)).toEqual([
            'wrangler-session',
            'version-upload',
          ]);
          expect(records[1].version_id).toBeNull();
          records[1].version_id = f.candidate;
          await writeFile(
            output,
            records.map((record) => JSON.stringify(record)).join('\n') + '\n',
          );
        },
      );
      expect(result.versionId).toBe(f.candidate);
      expect(f.requests.every((request) => request.method === 'GET')).toBe(
        true,
      );
    }
  });
});

it('uploads publication assets with no Worker entry point, bindings or routes and an exact version receipt', async () => {
  const f = await fixture('publish');
  const env = {
    ...config,
    PUBLISH_UPLOAD_ENABLED: 'true',
    DEPLOYMENT_ENVIRONMENT: 'preview',
  };
  const run: typeof privateNodeStage = async (
    stage,
    args,
    child,
    logs,
    cwd,
  ) => {
    const worker = JSON.parse(
      await readFile(args[args.indexOf('--config') + 1]!, 'utf8'),
    );
    expect(worker).not.toHaveProperty('main');
    expect(worker).not.toHaveProperty('vars');
    expect(worker.assets).not.toHaveProperty('binding');
    expect(worker.assets).not.toHaveProperty('run_worker_first');
    expect(worker).not.toHaveProperty('routes');
    expect(worker.name).toBe(publicationTargets.preview.workerName);
    expect(args.slice(1, 3)).toEqual(['versions', 'upload']);
    expect(JSON.parse(args[args.indexOf('--message') + 1]!)).toEqual(f.release);
    await f.writeReceipt(stage, args, child, logs, cwd);
  };
  expect((await uploadPublicSite(f.root, env, f.send, run)).release).toEqual(
    f.release,
  );
  expect(
    f.requests.every((q) =>
      q.url.includes('/' + publicationTargets.preview.workerName + '/'),
    ),
  ).toBe(true);
});
it('rejects a public upload whose capture belongs to another environment or purpose', async () => {
  const f = await fixture('publish');
  const run = vi.fn(f.writeReceipt);
  await expect(
    uploadPublicSite(
      f.root,
      {
        ...config,
        PUBLISH_UPLOAD_ENABLED: 'true',
        DEPLOYMENT_ENVIRONMENT: 'production',
      },
      f.send,
      run,
    ),
  ).rejects.toThrow('Candidate upload failed [bundle/validation].');
  await expect(
    uploadPrivatePreview(f.root, config, f.send, run),
  ).rejects.toThrow('Candidate upload failed [bundle/validation].');
  expect(f.requests).toHaveLength(0);
  expect(run).not.toHaveBeenCalled();
});
