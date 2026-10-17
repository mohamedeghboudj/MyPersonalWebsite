import { capturedWorkflow } from './captured-workflow.ts';
import { diagnosticOutcomesSchema } from '@platform/schema';
import {
  collectBuildDiagnostics,
  storeBuildDiagnostics,
} from './private-diagnostics.ts';

try {
  const { capture, run } = await capturedWorkflow();
  const report = await collectBuildDiagnostics(
    {
      capture,
      run,
      outcomes: diagnosticOutcomesSchema.parse({
        retrieval: process.env.DIAGNOSTIC_RETRIEVAL,
        build: process.env.DIAGNOSTIC_BUILD,
        package: process.env.DIAGNOSTIC_PACKAGE,
        upload: process.env.DIAGNOSTIC_UPLOAD,
      }),
    },
    'artifacts/captured-logs',
  );
  await storeBuildDiagnostics(process.env, report);
  console.log('Private build report stored and verified.');
} catch {
  console.error(
    'Private build report unavailable. No diagnostic content was written to this log.',
  );
  process.exitCode = 1;
}
