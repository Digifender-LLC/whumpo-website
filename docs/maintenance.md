# Private maintenance diagnostics

WH-006, September 30, 2026. The platform records bounded per-job scheduler telemetry and provides `node tools/report-maintenance.mjs` for an authenticated operator. The CLI uses the existing Cloudflare/D1 operator credentials. There is no customer HTTP endpoint, model tool or public dashboard for this report. Since the WH-050 F8 slice (October 4, 2026, implemented locally only) the report also lists each shared platform counter against its schema ceiling, flagged `warn` at 50% and `act` at 80% (attention, exit 2); `--counters` prints only that section. It is pull-based: no alert is delivered and delivery stays owner-gated ([capacity and fairness](capacity-and-fairness.md#f8-shared-counter-thresholds-implemented-locally-pull-based)).

The [WH-052 background-job decision](background-jobs.md) retains this scheduler for current maintenance and specifies D1-owned receipts for future scan/closure work. Pass telemetry is not an item lease or resumable job journal. The new SQLite prototype is local only; no schedule or runtime behavior changes.

## Scheduled inventory

| Job | Schedule (UTC) | Existing operation |
| --- | --- | --- |
| identity | Hourly at :47 and daily 03:17 | Expire bounded session/grant/challenge/receipt/kit-offer records; preserve verified unfinished enrollment/recovery |
| imports | Hourly at :47 and daily 03:17 | Triage up to ten quarantined source imports; never approve execution |
| hosting | Hourly at :47 | Refresh bounded custom-hostname provider records when configured |
| health | Hourly at :47 | Check due published sites and expire old health evidence |
| fair_use | Daily 03:17 | Remove expired observations of removed projects |
| traffic | Daily 03:17 | Expire old aggregate traffic counters and measurement-quality counters (WH-037), hashed per-connection admission keys older than the previous UTC day and per-project photo read counters before last month (WH-075) |
| funnel | Hourly at :47 and daily 03:17 | Prune [funnel measurements](funnel-metrics.md) older than 180 days, then derive consent-gated, content-free events from existing receipts (bounded, idempotent) |
| email_changes | Daily 03:17 | WH-201: expire pending [address changes](email-change-and-compromise.md) past one hour; replace the plaintext addresses of closed changes (a confirmed one when its seven-day undo window ends) with their hash; delete closed changes 30 days after the later of expiry and undo deadline, rate-limit evidence after 48 hours, committed compromise reviews 90 days after commit and expired never-committed reviews at once (WH-203 cap fix), and (WH-143) lookup consents seven days after use, voiding or expiry and connector receipts 400 days after their last change, never while dispatching or uncertain, and (B11) workspace layout receipts beyond an owner's latest 50 (the schema trigger already enforces the cap; this removes any older surplus, at most 200 rows per statement and run, on the database clock) |
| guest_previews | Daily 03:17 | Remove [guest preview link](guest-previews.md) metadata that ended over 30 days ago and never received comments (at most 500 per run); comments and their links stay |
| applications | Daily 03:17 | Remove stale migration documents, deletion receipts and daily counters |
| reviews | Daily 03:17 | The [WH-182 review turnover pass](review-retention.md#review-turnover-wh-182-implemented-in-source-nothing-deployed): seal and remove eligible review rows of projects with no recent admission and age sealed receipts out after 30 days (bounded, see below) |
| contacts | Daily 03:17 | Expire submissions and delivery receipts |
| photos | Daily 03:17 | Process private object cleanup and bounded orphan detection |
| github | Daily 03:17, when configured | Expire OAuth state/tokens and retry pending revocations |
| cloudflare | Daily 03:17, when configured | Retire abandoned staged authorization and retry pending revocations |
| jobs | Daily 03:17 | WH-052 P-2: delete finished [journal jobs](job-orchestration.md#p-2-as-built-october-29-2026-schema-batch-3a) (complete, cancelled, expired) with their events and outbox entry 30 days after their last transition (`jobJournalRetentionMs`, interim default; at most 200 per run; unfinished jobs are never pruned) |

This wraps the existing [scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/); it does not introduce more frequent jobs, new provider calls or new services. The complete current schema stores at most fourteen telemetry rows, one per allowlisted job. Each invocation writes a start record and a terminal record, plus the last-success timestamp for completed passes. The original estimate of at most 315 D1 write statements per day predates the hourly `chat_drafts` and `funnel` jobs; each adds at most three telemetry writes per invocation (about 75 per day). The WH-025 `funnel` job also runs one bounded delete and one derivation batch per invocation and writes rows only for consenting accounts. The WH-092 `guest_previews` job adds one bounded delete and three telemetry writes per daily run. Account allowance/actual row charges still require observation; no new recurring minimum is enabled.

## Review turnover (WH-182, October 28, 2026; source only, not deployed)

Terminal, superseded and expired review rows now leave in two places: the admitting batch of each review prepare (the caller's rows, at most 200 per call), and a bounded pass in the daily `reviews` job (up to 25 projects or owners per family and 1,000 rows per run, then sealed receipts older than 30 days, up to 1,000 per run). Rows that are held, referenced, pending or in flight are re-checked by the deleting statement and survive. The pass reports under `applications` because `maintenance_health` has no `reviews` job name; the failure rule is unchanged (a failing pass fails the job visibly, and a failing earlier step does not skip it).

The operator report gains a `reviews` section (per family: rows waiting, oldest waiting age, sealed receipts), the `review_turnover` and `review_receipts` backlogs (43 queues in all, attention at 25 hours) and eighteen `<table>_active` counters against the 5,000-row platform ceilings (32 counters in all, flagged at 50% and 80%). They hold counts only. `node tests/maintenance-inventory.mjs` checks them against the schema; `node tests/review-turnover.mjs` (and `--d1`) checks the turnover itself.

## Meaning and failure behavior

Records contain a random run ID, job name, numeric start/finish/duration/last-success times, status and a fixed failure category. Exceptions, tokens, source, object keys, customer identities and conversation text are never stored. A completed pass means its function returned; it does **not** prove every item succeeded. Revocation routines deliberately retain failed items for later attempts. Missing provider configuration is `skipped`, not success. Telemetry starts empty; no historical success is invented.

Jobs settle independently before the scheduler reports a sanitized aggregate failure. A telemetry database error does not stop the associated cleanup from running; it does cause the overall invocation to fail visibly. Overlapping older completions cannot overwrite the latest run's status, while the latest observed successful completion is retained independently. These records never grant authority, settle usage or redispatch a customer request.

The operator report labels an observed run `stalled` after 15 minutes and a schedule `overdue` after its interval plus one hour. These are investigation thresholds, not automatic retries. Missing rows are `unobserved`; query failures are `unavailable`. Neither means healthy. A currently running job within its grace period is not itself an alert.

## Backlogs and recovery

WH-035 adds two read-only queues, `support_open` (open support/usage-review requests, 72-hour internal attention threshold) and `support_delivery` (queued external notifications, empty unless a provider is enabled); the inventory test now checks 36 queries. The report covers **32 queues**, including expired GitHub staging leases, visitor deletion reviews and unresolved OAuth exchanges. Exchanges older than ten minutes require attention; the age threshold never expires an uncertain provider outcome or authorizes key activation. This new queue is current-source only until the WH-117 coordinated test cutover. Retention ages begin at deletion eligibility, rather than the original write time; counts include only eligible records. Each query uses one explicit observation timestamp. Empty queues, unknown ages and query failures remain distinct.

| Group | Covered work | Attention rule |
| --- | --- | --- |
| Imports and photos | Pending source triage; queued object cleanup | One hour / 25 hours from queue creation |
| Connection cleanup | Revocations, expired OAuth attempts/tokens, abandoned staged Cloudflare/GitHub credentials | 25 hours since revocation request, expiration or staged-retirement eligibility; unknown age flags immediately |
| Retention | Removed-project fair-use records, traffic, obsolete application migration documents, owner erasure/deletion receipts, app usage, contact submissions/receipts, health evidence/budgets | 25 hours past eligibility; obsolete migration documents lack an age and flag immediately |
| Hosting/health | Active/provisioning/disconnecting host refresh, unknown creation, due current-publication health checks, checks stuck in progress | Two hours since last hosting check or health-check eligibility; 10 minutes for unknown creation; 15 minutes for in-progress checks |
| Provider operations | Historical/standard AI receipts, dispatched/uncertain GitHub backups and DNS actions | Ten minutes from available receipt timestamp |

The current schema records the first revocation transition in a separate metadata row linked to each credential. New rows use the database timestamp; retry/lease changes preserve it, and credential deletion cascades to its telemetry. Missing or null telemetry timestamps remain explicitly unknown and require investigation. This adds one small metadata write per new revocation, no extra provider calls and no new minimum service charge. The report never selects credential IDs or ciphertext. The earlier Cloudflare credential-creation proxy is no longer used.

Hosting records without a previous check, and a current publication without a matching health-check history, report unknown age and require inspection. Hostname creation and DNS receipts have only review-creation times, which can conservatively overstate their operation age; backups use `dispatched_at`. Photo age covers the cleanup queue only, not unlisted R2 orphans. Imports requiring human/scanner review are not part of the pending-triage count. This is operational maintenance coverage, not comprehensive safety backlog or provider billing reconciliation.

The report lists up to 100 oldest unresolved IDs in each of four families: standard AI, hosting, GitHub backups and DNS. It includes only the exact operation ID, allowlisted state, available timestamp and a link to the existing recovery contract. Matching backlog counts expose truncation (hosting refresh and unknown-creation counts are separate). Owner IDs, domains, repository names, provider IDs, evidence strings, credentials and conversation/source data remain excluded. Missing timestamps remain null. Follow the linked feature contract; an unresolved operation does not authorize another provider call or a waiver. Receipt reconciliation is currently request/operator driven, not a new cron job.

Exit codes: `0` means the covered observations do not currently require attention; `2` means unobserved, overdue, failed, stalled or unavailable work/backlogs; `1` means invalid invocation or report setup failure. The tool performs SELECTs only. It does not repair anything or install alerts.

## Acceptance and WH-006 completion

`node tests/maintenance.mjs` initializes the complete current schema in disposable in-memory SQLite and checks independent success/failure/skips, overlapping runs, last-success preservation, telemetry failure, missing evidence, overdue queues and read-only receipt IDs. Synthetic private error/object/email markers are absent from the output. `pnpm check` verifies Worker types. `node tests/maintenance-inventory.mjs` additionally checks all 34 queries (including WH-075 `public_clients`) against the current schema, four receipt families, exact new revocation clocks, missing/unknown telemetry, retry stability, credential-delete cascades, retention eligibility/age, and read-only/private-data boundaries. Positive retention fixtures cover contacts, traffic, fair-use, health budgets and expired GitHub staging; provider-state queries are schema-checked without live provider actions. These tests do not prove live cron execution.

The previously outstanding natural daily execution evidence is now recorded below alongside the first hourly run. WH-006 acceptance is complete; wider incident alerting and unresolved-operation remediation remain separate work. The backlog and recovery-pointer coverage listed above is implemented; historical timestamps absent from source records remain explicitly unknown. No CMS functional testing or new activation is authorized by this inventory. Monitoring/alert delivery is not installed. The [incident runbooks](incident-runbooks.md) define how an operator uses these reports during an incident and list the missing alerting as a gap.

## Current identity verification — October 2, 2026 UTC

All three local maintenance suites pass with the complete current schema and no numbered migration replay. The scheduled-handler suite uses transactional SQLite batches, expires an old session and enrollment grant, retains a current session and verified unfinished enrollment, and verifies independent traffic-failure/recovery and hourly dispatch. Identity cleanup now uses its actual hourly interval for overdue reporting; daily jobs keep their separate deadlines. The read-only inventory still excludes private content and credentials. No provider fetch or live scheduled invocation is performed by these tests.

This source checkpoint is part of the pending coordinated identity/schema cutover (#72). The dated remote records below prove the earlier schedule only; they do not prove the new identity job has run remotely.

## Chat draft retention source checkpoint — October 2, 2026 UTC

Owner-approved LC-10 adds `chat_drafts` to both scheduled passes, with an hourly health interval. Each pass removes at most 100 eligible unsubmitted form payloads after seven days of inactivity; accepted submissions and unresolved continuation receipts are excluded. Read/export filtering applies at the cutoff even before cleanup. The new `chat_drafts` backlog measures age from eligibility, with a two-hour attention threshold. Counts/timestamps contain no form text or defaults. This source uses the complete current schema; none of the historical remote schedule evidence below proves execution of this new job.

## Private-test deployment evidence

Migration 0106 was applied September 30 at 18:34:52 UTC; all 106 migrations were confirmed applied with none pending. Platform `53df6f0f-d048-404b-9bb1-bd049215d4ef` was independently verified at 18:36:17 UTC with all 16 frontend asset hashes matching, health 200 and anonymous onboarding/Chat 401. The release passed backend TypeScript, a fresh build/snapshot and frontend loading checks. No other Worker, provider activation, customer publication or schedule changed.

The private read-only report at 18:36:15 UTC correctly showed all ten jobs unobserved before their first natural run. Five covered queues were empty; historical AI accounting retained one unresolved operation. The operator report provides its exact receipt ID in private evidence without changing the hold. That historical test-unit path was retired on October 1; current reports inspect only [standard AI receipts](standard-ai-accounting.md). Evidence is ignored locally in `.secrets/maintenance-migration.json`, `.secrets/maintenance-release-verification.json` and `.secrets/maintenance-report.json`. Natural hourly/daily execution remains to be verified; no live cleanup was manually triggered for acceptance.

### Expanded inventory and revocation timing

Migration 0107 was applied at **18:42:44 UTC** on September 30; independent readback confirmed all **107 migrations**, none pending, with the same platform version `53df6f0f-d048-404b-9bb1-bd049215d4ef`. No Worker redeployment is required for the CLI expansion/database triggers. At **18:44:31 UTC**, the live read-only report returned all 27 queues and five receipt families successfully: 26 queues empty and one previously known historical-AI hold requiring review. No provider operations were retried or customer records changed by the report. Natural hourly/daily job records were still unobserved before the next schedule. Private evidence: `.secrets/revocation-health-migration.json` and `.secrets/maintenance-expanded-report.json`.

`node tests/maintenance-inventory.mjs`, `node tests/maintenance.mjs` and `node tests/maintenance-scheduled.mjs` passed. The last test invokes the actual bundled Worker scheduler with disposable SQLite/R2 fixtures, verifies a failed traffic cleanup alongside successful sibling jobs, then successful retry/hourly dispatch and an empty healthy report. External fetches are forbidden in that fixture; it is not live cron or provider acceptance.

### First natural hourly execution

Read-only observation at **18:52:26 UTC** on September 30 found the first natural hourly run, started at **2026-09-30T18:47:47.004000+00:00**. Import triage completed in 596 ms and website health in 718 ms. Hosting was skipped because activation is absent; it did not claim success or call the provider. The inventories were empty, so this proves scheduling/telemetry and empty-pass execution, not processing customer artifacts. Daily jobs remain unobserved; their next configured run is October 1 at 03:17 UTC. No manual scheduler invocation or new automation was used. Private evidence: `.secrets/maintenance-first-hourly.json`. WH-006 remains open for the daily-run evidence.


### First verified natural daily execution — October 1, 2026 UTC

The read-only report at **2026-10-01T03:21:25.142Z** observed the daily run beginning **03:17:59.757 UTC**. Imports and fair-use cleanup completed in 412 ms each, traffic 619 ms, applications 409 ms, contacts 736 ms, photo cleanup 1,253 ms, and Cloudflare connection maintenance 770 ms. GitHub cleanup was skipped (407 ms) because it is not configured. The latest hourly website-health pass completed; unconfigured hosting remained skipped. This establishes natural scheduled execution and telemetry, not evidence that every possible customer artifact/provider mutation was exercised. Existing photo cleanup is not CSAM detection or scanner implementation.

All 27 backlog reads and all five operation-family reads were available. Twenty-six queues were empty; the one known historical AI hold remained actionable with its private recovery pointer. Exit code 2 is therefore expected and does not mean the daily pass failed. No operator-triggered cleanup, provider retry, receipt settlement or new alert/automation was performed. Private evidence: `.secrets/maintenance-daily-2026-10-01.json`.

The three offline maintenance suites above passed again against the current 113-migration schema. They cover independent job failures, unknown/overdue work, synthetic redaction and telemetry failures without action authority or external dispatch. Together with natural hourly/daily evidence, this completes WH-006’s acceptance criteria. The existing historical AI hold still requires its separate reconciliation process; completion does not waive it or claim every operation is resolved.

GitHub refresh-grant custody is counted separately from access-token revocation. Its age uses an observed access revocation or the existing revocation-admission clock; absent timing remains unknown. Expired access credentials with retained refresh custody are excluded from ordinary expiry-deletion counts. Scheduled cleanup cannot settle or purge a refresh grant. The separately reviewed app-grant operation can settle only its exact scope with a saved direct provider result; unknown outcomes still require recovery. This is current-source/local verification, not deployed grant-recovery acceptance.

The `github_grant_unknown` queue counts claimed or uncertain broader GitHub app-grant removals from their dispatch time, with a ten-minute attention threshold. That threshold does not expire the operation or release its authorization-exchange fence.

October 28, 2026 (WH-201): the `email_changes` job is allowlisted (the complete current schema now stores at most sixteen telemetry rows (WH-182's review turnover reports as its own `reviews` job, allowlisted by the same change)) and the report adds five read-only queues, `email_change_expiry`, `email_change_redaction`, `email_change_retention`, `email_change_limits` and `security_reviews`, so the report now covers 48 backlog queues (with WH-182's two). WH-170 adds a fifteenth shared platform counter, `cost_events` (ceiling 9,000 rows, enforced by the `cost_events_capacity` trigger; restore admission reads at most 10,000 rows of a table), flagged at 50% and 80% like the others. `tests/maintenance-inventory.mjs` and `tests/maintenance-scheduled.mjs` exercise them.

October 29, 2026 (schema batch 3a, WH-052 P-2): the `jobs` job is allowlisted (the complete current schema now stores at most seventeen telemetry rows) and the report adds one read-only queue, `job_journal` (finished jobs past 30 days), so it covers 52 backlog queues. `tests/maintenance-inventory.mjs` and `tests/maintenance-scheduled.mjs` exercise them.

October 30, 2026 (schema batch 3e, WH-156): the hourly `health` job also runs `maintainNotices` (unsent notices past 24 hours are cancelled with their envelopes; `unknown-outcome` notices at three lookups or past 72 hours become `unresolved`), and the daily `contacts` job prunes finished notices 30 days after their outcome and `unresolved` ones after 90 days, skipping held projects. No new job name. The backlog report replaces `contact_notification_outbox`, `contact_notification_queue` and `support_delivery` with `notification_notices`, `notification_queue` and `notification_unknown` (still 52 queues).
