# Open owner questions

Recorded here when the `ask` tool is unavailable (`ASK_TOKEN` unset on ampere). Remove an entry once the owner answers and the decision is recorded in the docs.

## 2026-11-01

1. **Review panels for PRs #567-#570.** The owner ordered these merged; they merged (#568, #569, #567, then #570 after a merge of `main`) with the Review gate red and no `review:clean` status. Question: should the panels still be run after the fact (full tier, 7 reviewers each), and is the Review gate meant to be bypassable by an explicit owner instruction? Recommended: run the panels on #567 (database cutover) and #570 only; record the bypass as an owner decision.
2. **#567 deploy.** Confirm the merge-triggered deploy of the `whumpo-control-2026-11-01` binding completed and was verified independently; the agent has no read access to Workers Builds and did not check.
3. **What "finish the roadmap" means unattended.** `node tools/roadmap.mjs next` lists only WH-001 (reconcile capability and acceptance evidence) as ready. The rest of the 191 tasks depend on it, on physical devices (WH-005), live provider activation or accounts (WH-011, WH-031-033, WH-041, WH-198), paid services, or owner cutovers. Recommended: the owner picks the next lane; the agent starts a WH-001 reconciliation slice meanwhile.
