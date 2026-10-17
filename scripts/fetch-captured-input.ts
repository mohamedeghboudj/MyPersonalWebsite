import { readFile, stat } from 'node:fs/promises';
import { publishing } from '@platform/config';
import { z } from 'zod';
import { capturedBuildSchema } from '@platform/schema';
import { privateR2Reader } from './private-r2.ts';
import { fetchCapturedInput } from './captured-input.ts';

try {
  if (
    process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    process.env.GITHUB_REF !== `refs/heads/${publishing.ref}` ||
    process.env.GITHUB_REPOSITORY !== publishing.repository ||
    process.env.GITHUB_ACTOR !== publishing.repository.split('/')[0]
  )
    throw new Error('Untrusted workflow context');
  const path = process.env.GITHUB_EVENT_PATH;
  if (!path || (await stat(path)).size > 256 * 1024)
    throw new Error('Invalid event');
  const event = z
    .object({
      inputs: z.object({ capture_id: z.uuid(), capture: z.string().max(4096) }),
    })
    .parse(JSON.parse(await readFile(path, 'utf8')));
  const capture = capturedBuildSchema.parse(JSON.parse(event.inputs.capture));
  if (capture.id !== event.inputs.capture_id)
    throw new Error('Capture ID mismatch');
  await fetchCapturedInput(
    capture,
    privateR2Reader(process.env),
    'artifacts/captured-input',
  );
  console.log('Private capture and eligible originals verified.');
} catch {
  // The repository and Actions log are public. Never print response bodies,
  // object keys, credentials, unpublished input, or data-bearing exceptions.
  console.error(
    'Private input retrieval failed. Check capture expiry and the configured read-only storage credential.',
  );
  process.exitCode = 1;
}
