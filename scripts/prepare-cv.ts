import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { locales, snapshotSchema } from '@platform/schema';
import {
  assembleCv,
  renderLatex,
  cvCacheKey,
  templateVersion,
} from '@platform/cv-engine';

const fonts = z
  .object({
    checksums: z.record(
      z.string().regex(/^[A-Za-z0-9.-]+$/u),
      z.string().regex(/^[a-f0-9]{64}$/u),
    ),
  })
  .parse(
    JSON.parse(
      await readFile('packages/cv-engine/fonts/manifest.json', 'utf8'),
    ),
  );
for (const [name, expected] of Object.entries(fonts.checksums)) {
  const actual = createHash('sha256')
    .update(await readFile(`packages/cv-engine/fonts/${name}`))
    .digest('hex');
  if (actual !== expected)
    throw new Error(`Bundled font checksum mismatch: ${name}`);
}
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
