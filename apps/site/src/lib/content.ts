import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  publicSnapshotSchema,
  snapshotSchema,
  locales,
  type PublicSnapshot,
  type Locale,
} from '@platform/schema';
import { siteBuildEnvSchema } from '@platform/config';
import { resolveTranslation } from '@platform/database';

export const buildConfig = siteBuildEnvSchema.parse(process.env);
export async function readSnapshot() {
  const input: unknown = JSON.parse(
    await readFile(
      buildConfig.SITE_SNAPSHOT_PATH ??
        resolve('../../artifacts/snapshot.json'),
      'utf8',
    ),
  );
  if (
    input &&
    typeof input === 'object' &&
    'schemaVersion' in input &&
    input.schemaVersion === 2
  )
    return publicSnapshotSchema.parse(input);
  return snapshotSchema.parse(input);
}
export const direction = (locale: Locale) => (locale === 'ar' ? 'rtl' : 'ltr');
export { resolveTranslation, locales };
export function routePath(locale: Locale, path = '') {
  return `/${locale === 'en' ? '' : `${locale}/`}${path.replace(/^\/+|\/+$/gu, '')}${path.replace(/^\/+|\/+$/gu, '') ? '/' : ''}`;
}
export const absoluteUrl = (path: string) =>
  new URL(path, buildConfig.SITE_ORIGIN).href;
export function routes(snapshot: PublicSnapshot) {
  return [
    '',
    'about',
    'projects',
    'contact',
    ...snapshot.projectCategories.map(
      (category) => `projects/category/${category.slug}`,
    ),
    ...snapshot.projects.map((project) => `projects/${project.slug}`),
  ];
}
export function pageMetadata(
  snapshot: PublicSnapshot,
  locale: Locale,
  path: string,
) {
  const copy = resolveTranslation(snapshot.siteCopy, locale).values;
  const person = resolveTranslation(snapshot.profile.translations, locale);
  const seo = snapshot.seo.translations.length
    ? resolveTranslation(snapshot.seo.translations, locale)
    : null;
  const project = snapshot.projects.find(
    (item) => path === `projects/${item.slug}`,
  );
  const category = snapshot.projectCategories.find(
    (item) => path === `projects/category/${item.slug}`,
  );
  const projectText = project
    ? resolveTranslation(project.translations, locale)
    : null;
  const categoryText = category
    ? resolveTranslation(category.translations, locale)
    : null;
  const title =
    projectText?.title ??
    categoryText?.name ??
    (path === ''
      ? (seo?.title ?? snapshot.profile.fullName)
      : path === 'about'
        ? copy.about
        : path === 'contact'
          ? copy.contact
          : copy.projects);
  const description =
    projectText?.summary ??
    categoryText?.description ??
    seo?.description ??
    person.headline;
  const url = absoluteUrl(routePath(locale, path));
  const identity = {
    '@type': 'Person',
    '@id': absoluteUrl('/#person'),
    name: snapshot.profile.fullName,
    url: absoluteUrl('/'),
    description: person.headline,
    sameAs: snapshot.socialLinks.map((link) => link.url),
  };
  const entity =
    projectText && project
      ? {
          '@type': project.links.some((link) => link.kind === 'repo')
            ? 'SoftwareSourceCode'
            : 'CreativeWork',
          '@id': url,
          url,
          name: projectText.title,
          description: projectText.summary,
          inLanguage: projectText.locale,
          author: { '@id': identity['@id'] },
          ...(project.links.find((link) => link.kind === 'repo')
            ? {
                codeRepository: project.links.find(
                  (link) => link.kind === 'repo',
                )!.url,
              }
            : {}),
        }
      : {
          '@type':
            path === '' || path === 'about' ? 'ProfilePage' : 'CollectionPage',
          '@id': url,
          url,
          name: title,
          description,
          inLanguage: locale,
          mainEntity: { '@id': identity['@id'] },
        };
  return {
    title:
      path === '' ? title : `${title} — ${snapshot.siteSettings.brandName}`,
    description,
    url,
    socialMediaId:
      project?.coverMediaId ??
      category?.coverMediaId ??
      snapshot.seo.socialMediaId ??
      snapshot.profile.portraitMediaId,
    isProject: !!project,
    jsonLd: JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [identity, entity],
    })
      .replace(/</gu, '\\u003c')
      .replace(/>/gu, '\\u003e')
      .replace(/&/gu, '\\u0026'),
  };
}
export function dateLabel(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(new Date(`${value}T00:00:00Z`));
}
export function contactHref(
  contact: PublicSnapshot['profile']['contacts'][number],
) {
  if (contact.kind === 'website') return contact.value;
  return `${contact.kind === 'email' ? 'mailto' : 'tel'}:${encodeURIComponent(contact.value)}`;
}
