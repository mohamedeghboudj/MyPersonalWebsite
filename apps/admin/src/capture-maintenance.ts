import {
  advanceCaptureCleanup,
  captureCleanupCandidates,
  markPublishCapturesExpired,
  readCaptureCleanup,
} from '@platform/database';
import { publishCaptureRequestSchema } from '@platform/schema';
import {
  publishCapturePolicy,
  publishMaintenanceEnvSchema,
} from '@platform/config';
import { expirePrivateCaptures } from './publish-captures.ts';

const actor = 'system:publish-retention';
function captureId(key: string) {
  const match = /^publish-inputs\/([^/]+)\.json$/u.exec(key);
  if (!match) return null;
  const parsed = publishCaptureRequestSchema.shape.id.safeParse(match[1]);
  // Only exact canonical keys belong to this service. Leave unrelated objects alone.
  return parsed.success && key === `publish-inputs/${parsed.data}.json`
    ? parsed.data
    : null;
}

export async function maintainPrivateCaptures(
  binding: D1Database,
  bucket: R2Bucket,
  now = new Date(),
) {
  const timestamp = now.toISOString();
  await expirePrivateCaptures(binding, bucket, actor, now);
  const checkpoint = await readCaptureCleanup(binding);
  let page: R2Objects;
  try {
    page = await bucket.list({
      prefix: 'publish-inputs/',
      limit: publishCapturePolicy.reconcilePageSize,
      ...(checkpoint.cursor ? { cursor: checkpoint.cursor } : {}),
      include: [],
    });
  } catch {
    // A stale opaque cursor must not wedge retention forever. A transient
    // failure may also restart the scan; replay is safe and never deletes live inputs.
    if (checkpoint.cursor)
      await advanceCaptureCleanup(
        binding,
        checkpoint.revision,
        null,
        0,
        timestamp,
      );
    throw new Error('Private capture listing unavailable');
  }
  if (
    page.objects.length > publishCapturePolicy.reconcilePageSize ||
    (page.truncated && (!page.cursor || page.cursor.length > 4096))
  )
    throw new Error('Invalid private capture listing');
  const objects = page.objects.flatMap((object) => {
    const id = captureId(object.key);
    return id ? [{ id, object }] : [];
  });
  const rows = await captureCleanupCandidates(
    binding,
    objects.map(({ id }) => id),
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const removable = objects.filter(({ id, object }) => {
    const row = byId.get(id);
    // The ledger is authoritative, even if storage metadata suggests an older
    // upload. Untracked keys receive a full retention interval before removal.
    return row
      ? row.expiresAt <= timestamp
      : object.uploaded.getTime() <=
          now.getTime() - publishCapturePolicy.retentionMs;
  });
  if (removable.length) {
    await bucket.delete(removable.map(({ object }) => object.key));
    await markPublishCapturesExpired(
      binding,
      removable.filter(({ id }) => byId.has(id)).map(({ id }) => id),
      actor,
      timestamp,
    );
  }
  // Never advance past a failed deletion or database acknowledgement. A crash
  // after deletion simply replays an idempotent page. Concurrent scans use CAS.
  const advanced = await advanceCaptureCleanup(
    binding,
    checkpoint.revision,
    page.truncated ? page.cursor : null,
    removable.length,
    timestamp,
  );
  return {
    inspected: page.objects.length,
    removed: removable.length,
    advanced,
  };
}

type MaintenanceBindings = {
  CONTENT: D1Database;
  MEDIA?: R2Bucket;
  APP_ENV?: string;
  PUBLISH_MAINTENANCE_ENABLED?: string;
};
export async function scheduledCaptureMaintenance(
  event: Pick<ScheduledController, 'cron'>,
  env: MaintenanceBindings,
) {
  if (
    event.cron !== publishCapturePolicy.cleanupCron ||
    env.PUBLISH_MAINTENANCE_ENABLED !== 'true'
  )
    return;
  try {
    publishMaintenanceEnvSchema.parse(env);
    if (!env.MEDIA) throw new Error('Private storage binding missing');
    await maintainPrivateCaptures(env.CONTENT, env.MEDIA);
  } catch {
    // Let the platform record failure, without logging storage keys or raw errors.
    throw new Error(
      'Private capture maintenance failed; the next scheduled run will retry.',
    );
  }
}
