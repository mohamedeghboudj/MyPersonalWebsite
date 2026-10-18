import { z } from 'zod';
import { capturedBuildSchema } from './publish-build.ts';

export const diagnosticStages = [
  'cv-prepare',
  'cv-compile',
  'site-build',
] as const;
export const buildDiagnosticPolicy = {
  maxLogBytes: 64 * 1024,
  maxReportBytes: 1024 * 1024,
} as const;
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const buildAttemptSchema = z
  .object({
    runId: positive,
    attempt: positive,
  })
  .strict();
const outcome = z.enum(['success', 'failure', 'cancelled', 'skipped']);
export const diagnosticOutcomesSchema = z
  .object({
    retrieval: outcome,
    build: outcome,
    package: outcome,
    upload: outcome,
  })
  .strict();
export const buildDiagnosticsSchema = z
  .object({
    schemaVersion: z.literal(1),
    capture: capturedBuildSchema,
    run: buildAttemptSchema,
    createdAt: z.iso.datetime(),
    outcomes: diagnosticOutcomesSchema,
    logs: z
      .array(
        z
          .object({
            stage: z.enum(diagnosticStages),
            text: z.string().max(buildDiagnosticPolicy.maxLogBytes),
            truncated: z.boolean(),
          })
          .strict(),
      )
      .max(diagnosticStages.length),
  })
  .strict()
  .superRefine((report, context) => {
    if (
      new Set(report.logs.map((log) => log.stage)).size !== report.logs.length
    )
      context.addIssue({
        code: 'custom',
        message: 'Duplicate diagnostic stage',
      });
    if (
      Date.parse(report.createdAt) < Date.parse(report.capture.createdAt) ||
      Date.parse(report.createdAt) >= Date.parse(report.capture.expiresAt)
    )
      context.addIssue({
        code: 'custom',
        message: 'Diagnostics fall outside capture lifetime',
      });
  });
export type BuildDiagnostics = z.infer<typeof buildDiagnosticsSchema>;

export function buildDiagnosticsKey(
  id: string,
  run: z.infer<typeof buildAttemptSchema>,
) {
  const captureId = z.uuid().parse(id);
  const value = buildAttemptSchema.parse(run);
  return `publish-inputs/${captureId}.diagnostics.${value.runId}.${value.attempt}.json`;
}
export function diagnosticCaptureId(key: string) {
  const match =
    /^publish-inputs\/([^/]+)\.diagnostics\.([1-9][0-9]*)\.([1-9][0-9]*)\.json$/u.exec(
      key,
    );
  if (!match) return null;
  const id = z.uuid().safeParse(match[1]);
  const run = buildAttemptSchema.safeParse({
    runId: Number(match[2]),
    attempt: Number(match[3]),
  });
  return id.success &&
    run.success &&
    buildDiagnosticsKey(id.data, run.data) === key
    ? id.data
    : null;
}
