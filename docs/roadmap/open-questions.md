# Open owner questions

Recorded here when the `ask` tool is unavailable (`ASK_TOKEN` unset on ampere). Remove an entry once the owner answers and the decision is recorded in the docs.

## 2026-11-01

1. **PR #567 (cutover to `whumpo-control-2026-11-01`).** Merging to `main` deploys automatically, and a control-database change is an owner cutover ([AGENTS.md](../../AGENTS.md)). The owner said "merge 567"; the standing goal says never deploy to production. Recommended: the owner merges #567 themselves, or confirms in the session that this merge-triggered deploy is authorized.
2. **PRs #567-#570 reviews.** The owner reported an independent review of each, but no `review:clean` status exists on any head commit (#567 4467df18, #568 a66323e6, #569 c9720f9b, #570 f52fd109) and the Review gate is red. Recommended: point to where the reviews are recorded, or let the agent run the full-tier panels (all four are full tier: `.json`, `src/`, `tools/`, `wrangler*` are not on the safe list).
