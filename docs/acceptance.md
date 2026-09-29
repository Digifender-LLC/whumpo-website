# MVP acceptance evidence

Audit date: September 29, 2026. Design-audit source snapshot: `771facf`, migrations 0001–0031. Updated after migration 0032 for the first-use AI allowance and response contract. This audit maps the original Word design and later user requirements to the current implementation. It is not a completion declaration or a new reduction in scope. Source inspection and recorded checks are distinguished from fresh end-to-end acceptance. See deployment.md for immutable Worker versions and test milestones.

## Original acceptance criteria

| Requirement | Evidence inspected | Determination and next proof |
| --- | --- | --- |
| Register, authenticate and start without external accounts | `src/passkeys.ts`, `src/index.ts`, `src/chat.ts`; passkey/onboarding tests and live signed-assertion receipts | Implemented. Native synced-passkey enrollment and successful human Turnstile signup still need a device/browser acceptance run. |
| Natural-language business site preview | `src/ai.ts`, `src/ai-chat.ts`, `src/site-agent.ts`, `src/components.ts`; recorded live Muse draft/edit checks | Delivered for reviewed static/photo components. General generated backend execution is absent. |
| At least three subsequent chat edits | Compact action prompt, strict response envelope, edit ancestry and validation; Explore now has 50 units (migration 0032). Dedicated journey fixtures use no bonus credits. | Verified on the live Muse integration: new project/draft plus theme, exact headline and section edits used 31/50 units (9, 9, 6, 7), zero holds and no replay charges. Private previews, preserved fields and ancestry checked; no grants or guided substitutes. Model reliability across broader requests remains a separate gate. |
| Durable publish and health result | `src/publications.ts`, `src/site-health.ts`, migrations 0008/0029; live published HTTP receipt | Delivered for shared-address HTML and photo response metadata. Custom domains, browser rendering and successful visitor submissions are outside that check. |
| Restore prior version from UI/chat | Publication review/restore, comparison links and guided/model controls; publication and live comparison tests | Delivered for immutable website artifacts. Directory data has separate reviewed restoration. Automatic general-service rollback remains open. |
| Upload files and incorporate through AI | `src/files.ts`, `src/photo-versions.ts`, exact version references and JPEG exports | Delivered for bounded JPEG photos. Arbitrary file types and generated build assets remain unsupported. |
| Existing domain and automatic HTTPS | `src/domains.ts`, `src/domain-hosting.ts`, routing/hosting tests, disabled-path live checks | Setup-gated. Scoped platform token/origin setup and real ownership, DNS propagation, certificate and serving-lease acceptance remain missing. |
| Domain purchase if enabled for extension | Product/API status and `docs/domains.md` | Disabled; purchase flow is unimplemented. Needs supported registrar access, authoritative availability/price/term/renewal terms, funding, exact consent and uncertain-result reconciliation. No real charges authorized. |
| Failed build cannot replace known-good site | Validated immutable template assembly and explicit publication; publication tests | Proven for rejected supported configuration. Isolated arbitrary builds/tests and automatic rollback of unhealthy replacements remain unproven. |
| Privileged actions carry identity and Activity | Owner joins, review triggers and activity receipts across modules | Implemented in supported paths, but a consolidated audit of every privileged action remains required. No claim of exhaustive coverage from narrow tests. |
| No reusable account credential reaches model | Fixed AI transport; encrypted connection vault; narrow server-side provider tools | Source boundary implemented. Worker secrets are never supplied as model arguments. Operator CLI credentials are not customer credentials. |
| Cross-tenant access denied | Resource-specific D1/HTTP tests for projects, versions, photos, contacts, directories, exports, DNS, hosting and backups | Tests cover implemented resources. New capabilities must retain these checks; no general-code tenant sandbox exists yet. |
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
