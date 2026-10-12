import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { capturePublicSnapshot } from '@platform/database';
import { publicSnapshotSchema } from '@platform/schema';
import { localDatabase, migrateTestDatabase } from './local-database.ts';
import { publicCvFixture } from '../tests/fixtures/public-cv.ts';
import { verifyPublicCvs, cvDigest } from './cv-artifacts.ts';

const directory = resolve('artifacts/public-cv-proof');
if (process.argv[2] === 'prepare') {
  const local = await localDatabase();
  try {
    await migrateTestDatabase(local.content, local.inbox);
    const snapshot = publicCvFixture(
      await capturePublicSnapshot(local.content),
    );
    await mkdir(directory, { recursive: true });
    await writeFile(
      resolve(directory, 'snapshot.json'),
      JSON.stringify(snapshot),
    );
    console.log('Prepared synthetic full-content public CV snapshot.');
  } finally {
    await local.runtime.dispose();
  }
} else if (process.argv[2] === 'verify') {
  const snapshot = publicSnapshotSchema.parse(
    JSON.parse(await readFile(resolve(directory, 'snapshot.json'), 'utf8')),
  );
  const files = await verifyPublicCvs(snapshot, resolve(directory, 'cv'));
  for (const file of files) {
    const html = await readFile(
      resolve(
        'apps/site/dist',
        file.locale === 'en' ? '' : file.locale,
        'index.html',
      ),
      'utf8',
    );
    if (
      !html.includes(`href="/cv/${file.locale}.pdf"`) ||
      !html.includes(`data-revision="${snapshot.revision}"`)
    )
      throw new Error('Matching CV download missing from localized page');
    if (
      cvDigest(
        await readFile(resolve('apps/site/dist/cv', `${file.locale}.pdf`)),
      ) !== cvDigest(file.pdf)
    )
      throw new Error('Public PDF differs from verified compiler output');
  }
  console.log(
    'All three public CV links and deployed PDF bytes match the exact site snapshot. Visual inspection remains required.',
  );
} else throw new Error('Use prepare or verify');
