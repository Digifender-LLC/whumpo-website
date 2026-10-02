# Current identity transport and trusted web flow

**WH-114C [#72](https://github.com/zemdregon/whumpo/issues/72) / WH-115 [#69](https://github.com/zemdregon/whumpo/issues/69), October 1, 2026. Integrated into the current source route tree and verified locally; not deployed.** The shared backend remains the only implementation of ceremonies, kits and recovery effects. HTTP, Chat and provider admission now carry the current principal. The complete schema, lifecycle catalog and bounded cleanup are connected. Current-schema release/reset delivery, remaining platform fixture updates and deployed/owner-device acceptance are still open.

## Browser transport

`src/workspace-identity/http.ts` handles the reserved `/api/auth/identity/v1/` namespace. Every endpoint is an exact-origin POST with bounded JSON (72 KiB, including streamed bodies), the current protocol version and no query string. State/config reads use the API rate limiter; proof/effect requests also use the existing authentication limiter. This avoids spending the proof budget on every progress refresh. Responses, including refusals and the one-time kit response, use `no-store`, `nosniff` and `no-referrer`. Unexpected provider/SQL errors are replaced with a generic unavailable response and never logged here.

| Credential | Cookie | Scope / behavior |
| --- | --- | --- |
| Ordinary session | `__Host-whumpo_session` | Host-only, Secure, HttpOnly, Path=/, SameSite=Lax. Lax permits the reviewed top-level OAuth return; POST effects still require exact Origin. |
| Enrollment/recovery grant | `__Secure-whumpo_identity_grant` | Host-only, Secure, HttpOnly, Path=/api/auth/identity/, SameSite=Strict. Never selected by workspace admission. |
| One-use challenge | `__Secure-whumpo_identity_challenge` | Same restricted path and Strict policy, five-minute expiry; removed from the browser on verification replies, including failures. |

Cookie expiry uses the authority's absolute deadline; changing transport never refreshes proof time or extends lifetime. Secure remains required on the explicit localhost test origin. Cookie prefix, host, path and SameSite choices follow the [current browser cookie contract](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

The identity router selects exactly one present session/grant cookie. Duplicate cookies, malformed credentials and simultaneous session/grant credentials fail; an invalid presented grant never falls through to a valid session. Issuing either authority clears the other kind. A missing current cookie produces anonymous state; a stale cookie produces a proof refusal. No old cookie, password or recovery-code reader exists in this adapter. `workspaceIdentity` selects only the current ordinary session and returns the shared server principal for later admission composition; this helper alone does not guard a downstream write.

Tokens, token hashes, principals and private challenge tokens never enter browser JSON. WebAuthn public options are returned normally. The state DTO contains owned email/key inventory, purpose, semantic review identifiers, kit metadata, readiness and expiry. It is not an authorization capability. Final bound reads reject concurrent semantic changes. Logout revokes the selected authority and its outstanding bound challenges, then clears all current identity cookies. Completion, removal and cancellation update cookies explicitly.

## Trusted React flow

`frontend/src/identity/flow.tsx` provides `IdentityGate` and `IdentitySecurity`. They share one controller so a security-panel sign-out immediately closes the workspace gate. The gate waits for the minimal identity-state response before rendering workspace children. Pending signup and recovery render only deterministic account controls; they never call profile, welcome, project or Chat APIs. The existing first-project welcome gate is still required inside the workspace after identity completion.

- Signup always asks for invitation, US eligibility and Turnstile, including the local fixture. The first passkey saves restricted progress; two distinct keys, one saved kit and a current assertion are required to finish.
- A saved passkey resumes pending progress. Optional help explains synced copies, another provider/security key, interrupted ceremonies and the unrecoverable first-key-loss case before kit activation. There is no password button.
- Recovery asks for the current kit, exact all/some/none loss review and a saved replacement kit before the explicit secure confirmation. Secured recovery requires new replacement enrollment and the dedicated replacement-only completion assertion. A retained passkey never silently finishes recovery.
- Account security supports reviewed key addition/removal and kit replacement. Removal warns that all sessions end, including the last-key consequence. A current passkey assertion precedes sensitive changes, and changed review state requires review again.
- Uncertain responses direct the user to saved progress; the client does not retry ceremonies automatically. The saved new kit can resume a committed secure step even when its reply/cookie was lost. Authenticated cancellation deletes pending setup and preserves spent invitation state.

## Kit delivery and privacy

`frontend/src/identity/kit.tsx` offers plain-text download, clipboard copy, and a local printer-friendly iframe using the browser's Print / Save as PDF dialog. It inserts document text with `textContent`; no popup URL, remote PDF service, HTML interpretation or new dependency is involved. The filename is always `whumpo-recovery-kit.txt`. Print is optional; the single save acknowledgment states that it is not proof of backup storage.

Plaintext stays in component memory only for the returned offer. Saving, supersession, exit and unmount discard it. A lifetime guard prevents a late preparation reply from restoring a secret after page exit. Download object URLs are revoked; the print iframe is removed after printing or unmount. The key input is cleared on submission. The API helper bypasses shared query caches, uses no-store fetches and makes no local/session storage or telemetry writes. Explicit clipboard, downloaded and printed copies belong to the user's backup workflow. No key is placed in a URL, filename, Chat message or screenshot. Test screenshots use disposable synthetic accounts after secrets have been cleared.

## Verification and remaining cutover

- `node tests/identity-http.mjs` and `node tests/identity-http.mjs --d1`: actual platform handler/backend/complete current schema with independently signed ES256 credentials. Thirty-six refusal checks cover version/origin/method/body/query limits, cookie ambiguity, stale/retired tokens, restricted workspace access, rate separation and replay, plus complete enrollment, lost secure-reply resumption, recovery completion, rotation, cancellation, removal and server-side logout revocation. Response checks reject bearer/principal/verifier leakage.
- `node tests/identity-browser.mjs --d1`: disposable local D1 plus Chromium virtual authenticators and the actual React/HTTP flow. Mobile signup, cancelled second prompt without lost progress, separate passkeys, kit download/copy/print equality, reload/resumption, partial recovery after an intentionally lost secure reply, replacement-only completion, removal/sign-out, keyboard confirmation, cookie privacy and empty persistent browser storage pass. Mobile/desktop screenshots were inspected. Turnstile and one cancelled browser prompt are synthetic; successful WebAuthn and the verifier are real. No physical-device, real Turnstile, OS print dialog, native app or deployed acceptance is claimed.
- `pnpm check`, production build and roadmap checks apply to this source packet. Existing core backend behavior is unchanged.

The fixture entry is outside the production route tree. Neither `src/index.ts` nor the production workspace imports the adapter/gate yet. #72 must replace retired routes and cookies together with common committing admission, lifecycle/export/erasure/cleanup registration and the current schema reset. Do not deploy this schema or mount only this router as a parallel policy. #69/#68/#72 remain open until connected cutover evidence is recorded; actual owner/device acceptance remains separate.

## Workspace admission integration — October 1, 2026

`src/index.ts` now installs the versioned identity router and resolves only the current ordinary cookie before workspace access. Password routes, old session/recovery readers and the old owner-auth frontend/module are removed. `IdentityGate` precedes the actual profile query and first-project welcome. Profile no longer exposes password settings. Provider connection and sensitive Chat controls request an actual fresh passkey assertion.

`admitWorkspace` in `src/workspace-identity/admission.ts` passes the same server capability through domain helpers. Each prepared statement or batch runs with an identity assertion in the **same D1 transaction**. Its always-empty assertion table aborts the entire batch after session/epoch/purpose/proof-age loss. A failed precondition cannot leave a later unconditional statement committed. Callers retain their exact resource, feature, consent and review predicates. A raw DB, forged/cloned principal, another owner's ID or foreign prepared statement cannot acquire this scope. No generic raw-database escape is exposed.

Feature predicates now compose the current principal. OAuth states bind the initiating authority ID; a different current session cannot complete that flow. Exact uncertain-backup/DNS reconciliation can survive lost plan inclusion, but still requires current identity and current provider consent. Storage/service bindings and Chat inference/provider transports recheck before dispatch; local persistence rechecks at commit. Scheduled cleanup uses its own bounded system path.

One narrow OAuth-custody capability survives revocation: it can remember and retire only the credential returned by its already-claimed flow. It cannot activate credentials, read unrelated tokens or send provider work. Activation remains session/feature/flow guarded. If sign-out happens during exchange, encrypted cleanup survives and the scheduled owner-scoped revoker can finish. Already-sent external writes retain their dispatched/uncertain receipt; they are never automatically resent to repair an interrupted reply.

The client closes workspace access on current identity refusal, clears cached account data, fences late replies by client generation and stops Chat recovery persistence before old mutation callbacks settle. Account/epoch changes remount the workspace. An ordinary same-session reload preserves the account-bound unsent draft.

### Current source verification

- `tests/identity-http.mjs` passes 36 refusal cases plus complete signed enrollment/recovery/rotation/removal through the actual Worker handler and complete schema, on SQLite and local D1.
- `tests/workspace-admission.mjs` passes 21 checks on both engines, including revocation immediately before real batch admission, no partial commit, actual HTTP project creation, Chat refusal, proof age, epoch and no post-revocation transport send.
- `tests/feature-admission.mjs` passes 37 refusal cases on both engines. Actual HTTP/Chat/OAuth adapters, feature loss during asynchronous work, exact review/dispatch, read-only recovery, revoked callback custody and scheduled cleanup use synthetic transports only.
- `tests/workspace-identity-browser.mjs --d1` passes the real mobile app entry with Chromium WebAuthn: two keys, one-time kit, identity-before-profile, first-project welcome, current Chat, draft reload, and workspace closure with no new Chat turn after revocation. This does not establish physical-device acceptance.
- Lifecycle validation covers all 156 current tables in 37 classes using metadata only. Expired identity records have bounded scheduled cleanup; verified pending enrollment/recovery is retained.
- Service-client compiler **v3** replaces v2 in the current catalog because password utility removal changed a pinned dependency. Its new immutable lock and independent reproduction test pass; old manifests cannot acquire current compiler authority.

### Remaining coordinated cutover

The target schema is composed from `src/workspace-identity/canonical-inputs.sql`, `schema/platform.sql` and `src/workspace-identity/schema.sql` by `tools/current-schema.mjs`. It contains no retired workspace-auth tables. This is an empty-database target, not a compatibility conversion. The numbered release delivery and remaining older test fixtures still need alignment before release. Do not deploy this source against the old remote schema. Review/reset affected test identities and dependencies, preserve separately registered platform services/secrets, fence old in-flight work, and verify all current Workers together. No remote schema, provider registration, owner passkey or live deployment changed in this integration.
