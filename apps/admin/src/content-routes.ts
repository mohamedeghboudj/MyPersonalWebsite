import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';
import { validator } from 'hono/validator';
import { z } from 'zod';
import { adminEnvSchema, boundedJson } from '@platform/config';
import {
  editorDeleteSchema,
  editorRequestSchema,
  editorModules,
} from '@platform/schema';
import {
  listEditor,
  readEditor,
  saveEditor,
  deleteEditor,
  editorChoices,
  editorOverview,
  editorModule,
  EditorError,
  mediaObject,
  cleanMedia,
} from '@platform/database';
import { hasFreshLogin } from './fresh-auth.ts';
import type { AdminEnvironment } from './index.ts';

const idSchema = z.coerce.number().int().positive().max(2147483647);
const pageSchema = z.coerce.number().int().min(0).max(200);
const pagination = validator('query', (value) =>
  z
    .object({ page: z.string().optional(), selected: z.string().optional() })
    .parse(value),
);
type WriteRequest = z.infer<typeof editorRequestSchema>;
type DeleteRequest = z.infer<typeof editorDeleteSchema>;
const writeInput = createMiddleware<
  AdminEnvironment,
  string,
  { in: { json: WriteRequest }; out: { json: WriteRequest } }
>(async (c, next) => {
  c.req.addValidatedData(
    'json',
    editorRequestSchema.parse(await boundedJson(c.req.raw, 64000)),
  );
  await next();
});
const deleteInput = createMiddleware<
  AdminEnvironment,
  string,
  { in: { json: DeleteRequest }; out: { json: DeleteRequest } }
>(async (c, next) => {
  c.req.addValidatedData(
    'json',
    editorDeleteSchema.parse(await boundedJson(c.req.raw, 1000)),
  );
  await next();
});
export function createContentRoutes(freshLogin = hasFreshLogin) {
  return new Hono<AdminEnvironment>()
    .use('*', async (c, next) => {
      if (
        c.req.method === 'DELETE' ||
        (['POST', 'PUT'].includes(c.req.method) &&
          editorModule(c.req.path.split('/')[3] ?? '').sensitive)
      ) {
        const config = adminEnvSchema.parse(c.env);
        try {
          if (
            !(await freshLogin(
              c.req.header('Cf-Access-Jwt-Assertion') ?? '',
              config.ACCESS_ISSUER,
              config.OWNER_EMAIL,
            ))
          )
            return c.json(
              {
                error:
                  'Sign in again before deleting content or changing site settings.',
                reauthenticate: '/cdn-cgi/access/logout',
              },
              428,
            );
        } catch {
          return c.json(
            {
              error:
                'Access could not verify your recent login. Your content is unchanged. Sign in again, then retry. If it still fails, try again shortly.',
              reauthenticate: '/cdn-cgi/access/logout',
            },
            503,
          );
        }
      }
      await next();
    })
    .get('/registry', (c) => c.json({ modules: editorModules }))
    .get('/overview', async (c) => c.json(await editorOverview(c.env.CONTENT)))
    .get('/choices/:type', pagination, async (c) =>
      c.json(
        await editorChoices(
          c.env.CONTENT,
          c.req.param('type'),
          pageSchema.parse(c.req.valid('query').page ?? 0),
          c.req.valid('query').selected
            ? idSchema.parse(c.req.valid('query').selected)
            : undefined,
        ),
      ),
    )
    .get('/:type', pagination, async (c) =>
      c.json(
        await listEditor(
          c.env.CONTENT,
          c.req.param('type'),
          pageSchema.parse(c.req.valid('query').page ?? 0),
        ),
      ),
    )
    .get('/:type/:id', async (c) =>
      c.json(
        await readEditor(
          c.env.CONTENT,
          c.req.param('type'),
          idSchema.parse(c.req.param('id')),
        ),
      ),
    )
    .post('/:type', writeInput, async (c) => {
      const request = c.req.valid('json');
      return c.json(
        await saveEditor(
          c.env.CONTENT,
          c.req.param('type'),
          null,
          request.record,
          request.revision,
          c.get('actor'),
        ),
        201,
      );
    })
    .put('/:type/:id', writeInput, async (c) => {
      const request = c.req.valid('json');
      return c.json(
        await saveEditor(
          c.env.CONTENT,
          c.req.param('type'),
          idSchema.parse(c.req.param('id')),
          request.record,
          request.revision,
          c.get('actor'),
        ),
      );
    })
    .delete('/:type/:id', deleteInput, async (c) => {
      const request = c.req.valid('json');
      const id = idSchema.parse(c.req.param('id'));
      const file =
        c.req.param('type') === 'media'
          ? await mediaObject(c.env.CONTENT, id)
          : null;
      if (file && !c.env.MEDIA)
        return c.json(
          { error: 'Media storage unavailable. The file was not deleted.' },
          503,
        );
      const result = await deleteEditor(
        c.env.CONTENT,
        c.req.param('type'),
        id,
        request.revision,
        c.get('actor'),
      );
      if (file && c.env.MEDIA) {
        try {
          await cleanMedia(c.env.CONTENT, c.env.MEDIA);
        } catch {
          return c.json({
            ...result,
            warning:
              'The library entry was removed. Its private original is queued for storage cleanup.',
          });
        }
      }
      return c.json(result);
    })
    .onError((error, c) => {
      if (error instanceof EditorError)
        return c.json({ error: error.message }, error.status);
      if (error instanceof z.ZodError)
        return c.json(
          {
            error: 'Check the highlighted fields.',
            issues: error.issues.map((issue) => ({
              path: issue.path.map(String).join('.'),
              message: issue.message,
            })),
          },
          400,
        );
      if (
        ['content-type', 'body-empty', 'body-size'].includes(error.message) ||
        error instanceof SyntaxError
      )
        return c.json(
          { error: 'Invalid request body' },
          error.message === 'body-size' ? 413 : 400,
        );
      return c.json(
        {
          error:
            'This change could not be saved. Your existing content is unchanged.',
        },
        500,
      );
    });
}
