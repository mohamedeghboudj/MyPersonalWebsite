// Synthetic, ephemeral browser-test server. This file is outside every Worker
// entry point and binds only to loopback; it has no remote IDs or credentials.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createAdmin } from '../../apps/admin/src/index.ts';
import {
  localDatabase,
  migrateTestDatabase,
} from '../../scripts/local-database.ts';
import { adminDocumentHeaders } from '@platform/config';
import { syntheticPublisher } from './publishing-provider.ts';

const local = await localDatabase();
await migrateTestDatabase(local.content, local.inbox);
const origin = 'http://127.0.0.1:4173';
const assetRoot = resolve('apps/admin/dist');
const publisher = syntheticPublisher(local.media);
const admin = createAdmin(
  async () => ({ sub: 'test-owner', email: 'owner@example.com' }),
  async () => true,
  publisher.github,
  publisher.cloudflare,
);
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', origin);
    if (req.headers.host !== '127.0.0.1:4173') {
      res.writeHead(403).end();
      return;
    }
    if (url.pathname === '/__simulated-publishing') {
      res.writeHead(200, {
        ...adminDocumentHeaders,
        'Content-Type': 'text/plain',
      });
      res.end(
        'Local publishing simulation. No GitHub build, LaTeX compilation, Cloudflare upload or activation occurred.',
      );
      return;
    }
    if (
      req.method === 'POST' &&
      url.pathname === '/__stop_test_server' &&
      req.headers.origin === origin
    ) {
      res.writeHead(204).end();
      server.close(() => void stop());
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const chunks: Uint8Array[] = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers))
        if (typeof value === 'string') headers.set(name, value);
      headers.set('Cf-Access-Jwt-Assertion', 'synthetic-local-test');
      const response = await admin.request(
        new Request(url, {
          method: req.method ?? 'GET',
          headers,
          ...(body.length ? { body } : {}),
        }),
        undefined,
        {
          APP_ENV: 'local',
          CONTENT: local.content,
          INBOX: local.inbox,
          MEDIA: local.media,
          ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
          ACCESS_AUDIENCE: 'a'.repeat(64),
          OWNER_EMAIL: 'owner@example.com',
          ADMIN_ORIGIN: origin,
          PUBLIC_ORIGIN: 'http://127.0.0.1:4321',
          ...publisher.env,
        },
      );
      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      responseHeaders['X-Preview-Mode'] = 'synthetic';
      res.writeHead(response.status, responseHeaders);
      if (response.ok && url.pathname === '/api/publishing/status') {
        res.end(
          JSON.stringify({
            ...((await response.json()) as object),
            previewUrl: origin + '/__simulated-publishing',
          }),
        );
      } else if (
        response.ok &&
        /^\/api\/publishing\/captures\/[^/]+\/build$/u.test(url.pathname) &&
        req.method === 'GET'
      ) {
        const value = (await response.json()) as {
          run: { url: string } | null;
        };
        if (value.run) value.run.url = origin + '/__simulated-publishing';
        res.end(JSON.stringify(value));
      } else res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const path = resolve(
      assetRoot,
      url.pathname === '/' ? 'index.html' : `.${url.pathname}`,
    );
    if (!path.startsWith(assetRoot + sep)) {
      res.writeHead(404).end();
      return;
    }
    const file = await readFile(path);
    res.writeHead(200, {
      ...adminDocumentHeaders,
      'Content-Type':
        extname(path) === '.js'
          ? 'text/javascript'
          : extname(path) === '.css'
            ? 'text/css'
            : 'text/html',
    });
    res.end(file);
  } catch {
    res.writeHead(500).end('Test server request failed');
  }
});
server.listen(4173, '127.0.0.1', () =>
  console.log('Synthetic console test server ready on loopback:4173'),
);
async function stop() {
  server.closeAllConnections();
  server.close();
  await local.runtime.dispose();
  process.exit(0);
}
process.on('SIGTERM', () => void stop());
process.on('SIGINT', () => void stop());
