import { readCapturedInput } from './captured-input.ts';
import { preparePreviewBundle } from './preview-bundle.ts';
try {
  const capture = await readCapturedInput('artifacts/captured-input');
  await preparePreviewBundle(
    'artifacts/captured-input',
    'artifacts/captured-cv',
    'apps/site/dist',
    'artifacts/private-preview',
    capture.purpose,
  );
  console.log('Private preview package verified.');
} catch {
  console.error(
    'Private preview packaging failed. No deployment was attempted.',
  );
  process.exitCode = 1;
}
