# Platform account closure

## Status — October 1, 2026 UTC

**Implemented:** read-only operator inventory in `tools/account-closure-inventory.mjs`.
**Not implemented:** customer platform-account closure, external-resource teardown, legal-hold decisions, or deletion reconciliation after recovery. Visitor-account deletion is a separate feature documented in [app-data.md](app-data.md).

The [proposed data lifecycle contract](data-lifecycle.md) maps all 148 control tables into 31 explicit classes at migration 0113 and defines export, backup and restore-suppression requirements. Full configuration copies and metadata receipts have separate classes. Proposed retention windows remain unapproved. `node tools/lifecycle-catalog.mjs` checks schema coverage without reading account data. The [background-job decision](background-jobs.md) traces resumable cleanup; its local prototype does not enable account deletion.

Run `node tools/account-closure-inventory.mjs` from the repository root with existing operator Cloudflare authorization. The CLI accepts no arguments and returns platform aggregate counts. Its internal function also accepts an exact account ID as a bound SQL parameter; an unknown account fails rather than returning a reassuring empty report. There is no customer HTTP route or agent action.

One SELECT reads the control-database inventory at one query snapshot. It counts projects/live service records, sessions, Chat turns/review receipts, composition plans, full website/service proposals and snapshots, separate private-save/activation receipts, provider credentials/revocations and authorization attempts, domains, CMS resource registrations, file references, profile photos, imported source, safety evidence/corrections, pending scan tickets, unresolved usage, checkout/ledger records and redeemed invitations. No credentials, identities, source code, Chat text, filenames, object keys or provider identifiers are returned. Expired proposals/plans still count while bytes remain. CMS rows are inspected as lifecycle metadata only; this does not provision or test a CMS.

Missing schema, failed queries and invalid counts fail the report. Even an empty inventory returns `readyForDeletion: false`. Counts describe database records, not confirmed provider resources. This is not an exhaustive personal-data export, dependency graph, or authorization to delete.

## Required closure sequence

1. Authenticate a recent owner session and present an explicit, concrete closure review. Establish a durable closure state and stop new work/authorizations/publication before capturing the final inventory. A model cannot approve closure.
2. Resolve restricted preservation and retention requirements before destructive cleanup. Existing safety records cascade with accounts and are not a legal-hold system. A blocked verdict is a review signal, not a legal determination; zero blocked rows is not clearance.
3. Reconcile dispatched/uncertain AI, usage, checkout and provider operations using their existing immutable receipts. Never release an uncertain reservation merely because closure was requested. Document handling of remaining credits before paid plans become available; see [plan-lifecycle.md](plan-lifecycle.md).
4. Withdraw public services and reconcile external domain/CMS resources and pending creation jobs. Database cascades do not remove provider resources. Do not delete customer-owned repositories, zones or other infrastructure by implication; review the exact ownership and cleanup scope.
5. Revoke connected credentials while encrypted tokens and the original encryption key remain available. Resolve in-flight OAuth attempts and sessions so delayed callbacks cannot reconnect the account. Retain unresolved revocation authority until provider confirmation.
6. Inventory and remove eligible private object storage, database content and account records in an idempotent, resumable workflow. Reconcile cleanup queues and orphaned objects. Domain and invitation foreign keys, retained CMS records and other references mean raw `DELETE users` is not a closure implementation.
7. Maintain deletion receipts outside the deleted account's cascade. Reapply them on restores and reconcile external backups and their retention. Define and verify the customer-facing deletion promise before claiming completion.

No new paid services or provider writes are performed by the inventory.

## Verification

`node tests/account-closure-inventory.mjs` applies all current migrations (113 at the October 1 recheck) to an in-memory SQLite database, enforces SQLite query-only mode, checks platform and tenant scopes against separate synthetic owners, verifies pending-revocation and expired-plan counts, rejects nonexistent/injected scopes and invalid results, and checks that sensitive fixture values do not enter the report. It exercises the actual SQL, not a mock substitute for its predicates. `node tests/specification-journey.mjs` and `node tests/service-client-activation.mjs` additionally verify full configuration/proposal and metadata receipt counts against actual local application flows, including separate-owner isolation. These checks use synthetic data; no live inventory was repeated in this reconciliation.

A read-only query of the private test D1 database succeeded at **2026-09-30 17:45:41 UTC**: one account, one project, no live project service records, no connected provider credentials or registered CMS/domain resources, and **one unresolved metered usage operation**. This operation requires reconciliation before closure; the inventory did not change it. Local evidence is `.secrets/account-closure-inventory.json` (ignored). External provider resources, R2 orphans, backups and actual deletion remain unverified. No Worker deployment or migration was needed for this operator tool.

October 1, 2026: the read-only inventory also counts staged GitHub credentials (`githubStagedCredentials`) separately. They remain included in the total encrypted credential count and must be disconnected/revoked before any future account closure; a missing connection pointer does not mean no provider credential is retained. This adds no deletion capability.
