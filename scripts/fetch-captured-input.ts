import { capturedWorkflow } from './captured-workflow.ts';
import { privateR2Reader } from './private-r2.ts';
import { fetchCapturedInput } from './captured-input.ts';

try {
  const { capture } = await capturedWorkflow();
  await fetchCapturedInput(
    capture,
    privateR2Reader(process.env),
    'artifacts/captured-input',
  );
  console.log('Private capture and eligible originals verified.');
} catch {
  // The repository and Actions log are public. Never print response bodies,
  // object keys, credentials, unpublished input, or data-bearing exceptions.
  console.error(
    'Private input retrieval failed. Check capture expiry and the configured read-only storage credential.',
  );
  process.exitCode = 1;
}
