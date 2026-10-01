# Four-Worker releases and partial recovery

**WH-002 implemented September 30; archive inputs and acceptance reverified October 1, 2026.** This is operator tooling for the private test platform. It does not publish customer code, provision a CMS, activate a provider or replace application acceptance. The archive/journal protocol is implemented; synthetic failure recovery and real local Wrangler bundle round trips are verified. The first completed live four-Worker release and a real interrupted-release reconciliation are recorded below and in [WH-066B deployment evidence](project-specification-storage.md#test-deployment-and-recovery). A deliberate live fault-injection or complete disaster-recovery drill remains unverified.

## Prepare before changing anything

`pnpm deploy` now exposes explicit `prepare`, `status` and `apply` commands. The old unjournaled migrate/build/deploy loop is removed. Preparation requires a successful current `pnpm build`; it performs local dry-run compilation and read-only provider/database inspection. Applying a release is the only new command that changes Cloudflare or D1.

1. Keep one operator and a stable checkout. Review the actual source/configuration changes and old/new service contracts. Check current authorization and any schema/provider prerequisites.
2. Run the appropriate feature checks and `pnpm build`.
3. Write a private release review JSON. For a release with **no pending SQL**, its shape is:

   ```json
   {
     "version": 2,
     "environment": "test",
     "buildInputs": "Copy inputs.sha256 from the reviewed .secrets/build-snapshot.json",
     "review": "Commit/issue/document reference for the actual mixed-version contract review",
     "mixedWorkersCompatible": true,
     "schemaChange": "none",
     "migrations": []
   }
   ```

   This is an operator attestation after review, not a template to approve arbitrary code. `buildInputs` binds it to the reviewed build inputs; changed inputs require a fresh review/build. The tools cannot establish compatibility or approval from the declaration strings themselves.
4. `pnpm deploy prepare .secrets/release-review.json` prints a release UUID and private manifest location. Inspect the manifest and preserve the whole archive before applying it.
5. `pnpm deploy status RELEASE_ID` reads the four live versions, schema names and CMS registration inventory. It never settles a journal or retries an operation.
6. `pnpm deploy apply RELEASE_ID` applies only the archived pending SQL, then deploys runtime → apps → sites → platform. The platform still uses the binding-preserving wrapper, including master-key verification against registered instances. `apply` on the same release also resumes a safely reconciled partial release; it never automatically repeats an uncertain command.
7. Verify live application behavior, public assets, authentication/ownership boundaries, routing and schedules against the expected change. Journal status `deployed` means command/version/binding readback succeeded, **not** that customer acceptance passed.

The existing standalone platform wrapper remains available for narrowly reviewed platform-only work, with its source/build guard. It does not produce this four-Worker journal. Direct Wrangler operations and `pnpm db:remote` also bypass this protocol; record/reconcile them before the next managed release. Older deployment examples in chronological documents are historical.

## What the private archive contains

`.secrets/releases/UUID/manifest.json` plus its SHA-256 checksum records:

- Source commit and dirty-checkout flag, source/build digests, Node and Wrangler versions.
- All four **before** Worker version IDs and secret **binding names**, with service targets; no secret values.
- All four prepared Worker configurations and unique candidate tags. Candidate version IDs are assigned by Cloudflare later and are recorded in the journal.
- Every archived file's byte length and SHA-256: actual compiled JavaScript/Wasm modules, platform and visitor static assets, migration SQL, source/configuration/lock files (including `compiler-locks/` since the October 1 correction) and release tooling.
- Exact applied/pending migration names and SQL hashes; the remote applied set must be a prefix of the archive. Unknown migrations or a hole stop preparation.
- CMS instance and deployment registration metadata, including owner/project/resource/version identities and existing source/secret **digests**. It contains no master key, derived secret, vault token, customer document or R2 object. This metadata is private operational data and stays out of GitHub.
- The reviewed mixed-version/schema/recovery declarations.

Prepared Worker configurations use `no_bundle` and point only at archived modules/assets/migrations. `apply` does not compile from the working source. Changed/added/missing archive files or symlinks fail verification before mutation. All normal configuration keys used today are supported; a new build hook, resource type or bundling option requires an explicit archive implementation update. The installed Wrangler version and release helper code must match the archive when applying; restore the pinned toolchain/helpers to continue an older release.

Checksums detect accidental drift; they are not signatures or protection from an operator rewriting both the archive and checksum. There is no filesystem transaction spanning verification and provider upload. Keep the private archive stable for the entire operation. The compiled bytes are pinned, but the installed dependency tree is not separately attested by the lockfile or source digest.

The journal records intent **before** each external operation using a synced temporary file, atomic rename and directory sync. A successful CLI completion is recorded separately from version readback. Failed commands keep fixed diagnostic categories in the journal; Wrangler detail remains in private logs. No automatic archive pruning is provided. Retain successful and interrupted archives, including previous releases. Copy the complete directory with restricted permissions to operator-controlled backup storage when establishing recovery readiness; local `.secrets/` is ignored by Git and is not a disaster backup.

## Current-only schema changes and test resets

**Owner directive, October 1, 2026:** all environments are testing; obsolete test data may be deleted. Release review version 2 is the only accepted format and requires `environment: "test"`. Old version-1 review files and old-Worker compatibility fields are rejected. Historical archives remain evidence, not supported deployment targets.

Every pending SQL file still has an exact `{ "name": "0117_current_billing.sql", "sha256": "…" }` entry and `schemaReview`. The numbered SQL directory is the existing delivery mechanism for the current schema; it does not require data-preservation migrations. `schemaChange` is `none`, `update`, or `reset`. A reset additionally records `testDataResetAuthorized: true` and a `cutoverReview` describing the deleted data and temporary availability impact. Do not create a compatibility reader or restore old binaries to preserve discarded test fixtures.

The cross-Worker service review remains necessary: tenant and credential boundaries cannot change mid-call. A reset may temporarily make the old platform unavailable between SQL application and the current platform deployment; the owner accepts temporary test rough edges. Record that interval honestly. Failure recovery inspects actual state and deploys a corrected current release. An uncertain provider write must still be reconciled before repeating it.

## Recovery decision table

First inspect the private logs, journal, `status` output and whether the original local Wrangler process is still alive. A timeout or old version still visible is not evidence that a provider action failed. Do not start another release while an earlier mutation might still be running. The shared platform deployment lease excludes cooperating release/CMS deployment tools, renews between steps and refuses an expired/replaced token. It cannot lock the Cloudflare dashboard or direct commands outside these tools.

| Failure point | Possible state | Required recovery |
| --- | --- | --- |
| Preparation | No new remote mutation; incomplete local archive may exist without a sealed manifest. | Fix the build/review/drift, prepare a new archive. Never apply an unsealed one. |
| Migration command | Schema may be partially advanced; all Workers still on their old versions. | Read applied names. If all archived SQL is present, resume can settle it. Otherwise stop: inspect failed SQL and its transaction behavior, prove the previous process is terminal, then review an explicit forward repair. No automatic SQL replay or reverse migration. |
| After runtime | New runtime with old apps/sites/platform. | If command completion was saved and tagged runtime/bindings match, resume skips runtime and continues apps. If unsafe, stop and prepare a corrected current release. |
| After apps | New runtime/apps with old sites/platform. | Confirm both identities; resume starts sites. Repair forward with current components and the applied schema. |
| After sites | New runtime/apps/sites with old platform. | Confirm three identities; resume starts the binding-preserving platform step. Retain every CMS registration and existing key. |
| After platform | All four candidates may be active but final readback/journal completion may have failed. | Saved command completion plus four matching tags/version IDs, services, secret names, schema and unchanged CMS inventory allows settlement without another deployment. Perform application acceptance afterward. |
| CLI outcome uncertain | Upload may have activated code before routes/schedules/settings finished. | Even a matching candidate tag is insufficient. The tool stops and does not set the operation back to pending. Prove the process terminal, inspect provider version, routing, schedule and asset state, then make an explicit reviewed repair/new release. Preserve the original unresolved journal as evidence; do not edit its completion flag to bypass the hold. |
| CMS registry, unrelated Worker or schema drift | Another operation changed the baseline. | Stop and reconcile that operation. Prepare a newly reviewed release against the actual state; never silently discard/reconstruct CMS bindings from a stale manifest. |

Recovery is forward-only. Prepare a corrected current release after inspecting the current schema, registrations and bindings. Preserve the existing `.secrets/cms/master.key` for registered instances; a reset of obsolete billing fixtures does not authorize changing unrelated credentials. Historical artifacts and journals are evidence, not a supported old-runtime deployment mode.

Complete whole-platform/database/object/key recovery remains WH-008/019/059. This release mechanism does not by itself satisfy those tasks.

## Local verification — September 30, 2026

- `node tests/build-snapshot.mjs`: existing source/build guard and refusal before provider access.
- `node tests/release-manifest.mjs`: disposable source/SQL/assets, fake provider. Checks immutable artifact/SQL pins, missing/extra/tampered files, symlink and secret exclusion, schema declarations, drift, persisted intent, interruption after **each** of the four Worker commands, one invocation per completed step after resume, repeat completion, migration uncertainty, unknown Worker command refusal even with a candidate tag, binding-name-only projection, and recoverable previous archive bytes.
- `node tests/release-lock.mjs`: actual in-memory SQLite, lease renewal/concurrency/expiry/failure cleanup and preventing an old operator from releasing a replacement lock.
- `pnpm build` plus `node tests/release-bundles.mjs`: actual Wrangler 4.143.0 dry-run compilation and archived `--no-bundle` re-ingestion for all four Workers. Exact executable-module byte equality, including runtime Wasm. Empty temporary HOME and allowlisted environment; no account/deployment/model call or functional CMS test.

No TypeScript behavior changed; no `pnpm check` was needed for this tooling change. That original local verification performed no live Worker/schema/customer-content mutation, CMS test or paid service activation. The subsequent WH-066B live release and application evidence are recorded separately below; broader recovery drills remain separate. Wrangler's [dry-run, output and no-bundle commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/) are the provider interface used here (checked September 30, 2026).

## Archive input correction and WH-002 acceptance — October 1, 2026

Reconciliation against source `aca1bc3` reproduced two gaps: `tests/build-snapshot.mjs` omitted required compiler checker/lock fixture inputs and failed before reaching its drift assertions; release preparation verified those locks during the build but omitted `compiler-locks/` from the archived source tree. The compiled deployment artifacts were already retained. Preparation now includes that directory under the existing byte inventory, copy-stability and tamper checks.

Both compiler checkers and lock files now have change/removal coverage. The release fixture also includes a synthetic nonempty registration inventory, its platform service binding and required master-secret **name**. No secret value or real instance is involved. Interruptions after each Worker command preserve that inventory, settle confirmed steps without redeploying them and continue only the remaining sequence. Unknown command outcomes still refuse replay.

The recovered-checkout test copies archived source and platform/visitor assets into a new directory, then validates them against the **original** manifest build snapshot without creating a replacement baseline. Representative frontend/visitor source files keep the fixture's input trees nonempty, like the repository; empty directories are not archive artifacts. This establishes retained build-input/asset equality, not a fresh dependency installation or full source rebuild.

Passed under Node 24.21.0 and pinned Wrangler 4.143.0:

- `node tests/build-snapshot.mjs`: source, assets, configuration, both compiler checkers/locks, missing inputs, symlinks, secret exclusion and refusal before provider access.
- `node tests/release-manifest.mjs`: immutable artifacts/SQL, lock tamper refusal, original-snapshot recovery, registration/binding preservation, failure after all four Worker steps, no duplicate completed steps, uncertain-command and external-drift holds, exact migration review and destructive-change restore/compatibility requirements.
- `node tests/release-lock.mjs`: lease renewal, competing operators, expiry, failure cleanup and ownership-safe release.
- `node tests/release-bundles.mjs`: real local Wrangler compile → archived `--no-bundle --dry-run` for runtime, apps, sites and platform, including runtime Wasm; all five executable modules retain exact bytes and archives remain unchanged. The fixture uses an empty temporary home and an allowlisted credential-free environment. [Wrangler command semantics](https://developers.cloudflare.com/workers/wrangler/commands/workers/) rechecked October 1.
- JavaScript syntax checks for the three changed files, roadmap validation/render consistency and diff checks.

WH-002's implementation/verification criteria are satisfied to this scope. No TypeScript/runtime/schema change, new frontend build, cloud deployment, CMS functional testing, provider activation or live fault injection was needed or performed. Whole-platform restoration and application/device acceptance remain their own gates.

**Older archives stay immutable.** Do not add missing locks or regenerate checksums in a sealed historical release. Its compiled-artifact replay retains the existing pinned-toolchain and current-state compatibility requirements. A source rebuild additionally needs the original missing locks from the recorded Git source and any separately retained uncommitted inputs; validate the original build digest. If those inputs cannot be recovered, do not claim reproducible source recovery from that archive alone.

## Live binding-readback correction — September 30, 2026

The first WH-066B managed deployment confirmed migration 0110 and the runtime/app upload commands, then stopped before sites/platform because the Cloudflare version API reports `environment: production` for a service binding whose Wrangler configuration omits that field. The before/after app service identity was identical. This label is provider metadata, distinct from Whumpo's `ENVIRONMENT=test` variable. Current [service binding configuration](https://developers.cloudflare.com/workers/wrangler/configuration/#service-bindings) names a specific environment through the Worker service name.

Preparation now records that explicit default in the expected binding inventory. Service name, binding name, environment and named entrypoint remain exact comparisons; unknown configuration fields fail before mutation. `tests/release-manifest.mjs` independently models the provider's explicit environment, checks rejection of changed targets/environments/entrypoints and preserves all uncertain-command/recovery assertions. Its disposable build fixture also includes the compiler lock/checker added in WH-066A. Manifest and lease fixtures pass.

Interrupted release `ddd4bab3-27a3-4aee-9c87-34fc9ab33bbf` and its original journal remain unchanged as evidence. Positive command completion and live IDs/tags/binding readback establish the partial state; no unknown upload is retried. Because the helper fix changes the archived toolchain, continuation uses a newly reviewed release against that current state, with no pending SQL. Final release identities and application verification belong to [the feature evidence](project-specification-storage.md#verification-and-deployment). This is a real stopped-release reconciliation, not a deliberate fault-injection or complete disaster-recovery drill.


## Service-settings release — September 30, 2026

Managed release `03b74965-16b8-4a41-8848-33cb1e21867f` completed schema → runtime → apps → sites → platform without repair/retry. It pins source `6740b4c` and migrations 0112/0113. Independent readback confirms 113 migrations, four matching candidate versions, unchanged service/secret-binding name inventories, 48 new/replaced migration objects, all 16 frontend assets and authentication boundaries. The previous 111-migration release remains the historical baseline above. [Exact version IDs, mixed-Worker review and local/live application acceptance](project-service-clients.md#test-release--september-30-2026) are in the feature contract. No new paid resource, customer publication, provider route or CMS activation occurred. The private archive records the generated visitor bundle's path-comment differences and shared dependency symlink as checkout dirtiness, with committed application source and exact compiled bytes retained. This is not a disaster-recovery drill.

## Safety knowledge release — October 1, 2026 UTC

Managed release `20d37ba0-fca6-4003-a9c8-280f2b23edff` deploys source `3417ea2`. The only runtime source difference from `6740b4c` is the safety reference guidance and its version in `src/agent-knowledge.ts`; service contracts, routes, schedules, bindings, compiler identities and schema are unchanged. Mixed old/new Workers are compatible. The archived no-SQL review pins the current build; all 113 migrations were already applied. Runtime → apps → sites → platform completed without repair/retry.

| Worker | Verified version |
| --- | --- |
| runtime | `32b4c263-ff2d-4ecd-8d89-92d1c9892f71` |
| apps | `41afcc1d-2af8-44c0-9ebd-b9db0e6635d6` |
| sites | `c9636442-d5f0-44f6-9a1b-9b0aa36131a0` |
| platform | `65dd6c82-3ad4-4b0e-a6f1-cdfe3cfce131` |

Independent readback at 2026-10-01T02:22:44.177Z confirmed candidate tags, service targets and secret-binding names, unchanged empty CMS registrations, 113 applied migrations, all 16 exact platform assets, home/health 200 and anonymous Chat/profile 401. Evidence is retained privately in `.secrets/safety-release-verification.json` and the immutable release archive. Its dirty flag covers the dependency symlink and generated visitor dependency-path comments; application source was committed before preparation.

The [safety coverage contract](safety-coverage.md) records type/build checks and three local synthetic suites. Deployment makes the corrected guidance available to Chat; it does not connect a scanner, accept real-model safety behavior, activate a provider, run CMS functional tests or publish customer content.

## Workspace recovery release — October 1, 2026 UTC

Managed release `02370893-1c87-419d-ad49-9162ddb0f135` deploys frontend source `524cf00`. The review compared it with deployed source `3417ea2`: only workspace presentation/recovery/focus behavior changes; Worker APIs, service contracts, schema, compiler pins, routes, schedules and bindings are unchanged. All mixed Worker combinations remain compatible. There was no pending SQL. The sequence completed without repair or repeated mutation.

| Worker | Verified version |
| --- | --- |
| runtime | `06a0910b-bb51-4de2-a6cb-7d6ff255f806` |
| apps | `3c9ab7a9-d73b-42f8-827b-83ef23f1b89f` |
| sites | `5bee1ad1-f3cf-4ade-93bd-3698e5282ca5` |
| platform | `e9f01d13-47cd-4a8b-84ad-3df7e6e43b70` |

Readback at 2026-10-01T03:04:55.347Z confirmed all four candidate tags, unchanged service/secret-binding names and CMS registry, 113 migrations and all 16 exact platform assets. Home/workspace/health returned 200, and anonymous Chat/profile returned 401. [Workspace acceptance](workspace-refinement-acceptance.md#workspace-connection-recovery-and-accessible-replies--october-1-2026-utc) records the synthetic browser and focused test evidence, plus remaining complete-journey/device/screen-reader and reload-persistence work. The archived dirty flag covers the shared dependency symlink and inspected generated visitor path comments; application source was committed. No new paid provider, scanner, CMS functional test or customer publication occurred.


## Chat reload recovery release — October 1, 2026 UTC

Managed release `dfd7f653-d7ec-483d-b54d-ec089f093edc` deploys source `272e3d7`. Compared with deployed `524cf00`, the only Worker response change is an additive, read-only authenticated profile `accountId`. Old clients ignore it; new clients without it retain in-memory Chat state and report unavailable browser recovery. Account-scoped workspace instances/caches and bounded tab storage preserve exact request envelopes without automatic submission. Server ownership/review/idempotency gates and all inter-Worker contracts, bindings, routes, schedules, compiler identities and schema are unchanged. The mixed-version review pins these facts and the successful build. All 113 migrations were already applied; no SQL ran.

| Worker | Verified version |
| --- | --- |
| runtime | `20cfc446-5271-45e4-b9bc-5298039fef87` |
| apps | `fc900b02-5a9d-46ff-b3df-ee0609e0c580` |
| sites | `8c34c8cd-abd6-42ce-86e3-844ddfa2ed9f` |
| platform | `390de352-e8eb-447b-ad34-060baba4f1a9` |

Independent readback at **2026-10-01T03:32:00.755Z** confirms all four candidate versions/tags, unchanged service/secret-binding names and CMS registry, 113 migrations with none pending, all 16 exact frontend assets, matching workspace entry HTML, home/workspace/health 200 and anonymous Chat/profile 401. The sequence completed without repair/retry. The private archive and `.secrets/chat-reload-release-verification.json` retain the evidence. Checkout dirtiness was limited to the shared dependency symlink and inspected generated visitor dependency-path comments; application source was committed before preparation.

[Chat reload acceptance](workspace-refinement-acceptance.md#chat-reload-recovery--october-1-2026-utc) records focused storage/API/delivery checks and the synthetic browser journey. Live verification covered deployment/asset/authentication boundaries, not a signed-in real-model journey. Full owner-journey, actual screen-reader speech and physical-device acceptance remain open in WH-024. CSAM implementation, CMS testing and provider activation remain deferred. No customer content was published.


## Welcome recovery and connected owner journey — October 1, 2026 UTC

Release `1abae8bd-fa49-4878-afb8-bdbd1615b41f` from source `2add4c0` was verified at **2026-10-01T04:07:14.190Z**: all four versions/tags, unchanged service/secret-binding names and CMS registry, 113 migrations with none pending, all 16 exact frontend assets and workspace entry HTML, home/workspace/health 200, anonymous Chat/profile 401.

| Worker | Verified version |
| --- | --- |
| runtime | `b0e59059-936b-4531-b406-76b72d891845` |
| apps | `3a5af63b-1eb1-43d0-a3c3-5dc0c0ab9a13` |
| sites | `df16c1c6-4178-4f87-9114-e009972ce997` |
| platform | `075ec017-8d81-4585-b111-9a6a8a3f2d94` |

The release changes frontend welcome delivery/focus/sign-out recovery and chat presentation only; server handlers, review authority, service contracts and schema are unchanged. Mixed Worker compatibility was reviewed against unchanged APIs before the archived deployment. The protocol completed all steps without replay or repair. The recorded dirty checkout comprised the shared dependency symlink and generated visitor dependency-path comments; the deployed artifact bytes are preserved, and the checked comment-only working difference was restored afterward. [Connected journey scope, tests and remaining acceptance](workspace-refinement-acceptance.md#connected-owner-journey--october-1-2026-utc). Private evidence: `.secrets/owner-journey-release-verification.json` and immutable release archive. No CMS/scanner/provider activation or customer publication.


## Readable comparison recovery — October 1, 2026 UTC

Release `ee62cc7e-a655-4aba-a84b-2568051415cf` from source `3a9b61b` was independently verified at **2026-10-01T04:28:59.444Z**. All four versions/tags, unchanged service/secret-binding names and CMS registry, 113 applied migrations with none pending, all 16 frontend assets and workspace HTML match the archive. Home/workspace/health returned 200; anonymous Chat/profile returned 401. Anonymous comparison navigation now returns the readable sign-in HTML with 401 and private/no-store/security headers; an explicit JSON caller retains the original 401 JSON error.

| Worker | Verified version |
| --- | --- |
| runtime | `457631aa-8095-4538-9150-4137be8e39c0` |
| apps | `78ebe24d-82d0-40a0-a1b6-5f3ec653a9e9` |
| sites | `bbf7dc84-72e1-4be7-9b93-5510fda6f217` |
| platform | `3bb91580-1686-460d-96c0-a26984899875` |

The platform changes representation only for HTML GET comparison errors and updates comparison markup. JSON clients, authentication, owner/integrity/revision/expiry checks and mutations retain their existing contracts. Other Worker contracts, customer renderers/compiler identities, schema, routes and bindings are unchanged, so mixed old/new Workers remain compatible. All managed deployment steps completed without repair/replay. The archived dirty checkout contains the shared dependency symlink and generated visitor path comments; the checked comment-only working difference was restored after verification. [Feature and bounded browser evidence](version-comparisons.md#readable-recovery-and-responsive-comparison--october-1-2026-utc).


## Credential authority release — October 1, 2026 UTC

Managed release `4c4be7bc-1354-4e05-b4f1-533bd6f92b79` deploys source `a27039b` ([PR #33](https://github.com/zemdregon/whumpo/pull/33)). Only two platform credential mutations gain committing-session/owner/expiry/freshness guards; mixed Worker combinations, schema and all service contracts remain compatible. No SQL was pending against 114 applied migrations. The sequence completed without repair/retry. Independent readback at **13:48:45 UTC** confirms all four candidates, unchanged binding/registration inventories, all 16 frontend assets, workspace HTML and anonymous/foreign-Origin credential denials. [Version IDs, local regression scope and remaining device/live-authenticated acceptance](owner-recovery.md#a1-test-release). Stripe sandbox mode remains configured; no CMS functional test, customer publication or new paid service ran.


## GitHub token lifecycle release — October 1, 2026 UTC

Managed release `6116b6b5-f398-437c-b947-32376e75e629` deploys `e073946` ([PR #35](https://github.com/zemdregon/whumpo/pull/35)) and additive metadata migration 0115. The reviewed old/new vault/pointer contract remains compatible; other Worker/service contracts, bindings, routes, schedules and frontend behavior are unchanged. All steps completed without repair/retry. Independent readback at **14:07:26 UTC** confirms 115 migrations, four candidate versions, exact binding/registration inventories, both metadata tables/foreign keys/index, all 16 frontend assets and workspace HTML, 28 available maintenance queries and anonymous/foreign-Origin access denials. Customer GitHub remains unconfigured with zero credentials; Stripe remains sandbox-only. [Exact versions, local regressions, schema review and verification limits](integrations/github-connection.md#a2-test-release).
