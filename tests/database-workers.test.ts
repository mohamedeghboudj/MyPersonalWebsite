import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import {
  createSnapshot,
  capturePublishSource,
  saveEducation,
  audit,
  messages,
  rateLimits,
  variantItems,
} from '@platform/database';
import { createAdmin } from '../apps/admin/src/index';
import { createContact, purgeInbox } from '../worker/contact/src/index';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import { spikeEducation } from '../scripts/fixtures';

let local: Awaited<ReturnType<typeof localDatabase>>;
beforeAll(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await local?.runtime.dispose();
});
describe('real local D1 content boundaries', () => {
  it('saves translations transactionally and exports public projections only', async () => {
    await saveEducation(local.content, 1, spikeEducation, 'test-owner');
    await saveEducation(
      local.content,
      2,
      {
        ...spikeEducation,
        isVisible: false,
        translations: [
          { ...spikeEducation.translations[0], description: 'HIDDEN_SECRET' },
        ],
      },
      'test-owner',
    );
    // A new private column/table must not start leaking through a broad SELECT.
    await local.content.exec(
      "ALTER TABLE education ADD COLUMN private_note TEXT DEFAULT 'PRIVATE_SECRET';\nCREATE TABLE private_records (secret TEXT);\nINSERT INTO private_records VALUES ('UNLISTED_SECRET');",
    );
    const snapshot = await createSnapshot(local.content);
    expect(snapshot.revision).toBe(2);
    const captured = await capturePublishSource(local.content);
    expect(captured.savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(captured.snapshot.revision).toBe(snapshot.revision);
    expect(Object.keys(captured).sort()).toEqual(['savedAt', 'snapshot']);
    expect(JSON.stringify(captured)).not.toContain('test-owner');
    expect(snapshot.education.map((item) => item.id)).toEqual([1]);
    expect(
      snapshot.publicVariant.items.map((item) => item.contentItemId),
    ).toEqual([1]);
    expect(JSON.stringify(snapshot)).not.toMatch(
      /HIDDEN_SECRET|PRIVATE_SECRET|UNLISTED_SECRET|contact_messages|private_note/,
    );
    expect((await drizzle(local.content).select().from(audit)).length).toBe(2);
    await expect(
      drizzle(local.content)
        .insert(variantItems)
        .values({ variantId: 1, contentItemId: 999, position: 0 }),
    ).rejects.toThrow();
    await expect(
      local.inbox.prepare('SELECT * FROM education').all(),
    ).rejects.toThrow();
    await expect(
      local.content.prepare('SELECT * FROM contact_messages').all(),
    ).rejects.toThrow();
  });
  it('rolls back a failed batch and enforces append-only audit', async () => {
    const before = await createSnapshot(local.content);
    await expect(
      local.content.batch([
        local.content.prepare(
          'UPDATE platform_state SET revision = 99 WHERE id = 1',
        ),
        local.content.prepare("UPDATE audit_log SET action = 'tampered'"),
      ]),
    ).rejects.toThrow();
    expect((await createSnapshot(local.content)).revision).toBe(
      before.revision,
    );
  });
});
describe('admin uses actual JWT verification without a deployed bypass', () => {
  it('checks signature, expiry, issuer, audience, owner identity and mutation origin', async () => {
    const keys = await generateKeyPair('RS256');
    const jwk = await exportJWK(keys.publicKey);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }],
        }),
      ),
    );
    const env = {
      CONTENT: local.content,
      INBOX: local.inbox,
      ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
      ACCESS_AUDIENCE: 'test-audience-0001',
      OWNER_EMAIL: 'owner@example.com',
      ADMIN_ORIGIN: 'https://admin.example.com',
    };
    const sign = (overrides: Record<string, unknown> = {}) =>
      new SignJWT({
        email: env.OWNER_EMAIL,
        sub: 'owner-id',
        iss: env.ACCESS_ISSUER,
        aud: env.ACCESS_AUDIENCE,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        ...overrides,
      })
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .sign(keys.privateKey);
    const app = createAdmin();
    expect((await app.request('/api/session', {}, env)).status).toBe(401);
    expect(
      (
        await app.request(
          '/api/session',
          { headers: { 'Cf-Access-Jwt-Assertion': 'forged' } },
          env,
        )
      ).status,
    ).toBe(401);
    for (const claims of [
      { exp: 1 },
      { iss: 'https://other.cloudflareaccess.com' },
      { aud: 'other-audience' },
    ])
      expect(
        (
          await app.request(
            '/api/session',
            { headers: { 'Cf-Access-Jwt-Assertion': await sign(claims) } },
            env,
          )
        ).status,
      ).toBe(401);
    expect(
      (
        await app.request(
          '/api/session',
          {
            headers: {
              'Cf-Access-Jwt-Assertion': await sign({
                email: 'other@example.com',
              }),
            },
          },
          env,
        )
      ).status,
    ).toBe(403);
    const token = await sign();
    expect(
      (
        await app.request(
          '/api/session',
          { headers: { 'Cf-Access-Jwt-Assertion': token } },
          env,
        )
      ).status,
    ).toBe(200);
    const mutation = {
      method: 'PUT',
      headers: {
        'Cf-Access-Jwt-Assertion': token,
        'Content-Type': 'application/json',
        Origin: 'https://evil.example',
      },
      body: JSON.stringify(spikeEducation),
    };
    expect((await app.request('/api/education/3', mutation, env)).status).toBe(
      403,
    );
    expect(
      (
        await app.request(
          '/api/education/3',
          {
            ...mutation,
            headers: { ...mutation.headers, Origin: env.ADMIN_ORIGIN },
          },
          env,
        )
      ).status,
    ).toBe(200);
    vi.unstubAllGlobals();
  });
});
describe('isolated public contact path', () => {
  const clock = Date.now();
  const notification = vi.fn(async () => ({}));
  const challenge = vi.fn(async () => ({
    success: true,
    hostname: 'example.com',
    action: 'contact',
  }));
  const app = createContact(challenge, () => clock);
  const env = () => ({
    INBOX: local.inbox,
    EMAIL: { send: notification },
    PUBLIC_ORIGIN: 'https://example.com',
    TURNSTILE_HOSTNAME: 'example.com',
    TURNSTILE_SECRET: 'test-secret-not-live',
    RATE_LIMIT_SALT: 'test-salt-000000000000000000000000',
    NOTIFICATION_FROM: 'contact@example.com',
    NOTIFICATION_TO: 'owner@example.com',
  });
  const input = () => ({
    name: 'Test Visitor',
    email: 'visitor@example.com',
    message: '<img src=x onerror=alert(1)> is inert text',
    website: '',
    startedAt: clock - 5000,
    idempotencyKey: crypto.randomUUID(),
    turnstileToken: 'fake-for-local-test-only',
  });
  const request = (
    data: unknown,
    ip = '192.0.2.1',
    origin = 'https://example.com',
  ) =>
    new Request('https://contact.example.com/contact', {
      method: 'POST',
      headers: {
        Origin: origin,
        'Content-Type': 'application/json',
        'CF-Connecting-IP': ip,
      },
      body: JSON.stringify(data),
    });
  it('stores once, sends only to the owner, retries without replaying Turnstile', async () => {
    const data = input();
    const first = await app.request(request(data), undefined, env());
    const second = await app.request(request(data), undefined, env());
    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(await first.json()).toEqual(await second.json());
    expect(challenge).toHaveBeenCalledTimes(1);
    expect(notification).toHaveBeenCalledTimes(1);
    expect(notification).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'owner@example.com',
        replyTo: 'visitor@example.com',
      }),
    );
    expect(
      (
        await drizzle(local.inbox)
          .select()
          .from(messages)
          .where(eq(messages.idempotencyKey, data.idempotencyKey))
      ).length,
    ).toBe(1);
    expect(
      (
        await app.request(
          request({ ...data, message: 'changed' }),
          undefined,
          env(),
        )
      ).status,
    ).toBe(409);
  });
  it('rejects origin, timing, honeypot, action and hostname mismatches', async () => {
    expect(
      (
        await app.request(
          request(input(), '192.0.2.1', 'https://evil.example'),
          undefined,
          env(),
        )
      ).status,
    ).toBe(403);
    for (const change of [
      { website: 'bot' },
      { startedAt: clock },
      { startedAt: clock + 10000 },
    ])
      expect(
        (
          await app.request(
            request({ ...input(), ...change }),
            undefined,
            env(),
          )
        ).status,
      ).toBe(400);
    const wrong = createContact(
      async () => ({
        success: true,
        hostname: 'evil.example',
        action: 'contact',
      }),
      () => clock,
    );
    expect(
      (await wrong.request(request(input(), '192.0.2.2'), undefined, env()))
        .status,
    ).toBe(400);
    const wrongAction = createContact(
      async () => ({ success: true, hostname: 'example.com', action: 'login' }),
      () => clock,
    );
    expect(
      (
        await wrongAction.request(
          request(input(), '192.0.2.3'),
          undefined,
          env(),
        )
      ).status,
    ).toBe(400);
  });
  it('caps parallel visitor submissions using atomic database counters', async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        app.request(request(input(), '192.0.2.10'), undefined, env()),
      ),
    );
    expect(results.filter((result) => result.status === 202)).toHaveLength(5);
    expect(results.filter((result) => result.status === 429)).toHaveLength(3);
  });
  it('keeps a failed notification visible and retries using the existing message', async () => {
    notification.mockRejectedValueOnce(new Error('Temporary delivery failure'));
    const data = input();
    await app.request(request(data, '192.0.2.20'), undefined, env());
    expect(
      (
        await drizzle(local.inbox)
          .select()
          .from(messages)
          .where(eq(messages.idempotencyKey, data.idempotencyKey))
      )[0]?.notificationStatus,
    ).toBe('failed');
    await app.request(request(data, '192.0.2.20'), undefined, env());
    expect(
      (
        await drizzle(local.inbox)
          .select()
          .from(messages)
          .where(eq(messages.idempotencyKey, data.idempotencyKey))
      )[0]?.notificationStatus,
    ).toBe('sent');
  });
  it('deletes expired contact data and expired rate counters', async () => {
    await purgeInbox(local.inbox, clock + 366 * 86400000);
    expect(await drizzle(local.inbox).select().from(messages)).toHaveLength(0);
    expect(await drizzle(local.inbox).select().from(rateLimits)).toHaveLength(
      0,
    );
  });
  it('checks the observed dummy response contract only in explicit spike mode', async () => {
    const dummyEnv = {
      ...env(),
      PUBLIC_ORIGIN: 'http://localhost:4321',
      TURNSTILE_MODE: 'spike' as const,
      TURNSTILE_HOSTNAME: 'example.com',
      TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
    };
    const dummy = createContact(
      async () => ({
        success: true,
        hostname: 'example.com',
        metadata: { result_with_testing_key: true },
      }),
      () => clock,
    );
    expect(
      (
        await dummy.request(
          request(input(), '192.0.2.30', dummyEnv.PUBLIC_ORIGIN),
          undefined,
          dummyEnv,
        )
      ).status,
    ).toBe(202);
    expect(
      (
        await dummy.request(
          request(input(), '192.0.2.31', dummyEnv.PUBLIC_ORIGIN),
          undefined,
          { ...dummyEnv, TURNSTILE_MODE: 'production' },
        )
      ).status,
    ).toBe(503);
    const wrong = createContact(
      async () => ({
        success: true,
        hostname: 'example.com',
        action: 'wrong',
        metadata: { result_with_testing_key: true },
      }),
      () => clock,
    );
    expect(
      (
        await wrong.request(
          request(input(), '192.0.2.32', dummyEnv.PUBLIC_ORIGIN),
          undefined,
          dummyEnv,
        )
      ).status,
    ).toBe(400);
  });
});
