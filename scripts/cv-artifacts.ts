import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  locales,
  localeSchema,
  publicSnapshotSchema,
  snapshotSchema,
  type Locale,
  type PublicSnapshot,
} from '@platform/schema';
import {
  assemblePublicCv,
  assembleCv,
  cvCacheKey,
  renderLatex,
  templateVersion,
} from '@platform/cv-engine';

const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const cvDigest = (value: string | Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
export const preparedCvManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    templateVersion: z.string().min(1),
    revision: z.number().int().nonnegative(),
    locale: localeSchema,
    snapshotSha256: digest,
    cacheKey: digest,
    texSha256: digest,
  })
  .strict();
const compiledCvManifestSchema = preparedCvManifestSchema
  .extend({
    pdfSha256: digest,
    byteSize: z
      .number()
      .int()
      .positive()
      .max(8 * 1024 * 1024),
  })
  .strict();
async function readPdf(path: string) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 5 || info.size > 8 * 1024 * 1024)
    throw new Error('Invalid compiled PDF size');
  return readFile(path);
}
export async function readPreparedCv(directory: string, locale: Locale) {
  const manifest = preparedCvManifestSchema.parse(
    JSON.parse(
      await readFile(resolve(directory, `${locale}.manifest.json`), 'utf8'),
    ),
  );
  const tex = await readFile(resolve(directory, `${locale}.tex`), 'utf8');
  if (
    manifest.locale !== locale ||
    manifest.templateVersion !== templateVersion ||
    cvDigest(tex) !== manifest.texSha256
  )
    throw new Error('Prepared CV source does not match its manifest');
  return { manifest, tex };
}
// Called only after the sandboxed compiler exits successfully. The marker binds
// the compiled bytes to the exact prepared source, not just a revision number.
export async function sealCompiledCv(directory: string, locale: Locale) {
  const { manifest } = await readPreparedCv(directory, locale);
  const source = await readFile(resolve(directory, locale, 'cv.tex'));
  const pdf = await readPdf(resolve(directory, locale, 'cv.pdf'));
  if (
    cvDigest(source) !== manifest.texSha256 ||
    pdf.subarray(0, 5).toString() !== '%PDF-'
  )
    throw new Error('Compiler output does not match its prepared source');
  const compiled = compiledCvManifestSchema.parse({
    ...manifest,
    pdfSha256: cvDigest(pdf),
    byteSize: pdf.length,
  });
  await writeFile(
    resolve(directory, `${locale}.compiled.json`),
    JSON.stringify(compiled),
  );
  return compiled;
}
export async function verifySnapshotCvs(raw: unknown, directory: string) {
  const snapshot =
    raw &&
    typeof raw === 'object' &&
    'schemaVersion' in raw &&
    raw.schemaVersion === 2
      ? publicSnapshotSchema.parse(raw)
      : snapshotSchema.parse(raw);
  const snapshotSha256 = cvDigest(JSON.stringify(snapshot));
  const results = [];
  for (const locale of locales) {
    const payload =
      snapshot.schemaVersion === 2
        ? assemblePublicCv(snapshot, locale)
        : assembleCv(snapshot, locale);
    const manifest = compiledCvManifestSchema.parse(
      JSON.parse(
        await readFile(resolve(directory, `${locale}.compiled.json`), 'utf8'),
      ),
    );
    const pdf = await readPdf(resolve(directory, locale, 'cv.pdf'));
    if (
      manifest.locale !== locale ||
      manifest.templateVersion !== templateVersion ||
      manifest.revision !== snapshot.revision ||
      manifest.snapshotSha256 !== snapshotSha256 ||
      manifest.cacheKey !== (await cvCacheKey(payload)) ||
      manifest.texSha256 !== cvDigest(renderLatex(payload)) ||
      manifest.pdfSha256 !== cvDigest(pdf) ||
      manifest.byteSize !== pdf.length ||
      pdf.subarray(0, 5).toString() !== '%PDF-'
    )
      throw new Error(
        `Public ${locale} CV does not match the site snapshot or compiled bytes`,
      );
    results.push({
      locale,
      pdf,
      manifest,
    });
  }
  return results;
}
export const verifyPublicCvs = (snapshot: PublicSnapshot, directory: string) =>
  verifySnapshotCvs(publicSnapshotSchema.parse(snapshot), directory);
export async function stageVerifiedPublicCvs(
  snapshot: PublicSnapshot,
  source: string,
  output: string,
) {
  // Validate the whole set before copying any PDF. A missing language fails the build.
  const files = await verifyPublicCvs(snapshot, source);
  await mkdir(resolve(output, 'cv'), { recursive: true });
  for (const file of files)
    await writeFile(resolve(output, 'cv', `${file.locale}.pdf`), file.pdf);
  return files.map((file) => `cv/${file.locale}.pdf`);
}
