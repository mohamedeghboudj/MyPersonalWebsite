import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { capturePublicSnapshot } from '@platform/database';
import { publicSnapshotSchema } from '@platform/schema';
import { localDatabase, migrateTestDatabase } from './local-database.ts';
import { publicCvFixture } from '../tests/fixtures/public-cv.ts';
import { verifyPublicCvs, cvDigest } from './cv-artifacts.ts';
import { sealPublishInput } from './publish-input.ts';
import { fetchCapturedInput } from './captured-input.ts';
import {
  buildCapturedInput,
  privateNodeStage,
  privateBuildEnvironment,
} from './private-build.ts';
import { publishCapturePolicy, publicationTargets } from '@platform/config';
import { preparePreviewBundle, verifyPreviewBundle } from './preview-bundle.ts';

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
} else if (process.argv[2] === 'build-capture') {
  const snapshot = publicSnapshotSchema.parse(
    JSON.parse(await readFile(resolve(directory, 'snapshot.json'), 'utf8')),
  );
  const sealed = sealPublishInput({
    schemaVersion: 1,
    snapshot,
    mediaSources: [],
  });
  const id = crypto.randomUUID();
  const inputDirectory = resolve(directory, 'captured-input');
  await fetchCapturedInput(
    {
      schemaVersion: 1,
      id,
      purpose: 'preview',
      sequence: 1,
      revision: snapshot.revision,
      inputSha256: sealed.sha256,
      snapshotSha256: cvDigest(JSON.stringify(snapshot)),
      byteSize: sealed.body.length,
      createdAt: snapshot.generatedAt,
      expiresAt: new Date(
        Date.parse(snapshot.generatedAt) + publishCapturePolicy.retentionMs,
      ).toISOString(),
    },
    async (key) => {
      if (key !== `publish-inputs/${id}.json`)
        throw new Error('Unexpected synthetic storage read');
      return new Response(sealed.body).body;
    },
    inputDirectory,
  );
  await buildCapturedInput(
    inputDirectory,
    resolve(directory, 'cv'),
    resolve(directory, 'private-logs'),
  );
  const bundle = await preparePreviewBundle(
    inputDirectory,
    resolve(directory, 'cv'),
    resolve('apps/site/dist'),
    resolve(directory, 'private-preview'),
  );
  const verified = await verifyPreviewBundle(
    resolve(directory, 'private-preview'),
  );
  if (verified.release.bundleSha256 !== bundle.release.bundleSha256)
    throw new Error('Synthetic private preview bundle mismatch');
  // Reuse the actual compiler output from this exact snapshot, then exercise
  // the public mode separately. No second compile or credential is required.
  const publicInput = resolve(directory, 'publication-input');
  await fetchCapturedInput(
    {
      ...verified.capture,
      id: crypto.randomUUID(),
      purpose: 'publish',
      environment: 'production',
    },
    async () => new Response(sealed.body).body,
    publicInput,
  );
  await privateNodeStage(
    'site-build',
    [resolve('node_modules/astro/bin/astro.mjs'), 'build'],
    {
      ...privateBuildEnvironment(),
      SITE_MODE: 'production',
      SITE_ORIGIN: publicationTargets.production.origin,
      SITE_SNAPSHOT_PATH: resolve(publicInput, 'snapshot.json'),
      SITE_MEDIA_SOURCE_DIR: resolve(publicInput, 'media'),
      SITE_CV_OUTPUT_DIR: resolve(directory, 'cv'),
    },
    resolve(directory, 'publication-logs'),
    resolve('apps/site'),
  );
  await preparePreviewBundle(
    publicInput,
    resolve(directory, 'cv'),
    resolve('apps/site/dist'),
    resolve(directory, 'publication-bundle'),
    'publish',
  );
  await verifyPreviewBundle(
    resolve(directory, 'publication-bundle'),
    'publish',
  );
  console.log('Synthetic immutable capture completed the private build path.');
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
} else throw new Error('Use prepare, build-capture or verify');
