import {
  sqliteTable,
  integer,
  text,
  primaryKey,
  index,
} from 'drizzle-orm/sqlite-core';
import { locales, siteCopyKeys } from '@platform/schema';

export const siteCopy = sqliteTable('site_copy', {
  id: integer('id').primaryKey(),
});
export const siteCopyTranslations = sqliteTable(
  'site_copy_translations',
  {
    copyId: integer('copy_id')
      .notNull()
      .references(() => siteCopy.id, { onDelete: 'cascade' }),
    locale: text('locale', { enum: locales }).notNull(),
    ...Object.fromEntries(
      siteCopyKeys.map((key) => [
        key,
        text(
          key.replace(/[A-Z]/gu, (letter) => `_${letter.toLowerCase()}`),
        ).notNull(),
      ]),
    ),
  },
  (t) => [
    primaryKey({ columns: [t.copyId, t.locale] }),
    index('site_copy_locale').on(t.locale),
  ],
);
