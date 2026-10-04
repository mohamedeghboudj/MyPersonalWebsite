# Brief 2 of 5 — Design, UI/UX & Motion

Read `01-architecture-overview.md` first if you have it — it defines the content model this design has to present. This file is the visual and interaction spec. It governs the public site's look, feel, and motion. The admin console can be plainer (it's a private tool for one user) but should still use the same design tokens, and its usability standard is not lower — clear forms, sensible defaults, good feedback on save/publish/error.

## Reference material

Separate from this document, you will be given other prompts and `.md` files, and example pages of sites whose look or feel is close to what's wanted. **Read every one of them carefully before writing any code.** They exist to make the direction concrete instead of adjectival — "clean" and "impressive" mean different things to different people, and the references pin down what they mean here. Extract specific, nameable patterns from them (spacing rhythm, how a hero resolves, how a transition is timed, how restraint is achieved) — not just a vague impression. Where a reference and this document conflict, ask rather than silently picking one.

This is not a one-shot task. Build a section, hold it up against this document and the references, and be honest about the gap. Revise. Repeat. A first pass that technically implements every listed requirement but doesn't feel like the references is not done.

## The aesthetic, stated plainly

Solid, classic, high-contrast. Clean and uncrowded rather than busy. The reference point is Apple's product pages: not because of any specific visual motif they use, but because of the discipline behind them — few elements, each one considered, generous space, motion that clarifies rather than decorates.

**Explicitly avoid, everywhere on this site:**
- Glow or gradient effects
- Colored shadows
- Emoji, anywhere in the UI
- Glassmorphism, neumorphism, or any currently-trending effect that will look dated in two years
- Generic "AI-generated landing page" tells: oversized rounded gradient blobs, purple-to-pink gradients, stock-photo hero illustrations, cards with soft colored shadows floating on a light-gray background

If a design decision would only be there because "that's what impressive sites do now," cut it. Impressive here means the typography, spacing, contrast, and motion are so deliberate that nothing needs to be loud. If in doubt, do less, better, not more.

**"Wow" comes from three things — nothing else:**
1. Typographic and spatial discipline (a real type scale, real grid, generous whitespace, nothing crowding anything else)
2. Purposeful, scroll-synchronized motion that reveals structure the visitor wouldn't otherwise see
3. Speed — the site responding instantly to every interaction

Do not chase "wow" through visual density, color, or novelty. It reads as effort, not quality.

## Signature moments, not uniform effort

Pick three moments to make genuinely excellent and let the rest of the site be calm by comparison:
1. **Hero** — first thing seen, sets the entire tone in under a second.
2. **Timeline** (education + experience) — where scroll-synced motion earns its place: this is inherently sequential, chronological content.
3. **Projects** — the portfolio is the reason a visitor is here; give it the most interactive care of any section after the hero.

Every other section (achievements, certificates, skills, languages, initiatives, contact) should be clean, fast, and well-typeset, with light, consistent motion — not competing for the same level of spectacle. Spreading maximum effort evenly across every section is how sites end up busy instead of impressive.

## Motion system

- **Engine**: GSAP + ScrollTrigger for choreography. three.js for exactly one hero-level 3D element — not a 3D treatment on every section.
- **Only animate `transform` and `opacity`.** Nothing that triggers layout (`width`, `height`, `top`/`left` outside of `transform`) gets animated. This is both a performance rule and the reason the motion layer survives the switch to right-to-left Arabic pages for free.
- **Native scroll only.** No scroll-jacking, no intercepting the scroll wheel to control pacing. Phones handle native scroll far better than any hijacked equivalent, and hijacking is one of the fastest ways to make a site feel cheap rather than premium.
- **3D loads late and lazily.** After first paint, only when the element is visible, paused when off-screen, capped pixel ratio on mobile. Use glTF with Draco or Meshopt compression, KTX2 textures, model under ~2 MB. A still image is the fallback for low-power devices.
- **`prefers-reduced-motion` gets a designed alternate experience** — not everything simply disabled and gaps left where the motion used to be. Content still needs to read well and transitions still need to feel intentional, just without the movement.
- **RTL**: because motion is limited to `transform`/`opacity`, the Arabic pages inherit the same choreography with no separate implementation. Verify this in practice, don't just assume it.
- **A frame-sequence trick (pre-rendered images stepped by scroll position) is a legitimate substitute for "live 3D" in a big scroll moment** and is often cheaper than it looks — consider it for the hero or timeline if a fully live 3D scene proves too heavy on mid-range devices.

## Typography, color, spacing

- Real type scale (a small number of sizes, each used consistently for its role — not ad hoc font sizes per component).
- High contrast text on background; check actual contrast ratios, not just visual impression.
- Spacing on a consistent scale (e.g. a 4px or 8px base unit), applied via the shared token file — never a one-off magic-number margin in a component.
- Color palette is restrained: a neutral base, one or two accent colors used sparingly and consistently for the same meaning (a link, an active state), no rainbow of "brand colors."
- **All of the above live in one shared design-token file** consumed by both the public site and the admin console. Changing a color or a spacing value happens in one place.

## Layout and components

- **One navigation component, one footer component**, used on every page across every locale. A change to either changes everywhere — never a page with its own inline nav.
- Console table views, form primitives, and public-facing cinematic project pages are legitimately different enough that they should **not** be forced into one universal component just to claim reuse. Reuse stable behavior and shared rules (validation feedback, button styles, focus states); keep genuinely different presentations as genuinely different components.
- Every content type from `01-architecture-overview.md`'s content model needs a public presentation:
  - **Home** — hero, a curated glance at the rest (not everything, a teaser)
  - **About / Profile**
  - **Education** and **Experience** — the timeline treatment
  - **Achievements**, **Certificates** — can share a pattern (title, issuer/body, date, evidence link) without being identical components
  - **Skills**, **Languages** — compact, scannable, not over-designed
  - **Initiatives**
  - **Projects** — a filterable grid by category, each project getting a real case-study page (problem, role, approach, outcome — not just a screenshot and a GitHub link)
  - **Writing / Articles** — schema-ready now, UI in a later phase; design it so adding the UI later doesn't require touching the rest of the site
  - **Contact** — form, with clear success/error states, no dark patterns

## Responsiveness and performance

- Test on a real mid-range Android device and a real iPhone, not just a resized browser window or a laptop.
- Performance budgets, enforced, not aspirational: LCP under 2.5s, INP under 200ms, CLS under 0.1.
- Heavy 3D and animation are what usually break these budgets — this is the concrete reason they load last, lazily, and behind visibility checks.
- Images: responsive, modern formats, properly sized — never a full-resolution original served to a phone.

## Accessibility

Not optional, not a checkbox pass at the end:
- Full keyboard navigation, visible focus states everywhere (focus states are not something the "clean" aesthetic gets to remove).
- Sufficient contrast (this should already fall out of the high-contrast direction above, but verify it).
- Meaningful heading structure, not headings chosen for visual size.
- Touch targets sized for actual fingers, not just mouse pointers.
- Cursor treatment: any custom cursor work is a nice detail, never at the cost of usability — it must degrade invisibly on touch devices.

## Cursor and micro-interaction notes

- Any custom cursor treatment (a subtle follower, a state change on hover) should read as precision, not novelty — small, fast, never delayed enough to feel laggy.
- Hover and focus states should be consistent in timing and easing across the whole site — this consistency is part of what reads as "integrated" rather than assembled from parts.
- Page transitions, if used, should be fast and should never block the visitor from starting to read the next page's content.

## Definition of done for any section

- [ ] Uses only tokens from the shared design-token file — no hardcoded colors, spacing, or type sizes
- [ ] Animates only `transform`/`opacity`; native scroll; no scroll-jacking
- [ ] Passes the reduced-motion check with a designed (not just disabled) alternate
- [ ] Meets the LCP/INP/CLS budgets on a real mid-range Android and a real iPhone
- [ ] Full keyboard navigation and visible focus states
- [ ] Verified against the attached reference material, not just against this checklist
- [ ] No glow, gradient, colored shadow, or emoji anywhere in it
- [ ] Renders correctly on the Arabic (`/ar/`) route with proper RTL layout, not just mirrored text
