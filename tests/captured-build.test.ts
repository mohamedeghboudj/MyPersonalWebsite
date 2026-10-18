import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import { capturePublishInput } from '@platform/database';
import {
  capturedBuildSchema,
  type CapturedBuild,
  type PublishInput,
} from '@platform/schema';
import { sha256, publishCapturePolicy } from '@platform/config';
import { sealPublishInput } from '../scripts/publish-input';
import {
  fetchCapturedInput,
  readCapturedInput,
} from '../scripts/captured-input';
import { privateR2Reader } from '../scripts/private-r2';
import {
  privateBuildEnvironment,
  privateNodeStage,
} from '../scripts/private-build';

const now = new Date('2026-10-15T10:00:00Z');
const original = Buffer.from('synthetic-original');
const sourceKey = `originals/${crypto.randomUUID()}.png`;
let local: Awaited<ReturnType<typeof localDatabase>>;
let input: PublishInput;
let capture: CapturedBuild;
let sealed: ReturnType<typeof sealPublishInput>;
beforeAll(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
  input = await capturePublishInput(local.content);
  input.snapshot.generatedAt = now.toISOString();
  input.snapshot.media = [
    {
      id: 1,
      contentType: 'image/png',
      byteSize: original.length,
      width: 1,
      height: 1,
      translations: [{ locale: 'en', altText: 'Synthetic original' }],
    },
  ];
  input.snapshot.profile.portraitMediaId = 1;
  input.mediaSources = [{ id: 1, r2Key: sourceKey }];
  sealed = sealPublishInput(input);
  capture = capturedBuildSchema.parse({
    schemaVersion: 1,
    id: crypto.randomUUID(),
    purpose: 'preview',
    sequence: 1,
    revision: input.snapshot.revision,
    inputSha256: sealed.sha256,
    snapshotSha256: await sha256(JSON.stringify(input.snapshot)),
    byteSize: sealed.body.length,
    createdAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + publishCapturePolicy.retentionMs,
    ).toISOString(),
  });
});
afterAll(async () => local?.runtime.dispose());
async function directory() {
  await mkdir('artifacts/captured-build-tests', { recursive: true });
  return resolve(await mkdtemp('artifacts/captured-build-tests/run-'), 'input');
}
const reader = async (key: string) =>
  new Response(key.startsWith('publish-inputs/') ? sealed.body : original).body;

describe('private captured build retrieval', () => {
  it('binds retrieved inputs and originals to trusted metadata and detects local tampering', async () => {
    const destination = await directory();
    const keys: string[] = [];
    await fetchCapturedInput(
      capture,
      async (key) => {
        keys.push(key);
        return reader(key);
      },
      destination,
      () => now,
    );
    expect(keys).toEqual([`publish-inputs/${capture.id}.json`, sourceKey]);
    expect(await readCapturedInput(destination, now)).toEqual(capture);
    expect(
      await readFile(resolve(destination, 'capture.json'), 'utf8'),
    ).not.toMatch(/mediaSources|originals|profile/);
    await writeFile(
      resolve(destination, 'media/1.bin'),
      Buffer.alloc(original.length),
    );
    await expect(readCapturedInput(destination, now)).rejects.toThrow(
      'changed after retrieval',
    );
  });

  it('rejects expired, future, extended or oversized dispatches before reading storage', async () => {
    for (const invalid of [
      { ...capture, expiresAt: now.toISOString() },
      { ...capture, createdAt: new Date(now.getTime() + 120000).toISOString() },
      {
        ...capture,
        expiresAt: new Date(
          now.getTime() + 2 * publishCapturePolicy.retentionMs,
        ).toISOString(),
      },
      { ...capture, byteSize: publishCapturePolicy.maxInputBytes + 1 },
    ]) {
      let calls = 0;
      await expect(
        fetchCapturedInput(
          invalid,
          async () => {
            calls++;
            return reader('');
          },
          await directory(),
          () => now,
        ),
      ).rejects.toThrow();
      expect(calls).toBe(0);
    }
  });

  it('rejects tampered hashes, revisions, snapshot timestamps and byte counts before original reads', async () => {
    for (const invalid of [
      { ...capture, inputSha256: '0'.repeat(64) },
      { ...capture, snapshotSha256: '0'.repeat(64) },
      { ...capture, revision: capture.revision + 1 },
      { ...capture, byteSize: capture.byteSize + 1 },
      {
        ...capture,
        createdAt: new Date(now.getTime() - 1000).toISOString(),
        expiresAt: new Date(Date.parse(capture.expiresAt) - 1000).toISOString(),
      },
    ]) {
      const keys: string[] = [];
      const destination = await directory();
      await expect(
        fetchCapturedInput(
          invalid,
          async (key) => {
            keys.push(key);
            return reader(key);
          },
          destination,
          () => now,
        ),
      ).rejects.toThrow();
      expect(keys).toEqual([`publish-inputs/${capture.id}.json`]);
      await expect(
        readFile(resolve(destination, 'capture.json')),
      ).rejects.toThrow();
    }
  });

  it('does not leave a buildable marker after a missing original or expiry during retrieval', async () => {
    for (const missing of [true, false]) {
      const destination = await directory();
      let time = now;
      await expect(
        fetchCapturedInput(
          capture,
          async (key) => {
            if (key === sourceKey) {
              if (missing) return null;
              time = new Date(Date.parse(capture.expiresAt));
            }
            return reader(key);
          },
          destination,
          () => time,
        ),
      ).rejects.toThrow();
      await expect(readCapturedInput(destination, now)).rejects.toThrow();
    }
  });
});

describe('R2 read-only transport and private diagnostics', () => {
  const storage = {
    PUBLISH_R2_ACCOUNT_ID: 'a'.repeat(32),
    PUBLISH_R2_BUCKET: 'mohamedeghboudj-media-preview',
    PUBLISH_R2_ACCESS_KEY_ID: 'synthetic-access-key',
    PUBLISH_R2_SECRET_ACCESS_KEY: 'synthetic-secret-key',
  };
  it('signs a GET to the fixed account and bucket without URL credentials or redirects', async () => {
    const requests: Request[] = [];
    const get = privateR2Reader(storage, async (request) => {
      requests.push(request);
      return new Response('test');
    });
    expect(
      await new Response(await get('originals/a b+?%#.png', 4)).text(),
    ).toBe('test');
    expect(requests).toHaveLength(1);
    const request = requests[0]!;
    const url = new URL(request.url);
    expect(url.hostname).toBe(`${'a'.repeat(32)}.r2.cloudflarestorage.com`);
    expect(decodeURIComponent(url.pathname)).toBe(
      '/mohamedeghboudj-media-preview/originals/a b+?%#.png',
    );
    expect(url.search).toBe('');
    expect(request.method).toBe('GET');
    expect(request.redirect).toBe('manual');
    expect(request.headers.get('Authorization')).toMatch(
      /^AWS4-HMAC-SHA256 Credential=synthetic-access-key\//u,
    );
    expect(request.url).not.toMatch(/synthetic-access|synthetic-secret/);
  });

  it('rejects traversal, arbitrary prefixes, redirects, denied reads and oversized responses', async () => {
    let calls = 0;
    const get = privateR2Reader(storage, async () => {
      calls++;
      return new Response('test');
    });
    for (const key of [
      '../other',
      'originals/../private',
      'originals/./a',
      'originals\\private',
      'other-bucket/file',
      '/originals/file',
      'originals//file',
    ])
      await expect(get(key, 4)).rejects.toThrow('Invalid');
    expect(calls).toBe(0);
    for (const response of [
      new Response(null, {
        status: 302,
        headers: { Location: 'https://untrusted.example' },
      }),
      new Response('private error', { status: 403 }),
      new Response('test', { headers: { 'Content-Length': '10' } }),
    ])
      await expect(
        privateR2Reader(storage, async () => response)(sourceKey, 4),
      ).rejects.toThrow('Private storage read failed');
    expect(
      await privateR2Reader(
        storage,
        async () => new Response(null, { status: 404 }),
      )(sourceKey, 4),
    ).toBeNull();
  });

  it('excludes credentials and Node hooks from child processes and keeps diagnostic text private', async () => {
    const env = privateBuildEnvironment({
      ...process.env,
      PUBLISH_R2_SECRET_ACCESS_KEY: 'synthetic-hidden-secret',
      CLOUDFLARE_API_TOKEN: 'synthetic-hidden-token',
      PUBLISH_CLOUDFLARE_API_TOKEN: 'synthetic-public-token',
      PUBLISH_GITHUB_TOKEN: 'synthetic-github-token',
      DIAGNOSTICS_R2_ACCESS_KEY_ID: 'synthetic-report-access',
      DIAGNOSTICS_R2_SECRET_ACCESS_KEY: 'synthetic-report-secret',
      NODE_OPTIONS: '--expose-gc',
    });
    expect(env).not.toHaveProperty('PUBLISH_R2_SECRET_ACCESS_KEY');
    expect(env).not.toHaveProperty('CLOUDFLARE_API_TOKEN');
    expect(env).not.toHaveProperty('PUBLISH_CLOUDFLARE_API_TOKEN');
    expect(env).not.toHaveProperty('PUBLISH_GITHUB_TOKEN');
    expect(env).not.toHaveProperty('DIAGNOSTICS_R2_ACCESS_KEY_ID');
    expect(env).not.toHaveProperty('DIAGNOSTICS_R2_SECRET_ACCESS_KEY');
    expect(env).not.toHaveProperty('NODE_OPTIONS');
    const logs = await directory();
    await expect(
      privateNodeStage(
        'synthetic-failure',
        [
          '--eval',
          'process.stdout.write("UNPUBLISHED-STDOUT"); process.stderr.write("UNPUBLISHED-STDERR"); process.exitCode=1;',
        ],
        env,
        logs,
      ),
    ).rejects.toThrow('Private build stage failed: synthetic-failure');
    expect(
      await readFile(resolve(logs, 'synthetic-failure.log'), 'utf8'),
    ).toContain('UNPUBLISHED-STDOUT');
    expect(
      await readFile(resolve(logs, 'synthetic-failure.log'), 'utf8'),
    ).toContain('UNPUBLISHED-STDERR');
    await privateNodeStage(
      'synthetic-success',
      [
        '--eval',
        'if (process.env.PUBLISH_CLOUDFLARE_API_TOKEN || process.env.PUBLISH_GITHUB_TOKEN || process.env.PUBLISH_R2_SECRET_ACCESS_KEY || process.env.CLOUDFLARE_API_TOKEN || process.env.DIAGNOSTICS_R2_ACCESS_KEY_ID || process.env.DIAGNOSTICS_R2_SECRET_ACCESS_KEY || process.env.NODE_OPTIONS) process.exit(1);',
      ],
      env,
      logs,
    );
  });
});
