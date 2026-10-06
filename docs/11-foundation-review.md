# Foundation implementation and review

On 2026-10-05 the owner accepted the measured 4m12s capture-to-live repeat and authorized phase 1. This implementation retains the static architecture, independent Access JWT checks, isolated contact Worker and full TeX Live compiler. Foundation validation below was performed on 2026-10-06.

## What is implemented

- The workspace now includes `packages/ui` and a Hono-typed `packages/api-client`. A pinned React/Vite console shell consumes them. The shell verifies the owner session and links to the existing synthetic publish diagnostic; content editing follows in phase 2. It contains no custom login or authentication bypass.
- Shared tokens cover a restrained palette, type roles, spacing, dimensions, focus and motion timing. Public Astro pages and the admin consume one stylesheet. The [design comparison](06-design-reference-review.md) records the reference patterns and limits of this foundation review.
- Content migrations expand the education-only spike into normalized base/translation tables for the complete content model, including writing, media, categories, technologies, project relations, navigation, SEO and social links. Contact details and media default to private. Public snapshots remain explicitly allowlisted and education-only until phase 3 expands their versioned contract.
- Every CV-selectable type uses `content_items`, including languages so they can participate in CV selection. Database guards reject a row whose identity has the wrong kind and prevent changing a kind. Five private preset rows and one required public slot are data; localized item overrides have composite foreign keys. New preset content is deliberately empty rather than invented.
- Inbox migration adds subject, starred state and private notes; thread/outbox structures remain ready for the later email integration. The public contact Worker still has only an inbox binding.
- Central document/API policies prohibit inline script/style and framing. Astro emits external CSS. Every console asset passes through the Worker before being served, and admin responses remain `no-store`. Unknown API routes return JSON 404, never the SPA shell. See Cloudflare's [Worker-first asset routing](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/).
- Environment validation rejects shared database IDs, resource names and origins across local, preview and production. Each generated Worker config contains its complete binding set; no binding inheritance is assumed. See Cloudflare's [environment rules](https://developers.cloudflare.com/workers/wrangler/environments/).

## Migration safety

Migrations 0001 and 0002 are preserved. Migration 0003 copies the spike identities and all dependent education/translation/CV-selection rows into constrained replacement tables, drops children before parents, then renames the replacements inside the migration transaction. This avoids the cascading deletion behavior documented in [D1's SQL reference](https://developers.cloudflare.com/d1/sql-api/sql-statements/). Migrations 0004 and 0005 add identity guards, lookup indexes and the remaining content details.

Tests start with a populated original spike database. They verify translations, revision, audit and ordered selections survive the upgrade; an intentional failure after the replacement statements rolls the entire migration back. A fresh-install path also runs. SQL migrations define database constraints; Drizzle supplies typed application queries. A schema inspection test compares every declared column with the migrated database and checks every foreign key and locale lookup has a usable leading index.

The public CV slot is retained rather than deleted/replaced. Its summary and selection remain editable in the content phase; additional private variants are ordinary rows. Actual template expansion and compilation of the five full variants remain phase 5.

## Environment state

| Environment | Content / inbox resources         | Schema and routing                                                       |
| ----------- | --------------------------------- | ------------------------------------------------------------------------ |
| Local       | Existing separate local D1 stores | Foundation migrations applied; local commands explicitly use `--local`   |
| Preview     | Dedicated remote pair created     | All migrations applied; integrity checks pass; no routed Worker deployed |
| Production  | Dedicated remote pair created     | Empty, no migrations, test writes or routed deployment                   |
| Sprint 0    | Existing isolated spike pair      | Existing live deployment and schema unchanged                            |

Preview content has 57 application tables and six CV variants, exactly one public. Preview inbox has zero messages. Both `PRAGMA foreign_key_check` results are empty. Exact IDs, origins and remote query evidence stay in ignored `environments.private.json`, generated `wrangler.preview.json` / `wrangler.production.json`, and `artifacts/foundation/`.

The checked-in `environments.example.json` contains placeholders. After filling the ignored manifest, `pnpm env:configure preview` or `pnpm env:configure production` validates it and generates configs. The generator does not create resources, configure accounts or deploy; all routing defaults off. Regenerating replaces the generated files, so keep account-specific additions in the manifest/generator rather than relying on manual edits surviving regeneration.

Production migrations follow review of this change. A new preview admin will require its own Access application/AUD and Independent MFA before use; the previously proved spike AUD must not be reused for another application. The owner retains account/dashboard, DNS and interactive-login steps. Real Turnstile is required for a deployed contact form; the dummy exception remains confined to the existing spike/local test path. Email bindings, R2, private backups and deploy workflow credentials are configured in their relevant build phases. Missing runtime configuration fails closed.

## Validation

- Strict TypeScript, ESLint, Prettier and 48 tests pass, including existing JWT, contact, snapshot privacy and TeX escaping tests.
- Dependency audit: no known vulnerabilities in the installed lockfile.
- Wrangler local migrations and remote preview migrations pass. No foreign-key violations remain in either preview database.
- React/Vite and all three Astro routes build. Static checks confirm EN/FR/AR content/revision in the first response, Arabic direction and no public JavaScript.
- Built HTML and headers pass CSP compatibility checks. The admin JavaScript bundle is 225,744 bytes uncompressed and contains no server configuration strings.
- Wrangler's preview admin deployment dry run bundles successfully. This does not claim a deployed preview login or browser rendering test.
- CI now builds both apps and checks their assets on every push/PR; the existing trilingual TeX Live workflow also applies the new migrations to synthetic fixtures.

Browser/axe, actual device performance, final typography, full content CRUD, public page composition, live publish race/failure exercises and the backup restore drill are still their respective later-phase work. No live deployment or merge is performed by this foundation change.
