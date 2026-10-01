# Current-version-only Whumpo

**Owner directive, October 1, 2026. WH-120, [issue #53](https://github.com/zemdregon/whumpo/issues/53).** Whumpo is pre-release. Support one current API, schema, client and execution path. Remove legacy adapters, aliases, compatibility renderers and retired product modes. This supersedes earlier planning requirements to preserve old clients or behavior; dated historical evidence still records what ran at that time.

## Required behavior

- A stale/unknown version or retired identifier fails explicitly. Never silently select an older model, schema, renderer, route, plan or free allowance to make it work.
- All environments are disposable testing environments. The owner authorizes deleting obsolete data; do not build preservation migrations or dual readers/writers. Current operation approval and recovery boundaries still apply.
- Deploy current components together using a reviewed cutover. A breaking change may require a maintenance stop. Repair with a current release; do not make an older binary an ongoing supported mode. Cross-Worker dispatch must still prevent incompatible mixed execution during deployment.
- Authentication/consent, explicit approvals, current-operation reconciliation, offline reconnect and storage-error handling remain defined parts of the current product. They grant no older protocol or permission. Provider-defined DNS origin terminology and framework loading placeholders do not constitute a legacy implementation.
- The current [Chat interaction contract](chat-interactions.md) rejects stale clients and removes the proposed downgrade projection. Web/PWA and future native clients consume the same current handlers.

## Removal inventory

The inventory distinguishes actual runtime paths from historical text and current features. Source completion is separate from test deployment; the parent issue remains open until all entries and required acceptance are resolved.

| Area | Current finding / required work | Status |
| --- | --- | --- |
| Workspace identity | `Profile.accountId` was optional, with email as the query/session key and missing-account browser-recovery mode. Require a valid current account UUID from the authenticated profile before workspace entry. | Removed and deployed in the October 1 current billing release below. |
| DNS alias | `confirmTXT` was an alias for current `confirmDNS`. All consumers must use the current name. No DNS handler behavior or remote record changes. | Alias removed and deployed; fixtures use `confirmDNS`. |
| Chat interaction/native plans | Unsupported-schema projection, older-client renderer and browser downgrade had been proposed. | Removed from WH-105 in merged PR #52; strict current-client rejection is the contract. |
| Billing/credits | `legacyPlans` permits Launch/Studio; entitlement selection can silently substitute Explore. Old test-credit preference/reservation interfaces and calendar-month grants are retired with their disposable test data. | Removed and deployed: invoice-only coverage, retired tables/routes/handlers deleted, no unknown-plan substitution. Verification below. |
| Chat text and actions | `chat-language.ts` rewrites known historical command prose, while some current handlers still emit it. Replace the producers/presentation dependency together; typed human action handlers remain authoritative. | Request/reply rendering, obsolete help/navigation interpreters and review-selection fallbacks removed in source; producers emit plain language and canonical action receipts replace command-text approval proof. Private guided website creation is removed by the website replacement below. Deployment of these Chat changes is pending. |
| Website specifications | New drafts save schema 2 directly; reviewed edits/restores include photos. Legacy import, full-page edit/preview actions, launch-page admission, duplicate offline prototype and guided website writers are removed. One current content/service compiler each; stale snapshots reject. | Source implemented with new compiler pins and schema 0119; local verification in the compiler/storage contracts. Deployment and obsolete test-data reset pending. |
| CMS bodies/provenance | Validators accept older plain-text/staged representations and preserve optional older receipt shapes. Consolidate the current shape and reset obsolete fixtures. | Pending. CMS functional testing remains owner-deferred; no live CMS acceptance is claimed. |
| Release/identity/other plans | Earlier docs require old-client coexistence, password retirement staging and supported old binaries. Audit each active contract against current-only cutovers without dropping recovery or revocation guarantees. Current explicitly supported authentication methods are not automatically legacy solely because another method is planned. | Release tooling now admits only version-2 test reviews and forward-only reset/recovery. Identity/native and module/data-protection plans now use current-only resets and forward repair. Logical-resource offline contracts now use one exact schema and reject compatibility lists; no credential cutover performed. |

## Verification scope

`tests/current-interfaces.mjs` checks current authenticated profile admission and absence of the removed DNS export using bundled actual modules and synthetic responses. Existing `chat-recovery` and `chat-recovery-profile` checks cover retained draft/request identity and real current profile handlers with disposable SQLite. Type checks/build verify the current frontend. No provider DNS call, billing mutation, customer publication or CMS functional test is involved.

For remaining entries, use the actual current handler and schema boundaries: retired identifiers must reject, new project creation must directly produce a current specification, typed actions must retain exact review checks, and current operation retries must not duplicate effects. Test resets may discard obsolete fixtures. Re-run only the focused suites for the touched path. Record deployment source/version separately; local success does not establish that the test site has changed.

**First source slice verified — October 1:** `node tests/current-interfaces.mjs`, `node tests/chat-recovery.mjs`, `node tests/chat-recovery-profile.mjs`, `pnpm --config.verify-deps-before-run=false run check` and `pnpm --config.verify-deps-before-run=false run build` passed. Roadmap validation/alignment/render checks and diff checks passed. The profile test uses actual handlers with disposable SQLite; interface responses are synthetic. DNS fixtures now import the current export, with no DNS/provider call in this verification. Deployment and the remaining inventory are still pending under the open parent issue.

## Current billing and release policy — October 1, 2026

Source `75e41ff` removes retired Launch/Studio admission, old test-credit checkout/preferences, calendar grants, metered Chat settlement/recovery, legacy billing UI/history, and their operator cleanup paths. Current subscription invoices determine paid coverage; missing coverage is explicitly Explore, while unknown coverage is an error. Standard AI keeps zero customer credit charge and its own current receipts. Reset `0117_current_billing.sql` discards eight obsolete test tables and retired plan fixtures. It does not translate them into current receipts.

Release preparation now accepts only current version-2 reviews for `ENVIRONMENT=test`. Destructive test resets require the explicit reset review; older review/restore fields reject. Uncertain provider outcomes, immutable archive checks and exact current service/secret boundaries remain enforced.

Local acceptance passed:

- Both TypeScript projects and the frontend build.
- `billing`, `checkout`, `plan-catalogue`, `billing-ui`, `ai`, `current-interfaces`, `frontend-loading`, and `release-manifest` checks. The billing test resets populated obsolete SQLite state through actual schema/handlers; checkout checks retired event nonfulfillment and current signature/configuration gates.
- Credential-free local D1 suites: `subscriptions`, `plan-periods`, `standard-ai-usage`, `standard-ai-chat`, `standard-ai-recovery`, `standard-ai-history`, `model-costs`, `fair-use-observation`, `fair-use-reviews`, `agent-inspection`, `workspace-read`, `customer-site-journey`, `site-agent`, and `first-ai-journey`.
- Lifecycle catalogue, account-closure inventory, maintenance inventory, roadmap validation/alignment/render consistency, 1,817 local Markdown file targets, and diff checks.

The agent fixture now uses a current synthetic photo clearance and 64-character digest. This is fixture maintenance, not scanner implementation or live detection acceptance. No model/provider call, real charge, customer publication or CMS functional test was part of these local checks. Deployment evidence follows separately.

### Test deployment acceptance

Managed release `438cdaa6-4ef5-46b8-a8c1-ea3115ef61af` completed October 1 at 18:19 UTC, with independent application readback at 18:20 UTC. Archived application/tooling source is `75e41ff5c1de192e9d39d470d325666bd2f94811`; subsequent changes are fixture/evidence only. The archive records checkout dirtiness from the untracked shared dependency symlink; committed source and deployed bytes are pinned.

| Service | Verified active version |
| --- | --- |
| Platform | `6931136e-9a76-43e0-8f11-b2ef6f70918a` |
| Runtime | `9accd3cd-6883-402b-bcec-8a0e607e9c6a` |
| Apps | `683a4ab5-1967-4a37-986d-5157e5e57547` |
| Sites | `080cdd7d-6fd4-4981-981e-01fe15c314aa` |

All four candidate tags/identities and binding inventories match; all 117 schema files are applied with none pending and the CMS registry is unchanged. Direct database readback confirms all eight retired tables absent, five current catalogue IDs, and invoice-only paid coverage. A temporary authenticated fixture verified current account identity, zero-credit standard AI billing without retired fields, retired checkout/preferences routes returning 404, current sandbox subscription configuration, and the current public catalogue. Anonymous billing remains 401. All 18 built frontend asset files match deployed SHA-256 bytes. The fixture was removed afterward.

This also deploys the earlier profile/DNS source slice. No inference or payment-provider dispatch, customer publication, new service/paid activation or CMS functional test occurred. No physical-device or full disaster-recovery acceptance is claimed. WH-120 remains open for the other inventory entries.

## Planning reconciliation — October 1, 2026

Active identity, native, module-governance and data-protection plans now require one current contract and forward repair. WH-113/114 no longer specify a legacy identity stage, password migration grant, per-account old-policy coexistence or old-binary rollback. Android requires current APIs and rejects unsupported controls rather than downgrading to a browser renderer. Obsolete test records may be reset; current operation receipts, key rotation, content restoration, revocation and privacy boundaries still have their own checks. Planned auth changes remain unimplemented until WH-114/115 and their acceptance work are delivered.

This also removes the retired-balance preservation requirement from WH-043 and the old table authority reference from WH-090. Historical dated evidence is retained as history. Task identities, dependency edges, issue mappings and deferred gates are unchanged. The subsequent offline resource slice below removes multiple read/restore schemas and the proposed legacy placement adapter. Chat, website and CMS runtime entries remain open.

Planning-slice verification: roadmap validation/alignment/render consistency and diff checks passed; all 1,223 local Markdown file targets in changed documents resolve. All 120 task IDs, dependency edges, issue mappings, owners, readiness/blockers and historical evidence are preserved. No application test, deployment, credential reset or authentication change was performed for this documentation-only slice.

### Offline resource contract

The WH-071 reference now admits one exact schema for reads, writes and restoration. Retired descriptor compatibility fields reject instead of selecting an older reader. Exact adapter pin checks cover both older/newer versions and changed bytes. The implementation plan removes the proposed legacy publication/visitor adapter and uses current-schema placement recovery. All 60 offline contract/scenario checks passed, along with roadmap validation/alignment/render consistency and diff checks. This reference has no production imports; no deployment or customer operation occurred.

## Current typed Chat receipts — October 1, 2026

Current source stores plain-language control labels with canonical immutable `action_json`. It removes `displayChatRequest`, the literal-versus-command renderer switch, text-only lost-response recovery, and application/restore review selection from command text or a matching turn ID. Exact current reply-digest links now identify those reviews. Schema 0118 replaces five command-text transaction gates with exact typed action/review identity, including integer revision and proposal digest where applicable. It does not translate obsolete test receipts. Browser recovery admits only its current version-2 record.

This request/approval boundary slice was followed by the plain-language producer cleanup described below. Current internal domain dispatch remains private; its obsolete guided website creation is included in the pending website replacement. Deployment is pending; the last accepted test release remains the billing release above. Local verification passed:

- Both TypeScript projects and the frontend build.
- `natural-chat`, `customer-site-journey`, `directories`, `directory-history`, `domain-proof-removal`, `specification-journey`, `service-client-journey`, `service-client-activation`, `app-recovery`, `app-activation-http`, `application-build` and `customer-app-journey` against isolated local D1. Scripted inference and isolated QuickJS are used where those fixtures require them; no live provider calls.
- `chat-delivery`, `chat-recovery`, `chat-reply`, `chat-history`, `current-interfaces` and `lifecycle-catalog`. These cover changed-action/same-label and changed-revision retries, missing typed identity, immutable action/label records, rejected retired browser records, literal request rendering and exact receipt-based review presentation.
- Direct before/after inspection confirmed the five database approval guards changed only their request-identity predicates; owner, expiry, revision, safety, quota and artifact checks remain present. Roadmap validate/alignment/render checks, 19 changed-document file links and diff checks passed.

The application build fixture was corrected after its new missing-receipt negative case revealed that the actual builder already writes the receipt. It now explicitly removes only that disposable fixture receipt, proves refusal, restores the exact current receipt and proves admission. No CMS functional test, remote database change, customer publication or paid inference occurred.

## Current Chat reply producers — October 1, 2026

Handlers now emit plain-language review, inspection, recovery and pagination guidance. The frontend renders saved replies literally; it no longer imports `chat-language.ts` or rewrites historical command prose. Source blocks and URLs remain literal escaped text, and only the existing fixed publishing-desk path can become a navigation link. The obsolete help catalogue, server navigation parser and unused browser navigation resolver are deleted. Current provider-return handling remains.

Application-maintenance and publishing-work inventories expose saved review/request IDs instead of command suggestions. Exact saved-reply predicates were changed with their producers, without old-text alternatives. CMS import/publication presentation no longer selects reviews by commands in saved user text. These CMS edits received source/type review only; CMS functional testing remains deferred. Private current domain dispatch is retained; its obsolete guided website-creation path is still included in the pending website-specification replacement above.

Local verification passed:

- `pnpm --config.verify-deps-before-run=false run check` and `pnpm --config.verify-deps-before-run=false run build`.
- Credential-free disposable D1 checks: `natural-chat`, `customer-site-journey`, `customer-app-journey`, `app-migration-checks`, `backend-state`, `backup-chat`, `hosting-chat`, `dns-agent`, `workspace-read`, and `connection-chat`. Application checks use the existing isolated QuickJS and synthetic visitor authentication; inference/provider responses are scripted where needed. They verify current approval/replay/ownership, exact receipt wording and recovery without duplicate effects.
- `chat-reply`, `provider-return`, `chat-delivery`, `chat-recovery`, `current-interfaces`, `connection-readiness`, `frontend-loading` and `lifecycle-catalog`.
- Roadmap validate/alignment/render consistency, 1,111 local file targets in changed Markdown documents, and diff checks.

Two initial fixture assertions were corrected: the natural Chat prose assertion now reads the saved website reply rather than its input request, and DNS pagination expects the current plain-language guidance. Both suites passed afterward. The retired navigation-interpreter suite is removed with its implementation; provider-return and public natural-message checks remain.

This is verified source only. No deployment, remote schema/data reset, live inference/provider dispatch, real billing, customer publication or CMS functional test occurred. The last accepted test release is still the billing release recorded above. The pending typed-receipt schema and current client/server must ship together; obsolete test receipts must not be translated into approval authority. WH-120 remains open for website/CMS shape cleanup and deployment acceptance.

## Current website specifications — October 1, 2026

The website replacement removes stored-page conversion and creates the current specification/page/head atomically from the first draft. Later changes and restores use exact reviewed operations, including name, sections and photos. Both current page presentations remain supported; the standalone launch component and private guided writers are retired. The two compiler version-2 locks replace their old implementations, and schema 0119 adds immutable first-save authority alongside existing typed approval guards. Old snapshots/locks reject even at public page/photo serving.

[Compiler contract and evidence](project-specification-compiler.md) and [storage/transaction evidence](project-specification-storage.md) distinguish local source verification from pending deployment. The duplicate pre-runtime specification prototype has been removed; current contract tests target actual modules. CMS functional testing, CSAM implementation and Daybreak remain deferred.

### Website source verification

Both TypeScript projects and the frontend build pass. Current compiler tests verify independent reproduction and reject old schemas/locks; actual-handler SQLite checks cover first-save and reviewed-write atomicity, photos/holds, lost-response replay and 25-version quota rollback/slot recovery. Connected disposable D1 checks pass for `specification-journey`, `customer-site-journey`, `welcome-first-draft`, `site-agent`, `first-ai-journey`, `agent-inspection`, `composition-planner`, `workspace-read`, and the three service-client authority/journey/activation suites. The existing isolated QuickJS is used where required; inference is scripted.

Dependent checks pass for publication, export, photo versions/removal, version comparison/removal, contact intake, backend forms and HTTP, directories/history, site health/traffic, domain hosting and GitHub backups/Chat. Fast inference/prompt/ack checks, private comparison HTTP responses, Chat reply/delivery/current interfaces, build snapshots/release manifests, lifecycle/account-closure/maintenance inventories and roadmap consistency also pass. The obsolete guided onboarding/preview/prototype suites are deleted; current welcome, first-save, quota and approval coverage remain. Fixture changes use actual current builders, not a legacy-command adapter.

The competing welcome draft check exposed a missing current-state recheck before interpreting the model result; the orchestration now records a failed competing attempt without a phantom success version. Other initial failures were stale fixture expectations: removed command prose, missing synthetic auth limiter, and a purported new comparison version that requested no change. Fixtures now assert the current contract, and each affected suite passed afterward.

Live acceptance harnesses and the browser journey are updated to create current first drafts and approve subsequent edits; they received syntax checks only in this slice. CMS fixture component admission received a static update only. No CMS functional test, scanner implementation, provider activation or customer publication occurred. The remote read-only account inventory was unavailable and supplies no deployment evidence. The test deployment remains at schema 0117; current Chat/website schemas 0118/0119, current client/services and obsolete test-data reset still require coordinated deployment and readback.
