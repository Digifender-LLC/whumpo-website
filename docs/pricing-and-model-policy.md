> Latest decision: paid launch plans use unlimited standard site assistance under fair use, with tier-sensitive monitoring—not fixed AI allowances. See [fair-use policy](#unlimited-standard-ai-under-fair-use--september-29-2026-decision). Monitor is the default; enforcement requires operator choice and verified overall profit decline with stable revenue. Premium spending remains opt-in. Current preview limits are separate.

> September 29 update: flexible capacity, approval-only plan changes, draft overage controls and the unified dashboard are specified in [unified-workspace-and-capacity.md](unified-workspace-and-capacity.md). Its decisions supersede the fixed storage targets below.

# Pricing and model policy — September 29, 2026

Supersedes the old Launch/Studio public proposal. Source: the owner's “AI VPS Hosting Comparison” conversation, latest price revision, and the supplied model-routing and acknowledgment notes. Their provider prices are **planning assumptions**, not verified API tariffs. This document does not enable billing or authorize purchases.

## Subscription catalogue

| Plan | Monthly USD | Annual USD | Annual domain allowances | Target projects | Target file storage |
| --- | ---: | ---: | ---: | ---: | ---: |
| Starter | 17 | 170 | 1 | 1 | 10 GB |
| Personal | 30 | 300 | 1 | 5 | 50 GB |
| Business | 79 | 790 | 1 | 10 | 200 GB |
| Business Pro | 139 | 1,390 | 2 | 25 | 500 GB |

Monthly prices are the owner's explicit choices. Annual prices follow the final discussion's proposed ten-month equivalent. Annual benefit: up to $20 wholesale per eligible standard registration or renewal, premium domains excluded. The quote helper shows the uncovered wholesale amount; it is not a retail invoice, transfer workflow, payment, inventory reservation or benefit redemption. No domain purchase is enabled. Renewal/transfer fulfillment, benefit ledger, customer ownership and transfer-out controls still need implementation before advertising an available benefit.

The public landing page, API and `/plans` use the same catalogue. Resource amounts are labeled launch targets. They do not override current upload, project, domain, CMS, backend or platform safety caps. Explore remains the free invite-only test. Paid subscriptions remain unavailable because no Stripe account is configured. No annual entitlement or recurring payment fulfillment is claimed.

New monthly entitlement receipts recognize all four tiers. Old Launch/Studio receipts retain their exact identities and original allowances. Migration 0052 copies receipts without replaying grants or changing the existing usage ledger. Publication-slot guards read current-period receipts. The legacy `billing_accounts.plan_id` cache is not authoritative.

Provisional **test** build-unit limits remain separate from product economics: Explore 50, Starter 250, Personal 800, Business 1,600, Business Pro 3,200. These are not dollars, provider costs, or advertised launch AI allocations. The legacy $5/100 test-credit pack is not a dollar wallet. Existing unit reservations, uncertainty holds and credit opt-in continue working. Before real beta, replace the test-facing usage vocabulary and calibrate allowances from measurements.

BYOC/BYOI is contact-based. The agent may help draft requirements; delivery to a sales/support queue is not connected and it cannot claim a request was sent. Existing optional GitHub source-backup and Cloudflare domain-DNS authorizations do not provision customer-owned infrastructure. Managed resource add-ons require a future exact cost review and approval; no automatic paid upgrade is enabled.

## Four model roles, one customer-facing agent

1. **Acknowledgment:** latest message only, no history, project data, tools or authority; chooses a small intent category. Platform-owned 8–20-word text prevents arbitrary promises or invented progress.
2. **Orchestrator:** conversation and compact workspace summary, plans work and invokes supported tools.
3. **Normal subagent:** future task runner, task-specific context and bounded code/search/test tools.
4. **Advanced subagent:** future evaluator-approved managed escalation after normal work fails. Optional customer-approved premium access is specified in the newer AI Gateway decision below.

Every route resolves to `muse-spark-1.3-contributor` on OpenCode Go for owner testing. Runtime configuration fails closed for another model or endpoint. There is no paid-model fallback or beta API selection yet. Chat Completions and Responses transport remain supported.

The current workflow executes an orchestrator and optional parallel acknowledgment. Normal/advanced task dispatch is **not implemented**. Database admission rejects these roles until the task runner implements durable task, evaluator and concurrency receipts. Pure policy tests alone are not proof of a working subagent system.

## Cost accounting and budgets

One shared inference budget per account/month, not separate role wallets. Proposed tier targets are $2/$5/$10/$20. Explore owner testing uses a $20 ceiling. A current period's budget is monotonic across upgrades; renewal starts a fresh budget. No paid provider invoice is being generated.

Migration 0053 records model, provider origin, role, protocol, policy version, immutable rate snapshot, input/output usage and cost reservation per call. Orchestrator and acknowledgment share the budget. Reservations and customer-turn admission are transactional; insufficient budget rejects the main call before inference. Optional acknowledgment admission failure never prevents the main answer. Responses that fail proposal validation still retain internal model cost even when customer units are refunded.

USD microdollars use integer arithmetic and round up once per inference call. Admission assumes no cache savings. Unknown outcomes retain their cost hold; no automatic repeat occurs. Only undispatched expired reservations are released automatically. Cost is **subscription-shadow** during Muse testing: estimated marginal API economics using an explicit hypothetical $0.10/M input, $0.20/M output, not actual OpenCode subscription spend. The subscription fee is a separate operator expense; this estimate must not be called a provider invoice. Mock transports are explicitly `unpriced`, never interpreted as free production inference.

Future scenario rates (not activated or verified): acknowledgment $0.10/$0.20, orchestrator $0.05/$0.10, normal $0.10/$0.20, advanced long-term $1.50/$7.50 per million input/output tokens. Promotional Gemini figures and model names from the notes are not production configuration. Beta launch requires current vendor rates, validity dates, cached/reasoning/tool billing semantics, provider-specific token bounds, aggregate spend controls, over-reservation reconciliation and paid-call admission. No claim of a hard actual-dollar cap is valid until those gates pass.

## Escalation policy

- At most two concurrent subagents; acknowledgment/orchestrator are separate roles.
- Require a failed normal attempt plus evaluator evidence: repeated failing fixes/tests, low confidence, capability mismatch, invalid tool calls, unexpected deployment state or an escalation request assessed by the evaluator. A temporary infrastructure failure alone is insufficient.
- More than 50% remaining: ordinary evidence-based escalation.
- 25–50%: reject low-necessity escalations.
- 10–25%: high necessity only.
- Below 10%: high-necessity completion of already-started critical work only.
- No route may exceed its remaining budget. Advanced dispatch also stops at 150 calls in a rolling 30 days or 20 in 24 hours.

These are server policy helpers for the future runner. The runner must read counters/evidence from authoritative durable receipts and reserve atomically; customers/model output cannot set them. No model receives power to bypass approval for deployment, publication, purchases or sensitive actions.

## Acknowledgment latency

An optional Muse intent classification runs alongside the main request under the Worker's background lifetime hook, with a five-second timeout, 256-token output ceiling and separate cost receipt. Its input is exactly a fixed classification instruction and latest message. Main work never awaits it. The authenticated acknowledgment read is owner-scoped and hides results after the main turn leaves pending state.

The browser may collect an acknowledgment while waiting. At 700 ms, if the main response is not ready, show one short acknowledgment, with a neutral fallback if classification is late/unavailable. Once shown, keep it visible at least 1,000 ms before presenting the main answer. Thus a result ready at 730 ms appears around 1,700 ms after an acknowledgment shown at 700 ms. Fast answers suppress acknowledgment. Slow answers incur no extra delay after that dwell window. Errors appear immediately. Late acknowledgment results never replace the final answer. Browser throttling can extend wall-clock timing.

The delay is presentation-only: backend commits and tool actions are never held to simulate work. This helper does not invent progress events. Future workflow activity must come from actual task state.

## Verification

- TypeScript check and production asset build.
- `test:plan-periods`: old/new receipts, upgrades, replay, renewal expiry, ledger totals, catalogue/SQL agreement, domain quote exclusions, guided pricing.
- `test:model-policy`: integer costs, budget thresholds, evaluator evidence, Muse pin, two-agent and advanced call limits.
- `test:model-costs`: actual local D1 with controlled provider, main/ack concurrency and minimal context, shared cost wallet, concurrent admission, unknown outcomes, owner isolation and immutable receipts.
- `test:ack-timing`: deterministic 650 ms suppression, 700/730→1,700 ms example, slow responses, fallback and immediate error delivery.
- Existing billing/provider regression suites; browser inspection of the pricing cards.

Remaining: real paid checkout, annual grant/redemption lifecycle, external sales handoff, paid API routing, evaluator/task runner, durable subagent enforcement, broader real-provider acknowledgment performance measurement and full beta acceptance.

A synthetic live Muse classification check hit the output limit at 64 tokens. At 256 it returned a valid intent in 2,087 ms (86 input / 168 output tokens). This is one sample, not a latency guarantee; the 700 ms generic acknowledgment remains essential with this testing model.

## Test deployment

Released code commit `7e8fd4a` to the existing `whumpo-platform` Worker, version `4a07de28-dd68-49c2-8b9a-db418ed5d3ce`. Production migrations 0050, 0052 and 0053 applied; unfinished local activation migration 0051 and its routes were excluded. No new paid service, payment account or domain purchase was enabled.

Live checks verified health, the four monthly/annual catalogue prices, disabled checkout/subscriptions/domain redemption, anonymous ACK access returning 401, pricing HTML and the published 700 ms / 1,000 ms timing constants. The exact release checkout passed type checking and model-cost/ACK integration tests against local D1. A populated SQLite migration check separately preserved historical receipts, the billing ledger, usage balances and foreign-key integrity. Browser inspection confirmed the pricing cards render in Whumpo's theme.

## CMS prompt budgeting — September 29, 2026

Explicit CMS/EmDash requests without another service-family signal use a focused prompt containing the common trust/approval rules, complete CMS contract and relevant project/profile context. Unrelated backend, website, domain and account tool details and asset records are omitted for that request. Mixed, ambiguous and non-CMS requests retain the full catalog. This is deterministic prompt selection, not an extra model call or permission grant; all server action, ownership, spending and review gates remain unchanged.

The fixed empty-context prompt fixture shrank from 21,658 to 8,575 UTF-8 bytes. Its conservatively bounded two-call estimate is 45 test units. Reservations still use serialized UTF-8 byte bounds, message framing, the full inspection allowance and maximum output budgets—no estimated token/character ratio or assumed cache discount was introduced. Larger context or low remaining balances can still require the existing single-call fallback. The disposable structured CMS lifecycle passes with the normal 50-unit Explore allowance using the `--explore` test option, without an allowance update.

Live acceptance: `RUN_LIVE_MUSE=1 pnpm test:cms-chat-live --explore` passed with the unchanged 50-unit allowance. Muse reported 4,277 input and 2,113 output tokens across two calls, settling 13 test units. It changed only the requested heading, retained the other article fields/formatting, produced no publication review, and replayed without extra inference, charge or native write. Compared with the preceding full-prompt sample (9,541 input tokens / 17 units), this is one measured improvement, not a guarantee for every request. The native content handler remains synthetic/local in this acceptance. Prompt-selection guard tests, generic inspection/budget/replay regressions, TypeScript and build also passed.

Deployed platform version `4357d288-38b1-4b55-9ad0-e262e4e0ddd6`. Live landing availability and anonymous Chat denial verified. No plan allowance, paid service, API rate or customer content changed in this deployment.

## AI Gateway and cost-aware provider routing — September 29, 2026 decision

**Planned, not activated.** The owner's latest direction makes Cloudflare AI Gateway the inference entry point for beta. Whumpo will prefer Workers AI when it is competitive for the task, and use external providers through the gateway when their measured quality-adjusted cost is better. Muse on OpenCode Go remains the only enabled owner-test route today. This decision does not enable billing, purchase gateway credits, change account settings or authorize automatic paid fallbacks.

### Delivery architecture

Whumpo admission and reservations → a versioned route decision → authenticated AI Gateway → the chosen Workers AI or external model → normalized result and usage → immutable settlement. Whumpo retains the provider-independent OpenAI-compatible conversation contract and existing Chat Completions/Responses adapters; each provider must pass protocol/tool/usage conformance before admission. A model's support for one protocol must not imply support for the other.

Cloudflare now documents a shared REST model entry point and AI binding, including third-party models. For OpenAI-compatible single-model chat requests, follow the documented `/ai/v1/chat/completions` route and explicitly select the configured gateway. The older `/compat/chat/completions` remains the documented path for dynamic routes. Pin the exact endpoint, model ID, authentication mode and gateway in reviewed configuration rather than guessing from provider/model marketing names. References: [unified model access](https://developers.cloudflare.com/ai-gateway/changelog/), [OpenAI-compatible gateway endpoint and dynamic-route distinction](https://developers.cloudflare.com/ai-gateway/usage/chat-completion/).

Initially, Whumpo chooses one explicit model per admitted attempt. Gateway-side retries and hidden fallbacks must be disabled until every possible attempt has its own reservation and reconcilable usage receipt. Future gateway dynamic routing must be versioned and bounded to an approved candidate set; an outcome with unknown provider consumption retains its hold. Do not stack SDK, application and gateway retries. Require provider credentials where using BYOK so an absent key cannot silently switch to Cloudflare-managed paid credentials. See [gateway settings, retry and billing controls](https://developers.cloudflare.com/ai-gateway/configuration/manage-gateway/).

### Choosing a route

1. Filter candidates by role, required context length, tools/structured output, privacy/region requirements, observed reliability and task evaluation thresholds.
2. Compare total expected cost per successful task: input/output, billable reasoning, provider tools, gateway charges if any, and measured repair/retry frequency. Cache discounts count only when verified; reservations assume no savings.
3. Prefer Workers AI when competitive within those constraints. Choose a cheaper external route when it meets the same quality floor. Keep latency a separate role-specific bound, especially for acknowledgment.
4. Store provider, exact model/version, gateway/route version, rate snapshot/effective date, selection reason, estimated bound, attempt identity and reported usage. Reconcile receipts with provider/gateway totals; gateway cost dashboards do not replace the tenant ledger.
5. Enforce per-task, per-account and platform aggregate spending limits before dispatch. A shared platform free allocation is not a guaranteed free allowance for every customer.

Workers Paid does not mean unlimited included inference. As documented on this decision date, Workers AI has a daily free allocation, usage charges above it, and model-specific rates; some models require paid billing. The eventual route catalogue must use current prices and account entitlement checks, not this document's frozen examples. [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/). Gateway features, retention and any recurring/minimum charges also require account-specific verification before activation. No new recurring fee is accepted by this plan.

### Premium models and customer credits

Opus, Sol, Astra and Fable are the owner's future premium candidates, not configured API model IDs or verified availability/prices. Add candidates only after their API access, gateway path, exact identifiers, rates and task quality have been verified. Do not assume a model available in a coding subscription is available through a production API.

Offer premium capacity through an optional add-on and/or prepaid credit loading. This supersedes the earlier blanket “never user-selectable” rule: a customer may explicitly request premium help, or consent to an agent's recommendation, within an approved per-task spending cap. Automatic managed escalation within the included budget remains a separate policy and still needs evaluator evidence. Ordinary work must remain usable without buying premium capacity.

Keep one auditable customer credit ledger, with immutable receipts recording the approved premium entitlement and spend source. Included allowance, purchased credit balance, operator inference cost and the Cloudflare prepaid gateway balance are distinct concepts. The old test build-unit pack is not a currency conversion. Before checkout launches, define the retail conversion/margin, expiry/refund treatment, add-on allowance and what happens when either allowance runs out; show an estimated range and maximum charge before a premium task. Reserve that maximum atomically, settle actual metered consumption under the disclosed tariff, and release unused holds only when the outcome is known. No automatic reload, plan upgrade or credit purchase without explicit opt-in.

### Beta activation gates

- Reviewed gateway configuration and scoped credentials; metadata-only observability by default, with private prompt/response logging and shared response caching disabled unless separately designed and consented to.
- Versioned candidate catalogue, dated rate cards, paid-provider admission, aggregate limits and approved rollback to the previous route.
- Contract tests for each enabled protocol/provider, tool outputs, token/reasoning accounting, streaming cancellation, timeouts, unknown outcomes and no hidden fallback/retry.
- Benchmarks on Whumpo tasks (acknowledgment, orchestration, edits, coding and review) measuring successful outcomes, latency and total cost—not token price alone.
- Durable premium entitlement, quote/approval, reservation/settlement and replay tests; payment integration remains deferred because no Stripe account exists.
- A small explicitly approved live canary before wider beta; no claim that the gateway or Workers AI models are provisioned from this plan alone.

## Route selection implementation — September 29, 2026

`src/inference-routing.ts` implements the deterministic **offline planner** for the gateway policy. It is not wired into live dispatch, paid admission, gateway configuration or customer billing. Every result says `dispatchReady: false`; an eligible result is a reviewable proposal, never spending authority. Muse-only runtime checks remain unchanged.

The planner accepts a trusted versioned candidate catalogue and task requirements. It filters by standard/premium tier, role, protocol, required capabilities, all possible processing regions, full input-plus-output context, maximum output, verified dated rates, matching/current benchmark suite and tested token bounds, minimum samples/success rate and p95 latency. Missing or malformed numeric evidence is rejected. Current rates reprice a bounded histogram of observed billable per-call token usage; each call rounds up using the existing integer microdollar cost function. The histogram must account for every benchmark call, including failed and repair attempts. All billable reasoning must be included in output usage, and additional per-call charges must be covered by the reviewed extra-cost bound before marking charges verified. Nonlinear/provider tool billing requires a compatible verified adapter before a candidate can be used.

Among qualifying candidates, selection minimizes observed cost per successful benchmark task using exact integer cross-products. Workers AI wins an exact cost tie; a cheaper qualifying external candidate wins otherwise. This conservative definition of “competitive” adds no unapproved percentage premium for choosing Workers AI. Benchmark results are evidence for the represented task suite, not a guarantee of future success. Rate/benchmark times are epoch milliseconds, with exclusive expiry.

A candidate must fit all three supplied operator spending bounds: task, account and platform. Premium planning additionally requires an unexpired approval matching owner, task, policy, catalogue and candidate, plus a tariff snapshot, customer spending cap and remaining customer credit balance. Retail and operator reservations are separate fields. A saved premium approval cannot upgrade standard work, and an explicit premium request cannot silently substitute a standard candidate. The retail multiplier in this planner is a **testable tariff mechanism**, not an approved public selling price; paid launch pricing is still undecided.

The selected projection contains only the candidate/provider/model identity, policy/catalogue/benchmark/rate references, token and cost bounds, owner/task, approval/tariff references and selection reason. Arbitrary catalogue metadata and credentials are excluded. It does not persist receipts or atomically reserve balances; the future runner must revalidate authoritative snapshots and commit reservations before dispatch, enforce subagent/evaluator gates, and bind the exact gateway/model/version to that reservation. No planner result bypasses the existing advanced-role gate.

Operator review command:

```sh
pnpm plan:inference tests/fixtures/inference-routing-scenario.json
```

The bundled scenario uses synthetic names, prices, timestamps and measurements. It selects the synthetic external candidate at 1,100 provider microdollars for its bounded attempt, compared with 2,100 for the synthetic Workers AI candidate. It performs no network requests and requires no API key. Supply only trusted planning data; do not put credentials in scenario files. The command limits input to 256 KiB and returns generic errors instead of echoing invalid input.

Verification: `test:inference-routing` covers cheaper external selection, Workers AI tie preference, repair costs changing the winner, no assumed cache savings, protocol/capability/region/context and rate/benchmark gates, all operator budgets, premium owner/task/policy/catalogue/expiry/candidate/cap/balance isolation, explicit tier selection, credential projection exclusion and unchanged input snapshots. `test:model-policy` preserves Muse pinning and existing escalation/concurrency rules. The CLI example and TypeScript checks pass. Durable paid reservations, gateway provisioning and real provider evaluations remain activation work.

## Durable gateway spending reservations — September 29, 2026

**Implemented and locally verified; inactive in live dispatch.** Migration `0066_gateway_spend_reservations.sql` adds independent platform, account and task operator-budget buckets, plus premium-credit and approval-cap buckets. It creates no funding rows, credits, subscriptions or provider routes. The new service in `src/gateway-spend.ts` consumes a trusted planner decision and server-resolved funding IDs. Neither these funding methods nor dispatch/settlement methods have a public endpoint. Muse's current shadow ledger remains separate and unchanged.

A single attempt insertion atomically checks and holds its operator quote against all three operator budgets. Premium attempts also hold their retail quote against both the owner's premium balance and an immutable approval's **cumulative** task cap. Approval identity includes owner, task, catalogue, policy, permitted candidates, tariff and expiry. Passing a larger in-memory balance does not override the durable rows. SQL triggers enforce owner/scope matching, exact quote arithmetic, bounded integer rates/tokens, expiry at admission/dispatch and immutable receipt identity. Financial buckets use microdollars; these are not the existing test build units.

State transitions are reserved → dispatched → settled/uncertain, with uncertain → settled after reconciliation. Only reserved attempts may be released. Dispatch and release race on the same receipt and cannot both succeed. Settlement recomputes provider and customer amounts from the frozen rate/tariff snapshot, checks token/cost ceilings, settles all linked buckets atomically and releases the unused hold. Exact replay does not spend again; changed replay conflicts. Unknown or over-bound consumption keeps its full hold and requires reconciliation rather than silently charging above approval or releasing funds. An over-bound provider invoice must be recorded and investigated by the future reconciliation service; this reservation mechanism alone does not prove a hard provider invoice cap.

The SQL arithmetic profile supports at most 10 million input/output tokens per attempt, rates up to one billion microdollars per million tokens, one billion additional microdollars per call, retail multipliers from 1× to 10×, and bucket limits up to one trillion microdollars. These are implementation safety bounds, not public plan prices or allowances. The admitted adapter must normalize all billed reasoning/tool/other usage into the verified tariff. Cache discount settlement and variable provider charges need explicit adapters before activating those provider modes; no paid provider is currently admitted.

Budget creation/funding, durable premium approval creation, payment/top-up receipts, revocation, refunds, gateway/provider attempt linkage, invoice reconciliation and retention/anonymization remain separate activation work. No funding/grant API or automatic reload is added. Receipt deletion is denied and user references restrict deletion when financial records exist; a reviewed retention/anonymization workflow is required before using these records for real customers. The existing advanced/subagent roles remain denied in these receipts until durable runner/evaluator gates are implemented.

Verification used actual disposable local D1 with all migrations: concurrent quotes competing for the same balance, independent task/account/platform exhaustion, rollback without partial holds, owner isolation, exact/changed replay, immutable receipts, expired rates, dispatch/release races, uncertain holds, over-bound usage, direct incorrect settlement denial, concurrent identical settlements, separate provider/customer debits and the cumulative premium approval cap. `test:gateway-spend`, `test:inference-routing`, `test:model-policy` and TypeScript checks pass. The existing actual-D1 `test:model-costs` regression also passed, preserving Muse pinning, chat/ack admission and shadow receipts. Migration 0066 has not been applied remotely and no platform deployment or paid inference was needed for this inactive layer.

## Unlimited standard AI under fair use — September 29, 2026 decision

The owner's latest direction supersedes fixed customer-facing standard-AI quotas for paid launch plans. Planned paid service is **unlimited site-building and maintenance assistance, subject to fair use**. It is not an unlimited general-purpose chatbot, bulk code-production/export service, or unlimited premium-model allowance. Occasional unrelated questions from light users need no intervention. Copywriting, business planning for the site, debugging, design research, accessibility and learning required to operate the user's site are legitimate supporting work.

The old per-tier $2/$5/$10/$20 internal figures become economic targets, not denial thresholds or promised allocations. Current Explore test units and Muse shadow admission remain active during owner testing; do not describe them as the launch fair-use policy. Premium model add-ons/prepaid credits and separately approved infrastructure overages remain distinct paid options. Standard assistance must not become a disguised top-up requirement once a hidden token count is reached.

### Monitor mode and company profitability

**Monitor is the default operator mode.** It records observations and internal recommendations but sends no fair-use warning, slows no request and blocks no customer action. An individual outlier can remain unrestricted indefinitely while the business is profitable. Per-tier observation thresholds still help explain costs; they do not override Monitor mode. Security, fraud, credential protection and explicitly approved premium spending caps remain separate. Existing private-preview admission rules are unchanged by this launch-policy setting.

`src/fair-use-mode.ts` evaluates an explicit operator request. It never automatically switches from Monitor to Enforce. A requested enforcement mode falls back to Monitor unless verified, fresh company-wide economics show falling absolute profit and falling margin while revenue is substantially unchanged. Missing finance integration, stale data, changed revenue or incomparable periods cannot activate enforcement.

Initial **proposed review tolerances**, to calibrate before beta: equally sized 28–31-day periods, an assessment no older than seven days, revenue within 5% of the previous period, and margin down at least five percentage points with lower absolute profit. These are policy hypotheses, not measured business economics. Company cost must include inference (including retries and operational work), hosting, domain benefits, payment fees, refunds and consistently attributed support costs; compare revenue on the same accounting basis. Do not substitute hypothetical Muse API cost for paid expense or treat uncollected subscription prices as revenue.

Even when financial eligibility is established, enforcement still requires an operator choice plus the individual evidence, review, notice and continuation gates below. An operator can always keep or return the platform to Monitor. Financial deterioration alone never establishes customer misuse. Current code reports eligibility only: `enforcementEnabled` remains false and `activeRestrictions` remains empty in every mode until the enforcement workflow is implemented. `suggestedAction` and `restrictions` are internal hypothetical recommendations, never instructions for a customer endpoint.

### Proposed starting thresholds (Monitor mode, not enforced)

Cost is standard-plan inference expense over a rolling 30 days, using verified provider rates. Exclude separately funded premium requests, platform-caused retry waste and non-user-serving operational work from customer abuse scoring; retain them in company cost accounting. Turn counts are distinct user AI requests over seven days, not acknowledgments, tool calls or subagents. A shared free provider allowance does not make the customer's measured workload disappear.

| Plan | Start internal observation | Cost/capacity review | Heavy-use review band | 7-day turns: observe / review | Rapid export-delete cycles in 7 days |
| --- | ---: | ---: | ---: | ---: | ---: |
| Starter | $3 | $6 | $10 | 100 / 250 | 3 |
| Personal | $6 | $12 | $20 | 250 / 600 | 6 |
| Business | $16 | $32 | $50 | 750 / 1,800 | 12 |
| Business Pro | $28 | $56 | $90 | 1,500 / 3,500 | 20 |

These are initial calibration hypotheses, not published customer caps, validated unit economics or final prices. Cost **or** turn volume can open observation/review. Twice the review turn count also enters the heavy-use band. At any level, cost alone means review legitimate capacity and routing efficiency—not label the customer abusive or block requests. Measure margin, false positives and genuine task completion during beta, then version changes rather than silently changing policy mid-incident.

### Evidence and graduated response

1. **Light use:** no additional purpose-classifier call or manual review triggered by this policy. Ordinary safety, fraud, credential and platform-security controls still apply at every usage level.
2. **Observation:** examine aggregate task outcomes and coarse purpose categories. Do not read every conversation or send private source/prompts to another model merely because a cost threshold was crossed. Reuse existing task metadata where possible; narrowly sample only when needed.
3. **Behavior review:** a repeated-unrelated-chat signal requires at least 20 high-confidence classifications and at least 70% unrelated requests. Uncertain classifications and supporting site work are not abuse evidence. A churn signal requires the tier's cycle count and at least 80% of recently created projects completing the pattern. These signals request contextual review; they do not automatically convict or restrict.
4. **Explain and warn:** a trusted review confirms the pattern, checks agency/client/template/migration use and false positives, and delivers a specific plain-language notice. Explain acceptable use and how to correct or appeal. A user need not acknowledge the notice to make it effective; record actual delivery, not just notice creation.
5. **Targeted restriction:** only after confirmed misuse, a delivered notice, continued behavior (initially 10 more unrelated requests or two more churn cycles), and the heavy-use band, suggest denying the offending request category. Limit unrelated chatbot prompts or new project generation as appropriate. Preserve existing-site maintenance, hosting, login, source export, backups, deletion and appeal. Never hold source code hostage, prevent account departure or shut down live sites solely for reaching an AI cost threshold.

A churn cycle means one distinct owned AI-created project was generated, its source exported, and then removed from Whumpo within 72 hours, in that order. Count immutable event IDs once, not retries, versions, downloads or re-exports. Export alone, deletion alone, abandoning a draft, testing a design or a legitimate customer migration is not abuse. Cross-account linking and sensitive profiling are not part of this design.

Use rolling windows across renewal, upgrades and account plan changes so a billing boundary cannot erase evidence. Apply the current tier's policy transparently; downgrades or a policy change must not retroactively create a violation without notice. Review restrictions when the pattern stops, support appeal and documented legitimate exceptions, and add expiry/recheck semantics before enforcement. Severe security abuse is governed by separate controls.

### Implementation and remaining activation work

`src/fair-use-policy.ts` implements the proposed thresholds and deterministic shadow assessment. `test:fair-use` verifies light-use bypass, tier sensitivity, legitimate heavy-work handling, sample/ratio checks, contextual confirmation, delivered-notice and continued-use gates, and preservation of ownership/maintenance actions. Every assessment returns `enforcementEnabled: false`. No request is blocked by this helper today.

Migration `0067_fair_use_lifecycle.sql` adds owner-scoped project lifecycle timestamps and a singleton operator mode defaulting to `monitor`. `src/fair-use-observation.ts` reads distinct completed AI turns, project creations and ordered AI-save → prepared-source-archive → project-deletion cycles. Successful archive preparation does not prove a browser saved the download. Re-exports do not increment the cycle count. Removing a version or unpublishing a site does not count as deleting a project. There is currently no customer whole-project deletion workflow; its database event is observed without inventing missing user behavior. Removed-project observations expire after 90 days, active project identity remains, and account deletion cascades the observations. No prompt or source content is stored in this ledger. Export observation failures do not prevent customers downloading their source.

Verified provider expense, purpose classification and contextual review are explicitly unavailable; Muse shadow estimates are reported separately and never used as actual expenditure. The observer reads the persisted mode but has no verified financial source, so an `enforce` setting still resolves to Monitor. There is no customer-facing mode switch or operator finance dashboard yet. `test:fair-use` exercises the policy and actual local D1 lifecycle, tenant boundaries, deduplication, retention and financial fallback. These are local implementation checks, not evidence of remote migration or production acceptance.

Before activation, implement the purpose-classification confidence contract, verified expense and aggregate financial attribution, audited operator controls, review/notice/appeal receipts, restriction expiry and endpoint-specific enforcement. Calibrate against legitimate agency and high-volume maintenance workloads. Include plain-language fair-use terms in onboarding and billing only when enforcement and support are ready; avoid advertising an already-available unlimited plan while paid subscriptions are disabled.

The new spending reservation layer remains useful for exact accounting, concurrent admission, approved premium-credit limits and platform emergency protection. Its per-account/task ceilings must not be configured from these monitoring numbers as hidden standard-AI quotas. Legitimate standard work should continue through economic review and explicit operator capacity management. Premium customer spending caps remain strict because they protect an approved purchase budget. No automatic paid upgrade or credit purchase results from fair-use monitoring.


### Monitor deployment evidence — September 29, 2026

Applied migrations 0066 (previously tested spending reservations) and 0067 (fair-use lifecycle and default mode) to the test control database. No budget funding, paid provider activation or customer restriction was enabled. Platform version `4cbca51f-ecc2-43ff-86e6-d7b7707c9325` was deployed with the existing CMS-binding-preserving deployment script and independently verified active. The persisted `fair_use_control.requested_mode` was read back as `monitor`. Live landing page returned 200 and unauthenticated source export returned 401. Authenticated lifecycle behavior was verified locally, not exercised against a real customer's projects.

Passed: `pnpm check`, `pnpm test:fair-use` (policy plus disposable actual D1), `pnpm test:exports`, `pnpm build`, and `git diff --check`. The export regression now follows the existing version-removal review contract. Financial ingestion, operator UI, customer purpose classification, review/appeal workflow and active enforcement remain unimplemented.


### Private operator monitoring report

Run `pnpm report:fair-use` from the operator checkout with the existing authenticated Wrangler account. This is a read-only report against the configured control D1 database. No browser route, customer permission or model tool exposes it. The command makes no inference calls, changes no entitlements and cannot switch enforcement on. Authentication failures produce a generic error without dumping provider responses or credentials.

The default report contains aggregate account counts by actual current-period plan, completed AI requests over seven days, project creations, ordered export/removal observations, separate 30-day Muse shadow estimates, and counts eligible for internal observation or review. It excludes account IDs, email addresses, project names, private messages and source. To inspect a known account, use `pnpm report:fair-use --account ACCOUNT_UUID`; the report still omits personal/content fields and adds that account's proposed assessment. Account discovery is deliberately outside this command.

Plan selection follows the same current-period receipt ordering as billing and does not trust the historical `billing_accounts.plan_id` cache. Explore and legacy entitlements are reported as unassessed rather than silently assigned a paid launch tier. Reading the report does not initialize billing, release reservations or grant anything. It refuses more than 1,000 accounts instead of silently presenting a truncated report; the current test platform cap is 50.

Company revenue, cost and profit remain explicitly `null` with `verified: false`. Neither subscription list prices nor shadow-cost receipts prove real finances. Missing purpose classification, verified provider expense, completed-download confirmation and the customer project-deletion workflow are visible coverage gaps. The captured timestamp bounds activity windows; this operational read is not an audited financial snapshot. Unknown accounts and invalid identifiers fail closed. The command cannot establish profitability or justify enforcement until the separate finance integration is delivered.

Verification: disposable actual-D1 tests cover aggregate and account scope, current versus expired plan receipts, multiple current grants, no billing initialization, no write queries, exact request/project totals without join multiplication, identity/content canaries, and Monitor fallback with absent financial data. This extends `pnpm test:fair-use`.


Live read-only acceptance (September 29, 2026): the operator command completed against the configured test database, resolved Monitor mode, returned no active restrictions and kept company profit unknown. Its output was saved privately to ignored `.secrets/fair-use-report.json`; no account identifiers or contents were printed. `pnpm check`, `pnpm test:fair-use` and `git diff --check` passed. This delivery requires no migration or Worker deployment and does not change customer request handling.
