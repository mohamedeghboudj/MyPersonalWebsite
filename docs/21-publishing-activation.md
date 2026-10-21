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

Local regression checks pass: 214 unit/integration cases, ten console browser flows, type checking, lint and formatting. The new cases cover unavailable/malformed/mismatched provider results, actual workerd reads with large GitHub run IDs, reload recovery and polling without a second POST. The 390px screenshot retains the existing flat layout, labeled selector and quiet status/link; axe passes. JavaScript remains within unchanged caps at 249,334 initial / 9,826 deferred / 259,160 complete bytes. The owner still needs to complete the Actions configuration before a fresh live build can prove retrieval and private deployment.

## Deployment sequence

Implementation `b68e48c` passed all 212 tests, nine console and nine public browser flows, and the full trilingual TeX Live proof including both private and public packages. PR #9 was retargeted to `main` to include the complete console history despite PR #8's stale reported head. The merged tree at `8ae0be7` exactly matches the tested implementation; GitHub marked both PRs merged and post-merge Platform checks passed. `build-capture.yml` is now on `main`. This integration is not evidence that the live tests passed.

Content migrations `0007`–`0013` are applied to the isolated preview content D1; its foreign-key check passed. The reviewed admin was deployed with publishing disabled at `eab85982-881d-46e5-829e-82a808668c12`, and the private guard has its separate AUD. The public **spike** bootstrap at `a64ef009-4b80-4231-a94b-e9222280c5a6` has annotation `publication-bootstrap-v1`; provider metadata confirms static assets, no script handlers and no bindings. The existing Namecheap/GitHub domain is not a target. Enabling controls and scheduled jobs does not itself publish a new capture. Choosing Publish makes that capture publicly accessible on the separate spike `workers.dev` address; final-domain cutover remains a later owner action.

Once secrets/configuration are present, the admin's ignored remote configuration needs:

- `PUBLISH_BUILDS_ENABLED=true`, `PUBLISH_MAINTENANCE_ENABLED=true`, `PREVIEW_ACTIVATION_ENABLED=true`, `PUBLISH_DEPLOYMENTS_ENABLED=true`;
- the separate `PREVIEW_ACCESS_AUDIENCE`, existing `CLOUDFLARE_ACCOUNT_ID`, `APP_ENV=preview` and existing protected admin identity/bindings;
- crons `17 * * * *` (retention) and `* * * * *` (publication).

Do not enable scheduled flags while required credentials are absent. No workflow callback, Access bypass, extra login system or account-wide credential is needed.

On 2026-10-20, after confirming the three secret names and the owner's accepted MFA-method change, version `12755d3c-e7cf-4080-832c-05a4ed08478c` enabled these four flags and both schedules on `mohamedeghboudj-admin-spike`. The publication queue contained zero requests before activation. Wrangler confirmed the deployed schedules; a real scheduled invocation and physical expiry remain separate evidence gates. The public target is still the empty spike bootstrap until an owner publication completes. The next owner step is **Website publishing → Prepare saved content → Start private build** from the existing protected console.

## Live acceptance evidence still required

Use disposable synthetic content in preview D1. Record its save transaction's audit timestamp, then capture/build/activate the private preview. Confirm Independent MFA, owner-only pages and all three actual PDFs, and anonymous denial for direct pages/PDF/report requests. Check the successful private report and one deliberately failing synthetic build's report; a failed build must preserve the active version.

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
