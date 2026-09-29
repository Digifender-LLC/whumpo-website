# Application visitor identity and persistent data

## Current boundary

`src/app-data.ts` and migration 0050 implement an internal storage engine. **Owner-reviewed application configuration is implemented; public visitor enrollment, session issuance and data routes remain unconnected.** The existing public backend endpoints remain stateless. Existing publication approval does not authorize reading or modifying visitor documents.

This is a prerequisite for the full application workflow, not completion of application hosting. Project-scoped visitor authentication is still required before making this engine reachable. Active spaces used in tests are synthetic fixtures activated through the owner review flow. Migration 0050 was applied remotely with the pricing release; it exposes no visitor route.

## Identity and code authority

- `app_spaces` binds an owned project to an immutable backend version. New spaces default to disabled. Owner identity is fixed and must still match the current project owner on every authenticated read, reservation and commit.
- Configuration changes advance a monotonic program revision. Even replacing and restoring the same source invalidates an in-flight operation. Activation/replacement reviews pin this revision, exact code and data capability.
- `app_visitors` is separate from TownHello's user table. Each visitor belongs to one project. Revocation is irreversible for that identity; credential recovery must preserve the correct identity through a verified flow.
- `issueAppSession` is internal and must only run after successful visitor authentication. It returns a random 256-bit token; only a domain-separated SHA-256 hash is stored. Sessions expire after one day and are bounded to five per visitor and 5,000 total. Issuance cleans that visitor's expired sessions. Raw tokens must never enter logs, AI context, reusable code or URLs.
- Every operation resolves the token and requested project together. The guest cannot choose a visitor ID. Revoked/expired sessions, revoked visitors, disabled applications and transferred projects deny access. A token for one application cannot authorize another.

The engine deliberately does not reuse a TownHello owner session or publish the owner's existing `backend_state` document.

## Transition protocol

Each visitor has one JSON document, initially `{}`, with a monotonic revision. The application module receives `{state,input}` and must return exactly `{state,result}`. It receives no visitor/session identifiers, credentials, network, database binding or other visitor records. The existing fresh QuickJS/Wasm runtime remains the execution boundary.

State, input and result are individually limited to 4 KiB; combined encoded runtime input must fit 8 KiB. Generated source remains limited to 8 KiB and its stored digest is checked. State may be any valid bounded JSON value. Public frontend code must use the actual input contract and treat results as data, never markup or instructions.

An operation requires a UUID and expected document revision. Before dispatch, D1 reserves an immutable receipt bound to the visitor, project, code version, program revision, authenticated session and input fingerprint. Inputs are not retained as a separate field. Concurrent identical retries return the same saved/uncertain receipt; an ID with different content or a different visitor is rejected.

A successful receipt update and document change occur in one D1 trigger transaction. Commit rechecks the document revision, program revision, project owner, active visitor/application and original session expiry/revocation. Competing writes cannot silently overwrite each other. The winner advances the revision; a conflicting operation returns `state_or_authority_changed`. Invalid output and runtime failure leave data unchanged.

Lost reservation acknowledgments never dispatch the guest. Lost commit acknowledgments read back the receipt. Unresolved storage failures retain a running/unknown receipt; retries do not blindly re-execute it. A retry that races with an already committed operation rechecks its receipt before reporting a stale document. Old completed receipts remain historical results; callers read the document separately for current data.

Completed receipts retain bounded next-state snapshots and results. They are private application data and must be included in future retention, deletion and recovery policy. Current ceilings are 100 visitors/project, 1,000/platform, 20 attempts/visitor/day, 100/project/day, 1,000/platform/day (UTC), and 10,000 retained receipts. Failed/conflicting/unknown attempts count. These are beta guards, not a scalable lifecycle policy or AI credit charges.

## Required next gates

1. Owner-reviewed configuration is implemented and tested. The visitor UI must distinguish saved authority from public availability. Never reinterpret stateless publication as permission to use visitor data.
2. The internal visitor passkey service is implemented (details below). Connect it through a controlled application UI/origin with cookie binding and request limits; generated guest code must never handle credentials. Keep TownHello account access separate.
3. Authenticated application pages and data routes with bounded bodies, CSRF/origin checks, request limits and client-visible revision/receipt recovery. Connect forms through this path; the current credential-free public forms must remain stateless.
4. Read/export/delete controls, retention, schema/data migration, snapshot restoration and whole-app backup. Handle program upgrades against existing visitor documents explicitly.
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

`src/app-auth.ts` and migration 0056 implement invitation-only visitor passkeys independently of platform users. Visitor authentication is not yet reachable through HTTP or the agent. Owner invitation and revocation controls are connected through the workspace API (see below). `publicAccessReady` remains false. Production WebAuthn verification is pinned to `https://apps.digifender.com` and RP `apps.digifender.com`; this origin still needs the controlled host deployment. Local verification is explicitly pinned to `http://localhost:8787`. Request-supplied origins must never configure either value.

The owner can issue a 24-hour, single-use invitation for the current application revision. Only a domain-separated hash is saved. Invitations are limited to 100 per project and 1,000 overall; expired rows are reclaimed on issuance. A changed program revision invalidates outstanding invitations. Issuance rechecks current ownership and enabled state at commit. Raw invitation codes must be displayed privately once, outside chat, with no URL, logging, AI-context or reusable-component exposure.

Registration and sign-in use five-minute single-use challenges bound to a project and program revision. A separate random 256-bit challenge token is hashed in storage. `src/app-gateway.ts` carries the raw token in a secure HttpOnly browser cookie and enforces same-origin writes, bounded bodies and rate limits. This gateway is not yet mounted on a deployed host. Pending challenges are bounded to 50/project and 1,000 globally, with expired entries cleaned before admission.

Passkeys require user verification and discoverable credentials. Verification checks the fixed origin/RP, challenge, credential signature and visitor user handle. Credentials are looked up within the requested project. Their counter and an additional monotonic database revision serialize sign-ins, including authenticators that always return counter zero. A sign-in cannot issue a session after recovery removes its credential or after application authority changes. Sessions use the existing hashed app-session storage and never authorize platform-account access.

Enrollment atomically inserts one visitor, credential, recovery code and session while claiming the invitation. Concurrent enrollment has one winner. Credential duplication rolls back the whole batch. A lost database acknowledgment must not trigger automatic registration replay: the challenge remains consumed, and the visitor can sign in using the created passkey. Recovery codes and session tokens are random 256-bit values with separate hash domains.

Recovery preserves visitor identity and private data, rotates the recovery code, deletes every old passkey and session, and issues a new session atomically. That fresh session can enroll a replacement passkey. Adding a passkey requires a session less than ten minutes old, requires that same session cookie at verification, and rechecks the exact authorizing session at commit. Up to five passkeys are allowed per visitor. Irreversible owner revocation deletes the visitor's keys, recovery code, sessions and outstanding identity-bound challenges while retaining data for the future retention/deletion policy. Revocation is available even while an application is disabled; ownership must still match.

`test:app-auth` verifies the service with real local D1 migrations and independently signed ES256 authenticator fixtures: origin and user-verification denial, wrong-project/visitor handles, consumed/expired challenges, one-use invitations, competing enrollment, duplicate-credential rollback, lost enrollment acknowledgment, program changes, separate private documents, recovery rotation, backup/replacement keys, a recovery/sign-in race, counterless concurrent sign-ins, owner revocation, application disable/re-enable and ownership transfer. These are cryptographic service and database tests, not real-device browser acceptance or deployed visitor sign-in.

The unmounted HTTP gateway accepts only the controlled application origin. Routes under `/apps/:project/` implement signup/login/add options and verification, recovery, logout, data reads/transitions and private operation-receipt reads. Production session/challenge cookies use project-specific `__Host-` names, Secure, HttpOnly, SameSite=Strict and Path=/, with no Domain attribute. Platform cookies are ignored. Session and challenge secrets never appear in response JSON. Recovery codes are returned once for private saving. Duplicate cookies are rejected. JSON bodies are streamed with a 16 KiB cap; state/input retain the stricter engine limits. Origin checks and IP rate limits run before expensive authentication. Responses are private/no-store, deny framing and have no CORS permission. Unknown storage errors return an uncertainty message without logging credentials or database errors.

Gateway tests exercise signed enrollment through cookie-bound requests, missing/wrong origins, wrong host, body limits, rate denial, platform-session separation, authenticated data and private receipts, exact transition retry without redispatch, recovery and logout against local D1. The runtime service is controlled in this suite; this is not deployed/browser/QuickJS acceptance.

Next: mount the gateway on a controlled application host with its UI, then implement visitor export/deletion and real browser/runtime acceptance. Do not serve arbitrary generated scripts on the credential-bearing application origin. Existing stateless public forms remain separate.


## Owner visitor controls

Dashboard → Visitor access opens a full-width project panel; `/visitor-access` (optionally with a project UUID), “visitor access” and “manage visitor access” also open it directly from Chat. Guided/API chat requests return an owned visitor count and directions without invitation codes. Agent guidance directs credential handling to this private panel. Chat, Dashboard and custom workflow views remain separate.

Owned `GET /api/projects/:project/application-access` returns configuration, visitor IDs/join dates/revocation flags, passkey and active-session counts, and invitation status/expiry. It never returns visitor documents, passkey public keys, recovery codes, session hashes or raw invitation codes. Invitation identifiers are the hashes of random 256-bit codes, not bearer credentials. List queries recheck current project ownership. Projects without app configuration return an empty setup view.

Owner-only POST routes: `/application-access/invitations` creates one invitation, `/application-access/invitations/:id/cancel` cancels an unused invitation, and `/application-access/visitors/:id/revoke` irreversibly revokes a visitor. All require a same-origin request, a session less than ten minutes old, an account rate-limit allowance and an empty JSON object. Cancellation is rechecked by enrollment's atomic commit, including when options were issued before cancellation. Used invitations cannot be cancelled; use visitor revocation instead. Revocation remains available for disabled applications and retains private data.

The UI shows new codes once in a private, read-only field with an explicit Copy action. It does not place them in chat, URLs, local storage or analytics. Navigation discards the code. Creating another is hidden until the first is dismissed. Cancellation and revocation have an inline confirmation naming the target and explaining consequences. All panels clearly say visitor sign-in is not live while the gateway is unmounted; preparing an invitation does not make a public app available.

Verification includes owner/foreign/anonymous routes, CSRF and recent-session denial, cancellation after challenge issuance, disabled-app revocation, metadata field allowlisting and guided chat without credential disclosure. Local browser inspection confirmed dashboard and Chat navigation, confirmation dismissal and a 390px layout without horizontal overflow. Browser fixtures are synthetic; no production visitor access was granted or revoked during testing.
