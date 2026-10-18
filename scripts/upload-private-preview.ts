import { uploadPrivatePreview } from './private-preview-upload.ts';

try {
  const candidate = await uploadPrivatePreview(
    'artifacts/private-preview',
    process.env,
  );
  // Identifiers only. The package, compiler/Wrangler logs and binding values
  // remain private and are removed by the workflow's always-run cleanup.
  console.log(`Private preview candidate uploaded: ${candidate.versionId}.`);
  console.log('Activation has not been requested.');
} catch {
  console.error(
    'Private preview upload could not be verified. No activation was requested.',
  );
  process.exitCode = 1;
}
