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
| Chat text and actions | `chat-language.ts` rewrites known historical command prose, while some current handlers still emit it. Replace the producers/presentation dependency together; typed human action handlers remain authoritative. | Pending. Removing the text filter alone would expose commands again. |
| Website specifications | Current draft creation/edit paths still produce page config that `importLegacySpecification` converts. Create/save the current specification directly, remove legacy import admission, and reset obsolete test drafts. Preserve current photo support and exact publication reviews. | Pending complete current-path replacement and compiler pin/schema evidence. |
| CMS bodies/provenance | Validators accept older plain-text/staged representations and preserve optional older receipt shapes. Consolidate the current shape and reset obsolete fixtures. | Pending. CMS functional testing remains owner-deferred; no live CMS acceptance is claimed. |
| Release/identity/other plans | Earlier docs require old-client coexistence, password retirement staging and supported old binaries. Audit each active contract against current-only cutovers without dropping recovery or revocation guarantees. Current explicitly supported authentication methods are not automatically legacy solely because another method is planned. | Release tooling now admits only version-2 test reviews and forward-only reset/recovery. Identity/native reconciliation remains pending; no credential cutover performed. |

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
