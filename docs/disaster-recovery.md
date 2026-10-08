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

- **Capture.** `captureRecoveryPoint` takes a **recovery source authority** (`tools/recovery-authority.mjs`, [section 7](#7-recovery-source-authority)): the database bound to the active platform Worker, observed through the release provider. A raw database adapter is refused. It observes that authority before and after it reads the control database twice with the existing logical snapshot (`stableCMSDatabase`), and checks an isolated SQLite round trip. The point is format `whumpo-recovery-point-v2` only: it records the source account, database, the apps/sites/platform Worker versions and the current-schema pin, and `verifyRecoveryPoint` rejects every other format, including v1. It then copies every referenced private object body and copies Worker build outputs with the WH-002 `copyTree`/`fileInventory` helpers. All files are written through `writePrivate`, so they must sit in owner-only directories outside every checkout. The manifest is written last, and its SHA-256 (`pointDigest`) must be recorded outside the archive. Every later step requires that digest.
- **Register.** `openArchivedControl` opens the archived copy read-only. The existing operator inventory (`registerArchive`) pins it together with the encrypted key backup (`tools/connection-key-backup.mjs`), which is stored separately from the data archive.
- **Restore.** `restoreControlD1` restores into an **empty** isolated D1 database in one batch and proves the full logical round-trip digest. A non-empty target is refused; a failed target is replaced with a new empty one, never replayed. `restoreObjects` restores bodies into an isolated bucket. It is idempotent: exact existing copies are skipped, and a different or unexpected object refuses the target. `restoreWorkerArtifact` restores the runtime bundle and re-proves its inventory.
- **Admit.** The existing `inspectIsolatedRestore` checks schema, compilers, keys, credentials, objects and independent evidence. `reconcileArtifacts` additionally checks publication and application pointers: published site HTML and program sources against their stored digests, applied page reviews, and that application documents belong to an application.
- **Execute.** The restored runtime bundle runs in actual workerd/QuickJS. It executes the restored program against every restored visitor document, read-only, and the outputs must match the pre-disaster run. The [execution probe](#4-executing-the-restored-bundles) then loads all four restored bundles with their restored asset trees against a second, disposable restore.
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
- **Not done.** The `site-photo-pointer` hold (dangling file row) was not exercised: foreign keys prevent building that fixture and the production source cannot create it. The candidate was never served; the host handler ran on scratch copies using *source* code, not the restored sites bundle (round 2, [section 4](#4-executing-the-restored-bundles), executes the restored sites bundle itself). `tests/photo-versions.mjs`, `tests/files.mjs` and `tests/photo-removal.mjs` need Python Pillow, which is not installed on this host, so they were **not run**.

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

1. With the real inventory, any unsettled rotation or OAuth exchange in the *current* source blocks evidence for **every** candidate. The loss report originally degraded to the misleading label `unavailable-without-current-source` for this; it now distinguishes the cases ([section 5](#5-loss-report-labels)). After the source settles, older candidates fail as `suppressed-record`/`stale-authority`, because their rows changed.
2. Candidate-level `key-rotation-unsettled`, `key-policy` and `key-identity` are therefore unreachable through the real inventory for older archives (the current-source comparison and the capsule binding come first). They stay covered with synthetic evidence in `tests/restore-admission.mjs`. A truly forged verifier is still caught, as `stale-authority`.
3. Nothing tracks which archives still need a retired key (here 3); retirement stays blocked by design but is not derivable from the tool.
4. `restoreDiscrepancies` now classifies rotation, batch, guard, exchange, outcome, staging, claim and grant-revocation tables as credential-class records for WH-019. It reports counts only.

**Not done / still open (WH-019, WH-117, parent gates):** the deployment journal's interrupted-cutover states are covered by `tests/release-manifest.mjs` (fake provider), not driven from inside this drill ([section 6](#6-release-journal-cutover-interruption) records what is covered and the exact remaining gap); no suppression authority survives total control-database loss; no real recovery key, off-host custody or provider reconciliation; the tool does not reconcile or replay anything.

### 3. All four Worker bundles

`buildWorkerArtifacts` compiles `runtime`, `apps`, `sites` and `platform` once with the release tooling's `compileWorker` (local Wrangler dry run, credential-free environment, real `dist` from `node tools/build.mjs`). The point archives the four compiled outputs (4, 3, 3 and 3 files) plus the platform (38 files) and apps (3 files) asset trees. The compiled outputs are deleted at the disaster; asset trees are checkout directories and are left in place.

- **Recovered bytes.** All six archives are restored with `restoreWorkerArtifact` and equal the inventories taken before the disaster (independent of the point manifest). Existing damage tests still apply to the runtime archive (`worker-artifact-digest`).
- **Deployable inputs.** `replayRestoredBundles` writes the archived release configuration for each role and runs the same local `wrangler deploy --no-bundle --dry-run` as `tests/release-bundles.mjs` over the *restored* bytes; every JavaScript/Wasm module reproduces byte-for-byte and the payload is unchanged (25.9 s in the final run).
- **Execution of these bundles is a separate step** ([section 4](#4-executing-the-restored-bundles)). The bytes-and-dry-run evidence above does not itself show any of them running.

### 4. Executing the restored bundles

**Local synthetic evidence only; not a deployment, route change, customer traffic, remote acceptance or secret/binding readback.** The `executeRestoredBundles` phase (`tests/helpers/recovery-serving.mjs`, run inside the main drill) loads the restored bytes of the `sites`, `apps`, `platform` and `runtime` bundles, with the restored `public-app` and `dist` asset trees, into Miniflare/workerd (the same harness the drill already used for the runtime) with disposable bindings: a D1 database and R2 bucket that are a **second restore** of the same point (digest equal to the point, 1,164 statements, 5 objects), the `BACKEND_RUNTIME`/`APP_HOST` service bindings between the restored Workers, the configured rate-limit bindings and `ENVIRONMENT`/other vars from the release configuration. Nothing is recompiled: the module paths point at the restored directories, which are re-inventoried before and after and must be unchanged. The configured production database/bucket IDs and names are never used. Secrets are not bound, so secret-dependent paths (Turnstile, AI, email, providers) were not exercised; the email binding was not configured.

How it is isolated: Miniflare listens on `127.0.0.1` only (asserted), dispatch is in-process by the configured route patterns (`whumpo.com/*`, `*.whumpo.site/*`), every outbound request from any Worker is refused and counted (0 in the run), and `globalThis.fetch` stays disabled. The verified candidate (`DRILL_A`) is not routed to by the probe; after it the candidate's logical digest is re-checked and equals the point. The real restore policy is unchanged: the candidate reports `servingAllowed: false`, `providerDispatchAllowed: false`, `retirementAllowed: false`, and the probe copy has no authority to serve customers. The T3 browser preview was checked and reported unavailable, so no browser rendering was done.

Run as two sequential instances over the same on-disk disposable state: `sites` + `apps` + `runtime`, then `platform` + `runtime`. One instance cannot hold both asset trees, because Miniflare resolves static assets by request path across Workers and the `apps` Worker was served the `platform` page (`/index.html` exists in both); production does not do this. This is a harness limitation, not a finding about the product.

Observed in the final run (51 in-process requests, 0 outbound requests, the probe phase 16.5 s wall, including both Miniflare boots and its second control restore):

| Surface | Result |
| --- | --- |
| Before restore (empty bindings) | the restored sites and apps bundles both refuse (503); nothing is served from a bundle alone |
| Sites bundle, published site | exact published version HTML (equal to the version row), `sandbox` CSP, `no-store` |
| Sites bundle, photos | both published photos return 200 with the exact uploaded bytes (SHA-256 equal to the row) and `image/jpeg` |
| Sites bundle, refusals | a photo outside the published version, the same photo through the neighbouring project, an unpublished project root, and both private project files all return 404; no response contained the private canary text or private object keys |
| Sites bundle, damaged bodies | a missing, altered (one bit) or metadata-less photo body returns 503 from the restored bundle's own check; restoring the exact body returns 200 |
| Apps bundle, boot and recovery shell | the served page is byte-equal to the restored `index.html` asset; it contains the sign-in, join, recover, recovery-code and account-deletion shell elements; `visitor.js` is byte-equal to the restored asset; a query string is refused (400) |
| Apps bundle, identity denials | no session, a malformed session, a tampered session and a session cookie named for another project all return 401; a cross-origin write returns 403; an unknown recovery code returns 401 and a malformed recovery request 400; a project that is not an application serves no application (404) |
| Apps bundle with restored runtime | each restored visitor session reads its own restored document; one visitor writes through the restored apps → restored runtime (QuickJS) → restored D1 (revision and `edits` advance); the other visitor's document is unchanged and cannot read the first visitor's receipt (404) |
| Platform bundle | health `ok`; the served page is byte-equal to the restored `dist/index.html`; no session returns 401; a write without a same-origin header returns 403; any other host returns 404; the restored owner session reads profile, onboarding, saved work (only the restored project's own uploads), Chat and dashboard; a second, synthetic owner added to the probe copy (with a project of their own) reads their own views, and none of the restored owner's identifiers appear in them |

**Guard canary (once, then discarded):** against a copy of the dumped restored state, replacing the sites bundle's `customMetadata?.sha256` comparison with `false` made the probe fail at the metadata-less-photo case (200 instead of 503). So the probe executes the restored bytes, not source. This canary ran in a separate development harness on a copy, not as a full drill run.

**Not shown:** the real recovery-key and secret path; positive visitor sign-in or recovery (the fixtures have no recovery codes or passkeys, and signing up needs Turnstile); the platform's provider, billing, Cloudflare, GitHub, contact-email and cron paths; scheduled handlers; other owners' multi-project isolation beyond a second synthetic owner; Cloudflare asset serving semantics (Miniflare's differ as noted); remote D1/R2 behaviour; any custom domain; the T3 browser. The write the probe performs lands only on the disposable probe copy.

### 5. Loss-report labels

`restoreDiscrepancies` used to report any failure to observe the current source as `sourceAvailable: false` / `unavailable-without-current-source`. With the real inventory an unsettled key rotation or unresolved OAuth exchange is a source that exists and is readable but whose comparison is held, so that label was wrong. `captureRestoreRecordSnapshot` now attaches a fixed hold code to its (unchanged-message) error: `source-unreadable` when no read completed, otherwise the existing admission hold code. The report maps it, with no identifier or row content and no counts in any held case:

| Current source | Report |
| --- | --- |
| Unreadable or absent (the read throws, or the batch read fails) | `sourceAvailable: false`, `unavailable-without-current-source` |
| Readable, unsettled (`key-rotation-unsettled`, `uncertain-effect`, `preservation-hold`, `cms-recovery-unavailable`, `stale-identity`) | `sourceAvailable: true`, `held-current-source-unsettled`, `sourceHold` = that code |
| Readable, not the current schema or not bounded/identifiable (`current-schema`, `candidate-integrity`, `candidate-bound`, `record-identity`) | `sourceAvailable: true`, `held-current-source-invalid`, `sourceHold` = that code |
| Anything else (observer tooling failure) | `sourceAvailable: null`, `unavailable-reconciliation-tooling` |

Admission and its fail-closed holds are unchanged; this only corrects the report. Tests use real blocks, not a mocked exception: the real mid-rotation source (`key-rotation-unsettled`), a real unresolved OAuth exchange and a real dispatched AI request (`uncertain-effect`), a real empty SQLite database that is not the current schema (`current-schema`), and a source whose reads throw (unavailable). One canary: forcing the old catch-all label failed the key drill at the mid-rotation report.

### 6. Release-journal cutover interruption

What the journal (`tools/release-manifest.mjs`, used by `tools/deploy.mjs`) guarantees: intent is saved before each external step; the order is schema, `runtime`, `apps`, `sites`, `platform`; a step whose outcome is unknown is never replayed; observation reads the database selected by the **active platform Worker** as authority. For an owner cutover to a new empty database the control database binding therefore changes Worker by Worker, and until the last step the platform keeps the baseline database while `apps` and `sites` already select the new, empty one.

Covered now with the actual `applyRelease`/`reconcileRelease`/`prepareRelease` and the existing fake provider (`tests/release-manifest.mjs`, new loop): an initialize cutover interrupted after **each** of the four Worker steps leaves the new database initialized exactly once (schema `confirmed`), the interrupted step `unknown` with `operationConfirmed`, the platform still bound to the baseline database unless the platform step itself was reached, and the other bindings exactly as far as the order implies; resume settles the interrupted step and ends with every Worker bound to the new database, with no repeat of initialization or of any confirmed step. The older cases remain: an unresolved schema or Worker command is never replayed, and a populated database is refused as an initialization target. In the key drill (`tests/recovery-drill-keys.mjs`) the new cutover database is refused as a restore target (`restore-target-not-empty`), a restored populated control database is classified by the real `currentSchemaPlan` as `none` (exactly the current schema) and an empty one as `initialize`.

**Remaining gap, not closed here:**

1. **No journaled way to put a restored, populated database in service.** `currentSchemaPlan` classifies a database only by its schema. A restored database is `none`, and `prepareRelease` refuses mode `none` when the configured database differs from the one the active platform uses (`Database replacement must start from an empty reviewed database`); mode `initialize` requires a database not bound to any Worker and then initializes it empty. So the only journaled control-database change wipes data. A restore cutover needs its own reviewed contract (adopt a populated database only with a bound, passing admission result and point digest; what the mixed-binding interval means for visitor sessions on `apps`/`sites`; how the suppression stream moves with it). That is WH-019/WH-008 follow-up design, not implemented.
   `tests/release-manifest.mjs` now pins this as a tested invariant with the actual journal and the fake provider: a populated, current-schema database as the configured unbound target is refused with zero provider writes, no journal and no release directory under `schemaChange` `none`, `initialize`, an invented `restore`/`adopt` and the retired `restoreReview`/`restoreEvidence`/`migrations` fields; a restore imported into a prepared target before apply is refused by the journal as a changed baseline; and the merge-to-main path refuses the same state. The fake provider models bindings and schema summaries only.
2. **Recovery source binding: closed locally, with limits.** `captureRecoveryPoint` and restore evidence now read only the platform-bound database and refuse mixed or changed bindings. The proof is bracketing observations, not continuity. See [section 7](#7-recovery-source-authority) for exactly what that does and does not prove.
3. **No integration run** drives the real `applyRelease` journal against Workers bound to a restored database, uses a real lease, or uses remote D1 (`wrangler d1 execute --remote`) import limits. The fake provider only models bindings and schema summaries.
4. The production lease, journal files and `deploy ci` guards (which refuse any changed control database) were not changed or exercised remotely.

### 7. Recovery source authority

**WH-008, October 8, 2026 UTC. Local fixture evidence with a synthetic account API. Nothing here observed a live Cloudflare account.**

**Contract.** A recovery point and its restore evidence must both be read from the single database that is bound as `DB` to the active `platform` Worker **while `apps` and `sites` are bound to that same database**. `observeRecoveryAuthority({provider})` (`tools/recovery-authority.mjs`) derives it. It reuses the release provider's own read-only `observe()` without a manifest, so there is no second deployment authority, and then opens the bound database through `provider.openDatabase`, which uses the same account-scoped client. Nothing about the source (database id, account, schema, adapter) is a caller argument; unknown inputs and a raw adapter are refused (`source-input`, `source-provider`, `source-not-authority`).

| Hold code | Meaning |
| --- | --- |
| `source-observation` | The release provider could not observe the Workers (including a bound database the account cannot read) |
| `source-binding-missing` | The platform has no `DB` binding |
| `source-binding-mixed` | `apps` or `sites` bind a different database set than `platform`, as after an interrupted cutover |
| `source-account` | A Worker configuration names a different account than the provider's client |
| `source-database` | The bound database could not be opened or read |
| `source-schema` | The bound database is not exactly the current schema |
| `source-binding-changed` | A later observation differs from the pinned one in database, any of the three Worker version ids, or schema |

**Derived, not asserted.** The source schema is inspected on the database actually opened for the platform binding. The provider's own `observe().schema` describes the **configured** database, which during a prepared or interrupted cutover is a different (often empty) database; it is deliberately ignored (tested with both skews). The account scope is the provider's: every Worker configuration must name the provider's account, and the opened database is reached through that account's client. The authority and the point record `provenance` as `account-client` or `injected-client` (an injected API, as in every fixture). That records which client was wired; it does not prove where the client points. The authority is frozen, unforgeable (registered in a module-private map) and keeps its database capability private; later changes to the provider object do not redirect it.

**Capture and evidence use bracketing observations.** `captureRecoveryPoint` observes the authority again immediately before and after the two equal logical control reads; any difference refuses with `source-binding-changed` and no archive directory, so no completion manifest exists. Each restore-evidence request in `openRestoreInventory({authority})` re-proves the authority inside its existing ten-second deadline before the first source read, after it (before any derived suppression is committed) and after the verification read. A stalled observation fails closed at the deadline. A read the binding did not survive therefore never commits a permanent absence. Constraint observations (`observe`) are bracketed the same way.

**Mixed-binding evidence (local, real journal).** `tests/recovery-authority.mjs` drives the real `prepareRelease`/`applyRelease` through an initialize cutover interrupted after each Worker step, with the real provider observer over a synthetic account API. After `apps` and after `sites` the authority is refused as mixed; after `runtime` it is the baseline; after `platform` and after resume it is the new database. Before any step the authority is the populated baseline, not the configured empty target. A binding or version change during the read, a same-binding different-version change, a drifted schema, a missing database, a mismatched account and an authority proven before a cutover all refuse. The mixed-binding check, the pre-read and post-read observations, the Worker-version comparison and the inventory re-observations (before commit and after verification) were each disabled once and the suite failed each time (revert canaries); the account, schema and missing-database refusals are asserted but were not canaried.

**What this does NOT prove (residual window).**

- **Endpoints, not continuity.** Two equal observations do not show the binding was stable between them. A binding that moves and moves back inside the read, including a rollback to the earlier Worker version (which reuses its version id), is invisible, and the read may have raced either database. `tests/recovery-authority.mjs` pins this limit with a test that succeeds.
- **No monotonic generation or write fence exists** to bind a read to. The deployment lease was not used: its row lives in the control database, so renewing it would write during the read and make the two logical reads differ, and it only governs the journaled tool, not an ad hoc `wrangler deploy`. Version ids are the only generation-like signal.
- Only the `apps`, `sites` and `platform` versions and bindings are compared; a `runtime` redeploy does not change the control database and is not part of the pin.
- A visitor or owner write that lands during the logical reads is not fenced. The two equal reads detect a difference between them, not a write after the second.
- Remote latency of the extra observations inside the ten-second evidence deadline, Cloudflare binding readback consistency and gradual-deployment version semantics are untested. The fixture API answers instantly and consistently.
- `restoreDiscrepancies(candidate, sourceDb)` is a report that admits nothing and still takes a raw adapter. An inventory stream is not itself bound to one database: use a distinct stream per authority database, as the cutover drill does.
- A v2 point records the source it was read from. It is metadata, not a grant: it does not authorize restore, admission, serving, dispatch or activation, and no consumer treats it as proof of a remote read.

**Operating rule.** If a capture's reply is lost and `pointDigest` was not recorded outside the archive, discard the point and capture a new `snapshotId`. Never recompute the digest from the archive. Capture refuses an existing directory.

### 8. Full activation remains forbidden

A restored, populated database does not go into service in this round. Besides the roadmap rule that restored services stay fenced and traffic switching is separately reviewed, these are still open (traced from source unless marked):

- **Suppression that survives total control-database loss (WH-019).** Admission can reach `verified` only when every registered candidate record equals the live source row (`tools/restore-inventory.mjs` derivation), so a real older point overtaken by later writes is held as `suppressed-record` or `stale-authority`, and after total loss no source remains (`independent-evidence`). `verified` is currently reachable for a relocation of a near-current point, not a recovery. Any suppression ledger kept in the control database does not survive that loss either.
- **Deployment lease availability.** `withLock` writes `cms_platform_deploy_lock` in the baseline control database (`tools/release-provider.mjs`, `tools/deploy-platform.mjs`). After total loss no lease exists and no journaled apply is possible.
- **A platform-wide write fence.** During the mixed interval `apps` and `sites` serve visitors from one database while `platform` reads another, and a candidate that bound Workers would no longer equal its admitted digest. No fence covering all four Workers exists on this tree.
- **Reviewed traffic-switch approval and custody** (WH-019/WH-059), `servingAllowed:false` in every admission result, and **off-host custody** of the inventory, archives and key backup (WH-117 #82/#86).
- **Remote evidence:** D1 import of a 1,164-statement batch, R2 restore at volume and secret re-provisioning have not been run remotely, and RPO/RTO remain unapproved.

No adoption switch and no label relocation were built. Each journaled path to put a populated database in service is refused and tested (section 6).

### 9. Restore containment gap (source-traced, not tested, not fixed here)

`operator_containments` (`schema/platform.sql`, written by `tools/operator-containment-input.mjs`) is current authority that is created after a recovery point exists. The inventory derives evidence only from the registered archive's records plus identities it already observed (`tools/restore-inventory.mjs`). A containment inserted after the point is a current-source-only row: nothing watches it, and `checkUnsettled` (`tools/restore-admission.mjs`) does not inspect containments. A candidate restored from an earlier point can therefore pass evidence with that freeze or allowance silently absent. `restoreDiscrepancies` would count it under `lostSinceSnapshot`, but admission does not hold on it. Changes to a row that is in the archive (a lift) and deletions (retention, session revocation) are already held. This packet did not change the shared admission contract, and no test exercises this gap. The next packet should add a fixed, source-declared set of insert-only authority tables whose current-only rows are added to evidence as `record-current` events, with a test that places a containment after the point and proves the hold and a revert canary. The unmerged WH-050 containment scope and the in-flight suppression-ledger work touch the same tables; this analysis did not depend on them and did not modify them.

### Measured in this extension (October 8, 2026 UTC, load average about 10)

| Run | Result |
| --- | --- |
| Main drill, second extended run | pass, 3 m 10 s wall; restore start to verified candidate 44.2 s (now includes copying six archives); build of four Workers 11.1 s; control restore 20.5 s; restored-bundle dry-run replay 19.5 s |
| Main drill, final run | pass, 4 m 30 s wall; restore to verified 70.9 s; four-Worker build 27.6 s; control restore 29.8 s; replay 25.9 s; 13 refusals; 0 independent-evidence retries |
| Key drill, first passing run | pass, 82 s wall; mid-rotation D1 restore 17.7 s |
| Key drill, final run | pass, 3 m 58 s wall (higher load); mid-rotation D1 restore 31.4 s, completed-rotation restore 24.8 s, its admission 11.5 s; 7 refusals; 0 retries |

**Recovery round 2 (same day, same host, load average 6–13 and falling).** These runs add the execution probe, the corrected loss labels and the release-journal loop:

| Run | Result |
| --- | --- |
| Key drill, with the corrected labels (first run, load about 13) | pass, 6 m 57 s wall; mid-rotation D1 restore 32.7 s, completed-rotation restore 36.2 s, its admission 22.6 s; 7 refusals; 1 independent-evidence retry (the fixed ten-second deadline under load) |
| Main drill, with the execution probe | pass, 3 m 05 s wall; restore start to verified candidate 25.6 s; four-Worker build 24.5 s; candidate control restore 9.4 s; restored-bundle dry-run replay 15.5 s; `executeRestoredBundles` 16.5 s; 13 refusals; 0 retries; 0 outbound requests |
| Key drill, with the corrected labels and the schema-classification assertions (final) | pass, 1 m 19 s wall; mid-rotation D1 restore 7.2 s, completed-rotation restore 7.9 s, its admission 3.6 s; 7 refusals; 0 retries |
| `node tests/release-manifest.mjs` (new interrupted-initialize-cutover loop) | pass, 29 s |
| `node tests/restore-admission.mjs`, `restore-inventory.mjs`, `safety-case-operations.mjs` (files touched by the label fix) | pass, 65 s, 29 s and 2.5 s |

The 7–36 s restore times swing with host load and say nothing about Cloudflare.
The control point now holds 112 rows (737,016 bytes) restored as 1,164 statements. The 20–70 s restore times reflect a contended host and still say nothing about Cloudflare.

**Guard canaries (each run once, then reverted):** restoring objects without their metadata failed the drill at `restore-target-conflict`; removing the photo metadata check failed it at the `metadata-lost` case (reconciliation returned no hold). Other checks (`pnpm check`, the existing photo, rotation and restore suites, `node tools/verify.mjs`) were **not** run for this first extension; only the two drill scripts and `node --check` were.

**Guard canaries, round 2 (each run once, then reverted):** replacing the sites bundle's photo-metadata comparison in a copy of the restored state made the execution probe fail at the metadata-less case (a development harness on a copy, not a full drill run); forcing the old catch-all `unavailable-without-current-source` label failed the key drill at the real mid-rotation report; disabling the journal's skip of confirmed steps (`tools/release-manifest.mjs`) failed `tests/release-manifest.mjs` (the suite failed, but I did not isolate that failure to the new loop). `pnpm check`, `node tools/verify.mjs`, the photo suites (Pillow is not installed) and the browser tests were not run in round 2 either.

**Source authority round (same day, load average about 11).** Run locally after the authority change; all pass: `tests/recovery-authority.mjs` 1 m 03 s–2 m 21 s wall (69 refusals, zero write statements issued by any authority operation), `tests/restore-inventory.mjs`, `tests/restore-inventory-freshness.mjs` (17 refusals, nine verified), `tests/release-manifest.mjs` (33–46 s), `tests/release-provider.mjs`, `tests/deploy-ci.mjs`, `tests/verification-profiles.mjs`, `tests/restore-admission.mjs` (121 s), key drill (3 m 32 s wall) and main drill (7 m 09 s wall), `node --check` on the changed tools and `pnpm check`. **Not run in this round:** `node tools/verify.mjs fast`, `node tools/verify.mjs protection` and `pnpm build` as a gate (a build was run once only to produce the asset tree the main drill compiles), the photo suites that need Pillow, and anything remote. **Revert canaries (each run once, then restored):** disabling the mixed-binding check failed the real interrupted-apply case after `apps`; removing the post-read observation, the pre-read observation (a binding that changes before capture and reverts during the read), the Worker-version comparison, or either inventory re-observation (before commit, after verification) each failed `tests/recovery-authority.mjs`; removing the retired `restoreReview`/`restoreEvidence` rejection failed `tests/release-manifest.mjs`.

## Acceptance status

- Digests and pointers, visible key/artifact failures, fencing, recorded identity/publication differences, and local measurements: demonstrated locally.
- Not done: live or remote restore, independent off-host custody, measured cloud RPO/RTO, CMS recovery, WH-019 reconciliation, owner approval of the targets above, and any traffic switch.
- Added October 8, 2026 (local synthetic only): published-site photo restore/reconcile, interrupted rotation/cutover holds, recovered bytes of all four Worker bundles, and (round 2) execution of the restored `sites`, `apps`, `platform` and `runtime` bundles with their restored assets against disposable restored D1/R2 in loopback-only workerd: published HTML and photos, cross-project and private refusals, visitor application boot and recovery shell, identity denials, a restored visitor write through the restored runtime, platform owner boundary and health. Also corrected loss-report labels and initialize-cutover interruption at each Worker step with the real release journal.
- Added October 8, 2026 (local fixtures): recovery source authority ([section 7](#7-recovery-source-authority)) with its stated limits, and tested refusal of every journaled adoption path for a populated database ([section 6](#6-release-journal-cutover-interruption)). Full activation stays forbidden ([section 8](#8-full-activation-remains-forbidden)); the restore containment gap is recorded, untested ([section 9](#9-restore-containment-gap-source-traced-not-tested-not-fixed-here)).
- Still not done: any Cloudflare-side serving, deployment, routing, secret or binding readback of restored bundles; positive visitor sign-in/recovery and the platform's provider paths; a journaled way to put a restored database in service and any run of the real journal against one ([section 6](#6-release-journal-cutover-interruption)); WH-019 reconciliation and suppression survival after total control-database loss; independent off-host custody; and every item in the list above. No RPO or RTO is claimed or approved from any of these runs.
