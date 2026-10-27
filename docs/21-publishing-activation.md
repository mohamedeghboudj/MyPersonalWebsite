# Publishing completion and live activation

This is the current handoff for publishing, superseding the implementation status in `15`–`20`. Private preview, private reports and public publication controls are implemented. Private activation and automatic public publication are now verified; the remaining content, failure and ordering checks are listed below. Historical setup sections retain the evidence available at their stated dates. Local simulations alone cannot prove account credentials, Access policy, real compilation/deployment or delivery latency.

The owner has explicitly authorized authenticator-app codes as an alternative Access Independent MFA method; see [the accepted decision](22-access-mfa-decision.md). The confirmed GitHub login followed by Cloudflare's separate authenticator-app challenge meets that amended requirement. GitHub is the identity provider; the approved ENSIA address is the identity checked in the Access token, not a requirement to use direct email/password login.

## Implementation

**Publish saved content** records a private immutable capture and an audited publication request. The browser may close immediately after acceptance. A bounded scheduled coordinator processes one queued request per minute, dispatches the fixed owner/main GitHub workflow, verifies its successful run, identifies the exact uploaded static version and activates it through a durable D1 reservation. A request is never considered published just because GitHub accepted or completed a build. Later edits do not change the saved input. A lost request response is retried with the same UUID; an interrupted capture/intent can also be recovered after reloading the console.

Public and private activation share the tested coordination algorithm and transport, with separate tables and fences. Migration `0013_publication.sql` adds public deployment history, the publication queue and an immutable capture environment. Failed builds keep the previous deployment. A deployment timeout retains its reservation; only exact positive provider evidence can acknowledge it, including after capture expiry. No expiring lock, force-clear or automatic second deployment POST is used. A D1 watermark rejects an older capture even if the provider's current-version read is stale. Out-of-band deployments invalidate this guarantee and must not run alongside the coordinator.

The workflow packages both modes with the same route/media/CV checks. Public uploads have **no `main`, asset binding, D1/R2 binding, runtime variables or routes**. Pinned Wrangler `versions upload` uploads an inactive assets-only version; its release receipt is stored in the version annotation because an assets-only Worker has no runtime variable bindings. It does not deploy or change DNS. The guard remains exclusive to the private preview. See Cloudflare's [static asset architecture](https://developers.cloudflare.com/workers/static-assets/) and [version/deployment separation](https://developers.cloudflare.com/workers/versions-and-deployments/).

The public package includes `release.json`: capture ID, revision, capture timestamp, snapshot hash and three PDF hashes only. The package manifest binds this file along with every other static file. It contains no originals, private paths, actors or diagnostics. `scripts/observe-publication.ts` verifies this exact receipt, EN/FR/AR revisions/CV links, Arabic direction, PDF bytes and absence of public cookies. It rejects a receipt that changes during observation. Its timings are observed upper bounds, including any delay before observation starts.

Captures record `preview` or `production` independently of their preview/publish purpose. The capture API derives this from the admin environment, never from caller input. Retrieval/report storage must match that environment's bucket; public upload must match that environment's fixed target. The GitHub build uses the corresponding GitHub Environment for secret isolation. This prepares the public publication path for production; creating/configuring production resources, its private preview/Access configuration and final domain cutover remain launch work under `18`.

## Live resources and owner setup

On 2026-10-18 the existing local Wrangler login was verified. The separate private guard was bootstrapped at:

`https://mohamedeghboudj-site-preview.mohamed-charaf-eddine-deghboudj.workers.dev`

The initial bootstrap (`898f4ed1-38be-4cb9-8c66-60b78e103056`) contained no unpublished assets and failed closed with an empty audience. After the owner attached Worker-bound Access, version `90110351-ecca-4dd4-a2ba-895eee7f59ae` installed the supplied audience. The owner subsequently confirmed its authenticated status response `{"ready":false,"release":null}` and a separate Cloudflare MFA challenge after GitHub login. It still contains no unpublished assets. The admin's existing Access application is unchanged.

The earlier empty-secret discrepancy is resolved: the owner confirmed the exact admin Worker/account and all three Worker/GitHub tokens, and Wrangler independently listed `PUBLISH_GITHUB_TOKEN`, `PREVIEW_CLOUDFLARE_API_TOKEN` and `PUBLISH_CLOUDFLARE_API_TOKEN`. Their values were not read. These setup instructions remain as reproducible documentation; token permissions, R2 retrieval and Actions configuration must still pass the live build.

The original project instructions reserve account/dashboard changes and interactive sign-in to the owner. These steps therefore need the owner; values must go directly into secret prompts/settings, never chat:

1. Attach Access using **`mohamedeghboudj-site-preview` → Access**, the Worker's own Access tab. Do not substitute a hostname-only application under Domains & Routes. Reusing the owner's existing Auth policy is valid when its addresses belong to that same owner and Independent MFA is required; a second allowlist is unnecessary. The origin independently permits the approved ENSIA email, so use that identity for the live test. The owner confirmed this Worker-bound configuration and supplied the separate AUD `5c210b54b54c206a4e5cd7410c1ef85b80dd53acb6cecde981cdd969b7e678c4`. Test a fresh private browser window and direct page/PDF URLs after deployment.
2. Create the fine-grained GitHub token from `15`: only this repository, Actions read/write, expiry, implicit Metadata read. Enter it into the existing admin:

   ```powershell
   npx wrangler secret put PUBLISH_GITHUB_TOKEN --config apps/admin/wrangler.remote.json
   ```

3. Create expiring Cloudflare API tokens for preview and public publication, with Workers Scripts Edit and Account Settings Read on this account, scoped to the intended Worker where supported. No DNS, Access, D1, R2 or billing permissions. Store each in the admin and in the GitHub **preview Environment's** secrets under the same name:

   ```powershell
   npx wrangler secret put PREVIEW_CLOUDFLARE_API_TOKEN --config apps/admin/wrangler.remote.json
   npx wrangler secret put PUBLISH_CLOUDFLARE_API_TOKEN --config apps/admin/wrangler.remote.json
   ```

4. In GitHub → repository Settings → Environments, create **`preview`** before running this workflow. The preview build may inherit the existing repository `CLOUDFLARE_ACCOUNT_ID` secret. Configure the two Workers tokens above, the bucket-scoped read-only `PUBLISH_R2_ACCESS_KEY_ID` / `PUBLISH_R2_SECRET_ACCESS_KEY` from `15`, and the separate bucket-scoped read/write `DIAGNOSTICS_R2_ACCESS_KEY_ID` / `DIAGNOSTICS_R2_SECRET_ACCESS_KEY` from `20`. Both R2 credentials target only **`mohamedeghboudj-media-preview`**. Keep R2 private; no public URL or CORS change.
5. Set these **preview Environment variables**:

   | Name                          | Value                                                              |
   | ----------------------------- | ------------------------------------------------------------------ |
   | `PREVIEW_ACCESS_ISSUER`       | `https://mohamedeghboudj.cloudflareaccess.com`                     |
   | `PREVIEW_ACCESS_AUDIENCE`     | `5c210b54b54c206a4e5cd7410c1ef85b80dd53acb6cecde981cdd969b7e678c4` |
   | `ADMIN_ACCESS_AUDIENCE`       | `4e56e10a3b42ca56b2b0db8366393ef9d8e6c828194088788847028a90c8843a` |
   | `PREVIEW_OWNER_EMAIL`         | `mohamed-charaf-eddine.deghboudj@ensia.edu.dz`                     |
   | `PREVIEW_UPLOAD_ENABLED`      | `true`                                                             |
   | `PUBLISH_UPLOAD_ENABLED`      | `true`                                                             |
   | `PUBLISH_DIAGNOSTICS_ENABLED` | `true`                                                             |

The compiler receives none of these credentials. Retrieval, upload and diagnostic storage credentials are each scoped to their own workflow step. A production GitHub Environment must eventually use its own bucket credentials and configuration; never copy preview bindings into production.

### Where the R2 keys and AUD values come from

In **Cloudflare → R2 object storage → Overview → Account Details → API Tokens → Manage**, create an expiring R2 API token with **Object Read only** permission, restricted to **`mohamedeghboudj-media-preview`**. A descriptive name such as `website-preview-reader` is sufficient. The completion screen provides an **Access Key ID** and **Secret Access Key**; save the latter at creation because Cloudflare does not display it again. These are the S3 credentials described in [Cloudflare's R2 authentication guide](https://developers.cloudflare.com/r2/api/tokens/).

In **MyPersonalWebsite → Settings → Environments → preview → Environment secrets**, map Access Key ID to `PUBLISH_R2_ACCESS_KEY_ID` and Secret Access Key to `PUBLISH_R2_SECRET_ACCESS_KEY`. Enter the generated S3 values, not the separate API token value. A local Wrangler login and Worker secrets do not automatically populate GitHub Actions. Repository Actions secrets can also be inherited, but a secret stored in another GitHub Environment is not available to the `preview` job. Never send either key in chat.

For private reports, create a **separate** expiring credential scoped to the same bucket with **Object Read & Write**, and store its S3 pair as `DIAGNOSTICS_R2_ACCESS_KEY_ID` and `DIAGNOSTICS_R2_SECRET_ACCESS_KEY`. Keep the retrieval pair read-only.

Both audience values in the table are required by the preview upload validation. They are non-secret **Environment variables**, not Environment secrets: the workflow reads them through `vars`. The preview audience identifies its Access application; the admin audience lets validation reject accidental reuse of the same application for both Workers. The owner already supplied these exact values. No new Access applications are needed. To verify an existing value, go to **Zero Trust → Access controls → Applications → Configure → Additional settings → Application Audience (AUD) Tag**, as documented in [Cloudflare's AUD instructions](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/#get-your-aud-tag). Retain the existing Worker-bound Access attachment.

### First live private-build findings

On 2026-10-20, all three owner requests were recorded as separate preview captures, each with one accepted dispatch: `0e014232-a9f4-4391-b6a9-2eb588227b94` / run `39374754681`, `5c5ac0ca-61bf-4068-b28b-532c02fb0f83` / run `39374776104`, and `ed1a4017-34cd-41b9-b18e-1a4cde73edd8` / run `39374867156`. No public publication was requested. Their checks jobs passed, but input retrieval failed. The last run's public log shows both retrieval credential environment values empty; reporting was skipped. This proves dispatch, not successful retrieval or deployment. The earlier setup confirmation therefore did not establish that these specific Actions inputs were available.

The console previously discarded its useful dispatch state when a subsequent GitHub status read failed, leaving Start private build visible. The status API now retains the recorded dispatch and its fixed GitHub link, with an explicit unavailable-status message and no verified run. The console polls read-only status until it recovers. Provider HTTP failures include only their status number; response bodies and exceptions remain private. No second dispatch is sent, and no absent or mismatched run can authorize activation. The original provider response was not recorded, so its specific cause is unproven; an immediately unavailable run is covered by regression tests, not claimed as observed fact.

Local regression checks for the status fix pass: 214 unit/integration cases, ten console browser flows, type checking, lint and formatting. The new cases cover unavailable/malformed/mismatched provider results, actual workerd reads with large GitHub run IDs, reload recovery and polling without a second POST. The 390px screenshot retains the existing flat layout, labeled selector and quiet status/link; axe passes. JavaScript remains within unchanged caps at 249,334 initial / 9,826 deferred / 259,160 complete bytes. PR #17 merged after CI passed, and admin version `2e8cd6d9-0d0f-4959-bd7a-632500845187` deployed this fix.

### Fresh-runner retrieval correction

On 2026-10-21, preview run `39566756483` and publication run `39566863157` passed their checks jobs but failed input retrieval before compilation, packaging or version upload. Retrieval credentials were present in those jobs; the separate report credentials were empty. The owner subsequently confirmed adding the diagnostic pair to the preview Environment and downloaded the first capture with Wrangler. Its 5,035 bytes exactly match the immutable D1 input/snapshot hashes, size, revision and timestamp. It contains no media originals. This verifies the stored capture, not GitHub's S3 authentication.

A fresh-workspace reproduction then exposed a filesystem defect: checkout contains no ignored `artifacts` directory, but materialization attempted to create `artifacts/captured-input` without its parent. Existing local tests had already created the parent. Materialization now creates parent directories after input verification, while still requiring the capture directory itself to be new. It does not reuse or overwrite a prior capture. A regression executes the actual retrieval CLI with synthetic signed-GET responses in an empty workspace, verifies the resulting capture, then verifies that a second attempt fails without changing it.

Public Actions logs now report only fixed categories: `workflow-context`, `storage-configuration`, `storage-denied` (401/403), `storage-response` (other rejected responses), `storage-transport` (request failure), or `input-validation-or-local-write` (including missing/expired/invalid input or local filesystem failure). Provider bodies, keys, credentials, unpublished content and raw exceptions are never printed. Child-process tests verify exact safe output for invalid identity/configuration and denied/failed requests. The earlier generic log cannot prove that the directory defect was the only live failure; a fresh run on the corrected main branch must still prove actual retrieval, private report storage and activation.

### Live retrieval, compilation and report proof

PR #18 merged at `7f26e580a8d55da547103d3b480c06bb4dc4d075` after all 216 tests, browser checks and the full trilingual TeX proof passed. The owner's next requests used that commit: private capture `b7c48ad8-d620-46c1-a94a-1f6668572344` / run `39665861215`, and public-spike capture `9b2dce50-eef6-4366-b58a-0567a69a03cd` / run `39665919226`. Both retrieved the real immutable inputs, compiled the site and all three CVs, and verified their packages. Both then failed candidate upload. The private and public build reports were each stored and read back successfully using the separate diagnostic credential.

The private report was independently downloaded through Wrangler and validated against D1's exact capture metadata and GitHub run/attempt. It records retrieval/build/package success and upload failure, with bounded compiler logs. Those logs remain private in ignored local artifacts. This proves diagnostic storage; reading the report through the protected owner console remains a browser acceptance check. Both requests use existing revision 4, so they do not establish fresh-save latency.

Investigation on 2026-10-22 confirmed that both existing bootstrap versions pass the actual upload validator against read-only provider metadata. Both generated configurations also pass the pinned Wrangler's real offline dry run. Neither check exercises the GitHub upload tokens. The earlier generic upload error does not identify its cause, so token permissions are not yet blamed or proven.

Candidate upload now reports a fixed stage (`configuration`, `bundle`, `active-target`, `release-order`, `local-setup`, `pre-upload-bundle`, `wrangler-upload`, `receipt`, `candidate`, or `final-bundle`) and a fixed reason (`validation`, `transport`, or a numeric HTTP status). It never retains an upstream exception or prints provider bodies, URLs, bindings, CLI logs or credentials. This diagnostic change preserves all existing validation, ordering and no-retry rules. Tests include HTTP denial/redirect/transport cases, unchanged upload-attempt bounds and real Wrangler dry runs for both package types. A fresh live attempt on the merged change is still required to identify and resolve the upload failure.

The next run, `39725277401`, identified `active-target/http-401`: Cloudflare rejected the preview upload credential before upload. After the owner corrected the credential and started fresh private capture `c863adbc-50ae-450d-9473-381318f3cd2e`, run `39822191486` passed retrieval, compilation and packaging, uploaded a candidate, then failed at `receipt/validation`. Its private report was stored and verified. Read-only provider inspection confirmed candidate `f8d1c306-8cbc-4e21-a4c6-24086b1ac3e2` matches capture sequence 10/revision 4 and passes the existing release/identity validator. The active preview remained bootstrap `90110351-ecca-4dd4-a2ba-895eee7f59ae`; no activation occurred.

The receipt defect was reproduced with the pinned Wrangler's actual offline output: it writes a `wrangler-session` record followed by `version-upload`, but the parser required one line. The earlier dry-run test overwrote the real output with a simplified fixture and missed this envelope. The parser now requires exactly that ordered pair, retaining the worker/UUID checks, refusal of version/alias URLs, bounded private file, provider readback and sealed-bundle verification. Unknown, missing, reordered and duplicate records still fail closed. The regression test preserves the real CLI records and replaces only the dry run's null version ID with a synthetic UUID, for both private and assets-only public packages. Session arguments and log paths remain private. A fresh successful build and owner activation are still required; the uploaded candidate from the failed run is not eligible for activation.

The retention schedule is independently proven for an earlier disposable capture: D1 marked `ed1a4017-34cd-41b9-b18e-1a4cde73edd8` expired on 2026-10-21 after its 24-hour lifetime, and a subsequent remote R2 read confirmed the object no longer exists. Report retention still needs an expired-report check.

## Deployment sequence

Implementation `b68e48c` passed all 212 tests, nine console and nine public browser flows, and the full trilingual TeX Live proof including both private and public packages. PR #9 was retargeted to `main` to include the complete console history despite PR #8's stale reported head. The merged tree at `8ae0be7` exactly matches the tested implementation; GitHub marked both PRs merged and post-merge Platform checks passed. `build-capture.yml` is now on `main`. This integration is not evidence that the live tests passed.

Content migrations `0007`–`0013` are applied to the isolated preview content D1; its foreign-key check passed. The reviewed admin was deployed with publishing disabled at `eab85982-881d-46e5-829e-82a808668c12`, and the private guard has its separate AUD. The public **spike** bootstrap at `a64ef009-4b80-4231-a94b-e9222280c5a6` has annotation `publication-bootstrap-v1`; provider metadata confirms static assets, no script handlers and no bindings. The existing Namecheap/GitHub domain is not a target. Enabling controls and scheduled jobs does not itself publish a new capture. Choosing Publish makes that capture publicly accessible on the separate spike `workers.dev` address; final-domain cutover remains a later owner action.

Once secrets/configuration are present, the admin's ignored remote configuration needs:

- `PUBLISH_BUILDS_ENABLED=true`, `PUBLISH_MAINTENANCE_ENABLED=true`, `PREVIEW_ACTIVATION_ENABLED=true`, `PUBLISH_DEPLOYMENTS_ENABLED=true`;
- the separate `PREVIEW_ACCESS_AUDIENCE`, existing `CLOUDFLARE_ACCOUNT_ID`, `APP_ENV=preview` and existing protected admin identity/bindings;
- crons `17 * * * *` (retention) and `* * * * *` (publication).

Do not enable scheduled flags while required credentials are absent. No workflow callback, Access bypass, extra login system or account-wide credential is needed.

On 2026-10-20, after confirming the three secret names and the owner's accepted MFA-method change, version `12755d3c-e7cf-4080-832c-05a4ed08478c` enabled these four flags and both schedules on `mohamedeghboudj-admin-spike`. The publication queue contained zero requests before activation. Wrangler confirmed the deployed schedules; a real scheduled invocation and physical expiry remain separate evidence gates. The public target is still the empty spike bootstrap until an owner publication completes. The next owner step is **Website publishing → Prepare saved content → Start private build** from the existing protected console.

## Verified private preview on 2026-10-23

After PR #20, capture `e9fdb4b2-a155-493d-8cc9-d5e4f1e787e6` completed [run 39825320922](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/39825320922): retrieval, EN/FR/AR compilation, site build, packaging, candidate upload/readback and private report write/readback all succeeded. Version `2c41166b-9234-4cdb-bab4-dc1217af3666` was activated at 100% on 2026-10-23 at 16:04:39 UTC. The initial response left the ledger uncertain; **Recover preview status** reconciled the exact existing provider deployment without another deployment POST. D1 then recorded `deployed`, with no unresolved preview fence. The original response ambiguity's cause is not established.

The owner opened the preview and confirmed all three localized pages and PDFs work, Arabic RTL works, and a fresh private window requires Access for `/cv/ar.pdf`. Protected report reading/download was also confirmed for the preceding failed attempt. These are functional confirmations only: the owner explicitly deferred layout/styling/UI acceptance while the content remains technical test data. The requested Arabic identity and selector correction is recorded in [23](23-localized-identity.md).

Physical expired-report deletion is now verified too: report for capture `b7c48ad8-d620-46c1-a94a-1f6668572344`, run `39665861215`, expired on 2026-10-22 at 19:55:34 UTC; remote R2 lookup on 2026-10-23 returned “The specified key does not exist.” D1 marked the capture expired, with scheduled cleanup checkpoint revision 75 at 08:17:53 UTC. Together with the earlier input-object deletion this closes the observed input/report retention check. Historical pending statements above describe their state at the time.

## Security audit gate on 2026-10-24

After PR #21, the owner saved the correct Arabic profile name and a visible project under slug `hello`, with English and Arabic translations, selected in the public CV under custom section `Projects`. The latest transactional save was at 04:26:37 UTC, revision 8. The planned English-only `publishing-check` item is not present, so the two-language fallback setup still needs correction. Capture `5ee54a3f-71b9-4c07-afeb-169146bb30c9` was recorded as **preview**, so it did not create a public publication request. Its [run 40062419662](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/40062419662), like the preceding run, passed application checks but failed the dependency audit before retrieving or building the capture. The active deployments were not changed by those runs.

The dependency patch pins Zod 4.6.6 and bounds transitive overrides to patched Undici 7.30.1 / 8.12.2 and fast-uri 3.1.9, preserving both Undici major versions. These address the updated [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [Undici advisories](https://github.com/advisories/GHSA-xjj6-f33q-929c) and [fast-uri advisories](https://github.com/advisories/GHSA-w74x-v6f9-j3xg). The regenerated lockfile reports zero vulnerabilities in the npm audit. The existing CI audit threshold remains unchanged. A fresh capture on the patched main branch is required; rerunning an old immutable request uses its old commit.

For the remaining public proof, use the filled **Publish saved content** button directly. It queues publication automatically; **Prepare saved content → Start private build** creates only a private preview. The Arabic name is already correct. Use an English-only disposable project selected under the lowercase built-in section key `projects` to verify French/Arabic fallback and localized CV headings. Save the test setup immediately before publishing so the measured save time describes the fresh request rather than the earlier blocked attempts.

## Verified automatic public publication on 2026-10-25

The owner requested publication of saved revision 8 through the filled **Publish saved content** button. Capture `430d0427-4fe0-4e54-af1a-081e47a31d28` (sequence 15, purpose `publish`, environment `preview`) was accepted at 07:25:56 UTC. The scheduled coordinator dispatched [run 40172748136](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/40172748136) on patched main `8d7bb89b0983b6e574a7c6935278273821b59c20`. Application/audit/browser checks, input retrieval, EN/FR/AR compilation, site packaging, public candidate upload/readback and private report storage all passed.

Cloudflare activated version `5761a2a3-6dac-44fe-8a23-ff6593fe00bd` at 100%, deployment `679cd055-c500-450f-a1c3-4c22f0a6add0`. The initial activation response left the reservation uncertain; the next scheduled tick reconciled exact positive deployment history and marked the request **published** without another deployment POST or an owner recovery click. There are zero unresolved public deployment reservations. The initial response ambiguity's cause remains unproven; it must not be reported as a rejected deployment or solved by retrying the POST.

Independent provider inspection confirmed the active release matches the capture ID, sequence, revision and snapshot hash. It remains assets-only: no application script handlers, no runtime bindings, and direct static asset serving. The owner ran the read-only observer, which verified the exact release receipt, all three anonymous public pages, Arabic RTL, matching EN/FR/AR PDF hashes, absence of response cookies, and an unchanged receipt after the checks. The ignored evidence is archived under `artifacts/publication-proof/430d0427-4fe0-4e54-af1a-081e47a31d28/`. This proves the public spike path; the real domain still points to its existing site.

| Event                                | UTC                       | Elapsed from capture |
| ------------------------------------ | ------------------------- | -------------------- |
| Capture created                      | 07:25:55.645              | —                    |
| Cloudflare deployment created        | 07:33:06.752619           | 7m11.108s            |
| Coordinator acknowledged publication | 07:34:03.447              | 8m07.802s            |
| Anonymous pages/PDFs observed        | 07:34:27.761–07:34:28.802 | 8m32.116s–8m33.157s  |

The observer timings are upper bounds, including any delay before observation. The GitHub checks job took 3m09s and the captured-build job 3m43s; its combined CV/site build step took 3m20s, including compiler setup. This path is slower than the earlier accepted ~4m12s Sprint 0 benchmark. The actual source save was on the preceding day, so its large save-to-observation interval is **not** a fresh-save latency measurement. No new performance acceptance is inferred from this run.

The earlier same-day capture `ce70b2ed-78b5-4228-9b23-af1386c31254` was a private preview, with no public request. Its dispatch became uncertain after about 10.1 seconds, consistent with the configured 10-second deadline; no matching GitHub run was found and the cause is not proven. It was not redispatched. The successful public request above is a distinct owner-authorized capture.

## Fresh-save publication verified on 2026-10-27

The owner's English-only `publishing-check` project was saved and selected in the public CV alongside `hello`, with both selection rows using the built-in `projects` section. The project save was at 07:42:08.283 UTC on 2026-10-25; the final CV-selection save was at 07:44:31.954 UTC. Capture `5199b673-1a28-468f-8112-34848d0d3201` then captured revision 10, sequence 16, at 07:45:34.859 UTC. Read-only D1 inspection confirmed the new project's sole translation is English, its visibility and CV inclusion, and the exact transactional save timestamps.

[Run 40174018934](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/40174018934), on main `4f1d13230faaa3f27af435d9d09f35ca74559571`, passed its full checks, retrieval, trilingual CV/site build, packaging, public candidate upload/readback and private report storage. Cloudflare activated version `7095fa92-3968-4a33-b0bb-4bad9f901c14` at 100%, deployment `a893caa9-ac5f-4f1e-b3e5-ef5bc2e8a261`. On 2026-10-27, independent provider inspection confirmed it remains the active version, matches D1's capture/sequence/revision/snapshot hash, and still serves static assets directly with no application script or bindings.

| Event                                | UTC on 2026-10-25 | Elapsed from final save |
| ------------------------------------ | ----------------- | ----------------------- |
| Final CV-selection save              | 07:44:31.954      | —                       |
| Capture created                      | 07:45:34.859      | 1m02.905s               |
| Cloudflare deployment created        | 07:54:06.680776   | 9m34.726s               |
| Coordinator acknowledged publication | 07:55:04.934      | 10m32.980s              |

Capture-to-provider-activation was **8m31.821s**. GitHub's checks job took 3m51s, the build job 3m23s, and the combined CV/site build step 3m01s. The save-to-capture interval includes the owner's console handoff. As in the preceding publication, the initial activation response was uncertain; the next scheduled tick reconciled the single exact deployment and marked the publication published. No repeated deployment POST or manual recovery was needed, and no unresolved public reservation remains. The original response ambiguity's cause is still unproven.

The private input expired normally after 24 hours; this does not expire the published assets. Provider, audit, source-selection and GitHub timing evidence is archived in ignored `artifacts/publication-proof/5199b673-1a28-468f-8112-34848d0d3201/`. The previous revision 8 observation remains in its own archive.

The owner subsequently ran the read-only helper `artifacts/observe-fresh-publication.mjs` on 2026-10-27 at 06:37 UTC. It verified the exact active receipt, anonymous EN/FR/AR pages and PDF hashes, Arabic RTL, no response cookies and a stable receipt across observation. Every localized project page contains the English-only title and summary; the Arabic website shows `محمد شرف الدين دغبوج`, and English/French language selectors show `AR`. The downloaded receipt's snapshot hash also matches the independently inspected provider release and D1 capture.

All three downloaded PDFs were hash-checked again, text-extracted and rendered locally with PDF.js. Each has one page containing the new project's English title and summary. Visual inspection confirmed the Arabic header reads `محمد شرف الدين دغبوج` with connected shaping, right-to-left layout and correctly ordered English fallback text. The section headings are localized (`Projects`, `Projets`, `المشاريع`), and no missing glyphs, clipping or orphan headings were visible on these three technical-test pages. Renderings, extracted text and inspection results remain in the capture's ignored evidence archive. This closes the fresh-save, English-fallback and localized-name functional checks; it is not acceptance of final content, design or accessibility.

The contemporaneous 30-minute observer window was missed. These later checks are explicitly delayed content evidence, without a publishing-latency claim; the original observer's freshness guard remains unchanged. The timing table uses original provider and audit timestamps. No acceptance of the longer publishing delay is inferred.

## Live acceptance evidence still required

Use disposable synthetic content in preview D1 for the remaining tests. Private preview activation, functional language/PDF checks, report access, retention, automatic publication, fresh-save-to-deployment timing, deployed English fallback and the localized Arabic name are verified above. Deliberate public-build failure preserving the now-active last-good version and competing captured revisions still need live evidence. Do not repeat the accepted setup or fresh-save checks.

Publish a fresh English-only test item using the console. Leave the console page while the job runs, then recover the request from its selector. Confirm English fallback on French and Arabic pages and the updated three PDFs. Record the capture ID and capture time from the owner API and the save time from the transactional audit, without exporting content or credentials. Put only those non-secret fields into ignored `artifacts/publication-observation-request.json`:

```json
{
  "captureId": "<actual UUID>",
  "environment": "preview",
  "savedAt": "<actual ISO save timestamp>",
  "capturedAt": "<actual ISO capture timestamp>"
}
```

Run the read-only observer from an authorized network-capable terminal while publication runs:

```powershell
.\scripts\pnpm.cmd exec node scripts/observe-publication.ts
```

It writes ignored `artifacts/publication-live-evidence.json`. Archive each result under its capture ID before the next run replaces it. Record GitHub queue/build times separately and compare the new automatic path to the previously accepted ~4m12s spike. A delayed start makes the observation an upper bound, never an exact deploy time. Repeat with a failing build and competing captured revisions; verify last-good preservation and that the older version cannot overwrite the newer one. Scheduled input/report retention is already proven above. Keep the remaining gates open until evidence exists.

### Prepared failure and ordering checks

After downloading revision 10's evidence, use only the disposable `publishing-check` project for the remaining live tests. A local preflight verified that the literal English summary `Publishing failure check \publishingcheck` passes the editor and public-snapshot schemas but is rejected by the existing CV text validator, before any TeX compiler starts, in every locale. Restoring the normal summary renders successfully in every locale. This supplies a deterministic failed build without changing secrets, weakening checks, modifying the immutable capture or adding a fault-injection endpoint. The ignored local result is `artifacts/publication-failure-preflight.json`; it is not live proof.

The owner should save that summary and request one public publication, then restore `This is a temporary publishing verification item`, save, and request a second publication. The first immutable capture must still fail even though the editable content has already been repaired. Observe its failed workflow/publication, the unchanged revision 10 deployment and receipt, then the later restored publication succeeding. Keep a private report of the failure and confirm the protected console exposes its status without publishing diagnostics.

For the successful ordering check, queue two successive saved revisions of the same disposable project with distinguishable plain-text summaries before the first finishes. The scheduled coordinator intentionally processes the oldest queued request until it reaches a terminal state; it does not dispatch later requests around an unresolved earlier one. Record both capture identities, workflow/deployment times and public receipts, and confirm the final active revision is the newer one. A late stale-provider/older-candidate attempt is additionally covered by the existing coordinator/D1 regression tests; do not describe a normal FIFO live run as a forced stale-provider race. Do not bypass the queue, clear a reservation, redeploy an old version directly or change capture history to manufacture that race.

## Design and local verification

The Website publishing disclosure retains the shared tokens, native controls and quiet metadata from `06`. Publish is the single filled action; preparing a private preview is secondary. The console separates capture, workflow, publication and currently active version, preserves drafts/re-authentication recovery and displays private logs as escaped text. Desktop/390px browser screenshots were inspected; no new color, motion or decorative effect was added. Actual device review remains a launch requirement.

Local verification passed type checking, lint, formatting and the full 211-test regression suite. A subsequent 15-test targeted run also passed, including the added rejection of runtime Workers carrying copied public release annotations; the suite now contains 212 tests. Nine browser flows pass, including a lost Publish response followed by page closure/recovery and private report reading. Initial/deferred/complete JavaScript is 249,334 / 9,790 / 259,124 bytes, within the existing 250/10/260 kB caps. Migration `0013`, the admin dry run and a generated assets-only `versions upload --dry-run` pass. Read-only inspection of the existing live public spike confirmed the provider's assets-only metadata shape used by the new verification. Current-head CI and live evidence will be recorded when available; these local checks do not close the live gates above.
