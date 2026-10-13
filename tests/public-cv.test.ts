import { beforeAll, describe, expect, it } from 'vitest';
import { capturePublicSnapshot } from '@platform/database';
import { assemblePublicCv, cvCacheKey, renderLatex } from '@platform/cv-engine';
import type { PublicSnapshot } from '@platform/schema';
import { locales } from '@platform/schema';
import { mkdir, mkdtemp, readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { templateVersion } from '@platform/cv-engine';
import {
  cvDigest,
  sealCompiledCv,
  stageVerifiedPublicCvs,
  verifyPublicCvs,
  readPreparedCv,
  verifyCvSectionPagination,
} from '../scripts/cv-artifacts';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import { publicCvFixture } from './fixtures/public-cv';

let snapshot: PublicSnapshot;
beforeAll(async () => {
  const local = await localDatabase();
  try {
    await migrateTestDatabase(local.content, local.inbox);
    snapshot = publicCvFixture(await capturePublicSnapshot(local.content));
  } finally {
    await local.runtime.dispose();
  }
});
describe('CV from the exact public snapshot', () => {
  it('resolves all eight content types, respects selection order and omits unselected items', () => {
    const source = structuredClone(snapshot);
    source.education.push({ ...source.education[0]!, id: 999 });
    const payload = assemblePublicCv(source, 'en');
    expect(
      payload.sections?.flatMap((section) =>
        section.entries.map((entry) => entry.id),
      ),
    ).toEqual([11, 16, 18, 12, 13, 14, 17, 15]);
    expect(payload.target).toBeNull();
    expect(payload.contacts).toEqual(['candidate@example.com']);
    const tex = renderLatex(payload);
    expect(tex).toContain('A\\&B');
    expect(tex).toContain('100\\%');
    expect(tex).toContain('\\begin{tightitemize}');
    expect(tex).toContain(
      '\\skillrow{French\\label{cv-entry-17}}{Example proficiency}',
    );
    expect(tex).not.toContain('Application to');
  });
  it('does not reorder interleaved sections or accept missing, wrong-kind or duplicate selections', () => {
    const source = structuredClone(snapshot);
    source.publicVariant.items[2]!.section = 'education';
    expect(
      assemblePublicCv(source, 'en')
        .sections?.slice(0, 3)
        .map((section) => section.key),
    ).toEqual(['education', 'skills', 'education']);
    source.publicVariant.items[0]!.kind = 'project';
    expect(() => assemblePublicCv(source, 'en')).toThrow('missing');
    source.publicVariant.items[0]!.kind = 'education';
    source.publicVariant.items[0]!.contentItemId = 999;
    expect(() => assemblePublicCv(source, 'en')).toThrow('missing');
    source.publicVariant.items[0]!.contentItemId = 11;
    source.publicVariant.items.push({ ...source.publicVariant.items[0]! });
    expect(() => assemblePublicCv(source, 'en')).toThrow('Duplicate');
  });
  it('applies localized bullet overrides without changing the factual title and preserves fallback direction', () => {
    const source = structuredClone(snapshot);
    source.publicVariant.items[2]!.translations = [
      {
        locale: 'en',
        bulletOverride: 'Focused example outcome.\nSecond example outcome.',
      },
    ];
    source.projects[0]!.translations = source.projects[0]!.translations.filter(
      (row) => row.locale === 'en',
    );
    const payload = assemblePublicCv(source, 'ar');
    const project = payload
      .sections!.flatMap((section) => section.entries)
      .find((entry) => entry.kind === 'project')!;
    expect(project.title).toEqual({ value: 'Project Atlas', locale: 'en' });
    expect(project.paragraphs).toEqual([]);
    expect(project.bullets).toHaveLength(2);
    const tex = renderLatex(payload);
    expect(tex).toContain('\\textenglish{Project Atlas}');
    expect(tex).toContain('\\item \\textenglish{Focused example outcome.}');
    source.projects[0]!.translations = [
      {
        ...source.projects[0]!.translations[0]!,
        locale: 'fr',
        title: 'Projet de démonstration',
      },
    ];
    expect(renderLatex(assemblePublicCv(source, 'ar'))).toContain(
      '\\textfrench{Projet de démonstration}',
    );
    source.publicVariant.translations =
      source.publicVariant.translations.filter((row) => row.locale === 'ar');
    expect(renderLatex(assemblePublicCv(source, 'fr'))).toContain(
      '\\textarabic{',
    );
  });
  it('rejects control sequences in newly rendered headers, dates, entries and overrides', () => {
    for (const change of [
      (source: PublicSnapshot) => {
        source.profile.contacts[0]!.value = '\\input{private}';
      },
      (source: PublicSnapshot) => {
        source.projects[0]!.translations[0]!.role = '\\write18{bad}';
      },
      (source: PublicSnapshot) => {
        source.publicVariant.items[0]!.section = '\\include{bad}';
      },
      (source: PublicSnapshot) => {
        source.publicVariant.items[0]!.translations = [
          { locale: 'en', bulletOverride: '\\catcode' },
        ];
      },
      (source: PublicSnapshot) => {
        source.publicVariant.translations[0]!.presentLabel = '\\input{bad}';
      },
    ]) {
      const source = structuredClone(snapshot);
      change(source);
      expect(() => renderLatex(assemblePublicCv(source, 'en'))).toThrow(
        'TeX control',
      );
    }
  });
  it('invalidates resolved-payload cache keys for content, ordering, overrides and locale, not unrelated site copy', async () => {
    const key = await cvCacheKey(assemblePublicCv(snapshot, 'en'));
    for (const change of [
      (source: PublicSnapshot) => {
        source.projects[0]!.translations[0]!.summary = 'Changed facts';
      },
      (source: PublicSnapshot) => {
        source.publicVariant.items[0]!.position = 99;
      },
      (source: PublicSnapshot) => {
        source.publicVariant.items[0]!.translations = [
          { locale: 'en', bulletOverride: 'Changed wording' },
        ];
      },
    ]) {
      const source = structuredClone(snapshot);
      change(source);
      expect(await cvCacheKey(assemblePublicCv(source, 'en'))).not.toBe(key);
    }
    expect(await cvCacheKey(assemblePublicCv(snapshot, 'fr'))).not.toBe(key);
    const source = structuredClone(snapshot);
    source.siteCopy[0]!.values.contactHeading = 'Unrelated website heading';
    expect(await cvCacheKey(assemblePublicCv(source, 'en'))).toBe(key);
  });
});

async function compiledFixture() {
  await mkdir(resolve('artifacts/cv-manifest-tests'), { recursive: true });
  const directory = await mkdtemp(resolve('artifacts/cv-manifest-tests/run-'));
  for (const locale of locales) {
    const payload = assemblePublicCv(snapshot, locale);
    const tex = renderLatex(payload);
    await mkdir(resolve(directory, locale));
    await writeFile(resolve(directory, `${locale}.tex`), tex);
    await writeFile(resolve(directory, locale, 'cv.tex'), tex);
    // Simulated compiler bytes test artifact binding only; Actions performs
    // the actual full TeX Live compile and visual proof separately.
    await writeFile(
      resolve(directory, locale, 'cv.pdf'),
      `%PDF-1.4\nSIMULATED-${locale}`,
    );
    await writeFile(
      resolve(directory, `${locale}.manifest.json`),
      JSON.stringify({
        schemaVersion: 1,
        templateVersion,
        revision: snapshot.revision,
        locale,
        snapshotSha256: cvDigest(JSON.stringify(snapshot)),
        cacheKey: await cvCacheKey(payload),
        texSha256: cvDigest(tex),
      }),
    );
    await sealCompiledCv(directory, locale);
  }
  return directory;
}
describe('public PDF artifact gate', () => {
  it('rejects missing or orphaned section headings using actual TeX page labels', () => {
    const tex = '\\label{cv-section-0-first-11}';
    const heading = '\\newlabel{cv-section-0-first-11}{{}{1}}';
    expect(
      verifyCvSectionPagination(
        tex,
        `${heading}\n\\newlabel{cv-entry-11}{{}{1}}`,
      ),
    ).toBe(1);
    expect(() =>
      verifyCvSectionPagination(
        tex,
        `${heading}\n\\newlabel{cv-entry-11}{{}{2}}`,
      ),
    ).toThrow('orphaned');
    expect(() => verifyCvSectionPagination(tex, heading)).toThrow('missing');
    expect(() =>
      verifyCvSectionPagination(tex, `${heading}\n${heading}`),
    ).toThrow('Duplicate');
    expect(
      verifyCvSectionPagination('Legacy template without section labels', ''),
    ).toBe(0);
  });
  it('stages all three verified byte sequences and rejects changed snapshots or tampered PDFs', async () => {
    const source = await compiledFixture();
    const output = resolve(source, 'site');
    expect(await stageVerifiedPublicCvs(snapshot, source, output)).toEqual([
      'cv/en.pdf',
      'cv/fr.pdf',
      'cv/ar.pdf',
    ]);
    for (const locale of locales)
      expect(await readFile(resolve(output, 'cv', `${locale}.pdf`))).toEqual(
        await readFile(resolve(source, locale, 'cv.pdf')),
      );
    const stale = structuredClone(snapshot);
    stale.siteCopy[0]!.values.contactHeading =
      'Unrelated edit still requires the same captured snapshot';
    await expect(verifyPublicCvs(stale, source)).rejects.toThrow('snapshot');
    await writeFile(resolve(source, 'ar', 'cv.pdf'), '%PDF-1.4\nTAMPERED');
    await expect(verifyPublicCvs(snapshot, source)).rejects.toThrow(
      'compiled bytes',
    );
  });
  it('rejects stale template metadata and modified TeX before compiler use', async () => {
    const source = await compiledFixture();
    const path = resolve(source, 'en.compiled.json');
    const manifest = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(
      path,
      JSON.stringify({ ...manifest, templateVersion: 'stale-template' }),
    );
    await expect(verifyPublicCvs(snapshot, source)).rejects.toThrow('snapshot');
    await writeFile(resolve(source, 'en.tex'), 'modified');
    await expect(readPreparedCv(source, 'en')).rejects.toThrow('Prepared');
  });
  it('does not copy a partial language set', async () => {
    const source = await compiledFixture();
    await unlink(resolve(source, 'ar.compiled.json'));
    await expect(
      stageVerifiedPublicCvs(snapshot, source, resolve(source, 'site')),
    ).rejects.toThrow();
    await expect(readFile(resolve(source, 'site/cv/en.pdf'))).rejects.toThrow();
  });
});
