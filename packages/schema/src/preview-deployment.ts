import { z } from 'zod';
import { previewReleaseSchema } from './preview-release.ts';

export const previewDeploymentStates = [
  'activating',
  'uncertain',
  'deployed',
  'rejected',
] as const;
export const previewCandidateSchema = z
  .object({ versionId: z.uuid(), release: previewReleaseSchema })
  .strict();
export type PreviewCandidate = z.infer<typeof previewCandidateSchema>;
export const previewActivationRequestSchema = z
  .object({ versionId: z.uuid() })
  .strict();
export const previewCurrentVersionSchema = z
  .object({ versionId: z.uuid(), release: previewReleaseSchema.nullable() })
  .strict();
export type PreviewCurrentVersion = z.infer<typeof previewCurrentVersionSchema>;
export const previewActivationSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('deployed'),
      deploymentId: z.uuid(),
      versionId: z.uuid(),
      percentage: z.literal(100),
      createdAt: z.iso.datetime(),
    })
    .strict(),
  z.object({ status: z.literal('rejected') }).strict(),
  z.object({ status: z.literal('uncertain') }).strict(),
]);
export type PreviewActivation = z.infer<typeof previewActivationSchema>;
export const previewDeploymentSchema = z
  .object({
    captureId: z.uuid(),
    versionId: z.uuid(),
    previousVersionId: z.uuid(),
    runId: z.number().int().positive(),
    bundleSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    status: z.enum(previewDeploymentStates),
    deploymentId: z.uuid().nullable(),
    requestedAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .refine((row) => (row.status === 'deployed') === (row.deploymentId !== null));
export type PreviewDeployment = z.infer<typeof previewDeploymentSchema>;
