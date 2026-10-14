import { Hono } from 'hono';
import { z } from 'zod';
import { boundedJson } from '@platform/config';
import { publishCaptureRequestSchema } from '@platform/schema';
import {
  listPublishCaptures,
  readPublishCapture,
  captureSummary,
  PublishCaptureError,
} from '@platform/database';
import {
  createPrivateCapture,
  downloadPrivateCapture,
} from './publish-captures.ts';
import { requireRecentLogin } from './recent-login.ts';
import { hasFreshLogin } from './fresh-auth.ts';
import type { AdminEnvironment } from './index.ts';

export function createPublishingRoutes(freshLogin = hasFreshLogin) {
  return new Hono<AdminEnvironment>()
    .get('/captures', async (c) =>
      c.json({ captures: await listPublishCaptures(c.env.CONTENT) }),
    )
    .post('/captures', async (c) => {
      const request = publishCaptureRequestSchema.parse(
        await boundedJson(c.req.raw, 1024),
      );
      const rejected = await requireRecentLogin(
        c,
        freshLogin,
        'Sign in again before preparing a publish or private preview.',
      );
      if (rejected) return rejected;
      if (!c.env.MEDIA)
        return c.json(
          { error: 'Private capture storage is not configured.' },
          503,
        );
      const capture = await createPrivateCapture(
        c.env.CONTENT,
        c.env.MEDIA,
        request,
        c.get('actor'),
      );
      return c.json({ capture }, capture.status === 'capturing' ? 202 : 200);
    })
    .get('/captures/:id', async (c) => {
      const id = publishCaptureRequestSchema.shape.id.parse(c.req.param('id'));
      const row = await readPublishCapture(c.env.CONTENT, id);
      if (!row) return c.json({ error: 'Capture not found.' }, 404);
      return c.json({ capture: captureSummary(row) });
    })
    .get('/captures/:id/input', async (c) => {
      if (!c.env.MEDIA)
        return c.json(
          { error: 'Private capture storage is not configured.' },
          503,
        );
      const id = publishCaptureRequestSchema.shape.id.parse(c.req.param('id'));
      const input = await downloadPrivateCapture(
        c.env.CONTENT,
        c.env.MEDIA,
        id,
      );
      c.header('Content-Type', 'application/octet-stream');
      c.header(
        'Content-Disposition',
        `attachment; filename="publish-input-${id}.json"`,
      );
      c.header('Content-Security-Policy', "default-src 'none'; sandbox");
      c.header('X-Publish-Input-SHA256', input.sha256);
      return c.body(input.body);
    })
    .onError((error, c) => {
      if (error instanceof PublishCaptureError)
        return c.json({ error: error.message }, error.status);
      if (
        error instanceof z.ZodError ||
        error instanceof SyntaxError ||
        ['body-empty', 'content-type'].includes(error.message)
      )
        return c.json({ error: 'Check the capture request.' }, 400);
      if (error.message === 'body-size')
        return c.json({ error: 'Capture request is too large.' }, 413);
      return c.json(
        {
          error:
            'Private capture storage is temporarily unavailable. Retry the same request.',
        },
        503,
      );
    });
}
