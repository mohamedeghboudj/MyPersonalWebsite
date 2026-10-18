import { sqliteTable, text, index } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, asc } from 'drizzle-orm';
import { publicationSchema, publicationStates } from '@platform/schema';
import { publishCaptures } from './publish-captures.ts';

export const publications = sqliteTable(
  'publications',
  {
    captureId: text('capture_id')
      .primaryKey()
      .references(() => publishCaptures.id),
    status: text('status', { enum: publicationStates })
      .notNull()
      .default('queued'),
    requestedAt: text('requested_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    requestedBy: text('requested_by').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => [
    index('publications_pending').on(table.status, table.requestedAt),
  ],
);
export const publicationSummary = (row: typeof publications.$inferSelect) =>
  publicationSchema.strip().parse(row);
export const readPublication = (binding: D1Database, id: string) =>
  drizzle(binding)
    .select()
    .from(publications)
    .where(eq(publications.captureId, id))
    .get();
export async function requestPublication(
  binding: D1Database,
  id: string,
  actor: string,
  now: string,
) {
  const existing = await readPublication(binding, id);
  if (existing) return publicationSummary(existing);
  await drizzle(binding)
    .insert(publications)
    .values({
      captureId: id,
      requestedAt: now,
      updatedAt: now,
      requestedBy: actor,
      updatedBy: actor,
    })
    .onConflictDoNothing();
  return publicationSummary((await readPublication(binding, id))!);
}
export const nextPublication = (binding: D1Database) =>
  drizzle(binding)
    .select()
    .from(publications)
    .where(eq(publications.status, 'queued'))
    .orderBy(asc(publications.requestedAt), asc(publications.captureId))
    .limit(1)
    .get();
export async function finishPublication(
  binding: D1Database,
  id: string,
  status: Exclude<(typeof publicationStates)[number], 'queued'>,
  now: string,
) {
  await drizzle(binding)
    .update(publications)
    .set({ status, updatedAt: now, updatedBy: 'system:publish' })
    .where(
      and(eq(publications.captureId, id), eq(publications.status, 'queued')),
    );
}
