export default async function teardown() {
  // Windows does not deliver Playwright's shutdown signals to this Node server
  // consistently. This endpoint exists only in the loopback test harness.
  await fetch('http://127.0.0.1:4173/__stop_test_server', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:4173' },
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined);
}
