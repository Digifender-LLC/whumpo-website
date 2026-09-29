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

The deployed private CMS now requires signed owner/project-bound requests and refuses access while unassigned. Actual local EmDash integration proves empty-content setup, pinned owner administration, collection-schema reads and setup closure; the D1 gateway suite covers signature isolation and non-repeating writes. Whumpo's project provisioning/consent and chat tools are not yet connected to this bridge. CMS content CRUD, media, reviewed publication, WordPress import and backup/restore remain explicit MVP gates. The private preview was not claimed by a test identity in production.

## CMS setup request milestone

Chat and authenticated HTTP now prepare exact owned EmDash setup reviews. Separate user confirmation atomically creates an isolated-resource registry entry in queued state. Model proposals cannot confirm themselves or claim provisioning has completed. D1/chat/HTTP tests cover ownership, concurrent review approval, expiry, replay and cost-cap rollback. Provisioning, credential installation, signed bridge binding and native bootstrap are still the next implementation gate; confirming a request currently queues it without allocating provider resources.

## CMS resource allocation milestone

The operator consumer now reads the approved queue and can allocate dedicated D1/R2/KV resources through the authenticated Cloudflare control plane, with durable creation intents and reconciliation. D1 tests verify concurrent allocation, uncertain outcomes, delayed results, immutable IDs and collision/account separation. Live read-only queue and preview-resource inventory calls succeeded; the queue was empty, so no customer allocation was performed. Worker deployment, per-instance secrets, service binding and signed CMS setup verification still separate provisioning from ready. No automatic scheduler or public CMS endpoint is enabled by this milestone.

## CMS deployment and native bootstrap milestone

The operator pipeline now freezes each approved project's compiled EmDash artifact, records a deployment intent, installs a derived project signing key, reconciles a tagged private Worker version, and initializes native EmDash using the original approval receipt. Readiness requires verified owner/posts/pages schemas and a recorded platform deployment with the private service binding. Ordinary releases preserve all verified CMS bindings. Owners can request a fresh private initialization check in chat or through the authenticated status endpoint.

Local D1/provider tests cover lost upload acknowledgments without repeat upload, source/key/version mismatches, owner/schema failures, receipt replay and tenant isolation. The actual local EmDash app passes native initialization verification. Production has no approved customer CMS queue entries, so full live tenant provisioning remains unverified. Tenant scheduling, content tools, publication reviews, media, WordPress import and CMS backup/restore remain open MVP gates. This milestone supersedes the earlier storage-only implementation status; it does not declare the CMS or overall MVP complete.

Deployment evidence: migration 0038 applied remotely; platform version `13de6d8c-6c00-486f-8387-c9817362335e` verified through the provider API. The Whumpo landing page and health endpoint returned 200; the unauthenticated CMS status endpoint returned 401. No customer CMS instance was created by this release.

## Native CMS draft milestone

Native posts/pages can now be created privately, listed by creation receipt, read and recovered through chat and model actions. Actual EmDash integration tests prove native portable-text storage, draft status, reads, exact replay, changed-body rejection and publication denial. Local D1/platform/chat tests cover owner isolation, immutable request intent and recovery after a lost CMS response. Native mutation requests include the required EmDash header only after the signed gateway verifies authorization. This extends the bootstrap milestone; it does not establish existing-entry editing, public publishing, imports, media or CMS recovery. No production customer CMS exists yet, so live customer content creation remains unverified.

Deployment evidence: migration 0039 applied remotely; platform version `1819d13b-f3c2-444e-ae04-5718e9796574` and private preview version `26fc5dd0-5ec7-42b6-8c8f-5c24ee49e319` deployed. Live homepage/health returned 200, anonymous CMS API returned 401, and a remote service-binding probe confirmed the unassigned preview still returns 503 without ownership configuration. No tenant was assigned or customer content written.
