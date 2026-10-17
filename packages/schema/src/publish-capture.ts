import { z } from 'zod';

export const publishCaptureRequestSchema = z
  .object({
    id: z.uuid().transform((value) => value.toLowerCase()),
    revision: z.number().int().nonnegative(),
    purpose: z.enum(['preview', 'publish']),
  })
  .strict();
export type PublishCaptureRequest = z.infer<typeof publishCaptureRequestSchema>;
export const publishCaptureStatuses = [
  'capturing',
  'ready',
  'failed',
  'expired',
] as const;
export const publishCaptureStatusSchema = z.enum(publishCaptureStatuses);
export const publishCaptureFailures = ['interrupted', 'integrity'] as const;
export const publishCaptureFailureSchema = z.enum(publishCaptureFailures);
export const publishCaptureSummarySchema = publishCaptureRequestSchema
  .extend({
    sequence: z.number().int().positive(),
    status: publishCaptureStatusSchema,
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    snapshotSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    byteSize: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
    failureCode: publishCaptureFailureSchema.nullable(),
  })
  .strict();
export type PublishCaptureSummary = z.infer<typeof publishCaptureSummarySchema>;
