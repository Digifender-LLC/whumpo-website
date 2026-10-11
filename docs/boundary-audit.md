# WH-004 boundary audit: mounted Worker, scheduled and operator-tool registry

**WH-004 slice 1 · October 8, 2026 UTC · source commit `ca17c6a`; slice 2 · October 8, 2026 UTC · base `21204da` · source and local-fixture evidence only.** Slice 1 is a checked, structural inventory of the platform Worker's mounted request surface with an evidence registry and three reproduced findings. Slice 2 extends the same registry to the `whumpo-sites`, `whumpo-apps` and `whumpo-runtime` Workers, Worker reachability declared in `wrangler*.jsonc`, the platform's public contact form and scheduled jobs, and operator tools under `tools/` that can reach remote state, with four more findings (three reproduced defects, one characterization). It is **not an exhaustive security claim**, not live or device acceptance, and does not close WH-004. Old green suites are cited only where a specific assertion line was read; a passing suite is never treated as proof of a scenario it does not exercise.

It extends the [October 1 source audit](tenant-authority-audit.md) (commit `a34a131`, findings A1–A3, all remediated). That document remains the historical record. This slice re-reviews current code, adds identity/admission, safety withdrawal, shared modules, guest previews and other surfaces added since, and makes the route inventory a regression guard.

Files: [`docs/boundary-audit.json`](boundary-audit.json) (registry), [`tools/boundary-audit.mjs`](../tools/boundary-audit.mjs) (extractor/checker), [`tests/boundary-audit.mjs`](../tests/boundary-audit.mjs) (offline test, `protection` profile and `pnpm test:boundary-audit`).

## Method

1. **Structural extraction.** `tools/boundary-audit.mjs` parses dispatcher source with the TypeScript 7 syntax tree (`typescript/unstable/sync`, the compiler already used by `pnpm check`; no new dependency, offline). Comments, string contents and fixtures cannot create or hide a route. It reads:
   - every path comparison in [`src/index.ts`](../src/index.ts) (`pathname===`, `startsWith`, `pathname.match(/regex/)`), with the methods that reach each matcher;
   - the sub-dispatchers: identity actions ([`src/workspace-identity/http.ts`](../src/workspace-identity/http.ts)), operator safety-case actions ([`src/safety-case-http.ts`](../src/safety-case-http.ts)), Chat interactions ([`src/chat-interactions/http.ts`](../src/chat-interactions/http.ts)), support ([`src/support.ts`](../src/support.ts)) and the body-dispatched module operations table ([`src/shared-modules/policy.ts`](../src/shared-modules/policy.ts));
   - every typed Chat control in [`src/chat-controls.ts`](../src/chat-controls.ts) with its literal `recentAuth` flag (`confirm` expanded per reviewed kind);
   - the dispatch order in `handle()` around the exact-Origin gate, which routes run before that gate, and which routes' consuming code calls `requireFreshWorkspace`.
2. **Registry.** [`docs/boundary-audit.json`](boundary-audit.json) assigns each extracted matcher and control to exactly one family. Each family records an authority class and six cells: authority, origin, freshness (recent passkey proof), immutable target with exact-review binding, replay/idempotency, and stale-state guard. Cell states:
   - `evidenced`: enforcing code located **and** an existing test line asserts the property (negative cases for authority, replay and stale state);
   - `gap`: `gapKind: "test"` means enforced but no test asserts it; `gapKind: "control"` means required by a contract or runbook but not enforced, and must name a finding;
   - `n/a`: with the reason (read-only, or not required by the current contract);
   - `unverified`: not established in this slice, with what is needed.
3. **Anchors instead of line numbers.** Every enforcement and test citation is `{file, contains}`. The test checks that the file exists and still contains that exact text, so a deleted assertion or rewritten guard fails loudly, while unrelated edits do not. 710 anchors are checked (464 from slice 1).
4. **Review.** Four read-only reviews traced the privileged families end to end (cross-owner/project/visitor access, model-confirmation bypass, Origin, stale/replay, GET side effects). Every candidate finding was then re-checked in source by the auditor; the three reported below were **executed** against disposable fixtures. Candidates that could not be reproduced are listed as unverified risks. Slice 2 used four more read-only reviews (sites, apps, runtime/contact/scheduled, operator tools); the auditor re-checked each candidate in source, executed reproductions for B4–B6 and a characterization for B7, and kept everything not executed as an unverified risk.
5. **Slice 2 extraction** (same tool, same offline compiler):
   - [`src/site-host.ts`](../src/site-host.ts) (both `fetch` handlers), [`src/app-host.ts`](../src/app-host.ts), [`src/app-gateway.ts`](../src/app-gateway.ts) `applicationGateway` and [`src/runtime/worker.ts`](../src/runtime/worker.ts): path matchers (including `new RegExp(...)` matchers, `[...].includes(pathname)` and the runtime's `if(method!=='POST'||pathname!=='/execute')return` form), **host/origin dispatch** (`customerProject(url.hostname)`, `url.hostname===guestPreviewHost`, `url.origin!==origin`, the custom-domain D1 lookup), and early-return **method refusals** (`if(method!=='GET'&&method!=='HEAD')return 405`, `!['GET','POST'].includes(method)`), which narrow the methods of every matcher they dominate. The platform's own `fetch()` host check is registered too.
   - The visitor gateway's own Origin/Sec-Fetch-Site refusal: every gateway matcher before it is flagged `beforeOriginGate` (only the host and route matchers are).
   - The platform `scheduled()` handler: each cron branch and every job it runs (`runMaintenance` lists and the bare contact-notice drain), with a `conditional` flag for jobs gated on provider configuration; every cron branch must be a configured trigger.
   - **Worker reachability** from `wrangler*.jsonc`: entry file, public routes, workers.dev/preview URLs, service bindings and crons per Worker; each entry must be an audited dispatcher. `whumpo-apps` and `whumpo-runtime` are machine-checked as service-binding-only.
   - **Remote-capable operator tools**: a `tools/*.mjs` file whose string literals contain `https://api.cloudflare.com`, `https://api.stripe.com`, `https://api.github.com`, `--remote`, or that spawns `gh` or Wrangler `deploy`/`versions`/`secret`, plus any tool that imports one. Tools are parsed, never imported or run.
   - Slice-2 families add a `surface` (`visitor`, `service`, `scheduled`, `operator-tool`), a required `reach` statement, and two cells: **admission** (Turnstile, rate limits, per-client/fairness controls) and **tenant** (tenant/visitor scoping with cross-tenant refusal evidence). Required cells depend on surface and privilege; slice-1 `platform-api` families are unchanged.

### What the test enforces

`node tests/boundary-audit.mjs` fails if a mounted route, method or typed control is missing from the registry; if a registered entry no longer exists; if a route's `freshnessCall` or `beforeOriginGate` flag, a control's `recentAuth`, or the dispatch order changes; if a privileged family lacks any of the six cells; if an `evidenced` cell lacks code or test anchors; if any anchor file is missing or no longer contains its text; if a control gap lacks a finding; or if the summary below is stale. It includes source mutations (an unregistered route stub, a widened method, a relaxed `recentAuth`, a new identity action, a removed freshness call, a router moved ahead of the Origin gate) and registry mutations, and asserts each is reported. Slice 2 adds: a new site-host route (reported with the GET/HEAD methods the refusal allows), removal of that refusal (every serving route widens to ANY), a new host dispatch, deletion of the visitor gateway Origin refusal, removal of the module upload's POST-only refusal, the runtime accepting any method, a public route or workers.dev URL on a service-binding-only Worker, a new scheduled job, a provider job losing its configuration gate, an unconfigured cron branch, and new operator tools reaching Cloudflare directly or through an import (a URL in a comment is not a marker); and registry mutations for a missing `tenant` cell, a missing `reach` and an unregistered Worker. It takes about 10 seconds (it now parses every `tools/*.mjs`). The native compiler client may print `context canceled` on stderr while shutting down; this is benign and does not affect results or the exit status.

When a route is added, register it in the JSON with reviewed cells; do not weaken the checker.

## Scope

Covered: the platform Worker request surface (`whumpo.com`), i.e. `fetch()` → `/contact/:id`, `/api/*` → `handle()` → identity router → exact-Origin gate → operator router → session admission → `handleWorkspace()`, its sub-dispatchers, and the typed Chat controls that reach confirmation verbs.

Slice 2 covers, at the dispatcher level with per-family evidence:

- **whumpo-sites** (`*.whumpo.site/*`, public internet): host dispatch, site root, published photos, directory, CMS listing/articles/media (source only; CMS testing is owner-deferred), the public stateless backend, custom-domain mapping, guest previews on `preview.whumpo.site`, and post-response traffic measurement.
- **whumpo-apps** (service binding only, through `APP_HOST`): the page shell and assets, the gateway's shared gates, visitor passkey/recovery/sign-out, export and deletion, application data/receipts/transitions, and `POST modules` / `modules/upload`.
- **whumpo-runtime** (service binding only from all three other Workers): `POST /execute`.
- **Platform visitor/public paths**: `/contact/:id` (now its own family), the signed Stripe webhook (slice 1), and the scheduled handler. There is **no** mounted `/report` or other abuse-report route and no other webhook; a public abuse-report intake is not implemented.
- **Operator tools**: 31 remote-capable `tools/*.mjs` files in three families (release, mutation, read-only). Their guard rails were read; **none was run**.
- **WH-050 operator serving stop** (added when slice 2 was ported onto `main` `4dea09c`, October 9, 2026 UTC): #186 added one guard on the site host and one in the visitor application gateway. Their path comparisons are registered as the `operator-serving-stop` family (seven entries; admission and tenant cells evidenced by `tests/operator-containment.mjs`). They are not new mounted routes: every request the guard lets through stays in its own family.

**Not covered:** live Cloudflare routing (including whether Cloudflare for SaaS custom hostnames reach the `*.whumpo.site/*` route), live secrets/vars and activation state; the model's prompt/output quality; Chat interaction continuation semantics (`/api/chat/interactions/v1/continue` model path) beyond authority/Origin; CMS runtime behaviour (CMS functional testing is owner-deferred, source review only); live Cloudflare/GitHub/Stripe behaviour; native devices; D1 Time Travel/backup-aware erasure; distributed abuse. The Codex Security scan workflow named in the packet was not re-run; this slice is a manual plus structural review.

## Matrix summary

<!-- boundary-audit summary: generated by `node tools/boundary-audit.mjs summary`; checked by tests/boundary-audit.mjs -->
Families: 52 (36 privileged; platform-api 28, visitor 17, service 1, scheduled 3, operator-tool 3). Workers: 4. Registered route matchers: 244; host/origin dispatch matchers: 12; scheduled jobs: 19; remote-capable operator tools: 31. Typed Chat controls: 38. Recorded findings: 7.

| Cell | evidenced | gap | n/a | unverified |
| --- | ---: | ---: | ---: | ---: |
| authority | 37 | 3 | 12 | 0 |
| origin | 42 | 0 | 4 | 0 |
| freshness | 7 | 6 | 11 | 0 |
| target | 34 | 1 | 2 | 0 |
| replay | 34 | 0 | 3 | 0 |
| stale | 37 | 2 | 1 | 2 |
| admission | 10 | 2 | 5 | 1 |
| tenant | 22 | 0 | 0 | 1 |

Cells not recorded (not required for that family's surface and privilege): 137.

| Family | Surface | Privileged | Entries / controls | authority | origin | freshness | target | replay | stale | admission | tenant |
| --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- | --- | --- |
| public-entry | platform-api | no | 4 / 0 | n/a | evidenced | — | — | — | — | — | — |
| identity | platform-api | credential | 23 / 0 | evidenced | evidenced | evidenced | evidenced | evidenced | evidenced | — | — |
| operator-safety-cases | platform-api | safety-operator | 21 / 0 | evidenced | evidenced | evidenced | evidenced | evidenced | evidenced | — | — |
| stripe-webhook | platform-api | billing | 1 / 0 | evidenced | n/a | n/a | evidenced | evidenced | evidenced | — | — |
| billing-owner | platform-api | billing | 5 / 0 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced | — | — |
| support | platform-api | no | 5 / 0 | evidenced | evidenced | — | — | — | — | — | — |
| chat-transport | platform-api | no | 19 / 2 | evidenced | evidenced | evidenced | evidenced | evidenced | evidenced | — | — |
| workspace-owner | platform-api | no | 23 / 0 | evidenced | evidenced | — | — | — | — | — | — |
| service-site-safety | platform-api | publish | 9 / 0 | evidenced | evidenced | gap (control B2) | evidenced | evidenced | evidenced | — | — |
| cms | platform-api | cms, publish | 15 / 5 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced | — | — |
| backend | platform-api | publish, data-change | 10 / 3 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced | — | — |
| application-page | platform-api | publish | 2 / 1 | evidenced | evidenced | n/a | gap (test) | evidenced | evidenced | — | — |
| visitor-access | platform-api | access, deletion | 1 / 0 | evidenced | evidenced | evidenced | evidenced | evidenced | evidenced | — | — |
| application-activation | platform-api | activation | 2 / 1 | evidenced | evidenced | gap (control B2) | evidenced | evidenced | evidenced | — | — |
| application-recovery | platform-api | data-change, activation | 0 / 2 | evidenced | evidenced | evidenced | evidenced | evidenced | evidenced | — | — |
| shared-modules | platform-api | activation, access, deletion | 20 / 7 | evidenced | evidenced | evidenced | evidenced | evidenced | evidenced | — | — |
| contacts-directory | platform-api | publish, deletion | 6 / 3 | evidenced | evidenced | gap (control B2) | evidenced | evidenced | evidenced | — | — |
| domain-hosting | platform-api | dns-hosting | 3 / 0 | gap (test) | evidenced | n/a | evidenced | evidenced | gap (test) | — | — |
| domains | platform-api | dns-hosting, deletion | 1 / 3 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced | — | — |
| photos-files | platform-api | deletion | 2 / 1 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced | — | — |
| specification-service-clients | platform-api | publish, activation | 4 / 2 | gap (test) | evidenced | evidenced | evidenced | evidenced | evidenced | — | — |
| guest-previews | platform-api | publish, deletion | 3 / 2 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced | — | — |
| site-publication | platform-api | publish, deletion | 5 / 3 | evidenced | evidenced | gap (control B2) | evidenced | evidenced | evidenced | — | — |
| site-health | platform-api | no | 2 / 0 | evidenced | evidenced | — | — | — | — | — | — |
| cloudflare-dns | platform-api | dns-hosting | 4 / 0 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced | — | — |
| cloudflare-connection | platform-api | connection | 5 / 0 | evidenced | evidenced | gap (control B2) | evidenced | evidenced | evidenced | — | — |
| github-connection | platform-api | connection, deletion | 8 / 2 | evidenced | evidenced | gap (control B2) | evidenced | evidenced | evidenced | — | — |
| github-backups | platform-api | backup | 3 / 1 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced | — | — |
| public-contact-form | visitor | visitor-data | 1 / 0 | n/a | evidenced | — | evidenced | evidenced | evidenced | evidenced | evidenced |
| site-host-dispatch | visitor | no | 3 / 0 | n/a | n/a | — | — | — | — | n/a | evidenced |
| site-root | visitor | no | 1 / 0 | n/a | evidenced | — | — | — | evidenced | n/a | evidenced |
| site-assets | visitor | no | 1 / 0 | n/a | evidenced | — | — | — | evidenced | evidenced | evidenced |
| site-directory | visitor | no | 1 / 0 | n/a | evidenced | — | — | — | evidenced | n/a | evidenced |
| site-cms | visitor | no | 3 / 0 | n/a | evidenced | — | — | — | unverified | unverified | unverified |
| site-backend | visitor | execution | 1 / 0 | n/a | evidenced | — | evidenced | n/a | evidenced | evidenced | evidenced |
| site-custom-domain | visitor | no | 2 / 0 | n/a | evidenced | — | — | — | evidenced | n/a | evidenced |
| site-traffic | visitor | no | 4 / 0 | n/a | n/a | — | — | — | — | n/a | evidenced |
| operator-serving-stop | visitor | no | 7 / 0 | n/a | n/a | — | — | — | — | evidenced | evidenced |
| guest-preview-host | visitor | visitor-data | 3 / 0 | evidenced | evidenced | — | evidenced | evidenced | evidenced | evidenced | evidenced |
| visitor-app-shell | visitor | no | 5 / 0 | n/a | evidenced | — | — | — | — | gap (test) | evidenced |
| visitor-gateway-dispatch | visitor | no | 3 / 0 | evidenced | evidenced | — | — | — | — | evidenced | evidenced |
| visitor-auth | visitor | credential | 4 / 0 | evidenced | evidenced | — | evidenced | evidenced | evidenced | gap (control B5) | evidenced |
| visitor-account-lifecycle | visitor | deletion, visitor-data | 4 / 0 | evidenced | evidenced | — | evidenced | evidenced | evidenced | evidenced | evidenced |
| visitor-app-data | visitor | visitor-data, execution | 4 / 0 | evidenced | evidenced | — | evidenced | evidenced | evidenced | evidenced | evidenced |
| visitor-modules | visitor | visitor-data | 2 / 0 | evidenced | evidenced | — | evidenced | evidenced | evidenced | evidenced | evidenced |
| runtime-execute | service | execution | 1 / 0 | evidenced | evidenced | — | evidenced | n/a | n/a | evidenced | evidenced |
| scheduled-maintenance | scheduled | deletion | 15 / 0 | evidenced | — | — | n/a | n/a | evidenced | — | evidenced |
| scheduled-provider-cleanup | scheduled | connection, dns-hosting | 3 / 0 | evidenced | — | — | evidenced | evidenced | gap (test) | — | evidenced |
| scheduled-contact-delivery | scheduled | notification | 1 / 0 | evidenced | — | — | n/a | evidenced | unverified | — | evidenced |
| operator-release | operator-tool | release | 9 / 0 | evidenced | — | — | evidenced | evidenced | evidenced | — | evidenced |
| operator-mutation | operator-tool | operator | 11 / 0 | gap (control B4) | — | — | evidenced | evidenced | evidenced | — | evidenced |
| operator-read | operator-tool | no | 11 / 0 | evidenced | — | — | — | — | — | — | — |
<!-- /boundary-audit summary -->

Shared gates (all machine-checked by the registry test):

- `handle()` order: `handleIdentityRequest` → exact-Origin gate → `handleSafetyCaseRequest` → `workspaceIdentity` → `handleWorkspace`. Only `/api/health` (GET), `/api/stripe/webhook` (signed), the identity router (own POST + exact-Origin check) and, in `fetch()`, `/contact/:id` (own Origin check on POST) precede the gate.
- GET, HEAD and OPTIONS skip the Origin gate; the session cookie is `SameSite=Lax`. Registered handler methods are exact; the `ANY` entries are gates or delegations whose targets compare methods themselves, so HEAD/OPTIONS reach no mutating handler.
- Every workspace D1 statement is batched with an identity assertion ([admission](../src/workspace-identity/admission.ts)); `tests/workspace-admission.mjs` revokes a session mid-request and proves the commit is refused. This replaces the deleted `tests/owner-credential-authority.mjs` that the October 1 A1 record cites.
- Only four direct route blocks call `requireFreshWorkspace`: visitor-access POSTs, Cloudflare OAuth start, GitHub OAuth start, and the `/api/chat`/`/api/chat/actions` POST block (only for a `recentAuth` control). Seven typed controls are `recentAuth` (specification and service-client apply, module activation and staff-role apply, app restore, app maintenance, GitHub grant confirm); no `confirm:*` kind is. GitHub grant confirm also calls it inside the domain function.

Slice-2 gates (machine-checked):

- **Reachability.** `whumpo-platform`: custom domain `whumpo.com`, crons `17 3 * * *`, `47 * * * *`, `* * * * *`, binds `BACKEND_RUNTIME`. `whumpo-sites`: route `*.whumpo.site/*`, binds `APP_HOST` and `BACKEND_RUNTIME`. `whumpo-apps` and `whumpo-runtime`: no route, workers.dev or preview URL (service binding only). Any change to these is reported. The platform's `fetch()` refuses any origin other than `https://whumpo.com` outside `ENVIRONMENT=local`.
- **whumpo-sites.** Host dispatch order: visitor-app host → `APP_HOST`; preview host → guest preview; project host → path rewritten under `/s/<project>`; public backend (project host or local alias only) → then a GET/HEAD refusal before every other serving route; any other host must be an active, provider-attached, owner-matching custom domain and may request only `/` and `/assets/<id>.jpg`.
- **Visitor gateway.** Host → route → query refused → GET/POST only → Origin/Sec-Fetch-Site refusal (only the host and route matchers run before it) → per-IP `API_LIMITER` → handlers. `modules/upload`, `modules` and data writes are POST-only; deletion, export, modules and auth run before the live-page check by design (WH-126).
- **Runtime.** Only `POST /execute`; the lane header must be a 64-hex per-project hash; at most two concurrent executions per isolate, one per lane.
- **Scheduled.** `* * * * *` runs only the contact-notice drain (only with the reviewed provider variables and `send_email` binding); `47 * * * *` runs the hourly set; every other configured cron (today `17 3 * * *`) runs the daily set. Provider jobs (`hosting`, `github`, `cloudflare`) and the drain are flagged `conditional`. No scheduled job calls a model.

### Model-confirmation boundary

No path was found from model output or plain Chat text to a confirmation. Plain `POST /api/chat` rejects an `action` key and sends every `/command` to the model; the only non-model conversation path is a transcript or usage-review phrase, which cannot match any `/verb` parser (every confirm parser is `^`-anchored or compares the exact first token). Model JSON is validated by prepare-only allowlists. Evidence: `tests/natural-chat.mjs` (literal `/confirm` inert, model-emitted confirm rejected, injected control shapes rejected, foreign control ineffective) and per-family model-refusal tests. Five confirm triggers do not themselves require a typed control (R2), so this routing is the only guard for those kinds.

## Findings (reproduced)

Severity reflects the current private, invitation-only test with a sole tester. None crosses tenant data confidentiality or integrity. Remediation needs owner sign-off; no `src/` or schema was changed in this slice. The reproductions are expected to exit 1 while the defect exists and are deliberately **not** in `package.json` scripts or any `tools/verify.mjs` profile. B3 has since been fixed on `main` by #178, so its reproduction now passes as a regression.

### B1 Platform-wide review capacity can be exhausted by one owner (low; availability, cross-tenant)

Each owner review table has a per-project cap of 100 **and a platform-wide cap of 1,000** (for example `backend_form_reviews`, `app_page_reviews`, `app_activation_reviews`, `backend_publication_reviews`, `backend_state_reviews`, `app_restore_reviews` in [`schema/platform.sql`](../schema/platform.sql)). Rows are never deleted while the project exists (delete guards; no cleanup in `src/`, `tools/` or the schema), and `tools/report-maintenance.mjs --counters` does not monitor these tables. An enrolled owner needs only their own projects (20 allowed) to fill a table; reviews need not be confirmed.

- **Reproduction (executed):** `node tests/boundary-review-capacity.mjs` (SQLite) and `--d1` (local D1). Owner A prepares 999 "form off" reviews across 10 of their own projects; owner B's next form review then fails with `409 Form review unavailable: ... review storage is full`. Expected: B unaffected.
- **Consequence traced in source (not executed):** safety withdrawal prepares a new `backend_publication_reviews` or `app_page_reviews` row ([`src/service-safety.ts`](../src/service-safety.ts)), so a full table blocks every owner's withdrawal and unpublish of those services. The per-project 100 is also a lifetime limit.
- **Remediation ownership:** platform schema/capacity maintainers, with an owner decision. Options: count only pending, unexpired reviews toward capacity or expire/prune terminal reviews; per-account caps; exempt withdrawal reviews; add these tables to the counters report. Any trigger change is a schema change requiring a coordinated cutover (`docs/releases.md`). Related: the open "public resource exhaustion" scale gate in [security-risk-actions.md](security-risk-actions.md).

### B2 Runbook says withdrawal/disconnect controls need recent authentication; the code does not (low; documentation/contract mismatch) — resolved October 8, 2026 by correcting the runbook

[`docs/incident-runbooks.md`](incident-runbooks.md) C10 states that unpublishing a site, disabling the application, disabling a contact form, revoking a visitor, removing a passkey, replacing the recovery kit and disconnecting GitHub/Cloudflare each need "the existing review, recent authentication and rate limits". In code, visitor revocation, passkey and kit changes do; the others do not: `confirm:site`, `confirm:application`, `confirm:contact` and the safety-withdrawal confirm routes accept any current session, and `POST /api/connections/{cloudflare,github}/disconnect` have neither freshness nor a rate limit.

- **Reproduction (executed for site unpublish):** `node tests/boundary-recent-auth.mjs`. A session whose passkey proof is one hour old prepares and confirms an unpublish review; the site goes offline (status 200). The other actions are evidenced structurally by the registry (`recentAuth:false` controls; no `freshnessCall` on those routes).
- **Impact:** these are protective actions; Origin and ownership are enforced. The risk is operational: an incident responder relying on C10 would overestimate the protection, and a stolen-but-valid session can take a site, application or connection offline without a passkey.
- **Resolution:** owner decision, October 8, 2026: correct C10 to match the feature contracts rather than add freshness to protective actions. `docs/incident-runbooks.md` C10 now states which controls need a recent passkey sign-in and that disconnects have no rate limit. `tests/boundary-recent-auth.mjs` is now a passing characterization of the documented behavior (still outside verify profiles). The cell stays `gap (control B2)` in the matrix because the code is unchanged; a future freshness policy (see R4) would change the test and runbook together.

### B3 Guest-preview revoke/delete control applies its effect outside the Chat turn's revision check (low; atomicity/receipt) — resolved October 9, 2026 by #178

Every other typed control appends its effect to the batch that inserts the Chat turn under the expected conversation revision ([`src/chat.ts`](../src/chat.ts)). `guestPreview` controls called `guestPreviewChatCommand` ([`src/guest-previews/bindings.ts`](../src/guest-previews/bindings.ts)), which revoked or deleted immediately, before that batch.

- **Reproduction (executed):** `node tests/boundary-guest-preview-race.mjs`. A delete control is paused before its turn batch while another control from the same owner commits. Before the fix, the delete request returned `409 Your conversation changed` and saved no turn, but the link and its comments were already deleted (exit 1). Expected: a refused request has no effect (as for all other controls).
- **Impact (before the fix):** same owner only, on an action they requested; the reported outcome was wrong and the retry path then returned 404. No cross-tenant effect.
- **Resolution (#178, merged October 9, 2026 UTC):** `guestPreviewChatCommand` now only checks ownership and returns the revoke/delete as a statement guarded by the saved Chat turn (`guestPreviewTurnStatements` in [`src/guest-previews/owner.ts`](../src/guest-previews/owner.ts)); [`src/chat.ts`](../src/chat.ts) appends it to the revision-checked turn batch. `node tests/boundary-guest-preview-race.mjs` now passes as a regression (still outside verify profiles); the maintained regression is `tests/guest-preview-chat-atomic.mjs` (SQLite and `--d1`: stale-revision delete and revoke, fresh, replay, foreign-owner and held-comment cases). The `guest-previews` stale cell is now `evidenced`. Not deployed or live-accepted by this audit.
- **Original remediation note:** Chat and guest-preview maintainers: return the revoke/delete statements to the turn batch like other controls. Source change needs owner sign-off.

### B4 Hosting recovery tool targets a retired control database (low; operator tooling) — resolved October 9, 2026

[`tools/reconcile-domain-hosting.mjs`](../tools/reconcile-domain-hosting.mjs) sends its D1 queries to a hard-coded database `680f98b9-…` (the `whumpo-control` database replaced on October 3, 2026). Every other remote tool resolves the database from `wrangler.jsonc` (`dba4c707-…`, `whumpo-control-2026-10-04`).

- **Reproduction (executed, static and offline):** before the fix, `node tests/boundary-operator-target.mjs` compared the tool's endpoint with the bound control database and exited 1. The tool was not run.
- **Resolution (October 9, 2026):** the tool now reads `account_id` and the `DB` binding from `wrangler.jsonc` and refuses to run if either is missing or malformed. The test now passes: it asserts the tool pins no endpoint, builds its endpoint from the configured account and database, and that no other operator tool pins a database id. The tool was not run against Cloudflare, so remote behavior is unverified. The `ENVIRONMENT==='test'` pin suggested below was not added; it remains optional hardening.
- **Impact:** `inspect`/`apply` would read and write a retired database (or fail if it no longer exists), so hosting recovery cannot act on current connections and an operator could believe a recovery was recorded. Live hosting state is not changed, and hosting is inactive behind `DOMAIN_HOSTING_READY`. Whether `680f98b9` still exists was not checked (no remote read).
- **Original remediation note:** operator tooling maintainers: read `account_id` and the `DB` binding from `wrangler.jsonc` like `review-fair-use.mjs`, and add an `ENVIRONMENT==='test'` pin. Tool-only change; no schema. Do not run the tool remotely until fixed.

### B5 Anonymous visitor login starts can exhaust app challenge capacity (low; availability, cross-tenant)

`POST /apps/:project/auth/login/options` is anonymous and stores a 5-minute challenge row ([`src/app-auth.ts`](../src/app-auth.ts)); only expired rows are removed. `app_auth_challenges` is capped at 50 rows per project and 1,000 platform-wide ([`schema/platform.sql`](../schema/platform.sql)); `AUTH_LIMITER` allows 10 per minute per IP. One client therefore sustains 50 live rows for a project (10/min × 5 min), and twenty clients fill the platform cap. The project id is in the public visitor hostname.

- **Reproduction (executed, local SQLite):** `node tests/boundary-app-challenge-capacity.mjs` calls exactly what the gateway calls for an anonymous login start. After 50 starts, the project's next sign-in start fails with `app_challenge_capacity`; after 50 starts on each of 20 projects, an unrelated project's **first** sign-in start fails. Exits 1. The per-IP limiter is not simulated (the arithmetic above is from the configured binding).
- **Impact:** visitor signup, login and passkey enrollment unavailable for a targeted project or for every tenant while the attack continues; the capacity error is not a `BackendError`, so visitors see a generic 503. No data exposure.
- **Remediation ownership:** visitor identity maintainers with an owner decision: per-client or per-IP challenge caps, not persisting a login challenge until needed (or a stateless signed challenge), a typed 429. A trigger change is a schema change requiring a coordinated cutover. Related open item: "challenge exhaustion" in [security-risk-actions.md](security-risk-actions.md).

### B6 Guest-preview views draw only the platform-wide photo read pool (low; availability, cross-tenant) — resolved October 9, 2026 in source

As found: a guest view inlined the saved version's photos through [`savedVersionHTML`](../src/photo-versions.ts), which called `reserveStorage(…,'read',n)`: the platform-wide monthly pool (100,000). Public site photos instead charge a per-client allowance and a per-project budget with an account fair share first ([`src/storage-budget.ts`](../src/storage-budget.ts): "One project or client exhausting its budget therefore no longer refuses every tenant's photos"). Guest views charge neither, so the fair share never limits them. With 60 views per 10 minutes per link and 20 active links per project, one Creator owner (or anyone holding their links) can drain the pool in hours.

- **Reproduction (executed before the fix, local D1/R2, synthetic photo clearance):** the original `node tests/boundary-guest-preview-read-pool.mjs` (needs `python3` with Pillow, like the other photo suites; this run used a local Pillow virtualenv on `PATH`). Step 1 measured that one view adds one platform read and nothing to the project budget or per-client usage. Step 2 pre-seeded the monthly counter to 99,999 to stand in for prior views; a guest view took the last read and another tenant's first public photo read was then refused (`StorageLimitError`, which the site host serves as 503). Exited 1.
- **Impact (before the fix):** every tenant's public photos, owner photo previews and exports fail until the monthly reset. Extends R3 (owner GETs) to an anonymous bearer path.
- **Resolution (October 9, 2026, source only; not deployed; no schema change):** guest views now pass a read reservation to `savedVersionHTML` that calls `reserveGuestPreviewPhotoReads` ([`src/storage-budget.ts`](../src/storage-budget.ts)) for the link's project, with the WH-075 public-photo semantics once per photo: the per-client photo sub-limit (400 per connection per project per UTC day, the same key as that project's public photos), then in one all-or-none batch the project budget (10,000/month or the operator containment allowance), the account fair share and the platform ceiling. Refusals reuse existing guest-facing text: 429 with the public per-client message, otherwise the unchanged generic 503 "This preview is temporarily unavailable.", identical for project, fair-share and platform refusals. Owner previews and exports keep the platform-pool accounting (R3, out of scope); public site photo behavior is unchanged. Details: [guest-previews.md](guest-previews.md#limits).
- **Regression:** `tests/boundary-guest-preview-read-pool.mjs` is now a regression on SQLite (in-memory R2 stand-in) or `--d1` (local D1 + local R2). It **passed on SQLite**; the `--d1` run could not start at first (the shared `/tmp` user quota was exhausted by other sessions, so the local D1 fixture failed with `SQLITE_IOERR_WRITE`) and **passed on local D1** on October 9, 2026 after rebasing onto `main` with #202 (the D1 fixture honors `TMPDIR`). It asserts: exact owner-preview bytes; one two-photo view charges two reads to the project, platform and client; a client at 399 gets 429 with nothing charged; a project at 9,999 refuses its guests with no project or platform read taken while another tenant's public photo read succeeds; an account over its 10,000 fair share past half the pool is refused while an account under it reads; the platform ceiling stays all-or-none. Reverting the `src/` change makes it fail (exit 1).
- **Owner decisions still open:** whether guest views should keep sharing the per-connection photo sub-limit with the public site or get their own; whether an operator `photo` containment should also refuse guest-preview photos (it now does).

### B7 `create-invite` writes remotely by default (informational; operator guard rail) — characterization

[`tools/create-invite.mjs`](../tools/create-invite.mjs) runs `wrangler d1 execute DB --remote` when called with no flag (`--local` opts out), with no preview, apply flag, operator reference, readback or run record. It is the documented `pnpm invite` path and creates a single-use, expiring invitation, so this is a guard-rail policy question rather than a defect. Every other mutating operator tool except `deploy-platform`/`provision-cms` (R14) requires an explicit apply step.

- **Characterization (executed against a recording Wrangler stub in a temporary directory; nothing remote):** `node tests/boundary-create-invite-default.mjs` (exit 0).
- **Decision needed:** whether to require an explicit `--remote` (as `reconcile-domain-hosting` does) and record the run.

## Unverified risks and hardening notes

Not reproduced; recorded so they are not lost. None is claimed to be exploitable.

- **R1 Per-dispatch identity recheck missing on some HTTP provider routes.** `confirm/refresh/disconnect` hosting, GitHub backup review/confirm, both disconnects and the provider read routes call domain functions without `workspaceTransport`, so their outbound fetch does not re-assert identity immediately before dispatch (the Chat path and DNS/billing/grant routes do). The preceding D1 claim is still admitted, so the window is after an identity-checked state transition. Hardening.
- **R2 Five confirm triggers accept any same-user Chat turn.** Publication, version removal, photo removal, contact and contact-notification confirmations do not require `mode='guided'` with a matching `action_json`, unlike directory, domain proof, specification/service-client and module apply. Today only `chat.ts` routing prevents a plain or model turn from confirming them (tested by `tests/natural-chat.mjs`). Defence in depth would add the SQL check.
- **R3 GET side effects reachable cross-site.** `GET /api/site-versions/:id/export` sets the operator-only `fair_use_project_lifecycle.export_prepared_at` signal; `GET /api/chat` and `/api/chat/turns/:id` initialise/reconcile Chat state; `GET /api/files/:id`, CMS WordPress source download and CMS publication-preview images reserve reads from the platform-wide monthly `storage_usage` budget, so repeated owner GETs (throttled only per IP) could also exhaust it for every tenant. With `SameSite=Lax`, a top-level cross-site navigation can trigger these, but the export needs the victim's version UUID. Low value; recorded.
- **R4 Freshness policy is inconsistent across consequential actions.** DNS record creation, hosting creation, backups (possibly to a public repository), application activation, backend publication, backend-state snapshot restore, CMS publish/unpublish/discard/import/setup and Stripe sandbox checkout/portal accept a non-fresh session, while app restore, module/role apply and grant revocation require one. This matches the current contracts; it is a policy question for the owner, separate from B2.
- **R5 Shared provider state couples tenants.** GitHub grant dispatch and connect block on state shared across tenants (an uncertain revocation or token without refresh custody can block others). Appears deliberate (`docs/connection-key-lifecycle.md`); not exercised.
- **R6 Informational.** The direct HTTP GitHub grant confirm skips the per-owner `AUTH_LIMITER` used by the typed control (fresh passkey still required); the contact-notification review has no revision check, so a later Dashboard address change can be overwritten by an older review; a Chat confirm racing a site-safety unpublish can record "unpublished" for zero changed rows; owner `records.remove` through `POST /modules` needs no review or fresh proof (contract says owner only); invitation creation has no idempotency key; `hostingConnections` lists by `user_id` without the project-owner join (read-only); operator safety-case findings are append-only with no expected-current-finding check, so a reviewer can record a decision without having seen a concurrent one (may be intended).
- **Observation (deferred CMS suite, not run).** `tests/cms-owner-uploads.mjs` asserts the reply text `Send /confirm-cms-import`, which no `src/` file emits any more (`src/cms-wordpress-chat.ts` now points to the confirmation button). The owner-deferred CMS suite is expected to fail on that line when it is next run; this is test drift, not a runtime boundary.

Slice 2 (source and configuration reading; none executed unless stated):

- **R7 Most cited visitor/runtime/scheduled/operator evidence is ungated.** Of the tests cited for slice-2 families, only `tests/customer-site-journey.mjs` (`site`), `tests/customer-app-journey.mjs` (`app`), the release/secret-custody suites and the registry check (`protection`) run in a verify profile; `backend-runtime`, `contacts`, `public-fairness`, `guest-previews`, `app-auth`, `app-data`, `maintenance*`, `contact-notifications`, `operator-containment`, `shared-modules-*` and others are manual. A regression in those boundaries would not fail a deploy check.
- **R8 Contact-notice drain outside maintenance health; stale comments.** The `* * * * *` drain is not a `runMaintenance` job: no `maintenance_health` row is written and a failure escapes `scheduled()` with its raw error (characterized, exit 0: `node tests/boundary-contact-delivery-health.mjs`). A stuck queue is still visible through the outbox backlog in `report-maintenance`. The comments in `src/index.ts` ("No cron trigger for it is configured") and `src/contact-email.ts` ("none is configured in this repository") are stale: `wrangler.jsonc` has the cron, the binding and both variables. Whether delivery is live was not verified.
- **R9 Platform-wide visitor ceilings (same class as B1, owner-driven).** `app_visitors` and `app_invitations` (100 per project, 1,000 platform), `app_sessions` (5,000) and `app_runs` (10,000, removed only on erasure) can be filled by one owner across their own projects. Partly documented in [app-data.md](app-data.md); not executed.
- **R10 Local-mode switches.** `site-host` derives its local alias from the request host name (`localhost`/`127.0.0.1`), which the `*.whumpo.site/*` route cannot deliver; `contactPage` skips Turnstile when `ENVIRONMENT==='local'`, which the release tooling refuses for deployment (`Only the test platform may be released`). Neither was verified live.
- **R11 Public read paths without per-client limits.** Site HTML, directory, CMS articles/listing and the guest link-status endpoint rely on the Cloudflare edge; every 200 HTML GET increments the traffic counter, so a project's traffic figure can be inflated. Contact attempts are counted before Turnstile and not refunded, so a source can exhaust a shared IP's daily contact allowance (documented abuse brake).
- **R12 Custom-domain serving unverified.** Whether Cloudflare for SaaS custom-hostname traffic reaches the `*.whumpo.site/*` route is unverified (hosting is inactive behind `DOMAIN_HOSTING_READY`). The hourly hosting refresh demotes an active domain before re-checking it (fail-closed availability trade-off); `maintainHosting` has no direct test.
- **R13 Runtime fairness is advisory and per isolate.** Any Worker with the binding chooses the lane; the two-slot gate holds per isolate only. The heap-limit and body-cap tests do not discriminate the specific limit that fired.
- **R14 Operator tools acting on invocation.** `deploy-platform.mjs` (the documented hotfix path) and `provision-cms.mjs` deploy without a manifest, journal, reviewed input or `ENVIRONMENT` check (the deployment lease still applies); `stripe-sandbox.mjs` checks `livemode` but not the expected Stripe account; only `prepare-release` and `feature-preview` pin `ENVIRONMENT=test`; journals live under ignored `.secrets/` and no tool writes the run record AGENTS.md asks for. No tool prints a secret or deletes a remote database, bucket, Worker, DNS record or secret. `stripe-sandbox` and `create-invite` have no tests.
- **R15 Read-only operator reports are read-only by convention.** They use the same remote D1 client that can run any SQL; no test asserts SELECT-only use.
- **R16 Visitor host hardening (informational).** If `whumpo.site` is not on the Public Suffix List (not checked), sibling `*.whumpo.site` pages can trigger same-site cookie-bearing GETs to visitor `export`/`data`/`receipts` (responses stay unreadable; nothing is written). Limiter keys use raw IPs, not IPv6 /64 groups. A visitor's self-deletion under a safety hold returns a generic 503 rather than a typed refusal. The export response lacks frame-ancestors headers. The gateway's `pageId` check and the run's page binding are separate statements (minimal impact).

### Evidence gaps (code enforces, no test asserts)

Recorded per cell in the registry. Notable: foreign-owner apply of a specification/service-client review; foreign-caller `GET /api/projects/:id/versions`; every `/api/domain-hosting` HTTP route and foreign refresh/disconnect; expiry of DNS, hosting, backup, domain-proof-removal, app-page, backend-form and module reviews; hosting proof-hash change before confirm; upgrade/rollback stale revision; page-review immutability; route-specific cross-origin tests for guest previews, contact messages, contact notifications and shared modules (the global gate is evidenced once and its position is machine-checked for every route); visitor cookie presented to owner routes.

**Closed in slice 2** by two passing regressions, kept **standalone** (not in a verify profile): during the full `protection` run the visitor-gateway regression failed once in its shared `deletionFixture()` setup (`prepareAppPage` swallowed an insert error and returned `409 Page review unavailable`) and then passed three consecutive reruns in the same allowlisted environment, so it is not added to the deploy gate until that fixture flake is understood. The regressions are `tests/boundary-site-isolation.mjs` (through the sites Worker's default export on local D1: another project's published site and directory/CMS paths are not served by path on a project host; its backend and a pinned backend publication are refused there; custom and unmapped hosts never reach a backend; refused requests never reach the runtime) and `tests/boundary-visitor-gateway-isolation.mjs` (through `applicationGateway`: another project's session under either cookie name gets no data, export, receipt or deletion review; another visitor's receipt is 404; query strings, other methods, cross-site `Sec-Fetch-Site`, the API limiter and a foreign host are refused; a stale `pageId` admits no run).

**Still open (slice 2):** held specification on the photo route; the host-level photo 429 mapping; serve-time digest mismatch for CMS and backend; the custom-domain owner-join refusal; guest comment caps (200 per link, 2,000 per owner); contact page per-IP 429, missing/oversize token, 405, 415 and page-level stale revision; visitor self-deletion under a safety hold; `files.read` naming a foreign file id by authorized staff; route-specific Origin test for `modules/upload`; the site-host → `APP_HOST` forwarding; the app shell's limiter; `maintainHosting`; the runtime's global two-slot refusal; operator CLI wrappers (argument/apply gating) for every tool except `deploy ci` and `configure-github-app` dry-run.

## Verification

Commands run on Node 24.21.0 at `ca17c6a` plus this change (see the WH-004 handoff for exact results). After rebasing onto `main` with #178, the B3 reproduction was re-run and now exits 0:

```sh
node tests/boundary-audit.mjs
node tests/verification-profiles.mjs
corepack pnpm check
node tools/verify.mjs fast
node tools/verify.mjs protection
node tests/boundary-review-capacity.mjs        # B1, expected exit 1
node tests/boundary-review-capacity.mjs --d1   # B1 on local D1, expected exit 1
node tests/boundary-recent-auth.mjs            # B2, characterization (exit 0)
node tests/boundary-guest-preview-race.mjs     # B3, regression (exit 0; fixed by #178)
node tools/roadmap.mjs validate && node tools/roadmap.mjs render --check
git diff --check
```

Slice 2, on Node 24.21.0 at base `21204da` plus this change:

```sh
node tests/boundary-audit.mjs                       # registry, 19 source/config + 13 registry mutations
node tests/boundary-site-isolation.mjs              # regression (standalone)
node tests/boundary-visitor-gateway-isolation.mjs   # regression (standalone; one fixture-setup flake seen)
node tests/boundary-operator-target.mjs             # B4, regression (exit 0)
node tests/boundary-app-challenge-capacity.mjs      # B5, expected exit 1
node tests/boundary-guest-preview-read-pool.mjs     # B6, expected exit 1 before the fix; regression since (python3 with Pillow on PATH)
node tests/boundary-create-invite-default.mjs       # B7, characterization (exit 0)
node tests/boundary-contact-delivery-health.mjs     # R8, characterization (exit 0)
node tests/verification-profiles.mjs
corepack pnpm check
node tools/verify.mjs fast
node tools/verify.mjs protection
node tools/roadmap.mjs validate && node tools/roadmap.mjs alignment && node tools/roadmap.mjs render --check
git diff --check
```

Port onto `main` `4dea09c` (October 9, 2026 UTC; slice 1 was already on `main` as #224): the registry check reported the #186 serving-stop guard's seven path comparisons and one moved anchor (the operator-containment apply check now also refuses a malformed digest). The guard was registered as the `operator-serving-stop` family, the anchor follows the current code, and the summary above was regenerated (52 families). The same slice 2 commands passed again with the same B1, B4, B5 and B6 exits, plus `node tests/operator-containment.mjs`.

Rebuilt onto `main` `89fa009` (October 9, 2026 UTC) as `claude/wh-004-audit-visitor-workers-main-train2`, carrying only this slice; the B4 fix (#239) had been merged into the previous slice 2 branch instead of `main` and is re-stacked separately. Main's changes since `4dea09c` (WH-050 safety-hold classification, the WH-063 contract, the WH-001 summaries and the WH-073 runtime-Worker proof) moved no registered route, control, job, tool or anchor: `node tools/boundary-audit.mjs` and `node tests/boundary-audit.mjs` passed with the registry and summary unchanged, and the slice 2 suites gave the same B1, B4, B5 and B6 exits (1) and passing characterizations. The B4 fix, re-stacked on that branch as `claude/wh-004-b4-operator-target-main-train2`, applied without conflict: `node tests/boundary-operator-target.mjs` exits 0 and the registry check and `node tests/boundary-audit.mjs` pass.

No remote, Cloudflare, provider or deployment operation was performed; fixtures are synthetic and disposable. No operator tool was run against a real account; the create-invite characterization runs the tool against a recording stub in a temporary directory. No `src/` or schema file changed.

B6 remediation, October 9, 2026 UTC, on Node 24.21.0 at base `362bbd8` plus this change (python3 with Pillow on `PATH`):

```sh
node tests/boundary-guest-preview-read-pool.mjs     # B6 regression, SQLite + in-memory R2: passed (exit 0)
                                                     # with the src/ change reverted: failed (exit 1)
node tests/guest-previews.mjs                       # SQLite: 11 groups passed
node tests/boundary-audit.mjs                       # passed
corepack pnpm check
node tools/verify.mjs fast
node tools/roadmap.mjs render --check && node tools/roadmap.mjs validate && node tools/roadmap.mjs alignment
git diff --check
```

**Local-D1 suites:** none could run at first: the shared `/tmp` user quota was exhausted by other sessions throughout (about 50 minutes of retries), so the D1 fixture failed with `SQLITE_IOERR_WRITE` before any assertion. After rebasing onto `main` (with #178) plus #202, which makes the D1 fixture honor `TMPDIR`, they were run on October 9, 2026 UTC on Node 24.21.0 with `TMPDIR` on a home-directory path and python3 with Pillow on `PATH`, and all passed:

```sh
node tests/boundary-guest-preview-read-pool.mjs --d1   # B6 regression, local D1 + local R2: passed (exit 0)
node tests/guest-previews.mjs --d1                     # local D1: 11 groups passed
node tests/guest-preview-photos.mjs                    # local D1/R2, including the project-budget assertion: passed
node tests/public-fairness.mjs                         # passed
node tests/photo-versions.mjs                          # passed
node tests/exports.mjs                                 # passed
```

Rebuilt on October 9, 2026 UTC as `claude/wh-004-b6-guest-photo-budget-train4` (replaces closed PR #240). It is stacked on `claude/wh-004-b4-operator-target-main-train2` (`11ff52c`, the B4 fix over the slice 2 rebuild onto `main` `89fa009`), because B6 is registered only in the slice 2 registry. The two B6 commits applied without conflict. `node tools/boundary-audit.mjs` passed, `node tools/boundary-audit.mjs summary` reproduced the summary above byte for byte, and the registry has 710 anchors. Run on Node 24.21.0 with `TMPDIR` on a home-directory path and python3 with Pillow on `PATH`:

```sh
node tests/boundary-guest-preview-read-pool.mjs        # SQLite + in-memory R2: passed (exit 0); with the four src/ files reverted to 11ff52c: failed (exit 1)
node tests/boundary-guest-preview-read-pool.mjs --d1   # local D1 + local R2: passed (exit 0)
node tests/guest-previews.mjs                          # SQLite: 12 groups passed
node tests/guest-previews.mjs --d1                     # local D1: 12 groups passed
node tests/guest-preview-photos.mjs                    # local D1/R2: passed
node tests/public-fairness.mjs                         # passed
node tests/photo-versions.mjs                          # passed
node tests/exports.mjs                                 # passed
node tests/boundary-audit.mjs                          # passed
```

Rebuilt again on October 10, 2026 UTC as `claude/wh-004-b6-guest-photo-budget-train5` (replaces closed PR #270), directly on `main` `d948f06`, which now contains slice 2 and the B4 fix (#260). Only the three B6 commits were cherry-picked, and they applied without conflict. On this base the B6 reproduction on `main` (exit 1) becomes the passing regression. `node tools/boundary-audit.mjs summary` again reproduced the summary above byte for byte, and the registry still has 710 anchors. Run on Node 24.21.0 with `TMPDIR` on a home-directory path and python3 with Pillow on `PATH`:

```sh
node tests/boundary-guest-preview-read-pool.mjs        # SQLite + in-memory R2: passed (exit 0); with the four src/ files reverted to d948f06: failed (exit 1)
node tests/boundary-guest-preview-read-pool.mjs --d1   # local D1 + local R2: passed (exit 0)
node tests/guest-previews.mjs                          # SQLite: 12 groups passed
node tests/guest-previews.mjs --d1                     # local D1: 12 groups passed
node tests/guest-preview-photos.mjs                    # local D1/R2: passed
node tests/public-fairness.mjs                         # passed
node tests/photo-versions.mjs                          # passed
node tests/exports.mjs                                 # passed
node tests/operator-containment.mjs                    # passed
node tests/boundary-audit.mjs                          # passed
```

## Remaining WH-004 work

- Owner decisions and remediation for B1 and B5, the two open B6 policy questions (remediated in source), the B7 guard-rail question (and R2/R4/R8/R14 policy). B2 was resolved by correcting the runbook, B3 was fixed by #178 and B4 was fixed in the tool.
- Close the remaining evidence gaps above with focused regressions where the owner wants them, and decide whether the ungated evidence suites (R7) should join a verify profile.
- Verify live routing/activation (custom hostnames, contact delivery, `DOMAIN_HOSTING_READY`) with an owner-authorized read-only inspection.
- Run the security scan workflow named in the packet against the current commit and reconcile with this registry.
