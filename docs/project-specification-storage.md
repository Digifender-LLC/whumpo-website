# Saved website configurations and reviewed changes

**September 30, 2026 — WH-066B / [#16](https://github.com/zemdregon/whumpo/issues/16).** Implementation connects the [pinned compiler](project-specification-compiler.md) to owned D1 state, natural-language Chat, private previews and exact owner approvals. The [specification ADR](project-specification.md) remains the schema contract. Deployment and acceptance evidence are separate below. The full composition outcome stays in [WH-066 / #14](https://github.com/zemdregon/whumpo/issues/14); forms/API and broader delivery remain [#17](https://github.com/zemdregon/whumpo/issues/17).

## Customer flow

**October 1 current test deployment:** new websites are created directly as schema-2 specifications with `project-content@2`. Old page import, `preview`/`edit` action aliases and the private `/new`/`build`/`photo` guided writers are removed. The current onboarding brief and explicitly requested additional-project creation remain supported. **WH-124 source cutover (October 4, not deployed):** new websites are created as schema-3 specifications with `project-content@3` and empty `instances`; schema-2 rows are refused by SQL admission and test databases are reset at the coordinated empty-database cutover. The single-homepage adapter, `content@2` and page components are unchanged. **`project-content@4` source cutover (October 4, not deployed):** proposals and saved versions require compiler version 4 (SQL admission and lock). Instance-bearing specifications save through the same exact review: one comparison row per changed instance, classified review classes bound in the proposal envelope and named in the reply, and a recent-sign-in apply. Restore is classified against the current head. Saving activates nothing; see [shared modules](shared-modules.md#compiler-identity-cutover-project-content4--october-4-2026-utc).

1. The agent calls `specification` operation `create` for an owned project with no website, using the current plain-text config and required photo array. The first page, specification, photo references and creation receipt commit together. Creating a new project and its first page uses that same transaction builder.
2. A later natural-language change reads the saved specification/revision, then proposes `change`. Text, theme, name, ordered sections and approved photo references are supported. The owner opens the private preview and complete before/after comparison.
3. **Save reviewed private version** sends a typed approval containing review UUID, exact proposal digest and expected revision. Same-origin, recent sign-in and rate checks apply. Neither model text nor a slash command grants approval.
4. `restore` prepares a new forward version from a saved current specification. All versions remain immutable. `review` reopens an exact review; `read` supplies bounded serialized editable IDs/text through the inspection continuation.
5. Publishing, taking offline and changing live services retain their separate exact reviews. Creating, editing or restoring a private specification never moves the live pointer.

The mounted adapter accepts **one public homepage at `/`, declaring only `content@2`**. Both current `site-page@1` and `photo-page@1` presentations are supported. Photos remain private R2 objects, scoped to the same owner/project and subject to current clearance. Preview bytes are digest-verified and embedded only in authenticated responses. Additional routes, staff access and records/forms/files/rules declarations fail closed. The compiler's broader schema/library coverage does not provision these capabilities.

Existing drafts without a current snapshot/lock reject preview, export, publication and public delivery. They are disposable test data to reset at cutover; there is no conversion, old reader or automatic alternate compiler.

## Persisted authority and transaction

The current schema includes original storage tables (0110), typed approval guards (0118) and current creation guards (0119):

| State | Purpose and retention |
| --- | --- |
| `projects.site_draft_revision` | Increments on every new immutable website version, including a first current draft. The first current draft starts at revision one; a concurrent draft invalidates a prepared review. Removing an unrelated old version does not invalidate the head. |
| `project_spec_proposals` | Immutable candidate spec, compiler lock, exact HTML/configuration/manifest, readable diff and review envelope. Binds owner/project, operation, request hash, current specification/draft revisions, base/restore target, digests, policy and ten-minute expiry. |
| `project_spec_versions` | Full independent configuration/lock/manifest snapshot paired with the existing immutable `site_versions` row. No delta chain or dependency on the continued existence of a proposal/ancestor. |
| `project_spec_applies` | Immutable metadata-only idempotency receipt. Unique proposal, output version and project revision; exact request hash prevents a changed-payload replay. Survives removal of the candidate/version while the project remains. |
| `project_spec_creations` | Immutable metadata-only first-save receipt, unique per project and output version. Admits only a pending owned AI turn with no approval payload. |
| `project_spec_heads` | Established by a valid creation receipt and subsequently advanced only by valid apply receipts. |
| `project_spec_chat_links` | Immutable owner-scoped review link with the exact server reply digest. Edited or model-invented text cannot acquire an approval button. |

Before preview, approval or reopening a review, the server checks ownership, current revisions/base, target existence, expiry, policy identity, current compiler/catalog compatibility and every saved artifact/envelope/diff digest. It recompiles from the saved specification using the exact pinned lock and compares actual output bytes. Unsupported schema or renderer-size errors become fixed safe responses, never raw submitted values or SQL.

The confirmation turn, workspace revision, immutable site/specification versions, receipt, head and activity event commit in the existing [D1 batch transaction](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Database guards recheck owner/project, exact canonical confirmation, candidate/base/target, revisions, expiry, safety holds and quotas **inside the transaction**. A candidate removed after application validation forces an abort; a no-op insert cannot save a success-only reply. Concurrent stale requests cannot both advance the head. A lost acknowledgement is recovered from the original owned turn/receipt without compiling or creating another version.

**October 1 current deployed receipt contract:** schema 0118 requires canonical typed action JSON on the same confirmation turn, including exact review ID, proposal digest and integer expected revision. Command text cannot satisfy this gate. See [current Chat receipts](natural-language-chat.md#current-receipts-and-plain-language-replies).

Current compiler/policy code is trusted Worker configuration, checked again on each operation; it is not an editable customer database row. Future module changes need an exact current-version cutover. Both current compiler identities are version 2; older locks reject. Initial creation rechecks owner, pending-turn identity, first-only draft state, current schema/manifest, photo references and known holds inside its transaction. Competing first saves cannot establish two heads or leave orphan versions.

## Removal, bounds and safety

The current specification head and base/target of an unexpired unapplied review are retained. Existing live-publication, pending publication, backup and exact-removal protections still apply. Removing an eligible version purges proposals and full comparison/candidate copies associated with it, and cascades its specification snapshot. Independent later versions retain their own full content. Metadata-only creation/apply receipts prevent retries from resurrecting removed bytes or moving the head backward. Explicit operator parent-project or parent-account cleanup cascades all new state (including the account-order correction in migration 0111); no new customer account/project delete endpoint is added.

Proposal preparation removes expired candidate copies for that project and up to 100 expired copies elsewhere; this is bounded transaction cleanup, not a scheduled global purge. Immutable versions and metadata receipts are independent of that cleanup. Limits are 50 retained proposals per project / 4,000 platform-wide and 500 apply receipts per project / 20,000 platform-wide. Existing 25 saved-site-version limits remain. The compiler bounds each spec to 32 KiB, lock to 4 KiB and homepage HTML to 32 KiB; persistence additionally bounds manifest, diff and review envelopes. Capacity failures require freeing eligible saved versions or operator review of test limits; they do not create paid resources or silently prune recoverable versions.

A persisted `generated_artifact` screening decision marked **required** is a hold, never a clearance. Exact spec, manifest and HTML hashes are checked before proposal/apply. A later hold on a base/restore target also invalidates the review and is rechecked in the apply transaction. Held saved configurations are excluded from the new specification read and ordinary latest/exact-version model inspection. Private preview, comparison, export (including backup preparation), publication changes and public page serving reject a held specification version. Public serving returns a generic temporary-unavailability response, not held bytes. Critical unpublish remains available.

This is **not a new detector or a complete generated-content safety implementation**. No scanning decision is automatically created by these tools, no result is interpreted as approved, and existing unconnected screening/retention gaps remain launch gates in [safety coverage](safety-coverage.md). Historical Chat text and unrelated artifact families are not newly quarantined by this feature. Financial Monitor cannot override these known holds.

## Prerequisites and cost

Uses Whumpo's existing private test D1 and Workers services; no new resource, paid-only service, provider authorization, customer DNS or AI routing change. D1 read/write/storage and Worker execution accrue against existing account allowances; this is not a promise of zero marginal provider cost. Cloudflare [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) checked September 30, 2026. Account-wide usage and entitlement remain operational checks.

## Current verification — October 1, 2026

Current source checks passed: both compiler suites (including independent reproduction/pin refusal), `current-website-specifications`, `specification-journey`, and lifecycle catalog. The current fast SQLite journey verifies direct first/additional-project creation, rejected retired actions/schemas/locks, exact approvals, competing reviews and first saves, lost-response replay, forward restores, export/preview/publication, same-project photo ownership, clearance/expiry, byte-integrity failures, private-to-live separation, late photo revocation, late content holds, atomic rollback, creation-receipt retention/cascade, and the 25-version quota including exact rollback and slot recovery after reviewed deletion. Photo clearances are explicitly synthetic; no detector or scanning provider runs.

The connected HTTP/D1 journey verifies current direct creation and reviewed changes, recent-auth/origin/foreign denials, competing HTTP approvals, exact replay, stale/expired/removed-candidate rollback, immutable head/version/receipt retention, byte-exact export/publication, known holds and parent cleanup. Inference interpretation is scripted; compilation, previews and approvals invoke no model.

Release `925bb8a8-12b2-44f5-807a-251ab85a5905` deployed the current client and all four Workers with schema 0118/0119. Remote inspection found no obsolete website/specification/service-setting rows to delete; schema 0119 clears retired guided workspace state. Old approval text is not converted. [Current release evidence](current-version-policy.md#current-contract-test-release) records exact versions and the passing live Muse/HTTP first-create → reviewed edit → forward-restore journey, including exact replay and fixture cleanup. Dated v1 evidence below records earlier behavior only.

## Historical verification and deployment

Local verification on September 30, 2026:

- `pnpm check`, `pnpm build`, `node tests/agent-prompt-focus.mjs` and `node tests/specification-compiler.mjs` passed. The pinned v1 compiler digest is unchanged. The compiler test also verifies reproduction in an independent checkout/process and rejects identity drift.
- `node tests/specification-journey.mjs` passed against the actual platform/site HTTP handlers, disposable D1/R2 and scripted Responses interpretation: owned import → preview/diff → exact recent-auth apply → change → forward restore, private/live separation, exact export bytes, foreign/origin/digest refusal, model-apply refusal, competing HTTP confirmations, lost acknowledgement replay, stale/new-draft rollback, removed-candidate rollback, expiry inside the transaction, expired candidate cleanup, immutable records/head retention, deletion tombstones and operator cascade. Recorded safety holds block new/old delivery and a base hold added after validation aborts the apply. Compilation, previews and approval make zero inference calls.
- `node tests/publications.mjs`, `node tests/exports.mjs`, `node tests/customer-site-journey.mjs`, `node tests/natural-chat.mjs`, `node tests/version-removal.mjs` and `node tests/version-diff.mjs` passed their local regression gates. The removal fixture initially failed because its old fake photo digest and missing safety receipt no longer met migration 0100; the fixture now supplies a 64-character digest and explicitly synthetic approval to isolate removal behavior. No real detector ran.
- `node tests/chat-reply.mjs` passed, including server-metadata-only specification actions and plain-language presentation of the typed approval receipt. Literal human messages remain unchanged.
- Browser fixture at 390×844: document width 390, all three review controls 44px high, no horizontal overflow. Keyboard activation sent only the exact typed `specificationApply` payload to `/api/chat/actions`. An observed raw internal receipt was corrected in the shared presentation adapter; final browser readback is recorded with the release evidence.

This is local scripted acceptance, not real-model interpretation or authenticated live-customer acceptance. CMS functional testing and Stripe/provider activation remain deferred. The reviewed test deployment and its readback are recorded below.


### Test deployment and recovery

At **2026-09-30T23:39:24.886Z**, release `1ac986dc-5062-4e60-834d-44ba99ab7195` completed all four service steps: platform `3f52ab8c-8c74-43a6-b4ba-9d12ab5cb0e3`, sites `eaaa5061-b7b4-49eb-a47f-ef5d42726a7d`, apps `7983185c-ee37-4cf1-bb28-64b842559ab2`, runtime `d9f2de1d-2a11-4515-a582-43d5925c48a8`. Migration 0110 had been applied in the preceding partial release; the final release had no pending SQL. Source commits: `bbf4469` (feature), `928878a` (release expectation fix). All artifacts, migration hashes and service bindings are pinned in private archives. Build input digest: `dee8fee128dc7721450a52423d78d9716c1f6d9e87191844f405fc08c0615131`; the dirty-source flag preserves the concurrent development-tool configuration in that exact build.

The first release stopped on app service readback: Cloudflare explicitly reported its default environment while the expected inventory omitted it. CLI completion, exact live candidate/tag and unchanged before/after service/secret identities were confirmed; the original journal was retained. A fresh release with the corrected expectation completed from that verified baseline. See [release recovery evidence](releases.md#live-binding-readback-correction--september-30-2026). This was not an uncertain-operation retry or archive rewrite.

Live readback at **2026-09-30T23:40:54.703Z** confirmed all four versions, all 110 migrations, 17 new guards, workspace HTML and all 16 frontend asset hashes against the archive. Landing/workspace/health returned 200; anonymous Chat and specification preview requests returned 401. Browser readback after rebuilding confirmed the friendly approval receipt. Private evidence for this earlier release: `.secrets/specification-release-110-verification.json` and `.secrets/specification-release-reconciliation.json`.

Migration 0110 is additive and begins with empty specification tables, so old Workers can coexist during rollout. Sites deploy before the platform starts creating specification versions. **After use of saved specifications, do not roll back to a platform/site Worker that lacks their safety gates**; use an archived forward repair preserving those checks. Worker rollback never removes the D1 snapshots/receipts. No provider activation, new paid service or customer publication is part of this release.


### Live acceptance repairs

The first signed synthetic account successfully prepared and applied the import, but a requested content edit stopped at a status-only read. The new lookup returned an object while the existing inspection pipeline requires a string; scripted responses had not asserted the actual lookup delivered to the second model call. The read now emits compact serialized editable content/reference data, without growing version history. The connected fixture explicitly checks that the second call receives the exact revision/content IDs/text.

That run also exposed operator whole-account cleanup ordering: the account's receipt cascade can execute before its project cascade. Additive migration `0111_specification_account_cleanup.sql` retains receipt rows while both owner and project exist, and permits their cleanup after either parent has been removed. Direct receipt deletion is still rejected for a live account/project. The connected fixture now covers account cleanup as well as project cleanup. No customer account-delete route is added. The first fixture's whole-account cleanup was verified after migration 0111; `.secrets/specification-fixture-cleanup-verified.json` records it. The live test now preserves cleanup failure evidence instead of masking the original outcome.


Repair release `76d4ced1-07eb-4e70-9f7e-e74c3bb1f48e`, source `4ca6624`, completed with **111 migrations**. Active versions: platform `b9594686-c953-43df-a367-41c5bee42f52`, sites `33483460-7750-4e9e-a7c2-4d781e56ddcf`, apps `235f61c8-7a48-49cd-add5-1afc95cfb9e7`, runtime `a8b1ac43-d3c7-410a-a675-bc334c65f8a6`. Build input digest `bae670aece8c2970ec72d8392bf21fc08f08a879021ce902fe2e62ab52d1800d`. At 2026-09-30T23:51:12.052Z the live version/schema/17-guard/auth checks and exact HTML/16-asset readback passed again. Private evidence: `.secrets/specification-release-verification.json` and the immutable release archive. The expanded local connected journey, type check and build passed before this deployment.


### Authenticated live acceptance — September 30, 2026

`RUN_LIVE_SPECIFICATION=1 node tests/specification-live.mjs` passed at **2026-09-30T23:53:13.312Z** against the repair release. The fixture provisions only a synthetic test identity and a deterministic owned legacy page, signs a passkey challenge, completes profile/onboarding, then sends natural-language requests to the deployed configured Muse test route. It verified:

- Owned import review, anonymous preview refusal, exact private preview bytes and recent-auth typed approval/replay.
- A real model read → content-change proposal using the stored content IDs, exact comparison and immutable old preview.
- A requested restore to an older configuration creating forward revision 3, exact original HTML and exactly three apply receipts despite repeated approvals.
- No active publication and a 404 at the synthetic customer hostname; standard AI customer-unit spend/reservations remained zero.
- Logout refusal and verified deletion of the synthetic account/project, including receipt cascades.

The opt-in live fixture is tracked; it does not publish customer content, create external resources or perform CMS work. A cleanup identity file is retained on failure and blocks a new run until resolved. Private sanitized evidence: `.secrets/specification-live-evidence.json`. This is live synthetic API/model acceptance, not a physical-device passkey test or acceptance of unimplemented forms/API/staff modules. All WH-066B criteria are satisfied for the documented homepage adapter; WH-066 and child #17 remain open for their full scope.
