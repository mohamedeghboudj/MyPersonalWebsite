import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { createAdmin } from '../apps/admin/src/index';
import {
  capturePublicSnapshot,
  editorOverview,
  saveEditor,
  readEditor,
  media,
  mediaTranslations,
  certificates,
  projects,
  profile,
  variantItems,
  variantItemTranslations,
  categoryRedirects,
} from '@platform/database';
import {
  editorModules,
  emptyEditorRecord,
  publicSnapshotSchema,
  type EditorModule,
  type EditorRecord,
} from '@platform/schema';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';

let local: Awaited<ReturnType<typeof localDatabase>>;
const ids = new Map<string, number>();
beforeAll(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
  for (const module of editorModules.filter(
    (m) => m.key !== 'media' && m.key !== 'cvVariants',
  )) {
    const record = example(module);
    const result = await saveEditor(
      local.content,
      module.key,
      module.singleton ? 1 : null,
      record,
      (await editorOverview(local.content)).revision,
      'synthetic-owner',
    );
    ids.set(module.key, result.id);
  }
});
afterAll(async () => {
  await local?.runtime.dispose();
});

function example(module: EditorModule): EditorRecord {
  const record = emptyEditorRecord(module);
  for (const field of module.fields) {
    if (field.type === 'text')
      record[field.key] =
        field.key === 'slug'
          ? `example-${module.key.toLowerCase()}`
          : field.key === 'path'
            ? '/projects/'
            : field.key === 'languageCode'
              ? 'en'
              : `Example ${field.label}`;
    if (field.type === 'date' && field.required)
      record[field.key] = '2020-01-01';
    if (field.key === 'isVisible') record[field.key] = true;
    if (field.type === 'url' && field.required)
      record[field.key] = 'https://example.com';
  }
  if (module.translated)
    record.translations = ['en', 'fr', 'ar'].map((locale) => ({
      locale,
      ...Object.fromEntries(
        module.translated!.map((field) => [
          field.key,
          locale === 'ar' ? 'نص تجريبي' : `${locale} ${field.label}`,
        ]),
      ),
    }));
  return record;
}
async function edit(key: string, changes: EditorRecord) {
  const id = ids.get(key)!;
  const current = await readEditor(local.content, key, id);
  return saveEditor(
    local.content,
    key,
    id,
    { ...current.record, ...changes },
    current.revision,
    'synthetic-owner',
  );
}

describe('public v2 snapshot against real D1', () => {
  it('serves the new snapshot only through the independently authenticated owner API', async () => {
    const env = {
      CONTENT: local.content,
      INBOX: local.inbox,
      ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
      ACCESS_AUDIENCE: 'test-audience-0001',
      OWNER_EMAIL: 'owner@example.com',
      ADMIN_ORIGIN: 'https://admin.example.com',
    };
    const app = createAdmin(async () => ({
      sub: 'owner',
      email: env.OWNER_EMAIL,
    }));
    expect((await app.request('/api/public-snapshot', {}, env)).status).toBe(
      401,
    );
    const response = await app.request(
      '/api/public-snapshot',
      { headers: { 'Cf-Access-Jwt-Assertion': 'synthetic' } },
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Snapshot-SHA256')).toMatch(
      /^[a-f0-9]{64}$/u,
    );
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(publicSnapshotSchema.safeParse(await response.json()).success).toBe(
      true,
    );
  });
  it('captures every visible content type and all translations in one bounded batch', async () => {
    const counts: number[] = [];
    const binding = new Proxy(local.content, {
      get(target, property) {
        if (property === 'batch')
          return (statements: D1PreparedStatement[]) => {
            counts.push(statements.length);
            return target.batch(statements);
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    const snapshot = await capturePublicSnapshot(binding);
    expect(counts).toHaveLength(1);
    expect(counts[0]).toBeLessThanOrEqual(45);
    for (const key of [
      'education',
      'experience',
      'achievements',
      'certificates',
      'initiatives',
      'skills',
      'languages',
      'projectCategories',
      'projects',
      'socialLinks',
      'navigation',
    ] as const) {
      expect(snapshot[key], key).toHaveLength(1);
      expect(
        snapshot[key][0]?.translations.map((t) => t.locale).sort(),
        key,
      ).toEqual(['ar', 'en', 'fr']);
    }
    expect(snapshot.revision).toBe(
      (await editorOverview(local.content)).revision,
    );
  });

  it('keeps ordered relations while filtering hidden parents, private contacts and private CV data', async () => {
    const projectId = ids.get('projects')!;
    const skillId = ids.get('skills')!;
    const hidden = example(editorModules.find((m) => m.key === 'projects')!);
    hidden.slug = 'hidden-project';
    hidden.isVisible = false;
    hidden.translations = [
      {
        locale: 'en',
        title: 'PRIVATE-PROJECT',
        summary: 'PRIVATE-SUMMARY',
        body: '',
        role: '',
        outcomes: '',
      },
    ];
    const hiddenId = (
      await saveEditor(
        local.content,
        'projects',
        null,
        hidden,
        (await editorOverview(local.content)).revision,
        'owner',
      )
    ).id;
    await edit('profile', {
      contacts: [
        {
          kind: 'email',
          value: 'public@example.com',
          isPublic: true,
          displayOrder: 0,
        },
        {
          kind: 'phone',
          value: 'PRIVATE-PHONE',
          isPublic: false,
          displayOrder: 1,
        },
      ],
    });
    await edit('projects', {
      categories: [{ categoryId: ids.get('projectCategories') }],
      technologies: [{ technologyId: ids.get('technologies') }],
      links: [
        {
          kind: 'repo',
          url: 'https://example.com/source',
          position: 2,
          translations: [{ locale: 'fr', label: 'Code' }],
        },
        {
          kind: 'demo',
          url: 'https://example.com/demo',
          position: 1,
          translations: [],
        },
      ],
    });
    await edit('experience', {
      highlights: [
        { position: 2, translations: [{ locale: 'en', body: 'Second' }] },
        { position: 1, translations: [{ locale: 'ar', body: 'الأول' }] },
      ],
      links: [{ url: 'https://example.com/work', position: 0 }],
    });
    await edit('initiatives', {
      projects: [{ projectId }, { projectId: hiddenId }],
      collaborators: [{ name: 'Example collaborator', url: null, position: 0 }],
    });
    await edit('skills', {
      categoryId: ids.get('skillCategories'),
      evidence: [
        { contentItemId: projectId, url: null },
        { contentItemId: hiddenId, url: null },
        { contentItemId: null, url: 'https://example.com/evidence' },
      ],
    });
    const db = drizzle(local.content);
    await db.insert(variantItems).values([
      {
        variantId: 1,
        contentItemId: projectId,
        section: 'projects',
        position: 2,
        isVisible: true,
      },
      {
        variantId: 1,
        contentItemId: hiddenId,
        section: 'projects',
        position: 3,
        isVisible: true,
      },
      {
        variantId: 1,
        contentItemId: skillId,
        section: 'skills',
        position: 1,
        isVisible: true,
      },
      {
        variantId: 2,
        contentItemId: projectId,
        section: 'PRIVATE-SECTION',
        position: 0,
        isVisible: true,
      },
    ]);
    await db.insert(variantItemTranslations).values([
      {
        variantId: 1,
        contentItemId: projectId,
        locale: 'ar',
        bulletOverride: 'وصف عام',
      },
      {
        variantId: 1,
        contentItemId: hiddenId,
        locale: 'en',
        bulletOverride: 'PRIVATE-HIDDEN-OVERRIDE',
      },
      {
        variantId: 2,
        contentItemId: projectId,
        locale: 'en',
        bulletOverride: 'PRIVATE-VARIANT',
      },
    ]);
    await db.insert(categoryRedirects).values({
      oldSlug: 'previous-category',
      categoryId: ids.get('projectCategories')!,
    });
    const snapshot = await capturePublicSnapshot(local.content);
    expect(snapshot.projects.map((p) => p.id)).toEqual([projectId]);
    expect(snapshot.projects[0]?.categoryIds).toEqual([
      ids.get('projectCategories'),
    ]);
    expect(snapshot.projects[0]?.links.map((p) => p.position)).toEqual([1, 2]);
    expect(snapshot.technologies).toHaveLength(1);
    expect(snapshot.experience[0]?.highlights.map((h) => h.position)).toEqual([
      1, 2,
    ]);
    expect(snapshot.initiatives[0]?.projectIds).toEqual([projectId]);
    expect(snapshot.skills[0]?.evidence).toHaveLength(2);
    expect(snapshot.publicVariant.items.map((i) => i.contentItemId)).toEqual([
      skillId,
      projectId,
    ]);
    expect(snapshot.publicVariant.items[1]?.translations).toEqual([
      { locale: 'ar', bulletOverride: 'وصف عام' },
    ]);
    expect(snapshot.categoryRedirects).toEqual([
      {
        oldSlug: 'previous-category',
        categoryId: ids.get('projectCategories'),
      },
    ]);
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE-');
    expect(snapshot.profile.contacts).toEqual([
      { kind: 'email', value: 'public@example.com', displayOrder: 0 },
    ]);
  });

  it('publishes only referenced eligible media and never certificate originals or storage keys', async () => {
    const db = drizzle(local.content);
    await db.insert(media).values(
      [10, 11, 12, 13].map((id) => ({
        id,
        r2Key: `PRIVATE-KEY-${id}`,
        contentType: 'image/png' as const,
        byteSize: 100,
        isPublic: id !== 12,
      })),
    );
    await db.insert(mediaTranslations).values(
      [10, 11, 12, 13].map((mediaId) => ({
        mediaId,
        locale: 'en' as const,
        altText: mediaId === 10 ? 'PRIVATE-ORIGINAL' : 'Approved illustration',
      })),
    );
    await db
      .update(certificates)
      .set({ originalMediaId: 10, publicMediaId: 11 })
      .where(eq(certificates.id, ids.get('certificates')!));
    // Even marking an original public or reusing it as another image cannot leak it.
    await db
      .update(projects)
      .set({ coverMediaId: 10 })
      .where(eq(projects.id, ids.get('projects')!));
    await db.update(profile).set({ portraitMediaId: 12 });
    const snapshot = await capturePublicSnapshot(local.content);
    expect(snapshot.media.map((m) => m.id)).toEqual([11]);
    expect(snapshot.certificates[0]?.publicMediaId).toBe(11);
    expect(snapshot.projects[0]?.coverMediaId).toBeNull();
    expect(snapshot.profile.portraitMediaId).toBeNull();
    expect(JSON.stringify(snapshot)).not.toMatch(
      /PRIVATE-|r2Key|originalMediaId|audit|inbox/,
    );
  });

  it('fails closed for unknown output fields and unsafe navigation or link schemes', async () => {
    await local.content.exec(
      "ALTER TABLE projects ADD COLUMN private_note TEXT DEFAULT 'PRIVATE-NEW-COLUMN';\nCREATE TABLE private_publish_test(secret TEXT);\nINSERT INTO private_publish_test VALUES('PRIVATE-NEW-TABLE');",
    );
    const snapshot = await capturePublicSnapshot(local.content);
    expect(JSON.stringify(snapshot)).not.toContain('PRIVATE-');
    expect(
      publicSnapshotSchema.safeParse({ ...snapshot, privateNotes: 'secret' })
        .success,
    ).toBe(false);
    expect(
      publicSnapshotSchema.safeParse({
        ...snapshot,
        profile: { ...snapshot.profile, r2Key: 'secret' },
      }).success,
    ).toBe(false);
    expect(
      publicSnapshotSchema.safeParse({
        ...snapshot,
        navigation: [{ ...snapshot.navigation[0], path: '//evil.example' }],
      }).success,
    ).toBe(false);
    expect(
      publicSnapshotSchema.safeParse({
        ...snapshot,
        socialLinks: [
          { ...snapshot.socialLinks[0], url: 'javascript:alert(1)' },
        ],
      }).success,
    ).toBe(false);
  });
});
