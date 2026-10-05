import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { contactSchema } from '@platform/schema';

// A repeat of this script reuses the same message/key, so transient failures do
// not flood the owner's inbox. This is an API trace, not browser UI evidence.
const config = z
  .object({
    name: z.string(),
    vars: z.object({
      PUBLIC_ORIGIN: z.url(),
      TURNSTILE_MODE: z.literal('spike'),
    }),
  })
  .parse(
    JSON.parse(await readFile('worker/contact/wrangler.spike.json', 'utf8')),
  );
const publicUrl = new URL(config.vars.PUBLIC_ORIGIN);
if (
  !/^mohamedeghboudj-site-spike\.[a-z0-9-]+\.workers\.dev$/u.test(
    publicUrl.hostname,
  ) ||
  config.name !== 'mohamedeghboudj-contact-spike'
)
  throw new Error('Only the isolated live spike can receive this test');
const endpoint = new URL('/contact', publicUrl);
endpoint.hostname = endpoint.hostname.replace(
  'mohamedeghboudj-site-spike.',
  `${config.name}.`,
);
await mkdir('artifacts', { recursive: true });
const path = 'artifacts/contact-proof-request.json';
let input;
try {
  input = contactSchema.parse(JSON.parse(await readFile(path, 'utf8')));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  input = contactSchema.parse({
    name: 'Sprint 0 validation',
    email: 'visitor@example.com',
    message: 'Synthetic Sprint 0 contact delivery check. No reply required.',
    website: '',
    startedAt: Date.now(),
    idempotencyKey: crypto.randomUUID(),
    turnstileToken: 'XXXX.DUMMY.TOKEN.XXXX',
  });
  await writeFile(path, JSON.stringify(input));
}
if (Date.now() - input.startedAt > 3600000)
  throw new Error(
    'Previous trace expired; review its result before starting another submission',
  );
await setTimeout(Math.max(0, input.startedAt + 3000 - Date.now()));
const response = await fetch(endpoint, {
  method: 'POST',
  redirect: 'manual',
  headers: {
    Origin: config.vars.PUBLIC_ORIGIN,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(input),
  signal: AbortSignal.timeout(20000),
});
const result: unknown = response.headers
  .get('content-type')
  ?.includes('application/json')
  ? await response.json()
  : { error: 'Non-JSON response' };
const evidence = {
  scope:
    'Live API trace; Gmail placement and browser submission still need confirmation',
  checkedAt: new Date().toISOString(),
  status: response.status,
  result,
};
await writeFile(
  'artifacts/contact-proof-result.json',
  JSON.stringify(evidence, null, 2),
);
console.log(JSON.stringify(evidence));
if (response.status !== 202) process.exitCode = 1;
