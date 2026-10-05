# CV reference structure

Both owner-supplied TeX files were read in full on 2026-10-05. They remain ignored local reference material because they include personal contact details. Their TeX is not executed, imported as a runtime template, or accepted as form input.

## Shared visual grammar

- Center the full name, professional headline and eventual contact metadata. The source name is 20pt, with a muted 10.3pt headline.
- Use Poppins Regular, Medium, Light and Bold with Italic/BoldItalic available. Bundle the unmodified fonts with their SIL OFL license, pinned upstream commit and SHA-256 manifest; no font download occurs inside compilation.
- Use only ink `#1A1A1A`, secondary text `#4D4D4D`, and section rules `#B3B3B3` at 0.8pt.
- Section headings are bold 11.3pt; entries put the qualification/role above the institution/organization, opposite a quiet date column. Group each heading with the start of its content to avoid orphaned headings.
- English margins: 17mm horizontally, 11mm vertically. French: 15mm horizontally, 9.5mm vertically, with tighter section and paragraph spacing to accommodate expansion.
- Compact bullet groups describe outcomes; technical skills use a weighted category label followed by a plain-text value. French labels use a nonbreaking space before the colon.
- Preserve real French hyphenation through full TeX Live/Polyglossia. The reference's missing-pattern workaround is unnecessary in the specified compiler.
- The reference requests `10.5pt` from the standard article class, which does not provide that size. The implementation uses a supported class size and explicit body/headline sizes.

## Section order and content mapping

| English reference           | French reference             | Database-backed source                             |
| --------------------------- | ---------------------------- | -------------------------------------------------- |
| Profile                     | Profil                       | Profile headline plus selected CV variant summary  |
| Education                   | Formation                    | Education content items and translations           |
| Technical Skills            | Compétences Techniques       | Skill categories and evidence                      |
| Projects                    | Projets                      | Selected project content items and outcome bullets |
| Experience                  | Expérience                   | Experience content items and translations          |
| Achievements & Distinctions | Distinctions et Réalisations | Achievement content items                          |
| Certifications              | Certifications               | Certifications and their issuers                   |
| Languages                   | Langues                      | Languages and proficiency                          |
| Interests                   | Centres d'Intérêt            | Profile/variant presentation data                  |

This order is the reference default. Variant selection/order remains data, with actual content-item foreign keys. The Sprint 0 model currently has profile and education only; their renderer now uses the reference typography, headers, section rules and entry alignment. The remaining content tables and full CV selection UI retain their planned phases. Empty sections are not printed, and reference biographical claims are not baked into template code.

## Arabic adaptation

Use Polyglossia's Arabic direction and Amiri for joined Arabic glyphs, while preserving Poppins for isolated Latin runs. Allow larger Arabic body leading for diacritics. The entry/date arrangement follows paragraph direction; dates and URLs retain their own Latin direction. Keep whitespace outside isolated English spans so adjacent Arabic words do not touch them.

Headings and the ongoing-date label are translated data in the content database. The initial migration supplies EN/FR/AR values. All values, including future target-company/role prompts, pass through the same escaper and control-sequence rejection before reaching trusted macros.

## Validation record

The reference-derived template compiled successfully in [GitHub Actions](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/37320683489), using full TeX Live and the bundled Poppins fonts. The downloaded artifact's SHA-256 was verified, then each PDF was rendered for visual inspection. English/French accents, URL punctuation, section rules and alignment were checked; Arabic showed joined glyphs, RTL flow, a mirrored entry/date layout and isolated Latin runs. Font inspection confirmed embedded Poppins and Amiri with Unicode mappings. No clipping or missing glyphs were observed in the synthetic one-page fixtures.

The image pull took 136.16 seconds, with individual compilation passes around 9.5–9.8 seconds; the complete Actions run took approximately 234 seconds. These are CV-proof timings, not live publish latency. Review led to an em-dash date separator and restoration of italic institution/light date styles, versioned as `reference-2` and checked by the PR's compile workflow. Full-length personal content and its final pagination will be checked after the content-model phase.
