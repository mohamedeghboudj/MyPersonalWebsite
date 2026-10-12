import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { snapshotSchema } from '@platform/schema';
import { verifySnapshotCvs } from './cv-artifacts.ts';

const snapshot = snapshotSchema.parse(
  JSON.parse(await readFile('artifacts/snapshot.json', 'utf8')),
);
const files = await verifySnapshotCvs(snapshot, 'artifacts/cv');
await mkdir('apps/site/public/cv', { recursive: true });
for (const file of files)
  await writeFile(`apps/site/public/cv/${file.locale}.pdf`, file.pdf);
