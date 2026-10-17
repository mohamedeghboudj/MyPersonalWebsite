import { z } from 'zod';
import {
  boundedBytes,
  previewInspectionEnvSchema,
  previewPolicy,
} from '@platform/config';
import {
  previewReleaseSchema,
  type PreviewRelease,
  type PreviewActivation,
} from '@platform/schema';

const deploymentSchema = z.object({
  success: z.literal(true),
  result: z.object({
    deployments: z
      .array(
        z.object({
          id: z.uuid(),
          created_on: z.iso.datetime().optional(),
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
export type PreviewFetch = (request: Request) => Promise<Response>;

// Reading a current version is necessary but does not lock deployment order.
// The mutation transport below belongs exclusively behind the durable coordinator.
export function previewCloudflareReader(
  raw: unknown,
  send: PreviewFetch = (request) => fetch(request),
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
  async function version(versionId: string) {
    versionId = z.uuid().parse(versionId);
    const data = versionSchema.parse(
      await get(`/versions/${versionId}`),
    ).result;
    if (data.id !== versionId) throw new Error('Version identity mismatch');
    function value(name: string) {
      const matches = data.resources.bindings.filter(
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
    return receipt === previewPolicy.bootstrap
      ? null
      : previewReleaseSchema.parse(JSON.parse(receipt));
  }
  const current = async (): Promise<ActivePreview> => {
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
      const release = await version(versionId);
      return { deploymentId: current.id, versionId, release };
    } catch {
      throw new Error('Could not verify the active private preview');
    }
  };
  return {
    current,
    candidate: async (versionId: string) => {
      try {
        const release = await version(versionId);
        if (!release) throw new Error('Bootstrap is not a candidate');
        return { versionId, release };
      } catch {
        throw new Error('Could not verify the uploaded preview');
      }
    },
    findActivation: async (
      versionId: string,
    ): Promise<Extract<PreviewActivation, { status: 'deployed' }> | null> => {
      try {
        versionId = z.uuid().parse(versionId);
        const deployments = deploymentSchema.parse(await get('/deployments'))
          .result.deployments;
        const matches = deployments.filter(
          (item) =>
            item.versions.length === 1 &&
            item.versions[0]!.version_id === versionId &&
            item.versions[0]!.percentage === 100,
        );
        if (matches.length !== 1 || !matches[0]!.created_on) return null;
        return {
          status: 'deployed',
          versionId,
          deploymentId: matches[0]!.id,
          percentage: 100,
          createdAt: matches[0]!.created_on,
        };
      } catch {
        throw new Error('Could not reconcile the preview deployment');
      }
    },
  };
}

export function previewDeploymentReader(
  raw: unknown,
  send: PreviewFetch = (request) => fetch(request),
) {
  return previewCloudflareReader(raw, send).current;
}

// This transport is called only by the owner-gated coordinator's insert winner.
// Never retry it. Even a timeout or malformed successful response may have applied.
export async function activatePreviewVersion(
  raw: unknown,
  versionId: string,
  send: PreviewFetch = (request) => fetch(request),
): Promise<PreviewActivation> {
  const config = previewInspectionEnvSchema.parse(raw);
  versionId = z.uuid().parse(versionId);
  try {
    const response = await send(
      new Request(
        `https://api.cloudflare.com/client/v4/accounts/${config.CLOUDFLARE_ACCOUNT_ID}/workers/scripts/${previewPolicy.workerName}/deployments`,
        {
          method: 'POST',
          redirect: 'manual',
          signal: AbortSignal.timeout(15000),
          headers: {
            Authorization: `Bearer ${config.CLOUDFLARE_API_TOKEN}`,
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            strategy: 'percentage',
            versions: [{ version_id: versionId, percentage: 100 }],
          }),
        },
      ),
    );
    if (
      response.headers.get('content-type')?.split(';')[0]?.trim() !==
      'application/json'
    ) {
      await response.body?.cancel();
      return { status: 'uncertain' };
    }
    const json: unknown = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(
        await boundedBytes(response, previewPolicy.maxApiBytes),
      ),
    );
    if (response.status === 200) {
      const data = z
        .object({
          success: z.literal(true),
          result: z.object({
            id: z.uuid(),
            created_on: z.iso.datetime(),
            strategy: z.literal('percentage'),
            versions: z
              .array(
                z.object({ version_id: z.uuid(), percentage: z.literal(100) }),
              )
              .length(1),
          }),
        })
        .parse(json).result;
      if (data.versions[0]!.version_id !== versionId)
        return { status: 'uncertain' };
      return {
        status: 'deployed',
        deploymentId: data.id,
        versionId,
        percentage: 100,
        createdAt: data.created_on,
      };
    }
    const denied = z
      .object({
        success: z.literal(false),
        errors: z.array(z.object({ code: z.number().int() })).min(1),
      })
      .safeParse(json);
    return {
      status:
        [400, 401, 403, 404, 422, 429].includes(response.status) &&
        denied.success
          ? 'rejected'
          : 'uncertain',
    };
  } catch {
    return { status: 'uncertain' };
  }
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
