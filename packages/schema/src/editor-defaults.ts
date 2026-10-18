import type { EditorRecord, EditorModule } from './editor.ts';
export function emptyEditorRecord(
  definition: Pick<EditorModule, 'fields' | 'translated' | 'groups'>,
): EditorRecord {
  const values: EditorRecord = {};
  for (const field of definition.fields)
    values[field.key] =
      field.type === 'boolean'
        ? false
        : field.type === 'number'
          ? 0
          : field.type === 'choice'
            ? (field.options?.[0] ?? '')
            : field.type === 'reference' ||
                field.type === 'date' ||
                field.type === 'url'
              ? null
              : '';
  if (definition.translated) values.translations = [];
  for (const group of definition.groups ?? []) values[group.key] = [];
  return values;
}
