# Whumpo product and delivery roadmap

**Aligned October 2, 2026; 122 current tasks include explicit privacy and feature-admission handoffs.** The [alignment review](alignment.md) records corrected dependencies, shared contract ownership, current issue evidence and remaining launch gates. Stable task IDs and phase labels are preserved; phase and task numbers are not build order. This is a delivery plan, not a release or provider authorization.

Whumpo should first become a dependable way for an invited customer to create, improve, publish and recover a useful website or bounded application. The next investment should turn its substantial foundations into operated customer journeys. Broader Cloudflare capabilities follow demonstrated demand and measured economics.

## Start here

- [GitHub execution hub](https://github.com/zemdregon/whumpo/issues/2): task issues, claims, progress and handoffs. The complete longer-term plan remains in the backlog below.
- [Logical resources and workload placement](../workload-placement.md): WH-071 interface, lifecycle/export and conditional hosting decision.
- [Shared modules](../shared-modules.md): WH-067 contract, existing-service mapping and WH-123–130 slices (planned).
- [Architecture and sequencing alignment](alignment.md): shared contracts, corrected dependency paths, current build order and persistent graph checks.
- [Full backlog](backlog.md): every task, dependency, acceptance criterion and verification boundary.
- [Chat as the primary workspace](chat-first-experience.md): interactive forms, agent-managed dashboards/views, continuity and WH-105–112 delivery packets.
- [Low-friction identity and data protection](identity-and-data-protection.md): passkey-only workspace access, two-key signup, printable recovery and WH-113–118 protection packets.
- [Accepted tier expansion](#accepted-tier-expansion--creator-business-and-business-pro): Creator naming, cumulative benefits, seven connections and the full-set paid-launch gate.
- [Canonical task data](backlog.json): stable `WH-001` IDs for agents and automation; generated Markdown is never edited directly.
- [Agent execution guide](execution.md): selection, coordination, implementation, evidence and handoff.
- [Product/architecture review](review.md): strengths, current limits and source evidence.
- [Tooling research and decision](tooling-decision.md): why Git plus GitHub Issues fits now, and when Projects or Linear would help.

Run from the repository root:

```sh
node tools/roadmap.mjs validate
node tools/roadmap.mjs alignment
node tools/roadmap.mjs next
node tools/roadmap.mjs show WH-001
```

`next` shows **planning candidates**, not live availability. Read the mapped GitHub issue and dependency evidence before claiming work. GitHub Issues owns current execution state; JSON owns the specification, sequencing and readiness. There is no automatic deployment, issue synchronization or external call in this tool.

## Product direction and boundaries

The initial focus is US-based individuals and small businesses who need a useful site, a contact flow, or a small authenticated application without managing infrastructure. This is a planning hypothesis to validate through the beta, not an established customer segment or evidence of product-market fit. Prioritize the static/text website journey first, then approved photo sites and a small application catalog. CMS is a separately gated lane whose testing the owner has paused.

Preserve the existing product choices: Chat-first workspace, guided first project, private drafts, exact human publication/activation reviews, retained versions and recovery. The accepted October 1 identity amendment advances current passkey-first identity to planned passkey-only workspace sign-in with two-key signup and restricted recovery. Preserve private R2, separate platform/site/visitor/runtime Workers, bounded QuickJS execution, tenant ownership and immutable receipts. Models may prepare an action; they cannot grant authority to execute it.

Prefer **low user friction with strong default protection** across product decisions. Automate safeguards, preserve ordinary sessions and offer explanations on demand. Extra steps must protect a concrete boundary; tenant isolation, content-safety controls, sensitive-action authentication and consequential-action reviews remain required. The [identity and data protection contract](identity-and-data-protection.md) applies this principle to enrollment, recovery and encryption while preserving necessary authorized processing.

The accepted October 1 direction makes **Chat the primary surface for routine work**, with little required navigation elsewhere. The agent presents predesigned or bounded custom forms to gather information and controls the composition of supporting dashboards/custom views. Customers can correct, dismiss and resume these elements. Essential account/security/support/recovery paths remain directly reachable. See the [experience contract](chat-first-experience.md). WH-106 now has [source/local storage acceptance](../chat-interactions.md#wh-106-storage-acceptance-audit--october-2-2026-utc), with connected maintained website/project forms. The [WH-107 renderer audit](../chat-renderer-acceptance.md) accepts the shared renderer; maintained forms are deployed with bounded [live test evidence](../chat-test-release.md). The [WH-108 original-scope audit](../chat-composition-acceptance.md) accepts bounded custom composition, corrections and task continuation; the [WH-109 original-scope audit](../workspace-views-acceptance.md) accepts shared agent-managed views with a coordinated deployed test cutover. The [WH-110 original-scope audit](../chat-routine-acceptance.md) accepts routine Chat adapters and recovery. The [WH-024 original-scope audit](../owner-usability-audit.md#original-scope-completion-map) accepts supported-owner usability/accessibility with explicit human/device gaps. [WH-111 daily-workspace continuity and navigation simplification](../chat-workspace-continuity.md) is now in progress; WH-112 retains whole-owner experience acceptance.

Standard AI remains unlimited under fair use, with zero customer-unit debits for standard assistance. Advanced models require explicit funded approval. Financial Monitor remains the default; content safety always applies. Current paid-tier prices and resource allowances remain proposals until commercial fulfillment and economics are accepted. The Creator/Business/Business Pro feature matrix and all seven selected connections are required before first paid launch; their accepted scope does not imply delivered features. No proposed feature inherits spending authorization from the existing Workers Paid subscription.

This plan does **not** silently narrow the original [MVP contract](../mvp.md). A bounded beta can omit disabled capabilities with an explicit scope decision. Claiming the full MVP still requires the contract's domain purchase, paid lifecycle, optional account integrations and complete verification; WH-049 records that gate. Any permanent scope removal needs an owner amendment.

## Delivery sequence

Phases describe outcomes, not strict serialized teams or calendar promises. Dependencies in the backlog are the actual ordering constraints. Follow the cross-phase sequence in [alignment.md](alignment.md); F5 foundations are early inputs to F2/F3, not a post-launch rewrite. Independent work can proceed in parallel; a phase is not complete because one of its tasks is done.

| Phase | Outcome and principal work | Exit evidence |
| --- | --- | --- |
| **F0 — Reliable delivery foundation** | Current capability inventory; focused checks; consolidated authorization review; multi-Worker release/recovery protocol; operational health; job orchestration decision. Build on the source/build guard already committed. | Current source/configuration/acceptance matrix; reproducible local profiles; review findings triaged; release and job-failure procedures demonstrated. |
| **F1 — Safe customer beta** | Real operated safety, privacy, passkey-only workspace identity with two-key signup and printable recovery, transparent data protection, retention/export/closure, restore-aware deletion, incident response and measured capacity. | WH-048: supported paths accepted against one candidate release, WH-005 identity and WH-117 protection evidence, external prerequisites fulfilled, named support ownership, recoverable failures and approved cohort/data scope. |
| **F2 — Useful websites and applications** | Primary Chat experience with interactive forms and agent-managed views; better layouts and precise edits; photo workflow; typed app starters; maintenance UX; support; analytics; accepted Cloudflare/GitHub/custom-domain connections; CMS only after resumption. | WH-112 owner-experience acceptance plus evaluated useful outcomes, first-publication funnel, repeat usage and support data; complete journeys for each advertised capability. Disabled integration lanes stay explicit. |
| **F3 — Commercial MVP** | Production inference/privacy; expanded resource economics and two complete cost periods; payment/domain/premium fulfillment; cumulative tier entitlements, seven connections, Pro collaboration and portfolio/release tools. | WH-104 full-tier acceptance feeds WH-047/049 alongside the original contract, verified economics and funded fulfillment. Stripe sandbox is deployed and accepted within its recorded scope; real-money activation remains gated. |
| **F4 — Measured expansion** | Proven bottleneck fixes, bulk migration, search and advanced hosting beyond the accepted launch set. Required collaboration and selected connectors move to F3. | Each promoted idea has demand, quality, cost, isolation, lifecycle and operations evidence. No date commitment before discovery. |
| **F5 — Configuration and shared capabilities** | Compose maintained capabilities, generate missing custom behavior and match execution/data placement to workload needs. See the [accepted architecture](composition-architecture.md). | WH-080: isolated composition pilot with useful owner changes, measured costs and zero visitor maintainer calls; live media/provider/customer acceptance remains separate. |
| **F6 — Native Android owner experience** | Separate concurrent lane: Kotlin/Compose owner app with Chat, projects/reviews, photos/sharing and push. See the [Android contract](../android-app.md). | WH-087: signed private distribution, supported physical devices, configured identity/FCM, accepted media safety, support and release recovery; customer admission also requires WH-048. |

The critical beta path is **safety coverage and provider/operator readiness → private dispatch and complete gates → safety acceptance**, alongside **retention decisions → restricted preservation → closure → restore reconciliation**, **device identity acceptance**, and **release/incident/load evidence**. Missing provider access cannot be replaced with a mock and called complete. Commercial work has an unavoidable elapsed-time dependency on two complete measured finance periods.

## Accepted tier expansion — Creator, Business and Business Pro

**Owner-approved September 30, 2026; implementation and activation remain planned.** This extension added **WH-089–104**; the October 1 Chat extension brought the backlog to 112 tasks, and the identity/data-protection amendment below brings it to **118 tasks in seven existing phases**. The [pricing contract](../pricing-and-model-policy.md#accepted-tier-roadmap-and-paid-launch-gate--september-30-2026) defines the full feature set, connection scopes, loss-of-eligibility behavior and external acceptance gates. This amendment supersedes the earlier suggestion to release one feature per tier in stages.

| Tier | Cumulative first-paid-launch requirement |
| --- | --- |
| **Starter — $17/month or $170/year** | Core editing, supported forms/apps, publishing, basic traffic/health, security, recovery, supported export and standard owner assistance. |
| **Creator — $30/month or $300/year** | Starter plus versioned brand kits, reusable sections/shared styles and private preview comments through expiring, revocable accountless guest links. |
| **Business — $79/month or $790/year** | Creator plus external connections, lead stages/notes/due dates, follow-up reminders, configured form/record/notification workflows and conversion summaries. |
| **Business Pro — $139/month or $1,390/year** | Business plus team memberships/roles/approvals, private staging and release promotion, portfolio reports and reviewed changes across selected projects. |

Creator is the accepted display name for Personal; keep the `personal` identifier and historical receipts/evidence. WH-089 owns the code/UI/Chat name rollout, which this documentation update does not complete. Prices remain unchanged. Security, basic recovery, supported exports and standard AI under fair use remain common. Basic traffic stays request-count telemetry; conversion reporting cannot invent unique visitors or individual attribution.

The first-paid-launch connection set is **GitHub, Cloudflare, Gmail, Google Calendar, Outlook email, Microsoft Calendar and HubSpot**. All require Business or Business Pro. New email/calendar/CRM adapters provide explicit bounded owner-request reads and exact reviewed actions, not continuous synchronization. Accountless feedback guests are not workspace members; approved Business notification recipients do not receive Pro collaboration privileges.

### Packets and development sequence

| Packets | Phase | Deliverable and principal dependencies |
| --- | --- | --- |
| **WH-089 / WH-090** | F3 | Planning-ready tier/name contract, then shared authoritative feature enforcement. WH-090 depends on WH-089/004/113 and extends existing sandbox coverage; no real-payment activation required. |
| **WH-091** | F5 | Creator brand/section library using WH-066/070, lifecycle and safety contracts; reviewed per-project application. |
| **WH-092** | F2 | Version-bound guest preview links/comments using WH-066 and authorization/lifecycle/safety contracts. |
| **WH-093 / WH-095** | F2 | Lead records/stages on WH-067, then honest submission/stage reporting on WH-025/037. |
| **WH-094** | F5 | Deterministic follow-up recipes using lead records and WH-068/069; reuse the existing job architecture. |
| **WH-096–100** | F3 | Gmail, Google Calendar, Outlook mail, Microsoft Calendar and HubSpot adapters over promoted WH-056 and WH-020; HubSpot also depends on the lead pipeline. |
| **WH-101–103** | F3 | Pro staging/promotion, portfolio reporting and reviewed bulk changes, using promoted WH-054 plus the compiler, recovery, reporting, bounded work and module-version foundations. |
| **WH-104** | F3 | Complete tier/provider acceptance against one candidate release, including WH-042 sandbox lifecycle and WH-021 production privacy. Required before WH-047/049. |

All new tasks are P1; WH-089 is planning-ready, the remaining packets planned. Provider implementation can begin with synthetic fixtures when its dependencies are ready. Each large packet must split into contract, implementation and connected acceptance children; provider children additionally record external registration/consent/privacy/cost blockers. WH-089 now has catalogue/local-acceptance evidence in issue #44; the remaining extension packets are unclaimed at this checkpoint and do not claim completed features.

Development can proceed in independent slices, but **every selected feature and provider is required before the first paid launch**. Preserve these dependency directions:

- Promote **WH-054** and **WH-056** from deferred F4 work to F3/P1/planned. Neither depends on WH-049. Collaboration uses WH-004/009/090/115; connector foundations use WH-004/009/052/090/105. Existing Cloudflare/GitHub final acceptance follows WH-056. Provider implementations remain separate children/packets, not prerequisites of the common connector foundation.
- Keep **WH-036/037/067–070** as the delivery, analytics, maintained module, notification, rule and presentation foundations. Platform transactional delivery remains independent of customer mailbox OAuth. Guest links do not require team memberships.
- Extend **WH-009** for new data classes, **WH-022** for expanded usage/cost events and **WH-023** for two complete periods representative of implemented tier workloads. Measurement can begin early, but older smaller workloads cannot establish expanded launch economics.
- Extend **WH-031/032** with Business eligibility and loss-of-eligibility acceptance. Their existing provider consent blockers remain.
- Integrate WH-090 with **WH-042** verified lifecycle events without waiting for WH-104/049 to implement/test sandbox fulfillment. First paid activation waits for WH-104/047/049 and separate authorization.
- Keep **WH-048** independent for the approved bounded free beta, and preserve the Android lane, real-money gate and CMS testing deferral. Original MVP gates still apply; this extension does not remove them.

### Acceptance and current evidence

The shared feature result must separate plan inclusion, provider configuration/consent and actual readiness. Recheck current actor/project/feature authority on direct API/Chat/job admission, OAuth activation, review confirmation and dispatch. Stop newly ineligible actions and unsent work while retaining owner history/export/disconnect and narrow uncertain-effect reconciliation; no automatic customer-data deletion or withdrawal of published sites.

WH-104 covers inheritance/lower-tier bypasses, guest revocation and private assets, duplicate/stale lead operations, missed reminders and uncertain sends, membership loss and approvals, staging isolation, partial bulk outcomes/recovery, accessible desktop/mobile journeys and real consent/action/revocation evidence. Visitor/service/rule execution must produce zero maintainer requests. Real connected-account data cannot enter the contributor/training-enabled test model; accepted privacy and in-context data-use controls are prerequisites.

Google restricted-scope verification/security assessment and its initial/recurring cost review, Microsoft publisher/tenant consent, HubSpot distribution eligibility, real consenting accounts and current provider quotas/prices are external acceptance gates. Details and official dated references are in the [pricing contract](../pricing-and-model-policy.md#provider-readiness-costs-and-sequencing). A configured binding or local mock does not satisfy them; provider delays hold paid launch under this full-set decision.

October 1 live GitHub reconciliation confirmed WH-064/065 and WH-066 parent [#14](https://github.com/zemdregon/whumpo/issues/14), including children #15–17, closed as completed for the initial supported compiler scope. Reuse that implementation; general records/access/files and notifications/rules remain WH-067–069. [Alignment evidence](alignment.md) preserves the distinction.

## Accepted primary Chat experience — October 1, 2026

**WH-105–112, P1/F2; implementation remains planned.** Build on existing natural-language Chat, typed server reviews, request readback and revisioned agent layouts. The [experience contract](chat-first-experience.md) defines interaction state, privacy, accessibility, native compatibility, metrics and the boundary between collecting information and authorizing an effect.

| Order | Packet | Outcome |
| --- | --- | --- |
| Contract first | WH-105 | Supported journeys, versioned interactive-element/answer/binding contract and native fallback. Planning-ready. |
| Durable foundation | WH-106 | Persisted definitions, draft/submitted answers, exact replay and scoped action handoff. Uses WH-004/009/116. |
| First complete slice | WH-107 | Accessible renderer and predesigned forms; content-change brief → private preview → existing review → receipt. |
| Parallel extensions | WH-108 / WH-109 / WH-110 | Bounded custom forms and task context; agent-managed dashboards/views; routine workflow adapters using existing handlers. |
| Workspace simplification | WH-111 | Chat-centered navigation, reload continuity and direct recovery during inference outages. |
| Acceptance | WH-112 | Connected journeys, accessibility, model quality, measured required navigation and consenting-customer evidence. Required by WH-104/049. |

Custom forms compose trusted components and registered capability bindings; they do not run generated code in the owner workspace. Inline forms are the default, with attached dialogs/sheets for longer interactions. The agent manages presentation, while the customer retains correction, dismissal and exact approval authority. View refreshes and standard form persistence need no inference. Keep essential direct controls available when the model is unavailable.

Start WH-105 after the WH-113 identity and WH-089 feature contracts; preserve P0 safety/lifecycle priorities. WH-110 can migrate template-based journeys while custom composition and richer views are developed. Simplify navigation only after replacements and outage fallbacks pass. Reuse WH-065 and the existing compiler/domain handlers without duplicating WH-066/067 visitor forms or WH-070 customer-app UI. Extend WH-009/025/058 for interaction lifecycle, measurements and quality. WH-081 adopts the shared contract; WH-084 uses WH-106 for its admitted native subset. Android foundations do not wait for the web renderer.

WH-048 remains an independent bounded free-beta gate; WH-049 additionally requires WH-112 before full commercial acceptance. Tier/provider requirements, real-money activation and CMS testing gates stay intact. New packets have no issue/owner claim. The October 1 alignment refreshed live GitHub state; see [the reconciliation](alignment.md). Refresh again before implementation.

## Accepted identity and data protection — October 1, 2026

**WH-113–118; implementation and activation remain planned.** The [accepted contract](identity-and-data-protection.md) applies low user friction with strong default protection to workspace owners and future members. Ordinary sign-in becomes passkey-only; signup needs two distinct verified credentials and one recovery-kit save acknowledgment. Recommend independent storage, explain passkeys on demand and support text download plus Print / Save as PDF without requiring a purchase or printer. Keep visitor-app identity separate.

Recovery-key possession opens only restricted replacement enrollment. Lost-all-keys recovery requires two replacement passkeys, a saved rotated kit and fresh passkey verification before workspace access, with prior-session/affected-key revocation and safe lost-response handling. Allow emergency compromised-key revocation below two. Replace the old policy in one reviewed test cutover after enrollment/recovery are ready; reset obsolete test identities and verify fresh access without a coexistence layer. Account recovery does not promise recovery of future client-encrypted content.

| Packets | Priority / phase | Delivery and ordering |
| --- | --- | --- |
| WH-113 | P0 / F1; ready | [Protocol decision delivered](../workspace-identity.md), tracked in [#42](https://github.com/zemdregon/whumpo/issues/42); implementation/activation remain separate. |
| WH-114 / WH-115 | P0 / F1; planned | Passkey-only/two-key enrollment after WH-113/004, then recovery-kit download/print and restricted replacement flow. |
| WH-116 / WH-117 | P1 / F1; planned | Classify data/readers/key custody after WH-113/009/020, then justified transparent protection after WH-116/004. |
| WH-118 | P2 / F4; planned | Evaluate passkey-backed encryption after WH-115/116 against compatibility, normal-sign-in, content-recovery and no-recurring-unlock criteria. |

Distinguish Cloudflare encryption at rest, server-managed encryption and candidate client-side protection. Minimize authorized processing and exposure while preserving AI, safety, publication, search and background operations; never describe readable processing as end-to-end encrypted. WH-118 is a bounded feasibility decision with separate later implementation if viable, outside beta prerequisites.

WH-005 adds WH-115 for owner device acceptance and retains visitor tests. Extend WH-024/025 usability/measurements and WH-007/008/009/063 incident/lifecycle/key recovery work. WH-081 consumes WH-113 and WH-083 consumes WH-115; remove planned Android password fallback. WH-048 requires WH-117 plus identity through WH-005; WH-049 inherits both. WH-113 now has the source-grounded protocol decision and issue #42 evidence; WH-114 now has the isolated [authority foundation](../identity-authority.md) (#70); [verified ceremonies](../identity-ceremonies.md) are now implemented in source under #71. [Shared kits and enrollment completion](../identity-kits.md) now finish #71 backend completion/cancellation and implement ordinary kit replacement. The [restricted recovery backend](../identity-recovery.md) now implements all/some/none, resumable secure/completion, restricted rotation and emergency removal. Current web integration and the identity/protection/Chat cutovers are deployed; [current release evidence](../chat-test-release.md) supersedes the earlier isolated-foundation snapshot. WH-116 classification and WH-117 implementation foundations are delivered, while off-device custody, full recovery and physical-device acceptance remain open. WH-118 remains separate planned work. Preserve existing mappings, historical implementation evidence, real-money activation and CMS testing gates; refresh live issue state before execution.

## Current execution queue — October 1, 2026

The original nine-task foundation queue is historical: WH-001/003/004/006/009/010 are completed to their recorded scope. WH-064/065/066 are also completed foundations. Do not restart them because `next` prints planning-ready candidates; it does not read live issue status. The practical sequence is:

| Lane | Work to finish or begin | Why now |
| --- | --- | --- |
| Completed release foundation | WH-002 / issue #39 | Reuse the verified archive/partial-recovery tooling; [October 1 correction and evidence](../releases.md#archive-input-correction-and-wh-002-acceptance--october-1-2026). Full disaster recovery remains separate. |
| Evidence and reliability | WH-020 / #9, WH-024 / #10, WH-052 / #11 | Reconcile existing benchmarks, usability and job architecture with their remaining acceptance. |
| Early shared contracts | WH-113 identity and WH-089 tier catalogue delivered; WH-071 logical placement next | Consume the [shared identity contract](../workspace-identity.md); prevent new clients, roles and modules from choosing incompatible foundations. |
| Contract consumers | WH-105 Chat bindings after WH-113/089; WH-116 data classification after WH-113/009/020 | Define shared client and storage boundaries before implementation. |
| Implementations | WH-090, WH-114/115/117, WH-106/107, WH-067, WH-056 | Follow the exact dependency graph and [cross-workstream sequence](alignment.md). |

Keep one coordinator. Delegation/concurrent agents requires explicit authorization; separate implementation worktrees and migration ownership if it is later authorized. Preserve existing claims and incomplete work rather than starting duplicate implementations.

Sizes in the backlog are relative uncertainty: **S** is one narrow decision/change, **M** is a coherent feature or journey, **L** crosses several state machines or needs staged delivery. They are not time estimates. Before starting an L item, make child issues that each produce a reviewable slice; retain the parent acceptance gate. Do not turn a multi-service launch into one unattended agent run.

## Release gates

| Gate | Required proof | Stop condition |
| --- | --- | --- |
| Current baseline | WH-001/002/003 and candidate source/build/schema manifest. | Unknown current release, stale generated assets, missing test setup or incompatible schema. |
| Authority and identity | WH-004/005; tenant/model/owner/visitor authority plus real-device entry/recovery; owner WH-113–115 flows through WH-005. | Unresolved boundary failure, incomplete two-key workspace enrollment/recovery, unsafe current-policy cutover or missing proof on an admitted identity path. |
| Safety and privacy | WH-010–017, WH-020 and WH-116/117 for admitted formats/provider data and transparent protection. | Missing detector coverage, unavailable private scan provider, unoperated reporting/preservation, undisclosed model data use or missing required protection/migration evidence. |
| Lifecycle and operations | WH-006–009/018/019/050/059. | Unrecoverable unknown operations, unsupported deletion promises, failed restore or insufficient operating capacity. |
| Customer value | WH-024/025 and the supported site/app benchmark; WH-112 for the primary Chat experience at commercial acceptance. | Users cannot complete the promised journey, must navigate away for migrated routine work, or unsupported work is represented as completed. |
| Commercial launch | WH-021–023/041–045/047, WH-104 complete tiers and WH-049. | Missing selected tier/provider acceptance, unverified expanded costs, disabled payments, unfunded benefits or incomplete original contract. |

Zero unresolved critical authorization or unsafe-serving failures is required for an admitted path. Numerical business targets below are **proposed initial measurement criteria**, not achieved metrics, billing promises or production SLOs. Adjust them explicitly after the first evidence baseline rather than silently lowering a gate. Every numeric target in this table is **proposed until the first cohort baseline**; the WH-025 [funnel measurement contract](../funnel-metrics.md) records only opt-in, content-free milestones and keeps technical success separate from owner-judged usefulness.

## What to measure

| Outcome | Measurement and initial decision rule | Task owner |
| --- | --- | --- |
| First useful result | Invitation → welcome → private draft → owner-approved publication; record elapsed time, drop-off and owner usefulness rating. First target (proposed until first cohort baseline): at least 8 of 10 consenting beta participants complete their supported journey, with all failures categorized. Small-sample uncertainty must be stated. | WH-025/057 |
| Primary Chat experience | Proposed target (until first cohort baseline): at least 90% of supported routine task attempts finish within Chat/attached panels, with documented authentication/consent/preview handoff exclusions; at least 8 of 10 consenting participants finish the selected journey without navigation coaching. Compare required surface changes, abandonment, completion time and inference cost with the baseline; never log form answers. | WH-025/112 |
| Identity friction | First/second-key completion, unsupported/cancelled prompts, kit-save acknowledgment, print action, recovery completion and abandonment. Collect no credential IDs or secrets; a print action is not proof of printing. Establish the supported-device baseline before numerical targets. | WH-005/024/025/113–115 |
| Generation quality | Repeatable synthetic brief set, correct output, edit preservation, unsupported-request handling and honest action receipts. Every claimed publish/activation must map to a server receipt; benchmark usefulness separately. | WH-020/058 |
| Reliability | Successful operations, p50/p95 latency, unknown outcome rate/age, maintenance backlog and recovery time. Set numerical SLOs after WH-006/050 establishes representative load. | WH-006/050 |
| Safety | Coverage for every admitted format/path; pending-age, scanner outage and correction rates; adverse-finding revocation time. No unapproved artifact delivery in the acceptance matrix. | WH-017 |
| Recovery | Proposed RPO/RTO agreed before each drill; actual restore time, byte equality, revoked/deleted-state preservation and unresolved provider operations reported. | WH-008/019/059 |
| Economics | Full task cost and company contribution including standard AI, safety, support, fixed minimums, retries and liabilities; reconcile two closed periods before launch capacity promises. | WH-022/023 |
| Retention and support | Seven-/30-day return to useful editing or application use, reasons for abandonment, support volume and resolution time; only aggregate necessary data with the retention contract. | WH-025/035/057 |

## Decision and blocker register

| Decision/prerequisite | Work that can proceed | Dependent work held |
| --- | --- | --- |
| **Owner-deferred CSAM scanning**; provider eligibility, terms, budget and responsible safety/legal operator remain unresolved | Planned requirements only for CSAM; skip scanner implementation, enrollment and activation until explicitly resumed. Existing holds are not detection. | WH-011 and dependent scanner work; real scanning/approval and customer beta safety acceptance remain unaccepted. |
| Physical devices and a reviewed disposable live identity | Test matrix and existing synthetic/browser checks. | Remaining actual-device/human Turnstile acceptance: WH-005. |
| Production AI data-use/privacy and model budget | Offline benchmarks and read-only provider research. | Confidential customer workloads and new paid provider/Gateway route: WH-020/021. |
| Customer Cloudflare consent and owned zone; customer GitHub App and repository | Existing code verification and exact configuration plans. | Real DNS/backup/hosting journeys: WH-031/032/033. |
| **Owner-deferred CMS testing** | General safety requirements/design; no resumed CMS feature acceptance by implication. | Provisioning, native customer acceptance, full provider CMS recovery and bulk migration: WH-038/040/039. |
| **Stripe sandbox resumed October 1** | Sandbox onboarding, subscriptions, invoices and cancellation; [evidence](../stripe-sandbox.md). | Real-money activation, funded commercial benefits and full commercial MVP: WH-041 onward. |
| Deletion/retention policy and qualified review | Data inventory and proposed contracts. | Destructive closure/preservation activation: WH-009/015/018. |
| Two complete measured cost periods | Instrumentation and synthetic reconciliation; measure early and cover implemented expanded tier workloads for final acceptance. | Verified commercial economic acceptance: WH-023/049. |
| Gmail/Google Calendar, Outlook/Microsoft Calendar and HubSpot readiness | WH-056 common boundaries and WH-096–100 synthetic adapters; exact scope/configuration/cost preparation. | Real OAuth/tenant/distribution approval, Gmail restricted-data assessment, production privacy and customer consent/action/revocation; WH-104/047/049 paid launch. |
| Android signing/Play account, app association, FCM sender and physical devices | WH-081–086 contracts, local native development and synthetic identity/media/dispatch checks. | Signed app identity, real push and device acceptance, then WH-087 distribution with WH-048-approved cohort and photo safety. |

The existence of this roadmap or a GitHub issue never supplies these decisions. Continue independent work, prepare exact reviewable changes and surface the specific remaining prerequisite at the actual boundary.

## Cloudflare delivery choices

The [Cloudflare capability catalog](../cloudflare-capability-roadmap.md) remains the product-by-product inventory; this roadmap controls prioritization. Account entitlement and current prices must be reverified at each activation. No new subscription or usage charge was enabled while planning.

| Capability | What it does and Whumpo fit | Delivery path and prerequisites | Roadmap status |
| --- | --- | --- | --- |
| [Queues](https://developers.cloudflare.com/queues/) / [Workflows](https://developers.cloudflare.com/workflows/) | Background delivery / durable multi-step execution for scan, cleanup and notification jobs. | [WH-052 design](../background-jobs.md) selects D1-owned receipts and bounded scheduled passes initially. Queue delivery can repeat; keep business idempotency and uncertain external outcome receipts. Connected latency/cost evidence must justify any new service. | Decision/prototype recorded; no new dispatcher, schedule or provisioning. |
| [AI Gateway](https://developers.cloudflare.com/ai-gateway/) / [Workers AI](https://developers.cloudflare.com/workers-ai/) | Model transport/policy/telemetry and a candidate inference provider. | WH-020/021/022: quality, exact model/rate catalogue, privacy, reservations, receipt reconciliation and explicit activation. Underlying inference and some options incur cost. | Foundations exist; production route not accepted. |
| [Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/) | Customer custom hostnames and certificates. | WH-033: fallback origin, owned-domain review, entitlement/hostname price and TLS/serving/disconnect acceptance. | Code foundation; activation/acceptance gate. |
| [D1 recovery](https://developers.cloudflare.com/d1/reference/time-travel/) and [private R2](https://developers.cloudflare.com/r2/) | Existing relational and object stores; components of whole-platform recovery. | WH-008/019: match database/object/artifact/key state and replay deletions. Storage/provider recovery does not by itself restore all application authority. | Existing storage; full recovery unfinished. |
| [AI Search](https://developers.cloudflare.com/ai-search/) / [Vectorize](https://developers.cloudflare.com/vectorize/) | Retrieval over approved content for customers with demonstrated demand. | WH-053: isolation, revocation, relevance and complete indexing/inference/storage cost review. | Deferred pilot. |
| [Workers for Platforms](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/), [Containers](https://developers.cloudflare.com/containers/), [Durable Objects](https://developers.cloudflare.com/durable-objects/) | Alternative execution/state capabilities for workloads beyond the bounded runtime. | WH-055: specific workload evidence, threat model, tenant quotas, recurring/minimum costs and recovery. | Deferred architecture decision; keep current runtime. |

Official delivery references checked September 30, 2026: [Queues delivery guarantees](https://developers.cloudflare.com/queues/reference/delivery-guarantees/), [Workflows API](https://developers.cloudflare.com/workflows/build/workers-api/), [SaaS configuration](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/) and [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/). Pricing is intentionally not copied into new promises; consult the existing cost catalog and reverify provider/account terms before activation.

## Keeping the plan usable

At each completed task, update its issue with the exact result and evidence, and update the relevant feature contract. Change JSON readiness/dependencies only when planning facts change; a closed issue does not require a duplicate local status field. Re-render the backlog after JSON edits. Review priorities after each beta cohort, major incident, new provider decision or release gate; no recurring automation is installed by this plan.

Future capabilities stay deferred until they have customer evidence and an operator/cost case: media streaming/realtime, VPC/Zero Trust, arbitrary containers, broad Cloudflare administration, enterprise networking and data catalogs. The roadmap is full coverage of current commitments plus a gated expansion path, not a promise to implement every entry in the Cloudflare catalog.

## Appended architecture direction — configure and compose first

**Owner decision, September 30, 2026; extension planned against `ba6dfc5`.** Whumpo should assemble and operate a shared, maintained platform: **configure existing capabilities first, compose them next, generate only the missing custom code, and allocate dedicated infrastructure only when the workload requires it.** Reduce duplicated implementation and idle capacity while preserving separate customer data, permissions and execution boundaries. Invest in this before marginal model-price optimization; existing safety, privacy, reliability and funded-spending requirements still apply.

The complete design is in [composition architecture and operating strategy](composition-architecture.md). New packets **WH-064–WH-080** are appended to the [backlog](backlog.md) under **F5 — Configuration and shared capabilities**. F5 is an appended workstream, **not** a requirement to finish F0–F4 first. Begin the P0 [specification decision, WH-064](https://github.com/zemdregon/whumpo/issues/12), now alongside existing release prerequisites; avoid expanding unrelated premium-routing experiments before that foundation. Implementation is proposed unless the feature contract records delivery.

### Whumpo AI is the owner's maintainer

Whumpo's agent chats with the owner and maintains the owner's project. It is **not wired into customer website or service execution**. Visitors, form submissions, appointment rules, background business jobs, webhooks and scheduled service checks must not invoke that agent, start a maintenance conversation, borrow its tools/context/credentials or consume its inference funding. Published pages and standard services must keep working when the maintainer model is unavailable.

A customer may later explicitly connect their own model, or a separately exposed Cloudflare AI Gateway/Workers AI capability, to their website or service. **WH-079** is a deferred design packet for that separate option: project-scoped authorization, server-held credentials, quotas, privacy, receipts and customer-approved costs. There is no fallback to Whumpo's maintainer provider or owner-assistance allowance. The initial automation catalog contains deterministic rules and actions, with no agent/model step. AI Gateway configuration alone supplies neither a model nor funding.

### Make the project specification the normal change surface

Each project should retain a validated, versioned specification covering pages, presentation, enabled modules, content/data schemas, permissions, integrations and deterministic automation rules. The agent proposes supported operations with explicit inputs/outputs; trusted software validates and compiles them. Configuration cannot invent new fields, embed arbitrary executable expressions or change infrastructure directly.

**Understand → propose specification changes → validate permissions and compatibility → compile/preview → apply the exact reviewed change → record an immutable version.** Existing publication, visibility, permission, data-migration and spending reviews remain in place. Deterministic compilation can produce HTML, forms, API clients and exportable source without model-written equivalents. Every configuration change still needs appropriate checks, a receipt and a current-contract recovery plan.

| Owner request | Preferred change |
| --- | --- |
| Change business hours | Content record/version. |
| Ask what vehicle the customer drives | Supported form/schema definition. |
| Email staff when an appointment is requested | Deterministic workflow and notification configuration. |
| Let only staff see customer uploads | Server-enforced project authorization policy. |
| Make the homepage feel more premium | Design settings and composition; a small custom frontend component only for an uncovered requirement. |

### Share maintained functions while allowing distinctive presentation

Start with **content, forms/records, files/galleries, accounts/access and notifications**. Reuse the existing components, contact/directory modules, visitor identity/data, file safety and publication machinery through stable scoped APIs. Several modules can live in one well-structured backend; this is not a mandate for a new microservice per capability. Evaluate proven libraries/services before implementing complex identity or payment engines.

Offer three presentation levels: configure a design, compose existing components differently, or create a bounded custom frontend component using the same shared APIs. Layout, typography, navigation, imagery and interactions can vary without reinventing authentication, upload handling or notification delivery. Later, add deterministic automation, record views, directories and simple portals where demand justifies them. More specialized booking/catalog/membership behavior needs its own supported contract.

Maintained module versions require current-contract tests, reviewed cutovers, obsolete-test resets and forward repair. Unsupported historical runtime versions are not retained. Starter copies remain useful, but a collection of diverged copies is not a maintained shared module. Promote recurring functionality only after deliberate rights, privacy, provenance and security review; never harvest private customer code automatically.

### Match execution, data and capacity to the workload

| Workload or resource | Default direction | Required boundary |
| --- | --- | --- |
| Public pages | Publish prebuilt assets; run dynamic code only where needed. | Approved publication, withdrawal, safety and cache invalidation still work. |
| Standard application features | Shared Whumpo-maintained APIs with scoped customer records. | Server-verified tenant/user authority, quotas and permission-aware caches. |
| Customer-controlled executable logic | Isolated on-demand execution; keep current QuickJS until a reviewed broader route is justified. | Workers for Platforms is a candidate; bundle project routes rather than multiplying tiny scripts. Never run guest code in the privileged platform Worker. |
| Native/sustained processes | Isolated container/VM only for a demonstrated workload need. | Benchmark full running/idle/supporting-service costs; no default server per customer. |
| Platform metadata | Shared project/resource registry and module catalog. | Customer requests cannot choose arbitrary resource identities. |
| Project application data | Prefer separate project databases where useful; static sites may need none. | Automated reviewed provisioning, migrations, export, deletion and restore; no blind migration of current shared data. |
| Files | Shared private storage service. | A customer-ID path is organization, not authorization; no unrestricted bucket credentials. |
| Automations and builds | Stored rule/job state on pooled execution capacity. | Deterministic service rules; clean isolated writable workspace per build; no persistent per-customer agent container. |

The [current background-job ADR](../background-jobs.md) already selects D1-owned receipts and bounded scheduled passes initially. Reuse that decision; adopt Queues or Workflows only when its measured triggers justify the cost and complexity. At-least-once delivery still requires business idempotency and reconciliation of uncertain effects. Reuse prepared build images, approved immutable dependencies and artifacts; keep private workspaces, credentials, inputs and outputs scoped to the job/project.

Enforce limits on concurrency, queued work, database activity, upload/transform size and execution resources as well as requests. Reserve interactive capacity separately from batch work. Move to independently scalable groups or selectively dedicated resources when measured isolation/performance needs justify them. Savings must not come from one unrestricted process, database connection or cache shared across tenants.

### Measure reuse and preserve a credible exit path

Track **cost per successful customer change**, **ongoing cost per active project**, and **custom-code/dedicated-resource fallback rate and missing-capability reason**. Include retries, builds/tests, operations, maintenance and support. Keep separate internal records for AI, execution, database/storage and external services even if the approved customer presentation later combines eligible balances. Preserve standard owner AI's existing policy, spending caps and explicit upgrade consent. Do not claim a savings percentage before representative outcome comparisons.

Every project retains its specification, eligible content/data, custom source, asset manifest and exact module/compiler versions. A frontend export dependent on private Whumpo APIs is not a functioning standalone application. **WH-077** requires a tested self-hostable subset, replacement adapters or an explicit migration path, with managed dependencies and reauthorization steps disclosed. Customer ownership does not require exporting Whumpo's entire internal platform or its credentials.

The first pilot is a mobile-detailing site with service packages, appointment requests, approved uploads, staff access and confirmation emails. **WH-080** proves that ordinary edits configure existing capabilities, visually different projects reuse the same APIs, customer records stay isolated, and visitor/service execution makes **zero calls to the Whumpo maintainer model**. Live media/provider/device/customer acceptance remains separately gated.

### Delivery packets

| Priority/order | Task IDs | Deliverable |
| --- | --- | --- |
| First, P0 | WH-064–067 | Specification/operations, capability discovery, deterministic compiler and narrow shared APIs. |
| Then | WH-068–070 | Configured notifications, deterministic automation and flexible presentation. |
| Foundational placement and isolation | WH-071–075 | Freeze WH-071 logical resource/adaptor contracts before WH-067; physical fleet changes remain later WH-072. Pooled builds follow WH-075 fairness. |
| Sustainable operation | WH-076–078 | Maintained version governance, honest exports and complete outcome/cost measurement. |
| Separate optional research | WH-079 | Customer-configured runtime AI; no Whumpo maintainer access. |
| Connected proof, P0 | WH-080 | Specification-composed business-site/portal pilot with isolated data and zero visitor maintainer calls. |

Earlier WH-021/044 now explicitly describe **owner-maintenance** inference/funding; WH-053's optional runtime AI requires the separate customer route; WH-056/062 cannot become visitor-triggered agent workflows. WH-026/028 build on the new specification pipeline. This clarifies earlier scope rather than authorizing visitor AI or any new paid infrastructure.

## F6 — Native Android owner experience

**Accepted September 30, 2026; runtime implementation and activation remain planned.** The [Android feature contract](../android-app.md) defines a Kotlin/Compose owner app for Android 9/API 28+, starting with invited testers. The October 1 direction makes Chat primary, with Projects/Activity as supporting views and Settings for infrequent account work. Native interactions share the WH-105/106 contract; authenticated Custom Tabs handle unsupported elements, website previews, welcome/recovery and infrequent setup. Photos, Android sharing and FCM push belong in the first private beta.

| Sequence | Packets | Deliverable |
| --- | --- | --- |
| Contract first, P1 | WH-081 | Current-service mapping, v1 API/identity contract, supported journeys and acceptance matrix; consumes WH-105 interaction compatibility and WH-113 workspace identity. |
| Foundations | WH-082, WH-083 | Reproducible native shell/protected state; versioned native API, passkeys and PKCE browser returns. WH-083 consumes WH-115 completed enrollment/recovery; the shell does not wait for web implementation. |
| Connected owner journey | WH-084 | Native Chat/history, admitted interactive elements using WH-106, projects, immutable review controls, preview handoff and interrupted-request recovery. |
| Complete beta capability | WH-085, WH-086 | Explicit photo/share intake and bounded, private owner push; WH-086 also depends on the WH-052 job decision. |
| Release gate | WH-087 | Signed Play internal testing, actual-device/provider evidence, support and release recovery; depends on WH-084–086 and WH-048. |
| Deferred expansion, P2 | WH-088 | Broader native coverage and public distribution selected from private-beta evidence. |

This lane can begin alongside current work; it does not wait for all F3–F5 work or make Android a prerequisite for the web beta. WH-081 is a planning-ready contract packet, not a claimed or completed implementation. Keep existing priorities and task dependencies intact, check live issue state before execution, and coordinate shared auth/Chat files and migration numbers. No Android issues are created by adding these packets.

Native bearer access must preserve current owner/session/recovery authority and browser Origin checks. Process death and lost replies recover immutable receipts before explicit same-ID retries. Models, share intents and notifications cannot approve actions. Real photo use remains gated by existing safety acceptance, and FCM setup/dispatch is separate from the job ADR's local prototype. The contract records dated provider references, unverified account/signing prerequisites and supporting execution/storage costs; no new paid service or schedule is activated here.

Keep full offline synchronization, iOS, customer Android-app generation, full workspace parity and public Play release deferred. Stripe remains sandbox-only; CMS testing stays owner-deferred. Use acceptance-based milestones; set delivery dates only after the identity/API foundation establishes effort. A mock, signed artifact, configured provider and accepted customer journey remain different evidence.

### Cumulative catalogue delivery — October 1, 2026

WH-089 implements the [shared feature catalogue and Creator display rollout](../plan-feature-contract.md), tracked in [issue #44](https://github.com/zemdregon/whumpo/issues/44). Current source/API/UI/Chat use stable feature IDs and cumulative packaging; `personal`, prices, receipts and Stripe mappings remain compatible. Catalogue presentation has source, local acceptance and private-test deployment readback; runtime feature enforcement remains separate. WH-090 consumes this catalogue and existing subscription coverage; WH-105 can now use the shared identity and feature contracts. All individual features/providers and full paid-launch gates retain their acceptance requirements.

## Dashboard PWA — October 1, 2026

Owner-requested WH-119 adds [home-screen installation](../dashboard-pwa.md) for the existing workspace. This extends the original 118-task alignment with one independent F2 packet; it does not replace native Android acceptance or add offline account synchronization.
