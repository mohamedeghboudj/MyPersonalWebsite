import {
  previewEnvSchema,
  previewPolicy,
  verifyAccess,
  type VerifyAccess,
  securityHeaders,
  publicDocumentHeaders,
  publicAttachmentHeaders,
} from '@platform/config';
import { previewReleaseSchema, type PreviewRelease } from '@platform/schema';

type Bindings = { ASSETS?: Fetcher } & Record<string, unknown>;
const privateHeaders = {
  ...securityHeaders,
  'X-Robots-Tag': 'noindex, nofollow',
  Vary: 'Cookie, Cf-Access-Jwt-Assertion',
};
const error = (status: number, message: string) =>
  new Response(message, { status, headers: privateHeaders });
export function createPreview(verify: VerifyAccess = verifyAccess) {
  return {
    async fetch(request: Request, env: Bindings): Promise<Response> {
      const config = previewEnvSchema.safeParse(env);
      if (!config.success)
        return error(503, 'Preview configuration incomplete.');
      const token = request.headers.get('Cf-Access-Jwt-Assertion');
      if (!token) return error(401, 'Authentication required.');
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
          return error(403, 'Forbidden.');
      } catch {
        return error(401, 'Invalid authentication.');
      }
      if (!['GET', 'HEAD'].includes(request.method))
        return error(405, 'Method not allowed.');
      const url = new URL(request.url);
      if (
        config.data.APP_ENV === 'preview' &&
        url.origin !== previewPolicy.origin
      )
        return error(404, 'Not found.');
      let release: PreviewRelease | null;
      try {
        release =
          config.data.PREVIEW_RELEASE === previewPolicy.bootstrap
            ? null
            : previewReleaseSchema.parse(
                JSON.parse(config.data.PREVIEW_RELEASE),
              );
      } catch {
        return error(503, 'Preview release unavailable.');
      }
      if (url.pathname === '/_build/status')
        return new Response(
          request.method === 'HEAD'
            ? null
            : JSON.stringify({ ready: release !== null, release }),
          {
            headers: { ...privateHeaders, 'Content-Type': 'application/json' },
          },
        );
      if (!release || !env.ASSETS)
        return error(503, 'No preview has been deployed yet.');
      if (url.pathname.startsWith('/_build/')) return error(404, 'Not found.');
      try {
        const forwarded = new Headers();
        // Never forward the Access credential or owner cookie to asset storage.
        for (const name of [
          'Range',
          'If-None-Match',
          'If-Modified-Since',
          'Accept',
        ]) {
          const value = request.headers.get(name);
          if (value) forwarded.set(name, value);
        }
        const asset = await env.ASSETS.fetch(
          new Request(request.url, {
            method: request.method,
            headers: forwarded,
            redirect: 'manual',
          }),
        );
        const headers = new Headers(asset.headers);
        const location = headers.get('Location');
        if (location && new URL(location, url).origin !== url.origin) {
          await asset.body?.cancel();
          return error(502, 'Invalid preview response.');
        }
        for (const [name, value] of Object.entries({
          ...publicDocumentHeaders,
          ...privateHeaders,
          'Content-Security-Policy':
            publicDocumentHeaders['Content-Security-Policy'],
        }))
          headers.set(name, value);
        headers.delete('Set-Cookie');
        if (/^\/(cv|documents)\/.*\.pdf$/u.test(url.pathname))
          for (const [name, value] of Object.entries(publicAttachmentHeaders))
            headers.set(name, value);
        return new Response(request.method === 'HEAD' ? null : asset.body, {
          status: asset.status,
          headers,
        });
      } catch {
        return error(503, 'Preview assets unavailable.');
      }
    },
  };
}
export default createPreview();
