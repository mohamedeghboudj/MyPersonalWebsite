import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq, asc } from 'drizzle-orm';
import { createAdmin } from '../apps/admin/src/index';
import {
  createPrivateCapture,
  downloadPrivateCapture,
  expirePrivateCaptures,
  publishCaptureKey,
} from '../apps/admin/src/publish-captures';
import {
  editorOverview,
  publishCaptures,
  readPublishCapture,
  audit,
  state,
  capturePublicSnapshot,
} from '@platform/database';
import { publishInputSchema } from '@platform/schema';
import { publishCapturePolicy, sha256 } from '@platform/config';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';

let local: Awaited<ReturnType<typeof localDatabase>>;
let revision: number;
const now = new Date('2026-10-14T12:00:00.000Z');
const clock = () => new Date(now);
const later = (milliseconds: number) => () =>
  new Date(now.getTime() + milliseconds);
beforeEach(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
  revision = (await editorOverview(local.content)).revision;
});
afterEach(async () => {
  await local?.runtime.dispose();
});
const request = () => ({
  id: crypto.randomUUID(),
  revision,
  purpose: 'publish' as const,
});
async function actions(id: string) {
  return (
    await drizzle(local.content)
      .select({ action: audit.action })
      .from(audit)
      .where(eq(audit.entity, `capture:${id}`))
      .orderBy(asc(audit.id))
  ).map((row) => row.action);
}
async function edit() {
  await drizzle(local.content)
    .update(state)
    .set({ revision: revision + 1 })
    .where(eq(state.id, 1));
}
function failingStorage(when: 'before' | 'after') {
  return new Proxy(local.media, {
    get(target, property) {
      if (property === 'put')
        return async (...args: Parameters<R2Bucket['put']>) => {
          if (when === 'after') await target.put(...args);
          throw new Error('PRIVATE-STORAGE-ERROR');
        };
      const value = Reflect.get(target, property);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('durable private publish captures', () => {
  it('stores one immutable input with atomic audit events and no content revision change', async () => {
    const input = request();
    const captured = await createPrivateCapture(
      local.content,
      local.media,
      input,
      'synthetic-owner',
      clock,
    );
    expect(captured.status).toBe('ready');
    expect(captured.revision).toBe(revision);
    expect((await editorOverview(local.content)).revision).toBe(revision);
    expect(captured.expiresAt).toBe(
      later(publishCapturePolicy.retentionMs)().toISOString(),
    );
    const downloaded = await downloadPrivateCapture(
      local.content,
      local.media,
      input.id,
      now,
    );
    expect(await sha256(downloaded.body)).toBe(captured.inputSha256);
    expect(
      publishInputSchema.parse(JSON.parse(downloaded.body)).snapshot.revision,
    ).toBe(revision);
    expect(await actions(input.id)).toEqual([
      'publish.capture.requested',
      'publish.capture.ready',
    ]);
    const object = await local.media.get(publishCaptureKey(input.id));
    expect(object?.size).toBe(captured.byteSize);
    expect(object?.httpMetadata?.contentType).toBe('application/octet-stream');
    expect(
      await local.media.put(publishCaptureKey(input.id), 'replacement', {
        onlyIf: new Headers({ 'If-None-Match': '*' }),
      }),
    ).toBeNull();
    await expect(
      drizzle(local.content)
        .update(publishCaptures)
        .set({ revision: revision + 1 })
        .where(eq(publishCaptures.id, input.id)),
    ).rejects.toThrow();
    await expect(
      drizzle(local.content)
        .update(publishCaptures)
        .set({ status: 'capturing' })
        .where(eq(publishCaptures.id, input.id)),
    ).rejects.toThrow();
    await expect(
      drizzle(local.content)
        .delete(publishCaptures)
        .where(eq(publishCaptures.id, input.id)),
    ).rejects.toThrow();
    expect(
      JSON.stringify(await capturePublicSnapshot(local.content)),
    ).not.toMatch(/publish-inputs|inputSha256|synthetic-owner/);
  });

  it('reuses an idempotency key after later edits but rejects a changed request intent', async () => {
    const input = request();
    const first = await createPrivateCapture(
      local.content,
      local.media,
      input,
      'owner',
      clock,
    );
    await edit();
    expect(
      await createPrivateCapture(
        local.content,
        local.media,
        { ...input, id: input.id.toUpperCase() },
        'owner',
        later(1000),
      ),
    ).toEqual(first);
    await expect(
      createPrivateCapture(
        local.content,
        local.media,
        { ...input, purpose: 'preview' },
        'owner',
        clock,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(await actions(input.id)).toHaveLength(2);
    expect(
      (await local.media.list({ prefix: 'publish-inputs/' })).objects,
    ).toHaveLength(1);
  });

  it('coalesces racing requests without duplicate audit entries or objects', async () => {
    const input = request();
    const responses = await Promise.all([
      createPrivateCapture(local.content, local.media, input, 'owner', clock),
      createPrivateCapture(
        local.content,
        local.media,
        input,
        'owner',
        later(1),
      ),
    ]);
    expect(responses.every((row) => row.id === input.id)).toBe(true);
    expect((await readPublishCapture(local.content, input.id))?.status).toBe(
      'ready',
    );
    expect(await actions(input.id)).toEqual([
      'publish.capture.requested',
      'publish.capture.ready',
    ]);
    expect(
      (await local.media.list({ prefix: 'publish-inputs/' })).objects,
    ).toHaveLength(1);
  });

  it('rejects stale content both before capture and between capture and reservation', async () => {
    await edit();
    await expect(
      createPrivateCapture(
        local.content,
        local.media,
        request(),
        'owner',
        clock,
      ),
    ).rejects.toMatchObject({ status: 409 });
    revision += 1;
    const binding = new Proxy(local.content, {
      get(target, property) {
        if (property === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            const captured = await target.batch(statements);
            await edit();
            return captured;
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      createPrivateCapture(binding, local.media, request(), 'owner', clock),
    ).rejects.toMatchObject({ status: 409 });
    expect(await drizzle(local.content).select().from(publishCaptures)).toEqual(
      [],
    );
    expect(
      (await local.media.list({ prefix: 'publish-inputs/' })).objects,
    ).toEqual([]);
  });

  it('recovers a storage failure before upload without changing its reserved hashes', async () => {
    const input = request();
    await expect(
      createPrivateCapture(
        local.content,
        failingStorage('before'),
        input,
        'owner',
        clock,
      ),
    ).rejects.toThrow('PRIVATE-STORAGE-ERROR');
    const pending = await readPublishCapture(local.content, input.id);
    expect(pending?.status).toBe('capturing');
    const recovered = await createPrivateCapture(
      local.content,
      local.media,
      input,
      'owner',
      later(2000),
    );
    expect(recovered.status).toBe('ready');
    expect(recovered.inputSha256).toBe(pending?.inputSha256);
    expect(await actions(input.id)).toHaveLength(2);
  });

  it('recovers a completed R2 write after a lost response even if the database has newer edits', async () => {
    const input = request();
    await expect(
      createPrivateCapture(
        local.content,
        failingStorage('after'),
        input,
        'owner',
        clock,
      ),
    ).rejects.toThrow('PRIVATE-STORAGE-ERROR');
    const pending = await readPublishCapture(local.content, input.id);
    await edit();
    const recovered = await createPrivateCapture(
      local.content,
      local.media,
      input,
      'owner',
      later(1000),
    );
    expect(recovered.status).toBe('ready');
    expect(recovered.inputSha256).toBe(pending?.inputSha256);
    expect(recovered.revision).toBe(revision);
    expect(await actions(input.id)).toHaveLength(2);
  });

  it('does not replace an interrupted old snapshot with newer content', async () => {
    const input = request();
    await expect(
      createPrivateCapture(
        local.content,
        failingStorage('before'),
        input,
        'owner',
        clock,
      ),
    ).rejects.toThrow();
    await edit();
    expect(
      (
        await createPrivateCapture(
          local.content,
          local.media,
          input,
          'owner',
          later(1000),
        )
      ).status,
    ).toBe('capturing');
    const failed = await createPrivateCapture(
      local.content,
      local.media,
      input,
      'owner',
      later(publishCapturePolicy.interruptedAfterMs + 1),
    );
    expect(failed).toMatchObject({
      status: 'failed',
      failureCode: 'interrupted',
    });
    expect(await local.media.get(publishCaptureKey(input.id))).toBeNull();
    expect(await actions(input.id)).toEqual([
      'publish.capture.requested',
      'publish.capture.failed',
    ]);
  });

  it('fails closed on a corrupted capture instead of overwriting it on retry', async () => {
    const input = request();
    await expect(
      createPrivateCapture(
        local.content,
        failingStorage('after'),
        input,
        'owner',
        clock,
      ),
    ).rejects.toThrow();
    await local.media.put(publishCaptureKey(input.id), 'corrupted');
    await expect(
      createPrivateCapture(
        local.content,
        local.media,
        input,
        'owner',
        later(1000),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect((await readPublishCapture(local.content, input.id))?.status).toBe(
      'failed',
    );
    expect(
      await (await local.media.get(publishCaptureKey(input.id)))?.text(),
    ).toBe('corrupted');
  });

  it('keeps a capture retryable when its storage response stream is interrupted', async () => {
    const input = request();
    await expect(
      createPrivateCapture(
        local.content,
        failingStorage('after'),
        input,
        'owner',
        clock,
      ),
    ).rejects.toThrow();
    const interruptedRead = new Proxy(local.media, {
      get(target, property) {
        if (property === 'get')
          return async (key: string) => {
            const object = await target.get(key);
            if (!object) return null;
            await object.body.cancel();
            return new Proxy(object, {
              get(value, field) {
                if (field === 'body')
                  return new ReadableStream<Uint8Array>({
                    pull(controller) {
                      controller.error(new Error('storage stream interrupted'));
                    },
                  });
                return Reflect.get(value, field);
              },
            });
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      createPrivateCapture(
        local.content,
        interruptedRead,
        input,
        'owner',
        later(1000),
      ),
    ).rejects.toThrow('storage stream interrupted');
    expect((await readPublishCapture(local.content, input.id))?.status).toBe(
      'capturing',
    );
    expect(await actions(input.id)).toEqual(['publish.capture.requested']);
    expect(
      (
        await createPrivateCapture(
          local.content,
          local.media,
          input,
          'owner',
          later(2000),
        )
      ).status,
    ).toBe('ready');
  });

  it('cleans up a delayed write that finishes after another request expires its reservation', async () => {
    const input = request();
    let current = now;
    const expired = later(publishCapturePolicy.retentionMs + 1)();
    const delayedWrite = new Proxy(local.media, {
      get(target, property) {
        if (property === 'put')
          return async (...args: Parameters<R2Bucket['put']>) => {
            current = expired;
            await expirePrivateCaptures(
              local.content,
              local.media,
              'owner',
              expired,
            );
            return target.put(...args);
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const result = await createPrivateCapture(
      local.content,
      delayedWrite,
      input,
      'owner',
      () => current,
    );
    expect(result.status).toBe('expired');
    expect(await local.media.get(publishCaptureKey(input.id))).toBeNull();
    expect(await actions(input.id)).toEqual([
      'publish.capture.requested',
      'publish.capture.expired',
    ]);
  });

  it('expires only capture objects, retains history and releases storage only after R2 deletion', async () => {
    const input = request();
    await createPrivateCapture(
      local.content,
      local.media,
      input,
      'owner',
      clock,
    );
    await local.media.put('originals/keep-private.png', 'synthetic original');
    const expiredClock = later(publishCapturePolicy.retentionMs + 1);
    await expect(
      downloadPrivateCapture(
        local.content,
        local.media,
        input.id,
        expiredClock(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    const failingDelete = new Proxy(local.media, {
      get(target, property) {
        if (property === 'delete')
          return async () => {
            throw new Error('delete unavailable');
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await expect(
      expirePrivateCaptures(
        local.content,
        failingDelete,
        'owner',
        expiredClock(),
      ),
    ).rejects.toThrow();
    expect((await readPublishCapture(local.content, input.id))?.status).toBe(
      'ready',
    );
    await expirePrivateCaptures(
      local.content,
      local.media,
      'owner',
      expiredClock(),
    );
    expect((await readPublishCapture(local.content, input.id))?.status).toBe(
      'expired',
    );
    expect(await local.media.get(publishCaptureKey(input.id))).toBeNull();
    expect(await local.media.get('originals/keep-private.png')).not.toBeNull();
    expect(
      (
        await createPrivateCapture(
          local.content,
          local.media,
          input,
          'owner',
          expiredClock,
        )
      ).status,
    ).toBe('expired');
    expect(await actions(input.id)).toEqual([
      'publish.capture.requested',
      'publish.capture.ready',
      'publish.capture.expired',
    ]);
  });

  it('caps retained capture storage before creating an orphan and permits new captures after expiry', async () => {
    for (let index = 0; index < 20; index++)
      await createPrivateCapture(
        local.content,
        local.media,
        request(),
        'owner',
        clock,
      );
    await expect(
      createPrivateCapture(
        local.content,
        local.media,
        request(),
        'owner',
        clock,
      ),
    ).rejects.toMatchObject({ status: 413 });
    expect(
      (await local.media.list({ prefix: 'publish-inputs/' })).objects,
    ).toHaveLength(20);
    const next = await createPrivateCapture(
      local.content,
      local.media,
      request(),
      'owner',
      later(publishCapturePolicy.retentionMs + 1),
    );
    expect(next.status).toBe('ready');
    expect(next.sequence).toBeGreaterThan(20);
    expect(
      (await local.media.list({ prefix: 'publish-inputs/' })).objects,
    ).toHaveLength(16);
  });

  it('stays inside the Free D1 query allowance for the complete capture operation', async () => {
    let preparedQueries = 0;
    const binding = new Proxy(local.content, {
      get(target, property) {
        if (property === 'prepare')
          return (query: string) => {
            preparedQueries++;
            return target.prepare(query);
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    await createPrivateCapture(binding, local.media, request(), 'owner', clock);
    expect(preparedQueries).toBeLessThanOrEqual(50);
  });
});

describe('publish capture API boundaries', () => {
  const headers = {
    'Cf-Access-Jwt-Assertion': 'synthetic',
    Origin: 'https://admin.example.com',
    'Content-Type': 'application/json',
  };
  const env = () => ({
    CONTENT: local.content,
    INBOX: local.inbox,
    MEDIA: local.media,
    ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
    ACCESS_AUDIENCE: 'test-audience-0001',
    OWNER_EMAIL: 'owner@example.com',
    ADMIN_ORIGIN: 'https://admin.example.com',
    APP_ENV: 'local',
  });
  const owner = async () => ({ sub: 'owner', email: 'owner@example.com' });
  it('enforces owner identity, origin and recent login before capture writes', async () => {
    const payload = JSON.stringify(request());
    const app = createAdmin(owner, async () => true);
    expect(
      (
        await app.request(
          '/api/publishing/captures',
          { method: 'POST', body: payload },
          env(),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await app.request(
          '/api/publishing/captures',
          {
            method: 'POST',
            headers: { ...headers, Origin: 'https://untrusted.example.com' },
            body: payload,
          },
          env(),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await createAdmin(
          async () => ({ sub: 'other', email: 'other@example.com' }),
          async () => true,
        ).request(
          '/api/publishing/captures',
          { method: 'POST', headers, body: payload },
          env(),
        )
      ).status,
    ).toBe(403);
    const expired = await createAdmin(owner, async () => false).request(
      '/api/publishing/captures',
      { method: 'POST', headers, body: payload },
      env(),
    );
    expect(expired.status).toBe(428);
    expect(await expired.json()).toMatchObject({
      reauthenticate: '/cdn-cgi/access/logout',
    });
    expect(
      (
        await createAdmin(owner, async () => {
          throw new Error('provider unavailable');
        }).request(
          '/api/publishing/captures',
          { method: 'POST', headers, body: payload },
          env(),
        )
      ).status,
    ).toBe(503);
    expect(await drizzle(local.content).select().from(publishCaptures)).toEqual(
      [],
    );
  });

  it('keeps capture metadata and downloads private and suppresses raw storage errors', async () => {
    const app = createAdmin(owner, async () => true);
    const input = request();
    const response = await app.request(
      '/api/publishing/captures',
      { method: 'POST', headers, body: JSON.stringify(input) },
      env(),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const result = (await response.json()) as {
      capture: { status: string; inputSha256: string };
    };
    expect(result.capture.status).toBe('ready');
    const path = `/api/publishing/captures/${input.id}/input`;
    expect((await app.request(path, {}, env())).status).toBe(401);
    const download = await app.request(path, { headers }, env());
    expect(download.status).toBe(200);
    expect(download.headers.get('Content-Disposition')).toContain('attachment');
    expect(download.headers.get('Content-Security-Policy')).toContain(
      'sandbox',
    );
    expect(download.headers.get('Cache-Control')).toBe('no-store');
    expect(await sha256(await download.text())).toBe(
      result.capture.inputSha256,
    );
    const summary = await app.request(
      `/api/publishing/captures/${input.id}`,
      { headers },
      env(),
    );
    expect(await summary.text()).not.toMatch(
      /createdBy|updatedBy|mediaSources|r2Key/,
    );
    const failed = await app.request(
      '/api/publishing/captures',
      { method: 'POST', headers, body: JSON.stringify(request()) },
      { ...env(), MEDIA: failingStorage('before') },
    );
    expect(failed.status).toBe(503);
    expect(await failed.text()).not.toContain('PRIVATE-STORAGE-ERROR');
    const invalid = await app.request(
      '/api/publishing/captures',
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ ...request(), input: 'untrusted raw snapshot' }),
      },
      env(),
    );
    expect(invalid.status).toBe(400);
  });
});
