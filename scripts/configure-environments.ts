import { readFile, writeFile } from 'node:fs/promises';
import {
  assertRemoteResourcesConfigured,
  createWranglerConfigs,
  deploymentSetSchema,
} from '../packages/config/src/deployment.ts';
const name = process.argv[2];
if (name !== 'preview' && name !== 'production')
  throw new Error('Select preview or production explicitly');
const config = deploymentSetSchema.parse(
  JSON.parse(await readFile('environments.private.json', 'utf8')),
);
assertRemoteResourcesConfigured(config, name);
const workers = createWranglerConfigs(config, name);
for (const [directory, worker] of [
  ['apps/admin', workers.admin],
  ['worker/contact', workers.contact],
  ['apps/site', workers.site],
] as const)
  await writeFile(
    `${directory}/wrangler.${name}.json`,
    JSON.stringify(worker, null, 2) + '\n',
    'utf8',
  );
console.log(
  `${name} configuration generated; routes disabled. No resources were created or deployed.`,
);
