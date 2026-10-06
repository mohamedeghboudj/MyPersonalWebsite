import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { getTableConfig, SQLiteTable } from 'drizzle-orm/sqlite-core';
import { is } from 'drizzle-orm';
import * as tables from '@platform/database';
import { contentKinds } from '@platform/schema';
import {
  applyTestMigration,
  localDatabase,
  migrateTestDatabase,
} from '../scripts/local-database';

let local: Awaited<ReturnType<typeof localDatabase>>;
beforeAll(async () => {
  local = await localDatabase();
  await migrateTestDatabase(local.content, local.inbox);
});
afterAll(async () => {
  await local?.runtime.dispose();
});

describe('foundation migration', () => {
  it('preserves a populated spike, including translations, CV selection, revision and audit', async () => {
    const old = await localDatabase();
    try {
      await applyTestMigration(
        old.content,
        'database/migrations/content/0001_spike.sql',
      );
      await applyTestMigration(
        old.content,
        'database/migrations/content/0002_cv_labels.sql',
      );
      await old.content.batch([
        old.content.prepare(
          "INSERT INTO content_items(id,kind) VALUES(7,'education')",
        ),
        old.content.prepare(
          "INSERT INTO education(id,start_date,is_visible) VALUES(7,'2020-01-01',1)",
        ),
        old.content.prepare(
          "INSERT INTO education_translations VALUES(7,'ar','جامعة','هندسة','وصف'),(7,'fr','École','Ingénieur','Description')",
        ),
        old.content.prepare('INSERT INTO cv_variant_items VALUES(1,7,3)'),
        old.content.prepare('UPDATE platform_state SET revision=42'),
        old.content.prepare(
          "INSERT INTO audit_log(actor,action,entity,created_at) VALUES('test-owner','save','education:7','2026-01-01T00:00:00Z')",
        ),
      ]);
      const before = await old.content
        .prepare(
          'SELECT id,start_date,end_date,school_url,display_order,is_visible FROM education',
        )
        .all();
      const translationsBefore = await old.content
        .prepare('SELECT * FROM education_translations ORDER BY locale')
        .all();
      const upgrade = (
        await readFile(
          'database/migrations/content/0003_foundation.sql',
          'utf8',
        )
      )
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('--'));
      await expect(
        old.content.batch([
          ...upgrade.map((statement) => old.content.prepare(statement)),
          old.content.prepare(
            'INSERT INTO deliberately_missing_table VALUES(1)',
          ),
        ]),
      ).rejects.toThrow();
      expect(
        (
          await old.content
            .prepare('SELECT * FROM education_translations ORDER BY locale')
            .all()
        ).results,
      ).toEqual(translationsBefore.results);
      await applyTestMigration(
        old.content,
        'database/migrations/content/0003_foundation.sql',
      );
      await applyTestMigration(
        old.content,
        'database/migrations/content/0004_identity_guards_indexes.sql',
      );
      const after = await tables.createSnapshot(old.content);
      expect(
        (
          await old.content
            .prepare(
              'SELECT id,start_date,end_date,school_url,display_order,is_visible FROM education',
            )
            .all()
        ).results,
      ).toEqual(before.results);
      expect(
        (
          await old.content
            .prepare(
              'SELECT education_id,locale,school,degree,description FROM education_translations ORDER BY locale',
            )
            .all()
        ).results,
      ).toEqual(translationsBefore.results);
      expect(after.revision).toBe(42);
      expect(after.publicVariant.items).toEqual([
        { contentItemId: 7, position: 3 },
      ]);
      expect(
        (await old.content.prepare('SELECT * FROM audit_log').all()).results,
      ).toHaveLength(1);
      expect(
        (await old.content.prepare('PRAGMA foreign_key_check').all()).results,
      ).toEqual([]);
      // A failed DDL migration must roll back copies, drops and new tables too.
      const statements = (
        await readFile('database/migrations/inbox/0002_foundation.sql', 'utf8')
      )
        .trim()
        .split(/\r?\n/u);
      await expect(
        old.content.batch([
          old.content.prepare('CREATE TABLE rollback_probe(id INTEGER)'),
          ...statements.map((statement) => old.content.prepare(statement)),
        ]),
      ).rejects.toThrow();
      expect(
        (
          await old.content
            .prepare(
              "SELECT name FROM sqlite_master WHERE name='rollback_probe'",
            )
            .all()
        ).results,
      ).toEqual([]);
    } finally {
      await old.runtime.dispose();
    }
  });

  it('constrains mixed CV selections and localized overrides to real identities', async () => {
    await local.content.batch([
      local.content.prepare(
        "INSERT INTO content_items(id,kind) VALUES(100,'skill'),(101,'project')",
      ),
      local.content.prepare('INSERT INTO skills(id) VALUES(100)'),
      local.content.prepare(
        "INSERT INTO skill_translations(skill_id,locale,name) VALUES(100,'fr','Conception')",
      ),
      local.content.prepare(
        "INSERT INTO projects(id,slug) VALUES(101,'test-project')",
      ),
      local.content.prepare(
        "INSERT INTO cv_variant_items(variant_id,content_item_id,section,position) VALUES(1,100,'skills',0),(1,101,'projects',1)",
      ),
      local.content.prepare(
        "INSERT INTO cv_variant_item_translations VALUES(1,101,'ar','تفاصيل المشروع')",
      ),
    ]);
    await expect(
      local.content
        .prepare(
          "INSERT INTO education(id,start_date) VALUES(100,'2020-01-01')",
        )
        .run(),
    ).rejects.toThrow('kind');
    await expect(
      local.content
        .prepare("UPDATE content_items SET kind='education' WHERE id=100")
        .run(),
    ).rejects.toThrow('immutable');
    await expect(
      local.content
        .prepare(
          "INSERT INTO cv_variant_item_translations VALUES(2,101,'en','Orphan')",
        )
        .run(),
    ).rejects.toThrow();
    await expect(
      local.content
        .prepare(
          "INSERT INTO skill_translations VALUES(100,'de','Invalid locale','')",
        )
        .run(),
    ).rejects.toThrow();
    await local.content.prepare('DELETE FROM content_items WHERE id=101').run();
    expect(
      (
        await local.content
          .prepare('SELECT * FROM cv_variant_item_translations')
          .all()
      ).results,
    ).toEqual([]);
    expect(
      (await local.content.prepare('PRAGMA foreign_key_check').all()).results,
    ).toEqual([]);
  });

  it('seeds six data-driven variants while keeping exactly one public CV', async () => {
    const variants = (
      await local.content
        .prepare('SELECT slug,is_public FROM cv_variants')
        .all()
    ).results;
    expect(variants).toHaveLength(6);
    expect(variants.filter((row) => row.is_public === 1)).toEqual([
      { slug: 'public', is_public: 1 },
    ]);
    await local.content
      .prepare("INSERT INTO cv_variants(slug) VALUES('sixth-specialism')")
      .run();
    await expect(
      local.content
        .prepare(
          "INSERT INTO cv_variants(slug,is_public) VALUES('second-public',1)",
        )
        .run(),
    ).rejects.toThrow();
    await expect(
      local.content.prepare('DELETE FROM cv_variants WHERE is_public=1').run(),
    ).rejects.toThrow();
    await expect(
      local.content
        .prepare('UPDATE cv_variants SET is_public=0 WHERE is_public=1')
        .run(),
    ).rejects.toThrow();
  });

  it('matches Drizzle columns and indexes every foreign key and locale lookup', async () => {
    const declared = Object.values(tables)
      .filter((value) => is(value, SQLiteTable))
      .map((table) => getTableConfig(table));
    const discovered: string[] = [];
    for (const database of [local.content, local.inbox]) {
      const names = (
        await database
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
          )
          .all<{ name: string }>()
      ).results;
      for (const { name } of names) {
        // Identifiers originate exclusively in the local migration schema, never a request.
        expect(name).toMatch(/^[a-z_]+$/u);
        discovered.push(name);
        const columns = (
          await database
            .prepare(`PRAGMA table_info("${name}")`)
            .all<{ name: string; pk: number }>()
        ).results;
        const definition = declared.find((table) => table.name === name);
        expect(definition, name).toBeDefined();
        expect(
          definition?.columns.map((column) => column.name).sort(),
          name,
        ).toEqual(columns.map((column) => column.name).sort());
        const indexes = (
          await database
            .prepare(`PRAGMA index_list("${name}")`)
            .all<{ name: string }>()
        ).results;
        const ordered = await Promise.all(
          indexes.map(async (item) =>
            (
              await database
                .prepare(`PRAGMA index_info("${item.name}")`)
                .all<{ name: string }>()
            ).results.map((c) => c.name),
          ),
        );
        ordered.push(
          columns
            .filter((c) => c.pk > 0)
            .sort((a, b) => a.pk - b.pk)
            .map((c) => c.name),
        );
        const foreignKeys = (
          await database
            .prepare(`PRAGMA foreign_key_list("${name}")`)
            .all<{ id: number; seq: number; from: string }>()
        ).results;
        for (const id of new Set(foreignKeys.map((key) => key.id))) {
          const keyColumns = foreignKeys
            .filter((key) => key.id === id)
            .sort((a, b) => a.seq - b.seq)
            .map((key) => key.from);
          expect(
            ordered.some((index) =>
              keyColumns.every((column, i) => index[i] === column),
            ),
            `${name}: ${keyColumns.join(',')}`,
          ).toBe(true);
        }
        if (columns.some((c) => c.name === 'locale'))
          expect(
            ordered.some((index) => index[0] === 'locale'),
            `${name}: locale lookup`,
          ).toBe(true);
      }
    }
    expect(discovered.sort()).toEqual(
      declared.map((table) => table.name).sort(),
    );
    const sql =
      (
        await local.content
          .prepare("SELECT sql FROM sqlite_master WHERE name='content_items'")
          .first<{ sql: string }>()
      )?.sql ?? '';
    for (const kind of contentKinds) expect(sql).toContain(`'${kind}'`);
  });
});
