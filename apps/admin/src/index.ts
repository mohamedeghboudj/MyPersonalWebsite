import { Hono } from 'hono';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/d1';
import { desc, eq } from 'drizzle-orm';
import {
  adminEnvSchema,
  boundedJson,
  securityHeaders,
  sha256,
} from '@platform/config';
import {
  createSnapshot,
  saveEducation,
  saveProfile,
  messages,
  audit,
} from '@platform/database';
import { verifyAccess, type VerifyAccess } from './auth';

type Bindings = {
  CONTENT: D1Database;
  INBOX: D1Database;
  ACCESS_ISSUER: string;
  ACCESS_AUDIENCE: string;
  OWNER_EMAIL: string;
  ADMIN_ORIGIN: string;
};
export function createAdmin(verify: VerifyAccess = verifyAccess) {
  const app = new Hono<{ Bindings: Bindings; Variables: { actor: string } }>();
  app.use('*', async (c, next) => {
    for (const [key, value] of Object.entries(securityHeaders))
      c.header(key, value);
    const config = adminEnvSchema.safeParse(c.env);
    if (!config.success)
      return c.json({ error: 'Admin configuration incomplete' }, 503);
    const token = c.req.header('Cf-Access-Jwt-Assertion');
    if (!token) return c.json({ error: 'Authentication required' }, 401);
    try {
      const claims = await verify(
        token,
        config.data.ACCESS_ISSUER,
        config.data.ACCESS_AUDIENCE,
      );
      if (
        !claims.sub ||
        typeof claims.email !== 'string' ||
        claims.email.toLowerCase() !== config.data.OWNER_EMAIL.toLowerCase()
      )
        return c.json({ error: 'Forbidden' }, 403);
      c.set('actor', claims.sub);
    } catch {
      return c.json({ error: 'Invalid authentication' }, 401);
    }
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(c.req.method) &&
      c.req.header('Origin') !== config.data.ADMIN_ORIGIN
    )
      return c.json({ error: 'Origin rejected' }, 403);
    await next();
  });
  app.get('/api/session', (c) => c.json({ authenticated: true }));
  app.put('/api/education/:id', async (c) => {
    const id = z.coerce
      .number()
      .int()
      .positive()
      .max(2147483647)
      .parse(c.req.param('id'));
    await saveEducation(
      c.env.CONTENT,
      id,
      await boundedJson(c.req.raw, 24000),
      c.get('actor'),
    );
    return c.json({ saved: true, id, savedAt: new Date().toISOString() });
  });
  app.put('/api/profile', async (c) => {
    await saveProfile(
      c.env.CONTENT,
      await boundedJson(c.req.raw, 4000),
      c.get('actor'),
    );
    return c.json({ saved: true });
  });
  app.get('/api/snapshot', async (c) => {
    const snapshot = await createSnapshot(c.env.CONTENT);
    const body = JSON.stringify(snapshot);
    c.header('X-Snapshot-SHA256', await sha256(body));
    return c.body(body, 200, {
      'Content-Type': 'application/json; charset=utf-8',
    });
  });
  // Snapshot capture is the spike's publish handoff. Deployment is an explicit CLI
  // operation; this endpoint does not pretend to have dispatched a workflow.
  app.post('/api/publish/capture', async (c) => {
    const snapshot = await createSnapshot(c.env.CONTENT);
    const hash = await sha256(JSON.stringify(snapshot));
    await drizzle(c.env.CONTENT)
      .insert(audit)
      .values({
        actor: c.get('actor'),
        action: 'publish.capture',
        entity: `snapshot:${hash}`,
        createdAt: new Date().toISOString(),
      });
    return c.json({ snapshot, hash, capturedAt: new Date().toISOString() });
  });
  app.get('/api/inbox', async (c) =>
    c.json({
      messages: await drizzle(c.env.INBOX)
        .select({
          id: messages.id,
          name: messages.name,
          email: messages.email,
          message: messages.message,
          status: messages.status,
          notificationStatus: messages.notificationStatus,
          createdAt: messages.createdAt,
        })
        .from(messages)
        .orderBy(desc(messages.createdAt))
        .limit(50),
    }),
  );
  app.post('/api/inbox/:id/replied', async (c) => {
    const id = z.uuid().parse(c.req.param('id'));
    // Each database is transactional individually; no cross-database atomicity is claimed.
    await drizzle(c.env.INBOX)
      .update(messages)
      .set({ status: 'replied' })
      .where(eq(messages.id, id));
    await drizzle(c.env.CONTENT)
      .insert(audit)
      .values({
        actor: c.get('actor'),
        action: 'inbox.replied',
        entity: `message:${id}`,
        createdAt: new Date().toISOString(),
      });
    return c.json({ saved: true });
  });
  app.onError((error, c) => {
    if (error instanceof z.ZodError)
      return c.json({ error: 'Invalid input' }, 400);
    if (
      ['content-type', 'body-size', 'body-empty'].includes(error.message) ||
      error instanceof SyntaxError
    )
      return c.json(
        { error: 'Invalid request body' },
        error.message === 'body-size' ? 413 : 400,
      );
    return c.json({ error: 'Request failed' }, 500);
  });
  return app;
}
export default createAdmin();
