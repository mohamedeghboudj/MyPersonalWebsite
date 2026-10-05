import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { z } from 'zod';
import { snapshotSchema } from '@platform/schema';
import { assertNewerRevision } from './publish-validation.ts';

const env = z
  .object({
    CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/u),
    CLOUDFLARE_API_TOKEN: z.string().min(20),
    PUBLIC_URL: z
      .url()
      .refine((value) =>
        /^https:\/\/mohamedeghboudj-site-spike\.[a-z0-9-]+\.workers\.dev\/?$/u.test(
          value,
        ),
      ),
  })
  .parse(process.env);
const snapshot = snapshotSchema.parse(
  JSON.parse(await readFile('artifacts/snapshot.json', 'utf8')),
);
const current = await fetch(env.PUBLIC_URL, {
  redirect: 'manual',
  cache: 'no-store',
  signal: AbortSignal.timeout(10000),
});
assertNewerRevision(current.status, await current.text(), snapshot.revision);
await writeFile(
  'artifacts/wrangler-site.json',
  JSON.stringify({
    name: 'mohamedeghboudj-site-spike',
    account_id: env.CLOUDFLARE_ACCOUNT_ID,
    compatibility_date: '2026-10-01',
    workers_dev: true,
    preview_urls: false,
    assets: { directory: resolve('apps/site/dist') },
  }),
);
// The workflow serializes the entire build/deploy operation. This revision check
// additionally refuses an older queued request; all spike publishes use it.
await new Promise<void>((resolvePromise, reject) => {
  const child = spawn(
    'pnpm',
    ['exec', 'wrangler', 'deploy', '--config', 'artifacts/wrangler-site.json'],
    { shell: false, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Do not expose account/binding metadata from the CLI in public workflow logs.
  child.stdout.resume();
  child.stderr.resume();
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error('Deployment timeout'));
  }, 120000);
  child.on('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.on('exit', (code) => {
    clearTimeout(timer);
    if (code === 0) resolvePromise();
    else
      reject(
        new Error(
          `Wrangler deployment failed (${code}); inspect private account deployment details`,
        ),
      );
  });
});
console.log(`Deployed public revision ${snapshot.revision}`);
