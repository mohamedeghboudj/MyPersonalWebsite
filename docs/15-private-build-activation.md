# Private captured build — activation handoff

The implementation is reviewable in draft PR #9. It validates a captured input, EN/FR/AR CVs and the static site; it does not deploy or provide a browser-accessible private preview yet. Keep the complete Phase 3 PR in draft until the remaining publishing work is finished. This document prepares the account steps without asking for a premature merge or launch.

The owner's original project instructions reserve interactive login and account changes to the owner. Credential creation and secret entry therefore need the owner's terminal/dashboard. Never send their values in chat or put them in a tracked file. The existing spike deployment token has no R2 or GitHub Actions permissions and should not be broadened.

## Credentials that can be prepared separately

1. In GitHub account settings, open **Developer settings → Personal access tokens → Fine-grained tokens**. Create an expiring token with resource owner `mohamedeghboudj`, access to **only** `MyPersonalWebsite`, and repository **Actions: Read and write**. Metadata read is implicit. No Contents write, Administration or account-wide permission is needed. Enter this token directly into the existing admin Worker's secret prompt from the repository root:

   ```powershell
   npx wrangler secret put PUBLISH_GITHUB_TOKEN --config apps/admin/wrangler.remote.json
   ```

   This command targets the already configured protected admin preview Worker. Do not use the contact or public Worker configuration. Token creation follows [GitHub's fine-grained-token instructions](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens); the dispatch endpoint specifically requires [Actions write permission](https://docs.github.com/en/rest/actions/workflows#create-a-workflow-dispatch-event).

2. In **Cloudflare → R2 object storage → Account Details → API Tokens → Manage**, create an expiring R2 token with **Object Read only**, scoped to the single existing bucket **`mohamedeghboudj-media-preview`**. Keep the bucket private. Use the generated S3 **Access Key ID** and **Secret Access Key**, not the API token value. Cloudflare documents [bucket-scoped object-read permissions and S3 credentials](https://developers.cloudflare.com/r2/api/tokens/).

3. In **MyPersonalWebsite → Settings → Secrets and variables → Actions**, add these two repository secrets directly:

   | Secret                         | Value entered privately  |
   | ------------------------------ | ------------------------ |
   | `PUBLISH_R2_ACCESS_KEY_ID`     | The R2 Access Key ID     |
   | `PUBLISH_R2_SECRET_ACCESS_KEY` | The R2 Secret Access Key |

   The workflow reuses the already configured `CLOUDFLARE_ACCOUNT_ID` secret and the confirmed preview bucket name. It does not use the spike deployment token. No CORS, public R2 URL, DNS or billing change is required.

For local development, a credential belongs only in gitignored `.dev.vars`. Do not put a GitHub token into workflow input fields or an R2 credential into the Worker: each lives only where its operation needs it.

## Activation after implementation review

These are integration steps for the later reviewed activation, not instructions to merge PR #9 now:

1. The reviewed `build-capture.yml` and reusable `ci.yml` must be present on `main`; the new workflow intentionally rejects any other ref and any actor other than the repository owner.
2. Apply content migrations `0007` through `0010` to the isolated preview content database and deploy the reviewed admin Worker while preserving its Access application, owner policy and existing bindings. The production and original spike databases are not targets.
3. Set the non-secret admin preview variable `PUBLISH_BUILDS_ENABLED` to the string `true` in the ignored remote Wrangler configuration before that deployment. Keep `APP_ENV=preview`. Leaving the variable absent disables dispatch. Production is rejected by the current dispatch configuration.
4. From an owner-authenticated, recently authenticated browser session, capture a current preview revision. Request `POST /api/publishing/captures/<id>/build` with JSON `{}` and the normal same-origin request. The route does not accept a replacement branch, workflow, snapshot or hash.
5. Poll `GET /api/publishing/captures/<id>/build`. A queued/completed run is a build result only. Verify actual R2 retrieval and all three compiler/site stages before recording this live connection as proven. No publication is possible through this workflow.

The console controls will expose these operations when the complete preview/publish behavior is connected; this handoff does not ask the owner to extract an Access cookie or JWT for a script.

## Recovery semantics

- Repeat the same capture ID after a timeout. The service reserves one attempt and will reconcile its run rather than automatically POST again.
- `uncertain` means GitHub may have accepted the request. A lookup checks up to 100 recent runs; no match is not proof of rejection. Inspect Actions if uncertainty persists. Duplicate matching runs remain uncertain.
- `rejected` means the HTTP response definitively rejected the attempt. Fix configuration first, then create a new capture for a new attempt.
- A capture older than 24 hours, missing original or integrity mismatch fails before building usable output. A long queue can require a new capture.
- Actual private logs are not public artifacts. The current workflow reports a fixed failure message and cleans its runner workspace. Private diagnostic delivery is a remaining connection, not an available download yet.
