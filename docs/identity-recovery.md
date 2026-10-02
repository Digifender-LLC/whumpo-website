# Restricted recovery and emergency passkey removal

**WH-115 [#69](https://github.com/zemdregon/whumpo/issues/69), October 1, 2026. Backend source and the [current HTTP/browser flow](identity-web.md) are implemented, verified locally and deployed to the private test platform October 2, 2026.** This extends the shared [authority](identity-authority.md), [ceremonies](identity-ceremonies.md) and [saved kits](identity-kits.md). Common platform admission/lifecycle and the current-only test cutover are deployed. Real owner/device and native acceptance remain separate.

[Final release and retirement evidence](identity-web.md#deployed-current-identity-and-retirement--october-2-2026) records exact live verification. Earlier dated/local evidence below does not establish physical-device or human recovery acceptance.

## Entry and loss review

[recovery.ts](../src/workspace-identity/recovery.ts) accepts the exact current version, account email and a current 256-bit kit key under the configured POST/Origin boundary. Key hashes are compared with the Workers [constant-time Web Crypto operation](https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#timingsafeequal); unknown accounts and bad/retired keys receive generic proof errors. The committing SQL checks the actual current verifier, epoch, generation and identity state again. Email alone never authenticates.

A successful entry creates or resumes the one current recovery attempt and issues a restricted thirty-minute grant. Before securing, ordinary sessions and ordinary passkey sign-in continue. Re-presenting the kit does not replace the attempt, erase its review or staged keys, or rotate another kit. After securing, the already saved replacement kit resumes the same attempt. Retained or staged passkeys also resume that restricted attempt through the shared ceremony verifier.

A current recovery principal reads only its own identity inventory and review metadata. The server binds the explicit all/some/none selection to the current credential-set and attempt revisions:

- **All:** every current active credential is explicitly selected; zero active credentials is valid.
- **Some:** at least one owned active credential is selected and at least one is retained.
- **None:** no lost IDs and at least one current active credential; this still requires a replacement key before recovery finishes.

The server computes the retained set. Duplicate, foreign, unknown, contradictory or stale IDs reject. Reviewing a changed loss set advances the attempt revision and invalidates outstanding offers/completion challenges through their bindings. Changing a secured review preserves existing staged replacements but requires a newly saved kit and another exact securing commit. It never silently widens an earlier request.

## Secure the account

The guarded secure transaction requires the exact reviewed inventory, current principal/epoch/revision and current saved replacement offer. It atomically:

1. Claims the unique operation receipt/execution nonce.
2. Revokes existing sessions, grants and challenges.
3. Removes exactly the reviewed lost active credential IDs.
4. Activates the saved replacement kit, advances the account epoch and sets the account/current attempt to restricted recovery.
5. Persists the review's saved generation/time and a new restricted continuation grant, then consumes the offer.

A cleanup failure rolls back every database effect. A stale/losing request cannot retire a later kit, remove later replacements, repeat revocation or issue another grant. Current-kit proof admitted before a competing rotation cannot commit afterward.

The continuation grant records `recovery-commit` provenance. It is derived from the guarded securing effect, retains the original proof time and absolute restricted expiry, and is bound to the new kit generation. It does not claim that a new passkey assertion occurred and never satisfies fresh-passkey or workspace admission. Presenting the current saved kit or signing with an eligible retained/staged key later supplies a new actual proof.

Lost replies are recovered by presenting the saved new kit or a surviving passkey and reading current state/non-secret receipts. Retired kit proof fails. Replaying an owned operation after obtaining current authority returns its result without recreating the continuation token. Tokens are returned only to the [trusted transport adapter](identity-web.md) for secure HttpOnly cookie handling.

## Complete with a replacement assertion

`recoveryCompletionOptions` checks the current saved generation and reviewed retained set, then offers only staged keys enrolled in this attempt. All-loss needs two distinct new credentials; some/none needs at least one new replacement plus at least one retained reviewed credential. The ten-key quota includes both active and staged keys. At capacity, users explicitly revise a removal before adding a replacement; the server never chooses a key to discard.

The completion challenge is a separate, single-use five-minute ceremony created after the saved-kit step. It binds the exact account, authority, epoch, credential/attempt revision and completion intent. `recoveryCompletionVerify` uses the same maintained WebAuthn signature/RP/origin/UV/handle/counter verifier as ordinary ceremonies, then requires a staged key belonging to this attempt. A retained-key assertion, registration response, generic reauthentication, kit key or receipt cannot substitute for this completion assertion.

The final [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/) rechecks current authority, saved kit/review, replacement status, public key/counter, freshness and challenge deadline. It records the effect, advances the counter, completes the attempt, activates staged credentials, consumes outstanding grants/challenges/offers and issues one ordinary session based on the actual new assertion time. Losing completions get no session. If the response is lost, a replacement passkey signs into the completed account; receipt readback issues no additional session. Identity completion creates no project and invokes no AI or provider.

## Replacing a lost copy and removing compromised keys

Shared `rotateKit` now also admits a secured recovery grant with fresh retained/replacement passkey proof. Preparing/saving/committing a new kit preserves staged progress, rotates the verifier/epoch, fences old authority and issues a replacement restricted grant with the original proof/expiry. The unchanged ordinary-rotation path retains only its initiating session with its original lifetime. A pending revised loss review uses the explicit secure transaction instead of this rotation operation.

`removePasskey` requires fresh passkey proof and the exact owned credential/revision, with explicit confirmation. It can remove the authenticating credential and reduce the key count below two. Every removal revokes all outstanding sessions/grants/challenges/offers and advances the epoch:

- A ready account with another key remains ready; ordinary passkey sign-in works with that key.
- A ready account with no key enters recovery with its existing kit intact; the current kit starts the zero-key all-loss flow.
- A secured recovery account stays restricted. Removal can target a retained or staged key, preserves other verified replacements/current kit, and invalidates the old review. The owner proves access again and explicitly reviews/secures a new saved kit before completing. A compromised staged key is never activated just to get access to removal controls.

No support/email/password path restores access. An owner without a usable key or current kit cannot use these operations. The account kit does not recover separate encrypted-content keys or revoke third-party grants; connected-access response remains separate incident work.

## Shared storage and release boundary

The isolated [schema](../src/workspace-identity/schema.sql) adds one owned recovery-review row per attempt, immutable reviewed ID snapshots and saved-kit metadata, plus a current completion-readiness view. The same current grants, credentials, challenges, kit offers and effect receipts serve enrollment and recovery. Kit state is read in one guarded database snapshot, so a concurrent rotation cannot mix its generation and offer metadata. [effects.ts](../src/workspace-identity/effects.ts) shares exact intent/readback/receipt fencing; `ceremonies.ts` shares challenge handling and cryptographic verification. There is no old-policy reader, password conversion or second session system.

Bounded cleanup removes expired admission/offers and seven-day terminal receipts while retaining verified pending/recovery progress until an explicit lifecycle action. Inventory classification, scheduled maintenance, common admission, body/rate limits, private HTTP cookies and trusted browser entry are connected in the deployed [current web integration](identity-web.md). This uses the complete current schema; there is no automatic migration chain.

## Verification

`node tests/identity-recovery.mjs` and `node tests/identity-recovery.mjs --d1` exercise actual source and schema with independent ES256 registrations/assertions. Ready accounts are established through real signup, two-key enrollment, kit saving and completion; recovery states are not backfilled. Turnstile transport is synthetic. The Node test harness supplies Workers' constant-time comparison extension using Node's native primitive; this is test infrastructure, not a production compatibility path.

Both SQLite and disposable local D1 passed **64 refusal/race checks** plus successful all/some/none recovery, response-loss resumption, revised loss selection with saved replacements, ten-key capacity, restricted kit replacement, compromised staged-key removal and zero-key recovery. Checks include wrong proof/version/origin/account, stale review/kit, missing save, retained-key refusal, consumed/wrong-purpose challenge, cross-account proof, competing secure/completion/ordinary rotation, failed cleanup rollback, changed counters, old authority revocation, unchanged grant lifetime and non-minting receipt readback.

The existing **47** kit, **62** ceremony and **72** authority suites passed on SQLite and local D1 with the shared changes. Type checks, build, roadmap validation/alignment/render checks and whitespace checks passed. No active HTTP handler, browser/device, real Turnstile/owner credential, remote schema, provider or deployed recovery path was exercised.
