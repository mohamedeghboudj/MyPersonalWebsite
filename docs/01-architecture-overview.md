# Brief 1 of 5 — Architecture & System Overview

You are building a personal platform, not a résumé template. This file defines what it is and how its pieces fit together. Four companion briefs go deeper on one area each: `02-design-ui-ux.md`, `03-database-infrastructure.md`, `04-engineering-qa-review.md`, `05-security.md`. Read this one first regardless of which of the others you were handed — it's the shared context all four assume.

If anything below conflicts with a request made to you in conversation, this document wins unless the person explicitly says they're changing the plan.

## What this is

Two public-facing sides plus one engine underneath:

- **Public site.** Anyone can visit. Shows education, professional experience, certificates, achievements, initiatives, skills, languages, and a multi-field project portfolio spanning AI, design, management, web development, and app development. The bar for the build is a well-made Apple product page, not a typical personal-website template: fast, restrained, deliberately animated, never cluttered. Full design brief in `02-design-ui-ux.md`.
- **Admin console.** One user only, the owner. Every piece of public content — every education entry, every certificate, every project, every skill, every line of every CV summary — is added, edited, reordered, and hidden from this console. Nothing on the public site is hardcoded into a page template. Adding a certificate is a console form submission, never a code change.
- **CV engine.** Not a static PDF sitting in a folder. A LaTeX document assembled from the same content the console manages, compiled fresh so it always reflects current data. Two ways to get one: a generic public download, and a fully customizable admin-only version with five preset profiles. Detailed in this file's CV Engine section and in `03-database-infrastructure.md`.

## Non-negotiable constraints

- **Zero ongoing cost.** A payment card is on file at Cloudflare (required to enable R2; the tier itself is still $0) but nothing may actually charge it. Every component runs inside a *permanent* free tier — not a trial, not an expiring credit. Reject any service whose free offering is a time-boxed credit (Azure, DigitalOcean, Heroku) as a foundation; those are fine for something disposable, never for this.
- **Reuse over reinvention.** Prefer a mature, audited service over custom code wherever one covers the need — this is why auth is Cloudflare Access, not a hand-rolled login system; why spam protection is Turnstile, not a custom CAPTCHA; why the LaTeX compiler is a maintained GitHub Action, not a bespoke WASM build. Custom code is for this project's actual content and behavior, not for infrastructure that already exists.
- **Everything editable without a deploy.** If a content change requires a code change or a redeploy, that's a defect. The one exception is the ~2-minute publish delay described below, which is a deliberate trade for security and performance, not a bug.
- **One source of truth.** All content — public site, both CV paths — reads from one relational database. Never duplicate content into a second store, a hardcoded array, or a parallel JSON file. See `03-database-infrastructure.md` for the schema.
- **The owner is the only privileged user.** There is no multi-tenant concern, no team permission model. Don't build one.

## System shape

```
Visitors ──────► Public site (static HTML/CSS/JS)
                  Astro + React islands, on Cloudflare Workers Static Assets
                  No server code, no database connection, no cookies

Visitors ──────► Contact Worker (Hono, isolated)
                  Turnstile + validation ──► inbox D1 database only

Owner ─────────► Cloudflare Access (on the Worker itself: custom domain +
                  workers.dev + preview URLs) + Independent MFA (hardware
                  key / biometric)
                  ──► Admin console (React + Vite) + API (Hono Worker)
                  ──► content D1 database + inbox D1 database + R2 (media)

content D1 ────► Publish pipeline (GitHub Actions)
                  snapshot (explicit public-table allowlist) ──► build ──►
                  deploy to Workers Static Assets
                  same run also compiles the public CV (full TeX Live)

Owner (console)─► "Generate CV" ──► GitHub Actions workflow_dispatch
                  ──► full TeX Live compile ──► cached PDF (SHA-256 of
                  template version + payload, stored in D1/KV)
```

| Layer | Technology | Notes |
|---|---|---|
| Public site | Astro, React islands, TypeScript | Static output. Content in the first HTTP response — no client-side fetch needed to see the page. |
| Public hosting | Cloudflare Workers Static Assets | Unmetered static traffic. A traffic spike can't take the site down or cost money. |
| Admin console | React + Vite, TypeScript | Served on its own subdomain (e.g. `admin.yourdomain.me`) — separate origin from the public site, separate cookies, separate CSP. |
| API | Hono, on a Cloudflare Worker | One worker for admin + content operations. A **second, separate** Hono Worker handles only the public contact form — kept isolated so a public-facing endpoint never shares a binding with the privileged API. |
| Database | Cloudflare D1 (SQLite), via Drizzle ORM | **Two databases**: `content` (everything the console manages) and `inbox` (contact submissions), isolated from each other. See `03-database-infrastructure.md`. |
| Media | Cloudflare R2 | Original images, certificate scans, project galleries. Public site serves *optimized derivatives baked into the static build*, not live R2 reads, so visitor traffic never touches R2 either. |
| Cache | Cloudflare KV | Small structured data only — compiled CV PDFs keyed by content hash, not a media store. |
| Auth | Cloudflare Access + Independent MFA | No custom login system, no passwords anywhere in this stack. Full detail in `05-security.md`. |
| CI/CD + CV compiler | GitHub Actions | Build/test/deploy on every push; compiles the public CV during the publish run; compiles admin CV variants via `workflow_dispatch`, authenticated, owner-triggered only. |
| Email | Cloudflare Email Routing → Gmail (v1), Resend (v2, once domain is DNS-verified with them) | See Contact System below. |
| Domain | `.me` via the GitHub Student Developer Pack (Namecheap offer), DNS on Cloudflare | Owned by the person once claimed — survives the student-pack eligibility ending, unlike the credit-based services above. |
| Motion | GSAP + ScrollTrigger, three.js for one hero object | Full detail in `02-design-ui-ux.md`. |

## Content model

Every type below is console-managed, not hardcoded. Each gets: a base table (facts, dates, ordering, visibility), a translations child table (per-locale text — see Trilingual Content below), and a console CRUD screen. Full schema in `03-database-infrastructure.md`.

- **Profile** — name, headline, bio, portrait, contact details, social links
- **Education** — institution, program, specialty, dates, status, description
- **Experience** — organization, role, employment type, dates, achievements, links
- **Certificates** — title, issuer, dates, credential reference, verification URL, optional public document
- **Achievements** — title, awarding body, date, context, evidence
- **Initiatives** — purpose, role, dates, outcomes, collaborators, related projects
- **Skills** — category, description, evidence, display order
- **Languages** — language, proficiency, supporting certificate
- **Project categories** — name, slug, description, cover image, visibility, order. Created from the console; the public site reflects a new category immediately on next publish, no code change.
- **Projects** — name, summary, case-study body, role, dates, outcomes, technologies, repository link, demo link, media, **multiple** categories per project (a project can be both "AI" and "Web Development")
- **Writing / Articles** — schema exists from day one; console UI and public pages are a later phase (see Build Phases). Same treatment applies to an optional "share to LinkedIn" action: build it as a console button that opens a prefilled LinkedIn post-intent link, not automatic posting — automatic posting needs a reviewed LinkedIn developer app for a feature the owner doesn't consider necessary.
- **Site settings** — navigation, footer content, SEO defaults, theme options
- **CV variants** — see CV Engine below
- **Contact messages** — lives in the separate `inbox` database, never the `content` database

## Publish pipeline

Saving in the console is instant. Going live is not — and that gap is the entire reason the public site can be static, unmetered, and hard to attack.

1. **Save.** Console write lands in the `content` D1 database immediately. Nothing public changes yet.
2. **Preview.** The owner can preview unpublished changes privately, behind Access.
3. **Publish** (manual click, or auto-triggered after a short debounce). Generates a **snapshot**: a JSON export built from an explicit allowlist of public tables and columns — never a raw database dump, and `contact_messages` is structurally incapable of appearing in it.
4. **Build.** GitHub Actions consumes the snapshot, builds the Astro site, compiles the public CV in the same run, and runs the full CI gate (see `04-engineering-qa-review.md`).
5. **Deploy.** New version goes live on Workers Static Assets. Deployment concurrency is controlled so an older, slower build can't finish after and overwrite a newer one. If a build fails, the last successful deployment stays live and the error is visible only to the owner.
6. **Category slug changes** generate a redirect from the old URL automatically — a category is never allowed to 404 an indexed page.

Expect roughly two minutes from click to live. Measure the real number in the Sprint 0 spike (below) — if it's unacceptable, the documented fallback is server-rendered pages with cache purge, which trades some of the static-site security and cost benefits for instant updates. Don't build that unless the measured number forces it.

## CV Engine

A CV is a pure function: **snapshot + variant + (company, role) → PDF.** Variants are data (rows in the database), not separate code paths — a sixth variant is a console action, not a deploy.

- **Public CV** — one variant, flagged public, generic. Compiled automatically inside every publish run, so it's never stale and there is no visitor-triggered compile endpoint (no public compute surface). **No company/role prompt** on this path — that stays admin-only. This was explicitly confirmed with the project owner; don't add it without asking.
- **Admin CVs** — five presets, each a data row with its own summary, item selection, and item order:
  1. Aviation
  2. AI
  3. Software engineering / jobs (asks which kind of role — teaching, software engineering, AI, etc. — and adjusts selection accordingly)
  4. Research / universities
  5. Initiatives, youth, leadership, management
  - Every admin download prompts for the target company or university name and the role, and prints it into the document (e.g. "Application to `{company}` — `{role}`"). This is presentation, never a rewrite of factual content.
  - Compiled via an authenticated, owner-only GitHub Actions `workflow_dispatch` run.
- **Trilingual**: every CV variant compiles in English, French, and Arabic. Arabic needs full right-to-left shaping, not a mirrored layout hack.
- **Compiler: full TeX Live in GitHub Actions, not Tectonic.** Tectonic (XeTeX-based, self-contained, reproducible via a frozen "bundle") was the initial pick, but its bundle has a documented history of breaking on `polyglossia` — exactly the package Arabic typesetting depends on. Full TeX Live (e.g. via a container-based action pulling a `texlive/texlive` image) gives current `polyglossia` + `bidi` + `fontspec` without betting on a frozen snapshot. It's heavier per run; mitigate with container layer caching, not by reverting to Tectonic.
- **Selection integrity**: CV items reference content through a shared `content_items` identity table with a real foreign key — never a loose `(item_type, item_id)` pair with no enforceable constraint. Full schema in `03-database-infrastructure.md`.
- **Security**: templates receive data, never raw LaTeX from a form; every field is escaped; the compiler runs with shell-escape disabled, no network, and a hard time limit. Full detail in `05-security.md`.
- **Caching**: PDFs are keyed by SHA-256 of (template version + resolved payload). A cache hit returns instantly; a miss triggers a compile.
- Browser-side LaTeX (WASM engines) was considered and rejected: GitHub Actions is confirmed compliant for this usage (see the ToS note in `05-security.md`), and browser WASM engines are markedly less proven for Arabic shaping than a full server-side TeX Live — not worth the risk for the harder language.

## Contact system

The one thing that wasn't in the original spec and is exactly as important as everything else: a form that stores messages for the console and lets the owner reply by email.

1. Visitor submits (name, email, message) on a small, isolated public Worker.
2. Turnstile (server-verified) + honeypot + rate limits + an idempotency key (dedupes retried submissions) before anything is stored.
3. Message is written to the **`inbox`** database — structurally isolated from `content`, so the public contact Worker only ever holds the inbox binding.
4. Cloudflare Email Routing sends a notification to the owner's Gmail, with Reply-To set to the visitor so replying in Gmail goes straight to them.
5. **v1 reply flow**: console shows the message with a "Reply" button that opens a prefilled `mailto:`, plus a "mark replied" toggle. Reply happens from Gmail.
6. **v2 (once the domain is DNS-verified with Resend)**: compose and send replies directly from the console via Resend (free tier: 3,000/month, 100/day). Design the schema (`threads` + `messages`, an `outbox` table for tracking sends) so this is additive later, not a rewrite now.
7. Never build inbound email parsing or automatic threading — unnecessary complexity and CPU-limit risk for a one-admin inbox. Gmail already threads.

## Trilingual content

- Canonical locale is **English**, served with no path prefix. French is `/fr/`, Arabic is `/ar/`. Never split by subdomain — subpaths keep one Cloudflare zone and make `hreflang` and sitemaps trivial.
- Fallback chain: requested locale → English → any available. An item not yet translated into Arabic still renders (in English) on the Arabic page rather than vanishing. Console shows a translation-completeness badge per item.
- Astro's built-in i18n routing generates the three route trees from the same components.
- Arabic pages get `lang="ar" dir="rtl"`. **Design tokens must be RTL-aware from the start** — logical CSS properties (`margin-inline`, not `margin-left`) everywhere, or the motion layer needs a rewrite later. GSAP/ScrollTrigger animations stay limited to `transform`/`opacity`, which are direction-agnostic and port to RTL for free.
- Per-locale `hreflang` alternates, sitemap entries, JSON-LD (`inLanguage`), and OG images. The publish snapshot is generated per locale.

## Explicitly rejected — do not suggest these

| Rejected | Why |
|---|---|
| Vercel Hobby | Terms restrict it to non-commercial personal use; a portfolio that helps win paid freelance work sits on the wrong side of that. |
| Supabase | Free projects pause after roughly a week of inactivity — a cached static site is idle between owner edits, which is exactly when the contact form would need it. |
| Firebase / Blaze | Cloud Storage and Functions require the billing-linked Blaze plan even at trivial volume. |
| Next.js server-rendering for the public site | The public site needs no server at all; keeping it fully static removes an entire attack surface and cost dimension. |
| A custom passkey system in the admin app | Cloudflare Access's Independent MFA (hardware key / biometric, enforced by Access itself) gives the same two-factor guarantee with zero custom auth code. |
| Browser-side (WASM) LaTeX compilation | GitHub Actions is confirmed acceptable for this use, and is more capable for Arabic than current browser engines. |
| Tectonic as the CV compiler | Its frozen bundle has broken on `polyglossia` (Arabic) before; full TeX Live doesn't have that risk. |
| Google Sheets or JSON-in-Git as the primary datastore | No transactions, weak access control, and this data is genuinely relational (CV variants are ordered selections across many tables). |

## Repo structure

```
apps/site        — public Astro site
apps/admin        — console (React + Vite) + Hono API worker
worker/contact     — isolated public contact Worker
packages/schema    — Zod schemas; source of truth each content type derives from
packages/ui        — shared components (nav, footer, design tokens)
packages/config     — cookie names, CSP, session lifetime, allowed origins,
                       env schema — validated at startup, nothing app-local
packages/api-client — typed client generated from the Hono routes
packages/cv-engine   — assembler, LaTeX templates, escaper
database/            — migrations, seeds, snapshot generator
.github/workflows    — CI, publish, CV compile (dispatch)
```

One content-type registry, one layout per app, one design-token file, one config package. A new content type or section is one new file across this structure, not a change scattered through a dozen places.

## Build phases

0. **Risk spike** (before any real screens): Access + Independent MFA login proven on the bare `workers.dev` address; one item saved → published → verified live, with the real latency measured; one CV compiled in all three languages including Arabic, with the real time measured; one contact submission traced end-to-end into Gmail, confirmed not in spam. If the publish or compile numbers are unacceptable, that's the point to reconsider, before anything else is built on top.
1. Foundation — monorepo, CI, tokens, migrations, security headers, environments.
2. Content registry + console CRUD for every type + audit log.
3. Public site + SEO/JSON-LD + the publish pipeline.
4. Contact system.
5. CV engine — five variants, company/role prompt, trilingual, cache.
6. Motion and 3D — last, on real content, inside performance budgets. Three signature moments (hero, timeline, projects) done excellently beats every section lightly animated.
7. Hardening — ASVS pass, restore drill, real-device testing.

Animation is deliberately last. It's what makes the site memorable, and also what most easily breaks things — it belongs on top of something that already works, not woven through a foundation that hasn't been proven yet.

## Glossary

- **Snapshot** — the JSON export of public content, built from an explicit allowlist, that the site build and public CV compile both consume. Never a full database export.
- **content_items** — the shared identity table that gives every CV-selectable content row (an education entry, an experience, an achievement...) one real foreign-key-able ID, so CV item selection isn't a loose, unconstrained pair of strings.
- **Variant** — a CV preset (data, not code): a summary, an ordered item selection, a visibility ruleset.
- **Independent MFA** — Cloudflare Access's own hardware-key/biometric challenge, enforced by Access regardless of the upstream identity provider.
