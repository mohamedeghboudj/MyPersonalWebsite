import { drizzle } from 'drizzle-orm/d1';
import { eq, asc, desc } from 'drizzle-orm';
import { snapshotSchema, type Locale } from '@platform/schema';
import {
  profile,
  profileTranslations,
  education,
  educationTranslations,
  variants,
  variantTranslations,
  variantItems,
  state,
  audit,
} from './tables.ts';

// Explicit projections only. No SELECT *, spread of database rows, inbox binding,
// or caller-supplied table/column names can enter the publishing path.
export async function createSnapshot(content: D1Database) {
  return (await capturePublishSource(content)).snapshot;
}

// Save evidence is read in the same D1 batch as the immutable public snapshot.
// Only its timestamp is projected; identities and audit payloads remain private.
export async function capturePublishSource(content: D1Database) {
  const db = drizzle(content);
  const [
    revision,
    person,
    headlines,
    items,
    translations,
    presets,
    summaries,
    selections,
    saves,
  ] = await db.batch([
    db.select({ revision: state.revision }).from(state).where(eq(state.id, 1)),
    db
      .select({ fullName: profile.fullName })
      .from(profile)
      .where(eq(profile.id, 1)),
    db
      .select({
        locale: profileTranslations.locale,
        headline: profileTranslations.headline,
      })
      .from(profileTranslations)
      .where(eq(profileTranslations.profileId, 1)),
    db
      .select({
        id: education.id,
        startDate: education.startDate,
        endDate: education.endDate,
        schoolUrl: education.schoolUrl,
        displayOrder: education.displayOrder,
      })
      .from(education)
      .where(eq(education.isVisible, true))
      .orderBy(asc(education.displayOrder), asc(education.id)),
    db
      .select({
        educationId: educationTranslations.educationId,
        locale: educationTranslations.locale,
        school: educationTranslations.school,
        degree: educationTranslations.degree,
        description: educationTranslations.description,
      })
      .from(educationTranslations)
      .innerJoin(education, eq(education.id, educationTranslations.educationId))
      .where(eq(education.isVisible, true)),
    db
      .select({ id: variants.id })
      .from(variants)
      .where(eq(variants.isPublic, true)),
    db
      .select({
        locale: variantTranslations.locale,
        summary: variantTranslations.summary,
        profileHeading: variantTranslations.profileHeading,
        educationHeading: variantTranslations.educationHeading,
        presentLabel: variantTranslations.presentLabel,
      })
      .from(variantTranslations)
      .innerJoin(variants, eq(variants.id, variantTranslations.variantId))
      .where(eq(variants.isPublic, true)),
    db
      .select({
        contentItemId: variantItems.contentItemId,
        position: variantItems.position,
      })
      .from(variantItems)
      .innerJoin(variants, eq(variants.id, variantItems.variantId))
      .innerJoin(education, eq(education.id, variantItems.contentItemId))
      .where(eq(variants.isPublic, true))
      .orderBy(asc(variantItems.position), asc(variantItems.contentItemId)),
    db
      .select({ savedAt: audit.createdAt })
      .from(audit)
      .where(eq(audit.action, 'save'))
      .orderBy(desc(audit.id))
      .limit(1),
  ]);
  const publicIds = new Set(items.map((item) => item.id));
  const snapshot = snapshotSchema.parse({
    schemaVersion: 1,
    revision: revision[0]?.revision,
    generatedAt: new Date().toISOString(),
    profile: { fullName: person[0]?.fullName, translations: headlines },
    education: items.map((item) => ({
      id: item.id,
      startDate: item.startDate,
      endDate: item.endDate,
      schoolUrl: item.schoolUrl,
      displayOrder: item.displayOrder,
      translations: translations
        .filter((row) => row.educationId === item.id)
        .map((row) => ({
          locale: row.locale,
          school: row.school,
          degree: row.degree,
          description: row.description,
        })),
    })),
    publicVariant: {
      id: presets[0]?.id,
      translations: summaries,
      items: selections.filter((item) => publicIds.has(item.contentItemId)),
    },
  });
  return { snapshot, savedAt: saves[0]?.savedAt ?? null };
}

// Shared query/resolution layer: pages and CV templates do not invent fallbacks.
export function resolveTranslation<T extends { locale: Locale }>(
  rows: readonly T[],
  locale: Locale,
): T {
  const row =
    rows.find((item) => item.locale === locale) ??
    rows.find((item) => item.locale === 'en') ??
    [...rows].sort((a, b) => a.locale.localeCompare(b.locale))[0];
  if (!row) throw new Error('No translation is available');
  return row;
}
