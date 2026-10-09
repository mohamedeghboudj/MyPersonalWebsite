# Phase 3 — public snapshot and static presentation

This is the first Phase 3 increment, based on the owner-confirmed Phase 2 deletion fix. It is not the completed publish pipeline or a launch candidate. The protected console continues using its proven deployment while this work is reviewed on `codex/public-site`.

## Implemented

The v2 snapshot explicitly projects visible profile, education, experience, achievements, certificates, initiatives, skills, languages, projects/categories, navigation, site settings, SEO, public media metadata and the public CV selection. One D1 transaction captures the revision and data; joined translations keep it below the 50-query free allowance. It has no inbox binding. New database columns cannot appear implicitly. Private contacts, private variants, hidden parent relations, raw R2 keys and all certificate originals are excluded. An original is excluded even if mistakenly marked public or reused as another image reference. Only referenced eligible media metadata is included.

`GET /api/public-snapshot` is behind the existing independent owner JWT checks, returns no-store plus a SHA-256 digest, and caps the serialized output at 2 MiB. This is a read-only source endpoint, not a new unauthenticated publishing route. The v1 snapshot and Sprint 0 workflow remain compatible until the new publisher and CV consumer are connected.

Migration `0007_public_copy.sql` adds localized public interface text: headings, navigation accessibility labels and calls to action are console-editable. It reuses the registry editor, recent-login protection and revision/audit transaction. The generic writer now handles a singleton whose content is entirely translated, without issuing an empty base-row update. Migration 0007 has been tested locally; it has not yet been applied remotely.

Astro generates the homepage, profile/timeline, project listing, category pages, project case studies and contact details from the same snapshot. English has no prefix; French and Arabic use `/fr/` and `/ar/`. Shared navigation/footer and the locale switch preserve page context. English fallback on Arabic pages retains `lang="en" dir="ltr"`. Categories use native links and work without JavaScript. Content is present in the first response; no executable public JavaScript, public cookie, visitor D1 query or visitor R2 request is introduced.

Titles, descriptions, canonical URLs, hreflang, Person/ProfilePage/project JSON-LD, sitemap and robots are generated from the same content. JSON-LD is inert serialized data with HTML delimiters escaped; executable inline scripts remain disallowed. Category history generates Cloudflare `_redirects` rules. The build rejects navigation to unpublished routes. Preview is always noindex by default, with a disallow-all robots file and empty sitemap. Production mode requires an explicit HTTPS canonical origin. The existing Namecheap/Cloudflare DNS destination has not changed.

## Preview

From the repository root in this Windows workspace:

```powershell
.\scripts\pnpm.cmd preview:public:build
.\scripts\pnpm.cmd --filter @platform/site exec astro preview --host 127.0.0.1 --port 4321
```

Open `http://127.0.0.1:4321/`, `/fr/` or `/ar/`. The build uses a fresh local D1 database and visibly labeled synthetic content. Example project names, descriptions and career entries are design fixtures, not claims about the owner. It never imports the private TeX references or remote data, and does not overwrite the captured Sprint 0 snapshot. The synthetic snapshot is stored under ignored `artifacts/public-preview/`.

Other checkouts with the pinned Node/Corepack toolchain use `pnpm` in place of the workspace wrapper. Stop this Astro preview with `pnpm --filter @platform/site exec astro preview stop` before starting another Astro preview for this app.

## Validation and design comparison

The local suite passes 72 tests, including v2 privacy, newly added private columns/tables, ordered relations, public CV filtering, certificate-original exclusion, authenticated source access, interface-copy editing and escaped structured data. TypeScript and Astro template checks pass with no warnings; lint, formatting and dependency audit pass. The legacy static build remains verified. Admin JavaScript remains 247,324 bytes under its existing 250,000-byte budget.

Four public browser flows cover six page templates in EN/FR/AR with desktop/mobile axe checks, 390px and 320px containment, reduced motion, keyboard skip links, English fallback, zero cookies and native category/language navigation with JavaScript disabled. An initial heading-order failure in project listings was corrected by using h2 there and h3 under the homepage's selected-work heading. All four flows now complete successfully, including Windows test-server shutdown. The test-only server serves an allowlist of built files from loopback and is outside all deployable Worker entry points.

Inspected captures: `artifacts/public-preview/home-desktop.png` and `home-ar-mobile.png`. The composition follows Cursor's 24px gutters and metadata hierarchy, Integrated Biosciences' hairlines/chronology and the references' large, restrained type. The hero has space for the later single visual; supporting sections use flat surfaces and calm editorial spacing. Arabic metadata now uses the Arabic font stack instead of monospace. This is an early static composition, not approval of the final imagery, fonts or three signature motion moments. No gradient, glow, glass, shadow or scroll interception was introduced.

## Work still required in Phase 3

- Download eligible originals inside the authenticated build and decode/re-encode static image derivatives; wire portraits, covers, galleries, redacted documents and localized social images into the templates. The current templates do not publish uploaded files.
- Connect the v2 public CV assembler and compile all three PDFs from the exact same snapshot as the site. Do not offer a stale download link from a previous snapshot.
- Implement console publish/private-preview controls, authenticated GitHub dispatch, immutable captures, deployment ordering, failure/status reporting and current-head CI for that pipeline.
- Finish remaining detail presentation, localized error pages, generated-image review, performance gates and the full save-to-live browser proof. Keep the contact form/inbox controls in Phase 4 and motion/3D in Phase 6.
- Test current Chrome, Firefox and Safari, then real iPhone and mid-range Android devices. Chromium viewport checks are not real-device performance evidence.

No production deployment, domain cutover or account-level configuration was performed for this increment.
