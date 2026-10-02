# Current credential keys and rotation

**WH-117 / [#82](https://github.com/zemdregon/whumpo/issues/82), October 2, 2026 UTC.** Implements the [DP-01 handoff](data-protection.md#required-wh-117-work) in separate source, rotation, custody and candidate-acceptance steps. All environments are pre-release testing.

## Delivery state

| Child | Boundary | State |
| --- | --- | --- |
| [#83 — Current credential envelope/configuration](https://github.com/zemdregon/whumpo/issues/83) | One current keyring/envelope, provider callers, error boundaries and synthetic fixtures | Source implemented; verification below. No deployed key/binding change. |
| [#84 — Fenced resumable rotation](https://github.com/zemdregon/whumpo/issues/84) | Reviewed write-key metadata, stale-writer fencing, exact CAS replacement, journal/readback and key retirement constraints | Required next. Current Cloudflare token immutability must be extended through the guarded path. |
| [#85 — Processing/restore/custody](https://github.com/zemdregon/whumpo/issues/85) | DP-02/03/04 selectors, exports, diagnostics and independently reconciled isolated restore/key custody | Required; no confidential route, recoverable-key custody or complete restore claim. |
| [#86 — Connected candidate acceptance](https://github.com/zemdregon/whumpo/issues/86) | Combined checks, measured overhead, reviewed obsolete-test reset and exact deployment/readback | Required before replacing deployed keys/encoding. Parent WH-117 stays open. |

The new source is intentionally not deployed by child A alone. A retained current key can decrypt its current-format records, but this does not implement safe storage rotation or prove a key can be retired. Do not change active key material or remove an admitted key simply because the primitive's tests pass.

## One current keyring and envelope

`CONNECTION_ENCRYPTION_KEYRING` is the only current configuration binding. It contains bounded JSON with exactly `version: 2`, `active` and `keys`. Each of one to four entries has exactly `id` and `secret`. IDs match `[a-z][a-z0-9-]{0,31}`. Secret material is 32 random bytes encoded as 64 lowercase hex characters. Both IDs and material must be distinct; `active` must name a present entry. Invalid, oversized or unsupported configuration disables provider configuration; the former bare-key binding is not read.

Every new encrypted value has four dot-separated fields:

```
wv2.KEY_ID.BASE64URL_12_BYTE_IV.BASE64URL_CIPHERTEXT_AND_TAG
```

The IV is randomly generated for each write. Web Crypto AES-256-GCM uses a 128-bit authentication tag and a non-extractable imported key. The authenticated data includes the current format, exact key ID and the caller's `whumpo:PROVIDER:PURPOSE:OWNER:RECORD` context. Only GitHub/Cloudflare and token/PKCE purposes are admitted; bounded owner/record identifiers cannot introduce separator ambiguity. All providers use this one primitive.

Plaintext is a nonempty, well-formed UTF-8 string of at most 8,192 bytes. Canonical unpadded base64url, exact IV/tag/byte bounds, the current envelope marker and strict key identity are required on reads. Decryption looks up precisely that ID; it never tries other keys or old formats. Relabelling ciphertext to another key ID fails authentication even if separately supplied material is identical. A changed owner/provider/purpose/record fails too. The old `v1` envelope and old context namespace are rejected; no reader, conversion or plaintext fallback remains.

`connectionKeyringMetadata` returns only version, active ID and retained IDs. `connectionCiphertextKeyId` validates an envelope's structure, but does not authenticate its body or grant rotation/restore authority. Neither helper proves that key material matches a historical key or that deployment/account custody is correct. Key-ID identity and retirement must be enforced by the rotation/custody implementation before activation.

## Existing provider lifecycle integration

GitHub and Cloudflare read only the new keyring binding. Token and PKCE writes use its active key, including GitHub staging and Cloudflare retained revocation work. Pending PKCE encrypted with a retained key remains readable by the exact callback; any resulting token is sealed with the configured active key. These are current-format key instances, not compatibility paths.

Unknown/missing keys, malformed envelopes and authentication failures stop decryption. Direct HTTP reads return a bounded 503 response explaining that platform recovery is required; callbacks use the existing failed-authorization redirect without exposing cryptographic details. These known failures do not enter the generic exception logger. No provider request may be sent using an unavailable credential.

Disconnect still removes local use authority immediately. If cleanup cannot decrypt, it retains the encrypted revocation obligation and current lease rather than claiming the provider token was revoked. A later admitted cleanup with the exact key can complete the existing token revocation. Account recovery does not reconstruct a lost platform key. Provider expiration, configuration presence and a successful JSON parse are not proof of remote revocation or safe key retirement.

## Rotation/storage work still required

Child B must register current write-key metadata and a review-bound journal without storing key values in D1. Stale Worker configurations must be fenced at the same atomic storage boundary as token/PKCE writes. A rotation read may be old by commit time: match exact owner/record/ciphertext and current write-key generation, preserve lifecycle identity/state/expiry, and do not overwrite a concurrent authorization, disconnect, token removal or newer rotation. A response timeout must recover by exact readback, not by replaying a provider exchange.

The current Cloudflare trigger forbids ciphertext mutation. Extend it only through the reviewed rotation contract; retaining all other identity immutability is required. GitHub staging, leased revocation and OAuth-state replacement must participate in the same contract. Measure envelope growth, row operations and crypto CPU. A format-only change has not measured complete rotation cost.

Key retirement needs evidence for every admitted live ciphertext, in-flight write obligation and permitted backup/restore source. Data archives cannot reconstruct Worker secrets. Missing independent deletion/revocation evidence or unknown provider outcomes must keep affected restore/dispatch unavailable. Children C/D own the remaining custody and candidate evidence; no new service or routine customer unlock is selected.

## Local verification

- `tests/connection-vault.mjs` exercises the actual current primitive/config readers: 164 cases for current-only format/configuration, retained/active keys, authenticated key IDs, wrong context, corrupt/truncated bytes, missing keys, byte limits and secret-free errors. This replaces the previous 73-case single-key baseline.
- `tests/connection-keyrings.mjs --d1` exercises actual GitHub/Cloudflare handlers with the complete current schema in disposable local D1: retained-key PKCE to current-key token, missing-key refusal before transport, the actual HTTP 503 boundary, encrypted revocation retention and later exact-key cleanup. Providers are synthetic; no real OAuth grant is created.
- Existing GitHub connection and 13 token-lifecycle regressions, Cloudflare connection, 37 feature-admission refusal cases, connection Chat/readiness and GitHub setup fixtures passed using the current keyring. They cover staged/active/revoking custody, owner/session/scope checks, competing callbacks/cleanup and lost acknowledgments. Downstream GitHub backup and Cloudflare DNS/Chat checks also pass with synthetic transports.
- The package check script (compiler manifests plus both TypeScript projects), `node tools/build.mjs`, the five-script fast profile and roadmap validation/alignment/render checks pass. The check script ran directly because pnpm attempted to replace the shared dependency symlink; no dependency purge or package change was performed.

These checks do not prove the unimplemented D1 write fence, resumable rotation, operational key backup, current live binding/ciphertext cutover or real customer-provider consent. No CMS functional tests, CSAM implementation/testing or Daybreak work is included.
