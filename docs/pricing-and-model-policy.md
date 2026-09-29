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
4. **Advanced subagent:** future evaluator-approved escalation after normal work fails; never user-selectable.

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

Released code commit `7e8fd4a` to the existing `tellumo-platform` Worker, version `4a07de28-dd68-49c2-8b9a-db418ed5d3ce`. Production migrations 0050, 0052 and 0053 applied; unfinished local activation migration 0051 and its routes were excluded. No new paid service, payment account or domain purchase was enabled.

Live checks verified health, the four monthly/annual catalogue prices, disabled checkout/subscriptions/domain redemption, anonymous ACK access returning 401, pricing HTML and the published 700 ms / 1,000 ms timing constants. The exact release checkout passed type checking and model-cost/ACK integration tests against local D1. A populated SQLite migration check separately preserved historical receipts, the billing ledger, usage balances and foreign-key integrity. Browser inspection confirmed the pricing cards render in Whumpo's theme.
