# Phase 3 — public snapshot and static presentation

This is the first Phase 3 increment, based on the owner-confirmed Phase 2 deletion fix. It is not the completed publish pipeline or a launch candidate. The protected console continues using its proven deployment while this work is reviewed on `codex/public-site`.

## Implemented

The v2 snapshot explicitly projects visible profile, education, experience, achievements, certificates, initiatives, skills, languages, projects/categories, navigation, site settings, SEO, public media metadata and the public CV selection. One D1 transaction captures the revision and data; joined translations keep it below the 50-query free allowance. It has no inbox binding. New database columns cannot appear implicitly. Private contacts, private variants, hidden parent relations, raw R2 keys and all certificate originals are excluded. An original is excluded even if mistakenly marked public or reused as another image reference. Only referenced eligible media metadata is included.

`GET /api/public-snapshot` is behind the existing independent owner JWT checks, returns no-store plus a SHA-256 digest, and caps the serialized output at 2 MiB. This is a read-only source endpoint, not a new unauthenticated publishing route. The v1 snapshot and Sprint 0 workflow remain compatible until the new publisher and CV consumer are connected.

Migration `0007_public_copy.sql` adds localized public interface text: headings, navigation accessibility labels and calls to action are console-editable. Migration `0008_project_dates_copy.sql` adds the case-study date label. They reuse the registry editor, recent-login protection and revision/audit transaction. The generic writer handles a singleton whose content is entirely translated, without issuing an empty base-row update. Both migrations have been tested locally; neither has been applied remotely.

Astro generates the homepage, profile/timeline, project listing, category pages, project case studies and contact details from the same snapshot. English has no prefix; French and Arabic use `/fr/` and `/ar/`. Shared navigation/footer and the locale switch preserve page context. English fallback on Arabic pages retains `lang="en" dir="ltr"`. Categories use native links and work without JavaScript. Content is present in the first response; no executable public JavaScript, public cookie, visitor D1 query or visitor R2 request is introduced.

Titles, descriptions, canonical URLs, hreflang, Person/ProfilePage/project JSON-LD, sitemap and robots are generated from the same content. JSON-LD is inert serialized data with HTML delimiters escaped; executable inline scripts remain disallowed. Category history generates Cloudflare `_redirects` rules. The build rejects navigation to unpublished routes. Preview is always noindex by default, with a disallow-all robots file and empty sitemap. Production mode requires an explicit HTTPS canonical origin. The existing Namecheap/Cloudflare DNS destination has not changed.

The build now decodes eligible images with pinned Sharp, applies EXIF orientation, strips metadata and writes responsive AVIF/WebP derivatives (480/960/1600px maximum edge, without enlargement). It also writes a bounded JPEG derivative for social previews, using localized alt text and the relevant project/category cover or site default. Portraits, covers, logos, galleries and redacted evidence images use these static files with intrinsic dimensions and lazy loading except for the main image. The source signature, snapshot byte count, 8 MiB upload cap, 40-megapixel decode limit and single-frame restriction are checked before conversion. A manifest binds derivatives to the exact public snapshot and content hashes; staging verifies bytes and copies only listed outputs. Originals and the manifest never enter the public directory.

Deliberately public PDFs are attachment downloads under a sandbox policy. They are not claimed to be sanitized PDFs; only the owner's explicitly public/redacted copy is eligible, and certificate originals remain excluded by snapshot capture. The build input currently comes from a controlled local source directory. Fetching immutable eligible originals from private R2 in the authenticated publishing job is still pending; no public R2 access was enabled.

Final output review found that Astro's automatic public-directory copy could carry previously staged Sprint 0 CVs into the v2 build. The v2 build now uses a separate code-owned static directory and rejects PDFs outside its verified output allowlist. A deliberately stale legacy PDF fixture proves that these files remain unreachable. The v1 build retains its original staging path. V2 public CV downloads stay absent until all three PDFs can be verified against the same v2 snapshot as the site.

## Preview

From the repository root in this Windows workspace:

```powershell
.\scripts\pnpm.cmd preview:public:build
.\scripts\pnpm.cmd --filter @platform/site exec astro preview --host 127.0.0.1 --port 4321
```

Open `http://127.0.0.1:4321/`, `/fr/` or `/ar/`. The build uses a fresh local D1 database and visibly labeled synthetic content. Example project names, descriptions, career entries and geometric media are test fixtures, not claims about the owner or proposed final visuals. The download fixture is a signature-only test PDF, not a real credential. The build never imports the private TeX references or remote data, and does not overwrite the captured Sprint 0 snapshot. The synthetic snapshot and image inputs are stored under ignored `artifacts/public-preview/`.

Other checkouts with the pinned Node/Corepack toolchain use `pnpm` in place of the workspace wrapper. Stop this Astro preview with `pnpm --filter @platform/site exec astro preview stop` before starting another Astro preview for this app.

## Validation and design comparison

The local suite passes 76 tests, including v2 privacy, newly added private columns/tables, ordered relations, public CV filtering, certificate-original exclusion, authenticated source access, interface-copy editing, escaped structured data, metadata removal, orientation, spoofed/truncated uploads and stale/tampered derivative manifests. TypeScript and Astro template checks pass with no warnings; lint and formatting pass. The initial increment's dependency audit and legacy static build passed. Admin JavaScript remains 247,324 bytes under its existing 250,000-byte budget.

Five public browser flows cover six page templates in EN/FR/AR with desktop/mobile axe checks, 390px and 320px containment, reduced motion, keyboard skip links, English fallback, zero cookies and native category/language navigation with JavaScript disabled. They also verify image decoding, localized alt/social metadata, attachment downloads and exclusion of source files. All five complete successfully, including Windows test-server shutdown. The test host initially excluded an Astro stylesheet whose basename began with an underscore; media overflow exposed that test defect. The host now excludes only the exact Cloudflare configuration files, and assertions require applied CSS and successful asset responses. Earlier browser results alone did not establish styled layout correctness; the expanded suite and refreshed captures replace that evidence.

Inspected refreshed captures: `artifacts/public-preview/home-desktop.png`, `home-ar-mobile.png`, `project-desktop.png` and `about-ar-desktop.png`. The composition follows Cursor's 24px gutters and metadata hierarchy, Integrated Biosciences' hairlines/chronology and Brex's consistently cropped 4:3 card imagery. The hero uses a restrained asymmetric split that stacks in mobile RTL; supporting sections use flat surfaces and calm editorial spacing. Case-study body and outcome sections share one reading-column edge, and dates have their own editable label. Arabic metadata uses the Arabic font stack instead of monospace; category labels preserve their actual translation language even inside a fallback project card. This remains a static layout study, not approval of the final imagery, fonts or three signature motion moments. No gradient, glow, glass, shadow or scroll interception was introduced.

GitHub verified initial Phase 3 commit `300e342`: [Platform checks](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/37883325874) and [full trilingual TeX Live proof](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/37883325908). Those runs precede the media extension. Work is reviewed in [draft PR #9](https://github.com/mohamedeghboudj/MyPersonalWebsite/pull/9), stacked on the console branch; it is not ready to merge as a completed Phase 3.

## Work still required in Phase 3

- Connect immutable eligible originals to the authenticated build input; conversion and template rendering are implemented and tested locally.
- Connect the v2 public CV assembler and compile all three PDFs from the exact same snapshot as the site. Do not offer a stale download link from a previous snapshot.
- Implement console publish/private-preview controls, authenticated GitHub dispatch, immutable captures, deployment ordering, failure/status reporting and current-head CI for that pipeline.
- Finish remaining detail presentation, localized error pages, generated-image review, performance gates and the full save-to-live browser proof. Keep the contact form/inbox controls in Phase 4 and motion/3D in Phase 6.
- Test current Chrome, Firefox and Safari, then real iPhone and mid-range Android devices. Chromium viewport checks are not real-device performance evidence.

No production deployment, domain cutover or account-level configuration was performed for this increment.
