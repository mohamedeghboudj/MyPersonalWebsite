# Publishing completion and live activation

This is the current handoff for publishing, superseding the implementation status in `15`–`20`. Private preview, private reports and public publication controls are implemented. Live activation is still a gate: local simulations cannot prove account credentials, Access policy, real compilation/deployment or delivery latency.

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

## Live acceptance evidence still required

Use disposable synthetic content in preview D1 for the remaining public publication proof. Private preview activation, functional language/PDF checks, report access and retention are verified above. A fresh save-to-publication test, deliberate failure preserving the now-active last-good version, and competing captured revisions still need live evidence.

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

It writes ignored `artifacts/publication-live-evidence.json`. Record GitHub queue/build times separately and compare the new automatic path to the previously accepted ~4m12s spike. A delayed start makes the observation an upper bound, never an exact deploy time. Repeat with a failing build and competing captured revisions; verify last-good preservation and that the older version cannot overwrite the newer one. Finally verify a real scheduled retention invocation and removal of expired disposable input/report objects. Keep this gate open until evidence exists.

## Design and local verification

The Website publishing disclosure retains the shared tokens, native controls and quiet metadata from `06`. Publish is the single filled action; preparing a private preview is secondary. The console separates capture, workflow, publication and currently active version, preserves drafts/re-authentication recovery and displays private logs as escaped text. Desktop/390px browser screenshots were inspected; no new color, motion or decorative effect was added. Actual device review remains a launch requirement.

Local verification passed type checking, lint, formatting and the full 211-test regression suite. A subsequent 15-test targeted run also passed, including the added rejection of runtime Workers carrying copied public release annotations; the suite now contains 212 tests. Nine browser flows pass, including a lost Publish response followed by page closure/recovery and private report reading. Initial/deferred/complete JavaScript is 249,334 / 9,790 / 259,124 bytes, within the existing 250/10/260 kB caps. Migration `0013`, the admin dry run and a generated assets-only `versions upload --dry-run` pass. Read-only inspection of the existing live public spike confirmed the provider's assets-only metadata shape used by the new verification. Current-head CI and live evidence will be recorded when available; these local checks do not close the live gates above.
