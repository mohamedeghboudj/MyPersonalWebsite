import { mkdir, readFile, lstat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  previewPolicy,
  previewUploadEnvSchema,
  publicationUploadEnvSchema,
  publicationTargets,
} from '@platform/config';
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
const uploadedSchema = (workerName: string) =>
  z.object({
    type: z.literal('version-upload'),
    version: z.literal(1),
    worker_name: z.literal(workerName),
    version_id: z.uuid(),
    preview_url: z.undefined().optional(),
    preview_alias_url: z.undefined().optional(),
  });

type UploadStage =
  | 'configuration'
  | 'bundle'
  | 'active-target'
  | 'release-order'
  | 'local-setup'
  | 'pre-upload-bundle'
  | 'wrangler-upload'
  | 'receipt'
  | 'candidate'
  | 'final-bundle';
type UploadReason = 'validation' | 'transport' | `http-${number}`;

export class CandidateUploadError extends Error {
  constructor(stage: UploadStage, reason: UploadReason) {
    // Both fields come only from local stages or a Response's numeric status.
    // Never retain an upstream exception, response body, URL or CLI log.
    super(`Candidate upload failed [${stage}/${reason}].`);
  }
}

async function uploadBundle(
  bundleDirectory: string,
  source: NodeJS.ProcessEnv,
  send: PreviewFetch = fetch,
  run: typeof privateNodeStage = privateNodeStage,
  purpose: 'preview' | 'publish' = 'preview',
) {
  let stage: UploadStage = 'configuration';
  let reason: UploadReason = 'validation';
  try {
    const config =
      purpose === 'preview'
        ? previewUploadEnvSchema.parse(source)
        : publicationUploadEnvSchema.parse(source);
    const workerName =
      'DEPLOYMENT_ENVIRONMENT' in config
        ? publicationTargets[config.DEPLOYMENT_ENVIRONMENT].workerName
        : previewPolicy.workerName;
    stage = 'bundle';
    const bundle = await verifyPreviewBundle(bundleDirectory, purpose);
    if (
      'DEPLOYMENT_ENVIRONMENT' in config &&
      config.DEPLOYMENT_ENVIRONMENT !== bundle.capture.environment
    )
      throw new Error('Deployment environment mismatch');
    const reader = previewCloudflareReader(
      config,
      async (request) => {
        let response: Response;
        try {
          response = await send(request);
        } catch {
          reason = 'transport';
          throw new Error('Inspection transport unavailable');
        }
        if (!response.ok) reason = `http-${response.status}`;
        return response;
      },
      purpose,
    );
    // Require an existing, identity-matched bootstrap/deployment. This script
    // cannot create a Worker, attach Access, change a route or activate a version.
    stage = 'active-target';
    const current = await reader.current();
    stage = 'release-order';
    if (comparePreviewRelease(bundle.release, current.release) !== 'newer')
      throw new Error('The captured preview is no longer newer');
    stage = 'local-setup';
    const uploadDirectory = resolve(bundleDirectory, 'upload');
    await mkdir(uploadDirectory, { mode: 0o700 });
    const configPath = resolve(uploadDirectory, 'wrangler.json');
    const outputPath = resolve(uploadDirectory, 'result.jsonl');
    const emptyEnvPath = resolve(uploadDirectory, 'empty.env');
    await writeFile(emptyEnvPath, '', { flag: 'wx', mode: 0o600 });
    await writeFile(
      configPath,
      JSON.stringify({
        name: workerName,
        account_id: config.CLOUDFLARE_ACCOUNT_ID,
        ...('ACCESS_AUDIENCE' in config
          ? { main: resolve('apps/preview/src/index.ts') }
          : {}),
        compatibility_date: '2026-10-01',
        workers_dev: false,
        preview_urls: false,
        assets: {
          directory: resolve(bundleDirectory, 'site'),
          ...('ACCESS_AUDIENCE' in config
            ? { binding: 'ASSETS', run_worker_first: true }
            : {}),
          not_found_handling: '404-page',
        },
        ...('ACCESS_AUDIENCE' in config
          ? {
              vars: {
                APP_ENV: 'preview',
                ACCESS_ISSUER: config.ACCESS_ISSUER,
                ACCESS_AUDIENCE: config.ACCESS_AUDIENCE,
                OWNER_EMAIL: config.OWNER_EMAIL,
                PREVIEW_RELEASE: JSON.stringify(bundle.release),
              },
            }
          : {}),
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
    stage = 'pre-upload-bundle';
    await verifyPreviewBundle(bundleDirectory, purpose);
    // There is deliberately no deploy command, shell, inherited CLI options,
    // retry loop, caller-chosen target, GitHub token or storage credential here.
    stage = 'wrangler-upload';
    await run(
      'preview-upload',
      [
        resolve('node_modules/wrangler/bin/wrangler.js'),
        'versions',
        'upload',
        '--config',
        configPath,
        '--name',
        workerName,
        '--env-file',
        emptyEnvPath,
        '--tag',
        bundle.capture.id,
        ...(purpose === 'publish'
          ? ['--message', JSON.stringify(bundle.release)]
          : []),
      ],
      env,
      uploadDirectory,
      uploadDirectory,
    );
    stage = 'receipt';
    const info = await lstat(outputPath);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024)
      throw new Error('Invalid upload receipt');
    const lines = (await readFile(outputPath, 'utf8')).trim().split('\n');
    // The pinned CLI writes a session header before its upload result. Require
    // exactly this pair; never search past unknown, repeated or failed events.
    // Session arguments/log paths remain private and are not used as authority.
    if (lines.length !== 2) throw new Error('Ambiguous upload receipt');
    z.object({
      type: z.literal('wrangler-session'),
      version: z.literal(1),
    }).parse(JSON.parse(lines[0]!));
    const uploaded = uploadedSchema(workerName).parse(JSON.parse(lines[1]!));
    stage = 'candidate';
    const candidate = previewCandidateSchema.parse(
      await reader.candidate(uploaded.version_id),
    );
    if (JSON.stringify(candidate.release) !== JSON.stringify(bundle.release))
      throw new Error('Uploaded version does not match the sealed bundle');
    stage = 'final-bundle';
    await verifyPreviewBundle(bundleDirectory, purpose);
    return candidate;
  } catch {
    throw new CandidateUploadError(stage, reason);
  }
}

export const uploadPrivatePreview = (
  directory: string,
  env: NodeJS.ProcessEnv,
  send?: PreviewFetch,
  run?: typeof privateNodeStage,
) => uploadBundle(directory, env, send, run, 'preview');
export const uploadPublicSite = (
  directory: string,
  env: NodeJS.ProcessEnv,
  send?: PreviewFetch,
  run?: typeof privateNodeStage,
) => uploadBundle(directory, env, send, run, 'publish');
