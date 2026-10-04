# Brief 3 of 5 — Database & Infrastructure

Read `01-architecture-overview.md` first — it defines the content model and system shape this file makes concrete. This is the backend spec: schema, normalization, transactions, and the infrastructure each piece runs on. Get this wrong and every other brief inherits the problem, so don't skip steps here to move faster.

## Databases: two, isolated on purpose

Cloudflare D1 (SQLite), via Drizzle ORM, in **two separate databases**:

- **`content`** — everything the console manages: profile, education, experience, achievements, certificates, initiatives, skills, languages, project categories, projects, CV variants, site settings, audit log.
- **`inbox`** — contact form submissions only.

This is not organizational preference, it's a security boundary: the public contact Worker gets *only* the `inbox` binding. It can never reach `content`, so a bug or compromise in the one public-facing write path can't touch the owner's actual data. The admin API is the only thing with bindings to both. Three environments (local, preview, production) each get their own pair of these databases — never develop or test against production data.

## Schema pattern: base + translation, not JSON blobs

The site is trilingual (English canonical, French, Arabic). Every content type gets **two tables**, not one column of JSON:

- A **base table**: facts that don't vary by language — dates, URLs, media references, ordering, visibility.
- A **translations child table**: one row per `(entity_id, locale)`, holding only the localized text.

```sql
-- Base: facts only. One row per education entry.
CREATE TABLE education (
  id            INTEGER PRIMARY KEY REFERENCES content_items(id),
  school_url    TEXT,
  logo_media_id INTEGER REFERENCES media(id),
  city          TEXT,
  country       TEXT,
  start_date    TEXT NOT NULL,
  end_date      TEXT,
  display_order INTEGER NOT NULL DEFAULT 0,
  is_visible    INTEGER NOT NULL DEFAULT 1
);

-- Translations: per-locale text. One row per (entry, locale).
CREATE TABLE education_translations (
  education_id INTEGER NOT NULL REFERENCES education(id) ON DELETE CASCADE,
  locale       TEXT NOT NULL CHECK (locale IN ('en','fr','ar')),
  school       TEXT NOT NULL,
  degree       TEXT,
  field        TEXT,
  description  TEXT,
  PRIMARY KEY (education_id, locale)
);
```

Why not a `{"en": ..., "fr": ..., "ar": ...}` JSON column: with child tables, "which entries are missing a French translation" is one indexed SQL join — that query is literally the console's translation-completeness dashboard. With JSON, you're parsing strings inside the Worker, which burns the 10ms-per-request CPU budget (see Response Time below) and makes the console dumber for no benefit.

Apply this same base + translation pattern to every content type: `experience`, `achievements`, `certificates`, `initiatives`, `skills`, `languages`, `project_categories`, `projects`. Non-translatable types (dates, media, links, technologies-as-tags) stay single-table.

**Fallback chain, enforced at the query layer, not per-page hacks:** requested locale → English → any available row. An item without an Arabic translation yet still renders (in English) on the Arabic route rather than disappearing.

## Shared identity for CV selection: `content_items`

A CV variant selects and orders items across every content type — an experience, then an achievement, then a project, in whatever order the owner picked. Do **not** implement this as a loose `(item_type TEXT, item_id INTEGER)` pair with no real constraint; SQLite/D1 cannot enforce "this `item_id` is valid for this `item_type`" as a genuine foreign key, and that gap becomes an integrity bug eventually.

Instead, every selectable content row gets a shared identity:

```sql
CREATE TABLE content_items (
  id         INTEGER PRIMARY KEY,
  kind       TEXT NOT NULL CHECK (kind IN
               ('education','experience','achievement','certificate',
                'initiative','skill','project')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Every per-kind base table's primary key is a foreign key back into `content_items(id)` (see `education.id REFERENCES content_items(id)` above — this is 1:1 "class-table inheritance," one extra shared table overall, not one extra table per type). Now CV item references are real, constrained foreign keys:

```sql
CREATE TABLE cv_variants (
  id            INTEGER PRIMARY KEY,
  slug          TEXT NOT NULL UNIQUE,       -- 'public', 'ai', 'aviation', ...
  is_public     INTEGER NOT NULL DEFAULT 0, -- exactly one row may be 1
  template      TEXT NOT NULL
);

CREATE TABLE cv_variant_translations (
  variant_id INTEGER NOT NULL REFERENCES cv_variants(id) ON DELETE CASCADE,
  locale     TEXT NOT NULL CHECK (locale IN ('en','fr','ar')),
  summary    TEXT NOT NULL,
  PRIMARY KEY (variant_id, locale)
);

CREATE TABLE cv_variant_items (
  variant_id      INTEGER NOT NULL REFERENCES cv_variants(id) ON DELETE CASCADE,
  content_item_id INTEGER NOT NULL REFERENCES content_items(id),
  section         TEXT NOT NULL,
  position        INTEGER NOT NULL,
  is_visible      INTEGER NOT NULL DEFAULT 1,
  bullet_override TEXT,  -- per-variant optional override text, translations handled the same base+translation way if non-trivial
  PRIMARY KEY (variant_id, content_item_id)
);
```

The five preset variants (aviation, AI, software-engineering/jobs, research/universities, initiatives-leadership-management) and the one public/generic variant are **seed rows**, not code. A sixth variant is an `INSERT`, triggered from the console — zero deploys.

## Remaining schema, by area

- **Projects**: `projects` (base) + `project_translations`, `project_categories` (base) + `project_category_translations`, `project_images` (R2 keys + alt text per locale), `project_links` (repo, demo, other), `project_technologies` (many-to-many join to a `technologies` lookup table), `project_category_map` (many-to-many — a project can belong to more than one category).
- **CV**: as above, plus a `cv_pdf_cache` table (or KV — see Caching) keyed by `sha256(template_version || variant_id || locale || company || role || content_hash)`.
- **Site**: `site_settings`, `seo_settings`, `social_links` — single-row or small lookup tables, no translation-table overhead unless the content genuinely needs to vary by locale.
- **Audit**: `audit_log` (actor, action, entity, before/after diff or a reference to it, timestamp) — every admin write, append-only.
- **Inbox** (separate database): `contact_messages` (name, email, subject, message, status, starred, private_note, idempotency_key UNIQUE, created_at), and an `outbox` table designed now (recipient, subject, body, status, sent_at) even though it isn't used until the v2 Resend integration — this makes that integration additive later instead of a schema migration under pressure.

## Normalization

Baseline is **third normal form** for every table above — no repeating groups, no column whose value is derivable from another column in the same row, no partial dependency on part of a composite key. The base + translation split is itself a normalization decision (it removes the repeating-group problem a single multi-language row would have). Departures from 3NF (a cached/denormalized value, for performance) must be deliberate, commented, and kept in sync by code, not by hoping — the CV PDF cache and any precomputed "translation coverage" counters are the only places this should show up.

Avoid, specifically:
- Any column holding a delimited list of values (a "technologies" CSV string) — use a join table (`project_technologies`).
- Any polymorphic foreign key pair without the shared-identity pattern above.
- Storing a computed value (like an item's current display order across multiple contexts) redundantly in more than one table when it only has one true owner.

## Response time and transactions

- **The public site never queries D1 directly.** It's static, built from the publish snapshot. Visitor traffic touches zero database rows. This is the single biggest thing keeping response time fast and D1's usage nowhere near its free-tier limits.
- **D1 is SQLite: single-writer.** Batch related writes into one transaction using D1's batch API rather than issuing sequential round trips — for example, saving a project along with its category associations and technology tags is one batch, not five separate awaited calls.
- **Index every foreign key and every lookup column**: `*_translations(locale)`, slug columns (`UNIQUE`), `cv_variant_items(variant_id)`, `content_items(kind)`, `audit_log(entity, created_at)`.
- **Avoid N+1 from the API layer.** Fetching a CV variant's full item list should be one joined query (or one batched set), not one query per item. Same for a project list with its categories and technologies.
- **The CV compile path is the one place real "transaction-like" thinking matters**: the assembler reads a consistent view of the data (ideally from the same snapshot the site build uses, not a live query mid-edit) so a CV never mixes content from before and after a concurrent save.

## Media: R2, now that a card is on file

Cloudflare R2 requires a payment method to enable even though the tier itself is $0 (10 GB storage, generous free egress). The card is on file specifically for this. Nothing else in this stack should need it.

- Originals and galleries live in R2. Metadata (key, alt text per locale, dimensions, content type) lives in `content` as a `media` table.
- **Public delivery does not read R2 live.** The publish build downloads and bakes optimized derivatives into the static site output, so visitor traffic never metered against R2 either.
- Certificate originals are private by default; a redacted copy or a verification link is a deliberate publish decision, not automatic.
- **No hard spending cap exists on Cloudflare.** Set a low budget alert (Cloudflare's Billable Usage dashboard) as an early-warning email — it's informational only, it does not pause usage, so it's a smoke detector, not a fuse. In practice, a personal portfolio's media footprint sits far under the free thresholds, so this is a safety net, not an expected event.

## Infrastructure stack, concretely

| Component | Detail |
|---|---|
| Public hosting | Cloudflare Workers Static Assets. Static requests are free and unmetered on this plan. |
| Admin API | Hono Worker, TypeScript, Zod validation on every input, Drizzle for all queries (never hand-built SQL strings) |
| Public contact API | A **separate** Hono Worker, isolated binding to `inbox` only |
| Auth | Cloudflare Access on the Worker (covers custom domain, `workers.dev`, and preview URLs at once) + Independent MFA. Full detail in `05-security.md` — this file only needs to know the console has no custom login system to build. |
| CI/CD | GitHub Actions: standard checks on every PR, the publish workflow, and the CV compile workflow (`workflow_dispatch`, owner-triggered) |
| CV compiler | Full TeX Live via a container-based GitHub Action (e.g. pulling a `texlive/texlive` image), not Tectonic — Tectonic's frozen bundle has a documented history of breaking on `polyglossia`, the package Arabic RTL depends on. Cache the container layer so repeat runs stay fast. |
| Email | Cloudflare Email Routing → Gmail (v1 notifications + owner replies); Resend (v2, once the domain is DNS-verified with Resend — their free `resend.dev` sender can only reach the account owner's own address, so this step is a hard prerequisite, not optional) |
| Domain / DNS | `.me` via the GitHub Student Developer Pack (Namecheap), DNS managed on Cloudflare |

## Free-tier facts that matter (verified, not assumed)

| Service | Limit | Consequence |
|---|---|---|
| Workers Static Assets | Unmetered static requests | Public traffic spikes are free and can't cause an outage |
| Workers (dynamic) | 100,000 requests/day, 10ms CPU/request | Fine — only the owner and occasional contact-form visitors hit this path |
| D1 | 5M row reads/day, 100K row writes/day, 500MB/database, 5GB/account | Irrelevant to visitors (they never touch D1); comfortable for one admin |
| R2 | 10GB storage, free egress, card required for the tier to activate | Set a budget alert; realistic usage is far under this |
| KV | 1GB storage, ~1,000 writes/day | Used only for the small CV PDF cache, not media |
| GitHub Actions | 2,000 min/month private (Free), 3,000 min/month if GitHub Pro is active (Student Pack) | Comfortable even with the heavier full-TeX-Live compile step; cache the container layer to keep runs short |
| Turnstile | Unlimited challenges, up to 20 widgets | No practical limit for this project |
| Cloudflare Access | Up to 50 users free | One user needed |

## Environments and backups

- **Three environments**: local (via `wrangler`'s local D1), preview, production — each with its own pair of `content`/`inbox` databases. Never point local development at production data.
- **Nightly export**: `content` only (never `inbox`/messages) to a private repository, as versioned JSON. Encrypt if it contains anything sensitive beyond ordinary public-facing content.
- **D1's built-in point-in-time restore** covers roughly the last 7 days as a secondary safety net, not the primary backup strategy.
- **Restore drill**: actually perform a restore from the nightly export before launch, don't just assume the export is restorable.
- **Contact messages get their own retention policy** — see `05-security.md` for the deletion schedule; they should never appear in the nightly export or in Git history at all.

## Definition of done for the backend

- [ ] Every content type follows base + translation, no JSON-blob multi-language columns
- [ ] Every CV item reference is a real foreign key through `content_items`, not a loose type/id pair
- [ ] Public site build never queries D1 at request time
- [ ] Every foreign key and lookup column is indexed
- [ ] Related writes are batched into one transaction, not sequential round trips
- [ ] `inbox` and `content` are genuinely separate databases with separate bindings
- [ ] Media originals are in R2; public delivery uses baked static derivatives, not live reads
- [ ] Nightly backup excludes `inbox` entirely and has been restored at least once as a test
- [ ] CV compiler is full TeX Live in Actions, verified against Arabic specifically, not assumed to work
