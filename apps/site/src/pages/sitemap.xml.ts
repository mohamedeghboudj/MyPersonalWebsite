import {
  readSnapshot,
  buildConfig,
  locales,
  routes,
  routePath,
  absoluteUrl,
} from '../lib/content';
const xml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('"', '&quot;');
export async function GET() {
  const snapshot = await readSnapshot();
  const paths =
    snapshot.schemaVersion === 2 && buildConfig.SITE_MODE === 'production'
      ? routes(snapshot)
      : [];
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">${paths.flatMap((path) => locales.map((locale) => `<url><loc>${xml(absoluteUrl(routePath(locale, path)))}</loc>${[...locales, 'x-default'].map((language) => `<xhtml:link rel="alternate" hreflang="${language}" href="${xml(absoluteUrl(routePath(language === 'x-default' ? 'en' : (language as typeof locale), path)))}"/>`).join('')}</url>`)).join('')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
}
