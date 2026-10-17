import { sqliteTable, integer, text, index } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/d1';
import { and, desc, eq, lte, ne, asc, inArray, gt } from 'drizzle-orm';
import {
  publishCaptureSummarySchema,
  publishCaptureStatuses,
  publishCaptureFailures,
} from '@platform/schema';
import { publishCapturePolicy } from '@platform/config';

export const publishCaptures = sqliteTable(
  'publish_captures',
  {
    sequence: integer('sequence').primaryKey({ autoIncrement: true }),
    id: text('id').notNull().unique(),
    purpose: text('purpose', { enum: ['preview', 'publish'] }).notNull(),
    revision: integer('revision').notNull(),
    status: text('status', { enum: publishCaptureStatuses })
      .notNull()
      .default('capturing'),
    inputSha256: text('input_sha256').notNull(),
    snapshotSha256: text('snapshot_sha256').notNull(),
    byteSize: integer('byte_size').notNull(),
    createdAt: text('created_at').notNull(),
    expiresAt: text('expires_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    failureCode: text('failure_code', {
      enum: publishCaptureFailures,
    }),
  },
  (table) => [
    index('publish_captures_expiry').on(table.status, table.expiresAt),
  ],
);

export class PublishCaptureError extends Error {
  readonly status: 400 | 404 | 409 | 410 | 413 | 503;
  constructor(message: string, status: 400 | 404 | 409 | 410 | 413 | 503) {
    super(message);
    this.status = status;
  }
}
export async function readPublishCapture(binding: D1Database, id: string) {
  return drizzle(binding)
    .select()
    .from(publishCaptures)
    .where(eq(publishCaptures.id, id))
    .get();
}
export function captureSummary(row: typeof publishCaptures.$inferSelect) {
  // The response schema is the allowlist; storage/actor columns are internal.
  return publishCaptureSummarySchema.strip().parse(row);
}
export async function listPublishCaptures(binding: D1Database) {
  return (
    await drizzle(binding)
      .select()
      .from(publishCaptures)
      .orderBy(desc(publishCaptures.sequence))
      .limit(20)
  ).map(captureSummary);
}
export async function reservePublishCapture(
  binding: D1Database,
  record: typeof publishCaptures.$inferInsert,
) {
  try {
    const [row] = await drizzle(binding)
      .insert(publishCaptures)
      .values(record)
      .returning();
    if (!row) throw new Error('Capture insert returned no record');
    return row;
  } catch (error) {
    // D1 guards and audit triggers execute atomically with the insert. A raced
    // idempotency key is resolved by the service, never by a duplicate insert.
    const message =
      String(error) + String((error as { cause?: unknown }).cause ?? '');
    if (message.includes('Publish revision conflict'))
      throw new PublishCaptureError(
        'A newer edit exists. Reload before preparing a publish.',
        409,
      );
    if (message.includes('Publish capture storage budget'))
      throw new PublishCaptureError(
        'Private capture storage is full. Let older captures expire before creating another.',
        413,
      );
    throw error;
  }
}
export async function transitionPublishCapture(
  binding: D1Database,
  id: string,
  from: typeof publishCaptures.$inferSelect.status,
  status: typeof publishCaptures.$inferSelect.status,
  actor: string,
  now: string,
  failureCode: typeof publishCaptures.$inferSelect.failureCode = null,
) {
  const [row] = await drizzle(binding)
    .update(publishCaptures)
    .set({ status, updatedAt: now, updatedBy: actor, failureCode })
    .where(
      and(
        eq(publishCaptures.id, id),
        eq(publishCaptures.status, from),
        status === 'ready' ? gt(publishCaptures.expiresAt, now) : undefined,
      ),
    )
    .returning();
  return row ?? (await readPublishCapture(binding, id));
}
export async function expiredPublishCaptures(binding: D1Database, now: string) {
  return drizzle(binding)
    .select()
    .from(publishCaptures)
    .where(
      and(
        ne(publishCaptures.status, 'expired'),
        lte(publishCaptures.expiresAt, now),
      ),
    )
    .orderBy(asc(publishCaptures.expiresAt))
    .limit(publishCapturePolicy.cleanupBatchSize);
}
export async function markPublishCapturesExpired(
  binding: D1Database,
  ids: string[],
  actor: string,
  now: string,
) {
  if (!ids.length) return;
  await drizzle(binding)
    .update(publishCaptures)
    .set({
      status: 'expired',
      updatedAt: now,
      updatedBy: actor,
      failureCode: null,
    })
    .where(
      and(
        inArray(publishCaptures.id, ids),
        ne(publishCaptures.status, 'expired'),
        lte(publishCaptures.expiresAt, now),
      ),
    );
}
