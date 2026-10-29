# Isolated local disaster-recovery drill

**WH-008, refreshed October 29, 2026 UTC (first drill October 8). Synthetic local evidence only. This is not a cloud restore, live acceptance or an approved recovery promise.** `tests/recovery-drill.mjs` (`pnpm test:recovery-drill`) captures a recovery point from a synthetic platform and restores it into empty isolated local resources, with a separate negative test where the control source is unreachable. The normal path holds the original control source reachable for successful restore admission. Both paths run the existing [restore admission](restore-admission.md) checks and use the [incident runbook](incident-runbooks.md#12-data-loss-and-restore-outline-only) as written, with no remote Cloudflare call, deployment, provider dispatch, customer DNS change or purchase.

Dependency state when this drill ran: WH-002 ([#39](https://github.com/zemdregon/whumpo/issues/39)) and WH-009 ([#7](https://github.com/zemdregon/whumpo/issues/7)) are closed. WH-117 key and storage source is delivered (#83–#85 closed), but custody and live acceptance (#82, #86) are still open. WH-007 ([#105](https://github.com/zemdregon/whumpo/issues/105)) has delivered its runbooks, but alerting and the live exercise are unfinished. So this drill uses the delivered tools. It does not complete those parent tasks or close gap G10.

Refresh scope (October 29, 2026, source `5de295f`): the schema is now **230 tables**. The October 8 drill predates `review_receipts`, `cost_events`, `lookup_consents`, `connector_receipts`, the email-change and security-review tables (`owner_email_changes`, `owner_email_change_limits`, `owner_security_reviews`), `account_closures`, `rule_approvals`, the B11 workspace layout receipt cap and the WH-117 key registry. The drill now seeds a synthetic row in each, asserts that every table is accounted for, and inventories key versions and interrupted cutovers. Sections below dated October 8 are kept as the first drill's record.

## Proposed targets (not approved)

These are **proposals for owner review**. They are not approved policy, customer commitments or Cloudflare guarantees.

| Scope | Proposed RPO | Proposed RTO to a *verified, fenced* candidate | Basis |
| --- | --- | --- | --- |
| Control D1 (accounts, sites, programs, app documents) | 24 hours (daily recovery point) | 4 hours, owner-operated | Measured local restore below; remote export/import time is untested |
| Private R2 bodies (`FILES`, restricted safety evidence) | 24 hours, with the same recovery point | 4 hours | This drill's recovery source is the archived point copy; no deleted-object recovery path was configured or exercised |
| Worker build outputs | Per release (WH-002 archive) | 1 hour | Archive digests already exist; rebuild is deterministic only for pinned inputs |
| Return to customer traffic | Not proposed | Separate owner review | Serving stays disabled until WH-019 reconciliation and a reviewed traffic switch |

## What the drill does

The tool is `tools/recovery-drill.mjs`. It is operator/local only, with no listener, route, publisher or provider adapter. Admission and reconciliation outputs carry `servingAllowed`, `providerDispatchAllowed` and `retirementAllowed` set to `false`. The capture, verification and restore helpers do not authorize serving, provider dispatch or key retirement. It reuses existing components and does not create a second authority:

- **Capture.** `captureRecoveryPoint` reads the control database twice with the existing logical snapshot (`stableCMSDatabase`) and checks an isolated SQLite round trip. It then copies every referenced private object body and copies Worker build outputs with the WH-002 `copyTree`/`fileInventory` helpers. All files are written through `writePrivate`, so they must sit in owner-only directories outside every checkout. The manifest is written last, and its SHA-256 (`pointDigest`) must be recorded outside the archive. Every later step requires that digest.
- **Register.** `openArchivedControl` opens the archived copy read-only. The existing operator inventory (`registerArchive`) pins it together with the encrypted key backup (`tools/connection-key-backup.mjs`), which is stored separately from the data archive.
- **Restore.** `restoreControlD1` restores into an **empty** isolated D1 database in one batch and proves the full logical round-trip digest. A non-empty target is refused; a failed target is replaced with a new empty one, never replayed. `restoreObjects` restores bodies into an isolated bucket. It is idempotent: exact existing copies are skipped, and a different or unexpected object refuses the target. `restoreWorkerArtifact` restores the runtime bundle and re-proves its inventory.
- **Admit.** The existing `inspectIsolatedRestore` checks schema, compilers, keys, credentials, objects and independent evidence. `reconcileArtifacts` additionally checks publication and application pointers: published site HTML and program sources against their stored digests, applied page reviews, and that application documents belong to an application.
- **Execute.** The restored runtime bundle runs in actual workerd/QuickJS. It executes the restored program against every restored visitor document, read-only, and the outputs must match the pre-disaster run.
- **Reconcile.** `restoreDiscrepancies` compares the candidate with the current source and reports per-table counts of rows that would be **resurrected**, **rolled back** or **lost since the point**. The counts are handed to WH-019; nothing is scrubbed.

The source platform uses the actual D1 query adapter over SQLite, with private bodies in a separate store. Recovery targets are empty local D1 databases and R2 buckets in a separate Miniflare state directory with no routes or service bindings. Handlers used are the real owner, publication, visitor-access, application, page, visitor-transition and visitor-deletion handlers.

## Table coverage (October 29, 2026)

`recoveryCoverage` in `tools/recovery-drill.mjs` compares the archived snapshot with the restored candidate, table by table, against the lifecycle catalog (`docs/data-lifecycle.json`). Capture is the whole logical control database, so every table is **captured and restored** unless `recoveryExclusions` names it with a rationale. Result of the local run:

| Measure | Count |
| --- | ---: |
| Tables in the current schema (and in the archive) | 230 |
| Captured and restored, restored row count equal to the archive | 230 |
| Excluded with a lifecycle rationale | 0 |
| Lifecycle classes covered | 57 |
| Tables holding synthetic rows in this drill | 62 |
| Tables restored but empty (schema and triggers proven, no row data) | 168 |

**Why nothing is excluded.** A restore that drops a ledger would hide the rows WH-019 needs to reconcile resurrected, rolled-back and lost records, and restored rows stay fenced from serving. A future exclusion goes into `recoveryExclusions` with its reason; the drill rejects an exclusion that names a table no longer in the schema.

**Why a new table fails the drill.** The drill holds on `coverage-unclassified-table` for any archived table that no lifecycle class owns, `coverage-restore-mismatch` when a restored row count differs from the archive, and `coverage-stale-exclusion` for an exclusion of a missing table. The test injects each case. Together with `tests/lifecycle-catalog.mjs` (which fixes the count at 230), a new table fails until it is classified.

Synthetic rows seeded before capture, with all triggers active: `review_receipts` 1, `cost_events` 1, `lookup_consents` 1, `connector_receipts` 1, `account_closures` 1, `rule_approvals` 1, `owner_email_changes` 1, `owner_email_change_limits` 2, `owner_security_reviews` 1 and `workspace_layout_receipts` 50 (52 layout revisions were written; the B11 cap left the newest 50). All restored with equal counts. Not seeded: the other 168 tables, so row-level restore of those is proven only by the whole-database round-trip digest, not by populated data.

## Key versions and interrupted cutovers

- **`inventoryKeyVersions`** (WH-117 connection key registry). Reports registered key IDs, the active ID and policy revision, completed and running rotations, rotation guards, and ciphertext rows per key ID across the five vault/PKCE stores. It reports IDs and counts only, never fingerprints or key material. It holds `key-rotation-unsettled` for a running rotation or guard, `key-version-unregistered` for ciphertext under an unregistered ID and `key-policy` for a missing or unregistered active key. Local result: 1 registered key, active, 4 ciphertext rows under it, no rotation. A throwaway copy with a running rotation held `key-rotation-unsettled` and the isolated restore admission refused it; a copy with ciphertext under an unregistered ID held `key-version-unregistered`. Key secret values stay outside every archive; the encrypted key backup is registered separately.
- **`inventoryCutovers`** (release journals from `tools/release-manifest.mjs`). Takes parsed `journal.json` files and reports any journal in `applying` or `needs-reconciliation`, or with a `running` or `unknown` step, as `cutover-interrupted`, naming the step, whether its operation was confirmed and how many steps are still pending. It never retries: the release tool's rule stands that an uncertain operation is inspected against live state, not repeated. A malformed journal holds `journal-format`. Tested with synthetic journals (deployed, prepared, stuck `running`, `unknown`, malformed). The journal is a file in the release directory, so nothing in the control database records an interrupted cutover; no live release directory was read.

## Procedure

1. Take a recovery point (`captureRecoveryPoint`); record `pointDigest` outside the archive. Register it with the operator inventory together with the encrypted key backup.
2. Verify the point (`verifyRecoveryPoint`), then restore into a fresh **empty** isolated D1 (`restoreControlD1`), objects (`restoreObjects`) and the runtime bundle (`restoreWorkerArtifact`). Never into the live database.
3. Run `inspectIsolatedRestore`, `reconcileArtifacts`, `recoveryCoverage` and `inventoryKeyVersions` against the candidate. Any hold means the candidate stays unserved.
4. Run `inventoryCutovers` over the release journals. Resolve any interrupted cutover against live state before a traffic decision.
5. Run `restoreDiscrepancies` against the current source and hand the counts to WH-019.
6. Reproduce locally with `pnpm test:recovery-drill`.

## Synthetic inventory

Recovery point A held:

- 79 control rows (679,446 bytes logical) across the complete current schema; admission inventoried 219 tables. The restore ran as 1,131 statements. These are the October 8 run's values. A re-run on source `d948f06` (October 11, 2026, `node tests/recovery-drill.mjs`, passed) inventories 79 control rows, 687,666 bytes, **221 tables** and 1,144 restore statements: the table count follows the composed schema (#186 added two tables); the byte and statement differences were not diagnosed. None of these are deployed-database counts.
- Credentials: 4 encrypted credential rows (GitHub/Cloudflare token and PKCE) under 1 key ID, with the key backup stored separately.
- One published site version, one enabled visitor application with an applied page review, and 2 visitor documents written through actual QuickJS transitions.
- 2 private object bodies (91 bytes) and 4 runtime build files (worker plus Wasm).

No native CMS resources were included; admission holds those as `cms-recovery-unavailable`. Published-site photos, GitHub backups, domains, Stripe state and interrupted key-rotation/cutover scenarios were not exercised. Worker recovery was exercised with the runtime bundle only; other Worker artifacts remain untested in this drill.

## Measured results — October 29, 2026 UTC (local measurements)

**These are local measurements on a fresh in-memory SQLite source and Miniflare targets, with synthetic data. They are not Cloudflare numbers and not an approved RPO/RTO.** Node 24.21.0, 8 CPUs, load average 2.5 to 6.5. Three passing runs of `pnpm test:recovery-drill`.

| Measure | Run 1 | Run 2 | Run 3 |
| --- | ---: | ---: | ---: |
| **Local RPO**: recovery-point age at the simulated disaster (ms) | 1,059 | 1,038 | 1,270 |
| **Local RTO**: restore start to verified, fenced candidate (ms) | 21,189 | 20,635 | 22,202 |
| Capture recovery point (ms) | 509 | 460 | 609 |
| Restore control D1, one batch (ms) | 8,134 | 7,514 | 8,328 |
| Restore admission (ms) | 1,778 | 1,643 | 1,756 |
| Table coverage check (ms) | 1,671 | 1,762 | 1,937 |
| Key version inventory (ms) | 64 | 65 | 76 |

Local RPO here is only the time the drill waited between capturing the point and destroying the source (about 1 s); it measures nothing about a real backup cadence. The measured loss was again one project-file row and its object body created after the point. This run's inventory: 143 control rows (831,102 bytes logical), 1,293 restore statements, 230 tables, 4 credential rows under 1 key ID, 2 objects (91 bytes) and 4 runtime files. The RTO includes the coverage check and key inventory, so it is higher than the October 8 run 2 (15.4 s) partly because of 1,293 against 1,131 statements and the added checks, and partly because that host was differently loaded; the split was not isolated.

## Measured results — October 8, 2026 UTC

Node 24.21.0 on a 2-vCPU aarch64 host that was **heavily shared** (load average 16–28 during the runs). These timings show relative cost, not expected Cloudflare times. Two passing runs:

| Phase | Run 1 ms | Run 2 ms |
| --- | ---: | ---: |
| Capture recovery point (two logical reads, round trip, objects, runtime bundle) | 880 | 448 |
| Register archive in operator inventory | 851 | 467 |
| Verify recovery point | 12 | 8 |
| Restore control D1 (one batch, round-trip digest) | 20,735 | 7,177 |
| Restore objects | 90 | 39 |
| Restore runtime artifact | 68 | 22 |
| Restore admission (`inspectIsolatedRestore`) | 7,104 | 2,818 |
| Artifact pointer reconciliation | 93 | 38 |
| Restored QuickJS execution of both documents | 460 | 166 |
| **Restore start to verified candidate** | **43,181** | **15,406** |

Earlier runs on the same host measured control-D1 restores of 5–48 seconds and admissions of 10–22 seconds.

**Measured loss:** one project-file row and its object body were created after point A and were absent from the restored candidate. Nothing else was lost, resurrected or rolled back. The time between the point and the disaster was synthetic (about 2 s), so it says nothing about a real RPO.

## Failure cases exercised

Each case fails visibly; none falls back or repairs silently.

| Injected condition | Result |
| --- | --- |
| Control restore batch fails mid-way | `restore-batch-failed`; target still empty; retry succeeds |
| Restore again into the restored target | `restore-target-not-empty` (no double apply) |
| Object restore interrupted after one body | Admission holds `missing-objects`; resume writes 1 and skips 1; a further retry writes 0 |
| Recovery key file missing | `key-backup-unavailable` |
| Different, unregistered key backup | `key-backup-binding` |
| Archived object deleted or one bit flipped | `object-missing` / `object-digest` |
| Archived control bytes changed | `control-digest` |
| Archived runtime bundle changed | `worker-artifact-digest` |
| Point manifest missing, wrong pinned digest, or consistently re-hashed edit | `point-missing` / `point-digest` |
| Restored object deleted or replaced with same-length bytes | `missing-objects` / `object-integrity`; overwrite refused with `restore-target-conflict` |
| Unexpected object in target bucket | `restore-target-not-isolated` |
| Published site HTML or program digest changed in a candidate copy | `site-artifact-digest`, `app-program-digest`; admission `manifest-mismatch` |
| Owner session revoked, site unpublished and visitor erased after the point | Admission `suppressed-record`; candidate rows kept for WH-019 (below) |
| Current source lost (total control-D1 loss) | `independent-evidence`; discrepancy report `sourceAvailable: false` |
| Point captured with a dispatched AI request | Evidence refused while unsettled; after settlement the candidate stays held (`stale-authority`); no runtime or provider dispatch occurred |

## Reconciliation gaps for WH-019

After the owner session was revoked, the site unpublished and one visitor erased, comparing the restored candidate with the current source gave:

- **Would be resurrected:** `identity_sessions` 1 (the revoked session), `app_visitors` 1, `app_sessions` 1, `app_documents` 1 and `app_runs` 1 (the erased visitor), plus `github_oauth_states` 1 and `cloudflare_oauth_states` 1 (PKCE states removed with the revoked session).
- **Would be rolled back:** `publications` 1 (the unpublished site returns to published), and `projects`, `workspace_state` and `module_access_states` 1 each.
- **Lost since point:** `identity_sessions` 1 (the replacement session), `app_deletion_receipts` 1, `publication_actions` 1, `publication_chat_links` 1, `chat_turns` 2, `activity_events` 1 and `project_files` 1.

Restore admission refused the candidate, which is correct. On `main` it can only **refuse**: nothing removes those rows or replays a tombstone, so the candidate can never become servable. Reconciliation, tombstone replay and erasure scope belong to WH-019.

**Main versus pending PR #170.** These results are for `main` at `ca17c6a`. Here, suppressions come only from the operator inventory comparing registered records against a **reachable current source**. Two consequences follow:

1. Any later change to an existing row holds an older point, because the comparison uses complete rows.
2. When the control database itself is lost, no independent authority remains and every candidate holds `independent-evidence`.

Open PR #170 (WH-018/019, not merged and not evaluated here) proposes an append-only restore-suppression ledger and a gated whole-database replay. Whether that ledger survives loss of the control database is a WH-019 question.

## Provider comparison and untested assumptions

Checked October 8, 2026 against official documentation:

- [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) restores to any minute within 30 days (Workers Paid) or 7 days (Free), at no extra cost. It restores **in place** and "does not yet allow you to clone or fork an existing database to a new copy". It therefore cannot produce the isolated candidate this drill requires; an in-place restore would overwrite the live database before any admission check. The isolated path is the logical export/import used here, and it is untested against remote D1.
- [R2 durability](https://developers.cloudflare.com/r2/reference/durability/) is designed for eleven nines, but "durability does not prevent intentional or accidental deletion of data". No deleted-object recovery path was configured or exercised in this drill; its private-body recovery source was the archived point copy.
- [Worker rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/) cover the 100 most recent versions, and "resources connected to your Worker will not be changed". Rollback does not restore data, and secret values are outside every archive here.

Untested: remote D1 batch, statement and size limits for a one-batch restore; export/import duration at real data volume; R2 object listing at volume; separate Cloudflare account/bucket custody; secret re-provisioning; and DNS/traffic switching. Paid isolated cloud resources and any traffic switch remain separately reviewed owner actions.

## Local findings

- **One-batch restore exceeds the CMS bound.** The control schema alone is 1,051 non-table-row objects. `restoreCapturedCMSD1` refuses more than 1,000 statements, so the drill uses its own bounded (20,000 statements / 64 MiB) one-batch restore with the same empty-target and round-trip rules.
- **`quick_check` fails in local D1.** `PRAGMA quick_check` on the complete control schema fails with `SQLITE_NOMEM`, so the full logical round-trip digest replaces it.
- **Evidence deadline under load.** The inventory's fixed ten-second evidence deadline covers two full source observations. With a local-D1 source on this contended host, observed independent-evidence holds were consistent with the fixed ten-second deadline; the source uses the SQLite adapter instead. The test retries independent-evidence holds (missing/unavailable/malformed evidence, non-200 responses, timeouts) up to three attempts, and reports the count as `independentEvidenceRetries` (0 in the recorded run). Real data volume may need a reviewed deadline or a faster observation path before operational use.
- **In-flight work blocks a point.** A recovery point captured while provider work is in flight can never be admitted. Take a new point after settlement.

## Acceptance status

- Digests and pointers, visible key/artifact failures, fencing, recorded identity/publication differences, and local measurements: demonstrated locally.
- Demonstrated locally (October 29): all 230 tables captured and restored with equal counts, seeded rows in the newly added tables, key-version and interrupted-rotation/cutover inventories.
- Still unverified live: the remote D1 export/import path and its limits at real volume, the live key registry and rotation state, live release journals, the `d948f06`-era byte and statement count differences, the 168 tables with no synthetic data, and everything in the Untested list above.
- Not done: live or remote restore, independent off-host custody, measured cloud RPO/RTO, CMS recovery, WH-019 reconciliation, owner approval of the targets above, and any traffic switch.
