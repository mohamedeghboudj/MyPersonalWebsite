import { z } from 'zod';
import { publishCaptureSummarySchema } from './publish-capture.ts';

// Dispatch carries metadata only. The unpublished snapshot stays in private R2.
export const capturedBuildSchema = publishCaptureSummarySchema
  .pick({
    id: true,
    purpose: true,
    environment: true,
    sequence: true,
    revision: true,
    inputSha256: true,
    snapshotSha256: true,
    byteSize: true,
    createdAt: true,
    expiresAt: true,
  })
  .extend({ schemaVersion: z.literal(1) })
  .strict();
export type CapturedBuild = z.infer<typeof capturedBuildSchema>;
export const buildDispatchStates = [
  'dispatching',
  'queued',
  'uncertain',
  'rejected',
] as const;
export const buildDispatchSchema = z
  .object({
    captureId: z.uuid(),
    status: z.enum(buildDispatchStates),
    runId: z.number().int().positive().nullable(),
    requestedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
