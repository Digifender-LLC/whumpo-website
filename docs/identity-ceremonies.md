# Verified passkey ceremonies and pending enrollment

**WH-114B / [#71](https://github.com/zemdregon/whumpo/issues/71), October 1, 2026. Current source deployed to the private test platform October 2, 2026.** This extends the [current authority foundation](identity-authority.md). The [shared kit and completion implementation](identity-kits.md) now completes its backend enrollment/cancellation scope with connected disposable database checks. Parent [#68](https://github.com/zemdregon/whumpo/issues/68), recovery [#69](https://github.com/zemdregon/whumpo/issues/69) remain open for their parent acceptance; [#72](https://github.com/zemdregon/whumpo/issues/72) records the deployed integration.

[Final release and retirement evidence](identity-web.md#deployed-current-identity-and-retirement--october-2-2026) records exact live verification. Earlier dated/local evidence below does not establish physical-device or human recovery acceptance.

## Implemented behavior

[ceremonies.ts](../src/workspace-identity/ceremonies.ts) uses the installed maintained [SimpleWebAuthn server](https://simplewebauthn.dev/docs/packages/server) verifier for registration and actual signed assertions. There is no injectable `verified` result or password route. The only deployed RP/origin pair is `whumpo.com` / `https://whumpo.com`; the explicit local configuration uses `localhost` / `http://localhost:8787`. Unknown environments reject instead of choosing an origin. Requests require POST and the configured URL/Origin.

| Flow | Effect |
| --- | --- |
| First registration options | Validate current US declaration, email, unused unexpired invitation and bounded server-side Turnstile response before issuing options. Options consume no invitation or user quota. Local configuration follows these same gates. |
| First verified registration | One transaction creates the pending canonical user, records eligibility, spends the invitation, creates the account/attempt/staged key and returns only a restricted enrollment grant. Duplicate email/key, quota failure or any later statement failure rolls the whole transaction back. |
| Ordinary passkey assertion | Verify the current key, signature, challenge, RP/origin, user verification, account handle and counter. Ready accounts receive sessions; pending enrollment resumes its own attempt; secured recovery resumes its own restricted attempt. Missing or obsolete identity metadata never uses another reader. |
| Add a passkey | An exact current principal and reviewed semantic revision authorize registration. Ordinary sessions require fresh assertion proof. Enrollment grants add staged keys; recovery grants can add replacements only after the secure step. A ready workspace session adds an active key. The shared ten-key quota counts both statuses. |
| Reauthenticate | A new assertion refreshes proof within the existing purpose and replaces that authority in one transaction. An active key used with a pre-secure recovery grant still produces a recovery grant. This path does not elevate the grant into a workspace session. |
| Interrupted add response | Reusing the exact owned request ID and payload reads a non-secret effect receipt. Changed payload under that ID rejects. Readback issues no new token, prompt or credential write. |

Resident credentials and user verification are required at registration; algorithms are ES256 and RS256. Current credential IDs are excluded in the browser and remain globally unique in SQL. A cancelled prompt leaves earlier verified keys untouched. Two distinct IDs do not prove independent providers or physical devices. A synced copy of an existing ID cannot count twice.

Public username-less sign-in requires the stored account's matching user handle. Reauthentication already identifies the account through its current principal and allows an omitted/null handle; a provided handle must match, and the credential must belong to that account and the unchanged allowed set. This follows the identified-account rules in [WebAuthn assertion verification](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion). Cross-origin ceremonies are rejected, including assertions without a top-origin field. These rules do not relax signature or user-verification checks.

## Challenges, transactions and lost replies

Challenges bind the exact current protocol, web client, purpose, origin/RP and, when authenticated, authority ID/kind, account epoch, credential/attempt revision and request intent. They have independent random 256-bit browser tokens stored only as hashes, a five-minute deadline, and are deleted before verification. Wrong-kind, malformed, oversized, expired or invalid proofs consume the presented challenge. A different browser without its token cannot finish the ceremony. The committing SQL also checks the original deadline.

The SQL rechecks current authority and credential state after cryptographic work. A proof admitted before revocation, key deletion, a semantic change or another counter update cannot commit afterward. Unique ceremony receipts and execution nonces admit the subsequent counter/credential/authority effects in the same [D1 batch](https://developers.cloudflare.com/d1/worker-api/d1-database/). A losing batch cannot reuse a prior receipt's nonce. Failure rolls back all database effects; the already consumed challenge remains consumed, so a fresh proof is required.

Credential and session insertions use `RETURNING` to inspect the affected top-level row. D1's aggregate change count includes trigger effects; a credential insertion also changes identity revisions, and session insertion can prune an old session. Those extra changes must not cause a committed success to be reported as a failure. Session issuance retains ten sessions; reauthentication removes its old grant before inserting the replacement so it works at the twenty-grant ceiling without extending existing proofs.

After a lost first-registration response, the saved passkey authenticates into the same pending account. Email or invitation possession cannot resume it. A lost login/reauthentication response requires a fresh assertion; tokens are never reread from a receipt or reconstructed. Transport adapters must set returned authority tokens only in the correct secure HttpOnly cookie, and challenge tokens in their dedicated restricted cookie. They must not serialize these server return objects into browser JSON, logs or Chat.

## Target schema and lifecycle

[canonical-inputs.sql](../src/workspace-identity/canonical-inputs.sql) defines the target user/invitation/eligibility inputs for the reviewed test reset: users have no password columns, and eligibility records only passkey signup. An invitation's immutable `used_at` records spending independently of its optional owner reference. Deleting an owner clears that reference while leaving the invitation spent. No reader infers invitation availability from the nullable owner field.

The authority [schema](../src/workspace-identity/schema.sql) now also defines challenges, immutable ceremony receipts and a current-key candidate view. Challenges have a global 5,000-row ceiling and twenty per reserved/current account. Receipts have a 50,000-row ceiling and seven-day retention. Maintenance deletes at most 500 expired rows per admission table and 500 old receipts per call; it never ages out a pending account's verified credential or attempt. Expiry removes authority before physical cleanup.

Current test databases initialize the complete canonical schema; there is no automatic migration chain. Tests and the deployed platform use the same current identity inputs, authority schema and platform schema. Applying any one part over an occupied obsolete database is unsupported. The coordinated schema/handler/client/lifecycle/Worker reset is recorded in [deployment evidence](identity-web.md).

Challenge bindings temporarily contain normalized email, invitation verifier and account/credential references. They are restricted authentication data, not telemetry. Ceremony receipts retain only IDs, intent hashes and effect metadata; they contain no bearer token, private key, assertion body, Turnstile response or recovery key. Register these classes, invitation spending semantics, canonical user reset and bounded cleanup with the full lifecycle/cancellation work at #72.

## Remaining work

The shared [kit lifecycle and enrollment completion](identity-kits.md) implement two-key, saved-kit and fresh-assertion completion, terminal receipts and authenticated pending cancellation. [Restricted recovery](identity-recovery.md) and browser kit download/copy/print are connected and deployed, with local signed/browser evidence. Recovery requires a new replacement assertion after the kit-save step; a retained-key assertion or the general fresh-proof predicate is insufficient.

The [trusted identity bootstrap and HTTP adapter](identity-web.md) is mounted in the active platform route tree. Superseded routes are removed; current HTTP/Chat/provider admission, lifecycle registration and the test cutover are deployed. Human Turnstile, physical owner enrollment and complete live recovery usability remain separate from local fixtures and the bounded live login/onboarding probe.

## Verification

`node tests/identity-ceremonies.mjs` and `node tests/identity-ceremonies.mjs --d1` exercise the actual module and schema with independently generated ES256 keys, CBOR registration responses and signed assertions. The verifier is not mocked. Turnstile transport is synthetic and checks the configured hostname/action; no external account or live challenge is contacted.

Cases cover gate failures, wrong origin/RP/UV/signature/handle, cross-origin proof, replay, missing/oversized proof, lost-response resumption, second-key registration, receipt readback/conflicts, duplicate rollback, concurrent invitation/login, expiry, revocation after cryptographic admission, changed reviews, cross-account authority, all-or-nothing failed signup, account quota, session pruning, reauthentication at grant quota and spent invitations after deletion. Ready identity and recovery secure state are explicitly seeded only to test their ceremony admission; that is not evidence of recovery-secure implementation. The separate kit suite establishes ready identities through the actual complete signup path.

### Local results, October 1, 2026

- The 62 refusal/race checks plus positive cryptographic, quota, receipt, cleanup and recovery-purpose journeys passed on SQLite and local D1.
- The existing 72-check current-authority suite also passed on both database engines with the extended schema.
- Type checks, application build, roadmap validation/alignment/render verification and whitespace checks passed.
- The D1 run exposed aggregate trigger-change counts; inserts now verify the returned row. The SQLite fixture now executes each batch without yielding between statements, matching D1 transaction isolation for concurrent ceremony tests.

These ceremony-only results use real signatures with synthetic authenticators. They do not prove physical devices or human Turnstile. Complete signup/rotation and recovery have separate kit/recovery suites; current deployment and bounded live login/onboarding evidence are recorded in [identity integration](identity-web.md).