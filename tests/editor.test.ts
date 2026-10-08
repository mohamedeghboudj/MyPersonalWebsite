import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  editorModules,
  editorRegistry,
  emptyEditorRecord,
  type EditorModule,
  type EditorRecord,
} from '@platform/schema';
import {
  saveEditor,
  readEditor,
  deleteEditor,
  listEditor,
  editorOverview,
  editorChoices,
  createSnapshot,
} from '@platform/database';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import { createAdmin } from '../apps/admin/src/index';
import { hasFreshLogin } from '../apps/admin/src/fresh-auth';

let local: Awaited<ReturnType<typeof localDatabase>>;
beforeAll(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
});
afterAll(async () => {
  await local?.runtime.dispose();
});
afterEach(() => vi.unstubAllGlobals());
const actor = 'owner-subject';
const ids = new Map<string, number>();
function example(module: EditorModule): EditorRecord {
  const record = emptyEditorRecord(module);
  for (const field of module.fields) {
    if (field.type === 'text')
      record[field.key] =
        field.key === 'slug'
          ? `example-${module.key.toLowerCase()}`
          : field.key === 'path'
            ? '/about/'
            : field.key === 'languageCode'
              ? 'en'
              : `Example ${field.label}`;
    if (field.type === 'date' && field.required)
      record[field.key] = '2020-01-01';
    if (field.type === 'url' && field.required)
      record[field.key] = 'https://example.com';
  }
  if (module.translated)
    record.translations = ['en', 'fr', 'ar'].map((locale) => ({
      locale,
      ...Object.fromEntries(
        module.translated?.map((field) => [
          field.key,
          locale === 'ar' ? 'نص تجريبي' : `${locale} ${field.label}`,
        ]) ?? [],
      ),
    }));
  return record;
}
const current = async () => (await editorOverview(local.content)).revision;
const moduleFor = (key: string) => {
  const value = editorRegistry.get(key);
  if (!value) throw new Error(key);
  return value;
};
describe('editor transactions against real local D1', () => {
  it('creates or edits every enabled content type with trilingual round trips', async () => {
    for (const module of editorModules.filter(
      (module) => module.key !== 'media',
    )) {
      const record = example(module);
      const result = await saveEditor(
        local.content,
        module.key,
        module.singleton ? 1 : null,
        record,
        await current(),
        actor,
      );
      ids.set(module.key, result.id);
      const read = await readEditor(local.content, module.key, result.id);
      expect(read.record, module.key).toEqual(record);
      expect(read.revision).toBe(result.revision);
      const listed = await listEditor(local.content, module.key);
      expect(
        listed.items.find((item) => item.id === result.id)?.locales.length,
      ).toBe(module.translated ? 3 : 0);
    }
    expect(editorRegistry.has('articles')).toBe(false);
    expect(
      (await local.content.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
  });
  it('saves nested project relations and mixed CV selections in explicit order', async () => {
    const projectId = ids.get('projects')!;
    const project = await readEditor(local.content, 'projects', projectId);
    project.record.categories = [{ categoryId: ids.get('projectCategories') }];
    project.record.technologies = [{ technologyId: ids.get('technologies') }];
    project.record.links = [
      {
        kind: 'repo',
        url: 'https://example.com/repo',
        position: 2,
        translations: [{ locale: 'ar', label: 'المصدر' }],
      },
      {
        kind: 'demo',
        url: 'https://example.com/demo',
        position: 1,
        translations: [{ locale: 'en', label: 'Demo' }],
      },
    ];
    await saveEditor(
      local.content,
      'projects',
      projectId,
      project.record,
      project.revision,
      actor,
    );
    expect(
      (await readEditor(local.content, 'projects', projectId)).record.links,
    ).toEqual([
      (project.record.links as EditorRecord[])[1],
      (project.record.links as EditorRecord[])[0],
    ]);
    const cv = await readEditor(local.content, 'cvVariants', 1);
    cv.record.items = [
      {
        contentItemId: projectId,
        section: 'projects',
        position: 2,
        isVisible: true,
        translations: [{ locale: 'ar', bulletOverride: 'تفاصيل المشروع' }],
      },
      {
        contentItemId: ids.get('skills'),
        section: 'skills',
        position: 1,
        isVisible: true,
        translations: [],
      },
    ];
    await saveEditor(
      local.content,
      'cvVariants',
      1,
      cv.record,
      cv.revision,
      actor,
    );
    expect(
      (await readEditor(local.content, 'cvVariants', 1)).record.items,
    ).toEqual([
      (cv.record.items as EditorRecord[])[1],
      (cv.record.items as EditorRecord[])[0],
    ]);
    expect(
      (await editorChoices(local.content, 'contentItems')).items.some(
        (item) => item.id === projectId && item.label.startsWith('Projects:'),
      ),
    ).toBe(true);
    // The spike's snapshot remains valid even though later phases expand its allowlist.
    await expect(createSnapshot(local.content)).resolves.toHaveProperty(
      'schemaVersion',
      1,
    );
  });
  it('rolls back identities, children, revision and audit when an FK or stale revision fails', async () => {
    const id = ids.get('projects')!;
    const before = await readEditor(local.content, 'projects', id);
    const auditBefore = await editorOverview(local.content);
    await expect(
      saveEditor(
        local.content,
        'projects',
        id,
        { ...before.record, categories: [{ categoryId: 2147483647 }] },
        before.revision,
        actor,
      ),
    ).rejects.toThrow('reference');
    expect(await readEditor(local.content, 'projects', id)).toEqual(before);
    expect(await editorOverview(local.content)).toEqual(auditBefore);
    await expect(
      saveEditor(
        local.content,
        'technologies',
        null,
        example(moduleFor('technologies')),
        before.revision - 1,
        actor,
      ),
    ).rejects.toThrow('newer edit');
    expect(await current()).toBe(before.revision);
    const results = await Promise.allSettled([
      saveEditor(
        local.content,
        'projects',
        id,
        { ...before.record, isFeatured: true },
        before.revision,
        actor,
      ),
      saveEditor(
        local.content,
        'projects',
        id,
        { ...before.record, isVisible: true },
        before.revision,
        actor,
      ),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(await current()).toBe(before.revision + 1);
  });
  it('reserves historical category URLs and can safely return to its own old slug', async () => {
    const id = ids.get('projectCategories')!;
    const before = await readEditor(local.content, 'projectCategories', id);
    await saveEditor(
      local.content,
      'projectCategories',
      id,
      { ...before.record, slug: 'renamed-category' },
      before.revision,
      actor,
    );
    expect(
      (
        await local.content
          .prepare('SELECT old_slug,category_id FROM category_redirects')
          .all()
      ).results,
    ).toContainEqual({ old_slug: before.record.slug, category_id: id });
    await expect(
      saveEditor(
        local.content,
        'projectCategories',
        null,
        before.record,
        await current(),
        actor,
      ),
    ).rejects.toThrow('reserved');
    await saveEditor(
      local.content,
      'projectCategories',
      id,
      before.record,
      await current(),
      actor,
    );
    expect(
      (
        await local.content
          .prepare('SELECT old_slug FROM category_redirects')
          .all()
      ).results,
    ).toEqual([{ old_slug: 'renamed-category' }]);
  });
  it('records changed fields and hashes atomically without copying private values', async () => {
    const profile = await readEditor(local.content, 'profile', 1);
    profile.record.contacts = [
      {
        kind: 'email',
        value: 'private-owner@example.com',
        isPublic: false,
        displayOrder: 0,
      },
    ];
    await saveEditor(
      local.content,
      'profile',
      1,
      profile.record,
      profile.revision,
      actor,
    );
    const audit = await local.content
      .prepare(
        'SELECT * FROM audit_log JOIN audit_changes ON audit_log.change_reference=audit_changes.id JOIN audit_change_fields ON audit_change_fields.change_id=audit_changes.id ORDER BY audit_log.id DESC',
      )
      .all();
    expect(JSON.stringify(audit.results)).not.toContain('private-owner@');
    expect(audit.results.some((row) => row.field === 'contacts')).toBe(true);
    expect(audit.results[0]?.after_hash).toMatch(/^[a-f0-9]{64}$/u);
    await expect(
      local.content
        .prepare("UPDATE audit_change_fields SET field='tampered'")
        .run(),
    ).rejects.toThrow();
  });
  it('preserves required records and refuses deletion of a referenced technology', async () => {
    await expect(
      deleteEditor(local.content, 'profile', 1, await current(), actor),
    ).rejects.toThrow('required');
    await expect(
      deleteEditor(local.content, 'cvVariants', 1, await current(), actor),
    ).rejects.toThrow('required');
    const revision = await current();
    await expect(
      deleteEditor(
        local.content,
        'technologies',
        ids.get('technologies')!,
        revision,
        actor,
      ),
    ).rejects.toThrow('reference');
    expect(await current()).toBe(revision);
    await deleteEditor(
      local.content,
      'projects',
      ids.get('projects')!,
      await current(),
      actor,
    );
    expect(
      (await local.content.prepare('SELECT * FROM project_links').all())
        .results,
    ).toEqual([]);
    expect(
      (await readEditor(local.content, 'cvVariants', 1)).record.items,
    ).toHaveLength(1);
  });
});
describe('editor input boundaries', () => {
  it('rejects unknown fields, invalid dates, unsafe URLs and invalid relation choices', () => {
    for (const module of editorModules) {
      const value = example(module);
      expect(
        moduleFor(module.key).input.safeParse({
          ...value,
          unknownColumn: 'reject',
        }).success,
        module.key,
      ).toBe(false);
      if (module.translated) {
        const translations = value.translations as EditorRecord[];
        expect(
          moduleFor(module.key).input.safeParse({
            ...value,
            translations: [translations[0], translations[0]],
          }).success,
          module.key,
        ).toBe(false);
      }
    }
    const education = moduleFor('education');
    const record = example(education);
    expect(
      education.input.safeParse({ ...record, startDate: '2020-02-31' }).success,
    ).toBe(false);
    expect(
      education.input.safeParse({ ...record, endDate: '2019-01-01' }).success,
    ).toBe(false);
    expect(
      education.input.safeParse({ ...record, schoolUrl: 'javascript:alert(1)' })
        .success,
    ).toBe(false);
    expect(
      education.input.safeParse({ ...record, unsafe: 'extra' }).success,
    ).toBe(false);
    expect(
      education.input.safeParse({ ...record, translations: [] }).success,
    ).toBe(false);
    expect(
      moduleFor('skills').input.safeParse({
        ...example(moduleFor('skills')),
        evidence: [{ contentItemId: 1, url: 'https://example.com' }],
      }).success,
    ).toBe(false);
    expect(
      moduleFor('socialLinks').input.safeParse({
        ...example(moduleFor('socialLinks')),
        url: null,
      }).success,
    ).toBe(false);
  });
});
describe('owner API and fresh authentication', () => {
  const admin = createAdmin(async () => ({
    sub: actor,
    email: 'owner@example.com',
  }));
  const env = () => ({
    APP_ENV: 'preview',
    ACCESS_ISSUER: 'https://team.cloudflareaccess.com',
    ACCESS_AUDIENCE: 'a'.repeat(64),
    OWNER_EMAIL: 'owner@example.com',
    ADMIN_ORIGIN: 'https://admin.example.com',
    PUBLIC_ORIGIN: 'https://example.com',
    CONTENT: local.content,
    INBOX: local.inbox,
  });
  const request = (
    path: string,
    method = 'GET',
    body?: unknown,
    origin = 'https://admin.example.com',
  ) =>
    new Request(`https://admin.example.com${path}`, {
      method,
      headers: {
        'Cf-Access-Jwt-Assertion': 'test-jwt',
        Origin: origin,
        'Content-Type': 'application/json',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  it('rejects missing authentication, wrong origins, unbounded input and legacy writes', async () => {
    expect(
      (
        await admin.request(
          'https://admin.example.com/api/content/overview',
          undefined,
          env(),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await admin.request(
          request('/api/content/education', 'POST', {}, 'https://evil.example'),
          undefined,
          env(),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await admin.request(
          request('/api/content/education', 'POST', {
            padding: 'x'.repeat(64001),
          }),
          undefined,
          env(),
        )
      ).status,
    ).toBe(413);
    expect(
      (
        await admin.request(
          request('/api/profile', 'PUT', {}),
          undefined,
          env(),
        )
      ).status,
    ).toBe(404);
    expect(
      (await admin.request(request('/api/content/no-table'), undefined, env()))
        .status,
    ).toBe(404);
  });
  it('rejects destructive and settings writes on old login but accepts a fresh provider login', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          email: 'owner@example.com',
          iat: Math.floor(Date.now() / 1000) - 301,
        }),
      ),
    );
    expect(
      (
        await admin.request(
          request('/api/content/education/1', 'DELETE', {
            revision: await current(),
          }),
          undefined,
          env(),
        )
      ).status,
    ).toBe(428);
    const settings = await readEditor(local.content, 'siteSettings', 1);
    expect(
      (
        await admin.request(
          request('/api/content/siteSettings/1', 'PUT', settings),
          undefined,
          env(),
        )
      ).status,
    ).toBe(428);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        Response.json({
          email: 'owner@example.com',
          iat: Math.floor(Date.now() / 1000),
        }),
      ),
    );
    const response = await admin.request(
      request('/api/content/siteSettings/1', 'PUT', {
        revision: settings.revision,
        record: settings.record,
      }),
      undefined,
      env(),
    );
    expect(response.status).toBe(200);
  });
  it('checks provider login time, identity and service-token exclusion; fails closed', async () => {
    for (const identity of [
      { email: 'owner@example.com', iat: 699 },
      { email: 'other@example.com', iat: 999 },
      { email: 'owner@example.com', iat: 1001 },
      { email: 'owner@example.com', iat: 999, service_token_id: 'service' },
    ]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => Response.json(identity)),
      );
      expect(
        await hasFreshLogin(
          'token',
          'https://team.cloudflareaccess.com',
          'owner@example.com',
          1_000_000,
        ),
      ).toBe(false);
    }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Offline');
      }),
    );
    const before = await editorOverview(local.content);
    const failed = await admin.request(
      request('/api/content/education/1', 'DELETE', {
        revision: before.revision,
      }),
      undefined,
      env(),
    );
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({
      reauthenticate: '/cdn-cgi/access/logout',
    });
    expect(await editorOverview(local.content)).toEqual(before);
  });
});
