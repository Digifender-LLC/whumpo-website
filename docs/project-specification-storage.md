# Saved website configurations and reviewed changes

**September 30, 2026 — WH-066B / [#16](https://github.com/zemdregon/whumpo/issues/16).** Implementation connects the [pinned compiler](project-specification-compiler.md) to owned D1 state, natural-language Chat, private previews and exact owner approvals. The [specification ADR](project-specification.md) remains the schema contract. Deployment and acceptance evidence are separate below. The full composition outcome stays in [WH-066 / #14](https://github.com/zemdregon/whumpo/issues/14); forms/API and broader delivery remain [#17](https://github.com/zemdregon/whumpo/issues/17).

## Customer flow

1. Ask the agent to prepare an existing saved website for structured editing. The server loads an **owned immutable `site-page@1` version**, verifies normalized configuration and byte-exact rendering, and prepares a ten-minute import review.
2. Chat names the website, changed fields and private-save scope. The owner can open the proposed website and the complete before/after comparison. These links require authentication and current ownership; HTML uses the existing private, sandboxed preview headers.
3. **Save reviewed private version** sends a typed approval containing the review UUID, exact proposal digest and expected specification revision. Same-origin checks, a recent sign-in and the authentication rate limiter apply. The agent cannot call this approval, and typing a slash command or “yes” does not approve it.
4. A subsequent natural-language edit reads the current specification and its content IDs. `content.replace` and `design.setTheme` compile a new candidate without inference. The owner reviews and saves it in the same way.
5. Restoring a saved configuration creates a **new forward version** under the same review contract. Existing versions remain immutable. Publication uses the separate existing publication review; saving/restoring a configuration never moves the live pointer.

The Chat tools are `specification` operations `read`, `import`, `change`, `restore` and `review`. The `read` operation participates in the bounded, two-call inspection continuation. Models interpret the request and select a validated operation; compilation, preview, comparison and approval make no model calls. Standard assistance remains zero customer-unit debit. Generic full-page preview/edit proposals cannot bypass a project's saved specification. If another existing adapter creates a draft, its revision invalidates pending reviews; the agent must explicitly choose and review a fresh import before another structured edit.

The mounted adapter supports **one public homepage at `/`, declaring only `content@1`**. Extra routes and records/forms/files/access/integration/rule declarations fail closed, even though the schema library can validate more. There are no secret values or role grants to restore through this adapter. It does not attach media, execute generated source, provision infrastructure or change visitor data. The content compiler's one-to-four-page output remains a library capability until its broader delivery adapter exists.

## Persisted authority and transaction

Migration `0110_project_specifications.sql` introduces:

| State | Purpose and retention |
| --- | --- |
| `projects.site_draft_revision` | Increments on every new immutable website version, including existing adapters. Pre-migration history starts at zero; creating another draft invalidates a prepared review. Removing an unrelated old version does not invalidate the head. |
| `project_spec_proposals` | Immutable candidate spec, compiler lock, exact HTML/configuration/manifest, readable diff and review envelope. Binds owner/project, operation, request hash, current specification/draft revisions, base/restore target, digests, policy and ten-minute expiry. |
| `project_spec_versions` | Full independent configuration/lock/manifest snapshot paired with the existing immutable `site_versions` row. No delta chain or dependency on the continued existence of a proposal/ancestor. |
| `project_spec_applies` | Immutable metadata-only idempotency receipt. Unique proposal, output version and project revision; exact request hash prevents a changed-payload replay. Survives removal of the candidate/version while the project remains. |
| `project_spec_heads` | Current specification version and revision, advanced only by a valid apply receipt. |
| `project_spec_chat_links` | Immutable owner-scoped review link with the exact server reply digest. Edited or model-invented text cannot acquire an approval button. |

Before preview, approval or reopening a review, the server checks ownership, current revisions/base, target existence, expiry, policy identity, current compiler/catalog compatibility and every saved artifact/envelope/diff digest. It recompiles from the saved specification using the exact pinned lock and compares actual output bytes. Unsupported schema or renderer-size errors become fixed safe responses, never raw submitted values or SQL.

The confirmation turn, workspace revision, immutable site/specification versions, receipt, head and activity event commit in the existing [D1 batch transaction](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). Database guards recheck owner/project, exact canonical confirmation, candidate/base/target, revisions, expiry, safety holds and quotas **inside the transaction**. A candidate removed after application validation forces an abort; a no-op insert cannot save a success-only reply. Concurrent stale requests cannot both advance the head. A lost acknowledgement is recovered from the original owned turn/receipt without compiling or creating another version.

Current compiler/policy code is trusted Worker configuration, checked again on each operation; it is not an editable customer database row. Future module withdrawal/version upgrades need their own delivery compatibility review. The immutable v1 compiler identity remains unchanged.

## Removal, bounds and safety

The current specification head and base/target of an unexpired unapplied review are retained. Existing live-publication, pending publication, backup and exact-removal protections still apply. Removing an eligible version purges proposals and full comparison/candidate copies associated with it, and cascades its specification snapshot. Independent later versions retain their own full content. Metadata-only apply receipts prevent retries from resurrecting removed bytes or moving the head backward. Explicit operator parent-project cleanup cascades all new state; no new customer account/project delete endpoint is added.

Proposal preparation removes expired candidate copies for that project and up to 100 expired copies elsewhere; this is bounded transaction cleanup, not a scheduled global purge. Immutable versions and metadata receipts are independent of that cleanup. Limits are 50 retained proposals per project / 4,000 platform-wide and 500 apply receipts per project / 20,000 platform-wide. Existing 25 saved-site-version limits remain. The compiler bounds each spec to 32 KiB, lock to 4 KiB and homepage HTML to 32 KiB; persistence additionally bounds manifest, diff and review envelopes. Capacity failures require freeing eligible saved versions or operator review of test limits; they do not create paid resources or silently prune recoverable versions.

A persisted `generated_artifact` screening decision marked **required** is a hold, never a clearance. Exact spec, manifest and HTML hashes are checked before proposal/apply. A later hold on a base/restore target also invalidates the review and is rechecked in the apply transaction. Held saved configurations are excluded from the new specification read and ordinary latest/exact-version model inspection. Private preview, comparison, export (including backup preparation), publication changes and public page serving reject a held specification version. Public serving returns a generic temporary-unavailability response, not held bytes. Critical unpublish remains available.

This is **not a new detector or a complete generated-content safety implementation**. No scanning decision is automatically created by these tools, no result is interpreted as approved, and existing unconnected screening/retention gaps remain launch gates in [safety coverage](safety-coverage.md). Historical Chat text and unrelated artifact families are not newly quarantined by this feature. Financial Monitor cannot override these known holds.

## Prerequisites and cost

Uses Whumpo's existing private test D1 and Workers services; no new resource, paid-only service, provider authorization, customer DNS or AI routing change. D1 read/write/storage and Worker execution accrue against existing account allowances; this is not a promise of zero marginal provider cost. Cloudflare [D1 batch semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) checked September 30, 2026. Account-wide usage and entitlement remain operational checks.

## Verification and deployment

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

Live readback at **2026-09-30T23:40:54.703Z** confirmed all four versions, all 110 migrations, 17 new guards, workspace HTML and all 16 frontend asset hashes against the archive. Landing/workspace/health returned 200; anonymous Chat and specification preview requests returned 401. Browser readback after rebuilding confirmed the friendly approval receipt. Private evidence: `.secrets/specification-release-verification.json` and `.secrets/specification-release-reconciliation.json`.

Migration 0110 is additive and begins with empty specification tables, so old Workers can coexist during rollout. Sites deploy before the platform starts creating specification versions. **After use of saved specifications, do not roll back to a platform/site Worker that lacks their safety gates**; use an archived forward repair preserving those checks. Worker rollback never removes the D1 snapshots/receipts. No provider activation, new paid service or customer publication is part of this release.


### Live acceptance repairs

The first signed synthetic account successfully prepared and applied the import, but a requested content edit stopped at a status-only read. The new lookup returned an object while the existing inspection pipeline requires a string; scripted responses had not asserted the actual lookup delivered to the second model call. The read now emits compact serialized editable content/reference data, without growing version history. The connected fixture explicitly checks that the second call receives the exact revision/content IDs/text.

That run also exposed operator whole-account cleanup ordering: the account's receipt cascade can execute before its project cascade. Additive migration `0111_specification_account_cleanup.sql` retains receipt rows while both owner and project exist, and permits their cleanup after either parent has been removed. Direct receipt deletion is still rejected for a live account/project. The connected fixture now covers account cleanup as well as project cleanup. No customer account-delete route is added. The first fixture's identity is retained privately until this migration is applied and cleanup is verified; the live test now preserves cleanup failure evidence instead of masking the original outcome.
