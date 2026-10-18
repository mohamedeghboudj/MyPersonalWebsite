import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { readFile, readdir } from 'node:fs/promises';

export async function localDatabase(persist = false) {
  const runtime = new Miniflare(
    convertV4MiniflareOptions({
      modules: true,
      script:
        'export default { fetch() { return new Response("local database harness"); } }',
      compatibilityDate: '2026-10-01',
      d1Databases: {
        CONTENT: '00000000-0000-0000-0000-000000000001',
        INBOX: '00000000-0000-0000-0000-000000000002',
      },
      r2Buckets: ['MEDIA'],
      ...(persist ? { resourcePersistencePath: '.wrangler/state/v3' } : {}),
      telemetry: { enabled: false },
    }),
  );
  const content = await runtime.getD1Database('CONTENT');
  const inbox = await runtime.getD1Database('INBOX');
  const media = await runtime.getR2Bucket('MEDIA');
  // Miniflare's bundled D1 type and workers-types describe the same runtime API.
  // Adapt the external package boundary once, without weakening application types.
  return {
    runtime,
    content: content as unknown as D1Database,
    inbox: inbox as unknown as D1Database,
    media: media as unknown as R2Bucket,
  };
}
export async function migrateTestDatabase(
  content: D1Database,
  inbox: D1Database,
) {
  for (const name of (await readdir('database/migrations/content'))
    .filter((name) => name.endsWith('.sql'))
    .sort())
    await applyTestMigration(content, `database/migrations/content/${name}`);
  for (const name of (await readdir('database/migrations/inbox'))
    .filter((name) => name.endsWith('.sql'))
    .sort())
    await applyTestMigration(inbox, `database/migrations/inbox/${name}`);
}

// Checked-in migrations use one complete statement per line, including triggers.
// batch mirrors Wrangler's per-migration transaction, including DDL rollback.
export async function applyTestMigration(database: D1Database, path: string) {
  const statements = (await readFile(path, 'utf8'))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('--'));
  await database.batch(
    statements.map((statement) => database.prepare(statement)),
  );
}
