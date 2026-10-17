import { readFile, readdir } from 'node:fs/promises';
import { renderPublicHeaders, siteBuildEnvSchema } from '@platform/config';

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
    if (
      !/\bsrc="\//u.test(script[1] ?? '') &&
      !/\btype="application\/ld\+json"/u.test(script[1] ?? '')
    )
      throw new Error('Scripts must use same-origin external files');
  if (!/<link\b[^>]*rel="stylesheet"/iu.test(html))
    throw new Error('Shared stylesheet missing');
}
if (
  (await readFile('apps/site/dist/_headers', 'utf8')) !==
  renderPublicHeaders(siteBuildEnvSchema.parse(process.env).SITE_MODE)
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
const graph: { fileName: string; isEntry: boolean; imports: string[] }[] =
  JSON.parse(await readFile('artifacts/admin-build-manifest.json', 'utf8'));
if (
  graph.length !== js.length ||
  !graph.some((chunk) => chunk.isEntry) ||
  new Set(graph.map((chunk) => chunk.fileName)).size !== graph.length ||
  graph.some((chunk) => !js.includes(chunk.fileName.replace(/^assets\//u, '')))
)
  throw new Error('Admin build graph does not match the actual output');
const initial = new Set<string>();
async function visit(name: string): Promise<number> {
  if (initial.has(name)) return 0;
  const chunk = graph.find((item) => item.fileName === name);
  if (!chunk) throw new Error('Admin static import is missing');
  initial.add(name);
  let size = (await readFile(`apps/admin/dist/${name}`)).length;
  for (const dependency of chunk.imports) size += await visit(dependency);
  return size;
}
let initialBytes = 0;
for (const chunk of graph.filter((item) => item.isEntry))
  initialBytes += await visit(chunk.fileName);
// Retain the original editor budget. The owner-requested publishing panel has
// an explicit additional 10 kB allowance, fetched only after opening its panel.
if (initialBytes > 250000 || bytes > 260000 || bytes - initialBytes > 10000)
  throw new Error('Admin JavaScript exceeds its initial/complete/lazy budget');
console.log(
  `Document CSP checks passed; admin JavaScript ${initialBytes} initial / ${bytes} complete bytes; no server configuration in the browser bundle.`,
);
