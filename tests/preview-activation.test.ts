import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import { createPrivateCapture } from '../apps/admin/src/publish-captures';
import { createAdmin } from '../apps/admin/src/index';
import {
  editorOverview,
  readPublishCapture,
  reserveBuildDispatch,
  finishBuildDispatch,
  readPreviewFence,
} from '@platform/database';
import { previewPolicy } from '@platform/config';

let local: Awaited<ReturnType<typeof localDatabase>>;
let id: string, versionId: string, previousVersionId: string;
let release: unknown;
const env = {
  APP_ENV: 'local',
  ACCESS_ISSUER: 'https://team.cloudflareaccess.com',
  ACCESS_AUDIENCE: 'synthetic-admin-audience',
  OWNER_EMAIL: 'owner@example.com',
  ADMIN_ORIGIN: 'https://admin.example.com',
  PREVIEW_ACTIVATION_ENABLED: 'true',
  PREVIEW_ACCESS_AUDIENCE: 'synthetic-preview-audience',
  PREVIEW_CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-credential',
  CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  PUBLISH_GITHUB_TOKEN: 'synthetic-github-credential',
};
const headers = {
  'Cf-Access-Jwt-Assertion': 'synthetic-owner-jwt',
  Origin: env.ADMIN_ORIGIN,
  'Content-Type': 'application/json',
};
const owner = async () => ({ sub: 'owner', email: env.OWNER_EMAIL });
const bindings = () => ({
  ...env,
  CONTENT: local.content,
  INBOX: local.inbox,
  MEDIA: local.media,
});
beforeEach(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
  id = crypto.randomUUID();
  versionId = crypto.randomUUID();
  previousVersionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await createPrivateCapture(
    local.content,
    local.media,
    {
      id,
      purpose: 'preview',
      revision: (await editorOverview(local.content)).revision,
    },
    'owner',
  );
  await reserveBuildDispatch(local.content, id, 'owner', now);
  await finishBuildDispatch(local.content, id, 'queued', 123, 'owner', now);
  const capture = (await readPublishCapture(local.content, id))!;
  release = {
    schemaVersion: 1,
    id,
    sequence: capture.sequence,
    revision: capture.revision,
    snapshotSha256: capture.snapshotSha256,
    bundleSha256: 'a'.repeat(64),
  };
});
afterEach(async () => local?.runtime.dispose());
const path = () => `/api/publishing/captures/${id}/preview`;
const run = () =>
  Response.json({
    id: 123,
    display_title: `Capture ${id}`,
    head_branch: 'main',
    path: '.github/workflows/build-capture.yml',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
  });
const cloudflare = async (request: Request) => {
  if (request.method === 'POST')
    return Response.json({
      success: true,
      result: {
        id: crypto.randomUUID(),
        created_on: new Date().toISOString(),
        strategy: 'percentage',
        versions: [{ version_id: versionId, percentage: 100 }],
      },
    });
  if (request.url.endsWith('/deployments'))
    return Response.json({
      success: true,
      result: {
        deployments: [
          {
            id: crypto.randomUUID(),
            versions: [{ version_id: previousVersionId, percentage: 100 }],
          },
        ],
      },
    });
  const requested = request.url.split('/').at(-1)!;
  return Response.json({
    success: true,
    result: {
      id: requested,
      resources: {
        bindings: Object.entries({
          APP_ENV: 'preview',
          ACCESS_ISSUER: env.ACCESS_ISSUER,
          ACCESS_AUDIENCE: env.PREVIEW_ACCESS_AUDIENCE,
          OWNER_EMAIL: env.OWNER_EMAIL,
          PREVIEW_RELEASE:
            requested === previousVersionId
              ? previewPolicy.bootstrap
              : JSON.stringify(release),
        }).map(([name, text]) => ({ name, text, type: 'plain_text' })),
      },
    },
  });
};
it('connects owner-authenticated activation to the durable coordinator and returns safe status', async () => {
  const cf = vi.fn(cloudflare),
    github = vi.fn(async () => run());
  const app = createAdmin(owner, async () => true, github, cf);
  const request = {
    method: 'POST',
    headers,
    body: JSON.stringify({ versionId }),
  };
  for (let i = 0; i < 2; i++) {
    const response = await app.request(path(), request, bindings());
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toContain('"status":"deployed"');
    expect(text).not.toMatch(/credential|requestedBy|updatedBy/);
  }
  expect(
    cf.mock.calls.filter(([request]) => request.method === 'POST'),
  ).toHaveLength(1);
  expect(github).toHaveBeenCalledTimes(1);
  expect((await app.request(path(), { headers }, bindings())).status).toBe(200);
  expect(await readPreviewFence(local.content)).toBeUndefined();
});
it('rejects missing/non-owner identity, foreign origin, stale login and extra caller-controlled fields before provider access', async () => {
  const cf = vi.fn(cloudflare),
    github = vi.fn(async () => run());
  const app = createAdmin(owner, async () => true, github, cf),
    body = JSON.stringify({ versionId });
  expect(
    (await app.request(path(), { method: 'POST', body }, bindings())).status,
  ).toBe(401);
  expect(
    (
      await createAdmin(
        async () => ({ sub: 'other', email: 'other@example.com' }),
        async () => true,
        github,
        cf,
      ).request(path(), { method: 'POST', headers, body }, bindings())
    ).status,
  ).toBe(403);
  expect(
    (
      await app.request(
        path(),
        {
          method: 'POST',
          headers: { ...headers, Origin: 'https://other.example' },
          body,
        },
        bindings(),
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await createAdmin(owner, async () => false, github, cf).request(
        path(),
        { method: 'POST', headers, body },
        bindings(),
      )
    ).status,
  ).toBe(428);
  expect(
    (
      await app.request(
        path(),
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            versionId,
            force: true,
            worker: 'production',
          }),
        },
        bindings(),
      )
    ).status,
  ).toBe(400);
  expect(
    (
      await app.request(
        path() + '/reconcile',
        { method: 'POST', headers, body: '{"rejected":true}' },
        bindings(),
      )
    ).status,
  ).toBe(400);
  expect(cf).not.toHaveBeenCalled();
  expect(github).not.toHaveBeenCalled();
});
it('is disabled by default, rejects production and never reuses the admin Access audience', async () => {
  const cf = vi.fn(cloudflare),
    github = vi.fn(async () => run());
  const app = createAdmin(owner, async () => true, github, cf);
  for (const extra of [
    { PREVIEW_ACTIVATION_ENABLED: 'false' },
    { APP_ENV: 'production', PUBLIC_ORIGIN: 'https://public.example.com' },
    { PREVIEW_ACCESS_AUDIENCE: env.ACCESS_AUDIENCE },
  ])
    expect(
      (
        await app.request(
          path(),
          { method: 'POST', headers, body: JSON.stringify({ versionId }) },
          { ...bindings(), ...extra },
        )
      ).status,
    ).toBe(503);
  expect(cf).not.toHaveBeenCalled();
  expect(github).not.toHaveBeenCalled();
});
it('keeps an ambiguous result behind the fence and reconciles without another mutation or upstream error disclosure', async () => {
  const cf = vi.fn(async (request: Request) =>
    request.method === 'POST'
      ? new Response('PRIVATE provider credential', { status: 503 })
      : cloudflare(request),
  );
  const app = createAdmin(
    owner,
    async () => true,
    async () => run(),
    cf,
  );
  const response = await app.request(
    path(),
    { method: 'POST', headers, body: JSON.stringify({ versionId }) },
    bindings(),
  );
  expect(response.status).toBe(202);
  expect(await response.text()).not.toContain('PRIVATE');
  const again = await app.request(
    path() + '/reconcile',
    { method: 'POST', headers, body: '{}' },
    bindings(),
  );
  expect(again.status).toBe(202);
  expect(
    cf.mock.calls.filter(([request]) => request.method === 'POST'),
  ).toHaveLength(1);
  expect((await readPreviewFence(local.content))?.captureId).toBe(id);
});
it('discovers only completed, owner-accessible preview captures and exposes no configuration secrets', async () => {
  const cf = vi.fn(async (request: Request) =>
    request.url.includes('?deployable=true')
      ? Response.json({
          success: true,
          result: {
            items: [
              {
                id: versionId,
                metadata: { created_on: new Date().toISOString() },
              },
            ],
          },
        })
      : cloudflare(request),
  );
  const app = createAdmin(
    owner,
    async () => false,
    async () => run(),
    cf,
  );
  const candidatePath = `/api/publishing/captures/${id}/candidate`;
  expect((await app.request(candidatePath, {}, bindings())).status).toBe(401);
  const response = await app.request(candidatePath, { headers }, bindings());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    candidate: { versionId, release },
  });
  const status = await app.request(
    '/api/publishing/status',
    { headers },
    bindings(),
  );
  expect(await status.json()).toEqual({
    available: false,
    previewUrl: previewPolicy.origin,
  });
  const enabled = await app.request(
    '/api/publishing/status',
    { headers },
    { ...bindings(), PUBLISH_BUILDS_ENABLED: 'true' },
  );
  expect(await enabled.text()).not.toMatch(
    /credential|OWNER_EMAIL|ACCESS_AUDIENCE/,
  );
  expect(cf.mock.calls.every(([request]) => request.method === 'GET')).toBe(
    true,
  );
  const building = createAdmin(
    owner,
    async () => true,
    async () =>
      Response.json({
        ...((await run().json()) as Record<string, unknown>),
        status: 'in_progress',
        conclusion: null,
      }),
    cf,
  );
  cf.mockClear();
  expect(
    (await building.request(candidatePath, { headers }, bindings())).status,
  ).toBe(409);
  expect(cf).not.toHaveBeenCalled();
});
