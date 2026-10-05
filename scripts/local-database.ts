import { convertV4MiniflareOptions, Miniflare } from 'miniflare';
import { readFile } from 'node:fs/promises';

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
      ...(persist ? { resourcePersistencePath: '.wrangler/state/v3' } : {}),
      telemetry: { enabled: false },
    }),
  );
  const content = await runtime.getD1Database('CONTENT');
  const inbox = await runtime.getD1Database('INBOX');
  // Miniflare's bundled D1 type and workers-types describe the same runtime API.
  // Adapt the external package boundary once, without weakening application types.
  return {
    runtime,
    content: content as unknown as D1Database,
    inbox: inbox as unknown as D1Database,
  };
}
export async function migrateTestDatabase(
  content: D1Database,
  inbox: D1Database,
) {
  await content.exec(
    await readFile('database/migrations/content/0001_spike.sql', 'utf8'),
  );
  await inbox.exec(
    await readFile('database/migrations/inbox/0001_spike.sql', 'utf8'),
  );
}
