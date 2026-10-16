# Phase 3 — private publishing inputs

The publishing backend captures a consistent revision into private R2 storage and can request a GitHub build of that exact input. This increment validates the build without deploying it. Capture readiness, workflow state and the version currently live remain separate.

## Contract and authentication

The existing admin Worker now exposes these owner-only routes:

| Route                                     | Behavior                                                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/publishing/captures`           | Accepts only a UUID `id`, the expected content `revision` and `purpose` (`preview` or `publish`). Requires recent Access authentication. |
| `GET /api/publishing/captures`            | Lists the most recent 20 capture summaries.                                                                                              |
| `GET /api/publishing/captures/:id`        | Returns one summary, without actor identifiers, raw content or storage keys.                                                             |
| `GET /api/publishing/captures/:id/input`  | Downloads a ready, unexpired input after verifying its bytes and hashes.                                                                 |
| `POST /api/publishing/captures/:id/build` | Accepts an empty JSON object, requires recent login, and reserves one build dispatch for the captured ID.                                |
| `GET /api/publishing/captures/:id/build`  | Returns the dispatch summary and, when available, validated GitHub run status. It does not report a deployment.                          |

All routes inherit independent Access JWT verification, the owner-email check and no-store/security headers. Mutations also require the configured origin. The recent-login helper is shared with destructive content operations and retains the existing sign-out/re-authentication recovery response. No service-token exemption, custom credential or public build endpoint was added.

The download is an attachment under `default-src 'none'; sandbox`. Its `X-Publish-Input-SHA256` header identifies the exact private envelope. It is not suitable for a public Actions artifact: its media mapping contains private object keys, and its content may still be unpublished.

## Consistency, recovery and audit

Migration `0009_publish_captures.sql` adds a ledger separate from the editor's revision counter. A capture has an immutable UUID, sequence, purpose, revision, input hash, snapshot hash, byte count, creator and expiry. The sequence establishes request order for the future deployment coordinator; a sequence alone does not yet enforce deployment order.

The service reads content and eligible media references in one D1 batch, then reserves the input in D1 before writing R2. An insert trigger checks that the captured revision is still current at reservation time. A concurrent edit either becomes a later revision or rejects the new capture; it cannot produce a mixed input. The reservation and its audit event commit together. Status transitions also produce atomic audit events. Capture operations do not increment the content revision.

R2 uses the UUID-derived `publish-inputs/<id>.json` key and conditional creation. A retry cannot overwrite an existing input. The body checksum, strict schema, captured revision and snapshot checksum are verified on recovery and download. Reusing an ID with a different revision or purpose is rejected.

An interrupted write leaves a recoverable `capturing` reservation. If R2 received the input but its response was lost, the next request verifies it and marks the capture ready, even after later content edits. If R2 has no input and the content revision is unchanged, the service reconstructs the exact bytes, including the original capture timestamp. If content has changed, it allows a five-minute recovery interval for the original request, then marks the capture failed instead of substituting newer content. A broken response stream remains retryable; a proven size/hash/schema mismatch fails closed. Failed or expired IDs cannot be repurposed.

The legal transitions are `capturing` to `ready`, `failed` or `expired`, and `ready`/`failed` to `expired`. Ledger identity cannot be edited, status cannot move backward and history cannot be deleted through the table. Audit records contain actor, action, capture ID and timestamp, without copying content or storage errors.

## Bounds and expiry

Each envelope is limited to 2 MiB. D1 atomically caps non-expired reservations at 20, so normal capture storage is at most 40 MiB, separate from the media library. This limit is checked before creating an object. The capture request itself is capped at 1 KiB. Downloading a stored envelope also enforces its captured byte length while streaming.

Inputs become unusable after 24 hours. Physical deletion is currently opportunistic: a new capture request removes up to five expired objects before releasing their reservations. A failed R2 deletion leaves its reservation occupied for retry. Cleanup targets only the capture prefix and retains ledger/audit history. A write that finishes after a concurrent expiry is cleaned up before that request returns. An interrupted process at that boundary can still require a later storage reconciliation; scheduled cleanup/reconciliation must be connected before the complete publisher is considered finished. No account-level R2 lifecycle change is assumed.

Original media is not duplicated or pinned by this capture. The immutable envelope selects eligible object keys; the existing bounded preparer downloads them into a fresh private working directory and then the image processor re-encodes them. If an original is deleted before the build reads it, preparation fails. It cannot silently substitute another file or disturb the last deployed site.

## Implementation and validation

### Authenticated dispatch and private retrieval

Migration `0010_build_dispatches.sql` reserves at most one dispatch attempt per capture, with an enforced ready/unexpired capture reference and atomic audit events. Concurrent clicks cannot send two requests. GitHub receives a capture UUID, revision, sequence, purpose, hashes, byte count and timestamps; no content or media keys enter workflow inputs. Repository, workflow and `main` ref are code-owned. The endpoint remains disabled unless `PUBLISH_BUILDS_ENABLED=true` and the scoped token are configured, and production environments are rejected for this preview-only increment.

The transport pins GitHub API version `2026-03-10`, handles its run-ID response, refuses redirects and never automatically retries a POST. A lost response, legacy 204 response or ambiguous transport failure leaves the request uncertain. After 30 seconds, a repeat request searches the workflow's latest 100 runs for exactly one matching UUID/title, ref, workflow path and event. It never treats an empty search as proof that dispatch failed. An interrupted D1 acknowledgement can be recovered in the same way. Definitive rejections stay rejected; uncertain outcomes need reconciliation or owner inspection, not blind resubmission. Run links are constructed from the known repository and validated ID instead of trusting upstream URLs. See [GitHub's dispatch contract](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

`build-capture.yml` permits only the repository owner on `main` and reuses the complete Platform checks workflow before retrieval. Its R2 read credentials exist only in the retrieval step. `private-r2.ts` uses pinned `aws4fetch@1.0.20`, a [Cloudflare-documented S3 client](https://developers.cloudflare.com/r2/examples/aws/aws4fetch/), to sign GET requests to the fixed account/bucket endpoint. There are no presigned links, public bucket changes, Access bypasses, redirect forwarding or writes through this credential. Paths, response size and read duration are bounded.

The consumer verifies expiry and trusted hashes before downloading eligible originals, requires a fresh private directory and checks that the snapshot timestamp/revision and all bytes match. A separate completion marker is written only after retrieval finishes. The build checks both snapshot and original-file hashes again, prepares and compiles the three CVs, and runs Astro from the site directory so generated files stay within the workspace. Existing CV/media allowlists and hash verification still govern static staging. The build is always preview/noindex and cannot deploy.

Child processes receive an explicit OS/toolchain environment allowlist, without R2, GitHub or deployment credentials and without inherited Node hooks. Compiler and site stdout/stderr go to bounded private runner files; the public Actions log gets fixed stage results only. No input, originals, logs or output are uploaded as Actions artifacts. An always-run cleanup removes the private workspace and generated derivatives/pages. The separate synthetic TeX proof now exercises this same captured-input build driver before checking all three CV links and PDF bytes; only its explicitly synthetic evidence is eligible for that proof's artifact upload.

The shared schemas are in `packages/schema/src/publish-capture.ts`, policy constants in `packages/config/src/publishing.ts`, ledger access in `database/src/publish-captures.ts`, and the service/routes in `apps/admin/src/publish-captures.ts` and `publishing-routes.ts`.

Fifteen capture tests cover immutable captures, atomic audit events, exact retries, concurrent requests, stale revisions before and after the snapshot transaction, lost storage responses, interrupted streams, corruption, delayed writes after expiry, storage limits, original-file isolation, the D1 query allowance, owner/origin/recent-login checks, attachment headers and safe error responses. Eighteen additional tests cover dispatch races and recovery, API boundaries, metadata/original tampering, expiry during retrieval, signed R2 transport and private diagnostics. Two dispatch tests run inside workerd rather than relying on Node mocks. All 124 tests pass with two Vitest workers; concurrency remains bounded without increasing timeouts.

Both migrations have been applied through local Wrangler, and the admin Worker bundles successfully in a Wrangler dry-run. TypeScript, lint, formatting, dependency audit, the admin build and the asset/CSP checks pass. The existing four console and nine public browser flows remain in the required Platform checks. Remote databases remain through migration `0006`; `0007`–`0010` have not been applied remotely. Live authenticated dispatch and S3 reads are not yet proven; setup is recorded in [the activation handoff](15-private-build-activation.md).

This increment changes no page layout or motion. The approved reference comparisons in `06-design-reference-review.md` and `13-public-site-progress.md` still govern the public design. It adds no browser JavaScript; the admin bundle remains 247,324 bytes.

## Remaining connections

- Activate and prove the implemented dispatch/R2-reader connection in the isolated preview environment after credential setup and review. A successful synthetic proof does not establish live credentials or Access policy.
- Add scheduled capture cleanup/reconciliation, private diagnostics retrieval and serialized deployment with an explicit monotonic sequence check. GitHub concurrency alone is not a request-order guarantee.
- Provide private preview behind Access and console preview/publish controls once those actions perform the complete operation.
- Prove save-to-live on the isolated preview environment and measure the real latency again. Production and domain cutover remain separate.
