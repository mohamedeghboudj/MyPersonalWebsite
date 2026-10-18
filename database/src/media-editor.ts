import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { media, mediaTranslations, mediaCleanup } from './media.ts';
import { auditStatements, execute, prepare, revisionGuard } from './editor.ts';
import type { Locale } from '@platform/schema';

export async function addMedia(
  binding: D1Database,
  object: {
    r2Key: string;
    contentType: typeof media.$inferInsert.contentType;
    byteSize: number;
  },
  translation: { locale: Locale; altText: string },
  expected: number,
  actor: string,
) {
  const random = new Uint32Array(1);
  crypto.getRandomValues(random);
  const id = (random[0] ?? 1) & 0x7fffffff || 1;
  const db = drizzle(binding);
  const record = { ...object, isPublic: false, translations: [translation] };
  await execute(binding, [
    revisionGuard(binding, expected),
    prepare(
      binding,
      db.insert(media).values({ id, ...object, isPublic: false }),
    ),
    prepare(
      binding,
      db.insert(mediaTranslations).values({ mediaId: id, ...translation }),
    ),
    ...(await auditStatements(
      binding,
      actor,
      'upload',
      'media',
      id,
      null,
      record,
    )),
  ]);
  return { id, revision: expected + 1 };
}
export async function mediaObject(binding: D1Database, id: number) {
  return drizzle(binding).select().from(media).where(eq(media.id, id)).get();
}
export async function cleanMedia(binding: D1Database, bucket: R2Bucket) {
  const db = drizzle(binding);
  const pending = await db.select().from(mediaCleanup).limit(10);
  for (const item of pending) {
    await bucket.delete(item.r2Key);
    await db.delete(mediaCleanup).where(eq(mediaCleanup.r2Key, item.r2Key));
  }
  return pending.length;
}
