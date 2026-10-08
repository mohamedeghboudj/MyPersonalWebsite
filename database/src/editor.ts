import { asc, and, eq, ne, getTableColumns, inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/d1';
import { type SQLiteTable, type SQLiteColumn } from 'drizzle-orm/sqlite-core';
import {
  editorModules,
  editorRegistry,
  type EditorModule,
  type EditorGroup,
  type EditorRecord,
  editorLocales,
} from '@platform/schema';
import * as core from './tables.ts';
import * as foundation from './foundation-tables.ts';
import * as details from './content-details.ts';
import * as mediaTables from './media.ts';

const tables: Record<string, SQLiteTable> = {
  ...core,
  ...foundation,
  ...details,
  ...mediaTables,
};
const table = (name: string) => {
  const found = tables[name];
  if (!found) throw new Error('Unknown registry table');
  return found;
};
const columns = (value: SQLiteTable) =>
  getTableColumns(value) as Record<string, SQLiteColumn>;
const column = (value: SQLiteTable, key: string) => {
  const found = columns(value)[key];
  if (!found) throw new Error('Unknown registry column');
  return found;
};
const selectFields = (record: EditorRecord, fields: EditorModule['fields']) =>
  Object.fromEntries(fields.map((field) => [field.key, record[field.key]]));
const freshId = () => {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return (value[0] ?? 1) & 0x7fffffff || 1;
};
const object = (value: unknown): EditorRecord => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected a record');
  return value as EditorRecord;
};
const localeOrder = (a: EditorRecord, b: EditorRecord) =>
  editorLocales.indexOf(a.locale as (typeof editorLocales)[number]) -
  editorLocales.indexOf(b.locale as (typeof editorLocales)[number]);
const rows = (value: unknown): EditorRecord[] => {
  if (!Array.isArray(value)) throw new Error('Expected records');
  return value.map(object);
};
export class EditorError extends Error {
  readonly status: 400 | 404 | 409 | 413;
  constructor(message: string, status: 400 | 404 | 409 | 413 = 400) {
    super(message);
    this.status = status;
  }
}
export function editorModule(key: string) {
  const module = editorRegistry.get(key);
  if (!module) throw new EditorError('Unknown content type', 404);
  return module;
}
async function hash(value: unknown) {
  const result = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(JSON.stringify(value)),
  );
  return Array.from(new Uint8Array(result), (x) =>
    x.toString(16).padStart(2, '0'),
  ).join('');
}
function label(
  module: EditorModule,
  base: EditorRecord,
  translations: EditorRecord[],
) {
  const localized =
    translations.find((row) => row.locale === 'en') ?? translations[0];
  return String(
    base[module.titleField] ??
      localized?.[module.titleField] ??
      `${module.label} ${base.id}`,
  );
}
async function revision(binding: D1Database) {
  const row = await drizzle(binding)
    .select()
    .from(core.state)
    .where(eq(core.state.id, 1))
    .get();
  if (!row) throw new Error('Content state missing');
  return row.revision;
}

export async function listEditor(binding: D1Database, key: string, page = 0) {
  const module = editorModule(key);
  const db = drizzle(binding);
  const base = table(module.table);
  const result = await db
    .select()
    .from(base)
    .orderBy(asc(column(base, 'id')))
    .limit(51)
    .offset(page * 50)
    .all();
  const selected = result.slice(0, 50);
  const translations =
    module.translationTable && selected.length
      ? await db
          .select()
          .from(table(module.translationTable))
          .where(
            inArray(
              column(
                table(module.translationTable),
                module.translationKey ?? '',
              ),
              selected.map((row) => Number(row.id)),
            ),
          )
          .all()
      : [];
  return {
    items: selected.map((row) => {
      const translated = translations.filter(
        (t) => t[module.translationKey ?? ''] === row.id,
      );
      return {
        id: Number(row.id),
        label: label(module, row, translated),
        locales: translated.map((t) => String(t.locale)),
        visible: typeof row.isVisible === 'boolean' ? row.isVisible : null,
        locked: Boolean(
          module.singleton || (key === 'cvVariants' && row.isPublic),
        ),
      };
    }),
    hasMore: result.length > 50,
    page,
  };
}
async function readGroups(
  binding: D1Database,
  groups: readonly EditorGroup[],
  parentId: number,
): Promise<EditorRecord> {
  const db = drizzle(binding);
  const result: EditorRecord = {};
  // One query per relation level, never one query per base-list item.
  for (const group of groups) {
    const base = table(group.table);
    const order =
      columns(base).position ??
      columns(base).displayOrder ??
      columns(base).id ??
      column(base, group.fields[0]?.key ?? '');
    const records = await db
      .select()
      .from(base)
      .where(eq(column(base, group.foreignKey), parentId))
      .orderBy(asc(order))
      .all();
    const translated =
      group.translationTable && records.length
        ? await db
            .select()
            .from(table(group.translationTable))
            .where(
              group.translationKeys?.length === 1
                ? inArray(
                    column(
                      table(group.translationTable),
                      group.translationKeys[0] ?? '',
                    ),
                    records.map((row) => Number(row.id)),
                  )
                : eq(
                    column(table(group.translationTable), group.foreignKey),
                    parentId,
                  ),
            )
            .all()
        : [];
    result[group.key] = records.map((record) => {
      const value = selectFields(record, group.fields);
      if (group.translated)
        value.translations = translated
          .sort(localeOrder)
          .filter((row) =>
            group.translationKeys?.length === 1
              ? row[group.translationKeys[0] ?? ''] === record.id
              : group.translationKeys?.every((key) => row[key] === record[key]),
          )
          .map((row) => ({
            locale: row.locale,
            ...selectFields(row, group.translated ?? []),
          }));
      return value;
    });
  }
  return result;
}
export async function readEditor(binding: D1Database, key: string, id: number) {
  const module = editorModule(key);
  const db = drizzle(binding);
  const base = table(module.table);
  const before = await revision(binding);
  const row = await db
    .select()
    .from(base)
    .where(eq(column(base, 'id'), id))
    .get();
  if (!row) throw new EditorError('Content item not found', 404);
  const record = selectFields(row, module.fields);
  if (module.translated) {
    const translated = table(module.translationTable ?? '');
    record.translations = (
      await db
        .select()
        .from(translated)
        .where(eq(column(translated, module.translationKey ?? ''), id))
        .all()
    )
      .sort(localeOrder)
      .map((row) => ({
        locale: row.locale,
        ...selectFields(row, module.translated ?? []),
      }));
  }
  Object.assign(record, await readGroups(binding, module.groups ?? [], id));
  if (before !== (await revision(binding)))
    throw new EditorError(
      'Content changed while loading. Reload this item.',
      409,
    );
  return {
    id,
    record,
    revision: before,
    locked: Boolean(module.singleton || (key === 'cvVariants' && row.isPublic)),
  };
}

export async function editorChoices(
  binding: D1Database,
  key: string,
  page = 0,
  selected?: number,
) {
  const db = drizzle(binding);
  if (key === 'contentItems') {
    const identities = await db
      .select()
      .from(core.identities)
      .orderBy(asc(core.identities.id))
      .limit(51)
      .offset(page * 50);
    const items = identities.slice(0, 50);
    if (selected && !items.some((row) => row.id === selected)) {
      const chosen = await db
        .select()
        .from(core.identities)
        .where(eq(core.identities.id, selected))
        .get();
      if (chosen) items.push(chosen);
    }
    const choices: { id: number; label: string }[] = [];
    for (const module of editorModules.filter((module) => module.kind)) {
      const ids = items
        .filter((item) => item.kind === module.kind)
        .map((item) => item.id);
      if (!ids.length) continue;
      const base = table(module.table);
      const bases = await db
        .select()
        .from(base)
        .where(inArray(column(base, 'id'), ids));
      const translations = module.translationTable
        ? await db
            .select()
            .from(table(module.translationTable))
            .where(
              inArray(
                column(
                  table(module.translationTable),
                  module.translationKey ?? '',
                ),
                ids,
              ),
            )
        : [];
      choices.push(
        ...bases.map((row) => ({
          id: Number(row.id),
          label:
            module.label +
            ': ' +
            label(
              module,
              row,
              translations.filter(
                (t) => t[module.translationKey ?? ''] === row.id,
              ),
            ),
        })),
      );
    }
    return { items: choices, hasMore: identities.length > 50, page };
  }
  const result = await listEditor(binding, key, page);
  if (selected && !result.items.some((row) => row.id === selected)) {
    const module = editorModule(key);
    const chosen = await readEditor(binding, key, selected);
    result.items.push({
      id: selected,
      label: label(
        module,
        chosen.record,
        Array.isArray(chosen.record.translations)
          ? rows(chosen.record.translations)
          : [],
      ),
      locales: [],
      visible: null,
      locked: chosen.locked,
    });
  }
  return result;
}

type Query = { toSQL(): { sql: string; params: unknown[] } };
export const prepare = (binding: D1Database, query: Query) => {
  const built = query.toSQL();
  return binding.prepare(built.sql).bind(...built.params);
};
function insertRows(
  binding: D1Database,
  target: SQLiteTable,
  values: EditorRecord[],
) {
  const perRow = Object.keys(columns(target)).length;
  const chunkSize = Math.max(1, Math.floor(90 / perRow));
  const statements: D1PreparedStatement[] = [];
  for (let index = 0; index < values.length; index += chunkSize)
    statements.push(
      prepare(
        binding,
        drizzle(binding)
          .insert(target)
          .values(values.slice(index, index + chunkSize)),
      ),
    );
  return statements;
}
function writeChildren(
  binding: D1Database,
  module: EditorModule,
  record: EditorRecord,
  id: number,
): D1PreparedStatement[] {
  const db = drizzle(binding);
  const statements: D1PreparedStatement[] = [];
  if (module.translated) {
    const target = table(module.translationTable ?? '');
    const foreign = module.translationKey ?? '';
    statements.push(
      prepare(
        binding,
        db.delete(target).where(eq(column(target, foreign), id)),
      ),
    );
    statements.push(
      ...insertRows(
        binding,
        target,
        rows(record.translations).map((row) => ({ ...row, [foreign]: id })),
      ),
    );
  }
  for (const group of module.groups ?? []) {
    const target = table(group.table);
    const translations: EditorRecord[] = [];
    statements.push(
      prepare(
        binding,
        db.delete(target).where(eq(column(target, group.foreignKey), id)),
      ),
    );
    const children = rows(record[group.key]).map((value) => {
      const data: EditorRecord = {
        ...selectFields(value, group.fields),
        [group.foreignKey]: id,
        ...(columns(target).id ? { id: freshId() } : {}),
      };
      if (group.translated)
        for (const translation of rows(value.translations)) {
          const scope = Object.fromEntries(
            (group.translationKeys ?? []).map((key) => [
              key,
              group.translationKeys?.length === 1 ? data.id : data[key],
            ]),
          );
          translations.push({ ...translation, ...scope });
        }
      return data;
    });
    statements.push(...insertRows(binding, target, children));
    if (group.translated)
      statements.push(
        ...insertRows(
          binding,
          table(group.translationTable ?? ''),
          translations,
        ),
      );
  }
  return statements;
}

export async function auditStatements(
  binding: D1Database,
  actor: string,
  action: string,
  key: string,
  id: number,
  before: EditorRecord | null,
  after: EditorRecord | null,
) {
  const db = drizzle(binding);
  const reference = crypto.randomUUID();
  const fields = [
    ...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]),
  ].filter(
    (key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]),
  );
  return [
    prepare(
      binding,
      db.insert(core.auditChanges).values({
        id: reference,
        beforeHash: before ? await hash(before) : null,
        afterHash: after ? await hash(after) : null,
      }),
    ),
    ...(fields.length
      ? [
          prepare(
            binding,
            db
              .insert(core.auditChangeFields)
              .values(fields.map((field) => ({ changeId: reference, field }))),
          ),
        ]
      : []),
    prepare(
      binding,
      db.insert(core.audit).values({
        actor,
        action,
        entity: `${key}:${id}`,
        createdAt: new Date().toISOString(),
        changeReference: reference,
      }),
    ),
  ];
}
export async function execute(
  binding: D1Database,
  statements: D1PreparedStatement[],
) {
  // Leave room for the bounded preflight reads inside D1's 50-query free limit.
  if (statements.length > 32)
    throw new EditorError(
      'This item has too many child rows for one save. Reduce its links or gallery entries.',
      413,
    );
  try {
    await binding.batch(statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.includes('revision conflict'))
      throw new EditorError('A newer edit exists. Reload before saving.', 409);
    if (message.includes('Media storage budget'))
      throw new EditorError(
        'The private media library has reached its 512 MiB storage budget.',
        413,
      );
    if (/FOREIGN KEY|UNIQUE|Content kind|public CV/u.test(message))
      throw new EditorError(
        'A reference is missing, a slug is already used, or this protected item cannot be removed.',
        409,
      );
    throw error;
  }
}
export const revisionGuard = (binding: D1Database, expected: number) =>
  prepare(
    binding,
    drizzle(binding)
      .update(core.state)
      .set({
        revision: sql`CASE WHEN ${core.state.revision} = ${expected} THEN ${core.state.revision} + 1 ELSE -1 END`,
      })
      .where(eq(core.state.id, 1)),
  );
export async function saveEditor(
  binding: D1Database,
  key: string,
  id: number | null,
  input: EditorRecord,
  expected: number,
  actor: string,
) {
  const module = editorModule(key);
  const data = module.input.parse(input);
  const db = drizzle(binding);
  const target = table(module.table);
  if (key === 'media' && id === null)
    throw new EditorError('Upload a file to create a media item');
  if (module.singleton && id !== 1)
    throw new EditorError('This is a single-record section');
  const before =
    id === null ? null : (await readEditor(binding, key, id)).record;
  const targetId = id ?? freshId();
  const values = selectFields(data, module.fields);
  const statements = [revisionGuard(binding, expected)];
  if (id === null && module.kind)
    statements.push(
      prepare(
        binding,
        db.insert(core.identities).values({
          id: targetId,
          kind: module.kind as typeof core.identities.$inferInsert.kind,
        }),
      ),
    );
  if (key === 'projectCategories') {
    const reserved = await db
      .select()
      .from(details.categoryRedirects)
      .where(
        and(
          eq(details.categoryRedirects.oldSlug, String(data.slug)),
          ne(details.categoryRedirects.categoryId, targetId),
        ),
      )
      .get();
    if (reserved)
      throw new EditorError(
        'This slug is reserved by an existing category redirect.',
        409,
      );
    // Returning to this category's own historical URL removes its self-redirect.
    statements.push(
      prepare(
        binding,
        db
          .delete(details.categoryRedirects)
          .where(
            and(
              eq(details.categoryRedirects.oldSlug, String(data.slug)),
              eq(details.categoryRedirects.categoryId, targetId),
            ),
          ),
      ),
    );
    if (before?.slug !== data.slug && typeof before?.slug === 'string')
      statements.push(
        prepare(
          binding,
          db
            .insert(details.categoryRedirects)
            .values({ oldSlug: before.slug, categoryId: targetId }),
        ),
      );
  }
  statements.push(
    prepare(
      binding,
      id === null
        ? db.insert(target).values({ id: targetId, ...values })
        : db
            .update(target)
            .set(values)
            .where(eq(column(target, 'id'), targetId)),
    ),
  );
  statements.push(
    ...writeChildren(binding, module, data, targetId),
    ...(await auditStatements(
      binding,
      actor,
      'save',
      key,
      targetId,
      before,
      data,
    )),
  );
  await execute(binding, statements);
  return { id: targetId, revision: expected + 1 };
}
export async function deleteEditor(
  binding: D1Database,
  key: string,
  id: number,
  expected: number,
  actor: string,
) {
  const module = editorModule(key);
  const before = await readEditor(binding, key, id);
  if (before.locked)
    throw new EditorError('This required record cannot be deleted');
  const db = drizzle(binding);
  const target = module.kind ? core.identities : table(module.table);
  await execute(binding, [
    revisionGuard(binding, expected),
    prepare(binding, db.delete(target).where(eq(column(target, 'id'), id))),
    ...(await auditStatements(
      binding,
      actor,
      'delete',
      key,
      id,
      before.record,
      null,
    )),
  ]);
  return { revision: expected + 1 };
}
export async function editorOverview(binding: D1Database) {
  const db = drizzle(binding);
  const [current, events] = await db.batch([
    db.select().from(core.state),
    db
      .select({
        id: core.audit.id,
        action: core.audit.action,
        entity: core.audit.entity,
        createdAt: core.audit.createdAt,
        changeReference: core.audit.changeReference,
      })
      .from(core.audit)
      .orderBy(sql`${core.audit.id} DESC`)
      .limit(20),
  ]);
  const references = events.flatMap((event) =>
    event.changeReference ? [event.changeReference] : [],
  );
  const fields = references.length
    ? await db
        .select()
        .from(core.auditChangeFields)
        .where(inArray(core.auditChangeFields.changeId, references))
    : [];
  return {
    revision: current[0]?.revision ?? 0,
    events: events.map(({ changeReference, ...event }) => ({
      ...event,
      fields: fields
        .filter((field) => field.changeId === changeReference)
        .map((field) => field.field),
    })),
  };
}
