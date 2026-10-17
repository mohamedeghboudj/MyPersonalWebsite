import { mkdir, readFile, lstat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { previewPolicy, previewUploadEnvSchema } from '@platform/config';
import { previewCandidateSchema } from '@platform/schema';
import { verifyPreviewBundle } from './preview-bundle.ts';
import { privateBuildEnvironment, privateNodeStage } from './private-build.ts';
import {
  previewCloudflareReader,
  comparePreviewRelease,
  type PreviewFetch,
} from '../apps/admin/src/preview-cloudflare.ts';

// The pinned Wrangler emits JSON lines here. Never parse its human-facing log
// or forward that log to Actions: it includes binding values and asset paths.
const uploadedSchema = z.object({
  type: z.literal('version-upload'),
  version: z.literal(1),
  worker_name: z.literal(previewPolicy.workerName),
  version_id: z.uuid(),
  preview_url: z.undefined().optional(),
  preview_alias_url: z.undefined().optional(),
});
export async function uploadPrivatePreview(
  bundleDirectory: string,
  source: NodeJS.ProcessEnv,
  send: PreviewFetch = fetch,
  run: typeof privateNodeStage = privateNodeStage,
) {
  const config = previewUploadEnvSchema.parse(source);
  const bundle = await verifyPreviewBundle(bundleDirectory);
  const reader = previewCloudflareReader(config, send);
  // Require an existing, identity-matched bootstrap/deployment. This script
  // cannot create a Worker, attach Access, change a route or activate a version.
  const current = await reader.current();
  if (comparePreviewRelease(bundle.release, current.release) !== 'newer')
    throw new Error('The captured preview is no longer newer');
  const uploadDirectory = resolve(bundleDirectory, 'upload');
  await mkdir(uploadDirectory, { mode: 0o700 });
  const configPath = resolve(uploadDirectory, 'wrangler.json');
  const outputPath = resolve(uploadDirectory, 'result.jsonl');
  const emptyEnvPath = resolve(uploadDirectory, 'empty.env');
  await writeFile(emptyEnvPath, '', { flag: 'wx', mode: 0o600 });
  await writeFile(
    configPath,
    JSON.stringify({
      name: previewPolicy.workerName,
      account_id: config.CLOUDFLARE_ACCOUNT_ID,
      main: resolve('apps/preview/src/index.ts'),
      compatibility_date: '2026-10-01',
      workers_dev: false,
      preview_urls: false,
      assets: {
        directory: resolve(bundleDirectory, 'site'),
        binding: 'ASSETS',
        run_worker_first: true,
        not_found_handling: '404-page',
      },
      vars: {
        APP_ENV: 'preview',
        ACCESS_ISSUER: config.ACCESS_ISSUER,
        ACCESS_AUDIENCE: config.ACCESS_AUDIENCE,
        OWNER_EMAIL: config.OWNER_EMAIL,
        PREVIEW_RELEASE: JSON.stringify(bundle.release),
      },
    }),
    { flag: 'wx', mode: 0o600 },
  );
  const env = {
    ...privateBuildEnvironment(source),
    CI: 'true',
    CLOUDFLARE_API_TOKEN: config.CLOUDFLARE_API_TOKEN,
    CLOUDFLARE_ACCOUNT_ID: config.CLOUDFLARE_ACCOUNT_ID,
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_SANITIZE: 'true',
    WRANGLER_LOG_PATH: resolve(uploadDirectory, 'wrangler.log'),
    WRANGLER_REGISTRY_PATH: resolve(uploadDirectory, 'registry'),
    WRANGLER_OUTPUT_FILE_PATH: outputPath,
  };
  await verifyPreviewBundle(bundleDirectory);
  // There is deliberately no deploy command, shell, inherited CLI options,
  // retry loop, production target, GitHub token or storage credential here.
  await run(
    'preview-upload',
    [
      resolve('node_modules/wrangler/bin/wrangler.js'),
      'versions',
      'upload',
      '--config',
      configPath,
      '--name',
      previewPolicy.workerName,
      '--env-file',
      emptyEnvPath,
      '--tag',
      bundle.capture.id,
    ],
    env,
    uploadDirectory,
    uploadDirectory,
  );
  const info = await lstat(outputPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024)
    throw new Error('Invalid upload receipt');
  const lines = (await readFile(outputPath, 'utf8')).trim().split('\n');
  if (lines.length !== 1) throw new Error('Ambiguous upload receipt');
  const uploaded = uploadedSchema.parse(JSON.parse(lines[0]!));
  const candidate = previewCandidateSchema.parse(
    await reader.candidate(uploaded.version_id),
  );
  if (JSON.stringify(candidate.release) !== JSON.stringify(bundle.release))
    throw new Error('Uploaded version does not match the sealed bundle');
  await verifyPreviewBundle(bundleDirectory);
  return candidate;
}
