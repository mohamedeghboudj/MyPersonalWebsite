import { createHash } from 'node:crypto';
import { boundedBytes } from '@platform/config';
import { publicReleaseReceiptSchema, locales } from '@platform/schema';

// Read-only public evidence; this observer has no login or provider credentials.
export async function observePublication(
  origin: string,
  id: string,
  send: typeof fetch = fetch,
) {
  async function get(path: string, limit: number) {
    const response = await send(new URL(path, origin), {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    if (response.status !== 200) {
      await response.body?.cancel();
      return null;
    }
    if (response.headers.has('set-cookie')) {
      await response.body?.cancel();
      throw new Error('Public response sets a cookie');
    }
    return boundedBytes(response, limit);
  }
  const raw = await get('/release.json', 4096);
  if (!raw) return null;
  const receipt = publicReleaseReceiptSchema.parse(
    JSON.parse(new TextDecoder().decode(raw)),
  );
  if (receipt.captureId !== id) return null;
  const evidence = [];
  for (const locale of locales) {
    const page = await get(
      locale === 'en' ? '/' : `/${locale}/`,
      4 * 1024 * 1024,
    );
    if (!page) return null;
    const html = new TextDecoder().decode(page);
    if (
      !html.includes(`data-revision="${receipt.revision}"`) ||
      !html.includes(`href="/cv/${locale}.pdf"`)
    )
      return null;
    if (locale === 'ar' && !html.includes('dir="rtl"'))
      throw new Error('Arabic direction missing');
    const pdf = await get(`/cv/${locale}.pdf`, 25 * 1024 * 1024);
    if (
      !pdf ||
      !Buffer.from(pdf).subarray(0, 5).equals(Buffer.from('%PDF-')) ||
      createHash('sha256').update(pdf).digest('hex') !== receipt.cvs[locale]
    )
      return null;
    evidence.push({
      locale,
      observedAt: new Date().toISOString(),
      pdfSha256: receipt.cvs[locale],
    });
  }
  // Do not combine pages across a concurrent publication.
  const final = await get('/release.json', 4096);
  if (!final || !Buffer.from(raw).equals(Buffer.from(final))) return null;
  return { receipt, evidence };
}
