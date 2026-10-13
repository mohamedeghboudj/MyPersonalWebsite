import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { resolve } from 'node:path';
import {
  locales,
  snapshotSchema,
  publicSnapshotSchema,
} from '@platform/schema';
import { cvDigest } from './cv-artifacts.ts';
import { cvBuildEnvSchema } from '@platform/config';
import {
  assembleCv,
  assemblePublicCv,
  renderLatex,
  cvCacheKey,
  templateVersion,
} from '@platform/cv-engine';

const config = cvBuildEnvSchema.parse(process.env);
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
const input: unknown = JSON.parse(
  await readFile(config.CV_SNAPSHOT_PATH, 'utf8'),
);
const snapshot =
  input &&
  typeof input === 'object' &&
  'schemaVersion' in input &&
  input.schemaVersion === 2
    ? publicSnapshotSchema.parse(input)
    : snapshotSchema.parse(input);
const output = resolve(config.CV_OUTPUT_DIR);
await mkdir(output, { recursive: true });
for (const locale of locales) {
  const payload =
    snapshot.schemaVersion === 2
      ? assemblePublicCv(snapshot, locale)
      : assembleCv(snapshot, locale);
  const tex = renderLatex(payload);
  await writeFile(resolve(output, `${locale}.tex`), tex, 'utf8');
  await writeFile(
    resolve(output, `${locale}.manifest.json`),
    JSON.stringify(
      {
        schemaVersion: 1,
        templateVersion,
        snapshotSha256: cvDigest(JSON.stringify(snapshot)),
        texSha256: cvDigest(tex),
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
