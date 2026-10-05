import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { parsePublishCapture } from './publish-validation.ts';

// Read dispatch data as JSON, never interpolate workflow inputs into a shell.
const event = z
  .object({ inputs: z.object({ capture: z.string().max(60000) }) })
  .parse(
    JSON.parse(
      await readFile(
        z.string().min(1).parse(process.env.GITHUB_EVENT_PATH),
        'utf8',
      ),
    ),
  );
const capture = await parsePublishCapture(JSON.parse(event.inputs.capture));
const serialized = JSON.stringify(capture.snapshot);
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/snapshot.json', serialized);
await writeFile('artifacts/publish-capture.json', JSON.stringify(capture));
console.log(
  `Validated public snapshot revision ${capture.snapshot.revision}; content is not logged.`,
);
