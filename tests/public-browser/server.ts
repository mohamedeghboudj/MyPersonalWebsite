import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { relative, resolve, extname } from 'node:path';
import {
  publicDocumentHeaders,
  publicAttachmentHeaders,
} from '@platform/config';

// Test-only static host. The map consists exclusively of built files, so URLs
// cannot become filesystem paths or reach private source/configuration files.
const root = resolve('apps/site/dist');
const files = new Map<string, { body: Buffer; type: string }>();
const mime: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
};
for (const file of await readdir(root, {
  recursive: true,
  withFileTypes: true,
})) {
  if (!file.isFile()) continue;
  const path = resolve(file.parentPath, file.name);
  const url = '/' + relative(root, path).replaceAll('\\', '/');
  if (['/_headers', '/_redirects'].includes(url)) continue;
  const asset = {
    body: await readFile(path),
    type: mime[extname(path)] ?? 'application/octet-stream',
  };
  files.set(url, asset);
  if (url.endsWith('/index.html')) files.set(url.slice(0, -10), asset);
}
const server = createServer((request, response) => {
  if (
    request.headers.host === '127.0.0.1:4322' &&
    request.method === 'POST' &&
    request.url === '/__stop_test_server' &&
    request.headers.origin === 'http://127.0.0.1:4322'
  ) {
    response.writeHead(204).end();
    server.close(() => process.exit(0));
    return;
  }
  if (
    request.headers.host !== '127.0.0.1:4322' ||
    !['GET', 'HEAD'].includes(request.method ?? '')
  ) {
    response.writeHead(403).end();
    return;
  }
  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1:4322')
    .pathname;
  const asset = files.get(pathname);
  if (!asset) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    ...publicDocumentHeaders,
    'Content-Type': asset.type,
    ...(pathname.startsWith('/documents/') ? publicAttachmentHeaders : {}),
    'Cache-Control': 'no-store',
  });
  response.end(request.method === 'HEAD' ? undefined : asset.body);
});
server.listen(4322, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => server.close(() => process.exit(0)));
