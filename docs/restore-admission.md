# Isolated current restore admission

**WH-117C / DP-03, October 2, 2026 UTC. Source and synthetic local evidence only.** `tools/restore-admission.mjs` checks a recovered current-format database while it is offline. It has no deployment, publishing, provider-operation or SQL-write path. It is a bounded input to WH-008/019/059; it does not implement their independently operated suppression store, data scrubber, whole-platform restoration or service activation.

## Current manifest

`captureRestoreManifest` reads the complete current schema in one bounded data-read transaction. It verifies the exact schema and both maintained compiler locks against current source, then records:

- Current format and test environment, snapshot ID and independent stream checkpoint.
- Current schema fingerprint/object count, compiler identities/digests and `wv2` cipher format.
- Required ciphertext key IDs and the active write-key ID.
- Every current table's name, row count and whole-table digest.

The manifest contains no row bodies, owner IDs, object keys, plaintext credentials or encryption material. It is still restricted operational metadata. Capture does not register a permitted restore source or prove backup custody. The independent archive inventory must pin its exact digest and checkpoint separately. Changing restored rows requires a newly reviewed manifest and independent registration; the checker never rewrites a manifest or silently accepts a changed copy.

The isolated bound is 10,000 rows per table and 64 MiB of serialized row data. Overflow refuses verification; no partial page becomes a complete inventory. This is an operator/local checker, not a request-time Worker scan or a performance forecast for a large database.

## Independent evidence interface

`inspectIsolatedRestore` receives an **operator/server-selected service capability** and an independently configured stream ID. There is no customer/model endpoint for supplying a source, URL, approval flag or receipt. The service must own an authenticated, separately retained permitted-archive inventory and current suppression/outcome history. The restored D1 copy is not that authority. No deployed adapter/store or live backup registration is configured by this work.

The checker sends a read request to the fixed internal `/v1/check` path, with the snapshot ID, exact manifest digest and a fresh challenge. The response must contain exactly:

| Field | Required meaning |
| --- | --- |
| `version`, `streamId` | Current protocol and the independently configured source identity |
| `snapshotId`, `manifestDigest`, `challenge` | The exact registered archive and this fresh request |
| `archiveState` | `permitted`; expired, unknown or withdrawn sources fail |
| `capturedSequence` | The archive's registered checkpoint, matching its manifest |
| `baseSequence`, `currentSequence`, `events` | Complete cumulative sequence `1…currentSequence`, starting from base zero; at most 512 events / 256 KiB. Missing, reordered, truncated or compacted history fails. A future compacted baseline requires a separately reviewed current contract. |
| `issuedAt`, `expiresAt` | Millisecond timestamps: issued no more than ten seconds ago, not in the future; unexpired, with at most a 30-second lifetime |

The response describes facts obtained by the selected independent service; its freshness fields are not a substitute for operating that service correctly. A self-labelled JSON document or an old copied receipt cannot replace the service capability. Missing/unreachable evidence keeps the candidate held. The entire fetch/body read has a ten-second deadline, including when an injected service ignores the request's abort signal; a stalled body is cancelled. The synthetic service in the test has its own SQLite archive/event registry outside the candidate database. It does not demonstrate independent provider retention, availability or disaster recovery.

### Current constraints

- `owner-erased`: the owner cannot remain in the recovered database. Foreign-key integrity is checked separately. This does not execute account-wide erasure or prove removal from external copies.
- `identity-epoch`: monotonic evidence must match the current recovered account epoch; its sessions/grants cannot retain another epoch. Suppressed sessions, credentials, invitations or records must be absent.
- `record-suppressed`: a fixed current table and exact primary-key selector must be absent. Suppression is permanent for that identity. SQL fragments, unknown tables and partial/composite-key mismatches fail.
- `record-current`: the latest independent constraint for that exact record must match its complete row digest. It can represent the current consumed invitation, cancelled review or other authority receipt. It grants no invocation permission.
- `publication-withdrawn`: the named website/backend/app surface must be absent or withdrawn. A later exact independent current-publication receipt can supersede an earlier withdrawal; a recovered old publication cannot authorize itself.
- `external-effect`: unknown outcomes hold the entire isolated candidate. Reconciliation requires the exact effect ID and a matching current terminal receipt in the declared GitHub backup, Cloudflare DNS/hostname, standard/premium inference or Stripe subscription-order store. A credential row, arbitrary user row or approval flag is not a terminal receipt. OAuth exchanges have no admitted reconciliation receipt adapter yet and remain held.

The checker also refuses actual unresolved credential exchanges/revocation claims, unfinished key rotations, provider dispatch/uncertain states and applicable billing/inference reservations in the recovered rows, even if the independent stream has no newer event. Native CMS resources/import objects require their deferred recovery adapter and keep this candidate unavailable. No CMS/scanner functional test or access is introduced.

## Keys, objects and final readback

The supplied keyring comes through the separate trusted operator channel. Its active ID must match current policy, supplied ID/material fingerprints must match immutable registration, and all four token/PKCE stores must authenticate with the actual current vault primitive and owner/provider/purpose/record context. Missing/wrong/unknown keys and substitutions fail. An interrupted rotation cannot claim readiness; retaining an old current-format key permits authentication but does not settle its journal. No plaintext or old-format reader exists.

Each referenced project object must be present in the isolated private object source with exact byte length and SHA-256 digest. D1 restoration cannot supply an absent R2 body. This dependency check grants no serving, export or safety approval; those domain boundaries remain separate. Native CMS object dependencies are not handled by the project-object adapter.

After key/object checks, the tool rereads the database inventory and requests fresh evidence using another challenge. Candidate changes or new/changed independent evidence hold the result. It never retries an external operation. Every result, including `status: verified`, carries `servingAllowed: false`, `providerDispatchAllowed: false` and `retirementAllowed: false`. Operational admission needs the broader restore/suppression/authority adapters and separately reviewed cutover. A successful local read is not a reusable activation token.

## Verification and remaining work

`node tests/restore-admission.mjs` uses the complete current SQLite schema, actual credential/identity/website handlers and an independent synthetic archive/event registry. It copies the database using SQLite backup, reopens the copy read-only, revokes a session in the current source, and proves the unchanged archived copy is held. The copy contains neither plaintext provider canaries nor key material. `node tests/restore-admission.mjs --d1` checks the same verifier against disposable local D1; the physical SQLite-copy case is exercised by the first command.

Both cover current manifests, all four credential stores, missing/material-mismatched/retained keys, interrupted and completed current-key rotation, absent/stale/replayed/gapped/changed evidence, removed owners, stale epochs, suppressed credentials/reviews, withdrawn publications, uncertain effects, terminal-receipt matching, object loss/corruption, source drift and content-free reporting. Real network access is disabled. Current-format manifests are required; obsolete schema/cipher/compiler identities are rejected.

Child C remains open for independent permitted-restore/key-backup custody and exact unsettled OAuth outcome reconciliation. Child D retains configured custody, the coordinated current-schema test release and deployed measurements. WH-008/018/019/059 retain suppression-store operation, deletion execution, all external-resource adapters and whole-platform restore acceptance. The checker and these tests do not erase or replace those requirements.
