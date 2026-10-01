# Current feature inclusion and private preview grants

**WH-090A / [#63](https://github.com/zemdregon/whumpo/issues/63), October 1, 2026. Source implementation; no test-platform rollout yet.** Parent [WH-090 / #62](https://github.com/zemdregon/whumpo/issues/62) remains open for admission adapters and connected acceptance. This is an inclusion input, not the complete feature authorization described by the [tier contract](plan-feature-contract.md).

## One current paid-plan source

`ensureBilling` reads the existing invoice-only `plan_entitlements` view. It selects the highest currently covered tier and returns its exact active coverage interval in epoch seconds, alongside the existing plan and reporting month. Multiple currently overlapping receipts at the same tier form a continuous union; future receipts do not prematurely extend today's decision. Start is inclusive, end exclusive. The reporting month does not change invoice service intervals, including annual intervals. Invalid coverage or a retired/unknown plan fails explicitly. The public billing response and zero-credit standard AI policy are unchanged.

`resolveFeatureInclusion` reuses that resolver and the current cumulative feature catalogue. It validates the account and ownership of any exact project before reading the plan or grant. Its closed input requires all four fields:

```json
{"userId":"ACCOUNT_UUID","projectId":null,"featureId":"connections.github","operation":"connect"}
```

`projectId: null` means account scope; a UUID means one owned project. The caller must choose explicitly. Operations are `connect`, `read`, `prepare`, `confirm` and `dispatch`. Domain adapters register which operation applies to each real effect. They may not label new work as protected reconciliation to bypass inclusion.

The current result has `contract: "whumpo-feature-inclusion"`, `version: 1`, `purpose: "inclusion-only"`, the exact scope, evaluation time, current plan ID, `included` and an invoice or preview-grant source with its interval. A denied result has `source: null`. There is deliberately no `allowed` field. Planned catalogue entries can be included in a plan while still unavailable to execute. Explore, preferences, model output, configured OAuth tokens and environment flags create no inclusion.

## Explicit preview authority

Schema `0120_feature_preview_grants.sql` adds operator-owned metadata. Each row names one account, account/project scope, feature, operation, exact interval, non-secret review reference and `private-test-acceptance` purpose. A new grant lasts at most seven days and must start within seven days of issuance. The operator must choose actual timestamps; there is no automatic grant or refresh. Issuance accepts only the explicit local/test operator environment. Customer HTTP routes, models, Chat and jobs cannot issue or revoke grants.

Paid coverage takes precedence when it includes the feature. Otherwise, a matching unrevoked grant may supply inclusion. Account grants do not match project requests; one project's grant does not cover another. Grant operation/feature matches are exact. Expiry and revocation take effect on the next authoritative read. The result is not a bearer capability and must not be cached as execution permission.

Grant IDs and scope/interval/purpose are immutable. A repeated identical issuance reads the original row, including revoked or expired state; a changed payload under the same ID conflicts. Revocation is one-way and idempotent. Lost write acknowledgements use the same ID and readback, without creating a new grant. The database enforces owner/project linkage, immutable fields, bounded intervals, one-way revocation and lifetime row bounds of 1,000 per account / 20,000 globally. Those are private operator storage bounds, not customer plan allowances.

Terminal rows remain while their account/project exists, preventing a delayed request from recreating the same grant after deletion. Project/account cascade cleanup removes only its rows. No general age purge is implemented. Grant metadata belongs to the lifecycle inventory and account-closure counts; it contains no provider credentials, conversation, content or billing balance. Owner exports can later include scope, dates and revocation state; internal operator review references are excluded. Portable project export does not transfer feature authority to another account or deployment.

## Operator tool

Write a private JSON file under ignored `.secrets/`:

```json
{
  "version": 1,
  "command": "issue",
  "grant": {
    "id": "NEW_UUID",
    "userId": "ACCOUNT_UUID",
    "projectId": null,
    "featureId": "connections.github",
    "operation": "connect",
    "purpose": "private-test-acceptance",
    "reviewReference": "https://github.com/zemdregon/whumpo/issues/63",
    "startsAt": 0,
    "endsAt": 0
  }
}
```

Replace the placeholders and zero timestamps with the reviewed scope and real interval. This example is intentionally not an executable grant.

```sh
node tools/feature-preview.mjs --input .secrets/feature-grant.json
node tools/feature-preview.mjs --input .secrets/feature-grant.json --apply EXACT_PREVIEW_DIGEST
```

The first command is read-only. The digest binds the closed input, current environment, Cloudflare account and control database. It is an operator review guard, not a credential or customer approval. `--apply` uses the existing authenticated operator database connection. A changed destination or payload refuses. An uncertain outcome must use readback or the same exact ID.

Read and revoke use `{ "version": 1, "command": "read" | "revoke", "scope": { "userId": "ACCOUNT_UUID", "projectId": null }, "id": "GRANT_UUID" }`. Read needs no `--apply`; revoke uses the same preview/digest process. No live grant was issued while implementing this packet.

## Required downstream admission

[Packet B / #64](https://github.com/zemdregon/whumpo/issues/64) must combine inclusion with the single current authenticated principal, owner/membership/resource authority, current provider configuration and consent, readiness/safety/privacy gates, exact review and funding where relevant. The [identity contract](workspace-identity.md) owns restricted purpose, epoch and proof; this module neither implements nor fabricates those credentials. Existing current authentication remains unchanged until WH-114/115's coordinated cutover.

Adapters must recheck the current interval/grant and principal at OAuth activation, review confirmation and final dispatch, and invalidate returned provider data if authority changes during a read. A UI result, prepared review or token does not freeze inclusion. Atomic database predicates must close local write races; uncertain external effects retain their original read-only reconciliation path. Never repeat a send because inclusion was lost or a response was delayed.

Owner local history, supported export, security, revocation and basic recovery remain reachable under their existing identity/ownership checks. They do not need a paid-feature grant. Previously published sites are not automatically taken down. A revoked collaborator is not an owner with protected historical access. Standard owner assistance remains non-billable; runtime visitor AI and advanced-model funding stay separate.

Packet A does **not** claim the existing connection/Chat/background handlers enforce this interface yet. That work remains in packet B, followed by [packet C / #65](https://github.com/zemdregon/whumpo/issues/65)'s complete entrypoint/race acceptance and controlled test deployment. No fallback reader, legacy plan grant, paid activation, provider operation or CMS testing is introduced.

## Verification

The focused suite exercises actual current schema and handlers using disposable SQLite and local D1. It checks cumulative tier/feature/operation decisions, current invoice intervals and annual coverage, strict unknown/foreign scopes, exact preview matching, expiry/revocation, immutable and lost-acknowledgement receipts, operator destination/input review and parent cleanup. Feature inclusion alone dispatches nothing. Existing billing, invoice-period and subscription suites verify that the extension preserves the current paid coverage and public billing contract. Lifecycle and closure checks cover the new data class. Detailed results are recorded in issue #63.

### Verified locally on October 1, 2026

- `node tests/feature-inclusion.mjs` and `node tests/feature-inclusion.mjs --d1`: 728 tier/feature/operation/scope decisions in each backend, plus expiry, revocation, identical concurrent issuance, owner isolation, immutable records, lost write acknowledgement, operator digest and parent cascade cases. The D1 test uses a disposable local database with all 120 schema files; it creates no remote grant.
- `tests/billing.mjs`, `tests/plan-periods.mjs`, `tests/subscriptions.mjs`: current invoice billing, overlapping same-tier coverage, future intervals, invalid interval refusal, annual boundaries and subscription lifecycle passed. The public billing response stays unchanged.
- Lifecycle catalog, account-closure inventory and maintenance inventory checks passed; 149 tables are classified across 32 data classes.
- `pnpm check`, `pnpm build`, operator syntax checks, roadmap validation/alignment/render check and `git diff --check` passed.

These are local implementation results. Schema 0120 and this foundation have not been deployed; no live grant, provider activation or CMS functional test was performed. Full admission and deployment acceptance remain with #64 and #65.
