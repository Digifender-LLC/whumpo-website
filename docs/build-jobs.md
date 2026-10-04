# Pooled build jobs and on-demand owner maintenance

**WH-074, October 4, 2026 (UTC). Status: implemented in source and local fixtures only; not deployed or accepted in the test environment.** This applies the [shared job envelope](job-envelope.md) `project-build` purpose to the current application build path ([`src/application-build.ts`](../src/application-build.ts)). The envelope is in [`src/build-jobs.ts`](../src/build-jobs.ts), and the `build_job_*` triggers in [`schema/platform.sql`](../schema/platform.sql) enforce it. Admission and fairness reuse WH-075 ([capacity and fairness](capacity-and-fairness.md)). Placement follows WH-071 ([workload placement](workload-placement.md)).

## No always-on capacity per customer

Persistent owner and project context lives in stored state: Chat turns, project rows, saved backend versions, test receipts and reviews. Nothing keeps a process, container, automation server or warm workspace for a customer or project. A build uses shared capacity only while an authorized owner request is active:

1. **Admission.** The owner's pending Chat turn first saves the build intent. In the same D1 batch, it saves one `build_jobs` row. The `build_job_admit` trigger requires that exact pending owner turn, project ownership and the saved version. It allows one active job per project, three per account and sixteen across the platform. A job stays active until its cleanup is recorded as released.
2. **Diagnostics.** Deterministic checks run before any spend (see below).
3. **Dispatch.** One conditional update under the job's lease marks the job's only spend. The `build_job_spend` trigger refuses the job's runtime test reservation unless the job is running, dispatched and unexpired, and the reservation is for the job's own owner, project and version.
4. **Execution.** The existing stateless QuickJS runtime Worker runs the test. Every call gets fresh Wasm memory and a new context, and both are disposed afterward. The only state shared between calls is the immutable compiled engine.
5. **Finish, cleanup, publish.** The result is recorded under the lease. A cleanup attempt is appended. The output-ownership check then runs before the existing owner-approval review is prepared.

Visitor requests, public backend calls, webhooks, customer workflow events and cron have no pending owner Chat turn, so none of them can create, resume or extend a job. The visitor Workers (`src/site-host.ts`, `src/app-host.ts`) and the runtime Worker have no runtime import path to the maintainer, build or Chat modules; `tests/build-jobs.mjs` checks the import graph. Scheduled maintenance only runs the deterministic `reconcileBuildJobs`, which calls no model and no runtime. Owner session credentials and model keys never enter the job, the runtime request or the deployed application.

## Envelope invariants

| Concern | Enforcement |
| --- | --- |
| Per-job identity and authority | Job ID = build/version/turn ID. A random lease is returned only to the admitting request; only `SHA-256("build-job-lease"|job|lease)` is stored. Dispatch and finish match the job ID and lease digest together, so one job's lease cannot act for another. A lost acknowledgment loses the lease: replay reads the saved build and never dispatches. |
| Expiry | `expires_at` is at most 120 s after creation (the current code uses 60 s). After that, dispatch, success and spend are refused, and reconciliation marks the job `expired`. |
| Cancellation | `/cancel-build <id>` (owner only) moves a running or succeeded, not yet published, job to `cancelled`. It cannot then dispatch, finish, reserve its test or publish. A test that was already sent is not recalled, and its private receipt remains. Cancellation does not delete the saved draft; a later owner test and review of that version uses new owner authority, not the job's. |
| Operator build freeze (WH-050) | Owner decision on issue #148 (October 4, 2026). An operator `build` containment ([capacity and fairness](capacity-and-fairness.md#f7-operator-containment-implemented-locally)) for a project or account refuses new jobs in `build_job_admit` with the same generic capacity error, and the `operator_containment_build_cancel` trigger cancels that scope's `running` and `succeeded`-but-unpublished jobs in the same write. Cancellation behaves exactly like owner cancellation: no dispatch, finish, spend or publish; a test already sent is not recalled; the saved draft stays; the deterministic reconciler records cleanup. Published jobs are not changed. The freeze is freeze-only: per-project, per-account and pool limits stay as built. Lifting restores admission; cancelled jobs stay cancelled. |
| Scoped inputs/outputs | `input_digest` is the exact build request hash. `artifact_key` is `private/<project>/<job>/<source SHA-256>`, and a column check ties it to the row's project and job. |
| Output ownership before publish | `assertBuildOutput` and the `build_job_publish` trigger require all of these before a review can cite the job's receipt: the same owner, project and version; a `succeeded` (or already `published`) job; released cleanup; and source bytes matching the artifact key. Success itself requires the job's own passing `backend_runs` receipt. |
| Cleanup records | `build_job_cleanups` is append-only and allows at most five attempts. Release is recorded only when it is knowable: the runtime returned, the job was never dispatched, or 30 s (the runtime per-call bound) has passed since dispatch. An unconfirmed runtime outcome is recorded as `failed`/`runtime-unconfirmed` and keeps the capacity slot held. A cleanup that could not be recorded stays `pending`. |

## Shared caches versus private artifacts

- **Shared, reusable across tenants:** `toolchain_key = shared/toolchain/<SHA-256>` of the public pinned runtime identity only (engine and core versions, runtime contract, limits). `sharedToolchainKey` refuses project, job, source or any other field. Today this key names the prepared runtime image, which is the compiled QuickJS engine bundled in the runtime Worker. No dependency installer or shared dependency cache exists yet.
- **Private, never shared or deduplicated:** generated or library source, synthetic inputs, test receipts and outputs. Two tenants that build byte-identical source get different artifact keys, so cache presence cannot reveal another tenant's content.
- **Cost is not assumed free.** Each cleanup records `held_ms`, measured from admission to cleanup. Capacity counts a job until its cleanup is released, not only while it uses CPU. Reuse means reusing immutable content-addressed bytes. It never means keeping a sleeping or idle instance with memory or disk allocated.

## Deterministic diagnostics before model repair

Every build records `diagnostics_json`:

- `schema`: the synthetic `{state,input}`/`{state,result}` pairs. A failure is rejected with HTTP 400 before anything is saved.
- `type`: a static module-shape check for a default-export handler. This is not a TypeScript type check, and no source runs in the control Worker.
- `dependency`: no imports, dynamic code or embedded credentials. This reuses the import triage.
- `build`: the bounded QuickJS expected-output check.

If a static check fails, the job finishes as `failed` with no runtime call and no test allowance used, and it records `not-dispatched` cleanup. The reply lists the failed checks and says no model repair was run. A model repair is optional and happens only when the owner asks in a new Chat turn. Status reads such as `/application-build <id>` call no model. Provider prompt caching is not enabled by this change; it remains a candidate after privacy and tenant-boundary review.

## Containers delivery path (owner-gated, not configured)

Native dependency installs, bundlers or media conversion that cannot run in the bounded QuickJS runtime would need a separately reviewed sandbox executor. [Cloudflare Containers](https://developers.cloudflare.com/containers/) is the candidate. It requires the Workers Paid plan. Running instances bill provisioned memory and disk and active CPU, plus Worker, Durable Object, egress and log charges. **Pricing, included usage and account entitlement require verification as of 2026-10-04** before any activation; see the [pricing page](https://developers.cloudflare.com/containers/platform/pricing/) and the dated review in [workload placement](workload-placement.md#provider-review--october-1-2026).

Containers is **not** configured, bound or required by this change, and adopting it needs explicit owner authorization and a concrete review covering:

- the cost ceiling;
- per-job instances that start for an admitted job and stop after cleanup, with no per-customer always-on instance;
- image provenance;
- no secrets or Docker socket;
- egress policy;
- per-job writable disk destroyed at cleanup;
- recorded cleanup failures;
- these same job envelope, admission and output-ownership triggers.

## Evidence and limits

`node tests/build-jobs.mjs` covers these fixtures against the actual QuickJS runtime, using local SQLite with the complete current schema:

- two-tenant runtime memory isolation and cache keys;
- output ownership;
- cancellation before, during and after execution;
- lease isolation and single spend;
- expiry;
- a recorded cleanup failure holding capacity until reconciled;
- per-project, per-account and pool bounds and the deadline ceiling;
- owner replay, concurrency and a lost lease;
- no visitor, workflow or scheduled wake path;
- a synthetic maintenance task whose diagnostics precede the optional model repair;
- the operator `build` freeze: project and account scope, running and succeeded-but-unpublished cancellation, generic owner response, no stored allowance, other projects and tenants untouched, published jobs unchanged, and admission restored after a lift.

`node tests/application-build.mjs` continues to cover the existing build lifecycle.

These are local checks. They do not prove deployed D1 behavior, real runtime latency, load fairness or Containers isolation, and they do not change any Worker binding.
