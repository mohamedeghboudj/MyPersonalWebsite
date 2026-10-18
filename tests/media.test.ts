import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import { createAdmin } from '../apps/admin/src/index';
import { editorOverview, mediaObject, readEditor } from '@platform/database';

let local: Awaited<ReturnType<typeof localDatabase>>;
beforeAll(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
});
afterAll(async () => {
  await local?.runtime.dispose();
});
const admin = createAdmin(
  async () => ({ sub: 'test-owner', email: 'owner@example.com' }),
  async () => true,
);
const env = () => ({
  CONTENT: local.content,
  INBOX: local.inbox,
  MEDIA: local.media,
  APP_ENV: 'local',
  ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
  ACCESS_AUDIENCE: 'a'.repeat(64),
  OWNER_EMAIL: 'owner@example.com',
  ADMIN_ORIGIN: 'http://localhost:8787',
});
const headers = {
  'Cf-Access-Jwt-Assertion': 'test-only',
  Origin: 'http://localhost:8787',
};
function upload(
  bytes: Uint8Array<ArrayBuffer>,
  revision: number,
  mime = 'image/png',
) {
  const form = new FormData();
  form.set('file', new Blob([bytes], { type: mime }), 'untrusted.svg');
  form.set('revision', String(revision));
  form.set('locale', 'ar');
  form.set('altText', 'صورة اختبار');
  return new Request('http://localhost:8787/api/media', {
    method: 'POST',
    headers,
    body: form,
  });
}
const png = () =>
  new Uint8Array(
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=',
      'base64',
    ),
  );
describe('private media boundary', () => {
  it('sniffs bytes, keeps originals private, and downloads only as an attachment', async () => {
    const response = await admin.request(
      upload(png(), 0, 'text/html'),
      undefined,
      env(),
    );
    expect(response.status).toBe(201);
    const result = (await response.json()) as { id: number };
    const object = await mediaObject(local.content, result.id);
    expect(object?.contentType).toBe('image/png');
    expect(object?.isPublic).toBe(false);
    expect(object?.r2Key).not.toContain('untrusted');
    expect(
      (await readEditor(local.content, 'media', result.id)).record.translations,
    ).toEqual([{ locale: 'ar', altText: 'صورة اختبار' }]);
    const download = await admin.request(
      new Request(`http://localhost:8787/api/media/${result.id}/download`, {
        headers,
      }),
      undefined,
      env(),
    );
    expect(download.headers.get('content-type')).toBe(
      'application/octet-stream',
    );
    expect(download.headers.get('content-disposition')).toContain('attachment');
    expect(download.headers.get('content-security-policy')).toContain(
      'sandbox',
    );
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(png());
  });
  it('rejects disguised SVG and oversize bodies without writing storage or revision', async () => {
    const before = await editorOverview(local.content);
    const objects = await local.media.list();
    expect(
      (
        await admin.request(
          upload(
            new TextEncoder().encode('<svg onload="alert(1)"></svg>'),
            before.revision,
          ),
          undefined,
          env(),
        )
      ).status,
    ).toBe(400);
    const tooLarge = new Request('http://localhost:8787/api/media', {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'multipart/form-data; boundary=test',
        'Content-Length': '99999999',
      },
      body: '--test',
    });
    expect((await admin.request(tooLarge, undefined, env())).status).toBe(413);
    expect(await editorOverview(local.content)).toEqual(before);
    expect((await local.media.list()).objects).toEqual(objects.objects);
  });
  it('compensates R2 on stale writes and deletes the stored object after a committed removal', async () => {
    const objects = await local.media.list();
    expect(
      (await admin.request(upload(png(), 0), undefined, env())).status,
    ).toBe(409);
    expect((await local.media.list()).objects).toEqual(objects.objects);
    const row = await local.content
      .prepare('SELECT id FROM media')
      .first<{ id: number }>();
    const response = await admin.request(
      new Request(`http://localhost:8787/api/content/media/${row?.id}`, {
        method: 'DELETE',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          revision: (await editorOverview(local.content)).revision,
        }),
      }),
      undefined,
      env(),
    );
    expect(response.status).toBe(200);
    expect((await local.media.list()).objects).toHaveLength(0);
    expect(
      (await local.content.prepare('SELECT * FROM media_cleanup').all())
        .results,
    ).toHaveLength(0);
  });
});
