import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat, copyFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import {
  staticMediaManifestSchema,
  publicSnapshotSchema,
  type PublicSnapshot,
  type StaticMediaManifest,
} from '@platform/schema';

export const mediaDigest = (data: string | Uint8Array) =>
  createHash('sha256').update(data).digest('hex');
export const snapshotDigest = (snapshot: PublicSnapshot) =>
  mediaDigest(JSON.stringify(publicSnapshotSchema.parse(snapshot)));
export async function prepareStaticMedia(
  snapshot: PublicSnapshot,
  sourceDirectory: string,
  outputDirectory: string,
) {
  snapshot = publicSnapshotSchema.parse(snapshot);
  if (snapshot.media.length > 100)
    throw new Error('Public media budget exceeds 100 referenced files');
  await mkdir(outputDirectory, { recursive: true });
  const manifest: StaticMediaManifest = {
    schemaVersion: 1,
    snapshotSha256: snapshotDigest(snapshot),
    images: {},
    documents: {},
  };
  for (const media of snapshot.media) {
    // IDs are schema-validated integers, never a supplied path or URL. There
    // are no remote fetches here and no original storage keys in this process.
    const sourcePath = resolve(sourceDirectory, `${media.id}.bin`);
    const sourceStat = await stat(sourcePath);
    if (
      !sourceStat.isFile() ||
      sourceStat.size !== media.byteSize ||
      sourceStat.size > 8 * 1024 * 1024
    )
      throw new Error(
        `Media ${media.id}: source size does not match the snapshot`,
      );
    const source = await readFile(sourcePath);
    if ((await fileTypeFromBuffer(source))?.mime !== media.contentType)
      throw new Error(
        `Media ${media.id}: signature does not match its declared type`,
      );
    if (media.contentType === 'application/pdf') {
      const sha256 = mediaDigest(source);
      // Only deliberately public/redacted documents survive capture. Downloads
      // are attachments under a separate sandbox CSP, never inline images.
      const url = `/documents/${sha256}.pdf`;
      await writeFile(resolve(outputDirectory, basename(url)), source);
      manifest.documents[media.id] = { url, sha256, byteSize: source.length };
      continue;
    }
    const options = {
      limitInputPixels: 40_000_000,
      failOn: 'warning' as const,
      sequentialRead: true,
    };
    const metadata = await sharp(source, options).metadata();
    if ((metadata.pages ?? 1) !== 1)
      throw new Error(
        `Media ${media.id}: animated and multi-page images are not published`,
      );
    const variants: StaticMediaManifest['images'][string]['variants'] = [];
    const encoded = new Set<string>();
    for (const size of [480, 960, 1600]) {
      for (const format of ['avif', 'webp'] as const) {
        const pipeline = sharp(source, options).autoOrient().resize({
          width: size,
          height: size,
          fit: 'inside',
          withoutEnlargement: true,
        });
        const { data, info } = await (
          format === 'avif'
            ? pipeline.avif({ quality: 55, effort: 4 })
            : pipeline.webp({ quality: 82, effort: 4 })
        ).toBuffer({ resolveWithObject: true });
        const key = `${format}:${info.width}:${info.height}`;
        if (encoded.has(key)) continue;
        encoded.add(key);
        if (data.length > 2 * 1024 * 1024)
          throw new Error(`Media ${media.id}: derivative exceeds 2 MiB`);
        const url = `/media/${mediaDigest(data)}.${format}`;
        await writeFile(resolve(outputDirectory, basename(url)), data);
        variants.push({
          url,
          format,
          width: info.width,
          height: info.height,
          byteSize: data.length,
        });
      }
    }
    const social = await sharp(source, options)
      .autoOrient()
      .resize({
        width: 1200,
        height: 1200,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    if (social.data.length > 2 * 1024 * 1024)
      throw new Error(`Media ${media.id}: social derivative exceeds 2 MiB`);
    const socialUrl = `/media/${mediaDigest(social.data)}.jpg`;
    await writeFile(resolve(outputDirectory, basename(socialUrl)), social.data);
    manifest.images[media.id] = {
      sourceSha256: mediaDigest(source),
      variants,
      social: {
        url: socialUrl,
        width: social.info.width,
        height: social.info.height,
        byteSize: social.data.length,
      },
    };
  }
  const result = staticMediaManifestSchema.parse(manifest);
  await writeFile(
    resolve(outputDirectory, 'manifest.json'),
    JSON.stringify(result),
  );
  return result;
}
export async function readStaticMedia(
  snapshot: PublicSnapshot,
  directory: string,
) {
  const manifest = staticMediaManifestSchema.parse(
    JSON.parse(await readFile(resolve(directory, 'manifest.json'), 'utf8')),
  );
  if (manifest.snapshotSha256 !== snapshotDigest(snapshot))
    throw new Error('Static media belongs to a different public snapshot');
  const ids = new Set(snapshot.media.map((media) => String(media.id)));
  if (
    Object.keys(manifest.images).some((id) => !ids.has(id)) ||
    Object.keys(manifest.documents).some((id) => !ids.has(id))
  )
    throw new Error('Unexpected media in build manifest');
  for (const media of snapshot.media)
    if (
      media.contentType === 'application/pdf'
        ? !manifest.documents[media.id] || !!manifest.images[media.id]
        : !manifest.images[media.id] || !!manifest.documents[media.id]
    )
      throw new Error(`Media ${media.id}: derivative missing or mismatched`);
  return manifest;
}
export async function stageStaticMedia(
  manifest: StaticMediaManifest,
  sourceDirectory: string,
  outputDirectory: string,
) {
  manifest = staticMediaManifestSchema.parse(manifest);
  const files = [
    ...Object.values(manifest.images).flatMap((image) => [
      ...image.variants,
      image.social,
    ]),
    ...Object.values(manifest.documents),
  ];
  for (const file of files) {
    const source = resolve(sourceDirectory, basename(file.url));
    const bytes = await readFile(source);
    if (
      bytes.length !== file.byteSize ||
      !basename(file.url).startsWith(mediaDigest(bytes))
    )
      throw new Error('Static derivative integrity check failed');
    const folder = file.url.startsWith('/media/') ? 'media' : 'documents';
    await mkdir(resolve(outputDirectory, folder), { recursive: true });
    await copyFile(
      source,
      resolve(outputDirectory, folder, basename(file.url)),
    );
  }
}
