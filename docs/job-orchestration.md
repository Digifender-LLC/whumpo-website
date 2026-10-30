# ADR: durable job orchestration

**WH-052, October 29, 2026 (UTC), against `origin/main` `bf261a2`. Engineering decision, docs only.** No code, schema, binding, schedule, deploy or new service changes with this record.

This ADR re-runs the WH-052 choice against the requirements that its dependents now state. Those dependents are WH-069, WH-145, WH-154/156, WH-036, WH-086, WH-018, WH-074/075 and the batch-builder study. It confirms and sharpens the earlier decision; it does not replace it:

- The [September 30 / October 2 ADR](background-jobs.md) still owns the transition contract and the two traces (uncertain scan, resumable closure).
- The [job/outbox envelope](job-envelope.md) is still contract version 1, unchanged.
- The new material here is:
  - a per-criterion score for each option;
  - the single dispatcher tick;
  - the lane and fairness rules;
  - the WH-156 attempt-bound ruling;
  - the adoption triggers;
  - the follow-up decomposition.

## Context

### What exists now (source, not deployed claims)

- **Bindings.** `wrangler.jsonc` has D1, R2, one service binding, `send_email`, rate limiters and three cron triggers: `17 3 * * *`, `47 * * * *` and `* * * * *`. There are no Queues, Durable Objects or Workflows.
- **Every-minute trigger.** In `src/index.ts`, the `* * * * *` branch runs only the WH-036 contact-notice drain, and only when `contactDelivery(env)` finds the reviewed provider. The comment above it still says the trigger is not configured. The configuration now has it, so that comment is stale.
- **First production-shaped D1 outbox: the contact drain.** `runContactDelivery` in `src/contact-notifications.ts`:
  - claims an attempt and counts it against the spending ceiling in one transaction before the call;
  - treats a timeout or unknown error as `uncertain` and never resends it;
  - retries only definite refusals, with backoff from 5 minutes doubling to 6 hours, at most 6 attempts;
  - caps each destination at 10 an hour and 50 a day, with a trigger as the backstop.

  The owner chose this runner on issue #146 (October 4, 2026): "an every-minute cron draining the D1 outbox. Cloudflare Queues was considered and not chosen" ([contact forms](contact-forms.md#owner-decisions-issue-146-recorded-october-4-2026)).
- **Build jobs.** WH-074 build jobs (`src/build-jobs.ts`) use D1 lease digests, a 60 s expiry, and admission caps enforced in a trigger: 1 per project, 3 per account, 16 for the platform. The owner request path and the daily pass both run `reconcileBuildJobs`, so a crashed job does not hold capacity until the daily pass. Cron cannot create or resume a build ([build jobs](build-jobs.md)).
- **Job journal prototype.** `tools/prototypes/job-journal.mjs` with `tests/job-journal-prototype.mjs` already exercises, on SQLite:
  - fencing;
  - expired pre-dispatch leases;
  - the uncertain-after-intent rule;
  - the atomic outbox;
  - duplicate wakes;
  - cancellation and expiry.
- **Plan.** The account is on Workers Paid ($5/month), which the owner authorized ([deployment](deployment.md); confirmed again on October 4 in [contact forms](contact-forms.md#owner-notification-delivery-wh-036)). Included usage is shared with the account's other apps, so an application quota cannot promise a zero bill ([deployment](deployment.md)).

### Requirements the dependents actually state

| Source | Requirement on the orchestrator |
| --- | --- |
| WH-052 row | At-least-once delivery; idempotency; dead letters; cancellation; unknown external outcomes; never assume exactly-once; preserve immutable receipts; polling cost, latency, throughput, retention and operator recovery explicit; simpler existing machinery if it meets the measured need. |
| WH-069 rules | No always-running per-customer scheduler. Waits persist state, not a live process. Duplicate or out-of-order events and uncertain effects cannot repeat unsafe operations. Revoked permission stops later steps. Fairness under WH-075. |
| WH-145 rule authority | `admitRuleAction` takes the **claim-time use count**. The limit must be enforced at claim, in the same transaction that claims the job, so duplicates and retries cannot exceed it. Rule context never reaches maintainer inference. |
| WH-156 notifications | One outbox. Frozen receipt states. At most one provider call per attempt, counted against the ceiling before the call. Lost response becomes `unknown-outcome` and is never redispatched. Read-only reconciliation is bounded (3 lookups / 72 h). Event intake is authenticated "without activating Queues" (G-N6). Reconcile the envelope `maxAttempts` (1–3) with the 6-attempt notice bound (G-N10). |
| WH-086 push | D1-owned bounded dispatch following WH-052, with fairness, expiry, fencing and uncertain results. No second notification scheduler. |
| WH-018 closure | Resumable bounded chunks. Days of waiting are timestamps. External deletions have intent plus confirmed outcome. No independent scheduler or retry engine. |
| WH-074/075 builds and capacity | Interactive capacity is reserved apart from batch work. Per-project, per-account and platform bounds apply. Visitor, cron and workflow events never wake the maintainer. |
| Batch-builder study (draft) | If a builder lane is ever approved, it polls provider batches from "the existing `* * * * *` cron", with fenced submit intent and a lost submit treated as uncertain. The study recommends not building it now. |
| Initial targets ([background jobs](background-jobs.md#requirements-and-current-evidence)) | Due-to-start p95 ≤ 2 minutes. A pass stops admitting at 20 s. Provider concurrency ≤ 2. Owners are served round-robin. Each class has its own budget. Unknown effects surface to an operator in 30 minutes. |

### Platform facts (official docs, read October 29, 2026 UTC)

| Service | Workers Free | Workers Paid (in use) | Source, page date |
| --- | --- | --- | --- |
| Cron triggers | 5 per account; 10 ms CPU | 250 per account; 30 s CPU for intervals under 1 h, 15 min CPU for intervals of 1 h or more; 15 min wall time | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), Oct 29, 2026 |
| Workers requests/CPU | 100,000 requests/day; 10 ms CPU per invocation | $5/month minimum; 10M requests + 30M CPU ms included; then $0.30/M requests, $0.02/M CPU ms | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), Oct 2, 2026 |
| D1 | 5M rows read/day, 100k rows written/day, 5 GB; queries fail at the limit | 25B rows read, 50M rows written, 5 GB included; then $0.001/M read, $1.00/M written, $0.75/GB-month | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), Apr 21, 2026 |
| Queues | 10,000 operations/day; 24 h retention, not configurable | 1M operations/month; then $0.40/M; 4 days retention by default, up to 14 days. One operation per 64 KB written, read or deleted. Max 100 retries, batch of 100, 24 h delivery delay. | [Queues pricing](https://developers.cloudflare.com/queues/platform/pricing/), [limits](https://developers.cloudflare.com/queues/platform/limits/), Apr 21, 2026 |
| Durable Objects | SQLite backend only; 100k requests/day, 13,000 GB-s/day; SQLite 5M reads/day, 100k writes/day, 5 GB | 1M requests/month, then $0.15/M; 400k GB-s/month, then $12.50/M GB-s; SQLite storage priced like D1 (stored data $0.20/GB-month) | [DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/), Oct 18, 2026 |
| DO alarms | One pending alarm per object | At-least-once; retried automatically on throw, exponential backoff from 2 s, up to 6 retries | [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/), Apr 21, 2026 |
| Workflows | 3,000 steps/day; 1 GB-month storage; 100 concurrent instances; 1,024 steps per instance; 3-day retention for completed instances | 500k steps/month, then $0.80 per 100k; 1 GB-month, then $0.20/GB-month; 50,000 concurrent; 10,000 steps per instance (up to 25,000); 30-day retention | [Workflows pricing](https://developers.cloudflare.com/workflows/reference/pricing/), [limits](https://developers.cloudflare.com/workflows/reference/limits/), Sep 21, 2026 |

The DO pricing page, dated October 2026, still describes SQLite storage billing as starting "January 2026" in the future tense. Treat DO storage as billable. The delivery semantics cited in the [earlier ADR](background-jobs.md#options-and-decision) are unchanged:

- Queues delivers at least once and drops exhausted messages unless a dead-letter queue is set.
- Workflows retries a step 5 times by default.

The account's remaining allowance and the other apps' usage were **not** read.

## Options and scores

Score per criterion: **2** = the property is met by machinery that already exists or is native; **1** = met only with added work or a second store; **0** = works against the requirement. Every option still needs D1 receipts for the business record, because the envelope contract makes D1 authoritative.

| Criterion | A. Existing cron + D1 job tables | B. Queues (D1 receipts) | C. Durable Objects | D. Workflows | E. Hybrid: A, plus Queues only as a wake-up |
| --- | --- | --- | --- | --- | --- |
| Idempotency | 2. Unique operation/idempotency keys and immutable receipts in the same D1 batch; contact outbox and build jobs already do this. | 1. Redelivery is normal; the handler must re-read D1 and no-op. | 1. Single-writer per object, but the object store is a second copy beside D1 receipts. | 1. Step results are cached, but a failed step reruns; remote effects still need D1 intent. | 2. Same as A; the message carries only `{deliveryId, jobId, envelopeDigest}`. |
| Leases and fencing | 2. Conditional update with a monotonic fence, proven in the prototype and the build jobs. | 1. Visibility is not a fence; a D1 claim is still needed. | 1. Strong inside one object; does not fence D1 writes made by request paths. | 1. Instance-level only; D1 still needs its own fence. | 2. Same as A. |
| Retries | 2. `next_due` backoff with a finite attempt bound, only for proven non-sends (contact drain). | 1. Built-in retries are transport retries; they must be kept from becoming business resends. | 0. Alarms auto-retry 6 times on throw, which risks resending. | 1. The default of 5 step retries must be turned off for mutations. | 2. Transport redelivery is a no-op after the D1 claim. |
| Unknown outcomes | 2. `uncertain` / `unknown-outcome` is already implemented and never auto-claimed (contact drain, standard AI, cost events). | 1. The handler must commit `uncertain` before ack, or the DLQ hides it. | 1. Possible, but in a second store. | 1. Possible; automatic retry or compensation cannot infer an effect. | 2. Same as A; the operator lane is D1, not the DLQ. |
| Tenant fairness | 2. The claim query selects per owner round-robin and per-lane budgets, under trigger caps (WH-075 pattern). | 1. One FIFO per queue; a noisy tenant fills the backlog; fairness still lives in D1. | 1. Isolates a tenant, but nothing schedules fairly across tenants. | 0. Per-instance; the account concurrency cap is shared first come, first served (100 on Free). | 2. Fairness is decided at the D1 claim. |
| Cost on the plan in use | 2. A tick per minute is 43,200 invocations/month, about 0.4% of included requests. Idle-tick CPU and indexed reads fall within the included amounts. $0 marginal. | 2. About 3 operations per small message; about 330k messages/month are included. $0 marginal at forecast volume. | 2. Included at forecast volume, but adds GB-s and storage dimensions. | 2. 500k steps/month included; about 60k jobs at 8 steps. $0 marginal at forecast volume. | 2. Same as A until the wake-up is used, then B's operations. |
| Observability | 2. `maintenance_health`, `report-maintenance.mjs` backlogs and the attention rules already exist ([maintenance](maintenance.md)). | 1. Queue metrics have no tenant view; the DLQ needs its own path. | 0. Little built-in; per-object state is hard to aggregate. | 1. Instance dashboard, but a separate copy that expires (3 or 30 days). | 2. Same as A plus queue backlog. |
| Recovery | 2. One store; the envelope restore rules apply ([job envelope](job-envelope.md#delivery-fences-and-honest-recovery)). | 1. Messages expire (24 h on Free); an outbox sweep must re-send. | 0. A second store needing its own export, deletion and restore inventory. | 1. Separate state, outside the lifecycle inventory. | 2. The D1 sweep covers lost messages. |
| Latency (≤ 2 min p95 target) | 1. Up to about 60 s timer delay plus pass time; meets the target, but not sub-second. | 2 | 2 | 2 | 2 |
| New surface and complexity | 2. None. The trigger is already configured. | 1. Queue, consumer, DLQ, budget review. | 0. New class, migrations, storage inventory. | 1. New engine and a second state model. | 1. Adds B's surface only when triggered. |
| **Total (of 20)** | **19** | **12** | **8** | **11** | **19, but only once a trigger fires** |

Durable Objects score lowest. They would add a second authoritative store, with export, deletion and restore duties, and retry behavior that works against unknown-outcome handling. No dependent states a requirement, such as per-key real-time coordination or WebSockets, that only Durable Objects meet.

Workflows' main strength is durable sleeps and multi-step sequences. Every current long wait is already a timestamp:

- closure grace;
- rule `notBefore`;
- notice backoff;
- reconciliation windows.

On top of that, Workflows has the lowest fairness score and keeps its own expiring copy of state.

## Decision

1. **Option A is selected: D1 job tables and domain receipts, advanced by the cron triggers that already exist.** This keeps the October 2 decision. D1 is the only authoritative state for jobs, attempts, uncertain effects and operator backlog.
2. **One dispatcher tick.** The existing `* * * * *` trigger becomes the single dispatcher for every short-latency job lane. Hourly and daily stay maintenance-only.
   - No new cron triggers are added: 3 are used, against limits of 5 (Free) and 250 (Paid).
   - The contact drain becomes the first lane. Planned lanes, each when its feature is approved:
     - `platform-email` (WH-156);
     - `owner-push` (WH-086);
     - `deterministic-rule` (WH-069 via WH-145);
     - `account-cleanup` (WH-018);
     - a future builder-batch poll, only if its gate passes.
3. **Bounds on every tick.**
   - Lanes run in rotating order.
   - Each lane claims at most 10 due jobs per tick, and at most 2 per owner per lane, choosing the oldest-due owner first.
   - Provider concurrency is at most 2.
   - The tick stops admitting new claims after 20 s wall time, well inside the 30 s CPU limit for sub-hourly triggers and the 15 min wall time.
   - Overlapping ticks are safe because claims are fenced. A long tick shortens the next tick; it never doubles a claim.
   - Interactive work (Chat turns, build jobs) never runs in a cron lane, which keeps WH-075's interactive/batch separation.
4. **Claim-time limits run in the claim transaction.** Any per-rule, per-recipient or per-provider limit is counted in the same D1 batch that takes the fence and records dispatch intent. That covers WH-145's use count, the notice caps and the spending ceiling. A duplicate or redelivered wake therefore cannot exceed a limit.
5. **WH-156 attempt bound (G-N10): one envelope per attempt.**
   - Envelope v1 `maxAttempts` (1–3) bounds handler executions of **one** admitted attempt.
   - A definite-refusal retry (`deferred`) admits a **new** envelope and attempt under the same notice idempotency key. Its `notBefore` is the backoff time.
   - The 6-attempt notice bound lives in the notice receipt and is enforced at admission.
   - The envelope contract is not amended. `unknown-outcome` is still never readmitted.
6. **Waits are rows, not processes.** These are `notBefore` / `next_due` timestamps picked up by the tick:
   - WH-069 bounded schedules;
   - closure grace;
   - notice backoff;
   - reconciliation windows.

   No job keeps a request, sleep or instance open.
7. **Not adopted: Durable Objects and Workflows**, for the job classes above. Queues stays a **pre-approved design path (option E)** that is not provisioned. A queue would carry only the 512-byte wake to the same D1 claim, and the D1 outbox sweep would remain.
8. **Provider event intake (WH-156 G-N6) is transport-neutral.** An authenticated adapter writes provider events, idempotent by event ID, into D1. If a selected provider offers events **only** through a Queue, that is a first Queues adoption under the triggers below and needs its own review.

### Adoption triggers (measured, not assumed)

Each trigger is read from the per-lane diagnostics in follow-up P-3 below, over at least 7 days or one load-test run:

| Move to | Trigger |
| --- | --- |
| E (Queues as wake-up) | Any of: a lane's due-to-start p95 exceeds 2 minutes; a lane stays at its per-tick cap for 3 consecutive ticks while its backlog grows; tick wall time p95 exceeds 45 s; or a required provider event feed exists only as a Queue. |
| Workflows | A job class needs more than five dependent external effects with branching or human waits, **and** a reviewed D1 state machine for it is shown to be harder to verify than Workflow steps plus D1 receipts. Each external effect then still uses D1 intent and receipts, with step retries set to 0 for mutations. |
| Durable Objects | Measured D1 contention on a per-tenant hot row (busy or retry errors in the load test), or a requirement for strict per-tenant ordering above about 1 operation/s. |

## Consequences

**Costs.** No new spend. The selected design uses only the Workers Paid subscription the owner already pays for and the allowances it includes. Planning arithmetic for the tick (not a measured bill):

- 43,200 invocations a month against 10M included requests;
- assuming 5 ms CPU per idle tick, about 216,000 CPU ms a month against 30M included;
- about one indexed due query per active lane per tick, and no writes when idle.

Real row counts (`meta.rows_read` / `rows_written`, including indexes and triggers) must be measured in P-3/P-5. The included allowances are shared with the account's other apps.

**Free fallback** (only relevant if the account ever returns to Workers Free):

- the 3 triggers still fit the limit of 5;
- 1,440 ticks a day fit the 100k requests/day limit;
- the binding constraint is the **10 ms CPU per invocation** limit, so ticks must stay I/O-bound and claim fewer jobs;
- D1's 100k rows written per day caps theoretical throughput at roughly 10k small jobs a day (at about 10 row writes per job including indexes), and queries fail at the limit rather than billing.

**Cost of the alternatives.** Queues, Durable Objects and Workflows are each $0 marginal at forecast volume on Paid. Adopting any of them later costs nothing up to its included allowance. Overage beyond that allowance is the owner's call: Queues at $0.40/M operations, Workflows at $0.80 per 100k steps. The adoption review must project usage against the allowance and name a ceiling.

**Engineering cost accepted.** Whumpo owns:

- fairness;
- backoff;
- the operator lane;
- per-lane diagnostics.

Polling adds up to about a minute of latency. That is acceptable for notices, push, rules and cleanup. It is not acceptable for Chat, which stays synchronous.

**Risks.**

- One tick serializes lanes. A slow provider in one lane can use up the shared 20 s admission window. Mitigation: per-lane deadlines and the rotation order.
- A bug in the tick affects every lane. Mitigation: lanes settle independently, the way `runMaintenance` already isolates jobs.
- D1 batch atomicity, not SQLite callback transactions, must carry every claim/intent pair.

**Unchanged.** These still hold:

- the transition contract and the traces in [background jobs](background-jobs.md);
- envelope v1 and its restore rules;
- the [notification](notifications.md) receipt states;
- WH-145's refusal order.

Job claims, restored journals and operator re-drives still create no authority.

## Migration and decomposition (proposals)

These are proposals only. IDs are assigned when each one is admitted to the backlog, because other agents may be adding rows at the same time. Each change to the schema needs the owner-run empty-D1 cutover ([releases](releases.md)). None of them activates a provider or adds a binding.

| # | Proposal | Size | Depends on | Notes |
| --- | --- | --- | --- | --- |
| P-1 | Make the `* * * * *` branch a lane registry: rotation, per-lane and per-owner claim caps, a 20 s admission deadline, independent settlement. Contact delivery becomes lane 1 with unchanged behavior. Fix the stale "No cron trigger … configured" comment in `src/index.ts`. | S | WH-052 | Code only, no schema. Existing contact tests must still pass. |
| P-2 | Port the job journal to the current D1 schema: envelope v1 storage, atomic outbox in D1 `batch`, fence, uncertain and operator lanes, lifecycle registration in `data-lifecycle.json`. Use real concurrent-client tests on D1 (`--d1`). | L, split into schema and runner | P-1 | Cutover required. Replaces the SQLite-only proof. **Schema and runner implemented in source October 29, 2026 (schema batch 3a), not deployed: see [P-2 as built](#p-2-as-built-october-29-2026-schema-batch-3a).** |
| P-3 | Per-lane diagnostics: due, leased, uncertain and operator counts with oldest age, tick wall/CPU time, and claims per owner, in `maintenance_health` and `report-maintenance.mjs`. Feeds the adoption triggers. | M | P-1, WH-006 | The job-name allowlist is a schema check, so a cutover is needed. |
| P-4 | Move the contact outbox onto the journal as WH-156's first adapter using decision 5 (one envelope per attempt), and generalize it to the frozen notice states. | M | P-2, WH-155 | This is WH-156 scope; no separate scheduler. |
| P-5 | Load and fairness run of the tick on local Worker/D1 bindings: 1,000 jobs/day steady, a 100-job burst, one noisy tenant, provider timeouts. Record p95 due-to-start and rows read/written. | M | P-2, P-3, WH-050 | Evidence for or against the Queues trigger. |
| P-6 | Rule lane: WH-069 admission through WH-145 `admitRuleAction`, with the use count read and incremented in the claim batch. | M | P-2, WH-145 | Part of WH-069. |
| P-7 | Push and closure lanes (WH-086, WH-018) on the same journal. | inside each parent | P-2 | No new scheduler per feature. |
| P-8 | **Conditional:** Queues wake-up review. One queue plus DLQ, an outbox sweep, a usage projection against 1M operations/month, and an owner sign-off if overage is possible. | S | a trigger in P-3/P-5 | Do not start without a fired trigger. |

The batch-builder study's builder lane, if its own gate ever passes, is one more lane on P-1/P-2. It needs no separate scheduler.

## P-2 as built (October 29, 2026, schema batch 3a)

Source and local verification only; the owner-run cutover is still to do and nothing admits a job yet.

**Schema.** `job_journal`, `job_journal_events` and `job_outbox` (lifecycle class `job-journal`) port the prototype. `job_journal` adds `owner_user_id` (foreign key to `users`, `ON DELETE CASCADE`), `purpose` and `envelope_digest` to the prototype's columns, and keeps the whole envelope. Indexes: `(state,due,id)`, `(owner_user_id,state)` and `job_outbox(acknowledged_at)`, plus a unique `(job_id,event,fence,attempt)` event index that doubles as the foreign-key index. `maintenance_health.job` admits `jobs`.

**How the concurrency guarantees are enforced.** D1 cannot read and then branch inside one commit, and a transaction callback is not available, so nothing in `src/job-journal.ts` reads first. Every check the prototype ran in its transaction is one of these:

1. **A guarded statement.** Each caller transition is one `UPDATE ... RETURNING` whose `WHERE` is the compare-and-set: the owner, the `fence` the claim returned, the `state`, and the lease or expiry time. Of any number of racing claimers, one gets a row. A stale holder, or a holder whose job was cancelled (cancel moves the fence), updates zero rows and gets `job_lost`.
2. **A trigger that re-checks the transition.** `job_journal_transition` lists, per event, what must hold before and what may change: a lease is at most 60 s; the fence moves by one only on events that end a holder's right to act; once an intent is recorded an expired lease can only become `uncertain`, never `ready`; an attempt id is derived from the job; the backoff after a proven non-send is fixed by the attempt number; an `account-cleanup` chunk moves its cursor forward only. A hand-written update cannot skip a state, and `tests/schema-batch-3a.mjs` tries every event from every state.
3. **Triggers that write the receipts.** Admission (`job_journal_enqueued`) writes the outbox row, with its stable delivery id, and the first event; every later transition writes exactly one event from `last_event`, `last_at` and `last_ref`. Events cannot be forged (an insert must restate the job's own last transition), changed or repeated, and are deleted only with a finished job. Identity columns are frozen.
4. **One `db.batch`.** Admission is one batch (insert, then read back by id and owner). A cleanup chunk is one batch: the guarded `UPDATE` first, then a statement that fails the whole batch when `changes()=0`, then the caller's effect statements, so a stale fence applies none of them. A lost admission or settle reply is a repeat: the same envelope digest or the same result reference reads the saved row; anything different is a conflict.

Counts of changed rows come from `RETURNING`, because D1's `meta.changes` also counts rows its triggers write.

**Evidence.** `tests/job-journal.mjs` runs on SQLite with two separate connections to one file, and with `--d1` on the actual local D1 binding: two claimers racing, a stale fence on every transition, a lost settle reply, uncertain and operator lanes, atomic chunks, forged writes, pruning and the dispatcher lane. `tests/schema-batch-3a.mjs` covers the schema objects and the transition matrix on both. Local D1 serializes the statements, so the SQLite two-connection run is the one with real interleaving; neither proves production D1 latency or contention.

**Dispatcher lane.** `journalLane` in `src/job-dispatcher.ts` asks `ctx.claim()` first (the per-type, per-owner and 20 s caps stay in memory, decision D3, and reset every run), then takes the D1 lease with `claimJob`. A lost claim is skipped. The due scan returns at most `perOwner` rows per owner, so one owner's backlog cannot fill it. A handler that throws leaves the job leased: an unsent job is claimed again after the lease expires, one with an intent recorded becomes `uncertain`. No lane is registered in `src/index.ts`: contact delivery stays on its own outbox (P-4), and no adapter exists to register.

**Retention.** The nightly `jobs` maintenance pass (`pruneJobJournal`) deletes finished jobs (`complete`, `cancelled`, `expired`) and, by cascade, their events and outbox entry once `jobJournalRetentionMs` (30 days, a named constant in `src/job-journal.ts`) has passed since their last transition, at most 200 per run. 30 days is an interim default pending an owner decision. `ready`, `leased`, `awaiting`, `uncertain` and `operator` jobs are never pruned (a trigger refuses it too).

**Account closure.** Journal rows cascade with the account. The closure inventory counts `jobJournal`, `openJobJournal` and `unresolvedJobs`; an `awaiting`, `uncertain` or evidence-holding `operator` job is settle-first work that blocks closure like other provider work.

**Not done.** No per-owner cap on journal rows; the P-3 diagnostics (`maintenance_health` per lane, due and uncertain ages); the P-4 contact adapter; any lane or adapter. Restored journals grant no lease: restore admission treats the three tables as ordinary watched records ([restore admission](restore-admission.md)).

## Verification of this record

- Every Cloudflare figure above was read from the linked official page on October 29, 2026 (UTC). The page dates are shown in the table.
- Source facts were read from `wrangler.jsonc`, `src/index.ts`, `src/contact-notifications.ts`, `src/build-jobs.ts` and `schema/platform.sql` at `bf261a2`.
- No account usage, billing or provider state was read. No prototype was re-run for this record.
