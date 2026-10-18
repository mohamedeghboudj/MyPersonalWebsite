import { describe, expect, it } from 'vitest';
import { capturePublicSnapshot } from '@platform/database';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import { siteBuildEnvSchema, renderPublicHeaders } from '@platform/config';
import {
  routes,
  routePath,
  pageMetadata,
  contactHref,
} from '../apps/site/src/lib/content';

describe('static presentation boundaries', () => {
  it('keeps preview indexing off and requires HTTPS for production canonical URLs', () => {
    expect(siteBuildEnvSchema.parse({}).SITE_MODE).toBe('preview');
    expect(
      siteBuildEnvSchema.safeParse({ SITE_MODE: 'production' }).success,
    ).toBe(false);
    expect(
      siteBuildEnvSchema.safeParse({ SITE_ORIGIN: 'https://example.com/path' })
        .success,
    ).toBe(false);
    expect(renderPublicHeaders()).toContain('noindex');
    expect(renderPublicHeaders('production')).not.toContain('noindex');
    expect(renderPublicHeaders('production')).toContain("script-src 'self'");
    expect(routePath('en', 'projects/example')).toBe('/projects/example/');
    expect(routePath('ar', '/projects/example/')).toBe('/ar/projects/example/');
  });
  it('preserves contact values without permitting query injection', () => {
    expect(
      contactHref({
        kind: 'email',
        value: 'owner+portfolio@example.com',
        displayOrder: 0,
      }),
    ).toBe('mailto:owner%2Bportfolio%40example.com');
    expect(
      contactHref({
        kind: 'phone',
        value: '+123?body=unexpected',
        displayOrder: 0,
      }),
    ).not.toContain('?');
  });
  it('uses database content for paths and safely serializes structured data', async () => {
    const local = await localDatabase();
    try {
      await migrateTestDatabase(local.content, local.inbox);
      const snapshot = await capturePublicSnapshot(local.content);
      snapshot.projectCategories.push({
        id: 1,
        slug: 'software',
        coverMediaId: null,
        displayOrder: 0,
        translations: [
          { locale: 'en', name: 'Software', description: 'Example category' },
        ],
      });
      snapshot.profile.fullName = '</script><script>alert(1)</script>';
      const meta = pageMetadata(snapshot, 'ar', 'projects/field-notes');
      expect(meta.jsonLd).not.toContain('<');
      expect(JSON.parse(meta.jsonLd)['@graph'][0].name).toBe(
        snapshot.profile.fullName,
      );
      expect(meta.jsonLd).not.toContain('private');
      expect(routes(snapshot)).toContain('projects/category/software');
      expect(meta.url).toBe('http://127.0.0.1:4321/ar/projects/field-notes/');
    } finally {
      await local.runtime.dispose();
    }
  });
});
