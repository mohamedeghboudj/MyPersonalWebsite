import { z } from 'zod';
import { snapshotSchema } from '@platform/schema';
import { sha256 } from '@platform/config';

export async function parsePublishCapture(raw: unknown, now = Date.now()) {
  const capture = z
    .object({
      snapshot: snapshotSchema,
      hash: z.string().regex(/^[a-f0-9]{64}$/u),
      capturedAt: z.iso.datetime(),
    })
    .strict()
    .parse(raw);
  if ((await sha256(JSON.stringify(capture.snapshot))) !== capture.hash)
    throw new Error('Captured snapshot hash does not match');
  const age = now - Date.parse(capture.capturedAt);
  if (age < 0 || age > 30 * 60 * 1000)
    throw new Error(
      'Capture must come from a publish click within the last 30 minutes',
    );
  return capture;
}
export function assertNewerRevision(
  status: number,
  html: string,
  incoming: number,
) {
  if (status === 404) return;
  if (status !== 200)
    throw new Error(`Unexpected live response before deployment: ${status}`);
  const match = /data-revision="([0-9]+)"/u.exec(html)?.[1];
  const revision = Number(match);
  if (match === undefined || !Number.isSafeInteger(revision))
    throw new Error('Live response is not the expected static spike');
  if (revision >= incoming)
    throw new Error('Refusing to overwrite an equal or newer live revision');
}
