# Published website health

Publishing and restoring a version now attempt an HTTP check after the durable publication succeeds. A failed check does not undo publication. The receipt distinguishes saved publication from verified availability. No automatic rollback or repair is performed.

## Customer controls

- `/health [PROJECT_ID]` reads owned saved results without network requests.
- `/check-site PROJECT_ID` checks a currently published owned project.
- The workspace Details menu includes Website health.
- Natural language can list or check health through a strict server action. Model claims are replaced with the saved server receipt; the model cannot supply a URL or request a rollback.
- Guided commands consume no AI units. Natural-language interpretation retains normal AI usage accounting.

## What passes

A check reads only the fixed shared address `https://PROJECT_ID.whumpo.site/`. Redirects are refused, requests carry no customer cookies or secrets, and each request has a ten-second timeout. The HTML response must succeed, be HTML, fit 48 KiB, and match the exact saved version plus the current platform contact link. The saved artifact digest is checked too.

Up to four referenced photos receive HEAD requests against the same fixed address. They must return HTTP 200, JPEG content type and their recorded byte length. This confirms response availability and metadata, not image decoding or an independent full-body digest. The public host separately enforces object metadata and size.

These results do not test custom-domain routing, visitor form submission, browser layout, accessibility or worldwide availability. They describe a particular point in time, not an uptime guarantee.

## Consistency and limits

Migration 0029 records the owner, version, publication revision, contact revision, source, state and timestamps. A publication or contact change invalidates the previous result. Changes during verification mark that check superseded. Interrupted checks and healthy results older than six hours are labeled accordingly. Tenant ownership is enforced on every customer endpoint.

A database trigger claims the check before network dispatch, limits a given publication/contact state to one check per five minutes, and caps all checks at 500 per UTC day. Repeated requests return the saved result. The global counter survives account/project removal. Each check uses at most five HTTP requests, including four photo reads; photo reads also consume the existing application R2 budget. Existing account allowances remain shared.

The hourly maintenance trigger considers at most 20 due sites, in batches of four, skipping current results started within six hours. This bounded schedule may take longer to cover a large installation. Check history is retained for 30 days; daily counters for 62 days. Activity events contain only a sanitized outcome. No response body or provider error is copied into diagnostics. Platform checks send `User-Agent: whumpo-site-check/1`, so their public-path requests are excluded from page counts (see below).

## Verification

Disposable D1/R2 tests cover fixed-origin and ownership boundaries, cooldown concurrency, failed HTTP/content/redirect/size checks, publication and contact races, missing photos, publish receipts, replay, guided usage, model action restrictions, scheduling and daily caps. Production acceptance is recorded in deployment.md. A real scheduled production run and successful custom-domain probes are not implied by controlled tests.

## Owner diagnostics and bindings — WH-037

Status: implemented and locally tested on disposable SQLite/D1 fixtures; not deployed, and no live acceptance is implied. Cloudflare Workers `waitUntil` runs after the response is sent ([Workers context](https://developers.cloudflare.com/workers/runtime-apis/context/)); D1 behavior is described at [D1](https://developers.cloudflare.com/d1/). Nothing here enables a paid service, changes DNS or calls a provider.

### What the owner sees

The `site-health` view component (Chat temporary view, saved page or workspace card; binding `project.site-health@1`) gives, per owned project, five separate areas so one problem is not mistaken for another: **publication** (published version id and revision, version-saved time), **website check** (saved check state: not checked, changed, interrupted, stale, healthy, unhealthy, superseded, with its evidence time), **domain** (ownership proof, hosting connection state, Cloudflare hostname/TLS status words from the last saved check, expired proof, and its status time), **forms** (form live or not live, contact page live, held or needing republish, and a count of retained messages) and **traffic** (counted requests, excluded automated requests, missed measurements and a measurement state). Every area states its own evidence timestamp or "no evidence yet". Hostnames are the owner's own; no visitor address, user agent, form content, proof token or provider detail is ever returned, and the shared client validator rejects any widened shape.

Domain and TLS rows describe saved records. They are not a live DNS or TLS probe: a stale hosting status shows as `needs_check`, and the page check never covers custom domains (above). Form rows describe approval and publication state, not an end-to-end visitor submission test.

### Findings and recommended exact actions

Each area yields at most a few findings (ok, note, needs attention) and optionally one recommended command from a closed list: `/check-site PROJECT`, `/health PROJECT`, `/project PROJECT`, `/check-hosting CONNECTION`, `/verify-domain CLAIM`, `/hosting`, `/domains` and `/traffic`. These are existing owner Chat commands, shown exactly as the owner would send them. The component never runs them. `/check-hosting` is the existing owner command that reads Cloudflare hostname status for the owner's own connection under its reviewed rules; no new provider call, DNS edit, publication, rollback or other mutation is recommended or reachable from this surface. The client validator rejects any command outside the list or for another project.

### Telemetry states and exclusions

Traffic counts remain successful public HTML GET requests at the shared or an active custom hostname. Newly defined:

- **Excluded and counted separately** (aggregate `site_traffic_quality.excluded_requests`, never stored with an agent string): requests whose `User-Agent` matches a fixed list of automation markers (bot, crawl, spider, slurp, monitor, uptime, headless, lighthouse, pingdom, curl, wget, python-requests, go-http-client, facebookexternalhit, embedly) and Whumpo's own check (`whumpo-site-check`). A missing or unrecognized agent is counted, so counts can still include unidentified bots, repeat visits and other checks. HEAD, non-200, non-HTML, asset and API requests are neither counted nor classified.
- **States:** `unavailable` (collection not enabled), `not_published`, `delayed` (a measurement failed or was shed in the last two hours and may still be flushed), `gaps` (older missed measurements in the window), `partial` (collection began inside the 30-day window) and `complete`. Today is always partial. Counts are a lower bound whenever the state is delayed or gaps, and "no visitors" is only suggested for a healthy page with complete measurement.
- **Retention:** daily counts and quality counters for the last 30 UTC dates; health checks 30 days. Held projects keep older rows (WH-132) but readers never show them.

### Measurement budget

Serving never waits for measurement. Each counted or excluded request costs one aggregate D1 upsert after the response through `waitUntil`, plus the existing custom-hostname lookup when applicable. At most 32 run concurrently per isolate; extra measurements are shed, remembered (at most 128 keys, per isolate) and written as `missed_measurements` after the next successful write, at most four per call. A failed write is remembered the same way. Isolates that end before flushing lose their memory, so a missed count is a lower bound. Failures before the project can be identified cannot be attributed. No retries, queues or extra services are added.

### Registered bindings

`siteHealthBindings` in `src/site-diagnostics.ts` registers `project.site-health@1` (read; `readSiteDiagnostics`), `site-health.report@1` (read; the existing saved report via `listHealth`) and `site-health.check@1` (action; `checkHealth`, the existing `POST /api/projects/{project}/health`, Chat `/check-site` and ChatControl `checkWebsite`). Domain handlers are implemented once and are shared by HTTP, Chat and the view. The check keeps its identity and ownership checks, five-minute cooldown, daily budget and fixed origin. A model can show the read view only and cannot start a check from it. Direct recovery controls (the owner HTTP check and the workspace button) remain.

### Verification

`pnpm test:site-health` runs `tests/site-health.mjs` and `tests/site-diagnostics.mjs`; `node tests/site-traffic.mjs` covers counting. Synthetic cases cover missing, late and failed telemetry, shed work, exclusions, stale/interrupted/unhealthy/changed checks, DNS/TLS and form states, cross-owner reads and canary leakage. Live deployment, real bot traffic and custom-domain probes are not tested.

WH-183: a health check's identity now includes the live directory review (`directory_review_id`, compared like the live form). When a directory is live for the current publication, the check also fetches `/directory.json` from the fixed platform origin and requires the `ETag` and the SHA-256 of the served listings to equal `live_digest`. Custom hostnames are still not probed.

## WH-051 — offline hot-path evidence

Status: source-only evidence recorded 2026-11-01. This does not deploy, cut over schema group C5, establish production D1 latency/cost, or complete WH-051. No serving, caching, TTL, provider or traffic behavior changed. The existing hostname partial-index predicate and `contact_reviews_project(project_id,expected_revision)` index are measured, not reimplemented. The known CMS scan remains deferred; no CMS functional suites were run.

### Reproduce and interpret

```sh
mise exec node@24.21.0 pnpm@11.19.0 -- pnpm test:hot-path-performance
```

`tests/hot-path-performance.mjs` emits JSON (environment, schema hash, sizes, timings, operation counts and complete query plans). It accepts no database path or remote target. Each size starts from the complete current schema in a disposable SQLite file; independent copies hold current behavior, the hostname query without the repeated partial-index predicate, contact queries without `contact_reviews_project`, and traffic writes. Only the disposable pre-fix contact copy drops an index. Foreign keys and integrity are checked. SQL comes from `src/site-host.ts` and the current schema contact-review join, with result-equivalence, hit/miss and scan/index assertions. Timing thresholds are deliberately not regression gates.

Recorded environment: Node v24.21.0, SQLite 3.53.4 (`node:sqlite`), Linux x64, kernel 6.8.0-1061-aws, CPU reported as Intel(R) Xeon(R) Processor. Current schema SQL SHA-256: `7978d4b2b57b0918ba329b622b163e43d819a7de1d015accb02dd990c73ab7c4`. These are single-process, warm OS-cache, local-file measurements, with DELETE journaling, synchronous FULL and no ANALYZE. They exclude Workers runtime/network/D1 scheduling, cold starts, and production contention.

| Fixture | 100 projects | 1,000 projects |
| --- | ---: | ---: |
| Owners (20 projects each) | 5 | 50 |
| Published versions (~8 KiB HTML each) | 100 | 1,000 |
| Domain connections (40 active, rest disconnected history) | 400 | 4,000 |
| Domain claims (within current claim/active-host limits) | 40 | 40 |
| Contact settings / applied reviews | 100 / 1,000 | 1,000 / 10,000 |
| Daily traffic rows / quality rows (30 days) | 3,000 / 3,000 | 30,000 / 30,000 |

Fixtures use synthetic artifacts and historical contact reviews, not customer data or generated-artifact acceptance. There are no service-client activation reviews: the full page's blocked-contact view can short-circuit that empty relation. To avoid presenting that case as evidence of contact-page speedup, a separate microbenchmark exercises the **exact contact-review join** from `service_client_blocked_contacts`, excluding its activation-held join. This isolates index scaling; it is **not full-page latency**. Modern populated activation-held paths still need representative measurements.

Reads use 20 warmup pairs then 40 measured batches of 10 queries per variant (400 measured queries each), alternating before/current order. Statements are prepared before timing. The numbers below are **median / p95 of batch-mean microseconds per query**, not request percentiles. Scheduler noise can affect tails (notably the 100-project current hostname-hit sample); no outliers were removed.

| Read | 100 before | 100 current | 1,000 before | 1,000 current |
| --- | ---: | ---: | ---: | ---: |
| Custom hostname hit | 34.34 / 38.20 | 12.33 / 166.18 | 312.44 / 329.31 | 12.73 / 13.76 |
| Custom hostname miss | 37.55 / 38.14 | 10.91 / 10.98 | 356.20 / 394.28 | 11.18 / 12.77 |
| Traffic custom hostname hit (lookup removed 2026-11-02, see below) | 34.11 / 40.13 | 11.89 / 14.61 | 304.51 / 329.21 | 12.26 / 13.65 |
| Traffic custom hostname miss (lookup removed 2026-11-02) | 36.75 / 37.29 | 10.90 / 11.43 | 368.96 / 510.23 | 11.29 / 12.44 |
| Contact-enabled full published-page read | 18.17 / 23.36 | 18.35 / 23.70 | 18.22 / 29.02 | 18.38 / 24.07 |
| Isolated contact-review join (not page latency) | 58.25 / 68.43 | 12.58 / 13.52 | 487.30 / 513.18 | 13.01 / 14.59 |

The pre-fix hostname plans scan `domain_connections`; current plans search `domain_connection_hostname`. Removing the contact index reproduces `SCAN r`; the current page/join plans search `contact_reviews_project`. All current non-CMS read plans have no full scan, and results match their isolated pre-fix copies. The hostname and isolated review join scale better locally; the full-page fixture shows **no measurable contact latency improvement**. Plan evidence is not a measured count of rows read or billed.

### Per-page traffic write profile — no behavior fix

The harness calls the actual bundled `measureTraffic` with the existing SQLite D1 adapter on a separate populated file. Each kind has 20 warmups and 400 measured individual calls, awaited sequentially, targeting a new UTC day then updating the same aggregate. Unlike reads, these timings include preparing the SQL and committing the write; p95 is over individual calls, not batch means.

| Traffic kind | 100 projects median / p95 (µs) | 1,000 projects median / p95 (µs) |
| --- | ---: | ---: |
| Counted | 328.80 / 554.30 | 352.21 / 1,108.39 |
| Excluded automation | 334.28 / 732.80 | 368.58 / 1,979.74 |

For **each kind at each size**, the wrapper observed exactly 420 prepares, 420 runs and 420 changed rows, including warmups; the aggregate increased by exactly 420. The upsert's project/publication check uses indexed searches without a full scan. This establishes one aggregate-row write per normal measurement in this workload, not production write units or bills. It does not profile pending-gap flushing, concurrent isolates, retention cleanup or D1 saturation; local commit timing varies with filesystem scheduling.

No measured production bottleneck or contract-supported batching/cache change is established, so no behavioral fix is justified by this experiment. Serving still uses `waitUntil`, fails open on telemetry failure and retains its bounded shedding/gap behavior. Writes are not billing events and no billing path was changed.

### Delayed analytics on custom domains — measured fix

Status: source change, 2026-11-02. Not deployed or accepted live; WH-051 stays planned. No caching, TTL, DNS, provider, schema, billing or serving-response change.

Finding: on a connected custom domain the after-response count (`src/site-host.ts` default export) repeated the hostname lookup serving had just made, before entering `measureTraffic`. That lookup ran outside the `MAX_IN_FLIGHT` measurement budget, so while D1 was slow every custom-domain page left one more D1 read pending in `waitUntil` with no cap. Serving now records the project its own owner-joined mapping resolved in a `WeakMap` keyed by the request, and the count reads it. The count still happens only for a served 200 HTML GET, for the project that page was served from.

`node tests/delayed-traffic.mjs` (and `--d1`) drives the real sites Worker export on a custom domain connected through the real domain-hosting handlers (stubbed provider and DNS, network blocked). It treats statements a GET issues beyond the identical, unmeasured HEAD as measurement and stalls only those. Results on main before the change and on this branch, identical on SQLite and local D1:

| Custom-domain page | Before | After |
| --- | ---: | ---: |
| D1 statements per page | 7 | 6 |
| Of which after the response (measurement) | 2 (hostname lookup, daily upsert) | 1 (daily upsert) |
| Hostname lookups per page | 2 | 1 |
| Peak stalled measurement statements, 40 concurrent pages, budget 32 | 40 | 32 |
| Measurements shed (and later disclosed as missed) in that burst | 0 | 8 |

The test asserts the after column. Pages return with the same body and `cache-control: no-store` while every measurement is stalled. Medians of 20 sequential pages, normal and stalled, were 0.84 / 0.73 ms on SQLite and 31.0 / 28.1 ms on local D1, so a stall adds no serving latency. These are local timings, not gates. With the budget now applied, a burst over 32 sheds work that the old uncapped lookup would eventually have counted. Counted plus disclosed missed still equals pages served, as on project hosts. A stalled measurement that then fails is disclosed after the next successful write.

Billing: across the stalled, shed, failed and flushed measurements every table other than `site_traffic_daily` and `site_traffic_quality` is compared row for row and unchanged, including 16 billing, cost, capacity, usage and quota tables (for example `stripe_paid_invoices`, `cost_events`, `capacity_ledgers`, `storage_usage`, `public_client_usage`). No trigger is defined on either traffic table, their only foreign key is `projects`, and a source guard fails if any module other than the seven current readers and writers (none of them billing, cost or capacity) references traffic. Traffic rows are not billing events.

Not shown: production D1 rows read or billed, Workers `waitUntil` cancellation behaviour. If a stalled D1 call never settles before the runtime cancels it, the in-flight slot may never be released in that isolate. That is unverified locally and recorded as open. Project-host pages (`<project>.whumpo.site`) were already one lookup-free upsert and are unchanged (the `tools/capacity.mjs` site pin stays 5).

### Correctness regressions and remaining evidence

The following were rerun sequentially on disposable current-schema fixtures:

```sh
pnpm test:traffic
pnpm test:publications
pnpm test:site-health
node tests/site-safety.mjs
node tests/site-safety.mjs --d1
pnpm test:contacts
pnpm test:hosting-chat
node tests/domain-hosting.mjs
node tests/boundary-custom-domain-owner.mjs
node tests/boundary-site-isolation.mjs
node tests/hot-path-query-plans.mjs
```

These cover actual handlers/local D1 for private-before-publish and `no-store` responses, publish/restore/unpublish, withdrawal and stale-review revocation, contact disable/publication races, tenant and custom-host ownership boundaries, excluded traffic, delayed/gaps measurements, the 32-in-flight cap, and fail-open/nonblocking serving. No UI-driven test, live custom domain, production probe, provider call or real send was performed.

Scope caveat: the site-isolation boundary suite includes a cross-host `/cms/` 404 rejection, not a CMS functionality test. No further CMS-path checks were run. The custom-domain owner suite also retains its existing S6-1 characterization: an orphaned connection after ownership transfer can starve later maintenance batches. That unrelated maintenance finding is not fixed or represented as passing behavior here.

Remaining WH-051 evidence: production D1 query metadata and rows-read/written billing, request latency/throughput under representative load (including populated service-client activation/held paths and concurrent traffic/gap flushing), and independently authorized schema/deployment/live revocation acceptance. `node:sqlite` exposes neither D1 billing nor runtime scan/VM-step counters, so production cost and runtime rows read remain **unknown**. This slice does not close those gates or the roadmap task.
