import { readFile, lstat } from 'node:fs/promises';
import { z } from 'zod';
import { publishing } from '@platform/config';
import { capturedBuildSchema, buildAttemptSchema } from '@platform/schema';

export async function capturedWorkflow(env: NodeJS.ProcessEnv = process.env) {
  const owner = publishing.repository.split('/')[0];
  if (
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    env.GITHUB_REF !== `refs/heads/${publishing.ref}` ||
    env.GITHUB_REPOSITORY !== publishing.repository ||
    env.GITHUB_ACTOR !== owner ||
    (env.GITHUB_TRIGGERING_ACTOR && env.GITHUB_TRIGGERING_ACTOR !== owner) ||
    env.GITHUB_WORKFLOW_REF !==
      `${publishing.repository}/.github/workflows/${publishing.workflow}@refs/heads/${publishing.ref}`
  )
    throw new Error('Untrusted workflow context');
  const path = env.GITHUB_EVENT_PATH;
  if (!path) throw new Error('Missing workflow event');
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 256 * 1024)
    throw new Error('Invalid workflow event');
  const event = z
    .object({
      inputs: z.object({ capture_id: z.uuid(), capture: z.string().max(4096) }),
    })
    .parse(JSON.parse(await readFile(path, 'utf8')));
  const capture = capturedBuildSchema.parse(JSON.parse(event.inputs.capture));
  if (capture.id !== event.inputs.capture_id)
    throw new Error('Capture ID mismatch');
  const run = buildAttemptSchema.parse({
    runId: Number(env.GITHUB_RUN_ID),
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
  });
  return { capture, run };
}
