import { buildConfig, absoluteUrl } from '../lib/content';
export function GET() {
  return new Response(
    buildConfig.SITE_MODE === 'preview'
      ? 'User-agent: *\nDisallow: /\n'
      : `User-agent: *\nAllow: /\nSitemap: ${absoluteUrl('/sitemap.xml')}\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );
}
