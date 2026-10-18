import { z } from 'zod';
export const publicationStates = [
  'queued',
  'published',
  'failed',
  'expired',
  'superseded',
] as const;
export const publicationSchema = z
  .object({
    captureId: z.uuid(),
    status: z.enum(publicationStates),
    requestedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Publication = z.infer<typeof publicationSchema>;
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const publicReleaseReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    captureId: z.uuid(),
    revision: z.number().int().nonnegative(),
    snapshotSha256: digest,
    capturedAt: z.iso.datetime(),
    cvs: z.object({ en: digest, fr: digest, ar: digest }).strict(),
  })
  .strict();
