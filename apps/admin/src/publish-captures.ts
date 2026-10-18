import {
  capturePublishInput,
  captureSummary,
  readPublishCapture,
  reservePublishCapture,
  transitionPublishCapture,
  expiredPublishCaptures,
  markPublishCapturesExpired,
  PublishCaptureError,
} from '@platform/database';
import {
  publishCaptureRequestSchema,
  publishInputSchema,
  type PublishCaptureRequest,
} from '@platform/schema';
import { boundedBytes, publishCapturePolicy, sha256 } from '@platform/config';

type Capture = NonNullable<Awaited<ReturnType<typeof readPublishCapture>>>;
export const publishCaptureKey = (id: string) =>
  `publish-inputs/${publishCaptureRequestSchema.shape.id.parse(id)}.json`;

export async function expirePrivateCaptures(
  binding: D1Database,
  bucket: R2Bucket,
  actor: string,
  now: Date,
) {
  const expired = await expiredPublishCaptures(binding, now.toISOString());
  if (!expired.length) return;
  // Storage must be deleted before releasing its reservation. If R2 fails,
  // the bounded storage slot stays occupied and the next request can retry.
  await bucket.delete(expired.map((row) => publishCaptureKey(row.id)));
  await markPublishCapturesExpired(
    binding,
    expired.map((row) => row.id),
    actor,
    now.toISOString(),
  );
}

async function storedInput(bucket: R2Bucket, row: Capture) {
  const object = await bucket.get(publishCaptureKey(row.id));
  if (!object) return null;
  if (
    object.size !== row.byteSize ||
    object.size > publishCapturePolicy.maxInputBytes
  ) {
    await object.body.cancel();
    throw new PublishCaptureError(
      'Stored capture failed its integrity check. Create a new request.',
      409,
    );
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = await boundedBytes(new Response(object.body), row.byteSize);
  } catch (error) {
    // A broken storage stream is retryable; only a completed invalid payload
    // or a proven size violation establishes an integrity failure.
    if (!(error instanceof Error) || error.message !== 'body-size') throw error;
    throw new PublishCaptureError(
      'Stored capture failed its integrity check. Create a new request.',
      409,
    );
  }
  try {
    const body = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (
      bytes.length !== row.byteSize ||
      (await sha256(body)) !== row.inputSha256
    )
      throw new Error('Capture digest mismatch');
    const input = publishInputSchema.parse(JSON.parse(body));
    if (
      input.snapshot.revision !== row.revision ||
      (await sha256(JSON.stringify(input.snapshot))) !== row.snapshotSha256
    )
      throw new Error('Snapshot digest mismatch');
    return body;
  } catch {
    throw new PublishCaptureError(
      'Stored capture failed its integrity check. Create a new request.',
      409,
    );
  }
}

export async function downloadPrivateCapture(
  binding: D1Database,
  bucket: R2Bucket,
  id: string,
  now = new Date(),
) {
  const row = await readPublishCapture(
    binding,
    publishCaptureRequestSchema.shape.id.parse(id),
  );
  if (!row) throw new PublishCaptureError('Capture not found.', 404);
  if (row.status !== 'ready' || row.expiresAt <= now.toISOString())
    throw new PublishCaptureError(
      'This private capture is not ready or has expired.',
      409,
    );
  const body = await storedInput(bucket, row);
  if (!body)
    throw new PublishCaptureError(
      'The private capture is unavailable. Prepare a new capture.',
      409,
    );
  return { body, sha256: row.inputSha256 };
}

const assertSameRequest = (row: Capture, request: PublishCaptureRequest) => {
  if (row.revision !== request.revision || row.purpose !== request.purpose)
    throw new PublishCaptureError(
      'This request ID belongs to another capture. Use a new request ID.',
      409,
    );
};

async function expireCapture(
  binding: D1Database,
  bucket: R2Bucket,
  row: Capture,
  actor: string,
  now: Date,
) {
  // Delete even if another request already expired the row: a delayed R2 put
  // may have completed after that request's cleanup.
  await bucket.delete(publishCaptureKey(row.id));
  await markPublishCapturesExpired(binding, [row.id], actor, now.toISOString());
  return captureSummary((await readPublishCapture(binding, row.id))!);
}

async function finishCapture(
  binding: D1Database,
  bucket: R2Bucket,
  row: Capture,
  actor: string,
  clock: () => Date,
) {
  const finished = (await transitionPublishCapture(
    binding,
    row.id,
    'capturing',
    'ready',
    actor,
    clock().toISOString(),
  ))!;
  const now = clock();
  if (finished.expiresAt <= now.toISOString())
    return expireCapture(binding, bucket, finished, actor, now);
  return captureSummary(finished);
}

// D1 reservations and R2 cannot share a transaction. The reservation is written
// first; its immutable hashes and conditional R2 put make recovery idempotent.
// Nothing dispatches or publishes until a separate consumer sees ready + TTL.
export async function createPrivateCapture(
  binding: D1Database,
  bucket: R2Bucket,
  raw: unknown,
  actor: string,
  clock: () => Date = () => new Date(),
  environment: 'preview' | 'production' = 'preview',
) {
  const request = publishCaptureRequestSchema.parse(raw);
  const now = clock();
  await expirePrivateCaptures(binding, bucket, actor, now);
  let row = await readPublishCapture(binding, request.id);
  if (row) {
    if (row.environment !== environment)
      throw new PublishCaptureError('Capture environment mismatch.', 409);
    assertSameRequest(row, request);
    if (row.expiresAt <= now.toISOString() && row.status !== 'expired')
      return expireCapture(binding, bucket, row, actor, now);
    if (row.status !== 'capturing') return captureSummary(row);
    try {
      const body = await storedInput(bucket, row);
      if (body) return finishCapture(binding, bucket, row, actor, clock);
    } catch (error) {
      if (error instanceof PublishCaptureError) {
        await transitionPublishCapture(
          binding,
          row.id,
          'capturing',
          'failed',
          actor,
          clock().toISOString(),
          'integrity',
        );
      }
      throw error;
    }
  }
  const input = await capturePublishInput(binding);
  if (input.snapshot.revision !== request.revision) {
    if (row) {
      // An earlier request may still be writing its valid object. Do not race
      // it into failure; after the bounded grace period require a new capture.
      if (
        now.getTime() - Date.parse(row.createdAt) >=
        publishCapturePolicy.interruptedAfterMs
      )
        row = (await transitionPublishCapture(
          binding,
          row.id,
          'capturing',
          'failed',
          actor,
          now.toISOString(),
          'interrupted',
        ))!;
      return captureSummary(row);
    }
    throw new PublishCaptureError(
      'A newer edit exists. Reload before preparing a publish.',
      409,
    );
  }
  // A retry at the same revision must reproduce exactly the original envelope,
  // including the capture timestamp, rather than silently replacing its hash.
  input.snapshot.generatedAt = row?.createdAt ?? now.toISOString();
  const body = JSON.stringify(input);
  const byteSize = new TextEncoder().encode(body).byteLength;
  if (byteSize > publishCapturePolicy.maxInputBytes)
    throw new PublishCaptureError(
      'The private build input exceeds 2 MiB.',
      413,
    );
  const inputSha256 = await sha256(body);
  const snapshotSha256 = await sha256(JSON.stringify(input.snapshot));
  if (!row) {
    try {
      row = await reservePublishCapture(binding, {
        ...request,
        environment,
        inputSha256,
        snapshotSha256,
        byteSize,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        expiresAt: new Date(
          now.getTime() + publishCapturePolicy.retentionMs,
        ).toISOString(),
        createdBy: actor,
        updatedBy: actor,
      });
    } catch (error) {
      // Another request may have reserved this UUID between our read and insert.
      const raced = await readPublishCapture(binding, request.id);
      if (!raced) throw error;
      assertSameRequest(raced, request);
      return captureSummary(raced);
    }
  }
  if (
    row.inputSha256 !== inputSha256 ||
    row.snapshotSha256 !== snapshotSha256 ||
    row.byteSize !== byteSize
  ) {
    await transitionPublishCapture(
      binding,
      row.id,
      'capturing',
      'failed',
      actor,
      clock().toISOString(),
      'integrity',
    );
    throw new PublishCaptureError(
      'Capture content changed without a matching revision. Prepare a new request.',
      409,
    );
  }
  const beforeWrite = clock();
  if (row.expiresAt <= beforeWrite.toISOString())
    return expireCapture(binding, bucket, row, actor, beforeWrite);
  // A UUID-derived key has no caller-chosen prefix. Conditional creation means
  // neither a retry nor a racing request can overwrite an existing envelope.
  const stored = await bucket.put(publishCaptureKey(row.id), body, {
    onlyIf: new Headers({ 'If-None-Match': '*' }),
    sha256: row.inputSha256,
    httpMetadata: {
      contentType: 'application/octet-stream',
      cacheControl: 'no-store',
    },
    customMetadata: { inputSha256: row.inputSha256 },
  });
  if (!stored) {
    try {
      if (!(await storedInput(bucket, row)))
        throw new PublishCaptureError(
          'Private storage is not ready. Retry this same request.',
          503,
        );
    } catch (error) {
      if (error instanceof PublishCaptureError && error.status === 409)
        await transitionPublishCapture(
          binding,
          row.id,
          'capturing',
          'failed',
          actor,
          clock().toISOString(),
          'integrity',
        );
      throw error;
    }
  }
  return finishCapture(binding, bucket, row, actor, clock);
}
