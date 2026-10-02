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

WH-107 remains open for its original remaining scope and device acceptance. The automated local Orca evidence and live Chromium mobile viewport are separate from human listening, physical-phone keyboard, VoiceOver/TalkBack and installed-PWA acceptance. Live-model form selection, custom composition/views, broad owner acceptance, off-device key custody and whole-platform recovery remain separate work. CSAM, Daybreak and CMS functional testing remain deferred.
