import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import {
  capturePublishInput,
  capturePublicSnapshot,
  media,
  mediaTranslations,
  profile,
} from '@platform/database';
import { publishInputSchema, type PublishInput } from '@platform/schema';
import { localDatabase, migrateTestDatabase } from '../scripts/local-database';
import {
  sealPublishInput,
  verifyPublishInput,
  materializePublishInput,
  maxPublishInputBytes,
} from '../scripts/publish-input';
import { prepareStaticMedia } from '../scripts/static-media';

let local: Awaited<ReturnType<typeof localDatabase>>;
let input: PublishInput;
let original: Buffer;
const hash = (value: Uint8Array) =>
  createHash('sha256').update(value).digest('hex');
beforeAll(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
  original = await sharp({
    create: { width: 32, height: 24, channels: 3, background: '#23443a' },
  })
    .png()
    .toBuffer();
  const db = drizzle(local.content);
  await db.insert(media).values(
    [1, 2, 3, 4].map((id) => ({
      id,
      r2Key: `originals/PRIVATE-STORAGE-KEY-${id}.png`,
      byteSize: original.length,
      contentType: 'image/png' as const,
      isPublic: id !== 2,
    })),
  );
  await db.insert(mediaTranslations).values(
    [1, 2, 3, 4].map((mediaId) => ({
      mediaId,
      locale: 'en' as const,
      altText: 'Synthetic illustration',
    })),
  );
  await db.update(profile).set({ portraitMediaId: 1 });
  // A private certificate's original remains ineligible even if marked public.
  await local.content.batch([
    local.content.prepare(
      "INSERT INTO content_items(id,kind) VALUES(900,'certificate')",
    ),
    local.content.prepare(
      'INSERT INTO certificates(id,original_media_id,is_visible) VALUES(900,3,0)',
    ),
  ]);
  for (const id of [1, 2, 3, 4])
    await local.media.put(`originals/PRIVATE-STORAGE-KEY-${id}.png`, original);
  input = await capturePublishInput(local.content);
});
afterAll(async () => {
  await local?.runtime.dispose();
});
async function destination() {
  await mkdir('artifacts/publish-input-tests', { recursive: true });
  return resolve(
    await mkdtemp(resolve('artifacts/publish-input-tests/run-')),
    'input',
  );
}

describe('private publish input', () => {
  it('captures only used eligible keys and keeps them outside the public schema', async () => {
    expect(input.mediaSources).toEqual([
      { id: 1, r2Key: 'originals/PRIVATE-STORAGE-KEY-1.png' },
    ]);
    expect(input.snapshot.media.map((item) => item.id)).toEqual([1]);
    expect(JSON.stringify(input.snapshot)).not.toMatch(
      /PRIVATE-STORAGE|r2Key|originalMediaId/,
    );
    expect(
      JSON.stringify(await capturePublicSnapshot(local.content)),
    ).not.toContain('PRIVATE-STORAGE');
  });

  it('reads content, revision and keys in one bounded transaction even when an edit immediately follows it', async () => {
    const counts: number[] = [];
    const binding = new Proxy(local.content, {
      get(target, property) {
        if (property === 'batch')
          return async (statements: D1PreparedStatement[]) => {
            counts.push(statements.length);
            const results = await target.batch(statements);
            // A later edit changes the image and the old object's mapping. No
            // follow-up read may mix those new values into the captured revision.
            await target.batch([
              target.prepare(
                'UPDATE profile SET portrait_media_id=4 WHERE id=1',
              ),
              target.prepare(
                "UPDATE media SET r2_key='NEW-MAPPING' WHERE id=1",
              ),
              target.prepare(
                'UPDATE platform_state SET revision=revision+1 WHERE id=1',
              ),
            ]);
            return results;
          };
        const value = Reflect.get(target, property);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    try {
      const captured = await capturePublishInput(binding);
      expect(counts).toHaveLength(1);
      expect(counts[0]).toBeLessThanOrEqual(45);
      expect(captured.snapshot.revision).toBe(input.snapshot.revision);
      expect(captured.snapshot.profile.portraitMediaId).toBe(1);
      expect(captured.mediaSources).toEqual(input.mediaSources);
    } finally {
      await drizzle(local.content).update(profile).set({ portraitMediaId: 1 });
      await drizzle(local.content)
        .update(media)
        .set({ r2Key: input.mediaSources[0]!.r2Key })
        .where(eq(media.id, 1));
    }
  });

  it('rejects missing, extra, duplicate or ambiguous source mappings', () => {
    const source = input.mediaSources[0]!;
    for (const mediaSources of [
      [],
      [source, source],
      [{ ...source, id: 99 }],
      [source, { id: 99, r2Key: 'private' }],
    ])
      expect(
        publishInputSchema.safeParse({ ...input, mediaSources }).success,
      ).toBe(false);
    expect(publishInputSchema.safeParse({ ...input, inbox: [] }).success).toBe(
      false,
    );
    expect(
      publishInputSchema.safeParse({
        ...input,
        mediaSources: [{ ...source, secret: 'private' }],
      }).success,
    ).toBe(false);
  });

  it('verifies the trusted digest before reading storage and materializes only the captured media', async () => {
    const sealed = sealPublishInput(input);
    const reads: string[] = [];
    const directory = await destination();
    const prepared = await materializePublishInput(
      sealed.body,
      sealed.sha256,
      async (key) => {
        reads.push(key);
        return (await local.media.get(key))?.body ?? null;
      },
      directory,
    );
    expect(reads).toEqual([input.mediaSources[0]!.r2Key]);
    expect(prepared.media).toEqual([
      { id: 1, sha256: hash(original), byteSize: original.length },
    ]);
    const snapshot = await readFile(prepared.snapshotPath);
    expect(hash(snapshot)).toBe(prepared.snapshotSha256);
    const snapshotText = new TextDecoder().decode(snapshot);
    expect(JSON.parse(snapshotText)).toEqual(input.snapshot);
    expect(snapshotText).not.toContain('PRIVATE-STORAGE');
    expect(await readdir(prepared.mediaSourceDirectory)).toEqual(['1.bin']);
    expect(
      await readFile(resolve(prepared.mediaSourceDirectory, '1.bin')),
    ).toEqual(original);
    expect(
      await readFile(resolve(directory, 'prepared.json'), 'utf8'),
    ).not.toContain('PRIVATE-STORAGE');
    const encoded = await prepareStaticMedia(
      input.snapshot,
      prepared.mediaSourceDirectory,
      resolve(directory, 'derivatives'),
    );
    expect(Object.keys(encoded.images)).toEqual(['1']);
    expect(Object.keys(encoded.documents)).toEqual([]);
    await expect(
      materializePublishInput(
        sealed.body,
        sealed.sha256,
        async () => {
          throw new Error('Must not read on directory reuse');
        },
        directory,
      ),
    ).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('rejects tampering, invalid digests and oversized envelopes before filesystem or R2 access', async () => {
    const sealed = sealPublishInput(input);
    const tampered = Buffer.from(sealed.body);
    tampered[0] = 32;
    expect(() => verifyPublishInput(tampered, sealed.sha256)).toThrow(
      'integrity',
    );
    expect(() => verifyPublishInput(sealed.body, 'not-a-hash')).toThrow(
      'integrity',
    );
    expect(() =>
      verifyPublishInput(Buffer.alloc(maxPublishInputBytes + 1), sealed.sha256),
    ).toThrow('integrity');
    const directory = await destination();
    await expect(
      materializePublishInput(
        tampered,
        sealed.sha256,
        async () => {
          throw new Error('Must not fetch');
        },
        directory,
      ),
    ).rejects.toThrow('integrity');
    await expect(readdir(directory)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('leaves no completion marker when an original is deleted, truncated or exceeds its captured size', async () => {
    const sealed = sealPublishInput(input);
    for (const data of [
      null,
      original.subarray(0, 3),
      Buffer.concat([original, Buffer.from('extra')]),
    ]) {
      const directory = await destination();
      await expect(
        materializePublishInput(
          sealed.body,
          sealed.sha256,
          async () => (data ? new Response(data).body : null),
          directory,
        ),
      ).rejects.toThrow();
      await expect(
        readFile(resolve(directory, 'prepared.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
      await expect(
        readFile(resolve(directory, 'snapshot.json')),
      ).rejects.toMatchObject({ code: 'ENOENT' });
    }
  });
});
