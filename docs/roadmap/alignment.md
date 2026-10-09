# Roadmap architecture and sequencing alignment

**October 1, 2026.** Reviewed all 118 packets and seven workstreams against committed source `2207186`, the saved local planning additions, current feature contracts and live GitHub issue evidence. This review changes documentation and sequencing. It does not implement, deploy or activate the proposed features.

## What changed

GitHub's canonical backlog contained 63 packets while the local extension contained 118. This alignment integrates the extensions with newer release, security and Stripe evidence. IDs are unchanged; no task was added or silently removed. F0–F6 are workstreams, not a requirement to finish one before starting another. In particular, F5 composition contracts belong near the beginning.

| Rework risk | Aligned ownership and order |
| --- | --- |
| Build billing only after measuring every future feature for two periods | WH-022 establishes the metering envelope; WH-090 extends the existing subscription resolver; WH-042/043 implement with sandbox/synthetic terms. WH-041 terms and WH-023 finance evidence gate commercial activation through WH-047/049. They no longer block constructing the mechanisms that generate evidence. |
| Add a second entitlement store when feature tiers arrive | WH-090 consumes existing paid service-interval coverage and explicit preview grants. WH-042 extends that same resolver. Preserve `personal` IDs, invoice intervals, historical receipts and zero standard-AI debits. |
| Implement team access, native sessions and Chat before identity is settled | WH-113 freezes identity authority first; WH-090/105 consume it. WH-054 members and WH-083 native identity use completed WH-115 enrollment/recovery. Visitor identity remains separate. |
| Build new tables, export and restore, then retrofit protection | WH-116 extends the existing data inventory before WH-106 interactions and WH-067 modules. WH-117 focused protection/key reset checks precede integrated WH-018 closure/export and WH-008 restore acceptance. No reverse dependency on the final restore drill. |
| Finish bespoke dashboards, then replace them with Chat | WH-105 defines registered bindings; WH-107/109/110 provide shared forms, views and journey adapters. WH-037 reporting follows WH-109. Tier features register their existing domain handlers with that surface. WH-104 now requires WH-112 owner-experience acceptance. Essential direct controls remain available. |
| Build a second website/app UI engine for shared modules | WH-028 typed visitor interfaces follows WH-070 maintained presentation contracts. WH-070 is the customer-app renderer; WH-107/109 is the owner renderer. They share backend contracts where appropriate, without sharing privileged execution or duplicating storage/auth. |
| Wire Cloudflare/GitHub individually and later rebuild around a connector framework | WH-056 adapts the already implemented vault/consent/receipts; WH-031/032 final connected acceptance follows it. WH-096–100 reuse the same framework. Existing delivered security fixes remain authoritative. |
| Make every connector wait on a platform email sender | WH-036 platform delivery and WH-056 customer connectors are independent adapters. WH-068/094 automatic notifications use the platform sender initially. Owner-request mailbox consent does not authorize unattended sends, polling or workflow use. |
| Build modules directly against one database, then migrate every client to a fleet | WH-071 moves to an early P0 interface decision after WH-064/009. It freezes logical resource IDs and scoped storage/runtime adapters before WH-067. WH-072 can later implement justified physical placement behind those interfaces. Current shared D1/QuickJS remains usable; no project-database fleet is required for the first modules. |
| Accidentally require Business OAuth for every custom domain | WH-033 accepts Whumpo-managed hosting and manual DNS independently of customer Cloudflare consent. WH-031 remains the optional automated customer-zone path; registrar funding stays separate. |
| Make ordinary support wait for deferred scanner enrollment | WH-035 follows the safety coverage contract and incident plan. WH-016 adds the separately authorized abuse/case adapter later; it does not block an essential support path. |
| Pool builds/jobs before defining contention and cancellation | WH-074 pooled builds and WH-069 rules follow WH-075 shared admission/fairness. Existing D1-owned receipts and WH-052 orchestration remain the common job/outbox foundation, including WH-086 FCM as an adapter. |
| Expand a closed lifecycle task and treat new data as already accepted | WH-009 retains its completed historical scope. WH-116 and each new feature register their additional classes and adapters. Closed evidence never automatically covers future tables, roles, providers or processing paths. |
| Treat initial compiler delivery as unfinished and rebuild it | WH-064/065/066 and children #15–17 are completed for their recorded supported scope. Extend the catalog/compiler/private apply/restore paths for WH-067–070, rather than replacing them. |

## Build order across workstreams

1. **Reuse and finish current foundations.** Use the delivered specification/catalog/compiler, release protocol, security corrections and sandbox billing. Finish the open WH-002 verification and reconcile WH-052 job evidence. Keep open usability and model-quality acceptance distinct from their existing fixture implementations.
2. **Freeze shared contracts.** WH-113 identity, WH-089 feature identifiers and WH-071 logical placement can start from existing evidence. Then WH-105 interaction/binding contracts and WH-116 data/protection classification. WH-022 defines common metering identities and adapters early; future producers extend them.
3. **Implement shared mechanisms.** WH-114/115 identity/recovery, WH-117 protection, WH-090 eligibility, WH-106/107 interactions, WH-067 modules and WH-056 connector conformance. Reuse immutable versions, exact current-authority reviews and read-only lost-response recovery throughout.
4. **Connect useful journeys.** WH-109/110 owner views and Chat; WH-070/028 visitor presentation; WH-068/069/094 deterministic notifications/rules; Creator/Business/Pro features; and the Android subset over the same versioned server contracts. Each feature adds adapters, not another authorization, billing, job or lifecycle engine.
5. **Accept the composed result.** Run candidate-release identity/protection/recovery, owner-experience WH-112, full-tier WH-104 and expanded two-period WH-023 checks. WH-048 governs an explicitly bounded free beta; WH-047/049 govern commercial presentation and the full MVP. Real-provider, device and customer evidence remains necessary where specified.

This is an ordering guide, not permission to bypass a packet dependency. A large packet must be split into contract, implementation and connected-acceptance work before execution. Do not make an upstream contract depend on the finished feature it is meant to support. Synthetic adapters can be built while external approval is pending; their parent remains open if real acceptance is required.

## Implementation rules that prevent another rewrite

- One server domain handler per capability. Web, native, Chat and saved views call adapters over it; none reconstructs authorization from text, UI state or a cached layout.
- Customer-app visitor/staff roles stay separate from Whumpo workspace members. Application access policy never grants owner Chat/admin authority.
- One effective entitlement resolver, one scoped credential/connector lifecycle and the existing D1 job receipt model. Separate feature inclusion, configuration, readiness and current actor authority.
- Version storage, module, interaction and client contracts from their first implementation. Physical placement is an adapter choice; migration does not change logical project identity or silently move data.
- The initial version pins already exist. WH-076 adds current-version cutover/withdrawal operations; it must not retrofit versioning into previously unversioned modules. Private customer source, prompts, data and credentials never enter shared libraries or caches.
- New data classes require lifecycle/protection/export registration in the same feature change. Platform account export/closure and WH-077 portable project export remain distinct outcomes using shared data adapters.
- Entry onboarding and recovery remain deterministic and accessible before Chat. Later project intake reuses that saved state; custom Chat forms never collect passkeys, recovery keys, OAuth secrets or payment credentials.
- Visitors, webhooks, scheduled rules and view rendering do not invoke the owner maintainer. Standard owner assistance remains unlimited fair use with zero customer-unit debits; premium funding and optional customer runtime AI remain separately approved.
- Before merging an implementation, verify its upstream contract version and downstream clients. Before removing an old entry point, accept its replacement journey and inference-outage recovery.

## Reconciled evidence and remaining gates

Live GitHub readback on October 1 confirmed foundation issues #3–8 closed; compiler #12–17 closed; model outcomes #9, owner usability #10, job decision #11, deferred provider selection #21, full billing lifecycle #30 and release verification #39 remain open. Closure applies only to recorded scope. The completed compiler supports content, fixed contact intake and reviewed stateless clients; general records/access/files/notifications/rules are future work.

Stripe sandbox signup, paid invoice webhooks and cancellation have recorded deployed acceptance in [the sandbox contract](../stripe-sandbox.md). Remove “no Stripe account” and blanket setup-deferral assumptions from current plans. Sandbox receipts are never real revenue, resource funding or premium credits. Before revenue exists, margin from proposed prices is a forecast, even when expenses have been measured through two actual periods.

No new product choice was needed to repair the ordering. Existing scope choices remain consequential:

- The full paid launch still requires all selected tier benefits and seven connectors. This review does not reduce that commitment to accelerate billing.
- CMS testing, CSAM implementation/provider activation and Daybreak remain owner-deferred. Dependent full safety/MVP gates remain unsatisfied; this alignment neither resumes them nor silently removes them.
- Two distinct passkeys at signup/recovery remains the planned identity policy, including its supported-device limits. PRF-based content encryption remains WH-118 feasibility outside beta prerequisites.
- Android is an independent implementation lane consuming shared contracts. Web beta does not depend on Android delivery; native customer admission still depends on WH-048.
- Full disaster recovery, actual provider/device/customer acceptance and two closed cost periods cannot be replaced by local fixtures.

The separate shared-workspace/quality-tooling changes in the primary checkout are not imported as implemented dependencies. Until merged, packets use the committed verification workflow. The unfinished release-archive correction remains on `codex/release-verification` under #39; this alignment does not claim its tests passed.

**Subsequent October 1 update:** WH-002's archive correction and all four focused release checks now pass; see [the release evidence](../releases.md#archive-input-correction-and-wh-002-acceptance--october-1-2026). The preceding paragraph records the state when alignment merged, before that follow-up. Full disaster recovery remains unaccepted.

## Verification

Run roadmap validation, regenerate the Markdown backlog, confirm exact rendering, inspect local Markdown links and check the diff. Review dependency reachability as well as cycles: early contract/implementation packets must not inherit their own release, finance-period, optional PRF or Android distribution gates. Preserve all 118 IDs, historical evidence and existing issue mappings. This documentation-only change requires no application tests or deployment.

**Results:** `node tools/roadmap.mjs validate`, `render`, `render --check` and `git diff --check` passed. All 118 original IDs remain; 25 packets have dependency changes and the graph is acyclic. Focused reachability checks passed for upstream contracts, independent sender/connector/support/domain lanes and retained commercial/safety gates. All 1,226 local Markdown targets in the 19 changed/new documents resolved. The 15 primary-checkout planning inputs still matched the saved input snapshot; unrelated primary work and the separate unfinished release patch were preserved. No application test or deployment ran for this alignment.

## Shared identity decision — October 1, 2026

WH-113 now has the source-grounded [workspace identity protocol](../workspace-identity.md), tracked in [issue #42](https://github.com/zemdregon/whumpo/issues/42). It resolves restricted authority, partial recovery, one kit state machine, invitation resumption and current-only test cutover. WH-114 builds common state/guards in isolation; WH-115 reuses them for restricted recovery. One reviewed cutover resets obsolete test identities and removes the old policy after both implementations are ready; device/cohort acceptance remains separate. WH-090/105/054/081/083 consume this contract rather than implementing their own session/recovery rules. This is decision evidence only; no deployed policy, schema or credential changed. WH-089 and WH-071 remain independent next contracts.

## Cumulative feature contract — October 1, 2026

WH-089 now supplies the [shared catalogue](../plan-feature-contract.md) in code and presentation. Creator retains `personal`; no grant or provider mapping is rewritten. WH-090 consumes stable feature IDs, current identity and existing invoice coverage rather than creating another entitlement source. WH-105 uses the same IDs for Chat bindings. This closes the early feature-definition handoff; runtime enforcement, delivery and commercial activation remain distinct.

## Follow-up dependency audit — October 1, 2026

Reviewed all 118 task dependency lists against source `db8b740`, including the now-delivered WH-113 identity protocol and WH-089 catalogue. The latter's presentation is deployed in private test release `37497b4a-0b2d-4004-94cf-12838eff9e96`; it does not implement feature enforcement. Live GitHub evidence confirms #39/#42/#44 completed; #9/#10/#11/#21/#30 remain open. Earlier dated snapshots above retain their original scope.

The first alignment established the architecture; this pass makes additional cross-workstream prerequisites executable in the canonical graph. No task is appended, renumbered or removed.

| Remaining rework risk | Correction |
| --- | --- |
| New modules and typed Chat interactions invent eligibility checks before shared enforcement exists | WH-067 and WH-106 now depend on WH-090. Module owner controls also consume WH-105. Published visitor serving retains its own app policy and the protected hosting contract. |
| Team/guest/provider records and pooled caches ship before their protection and processing rules | WH-054/056/075/092 now consume WH-116. Membership and feedback register WH-105 bindings before clients. Existing encrypted credentials remain the foundation. |
| Account closure grows a second scheduler; generic jobs later need new identity/resource fields | WH-018 now consumes WH-052; WH-052 consumes WH-071/113. One job envelope carries stable logical resource and actor scope; domain receipts remain authoritative. |
| Cost attribution changes when data moves between physical services | WH-022 consumes WH-071 logical identities. Moving a database never rewrites a historical usage event. |
| Export requirements arrive after module schemas, and first exports wait for a database fleet | WH-071 freezes minimal lifecycle/export descriptors before WH-067. WH-077 consumes that contract instead of waiting for WH-072; future physical adapters need their own export acceptance. |
| Capacity pooling bypasses feature decisions | WH-075 consumes WH-090 as well as protection rules, preserving actor revocation, uncertain readback and non-billable standard assistance. |
| Paid tiers pass individual screens without proving the composed platform | WH-104 includes the existing WH-080 synthetic integration pilot. Provider, device, customer, safety and finance acceptance remain separate requirements. |

### Execution order after the delivered foundations

1. **Immediate independent contracts:** WH-071 placement/lifecycle/export interface and WH-105 interaction/binding contract. Reconcile WH-020's outstanding outcome/privacy evidence; then WH-116 protection classification. WH-090 can begin from delivered WH-089/113 and the existing subscription resolver.
2. **Shared engines:** complete WH-052 with the identity/placement handoff, WH-114/115 enrollment/recovery, WH-117 protection, WH-106/107 interactions, WH-067 module APIs and WH-056 connector conformance. Split contract, implementation and externally gated acceptance before claiming large packets.
3. **Feature adapters and journeys:** shared sender/notifications/rules, Creator feedback/design, Business records/connectors, Pro collaboration/releases, owner views and the native subset. Reuse the common handlers. Initial Chat delivery does not wait for every future feature; each feature adds its own binding and connected acceptance.
4. **Acceptance and launch:** candidate-specific protection/recovery, the composed pilot, primary Chat experience and cumulative paid tiers, with the existing safety, measured-finance and commercial gates. Free beta remains independent of the full paid-tier and Android gates.

A full contract/schema handoff may be delivered before its parent finishes external acceptance, but must be named and evidenced explicitly in a child packet. Do not informally ignore a parent dependency or mark its untested remainder done. Exact current-version metadata belongs in the first schema; later cutovers, storage placement and client additions use the current contract without compatibility adapters.

No additional product decision is needed for these sequencing fixes. Existing unresolved activation choices remain in their packets; CSAM and Daybreak stay deferred, CMS testing stays paused, and standard AI remains unlimited fair use with Monitor default.

### Persistent graph check

`node tools/roadmap.mjs alignment` checks required upstream paths and forbidden release/optional-infrastructure dependencies. It rejects reintroduced billing/launch cycles, missing shared contract paths, a web-beta dependency on Android/PRF/paid tiers, a platform sender dependency on mailbox connectors, and an export dependency on future physical database placement. Run it when extending the backlog, alongside structural validation and render checks. It reads only local planning data and does not infer completion, deployment or approval from reachability.

**Follow-up verification:** structural validation, alignment reachability and exact generated rendering passed. All 118 IDs, original acceptance criteria, prior scope entries, issue mappings and evidence were preserved; 11 packets have dependency changes. Ten deliberately broken dependency graphs were rejected by the new check, and structural validation rejected a cycle. All 1,094 local Markdown file links in the changed guidance/backlog/brand documents resolve. No runtime behavior or provider service is changed by the roadmap tooling.

## WH-071 interface handoff — October 1, 2026

[Workload placement](../workload-placement.md) now supplies the frozen logical resource, scoped adapter and lifecycle/export contract required above. Its offline scenarios and public provider review do not activate a registry, migration, export or additional runtime. WH-067 implements current shared-storage adapters with its first schema; WH-052/022 consume stable identities; WH-072 changes physical placement behind those interfaces; WH-077 verifies the existing portable subset without waiting for WH-072. WfP/Containers/VMs remain conditional reviewed options. This handoff does not alter dependencies, narrow task acceptance or reopen completed foundations.

## WH-105 interaction handoff — October 1, 2026

[Chat interaction v1](../chat-interactions.md), issue [#51](https://github.com/zemdregon/whumpo/issues/51), supplies closed fields/templates/binding identities, separate collection/continuation/domain receipts, current identity/feature admission, lifecycle and current-version-only web/native checks. Offline fixtures map the first content-change brief through the actual compiler and existing exact controls; they do not implement production persistence or a renderer. WH-106 still consumes WH-090 and WH-116 before its first schema. WH-081/067 and feature adapters consume this contract; WH-109 evolves the existing layout revision. Existing route removal waits for WH-110/111 replacement and outage acceptance. Next shared work remains WH-090, privacy/protection and identity/job implementation, with the owner deferrals intact.

## Owner current-version amendment — October 1, 2026

[WH-120](../current-version-policy.md), issue [#53](https://github.com/zemdregon/whumpo/issues/53), is the active cross-cutting removal inventory. The owner rejects legacy support, superseding earlier old-client coexistence and fallback requirements. WH-105/081/084/107/109/111 now require current-version clients/layouts and explicit rejection, with obsolete-test resets instead of data-preservation migrations or compatibility adapters. Finish retiring current runtime legacy paths alongside shared roadmap work, and record each implemented versus deployed slice. Do not rebuild those paths in entitlements, interaction storage, native clients or release recovery. CSAM and Daybreak remain deferred and CMS functional testing remains paused.


## WH-052 job handoff — October 2, 2026

[Shared job/outbox contract](../job-envelope.md) and the [reconciled ADR](../background-jobs.md) freeze current tenant/actor/resource pins, exact domain intent, distinct attempt/delivery identities and uncertain-effect recovery. D1 state with bounded scheduled passes remains the initial design; the reference is offline and adds no runtime dispatcher or service. WH-018/036/068/069/074/086 implement adapters over this contract and prove actual current authority, D1 transactions, fairness, privacy and provider outcomes in their own packets. Jobs and restored receipts cannot create workspace or provider authority. CSAM and Daybreak remain deferred.

Active WH-083 and WH-106 scope also now uses the complete current schema and disposable test fixtures/reviewed empty databases. Two stale numbered-migration requirements were removed; task dependencies, feature acceptance and prior historical evidence remain intact.


## Completed foundations versus cumulative acceptance — October 2, 2026 UTC

The live execution audit found two overly broad dependency edges. WH-090/#62 retains planned collaboration and cumulative feature-adapter acceptance, while those implementations themselves depended on WH-090. WH-116 needs WH-020's privacy decision, but its remaining real-model cohort is not a prerequisite to classifying stored data. These were execution deadlocks despite the previous JSON graph being acyclic.

Two explicit handoff packets preserve the parent outcomes and all existing acceptance criteria:

| Handoff | Evidence and implementing consumers | Parent remainder |
| --- | --- | --- |
| **WH-121 — inference privacy/offline foundation** | [Current processing decision](../inference-privacy.md), dated official terms, complete synthetic cohort and honest unknown-cost accounting. WH-116 consumes this packet instead of full WH-020. | WH-020/#9 remains open for real-provider quality and cost evidence; WH-021 and beta/commercial/provider acceptance still require the full relevant gates. |
| **WH-122 — shared feature admission** | Already completed #63/#64/#65 and [current acceptance](../feature-acceptance.md). Maps existing #65; no second implementation or reopened historical scope. Feature/module/connector/capacity/Chat implementers consume this accepted foundation. | WH-090/#62 now explicitly waits for WH-054/056 and WH-091–103 adapters. WH-104 still requires full WH-090 and all cumulative benefits. |

No parent scope, acceptance criterion or historical evidence was deleted. The additional IDs name completed reusable deliverables, not replacement product goals. Downstream implementation still proves its own current identity, feature, resource, role, dispatch and recovery checks. Native/human identity, provider consent, actual quality/cost, safety and paid-launch acceptance remain independent gates.

The persistent alignment check requires these paths and rejects a dependency from either foundation back to its parent acceptance, or a classification dependency on the real-cohort gate. `tests/roadmap-alignment.mjs` exercises missing foundations, missing cumulative feature acceptance, downstream dependencies and actual cycles. Read current issue evidence before treating a packet as complete; planning readiness still does not imply execution status.

## WH-068 notification handoff — October 8, 2026 UTC

The [notification contract](../notifications.md) (WH-154) freezes templates, verified senders, server-derived recipient scopes, consent, receipt states and bounded reconciliation, and splits WH-068 into WH-154–160. WH-068 keeps its acceptance and depends on every child. The persistent alignment check requires WH-068 to reach its contract (WH-154), connected acceptance (WH-159) and canary (WH-160). It rejects any child reaching WH-069, WH-080 or WH-094, which consume WH-068, and any child other than the WH-160 canary waiting on WH-036's live sender acceptance. The existing WH-036 source is reused, not rebuilt. This is planning and an offline reference only; no provider, sender, DNS record or schedule is added.

## WH-034 domain purchase handoff — October 9, 2026 UTC

The [domain purchase contract](../domain-purchases.md) (WH-192) freezes the server-computed quote, exact consent-text review, order states with single dispatch and bounded read-only reconciliation, funding handoffs, renewal opt-in, transfer-out and registrant data rules, and splits WH-034 into WH-192–198. WH-034 keeps its acceptance and depends on every child. The persistent alignment check requires WH-034 to reach its contract (WH-192), connected acceptance (WH-197) and live canary (WH-198). It rejects any child reaching WH-023, WH-044, WH-045, WH-047, WH-049 or WH-104 (WH-045 and WH-049 consume WH-034), and any child other than the WH-198 canary waiting on WH-041 real-money terms. Registrar selection is an open owner decision. This is planning and an offline reference only; no registrar, payment flow, availability check, purchase or schema is added.
