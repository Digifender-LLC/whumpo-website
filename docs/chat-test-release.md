# Chat test releases — October 2–3, 2026 UTC

**Latest coordinated test release:** [workspace views, October 3](workspace-view-release.md) deploys source `81a7b9f` with 175 tables/796 objects and verifies the real-Muse saved-view lifecycle. The dated releases below retain their own earlier source/schema and verification scope.

**Previous coordinated release:** [bounded task-memory release](#bounded-task-memory-release--october-3-2026-utc), verified October 3 at 02:18 UTC. Earlier sections retain their exact historical verification scope.

This release carries the current WH-106 storage/recovery and WH-107 maintained Chat forms, choices, status/comparison cards, photo-upload handoff and mobile/accessibility work. The user authorizes disposable test resets and current-only deployment. It does not close those packets' remaining device or product acceptance.

## Reviewed preparation

Source `fbc140d` has passed the connected local HTTP/D1/R2 browser journey, seven actual Orca speech-generation checkpoints, focused Chat/customer-site regressions, both TypeScript/compiler checks and the frontend build. These are source/local results; release identity and remote acceptance are recorded separately below when complete.

Read-only inventory at 2026-10-02T22:48:03.948Z matched the four Workers from protection release `7c4f9344-bd6c-4fc7-a3ab-964e631ad8f3`. Its database has 165 tables/760 objects; current source requires 172 tables/785 objects. All application tables were counted: no users, projects, credentials, sessions, provider work, billing obligations, publications, CMS registrations or file rows exist. The private R2 bucket is empty. Only one unused invitation and known policy/plan/maintenance/deployment control rows exist. Private evidence: `.secrets/chat-cutover-inventory.json`.

The coordinated reset fences that unused invitation, selects a distinct empty D1 database in platform/apps/sites, and initializes the complete current SQL. Runtime → apps → sites → platform preserves the existing service contracts; the runtime, app host and site host source interfaces are unchanged from the prior release. No admitted account/publication/provider operation can cross the mixed-database interval. No old account, content or schema reader is retained. A new owner invitation is issued only after verification.

Existing Worker secret bindings remain unchanged. The existing verified encrypted key capsule initializes the current connection-key policy through its domain handler after deployment, before admission. This preserves the accepted current key identity; it does not establish off-device custody or whole-platform restore. Old database retirement follows completed release, fixture cleanup and account-wide reference/obligation checks.

The replacement uses the already authorized Workers Paid account. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) checked October 2 includes 5 GB storage, 25 billion monthly reads and 50 million monthly writes. Database creation has no capacity/hour charge; queries/schema writes consume the shared allowance. Inventory is approximately 6 MB across ten databases before replacement. Remaining monthly account usage is not inferred from storage. No upgrade, new service subscription, real payment, customer DNS/publication, CMS functional test, CSAM or Daybreak work is included.

## Verified release and remote checks

Release **`8542278b-700b-4816-8c83-ec8b61333188`**, source **`be2152aee866755dd3f9114bf1d74e7471297997`**, completed the current SQL initialization and all four Worker steps with direct command completion and exact provider readback. The archive's dirty flag records only the untracked shared dependency symlink, which is excluded from the payload.

| Worker | Verified version |
| --- | --- |
| runtime | `e72c6604-e792-48df-b481-89a5ef18f7d3` |
| apps | `920afada-0fda-4674-88c2-c1962c559329` |
| sites | `51ae6e42-3f9e-4720-b394-f13662cec8ac` |
| platform | `aa1ae803-bc0d-4229-a415-797dbe58680c` |

All three DB bindings select `whumpo-control-chat-test` (`dc420103-f80a-4f71-891e-e4d19287a7db`). The exact current schema has **172 tables/785 objects**, inventory SHA-256 `1bf9d4604f7729f2229e0bad687246987272af6814cfe8d5eac21f3235a781a0`. All secret/service binding names and **39 platform assets** match the archive. The existing verified key capsule initialized policy revision 1/key `test-20261002`; no Worker secret value changed.

Independent verification completed at **2026-10-02T22:56:32.004Z**:

- Home/workspace assets, health, anonymous no-store authentication refusals, unsupported routes/cookies, foreign-origin identity refusal and unregistered customer-subdomain 404 passed.
- Two generated ES256 keys exercised actual deployed login, project-first welcome, profile saving, first project, Chat, logout and revoked-session refusal. The account is explicitly synthetic; this does not prove human invitation/Turnstile or physical-passkey enrollment.
- The deployed 390px Chromium workspace recovered a saved draft after reload, prepared its private preview through the form UI, and saved the exact reviewed website through the existing typed action. Writing-style radio submission and history heading/close-return focus passed with zero browser exceptions; the resulting screenshot was inspected. Exact draft request/receipt replay, unsupported client refusal and photo-uploader handoff/current metadata readback passed. No image was uploaded or cleared.
- An exact temporary Cloudflare-connect preview exercised encrypted PKCE start/cancel. Recovered backup material reproduced the challenge; withdrawing the grant refused another start. No authorization URL was followed or token exchanged.
- There were **zero publications, inference calls, standard-AI requests or photo rows**. All 172 current tables were counted after fixture cleanup: only expected key/policy/plan/deployment/traffic control rows remained, and private R2 was empty.

The reusable opt-in Chat journey is [tests/helpers/live-chat.mjs](../tests/helpers/live-chat.mjs), called by the private signed-identity release harness. It uses the existing domain adapters to seed maintained forms for this synthetic account; it does not prove that a live model chooses them correctly. Private evidence: `.secrets/chat-release-verification.json`, `.secrets/chat-release-cleanup-inventory.json`, the cleanup journal and sealed release archive. Local current-schema (SQLite and D1), release-provider and release-manifest suites also passed before deployment.

## Obsolete test retirement and remaining acceptance

At **2026-10-02T22:57:26.684Z**, all **14 account Workers** had been inspected with no old database references. The old 165-table database had no accounts, invitations, provider/billing/publication work or objects, and its deployment lease was released. Deletion of `15f87c0c-8c4f-491f-a349-ff9c2c8a62b8` was confirmed by provider response and absence readback; the other ten databases were preserved. No old-schema runtime or reader remains. Private record: `.secrets/chat-database-retirement.json`.

Final release status after retirement confirms all four candidate versions, current schema and registration inventory. A new seven-day, one-use owner invitation was saved privately after cleanup. The previous invitation is invalid; no invitation value is retained in public evidence.

The subsequent [WH-107 audit](chat-renderer-acceptance.md) accepts the original renderer scope. Broader device/customer acceptance remains WH-024/112. The automated local Orca evidence and live Chromium mobile viewport are separate from human listening, physical-phone keyboard, VoiceOver/TalkBack and installed-PWA acceptance. Live-model form selection, custom composition/views, broad owner acceptance, off-device key custody and whole-platform recovery remain separate work. CSAM, Daybreak and CMS functional testing remain deferred.


## Conditional fields and prose proposal deployment — October 2, 2026 UTC

Source `e293ce18ca5a36808c6b4e85e600e6a401341bff` is deployed to the platform as **`1eba60f3-b783-4730-b7bc-937828458bd9`**, replacing `aa1ae803-bc0d-4229-a415-797dbe58680c`. The binding-preserving platform wrapper confirmed the complete current database before upload. No schema cutover or data reset was required; apps/sites/runtime and every platform binding remain unchanged from the coordinated release above. This is a scoped platform update, not a new four-Worker release journal.

Independent verification at **2026-10-02T23:42:32.040Z** matched all **39** built assets and confirmed homepage/workspace/health 200 and anonymous Chat 401. A synthetic account signed in through the current identity protocol and completed profile/first-project setup. The deployed 390px Chromium journey rendered suggested/default provenance, recovered the form on reload, prepared the private preview through its real UI, applied the exact separate review, submitted writing-style answers and verified history focus return, with zero browser errors. Exact draft replay, unsupported-client rejection and the maintained photo handoff/readback also passed. No photo bytes, model requests or publications occurred. The synthetic account, project and interaction rows were verified removed; other account data was untouched.

The reusable probe in `tests/helpers/live-chat.mjs` seeds a proposal through the actual domain adapter, so this proves deployed UI/HTTP behavior rather than live model selection. Scripted natural-language proposal selection is covered separately by the local agent suite. Physical-device, real-model quality, general custom-form issuance and broader customer acceptance remain open. Private evidence: `.secrets/chat-proposals-release-before.json`, `.secrets/chat-proposals-release-verification.json`, `.secrets/chat-proposals-probe-cleanup.json` and the platform deployment log.


## Purpose-bound custom form deployment — October 3, 2026 UTC

Source `792ff248e007ec1f5ebf7217797f0d9d8d3f548f` is deployed as platform **`459aa504-4aeb-46e5-8ee3-2a9c4283e5ba`**, replacing `1eba60f3-b783-4730-b7bc-937828458bd9`. The binding-preserving platform wrapper verified the complete current schema before upload. No schema/data reset or other Worker deployment was needed.

Verified **2026-10-03T00:20:28.015Z**: all **39** assets match the built snapshot; schema, every platform binding and all three other Workers match the recorded pre-deployment state. Homepage/workspace/health return 200; anonymous Chat returns 401.

A temporary synthetic account signed in with the current identity adapter, completed profile/first-project onboarding, and passed live 390px Chromium checks. The new composed service form preserves conditional local drafts through toggle/reload, submits only visible answers, retains an information-only receipt and leaves the website revision unchanged. The existing proposed-answer review, private preview, separate exact save, writing-style submission, history focus return, exact draft replay, stale-client refusal and private photo handoff/readback also pass. No browser errors, model calls, publication, photo bytes or payments occurred. Account/project/interaction cleanup was verified.

The probe seeds approved questions through the actual domain adapter; it does not prove real-model question selection. Scripted selection/minimized answer inspection and failed follow-up preservation have separate local evidence in [verification](verification.md#custom-chat-composition--october-3-2026-utc). Full WH-108 task-state/continuation/admission scope, physical-device and broader customer acceptance remain open. Private verification records: `.secrets/chat-composition-release-before.json`, `.secrets/chat-composition-release-verification.json`, `.secrets/chat-composition-probe-cleanup.json`; reusable probe: `tests/helpers/live-chat.mjs`.


## Model continuation cutover preparation — October 3, 2026 UTC

The current source adds a separately receipted owner-model continuation for submitted custom forms. It requires the complete current 172-table/786-object schema; the active 172-table/785-object deployment above remains the last verified release until a new release is recorded. No numbered migration or compatibility reader is introduced.

A read-only inventory at **2026-10-03T00:53:09.769Z** confirms the four Worker versions above and all 172 table counts: no users, projects, provider/billing/publication/CMS obligations or private R2 objects exist. One unused invitation and expected key/policy/plan/maintenance/deployment rows remain. The current-schema replacement can follow the previously reviewed admission-fence, distinct empty database, coordinated four-Worker deployment, current key-policy initialization and signed synthetic acceptance sequence. Preparation inventory: `.secrets/task-cutover-inventory.json`. No replacement database or remote mutation is claimed by this inventory.

The inference-free live release probe explicitly intercepts only custom model continuation after saving answers and then stops that unstarted follow-up through the real API. It verifies the deployed form submission and preserves zero live-model calls; it must not be cited as real-model continuation acceptance. Connected scripted continuation is exercised through the actual local Worker/D1/browser and recorded in [verification](verification.md#custom-form-model-continuation--october-3-2026-utc).

A distinct replacement, **`whumpo-control-task-test`** (`9a07c1b0-0925-4ef1-8ffa-46d9464cafc9`), has now been created and verified empty. The three local DB bindings target it; active Worker bindings are unchanged. The private creation receipt is `.secrets/task-test-database.json`. Admission fencing, initialization, coordinated deployment and remote acceptance are still pending.


## Verified model continuation release — October 3, 2026 UTC

Release **`cc5abfdb-fd7c-4d50-a9d7-39dd28ecc15a`** completed the current schema initialization and coordinated runtime → apps → sites → platform cutover. Independent verification completed at **2026-10-03T01:15:07.681Z**. All **39 assets**, every service/secret binding and the exact **172-table/786-object** schema match the archive. Database: `whumpo-control-task-test` (`9a07c1b0-0925-4ef1-8ffa-46d9464cafc9`), inventory digest `faf5af19d14f143e471322fe83dc80677678044510ccb374734e7544b353b0a6`.

| Worker | Verified version |
| --- | --- |
| runtime | `706225db-3b75-4cf9-ae5d-81ea43b1d210` |
| apps | `7bba899c-f469-4f0a-a908-4125e74ac3f1` |
| sites | `64c36aa5-fa89-436f-9cf3-e070a825f889` |
| platform | `738fcb2a-cbc3-4ccf-811e-734bb3200886` |

The sealed manifest records baseline `051e1f2` with a dirty source flag because the final agent-catalog wording was committed during preparation. Independent blob-by-blob verification proves all **448 archived source files exactly match committed `f96c38448d5675fd50a5c9117533ca467c726966`**, with no extra archived source. The immutable archive remains unchanged; `.secrets/task-release-source-proof.json` records this correspondence.

The existing key capsule verified and initialized the current key registry/policy without changing Worker secrets. Signed HTTP acceptance exercised two generated ES256 keys, first-project onboarding, logout/revocation, encrypted PKCE start/cancel and withdrawn-feature refusal. A synthetic signed-in **390px Chromium** journey passed proposed-answer review, private preview, exact separate save, choices, conditional custom-form draft/reload/submission, hidden-answer exclusion and history focus. Anonymous private routes refused with no-store responses, retired routes/cookies refused, foreign-origin identity requests refused, and an unregistered customer subdomain returned 404.

The live release probe deliberately intercepted custom model dispatch, verified the saved answers and stopped that unstarted follow-up through the actual API. It made zero model, publication, photo-byte or payment calls. This does not prove deployed real-model continuation; the connected scripted browser and one real Muse/local-D1 sample have separate evidence in [verification](verification.md#custom-form-model-continuation--october-3-2026-utc). Synthetic account/project/interaction cleanup was confirmed. Human enrollment/device, broad model quality, multi-turn task state and the full WH-108/112 acceptance remain open.

Private evidence: `.secrets/task-release-verification.json`, `.secrets/task-release-probe-cleanup.json`, `.secrets/task-key-initialization.json`, the source correspondence record and the sealed release archive. No CSAM, Daybreak, CMS functional testing, provider activation or real-money billing occurred.

### Retirement and final cleanup

The obsolete database was deleted and its absence verified on October 3, 2026 at 01:16 UTC after checking all 14 account Workers for references and every old table for customer/external obligations. Other databases were preserved. Final read-only inventory at 01:23 UTC confirms the current exact schema, all four Worker versions, ten remaining account databases and empty private R2. All customer, project, interaction, inference, provider and billing tables are empty; only the expected six control/catalog/telemetry tables contain rows. A fresh one-use, seven-day owner invitation was then saved privately. No invitation or credential value is recorded here.

Private evidence: `.secrets/task-database-retirement.json`, `.secrets/task-final-inventory.json` and the private invitation file. The release is complete within the verification scope above; broader WH-108, real-device, provider and customer acceptance remain open.

## Bounded task memory cutover preparation — October 3, 2026 UTC

Source `f064e56` has local handler/D1/browser acceptance and one real Muse/local-D1 two-turn sample. It adds append-only bounded task memory, removes the unused mutable task summary column, and requires the complete **173-table/791-object** schema (inventory `c3a49db2a5d26023a785b2f97a3803e624d1cddbcaafc39bcc838762e6dac248`). Current deployed source/schema remains `f96c384` / 172 tables until this cutover completes.

Read-only inventory at **2026-10-03T01:55:57.938Z** found zero users/projects/model/provider/billing/publication/CMS obligations, empty private R2, ten databases and one unused invitation. The new target is a distinct empty `whumpo-control-memory-test` database. Its creation/initialization uses the existing authorized D1 service; no service upgrade, new subscription or paid feature is requested. Before cutover, recheck the old database under the deployment lease and remove its unused invitation. Deploy runtime, apps, sites, then platform from one sealed archive; preserve current routes/services/secrets and initialize the existing verified credential-key policy before admitting a new owner. Runtime/apps/sites interfaces are unchanged. The fenced empty test environment permits the brief mixed-Worker interval; no zero-downtime claim is made.

Verify exact schema/versions/bindings/assets, signed HTTP and the existing mobile form journey; separately opt into one synthetic live Muse task-memory conversation with no publication or website apply. Retire only the old unreferenced empty database after all-account Worker checks and cleanup. No migration replay, legacy adapter, CMS functional test, scanner work, real billing or customer-provider consent is included. Private evidence uses the `.secrets/task-memory-*` files.

The new database was created and verified empty as `4e4c7449-d80a-49d1-bc67-b86034708f13`. All three local control DB bindings select this target. The old unused invitation was removed under the deployment lease after fresh zero-obligation and Worker checks. These are preparation actions; the following verified release record will establish deployment.


## Bounded task-memory release — October 3, 2026 UTC

Release **`c3f3eaae-2d19-47b4-baf7-278d51e0256c`** completed current-schema initialization and runtime → apps → sites → platform deployment. Independent verification completed at **2026-10-03T02:18:29.472Z**. All **39 platform assets**, service/secret bindings and the **173-table/791-object** schema match the archive. Database: `whumpo-control-memory-test` (`4e4c7449-d80a-49d1-bc67-b86034708f13`), inventory `c3a49db2a5d26023a785b2f97a3803e624d1cddbcaafc39bcc838762e6dac248`.

| Worker | Verified version |
| --- | --- |
| runtime | `7df8afe7-2f0a-4111-9ab4-1ff008802637` |
| apps | `861ee4eb-dd38-467a-aab4-d03a7b7eff90` |
| sites | `946cffc0-349a-4dbe-9a82-980f39fefdd7` |
| platform | `40cd694f-ae27-4df0-b844-96656e5d54ab` |

All **449 archived source files** independently match commit `5e903a6efa75bddf7cc46b4bdc5a1e503b16dd0a`; the dirty marker covers only the untracked dependency symlink. The existing verified key capsule initialized the current key policy, with matching fingerprints and unchanged Worker secrets. Signed HTTP covers current two-key login, first-project gating, revocation, encrypted PKCE start/cancel, withdrawn feature refusal, no-store private-route refusals and retired-route rejection. The existing 390px browser journey covers form corrections, private preview/exact save, choices, conditional custom submission, hidden-answer exclusion and history focus.

A separately opted-in **real Muse/deployed-Worker** sample submitted a public service area, received one season question, reloaded, and answered naturally. The agent selected the saved task, cleared that question and prepared exactly one Area section edit combining the submitted area and later season answer. Two immutable task-progress receipts, unchanged saved website revision 2, zero publications/customer credits and no extra inference on exact replay/reload were verified. It used **3 main model calls across 2 turns**, with **57,474 ms** elapsed through the mobile browser checks. Observed subscription-shadow estimates were 961 and 2,176 micros for the main turns; these are internal estimates, not API invoices. The separate acknowledgment receipt was **uncertain**, with unknown tokens/cost retained, and did not prevent the main result.

### Failure and evidence limits

The first live sample saved initial task memory but its later Chat turn ended `failed`, so acceptance correctly stopped. Its account was removed in `finally`. The original probe retained the assertion and cleanup, but not the failed turn's reason; **the cause is unresolved**. A fresh independent fixture passed with the same deployed code. This establishes a bounded successful path, not consistent routing or model reliability. The helper now captures synthetic turn/request/inference states before cleanup on future failures. No rejected/unknown request was retransmitted to obtain a different result.

The successful run's screenshot captured the loading shell immediately after reload; it is **not** visual evidence of the final rendered reply. The helper now waits for the actual saved owner message and checks width before future captures. That stronger final-frame check has syntax verification only at this checkpoint; no extra real-model run was made solely to replace the screenshot. Initial form interaction and reply submission were exercised in the real browser, and authoritative saved task/review receipts were verified separately. Physical phone, human passkey enrollment, broad model quality and full WH-108/112 acceptance remain open.

The obsolete `whumpo-control-task-test` database (`9a07c1b0-0925-4ef1-8ffa-46d9464cafc9`) was retired at **02:19 UTC** after checking all 14 account Workers for references, zero customer/external obligations, released deployment lease and empty R2. The other ten databases were preserved. Final all-table inventory at **02:19:21 UTC** confirms current schema/versions and empty customer/project/model/provider/billing/publication tables; only six expected control/catalog tables have rows. Both synthetic attempts were removed. A fresh one-use, seven-day owner invitation was saved privately after this verification; its value is never committed.

Private evidence: `.secrets/task-memory-release-verification.json`, `task-memory-release-source-proof.json`, `task-memory-key-initialization.json`, `task-memory-release-probe-cleanup.json`, `task-memory-release-first-attempt.log`, `task-memory-release-first-attempt-cleanup.json`, `task-memory-database-retirement.json`, `task-memory-final-inventory.json` and the sealed archive. No CSAM, Daybreak, CMS functional testing, provider activation or real-money billing occurred. WH-108 remains open for its original broader composition/resource selection and representative agent-selection acceptance.


## Custom approved-photo selection deployment — October 3, 2026 UTC

Source **`a992f95d4424ab6560bec1d30a2482acbbaf7691`** is deployed as platform **`8164406e-5bde-4565-8662-1b34edb3fa0a`**, replacing `40cd694f-ae27-4df0-b844-96656e5d54ab`. This scoped platform update preserves every platform binding, the other three Worker versions and the complete **173-table/791-object** schema from the coordinated task-memory release. No database reset or new four-Worker release journal was needed.

Independent verification finished at **2026-10-03T03:01:40.200Z**. All **39 assets** match the build snapshot. Homepage/workspace/health return 200 and anonymous Chat returns 401. Signed synthetic HTTP and 390px Chromium passed the existing private draft/proposed-answer/preview/exact-save/choice/custom-form/history journey, then the new photo picker: current client binding, approved same-project metadata, draft reload, revoked-selection refusal, explicit clearing/reselection and immutable submitted IDs. The final 390px screenshot was inspected. No image bytes were fetched; synthetic metadata has no corresponding R2 object and is not evidence of real safety clearance.

Both custom continuations were explicitly intercepted before inference. These checks establish deployed UI/storage behavior, not live-model selection or physical-device acceptance. The temporary account and photo metadata were removed with scoped readback; zero inference, publications or real charges. An initial harness attempt refused the synthetic email naming convention before seeding; the corrected probe completed without product changes.

Private evidence: `.secrets/photo-selection-release-before.json`, `.secrets/photo-selection-release-verification.json`, per-attempt `.secrets/photo-selection-release-cleanup-*.json` and `.secrets/cms/platform-deploy.log`. Broader WH-108 selection and WH-112 owner/model/device acceptance remain open; the earlier unexplained task-memory failure is not resolved by this inference-free deployment probe.
