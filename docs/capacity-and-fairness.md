# Capacity, abuse and tenant-fairness measurement (WH-050)

**First slice, recorded October 4, 2026 UTC against main `ae96716` plus the uncommitted harness.** The [WH-075 first-slice fairness fixes](#wh-075-first-slice-fairness-fixes--october-4-2026-utc) were re-measured with the same harness the same day; the "before" tables below are the original WH-050 record. Roadmap task [WH-050](roadmap/backlog.md) (P0). This slice delivers a reproducible **local** synthetic-client harness and its measured results. It does **not** complete WH-050: no live experiment was run, no alerting exists, and the cohort limits below are proposals awaiting an owner decision.

> **Local-only evidence.** Every number here came from a disposable local D1/R2 fixture, the real QuickJS runtime Worker under Miniflare/workerd, and the real platform, site and visitor handlers called in one Node process behind a loopback HTTP server. Nothing touched Cloudflare, a provider, a deployed URL or the network beyond `127.0.0.1`. These figures describe one 4-vCPU machine and these fixtures. They are **not** Cloudflare production limits or capacity, and absolute latencies must not be read as a service-level expectation. See [What this does not prove](#what-this-does-not-prove).

## Run it

```sh
node tools/capacity.mjs              # full default envelope, about 5 minutes on the recorded machine (309 s with WH-075 phase L)
node tools/capacity.mjs --smoke      # tiny volumes, about 70 seconds, proves the harness works
node tools/capacity.mjs --json out.json --scale 2 --tenants 6 --seed 7
```

- Options: `--smoke`, `--scale N` (site/photo volume multiplier, 1 to 4), `--tenants N` (2 to 8, one is always the noisy tenant), `--seed N` (deterministic job order), `--json FILE`. Also `pnpm capacity` with the same arguments.
- The harness refuses to run if `.env`/`.dev.vars` files exist, strips the environment to the allowlist used by [verification profiles](verification.md) (no provider keys, proxies, `NODE_OPTIONS` or Wrangler auth, temporary `HOME`), and replaces global `fetch` with a guard that throws for any host other than `127.0.0.1`/`localhost`. All state lives in temporary directories removed at exit.
- The repository requires Node.js 24. The recorded run used **Node 22.22.0**, which only prints a warning here (unlike `pnpm verify`, which refuses); re-record on Node 24 before relying on the numbers.
- Volumes are bounded: a fixed job count per scenario, 3 closed-loop clients per victim tenant and 24 for the noisy tenant, no open-ended duration. The default completes in about 4 minutes on the recorded machine; most of that is the serialized local D1 fixture.

## Method

Four synthetic tenants (one owner account each; `--tenants` changes this): `noisy` plus `victim-1..3`. Each has a published photo site, an enabled contact form, a reviewed public backend and a live visitor application with invited visitor sessions (`tests/` fixtures: workspace identity rows, the real Chat publish/confirm commands, the real publication and application review endpoints, trusted synthetic backend source, a 291-byte synthetic JPEG with a synthetic approved safety row). All data is benign and synthetic (`*.example.invalid`, "Synthetic capacity message").

Paths driven over loopback HTTP, each from a distinct synthetic client IP (`cf-connecting-ip`) unless a scenario says otherwise:

| Path | Request |
| --- | --- |
| Site | `GET /s/PROJECT/` (published photo page) |
| Photo | `GET /s/PROJECT/assets/FILE.jpg` (private R2 object through the approved-photo gate) |
| Contact | `GET` and form `POST /contact/PROJECT` (local mode skips Turnstile, so provider verification cost is unmeasured) |
| Public backend | anonymous `POST /s/PROJECT/backend` (real QuickJS) |
| Visitor app | `GET /apps/PROJECT/` page and authenticated `POST /apps/PROJECT/data` transitions (real QuickJS; sessions issued by the fixture, so WebAuthn sign-in cost is unmeasured) |

Scenarios: **Runtime bounds** and **concurrency gate** (direct to the runtime Worker), **unit cost** (sequential, unloaded), **A** victims alone, **S** simultaneous hostile and benign backend burst, **B** the same victim workload while the noisy tenant floods every path (one noisy backend source is benign on ordinary input but spins, allocates or recurses on request), **P** per-IP limiter probes, **D** shared platform daily backend budget (two filler accounts, five projects each, real traffic), **C** serving and recovery after saturation, **E** shared monthly R2 read budget (since WH-075: a per-project budget and the unchanged platform ceiling), **L** (WH-075) one-source anonymous lockout against a fresh tenant. Since WH-075 direct runtime calls carry a fairness lane and the concurrency table is measured with distinct and with one shared lane.

The harness replaces the Workers rate-limit bindings with an exact in-memory fixed window using the limits read from `wrangler.jsonc`/`wrangler.apps.jsonc` (`AUTH_LIMITER` 10/60 s, `API_LIMITER` 120/60 s). That is a stand-in, not the Cloudflare implementation. D1 statements are counted by wrapping `env.DB`; runtime calls and in-flight peak by wrapping the service binding.

## Results (2026-10-04 UTC, Node 22.22.0, linux x64, 4 vCPU, 15.7 GiB, seed 50, scale 1, total 219.5 s)

### Unit cost, sequential and unloaded

| Path | D1 statements/request | Runtime calls | Mean latency |
| --- | ---: | ---: | ---: |
| Site page | 5 | 0 | 79 ms |
| Photo | 4 (plus one R2 read, charged to the platform monthly counter) | 0 | 82 ms |
| Contact form GET | 1 | 0 | 16 ms |
| Contact POST | 4 | 0 | 62 ms |
| Public backend | 2 | 1 | 37 ms |
| Visitor app page | 1 | 0 | 17 ms |
| Visitor transition | 8 | 1 | 127 ms |

Statements are not billable D1 rows (see [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/): rows read/written, including indexes and triggers). They indicate relative work per path only.

### QuickJS runtime bounds (direct to the runtime Worker)

Each row is followed by a benign call; **every** next call succeeded (no state leaked or wedged).

| Case | HTTP | Result | Time |
| --- | ---: | --- | ---: |
| Benign sum | 200 | ok | 4 ms |
| Infinite loop | 422 | `work_limit` | 8 ms |
| Allocation growth (4 MiB heap) | 422 | `execution_failed` | 44 ms |
| Unbounded recursion | 422 | `execution_failed` | 6 ms |
| Unresolved promise | 422 | `unresolved_promise` | 5 ms |
| Output over 16 KiB | 422 | `invalid_output` | 5 ms |
| Source over 32 KiB | 422 | `invalid_request` | 3 ms |
| Input over 8 KiB | 422 | `invalid_request` | 3 ms |
| Request body over 48 KiB | 422 | `invalid_request` | 3 ms |
| Regex backtracking | 422 | `work_limit` | 31 ms |

Interrupt-count work bounds terminate runaway code in single-digit to tens of milliseconds locally; those bounds count engine interrupts, not wall time, so they say nothing about Cloudflare CPU-time accounting.

### Runtime concurrency gate (`active>=2` returns `busy`, HTTP 503)

Four waves per level; `busy` counts calls refused. The gate counts overlapping executions in the one local isolate, with no tenant attribution.

| Concurrent calls | Benign: busy / calls | Benign p95 | Spinning: busy / calls | Spinning p95 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 0 / 4 | 8 ms | 0 / 4 | 10 ms |
| 2 | 0 / 8 | 8 ms | 0 / 8 | 13 ms |
| 4 | 4 / 16 | 10 ms | 4 / 16 | 14 ms |
| 8 | 21 / 32 | 23 ms | 20 / 32 | 21 ms |
| 16 | 51 / 64 | 18 ms | 53 / 64 | 27 ms |

Through the gateway the overlap was rarer because arrivals are spread by the serialized local D1: the 15 victim calls in the simultaneous burst (phase S, 40 hostile calls at once) all succeeded and 8 of the 40 hostile calls got `busy`; in phase B, **4 of 120 victim public-backend calls (3.3%) returned 503 `busy`** and one victim visitor transition ended `failed`. Occurrence is timing dependent (an earlier recorded run of a slightly different mix saw 0 and 4). Busy and failed attempts still consume the project's daily allowance because the reservation precedes dispatch (victim project usage 93 = 40 + 5 + 40 + 3 + 5 attempts including those refused).

### Victims alone (A) versus victims while the noisy tenant floods (B)

Same victim workload both times (3 tenants, 3 closed-loop clients each; 516 requests per phase). Noisy flood in B: 960 requests with 24 clients. Latencies in ms.

| Victim path | A p50 | A p95 | B p50 | B p95 | B outcomes |
| --- | ---: | ---: | ---: | ---: | --- |
| Site page | 524 | 614 | 1876 | 2238 | 120 x 200 |
| Photo | 639 | 808 | 1036 | 2682 | 75 x 200 |
| Contact GET | 143 | 202 | 371 | 982 | 30 x 200 |
| Contact POST | 431 | 632 | 1545 | 2211 | 18 x 200 |
| Public backend | 422 | 524 | 754 | 1879 | 116 x 200, **4 x 503 busy** |
| Visitor app page | 242 | 330 | 513 | 1134 | 45 x 200 |
| Visitor transition | 1057 | 1244 | 2133 | 4388 | 107 complete, **1 failed** |
| **All victim requests** | **512** | **1129** | **1084** | **4091** | 0 errors in A; 4 x 503 in B |

Victim p50 doubled and p95 rose 3.6x with **no per-tenant isolation**: the noisy tenant's volume degrades others. Two caveats limit what that shows. The local D1 binding serializes statements and the harness is one single-threaded process, so part of the effect is local contention (event-loop delay p99 91 ms in A, 206 ms in B, max 413 ms), and the noisy tenant's site/photo traffic was ordinary-looking volume that nothing limits. Treat this as proof that no admission control separates tenants, not as a production latency multiplier. No victim request was refused for a reason other than runtime `busy`.

Noisy tenant outcomes in B (the tenant's own allowances being spent):

| Noisy path | Requests | Outcomes |
| --- | ---: | --- |
| Site / photo (150 each, distinct IPs) | 300 | all 200, no limit anywhere |
| Contact GET, one IP | 200 | 139 x 200, 61 x 429 (`API_LIMITER`) |
| Contact POST, distributed | 60 | 20 x 200, 40 x 429 (per-project 20/hour cap) |
| Public backend, half hostile | 220 | 22 ok, 34 guest errors (23 `execution_failed`, 11 `work_limit`), 4 busy, **160 x 429 (100/project/day, spent with phase S)** |
| Visitor transitions | 120 | 100 complete, 20 x 409 (100/project/day) |
| Visitor app page | 60 | all 200 |

The noisy tenant consumed exactly its per-project public-backend and visitor allowances and its contact hourly cap, and no more. B consumed 5,280 D1 statements and 388 runtime calls (peak 7 concurrently in flight).

### Per-IP limits (P)

| Probe | Requests | Accepted | Limited (429) |
| --- | ---: | ---: | ---: |
| Contact GET, one IP | 150 | 120 | 30 |
| Contact GET, distinct IP each request | 150 | 150 | 0 |
| Site page GET, one IP | 150 | 150 | 0 (**no limiter on the site host**) |
| Public backend POST, one IP | 5 | 5 | 0 (**no limiter; project quota only**) |
| Visitor app page GET, one IP | 150 | 120 | 30 |

### Shared platform budgets (D, E, C)

**Backend daily budget (D).** After earlier phases the platform had 363 of 1,000 public calls used today. Two filler accounts with five projects each (real traffic, benign calculator) drove it to **1,000/1,000** (581 ok, 56 `busy`, 363 refused 429); no filler account exceeded 320 (account cap 500) and none exceeded 100 per project. A victim whose own project had used 93 of 100 then received **429 on all 5 probes** (`allowance_or_publication_unavailable`). The two filler accounts consumed the remaining 637 calls; by arithmetic, two accounts at the 500/account cap reach 1,000 without any other traffic, so a handful of accounts can deny every other tenant's public backend for the UTC day.

**Photo reads (E).** Each public photo GET reserves one platform-wide R2 read operation (ceiling 100,000 per UTC month, [`src/storage-budget.ts`](../src/storage-budget.ts)). The counter was pre-set to 99,990 by a D1 write instead of sending 100,000 requests (so the *mechanism* is measured, not the volume). The noisy tenant's next 20 requests: 10 x 200, 10 x 503. A victim's photo requests afterwards: **5 of 5 x 503**. Victim HTML still served 200.

**Serving and recovery (C), with the backend budget spent and the noisy tenant exhausted.** Victim site 10/10, photo 10/10, contact form 10/10, visitor page 10/10 and visitor transitions 3/3 returned 200; victim public backend 0/3 (429 until the UTC day rolls); noisy tenant's own site 10/10. The runtime answered 5/5 benign calls immediately after the hostile traffic. Quota **recovery by clock rollover (UTC day, hour, month) was not tested.**

## Acceptance assessment (local envelope only)

| WH-050 acceptance criterion | Result |
| --- | --- |
| One tenant cannot consume the entire allowed public execution budget in the tested envelope | **Met for one tenant, not for two.** The noisy tenant was held to its 100/project and 500/account ceilings (it reached 100 attempts on one project). Two filler accounts with five projects each consumed the rest of the 1,000/day platform budget and denied a victim still under its own project cap (D); two accounts at the 500 account cap would reach it alone. The 500/account cap itself was not driven to its limit here; it is covered by existing quota suites. |
| Traffic serving and recovery remain available after saturation | **Mostly met locally.** Site, contact, visitor and noisy-tenant paths kept serving and the runtime recovered immediately. Public backend stays refused until the day rolls, and photo serving fails platform-wide once the monthly R2 read ceiling is spent (E). |
| Per-IP limits are not claimed as financial caps | **Met.** P shows distributed clients bypass them and three public paths have none. Do not describe `API_LIMITER` or `AUTH_LIMITER` as spend controls ([runbook C4/G2](incident-runbooks.md)). |
| Any live load/cost experiment requires an exact bounded plan | **Honored.** No live load was run. Run nothing against `*.whumpo.site`, `whumpo.com` or any deployed Worker without a reviewed plan stating target, request count, duration, concurrency, expected cost and stop condition. |

## WH-075 first-slice fairness fixes — October 4, 2026 UTC

Roadmap task [WH-075](roadmap/backlog.md) (first slice only; WH-075 is not complete). **Local evidence only**: same harness, machine and Node 22.22.0 as above, seed 50, scale 1, 4 tenants, total 308.6 s, re-run after the changes on branch `claude/wh-075-fairness` (uncommitted at recording time). Nothing was deployed and no Cloudflare product, binding or plan changed.

What changed (current schema only, [`schema/platform.sql`](../schema/platform.sql); no migrations):

| Finding | Change | Where |
| --- | --- | --- |
| F5 | **Per-client sub-limits inside each project allowance**: one connection (IPv4 address, or IPv6 /64) may make at most 20 public backend calls, 10 contact submissions and 400 public photo reads per project per UTC day. Counted as attempts (never refunded). Only a scope/project/day SHA-256 key is stored, in new table `public_client_usage` (classified `public-admission-counters` in the [lifecycle catalog](data-lifecycle.json); rows older than the previous UTC day are deleted by the daily `traffic` maintenance job). Refusal is 429 and does not spend the project allowance. | [`src/public-admission.ts`](../src/public-admission.ts), `src/backend-publication.ts`, `src/contact-page.ts`, `src/site-host.ts`, `src/cms-publication-media.ts` |
| F1 | **Account fair share with the platform ceilings unchanged**: once half of a platform pool is used, an account that already holds a tenth of the pool is refused until the period rolls; accounts under that share keep the reserve. Public backend and visitor transitions: from 500/1,000 per UTC day, share 100. Contact receipts: from 500/1,000 retained, share 100. Public photo reads: from 50,000/100,000 per month, share 10,000. Existing project (100) and account (500 backend) caps are unchanged. | triggers `backend_public_usage_insert`, `app_run_admit`, `contact_submission_guard`, `storage_project_usage_insert` |
| F3 | **Per-project photo budget**: public site photos and public CMS images charge a project budget of 10,000 reads/month (new table `storage_project_usage`) atomically with the 100,000 platform ceiling, plus the per-client 400/day. One project exhausting its budget gets 503 "This site's monthly photo allowance"; other tenants keep serving. Photos stay private R2, `no-store`, never public or shared-cacheable. | [`src/storage-budget.ts`](../src/storage-budget.ts) |
| F4 | **Busy and unavailable runtime answers are not charged**: a `busy` refusal or an `unavailable` answer (no guest verdict) refunds the project/account/platform public call once (best effort; a lost refund leaves it spent) and the visitor-transition project attempt once (trigger `app_run_refund`). Guest failures (`work_limit`, `execution_failed`, ...) executed and stay charged; per-client and per-visitor attempt counts are not refunded. **Per-project runtime lane**: every dispatch carries `x-whumpo-lane` (SHA-256 of the project id, no tenant data) and the runtime lets one lane hold at most one of its two slots per isolate; a missing/invalid lane is 422 `invalid_request`. | [`src/runtime/worker.ts`](../src/runtime/worker.ts), [`src/runtime-lane.ts`](../src/runtime-lane.ts) |
| F2 | **Not changed; documented.** The `whumpo-sites` Worker has no rate-limit binding, so no existing binding fits site HTML. The public backend and photo routes on that host are now admitted per client (F5); site HTML is still unlimited per IP. Adding a [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) binding to `wrangler.sites.jsonc` (a new namespace, like the existing `API_LIMITER`) is a configuration/deploy change for the owner; its plan availability and price were not re-verified here (no network) and **require verification**. A [WAF rate limiting rule](https://developers.cloudflare.com/waf/rate-limiting-rules/) remains plan dependent. | none |

Standard owner AI is untouched: none of these counters meter AI, and no quota upgrades a plan.

### After (same harness, re-recorded)

| Measure | Before (WH-050) | After (WH-075 slice) |
| --- | --- | --- |
| One IP floods a fresh tenant's public backend (L) | one source could spend 100/100 | 40 sent: **20 ok, 20 x 429** `client_allowance_exhausted`; 10 other IPs afterwards: 10/10 ok; project counter 30 |
| One IP floods contact POST (L) | one source could fill the 20/hour cap | 15 sent: **10 ok, 5 x 429**; 3 other IPs: 3/3 ok |
| One IP floods photo GET (L) | unlimited | 450 sent: **400 ok, 50 x 429**; 10 other IPs: 10/10 ok |
| Two filler accounts, 5 projects each, after 391 platform calls used (D) | fillers took the rest, platform 1,000/1,000; victim probes **0/5** | fillers stopped at **100 each** (200 ok, 799 x 429); platform 606/1,000 after probes; victim probes **5/5 ok**; a brand-new account **10/10 ok** |
| Victim public backend in recovery phase (C) | 0/3 (429 until UTC rollover) | **3/3 ok** |
| Noisy project at its 10,000 photo budget, platform at 60,000 (E) | (platform counter at 99,990) victims **0/5** photos | noisy 10 ok then 10 x 503; victims **5/5 ok** |
| Platform read ceiling still enforced (E) | 503 for all at 100,000 | counter at 99,995: 5 ok, then 5 x 503 for victims (ceiling unchanged) |
| Public backend charging during B | busy/failed attempts charged (victim usage 93 incl. refusals) | project counters equal executed calls exactly: noisy 100 executed / 19 busy / counter 100; victims 86/2/86, 85/0/85, 85/0/85 |
| Runtime gate, one lane, 4 concurrent (direct) | n/a | 8/16 busy (distinct lanes 4/16); one lane never holds both slots (deterministic check in `tests/backend-runtime.mjs`) |
| Victims in B: busy | 4 of 120 backend 503, 1 failed visitor transition | 1 of 120 backend 503 (not charged), 0 failed visitor transitions |
| Victims alone (A): busy | 0 | 1 of 120 backend 503 and 2 of 108 visitor transitions `failed` (busy, refunded): the per-project lane serializes one tenant's own overlapping calls |
| Victim latency A / B, all requests | p50 512 / 1,084 ms, p95 1,129 / 4,091 ms | p50 597 / 1,256 ms, p95 1,180 / 4,305 ms |
| D1 statements per request (unit) | photo 4, contact POST 4, backend 2 | photo 6, contact POST 5, backend 3 |

Latency and busy counts vary between runs (single run, timing dependent, one event loop, serialized local D1). The B latency degradation is unchanged in kind: site HTML and photo volume from many IPs is still admitted (F2), and local contention dominates.

**Status of findings after this slice (local only):** F5 **resolved locally** for single-source lockout (distributed callers can still spend a project allowance: 5 sources for backend, 2 for contact's hourly cap). F1 **resolved locally** for the tested shape (two or more heavy accounts can no longer deny a light account), with a guarantee only while light accounts fit the reserve (about five accounts at their full share). F3 **resolved locally** (one tenant or client no longer exhausts every tenant's photos; many tenants together still reach the unchanged platform ceiling). F4 **partly resolved**: refusals are no longer charged and one project cannot hold the whole gate per isolate; the gateway still neither queues nor retries, a lone tenant now gets at most one concurrent execution per isolate, and multi-isolate behavior is unmeasured. F2, F6 **open**; F7 and F8 were addressed locally the same day by the [operator containment and counter report slice](#wh-050-f7f8-operator-containment-and-counter-thresholds--october-4-2026-utc).

Owner decisions this slice raises: the per-client limits (20/10/400 per day) can refuse legitimate visitors behind one shared address (offices, carrier NAT); the 10% fair share and 50% reserve thresholds; the 10,000/month per-project photo budget; whether to add a sites rate-limit binding (F2); whether a single tenant losing its second concurrent runtime slot is acceptable or a short wait/queue should replace `busy`.

## WH-050 F7/F8 operator containment and counter thresholds — October 4, 2026 UTC

Second WH-050 slice (with WH-007 gaps G1, G3 and G11) on branch `claude/wh-050-containment`, uncommitted at recording time. **Implemented locally only:** current schema and operator tools with local SQLite/D1 tests. Nothing was deployed or run against the `test` environment, no binding, plan or paid service changed, and no alert delivery was installed. Not configured, not rehearsed against the deployed database and not owner-accepted.

### F7: operator containment (implemented locally)

`node tools/operator-containment.mjs --input PRIVATE.json [--apply DIGEST]` uses the existing operator Cloudflare/D1 authorization, like [`tools/respond-usage-review.mjs`](../tools/respond-usage-review.mjs). Every write is previewed first and applied only with the preview's exact SHA-256 digest; a mismatched or changed request writes nothing. Logic: [`tools/operator-containment-input.mjs`](../tools/operator-containment-input.mjs) (never bundled into a Worker).

| Action | Input (private JSON file) | Effect |
| --- | --- | --- |
| `status` | `{"action":"status","subject":{"kind":"account"\|"project","id":UUID}}` | Read-only: containment history (active, expired, lifted) and each project's current usage against its effective allowance. Counts only. |
| `contain` | `{"action":"contain","id":UUID,"subject":{...},"scopes":{"backend":"freeze","photo":500},"expiresAt":ISO,"operator":"human:REF","reason":"..."}` | For each named scope, `"freeze"` (account or project) or a temporary per-project allowance (project only). `expiresAt` must be in the future and at most 30 days away. The `id` makes the action idempotent: an exact replay returns the saved rows; a different request with the same ID is refused. |
| `lift` | `{"action":"lift","id":UUID,"operator":"human:REF","reason":"..."}` | Ends the action early (once). Normal allowances apply immediately; usage already counted stays counted. |

Scopes and allowances (per project; a raise never changes the account caps, fair share, per-client sub-limits or platform ceilings):

| Scope | Normal | Temporary allowance range | Enforced in |
| --- | --- | --- | --- |
| `backend` public backend calls | 100/UTC day | 0–500 | `backend_public_usage_insert` |
| `transition` visitor transitions | 100/UTC day | 0–500 | `app_run_admit` |
| `contact` contact submissions | 20/rolling hour (retained cap 100 unchanged) | 0–100 | `contact_submission_guard` |
| `photo` public photo reads (site and CMS images) | 10,000/UTC month | 0–50,000 | `storage_project_usage_insert` |

How it holds:

- **Admission in SQL.** New table `operator_containments` and view `operator_contained_projects` ([`schema/platform.sql`](../schema/platform.sql)). The four existing admission triggers read the effective allowance: any active freeze for the project or its owning account makes it 0; otherwise the most recent active allowance for that project and scope; otherwise the normal value. Writing the counters directly is refused the same way, so no request path can bypass it. The counter `CHECK` ceilings were widened only to the raise maxima (backend 500, project photo reads 50,000).
- **No customer disclosure.** Customers receive the existing generic responses: backend 429 `allowance_or_publication_unavailable`, visitor transition 409 "Application changed or execution allowance reached", contact 429 "This inbox is temporarily full", photo 503 "This site's monthly photo allowance has been reached". A frozen project is indistinguishable from an exhausted one; no containment, operator reference or reason appears in any response.
- **Audit and reversibility.** Each row is the audit record: action ID, scope, subject, effect, operator reference (`[A-Za-z0-9_.:@-]`, up to 128), private reason (up to 500), request digest, creation and expiry, plus a single lift with its own operator, reason and digest. Triggers refuse any other update and every delete; rows are bounded at 10,000 (then new containment fails closed). Rows have no foreign key, so account or project closure is neither blocked nor erases them ([lifecycle class `operator-containment`](data-lifecycle.json)). Retention beyond that is an **owner decision**.
- **Nothing is deleted or changed for the customer.** Containment inserts and lifts operator rows only. Stored messages, visitor documents, sessions, sites, versions, files and WH-132 safety holds are untouched, so held data is never at risk.
- **Standard owner AI untouched.** None of the four scopes meters AI, Chat, owner test runs (`backend_runs`), workspace sessions or site HTML; the test confirms a contained owner can still run an owner backend test.

Containment controls that are still **missing** (documented, not built), because no existing primitive does them safely:

| Control | Why not included | What is needed |
| --- | --- | --- |
| Workspace session revocation | The only primitive is the identity authority epoch, advanced by owner credential/recovery ceremonies (C11). An out-of-band operator epoch change would interact with in-flight kit offers, recovery attempts and two-key rules that were reviewed only for owner-driven changes. | A reviewed operator revocation ceremony in the identity contract (WH-015/016/063). |
| Site takedown (site HTML) | Site HTML has no admission counter; unpublishing changes the owner's reviewed publication revision and would need owner review to restore. | A serving gate in [`src/site-host.ts`](../src/site-host.ts) plus an owner-approved customer notice (WH-016/017). |
| Application disable / visitor session revocation | The existing disable path is owner-reviewed and deletes visitor sessions. The `transition` freeze already stops visitor writes and guest execution; visitor pages and reads still load. | A reviewed operator disable that keeps visitor data (WH-016). |
| Contact suspension | **Covered by the `contact` freeze**: new submissions are refused per project or account with the generic "inbox full" response; stored messages stay private and keep their normal expiry. The contact form page itself still renders. | Nothing further for intake; hiding the form needs the site serving gate above. |

### F8: shared counter thresholds (implemented locally, pull-based)

`node tools/report-maintenance.mjs --counters` (or the full `node tools/report-maintenance.mjs`, which now includes a `counters` section) reads each shared platform counter against the ceiling its trigger enforces and flags `warn` at 50% and `act` at 80% (`exhausted` at 100%; `unavailable` if a query fails). Exit 2 means attention (`act`, `exhausted` or `unavailable`). The inventory is fixed, reviewed SQL in [`tools/maintenance-inventory.mjs`](../tools/maintenance-inventory.mjs) (`platformCounterInventory`), and `tests/maintenance-inventory.mjs` checks each ceiling against the current schema SQL so a changed trigger cannot silently drift. Output holds totals only: no project, account or visitor identifiers (use `operator-containment` `status` for one subject).

| Counter | Ceiling | Window |
| --- | ---: | --- |
| Public backend calls (fair share starts at 50%) | 1,000 | UTC day |
| Visitor transitions (fair share starts at 50%) | 1,000 | UTC day |
| Contact receipts (fair share starts at 50%) | 1,000 | retained |
| R2 reads (public photo fair share starts at 50%) | 100,000 | UTC month |
| R2 writes | 10,000 | UTC month |
| Visitor runs / visitor sessions / visitors | 10,000 / 5,000 / 1,000 | retained |
| Owner backend test runs | 1,000 per day, 5,000 retained | UTC day / retained |
| Project photo files plus cleanup queue | 500 | retained |
| Operator containment rows | 10,000 | retained |

**Alert delivery stays owner-gated.** Nothing pushes, pages or emails: the report is read on a cadence the owner sets (runbook G1). Installing any delivery (Cloudflare notifications, a paging or email provider, a scheduled Worker that sends messages) is a separate owner decision with its own price and entitlement review.

### G11 slice: synthetic health probe (implemented locally)

`node tools/probe-health.mjs https://ORIGIN [--timeout-ms N]` sends one unauthenticated `GET /api/health` (the only health endpoint; platform Worker in [`src/index.ts`](../src/index.ts)), follows no redirects, reads at most 4 KiB, and exits 2 unless it gets 200 `{"status":"ok"}`. The target must be a bare `https` origin (`http` only on loopback). `tests/probe-health.mjs` runs it against a loopback stub only. A pass proves platform Worker liveness, not D1, R2, AI, Turnstile, customer sites or provider health. It is not scheduled and was not run against any deployed URL.

### Tests (local)

`node tests/operator-containment.mjs` (SQLite) and `node tests/operator-containment.mjs --d1` (actual local D1) cover input validation, preview/apply digest mismatch, idempotent replay and ID reuse, project and account freezes at all four admission paths, lowered, raised and superseding allowances, identical generic customer responses, direct counter writes refused, immutable audit, lift, expiry, cross-project isolation and unchanged customer tables. Also `node tests/maintenance-inventory.mjs` (counter thresholds) and `node tests/probe-health.mjs`.

Owner decisions this slice raises: containment record retention (no cleanup exists); the raise maxima above; whether the `contact` allowance should govern the hourly rate (current) or the retained cap; the report cadence while a cohort is active; any alert delivery provider; and the scope of the missing site, application and session controls.

## Findings: fairness and abuse gaps (WH-050 record; status after WH-075 and the F7/F8 slice above)

| ID | Finding | Evidence | Severity |
| --- | --- | --- | --- |
| F1 | **Platform-wide daily budgets are first-come across tenants.** Public backend (1,000/day), visitor transitions (1,000/day), contact receipts (1,000 retained) and R2 reads (100,000/month) are shared; the per-account sub-cap (500) lets two accounts drain the platform and a tenant under its own project cap is refused. | D, E; schema triggers in [`schema/platform.sql`](../schema/platform.sql) (contact and visitor platform caps read from schema, not driven by traffic here) | High |
| F2 | **No admission control on the public site host.** Site HTML, photos and the public backend route have no per-IP, per-tenant or per-project request limiter; only quotas apply to backend and photo reads. One IP sent 150/150 accepted. | P; [`src/site-host.ts`](../src/site-host.ts) | High |
| F3 | **One client can exhaust every tenant's photos.** Photo GETs are `no-store` and each charges the shared monthly R2 read counter, with no per-tenant or per-IP bound. | E | High |
| F4 | **The runtime concurrency gate is global and not tenant-aware.** At 4+ simultaneous calls 25% or more are refused regardless of caller; in B victims saw 3.3% `busy` and a failed visitor transition. Refused and failed attempts still spend the project allowance; the gateway neither queues nor retries. Behavior of the real service binding across multiple Cloudflare isolates is unmeasured. | concurrency table, S, B | Medium |
| F5 | **Allowances are keyed by the target, not the caller.** Anonymous callers can spend a tenant's 100 backend calls/day, fill its 20-per-hour contact cap (and, over time, its 100 retained receipts) or its visitor-page allowance, locking out legitimate users. Per-IP limits do not help against distributed callers. | B noisy table, P | Medium |
| F6 | **Per-IP limiter coverage and semantics are narrow and local-only.** Limits cover contact, visitor routes and platform `/api`; the real binding is per Cloudflare location and eventually consistent, which this harness does not model. | P; [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) | Medium |
| F7 | **Recovery from exhaustion is time-based only.** No operator can raise, reset or freeze one tenant's allowance or isolate one abusive tenant (runbook gaps G1 and G3). Rollover not tested. **Implemented locally (F7 slice):** operator freeze or temporary allowance per account/project, enforced in the admission triggers; site takedown, app disable and session revocation remain missing. Not configured or accepted. | C; [incident runbooks](incident-runbooks.md#3-gap-register-controls-this-runbook-needs-that-do-not-exist) | Medium |
| F8 | **No alert exists for any of the shared counters.** No notification fires at 50% or 80% of any platform budget (G1). **Implemented locally (pull-based):** `report-maintenance.mjs --counters` flags 50%/80%; alert delivery remains owner-gated and not installed. | none installed | Medium |

Candidate remedies (each needs its own reviewed task; none implemented here): per-account sub-caps sized to the enrolled cohort, per-tenant photo read accounting before the platform counter is charged, an edge rate rule or cache policy for the public site host (a [WAF rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/) rule is paid-plan dependent and **requires entitlement and price verification**), a per-project fairness token or queue ahead of the runtime gate, and an operator per-tenant freeze (WH-015/016; the public-allowance part is now implemented locally, see the F7 slice).

## Proposed account-level alerts and cohort limits (proposal, owner decision required)

Nothing below is enforced and no alert is delivered (G1). The platform counter rows are now **pull-based checks** in `node tools/report-maintenance.mjs --counters` (50%/80% flags, local implementation only); the account-share and 429/503 rows are still manual. Read them on a stated cadence while a cohort is active.

| Signal (source) | Warn at | Act at | Intended response |
| --- | --- | --- | --- |
| `backend_public_usage` summed for today | 500 | 800 | Identify the largest account; consider suspending enrollment and reviewing for abuse |
| Visitor `app_daily_usage` summed for today | 500 | 800 | Same |
| `contact_receipts` retained count | 500 | 800 | Same; contact suspension is platform-wide (C6) |
| `storage_usage.read_ops` this month | 50,000 | 80,000 | Review photo traffic; consider C-controls before the ceiling |
| One account share of any platform daily budget | 50% | 70% | Review that tenant for abuse |
| 429 or 503 spike from the limiters/quotas | any sustained burst | repeated | Triage per the runbook |

Conservative cohort admission, derived only from the ceilings above and the F1 result: while the 1,000/day platform ceilings and 500/account sub-cap are unchanged, **admit no more than 10 active accounts**, so a fair share is about 100 backend calls/day and 100 visitor transitions/day each, and treat the 500/account cap as an abuse ceiling, not a guarantee. Fewer (about 5) while the R2 read ceiling is shared and photo reads have no per-tenant cap. Raise only after live cost and capacity are measured under an approved plan. These counts are proposals, not tested thresholds.

## What this does not prove

- **No Cloudflare production figures.** Real Worker CPU/memory limits, isolate placement and concurrency, D1 query latency/throughput and single-database overload behavior, R2 operation latency and rate, rate-limit binding behavior and Cloudflare's own DDoS and edge caching are not represented. Verify against the current official pages before relying on any limit: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [D1 limits](https://developers.cloudflare.com/d1/platform/limits/), [R2 limits](https://developers.cloudflare.com/r2/platform/limits/), [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/). Pricing pages: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/), [R2](https://developers.cloudflare.com/r2/pricing/). These pages were **not re-read for this slice** (no network was used); account allowances, plan entitlements and prices in the account **require verification** against the dated notes in [protection-candidate.md](protection-candidate.md) (D1 and Workers allowances read October 2, 2026).
- **No cost.** Statement counts are not billable rows; no Worker CPU-ms, request, R2 operation or D1 row cost is measured. Per-IP and per-project limits are abuse brakes, not a financial cap (no account-wide spend cap exists, runbook G2).
- **Fixture effects.** The local D1 binding serializes statements; the harness and all handlers share one Node event loop (delay reported above); the runtime is one Miniflare isolate; Turnstile, WebAuthn sign-in, email, AI inference, DNS and Cloudflare edge/CDN behavior are absent. Latencies are therefore only comparable within a run.
- **Untested scale.** Real tenant counts, account-cap exhaustion by a single account, contact and visitor platform-cap exhaustion by traffic, quota rollover, month-scale R2 counts (the counter was pre-set), long-duration soak, memory growth, scheduled-job interference, large photos, multi-region distribution and any traffic above roughly 1,000 requests per phase.
- **Variance.** Runs are not statistically replicated; `busy` counts in particular vary with timing (earlier runs of slightly different mixes saw 0 to 4 victim refusals in B). The seed fixes job order only.

## Related

[Security risk actions: public resource exhaustion](security-risk-actions.md) (this slice addresses part of the open scale gate), [backend execution](backend-execution.md), [contact forms](contact-forms.md), [application data](app-data.md), [workload placement](workload-placement.md), [incident runbooks C2-C5 and gaps](incident-runbooks.md), [verification](verification.md#wh-050-local-capacity-harness--october-4-2026-utc). Harness: [`tools/capacity.mjs`](../tools/capacity.mjs).
