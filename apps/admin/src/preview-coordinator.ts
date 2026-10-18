import {
  previewCandidateSchema,
  previewActivationSchema,
  previewCurrentVersionSchema,
  publishCaptureRequestSchema,
  type PreviewActivation,
  type PreviewCandidate,
  type PreviewCurrentVersion,
} from '@platform/schema';
import {
  readPublishCapture,
  readBuildDispatch,
  readPreviewDeployment,
  deploymentStore,
  previewDeploymentSummary,
  PublishCaptureError,
} from '@platform/database';

// These ports are privileged provider operations, not caller-supplied HTTP data.
// The owner-authenticated route supplies the transport; the coordinator never
// trusts a browser to assert build success or deployment.
export type PreviewDeploymentProvider = {
  buildSucceeded: (captureId: string, runId: number) => Promise<boolean>;
  candidate: (versionId: string) => Promise<PreviewCandidate>;
  current: () => Promise<PreviewCurrentVersion>;
  activate: (versionId: string) => Promise<PreviewActivation>;
  findActivation: (
    versionId: string,
  ) => Promise<Extract<PreviewActivation, { status: 'deployed' }> | null>;
};
const conflict = (message: string) => new PublishCaptureError(message, 409);
async function reconcile(
  binding: D1Database,
  row: NonNullable<Awaited<ReturnType<typeof readPreviewDeployment>>>,
  actor: string,
  provider: PreviewDeploymentProvider,
  clock: () => Date,
  purpose: 'preview' | 'publish',
) {
  const { finishPreviewDeployment } = deploymentStore(purpose);
  if (row.status === 'deployed' || row.status === 'rejected')
    return previewDeploymentSummary(row);
  let observation: PreviewActivation | null = null;
  try {
    const found = await provider.findActivation(row.versionId);
    observation = found ? previewActivationSchema.parse(found) : null;
  } catch {
    /* Retain the fence on unavailable or malformed evidence. */
  }
  if (
    observation?.status === 'deployed' &&
    observation.versionId === row.versionId &&
    Date.parse(observation.createdAt) >= Date.parse(row.requestedAt)
  )
    return previewDeploymentSummary(
      (await finishPreviewDeployment(
        binding,
        row.captureId,
        'deployed',
        observation.deploymentId,
        actor,
        clock().toISOString(),
      ))!,
    );
  return previewDeploymentSummary(row);
}
export async function reconcilePreviewDeployment(
  binding: D1Database,
  id: string,
  actor: string,
  provider: PreviewDeploymentProvider,
  clock = () => new Date(),
  purpose: 'preview' | 'publish' = 'preview',
) {
  const { readPreviewDeployment } = deploymentStore(purpose);
  id = publishCaptureRequestSchema.shape.id.parse(id);
  const row = await readPreviewDeployment(binding, id);
  if (!row) throw new PublishCaptureError('Preview deployment not found.', 404);
  // No expiry override or retry POST. Positive evidence may arrive after the
  // input's TTL, and absence from a bounded history is never rejection proof.
  return reconcile(binding, row, actor, provider, clock, purpose);
}
export async function coordinatePreviewDeployment(
  binding: D1Database,
  candidateId: string,
  versionId: string,
  actor: string,
  provider: PreviewDeploymentProvider,
  clock = () => new Date(),
  purpose: 'preview' | 'publish' = 'preview',
) {
  const {
    readPreviewDeployment,
    readPreviewFence,
    reservePreviewDeployment,
    finishPreviewDeployment,
  } = deploymentStore(purpose);
  candidateId = publishCaptureRequestSchema.shape.id.parse(candidateId);
  versionId = previewCandidateSchema.shape.versionId.parse(versionId);
  const existing = await readPreviewDeployment(binding, candidateId);
  if (existing) {
    if (existing.versionId !== versionId)
      throw conflict(
        'This capture already has a different deployment attempt.',
      );
    return reconcile(binding, existing, actor, provider, clock, purpose);
  }
  if (await readPreviewFence(binding))
    throw conflict(
      'Resolve the pending preview deployment before starting another.',
    );
  const capture = await readPublishCapture(binding, candidateId);
  const dispatch = await readBuildDispatch(binding, candidateId);
  if (!capture) throw new PublishCaptureError('Capture not found.', 404);
  if (
    capture.purpose !== purpose ||
    capture.status !== 'ready' ||
    capture.expiresAt <= clock().toISOString() ||
    dispatch?.status !== 'queued' ||
    !dispatch.runId
  )
    throw conflict(
      'A ready preview capture and its completed build are required.',
    );
  if (!(await provider.buildSucceeded(candidateId, dispatch.runId)))
    throw conflict('The captured build has not succeeded.');
  const candidate = previewCandidateSchema.parse(
    await provider.candidate(versionId),
  );
  if (
    candidate.versionId !== versionId ||
    candidate.release.id !== candidateId ||
    candidate.release.sequence !== capture.sequence ||
    candidate.release.revision !== capture.revision ||
    candidate.release.snapshotSha256 !== capture.snapshotSha256
  )
    throw conflict('The uploaded preview does not match the capture.');
  const current = previewCurrentVersionSchema.parse(await provider.current());
  if (
    current.versionId === versionId ||
    (current.release &&
      (current.release.sequence >= capture.sequence ||
        current.release.revision > capture.revision))
  )
    throw conflict('A matching or newer preview is already deployed.');
  let row;
  try {
    const now = clock().toISOString();
    row = await reservePreviewDeployment(binding, {
      captureId: candidateId,
      versionId,
      previousVersionId: current.versionId,
      runId: dispatch.runId,
      bundleSha256: candidate.release.bundleSha256,
      requestedAt: now,
      updatedAt: now,
      requestedBy: actor,
      updatedBy: actor,
    });
  } catch {
    const raced = await readPreviewDeployment(binding, candidateId);
    if (raced && raced.versionId === versionId)
      return previewDeploymentSummary(raced);
    throw conflict(
      'Another preview deployment won the reservation. Reload its status.',
    );
  }
  // Only the insert winner reaches the mutation. Recheck the provider baseline
  // after acquiring the durable slot; out-of-band changes fail before sending.
  try {
    const baseline = previewCurrentVersionSchema.parse(
      await provider.current(),
    );
    if (
      baseline.versionId !== current.versionId ||
      capture.expiresAt <= clock().toISOString()
    )
      throw new Error('Changed baseline or expired capture');
  } catch {
    return previewDeploymentSummary(
      (await finishPreviewDeployment(
        binding,
        candidateId,
        'rejected',
        null,
        actor,
        clock().toISOString(),
      ))!,
    );
  }
  let outcome: PreviewActivation;
  try {
    outcome = previewActivationSchema.parse(await provider.activate(versionId));
    if (
      outcome.status === 'deployed' &&
      (outcome.versionId !== versionId ||
        Date.parse(outcome.createdAt) < Date.parse(row.requestedAt))
    )
      outcome = { status: 'uncertain' };
  } catch {
    outcome = { status: 'uncertain' };
  }
  row = (await finishPreviewDeployment(
    binding,
    candidateId,
    outcome.status,
    outcome.status === 'deployed' ? outcome.deploymentId : null,
    actor,
    clock().toISOString(),
  ))!;
  return previewDeploymentSummary(row);
}
