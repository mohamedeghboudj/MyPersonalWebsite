import { z } from 'zod';
import { boundedBytes, publishing } from '@platform/config';
import type { CapturedBuild } from '@platform/schema';

export type GitHubFetch = (request: Request) => Promise<Response>;
const repositoryApi = `https://api.github.com/repos/${publishing.repository}`;
export const buildRunUrl = (id: number) =>
  `https://github.com/${publishing.repository}/actions/runs/${id}`;
export class BuildServiceError extends Error {}

async function responseJson(response: Response) {
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(
      await boundedBytes(response, publishing.maxGitHubResponseBytes),
    ),
  ) as unknown;
}
function request(token: string, path: string, body?: unknown) {
  return new Request(repositoryApi + path, {
    method: body === undefined ? 'GET' : 'POST',
    redirect: 'manual',
    signal: AbortSignal.timeout(publishing.requestTimeoutMs),
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': publishing.apiVersion,
      'User-Agent': 'mohamedeghboudj-publisher',
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
export async function sendBuildDispatch(
  token: string,
  capture: CapturedBuild,
  fetcher: GitHubFetch,
) {
  // No transport retry: a lost response may already have started a workflow.
  try {
    const response = await fetcher(
      request(token, `/actions/workflows/${publishing.workflow}/dispatches`, {
        ref: publishing.ref,
        inputs: { capture_id: capture.id, capture: JSON.stringify(capture) },
      }),
    );
    if (response.status === 200) {
      const result = z
        .object({ workflow_run_id: z.number().int().positive() })
        .parse(await responseJson(response));
      return { status: 'queued' as const, runId: result.workflow_run_id };
    }
    await response.body?.cancel();
    return {
      status: [400, 401, 403, 404, 422, 429].includes(response.status)
        ? ('rejected' as const)
        : ('uncertain' as const),
      runId: null,
    };
  } catch {
    return { status: 'uncertain' as const, runId: null };
  }
}
const runSchema = z.object({
  id: z.number().int().positive(),
  display_title: z.string(),
  head_branch: z.string(),
  path: z.string(),
  event: z.string(),
  run_attempt: z
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER)
    .optional(),
  status: z.enum([
    'queued',
    'in_progress',
    'completed',
    'waiting',
    'pending',
    'requested',
  ]),
  conclusion: z
    .enum([
      'success',
      'failure',
      'cancelled',
      'timed_out',
      'action_required',
      'neutral',
      'skipped',
      'stale',
      'startup_failure',
    ])
    .nullable(),
});
const belongsToCapture = (run: z.infer<typeof runSchema>, id: string) =>
  run.display_title === `Capture ${id}` &&
  run.head_branch === publishing.ref &&
  [
    `.github/workflows/${publishing.workflow}`,
    `.github/workflows/${publishing.workflow}@${publishing.ref}`,
  ].includes(run.path) &&
  run.event === 'workflow_dispatch';

export async function findDispatchedBuild(
  token: string,
  id: string,
  fetcher: GitHubFetch,
) {
  try {
    const response = await fetcher(
      request(
        token,
        `/actions/workflows/${publishing.workflow}/runs?event=workflow_dispatch&branch=${publishing.ref}&per_page=100`,
      ),
    );
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error('Lookup unavailable');
    }
    const data = z
      .object({ workflow_runs: z.array(z.unknown()).max(100) })
      .parse(await responseJson(response));
    const matches = data.workflow_runs
      .map((raw) => runSchema.safeParse(raw))
      .filter((result) => result.success && belongsToCapture(result.data, id));
    // Missing or ambiguous matches stay uncertain. Never guess or resend.
    return matches.length === 1 && matches[0]!.success
      ? matches[0]!.data.id
      : null;
  } catch {
    throw new BuildServiceError(
      'GitHub build lookup is unavailable. Retry this same request later.',
    );
  }
}
export async function readGitHubBuild(
  token: string,
  id: string,
  runId: number,
  fetcher: GitHubFetch,
) {
  try {
    const response = await fetcher(request(token, `/actions/runs/${runId}`));
    if (response.status !== 200) {
      await response.body?.cancel();
      throw new Error('Run unavailable');
    }
    const run = runSchema.parse(await responseJson(response));
    if (run.id !== runId || !belongsToCapture(run, id))
      throw new Error('Run mismatch');
    return {
      status: run.status,
      conclusion: run.conclusion,
      url: buildRunUrl(runId),
      attempt: run.run_attempt ?? null,
    };
  } catch {
    throw new BuildServiceError(
      'GitHub build status is unavailable. Try again shortly.',
    );
  }
}
