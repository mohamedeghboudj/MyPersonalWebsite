import { sqliteTable, integer, text } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray } from 'drizzle-orm';
import { publishCaptures } from './publish-captures.ts';
import { publishCapturePolicy } from '@platform/config';

export const captureCleanup = sqliteTable('publish_capture_cleanup', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull().default(0),
  cursor: text('cursor'),
  updatedAt: text('updated_at'),
  deletedCount: integer('deleted_count').notNull().default(0),
});
export async function readCaptureCleanup(binding: D1Database) {
  const row = await drizzle(binding)
    .select()
    .from(captureCleanup)
    .where(eq(captureCleanup.id, 1))
    .get();
  if (!row) throw new Error('Capture maintenance migration is missing');
  return row;
}
export async function captureCleanupCandidates(
  binding: D1Database,
  ids: string[],
) {
  if (ids.length > publishCapturePolicy.reconcilePageSize)
    throw new Error('Capture reconciliation exceeds its bound');
  if (!ids.length) return [];
  return drizzle(binding)
    .select({ id: publishCaptures.id, expiresAt: publishCaptures.expiresAt })
    .from(publishCaptures)
    .where(inArray(publishCaptures.id, ids));
}
export async function advanceCaptureCleanup(
  binding: D1Database,
  revision: number,
  cursor: string | null,
  deletedCount: number,
  now: string,
) {
  const rows = await drizzle(binding)
    .update(captureCleanup)
    .set({ revision: revision + 1, cursor, deletedCount, updatedAt: now })
    .where(and(eq(captureCleanup.id, 1), eq(captureCleanup.revision, revision)))
    .returning({ id: captureCleanup.id });
  return rows.length === 1;
}
