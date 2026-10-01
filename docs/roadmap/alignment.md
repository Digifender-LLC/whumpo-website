# Roadmap architecture and sequencing alignment

**October 1, 2026.** Reviewed all 118 packets and seven workstreams against committed source `2207186`, the saved local planning additions, current feature contracts and live GitHub issue evidence. This review changes documentation and sequencing. It does not implement, deploy or activate the proposed features.

## What changed

GitHub's canonical backlog contained 63 packets while the local extension contained 118. This alignment integrates the extensions with newer release, security and Stripe evidence. IDs are unchanged; no task was added or silently removed. F0–F6 are workstreams, not a requirement to finish one before starting another. In particular, F5 composition contracts belong near the beginning.

| Rework risk | Aligned ownership and order |
| --- | --- |
| Build billing only after measuring every future feature for two periods | WH-022 establishes the metering envelope; WH-090 extends the existing subscription resolver; WH-042/043 implement with sandbox/synthetic terms. WH-041 terms and WH-023 finance evidence gate commercial activation through WH-047/049. They no longer block constructing the mechanisms that generate evidence. |
| Add a second entitlement store when feature tiers arrive | WH-090 consumes existing paid service-interval coverage and explicit preview grants. WH-042 extends that same resolver. Preserve `personal` IDs, invoice intervals, historical receipts and zero standard-AI debits. |
| Implement team access, native sessions and Chat before identity is settled | WH-113 freezes identity authority first; WH-090/105 consume it. WH-054 members and WH-083 native identity use completed WH-115 enrollment/recovery. Visitor identity remains separate. |
| Build new tables, export and restore, then retrofit protection | WH-116 extends the existing data inventory before WH-106 interactions and WH-067 modules. WH-117 focused protection/key migration checks precede integrated WH-018 closure/export and WH-008 restore acceptance. No reverse dependency on the final restore drill. |
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
- The initial version pins already exist. WH-076 adds rollout/deprecation operations; it must not retrofit versioning into previously unversioned modules. Private customer source, prompts, data and credentials never enter shared libraries or caches.
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

WH-113 now has the source-grounded [workspace identity protocol](../workspace-identity.md), tracked in [issue #42](https://github.com/zemdregon/whumpo/issues/42). It resolves restricted authority, partial recovery, one kit state machine, invitation resumption and compatible migration. WH-114 builds common state/guards with activation off; WH-115 reuses them for restricted recovery. Per-account and global password retirement require both implementations plus reviewed device/cohort evidence. WH-090/105/054/081/083 consume this contract rather than implementing their own session/recovery rules. This is decision evidence only; no deployed policy, schema or credential changed. WH-089 and WH-071 remain independent next contracts.
