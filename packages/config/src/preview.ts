import { z } from 'zod';
import { accessIdentityEnvSchema } from './access.ts';

export const previewPolicy = {
  workerName: 'mohamedeghboudj-site-preview',
  origin:
    'https://mohamedeghboudj-site-preview.mohamed-charaf-eddine-deghboudj.workers.dev',
  bootstrap: 'bootstrap-v1',
  maxFiles: 2000,
  maxFileBytes: 25 * 1024 * 1024,
  maxTotalBytes: 100 * 1024 * 1024,
  maxApiBytes: 1024 * 1024,
} as const;
export const previewEnvSchema = accessIdentityEnvSchema.extend({
  APP_ENV: z.enum(['local', 'preview']),
  PREVIEW_RELEASE: z.string().min(1).max(2048),
});
export const previewInspectionEnvSchema = accessIdentityEnvSchema.extend({
  CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/u),
  CLOUDFLARE_API_TOKEN: z
    .string()
    .min(20)
    .max(512)
    .regex(/^[^\r\n]+$/u),
});
