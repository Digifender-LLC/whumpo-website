# Roadmap tooling decision

**Decision and research date: 2026-09-30.** Use repository Markdown and a structured JSON backlog for the roadmap, task contracts, dependencies, and planning readiness. Use GitHub Issues for a small near-term execution queue. Add a private GitHub Project view only if it becomes useful and its required authorization is granted. Do not add another project-management service now.

This decision is specific to Whumpo: one private GitHub repository, extensive feature contracts already in `docs/`, future implementation by AI agents, and a stated GitHub free-tier constraint. It does not authorize deployment, purchases, customer DNS changes, provider activation, or new paid services.

## Evidence from this repository

Read-only inspection on 2026-09-30 found:

- Remote: `https://github.com/zemdregon/whumpo.git`; private repository; issues enabled; current authenticated account has repository `ADMIN` permission.
- GitHub CLI `2.101.0` is installed. Its issue commands support parent/sub-issue relationships and blocking dependencies without extensions.
- Before this roadmap was populated, the all-state issue listing and open milestone listing were empty. Only standard labels existed, and there was no `.github/` directory. These are observations at inspection time, not promises about current state.
- Repository issue access works. Listing Projects failed because the current credential lacks `read:project`; it also lacks the broader `project` scope needed to edit Projects. No credentials were exported or authorization scopes changed.
- The README already identifies authoritative feature documents, distinguishes implementation from live acceptance, and limits GitHub to free-tier use. The roadmap should extend that structure.

## Options compared

| Option | Agent execution and organization | Costs and prerequisites | Decision |
| --- | --- | --- | --- |
| Repository Markdown + JSON only | Available in every checkout; searchable with `rg`; code, contracts, acceptance criteria, and dependency changes can be reviewed together. JSON supports deterministic ready-task selection and validation without a new dependency. Git history preserves decisions. Live claims across concurrent agents need coordination outside a local checkout. | Uses existing Git/repository access. No new service. | Canonical roadmap and task specifications. |
| Repository contracts + GitHub Issues | Issues provide stable URLs, assignees, labels, milestones, discussions, PR links, native sub-issues, and blocking relationships. Existing `gh` access can operate them. Scope and dependency edits remain reviewable in Git; issue state coordinates execution. | Issues and Projects are included in GitHub Free. Current repository access is sufficient for issue operations; no purchase is needed. | Best current fit. Publish the near-term queue, with links back to canonical contracts. |
| GitHub Issues + Projects v2 | Projects add table, board, and timeline views plus custom fields. Useful when several workstreams require a shared visual overview. They are a view over execution issues, not a second specification store. | GitHub Free includes Projects, but this session's authorization cannot access them. Reading needs `read:project`; writing needs `project` for the current CLI/OAuth approach. Automation also needs appropriate credentials. | Optional later. Do not make execution depend on obtaining broader authorization. |
| Linear | Strong issue/project workflows, parent/sub-issues, blocking relationships, GraphQL API, TypeScript SDK, and hosted MCP access. A good fit when a team already manages its work there. | A separate workspace, connection, and permissions must be established. The advertised Free plan has 2 teams and 250 issues; Basic is advertised at $10/user/month billed yearly. Recheck pricing before adopting. | No demonstrated benefit sufficient to justify another account, data boundary, and synchronization process for this repository. |

GitHub's [pricing page](https://github.com/pricing) lists Issues and Projects in Free. Its [Projects documentation](https://docs.github.com/en/issues/planning-and-tracking-with-projects) describes the supported views and custom fields. [Issue dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies) are available on GitHub Free, and [sub-issues](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/adding-sub-issues) support hierarchical decomposition. Avoid relying on organization-only issue types in this personally owned repository; ordinary labels and milestones are sufficient.

Linear's official [pricing](https://linear.app/pricing), [GraphQL API](https://linear.app/developers/graphql), [MCP](https://linear.app/docs/mcp), [issue relations](https://linear.app/docs/issue-relations), and [parent/sub-issue](https://linear.app/docs/parent-and-sub-issues) documentation support the comparison. Prices and availability are point-in-time observations, not account entitlement checks. No Linear connection was requested or installed.

## One owner for each kind of information

| Information | Authority | Rule |
| --- | --- | --- |
| Product behavior and safety invariants | Existing feature contracts under `docs/` | A roadmap item links to these contracts; it does not silently override them. |
| Outcomes, sequencing, priority, task scope, acceptance criteria, and canonical dependencies | Versioned roadmap/backlog | Change them through the same review process as the code. Use permanent roadmap IDs even if titles change. |
| Planning readiness | Versioned backlog | `ready` means the task is sufficiently specified for selection, subject to current dependencies, authorization, and claim checks. It does not mean unclaimed or unfinished. |
| Live execution state for a mapped task | Its GitHub issue | Read the current issue, assignee, labels, dependencies, and linked PRs before claiming or resuming work. Issue comments record claims, blockers, and handoffs. |
| Implementation and acceptance evidence | PR/commit plus dated evidence in the relevant contract or acceptance record | Closing an issue is not evidence of a successful deployment or a verified customer journey. Distinguish completed implementation from live acceptance. |
| Optional visual status | GitHub Project fields/views | Derive from the issues. Do not introduce independently maintained copies of task status. |

Avoid a two-way synchronization system. The backlog records the roadmap ID and issue URL, not a separately maintained copy of the issue's current status. Native GitHub dependency links are a useful projection of canonical backlog dependencies; update them when a dependency change is accepted. If they disagree, reconcile the discrepancy before starting dependent work.

For unmapped tasks, planning readiness is not an execution lock. Create or locate the execution issue when work is selected. If GitHub is unavailable, a single coordinating agent may explicitly establish a temporary local handoff; multiple agents must not infer ownership from independent checkouts. Reconcile the handoff with the issue before parallel execution resumes.

## Minimal durable artifacts

Keep the structure small:

1. A roadmap entry point: product outcomes, present baseline, phases and exit gates, explicit deferrals, and links to the backlog and execution instructions.
2. One machine-readable backlog: stable IDs, priority, phase/workstream, planning readiness, dependencies, task contract, and optional GitHub issue mapping. Use JSON so Node can validate it without a YAML dependency.
3. An agent execution guide and reusable task template: how to select, claim, verify, hand off, and finish work. Add a small local validator/selector if it makes dependency checks reproducible.
4. This decision record: why the tools were chosen, limitations, and the conditions for revisiting the decision.

Keep task details in the backlog unless its size makes individual task files materially easier to read. Do not duplicate a full task specification in both JSON and Markdown. Issues should contain the task ID, a useful summary and acceptance checklist, and the canonical source path; copied details must be reconciled when scope changes. Existing feature documents remain the place for enduring architecture and product behavior.

## Task contract for future agents

Every executable task should answer these questions before it is marked planning-ready:

- **Outcome:** What user or operator problem will be resolved, and what concrete behavior will change?
- **Evidence and scope:** What is implemented today? Which feature documents, source areas, and tests should the agent inspect? What is explicitly outside this task?
- **Dependencies:** Which stable roadmap IDs must finish first? Which prerequisites are decisions, credentials, account entitlements, provider availability, or approval rather than code?
- **Acceptance:** What observable conditions must hold, including negative paths, tenancy, concurrency, idempotency, or recovery where relevant?
- **Verification:** Which focused local checks apply? Does acceptance require a browser journey, provider sandbox, deployment, or live verification? Which evidence must be recorded?
- **Authorization:** What can be done locally now? What later action requires a concrete review or external permission? Do not translate a task's existence into authorization to spend, change customer DNS, or deploy customer code.
- **Handoff:** What changed, exact checks run and their outcomes, remaining gaps, and the next action? Include an issue/PR link and dated acceptance evidence when available.

Prefer one coherent, independently reviewable behavior change per execution issue. Large initiatives can be parent issues with small child tasks; later possibilities remain in the backlog until sufficiently specified. Sequence by dependencies and exit gates, rather than inventing calendar commitments without staffing or acceptance data.

Before claiming a task, refresh its issue and the current state of every dependency. A dependency counts as satisfied only when its required deliverable and acceptance evidence exist; a closed-as-not-planned issue does not satisfy it. An assignee or claim comment coordinates ownership but is not an atomic lock, so one coordinator should allocate simultaneous agent work. Use separate branches/worktrees for independent changes and account for existing local edits.

## Practical GitHub path

The installed CLI already exposes the required issue capabilities. Examples below are workflow references, not operations performed by this document:

```sh
gh issue list --repo zemdregon/whumpo --state all --search 'WH-001 in:title' --json number,title,state,url
gh issue create --repo zemdregon/whumpo --title '[WH-001] Concrete outcome' --body-file /path/to/reviewed-task.md
gh issue edit 123 --repo zemdregon/whumpo --parent 100 --add-blocked-by 120
gh issue view 123 --repo zemdregon/whumpo --json title,body,state,stateReason,assignees,labels,comments,blockedBy,blocking,closedByPullRequestsReferences,url
```

Use a duplicate lookup and stable roadmap ID before creation; read the resulting issue back and store its URL. Use `--body-file` to preserve literal Markdown and avoid shell substitution. Do not auto-assign a paid coding agent. References: [issue creation](https://cli.github.com/manual/gh_issue_create), [issue editing](https://cli.github.com/manual/gh_issue_edit), and [issue dependencies](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies).

If a Project becomes worthwhile, use one private user-owned Project attached to the repository, containing the existing issues. Start with Status, Priority, and Phase; show a board for execution and a table grouped by phase. Add dates only when there is a credible commitment. The [Projects API](https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project/using-the-api-to-manage-projects) and [`gh project`](https://cli.github.com/manual/gh_project) support automation, but do not broaden authorization automatically or block the roadmap on doing so.

No Actions workflow, external sync service, or paid runner is required to plan and execute this roadmap. If CI is added later, account for the repository's private status and the free-tier limit: GitHub documents included usage and potential overage charges in [product usage included with each plan](https://docs.github.com/en/billing/reference/product-usage-included). Keep the existing free-tier constraint explicit.

## Revisit triggers

Reconsider Projects when owners need to see several concurrent workstreams, manual prioritization becomes cumbersome, or stakeholders need a shared view. Reconsider Linear only if it becomes the team's existing system of record or a demonstrated cross-repository workflow outweighs connection and migration costs. Reconsider the backlog format if routine edits require maintaining the same fact in multiple places. Tool expansion should solve an observed coordination problem.
