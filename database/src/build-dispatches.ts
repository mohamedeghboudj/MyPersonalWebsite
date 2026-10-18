import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray } from 'drizzle-orm';
import { buildDispatchStates, buildDispatchSchema } from '@platform/schema';
import { publishCaptures } from './publish-captures.ts';

export const buildDispatches = sqliteTable('build_dispatches', {
  captureId: text('capture_id')
    .primaryKey()
    .references(() => publishCaptures.id),
  status: text('status', { enum: buildDispatchStates })
    .notNull()
    .default('dispatching'),
  runId: integer('run_id').unique(),
  requestedAt: text('requested_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  requestedBy: text('requested_by').notNull(),
  updatedBy: text('updated_by').notNull(),
});
export const dispatchSummary = (row: typeof buildDispatches.$inferSelect) =>
  buildDispatchSchema.strip().parse(row);
export async function readBuildDispatch(binding: D1Database, id: string) {
  return drizzle(binding)
    .select()
    .from(buildDispatches)
    .where(eq(buildDispatches.captureId, id))
    .get();
}
export async function reserveBuildDispatch(
  binding: D1Database,
  id: string,
  actor: string,
  now: string,
) {
  const [row] = await drizzle(binding)
    .insert(buildDispatches)
    .values({
      captureId: id,
      requestedAt: now,
      updatedAt: now,
      requestedBy: actor,
      updatedBy: actor,
    })
    .returning();
  if (!row) throw new Error('Dispatch reservation failed');
  return row;
}
export async function finishBuildDispatch(
  binding: D1Database,
  id: string,
  status: 'queued' | 'uncertain' | 'rejected',
  runId: number | null,
  actor: string,
  now: string,
) {
  const [row] = await drizzle(binding)
    .update(buildDispatches)
    .set({ status, runId, updatedBy: actor, updatedAt: now })
    .where(
      and(
        eq(buildDispatches.captureId, id),
        inArray(
          buildDispatches.status,
          status === 'queued' ? ['dispatching', 'uncertain'] : ['dispatching'],
        ),
      ),
    )
    .returning();
  return row ?? (await readBuildDispatch(binding, id));
}
