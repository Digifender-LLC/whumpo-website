# Shared capacity and plan economics

**September 30, 2026 — proposed launch economics, not enabled billing.** This document evaluates the owner's shared-pool direction. `src/resource-economics.ts` implements a versioned offline tariff/scenario calculator; `tools/report-resource-economics.mjs` produces [reproducible scenarios](economics/resource-pool-scenarios.json). No new entitlement, charge, customer restriction, rollover grant, infrastructure provisioning or live usage gauge is implemented by this change. Existing test units and historical receipts retain their meaning. The owner reconfirmed unlimited standard AI under fair use; advanced models consume explicitly approved credits. Standard task classes have zero customer-unit debits while retaining internal provider cost.

## Recommendation

Keep the existing prices. Start with conservative capacity, measure real task costs and completion quality, then increase value if the evidence supports it. Do not advertise the examples as guaranteed workloads.

| Plan | Monthly | Annual | Proposed monthly units | Capacity | Internal variable-cost envelope | Annual margin before standard AI |
|---|---:|---:|---:|---:|---:|---:|
| Starter | $17 | $170 | 1,000 | 1× | $2 | 61.1% |
| Personal | $30 | $300 | 2,500 | 2.5× | $5 | 62.2% |
| Business | $79 | $790 | 7,500 | 7.5× | $15 | 65.6% |
| Business Pro | $139 | $1,390 | 14,000 | 14× | $28 | 64.2% |

These envelopes cover **metered infrastructure and approved advanced AI**. Unlimited standard AI is an additional variable expense; it cannot be assumed to fit the unit envelope or treated as free. Existing `internalAITargetCents` and legacy unit grants are not rewritten by this proposal. Features remain separate: current project/domain/collaboration and other capability contracts still apply. Remove fixed storage promises from launch marketing when adopting the pool; the existing storage targets are not extra free capacity on top of it.

### Calculation and limits

Use annual revenue divided by twelve, not the monthly sticker price. Deduct assumed payment processing of 3% + $0.30 per transaction (annual fixed fee spread over twelve months), maximum domain redemption of $20 per annual domain per year (one, one, one, two), full variable envelope, a 20% variable-cost contingency, and a provisional $1/customer/month operations reserve. Payment pricing is a scenario assumption, not a processor quote; no Stripe account exists. Annual units would grant monthly, not all twelve months at purchase.

The internal stress ceiling is $0.002 variable cost per consumed unit. It is a **design constraint**, not a customer dollar exchange rate. Proposed tariffs are rounded, versioned prices for dimensions of service. Every credit-metered modeled resource stays below this envelope. Standard AI has no customer-unit debit and sits outside that bound. AI figures are unproven completion-cost targets; they require benchmarks including retries, acknowledgment, orchestration, tools, safety inference and failed work. Without that validation, the ceiling is not a cost guarantee.

Before standard AI expense, at a minimum 60% modeled annual contribution margin, the maximum allowances are 1,062 / 2,732 / 9,027 / 16,041 units. The proposed round allowances sit below those ceilings; Business and Pro keep extra uncertainty headroom for more complex workloads. Formula: `(monthly recognized revenue × 40% − payment fee − domain reserve − operating reserve) / (internal unit cost ceiling × 1.20)`. These are conditional ceilings, not measured capacity.

Full-use monthly margins are 75.2%, 72.7%, 72.6%, 71.9%. Annual remaining contributions are $8.65, $15.56, $43.17 and $74.40 per customer-month. These are **contribution estimates before standard AI, not net profit**. The report separately models $1/$5/$20 monthly standard-AI expense per account, plus 20% contingency. At $5, annual margins fall to approximately 18.7% / 38.2% / 56.5% / 59.1%; at $20, Starter and Personal become loss-making. Unlimited fair use cannot guarantee a per-account margin; assess measured company-wide contribution and tier-sensitive abuse review without hidden ordinary-AI debits. Salaries/support, acquisition, taxes, refunds, disputes, fraud, registrar overhead, third-party integrations, backups, logs, recovery and unmetered control-plane work require actual budgets. The $1 reserve is a hypothesis, not proof those expenses fit. Tax-inclusive prices require subtracting tax before calculating margins. Reserve the full domain purchase cash when redeemed; amortization does not delay payment.

Use marginal provider rates with no per-tenant free allowance. Account-wide free/included allocations are shared upside. Minimum bills, prepaid blocks and rounding can make actual low-volume account cost higher than these linear estimates. Reconcile account invoices and allocate residual overhead; do not charge the same included allowance to every tenant or assume it makes a service permanently free. At launch even the Workers $5 account floor must fit aggregate contribution; optional Stream has a $5/month storage block. Durable Object duration billing rounds excess to whole million GB-seconds ($12.50). These floors require company-level cash headroom beyond the per-user model.

## Customer value scenarios

These are synthetic workloads calculated from the tariff, not production measurements or complete bills. Standard AI contributes provider cost but no units. Details and omitted dimensions remain visible in the JSON report.

| Example | Units/month | Modeled provider cost | Fits proposed pool |
|---|---:|---:|---|
| Small business site: 100 quick interactions, 30 standard tasks, 2 intensive tasks, light traffic and 5 GB files | 160 | $0.94 | Starter |
| Active personal app: 200 quick, 80 standard, 8 intensive tasks, 1M dynamic requests and 20 GB files | 894 | $3.34 | Personal |
| Business with video: 100 standard tasks, 300 stored video minutes, 2,000 delivered minutes, app/storage activity | 4,370 | $8.70 | Business |
| Container running 730 hours with 1 GiB provisioned memory, 4 GB disk, 10% of one CPU active and 10 GB egress | 8,964 | $13.06 | Pro for this component alone |

The container example excludes its controlling Worker/DO, agent work, logs and backups; it is not a complete deployment quote. Favor sleeping workloads where suitable. The agent must review recurring consumption before provisioning, and never promise arbitrary always-on servers on Starter.

## Work classes and routing

Quick / standard / intensive work using standard AI costs **zero customer units**, with internal modeled completion costs $0.001 / $0.015 / $0.08. An explicit advanced-model task has an illustrative 50-unit / $0.08 estimate; this is not an approved premium tariff. Complexity alone never makes standard assistance chargeable. A task means a bounded, reviewed outcome, not each hidden model call. Retrieval of account status, billing explanations, safety refusals and Whumpo-caused retries should not repeatedly consume customer task units. Ordinary work must not become intensive solely because the router chose an expensive model. Classify scope before starting; get explicit agreement before increasing an intensive quote. Settle once per task and return unused reservations.

The router compares total expected completion cost and demonstrated quality: input/output/cache/reasoning tokens, retries, tools, safety calls, latency and provider/gateway fees. Keep Muse Contributor pinned during private testing. Workers AI is a preferred candidate when competitive, not a mandatory cheapest-token route. Internal escalation absorbs its cost inside the quote. If a task cannot fit, offer a narrower scope or separately approved premium work; never silently use the premium wallet. AI Search/vector/storage/tools need attribution into the task envelope or their own reviewed tariff before admission. No unknown dimension may be treated as zero cost.

Cloudflare AI Gateway core analytics/caching/rate limiting are free, but Unified Billing credit purchases add 5%; guardrails invoke paid inference, and new gateway logging follows Workers Logs pricing. Direct provider keys through Gateway may avoid the Unified Billing fee; verify the chosen path and terms. These estimates assume direct provider billing. With Unified Billing, include its fee within the task cost target and contingency rather than increasing the customer's quote. [AI Gateway pricing](https://developers.cloudflare.com/ai-gateway/reference/pricing/).

Workers AI publishes model-specific rates; for example, `gpt-oss-120b` is $0.35/M input and $0.75/M output at the date above. A 20k-input/2k-output call alone is $0.0085, while five such calls cost $0.0425 before ancillary work—already above the proposed standard target. This illustrates why task benchmarks and bounded execution matter more than cheap per-token marketing. This is a pricing illustration, not a model selection or activation. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## Capacity ledger mechanisms (WH-043 first slice, source only)

`src/capacity-ledger.ts` implements the ledger rules below as pure functions over plain data with **explicitly synthetic terms** (`terms: 'synthetic-proposal'`). It is **not wired** to any route, billing path or admission, adds **no schema**, holds **no purchased balance** and enables no billing term; the lot, expiry and rollover values are this document's proposal. Tested by `tests/capacity-ledger.mjs` (12 cases, each followed by a conservation check, plus a seeded random run of more than 2,000 operations; reversing the earliest-expiry order, removing the refund cap, letting an expired lot be revived or removing the idempotency conflict each fails it).

- **Units** are integer micro-units (whole numbers up to 10^12; floats, negatives and non-numbers are refused). Lots are `monthly` (the period's included allowance), `rollover` and `purchased`. Balances are never read from, translated from or revived from the retired test-unit tables: the ledger only knows entries it created (version 1).
- **Operations carry an id.** Repeating one with the same body is a no-op; repeating it with a different body is refused (`OP_CONFLICT`), so a replayed request cannot settle twice. This is idempotency against one ledger value: two pure calls from the same base each succeed. The persistent form (`src/capacity-store.ts`) serializes them with a compare-and-set on the stored revision: `tests/capacity-store-races.mjs` holds two writers at the same revision on two connections to one SQLite file and on actual local D1 (`pnpm test:capacity-store`), and exactly one commits while the other gets `revision_conflict` and must re-read, so concurrent holds cannot overspend, a settlement or refund cannot apply twice and no update is lost (source evidence only, not wired or cut over). Reservation ids are looked up and stored as own properties only, so ids such as `constructor` or `__proto__` neither match inherited values nor touch the prototype. A hold takes units from the live lots earliest expiry first (an open-ended purchased lot last), all or nothing: a shortfall is a refusal and holds nothing (no overdraft, no automatic top-up, no automatic plan change).
- **Settlement** consumes at most what was held (work beyond the hold needs a new hold) and returns the rest to the lots it came from; a second settle or a release after settlement is refused. A **refund** applies at most once per refund id and never beyond what the reservation consumed; successive partial refunds walk the consumed lots latest-expiry first and skip units an earlier refund already returned, so each consumed unit goes back to its own lot once. Units returning to a lot that has meanwhile expired are expired, never revived.
- **Expiry** loses unspent units and leaves holds alone. **Rollover** carries the smaller of the unused fresh monthly units, the previous allowance and the next allowance, only at or before the period boundary, once per target period and once per source lot, from a monthly lot only (so rollover units never roll twice); the carried units form a rollover lot that expires with the next period. The next allowance must equal the target period's granted monthly allowance, and a monthly grant that follows a rollover must equal the allowance it was sized for (so the two always agree, whichever is recorded first), which keeps monthly plus rollover within twice the allowance. Lot ids starting `rollover:` are reserved for rollover lots.
- **Standard assistance debits zero units**: a standard-AI reservation with units above zero is refused. A purchased lot needs a consent receipt reference, and no function creates one otherwise.
- **The balance view** (`capacityView`) separates available, held, per-kind units and the next expiry, labels the terms as synthetic, and answers `unknown` with no number when usage telemetry is partial or unknown: it never shows full capacity.
- **Not done (WH-043 stays open):** a persistent form is source-only: `src/capacity-store.ts` and the `capacity_ledgers` table (schema group C6, merge only, not cut over, not wired to any route, grant or admission) -- granting from paid invoices, the customer explanations and compaction of a long-lived ledger are not built, atomic cross-service reservations, the proposed-versus-actual balance UI, premium funding and the WH-041 terms approval, calibration (WH-023), and `pnpm test:billing` / `test:plan-periods` integration.

## Rollover, top-ups and overages

Propose a **$10 / 1,000-unit** top-up, disabled until checkout exists. At the stress envelope it leaves $7 after assumed $0.60 payment fees and $2.40 consumption plus contingency, before support and other overhead. Avoid tiny purchases whose fixed payment fee dominates. Purchased units need a distinct lot type and reviewed expiration/refund terms; do not expire them under subscription rollover rules. Premium funding remains separate with explicit authorization and no double debit.

Proposed rollover: only unused fresh monthly subscription units survive into the immediately following paid period. Consume earliest expiry first. Old rollover never rolls twice. Carry no more than the smaller of previous and next monthly allowances; total subscription balance cannot exceed 2× the next allowance. Expire on cancellation/nonrenewal, and publish downgrade/expiry terms before sale. Refunds/chargebacks need compensating entries. Do not roll promotional, held, already-consumed or purchased units through this mechanism.

A full 2× rollover burst reduces annual-period contribution margins to 44.1%, 38.2%, 38.2%, 35.2%. It remains positive in this model, while lifetime consumption cannot exceed earned grants. Accrue the possible carried consumption as a liability; do not spend quiet-month surplus as if it were permanent savings. The report also models doubled provider costs and the combined 2× rollover/2× cost shock. The latter **loses money on some plans**. Rollover should remain proposed until measured economics and a company reserve cover that correlated scenario.

Automatic top-ups must be off by default, with explicit amount/monthly-dollar ceiling and receipt. Do not automatically upgrade plans. Distinguish exhaustion from abuse: legitimate demand gets optimization, a top-up or a plan recommendation. Define a reviewed grace/continuity policy before launch; do not delete data or abruptly take sites offline. New expensive work may need funding, while essential account access, export/recovery and cost explanations remain available.

Monitor mode continues to suppress abuse penalties. Track total provider COGS and company contribution, not just AI spend or revenue. Positive total profit can justify outliers. Pool exhaustion, explicit purchase consent and security boundaries are separate from abuse classification. Standard AI stays unlimited under fair use: these allowances cannot guarantee per-customer margins. Model the additional AI distribution separately; its customer debits are zero. Do not simultaneously advertise unlimited metered work and enforce a hidden hard allowance.

## Presentation and accounting delivery

Show remaining monthly capacity, category shares (Apps & websites, Advanced AI, Storage, Video, Other), billing-period dates, rollover expiry and paid balance separately. Forecast only with enough complete history and explain uncertainty; bursts and persistent storage need recurring-cost projections. Unknown telemetry must show “still calculating,” not a false 100% remaining. Drill-down shows versioned units and plain-language causes. Chat can explain usage from owned durable receipts, with no provider credentials or internal margin information in customer responses.

Before enabling billing:

1. Collect owner-scoped usage observations in shadow mode, with immutable event/source IDs, tariff version, quantity, category and provider-cost evidence. No customer debits yet. Reconcile against invoices and account floors.
2. Implement a distinct integer micro-unit ledger (this calculator uses floating-point estimates only), monthly grants, separate purchased/rollover lots, expiry and immutable historical tariff snapshots. Preserve legacy test balances; never reinterpret them.
3. Atomically reserve across simultaneous tasks/services; settle actual authoritative dimensions once, hold unknown outcomes, reconcile refunds and reject duplicate provider events. Enforce ownership and prevent cross-tenant attribution. Do not let models set resource usage or balances.
4. Attribute platform retries/control work internally. Avoid counting the same Stream storage as R2, the same inference as both provider tokens and agent units, or free Worker/R2 egress as paid bandwidth. Combined distinct Worker/DO/container costs still count.
5. Benchmark completed task cost distributions and workload mixes, including failure-heavy users, sustained storage, large video traffic and idle servers. Validate at least two complete periods, reconcile all nontrivial unknowns, and rerun margin/rollover stress cases before launch promises.
6. Add real payment receipts, annual monthly issuance, cancellation/refund handling, top-up consent and optional spending ceilings. Then release capacity UI from measured ledger data and update public terms together.

No claims of a provisioned capability follow from a tariff entry. Containers, Stream and new paid services require entitlement/pricing verification and an explicit reviewed activation. This release is the economic foundation, not the production billing system.

## Provider baseline and proposed tariff

Official pricing checked September 30, 2026. Tariff values are Whumpo proposals; provider figures are marginal estimates, exclude account floors/free allowances and require re-verification before launch. Workers/R2 egress and static asset delivery have no separate bandwidth tariff here. No generic bandwidth fee is invented.

- [Workers](https://developers.cloudflare.com/workers/platform/pricing/): $5/month account minimum; modeled dynamic request and CPU dimensions, static delivery separate.
- [R2](https://developers.cloudflare.com/r2/pricing/): Standard storage/operations only; Infrequent Access, retrieval and minimum retention are out of scope. Account billing rounds usage; storage observations must respect provider measurement semantics.
- [D1](https://developers.cloudflare.com/d1/platform/pricing/): scanned/written rows including indexes, plus stored data; not logical query count.
- [Containers](https://developers.cloudflare.com/containers/platform/pricing/): CPU active, memory/disk provisioned while running, regional egress. Modeled egress uses highest listed regional rate. Worker/DO charges additional.
- [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/): requests, billable GB-seconds and SQLite storage operations. Use actual provider request equivalents and hibernation semantics, not raw socket message counts. KV backend excluded.
- [Stream](https://developers.cloudflare.com/stream/pricing/): stored-minute capacity in prepaid blocks and delivered minutes. Encoding and delivery bandwidth already included; no duplicate R2 storage or egress charge.

| Resource | Quantity basis | Proposed units | Modeled provider USD |
|---|---|---:|---:|
| quick | completed quick interaction | 0 | $0.001 |
| standard | completed standard task | 0 | $0.015 |
| intensive | reviewed intensive standard-model task | 0 | $0.08 |
| advanced | explicitly approved advanced-model task; illustrative only | 50 | $0.08 |
| workerRequests | million dynamic requests | 200 | $0.3 |
| workerCPU | million CPU milliseconds | 15 | $0.02 |
| r2Storage | GB-month, Standard | 10 | $0.015 |
| r2Writes | million Class A operations | 3000 | $4.5 |
| r2Reads | million Class B operations | 240 | $0.36 |
| d1Reads | million rows scanned | 1 | $0.001 |
| d1Writes | million rows written | 700 | $1 |
| d1Storage | GB-month | 500 | $0.75 |
| containerCPU | active vCPU-hour | 50 | $0.072 |
| containerMemory | provisioned GiB-hour while running | 6 | $0.009 |
| containerDisk | provisioned GB-hour while running | 0.2 | $0.000252 |
| containerEgress | GB, conservative highest listed region | 35 | $0.05 |
| doRequests | million requests | 100 | $0.15 |
| doDuration | million GB-seconds | 8500 | $12.5 |
| doReads | million SQLite rows read | 1 | $0.001 |
| doWrites | million SQLite rows written | 700 | $1 |
| doStorage | SQLite GB-month | 150 | $0.2 |
| streamStorage | stored video minute-month | 4 | $0.005 |
| streamDelivery | delivered video minute | 0.7 | $0.001 |

Reproduce: `node tools/report-resource-economics.mjs`. Verify: `node tests/resource-economics.mjs` and `pnpm check`.

## Task-cost calibration delivery — September 30, 2026

Implemented `src/task-cost-report.ts` and the private operator command:

```sh
node tools/report-task-costs.mjs 2026-09-01T00:00:00.000Z 2026-10-01T00:00:00.000Z
# Optional: --account UUID. Store the result privately.
```

The report groups existing inference receipts by owned AI Chat turn, includes acknowledgment calls, and returns nearest-rank p50/p95/max shadow-cost and token distributions only for completed turns with at least one observed call, no unfinished calls and no unpriced calls. Released reservations add no cost. Failed/unfinished turn costs remain visible separately; missing receipts do not become free samples. Exclusion counts overlap. An account filter applies to turns and their matching receipt owners. No prompts, emails, source, model output or account/turn identifiers are returned.

The window selects turn creation timestamps using an inclusive lower/exclusive upper bound; **all currently recorded calls for those turns** are included, even late acknowledgments after the window. This avoids falsely treating a partial task as complete. It is a current-state cohort report, not a historical invoice. More than 10,000 turns rejects the report rather than silently sampling. A maximum 93-day window bounds normal use; deleted history and unrecorded work remain unavailable.

No task class is inferred from cost. Completed Chat turns are not necessarily useful completed outcomes, and multi-turn work needs future task-level attribution. Provider invoice expense, customer units, infrastructure attribution and premium gateway costs remain unknown/uncovered. Muse shadow rates cannot validate API profitability. This report creates no new observations, ledger grants, charges, restrictions or provider calls.

Verification: `node tests/task-cost-report.mjs` passed with an actual SQLite read fixture covering multi-call aggregation, late acknowledgments, release/failure/uncertainty, unpriced/missing evidence, cross-owner receipt refusal, date boundaries, empty distributions and aggregate overflow. `pnpm check` and `git diff --check` passed. This is read-query coverage, not a test of billing-write invariants.

Live read-only acceptance against the existing test database succeeded. The September 1-to-run-time cohort contained two retained AI turns and zero fully observed priced samples. Actual provider expense and customer-unit totals remained null. The private output is ignored at `.secrets/task-cost-calibration.json`. This confirms the command works, not that plan economics are calibrated. No migration or Worker deployment was needed.
