# Agent-managed workspace views — WH-109 implementation contract

**October 3, 2026 UTC. Atomic layouts and shared read/display components implemented and locally verified; temporary views and full WH-109 acceptance remain open.** WH-107's renderer and [WH-108's custom/task acceptance](chat-composition-acceptance.md) are available foundations. [WH-109](roadmap/backlog.md#wh-109--compose-and-maintain-dashboards-and-custom-views-through-the-agent) retains its full original outcome: the agent manages temporary and saved supporting views using trusted components shared with Chat.

## Starting point before the atomic layout packet

`workspace-dashboard.ts` already stores one per-owner revisioned layout, seven fixed widget kinds, up to eight named project-scoped tabs and a bounded shortcut catalog. `workspace-pages.tsx` renders those widgets with static account/security/recovery navigation outside layout data. Existing `project.status@1` Chat cards and Dashboard already share `readProjectStatuses`, but their presentation/admission wrappers differ. Traffic, activity, storage and billing readers exist; performance remains explicitly unavailable.

The following gaps existed at source `2844eaf`. The atomic domain packet below resolves them in current source; the deployed platform still uses the preceding contract:

1. `workspaceAction(save)` called `saveLayout` immediately while preparing the model response. Its database effect precedes the final Chat transaction. The replacement needed to prepare guarded statements and commit the layout revision, operation receipt and Chat result atomically. A failed final Chat save must not leave an unreceipted layout change.
2. A full replacement layout with a compare-and-swap revision is insufficient for reliable page correction/undo. Scoped operations must preserve unrelated pages/cards on the server and record the exact previous/current definition. Rendering a saved configuration never grants access to its named project or review.

These were source-ordering gaps, not evidence that private-test layouts had corrupted data.

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

## Atomic layout domain — source/local acceptance, October 3, 2026 UTC

`src/workspace-view-contract.ts` defines one closed version-1 layout with a Dashboard view and up to eight named pages. Each view has exact project scope, registered widget names and optional approved shortcuts. At this atomic-domain checkpoint, maintained widget identifiers had version/binding identities but their shared renderer/read adapters were still outstanding. The later shared-read packet below records those implementations.

`src/workspace-layout.ts` implements read, setDashboard, createPage, updatePage, renamePage, removePage and undo. Mutations preserve unrelated pages, use exact request identities and compare expected revisions. Undo applies only to the latest committed receipt; it creates a new revision and rechecks current definitions, feature eligibility and project ownership. It cannot overwrite an intervening edit or restore access to a lost project. Removing a stale page remains possible without reclaiming that project's authority.

Preparation performs no layout writes. The committing batch rechecks identity, feature access, project ownership, the exact previous layout and the pending Chat turn. Preferences, immutable before/after receipts and the final Chat answer save together. A lost acknowledgment reads the existing result; it does not redispatch the change. A late layout/feature conflict leaves a truthful failed Chat answer and no proposed page. Historical receipts can still be read after feature loss; new mutations cannot use that readback as permission.

The current API is `/api/workspace/views/v1/`: GET `layout` and `history`, POST `mutate` and `receipt`. The previous API/whole-layout operation is removed. Current frontend consumers validate the versioned layout; no old-layout reader exists. Agent reads include five recent receipt summaries to fit the existing bounded lookup; owner history returns the latest twenty. Model input uses an explicit field projection, and the model cannot supply the Chat request ID.

The schema has **175 current tables**, including `workspace_layout_receipts` and an always-empty atomic assertion table. History is account-linked and retained independently of page removal/Chat cleanup; provenance records the original turn without cascading its deletion. The lifecycle catalog maps both tables. This does not finish account export/closure or independent restore suppression.

Verified evidence:

- `tests/workspace-layout.mjs`: 12 cases covering scoped changes/undo, invalid/current-only input, isolation, concurrency, exact replay/lost acknowledgment, preflight and late revocation, no writes during Chat preparation, failed final transaction, closed turns, retained history, eight-page bounds and bounded lookup size.
- `tests/workspace-dashboard-http.mjs`: seven cases using actual Worker handlers and scripted model responses. Current identity/CSRF/input checks, zero-inference refresh/readback, atomic Chat result, exact replay, rejected model request IDs/old saves, lost final acknowledgment, late revision/feature failure and read-then-undo pass on SQLite and local D1. Each run makes eight scripted main and seven acknowledgment calls, with no external inference.
- Existing dashboard/capacity, 69-case Chat contract, processing-boundary, welcome/onboarding and agent-inspection checks pass. Current schema initialization/drift checks pass on SQLite and local D1; lifecycle inventory reports 175 tables across 39 current classes.
- Type/compiler checks, frontend build and roadmap validation/alignment/render checks pass.
- The built-client `tools/workspace-shortcuts-browser.mjs` fixture passed at 390px against the actual Worker and disposable D1/R2. The current-version page rendered correctly; Project status and Saved versions produced exactly two typed actions, all completed, with zero inference/publication. Page and resulting Chat screenshots were inspected, both with 390px document/viewport width. Two initial automation waits incorrectly assumed `/workspace`; the current route is `/workspace/chat?signup=false`. The committed results were inspected without repeating either action, and fixture finalization/cleanup passed. This is synthetic desktop Chromium phone-width evidence, not a physical-phone or passkey-ceremony acceptance claim. Private evidence: `.secrets/workspace-shortcuts-browser.json`; inspected screenshots `/tmp/whumpo-layout-current-390.png` and `/tmp/whumpo-layout-shortcut-chat-390.png`.

**Not deployed.** This incompatible schema/client requires a coordinated empty test-database cutover. At the atomic-domain checkpoint, shared components, temporary views and the full WH-109 parent remained open; the next section records shared component progress. No scanner/CMS functional test, real model call, provider authorization or new paid service was exercised for this packet.

## Shared reads and components — source/local acceptance, October 3, 2026 UTC

The current saved Dashboard/page widgets now resolve through `readSavedViewComponent` and the registered `readViewBinding` domain. Requests select only an existing page, current layout revision and registered widget. They cannot supply a project ID, query, destination or authorization. Registry feature metadata is also consumed by the Chat project-status binding, so both use the same current inclusion rule. Traffic uses the existing `project.traffic@1` identity, with an optional exact project filter in the shared traffic reader.

Chat's maintained project-status card and saved pages share the authoritative read and the exact `ProjectStatusFacts` element. `workspace-data.ts` owns the common project/activity/storage projections; there is no separate Chat/page query implementation. Other saved components use the same closed read/display contract: standard-assistance policy, ready-photo file counts/bytes, recorded activity and existing aggregate HTML request telemetry. Media counts never read image bytes or keys. CMS count code reuses the existing projection, but CMS functional testing remains deferred. Unsupported performance data stays unavailable; zero is never fabricated for a failed read.

Each component rechecks current identity, feature inclusion, project ownership and the page revision. Account reads detect changes to the owned-project set while facts are fetched. A changed page is rejected; late feature loss produces denied data with no retained facts. The response carries bounded current fields, binding/scope and checked time. Rendering, refresh and window-focus reads invoke no model or external provider and write no domain state. The older aggregate Dashboard endpoint remains an existing workspace/settings summary; rendered components use the registered reads rather than inferring permissions from that summary.

The shared client validates response version, binding, scope and exact fact shapes. It hides old facts during refresh/error, uses owner/page/revision/component cache keys, and immediately expires unmounted query results. Existing account-change cache clearing also covers these components. Denied, unavailable, missing/stale layout and unsupported-client states are explicit. Essential account/security/unpublish paths remain outside generated layout configuration.

Evidence:

- `tests/workspace-view-bindings.mjs`: nine actual-domain/HTTP cases pass on SQLite and local D1, including identical Chat/page facts, scoped measured values, wrong/current requests, zero-write reads, lost eligibility, project transfer, changing account project sets, changed layouts and revoked identity. No network/model calls occur.
- Existing ten-case Chat card coverage passes on SQLite and local D1 through the shared reader. `tests/workspace-view-components.mjs` proves both surfaces contain the exact same project element, escape text, reject unsupported/authority-bearing data and expose no action/link authority in fact displays.
- `tests/workspace-views-browser.mjs`: built current client, actual Worker and disposable local D1; 360/390px pages, keyboard status reads, Chat/page consistency, outage/denial hiding old facts, navigation cache eviction and a delayed previous-account response all pass. No model/domain actions or publication. Inspected `/tmp/whumpo-shared-view-360.png` and `-390.png` show no horizontal overflow. Initial fixture attempts used a random port rejected by the current identity-origin contract; the harness now uses its authorized localhost:8787 origin. No product auth rule was relaxed.
- Atomic layout/HTTP, existing dashboard, Chat protocol, processing-boundary and traffic regressions pass. Type/compiler, build and lifecycle checks remain separately recorded; lifecycle still has 175 tables and now names the shared readers/private view caches.

This packet does not add schema tables or deploy source. The previously required coordinated empty-database/client cutover remains pending. Temporary Chat views, persistent dismissal, requested review bindings, the complete agent lifecycle and the full WH-109 audit are still open. Real model, physical-device and whole-product readiness evidence is separate.
