import { Hono } from 'hono';
import { z } from 'zod';
import {
  boundedJson,
  publishingEnvSchema,
  previewActivationEnvSchema,
  previewPolicy,
} from '@platform/config';
import {
  publishCaptureRequestSchema,
  previewActivationRequestSchema,
  capturedBuildSchema,
} from '@platform/schema';
import {
  listPublishCaptures,
  readPublishCapture,
  captureSummary,
  PublishCaptureError,
  readPreviewDeployment,
  previewDeploymentSummary,
  readBuildDispatch,
} from '@platform/database';
import {
  createPrivateCapture,
  downloadPrivateCapture,
} from './publish-captures.ts';
import { requireRecentLogin } from './recent-login.ts';
import { hasFreshLogin } from './fresh-auth.ts';
import type { AdminEnvironment } from './index.ts';
import { requestCapturedBuild, capturedBuildStatus } from './build-dispatch.ts';
import { BuildServiceError, type GitHubFetch } from './github-builds.ts';
import {
  coordinatePreviewDeployment,
  reconcilePreviewDeployment,
} from './preview-coordinator.ts';
import { previewDeploymentProvider } from './preview-provider.ts';
import type { PreviewFetch } from './preview-cloudflare.ts';

export function createPublishingRoutes(
  freshLogin = hasFreshLogin,
  githubFetch: GitHubFetch = fetch,
  cloudflareFetch: PreviewFetch = fetch,
) {
  return new Hono<AdminEnvironment>()
    .get('/preview', async (c) =>
      c.json({
        current: await previewDeploymentProvider(
          c.env,
          githubFetch,
          cloudflareFetch,
        ).current(),
      }),
    )
    .get('/status', (c) =>
      c.json({
        available:
          publishingEnvSchema.safeParse(c.env).success &&
          previewActivationEnvSchema.safeParse(c.env).success,
        previewUrl: previewPolicy.origin,
      }),
    )
    .get('/captures/:id/candidate', async (c) => {
      const id = publishCaptureRequestSchema.shape.id.parse(c.req.param('id'));
      const capture = await readPublishCapture(c.env.CONTENT, id);
      if (!capture) throw new PublishCaptureError('Capture not found.', 404);
      const dispatch = await readBuildDispatch(c.env.CONTENT, id);
      if (
        capture.purpose !== 'preview' ||
        capture.status !== 'ready' ||
        capture.expiresAt <= new Date().toISOString() ||
        dispatch?.status !== 'queued' ||
        !dispatch.runId
      )
        throw new PublishCaptureError(
          'A ready preview and completed build are required.',
          409,
        );
      const provider = previewDeploymentProvider(
        c.env,
        githubFetch,
        cloudflareFetch,
      );
      if (!(await provider.buildSucceeded(id, dispatch.runId)))
        throw new PublishCaptureError(
          'The preview build has not succeeded yet.',
          409,
        );
      const descriptor = capturedBuildSchema
        .strip()
        .parse({ ...capture, schemaVersion: 1 });
      return c.json({ candidate: await provider.findCandidate(descriptor) });
    })
    .post('/captures/:id/preview', async (c) => {
      const request = previewActivationRequestSchema.parse(
        await boundedJson(c.req.raw, 1024),
      );
      const rejected = await requireRecentLogin(
        c,
        freshLogin,
        'Sign in again before activating a private preview.',
      );
      if (rejected) return rejected;
      const deployment = await coordinatePreviewDeployment(
        c.env.CONTENT,
        c.req.param('id'),
        request.versionId,
        c.get('actor'),
        previewDeploymentProvider(c.env, githubFetch, cloudflareFetch),
      );
      return c.json(
        { deployment },
        deployment.status === 'activating' || deployment.status === 'uncertain'
          ? 202
          : 200,
      );
    })
    .post('/captures/:id/preview/reconcile', async (c) => {
      z.object({})
        .strict()
        .parse(await boundedJson(c.req.raw, 1024));
      const rejected = await requireRecentLogin(
        c,
        freshLogin,
        'Sign in again before reconciling a preview deployment.',
      );
      if (rejected) return rejected;
      const deployment = await reconcilePreviewDeployment(
        c.env.CONTENT,
        c.req.param('id'),
        c.get('actor'),
        previewDeploymentProvider(c.env, githubFetch, cloudflareFetch),
      );
      return c.json(
        { deployment },
        deployment.status === 'activating' || deployment.status === 'uncertain'
          ? 202
          : 200,
      );
    })
    .get('/captures/:id/preview', async (c) => {
      const id = publishCaptureRequestSchema.shape.id.parse(c.req.param('id'));
      const row = await readPreviewDeployment(c.env.CONTENT, id);
      if (!row) return c.json({ error: 'Preview deployment not found.' }, 404);
      return c.json({ deployment: previewDeploymentSummary(row) });
    })
    .post('/captures/:id/build', async (c) => {
      z.object({})
        .strict()
        .parse(await boundedJson(c.req.raw, 1024));
      // Only the captured ID identifies the request; a caller cannot replace
      // its hash, destination, branch, workflow or payload with a request body.
      const rejected = await requireRecentLogin(
        c,
        freshLogin,
        'Sign in again before requesting a private build.',
      );
      if (rejected) return rejected;
      const dispatch = await requestCapturedBuild(
        c.env.CONTENT,
        c.env,
        c.req.param('id'),
        c.get('actor'),
        githubFetch,
      );
      return c.json(
        { dispatch },
        dispatch.status === 'queued' || dispatch.status === 'rejected'
          ? 200
          : 202,
      );
    })
    .get('/captures/:id/build', async (c) =>
      c.json(
        await capturedBuildStatus(
          c.env.CONTENT,
          c.env,
          c.req.param('id'),
          githubFetch,
        ),
      ),
    )
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
      if (error instanceof BuildServiceError)
        return c.json({ error: error.message }, 503);
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
            'Publishing is temporarily unavailable. Retry the same request.',
        },
        503,
      );
    });
}
