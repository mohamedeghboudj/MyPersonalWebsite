# Phase 3 — private static preview

Current publishing implementation and live activation steps: [21-publishing-activation.md](21-publishing-activation.md). The earlier increment below is historical; public publishing is now implemented, while its live proof is still pending.

The preview package and its Access guard are implemented. The subsequent [activation increment](17-preview-activation.md) adds a gated candidate upload and durable owner-only activation API. The captured-build workflow never activates a version: a completed run means validated (and uploaded when enabled), not live.

## Static output behind the owner's Access identity

`apps/preview` is an owner-only asset guard for the existing `mohamedeghboudj-site-preview` target. It serves the same Astro output and snapshot-bound EN/FR/AR PDFs that the publishing build produces. It has no D1 or R2 binding, no rendering engine, no custom login, and no visitor-facing production route. The production site remains a Worker-free static asset deployment. This additional private app implements the brief's private preview requirement without changing its public hosting design.

Every request goes through the Worker before static routing, including direct CSS, image, PDF and missing-file URLs. This uses Cloudflare's documented [`run_worker_first` routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/). The Worker independently validates the JWT signature, issuer, application audience, expiry and owner email using the same implementation as the console. The new preview application needs its own AUD; the admin application's AUD must not be reused. Independent MFA remains an Access policy enforced and verified in the owner's browser.

All responses use `no-store` and `noindex, nofollow`. Credentials and cookies are not forwarded to the asset binding. PDF downloads use attachment headers and a sandbox CSP. Only same-origin redirects survive, and localized static 404 status codes are preserved. The owner-only `/_build/status` route reports the installed capture/revision/bundle receipt. This is separate from GitHub workflow status. Missing configuration, an unknown release or absent assets fails closed.

`env:configure preview` now writes the guarded configuration under `apps/preview/wrangler.preview.json`. The earlier ignored `apps/site/wrangler.preview.json` is obsolete and must not be used to deploy unpublished content. The generator leaves routes disabled and Access identity fields unset; it cannot create an accidentally public preview. It does not overwrite any existing account setting or generate an Access audience.

## Bundle contract

`scripts/prepare-private-preview.ts` consumes the verified captured input, compiled CV directory and Astro output. It requires all expected routes and localized error pages, the preview headers and all three matching PDFs. Allowed files are generated pages, static metadata/configuration, Astro CSS/JS/fonts, content-hashed image/document derivatives and the three public CVs. Raw snapshots, original-media files, TeX, logs, source maps and additional PDFs are rejected. Image/document filenames must match their content hashes. Every HTML page must carry the preview noindex marker and captured revision.

The package is bounded to 2,000 files, 25 MiB per file and 100 MiB total. Symlinks are refused. Packaging writes to a new directory; the completion manifest is written last, outside `site/`. The manifest binds the capture ID, sequence, revision and snapshot hash to a sorted list of file hashes and sizes. Verification rechecks the complete file set, bytes and 24-hour capture validity. This detects corruption in the trusted runner workspace; it is not a signature that authenticates an arbitrary uploaded manifest.

The build sets its canonical origin to the configured preview target instead of localhost. No input, package, diagnostic file or owner PDF is uploaded as an Actions artifact. The existing synthetic TeX proof separately exercises this packaging path with actual compiled EN/FR/AR PDFs; it does not use owner content or credentials.

## Read-only deployment checks

`scripts/preview-deployment.ts` reads Cloudflare's [actively serving deployment](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/list/) and that exact [version's bindings](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/versions/methods/get/). It does not select the latest uploaded version. Inspection rejects missing Workers, mixed-percentage deployments, missing/duplicate identity bindings, wrong owner/audience and unrecognized receipts. Only an explicit `bootstrap-v1` receipt represents an empty initial preview.

Comparison returns `superseded` for an older capture and `already-active` for an identical installed receipt. A reused sequence with different identity or hashes, or a newer sequence whose content revision regresses, is an error. API reads use a fixed account/Worker URL, bounded JSON, a timeout and no redirects. Upstream error bodies and credentials are not printed.

`scripts/inspect-private-preview.ts` can run these checks against a completed `artifacts/private-preview` bundle when the expected Access identity and a scoped read credential are available in its process environment. Its environment schema is `previewInspectionEnvSchema`; no credential value belongs in chat, command history or a tracked file. This command only sends GET requests. It is not wired into the credential-free compiler or current build workflow.

These checks alone do **not** establish deployment ordering. The subsequent coordinator now supplies the durable intent/fence, atomic audit and lost-response reconciliation described in [the activation review](17-preview-activation.md). An unresolved attempt blocks a later activation until positively reconciled. GitHub concurrency alone is not FIFO and does not resolve an in-flight request after a runner failure. Activation stays disabled until explicitly configured; validation/packaging failures leave the existing deployment untouched.

Candidate discovery and private-preview controls are now connected in `19-preview-console.md`. Private reports follow in `20-private-build-diagnostics.md`. Next: production publishing, then the minimal guarded Worker and separate Access application for an isolated live proof. The owner's original instructions reserve Access/dashboard changes and interactive login to the owner. Domain/DNS cutover remains a later explicit step.

## Review and evidence

The new tests exercise signed synthetic JWTs and the actual static asset router in workerd, private/no-store headers, PDF/HEAD/range behavior, redirects, localized 404s, incomplete or altered output, expired captures, private-file exclusion and active-version comparison. Compiler bytes in unit fixtures are explicitly simulated; the separate full TeX Live workflow proves real output packaging.

The first full local checkpoint passed all 150 tests across 22 files. The added actual-asset-routing test and updated environment isolation checks subsequently passed, bringing the suite to 151 cases. TypeScript, lint, formatting, the admin build and asset/CSP checks are included in the validation for this increment. Admin JavaScript remains 247,324 bytes. A local Wrangler dry-run bundles the private guard at 851.86 KiB (138.78 KiB gzip), with only the static asset binding. These local results do not establish a live Access configuration or successful deployment.

This is infrastructure work. It adds no browser script, public copy, layout, token or motion. The section comparisons in `06-design-reference-review.md` and `13-public-site-progress.md` continue to govern the design. Live Access policy, private browser preview and save-to-live latency are still unproven for this new target. PR #9 stays in draft until the remaining Phase 3 connections and evidence are complete.
