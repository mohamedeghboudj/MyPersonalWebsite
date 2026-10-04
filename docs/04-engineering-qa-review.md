# Brief 4 of 5 — Engineering Principles, Testing & Build Review

Read `01-architecture-overview.md`, `02-design-ui-ux.md`, and `03-database-infrastructure.md` first — this brief's job is to hold the actual build to what those three promised. You are the standards-keeper for this project: review continuously as it's built, not once at the end. Where you find a deviation, name it plainly rather than quietly living with it or quietly "fixing" it into something the other briefs never specified.

## Role

You are not primarily here to write net-new features. You are here to:
1. Set up the guardrails (linting, types, tests, CI) before feature work accelerates.
2. Review each module as it lands against the architecture, design, and database briefs.
3. Catch drift early — a hardcoded string that should be console-managed, a component reinvented instead of reused, a missing test, a missing translation.
4. Enforce that nothing merges in a state worse than what's already there.

## Language and code quality

- **TypeScript strict mode**, everywhere, no exceptions. `any` is not acceptable; if a type genuinely can't be known, it's `unknown` with a narrowing check, not `any`.
- ESLint + Prettier, run in CI, not just locally — a failing lint blocks the merge the same as a failing test.
- Zod schemas from `packages/schema` are the single source of truth for shape validation — a hand-written interface that duplicates a Zod schema's shape is a sign the Zod schema should have been imported instead.
- No unexplained duplication: if the same 15 lines appear in two components, that's a signal to extract a shared piece, not a style choice.

## Testing pyramid

- **Unit (Vitest)**:
  - Every Zod schema, with both valid and invalid inputs.
  - The LaTeX escaper gets a dedicated, adversarial test suite — this is the one place untrusted-shaped data reaches a compiler, and it deserves more test cases than anything else in the codebase. See `05-security.md` for exactly what it must escape and block.
  - The CV assembler: given a snapshot + variant + locale, does it select and order the right items, does the fallback chain resolve correctly when a translation is missing.
  - The publish snapshot generator: prove `contact_messages` and any non-allowlisted table or column structurally cannot appear in its output — not just "doesn't currently appear," but cannot.
- **End-to-end (Playwright)**, at minimum these four flows:
  1. Add a content item in the console → publish → confirm it's live on the public site, in the right locale, at the measured latency.
  2. Generate every CV variant, in all three languages, including Arabic with mixed-direction text (an English project name inside Arabic prose) — confirm the PDF is correct, not just that it compiled without error.
  3. Submit the public contact form → confirm it lands in the console inbox → confirm the notification email arrives and isn't flagged as spam.
  4. Translation-completeness: an item saved only in English still renders correctly (in English) on the French and Arabic routes.
- **Accessibility**: axe-core run against every public page template, not spot-checked.
- **Performance**: Lighthouse budgets enforced in CI — build fails if LCP/INP/CLS regress past the thresholds in `02-design-ui-ux.md`. CI performance numbers are a regression signal, not proof of real-user performance — a real mid-range Android and a real iPhone still get tested by hand before launch.

## CI gates

- Nothing merges on a red build. No exceptions for "just a docs change" — keep the bar uniform so it's never ambiguous.
- GitHub Actions steps pinned to a commit SHA, not a floating tag (`uses: actions/checkout@<sha>`, not `@v4`) — a floating tag is a supply-chain risk, since the action's maintainer could push different code under the same tag later.
- Dependency updates via Dependabot or Renovate, with an audit step (`npm audit` or equivalent) in CI.
- Secret scanning enabled on the repository.
- Every environment variable validated at startup against the schema in `packages/config` — a missing or malformed env var should fail loudly at boot, not silently produce broken behavior later.

## SEO checklist

- Metadata (title, description) generated from the same content registry every other consumer of that content uses — never a separately hand-written SEO string that can drift from the real content.
- Canonical URLs, a generated sitemap, and structured data (JSON-LD): `Person` with `sameAs` links to the owner's profiles, `ProfilePage`, and `CreativeWork` or `SoftwareSourceCode` per project.
- `hreflang` alternates for every page across `en`/`fr`/`ar`, and the sitemap reflects all three.
- Semantic HTML, a real heading hierarchy (not headings chosen for visual weight), descriptive URLs, alt text on every image.
- `robots.txt` present and correct. A short `llms.txt` costs nothing to add, but don't oversell what it does — no major crawler has confirmed relying on it, and it is not a substitute for the technical SEO basics above.
- No architecture or design decision should ever be justified as an "SEO trick" that a visitor wouldn't also benefit from — if it's good for crawlers, it should also be good, readable content for a human.

## Browser and device matrix

- Desktop: current Chrome, Firefox, Safari.
- Mobile: a real iPhone (Safari) and a real mid-range Android (Chrome) — not just a resized desktop browser window pretending to be mobile.
- `prefers-reduced-motion` and RTL (`/ar/`) are both part of this matrix, not a separate, optional pass — test them on the same devices as everything else.

## Definition of done, for any pull request

- [ ] Passes lint, type-check, and the full test suite
- [ ] New content type or field is console-editable — nothing new is hardcoded into a page template
- [ ] New UI reuses `packages/ui` primitives and the shared design tokens; a new one-off component is justified in the PR description, not silent
- [ ] New public-facing data flows through the content registry, not a bespoke fetch
- [ ] Includes tests for new logic, not just a manual "it worked when I tried it"
- [ ] Translation coverage: new user-facing text has an English string at minimum, and the console correctly flags French/Arabic as pending rather than silently blank
- [ ] No new hardcoded LaTeX, HTML, or SQL string-building anywhere a user-controlled value flows through
- [ ] No new component violates the design brief's "no glow/gradient/colored shadow/emoji" rule
- [ ] Performance budgets still pass

## Anti-patterns to catch in review

- Content hardcoded into a template "just for now" — this is the single most common way the console's promise ("everything editable, nothing hardcoded") quietly breaks.
- A second, slightly different navbar or footer appearing because reusing the shared one was inconvenient in one spot.
- A query issued once per item in a loop where one joined or batched query would do — check any list page that renders content with related data (a project with its categories, a CV variant with its items).
- Missing loading and error states — a console form or a public page that only has a "happy path" implemented.
- Scroll-jacking or an animation that fires regardless of `prefers-reduced-motion`.
- A translation table with only an English row and no console indication that French/Arabic are missing.
- Any place accepting user input (contact form, console forms, LaTeX company/role prompt) that isn't validated through the shared Zod schema on the server side, not just the client.

## Iteration mandate

After each module (a content type's console CRUD, a public page template, the CV pipeline, the contact flow), explicitly re-check it against `01`, `02`, and `03` before calling it done. If something in the build had to deviate from what those briefs specify, write down what changed and why — don't let the implementation silently become the new spec. A short note in the PR description is enough; the point is that drift is visible and decided, not accidental.

## Documentation expectations

- A README that lets someone unfamiliar with the project get the monorepo running locally in under fifteen minutes.
- Any deviation from this set of briefs gets a short decision note (what was specified, what was built instead, why) rather than silent divergence.
