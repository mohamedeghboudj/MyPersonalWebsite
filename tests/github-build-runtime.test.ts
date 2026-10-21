import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { convertV4MiniflareOptions, Miniflare } from 'miniflare';

describe('GitHub dispatch in the Worker runtime', () => {
  let runtime: Miniflare;
  let upstream: () => Response;
  const requests: {
    url: string;
    method: string;
    authorization: string | null;
  }[] = [];
  beforeAll(async () => {
    const bundle = await build({
      stdin: {
        contents: `
          import { sendBuildDispatch, readGitHubBuild } from './apps/admin/src/github-builds.ts';
          export default { async fetch(request) {
            if (new URL(request.url).pathname === '/status') {
              try {
                return Response.json(await readGitHubBuild('synthetic-github-token',
                  '2bd608d1-b168-4b5e-8df9-713672dca200', 39374867156, fetch));
              } catch (error) {
                return Response.json({ error: error.message }, { status: 503 });
              }
            }
            return Response.json(await sendBuildDispatch('synthetic-github-token',
              { id: '2bd608d1-b168-4b5e-8df9-713672dca200' }, fetch));
          } };
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
            authorization: request.headers.get('Authorization'),
          });
          return upstream();
        },
      }),
    );
  });
  afterAll(async () => runtime?.dispose());
  it('accepts the current GitHub run-id response through actual workerd fetch', async () => {
    requests.length = 0;
    upstream = () => Response.json({ workflow_run_id: 123 });
    const response = await runtime.dispatchFetch('https://test.invalid');
    expect(await response.json()).toEqual({ status: 'queued', runId: 123 });
    expect(requests).toEqual([
      {
        url: 'https://api.github.com/repos/mohamedeghboudj/MyPersonalWebsite/actions/workflows/build-capture.yml/dispatches',
        method: 'POST',
        authorization: 'Bearer synthetic-github-token',
      },
    ]);
  });
  it('refuses redirect credential forwarding and leaves the outcome uncertain without a resend', async () => {
    requests.length = 0;
    upstream = () =>
      Response.redirect('https://untrusted.example/receive-token');
    const response = await runtime.dispatchFetch('https://test.invalid');
    expect(await response.json()).toEqual({ status: 'uncertain', runId: null });
    expect(requests).toHaveLength(1);
  });
  it('reads a large run ID with a pending result in workerd and bounds unavailable responses', async () => {
    requests.length = 0;
    upstream = () =>
      Response.json({
        id: 39374867156,
        display_title: 'Capture 2bd608d1-b168-4b5e-8df9-713672dca200',
        head_branch: 'main',
        path: '.github/workflows/build-capture.yml',
        event: 'workflow_dispatch',
        run_attempt: 1,
        status: 'queued',
        conclusion: null,
      });
    const response = await runtime.dispatchFetch('https://test.invalid/status');
    expect(await response.json()).toMatchObject({
      status: 'queued',
      conclusion: null,
      attempt: 1,
    });
    expect(requests).toEqual([
      {
        url: 'https://api.github.com/repos/mohamedeghboudj/MyPersonalWebsite/actions/runs/39374867156',
        method: 'GET',
        authorization: 'Bearer synthetic-github-token',
      },
    ]);
    upstream = () => new Response('PRIVATE-UPSTREAM-DETAIL', { status: 404 });
    const unavailable = await runtime.dispatchFetch(
      'https://test.invalid/status',
    );
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({
      error:
        'GitHub build status is unavailable (HTTP 404). Try again shortly.',
    });
  });
});
