import { mkdir, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { publishInputSchema, type PublishInput } from '@platform/schema';
import { boundedBytes, publishCapturePolicy } from '@platform/config';

export const maxPublishInputBytes = publishCapturePolicy.maxInputBytes;
const digest = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');

export function sealPublishInput(raw: unknown) {
  const input = publishInputSchema.parse(raw);
  const body = Buffer.from(JSON.stringify(input), 'utf8');
  if (body.length > maxPublishInputBytes)
    throw new Error('Publish input exceeds its size limit');
  return { body, sha256: digest(body) };
}

export function verifyPublishInput(
  body: Uint8Array,
  expectedSha256: string,
): PublishInput {
  if (
    body.length > maxPublishInputBytes ||
    !/^[a-f0-9]{64}$/u.test(expectedSha256) ||
    digest(body) !== expectedSha256
  )
    throw new Error('Publish input integrity check failed');
  return publishInputSchema.parse(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)),
  );
}

// A build-only boundary: its caller supplies a private R2 reader, never a public
// URL or owner Access token. The callback cannot choose filesystem output paths.
// The destination must not exist, preventing reuse of another capture's files.
export async function materializePublishInput(
  body: Uint8Array,
  expectedSha256: string,
  readOriginal: (key: string) => Promise<ReadableStream<Uint8Array> | null>,
  destination: string,
) {
  const input = verifyPublishInput(body, expectedSha256);
  const root = resolve(destination);
  // A fresh Actions checkout has no ignored artifacts directory. Create only
  // the parents recursively; the capture directory must still be new.
  await mkdir(dirname(root), { recursive: true, mode: 0o700 });
  await mkdir(root, { mode: 0o700 });
  const sourceDirectory = resolve(root, 'media');
  await mkdir(sourceDirectory);
  const sources = new Map(
    input.mediaSources.map((item) => [item.id, item.r2Key]),
  );
  const prepared: { id: number; sha256: string; byteSize: number }[] = [];
  for (const item of input.snapshot.media) {
    const stream = await readOriginal(sources.get(item.id)!);
    if (!stream) throw new Error(`Publish media unavailable: ${item.id}`);
    const bytes = await boundedBytes(new Response(stream), item.byteSize);
    if (bytes.length !== item.byteSize)
      throw new Error(`Publish media size mismatch: ${item.id}`);
    await writeFile(resolve(sourceDirectory, `${item.id}.bin`), bytes, {
      flag: 'wx',
    });
    prepared.push({
      id: item.id,
      sha256: digest(bytes),
      byteSize: bytes.length,
    });
  }
  const snapshot = Buffer.from(JSON.stringify(input.snapshot), 'utf8');
  await writeFile(resolve(root, 'snapshot.json'), snapshot, { flag: 'wx' });
  // This marker is written last. A failed or partial fetch cannot be mistaken
  // for a complete input; a retry needs a new empty destination.
  const ready = {
    schemaVersion: 1,
    inputSha256: expectedSha256,
    snapshotSha256: digest(snapshot),
    revision: input.snapshot.revision,
    media: prepared,
  };
  await writeFile(resolve(root, 'prepared.tmp'), JSON.stringify(ready), {
    flag: 'wx',
  });
  await rename(resolve(root, 'prepared.tmp'), resolve(root, 'prepared.json'));
  return {
    snapshotPath: resolve(root, 'snapshot.json'),
    mediaSourceDirectory: sourceDirectory,
    ...ready,
  };
}
