import {
  integer,
  text,
  sqliteTable,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core';
import { locales } from '@platform/schema';
import { profile, identities } from './tables.ts';
import {
  experience,
  initiatives,
  projects,
  skills,
  skillCategories,
  projectCategories,
} from './foundation-tables.ts';
export const profileContacts = sqliteTable(
  'profile_contacts',
  {
    id: integer('id').primaryKey(),
    profileId: integer('profile_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['email', 'phone', 'website'] }).notNull(),
    value: text('value').notNull(),
    isPublic: integer('is_public', { mode: 'boolean' })
      .notNull()
      .default(false),
    displayOrder: integer('display_order').notNull().default(0),
  },
  (t) => [index('profile_contact_order').on(t.profileId, t.displayOrder)],
);
export const experienceHighlights = sqliteTable(
  'experience_highlights',
  {
    id: integer('id').primaryKey(),
    experienceId: integer('experience_id')
      .notNull()
      .references(() => experience.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [index('experience_highlight_order').on(t.experienceId, t.position)],
);
export const experienceHighlightTranslations = sqliteTable(
  'experience_highlight_translations',
  {
    highlightId: integer('highlight_id')
      .notNull()
      .references(() => experienceHighlights.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    body: text('body').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.highlightId, t.locale] }),
    index('experience_highlight_locale').on(t.locale),
  ],
);
export const experienceLinks = sqliteTable(
  'experience_links',
  {
    id: integer('id').primaryKey(),
    experienceId: integer('experience_id')
      .notNull()
      .references(() => experience.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    position: integer('position').notNull(),
  },
  (t) => [index('experience_link_order').on(t.experienceId, t.position)],
);
export const initiativeCollaborators = sqliteTable(
  'initiative_collaborators',
  {
    id: integer('id').primaryKey(),
    initiativeId: integer('initiative_id')
      .notNull()
      .references(() => initiatives.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    url: text('url'),
    position: integer('position').notNull(),
  },
  (t) => [
    index('initiative_collaborator_order').on(t.initiativeId, t.position),
  ],
);
export const initiativeProjects = sqliteTable(
  'initiative_projects',
  {
    initiativeId: integer('initiative_id')
      .notNull()
      .references(() => initiatives.id, { onDelete: 'cascade' }),
    projectId: integer('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.initiativeId, t.projectId] }),
    index('initiative_project_reverse').on(t.projectId),
  ],
);
export const skillCategoryTranslations = sqliteTable(
  'skill_category_translations',
  {
    categoryId: integer('category_id')
      .notNull()
      .references(() => skillCategories.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    name: text('name').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.categoryId, t.locale] }),
    index('skill_category_locale').on(t.locale),
  ],
);
export const skillEvidence = sqliteTable(
  'skill_evidence',
  {
    id: integer('id').primaryKey(),
    skillId: integer('skill_id')
      .notNull()
      .references(() => skills.id, { onDelete: 'cascade' }),
    contentItemId: integer('content_item_id').references(() => identities.id, {
      onDelete: 'cascade',
    }),
    url: text('url'),
  },
  (t) => [
    index('skill_evidence_skill').on(t.skillId),
    index('skill_evidence_content').on(t.contentItemId),
  ],
);
export const navigationItems = sqliteTable(
  'navigation_items',
  {
    id: integer('id').primaryKey(),
    path: text('path').notNull(),
    displayOrder: integer('display_order').notNull().default(0),
    isVisible: integer('is_visible', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (t) => [index('navigation_order').on(t.isVisible, t.displayOrder)],
);
export const navigationTranslations = sqliteTable(
  'navigation_translations',
  {
    itemId: integer('item_id')
      .notNull()
      .references(() => navigationItems.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    label: text('label').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.locale] }),
    index('navigation_locale').on(t.locale),
  ],
);
export const categoryRedirects = sqliteTable(
  'category_redirects',
  {
    oldSlug: text('old_slug').primaryKey(),
    categoryId: integer('category_id')
      .notNull()
      .references(() => projectCategories.id, { onDelete: 'cascade' }),
  },
  (t) => [index('category_redirect_target').on(t.categoryId)],
);
