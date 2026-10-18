import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { AwsClient } from 'aws4fetch';
import { boundedBytes, diagnosticsStorageEnvSchema } from '@platform/config';
import {
  buildDiagnosticsSchema,
  buildDiagnosticsKey,
  buildDiagnosticPolicy,
  diagnosticStages,
  type BuildDiagnostics,
} from '@platform/schema';
import { validateCaptureTime } from './captured-input.ts';

export async function collectBuildDiagnostics(
  raw: Omit<BuildDiagnostics, 'logs' | 'schemaVersion' | 'createdAt'>,
  directory: string,
  now = new Date(),
) {
  validateCaptureTime(raw.capture, now);
  const logs: BuildDiagnostics['logs'] = [];
  const root = await lstat(directory).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (root && (!root.isDirectory() || root.isSymbolicLink()))
    throw new Error('Invalid private log directory');
  if (root)
    for (const stage of diagnosticStages) {
      const path = resolve(directory, `${stage}.log`);
      const info = await lstat(path).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
        throw error;
      });
      if (!info) continue;
      if (!info.isFile() || info.isSymbolicLink())
        throw new Error('Invalid private log file');
      const file = await open(path, 'r');
      try {
        const opened = await file.stat();
        if (
          !opened.isFile() ||
          opened.ino !== info.ino ||
          opened.dev !== info.dev ||
          opened.size !== info.size
        )
          throw new Error('Private log changed before reading');
        const length = Math.min(info.size, buildDiagnosticPolicy.maxLogBytes);
        const bytes = Buffer.alloc(length);
        const { bytesRead } = await file.read(
          bytes,
          0,
          length,
          Math.max(0, info.size - length),
        );
        // A tail keeps the final compiler error. Never glob upload/provider logs,
        // TeX sources or input files; those were not emitted by credential-free stages.
        const text = bytes
          .subarray(0, bytesRead)
          .toString('utf8')
          .replace(/\u001b\[[0-?]*[ -/]*[@-~]/gu, '')
          .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '');
        logs.push({ stage, text, truncated: info.size > length });
      } finally {
        await file.close();
      }
    }
  return buildDiagnosticsSchema.parse({
    ...raw,
    schemaVersion: 1,
    createdAt: now.toISOString(),
    logs,
  });
}

export async function storeBuildDiagnostics(
  raw: unknown,
  report: BuildDiagnostics,
  send: (request: Request) => Promise<Response> = fetch,
  now = new Date(),
) {
  const config = diagnosticsStorageEnvSchema.parse(raw);
  const value = buildDiagnosticsSchema.parse(report);
  validateCaptureTime(value.capture, now);
  if (
    config.PUBLISH_R2_BUCKET !==
    `mohamedeghboudj-media-${value.capture.environment}`
  )
    throw new Error('Diagnostic environment mismatch');
  if (Date.parse(value.createdAt) > now.getTime() + 60000)
    throw new Error('Future diagnostics');
  const body = JSON.stringify(value);
  if (Buffer.byteLength(body) > buildDiagnosticPolicy.maxReportBytes)
    throw new Error('Diagnostics exceed storage bound');
  const client = new AwsClient({
    accessKeyId: config.DIAGNOSTICS_R2_ACCESS_KEY_ID,
    secretAccessKey: config.DIAGNOSTICS_R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
    retries: 0,
  });
  const url = `https://${config.PUBLISH_R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${config.PUBLISH_R2_BUCKET}/${buildDiagnosticsKey(value.capture.id, value.run)}`;
  const response = await send(
    await client.sign(url, {
      method: 'PUT',
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'If-None-Match': '*',
      },
      body,
    }),
  );
  await response.body?.cancel();
  if (![200, 204, 412].includes(response.status))
    throw new Error('Private diagnostic upload unavailable');
  // Conditional creation cannot replace an earlier attempt's report. A duplicate
  // key is acceptable only after exact readback; no retry follows an ambiguous PUT.
  const check = await send(
    await client.sign(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    }),
  );
  if (check.status !== 200) {
    await check.body?.cancel();
    throw new Error('Private diagnostic verification unavailable');
  }
  const bytes = await boundedBytes(check, buildDiagnosticPolicy.maxReportBytes);
  if (!Buffer.from(bytes).equals(Buffer.from(body)))
    throw new Error('Private diagnostic verification failed');
}
