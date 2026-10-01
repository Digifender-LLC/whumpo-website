# Current identity transport and trusted web flow

**WH-114C [#72](https://github.com/zemdregon/whumpo/issues/72) / WH-115 [#69](https://github.com/zemdregon/whumpo/issues/69), October 1, 2026. Implemented and verified against the isolated current schema. Not installed in the deployed platform route tree.** The [shared backend](identity-recovery.md) remains the only implementation of ceremonies, kits and recovery effects. The coordinated current-policy switch still needs common HTTP/Chat/provider admission, lifecycle registration, the test reset and deployed acceptance.

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

- `node tests/identity-http.mjs` and `node tests/identity-http.mjs --d1`: actual adapter/backend/schema with independently signed ES256 credentials. Twenty-two refusal checks cover version/origin/method/body/query limits, cookie ambiguity, stale/retired tokens, restricted workspace access, rate separation and replay, plus complete enrollment, lost secure-reply resumption, recovery completion, rotation, cancellation, removal and server-side logout revocation. Response checks reject bearer/principal/verifier leakage.
- `node tests/identity-browser.mjs --d1`: disposable local D1 plus Chromium virtual authenticators and the actual React/HTTP flow. Mobile signup, cancelled second prompt without lost progress, separate passkeys, kit download/copy/print equality, reload/resumption, partial recovery after an intentionally lost secure reply, replacement-only completion, removal/sign-out, keyboard confirmation, cookie privacy and empty persistent browser storage pass. Mobile/desktop screenshots were inspected. Turnstile and one cancelled browser prompt are synthetic; successful WebAuthn and the verifier are real. No physical-device, real Turnstile, OS print dialog, native app or deployed acceptance is claimed.
- `pnpm check`, production build and roadmap checks apply to this source packet. Existing core backend behavior is unchanged.

The fixture entry is outside the production route tree. Neither `src/index.ts` nor the production workspace imports the adapter/gate yet. #72 must replace retired routes and cookies together with common committing admission, lifecycle/export/erasure/cleanup registration and the current schema reset. Do not deploy this schema or mount only this router as a parallel policy. #69/#68/#72 remain open until connected cutover evidence is recorded; actual owner/device acceptance remains separate.
