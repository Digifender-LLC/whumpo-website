# Shared workspace identity contract

**WH-113 decision, amended for current-only test cutovers October 1, 2026. Source reviewed: `d4153985b7350d0a3f3e96e7fa01cb77486ea3e0`. Protocol decision; runtime activation remains pending.** [Issue #42](https://github.com/zemdregon/whumpo/issues/42) owns execution evidence. WH-114/115 implement this contract; WH-005 supplies web/device acceptance and WH-083/087 native implementation/acceptance.

The isolated [authority foundation](identity-authority.md) now implements the current principal/schema/committing guard under #70. The [ceremony source implementation](identity-ceremonies.md) now adds verified signup, restricted resumption, current login and reauthentication under #71. The [kit lifecycle implementation](identity-kits.md) now completes #71 backend enrollment/cancellation and adds ordinary saved-kit replacement. The [restricted recovery backend](identity-recovery.md) now implements exact loss review/secure, replacement-bound completion, restricted kit rotation and emergency removal. Connected UI and the coordinated test cutover remain open under #68/#69/#72; current authentication is not switched by these isolated modules.

This specifies the accepted [identity policy](roadmap/identity-and-data-protection.md) for owners and future workspace members. Web, Android, feature entitlements and Chat consume the same server authority. Application visitors retain [their separate identity](app-data.md); customer origins never gain workspace authority. Account recovery does not recover future client-encrypted content keys.

## Source inventory and changes required

| Current source | Implemented behavior | Required change |
| --- | --- | --- |
| [passkeys.ts](../src/passkeys.ts), [0004](../migrations/0004_passkeys.sql) | Five-minute, one-use challenges; required user verification; origin/RP checks; unique credential IDs; ten-key cap. First signup credential creates the user and consumes the invitation. | Preserve verification and quota protections; bind challenges to purpose, attempt, client and revision. First credential creates **restricted enrollment**, not workspace authority. |
| [index.ts](../src/index.ts): `issueSession`, `currentUser`, `recentSession` | Seven-day sessions; ten-minute freshness based on session creation. Login rechecks verified credential existence; credential mutations recheck the committing session. | Separate restricted grants from sessions; carry actual authentication provenance/time and account epoch. Check identity completion centrally and at committing mutations. |
| `recoverAccount` and `/api/auth/recover` | Reviewed all/some/none removal, deterministic saved replacement code, atomic rotation/session revocation; then an ordinary session. Unique receipt protects against a losing concurrent recovery. | Preserve transactional fencing; recovery proof grants restricted enrollment. Complete with replacement passkeys and a fresh replacement assertion. |
| `/api/auth/register`, `/api/auth/login`, `/api/profile/password` | Password signup/login/add/change remain available. | Remove in the current-policy test cutover below, including backend routes and stale-client admission. |
| `/api/auth/passkeys/remove`, `/api/auth/recovery-code` | Last key cannot be removed without another key or password. Ordinary recovery-code replacement commits before displaying the new code. | Permit reviewed emergency removal below two; add prepare/save/commit to ordinary kit rotation. |
| [auth.tsx](../frontend/src/auth.tsx), [workspace.tsx](../frontend/src/workspace.tsx), [workspace-controls.tsx](../frontend/src/workspace-controls.tsx), [workspace-pages.tsx](../frontend/src/workspace-pages.tsx) | Password alternatives, one-key signup, display/acknowledgment dialog. `/profile` bootstraps the workspace; the welcome gate follows authentication. | Bootstrap from a minimal identity-state endpoint before querying profile. Restricted journeys use trusted deterministic UI, with download/copy/print and no password alternatives after activation. |
| [onboarding](onboarding.md), [Android](android-app.md) | First-project welcome gate is implemented; native bearer/handoff APIs are planned. | Identity completion precedes profile/welcome. Native exchange cannot elevate incomplete identity or replace the welcome gate. |

Existing [recovery concurrency](../tests/owner-recovery-concurrency.mjs), [credential authority](../tests/owner-credential-authority.mjs) and [WebAuthn HTTP](../tests/owner-passkeys-http.mjs) regressions are implementation baselines. Their prior passing results do not verify this new protocol. Preserve the A1 rule: a request admitted before revocation cannot commit a credential change afterward.

## Authority and persistent state

Use one domain resolver with distinct results, not a Boolean `signedIn`. Restricted grants live separately from ordinary sessions, have random 256-bit secrets stored only as hashes, and never pass `currentUser`/workspace-session admission. Browser grants use a separate HttpOnly, Secure, SameSite=Strict cookie scoped to `/api/auth/identity/`; deployment remains HTTPS. Localhost retains an explicit local configuration, never a deployed exemption.

| Authority | Allowed | Denied |
| --- | --- | --- |
| Anonymous | Public help/config, invitation/eligibility verification, passkey authentication and recovery entry | Account inventory before proof; authenticated data/actions |
| Enrollment grant | Own identity progress, passkey ceremonies, recovery-kit preparation/save acknowledgment, cancel/sign-out/help | Profile, welcome answers, projects, Chat/history, files, billing, providers, exports and ordinary native exchange |
| Recovery grant | Own reviewed credential inventory, current recovery attempt, replacement enrollment, kit save and completion | All workspace data/actions; normal session issuance from recovery-key proof alone |
| Ordinary session | Existing owned routes and role/feature checks; welcome gate still applies | Other accounts; restricted-flow bypass; consequential effects without their existing reviews |

All authenticated transport adapters produce a common principal containing account ID, session/grant ID, purpose, identity-policy version, account authority epoch, proof method/time and credential/attempt binding. A role, subscription, browser cookie, recovery receipt, interaction answer or model statement cannot substitute for that principal. Future membership adds current workspace role/revision checks; it does not create different authentication. Removing a membership revokes that workspace's authority independently of the member's personal identity.

Current schema requirements (names may follow repository conventions at implementation):

- **Account identity:** `stage` (`enrolling`, `ready`, `recovering`), monotonic `authEpoch` and credential-set revision, accepted policy version, completion receipt and current kit generation. Missing/unknown metadata never grants new-policy authority.
- **Enrollment/recovery attempt:** account, purpose, revision, expected epoch/kit generation, reviewed exact old credential IDs, staged credential IDs, prepared kit verifier/generation and acknowledgment, proof receipts, status and expiry. Only one current recovery attempt per account; a merely presented recovery key does not replace it.
- **Credentials:** existing unique IDs/public keys/counters plus status and attempt ownership. Staged credentials authenticate only their own restricted continuation until completion. A credential never transfers accounts or counts twice; deleted credentials cannot be restored by a delayed response.
- **Sessions:** account epoch, policy version, authenticating credential and actual passkey verification time. Renewal, handoff or recovery-code checks do not refresh that time. Preserve seven-day absolute expiry and the existing bounded session count; no indefinite silent refresh.
- **Challenges/grants/receipts:** exact purpose/client/account/attempt/revision binding, deadline and one-time effect identity. Receipts contain status and non-secret effect identifiers, not recovery keys, assertions, tokens or provider/customer data.

Use five-minute WebAuthn challenges, thirty-minute absolute restricted grants, and ten-minute passkey freshness for sensitive operations. An expired grant requires proof again; it does not erase verified enrollment. A prepared kit offer expires after thirty minutes or a change to its bound attempt revision/epoch. Challenge/counter bookkeeping alone does not change that semantic revision; changing the credential set, loss selection or prepared kit does. A browser/native handoff lasts five minutes and its one-time exchange code sixty seconds; exchange must still check current authority. These are versioned application policy choices, not provider guarantees.

Persist verified identity progress until authenticated cancellation or the separately implemented account lifecycle policy deletes it. Do not silently expire a pending account's only credential. Pending users count toward account quotas; active plus staged credentials count toward the ten-key quota. Expired grants/challenges and unused kit offers lose authority immediately and are removed by bounded maintenance. Keep non-secret terminal operation receipts for seven days for readback, then remove them; short-lived admission secrets retain their original expiry. Register these rows with the existing lifecycle inventory in WH-114/115; WH-116 classifies them and backup/restore must preserve epoch/revocation truth.

## Signup and resumption

1. Verify the invitation, current US eligibility acknowledgment and Turnstile before offering the first registration. An options request consumes no invitation or account quota. The challenge expires in five minutes and binds the normalized email, eligibility decision and invite verifier.
2. On the first verified registration, atomically create the pending account/identity, save the credential, consume that still-valid unused invitation and record progress. A uniqueness/quota/invitation failure rolls the entire change back. Return an enrollment grant only. Email/invitation knowledge cannot resume the account or release its invitation.
3. Offer the second registration with existing credential IDs excluded and server-side global uniqueness checks. Cancellation, duplicate/unsupported prompts and lost replies retain the first credential. An expired cookie or another device can resume by asserting an already registered credential; login on an `enrolling` identity issues only another enrollment grant. Do not rely on a bearer link or email message for continuation.
4. Show two verified credentials and the locally saved recovery kit. The kit acknowledgment binds its exact generation and attempt revision. Signup completion requires two distinct current credentials, one kit-save acknowledgment and a recent assertion of an enrolled credential to demonstrate returning access. A matching assertion can be reused while fresh and bound to the unchanged attempt; do not add repeated prompts just to advance screens.
5. Atomically mark the identity ready, activate its kit verifier/credentials and consume completion authority. Only this guarded completion or a subsequent ordinary passkey login may create a workspace session. The new owner then enters the existing profile/first-project welcome journey. Identity completion creates no project and invokes no AI.

Read saved progress after uncertain writes instead of automatically repeating ceremonies. If the first registration committed but its cookie/reply was lost, **Sign in with the passkey you just created** resumes it without another invitation. If no registration committed, request new options with a still-valid invitation. If an invitation expired before any credential was saved, a fresh invitation is necessary; support can reissue an invitation but cannot authenticate the old account. Authenticated cancellation of a content-free pending signup revokes its grants/keys and leaves the invitation spent; a new invitation starts a different signup. Abandonment alone never recycles the invitation.

If the only pending credential is lost before any kit was activated, email/support cannot recover that identity. Explain this limitation before enrollment and offer progress help; do not turn an invitation replacement into takeover of the pending account. No customer content or workspace authority exists at that point.

Two credential IDs are a completion rule, not proof of independent backups. Recommend another provider or an optional security key, without requiring hardware, purchases, attestation, PRF support or proof of provider independence. Synced copies of one credential count once. If a provider cannot create a second distinct credential, preserve progress and show supported alternatives; do not waive the rule.

## Recovery kit lifecycle

The trusted server generates a random 256-bit recovery key, stores only its verifier, and returns plaintext once in the preparation response. There is no endpoint to reread the plaintext. A failed/lost preparation response is safe: the current kit remains active, and an explicit new preparation invalidates the previous uncommitted offer. The user must save the new offer before it can commit; a save acknowledgment is a usability confirmation, not proof of durable storage.

Provide plain-text download, accessible copy and a local printer-friendly **Print / Save as PDF** view with one **I've saved my recovery kit** acknowledgment. Printing is optional. Use a constant non-secret filename. Include Whumpo, the account label, generation date/identifier, the manually entered address `https://whumpo.com/workspace/`, recovery instructions and the account/content recovery distinction. Never include a password, passkey private key, provider token or customer content. Do not encode the secret in a URL, QR code, filename, analytics, Chat, logs, screenshots or persistent application browser storage. Clear in-memory plaintext on exit; revoke generated download object URLs. Explicit downloaded/printed copies are the user's backup, with clear independent-storage guidance. Test visuals with synthetic values only.

Ordinary **replace kit** uses a recent passkey-authenticated session: prepare → save → commit with exact generation, request ID and expected epoch. Until commit, the old kit remains valid. The commit replaces its verifier and fences competing recovery/rotation attempts atomically. Successful ordinary rotation invalidates outstanding identity grants/challenges and other sessions; the initiating session can remain only with its original expiry/proof time and updated epoch in that same guarded transaction. Failure changes nothing. A lost commit reply is resolved by authenticated generation/receipt readback; the saved new kit is usable if the commit won. If readback says it did not commit, keep the old kit and explicitly retry the unchanged valid offer. Never infer success from a client timestamp or retry a different offer under the old request ID.

## Recovery after losing passkeys

Recovery is two transactions separated by replacement enrollment. This prevents a lost setup response from requiring the now-retired old kit and prevents an incomplete attempt from reaching the workspace.

### A. Secure and enter restricted recovery

1. Email plus current recovery key yields a short-lived recovery grant and that account's credential inventory only. Use generic invalid-proof errors, bounded bodies, existing Origin/rate limits and no-store responses. Before a reviewed commit, this read neither revokes sessions nor blocks normal login.
2. Review **all / some / none**, binding the exact current credential set/revision. `some` requires explicit owned IDs and at least one retained credential; selecting every key is `all`. `none` is available, but a user with usable keys should be directed to ordinary sign-in/security. No choice enables direct recovery-code login.
3. Prepare and save the replacement kit. A guarded **Secure my account** commit rotates the old kit, increments the authority epoch, revokes prior sessions/grants/challenges, removes exactly the reviewed lost keys, and sets `recovering`. Persist the winning attempt and a newly scoped continuation grant atomically. `all` refers to the reviewed set, never keys added after that snapshot; changed state requires a fresh review. All retained keys now permit restricted continuation only until recovery completes.
4. A unique winning receipt admits cleanup, as in the existing concurrency fix. Compare the current kit verifier, epoch and credential revision at commit time. Losing/stale attempts cannot remove later replacements, sign out later sessions, overwrite the winning kit or emit a second effect. Any cleanup failure rolls the whole transaction back.

After a lost commit reply, the **already saved new kit** can resume the current recovery attempt. The old kit is invalid if rotation committed. Reentering the current kit for an account already `recovering` with a secured attempt resumes that attempt; it does not rotate again or discard replacements. Emergency last-key removal can leave `recovering` without a secured attempt: current-kit proof then starts a new all-loss review/secure transaction. A retained or staged passkey may also resume that same restricted attempt. Restarting/changing the selected loss set requires a new explicit review and revision; it cannot widen an in-flight request.

### B. Enroll and complete

- **All keys lost (including zero usable keys):** enroll two distinct new credentials in the current attempt.
- **Some/none retained:** enroll at least one new replacement credential and retain at least one reviewed credential, giving two current credentials at completion. If the allegedly retained key is also lost, revise the review to all and enroll the second replacement. At the ten-key cap, review a removal before replacement; never silently choose which key to discard.
- The saved rotated kit generation must still match this attempt. If its copy is lost, a current replacement/retained passkey may authorize a new restricted prepare/save/rotate sequence; no ordinary session is required. That guarded rotation preserves verified progress and fences older offers/grants. An owner with neither a usable passkey nor the current kit cannot regain access through email/support.
- Require a **fresh assertion of a newly enrolled replacement**, bound to completion, after the kit-save step. Check both replacement IDs/current state and the assertion at the final commit. A registration response, retained-key assertion, acknowledgment or recovery key alone is insufficient.
- Complete, activate staged keys, consume the attempt and its outstanding grants/challenges, and issue the ordinary session atomically under current epoch/kit generation/credential/revision. No unrelated external call belongs in that transaction. Losing completions receive no session. If the reply/cookie is lost, an ordinary replacement-passkey login retrieves the completed account; replay of a receipt never mints another session.

This flow may temporarily deny ordinary access after the explicit secure step, including for retained keys. Say so before confirmation. It promptly removes compromised keys while allowing resumable replacement enrollment without AI. Help remains available throughout. Recovery does not revoke third-party grants; the separate [incident/compromise work](security-risk-actions.md) reviews connected access.

### Emergency removal and normal use

A recent passkey-authenticated user can explicitly remove a compromised credential even when fewer than two remain. Warn and recommend replacement, but do not keep an unsafe key active to satisfy a minimum. Removal revokes all sessions and outstanding identity authority in the same committing batch. If one usable key remains, ordinary passkey sign-in still works and recommends a backup. If none remains, enter `recovering`; the saved current kit opens the restricted all-loss flow above. An existing kit cannot be reconstructed, and emergency removal must not falsely promise access if the owner also lost that kit.

An old ordinary session is not sufficient to remove keys after its fresh-passkey window expires. Reauthenticate with a current key or use the recovery-kit flow. Neither support nor Chat can waive proof. Valid ordinary sessions otherwise continue without routine authentication prompts; security help, sign-out, recovery and essential direct controls remain outside model authority.

## Versioned operation contract

Implement one `/api/auth/identity/v1/` browser adapter over shared domain operations. These routes are **reserved, not present today**. Native transport reuses their semantics, not browser cookies or a generic proxy. POST mutations require exact Origin for browser requests, bounded JSON, current authority and idempotent effect IDs. Client-supplied `userId`, step counts or `complete` flags never grant authority.

| Relative operation | Authority / result |
| --- | --- |
| `GET state` | Anonymous returns only signed-out/config state. Restricted grants return own progress, deadlines, non-secret receipt/generation and allowed next steps. Ready sessions return identity status; full profile remains a separate route. |
| `POST signup/options`, `signup/verify` | Invitation-bound challenge then first credential/account transaction; enrollment grant only. |
| `POST passkeys/login/options`, `passkeys/login/verify` | Proof resolves server identity stage: ready → session, enrolling/recovering → restricted continuation. |
| `POST passkeys/add/options`, `passkeys/add/verify` | Purpose-bound recent ordinary authority or current restricted attempt; verify and record credential once. |
| `POST kit/prepare`, `kit/commit` | Prepare one-time plaintext offer; commit only exact saved generation under authorized purpose. Recovery secure uses its own atomic commit below. |
| `POST recovery/start`, `recovery/secure` | Current kit proof → restricted grant; exact reviewed loss + saved replacement kit → atomic securing transaction. |
| `POST completion/options`, `completion/verify` | Bound assertion then guarded enrollment/recovery completion, possibly a normal session. Never accepts a Boolean claiming verification. |
| `POST passkeys/remove`, `cancel`, `logout` | Exact reviewed removal, purpose-specific pending cancellation or sign-out; callable under their specified authority without the ordinary workspace guard. Cancelling a secured recovery only signs out; it cannot undo revocation. |

Kit save acknowledgment travels with the appropriate commit/completion and binds the prepared offer; do not create a second mandatory acknowledgment. Signup activates the initial verifier in completion; recovery activates it in `recovery/secure`; ordinary rotation uses `kit/commit`. In restricted recovery, replacement of an already rotated but lost kit uses `kit/commit` with fresh retained/staged passkey proof. All modes share one kit state machine and differ by admitted authority, not separate storage.

Sanitized progress example (illustrative identifiers, no real credential material):

```json
{
  "contractVersion": 1,
  "authority": "enrollment",
  "stage": "enrolling",
  "attemptId": "example-attempt",
  "revision": 3,
  "verifiedPasskeys": 1,
  "requiredPasskeys": 2,
  "kit": {"generation": "example-generation", "saved": false},
  "allowedNext": ["add_passkey", "help", "logout"]
}
```

Write intent includes `requestId`, `attemptId`, `expectedRevision` and the exact typed effect. Same ID + same payload reads the existing result; same ID + changed payload is `409 request_conflict`. Expired proof is `401 proof_required`; current restricted authority on a workspace route is `403 identity_incomplete`; stale review/epoch is `409 identity_changed`; unsupported old protocol is `409 client_upgrade_required`. Public invalid proofs use one generic response without revealing account state. Readback requires currently valid matching authority, not possession of an operation ID. A consumed/expired authority may require passkey/current-kit proof again.

Challenges are single-use and bound to the exact operation. Invalid verification consumes the challenge as today; cancellation/new options must not erase earlier successful enrollment. A lost verification reply is recovered from current progress or a new assertion, never by accepting a replayed challenge. Terminal effect receipts cannot resurrect sessions. Serialize guarded effects in [D1 batches](https://developers.cloudflare.com/d1/worker-api/d1-database/) and recheck current epoch, authority expiry/freshness against database time, credential status and expected revision **inside** the committing statements. A preflight check or a matching replacement verifier alone is insufficient.

## Current-policy test cutover and forward recovery

The October 1 [current-version directive](current-version-policy.md) supersedes the earlier staged existing-account plan. All environments are disposable tests. Do not implement a `legacy` identity stage, password-based migration grant, old-session reader, per-account coexistence switch or delegation from retired auth routes.

1. **Prepare the complete current path:** WH-114 builds the common resolver and resumable signup; WH-115 adds restricted recovery and the shared kit lifecycle. Verify them together with disposable identities before making the new policy authoritative. This implementation order does not require two supported runtime policies.
2. **Review one test cutover:** identify the obsolete account/session/grant/credential fixtures to reset and their owned test data dependencies. Deletion is authorized; preserving existing accounts through a conversion is not required. Retain unrelated encrypted provider credentials only if their current owner and authority survive explicitly; never orphan credentials or infer a new owner. Reset affected stale clients and caches too.
3. **Switch current components together:** stop auth writes if needed, drain/fence in-flight operations, apply the reviewed reset, and deploy the current schema, handlers and web client. Remove password signup/login/add/change and superseded passkey/recovery routes. Reject unsupported protocol versions explicitly. There is no automatic old-route redirect/delegation or old-handler deployment target.
4. **Enroll afresh:** an invitation and two current passkeys plus a saved kit establish the new test identity through the same ordinary signup path. Old passwords, sessions and recovery kits confer no authority. Incomplete current enrollment remains resumable and cannot enter the workspace. Record actual owner/device acceptance separately from local fixtures; no key count or operator backfill marks an identity ready.
5. **Recover forward:** if the cutover fails, inspect the actual schema, receipts and current policy, stop affected writes, and deploy a corrected current release. Recreate obsolete test fixtures when necessary. Never restore an older auth binary/database to recover UI behavior or revive revoked credentials/kits.

Current grants and sessions carry the exact supported policy and account epoch. Admission and committing database statements reject absent/stale metadata. Same-request recovery remains accurate for current operations; retaining a receipt does not admit a prior protocol. Apply the [current release rules](releases.md), including uncertain-outcome readback before retries. Keep visitor identity isolated. Physical-device and real-customer admission gates remain explicit; this document does not activate the new authentication policy.

## Browser, Android and accessibility acceptance

Preserve current RP ID `whumpo.com` and exact web origin `https://whumpo.com`; localhost is its explicit isolated alternative. Existing verification uses resident credentials and user verification, with no attestation purchase requirement. Validate challenge, origin, RP ID, user handle, signature and credential/counter state using maintained WebAuthn verification. Backup flags or counter values do not prove storage independence. References checked October 1: [WebAuthn registration](https://www.w3.org/TR/webauthn-3/#sctn-registering-a-new-credential) and [assertion verification](https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion).

WH-081/083 must bind native assertions to approved package/signing origins and the same RP/account rules; debug identity never acquires release authority. Browser signup/recovery completes before a PKCE/state/redirect-bound exchange can issue a native session. Recheck identity stage, epoch, source session and proof time when creating **and consuming** the exchange; revocation during handoff invalidates it. A return code creates no new freshness and grants no extra lifetime beyond its source session. Welcome completion is still required before native Chat/project operations. Unknown protocol versions get a safe upgrade/browser-help path. Follow the existing [Android handoff contract](android-app.md#native-identity-and-browser-handoff); physical app association remains unverified by this decision.

Required evidence before the relevant acceptance gate:

| Evidence | Cases and honest limitation |
| --- | --- |
| Actual handlers + disposable D1 | Direct-route purpose denials, invitation race, duplicate IDs, replay/expiry, current-epoch commit guards, two-key completion, staged-key denial, kit prepare/save/commit, all/some/none, emergency zero-key state and lost-response readback. Synthetic signatures do not establish device usability. |
| Deterministic interleavings | Revocation after admission, competing secure/complete/rotate, same/different request IDs, changed loss inventory, key deletion before session insertion, cleanup rollback and concurrent native exchange. Exactly one effect; loser has no cookie or later cleanup. |
| Browser integration | Cancel second prompt, close/reopen, return on another browser, expired grant, cache clearing, old bundle, unavailable inference, recovery help, keyboard/screen reader, small-screen layouts, copy-denied/download failure and printable/PDF layout using synthetic kits. |
| Physical passkeys | Recorded browser/OS/provider versions on desktop and mobile, synced credential behavior, creating the second distinct key with supported providers, cross-device resume and optional hardware key, fresh recovery assertion and successful returning login. Do not advertise unsupported combinations. |
| Reviewed disposable test-platform owner | Real invitation/Turnstile, two-key setup, saved kit, all-loss and partial recovery, revoked old key/session, response-loss guidance and a clean test reset followed by fresh enrollment. Use disposable identities and record owner re-enrollment separately; do not claim a retained password/session proves the new policy. |
| Android acceptance, when implemented | Actual Credential Manager, verified links/approved signing origin, PKCE mismatch/replay/expiry, process death, incomplete enrollment, post-revocation exchange denial and web/native account switch. Not a prerequisite to activate web if Android is still unshipped. |
| Current-policy cutover drill | Obsolete identities/sessions are reset; stale handlers/clients reject; missing metadata fails closed; forward repair cannot resurrect passwords, revoked credentials or kits. Current enrollment/recovery remain resumable. |

Record counts, step latency and coarse failure categories; never credential IDs, recovery secrets, email addresses or assertion bodies in telemetry. Measure second-key and kit-save abandonment without requiring printing. Ordinary sessions should trigger no new routine prompts.

## Decision completion and implementation handoff

The protocol review resolves partial recovery (new replacement plus retained key), one shared kit lifecycle, pending invitation ownership, restricted continuation, committing authority and current-policy test reset. Cancelled/duplicate enrollment preserves progress; competing commits cannot repeat cleanup; lost replies use saved keys/kit and authenticated receipts; forward recovery cannot revive retired proof. This is a contract review, not execution of those new cases.

WH-114 delivers the common identity resolver/state/guards and resumable signup; it must keep the new policy isolated until WH-115 is ready for the single reviewed cutover. WH-115 uses those same records for restricted recovery and kit delivery, without replacing the storage or session model again. WH-090 consumes the principal for feature authorization, WH-105 for interactive forms, WH-054 for members, and WH-081/083 for native access. WH-116/117 own data-protection classification/implementation; WH-118 remains optional encryption feasibility outside beta gates. No new service, PDF dependency, purchase or provider entitlement is required by this decision; existing Workers/D1 storage and request costs remain applicable. No schema reset number is reserved until implementation.
