import { publicationEnvSchema } from '@platform/config';
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

export function publicationProvider(
  raw: unknown,
  github: GitHubFetch = fetch,
  cloudflare: PreviewFetch = fetch,
) {
  const parsed = publicationEnvSchema.safeParse(raw);
  if (!parsed.success)
    throw new BuildServiceError(
      'Public publishing is not configured for this environment.',
    );
  const config = parsed.data;
  const identity = {
    DEPLOYMENT_ENVIRONMENT:
      config.APP_ENV === 'production' ? 'production' : 'preview',
    CLOUDFLARE_ACCOUNT_ID: config.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_API_TOKEN: config.PUBLISH_CLOUDFLARE_API_TOKEN,
  };
  const reader = previewCloudflareReader(identity, cloudflare, 'publish');
  return {
    ...reader,
    current: async () => {
      const { versionId, release } = await reader.current();
      return { versionId, release };
    },
    activate: (id: string) =>
      activatePreviewVersion(identity, id, cloudflare, 'publish'),
    buildSucceeded: async (id: string, runId: number) => {
      const run = await readGitHubBuild(
        config.PUBLISH_GITHUB_TOKEN,
        id,
        runId,
        github,
      );
      return run.status === 'completed' && run.conclusion === 'success';
    },
  };
}
