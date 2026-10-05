# mohamedeghboudj

Personal platform for **MOHAMED CHARAF EDDINE DEGHBOUDJ**: an English, French and Arabic static site, an owner-only content console, and a LaTeX CV engine backed by the same content database.

**Current stage: Sprint 0 risk spike.** Live Access/MFA, Gmail delivery, trilingual CV compilation and one complete static publish are verified. The first publish took 27m26s from capture, including a 21m17s GitHub runner queue during a reported outage; job start to live took about 3m54s. The owner chose to retain the static architecture and repeat the measurement after GitHub recovers before closing the latency gate. See the [publish evidence](docs/10-live-publish-evidence.md). This is a diagnostic scaffold, not the finished portfolio or admin UI. Read the [architecture](docs/01-architecture-overview.md), [design](docs/02-design-ui-ux.md), [database](docs/03-database-infrastructure.md), [engineering](docs/04-engineering-qa-review.md), and [security](docs/05-security.md) briefs in order before extending it. The [reference review](docs/06-design-reference-review.md) and [Sprint 0 ledger](docs/07-sprint-0-readiness.md) record decisions and evidence.

## Local development

Node **24.21.0** and pnpm **10.34.6** are pinned in `.nvmrc`, `engines`, and `packageManager`. Corepack selects pnpm. Check that tool paths are outside conda before starting. Use `pnpm.cmd` in PowerShell if execution policy blocks `pnpm.ps1`; do not change machine-wide execution policy.

This workspace also has a verified, ignored Node/Corepack bootstrap under `.tools`. Here, `scripts\pnpm.cmd` uses it and preserves the pinned version in nested scripts. This convenience wrapper needs that local bootstrap; other checkouts should use their installed Node 24 and Corepack.

```powershell
.\scripts\pnpm.cmd install --frozen-lockfile
.\scripts\pnpm.cmd check
.\scripts\pnpm.cmd db:local
.\scripts\pnpm.cmd spike:local
.\scripts\pnpm.cmd cv:prepare
.\scripts\pnpm.cmd build:site
.\scripts\pnpm.cmd check:static
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

| Path                          | Purpose                                                         |
| ----------------------------- | --------------------------------------------------------------- |
| `GET /api/session`            | Confirm verified owner identity                                 |
| `PUT /api/education/:id`      | Transactional content/translation/CV-selection save and audit   |
| `PUT /api/profile`            | Transactional profile save and audit                            |
| `GET /api/snapshot`           | Explicit public field projection with hash                      |
| `POST /api/publish/capture`   | Capture snapshot/hash for the owner-dispatched publish workflow |
| `GET /api/inbox`              | Owner-only inbox JSON                                           |
| `POST /api/inbox/:id/replied` | Mark message replied and audit                                  |
| `POST /contact`               | Isolated Turnstile-verified contact ingestion                   |

Mutations require the configured origin. The admin verifies Access JWT signature, issuer, audience, expiry and owner email independently of the edge. The contact Worker binds only inbox D1. It bounds and validates input, checks Turnstile hostname/action, enforces atomic visitor/global quotas, deduplicates submissions, stores before notification, and reports failed sends in the inbox. The owner-approved spike uses Cloudflare's dummy response contract; production mode rejects dummy keys. The live fixed-recipient notification reached the owner's Gmail Inbox with correct Reply-To.

## Verification and remaining work

The local suite covers real SQLite/D1 transactions and rollback, append-only audit, selection foreign keys, database isolation, snapshot privacy, actual JWT verification, contact retries/concurrent quotas/retention, translation fallback and adversarial LaTeX input. CI runs typecheck, lint, format, tests, dependency audit and a static build. The separate CV workflow compiles committed synthetic fixtures on pull requests without secrets; private CV variants must never use its public artifacts.

The owner-supplied English/French TeX references guide the [shared CV layout](docs/08-cv-reference-review.md). Poppins fonts and their license are bundled and verified; Arabic uses Amiri and real RTL shaping. Reference files and personal contact details stay outside the public repository.

The protected `/spike` diagnostic saves an item and downloads a public snapshot capture for the measured publish workflow. The [publish handoff](docs/09-publish-spike-handoff.md) lists the exact owner-only CI setup and measurement steps. Full content schema, React console, design system, hero, timeline, projects and generated visuals remain gated on the completed risk proofs.
