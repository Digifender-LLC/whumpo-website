# Workspace views test release — October 3, 2026 UTC

Release `0955f19c-b69e-4dae-b7e7-972e5df3aa3c` deploys source `81a7b9fb62a86309f4cf11b4c4c50afdf77cfa0b`. Readback at **2026-10-03T05:25:42.286Z** verifies the current 175-table/796-object schema, all four Worker versions, all database/service/secret bindings and 39 exact platform assets. The archived dirty flag is the untracked local dependency symlink; runtime source and configuration were committed before preparation.

| Worker | Verified version |
| --- | --- |
| runtime | `5d709b90-be4e-4d04-af1b-1c37fde4de83` |
| apps | `cc72a745-cdd5-4b24-887e-63d958b84209` |
| sites | `d0886473-523f-4c5a-a85d-b8cf741b53c0` |
| platform | `93c67e1c-c4f8-471e-b368-ddd794a49d76` |

## Current-only cutover

Fresh inventory found zero accounts, projects, provider/billing/publication/CMS obligations and empty private R2. One unused invitation was removed to fence test admission. Three obsolete synthetic file-cleanup intents had no remaining stored objects. All three control bindings now use the distinct `whumpo-control-views-test` database, initialized with the complete current schema. No old rows, layout readers, undo aliases or numbered migrations were carried forward.

The sequential runtime/apps/sites/platform release completed without repeated or uncertain deployment commands. The empty account stores and unchanged inter-Worker service contracts were reviewed for the mixed interval. Existing Worker secrets were preserved; the new database's active key policy and registry were verified against the retained sealed key backup. This does not establish independent off-device custody.

After acceptance and synthetic cleanup, all **14 account Worker binding inventories** were checked. The old database had no references or outstanding account/provider/object obligations, and its release lease was released. Its deletion was confirmed at **2026-10-03T05:29:46.079Z**; the other ten databases were preserved. A fresh owner test invitation was saved privately, without putting its code in Git or chat.

## Deployed application acceptance

A fresh disposable identity with two signed ES256 keys exercised welcome gating, profile and first-project completion, current private cookies, logout, second-key login and session revocation. Anonymous private endpoints deny access, old identity routes and cookies are rejected, foreign-origin admission fails and an unknown customer subdomain returns 404. The existing Cloudflare consent start/cancel check confirms encrypted PKCE and current key continuity; it authorizes no provider access and makes no provider mutation.

The actual deployed React client and Worker completed all eight ordinary Chat requests using the configured Muse subscription:

1. Show project status/activity temporarily in Chat.
2. Correct the temporary view to project status/page requests.
3. Save that same corrected view as a custom page.
4. Add activity while preserving its other components.
5. Rename the page while preserving its definition.
6. Change Dashboard while preserving both custom pages.
7. Remove the requested page while preserving its project and unrelated layout.
8. Undo that removal using the latest owner-scoped receipt revision.

Eight main inference receipts and three bounded lookup continuations account for eleven main provider calls; eight acknowledgment receipts are separate. Exact request replay adds no calls. Reads, refreshes, navigation and temporary dismissal/reload also add no inference. Seven immutable layout receipts include setup and six requested persistent changes. The workflow created no website versions, proposals or publications and charged zero customer credits.

A separate fixture then prepared one private website and an exact headline review through the existing domain. Saved-page and temporary-Chat components opened identical before/after comparisons through the actual deployed readers. Revoking project read eligibility hid the private comparison on both surfaces. The saved website remained at revision 1; no review was applied or published and no additional model call occurred.

Both synthetic accounts were removed with verified dependent-row cleanup. The signed acceptance and layout fixtures are evidence of controlled test behavior, not human enrollment or physical-device acceptance.

## Mobile visual evidence and limits

The first full-run page screenshots captured a legitimate refresh state. The deployed helper now waits for the requested component response and visible bottom navigation before capture. A separate zero-inference visual probe completed at **2026-10-03T05:29:08.236Z**, with inspected settled 360/390px images: readable project status, explicit unavailable traffic, all five bottom navigation targets visible and no horizontal overflow. The exact-review 360/390px images from the full run were also inspected. The supplemental probe confirmed the retired layout route returns 404 and the retired undo argument returns 400.

The first supplemental probe was refused by the fixture's synthetic-email naming assertion before identity seeding. Its cleanup record is retained; correcting the fixture email produced the accepted run. No product gate was changed. The full model lifecycle was not repeated for screenshots.

All eight deployed acknowledgment receipts remain `uncertain`; the local provider envelope evidence separately showed the 256-token output cap being exhausted. WH-020 owns acknowledgment/latency and broader model reliability. The retained earlier model failures remain evidence. This successful bounded journey does not establish all-owner experience, human passkeys, native devices, beta readiness, paid launch or general application quality.

CSAM/scanner implementation, Daybreak and CMS functional testing remain deferred. No new paid service, premium route, real charge or customer publication was activated.

## Evidence and task acceptance

Private evidence includes the immutable release archive, `workspace-views-release-verification.json`, the full `workspace-views-live-0955f19c-b69e-4dae-b7e7-972e5df3aa3c` report/images, the two supplemental rendering records, key-policy and old-database retirement receipts. [The original-scope audit](workspace-views-acceptance.md) maps these results and the existing local negative/concurrency tests to all six WH-109 criteria. Broader lifecycle/account export and WH-110–112 journeys retain their own scope.
