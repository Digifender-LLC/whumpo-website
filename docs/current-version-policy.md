# Current-version-only Whumpo

**Owner directive, October 1, 2026. WH-120, [issue #53](https://github.com/zemdregon/whumpo/issues/53).** Whumpo is pre-release. Support one current API, schema, client and execution path. Remove legacy adapters, aliases, compatibility renderers and retired product modes. This supersedes earlier planning requirements to preserve old clients or behavior; dated historical evidence still records what ran at that time.

## Required behavior

- A stale/unknown version or retired identifier fails explicitly. Never silently select an older model, schema, renderer, route, plan or free allowance to make it work.
- Move retained test data forward through a reviewed, idempotent migration, or explicitly retire disposable fixtures. Do not maintain dual readers/writers to accommodate old records. Preserve the facts and unresolved identity of committed operations; a migration cannot rewrite an approval digest and reactivate it.
- Deploy current components together using a reviewed cutover. A breaking change may require a maintenance stop. Repair with a current release; do not make an older binary an ongoing supported mode. Cross-Worker dispatch must still prevent incompatible mixed execution during deployment.
- Authentication/consent, explicit approvals, current-operation reconciliation, offline reconnect and storage-error handling remain defined parts of the current product. They grant no older protocol or permission. Provider-defined DNS origin terminology and framework loading placeholders do not constitute a legacy implementation.
- The current [Chat interaction contract](chat-interactions.md) rejects stale clients and removes the proposed downgrade projection. Web/PWA and future native clients consume the same current handlers.

## Removal inventory

The inventory distinguishes actual runtime paths from historical text and current features. Source completion is separate from test deployment; the parent issue remains open until all entries and required acceptance are resolved.

| Area | Current finding / required work | Status |
| --- | --- | --- |
| Workspace identity | `Profile.accountId` was optional, with email as the query/session key and missing-account browser-recovery mode. Require a valid current account UUID from the authenticated profile before workspace entry. | Removed in current source; focused acceptance below. |
| DNS alias | `confirmTXT` was an alias for current `confirmDNS`. All consumers must use the current name. No DNS handler behavior or remote record changes. | Alias removed in current source; fixtures use `confirmDNS`. |
| Chat interaction/native plans | Unsupported-schema projection, older-client renderer and browser downgrade had been proposed. | Removed from WH-105 in merged PR #52; strict current-client rejection is the contract. |
| Billing/credits | `legacyPlans` permits Launch/Studio; entitlement selection can silently substitute Explore. Old test-credit preference/reservation interfaces and calendar-month grants need explicit retirement and data/receipt disposition. | Pending source/data audit and removal. Current standard AI remains nonbillable fair use. |
| Chat text and actions | `chat-language.ts` rewrites known historical command prose, while some current handlers still emit it. Replace the producers/presentation dependency together; typed human action handlers remain authoritative. | Pending. Removing the text filter alone would expose commands again. |
| Website specifications | Current draft creation/edit paths still produce page config that `importLegacySpecification` converts. Create/save the current specification directly, remove legacy import admission, and forward-convert retained test drafts. Preserve current photo support and exact publication reviews. | Pending complete current-path replacement and compiler pin/schema evidence. |
| CMS bodies/provenance | Validators accept older plain-text/staged representations and preserve optional older receipt shapes. Consolidate current shape and plan explicit retained-row conversion. | Pending. CMS functional testing remains owner-deferred; no live CMS acceptance is claimed. |
| Release/identity/other plans | Earlier docs require old-client coexistence, password retirement staging and supported old binaries. Audit each active contract against current-only cutovers without dropping recovery or revocation guarantees. Current explicitly supported authentication methods are not automatically legacy solely because another method is planned. | Pending targeted reconciliation; no credential/identity cutover performed. |

## Verification scope

`tests/current-interfaces.mjs` checks current authenticated profile admission and absence of the removed DNS export using bundled actual modules and synthetic responses. Existing `chat-recovery` and `chat-recovery-profile` checks cover retained draft/request identity and real current profile handlers with disposable SQLite. Type checks/build verify the current frontend. No provider DNS call, billing mutation, customer publication or CMS functional test is involved.

For remaining entries, use the actual current handler and schema boundaries: retired identifiers must reject, new project creation must directly produce a current specification, typed actions must retain exact review checks, and migrations must not replay or erase unresolved effects. Re-run only the focused suites for the touched path. Record deployment source/version separately; local success does not establish that the test site has changed.

**First source slice verified — October 1:** `node tests/current-interfaces.mjs`, `node tests/chat-recovery.mjs`, `node tests/chat-recovery-profile.mjs`, `pnpm --config.verify-deps-before-run=false run check` and `pnpm --config.verify-deps-before-run=false run build` passed. Roadmap validation/alignment/render checks and diff checks passed. The profile test uses actual handlers with disposable SQLite; interface responses are synthetic. DNS fixtures now import the current export, with no DNS/provider call in this verification. Deployment and the remaining inventory are still pending under the open parent issue.
