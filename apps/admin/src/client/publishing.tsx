import { useEffect, useRef, useState } from 'react';
import type { InferResponseType } from 'hono/client';
import type {
  PublishCaptureRequest,
  PublishCaptureSummary,
  PreviewCandidate,
  PreviewDeployment,
  BuildDiagnostics,
  Publication,
} from '@platform/schema';
import { checked, client, ApiError } from './api';

const api = client.api.publishing;
type Build = InferResponseType<(typeof api.captures)[':id']['build']['$get']>;
async function optional<T>(
  response: Pick<Response, 'ok' | 'status' | 'headers' | 'redirected' | 'json'>,
): Promise<T | null> {
  return response.status === 404 ? null : (await checked(response)).json();
}
async function post(url: URL, body: unknown) {
  return checked(
    await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      redirect: 'error',
      headers: {
        'Content-Type': 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: JSON.stringify(body),
    }),
  );
}
export function Publishing({
  revision,
  blocked,
  onError,
  onStart,
}: {
  revision: number;
  blocked: boolean;
  onError: (error: unknown) => void;
  onStart: () => void;
}) {
  const [available, setAvailable] = useState(false);
  const [url, setUrl] = useState('');
  const [publishAvailable, setPublishAvailable] = useState(false);
  const [publicUrl, setPublicUrl] = useState('');
  const [publication, setPublication] = useState<Publication | null>(null);
  const [captures, setCaptures] = useState<PublishCaptureSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [build, setBuild] = useState<Build | null>(null);
  const [candidate, setCandidate] = useState<PreviewCandidate | null>(null);
  const [deployment, setDeployment] = useState<PreviewDeployment | null>(null);
  const [current, setCurrent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [report, setReport] = useState<BuildDiagnostics | null>(null);
  const pending = useRef<PublishCaptureRequest | null>(null);
  const acting = useRef(false),
    generation = useRef(0),
    listGeneration = useRef(0);
  const capture = captures.find((item) => item.id === selected);
  const expired = capture && Date.parse(capture.expiresAt) <= Date.now();
  async function loadCaptures() {
    const request = ++listGeneration.current;
    const data = await (await checked(await api.captures.$get())).json();
    if (listGeneration.current === request) setCaptures(data.captures);
  }
  useEffect(() => {
    void Promise.all([
      api.status
        .$get()
        .then(checked)
        .then((r) => r.json())
        .then((value) => {
          setAvailable(value.available);
          setUrl(value.previewUrl);
          setPublishAvailable(value.publishAvailable);
          setPublicUrl(value.publicUrl);
        }),
      loadCaptures(),
    ]).catch(onError);
    return () => {
      generation.current++;
      listGeneration.current++;
    };
  }, []);
  async function inspect(id = selected) {
    if (!id) return;
    const request = ++generation.current;
    const param = { id };
    const [nextBuild, privateDeployment, publicDeployment] = await Promise.all([
      api.captures[':id'].build.$get({ param }).then(optional<Build>),
      api.captures[':id'].preview
        .$get({ param })
        .then(optional<{ deployment: PreviewDeployment }>),
      api.captures[':id'].publication.$get({ param }).then(
        optional<{
          publication: Publication;
          deployment: PreviewDeployment | null;
        }>,
      ),
    ]);
    if (generation.current !== request) return;
    setBuild(nextBuild);
    setPublication(publicDeployment?.publication ?? null);
    const nextDeployment = publicDeployment ?? privateDeployment;
    setDeployment(nextDeployment?.deployment ?? null);
    setCandidate(null);
    setCurrent(false);
    setReport(null);
    if (nextDeployment?.deployment?.status === 'deployed') {
      const active = await (
        await checked(
          await (publicDeployment ? api.public.$get() : api.preview.$get()),
        )
      ).json();
      if (generation.current === request)
        setCurrent(
          active.current.release?.id === id &&
            active.current.versionId === nextDeployment.deployment.versionId,
        );
    } else if (
      !publicDeployment &&
      !nextDeployment &&
      nextBuild?.run?.status === 'completed' &&
      nextBuild.run.conclusion === 'success'
    ) {
      const found = await (
        await checked(await api.captures[':id'].candidate.$get({ param }))
      ).json();
      if (generation.current === request) setCandidate(found.candidate);
    }
  }
  // Reads may poll. Recovery/activation writes always need an explicit action.
  useEffect(() => {
    if (
      !selected ||
      (capture?.purpose !== 'publish' &&
        (!build?.run || build.run.status === 'completed')) ||
      (publication && publication.status !== 'queued')
    )
      return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !acting.current)
        void inspect(selected).catch(onError);
    }, 10000);
    return () => window.clearInterval(timer);
  }, [selected, build, publication, capture?.purpose]);
  async function act(task: () => Promise<void>) {
    if (acting.current) return;
    acting.current = true;
    generation.current++;
    onStart();
    setBusy(true);
    setNotice('');
    try {
      await task();
    } catch (error) {
      onError(error);
    } finally {
      acting.current = false;
      setBusy(false);
    }
  }
  async function prepare(purpose: 'preview' | 'publish' = 'preview') {
    pending.current ??= {
      id: crypto.randomUUID(),
      revision,
      purpose,
    };
    let response;
    try {
      response = await post(
        pending.current.purpose === 'publish'
          ? api.publish.$url()
          : api.captures.$url(),
        pending.current,
      );
    } catch (error) {
      if (error instanceof ApiError && [400, 409, 413].includes(error.status))
        pending.current = null;
      throw error;
    }
    const value: { capture: PublishCaptureSummary } = await response.json();
    pending.current = null;
    listGeneration.current++;
    setCaptures((items) =>
      [
        value.capture,
        ...items.filter((item) => item.id !== value.capture.id),
      ].slice(0, 20),
    );
    setSelected(value.capture.id);
    setBuild(null);
    setDeployment(null);
    setCandidate(null);
    setCurrent(false);
    setReport(null);
    setPublication(null);
    setNotice(
      value.capture.purpose === 'publish' && value.capture.status === 'ready'
        ? 'Publication requested. You can close this page; status checks continue automatically.'
        : value.capture.status === 'ready'
          ? 'Saved content prepared. Start its private build when ready.'
          : 'Content is still being prepared. Recover its status before starting a build.',
    );
  }
  return (
    <div>
      <div className="stack-compact">
        <p>
          Review saved content and all three CVs privately before publishing.
        </p>
        {(!available || !publishAvailable) && (
          <p>Publishing setup is incomplete. You can continue editing.</p>
        )}
        {blocked && (
          <p>
            Save or discard your current edits before previewing or publishing.
          </p>
        )}
        <div className="toolbar">
          <button
            type="button"
            className="quiet"
            disabled={
              !available ||
              busy ||
              blocked ||
              pending.current?.purpose === 'publish'
            }
            onClick={() => void act(() => prepare())}
          >
            {pending.current?.purpose === 'preview'
              ? 'Retry preparing preview'
              : 'Prepare saved content'}
          </button>
          <button
            type="button"
            disabled={
              !publishAvailable ||
              busy ||
              blocked ||
              pending.current?.purpose === 'preview'
            }
            onClick={() => void act(() => prepare('publish'))}
          >
            {pending.current?.purpose === 'publish'
              ? 'Retry publication request'
              : 'Publish saved content'}
          </button>
          <button
            type="button"
            className="quiet"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                await loadCaptures();
                await inspect();
              })
            }
          >
            Check status
          </button>
        </div>
        <div className="field reading">
          <label htmlFor="saved-previews">
            Saved previews and publications
          </label>
          <select
            id="saved-previews"
            value={selected}
            disabled={busy}
            onChange={(event) => {
              const id = event.target.value;
              generation.current++;
              setSelected(id);
              setBuild(null);
              setDeployment(null);
              setCandidate(null);
              setCurrent(false);
              setReport(null);
              setPublication(null);
              if (id) void act(() => inspect(id));
            }}
          >
            <option value="">Choose a saved request</option>
            {captures.map((item) => (
              <option key={item.id} value={item.id}>
                {item.purpose === 'publish' ? 'Publication' : 'Preview'} ·
                Revision {item.revision} ·{' '}
                {new Date(item.createdAt).toLocaleString()}
              </option>
            ))}
          </select>
        </div>
        <p role="status">{busy ? 'Updating status…' : notice}</p>
        {capture && (
          <div className="stack-compact">
            {capture.purpose === 'publish' && !publication && !expired && (
              <button
                type="button"
                disabled={busy || !publishAvailable}
                onClick={() =>
                  void act(async () => {
                    pending.current = {
                      id: capture.id,
                      revision: capture.revision,
                      purpose: 'publish',
                    };
                    await prepare('publish');
                    await inspect(capture.id);
                  })
                }
              >
                Recover publication request
              </button>
            )}
            {publication && (
              <p>
                Publication: {publication.status}.{' '}
                {publication.status === 'queued'
                  ? 'The previous public version stays live until this build and deployment are verified.'
                  : publication.status === 'published'
                    ? 'Deployment confirmed.'
                    : 'This request did not replace the public version.'}
              </p>
            )}
            {capture.purpose === 'publish' &&
              deployment?.status === 'uncertain' && (
                <p>
                  Deployment needs verification. Later publications remain
                  blocked; do not submit another deployment.
                </p>
              )}
            {capture.status === 'failed' && (
              <p>
                This saved input could not be verified. Prepare a fresh preview.
              </p>
            )}
            <p>
              Saved revision {capture.revision}. Later edits are not included.
            </p>
            {expired && (
              <p>
                This saved input has expired. Prepare a fresh preview to build
                again.
              </p>
            )}
            {capture.status === 'capturing' && (
              <button
                type="button"
                disabled={busy || !available}
                onClick={() =>
                  void act(async () => {
                    pending.current = {
                      id: capture.id,
                      revision: capture.revision,
                      purpose: capture.purpose,
                    };
                    await prepare();
                  })
                }
              >
                Recover saved content
              </button>
            )}
            {capture.purpose === 'preview' &&
              !build &&
              capture.status === 'ready' &&
              !expired && (
                <button
                  type="button"
                  disabled={busy || !available}
                  onClick={() =>
                    void act(async () => {
                      await post(
                        api.captures[':id'].build.$url({
                          param: { id: selected },
                        }),
                        {},
                      );
                      await inspect();
                    })
                  }
                >
                  Start private build
                </button>
              )}
            {build && (
              <>
                <p>
                  {build.run
                    ? build.run.status === 'completed'
                      ? build.run.conclusion === 'success'
                        ? 'Build passed.'
                        : 'Build did not succeed. Prepare a fresh preview after resolving the problem.'
                      : 'Building your pages and trilingual CVs…'
                    : 'Checking whether the build request was accepted.'}
                </p>
                {build.run && (
                  <p>
                    <a
                      href={build.run.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View build status
                    </a>
                  </p>
                )}
                {build.run?.status === 'completed' && !expired && (
                  <button
                    type="button"
                    className="quiet"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        const response = await api.captures[
                          ':id'
                        ].diagnostics.$get({ param: { id: selected } });
                        if (response.status === 404) {
                          setReport(null);
                          setNotice(
                            'No private report is available for this build attempt. It may not have been enabled or the job may have stopped before reporting.',
                          );
                          return;
                        }
                        const value = await (await checked(response)).json();
                        if ('error' in value) throw new Error(value.error);
                        setReport(value);
                      })
                    }
                  >
                    Read private build report
                  </button>
                )}
                {report && (
                  <div className="stack-compact">
                    <p>
                      Build report · attempt {report.run.attempt} ·{' '}
                      {new Date(report.createdAt).toLocaleString()}
                    </p>
                    <p>
                      Input: {report.outcomes.retrieval}. Build:{' '}
                      {report.outcomes.build}. Package:{' '}
                      {report.outcomes.package}. Upload:{' '}
                      {report.outcomes.upload}.
                    </p>
                    {report.logs.length === 0 && (
                      <p>No compiler output was captured.</p>
                    )}
                    {report.logs.map((log) => (
                      <details className="relation" key={log.stage}>
                        <summary>
                          {log.stage}
                          {log.truncated ? ' (last part only)' : ''}
                        </summary>
                        <pre
                          className="build-report"
                          tabIndex={0}
                          aria-label={`${log.stage} output`}
                        >
                          {log.text}
                        </pre>
                      </details>
                    ))}
                    <p>
                      <a
                        href={api.captures[':id'].diagnostics
                          .$url({ param: { id: selected } })
                          .toString()}
                      >
                        Download private report
                      </a>
                    </p>
                  </div>
                )}
                {capture.purpose === 'preview' &&
                  ['dispatching', 'uncertain'].includes(
                    build.dispatch.status,
                  ) && (
                    <button
                      type="button"
                      disabled={busy || !available}
                      onClick={() =>
                        void act(async () => {
                          await post(
                            api.captures[':id'].build.$url({
                              param: { id: selected },
                            }),
                            {},
                          );
                          await inspect();
                        })
                      }
                    >
                      Recover build status
                    </button>
                  )}
                {build.dispatch.status === 'rejected' && (
                  <p>
                    The build request was rejected. Prepare a new preview after
                    setup is corrected.
                  </p>
                )}
              </>
            )}
            {candidate && !deployment && !expired && (
              <button
                type="button"
                disabled={busy || !available}
                onClick={() =>
                  void act(async () => {
                    await post(
                      api.captures[':id'].preview.$url({
                        param: { id: selected },
                      }),
                      { versionId: candidate.versionId },
                    );
                    await inspect();
                  })
                }
              >
                Use this private preview
              </button>
            )}
            {capture.purpose === 'preview' &&
              !candidate &&
              !deployment &&
              build?.run?.conclusion === 'success' && (
                <p>
                  No verified uploaded preview is available yet. Check status
                  again or review the upload setup.
                </p>
              )}
            {deployment && (
              <>
                {capture.purpose === 'preview' &&
                  ['activating', 'uncertain'].includes(deployment.status) && (
                    <>
                      <p>
                        The preview change needs verification. Later previews
                        stay blocked until it is resolved.
                      </p>
                      <button
                        type="button"
                        disabled={busy || !available}
                        onClick={() =>
                          void act(async () => {
                            await post(
                              api.captures[':id'].preview.reconcile.$url({
                                param: { id: selected },
                              }),
                              {},
                            );
                            await inspect();
                          })
                        }
                      >
                        Recover preview status
                      </button>
                    </>
                  )}
                {deployment.status === 'rejected' && (
                  <p>
                    The deployment was rejected. Prepare a fresh request after
                    the problem is resolved.
                  </p>
                )}
                {deployment.status === 'deployed' &&
                  (current ? (
                    <p>
                      <a
                        href={capture.purpose === 'publish' ? publicUrl : url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {capture.purpose === 'publish'
                          ? 'Open public website'
                          : 'Open private website preview'}
                      </a>
                    </p>
                  ) : (
                    <p>
                      This revision was deployed earlier. Check status to verify
                      the active version.
                    </p>
                  ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
