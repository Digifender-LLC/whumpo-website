# Account lifecycle integration — October 7, 2026

This is a local source integration with disposable tests. No live account was closed, no remote database was changed, and no provider, signing identity or deployment was activated.

The integration starts from `19b11509abe342dfd07648f41dfa88f6aed36c93` and squashes the exact reviewed PR #170 head `241aa946650e08b0568fb5a43512705d62073406`. Its reviewed patch is the diff from `ca17c6a`, 867,525 bytes, SHA-256 `2641b6f0908674ca182dc702050a824c2056f50fc42cbd68a38e3b0fef48ef0f`. The incoming scope includes account export/closure, policy consent, artifact admission, abuse reports, safety appeals and restore suppression. The independent static review requested repairs before integration; its two closure findings and the bounded composed-export allowance omission are addressed here.

## Repairs and integration

- The closure freeze statement repeats the exact saved review, expiry, all reviewed inventory counts and owner prerequisites in its committing transaction. Counts share the operator inventory expressions. One JSON parameter avoids a large parameter list, and a balanced conjunction fits local D1's depth-100 expression limit. Separate requests adding a project or photo immediately before the actual batch are refused with `stale_review`; neither closure nor journal commits.
- Ordinary external transport, R2 and service bindings check identity and account closure together in one final database read at dispatch. Revocation or closure refuses the effect. The explicit lifecycle scope preserves status/export and existing credential revocation while closure waits. SQL writes continue using the atomic admission assertion; an external request itself cannot share that transaction.
- Composed visitor collection photos reserve the account's monthly photo allowance before shared storage reservation and R2 access. An exhausted allowance yields an incomplete stream, no completion manifest, no shared read and no object read. A nonexhausted fixture consumes exactly one account reservation per actual collection object read.
- The current schema retains native handoffs and connector consent alongside the lifecycle input: nine schema sources, 233 tables, 57 current and five planned lifecycle classes at this integration base. The closure inventory includes both; native handoffs retain the identity metadata exclusion from exact owner review. Their expiry/sign-out deletion sites are explicitly excluded from content-preservation holds, so a hold never extends executable identity authority.
- Native build 4 adds the fixed `409 account_closing` response with `next:"browser"` and `browserPath:"/workspace/account"`. Ordinary workspace reads/writes refuse, including bootstrap, while current session read, reauthentication and logout remain available. The floor cannot be lowered by configuration. The paired Android client must clear private workspace state and pending work and open the fixed page using independent browser identity; the bearer never enters a browser URL. See [current mobile contract](mobile-api-v1.md).

## Verification

All fixtures are synthetic and credential-free. `node tests/account-lifecycle.mjs` and `--d1` pass 13 groups through actual Worker routes, including the new commit-boundary mutations, post-freeze zero-effect checks, identity revocation at combined dispatch admission and visitor-only collection export quotas. The tests also exercise closure replay, interrupted steps, provider/operation waits, preservation holds, surviving receipts, actual scheduled continuation and tenant separation.

Additional local checks passed:

- TypeScript checks and the frontend build. The build reports the existing large-chunk and ineffective dynamic-import warnings.
- Account lifecycle client (12 checks), policy consent (32), artifact admission (8), abuse reports (110), safety appeals (101), and restore suppression (three groups, including an isolated older SQLite backup).
- Shared files (15 groups), records (18), registry (14), safety cases (261 checks), safety case operations (152, including all 114 classified deletion sites), and operator safety review (20).
- Current-schema initialization on SQLite and local D1, lifecycle catalog, maintenance inventory, release manifest, isolated restore admission, and secret custody.
- Native identity (66 assertions on SQLite and local D1); native workspace (16 HTTP journeys on SQLite and local D1); current mobile contract (76 offline checks). The native workspace fixture specifically proves closure refusal, the fixed browser destination, no Chat write, and continued identity read/reauthentication/logout.
- Roadmap validation/render consistency and whitespace checks.

Independent review and combined-branch release checks remain separate from these author-run results. New account/safety test registration is coordinated centrally with the release gate owner.

## Remaining acceptance boundaries

This does not complete WH-018 or WH-019 acceptance. The [account closure document](account-closure.md) still records independent restore-suppression custody as incomplete, unresolved provider resources and retained receipts as blockers, and browser acceptance as outstanding. No actual provider cancellation, R2 deletion acceptance, whole-system disaster recovery or live closure is claimed. The ledger alone cannot prove suppression after losing the current database. Native build-4 source must be paired with the Android amendment before release; signing association and physical-device acceptance remain external.
