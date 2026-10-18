import { describe, expect, it } from 'vitest';
import { previewPolicy } from '@platform/config';
import type { CapturedBuild } from '@platform/schema';
import {
  previewDeploymentReader,
  comparePreviewRelease,
} from '../scripts/preview-deployment';
import {
  activatePreviewVersion,
  previewCloudflareReader,
} from '../apps/admin/src/preview-cloudflare';

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
const versionId: string = crypto.randomUUID();
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
const capture: CapturedBuild = {
  schemaVersion: 1,
  id: release.id,
  purpose: 'preview',
  environment: 'preview',
  sequence: release.sequence,
  revision: release.revision,
  snapshotSha256: release.snapshotSha256,
  inputSha256: 'c'.repeat(64),
  byteSize: 100,
  createdAt: '2026-10-17T10:00:00.000Z',
  expiresAt: '2026-10-18T10:00:00.000Z',
};
describe('bounded preview candidate discovery', () => {
  const item = (id = versionId, created_on = capture.createdAt) => ({
    id,
    metadata: { created_on },
  });
  it('finds exact capture bindings and excludes older versions before detail reads', async () => {
    const requests: Request[] = [];
    const reader = previewCloudflareReader(config, async (request) => {
      requests.push(request);
      return Response.json(
        request.url.includes('?deployable=true')
          ? {
              success: true,
              result: {
                items: [
                  item(),
                  item(crypto.randomUUID(), '2026-10-16T10:00:00Z'),
                ],
              },
            }
          : version(),
      );
    });
    expect(await reader.findCandidate(capture)).toEqual({ versionId, release });
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.method === 'GET')).toBe(true);
  });
  it('refuses duplicate or over-budget candidate sets before detailed reads', async () => {
    for (const items of [
      [item(), item()],
      Array.from({ length: 21 }, () => item(crypto.randomUUID())),
    ]) {
      let calls = 0;
      const reader = previewCloudflareReader(config, async () => {
        calls++;
        return Response.json({ success: true, result: { items } });
      });
      await expect(reader.findCandidate(capture)).rejects.toThrow(
        'one verified',
      );
      expect(calls).toBe(1);
    }
  });
  it('does not guess between multiple matching uploads or accept conflicting capture receipts', async () => {
    for (const duplicate of [false, true]) {
      const ids = duplicate ? [versionId, crypto.randomUUID()] : [versionId];
      const reader = previewCloudflareReader(config, async (request) => {
        if (request.url.includes('?'))
          return Response.json({
            success: true,
            result: { items: ids.map((id) => item(id)) },
          });
        const value = version(
          JSON.stringify({
            ...release,
            revision: duplicate ? release.revision : release.revision + 1,
          }),
        );
        value.result.id = request.url.split('/').at(-1)!;
        return Response.json(value);
      });
      await expect(reader.findCandidate(capture)).rejects.toThrow(
        'one verified',
      );
    }
  });
  it('returns no candidate for an empty set or a different capture, and hides provider failures', async () => {
    for (const items of [[], [item()]]) {
      const reader = previewCloudflareReader(config, async (request) =>
        Response.json(
          request.url.includes('?')
            ? { success: true, result: { items } }
            : version(JSON.stringify({ ...release, id: crypto.randomUUID() })),
        ),
      );
      expect(await reader.findCandidate(capture)).toBeNull();
    }
    await expect(
      previewCloudflareReader(config, async () => {
        throw new Error('PRIVATE');
      }).findCandidate(capture),
    ).rejects.toThrow('Could not identify one verified preview candidate');
  });
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

describe('Cloudflare preview activation transport', () => {
  const createdAt = '2026-10-17T10:00:01.000Z';
  const applied = () => ({
    success: true,
    result: {
      id: deploymentId,
      created_on: createdAt,
      strategy: 'percentage',
      versions: [{ version_id: versionId, percentage: 100 }],
    },
  });
  it('sends one fixed-target 100-percent activation without force, redirects or arbitrary metadata', async () => {
    const requests: Request[] = [];
    const outcome = await activatePreviewVersion(
      config,
      versionId,
      async (request) => {
        requests.push(request);
        return Response.json(applied());
      },
    );
    expect(outcome).toEqual({
      status: 'deployed',
      deploymentId,
      versionId,
      percentage: 100,
      createdAt,
    });
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    expect(request.url).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${previewPolicy.workerName}/deployments`,
    );
    expect(request.method).toBe('POST');
    expect(request.redirect).toBe('manual');
    expect(await request.json()).toEqual({
      strategy: 'percentage',
      versions: [{ version_id: versionId, percentage: 100 }],
    });
    expect(request.headers.get('Authorization')).toBe(
      `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
    );
  });
  it('never retries ambiguous, redirected, malformed, oversized or mismatched responses', async () => {
    for (const response of [
      new Response(null, {
        status: 302,
        headers: { Location: 'https://untrusted.example' },
      }),
      new Response('PRIVATE', { status: 503 }),
      new Response('PRIVATE', { status: 403 }),
      Response.json({
        success: true,
        result: {
          ...applied().result,
          versions: [{ version_id: crypto.randomUUID(), percentage: 100 }],
        },
      }),
      Response.json({
        success: true,
        result: {
          ...applied().result,
          versions: [{ version_id: versionId, percentage: 50 }],
        },
      }),
      new Response('x'.repeat(previewPolicy.maxApiBytes + 1), {
        headers: { 'Content-Type': 'application/json' },
      }),
    ]) {
      let calls = 0;
      const outcome = await activatePreviewVersion(
        config,
        versionId,
        async () => {
          calls++;
          return response;
        },
      );
      expect(outcome).toEqual({ status: 'uncertain' });
      expect(calls).toBe(1);
    }
    expect(
      await activatePreviewVersion(config, versionId, async () => {
        throw new Error('PRIVATE credential');
      }),
    ).toEqual({ status: 'uncertain' });
  });
  it('distinguishes a structured definitive denial from a timeout and validates identifiers before transport', async () => {
    for (const status of [400, 401, 403, 404, 422, 429])
      expect(
        await activatePreviewVersion(config, versionId, async () =>
          Response.json(
            { success: false, errors: [{ code: 10000, message: 'PRIVATE' }] },
            { status },
          ),
        ),
      ).toEqual({ status: 'rejected' });
    expect(
      await activatePreviewVersion(config, versionId, async () =>
        Response.json(
          { success: false, errors: [{ code: 10000 }] },
          { status: 504 },
        ),
      ),
    ).toEqual({ status: 'uncertain' });
    let calls = 0;
    await expect(
      activatePreviewVersion(config, '../other-worker', async () => {
        calls++;
        return Response.json(applied());
      }),
    ).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it('reads candidate identity and accepts only one complete timestamped deployment observation', async () => {
    const reader = previewCloudflareReader(config, async (request) =>
      Response.json(
        request.url.includes('/versions/')
          ? version()
          : { success: true, result: { deployments: [applied().result] } },
      ),
    );
    expect(await reader.candidate(versionId)).toEqual({ versionId, release });
    expect(await reader.findActivation(versionId)).toEqual({
      status: 'deployed',
      deploymentId,
      versionId,
      percentage: 100,
      createdAt,
    });
    for (const values of [
      [applied().result, applied().result],
      [{ ...applied().result, created_on: undefined }],
      [
        {
          ...applied().result,
          versions: [{ version_id: versionId, percentage: 50 }],
        },
      ],
    ])
      expect(
        await previewCloudflareReader(config, async () =>
          Response.json({ success: true, result: { deployments: values } }),
        ).findActivation(versionId),
      ).toBeNull();
  });
});
