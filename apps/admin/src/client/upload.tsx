import { useEffect, useState } from 'react';
import { client, checked, errorMessage } from './api';

export function Upload({
  revision,
  onUploaded,
  blocked,
}: {
  revision: number;
  onUploaded: () => void;
  blocked: boolean;
}) {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => {
    void client.api.media.status
      .$get()
      .then(checked)
      .then((r) => r.json())
      .then((result) => setAvailable(result.available))
      .catch((error) => setError(errorMessage(error)));
  }, []);
  return (
    <section className="relation stack-compact" aria-labelledby="upload-title">
      <h2 id="upload-title">Upload a private original</h2>
      <p>
        JPEG, PNG, WebP, AVIF or PDF · Maximum 8 MiB. Certificate originals stay
        private. Upload a separate redacted copy for public use.
      </p>
      {available === false && (
        <p role="status">
          Private media storage is waiting for its preview configuration.
          Existing content editing is available.
        </p>
      )}
      <form
        className="stack-compact"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          data.set('revision', String(revision));
          setBusy(true);
          setError('');
          setNotice('');
          void fetch(client.api.media.$url(), {
            method: 'POST',
            body: data,
            headers: { 'X-Requested-With': 'XMLHttpRequest' },
            credentials: 'same-origin',
            redirect: 'error',
          })
            .then(checked)
            .then(() => {
              form.reset();
              setNotice(
                'Uploaded privately. Select the file below to edit its translations.',
              );
              onUploaded();
            })
            .catch((error) => setError(errorMessage(error)))
            .finally(() => setBusy(false));
        }}
      >
        <fieldset
          className="form-body field-grid"
          disabled={busy || blocked || available !== true}
        >
          <div className="field field-wide">
            <label htmlFor="upload-file">File</label>
            <input
              id="upload-file"
              name="file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,application/pdf"
              required
            />
          </div>
          <div className="field">
            <label htmlFor="upload-alt">Alternative text</label>
            <input id="upload-alt" name="altText" maxLength={240} required />
          </div>
          <div className="field">
            <label htmlFor="upload-locale">Language</label>
            <select id="upload-locale" name="locale">
              <option value="en">English</option>
              <option value="fr">Français</option>
              <option value="ar">العربية</option>
            </select>
          </div>
          <button type="submit">{busy ? 'Uploading…' : 'Upload file'}</button>
        </fieldset>
      </form>
      {error && (
        <p role="alert">
          {error}{' '}
          <button
            type="button"
            className="quiet"
            disabled={busy || blocked}
            onClick={onUploaded}
          >
            Refresh revision and retry
          </button>
        </p>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}
