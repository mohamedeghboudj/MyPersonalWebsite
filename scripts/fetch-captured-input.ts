import { capturedWorkflow } from './captured-workflow.ts';
import { privateR2Reader, PrivateStorageReadError } from './private-r2.ts';
import { fetchCapturedInput } from './captured-input.ts';

let stage = 'workflow-context';
try {
  const { capture } = await capturedWorkflow();
  stage = 'storage-configuration';
  if (
    process.env.PUBLISH_R2_BUCKET !==
    `mohamedeghboudj-media-${capture.environment}`
  )
    throw new Error('Storage environment mismatch');
  const readObject = privateR2Reader(process.env);
  stage = 'input-validation-or-local-write';
  await fetchCapturedInput(capture, readObject, 'artifacts/captured-input');
  console.log('Private capture and eligible originals verified.');
} catch (error) {
  // The repository and Actions log are public. Never print response bodies,
  // object keys, credentials, unpublished input, or data-bearing exceptions.
  const code = error instanceof PrivateStorageReadError ? error.code : stage;
  console.error(`Private input retrieval failed [${code}].`);
  process.exitCode = 1;
}
