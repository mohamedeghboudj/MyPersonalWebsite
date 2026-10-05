import { z } from 'zod';

const origin = z
  .url()
  .refine(
    (value) => new URL(value).origin === value,
    'Expected an origin without a path',
  );
export const adminEnvSchema = z.object({
  ACCESS_ISSUER: z
    .url()
    .refine((value) =>
      /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/u.test(value),
    ),
  ACCESS_AUDIENCE: z.string().min(16),
  OWNER_EMAIL: z.email(),
  ADMIN_ORIGIN: origin,
});
// Cloudflare publishes these credentials for integration tests. They are public,
// not deployment secrets, and are accepted only in an explicitly isolated spike.
export const dummyTurnstile = {
  sitekey: '1x00000000000000000000AA',
  secret: '1x0000000000000000000000000000000AA',
  hostname: 'localhost',
  action: 'test',
} as const;
export const contactEnvSchema = z
  .object({
    PUBLIC_ORIGIN: origin,
    TURNSTILE_HOSTNAME: z
      .string()
      .min(1)
      .refine((value) => !/[/:\s]/u.test(value)),
    TURNSTILE_SECRET: z.string().min(10),
    TURNSTILE_MODE: z.enum(['production', 'spike']).default('production'),
    RATE_LIMIT_SALT: z.string().min(32),
    NOTIFICATION_FROM: z.email(),
    NOTIFICATION_TO: z.email(),
  })
  .superRefine((value, context) => {
    const dummy = /^[123]x0+AA$/u.test(value.TURNSTILE_SECRET);
    if (value.TURNSTILE_MODE === 'production' && dummy)
      context.addIssue({
        code: 'custom',
        message: 'Dummy keys cannot be used in production',
      });
    if (
      value.TURNSTILE_MODE === 'spike' &&
      (value.TURNSTILE_SECRET !== dummyTurnstile.secret ||
        value.TURNSTILE_HOSTNAME !== dummyTurnstile.hostname ||
        !/^(?:http:\/\/(?:localhost|127\.0\.0\.1)(?::[0-9]+)?|https:\/\/mohamedeghboudj-site-spike\.[a-z0-9-]+\.workers\.dev)$/u.test(
          value.PUBLIC_ORIGIN,
        ))
    )
      context.addIssue({
        code: 'custom',
        message: 'Dummy mode is restricted to local and isolated spike origins',
      });
  });
export const contactPolicy = {
  maxBodyBytes: 12_000,
  minSubmitMs: 2500,
  maxSubmitMs: 60 * 60 * 1000,
  perVisitorPerHour: 5,
  globalPerHour: 50,
  retentionDays: 365,
  turnstileAction: 'contact',
} as const;
export const securityHeaders = {
  'Content-Security-Policy':
    "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store',
} as const;

// Enforce a cap even when Content-Length is absent or dishonest.
export async function boundedJson(
  request: Request,
  maxBytes: number,
): Promise<unknown> {
  if (
    !request.headers
      .get('content-type')
      ?.split(';')[0]
      ?.trim()
      .toLowerCase()
      .endsWith('/json')
  )
    throw new Error('content-type');
  if (Number(request.headers.get('content-length')) > maxBytes)
    throw new Error('body-size');
  const reader = request.body?.getReader();
  if (!reader) throw new Error('body-empty');
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > maxBytes) {
      await reader.cancel();
      throw new Error('body-size');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(
    new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  ) as unknown;
}

export async function sha256(value: string): Promise<string> {
  const hash = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(hash), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
