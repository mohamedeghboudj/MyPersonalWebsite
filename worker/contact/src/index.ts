import { Hono } from 'hono';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { contactSchema } from '@platform/schema';
import {
  boundedJson,
  contactEnvSchema,
  contactPolicy,
  dummyTurnstile,
  securityHeaders,
  sha256,
} from '@platform/config';
import { messages, rateLimits } from '../../../database/src/tables';

type EmailBinding = {
  send(message: {
    from: string;
    to: string;
    subject: string;
    text: string;
    replyTo: string;
  }): Promise<unknown>;
};
type Bindings = {
  INBOX: D1Database;
  EMAIL: EmailBinding;
  PUBLIC_ORIGIN: string;
  TURNSTILE_HOSTNAME: string;
  TURNSTILE_SECRET: string;
  TURNSTILE_MODE?: 'production' | 'spike';
  RATE_LIMIT_SALT: string;
  NOTIFICATION_FROM: string;
  NOTIFICATION_TO: string;
};
const verificationSchema = z.object({
  success: z.boolean(),
  hostname: z.string().optional(),
  action: z.string().optional(),
  metadata: z
    .object({ result_with_testing_key: z.boolean().optional() })
    .optional(),
});
type VerifyChallenge = (
  secret: string,
  token: string,
  ip: string,
) => Promise<z.infer<typeof verificationSchema>>;
const verifyChallenge: VerifyChallenge = async (secret, token, ip) => {
  const response = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
      signal: AbortSignal.timeout(5000),
    },
  );
  if (!response.ok) throw new Error('Challenge service unavailable');
  return verificationSchema.parse(await response.json());
};

export async function purgeInbox(binding: D1Database, now = Date.now()) {
  const db = drizzle(binding);
  await db.batch([
    db
      .delete(messages)
      .where(
        lt(messages.createdAt, now - contactPolicy.retentionDays * 86400000),
      ),
    db.delete(rateLimits).where(lt(rateLimits.expiresAt, now)),
  ]);
}

export function createContact(
  verify: VerifyChallenge = verifyChallenge,
  now = Date.now,
) {
  const app = new Hono<{ Bindings: Bindings }>();
  app.use('*', async (c, next) => {
    for (const [key, value] of Object.entries(securityHeaders))
      c.header(key, value);
    if (!contactEnvSchema.safeParse(c.env).success)
      return c.json({ error: 'Contact service unavailable' }, 503);
    if (c.req.header('Origin') !== c.env.PUBLIC_ORIGIN)
      return c.json({ error: 'Origin rejected' }, 403);
    c.header('Access-Control-Allow-Origin', c.env.PUBLIC_ORIGIN);
    c.header('Vary', 'Origin');
    await next();
  });
  app.options('/contact', (c) => {
    c.header('Access-Control-Allow-Methods', 'POST');
    c.header('Access-Control-Allow-Headers', 'Content-Type');
    return c.body(null, 204);
  });
  app.post('/contact', async (c) => {
    const input = contactSchema.parse(
      await boundedJson(c.req.raw, contactPolicy.maxBodyBytes),
    );
    const time = now();
    if (
      input.website ||
      time - input.startedAt < contactPolicy.minSubmitMs ||
      time - input.startedAt > contactPolicy.maxSubmitMs
    )
      return c.json({ error: 'Submission rejected' }, 400);
    const ip = c.req.header('CF-Connecting-IP');
    if (!ip) return c.json({ error: 'Visitor identity unavailable' }, 400);
    const visitorHash = await sha256(`${c.env.RATE_LIMIT_SALT}:${ip}`);
    const requestHash = await sha256(
      JSON.stringify({
        name: input.name,
        email: input.email,
        message: input.message,
        visitorHash,
      }),
    );
    const db = drizzle(c.env.INBOX);
    let existing = await db
      .select()
      .from(messages)
      .where(eq(messages.idempotencyKey, input.idempotencyKey))
      .get();
    if (existing && existing.requestHash !== requestHash)
      return c.json({ error: 'Idempotency key already used' }, 409);
    if (!existing) {
      const hour = Math.floor(time / 3600000);
      const increment = (key: string) =>
        db
          .insert(rateLimits)
          .values({ key, count: 1, expiresAt: (hour + 2) * 3600000 })
          .onConflictDoUpdate({
            target: rateLimits.key,
            set: { count: sql`${rateLimits.count} + 1` },
          })
          .returning({ count: rateLimits.count });
      // Atomic counter increments, not a SELECT-then-UPDATE race. Rejected attempts
      // consume budget too; parallel attempts cannot exceed the admission quota.
      const [visitor, global] = await db.batch([
        increment(`visitor:${hour}:${visitorHash}`),
        increment(`global:${hour}`),
      ]);
      if (
        (visitor[0]?.count ?? Infinity) > contactPolicy.perVisitorPerHour ||
        (global[0]?.count ?? Infinity) > contactPolicy.globalPerHour
      )
        return c.json({ error: 'Please try again later' }, 429);
      let check;
      try {
        check = await verify(c.env.TURNSTILE_SECRET, input.turnstileToken, ip);
      } catch {
        return c.json({ error: 'Verification unavailable' }, 503);
      }
      const expectedChallenge =
        c.env.TURNSTILE_MODE === 'spike'
          ? check.metadata?.result_with_testing_key === true &&
            check.hostname === dummyTurnstile.hostname &&
            check.action === undefined
          : check.metadata?.result_with_testing_key !== true &&
            check.hostname === c.env.TURNSTILE_HOSTNAME &&
            check.action === contactPolicy.turnstileAction;
      if (!check.success || !expectedChallenge)
        return c.json({ error: 'Verification failed' }, 400);
      await db
        .insert(messages)
        .values({
          id: crypto.randomUUID(),
          name: input.name,
          email: input.email,
          message: input.message,
          idempotencyKey: input.idempotencyKey,
          requestHash,
          visitorHash,
          createdAt: time,
        })
        .onConflictDoNothing({ target: messages.idempotencyKey });
      existing = await db
        .select()
        .from(messages)
        .where(eq(messages.idempotencyKey, input.idempotencyKey))
        .get();
      if (!existing || existing.requestHash !== requestHash)
        return c.json({ error: 'Idempotency conflict' }, 409);
    }
    // Only one request can claim notification delivery for this row. A failed send
    // can be retried with the same key, without reusing a consumed Turnstile token.
    const claimed = await db
      .update(messages)
      .set({ notificationStatus: 'sending' })
      .where(
        and(
          eq(messages.id, existing.id),
          inArray(messages.notificationStatus, ['pending', 'failed']),
        ),
      )
      .returning({ id: messages.id });
    if (claimed.length) {
      try {
        await c.env.EMAIL.send({
          from: c.env.NOTIFICATION_FROM,
          to: c.env.NOTIFICATION_TO,
          replyTo: existing.email,
          subject: 'New website contact message',
          text: `${existing.name}\n\n${existing.message}\n\nReference: ${existing.id}`,
        });
        await db
          .update(messages)
          .set({ notificationStatus: 'sent' })
          .where(eq(messages.id, existing.id));
      } catch {
        await db
          .update(messages)
          .set({ notificationStatus: 'failed' })
          .where(eq(messages.id, existing.id));
      }
    }
    // A successful storage response never claims that Gmail delivery was proven.
    return c.json({ accepted: true, reference: existing.id }, 202);
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError || error instanceof SyntaxError)
      return c.json({ error: 'Invalid submission' }, 400);
    if (error.message === 'body-size')
      return c.json({ error: 'Submission too large' }, 413);
    if (['content-type', 'body-empty'].includes(error.message))
      return c.json({ error: 'Invalid request body' }, 400);
    return c.json({ error: 'Contact service unavailable' }, 503);
  });
  return app;
}
const app = createContact();
export default {
  fetch: app.fetch,
  scheduled: (
    _event: ScheduledController,
    env: Bindings,
    ctx: ExecutionContext,
  ) => ctx.waitUntil(purgeInbox(env.INBOX)),
};
