import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { publicationTargets } from '@platform/config';
import { observePublication } from './publication-observation.ts';

const input = z
  .object({
    captureId: z.uuid(),
    environment: z.enum(['preview', 'production']),
    savedAt: z.iso.datetime(),
    capturedAt: z.iso.datetime(),
  })
  .strict()
  .parse(
    JSON.parse(
      await readFile('artifacts/publication-observation-request.json', 'utf8'),
    ),
  );
const started = Date.parse(input.capturedAt);
if (
  Date.parse(input.savedAt) > started ||
  started > Date.now() ||
  Date.now() - started > 30 * 60000
)
  throw new Error('Use fresh capture and transactional save timestamps');
const origin = publicationTargets[input.environment].origin;
let observed: Awaited<ReturnType<typeof observePublication>> = null;
while (Date.now() < started + 30 * 60000) {
  observed = await observePublication(origin, input.captureId);
  if (observed) break;
  await new Promise((done) => setTimeout(done, 2000));
}
if (!observed || observed.receipt.capturedAt !== input.capturedAt)
  throw new Error('Exact publication was not observed');
const evidence = observed.evidence.map((row) => ({
  ...row,
  saveToLiveMs: Date.parse(row.observedAt) - Date.parse(input.savedAt),
  captureToLiveMs: Date.parse(row.observedAt) - started,
}));
await writeFile(
  'artifacts/publication-live-evidence.json',
  JSON.stringify(
    {
      origin,
      ...input,
      ...observed,
      evidence,
      note: 'Observed upper bounds including any delay before this observer started; pages and exact PDF hashes verified in all three languages.',
    },
    null,
    2,
  ),
);
console.log(JSON.stringify({ captureId: input.captureId, evidence }, null, 2));
