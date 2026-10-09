# mohamedeghboudj

Personal platform for **MOHAMED CHARAF EDDINE DEGHBOUDJ**: an English, French and Arabic static site, an owner-only content console, and a LaTeX CV engine backed by the same content database.

**Current stage: Phase 3, public snapshot and static presentation.** Sprint 0's four proofs passed; the owner accepted **4m12s capture-to-live** latency. The protected content console and fresh-login deletion recovery are proven live. The first public increment adds an explicit v2 snapshot and EN/FR/AR page templates; media processing and the expanded publishing/CV pipeline are still in progress. See the [public preview and remaining work](docs/13-public-site-progress.md), [console review](docs/12-content-console-review.md) and [publish evidence](docs/10-live-publish-evidence.md). Read the [architecture](docs/01-architecture-overview.md), [design](docs/02-design-ui-ux.md), [database](docs/03-database-infrastructure.md), [engineering](docs/04-engineering-qa-review.md), and [security](docs/05-security.md) briefs in order before extending it. The [reference review](docs/06-design-reference-review.md) and [Sprint 0 ledger](docs/07-sprint-0-readiness.md) record decisions and evidence.

## Local development

Node **24.21.0** and pnpm **10.34.6** are pinned in `.nvmrc`, `engines`, and `packageManager`. Corepack selects pnpm. Check that tool paths are outside conda before starting. Use `pnpm.cmd` in PowerShell if execution policy blocks `pnpm.ps1`; do not change machine-wide execution policy.

This workspace also has a verified, ignored Node/Corepack bootstrap under `.tools`. Here, `scripts\pnpm.cmd` uses it and preserves the pinned version in nested scripts. This convenience wrapper needs that local bootstrap; other checkouts should use their installed Node 24 and Corepack.

```powershell
.\scripts\pnpm.cmd install --frozen-lockfile
.\scripts\pnpm.cmd check
.\scripts\pnpm.cmd db:local
.\scripts\pnpm.cmd spike:local
.\scripts\pnpm.cmd cv:prepare
.\scripts\pnpm.cmd build:admin
.\scripts\pnpm.cmd build:site
.\scripts\pnpm.cmd check:static
.\scripts\pnpm.cmd check:assets
```

On other systems, substitute `pnpm` for `.\scripts\pnpm.cmd`. `db:local` always uses local D1 storage. `spike:local` saves explicitly synthetic education content, exports an allowlisted snapshot into ignored `artifacts/`, and records local timing. The static build reads this snapshot and emits `/`, `/fr/`, and `/ar/` with content present in the first HTML response. It has no runtime database binding, client script or session cookie.

`cv:prepare` creates escaped LaTeX and payload hashes; it does **not** compile PDFs. `cv:compile` requires Docker and runs full TeX Live with no network, shell escape, deployment credentials or writable host filesystem beyond its output folder. It records actual per-language timings. GitHub Actions performs that step on Linux; rendered Arabic pages still need visual inspection.

## Workers and private configuration

`apps/admin/wrangler.json` and `worker/contact/wrangler.json` contain dummy local database IDs and disable public routes. Separate **ignored** `wrangler.spike.json` files in this workspace refer to the isolated remote spike databases. Account identifiers, deployment addresses and notification addresses stay out of the public repository. Remote configuration is not used by the local scripts. No remote credentials are committed.

Use `npx.cmd --no-install wrangler` for the installed pinned CLI. For example:

```powershell
npx.cmd --no-install wrangler whoami
npx.cmd --no-install wrangler dev --local --config apps/admin/wrangler.json --persist-to .wrangler/state --port 8787
```

Copy each Worker's `.dev.vars.example` to its ignored `.dev.vars` only when filling in real local configuration. Deployed secrets go through `wrangler secret put --config <worker-config>`; CI credentials belong in GitHub Actions secrets. Never paste secrets into chat. Missing configuration returns 503. Missing or invalid Access JWTs are rejected; there is no deployable authentication bypass or custom login form.

| Path                                    | Purpose                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| `GET /api/content/registry`             | Content forms and validation metadata                           |
| `GET/POST /api/content/:type`           | Paginated content list / create                                 |
| `GET/PUT/DELETE /api/content/:type/:id` | Read, atomically save or delete with revision check             |
| `GET /api/content/overview`             | Revision and changed-field audit activity                       |
| `POST /api/media`                       | Bounded private file upload                                     |
| `GET /api/media/:id/download`           | Owner-only attachment download                                  |
| `GET /api/session`                      | Confirm verified owner identity                                 |
| `PUT /api/education/:id`                | Transactional content/translation/CV-selection save and audit   |
| `PUT /api/profile`                      | Transactional profile save and audit                            |
| `GET /api/snapshot`                     | Explicit public field projection with hash                      |
| `GET /api/public-snapshot`              | Owner-only expanded v2 public projection with hash              |
| `POST /api/publish/capture`             | Capture snapshot/hash for the owner-dispatched publish workflow |
| `GET /api/inbox`                        | Owner-only inbox JSON                                           |
| `POST /api/inbox/:id/replied`           | Mark message replied and audit                                  |
| `POST /contact`                         | Isolated Turnstile-verified contact ingestion                   |

Mutations require the configured origin. The admin verifies Access JWT signature, issuer, audience, expiry and owner email independently of the edge. The contact Worker binds only inbox D1. It bounds and validates input, checks Turnstile hostname/action, enforces atomic visitor/global quotas, deduplicates submissions, stores before notification, and reports failed sends in the inbox. The owner-approved spike uses Cloudflare's dummy response contract; production mode rejects dummy keys. The live fixed-recipient notification reached the owner's Gmail Inbox with correct Reply-To.

## Verification and remaining work

The local suite covers real SQLite/D1 transactions and rollback, append-only audit, selection foreign keys, database isolation, snapshot privacy, actual JWT verification, contact retries/concurrent quotas/retention, translation fallback and adversarial LaTeX input. CI runs typecheck, lint, format, tests, dependency audit and a static build. The separate CV workflow compiles committed synthetic fixtures on pull requests without secrets; private CV variants must never use its public artifacts.

The owner-supplied English/French TeX references guide the [shared CV layout](docs/08-cv-reference-review.md). Poppins fonts and their license are bundled and verified; Arabic uses Amiri and real RTL shaping. Reference files and personal contact details stay outside the public repository.

The protected `/spike` diagnostic saves an item and downloads a public snapshot capture for the measured publish workflow. Sprint 0 is complete and its latency accepted. The [foundation review](docs/11-foundation-review.md) records the expanded schema, React/Vite shell, shared tokens, security policies and isolated environments. The [Phase 2 console](docs/12-content-console-review.md) adds editing, language coverage, nested relations, an audit log and private media handling. The finished public design, generated imagery and motion follow the brief's build order. The legacy diagnostic writes are available only in explicit spike mode.

For a disposable console preview, run `.\scripts\pnpm.cmd preview:console` and open `http://127.0.0.1:4173/`. This clearly labeled test harness uses temporary local data only. For browser checks, run `pnpm exec playwright install chromium`, then `pnpm build:admin` and `pnpm test:browser`. The authenticated deployed preview keeps persistent edits in its isolated preview databases.
