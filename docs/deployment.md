# TellUmo test deployment

## Confirmed decisions

On September 28 2026, the user authorized digifender.com as the temporary test domain, invite-only registration, and the existing account's included Workers/D1 allowance without upgrades or paid-only services. GitHub is restricted to free features.

## Deployed resources

| Resource | Name | Purpose |
| --- | --- | --- |
| Worker | tellumo-platform | API and Static Assets |
| Custom domain | digifender.com | HTTPS test platform |
| D1 | tellumo-control | Identity, projects, activity, invitations |
| Turnstile | TellUmo test platform | Free managed signup verification |
| Private repository | zemdregon/TellUmo | Source history |

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

Created private Standard R2 bucket `tellumo-files`; Wrangler confirmed r2.dev public access disabled. The existing `vidshare` bucket was inspected only for aggregate usage (8 objects, 7.92 MB) and was not modified. Migration 0012 applied remotely. The workspace Worker has the FILES binding; the public-site Worker still has only D1. A daily 03:17 UTC cleanup handler drains queued deletions and batches orphan cleanup without a subrequest per object.

Final workspace release `8626f466-75f6-45cc-a339-62e08f5a4765`; public host `c88aba48-a907-4bd2-b54b-27d0fee4b677`. TypeScript, `test:files`, and source-export regressions passed. Photo tests cover metadata stripping with independent pixel decoding, malformed/oversized input, owner isolation, concurrent upload IDs, conflicting reuse, lost R2 and D1 acknowledgements, quota-before-storage, authentication/Origin, cleanup and zero AI use. Browser upload converted a synthetic PNG to JPEG and displayed the saved private photo.

A live signed-passkey check uploaded a 640 × 400 synthetic photo (11,586 cleaned bytes), removed injected metadata, verified authenticated access/anonymous 401, retried without another file and used zero AI units. The temporary account, R2 object and its cleanup row were removed. The cleanup routine was exercised locally; its first scheduled production execution has not yet been observed. Photo placement into versions and public pages remains the next milestone, described in photo-publication-plan.md.
