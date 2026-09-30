# Current MVP readiness — September 29, 2026

Latest connected CMS browser acceptance (September 30): `CMS_BROWSER=1 pnpm test:cms-native-publication` passed the actual publishing-desk image picker → Chat review → explicit confirmation → native private preview journey using disposable local state. Reopening retained the pending review; reload retained the completed receipt. Final assertions verified exact reviewed content, image/excerpt, taxonomy version 2, one draft and no publication. This closes the local full-browser import gate; physical devices and the first reviewed live customer migration remain open. See [CMS browser evidence](emdash.md#full-browser-to-native-import-acceptance--september-30-2026).


**MVP remains incomplete.** This section reconciles current source and live configuration; subsequent sections are historical acceptance records. Old domains, frontend paths, plan names and Worker versions in those records are provenance, not instructions or current configuration. No individual unit test or deployed helper establishes completion of the full platform.

Source reviewed through `3d44a21`: root Worker configs, deployment/build scripts, React entry point, pricing catalogue, chat/navigation, provider-connection gates and the feature contracts linked below. Fresh read-only deployment inspection found platform version `02416110-7913-44a6-a19e-fdbca3a0ed96`, migrations through `0067_fair_use_lifecycle.sql`, persisted Monitor mode, and **zero registered native CMS instances**. Required binding sets for customer GitHub authorization, customer Cloudflare OAuth, custom-domain hosting and Stripe were absent. These are distinct from the operator's authenticated GitHub/Wrangler tools; operator credentials do not configure customer consent flows.

Latest incremental acceptance: platform `29d865c5-3447-4819-9ffe-c6ab1e596046`, site host `5797ee48-d71b-4311-974b-726fde56c1f1`, and migrations through `0071_cms_wordpress_sources.sql` are live in test. CMS image editing/publication and bounded WordPress retained-source upload, analysis, review and private import are deployed. Connected local HTTP/Chat-to-native acceptance passed lost-response recovery and exact private draft creation. Remote readback confirms zero registered CMS instances, zero import sources/reviews and Monitor mode; anonymous private import endpoints return 401. Physical mobile and first live customer CMS acceptance remain open. See [connected CMS evidence](emdash.md).

Latest welcome release (September 30): platform `f1476f42-f652-46a2-8451-bbac05c7192b`, migrations through 0074 plus 0077/0078; inactive Gateway migrations 0075/0076 remain unapplied. The welcome asks one question at a time, saves the current question, and retains default/uploaded profile pictures and a complete project review. Local connected browser recovery resumed the saved question; completion created exactly one project and issued no early Chat/dashboard reads. Chat now offers a scoped first-draft action using that brief. Disposable D1 concurrency/replay checks and a real Muse first-draft probe passed; no live customer publication was performed. All 18 live assets and anonymous access denial passed, with the existing pricing panel preserved. The versioned private backend helper library from migration 0072 is also deployed; its D1/QuickJS acceptance remains local. See [welcome evidence](onboarding.md).

Latest mapped-import release (September 30): platform `582ecff8-5a89-4fe0-8095-f128bc03807a` and control migration 0079 are live. Owner reviews now bind source categories/tags, with resumable native creation/assignment and atomic control-side draft visibility. A connected local coordinator suite against actual EmDash verified four exact posts from four successful reviews, conflict refusal, concurrent retries, lost responses and completion rollback. Live checks verified six database guards, all 18 frontend assets and authentication requirements. Native CMS inventory remains zero; this does not constitute live customer CMS acceptance. See [mapped import contract](emdash.md#reviewed-resumable-categorytag-imports--september-30-2026).

Latest account-connection setup: the private Cloudflare OAuth client and encrypted-vault key are configured. Live temporary-account checks verified the PKCE handoff and cancellation, then removed the fixture. Real Cloudflare consent, zones and revocation remain unverified; GitHub and Stripe setup remain absent. See [private client evidence](integrations/cloudflare-connection.md#private-client-configured--september-29-2026).

Latest application journey acceptance (September 30): `pnpm test:customer-app-journey` now runs without prebuilt account fixtures or fixed ports. Disposable D1, the actual isolated QuickJS/Wasm Worker, platform/visitor HTTP handlers and signed synthetic passkeys verified welcome → tested backend → separate authority/page approvals → two isolated visitors → exact transition replay → identity recovery/export/deletion → withdrawal. It recorded exactly two runtime calls (one owner test and one visitor transition), with no model call or live customer mutation. Physical-device/browser acceptance, general workload coverage and whole-app recovery remain open. See [repeatable application journey](app-data.md#repeatable-customer-application-journey--september-30-2026).

Latest app-maintenance release (September 30): platform `5a273511-43ce-45af-8b65-51698d67031e` and migrations through 0089 are live, with 0075/0076 still inactive. Chat supports private offline upgrade checks, explicit program/data replacement and cross-version rollback, cancellation, temporary staging cleanup and authoritative confirmation cards. Actual isolated QuickJS/disposable D1 tests cover code/data transaction rollback, replay, visitor isolation and cleanup; mobile-width keyboard tests cover confirmation and dismissal. Live checks verified schema, release identity, anonymous access denial and all 16 frontend assets. No live customer app was transformed. This is retained per-visitor documents plus saved program versions, not whole-infrastructure recovery. Project-first onboarding also has a deployed server-side Chat/workspace gate. See [app maintenance evidence](app-data.md) and [welcome evidence](onboarding.md).

Latest connected website journey (September 30): `SITE_AI=1 pnpm test:customer-site-journey` now exercises the actual authenticated platform HTTP handlers, configured Muse-only Responses transport/parser, ledger and public site host against disposable D1 and synthetic provider replies. It covers project-first welcome, a first private draft, source export/preview, one AI edit, publication review/confirmation, discarded-response replay, stale review refusal, byte-exact restore and unpublish. Two main-model calls and two background acknowledgment calls were observed; six test units settled and all inference holds resolved. Unshared profile text was excluded. The default guided journey passed separately with zero inference. This is connected local acceptance, not real provider quality, live customer publication, native passkey enrollment or physical-device acceptance. See [repeatable website journey](mvp.md#connected-ai-website-journey--september-30-2026).

Latest fair-use review foundation (September 30): migration 0091 and the account-scoped internal service record immutable review context and a single final decision with exact replay. Disposable D1 concurrency, ownership, SQL immutability and deletion checks passed, as did both TypeScript checks. This is local-only and has no notice, appeal, enforcement or operator-UI mount. Monitor remains unchanged. See [review records and remaining gates](fair-use-reviews.md).

## Requirement map and proof still needed

| Requirement | Current evidence and scope | Remaining proof/work |
| --- | --- | --- |
| Brand, domains and modern frontend | `wrangler*.jsonc`, `frontend/`, build script and [migration record](whumpo-migration.md): Whumpo platform, customer-site and controlled-app boundaries; React/Vite/TypeScript/Tailwind/Radix/shadcn/TanStack. | Keep full generated-site and owner-workspace journeys in the final release acceptance. Historical internal service IDs are intentionally retained. |
| Invite-only, passkey-first entry | Passkey/auth source, signed fixture tests and [migration acceptance](whumpo-migration.md); guided onboarding and recovery implemented. | Human Turnstile completion and native synced-passkey enrollment/recovery on actual desktop/mobile devices remain unverified. |
| Project-first welcome and Chat workspace | Conversational profile/picture/brief questions with saved checkpoints gate workspace rendering and data reads until a private first project exists; local D1/HTTP/browser recovery and Chat handoff checks passed. Standalone default Chat, dashboard/workflow tabs and Profile/Settings separation remain; [welcome contract](onboarding.md) and [workspace contract](workspace-agent.md). | Full first-use journey on real devices, and broader coverage of unfinished service workflows. A navigation-only fixture does not establish provider consent or service operation. |
| OpenAI-compatible inference and owner testing | Chat Completions/Responses adapter; recorded real Muse creation/edit and CMS continuation probes; `wrangler.jsonc` remains pinned to Muse Contributor. | AI Gateway dispatch, verified production model/rate catalogue, comparative quality/cost benchmarks and premium dispatch. Offline selection/reservation code is not active API routing. See [model policy](pricing-and-model-policy.md). |
| Build, edit, preview, publish and restore | Reviewed static/photo sites and bounded backend/application workflows; recorded HTTP/QuickJS/model checks in [delivery milestones](mvp.md) and [app contract](app-data.md). | General application/build coverage and broader end-to-end acceptance. Do not advertise unrestricted VPS/server execution or assume every requested app fits the controlled runtime. |
| Plans, payments and overage | Current $17/$30/$79/$139 catalogue; atomic test ledgers and opt-in test credits; [payments](payments.md). Stripe binding set absent in fresh inspection. | Subscription lifecycle, authoritative finance and real payment acceptance. Payment setup is intentionally deferred by the owner; do not create an account or activate charges as a workaround. |
| Unlimited fair-use standard AI and premium funding | Monitor default is live; owner-scoped observations and private operator report exist. Premium spending reservations are separate. [Fair-use policy](pricing-and-model-policy.md#unlimited-standard-ai-under-fair-use--september-29-2026-decision). | Verified financial attribution, trusted review/notice/appeal/expiry workflow and optional enforcement; production premium tariffs, funding and dispatch. Unknown profit must remain unknown. Explore test quotas do not establish the paid launch promise. |
| Existing domain and automatic HTTPS | Ownership proofs, reviewed hosting/DNS code and [custom-hostname contract](integrations/domain-hosting.md). Required activation bindings absent. | Scoped operator configuration, included-resource/cost verification, fallback routing and real DNS/TLS/serving/disconnect acceptance. No customer DNS change is authorized solely by this checklist. |
| Domain purchase and annual benefit | Launch benefit policy documented; purchase is disabled. [Domain contract](domains.md). | Registrar integration, authoritative availability/price/renewal terms, reviewed funding/consent, uncertain-result reconciliation and benefit redemption. No purchase is currently authorized. |
| Optional own GitHub | Consent/vault/revocation and reviewed expected-head source backup implementation. [GitHub setup](integrations/github-app-setup.md). Required customer App bindings absent. | Configure the customer GitHub App, perform actual consent/disconnect and a reviewed customer-repository backup acceptance run. Operator `gh` authentication is insufficient. |
| Optional own Cloudflare | Scoped OAuth/vault/revocation and reviewed TXT/CNAME implementation. [Cloudflare contract](integrations/cloudflare-connection.md). Private client and vault key configured; live PKCE handoff/cancellation verified. | Real customer consent and reviewed DNS operation/reconciliation acceptance. Operator `cloudflare.key` is not a customer OAuth credential. |
| EmDash support and unified CMS controls | Private content/structured edits, reviewed publication, recovery tooling, metadata inventory and private image preview have local/native or recorded model checks. [CMS contract](emdash.md). | First reviewed live native instance acceptance and complete WordPress import. Image upload/insertion/publication has connected local-native acceptance and deployed platform support; WordPress retained-source analysis, APIs, Chat review/confirmation and workspace upload controls are deployed. Connected local HTTP/native recovery passed; physical mobile and first live customer CMS acceptance remain open. Zero live registered instances means these paths are not customer-provisioned merely because the platform UI is deployed. |
| Safe reusable backend components | Shared platform-authored components and bounded private backend runtime; versioned pure-helper catalog and private copies now have local D1/QuickJS checks ([shared library](shared-components.md)); [reuse inventory](jarvis-reuse.md) and [application contract](app-data.md). | Reviewed customer-code promotion, sensitive-data screening, versioning/withdrawal and general reuse workflow. No cross-customer source harvesting is enabled. |
| Tenant isolation, replay and recovery | Resource-specific D1/HTTP/runtime tests and immutable review/version/usage contracts exist. [Application data](app-data.md), [CMS recovery](emdash.md) and deployment records describe their boundaries. | Consolidated final audit across current privileged paths, restore/deletion reconciliation and real-device/provider journeys. Historical green tests are not exhaustive security or disaster-recovery acceptance. |
| Current technical/operations documentation | README and this readiness map now describe current source, domains, pricing and activation gaps. Feature docs carry detailed contracts. | The [Word technical design v0.6](whumpo_mvp_design.docx) now reconciles current architecture, onboarding, commercial policy and setup gates. Final operations/recovery drills and acceptance reconciliation remain required before MVP completion. |

## Delivery priorities

1. Complete a customer-facing CMS media/import workflow and its native acceptance, preserving private storage and reviewed publication. First live tenant provisioning still needs its concrete capability/resource review.
2. Complete customer provider setup and real consent/backup/custom-hostname acceptance when the necessary application credentials and reviewed customer resources are available. Continue independent implementation without substituting operator credentials.
3. Connect verified economic accounting and AI Gateway dispatch before inviting API-funded beta users; keep owner testing on Muse and fair use in Monitor. Preserve the owner's decision to defer Stripe.
4. Run the full first-use/device and recovery journeys, consolidate the technical design/runbooks, and repeat this requirement map against the then-current deployment before claiming MVP completion.

This order does not remove other requirements or mark unavailable purchases/integrations complete. Documentation reconciliation made no runtime, entitlement, DNS, provider-access or payment changes. The fresh live check read only configuration names, version, migration, mode and aggregate instance count; no credentials or customer content were printed.

---

# Historical acceptance records

# Controlled visitor applications — September 29, 2026

Current domain/frontend configuration: see [Whumpo migration](whumpo-migration.md). Older entries below are historical release evidence and do not describe the current hostname.

Release `21227d1` is active on `tellumo-apps` (`9511d3eb-a750-45cf-b9d1-c7ddaf151843`) and `tellumo-platform` (`d9f619ab-6f88-4856-b9c0-93eaaeba57e4`). Migration 0057 is applied remotely. The controlled host uses `apps.digifender.com`; no customer page is published automatically. A remote read confirmed zero rows in `app_live_pages` after deployment.

Implemented owner-reviewed page publication/withdrawal, a fixed passkey-first visitor UI, exact form/page checks, scoped private data/receipt routes, session revocation on page changes and public-session admission pinned to the page review. Public recovery now has the visitor save a derived replacement code before committing; exact retries and recovery after acknowledgment loss were verified.

Passed `test:app-auth`, `test:app-data`, `test:app-pages-http` (real local workerd + QuickJS), type checking, build, deployment dry run and diff checks. Signed ES256 fixtures cover enrollment, two visitors, private data/receipts, exact retry, page/field rejection, login/logout, recovery and replacement passkeys. Unit/database checks cover competing publication reviews, unauthorized/AI confirmation rejection, page withdrawal between signature verification and session commit, rollback of that enrollment, and withdrawal during an in-flight state transition.

Browser acceptance used a synthetic authenticated local fixture: sign-in presentation, saving/reading a note through real QuickJS, concurrent-edit rejection, receipt-based refresh/resubmission and 390px width without overflow. Saved preview: `.secrets/verification/visitor-app.png`. This does not prove physical-device passkey enrollment; that remains an explicit acceptance item. Export/deletion/retention, full application backup and richer interfaces remain MVP work.

Live host checks confirmed exact visitor JS/CSS and restrictive CSP/private-no-store headers; raw index, owner-account routes, unpublished pages and their data endpoints return 404. The deployed platform JS matches source. Owner page-review reads require authentication and cross-origin confirmation/visitor authentication requests are rejected.

The platform uploaded successfully, but Wrangler rotated its ambient OAuth token during deployment and the wrapper's final verification/lease release received 403. A fresh authenticated read independently verified both active versions. The wrapper now reloads a changed ambient OAuth token and retries a confirmed 403 once; explicit credentials, unchanged tokens and uncertain failures never retry. Dedicated tests verify those boundaries. The old lease was left untouched to expire at `2026-09-29T19:54:53.491Z`; its process exited and must not be treated as ongoing deployment work. No second upload was performed.

# Owner visitor access controls — September 29, 2026

Release `147da57` deployed to `tellumo-platform`, version `e2bda454-676e-447c-af86-f223fefbcb61`. Migration 0056 is now applied remotely. Owner access metadata, invitation creation/cancellation and visitor revocation are available from Dashboard → Visitor access and the `/visitor-access` chat shortcut. The visitor gateway remains unmounted; no public visitor enrollment/data endpoint was enabled.

Passed `test:app-auth`, `test:site-agent`, type checking, build and diff checks. The auth suite includes platform HTTP handler tests with real local D1: anonymous/foreign-owner denial, fresh-session requirement, CSRF, metadata fields, cancellation after enrollment challenge issuance, revocation while disabled, and credential-free guided chat. Browser inspection on synthetic local fixtures verified separate full-width navigation, Chat shortcut, confirmation dismissal, and a 390px layout without horizontal overflow. Saved local preview: `.secrets/verification/visitor-access.png`. Tests do not claim real-device visitor passkey or actual hosted application-page acceptance.

Live deployment verification: exact matching `app.js` and `styles.css`; anonymous access reads and invitation creation return 401; foreign-origin invitation creation returns 403. No production visitor invitations were created and no real visitor was revoked during verification.

# MVP acceptance evidence

Audit date: September 29, 2026. Design-audit source snapshot: `771facf`, migrations 0001–0031. Updated after migration 0032 for the first-use AI allowance and response contract. This audit maps the original Word design and later user requirements to the current implementation. It is not a completion declaration or a new reduction in scope. Source inspection and recorded checks are distinguished from fresh end-to-end acceptance. See deployment.md for immutable Worker versions and test milestones.

## Original acceptance criteria

| Requirement | Evidence inspected | Determination and next proof |
| --- | --- | --- |
| Register, authenticate and start without external accounts | `src/passkeys.ts`, `src/index.ts`, `src/chat.ts`; passkey/onboarding tests and live signed-assertion receipts | Implemented. Native synced-passkey enrollment and successful human Turnstile signup still need a device/browser acceptance run. |
| Natural-language business site preview | `src/ai.ts`, `src/ai-chat.ts`, `src/site-agent.ts`, `src/components.ts`; recorded live Muse draft/edit checks | Delivered for reviewed static/photo components. A private QuickJS/Wasm execution service is deployed and tested; chat can generate, inspect and test private pure backend functions (live Muse + workerd verified); full generated-app data and publication integration remain absent. |
| At least three subsequent chat edits | Compact action prompt, strict response envelope, edit ancestry and validation; Explore now has 50 units (migration 0032). Dedicated journey fixtures use no bonus credits. | Verified on the live Muse integration: new project/draft plus theme, exact headline and section edits used 31/50 units (9, 9, 6, 7), zero holds and no replay charges. Private previews, preserved fields and ancestry checked; no grants or guided substitutes. Model reliability across broader requests remains a separate gate. |
| Durable publish and health result | `src/publications.ts`, `src/site-health.ts`, migrations 0008/0029; live published HTTP receipt | Delivered for shared-address HTML and photo response metadata. Custom domains, browser rendering and successful visitor submissions are outside that check. |
| Restore prior version from UI/chat | Publication review/restore, comparison links and guided/model controls; publication and live comparison tests | Delivered for immutable website artifacts. Directory data has separate reviewed restoration. Automatic general-service rollback remains open. |
| Upload files and incorporate through AI | `src/files.ts`, `src/photo-versions.ts`, exact version references and JPEG exports | Delivered for bounded JPEG photos. Arbitrary file types and generated build assets remain unsupported. |
| Existing domain and automatic HTTPS | `src/domains.ts`, `src/domain-hosting.ts`, routing/hosting tests, disabled-path live checks | Setup-gated. Scoped platform token/origin setup and real ownership, DNS propagation, certificate and serving-lease acceptance remain missing. |
| Domain purchase if enabled for extension | Product/API status and `docs/domains.md` | Disabled; purchase flow is unimplemented. Needs supported registrar access, authoritative availability/price/term/renewal terms, funding, exact consent and uncertain-result reconciliation. No real charges authorized. |
| Failed build cannot replace known-good site | Validated immutable template assembly and explicit publication; publication tests | Proven for rejected supported configuration. Isolated arbitrary builds/tests and automatic rollback of unhealthy replacements remain unproven. |
| Privileged actions carry identity and Activity | Owner joins, review triggers and activity receipts across modules | Implemented in supported paths, but a consolidated audit of every privileged action remains required. No claim of exhaustive coverage from narrow tests. |
| No reusable account credential reaches model | Fixed AI transport; encrypted connection vault; narrow server-side provider tools | Source boundary implemented. Worker secrets are never supplied as model arguments. Operator CLI credentials are not customer credentials. |
| Cross-tenant access denied | Resource-specific D1/HTTP tests for projects, versions, photos, contacts, directories, exports, DNS, hosting and backups | Tests cover implemented resources. New capabilities must retain these checks; a separate QuickJS/Wasm runtime now passes local and deployed service-binding isolation/exhaustion fixtures; the authenticated draft/test gateway and chat paths have ownership/quota/replay tests; generated-app data and public backend publication remain unimplemented. |
| Default UI needs no developer/provider tools | Landing/workspace pages, `web/app.js`, guided commands and model action contracts | Chat-first UI delivered. Consent occurs in provider UI when integrations are configured. Full device/mobile journeys and technical review wording still need acceptance. |

## Later user requirements

| Requirement | Current state |
| --- | --- |
| OpenAI-compatible AI backend and OpenCode Go testing | Chat Completions/Responses adapter; live Muse Spark 1.3 Contributor requests pass. No automatic paid fallback. |
| Conversational onboarding and default passkeys | Guided persisted onboarding, default passkey UI, recovery and optional password path exist. Real-device gate remains above. |
| Plans, quotas and overage credits | Proposed Explore/Launch/Studio tiers; atomic reservation/settlement; UTC month receipts; opt-in credits; immutable ledgers; reviewed operator waivers. Sales/subscription lifecycle remains deferred or unconfigured because the user has no Stripe account. |
| Chat as the main interface, details secondary | Implemented; supported service reads and reviews have guided/model chat actions. External consent and private inbox presentation use dedicated screens. |
| Optional own GitHub for versioning | App/PKCE/vault/revocation and reviewed expected-head backup code exist. Real App consent and customer repository write remain unverified without setup. |
| Optional own Cloudflare for DNS | OAuth/PKCE/vault/revocation, authorized zone discovery and reviewed TXT/fixed CNAME code exist. Real client consent/DNS operations remain unverified without setup. |
| Safe cross-user code reuse | Platform-authored static/photo components, contact backend and directory backend share implementation only. Customer data remains project-scoped. Customer-code promotion, reusable customer-site sign-in and withdrawal/migration workflow are incomplete. |
| Free GitHub and included Cloudflare allowance only | Existing Workers/D1/R2 deployment uses authorized account allowances; no upgrades or paid-only services were enabled. Original Containers/Sandbox proposal is not authorization to introduce them. General execution needs a compatible implementation and measured limits. |
| Advertising home page and temporary domain | Public landing page at digifender.com; authenticated workspace separate; invite-only remains enabled. |

## Fresh setup evidence

A read-only Wrangler secret inventory in this audit returned only `AI_API_KEY`, `PASSWORD_PEPPER` and `TURNSTILE_SECRET`. The expected GitHub App, Cloudflare OAuth and custom-hostname local configuration files were absent. These facts support setup-gated status, not provider availability or permission to create credentials. No credential values were read into the report.

## Remaining implementation gates

1. Expand whole-journey usability and model reliability acceptance beyond the now-passing creation-plus-three-edits test. In particular, avoid unnecessary requests for page-copy fields and continue checking unsupported actions and factual invention.
2. Finish broader dynamic workload and isolated execution support within the authorized cost boundary; preserve the original scope.
3. Complete customer project/account lifecycle, transcript/audit retention, abuse suspension and disaster recovery. Individual artifact deletion is not account erasure.
4. Verify real provider consent, backups, domain routing and TLS after setup. Implement registrar purchase beta only behind genuine capability/funding gates.
5. Complete native passkey, human Turnstile, scheduled production cleanup/health and whole-journey mobile acceptance.
6. Audit all privileged operations and known-good release behavior; keep application-specific recovery and general disaster recovery distinct.

The latest revised Word design is version 0.5. Its original sections preserve product intent; its implementation sections and this evidence map describe current reality. The full MVP is not complete.

## EmDash support requirement

Added September 29, 2026 at the owner's request. EmDash is an explicit CMS workload in MVP scope, not interchangeable with the static component renderer or QuickJS backend function runtime. The pinned Cloudflare integration lives in `integrations/emdash`; see `docs/emdash.md` for verified capabilities, provider constraints and remaining owner/chat/provisioning/migration gates. Full support must include an owned isolated CMS, chat management with reviewed publication, theme customization, media, content backup/restore and WordPress content import. A successful build alone does not complete this requirement.


## Reviewed backend data milestone

September 29: owned bounded project JSON state, exact ten-minute data reviews, atomic revision guards and user-only confirmation are implemented. Generated functions operate on JSON snapshots without storage capabilities. Database concurrency/expiry/retry/isolation tests, local bound-runtime HTTP flow and guided chat flow passed. This is private application data support; public backend routing, application authentication, lifecycle retention remain incomplete. Data history/export/reviewed restoration is available as described below. EmDash remains its own CMS integration and is not replaced by this document store.


## Backend data recovery milestone

Owned applied snapshots can be listed in chat, exported as private before/after JSON, and restored from either side through a new explicit review. Restoration preserves revision history and never reruns old code. Database tests verify foreign/pending snapshot rejection, exact restore content, initial-state recovery, stale review rejection, concurrent retries and lost acknowledgments. Chat tests verify server-issued download/confirmation controls, their removal after confirmation, and model prepare-only authority. Local HTTP tests verify attachment delivery, authentication/origin enforcement and restoration through the actual Worker API. This covers private JSON data recovery, not whole-account erasure, uploaded backup import, public backend deployment or platform disaster recovery.

## EmDash ownership bridge milestone

The deployed private CMS now requires signed owner/project-bound requests and refuses access while unassigned. Actual local EmDash integration proves empty-content setup, pinned owner administration, collection-schema reads and setup closure; the D1 gateway suite covers signature isolation and non-repeating writes. TownHello's project provisioning/consent and chat tools are not yet connected to this bridge. CMS content CRUD, media, reviewed publication, WordPress import and backup/restore remain explicit MVP gates. The private preview was not claimed by a test identity in production.

## CMS setup request milestone

Chat and authenticated HTTP now prepare exact owned EmDash setup reviews. Separate user confirmation atomically creates an isolated-resource registry entry in queued state. Model proposals cannot confirm themselves or claim provisioning has completed. D1/chat/HTTP tests cover ownership, concurrent review approval, expiry, replay and cost-cap rollback. Provisioning, credential installation, signed bridge binding and native bootstrap are still the next implementation gate; confirming a request currently queues it without allocating provider resources.

## CMS resource allocation milestone

The operator consumer now reads the approved queue and can allocate dedicated D1/R2/KV resources through the authenticated Cloudflare control plane, with durable creation intents and reconciliation. D1 tests verify concurrent allocation, uncertain outcomes, delayed results, immutable IDs and collision/account separation. Live read-only queue and preview-resource inventory calls succeeded; the queue was empty, so no customer allocation was performed. Worker deployment, per-instance secrets, service binding and signed CMS setup verification still separate provisioning from ready. No automatic scheduler or public CMS endpoint is enabled by this milestone.

## CMS deployment and native bootstrap milestone

The operator pipeline now freezes each approved project's compiled EmDash artifact, records a deployment intent, installs a derived project signing key, reconciles a tagged private Worker version, and initializes native EmDash using the original approval receipt. Readiness requires verified owner/posts/pages schemas and a recorded platform deployment with the private service binding. Ordinary releases preserve all verified CMS bindings. Owners can request a fresh private initialization check in chat or through the authenticated status endpoint.

Local D1/provider tests cover lost upload acknowledgments without repeat upload, source/key/version mismatches, owner/schema failures, receipt replay and tenant isolation. The actual local EmDash app passes native initialization verification. Production has no approved customer CMS queue entries, so full live tenant provisioning remains unverified. Tenant scheduling, content tools, publication reviews, media, WordPress import and CMS backup/restore remain open MVP gates. This milestone supersedes the earlier storage-only implementation status; it does not declare the CMS or overall MVP complete.

Deployment evidence: migration 0038 applied remotely; platform version `13de6d8c-6c00-486f-8387-c9817362335e` verified through the provider API. The TownHello landing page and health endpoint returned 200; the unauthenticated CMS status endpoint returned 401. No customer CMS instance was created by this release.

## Native CMS draft milestone

Native posts/pages can now be created privately, listed by creation receipt, read and recovered through chat and model actions. Actual EmDash integration tests prove native portable-text storage, draft status, reads, exact replay, changed-body rejection and publication denial. Local D1/platform/chat tests cover owner isolation, immutable request intent and recovery after a lost CMS response. Native mutation requests include the required EmDash header only after the signed gateway verifies authorization. This extends the bootstrap milestone; it does not establish existing-entry editing, public publishing, imports, media or CMS recovery. No production customer CMS exists yet, so live customer content creation remains unverified.

Deployment evidence: migration 0039 applied remotely; platform version `1819d13b-f3c2-444e-ae04-5718e9796574` and private preview version `26fc5dd0-5ec7-42b6-8c8f-5c24ee49e319` deployed. Live homepage/health returned 200, anonymous CMS API returned 401, and a remote service-binding probe confirmed the unassigned preview still returns 503 without ownership configuration. No tenant was assigned or customer content written.

## Native CMS edit milestone

Private posts/pages now support full title/paragraph replacement through chat and agent actions using the native revision returned by a read. Edits retain immutable intent and result receipts with an explicit recovery command. Actual EmDash tests prove stale/missing-token rejection, replay safety and simultaneous-edit conflict protection for both collections. Local platform tests cover recovery after lost responses, owner isolation, immutable requests and combined create/edit capacity. Existing native revisions are preserved by EmDash's normal update path; history browsing, previews, publication, imports and media remain open work.

Deployment evidence: migration 0040 applied remotely; platform version `731b09f4-c249-40ee-8a3c-bb8a62ed7b81` and private preview version `d1e48fb1-e4a0-447e-a25c-87bff91aee99` deployed. Live homepage/health returned 200 and anonymous CMS API returned 401. Customer CMS content editing is still not exercised in production because no customer instance has been assigned.

## CMS browser preview milestone

Owners can open a private preview from chat for a saved native draft. It renders current native content and revision using the TownHello article theme. Native rendering, escaped text, unsupported-content rejection, owner isolation, chat button metadata and restrictive response headers are covered by tests; local browser layout was inspected. The preview is current-state reading, not a frozen approval or public launch. Rich media, custom CMS themes and reviewed publication remain open.

Deployment evidence: migration 0041 applied remotely; platform version `759c77c7-d9e9-4b5e-b30d-d0eab50ed1a4` verified. Live homepage/health returned 200 and the anonymous preview endpoint returned 401. The CMS Worker profile itself was unchanged by this milestone. Live customer previews remain unverified until an approved customer instance is provisioned.

## Reviewed CMS publication milestone

Publication reviews freeze native revision/content, rendered article bytes, digest and public destination. Separate user confirmation promotes the revision in native EmDash; public serving starts only after its response matches the approved content. Tests cover native posts/pages publication and replay, stale/expired/foreign reviews, immutable snapshots, agent prepare-only authority, lost response recovery and withholding public content until verification. Public serving matches the exact frozen article and checks its digest. This is first publication on the platform article host; reviewed unpublish, republish, indexes/navigation, custom-domain CMS paths and CMS-inclusive overview statistics remain required follow-up work. No live customer publication was performed.

Deployment evidence: migration 0042 applied remotely after a transient D1 authorization failure recovered on a read-only check. Platform version `e440a8f0-57fe-4ed0-9857-14ebb30376b8`, site host version `3e9f4ebc-1f1a-4d58-bb45-a073527af690`, and private CMS preview version `7d42e0b8-2315-47eb-a115-41e1cb847531` deployed. Live health returned 200, anonymous frozen-review access returned 401, and an unpublished article URL returned 404. No customer content was published.

## CMS withdrawal and offline republish milestone

Owners can discover publication IDs, prepare an unpublish review and separately confirm it in chat. Confirmation atomically stops serving that exact public snapshot before native EmDash cleanup. Content and history remain available. Native tests prove unpublish/replay and retained content; platform tests prove ownership, expiry, competing-review denial, offline behavior through lost responses, cleanup recovery, blocked premature republishing and safe old-receipt replay after a new publication. Offline edit-and-republish is now supported. Live-version editing, article navigation, overview statistics and operator reconciliation remain open work.

Deployment evidence: migration 0043 applied remotely; platform `96754748-5e33-418d-9bdc-17e624ee7de7`, public host `0678e188-2dac-498e-8f66-50c03e3ea209`, and private CMS preview `a96854a7-ae42-427d-bc68-808c6acbb9ba` deployed. Health returned 200, anonymous CMS access 401 and an unpublished article URL 404. A production registry query returned no CMS instances; live tenant withdrawal remains unverified.

## CMS navigation and overview milestone

A public article index now lists only verified current publications and disappears when the last article is withdrawn. New article reviews include index navigation while existing frozen snapshots remain unchanged. Chat, project reads and agent context derive service status from current static/CMS publications, count combined projects once and show CMS article totals. D1 tests cover lifecycle transitions, deduplication, null static pointers, index privacy and escaping; workspace inspection regressions passed, and the local index layout was visually checked. Custom domains, richer media and live-version editing remain open CMS work.

Deployment evidence: migration 0044 applied remotely; platform `08cb3119-5f2a-4def-ae4d-f3352743c338` and public host `8f81c8d6-fa88-44af-9e32-93e4f205049e` deployed. Health returned 200, anonymous project reads 401, and an empty/nonexistent CMS index 404. Existing private CMS Worker code was unchanged.

## CMS staged editing and replacement milestone

Live posts/pages can now be edited into native EmDash staged revisions and privately previewed while the previous approved article stays public. The existing publication review flow freezes the current public version and replaces it at the same URL only after user confirmation and verified native promotion. Migration 0045 makes the public swap atomic, serializes approved publication operations and rejects conflicting withdrawal or stale-base reviews. Historical snapshots and receipts remain intact.

Verification covers actual EmDash staged/live separation and native promotion, plus real local D1 tests of lost-response recovery, competing actions, forced transaction rollback, exact public HTML/index changes, stable service counts and old-receipt replay. Full customer provisioning/live acceptance, rich media, imports, custom-domain CMS paths and operator reconciliation remain open CMS work.

Deployment evidence: migration 0045 applied remotely; platform `ff99ecc9-292c-4b04-8f55-66894a067aa4`, public host `7073b5db-6703-400e-9788-9054d925c95e`, private CMS preview `38f44bc3-e9de-4456-8eb2-c851df7aabca`. Live health returned 200, anonymous project reads 401, and a nonexistent CMS index 404. Production registry had no CMS instances and no approved publication operations. The first migration attempt failed atomically (remote inspection confirmed no added column or migration record); replacing the trigger's CASE expression with a direct conditional RAISE resolved remote SQL parsing. Local lifecycle tests passed again before the successful release.

## CMS staged-edit discard milestone

Owners can review and confirm abandoning a staged CMS edit while keeping the published article online. Native revision checks prevent discarding newer edits; immutable owner-scoped review records and gateway receipts provide exact recovery. The agent prepares reviews, and chat exposes user confirmation/recovery controls. Approved conflicting publish/unpublish/discard operations are serialized. Actual EmDash tests cover both collections; D1/chat tests exercise ownership, expiry, stale state, immutable records, lost responses, unchanged public HTML, competing operations and safe historical replay. Broader deletion, CMS backup/restore and live customer lifecycle acceptance remain open.

Deployment evidence: migration 0046 applied remotely; platform `9cd85bf7-b72c-409c-9440-d1c85c417df5`, public host `bda57c87-79a5-4db3-b168-a6fd2736e88c`, private CMS preview `8ccaaaa8-22ac-46dd-ad4b-ef4cbf2b7570`. Live health returned 200, anonymous project reads 401, and the served app bundle includes the discard-result control. No customer CMS article was modified during acceptance.

## Chat help and workflow discovery

The existing “What can you do?” control now opens a short help menu. `/help TOPIC` provides focused guides for websites, photos, CMS, domains, accounts, billing, backends, directories and backups; `/help all` provides the expanded guide. CMS instructions cover staged live edits, exact publication reviews, discard, withdrawal and receipt recovery. The guides distinguish configured/deferred capabilities and avoid presenting native published status as publication of a staged edit. Exact natural-language topic requests such as `help cms` remain free guided reads; ordinary requests such as “help me build a website” continue to the agent. Tests verify guided topic routing with AI configured, unchanged usage, unknown-topic fallback and preservation of onboarding state.

Release: platform `8b98366e-8494-4808-86d0-30e7d834d2ca`; no schema or CMS Worker change. The starting guide is 722 characters. Live health returned 200 and anonymous project access returned 401; authenticated help behavior was verified against local D1 through the actual chat service.

## Native CMS database recovery groundwork

An operator-only, registry-bound logical database capture handles EmDash's FTS5 tables without changing the live schema. It requires two equal captures and a successful fresh SQLite restore/recapture, then saves private artifacts with a completion manifest. Actual EmDash acceptance restored 73 tables and 180 rows with an identical digest; precision/blob/text/FTS/sequence/change/bounds fixtures passed. The ready-instance inventory in production was empty. This is not full CMS backup or disaster recovery: media, keys/artifacts, coordinated write quiescence, control/publication state and isolated provider restore/traffic switching remain required. No application deployment or provider resource creation was needed for this operator tooling.

## Native CMS media capture groundwork

The operator snapshot command accepts `--with-media` for the registered project R2 bucket. It saves raw object bytes, HTTP/custom metadata, per-file checksums and a digested media manifest; it checks saved files and repeats the media inventory and database capture before writing the completion marker. Source identity, object/storage/count/size/path/pagination bounds fail closed. Disposable workerd R2 round-trip tests preserved compressed and empty object bytes and metadata; provider fixtures exercised corruption, drift and bounds. A read-only live empty-bucket list verified response compatibility. Full quiescent backup, keys/artifacts/control state and isolated production-provider recovery remain outstanding. This operator-only change requires no application deployment or new Cloudflare resources.

## Isolated CMS restore and native boot evidence

The recovery verifier checks trusted capture digests and project identity, restores into disposable local D1/R2 stores, verifies database equality and media bytes/metadata, and emits private evidence only after success. A nonempty D1 target is refused; a failed restore batch rolls back. Native acceptance restored 73 tables / 180 rows, booted EmDash on the isolated D1 database, verified owner/setup/schema/post/page bodies and saved a fresh native edit. Paired-artifact tests cover checksums, metadata/cache-expiry, identity mismatch, foreign keys, FTS and injected rollback. No production resource or routing changed. This is local recovery evidence, not completion of production backup/recovery; capture quiescence, keys/artifacts/control state and reviewed provider traffic switching remain open.

### Generated backend publication progress

Added immutable, tested-version public endpoint reviews, owner-only confirmation, version replacement/withdrawal with stale-review protection, bounded anonymous JSON execution, and serialized daily project/account/platform invocation counters. Chat supports review/read/confirm/status/withdrawal; the model cannot confirm. Public guest execution receives caller JSON only. This advances generated backend delivery but does not complete generated app hosting: website controls, public app authentication, durable visitor data, migrations and whole-app recovery still need implementation and acceptance.

### Interactive website form progress

Reviewed website forms now send bounded numeric/text/boolean fields to the exact approved public function and show plain-text/JSON results. Website, backend and settings revisions guard activation; changing either published artifact hides the form. Browser acceptance used the real isolated runtime and verified result 30, literal returned markup and DOM method-name collision handling. Existing static previews/exports remain static; arbitrary frontend layouts, application authentication, persistent visitor data and full app recovery remain open.

### Persistent application data foundation

Added an internal visitor/session/document engine with separate application identities, hashed one-day sessions, per-visitor documents, immutable execution receipts and atomic revision-checked writes. D1 fixtures verify tenant isolation, retry/lost-acknowledgment behavior, concurrent writes and revocation/program changes. No public route or model tool exposes this engine; stateless endpoint approval does not authorize visitor storage. Owner activation reviews, visitor passkeys, authenticated frontend/data routes, lifecycle/retention and recovery remain necessary. See `docs/app-data.md`; migration 0050 is local-only at this milestone.

## Launch pricing, inference economics and acknowledgment timing

See [pricing-and-model-policy.md](pricing-and-model-policy.md) for implemented catalogue, new/legacy monthly receipts, Muse-only testing, shared shadow-cost reservations and the 700 ms acknowledgment / 1,000 ms minimum display rule. Subagent execution, real API-cost enforcement, paid annual fulfillment and domain redemption remain open gates.

## Persistent application authority review

Owner review now pins program/test/source, data access and revision. Concurrent/stale approval and session revocation are covered by `test:app-activation` and `test:app-data`. Visitor passkey enrollment, authenticated app UI, lifecycle/export/deletion and production browser acceptance remain open. Saved activation does not claim public readiness.

## Unified workspace and capacity policy — September 29, 2026

- Added a header-free workspace: fixed left brand/navigation/account controls, central dashboard and persistent desktop chat on the right. Narrow screens switch to Chat explicitly. Account panels render centrally; security/recovery remain modal.
- Saved owner/project-scoped workflow tabs and supported metric cards in D1 (0054). Model proposals use the same strict layout parser and revision checks; system controls and spending authority are excluded. Current layout is provided in model context.
- Pricing now describes flexible capacity instead of headline fixed storage inclusions. Existing preview limits remain enforced. Starter is the recommended paid launch default; free Explore accounts and receipts are unchanged.
- Added draft plan/interval/overage preferences and clear monthly/annual estimates. Draft preference writes cannot change entitlements or enable charges. Implemented tested quote, warning and two-consecutive-period recommendation helpers; operational retail metering and paid consent/settlement remain pending.
- Local D1 tests: owner isolation, foreign-project rejection, strict schema, stale/concurrent revisions, model action integration, draft-only spending settings, missing telemetry, proration, cap notices, and economic/headroom thresholds.
- Real Worker HTTP checks: anonymous 401, foreign Origin 403, saved layout readback, stale revision 409. Browser verified dashboard, custom Video workspace creation, draft $25 preference save, embedded usage panel, desktop chat and mobile navigation. Mobile DOM width matched a 390px viewport without horizontal overflow. Synthetic fixtures only.
- A regression run caught an oversized model system message. Transport now chunks system text at safe boundaries without discarding instructions; history trimming preserves every system chunk, and reservation accounting covers all bytes. Existing site-agent and plan-period regression suites pass.
- Screenshot: `.secrets/verification/unified-workspace.png` (synthetic account). Product decisions and remaining gates: `docs/unified-workspace-and-capacity.md`.

Deployment verification: code `42375cd`, main Worker `1c2543f0-35d7-4d37-88c3-537575be518a`; migration 0054 applied remotely. Served app bundle, stylesheet and workspace HTML matched local artifacts exactly. Anonymous dashboard/layout/capacity reads returned 401; foreign-origin capacity mutation returned 403. Public catalogue omits fixed storage targets and still reports subscriptions disabled. Model-cost regression passed, including shared main/ack budget and uncertainty holds. No new paid services or provider upgrades were enabled.

## Chat-first workspace refinement — September 29, 2026

- Chat is first/default and owns its view. Dashboard, workflow pages, Settings and Profile are independent full-width views; no side chat remains. Tools and Add Workspace were removed. Project controls moved to Dashboard, account services to Settings, and identity/authentication to Profile. Guided help uses the new destinations.
- Sidebar footer is an inline settings icon (left) and private avatar (right), without email or sign-out text. Empty workflows invite the customer to ask the agent for a custom page. Existing pages remain intact.
- Replaced the stacked workspace style overrides with shared day/night colors, consistent typography, spacing, form/button styles, responsive layout and focus states. Appearance is saved per owner (day/night/device).
- Migration 0055 adds private profiles with revision checks: name, About me, explicit AI-context opt-in, theme, and a bounded metadata-stripped JPEG avatar. Email is read-only until a verified-email change flow exists. Name/About me are excluded from inference unless opted in; photo/email/authentication data are always excluded.
- Password changes require a fresh session, rate limiting and current password proof for password-enabled accounts. SQL atomically replaces the credential and revokes old sessions, then issues a new session. Profile has passkeys/recovery and sign-out controls.
- `test:profile` passed actual D1 tests for isolation, field validation, stale/concurrent edits, AI opt-in/out, private JPEG validation/size/metadata/read/removal, CSRF, session freshness, current-password proof and old-session revocation. `tests/profile-http.mjs` additionally passed against real local workerd (credential replacement, old-session denial, successful new-password login).
- Existing workspace and site-agent suites passed. Type checking/build/diff checks passed. Browser verified default Chat, absent side chat/Tools/Add Workspace, separate Profile/Settings, name/About me save, private avatar upload, saved day/night controls, empty-workflow CTA, and mobile 390px layout without horizontal overflow. Both sidebar footer controls shared the same baseline.
- Synthetic screenshots: `.secrets/verification/refined-chat-day.png` and `refined-dashboard-night.png`. No real user's profile or password was changed during testing.

Final refinement: switching pages resets the page scroll position; theme controls serialize saves. Added a credential-version check when issuing password sessions, so a login already verifying an old password cannot create a session after a concurrent password change. The regression test simulates that race and confirms 401/no cookie. Both direct D1 and real Worker HTTP password checks pass.

Live release: code `ba928df`, main Worker `f6935cb6-0eb0-49e7-b694-24867a462097`, production migration 0055 applied. Served workspace HTML, app bundle, stylesheet and default avatar exactly match the tested files. Anonymous profile/photo reads return 401; foreign-origin password mutation returns 403. No production account credentials or profile content were changed by verification.
# Visitor authentication and gateway — September 29, 2026

Implemented internal invitation-only application passkeys, recovery, owner revocation and an unmounted HTTP gateway. Migration 0056 was verified on disposable local D1; it has not been applied remotely. Production remains on the prior release and does not expose visitor enrollment/data routes.

Passed `npm run test:app-auth`, `npm run test:app-data`, `npm run check` and `git diff --check`. Authentication uses independently signed ES256 responses and actual D1 transactions. Tests cover competing invitations, credential rollback, lost acknowledgment, counterless sign-in races, changed application authority, recovery racing with sign-in, cross-project isolation, cookie-bound challenges, exact session binding when adding a passkey, request limits, private receipt recovery and logout. The gateway test calls the handler directly; it does not claim a deployed visitor origin, real-browser authenticator or actual QuickJS acceptance.

Remaining: controlled visitor page/host, owner invitation and revocation UI, live cookie/passkey and runtime acceptance, visitor data export/deletion and retention. See `docs/app-data.md` for the implemented boundaries and next gates.

## WordPress source taxonomy analysis — September 30, 2026

The shared source analyzer and private offline report now produce exact category/tag mapping proposals and identify unsupported or ambiguous source metadata. Type checks, focused source mapping/staging suites, and actual workerd parity tests passed. No native terms are written or attached by this change; the owner-reviewed, resumable native import coordinator remains incomplete. This source/tooling increment has not been deployed. See [source mapping contract](emdash.md#source-taxonomy-mapping-analysis--september-30-2026).

## Operator profitability comparison — September 30, 2026

Added an optional private company-finance summary to `report:fair-use`, with explicit unknown values, closed/comparable-period checks, cost-category deltas and the proposed profit-decline comparison. Inputs are operator-attested, never represented as independently verified finances. This read-only companion cannot change the persisted mode, activate restrictions or attribute company cost to customer abuse. Type, finance-boundary/file/CLI and existing fair-use tests passed. No Worker/schema deployment is required. Real finance ingestion and reconciliation remain open; see [operator finance review](company-finance-review.md).

## Publishing recovery inventory — September 30, 2026

Chat now has a free `/cms-pending` inventory covering seven CMS operation families, with exact saved review/retry commands, owner scoping, expiry/completion filtering and pagination. The model has a corresponding project-scoped read tool. Opening the inventory performs no provider calls or retries. Actual D1, Chat, model-dispatch and mapped-import recovery tests passed; a read-only remote query also passed. This improves recovery discovery without claiming live CMS customer acceptance or completion of non-CMS workflows. See [publishing recovery](workspace-agent.md#unfinished-publishing-work-in-chat--september-30-2026).

## Combined WordPress image import — September 30, 2026

The deployed image picker/review flow now has actual-native local acceptance for a single import combining rich text, an image with source alt/caption, excerpt, category and tag. `pnpm test:cms-native-publication` passed the authenticated HTTP/Chat journey against the built EmDash artifact and disposable storage, including tampered-byte refusal, hidden interrupted taxonomy assignment, exact recovery without recreating the article, one native version increment and completed replay without dispatch or publication. Existing text-only import and image publication lifecycle checks passed in the same run. Detailed scope and remaining browser/live-customer gates are in [EmDash acceptance](emdash.md#combined-actual-native-image-and-taxonomy-import-acceptance--september-30-2026). This is local native evidence; it does not provision a live customer CMS or complete the broader MVP.

## Fair-use operator review delivery — September 30, 2026

`pnpm review:fair-use` now supports previewed internal review creation/resolution and account-scoped read/history through existing operator Cloudflare authorization. Writes require the exact preview digest and retain replay/concurrent-decision protections. Disposable D1 and both TypeScript checks passed. Migration 0091 is applied to test; remote reads verified its guards, zero review records and Monitor mode. No customer notice, appeal or restriction has been enabled; finance verification and customer delivery remain open. See [operator workflow](fair-use-reviews.md#operator-cli).
