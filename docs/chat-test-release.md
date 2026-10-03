# Current Chat test cutover — October 2, 2026 UTC

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
