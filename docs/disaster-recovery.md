# Isolated local disaster-recovery drill

**WH-008, October 8, 2026 UTC. Synthetic local evidence only. This is not a cloud restore, live acceptance or an approved recovery promise.** `tests/recovery-drill.mjs` (`pnpm test:recovery-drill`) captures a recovery point from a synthetic platform and restores it into empty isolated local resources, with a separate negative test where the control source is unreachable. The normal path holds the original control source reachable for successful restore admission. Both paths run the existing [restore admission](restore-admission.md) checks and use the [incident runbook](incident-runbooks.md#12-data-loss-and-restore-outline-only) as written, with no remote Cloudflare call, deployment, provider dispatch, customer DNS change or purchase.

Dependency state when this drill ran: WH-002 ([#39](https://github.com/zemdregon/whumpo/issues/39)) and WH-009 ([#7](https://github.com/zemdregon/whumpo/issues/7)) are closed. WH-117 key and storage source is delivered (#83–#85 closed), but custody and live acceptance (#82, #86) are still open. WH-007 ([#105](https://github.com/zemdregon/whumpo/issues/105)) has delivered its runbooks, but alerting and the live exercise are unfinished. So this drill uses the delivered tools. It does not complete those parent tasks or close gap G10.

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

## Synthetic inventory

Recovery point A held:

- 79 control rows (679,446 bytes logical) across the complete current schema; admission inventoried 219 tables. The restore ran as 1,131 statements.
- Credentials: 4 encrypted credential rows (GitHub/Cloudflare token and PKCE) under 1 key ID, with the key backup stored separately.
- One published site version, one enabled visitor application with an applied page review, and 2 visitor documents written through actual QuickJS transitions.
- 2 private object bodies (91 bytes) and 4 runtime build files (worker plus Wasm).

No native CMS resources were included; admission holds those as `cms-recovery-unavailable`. GitHub backups, domains and Stripe state were not exercised. *At the time of those first two runs* published-site photos, interrupted key rotations/cutovers and the non-runtime Workers were also not exercised; the [coverage extension](#coverage-extension--october-8-2026-utc) below adds them and supersedes that limitation (the earlier numbers above are kept unchanged as the first observations).

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

## Coverage extension — October 8, 2026 UTC

**Branch `claude/wh-008-recovery-coverage`, local synthetic evidence only; still not a cloud restore, live acceptance or an approved promise.** Same rules as above: no remote Cloudflare call, listener, provider dispatch, customer traffic, paid service or key retirement; fixtures and keys are invented, no real vault key or recovery file was read. No CMS functional test was run. The proposed targets above are unchanged and still unapproved.

Run with `corepack pnpm --config.verify-deps-before-run=false test:recovery-drill` and `... test:recovery-drill-keys` (sequential, shared 2-vCPU host, load average about 10). The drill's output was inspected by hand; both ended with exit 0.

### 1. Published-site photos (in `tests/recovery-drill.mjs`)

- **Source.** Two photos are uploaded through the actual `uploadPhoto` gate, held (423) until a safety receipt exists, then approved by the same synthetic trusted receipt `tests/photo-versions.mjs` uses (no scanner exists; no production gate was disabled). The source refuses attaching a held photo and another project's photo (423). A `pages.setPhotos` version is applied and published through the actual Chat handlers. The JPEGs are envelope-valid synthetic bytes (`syntheticJPEG`), accepted unchanged by `cleanPhoto`, but not decodable images. A third approved photo belongs to an unpublished neighbouring project.
- **Capture and restore.** The point now holds 5 object bodies (2 private, 2 published photos, 1 neighbour photo). Every body, including the photos, is deleted at the disaster and restored from the archive into the isolated R2 bucket. Re-restoring is idempotent (0 written, 5 skipped).
- **Finding fixed in `tools/recovery-drill.mjs`.** The public host (`src/site-host.ts`) serves a photo only if the stored object has custom metadata `sha256` equal to the row digest. The first packet's `restoreObjects` passed `{sha256}` as a put option, which is not an R2 put option (by inspection; the old code was not re-executed). A byte-exact restore could therefore still fail to serve. Capture now records each object's content type and `sha256` metadata in the pinned manifest; restore writes them (`httpMetadata`, `customMetadata`); an existing object with different metadata is `restore-target-conflict`; any other custom metadata is refused at capture as `object-metadata` (tested).
- **`reconcileArtifacts(db, objects)`** now also checks every published photo: file row present (`site-photo-pointer`), same project (`site-photo-project`), `ready` plus the production `approved_project_photos` view (`site-photo-safety`), exact bytes (`site-photo-bytes`) and the host's metadata rule (`site-photo-metadata`). It reads only.
- **Evidence.** The restored candidate reconciles consistent with 2 published photos. On throwaway copies (archived control rows in in-memory SQLite, bodies restored into a memory bucket, because the real host handler writes usage counters) the *actual site-host handler* serves the exact published HTML and the exact photo bytes (digest equal to the row), returns 404 for a photo outside the published version and for the same photo through the neighbouring project, and returns 503 when the body is missing, altered, or restored without its metadata. Matching reconciliation holds: `site-photo-bytes`, `site-photo-bytes`, `site-photo-metadata`; restoring exact bytes with metadata returns to no holds and 200. Archived-row edits: a version-photo mapped to the other project → `site-photo-project`; receipt set to pending → `site-photo-safety`; digest changed → `site-photo-bytes` + `site-photo-safety`; the mapped edit also fails admission with `manifest-mismatch`.
- **Not done.** The `site-photo-pointer` hold (dangling file row) was not exercised: foreign keys prevent building that fixture and the production source cannot create it. The candidate was never served; the host handler ran on scratch copies using *source* code, not the restored sites bundle. `tests/photo-versions.mjs`, `tests/files.mjs` and `tests/photo-removal.mjs` need Python Pillow, which is not installed on this host, so they were **not run**.

### 2. Interrupted key rotations and cutovers (new `tests/recovery-drill-keys.mjs`, `pnpm test:recovery-drill-keys`)

Actual current modules throughout: `src/connection-rotation.ts` journal/registry/policy, the vault primitive, write policy, SQLite triggers, `tools/restore-inventory.mjs`, `tools/connection-key-backup.mjs` capsules and `inspectIsolatedRestore`; recovery targets are empty local Miniflare D1 databases. Two complete restores into D1 (mid-rotation and completed rotation) plus archived read-only copies for the other points.

| Interruption / scenario | Observed result |
| --- | --- |
| Activation committed, reply lost, nothing rotated | Same reply read back on retry (revision 2, no repeat); wrong-keyring batch refused; point registered with a capsule lacking the retained source key is refused at registration; with the correct capsule, admission while the *source* is still mid-rotation → `independent-evidence` |
| Half rotated (2 of 4), restored into D1 | Restore digest equals the point; the candidate keeps the exact mixed state (2 records under the old key, 2 under the new, rotation `running`); admission → `independent-evidence` (source unsettled); `restoreDiscrepancies` is `sourceAvailable:false` while the source rotation is unsettled |
| Source finishes after a lost batch acknowledgement | Same batch ID reads back the same receipt; status complete, 0 remaining, 4 rotated |
| Owner session revoked afterwards | Pending flows removed with it. The mid-rotation candidate would **resurrect** `identity_sessions` 1, `github_oauth_states` 1, `cloudflare_oauth_states` 1, **roll back** `connection_key_rotations` 1 and lose `connection_rotation_batches` 1 since the point; admission → `suppressed-record`; the candidate is held, unchanged (digest equal), not scrubbed. Same hold for the activated-nothing-rotated archive and the pre-rotation archive (which would also roll back the key policy and two vault rows) |
| Restored old key tries to act | Source refuses re-activating the retired key (`unavailable`), `sealConnectionWrite` under it (`write-key`) and a direct vault insert under it (`connection_write_key_changed`). Retired key: 0 live references, `retirementAllowed:false`; 3 registered archives still require it |
| Completed rotation, restored into D1 | `verified`, 2 credentials authenticate, key IDs `drill-next` + retained `fixture-current`, restore and source have zero differences; serving/dispatch/retirement all false |
| Wrong or lost key custody on that candidate | Old-keys-only or new-keys-only capsule → `key-backup-binding`; recovery key file removed → `key-backup-unavailable`, restored → `verified` |
| Archive permanently withdrawn | `independent-evidence` |
| Key verifier (registry fingerprint) edited in an archived copy | Registers, but admission → `stale-authority` |
| Unresolved OAuth exchange | Source refuses a further rotation (`unavailable`) and refuses evidence (`independent-evidence`); after a terminal outcome receipt is recorded the recovered exchange row still holds (`suppressed-record`) and stays visible |
| Database cutover: new empty current database with initialized key policy | Not a restore target (`restore-target-not-empty`); against that new source the old generation's candidate → `suppressed-record`, and the report counts the old identity (3), credential (5) and other (2) records as would-be-resurrected |

7 explicit `DrillHold`/`unavailable` refusals were counted and 0 independent-evidence retries were needed.

**Behaviour found (recorded, nothing in shared fences or the inventory was changed):**

1. With the real inventory, any unsettled rotation or OAuth exchange in the *current* source blocks evidence for **every** candidate, and the loss report degrades to the misleading label `unavailable-without-current-source`. After it settles, older candidates fail as `suppressed-record`/`stale-authority`, because their rows changed.
2. Candidate-level `key-rotation-unsettled`, `key-policy` and `key-identity` are therefore unreachable through the real inventory for older archives (the current-source comparison and the capsule binding come first). They stay covered with synthetic evidence in `tests/restore-admission.mjs`. A truly forged verifier is still caught, as `stale-authority`.
3. Nothing tracks which archives still need a retired key (here 3); retirement stays blocked by design but is not derivable from the tool.
4. `restoreDiscrepancies` now classifies rotation, batch, guard, exchange, outcome, staging, claim and grant-revocation tables as credential-class records for WH-019. It reports counts only.

**Not done / still open (WH-019, WH-117, parent gates):** the deployment journal's interrupted-cutover states are covered only by `tests/release-manifest.mjs` (fake provider), not inside this drill; restoring into the exact database named by a prepared release is untested; no suppression authority survives total control-database loss; no real recovery key, off-host custody or provider reconciliation; the tool does not reconcile or replay anything.

### 3. All four Worker bundles

`buildWorkerArtifacts` compiles `runtime`, `apps`, `sites` and `platform` once with the release tooling's `compileWorker` (local Wrangler dry run, credential-free environment, real `dist` from `node tools/build.mjs`). The point archives the four compiled outputs (4, 3, 3 and 3 files) plus the platform (38 files) and apps (3 files) asset trees. The compiled outputs are deleted at the disaster; asset trees are checkout directories and are left in place.

- **Recovered bytes.** All six archives are restored with `restoreWorkerArtifact` and equal the inventories taken before the disaster (independent of the point manifest). Existing damage tests still apply to the runtime archive (`worker-artifact-digest`).
- **Deployable inputs.** `replayRestoredBundles` writes the archived release configuration for each role and runs the same local `wrangler deploy --no-bundle --dry-run` as `tests/release-bundles.mjs` over the *restored* bytes; every JavaScript/Wasm module reproduces byte-for-byte and the payload is unchanged (25.9 s in the final run).
- **Only the restored runtime bundle was executed** (workerd/QuickJS, as before). The apps, sites and platform bundles were **not** loaded in workerd, bound to resources, routed or served; restoring the runtime proves nothing about them. This is recovered-bytes evidence, not connected HTTP serving acceptance, deployment, or service-binding/secret readback.

### Measured in this extension (October 8, 2026 UTC, load average about 10)

| Run | Result |
| --- | --- |
| Main drill, second extended run | pass, 3 m 10 s wall; restore start to verified candidate 44.2 s (now includes copying six archives); build of four Workers 11.1 s; control restore 20.5 s; restored-bundle dry-run replay 19.5 s |
| Main drill, final run | pass, 4 m 30 s wall; restore to verified 70.9 s; four-Worker build 27.6 s; control restore 29.8 s; replay 25.9 s; 13 refusals; 0 independent-evidence retries |
| Key drill, first passing run | pass, 82 s wall; mid-rotation D1 restore 17.7 s |
| Key drill, final run | pass, 3 m 58 s wall (higher load); mid-rotation D1 restore 31.4 s, completed-rotation restore 24.8 s, its admission 11.5 s; 7 refusals; 0 retries |

The control point now holds 112 rows (737,016 bytes) restored as 1,164 statements. The 20–70 s restore times reflect a contended host and still say nothing about Cloudflare.

**Guard canaries (each run once, then reverted):** restoring objects without their metadata failed the drill at `restore-target-conflict`; removing the photo metadata check failed it at the `metadata-lost` case (reconciliation returned no hold). Other checks (`pnpm check`, the existing photo, rotation and restore suites, `node tools/verify.mjs`) were **not** run for this extension; only the two drill scripts and `node --check` were.

## Acceptance status

- Digests and pointers, visible key/artifact failures, fencing, recorded identity/publication differences, and local measurements: demonstrated locally.
- Not done: live or remote restore, independent off-host custody, measured cloud RPO/RTO, CMS recovery, WH-019 reconciliation, owner approval of the targets above, and any traffic switch.
- Added October 8, 2026 (local synthetic only): published-site photo restore/reconcile, interrupted rotation/cutover holds, and recovered bytes of all four Worker bundles — see the coverage extension. Still not done: any connected HTTP serving of restored bundles, deployment-journal cutover inside the drill, WH-019 reconciliation and suppression survival, and every item in the list above.
