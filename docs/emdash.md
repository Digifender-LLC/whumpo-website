# EmDash CMS support

EmDash is an explicit TownHello workload, added at the owner's request on September 29, 2026. This is a native Astro/EmDash application, separate from the static website templates and the pure-function QuickJS runtime. Do not attempt to execute EmDash inside QuickJS or represent a static blog export as a functioning CMS.

## Implementation

`integrations/emdash` contains a pinned EmDash 1.0.1 + Cloudflare adapter 1.0.1 application. The blog theme, seed, live content loader and pages derive from upstream commit `5de3bdc4310f6bcca013f05002f05a61e208b2a4`; the MIT notice is retained in `UPSTREAM-LICENSE`. The template includes posts, pages, archives, search, RSS, rich content rendering and admin entry links. Content stays in EmDash's own schema. Fonts and cream/green theme defaults follow TownHello; font licenses remain in `docs/licenses`.

Run `pnpm install`, then `pnpm build:emdash` from the repository root. Run `pnpm --filter @townhello/emdash dev` for local development. The existing TownHello deploy command intentionally does not deploy/provision CMS tenants. Each deployment needs an owned project and a separately resolved resource map.

The production profile uses dedicated D1, R2 and Astro session KV resources. It has no public route, workers.dev address or public preview URL. This protects the initial administrator setup while the ownership/bootstrap integration is being developed. The profile checker examines the generated Cloudflare configuration as well as the source, since Astro can insert bindings at build time.

## Cost and plugin boundary

No Worker Loader, Dynamic Workers, Container, email or Images binding is configured. Astro's default Images binding is explicitly avoided with passthrough image handling. Native plugin arrays are empty, and a sandbox runner is not selected. Upstream supports the core CMS without a Worker Loader; installing/executing sandboxed plugins requires the paid-only loader and is unavailable under the owner's current restriction. Never substitute `sandbox: false` or run untrusted plugins in-process to bypass that restriction. Keep this distinction visible in the future customer interface.

Core EmDash supplies passkey-based administration and a REST/MCP management surface. These are CMS capabilities, not automatic authorization for TownHello's agent. WordPress support means reviewed content/media migration, not PHP plugin/theme execution or guaranteed lossless conversion.

## Required integration contract

1. Provision a dedicated Worker/database/media bucket/session namespace for each owned CMS project. Record immutable provider IDs against the project and reconcile retries before creating another resource. Never use the TownHello account database for CMS migrations or share one CMS administrator across tenants.
2. Bootstrap the first administrator through the already authenticated TownHello owner. Do not expose the setup wizard publicly while it can be claimed. Keep CMS passkeys and roles separate unless a reviewed SSO bridge establishes equivalent authority.
3. Give the agent narrowly scoped management access, held server-side. Remote MCP descriptions and CMS content are untrusted data; they cannot widen authority. Do not put CMS credentials, private posts or other tenant data in reusable templates or general shared prompts.
4. Chat must support creating a CMS project, reading its state, creating/editing drafts, previewing and preparing publication. Public publication, deletion, plugin installation, imports and schema changes require exact reviews. The model cannot confirm its own proposal. Changes made in the CMS admin must invalidate stale reviews.
5. Import WordPress WXR/content into an isolated draft staging area with a report of unsupported blocks, themes and plugins. Media fetches need SSRF defenses, size/count budgets and a domain policy. Preserve authorship/licensing, sanitize rich content and preview before publishing. No PHP execution.
6. Back up CMS content, schemas, media references and required settings with versioned provenance. Restore into an isolated instance and verify it before switching traffic. A static HTML ZIP is not a CMS backup. Core upgrades need pinned releases, a migration snapshot and a tested restore path.
7. Reuse the existing domain ownership/routing review flow, with an explicit CMS destination. Add per-project storage/CPU/request admission and plan accounting. Verify native passkeys, media, roles, publish/unpublish, draft privacy, backup/restore and concurrent tenants on Cloudflare before advertising customer-ready support.

## Verification so far

Production build and Wrangler dry-run passed. The generated profile contains only ASSETS, DB, MEDIA and SESSION bindings. Local workerd initialized the CMS schema, rendered the blog homepage, returned setup status, redirected admin to setup and served the setup page. These checks do not prove completed owner enrollment, authenticated CRUD, WordPress migration or multi-tenant provisioning. Those remain integration gates, not silently dropped requirements.

## Primary references

- [Cloudflare announcement](https://blog.cloudflare.com/emdash-wordpress/)
- [EmDash source](https://github.com/emdash-cms/emdash)
- [Cloudflare deployment guide](https://docs.emdashcms.com/deployment/cloudflare/)
- [Plugin sandbox constraints](https://docs.emdashcms.com/deployment/plugin-sandbox/)
- [Current Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

## Private Cloudflare verification

Deployed `townhello-emdash-preview` version `4cb91bf8-0752-4195-a63f-df683d15497b`, with a dedicated D1 database, R2 bucket and SESSION namespace. Resource IDs are pinned in the profile configuration after provisioning. Startup reported 33 ms. A temporary remote preview called this deployed instance through a service binding: homepage 200 with rendered blog HTML, setup-status 200 with `needsSetup: true`, admin 302 to setup, font and CSS assets 200. Browser rendering was inspected through this private connection. No owner was enrolled and no public route was created.

First initialization was slow while EmDash applied its core schema. Production tenant provisioning must complete migrations and warm-up before routing customer traffic; this is a remaining acceptance gate. A rebuild invalidated a local dev process's asset map; restarting or using the deployed instance resolved the stale asset responses.

## Owned request bridge — September 29, 2026

The CMS now uses EmDash's supported external authentication interface with a TownHello provider. TownHello's own passkeys remain the intended user authentication boundary. This is not a public CMS login route or proof of native CMS passkey enrollment. A private instance must be configured with `TOWNHELLO_CMS_PROJECT_ID`, `TOWNHELLO_CMS_OWNER_ID`, a unique secret `TOWNHELLO_CMS_BRIDGE_KEY` (at least 43 characters, generated from secure random bytes), and canonical `TOWNHELLO_CMS_ORIGIN`. `EMDASH_SITE_URL` must match that origin. Missing configuration denies access. No production owner or bridge credentials have been assigned yet.

`src/cms-bridge.ts` signs and verifies short-lived HMAC-SHA256 assertions bound to project, owner, origin, method, exact path, request UUID, expiry and request-body digest. Assertions last at most 60 seconds; cookies and bearer headers are rejected. The gateway forwards only the signed assertion, JSON content type and the configured same-origin header. The CMS provider derives a pseudonymous owner identity from the pinned owner ID, rather than trusting a submitted email or role. EmDash provisions that owner through its external-auth interface; role synchronization is disabled. Only one configured owner is accepted per isolated CMS.

The initial allowlist permits setup-status, current-owner and collection-schema reads, plus initial setup with a bounded title/tagline and `includeContent:false`. It blocks native setup-admin, public setup/admin UI, plugin operations and all other routes. Setup writes reserve a receipt in the dedicated CMS database before dispatch. An exact retry returns the saved bounded JSON response; a changed request with the same ID is rejected. Lost reservation or execution acknowledgments never cause a blind repeat. Unknown outcomes require reading setup status before preparing another operation. Responses do not relay session cookies. Setup receipts are capped at 100 per instance; this is an initial setup guard, not a final content-operation retention policy.

`src/cms-gateway.ts` is used by the actual Astro Worker entrypoint. The CMS retains its dedicated D1/R2/KV stores and private-only routing. All of this is service-to-service plumbing: no model has a generic CMS signing or transport tool, no public browser can obtain bridge credentials, and project creation/confirmation still needs to be connected in the platform. Any future operations must be explicitly added with their authorization/review and concurrency contracts; the allowlist must not become an unrestricted REST proxy.

### Verified integration

- `npm run test:cms-bridge`: actual local D1 tests for wrong project/owner/origin/key, tampered body/path, expired/future assertions, cookie denial, rejected operations, replay/conflict, concurrent dispatch-once, lost acknowledgment and unknown outcomes.
- `npm run test:emdash-bridge`: builds the pinned Astro app, creates a disposable local D1/R2/KV environment and a local service-binding proxy on port 8799, runs actual EmDash setup with content disabled, verifies owner role 50 and native collection schemas, confirms setup closure, then removes the temporary environment. Port 8799 must be free. It never uses production data or credentials. `test:emdash-bridge-live` runs only the assertions against an already-running equivalent local fixture; it requires fresh setup state.
- Actual EmDash setup, identity and schema reads passed. These tests verify the CMS bridge, not TownHello customer consent, automatic per-project provisioning, content CRUD, publication, media, import or backup/restore.
- Private Worker version `80586f76-8a62-4e8e-a738-8219f9cff821` deployed. A temporary remote service-binding probe returned 503 `CMS ownership is not configured`, confirming the unassigned preview denies setup access. No test identity/secret was deployed. No public route or additional service was created.

Next: owned per-project resource registration and reviewed provisioning/bootstrap, scoped draft content tools and publication reviews, then media/import/recovery and domain traffic. The earlier public-frontend preview checks describe the pre-bridge profile; the current private profile intentionally requires an authenticated signed request.

## CMS setup requests and project registry

Migration 0036 connects CMS setup intent to owned TownHello projects. Chat supports `/cms` (or `/cms PROJECT_ID`), `/setup-cms PROJECT_ID | title | optional tagline`, `/cms-review REVIEW_ID` and user-only `/confirm-cms REVIEW_ID`. The agent can list, prepare or read a review; it cannot confirm. Its proposal prose is replaced with the server's exact receipt. Confirmation creates a queued registry entry atomically with review approval. Neither preparation nor confirmation currently creates Cloudflare resources or claims the private preview.

A ten-minute review fixes project, owner, title, tagline and the empty/private setup contract. The dedicated Worker/database names are deterministically derived from the project UUID; the media bucket has its own matching name. Provider resource IDs are initially absent and, once recorded by provisioning, cannot be replaced by a different identity. A queued entry cannot be marked ready without recorded database, session-namespace and deployment version IDs. Concurrent reviews for the same project cannot both approve. Retries return the original approval, and capacity errors roll back the approval/registry transaction. Initial admission is two instances per account and five across the platform; these are explicit beta cost guards, not the final plan entitlements. No additional paid services are introduced.

Authenticated HTTP equivalents: `GET /api/cms`, `POST /api/cms/setup-reviews` with `{id,projectId,title,tagline}`, `GET /api/cms/setup-reviews/:id`, and `POST /api/cms/setup-reviews/:id/confirm`. Requests cannot submit provider IDs or credentials. Guided commands do not consume AI units. Chat offers a setup button only after its complete exact review text is saved and while the review is current and unexpired. Approval removes the button. Reading an existing review remains available through the command/API after an interrupted response.

`test:cms-projects` covers real D1 tenant ownership, immutable reviews, simultaneous confirmations, expiry, replay, deterministic resource identities, initial-state truthfulness, atomic capacity, guided controls and metered AI proposal receipts. `test:cms-projects-http` verifies authenticated same-origin prepare/confirm endpoints against a local Worker. The provisioning consumer/operator tool, credential installation, service binding registration and native CMS bootstrap verification still need to connect the queued registry to the signed bridge. Until then, the UI explicitly reports queued, never ready or public.

## Provisioning consumer: storage allocation

`npm run cms:provision -- --list` reads approved unfinished requests from the production control database using the already authenticated Wrangler account. `npm run cms:provision -- PROJECT_ID` allocates and records that approved project's dedicated D1 database, R2 media bucket and KV session namespace. It is an operator command, not an AI tool. Credentials are read into memory through `wrangler auth token --json`; they are not written into registry rows or printed. The fixed account/control-database IDs come from `wrangler.jsonc`.

Migration 0037 adds an immutable creation-intent/receipt ledger. Before reserving a new resource, the consumer checks the paginated provider inventory for collisions. A pre-existing name without a recorded creation intent is not adopted. Only the process that successfully records a fresh intent may dispatch creation. A competing process, lost reservation acknowledgment or later retry only reconciles provider state. Recorded provider IDs are immutable and unique within the account/resource kind; missing/replaced resources and account mismatches stop allocation. Provider errors never trigger plan upgrades, public access or an automatic repeat of an uncertain creation request. An unresolved attempt remains uncertain for reconciliation/operator investigation; the command does not offer a blind reset/retry switch.

The consumer uses Cloudflare's documented [D1 creation](https://developers.cloudflare.com/api/resources/d1/subresources/database/methods/create/), [KV namespace creation](https://developers.cloudflare.com/api/resources/kv/subresources/namespaces/methods/create/) and [R2 bucket creation](https://developers.cloudflare.com/api/resources/r2/subresources/buckets/methods/create/) APIs, with bounded paginated inventory reads. Remote control-database statements bind parameters. No database, bucket or namespace is shared across project records.

Three storage receipts still mean `provisioning`, not `ready`. Worker deployment, per-instance secret installation, platform service binding, signed setup and owner/schema verification remain required before readiness. `/cms` reports the number of recorded storage resources and explicitly identifies unverified deployment/initialization or uncertain provisioning. This operator consumer is not yet a continuously running scheduler.

`test:cms-provision` uses actual local D1 plus a controlled provider to exercise approved-only admission, competing allocators, lost provider and reservation acknowledgments, delayed result reconciliation, collision rejection, changed resource IDs, account pinning and pagination. A production read-only run returned no queued requests. Live inventory reads located the existing private preview database and media bucket. No customer resource was allocated during that check; live creation of a confirmed customer's full instance remains an acceptance gate.
