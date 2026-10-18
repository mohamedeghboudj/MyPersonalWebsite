import { expect, it } from 'vitest';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { migrateTestDatabase } from '../scripts/local-database';
import {
  createPrivateCapture,
  publishCaptureKey,
} from '../apps/admin/src/publish-captures';
import { editorOverview, readPublishCapture } from '@platform/database';
import { publishCapturePolicy } from '@platform/config';

it('runs the real scheduled Worker export while HTTP maintenance stays behind owner authentication', async () => {
  const bundle = await build({
    entryPoints: ['apps/admin/src/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0]!.text,
      compatibilityDate: '2026-10-01',
      cronTriggers: [publishCapturePolicy.cleanupCron],
      // Enable Miniflare's local scheduler helper only in this test harness.
      unsafeTriggerHandlers: true,
      d1Databases: ['CONTENT', 'INBOX'],
      r2Buckets: ['MEDIA'],
      telemetry: { enabled: false },
      bindings: {
        APP_ENV: 'local',
        PUBLISH_MAINTENANCE_ENABLED: 'true',
        ACCESS_ISSUER: 'https://example.cloudflareaccess.com',
        ACCESS_AUDIENCE: 'synthetic-audience',
        OWNER_EMAIL: 'owner@example.com',
        ADMIN_ORIGIN: 'http://localhost:8787',
        PUBLIC_ORIGIN: 'http://localhost:4321',
      },
    }),
  );
  try {
    const content = (await runtime.getD1Database(
      'CONTENT',
    )) as unknown as D1Database;
    const inbox = (await runtime.getD1Database(
      'INBOX',
    )) as unknown as D1Database;
    const media = (await runtime.getR2Bucket('MEDIA')) as unknown as R2Bucket;
    await migrateTestDatabase(content, inbox);
    const row = await createPrivateCapture(
      content,
      media,
      {
        id: crypto.randomUUID(),
        purpose: 'preview',
        revision: (await editorOverview(content)).revision,
      },
      'synthetic-owner',
      () => new Date(Date.now() - publishCapturePolicy.retentionMs - 1000),
    );
    const response = await runtime.dispatchFetch(
      `http://localhost/cdn-cgi/local/scheduled?cron=${encodeURIComponent(publishCapturePolicy.cleanupCron)}&format=json`,
    );
    expect(response.status).toBe(200);
    expect((await readPublishCapture(content, row.id))!.status).toBe('expired');
    expect(await media.head(publishCaptureKey(row.id))).toBeNull();
    const direct = await runtime.getWorker();
    expect(
      (
        await direct.fetch('http://localhost/api/publishing/maintenance', {
          method: 'POST',
        })
      ).status,
    ).toBe(401);
    // The dev scheduler path is a local runtime helper, not an unauthenticated
    // route implemented by the deployed application.
    expect(
      (await direct.fetch('http://localhost/cdn-cgi/local/scheduled')).status,
    ).toBe(401);
  } finally {
    await runtime.dispose();
  }
});
