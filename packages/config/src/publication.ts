import { z } from 'zod';

const suffix = 'mohamed-charaf-eddine-deghboudj.workers.dev';
export const publicationTargets = {
  preview: {
    workerName: 'mohamedeghboudj-site-spike',
    origin: `https://mohamedeghboudj-site-spike.${suffix}`,
  },
  production: {
    workerName: 'mohamedeghboudj-site',
    origin: `https://mohamedeghboudj-site.${suffix}`,
  },
} as const;
export const publicationPolicy = {
  cron: '* * * * *',
  bootstrap: 'publication-bootstrap-v1',
} as const;
const token = z
  .string()
  .min(20)
  .max(512)
  .regex(/^[^\r\n]+$/u);
export const publicationInspectionEnvSchema = z.object({
  DEPLOYMENT_ENVIRONMENT: z.enum(['preview', 'production']),
  CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/u),
  CLOUDFLARE_API_TOKEN: token,
});
export const publicationUploadEnvSchema = publicationInspectionEnvSchema.extend(
  { PUBLISH_UPLOAD_ENABLED: z.literal('true') },
);
export const publicationEnvSchema = z.object({
  APP_ENV: z.enum(['local', 'preview', 'production']),
  PUBLISH_DEPLOYMENTS_ENABLED: z.literal('true'),
  PUBLISH_BUILDS_ENABLED: z.literal('true'),
  CLOUDFLARE_ACCOUNT_ID:
    publicationInspectionEnvSchema.shape.CLOUDFLARE_ACCOUNT_ID,
  PUBLISH_CLOUDFLARE_API_TOKEN: token,
  PUBLISH_GITHUB_TOKEN: z
    .string()
    .min(16)
    .max(512)
    .regex(/^[^\r\n]+$/u),
});
