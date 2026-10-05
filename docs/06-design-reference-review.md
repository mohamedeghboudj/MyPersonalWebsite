# Design reference review

Reviewed on 2026-10-04, after reading briefs 01 through 05 in order. All eleven files in `design-references/` were read individually, in full, including their examples and CSS appendices. This document records observations and proposed applications, not a replacement for brief 02 or an approved design system.

## Decision approved before implementation

The owner explicitly requires a question when a reference conflicts with brief 02. That question has been raised: should brief 02's restrictions govern, using only compatible reference patterns, or should specific exceptions be discussed?

On 2026-10-04 the owner explicitly replied, "yes keep the restrictions", and authorized starting the build. Brief 02 therefore governs conflicting visual treatments. The observations below remain useful reference-review records; their conflict questions are resolved by this decision.

Approved resolution: retain brief 02's bans on gradients, glow, colored shadows, glassmorphism, emoji, and decorative density; retain its accessibility and motion requirements. Extract composition and hierarchy from the references without copying their brand identities or contradictory effects.

## Reference-by-reference observations

### 1. Apple, light — `DESIGN.md`

- Concrete patterns: uninterrupted white hero stage; one dominant visual below a centered label/headline; 80px display versus 17px reading text; mostly 4px spacing increments; flat white media frames on pale section bands; 28px media corners; compact primary action paired with an outlined secondary action.
- Agreement with 02: whitespace, restrained blue interaction accents, shadowless surfaces, typography and imagery doing the work.
- Useful addition: distinguish a full-width visual stage from contained content chapters rather than placing everything inside cards. A quieter local navigation can support long project narratives.
- Conflict to resolve: opened navigation prescribes blur; its adoption as translucent glass conflicts with 02. The tiny reference controls also need adequate touch areas rather than literal copying.
- Later review: the hero must read clearly before its optional visual enhancement loads; no mock hardware or borrowed Apple identity should displace the owner's actual work.

### 2. Cursor — `DESIGN (1).md`

- Concrete patterns: 1300px maximum content width with 24px outer gutters; 64–96px chapter separation; regular-weight display type with tighter tracking at larger sizes; monochrome primary and secondary actions; 4px corners; alternating text/screenshot sections; mono reserved for metadata.
- Agreement with 02: flat editorial surfaces, restricted accent use, orderly spacing, no glow or gradients.
- Useful addition: present project evidence as consistent, legible screenshot frames; use date and technology labels as quiet metadata.
- Conflicts to resolve: tinted outline/shadow recipes conflict if copied as colored shadows; animated color/background transitions exceed the transform/opacity-only rule. Use of numerous supporting accent colors would also exceed the restrained palette if imported wholesale.
- Reference defects: the button examples contradict the stated 4px/no-pill rule; several hex values are incomplete; one tracking example disagrees with the token table. These are reference artifacts, not implementation instructions.
- Later review: project evidence and text should form one coherent story; ornamental window chrome must not crowd the content.

### 3. ElevenLabs — `DESIGN (2).md`

- Concrete patterns: 1280px content width; 96–125px major section gaps; asymmetric headline and supporting copy; one large visual panel per chapter; flat 20–24px media panels with 32px padding; black primary/outlined secondary actions.
- Agreement with 02: typographic hierarchy, few competing elements, warm neutral surfaces and restrained interface color.
- Useful addition: compact tabbed navigation over a large evidence panel can inform project-category browsing, with proper keyboard behavior.
- Conflict to resolve: the gradient audio spheres directly contradict the gradient/glow ban. Very faint tertiary text must be replaced where it fails contrast requirements.
- Later review: filtering must stay quick and readable without relying on animated colored spheres or copying product branding.

### 4. Dala — `DESIGN (3).md`

- Concrete patterns: 1280px content width; 60–120px section spacing; oversized regular-weight headlines beside shorter body columns; unboxed content separated by negative space; one filled primary action.
- Agreement with 02: high contrast, strong scale hierarchy, spacious composition and minimal interface chrome.
- Useful addition: an asymmetric hero can reserve a dedicated visual region while preserving the reading order.
- Conflicts to resolve: a full-spectrum animated particle field plus particles throughout the page conflicts with palette restraint and the concentration of motion into three signature moments. The gradient logo also conflicts directly with 02.
- Later review: no rainbow ambient particle system; do not force ultra-light body weights where they harm legibility. A dark theme is an option, not a requirement inferred from this reference.

### 5. Superhuman — `DESIGN (4).md`

- Concrete patterns: 1200px content width; 64–96px sections; 16px flat cards; a strong tonal chapter break; short headings paired with start-aligned body text; consistent small link affordances.
- Agreement with 02: editorial pacing, deliberate image scale, quiet surfaces and hierarchy.
- Useful addition: a single contrasting full-width chapter can mark a major transition without extra interface decoration.
- Conflicts to resolve: floating translucent glass cards, blurred sticky navigation, gradient/glow banners, and the violet shadow token conflict with 02. Importing the full maroon/violet/lilac/teal palette would undermine color restraint.
- Reference defects: the prompt guide changes the primary CTA from wine to lilac. It must not become a second competing source of design tokens.
- Later review: use authentic portraits or project evidence where relevant; do not recreate a stock lifestyle hero.

### 6. Tomorro — `DESIGN (5).md`

- Concrete patterns: 1200px content width; an 8px spacing rhythm; 80–120px chapter gaps; flat dark/light section changes; large panels with 24–40px internal space; one primary action per viewport.
- Agreement with 02: consistent spacing, restricted action color, background changes used to explain chapter structure.
- Useful addition: contrast bands can separate a project overview from detailed evidence; contained navigation can keep a long page organized.
- Conflict to resolve: the atmospheric gradient orb contradicts 02. Multiple tilted, shadowed mockups competing across sections may also violate the three-moment emphasis and calm supporting sections if copied literally.
- Reference defects: its color-role prose contradicts itself in places. The 0.86 display line height cannot be transplanted into Arabic or long names without checking clipping and readability.
- Later review: avoid decorative stacks that make project screenshots unreadable on phones.

### 7. Brex — `DESIGN (6).md`

- Concrete patterns: 1200px content width; 8px spacing base; 48–80px section gaps; 24–32px panel padding; stable 12px component corners; split hero approximately 45% text/55% evidence; consistent image ratios for resource cards.
- Agreement with 02: flat surfaces, one action accent, start-aligned paragraphs, scannable category and article grids.
- Useful addition: stable media aspect ratios and consistent caption placement provide a useful foundation for the project grid.
- Conflicts to resolve: literal imported text/accent colors require contrast checking. Browser-cookie consent UI is not a feature request: brief 01 specifies a cookie-free public site. Its Latin ligature settings must not be imposed on Arabic shaping.
- Reference defects: its introductory/action color rules and prompt-guide summary disagree; some hex values and tracking units are malformed.
- Later review: project filters and evidence links should work from the keyboard and remain clear without relying on color alone.

### 8. Apple, dark — `DESIGN (7).md`

- Concrete patterns: black visual stage; compact navigation; 80–96px display scale; 28px media frames; charcoal comparison panels with flat black subpanels; pale surfaces used sparingly as a reading reset.
- Agreement with 02: imagery receives space, large type has a controlled role, blue is reserved for interactions, cards do not cast decorative shadows.
- Useful addition: use a close detail and then wider context to explain a project, instead of an undifferentiated screenshot gallery.
- Conflicts to resolve: the explicitly allowed charcoal-to-black gradient and blur-backed navigation conflict with 02. Dense product-spec modules should not drive the overall portfolio layout.
- Later review: any dark section must preserve readable secondary text, visible focus, and consistent RTL reading order.

### 9. Integrated Biosciences — `DESIGN (8).md`

- Concrete patterns: 1200px content width; 80–120px sections; scale-led single-weight typography; mono dates and section counters; horizontal hairlines; editorial image/text pairs with 40px panel padding; color confined to small directional controls.
- Agreement with 02: restrained palette, flat surfaces, no interface gradients or shadows, strong spatial hierarchy.
- Useful addition: chronological markers can provide a quiet structural vocabulary for the education/experience timeline.
- Conflicts to resolve: glowing scientific imagery conflicts with the broad no-glow rule if imported as a decorative effect. The specified Graphite text on Abyssal Ink needs correction for contrast; the huge fixed negative-space requirement cannot override responsive reading needs.
- Reference defects: some accent hex values are incomplete and the table describing large accent washes contradicts the later micro-accent rule.
- Later review: timeline markers must clarify chronology, with the entire sequence still readable in reduced-motion mode.

### 10. Vercel — `DESIGN (9).md`

- Concrete patterns: 1280px content width; 24–48px gutters; 96–128px chapter gaps; compact 2/3-column grids; sans for reading and mono for metadata; hairline outlines and occasional inverted panels.
- Agreement with 02: disciplined monochrome, flat surfaces, consistent grid, purposeful content evidence.
- Useful addition: one visual grammar for labels and dates can connect projects, certificates and timeline entries without forcing them into identical components.
- Conflicts to resolve: spectrum/solar gradients and blurred navigation directly conflict with 02. Do not inherit extremely small labels or tight Latin tracking where readability suffers.
- Boundary: this is a visual reference only. The architecture explicitly rejects Vercel Hobby hosting.
- Later review: do not copy the triangle brand mark, CLI motifs, marketing claims or color effects.

### 11. ORYZO — `DESIGN (10).md`

- Concrete patterns: one centered object with flanking text; warm dark canvas and cream text; very few navigation items; rare filled actions; context photograph followed by isolated-object reveal; minimal structural separators.
- Agreement with 02: the single hero object, generous negative space and minimal chrome support a focused first impression.
- Useful addition: the hero can resolve from an introductory visual into stable, readable content rather than running continuous decoration. The exact timing must be designed and tested; this reference does not supply measured choreography.
- Conflicts to resolve: repeated full-viewport 3D sections conflict with exactly one hero-level 3D element and calmer supporting sections. Translucent overlay cards may conflict with the glassmorphism ban. Literal 8px UI/legal text conflicts with usable reading sizes.
- Reference defects: some border hex values are incomplete. All-uppercase Latin styling is not a language-neutral rule for Arabic.
- Later review: no scroll interception, forced viewport-height reading sections, or inaccessible text around the hero object.

## Approved synthesis — retain brief 02's restrictions

Use the compact identity `mohamedeghboudj` and the full name `MOHAMED CHARAF EDDINE DEGHBOUDJ` where appropriate. Neither brand copy nor biographical claims should be borrowed from the reference brands.

Choose one coherent neutral palette, spacing scale, type scale and radius vocabulary in the shared tokens. Do not merge all eleven palettes, fonts, radii or contradictory generated CSS snippets. Use appropriately licensed fonts with an intentional Arabic companion; preserve shaping and do not apply Latin uppercase or negative-tracking rules indiscriminately.

Build the hero, timeline and projects as the three signature moments only after the data paths work. Motion uses native scroll and transform/opacity. No reference contains enough evidence to claim that a particular hero scroll timing has already been measured. Treat timing as an implementation hypothesis to review on actual content and devices.

Higgsfield is the requested tool for suitable visual assets later. Generated work must be exported into the project's static-media pipeline rather than becoming a runtime dependency. Figma or Canva may help with specific design deliverables when needed; their selection does not authorize moving hosting away from the specified repository/Cloudflare stack.

## Review record to complete after each major section

For each section, record the reference patterns chosen, the implementation URL or capture, the comparison with brief 02, and any revision. Include English, French and Arabic; keyboard/focus; reduced motion; and real iPhone/mid-range Android results. Separate automated performance results from real-device evidence. No section is approved merely because its controls exist.

| Section                         | Reference starting points                                                      | Evidence  | Status                                  |
| ------------------------------- | ------------------------------------------------------------------------------ | --------- | --------------------------------------- |
| Hero                            | Apple light/dark; ORYZO's single-object composition                            | Not built | Pending Sprint 0 and later build phases |
| Timeline                        | Integrated Biosciences' counters; Cursor's metadata hierarchy                  | Not built | Pending                                 |
| Projects                        | Brex's consistent crops; Cursor's evidence frames; ElevenLabs' panel hierarchy | Not built | Pending                                 |
| Supporting sections and contact | Flat editorial patterns shared across the references                           | Not built | Pending                                 |
| Admin                           | Shared tokens, clear forms and feedback from briefs 02/04                      | Not built | Pending                                 |
