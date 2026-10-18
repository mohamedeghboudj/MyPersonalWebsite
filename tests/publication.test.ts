import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import { createAdmin } from '../apps/admin/src/index';
import { advancePublication } from '../apps/admin/src/publication-queue';
import { syntheticPublisher } from './browser/publishing-provider';
import {
  editorOverview,
  readPublication,
  deploymentStore,
  publications,
  publicDeployments,
  audit,
} from '@platform/database';
import { publicationTargets } from '@platform/config';
import { requestCapturedBuild } from '../apps/admin/src/build-dispatch';
import { publicationProvider } from '../apps/admin/src/publication-provider';
import { coordinatePreviewDeployment } from '../apps/admin/src/preview-coordinator';
import { capturedBuildSchema } from '@platform/schema';
import { readPublishCapture } from '@platform/database';

let local: Awaited<ReturnType<typeof localDatabase>>;
let providers: ReturnType<typeof syntheticPublisher>;
const identity = {
  APP_ENV: 'local',
  ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
  ACCESS_AUDIENCE: 'synthetic-admin-audience',
  OWNER_EMAIL: 'owner@example.com',
  ADMIN_ORIGIN: 'https://admin.example',
};
const headers = {
  'Cf-Access-Jwt-Assertion': 'synthetic',
  Origin: identity.ADMIN_ORIGIN,
  'Content-Type': 'application/json',
};
const owner = async () => ({ sub: 'owner', email: identity.OWNER_EMAIL });
const bindings = () => ({
  ...identity,
  ...providers.env,
  CONTENT: local.content,
  INBOX: local.inbox,
  MEDIA: local.media,
});
beforeEach(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
  providers = syntheticPublisher(local.media);
});
afterEach(async () => local?.runtime.dispose());
it('refuses an annotated runtime Worker even if its receipt matches the public capture', async () => {
  const r = await request();
  const cf = vi.fn(async (q: Request) => {
    const response = await providers.cloudflare(q);
    if (q.method === 'GET' && /\/versions\/[^/?]+$/u.test(q.url)) {
      const value = (await response.json()) as {
        result: { resources: { script: unknown } };
      };
      value.result.resources.script = {
        etag: 'runtime-code',
        handlers: ['fetch'],
      };
      return Response.json(value);
    }
    return response;
  });
  await expect(
    advancePublication(local.content, bindings(), providers.github, cf),
  ).rejects.toThrow('active');
  expect(cf.mock.calls.filter(([q]) => q.method === 'POST')).toHaveLength(0);
  expect((await readPublication(local.content, r.id))?.status).toBe('queued');
});
it('blocks an older public build even when the provider returns a stale baseline', async () => {
  const older = await request(),
    newer = await request();
  const cf = vi.fn(providers.cloudflare);
  const provider = publicationProvider(bindings(), providers.github, cf);
  const baseline = await provider.current();
  for (const item of [older, newer])
    await requestCapturedBuild(
      local.content,
      bindings(),
      item.id,
      'owner',
      providers.github,
    );
  const candidate = async (id: string) =>
    provider.findCandidate(
      capturedBuildSchema.strip().parse({
        ...(await readPublishCapture(local.content, id)),
        schemaVersion: 1,
      }),
    );
  const newerVersion = (await candidate(newer.id))!;
  await coordinatePreviewDeployment(
    local.content,
    newer.id,
    newerVersion.versionId,
    'owner',
    provider,
    undefined,
    'publish',
  );
  const olderVersion = (await candidate(older.id))!;
  await expect(
    coordinatePreviewDeployment(
      local.content,
      older.id,
      olderVersion.versionId,
      'owner',
      { ...provider, current: async () => baseline },
      undefined,
      'publish',
    ),
  ).rejects.toMatchObject({ status: 409 });
  expect(cf.mock.calls.filter(([q]) => q.method === 'POST')).toHaveLength(1);
});
async function request(id = crypto.randomUUID()) {
  const body = {
    id,
    revision: (await editorOverview(local.content)).revision,
    purpose: 'publish',
  };
  const app = createAdmin(
    owner,
    async () => true,
    providers.github,
    providers.cloudflare,
  );
  const response = await app.request(
    '/api/publishing/publish',
    { method: 'POST', headers, body: JSON.stringify(body) },
    bindings(),
  );
  expect(response.status).toBe(202);
  return { id, body, app };
}
it('records one durable intent, publishes after the browser has left, and keeps status reads separate from mutation', async () => {
  const r = await request();
  await request(r.id);
  expect((await readPublication(local.content, r.id))?.status).toBe('queued');
  const github = vi.fn(providers.github),
    cf = vi.fn(providers.cloudflare);
  // Concurrent scheduled invocations use the same dispatch/activation fences.
  await Promise.all(
    [1, 2, 3].map(() =>
      advancePublication(local.content, bindings(), github, cf),
    ),
  );
  await advancePublication(local.content, bindings(), github, cf);
  expect((await readPublication(local.content, r.id))?.status).toBe(
    'published',
  );
  expect(github.mock.calls.filter(([q]) => q.method === 'POST')).toHaveLength(
    1,
  );
  expect(cf.mock.calls.filter(([q]) => q.method === 'POST')).toHaveLength(1);
  expect(
    cf.mock.calls.every(([q]) =>
      q.url.includes(`/scripts/${publicationTargets.preview.workerName}/`),
    ),
  ).toBe(true);
  const response = await r.app.request(
    `/api/publishing/captures/${r.id}/publication`,
    { headers },
    bindings(),
  );
  expect(await response.json()).toMatchObject({
    publication: { status: 'published' },
    deployment: { status: 'deployed' },
  });
  const audits = await drizzle(local.content)
    .select()
    .from(audit)
    .where(eq(audit.entity, `capture:${r.id}`));
  expect(
    audits.filter((row) => row.action === 'publish.requested'),
  ).toHaveLength(1);
  expect(audits.map((row) => row.action)).toContain('publish.public.deployed');
});
it('rejects anonymous, cross-origin, stale-login and caller-selected targets before recording intent', async () => {
  const body = JSON.stringify({
    id: crypto.randomUUID(),
    purpose: 'publish',
    revision: 1,
  });
  const app = createAdmin(owner, async () => true);
  for (const [requestHeaders, expected] of [
    [{}, 401],
    [{ ...headers, Origin: 'https://foreign.example' }, 403],
  ] as const)
    expect(
      (
        await app.request(
          '/api/publishing/publish',
          { method: 'POST', headers: requestHeaders, body },
          bindings(),
        )
      ).status,
    ).toBe(expected);
  expect(
    (
      await createAdmin(owner, async () => false).request(
        '/api/publishing/publish',
        { method: 'POST', headers, body },
        bindings(),
      )
    ).status,
  ).toBe(428);
  expect(
    (
      await app.request(
        '/api/publishing/publish',
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            ...JSON.parse(body),
            environment: 'production',
          }),
        },
        bindings(),
      )
    ).status,
  ).toBe(400);
  expect(await drizzle(local.content).select().from(publications)).toHaveLength(
    0,
  );
});
it('keeps the previous deployment after a failed build and permits the next saved request', async () => {
  const first = await request();
  const cf = vi.fn(providers.cloudflare);
  const fail = async (q: Request) => {
    const response = await providers.github(q);
    if (q.method === 'GET' && !q.url.includes('/workflows/'))
      return Response.json({
        ...((await response.json()) as object),
        conclusion: 'failure',
      });
    return response;
  };
  await advancePublication(local.content, bindings(), fail, cf);
  expect((await readPublication(local.content, first.id))?.status).toBe(
    'failed',
  );
  expect(cf).not.toHaveBeenCalled();
  const next = await request();
  await advancePublication(local.content, bindings(), providers.github, cf);
  expect((await readPublication(local.content, next.id))?.status).toBe(
    'published',
  );
});
it('recovers a lost accepted deployment response without sending it twice', async () => {
  const r = await request();
  const cf = vi.fn(async (q: Request) => {
    const response = await providers.cloudflare(q);
    if (q.method === 'POST') throw new Error('lost response');
    return response;
  });
  await advancePublication(local.content, bindings(), providers.github, cf);
  expect(
    (await deploymentStore('publish').readPreviewFence(local.content))
      ?.captureId,
  ).toBe(r.id);
  await advancePublication(local.content, bindings(), providers.github, cf);
  expect((await readPublication(local.content, r.id))?.status).toBe(
    'published',
  );
  expect(cf.mock.calls.filter(([q]) => q.method === 'POST')).toHaveLength(1);
});
it('holds uncertain activation across expiry and blocks subsequent publication', async () => {
  const first = await request();
  const cf = vi.fn(async (q: Request) =>
    q.method === 'POST'
      ? new Response('private error', { status: 503 })
      : providers.cloudflare(q),
  );
  await advancePublication(local.content, bindings(), providers.github, cf);
  const second = await request();
  await advancePublication(
    local.content,
    bindings(),
    providers.github,
    cf,
    () => new Date(Date.now() + 2 * 86400000),
  );
  expect((await readPublication(local.content, first.id))?.status).toBe(
    'queued',
  );
  expect((await readPublication(local.content, second.id))?.status).toBe(
    'queued',
  );
  expect(cf.mock.calls.filter(([q]) => q.method === 'POST')).toHaveLength(1);
  await expect(
    drizzle(local.content).delete(publicDeployments),
  ).rejects.toThrow();
  await expect(
    drizzle(local.content)
      .update(publicDeployments)
      .set({ status: 'rejected' }),
  ).rejects.toThrow();
});
it('expires an unstarted request without dispatch and refuses a different environment', async () => {
  const r = await request();
  const github = vi.fn(providers.github),
    cf = vi.fn(providers.cloudflare);
  await expect(
    advancePublication(
      local.content,
      { ...bindings(), APP_ENV: 'production' },
      github,
      cf,
    ),
  ).rejects.toThrow('environment');
  expect(github).not.toHaveBeenCalled();
  await advancePublication(
    local.content,
    bindings(),
    github,
    cf,
    () => new Date(Date.now() + 86400001),
  );
  expect((await readPublication(local.content, r.id))?.status).toBe('expired');
  expect(github).not.toHaveBeenCalled();
  expect(cf).not.toHaveBeenCalled();
});
it('rolls back publication intent if its minimal audit cannot be written', async () => {
  await local.content
    .prepare(
      "CREATE TRIGGER synthetic_publication_audit_failure BEFORE INSERT ON audit_log WHEN NEW.action = 'publish.requested' BEGIN SELECT RAISE(ABORT, 'Synthetic audit failure'); END;",
    )
    .run();
  const response = await createAdmin(owner, async () => true).request(
    '/api/publishing/publish',
    {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: crypto.randomUUID(),
        purpose: 'publish',
        revision: (await editorOverview(local.content)).revision,
      }),
    },
    bindings(),
  );
  expect(response.status).toBe(503);
  expect(await drizzle(local.content).select().from(publications)).toHaveLength(
    0,
  );
});
