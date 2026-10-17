import { z } from 'zod';
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const dimension = z.number().int().positive().max(1600);
export const staticMediaManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshotSha256: digest,
    images: z.record(
      z.string().regex(/^[1-9][0-9]*$/u),
      z
        .object({
          sourceSha256: digest,
          social: z
            .object({
              url: z.string().regex(/^\/media\/[a-f0-9]{64}\.jpg$/u),
              width: dimension,
              height: dimension,
              byteSize: z
                .number()
                .int()
                .positive()
                .max(2 * 1024 * 1024),
            })
            .strict(),
          variants: z
            .array(
              z
                .object({
                  url: z
                    .string()
                    .regex(/^\/media\/[a-f0-9]{64}\.(?:avif|webp)$/u),
                  format: z.enum(['avif', 'webp']),
                  width: dimension,
                  height: dimension,
                  byteSize: z
                    .number()
                    .int()
                    .positive()
                    .max(2 * 1024 * 1024),
                })
                .strict()
                .refine((value) => value.url.endsWith(`.${value.format}`)),
            )
            .min(2)
            .max(6)
            .refine((variants) =>
              ['avif', 'webp'].every((format) =>
                variants.some((variant) => variant.format === format),
              ),
            ),
        })
        .strict(),
    ),
    documents: z.record(
      z.string().regex(/^[1-9][0-9]*$/u),
      z
        .object({
          url: z.string().regex(/^\/documents\/[a-f0-9]{64}\.pdf$/u),
          sha256: digest,
          byteSize: z
            .number()
            .int()
            .positive()
            .max(8 * 1024 * 1024),
        })
        .strict(),
    ),
  })
  .strict();
export type StaticMediaManifest = z.infer<typeof staticMediaManifestSchema>;
