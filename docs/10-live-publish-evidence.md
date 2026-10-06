# Measured live publishes

On 2026-10-05, [publish run 37372533029](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/37372533029) successfully built and deployed remote content revision 1 from commit `ed8c422b566790a95fe91ed6d46f1cd43ce55fce`. The owner had merged PR #1, configured the scoped CI secrets, saved through the protected diagnostic and dispatched its downloaded capture.

The entire save → snapshot → checks → trilingual TeX Live → static build → deployment → live observation path succeeded. This proves the path works; it does not establish normal publishing latency from a single outage-affected run.

## Timing evidence

All timestamps are UTC. Save time comes from the audit record written in the same D1 transaction as the content; capture time comes from the authenticated capture response. GitHub API step timestamps have second precision. Live route observations are sequential upper bounds.

| Event                          | Timestamp              |
| ------------------------------ | ---------------------- |
| Save transaction audit         | 20:48:51.152           |
| Snapshot capture               | 20:51:23.375           |
| Workflow created               | 20:53:38               |
| Hosted runner job started      | 21:14:55               |
| CV stage started / finished    | 21:15:19 / 21:18:32    |
| Cloudflare deployment created  | 21:18:41.629           |
| All three routes observed live | approximately 21:18:49 |

| Interval                                                 | Observed duration                 |
| -------------------------------------------------------- | --------------------------------- |
| Capture → manual workflow dispatch                       | 134.625 seconds                   |
| Workflow creation → runner start                         | 1277 seconds (21m17s)             |
| Job start → live observation                             | approximately 234 seconds (3m54s) |
| CV stage, including image pull and two passes per locale | 193 seconds                       |
| Static build                                             | 2 seconds                         |
| Deploy step                                              | 6 seconds                         |
| Capture → live, EN / FR / AR                             | 1645.8 / 1645.9 / 1646.0 seconds  |
| Save → live, EN / FR / AR                                | 1798.0 / 1798.1 / 1798.2 seconds  |

GitHub reported an [Actions hosted-runner incident](https://www.githubstatus.com/incidents/3q1yb5m7ltvb) beginning at 19:11 UTC, including delayed runner assignment and failed jobs during this run. The timing and the empty runner assignment on the earlier CI attempt are consistent with that incident; the incident report does not identify this particular repository. The post-merge checks initially ended without a runner and passed on retry. All 40 tests and the dependency audit also passed inside the successful publish itself.

The approximately 234 seconds after runner start must not be presented as click-to-live latency. The queue and manual handoff are part of the observed 27m26s capture-to-live result. No SSR fallback, paid runner, compiler change or relaxed security check was introduced.

## Independent live verification

- A read-only remote D1 query confirmed revision 1 and the original save/capture audit timestamps.
- Each public locale route returned 200 with the expected revision and translated content in its first HTML response. No client script or session cookie was present; Arabic had `dir="rtl"`.
- Each `/cv/{locale}.pdf` returned 200 with valid PDF bytes. All three deployed PDFs were rendered and inspected, including joined Arabic glyphs, mixed Latin runs, French accents, mirrored entry/date columns and unclipped content. Poppins and Amiri fonts were embedded with Unicode mappings.
- Wrangler confirmed one successful public deployment at the timestamp above. Exact deployment configuration, version ID, snapshot hash, downloaded capture, per-file hashes and rendered pages are retained in ignored `artifacts/live-publish/` and local configuration, outside the public repository.

## Owner decision and next measurement

After reviewing the first run, the owner selected **keep static; repeat after GitHub recovers**. The latency gate stayed open until the repeat below was measured and accepted.

After recovery, use [the repeat procedure](09-publish-spike-handoff.md) to save a new harmless marker, capture a fresh snapshot and dispatch promptly. Report manual handoff, queue and execution separately again. A new GitHub-hosted VM may still require a cold image download; do not label the repeat warm without evidence.

Live overlapping-publication and deliberate-failure exercises remain outstanding. Local revision-order tests and code inspection are supporting evidence, not a claim that those live exercises have happened.

## Requested repeat: revision 2

[Run 37378816160](https://github.com/mohamedeghboudj/MyPersonalWebsite/actions/runs/37378816160) succeeded on the same runtime commit. Its fresh capture contains revision 2. The runner started four seconds after workflow creation, following GitHub's mitigation update; the available incident report still marked Actions degraded, so this is a successful short-queue sample, not proof of complete service recovery.

| Event                                | Timestamp (UTC, 2026-10-05) |
| ------------------------------------ | --------------------------- |
| Save transaction audit, from capture | 21:52:35.383                |
| Snapshot capture                     | 21:52:37.617                |
| Workflow created                     | 21:52:59                    |
| Hosted runner job started            | 21:53:03                    |
| CV stage started / finished          | 21:53:27 / 21:56:36         |
| Cloudflare deployment created        | 21:56:45.732                |
| All three routes observed live       | approximately 21:56:49      |

| Interval                           | First run                        | Repeat                        |
| ---------------------------------- | -------------------------------- | ----------------------------- |
| Manual capture/dispatch handoff    | 134.625 seconds                  | 21.383 seconds                |
| Runner queue                       | 1277 seconds                     | 4 seconds                     |
| Job start → live observation       | approximately 234 seconds        | approximately 226 seconds     |
| CV stage, including image download | 193 seconds                      | 189 seconds                   |
| Capture → live, EN / FR / AR       | 1645.8 / 1645.9 / 1646.0 seconds | 251.5 / 251.6 / 251.7 seconds |
| Save → live, EN / FR / AR          | 1798.0 / 1798.1 / 1798.2 seconds | 253.7 / 253.8 / 253.9 seconds |

All 40 tests and the dependency audit passed again. Independent downloads verified revision 2 and captured content on each static HTML route, with no client scripts or session cookies. All three public PDFs returned 200 and were rendered and visually checked. Wrangler's deployment history confirms that the second version replaced the first. Exact version IDs, capture hashes, downloaded pages/PDFs and job timestamps stay in ignored `artifacts/live-publish-repeat/`.

The repeat still downloaded the full TeX Live image; do not call it warm-cache performance. Two runs are insufficient for a latency percentile. The owner explicitly accepted the approximately **4m12s capture-to-live** result and authorized foundation on 2026-10-05. Sprint 0's four core gates are closed, with the static architecture retained. Live overlapping-publication and deliberate-failure exercises remain publish-phase follow-ups.
