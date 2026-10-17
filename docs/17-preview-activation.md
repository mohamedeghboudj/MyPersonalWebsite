# Phase 3 — preview activation coordinator

The private preview now has an implemented candidate-upload path and an owner-authenticated activation API. This builds on the guard/package work already completed in `b450f82`; it does not redo that work. Remote activation remains disabled and unproven. The subsequent [console increment](19-preview-console.md) connects candidate discovery and preview controls; private diagnostics and production publishing remain pending.

## Upload and activation are separate

After the full checks, captured-input retrieval, trilingual compile, Astro build and package validation pass, `build-capture.yml` can run `upload-private-preview.ts`. It is gated by `PREVIEW_UPLOAD_ENABLED=true` and remains owner/main-only. It checks the existing preview Worker's identity and active receipt, re-verifies the sealed package, and runs the pinned Wrangler's **`versions upload` only**. This follows Cloudflare's [version upload/deployment separation](https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/). It cannot bootstrap a missing Worker or activate the uploaded version.

The generated configuration names only `mohamedeghboudj-site-preview`, points to the guarded entry point, forces `run_worker_first`, disables version URLs, and contains the exact release receipt. Its directory and logs are outside the served `site/` tree. An explicit empty environment file and a child-process allowlist exclude inherited Node hooks, API URL overrides, production target overrides, GitHub tokens and R2 credentials. Only this upload step gets the scoped Cloudflare credential; the compiler does not. Wrangler stdout/stderr stays in a bounded private file; its own diagnostic files also remain inside the private upload directory. Its structured upload receipt is validated and the resulting version's identity/bundle receipt is read back from Cloudflare. Public Actions logs contain only fixed status text and the candidate UUID. Cleanup removes the private package and its upload directory even after failure. No owner content/PDF/log becomes an Actions artifact.

Uploading is allowed to overlap another build because it does not change the active deployment. A failed or interrupted upload cannot claim activation. Retrying the driver within the same working directory is refused. A workflow rerun can produce another undeployed version; the activation ledger still permits only one version per capture. The subsequent console increment in `19` discovers matching version bindings without copying UUIDs from logs.

## Durable order and recovery

Migration `0012_preview_deployments.sql` stores capture, candidate version, previous version, successful run ID, bundle hash, state, deployment ID, actor and timestamps. The identity is immutable; rows cannot be deleted. A partial unique index permits only one `activating` or `uncertain` row for the preview target. There is no expiring lease. Capture readiness, purpose, expiry and dispatch identity are enforced in SQL; an already deployed sequence/revision cannot regress even if the provider read is stale. Insert/status changes and their minimal audit events commit together.

Only the transaction that reserves this slot sends the activation POST. Before that reservation, the service independently confirms the exact GitHub workflow/capture completed successfully and the candidate matches the captured snapshot, sequence and revision. It rechecks the active version and capture expiry after reservation. A changed baseline or failed preflight rejects the attempt before any mutation.

The Cloudflare [deployment request](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/) selects one exact version at 100%, with no `force` and no automatic POST retry. It uses the fixed preview endpoint, bounded JSON, a timeout and manual redirect handling. A valid acknowledgement must name that version and a deployment created no earlier than the reserved intent. Structured definitive denials are `rejected`; a timeout, network/5xx response, malformed result or mismatched version is `uncertain`. A failed database acknowledgement leaves the durable `activating` row in place.

Repeated requests for the same capture/version reconcile using deployment history instead of resending. Exactly one complete deployment of that version, with a timestamp at or after the intent, can establish success. Missing, partial, old, duplicate or unavailable evidence retains the block. Reconciliation can succeed after the capture's 24-hour input TTL; this is an acknowledgement of an earlier activation, not permission to activate expired content.

An interruption before the POST may therefore leave a block that cannot be cleared automatically. This favors preserved ordering over availability: inspect the provider and database history, then resolve through a separately reviewed recovery procedure. Do not delete the ledger row, expire its lock, or blindly redeploy. The order guarantee assumes every automated activation uses this coordinator. Dashboard/CLI deployments outside it can invalidate that guarantee and must not be a parallel publishing path.

`deployed` records a confirmed activation of this capture; it does not mean that capture is still the latest version. The guarded `/_build/status` and active-deployment reader establish what is currently serving. Keep capture state, workflow success, deployment history and the currently live receipt distinct in the upcoming console UI.

## Owner API and configuration

All routes inherit the console's independent Access JWT, owner-email, origin and no-store controls. Both POST routes also require recent provider-verified login and reuse the existing sign-out/re-authentication recovery flow. No service credential bypass or custom login was added.

| Route                                                 | Input / result                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `POST /api/publishing/captures/:id/preview`           | Strict `{ "versionId": "<UUID>" }`; reserves/activates or reconciles that exact attempt. |
| `POST /api/publishing/captures/:id/preview/reconcile` | Strict `{}`; checks evidence without another activation POST.                            |
| `GET /api/publishing/captures/:id/preview`            | Safe ledger summary only; no provider call or write.                                     |

Pending/uncertain results return HTTP 202; terminal results return 200. The summary excludes actor identifiers, raw provider errors, tokens and content.

Admin activation requires `APP_ENV=preview`, `PREVIEW_ACTIVATION_ENABLED=true`, `PREVIEW_ACCESS_AUDIENCE`, `CLOUDFLARE_ACCOUNT_ID`, `PREVIEW_CLOUDFLARE_API_TOKEN` and the existing `PUBLISH_GITHUB_TOKEN`. Local tests may use `APP_ENV=local`; production is rejected. The separate preview audience must differ from the admin audience.

The upload workflow uses repository variables `PREVIEW_UPLOAD_ENABLED`, `PREVIEW_ACCESS_ISSUER`, `PREVIEW_ACCESS_AUDIENCE`, `ADMIN_ACCESS_AUDIENCE` and `PREVIEW_OWNER_EMAIL`, plus Actions secrets `CLOUDFLARE_ACCOUNT_ID` and `PREVIEW_CLOUDFLARE_API_TOKEN`. Tokens must be expiring and scoped to the necessary Workers operations/account, restricted to this Worker where supported, without DNS/D1/R2/account-administration access. Enter secret values only into their private prompts/settings, never chat or tracked configuration. The owner retains responsibility for account changes under the original project instructions. These are documented prerequisites, not changes performed by this increment.

Before a live proof: review/merge the required code in the correct stacked order; apply local-only migrations through `0012` to preview; deploy the minimal guarded bootstrap; let the owner attach a separate owner-only Access application with Independent MFA; configure scoped credentials and explicit flags; and use the console preview controls to prove capture → build → upload → activation → authenticated page/PDF receipt. The production Worker/domain is outside this path.

## Validation and remaining scope

The new coordinator tests cover concurrent requests, a competing capture, a lost accepted response, an interrupted D1 acknowledgement, an expired capture, a changed provider baseline, durable sequence protection, malformed/old evidence, audit rollback and immutable history. API tests cover owner/origin/recent-login checks and disabled/wrong-environment configurations. The actual activation transport also executes inside workerd, including redirect refusal. Upload tests cover environment/target isolation, byte tampering, expiry, missing targets, ambiguous receipts and no activation/retry.

Local Wrangler applied `0012` successfully. All **179 tests across 26 files** pass (137.89 seconds), together with TypeScript, lint and formatting. The 28 new cases cover the coordinator, transport/API/runtime and upload boundaries. Both the admin Worker dry-run and the actual pinned `wrangler versions upload --dry-run` with a generated synthetic configuration pass. Current-head GitHub CI is tracked in PR #9. The admin build remains 247,324 bytes of browser JavaScript; its updated Worker bundles at 1,378.35 KiB (246.55 KiB gzip). No browser component, public layout, motion, design token or content has changed. The reference comparisons in `06` and `13` remain applicable.

Candidate discovery and private-preview controls are connected in `19`. Still required: owner-only diagnostics; production publishing controls and deployment coordination; live private Access/upload/activation/retention proof and new latency measurement. Remote D1 remains through `0006`, the existing protected console is unchanged, and PR #9 remains draft. The project-wide remaining work is tracked in [the completion checklist](18-completion-checklist.md).
