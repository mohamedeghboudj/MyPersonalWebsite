import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createAdminClient } from '@platform/api-client';
import '@platform/ui/base.css';

const client = createAdminClient(window.location.origin);
function Console() {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading',
  );
  useEffect(() => {
    let active = true;
    void client.api.session
      .$get()
      .then(async (response) => {
        if (!response.ok) throw new Error('Session unavailable');
        const session = await response.json();
        if (active) setStatus(session.authenticated ? 'ready' : 'error');
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, []);
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <main id="main" className="container chapter stack">
        <p className="metadata muted">Private workspace</p>
        <h1>Content console</h1>
        <p role="status">
          {status === 'loading'
            ? 'Checking your session…'
            : status === 'ready'
              ? 'Your owner session is verified.'
              : 'Your session could not be verified. Reload this page to try again.'}
        </p>
        {status === 'ready' && (
          <section
            className="divider stack-compact"
            aria-labelledby="workspace-heading"
          >
            <h2 id="workspace-heading">Workspace foundation</h2>
            <p>
              Content editing is the next build phase. The existing diagnostic
              remains available for synthetic publishing checks.
            </p>
            <p>
              <a href="/spike">Open publishing diagnostic</a>
            </p>
          </section>
        )}
        {status === 'error' && (
          <button type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        )}
      </main>
    </>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Console root missing');
createRoot(root).render(
  <StrictMode>
    <Console />
  </StrictMode>,
);
