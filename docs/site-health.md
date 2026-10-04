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
