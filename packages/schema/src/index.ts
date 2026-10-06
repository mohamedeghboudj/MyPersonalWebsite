import { z } from 'zod';

export const locales = ['en', 'fr', 'ar'] as const;
export const localeSchema = z.enum(locales);
export type Locale = z.infer<typeof localeSchema>;
export const contentKinds = [
  'education',
  'experience',
  'achievement',
  'certificate',
  'initiative',
  'skill',
  'project',
  'language',
] as const;
export const contentKindSchema = z.enum(contentKinds);
const plain = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
      'Control characters are not allowed',
    );
const oneLine = (max: number) =>
  plain(max).refine((value) => !/[\r\n]/u.test(value), 'Use one line');
export const webUrlSchema = z
  .url()
  .refine(
    (value) => ['http:', 'https:'].includes(new URL(value).protocol),
    'HTTP(S) required',
  );
export const educationTranslationSchema = z
  .object({
    locale: localeSchema,
    school: oneLine(180),
    degree: oneLine(180),
    description: plain(3000),
  })
  .strict();
const date = z.iso.date();
export const educationInputSchema = z
  .object({
    startDate: date,
    endDate: date.nullable(),
    schoolUrl: webUrlSchema.nullable(),
    isVisible: z.boolean(),
    displayOrder: z.number().int().min(0).max(10000),
    translations: z.array(educationTranslationSchema).min(1).max(3),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.translations.map((row) => row.locale)).size !==
      value.translations.length
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Duplicate locale',
        path: ['translations'],
      });
    }
    if (value.endDate && value.endDate < value.startDate) {
      context.addIssue({
        code: 'custom',
        message: 'End date precedes start date',
        path: ['endDate'],
      });
    }
  });
export const profileSchema = z
  .object({
    fullName: oneLine(180),
    translations: z
      .array(
        z.object({ locale: localeSchema, headline: oneLine(240) }).strict(),
      )
      .min(1)
      .max(3),
  })
  .strict()
  .refine(
    (value) =>
      new Set(value.translations.map((row) => row.locale)).size ===
      value.translations.length,
    'Duplicate locale',
  );
export const publicEducationSchema = z
  .object({
    id: z.number().int().positive(),
    startDate: date,
    endDate: date.nullable(),
    schoolUrl: webUrlSchema.nullable(),
    displayOrder: z.number().int(),
    translations: z.array(educationTranslationSchema),
  })
  .strict();
export const snapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    revision: z.number().int().nonnegative(),
    generatedAt: z.iso.datetime(),
    profile: profileSchema,
    education: z.array(publicEducationSchema),
    publicVariant: z
      .object({
        id: z.number().int().positive(),
        translations: z
          .array(
            z
              .object({
                locale: localeSchema,
                summary: plain(2000),
                profileHeading: oneLine(80).default('Profile'),
                educationHeading: oneLine(80).default('Education'),
                presentLabel: oneLine(40).default('Present'),
              })
              .strict(),
          )
          .min(1),
        items: z.array(
          z
            .object({
              contentItemId: z.number().int().positive(),
              position: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();
export type Snapshot = z.infer<typeof snapshotSchema>;
export type EducationInput = z.infer<typeof educationInputSchema>;

export const cvTargetSchema = z
  .object({ company: oneLine(180), role: oneLine(180) })
  .strict();
export const contactSchema = z
  .object({
    name: oneLine(100),
    email: z
      .email()
      .max(254)
      .refine((value) => !/[\r\n]/u.test(value)),
    message: plain(5000),
    website: z.string().max(200),
    startedAt: z.number().int().positive(),
    idempotencyKey: z.uuid(),
    turnstileToken: z.string().min(1).max(2048),
  })
  .strict();
export type ContactInput = z.infer<typeof contactSchema>;

// The spike implements one real content type; extend this registry in phase 2.
export const contentRegistry = {
  education: { input: educationInputSchema, public: publicEducationSchema },
} as const;
