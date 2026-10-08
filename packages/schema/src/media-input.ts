import { z } from 'zod';
import { locales } from './locales.ts';
export const maxUploadBytes = 8 * 1024 * 1024;
export const mediaUploadSchema = z
  .object({
    revision: z.coerce.number().int().nonnegative(),
    locale: z.enum(locales),
    altText: z
      .string()
      .trim()
      .min(1)
      .max(240)
      .refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
  })
  .strict();
export const mediaMimeSchema = z.enum([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'application/pdf',
]);
