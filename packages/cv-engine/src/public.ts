import {
  localeSchema,
  publicSnapshotSchema,
  type Locale,
} from '@platform/schema';
import { resolveTranslation } from '@platform/database';
import type { CvEntry, CvPayload, CvSection, CvText } from './index.ts';

// This consumer receives only the allowlisted public snapshot. It cannot read
// D1, private variants, certificate originals, files, or a target company.
export function assemblePublicCv(
  raw: unknown,
  requestedLocale: Locale,
): CvPayload {
  const snapshot = publicSnapshotSchema.parse(raw);
  const locale = localeSchema.parse(requestedLocale);
  const profile = resolveTranslation(snapshot.profile.translations, locale);
  const variant = resolveTranslation(
    snapshot.publicVariant.translations,
    locale,
  );
  const copy = resolveTranslation(snapshot.siteCopy, locale);
  const run = (value: string, source: Locale = locale): CvText => ({
    value,
    locale: source,
  });
  const lines = (value: string, source: Locale) =>
    value
      .split(/\r?\n/u)
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => run(value, source));
  const dateRange = (start: string | null, end: string | null): CvText =>
    run(
      start ? `${start} — ${end ?? variant.presentLabel}` : (end ?? ''),
      start && !end ? variant.locale : 'en',
    );
  const selection = [...snapshot.publicVariant.items].sort(
    (a, b) => a.position - b.position || a.contentItemId - b.contentItemId,
  );
  if (
    new Set(selection.map((item) => item.contentItemId)).size !==
    selection.length
  )
    throw new Error('Duplicate public CV selection');
  const sections: CvSection[] = [];
  function find<T extends { id: number }>(items: T[], id: number): T {
    const matches = items.filter((item) => item.id === id);
    if (matches.length !== 1)
      throw new Error(
        'CV selection references missing or ambiguous public content',
      );
    return matches[0]!;
  }
  for (const selected of selection) {
    const entry: CvEntry = {
      id: selected.contentItemId,
      kind: selected.kind,
      title: run(''),
      subtitle: run(''),
      dates: run(''),
      paragraphs: [],
      bullets: [],
      links: [],
    };
    const addLink = (url: string | null) => {
      if (url) entry.links.push(url);
    };
    switch (selected.kind) {
      case 'education': {
        const item = find(snapshot.education, selected.contentItemId);
        const t = resolveTranslation(item.translations, locale);
        entry.title = run(t.degree, t.locale);
        entry.subtitle = run(t.school, t.locale);
        entry.dates = dateRange(item.startDate, item.endDate);
        entry.paragraphs = lines(
          [t.field, t.status, t.description].filter(Boolean).join('\n'),
          t.locale,
        );
        addLink(item.schoolUrl);
        break;
      }
      case 'experience': {
        const item = find(snapshot.experience, selected.contentItemId);
        const t = resolveTranslation(item.translations, locale);
        entry.title = run(t.role, t.locale);
        entry.subtitle = run(t.organization, t.locale);
        entry.dates = dateRange(item.startDate, item.endDate);
        entry.paragraphs = lines(t.description, t.locale);
        entry.bullets = [...item.highlights]
          .sort((a, b) => a.position - b.position)
          .map((highlight) => {
            const value = resolveTranslation(highlight.translations, locale);
            return run(value.body, value.locale);
          });
        addLink(item.organizationUrl);
        [...item.links]
          .sort((a, b) => a.position - b.position)
          .forEach((link) => addLink(link.url));
        break;
      }
      case 'project': {
        const item = find(snapshot.projects, selected.contentItemId);
        const t = resolveTranslation(item.translations, locale);
        entry.title = run(t.title, t.locale);
        entry.subtitle = run(t.role, t.locale);
        entry.dates = dateRange(item.startDate, item.endDate);
        entry.paragraphs = lines(t.summary, t.locale);
        entry.bullets = lines(t.outcomes, t.locale);
        const technologies = snapshot.technologies.filter((technology) =>
          item.technologyIds.includes(technology.id),
        );
        if (technologies.length)
          entry.paragraphs.push(
            run(
              technologies.map((technology) => technology.name).join(' · '),
              'en',
            ),
          );
        [...item.links]
          .sort((a, b) => a.position - b.position)
          .forEach((link) => addLink(link.url));
        break;
      }
      case 'achievement':
      case 'certificate': {
        const item =
          selected.kind === 'achievement'
            ? find(snapshot.achievements, selected.contentItemId)
            : find(snapshot.certificates, selected.contentItemId);
        const t = resolveTranslation(item.translations, locale);
        entry.title = run(t.title, t.locale);
        entry.subtitle = run(t.issuer, t.locale);
        entry.dates = run(
          ('achievedOn' in item ? item.achievedOn : item.issuedOn) ?? '',
          'en',
        );
        entry.paragraphs = lines(t.description, t.locale);
        addLink(item.verificationUrl);
        break;
      }
      case 'initiative': {
        const item = find(snapshot.initiatives, selected.contentItemId);
        const t = resolveTranslation(item.translations, locale);
        entry.title = run(t.title, t.locale);
        entry.subtitle = run(t.role, t.locale);
        entry.dates = dateRange(item.startDate, item.endDate);
        entry.paragraphs = lines(
          [t.purpose, t.description].filter(Boolean).join('\n'),
          t.locale,
        );
        entry.bullets = lines(t.outcomes, t.locale);
        addLink(item.websiteUrl);
        break;
      }
      case 'skill': {
        const item = find(snapshot.skills, selected.contentItemId);
        const t = resolveTranslation(item.translations, locale);
        entry.title = run(t.name, t.locale);
        const category = snapshot.skillCategories.find(
          (category) => category.id === item.categoryId,
        );
        if (category) {
          const c = resolveTranslation(category.translations, locale);
          entry.subtitle = run(c.name, c.locale);
        }
        entry.paragraphs = lines(t.description, t.locale);
        break;
      }
      case 'language': {
        const item = find(snapshot.languages, selected.contentItemId);
        const t = resolveTranslation(item.translations, locale);
        entry.title = run(t.name, t.locale);
        entry.subtitle = run(t.proficiency, t.locale);
        break;
      }
      default:
        selected.kind satisfies never;
    }
    if (selected.translations.length) {
      const override = resolveTranslation(selected.translations, locale);
      // An empty override is not a request to erase the factual description.
      if (override.bulletOverride.trim()) {
        entry.paragraphs = [];
        entry.bullets = lines(override.bulletOverride, override.locale);
      }
    }
    entry.links = [...new Set(entry.links)];
    // Contiguous runs preserve the exact variant order even when the owner
    // returns to a previous section later in the selection.
    let section = sections.at(-1);
    if (section?.key !== selected.section) {
      const key = selected.section as keyof typeof copy.values;
      const knownHeading = Object.hasOwn(copy.values, key)
        ? copy.values[key]
        : undefined;
      const heading =
        key === 'education'
          ? run(variant.educationHeading, variant.locale)
          : run(
              knownHeading ?? selected.section,
              knownHeading ? copy.locale : locale,
            );
      section = { key: selected.section, heading, entries: [] };
      sections.push(section);
    }
    section.entries.push(entry);
  }
  return {
    variantId: snapshot.publicVariant.id,
    locale,
    name: snapshot.profile.fullName,
    headline: profile.headline,
    headlineLocale: profile.locale,
    summary: variant.summary,
    summaryLocale: variant.locale,
    profileHeading: variant.profileHeading,
    educationHeading: variant.educationHeading,
    presentLabel: variant.presentLabel,
    target: null,
    items: [],
    sections,
    contacts: [...snapshot.profile.contacts]
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((item) => item.value),
  };
}
