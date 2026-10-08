import { useEffect, useId, useState } from 'react';
import type { EditorField, EditorModule, EditorRecord } from '@platform/schema';
import { client, checked, errorMessage } from './api';

import { emptyEditorRecord as emptyRecord } from '@platform/schema/editor-defaults';
export { emptyRecord };
export const recordRows = (value: unknown): EditorRecord[] =>
  Array.isArray(value) ? (value as EditorRecord[]) : [];
export type Issues = Record<string, string>;
function Reference({
  field,
  value,
  onChange,
  id,
  invalid,
}: {
  field: EditorField;
  value: unknown;
  onChange: (value: unknown) => void;
  id: string;
  invalid: boolean;
}) {
  const [choices, setChoices] = useState<{ id: number; label: string }[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const selected = typeof value === 'number' ? value : undefined;
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError('');
    void client.api.content.choices[':type']
      .$get({
        param: { type: field.reference ?? '' },
        query: {
          page: String(page),
          ...(selected ? { selected: String(selected) } : {}),
        },
      })
      .then(checked)
      .then((r) => r.json())
      .then((result) => {
        if (!active) return;
        setChoices((previous) =>
          Array.from(
            new Map(
              [...previous, ...result.items].map((item) => [item.id, item]),
            ).values(),
          ),
        );
        setMore(result.hasMore);
      })
      .catch((error) => {
        if (active) setError(errorMessage(error));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [field.reference, page, selected, retry]);
  return (
    <div className="stack-compact">
      <select
        id={id}
        required={field.required}
        value={typeof value === 'number' ? value : ''}
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={(event) =>
          onChange(event.target.value ? Number(event.target.value) : null)
        }
      >
        <option value="">{field.required ? 'Choose an item' : 'None'}</option>
        {selected && !choices.some((choice) => choice.id === selected) && (
          <option value={selected}>Selected item #{selected}</option>
        )}
        {choices.map((choice) => (
          <option key={choice.id} value={choice.id}>
            {choice.label}
          </option>
        ))}
      </select>
      {busy && (
        <p className="metadata" role="status">
          Loading choices…
        </p>
      )}
      {more && (
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={() => setPage(page + 1)}
        >
          Load more choices
        </button>
      )}
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            className="quiet"
            onClick={() => setRetry(retry + 1)}
          >
            Retry choices
          </button>
        </p>
      )}
    </div>
  );
}
export function Fields({
  fields,
  record,
  onChange,
  path = '',
  issues = {},
}: {
  fields: readonly EditorField[];
  record: EditorRecord;
  onChange: (value: EditorRecord) => void;
  path?: string;
  issues?: Issues;
}) {
  const prefix = useId();
  return (
    <div className="field-grid">
      {fields.map((field) => {
        const id = `${prefix}-${field.key}`;
        const issue = issues[`${path}${field.key}`];
        const value = record[field.key];
        const update = (value: unknown) =>
          onChange({ ...record, [field.key]: value });
        const common = {
          id,
          required: field.required,
          'aria-invalid': Boolean(issue),
          'aria-describedby': issue ? `${id}-error` : undefined,
        };
        return (
          <div
            key={field.key}
            className={`field ${field.type === 'multiline' ? 'field-wide' : ''}`}
          >
            <label htmlFor={id}>
              {field.label}
              {field.required && field.type !== 'boolean' && (
                <span aria-hidden="true"> *</span>
              )}
            </label>
            {field.type === 'reference' ? (
              <Reference
                field={field}
                value={value}
                onChange={update}
                id={id}
                invalid={Boolean(issue)}
              />
            ) : field.type === 'boolean' ? (
              <input
                {...common}
                required={false}
                type="checkbox"
                checked={value === true}
                onChange={(event) => update(event.target.checked)}
              />
            ) : field.type === 'choice' ? (
              <select
                {...common}
                value={String(value ?? '')}
                onChange={(event) => update(event.target.value)}
              >
                {field.options?.map((option) => (
                  <option key={option}>{option}</option>
                ))}
              </select>
            ) : field.type === 'multiline' ? (
              <textarea
                {...common}
                rows={5}
                maxLength={field.max}
                value={String(value ?? '')}
                onChange={(event) => update(event.target.value)}
              />
            ) : (
              <input
                {...common}
                type={
                  field.type === 'number'
                    ? 'number'
                    : field.type === 'date'
                      ? 'date'
                      : field.type === 'url'
                        ? 'url'
                        : 'text'
                }
                min={field.type === 'number' ? 0 : undefined}
                max={field.type === 'number' ? 10000 : undefined}
                maxLength={field.max}
                value={String(value ?? '')}
                onChange={(event) =>
                  update(
                    field.type === 'number'
                      ? event.target.value === ''
                        ? ''
                        : Number(event.target.value)
                      : event.target.value === '' &&
                          (field.type === 'date' || field.type === 'url')
                        ? null
                        : event.target.value,
                  )
                }
              />
            )}
            {issue && (
              <p id={`${id}-error`} className="field-error">
                {issue}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
const languages = [
  { code: 'en', name: 'English' },
  { code: 'fr', name: 'Français' },
  { code: 'ar', name: 'العربية' },
] as const;
export function Translations({
  fields,
  value,
  onChange,
  path,
  issues,
}: {
  fields: readonly EditorField[];
  value: unknown;
  onChange: (value: EditorRecord[]) => void;
  path: string;
  issues: Issues;
}) {
  const [locale, setLocale] = useState('en');
  const translations = recordRows(value);
  const index = translations.findIndex((row) => row.locale === locale);
  const row = translations[index];
  return (
    <section className="translations stack-compact" aria-label="Translations">
      <div className="toolbar" aria-label="Translation language">
        {languages.map((language) => (
          <button
            type="button"
            className="quiet"
            key={language.code}
            lang={language.code}
            aria-pressed={locale === language.code}
            onClick={() => setLocale(language.code)}
          >
            {language.name}{' '}
            <span className="metadata">
              {translations.some((row) => row.locale === language.code)
                ? '•'
                : '—'}
            </span>
          </button>
        ))}
      </div>
      {issues[path] && <p role="alert">{issues[path]}</p>}
      {row ? (
        <div className="stack-compact">
          <div lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
            <Fields
              fields={fields}
              record={row}
              issues={issues}
              path={`${path}.${index}.`}
              onChange={(next) =>
                onChange(
                  translations.map((item, i) => (i === index ? next : item)),
                )
              }
            />
          </div>
          <button
            type="button"
            className="quiet"
            onClick={() => {
              if (window.confirm('Remove this translation from the draft?'))
                onChange(translations.filter((_, i) => i !== index));
            }}
          >
            Remove{' '}
            {languages.find((language) => language.code === locale)?.name}{' '}
            translation
          </button>
        </div>
      ) : (
        <div className="empty-state stack-compact">
          <p>
            This translation is missing. The public site will fall back to
            English, then another available language.
          </p>
          <button
            type="button"
            className="quiet"
            onClick={() =>
              onChange([
                ...translations,
                { locale, ...emptyRecord({ fields }) },
              ])
            }
          >
            Add {languages.find((language) => language.code === locale)?.name}{' '}
            translation
          </button>
        </div>
      )}
    </section>
  );
}
export function RecordFields({
  definition,
  record,
  onChange,
  issues,
  path = '',
}: {
  definition: Pick<EditorModule, 'fields' | 'translated' | 'groups'>;
  record: EditorRecord;
  onChange: (value: EditorRecord) => void;
  issues: Issues;
  path?: string;
}) {
  return (
    <div className="stack">
      <Fields
        fields={definition.fields}
        record={record}
        onChange={onChange}
        path={path}
        issues={issues}
      />
      {definition.translated && (
        <Translations
          fields={definition.translated}
          value={record.translations}
          onChange={(translations) => onChange({ ...record, translations })}
          path={`${path}translations`}
          issues={issues}
        />
      )}
      {definition.groups?.map((group) => {
        const rows = recordRows(record[group.key]);
        const update = (next: EditorRecord[]) =>
          onChange({ ...record, [group.key]: next });
        const move = (index: number, direction: number) => {
          const next = [...rows];
          const other = next[index + direction];
          const current = next[index];
          if (!other || !current) return;
          next[index] = other;
          next[index + direction] = current;
          update(
            next.map((row, i) =>
              'position' in row
                ? { ...row, position: i }
                : 'displayOrder' in row
                  ? { ...row, displayOrder: i }
                  : row,
            ),
          );
        };
        return (
          <section
            className="divider stack-compact"
            key={group.key}
            aria-label={group.label}
          >
            <h3>{group.label}</h3>
            {rows.length === 0 && (
              <p className="muted">No {group.label.toLowerCase()} added.</p>
            )}
            {rows.map((row, index) => (
              <fieldset className="relation stack" key={index}>
                <legend>
                  {group.label} · {index + 1}
                </legend>
                <RecordFields
                  definition={group}
                  record={row}
                  issues={issues}
                  path={`${path}${group.key}.${index}.`}
                  onChange={(next) =>
                    update(rows.map((item, i) => (i === index ? next : item)))
                  }
                />
                <div className="toolbar">
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Move ${group.label} ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() => move(index, -1)}
                  >
                    Move up
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    aria-label={`Move ${group.label} ${index + 1} down`}
                    disabled={index === rows.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    Move down
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => update(rows.filter((_, i) => i !== index))}
                  >
                    Remove row {index + 1}
                  </button>
                </div>
              </fieldset>
            ))}
            <button
              type="button"
              className="quiet"
              disabled={rows.length >= 30}
              onClick={() => {
                const next = emptyRecord(group);
                if ('position' in next) next.position = rows.length;
                if ('displayOrder' in next) next.displayOrder = rows.length;
                update([...rows, next]);
              }}
            >
              Add {group.label.toLowerCase()}
            </button>
          </section>
        );
      })}
    </div>
  );
}
