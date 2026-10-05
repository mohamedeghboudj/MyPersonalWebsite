import { copyFile, mkdir, readFile } from 'node:fs/promises';
import { locales, snapshotSchema } from '@platform/schema';
import { assembleCv, cvCacheKey } from '@platform/cv-engine';

const snapshot = snapshotSchema.parse(
  JSON.parse(await readFile('artifacts/snapshot.json', 'utf8')),
);
await mkdir('apps/site/public/cv', { recursive: true });
for (const locale of locales) {
  const manifest = JSON.parse(
    await readFile(`artifacts/cv/${locale}.manifest.json`, 'utf8'),
  ) as { cacheKey?: string; revision?: number };
  if (
    manifest.cacheKey !== (await cvCacheKey(assembleCv(snapshot, locale))) ||
    manifest.revision !== snapshot.revision
  )
    throw new Error('CV manifest does not match the site snapshot');
  const pdf = await readFile(`artifacts/cv/${locale}/cv.pdf`);
  if (new TextDecoder().decode(pdf.subarray(0, 5)) !== '%PDF-')
    throw new Error('Missing public PDF');
  await copyFile(
    `artifacts/cv/${locale}/cv.pdf`,
    `apps/site/public/cv/${locale}.pdf`,
  );
}
