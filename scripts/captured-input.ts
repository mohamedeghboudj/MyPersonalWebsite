import { writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { capturedBuildSchema, publicSnapshotSchema } from '@platform/schema';
import { z } from 'zod';
import { boundedBytes, publishCapturePolicy, sha256 } from '@platform/config';
import {
  verifyPublishInput,
  materializePublishInput,
} from './publish-input.ts';

export function validateCaptureTime(raw: unknown, now = new Date()) {
  const capture = capturedBuildSchema.parse(raw);
  const created = Date.parse(capture.createdAt);
  const expires = Date.parse(capture.expiresAt);
  if (
    created > now.getTime() + 60000 ||
    expires <= now.getTime() ||
    expires - created !== publishCapturePolicy.retentionMs ||
    capture.byteSize > publishCapturePolicy.maxInputBytes
  )
    throw new Error('Invalid or expired capture');
  return capture;
}
export async function fetchCapturedInput(
  raw: unknown,
  readObject: (
    key: string,
    maxBytes: number,
  ) => Promise<ReadableStream<Uint8Array> | null>,
  destination: string,
  clock = () => new Date(),
) {
  const capture = validateCaptureTime(raw, clock());
  const stream = await readObject(
    `publish-inputs/${capture.id}.json`,
    capture.byteSize,
  );
  if (!stream) throw new Error('Captured input unavailable');
  const body = await boundedBytes(new Response(stream), capture.byteSize);
  const input = verifyPublishInput(body, capture.inputSha256);
  if (
    body.byteLength !== capture.byteSize ||
    input.snapshot.revision !== capture.revision ||
    input.snapshot.generatedAt !== capture.createdAt ||
    (await sha256(JSON.stringify(input.snapshot))) !== capture.snapshotSha256
  )
    throw new Error('Capture metadata mismatch');
  const result = await materializePublishInput(
    body,
    capture.inputSha256,
    (key) => readObject(key, 8 * 1024 * 1024),
    destination,
  );
  validateCaptureTime(capture, clock());
  // Separate marker binds the trusted dispatch metadata to the fully fetched
  // input. A failed fetch cannot leave a buildable capture.
  await writeFile(
    resolve(destination, 'capture.json'),
    JSON.stringify(capture),
    { flag: 'wx', mode: 0o600 },
  );
  return result;
}
export async function readCapturedInput(directory: string, now = new Date()) {
  const capture = validateCaptureTime(
    JSON.parse(await readFile(resolve(directory, 'capture.json'), 'utf8')),
    now,
  );
  const digest = z.string().regex(/^[a-f0-9]{64}$/u);
  const prepared = z
    .object({
      schemaVersion: z.literal(1),
      inputSha256: digest,
      snapshotSha256: digest,
      revision: z.number().int().nonnegative(),
      media: z.array(
        z
          .object({
            id: z.number().int().positive(),
            sha256: digest,
            byteSize: z
              .number()
              .int()
              .positive()
              .max(8 * 1024 * 1024),
          })
          .strict(),
      ),
    })
    .strict()
    .parse(
      JSON.parse(await readFile(resolve(directory, 'prepared.json'), 'utf8')),
    );
  const snapshot = await readFile(resolve(directory, 'snapshot.json'), 'utf8');
  if (
    prepared.inputSha256 !== capture.inputSha256 ||
    prepared.snapshotSha256 !== capture.snapshotSha256 ||
    prepared.revision !== capture.revision ||
    (await sha256(snapshot)) !== capture.snapshotSha256
  )
    throw new Error('Prepared capture does not match its dispatch');
  const content = publicSnapshotSchema.parse(JSON.parse(snapshot));
  if (
    content.revision !== capture.revision ||
    content.generatedAt !== capture.createdAt ||
    prepared.media.length !== content.media.length ||
    new Set(prepared.media.map((item) => item.id)).size !==
      prepared.media.length
  )
    throw new Error('Prepared media manifest mismatch');
  for (const item of prepared.media) {
    const expected = content.media.find((media) => media.id === item.id);
    const bytes = await readFile(resolve(directory, 'media', `${item.id}.bin`));
    const actual = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Buffer.from(actual).toString('hex');
    if (
      !expected ||
      expected.byteSize !== item.byteSize ||
      bytes.byteLength !== item.byteSize ||
      hash !== item.sha256
    )
      throw new Error('Prepared original changed after retrieval');
  }
  return capture;
}
