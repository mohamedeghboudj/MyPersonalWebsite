import { expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import manifest from '../environments.example.json';
import {
  createWranglerConfigs,
  deploymentSetSchema,
  assertRemoteResourcesConfigured,
} from '../packages/config/src/deployment';
import {
  adminDocumentHeaders,
  publicDocumentHeaders,
  renderPublicHeaders,
  adminEnvSchema,
  contactEnvSchema,
  dummyTurnstile,
} from '@platform/config';

it('isolates all six databases and keeps contact and public bindings minimal', () => {
  const validated = deploymentSetSchema.parse(manifest);
  for (const name of ['local', 'preview', 'production'] as const) {
    const config = createWranglerConfigs(validated, name);
    expect(config.admin.d1_databases.map((db) => db.binding)).toEqual([
      'CONTENT',
      'INBOX',
    ]);
    expect(config.contact.d1_databases.map((db) => db.binding)).toEqual([
      'INBOX',
    ]);
    expect(config.contact.d1_databases[0]?.database_id).toBe(
      config.admin.d1_databases[1]?.database_id,
    );
    expect(config.site).not.toHaveProperty('d1_databases');
    expect(config.site).not.toHaveProperty('main');
    expect(config.admin.assets.run_worker_first).toBe(true);
    expect(config.admin.preview_urls).toBe(false);
    expect(config.admin.workers_dev).toBe(false);
  }
  const invalid = structuredClone(validated);
  invalid.preview.inbox.id = invalid.production.content.id;
  expect(deploymentSetSchema.safeParse(invalid).success).toBe(false);
  const sameOrigin = structuredClone(validated);
  sameOrigin.preview.admin.origin = sameOrigin.preview.site.origin;
  expect(deploymentSetSchema.safeParse(sameOrigin).success).toBe(false);
  expect(() =>
    assertRemoteResourcesConfigured(validated, 'production'),
  ).toThrow('Replace example');
});

it('fails closed on remote origin mistakes and dummy Turnstile outside the spike', () => {
  const admin = {
    APP_ENV: 'production',
    ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
    ACCESS_AUDIENCE: 'test-audience-0001',
    OWNER_EMAIL: 'owner@example.com',
    ADMIN_ORIGIN: 'https://admin.example.com',
    PUBLIC_ORIGIN: 'https://example.com',
  };
  expect(adminEnvSchema.safeParse(admin).success).toBe(true);
  expect(
    adminEnvSchema.safeParse({ ...admin, PUBLIC_ORIGIN: admin.ADMIN_ORIGIN })
      .success,
  ).toBe(false);
  expect(
    adminEnvSchema.safeParse({
      ...admin,
      ADMIN_ORIGIN: 'http://localhost:8787',
    }).success,
  ).toBe(false);
  const contact = {
    APP_ENV: 'production',
    PUBLIC_ORIGIN: 'http://localhost:4321',
    TURNSTILE_MODE: 'spike',
    TURNSTILE_SECRET: dummyTurnstile.secret,
    TURNSTILE_HOSTNAME: dummyTurnstile.hostname,
    RATE_LIMIT_SALT: 'test-salt-000000000000000000000000',
    NOTIFICATION_FROM: 'sender@example.com',
    NOTIFICATION_TO: 'owner@example.com',
  };
  expect(contactEnvSchema.safeParse(contact).success).toBe(false);
  expect(
    contactEnvSchema.safeParse({ ...contact, APP_ENV: 'local' }).success,
  ).toBe(true);
});

it('serves strict separate document policies and detects generated header drift', async () => {
  for (const policy of [adminDocumentHeaders, publicDocumentHeaders]) {
    expect(policy['Content-Security-Policy']).not.toMatch(
      /unsafe-inline|unsafe-eval|https:\/\/\*/u,
    );
    expect(policy['Content-Security-Policy']).toContain(
      "frame-ancestors 'none'",
    );
    expect(policy['Content-Security-Policy']).toContain("style-src 'self'");
  }
  expect(adminDocumentHeaders['Cache-Control']).toBe('no-store');
  expect(await readFile('apps/site/public/_headers', 'utf8')).toBe(
    renderPublicHeaders(),
  );
  const admin = JSON.parse(
    await readFile('apps/admin/wrangler.json', 'utf8'),
  ) as { assets: { run_worker_first: boolean } };
  expect(admin.assets.run_worker_first).toBe(true);
});

it('keeps text and focus token colors legible on both foundation surfaces', async () => {
  const css = await readFile('packages/ui/src/tokens.css', 'utf8');
  const colors = new Map(
    [...css.matchAll(/--color-([a-z-]+): (#[a-f0-9]{6});/gu)].map((match) => [
      match[1],
      match[2],
    ]),
  );
  const luminance = (hex: string) => {
    const [red = 0, green = 0, blue = 0] = [1, 3, 5]
      .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
      .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };
  const contrast = (a: string, b: string) => {
    const x = luminance(colors.get(a) ?? '');
    const y = luminance(colors.get(b) ?? '');
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  for (const background of ['surface', 'canvas']) {
    for (const text of ['ink', 'muted', 'accent'])
      expect(
        contrast(text, background),
        `${text}/${background}`,
      ).toBeGreaterThanOrEqual(4.5);
    expect(contrast('control', background)).toBeGreaterThanOrEqual(3);
  }
});
