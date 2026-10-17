import { AwsClient } from 'aws4fetch';
import { publishStorageEnvSchema } from '@platform/config';

export function privateR2Reader(
  raw: unknown,
  fetcher: (request: Request) => Promise<Response> = fetch,
) {
  const config = publishStorageEnvSchema.parse(raw);
  const client = new AwsClient({
    accessKeyId: config.PUBLISH_R2_ACCESS_KEY_ID,
    secretAccessKey: config.PUBLISH_R2_SECRET_ACCESS_KEY,
    service: 's3',
    region: 'auto',
    retries: 0,
  });
  return async (
    key: string,
    maxBytes: number,
  ): Promise<ReadableStream<Uint8Array> | null> => {
    const segments = key.split('/');
    if (
      !Number.isSafeInteger(maxBytes) ||
      maxBytes < 1 ||
      maxBytes > 8 * 1024 * 1024 ||
      key.length > 1024 ||
      /[\u0000-\u001f\u007f\\]/u.test(key) ||
      !['originals', 'publish-inputs'].includes(segments[0] ?? '') ||
      segments.some((part) => !part || part === '.' || part === '..')
    )
      throw new Error('Invalid private storage request');
    const encoded = segments
      .map((part) =>
        encodeURIComponent(part).replace(
          /[!'()*]/gu,
          (character) =>
            `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
        ),
      )
      .join('/');
    const url = `https://${config.PUBLISH_R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${config.PUBLISH_R2_BUCKET}/${encoded}`;
    const signed = await client.sign(url, {
      method: 'GET',
      redirect: 'manual',
      signal: AbortSignal.timeout(30000),
    });
    const response = await fetcher(signed);
    if (response.status === 404) {
      await response.body?.cancel();
      return null;
    }
    if (
      response.status !== 200 ||
      !response.body ||
      Number(response.headers.get('Content-Length')) > maxBytes
    ) {
      await response.body?.cancel();
      throw new Error('Private storage read failed');
    }
    return response.body;
  };
}
