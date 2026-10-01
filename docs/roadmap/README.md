# Whumpo product and delivery roadmap

**Prepared September 30, 2026. Baseline: `0544326`.** This is a proposed execution plan for the existing product contract, not a release, a change to pricing, or permission to activate services. The [review](review.md) separates implemented code from configured services and accepted customer journeys. Latest deployment facts in that review are **recorded repository evidence**, not fresh cloud inspection.

Whumpo should first become a dependable way for an invited customer to create, improve, publish and recover a useful website or bounded application. The next investment should turn its substantial foundations into operated customer journeys. Broader Cloudflare capabilities follow demonstrated demand and measured economics.

## Start here

- [GitHub execution hub](https://github.com/zemdregon/whumpo/issues/2): nine initial task issues, claims, progress and handoffs. The complete longer-term plan remains in the backlog below.
- [Full backlog](backlog.md): every task, dependency, acceptance criterion and verification boundary.
- [Canonical task data](backlog.json): stable `WH-001` IDs for agents and automation; generated Markdown is never edited directly.
- [Agent execution guide](execution.md): selection, coordination, implementation, evidence and handoff.
- [Product/architecture review](review.md): strengths, current limits and source evidence.
- [Tooling research and decision](tooling-decision.md): why Git plus GitHub Issues fits now, and when Projects or Linear would help.

Run from the repository root:

```sh
node tools/roadmap.mjs validate
node tools/roadmap.mjs next
node tools/roadmap.mjs show WH-001
```

`next` shows **planning candidates**, not live availability. Read the mapped GitHub issue and dependency evidence before claiming work. GitHub Issues owns current execution state; JSON owns the specification, sequencing and readiness. There is no automatic deployment, issue synchronization or external call in this tool.

## Product direction and boundaries

The initial focus is US-based individuals and small businesses who need a useful site, a contact flow, or a small authenticated application without managing infrastructure. This is a planning hypothesis to validate through the beta, not an established customer segment or evidence of product-market fit. Prioritize the static/text website journey first, then approved photo sites and a small application catalog. CMS is a separately gated lane whose testing the owner has paused.

Preserve the existing product choices: Chat-first workspace, guided first project, passkey-first identity, private drafts, exact human publication/activation reviews, retained versions and recovery. Preserve private R2, separate platform/site/visitor/runtime Workers, bounded QuickJS execution, tenant ownership and immutable receipts. Models may prepare an action; they cannot grant authority to execute it.

Standard AI remains unlimited under fair use, with zero customer-unit debits for standard assistance. Advanced models require explicit funded approval. Financial Monitor remains the default; content safety always applies. Current paid-tier prices and resource allowances remain proposals until commercial fulfillment and economics are accepted. No proposed feature inherits spending authorization from the existing Workers Paid subscription.

This plan does **not** silently narrow the original [MVP contract](../mvp.md). A bounded beta can omit disabled capabilities with an explicit scope decision. Claiming the full MVP still requires the contract's domain purchase, paid lifecycle, optional account integrations and complete verification; WH-049 records that gate. Any permanent scope removal needs an owner amendment.

## Delivery sequence

Phases describe outcomes, not strict serialized teams or calendar promises. Dependencies in the backlog are the actual ordering constraints. Independent work can proceed in parallel; a phase is not complete because one of its tasks is done.

| Phase | Outcome and principal work | Exit evidence |
| --- | --- | --- |
| **F0 — Reliable delivery foundation** | Current capability inventory; focused checks; consolidated authorization review; multi-Worker release/recovery protocol; operational health; job orchestration decision. Build on the source/build guard already committed. | Current source/configuration/acceptance matrix; reproducible local profiles; review findings triaged; release and job-failure procedures demonstrated. |
| **F1 — Safe customer beta** | Real operated safety, privacy, physical-device identity, retention/export/closure, restore-aware deletion, incident response and measured capacity. | WH-048: supported paths accepted against one candidate release, external prerequisites fulfilled, named support ownership, recoverable failures and approved cohort/data scope. |
| **F2 — Useful websites and applications** | Better layouts and precise edits; photo workflow; typed app starters; maintenance UX; support; analytics; accepted Cloudflare/GitHub/custom-domain connections; CMS only after resumption. | Evaluated useful outcomes, first-publication funnel, repeat usage and support data; complete journeys for each advertised capability. Disabled integration lanes stay explicit. |
| **F3 — Commercial MVP** | Production inference/privacy route; authoritative resource ledger and finance; two complete cost periods; payment lifecycle; premium funding; domain purchase/annual benefits; accurate commercial presentation. | WH-049: all contract requirements and release evidence satisfied, verified economics and funded fulfillment. Stripe sandbox was resumed and accepted October 1; real-money activation remains gated. |
| **F4 — Measured expansion** | Proven bottleneck fixes, bulk migration, search, collaboration, selective connectors and an advanced-hosting decision. | Each promoted idea has demand, quality, cost, isolation, lifecycle and operations evidence. No date commitment before discovery. |

The critical beta path is **safety coverage and provider/operator readiness → private dispatch and complete gates → safety acceptance**, alongside **retention decisions → restricted preservation → closure → restore reconciliation**, **device identity acceptance**, and **release/incident/load evidence**. Missing provider access cannot be replaced with a mock and called complete. Commercial work has an unavoidable elapsed-time dependency on two complete measured finance periods.

## First execution queue

These nine planning-ready packets require no new paid service or customer mutation to begin. An individual packet can still encounter a decision or permission boundary as evidence develops.

| Order | Task | Why now |
| --- | --- | --- |
| 1 | **WH-001** — Current capability/evidence reconciliation | Stops agents rebuilding finished work or acting on superseded milestones. |
| 2 | **WH-010** — Safety coverage and missing boundaries | Defines the release-blocking work before adding more capability. |
| 3 | **WH-009** — Retention, deletion and export contract | Unblocks preservation, closure and defensible recovery promises. |
| 4 | **WH-003** — Focused verification profiles | Makes subsequent work reproducible without accidental live tests. |
| 5 | **WH-006** — Maintenance diagnostics | Exposes failed cleanup, unknown operations and silent backlog growth. |
| 6 | **WH-004** — Consolidated authority review | Validates current boundaries; this roadmap review was not a formal security scan. |
| 7 | **WH-020** — Outcome/cost benchmark and inference privacy | Grounds model selection and customer-data decisions. |
| 8 | **WH-024** — Owner journey usability/accessibility | Finds customer-blocking behavior before a beta cohort. |
| 9 | **WH-052** — Durable job orchestration decision | Chooses the minimum infrastructure needed for reliable background work. |

Start with WH-001 and WH-010 in parallel, plus WH-009 if a third lane is available. Then assign independent implementation and verification packets from the table. Keep one coordinator and at most two concurrent implementation lanes plus one verifier initially. Avoid parallel edits to `src/index.ts`, central Chat dispatch, shared migrations or the same feature contract. This is a coordination default, not a product limit.

Sizes in the backlog are relative uncertainty: **S** is one narrow decision/change, **M** is a coherent feature or journey, **L** crosses several state machines or needs staged delivery. They are not time estimates. Before starting an L item, make child issues that each produce a reviewable slice; retain the parent acceptance gate. Do not turn a multi-service launch into one unattended agent run.

## Release gates

| Gate | Required proof | Stop condition |
| --- | --- | --- |
| Current baseline | WH-001/002/003 and candidate source/build/schema manifest. | Unknown current release, stale generated assets, missing test setup or incompatible schema. |
| Authority and identity | WH-004/005; tenant/model/owner/visitor authority plus real-device entry/recovery. | Unresolved boundary failure or missing proof on an admitted identity path. |
| Safety and privacy | WH-010–017 and WH-020 for admitted formats/provider data. | Missing detector coverage, unavailable private scan provider, unoperated reporting/preservation or undisclosed model data use. |
| Lifecycle and operations | WH-006–009/018/019/050/059. | Unrecoverable unknown operations, unsupported deletion promises, failed restore or insufficient operating capacity. |
| Customer value | WH-024/025 and the supported site/app benchmark. | Users cannot complete the promised journey or unsupported work is represented as completed. |
| Commercial launch | WH-021–023/041–045/047 and WH-049. | Unverified costs, disabled payment provider, unfunded benefits, unsafe billing reconciliation or incomplete contract. |

Zero unresolved critical authorization or unsafe-serving failures is required for an admitted path. Numerical business targets below are **proposed initial measurement criteria**, not achieved metrics, billing promises or production SLOs. Adjust them explicitly after the first evidence baseline rather than silently lowering a gate.

## What to measure

| Outcome | Measurement and initial decision rule | Task owner |
| --- | --- | --- |
| First useful result | Invitation → welcome → private draft → owner-approved publication; record elapsed time, drop-off and owner usefulness rating. First target: at least 8 of 10 consenting beta participants complete their supported journey, with all failures categorized. Small-sample uncertainty must be stated. | WH-025/057 |
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
| Two complete measured cost periods | Instrumentation and synthetic reconciliation. | Verified commercial economic acceptance: WH-023/049. |

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
