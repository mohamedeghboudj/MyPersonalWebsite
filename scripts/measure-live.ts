import { mkdir, writeFile } from 'node:fs/promises';
import { z } from 'zod';

// Observes only. Never deploys, changes an account, or records access credentials.
const input = z
  .object({
    PUBLIC_URL: z.url().refine((value) => new URL(value).protocol === 'https:'),
    EXPECTED_REVISION: z.coerce.number().int().nonnegative(),
    PUBLISH_STARTED_AT: z.iso.datetime(),
  })
  .parse(process.env);
const started = Date.parse(input.PUBLISH_STARTED_AT);
if (Date.now() < started || Date.now() - started > 30 * 60 * 1000)
  throw new Error('Use the actual recent publish-start timestamp');
const deadline = started + 30 * 60 * 1000;
const evidence: {
  locale: string;
  observedAt: string;
  elapsedMs: number;
  status: number;
}[] = [];
for (const locale of ['en', 'fr', 'ar']) {
  const url = new URL(locale === 'en' ? '/' : `/${locale}/`, input.PUBLIC_URL);
  let found = false;
  while (Date.now() < deadline) {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });
    const html = await response.text();
    if (
      response.ok &&
      html.includes(`data-revision="${input.EXPECTED_REVISION}"`)
    ) {
      if (response.headers.has('set-cookie'))
        throw new Error('Public response set a cookie');
      evidence.push({
        locale,
        observedAt: new Date().toISOString(),
        elapsedMs: Date.now() - started,
        status: response.status,
      });
      found = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 2000));
  }
  if (!found) throw new Error(`Revision was not observed live in ${locale}`);
}
await mkdir('artifacts', { recursive: true });
await writeFile(
  'artifacts/live-observation.json',
  JSON.stringify(
    {
      ...input,
      pollingIntervalMs: 2000,
      note: 'Routes observed sequentially; durations are upper bounds, not exact deployment times.',
      evidence,
    },
    null,
    2,
  ),
);
console.log(
  'Recorded live revision observations. Pair with the actual Actions/deployment timestamps.',
);
