import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { observePublication } from '../scripts/publication-observation';

const id = crypto.randomUUID(),
  pdf = '%PDF-1.4\nsynthetic-observer-fixture';
const hash = createHash('sha256').update(pdf).digest('hex');
const receipt = {
  schemaVersion: 1,
  captureId: id,
  revision: 7,
  snapshotSha256: 'a'.repeat(64),
  capturedAt: new Date().toISOString(),
  cvs: { en: hash, fr: hash, ar: hash },
};
function transport(mode = 'ok'): typeof fetch {
  let receipts = 0;
  return async (url, init) => {
    expect(init?.redirect).toBe('manual');
    const path = new URL(String(url)).pathname;
    if (path === '/release.json')
      return Response.json({
        ...receipt,
        captureId:
          mode === 'changed' && ++receipts === 2 ? crypto.randomUUID() : id,
      });
    if (mode === 'redirect')
      return new Response(null, {
        status: 302,
        headers: { Location: 'https://foreign.example' },
      });
    if (path.endsWith('.pdf'))
      return new Response(mode === 'wrong-pdf' ? '%PDF-wrong' : pdf);
    const locale = path === '/ar/' ? 'ar' : path === '/fr/' ? 'fr' : 'en';
    return new Response(
      `<html dir="${locale === 'ar' ? 'rtl' : 'ltr'}"><main data-revision="7"><a href="/cv/${locale}.pdf">CV</a></main></html>`,
      { headers: mode === 'cookie' ? { 'Set-Cookie': 'synthetic=yes' } : {} },
    );
  };
}
it('observes exact public pages, Arabic direction and all three snapshot-bound PDFs', async () => {
  const result = await observePublication(
    'https://public.example',
    id,
    transport(),
  );
  expect(result?.evidence.map((row) => row.locale)).toEqual(['en', 'fr', 'ar']);
  expect(result?.receipt).toEqual(receipt);
});
it('rejects redirected, mixed-release, wrong-PDF and cookie-setting evidence', async () => {
  for (const mode of ['redirect', 'changed', 'wrong-pdf'])
    expect(
      await observePublication('https://public.example', id, transport(mode)),
    ).toBeNull();
  await expect(
    observePublication('https://public.example', id, transport('cookie')),
  ).rejects.toThrow('cookie');
});
