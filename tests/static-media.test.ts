import { beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve, basename } from 'node:path';
import sharp from 'sharp';
import { capturePublicSnapshot } from '@platform/database';
import { type PublicSnapshot } from '@platform/schema';
import { renderPublicHeaders } from '@platform/config';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import {
  prepareStaticMedia,
  readStaticMedia,
  stageStaticMedia,
} from '../scripts/static-media';

let baseline: PublicSnapshot;
beforeAll(async () => {
  const local = await localDatabase();
  try {
    await migrateTestDatabase(local.content, local.inbox);
    baseline = await capturePublicSnapshot(local.content);
  } finally {
    await local.runtime.dispose();
  }
});
async function fixture(
  source: Buffer,
  type: 'image/jpeg' | 'image/png' | 'application/pdf',
) {
  const root = resolve('artifacts/media-tests');
  await mkdir(root, { recursive: true });
  const directory = await mkdtemp(resolve(root, 'run-'));
  await writeFile(resolve(directory, '1.bin'), source);
  const snapshot = structuredClone(baseline);
  snapshot.media = [
    {
      id: 1,
      contentType: type,
      byteSize: source.length,
      width: null,
      height: null,
      translations: [{ locale: 'en', altText: 'Synthetic test media' }],
    },
  ];
  const output = resolve(directory, 'encoded');
  return { directory, output, snapshot };
}
describe('build-time public media', () => {
  it('decodes and re-encodes responsive images, applies orientation and removes private metadata', async () => {
    const source = await sharp({
      create: { width: 1200, height: 800, channels: 3, background: '#d6d4ce' },
    })
      .withMetadata({ orientation: 6 })
      .withExif({ IFD0: { Copyright: 'PRIVATE-EXIF' } })
      .jpeg()
      .toBuffer();
    const { snapshot, directory, output } = await fixture(source, 'image/jpeg');
    const manifest = await prepareStaticMedia(snapshot, directory, output);
    expect(manifest.images['1']?.variants).toHaveLength(6);
    for (const variant of [
      ...manifest.images['1']!.variants,
      manifest.images['1']!.social,
    ]) {
      const bytes = await readFile(resolve(output, basename(variant.url)));
      const metadata = await sharp(bytes).metadata();
      expect(metadata.width).toBe(variant.width);
      expect(metadata.height).toBe(variant.height);
      expect(metadata.width).toBeLessThan(metadata.height!);
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.icc).toBeUndefined();
      expect(bytes.includes(Buffer.from('PRIVATE-EXIF'))).toBe(false);
      expect(Math.max(variant.width, variant.height)).toBeLessThanOrEqual(1600);
    }
    expect(await readStaticMedia(snapshot, output)).toEqual(manifest);
    const staged = resolve(directory, 'site');
    await stageStaticMedia(manifest, output, staged);
    expect(
      await readFile(
        resolve(staged, manifest.images['1']!.variants[0]!.url.slice(1)),
      ),
    ).not.toEqual(source);
    await expect(readFile(resolve(staged, '1.bin'))).rejects.toThrow();
    const social = manifest.images['1']!.social;
    expect(
      (
        await sharp(
          await readFile(resolve(output, basename(social.url))),
        ).metadata()
      ).format,
    ).toBe('jpeg');
  });
  it('rejects spoofed signatures, truncated files, size mismatches and missing source files', async () => {
    const { snapshot, directory, output } = await fixture(
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>'),
      'image/png',
    );
    await expect(
      prepareStaticMedia(snapshot, directory, output),
    ).rejects.toThrow('signature');
    snapshot.media[0]!.byteSize++;
    await expect(
      prepareStaticMedia(snapshot, directory, output),
    ).rejects.toThrow('size');
    snapshot.media[0]!.id = 99;
    await expect(
      prepareStaticMedia(snapshot, directory, output),
    ).rejects.toThrow();
    const jpeg = await sharp({
      create: { width: 80, height: 80, channels: 3, background: '#333333' },
    })
      .jpeg()
      .toBuffer();
    const truncated = await fixture(
      jpeg.subarray(0, Math.floor(jpeg.length / 2)),
      'image/jpeg',
    );
    await expect(
      prepareStaticMedia(
        truncated.snapshot,
        truncated.directory,
        truncated.output,
      ),
    ).rejects.toThrow();
  });
  it('rejects a stale manifest and tampered or traversal-based output paths', async () => {
    const source = await sharp({
      create: { width: 24, height: 24, channels: 3, background: '#171717' },
    })
      .png()
      .toBuffer();
    const { snapshot, directory, output } = await fixture(source, 'image/png');
    const manifest = await prepareStaticMedia(snapshot, directory, output);
    await expect(
      readStaticMedia({ ...snapshot, revision: snapshot.revision + 1 }, output),
    ).rejects.toThrow('different public snapshot');
    const first = manifest.images['1']!.variants[0]!;
    await writeFile(resolve(output, basename(first.url)), 'tampered');
    await expect(
      stageStaticMedia(manifest, output, resolve(directory, 'site')),
    ).rejects.toThrow('integrity');
    first.url = '/media/../../private.txt';
    await writeFile(resolve(output, 'manifest.json'), JSON.stringify(manifest));
    await expect(readStaticMedia(snapshot, output)).rejects.toThrow();
  });
  it('keeps deliberately public PDFs as isolated attachment downloads, outside image output', async () => {
    const source = Buffer.from(
      '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
    );
    const { snapshot, directory, output } = await fixture(
      source,
      'application/pdf',
    );
    const manifest = await prepareStaticMedia(snapshot, directory, output);
    expect(manifest.images).toEqual({});
    expect(manifest.documents['1']?.url).toMatch(
      /^\/documents\/[a-f0-9]{64}\.pdf$/u,
    );
    expect(
      await readFile(resolve(output, basename(manifest.documents['1']!.url))),
    ).toEqual(source);
    expect(renderPublicHeaders()).toContain('Content-Disposition: attachment');
    expect(renderPublicHeaders()).toContain(
      "Content-Security-Policy: sandbox; default-src 'none'",
    );
  });
});
