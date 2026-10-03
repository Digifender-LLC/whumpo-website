# Executing the Whumpo roadmap

This guide supplements [AGENTS.md](../../AGENTS.md). Feature contracts remain authoritative for behavior. The [roadmap](README.md) sets outcomes and [backlog.json](backlog.json) owns task specifications/dependencies. GitHub Issues owns live execution state for mapped tasks. No roadmap task authorizes payments, new paid services, customer DNS changes, customer code deployment or deferred provider activation by itself.

## Select and claim a task

1. Read `README.md`, `AGENTS.md`, `docs/roadmap/README.md` and the task's referenced feature contracts. Inspect `git status`, current commit and any concurrent changes. The roadmap source commit is a review baseline, not a requirement to work on stale code.
2. Run `node tools/roadmap.mjs validate`, `node tools/roadmap.mjs alignment` and `node tools/roadmap.mjs next`. Use `show WH-001` to read one complete packet without loading the entire backlog. `ready` only means sufficiently specified; it is neither an execution lock nor a completion claim.
3. Refresh the mapped issue, assignee, comments, dependencies and linked PRs. Search by permanent `WH-xxx` before creating anything. Check for an implementation already delivered since the review. A dependency is satisfied by its specified deliverable and evidence, not merely by a closed issue (especially one closed as not planned).
4. Have one coordinator allocate parallel work. A claim records agent/chat identifier, branch/worktree, scope and expected handoff in the issue; assign only the actual responsible user/agent if supported. Re-read after claiming to catch collisions. Issue comments are coordination records, not atomic locks. Do not auto-assign paid agents or send unrelated messages.
5. For an unmapped task, refine its scope and external prerequisites first, then create/locate an issue and save its URL in the backlog. For large tasks, create small child issues and dependency links; retain the parent exit criteria. If GitHub is unavailable, use one explicit local coordinator/claim record and reconcile before parallel work resumes.

```sh
gh issue list --repo zemdregon/whumpo --state all --search 'WH-001 in:title' --json number,title,state,url
gh issue view ISSUE_NUMBER --repo zemdregon/whumpo --json title,body,state,stateReason,assignees,labels,comments,blockedBy,blocking,closedByPullRequestsReferences,url
node tools/roadmap.mjs show WH-001 > /tmp/whumpo-task.md
```

Native GitHub dependencies are a projection of JSON ordering. When dependencies change, update the canonical JSON and relevant issue links together. Do not build a bidirectional status synchronizer. GitHub Projects, if later authorized, is only a view of these issues.

## Plan the smallest complete slice

Write the concrete before/after behavior and check the packet's assumptions against current source. Avoid duplicate implementations based on old milestone text. Name the files/state machines affected, the negative cases that matter, the necessary verification and any final activation step. `scope` and `acceptance` in the packet define the boundary; broad feature expansion, provider setup, purchases and deployments are not implicit additions.

For an L task, decompose first: contract/schema, isolated implementation, connected local journey and live activation often need separate deliverables. Do not mark a parent finished because its first foundation is present. Use existing patterns and dependencies; keep frontend source authoritative and preserve concurrent work. Use isolated branches/worktrees for simultaneous implementation, and coordinate canonical schema inputs and the exact empty-database cutover before a schema change.

Ready packets are safe to **begin**, not preauthorized for every future side effect. Complete local preparation and an exact reviewable configuration/resource/cost plan before asking for a missing decision. Keep independent work moving. Stripe sandbox setup was resumed by the owner on October 1, 2026; real-money activation remains gated. Preserve CMS testing and CSAM scanner implementation deferrals.

## Tier extension and paid-launch ordering

The owner-approved [tier contract](../pricing-and-model-policy.md#accepted-tier-roadmap-and-paid-launch-gate--september-30-2026) adds WH-089–104 and promotes WH-054/056 before commercial launch. Creator keeps the `personal` identity. All cumulative benefits and seven selected connections must pass WH-104 before WH-047/049; implementation is not permission to offer a reduced paid subset. The bounded free beta and Android lane retain their existing gates, and real-money and CMS gates remain explicit.

Start WH-089 from the accepted matrix, not from the superseded additive suggestions. WH-090 extends the existing WH-042 subscription/coverage resolver, with explicit scoped preview grants. Do not create a second entitlement source. WH-042 sandbox implementation must not depend on the final launch gate. Keep provider-specific adapters downstream of WH-056 and platform delivery WH-036 independent of customer mailbox OAuth; do not reintroduce the former WH-049 dependencies on WH-054/056.

Split L packets into contract/schema, isolated implementation and connected acceptance children before claims. For connectors, distinguish synthetic work from separately blocked provider approval/consent/privacy/cost acceptance; keep the parent open until the whole selected journey is accepted. WH-064/065/066 and compiler children #15–17 are completed within their recorded initial scope. Extend those implementations for new modules; do not reopen or rebuild them. New packets are unclaimed with issue/owner null until normal execution coordination; preserved issue mappings are not new claims.

## Primary Chat experience ordering

The October 1 [experience contract](chat-first-experience.md) adds WH-105–112 in F2. After WH-113/089, start with the schema/journey contract, then durable interactions and the accessible template renderer. The first complete slice is an existing-project change brief, validated answers, private preview, exact existing review and saved receipt. Custom composition, agent-managed views and routine journey adapters follow without requiring new provider activation.

Reuse current Chat controls, domain handlers, transcript/readback and revisioned layouts. Owner Chat intake is distinct from WH-066/067 visitor forms and WH-070 customer-app presentation. Do not expose model-generated executable UI or infer approval from form submission. Simplify navigation only after the equivalent Chat journey and deterministic outage/recovery path pass connected checks. WH-009/025/058 cover lifecycle, content-free measurements and quality; WH-081/084 share the interaction protocol with a bounded native subset. WH-049 consumes WH-112, while bounded free beta WH-048 remains independent.

The October 1 [alignment](alignment.md) reconciles live issue state and current source with these packets. Refresh again before claims; accepted planning scope is not completed implementation.

## Identity and data protection ordering

The October 1 [identity and data protection contract](identity-and-data-protection.md) adds WH-113–118. Start P0/F1 WH-113 with the accepted product choices and current source; freeze server authority, resumable enrollment/recovery and current-only test cutover before implementation. WH-114 uses WH-113/004, and WH-115 follows with downloadable/printable recovery and restricted replacement enrollment. Preserve existing passkey/recovery concurrency safeguards and separate visitor identity. Do not treat the documentation amendment as an activated login policy.

WH-116 uses WH-113/009/121 to classify data, readers, processing, key custody and recovery, then WH-117 implements only justified transparent encryption/control changes using WH-004. WH-118 is P2/F4 feasibility, after WH-115/116, with compatibility, normal-sign-in and content-recovery criteria; it adds no mandatory private vault or beta dependency. Account recovery never implies reconstruction of lost content keys. Avoid routine unlock prompts while preserving explicit review and security boundaries.

WH-005 consumes WH-115 and keeps real-device/visitor acceptance separate. WH-048 additionally consumes WH-117; commercial acceptance inherits these gates. Native WH-081 consumes WH-113 and WH-083 consumes WH-115, preventing incomplete browser recovery from becoming native workspace access. Split large implementation packets into contract/current schema, connected checks and real acceptance before claims. Existing issue mappings/evidence remain authoritative only in their recorded scope; new packets have null issue/owner and no completion evidence. Preserve real-money and CMS gates and refresh live issue/dependency state before execution.

## Explicit completed-foundation handoffs

The October 2 [handoff alignment](alignment.md#completed-foundations-versus-cumulative-acceptance--october-2-2026-utc) separates reusable foundations from parent acceptance. WH-121 supplies current inference privacy/offline evidence to WH-116 while WH-020 retains real-model evaluation. WH-122 maps completed #65 and supplies shared inclusion/current identity admission to feature implementations; WH-090 retains cumulative collaboration/adapter acceptance and WH-104 still waits for it. Use these canonical dependency edges instead of the earlier broad-parent shorthand below. Do not reopen the completed foundations to implement future adapters or close their parents from synthetic evidence.

## Avoid later rewiring

Follow [the alignment contract](alignment.md) before adding a schema, authorization resolver, client API, dashboard or provider adapter. Task numbers are stable identities, not execution order. Freeze shared identity, feature, interaction, data and placement contracts first. Implement one domain handler per capability and register it with Chat/views/native clients. WH-036 platform delivery and WH-056 customer connectors share receipt principles but neither is the other’s prerequisite. WH-023 cost-period and WH-041 commercial acceptance gate activation, not offline sandbox/ledger construction. Do not expand a closed foundation’s acceptance retroactively; new data/module registrations belong to their implementing packet.

## Preserve the invariants

- Prefer low user friction with strong default protection. Reuse ordinary sessions, explain unfamiliar choices on demand and automate protection where possible; preserve tenant isolation, content-safety gates, recent authentication and consequential-action reviews. Follow the accepted [identity and data protection contract](identity-and-data-protection.md), including trusted recovery outside model context.
- Configure existing presentation/content/policy, compose maintained modules, then generate only the missing custom portion. Follow [composition architecture](composition-architecture.md); the appended F5 workstream starts with a high-priority specification decision and is not postponed until every earlier phase ends.
- Keep routine owner work in Chat. The agent composes forms and supporting views from trusted components; the server validates answers, data bindings and authority. Customers retain correction/dismissal and exact reviews, and essential direct controls remain reachable without inference.
- Whumpo AI chats with owners and maintains their projects. Visitors, website/service actions, scheduled business rules and webhooks cannot invoke the maintainer, share its context/credentials or consume its inference funding. Prove standard runtime operation with maintenance inference unavailable. Any optional customer-configured provider or exposed Cloudflare runtime AI route is a separate opt-in capability without maintainer fallback.
- Scope records, reads and mutations to the correct owner/project/visitor. Keep platform, site, visitor and runtime authority separate; R2 stays private.
- Generated customer source runs only in the bounded QuickJS boundary. Do not execute it in the platform Worker, install untrusted dependencies or expand host callbacks/networking casually.
- Models prepare actions. Exact human reviews bind immutable version/source/data, destination, policy and current revision before publication, activation, provider mutation or spending.
- Retries recover existing receipts. Unknown external outcomes retain holds and authority for reconciliation; never redispatch merely because a response was lost.
- Standard assistance has zero customer-unit debits. Premium/infrastructure funding requires its own approved scope; Monitor remains non-blocking and never disables content safety.
- Secrets, provider tokens, suspected illegal material and unnecessary private customer content never enter model context, GitHub, ordinary logs or test fixtures. Use benign synthetic data and private evidence storage with sanitized summaries.
- Configured bindings, schema application, local test success and live customer acceptance are different evidence. A Worker's plan does not provision a customer capability.

## Verify and finish

Use Node 24 and pnpm 11. Run the smallest meaningful checks for the changed behavior, including `pnpm check` for relevant TypeScript changes. Inspect a test's setup before running it: a `test:*` name does not imply it is offline, disposable or free. Build source assets with the existing build scripts when frontend behavior changes. Never hand-edit generated bundles.

For docs/backlog-only work:

```sh
node tools/roadmap.mjs validate
node tools/roadmap.mjs alignment
node tools/roadmap.mjs render
node tools/roadmap.mjs render --check
git diff --check
```

Inspect the final diff and preserve unrelated files. A completion report must contain:

- The task ID and concrete outcome; PR/commit and changed contract links.
- Exact checks run and results, fixture/environment scope and failures not resolved.
- Whether source only, configured, deployed, locally accepted, live accepted or device accepted; source/configuration timestamp and release identity where relevant.
- Remaining external blockers, risks and the next exact action. Private evidence gets a sanitized reference, never raw secrets or content.

Close an execution issue only when its acceptance criteria are satisfied. If implementation is complete but live acceptance is still required by that same packet, leave it blocked or split the missing acceptance into a clearly linked required child and keep the parent open. Planning readiness is not a `done` field. A new task or deployment must not erase the recorded historical scope of prior evidence.

## Task template

Use this when promoting a deferred idea or splitting a large item. Add a new permanent ID to the JSON; do not reuse a removed ID. Keep enduring behavior in the feature contract rather than only in an issue.

```markdown
[WH-xxx] Concrete outcome

Outcome: the user/operator problem and observable resulting behavior.
Current evidence: source/release and what the existing tests actually prove.
Scope: the smallest complete change and its relevant feature contracts.
Dependencies: roadmap IDs plus evidence required from each.
External blockers: exact decision/credential/entitlement/device/approval needed.
Acceptance:
- Observable positive result.
- Relevant tenant, replay, concurrent/stale and failure/recovery behavior.
- Evidence level required; no implied live acceptance from fixtures.
Verification: exact focused checks and environment/setup constraints.
Activation boundary: what may be prepared now and the concrete later review.
Handoff: claim, branch, PR/commit, checks, evidence, remaining next step.
```
