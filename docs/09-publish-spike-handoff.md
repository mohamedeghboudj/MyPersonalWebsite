# Measured publish spike: owner setup

PR #1 is merged, the owner configured the GitHub Actions secrets, and the first measured publish succeeded. See [the result](10-live-publish-evidence.md). Do not repeat account setup that is already complete.

The implementation is on `main` in `.github/workflows/publish-spike.yml`. It receives a public snapshot captured by the authenticated admin, validates its hash, runs checks, compiles EN/FR/AR PDFs, builds the static site from the same snapshot, deploys, and measures when each route exposes that revision. No snapshot is committed as the primary datastore, and no inbox binding or database token enters this workflow.

The capture/dispatch handoff is manual for the risk spike. Measured time includes it; it must not be presented as the future console's automatic click-to-live latency. Save-to-live starts at the save transaction's audit timestamp, read atomically with the snapshot; capture-to-live starts at the capture response timestamp. Both are observed upper bounds. Failed checks/compilation stop before deployment. Deployment is serialized; an equal or newer live revision prevents an older queued capture from replacing it. Live overlap/failure exercises remain to be performed.

## Account setup reserved for the owner

The original project instruction reserves account changes and interactive login to the owner. Do not share any token in chat.

1. Create a Cloudflare API token scoped to this account with **Workers Scripts: Edit** and **Account Settings: Read** for the Workers deployment. No D1, R2, DNS, Email, Access or billing permission is required for this workflow. Use an expiry. Do not use the Global API Key or copy Wrangler's interactive OAuth credential into CI. See Cloudflare's [deployment API permissions](https://developers.cloudflare.com/api/resources/workers/subresources/scripts/subresources/deployments/methods/create/) and [Workers authorization](https://developers.cloudflare.com/workers/authorization/workers/).
2. In the GitHub repository, open **Settings → Secrets and variables → Actions** and add repository secrets:
   - `CLOUDFLARE_SPIKE_DEPLOY_TOKEN`: the scoped token.
   - `CLOUDFLARE_ACCOUNT_ID`: the `account_id` already recorded in the ignored local Worker configuration.
   - `SPIKE_PUBLIC_URL`: use the `PUBLIC_ORIGIN` from ignored `worker/contact/wrangler.spike.json`. It names the dedicated static site spike.
3. Review the draft PR. The new dispatch workflow must be present on the default branch to appear in GitHub's Run workflow UI. Merging is a separate review decision; it does not mark Sprint 0 complete or authorize later build phases. The workflow itself permits only the repository owner on `main` and does not deploy merely because a PR is merged.

The deployment token is injected only into the deployment step. TeX receives only its local inputs, bundled fonts and output folder inside its network-disabled container; it never receives deployment credentials. Runtime/SQL secrets are absent from the public repository.

## Actual measurement

The owner chose to repeat after GitHub recovers from its runner incident. Confirm recovery before taking a new capture: the old revision-1 download is expired and must not be edited or replayed. A fresh save increments the revision so the deployment guard can distinguish the repeat from the existing live site.

After recovery:

1. Open `/spike` on the existing admin spike hostname. Access and the Worker's JWT validation protect the diagnostic page and its API.
2. Add a harmless repeat marker to the synthetic descriptions, then click **Save test item**. This writes the real remote content D1, its translations/selection, revision and audit in a transaction. Save a new revision even if the substantive test data is unchanged.
3. Click **Capture publish request**. It downloads `publish-request.json` containing the allowlisted snapshot, hash, save-audit timestamp and capture timestamp. Avoid any factual/private content during this public spike.
4. Open **Actions → Sprint 0 measured publish → Run workflow**, choose `main`, and paste the downloaded JSON unchanged into `capture`. Dispatch within 30 minutes.
5. Inspect the workflow result and live static routes. The last step prints EN/FR/AR save-to-live and capture-to-live durations without exposing the snapshot or account metadata. Verify all three CV URLs under `/cv/`, then run a newer and an older capture to exercise ordering and a deliberate failed build to verify preservation of the last good deployment.

The owner must accept the observed latency before later build phases. The remaining manual handoff and the full console's automatic dispatch/status UX are explicit follow-up work, not hidden timing assumptions.

The connected GitHub tools can inspect and retry runs but currently expose no new-workflow dispatch operation, and no authenticated `gh` CLI is installed here. The owner performs the existing Run workflow step; do not extract local OAuth credentials, invent a login bypass, or ask for a token in chat to automate this handoff.
