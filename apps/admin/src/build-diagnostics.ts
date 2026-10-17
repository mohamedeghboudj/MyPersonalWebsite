import {
  buildDiagnosticsKey,
  buildDiagnosticsSchema,
  buildDiagnosticPolicy,
  capturedBuildSchema,
  publishCaptureRequestSchema,
} from '@platform/schema';
import { boundedBytes, publishingEnvSchema } from '@platform/config';
import {
  readPublishCapture,
  readBuildDispatch,
  PublishCaptureError,
} from '@platform/database';
import { readGitHubBuild, type GitHubFetch } from './github-builds.ts';

export async function readBuildDiagnostics(
  binding: D1Database,
  bucket: R2Bucket,
  env: unknown,
  rawId: string,
  github: GitHubFetch,
  clock = () => new Date(),
) {
  const id = publishCaptureRequestSchema.shape.id.parse(rawId);
  const capture = await readPublishCapture(binding, id);
  if (!capture) throw new PublishCaptureError('Capture not found.', 404);
  if (
    Date.parse(capture.expiresAt) <= clock().getTime() ||
    capture.status === 'expired'
  )
    throw new PublishCaptureError('This private report has expired.', 410);
  const dispatch = await readBuildDispatch(binding, id);
  if (dispatch?.status !== 'queued' || !dispatch.runId)
    throw new PublishCaptureError(
      'Reconcile the build request before reading its report.',
      409,
    );
  const configured = publishingEnvSchema.safeParse(env);
  if (!configured.success)
    throw new PublishCaptureError(
      'Private builds are not configured for this environment.',
      503,
    );
  const config = configured.data;
  const run = await readGitHubBuild(
    config.PUBLISH_GITHUB_TOKEN,
    id,
    dispatch.runId,
    github,
  );
  if (run.status !== 'completed' || !run.attempt)
    throw new PublishCaptureError(
      'A completed, verified build attempt is required.',
      409,
    );
  const object = await bucket.get(
    buildDiagnosticsKey(id, { runId: dispatch.runId, attempt: run.attempt }),
  );
  if (!object)
    throw new PublishCaptureError(
      'No private report is available for this build attempt.',
      404,
    );
  try {
    if (object.size > buildDiagnosticPolicy.maxReportBytes) {
      await object.body.cancel();
      throw new Error('Report too large');
    }
    const body = await boundedBytes(
      new Response(object.body),
      buildDiagnosticPolicy.maxReportBytes,
    );
    const report = buildDiagnosticsSchema.parse(
      JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)),
    );
    const descriptor = capturedBuildSchema
      .strip()
      .parse({ ...capture, schemaVersion: 1 });
    if (
      JSON.stringify(report.capture) !== JSON.stringify(descriptor) ||
      report.run.runId !== dispatch.runId ||
      report.run.attempt !== run.attempt ||
      Date.parse(report.createdAt) > clock().getTime() + 60000 ||
      Date.parse(capture.expiresAt) <= clock().getTime()
    )
      throw new Error('Diagnostic identity mismatch');
    return report;
  } catch {
    throw new PublishCaptureError(
      'The private build report could not be verified.',
      503,
    );
  }
}
