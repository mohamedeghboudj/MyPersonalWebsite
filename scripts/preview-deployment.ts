import { z } from 'zod';
import {
  boundedBytes,
  previewInspectionEnvSchema,
  previewPolicy,
} from '@platform/config';
import { previewReleaseSchema, type PreviewRelease } from '@platform/schema';

const deploymentSchema = z.object({
  success: z.literal(true),
  result: z.object({
    deployments: z
      .array(
        z.object({
          id: z.uuid(),
          versions: z
            .array(z.object({ version_id: z.uuid(), percentage: z.number() }))
            .min(1),
        }),
      )
      .min(1),
  }),
});
const versionSchema = z.object({
  success: z.literal(true),
  result: z.object({
    id: z.uuid(),
    resources: z.object({
      bindings: z
        .array(
          z.object({
            type: z.string(),
            name: z.string(),
            text: z.string().optional(),
          }),
        )
        .max(100),
    }),
  }),
});
export type ActivePreview = {
  deploymentId: string;
  versionId: string;
  release: PreviewRelease | null;
};
type Requester = (request: Request) => Promise<Response>;

// This module deliberately has no mutation transport. Observing a current
// version is necessary but is not a lock across an ambiguous deployment.
export function previewDeploymentReader(
  raw: unknown,
  send: Requester = (request) => fetch(request),
) {
  const config = previewInspectionEnvSchema.parse(raw);
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${previewPolicy.workerName}`;
  async function get(path: string) {
    const response = await send(
      new Request(base + path, {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        headers: {
          Authorization: `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
          Accept: 'application/json',
        },
      }),
    );
    if (
      !response.ok ||
      response.headers.get('content-type')?.split(';')[0]?.trim() !==
        'application/json'
    ) {
      await response.body?.cancel();
      throw new Error('Preview inspection unavailable');
    }
    return JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await boundedBytes(response, previewPolicy.maxApiBytes),
      ),
    ) as unknown;
  }
  return async (): Promise<ActivePreview> => {
    try {
      // Cloudflare documents the first entry as the actively serving deployment.
      // An uploaded, undeployed version must never determine ordering.
      const current = deploymentSchema.parse(await get('/deployments')).result
        .deployments[0]!;
      if (
        current.versions.length !== 1 ||
        current.versions[0]!.percentage !== 100
      )
        throw new Error('Mixed deployments are unsupported');
      const versionId = current.versions[0]!.version_id;
      const version = versionSchema.parse(
        await get(`/versions/${versionId}`),
      ).result;
      if (version.id !== versionId)
        throw new Error('Version identity mismatch');
      function value(name: string) {
        const matches = version.resources.bindings.filter(
          (binding) => binding.name === name,
        );
        if (
          matches.length !== 1 ||
          matches[0]!.type !== 'plain_text' ||
          !matches[0]!.text
        )
          throw new Error('Missing or ambiguous preview identity');
        return matches[0]!.text;
      }
      for (const [name, expected] of Object.entries({
        APP_ENV: 'preview',
        ACCESS_ISSUER: config.ACCESS_ISSUER,
        ACCESS_AUDIENCE: config.ACCESS_AUDIENCE,
        OWNER_EMAIL: config.OWNER_EMAIL,
      }))
        if (value(name) !== expected)
          throw new Error('Preview identity mismatch');
      const receipt = value('PREVIEW_RELEASE');
      const release =
        receipt === previewPolicy.bootstrap
          ? null
          : previewReleaseSchema.parse(JSON.parse(receipt));
      return { deploymentId: current.id, versionId, release };
    } catch {
      throw new Error('Could not verify the active private preview');
    }
  };
}

export function comparePreviewRelease(
  candidate: PreviewRelease,
  current: PreviewRelease | null,
) {
  candidate = previewReleaseSchema.parse(candidate);
  if (!current) return 'newer' as const;
  current = previewReleaseSchema.parse(current);
  if (candidate.sequence < current.sequence) return 'superseded' as const;
  if (candidate.sequence === current.sequence) {
    if (JSON.stringify(candidate) !== JSON.stringify(current))
      throw new Error('Conflicting preview capture');
    return 'already-active' as const;
  }
  if (candidate.revision < current.revision)
    throw new Error('Preview revision would regress');
  return 'newer' as const;
}
