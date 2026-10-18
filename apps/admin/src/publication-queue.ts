import { capturedBuildSchema } from '@platform/schema';
import { publicationEnvSchema, publicationPolicy } from '@platform/config';
import {
  nextPublication,
  finishPublication,
  readPublishCapture,
  deploymentStore,
} from '@platform/database';
import { requestCapturedBuild, capturedBuildStatus } from './build-dispatch.ts';
import {
  coordinatePreviewDeployment,
  reconcilePreviewDeployment,
} from './preview-coordinator.ts';
import { publicationProvider } from './publication-provider.ts';
import type { GitHubFetch } from './github-builds.ts';
import type { PreviewFetch } from './preview-cloudflare.ts';

// One bounded item per tick. The durable request survives a closed browser;
// overlapping ticks share the tested dispatch and activation reservations.
export async function advancePublication(
  binding: D1Database,
  raw: unknown,
  github: GitHubFetch = fetch,
  cloudflare: PreviewFetch = fetch,
  clock = () => new Date(),
) {
  const config = publicationEnvSchema.parse(raw);
  const item = await nextPublication(binding);
  if (!item) return;
  const capture = await readPublishCapture(binding, item.captureId);
  if (
    !capture ||
    capture.purpose !== 'publish' ||
    capture.environment !==
      (config.APP_ENV === 'production' ? 'production' : 'preview')
  )
    throw new Error('Publication environment or identity mismatch');
  const provider = publicationProvider(config, github, cloudflare);
  const store = deploymentStore('publish');
  const existing = await store.readPreviewDeployment(binding, capture.id);
  // Reconcile an earlier intent even after input expiry. Never retry a POST.
  if (existing) {
    const result = await reconcilePreviewDeployment(
      binding,
      capture.id,
      'system:publish',
      provider,
      clock,
      'publish',
    );
    if (result.status === 'deployed' || result.status === 'rejected')
      await finishPublication(
        binding,
        capture.id,
        result.status === 'deployed' ? 'published' : 'failed',
        clock().toISOString(),
      );
    return;
  }
  if (capture.expiresAt <= clock().toISOString()) {
    await finishPublication(
      binding,
      capture.id,
      'expired',
      clock().toISOString(),
    );
    return;
  }
  if (capture.status !== 'ready')
    throw new Error('Publication input is not ready');
  const dispatch = await requestCapturedBuild(
    binding,
    config,
    capture.id,
    'system:publish',
    github,
    clock,
  );
  if (dispatch.status === 'rejected') {
    await finishPublication(
      binding,
      capture.id,
      'failed',
      clock().toISOString(),
    );
    return;
  }
  if (!dispatch.runId) return;
  const { run } = await capturedBuildStatus(
    binding,
    config,
    capture.id,
    github,
  );
  if (!run || run.status !== 'completed') return;
  if (run.conclusion !== 'success') {
    await finishPublication(
      binding,
      capture.id,
      'failed',
      clock().toISOString(),
    );
    return;
  }
  const current = await provider.current();
  if (
    current.release &&
    (current.release.sequence >= capture.sequence ||
      current.release.revision > capture.revision)
  ) {
    await finishPublication(
      binding,
      capture.id,
      'superseded',
      clock().toISOString(),
    );
    return;
  }
  const candidate = await provider.findCandidate(
    capturedBuildSchema.strip().parse({ ...capture, schemaVersion: 1 }),
  );
  if (!candidate)
    throw new Error('Completed publication has no verified version');
  const result = await coordinatePreviewDeployment(
    binding,
    capture.id,
    candidate.versionId,
    'system:publish',
    provider,
    clock,
    'publish',
  );
  if (result.status === 'deployed' || result.status === 'rejected')
    await finishPublication(
      binding,
      capture.id,
      result.status === 'deployed' ? 'published' : 'failed',
      clock().toISOString(),
    );
}
export async function scheduledPublication(
  event: Pick<ScheduledController, 'cron'>,
  env: { CONTENT: D1Database; PUBLISH_DEPLOYMENTS_ENABLED?: string },
) {
  if (
    event.cron !== publicationPolicy.cron ||
    env.PUBLISH_DEPLOYMENTS_ENABLED !== 'true'
  )
    return;
  try {
    await advancePublication(env.CONTENT, env);
  } catch {
    throw new Error(
      'Publication needs another status check; the last confirmed deployment is retained.',
    );
  }
}
