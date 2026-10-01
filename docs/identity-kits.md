# Saved recovery kits and enrollment completion

**WH-114B [#71](https://github.com/zemdregon/whumpo/issues/71) and WH-115 [#69](https://github.com/zemdregon/whumpo/issues/69), October 1, 2026. Implemented and verified in isolated source; not deployed or connected to HTTP/UI.** This completes #71's backend enrollment path and implements the shared kit preparation, acknowledgment and ordinary rotation part of #69. The [restricted recovery backend](identity-recovery.md) now extends this source; browser delivery and the coordinated current-only test cutover remain open.

## Current implementation

[kits.ts](../src/workspace-identity/kits.ts) extends the existing [authority](identity-authority.md) and [verified ceremonies](identity-ceremonies.md). All operations use that module's current principal and committing predicate. [protocol.ts](../src/workspace-identity/protocol.ts) supplies exact current request shapes, POST/Origin checks and sanitized errors for both modules. There is no old credential reader, alternate session issuer or password conversion path.

| Operation | Required state and effect |
| --- | --- |
| Read kit state | Current matching authority reads its active generation and current offer's public metadata. No key or verifier is returned. |
| Prepare | Generate a random 256-bit key and store only its hash in a thirty-minute offer. Replace any uncommitted offer. Restricted preparation advances the attempt's semantic revision, invalidating earlier completion proofs. An ordinary session and replacement of a secured saved recovery kit require fresh passkey proof. A pending revised loss review uses its restricted recovery authority. A pre-secure recovery grant, including emergency zero-key recovery, can prepare with current kit proof. |
| Save acknowledgment | Record the first acknowledgment of the exact current offer/generation under its purpose, epoch and semantic review. This is the single user confirmation that the kit was saved, not evidence of durable storage. The browser adapter must reuse this acknowledgment for completion/commit. |
| Ordinary rotation | A current fresh workspace session commits the exact saved offer. Rotate the verifier/generation, advance the authority epoch, cancel competing attempts and delete old grants/challenges/other sessions. Keep the initiating session only with its original proof time, issued time and expiry, updated to the new epoch. |
| Finish enrollment | Require two distinct current staged keys, the exact saved offer and a fresh assertion bound to the unchanged attempt. Atomically complete the attempt, activate keys/kit, mark the account ready, consume all grants/challenges and issue one ordinary session. Creates no project and calls no model/provider. |
| Cancel pending enrollment | An exact current enrollment grant and explicit cancellation delete the pending user, eligibility and identity records. The invitation remains spent. A new invitation can start a different identity; email and receipts cannot restore the deleted one. |

Preparation leaves the active verifier/generation unchanged. An expired offer, credential-set change, changed attempt, changed epoch, wrong account/purpose, missing acknowledgment or stale proof prevents commit. Counter/challenge bookkeeping and a matching reauthentication do not invalidate the saved offer. Losing or superseded preparations require an explicit new preparation if the plaintext response was lost.

The initial kit activates only with successful enrollment completion. Ordinary replacement activates only at its guarded rotation commit. The [recovery secure and replacement-completion operations](identity-recovery.md) now reuse these records. In particular, general fresh proof is **not** a substitute for the required new replacement-key assertion after saving the recovery kit.

## One-time document and receipts

[kit-document.ts](../src/workspace-identity/kit-document.ts) formats the successful preparation response as text with the constant filename `whumpo-recovery-kit.txt`. It includes Whumpo, the account label, generation/offer ID/date, the key, the manually entered workspace address and instructions for independent storage and account recovery. It does not promise recovery of separate content encryption keys. This is document content, not a shipped download/copy/print UI.

Plaintext is returned only to the winning prepare call and is never reconstructed. Repeating the same request returns a non-secret receipt with null document/key/offer fields. Client delivery must keep plaintext in transient memory, clear it on exit, revoke download object URLs and keep it out of persistent app storage, URLs, filenames, logs, Chat, telemetry and screenshots. Use synthetic values for browser/print acceptance.

Effect IDs are globally distinct across ceremony and kit/completion receipts. Same ID plus changed intent returns `409 request_conflict`. Reading a receipt requires current matching authority; the ID alone authenticates nothing. After ordinary rotation, resolve the retained session again at its new epoch to read the committed result. After lost enrollment completion, a passkey login reaches the completed account and can read its receipt; repeating completion returns no authority token. Cancellation consumes all access, so its former grant cannot read or revive the deleted account.

Each transaction first claims a unique receipt and execution nonce under the current-authority predicate. Every subsequent write is fenced by that nonce in the same [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/). The committing predicates check database-time expiry/freshness, account epoch, exact semantic revision and current saved offer. Failure rolls back the whole batch. A losing request cannot rotate another kit, repeat cleanup or mint a session. `RETURNING` measures the top-level effect, avoiding D1 trigger change-count ambiguity.

## Storage and lifecycle

The isolated [schema](../src/workspace-identity/schema.sql) adds:

- `identity_kit_offers`: at most one offer per account, immutable purpose/owner/review/verifier/deadline, with a single immutable save timestamp. The current-offer view rejects expired or stale state immediately.
- `identity_effect_receipts`: immutable kind, intent hash and non-secret result IDs, with a 50,000-row bound. Deleting an account clears its owner reference; these anonymous terminal receipts cannot authenticate. Cleanup removes receipts older than seven days, at most 500 per call.

The shared bounded cleanup also removes at most 500 expired offers per call. It never deletes pending verified keys or enrollment progress for age. Full platform lifecycle inventory, endpoint rate limits and scheduled cleanup wiring belong to #72; these isolated files remain outside automatic migrations until the current-only reset/cutover.

## Verification and remaining acceptance

`node tests/identity-kits.mjs` and `node tests/identity-kits.mjs --d1` run the real shared modules, actual schema and independent ES256 WebAuthn fixtures against SQLite and disposable local D1. Successful ready identities are established through actual registration, second-key addition, preparation/save, signed reauthentication and guarded completion; readiness is not backfilled. Turnstile uses a synthetic verification response.

Both runs passed **47 refusal/race checks**, plus positive enrollment, one-time preparation/readback, save, completion, normal login after a lost reply, rotation, cancellation and bounded maintenance journeys. Cases cover wrong versions/origins/purposes/accounts/IDs/generations, forged principals, unchanged request replay, changed intent, duplicate prepare/save, missing acknowledgment, one-key signup, stale proof/review, expired offers, revocation between admission and commit, two competing completions/rotations, failed cleanup rollback, original session lifetime, spent invitations and seven-day receipt cleanup. Pre-secure recovery admission is explicitly seeded only to verify shared offer behavior; it is not recovery implementation or acceptance.

The existing **62** ceremony and **72** authority refusal/race suites also passed against SQLite and local D1. Type checks, application build, roadmap validation/alignment/render checks and whitespace checks passed.

#69 now has the [restricted recovery backend](identity-recovery.md), including kit proof/review/secure, restricted kit replacement, replacement-bound completion and emergency key removal. Kit download/copy/print UI remains open. #72 owns the HTTP/client adapters, central admission, lifecycle registration and removal of superseded authentication during one coordinated test reset. No remote schema, active route, real owner credential, physical device or deployment changed here.
