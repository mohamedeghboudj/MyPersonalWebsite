import { z } from 'zod';

import { locales } from './locales.ts';
import { siteCopyKeys } from './site-copy.ts';
export const editorLocales = locales;
export type EditorField = {
  key: string;
  label: string;
  type:
    | 'text'
    | 'multiline'
    | 'url'
    | 'date'
    | 'number'
    | 'boolean'
    | 'choice'
    | 'reference';
  required?: boolean | undefined;
  options?: readonly string[] | undefined;
  reference?: string | undefined;
  max?: number | undefined;
};
export type EditorGroup = {
  key: string;
  label: string;
  table: string;
  foreignKey: string;
  fields: readonly EditorField[];
  translated?: readonly EditorField[] | undefined;
  translationTable?: string | undefined;
  translationKeys?: readonly string[] | undefined;
  groups?: readonly EditorGroup[] | undefined;
};
export type EditorModule = {
  key: string;
  label: string;
  table: string;
  titleField: string;
  kind?: string | undefined;
  singleton?: boolean | undefined;
  sensitive?: boolean | undefined;
  fields: readonly EditorField[];
  translated?: readonly EditorField[] | undefined;
  translationTable?: string | undefined;
  translationKey?: string | undefined;
  groups?: readonly EditorGroup[] | undefined;
};
const text = (
  key: string,
  label: string,
  required = false,
  max = 240,
): EditorField => ({ key, label, type: 'text', required, max });
const prose = (
  key: string,
  label: string,
  required = false,
  max = 12000,
): EditorField => ({ key, label, type: 'multiline', required, max });
const url = (key: string, label: string, required = false): EditorField => ({
  key,
  label,
  type: 'url',
  required,
});
const date = (key: string, label: string, required = false): EditorField => ({
  key,
  label,
  type: 'date',
  required,
});
const ref = (
  key: string,
  label: string,
  reference: string,
  required = false,
): EditorField => ({ key, label, type: 'reference', reference, required });
const choice = (
  key: string,
  label: string,
  options: readonly string[],
): EditorField => ({ key, label, type: 'choice', options, required: true });
const order: EditorField = {
  key: 'displayOrder',
  label: 'Display order',
  type: 'number',
  required: true,
};
const position: EditorField = {
  key: 'position',
  label: 'Position',
  type: 'number',
  required: true,
};
const visible: EditorField = {
  key: 'isVisible',
  label: 'Visible',
  type: 'boolean',
  required: true,
};
const published: EditorField = {
  key: 'isPublic',
  label: 'Public',
  type: 'boolean',
  required: true,
};
const display = [order, visible];
const dates = [
  date('startDate', 'Start date', true),
  date('endDate', 'End date'),
];
const location = [text('city', 'City'), text('country', 'Country')];
const description = prose('description', 'Description', true);
const translated = (
  table: string,
  key: string,
  fields: readonly EditorField[],
) => ({ translationTable: table, translationKey: key, translated: fields });
const group = (
  key: string,
  label: string,
  table: string,
  foreignKey: string,
  fields: readonly EditorField[],
  extras: Partial<EditorGroup> = {},
): EditorGroup => ({ key, label, table, foreignKey, fields, ...extras });

// The registry owns form metadata and produces all server/client input schemas.
// Table names are code-owned Drizzle export keys, never SQL received from a user.
export const editorModules: readonly EditorModule[] = [
  {
    key: 'siteCopy',
    label: 'Public interface text',
    table: 'siteCopy',
    titleField: 'home',
    singleton: true,
    sensitive: true,
    fields: [],
    ...translated(
      'siteCopyTranslations',
      'copyId',
      siteCopyKeys.map((key) =>
        text(
          key,
          key.replace(/[A-Z]/gu, (letter) => ` ${letter.toLowerCase()}`),
          true,
        ),
      ),
    ),
  },
  {
    key: 'media',
    label: 'Media library',
    table: 'media',
    titleField: 'altText',
    fields: [
      {
        key: 'isPublic',
        label: 'Eligible for public derivatives (redacted copies only)',
        type: 'boolean',
      },
    ],
    ...translated('mediaTranslations', 'mediaId', [
      text('altText', 'Alternative text', true),
    ]),
  },
  {
    key: 'profile',
    label: 'Profile',
    table: 'profile',
    titleField: 'fullName',
    singleton: true,
    fields: [
      text('fullName', 'Full name', true, 180),
      ref('portraitMediaId', 'Portrait', 'media'),
      ...location,
    ],
    ...translated('profileTranslations', 'profileId', [
      text('headline', 'Headline', true),
      prose('bio', 'Biography'),
    ]),
    groups: [
      group('contacts', 'Contact details', 'profileContacts', 'profileId', [
        choice('kind', 'Type', ['email', 'phone', 'website']),
        text('value', 'Contact detail', true),
        published,
        order,
      ]),
    ],
  },
  {
    key: 'education',
    label: 'Education',
    table: 'education',
    kind: 'education',
    titleField: 'school',
    fields: [
      ...dates,
      url('schoolUrl', 'Institution website'),
      ref('logoMediaId', 'Institution logo', 'media'),
      ...location,
      ...display,
    ],
    ...translated('educationTranslations', 'educationId', [
      text('school', 'Institution', true, 180),
      text('degree', 'Program', true, 180),
      text('field', 'Specialty'),
      text('status', 'Status'),
      prose('description', 'Description', true, 3000),
    ]),
  },
  {
    key: 'experience',
    label: 'Experience',
    table: 'experience',
    kind: 'experience',
    titleField: 'organization',
    fields: [
      ...dates,
      text('employmentType', 'Employment type'),
      url('organizationUrl', 'Organization website'),
      ref('logoMediaId', 'Organization logo', 'media'),
      ...location,
      ...display,
    ],
    ...translated('experienceTranslations', 'experienceId', [
      text('organization', 'Organization', true),
      text('role', 'Role', true),
      description,
    ]),
    groups: [
      group(
        'highlights',
        'Achievements',
        'experienceHighlights',
        'experienceId',
        [position],
        {
          translationTable: 'experienceHighlightTranslations',
          translationKeys: ['highlightId'],
          translated: [prose('body', 'Achievement', true)],
        },
      ),
      group('links', 'Links', 'experienceLinks', 'experienceId', [
        url('url', 'URL', true),
        position,
      ]),
    ],
  },
  {
    key: 'achievements',
    label: 'Achievements',
    table: 'achievements',
    kind: 'achievement',
    titleField: 'title',
    fields: [
      date('achievedOn', 'Award date'),
      url('verificationUrl', 'Evidence URL'),
      ref('mediaId', 'Evidence image', 'media'),
      ...display,
    ],
    ...translated('achievementTranslations', 'achievementId', [
      text('title', 'Title', true),
      text('issuer', 'Awarding body', true),
      description,
    ]),
  },
  {
    key: 'certificates',
    label: 'Certificates',
    table: 'certificates',
    kind: 'certificate',
    titleField: 'title',
    fields: [
      date('issuedOn', 'Issue date'),
      date('expiresOn', 'Expiry date'),
      text('credentialReference', 'Credential reference'),
      url('verificationUrl', 'Verification URL'),
      ref('originalMediaId', 'Private original', 'media'),
      ref('publicMediaId', 'Redacted public copy', 'media'),
      ...display,
    ],
    ...translated('certificateTranslations', 'certificateId', [
      text('title', 'Title', true),
      text('issuer', 'Issuer', true),
      description,
    ]),
  },
  {
    key: 'initiatives',
    label: 'Initiatives',
    table: 'initiatives',
    kind: 'initiative',
    titleField: 'title',
    fields: [
      ...dates,
      url('websiteUrl', 'Website'),
      ref('mediaId', 'Image', 'media'),
      ...display,
    ],
    ...translated('initiativeTranslations', 'initiativeId', [
      text('title', 'Title', true),
      text('role', 'Role', true),
      prose('purpose', 'Purpose'),
      prose('outcomes', 'Outcomes'),
      description,
    ]),
    groups: [
      group(
        'collaborators',
        'Collaborators',
        'initiativeCollaborators',
        'initiativeId',
        [text('name', 'Name', true), url('url', 'Website'), position],
      ),
      group(
        'projects',
        'Related projects',
        'initiativeProjects',
        'initiativeId',
        [ref('projectId', 'Project', 'projects', true)],
      ),
    ],
  },
  {
    key: 'skills',
    label: 'Skills',
    table: 'skills',
    kind: 'skill',
    titleField: 'name',
    fields: [ref('categoryId', 'Category', 'skillCategories'), ...display],
    ...translated('skillTranslations', 'skillId', [
      text('name', 'Skill', true),
      prose('description', 'Description'),
    ]),
    groups: [
      group('evidence', 'Evidence', 'skillEvidence', 'skillId', [
        ref('contentItemId', 'Related content', 'contentItems'),
        url('url', 'External evidence URL'),
      ]),
    ],
  },
  {
    key: 'skillCategories',
    label: 'Skill categories',
    table: 'skillCategories',
    titleField: 'name',
    fields: [text('slug', 'Slug', true), order],
    ...translated('skillCategoryTranslations', 'categoryId', [
      text('name', 'Name', true),
    ]),
  },
  {
    key: 'languages',
    label: 'Languages',
    table: 'languages',
    kind: 'language',
    titleField: 'name',
    fields: [
      text('languageCode', 'Language code', true),
      ref('certificateId', 'Supporting certificate', 'certificates'),
      ...display,
    ],
    ...translated('languageTranslations', 'languageId', [
      text('name', 'Language', true),
      text('proficiency', 'Proficiency', true),
    ]),
  },
  {
    key: 'projectCategories',
    label: 'Project categories',
    table: 'projectCategories',
    titleField: 'name',
    fields: [
      text('slug', 'Slug', true),
      ref('coverMediaId', 'Cover image', 'media'),
      ...display,
    ],
    ...translated('projectCategoryTranslations', 'categoryId', [
      text('name', 'Name', true),
      prose('description', 'Description'),
    ]),
  },
  {
    key: 'projects',
    label: 'Projects',
    table: 'projects',
    kind: 'project',
    titleField: 'title',
    fields: [
      text('slug', 'Slug', true),
      date('startDate', 'Start date'),
      date('endDate', 'End date'),
      ref('coverMediaId', 'Cover image', 'media'),
      { key: 'isFeatured', label: 'Featured', type: 'boolean' },
      ...display,
    ],
    ...translated('projectTranslations', 'projectId', [
      text('title', 'Name', true),
      prose('summary', 'Summary', true),
      prose('body', 'Case study'),
      text('role', 'Your role'),
      prose('outcomes', 'Outcomes'),
    ]),
    groups: [
      group('categories', 'Categories', 'projectCategoryMap', 'projectId', [
        ref('categoryId', 'Category', 'projectCategories', true),
      ]),
      group(
        'technologies',
        'Technologies',
        'projectTechnologies',
        'projectId',
        [ref('technologyId', 'Technology', 'technologies', true)],
      ),
      group(
        'links',
        'Links',
        'projectLinks',
        'projectId',
        [
          choice('kind', 'Type', ['repo', 'demo', 'other']),
          url('url', 'URL', true),
          position,
        ],
        {
          translationTable: 'projectLinkTranslations',
          translationKeys: ['linkId'],
          translated: [text('label', 'Link label', true)],
        },
      ),
      group(
        'images',
        'Gallery',
        'projectImages',
        'projectId',
        [ref('mediaId', 'Image', 'media', true), position],
        {
          translationTable: 'projectImageTranslations',
          translationKeys: ['imageId'],
          translated: [text('caption', 'Caption', true)],
        },
      ),
    ],
  },
  {
    key: 'technologies',
    label: 'Technologies',
    table: 'technologies',
    titleField: 'name',
    fields: [text('name', 'Name', true), text('slug', 'Slug', true)],
  },
  {
    key: 'socialLinks',
    label: 'Social links',
    table: 'socialLinks',
    titleField: 'platform',
    fields: [
      text('platform', 'Platform', true),
      url('url', 'Profile URL', true),
      ...display,
    ],
    ...translated('socialLinkTranslations', 'linkId', [
      text('label', 'Label', true),
    ]),
  },
  {
    key: 'navigation',
    label: 'Navigation',
    table: 'navigationItems',
    titleField: 'label',
    sensitive: true,
    fields: [text('path', 'Page path', true), ...display],
    ...translated('navigationTranslations', 'itemId', [
      text('label', 'Label', true),
    ]),
  },
  {
    key: 'siteSettings',
    label: 'Site settings',
    table: 'siteSettings',
    titleField: 'brandName',
    singleton: true,
    sensitive: true,
    fields: [
      text('brandName', 'Website name', true),
      choice('theme', 'Theme', ['light', 'dark']),
      { key: 'contactEnabled', label: 'Contact form enabled', type: 'boolean' },
      choice('defaultLocale', 'Canonical language', ['en']),
    ],
    ...translated('siteSettingTranslations', 'settingsId', [
      text('availability', 'Availability'),
      text('footerText', 'Footer text'),
    ]),
  },
  {
    key: 'seo',
    label: 'SEO defaults',
    table: 'seoSettings',
    titleField: 'title',
    singleton: true,
    sensitive: true,
    fields: [ref('socialMediaId', 'Social preview image', 'media')],
    ...translated('seoTranslations', 'settingsId', [
      text('title', 'Page title', true),
      prose('description', 'Description', true),
    ]),
  },
  {
    key: 'cvVariants',
    label: 'CV variants',
    table: 'variants',
    titleField: 'slug',
    fields: [
      text('slug', 'Preset slug', true),
      choice('template', 'Template', ['reference-2']),
    ],
    ...translated('variantTranslations', 'variantId', [
      prose('summary', 'Summary', true, 2000),
      text('profileHeading', 'Profile heading', true, 80),
      text('educationHeading', 'Education heading', true, 80),
      text('presentLabel', 'Present-date label', true, 40),
    ]),
    groups: [
      group(
        'items',
        'Selected content',
        'variantItems',
        'variantId',
        [
          ref('contentItemId', 'Content item', 'contentItems', true),
          text('section', 'Section', true),
          position,
          visible,
        ],
        {
          translationTable: 'variantItemTranslations',
          translationKeys: ['variantId', 'contentItemId'],
          translated: [prose('bulletOverride', 'Override text', true)],
        },
      ),
    ],
  },
];
const fieldValue = (field: EditorField): z.ZodType => {
  if (field.type === 'boolean') return z.boolean();
  if (field.type === 'number') return z.number().int().min(0).max(10000);
  if (field.type === 'reference') {
    const id = z.number().int().positive().max(2147483647);
    return field.required ? id : id.nullable();
  }
  if (field.type === 'choice')
    return z.enum(field.options as [string, ...string[]]);
  let value: z.ZodType = z
    .string()
    .trim()
    .max(field.max ?? 240)
    .refine(
      (v) => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(v),
      'Control characters are not allowed',
    );
  if (field.type !== 'multiline')
    value = value.refine(
      (v) => typeof v === 'string' && !/[\r\n]/u.test(v),
      'Use one line',
    );
  if (field.type === 'url')
    value = z
      .url()
      .max(2048)
      .refine(
        (v) => ['http:', 'https:'].includes(new URL(v).protocol),
        'Use an HTTP(S) URL',
      );
  if (field.type === 'date') value = z.iso.date();
  if (field.key === 'languageCode')
    value = z
      .string()
      .regex(/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u)
      .max(35);
  if (field.key === 'slug')
    value = z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u)
      .max(100);
  if (field.key === 'path')
    value = z
      .string()
      .regex(/^\/(?!\/)[a-zA-Z0-9/_-]*$/u)
      .max(200);
  if (field.required)
    return value.refine(
      (v) => typeof v === 'string' && v.length > 0,
      'Required',
    );
  return field.type === 'date' || field.type === 'url'
    ? value.nullable()
    : value.nullable().transform((v) => v ?? '');
};
const fieldsShape = (fields: readonly EditorField[]) =>
  Object.fromEntries(fields.map((field) => [field.key, fieldValue(field)]));
function recordSchema(
  definition: Pick<EditorModule, 'fields' | 'translated' | 'groups'>,
): z.ZodType<Record<string, unknown>> {
  const shape: Record<string, z.ZodType> = fieldsShape(definition.fields);
  if (definition.translated)
    shape.translations = z
      .array(
        z
          .object({
            locale: z.enum(editorLocales),
            ...fieldsShape(definition.translated),
          })
          .strict(),
      )
      .max(3)
      .refine(
        (rows) => new Set(rows.map((row) => row.locale)).size === rows.length,
        'Each language may occur once',
      );
  for (const child of definition.groups ?? [])
    shape[child.key] = z.array(recordSchema(child)).max(30);
  return z
    .object(shape)
    .strict()
    .superRefine((value, context) => {
      for (const [start, end] of [
        ['startDate', 'endDate'],
        ['issuedOn', 'expiresOn'],
      ])
        if (
          typeof value[start ?? ''] === 'string' &&
          typeof value[end ?? ''] === 'string' &&
          String(value[end ?? '']) < String(value[start ?? ''])
        )
          context.addIssue({
            code: 'custom',
            path: [end ?? ''],
            message: 'End date precedes start date',
          });
      if (
        'contentItemId' in value &&
        'url' in value &&
        Boolean(value.contentItemId) === Boolean(value.url)
      )
        context.addIssue({
          code: 'custom',
          message: 'Choose either related content or an evidence URL',
        });
      if ('kind' in value && 'value' in value) {
        if (value.kind === 'email' && !z.email().safeParse(value.value).success)
          context.addIssue({
            code: 'custom',
            path: ['value'],
            message: 'Enter a valid email',
          });
        if (
          value.kind === 'website' &&
          !z
            .url()
            .refine((v) => ['http:', 'https:'].includes(new URL(v).protocol))
            .safeParse(value.value).success
        )
          context.addIssue({
            code: 'custom',
            path: ['value'],
            message: 'Enter an HTTP(S) URL',
          });
      }
    });
}
export const editorRegistry = new Map(
  editorModules.map((module) => [
    module.key,
    {
      ...module,
      input: recordSchema(module).superRefine((value, context) => {
        if (
          module.translated &&
          (!Array.isArray(value.translations) ||
            value.translations.length === 0)
        )
          context.addIssue({
            code: 'custom',
            path: ['translations'],
            message: 'Add at least one translation',
          });
      }),
    },
  ]),
);
export const editorRequestSchema = z
  .object({
    revision: z.number().int().nonnegative(),
    record: z.record(z.string(), z.unknown()),
  })
  .strict();
export const editorDeleteSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
export type EditorRecord = z.infer<typeof editorRequestSchema>['record'];
export { emptyEditorRecord } from './editor-defaults.ts';
