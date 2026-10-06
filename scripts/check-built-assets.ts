import { readFile, readdir } from 'node:fs/promises';
import { renderPublicHeaders } from '@platform/config';

const admin = await readFile('apps/admin/dist/index.html', 'utf8');
const pages = [
  admin,
  ...(await Promise.all(
    ['', 'fr/', 'ar/'].map((path) =>
      readFile(`apps/site/dist/${path}index.html`, 'utf8'),
    ),
  )),
];
for (const html of pages) {
  if (/<style\b|\sstyle=|\son[a-z]+=/iu.test(html))
    throw new Error('Inline styles or event handlers violate the document CSP');
  for (const script of html.matchAll(/<script\b([^>]*)>/giu))
    if (!/\bsrc="\//u.test(script[1] ?? ''))
      throw new Error('Scripts must use same-origin external files');
  if (!/<link\b[^>]*rel="stylesheet"/iu.test(html))
    throw new Error('Shared stylesheet missing');
}
if (
  (await readFile('apps/site/dist/_headers', 'utf8')) !== renderPublicHeaders()
)
  throw new Error('Built public security policy is stale');
const js = (await readdir('apps/admin/dist/assets')).filter((name) =>
  name.endsWith('.js'),
);
let bytes = 0;
for (const name of js) {
  const file = await readFile(`apps/admin/dist/assets/${name}`, 'utf8');
  bytes += Buffer.byteLength(file);
  if (
    /ACCESS_AUDIENCE|OWNER_EMAIL|Cf-Access-Jwt-Assertion|RATE_LIMIT_SALT|cloudflareaccess\.com|\.dev\.vars/u.test(
      file,
    )
  )
    throw new Error('Server configuration leaked into the admin bundle');
}
if (bytes > 250000)
  throw new Error(
    'Foundation admin JavaScript exceeds the 250 kB uncompressed budget',
  );
console.log(
  `Document CSP checks passed; admin JavaScript ${bytes} bytes; no server configuration in the browser bundle.`,
);
