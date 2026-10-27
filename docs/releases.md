# Four-Worker releases and partial recovery

**Schema delivery contract, October 3, 2026 (the release named here was current on that date; later records follow below).** Whumpo is a disposable private test platform. Source uses review version 3 and archive format 2, with one complete current schema and no numbered migration replay or old readers. The [Chat connection handoff/status release](chat-routine-release.md) was current on October 3 (`5dfb930c-7241-4516-97fd-dff9f461de1e`, source `577702e`, 177 tables/806 objects); the latest recorded deployment is the [October 4 PR #160 cutover](#pr-160-shared-modules-and-contact-email-cutover--october-4-2026-utc) (219 tables / 1,050 objects at initialization), and source at `d948f06` (October 11, 2026) composes 221 tables / 1,063 objects, which needs a further owner-authorized cutover. The deployed control database needs a fresh read-only readback. Four Worker identities/bindings, 39 assets and the eight-stage deployed real-Muse/browser journey pass; final readback is 13:51 UTC. The obsolete empty database was retired after checking all 14 account Worker bindings, and a fresh owner invitation is private. Broader task/customer/device/provider acceptance, off-device key custody and acknowledgment reliability remain open. Earlier dated records below describe previous protocols and versions.

Release observation reads registration metadata from the database bound to the **active platform Worker**. Before platform cutover this is the baseline database; after cutover it is the target. The initialized target must match active registration metadata during the mixed interval. A missing active binding/database still refuses observation; it does not try another database. A completed release therefore remains inspectable after the unreferenced baseline is retired. `tests/release-provider.mjs` exercises this actual observer with synthetic provider responses; live `status` for release `7c4f9344-bd6c-4fc7-a3ab-964e631ad8f3` also passed after baseline deletion. The sealed archive is unchanged; the observer correction is subsequent operator tooling.

## Automatic releases (merge to main)

Routine releases are automatic: Cloudflare Workers Builds runs `pnpm run deploy ci` after the build gate on every merge to `main`. It writes the review record below itself (`review` names the commit SHA, `schemaChange: "none"`), runs prepare then apply in one process under the same D1 lease, and prints the journal. It refuses initialization, schema drift, a changed control database and CMS registrations; nothing is deployed in that case. A failed or interrupted CI release leaves its journal only in the build log; the next release prepares again from the actual live state, and an uncertain step is reconciled by the owner as described below. The manual prepare/status/apply steps below are the **owner cutover** path only.

**Concurrent merges and the one retry (October 27, 2026).** The CI release prepares outside the D1 lease; only `applyRelease` takes it. When two merges land about a minute apart, run B reads the old Workers as its baseline, run A deploys, and B's `reconcileRelease` throws `Worker changed outside this release` before any step runs. This refused the merge commits of PRs #387 and #388; the newest code went live only because a later merge redeployed it. `ciRelease` now catches exactly that error, and only when every journal step is still `pending` (a missing journal counts as all pending), then prepares again from live state and applies once more. It logs `Retrying once: ...`. At most one retry; a second refusal, any other error, and any step that is running, unknown or confirmed fail exactly as before. The lease, journal and `applyRelease` are unchanged.

**Prepare-time refusal (added October 27, 2026).** The same race can hit earlier: `prepareRelease` observes the live baseline, then re-observes it at the end and throws `Build or remote baseline changed during preparation` if it moved (PR #402 failed this way while #401 succeeded). Nothing has been applied at that point, so `ciRelease` retries this too. The retry limit is **one in total per CI run, whichever phase triggered it**: a prepare refusal followed by an apply refusal (or the reverse, or two of the same) fails on the second. Before the retry's prepare, `ciPreflight` runs again against fresh live state. Any other error, and any failure after a step has started, behaves as before. That prepare message is also raised when the build snapshot changed; the retry then fails on the compatibility review check, so it cannot deploy a different build.

**Manual step:** if a CI run was refused (build log shows `Worker changed outside this release`, `Build or remote baseline changed during preparation` or `Release stopped at ...`), re-run the Workers Builds build for the latest `main` commit. Do not deploy by hand.

**Decision (October 27, 2026):** retry in `ciRelease` rather than move prepare inside the lease or change `applyRelease`. Reason: the refusal is raised before any side effect, so a fresh prepare is safe and the change stays local to CI; lease or journal changes would touch the owner-cutover path. **Open risk, not fixed:** an older commit's build can finish after a newer one's and deploy older code over it, because nothing orders builds by commit. Re-running the latest `main` build corrects it.

## Prepare before changing anything (owner cutover)

1. Keep one operator and a stable checkout. Review source, service contracts, provider obligations and the current database binding. Run the appropriate feature checks and `pnpm build`. For a composed-schema change also run `pnpm test:tenant-gates` (the WH-054 tenant registry drift gates are not in the deploy build; see [verification](verification.md#wh-054-tenant-classification-gates--october-9-2026-utc)).
2. Write a private review. For an unchanged current database:

   ```json
   {
     "version": 3,
     "environment": "test",
     "buildInputs": "inputs.sha256 from .secrets/build-snapshot.json",
     "review": "Actual source and mixed-Worker contract review",
     "mixedWorkersCompatible": true,
     "schemaChange": "none",
     "schemaSha256": "sqlSha256 from currentSchemaArtifact()"
   }
   ```

   These declarations record an actual review, not an automatic approval. The build and complete SQL digests pin its inputs.
3. `pnpm run deploy prepare .secrets/release-review.json` compiles and archives the four Workers and reads the baseline; it performs no remote mutation. Preserve the complete private archive.
4. `pnpm run deploy status RELEASE_ID` reads current versions, exact database schema and CMS registration metadata. It never retries or settles a journal.
5. `pnpm run deploy apply RELEASE_ID` initializes an empty database if reviewed, then deploys runtime → apps → sites → platform. The platform wrapper checks the complete current schema and preserves registered services/keys. Each operation records intent and successful CLI completion before readback. Resume skips confirmed steps and refuses uncertain commands.
6. Verify application behavior, assets, identity/ownership boundaries, routing and schedules separately. `deployed` confirms deployment identities; it does not mean customer, physical-device or restoration acceptance passed.

The standalone platform wrapper is for scoped work against an already current database. It refuses the old schema. `db:remote` and numbered migration settings are removed. `pnpm db:local` initializes an empty local database or confirms an exact current one; it does not overwrite occupied or drifted state. `pnpm db:status` inspects local schema. Use a fresh local persistence directory for a reset and use the same directory when starting development.

## Current schema and account resets

`tools/current-schema.mjs` composes, in order:

1. `src/workspace-identity/canonical-inputs.sql`
2. `schema/platform.sql`
3. `src/workspace-identity/schema.sql`

It validates SQL and seed foreign keys in disposable SQLite, hashes every source file and the complete SQL, and derives an exact inventory of tables, indexes, views and triggers. Readback uses the same catalog on D1. Application schema drift, including an obsolete migration ledger, fails. D1's reserved internal tables are outside application ownership. No account data is read for this fingerprint.

An occupied database with a different schema is refused. The current reset selects a **new empty D1 database** in all three control database bindings. Its ID must not be bound to any of the four active Workers. Use `schemaChange: "initialize"`, `testDataResetAuthorized: true`, the complete schema hash, and a concrete `cutoverReview`. A nonempty CMS registration inventory prevents this reset; it requires a separate resource-retirement decision, with no CMS functional testing implied.

A database replacement isolates new account rows from requests still holding the old D1 binding. No old account or credential is copied. During the sequential deployment, some components may still use the retired test database; review this interval and the service contracts. It is not a zero-downtime claim. The deployment lease stays in the baseline database through completion. Deleting that database before the journal completes is invalid.

**Identity cutover completed:** the complete current schema was initialized in a distinct empty database, all four Workers were deployed and verified, the old test identity/database and password secret were retired. [Evidence and remaining physical-device limits](identity-web.md#deployed-current-identity-and-retirement--october-2-2026). The release tool does not create/delete databases or cancel third-party obligations; those separately reviewed operator actions are recorded there. Future resets follow this same current-only contract.

## Private archive and journal

`.secrets/releases/UUID/` contains the manifest/checksum, source/build/compiler locks, exact compiled JavaScript/Wasm and assets, configurations, `payload/schema/current.sql`, baseline Worker identities and service/database/secret-binding names, current schema before/expected fingerprints, and CMS registration metadata. Secret values, customer rows, R2 objects and dependency directories are excluded. Registration metadata stays private.

Prepared configurations use archived modules/assets with `no_bundle`. Apply never builds from working source. File tampering, missing/extra files, symlinks, changed tools/toolchains, wrong database identities and schema drift stop release. Checksums detect drift; an operator able to rewrite both artifact and checksum is not excluded by this mechanism.

The journal uses synced atomic writes before side effects. Successful CLI completion is distinct from remote readback. Fixed diagnostic categories are saved publicly in the journal; provider logs remain private. A command timeout, a matching schema or a matching Worker tag alone does not prove that an uncertain operation finished. Do not reset its status to pending. Inspect its original process/provider operation, establish terminal state, and make a reviewed forward repair. Old archives remain historical evidence, not supported deployment targets.

The shared deployment lease covers cooperating tools, not dashboard edits or direct API commands. Preserve the entire archive and original logs. `.secrets/` is ignored by Git and is not itself a disaster backup.

## Recovery decisions

| Failure | Required action |
| --- | --- |
| Preparation | Fix the build/review/drift and create a new sealed archive; no remote writes occurred. |
| Schema initialization | Inspect the actual catalog and the original command. Never replay into a partially initialized database. A terminal failed attempt may be discarded in favor of a newly reviewed empty database. |
| Worker completion saved, readback interrupted | Confirm its tag, version, service/database bindings and required secrets; resume only the remaining steps. |
| CLI outcome uncertain | Establish whether the original operation ended, inspect routing/settings/assets as well as code, then review a forward repair. No automatic repeat. |
| Outside schema/Worker/CMS change | Reconcile the other operation and prepare against the actual state. |
| After all four Workers | Complete application acceptance and external-resource retirement separately. |

Whole-platform database/object/key restoration remains its own roadmap gate. During an incident, follow the [incident runbooks](incident-runbooks.md#11-failed-maintenance-or-release-sev2): no rollback command is part of this protocol. Historical source/build archives do not authorize restoring obsolete identity or billing authority.

## Verification for the current contract

- `tests/release-manifest.mjs`: exact current schema, archived bytes, secret exclusion, empty/unbound initialization, active-database and occupied-schema refusal, binding drift, uncertain import hold, failures after all four Worker steps, no repeated confirmed operation, and nonempty CMS metadata preservation for ordinary releases. Uses a fake provider; performs no CMS operations.
- `tests/current-schema.mjs`: current account shape, actual local D1 initialization/readback, immutable spent invitations, repeat without clearing rows, and schema drift refusal. No remote mutation.
- `tests/build-snapshot.mjs`: complete current-schema/build/compiler inputs and source/asset drift.
- `tests/release-bundles.mjs`: actual local Wrangler compilation and archived `no_bundle` round trips for runtime, apps, sites and platform, with unchanged executable bytes. No deployment or provider credentials.

Cloudflare's documented interface is [`d1 execute --file`](https://developers.cloudflare.com/d1/wrangler-commands/) with an existing target database; [import guidance](https://developers.cloudflare.com/d1/best-practices/import-export-data/) documents the SQL import and reserved D1 table. Checked October 1, 2026. Local or synthetic evidence does not establish that the live test environment has changed.

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

Interrupted release `ddd4bab3-27a3-4aee-9c87-34fc9ab33bbf` and its original journal remain unchanged as evidence. Positive command completion and live IDs/tags/binding readback establish the partial state; no unknown upload is retried. Because the helper fix changes the archived toolchain, continuation uses a newly reviewed release against that current state, with no pending SQL. Final release identities and application verification belong to [the feature evidence](project-specification-storage.md#historical-verification-and-deployment). This is a real stopped-release reconciliation, not a deliberate fault-injection or complete disaster-recovery drill.


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

## Current-only billing reset — October 1, 2026

Managed release `438cdaa6-4ef5-46b8-a8c1-ea3115ef61af` applied the owner-authorized disposable test reset `0117_current_billing.sql` and all four current Workers from source `75e41ff`. Version-2 review and forward recovery rules were used; no old billing reader/conversion remains. Independent schema, authenticated API and exact asset readback passed. [Version identities and bounded acceptance](current-version-policy.md#test-deployment-acceptance) record the evidence. This is a current test cutover, not legacy runtime support or a full recovery drill.

## Current Chat, website and CMS contracts — October 1, 2026

Managed release `925bb8a8-12b2-44f5-807a-251ab85a5905` deploys source `56cf575` with schema 0118/0119. This removes old command presentation/approval proof, guided/full-page website writers, compiler/schema-1 admission and CMS body/provenance compatibility paths. The schema reset clears retired workspace creation state; pre-cutover inspection found no old website/service-client/CMS content rows to delete. The owner's uncertain AI request and provider credentials remain intact. All four steps completed and independent version/binding/schema/asset/authentication readback passed. [Exact versions and verification limits](current-version-policy.md#current-contract-test-release). CMS functional testing remains deferred.

## PR #160 shared modules and contact email cutover — October 4, 2026 UTC

Owner-authorized database initialization cutover: created new empty database whumpo-control-2026-10-04 (ID: dba4c707-a0c0-4084-969b-6c43f6afebde), initialized complete current schema, and deployed all four Workers. Source: PR #160 branch `c/great-curie-8ryukc`, commit 1aa8f7c (config update: database bindings).

Managed release `ebe32e52-6b71-4977-b56e-8976d1cf26c5` completed schema initialization → runtime → apps → sites → platform without repair/retry. Schema initialization at **2026-10-04T20:12:59.871Z** confirmed 219 tables, 1050 objects. All four Workers deployed and verified at **2026-10-04T20:14:02.808Z**.

| Worker | Deployed version |
| --- | --- |
| runtime | `d74721c0-8780-41d5-a7c2-b906294c0eb4` |
| apps | `e57f3682-5d73-4d82-a486-91454c1468c2` |
| sites | `2cd364e3-bc4a-41dd-9a62-e6312af48993` |
| platform | `cff0db50-216f-4e52-ad0c-63bff524e246` |

Independent readback verified: homepage 200, anonymous Chat API 401 (proof required), health endpoint 200, all bindings match new database. CMS registry unchanged (empty). Schema SHA256: `68617fbf7b3757411247514411e3a7beb637df9ce1d1b090a22fc03c1c6f2742`. Owner invitation file: `.secrets/invitation-dde54bea1f61.txt` (private). Test data reset authorized and executed per PR #160 authorization on 2026-10-04. Baseline database 418b20b6-bdba-4ff1-b265-da9da9ad5955 remains (not deleted). No paid services, CMS functional testing or customer publication. Deployment complete; ready for PR merge to main.

## After CI supersedes an owner-applied release

Workers Builds redeploys main through `deploy ci` after an owner `apply`, so the Worker tags change. `status` then reports `reconciliation.result: "superseded by a later release"` with the live version IDs and tags (only when the journal is `deployed` and every step is confirmed; otherwise the original error stays). That journal is now historical: do not reconcile it. Start a new `prepare` for the next owner release.
