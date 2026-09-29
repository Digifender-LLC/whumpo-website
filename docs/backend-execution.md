# Generated backend execution

The full MVP needs generated backend behavior, durable project data and recovery. Existing contact and directory components do not satisfy arbitrary backend execution. This work adds the execution boundary first; data capabilities, generated-app publication, migrations and recovery must build on it before claiming that broader requirement is delivered.

## Service and cost boundary

Cloudflare Dynamic Workers are currently paid-plan-only, and the Sandbox SDK uses Containers. Neither is enabled under the owner's no-paid-only-services instruction. The execution engine is QuickJS compiled to WebAssembly inside an ordinary Worker, using the existing account's authorized allowance. Sources checked September 29, 2026: [Dynamic Workers pricing](https://developers.cloudflare.com/dynamic-workers/pricing/), [QuickJS embedding documentation](https://github.com/justjake/quickjs-emscripten), [Workers WebAssembly](https://developers.cloudflare.com/workers/runtime-apis/webassembly/).

The execution service has no public route, preview URL, secret, D1 or R2 binding. A future platform gateway must authenticate the customer, pin the owned project/code version, enforce atomic platform/customer invocation limits, and expose only explicit project-scoped capabilities. Possession of source code is not authority over another project's data. The VM will not receive platform credentials, request cookies or arbitrary network access.

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
- Private Worker `whumpo-runtime` version `0cdb36f1-375d-49a8-bfa1-3d880220b960` deployed with no routes, workers.dev, preview URLs, secrets or storage bindings. Startup reported 3 ms. No customer invocation route or AI tool is enabled yet.
- Cloudflare rejected a custom 50 ms CPU setting with Free-plan error 100328. The setting was removed, and the production-bound suite passed under the provider default. No account plan was changed. The local work counter and memory/input/output bounds remain enforced.
- The standard deployment script now deploys this private service before the public host and workspace. Failure stops subsequent deployment. It currently receives no customer traffic.

To repeat the remote suite, run a Wrangler remote-preview proxy on a loopback URL and set `RUNTIME_PREVIEW_URL=http://localhost:PORT` when running the test. For deployed-service verification, the preview probe must use a service binding to `whumpo-runtime`. Never create a public arbitrary-code endpoint for this test.

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

`test:backend-chat` verifies metered model drafts, server receipts, source/result ownership, guided access without AI charges, forbidden publication/extra fields, replay and concurrent dispatch-once behavior. `test:backend-chat-live` is an explicit opt-in provider test (`WHUMPO_LIVE_AI=1`); it reads the local OpenCode key without printing it and needs the private runtime running locally on port 8797. It creates disposable local D1 records, makes one live inference and runs two generated-function examples in workerd.

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

HTTP: `GET /api/projects/:project/backend-state` reads state; `POST` with `{id,versionId,input}` prepares a review; `GET /api/backend-state-reviews/:id` reads it; `POST /api/backend-state-reviews/:id/confirm` confirms it. All require an owned authenticated session and writes require the existing same-origin boundary. Full review JSON is available here; chat input retains its 1,000-character cap. Reviews are immutable after preparation, except for the single ready-to-applied transition, and are bounded at 100/project and 1,000/platform. Historical snapshots remain retained in reviews; dedicated history/export/restoration and lifecycle retention are unfinished. These hard ceilings are initial storage guards, not the final retention policy.

Validation: `test:backend-state` uses real local D1 to check ownership, exact immutable content, competing confirmations, expiry, replay, lost acknowledgments and invalid output. `test:backend-http` verifies the actual bound QuickJS runtime and authenticated HTTP confirmation. `test:backend-chat` covers generation and guided review/read/confirm. No public backend endpoint is enabled by this milestone.
