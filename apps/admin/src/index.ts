import { Hono } from 'hono';
import { z } from 'zod';
import { drizzle } from 'drizzle-orm/d1';
import { desc, eq } from 'drizzle-orm';
import {
  adminEnvSchema,
  adminDocumentHeaders,
  boundedJson,
  securityHeaders,
  sha256,
} from '@platform/config';
import {
  createSnapshot,
  capturePublishSource,
  saveEducation,
  saveProfile,
  messages,
  audit,
} from '@platform/database';
import { verifyAccess, type VerifyAccess } from './auth';
import { spikePage, spikeScript } from './spike';

type Bindings = {
  ASSETS?: Fetcher;
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
  const routes = app
    .get('/api/session', (c) => c.json({ authenticated: true }))
    .get('/spike', (c) => {
      for (const [key, value] of Object.entries(adminDocumentHeaders))
        c.header(key, value);
      return c.html(spikePage);
    })
    .get('/spike.js', (c) =>
      c.body(spikeScript, 200, {
        'Content-Type': 'application/javascript; charset=utf-8',
      }),
    )
    .put('/api/education/:id', async (c) => {
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
    })
    .put('/api/profile', async (c) => {
      await saveProfile(
        c.env.CONTENT,
        await boundedJson(c.req.raw, 4000),
        c.get('actor'),
      );
      return c.json({ saved: true });
    })
    .get('/api/snapshot', async (c) => {
      const snapshot = await createSnapshot(c.env.CONTENT);
      const body = JSON.stringify(snapshot);
      c.header('X-Snapshot-SHA256', await sha256(body));
      return c.body(body, 200, {
        'Content-Type': 'application/json; charset=utf-8',
      });
    })
    // Snapshot capture is the spike's manual handoff to the owner-run workflow.
    .post('/api/publish/capture', async (c) => {
      const { snapshot, savedAt } = await capturePublishSource(c.env.CONTENT);
      if (!savedAt) return c.json({ error: 'Save a test item first' }, 409);
      const hash = await sha256(JSON.stringify(snapshot));
      await drizzle(c.env.CONTENT)
        .insert(audit)
        .values({
          actor: c.get('actor'),
          action: 'publish.capture',
          entity: `snapshot:${hash}`,
          createdAt: new Date().toISOString(),
        });
      return c.json({
        snapshot,
        hash,
        savedAt,
        capturedAt: new Date().toISOString(),
      });
    })
    .get('/api/inbox', async (c) =>
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
    )
    .post('/api/inbox/:id/replied', async (c) => {
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
    })
    .get('*', async (c) => {
      if (c.req.path.startsWith('/api/'))
        return c.json({ error: 'Not found' }, 404);
      if (!c.env.ASSETS)
        return c.json({ error: 'Console assets unavailable' }, 503);
      const response = await c.env.ASSETS.fetch(c.req.raw);
      const headers = new Headers(response.headers);
      for (const [key, value] of Object.entries(adminDocumentHeaders)) {
        c.header(key, value);
        headers.set(key, value);
      }
      return new Response(response.body, { status: response.status, headers });
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
  return routes;
}
export type AdminApi = ReturnType<typeof createAdmin>;
export default createAdmin();
