# Application visitor identity and persistent data

## Current boundary

`src/app-data.ts` and migration 0050 implement an internal storage engine. **Owner-reviewed application configuration is implemented; public visitor enrollment, session issuance and data routes remain unconnected.** The existing public backend endpoints remain stateless. Existing publication approval does not authorize reading or modifying visitor documents.

This is a prerequisite for the full application workflow, not completion of application hosting. Project-scoped visitor authentication is still required before making this engine reachable. Active spaces used in tests are synthetic fixtures activated through the owner review flow. Migration 0050 was applied remotely with the pricing release; it exposes no visitor route.

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

Completed receipts retain bounded next-state snapshots and results. They are private application data and must be included in future retention, deletion and recovery policy. Current ceilings are 100 visitors/project, 1,000/platform, 20 attempts/visitor/day, 100/project/day, 1,000/platform/day (UTC), and 10,000 retained receipts. Failed/conflicting/unknown attempts count. These are beta guards, not a scalable lifecycle policy or AI credit charges.

## Required next gates

1. Owner-reviewed configuration is implemented and tested. The visitor UI must distinguish saved authority from public availability. Never reinterpret stateless publication as permission to use visitor data.
2. Visitor passkey enrollment/sign-in, project-bound challenges and sessions, revocation and recovery. Use a controlled application UI/origin; generated guest code must never handle credentials. Keep Whumpo account access separate.
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

Owner-configuration release `1fd15da` deployed to `whumpo-platform`, version `fc99af51-bf11-4d7e-99ce-8b191f04ad78`. Remote migration 0051 applied after the independent pricing migrations. Live checks returned health 200, anonymous configuration/review 401, and cross-origin confirmation 403. No production customer app was activated and no visitor data route was exposed. Visitor authentication and application-page acceptance remain required before public access.
