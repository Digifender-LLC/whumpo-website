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
| **F3 — Commercial MVP** | Production inference/privacy route; authoritative resource ledger and finance; two complete cost periods; payment lifecycle; premium funding; domain purchase/annual benefits; accurate commercial presentation. | WH-049: all contract requirements and release evidence satisfied, verified economics and funded fulfillment. Stripe setup remains blocked until the owner resumes it. |
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
| Moderation provider eligibility, terms, budget and responsible safety/legal operator | Coverage, adapter contracts, restricted retention design and benign synthetic fixtures. | Real scanning/approval and customer beta safety acceptance: WH-011/012/017. |
| Physical devices and a reviewed disposable live identity | Test matrix and existing synthetic/browser checks. | Remaining actual-device/human Turnstile acceptance: WH-005. |
| Production AI data-use/privacy and model budget | Offline benchmarks and read-only provider research. | Confidential customer workloads and new paid provider/Gateway route: WH-020/021. |
| Customer Cloudflare consent and owned zone; customer GitHub App and repository | Existing code verification and exact configuration plans. | Real DNS/backup/hosting journeys: WH-031/032/033. |
| **Owner-deferred CMS testing** | General safety requirements/design; no resumed CMS feature acceptance by implication. | Provisioning, native customer acceptance, full provider CMS recovery and bulk migration: WH-038/040/039. |
| **Owner-deferred Stripe connection** | Local financial design and shadow usage; no provider account creation. | Payment activation, funded commercial benefits and full commercial MVP: WH-041 onward. |
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

## Appended architecture direction — configure and compose first

**Owner decision, September 30, 2026; extension planned against `ba6dfc5`.** Whumpo should assemble and operate a shared, maintained platform: **configure existing capabilities first, compose them next, generate only the missing custom code, and allocate dedicated infrastructure only when the workload requires it.** Reduce duplicated implementation and idle capacity while preserving separate customer data, permissions and execution boundaries. Invest in this before marginal model-price optimization; existing safety, privacy, reliability and funded-spending requirements still apply.

The complete design is in [composition architecture and operating strategy](composition-architecture.md). New packets **WH-064–WH-080** are appended to the [backlog](backlog.md) under **F5 — Configuration and shared capabilities**. F5 is an appended workstream, **not** a requirement to finish F0–F4 first. Begin the P0 [specification decision, WH-064](https://github.com/zemdregon/whumpo/issues/12), now alongside existing release prerequisites; avoid expanding unrelated premium-routing experiments before that foundation. Implementation is proposed unless the feature contract records delivery.

### Whumpo AI is the owner's maintainer

Whumpo's agent chats with the owner and maintains the owner's project. It is **not wired into customer website or service execution**. Visitors, form submissions, appointment rules, background business jobs, webhooks and scheduled service checks must not invoke that agent, start a maintenance conversation, borrow its tools/context/credentials or consume its inference funding. Published pages and standard services must keep working when the maintainer model is unavailable.

A customer may later explicitly connect their own model, or a separately exposed Cloudflare AI Gateway/Workers AI capability, to their website or service. **WH-079** is a deferred design packet for that separate option: project-scoped authorization, server-held credentials, quotas, privacy, receipts and customer-approved costs. There is no fallback to Whumpo's maintainer provider or owner-assistance allowance. The initial automation catalog contains deterministic rules and actions, with no agent/model step. AI Gateway configuration alone supplies neither a model nor funding.

### Make the project specification the normal change surface

Each project should retain a validated, versioned specification covering pages, presentation, enabled modules, content/data schemas, permissions, integrations and deterministic automation rules. The agent proposes supported operations with explicit inputs/outputs; trusted software validates and compiles them. Configuration cannot invent new fields, embed arbitrary executable expressions or change infrastructure directly.

**Understand → propose specification changes → validate permissions and compatibility → compile/preview → apply the exact reviewed change → record an immutable version.** Existing publication, visibility, permission, data-migration and spending reviews remain in place. Deterministic compilation can produce HTML, forms, API clients and exportable source without model-written equivalents. Every configuration change still needs appropriate checks, a receipt and a compatible rollback plan.

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

Maintained module versions require compatibility tests, controlled upgrades, migrations and rollback. Starter copies remain useful, but a collection of diverged copies is not a maintained shared module. Promote recurring functionality only after deliberate rights, privacy, provenance and security review; never harvest private customer code automatically.

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
| Foundational placement and isolation | WH-071–075 | Workload placement, project data lifecycle, model-independent serving, pooled builds and bounded shared capacity. |
| Sustainable operation | WH-076–078 | Maintained version governance, honest exports and complete outcome/cost measurement. |
| Separate optional research | WH-079 | Customer-configured runtime AI; no Whumpo maintainer access. |
| Connected proof, P0 | WH-080 | Specification-composed business-site/portal pilot with isolated data and zero visitor maintainer calls. |

Earlier WH-021/044 now explicitly describe **owner-maintenance** inference/funding; WH-053's optional runtime AI requires the separate customer route; WH-056/062 cannot become visitor-triggered agent workflows. WH-026/028 build on the new specification pipeline. This clarifies earlier scope rather than authorizing visitor AI or any new paid infrastructure.
