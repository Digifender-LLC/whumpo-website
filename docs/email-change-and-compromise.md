# Verified email changes and compromise response

**WH-063 contract slice (WH-199), October 9, 2026 UTC; source baseline `4dea09c`.** This is a **frozen contract**. It freezes how an owner changes the account email and how an owner responds to a suspected compromise, maps the current source with exact gaps, and splits the remaining [WH-063](roadmap/backlog.md#wh-063--define-verified-email-changes-and-compromised-account-recovery) work into WH-199–205.

**WH-200 status (October 9, 2026 UTC): implemented in source as a pure module, not wired.** The verified-address-change state machine and the confirmation-token handling are in [`src/email-change/`](../src/email-change/policy.ts) (see [section 2.1](#21-source-module-wh-200)). It is pure functions over plain records: no persistence, route, Chat binding, sender, provider, table or schema change, and no Worker entry imports it (an esbuild import-graph check proves this). Accounts still cannot change their address, and nothing is sent. The [conformance harness](../tests/email-change-contract.mjs) runs the source against a synthetic in-memory store, the synthetic mailer and a fake provider revoker. The compromise review is still only an [offline reference](../tools/prototypes/compromise-review.mjs) for WH-203. That file also hosts the source module inside a synthetic identity engine (sign-in, sessions, recovery grants). No Worker imports it.

It builds on, and does not replace, the [shared workspace identity contract](workspace-identity.md) (WH-113) with its [authority](identity-authority.md), [ceremonies](identity-ceremonies.md), [kits](identity-kits.md) and [restricted recovery](identity-recovery.md); the [notification contract](notifications.md) (WH-068/154) and [WH-036 contact delivery](contact-forms.md#owner-notification-delivery-wh-036); the [connection key lifecycle](connection-key-lifecycle.md) and the [GitHub](integrations/github-connection.md) and [Cloudflare](integrations/cloudflare-connection.md) connections; [data protection](data-protection.md) (WH-116) with the [lifecycle catalogue](data-lifecycle.json); [passkey encryption feasibility](passkey-encryption-feasibility.md) (WH-118); the [incident runbooks](incident-runbooks.md#9-owner-identity-and-session-incidents-sev1); and the [current-version policy](current-version-policy.md).

## 1. Current state, confirmed from source

The account email is an **unverified identifier**. Nothing proves that the owner controls it.

| Use today | Source | What it means |
| --- | --- | --- |
| Stored once at signup | `users.email TEXT NOT NULL UNIQUE` in [canonical-inputs.sql](../src/workspace-identity/canonical-inputs.sql); bound by `signupOptions` and inserted by `signupVerify` in [ceremonies.ts](../src/workspace-identity/ceremonies.ts) from the signup request after a lower-case trim and a loose shape check | No verification column, time or sender. The invitation is not bound to an address, so any address typed at signup is accepted. No message is ever sent to it. |
| No change path | [profile.ts](../src/profile.ts) `updateProfile` allows only name, about, sharing, measurement consent, theme and avatar; no other source updates `users.email` | Once chosen, the address is fixed. |
| Display only | `readProfile` in profile.ts, `identityState` in [http.ts](../src/workspace-identity/http.ts), the identity flow in [flow.tsx](../frontend/src/identity/flow.tsx) | Shown to its owner. `agentProfile` excludes it, so it never reaches the model. |
| WebAuthn user name | `registration()` in ceremonies.ts passes it as `userName`; the user handle is the account ID | Passkey managers display it. It is not part of verification. |
| Recovery lookup | `startRecovery` in [recovery.ts](../src/workspace-identity/recovery.ts) finds the account by email, then compares the current kit verifier in constant time; unknown account and wrong kit give one generic `proof_required` error | The email is a **lookup key**; the kit is the proof. The result is a restricted recovery grant, never a session. |
| Kit label | `kits.ts` puts it into the kit document as the account label; [kit-document.ts](../src/workspace-identity/kit-document.ts) tells the owner to enter "the account email and this recovery key" | A printed kit names the address that was current when it was generated. |
| Inactive support notice | `runSupportDelivery` in [support-delivery.ts](../src/support-delivery.ts) would send to `u.email` | No provider is implemented for support notices, so nothing is sent today. Activating it would mail an unverified address. |

**Rule (frozen):** an email address, verified or not, is never a sign-in method, a recovery factor, an authorization factor, a substitute for a passkey or the current kit, or a channel that can approve, veto or undo anything by itself. Verification proves only that a message from the platform sender reached a mailbox the owner could read at that time. This matches the accepted policy: no email links, SMS or social-login substitutes, and "email address knowledge or a support conversation never substitutes for the established recovery proof" ([identity and data protection](roadmap/identity-and-data-protection.md)).

## 2. Verified address change (contract version 1)

All operations are direct owner controls in **Settings → Account**, available while inference is down. Chat may link to the control; no agent action can prepare, confirm, cancel or read a change, and addresses and tokens never enter model context.

### Request

1. **Authority.** A current ordinary session for a `ready` account whose passkey proof is at most ten minutes old (the identity engine's existing fresh-passkey window, `proof_at>unixepoch()-600`). Restricted enrollment or recovery grants are refused `403 identity_incomplete`; a stale epoch `409 identity_changed`; old proof `401 proof_required`.
2. **Input.** Closed: `{version: 1, requestId, newAddress}`. Unknown fields, a sender, a connection or mailbox reference, and any retired proof field (`password`, `recoveryCode`, `magicLink`, codes) are refused. One plain address, normalized and shape-checked with the same rule as the WH-036 destination. The current address is `NO_CHANGE`.
3. **Delivery gate.** If platform delivery is not active, the request returns `delivery_unavailable` and **stores nothing**, as WH-036 destination verification does today.
4. **One pending change.** A new request supersedes any earlier pending change. The superseded change's token is refused as stale, and its unsent message is cancelled.
5. **Binding.** The pending change records the account, request ID, normalized address, current authority epoch, creation time and expiry (recommended one hour; decision 1).
6. **Identical responses.** The response is always `{status: "pending-confirmation", changeId, expiresAt}`. If another account uses the address, or holds it reserved during its undo window, no confirmation is sent and the change simply expires, but the requester sees the same response and state. Only someone who reads that mailbox could tell the difference.
7. **Idempotency.** The same request ID with the same payload reads the saved response; a different payload is `409 request_conflict`.
8. **Effects.** In the same transaction: the new-address confirmation is queued (when deliverable) and a content-free **change-requested notice to the current address** is queued.

### Confirmation tokens

- The token is 256 random bits (base64url). It is **minted inside the claimed delivery attempt**, and only its SHA-256 verifier is stored. The plaintext exists only in that one provider call and the recipient's mailbox. It is never in the outbox, receipts, logs, analytics, model context or exports. This is why the token is not created at request time: a queued row would otherwise have to hold it.
- A definite refusal that certainly did not send (provider deferral) clears the verifier; the retry mints a new token. A definite rejection or suppression ends the change as `undeliverable`. An **unknown outcome is never redispatched**; the verifier stays valid because the message may have arrived.
- The link opens a confirmation page. **Confirming requires the owner's current ordinary session for the same account** (signing in with a passkey if needed), plus the token. A link alone never changes account state. A token presented by another account, or with no session, is refused generically.
- At commit the server rechecks, inside the committing statement: token verifier, owning account, `pending` status, expiry, **unchanged authority epoch** and address uniqueness. Expired → `token_expired`; superseded or epoch changed → `stale_change`; cancelled or closed → `change_closed`; taken by another account in between → `address_unavailable` (shown only to the token holder).
- Confirmation sets the address, its verification time and sender, keeps the previous address and verification state for the undo window, and queues a content-free **change-completed notice to the previous address**. A replay of the same token by the same account returns the saved receipt with no second effect. That covers a lost reply. After an undo, the token is closed.
- Confirmation does not advance the epoch or revoke sessions: the email is not authority. Any epoch advance before confirmation (passkey removal, kit rotation, recovery securing, compromise commit) makes the pending change stale.

### Cancel and undo

- **Cancel:** any current ordinary session of the owner can cancel a pending change. Cancelling is idempotent and safe in direction.
- **Undo:** within the undo window (recommended seven days; decision 2), a fresh-passkey session can restore the previous address **with its previous verification state**. It does not invent verification, and it notifies both addresses. During the window the previous address stays reserved, so no other account can claim it and recovery lookup stays unambiguous.
- The previous address gets **no email-link veto** (decision 3). Its notice tells the reader to sign in with a passkey and cancel or undo, or to start a compromise review. Giving an old mailbox the power to block a change would let anyone who controls that mailbox stop the owner from moving away from it.

### Messages and failures

| Message | To | Contains | If it cannot be delivered |
| --- | --- | --- | --- |
| Confirm new address | New address | Fixed text, the token link, stop instructions. Not the old address. | Rejected or suppressed: change `undeliverable`, owner sees "couldn't send; check the address". Deferred: bounded retry with a new token before expiry. Unknown: no resend; the owner may request again (counted by rate limits). |
| Change requested | Current address | Event and time; how to cancel or start a review by signing in. No token, no new address. | Recorded only. Never blocks or reverses the change. Suppressed addresses are skipped. |
| Change completed / undone | Previous address (and new on undo) | Event only | Same as above. |

All messages come from `notify@whumpo.com`, display name `Whumpo`, through the platform provider selected for WH-036 (Cloudflare Email Service). They use the `platform-obligation` authority class of the [notification contract](notifications.md#verified-sender-model). Platform delivery is independent of customer mailbox OAuth (WH-056/096–100). A connected customer mailbox is never used to send, and its consent never authorizes an account notice. The v1 notification catalog has no account templates, so adding them is a reviewed catalog amendment in WH-202 (gap G-E10).

### Rate limits (recommended v1 values)

- At most 3 change requests per account per 24 hours.
- At most 3 confirmation messages per destination address per 24 hours, across all accounts. Excess requests get the same response and no message.
- At most 5 failed confirmations per account per hour.
- The existing identity route limiter (`AUTH_LIMITER` in http.ts) and the Origin, body and no-store boundaries apply to every route.

### 2.1 Source module (WH-200)

Status: **implemented in source, not wired** (October 9, 2026 UTC). Every step takes the server-resolved principal, the account's email state and the change rows the caller read. It returns the next rows, the notices to queue and the result, and stores nothing.

| File | Contents |
| --- | --- |
| [policy.ts](../src/email-change/policy.ts) | Contract version 1. `emailChangeBounds` holds the recommended decision values as versioned constants: 60-minute link, 7-day undo, the 10-minute fresh-passkey window and the rate limits. Also the platform sender, retired proof fields, message kinds, the closed-input parser, the address rule (the same pattern and length limits as WH-036 `normalizeDestination`, checked by the harness) and `authorizeOwner`. `authorizeOwner` admits only a current ordinary session of a `ready` account. It refuses authority from an earlier epoch (`IDENTITY_CHANGED`), restricted grants (`IDENTITY_INCOMPLETE`) and an old or non-passkey proof where a fresh proof is required (`PROOF_REQUIRED`). |
| [change.ts](../src/email-change/change.ts) | Change states and the transition table. `requestEmailChange`, `confirmEmailChange`, `cancelEmailChange`, `undoEmailChange` and `readAccountEmail`, plus the address-reservation rule and the per-address limit key. |
| [token.ts](../src/email-change/token.ts) | 256-bit base64url token minting, `tokenVerifier` (SHA-256 hex through the existing `hashToken`), the `PlatformMailer` interface, `deliverNotice` and `createSyntheticMailer`. `deliverNotice` mints the token only inside a claimed attempt and commits the verifier before the single mailer call. The synthetic mailer is for tests only: no network, and it rejects every recipient outside the reserved `.test` domain. |
| [compromise.ts](../src/email-change/compromise.ts) | Only the compromise-review transitions WH-200 owns: `pendingChangeForReview` for the review snapshot, and `closeForSecurityReview`, which cancels a pending change inside the review commit and does nothing on a replay. |

The behaviour is the contract above. A link alone never changes the account: confirmation needs the token and the same account's current session. Token plaintext reaches only the mailer call. Retries replay. Superseded, expired, cancelled, stale-epoch and foreign tokens are refused. The old address is notified without the token or the new address. An address held by another account gets the same response and no message. Undo restores the previous verification state. A session, in-flight sign-in or token from before a compromise commit cannot change the address afterward: the epoch fence refuses the authority, and the commit closes the pending change.

Refinements of the WH-199 reference, none reachable by any customer, API or model:

- Records use `state` (`pending`, `confirmed`, `undone`, `cancelled`, `superseded`, `stale`, `expired`, `undeliverable`, `unavailable`) and carry a `revision`. Every transition writes `revision+1`, so concurrent confirm, cancel and review commits read from one row produce exactly one outcome under a revision-guarded write (checked). The reference's `failed` state for an address taken before confirmation is named `unavailable`.
- The previous address, its verification state and the undo deadline live on the confirmed change row, which is the undo reservation. They are not on the account.
- The request hash binds the contract version, account, request ID and normalized address.
- The closed body and the address are validated before authority is resolved. So a malformed address is `INVALID_ADDRESS` even without a session. The reference checked the address after the session and delivery gates.
- `readAccountEmail` stops showing a pending change once its expiry time passes, even before any write marks it expired.
- Codes are internal upper-case codes. The WH-201 HTTP adapter maps them to the contract's responses: `TOKEN_EXPIRED` → `token_expired`, `STALE_CHANGE` → `stale_change`, `CHANGE_CLOSED` → `change_closed`, `ADDRESS_UNAVAILABLE` → `address_unavailable`, `DELIVERY_UNAVAILABLE` → `delivery_unavailable`, `REQUEST_CONFLICT` → `409 request_conflict`, and the identity codes to the existing `403/409/401` responses.

Obligations the module cannot meet alone, left to the storage and adapter slice (WH-201):

- Resolve the principal through the identity engine and convert its seconds to milliseconds.
- Write each step's rows, notices and limits in one batch with the revision guard. Repeat `identityPredicate` (epoch and fresh passkey) inside the committing statements.
- Recheck address uniqueness at commit (`users.email UNIQUE`, plus the reservation predicate).
- Commit the delivery claim before the mailer call, and never re-pick a `dispatching` notice.
- Register the data classes and maintenance.

Left for WH-203: the review snapshot and its staleness binding, emergency passkey removal, the epoch advance that revokes every session, grant, challenge and kit offer, kit rotation with save-before-rotation, provider disable and revoke-before-erase with held unknown outcomes, the receipt and the review notice. These remain in the [reference](../tools/prototypes/compromise-review.mjs). Templates, the provider and the outbox are WH-202.

## 3. Compromise response

Compromise response is **not** lost-passkey recovery.

| | Lost-passkey recovery (existing, WH-115) | Compromise review (this contract, WH-203) |
| --- | --- | --- |
| Who | Owner without a usable passkey | Owner who still signs in, or has just completed recovery, and suspects that a passkey, session, kit, mailbox or provider connection is exposed |
| Proof | Current kit → restricted recovery grant only; two replacement passkeys and a fresh replacement assertion before a session | Fresh passkey on a current ordinary session |
| Scope | Loss review, kit rotation, replacement enrollment | One snapshot: passkeys, sessions, kit generation, pending email change, provider connections |
| Never | Issues a session from the kit, touches email or provider connections, recovers content | Accepts a password, email link, support statement or Chat approval; recovers encrypted content |

### Review and commit

1. **Prepare** (fresh passkey) returns a snapshot bound to epoch, credential revision, kit generation and the connection set, valid for ten minutes. It lists active passkeys, sessions (non-secret metadata), kit generation, any pending email change and each provider connection with its state. It states that account recovery is not content recovery.
2. **Optional kit replacement** uses the shared prepare → save flow bound to this review; the commit needs the saved acknowledgment (save-before-rotation). An unsaved offer is refused.
3. **Commit** (fresh passkey, request ID, exact selections) runs as one guarded transaction that rechecks the snapshot. A stale or expired review is `stale_review`. The commit:
   - removes the selected passkeys. **Emergency revocation is allowed below the two-key count, down to zero**, in which case the account enters `recovering` and the saved current kit opens the existing restricted all-loss flow;
   - advances the authority epoch, which **revokes every session (including the initiating one), restricted grant, challenge and kit offer**;
   - activates the saved replacement kit, if one was chosen; the old kit stops working;
   - cancels any pending email change;
   - for each selected provider connection, disables local access immediately and queues provider revocation **with the encrypted credential retained**;
   - records a content-free receipt and queues a security-review notice.
4. A lost commit reply is recovered by signing in again with a retained passkey and replaying the same request ID, which returns the saved receipt with no second effect. A changed payload is `request_conflict`.

**Concurrent sign-in cannot restore authority.** A sign-in challenge issued before the commit, a session minted just before it, a restricted grant and a pending email-change token all carry the earlier epoch and fail afterward. A removed passkey cannot complete a sign-in. Only retained passkeys can sign in, at the new epoch. The reference fences by epoch. The implementation must also delete those rows in the same batch and recheck the epoch inside committing statements, as the identity engine already does ([workspace identity](workspace-identity.md#versioned-operation-contract)).

### Provider connections: revoke at the provider before local erasure

- **Order:** disable local access first (no capability can use the credential), keep the encrypted credential as reconciliation authority, dispatch revocation, and erase the credential only after an exact receipt. The receipt is GitHub `204` for single-token or reviewed grant deletion, or Cloudflare RFC 7009 `200`, as the existing adapters already require ([GitHub](integrations/github-connection.md#disconnect-and-cleanup), [reviewed grant revocation](connection-key-lifecycle.md#reviewed-app-grant-revocation--october-2-2026-utc), [Cloudflare](integrations/cloudflare-connection.md#disconnect-and-maintenance)).
- **Unknown outcome:** timeouts, throws, lost responses and unrecognized replies become `uncertain`. The hold and credential are kept, erasure and account closure are blocked, and nothing is redispatched blindly. Reconciliation is read-only: authenticated provider evidence settles it, and "not found" is not proof. After a bounded number of reads or time (recommended 3 reads in 72 hours) the hold becomes `unresolved` and stays for operator attention. A definitive refusal that changed nothing may be retried for the **same** retired credential, under the existing claim rules.
- Retained GitHub refresh credentials and unidentified grants keep the existing [custody rules](connection-key-lifecycle.md#github-refresh-credential-custody--october-2-2026-utc). A compromise review does not broaden scope or guess which grant a provider event settles.
- **Future OAuth connectors** register the same revoke-before-erase obligation through the [connector contract](connectors.md) (WH-140).
- Reconnecting after a review is a new reviewed consent. It does not prove the old token was revoked.

### Restricted authority, content keys and retired passwords

- **Recovery secrets grant only the shared restricted enrollment authority.** A kit-derived grant can review losses, enroll replacements, save a kit and complete recovery. It cannot reach email, connection, export, project or compromise-review operations (`identity_incomplete`). Connection revocation waits for the ordinary session that recovery completion issues. Provider credentials are server-held and usable only through a Whumpo session, which the securing step already revoked.
- **No encrypted-content recovery.** Whumpo holds no customer content keys (WH-118 recommends no adoption). A review never claims to recover, unlock or reconstruct encrypted content, and its receipt has no such field ([account recovery is not content recovery](incident-runbooks.md#91-account-recovery-is-not-content-recovery)).
- **Retired password authority is never revived.** No operation accepts a password or recovery code. Forward repair, restore and support cannot recreate retired proof ([current-version policy](current-version-policy.md)).
- **Support** (`hello@whumpo.com`, [lockout path](usage-review-requests.md#independent-support-access-wh-035)) cannot authenticate, waive proof, change an address or restore access. The only operator action is the existing reviewed [session revocation](workspace-identity.md#emergency-removal-and-normal-use) (WH-050), which grants nothing (decision 5).

### Relationship to incident gaps G5 and G6

[G5](incident-runbooks.md#3-gap-register-controls-this-runbook-needs-that-do-not-exist) (no owner notice of recovery or passkey events) needs a verified address and live delivery. WH-202 can add those notices if the owner approves (gap G-E11, decision 4). [G6](incident-runbooks.md#92-stolen-recovery-kit-g5g6) (stolen kit plus email → attacker recovery) is **not closed** by this contract. The email stays a lookup key, so knowing or controlling it adds no attacker power. A notice at recovery start gives the owner time to rotate the kit from a passkey session, which fences the attacker's attempt. A mandatory waiting period before securing recovery is listed as decision 6, not adopted.

## 4. Data classes and retention (WH-116 / WH-009 extension)

These are planned classes. WH-201 registers the real tables in [data-lifecycle.json](data-lifecycle.json). The [reference](../tools/prototypes/compromise-review.mjs) exports the same list as `dataClasses`. The WH-200 records match it. A change row holds only the token's SHA-256 verifier. Limits are keyed by a hash of the address (`addressKey`). Queued notices hold no token.

| Class | Records | Protection | Proposed retention | Export |
| --- | --- | --- | --- | --- |
| `owner-email` (extends `owner-identity`) | Account address, verification time and sender | managed-readable | While the account exists; closure purge | Address and verified time |
| `owner-email-changes` | Pending change, token **verifier only**, previous-address undo reservation | managed-readable; SHA-256 verifier, never plaintext | Pending until confirmed/cancelled/superseded/stale/expired; terminal rows 30 days with the new address replaced by its hash; previous address until the undo window ends | Open pending address and expiry; never verifiers, request hashes or limit keys |
| `owner-email-change-limits` | Request times, hashed per-address daily keys, failure counts | managed-readable | 48 hours | None |
| `platform-notifications` (WH-156 shared outbox) | Content-free account notices | managed-readable; **no token stored** | 30 days; unknown/unresolved evidence until resolved | State and time |
| `owner-security-reviews` | Snapshot identifiers, selections, commit receipt | managed-readable; identifiers and counts only | 90 days after commit or expiry | Time, selections, outcome |
| `connections` (existing) | Encrypted credentials held for revocation, receipts | application-encrypted | Until a definitive revocation receipt or reconciled evidence; unresolved holds block closure | Connection state only |

Restore and forward repair must never revive a superseded change, a used token, an earlier verification state, an earlier epoch or an erased-without-receipt credential ([backup and current restore](data-protection.md#backup-deletion-and-current-restore)).

## 5. Existing code and tests, with exact gaps

| Contract element | Current source and tests | Gap |
| --- | --- | --- |
| Address verification state | `users(email)` only; `tests/identity-ceremonies.mjs` covers signup | **G-E1** **Resolved in source, open in schema.** [change.ts](../src/email-change/change.ts) sets the verification time and the `notify@whumpo.com` sender on confirmation, and restores the previous state on undo (WH-200). `users` still has no verification column. The harness pins that, and the absence of any `email_change` table, so WH-201 must update both pins when it adds them. |
| Signup uniqueness | `signupOptions` returns `409 identity_changed` for an address already in use, after a valid unused invitation and Turnstile | **G-E2** A bounded registration oracle for invitation holders. Out of WH-063 scope; recorded for WH-004-style review. |
| WebAuthn user name | `registration()` uses the address as `userName` | **G-E3** Passkey managers keep the old label after a change. Cosmetic: the user handle is the account ID. The WebAuthn Signal API could update names, but browser support is **unverified** and not part of v1. |
| Recovery lookup | `startRecovery`: email lookup + constant-time kit verifier, one generic error (`tests/identity-recovery.mjs`, 64 refusal/race checks) | **Conforms** (checked by the harness). After a change, recovery uses the current address. **G-E4** Printed kits show the old label, so the change confirmation must say which address to use. Offering a kit replacement is decision 2's companion. |
| Change path | None reachable (`updateProfile` allowlist; checked) | **G-E6** **Resolved in source, not wired.** Request, confirm, cancel, undo and read are in [change.ts](../src/email-change/change.ts), with token minting and delivery in [token.ts](../src/email-change/token.ts) (WH-200). No route, Settings control or Worker entry reaches them (esbuild import-graph check). WH-201 mounts the adapter. |
| Support notice | `support-delivery.ts` recipient `u.email`, inactive | **G-E5** Must require a verified address (or the decision 4 rule) before any support provider is activated (WH-202). |
| Fresh passkey | `authority.ts` 600-second predicate (`tests/identity-authority.mjs`, 72 checks) | Conforms. `authorizeOwner` in [policy.ts](../src/email-change/policy.ts) uses the same window and the same passkey-only proof (checked). |
| Emergency removal | `removePasskey` below two keys with epoch advance (`tests/identity-recovery.mjs`) | Conforms. **G-E7** No single review that combines removal, kit rotation, change cancellation and connections (WH-203). |
| Kit rotation | `rotateKit` prepare/save/commit (`tests/identity-kits.mjs`, 47 checks) | Conforms; reused by the review. |
| Operator session revocation | WH-050 CLI, no epoch change | Conforms as a containment step; not a compromise review. |
| Provider revocation | GitHub disconnect, single-token cleanup and reviewed grant revocation (`tests/github-connection.mjs`, `github-token-lifecycle.mjs`, `github-grant-revocation.mjs`); Cloudflare RFC 7009 disconnect (`tests/cloudflare-connection.mjs`) | Conforms to revoke-before-erase. **G-E8** No coordinated multi-provider selection from one review, and no closure-blocking summary in that review. |
| Platform sender | `notify@whumpo.com`, Cloudflare adapter (`tests/contact-notifications.mjs`, `tests/notifications-contract.mjs`); not live | **G-E10** No account templates in the v1 catalog; the WH-036 live send is not done. |
| Security-event notices | None | **G-E11** No notices for passkey added/removed, recovery started/secured or kit rotated (runbook G5). |
| No model path | `agentProfile` excludes email (checked); identity routes outside Chat | Conforms. The WH-200 module has no model, agent, Chat or mailbox export (checked). WH-201/203 must keep the agent catalogue free of these operations. |

`tests/profile.mjs` and `tests/profile-http.mjs` cover the current profile allowlist. The implementing slices select those suites, plus the identity suites above, by the files they change.

## 6. Official references (read October 9, 2026 UTC)

- **NIST SP 800-63B-4, [Authenticator Event Management](https://pages.nist.gov/800-63-4/sp800-63b/events/).** It says that binding an additional authenticator "SHALL notify the subscriber via a mechanism independent of the transaction". Account events "SHALL cause a notification to be sent to the notification addresses". CSPs "SHALL support at least two notification addresses per subscriber account" and "SHOULD allow subscribers with authentication at AAL2 or higher ... to update their notification addresses". The notification "SHALL provide clear instructions, including contact information, in case the recipient repudiates the event". Whumpo currently has **no** notification address that meets this (G-E1, G-E11). The publication date and revision status of the page were not re-read (**requires verification**).
- **OWASP [Authentication Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Authentication_Cheat_Sheet.html#changing-a-users-registered-email-address), "Changing A User's Registered Email Address".** With multifactor authentication: reauthenticate, store a pending change, create time-limited nonces, send "a notification-only email message to the current address" and "a confirmation-required email message to the proposed new address". This contract follows the multifactor variant, because passkeys are the only sign-in. The old-address message is notification-only.
- **OWASP [Forgot Password Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).** Tokens should be "Randomly generated using a cryptographically safe algorithm", "Stored securely" and "Single use and expire after an appropriate period". It also says a user should always have a recovery path "even if that involves contacting the support team". Whumpo deliberately diverges from that last point: the accepted identity policy has no support or email recovery. Decision 5 keeps this explicit.

These are guidance documents, not Whumpo compliance claims.

## 7. Open owner decisions

| # | Decision | Recommended | Alternatives |
| --- | --- | --- | --- |
| 1 | Confirmation token lifetime | **60 minutes** (matches WH-036 code expiry; short exposure in a mailbox) | 30 minutes; 24 hours (fewer expired links, longer exposure) |
| 2 | Undo window after confirmation, and the old-address reservation | **7 days**, fresh passkey, previous address reserved; offer optional kit replacement in the confirmation because printed kits show the old label | 72 hours; no undo (cancel-only before confirmation) |
| 3 | May the old address veto a change by link? | **No.** The notice says to sign in with a passkey and cancel or undo. An email link must not become authority, even to block. | Cancel-only link from the old address while the change is pending (fail-safe direction, but lets a compromised old mailbox block the owner) |
| 4 | Accounts whose only contact is the unverified signup email | **Keep it as a label.** Offer "verify this address" (the same flow with the current address) once delivery is live. Send only content-free security notices to it until it is verified. Never send support or other notices to an unverified address. | Require verification before any notice; send nothing to unverified addresses; require verification at next sign-in |
| 5 | Support-assisted compromise | **No support path changes credentials, kit, address or access.** Support may only point to the review and, on owner request through the authenticated support page, use the existing operator session revocation. | Allow operator local-disable of provider connections on an authenticated support request; allow nothing beyond guidance |
| 6 | Recovery notices and waiting period (runbook G6) | **Notify** a verified address when recovery starts and when it is secured, with no mandatory delay in v1. Revisit after WH-005 data. | 24–72 hour delay before securing when a passkey was used recently; no notice |
| 7 | Security-event notices (passkey added/removed, kit rotated) | **Yes**, content-free, to the verified address, through WH-202 | Only email-change and compromise notices |

These decisions gate WH-202/205 activation only where named. The contract and WH-200/201/203/204 source work need none of them; WH-200 implements the recommended values for decisions 1–3 as versioned policy constants: `emailChangeBounds` in [policy.ts](../src/email-change/policy.ts), and no old-address cancel operation. Answers authorize the decision only, not deployment, spending or provider activation.

## 8. Delivery slices

WH-063 stays the parent. Its acceptance is unchanged, and it closes only when every child is accepted. No child reaches WH-048, WH-049 or WH-104. Only WH-205 waits on WH-005 physical-device acceptance, and only WH-202 and WH-205 wait on the WH-036 live sender. Task scopes live in [backlog.json](roadmap/backlog.json).

| ID | Slice | Depends on |
| --- | --- | --- |
| WH-199 | This contract, the offline reference and conformance harness, and the decomposition | WH-113, WH-116, WH-154 |
| WH-200 | Source state machine and confirmation-token handling over the current identity engine; isolated canonical inputs on disposable SQLite/local D1 (G-E1, G-E6). **Pure module done** ([section 2.1](#21-source-module-wh-200)). Open: the isolated canonical inputs and focused SQLite/local D1 handler suites. | WH-199, WH-115 |
| WH-201 | Complete current schema, lifecycle classes, maintenance/closure inventory, trusted HTTP adapter and Settings controls (inactive delivery → `delivery_unavailable`), and one owner-authorized empty-D1 cutover | WH-200 |
| WH-202 | Account templates in the WH-155 catalog, routing through the WH-156 outbox, support-notice and security-event gating (G-E5, G-E10, G-E11) | WH-201, WH-156, WH-036 (blocked on its live send) |
| WH-203 | Compromise review: passkeys, sessions, kit, pending change and provider connections in one guarded commit (G-E7, G-E8) | WH-200 |
| WH-204 | Connected synthetic acceptance: actual Worker, current schema, signed synthetic WebAuthn, synthetic mailer/providers, browser checks | WH-201, WH-203 |
| WH-205 | Physical-device and approved delivery canary acceptance on disposable identities | WH-202, WH-204, WH-005 (blocked) |

## 9. Verification

`node tests/email-change-contract.mjs` (also `pnpm test:email-change-contract`, and part of `node tools/verify.mjs fast`) bundles [`src/email-change`](../src/email-change/policy.ts) with esbuild and runs 26 checks. Every address-change decision is made by the source. The [reference](../tools/prototypes/compromise-review.mjs) only stores the rows the source returns, with a revision guard, and supplies the synthetic identity engine and the WH-203 compromise behaviour. The checks cover:

- the email never becomes a recovery or authorization factor (pending or verified address, wrong or missing kit, no email or link sign-in operation);
- refusal of unknown versions, unknown fields and retired password fields;
- fresh-passkey requirement;
- restricted recovery authority;
- delivery unavailable stores nothing, and the old-address notice carries no token or new address;
- hash-only single-use tokens bound to the requesting account, with replay returning the saved receipt;
- expiry, supersession and epoch staleness;
- idempotent request and confirmation retries;
- non-enumeration, including the uniqueness recheck at commit;
- rate limits;
- no redispatch after a lost provider response; definite refusals and deferrals; old-notice failure isolation;
- cancel and undo;
- emergency revocation to zero keys;
- epoch-fenced sessions and in-flight sign-ins;
- stale and expired reviews and idempotent commits;
- kit rotation with save-before-rotation;
- pending change cancellation;
- revoke-before-erase with held unknown outcomes and bounded read-only reconciliation;
- no content-recovery claim;
- no model or customer-mailbox capability, and one platform sender;
- the data-class list;
- concurrent confirm, cancel and review transitions computed from one read: each claims the same prior revision, so exactly one commits, and the losers then refuse or change nothing.

Seven read-only agreement and static checks:

1. The source fresh-passkey window and passkey-only proof match `authority.ts`.
2. The recovery lookup is unchanged.
3. `users.email` still has no verification state, there is no `email_change` table and no profile edit path, and the decision 1/2 values are pinned. WH-201 updates this pin with its schema.
4. The inactive support-notice recipient (G-E5) is unchanged.
5. The module is pure: it imports only `../security` and its own files, makes no fetch, D1, env or console call, and an esbuild import graph of `src/index.ts`, `src/site-host.ts`, `src/app-host.ts` and `src/runtime/worker.ts` never reaches it. The reference imports only `node:crypto`.
6. The address rule is the WH-036 destination rule.
7. The SHA-256 shim used for mutant runs gives the same digests as `hashToken`.

The suite also runs against **33** deliberately broken copies, each of which must be caught by the check written for that property; `--explain` prints which check caught each and why. The original 32 are kept. Nineteen mutate the source (`policy.ts`, `change.ts`, `token.ts`, `compromise.ts`), including the new "stale session admitted to email operations". The fourteen that cover sign-in, recovery and the WH-203 compromise and revocation behaviour mutate the reference, because that behaviour has no source yet. Mutant runs use a `node:crypto` SHA-256 for `hashToken`, because Node's WebCrypto digest dominated the run time. The unmodified run uses the real WebCrypto path.

These checks prove the frozen contract, the WH-200 source module and the synthetic WH-203 reference only. They do not prove D1 atomicity, real delivery, provider revocation, devices or acceptance. No database, network, model, credential, Cloudflare resource or deployment is involved. All addresses use `example.test`, and all kit keys and tokens are `SYNTHETIC-*` placeholders.
