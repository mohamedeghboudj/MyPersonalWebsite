import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
  unlink,
  symlink,
} from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { capturePublishInput } from '@platform/database';
import {
  assemblePublicCv,
  cvCacheKey,
  renderLatex,
  templateVersion,
} from '@platform/cv-engine';
import { locales, type PublishInput } from '@platform/schema';
import { publishCapturePolicy, renderPublicHeaders } from '@platform/config';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import { sealPublishInput } from '../scripts/publish-input';
import { fetchCapturedInput } from '../scripts/captured-input';
import { cvDigest, sealCompiledCv } from '../scripts/cv-artifacts';
import {
  preparePreviewBundle,
  verifyPreviewBundle,
} from '../scripts/preview-bundle';
import { routes, routePath } from '../apps/site/src/lib/content';

let input: PublishInput;
beforeAll(async () => {
  const local = await localDatabase();
  try {
    await migrateTestDatabase(local.content, local.inbox);
    input = await capturePublishInput(local.content);
  } finally {
    await local.runtime.dispose();
  }
});
afterEach(() => vi.useRealTimers());
async function fixture(
  purpose: 'preview' | 'publish' = 'preview',
  environment: 'preview' | 'production' = 'preview',
) {
  await mkdir('artifacts/preview-bundle-tests', { recursive: true });
  const root = await mkdtemp(resolve('artifacts/preview-bundle-tests/run-'));
  const source = structuredClone(input);
  source.snapshot.generatedAt = new Date().toISOString();
  const snapshot = source.snapshot;
  const sealed = sealPublishInput(source);
  const capture = {
    schemaVersion: 1 as const,
    id: crypto.randomUUID(),
    purpose,
    environment,
    sequence: 1,
    revision: snapshot.revision,
    inputSha256: sealed.sha256,
    snapshotSha256: cvDigest(JSON.stringify(snapshot)),
    byteSize: sealed.body.length,
    createdAt: snapshot.generatedAt,
    expiresAt: new Date(
      Date.parse(snapshot.generatedAt) + publishCapturePolicy.retentionMs,
    ).toISOString(),
  };
  const inputDir = resolve(root, 'input'),
    cvDir = resolve(root, 'cv'),
    siteDir = resolve(root, 'site'),
    destination = resolve(root, 'bundle');
  await fetchCapturedInput(
    capture,
    async () => new Response(sealed.body).body,
    inputDir,
  );
  async function put(path: string, bytes: string | Uint8Array) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  }
  for (const locale of locales) {
    const payload = assemblePublicCv(snapshot, locale),
      tex = renderLatex(payload);
    await put(resolve(cvDir, `${locale}.tex`), tex);
    await put(resolve(cvDir, locale, 'cv.tex'), tex);
    // Binding tests use simulated bytes; CI separately compiles actual PDFs.
    const pdf = `%PDF-1.4\nSIMULATED-${locale}`;
    await put(resolve(cvDir, locale, 'cv.pdf'), pdf);
    await put(
      resolve(cvDir, `${locale}.manifest.json`),
      JSON.stringify({
        schemaVersion: 1,
        templateVersion,
        revision: snapshot.revision,
        locale,
        snapshotSha256: capture.snapshotSha256,
        cacheKey: await cvCacheKey(payload),
        texSha256: cvDigest(tex),
      }),
    );
    await sealCompiledCv(cvDir, locale);
    await put(resolve(siteDir, 'cv', `${locale}.pdf`), pdf);
    for (const path of [
      ...routes(snapshot).map(
        (route) => routePath(locale, route).slice(1) + 'index.html',
      ),
      `${locale === 'en' ? '' : locale + '/'}404.html`,
    ])
      await put(
        resolve(siteDir, path),
        `<!doctype html><meta name="robots" content="noindex, nofollow"><main data-revision="${capture.revision}">Synthetic preview</main>`,
      );
  }
  for (const [path, text] of Object.entries({
    _headers: renderPublicHeaders(environment),
    _redirects: '\n',
    'robots.txt': 'User-agent: *\nDisallow: /\n',
    'sitemap.xml': '<urlset/>',
    'llms.txt': 'Synthetic preview',
    '_astro/site.css': 'main { color: black; }',
  }))
    await put(resolve(siteDir, path), text);
  const image = Buffer.from('synthetic-derived-image');
  await put(resolve(siteDir, `media/${cvDigest(image)}.webp`), image);
  return {
    root,
    source,
    capture,
    inputDir,
    cvDir,
    siteDir,
    destination,
    put,
    prepare: () =>
      preparePreviewBundle(inputDir, cvDir, siteDir, destination, purpose),
  };
}
describe('private static preview packaging', () => {
  it('binds all localized pages and PDFs to one capture and keeps the receipt outside the served tree', async () => {
    const f = await fixture();
    const manifest = await f.prepare();
    expect(await verifyPreviewBundle(f.destination)).toEqual(manifest);
    expect(manifest.release).toMatchObject({
      id: f.capture.id,
      sequence: 1,
      snapshotSha256: f.capture.snapshotSha256,
    });
    expect(
      manifest.files.filter((file) => file.path.startsWith('cv/')),
    ).toHaveLength(3);
    expect(
      manifest.files.some((file) =>
        /manifest|snapshot|capture|\.tex|\.log|\.bin/u.test(file.path),
      ),
    ).toBe(false);
    await expect(
      readFile(resolve(f.destination, 'site/manifest.json')),
    ).rejects.toThrow();
    await expect(f.prepare()).rejects.toThrow();
  });
  it('rejects missing routes, headers and CV languages without a completed bundle marker', async () => {
    for (const path of [
      'fr/about/index.html',
      'ar/404.html',
      '_headers',
      'cv/ar.pdf',
    ]) {
      const f = await fixture();
      await unlink(resolve(f.siteDir, path));
      await expect(f.prepare()).rejects.toThrow();
      await expect(
        readFile(resolve(f.destination, 'manifest.json')),
      ).rejects.toThrow();
    }
  });
  it('rejects indexable or stale documents, tampered media and mismatched CVs', async () => {
    for (const [path, text] of [
      ['index.html', '<main data-revision="0">indexable</main>'],
      [
        'ar/404.html',
        '<meta content="noindex, nofollow"><main data-revision="999999">stale</main>',
      ],
      ['_headers', renderPublicHeaders('production')],
      ['cv/fr.pdf', '%PDF-1.4\nSTALE'],
      [`media/${'a'.repeat(64)}.webp`, 'changed image'],
    ]) {
      const f = await fixture();
      await f.put(resolve(f.siteDir, path!), text!);
      await expect(f.prepare()).rejects.toThrow();
      await expect(
        readFile(resolve(f.destination, 'manifest.json')),
      ).rejects.toThrow();
    }
  });
  it('rejects raw inputs, sources, logs, stale PDFs and symlinked output', async () => {
    for (const path of [
      'snapshot.json',
      'source.tex',
      'compile.log',
      'cv/private.pdf',
      '_astro/source.js.map',
    ]) {
      const f = await fixture();
      await f.put(resolve(f.siteDir, path), 'PRIVATE');
      await expect(f.prepare()).rejects.toThrow('Unexpected file');
    }
    const f = await fixture();
    // Windows junctions are available without Developer Mode/admin symlink rights.
    await symlink(
      f.inputDir,
      resolve(f.siteDir, 'private'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await expect(f.prepare()).rejects.toThrow('link');
  });
  it('detects file changes, extra files and expiry between packaging and inspection', async () => {
    const changed = await fixture();
    await changed.prepare();
    await writeFile(
      resolve(changed.destination, 'site/cv/en.pdf'),
      '%PDF-1.4\nCHANGED',
    );
    await expect(verifyPreviewBundle(changed.destination)).rejects.toThrow(
      'bytes changed',
    );
    const extra = await fixture();
    await extra.prepare();
    await writeFile(resolve(extra.destination, 'site/private.json'), 'PRIVATE');
    await expect(verifyPreviewBundle(extra.destination)).rejects.toThrow(
      'file set changed',
    );
    const expired = await fixture();
    await expired.prepare();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(expired.capture.expiresAt));
    await expect(verifyPreviewBundle(expired.destination)).rejects.toThrow();
  });
  it('rejects a modified receipt or unordered/duplicated manifest and refuses publish-purpose input', async () => {
    const f = await fixture();
    const manifest = await f.prepare();
    await writeFile(
      resolve(f.destination, 'manifest.json'),
      JSON.stringify({
        ...manifest,
        release: { ...manifest.release, sequence: 2 },
      }),
    );
    await expect(verifyPreviewBundle(f.destination)).rejects.toThrow(
      'identity mismatch',
    );
    const changed = {
      ...manifest,
      files: [...manifest.files, manifest.files[0]!],
    };
    changed.release = {
      ...manifest.release,
      bundleSha256: cvDigest(JSON.stringify(changed.files)),
    };
    await writeFile(
      resolve(f.destination, 'manifest.json'),
      JSON.stringify(changed),
    );
    await expect(verifyPreviewBundle(f.destination)).rejects.toThrow(
      'identity mismatch',
    );
    const separate = resolve(f.root, 'publish-input');
    await fetchCapturedInput(
      { ...f.capture, purpose: 'publish' },
      async () => new Response(sealPublishInput(f.source).body).body,
      separate,
    );
    await expect(
      preparePreviewBundle(
        separate,
        f.cvDir,
        f.siteDir,
        resolve(f.root, 'publish-bundle'),
      ),
    ).rejects.toThrow('Only a preview');
  });
});

it.each(['preview', 'production'] as const)(
  'packages all three public CVs for a %s publication and refuses cross-purpose use',
  async (environment) => {
    const f = await fixture('publish', environment);
    const bundle = await f.prepare();
    expect(
      (await verifyPreviewBundle(f.destination, 'publish')).capture.environment,
    ).toBe(environment);
    expect(
      bundle.files.filter((file) => file.path.startsWith('cv/')),
    ).toHaveLength(3);
    await expect(verifyPreviewBundle(f.destination)).rejects.toThrow(
      'identity',
    );
  },
);
