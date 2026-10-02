# Local verification profiles

WH-003 implementation, September 30, 2026; source and evidence reconciled October 1, 2026 UTC. These profiles group existing checks by customer boundary. They are local fixture acceptance, not production, provider, browser or physical-device acceptance. [WH-003](https://github.com/zemdregon/whumpo/issues/4) owns execution and completion evidence.

## Setup

Use Node **24.21.0** (`.node-version`) and pnpm **11.19.0** (`packageManager` in `package.json`). Install dependencies with `pnpm install --frozen-lockfile`. Profiles require installed dependencies and Linux-compatible local workerd/Miniflare for journeys; no running development server is needed.

Run `pnpm check` separately for backend/frontend types. Run `pnpm verify` for the default `fast` profile, or choose explicitly:

| Command | Covered boundary | Resources and limits | Does not prove |
| --- | --- | --- | --- |
| `pnpm verify fast` | OpenAI-compatible Chat/Responses transport, Go session validation, saved-data role boundaries through actual Chat orchestration, acknowledgment timing including 700/730 → 1700 ms | In-memory bundles, SQLite with the complete current schema, and simulated timers; three scripts, five-minute ceiling each (15 minutes maximum script time) | Live model availability/quality, UI appearance, billing or full prompt-injection resistance |
| `pnpm verify site` | Onboarding gate, synthetic AI private draft/edit, exact publication reviews, owner/origin isolation, replay, restore/unpublish, zero standard-AI units | Unique temporary D1/R2 state; complete current schema; local Wrangler proxy with dynamically selected ports; one script, five-minute ceiling | Real customer publication, Cloudflare configuration, real inference, native passkeys, media moderation |
| `pnpm verify app` | Welcome, actual bounded QuickJS, separate program/page approvals, visitor passkey fixtures/data isolation, replay/recovery/export/deletion and task-list workflow | Unique temporary D1/R2 and runtime bundle; local Miniflare with dynamically selected ports; one script, five-minute ceiling | Physical-device authentication, remote runtime bindings, arbitrary customer source safety or deployment |

Runtime ceilings are safeguards, not performance promises. Journeys require more CPU/memory and disk than `fast`; exact requirements depend on workerd and the host. Run profiles sequentially on a constrained machine. They do not share a persistent database or fixed server port. The suites dispose their local services and fixture storage after their test bodies. Setup failure before cleanup is installed, a disposal failure or forced process termination can leave temporary files/processes requiring inspection; the runner is not a container supervisor. The runner's empty home directory has its own cleanup check.

## Credentials and live operations

The runner allows only basic OS executable/temp paths into child environments, uses a unique empty home/config directory, disables Wrangler metrics and dotenv loading, and excludes inherited provider tokens, proxies, `NODE_OPTIONS` and live-test flags. It refuses a checkout containing `.env`, `.env.*`, `.dev.vars` or `.dev.vars.*`, because Wrangler can load those independently of environment variables. Use a separate credential-free checkout in that case; do not remove operator secrets to make a test pass.

The site suite always intercepts model requests with synthetic Responses; the obsolete `SITE_AI` flag is neither required nor forwarded. The prompt-boundary fixture injects its transport and refuses other fetches. None of the selected suites reads the ignored root key files. The app runtime build uses Wrangler **dry-run**, and both journeys use local-only platform proxies with remote bindings disabled. This is an audited allowlist of repository tests, not an OS filesystem/network sandbox; re-review any added script or setup change before including it. No CMS functional tests, paid providers, customer DNS or deployed customer code are part of these profiles.

Live Muse, remote provider, browser and real-device acceptance remain explicit separate operations with their own prerequisites. Do not add them to a default profile or interpret these passes as their acceptance.

## Failure handling and CI

An unknown profile, extra arguments, wrong Node major, local secret configuration, failed script, signal or timeout produces a nonzero exit. Scripts stop at the first failure. `node tests/verification-profiles.mjs` verifies the runner's environment allowlist, unique homes, cleanup, local-secret refusal and failure propagation without calling providers.

### Optional CI decision — October 1, 2026 UTC

Retain local-only verification for this increment. The repository was confirmed private. The read-only billing-usage request returned HTTP 404 with a missing `user` scope message; account plan, remaining included allowance and blocking billing controls remain unverified. No authentication scope or account setting was changed. This is a completed evaluation of optional CI, not acceptance of a hosted workflow or a claim that the owner permanently declined CI.

GitHub documents included quotas for private repositories and paid usage beyond them; [Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) and [budget controls](https://docs.github.com/en/billing/how-tos/set-up-budgets) were checked on October 1, 2026 UTC. A public pricing table does not establish this account's remaining allowance or spending controls.

No workflow was added or dispatched, so workflow syntax and hosted execution are not accepted. A future minimal workflow would use one standard Ubuntu job, read-only repository permissions, Node/pnpm pins above, a frozen install, runner checks and the chosen local profiles. Require cancellation of superseded runs, a 30-minute job ceiling (including installation), no uploaded artifacts or persistent cache initially, and no provider credentials, deployments or live tests. Before activation, verify current account allowance and enforceable no-overage controls, then review the exact workflow. These bounds limit one run, not total monthly consumption. The local profiles remain the default without GitHub consumption.

## Verification evidence — September 30, 2026

`node tests/verification-profiles.mjs`, all three profiles (`fast`, `site`, `app`), `pnpm check` and `git diff --check` passed in the repository checkout on Node 24.21.0. Each connected journey created its own disposable local state with all current migrations. The site journey observed two synthetic main-model calls and two acknowledgments, with zero customer units charged. The app journey passed actual QuickJS execution plus signed fixture passkeys, task-list transitions, owner erasure and visitor data isolation. No provider credentials, CMS functional acceptance, remote deployment or physical-device test was used. This is source/tooling acceptance; no Worker deployment is needed for this change.

## Reconciliation — October 1, 2026 UTC

Rechecked against main `edfb974` and this test/tooling correction, through migrations 0001–0113, using Node 24.21.0 and pnpm 11.19.0. The initial `fast` run failed: the old prompt-boundary test passed an oversized catalog directly to the transport, bypassing Chat's existing message chunking. The correction exercises `sendAIChat` with disposable in-memory SQLite and injected replies for both protocols and the website/full catalogs. It checks that all system text is preserved, each message meets the existing size bound, saved customer instructions stay in user messages, and the turn actually completes. Application-design source remains covered as user-role data in both adapters. No runtime code or limit changed.

The runner environment/failure tests and corrected `fast`, `site` and `app` profiles passed. The site journey now uses natural messages and typed approvals: seven synthetic main-model calls and seven acknowledgments, zero customer units, no unresolved inference reservations. The application journey passed actual QuickJS execution, signed fixture passkeys, task-list transitions, owner erasure and visitor isolation. Each journey used its own temporary D1/R2 state with dynamically selected local ports. `pnpm check` passed; its generated-schema consistency check is not CMS functional testing. Roadmap validation, rendering consistency and `git diff --check` passed.

This update changes tests, the local runner and documentation only; no Worker release or migration is needed. CSAM scanner implementation, CMS functional testing and Stripe activation remain owner-deferred. Hosted CI, live providers, production customer acceptance and physical-device authentication remain outside this evidence.

## Current identity fixture conversion — October 2, 2026 UTC

The `fast`, `site` and `app` profiles pass against the complete target schema assembled by `tools/current-schema.mjs`. Connected workspace calls now use the current identity cookie and module-private admitted database scope. Synthetic ready-account records are fixture setup; they do not establish passkey ceremony or physical-device acceptance. The separate identity HTTP/browser suites own those claims. No retired auth table or numbered SQL replay is used by these three profiles.

Additional local passes: natural-language Chat, profile, welcome on actual local D1, website service settings and service activation on actual local D1/QuickJS, comparison HTTP, account inventory, and verification-runner isolation. Response-loss injection happens after the matching transaction commits; it cannot accidentally interrupt a concurrent unrelated query. Stale-proof cases issue a separate aged session instead of editing an existing proof timestamp. Service approval tests keep prepared statements and commit in the same admitted owner scope.

Actual mobile Chromium checks pass for workspace shortcuts, billing reads, draft plan preferences with reload, and current/expired/missing/signed-out comparison documents. The comparison fixture permits only GET and the two read-only identity POST endpoints, and verifies unchanged reviews, versions and publications. A current identity refusal now retains the comparison's HTML error page; JSON callers retain the structured identity code.

The obsolete owner-recovery browser tool has been removed; use `tests/identity-browser.mjs` and `tests/workspace-identity-browser.mjs` for the current flow. Service-settings/activation and owner-journey browser harnesses now use current identity setup; their full interactive journeys were not rerun in this conversion. Other older domain fixtures still require conversion. This is not a claim that the entire repository suite passes. CMS functional testing, CSAM and Daybreak remain deferred. No remote schema reset or Worker release occurred.

### Billing, provider and inference follow-through

The following additional checks use the complete current schema. Owner-facing domain calls use current admitted scopes from the same bundle as their handlers. Fixture setup, signed Stripe webhook processing, operator reports and scheduled credential cleanup intentionally retain their separate database authority. No old password/session rows or numbered SQL replay are involved in these checks.

| Command | Verified local scope |
| --- | --- |
| `node tests/billing.mjs` | SQLite: immutable current plans, exact paid coverage, zero standard-AI customer debits, retired-table/route refusal and missing-receipt refusal |
| `node tests/plan-periods.mjs` | D1: paid intervals, highest current tier, expiry, non-authorizing draft preferences, publication slots and domain quote policy |
| `node tests/subscriptions.mjs` | D1 and synthetic Stripe: checkout concurrency/replay, signed events, exact paid invoices, failed renewal, annual boundaries, cancellation, unknown write holds, deletion and HTTP gates |
| `node tests/github-connection.mjs`, `node tests/github-token-lifecycle.mjs`, `node tests/cloudflare-connection.mjs` | D1 and synthetic providers: actual distinct-session binding, PKCE, cancellation/replacement/revocation, staged credential custody, late reads, expiry and lost activation replies; GitHub lifecycle has 13 explicit cases |
| `node tests/github-backups.mjs`, `node tests/backup-chat.mjs` | D1/R2 and synthetic GitHub: independent Git tree equality, reviewed destination/source/visibility, concurrent confirmation, no repeated uncertain write, exact readback, safe Chat controls, lost claim/transcript and secret exclusion from synthetic model context |
| `node tests/cloudflare-dns.mjs`, `node tests/cloudflare-routing.mjs` | D1 and synthetic Cloudflare/DNS: exact TXT/CNAME reviews, conflict preservation, owner/configuration gates, proof/connection/credential races, single dispatch, uncertain readback and review-only model authority |
| `node tests/standard-ai-usage.mjs`, `node tests/standard-ai-chat.mjs`, `node tests/standard-ai-recovery.mjs`, `node tests/standard-ai-history.mjs`, `node tests/model-costs.mjs` | D1 and synthetic inference: atomic admission, no customer ledger, immutable receipts, failed-work cost retention, uncertain holds, saved-answer recovery, no resend, metadata-only history, separate acknowledgment accounting and privacy-limited operator reports |
| `node tests/identity-ceremonies.mjs --d1` | Current isolated identity schema, initialized directly: 62 refusal/race checks and actual cryptographic journeys |
| `pnpm test:smoke` | Signed current identity HTTP followed by actual Worker workspace calls on disposable D1: health, first-project gate, two-owner isolation, Origin, concurrent project quota, activity atomicity, cookie expiry, session revocation and retired-route refusal |

The smoke suite no longer requires a running password-based dev server. Its signed HTTP step proves cryptographic ceremony behavior; synthetic ready owners isolate the subsequent workspace checks. Logout verification checks the current `Expires` cookie contract and independently proves the revoked session cannot read or create projects.

Private Chat handler dispatch strings in these domain fixtures are internal test inputs. The public natural-language boundary remains covered by `tests/natural-chat.mjs`; no customer slash-command interface is restored. Fault injection now targets the specific SQL operation before admission or after its actual commit, rather than counting batches that identity checks can change.

These passes do not establish live Stripe/provider acceptance, a Stripe API-version upgrade, owner/device acceptance or a remote cutover. The source adapter's explicit Stripe version remains unchanged. Older domain/operator fixtures still need conversion before the coordinated test deployment; the current release must never target the obsolete database. No customer publication, real provider mutation, paid service or remote reset occurred.

### Domains, website changes and workspace follow-through

Fourteen additional suites pass on disposable local D1 with the complete current schema. Owner handlers use the admitted current identity scope from the same bundled module; visitor serving, scheduled maintenance and operator recovery retain their separate authority. Website fixtures use actual current specification transactions. None of these suites replays numbered migrations or creates retired workspace sessions.

| Command | Verified local scope |
| --- | --- |
| `node tests/domains.mjs`, `node tests/domain-agent.mjs` | Exact bounded TXT proofs, owner isolation, expiry/renewal, replay, quotas, model proof-token exclusion, rejected purchase/connect authority, lost-result readback and zero standard-AI customer charges |
| `node tests/domain-proof-removal.mjs` | Typed owner confirmation, raw/model refusal, exact proof generation, hosting/DNS reference races, atomic rollback, concurrency/replay and replacement-proof protection |
| `node tests/domain-hosting.mjs`, `node tests/domain-recovery.mjs` | Synthetic provider create/certificate/routing checks, publication boundaries, one concurrent create, uncertain-write holds, disconnect/cleanup races, exact operator evidence, immutable recovery audit and stale refresh/proof fencing |
| `node tests/dns-agent.mjs`, `node tests/hosting-chat.mjs` | Review-only model authority, owner-approved provider operations, foreign/stale/replayed turns, lost claim/transcript replies, no uncertain resend and credential exclusion |
| `node tests/specification-journey.mjs` | Actual Worker HTTP create/change/preview/export/publish to the local visitor host, exact recent-auth approval, concurrent approval, expiry/deletion/safety holds, immutable versions, lost approval reply, forward restoration and removal/tombstones |
| `node tests/project-details.mjs` | HTTP/Origin/owner checks, validation, revision conflicts, no-op audit behavior, model receipts and concurrent onboarding edits |
| `node tests/workspace-dashboard.mjs`, `node tests/workspace-read.mjs` | Closed layout/shortcut schema, injection refusal, revisioned owner edits, non-authorizing plan preferences, honest unavailable measurements, read-only server-derived inspection, complete bounded project index and replay without inference resend |
| `node tests/site-health.mjs`, `node tests/site-traffic.mjs` | Fixed-origin bounded health checks, generation fences, photo availability, scheduled budgets, exact concurrent visitor HTML counters, request exclusions, owner isolation, retention, deletion and counter-failure isolation |
| `node tests/chat-history.mjs` | Authenticated pagination/search/export, stable revision boundaries, literal search, owner/first-project gates, strict field projection, private download headers, no inference and explicit interrupted-stream failure |

Synthetic Cloudflare, DNS and model transports do not establish provider activation or real inference acceptance. The specification journey publishes only to its isolated local visitor handler. A photo availability fixture contains no scanner implementation or provider call; layout schema validation of a CMS widget identifier is not CMS functional testing. Fault injection matches the actual committed SQL operation, and aged-proof cases issue a distinct session. Physical-device acceptance and the coordinated remote reset/deployment remain open under #72.
