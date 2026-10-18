import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import {
  audit,
  messages,
  capturePublicSnapshot,
  editorOverview,
  publishCaptures,
  readCaptureCleanup,
  readPublishCapture,
} from '@platform/database';
import { publishCapturePolicy } from '@platform/config';
import { buildDiagnosticsKey } from '@platform/schema';
import {
  createPrivateCapture,
  expirePrivateCaptures,
  publishCaptureKey,
} from '../apps/admin/src/publish-captures';
import {
  maintainPrivateCaptures,
  scheduledCaptureMaintenance,
} from '../apps/admin/src/capture-maintenance';

let local: Awaited<ReturnType<typeof localDatabase>>;
let revision: number;
const created = new Date('2026-10-01T12:00:00.000Z');
const expired = new Date(created.getTime() + publishCapturePolicy.retentionMs);
beforeEach(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
  revision = (await editorOverview(local.content)).revision;
});
afterEach(async () => local?.runtime.dispose());
const capture = (time = created) =>
  createPrivateCapture(
    local.content,
    local.media,
    { id: crypto.randomUUID(), revision, purpose: 'preview' },
    'synthetic-owner',
    () => time,
  );
function storage(overrides: Partial<Pick<R2Bucket, 'list' | 'delete'>>) {
  return new Proxy(local.media, {
    get(target, key) {
      if (key in overrides) return overrides[key as keyof typeof overrides];
      const value = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

describe('scheduled private-input retention', () => {
  it('retains live diagnostic attempts, expires all exact report keys with the capture, and preserves unrelated objects', async () => {
    const row = await capture();
    const reports = [1, 2].map((attempt) =>
      buildDiagnosticsKey(row.id, { runId: 123, attempt }),
    );
    const malformed = reports[0]!.replace('.123.', '.0123.');
    for (const key of [...reports, malformed])
      await local.media.put(key, 'PRIVATE synthetic report');
    await maintainPrivateCaptures(
      local.content,
      local.media,
      new Date(expired.getTime() - 1),
    );
    for (const key of reports)
      expect(await local.media.head(key)).not.toBeNull();
    await maintainPrivateCaptures(local.content, local.media, expired);
    for (const key of reports) expect(await local.media.head(key)).toBeNull();
    expect(await local.media.head(malformed)).not.toBeNull();
    // A late report after the ledger was expired is removed on the next scan.
    await local.media.put(reports[0]!, 'late report');
    await maintainPrivateCaptures(local.content, local.media, expired);
    expect(await local.media.head(reports[0]!)).toBeNull();
  });
  it('ages untracked reports for a full retention interval without trusting arbitrary names', async () => {
    const key = buildDiagnosticsKey(crypto.randomUUID(), {
      runId: 123,
      attempt: 1,
    });
    await local.media.put(key, 'orphan report');
    await maintainPrivateCaptures(local.content, local.media, new Date());
    expect(await local.media.head(key)).not.toBeNull();
    await maintainPrivateCaptures(
      local.content,
      local.media,
      new Date(Date.now() + publishCapturePolicy.retentionMs + 1000),
    );
    expect(await local.media.head(key)).toBeNull();
  });
  it('expires idle captures at the TTL, retains history and leaves content, inbox and originals alone', async () => {
    const rows = [];
    for (let i = 0; i < 6; i++) rows.push(await capture());
    await local.media.put('originals/keep.jpg', 'private original');
    const before = await capturePublicSnapshot(local.content);
    const inboxBefore = await drizzle(local.inbox).select().from(messages);
    await maintainPrivateCaptures(
      local.content,
      local.media,
      new Date(expired.getTime() - 1),
    );
    expect(
      (await local.media.list({ prefix: 'publish-inputs/' })).objects,
    ).toHaveLength(6);
    await maintainPrivateCaptures(local.content, local.media, expired);
    const ledger = await drizzle(local.content).select().from(publishCaptures);
    expect(ledger).toHaveLength(6);
    expect(ledger.every((row) => row.status === 'expired')).toBe(true);
    expect(
      (await local.media.list({ prefix: 'publish-inputs/' })).objects,
    ).toHaveLength(0);
    expect(await (await local.media.get('originals/keep.jpg'))!.text()).toBe(
      'private original',
    );
    expect((await editorOverview(local.content)).revision).toBe(revision);
    expect(await drizzle(local.inbox).select().from(messages)).toEqual(
      inboxBefore,
    );
    const after = await capturePublicSnapshot(local.content);
    expect({ ...after, generatedAt: before.generatedAt }).toEqual(before);
    const events = await drizzle(local.content)
      .select()
      .from(audit)
      .where(eq(audit.action, 'publish.capture.expired'));
    expect(events).toHaveLength(6);
    expect(
      events.every((event) => event.actor === 'system:publish-retention'),
    ).toBe(true);
  });

  it('removes a late R2 write even after its reservation was already expired', async () => {
    const row = await capture();
    await expirePrivateCaptures(
      local.content,
      local.media,
      'synthetic-owner',
      expired,
    );
    await local.media.put(
      publishCaptureKey(row.id),
      'late write after the old request crashed',
    );
    expect((await readPublishCapture(local.content, row.id))!.status).toBe(
      'expired',
    );
    expect(
      await maintainPrivateCaptures(local.content, local.media, expired),
    ).toMatchObject({ removed: 1, advanced: true });
    expect(await local.media.get(publishCaptureKey(row.id))).toBeNull();
    const events = await drizzle(local.content)
      .select()
      .from(audit)
      .where(eq(audit.action, 'publish.capture.reconciled'));
    expect(events).toHaveLength(1);
    expect(JSON.stringify(events)).not.toContain(row.id);
  });

  it('ages only untracked canonical keys and trusts the ledger over old storage timestamps', async () => {
    const now = new Date(
      Date.now() + publishCapturePolicy.retentionMs + 3600000,
    );
    const active = await capture(new Date(now.getTime() - 3600000));
    const old = publishCaptureKey(crypto.randomUUID());
    const fresh = publishCaptureKey(crypto.randomUUID());
    const malformed = 'publish-inputs/not-a-capture.json';
    const outside = `originals/${crypto.randomUUID()}.json`;
    for (const key of [old, fresh, malformed, outside])
      await local.media.put(key, 'keep-or-remove');
    const bucket = storage({
      list: async (options) => {
        const result = await local.media.list(options);
        return {
          ...result,
          objects: result.objects.map((object) =>
            object.key === fresh
              ? new Proxy(object, {
                  get: (target, key) =>
                    key === 'uploaded' ? now : Reflect.get(target, key),
                })
              : object,
          ),
        };
      },
    });
    expect(
      await maintainPrivateCaptures(local.content, bucket, now),
    ).toMatchObject({ removed: 1 });
    expect(await local.media.get(old)).toBeNull();
    for (const key of [fresh, malformed, outside, publishCaptureKey(active.id)])
      expect(await local.media.head(key)).not.toBeNull();
    expect((await readPublishCapture(local.content, active.id))!.status).toBe(
      'ready',
    );
  });

  it('resumes bounded R2 pages after deletion and wraps to inspect late objects on the next scan', async () => {
    const now = new Date(Date.now() + publishCapturePolicy.retentionMs + 1000);
    for (let i = 0; i < 23; i++)
      await local.media.put(publishCaptureKey(crypto.randomUUID()), 'orphan');
    const first = await maintainPrivateCaptures(
      local.content,
      local.media,
      now,
    );
    expect(first).toEqual({ inspected: 20, removed: 20, advanced: true });
    expect((await readCaptureCleanup(local.content)).cursor).not.toBeNull();
    expect(
      await maintainPrivateCaptures(local.content, local.media, now),
    ).toEqual({ inspected: 3, removed: 3, advanced: true });
    expect((await readCaptureCleanup(local.content)).cursor).toBeNull();
    expect(
      await maintainPrivateCaptures(local.content, local.media, now),
    ).toEqual({ inspected: 0, removed: 0, advanced: true });
  });

  it('keeps the reservation and scan position when storage deletion fails, then retries', async () => {
    const row = await capture();
    const checkpoint = await readCaptureCleanup(local.content);
    const broken = storage({
      delete: async () => {
        throw new Error('PRIVATE STORAGE DETAILS');
      },
    });
    await expect(
      maintainPrivateCaptures(local.content, broken, expired),
    ).rejects.toThrow();
    expect((await readPublishCapture(local.content, row.id))!.status).toBe(
      'ready',
    );
    expect(await readCaptureCleanup(local.content)).toEqual(checkpoint);
    expect(await local.media.head(publishCaptureKey(row.id))).not.toBeNull();
    await maintainPrivateCaptures(local.content, local.media, expired);
    expect((await readPublishCapture(local.content, row.id))!.status).toBe(
      'expired',
    );
    expect(await local.media.head(publishCaptureKey(row.id))).toBeNull();
  });

  it('replays a failed database acknowledgement and resets an unusable continuation cursor', async () => {
    const now = new Date(Date.now() + publishCapturePolicy.retentionMs + 1000);
    await local.media.put(publishCaptureKey(crypto.randomUUID()), 'orphan');
    await local.content.exec(
      "CREATE TRIGGER fail_cleanup BEFORE UPDATE ON publish_capture_cleanup BEGIN SELECT RAISE(ABORT,'synthetic failed acknowledgement'); END;",
    );
    await expect(
      maintainPrivateCaptures(local.content, local.media, now),
    ).rejects.toThrow();
    expect((await readCaptureCleanup(local.content)).revision).toBe(0);
    expect(
      (await local.media.list({ prefix: 'publish-inputs/' })).objects,
    ).toHaveLength(0);
    await local.content.exec('DROP TRIGGER fail_cleanup;');
    await maintainPrivateCaptures(local.content, local.media, now);
    await local.content
      .prepare(
        "UPDATE publish_capture_cleanup SET cursor = 'stale-test-cursor' WHERE id = 1",
      )
      .run();
    const broken = storage({
      list: async () => {
        throw new Error('invalid cursor');
      },
    });
    await expect(
      maintainPrivateCaptures(local.content, broken, now),
    ).rejects.toThrow('listing unavailable');
    expect((await readCaptureCleanup(local.content)).cursor).toBeNull();
    expect(
      await maintainPrivateCaptures(local.content, local.media, now),
    ).toMatchObject({ advanced: true });
  });

  it('prevents overlapping scans from overwriting a newer checkpoint', async () => {
    const now = new Date(Date.now() + publishCapturePolicy.retentionMs + 1000);
    await local.media.put(publishCaptureKey(crypto.randomUUID()), 'orphan');
    let arrived = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bucket = storage({
      list: async (options) => {
        const result = await local.media.list(options);
        if (++arrived === 2) release();
        await barrier;
        return result;
      },
    });
    const results = await Promise.all([
      maintainPrivateCaptures(local.content, bucket, now),
      maintainPrivateCaptures(local.content, bucket, now),
    ]);
    expect(results.filter((result) => result.advanced)).toHaveLength(1);
    expect((await readCaptureCleanup(local.content)).revision).toBe(1);
    expect(
      await drizzle(local.content)
        .select()
        .from(audit)
        .where(eq(audit.action, 'publish.capture.reconciled')),
    ).toHaveLength(1);
  });

  it('gates scheduled work and exposes only a fixed error without storage details', async () => {
    const env = {
      CONTENT: local.content,
      MEDIA: local.media,
      APP_ENV: 'preview',
    };
    const event = { cron: publishCapturePolicy.cleanupCron };
    const enabled = { ...env, PUBLISH_MAINTENANCE_ENABLED: 'true' };
    const row = await capture();
    await scheduledCaptureMaintenance(event, env);
    await scheduledCaptureMaintenance({ cron: '* * * * *' }, enabled);
    expect((await readPublishCapture(local.content, row.id))!.status).toBe(
      'ready',
    );
    await expect(
      scheduledCaptureMaintenance(event, { ...enabled, APP_ENV: 'spike' }),
    ).rejects.toThrow(
      'Private capture maintenance failed; the next scheduled run will retry.',
    );
    await expect(
      scheduledCaptureMaintenance(event, {
        ...enabled,
        MEDIA: storage({
          delete: async () => {
            throw new Error('PRIVATE SECRET DETAILS');
          },
        }),
      }),
    ).rejects.toThrow(
      /^Private capture maintenance failed; the next scheduled run will retry\.$/,
    );
    await scheduledCaptureMaintenance(event, enabled);
    expect((await readPublishCapture(local.content, row.id))!.status).toBe(
      'expired',
    );
  });
});
