import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { snapshotSchema } from '@platform/schema';

const capture = z
  .object({ snapshot: snapshotSchema, capturedAt: z.iso.datetime() })
  .parse(JSON.parse(await readFile('artifacts/publish-capture.json', 'utf8')));
process.env.EXPECTED_REVISION = String(capture.snapshot.revision);
process.env.PUBLISH_STARTED_AT = capture.capturedAt;
await import('./measure-live.ts');
const report = z
  .object({
    evidence: z.array(z.object({ locale: z.string(), elapsedMs: z.number() })),
  })
  .parse(JSON.parse(await readFile('artifacts/live-observation.json', 'utf8')));
for (const row of report.evidence)
  console.log(
    `${row.locale}: capture-to-live observed in ${(row.elapsedMs / 1000).toFixed(1)} seconds (includes manual dispatch handoff)`,
  );
