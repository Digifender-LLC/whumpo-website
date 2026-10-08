# Workload placement and logical resource contract

**WH-071 decision, October 1, 2026; source baseline `d9f5d26`.** [Execution issue #47](https://github.com/zemdregon/whumpo/issues/47). This freezes the interface and acceptance requirements for subsequent module, job, metering and export work. The [offline reference](../tools/prototypes/workload-placement.mjs) and [synthetic checks](../tests/workload-placement-prototype.mjs) exercise the decision. They are not imported by the product. No new resource registry, runtime router, provider, migration, customer export or entitlement is activated here.

## Decision

Keep shared D1, private R2 and the separate bounded QuickJS Worker as the initial storage/execution implementations. Prefer configured static content and maintained APIs. Add a broader runtime or dedicated resource only when a supported outcome cannot fit the existing boundary and measurement justifies its complete cost and lifecycle. A project does not receive a database or an always-running process merely because it exists.

Freeze **logical project/resource identities and module contracts before physical placement**. WH-067 implements narrow APIs and lifecycle adapters against the current storage. WH-072 can later change the physical adapter without changing those client contracts. WH-077 verifies the first portable subset against whatever adapters actually exist; it need not wait for a project-database fleet. WH-050/022 provide evidence for future placement decisions, not permission to purchase or a prerequisite for defining this contract.

Customer-controlled source stays outside the privileged platform Worker. Shared APIs contain maintained, versioned platform code; they do not evaluate customer code or arbitrary SQL. Visitors, deterministic rules and jobs never invoke the owner maintainer, borrow its context/credentials, or fund inference through standard assistance. An optional customer AI capability remains a separate, explicitly funded WH-079 contract.

## Current evidence and boundaries

| Source | Current behavior | Constraint on new adapters |
| --- | --- | --- |
| [Site host](../src/site-host.ts) | Resolves current publication/version from shared D1; private R2 photos require the exact project/version relationship and safety/byte checks. | A static *workload* currently still incurs host/DB work. WH-073 must preserve withdrawal, safety and private preview behavior before optimizing delivery. |
| [Project specification](project-specification.md), [service clients](../src/project-specification/service-clients/v2/core.ts) | Immutable content and fixed contact/stateless-form configuration, pinned compiler artifacts, separate publication/contact/backend/form revisions. | Configuration is not activation. General records/staff/files APIs remain WH-067 work. Do not reinterpret historical specs or treat one spec revision as all authority. |
| [Visitor data](app-data.md), [gateway](../src/app-gateway.ts) | Bounded visitor documents and reviewed program execution with project/visitor ownership, request receipts and state revisions. | Preserve its state/quota/replay atomicity; it is not a general records database or reusable owner session. |
| [Runtime](../src/runtime/worker.ts), [configuration](../wrangler.runtime.jsonc) | Service-only QuickJS; fresh Wasm memory/runtime/context per call, no host callbacks/network/filesystem/timers or storage bindings. JSON input/output only. | Keep this boundary. The engine accepts at most 32 KiB source, 8 KiB input and 16 KiB output, 4 MiB heap and bounded interrupt/job counts. Existing [version intake](../src/backend-versions.ts) is stricter: 8 KiB source. The per-isolate concurrency counter is not account-wide fairness. |
| [Lifecycle decision](data-lifecycle.md), [release protocol](releases.md) | Classified retained data and restore/deletion requirements; immutable release recovery evidence. | Retention proposals remain proposals. Module hooks must reconcile all retained copies and unknown effects; code rollback does not restore data or unsend messages. |

The completed WH-064/009 issues satisfy their recorded decision scopes. They do not prove future module schemas, provider entitlements or live acceptance. CMS keeps its existing registry and separate contracts; its functional testing remains deferred. CSAM implementation and Daybreak remain deferred.

## Workload admission classes

Classification is a trusted planning result after checking the maintained capability catalog and the required behavior. A model or visitor cannot select a provider by supplying a class or flag.

| Class | Delivery path / fit | Admission and fallback |
| --- | --- | --- |
| Static content | Current reviewed site host; later eligible immutable assets under WH-073. Landscaping pages, galleries and public text. | No per-project database/process. Content, media and publication gates remain. Private or revocable content cannot acquire a public cache fallback. |
| Maintained API | Existing fixed contact/photo/directory/visitor contracts; new typed modules under WH-067. | Resolve a delivered capability/version, scope each operation, apply per-record/field/file policy and bounded budgets. Unsupported module configuration returns unavailable; it does not generate a replacement backend automatically. |
| Isolated custom function | Current QuickJS for small JSON calculations and reviewed state transformations. | Fit both gateway and engine limits; bounded work, no outbound/host access. Saved artifact, safety, test and exact activation review required. Guest output is data, never instructions to grant access. |
| Broader isolated function | Candidate Workers for Platforms (WfP), with Dynamic Workers evaluated alongside it under WH-055. | Only a demonstrated capability gap. Separate entitlement, full cost, threat/lifecycle, quotas, network and exact activation review. A larger source file is a review reason, not permission to deploy it elsewhere. |
| Native batch / persistent process | Candidate short-lived isolated Containers for native build/media work; sustained workloads compare Containers with a separately quoted VM. | Measure active duty cycle, CPU/memory/disk/egress, cold start and recovery needs. Native code does not automatically require always-on hosting. No permanent per-project builder. Requires explicit activation and funded bounds. |

For broader custom routes, plan one **project + environment + immutable release bundle** with a route manifest. Split only for a demonstrated different trust boundary, resource budget or lifecycle. Do not deploy one paid script for every field, form or tiny feature; never bundle different projects into one guest authority. Registry resolution chooses the approved release; URL paths never become script names or provider resource IDs directly. Retain old artifacts for reviewed recovery without leaving them publicly invocable. Bundle reuse never implies cross-project cache or secret reuse.

## Logical contract v1

The executable descriptor schema is `validateDescriptor` in the offline reference. Its bounds (32 KiB JSON, depth 16, 32 owned data sets/assets, 16 dependencies, one exact current schema per descriptor, 64 resources per fixture manifest) constrain the decision examples. They are not new customer entitlements or a claim that larger projects are implemented. Production APIs must additionally bound transport bytes before parsing. Expanding a schema/bound requires a reviewed current-contract cutover, never silent truncation.

### Identity and physical resolution

- `ref = {projectId, resourceId}`: the existing immutable project UUID plus a server-assigned resource UUID. The pair is the lookup identity; it grants no permission. Keep existing file/version/visitor IDs distinct. A resource UUID identifies a logical module instance, not a database, bucket, row prefix, hostname or deployment. Do not reuse it after deletion.
- Current ownership resolves through `projects.owner_user_id` and the relevant membership/visitor policy on every authorized path. Owner identity is deliberately absent from the stable reference; a separately authorized ownership transition must not rename data. This contract does not implement ownership transfer.
- `module = {name, version, digest}` and `schema = {name, version, digest}` pin exact maintained artifacts and the write schema. Positive integer versions, lowercase identifiers and SHA-256 digests are required. Unknown names/versions/hooks or mismatched bytes fail catalog resolution, even if their JSON shape is valid. A digest alone does not establish provenance or license permission.
- Logical references may appear in specs, jobs, receipts and cost attribution. **Physical locators stay server-only**: D1 binding/database IDs, R2 bucket/object keys, runtime service/namespace/script IDs and credential references live behind a trusted registry/adapter. They are absent from model configuration, client descriptors and portable manifests. No secret value belongs in any descriptor.
- Implementation creates current project-owned records explicitly. Preserve current UUIDs and exact current receipts for retained records, or reset obsolete test fixtures. Do not implement a legacy publication/visitor adapter before the registry. No new customer database or rebinding is implied.

### Minimum descriptor fields

| Field | Frozen meaning |
| --- | --- |
| `contractVersion` | `1`; unknown fields/versions fail closed. |
| `ref`, `kind` | Stable reference; kind is content, records, files, access, notifications, automation or custom-function. These are contracts, not delivery claims. |
| `module`, `schema` | Exact artifact pins; never `latest` or a floating range. |
| `ownership.data[]` | Logical data-set `id`, lifecycle `classId`, `subject` (project or visitor), and export eligibility (eligible, separate-approval, excluded). IDs resolve maintained selectors, never caller-provided SQL/table names. Visitor data cannot be ordinary eligible project content. |
| `ownership.assets[]` | Same-project logical file-resource references; each must be a pinned dependency of kind files. Actual export snapshots additionally enumerate eligible file IDs, byte counts and digests. A resource reference is not permission to read every object. |
| `dependencies[]` | Same-project resource reference and exact module pin. Missing, foreign, duplicate, self or cyclic dependencies fail. Cross-project template reuse copies verified public artifacts into a new owned instance; it never links private live resources. |
| `lifecycle` | Export format version, export/delete/restore/migrate hook IDs, and portability classification. Hooks resolve only from the pinned maintained catalog, not URLs, scripts or model function names. Export hook can be null only when no owned data/assets are exportable. Classification is not-verified, adapter-required or platform-only; none claims a running standalone application. WH-077 records fresh acceptance and versions any expanded classification. |
| Current schema admission | The single `schema` pin governs read, write and restore. Old `compatibility`, `readSchemas` and `restoreSchemas` fields are rejected. An adapter must match the exact current schema name/version/digest; a shape-valid pin still needs trusted catalogue admission. |

Lifecycle classes must define purpose/readers, current and proposed retention, deletion authority, key custody and allowed processing under WH-009/116. Unknown classes block implementation admission. Visitor identity, credentials, held evidence and internal billing/security receipts require separate classes and filtered handling. In particular, general records must not silently extend existing 30-day contact retention. The offline validator checks structural references; the implementing module must prove the hook/class behavior with actual persisted data.

### Scoped adapters and operations

`resolveResource(verifiedContext, ref, expectedModulePin)` is the **server-side** boundary. The returned adapter is already restricted to one logical resource, verified actor/audience and permitted operations. This notation specifies an interface obligation; no such generic resolver is deployed by WH-071.

The context comes from the existing authenticated owner session, separately authenticated app visitor, current published public policy, or a server-created deterministic job. It includes verified project/resource identity, the allowed operation, applicable current domain revisions and the invocation budget. It is neither a client JSON attestation nor model-supplied `ownerId`, role or `approved` flag. Preserve WH-113's enrollment/recovery authority and WH-090's entitlement resolver; published serving keeps its own hosting/access contract. An owner workspace plan check is not visitor authentication.

| Adapter surface | Narrow operations | Mandatory implementation evidence |
| --- | --- | --- |
| Records | Get/list by registered view and opaque scoped cursor; create/update/remove by schema with expected record revision and request ID. | Project/visitor/field policy inside every query/write. No raw SQL, arbitrary predicates or caller-selected DB. Validate fields and recheck authority atomically with mutation where stored together. |
| Files | Prepare bounded upload, finalize exact bytes, read an eligible immutable file/version, request reviewed deletion. | Private bucket; scoped metadata, quarantine/safety, digest/size checks and reference-aware cleanup. Prefixes are not authorization. URL or stale manifest possession is insufficient. |
| Execution | Invoke a pinned reviewed program/version using bounded JSON and a server-owned invocation receipt. | Guest receives only the permitted data; current QuickJS receives no storage/network/context handle. State proposals commit through the existing gateway with current program/visitor/data revisions and quota guards. |
| Notifications / deterministic jobs | Submit an approved action intent; inspect/cancel the same receipt. | Current recipient/connector scope, dispatch claim, replay identity and unknown-outcome reconciliation. Neither arbitrary fetch nor AI repair is an operation type. |
| Lifecycle | Describe owned data; prepare/perform eligible export; prepare/apply migration or restore; withdraw and delete eligible copies. | Hooks use the same scoped authority, version locks, holds and receipts as normal operations. Retention or a copied “approved” field cannot authorize destruction. |

Every effect binds a stable request ID, input digest, logical references, exact artifact/descriptor pins and the relevant current revisions. Same identity + same scope/input retrieves the existing result; reuse with different input/scope fails. Results/errors are bounded, content-minimized and typed: unavailable, forbidden, stale, incompatible, limited or unresolved. A timeout/unknown outcome cannot return success or invite a new mutation. Replays recheck current permission before exposing an old result.

Spec, publication, backend review, contact/form, visitor state, identity, connector grant and future placement revisions remain separate. Resolve/check at admission **and** at commit/delivery. Use existing atomic same-D1 guards where available. Across services/databases, use fenced claims and revalidation through a domain receipt; never imply a distributed transaction. A stale registry/cache cannot allow writes through a retired adapter. Cursor/result caches bind project, audience, policy and version; authorization changes invalidate reuse.

Service boundaries must authenticate the trusted caller and derive scope on the receiving side. An internal hostname or a forwarded owner header is insufficient. For future WfP, a narrow per-request capability can be considered; no guest gets the shared D1/R2 binding, all-tenant credentials or an unrestricted platform service binding. Current QuickJS remains JSON-only.

## Placement registry and migration hooks

WH-072 owns the actual registry/provisioning implementation. A reviewed entry maps one logical reference to a physical adapter, schema/artifact pins and a monotonic **placement revision**. Keep provider intent/receipt, resource state and prior physical-placement evidence separately from the module descriptor. Physical moves do not rewrite logical IDs, historical cost events or saved client manifests. A registry row alone cannot establish a Worker binding or network isolation.

Required transition protocol:

1. **Prepare:** measure the need; record exact source/target, snapshot/cutoff, module/schema pins, permission/safety/suppression watermarks, expected revisions, cost and forward-recovery criteria. Authorize the precise operation. Unsupported adapters fail before mutation.
2. **Provision/reconcile:** claim one durable intent. Use provider idempotency where supported and exact resource tags/receipts to resolve a lost response. An uncertain create stays unresolved; do not create a second database/container speculatively.
3. **Copy and verify:** use an authorized consistent snapshot of the current schema and scoped assets. Compare counts/checksums and representative behavior. Keep the target private and apply deletion/permission/safety changes since the snapshot. Do not copy real visitor records into ordinary preview fixtures.
4. **Drain/fence:** stop new source writes and settle or hold outstanding operations. Initially prefer a bounded reviewed maintenance window. No implicit dual-write protocol. Jobs re-resolve the current placement rather than persisting a DB connection.
5. **Cut over:** compare-and-swap the expected placement revision only after target verification and source-write fencing. Readers and writers must use a coherent admitted version. Old writers reject stale placement; ambiguity holds affected operations rather than writing both targets.
6. **Observe/recover:** inspect the actual source/target and current write state, then prepare a reviewed forward repair or current-schema restore. Reset obsolete test encodings instead of adding an old reader. Never blindly point to the pre-cutover copy or revive an old module/runtime. Keep unresolved external effects and funding holds visible.
7. **Retire:** revoke old bindings/routes, reconcile all copies/backups/late writes and delete only eligible owned resources. Record final provider confirmation and independent restore suppression. Shared buckets/databases and customer-owned external resources cannot be dropped as part of one project's deletion.

Status must distinguish prepared, provisioning, verifying, ready, migrating, held, retiring and deleted. Deleted means confirmed eligible removal, not merely access denied. An unavailable key, unknown provider result or retention hold blocks the relevant transition and must be surfaced. Implementing work must test lost responses, stale/concurrent revisions, partial copy, old writers, deletion during migration, forward recovery after new writes and restore suppression.

## Export and restoration boundary

The module descriptor exists **before** its first storage schema ships. Export preparation snapshots exact logical resource IDs, module/compiler/dependency pins, schema/migrations, permitted data-set selectors, authorized asset IDs/digests/bytes, declared external requirements, exclusions and hook versions. WH-067 implements each initial adapter's serializer/import validation with its schema; WH-077 composes them and proves an advertised portable subset in a clean target without Whumpo APIs or maintainer inference.

Data/source eligibility is distinct from runnable portability. A files descriptor is not a download grant; an export of access-role configuration excludes sessions, passkey/recovery material and credential values. Visitor/contact datasets need separately scoped authorization. Exclude other tenants, held material and internal platform/provider secrets. Reauthorization/configuration instructions replace provider credentials. Export does not remove the original, transfer a subscription or authorize publication at the destination.

Restore checks exact saved bytes, module licenses/pins, readable schema and supported transform, then reapplies current safety, revocations and independent deletion suppressions before serving. Do not resurrect old approvals or claim a provider backup contains all required object bytes/keys. Restore/deletion acceptance remains WH-019/059/072/077; this descriptor is not that implementation. Unknown or unimplemented hooks return unsupported and leave the current project unchanged.

## Provider review — October 1, 2026

Public documentation was retrieved on this date. These are planning inputs, **not verified Whumpo account entitlement/headroom**, a customer quote, or an activation. Included usage is account-wide. Recheck prices, regional availability, terms and limits against the exact proposed configuration before spending.

| Candidate | Current documented price/limit inputs | Whumpo decision |
| --- | --- | --- |
| [WfP pricing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/pricing/), [limits](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/limits/) | Separate $25/month plan; 20M requests, 60M CPU ms and 1,000 scripts included. Overage $0.30/M requests, $0.02/M CPU ms, $0.02/additional script/month. HTTP CPU cap 30 seconds. User Workers currently lack gradual deployments. | Candidate only; account floor and retained release scripts count. Use immutable release names and a separately verified dispatch cutover/recovery design. Do not assume Workers Paid includes this plan. |
| [WfP isolation](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/worker-isolation/), [bindings](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/bindings/), [outbound](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/outbound-workers/) | Default untrusted mode isolates customer caches. Outbound Workers mediate fetch; TCP connect is disabled when configured. They do not intercept Durable Object or mTLS-binding fetches. Bindings persist across invocations; per-request RPC capability passing is documented separately. | Keep untrusted mode. Explicit allowed egress/destinations, no redirect-to-private-network bypass, credential stripping, subrequest/CPU/output quotas and **no bypass bindings**. Validate all channels before a broader guest capability is offered. |
| [Dynamic Workers](https://developers.cloudflare.com/dynamic-workers/pricing/) | Workers Paid required. Request/CPU share Workers billing; startup also counts as CPU. Creation pricing counts ID + code per day: 1,000 creations included per month, then $0.002 each/day. Missing stable IDs can charge each invocation. | WH-055 comparison candidate; not a free drop-in replacement. Model release churn, stable per-project version IDs, isolation/capability controls and full service costs before choosing. |
| [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [limits](https://developers.cloudflare.com/d1/platform/limits/) | Paid includes 25B read rows, 50M written rows and 5 GB; excess $0.001/M reads, $1/M writes, $0.75/GB-month. Paid limits: 10 GB/database, 50,000 databases, 1 TB/account and approximately 5,000 bindings/script. Individual primary queries serialize. | No per-database rent; no reason to create databases for static sites or collapse them merely to reduce count. Separate heavy app data only after contention, query, binding/fleet and recovery measurements. |
| [Static Assets](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/) | Direct asset requests and asset storage carry no additional charge; Worker-first handling invokes billable code. | Existing platform assets use this; current customer HTML goes through the site host. WH-073 must measure and prove revocation before changing that path. |
| [R2 pricing](https://developers.cloudflare.com/r2/pricing/) | Standard storage $0.015/GB-month, Class A $4.50/M, Class B $0.36/M, direct egress free; monthly allowances and billing-unit rounding apply. Other storage classes have different retrieval/retention terms. | Keep private shared storage. Attribute serving, scanning, versions, backups and control work separately; a free egress line is not a complete hosting cost. |
| [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/), [limits](https://developers.cloudflare.com/containers/platform/limits/) | Workers Paid required. Excess active CPU $0.000020/vCPU-second, provisioned memory $0.0000025/GiB-second and disk $0.00000007/GB-second while running. Included: 375 vCPU-minutes, 25 GiB-hours, 200 GB-hours/month. Worker, Durable Object, egress and logs also bill. Predefined basic: 0.25 vCPU, 1 GiB RAM, 4 GB disk; largest predefined: 4 vCPU, 12 GiB, 20 GB. | Evaluate short-lived native jobs first. Sleep stops container resource charges; memory/disk still cost money while an otherwise idle instance is running. Persistent data, image retention, restart/recovery, egress isolation and cleanup need a complete design. |
| VM alternative | No provider or quote selected; price, region, terms and support obligation remain **unknown**. | Request an exact reviewed quote only for sustained/native need. Compare reserved CPU/RAM, durable disk, snapshots/backups, outbound traffic, addresses, security updates, monitoring, failover and operator time. No purchase or non-Cloudflare deployment is authorized here. |

### Sustained versus sleeping cost example

Use a **720-hour / 30-day month**, basic container dimensions, and marginal rates without assigning shared included usage to every customer. At full 0.25-vCPU utilization: CPU $12.96 + memory $6.48 + disk $0.72576 = **$20.17/month** resource subtotal. Running 72 hours gives **$2.02**; staying alive for 720 hours with zero active CPU still costs **$7.21** for memory/disk. The offline checks calculate these values. Egress, Worker/DO, logs, builds, scans, retained images, backups, retries, support and account floors are additional; these are not complete offers or plan allowances.

For a VM comparison use `quoted compute + disk + backup + egress + network + security/monitoring + expected support/failure reserve`, with tax and minimum commitment recorded. Container comparison uses the measured duty cycle plus the same support/recovery categories. Select only after the complete quote and measured service requirements fit the approved funding envelope with headroom. Do not choose a VM because a headline monthly price beats an incomplete container subtotal.

[Resource economics](resource-pool-economics.md) remains a proposed capacity model. Standard AI has zero customer-credit debits and remains an additional internal cost. WH-022 attributes request/CPU/storage/operation/build/recovery costs to logical project/resource + service/version + period, keeping unknown dimensions explicit and avoiding duplicate shared-allowance credits. WH-050 supplies shared-account limits and fairness. Monitor mode does not waive workload safety/isolation or activate paid resources.

## Synthetic compatibility and rejection evidence

`node tests/workload-placement-prototype.mjs` runs **60** offline checks with invented UUIDs and hashes. These establish schema/planning examples, not runtime security, migration, export or customer acceptance.

| Scenario | Expected decision / rejection |
| --- | --- |
| Landscaping static site | Current host; no database/process provisioning. |
| Maintained contact operation | Shared API candidate; requires delivered capability and current scoped authority. |
| Small calculator / exact 8 KiB source bound | Current QuickJS candidate; existing review and gateway budgets still required. |
| Source above intake, oversized input/output, outbound need or unbounded work | Broader-isolation review; no automatic dispatch/activation. |
| Native video batch or persistent process | Container/VM comparison and measured-need gate. |
| Maintainer inference or raw shared connection in visitor requirements | Rejected regardless of cost or tier. |
| Shared D1 → project D1 offer with same exact descriptor | Same logical reference/digest; compatible offer grants no authority and performs no migration. |
| Foreign project/resource, changed module or schema, raw physical locator | Rejected. Neither older nor newer schema offers match the exact current pin. |
| Missing lifecycle/export hook, floating pin, forged portability | Rejected. Separate visitor export is explicit. |
| Missing/foreign/cyclic dependency or non-file asset reference | Rejected. Two projects may use the same local UUID without sharing identity. |
| Current engine/gateway boundary changes | Source anchors require this decision's limits to be reconciled. They do not replace execution isolation tests. |

No model calls, Cloudflare resources, runtime source/config changes, database migrations, customer data reads or CMS tests are needed for this decision. Run roadmap validation/alignment/render checks and inspect the patch. Production conformance must test the actual domain handlers and persisted state; a well-shaped descriptor or a green prototype test never substitutes for authorization.

## Delivery handoff

- **WH-067:** implement each narrow API and initial shared-D1/private-R2 adapter together with its exact schema, lifecycle class/hooks, pin/catalog registration, export serializer and two-project/visitor/staff isolation tests. Use WH-090 eligibility and WH-105 interaction contracts. Keep current supported gateway semantics.
- **WH-052/018:** use logical references and descriptor pins in durable jobs; retain authoritative domain receipts, current actor scope and unresolved outcomes. Do not store live provider connections in a job.
- **WH-022/050:** attribute costs/fairness to stable identities; measure contention and total successful-work cost before physical moves. This packet does not introduce billing.
- **WH-072:** implement the reviewed registry/migration protocol and actual adapter/binding limits; prove fencing and restore-aware deletion before activation.
- **WH-073/074/075:** preserve resource identity and publication boundaries in asset delivery, private storage and pooled builds. New placement cannot bypass current safety or reveal private cache contents. WH-074's source implementation ([build jobs](build-jobs.md)) keeps builds on the shared stateless QuickJS runtime with no per-customer always-on capacity, separates the shared toolchain key from private artifact keys, and leaves Containers as an owner-gated, unconfigured option.
- **WH-055/079:** evaluate broader isolation and optional customer runtime AI separately. No maintainer fallback, exposed platform credentials or implicit provider funding.
- **WH-077:** consume descriptors already shipped with modules, enumerate actual exclusions and prove the claimed portable subset. Reclassify portability only with fresh clean-target evidence.

The WH-071 decision is complete when the contract/scenarios, dated provider review and downstream references are checked and merged. Those evidence boundaries leave the larger roadmap and the above implementation/activation work open.

## Current-only contract amendment — October 1, 2026

WH-120 removes the descriptor's read/restore compatibility lists and the proposed legacy placement adapter. `schema` is now the only read/write/restore shape; retired compatibility fields and mismatched version/digest offers reject explicitly. The trusted module catalogue must still establish that a pin is the current supported artifact; the offline shape checker does not provide that authority. Physical placement can change behind an exact current contract, using reviewed fencing/readback and forward repair. Obsolete test encodings may be reset; no old schema decoder is retained.

This changes only the offline decision reference, fixtures and implementation contract. No Worker imports the reference; no provider, database, customer site or runtime is changed. Historical acceptance above records the previous decision scope.

## Standard-service independence evidence (WH-073, slice 1) — October 8, 2026

**Verification only.** No Worker, schema, cache, delivery or placement behavior changed. WH-073 stays open; this slice records the first offline proof that standard visitor and service routes never reach owner-maintenance (Whumpo AI) model inference.

**Route inventory covered.** Sites Worker (`src/site-host.ts`): published site root (GET/HEAD/POST/unknown host), `directory[.json]`, `cms`, `assets/<id>.jpg`, unknown paths and the guest-preview host's bearer refusal. Apps Worker (`src/app-host.ts` → `src/app-gateway.ts`): the visitor page and an unauthenticated module call, also reached through the sites Worker's visitor-host route. Platform Worker visitor paths: `/contact/<project>` form and submission, and the three scheduled crons (`* * * * *`, `47 * * * *`, `17 3 * * *`). Cache behavior: published, unpublished and safety-held responses are checked for `cache-control: no-store` and no `public`, `max-age`, `s-maxage`, `ETag` or `Last-Modified`.

**What is proven.** `node tests/standard-service-no-maintainer.mjs` (SQLite) and `--d1` (local D1; `pnpm test:standard-service-no-maintainer` runs both, and `node tools/verify.mjs site` includes the SQLite run):

- `src/site-host.ts`, `src/app-host.ts`, `src/app-gateway.ts`, `src/runtime/worker.ts` and `src/contact-page.ts` reach no module matched by the shared `inferenceModules` pattern (`tests/helpers/maintainer-inference.mjs`, an esbuild import-graph check). The platform entry `src/index.ts` is checked as a positive control: it does reach `src/ai.ts` and the Chat callers, so the detector fires. The scheduled handler lives in that entry, so its proof is the runtime count below, not the import graph.
- A published site is created with the current specification transaction builders, not the model. With `fetch` replaced by a counting stub, the route inventory above plus unpublish, republish and a safety hold records zero network calls and zero `inference_calls`, `gateway_spend_attempts`, `gateway_spend_buckets`, `standard_ai_requests` and `gateway_inference_requests` rows. Visitor and scheduled requests create no Chat turns. No maintenance job fails.
- Two environments: no AI key or binding at all, and a fully configured provider that answers 503 (confirmed with `configuredAI`). Visitors succeed in both, and the provider is never called. The only `fetch` the stub passes through is site health re-reading a published site at its own `whumpo.site` origin, served by the real sites Worker.
- Unpublished and safety-held content stops serving with no cacheable response. Mutations (an inference import in `site-host.ts` and `contact-page.ts`, a provider `fetch` in the site root and the scheduled handler, a `public` cache header, a recorded spend bucket) each made the test fail.

**Not proven, still required by WH-073.**

- Any cache, pre-render or direct-static-asset delivery change, and publish/restore/unpublish, permission and scanner-revocation cache tests against such a change. Site-host still returns `no-store`, so this slice cannot show an optimization is safe.
- Request-path cost: direct-asset versus Worker-routed counts, and cold/warm measurements.
- Exhausted owner premium or standard balance semantics. Only an unavailable and a failing maintainer are exercised; no balance is set.
- Customer-configured model extensions (WH-079) and the runtime Worker's execution path; only its import graph is checked.
- Live behavior: no deployed Worker, Cloudflare binding, real provider outage or customer data is involved. Everything is local and synthetic.
