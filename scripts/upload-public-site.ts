import {
  CandidateUploadError,
  uploadPublicSite,
} from './private-preview-upload.ts';
try {
  await uploadPublicSite('artifacts/private-preview', process.env);
  console.log(
    'Public static candidate verified. Activation is coordinated by the protected console.',
  );
} catch (error) {
  if (error instanceof CandidateUploadError) console.error(error.message);
  console.error('Public candidate upload failed. No deployment was attempted.');
  process.exitCode = 1;
}
