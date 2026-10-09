import {
  and,
  asc,
  eq,
  getTableColumns,
  inArray,
  notExists,
  type SQL,
} from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import type { SQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { publicSnapshotSchema, siteCopyKeys } from '@platform/schema';
import * as core from './tables.ts';
import * as content from './foundation-tables.ts';
import * as details from './content-details.ts';
import * as files from './media.ts';
import * as copy from './site-copy.ts';

type Row = Record<string, unknown>;
type Projection = {
  table: SQLiteTable;
  fields: readonly string[];
  where?: SQL | undefined;
  translation?: {
    table: SQLiteTable;
    foreignKey: string;
    fields: readonly string[];
  };
};
const columns = (table: SQLiteTable) =>
  getTableColumns(table) as Record<string, SQLiteColumn>;
function pick(table: SQLiteTable, names: readonly string[], prefix = '') {
  const available = columns(table);
  return Object.fromEntries(
    names.map((name) => {
      const column = available[name];
      if (!column) throw new Error(`Unknown code-owned public column: ${name}`);
      return [prefix + name, column];
    }),
  );
}
const translated = (
  table: SQLiteTable,
  foreignKey: string,
  fields: readonly string[],
) => ({ table, foreignKey, fields });
const ordered = ['id', 'displayOrder'] as const;
const dated = ['startDate', 'endDate'] as const;
const location = ['city', 'country'] as const;

// This registry is a publish allowlist, deliberately independent of the editor
// registry. Every projection names its columns. Inbox, audit, private CV data,
// certificate originals and raw R2 keys have no output projection here.
export async function capturePublicSnapshot(binding: D1Database) {
  const db = drizzle(binding);
  const visibleProjects = db
    .select({ id: content.projects.id })
    .from(content.projects)
    .where(eq(content.projects.isVisible, true));
  const visibleExperience = db
    .select({ id: content.experience.id })
    .from(content.experience)
    .where(eq(content.experience.isVisible, true));
  const visibleInitiatives = db
    .select({ id: content.initiatives.id })
    .from(content.initiatives)
    .where(eq(content.initiatives.isVisible, true));
  const publicVariants = db
    .select({ id: core.variants.id })
    .from(core.variants)
    .where(eq(core.variants.isPublic, true));
  const projections: Record<string, Projection> = {
    siteCopy: {
      table: copy.siteCopy,
      fields: ['id'],
      where: eq(copy.siteCopy.id, 1),
      translation: translated(
        copy.siteCopyTranslations,
        'copyId',
        siteCopyKeys,
      ),
    },
    profile: {
      table: core.profile,
      fields: ['id', 'fullName', 'portraitMediaId', ...location],
      where: eq(core.profile.id, 1),
      translation: translated(core.profileTranslations, 'profileId', [
        'headline',
        'bio',
      ]),
    },
    contacts: {
      table: details.profileContacts,
      fields: ['kind', 'value', 'displayOrder'],
      where: and(
        eq(details.profileContacts.profileId, 1),
        eq(details.profileContacts.isPublic, true),
      ),
    },
    education: {
      table: core.education,
      fields: [...ordered, ...dated, ...location, 'schoolUrl', 'logoMediaId'],
      where: eq(core.education.isVisible, true),
      translation: translated(core.educationTranslations, 'educationId', [
        'school',
        'degree',
        'field',
        'status',
        'description',
      ]),
    },
    experience: {
      table: content.experience,
      fields: [
        ...ordered,
        ...dated,
        ...location,
        'employmentType',
        'organizationUrl',
        'logoMediaId',
      ],
      where: eq(content.experience.isVisible, true),
      translation: translated(content.experienceTranslations, 'experienceId', [
        'organization',
        'role',
        'description',
      ]),
    },
    highlights: {
      table: details.experienceHighlights,
      fields: ['id', 'experienceId', 'position'],
      where: inArray(
        details.experienceHighlights.experienceId,
        visibleExperience,
      ),
      translation: translated(
        details.experienceHighlightTranslations,
        'highlightId',
        ['body'],
      ),
    },
    experienceLinks: {
      table: details.experienceLinks,
      fields: ['experienceId', 'position', 'url'],
      where: inArray(details.experienceLinks.experienceId, visibleExperience),
    },
    achievements: {
      table: content.achievements,
      fields: [...ordered, 'achievedOn', 'verificationUrl', 'mediaId'],
      where: eq(content.achievements.isVisible, true),
      translation: translated(
        content.achievementTranslations,
        'achievementId',
        ['title', 'issuer', 'description'],
      ),
    },
    certificates: {
      table: content.certificates,
      fields: [
        ...ordered,
        'issuedOn',
        'expiresOn',
        'credentialReference',
        'verificationUrl',
        'publicMediaId',
      ],
      where: eq(content.certificates.isVisible, true),
      translation: translated(
        content.certificateTranslations,
        'certificateId',
        ['title', 'issuer', 'description'],
      ),
    },
    initiatives: {
      table: content.initiatives,
      fields: [...ordered, ...dated, 'websiteUrl', 'mediaId'],
      where: eq(content.initiatives.isVisible, true),
      translation: translated(content.initiativeTranslations, 'initiativeId', [
        'title',
        'role',
        'description',
        'purpose',
        'outcomes',
      ]),
    },
    collaborators: {
      table: details.initiativeCollaborators,
      fields: ['initiativeId', 'name', 'url', 'position'],
      where: inArray(
        details.initiativeCollaborators.initiativeId,
        visibleInitiatives,
      ),
    },
    initiativeProjects: {
      table: details.initiativeProjects,
      fields: ['initiativeId', 'projectId'],
      where: and(
        inArray(details.initiativeProjects.initiativeId, visibleInitiatives),
        inArray(details.initiativeProjects.projectId, visibleProjects),
      ),
    },
    skills: {
      table: content.skills,
      fields: [...ordered, 'categoryId'],
      where: eq(content.skills.isVisible, true),
      translation: translated(content.skillTranslations, 'skillId', [
        'name',
        'description',
      ]),
    },
    skillCategories: {
      table: content.skillCategories,
      fields: [...ordered, 'slug'],
      translation: translated(details.skillCategoryTranslations, 'categoryId', [
        'name',
      ]),
    },
    skillEvidence: {
      table: details.skillEvidence,
      fields: ['skillId', 'contentItemId', 'url'],
      where: inArray(
        details.skillEvidence.skillId,
        db
          .select({ id: content.skills.id })
          .from(content.skills)
          .where(eq(content.skills.isVisible, true)),
      ),
    },
    languages: {
      table: content.languages,
      fields: [...ordered, 'languageCode', 'certificateId'],
      where: eq(content.languages.isVisible, true),
      translation: translated(content.languageTranslations, 'languageId', [
        'name',
        'proficiency',
      ]),
    },
    projectCategories: {
      table: content.projectCategories,
      fields: [...ordered, 'slug', 'coverMediaId'],
      where: eq(content.projectCategories.isVisible, true),
      translation: translated(
        content.projectCategoryTranslations,
        'categoryId',
        ['name', 'description'],
      ),
    },
    projects: {
      table: content.projects,
      fields: [...ordered, ...dated, 'slug', 'coverMediaId', 'isFeatured'],
      where: eq(content.projects.isVisible, true),
      translation: translated(content.projectTranslations, 'projectId', [
        'title',
        'summary',
        'body',
        'role',
        'outcomes',
      ]),
    },
    projectCategoriesMap: {
      table: content.projectCategoryMap,
      fields: ['projectId', 'categoryId'],
      where: and(
        inArray(content.projectCategoryMap.projectId, visibleProjects),
        inArray(
          content.projectCategoryMap.categoryId,
          db
            .select({ id: content.projectCategories.id })
            .from(content.projectCategories)
            .where(eq(content.projectCategories.isVisible, true)),
        ),
      ),
    },
    projectTechnologies: {
      table: content.projectTechnologies,
      fields: ['projectId', 'technologyId'],
      where: inArray(content.projectTechnologies.projectId, visibleProjects),
    },
    technologies: {
      table: content.technologies,
      fields: ['id', 'name', 'slug'],
    },
    projectLinks: {
      table: content.projectLinks,
      fields: ['id', 'projectId', 'kind', 'url', 'position'],
      where: inArray(content.projectLinks.projectId, visibleProjects),
      translation: translated(content.projectLinkTranslations, 'linkId', [
        'label',
      ]),
    },
    projectImages: {
      table: content.projectImages,
      fields: ['id', 'projectId', 'mediaId', 'position'],
      where: inArray(content.projectImages.projectId, visibleProjects),
      translation: translated(content.projectImageTranslations, 'imageId', [
        'caption',
      ]),
    },
    socialLinks: {
      table: content.socialLinks,
      fields: [...ordered, 'platform', 'url'],
      where: eq(content.socialLinks.isVisible, true),
      translation: translated(content.socialLinkTranslations, 'linkId', [
        'label',
      ]),
    },
    navigation: {
      table: details.navigationItems,
      fields: [...ordered, 'path'],
      where: eq(details.navigationItems.isVisible, true),
      translation: translated(details.navigationTranslations, 'itemId', [
        'label',
      ]),
    },
    siteSettings: {
      table: content.siteSettings,
      fields: ['id', 'brandName', 'theme', 'contactEnabled', 'defaultLocale'],
      where: eq(content.siteSettings.id, 1),
      translation: translated(content.siteSettingTranslations, 'settingsId', [
        'availability',
        'footerText',
      ]),
    },
    seo: {
      table: content.seoSettings,
      fields: ['id', 'socialMediaId'],
      where: eq(content.seoSettings.id, 1),
      translation: translated(content.seoTranslations, 'settingsId', [
        'title',
        'description',
      ]),
    },
    categoryRedirects: {
      table: details.categoryRedirects,
      fields: ['oldSlug', 'categoryId'],
      where: inArray(
        details.categoryRedirects.categoryId,
        db
          .select({ id: content.projectCategories.id })
          .from(content.projectCategories)
          .where(eq(content.projectCategories.isVisible, true)),
      ),
    },
    media: {
      table: files.media,
      fields: ['id', 'contentType', 'byteSize', 'width', 'height'],
      where: and(
        eq(files.media.isPublic, true),
        notExists(
          db
            .select({ id: content.certificates.id })
            .from(content.certificates)
            .where(eq(content.certificates.originalMediaId, files.media.id)),
        ),
      ),
      translation: translated(files.mediaTranslations, 'mediaId', ['altText']),
    },
    publicVariant: {
      table: core.variants,
      fields: ['id', 'template'],
      where: eq(core.variants.isPublic, true),
      translation: translated(core.variantTranslations, 'variantId', [
        'summary',
        'profileHeading',
        'educationHeading',
        'presentLabel',
      ]),
    },
    selections: {
      table: core.variantItems,
      fields: ['contentItemId', 'section', 'position'],
      where: and(
        inArray(core.variantItems.variantId, publicVariants),
        eq(core.variantItems.isVisible, true),
      ),
    },
    overrides: {
      table: content.variantItemTranslations,
      fields: ['contentItemId', 'locale', 'bulletOverride'],
      where: inArray(content.variantItemTranslations.variantId, publicVariants),
    },
  };
  const entries = Object.entries(projections);
  const queries = entries.map(([, projection]) => {
    const { table, fields, translation, where } = projection;
    const selected = pick(table, fields);
    const sorted = fields.map((field) => asc(columns(table)[field]!));
    if (!translation)
      return db
        .select(selected)
        .from(table)
        .where(where)
        .orderBy(...sorted);
    return db
      .select({
        ...selected,
        ...pick(
          translation.table,
          ['locale', ...translation.fields],
          'translated_',
        ),
      })
      .from(table)
      .leftJoin(
        translation.table,
        eq(
          columns(table).id!,
          columns(translation.table)[translation.foreignKey]!,
        ),
      )
      .where(where)
      .orderBy(...sorted, asc(columns(translation.table).locale!));
  });
  // D1 batch is a consistent transaction. Joining translations keeps the entire
  // capture below the Free plan's 50 queries per Worker invocation.
  if (queries.length + 1 > 45)
    throw new Error('Public snapshot query budget exceeded');
  const [stateRows, ...results] = await db.batch([
    db
      .select({ revision: core.state.revision })
      .from(core.state)
      .where(eq(core.state.id, 1)),
    ...queries,
  ]);
  const captured: Record<string, Row[]> = {};
  entries.forEach(([key, projection], index) => {
    const rows = results[index] as Row[];
    if (!projection.translation) {
      captured[key] = rows;
      return;
    }
    const grouped = new Map<unknown, Row>();
    for (const row of rows) {
      let record = grouped.get(row.id);
      if (!record) {
        record = Object.fromEntries(
          projection.fields.map((field) => [field, row[field]]),
        );
        record.translations = [];
        grouped.set(row.id, record);
      }
      if (row.translated_locale !== null) {
        (record.translations as Row[]).push(
          Object.fromEntries(
            ['locale', ...projection.translation.fields].map((field) => [
              field,
              row['translated_' + field],
            ]),
          ),
        );
      }
    }
    captured[key] = [...grouped.values()];
  });
  const rows = (key: string) => captured[key] ?? [];
  const orderedRows = (key: string) =>
    [...rows(key)].sort(
      (a, b) =>
        Number(a.displayOrder ?? a.position ?? a.id ?? 0) -
          Number(b.displayOrder ?? b.position ?? b.id ?? 0) ||
        Number(a.id ?? 0) - Number(b.id ?? 0),
    );
  const children = (key: string, foreignKey: string, value: unknown) =>
    orderedRows(key).filter((row) => row[foreignKey] === value);
  // These objects contain only the explicit projections above, never whole DB
  // rows. Removing join keys does not broaden the field allowlist.
  const omit = (row: Row, keys: readonly string[]) =>
    Object.fromEntries(
      Object.entries(row).filter(([key]) => !keys.includes(key)),
    );
  const one = (key: string) => {
    const row = rows(key)[0];
    if (!row || rows(key).length !== 1)
      throw new Error(`Required public record missing: ${key}`);
    return row;
  };
  const ids = (key: string) => new Set(rows(key).map((row) => row.id));
  const mediaIds = ids('media');
  const usedMedia = new Set<unknown>();
  const mediaRef = (value: unknown) => {
    if (!mediaIds.has(value)) return null;
    usedMedia.add(value);
    return value;
  };
  const publicKinds = new Map<unknown, string>();
  for (const [key, kind] of Object.entries({
    education: 'education',
    experience: 'experience',
    achievements: 'achievement',
    certificates: 'certificate',
    initiatives: 'initiative',
    skills: 'skill',
    languages: 'language',
    projects: 'project',
  }))
    for (const row of rows(key)) publicKinds.set(row.id, kind);
  const usedTechnologies = new Set(
    rows('projectTechnologies').map((row) => row.technologyId),
  );
  const usedSkillCategories = new Set(
    rows('skills').map((row) => row.categoryId),
  );
  const profile = one('profile');
  const seo = one('seo');
  const result = {
    schemaVersion: 2,
    siteCopy: (one('siteCopy').translations as Row[]).map((row) => ({
      locale: row.locale,
      values: omit(row, ['locale']),
    })),
    revision: stateRows[0]?.revision,
    generatedAt: new Date().toISOString(),
    profile: {
      ...omit(profile, ['id']),
      portraitMediaId: mediaRef(profile.portraitMediaId),
      contacts: orderedRows('contacts'),
    },
    education: orderedRows('education').map((row) => ({
      ...row,
      logoMediaId: mediaRef(row.logoMediaId),
    })),
    experience: orderedRows('experience').map((row) => ({
      ...row,
      logoMediaId: mediaRef(row.logoMediaId),
      highlights: children('highlights', 'experienceId', row.id).map((r) =>
        omit(r, ['id', 'experienceId']),
      ),
      links: children('experienceLinks', 'experienceId', row.id).map((r) =>
        omit(r, ['experienceId']),
      ),
    })),
    achievements: orderedRows('achievements').map((row) => ({
      ...row,
      mediaId: mediaRef(row.mediaId),
    })),
    certificates: orderedRows('certificates').map((row) => ({
      ...row,
      publicMediaId: mediaRef(row.publicMediaId),
    })),
    initiatives: orderedRows('initiatives').map((row) => ({
      ...row,
      mediaId: mediaRef(row.mediaId),
      collaborators: children('collaborators', 'initiativeId', row.id).map(
        (r) => omit(r, ['initiativeId']),
      ),
      projectIds: children('initiativeProjects', 'initiativeId', row.id).map(
        (r) => r.projectId,
      ),
    })),
    skillCategories: orderedRows('skillCategories').filter((row) =>
      usedSkillCategories.has(row.id),
    ),
    skills: orderedRows('skills').map((row) => ({
      ...row,
      evidence: children('skillEvidence', 'skillId', row.id)
        .filter((r) => r.url !== null || publicKinds.has(r.contentItemId))
        .map((r) => ({
          contentItemId: publicKinds.has(r.contentItemId)
            ? r.contentItemId
            : null,
          url: r.url,
        })),
    })),
    languages: orderedRows('languages').map((row) => ({
      ...row,
      certificateId: ids('certificates').has(row.certificateId)
        ? row.certificateId
        : null,
    })),
    projectCategories: orderedRows('projectCategories').map((row) => ({
      ...row,
      coverMediaId: mediaRef(row.coverMediaId),
    })),
    projects: orderedRows('projects').map((row) => ({
      ...row,
      coverMediaId: mediaRef(row.coverMediaId),
      categoryIds: children('projectCategoriesMap', 'projectId', row.id).map(
        (r) => r.categoryId,
      ),
      technologyIds: children('projectTechnologies', 'projectId', row.id).map(
        (r) => r.technologyId,
      ),
      links: children('projectLinks', 'projectId', row.id).map((r) =>
        omit(r, ['id', 'projectId']),
      ),
      images: children('projectImages', 'projectId', row.id)
        .filter((r) => mediaRef(r.mediaId) !== null)
        .map((r) => omit(r, ['id', 'projectId'])),
    })),
    technologies: rows('technologies').filter((row) =>
      usedTechnologies.has(row.id),
    ),
    socialLinks: orderedRows('socialLinks'),
    navigation: orderedRows('navigation'),
    siteSettings: omit(one('siteSettings'), ['id']),
    seo: { ...omit(seo, ['id']), socialMediaId: mediaRef(seo.socialMediaId) },
    categoryRedirects: rows('categoryRedirects'),
    publicVariant: {
      ...one('publicVariant'),
      items: orderedRows('selections')
        .filter((row) => publicKinds.has(row.contentItemId))
        .map((row) => ({
          ...row,
          kind: publicKinds.get(row.contentItemId),
          translations: children(
            'overrides',
            'contentItemId',
            row.contentItemId,
          ).map((r) => omit(r, ['contentItemId'])),
        })),
    },
    media: rows('media').filter((row) => usedMedia.has(row.id)),
  };
  return publicSnapshotSchema.parse(result);
}
