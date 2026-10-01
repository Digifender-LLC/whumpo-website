# Executing the Whumpo roadmap

This guide supplements [AGENTS.md](../../AGENTS.md). Feature contracts remain authoritative for behavior. The [roadmap](README.md) sets outcomes and [backlog.json](backlog.json) owns task specifications/dependencies. GitHub Issues owns live execution state for mapped tasks. No roadmap task authorizes payments, new paid services, customer DNS changes, customer code deployment or deferred provider activation by itself.

## Select and claim a task

1. Read `README.md`, `AGENTS.md`, `docs/roadmap/README.md` and the task's referenced feature contracts. Inspect `git status`, current commit and any concurrent changes. The roadmap source commit is a review baseline, not a requirement to work on stale code.
2. Run `node tools/roadmap.mjs validate` and `node tools/roadmap.mjs next`. Use `show WH-001` to read one complete packet without loading the entire backlog. `ready` only means sufficiently specified; it is neither an execution lock nor a completion claim.
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

For an L task, decompose first: contract/schema, isolated implementation, connected local journey and live activation often need separate deliverables. Do not mark a parent finished because its first foundation is present. Use existing patterns and dependencies; keep frontend source authoritative and preserve concurrent work. Use isolated branches/worktrees for simultaneous implementation, and coordinate migration numbers immediately before creating a migration.

Ready packets are safe to **begin**, not preauthorized for every future side effect. Complete local preparation and an exact reviewable configuration/resource/cost plan before asking for a missing decision. Keep independent work moving. Preserve explicit Stripe setup, CMS testing and CSAM scanner implementation deferrals until the owner changes them.

## Preserve the invariants

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
