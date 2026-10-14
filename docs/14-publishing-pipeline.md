# Phase 3 — private publishing inputs

The first durable publishing step captures a consistent revision into private R2 storage. It does not deploy anything. Capture readiness is deliberately separate from workflow state and from the version currently live.

## Contract and authentication

The existing admin Worker now exposes these owner-only routes:

| Route                                    | Behavior                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/publishing/captures`          | Accepts only a UUID `id`, the expected content `revision` and `purpose` (`preview` or `publish`). Requires recent Access authentication. |
| `GET /api/publishing/captures`           | Lists the most recent 20 capture summaries.                                                                                              |
| `GET /api/publishing/captures/:id`       | Returns one summary, without actor identifiers, raw content or storage keys.                                                             |
| `GET /api/publishing/captures/:id/input` | Downloads a ready, unexpired input after verifying its bytes and hashes.                                                                 |

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

The shared schemas are in `packages/schema/src/publish-capture.ts`, policy constants in `packages/config/src/publishing.ts`, ledger access in `database/src/publish-captures.ts`, and the service/routes in `apps/admin/src/publish-captures.ts` and `publishing-routes.ts`.

Fifteen new local D1/R2 tests cover immutable captures, atomic audit events, exact retries, concurrent requests, stale revisions before and after the snapshot transaction, lost storage responses, interrupted streams, corruption, delayed writes after expiry, storage limits, original-file isolation, the D1 query allowance, owner/origin/recent-login checks, attachment headers and safe error responses. All 106 tests pass with two Vitest workers; unrestricted concurrency caused existing setup/transaction tests to time out, so concurrency is bounded without increasing timeouts.

The new migration has also been applied through local Wrangler, and the admin Worker bundles successfully in a Wrangler dry-run. TypeScript, lint, formatting, the admin build and the asset/CSP checks pass. All four existing console browser flows pass, including session recovery and deletion. The loopback console test host now supports the same explicit shutdown approach as the public test host, fixing Windows teardown without adding a route to a deployed Worker. Remote databases remain through migration `0006`; `0007`–`0009` have not been applied remotely.

This increment changes no page layout or motion. The approved reference comparisons in `06-design-reference-review.md` and `13-public-site-progress.md` still govern the public design. It adds no browser JavaScript; the admin bundle remains 247,324 bytes.

## Remaining connections

- Add authenticated, repository-scoped GitHub dispatch and a CI reader for the private inputs and eligible originals. Keep deployment credentials outside the network-disabled TeX compiler.
- Connect the existing media processor, trilingual CV verification and full site gates to that captured input.
- Add scheduled cleanup/reconciliation, workflow status and failure recovery, plus serialized deployment with an explicit monotonic sequence check. GitHub concurrency alone is not a request-order guarantee.
- Provide private preview behind Access and console preview/publish controls once those actions perform the complete operation.
- Prove save-to-live on the isolated preview environment and measure the real latency again. Production and domain cutover remain separate.
