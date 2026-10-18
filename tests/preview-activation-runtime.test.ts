import { beforeAll, afterAll, it, expect } from 'vitest';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

let runtime: Miniflare;
let upstream: () => Response;
const requests: {
  url: string;
  method: string;
  redirect: string;
  body: string;
}[] = [];
const versionId = crypto.randomUUID();
beforeAll(async () => {
  const bundle = await build({
    stdin: {
      contents: `
    import {activatePreviewVersion} from './apps/admin/src/preview-cloudflare.ts';
    export default {async fetch(){return Response.json(await activatePreviewVersion({
      ACCESS_ISSUER:'https://test.cloudflareaccess.com',ACCESS_AUDIENCE:'synthetic-preview-audience',OWNER_EMAIL:'owner@example.com',
      CLOUDFLARE_ACCOUNT_ID:'${'a'.repeat(32)}',CLOUDFLARE_API_TOKEN:'synthetic-preview-credential'
    },'${versionId}'));}};
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
          method: request.method,
          redirect: request.redirect,
          body: await request.text(),
        });
        return upstream();
      },
    }),
  );
});
afterAll(async () => runtime?.dispose());
it('performs the single deployment POST using workerd fetch and verifies its receipt', async () => {
  const deploymentId = crypto.randomUUID(),
    createdAt = new Date().toISOString();
  upstream = () =>
    Response.json({
      success: true,
      result: {
        id: deploymentId,
        created_on: createdAt,
        strategy: 'percentage',
        versions: [{ version_id: versionId, percentage: 100 }],
      },
    });
  requests.length = 0;
  expect(
    await (await runtime.dispatchFetch('https://test.invalid')).json(),
  ).toEqual({
    status: 'deployed',
    versionId,
    deploymentId,
    percentage: 100,
    createdAt,
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]!.method).toBe('POST');
  expect(JSON.parse(requests[0]!.body)).toEqual({
    strategy: 'percentage',
    versions: [{ version_id: versionId, percentage: 100 }],
  });
});
it('does not forward a deployment credential through a redirect or retry the request', async () => {
  upstream = () => Response.redirect('https://untrusted.example', 302);
  requests.length = 0;
  expect(
    await (await runtime.dispatchFetch('https://test.invalid')).json(),
  ).toEqual({ status: 'uncertain' });
  expect(requests).toHaveLength(1);
  expect(requests[0]!.url).toContain(
    'https://api.cloudflare.com/client/v4/accounts/',
  );
});
