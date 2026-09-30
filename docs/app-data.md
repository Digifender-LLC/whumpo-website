# Application visitor identity and persistent data

## Application operations in Chat — September 30, 2026

Implemented: `/app-status PROJECT_ID` gives an owned application's availability, active/revoked registered-account counts, today's admitted execution attempts and retained completed/failed/conflicted/unresolved outcomes. The current published-page handoff offers **Check app status · free**. The guided command makes no provider call; the model can request the same read through `backend / appStatus` with an exact owned project ID. A natural-language model request still uses normal AI accounting.

The read uses one database statement and a UTC timestamp/day. It selects counts and project metadata, never visitor identities, documents, inputs, results, invitation codes or credential material. Project and application ownership must match. It distinguishes an unconfigured app, disabled data access, approved private app and published visitor page. Registered visitors are not concurrent users, publication state is not a network health probe, and a saved Chat result is not a live monitor.

The daily attempt total comes from `app_daily_usage`, which survives visitor erasure. Outcome counts cover retained receipts only, so they can be lower than admitted attempts. Running receipts are explicitly labeled running or outcome unknown and must not be retried under a new ID. The displayed 100-attempt project ceiling is the existing separate test-stage execution guard; visitor/platform limits can also apply and these are not AI credit charges. No new limit or enforcement is introduced.

Verification: `pnpm check`, `pnpm test:chat-reply`, `pnpm test:agent-prompt-focus`, `pnpm test:customer-app-journey`, isolated release TypeScript checks, build and frontend loading checks passed. The connected journey covers unconfigured/private/published/disabled states, foreign-owner denial, all retained outcome classes, unchanged daily admission counts after visitor deletion, explicit model-action validation and exclusion of private payload markers and receipt IDs from the status output. Additional outcome records are controlled test fixtures; actual runtime execution and signed synthetic passkeys remain exercised by the underlying journey. No live customer data was created for these checks.

Deployed September 30, 2026 as test platform `549d9660-f4a0-4ecf-90cb-69b3f97b8b3f`. Independent readback confirmed the active version, health 200, anonymous Chat/onboarding 401 and all 16 live JS/CSS/font assets matching the tested release. No migration or new service was required. Evidence: `.secrets/app-status-release.json`.

## After publication — September 30, 2026

Implemented: the latest exact receipt for the currently live visitor-page review offers **Open visitor app** and **Manage visitor access**. The first opens the fixed `app-PROJECT_ID.whumpo.site` address; the second uses the existing project-specific visitor-access navigation without an AI request. Opening controls never generates invitations or changes access. Invitation creation, recovery and revocation remain explicit operations in the visitor panel.

The server derives this handoff from current ownership and `app_live_pages`, not model prose or historical approval alone. Only one matching receipt per current review receives the controls. Pending, foreign, withdrawn, replaced and disabled pages do not receive them; a refresh or subsequent Chat response recomputes availability. A page changed after the read remains subject to the visitor host's current access checks. No invitation code or credential is embedded in the links or Chat.

Verification: `pnpm check`, `pnpm test:chat-reply`, `pnpm test:workspace-navigation`, `pnpm test:customer-app-journey`, isolated release TypeScript checks, build and frontend loading checks passed. The connected application journey verifies a single handoff after publication, no handoff before approval or for a foreign owner, removal after withdrawal, replacement of the old receipt's controls after republishing, and removal after program disablement. It retains the real isolated QuickJS and signed synthetic passkey checks. This change creates no invitation and adds no provider request, migration or service.

Deployed September 30, 2026 as test platform `dedaf6a9-cc25-457b-90b4-e4e7080eaae6`. Independent readback verified the active version, health 200, anonymous Chat/onboarding 401 and all 16 live JS/CSS/font assets matching the tested release. Evidence: `.secrets/app-handoff-release.json`. Customer publication and visitor enrollment in the journey were disposable local fixtures, not live customer actions.

## Readable visitor-page review — September 30, 2026

Implemented: Chat displays the exact saved visitor-page form as a disabled preview with its title, description, text/number/checkbox fields and submit label. The card explains which copy becomes public, invitation/passkey requirements, private data processing, visitor sign-out, and unfinished retention/recovery. Withdrawal has a separate offline summary. The proposed address is plain text, not a claim that the app is online. This preview does not execute the backend, save input or establish form correctness. Exact field keys and revision IDs remain available in a closed details section.

Server-derived metadata requires current project ownership and an exact complete server receipt. Pending, applied, expired and changed reviews have distinct presentation. Both the original pending receipt and an explicit confirmation receipt can show historical approval after application; neither gains a confirmation button. A model-written assurance, partial/pending response, foreign review or corrupt form cannot supply this presentation. Confirmation continues to recheck the current database revisions.

Verification: `pnpm check`, `pnpm test:chat-reply`, `pnpm test:customer-app-journey`, isolated release TypeScript checks, production build and frontend loading checks passed. Tests cover all form input types, escaped copy, no execution/navigation in the preview, owner/receipt boundaries, expiry, historical receipts and a program change that invalidates a pending page review. The connected journey retains actual QuickJS execution and signed synthetic visitor passkeys. A standalone component preview at 390px had no horizontal overflow and verified disabled inputs plus keyboard expansion/collapse of exact configuration. Screenshot: `.secrets/visitor-page-review-mobile.png`. This visual fixture is not live customer publication or physical-device passkey acceptance.

Deployed September 30, 2026 to test platform `b42a9774-ca87-48f7-9922-7eabed1149f2`. Independent readback verified the active version, health 200, anonymous Chat/onboarding 401 and all 16 live JS/CSS/font assets matching the isolated release. No migration, provider call or customer publication was needed. Evidence: `.secrets/visitor-page-card-release.json`.

## Design a visitor page from Chat — September 30, 2026

Implemented: the current approved application receipt offers **Design visitor page · uses AI** when the program is enabled and there is no live page or current pending page review. The action prepares a review; the existing separate owner confirmation publishes it. Historical or superseded program approvals do not offer the action.

`/design-app-page PROJECT_ID` reads the owned, enabled program's exact source and digest, complete bounded project purpose and audience, and current program/page revisions. One model call may propose only `backend / reviewAppPage` for that project or ask a clarification. Prior Chat history, visitor documents and synthetic execution receipts are excluded. The source and brief are untrusted data. Unsupported input contracts should result in a clarification; the controlled form currently supports 1–8 text, number or boolean fields. This step does not execute or test the proposed form and does not claim that it did.

Review admission pins the revisions observed before inference. A program change or competing page publication rejects a stale result. Same-request retries return the existing Chat result without another dispatch or charge. Normal inference accounting applies, including inference consumed before a stale review is rejected. No database migration, service provisioning or automatic publication is introduced.

Verification: both TypeScript projects, `test:chat-reply`, `test:customer-app-journey` and `RUN_LIVE_MUSE=1 pnpm test:app-page-design` passed. Disposable-state checks cover ownership, proposal scope, replay, program/page races, private-history exclusion and missing AI. The actual Muse probe designed the approved notebook's `note` text input in one call, prepared the owner review, spent 7 test units and left no reservation or live page. The existing full journey separately verifies real QuickJS execution, controlled visitor sign-in, isolated state and publication/withdrawal. These checks do not establish physical-device passkey acceptance or correctness for every generated form.

Deployed to the test platform September 30, 2026 as `37448b68-8e51-4b8f-acc4-07909af62c3d`. The isolated release passed both TypeScript checks, production build and frontend loading checks. Independent readback confirmed the active version, health 200, anonymous Chat/onboarding 401 and all 18 live JS/CSS/font assets matching the release bytes. No customer page was published. Evidence: `.secrets/app-page-design-release.json`.

## Current boundary

`src/app-data.ts` implements per-visitor state and immutable execution receipts. The controlled application host at `app-PROJECT_ID.whumpo.site` connects invitation-only passkeys to this engine only after a separate owner-approved application-page review. Program authorization alone does not publish a visitor page. Existing public backend endpoints and website forms remain stateless.

This is an initial application workflow, not completion of all application hosting. Automatic retention, deletion for revoked/disabled accounts, schema migrations, whole-app recovery and physical-device passkey acceptance remain unfinished. Synthetic fixtures are used for automated and browser tests; no customer application is automatically published by a platform deployment.

## Identity and code authority

- `app_spaces` binds an owned project to an immutable backend version. New spaces default to disabled. Owner identity is fixed and must still match the current project owner on every authenticated read, reservation and commit.
- Configuration changes advance a monotonic program revision. Even replacing and restoring the same source invalidates an in-flight operation. Activation/replacement reviews pin this revision, exact code and data capability.
- `app_visitors` is separate from Whumpo's user table. Each visitor belongs to one project. Revocation is irreversible for that identity; credential recovery must preserve the correct identity through a verified flow.
- `issueAppSession` is internal and must only run after successful visitor authentication. It returns a random 256-bit token; only a domain-separated SHA-256 hash is stored. Sessions expire after one day and are bounded to five per visitor and 5,000 total. Issuance cleans that visitor's expired sessions. Raw tokens must never enter logs, AI context, reusable code or URLs.
- Every operation resolves the token and requested project together. The guest cannot choose a visitor ID. Revoked/expired sessions, revoked visitors, disabled applications and transferred projects deny access. A token for one application cannot authorize another.

The engine deliberately does not reuse a Whumpo owner session or publish the owner's existing `backend_state` document.

## Transition protocol

Each visitor has one JSON document, initially `{}`, with a monotonic revision. The application module receives `{state,input}` and must return exactly `{state,result}`. It receives no visitor/session identifiers, credentials, network, database binding or other visitor records. The existing fresh QuickJS/Wasm runtime remains the execution boundary.

State, input and result are individually limited to 4 KiB; combined encoded runtime input must fit 8 KiB. Generated source remains limited to 8 KiB and its stored digest is checked. State may be any valid bounded JSON value. Public frontend code must use the actual input contract and treat results as data, never markup or instructions.

An operation requires a UUID and expected document revision. Before dispatch, D1 reserves an immutable receipt bound to the visitor, project, code version, program revision, authenticated session and input fingerprint. Inputs are not retained as a separate field. Concurrent identical retries return the same saved/uncertain receipt; an ID with different content or a different visitor is rejected.

A successful receipt update and document change occur in one D1 trigger transaction. Commit rechecks the document revision, program revision, project owner, active visitor/application and original session expiry/revocation. Competing writes cannot silently overwrite each other. The winner advances the revision; a conflicting operation returns `state_or_authority_changed`. Invalid output and runtime failure leave data unchanged.

Lost reservation acknowledgments never dispatch the guest. Lost commit acknowledgments read back the receipt. Unresolved storage failures retain a running/unknown receipt; retries do not blindly re-execute it. A retry that races with an already committed operation rechecks its receipt before reporting a stale document. Old completed receipts remain historical results; callers read the document separately for current data.

Completed receipts retain bounded next-state snapshots and results. They are private application data and are included in visitor exports and account deletion; automated retention and whole-app recovery remain unfinished. Current ceilings are 100 visitors/project, 1,000/platform, 20 attempts/visitor/day, 100/project/day, 1,000/platform/day (UTC), and 10,000 retained receipts. Failed/conflicting/unknown attempts count. These are beta guards, not a scalable lifecycle policy or AI credit charges.

## Required next gates

1. Owner-reviewed configuration is implemented and tested. The visitor UI must distinguish saved authority from public availability. Never reinterpret stateless publication as permission to use visitor data.
2. Visitor passkeys, cookie binding, recovery and revocation are connected through the controlled host. Physical-device/browser passkey acceptance remains required; generated code never handles credentials.
3. Controlled application forms and authenticated data/receipt routes are implemented with bounded bodies, origin checks and request limits. The existing credential-free public forms remain stateless. Expand reviewed form capabilities as real workloads require.
4. Retention, revoked-account erasure, schema/data migration, snapshot restoration and whole-app backup. Handle program upgrades against existing visitor documents explicitly.
5. Real runtime and browser acceptance for authenticated applications, concurrent visitors/projects, expired/revoked credentials, uncertain provider outcomes and privacy boundaries. Add abuse controls and operational recovery before public enrollment.

## Evidence

`npm run test:app-data` uses disposable local D1 with a controlled runtime service to verify token/project/visitor separation, isolated documents, immutable operation identities, exact retry, concurrent dispatch-once, a receipt lookup race, lost reservation/commit acknowledgments, competing writes, bounded invalid output, program revision changes, session/visitor revocation, project ownership changes, session capacity and concurrent per-visitor quota admission. Type checking also passes. This verifies the storage/authority transaction boundary; it does not prove visitor passkey enrollment, actual authenticated public runtime execution or production recovery.


## Owner-reviewed application configuration

Migration 0051 and `src/app-activation.ts` introduce an explicit authority review. `/enable-application VERSION_ID TEST_RECEIPT_ID` requires an owned successful test returning exactly `{state,result}`, each at most 4 KiB. The review pins source digest, version, test receipt, project owner and current application revision for ten minutes. `/application-review REVIEW_ID` shows exact source and data disclosures. Only the owner’s `/confirm-application REVIEW_ID` applies it. The model can prepare/read, never confirm.

`/application PROJECT_ID` reads saved configuration and explicitly reports `publicAccessReady:false`. `/disable-application PROJECT_ID` prepares withdrawal of authority; confirmation atomically increments the program revision and deletes all visitor sessions. Existing documents/history remain. Re-enabling does not restore old tokens. Replaying an old applied review returns its historical receipt and cannot reactivate a disabled space.

Competing reviews have one current revision; stale approval fails. Any program change invalidates in-flight data transitions. A different program version is blocked after visitors exist, pending a separate data-migration workflow. Same-version reauthorization remains possible. Tests prove no other visitor’s document is used by the data engine.

HTTP equivalents: owned `GET/POST /api/projects/:project/application`, `GET /api/application-reviews/:id`, and owner-confirmed `POST /api/application-reviews/:id/confirm`. Prepare payload is `{id,operation:"enable",versionId,runId}` or `{id,operation:"disable"}`. Existing authentication and same-origin write checks apply. These endpoints save configuration; they do not expose visitor data or launch application pages.

`test:app-activation` covers ownership, malformed/oversized test outcomes, review immutability, competing/stale confirmation, expiry, lost acknowledgments, version replacement before enrollment, the migration gate afterwards, session revocation, owner transfer and rejection of model confirmation. `test:app-data` now builds all active fixtures through reviewed activation and proves an approved revision change invalidates in-flight writes.

`test:app-activation-http` additionally verifies these HTTP boundaries against local workerd and the actual QuickJS Worker: successful transition receipt, anonymous and foreign-owner denial, same-origin confirmation, guided enable/disable, and historical-confirmation replay without reactivation. Local testing pins `ENVIRONMENT=local` in an ignored config; a CLI-only override was lost during hot reload. No visitor enrollment is exercised by this test.

## Configuration deployment

Owner-configuration release `1fd15da` deployed to `tellumo-platform`, version `fc99af51-bf11-4d7e-99ce-8b191f04ad78`. Remote migration 0051 applied after the independent pricing migrations. Live checks returned health 200, anonymous configuration/review 401, and cross-origin confirmation 403. No production customer app was activated and no visitor data route was exposed. Visitor authentication and application-page acceptance remain required before public access.

## Visitor authentication service

`src/app-auth.ts` and migration 0056 implement invitation-only visitor passkeys independently of platform users. Visitor authentication is reachable only through an owner-published controlled application page. Owner invitation and revocation controls are connected through the workspace API (see below). `publicAccessReady` reflects the current published page. Production WebAuthn verification is pinned to `https://app-PROJECT_ID.whumpo.site` and RP `app-PROJECT_ID.whumpo.site`. The host is deployed separately from the platform owner workspace. Local verification is explicitly pinned to `http://localhost:8787`. Request-supplied origins must never configure either value.

The owner can issue a 24-hour, single-use invitation for the current application revision. Only a domain-separated hash is saved. Invitations are limited to 100 per project and 1,000 overall; expired rows are reclaimed on issuance. A changed program revision invalidates outstanding invitations. Issuance rechecks current ownership and enabled state at commit. Raw invitation codes must be displayed privately once, outside chat, with no URL, logging, AI-context or reusable-component exposure.

Registration and sign-in use five-minute single-use challenges bound to a project and program revision. A separate random 256-bit challenge token is hashed in storage. `src/app-gateway.ts` carries the raw token in a secure HttpOnly browser cookie and enforces same-origin writes, bounded bodies and rate limits. The controlled app host mounts this gateway only for currently approved pages. Pending challenges are bounded to 50/project and 1,000 globally, with expired entries cleaned before admission.

Passkeys require user verification and discoverable credentials. Verification checks the fixed origin/RP, challenge, credential signature and visitor user handle. Credentials are looked up within the requested project. Their counter and an additional monotonic database revision serialize sign-ins, including authenticators that always return counter zero. A sign-in cannot issue a session after recovery removes its credential or after application authority changes. Sessions use the existing hashed app-session storage and never authorize platform-account access.

Enrollment atomically inserts one visitor, credential, recovery code and session while claiming the invitation. Concurrent enrollment has one winner. Credential duplication rolls back the whole batch. A lost database acknowledgment must not trigger automatic registration replay: the challenge remains consumed, and the visitor can sign in using the created passkey. Recovery codes and session tokens are random 256-bit values with separate hash domains.

Recovery preserves visitor identity and private data, rotates the recovery code, deletes every old passkey and session, and issues a new session atomically. That fresh session can enroll a replacement passkey. Adding a passkey requires a session less than ten minutes old, requires that same session cookie at verification, and rechecks the exact authorizing session at commit. Up to five passkeys are allowed per visitor. Irreversible owner revocation deletes the visitor's keys, recovery code, sessions and outstanding identity-bound challenges while retaining data for the future retention/deletion policy. Revocation is available even while an application is disabled; ownership must still match.

`test:app-auth` verifies the service with real local D1 migrations and independently signed ES256 authenticator fixtures: origin and user-verification denial, wrong-project/visitor handles, consumed/expired challenges, one-use invitations, competing enrollment, duplicate-credential rollback, lost enrollment acknowledgment, program changes, separate private documents, recovery rotation, backup/replacement keys, a recovery/sign-in race, counterless concurrent sign-ins, owner revocation, application disable/re-enable and ownership transfer. These are cryptographic service and database tests, not real-device browser acceptance or deployed visitor sign-in.

The HTTP gateway accepts only the controlled application origin and a currently approved page. Routes under `/apps/:project/` implement signup/login/add options and verification, recovery, logout, data reads/transitions and private operation-receipt reads. Production session/challenge cookies use project-specific `__Host-` names, Secure, HttpOnly, SameSite=Strict and Path=/, with no Domain attribute. Platform cookies are ignored. Session and challenge secrets never appear in response JSON. Recovery codes are returned once for private saving. Duplicate cookies are rejected. JSON bodies are streamed with a 16 KiB cap; state/input retain the stricter engine limits. Origin checks and IP rate limits run before expensive authentication. Responses are private/no-store, deny framing and have no CORS permission. Unknown storage errors return an uncertainty message without logging credentials or database errors.

Gateway tests exercise signed enrollment through cookie-bound requests, missing/wrong origins, wrong host, body limits, rate denial, platform-session separation, authenticated data and private receipts, exact transition retry without redispatch, recovery and logout against local D1. The runtime service is controlled in this suite; this is not deployed/browser/QuickJS acceptance.

Next: bounded retention, revoked-account erasure, whole-app recovery and physical-device passkey acceptance. Do not serve arbitrary generated scripts on the credential-bearing application origin. Existing stateless public forms remain separate.


## Owner visitor controls

Dashboard → Visitor access opens a full-width project panel; `/visitor-access` (optionally with a project UUID), “visitor access” and “manage visitor access” also open it directly from Chat. Guided/API chat requests return an owned visitor count and directions without invitation codes. Agent guidance directs credential handling to this private panel. Chat, Dashboard and custom workflow views remain separate.

Owned `GET /api/projects/:project/application-access` returns configuration, visitor IDs/join dates/revocation flags, passkey and active-session counts, and invitation status/expiry. It never returns visitor documents, passkey public keys, recovery codes, session hashes or raw invitation codes. Invitation identifiers are the hashes of random 256-bit codes, not bearer credentials. List queries recheck current project ownership. Projects without app configuration return an empty setup view.

Owner-only POST routes: `/application-access/invitations` creates one invitation, `/application-access/invitations/:id/cancel` cancels an unused invitation, and `/application-access/visitors/:id/revoke` irreversibly revokes a visitor. All require a same-origin request, a session less than ten minutes old, an account rate-limit allowance and an empty JSON object. Cancellation is rechecked by enrollment's atomic commit, including when options were issued before cancellation. Used invitations cannot be cancelled; use visitor revocation instead. Revocation remains available for disabled applications and retains private data.

The UI shows new codes once in a private, read-only field with an explicit Copy action. It does not place them in chat, URLs, local storage or analytics. Navigation discards the code. Creating another is hidden until the first is dismissed. Cancellation and revocation have an inline confirmation naming the target and explaining consequences. The panel exposes a visitor-page link only when its review is applied and still current. Otherwise it asks the owner to prepare a page review. Preparing an invitation does not publish a page.

Verification includes owner/foreign/anonymous routes, CSRF and recent-session denial, cancellation after challenge issuance, disabled-app revocation, metadata field allowlisting and guided chat without credential disclosure. Local browser inspection confirmed dashboard and Chat navigation, confirmation dismissal and a 390px layout without horizontal overflow. Browser fixtures are synthetic; no production visitor access was granted or revoked during testing.


## Controlled visitor pages (migration 0057)

The `tellumo-apps` Worker uses `wrangler.apps.jsonc`, the same control D1 and the private QuickJS service binding. It receives no owner AI/provider credentials, R2 binding or owner routes. Fixed assets in `public-app/` are platform code; reviewed form metadata and guest results only become text. CSP permits scripts/styles/connections from self, forbids inline scripts, framing, base overrides and objects. Page/API responses are private/no-store with no CORS permission, no-referrer and nosniff. Request logging is disabled on this credential-bearing host. No paid-only service or plan change is introduced.

`/configure-app-page PROJECT_ID FORM_JSON` prepares a ten-minute immutable page review; `/app-page-review REVIEW_ID` reads it and only `/confirm-app-page REVIEW_ID` applies it. `/disable-app-page PROJECT_ID` prepares withdrawal. `/app-page PROJECT_ID` reads availability. Equivalent owned routes are `GET/POST /api/projects/:project/application-page` and `GET /api/application-page-reviews/:id`, with POST `/confirm`. The model may read/prepare through `appPage`, `reviewAppPage`, `appPageReview` and `reviewDisableAppPage`; it cannot confirm.

Form schema reuses the strict title, description, buttonLabel and 1–8 text/number/boolean fields. Metadata becomes public at `https://app-PROJECT_ID.whumpo.site/`. No arbitrary HTML, JS, CSS, URL or SQL is accepted. The owner must match fields to the tested `{state,input} → {state,result}` program. Gateway transitions require the current page ID and exact bounded field types/keys. Input is still limited to 4 KiB by the engine.

Reviews pin owner, program revision and current page revision. Competing reviews have one winner. An applied historical receipt never republishes a withdrawn page. Changing application authority hides the page until reviewed again. Page changes delete visitor sessions and pending sign-in challenges; in-flight state commits lose their original session and fail. New public sessions and challenges pin the page review in D1. A page withdrawn after signature verification cannot create a new visitor/session: the session admission trigger aborts the complete authentication batch.

The visitor UI offers passkeys first, invitation entry, recovery, replacement/backup passkeys, private form input, saved information and logout. It keeps session/challenge tokens in HttpOnly project cookies. The browser stores only the pending operation UUID in session storage, never credentials or form input. Lost responses are checked through an authenticated receipt. An unknown/unrecorded operation reuses that same UUID; stale document reads are refreshed before resubmission. A recorded ID cannot execute again with different content. Results are text and saved JSON is rendered as text fields.

### Recovery response loss

Public recovery requires a fresh browser-generated 256-bit nonce. The controlled browser and server derive the replacement code from a domain-separated SHA-256 of the old secret and nonce. The UI asks the visitor to save the replacement **before** committing recovery. The nonce and old code are not persisted or logged. Possession of an old code alone cannot derive a replacement made with an unknown random nonce. Exact retries accept the current replacement hash and return the same code, while revoking any intervening sessions/passkeys as an explicit recovery action. Rotating again invalidates older request pairs. This is not an automatic retry loop.

Consequently, loss of the recovery response leaves the visitor with either the prior valid code or the already-saved replacement. Tests commit recovery, simulate acknowledgment loss and then recover with that saved replacement without changing visitor identity or private data. The internal helper retains a random-replacement mode for internal tests; public gateway requests always require the nonce protocol.

### Acceptance

`test:app-auth` now includes publication races, strict form schema, model confirmation denial, page host/CSP, stale sign-in rollback after withdrawal, historical replay, in-flight transition revocation and recovery acknowledgment loss. `test:app-pages-http` exercises real local workerd and QuickJS with signed ES256 fixtures: two isolated visitors, enrollment, login/logout, private receipts, exact retry, page/field rejection, recovery, replacement keys and saved data. It requires fresh synthetic fixtures in `.secrets/app-page-fixture.json`; test credentials never enter tracked files.

Browser inspection verified the actual signed-in form against local QuickJS, saved-information rendering, stale-revision rejection followed by safe resubmission, and no horizontal overflow at 390px. The browser used a synthetic authenticated fixture; this does not claim physical-device passkey enrollment was exercised. The current form UI is deliberately bounded; richer app frontends and complete data lifecycle controls remain MVP work.


## Visitor data controls (0058)

Authenticated visitors can download `/apps/:project/export`. It streams their current document and retained operation results/snapshots in batches of at most 50 rows, rechecking authorization before each batch. It excludes credentials, session hashes, request fingerprints, and other visitors. Concurrent changes can affect the export; it is not a transactionally consistent restore snapshot. The browser receives an attachment with private/no-store and restrictive response headers. Interrupted exports are incomplete JSON and must not be reported as complete.

`POST /apps/:project/account/delete` accepts an operation UUID, reviewed document revision and exact `DELETE` confirmation. It requires a session younger than ten minutes and atomically removes the visitor, document, retained operation snapshots, passkeys, recovery code, sessions, associated challenges and used invitation. An in-flight backend cannot recreate these records. Other visitors and the platform owner account are unaffected. The browser requires typed confirmation and saves only the request ID/revision in session storage before dispatch.

A 24-hour receipt contains project, request UUID and a hash binding the former session token and reviewed revision. The original cookie remains as retry proof; it no longer authorizes account access. An exact retry can confirm deletion even after the visitor page is withdrawn. Different sessions cannot claim that receipt. Returning to sign-in explicitly abandons automatic checking and does not undo deletion. Receipt capacity is bounded; daily maintenance removes expired receipts.

Project/global daily admission now uses aggregate counters backfilled from existing runs. Erasing individual history cannot reset those limits. Counters older than 35 days are removed; today's counts are retained. Visitor limits still apply per extant account. Invitation-only enrollment remains required.

Deletion removes active storage. D1 Time Travel may retain prior copies for up to 30 days on Workers Paid ([Cloudflare documentation](https://developers.cloudflare.com/d1/reference/time-travel/)). This is not a compliance certification. Before any whole-control-database restore, deletion reconciliation must be implemented and tested; the 24-hour retry receipt is not a durable backup deletion ledger. Revoked/disabled visitor erasure and owner/project deletion are also still outstanding.

Acceptance: `test:app-lifecycle`, existing `test:app-data` and `test:app-auth`, and `test:app-pages-http` cover real D1 and HTTP boundaries, lost acknowledgments, concurrency, authorization, stale revisions, in-flight deletion and quotas. Browser review uses synthetic data and verifies the export link and deletion review UI; no physical passkey or real visitor deletion is implied.

### Hosting authorization update

On 29 September 2026 the user confirmed Workers Paid at $5/month and authorized using its resources as needed. Keep per-application admission and spending protections; this does not authorize unrelated paid services or plan upgrades. GitHub remains free-tier-only. The platform continues using the existing account and domain.

Release verification: migration 0058 applied remotely; visitor Worker `7a12cf38-7fae-4ae9-94d0-d0ea21d9d727`; platform Worker `6ae85a92-75a6-4491-9bd4-e54bbdb49d82`. Live visitor assets match the build. An unauthenticated deletion request returns 401 and a foreign-origin request returns 403. No production visitor was created or deleted for acceptance.


## Project-specific visitor navigation — September 29, 2026

`/visitor-access PROJECT_ID` now carries the exact project through to the workspace URL and project selector. Previously the browser discarded the argument. The shared command parser rejects malformed IDs and extra arguments; the browser keeps the typed request with a correction notice instead of silently opening an untargeted panel. API chat retains authoritative owner-scoped reads, and invalid commands do not advance conversation revision.

The visitor panel follows the URL project. Selecting another project updates that URL, and Back/Forward restores the selection. Each project has a separately mounted panel, so invitation codes, pending confirmation dialogs and local action state are discarded when the project changes. An already authorized request remains bound to its original project's endpoint; a late response cannot populate the new project's panel. No invitation code is added to URLs, Chat or persistent browser storage. Opening other controls from Chat clears incidental project parameters. Server ownership and recent-session requirements remain authoritative.

Verification: `pnpm check`, `pnpm test:workspace-navigation`, `pnpm build`, and diff checks passed. Tests cover strict ID syntax, duplicate query parameters, preserving the exact target, malformed-command revision stability and foreign-project denial. A synthetic browser fixture opened Studio two from Chat, generated a fixture-only code, switched to Studio one and verified the code disappeared; Back restored Studio two without the code. Recorded requests showed the correct first project and zero Chat submissions. The panel fit a 360px viewport without horizontal overflow; screenshot `.secrets/visitor-project-mobile.png`. This verifies UI state handling, not physical passkeys or live visitor invitation delivery. No real visitor access was changed.

Release: platform `02416110-7913-44a6-a19e-fdbca3a0ed96` verified active. Live JS/CSS match the tested build and anonymous visitor-access reads return 401. No migration or customer invitation was required.

## Repeatable customer application journey — September 30, 2026

`pnpm test:customer-app-journey` creates disposable local D1 storage and an isolated workerd instance from the actual QuickJS Worker/Wasm build. It calls the platform and visitor-host HTTP handlers directly with test-environment hostnames and signed synthetic ES256 passkeys. No pre-existing `.secrets` fixture, fixed port, provider account, public server or live deployment is needed. Owner sessions and rate-limit bindings are synthetic; the database guards, visitor authentication, application handlers and runtime execution are real implementations.

The journey starts at profile/welcome, creates the private project, saves and tests a transition backend, and prepares/confirms its authority through Chat. It separately reviews the visitor form and checks that neither a private backend nor its authority approval makes the page available. It then enrolls two visitors, verifies isolated data and private receipts, replays the same transition without another execution, recovers one identity, exports its document, deletes the other identity with exact retry, and withdraws the public page. Replaying an old page approval must not republish it; the deleted visitor's exact deletion receipt remains recoverable after withdrawal.

This is connected application acceptance, not physical-device passkey or browser interaction acceptance. It covers a bounded private-notebook workload, not arbitrary generated applications, schema migration, backup restoration or revoked-account erasure. Owner signup, model interpretation, real visitor enrollment and real customer publication remain outside this fixture. No secrets or visitor content are written to tracked files.

Acceptance: `pnpm test:customer-app-journey` passed, with exactly two actual runtime executions (owner test plus one visitor transition) and zero inference records. The first harness run exposed incorrect fixture assumptions about the Chat review identifier and form field names; aligning the fixture to the documented contracts resolved them. No runtime change or deployment was required. `git diff --check` passed.

## Application approvals in Chat — September 30, 2026

Completed Chat reviews now offer explicit **Authorize reviewed application**, **Disable reviewed application**, **Publish reviewed application page**, or **Take reviewed application offline** controls. The controls send the existing owner-confirmation commands through the normal Chat path; the model still cannot confirm. A saved review can be reopened with `/application-review REVIEW_ID` or `/app-page-review REVIEW_ID` to restore the eligible control.

`src/app-chat-actions.ts` derives these fields from owned, unexpired pending reviews, current project ownership and program/page revisions. Program source integrity is checked, and program replacement after visitor enrollment remains excluded. A control appears only beside an exact complete server-authored review description; a pending turn, truncated reply, altered assurance or command-looking model text cannot create it. The two review families stay separate. The helper examines at most the 100 displayed turns and uses at most 50 candidate IDs per query, with no provider calls or mutations. The confirmation transaction rechecks authority and revisions when clicked; a button is not a reserved approval.

Controls have a 44px minimum height and wrap their labels. Confirmation removes the old controls on the refreshed Chat read; later program/page revisions make competing reviews ineligible. No database migration is required.

Verification: `pnpm check`, `pnpm test:chat-reply`, `pnpm build` and the expanded `pnpm test:customer-app-journey` passed. Connected D1/QuickJS checks cover both approval kinds, reopening reviews, partial/altered/pending transcript refusal, foreign-owner denial, expiry, competing program reviews, program changes invalidating page reviews, and controls disappearing after confirmation. React server-rendering checks verify all four labels, touch-target sizing and absence of controls from prose alone. The isolated release also passed both TypeScript projects, build and frontend-loading checks. Remote read-only probes exercised both SQL queries with unused owner/review IDs. Physical-device interaction and a live customer application were not exercised.

Released to test as platform `806d9ed3-8cd3-47fd-ad7d-19bbdf375923`. Independent active-version readback, landing entry and all 18 live assets matched the isolated build. Health returned 200; anonymous Chat/application-review reads returned 401. No migration or customer application activation/publication was performed.


## Readable program approvals in Chat — September 30, 2026

Implemented: current application-program reviews render as a plain-language card with the project name, per-visitor read/replace authority, privacy boundaries, separate page-publication requirement, session/page effects, retention limitations and the unavailable post-enrollment migration workflow. Exact saved source, source digest, review/test IDs and numerical test limits remain in a closed, keyboard-accessible details section. Source and project names are escaped text. The card never grants confirmation authority itself; the existing separate server-authorized button submits the same explicit owner command.

`applicationChatActions` supplies typed presentation metadata only when the displayed completed turn exactly matches the authoritative owned review and the saved source passes its digest check. Applied reviews may match their earlier pending receipt because review content is immutable; this changes presentation, not stored Chat history. Original turns, `/application-review`, `/application-build` and `/confirm-application` responses retain a readable card. Applied, expired and configuration-changed reviews receive historical/unavailable states and no confirmation button. The applied card explicitly does not certify current availability. A model's partial or amended receipt, a foreign-owned review, or a pending Chat turn cannot receive this presentation or approval authority.

Verification: `pnpm check`, `pnpm test:chat-reply` and `pnpm test:customer-app-journey` passed. Tests cover exact-source rendering and escaping, collapsed details, enable/disable effects, historical and stale states, absence of buttons from card rendering, owner separation and the complete visitor application journey using actual isolated QuickJS. The test-stage access boundaries and owner confirmation semantics remain in effect. No model request is needed to render a review.


A connected 390px browser fixture rendered the readable approval with the source initially collapsed, opened and closed exact technical details by keyboard, and had a document width of 390px. Screenshot: `.secrets/application-approval-summary-mobile.png`. This verifies rendering and keyboard access, not physical touch. The isolated release passed both TypeScript projects, the production build and frontend loading checks; no schema migration or extra AI dispatch is introduced.


Deployed September 30, 2026 to test platform `2562f349-dd75-451f-89f5-691b83e86079`. Independent readback verified the active Worker, health 200, anonymous Chat/onboarding 401, and all 18 live JS/CSS/font assets matching the tested release. The current 100-turn Chat response carries the new presentation metadata. No customer app authority or public page changed.
