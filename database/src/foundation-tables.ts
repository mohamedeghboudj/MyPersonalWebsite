import {
  integer,
  text,
  sqliteTable,
  primaryKey,
  index,
  uniqueIndex,
  foreignKey,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { locales } from '@platform/schema';
import { identities, variants, variantItems } from './tables.ts';
import { media } from './media.ts';
const visibility = () => ({
  displayOrder: integer('display_order').notNull().default(0),
  isVisible: integer('is_visible', { mode: 'boolean' })
    .notNull()
    .default(false),
});
export const skillCategories = sqliteTable('skill_categories', {
  id: integer('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  displayOrder: integer('display_order').notNull().default(0),
});
export const experience = sqliteTable(
  'experience',
  {
    id: integer('id')
      .primaryKey()
      .references(() => identities.id, { onDelete: 'cascade' }),
    ...visibility(),
    startDate: text('start_date').notNull(),
    employmentType: text('employment_type'),
    endDate: text('end_date'),
    organizationUrl: text('organization_url'),
    logoMediaId: integer('logo_media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
    city: text('city'),
    country: text('country'),
  },
  (t) => [
    index('experience_visibility_order').on(t.isVisible, t.displayOrder),
    index('experience_logo_media_id').on(t.logoMediaId),
  ],
);
export const experienceTranslations = sqliteTable(
  'experience_translations',
  {
    experienceId: integer('experience_id')
      .notNull()
      .references(() => experience.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    organization: text('organization').notNull(),
    role: text('role').notNull(),
    description: text('description').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.experienceId, t.locale] }),
    index('experience_locale').on(t.locale),
  ],
);
export const achievements = sqliteTable(
  'achievements',
  {
    id: integer('id')
      .primaryKey()
      .references(() => identities.id, { onDelete: 'cascade' }),
    ...visibility(),
    achievedOn: text('achieved_on'),
    verificationUrl: text('verification_url'),
    mediaId: integer('media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('achievements_visibility_order').on(t.isVisible, t.displayOrder),
    index('achievements_media_id').on(t.mediaId),
  ],
);
export const achievementTranslations = sqliteTable(
  'achievement_translations',
  {
    achievementId: integer('achievement_id')
      .notNull()
      .references(() => achievements.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    title: text('title').notNull(),
    issuer: text('issuer').notNull(),
    description: text('description').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.achievementId, t.locale] }),
    index('achievement_locale').on(t.locale),
  ],
);
export const certificates = sqliteTable(
  'certificates',
  {
    id: integer('id')
      .primaryKey()
      .references(() => identities.id, { onDelete: 'cascade' }),
    ...visibility(),
    issuedOn: text('issued_on'),
    credentialReference: text('credential_reference'),
    expiresOn: text('expires_on'),
    verificationUrl: text('verification_url'),
    originalMediaId: integer('original_media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
    publicMediaId: integer('public_media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('certificates_visibility_order').on(t.isVisible, t.displayOrder),
    index('certificates_original_media_id').on(t.originalMediaId),
    index('certificates_public_media_id').on(t.publicMediaId),
  ],
);
export const certificateTranslations = sqliteTable(
  'certificate_translations',
  {
    certificateId: integer('certificate_id')
      .notNull()
      .references(() => certificates.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    title: text('title').notNull(),
    issuer: text('issuer').notNull(),
    description: text('description').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.certificateId, t.locale] }),
    index('certificate_locale').on(t.locale),
  ],
);
export const initiatives = sqliteTable(
  'initiatives',
  {
    id: integer('id')
      .primaryKey()
      .references(() => identities.id, { onDelete: 'cascade' }),
    ...visibility(),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    websiteUrl: text('website_url'),
    mediaId: integer('media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('initiatives_visibility_order').on(t.isVisible, t.displayOrder),
    index('initiatives_media_id').on(t.mediaId),
  ],
);
export const initiativeTranslations = sqliteTable(
  'initiative_translations',
  {
    initiativeId: integer('initiative_id')
      .notNull()
      .references(() => initiatives.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    title: text('title').notNull(),
    role: text('role').notNull(),
    description: text('description').notNull(),
    purpose: text('purpose').notNull().default(''),
    outcomes: text('outcomes').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.initiativeId, t.locale] }),
    index('initiative_locale').on(t.locale),
  ],
);
export const skills = sqliteTable(
  'skills',
  {
    id: integer('id')
      .primaryKey()
      .references(() => identities.id, { onDelete: 'cascade' }),
    ...visibility(),
    categoryId: integer('category_id').references(() => skillCategories.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [index('skills_visibility_order').on(t.isVisible, t.displayOrder)],
);
export const skillTranslations = sqliteTable(
  'skill_translations',
  {
    skillId: integer('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.skillId, t.locale] }),
    index('skill_locale').on(t.locale),
  ],
);
export const languages = sqliteTable(
  'languages',
  {
    id: integer('id')
      .primaryKey()
      .references(() => identities.id, { onDelete: 'cascade' }),
    ...visibility(),
    languageCode: text('language_code').notNull().unique(),
    certificateId: integer('certificate_id').references(() => certificates.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [index('languages_visibility_order').on(t.isVisible, t.displayOrder)],
);
export const languageTranslations = sqliteTable(
  'language_translations',
  {
    languageId: integer('language_id')
      .notNull()
      .references(() => languages.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    name: text('name').notNull(),
    proficiency: text('proficiency').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.languageId, t.locale] }),
    index('language_locale').on(t.locale),
  ],
);
export const projectCategories = sqliteTable(
  'project_categories',
  {
    id: integer('id').primaryKey(),
    ...visibility(),
    slug: text('slug').notNull().unique(),
    coverMediaId: integer('cover_media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('project_categories_visibility_order').on(
      t.isVisible,
      t.displayOrder,
    ),
  ],
);
export const projectCategoryTranslations = sqliteTable(
  'project_category_translations',
  {
    categoryId: integer('category_id')
      .notNull()
      .references(() => projectCategories.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.categoryId, t.locale] }),
    index('project_category_locale').on(t.locale),
  ],
);
export const projects = sqliteTable(
  'projects',
  {
    id: integer('id')
      .primaryKey()
      .references(() => identities.id, { onDelete: 'cascade' }),
    ...visibility(),
    slug: text('slug').notNull().unique(),
    startDate: text('start_date'),
    endDate: text('end_date'),
    coverMediaId: integer('cover_media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
    isFeatured: integer('is_featured', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (t) => [
    index('projects_visibility_order').on(t.isVisible, t.displayOrder),
    index('projects_cover_media_id').on(t.coverMediaId),
  ],
);
export const projectTranslations = sqliteTable(
  'project_translations',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    title: text('title').notNull(),
    summary: text('summary').notNull(),
    body: text('body').notNull().default(''),
    role: text('role').notNull().default(''),
    outcomes: text('outcomes').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.locale] }),
    index('project_locale').on(t.locale),
  ],
);
export const articles = sqliteTable(
  'articles',
  {
    id: integer('id').primaryKey(),
    ...visibility(),
    slug: text('slug').notNull().unique(),
    publishedOn: text('published_on'),
    coverMediaId: integer('cover_media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [
    index('articles_visibility_order').on(t.isVisible, t.displayOrder),
    index('articles_cover_media_id').on(t.coverMediaId),
  ],
);
export const articleTranslations = sqliteTable(
  'article_translations',
  {
    articleId: integer('article_id')
      .notNull()
      .references(() => articles.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    title: text('title').notNull(),
    excerpt: text('excerpt').notNull(),
    body: text('body').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.articleId, t.locale] }),
    index('article_locale').on(t.locale),
  ],
);

export const projectImages = sqliteTable(
  'project_images',
  {
    id: integer('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    mediaId: integer('media_id')
      .notNull()
      .references(() => media.id),
    position: integer('position').notNull(),
  },
  (t) => [
    uniqueIndex('project_image_unique').on(t.projectId, t.mediaId),
    index('project_image_order').on(t.projectId, t.position),
    index('project_image_media').on(t.mediaId),
  ],
);
export const projectImageTranslations = sqliteTable(
  'project_image_translations',
  {
    imageId: integer('image_id')
      .notNull()
      .references(() => projectImages.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    caption: text('caption').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.imageId, t.locale] }),
    index('project_image_locale').on(t.locale),
  ],
);
export const projectLinks = sqliteTable(
  'project_links',
  {
    id: integer('id').primaryKey(),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['repo', 'demo', 'other'] }).notNull(),
    url: text('url').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [index('project_link_order').on(t.projectId, t.position)],
);
export const projectLinkTranslations = sqliteTable(
  'project_link_translations',
  {
    linkId: integer('link_id')
      .notNull()
      .references(() => projectLinks.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    label: text('label').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.linkId, t.locale] }),
    index('project_link_locale').on(t.locale),
  ],
);
export const technologies = sqliteTable('technologies', {
  id: integer('id').primaryKey(),
  name: text('name').notNull().unique(),
  slug: text('slug').notNull().unique(),
});
export const projectTechnologies = sqliteTable(
  'project_technologies',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    technologyId: integer('technology_id')
      .notNull()
      .references(() => technologies.id),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.technologyId] }),
    index('project_technology_reverse').on(t.technologyId),
  ],
);
export const projectCategoryMap = sqliteTable(
  'project_category_map',
  {
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => projectCategories.id),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.categoryId] }),
    index('project_category_reverse').on(t.categoryId),
  ],
);
export const variantItemTranslations = sqliteTable(
  'cv_variant_item_translations',
  {
    variantId: integer('variant_id').notNull(),
    contentItemId: integer('content_item_id').notNull(),
    locale: text('locale', { enum: locales }).notNull(),
    bulletOverride: text('bullet_override').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.variantId, t.contentItemId, t.locale] }),
    foreignKey({
      columns: [t.variantId, t.contentItemId],
      foreignColumns: [variantItems.variantId, variantItems.contentItemId],
    }).onDelete('cascade'),
    index('variant_item_locale').on(t.locale),
  ],
);
// Deliberate derived cache: keyed by the complete resolved payload and template.
export const cvPdfCache = sqliteTable(
  'cv_pdf_cache',
  {
    cacheKey: text('cache_key').primaryKey(),
    variantId: integer('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    templateVersion: text('template_version').notNull(),
    contentHash: text('content_hash').notNull(),
    objectKey: text('object_key').notNull().unique(),
    createdAt: text('created_at')
      .notNull()
      .default(sql`(datetime('now'))`),
    expiresAt: text('expires_at').notNull(),
  },
  (t) => [
    index('cv_cache_variant').on(t.variantId),
    index('cv_cache_expiry').on(t.expiresAt),
  ],
);
export const siteSettings = sqliteTable('site_settings', {
  id: integer('id').primaryKey(),
  brandName: text('brand_name').notNull(),
  theme: text('theme', { enum: ['light', 'dark'] })
    .notNull()
    .default('light'),
  contactEnabled: integer('contact_enabled', { mode: 'boolean' })
    .notNull()
    .default(false),
  defaultLocale: text('default_locale', { enum: ['en'] })
    .notNull()
    .default('en'),
});
export const siteSettingTranslations = sqliteTable(
  'site_setting_translations',
  {
    settingsId: integer('settings_id')
      .notNull()
      .references(() => siteSettings.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    availability: text('availability').notNull().default(''),
    footerText: text('footer_text').notNull().default(''),
  },
  (t) => [
    primaryKey({ columns: [t.settingsId, t.locale] }),
    index('site_setting_locale').on(t.locale),
  ],
);
export const seoSettings = sqliteTable(
  'seo_settings',
  {
    id: integer('id').primaryKey(),
    socialMediaId: integer('social_media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
  },
  (t) => [index('seo_media').on(t.socialMediaId)],
);
export const seoTranslations = sqliteTable(
  'seo_translations',
  {
    settingsId: integer('settings_id')
      .notNull()
      .references(() => seoSettings.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.settingsId, t.locale] }),
    index('seo_locale').on(t.locale),
  ],
);
export const socialLinks = sqliteTable(
  'social_links',
  {
    id: integer('id').primaryKey(),
    platform: text('platform').notNull(),
    url: text('url').notNull(),
    ...visibility(),
  },
  (t) => [index('social_visibility_order').on(t.isVisible, t.displayOrder)],
);
export const socialLinkTranslations = sqliteTable(
  'social_link_translations',
  {
    linkId: integer('link_id')
      .notNull()
      .references(() => socialLinks.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    label: text('label').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.linkId, t.locale] }),
    index('social_link_locale').on(t.locale),
  ],
);
