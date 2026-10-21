# Roadmap readiness reconciliation — October 20, 2026 UTC (WH-001)

Baseline: `main` at `52e885bf1eb5c6ff2b001d1c28c483f25ac1f95c` (#306). This replaces stale PR #301, which was built on `802cd9d` and now conflicts. It is a static read of the checkout: no test, roadmap command, GitHub, Cloudflare or provider call was run, and no deployment was made. "On main" below means the file exists in this checkout.

## Why readiness was not changed

`tools/roadmap.mjs` accepts only `ready`, `planned`, `blocked` and `deferred`. [execution.md](execution.md) says planning readiness "is not a `done` field", and [evidence-reconciliation.md](evidence-reconciliation.md) (drift item 5) records that "there is no completion field, so only evidence and the issue carry that fact". A merged contract therefore keeps `ready`, and the correction goes in `evidence`. For each task below, `readiness` is unchanged and one dated 2026-10-20 entry was appended. The new entry supersedes the earlier "local commit / not pushed / not merged" wording. Earlier entries were kept as written, including the existing 2026-10-20 WH-001 entry from #299/#300.

## Tasks changed

| Task | Readiness (old -> new) | Evidence (old -> new) | Merged files on `main` |
| --- | --- | --- | --- |
| WH-150 | ready -> ready | "implemented in source on branch claude/wh-092-preview-links" -> on main | `src/guest-previews/owner.ts`, `guest.ts`, `policy.ts`; `tests/guest-previews.mjs`, `tests/guest-preview-photos.mjs`; `docs/guest-previews.md` (status: WH-150 implemented). WH-151's `bindings.ts` (PR #131) is built on these handlers. |
| WH-154 | ready -> ready | "local commit … not pushed or merged" -> merged | `docs/notifications.md`, `tools/prototypes/notifications.mjs`, `tests/notifications-contract.mjs`. evidence-reconciliation.md records the merge as PR #180 (`92a001f`). |
| WH-168 | ready -> ready | "not merged" (PR #183 / ports) -> merged | `docs/cost-events.md`, `tools/prototypes/cost-events.mjs`, `tests/cost-events-contract.mjs`; WH-168..172 alignment rules in `tools/roadmap.mjs`. |
| WH-180 | ready -> ready | "not merged" -> merged | `docs/review-retention.md`, `tools/prototypes/review-retention.mjs`, `tests/review-retention-contract.mjs`; WH-180..185 alignment rules. |
| WH-186 | ready -> ready | "local commit … not pushed or merged" -> merged | `docs/portable-exports.md`, `tools/prototypes/portable-export.mjs`, `tests/portable-export-contract.mjs`. `docs/portable-migration-guides.md` and the WH-190 evidence call the contract merged. |
| WH-192 | ready -> ready | "not merged" -> merged | `docs/domain-purchases.md`, `src/domain-purchase/order.ts`, `tests/domain-purchase-contract.mjs`. The `tools/prototypes/domain-purchase.mjs` that the old entry cites was removed by WH-193 (`docs/domain-purchases.md`). |
| WH-199 | ready -> ready | "local commit … not pushed or merged" -> merged | `docs/email-change-and-compromise.md`, `src/email-change/compromise.ts`, `tests/email-change-contract.mjs`; WH-199..205 alignment rules. The `tools/prototypes/email-change.mjs` that the old entry cites is not on main. The harness now runs `src/email-change/`. |
| WH-206 | ready -> ready | "local commit … not pushed or merged" -> merged | `docs/chat-daily-workspace.md`, `tests/chat-inference-outage.mjs`; WH-206..213 alignment rules. |
| WH-001 | ready -> ready | appended a pointer to this report | This file. |

Each new entry keeps the original scope limits: contract or offline reference only, or source and local only for WH-150. Each entry names the parent and child tasks that remain open. The commit or PR that merged each file was not identified except for WH-154, because git history and GitHub could not be read in this session. Apart from WH-154, the entries name no merge hash.

## Checked and left unchanged

- **WH-123, WH-140, WH-131** (ready). Their evidence already cites the merging PR and commit: #108 `2fbfd6c`, #116 `8df22a9` and #110 `21be249`. Nothing is stale.
- **Other ready tasks** (WH-002..WH-122 not listed above). Their latest evidence does not claim unmerged work. I did not re-audit them.

## Uncertain or out of scope (not changed)

- **Planned children whose source is on main but whose evidence still says branch-only or unmerged:** WH-169 (`src/cost-events.ts`, `src/cost-event-adapters.ts` and `tests/cost-event-adapters.mjs` exist; update October 21, 2026: WH-169's source is on main as of that date, source merged only and not claimed deployed), WH-193 (`src/domain-purchase/`), WH-200 and WH-203 (`src/email-change/`). These are implementation packets with broader acceptance. I could not run their suites or confirm which commit landed them, so I added no entry.
- **Other planned tasks with "not merged" or "not pushed" wording that I did not audit:** WH-050, WH-054, WH-077, WH-118, WH-141, WH-142, WH-190. Some of these entries are about other PRs (for example open #170 or #194), not the task's own files.
- **Stale status text inside contract documents** (outside the files this change may touch): `docs/cost-events.md` still calls WH-168 unmerged PR #183 and WH-169 unpublished (as of October 20, 2026; WH-169's source has since been on main, October 21, 2026, and the `docs/cost-events.md` wording is covered by open PR #320), and `docs/review-retention.md` and `docs/chat-daily-workspace.md` keep their "planned / audit" headers. Those headers describe contract maturity, which is still accurate, but the merge statements are out of date.
- **`reviewedAt` / `sourceCommit`** in `backlog.json` stay `2026-10-01` / `db8b740…`, the same as the earlier 2026-10-20 change. Changing the baseline is a separate owner decision.

## Verification

Not run in this session: `node tools/roadmap.mjs validate`, `alignment` and `render --check`. I edited `backlog.md` by hand to match the generator: each new evidence string was appended as an unescaped `- ` bullet at the end of that task's Evidence section, as `taskMarkdown` renders evidence. Both files contain exactly 10 `2026-10-20 UTC` evidence entries. The new strings contain no quotes, backslashes or credential-shaped values. Run `node tools/roadmap.mjs render --check` before merging.

The `52e885b` baseline was confirmed with `git rev-parse HEAD` in the first attempt. This worktree's git metadata is outside it, so HEAD could not be re-read here with file tools. Before these edits, the base files matched that baseline line for line: the anchor lines were identical, and the only 2026-10-20 entry was the existing WH-001 entry.
