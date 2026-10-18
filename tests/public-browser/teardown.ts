export default async function teardown() {
  await fetch('http://127.0.0.1:4322/__stop_test_server', {
    method: 'POST',
    headers: { Origin: 'http://127.0.0.1:4322' },
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined);
}
