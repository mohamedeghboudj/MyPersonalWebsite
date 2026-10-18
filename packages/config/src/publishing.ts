import { z } from 'zod';

export const publishCapturePolicy = {
  maxInputBytes: 2 * 1024 * 1024,
  retentionMs: 24 * 60 * 60 * 1000,
  interruptedAfterMs: 5 * 60 * 1000,
  cleanupBatchSize: 5,
  cleanupCron: '17 * * * *',
  reconcilePageSize: 20,
} as const;

export const publishing = {
  repository: 'mohamedeghboudj/MyPersonalWebsite',
  ref: 'main',
  workflow: 'build-capture.yml',
  apiVersion: '2026-03-10',
  requestTimeoutMs: 10000,
  reconcileAfterMs: 30000,
  maxGitHubResponseBytes: 1024 * 1024,
} as const;
const secret = z
  .string()
  .min(16)
  .max(512)
  .regex(/^[^\r\n]+$/u);
export const publishingEnvSchema = z.object({
  APP_ENV: z.enum(['local', 'preview', 'production']),
  PUBLISH_BUILDS_ENABLED: z.literal('true'),
  PUBLISH_GITHUB_TOKEN: secret,
});
export const publishMaintenanceEnvSchema = z.object({
  APP_ENV: z.enum(['local', 'preview', 'production']),
  PUBLISH_MAINTENANCE_ENABLED: z.literal('true'),
});
export const publishStorageEnvSchema = z.object({
  PUBLISH_R2_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/u),
  PUBLISH_R2_BUCKET: z.enum([
    'mohamedeghboudj-media-preview',
    'mohamedeghboudj-media-production',
  ]),
  PUBLISH_R2_ACCESS_KEY_ID: secret,
  PUBLISH_R2_SECRET_ACCESS_KEY: secret,
});
export const diagnosticsStorageEnvSchema = z.object({
  PUBLISH_DIAGNOSTICS_ENABLED: z.literal('true'),
  PUBLISH_R2_ACCOUNT_ID: publishStorageEnvSchema.shape.PUBLISH_R2_ACCOUNT_ID,
  PUBLISH_R2_BUCKET: publishStorageEnvSchema.shape.PUBLISH_R2_BUCKET,
  DIAGNOSTICS_R2_ACCESS_KEY_ID: secret,
  DIAGNOSTICS_R2_SECRET_ACCESS_KEY: secret,
});
