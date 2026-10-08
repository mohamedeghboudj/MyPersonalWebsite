import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

// Execute the production identity lookup inside workerd. A mocked Node fetch
// accepts redirect modes that the actual Worker runtime rejects.
describe('Access identity lookup in the Worker runtime', () => {
  let runtime: Miniflare;
  let upstream: () => Response;
  const requests: { url: string; cookie: string | null }[] = [];
  beforeAll(async () => {
    const bundle = await build({
      stdin: {
        contents: `
          import { hasFreshLogin } from './apps/admin/src/fresh-auth.ts';
          export default {
            async fetch() {
              try {
                return Response.json({ fresh: await hasFreshLogin(
                  'synthetic-test-token', 'https://team.cloudflareaccess.com',
                  'owner@example.com', 1000000
                ) });
              } catch {
                return Response.json({ unavailable: true }, { status: 503 });
              }
            }
          };
        `,
        resolveDir: process.cwd(),
      },
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'browser',
      target: 'es2022',
    });
    runtime = new Miniflare(
      convertV4MiniflareOptions({
        modules: true,
        script: bundle.outputFiles[0]!.text,
        compatibilityDate: '2026-10-01',
        telemetry: { enabled: false },
        outboundService: async (request) => {
          requests.push({
            url: request.url,
            cookie: request.headers.get('cookie'),
          });
          return upstream();
        },
      }),
    );
  });
  afterAll(async () => runtime?.dispose());

  it('accepts a recent human login using the real runtime fetch', async () => {
    upstream = () =>
      Response.json({
        email: 'owner@example.com',
        iat: 999,
        service_token_id: null,
        service_token_status: false,
      });
    requests.length = 0;
    const response = await runtime.dispatchFetch('https://test.invalid');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fresh: true });
    expect(requests).toEqual([
      {
        url: 'https://team.cloudflareaccess.com/cdn-cgi/access/get-identity',
        cookie: 'CF_Authorization=synthetic-test-token',
      },
    ]);
  });

  it('refuses redirects without forwarding the cookie to another origin', async () => {
    upstream = () => Response.redirect('https://untrusted.example/identity');
    requests.length = 0;
    const response = await runtime.dispatchFetch('https://test.invalid');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ fresh: false });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain('team.cloudflareaccess.com/');
  });

  it('fails closed for stale, mismatched, service and invalid identities', async () => {
    for (const identity of [
      { email: 'owner@example.com', iat: 699 },
      { email: 'other@example.com', iat: 999 },
      { email: 'owner@example.com', iat: 1001 },
      { email: 'owner@example.com', iat: 999, service_token_status: true },
      { email: 'owner@example.com', iat: 999, service_token_id: 'service' },
      { email: 'owner@example.com' },
    ]) {
      upstream = () => Response.json(identity);
      expect(
        await (await runtime.dispatchFetch('https://test.invalid')).json(),
      ).toEqual({ fresh: false });
    }
    upstream = () =>
      new Response('<html>Sign in</html>', {
        headers: { 'Content-Type': 'text/html' },
      });
    expect(
      await (await runtime.dispatchFetch('https://test.invalid')).json(),
    ).toEqual({ fresh: false });
    upstream = () =>
      new Response('{broken', {
        headers: { 'Content-Type': 'application/json' },
      });
    expect((await runtime.dispatchFetch('https://test.invalid')).status).toBe(
      503,
    );
  });
});
