# Whumpo test deployment

## Confirmed decisions

On September 28 2026, the user authorized digifender.com as the temporary test domain, invite-only registration, and the existing account's included Workers/D1 allowance without upgrades or paid-only services. GitHub is restricted to free features.

## Deployed resources

| Resource | Name | Purpose |
| --- | --- | --- |
| Worker | whumpo-platform | API and Static Assets |
| Custom domain | digifender.com | HTTPS test platform |
| D1 | whumpo-control | Identity, projects, activity, invitations |
| Turnstile | Whumpo test platform | Free managed signup verification |
| Private repository | Digifender-LLC/whumpo-website | Source history |

The workers.dev endpoint and preview URLs are disabled. Wrangler manages the apex custom domain and its certificate. www is not attached.

The root URL serves the public landing page. The account and project dashboard lives at `/workspace/`, with direct invitation signup at `/workspace/?signup=1`. The landing page distinguishes the product vision from currently available test features.

## Cost boundary

The domain has a Free Website plan. The existing account reports Workers Standard enabled; the user approved its included allowance after that distinction was explained. This deployment does not change the subscription. Included usage is shared with other apps, so application quotas cannot guarantee an account-wide zero bill.

The stack uses features available with free allowances. R2, Containers, Sandbox SDK, Workers for Platforms, Registrar purchases, Workers AI, and hosted build services are not provisioned. AI testing now uses the user-authorized existing OpenCode Go subscription. Those parts of the broader design remain deferred. No GitHub Actions workflows, hosted runners, Packages, Git LFS, or paid apps are configured; deploy locally with Wrangler.

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

## Operations

Run `pnpm invite` to create a code; open the generated local `.secrets/invitation-*.txt`. These files are ignored by Git and restricted to the local user. `TURNSTILE_SECRET` is a Wrangler secret. The configured site key is public.

Apply forward migrations with `pnpm db:remote`, then `pnpm deploy`. The current migrations are additive. `wrangler rollback` can restore a prior Worker version, but never assume that it reverses database migrations. Before future destructive migrations, implement and verify database export/restore.

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

The initial remote migration rejected a trigger written with `SELECT CASE ... END`; local SQLite had accepted it. A command sequence erroneously continued into deployment. The workspace was rolled back to the preview release, the guards were rewritten as `SELECT RAISE(...) WHERE ...`, and the remote migration succeeded. `tools/deploy.mjs` now makes migration success a mandatory gate before building or deploying either Worker. `pnpm deploy` runs that sequence and stops immediately on failure.

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
