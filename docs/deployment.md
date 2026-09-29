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
