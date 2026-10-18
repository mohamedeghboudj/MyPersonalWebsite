import { buildCapturedInput } from './private-build.ts';

try {
  await buildCapturedInput(
    'artifacts/captured-input',
    'artifacts/captured-cv',
    'artifacts/captured-logs',
  );
  console.log(
    'Private site and trilingual CV build validated. Nothing was deployed.',
  );
} catch {
  console.error(
    'Private build validation failed. No deployment was attempted; unpublished diagnostics are not exposed in this log.',
  );
  process.exitCode = 1;
}
