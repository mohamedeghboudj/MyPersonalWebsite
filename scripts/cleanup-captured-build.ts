import { rm } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

const workspace = resolve('.');
for (const directory of [
  'artifacts/captured-input',
  'artifacts/captured-cv',
  'artifacts/captured-logs',
  'artifacts/private-preview',
  'artifacts/public-media',
  'apps/site/dist',
  'apps/site/.astro',
]) {
  const target = resolve(directory);
  if (!target.startsWith(workspace + sep))
    throw new Error('Cleanup escaped the workspace');
  await rm(target, { recursive: true, force: true });
}
console.log('Private build workspace removed.');
