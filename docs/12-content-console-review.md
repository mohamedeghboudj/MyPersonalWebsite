# Phase 2 — content console

The owner approved Phase 2 after accepting the measured static publish latency. Foundation PR #7 is merged. This change adds the private content editor; the public presentation and expanded publish snapshot remain Phase 3 work.

## Implemented

One code-owned registry in `packages/schema/src/editor.ts` supplies form metadata and strict Zod input schemas. The React console uses the Hono client contract and shared UI tokens. It supports profile/contact details, education, experience/highlights/links, achievements, certificates, initiatives/collaborators/related projects, skills/categories/evidence, languages, projects/categories/technologies/galleries, social links, navigation, site settings, SEO defaults, media metadata and CV variant selections/overrides. Writing remains schema-only as briefs 01 and 02 require. Inbox screens and CV compilation controls remain their later phases.

Forms include EN/FR/AR coverage, Arabic direction, translation add/remove, child rows, ordering, visibility, paginated references, private text preview, unsaved-change warnings, confirmation before deletion, and actionable save/conflict feedback. Missing translations preview through requested language → English → available language. Reference choices preserve an existing selection even when it is outside the current page. The public CV and required singleton records cannot be deleted.

Saves validate on the server and atomically replace the affected base/translation/relation rows, advance the revision, and append an audit event with changed field names and before/after hashes. The audit does not copy content values. A stale revision or failed FK rolls the entire transaction back. Nested inserts are batched below D1's 100-parameter limit; the save statement cap reserves room for preflight reads within the 50-query free allowance. Historical category slugs stay reserved, and renaming back removes a self-redirect. [D1 limits](https://developers.cloudflare.com/d1/platform/limits/).

All requests still pass independent Access JWT verification and owner checking. Mutations require the configured origin. Deletions and navigation/site/SEO changes additionally check Access's provider-reported login time, with a five-minute freshness window. Application-token issuance time is not treated as evidence of a new login. Provider failures fail closed. The UI opens the normal Access sign-out/sign-in flow in another tab while retaining the draft in memory. No custom login or credential store exists. [Access token identity details](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/application-token/).

The legacy spike's save/capture screens are disabled outside explicit spike mode so they cannot erase fields added by the real editor. The unchanged v1 public snapshot deliberately still projects only the proven profile/education path. It is not presented as a publisher for the new content types.

## Private media

Uploads accept JPEG, PNG, WebP, AVIF and PDF after byte-signature inspection by pinned `file-type`, independently of the filename or supplied MIME. Bodies are bounded while streaming; files are capped at 8 MiB, and D1 enforces a 512 MiB library storage cap. Files use generated keys and start private. Owner downloads are attachments with `application/octet-stream`, `nosniff`, a sandbox CSP and no-store. Arbitrary SVG is rejected.

Images are not served inline from R2. Phase 3 must decode/re-encode optimized public derivatives and exclude private originals from its explicit snapshot. “Eligible for public derivatives” is metadata, not a public R2 URL. Certificate originals should remain private; upload a separate redacted copy for publication.

R2 and D1 are not one distributed transaction. A rejected database save attempts to remove its newly uploaded object. Successful metadata deletion queues its object key transactionally; cleanup retries on subsequent media operations. If both a save and its compensating R2 deletion fail, a private orphan may require reconciliation during the restore/maintenance work. No public object becomes visible through that failure.

## Preview and owner handoff

The existing protected admin Worker was deliberately upgraded in place and rebound to the isolated **preview** content/inbox pair. Its Access application, own AUD and previously proven Independent MFA remain attached to that same Worker identity. No AUD is reused across applications. Its ignored `apps/admin/wrangler.remote.json` is the deployment configuration. Preview URLs remain disabled, assets run through the Worker first, and production databases remain untouched. Migration `0006_editor_audit.sql` has been applied locally and to preview.

On 2026-10-08 the owner created the private preview R2 bucket. Authenticated Wrangler inspection confirmed Standard storage, disabled public development access, no custom domains, no CORS configuration, and only the default seven-day incomplete multipart upload cleanup rule. There is no object-expiration or storage-class transition rule. The existing protected preview Worker has been redeployed with the admin-only `MEDIA` binding. The ignored manifest now records the bucket and the existing protected Worker identity actually in use. The optional `mediaBucket` field rejects bucket reuse across environments. Production still has no media binding.

Owner verification after deployment: open the protected console, edit a sample entry, and check its EN/FR/AR preview. After the five-minute freshness window, a delete/settings save should request Access reauthentication; complete the provider flow in another tab, then retry. Existing edge MFA was proved in Sprint 0; this new freshness flow still needs live owner confirmation. Never send tokens, cookies or recovery codes.

For the remote media check, upload a disposable PNG or PDF under 8 MiB, download its private original, then use that item for the reauthentication/delete check. Local tests cover the upload transaction and cleanup, but successful binding deployment alone does not prove the authenticated remote user flow.

The owner also confirmed an existing Namecheap-registered domain already added to Cloudflare with DNS configured. It currently points to an existing GitHub repository/site. Its final destination will be this project's public site. Preserve that destination until the public build is ready. The exact hostname and current apex/www records will be confirmed when preparing the launch cutover; no DNS change or new domain purchase is needed for this preview. Dashboard and DNS changes remain owner actions. Detailed environment identifiers and the owner report are recorded in the ignored `artifacts/project-context.json`.

For a local UI preview with disposable data:

```powershell
.\scripts\pnpm.cmd preview:console
```

Then open `http://127.0.0.1:4173/` yourself. It is clearly labeled synthetic, uses ephemeral local D1/R2, binds only to loopback, rejects other Host values and has no remote bindings or credentials. The test server is outside all Worker entry points. Stopping it discards edits. The normal Wrangler admin still requires Access; no deployable auth bypass was added.

For the foundation public shell, run `pnpm --filter @platform/site exec astro preview --host 127.0.0.1 --port 4321` after the README's local build steps, then open `/`, `/fr/` or `/ar/`. The cinematic portfolio is not built in this phase.

## Validation and reference comparison

The 61-test Vitest suite passes against local D1/R2, including all 17 non-media editor sections, trilingual round trips, mixed CV selection, nested project relations, revision conflicts, rollback, redirect history, immutable audit, protected deletes, fresh-login enforcement, upload rejection and storage compensation. Typecheck, lint, formatting, both builds and static/CSP checks pass. No public JavaScript was added. Admin JavaScript is 246,346 bytes uncompressed against the unchanged 250,000-byte budget.

All three Playwright flows pass. The browser suite exercises real console/API/local-database flows, hostile text, validation, Arabic direction, fallback and desktop/mobile axe checks. Browser tests are part of CI. Their synthetic login substitutes do not prove the Cloudflare account policy; live Access confirmation stays separate. Chromium at 390px is not evidence of a real iPhone or Android test. Firefox/Safari, device performance and the complete publish/contact/CV flows remain required in their phases.

The dependency audit exposed the existing Miniflare dependency on sharp 0.35.4. An exact override to the patched 0.35.5 resolves the finding; the audit is clean. [Maintainer advisory](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).

Visual review compares the actual console captures against brief 02 and the full reference review: flat warm-neutral surfaces, Cursor's 24px gutters and metadata hierarchy, Integrated Biosciences' hairlines, a restrained blue interaction accent and no ornamental effects. The initial mobile navigation strip was replaced with a section selector. Forms use logical CSS, visible focus and 44px targets. No motion was added; the content remains complete under reduced motion. The public hero, timeline and project signature moments remain later work.

Preview deployment verified again on 2026-10-08 after attaching R2: anonymous requests to the document, media status API, content registry API and bundled JavaScript each returned HTTP 302 to the existing Access team. The preview database passed its foreign-key check after migration 0006. Remote upload/download and fresh-login confirmation remain owner checks.

At implementation commit `d9991acb2a8e9952dd56cfb9369e1bac71d2176b`, both [PR platform checks](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/37737213262) and [push platform checks](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/37737207835) passed, as did the [trilingual TeX Live compile](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/37737213297). These runs do not substitute for the remaining owner browser check.
