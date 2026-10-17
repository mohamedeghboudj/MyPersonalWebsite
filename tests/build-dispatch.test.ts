import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq, asc } from 'drizzle-orm';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import { createPrivateCapture } from '../apps/admin/src/publish-captures';
import {
  requestCapturedBuild,
  capturedBuildStatus,
} from '../apps/admin/src/build-dispatch';
import { findDispatchedBuild } from '../apps/admin/src/github-builds';
import { createAdmin } from '../apps/admin/src/index';
import { publishing, publishCapturePolicy } from '@platform/config';
import { capturedBuildSchema } from '@platform/schema';
import {
  editorOverview,
  readBuildDispatch,
  buildDispatches,
  audit,
} from '@platform/database';

let local: Awaited<ReturnType<typeof localDatabase>>;
const now = new Date('2026-10-15T10:00:00Z');
const clock = () => new Date(now);
const later = () => new Date(now.getTime() + publishing.reconcileAfterMs + 1);
const env = {
  APP_ENV: 'local',
  PUBLISH_BUILDS_ENABLED: 'true',
  PUBLISH_GITHUB_TOKEN: 'synthetic-github-token-not-a-credential',
};
let id: string;
beforeEach(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
  id = crypto.randomUUID();
  await createPrivateCapture(
    local.content,
    local.media,
    {
      id,
      revision: (await editorOverview(local.content)).revision,
      purpose: 'preview',
    },
    'owner',
    clock,
  );
});
afterEach(async () => {
  await local?.runtime.dispose();
  vi.unstubAllGlobals();
});
const run = (captureId = id) => ({
  id: 123,
  display_title: `Capture ${captureId}`,
  head_branch: 'main',
  path: '.github/workflows/build-capture.yml',
  event: 'workflow_dispatch',
  status: 'completed',
  conclusion: 'success',
});
const accepted = () =>
  Response.json({
    workflow_run_id: 123,
    html_url: 'https://untrusted.example',
  });
async function actions() {
  return (
    await drizzle(local.content)
      .select({ action: audit.action })
      .from(audit)
      .where(eq(audit.entity, `capture:${id}`))
      .orderBy(asc(audit.id))
  ).map((row) => row.action);
}

describe('authenticated capture dispatch', () => {
  it('dispatches metadata to the fixed trusted workflow once, with atomic audit records', async () => {
    const requests: Request[] = [];
    const fetcher = async (request: Request) => {
      requests.push(request);
      return accepted();
    };
    const before = await editorOverview(local.content);
    const result = await requestCapturedBuild(
      local.content,
      env,
      id,
      'owner',
      fetcher,
      clock,
    );
    expect(result).toMatchObject({
      captureId: id,
      status: 'queued',
      runId: 123,
    });
    expect(
      await requestCapturedBuild(
        local.content,
        env,
        id,
        'owner',
        fetcher,
        later,
      ),
    ).toEqual(result);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(
      `https://api.github.com/repos/${publishing.repository}/actions/workflows/build-capture.yml/dispatches`,
    );
    expect(requests[0]!.redirect).toBe('manual');
    expect(requests[0]!.headers.get('Authorization')).toBe(
      `Bearer ${env.PUBLISH_GITHUB_TOKEN}`,
    );
    const body = (await requests[0]!.json()) as {
      ref: string;
      inputs: { capture_id: string; capture: string };
    };
    expect(body.ref).toBe('main');
    expect(body.inputs.capture_id).toBe(id);
    expect(capturedBuildSchema.parse(JSON.parse(body.inputs.capture)).id).toBe(
      id,
    );
    expect(JSON.stringify(body)).not.toMatch(
      /mediaSources|r2Key|profile|translations|synthetic-github-token/,
    );
    expect(JSON.stringify(result)).not.toMatch(/requestedBy|updatedBy|token/);
    expect((await editorOverview(local.content)).revision).toBe(
      before.revision,
    );
    expect(await actions()).toEqual([
      'publish.capture.requested',
      'publish.capture.ready',
      'publish.build.requested',
      'publish.build.queued',
    ]);
  });

  it('coalesces concurrent clicks before contacting GitHub', async () => {
    const fetcher = vi.fn(async () => accepted());
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        requestCapturedBuild(local.content, env, id, 'owner', fetcher, clock),
      ),
    );
    expect(results.every((result) => result.captureId === id)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await readBuildDispatch(local.content, id))?.status).toBe('queued');
    expect(
      (await actions()).filter(
        (action) => action === 'publish.build.requested',
      ),
    ).toHaveLength(1);
  });

  it('reconciles a lost response without resending even if the capture later expires', async () => {
    const requests: string[] = [];
    const fetcher = async (request: Request) => {
      requests.push(request.method);
      if (request.method === 'POST')
        throw new Error('response lost after accepted');
      return Response.json({ workflow_runs: [run()] });
    };
    expect(
      (
        await requestCapturedBuild(
          local.content,
          env,
          id,
          'owner',
          fetcher,
          clock,
        )
      ).status,
    ).toBe('uncertain');
    expect(
      (
        await requestCapturedBuild(
          local.content,
          env,
          id,
          'owner',
          fetcher,
          clock,
        )
      ).status,
    ).toBe('uncertain');
    const expired = () =>
      new Date(now.getTime() + publishCapturePolicy.retentionMs + 1);
    expect(
      (
        await requestCapturedBuild(
          local.content,
          env,
          id,
          'owner',
          fetcher,
          expired,
        )
      ).status,
    ).toBe('queued');
    expect(requests).toEqual(['POST', 'GET']);
    expect(await actions()).toContain('publish.build.uncertain');
  });

  it('recovers after GitHub accepted but the local acknowledgement could not be persisted', async () => {
    const binding = new Proxy(local.content, {
      get(target, property) {
        if (property === 'prepare')
          return (query: string) => {
            if (query.startsWith('update "build_dispatches"'))
              throw new Error('D1 temporarily unavailable');
            return target.prepare(query);
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      requestCapturedBuild(
        binding,
        env,
        id,
        'owner',
        async () => accepted(),
        clock,
      ),
    ).rejects.toThrow();
    expect((await readBuildDispatch(local.content, id))?.status).toBe(
      'dispatching',
    );
    const fetcher = vi.fn(async (request: Request) => {
      expect(request.method).toBe('GET');
      return Response.json({ workflow_runs: [run()] });
    });
    expect(
      (
        await requestCapturedBuild(
          local.content,
          env,
          id,
          'owner',
          fetcher,
          later,
        )
      ).status,
    ).toBe('queued');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('retains definitive rejections without allowing a second dispatch attempt', async () => {
    const fetcher = vi.fn(
      async () => new Response('PRIVATE-ERROR-TOKEN', { status: 403 }),
    );
    expect(
      (
        await requestCapturedBuild(
          local.content,
          env,
          id,
          'owner',
          fetcher,
          clock,
        )
      ).status,
    ).toBe('rejected');
    expect(
      (
        await requestCapturedBuild(
          local.content,
          env,
          id,
          'owner',
          fetcher,
          later,
        )
      ).status,
    ).toBe('rejected');
    expect(fetcher).toHaveBeenCalledTimes(1);
    await expect(
      drizzle(local.content)
        .delete(buildDispatches)
        .where(eq(buildDispatches.captureId, id)),
    ).rejects.toThrow();
    await expect(
      drizzle(local.content)
        .update(buildDispatches)
        .set({ status: 'dispatching' })
        .where(eq(buildDispatches.captureId, id)),
    ).rejects.toThrow();
  });

  it('never guesses among unrelated or duplicate runs and never resends an uncertain request', async () => {
    const fetcher = vi.fn(async (request: Request) =>
      request.method === 'POST'
        ? new Response(null, { status: 204 })
        : Response.json({ workflow_runs: [run(), { ...run(), id: 124 }] }),
    );
    await requestCapturedBuild(local.content, env, id, 'owner', fetcher, clock);
    expect(
      (
        await requestCapturedBuild(
          local.content,
          env,
          id,
          'owner',
          fetcher,
          later,
        )
      ).status,
    ).toBe('uncertain');
    expect(
      fetcher.mock.calls.filter(([request]) => request.method === 'POST'),
    ).toHaveLength(1);
    expect(
      await findDispatchedBuild(env.PUBLISH_GITHUB_TOKEN, id, async () =>
        Response.json({
          workflow_runs: [
            run(crypto.randomUUID()),
            { ...run(), head_branch: 'other' },
            { ...run(), path: '.github/workflows/other.yml' },
            { ...run(), event: 'push' },
          ],
        }),
      ),
    ).toBeNull();
  });

  it('rejects missing, expired and disabled requests before dispatch or reservation', async () => {
    const fetcher = vi.fn(async () => accepted());
    await expect(
      requestCapturedBuild(local.content, {}, id, 'owner', fetcher, clock),
    ).rejects.toThrow('not configured');
    await expect(
      requestCapturedBuild(
        local.content,
        { ...env, APP_ENV: 'production' },
        id,
        'owner',
        fetcher,
        clock,
      ),
    ).rejects.toThrow('not configured');
    await expect(
      requestCapturedBuild(
        local.content,
        env,
        crypto.randomUUID(),
        'owner',
        fetcher,
        clock,
      ),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      requestCapturedBuild(
        local.content,
        env,
        id,
        'owner',
        fetcher,
        () => new Date(now.getTime() + publishCapturePolicy.retentionMs),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await readBuildDispatch(local.content, id)).toBeUndefined();
  });

  it('returns validated build status without claiming a deployment or trusting upstream URLs', async () => {
    await requestCapturedBuild(
      local.content,
      env,
      id,
      'owner',
      async () => accepted(),
      clock,
    );
    const result = await capturedBuildStatus(local.content, env, id, async () =>
      Response.json({ ...run(), html_url: 'https://untrusted.example' }),
    );
    expect(result.run).toEqual({
      status: 'completed',
      conclusion: 'success',
      url: `https://github.com/${publishing.repository}/actions/runs/123`,
    });
    await expect(
      capturedBuildStatus(local.content, env, id, async () =>
        Response.json({ ...run(), id: 124 }),
      ),
    ).rejects.toThrow('unavailable');
  });

  it('enforces identity, origin, recent login and server-owned inputs at the API', async () => {
    const fake = vi.fn(async () => accepted());
    const owner = async () => ({ sub: 'owner', email: 'owner@example.com' });
    const bindings = {
      ...env,
      CONTENT: local.content,
      INBOX: local.inbox,
      MEDIA: local.media,
      ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
      ACCESS_AUDIENCE: 'a'.repeat(64),
      OWNER_EMAIL: 'owner@example.com',
      ADMIN_ORIGIN: 'https://admin.example.com',
    };
    const headers = {
      'Cf-Access-Jwt-Assertion': 'synthetic',
      Origin: bindings.ADMIN_ORIGIN,
      'Content-Type': 'application/json',
    };
    const path = `/api/publishing/captures/${id}/build`;
    const app = createAdmin(owner, async () => true, fake);
    expect(
      (await app.request(path, { method: 'POST', body: '{}' }, bindings))
        .status,
    ).toBe(401);
    expect(
      (
        await app.request(
          path,
          {
            method: 'POST',
            headers: { ...headers, Origin: 'https://other.example' },
            body: '{}',
          },
          bindings,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await createAdmin(owner, async () => false, fake).request(
          path,
          { method: 'POST', headers, body: '{}' },
          bindings,
        )
      ).status,
    ).toBe(428);
    expect(
      (
        await app.request(
          path,
          { method: 'POST', headers, body: '{"ref":"other"}' },
          bindings,
        )
      ).status,
    ).toBe(400);
    expect(fake).not.toHaveBeenCalled();
  });
});
