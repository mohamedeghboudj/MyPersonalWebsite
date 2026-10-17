import { preparePreviewBundle } from './preview-bundle.ts';
try {
  await preparePreviewBundle(
    'artifacts/captured-input',
    'artifacts/captured-cv',
    'apps/site/dist',
    'artifacts/private-preview',
  );
  console.log('Private preview package verified.');
} catch {
  console.error(
    'Private preview packaging failed. No deployment was attempted.',
  );
  process.exitCode = 1;
}
