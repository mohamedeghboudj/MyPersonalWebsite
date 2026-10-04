# Brief 5 of 5 — Security

Read `01-architecture-overview.md` and `03-database-infrastructure.md` first — this brief secures the system they define. You are responsible for every angle of this: authentication, tokens, cookies, headers, input handling, the LaTeX pipeline, the contact form, secrets, backups, and account-level hygiene outside the app itself. Treat this as a continuous responsibility across the whole build, not a pass at the end.

## Threat model, stated honestly

No one can truthfully promise "nobody on Earth can get in" — governments, banks, and major technology companies get compromised. The real, achievable goal: a public side with nothing meaningful to attack, an admin console behind two genuinely independent checks, isolated blast radii so one failure doesn't cascade, and a design that assumes every boundary will eventually be tested. Judge every decision below against "assume this gets attacked — does it hold, and if it fails, what's the actual damage."

## Public site: nothing to attack

- Static files only. No server code executes on a visitor's request, no database connection, no cookies set.
- Third-party embeds (fonts, any script) are the only place the public site has any external dependency — keep this list as short as possible and pin versions.

## Admin authentication: two real, independent checks, zero custom auth code

- **Cloudflare Access, applied directly to the Worker itself** — this covers the custom admin domain, the `workers.dev` address, and preview URLs simultaneously, because the policy is attached to the Worker, not to individual hostnames. Do this before a custom domain even exists; there is no reason to leave the `workers.dev` address unprotected while waiting on DNS.
- **Independent MFA**: turn on Cloudflare Access's Independent MFA at the organization level and require a hardware security key or a platform biometric (Touch ID, Windows Hello) on the admin application's policy. This is enforced by Access itself, on top of whatever identity provider is used to log in (GitHub OAuth, Google, or a one-time email PIN) — it does not depend on that provider supporting or relaying MFA.
- This gives two genuinely separate checks — the identity-provider login, and a phishing-resistant hardware/biometric challenge Access enforces independently — **without writing, registering, storing, or recovering a single custom credential.** Do not build a parallel passkey system (Better Auth or otherwise) inside the admin app; it would duplicate what Access's Independent MFA already provides, with none of the benefit and all of the maintenance and attack-surface cost.
- **No passwords anywhere in this system.** Nothing hashes or stores a password.
- **Independent MFA configuration (checked against Cloudflare's docs):**
  - Turn it on under Zero Trust → Access controls → Access settings → *Allow multi-factor authentication (MFA)*. Allow security key and biometrics, and allow an authenticator app (TOTP) as a backup method. Either switch on *Apply global MFA settings by default* (the App Launcher is exempt, so enrollment still works) or set MFA explicitly on the admin application's policy, then confirm by logging in from a private window.
  - Leave *Use identity provider MFA* **off**. With it on, Access skips its own prompt whenever the identity provider reports a matching MFA method, which removes the independent second check this design relies on.
  - Set a short authentication duration (suggested starting point: one hour). `0m` prompts on every access.
  - The App Launcher is **disabled by default**, and enrollment goes through it. Enable it under Access settings → *Manage your App Launcher*, add an Allow rule for the owner's email only, and use the built-in one-time PIN as the login method (add GitHub only if preferred). Enroll at `<team-name>.cloudflareaccess.com/AddMfaDevice`.
  - Enroll at least two authenticators (device biometric plus an authenticator app, or two security keys). If all are lost, recovery means deleting them under Zero Trust → Team & Resources → Users → MFA devices. That is done from the Cloudflare account itself, so that account's own 2FA and recovery codes are the recovery root and must be protected accordingly.
- **Defense in depth on top of Access**: the origin Worker independently validates the Access JWT (`Cf-Access-Jwt-Assertion` header) — signature, issuer, audience, expiry — against Cloudflare's public JWKS, rather than trusting an identity header at face value. Cloudflare's own documentation says this isn't strictly required when Access is bound to the Worker directly, but verify it anyway: it's cheap, standard practice, and guards against configuration mistakes rather than assuming the platform is infallible.

## Sessions and cookies

- Host-scoped, `Secure`, `HttpOnly` (where the value doesn't need client-side JS access), `SameSite=Strict`.
- Short-lived sessions; require fresh authentication for destructive actions (deleting content, changing site settings).
- **The public site and the admin console never share a cookie or a session.** Separate origins, separate everything — this isolation is worth more than any convenience gained by sharing it.
- CSRF: origin-checking on every cookie-authenticated mutation. CORS configuration is not a substitute for this.

## Input handling

- Every input validated through the shared Zod schemas from `packages/schema`, on the **server**, regardless of what client-side validation already ran — client validation is a UX nicety, never a security boundary.
- All database access through Drizzle's parameterized queries. No string-built SQL, anywhere, for any reason.
- URLs (project links, certificate verification links, social links) validated for protocol (`https:`/`http:` only — no `javascript:`, no `data:` where a clickable link is rendered).
- File uploads: verify actual file type (not just extension or client-reported MIME type), enforce a size cap, re-encode images rather than serving the uploaded bytes directly, reject arbitrary SVG uploads unless run through a reviewed sanitizer (SVG can carry embedded scripts). Certificate originals are private by default.

## The LaTeX pipeline is the highest-risk surface in this project — treat it accordingly

The CV assembler takes content that ultimately traces back to owner-entered data (and, for the company/role prompt, direct free-text admin input) and feeds it into a real document compiler. Get this wrong and it's a code-execution path.

- **Templates are trusted code the project ships. Data is always data, never LaTeX.** No form field, ever, is concatenated into a template as raw LaTeX.
- **Escape every field** before it reaches the template: `\ { } $ & # ^ _ % ~` at minimum, plus explicit rejection of control-sequence-shaped input like `\input`, `\include`, `\write18`, `\immediate`, and any attempt to change a catcode.
- **Compiler sandboxing**: shell-escape disabled, no network access during compilation, a hard CPU/time limit, no access to deployment secrets from within the compile step.
- **Dedicated adversarial test suite for the escaper** (see `04-engineering-qa-review.md`) — this earns more test cases than anything else in the codebase, not fewer.
- The company/role prompt on admin CVs is the single field most likely to receive genuinely unpredictable free-text input (it's typed fresh on every download, by the owner, but still) — it goes through the exact same escaping path as everything else, no exception for "it's just me typing it."

## Public contact API hardening

This is the only endpoint on the entire site that unauthenticated strangers can write to. Harden it like it matters, because it's the one place that does:

- **Turnstile, verified server-side** — check the token is single-use, unexpired (tokens expire around five minutes), and matches the expected hostname and action.
- **Honeypot field** plus a minimum time-to-submit check.
- **Rate limits**, per-visitor and global, enforced in the `inbox` database, not just relied on from Cloudflare's platform-level rules.
- **Idempotency key** on submission, so a retried request (network hiccup, a double-click) can't create duplicate messages or be replayed to flood the inbox.
- **Bounded request body size.**
- **No arbitrary email sending** — the notification path sends only to the owner's fixed, hardcoded address. A visitor's input never determines where an email goes.
- **The console inbox UI renders messages as plain text only** — no HTML rendering, no remote content loading, links shown as inert text rather than auto-linked and clickable-by-default. This is the one place untrusted public text reaches a privileged interface; treat every message body as hostile until proven otherwise.
- Reject or strip line breaks from the name/subject fields before they're used anywhere near an email header, to prevent header injection.

## Database isolation, restated as a security control

- `content` and `inbox` are genuinely separate D1 databases with separate bindings. The public contact Worker's binding set contains `inbox` and nothing else — it structurally cannot query or write to `content`, this isn't just a convention to remember.
- The publish/build process reads an **explicit allowlist** of public tables and columns to build its snapshot — never a full database export. `contact_messages` and anything in `inbox` cannot appear in a public build, by construction, not by discipline. Test this directly (see `04-engineering-qa-review.md`).

## Headers

- Content-Security-Policy with no `unsafe-inline` — use hashes or nonces for any inline script that's genuinely unavoidable. 3D/WASM libraries and some animation tooling need careful, specific CSP entries; test this early in the build, not right before launch when it's expensive to unwind.
- HSTS with preload.
- `frame-ancestors 'none'` (or as restrictive as the use case allows).
- `Permissions-Policy` scoped to only what's actually used (camera, microphone, geolocation all denied unless something genuinely needs them — nothing here should).
- `Referrer-Policy` set deliberately, not left to the default.

## Secrets and supply chain

- Fine-grained, least-privilege tokens, scoped to one repository, never a broad personal access token used across everything.
- No secret ever committed to git — secret scanning enabled on the repository as a backstop, not the primary control.
- Lockfiles committed, dependency updates via Dependabot or Renovate, an audit step in CI.
- Every GitHub Actions step pinned to a commit SHA, not a floating version tag — this is a real supply-chain difference, not a style preference.
- Rotate credentials on a schedule and immediately on any suspected exposure.

## GitHub Actions usage — confirmed compliant, worth stating explicitly

Using GitHub Actions to compile the public CV during publish, and to compile admin CV variants via an owner-triggered `workflow_dispatch`, was checked against GitHub's current Actions terms. The prohibited uses are cryptomining, attempting unauthorized access, offering the Actions product itself as a stand-alone commercial service, and activity that places disproportionate burden on GitHub's servers. A single owner triggering an occasional, short compile job for their own project is squarely normal use, and GitHub staff guidance describes the intent of these restrictions as targeting server abuse, not personal automation. Keep the frequency reasonable and never expose this compile pipeline as a public-facing service for third parties, and this stays comfortably inside acceptable use.

## Account-level security — outside the app, and where real breaches actually happen

The application can be built perfectly and still be compromised through the accounts that control it. Require hardware keys or passkeys (not just an authenticator app, where phishing resistance matters) on:
- GitHub (holds the code, the CI secrets, the domain-adjacent Student Pack benefits)
- Cloudflare (holds DNS, Access, the databases, R2)
- The domain registrar
- The email account tied to all of the above

This list matters more than almost anything in the application layer above it.

## Backups and recovery

- Nightly export of `content` only — never `inbox` — to a private repository, as the primary backup.
- D1's built-in point-in-time restore (roughly the last 7 days) is a secondary safety net, not the primary plan.
- **Actually perform a restore drill before launch.** An untested backup is a hypothesis, not a backup.
- Contact messages follow their own retention policy (below) and are never part of any backup that leaves the `inbox` database's own environment.

## Privacy and retention

- Collect only what's needed on the contact form: name, email, message. A short consent line and a link to a privacy notice.
- **Scheduled deletion**: a cron-triggered job removes messages past a fixed retention window (a reasonable default is 12 months) — Workers Free includes cron triggers, this costs nothing.
- Messages are excluded from Git history and from the nightly content backup entirely, by construction.
- Algeria's data protection law (Law 18-07) uses a declaration model with the national authority (ANPDP) for operators processing personal data, with exemptions for purely personal or household use — a professional site's contact inbox may not qualify for that exemption, and EU visitors bring GDPR exposure on top of that. This is worth getting confirmed by someone qualified to give that confirmation — nothing here is legal advice.

## Abuse mitigation

- Cloudflare's managed WAF rules in front of both the admin console and the public contact endpoint.
- Rate limiting on the API, layered on top of (not instead of) the application-level checks on the contact form.
- A billing budget alert configured in Cloudflare (the card is on file for R2). This is informational only — it does not cap usage or prevent a charge — so it's an early warning to check in on, not a hard stop. Realistic usage for this project stays far under the free thresholds regardless.

## Audit logging

- Every admin write (create, edit, delete, publish, CV generation) logged with actor, action, entity, and timestamp.
- Never log message bodies, tokens, or personal data beyond what the audit trail actually needs to answer "who changed what, when."

## Acceptance checklist

Use **OWASP ASVS Level 2** as the working checklist for launch readiness — treat it as a working checklist to satisfy, not a certification anyone is claiming.

- [ ] Access is bound to the Worker (covers custom domain, `workers.dev`, preview URLs) and Independent MFA (hardware key/biometric) is required on the admin policy
- [ ] No password exists anywhere in the system; no custom passkey system was built where Access's Independent MFA already covers the need
- [ ] Admin and public origins share no cookies, sessions, or CSP
- [ ] Every input passes through server-side Zod validation regardless of client-side checks
- [ ] The LaTeX escaper has a dedicated adversarial test suite and blocks every construct listed above
- [ ] The contact endpoint enforces Turnstile, honeypot, rate limits, and an idempotency key, and can never write to `content`
- [ ] The publish snapshot generator cannot structurally include `inbox` data — proven by a test, not just by review
- [ ] CSP has no `unsafe-inline`, HSTS with preload is set, and 3D/WASM assets load under the policy without weakening it
- [ ] All GitHub Actions steps are pinned to commit SHAs; secret scanning and dependency auditing are active
- [ ] Hardware keys or passkeys are enforced on GitHub, Cloudflare, the domain registrar, and the linked email account
- [ ] A restore from the nightly backup has actually been performed and verified, not just configured
- [ ] Contact message retention and scheduled deletion are implemented and tested
- [ ] A budget alert is configured on the Cloudflare billing account
