# Localized identity

On 2026-10-23 the owner specified **محمد شرف الدين دغبوج** for the Arabic website and Arabic CV header. English/French keep the existing full name and compact website name. Their language selector uses **AR**; the Arabic page retains **العربية**. This is a content/language correction, not final layout or design acceptance.

Migration `0014_localized_profile_name.sql` adds an optional name to each profile translation. In the console, open **Profile → Arabic → Name in this language (blank uses full name)** and save the spelling above. Leave English/French overrides blank to keep their existing identity. The ordinary editor transaction records the revision and audit event; do not seed this through an unaudited remote SQL update.

The same saved value supplies the localized website wordmarks, profile names, default titles, structured Person data and CV header. Explicit SEO titles remain editable SEO content. A blank/missing localized name uses the canonical full name (or compact website name for wordmarks). Names do not fall back to an unrelated language's spelling. Existing captures without the optional field retain their parsed shape and hashes.

The CV payload carries the name's language into the trusted escaping/shaping path. Arabic uses Amiri and RTL; canonical Latin fallback remains an isolated English run. Template `reference-2.4` invalidates earlier compiled-cache entries. No owner spelling is embedded in the renderer. Synthetic compile fixtures exercise an Arabic name, and browser fixtures exercise the owner's requested spelling without importing private CV content.

Deploy the migration and updated console before saving the new field. A new capture/build is required to change the currently active static preview or publication; a content save never rewrites an existing capture.
