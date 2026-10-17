import {
  sqliteTable,
  text,
  integer,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray } from 'drizzle-orm';
import {
  previewDeploymentStates,
  previewDeploymentSchema,
} from '@platform/schema';
import { publishCaptures } from './publish-captures.ts';
import { buildDispatches } from './build-dispatches.ts';

export const previewDeployments = sqliteTable(
  'preview_deployments',
  {
    captureId: text('capture_id')
      .primaryKey()
      .references(() => publishCaptures.id),
    target: text('target', { enum: ['preview'] })
      .notNull()
      .default('preview'),
    versionId: text('version_id').notNull().unique(),
    previousVersionId: text('previous_version_id').notNull(),
    runId: integer('run_id')
      .notNull()
      .references(() => buildDispatches.runId),
    bundleSha256: text('bundle_sha256').notNull(),
    status: text('status', { enum: previewDeploymentStates })
      .notNull()
      .default('activating'),
    deploymentId: text('deployment_id').unique(),
    requestedAt: text('requested_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    requestedBy: text('requested_by').notNull(),
    updatedBy: text('updated_by').notNull(),
  },
  (table) => [
    uniqueIndex('preview_deployment_fence')
      .on(table.target)
      .where(inArray(table.status, ['activating', 'uncertain'])),
    index('preview_deployments_run_id').on(table.runId),
  ],
);
export const previewDeploymentSummary = (
  row: typeof previewDeployments.$inferSelect,
) => previewDeploymentSchema.strip().parse(row);
export async function readPreviewDeployment(binding: D1Database, id: string) {
  return drizzle(binding)
    .select()
    .from(previewDeployments)
    .where(eq(previewDeployments.captureId, id))
    .get();
}
export async function readPreviewFence(binding: D1Database) {
  return drizzle(binding)
    .select()
    .from(previewDeployments)
    .where(inArray(previewDeployments.status, ['activating', 'uncertain']))
    .get();
}
export async function reservePreviewDeployment(
  binding: D1Database,
  record: typeof previewDeployments.$inferInsert,
) {
  const [row] = await drizzle(binding)
    .insert(previewDeployments)
    .values(record)
    .returning();
  if (!row) throw new Error('Preview reservation failed');
  return row;
}
export async function finishPreviewDeployment(
  binding: D1Database,
  id: string,
  status: 'uncertain' | 'deployed' | 'rejected',
  deploymentId: string | null,
  actor: string,
  now: string,
) {
  const [row] = await drizzle(binding)
    .update(previewDeployments)
    .set({ status, deploymentId, updatedBy: actor, updatedAt: now })
    .where(
      and(
        eq(previewDeployments.captureId, id),
        inArray(
          previewDeployments.status,
          status === 'deployed' ? ['activating', 'uncertain'] : ['activating'],
        ),
      ),
    )
    .returning();
  return row ?? (await readPreviewDeployment(binding, id));
}
