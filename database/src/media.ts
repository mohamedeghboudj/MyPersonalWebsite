import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { locales } from '@platform/schema';
export const media = sqliteTable('media', {
  id: integer('id').primaryKey(),
  r2Key: text('r2_key').notNull().unique(),
  contentType: text('content_type', {
    enum: [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/avif',
      'application/pdf',
    ],
  }).notNull(),
  byteSize: integer('byte_size').notNull(),
  width: integer('width'),
  height: integer('height'),
  isPublic: integer('is_public', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});
export const mediaTranslations = sqliteTable(
  'media_translations',
  {
    mediaId: integer('media_id')
      .notNull()
      .references(() => media.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    altText: text('alt_text').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.mediaId, t.locale] }),
    index('media_locale').on(t.locale),
  ],
);
export const mediaCleanup = sqliteTable('media_cleanup', {
  r2Key: text('r2_key').primaryKey(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(datetime('now'))`),
});
