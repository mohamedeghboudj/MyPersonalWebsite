// Synthetic provider transport for loopback browser tests only. It is outside
// every Worker entry point and never sends a network request or compiles a CV.
import {
  capturedBuildSchema,
  buildDiagnosticsKey,
  buildDiagnosticsSchema,
} from '@platform/schema';
import type { CapturedBuild, PreviewRelease } from '@platform/schema';
import { previewPolicy } from '@platform/config';

export function syntheticPublisher(bucket: Pick<R2Bucket, 'put'>) {
  const versions = new Map<
    string,
    { createdAt: string; release: PreviewRelease | null }
  >();
  const runs = new Map<number, CapturedBuild>();
  let active = crypto.randomUUID() as string;
  versions.set(active, { createdAt: new Date().toISOString(), release: null });
  let deployment = {
    id: crypto.randomUUID(),
    created_on: new Date().toISOString(),
    versions: [{ version_id: active, percentage: 100 }],
  };
  const env = {
    PUBLISH_BUILDS_ENABLED: 'true',
    PUBLISH_GITHUB_TOKEN: 'synthetic-github-credential',
    PREVIEW_ACTIVATION_ENABLED: 'true',
    PREVIEW_ACCESS_AUDIENCE: 'synthetic-preview-audience',
    PREVIEW_CLOUDFLARE_API_TOKEN: 'synthetic-cloudflare-credential',
    CLOUDFLARE_ACCOUNT_ID: 'a'.repeat(32),
  };
  function run(id: number, capture: CapturedBuild) {
    return {
      id,
      display_title: `Capture ${capture.id}`,
      head_branch: 'main',
      path: '.github/workflows/build-capture.yml',
      event: 'workflow_dispatch',
      run_attempt: 1,
      status: 'completed',
      conclusion: 'success',
    };
  }
  return {
    env,
    github: async (request: Request) => {
      if (request.method === 'POST') {
        const body = (await request.json()) as { inputs: { capture: string } };
        const capture = capturedBuildSchema.parse(
          JSON.parse(body.inputs.capture),
        );
        const id = runs.size + 1;
        runs.set(id, capture);
        const report = buildDiagnosticsSchema.parse({
          schemaVersion: 1,
          capture,
          run: { runId: id, attempt: 1 },
          createdAt: new Date().toISOString(),
          outcomes: {
            retrieval: 'success',
            build: 'success',
            package: 'success',
            upload: 'success',
          },
          logs: [
            {
              stage: 'cv-compile',
              text:
                'Synthetic diagnostic only: <script>window.reportExecuted = true</script>\n' +
                'long-compiler-line-'.repeat(60),
              truncated: false,
            },
          ],
        });
        await bucket.put(
          buildDiagnosticsKey(capture.id, report.run),
          JSON.stringify(report),
        );
        versions.set(crypto.randomUUID(), {
          createdAt: new Date().toISOString(),
          release: {
            schemaVersion: 1,
            id: capture.id,
            sequence: capture.sequence,
            revision: capture.revision,
            snapshotSha256: capture.snapshotSha256,
            bundleSha256: 'b'.repeat(64),
          },
        });
        return Response.json({ workflow_run_id: id });
      }
      if (request.url.includes('/workflows/'))
        return Response.json({
          workflow_runs: [...runs].map(([id, capture]) => run(id, capture)),
        });
      const id = Number(request.url.split('/').at(-1)),
        capture = runs.get(id);
      return capture
        ? Response.json(run(id, capture))
        : new Response(null, { status: 404 });
    },
    cloudflare: async (request: Request) => {
      const url = new URL(request.url);
      if (request.method === 'POST') {
        const body = (await request.json()) as {
          versions: { version_id: string }[];
        };
        active = body.versions[0]!.version_id;
        if (!versions.has(active)) return new Response(null, { status: 404 });
        deployment = {
          id: crypto.randomUUID(),
          created_on: new Date().toISOString(),
          versions: [{ version_id: active, percentage: 100 }],
        };
        return Response.json({
          success: true,
          result: { ...deployment, strategy: 'percentage' },
        });
      }
      if (url.pathname.endsWith('/deployments'))
        return Response.json({
          success: true,
          result: { deployments: [deployment] },
        });
      if (url.pathname.endsWith('/versions'))
        return Response.json({
          success: true,
          result: {
            items: [...versions].map(([id, value]) => ({
              id,
              metadata: { created_on: value.createdAt },
            })),
          },
        });
      const id = url.pathname.split('/').at(-1)!,
        value = versions.get(id);
      if (!value) return new Response(null, { status: 404 });
      return Response.json({
        success: true,
        result: {
          id,
          resources: {
            bindings: Object.entries({
              APP_ENV: 'preview',
              ACCESS_ISSUER: 'https://test.cloudflareaccess.com',
              ACCESS_AUDIENCE: env.PREVIEW_ACCESS_AUDIENCE,
              OWNER_EMAIL: 'owner@example.com',
              PREVIEW_RELEASE: value.release
                ? JSON.stringify(value.release)
                : previewPolicy.bootstrap,
            }).map(([name, text]) => ({ type: 'plain_text', name, text })),
          },
        },
      });
    },
  };
}
