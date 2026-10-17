import { z } from 'zod';
import { capturedBuildSchema } from './publish-build.ts';

export const previewReleaseSchema = capturedBuildSchema
  .pick({
    id: true,
    sequence: true,
    revision: true,
    snapshotSha256: true,
  })
  .extend({
    schemaVersion: z.literal(1),
    bundleSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  })
  .strict();
export type PreviewRelease = z.infer<typeof previewReleaseSchema>;
export const previewBundleSchema = z
  .object({
    schemaVersion: z.literal(1),
    capture: capturedBuildSchema,
    release: previewReleaseSchema,
    files: z
      .array(
        z
          .object({
            path: z
              .string()
              .min(1)
              .max(300)
              .regex(/^[a-zA-Z0-9_/-]+(?:\.[a-zA-Z0-9_-]+)*$/u)
              .refine(
                (value) =>
                  !value.startsWith('/') &&
                  !value
                    .split('/')
                    .some((part) => !part || part === '.' || part === '..'),
              ),
            sha256: z.string().regex(/^[a-f0-9]{64}$/u),
            bytes: z
              .number()
              .int()
              .nonnegative()
              .max(25 * 1024 * 1024),
          })
          .strict(),
      )
      .min(1)
      .max(2000),
  })
  .strict();
