# Current identity authority foundation

**WH-114A / [#70](https://github.com/zemdregon/whumpo/issues/70), October 1, 2026. Source implementation in isolation; not activated or deployed.** Parent [WH-114 #68](https://github.com/zemdregon/whumpo/issues/68) and [WH-115 #69](https://github.com/zemdregon/whumpo/issues/69) remain open. This implements the shared authority part of the [accepted identity protocol](workspace-identity.md), without a password reader, old-session adapter or parallel runtime policy.

## Implemented contract

[schema.sql](../src/workspace-identity/schema.sql) defines the five authority tables below; [verified ceremonies](identity-ceremonies.md) now extend it with challenge/receipt tables and a current-key candidate view; [shared kits and enrollment completion](identity-kits.md) add current offers and terminal effect receipts. It sits outside `migrations/` until enrollment and recovery are complete and the reviewed test reset is ready. Its owner reference is canonical `users(id)`. It does not inspect password fields or existing session, passkey or recovery-code tables. Merely applying this SQL is not an authentication cutover.

| Records | Current invariant |
| --- | --- |
| Account identity | Exact policy version 1; enrolling/ready/recovering stage; monotonic authority epoch, credential revision and kit generation. A ready account has completion/kit metadata. Entering recovery from ready fences old authority by advancing the epoch. Kit replacement advances generation and, after the first kit, the epoch. |
| Enrollment/recovery attempts | One open or secured attempt per account; owned purpose, epoch, kit generation and semantic revision. Terminal attempts cannot reopen. Changing purpose state or kit/epoch requires a newer revision. |
| Credentials | Globally unique IDs and immutable owner/public key/attempt binding; staged or active; ten total per account. Add/delete/activation increments account and active-attempt revisions. Counter/last-use/name bookkeeping does not invalidate a semantic review. |
| Sessions | Separate random-token hashes, current policy/epoch, web client, active authenticating credential and actual passkey proof time. Expiry is at most seven days from proof; updates cannot refresh proof or extend expiry. Ten sessions per account, always retaining the newly inserted session when timestamps tie. |
| Restricted grants | Separate hashes, exact purpose/account/attempt/epoch, registration/passkey/recovery-key/guarded-recovery-commit provenance and thirty-minute maximum lifetime from proof. Recovery-key grants bind the current kit generation. Twenty retained grants per account and 20,000 globally; issuing/maintenance code must delete expired rows before reaching this ceiling. Grants cannot be updated or promoted into sessions. |

Registration proof permits enrollment continuation only. It is not a fresh assertion. Recovery-key proof permits recovery only. The [guarded recovery commit](identity-recovery.md) can derive a continuation grant bound to its new generation and original proof time/expiry; that provenance supplies neither fresh assertion proof nor workspace authority. A current passkey can resume its staged attempt or, in recovery, a retained active key can continue the current recovery. Before **Secure my account**, a valid recovery-key presentation leaves ordinary sessions usable. Secured recovery admits only the current restricted attempt; ordinary sessions fail the stage/epoch check. Emergency zero-key recovery can open a review with the current kit even without a secured attempt yet.

The SQL view resolves all current bindings and expiry against database time. [authority.ts](../src/workspace-identity/authority.ts) requires an exact version/client/kind/token input. It looks up only the selected session or grant kind. Unsupported clients/kinds, missing metadata, stale epochs and expired/revoked proof cannot try another policy or credential path.

The resulting frozen principal contains account/authority identity, purpose, version, epoch, client, stage, revisions, proof provenance/time and expiry. Plaintext tokens and their hashes are excluded. A module-private weak map binds each principal to the resolving database connection; copying its public fields or deserializing JSON cannot manufacture usable authority. A later transport or job must resolve current server-held authority through the shared module, not trust a saved principal snapshot.

## Reads and committing effects

`assertCurrentIdentity` rechecks protected reads and checks immediately around provider transport. `identityPredicate` supplies the same current-authority SQL and parameters to compose into the effect itself. The server-owned action policy chooses the exact purpose, whether an actual passkey assertion within ten minutes is required, and whether the admitted credential/attempt revision must still match. A restricted assertion also remains bound to its original attempt revision; resolving it again after a semantic change does not make that old assertion fresh for the new state.

The predicate proves identity only. Callers must also check current resource ownership, role when implemented, feature inclusion, exact action review and required receipt/kit/challenge bindings. In particular, the fresh-passkey predicate alone does **not** prove recovery completion: that still needs a newly enrolled replacement assertion after the saved-kit step and the exact completion challenge/receipt.

Use the predicate in a conditional write, check the affected row or read the uniquely claimed effect receipt, and gate all dependent writes on that claim. A zero-row conditional write does not automatically abort a batch. Do not assert identity once and then run unconditional effects. Where a successful effect advances its own revision/epoch, subsequent statements must follow the unique winning receipt instead of reusing a now-stale admission predicate. [D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/) run sequentially and roll back on statement failure; local SQL and a remote provider effect are not one distributed transaction.

This foundation has no authority issuance API that accepts `verified: true`. [WH-114B #71](https://github.com/zemdregon/whumpo/issues/71) now implements [cryptographic ceremonies](identity-ceremonies.md), one-use challenges, invitation consumption and guarded session/grant issuance using the maintained verifier. Kit-bound completion and connected acceptance remain open. Authority-test fixture inserts remain synthetic database state; ceremony tests separately exercise real signature verification. Neither proves physical-device acceptance or complete enrollment.

## Lifecycle handoff

The five tables are not in the active schema inventory yet. The current 149-table/32-class platform inventory and its deployed state are unchanged by this isolated foundation. Register the complete identity schema in lifecycle classification/export/deletion and maintenance at [WH-114C #72](https://github.com/zemdregon/whumpo/issues/72), before activation.

| Data | Prospective lifecycle requirement |
| --- | --- |
| Accounts and verified attempts | Account owned; retain pending verified progress until authenticated cancellation or account lifecycle deletion. Terminal attempts with credential provenance are not disposable operation receipts. Do not delete an attempt still referenced by a credential. |
| Credentials | Account owned; preserve public verification keys/counters and provenance for current authentication. Secret private keys are never received. Removal deletes bound sessions/grants; full emergency removal also fences all other authority in the guarded engine. |
| Sessions/grants | Hashed admission secrets; never export hashes or proof bodies in user exports/logs/telemetry. Expiry removes authority immediately. Add bounded expiry cleanup and current-session inventory with non-secret presentation metadata. |
| Kit verifier | Authentication secret verifier, not downloadable kit content. Current offers/acknowledgments/rotation receipts are implemented in the shared kit module. No plaintext reread or browser persistence. |
| All five tables | Canonical user deletion cascades owned records, including staged keys. Restore/forward repair must preserve revocation and epoch truth. Later operation receipts are non-secret, retained seven days, and cannot recreate a session. |

There is no account reset, secret transformation, physical-device ceremony, deployment, provider activation or live release in this packet. Verified ceremonies now add non-secret ceremony receipts and bounded admission cleanup. The later shared kit/recovery modules and [HTTP/browser flow](identity-web.md) now implement and verify signup completion, reviewed loss selection, prepared/saved kits, securing recovery, completion receipts, cancellation and logout in isolation. Common platform admission, lifecycle integration and the coordinated current-only cutover remain WH-114C work.

## Verification

Run `node tests/identity-authority.mjs` or `node tests/identity-authority.mjs --d1`. Both use the actual isolated schema and shared resolver/predicate against disposable databases. The D1 variant applies only a minimal canonical user fixture plus this schema to a temporary local database; it neither applies platform migrations remotely nor touches owner credentials.

The suite covers current ordinary and restricted access, wrong purposes/kinds/versions, forged/deserialized principals, future/expired proof, exact freshness boundaries, credential/attempt ownership, current versus retired kit proof, staged/retained keys, revision changes versus counter bookkeeping, revocation between admission and commit, transactional rollback, immutable provenance, account/credential/session/grant bounds and account deletion. Physical passkey, complete signup/recovery, deployed HTTP/Chat/provider principal composition and owner-device acceptance remain separate gates.

### Local results, October 1, 2026

- All 72 refusal/committing checks plus positive, enrollment/recovery, quota, deletion and rollback journeys passed on SQLite and local D1.
- Type checks, the application build, roadmap validation/alignment/render verification and whitespace checks passed.
- The tests use synthetic database authority records. No remote database, real passkey, deployed handler or customer operation was exercised.
