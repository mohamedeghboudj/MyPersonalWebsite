import { drizzle } from 'drizzle-orm/d1';
import { eq, sql } from 'drizzle-orm';
import { educationInputSchema, profileSchema } from '@platform/schema';
import {
  identities,
  education,
  educationTranslations,
  audit,
  state,
  profile,
  profileTranslations,
  variantItems,
} from './tables.ts';

export async function saveEducation(
  binding: D1Database,
  id: number,
  raw: unknown,
  actor: string,
) {
  const value = educationInputSchema.parse(raw);
  const db = drizzle(binding);
  const { translations, ...facts } = value;
  await db.batch([
    db
      .insert(identities)
      .values({ id, kind: 'education' })
      .onConflictDoNothing(),
    db
      .insert(education)
      .values({ id, ...facts })
      .onConflictDoUpdate({ target: education.id, set: facts }),
    db
      .delete(educationTranslations)
      .where(eq(educationTranslations.educationId, id)),
    db
      .insert(educationTranslations)
      .values(translations.map((row) => ({ educationId: id, ...row }))),
    db
      .insert(variantItems)
      .values({ variantId: 1, contentItemId: id, position: value.displayOrder })
      .onConflictDoUpdate({
        target: [variantItems.variantId, variantItems.contentItemId],
        set: { position: value.displayOrder },
      }),
    db
      .update(state)
      .set({ revision: sql`${state.revision} + 1` })
      .where(eq(state.id, 1)),
    db.insert(audit).values({
      actor,
      action: 'save',
      entity: `education:${id}`,
      createdAt: new Date().toISOString(),
    }),
  ]);
}

export async function saveProfile(
  binding: D1Database,
  raw: unknown,
  actor: string,
) {
  const value = profileSchema.parse(raw);
  const db = drizzle(binding);
  await db.batch([
    db
      .update(profile)
      .set({ fullName: value.fullName })
      .where(eq(profile.id, 1)),
    db.delete(profileTranslations).where(eq(profileTranslations.profileId, 1)),
    db
      .insert(profileTranslations)
      .values(value.translations.map((row) => ({ profileId: 1, ...row }))),
    db
      .update(state)
      .set({ revision: sql`${state.revision} + 1` })
      .where(eq(state.id, 1)),
    db.insert(audit).values({
      actor,
      action: 'save',
      entity: 'profile:1',
      createdAt: new Date().toISOString(),
    }),
  ]);
}
