import {
  capturedBuildSchema,
  publishCaptureRequestSchema,
} from '@platform/schema';
import { publishing, publishingEnvSchema } from '@platform/config';
import {
  readPublishCapture,
  readBuildDispatch,
  reserveBuildDispatch,
  finishBuildDispatch,
  dispatchSummary,
  PublishCaptureError,
} from '@platform/database';
import {
  sendBuildDispatch,
  findDispatchedBuild,
  readGitHubBuild,
  buildRunUrl,
  BuildServiceError,
  type GitHubFetch,
} from './github-builds.ts';

function configuration(raw: unknown) {
  const parsed = publishingEnvSchema.safeParse(raw);
  if (!parsed.success)
    throw new BuildServiceError(
      'Private builds are not configured for this environment.',
    );
  return parsed.data;
}
export async function requestCapturedBuild(
  binding: D1Database,
  rawEnv: unknown,
  rawId: string,
  actor: string,
  fetcher: GitHubFetch = fetch,
  clock = () => new Date(),
) {
  const id = publishCaptureRequestSchema.shape.id.parse(rawId);
  const config = configuration(rawEnv);
  const now = clock();
  let row = await readBuildDispatch(binding, id);
  if (row) {
    if (
      (row.status === 'dispatching' || row.status === 'uncertain') &&
      now.getTime() - Date.parse(row.requestedAt) >= publishing.reconcileAfterMs
    ) {
      const runId = await findDispatchedBuild(
        config.PUBLISH_GITHUB_TOKEN,
        id,
        fetcher,
      );
      row = (await finishBuildDispatch(
        binding,
        id,
        runId ? 'queued' : 'uncertain',
        runId,
        actor,
        clock().toISOString(),
      ))!;
    }
    return dispatchSummary(row);
  }
  const capture = await readPublishCapture(binding, id);
  if (!capture) throw new PublishCaptureError('Capture not found.', 404);
  if (
    capture.environment !==
    (config.APP_ENV === 'production' ? 'production' : 'preview')
  )
    throw new PublishCaptureError('Capture environment mismatch.', 409);
  if (capture.status !== 'ready' || capture.expiresAt <= now.toISOString())
    throw new PublishCaptureError(
      'Prepare a ready, unexpired capture before requesting a build.',
      409,
    );
  const descriptor = capturedBuildSchema
    .strip()
    .parse({ ...capture, schemaVersion: 1 });
  try {
    row = await reserveBuildDispatch(binding, id, actor, now.toISOString());
  } catch {
    const raced = await readBuildDispatch(binding, id);
    if (raced) return dispatchSummary(raced);
    throw new PublishCaptureError(
      'The capture could not be reserved for a build. Retry this same request.',
      409,
    );
  }
  const outcome = await sendBuildDispatch(
    config.PUBLISH_GITHUB_TOKEN,
    descriptor,
    fetcher,
  );
  return dispatchSummary(
    (await finishBuildDispatch(
      binding,
      id,
      outcome.status,
      outcome.runId,
      actor,
      clock().toISOString(),
    ))!,
  );
}
export async function capturedBuildStatus(
  binding: D1Database,
  rawEnv: unknown,
  rawId: string,
  fetcher: GitHubFetch = fetch,
) {
  const id = publishCaptureRequestSchema.shape.id.parse(rawId);
  const row = await readBuildDispatch(binding, id);
  if (!row) throw new PublishCaptureError('Build request not found.', 404);
  const dispatch = dispatchSummary(row);
  const state = {
    dispatch,
    url: row.runId ? buildRunUrl(row.runId) : null,
    statusError: null as string | null,
  };
  if (!row.runId) return { ...state, run: null };
  const config = configuration(rawEnv);
  try {
    return {
      ...state,
      run: await readGitHubBuild(
        config.PUBLISH_GITHUB_TOKEN,
        id,
        row.runId,
        fetcher,
      ),
    };
  } catch (error) {
    if (!(error instanceof BuildServiceError)) throw error;
    // The durable dispatch is still valid when its provider read is unavailable.
    // A null run cannot authorize activation or claim that a build succeeded.
    return {
      ...state,
      run: null,
      statusError: `Build request recorded. ${error.message}`,
    };
  }
}
