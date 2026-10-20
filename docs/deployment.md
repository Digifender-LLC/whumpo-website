# Whumpo test deployment

## How deployment works now (October 4, 2026)

**Merge to `main` deploys.** One Cloudflare Workers Builds production trigger on `whumpo-platform` watches `main` of this repository (root `/`; changes only under `docs/`, `*.md` or `integrations/emdash/` do not build):

| Step | Command |
| --- | --- |
| Install | automatic from `pnpm-lock.yaml` (Node from `.node-version`) |
| Build (gate) | `pnpm check && node tools/verify.mjs fast && node tools/verify.mjs protection && pnpm build` |
| Deploy | `pnpm run deploy ci` |

`deploy ci` (`tools/deploy-ci.mjs`) refuses to run outside Workers Builds. It verifies the build snapshot, generates its own version-3 review record from the commit SHA with `schemaChange: "none"`, refuses if the live control database is not exactly the current schema in that commit, if the configured database differs from the live platform's, or if CMS registrations exist, then runs the ordinary prepare/apply release (runtime → apps → sites → platform) under the D1 deployment lease and prints the journal to the build log. The archive lives only in the build machine; the build log is the record.

Do not deploy by hand: no `wrangler deploy`, `wrangler versions`, `pnpm run deploy prepare/apply` or `--remote` commands from agent machines. (`pnpm deploy` is pnpm's built-in; use `pnpm run deploy`.) Schema changes, control-database replacement and CMS retirement remain **owner cutovers**: create a new empty D1 database, point the three `DB` bindings at it in a PR, then the owner runs `pnpm run deploy prepare` with a `schemaChange: "initialize"` review and `pnpm run deploy apply` (see [releases](releases.md)). Merge the PR only together with that cutover, because the automatic deploy refuses it.

Runtime secrets are set by the owner with `wrangler secret put --name whumpo-platform` and persist across deploys.

### Current resources

| Resource | Name |
| --- | --- |
| Workers | `whumpo-runtime`, `whumpo-apps`, `whumpo-sites` (route `*.whumpo.site/*`), `whumpo-platform` (custom domain `whumpo.com`, crons) |
| D1 | `whumpo-control-2026-10-04` (`dba4c707-a0c0-4084-969b-6c43f6afebde`) is the database bound in `wrangler.jsonc`, `wrangler.sites.jsonc` and `wrangler.apps.jsonc` at source `d948f06` (October 11, 2026); created by the [PR #160 cutover](releases.md#pr-160-shared-modules-and-contact-email-cutover--october-4-2026-utc). The earlier `whumpo-control` (`418b20b6-bdba-4ff1-b265-da9da9ad5955`) was the baseline and is kept per that record. The live bindings were not re-read. |
| R2 | `whumpo-files` |

**whumpo cutover, October 4, 2026:** the four former `tellumo-*` Workers were renamed in place to `whumpo-*` (keeping their secrets, `whumpo.com` custom domain, `*.whumpo.site/*` route and history). Release `2295230d-e3da-4bd7-8376-fe58c69495db` (source `da2fb30`) initialized the complete current schema in the new empty D1 `whumpo-control` and deployed all four Workers; R2 `FILES` is now the new empty `whumpo-files`. Test accounts, sessions and files from the old database/bucket were intentionally not carried over (owner decision: test users only). The old D1 `whumpo-control-chat-connections-test` and R2 `tellumo-files` are untouched and await owner retirement. (The later October 4 PR #160 cutover replaced this `whumpo-control` database with `whumpo-control-2026-10-04`; see Current resources above.)

**October 3, 2026 release (superseded by the October 4 cutovers below and in [releases](releases.md); counts are that readback's):** [routine Chat status and traffic](chat-routine-release.md) `26d0acd8-ff05-45a4-810d-d593b8f29256`, source `74c95a3`, verifies four Workers, the unchanged 176-table/801-object schema, bindings and 39 assets. Deployed real Muse/Chromium passes selected-task overview, current count refresh without inference, natural status, revoked-access clearing in both cards and model replies, reload, signed two-key identity and cleanup. Final readback at 10:59 UTC confirms zero synthetic accounts/projects/traffic and one existing owner invitation. Local SQLite 130 cases, focused D1 18 cases, the seven-call built-browser journey and two real-Muse/local-D1 five-call conversations pass. Two uncertain acknowledgments remain WH-020 work. #98 remains open for admitted media/consent and broader recovery; #99/#95, physical-device and customer acceptance remain open. This update keeps the current database and schema; no reset, migration or old reader. Use the [release protocol](releases.md).


## Earlier deployment records

**Current service-settings release, September 30, 2026:** `03b74965-16b8-4a41-8848-33cb1e21867f` deploys source `6740b4c` with all **113 migrations** applied. Platform `175e4f9e-5d2a-4f2d-bc37-11365740ba3f`; sites `46f134ee-a986-436a-84b5-d043635313da`; apps `c72ba375-aad6-4eed-ba49-34079111d485`; runtime `15d53d91-0b00-4859-b749-2d4f63e15a0b`. Independent readback at October 1 01:41 UTC verifies versions/bindings, 48 migration objects, workspace HTML, all 16 frontend assets, health and anonymous authentication boundaries. [Service-client contract and acceptance](project-service-clients.md) covers private save/restore and separate exact activation. No new paid resource, customer publication, provider activation or CMS test. Private archive/readback details are in that feature document. Authenticated configured-Muse acceptance passed at 01:44 UTC: private settings prepare/change/restore, exact retries, reviewed disabling of inactive contact intake, zero standard-AI customer debits, no public content and verified synthetic cleanup.

**Previous repair release, September 30, 2026:** `76d4ced1-07eb-4e70-9f7e-e74c3bb1f48e` deploys source `4ca6624` with all **111 migrations** applied. Platform: `b9594686-c953-43df-a367-41c5bee42f52`; sites: `33483460-7750-4e9e-a7c2-4d781e56ddcf`; apps: `235f61c8-7a48-49cd-add5-1afc95cfb9e7`; runtime: `a8b1ac43-d3c7-410a-a675-bc334c65f8a6`. Readback at 23:51 UTC verifies four versions/bindings, 17 specification guards, workspace HTML, all 16 assets and authentication boundaries. It fixes editable-data delivery to the model continuation and operator account-cascade ordering; the first failed synthetic fixture's cleanup is verified. [Authenticated live acceptance](project-specification-storage.md#authenticated-live-acceptance--september-30-2026) passed at 23:53 UTC: real-model private import/change/restore, exact approvals/replays, zero customer credit charge, no publication and verified fixture cleanup. Private evidence: `.secrets/specification-release-verification.json` and `.secrets/specification-fixture-cleanup-verified.json`.


**Saved website configurations, September 30, 2026, 23:39 UTC:** managed release `1ac986dc-5062-4e60-834d-44ba99ab7195` deployed platform `3f52ab8c-8c74-43a6-b4ba-9d12ab5cb0e3`, sites `eaaa5061-b7b4-49eb-a47f-ef5d42726a7d`, apps `7983185c-ee37-4cf1-bb28-64b842559ab2` and runtime `d9f2de1d-2a11-4515-a582-43d5925c48a8`. All **110 migrations** are applied. [Feature contract and acceptance](project-specification-storage.md) describe private import/change/preview/diff/apply/forward restore. Live readback at 23:40 UTC verified all four version identities and binding inventories, 17 new schema guards, workspace HTML, all 16 frontend assets, health and anonymous Chat/review authentication boundaries. No customer publication, new paid resource, provider route or CMS activation was performed.

This is the first completed live release using the four-Worker archive/journal protocol. The initial release `ddd4bab3-27a3-4aee-9c87-34fc9ab33bbf` stopped after the app upload because of a service-binding metadata comparison bug; its commands and unchanged bindings were positively reconciled before the new archive was prepared. [Recovery details](releases.md#live-binding-readback-correction--september-30-2026) preserve the original record. Application source is `bbf4469`, with release-tool correction `928878a`; the archive records the dirty checkout and exact build inputs, including concurrent development-tool configuration. Unrelated roadmap/tooling work was not included in those Git commits. Private evidence for that earlier 110-migration release: `.secrets/specification-release-110-verification.json`, `.secrets/specification-release-reconciliation.json` and the two release archives. Earlier entries below are historical.


**Natural-language Chat, September 30, 2026:** platform `2ed299fd-f7d4-4842-88c7-b7d950d7a59a` is deployed at 2026-09-30T20:49:28.692Z; all 108 migrations are applied. [Chat contracts and verification](natural-language-chat.md) cover the separate message/action routes, owned review receipts, agent knowledge and deferred vector retrieval. Only the platform Worker and its React assets were deployed through the binding-preserving wrapper. No customer content, other Worker, model route or paid service was changed. Readback at 2026-09-30T20:50:37.175Z verified workspace HTML, all 16 frontend assets, public health and authentication on both Chat endpoints. Private evidence: `.secrets/natural-chat-release-verification.json`.

**Release tooling update, September 30, 2026:** the former bare `pnpm run deploy` loop is replaced by prepare/status/apply commands with archived bundles, SQL and a partial-release journal. Read the [release/recovery protocol](releases.md) before the next deployment. Local tests and four actual Wrangler bundle round trips pass; this tooling update itself did not deploy or change schema. The standalone binding-preserving platform wrapper remains available; it is not a four-Worker release manifest.

Earlier September 30, 2026 at 18:36 UTC platform readback: `53df6f0f-d048-404b-9bb1-bd049215d4ef`, with all 16 frontend assets matching and health/auth checks passing. All 107 migrations were confirmed applied at 18:42 UTC, none pending. [Maintenance diagnostics](maintenance.md) records the deployment and remaining natural-cron acceptance. Private evidence: `.secrets/revocation-health-migration.json` and `.secrets/maintenance-release-verification.json`.

Fresh read-only reconciliation at 18:48 UTC reconfirmed the platform above, all 107 migrations, Monitor and the other Workers: sites `ba9b4c29-0566-4541-8747-0834183c1197`; apps `9bee8593-ee7f-4dd3-8934-2b41f43d692e`; runtime `662ea586-726d-4a00-ad22-d84024a7c0b2`. No configuration or deployment was changed by that readback. Full scope is in the [capability matrix](capability-matrix.md). The platform is **whumpo.com**, customer content is on **whumpo.site**, and the private repository is **zemdregon/whumpo**. Digifender addresses below are historical and have no product fallback. Workers Paid ($5/month) is owner-authorized. Private R2 and the separate QuickJS runtime are in use; customer Containers/Stream/Gateway inference are not enabled by the platform's plan.

Owner decision September 30: apply all pending migrations in the private test environment. At 14:21 UTC, `pnpm db:remote` applied 0075/0076; independent readback confirms all 93 migrations with no pending files and both Gateway receipt tables empty. No Worker or provider route changed. Private evidence: `.secrets/test-migrations-2026-09-30.json`. `pnpm run deploy` and `pnpm db:remote` now match this release policy. Keep the CMS-binding-preserving platform wrapper. Database changes are not reverted by Worker rollback.

Use [current readiness](acceptance.md), [domain configuration](whumpo-migration.md) and [reconciliation decisions](docs-code-sync.md) for current status. Owner recovery is now included in the active release; see [recovery acceptance](owner-recovery.md). The sections below are chronological evidence, including past resource inventories and deferred features subsequently delivered.

Current domain/frontend configuration: see [Whumpo migration](whumpo-migration.md). Older entries below are historical release evidence and do not describe the current hostname.

## Public pricing panel — September 29, 2026

Deployed the Monthly/Annual and Personal/Business pricing switches with three cards per audience to the test `whumpo-platform` Worker, active version `bca9c6e9-a275-4fde-a478-47a9effd6e63`. The deploy used an isolated checkout based on `c7223d2` containing only the pricing UI and policy update, so unrelated working-tree edits were excluded. No migration, payment flow, customer resource, or plan entitlement changed.

`pnpm check`, `pnpm build`, and `git diff --check` passed in the isolated checkout. The platform deployment wrapper verified the active Worker version. Live `https://whumpo.com/api/health` returned 200. Browser readback confirmed the default Try it/Starter/Personal view, switching to annual Business/Business Pro/Enterprise with $790/$1,390 annual prices, and the unavailable trial/contact controls. Trial card verification and Enterprise contact remain planned.

## Historical initial decisions

On September 28 2026, the user authorized digifender.com as the temporary test domain, invite-only registration, and the existing account's included Workers/D1 allowance without upgrades or paid-only services. GitHub is restricted to free features.

## Historical initial resources

| Resource | Name | Purpose |
| --- | --- | --- |
| Worker | whumpo-platform | API and Static Assets |
| Custom domain | digifender.com | HTTPS test platform |
| D1 | whumpo-control | Identity, projects, activity, invitations |
| Turnstile | Whumpo test platform | Free managed signup verification |
| Private repository | Digifender-LLC/whumpo-website | Source history |

The workers.dev endpoint and preview URLs are disabled. Wrangler manages the apex custom domain and its certificate. www is not attached.

The root URL serves the public landing page. The account and project dashboard lives at `/workspace/`, with direct invitation signup at `/workspace/?signup=1`. The landing page distinguishes the product vision from currently available test features.

## Historical initial cost boundary

The domain has a Free Website plan. The existing account reports Workers Standard enabled; the user approved its included allowance after that distinction was explained. This deployment does not change the subscription. Included usage is shared with other apps, so application quotas cannot guarantee an account-wide zero bill.

The stack uses features available with free allowances. R2, Containers, Sandbox SDK, Workers for Platforms, Registrar purchases, Workers AI, and hosted build services are not provisioned. AI testing now uses the user-authorized existing OpenCode Go subscription. Those parts of the broader design remain deferred. GitHub Actions runs only the read-only `.github/workflows/ci.yml` (type-check, build and roadmap render check); secret scanning and push protection are GitHub repository settings on pull requests and pushes to `main`, within the private-repository Free plan's included minutes. No deploy workflow, Packages, Git LFS, or paid apps are configured; deploy locally with Wrangler.

Static files are served without Worker invocation except /api routes. D1 reads/writes/storage and Worker request/CPU usage remain metered under the existing plan. Log sampling is 10 percent. Rate limits reduce application work but are per Cloudflare location, still require Worker invocation, and are not financial caps.

Official references checked:

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/turnstile/plans/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

## Identity boundaries

Deployed Workers caps Web Crypto PBKDF2 at 100,000 iterations, unlike the current local emulator. Password hashes use PBKDF2-SHA256 at that cap, followed by HMAC-SHA256 with a random server pepper stored as the `PASSWORD_PEPPER` Worker secret. Stored hashes include an algorithm/version prefix. The pepper is never in D1 or Git. Preserve it securely: changing or losing it invalidates existing passwords. This is an explicit early-test tradeoff; migrate identity to passkeys or a reviewed password service before broader release. Existing local accounts from the initial 310,000-iteration prototype cannot sign in after this change; create fresh local test accounts.

Invitation codes are random, expire in seven days, and work once. Only hashes enter D1. Signup atomically inserts the user, consumes the invite, and appends activity. Turnstile is checked server-side, including hostname and action. SQL triggers enforce 50 accounts and 20 projects per account under concurrency. Accounts retain at most 10 sessions. Auth requests are limited to 10 per minute per IP/location, general API calls to 120.

Email is an account identifier, not verified ownership. No special authorization depends on owning an email address. Email-based password reset, email verification, and support tooling remain future work. Passkeys and recovery codes were subsequently delivered as recorded below. Keep registration invite-only until those paths are ready.

## Historical initial operations

Run `pnpm invite` to create a code; open the generated local `.secrets/invitation-*.txt`. These files are ignored by Git and restricted to the local user. `TURNSTILE_SECRET` is a Wrangler secret. The configured site key is public.

Apply forward migrations with `pnpm db:remote`, then `pnpm run deploy`. The current migrations are additive. `wrangler rollback` can restore a prior Worker version, but never assume that it reverses database migrations. Before future destructive migrations, implement and verify database export/restore.

When replacing the temporary domain, update the Worker custom domain and Turnstile allowed hostnames. Cookies are host-only and API mutations enforce same-origin requests.

## Verification of first deployment

Deployed Worker version: `39e82470-efa3-411a-a7fb-bfd85ed20b91`.

TypeScript and local smoke checks passed, including concurrent project quotas. Live HTTPS checks passed for sign in, Secure cookies, project creation/read, cross-tenant denial, activity, and session revocation. Two temporary test users were inserted solely for those API checks and removed afterward with their related records. Missing-invite signup is rejected. The signup screen and its real Turnstile widget were checked in the browser; the widget reported success automatically. A full human invitation signup remains for the first tester.

## Chat workspace deployment — September 29, 2026

Worker version `3efe35dd-d526-4bea-b70e-5362faf14d51` adds guided conversation at `/workspace/`, compact service stats, and a Details menu. Remote migration `0003_chat.sql` applied successfully. The model adapter and draft catalogue are in source; `/api/plans` explicitly reports `draft: true` and `checkoutEnabled: false`. At that milestone, no provider calls or payments were enabled; see the subsequent AI milestone below.

Local validation: TypeScript, JavaScript syntax, provider contract tests, original auth/project smoke tests, and chat integration tests passed. Browser checks exercised login, two-step onboarding, project creation, persisted history after reload, and 390-pixel mobile layout. Live readback confirmed workspace HTTP 200 with chat markup, unauthenticated chat HTTP 401, and the draft catalogue HTTP 200. Authenticated chat behavior was tested locally; this deployment did not create a production test account.

## Passkey deployment — September 29, 2026

Worker version `4e941f8d-3978-4467-a16b-ada2cfbea849` deploys passkeys, recovery, and credential management. Migration `0004_passkeys.sql` applied remotely. Server/browser SimpleWebAuthn versions are pinned in package.json and pnpm-lock.yaml. No new Cloudflare service or paid capability was enabled.

All local auth, chat, provider, and cryptographic passkey tests passed. A live ephemeral credential verified on Cloudflare, received a Secure/HttpOnly session, accessed its chat, failed a replay, and logged out successfully. The temporary user and credential were then removed. New passkey accounts have no usable password hash. Existing password accounts continue to sign in.

Frontend source moved to `web/app.js`; `tools/build.mjs` produces the committed browser bundle. Both dev and deploy rebuild it. Local passkey tests require localhost:8787, since the development RP origin is explicit. A native passkey prompt on a real user device remains to be checked.

## Metered AI deployment — September 29, 2026

Worker `5cb3c049-92cf-4b33-8ecc-e62a7b4508f9` includes migrations 0005 (billing) and 0006 (AI turns), both applied remotely. `AI_API_KEY` is a Worker secret read from the user-supplied ignored key file. Vars select OpenCode Go Responses and `muse-spark-1.3-contributor`. There is no provider fallback or subscription change. Contributor training disclosure is shown beside chat.

A request reserves build units, claims dispatch once, persists its result before settlement, and releases unused units. Confirmed rejection releases the hold; unknown outcomes remain held. GUID/revision replay does not call the provider again. Guided commands cost no units. The UI shows balances and opt-in spending of existing credits; checkout and paid entitlement changes are disabled.

Jarvis modelgateway checks were adapted into the TypeScript response boundary; source provenance and port differences are in `jarvis-reuse.md`. Fixed diagnostic categories omit raw errors, prompts and secrets. Provider transport uses manual redirects and rejects non-success responses, so credentials cannot follow a redirect. Workers currently rejects `redirect: error`, although the public Request documentation lists it; `tests/runtime-ai.mjs` verifies construction in the actual Workers runtime. The receiver is explicitly bound for runtime compatibility.

Local checks passed for TypeScript, both protocol contracts, actual runtime request construction, atomic reservations/settlement, owner isolation, concurrent messages, replay and unknown-outcome handling. Earlier live probes failed before network dispatch due to redirect mode; their temporary users were removed.

The corrected live check passed signed passkey login, a real Muse response, settlement of 3 build units with zero held units, identical-request replay without additional charge, authentication replay rejection, logout and session denial. Its exact temporary account and dependent data were removed afterward. This verifies text planning and metering, not site generation or publishing.

## Reusable private previews — September 29, 2026

Worker `c0fe62e4-d9d3-4ffa-b1e3-8859fb47ad0f` and remote migration 0007 deliver the first reusable component, `launch-page@1`. `/build` assembles a saved brief without inference; clay and forest variants are available. Private preview links appear in chat. Exact HTML, configuration, component ID and digest are retained per version in the existing D1 database, capped at 25 versions/project and 32 KiB HTML/version. No new service was provisioned.

Preview reads require the project owner's session, use no-store caching and CSP sandbox, and disable scripts/forms/network resources. Configuration is plain escaped text and an allowlisted theme. The static catalog never receives tenant records. Version, turn and activity creation share a transaction and revision guard.

TypeScript, chat regressions and preview integration checks passed, including concurrent duplicate requests, cross-owner denial, HTML escaping, zero billing usage and quota rollback. Browser inspection covered creation from chat and rendering. Live signed-in checks confirmed saved HTML, sandbox/no-store headers, unauthenticated denial, one version on replay and no usage debit. The temporary live account was removed with its dependent records. Public publishing, AI customization, backend site execution and active-version restore controls remain unfinished.

## Publishing and restore — September 29, 2026

Migration 0008 adds publication pointers, revisions and expiring exact-version reviews. Workspace Worker `b5fb96c8-aca3-442f-a770-5d05664101b0` provides review and confirmation through chat and the Details menu. Public Worker `e5fc8623-d1e7-4423-ac3f-c05a50549ff8` serves published pages at `sites.digifender.com/s/PROJECT_ID`. Wrangler attached this previously unused hostname and certificate. No subscription upgrade or paid-only service was enabled.

`/publish`, `/restore VERSION_ID` and `/unpublish` prepare a review; `/confirm REVIEW_ID` or the review button applies it. Review expiry, current publication revision, ownership and the plan's live-site limit are checked atomically in D1. Explore allows one live site. Public serving accepts GET/HEAD only and exposes no workspace API or authentication routes. It has only a D1 binding, no AI key or identity secrets. Responses remain sandboxed, script-free and no-store. New drafts do not alter live pages; restore uses the retained HTML; unpublish removes the public pointer.

The initial remote migration rejected a trigger written with `SELECT CASE ... END`; local SQLite had accepted it. A command sequence erroneously continued into deployment. The workspace was rolled back to the preview release, the guards were rewritten as `SELECT RAISE(...) WHERE ...`, and the remote migration succeeded. `tools/deploy.mjs` now makes migration success a mandatory gate before building or deploying either Worker. `pnpm run deploy` runs that sequence and stops immediately on failure.

Disposable D1 tests passed confirmation ownership, same-request concurrency, site quotas, stale/expired reviews, exact restoration, unpublish, public route/method boundaries and account deletion. Chat regressions passed after correcting a duplicate-request race. Browser checks exercised the review preview link and confirmation button, verified the button disappears after use, and observed the live-site counter update. Local development stores publication state locally; use the separate site-host dev server on port 8788 when inspecting that state rather than following the production hostname displayed by the current UI.

Live HTTPS validation passed signed passkey login, private preview, a review with no premature publication, exact confirmation, public serving, confirmation replay, publication of a second version, byte-for-byte restoration of the first version, and unpublish returning HTTP 404. Build-unit spending remained zero. The temporary user and its projects/versions/publication records were deleted after the check.

## AI website drafts — September 29, 2026

Migration 0009 is applied. Workspace Worker `ec09d701-3a77-43b1-8263-f2b802663d9f` and public-site Worker `bd0adaed-de49-44d8-b6e8-9ce5008bbb96` are deployed. Real Muse Spark 1.3 Contributor generated a synthetic bakery draft through signed passkey login: 7 units settled, zero held, one saved version, no duplicate inference/charge on replay and no public page before confirmation. The temporary account and dependent records were removed.

Isolated D1 checks cover owner isolation, schema/action rejection, escaped hostile text, version ancestry, version quota refund, review without publication and recovery after a lost commit acknowledgement. Billing regressions passed with structured model replies. `pnpm test:site-agent` runs these checks without provider credentials.

## Disabled Stripe test checkout foundation — September 29, 2026

Migration 0010 applied remotely before deployment. Workspace Worker `c77e6d3a-dc07-475a-8861-4be5b261287d` and public Worker `c07e15e7-88ce-4417-90bb-b98c4c36273e` are deployed. No Stripe account or credentials were configured, following the owner's decision to defer. Live readback confirms checkout and subscriptions disabled, unconfigured webhook 503, and healthy API. The usage dialog hides purchase controls and explains that test checkout is not connected.

`pnpm test:checkout`, billing regressions and TypeScript passed. Browser inspection verified the disabled state and refresh control. No Stripe API or real-money transaction was attempted; subscriptions and real Stripe end-to-end verification remain outstanding.

## Focused AI edits — September 29, 2026

A real Muse request changed a synthetic launch-page version from clay to forest while preserving its name, description, headline, introduction and empty section list exactly. Five units settled with zero held. The immutable base ID was retained; replay created no additional version or charge, and the public URL remained 404. The ephemeral account was removed. Focused-edit schema, cross-owner rejection, unchanged-field preservation and billing regressions pass locally.

The landing page now describes the implemented private draft/edit/publication/restore capabilities, and explicitly leaves photos, forms and custom domains on the roadmap. Guided-mode help no longer describes deployed AI functionality as globally unavailable.

Final focused-edit and landing release: workspace `5c5dca82-3414-461b-a15f-e7a87dec75ab`; public site host `725f683a-1b42-46a7-9550-d9af52ebd5c7`. Live landing readback confirms current capabilities and checkout remains disabled.

## Source export — September 29, 2026

Migration 0011 applied before deployment. Workspace Worker `5c33bf6e-3061-4a73-b487-4f6fe433d862` and public Worker `aceac50b-3542-46ef-b4d6-78cfda80bda3` are deployed. Exports use the pure JavaScript fflate 0.8.3 ZIP writer with no compression and bounded saved artifacts; no new Cloudflare service is required.

TypeScript, source-export integration tests and AI-agent regressions passed. Export tests cover archive filenames/content/checksum, independent Python ZIP CRC validation, deterministic downloads, private-data exclusion, ownership, concurrent chat retry, old versions, deletion and zero model usage. A browser downloaded the ZIP from the chat link. A live signed-passkey test downloaded a valid 4,513-byte archive, verified the HTML checksum, rejected an unauthenticated request, confirmed zero build units and replayed the command without another turn. The temporary live account was removed.

## Private project photos — September 29, 2026

Created private Standard R2 bucket `whumpo-files`; Wrangler confirmed r2.dev public access disabled. The existing `vidshare` bucket was inspected only for aggregate usage (8 objects, 7.92 MB) and was not modified. Migration 0012 applied remotely. The workspace Worker has the FILES binding; the public-site Worker still has only D1. A daily 03:17 UTC cleanup handler drains queued deletions and batches orphan cleanup without a subrequest per object.

Final workspace release `8626f466-75f6-45cc-a339-62e08f5a4765`; public host `c88aba48-a907-4bd2-b54b-27d0fee4b677`. TypeScript, `test:files`, and source-export regressions passed. Photo tests cover metadata stripping with independent pixel decoding, malformed/oversized input, owner isolation, concurrent upload IDs, conflicting reuse, lost R2 and D1 acknowledgements, quota-before-storage, authentication/Origin, cleanup and zero AI use. Browser upload converted a synthetic PNG to JPEG and displayed the saved private photo.

A live signed-passkey check uploaded a 640 × 400 synthetic photo (11,586 cleaned bytes), removed injected metadata, verified authenticated access/anonymous 401, retried without another file and used zero AI units. The temporary account, R2 object and its cleanup row were removed. The cleanup routine was exercised locally; its first scheduled production execution has not yet been observed. Photo placement into versions and public pages remains the next milestone, described in photo-publication-plan.md.

## Versioned photo pages — September 29, 2026

Remote migration 0013 applied before deployment. Workspace Worker `aa2f7001-c439-4a36-83a1-7c6e93ab6ce3` and public host `cf0e528c-d740-4388-83b4-89158a9a224f` are deployed. Both now have private R2 bindings. Public routes expose only photos referenced by the current published version. No new service or paid capability was enabled.

TypeScript and photo-version, file, publication, source-export and AI-agent tests passed. Checks cover owned dependencies, same-owner cross-project rejection, focused edits preserving photos, rejected foreign references, confirmed exposure, restore/unpublish revocation, complete ZIP image dependencies, missing-asset failures and atomic monthly operation budgets. The browser rendered an authenticated embedded-photo preview and an anonymous published image under their respective sandbox policies.

A live signed-passkey workflow uploaded a metadata-stripped synthetic JPEG, attached it without inference, confirmed publication, downloaded an image-inclusive export, then unpublished and verified image HTTP 404. It spent zero AI units. The temporary account, site and R2 object were removed afterward. Independent ZIP CRC and pixel-decoding checks passed. Direct offline file opening was blocked by browser policy, so that browser acceptance check remains unverified.

The landing page advertises photo-capable sites and still identifies forms and custom domains as upcoming. The files dialog explains publication exposure and that the AI cannot see image contents. Payments remain unconfigured and disabled.


## Domain ownership proofs — September 29, 2026

Migration 0014 applied remotely before deployment. Workspace Worker `5340083e-3570-4c36-ac5b-7f3b272fcd40` and public host `74c5dd44-9a7f-4aff-b5a9-e36697f6c4d6` are deployed. No provider custom hostnames, routes, certificates or DNS records were created.

TypeScript, domain integration tests and chat regressions passed. Domain tests cover exact DNS proof matching, malformed/oversized resolver responses, rejected redirects, owner isolation, independent same-hostname claims, retries, expiry/renewal, proof removal and atomic quotas. Browser inspection verified the Domains dialog and wrapping of long TXT values.

Live HTTPS validation passed signed passkey login, claim creation, idempotent replay, real DNS nonmatch, unauthenticated rejection, explicit not-connected state, zero AI spending and logout. The ephemeral account and dependent claim/project records were removed. Positive DNS matching was verified with a controlled resolver locally; no live customer DNS proof was installed. Payments remain unconfigured and disabled.

## Guided preferences and automatic first preview — September 29, 2026

Remote migration 0015 applied before deployment. Workspace Worker `24450413-cdf4-404b-a90f-c83997c2d526` and public host `452e9451-e4eb-43de-86ca-fc977115b55d` are deployed. Existing users and versions retain their state; new project preference columns have empty/ocean defaults.

TypeScript, onboarding integration, chat and site-agent regression tests passed. Onboarding checks cover concurrent replay, owner boundaries, saved preferences, interruption, skip/cancel, free-form style notes and rollback when the preview quota is exhausted. Browser testing resumed setup after reload and produced the private-preview link.

Live signed-passkey HTTPS testing verified all four setup answers, a command interrupting setup, one first preview on replay, brief readback, private-note exclusion from HTML, anonymous denial, public HTTP 404 and zero AI units spent. The temporary account and dependent project/version records were removed. No real model call was needed for this guided workflow. Stripe remains disabled; custom-domain hosting still awaits provider access.

## Natural-language project creation and source export — September 29, 2026

Workspace Worker `26882229-3d31-49bb-8f34-0151400802cf` and public host `d8a33ab3-536f-4cb8-a572-cc9712cf730d` are deployed. No migration or new infrastructure was required. The action vocabulary now permits a validated new project plus private first website and an export receipt for an exact owned version.

TypeScript, workspace-agent action tests and existing site-agent regressions passed. Checks cover atomic artifacts, quota refunds, rejected fields, foreign/missing export versions, replay and recovery after a lost transaction acknowledgement.

A live Muse Spark 1.3 Contributor request created a synthetic Cedar Garden Demo project with its first private website. Replaying the same message created no duplicate or additional charge. A second natural-language request produced an authenticated source-download link. The ZIP was extracted and its HTML SHA-256 matched the manifest; anonymous export returned 401 and the public site returned 404. The two AI requests settled 16 units with zero held. The ephemeral account, project, draft and receipts were removed afterward. Existing deterministic `/new` and `/export` remain free of model charges.

## Authoritative workspace inspection — September 29, 2026

Workspace Worker `2d7ecf99-2ad1-4283-82ee-5f11ea90ba44` and public host `c809f0f8-3630-465b-8890-9458e1a66ef3` are deployed. No new migration or service was required. The AI can select validated read-only inspection scopes; deterministic project/version inspection and saved-version aliases remain free.

TypeScript, workspace-read tests and workspace-agent regressions passed. Coverage includes server-derived output, foreign/missing targets, rejected query/URL fields, replay, guided zero-unit access, all twenty project identities and preview ownership beyond the five-project detailed context.

A live Muse request listed both exact database versions for a synthetic project, including the earlier version absent from its initial detailed context. The result was the server inspection receipt. Replay made no extra charge; `/inspect` returned the earlier forest version at no additional cost. The project remained unpublished (public HTTP 404). Six units settled with zero held. The temporary account and dependent project/version records were removed.

## Optional GitHub authorization foundation — September 29, 2026

Remote migration 0016 applied before deployment. Final workspace Worker `f07260cf-2a6e-4834-9abe-a7c3cc81de8a` and public host `26069cb4-7cef-4040-940a-35799b84b72f` are deployed. No GitHub App credentials or connection-encryption key are installed, so authorization remains disabled. No operator GitHub credential was copied into the platform.

TypeScript, GitHub connection tests and chat regressions passed. Controlled-provider checks cover PKCE, one-time session state, encrypted context binding, tenant boundaries, installation filtering, replacement, callback cancellation/disconnect races, queued single-token revocation, expiry, invalid/nonexpiring tokens, response bounds and lost commit acknowledgement recovery. Browser testing opened Connected accounts from chat and verified the disabled setup state.

Live signed-passkey testing verified authenticated connection status, disabled start 503, anonymous 401, cross-origin 403, a fixed no-referrer callback redirect, local disconnect and zero AI spending. It made no GitHub provider call and its ephemeral account was removed. Actual provider consent/revocation remains unverified pending the operator's GitHub App; repository backup is not implemented yet. Setup and credential-file instructions are in `docs/integrations/github-app-setup.md`. The existing daily maintenance handler now waits for photo and GitHub cleanup independently; real scheduled GitHub revocation has not been observed.

## Current application snapshot and design refresh — September 29, 2026

Application source is `3827e65`, with migrations through `0024_version_removal.sql` applied locally and remotely. Workspace Worker `33b737b3-b224-477b-ab6d-226d17192395` and public Worker `80b6e5f1-ef3d-4da2-bbd7-f97ff0783f5e` are deployed. Later documentation-only commits do not imply redeployment.

Since the GitHub authorization foundation above, code for reviewed GitHub backups, custom-hostname leases/recovery, monthly plan receipts, photo/version removal, Cloudflare OAuth and reviewed TXT DNS controls has been added. Detailed contracts and verification limits are in `docs/integrations`, `docs/plan-lifecycle.md`, `docs/photos.md`, and `docs/version-retention.md`. Provider connection and custom-hostname credentials remain absent; real customer consent, backup commits, DNS writes and hostname/TLS acceptance await setup. Stripe remains deferred because the owner has no account.

The latest version-removal deployment passed ownership, publication/backup race, expiry, replay, tombstone and photo-retention checks. Live signed-passkey testing removed one unpublished synthetic version, confirmed preview/export denial and replay safety, and preserved another live version. Its temporary account and site were cleaned up. No AI units were consumed.

The revised Word design v0.4 records this snapshot and the unfinished MVP requirements. Its 30-page render was checked page by page for clipping, table layout and readability; the original reference document remains unchanged. This design refresh changes no deployed application code or infrastructure.

## Reusable contact forms and private inbox — September 29, 2026

Remote migration `0025_contact_forms.sql` applied successfully before runtime deployment. Final workspace Worker `647c07d6-40ea-42b0-a80a-0effd1880a91` and public host `d3ba9c8e-d73b-4d59-aa02-3f4f7476665b` are deployed. The existing D1, rate limiter and Turnstile configuration are reused. No new binding, secret, paid service or email provider was added. `/contact/*` now runs through the workspace Worker before static assets.

TypeScript, contact integration tests, publication regressions and site-agent regressions passed. A synthetic browser fixture verified the private inbox opened with `/inbox`, displayed markup as literal text, and showed settings/status and deletion controls. The fixture server was stopped afterward.

A live Muse request prepared an exact contact review without activating it. Subsequent guided live checks passed explicit activation, public CTA/form HTML, invalid Turnstile rejection, cross-origin rejection, anonymous inbox denial, owner read/delete of a seeded synthetic message, no visitor content in chat, disabling, unpublication and signed-passkey session handling. Guided checks used zero AI units. All ephemeral accounts and dependent records were removed after each run.

The first live invalid-token check exposed a Workers `TypeError` during the verification request when using redirect error mode. Manual redirect handling with explicit non-OK rejection resolved it; the final deployment returned the expected validation failure. Redacted diagnostic logging records only a fixed event, processing stage and error class, never submitted fields, tokens or provider response bodies.

Successful real Turnstile completion and the first scheduled production retention cleanup remain acceptance gates. Controlled valid Siteverify responses prove the application path; a seeded live D1 message proves the inbox authorization path, not real browser verification. See `docs/contact-forms.md`. Stripe and optional account/domain integrations remain in their previously documented deferred/unconfigured state.

## Private version comparisons — September 29, 2026

Migration `0026_version_comparisons.sql` applied remotely before deployment and locally afterward. Workspace Worker `4b9de4d2-8099-4ca0-acec-b2c8a87c2c76` and public host `b73ce9cd-db3b-4124-9fdc-5e84e74213db` are deployed. No new service, provider credential or paid feature was required.

TypeScript, the new disposable comparison suite, publication regressions and version-removal regressions passed. Comparisons cover supported configuration fields, sections and photo references, not code-line or pixel diffs. Browser inspection verified desktop layout and stacked before/after fields at 390-pixel width. The temporary viewport was reset and fixture server stopped.

Live signed-passkey acceptance created ocean and clay drafts, published the first, and verified a free guided comparison with an exact saved baseline. Authenticated comparison HTML was private/no-store, contained the exact theme change and no scripts; anonymous access returned 401. Missing and repeated baselines were rejected. Pending publish/restore/unpublish review pages worked, and a review became 409 after its publication was applied. A pinned comparison continued to show the old baseline after publication, while a new live comparison correctly showed no changes.

A live Muse request selected the comparison action and received the server-derived result with its pinned private link. Seven build units settled with zero held; replay added no charge. The test site was unpublished and its temporary account and dependent records were removed. This completes comparison acceptance for the currently supported static/photo components; broader application-data rollback, isolated execution, external-provider setup and the existing user-device/Turnstile gates remain separate requirements.

## Website-routing review milestone — September 29, 2026

Migration 0027 is applied. Platform version `58c05390-8055-4448-be24-e71e789e304b` and public-site version `31e1dd27-f7c7-4f9a-ab4c-8c148fe1f971` deploy the reviewed fixed-target CNAME workflow. The Domains panel and chat can prepare an exact DNS-only routing review; only an explicit user confirmation can dispatch it. Conflicting records are refused. Configuration remains disabled until customer OAuth and platform custom-hostname setup are supplied and verified. No new service, subscription or customer DNS record was created.

TypeScript, build/dry-run, disposable routing/TXT/chat/AI-DNS tests and live signed-passkey disabled-path acceptance passed. The live run verified configuration, field, authentication and Origin gates; zero AI usage; no saved DNS operation; and cleanup of the synthetic account. Local browser testing used simulated provider acknowledgements. Real-provider routing, propagation and TLS remain unverified. Stripe remains disconnected because the user has no Stripe account for now.

## Hosting controls in chat — September 29, 2026

Platform `9f9694c5-d4ce-4e49-9e4b-5ea66233a488` and public-site Worker `f5f4206e-7c63-4c79-95e9-30b3d9c372cc` expose the existing reviewed hosting lifecycle in chat. No migration or new service is required. AI can list connections or prepare reviews, while explicit user commands confirm, check or disconnect. A chat check cannot create a hostname or retry deletion, including during a concurrent disconnect; scheduled cleanup retains its existing behavior.

TypeScript, build, controlled hosting-chat/lifecycle tests and live signed-passkey checks passed. Guided commands used zero AI units. A live Muse hosting-list request settled at 6 units with zero held and no replay charge. Temporary account records were removed. Cloudflare setup remains disabled, and no real provider hostname/DNS mutation occurred. The full MVP remains incomplete, including real provider consent/routing acceptance, domain purchases and broader backend capabilities; Stripe remains deferred by the user.

## GitHub backup controls in chat — September 29, 2026

Platform `9b595e8a-af4a-423d-85ad-e7f67f68a5c9` and public-site Worker `05f01772-e25a-475a-b88d-af68e7e55662` add chat installation/repository discovery, exact backup reviews, explicit confirmation and observational result checks. Completed original review turns expose a verified commit link. Confirmation buttons require the complete saved server receipt; interrupted transcripts recover through `/backups`. No migration, new service or permission expansion was needed.

Controlled backup/chat regression tests, TypeScript, build and synthetic browser confirmation passed. Live signed-passkey checks verified setup/ownership gates, empty owned history and zero guided usage. A live Muse list request settled at 7 units, zero held and no replay charge. Test-account cleanup passed. The GitHub App configuration file is still absent, and no real customer repository commit or OAuth acceptance occurred. This is progress toward the full MVP, which remains incomplete.

## Unresolved AI hold recovery — September 29, 2026

Migration 0028 and platform `1126dbb7-8cc5-4348-bae2-7d041ed7f781` are deployed; public-site Worker version `54f63bbb-4437-4dfd-99d0-c1e80633956c`. The operator-only reviewed waiver CLI can absorb unknown provider cost and atomically release an aged customer hold, with an immutable audit receipt. It creates no model request, financial charge or provider operation. The Worker guards late token/draft result writes after a turn closes. No customer/model waiver capability was added.

Recovery, billing/AI integration, draft regression, TypeScript and build checks passed. Live acceptance used an artificial hold and test credits in a temporary signed-passkey account. The real CLI review/apply/replay path restored quota/credits once, preserved null provider-token data, closed chat and left no customer waiver endpoint. A fresh live Muse response then settled at 5 units with zero held and no replay charge. Cleanup removed all synthetic account and audit rows. Actual provider usage reconciliation, real integration consent/DNS acceptance, purchases and the deferred Stripe lifecycle remain outstanding.

## Published website health — September 29, 2026

Migration 0029, platform `1fc52f73-f0a3-4ed0-91aa-894f2467025b` and public host `4f4ac32f-f58f-4c42-85d9-0f8e56490cf5` are deployed. Publish/restore receipts now attempt fixed-origin HTTP verification of exact served HTML and photo response metadata. Saved results are available through chat and an owned API. The existing hourly trigger refreshes a bounded number of due results. No additional service, subscription or credential was required.

TypeScript, build, disposable health tests and publication/contact regressions passed. Live signed-passkey acceptance verified an actual shared-host publication and exact-version healthy receipt, cooldown, replay, ownership, Origin/authentication gates and zero guided AI units. Photo failures and scheduler behavior were tested with controlled local D1/R2; a real scheduled production run has not yet been observed. See [health scope and limits](site-health.md).

A live Muse health action returned the server receipt, settled 9 units with zero held, and replay added no charge. Unpublishing changed the result to unpublished. The synthetic account, site and owned check history were removed; its global daily-budget consumption was retained. Stripe remains deferred, external-provider setup remains unconfigured, and the broader MVP remains incomplete.

## Reusable dynamic directory — September 29, 2026

Migration 0030 is applied remotely. Platform `e10a10f5-2289-44e3-ab17-445b0b922b7e` and public host `acff74a6-c5e4-424f-a4ef-2b2575dfaba9` deploy private listing CRUD, exact confirmed public snapshots, a responsive directory page and a public JSON read API. This uses existing D1/Workers only; no new subscription or credential was needed. The Details menu and chat expose the service, with confirmation buttons for saved reviews.

TypeScript, build, the disposable directory suite, onboarding and website-health regressions passed. The legacy HTTP-only chat script initially found no server at localhost:8787; the disposable onboarding suite was then used for the intended regression scope. Browser checks verified desktop and 390-pixel directory layout, plus a synthetic chat confirmation button and saved receipt. No customer data was used in those previews.

Live signed-passkey acceptance verified private create/edit proposals, explicit confirmation and button metadata, case-preserved text/links, replay, exact public HTML/JSON publication, unchanged public content after a private edit, owner/auth/read-only gates and zero guided AI usage. A real Muse request prepared a listing review without applying it; explicit subsequent confirmation added the private listing. Eight units settled with zero held and no replay charge. Taking the service offline returned 404 at both public endpoints, and cleanup removed the synthetic account, website, snapshots and review history.

Directory data is independent of immutable website artifacts and static backups. Custom-domain directory paths, directory-specific monitoring, full application-data rollback, arbitrary schemas and isolated generated backend execution remain unimplemented. Broader MVP requirements and real external-provider acceptance remain open; Stripe remains deferred by the user. See [directory contract](directories.md).

## Directory history, recovery and data exports — September 29, 2026

Migration 0031 is applied. Platform `816e7512-a60e-48a5-87dc-50e2b48c9a3f` and public host `c7b5adb3-18e2-4961-a7e4-9211bbf051c3` expose applied directory history, reviewed private-draft restoration and pinned authenticated JSON exports. The database records immutable restoration ancestry and verifies same-project applied source bytes/digest. Full edit/publication history no longer blocks taking a directory offline. No new service or paid feature was introduced.

TypeScript, build, the new history/recovery suite and existing directory regression suite passed. The first deployment attempt stopped at a Cloudflare D1 authorization error before deploying runtime code. After a successful Wrangler account check, retry applied the migration and deployed both Workers.

Live signed-passkey checks verified applied-only history, exact restored listing data/digest, unchanged public data after private restoration, confirmation metadata, replay, pinned JSON with attachment/no-store/nosniff headers, anonymous rejection, wrong-project isolation and zero guided AI units. The export is saved data plus provenance metadata, not an executable backend bundle. Directory recovery does not establish rollback for arbitrary customer applications.

A live Muse request prepared the exact restoration review without modifying the draft or public data. Seven units settled with zero held; replay added no charge. Cleanup removed the synthetic account, site, snapshots and export/recovery records. The full MVP remains in progress, including broader backend execution and real external-provider acceptance.

## Design v0.5 and acceptance audit — September 29, 2026

Documentation-only update: the revised 32-page Word design preserves the original product scope and updates implementation sections for contacts, directory recovery/export, health checks, chat provider controls and audited usage waivers. The document was rendered and every page visually inspected. The original reference document is unchanged. No Worker deployment or database migration accompanied this update; the preceding directory-history versions remain current.

[The acceptance evidence map](acceptance.md) distinguishes supported delivery, unverified journeys, missing provider configuration and unfinished implementation. A read-only live secret inventory confirmed only AI_API_KEY, PASSWORD_PEPPER and TURNSTILE_SECRET. Stripe remains deferred by the owner. The next engineering gate is a fresh Explore account creating a site and making three subsequent natural-language edits within its normal 25-unit allowance, without injected credits. Separate successful calls do not establish that journey. The full MVP remains in progress.

## First-use AI budget and response contract — September 29, 2026

Migration 0032 raises the normal Explore allowance to 50 units. Current/future 25-unit periods receive an audited increase without resetting spending, holds or credits; historical and paid periods are preserved. The same floor handles a prior Worker inserting a period during rollout. No paid feature, subscription or new provider was enabled. The catalogue is now the source for new free periods.

The original 25-unit live journey created a website for 6 units, then rejected the first edit with 19 remaining because conservative reservation exceeded that balance. Compacting the full action prompt improved this, but a later run still stopped after creation and one edit at 15 units spent. The new allowance is based on those observed request costs and reservation headroom; no per-fixture credits are used for final acceptance. Token accounting and server-side action validation are unchanged.

During testing, compact-prompt wording also allowed the model to interpret the instruction as permission to return a bare action. A real-provider run against a disposable local database captured precisely that output on its third edit. It failed validation without saving or charging. The instruction now explicitly requires the reply/action envelope for every operation. No customer prompts or provider bodies were added to production logs. A separate network-interrupted synthetic account was identified and removed before retrying.

TypeScript, build, site-agent regressions, billing/AI concurrency tests, plan-period tests, usage-waiver tests, and the new exact-migration and first-journey suites passed. The migration suite covers replay, existing spending/dispatched holds, unchanged credits, paid and historical periods, and old-Worker insertion. The journey suite models 10/5/5/5 unit calls without grants, checks exact content/ancestry and replay, and rejects a bare action without charge. Live acceptance below is separate from synthetic-provider results.

Final deployed platform: `96603ffe-54a5-4c8c-8969-fc3d4b1e9434`; public host: `42eff548-009e-4e6b-864e-3aa56b821f9b`. All migrations through 0032 are applied. Live signed-passkey acceptance completed natural-language project/first-draft creation, theme edit, exact headline edit and section addition. Costs were 9, 9, 6 and 7 units: 31 spent, 19 available, zero reserved, no credit grants or overage. Each private preview returned successfully; unchanged fields and exact base ancestry were verified. Replay created no extra charges. The synthetic account and dependent rows were removed.

An earlier assertion expected a headline-ending period from an ambiguously punctuated instruction; the final request explicitly quoted the text and required the period. The four-step live pass establishes this journey under the normal allowance, not a guarantee for every prompt. A separate brief synthetic request elicited unnecessary copy-field questions, and model factual fidelity still needs broader acceptance. The full MVP, real external-provider consent, device checks and operational lifecycle remain unfinished. Word design v0.5 predates this allowance change; acceptance.md and these milestones supersede its 25-unit snapshot.

## Private generated-code runtime foundation — September 29, 2026

Added private `whumpo-runtime`, version `0cdb36f1-375d-49a8-bfa1-3d880220b960`, without public routes, preview URLs, credentials or storage. Workerd, remote preview and deployed service-binding adversarial suites passed. Custom CPU configuration was rejected by the provider's Free-plan validation and removed; no upgrade was made. The existing workspace remains version `9b8cdf4e-d510-4d28-b441-d3dcc40dd14c`. See backend-execution.md for limits, transport anomaly and remaining application gates.

## Owned backend draft/test gateway — September 29, 2026

Migration `0033_backend_versions.sql` and the BACKEND_RUNTIME service binding are deployed. Workspace version `915fcccf-60d0-438b-b3b2-d0ab0db065c5` provides authenticated private version-save/list/test routes. TypeScript, D1 ownership/quota/replay suite and local HTTP tests with the actual bound runtime passed. Live health returned 200; unauthenticated backend listing returned 401. An authenticated production gateway execution was not performed in this rollout. Private runtime execution through a deployed service binding was verified in the preceding milestone. Full generated-app publication and data recovery remain incomplete.

## Backend chat generation and testing — September 29, 2026

Main Worker `42201bb3-a257-427d-aec3-9ce6f4dcb1dc` exposes the existing private backend draft/test capability through guided chat and strict model actions. Guided source inspection and result retrieval are owned, tests are replay-safe, and generation records immutable drafts within the AI result transaction. No public backend publication or application data access was enabled. New chat suite, site-agent regression, first-AI-journey regression and TypeScript passed. One live Muse generation with disposable local D1 used 7 units and passed two actual workerd examples; live production health returned 200.

## Reviewed backend project data — September 29, 2026

Migration 0034 is applied remotely. Main Worker `d5832180-e364-4019-b954-5da94c72a421` serves owned bounded JSON state, exact transition reviews and user-only atomic confirmation. Private runtime redeployed as `e1881197-26e3-4c01-8aba-b1b87e76f78f`; no additional services or plans were added. `/api/health` returned 200 after deployment.

TypeScript, database state tests (concurrency/expiry/ownership/replay/lost acknowledgments), guided chat integration and local multi-Worker HTTP tests with the real QuickJS runtime passed. The HTTP test proves preparation leaves data unchanged, foreign-owner and cross-origin confirmation fail, and accepted/retried confirmation advances revision exactly once. These are local authenticated fixtures, not a production-account data migration exercise. No public backend endpoint was introduced. Dedicated data export/restoration, retention and customer-ready EmDash provisioning remain unfinished.

## Backend data recovery — September 29, 2026

Migration 0035 applied remotely. Main Worker `cf8d9ce7-f9b3-40da-a964-9b122e07722b` deployed with applied-snapshot history, private JSON exports, reviewed before/after restoration and chat confirmation/download buttons. No service or plan upgrade. Post-deploy health returned 200.

TypeScript, D1 recovery tests, chat action/control tests and local multi-Worker HTTP tests passed. A browser check using a disposable local password fixture verified the download link, exact restore review button, confirmation receipt, removal of the old button and a readback of revision 2 with the original empty document. This is local recovery acceptance, not native passkey acceptance. Screenshot is saved locally at `.secrets/backend-data-recovery.png`; it contains only synthetic fixture data. Temporary test tabs and local Worker processes were closed. Public backend publication, lifecycle retention, uploaded backup import and customer-ready EmDash remain unfinished.

## EmDash signed ownership bridge — September 29, 2026

Built and deployed private CMS `80586f76-8a62-4e8e-a738-8219f9cff821`. Its existing D1/R2/KV resources and absence of public routes are unchanged. A private service-binding probe returned 503 `CMS ownership is not configured`; no owner, project or bridge secret has been assigned in production. Main Whumpo remains on `cf8d9ce7-f9b3-40da-a964-9b122e07722b`.

TypeScript, private profile checker, Wrangler dry-run, gateway D1 tests and the reproducible actual EmDash setup/auth/schema integration passed. The latter uses disposable local resources and fixed synthetic credentials only. The source build command now runs the installed workspace Astro CLI directly, avoiding dependency on a globally discoverable pnpm executable. Project provisioning, consent, chat content management and public CMS launch remain unfinished.

## Reviewed CMS setup queue — September 29, 2026

Migration 0036 applied remotely. Main Worker `42c1bde7-2f75-4271-ac2d-1a5c52dcb78a` deployed with CMS setup reviews, user-only confirmation, deterministic isolated-resource registry and queued status in chat/HTTP. No CMS customer resources or credentials were created. The existing private CMS preview remains unassigned. Health returned 200.

TypeScript, D1 ownership/immutability/race/expiry/capacity tests, guided chat controls, AI server-receipt replacement and local HTTP auth/origin checks passed. Provisioning is explicitly queued, not ready. The provider resource consumer and signed bootstrap verification remain next; public CMS content management and publication are not yet enabled.

## CMS storage allocator — September 29, 2026

Migration 0037 applied remotely. Main Worker `64d74b3e-a861-433f-bf00-e4e4daaeff75` deployed with resource-receipt progress in CMS chat status. The operator command `npm run cms:provision -- PROJECT_ID` now consumes an approved request and allocates/records dedicated D1/R2/KV resources with immutable creation intents. It does not yet deploy or initialize the CMS Worker and never sets ready merely because storage exists. No paid-only feature, upgrade or public route is enabled.

TypeScript, real-D1 allocator/concurrency/recovery tests and CMS chat regression passed. Live read-only operator queue returned no unfinished requests; inventory lookup found the existing preview D1 and R2. No customer resource creation occurred. The deployed main health endpoint returned 200. Per-instance Worker deployment, credential installation, service binding and signed bootstrap verification remain next.

## Owner recovery release — September 30, 2026

Platform `cb34d460-4938-45c1-8447-fbcc254ebbd2` includes the reviewed lost-passkey flow, save-before-rotation, competing-attempt isolation and mobile-sized controls. Connected local browser/D1 acceptance exercised a lost response followed by recovery with the saved replacement code. Release checks and limitations are in [owner recovery](owner-recovery.md). No schema, provider, price, customer publication or live customer credential changed.

## Connection guidance release — September 30, 2026

Platform `4712f560-b629-4860-b0a0-fe30eae0953e` includes owner-scoped expired-authorization metadata and clearer Settings/Chat guidance. Cloudflare Connect now follows the existing disconnect-first rule; an older GitHub revocation does not mask a current active connection. Source `ca401f6`. No schema, scope, customer connection, DNS or provider authorization changed. The isolated release preserved prior recovery, pricing and CMS behavior. TypeScript checks for both projects, build, frontend-loading checks, connection Chat and Cloudflare OAuth suites passed. Live version/asset and access-boundary evidence: `.secrets/connection-guidance-release-verification.json`. Real provider consent remains a separate gate.


## Chat-first workspace refinement — September 30, 2026

Platform `7e0960c3-d38b-4fb2-88bb-af70173122e1` simplifies Dashboard to an overview with a site-unpublish safety entry. Removed routine action shortcuts and manual layout editing; existing validated agent layout tools remain. First-project guidance now invites conversation without a website/app/brief button group. Account controls, explicitly opened detail views and contextual human confirmations remain available. User-requested arbitrary action buttons are still an implementation gate.

No CMS instance was provisioned or tested. The prior CMS setup wording change remains undeployed. No migration, provider consent, DNS or customer publication changed. Both TypeScript projects, chat-rendering tests, frontend build and lazy-loading checks passed. Independent readback verified the active version, all 16 frontend asset bytes, health and anonymous/origin boundaries; private evidence is `.secrets/chat-first-release-verification.json`. These checks do not constitute an authenticated browser/device journey.


## Requested workflow shortcuts — September 30, 2026

Platform `33b11a8f-acdf-40dd-895f-4df5ca4d2146` adds optional, user-requested shortcuts on owned-project workflow tabs. The fixed catalog covers project status, versions, saved health, a fresh website check and application status. No default shortcuts, model-authored executable commands, new permissions or confirmation bypasses are introduced. Existing layouts require no migration. See [workspace contract](unified-workspace-and-capacity.md#requested-workflow-shortcuts--september-30-2026).

Local D1 persistence/isolation/schema/concurrency and agent-action tests passed, along with both TypeScript projects, frontend builds and loading checks. No authenticated browser or live-model shortcut journey is claimed by these tests.

Cloudflare deployment metadata confirmed the active version. Two independent public verification attempts failed with a connection reset and connection timeouts to whumpo.com; full public health/asset verification for this release remains pending. No second deployment was attempted in response to those network errors.


## Shortcut language and live model acceptance — September 30, 2026

Platform `e62fdedc-3a47-4f61-8f9c-1c08ba4fc49b` presents recognized workflow shortcut requests in plain language while retaining the exact-command disclosure. Rendering tests reject malformed/extended matches; both TypeScript projects and frontend builds/loading checks pass.

The opt-in `tests/workspace-shortcuts-live.mjs` probe uses a disposable local account and the existing Muse subscription. One natural request saved a page with exactly project/version shortcuts and preserved the default layout; exact replay made no extra model call. Both shortcuts ran through actual guided Chat handlers without additional AI units, and no site version or publication was created. Details and measured usage are in the workspace contract. This is live-model acceptance with local storage, not authenticated browser acceptance on whumpo.com.

At 15:08 UTC, independent verification succeeded: active version, all 16 frontend assets, health 200, anonymous private routes 401 and recovery cross-origin denial 403. This resolves the earlier public connection failures for the latest release. Private evidence: `.secrets/shortcut-language-release-verification.json`.


## Workflow page title and browser acceptance — September 30, 2026

Platform `a30b9af5-9d51-4fe7-81b0-fe4e5ff28aa1` displays a custom page's saved label in the browser title rather than its internal tab ID. Local browser acceptance verified the title and both shortcut-to-Chat actions with disposable actual D1; final assertions found exactly two guided shortcut requests, zero inference and zero publications. The mobile pages sheet and 390 CSS-pixel layout were checked separately. Physical-device acceptance remains open.

Both TypeScript projects, build and asset-loading checks pass. Independent live verification at 15:17 UTC confirmed the active version, all 16 frontend assets, health 200, anonymous private-route denial and recovery origin checks. Evidence: `.secrets/workflow-title-release-verification.json`. No schema, customer data, CMS resources or provider permissions changed.


## Standard AI accounting schema — September 30, 2026

Migration 0094 applied to the private test database under the owner’s all-pending-migrations authorization. Readback at 15:21 UTC confirms all 94 files applied, both standard-AI receipt triggers and zero requests. Disposable-D1 receipt race/isolation/replay/non-charging tests and both TypeScript projects passed. No Worker deployment or inference routing changed. The runtime receipt module still needs integration with Chat and internal cost receipts before unlimited standard assistance is active. Private evidence: `.secrets/standard-ai-migration.json`.


## Standard AI internal cost admission — September 30, 2026

Migration 0095 applied to the private test database under the existing authorization. Readback at 15:26 UTC confirms all 95 migrations, no pending files, both admission triggers accepting standard receipts and both guards preventing mixed accounting paths. Standard receipt and historical model-cost D1 tests passed, as did both TypeScript checks. Private evidence: `.secrets/standard-ai-inference-migration.json`.

No Worker release or Chat accounting switch occurred. Standard Chat still uses historical test units until its admission, completion and recovery paths are integrated; advanced model dispatch remains disabled. Undispatched internal-reservation cleanup now supports cancelled standard receipts in source. CMS testing remains deferred.


## Standard AI result guard and recovery — September 30, 2026

Migration 0096 applied to the private test database. Readback at 15:34 UTC confirms all 96 migrations, none pending and the late-result guard covering both standard and historical receipts. Private evidence: `.secrets/standard-ai-recovery-migration.json`.

Source Chat reconciliation now handles saved and interrupted standard requests without customer billing mutations. `pnpm check`, `node tests/standard-ai-recovery.mjs` and `node tests/usage-recovery.mjs` passed. No Worker release, provider dispatch, CMS test or customer publication occurred. Standard request admission and customer-facing accounting still need their coordinated switch before unlimited fair-use Chat is active.


## Standard assistance without customer credit charges — September 30, 2026

Platform `be22062c-8178-40eb-90d0-64858af27411` switches new Chat requests to standard receipts, including completion, failure and interrupted-response recovery. Standard work no longer checks or consumes historical test-unit/credit balances. Internal provider-cost records, bounded calls and the separate private-test capacity ceiling remain. Historical metered receipts keep their original recovery/waiver handling. Advanced dispatch and paid billing remain disabled.

Chat, agent usage lookups, Billing and Dashboard now describe standard assistance without a customer-unit meter or an instruction to buy credits. Billing separates the latest 20 standard receipts from historical charges. Full verification, explicit remaining beta gates and exact test commands are in [standard AI accounting](standard-ai-accounting.md#verification).

A live Muse call with a synthetic local zero-balance account created the requested workflow page and shortcuts: 5,984 input/1,061 output tokens, zero customer charges, no replay inference, no publication. Actual local browser/D1 checks covered desktop and 390-pixel mobile views. Independent public verification at 15:47 UTC confirmed active version, 16 matching frontend assets, health and anonymous/origin boundaries, all 96 migrations and none pending. Private evidence: `.secrets/standard-ai-release-verification.json`. No CMS testing or customer resource change was performed.


## Standard AI history through Chat — September 30, 2026

Platform `28677f35-6f81-487f-843f-9704fba457da` adds “show my AI requests,” paginated `/ai-history`, and owned `/ai-request REQUEST_ID` lookups. The agent's usage inspection includes standard request status. Metadata-only reads distinguish failed work from completed provider accounting and never retry or charge requests. Existing historical usage remains separately accessible.

Disposable-D1 standard/historical history suites, Chat rendering, both TypeScript projects, release build and loading checks passed. At 15:58 UTC independent public verification confirmed the active version, all 16 frontend assets, health 200, anonymous private-route denial, recovery-origin denial and all 96 migrations with none pending. Evidence: `.secrets/standard-history-release-verification.json`. No schema, provider, CMS service, connection or customer publication changed. Readiness and README accounting claims now reflect the standard-AI activation.


## Private customer usage-review channel — September 30, 2026

Platform `828912b1-21d7-484d-ace4-c623f5c82173` and migration 0097 add explicit guided review submissions, owned status/detail reads, one open request per account and an operator-only preview/apply response tool. Submission and all review-related Chat reads are permanently excluded from later model history. Customer projections omit operator identities and never query internal fair-use investigations. No warning, restriction, bill, external message or model call results from submitting a review.

The disposable-D1 review suite passed submission/replay, ownership, immutable scope/context, competing responses, lost acknowledgment, response visibility and actual provider-request context exclusion; standard Chat and fair-use policy regressions passed. Both TypeScript projects, release build and loading checks passed. Remote 16:08 UTC schema readback verified all four guards, 97 applied migrations, no pending files, Monitor and zero customer requests. Public 16:11 UTC verification confirmed active release, all 16 assets, health and authentication/origin boundaries. Evidence: `.secrets/usage-review-release-verification.json`. See [remaining appeal and operator gates](usage-review-requests.md#remaining-launch-work); no full enforcement workflow is claimed.

## Content-policy and US eligibility foundation — September 30, 2026

Platform `bb54e8fa-2f96-48fa-89b5-1f7492cb7be7` adds US self-declaration to password/passkey signup and versioned content-policy instructions to current inference, including their internal cost reservation. [Content safety](content-safety.md) distinguishes this foundation from unfinished upload/import scanning and server-side enforcement. Both TypeScript projects, build/loading, content-policy, provider and standard-AI Chat tests passed. Independent live verification at 16:22 UTC confirmed version, 16 matching assets, health/auth checks and 403/no-cookie rejection on all three signup endpoints without declarations. All 97 migrations remain applied; no new service or customer deployment.

## Backend import quarantine — September 30, 2026

Platform `aab040f8-7c60-46ec-8344-3133f4af8214` and migration 0098 are deployed. The direct source-upload API returns 202 for an immutable private quarantine receipt rather than an executable version. Scheduled bounded triage can block or require further review, never approve. [Safety scope and evidence](content-safety.md) documents remaining scanner integration and broader ingress gaps. Type checks, quarantine HTTP/D1 tests and the actual QuickJS customer-app journey passed locally. Live readback at 16:31 UTC confirmed all 98 migrations and four new guards, Monitor mode, 16 unchanged frontend assets and health/auth/signup boundaries. No customer content was published.

## Profile photo safety gate — September 30, 2026

Platform `2aa7f348-b078-4a73-885a-03cbff9d1510` and migration 0099 are deployed. Uploaded profile images remain hidden pending separate clear CSAM/sexual-content checks bound to their exact digest and current policy; existing unscanned pictures also stay hidden. Built-in artwork remains usable. No detection provider or approval endpoint is configured. Profile safety/authentication tests, both type checks, build and frontend loading passed. Independent readback at 16:40 UTC verified 99 migrations, three safety guards, 16 matching assets and health/auth/signup boundaries. See [scope and remaining detection work](content-safety.md).

## Project photo safety gate — September 30, 2026

Platform `a2e9dcb3-60ad-4a52-9547-eff3d749bd1a`, site host `ba9b4c29-0566-4541-8747-0834183c1197` and migration 0100 are deployed. Unapproved project photos cannot be attached, previewed, exported, published or delivered. Photo versions, storage and removal tests passed with synthetic approval fixtures, plus type/build/loading checks. Independent live readback at 16:52 UTC confirmed both versions, 100 migrations, seven safety triggers and the approval view, 16 matching assets and health/auth/signup boundaries; synthetic absent-photo GET/HEAD returned 404. No customer photos or approvals exist, and no scanner was activated. See [photo safety scope](photos.md).

## Photo scan reservation ledger — September 30, 2026

Migration 0101 was applied and independently read back at 17:08 UTC: 101 migrations applied, none pending, all three new triggers present and zero scan tickets. Platform remains `a2e9dcb3-60ad-4a52-9547-eff3d749bd1a`; no Worker or frontend redeployment was needed because the new result-handling module has no runtime caller yet. No provider or customer scan/approval was activated. Evidence: `.secrets/photo-scan-tickets-migration.json`.

`pnpm check` and the disposable-D1/R2 `node tests/photo-scan-results.mjs` passed for profile and project image results. See [integration scope and outstanding lifecycle/provider gates](content-safety.md#trusted-photo-scan-results--integration-foundation). Schema deployment does not establish real detection, provider acceptance, reporting or a complete scanning workflow.

## Photo scan retry lifecycle — September 30, 2026

Migration 0102 was applied and read back at 17:11 UTC: 102 applied, none pending, three ticket guards, the one-reserved-attempt index and both expiry-gated safety-reset triggers verified. Zero tickets exist in the test environment. The platform version is unchanged; the internal module still has no runtime dispatcher/provider caller. Evidence: `.secrets/photo-scan-retries-migration.json`.

`pnpm check`, `node tests/photo-scan-results.mjs` and `python3 tests/photo-scan-migration.py` passed. Synthetic tests cover concurrent retries, expired profile/project approvals, inconclusive/expired attempts, lost acknowledgements and preservation of existing ledger rows through the schema upgrade. No customer photo was scanned or released, and no external service was activated.

## Persistent screening requirements — September 30, 2026

Migration 0103 was applied and read back at 17:25 UTC: 103 applied, none pending, three screening guards verified and zero decision records. Platform remains `a2e9dcb3-60ad-4a52-9547-eff3d749bd1a`; no Worker deployment was needed for the currently unconnected module. Evidence: `.secrets/content-screening-migration.json`.

Both TypeScript checks, content-risk/sampling tests and disposable-D1 screening-decision tests passed. No customer content was processed, provider activated or restriction changed. Trusted history, detection/dispatch, receipt completion and atomic action authorization remain required before live integration; see [persisted requirements](content-safety.md#persisted-screening-requirements--source-foundation-inactive).

## Recorded US signup declaration — September 30, 2026

Platform `5304e582-2e39-473c-b694-99003bf3c9ce` and migration 0104 are deployed. New explicit US declarations are saved atomically with password/passkey signup; no historical consent was fabricated. Live readback at 17:29 UTC confirmed 104 migrations, none pending, the immutable declaration guard, zero existing declarations, financial Monitor unchanged, health/auth/origin boundaries, and all three signup endpoints rejecting missing declarations without a session cookie. All 16 existing frontend assets match the isolated release. Evidence: `.secrets/customer-eligibility-release-verification.json`.

Root `pnpm check`, content-policy and disposable-D1 eligibility tests passed; the isolated release passed both TypeScript checks and frontend-loading checks. Existing frontend assets were reused because this update changes only signup backend code. Successful receipt creation was verified locally with synthetic password and signed passkey signup, not by creating live customer accounts. Native-device passkey, human Turnstile and existing-account declaration rollout remain separate gates.

## Private Chat transcript download — September 30, 2026

Platform `de264003-9c96-4648-a228-4de5ed6e6538` adds the guided transcript-download request and contextual link. The private endpoint streams owned saved messages with a fixed upper revision and no inference. Chat history/export and reply-rendering suites passed, along with root type checks and isolated-release types/build/loading checks.

Live verification at 17:36 UTC confirmed the active version, all 16 matching frontend assets, anonymous export rejection (401), existing auth/origin/signup boundaries, Monitor unchanged and all 104 migrations with none pending. Evidence: `.secrets/chat-transcript-release-verification.json`. No new schema or provider was needed. Successful authenticated download and interrupted-stream behavior were verified with disposable local data; live owner content was not downloaded and native device acceptance remains open.

## Build snapshots and source reconciliation — September 30, 2026

`tools/build.mjs` now captures build inputs before building, checks they still match after the build, and writes a local `.secrets/build-snapshot.json`. The snapshot stores only SHA-256 digests/counts, not source contents or credentials. It covers `src/`, `frontend/` (including its public assets), `web/`, controlled visitor inputs, package/lock files, TypeScript/Vite/Worker configuration, and the build/snapshot/platform-deployment scripts. Generated `public-app/visitor.js` is included with `dist/` as output rather than as an input. Selected directories are checked recursively; symlinks within them are refused. The root's old untracked `public/` directory is not a Vite input.

`deployPlatform()` verifies the snapshot before reading configuration, acquiring the deployment lock or calling Cloudflare. A missing/malformed snapshot, changed input/output, or added/removed file aborts with instructions to rebuild that checkout. Use the existing `pnpm build` and binding-preserving platform wrapper; do not hand-edit generated bundles or synthesize a snapshot to bypass a failed build. Documentation-only edits do not invalidate it. Migrations still have their independent application/verification process.

This protects against accidental stale builds. It is not a signature, a clean-Git requirement, installed-dependency attestation or an atomic lock on filesystem changes after verification. Operator secrets and dynamically reconciled CMS bindings are deliberately outside the digest. Direct Wrangler commands and separate service deployment commands do not inherit this platform-wrapper gate. Keep the checkout stable throughout deployment, verify live version/assets, and preserve the release evidence. A local snapshot alone does not prove what is running remotely.

Source comparison found the release checkout had omitted inactive/operator modules and one active CMS cost-disclosure wording update. Current `src/` files were copied after reviewing the existing differences; inactive modules gained no HTTP route or caller. CMS setup now explicitly discloses shared allowances and possible charges above them without implying a plan upgrade. No CMS provisioning, functional CMS test or provider setting change was performed. Controlled visitor bundle differences were generated dependency-path comments from the checkout's dependency symlink; visitor source and behavior were unchanged, and the apps Worker was not redeployed.

Verification: `node tests/build-snapshot.mjs` covers source/output/config/lock drift, added/removed files, source changes during a build, malformed/missing snapshots, credential exclusion, symlink refusal and deployment abort before configuration/provider access. Root build/snapshot readback and release TypeScript, build and frontend asset-loading checks passed. After the final snapshot implementation adjustment, the release was rebuilt successfully and its platform wrapper accepted that snapshot. Platform `a1db8251-3ef7-4156-8df2-533e730ab245` was deployed and independently verified; all 16 JS/CSS/font assets matched, health returned 200, and anonymous onboarding/Chat returned 401. Four Worker IDs, 105 applied migrations/no pending files and Monitor mode were read back at 18:07 UTC. Evidence: `.secrets/build-snapshot-release-verification.json` and `.secrets/build-snapshot-source-reconciliation.json`.


## Capability planner — September 30, 2026

Platform `7e5014d0-5e60-4c6f-9d0d-059be84f3b5a` and migration 0109 are deployed. The owner maintainer can retrieve versioned capability plans, reuse a pinned application starter, and must record a bounded missing-capability scope before saving custom source. Both TypeScript projects, build, planner/Chat/library/onboarding checks and actual local application journeys passed. No new provider, customer publication or visitor-maintainer route was activated.

Independent live readback at 2026-09-30T21:36:35.806Z confirmed all 109 migrations with none pending, seven new guards, the project backend revision column, health/landing/workspace 200, anonymous message/action POSTs 401 and all 16 frontend assets plus workspace HTML matching the build. Source `b457f6b`; previous platform `2ed299fd-f7d4-4842-88c7-b7d950d7a59a`. Other Workers are unchanged. The binding-preserving platform wrapper was used; this is not a four-Worker journal or real-model/customer acceptance. See [planner contract and complete evidence](capability-planner.md). Private evidence: `.secrets/composition-release-verification.json`.
