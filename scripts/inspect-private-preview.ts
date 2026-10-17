import { verifyPreviewBundle } from './preview-bundle.ts';
import {
  comparePreviewRelease,
  previewDeploymentReader,
} from './preview-deployment.ts';

try {
  const bundle = await verifyPreviewBundle('artifacts/private-preview');
  const active = await previewDeploymentReader(process.env)();
  const state = comparePreviewRelease(bundle.release, active.release);
  console.log(`Private preview inspection: ${state}. No deployment performed.`);
} catch {
  console.error('Private preview inspection failed. No deployment performed.');
  process.exitCode = 1;
}
