# Passkey-backed encryption feasibility

**WH-118 planned evaluation, October 8, 2026 UTC, against source `ca17c6a` (rebased October 9 onto `92a001f`; the intervening merges #175, #178 and #180 changed no identity, passkey or schema source). This is not an adopted design.** It records a dated capability review, a candidate design, a synthetic emulation and the adoption criteria still to be tested. No physical device, browser, passkey provider, security key or hybrid transport was tested. No source behavior, schema, lifecycle classification, encryption key, prompt or customer promise changes here. WH-118 remains open until the owner decides with real-device evidence.

Read with the [identity and data protection contract](roadmap/identity-and-data-protection.md), [workspace identity](workspace-identity.md), [restricted recovery](identity-recovery.md), the [WH-116 protection decision](data-protection.md) and [inference privacy](inference-privacy.md).

## Result in brief

- **Recommendation: no adoption for the beta, the commercial MVP or any default.** Keep the transparent WH-116/117 baseline. Passkey-backed encryption may become an *opt-in sealed class* only if the real-device matrix meets every criterion in [adoption criteria](#adoption-and-no-adoption-criteria) and the owner accepts the [open decisions](#open-owner-decisions).
- Ordinary passkey sign-in yields no encryption key. A key exists only if the relying party asks for the WebAuthn `prf` extension, the browser and authenticator support it, and the user completes a user-verified ceremony. Whumpo's current ceremony options (`src/workspace-identity/ceremonies.ts`) request no extensions, so today's sign-ins produce no PRF output at all.
- Official support is real but uneven and partly contradictory, especially for Safari/iOS assertions, Windows Hello and Firefox for Android ([capability review](#capability-review--checked-october-8-2026-utc)).
- The candidate design keeps PRF outputs and content keys on the client and works in the synthetic proof. It still needs a second saved secret for lost-all-keys content recovery, and rotation needs every remaining key present.
- Sealed content cannot be read by AI maintenance, safety checks, search, publication, image processing or background jobs. Whumpo has no admitted data class that is useful without those features.
- WH-048, WH-049 and ordinary account access do not depend on any of this.

## Capability review — checked October 8, 2026 UTC

Sources were fetched live with the Firecrawl MCP (`maxAge: 0`) and, for MDN compatibility data, the raw [browser-compat-data](https://github.com/mdn/browser-compat-data) JSON. "Unverified" means no official source confirmed the claim. Support tables are not device evidence.

### Standard and API behavior

| Fact | Source |
| --- | --- |
| WebAuthn Level 3 is a W3C **Recommendation** dated 25 August 2026. | [W3C WebAuthn L3](https://www.w3.org/TR/webauthn-3/) |
| `prf` is both a registration and an authentication client extension, modeled on CTAP2 `hmac-secret`. The client hashes inputs as `SHA-256("WebAuthn PRF" ‖ 0x00 ‖ input)`, so a site cannot evaluate the raw platform PRF. Only the user-verified `hmac-secret` PRF is exposed. | [W3C prf extension](https://www.w3.org/TR/webauthn-3/#prf-extension) |
| At registration, `prf: {}` returns `enabled`. Results "may not be available during registration", in which case an assertion is needed. `enabled` is absent on authentication, and an unsupported authenticator returns `prf: {}`. | W3C (above); [MDN WebAuthn extensions](https://developer.mozilla.org/en-US/docs/Web/API/Web_Authentication_API/WebAuthn_extensions) (last modified September 17, 2026) |
| `evalByCredential` works only when `allowCredentials` is non-empty. | W3C (above) |
| The spec notes that client-side key use may require omitting `results` before sending a credential to a server, and that **`PublicKeyCredential.toJSON()` includes `results`**. | W3C (above) |
| Multi-device (backup-eligible) versus single-device credentials are a permanent credential property. Backup state can change over time. | W3C (above) |

Three Whumpo-specific consequences follow. First, owner sign-in is usernameless: `loginOptions` sends no `allowCredentials`. Unlocking during sign-in therefore uses one RP-wide `eval.first` input, not per-credential random inputs. The spec's protection against an attacker with temporary authenticator access holds only for unpredictable inputs, so it is weaker at sign-in. Reauthentication does send `allowCredentials` and could use `evalByCredential`. Second, Whumpo already requires user verification, which `prf` needs. Third, `@simplewebauthn/browser` 14 forwards `getClientExtensionResults()` unchanged. ArrayBuffers serialize to `{}`, but typed arrays and `toJSON()` strings serialize the actual bytes. An implementation must allowlist the payload and must not rely on how a library happens to serialize it.

### Browser and platform support

MDN browser-compat-data `api.CredentialsContainer.{create,get}.publicKey_option.extensions.prf`, fetched October 8, 2026:

| Browser | `create()` with prf | `get()` with prf |
| --- | --- | --- |
| Chrome / Edge (desktop and Android) | 116 | 116 |
| Opera / Samsung Internet | Chrome mirror; MDN page shows Opera 102 and Samsung 24 | Same |
| Firefox desktop | 139; 135–138 partial ("Not supported on macOS") | 139 |
| Firefox for Android | 149 | **No** ([bug 1958716](https://bugzil.la/1958716)) |
| Safari macOS / iOS | 18 | **No** ([WebKit 259934](https://webkit.org/b/259934)) |
| Android WebView | No | No |
| iOS WebView | 18 (mirror) | No (mirror) |

The sources conflict. The [WebKit Safari 18.0 notes](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/) (September 16, 2024) say Safari 18 "adds support for the WebAuthn `prf` extension" for "retrieving a symmetric key from a passkey". The [Safari 26.4 notes](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/) (March 24, 2026) add PRF "during both credential creation and authentication flows with security keys". WebKit bug 259934 is RESOLVED FIXED, but a January 8, 2026 comment reports a Safari Technology Preview crash on a security-key PRF signup. Safari/iOS assertion-time PRF is therefore **unverified/conflicting** for both iCloud Keychain and security keys. [Firefox 139 developer notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/139) (May 27, 2025) say `prf` "is supported on all desktop platforms". The [Chrome Platform Status entry](https://chromestatus.com/feature/5138422207348736) rendered no milestones through the fetch, so Chrome 116 rests on browser-compat-data alone.

### Providers, authenticators and transports

| Provider or path | Evidence | Status |
| --- | --- | --- |
| iCloud Keychain (Apple passkeys) | The Safari 18 notes imply platform passkeys. [Apple `ASAuthorizationPublicKeyCredentialPRFAssertionInput`](https://developer.apple.com/documentation/authenticationservices/asauthorizationpublickeycredentialprfassertioninput-swift.struct) exists for native apps (search excerpt only; OS version not captured). Yubico (mid-2025) lists iCloud Keychain as supported on macOS 15+/iOS 18+. | Partly documented; Safari `get()` conflict; **unverified on devices** |
| Google Password Manager / Android Credential Manager | Google's [supported environments](https://developers.google.com/identity/passkeys/supported-environments) page (last updated May 19, 2025) contained no PRF statement in the fetch. The [Yubico guide](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html) and third-party blogs claim GPM passkeys support PRF. Credential Manager pass-through for native apps was not found. | **Unverified** from official Google sources |
| Windows Hello | Yubico (mid-2025): "Windows Hello lacks hmac-secret". A [Microsoft Q&A answer](https://learn.microsoft.com/en-gb/answers/questions/2286384/windows-hello-support-for-webauthn-prf-extension) says no timeline was announced. A third-party vendor blog claims a February 2026 Windows 11 24H2/25H2 update added it; no Microsoft source was found. | **Unverified** |
| 1Password | [Official blog, July 18, 2024](https://1password.com/blog/encrypt-data-saved-passkeys): PRF in Android beta 8.10.38 and browser-extension beta 2.26.1, with iOS 18 planned. The iOS 8.10.74 release notes (search excerpt) add PRF for iOS 18. A community thread reports non-compliant extension PRF in Chrome/Firefox. | Documented in betas/releases; current behavior **unverified** |
| Bitwarden (as a relying party) | [Help: log in with passkeys](https://bitwarden.com/help/login-with-passkeys/): browser and authenticator must both be PRF-capable; macOS needs a Chromium browser; up to five passkeys; a non-PRF or lost passkey falls back to the master password. | A useful precedent: its vault recovery relies on a separate secret |
| Bitwarden / other providers as authenticators | No official statement found. | **Unverified** |
| Security keys (`hmac-secret`) | Yubico (mid-2025): Windows Chrome/Edge/Firefox yes; macOS Chrome yes, Safari no (since superseded by Safari 26.4); iOS no ("Platform does not pass extension data to/from external keys"); Android USB yes, NFC no. | Vendor-documented; per-model behavior **unverified** |
| Hybrid / cross-device (phone as authenticator) | No official source found. | **Unverified** |
| Conditional mediation (passkey autofill) with PRF | No source found. | **Unverified** |
| Credential import/export (FIDO credential exchange) | Whether exported/imported passkeys keep the same PRF secret: no source found. | **Unverified** |

### Synced versus device-bound credentials

PRF belongs to the credential. When a provider syncs a multi-device credential, every synced copy should produce the same PRF output, so a synced passkey would unlock on each signed-in device. The spec implies this, but it was not observed on any provider. It also means a provider-account loss or provider reset removes every copy at once. A single-device credential, such as a security key, loses its PRF with the device. Two credential IDs do not prove independent recovery paths ([workspace identity](workspace-identity.md#signup-and-resumption)). A credential whose provider does not return PRF can still be used for ordinary sign-in but cannot unlock sealed content.

## Candidate design

The [synthetic prototype](../tools/prototypes/passkey-key-wrapping.mjs) implements the design below with WebCrypto AES-256-GCM and HKDF-SHA-256. It is labeled emulation, not production code.

### Keys and stored records

| Item | Created by | Held by | Server sees |
| --- | --- | --- | --- |
| Content key (CK), 256-bit random | Client | Client memory while unlocked | Never |
| PRF output per credential | Authenticator, during a user-verified assertion | Client memory only | Never; removed from the authentication payload and rejected if present |
| Credential wrapping key | Client: `HKDF(PRF output, random salt, "whumpo:passkey-content-kek:v1")` | Not stored | Only the random salt |
| Wrapped CK per credential | Client: AES-GCM with AAD `[wrap, version, account, keyset, generation, credential]` | Server record | An opaque 48-byte blob, IV and salt |
| Content recovery key (CRK), 256-bit random | Client | The customer's own saved copy, separate from the account kit | Never; its wrap of CK is opaque |
| Key commitment | Client: HMAC over account/keyset/generation under a CK-derived key | Server record | A 32-byte tag that detects a wrong or substituted CK without revealing it |
| Sealed content | Client: AES-GCM with AAD `[content, version, account, keyset, generation, object]` | Server storage | Ciphertext plus readable metadata: IDs, sizes, timing, generation |

### Operations

1. **Normal sign-in unlock.** Login options add `extensions.prf.eval.first = SHA-256("whumpo/passkey-content-unlock/v1")`. That is one prompt, the existing sign-in. The client reads the PRF output and sends an allowlisted payload with `clientExtensionResults: {}`. The server verifies it unchanged and rejects any payload that carries `prf`. After the session exists, the client fetches the opaque keyset record and unwraps CK locally. If PRF is unavailable, the account still signs in and sealed content stays locked. There is no fallback key.
2. **Keeping the unlocked key.** Keeping CK only in memory means a new prompt on every reload or new tab, which conflicts with the policy of no repeated prompts. A non-extractable `CryptoKey` in IndexedDB until sign-out avoids those prompts but lets code running in the origin use the key. This is [owner decision D4](#open-owner-decisions).
3. **Second-key enrollment.** Register with `prf: {}`. If `enabled` is false, the credential cannot seal. If no results arrive at registration, one extra assertion is needed. An unlocked client then wraps the same CK for the new credential. Two keys from one synced provider still share one failure domain.
4. **Lost all keys.** WH-115 account recovery restores account access only. The replacement passkeys get no content access. With the separately saved CRK, the client unwraps CK and enrolls the replacement credentials. Without the CRK, sealed content is permanently unreadable. No support, server, operator or account-kit path exists, and none may be added.
5. **Revocation.** Removing a credential's wrap stops future unlocks through the current record. It cannot take back a CK the holder already unlocked, or an older record copy.
6. **Rotation.** Generate a new CK and generation, re-encrypt sealed objects and re-wrap CK for each credential that should keep access. Symmetric wrapping needs a fresh PRF output from each remaining credential, so every remaining key must be present. Absent credentials become `pending` and need an unlocked client to re-enroll them. Unless the customer enters the current CRK, rotation issues a new one that must be saved again. Clients keep the highest generation they have seen and refuse older records.
   - An alternative is X25519 public-key wrapping, with the private key derived from the PRF output. It can rotate without the keys present and without reissuing the CRK. It then needs a CK-authenticated recipient directory so the server cannot substitute its own public key. WebCrypto X25519 support per browser-compat-data: Chrome 133, Firefox 130, Safari 17. This alternative is not prototyped.
7. **Export.** Only an unlocked client can produce readable export. A server export contains ciphertext and the opaque record.
8. **Account closure.** Deleting live records does not erase retained backups, downloaded copies or exports. Anyone holding a credential, CK or CRK can still decrypt a retained copy, so no cryptographic-erasure claim is possible without accounting for every copy. The passkeys themselves stay in the customer's providers until the customer deletes them.

### Relation to WH-116 data classes

The [lifecycle catalogue](data-lifecycle.json) has four protection profiles: `managed-readable`, `identity-verifiers`, `provider-vault` and `planned-adapter`. All are `serverReadable: true`, `endToEndEncrypted: false` and `customerUnlockRequired: false`. Adoption would need a new profile, for example `client-sealed`, and a new class with its own tables and readers, registered by the implementing packet. This document changes neither. No current class fits:

- Drafts, Chat, configurations, versions, media, safety cases, visitor data, contacts, billing and jobs all have readers that need plaintext.
- `identity-verifiers` already store no recoverable private keys.
- `connections` must be server-decryptable to call providers.

### Readable-processing boundary

| Feature | Needs server-readable content? | Effect on a sealed object |
| --- | --- | --- |
| AI maintenance and Chat (`src/ai.ts`, inspection, profile context) | Yes; selected readable inputs reach the inference provider | Not available. Pasting sealed content into Chat discloses it to Whumpo and the provider, so it is no longer sealed. |
| Content safety: intake holds, photo/import checks, the deferred CSAM scanner | Yes | Not checkable. Hosting unscannable private uploads is an owner/legal policy decision (D2). |
| Search and inspection | Yes; no customer vector index exists | Server-side search is impossible. A client-only index would be a separate design. |
| Publication, previews and public serving | Yes; visitors read output | Publication requires deliberate client decryption and becomes ordinary readable content under the existing reviews. Withdrawal cannot recall copies. |
| Image processing and private R2 media | Yes, to prepare and serve | Only opaque blobs, with no thumbnails or format checks. |
| Background jobs, deterministic rules, email and webhooks | Yes; jobs run without the owner present | Cannot read sealed content and must never borrow a client key. |
| Visitor application runtime (QuickJS) and visitor data | Yes; visitors have separate identity | Out of scope. Owner passkeys must never gate visitor data. |
| GitHub backups and source export | Yes | Ciphertext only, unless the owner exports from an unlocked client. |
| Support and operator access | Readable metadata only | Operators cannot read sealed content and cannot recover it. |
| Native Android (WH-081/083) | The browser handoff exchanges a session, not keys | The native app needs its own Credential Manager PRF assertion (unverified) or stays locked. |

### Client and previously-disclosed-data limits

- **Delivered code.** Whumpo serves the JavaScript that holds CK. A compromised or malicious deployment, a cross-site scripting bug or a hostile browser extension can read unlocked content or the key. Web delivery cannot provide server-proof secrecy against the server that ships the client.
- **Compromised device or provider.** Malware, an unlocked stolen device or a compromised sync account can produce PRF outputs.
- **Previously disclosed data.** Anything already sent to AI or inference providers, published, backed up, exported, pushed to GitHub, emailed or held by a revoked key holder stays disclosed. Sealing and rotation protect only later ciphertext.
- **Metadata.** Identifiers, sizes, counts, timing, generation, credential IDs and access patterns stay visible to the server.
- **Rollback.** A client that has never seen a newer generation cannot detect a server serving an older record.

## Friction analysis and measurement plan

Real-device measurements were not possible here. The table states expected prompt changes against the current passkey-only policy. These are assumptions to measure, not results.

| Journey | Current prompts | Additional with sealing (expected) |
| --- | --- | --- |
| Signup (two passkeys, recovery kit) | 2 registrations, kit save | Up to 2 assertions where PRF results are not returned at registration; one more save-and-acknowledge step for the CRK |
| Ordinary sign-in | 1 assertion | 0 if PRF is evaluated in the same assertion. Conditional-mediation PRF is unverified. |
| Reload or new tab | 0 | 0 with persisted non-extractable CK; 1 per reload if memory-only |
| Add a passkey | 1 registration plus recent authentication | Possibly 1 assertion for PRF, plus wrapping from an unlocked client |
| Revoke and rotate | Recent authentication | 1 assertion per remaining credential (absent ones pending); CRK re-entry or a new CRK save |
| Lost all keys | Kit plus 2 replacement passkeys plus fresh assertion | CRK entry; without it, permanent loss |
| Unsupported provider or device | None | Sealed content unavailable on that device |

Measurement plan for a later approved run on the [WH-024/025](roadmap/execution.md) measurement channel:

- **Identities.** Disposable synthetic accounts only.
- **Matrix.** The browser, OS, provider and transport matrix above, including hybrid and Android native.
- **Capability rates.** Per matrix cell: `prf.enabled` rate, results-at-registration rate and assertion PRF success rate.
- **Interaction.** Prompt count and time to unlock.
- **Drop-off.** Cancellation and abandonment at each step, CRK save acknowledgment, and success rate of a lost-all-keys recovery drill.
- **Synced copies.** Synced-copy PRF stability across two devices per provider.
- **Data rules.** Record content-free counters and coarse device classes only. Never record PRF outputs, keys, recovery values, credential secrets or content.

## Adoption and no-adoption criteria

Adoption requires **all** of the following on real devices with disposable identities:

- **A1.** Assertion-time PRF works on the supported matrix the owner designates, including at least one Apple and one Android/Chromium path, with documented sources and observed results.
- **A2.** Normal sign-in unlocks with no extra prompt beyond the existing assertion, and reload or new-tab use adds no routine prompt.
- **A3.** A second credential from an independent provider or security key reliably unlocks the same content. Synced copies are verified stable.
- **A4.** The lost-all-keys drill succeeds with the CRK alone, and fails cleanly without it, with no plaintext or server fallback.
- **A5.** Revocation and rotation complete without data loss. Pending-credential handling is understandable in usability tests.
- **A6.** The authentication payload and logs contain no PRF, key or recovery material, verified with the shipped client and server.
- **A7.** Measured abandonment and unlock-failure rates meet owner-set thresholds (D6).
- **A8.** A named data class has a concrete benefit that outweighs losing AI, safety, search, publication and background processing, and the safety policy (D2) accepts it.

**No-adoption** follows if any criterion fails or remains unverified. In that case, keep the transparent baseline, record the limitation in WH-116, and make no end-to-end or sealed-content claim. Do not weaken the design to pass, for example with server escrow, a plaintext fallback, CRK reuse of the account kit or a server-held unlock key.

**Current recommendation: no adoption.** A1, A3 and A7 are unverified. A8 has no candidate class. A4 and A5 require a second saved secret and presence-based rotation, which conflict with the low-friction principle.

### Implementation packet shape (only if the criteria later pass)

If the criteria pass, a separate packet, which this task does not create, would cover:

- One new `client-sealed` protection profile and one opt-in class registered in the catalogue, with validator tests.
- Ceremony option changes for `prf` on the login, registration and reauthentication paths, plus a server-side rejection of `prf` in received payloads.
- A client unlock module (WebCrypto only) and persistence choice D4.
- A CRK save/print flow kept visually and functionally separate from the account kit.
- Rotation (symmetric or X25519, D7) with pending-credential re-enrollment and a generation high-water mark.
- Export and closure behavior, current-schema tables for keyset records and sealed objects, and native Android handling.
- Explicit exclusion from AI, safety, search, publication and jobs, with UI disclosure.
- Physical-device acceptance separate from local tests.

The packet would depend on WH-114/115/116/117 and the WH-005 device matrix, and would not gate WH-048/049.

## Open owner decisions

- **D1 — Data class.** Is any sealed class wanted, given that AI, safety, search, publication and jobs cannot use it? Which one?
- **D2 — Safety policy.** May Whumpo host private content it cannot scan, including under the deferred CSAM scanner plan? This needs owner and legal review.
- **D3 — Content recovery.** Accept a second customer-saved secret (the CRK)? It could be printed on the same page as the account kit if generated client-side and never sent to the server. Alternatively, accept permanent loss without it.
- **D4 — Unlocked-key persistence.** Memory-only, with a prompt per reload, or a non-extractable key persisted until sign-out?
- **D5 — Unsupported devices.** Allow sign-in with sealed content locked on unsupported devices, or refuse sealing for accounts lacking a second PRF-capable credential?
- **D6 — Device matrix.** Which devices and providers are approved for the real-device matrix? Which disposable identities, who performs it, and what abandonment and failure thresholds apply?
- **D7 — Rotation model.** Symmetric wrapping, which needs every remaining key present, or X25519 public-key wrapping with an authenticated recipient directory?

None of these answers would authorize deployment, spending or provider activation.

## Synthetic proof

`pnpm test:passkey-key-wrapping-contract` runs `tests/passkey-key-wrapping-contract.mjs` against [`tools/prototypes/passkey-key-wrapping.mjs`](../tools/prototypes/passkey-key-wrapping.mjs). It is also part of `pnpm verify fast` (appended after the WH-068 notification contract check, which merged first). It imports no Worker code, makes no network calls and uses synthetic data only.

**Emulation boundary.** Each "authenticator" holds a random per-credential secret and returns `HMAC(secret, SHA-256("WebAuthn PRF" ‖ 0x00 ‖ input))`. Signatures and authenticator data are random placeholders. This proves internal consistency of the design only. It is **not evidence of PRF support** in any browser, device or provider.

The 20 named checks cover:

- Round trip and normal-sign-in unlock with `toJSON` strings, ArrayBuffers and typed arrays.
- Byte-wise search of the exact serialized server payload, with positive controls showing the raw `toJSON` form does leak. The search covers both PRF outputs, CK, the derived wrapping keys, CRK and the account kit, in raw, hex, base64, base64url, truncated and JSON-array forms.
- Server rejection of payloads that carry `prf`.
- No secret anywhere in server-held state, and failure of every server-visible value as a key candidate.
- Second-key and synced-copy unlock, plus unsupported-PRF refusal without fallback, while ordinary authentication continues.
- Failures for a wrong credential, bit flips, swapped or relabeled entries, unknown versions, extra fields and duplicates.
- Content AAD binding, unique nonces and salts, and revocation with its honest older-copy limit.
- Rotation excluding a revoked holder and the old CK, reissue versus reuse of the CRK, stale-generation relabel, the client high-water mark, and pending re-enrollment.
- Lost-all-keys: replacement passkeys and the account kit fail, while the CRK succeeds.
- Error messages carrying codes only, client-side export, and the limit that closure is not erasure.

Each of 16 mutants must be killed by its named check, by an assertion or protocol refusal rather than a crash. The mutants cover:

- Pass-through or partial PRF stripping in the payload.
- A server that ignores `prf`.
- CK reused as a public salt, or derived from the keyset ID.
- Enrollment wrapping a fresh key.
- Zero-byte PRF fallback.
- Object ID missing from content AAD, and a fixed IV.
- Revocation keeping the wrap, and rotation reusing CK.
- Generation unbound from both AAD and the commitment.
- The client high-water mark ignored, and pending credentials dropped.
- CRK equal to the account kit.
- Secrets leaked in error messages.

Single-field AAD mutants that the key commitment or per-credential key derivation already catch are equivalent, so they are not listed.

October 8, 2026 run on Node 24.21.0: all checks passed and 16/16 mutants were killed. CPU time was about 0.3–0.5 s. Inside `node tools/verify.mjs fast` the script took 279 ms, and the whole profile finished in about 5 s. Earlier standalone runs took 1.3–4.3 s wall because the shared 2-vCPU host was at load average 18–21. Under the same load, the existing `connection-vault` fast script took 2.5 s wall for 0.16 s CPU.

## Remaining gaps

- No physical device, browser build, passkey provider, security key, hybrid flow or Android Credential Manager path was exercised. Every PRF value was emulated.
- Several facts are unverified or conflicting: Safari/iOS assertion PRF, Windows Hello, Google Password Manager (no official statement), third-party providers as authenticators, conditional mediation, credential exchange, and synced-copy PRF stability.
- No friction, abandonment or time measurements exist; only the plan above.
- The prototype is not production code and has had no external cryptographic review. It does not model server storage, concurrency, current-schema tables, UI, native apps or the X25519 alternative.
- No owner decision D1–D7 has been made, and no adoption decision exists.
