import { Hono } from 'hono';
import { z } from 'zod';
import { fileTypeFromBuffer } from 'file-type';
import { boundedBytes } from '@platform/config';
import {
  addMedia,
  mediaObject,
  EditorError,
  cleanMedia,
} from '@platform/database';
import {
  maxUploadBytes,
  mediaUploadSchema,
  mediaMimeSchema,
} from '@platform/schema';
import type { AdminEnvironment } from './index.ts';

export const mediaRoutes = new Hono<AdminEnvironment>()
  .get('/status', (c) =>
    c.json({ available: Boolean(c.env.MEDIA), maxBytes: maxUploadBytes }),
  )
  .post('/', async (c) => {
    if (!c.env.MEDIA)
      return c.json(
        {
          error:
            'Private media storage is not configured for this environment.',
        },
        503,
      );
    if (!c.req.header('content-type')?.startsWith('multipart/form-data;'))
      return c.json({ error: 'Choose a file to upload.' }, 400);
    await cleanMedia(c.env.CONTENT, c.env.MEDIA);
    const bytes = await boundedBytes(c.req.raw, maxUploadBytes + 4096);
    const form = await new Request('https://upload.invalid', {
      method: 'POST',
      headers: { 'Content-Type': c.req.header('content-type')! },
      body: bytes,
    }).formData();
    const input = mediaUploadSchema.parse(
      Object.fromEntries(
        ['revision', 'locale', 'altText'].map((key) => [key, form.get(key)]),
      ),
    );
    const file = form.get('file');
    if (
      !file ||
      typeof file === 'string' ||
      file.size === 0 ||
      file.size > maxUploadBytes
    )
      return c.json({ error: 'Use a file between 1 byte and 8 MiB.' }, 400);
    const data = new Uint8Array(await file.arrayBuffer());
    let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
    try {
      detected = await fileTypeFromBuffer(data);
    } catch {
      return c.json({ error: 'The file could not be recognized.' }, 400);
    }
    const mime = mediaMimeSchema.safeParse(detected?.mime);
    if (!mime.success)
      return c.json(
        {
          error:
            'Use a JPEG, PNG, WebP, AVIF or PDF. SVG and executable files are not accepted.',
        },
        400,
      );
    const key = `originals/${crypto.randomUUID()}.${detected?.ext}`;
    // Originals stay private. The public build must decode and re-encode image
    // derivatives; this Worker never serves an uploaded image inline.
    await c.env.MEDIA.put(key, data, {
      httpMetadata: { contentType: 'application/octet-stream' },
    });
    try {
      return c.json(
        await addMedia(
          c.env.CONTENT,
          { r2Key: key, contentType: mime.data, byteSize: data.length },
          { locale: input.locale, altText: input.altText },
          input.revision,
          c.get('actor'),
        ),
        201,
      );
    } catch (error) {
      await c.env.MEDIA.delete(key);
      throw error;
    }
  })
  .get('/:id/download', async (c) => {
    if (!c.env.MEDIA)
      return c.json({ error: 'Media storage unavailable' }, 503);
    const id = z.coerce.number().int().positive().parse(c.req.param('id'));
    const record = await mediaObject(c.env.CONTENT, id);
    if (!record) return c.json({ error: 'File not found' }, 404);
    const object = await c.env.MEDIA.get(record.r2Key);
    if (!object) return c.json({ error: 'File unavailable' }, 404);
    c.header('Content-Type', 'application/octet-stream');
    c.header(
      'Content-Disposition',
      `attachment; filename="media-${id}.${
        record.r2Key
          .split('.')
          .pop()
          ?.replace(/[^a-z0-9]/gu, '') ?? 'bin'
      }"`,
    );
    c.header('Content-Security-Policy', "default-src 'none'; sandbox");
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Cache-Control', 'no-store');
    return c.body(object.body);
  })
  .onError((error, c) => {
    if (error instanceof EditorError)
      return c.json({ error: error.message }, error.status);
    if (error.message === 'body-size')
      return c.json({ error: 'The upload exceeds 8 MiB.' }, 413);
    if (error instanceof z.ZodError || error instanceof TypeError)
      return c.json(
        { error: 'Check the upload and its alternative text.' },
        400,
      );
    return c.json({ error: 'The upload failed. Please retry.' }, 500);
  });
