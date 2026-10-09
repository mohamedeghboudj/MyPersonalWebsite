import { z } from 'zod';
import { locales } from './locales.ts';
import { siteCopyKeys } from './site-copy.ts';

// The publishing contract deliberately does not derive fields from editor
// records or database columns. New private fields cannot become public by
// adding them to a form/table. Every published field is reviewed here.
const id = z.number().int().positive();
const order = z.number().int().nonnegative();
const line = z
  .string()
  .max(400)
  .refine((value) => !/[\r\n\u0000-\u001f\u007f]/u.test(value));
const prose = z
  .string()
  .max(12000)
  .refine(
    (value) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value),
  );
const url = z
  .url()
  .max(2048)
  .refine((value) => ['http:', 'https:'].includes(new URL(value).protocol));
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u);
const locale = z.enum(locales);
const date = z.iso.date().nullable();
const location = { city: line.nullable(), country: line.nullable() };
const dated = { startDate: date, endDate: date };
const listed = { id, displayOrder: order };
const translations = <T extends z.ZodRawShape>(shape: T) =>
  z
    .array(z.object({ locale, ...shape }).strict())
    .max(3)
    .refine(
      (rows) =>
        new Set(rows.map((row) => ('locale' in row ? row.locale : undefined)))
          .size === rows.length,
      'Duplicate public translation',
    );
const evidence = translations({
  title: line.min(1),
  issuer: line,
  description: prose,
});
const link = z.object({ url, position: order }).strict();
const publicMedia = z
  .object({
    id,
    contentType: z.enum([
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
      'application/pdf',
    ]),
    byteSize: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 * 1024),
    width: id.nullable(),
    height: id.nullable(),
    translations: translations({ altText: line.min(1) }).min(1),
  })
  .strict();

export const publicSnapshotSchema = z
  .object({
    schemaVersion: z.literal(2),
    revision: order,
    generatedAt: z.iso.datetime(),
    siteCopy: translations({
      values: z.record(z.enum(siteCopyKeys), line.min(1)),
    }).min(1),
    profile: z
      .object({
        fullName: line.min(1),
        portraitMediaId: id.nullable(),
        ...location,
        translations: translations({ headline: line.min(1), bio: prose }).min(
          1,
        ),
        contacts: z.array(
          z
            .object({
              kind: z.enum(['email', 'phone', 'website']),
              value: line.min(1),
              displayOrder: order,
            })
            .strict()
            .refine(
              (contact) =>
                contact.kind !== 'website' ||
                url.safeParse(contact.value).success,
              'Public website contacts must use HTTP(S)',
            ),
        ),
      })
      .strict(),
    education: z.array(
      z
        .object({
          ...listed,
          ...dated,
          ...location,
          schoolUrl: url.nullable(),
          logoMediaId: id.nullable(),
          translations: translations({
            school: line.min(1),
            degree: line.min(1),
            field: line,
            status: line,
            description: prose,
          }).min(1),
        })
        .strict(),
    ),
    experience: z.array(
      z
        .object({
          ...listed,
          ...dated,
          ...location,
          employmentType: line.nullable(),
          organizationUrl: url.nullable(),
          logoMediaId: id.nullable(),
          translations: translations({
            organization: line.min(1),
            role: line.min(1),
            description: prose,
          }).min(1),
          highlights: z.array(
            z
              .object({
                position: order,
                translations: translations({ body: prose.min(1) }).min(1),
              })
              .strict(),
          ),
          links: z.array(link),
        })
        .strict(),
    ),
    achievements: z.array(
      z
        .object({
          ...listed,
          achievedOn: date,
          verificationUrl: url.nullable(),
          mediaId: id.nullable(),
          translations: evidence.min(1),
        })
        .strict(),
    ),
    certificates: z.array(
      z
        .object({
          ...listed,
          issuedOn: date,
          expiresOn: date,
          credentialReference: line.nullable(),
          verificationUrl: url.nullable(),
          publicMediaId: id.nullable(),
          translations: evidence.min(1),
        })
        .strict(),
    ),
    initiatives: z.array(
      z
        .object({
          ...listed,
          ...dated,
          websiteUrl: url.nullable(),
          mediaId: id.nullable(),
          translations: translations({
            title: line.min(1),
            role: line,
            description: prose,
            purpose: prose,
            outcomes: prose,
          }).min(1),
          collaborators: z.array(
            z
              .object({
                name: line.min(1),
                url: url.nullable(),
                position: order,
              })
              .strict(),
          ),
          projectIds: z.array(id),
        })
        .strict(),
    ),
    skillCategories: z.array(
      z
        .object({
          ...listed,
          slug,
          translations: translations({ name: line.min(1) }).min(1),
        })
        .strict(),
    ),
    skills: z.array(
      z
        .object({
          ...listed,
          categoryId: id.nullable(),
          translations: translations({
            name: line.min(1),
            description: prose,
          }).min(1),
          evidence: z.array(
            z
              .object({ contentItemId: id.nullable(), url: url.nullable() })
              .strict(),
          ),
        })
        .strict(),
    ),
    languages: z.array(
      z
        .object({
          ...listed,
          languageCode: line.min(1),
          certificateId: id.nullable(),
          translations: translations({
            name: line.min(1),
            proficiency: line.min(1),
          }).min(1),
        })
        .strict(),
    ),
    projectCategories: z.array(
      z
        .object({
          ...listed,
          slug,
          coverMediaId: id.nullable(),
          translations: translations({
            name: line.min(1),
            description: prose,
          }).min(1),
        })
        .strict(),
    ),
    projects: z.array(
      z
        .object({
          ...listed,
          ...dated,
          slug,
          coverMediaId: id.nullable(),
          isFeatured: z.boolean(),
          translations: translations({
            title: line.min(1),
            summary: prose.min(1),
            body: prose,
            role: line,
            outcomes: prose,
          }).min(1),
          categoryIds: z.array(id),
          technologyIds: z.array(id),
          links: z.array(
            link.extend({
              kind: z.enum(['repo', 'demo', 'other']),
              translations: translations({ label: line.min(1) }),
            }),
          ),
          images: z.array(
            z
              .object({
                mediaId: id,
                position: order,
                translations: translations({ caption: prose }),
              })
              .strict(),
          ),
        })
        .strict(),
    ),
    technologies: z.array(z.object({ id, name: line.min(1), slug }).strict()),
    socialLinks: z.array(
      z
        .object({
          ...listed,
          platform: line.min(1),
          url,
          translations: translations({ label: line.min(1) }),
        })
        .strict(),
    ),
    navigation: z.array(
      z
        .object({
          ...listed,
          path: z.string().regex(/^\/(?!\/)[a-zA-Z0-9/_-]*$/u),
          translations: translations({ label: line.min(1) }).min(1),
        })
        .strict(),
    ),
    siteSettings: z
      .object({
        brandName: line.min(1),
        theme: z.enum(['light', 'dark']),
        contactEnabled: z.boolean(),
        defaultLocale: z.literal('en'),
        translations: translations({ availability: line, footerText: prose }),
      })
      .strict(),
    seo: z
      .object({
        socialMediaId: id.nullable(),
        translations: translations({
          title: line.min(1),
          description: prose.min(1),
        }),
      })
      .strict(),
    categoryRedirects: z.array(
      z.object({ oldSlug: slug, categoryId: id }).strict(),
    ),
    media: z.array(publicMedia),
    publicVariant: z
      .object({
        id,
        template: z.literal('reference-2'),
        translations: translations({
          summary: prose,
          profileHeading: line.min(1),
          educationHeading: line.min(1),
          presentLabel: line.min(1),
        }).min(1),
        items: z.array(
          z
            .object({
              contentItemId: id,
              kind: z.enum([
                'education',
                'experience',
                'achievement',
                'certificate',
                'initiative',
                'skill',
                'language',
                'project',
              ]),
              section: line.min(1),
              position: order,
              translations: translations({ bulletOverride: prose }),
            })
            .strict(),
        ),
      })
      .strict(),
  })
  .strict();

export type PublicSnapshot = z.infer<typeof publicSnapshotSchema>;
