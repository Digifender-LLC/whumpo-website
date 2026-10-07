# Android identity and browser returns (WH-083)

**October 7, 2026 — implemented and tested in source; no deployment or signed-device acceptance.** The nine identity/config endpoints in [the current mobile contract](mobile-api-v1.md#identity-and-session-wh-083--implemented-in-source) run through `src/mobile/http.ts`. They reuse the existing account, credential, session, challenge, recovery and commit authority. Other mobile workspace, photo and push endpoints remain closed pending WH-084–086.

The current API requires build 2 or newer and returns the authoritative opaque account UUID in `GET /session` with a masked label. Local private state is keyed by that UUID, never a label or token. This corrects the initial frozen contract directly; there is no old-client reader or compatibility protocol.

## Shared authority

Android login and reauthentication use the existing WebAuthn signature verifier with user verification, RP `whumpo.com`, exact configured Android signing origin, challenge kind/client/expiry, credential counter and current account revision. Challenges are single-use, including unsuccessful assertions. A native challenge ID is an opaque UUID; browser ceremonies continue using their dedicated secure challenge cookie. The native bearer is a random 256-bit token stored only as a hash in D1.

An enrolling or recovering account receives no Android session or restricted grant. The shared ready-account resolver and transaction predicate enforce epoch, active credential, completion and session expiry. Native and browser sessions share the ten-session cap. Account recovery/epoch changes, credential removal and logout apply through the same authority tables. Reauthentication changes the authenticated credential and actual proof time while preserving the native bearer and original absolute expiry. It never silently renews the seven-day lifetime.

Mobile admission rejects Cookie and Origin headers. The native bearer is refused on non-mobile paths. Browser mutations retain the existing exact Origin check. The native router admits only the closed identity route set, validates a bounded current-version capability header and JSON envelope, applies address and session rate limits, and returns sanitized no-store errors. It never proxies arbitrary paths or invokes inference/providers.

## Browser return

The app creates a random state and PKCE verifier, saves them in protected local storage, and submits only the S256 challenge with the exact return URI `https://whumpo.com/app/return`. The server supplies a five-minute browser path. The trusted page directs the owner to the existing sign-in/signup/recovery flow; the owner returns to explicitly check and confirm the account. Browser reads and completion are POST requests authenticated by the ordinary web cookie and exact Origin. They bind the current account, browser session and epoch before showing the masked identity. Switching accounts or replacing/revoking that source session requires a new return flow.

The verified App Link contains exactly `handoffId` and a one-time code, expiring within sixty seconds. The app checks its persisted handoff ID, then exchanges the code with the original state and verifier. D1 stores hashes of the browser token, state and code, never their original values or the verifier. Exchange consumes the code and issues the session in one guarded transaction; it repeats source browser session, ready stage, epoch, signing origin and expiry checks. Its session preserves the browser proof time and expires no later than that source. A stale browser proof stays stale.

`/app/return` serves an isolated no-store/no-script page when no associated app opens it. Neither that page nor the completion page loads customer content or third-party assets. Native bearer material never enters a browser, URL or provider request. Losing the one-time response requires starting a new flow rather than regenerating or replaying authentication effects.

## Association and activation

These non-secret server settings are deliberately unset by this change:

| Setting | Exact meaning |
| --- | --- |
| `MOBILE_ANDROID_PACKAGE` | Approved application package identity; no provisional/debug fallback. |
| `MOBILE_ANDROID_CERT_SHA256` | Approved app-signing certificate SHA-256 fingerprint, 32 uppercase hex byte pairs separated by colons. The native WebAuthn origin is derived from these bytes. |
| `MOBILE_MINIMUM_BUILD` | Positive current minimum version code, default `2`; raise it to retire a build explicitly. |

Without the package and certificate, native issuance/verification/exchange remains unavailable and `/.well-known/assetlinks.json` returns 404. Configured Digital Asset Links declares only `common.handle_all_urls` and `common.get_login_creds` for the exact package/certificate. Configuring values does not prove domain association, signing custody, Play acceptance or a physical passkey journey. Server settings must match the approved release identity; do not install a debug signing identity on the deployed platform.

The schema adds the current `mobile_identity_handoffs` table and Android session/challenge constraints. `tools/current-schema.mjs` composes it directly; this needs the repository's reviewed empty-database cutover, not migration replay or automatic `deploy ci`. No remote operation ran for this work. The lifecycle catalog excludes return material from exports and model context. Start and the existing hourly/daily identity maintenance remove at most 500 expired handoffs per pass. Expiry denies authority at five minutes even before erasure; account/source-session deletion cascades bound rows. Restore admission rejects any native session, challenge or handoff until a reviewed scrub discards it and new passkey access is established.

## Verification

Passed against this source on October 7, 2026:

- `node tests/mobile-identity.mjs` and `node tests/mobile-identity.mjs --d1`: actual Worker routes, independently signed synthetic ES256 assertions, full web two-passkey/kit completion, two-owner isolation, wrong origin/RP/signature/UV, replay/expiry, PKCE/state/redirect/account mismatch, source-session and epoch races, stale proof, stable-bearer reauthentication and unchanged absolute expiry, cookie/Origin separation, shared revocation and account deletion. These are disposable database tests, not physical devices.
- Existing `identity-ceremonies`, `identity-recovery`, `identity-authority`, `identity-http`, `workspace-admission` and `onboarding-welcome` suites on SQLite; the mobile contract fixture suite; `pnpm check` using `--config.verifyDepsBeforeRun=false` for the shared worktree installation.
- Lifecycle and isolated restore tests cover the newly registered storage and restore refusal. Android client/toolchain evidence belongs to [android-build](android-build.md).

External gates remain: approved package and signing custody/fingerprint; installed Digital Asset Links verification; Credential Manager behavior and user verification on approved physical devices; actual signup/recovery/browser/App Link return under device process death; emulator/UI/accessibility and signed-upgrade evidence; and the separately gated native workspace, photos, push and beta-admission journeys. Synthetic signatures establish server verification behavior only.
