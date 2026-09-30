# Private maintenance diagnostics

WH-006, September 30, 2026. The platform records bounded per-job scheduler telemetry and provides `node tools/report-maintenance.mjs` for an authenticated operator. The CLI uses the existing Cloudflare/D1 operator credentials. There is no customer HTTP endpoint, model tool or public dashboard for this report.

## Scheduled inventory

| Job | Schedule (UTC) | Existing operation |
| --- | --- | --- |
| imports | Hourly at :47 and daily 03:17 | Triage up to ten quarantined source imports; never approve execution |
| hosting | Hourly at :47 | Refresh bounded custom-hostname provider records when configured |
| health | Hourly at :47 | Check due published sites and expire old health evidence |
| fair_use | Daily 03:17 | Remove expired observations of removed projects |
| traffic | Daily 03:17 | Expire old aggregate traffic counters |
| applications | Daily 03:17 | Remove stale migration documents, deletion receipts and daily counters |
| contacts | Daily 03:17 | Expire submissions and delivery receipts |
| photos | Daily 03:17 | Process private object cleanup and bounded orphan detection |
| github | Daily 03:17, when configured | Expire OAuth state/tokens and retry pending revocations |
| cloudflare | Daily 03:17, when configured | Retire abandoned staged authorization and retry pending revocations |

This wraps the existing [scheduled handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/); it does not introduce more frequent jobs, new provider calls or new services. Migration 0106 adds at most ten rows, one per allowlisted job. Each invocation writes a start record and a terminal record, plus the last-success timestamp for completed passes: at most about 240 extra D1 write statements per day at the current schedule. Account allowance/actual row charges still require observation; no new recurring minimum is enabled.

## Meaning and failure behavior

Records contain a random run ID, job name, numeric start/finish/duration/last-success times, status and a fixed failure category. Exceptions, tokens, source, object keys, customer identities and conversation text are never stored. A completed pass means its function returned; it does **not** prove every item succeeded. Revocation routines deliberately retain failed items for later attempts. Missing provider configuration is `skipped`, not success. Telemetry starts empty; no historical success is invented.

Jobs settle independently before the scheduler reports a sanitized aggregate failure. A telemetry database error does not stop the associated cleanup from running; it does cause the overall invocation to fail visibly. Overlapping older completions cannot overwrite the latest run's status, while the latest observed successful completion is retained independently. These records never grant authority, settle usage or redispatch a customer request.

The operator report labels an observed run `stalled` after 15 minutes and a schedule `overdue` after its interval plus one hour. These are investigation thresholds, not automatic retries. Missing rows are `unobserved`; query failures are `unavailable`. Neither means healthy. A currently running job within its grace period is not itself an alert.

## Backlogs and recovery

The initial backlog coverage is pending import triage, private photo cleanup, GitHub/Cloudflare revocations, historical usage holds and standard-AI requests. It reports counts and oldest age only. Import attention starts after one hour; photo cleanup and Cloudflare revocation attention after 25 hours; unresolved inference attention after ten minutes. These thresholds flag inspection, never waive charges or retry inference.

GitHub vault records have no creation/revocation timestamp: pending rows are immediately flagged with unknown age. Cloudflare age is measured from credential creation, **not** revocation request time; that conservative proxy can overstate delay. Photo age covers the cleanup queue only, not unlisted R2 orphans. Imports requiring human/scanner review are not part of the pending-triage count. This is not comprehensive safety backlog coverage.

The report lists up to 100 oldest unresolved IDs per AI receipt family, with state and last-update time but no owner ID or message. Total backlog counts expose truncation. Use the existing [usage recovery contract](usage-recovery.md) or [standard-AI accounting](standard-ai-accounting.md) to inspect the exact receipt. An unresolved operation does not authorize another provider call; waivers retain their separate reviewed decision. Receipt reconciliation is currently request/operator driven, not a new cron job.

Exit codes: `0` means the covered observations do not currently require attention; `2` means unobserved, overdue, failed, stalled or unavailable work/backlogs; `1` means invalid invocation or report setup failure. The tool performs SELECTs only. It does not repair anything or install alerts.

## Acceptance and remaining WH-006 work

`node tests/maintenance.mjs` uses all migrations in disposable in-memory SQLite and checks independent success/failure/skips, overlapping runs, last-success preservation, telemetry failure, missing evidence, overdue queues and read-only receipt IDs. Synthetic private error/object/email markers are absent from the output. `pnpm check` verifies Worker types. These tests do not prove live cron execution.

WH-006 remains open until natural hourly/daily execution is observed and the remaining per-item coverage is addressed: accurate revocation-request ages, contact/application/traffic/fair-use expiry backlog ages, hosting/health pending work, and additional provider-operation recovery pointers. No CMS functional testing or new activation is authorized by this inventory. Monitoring/alert delivery is not installed.

## Private-test deployment evidence

Migration 0106 was applied September 30 at 18:34:52 UTC; all 106 migrations were confirmed applied with none pending. Platform `53df6f0f-d048-404b-9bb1-bd049215d4ef` was independently verified at 18:36:17 UTC with all 16 frontend asset hashes matching, health 200 and anonymous onboarding/Chat 401. The release passed backend TypeScript, a fresh build/snapshot and frontend loading checks. No other Worker, provider activation, customer publication or schedule changed.

The private read-only report at 18:36:15 UTC correctly showed all ten jobs unobserved before their first natural run. Five covered queues were empty; historical AI accounting retained one unresolved operation. The operator report provides its exact receipt ID in private evidence without changing the hold. This agrees with the previously recorded [legacy usage finding](usage-recovery.md). Evidence is ignored locally in `.secrets/maintenance-migration.json`, `.secrets/maintenance-release-verification.json` and `.secrets/maintenance-report.json`. Natural hourly/daily execution remains to be verified; no live cleanup was manually triggered for acceptance.
