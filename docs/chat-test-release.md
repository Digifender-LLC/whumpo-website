# Current Chat test cutover — October 2, 2026 UTC

This release carries the current WH-106 storage/recovery and WH-107 maintained Chat forms, choices, status/comparison cards, photo-upload handoff and mobile/accessibility work. The user authorizes disposable test resets and current-only deployment. It does not close those packets' remaining device or product acceptance.

## Reviewed preparation

Source `fbc140d` has passed the connected local HTTP/D1/R2 browser journey, seven actual Orca speech-generation checkpoints, focused Chat/customer-site regressions, both TypeScript/compiler checks and the frontend build. These are source/local results; release identity and remote acceptance are recorded separately below when complete.

Read-only inventory at 2026-10-02T22:48:03.948Z matched the four Workers from protection release `7c4f9344-bd6c-4fc7-a3ab-964e631ad8f3`. Its database has 165 tables/760 objects; current source requires 172 tables/785 objects. All application tables were counted: no users, projects, credentials, sessions, provider work, billing obligations, publications, CMS registrations or file rows exist. The private R2 bucket is empty. Only one unused invitation and known policy/plan/maintenance/deployment control rows exist. Private evidence: `.secrets/chat-cutover-inventory.json`.

The coordinated reset fences that unused invitation, selects a distinct empty D1 database in platform/apps/sites, and initializes the complete current SQL. Runtime → apps → sites → platform preserves the existing service contracts; the runtime, app host and site host source interfaces are unchanged from the prior release. No admitted account/publication/provider operation can cross the mixed-database interval. No old account, content or schema reader is retained. A new owner invitation is issued only after verification.

Existing Worker secret bindings remain unchanged. The existing verified encrypted key capsule initializes the current connection-key policy through its domain handler after deployment, before admission. This preserves the accepted current key identity; it does not establish off-device custody or whole-platform restore. Old database retirement follows completed release, fixture cleanup and account-wide reference/obligation checks.

The replacement uses the already authorized Workers Paid account. [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) checked October 2 includes 5 GB storage, 25 billion monthly reads and 50 million monthly writes. Database creation has no capacity/hour charge; queries/schema writes consume the shared allowance. Inventory is approximately 6 MB across ten databases before replacement. Remaining monthly account usage is not inferred from storage. No upgrade, new service subscription, real payment, customer DNS/publication, CMS functional test, CSAM or Daybreak work is included.
