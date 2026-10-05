import { readFile } from 'node:fs/promises';
import { snapshotSchema, locales } from '@platform/schema';
import { resolveTranslation } from '@platform/database';

const snapshot = snapshotSchema.parse(
  JSON.parse(await readFile('artifacts/snapshot.json', 'utf8')),
);
for (const locale of locales) {
  const html = await readFile(
    `apps/site/dist/${locale === 'en' ? '' : `${locale}/`}index.html`,
    'utf8',
  );
  if (
    !html.includes(`lang="${locale}"`) ||
    !html.includes(`data-revision="${snapshot.revision}"`)
  )
    throw new Error(`Missing locale/revision: ${locale}`);
  if (/<script\b/i.test(html))
    throw new Error('Spike static output must not require JavaScript');
  if (locale === 'ar' && !html.includes('dir="rtl"'))
    throw new Error('Arabic direction missing');
  for (const item of snapshot.education) {
    if (!html.includes(resolveTranslation(item.translations, locale).school))
      throw new Error(`Content missing from first response: ${locale}`);
  }
}
console.log(
  'All three static route outputs contain the expected database revision and content.',
);
