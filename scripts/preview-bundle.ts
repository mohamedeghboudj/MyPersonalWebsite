import { mkdir, readdir, lstat, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { previewPolicy, renderPublicHeaders } from '@platform/config';
import {
  previewBundleSchema,
  previewReleaseSchema,
  publicSnapshotSchema,
  locales,
  publicReleaseReceiptSchema,
} from '@platform/schema';
import { readCapturedInput, validateCaptureTime } from './captured-input.ts';
import { verifyPublicCvs } from './cv-artifacts.ts';
import { routes, routePath } from '../apps/site/src/lib/content.ts';

const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
const utf8 = (bytes: Uint8Array) =>
  new TextDecoder('utf-8', { fatal: true }).decode(bytes);
async function filesIn(directory: string, prefix = ''): Promise<string[]> {
  const paths: string[] = [];
  const folder = await lstat(resolve(directory, prefix));
  if (!folder.isDirectory() || folder.isSymbolicLink())
    throw new Error('Preview output contains a link or invalid directory');
  for (const entry of await readdir(resolve(directory, prefix), {
    withFileTypes: true,
  })) {
    const path = prefix + entry.name;
    if (entry.isSymbolicLink())
      throw new Error('Preview output contains a link');
    if (entry.isDirectory())
      paths.push(...(await filesIn(directory, path + '/')));
    else if (entry.isFile()) paths.push(path);
    else throw new Error('Invalid preview output entry');
    if (paths.length > previewPolicy.maxFiles)
      throw new Error('Preview output exceeds file budget');
  }
  return paths.sort();
}
async function fileBytes(
  directory: string,
  path: string,
  maxBytes: number = previewPolicy.maxFileBytes,
) {
  const file = resolve(directory, path);
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes)
    throw new Error('Invalid preview file');
  return readFile(file);
}
export async function preparePreviewBundle(
  inputDirectory: string,
  cvDirectory: string,
  siteDirectory: string,
  destination: string,
  purpose: 'preview' | 'publish' = 'preview',
) {
  const capture = await readCapturedInput(inputDirectory);
  if (capture.purpose !== purpose)
    throw new Error('Only a preview capture can become a private preview');
  const snapshot = publicSnapshotSchema.parse(
    JSON.parse(
      await readFile(resolve(inputDirectory, 'snapshot.json'), 'utf8'),
    ),
  );
  const cvs = await verifyPublicCvs(snapshot, cvDirectory);
  const html = new Set(
    locales.flatMap((locale) => [
      ...routes(snapshot).map(
        (route) => routePath(locale, route).slice(1) + 'index.html',
      ),
      `${locale === 'en' ? '' : locale + '/'}404.html`,
    ]),
  );
  const paths = await filesIn(siteDirectory);
  if (
    [
      ...html,
      '_headers',
      '_redirects',
      'robots.txt',
      'sitemap.xml',
      'llms.txt',
    ].some((path) => !paths.includes(path))
  )
    throw new Error('Incomplete preview route tree');
  const entries = [];
  let total = 0;
  // The directory must be new. Its manifest is written only after every byte
  // passes validation; an interrupted copy is never deployable.
  await mkdir(destination, { mode: 0o700 });
  for (const path of paths) {
    if (
      !html.has(path) &&
      ![
        '_headers',
        '_redirects',
        'robots.txt',
        'sitemap.xml',
        'llms.txt',
      ].includes(path) &&
      !/^_astro\/[A-Za-z0-9_.-]+\.(css|js|woff2)$/u.test(path) &&
      !/^media\/[a-f0-9]{64}\.(avif|webp|jpg)$/u.test(path) &&
      !/^documents\/[a-f0-9]{64}\.pdf$/u.test(path) &&
      !/^cv\/(en|fr|ar)\.pdf$/u.test(path)
    )
      throw new Error('Unexpected file in preview output');
    const bytes = await fileBytes(siteDirectory, path);
    total += bytes.length;
    if (total > previewPolicy.maxTotalBytes)
      throw new Error('Preview exceeds total byte budget');
    if (
      html.has(path) &&
      (((purpose === 'preview' || capture.environment === 'preview') &&
        !utf8(bytes).includes('content="noindex, nofollow"')) ||
        !utf8(bytes).includes(`data-revision="${capture.revision}"`))
    )
      throw new Error('Preview document mode or revision mismatch');
    if (
      path === '_headers' &&
      utf8(bytes) !==
        renderPublicHeaders(
          purpose === 'preview' || capture.environment === 'preview'
            ? 'preview'
            : 'production',
        )
    )
      throw new Error('Preview security headers mismatch');
    if (
      /^(media|documents)\//u.test(path) &&
      path.split('/')[1]!.split('.')[0] !== digest(bytes)
    )
      throw new Error('Preview media checksum mismatch');
    if (path.startsWith('cv/')) {
      const cv = cvs.find((file) => path === `cv/${file.locale}.pdf`);
      if (!cv || digest(bytes) !== digest(cv.pdf))
        throw new Error('Preview CV mismatch');
    }
    await mkdir(resolve(destination, 'site', dirname(path)), {
      recursive: true,
      mode: 0o700,
    });
    await writeFile(resolve(destination, 'site', path), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
    entries.push({ path, sha256: digest(bytes), bytes: bytes.length });
  }
  if (cvs.some((file) => !paths.includes(`cv/${file.locale}.pdf`)))
    throw new Error('Preview CV is missing');
  if (purpose === 'publish') {
    // Public integrity metadata only. No input key, original, actor or report.
    const receipt = publicReleaseReceiptSchema.parse({
      schemaVersion: 1,
      captureId: capture.id,
      revision: capture.revision,
      snapshotSha256: capture.snapshotSha256,
      capturedAt: capture.createdAt,
      cvs: Object.fromEntries(
        cvs.map((file) => [file.locale, digest(file.pdf)]),
      ),
    });
    const bytes = Buffer.from(JSON.stringify(receipt));
    await writeFile(resolve(destination, 'site/release.json'), bytes, {
      flag: 'wx',
      mode: 0o600,
    });
    entries.push({
      path: 'release.json',
      sha256: digest(bytes),
      bytes: bytes.length,
    });
    entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    total += bytes.length;
    if (
      entries.length > previewPolicy.maxFiles ||
      total > previewPolicy.maxTotalBytes
    )
      throw new Error('Publication exceeds package budget');
  }
  await readCapturedInput(inputDirectory);
  const release = previewReleaseSchema
    .strip()
    .parse({ ...capture, bundleSha256: digest(JSON.stringify(entries)) });
  const manifest = previewBundleSchema.parse({
    schemaVersion: 1,
    capture,
    release,
    files: entries,
  });
  await writeFile(
    resolve(destination, 'manifest.json'),
    JSON.stringify(manifest),
    { flag: 'wx', mode: 0o600 },
  );
  return manifest;
}
export async function verifyPreviewBundle(
  directory: string,
  purpose: 'preview' | 'publish' = 'preview',
) {
  const raw = await fileBytes(directory, 'manifest.json', 1024 * 1024);
  const bundle = previewBundleSchema.parse(JSON.parse(utf8(raw)));
  validateCaptureTime(bundle.capture);
  const { capture, release, files } = bundle;
  if (
    capture.purpose !== purpose ||
    release.id !== capture.id ||
    release.sequence !== capture.sequence ||
    release.revision !== capture.revision ||
    release.snapshotSha256 !== capture.snapshotSha256 ||
    release.bundleSha256 !== digest(JSON.stringify(files)) ||
    new Set(files.map((file) => file.path)).size !== files.length
  )
    throw new Error('Preview manifest identity mismatch');
  const actual = await filesIn(resolve(directory, 'site'));
  if (JSON.stringify(actual) !== JSON.stringify(files.map((file) => file.path)))
    throw new Error('Preview file set changed');
  let total = 0;
  for (const file of files) {
    const bytes = await fileBytes(resolve(directory, 'site'), file.path);
    total += bytes.length;
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256)
      throw new Error('Preview bytes changed');
  }
  if (total > previewPolicy.maxTotalBytes)
    throw new Error('Preview exceeds total byte budget');
  return bundle;
}
