# Verified email changes and compromise response

**WH-063 contract slice (WH-199), October 9, 2026 UTC; source baseline `4dea09c`.** This is a **frozen contract**. It freezes how an owner changes the account email and how an owner responds to a suspected compromise, maps the current source with exact gaps, and splits the remaining [WH-063](roadmap/backlog.md#wh-063--define-verified-email-changes-and-compromised-account-recovery) work into WH-199–205.

**WH-200 status (October 9, 2026 UTC): implemented in source as a pure module, not wired.** The verified-address-change state machine and the confirmation-token handling are in [`src/email-change/`](../src/email-change/policy.ts) (see [section 2.1](#21-source-module-wh-200)). It is pure functions over plain records: no persistence, route, Chat binding, sender, provider, table or schema change, and no Worker entry imports it (an esbuild import-graph check proves this). Accounts still cannot change their address, and nothing is sent. The [conformance harness](../tests/email-change-contract.mjs) runs the source against a synthetic in-memory store, the synthetic mailer and the synthetic provider revoker.

**WH-203 status (October 9, 2026 UTC): implemented in source as a pure module, not wired.** The compromise review, the sign-in and recovery fences, and provider revocation with held unknown outcomes are in [`compromise.ts`](../src/email-change/compromise.ts) and [`revocation.ts`](../src/email-change/revocation.ts) (see [section 3.1](#31-source-module-wh-203)). Same limits as WH-200: no persistence, route, Chat binding, provider call, table or schema change, and no Worker entry imports it. Nobody can run a compromise review yet, and no provider is contacted. The offline prototype `tools/prototypes/compromise-review.mjs` has been deleted, so the source is the only implementation. The harness keeps a storage-only driver that makes no review, fence or revocation decision.

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
| [compromise.ts](../src/email-change/compromise.ts) | The WH-200 transitions: `pendingChangeForReview` for the review snapshot, and `closeForSecurityReview`, which cancels a pending change inside the review commit and does nothing on a replay. WH-203 added the rest of the review in the same file ([section 3.1](#31-source-module-wh-203)). |

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

WH-203 has since implemented the compromise review in source ([section 3.1](#31-source-module-wh-203)). Templates, the provider and the outbox are WH-202.

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

**Concurrent sign-in cannot restore authority.** A sign-in challenge issued before the commit, a session minted just before it, a restricted grant and a pending email-change token all carry the earlier epoch and fail afterward. A removed passkey cannot complete a sign-in. Only retained passkeys can sign in, at the new epoch. The source does both halves. It fences by epoch (`authorizeOwner`, `admitSignIn`), and the commit step tells the store to delete those rows in the same batch (`revokeAuthorityBefore`). The storage slice must also recheck the epoch inside committing statements, as the identity engine already does ([workspace identity](workspace-identity.md#versioned-operation-contract)).

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

### 3.1 Source module (WH-203)

Status: **implemented in source, not wired** (October 9, 2026 UTC). Like WH-200, every step takes the server-resolved principal and the rows the caller read. It returns the next rows, the notices to queue and the result, and stores nothing. The only adapter it calls is an injected `ProviderRevoker`.

| File | Contents |
| --- | --- |
| [compromise.ts](../src/email-change/compromise.ts) | `compromiseBounds` (10-minute review, 30-minute kit offer, the shared kit offer lifetime). `revokedAuthority`: sessions, grants, challenges and kit offers, the same rows the identity engine's own emergency removal deletes. `recoveryGrantOperations`. Closed parsers for prepare, kit offer, kit save and commit. `prepareCompromiseReview` returns the snapshot: active passkeys, session metadata (no token or hash), kit generation, the pending change and each connection's state, plus `accountRecoveryOnly: true`. `prepareReviewKit` and `saveReviewKit` handle the replacement kit offer bound to the review; the store keeps only the verifier, and the save is idempotent. `commitCompromiseReview` does the guarded commit described below. `admitSignIn` is the sign-in fence. `admitRecovery` treats the address as a lookup key and the kit as the proof. |
| [revocation.ts](../src/email-change/revocation.ts) | `ProviderConnection` records hold no credential material; `credentialHeld` says whether the store still keeps the ciphertext. The file also has `disableForReview`, `authorizeConnectionUse`, `dispatchRevocation` (one claimed attempt, one `ProviderRevoker` call), `reconcileRevocation`, `eraseConnectionCredential`, `closureHolds`, `revocationBounds` (3 reads in 72 hours) and `createSyntheticRevoker`. The synthetic revoker is for tests only: no network, no credential, and it recognizes only `github` and `cloudflare`. |
| [provider-revokers.ts](../src/email-change/provider-revokers.ts) | `createGitHubRevoker` and `createCloudflareRevoker`, the `ProviderRevoker` adapters over the existing revocation requests (section 3.1.1). Every effect is an injected seam: `transport` (the existing modules' `(url, init)` shape), `open` (the only place a held credential is decrypted; WH-201 supplies it) and `observe` (content-free events). Also `githubReconcileEvidence`, which reads saved grant receipts and never calls a provider. |
| [connection-holds.ts](../src/email-change/connection-holds.ts) | `githubConnectionHolds` and `cloudflareConnectionHolds` map current-schema rows onto `ProviderConnection` holds, one per held credential (`gh-<vault id>`, `cf-<vault id>`). `connectionClosureBlockers` and `closureInventoryConnectionHolds` say what blocks account closure. Read-only: no table, no write. |

The commit runs these checks in this order:

1. Fresh passkey on a current ordinary session.
2. Replay check. A saved receipt for the same request ID and payload is returned with no second effect; a changed payload is `REQUEST_CONFLICT`. The original session no longer works after the commit, so a lost reply is recovered by signing in again at the new epoch.
3. Staleness. The review must be open and unexpired, with an unchanged epoch, credential revision, kit generation and connection set; otherwise `STALE_REVIEW`.
4. Selections must be a subset of the snapshot.
5. A chosen kit must be this review's own offer, saved, unexpired and from the current epoch; otherwise `KIT_NOT_SAVED`.

It then returns:

- the account with the selected passkeys removed (no two-key minimum; zero keys means `recovering`), the epoch advanced, and the saved kit's verifier and generation;
- the review marked `committed` at `revision+1`;
- the pending change closed by `closeForSecurityReview`;
- the selected connections disabled with the credential held and revocation `queued`. A connection already queued, in flight, uncertain or unresolved is left as it is, so a second review never redispatches an unknown outcome;
- `revokeAuthorityBefore`, the new epoch;
- one content-free `security-review-completed` notice to the current address;
- the saved receipt.

The receipt carries only identifiers, counts and states. It has no content-recovery field.

Revocation follows the order in the previous section:

- **Dispatch.** The store commits the `dispatching` claim before the single provider call. `revoked` records the receipt and clears `credentialHeld` in the same write. `not-revoked` returns the hold to `queued` for the same retired credential. Anything else, including a throw, is `uncertain`. A record found still `dispatching` (a worker lost after its claim) becomes `uncertain` without a call.
- **Reconciliation.** It accepts only authenticated evidence, treats "not found" as no proof, and becomes `unresolved` after 3 reads or 72 hours.
- **Erasure and closure.** Erasure needs `revoked` plus a receipt. `closureHolds` lists every held credential that is queued, in flight, uncertain or unresolved.

Refinements of the WH-199 reference, none reachable by any customer, API or model:

- The kit save acknowledgment is recorded on the offer by `saveReviewKit`, as the [shared kit flow](identity-kits.md) does. The commit names only `rotateKit: {offerId}`; the reference's client-supplied `saved: true` is now an unknown field.
- The snapshot binding includes the kit generation, which the reference omitted. A kit offer must also come from the current epoch and be unexpired.
- The commit returns `revokeAuthorityBefore`, and the harness's store deletes the older sessions, grants, challenges and kit offers in the same batch. The reference only fenced them by epoch.
- `admitRecovery` refuses an address that another account holds reserved inside its undo window, with the same generic error. Under the reservation rule this cannot happen; the check keeps the lookup unambiguous even if that rule is ever broken.
- The `dataClasses` list moved to [policy.ts](../src/email-change/policy.ts). The `owner-security-reviews` class now names the kit offer verifier.

#### 3.1.1 Provider adapters and connection-state mapping (WH-203)

Status: **implemented in source, not wired** (October 9, 2026 UTC). No route, Worker entry, table or provider call uses them. The adapters import only `revocation.ts` and `policy.ts`. They do not import `src/github-connection.ts`, `src/cloudflare-connection.ts` or the connection vault, so the Worker import-graph check still covers the whole `src/email-change` directory.

Each adapter sends the same request the existing single-token cleaner sends. `tests/email-change-revokers.mjs` checks this by running the existing `cleanupGitHub` and `cleanupCloudflare` on the current schema through their own injected transport, then comparing URL, method, headers, body and redirect mode.

| Provider | Request | Outcome |
| --- | --- | --- |
| GitHub | `DELETE https://api.github.com/applications/{client_id}/token`, client Basic authentication, body `{access_token}`, `redirect: manual`, 10-second deadline | `revoked` only for an exact, non-redirected `204` when no refresh credential is held. With refresh custody, the same `204` is `access-revoked-refresh-held`, the same effect as cleanup's `access_revoked_at`. No call is sent for a token whose access revocation was already observed (`refresh-held`) or that a reviewed grant deletion is dispatching or holding as uncertain (`grant-pending`). The app-wide grant deletion is never sent: it needs the owner's separate reviewed consent. |
| Cloudflare | `POST https://dash.cloudflare.com/oauth2/revoke` once per known token (access, then refresh), form body `{token, token_type_hint}`, client Basic authentication | `revoked` only when every token gets an exact, non-redirected `200`. A transport loss stops the attempt, as in the existing cleaner. |

These rules apply to every outcome:

- **Unknown.** Any other status, a redirect, a throw, a timeout or a partial token set is `unknown` (or one of the GitHub hold outcomes above). The dispatcher records it as `uncertain` and never sends again.
- **Not revoked.** `not-revoked` means nothing was sent: the credential could not be opened, or it belongs to another app client. The retired credential then stays `queued`.
- **Stricter than cleanup.** The existing background cleaners retry a non-receipt reply under their claim lease. A compromise hold does not.
- **Content-free.** Errors and `observe` events never carry a token, client secret or authorization value.

`githubReconcileEvidence` is the only settling evidence for a held GitHub credential. It is a saved `github_grant_revocations` receipt in state `revoked` with `http_status` `204` for the same owner, app client and token. It returns `null` otherwise, and it never calls a provider. Cloudflare has no supported read that proves revocation, so its uncertain holds wait for the read bound.

| Current state (schema/platform.sql) | Hold |
| --- | --- |
| GitHub `active`, the connection's unexpired active token | access `active`, revocation `none` |
| GitHub `active`, any other token (staged or expired) | access `disabled`, revocation `none` |
| GitHub `revoking`, unexpired `github_revocation_claims` | `dispatching` |
| GitHub `revoking`, refresh custody with `access_revoked_at` | `uncertain` (only the reviewed grant deletion settles it) |
| GitHub `revoking`, otherwise | `queued` |
| Grant deletion naming the token: `dispatching` / `uncertain` / `revoked` | `dispatching` / `uncertain` / `revoked` with a reconciled receipt; `review` and `cancelled` change nothing |
| Cloudflare `active` / `staged` | revocation `none` (`active` access only while unexpired) |
| Cloudflare `revoking` with an unexpired `revoke_after` lease / otherwise | `dispatching` / `queued` |

Any other state is refused (`UNKNOWN_STATE`), and so is another owner's row (`FOREIGN_ROW`). For account closure, `connectionClosureBlockers` returns three lists: `closureHolds`, credentials still live (closure must queue them first) and unresolved `connection_oauth_exchanges`. `closureInventoryConnectionHolds` names the non-zero connection metrics of the existing [account-closure inventory](../tools/account-closure-inventory.mjs): `githubCredentials`, `cloudflareCredentials`, `githubRefreshCustody`, `githubGrantUncertain` and `unresolvedConnectionExchanges`. On SQLite with the current schema, the mapped holds equal the inventory's pending-revocation counts. Held and live credentials together equal its credential counts.

Obligations the module cannot meet alone, left to the storage and adapter slices (WH-201, then WH-204 for connected proof):

- Store reviews, review kit offers, saved receipts and connection revocation holds in current-schema tables (none exist; this change adds none). Write each commit in one revision-guarded batch, and repeat the epoch, fresh-passkey and review-binding predicates in the committing statements.
- Wire the adapters (WH-201):
  - Supply `open`, which reads the vault and custody rows and unseals the access token with the existing purpose strings.
  - Persist `access_revoked_at` after an `access-revoked-refresh-held` event, and erase both the vault row and the custody row only with a receipt.
  - Fence the compromise claim against the existing cleanup claims and grant dispatch, so one credential is never dispatched by two paths.
  - Schedule reconciliation. Today the read bound advances only on authenticated reads. A GitHub refresh hold that is waiting for the owner's reviewed grant deletion therefore stays `uncertain` until that receipt exists. After it becomes `unresolved`, a later receipt cannot settle it through `reconcileRevocation`; only an operator can.
- Read the mapping inputs from D1 and feed `connectionClosureBlockers` into account closure. The closure flow itself is not implemented.
- Mount direct Settings controls outside Chat, available while inference is down.
- Run focused SQLite/local D1 handler suites over the stored review and hold (WH-201), then connected synthetic acceptance on the actual Worker (WH-204).

## 4. Data classes and retention (WH-116 / WH-009 extension)

These are planned classes. WH-201 registers the real tables in [data-lifecycle.json](data-lifecycle.json). [policy.ts](../src/email-change/policy.ts) exports the same list as `dataClasses`, and the WH-200 and WH-203 records match it. A change row holds only the token's SHA-256 verifier. Limits are keyed by a hash of the address (`addressKey`). Queued notices hold no token.

| Class | Records | Protection | Proposed retention | Export |
| --- | --- | --- | --- | --- |
| `owner-email` (extends `owner-identity`) | Account address, verification time and sender | managed-readable | While the account exists; closure purge | Address and verified time |
| `owner-email-changes` | Pending change, token **verifier only**, previous-address undo reservation | managed-readable; SHA-256 verifier, never plaintext | Pending until confirmed/cancelled/superseded/stale/expired; terminal rows 30 days with the new address replaced by its hash; previous address until the undo window ends | Open pending address and expiry; never verifiers, request hashes or limit keys |
| `owner-email-change-limits` | Request times, hashed per-address daily keys, failure counts | managed-readable | 48 hours | None |
| `platform-notifications` (WH-156 shared outbox) | Content-free account notices | managed-readable; **no token stored** | 30 days; unknown/unresolved evidence until resolved | State and time |
| `owner-security-reviews` | Snapshot identifiers, selections, review kit offer verifier, commit receipt | managed-readable; SHA-256 kit offer verifier, otherwise identifiers and counts only | 90 days after commit or expiry | Time, selections, outcome |
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
| Emergency removal | `removePasskey` below two keys with epoch advance (`tests/identity-recovery.mjs`) | Conforms. **G-E7** **Resolved in source, not wired.** `commitCompromiseReview` in [compromise.ts](../src/email-change/compromise.ts) combines removal (down to zero keys), the epoch advance with the same `revokedAuthority` rows the engine deletes, kit rotation with save-before-rotation and change cancellation in one step (WH-203; agreement with `recovery.ts` and `kits.ts` is pinned by the harness). No route, table or Worker entry reaches it. |
| Kit rotation | `rotateKit` prepare/save/commit (`tests/identity-kits.mjs`, 47 checks) | Conforms; reused by the review. |
| Operator session revocation | WH-050 CLI, no epoch change | Conforms as a containment step; not a compromise review. |
| Provider revocation | GitHub disconnect, single-token cleanup and reviewed grant revocation (`tests/github-connection.mjs`, `github-token-lifecycle.mjs`, `github-grant-revocation.mjs`); Cloudflare RFC 7009 disconnect (`tests/cloudflare-connection.mjs`) | Conforms to revoke-before-erase. **G-E8** **Resolved in source, not wired.** One review selects any set of connections; [revocation.ts](../src/email-change/revocation.ts) disables them, holds the credential, dispatches once per claim, holds unknown and interrupted outcomes, reconciles read-only and reports `closureHolds` (WH-203). The `ProviderRevoker` adapters and the mapping of current connection states and closure-inventory metrics are in source too ([section 3.1.1](#311-provider-adapters-and-connection-state-mapping-wh-203)). `tests/email-change-revokers.mjs` checks them against the existing cleaners on the current schema. Nothing wires them, stores a hold or runs account closure. |
| Platform sender | `notify@whumpo.com`, Cloudflare adapter (`tests/contact-notifications.mjs`, `tests/notifications-contract.mjs`); not live | **G-E10** No account templates in the v1 catalog; the WH-036 live send is not done. |
| Security-event notices | None | **G-E11** No notices for passkey added/removed, recovery started/secured or kit rotated (runbook G5). |
| No model path | `agentProfile` excludes email (checked); identity routes outside Chat | Conforms. The WH-200 and WH-203 module has no model, agent, Chat or mailbox export, and no Worker entry imports it (checked). WH-201 must keep the agent catalogue free of these operations when it mounts them. |

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
| WH-203 | Compromise review: passkeys, sessions, kit, pending change and provider connections in one guarded commit (G-E7, G-E8). **Pure module, provider adapters and connection-state mapping done** ([section 3.1](#31-source-module-wh-203)). Open: the focused SQLite/local D1 handler suites with synthetic providers over stored reviews and holds, which need the WH-201 tables and wiring. | WH-200 |
| WH-204 | Connected synthetic acceptance: actual Worker, current schema, signed synthetic WebAuthn, synthetic mailer/providers, browser checks | WH-201, WH-203 |
| WH-205 | Physical-device and approved delivery canary acceptance on disposable identities | WH-202, WH-204, WH-005 (blocked) |

## 9. Verification

`node tests/email-change-contract.mjs` (also `pnpm test:email-change-contract`, and part of `node tools/verify.mjs fast`) bundles [`src/email-change`](../src/email-change/policy.ts) with esbuild and runs 27 checks. Every decision is made by the source: address changes, the compromise review, the sign-in and recovery fences, and provider revocation. The harness's storage-only driver stores the rows the source returns under revision guards. It deletes the authority rows a commit revokes. It also stands in for the existing identity engine only where WH-203 does not decide: issuing and resolving session and grant tokens, and the engine's own emergency passkey removal. The checks cover:

- the email never becomes a recovery or authorization factor (pending or verified address, wrong or missing kit, no email or link sign-in operation);
- refusal of unknown versions, unknown fields and retired password fields;
- fresh-passkey requirement;
- restricted recovery authority, including the compromise commit and connection use;
- delivery unavailable stores nothing, and the old-address notice carries no token or new address;
- hash-only single-use tokens bound to the requesting account, with replay returning the saved receipt;
- expiry, supersession and epoch staleness;
- idempotent request and confirmation retries;
- non-enumeration, including the uniqueness recheck at commit;
- rate limits;
- no redispatch after a lost provider response; definite refusals and deferrals; old-notice failure isolation;
- cancel and undo;
- emergency revocation to zero keys, after which a removed passkey cannot sign in;
- revocation of every session, grant, challenge and kit offer in the commit batch. Authority read before the commit and presented after it (a session, a grant or an in-flight sign-in challenge) is refused by the epoch fence;
- stale and expired reviews, a review bound to the kit generation and connection set, and idempotent commits;
- kit rotation with save-before-rotation and a kit offer bound to its own review;
- pending change cancellation;
- revoke-before-erase with held unknown outcomes and bounded read-only reconciliation. Also: a second review leaves an uncertain hold unqueued, an interrupted attempt becomes uncertain without a call, and an unresolved hold blocks account closure;
- no content-recovery claim;
- a content-free snapshot, receipt and security-review notice;
- no model or customer-mailbox capability, one platform sender, and a synthetic revoker that recognizes only the two existing providers;
- the data-class list;
- concurrent transitions computed from one read. For confirm, cancel and review, each claims the same prior revision, so exactly one commits and the losers then refuse or change nothing. For two compromise commits of one review, one commits and the loser is fenced or stale.

Nine read-only agreement and static checks:

1. The source fresh-passkey window and passkey-only proof match `authority.ts`.
2. The recovery lookup is unchanged.
3. `users.email` still has no verification state; there is no `email_change` or `security_review` table and no profile edit path; and the decision 1/2 values are pinned. WH-201 updates this pin with its schema.
4. The inactive support-notice recipient (G-E5) is unchanged.
5. G-E7: the review revokes the same rows (`identity_sessions`, `identity_grants`, `identity_challenges`, `identity_kit_offers`) that `removePasskey` in `recovery.ts` deletes. The engine allows zero keys (`recovering`), kit rotation in `kits.ts` advances the epoch, and the review and kit offer lifetimes are pinned.
6. G-E8: the existing adapters settle revocation only on an exact receipt (GitHub `DELETE` → `204`, Cloudflare `oauth2/revoke` → `200` for every token), and the reconciliation bound is pinned.
7. The module is pure. Every file in `src/email-change/` is listed and checked, including the WH-203 `provider-revokers.ts` and `connection-holds.ts`. It imports only `../security` and its own files and makes no fetch, D1, env or console call. An esbuild import graph of `src/index.ts`, `src/site-host.ts`, `src/app-host.ts` and `src/runtime/worker.ts` never reaches it.
8. The address rule is the WH-036 destination rule.
9. The SHA-256 shim used for mutant runs gives the same digests as `hashToken`.

The suite also runs against **41** deliberately broken copies. Each must be caught by the check written for that property; `--explain` prints which check caught each and why. All 41 mutate the source: `compromise.ts` 15, `change.ts` 11, `revocation.ts` 8, `policy.ts` 5 and `token.ts` 2. The 33 WH-200 mutants are kept. The 14 that targeted the deleted prototype now mutate the same rules in `compromise.ts` and `revocation.ts`, and are caught by the same named checks. Eight are new for WH-203:

- removed passkey completes sign-in;
- review not bound to the kit generation;
- kit offer bound to another review accepted;
- security-review notice not queued;
- second review requeues an uncertain revocation;
- interrupted revocation dispatch redispatched;
- reconciliation read bound removed;
- unresolved hold does not block account closure.

Mutant runs use a `node:crypto` SHA-256 for `hashToken`, because Node's WebCrypto digest dominated the run time. The unmodified run uses the real WebCrypto path. On this 2-vCPU host at load average 3.3, the whole run took 1.6–2.0 seconds wall over six runs, within the roughly 3-second budget of the deploy build's `verify fast`, so it stays in `fast`.

### 9.1 Provider adapters (WH-203)

`node tests/email-change-revokers.mjs` (also `pnpm test:email-change-revokers`) is a separate script. It is not part of any `verify` profile. It bundles `revocation.ts`, `provider-revokers.ts` and `connection-holds.ts` and drives them through the source dispatcher with a storage-only driver. Every transport is synthetic and every credential is a `SYNTHETIC-<KIND>-<NNNN>` canary. It has nine checks:

- the GitHub receipt rule: exact request shape, other statuses, redirects, and nothing sent for another provider, another app client or an unreadable credential;
- a GitHub single-token `204` never settles a retained refresh credential or the grant, and no call is made after an observed access revocation or during a pending grant deletion;
- the Cloudflare `200`-for-every-token rule, including partial sets and transport loss;
- timeouts, lost responses, unexpected statuses and redirects are held as `uncertain` and never resent, including after a second review or an interrupted claim;
- reconciliation is read-only and accepts only the exact saved grant receipt;
- a credential is erased only with an exact receipt;
- the state mapping, including refusal of unknown states and foreign rows;
- the closure blockers and inventory metrics;
- no canary (token, client secret or Basic credential) in any event, error or stored record.

Five agreement and static checks follow:

1. On a fresh in-memory SQLite database with the current schema, the existing `cleanupGitHub` sends the same request as the GitHub adapter. Their receipt decisions agree for `204`, `200`, `404` and `500`, and for refresh custody (`access_revoked_at` recorded, credential kept, no second call).
2. The same for `cleanupCloudflare` and the Cloudflare adapter, for `200/200`, `200/400` and `204/200`.
3. The mapping of rows read from that database agrees with `accountClosureInventory`.
4. The mapped state lists equal the schema's `CHECK` lists.
5. The new files import only `./policy` and `./revocation` and are listed in the contract harness's purity and graph check.

The suite also runs against **22** deliberately broken copies of the two new files, each caught by its named check (`--explain`). On October 9, 2026 UTC it took 1.3–2.0 seconds wall at load average 7 to 9.

These checks prove the frozen contract and the unwired WH-200/WH-203 source module only. They do not prove D1 atomicity, real delivery, real provider revocation, devices or acceptance. No database, network, model, credential, Cloudflare resource or deployment is involved. All addresses use `example.test`. All kit keys, tokens and ciphertext handles are `SYNTHETIC-*` placeholders or random values generated during the run.
