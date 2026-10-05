# Sprint 0 readiness and evidence plan

Status as of 2026-10-05: **All four core paths have live evidence, including one measured publication.** The owner chose to retain the static architecture and repeat the publish measurement after the GitHub runner outage recovers before accepting latency. The reference-derived CV layout is compiled and visually inspected. Brief 02's restrictions and the isolated dummy Turnstile exception remain in force.

## Evidence recorded so far

- Pinned Node 24.21.0 / pnpm 10.34.6; typecheck, lint, formatting and **40 local tests pass**. Dependency audit reports no known vulnerabilities. The initial GitHub CI run also passed.
- Wrangler's local D1 migrations pass. Saving synthetic content produces revision 1, the allowlisted snapshot, all three static HTML routes, and EN/FR/AR LaTeX sources. Static output validation passes. Local timings are in ignored `artifacts/local-evidence.json` and are **not live publish latency**.
- Separate remote content and inbox databases were created. Their initial migrations completed successfully (27 and 13 commands respectively). Account/database IDs are retained only in ignored local deployment configuration.
- Admin Worker: unauthenticated `/api/session` returned **302** to Access. After the owner supplied the AUD, the origin was redeployed with independent JWT verification. The owner confirmed a fresh private-window Independent MFA prompt followed by `authenticated: true`. Exact URL/version evidence remains in ignored `artifacts/remote-evidence.json`.
- Contact Worker: only inbox D1 and fixed-recipient Email bindings. A synthetic API submission returned 202; an explicit status-only D1 query showed one message with `notification_status: sent`. The owner confirmed Gmail Inbox placement and correct Reply-To. Addresses and correlation evidence stay in ignored files. No real bot-resistance or browser-form proof is claimed from this API trace.
- [Measured publish run](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/37372533029) succeeded with remote content revision 1. D1 save/capture audit timestamps match the downloaded capture; all three live pages contain its revision and translated content, with no client script or session cookie. All three public PDFs return 200 and have been rendered and inspected. Capture-to-live was 1645.8–1646.0 seconds, including a 1277-second runner queue. [Detailed evidence and owner decision](10-live-publish-evidence.md) distinguish the outage delay from the roughly 234 seconds of job execution to live verification.
- [Reference-layout TeX Live run](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/37320683489) succeeded. Cold image pull: 136.16 seconds. Per-pass EN 9.84/9.56s, FR 9.60/9.52s, AR 9.60/9.58s. Run creation to completion: about 234 seconds. The artifact digest was verified before rendering all three one-page PDFs. Poppins and Amiri were embedded with Unicode mappings. French accents and URL punctuation, Arabic joining/RTL, mixed Latin runs, mirrored entries and absence of clipping were visually checked. A literal three-hyphen date separator was subsequently replaced with an em dash; the reference's italic institution and light date styles were also restored. The PR's latest compile check covers these refinements.

## Explicit Sprint 0 exception approved by the owner

On 2026-10-05 the owner instructed use of Cloudflare's permanent dummy Turnstile pair for Sprint 0 and deferred the real widget until launch. This explicitly changes the real-challenge part of proof D below. Server-side Siteverify still runs. A direct live check returned hostname `example.com`, no action and `metadata.result_with_testing_key: true`; this differs from [Cloudflare's documentation example](https://developers.cloudflare.com/turnstile/troubleshooting/testing/). Spike mode checks the observed canned response; production retains real hostname/action checks and rejects test metadata and dummy keys. Spike page origins are restricted to localhost or the dedicated `mohamedeghboudj-site-spike.*.workers.dev` host.

Dummy keys do not demonstrate bot resistance, real token expiry or single-use enforcement. A real widget and those checks remain launch requirements. Message storage, fixed recipient, Reply-To, deduplication, rate limits and actual Gmail delivery remain part of Sprint 0.

This document supplements briefs 01–05. It does not change their decisions or permit proceeding to Sprint 1 before the four proofs succeed and the measured latency is accepted.

## Confirmed understanding

1. Zero ongoing service cost: use permanent free tiers within their limits, not trials or expiring credits. Account/billing changes belong to the owner.
2. Reuse infrastructure: Access handles authentication, Turnstile handles challenges, maintained TeX Live tooling handles compilation. Custom work concerns this person's content and behavior.
3. All public content is console-managed. Saves are immediate; publishing performs the deliberately accepted static rebuild. No content edit needs a source-code edit.
4. The content D1 database is the authoritative source for the site and all CVs. Build snapshots and PDF caches are derived artifacts, not another editable datastore. Inbox D1 is a separate security boundary.
5. There is one privileged owner. No team roles, multi-tenancy, password store or custom credential system.

The hero establishes identity, the timeline reveals chronology, and projects receive the most interactive attention after the hero. Supporting sections remain calm so these three moments have contrast. All motion is added after the functional platform, with RTL and a deliberately designed reduced-motion presentation.

Access supplies the identity check and its own independent hardware/biometric second factor. The Worker also verifies the JWT signature, issuer, audience and expiry. Full TeX Live in GitHub Actions supplies the Arabic packages and fonts; the briefs explicitly reject Tectonic's frozen-bundle risk and browser compilation. Public CVs compile during publish; authenticated owner dispatch handles custom variants. No public compile endpoint.

## Initial workspace observations (before the local scaffold)

| Check                      | Observed result                                                                                                                   |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Workspace                  | `D:\Business\MyWebsite`                                                                                                           |
| Shell                      | Windows PowerShell 5.1, Desktop edition                                                                                           |
| Initial tool path check    | Node and pnpm resolve outside conda directories                                                                                   |
| Node                       | `26.9.0`, `C:\Program Files\nodejs\node.exe`                                                                                      |
| pnpm                       | `12.6.0` via `pnpm.cmd`; PowerShell execution policy rejects `pnpm.ps1`                                                           |
| Corepack / version manager | `corepack`, `nvm`, `fnm` not found by `Get-Command`                                                                               |
| Other tools                | Git available; `gh`, `wrangler`, Docker not found on PATH; MiKTeX PDF utilities are present but are not the specified CV compiler |
| Git                        | Clean `main` tracking `origin/main` at initial inspection; initial commit `a394be4`                                               |
| Remote                     | `git@github.com:mohamedeghboudj/MyPersonalWebsite.git`                                                                            |
| GitHub connector           | Repository access confirmed; repository is public; default branch is `main`                                                       |
| Existing files             | Five briefs, eleven design references, a placeholder README, a CV PDF and four portraits/cutouts; no application or CI scaffold   |
| Project instructions       | No `AGENTS.md` found in the listed workspace files or checked ancestor locations                                                  |
| Higgsfield                 | Image-model discovery succeeded; no generation performed                                                                          |

The GitHub connector result confirms read access, not successful Git pushes, CI credentials, Actions configuration or deployment permission. Public repository artifacts/logs must never contain unpublished snapshots, private CV variants, company/role prompts, contact data or secrets. Use synthetic/public spike content only.

As checked against [Node's release table](https://nodejs.org/en/about/previous-releases), Node 26 is Current and Node 24 is LTS; the page reports 24.21.0 as the latest LTS. Verify the patch at implementation time, then pin one exact LTS version in `.nvmrc`, `engines` and CI. Pin an explicitly compatible pnpm release through `packageManager` and Corepack; do not silently inherit the installed global versions. Use Windows `.cmd` shims where necessary rather than changing execution policy.

## Decisions and prerequisites still missing

- Design decision resolved: the owner explicitly approved keeping brief 02's restrictions.
- The owner supplied the workers.dev suffix, Access team URL, owner identity, notification sender and verified Gmail destination. Wrangler deployment and the Access redirect are independently observed; the owner confirmed successful Independent MFA and Gmail Inbox delivery.
- The Access audience/issuer and database IDs are configured in ignored deployment files. The updated CV-label migration is applied to local and remote content D1.
- The owner configured the scoped GitHub Actions secrets and merged PR #1; the publish workflow used them successfully. Final production naming and later account controls remain phase-specific tasks. The latency decision is to repeat after recovery, not to switch to SSR or begin the next build phase yet.

No account names, account IDs, MFA enrollment, DNS changes or billing settings have been inferred from the GitHub handle. Existing setup may satisfy these prerequisites; discover its status before duplicating resources.

## Owner-only setup handoff

These steps are for the owner because the original request reserves browser-opening commands and account changes to them. Do not run `wrangler login`, `gh auth login`, or dashboard mutations on the owner's behalf. Only execute the steps that are not already complete.

1. **Local runtime — ready in this workspace:** Node 24.21.0 was downloaded from the official distribution, SHA-256 verified and installed under ignored `.tools`; Corepack 0.36.0 selects pinned pnpm 10.34.6. Use `scripts\pnpm.cmd` here. No system Node or execution-policy change was made. Other checkouts need their own Node/Corepack setup. Do not use conda or pip.
2. **Workers namespace:** in Cloudflare's Workers & Pages area, confirm or register the account-wide `workers.dev` subdomain yourself. Record the resulting non-secret suffix. Do not register a guessed value from a proposed project name.
3. **Zero Trust:** enable the free setup if needed and choose the team name yourself. Enable the App Launcher with an owner-email-only Allow policy. Keep account recovery information private.
4. **MFA enrollment:** under Zero Trust → Access controls → Access settings, enable independent MFA methods; allow enrollment of hardware/biometric authenticators and a backup method, leave **Use identity provider MFA off**, and start with a one-hour duration. Enroll at the team's `/AddMfaDevice` page. On the admin policy, require hardware key/biometric authentication; allowing TOTP enrollment as recovery must not silently make TOTP an ordinary substitute for that requirement. See [Independent MFA](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/independent-mfa/).
5. **Worker protection, after the fail-closed spike Worker is ready:** Workers & Pages → select the admin spike Worker → Access → Protect this Worker behind Access → **All traffic** → owner-only policy → Apply Access. Check its hardware/biometric MFA requirement in Zero Trust. Protecting just previews is insufficient. This Worker-level mode covers the Worker's routes, custom domains, `workers.dev` and previews. See [Worker Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/).
6. **Mail prerequisites:** on the owner's chosen domain, enable Email Routing and complete the Gmail destination verification. Review the DNS changes yourself. The sending address must belong to an onboarded domain; restrict the send binding to the one verified owner destination. [Binding restrictions](https://developers.cloudflare.com/email-service/configuration/send-bindings/) and [email pricing](https://developers.cloudflare.com/email-service/platform/pricing/) document this free notification path. Do not enable paid arbitrary-recipient sending to satisfy the spike.
7. **Contact challenge:** Sprint 0 now uses the explicitly approved public dummy keypair. Before launch, create/configure the real Turnstile widget for the final hostnames and switch to production mode. Save its real secret through local `.dev.vars` or deployed `wrangler secret put`, never chat. The site key is public configuration.
8. **Credentials, when the scaffold supplies exact names:** store scoped deployment credentials in GitHub Actions secrets; use `.dev.vars` locally and `wrangler secret put` for deployed Worker secrets. Login commands are run interactively by the owner. No Global API Key. Keep publish/deploy credentials outside the compiler sandbox.

R2 account activation, a usage alert, private backup repository setup, passkey enforcement and other account controls remain owner tasks at their relevant phase. A billing alert is informational and cannot guarantee a hard spending cap. Do not claim zero-cost validation based on an alert alone.

## Minimal implementation boundary

Create only the code needed to test the four risks, plus the validation and security checks required for those paths. This is not permission to start the complete console, public page designs, all CRUD screens, the full schema, motion or 3D.

Use a small synthetic content item in the content database with a translation table and a real `content_items` identity. Use an authenticated, plain diagnostic save/publish interface and an explicitly allowlisted snapshot. Build the minimal static Astro output and its public CV from the same immutable snapshot. Keep a separate Hono contact Worker with only the inbox database and required notification/challenge configuration. Drizzle, Zod, strict TypeScript, parameterized writes, transactional batches, audit records and origin checks apply even to the spike.

The initial admin Worker must deny access until configuration and JWT verification succeed. No development bypass may be deployable. Any machine-only publish access must be scoped separately to the minimum snapshot/status operations, without a bypass that opens owner CRUD or disables the human MFA policy.

## Proof A — Access and independent MFA

Required evidence:

- Exact tested `workers.dev` URL and preview URL, Access application identifier and deployed version, with tokens and personal account details redacted.
- Fresh private-window owner login showing both identity authentication and an independent hardware/biometric challenge.
- Denied unauthenticated access and denied non-owner identity; direct API requests must not return protected content.
- JWT checks reject missing, forged, expired, wrong-issuer and wrong-audience assertions. A successful Access page alone does not prove origin validation.
- Owner confirms a backup authenticator and recovery path without exporting credentials.
- Repeat on a custom domain when one is attached; the bare-address proof must not wait on that domain.

Current result: **CORE LOGIN PROOF PASSED**. Automated unauthenticated redirect and owner-confirmed fresh Independent MFA followed by a successful origin response. Non-owner and malformed JWT cases pass locally; a second live identity/preview-policy audit remains a launch check.

## Proof B — One save to a verified live publish

Use a harmless unique marker in the content item. Record these server timestamps and IDs:

| Event                  | Required evidence                                                         |
| ---------------------- | ------------------------------------------------------------------------- |
| Save acknowledged      | Content item/revision ID; committed timestamp; audit entry                |
| Publish requested      | Publish ID; snapshot hash; request timestamp                              |
| Actions queued/started | Run URL/ID; queued and job-start timestamps                               |
| Build and CV finished  | Matching snapshot hash; build/compile stage durations                     |
| Deployment accepted    | Deployment version ID and completion timestamp                            |
| Public verification    | First response containing the marker and expected revision for each route |

Report save-to-live and publish-click-to-live separately. Include queue, image/container download, build, compile, deploy and observation intervals; a compiler-only duration is not a publish duration. Measure a cold run and a warm repeat when possible, without claiming a small sample is a production percentile.

Verify static HTML has the content in the first response, sets no public session cookie, and has no request-time D1/R2 dependency. Prove hidden/private columns and inbox content cannot enter the snapshot. Test overlapping publishes so an older revision cannot replace a newer one; a failed publish leaves the last good site live. Verify an English-only item remains present via fallback on `/fr/` and `/ar/`.

The brief's approximate two minutes is an expectation, not a measured result or a new acceptance threshold. Present actual numbers to the owner. Do not switch to SSR automatically.

Current result: **ONE LIVE PUBLISH VERIFIED; LATENCY REPEAT PENDING**. The first run measured about 27m26s capture-to-live and 29m58s save-to-live during GitHub's runner outage. The owner chose to keep the static design and repeat after recovery. See [the evidence](10-live-publish-evidence.md) and [repeat instructions](09-publish-spike-handoff.md). Live overlap/failure exercises and a normal-service sample remain outstanding; local ordering/privacy checks do not substitute for those exercises.

## Proof C — Real trilingual TeX Live compilation

Run in GitHub Actions using full TeX Live, a pinned container digest and commit-pinned Actions. Preload packages/fonts before the compile sandbox starts; do not rely on a network fetch during TeX execution. The compile process gets shell-escape disabled, no network, a hard timeout, bounded CPU/memory, limited filesystem mounts and no deployment secrets. Publish/deploy occurs outside that boundary.

Use one immutable synthetic/public payload in English, French and Arabic. Include accented French text, Arabic paragraphs and mixed-direction content such as an English project name and URL within Arabic context. Every field uses the same data-only escaping/rejection path, including company/role inputs. Run adversarial tests for special TeX characters and prohibited control sequences before compiling.

Record, per locale: Actions run ID, template version, payload hash, compiler/image/font versions, cold/warm image-fetch time, TeX wall time, PDF validation time and total dispatch-to-ready time. Inspect rendered pages, not merely the process exit code: joined Arabic glyphs, RTL ordering, diacritics, mixed text, line breaks, clipping and font embedding. Text extraction is supporting evidence, not visual proof.

Test cache correctness using template version plus the complete resolved payload: identical input hits; changed content, variant, locale, company, role or template invalidates. The full five presets belong to phase 5; this spike proves the engine/language risk without pretending all variants already exist.

Current result: **REFERENCE LAYOUT COMPILED AND INSPECTED** using actual GitHub Actions artifacts. Local PDF utilities only render those already compiled artifacts. Full-length personal CV pagination, all content sections and ATS extraction remain later content-phase checks; synthetic one-page output does not prove those.

## Proof D — One real contact submission through Gmail

Submit from the actual permitted public hostname with a server-verified Turnstile token, applying the owner's documented dummy-key exception for Sprint 0. Verify hostname/action, honeypot, minimum elapsed time, request-size limits, Zod validation, per-visitor/global database-enforced rate limits and idempotency. Test retry behavior without requiring an already-consumed Turnstile token to create a second submission.

Trace one random correlation ID through the accepted request, inbox row, fixed-recipient notification and owner inbox inspection. Ensure email delivery failure is visible/retryable without duplicating the stored message. The sender is the configured domain address; the visitor appears only in validated Reply-To. Strip or reject header line breaks.

The owner must confirm Gmail received the message in the inbox rather than spam, and that Reply targets the visitor. API acceptance or an email send acknowledgement alone is not delivery proof. Confirm the admin reads it as plain text and the content snapshot contains none of it. Keep message bodies, addresses, tokens, headers and screenshots containing personal data out of Git and public Actions artifacts.

Current result: **DELIVERY TRACE PASSED** under the approved dummy-key exception: API → isolated inbox row → fixed-recipient send → owner-confirmed Gmail Inbox and Reply-To. The final browser form and real challenge remain future checks.

## Gate ledger

| Gate                                                    | Live evidence                                         | Result                              |
| ------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------- |
| Access + Independent MFA on bare address                | 302 plus owner-confirmed MFA and authenticated origin | Core proof passed                   |
| Save → publish → verify live, measured                  | Revision 1 verified on all routes and public PDFs     | Passed once; latency repeat pending |
| EN/FR/AR TeX Live PDFs, measured and visually inspected | Reference layout compiled; rendered pages inspected   | Passed for synthetic CV             |
| Contact → isolated inbox → Gmail, not spam              | Live API/D1/send plus Gmail confirmation              | Passed with dummy-key exception     |

Proceed to foundation/build phases only after these four results are supported by actual evidence and any unacceptable measured latency is resolved with the owner. Until then, report the missing dependency directly rather than substituting mocks or declaring the spike complete.
