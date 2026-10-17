import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { previewPolicy } from '@platform/config';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';

const issuer = 'https://preview-test.cloudflareaccess.com';
const audience = 'synthetic-preview-audience';
const release = {
  schemaVersion: 1,
  id: crypto.randomUUID(),
  sequence: 2,
  revision: 7,
  snapshotSha256: 'a'.repeat(64),
  bundleSha256: 'b'.repeat(64),
};
let runtime: Miniflare;
let key: CryptoKey;
let workerScript: string;
let publicKeys: unknown;
let assetResponse: () => Response;
const assetRequests: { headers: { get(name: string): string | null } }[] = [];
const keyRequests: string[] = [];
async function token(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: 'owner@example.com',
    sub: 'synthetic-owner',
    iss: issuer,
    aud: audience,
    iat: now,
    exp: now + 300,
    ...overrides,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'preview-test' })
    .sign(key);
}
async function request(path: string, jwt?: string, method = 'GET') {
  return runtime.dispatchFetch(previewPolicy.origin + path, {
    method,
    redirect: 'manual',
    headers: jwt
      ? {
          'Cf-Access-Jwt-Assertion': jwt,
          Cookie: 'CF_Authorization=synthetic-owner-cookie',
          Range: 'bytes=0-99',
        }
      : {},
  });
}
beforeAll(async () => {
  const keys = await generateKeyPair('RS256');
  key = keys.privateKey;
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: 'preview-test',
    alg: 'RS256',
    use: 'sig',
  };
  publicKeys = { keys: [jwk] };
  const bundle = await build({
    entryPoints: ['apps/preview/src/index.ts'],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
  });
  workerScript = bundle.outputFiles[0]!.text;
  runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script: bundle.outputFiles[0]!.text,
      compatibilityDate: '2026-10-01',
      telemetry: { enabled: false },
      bindings: {
        APP_ENV: 'preview',
        ACCESS_ISSUER: issuer,
        ACCESS_AUDIENCE: audience,
        OWNER_EMAIL: 'owner@example.com',
        PREVIEW_RELEASE: JSON.stringify(release),
      },
      outboundService: async (request) => {
        keyRequests.push(request.url);
        if (request.url !== issuer + '/cdn-cgi/access/certs')
          throw new Error('Unexpected identity network request');
        return Response.json({ keys: [jwk] });
      },
      serviceBindings: {
        ASSETS: async (request) => {
          assetRequests.push(request);
          return assetResponse();
        },
      },
    }),
  );
});
afterAll(async () => runtime?.dispose());
describe('private preview in the real Worker runtime', () => {
  it('denies anonymous access to every kind of page, asset, error and status route', async () => {
    assetRequests.length = 0;
    for (const path of [
      '/',
      '/fr/',
      '/ar/',
      '/_astro/site.css',
      '/media/a.webp',
      '/cv/ar.pdf',
      '/documents/a.pdf',
      '/missing/',
      '/_build/status',
    ]) {
      const response = await request(path);
      expect(response.status).toBe(401);
      expect(response.headers.get('Cache-Control')).toBe('no-store');
      expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    }
    expect(assetRequests).toHaveLength(0);
  });
  it('independently rejects forged, expired, wrong issuer/audience, missing and non-owner identities', async () => {
    assetRequests.length = 0;
    for (const jwt of [
      'forged',
      await token({ exp: 1 }),
      await token({ iss: 'https://other.cloudflareaccess.com' }),
      await token({ aud: 'admin-audience' }),
      await token({ sub: undefined }),
      await token({ email: undefined }),
    ])
      expect((await request('/cv/en.pdf', jwt)).status).toBe(401);
    expect(
      (await request('/', await token({ email: 'other@example.com' }))).status,
    ).toBe(403);
    expect(assetRequests).toHaveLength(0);
    expect(
      keyRequests.every((url) => url === issuer + '/cdn-cgi/access/certs'),
    ).toBe(true);
  });
  it('serves authenticated static output without forwarding credentials or retaining cache/cookie headers', async () => {
    assetRequests.length = 0;
    assetResponse = () =>
      new Response('<main>Private preview</main>', {
        headers: {
          'Content-Type': 'text/html',
          'Cache-Control': 'public, max-age=3600',
          'Set-Cookie': 'unexpected=1',
        },
      });
    const response = await request(
      '/ar/',
      await token({ email: 'OWNER@example.com' }),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('Private preview');
    expect(response.headers.get('Content-Type')).toBe('text/html');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Set-Cookie')).toBeNull();
    expect(response.headers.get('Vary')).toContain('Cf-Access-Jwt-Assertion');
    expect(response.headers.get('Content-Security-Policy')).toContain(
      "frame-ancestors 'none'",
    );
    expect(assetRequests[0]!.headers.get('Cookie')).toBeNull();
    expect(assetRequests[0]!.headers.get('Cf-Access-Jwt-Assertion')).toBeNull();
    expect(assetRequests[0]!.headers.get('Range')).toBe('bytes=0-99');
  });
  it('protects PDF ranges, HEAD responses and localized 404 statuses', async () => {
    const jwt = await token();
    assetResponse = () =>
      new Response('%PDF-test', {
        status: 206,
        headers: {
          'Content-Type': 'application/pdf',
          'Content-Range': 'bytes 0-8/100',
        },
      });
    for (const path of [
      '/cv/ar.pdf',
      '/documents/' + 'a'.repeat(64) + '.pdf',
    ]) {
      const response = await request(path, jwt);
      expect(response.status).toBe(206);
      expect(response.headers.get('Content-Disposition')).toContain(
        'attachment',
      );
      expect(response.headers.get('Content-Security-Policy')).toBe(
        "sandbox; default-src 'none'",
      );
      expect(response.headers.get('Content-Range')).toBe('bytes 0-8/100');
    }
    expect(await (await request('/cv/ar.pdf', jwt, 'HEAD')).text()).toBe('');
    assetResponse = () => new Response('Localized not found', { status: 404 });
    const response = await request('/fr/missing/', jwt);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('Localized not found');
  });
  it('allows only same-origin redirects and rejects mutations and alternate origins', async () => {
    const jwt = await token();
    assetResponse = () =>
      Response.redirect(previewPolicy.origin + '/projects/new/', 301);
    expect((await request('/projects/old/', jwt)).status).toBe(301);
    assetResponse = () => Response.redirect('https://untrusted.example', 302);
    expect((await request('/projects/old/', jwt)).status).toBe(502);
    const count = assetRequests.length;
    expect((await request('/', jwt, 'POST')).status).toBe(405);
    expect((await request('/_build/input', jwt)).status).toBe(404);
    expect(
      (
        await runtime.dispatchFetch('https://another.example/', {
          headers: { 'Cf-Access-Jwt-Assertion': jwt },
        })
      ).status,
    ).toBe(404);
    expect(assetRequests).toHaveLength(count);
  });
  it('reports the installed receipt to the owner without an asset read', async () => {
    const count = assetRequests.length;
    const response = await request('/_build/status', await token());
    expect(await response.json()).toEqual({ ready: true, release });
    expect(assetRequests).toHaveLength(count);
  });
  it('runs authentication before the actual static-asset router, including direct CSS and PDF URLs', async () => {
    const config = z
      .object({
        assets: z.object({
          binding: z.literal('ASSETS'),
          run_worker_first: z.literal(true),
          not_found_handling: z.literal('404-page'),
        }),
      })
      .parse(JSON.parse(await readFile('apps/preview/wrangler.json', 'utf8')));
    await mkdir('artifacts/preview-routing-tests', { recursive: true });
    const directory = await mkdtemp(
      resolve('artifacts/preview-routing-tests/run-'),
    );
    const files = {
      'index.html': '<main>EN</main>',
      'fr/index.html': '<main>FR</main>',
      'ar/index.html': '<main>AR</main>',
      '404.html': 'EN missing',
      'fr/404.html': 'FR missing',
      'ar/404.html': 'AR missing',
      '_astro/style.css': 'main { color: black; }',
      'cv/ar.pdf': '%PDF-synthetic',
    };
    for (const [path, body] of Object.entries(files)) {
      await mkdir(dirname(resolve(directory, path)), { recursive: true });
      await writeFile(resolve(directory, path), body);
    }
    const assetsRuntime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: workerScript,
        compatibilityDate: '2026-10-01',
        telemetry: { enabled: false },
        bindings: {
          APP_ENV: 'preview',
          ACCESS_ISSUER: issuer,
          ACCESS_AUDIENCE: audience,
          OWNER_EMAIL: 'owner@example.com',
          PREVIEW_RELEASE: JSON.stringify(release),
        },
        assets: {
          directory,
          binding: config.assets.binding,
          run_worker_first: config.assets.run_worker_first,
          routerConfig: { has_user_worker: true },
          assetConfig: { not_found_handling: config.assets.not_found_handling },
        },
        outboundService: async (request) => {
          if (request.url !== issuer + '/cdn-cgi/access/certs')
            throw new Error('Unexpected key request');
          return Response.json(publicKeys);
        },
      }),
    );
    try {
      const jwt = await token();
      for (const path of [
        '/',
        '/fr/',
        '/ar/',
        '/_astro/style.css',
        '/cv/ar.pdf',
        '/ar/missing/',
      ]) {
        const anonymous = await assetsRuntime.dispatchFetch(
          previewPolicy.origin + path,
          { redirect: 'manual' },
        );
        expect(anonymous.status).toBe(401);
        const authenticated = await assetsRuntime.dispatchFetch(
          previewPolicy.origin + path,
          { redirect: 'manual', headers: { 'Cf-Access-Jwt-Assertion': jwt } },
        );
        expect(authenticated.status).toBe(path.includes('missing') ? 404 : 200);
        expect(authenticated.headers.get('Cache-Control')).toBe('no-store');
        if (path.includes('missing'))
          expect(await authenticated.text()).toBe('AR missing');
      }
    } finally {
      await assetsRuntime.dispose();
    }
  });
});
