import { describe, expect, it } from 'vitest';
import { previewPolicy } from '@platform/config';
import {
  previewDeploymentReader,
  comparePreviewRelease,
} from '../scripts/preview-deployment';

const config = {
  ACCESS_ISSUER: 'https://team.cloudflareaccess.com',
  ACCESS_AUDIENCE: 'synthetic-preview-audience',
  OWNER_EMAIL: 'owner@example.com',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  CLOUDFLARE_API_TOKEN: 'synthetic-private-read-token',
};
const release = {
  schemaVersion: 1 as const,
  id: crypto.randomUUID(),
  sequence: 4,
  revision: 9,
  snapshotSha256: 'a'.repeat(64),
  bundleSha256: 'b'.repeat(64),
};
const versionId = crypto.randomUUID();
const deploymentId = crypto.randomUUID();
const deployments = () => ({
  success: true,
  result: {
    deployments: [
      {
        id: deploymentId,
        versions: [{ version_id: versionId, percentage: 100 }],
      },
    ],
  },
});
const version = (receipt: string = JSON.stringify(release)) => ({
  success: true,
  result: {
    id: versionId,
    resources: {
      bindings: Object.entries({
        APP_ENV: 'preview',
        ACCESS_ISSUER: config.ACCESS_ISSUER,
        ACCESS_AUDIENCE: config.ACCESS_AUDIENCE,
        OWNER_EMAIL: config.OWNER_EMAIL,
        PREVIEW_RELEASE: receipt,
      }).map(([name, text]) => ({ name, text, type: 'plain_text' })),
    },
  },
});
describe('read-only preview deployment checks', () => {
  it('reads the actively deployed version with bounded, nonredirecting GET requests', async () => {
    const requests: Request[] = [];
    const read = previewDeploymentReader(config, async (request) => {
      requests.push(request);
      return Response.json(
        request.url.endsWith('/deployments') ? deployments() : version(),
      );
    });
    expect(await read()).toEqual({ deploymentId, versionId, release });
    expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
      `/client/v4/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${previewPolicy.workerName}/deployments`,
      `/client/v4/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${previewPolicy.workerName}/versions/${versionId}`,
    ]);
    for (const request of requests) {
      expect(request.method).toBe('GET');
      expect(request.redirect).toBe('manual');
      expect(request.headers.get('Authorization')).toBe(
        `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
      );
      expect(request.url).not.toContain(config.CLOUDFLARE_API_TOKEN);
    }
  });
  it('recognizes only an explicit empty bootstrap, never a missing Worker or partial deployment', async () => {
    const bootstrap = previewDeploymentReader(config, async (request) =>
      Response.json(
        request.url.endsWith('/deployments')
          ? deployments()
          : version(previewPolicy.bootstrap),
      ),
    );
    expect((await bootstrap()).release).toBeNull();
    for (const body of [
      { success: true, result: { deployments: [] } },
      {
        success: true,
        result: {
          deployments: [
            {
              id: deploymentId,
              versions: [
                { version_id: versionId, percentage: 50 },
                { version_id: crypto.randomUUID(), percentage: 50 },
              ],
            },
          ],
        },
      },
      { success: false, errors: [{ message: 'PRIVATE-ERROR' }] },
    ])
      await expect(
        previewDeploymentReader(config, async () => Response.json(body))(),
      ).rejects.toThrow('Could not verify');
  });
  it('refuses wrong identities, duplicate bindings, malformed receipts and version mismatches', async () => {
    const wrongOwner = version();
    wrongOwner.result.resources.bindings.find(
      (binding) => binding.name === 'OWNER_EMAIL',
    )!.text = 'other@example.com';
    const duplicates = version();
    duplicates.result.resources.bindings.push({
      ...duplicates.result.resources.bindings[0]!,
    });
    const absent = version();
    absent.result.resources.bindings.pop();
    for (const body of [
      wrongOwner,
      duplicates,
      absent,
      version('{}'),
      {
        ...version(),
        result: { ...version().result, id: crypto.randomUUID() },
      },
    ]) {
      await expect(
        previewDeploymentReader(config, async (request) =>
          Response.json(
            request.url.endsWith('/deployments') ? deployments() : body,
          ),
        )(),
      ).rejects.toThrow('Could not verify');
    }
  });
  it('fails closed without exposing upstream error bodies or following redirects', async () => {
    for (const response of [
      new Response('PRIVATE-ERROR', { status: 403 }),
      new Response(null, {
        status: 302,
        headers: { Location: 'https://untrusted.example' },
      }),
      new Response('PRIVATE-ERROR', {
        headers: { 'Content-Type': 'text/html' },
      }),
      new Response('x'.repeat(previewPolicy.maxApiBytes + 1), {
        headers: { 'Content-Type': 'application/json' },
      }),
    ]) {
      let calls = 0;
      await expect(
        previewDeploymentReader(config, async () => {
          calls++;
          return response;
        })(),
      ).rejects.toThrow('Could not verify the active private preview');
      expect(calls).toBe(1);
    }
  });
  it('rejects older, conflicting and content-regressing captures; identical receipts are already active', () => {
    expect(comparePreviewRelease(release, null)).toBe('newer');
    expect(comparePreviewRelease(release, release)).toBe('already-active');
    expect(comparePreviewRelease({ ...release, sequence: 3 }, release)).toBe(
      'superseded',
    );
    expect(comparePreviewRelease({ ...release, sequence: 5 }, release)).toBe(
      'newer',
    );
    expect(() =>
      comparePreviewRelease({ ...release, id: crypto.randomUUID() }, release),
    ).toThrow('Conflicting');
    expect(() =>
      comparePreviewRelease(
        { ...release, bundleSha256: 'c'.repeat(64) },
        release,
      ),
    ).toThrow('Conflicting');
    expect(() =>
      comparePreviewRelease({ ...release, sequence: 5, revision: 8 }, release),
    ).toThrow('regress');
  });
});
