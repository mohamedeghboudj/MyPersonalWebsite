export const publishCapturePolicy = {
  maxInputBytes: 2 * 1024 * 1024,
  retentionMs: 24 * 60 * 60 * 1000,
  interruptedAfterMs: 5 * 60 * 1000,
  cleanupBatchSize: 5,
} as const;
