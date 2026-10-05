import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { locales, snapshotSchema } from '@platform/schema';
import {
  assembleCv,
  renderLatex,
  cvCacheKey,
  templateVersion,
} from '@platform/cv-engine';

const snapshot = snapshotSchema.parse(
  JSON.parse(await readFile('artifacts/snapshot.json', 'utf8')),
);
await mkdir('artifacts/cv', { recursive: true });
for (const locale of locales) {
  const payload = assembleCv(snapshot, locale);
  const tex = renderLatex(payload);
  await writeFile(`artifacts/cv/${locale}.tex`, tex, 'utf8');
  await writeFile(
    `artifacts/cv/${locale}.manifest.json`,
    JSON.stringify(
      {
        templateVersion,
        revision: snapshot.revision,
        locale,
        cacheKey: await cvCacheKey(payload),
      },
      null,
      2,
    ),
  );
}
console.log(
  'Prepared EN/FR/AR LaTeX. Compilation and visual validation are still required.',
);
