# Generated backend execution

The full MVP needs generated backend behavior, durable project data and recovery. Existing contact and directory components do not satisfy arbitrary backend execution. This work adds the execution boundary first; data capabilities, generated-app publication, migrations and recovery must build on it before claiming that broader requirement is delivered.

Current status: private tests, reviewed private state transitions, reviewed public stateless JSON endpoints and number/text/checkbox website forms are implemented. [Application visitor identity and persistent data](app-data.md) covers the separate controlled visitor host, passkeys, per-visitor state and owner-approved application pages. Richer generated interfaces, visitor-data migrations and whole-app recovery remain open. The sections below record implementation milestones.

## One-request private application build — September 30, 2026

Implemented: the agent can use `backend / buildApplication` with an owned `projectId`, bounded JavaScript `source`, synthetic `input:{state,input}` and complete `expected:{state,result}`. A requested small application can now reach an exact program-approval review in one model call. This uses the existing private QuickJS service; it provisions no additional Cloudflare product or paid service. Each member of the sample input/output is at most 4 KiB, source at most 8 KiB, and combined runtime input at most 8 KiB. Expectations must follow the user's requested behavior. A passing example is not evidence that every input or workload is supported.

Migration `0080_application_builds.sql` binds the pending owned Chat turn to a request fingerprint and immutable private source in the same [D1 batch transaction](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). The fingerprint includes exact source, project, serialized synthetic input and expected output. The samples themselves are not stored in this new table; the existing bounded test receipt retains its output and expected-output fingerprint. The existing draft and test allowances apply. Projects with enrolled visitors reject this new-build path, pending the separate migration capability.

Unlike the original untested `create` action, this coordinator persists its private draft before final Chat completion so the exact saved version can be tested. A lost final response can therefore leave a recoverable draft/test/review. The same turn UUID identifies all three. `/application-build BUILD_ID` and agent operation `applicationBuild` read saved progress without execution; a completed exact review receives the existing owner-only approval control. Source and test receipts remain inspectable with `/backend` and `/backend-result`.

Concurrent or repeated builds never automatically dispatch another test. A lost draft acknowledgment stops before execution; a lost test reservation acknowledgment keeps the existing pending/unknown receipt. A failed expected-output check cannot prepare activation. If the test passed but preparing the review failed, the status receipt gives the explicit command to request a review from that saved version/test. It does not repeat the test. Missing/invalid source, input or authority cannot leave a successful-looking review. Program activation and visitor-page publication remain separate owner confirmations. No generated source executes in the platform Worker.

Verification: `pnpm check`, `pnpm test:application-build` and `pnpm test:agent-prompt-focus` passed. The build suite uses disposable D1 and the actual isolated QuickJS Worker, including failed expectations, ownership/strict fields, pending-turn admission, concurrency, changed-payload replay, lost draft and test-reservation acknowledgments, historical approval, review buttons and the enrolled-project migration gate. `pnpm test:customer-app-journey` also passed, preserving separate program/page confirmations, actual visitor transitions, replay, recovery, exports and deletion. Both TypeScript projects, production build and frontend loading checks passed in the isolated release checkout.

`RUN_LIVE_MUSE=1 pnpm test:application-build` additionally checks the complete metered Chat path and a natural-language notebook request against Muse Contributor, with disposable local D1 and actual QuickJS. The first live probe timed out at the existing 60-second limit: zero runtime calls or approval, with 36 synthetic units held for uncertainty. A fresh probe then completed in one model call and one runtime call, charged 11 of the normal 50 test units, left no hold and exposed the exact owner approval button. Same-message replay caused no extra inference or runtime call; the free build-status command reopened the same approval. No app was activated or visitor page published. This proves the tested request, not general model reliability or live customer deployment.

Deployed September 30, 2026 to test platform `bb16dea0-8639-4ef0-ae30-e4b99f6f9622`. Remote migration 0080 and both admission/immutability triggers were verified. Only that migration was pending in the isolated release; inactive Gateway migrations 0075/0076 remain unapplied. Independent readback confirmed the active Worker, health 200, anonymous Chat/onboarding 401 and all 18 live JS/CSS/font assets matching the tested release. No customer app was activated or published.

## Service and cost boundary

Cloudflare Dynamic Workers are currently paid-plan-only, and the Sandbox SDK uses Containers. Neither is currently enabled. On September 29 the owner authorized Workers Paid resources as needed; the previous free-only Workers restriction is superseded. Any future runtime change still needs isolation and usage validation. The execution engine is QuickJS compiled to WebAssembly inside an ordinary Worker, using the existing account's authorized allowance. Sources checked September 29, 2026: [Dynamic Workers pricing](https://developers.cloudflare.com/dynamic-workers/pricing/), [QuickJS embedding documentation](https://github.com/justjake/quickjs-emscripten), [Workers WebAssembly](https://developers.cloudflare.com/workers/runtime-apis/webassembly/).

The execution service has no public route, preview URL, secret, D1 or R2 binding. Whumpo authenticates owners for private tests and reviewed publication, pins immutable code versions, and enforces atomic invocation limits. Public endpoints receive only caller JSON. Additional project-scoped capabilities remain unfinished. Possession of source code is not authority over another project's data. The VM will not receive platform credentials, request cookies or arbitrary network access.

## Initial protocol

An ES module exports a default function that accepts JSON and returns JSON. Pure asynchronous functions can settle through a bounded promise-job loop. External imports, filesystem access, network calls and timers are unavailable. Input, source, output, heap, stack and execution work are bounded. Each invocation gets a fresh WebAssembly instance and JavaScript runtime. No tenant VM or data is cached between calls. Only the compiled, platform-controlled engine module is reused.

Outputs are data, never host code or trusted HTML. Serialization happens inside the guest under the same limits; the host reads only a bounded string. Guest exceptions are reported using fixed categories, not copied into platform logs. The service must remain responsive after syntax errors, infinite loops, unresolved promises, recursion, allocation pressure, malicious getters and attempts to access host capabilities.

QuickJS/Wasm is an additional containment layer, not a claim that an interpreter cannot have vulnerabilities. Separate service bindings, absent credentials, fresh instances and Worker resource limits reduce the consequence of a guest failure. Engine updates need pinned dependency/provenance review and rerunning the adversarial suite.

## Delivery gates

- Actual workerd execution and denied host access, including concurrent tenant-isolation tests.
- Resource exhaustion and recovery checks without terminating the test host.
- Deployed private service and verified invocation through the intended platform boundary.
- Owned immutable backend versions and explicit publication/rollback reviews.
- Audited, bounded project data capabilities, concurrency control and migrations.
- Conversational generation, test results, preview and source export.
- Full app recovery and operations acceptance.

The first two gates are verified below. The deployed service has also been reached through a private service binding, but the authenticated gateway now exists (see below), with live authenticated invocation still to verify. All later application gates remain open; a standalone interpreter is not a complete generated application platform.

## Execution evidence — September 29, 2026

- Pinned quickjs-emscripten-core and release-sync Wasm variant at 0.32.0. QuickJS and wrapper MIT notices retained in `docs/licenses/quickjs-MIT.txt`.
- `npm run test:backend-runtime` builds and executes the actual Worker with Miniflare/workerd. Passed JSON/async modules, top-level await, no host networking/process/filesystem/timers, prototype/global separation, captured serialization intrinsics, syntax/import failures, loops, recursion, allocation pressure, unresolved promises, hostile getters, cyclic/BigInt/oversized output and regex backtracking. Each rejection is followed by a successful request. Forty concurrent fixtures verify exact returned tenant values or explicit busy responses.
- The same suite passed on Cloudflare remote preview and through a temporary remote-preview probe bound to the deployed private service. No customer data or credentials were used. The probe was stopped after testing. One initial bound run received a Cloudflare `Worker not found` transport error under concurrency; a full rerun on the same probe passed. This is not proof that provider transport failures cannot occur.
- Private Worker `tellumo-runtime` version `0cdb36f1-375d-49a8-bfa1-3d880220b960` deployed with no routes, workers.dev, preview URLs, secrets or storage bindings. Startup reported 3 ms. No customer invocation route or AI tool is enabled yet.
- Cloudflare rejected a custom 50 ms CPU setting with Free-plan error 100328. The setting was removed, and the production-bound suite passed under the provider default. No account plan was changed. The local work counter and memory/input/output bounds remain enforced.
- The standard deployment script now deploys this private service before the public host and workspace. Failure stops subsequent deployment. It currently receives no customer traffic.

To repeat the remote suite, run a Wrangler remote-preview proxy on a loopback URL and set `RUNTIME_PREVIEW_URL=http://localhost:PORT` when running the test. For deployed-service verification, the preview probe must use a service binding to `tellumo-runtime`. Never create a public arbitrary-code endpoint for this test.

Next: integrate the owned backend versions and authorized test gateway below into chat, then add bounded data transitions and review/publication contracts. Gateway failures must normalize non-JSON provider errors, timeouts and resource termination without exposing raw guest errors, retrying mutations or consuming unbounded resources.

## Owned backend drafts and test gateway

Migration 0033 adds immutable owned backend versions and execution receipts. Authenticated same-origin routes:

- `GET /api/projects/:project/backends`: owned version IDs, digests and dates.
- `POST /api/projects/:project/backends`: `{id, source}` saves a private JavaScript module (8 KiB maximum). The version UUID is a caller-supplied idempotency key. Reusing it with different content is rejected.
- `POST /api/projects/:project/backends/:version/test`: `{id, input}` tests exactly that saved version through the private service binding. Input is JSON up to 8 KiB, output up to 16 KiB; the whole HTTP JSON request remains limited to 16 KiB. Source hashes are checked before execution.

This is private pure computation: no data mutation capability or public application endpoint. Saving code does not validate or publish it. The test result is data and must never be rendered as trusted HTML. Inputs are not retained; receipts retain an input fingerprint and bounded output, so test with non-sensitive examples. Outputs are not sent to AI by these routes.

The database serializes admission: 25 versions/project, 1,000 versions/platform; 20 tests/project/day, 100/account/day, 1,000/platform/day (UTC), plus a hard ceiling of 5,000 retained receipts. These are explicit initial test limits, separate from AI units; failed and uncertain attempts count. The total ceiling bounds retained storage until lifecycle/retention work is implemented. This limit is not a scalable final retention policy.

An invocation is reserved before service dispatch. A retry with the same ID and request returns its saved result, or a pending/unknown receipt. It never executes again automatically. Lost reservation acknowledgments deliberately leave an unknown receipt without dispatch. Provider errors, non-JSON bodies, invalid envelopes and oversized results become a fixed unavailable result. There is a five-second client deadline. No cookies or provider credentials reach the service.

`test:backend-versions` exercises real local D1, quota races, ownership, immutability, replay and lost acknowledgments. `test:backend-http` runs against local multi-Worker development and checks the HTTP auth/origin boundary and actual bound QuickJS execution, including recovery after a runaway function. Chat generation, inspection/test controls, durable application state, publication and rollback remain next integration gates.

## Chat integration

The model can now propose a `backend` action to create a private version, list versions for an owned project, inspect a version, run an explicitly requested synthetic example, or read a receipt. Creation uses the existing pending AI turn transaction, so a failed/closed response cannot leave a falsely acknowledged draft. Generated source is saved as a new immutable version; it is not executed on save. Action prose is replaced by a server receipt. Public backend publication is still unavailable. Reviewed private JSON data is available as described below. EmDash CMS requests must not be substituted with QuickJS functions.

Guided commands, available without AI units:

- `/backends PROJECT_ID`: list version IDs and hashes.
- `/backend VERSION_ID`: inspect owned source, explicitly labeled as untrusted.
- `/test-backend VERSION_ID JSON`: run a non-sensitive example (defaults to null when input is omitted).
- `/backend-result RECEIPT_ID`: read a prior test result without dispatch.

Chat input remains limited to 1,000 characters; the developer API allows larger bounded input. Displayed test output is truncated at 1,400 characters; the full result stays in the owned API receipt. Test outputs and inspected source become conversation history when requested here, and therefore can be used as AI context on subsequent requests. Do not use secrets or private visitor data as test inputs. AI generation/inspection requests use AI units; runtime test attempts use their separate bounded quota.

`test:backend-chat` verifies metered model drafts, server receipts, source/result ownership, guided access without AI charges, forbidden publication/extra fields, replay and concurrent dispatch-once behavior. `test:backend-chat-live` is an explicit opt-in provider test (`TOWNHELLO_LIVE_AI=1`); it reads the local OpenCode key without printing it and needs the private runtime running locally on port 8797. It creates disposable local D1 records, makes one live inference and runs two generated-function examples in workerd.

Live acceptance: Muse Spark 1.3 Contributor generated the requested calculator draft through the Responses adapter; two guided workerd examples returned 28 and 22, replay did not redispatch, no AI holds remained, and generation used 7 AI units. D1 fixtures were disposable/local; this proves the live-model-to-runtime path but is not a production-account enrollment test. Main Worker version `42201bb3-a257-427d-aec3-9ce6f4dcb1dc` deployed, health returned 200.

## Reviewed private project data — September 29, 2026

Migration 0034 adds one bounded JSON document per owned project, initially `{}` at revision zero. A saved function can receive `{state,input}` and return exactly `{state,result}`. State, transition input and result are each capped at 4 KiB; the complete runtime input remains capped at 8 KiB. The isolated runtime still receives no database binding or other host capability.

Preparing a transition reserves its review before invoking the existing dispatch-once execution gateway. The review retains the exact base revision, previous JSON, input, proposed JSON, result, backend version and ten-minute expiry. Preparation never applies the result. A separate authenticated user confirmation changes both the review status and project state in one SQLite trigger transaction. A stale base revision, changed data or expired review rejects confirmation. Repeat confirmation returns the original receipt without changing the current revision again. Invalid function output becomes a failed review. Pending/uncertain execution is not rerun automatically; the user can inspect its receipt. Preparing the same API review ID resumes only that exact stored snapshot/input and uses the same execution reservation.

Chat commands:

- `/backend-state PROJECT_ID`: current private data and revision.
- `/review-backend-state VERSION_ID JSON`: prepare the function's proposed change.
- `/backend-state-review REVIEW_ID`: read the exact review.
- `/confirm-backend-state REVIEW_ID`: user confirmation of that review.

The agent can read or prepare a review but cannot confirm it. Guided commands do not consume AI units; preparing a transition consumes the existing backend execution quota. Requested state/review reads are included in chat history, so subsequent AI requests can receive that data. These test documents must not contain secrets or sensitive visitor data. They are never shared between users or published as endpoints.

HTTP: `GET /api/projects/:project/backend-state` reads state; `POST` with `{id,versionId,input}` prepares a review; `GET /api/backend-state-reviews/:id` reads it; `POST /api/backend-state-reviews/:id/confirm` confirms it. All require an owned authenticated session and writes require the existing same-origin boundary. Full review JSON is available here; chat input retains its 1,000-character cap. Reviews are immutable after preparation, except for the single ready-to-applied transition, and are bounded at 100/project and 1,000/platform. Historical snapshots remain retained in reviews; the recovery controls below expose history/export/restoration. Lifecycle retention remains unfinished. These hard ceilings are initial storage guards, not the final retention policy.

Validation: `test:backend-state` uses real local D1 to check ownership, exact immutable content, competing confirmations, expiry, replay, lost acknowledgments and invalid output. `test:backend-http` verifies the actual bound QuickJS runtime and authenticated HTTP confirmation. `test:backend-chat` covers generation and guided review/read/confirm. No public backend endpoint is enabled by this milestone.

## Data history, export and restoration

Migration 0035 adds recovery provenance and owned chat controls. `/backend-state-history PROJECT_ID` lists only applied snapshots in revision order. `/export-backend-state SNAPSHOT_ID` offers a private JSON download containing before/after data, their revision numbers and SHA-256 hashes of the saved JSON serialization. The export includes project/snapshot/backend-version identifiers and restore provenance; it excludes function code, arguments, result receipts and chat history. Any sensitive values already stored in the project document remain in its export; downloads must be kept private. This is a data snapshot, not an executable application backup or platform disaster recovery artifact.

`/restore-backend-state SNAPSHOT_ID` reviews restoring the snapshot's after state; `/restore-backend-before SNAPSHOT_ID` reviews its before state, including the initial empty document. Restoration replaces the whole private document, explicitly showing removed/replaced data. It does not execute old code, change backend source or publish an endpoint. Confirmation uses the same expiry and atomic current-revision guard. Applied restoration advances the revision, retains the previous data and appears as a new snapshot with provenance. Repeated confirmation never rewinds a revision or duplicates the change. Pending/failed snapshots cannot be restored. A rejected stale review requires preparing a new review.

The agent can list, export or prepare either restore side, but cannot confirm. Guided operations consume neither AI units nor backend execution attempts. Chat now shows a confirmation button only for a saved complete review response whose snapshot is still current and unexpired. Reading an existing review restores this button after an interrupted response. Export links remain scoped to authenticated owned snapshots.

HTTP additions: `GET /api/projects/:project/backend-state/history`, `GET /api/backend-state-snapshots/:id/export` (JSON attachment), and `POST /api/backend-state-snapshots/:id/restore` with `{id,side:"before"|"after"}`. The same user-only confirmation endpoint applies prepared restores. Arbitrary uploaded JSON import remains unavailable. Storage retention is still bounded by the original review ceilings.

## Reviewed public stateless endpoints

Migration 0047 adds publication reviews and one current endpoint per project. After saving a function and completing a successful test of that exact version:

- `/publish-backend VERSION_ID SUCCESSFUL_TEST_RECEIPT_ID` prepares a ten-minute review containing source, digest, endpoint, test receipt and base publication revision.
- `/backend-publication-review REVIEW_ID` reads that exact review again.
- `/confirm-backend-publication REVIEW_ID` is the separate owner action that applies it.
- `/backend-publication PROJECT_ID` reads current status.
- `/unpublish-backend PROJECT_ID` prepares taking the current endpoint offline, using the same confirmation command.

The model can prepare/read reviews but cannot confirm. Publication and withdrawal advance a monotonic revision; stale reviews fail, and replaying an old applied review cannot change a newer publication. Publishing an older tested version uses the same review flow for code rollback. Private state is unaffected. A successful example is required but does not certify correctness for all visitor inputs. Source appears in the private review/chat history and must contain no secrets.

Authenticated HTTP: `GET /api/projects/:project/backend-publication`, `POST` with `{id,operation:"publish",versionId,runId}` or `{id,operation:"unpublish",versionId}`, `GET /api/backend-publication-reviews/:id`, and human `POST /api/backend-publication-reviews/:id/confirm`. Writes use the existing same-origin/session boundary. Review storage is initially bounded at 100/project and 1,000/platform.

Approved code accepts anonymous `POST application/json` at `https://PROJECT_ID.whumpo.site/backend`. It returns `{ok:true,value:JSON}` or a fixed error envelope. Requests are limited to 8 KiB, responses to the existing 16 KiB runtime output bound. Responses are JSON, no-store and nosniff, with credential-free wildcard CORS; OPTIONS supports browser calls. The route serves no source. The caller's JSON is the entire guest input: request cookies, authorization, project state and provider credentials never reach the interpreter. Inputs/outputs are not retained by this public gateway. Code may return literals embedded in its source, so the owner must review that source before making it public.

Before dispatch, a serialized D1 reservation enforces 100 attempts/project/day, 500/account/day and 1,000/platform/day in UTC. One counter row per project rolls over by date; publication changes cannot reset today's allowance. Failed execution and uncertain acknowledgments count. A lost reservation acknowledgment does not dispatch. Public calls have no idempotency/replay guarantee and retries consume another attempt; functions have no persistent mutation capability. Withdrawal prevents newly admitted requests; already admitted calls may finish. These initial ceilings are separate from AI credits and do not guarantee availability against deliberate quota exhaustion.

This enables a public **stateless computation endpoint**. Attaching interactive controls to generated website templates, public application authentication, persistent visitor data, app migrations and whole-app recovery remain unfinished. The current generated HTML sandbox does not automatically gain scripts or a backend form because an endpoint is published. CMS continues to use its native EmDash integration.

Verification: real local D1 tests cover successful-test admission, ownership, expired/competing reviews, exact replay, publication/withdrawal, lost reservation acknowledgments and concurrent project/account/platform quotas. The multi-Worker HTTP test covers session/origin enforcement and an anonymous public call through the actual bound QuickJS service (calculator result 31), followed by reviewed withdrawal returning 404. Existing private state and recovery HTTP tests still pass. Migration 0048 counts backend-only projects as live and exposes their endpoint in project chat reads; it does not imply a public static page exists.

Deployment: migrations 0047–0048 applied remotely; public host `be4c9144-c4e0-467b-8dcd-c7d47eadd1ff` and platform `ee5770db-0a7e-4d0c-b49c-e58fad62cd12` verified. Production health returned 200, the anonymous owner API returned 401, an unpublished function endpoint returned fixed JSON 404 and its credential-free preflight returned 204. No customer function was published for this check. Actual successful function invocation was verified in the isolated local multi-Worker fixture, not a production customer account.

## Website forms connected to published functions

Migration 0049 adds reviewed form settings for an existing published website and backend. The platform supplies the renderer and browser script; the agent supplies bounded plain-text configuration. No user source, field value or function output becomes executable browser code. This reuses generic platform code across projects without sharing tenant data.

Commands:

- `/configure-backend-form PROJECT_ID JSON` prepares a form review.
- `/backend-form PROJECT_ID` reads current settings and whether the form is active.
- `/backend-form-review REVIEW_ID` reads the exact review.
- `/confirm-backend-form REVIEW_ID` is the separate human confirmation.
- `/disable-backend-form PROJECT_ID` reviews hiding the form; its backend remains publicly callable until separately unpublished.

Configuration example:

```json
{"title":"Estimate your order","description":"Enter quantity and price.","buttonLabel":"Calculate","fields":[{"key":"quantity","label":"Quantity","type":"number"},{"key":"price","label":"Unit price","type":"number"}]}
```

A form has one to eight unique fields, using number, text or boolean input. Text inputs are required and limited to 300 characters; numbers are required and support decimals; booleans submit true/false. The function receives an object with these exact keys. Titles/labels are plain text. Configuration is capped at 4 KiB. The agent must match fields to its tested function input. Results render as text or formatted JSON, never HTML. This first component does not support arbitrary layouts, nested/repeating inputs, file uploads, application sign-in or persistent visitor records.

An immutable ten-minute review pins the current static website revision, backend publication review and form settings revision. Confirmation rechecks ownership and all three identities. Replacing/restoring/unpublishing the website or backend hides the form until another review is confirmed. Old review replay cannot revive a removed/replaced form. Storage is bounded at 100 reviews/project and 1,000/platform. The live HTML includes the current approved form; stored static versions and their ZIP/GitHub exports retain only the static website artifact.

The form calls `/s/PROJECT_ID/backend/PUBLICATION_REVIEW_ID`, which verifies the exact current publication before quota reservation or execution. The original unpinned endpoint remains available for direct integrations. A previously loaded form cannot silently invoke replacement code. Already admitted calls may finish. The existing public backend quotas and 8 KiB input/16 KiB result bounds apply; public calls consume no AI units. The gateway does not retain visitor inputs/results, and the form sends no credentials. It should not collect secrets or sensitive records.

Only pages with an active form permit scripts in their sandbox, using the SHA-256 CSP allowlist for the exact platform script. They retain an opaque origin (no `allow-same-origin`), block native form navigation, and restrict connections to the canonical site host. Configuration is escaped; output uses textContent. Browser DOM methods are called through their prototypes so a legitimate field name such as `querySelector` cannot shadow the form's methods. Plain pages retain their script-disabled policy. Custom-domain pages use the same canonical backend URL.

Owner HTTP: `GET /api/projects/:project/backend-form`, `POST` with `{id,config}` (null disables), `GET /api/backend-form-reviews/:id`, and `POST /api/backend-form-reviews/:id/confirm`. Authentication and same-origin write checks apply. The agent may prepare/read/disable-review via backend operations `reviewForm`, `form`, `formReview`, and `reviewDisableForm`; it has no confirmation operation.

Health checks now snapshot the active form review and hash the fully served page. A changed/hidden form invalidates the previous result; checks still do not submit visitor inputs. Existing five-minute cooldown and platform budgets apply.

Verification: local D1/chat tests cover owner denial, immutable reviews, stale website/backend targets, competing confirmations, removal/replay, rendering escapes, pinned endpoint rejection before invocation and health identity. The HTTP fixture verifies session/origin enforcement and real QuickJS computation. Browser acceptance verified numeric/boolean/text types, result 30, literal script-tag text, and a `querySelector` input name. The local browser proxy only substitutes the loopback origin in the data attribute and connect-src policy; the application script and hash remain unchanged. These are synthetic local fixtures, not published customer content. Run `test:backend-forms` standalone; `test:backend-form-http` requires the local platform/runtime/public-host proxy and writes an ignored browser fixture URL.

Deployment: migration 0049 applied remotely; public host `fb0c3657-d9bc-42f2-b3e0-030e169446dc` and platform `ad1539e6-1dce-4f1f-a92e-531085a508ea` verified. Production checks returned health 200, anonymous form-management API 401 and unavailable pinned endpoint 404. An initial client connection timed out; a bounded retry with a longer connection-attempt window passed. No production customer form or function was created for acceptance.

## Compare saved backend versions

`/backend-diff NEW_VERSION_ID ORIGINAL_VERSION_ID` reads two immutable versions from the same owned project. The agent can request the same operation using `{kind:"backend",operation:"compare",versionId,baselineId}`. The authenticated API is `GET /api/backend-versions/:new/compare/:original`.

The response verifies both source hashes, reports exact version IDs/digests and the latest saved test status for the new version, and identifies one exact replacement block between the equal prefix and suffix. This linear-time comparison avoids quadratic work on adversarial source. It is not necessarily a minimal diff: unchanged lines between separate edits remain visible on both sides. Newlines, Unicode and an unchanged source are preserved. Missing, foreign and cross-project comparisons return the same not-found response.

Test status is explicitly untested, passed, failed or unknown. A completed failing example supersedes an earlier passing example when it is the latest saved test. No test inputs or result data are included. Passing one example does not establish correctness for all inputs. Reading a comparison does not execute code, create a test receipt, publish a version or alter project data. The deterministic chat command uses no AI units; model interpretation remains metered.

Verification: `test:backend-diff` covers reconstruction, edge cases, account/project isolation, integrity failure, latest test status and read-only chat/model actions. `node tests/backend-diff-http.mjs` uses a local Worker and synthetic accounts to verify unauthenticated/foreign denial, source comparison, chat response and unchanged unit allowance.

Comparison release: platform `724acaf2-f57c-49d0-8f5d-7d35ef9e3493` verified active. The live comparison route rejects anonymous requests with 401. No production source versions or test runs were created for this acceptance check.


### Expected-output checks

`/check-backend VERSION_ID {"input":{"value":2},"expected":3}` executes one synthetic example and compares the entire returned JSON value with an expected answer. The model action is `{"kind":"backend","operation":"check","versionId":"…","input":…,"expected":…}`. The existing authenticated POST backend test endpoint accepts an optional `expected` member, including JSON null. `/test-backend` remains an execution-only test for compatibility.

Object member order is ignored, array order and types must match, and numeric comparisons have no tolerance. Expected JSON is limited to 16 KiB; input remains 8 KiB, with existing overall chat/API body limits also applying. No expected data is sent to guest code. The private receipt contains the actual result, verdict and SHA-256 fingerprint of serialized expected JSON; it does not duplicate the expected payload. This hash is an integrity reference, not encryption or anonymization. Use synthetic examples only. The request fingerprint binds the expectation to the invocation, so changing or removing it under the same ID conflicts. Identical retries never execute again; an uncertain reservation remains pending.

A mismatch sets `ok:false`, `error:"expectation_failed"`, and `check.status:"failed"`. Existing database publication and application-activation gates therefore reject that receipt. A runtime failure records `check.status:"not_run"`; a matching result records `passed`. All test attempts share the existing backend allowance. The deterministic chat command consumes no AI units; asking the model to choose a test uses the normal AI allowance. Tests do not apply state changes or publish code. Agent-written expectations are still only examples and do not prove requirements were understood correctly.

Source comparisons now identify whether the latest receipt verified expected output or only completed execution. Existing execution-only successful receipts remain valid under the existing review policy; expected-output checking is not a new mandatory publication gate for every historical version.

Verification: `npm run test:backend-checks` covers JSON equality semantics (including deep nesting and special property names), payload bounds, immutable replay/conflicts, concurrent execution once, lost reservation acknowledgment, ownership, model/chat routing, and database rejection of failed assertions for publication/activation. `tests/backend-http.mjs` checks the actual bound QuickJS runtime through the authenticated API and deterministic chat, including correct and wrong answers, preserved AI balance, and failed publication review.
