import { z } from 'zod';
import { publicSnapshotSchema } from './public-snapshot.ts';

// Private build input, never a public asset or an Actions artifact. Storage
// keys are separate from the public snapshot consumed by Astro and the CV.
export const publishInputSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshot: publicSnapshotSchema,
    mediaSources: z.array(
      z
        .object({
          id: z.number().int().positive(),
          r2Key: z
            .string()
            .min(1)
            .max(1024)
            .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
        })
        .strict(),
    ),
  })
  .strict()
  .superRefine((value, context) => {
    const expected = new Set(value.snapshot.media.map((item) => item.id));
    const ids = new Set(value.mediaSources.map((item) => item.id));
    const keys = new Set(value.mediaSources.map((item) => item.r2Key));
    if (
      expected.size !== value.snapshot.media.length ||
      ids.size !== value.mediaSources.length ||
      keys.size !== ids.size ||
      ids.size !== expected.size ||
      [...ids].some((id) => !expected.has(id))
    )
      context.addIssue({
        code: 'custom',
        message: 'Publish sources must match eligible snapshot media exactly',
      });
  });
export type PublishInput = z.infer<typeof publishInputSchema>;
