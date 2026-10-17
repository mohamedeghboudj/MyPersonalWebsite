import { previewActivationEnvSchema } from '@platform/config';
import {
  previewCloudflareReader,
  activatePreviewVersion,
  type PreviewFetch,
} from './preview-cloudflare.ts';
import {
  readGitHubBuild,
  BuildServiceError,
  type GitHubFetch,
} from './github-builds.ts';
import type { PreviewDeploymentProvider } from './preview-coordinator.ts';

export function previewDeploymentProvider(
  raw: unknown,
  githubFetch: GitHubFetch = fetch,
  cloudflareFetch: PreviewFetch = fetch,
): PreviewDeploymentProvider {
  const parsed = previewActivationEnvSchema.safeParse(raw);
  if (!parsed.success)
    throw new BuildServiceError(
      'Private preview activation is not configured for this environment.',
    );
  const config = parsed.data;
  const identity = {
    ACCESS_ISSUER: config.ACCESS_ISSUER,
    ACCESS_AUDIENCE: config.PREVIEW_ACCESS_AUDIENCE,
    OWNER_EMAIL: config.OWNER_EMAIL,
    CLOUDFLARE_ACCOUNT_ID: config.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: config.PREVIEW_CLOUDFLARE_API_TOKEN,
  };
  const reader = previewCloudflareReader(identity, cloudflareFetch);
  return {
    buildSucceeded: async (id, runId) => {
      const run = await readGitHubBuild(
        config.PUBLISH_GITHUB_TOKEN,
        id,
        runId,
        githubFetch,
      );
      return run.status === 'completed' && run.conclusion === 'success';
    },
    candidate: reader.candidate,
    current: async () => {
      const value = await reader.current();
      return { versionId: value.versionId, release: value.release };
    },
    activate: (versionId) =>
      activatePreviewVersion(identity, versionId, cloudflareFetch),
    findActivation: reader.findActivation,
  };
}
