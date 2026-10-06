import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { contentKinds } from '@platform/schema';
import { media } from './media.ts';

export const state = sqliteTable('platform_state', {
  id: integer('id').primaryKey(),
  revision: integer('revision').notNull(),
});
export const identities = sqliteTable('content_items', {
  id: integer('id').primaryKey(),
  kind: text('kind', { enum: contentKinds }).notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});
export const profile = sqliteTable('profile', {
  id: integer('id').primaryKey(),
  fullName: text('full_name').notNull(),
  portraitMediaId: integer('portrait_media_id').references(() => media.id, {
    onDelete: 'set null',
  }),
  city: text('city'),
  country: text('country'),
});
export const profileTranslations = sqliteTable(
  'profile_translations',
  {
    profileId: integer('profile_id')
      .notNull()
      .references(() => profile.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: ['en', 'fr', 'ar'] }).notNull(),
    headline: text('headline').notNull(),
    bio: text('bio').notNull().default(''),
  },
  (table) => [
    primaryKey({ columns: [table.profileId, table.locale] }),
    index('profile_locale').on(table.locale),
  ],
);
export const education = sqliteTable(
  'education',
  {
    id: integer('id')
      .primaryKey()
      .references(() => identities.id, { onDelete: 'cascade' }),
    startDate: text('start_date').notNull(),
    endDate: text('end_date'),
    schoolUrl: text('school_url'),
    logoMediaId: integer('logo_media_id').references(() => media.id, {
      onDelete: 'set null',
    }),
    city: text('city'),
    country: text('country'),
    displayOrder: integer('display_order').notNull().default(0),
    isVisible: integer('is_visible', { mode: 'boolean' })
      .notNull()
      .default(false),
  },
  (table) => [
    index('education_visibility_order').on(table.isVisible, table.displayOrder),
  ],
);
export const educationTranslations = sqliteTable(
  'education_translations',
  {
    educationId: integer('education_id')
      .notNull()
      .references(() => education.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: ['en', 'fr', 'ar'] }).notNull(),
    school: text('school').notNull(),
    degree: text('degree').notNull(),
    description: text('description').notNull(),
    field: text('field').notNull().default(''),
    status: text('status').notNull().default(''),
  },
  (table) => [
    primaryKey({ columns: [table.educationId, table.locale] }),
    index('education_locale').on(table.locale),
  ],
);
export const variants = sqliteTable('cv_variants', {
  id: integer('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  template: text('template').notNull().default('reference-2'),
});
export const variantTranslations = sqliteTable(
  'cv_variant_translations',
  {
    variantId: integer('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: ['en', 'fr', 'ar'] }).notNull(),
    summary: text('summary').notNull(),
    profileHeading: text('profile_heading').notNull(),
    educationHeading: text('education_heading').notNull(),
    presentLabel: text('present_label').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.variantId, table.locale] }),
    index('variant_locale').on(table.locale),
  ],
);
export const variantItems = sqliteTable(
  'cv_variant_items',
  {
    variantId: integer('variant_id')
      .notNull()
      .references(() => variants.id, { onDelete: 'cascade' }),
    contentItemId: integer('content_item_id')
      .notNull()
      .references(() => identities.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
    section: text('section').notNull().default('education'),
    isVisible: integer('is_visible', { mode: 'boolean' })
      .notNull()
      .default(true),
  },
  (table) => [
    primaryKey({ columns: [table.variantId, table.contentItemId] }),
    index('variant_item_content').on(table.contentItemId),
  ],
);
export const audit = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    entity: text('entity').notNull(),
    createdAt: text('created_at').notNull(),
    changeReference: text('change_reference'),
  },
  (table) => [index('audit_entity_time').on(table.entity, table.createdAt)],
);
export const messages = sqliteTable(
  'contact_messages',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    message: text('message').notNull(),
    subject: text('subject').notNull().default(''),
    starred: integer('starred', { mode: 'boolean' }).notNull().default(false),
    privateNote: text('private_note').notNull().default(''),
    idempotencyKey: text('idempotency_key').notNull(),
    requestHash: text('request_hash').notNull(),
    visitorHash: text('visitor_hash').notNull(),
    createdAt: integer('created_at').notNull(),
    status: text('status').notNull().default('unread'),
    notificationStatus: text('notification_status')
      .notNull()
      .default('pending'),
  },
  (table) => [
    uniqueIndex('contact_idempotency').on(table.idempotencyKey),
    index('contact_created').on(table.createdAt),
    index('contact_visitor_time').on(table.visitorHash, table.createdAt),
  ],
);
export const rateLimits = sqliteTable(
  'rate_limits',
  {
    key: text('key').primaryKey(),
    count: integer('count').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('rate_expiry').on(table.expiresAt)],
);

export const threads = sqliteTable(
  'threads',
  {
    id: text('id').primaryKey(),
    contactMessageId: text('contact_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
  },
  (table) => [index('threads_contact').on(table.contactMessageId)],
);
export const outbox = sqliteTable(
  'outbox',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id').references(() => threads.id, {
      onDelete: 'cascade',
    }),
    recipient: text('recipient').notNull(),
    subject: text('subject').notNull(),
    body: text('body').notNull(),
    status: text('status').notNull().default('pending'),
    sentAt: integer('sent_at'),
  },
  (table) => [
    index('outbox_thread').on(table.threadId),
    index('outbox_status').on(table.status),
  ],
);
