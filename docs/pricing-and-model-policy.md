> October 1 current-only update: standard assistance uses one nonbillable receipt path. Historical test-unit ledgers, calendar grants, Launch/Studio and test-credit packs are removed. Billing uses verified subscription invoice intervals. Advanced dispatch remains disabled; internal Muse testing capacity remains separate. See [current billing](plan-lifecycle.md) and [standard AI accounting](standard-ai-accounting.md).

> Owner decision, September 30: standard AI stays unlimited under fair use as much as possible. Advanced models consume credits with explicit spending consent. Infrastructure capacity remains separately metered; ordinary task complexity or an internal routing choice cannot silently turn standard assistance into a paid task. Monitor remains the default. Existing private-test quotas remain separate; production billing and premium dispatch are not enabled.

> September 29 update: flexible capacity, approval-only plan changes, draft overage controls and the unified dashboard are specified in [unified-workspace-and-capacity.md](unified-workspace-and-capacity.md). Its decisions supersede the fixed storage targets below.

# Pricing and model policy — September 29, 2026

Supersedes the old Launch/Studio public proposal. Source: the owner's “AI VPS Hosting Comparison” conversation, latest price revision, and the supplied model-routing and acknowledgment notes. Their provider prices are **planning assumptions**, not verified API tariffs. This document does not enable billing or authorize purchases.

## Subscription catalogue

| Plan | Monthly USD | Annual USD | Annual domain allowances | Target projects | Target file storage | External account connections at launch |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Starter | 17 | 170 | 1 | 1 | 10 GB | Not included |
| Creator | 30 | 300 | 1 | 5 | 50 GB | Not included |
| Business | 79 | 790 | 1 | 10 | 200 GB | Included, subject to provider readiness |
| Business Pro | 139 | 1,390 | 2 | 25 | 500 GB | Included, subject to provider readiness |

Monthly prices are the owner's explicit choices. Annual prices follow the final discussion's proposed ten-month equivalent. Annual benefit: up to $20 wholesale per eligible standard registration or renewal, premium domains excluded. The quote helper shows the uncovered wholesale amount; it is not a retail invoice, transfer workflow, payment, inventory reservation or benefit redemption. No domain purchase is enabled. Renewal/transfer fulfillment, benefit ledger, customer ownership and transfer-out controls still need implementation before advertising an available benefit.

The public landing page, API and `/plans` use the same catalogue. Resource amounts are labeled launch targets. They do not override current upload, project, domain, CMS, backend or platform safety caps. Explore remains the free invite-only test. Sandbox subscriptions are implemented for owner testing; [configuration and acceptance](stripe-sandbox.md) are recorded separately. Real payments remain unavailable. Sandbox annual coverage follows exact paid service dates; domain redemption and resource/premium funds remain unavailable.

The accepted launch name is **Creator**, retaining the `personal` identifier, provider mappings and historical receipts. WH-089 now implements the Creator display name in source while preserving `personal` and historical receipts. The [feature contract](plan-feature-contract.md) records cumulative identifiers, actual readiness labels and verification; deployment is a separate checkpoint.

### Accepted external-connections decision — September 30, 2026

External account connections are a planned **Business and Business Pro** benefit; Starter and Creator do not include them. The accepted first-paid-launch set is GitHub, Cloudflare, Gmail, Google Calendar, Outlook email, Microsoft Calendar and HubSpot. GitHub covers customer authorization and reviewed source backups; Cloudflare covers customer OAuth and reviewed DNS operations. The five new adapters support explicitly requested reads and reviewed actions under the bounded contracts below. Each connector requires separate implementation, configuration and real consent/revocation acceptance; inclusion does not promise arbitrary provider support.

This changes the launch catalogue and presentation only. **There is no plan-based connection enforcement today.** The private Explore preview and current connection configuration, consent, ownership and explicit-action reviews are unchanged. GitHub setup and real provider acceptance remain open; configured Cloudflare OAuth bindings alone do not establish accepted customer consent. Real-money subscriptions remain disabled; existing sandbox subscriptions are for testing only. See the [GitHub](integrations/github-connection.md) and [Cloudflare](integrations/cloudflare-connection.md) contracts for actual availability.

Ordinary custom-domain eligibility, manual DNS instructions, annual domain benefits, downloadable source exports and owner sign-in are separate from external account connections; their existing rules remain unchanged. Whumpo-hosted infrastructure does not require the customer to connect a Cloudflare account. Plan recommendations should consider required features as well as capacity: a customer who needs an external account connection needs at least Business under this launch proposal.

Before paid launch, add authoritative server entitlement checks at connection start, callback activation and provider capability use; cover background/in-flight work, renewal expiry and downgrade behavior. Define how customers resolve pending external operations and preserve access to status, disconnect/revocation and recovery after eligibility ends. Verify provider setup and real consent/revocation, explain any provider charges, and reconcile catalogue/UI/Chat with those accepted journeys. This policy update neither implements those gates nor authorizes provider activation, DNS changes, repository writes or purchases.

### Public pricing panel with sandbox trials and Enterprise contact — October 2, 2026

The landing page has inline Monthly/Annual and Personal/Business switches outside the Stripe embed. They select one of four tables, each with a single interval, so no second billing selector appears inside Stripe. Personal shows Starter and Creator with seven-day, payment-method-required sandbox trials. Both Business tables show Business, Business Pro and a contact-only Enterprise option. Enterprise uses Stripe's custom CTA, with no price or checkout; Contact us opens `mailto:enterprise@whumpo.com`, the owner-approved destination. The standalone Try it and Enterprise cards are removed. Changing audience preserves the interval, and annual domain wording appears only for annual billing. Enterprise proposes SSO integrations and custom integrations scoped to the customer; these are not provisioned entitlements.

Stripe hosts the sandbox payment-method collection and trial setup. Whumpo trial admission/expiry, eligibility, subscription conversion and lifecycle reconciliation for these anonymous tables are not connected, so test checkout grants no trial or paid access. These must be implemented and accepted before a real trial launch. The Enterprise email action opens the visitor's composer; it does not send a message or confirm delivery. The existing free, invite-only Explore preview remains the working signup path. See [homepage Stripe pricing tables](stripe-pricing-tables.md) for configuration and verification evidence.

Verified sandbox invoice service intervals recognize the four current tiers. The current-schema reset deletes Launch/Studio, calendar grants and cached account plans. Publication-slot guards read active invoice coverage. Unknown plan identities fail explicitly.

Standard AI is unlimited fair use, with no customer unit allowance or test-credit ledger. Future advanced-model and resource funding require their own calibrated conversion and explicit consent.

BYOC/BYOI is contact-based. The agent may help draft requirements; delivery to a sales/support queue is not connected and it cannot claim a request was sent. Existing optional GitHub source-backup and Cloudflare domain-DNS authorizations do not provision customer-owned infrastructure. Managed resource add-ons require a future exact cost review and approval; no automatic paid upgrade is enabled.

## Accepted tier roadmap and paid-launch gate — September 30, 2026

**Owner-approved roadmap requirements; feature implementation and customer acceptance remain planned.** This supersedes the earlier additive suggestions and staged-rollout recommendation. The complete set below, including all seven connections, must pass WH-104 before WH-047/049 can approve the first paid launch. The free, explicitly scoped WH-048 beta can proceed independently. Stripe sandbox setup was separately resumed and accepted on October 1; real-money activation and CMS testing remain gated. Their original MVP requirements remain.

Prices remain Starter **$17/$170**, Creator **$30/$300**, Business **$79/$790**, Business Pro **$139/$1,390** monthly/annual. The Creator rename is display-only: keep `personal` in stored preferences, API identifiers, grants and historical receipts, and do not relabel historical evidence. Higher tiers inherit lower-tier capabilities. WH-089 implements the [display rollout and feature catalogue](plan-feature-contract.md); WH-090 implements shared server enforcement. No subscription or feature is activated by this roadmap update.

### Cumulative launch matrix

| Plan | Required launch experience | Delivery and current boundary |
| --- | --- | --- |
| **Starter — one useful site or small app** | Complete core editing, supported forms/apps, publishing, basic traffic/health information, security, recovery, export and standard owner AI under fair use. | Existing implementations and WH-026–029/035/037 provide the foundation; their complete customer acceptance remains required. Core security, exact reviews, basic recovery and supported export remain common across tiers. |
| **Creator — a reusable personal brand** | Starter plus versioned brand kits, saved supported page sections, shared styles, and private preview feedback/comments through expiring, revocable accountless guest links. | WH-091/092, using WH-066/070. Kits and shared styles produce explicit per-project previews/apply reviews and recoverable versions; no silent changes to published sites. Guest feedback confers no workspace membership, edit, publication or spending authority. |
| **Business — connected business operations** | Creator plus the seven external connections; lead stages, notes and due dates; follow-up reminders; configured form-to-record-to-notification workflows; conversion summaries. | WH-031/032/056/093–100, building on WH-036/037/067–069. Basic contact handling stays part of the common foundation; the higher-tier additions are lead management and configured workflows. Business can notify approved staff destinations without granting collaborative workspace access. |
| **Business Pro — a team and project portfolio** | Business plus workspace memberships/roles and approval workflows, private staging and exact release promotion, portfolio reports, and reviewed brand/content changes across selected projects. | Promote WH-054 to prelaunch commercial work; deliver WH-101–103 using WH-066/075/076. Shared editing and release authority are server-checked; every bulk candidate has a per-project diff, outcome and recovery path. |

Existing contacts expire after 30 days; new lead records need an explicit lifecycle contract rather than silently inheriting permanent CRM retention. Existing traffic measures best-effort successful HTML requests, including repeats/bots/checks. WH-095 must define accepted-submission and lead-stage outcomes, periods and denominators; it must not rename those counts as unique visitors or infer individual attribution. Staging uses isolated synthetic data and suppresses real external effects; dedicated infrastructure is not an included promise.

### Feature entitlement and loss of eligibility

WH-089 defines stable feature identifiers and the cumulative catalogue. WH-090 exposes one shared server feature-entitlement result for the UI, Chat, direct APIs and background jobs. Distinguish **plan inclusion**, **provider configuration/consent**, and **actual feature readiness**; neither a pricing card nor an OAuth token grants all three. Planned `launchFeatures` packaging metadata must not become an authorization check.

Resolve inclusion from authoritative grants/current subscription state, not `billing_accounts.plan_id`, client-supplied flags or model output. Extend the existing WH-042 sandbox subscription/coverage resolver, preserving paid service intervals and historical receipts; use controlled preview grants for unavailable features. WH-090 must not create a parallel subscription truth. Check current actor, tenant, feature and resource authority when admitting work and again at OAuth activation, review confirmation and dispatch. Numbered migrations preserve immutable receipts and revision/ownership checks.

On downgrade, renewal expiry or revocation, stop newly ineligible actions and unsent automation. Retain owner access to saved history, supported export, disconnect/revocation and narrowly scoped reconciliation of uncertain effects. Do not delete customer data, silently withdraw published sites, resend an uncertain operation or misreport an existing provider credential as disconnected merely because its plan is ineligible. Reconciliation cannot authorize a new mutation. The exact grace/retention/seat/usage contract must be calibrated and verified before commercial publication; recommendations must not propose a cheaper tier that lacks required features.

### Bounded connection contracts

All seven connections require Business or Business Pro. The five new adapters reuse WH-056's encrypted credential, consent, current entitlement, request-bound lookup, review and durable-operation interfaces. The accounts remain customer-authorized; operator logins and platform delivery credentials never substitute for that consent.

| Adapter | Initial supported behavior | Scope and acceptance boundary |
| --- | --- | --- |
| **Gmail — WH-096** | Explicit bounded searches and selected-message/body reads; exact reviewed send/reply. | Plan for `gmail.readonly` plus `gmail.send`, with required identity/refresh access only. No general mailbox modification/deletion, bulk campaigns, background polling or indexing. Restricted-scope verification and applicable independent security assessment are launch prerequisites. |
| **Google Calendar — WH-097** | Select owned calendars, read requested bounded date ranges, and review exact event creation/update/deletion. | Plan for calendar-list read and owned-event scopes, not calendar administration or arbitrary shared calendars. App-created-calendar-only scope is insufficient for existing-calendar lookups. Review timezones, recurrence, attendee notifications and cancellation effects. |
| **Outlook email — WH-098** | Explicit bounded searches and selected-message/body reads; exact reviewed send/reply. | Delegated `Mail.Read` and `Mail.Send`, with required identity/refresh access only; no application-wide/shared-mailbox access or general mailbox modification/deletion. Test personal and work/school account eligibility and tenant-consent denial. |
| **Microsoft Calendar — WH-099** | Read requested bounded ranges and review exact event changes within selected user calendars. | Delegated `Calendars.ReadWrite`; enforce selected resources inside Whumpo because provider consent is broader. No tenant-wide/shared-calendar synchronization. Disclose invitations, recurrence and other external effects. |
| **HubSpot — WH-100** | Explicit contact search/read, selected Whumpo-lead/contact matching, and reviewed creation or selected-field updates. | Contacts read/write only; preserve unmapped fields and surface conflicts before linking/updating. No deal pipelines, marketing workflows, general CRM imports or continuous synchronization. Validate installation/distribution eligibility. |

Reads occur only for the explicit bounded owner request. OAuth consent alone does not authorize copying the mailbox, calendar or CRM into Chat history or model context. Obtain in-context consent for the requested use/sharing, minimize the data and apply the lifecycle contract. Retrieved content is untrusted and cannot authorize more tools. Credentials never enter model context. Real connected-account content must use the accepted production privacy route from WH-020/021 and must not enter the current contributor/training-enabled test model; synthetic fixtures allow independent implementation before that route is accepted.

Writes retain exact resource/content/recipient reviews, immutable operation identities and current-authority checks. A provider's accepted response is not proof of delivered email. A timeout is not proof that nothing happened: recover targeted evidence or retain uncertainty, never blindly resend. Approved deterministic recipes may invoke narrowly configured actions after their rule, destination, template and limits are reviewed. Incoming messages, visitor events and schedules never invoke Whumpo's maintainer AI. No continuous sync, unattended read-and-reply loop or webhook-driven maintainer call is included.

WH-036 remains the separate platform transactional/contact-delivery foundation; customer Gmail/Outlook OAuth does not replace it. Keep that dependency direction so platform notifications and the connector foundation do not depend on each other cyclically.

### Provider readiness, costs and sequencing

Official provider requirements reviewed September 30, 2026: Gmail's read scope is restricted and its send scope sensitive. Server-mediated restricted-data handling requires the applicable verification/security assessment; document any verified exception, assessment scope, initial/recurring quote and renewal owner. The Google data-use contract must permit the exact requested processing and prohibit general model training with this connected data. References: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [restricted-scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [Workspace data policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy), [Calendar scopes](https://developers.google.com/workspace/calendar/api/auth).

Microsoft acceptance includes delegated permissions, publisher/tenant consent and account-type restrictions; HubSpot acceptance includes authorized installation, distribution capacity and contact scopes. References: [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference), [publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview), [HubSpot OAuth](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/working-with-oauth). Reverify current terms, quotas, customer licenses, app distribution limits and prices at activation; none are assumed unlimited or free. Provider registration, public approval, real consenting test accounts and concrete cost review are external acceptance blockers, not reasons to prevent isolated implementation. Split each L provider packet into contract, implementation and separately blocked live-acceptance children; keep the parent open until all evidence is accepted.

The execution order is tier contract/entitlements and existing composition foundations, then Creator tools, Business workflows and connector adapters, then Pro collaboration/release/portfolio tooling. Independent slices can proceed together. This is development sequencing, not staged paid availability: **every selected feature/provider must pass before the first paid launch**. WH-054/056 no longer wait for WH-049; WH-104 feeds WH-047/049. WH-042 sandbox implementation remains independent of paid activation. Provider approval delays therefore hold paid launch, while the existing bounded free beta remains independent.

WH-022 instruments the new workloads; WH-023's final two-period validation includes implemented creator, delivery, lookup/action, lead, collaboration, staging and bulk/reporting costs, plus support, provider minimums and assessment renewals. Measurement can begin early, but the current smaller workload cannot establish the expanded launch economics. No seats, message volumes, retention guarantees, support response times or recurring add-on prices are promised here. Calibrate those through WH-009/023/041 before WH-047 publishes commercial terms. Prices remain proposals until those financial gates pass; no price changes, services or purchases are authorized by this roadmap.

Roadmap delivery: [WH-089–104 and promoted foundations](roadmap/README.md#accepted-tier-expansion--creator-business-and-business-pro), [canonical task packets](roadmap/backlog.md), and [execution rules](roadmap/execution.md). Configure maintained capabilities first and preserve the [composition architecture](roadmap/composition-architecture.md).

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

Released code commit `7e8fd4a` to the existing `tellumo-platform` Worker, version `4a07de28-dd68-49c2-8b9a-db418ed5d3ce`. Production migrations 0050, 0052 and 0053 applied; unfinished local activation migration 0051 and its routes were excluded. No new paid service, payment account or domain purchase was enabled.

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

- [Customer outcome benchmarks and privacy](customer-benchmarks.md) defines the reproducible offline suite, complete task-cost categories, real-provider scoring protocol and Muse Contributor's ineligibility for confidential beta content. Synthetic transport passes are not real-model quality evidence.
- Reviewed gateway configuration and scoped credentials; metadata-only observability by default, with private prompt/response logging and shared response caching disabled unless separately designed and consented to.
- Versioned candidate catalogue, dated rate cards, paid-provider admission, aggregate limits and approved rollback to the previous route.
- Contract tests for each enabled protocol/provider, tool outputs, token/reasoning accounting, streaming cancellation, timeouts, unknown outcomes and no hidden fallback/retry.
- Benchmarks on Whumpo tasks (acknowledgment, orchestration, edits, coding and review) measuring successful outcomes, latency and total cost—not token price alone.
- Durable premium entitlement, quote/approval, reservation/settlement and replay tests; premium funding remains unimplemented; existing subscription sandbox evidence does not grant premium funds.
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

Plan selection follows current paid invoice coverage. Explore is reported as unassessed; retired plans cannot be admitted or silently assigned a paid launch tier. Reading the report does not initialize billing, release reservations or grant anything. It refuses more than 1,000 accounts instead of silently presenting a truncated report; the current test platform cap is 50.

Company revenue, cost and profit remain explicitly `null` with `verified: false`. Neither subscription list prices nor shadow-cost receipts prove real finances. Missing purpose classification, verified provider expense, completed-download confirmation and the customer project-deletion workflow are visible coverage gaps. The captured timestamp bounds activity windows; this operational read is not an audited financial snapshot. Unknown accounts and invalid identifiers fail closed. The command cannot establish profitability or justify enforcement until the separate finance integration is delivered.

Verification: disposable actual-D1 tests cover aggregate and account scope, current versus expired plan receipts, multiple current grants, no billing initialization, no write queries, exact request/project totals without join multiplication, identity/content canaries, and Monitor fallback with absent financial data. This extends `pnpm test:fair-use`.


Live read-only acceptance (September 29, 2026): the operator command completed against the configured test database, resolved Monitor mode, returned no active restrictions and kept company profit unknown. Its output was saved privately to ignored `.secrets/fair-use-report.json`; no account identifiers or contents were printed. `pnpm check`, `pnpm test:fair-use` and `git diff --check` passed. This delivery requires no migration or Worker deployment and does not change customer request handling.

## Shared resource pool proposal — September 30, 2026

See [shared capacity economics](resource-pool-economics.md) for the versioned offline calculator, dated provider sources, workload examples and margin/rollover stress cases. Proposed allowances are 1,000 / 2,500 / 7,500 / 14,000 Whumpo Units at the existing prices, covering total variable consumption. These are not current test-unit grants or a live dollar wallet. The owner resolved the policy: standard AI has zero customer-unit debits while its provider cost remains tracked internally; advanced models consume approved credits. The updated calculator separates unmetered AI expense and includes $1/$5/$20 standard-AI stress cases. No billing, enforcement or public allowance promise changes.


The non-billable standard-AI receipt foundation is documented in [standard AI accounting](standard-ai-accounting.md). It does not yet replace the active legacy test-unit Chat path.

## Roadmap alignment — October 1, 2026

Sandbox/ledger implementation (WH-042/043) can proceed after shared entitlement and metering contracts without waiting for two completed finance periods. WH-041 still approves terms for each commercial behavior and WH-023 still supplies final cost evidence before WH-047/049 activation. Sandbox transactions never count as revenue. Before revenue exists, price-based revenue and margin are explicitly forecasts; measured cost periods cannot establish actual operating profit. Existing standard assistance remains unlimited fair use with zero customer-unit debits. [Cross-feature sequence](roadmap/alignment.md).
