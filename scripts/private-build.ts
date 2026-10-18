import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readCapturedInput } from './captured-input.ts';
import { previewPolicy, publicationTargets } from '@platform/config';

export function privateBuildEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  // Children need the OS/toolchain, not the runner's credentials or Node hooks.
  const allowed = new Set([
    'path',
    'systemroot',
    'windir',
    'temp',
    'tmp',
    'tmpdir',
    'home',
    'userprofile',
    'localappdata',
    'ci',
    'github_actions',
  ]);
  return Object.fromEntries(
    Object.entries(source).filter(([key]) => allowed.has(key.toLowerCase())),
  );
}

export async function privateNodeStage(
  stage: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  logDirectory: string,
  cwd = process.cwd(),
) {
  if (!/^[a-z-]+$/u.test(stage)) throw new Error('Invalid build stage');
  await mkdir(logDirectory, { recursive: true, mode: 0o700 });
  const chunks: Buffer[] = [];
  let length = 0;
  let overflow = false;
  const result = await new Promise<boolean>((done) => {
    const child = spawn(process.execPath, args, {
      cwd,
      env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 20 * 60 * 1000,
    });
    const collect = (chunk: Buffer) => {
      const remaining = 2 * 1024 * 1024 - length;
      if (chunk.length > remaining) overflow = true;
      if (remaining > 0) {
        const bounded = chunk.subarray(0, remaining);
        chunks.push(bounded);
        length += bounded.length;
      }
      // Continue draining after the cap so the compiler's own finally/timeout
      // cleanup still runs. Neither stream is forwarded to the public CI log.
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', () => done(false));
    child.on('close', (code) => done(code === 0));
  });
  await writeFile(
    resolve(logDirectory, `${stage}.log`),
    Buffer.concat(chunks),
    { mode: 0o600 },
  );
  if (!result || overflow)
    throw new Error(`Private build stage failed: ${stage}`);
}

export async function buildCapturedInput(
  inputDirectory: string,
  cvDirectory: string,
  logDirectory: string,
) {
  const capture = await readCapturedInput(inputDirectory);
  const snapshot = resolve(inputDirectory, 'snapshot.json');
  const env = {
    ...privateBuildEnvironment(),
    CV_SNAPSHOT_PATH: snapshot,
    CV_OUTPUT_DIR: resolve(cvDirectory),
    SITE_SNAPSHOT_PATH: snapshot,
    SITE_MEDIA_SOURCE_DIR: resolve(inputDirectory, 'media'),
    SITE_CV_OUTPUT_DIR: resolve(cvDirectory),
    SITE_MODE:
      capture.purpose === 'publish' && capture.environment === 'production'
        ? 'production'
        : 'preview',
    SITE_ORIGIN:
      capture.purpose === 'preview'
        ? previewPolicy.origin
        : publicationTargets[capture.environment].origin,
  };
  for (const [stage, args, cwd] of [
    ['cv-prepare', [resolve('scripts/prepare-cv.ts')], resolve('.')],
    ['cv-compile', [resolve('scripts/compile-cv.ts')], resolve('.')],
    [
      'site-build',
      [resolve('node_modules/astro/bin/astro.mjs'), 'build'],
      resolve('apps/site'),
    ],
  ] as const) {
    await privateNodeStage(stage, [...args], env, logDirectory, cwd);
    console.log(`Private build stage passed: ${stage}`);
  }
  // A workflow that waits beyond the input's TTL may not claim a usable build.
  return readCapturedInput(inputDirectory);
}
