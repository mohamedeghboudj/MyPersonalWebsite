import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import { createAdmin } from '../apps/admin/src/index';
import { createPrivateCapture } from '../apps/admin/src/publish-captures';
import { readBuildDiagnostics } from '../apps/admin/src/build-diagnostics';
import {
  readPublishCapture,
  reserveBuildDispatch,
  finishBuildDispatch,
  editorOverview,
} from '@platform/database';
import {
  buildDiagnosticsSchema,
  capturedBuildSchema,
  buildDiagnosticsKey,
  buildDiagnosticPolicy,
  type BuildDiagnostics,
} from '@platform/schema';
let local: Awaited<ReturnType<typeof localDatabase>>;
let report: BuildDiagnostics;
const env = {
  APP_ENV: 'local',
  PUBLISH_BUILDS_ENABLED: 'true',
  PUBLISH_GITHUB_TOKEN: 'synthetic-github-credential',
  ACCESS_ISSUER: 'https://team.cloudflareaccess.com',
  ACCESS_AUDIENCE: 'synthetic-audience',
  OWNER_EMAIL: 'owner@example.com',
  ADMIN_ORIGIN: 'https://admin.example.com',
};
const headers = { 'Cf-Access-Jwt-Assertion': 'synthetic-owner-jwt' };
const bindings = () => ({
  ...env,
  CONTENT: local.content,
  INBOX: local.inbox,
  MEDIA: local.media,
});
const owner = async () => ({ sub: 'owner', email: env.OWNER_EMAIL });
const path = () => `/api/publishing/captures/${report.capture.id}/diagnostics`;
const key = () => buildDiagnosticsKey(report.capture.id, report.run);
const run = (extra: Record<string, unknown> = {}) =>
  Response.json({
    id: 123,
    run_attempt: 2,
    display_title: `Capture ${report.capture.id}`,
    head_branch: 'main',
    path: '.github/workflows/build-capture.yml@main',
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'failure',
    ...extra,
  });
beforeEach(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
  const id = crypto.randomUUID(),
    now = new Date().toISOString();
  await createPrivateCapture(
    local.content,
    local.media,
    { id, revision: 0, purpose: 'preview' },
    'owner',
  );
  await reserveBuildDispatch(local.content, id, 'owner', now);
  await finishBuildDispatch(local.content, id, 'queued', 123, 'owner', now);
  const capture = capturedBuildSchema.strip().parse({
    ...(await readPublishCapture(local.content, id)),
    schemaVersion: 1,
  });
  report = buildDiagnosticsSchema.parse({
    schemaVersion: 1,
    capture,
    run: { runId: 123, attempt: 2 },
    createdAt: new Date().toISOString(),
    outcomes: {
      retrieval: 'success',
      build: 'failure',
      package: 'skipped',
      upload: 'skipped',
    },
    logs: [
      {
        stage: 'cv-compile',
        text: 'PRIVATE synthetic error <script>example</script>',
        truncated: false,
      },
    ],
  });
  await local.media.put(key(), JSON.stringify(report));
});
afterEach(async () => local?.runtime.dispose());
it('returns an owner-only, noncached attachment for the verified capture and current failed build attempt without writes', async () => {
  const github = vi.fn(async (request: Request) => {
    expect(request.method).toBe('GET');
    return run();
  });
  const app = createAdmin(owner, async () => false, github);
  const revision = (await editorOverview(local.content)).revision;
  const response = await app.request(path(), { headers }, bindings());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual(report);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(response.headers.get('Content-Disposition')).toContain('attachment');
  expect(response.headers.get('Content-Security-Policy')).toBe(
    "default-src 'none'; sandbox",
  );
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect((await editorOverview(local.content)).revision).toBe(revision);
  expect(github.mock.calls.every(([request]) => request.method === 'GET')).toBe(
    true,
  );
});
it('denies anonymous and non-owner requests before either provider or storage reads', async () => {
  const github = vi.fn(async () => run());
  const anonymous = await createAdmin(owner, async () => true, github).request(
    path(),
    {},
    bindings(),
  );
  const other = await createAdmin(
    async () => ({ sub: 'other', email: 'other@example.com' }),
    async () => true,
    github,
  ).request(path(), { headers }, bindings());
  expect(anonymous.status).toBe(401);
  expect(other.status).toBe(403);
  expect(await anonymous.text()).not.toContain('PRIVATE');
  expect(await other.text()).not.toContain('PRIVATE');
  expect(github).not.toHaveBeenCalled();
});
it('does not substitute an old attempt, unfinished run or different workflow when a report exists', async () => {
  for (const extra of [
    { run_attempt: 3 },
    { run_attempt: undefined },
    { status: 'in_progress', conclusion: null },
    { id: 124 },
    { path: '.github/workflows/build-capture.yml@other' },
    { display_title: 'Different capture' },
  ]) {
    const response = await createAdmin(
      owner,
      async () => true,
      async () => run(extra),
    ).request(path(), { headers }, bindings());
    expect(response.status).not.toBe(200);
    expect(await response.text()).not.toContain('PRIVATE');
  }
});
it('refuses mismatched, malformed and oversized stored reports without echoing their bodies', async () => {
  for (const body of [
    JSON.stringify({ ...report, capture: { ...report.capture, revision: 1 } }),
    JSON.stringify({ ...report, run: { runId: 124, attempt: 2 } }),
    JSON.stringify({ ...report, run: { runId: 123, attempt: 1 } }),
    JSON.stringify({
      ...report,
      createdAt: new Date(Date.now() + 120000).toISOString(),
    }),
    'PRIVATE invalid JSON',
    'PRIVATE'.repeat(Math.ceil(buildDiagnosticPolicy.maxReportBytes / 7) + 1),
  ]) {
    await local.media.put(key(), body);
    const response = await createAdmin(
      owner,
      async () => true,
      async () => run(),
    ).request(path(), { headers }, bindings());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE');
  }
});
it('enforces capture expiry before reads and again after reading a report', async () => {
  const github = vi.fn(async () => run()),
    expired = new Date(report.capture.expiresAt);
  await expect(
    readBuildDiagnostics(
      local.content,
      local.media,
      env,
      report.capture.id,
      github,
      () => expired,
    ),
  ).rejects.toMatchObject({ status: 410 });
  expect(github).not.toHaveBeenCalled();
  let checks = 0;
  await expect(
    readBuildDiagnostics(
      local.content,
      local.media,
      env,
      report.capture.id,
      github,
      () => (++checks < 3 ? new Date(report.createdAt) : expired),
    ),
  ).rejects.toThrow('could not be verified');
});
