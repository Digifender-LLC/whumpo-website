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

The first two gates are verified below. The deployed service has also been reached through a private service binding, but the customer-facing authenticated gateway remains to be built. All later application gates remain open; a standalone interpreter is not a complete generated application platform.

## Execution evidence — September 29, 2026

- Pinned quickjs-emscripten-core and release-sync Wasm variant at 0.32.0. QuickJS and wrapper MIT notices retained in `docs/licenses/quickjs-MIT.txt`.
- `npm run test:backend-runtime` builds and executes the actual Worker with Miniflare/workerd. Passed JSON/async modules, top-level await, no host networking/process/filesystem/timers, prototype/global separation, captured serialization intrinsics, syntax/import failures, loops, recursion, allocation pressure, unresolved promises, hostile getters, cyclic/BigInt/oversized output and regex backtracking. Each rejection is followed by a successful request. Forty concurrent fixtures verify exact returned tenant values or explicit busy responses.
- The same suite passed on Cloudflare remote preview and through a temporary remote-preview probe bound to the deployed private service. No customer data or credentials were used. The probe was stopped after testing. One initial bound run received a Cloudflare `Worker not found` transport error under concurrency; a full rerun on the same probe passed. This is not proof that provider transport failures cannot occur.
- Private Worker `whumpo-runtime` version `0cdb36f1-375d-49a8-bfa1-3d880220b960` deployed with no routes, workers.dev, preview URLs, secrets or storage bindings. Startup reported 3 ms. No customer invocation route or AI tool is enabled yet.
- Cloudflare rejected a custom 50 ms CPU setting with Free-plan error 100328. The setting was removed, and the production-bound suite passed under the provider default. No account plan was changed. The local work counter and memory/input/output bounds remain enforced.
- The standard deployment script now deploys this private service before the public host and workspace. Failure stops subsequent deployment. It currently receives no customer traffic.

To repeat the remote suite, run a Wrangler remote-preview proxy on a loopback URL and set `RUNTIME_PREVIEW_URL=http://localhost:PORT` when running the test. For deployed-service verification, the preview probe must use a service binding to `whumpo-runtime`. Never create a public arbitrary-code endpoint for this test.

Next: immutable owned backend versions, a project-authorized invocation gateway with atomic quotas, bounded data transitions and review/publication contracts. Gateway failures must normalize non-JSON provider errors, timeouts and resource termination without exposing raw guest errors, retrying mutations or consuming unbounded resources.
