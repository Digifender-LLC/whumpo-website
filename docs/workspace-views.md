# Agent-managed workspace views — WH-109 implementation contract

**October 3, 2026 UTC. Planned extension, not delivered behavior.** WH-107's renderer and [WH-108's custom/task acceptance](chat-composition-acceptance.md) are available foundations. [WH-109](roadmap/backlog.md#wh-109--compose-and-maintain-dashboards-and-custom-views-through-the-agent) retains its full original outcome: the agent manages temporary and saved supporting views using trusted components shared with Chat.

## Source-grounded starting point

`workspace-dashboard.ts` already stores one per-owner revisioned layout, seven fixed widget kinds, up to eight named project-scoped tabs and a bounded shortcut catalog. `workspace-pages.tsx` renders those widgets with static account/security/recovery navigation outside layout data. Existing `project.status@1` Chat cards and Dashboard already share `readProjectStatuses`, but their presentation/admission wrappers differ. Traffic, activity, storage and billing readers exist; performance remains explicitly unavailable.

Two gaps must be fixed before adding more layout actions:

1. `workspaceAction(save)` currently calls `saveLayout` immediately while preparing the model response. Its database effect precedes the final Chat transaction. The next implementation must prepare guarded statements and commit the layout revision, operation receipt and Chat result atomically. A failed final Chat save must not leave an unreceipted layout change.
2. A full replacement layout with a compare-and-swap revision is insufficient for reliable page correction/undo. Scoped operations must preserve unrelated pages/cards on the server and record the exact previous/current definition. Rendering a saved configuration never grants access to its named project or review.

These are implementation gaps, not claims that existing private-test layouts have corrupted data.

## One current contract

Define and validate one versioned declarative view shape for both temporary Chat views and persistent Dashboard/custom pages. Components reference only registered data/action bindings with exact project/review scope and presentation limits. Registration owns server read/admission, client validation/rendering and lifecycle copy classification. Initial registrations reuse real project status, recorded activity, traffic and current usage projections. A missing or unavailable measurement is explicit; no arbitrary metric values, SQL, HTML, scripts, URLs or provider calls belong in layout JSON.

Keep existing domain authorities. Read-only cards invoke current domain readers; requested shortcuts invoke their current deterministic handlers; consequential mutations still require existing exact reviews. A layout can reference a review, never approve it. Essential account/security/support/recovery and urgent unpublish controls remain independently reachable. Visitors/jobs cannot invoke the owner maintainer through a component.

The owner requires **current-version-only** delivery. Existing layouts remain usable while the present contract is active. An incompatible new shape requires one coordinated current-client/schema cutover on disposable test data, not an old-reader adapter, automatic migration or fallback. Current-version layout history can support undo; unsupported historical definitions cannot reintroduce removed fields/bindings or permissions. This applies the owner's explicit direction to the older roadmap wording about migration.

## Operations and receipts

Use bounded operations for temporary presentation and explicit persistent dashboard/page creation, content change, rename and removal. Each operation has an exact request/turn identity and expected layout revision. A server-derived next layout preserves unrelated page/card IDs and rejects ambiguous changes. Stable IDs prevent a rename from retargeting another page.

Record each accepted layout change with request digest, before/after revision and exact resulting definition. Replays return that receipt; a lost response cannot execute a second change. Restore/undo is a new reviewed-by-the-domain layout operation against the current expected revision, not replacement of history. It revalidates current bindings, project ownership and feature eligibility. A missing/revoked project stays visibly unavailable and cannot become accessible by restoring an old layout.

For agent actions, all write guards/statements join the existing final Chat transaction. Direct current HTTP operations use the same handler and receipt rules. Current workspace identity, feature inclusion and owned project predicates run at read and committing boundaries; preflight reads alone are insufficient. Unknown or failed work retains truthful recovery state.

Register definition/history/receipt copies under the existing workspace-settings lifecycle before enabling storage. The seven-day unsubmitted Chat-form rule does not automatically apply to persistent layout history. Account export/closure and independent restore-suppression remain their own unfinished lifecycle tasks; do not claim them complete because a view can be removed.

## Rendering and evidence

Chat and a saved page must use the same resolved component and authoritative binding. Wrappers may differ in placement and collapsing, while privacy, denied/unavailable states and current-version validation stay common. Account/project changes evict private cached results. A refresh or polling tick performs bounded reads only; it makes zero maintainer calls and has no domain effects.

Temporary views are dismissible and do not reopen or steal focus after reload. Persistent pages remain optional navigation alongside Chat. The agent may change them only for the owner's requested task; no manual layout builder or default control directory is added.

Deliver and verify the complete parent in connected packets:

1. Current definition/binding registry, lifecycle/schema and atomic revision/receipt domain; stale/concurrent/foreign/revoked and lost-response tests.
2. Shared Chat/page rendering, temporary dismissal, per-component denial/unavailability, account clearing and narrow-screen keyboard/focus evidence.
3. Natural-language create/update/rename/remove/undo, preserving unrelated layouts; current-contract cutover and connected Chat → page → Chat acceptance. Real model and physical-device evidence remain separately labeled.

CMS functional testing, CSAM and Daybreak stay deferred. Reuse existing Cloudflare services; no new provider, paid feature or model route is required by this work.
