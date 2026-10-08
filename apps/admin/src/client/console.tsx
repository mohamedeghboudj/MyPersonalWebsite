import { useEffect, useRef, useState } from 'react';
import type { EditorModule, EditorRecord } from '@platform/schema';
import { ApiError, checked, client, errorMessage } from './api';
import { emptyRecord, RecordFields, recordRows, type Issues } from './fields';
import { Upload } from './upload';

type Item = {
  id: number;
  label: string;
  locales: string[];
  visible: unknown;
  locked: boolean;
};
type Draft = {
  id: number | null;
  record: EditorRecord;
  revision: number;
  locked: boolean;
};
type Event = {
  id: number;
  action: string;
  entity: string;
  createdAt: string;
  fields: string[];
};
function Coverage({ locales }: { locales: string[] }) {
  return (
    <span
      className="coverage"
      aria-label={`Translations available: ${locales.join(', ') || 'none'}`}
    >
      {['en', 'fr', 'ar'].map((locale) => (
        <span
          key={locale}
          className={locales.includes(locale) ? 'complete' : 'missing'}
        >
          {locale.toUpperCase()}
          {locales.includes(locale) ? ' ✓' : ' —'}
        </span>
      ))}
    </span>
  );
}
function Preview({
  module,
  record,
}: {
  module: Pick<EditorModule, 'fields' | 'translated' | 'groups'>;
  record: EditorRecord;
}) {
  const [locale, setLocale] = useState('en');
  const translations = recordRows(record.translations);
  const chosen =
    translations.find((row) => row.locale === locale) ??
    translations.find((row) => row.locale === 'en') ??
    translations[0];
  return (
    <div className="stack">
      <div className="toolbar">
        <label htmlFor="preview-language">Preview language</label>
        <select
          id="preview-language"
          value={locale}
          onChange={(event) => setLocale(event.target.value)}
        >
          <option value="en">English</option>
          <option value="fr">Français</option>
          <option value="ar">العربية</option>
        </select>
      </div>
      {chosen && chosen.locale !== locale && (
        <p className="metadata">
          Using {String(chosen.locale).toUpperCase()} because this translation
          is missing.
        </p>
      )}
      <div
        lang={String(chosen?.locale ?? locale)}
        dir={chosen?.locale === 'ar' ? 'rtl' : 'ltr'}
      >
        <dl className="content-preview">
          {[...module.fields, ...(module.translated ?? [])].map((field) => {
            const value =
              field.key in record ? record[field.key] : chosen?.[field.key];
            return value === null ||
              value === '' ||
              value === undefined ? null : (
              <div key={field.key}>
                <dt>{field.label}</dt>
                <dd>
                  {typeof value === 'boolean'
                    ? value
                      ? 'Yes'
                      : 'No'
                    : String(value)}
                </dd>
              </div>
            );
          })}
        </dl>
      </div>
      {module.groups?.map((group) => {
        const entries = recordRows(record[group.key]);
        return entries.length ? (
          <section className="divider stack-compact" key={group.key}>
            <h3>{group.label}</h3>
            {entries.map((entry, index) => {
              const texts = recordRows(entry.translations);
              const text =
                texts.find((row) => row.locale === locale) ??
                texts.find((row) => row.locale === 'en') ??
                texts[0];
              return (
                <dl
                  className="content-preview"
                  key={index}
                  lang={String(text?.locale ?? locale)}
                  dir={text?.locale === 'ar' ? 'rtl' : 'ltr'}
                >
                  {[...group.fields, ...(group.translated ?? [])].map(
                    (field) => (
                      <div key={field.key}>
                        <dt>{field.label}</dt>
                        <dd>
                          {String(entry[field.key] ?? text?.[field.key] ?? '—')}
                        </dd>
                      </div>
                    ),
                  )}
                </dl>
              );
            })}
          </section>
        ) : null;
      })}
    </div>
  );
}
export function Console() {
  const [synthetic, setSynthetic] = useState(false);
  const [modules, setModules] = useState<EditorModule[]>([]);
  const [active, setActive] = useState('profile');
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(0);
  const [more, setMore] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState('');
  const [revision, setRevision] = useState(0);
  const [events, setEvents] = useState<Event[]>([]);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [issues, setIssues] = useState<Issues>({});
  const [reauth, setReauth] = useState(false);
  const [notice, setNotice] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const module = modules.find((module) => module.key === active);
  const dirty = Boolean(draft && JSON.stringify(draft.record) !== saved);
  function report(error: unknown) {
    setError(errorMessage(error));
    setIssues(
      error instanceof ApiError
        ? Object.fromEntries(
            error.issues.map((issue) => [issue.path, issue.message]),
          )
        : {},
    );
    setReauth(error instanceof ApiError && [401, 428].includes(error.status));
  }
  useEffect(() => {
    void Promise.all([
      client.api.session.$get().then(checked),
      client.api.content.registry
        .$get()
        .then(checked)
        .then((r) => r.json()),
    ])
      .then(([session, registry]) => {
        setSynthetic(session.headers.get('X-Preview-Mode') === 'synthetic');
        setModules([...registry.modules]);
      })
      .catch(report);
  }, []);
  useEffect(() => {
    if (!modules.length) return;
    let current = true;
    setLoading(true);
    setError('');
    void Promise.all([
      client.api.content[':type']
        .$get({ param: { type: active }, query: { page: String(page) } })
        .then(checked)
        .then((r) => r.json()),
      client.api.content.overview
        .$get()
        .then(checked)
        .then((r) => r.json()),
    ])
      .then(([list, overview]) => {
        if (!current) return;
        setItems(list.items);
        setMore(list.hasMore);
        setRevision(overview.revision);
        setEvents(overview.events);
      })
      .catch((error) => {
        if (current) report(error);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [active, page, refresh, modules]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const discard = () =>
    !dirty || window.confirm('Discard the unsaved changes in this draft?');
  function switchModule(key: string) {
    if (!discard()) return;
    setActive(key);
    setLoading(true);
    setDraft(null);
    setPage(0);
    setSearch('');
    setIssues({});
    setNotice('');
    setConfirmDelete(false);
  }
  async function open(id: number) {
    if (!discard() || busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    setIssues({});
    setConfirmDelete(false);
    setView('edit');
    try {
      const response = await checked(
        await client.api.content[':type'][':id'].$get({
          param: { type: active, id: String(id) },
        }),
      );
      const value = await response.json();
      setDraft(value);
      setRevision(value.revision);
      setSaved(JSON.stringify(value.record));
      requestAnimationFrame(() => heading.current?.focus());
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  function create() {
    if (!module || !discard()) return;
    const record = emptyRecord(module);
    setDraft({ id: null, record, revision, locked: false });
    setSaved('');
    setError('');
    setIssues({});
    setNotice('');
    setView('edit');
    setConfirmDelete(false);
    requestAnimationFrame(() => heading.current?.focus());
  }
  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError('');
    setIssues({});
    setNotice('');
    setReauth(false);
    try {
      const json = { record: draft.record, revision: draft.revision };
      const response =
        draft.id === null
          ? await client.api.content[':type'].$post({
              param: { type: active },
              json,
            })
          : await client.api.content[':type'][':id'].$put({
              param: { type: active, id: String(draft.id) },
              json,
            });
      const result = await (await checked(response)).json();
      setDraft({ ...draft, ...result });
      setSaved(JSON.stringify(draft.record));
      setNotice(
        'Saved privately. The public site changes only after publishing.',
      );
      setRefresh((value) => value + 1);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    if (!draft?.id || busy) return;
    setBusy(true);
    setError('');
    setReauth(false);
    try {
      const result = await (
        await checked(
          await client.api.content[':type'][':id'].$delete({
            param: { type: active, id: String(draft.id) },
            json: { revision: draft.revision },
          }),
        )
      ).json();
      setDraft(null);
      setConfirmDelete(false);
      setNotice(
        'warning' in result && typeof result.warning === 'string'
          ? result.warning
          : 'Item deleted.',
      );
      setRefresh((value) => value + 1);
    } catch (error) {
      report(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="console-header">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            if (!discard()) event.preventDefault();
          }}
        >
          mohamedeghboudj
        </a>
        <span className="metadata muted">Private workspace</span>
      </header>
      <div className="console-layout">
        <aside className="console-nav">
          <div className="section-picker">
            <label htmlFor="console-section">Content section</label>
            <select
              id="console-section"
              value={active}
              disabled={busy}
              onChange={(event) => switchModule(event.target.value)}
            >
              {modules.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
          <nav aria-label="Content sections">
            <p className="metadata muted">CONTENT</p>
            {modules.map((item) => (
              <button
                type="button"
                className="nav-item"
                key={item.key}
                disabled={busy}
                aria-current={active === item.key ? 'page' : undefined}
                onClick={() => switchModule(item.key)}
              >
                {item.label}
              </button>
            ))}
          </nav>
        </aside>
        <main
          id="main"
          className="console-main stack"
          aria-busy={busy || loading}
        >
          <div className="workspace-title">
            <div>
              <p className="metadata muted">Content console</p>
              <h1>{module?.label ?? 'Your workspace'}</h1>
            </div>
            <p className="metadata muted">
              Revision {revision} · Private draft
            </p>
          </div>
          <p className="muted">Edit once. Keep your website and CVs in sync.</p>
          {synthetic && (
            <p className="message">
              Temporary local preview. Use sample content here; changes are
              discarded when this preview stops.
            </p>
          )}
          <p role="status" className="save-status">
            {busy ? 'Working…' : notice || (dirty ? 'Unsaved changes' : '')}
          </p>
          {error && (
            <div className="message stack-compact" role="alert">
              <p>{error}</p>
              {Object.entries(issues).length > 0 && (
                <ul>
                  {Object.entries(issues).map(([path, message]) => (
                    <li key={path}>
                      {path}: {message}
                    </li>
                  ))}
                </ul>
              )}
              {reauth && (
                <p>
                  <a
                    href="/cdn-cgi/access/logout"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Sign out through Access in another tab
                  </a>
                  , then{' '}
                  <a href="/" target="_blank" rel="noopener noreferrer">
                    sign in again
                  </a>{' '}
                  and retry here. Keep this tab open to preserve your draft.
                </p>
              )}
              {!draft && (
                <button
                  type="button"
                  className="quiet"
                  onClick={() =>
                    modules.length
                      ? setRefresh((value) => value + 1)
                      : window.location.reload()
                  }
                >
                  Retry loading
                </button>
              )}
            </div>
          )}
          {module?.key === 'media' && (
            <Upload
              blocked={loading || busy}
              revision={revision}
              onUploaded={() => setRefresh((value) => value + 1)}
            />
          )}
          {module && (
            <section
              className="stack-compact"
              aria-label={`${module.label} list`}
            >
              <div className="toolbar">
                <label className="search-label">
                  Filter this page
                  <input
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder={`Find ${module.label.toLowerCase()}`}
                  />
                </label>
                {!module.singleton && module.key !== 'media' && (
                  <button
                    type="button"
                    disabled={busy || loading}
                    onClick={create}
                  >
                    Add item
                  </button>
                )}
              </div>
              {loading ? (
                <p>Loading content…</p>
              ) : items.length === 0 ? (
                <div className="empty-state">
                  <p>
                    No {module.label.toLowerCase()} yet. Add the first item to
                    begin.
                  </p>
                </div>
              ) : (
                <ul className="record-list">
                  {items
                    .filter((item) =>
                      item.label
                        .toLocaleLowerCase()
                        .includes(search.toLocaleLowerCase()),
                    )
                    .map((item) => (
                      <li key={item.id}>
                        <button
                          type="button"
                          className="record-button"
                          disabled={busy}
                          aria-current={
                            draft?.id === item.id ? 'true' : undefined
                          }
                          onClick={() => void open(item.id)}
                        >
                          <span>{item.label}</span>
                          <span className="record-meta">
                            {typeof item.visible === 'boolean' && (
                              <span>{item.visible ? 'Visible' : 'Hidden'}</span>
                            )}
                            {item.locked && <span>Required</span>}
                            {module.translated && (
                              <Coverage locales={item.locales} />
                            )}
                          </span>
                        </button>
                      </li>
                    ))}
                </ul>
              )}
              {(page > 0 || more) && (
                <div className="toolbar">
                  <button
                    type="button"
                    className="quiet"
                    disabled={page === 0 || loading}
                    onClick={() => setPage(page - 1)}
                  >
                    Previous
                  </button>
                  <span>Page {page + 1}</span>
                  <button
                    type="button"
                    className="quiet"
                    disabled={!more || loading}
                    onClick={() => setPage(page + 1)}
                  >
                    Next
                  </button>
                </div>
              )}
            </section>
          )}
          {module && draft && (
            <section
              className="editor-panel stack"
              aria-labelledby="editor-heading"
            >
              <div className="workspace-title">
                <h2 id="editor-heading" ref={heading} tabIndex={-1}>
                  {draft.id === null ? 'New item' : 'Edit content'}
                </h2>
                <div className="toolbar">
                  <button
                    type="button"
                    className="quiet"
                    aria-pressed={view === 'edit'}
                    onClick={() => setView('edit')}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    aria-pressed={view === 'preview'}
                    onClick={() => setView('preview')}
                  >
                    Preview text
                  </button>
                </div>
              </div>
              {module.key === 'media' && draft.id !== null && (
                <p>
                  <a href={`/api/media/${draft.id}/download`}>
                    Download private original
                  </a>
                </p>
              )}
              {view === 'preview' ? (
                <>
                  <p className="muted">
                    Unpublished content preview. Public page layouts arrive in
                    the next phase.
                  </p>
                  <Preview module={module} record={draft.record} />
                </>
              ) : (
                <form
                  className="stack"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void save();
                  }}
                >
                  <p className="metadata muted">
                    * Required fields. Add at least one translation where
                    available.
                  </p>
                  <fieldset className="form-body" disabled={busy}>
                    <RecordFields
                      definition={module}
                      record={draft.record}
                      issues={issues}
                      onChange={(record) => setDraft({ ...draft, record })}
                    />
                  </fieldset>
                  <div className="toolbar">
                    <button type="submit" disabled={busy || !dirty}>
                      Save changes
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      disabled={busy}
                      onClick={() => {
                        if (draft.id !== null) void open(draft.id);
                        else if (discard()) setDraft(null);
                      }}
                    >
                      Discard / reload
                    </button>
                    {draft.id !== null && !draft.locked && (
                      <button
                        type="button"
                        className="quiet"
                        disabled={busy}
                        onClick={() => setConfirmDelete(true)}
                      >
                        Delete item
                      </button>
                    )}
                  </div>
                </form>
              )}
              {confirmDelete && (
                <section
                  className="message stack-compact"
                  aria-label="Confirm deletion"
                >
                  <h3>Delete this item?</h3>
                  <p>
                    Its translations and owned rows will be removed. CV
                    selections referencing it will also be removed. This
                    requires a recent Access login.
                  </p>
                  <div className="toolbar">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void remove()}
                    >
                      Confirm delete
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      disabled={busy}
                      onClick={() => setConfirmDelete(false)}
                    >
                      Keep item
                    </button>
                  </div>
                </section>
              )}
            </section>
          )}
          <section
            className="divider stack-compact"
            aria-labelledby="activity-title"
          >
            <h2 id="activity-title">Recent activity</h2>
            <p className="muted">
              Changed fields and content hashes are recorded without copying
              personal values into this log.
            </p>
            {events.length ? (
              <ol className="activity-list">
                {events.map((event) => (
                  <li key={event.id}>
                    <span>
                      {event.action} · {event.entity}
                      {event.fields.length > 0 && (
                        <small className="activity-fields">
                          Changed: {event.fields.join(', ')}
                        </small>
                      )}
                    </span>
                    <time dateTime={event.createdAt}>
                      {new Date(event.createdAt).toLocaleString()}
                    </time>
                  </li>
                ))}
              </ol>
            ) : (
              <p>No edits recorded yet.</p>
            )}
          </section>
        </main>
      </div>
    </>
  );
}
