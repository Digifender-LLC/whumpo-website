# Whumpo MVP delivery contract

The public homepage advertises the product. The signed-in default is a conversation, with only compact service and usage stats. Dashboard and workflow pages are separate sidebar destinations; Profile and Settings hold personal/account and platform controls respectively. Domain and project controls remain accessible from Chat. This checklist preserves the full MVP scope; an unchecked item is not delivered.

Current requirement-by-requirement evidence and remaining gates are in [the acceptance audit](acceptance.md). The [Whumpo technical design v0.6](whumpo_mvp_design.docx) consolidates current architecture, customer flows, pricing and outstanding launch gates. The earlier Word design v0.5 remains historical. Historical milestone paragraphs below retain their original sequence.

## Acceptance checklist

- [x] Public landing page and separate invitation-only workspace deployed at whumpo.com.
- [x] Owner-scoped project records, session authentication, activity history, and account/project limits.
- [x] Passkeys are the default signup/login method, with single-use browser-bound challenges, user verification, credential management, and recovery.
- [x] Conversational onboarding collects the customer's idea and preferences, resumes after interruption, and clearly identifies guided mode until a model is configured.
- [x] Persistent chat is the default workspace; owner-scoped history and minimal service/usage stats survive reloads.
- [x] OpenAI-compatible server adapter integrated with chat, with OpenCode Go configuration and a verified live Muse provider test.
- [ ] Chat tools create projects, show status/activity/usage, propose edits, preview, publish, and restore versions. Server-side permissions and confirmation gates govern actions.
- [ ] Working site generation, isolated previews, published sites, retained versions, rollback, and bounded uploads.
- [ ] Deliver current paid-plan lifecycle and unlimited standard assistance under fair use, with operator Monitor mode and separately approved premium credits. Preserve atomic spending, retry accounting and uncertain-outcome reconciliation. Current Explore test quotas are not the paid launch promise.
- [ ] Domain setup and status available through chat and a secondary screen, including verified ownership and DNS instructions.
- [ ] Domain purchase flow shows availability, price, renewal terms, and explicit confirmation before any purchase.
- [ ] Optional customer GitHub and Cloudflare connections use scoped authorization, revocation, and secret storage. Chat can initiate the same flows; provider consent occurs in the provider UI.
- [ ] End-to-end verification covers tenant isolation, auth replay, budget concurrency, provider failures, publish/restore, and mobile usability.
- [ ] Technical design and operations instructions reflect the actual deployed implementation and remaining limitations.

## Current commercial direction (draft; payments disabled)

| Plan | Monthly USD | Annual USD |
| --- | ---: | ---: |
| Starter | $17 | $170 |
| Personal | $30 | $300 |
| Business | $79 | $790 |
| Business Pro | $139 | $1,390 |

Paid launch assistance is **unlimited standard site work under fair use**, with tier-sensitive observation and **Monitor mode as the default**. Monitor sends no fair-use warnings and imposes no throttles or restrictions. Active enforcement requires an operator choice and verified company-wide profit deterioration with substantially stable revenue, plus the individual review/notice workflow. Company financial attribution and enforcement remain unfinished. Cost alone does not establish abuse.

Premium model add-ons/credits and separately approved infrastructure spending remain distinct. Annual plans propose standard-domain benefits under a wholesale cost cap; domain redemption is not implemented. Stripe remains disconnected at the owner's request, so subscriptions, credit purchases and domain purchases are unavailable. See [current pricing, routing and fair-use contracts](pricing-and-model-policy.md) and [payment foundation](payments.md).

Explore currently has 50 monthly test units with atomic reservation/settlement and opt-in use of existing test credits. The older $5/100-credit product and Launch/Studio receipts are legacy test mechanics, not the new premium API-credit tariff or launch plans. Keep unknown outcomes reserved for reconciliation and never automatically retry a potentially billable request. Browser input cannot grant an entitlement. Historical milestones below retain earlier pricing and scope for provenance; they are not current offers.

## Provider interface

`src/ai.ts` supports server-configured OpenAI Chat Completions and Responses text transports. Endpoint, key, model, and protocol are operator configuration, never prompt-controlled. HTTPS only, redirects disabled, 60-second timeout, bounded response size, bounded output, and sanitized errors. The adapter requires usage accounting and rejects truncated/unsupported responses. Billing integration and validated draft/edit/publication-review proposals are implemented. Model confirmation and arbitrary code execution are not allowed.

The deployed OpenCode Go test uses base URL `https://opencode.ai/zen/go/v1`, the supplied Go API key stored as `AI_API_KEY`, and `muse-spark-1.3-contributor` via Responses. This uses the existing subscription explicitly authorized by the user. No upgrade or automatic fallback is enabled. Models using Anthropic Messages are outside this adapter's compatibility surface.

References checked September 29, 2026:
- https://developers.openai.com/api/docs/guides/migrate-to-responses
- https://opencode.ai/docs/go/#endpoints

## Deployment constraints

GitHub free features only; no paid Actions, packages, or LFS. Cloudflare uses the existing account's included allowance, with no upgrades or paid-only services. Invitations remain required. Product pricing is independent of permission to spend on infrastructure. Payment-provider selection and customer domain purchases will require explicit configuration before real transactions are enabled.

## Guided conversation milestone

The workspace now starts with persistent chat, compact project/live-site stats, and a secondary Details menu. Guided onboarding saves a brief, asks for a name, and creates a project. The conversation supports /new, /cancel, /projects, /activity, /plans, /usage, /domains, /connections, and /help. Domain commands now prepare and check DNS ownership proofs. Hosting connections and optional account connections remain pending.

Migration 0003 adds owner-scoped workspace state and chat turns. Each request carries a UUID and expected revision. D1 batches atomically save the turn, advance onboarding, create a project, and append its audit event. Identical retries are idempotent; concurrent different turns return a conflict so the client can refresh. History displays the latest 100 turns; this test permits 2,000 turns per workspace.

Verified locally: onboarding resumes from the saved step, commands do not discard a brief, simultaneous retries create one project, conflicting tabs cannot overwrite each other, and another account cannot read the conversation. Browser verification covered login, chat onboarding, and project creation. Passkeys have since been delivered; the AI tool loop remains pending.

## Passkey milestone

Passkeys are now the default signup and sign-in method. The optional password flow preserves existing accounts and provides a fallback on unsupported devices. Registration requires a discoverable credential and user verification. SimpleWebAuthn validates the RP ID, origin, challenge, public key, signature, user-verification flag, and authenticator counter. A discoverable login also checks that the credential's user handle matches its owner.

Challenge tokens are random, hashed in D1, bound to a five-minute HttpOnly SameSite cookie, and atomically consumed before verification. Signup consumes the invitation and creates the user, passkey, and hashed recovery code in one transaction. Pending signup does not create a user. Recovery codes rotate on use and revoke prior sessions. Removing a passkey also revokes sessions atomically; a passkey-only account cannot remove its last credential. Security changes require a sign-in within ten minutes. `/security` or `/passkeys` opens the account security controls from chat.

Production RP ID is `whumpo.com`; development uses `localhost` at port 8787. Passkeys are scoped to the RP domain. When choosing the final brand/domain, retain access to the old account origin and implement an authenticated migration/re-enrollment flow before retiring it. Do not assume existing passkeys will work on the new domain.

Verification includes independently generated ES256 registration and signed authentication fixtures, rejected wrong origins and missing user verification, cookie binding, replay/counter rejection, recovery rotation, session revocation, and backup credential removal. A signed assertion also passed against the live Cloudflare Worker, followed by authenticated chat and logout. Its temporary account was deleted. Browser UI checks covered the default passkey button, signup fields, and security menu. Native device prompts and actual synced passkeys still need a user-device acceptance check; no user credential was created by the agent.

References: https://simplewebauthn.dev/docs/packages/server and https://simplewebauthn.dev/docs/packages/browser (checked September 29, 2026).

## Metered AI chat milestone

Migrations 0005 and 0006 add billing accounts, monthly periods, reservations, immutable credit/usage ledgers and pending/completed/failed/uncertain AI turns. Explore's 25 monthly units are enforced with atomic quota-first reservations. Existing credits can cover the balance only after explicit opt-in. Paid tiers and purchases are still disabled, so the complete commercial checklist remains open.

A UUID and expected chat revision identify each operation. Pending messages serialize a conversation. Dispatch is claimed once, and answers/token usage are saved before settlement. Reconciliation can finish persisted results without another provider call. Uncertain requests retain their reservation for review; confirmed rejected requests release it. Undispatched reservations expire after five minutes. An exhausted output budget yields no user charge. Provider reasoning tokens count as output usage; reasoning text is never presented as the answer.

The provider boundary adapts Jarvis response validation and safe diagnostics; see [Jarvis reuse](jarvis-reuse.md). A provider call is bounded to 60 seconds; pending-turn recovery waits two minutes. The model cannot grant itself execution authority or claim that draft sites have been published.

The usage dialog shows allowance, spending, holds, credit balance and recent ledger entries. Read-only commands and onboarding remain free. Credits do not permit exceeding other test limits. There is currently no automated provider receipt reconciliation for unknown outcomes; an operator must check them before settling or releasing holds.

## Reusable components

The first site should be assembled from approved generic components where possible, with AI reserved for missing features and private customization. Shared source must contain no customer data. The component provenance, tenant isolation, promotion review, versioning and cache rules are specified in [shared-components.md](shared-components.md). This adds a delivery requirement for the site assembler; the first platform-authored launch-page component and private preview assembler are implemented; the broader library remains incomplete.

## Reusable preview milestone

`/build [ocean|clay|forest] [project UUID]` assembles the most recently created project by default. It saves `launch-page@1`, its tenant-owned configuration, exact HTML and SHA-256 digest in migration 0007. The preview, chat turn and audit commit together under the conversation revision; identical retries do not create another version. D1 limits each project to 25 versions and each HTML artifact to 32 KiB.

Authenticated preview reads join the version to its project owner. Responses are private/no-store and use CSP sandbox with no scripts, forms, network resources or framing. All configuration enters escaped text positions; themes are allowlisted. The catalog itself contains only platform source metadata and has no customer entries. This does not yet authorize arbitrary generated HTML/JS, backend execution or public publishing.

The browser opens a saved preview from its chat message. Existing previews remain unchanged when another theme is built. API reads expose the catalog and owner-scoped version metadata; publishing, selecting/restoring an active version and AI editing are the next steps.

## Publication and restore milestone

Migration 0008 records a current published-version pointer with a monotonically increasing revision and exact publication reviews. `/publish [VERSION_ID]` defaults to the latest saved version; `/restore VERSION_ID` selects a retained version; `/unpublish [PROJECT_ID]` defaults to the most recently updated live project. Reviews show the destination and exact saved version, explain public exposure, expire in ten minutes, and require a separate `/confirm` or button. `/versions [PROJECT_ID]` lists retained versions.

Database triggers enforce the review's owner/project/version identity, unexpired status, expected publication revision and plan site quota. They update the pointer, project status and audit event atomically with the confirming chat turn. Stale reviews cannot overwrite a newer publication; duplicate confirmation requests return the committed result without a second change. Draft creation never changes the live pointer. Restore selects exact stored HTML without inference. Unpublishing leaves all previews intact.

The separate `tellumo-sites` Worker serves only GET/HEAD `/s/PROJECT_ID` on `PROJECT_ID.whumpo.site`; it has no AI/auth secrets and no workspace routes. Responses retain CSP sandbox, scripts/forms/network denial and no-store to make unpublication visible on the next request. It shares the existing D1 database via a binding; code limits reads to explicitly published versions, but the binding itself is not a database read-only role. Arbitrary customer scripts/backends are not supported by this serving boundary.

The full MVP remains incomplete: natural-language tool selection, AI edits, uploads, custom domains, purchases, optional account connections and checkout are still required. These publication controls apply to the currently supported reusable static pages.

## AI website drafts milestone

Muse Spark 1.3 Contributor can select the approved `site-page@1` component and propose validated text, three themes and up to six sections. `/edit` explicitly requests AI work; ordinary conversation after onboarding also uses this path. The server parses strict JSON proposals, validates owner/project and configuration, escapes all content, and saves exact HTML as a private immutable version. This is constrained component composition, not arbitrary code execution.

AI can prepare publish, restore and unpublish reviews through the existing gateway. It cannot confirm them. Action receipts come from the server, not model claims. Draft/action statements and the chat answer/token receipt commit in one D1 batch before billing settlement; a lost acknowledgement recovers the saved result without another inference. Invalid proposals and version-quota failures apply nothing and release the reservation; the platform absorbs those provider calls. Migration 0009 records AI provenance and the prior version when available.

The current context includes five owned projects and the latest owned version. Unsupported scripts, backend execution, uploads, external integrations and arbitrary styles are rejected. The full MVP still requires broader layouts, uploads, domain management, account connections and payment integration. Stripe test mode is selected for checkout; real charges are not authorized.

## Test payment foundation

The owner selected Stripe test mode, then deferred connection because no Stripe account exists. Credit-pack checkout and signed webhook fulfillment are implemented behind test-only secret configuration; the deployed UI keeps checkout hidden while unconfigured. Fixed server orders, Stripe idempotency and atomic D1 credit grants protect retries and event reordering. See [payments.md](payments.md) for the contract and validation. Subscriptions, real Stripe verification and live payments are not enabled.

### Focused edits

Existing versions can be changed through an `edit` proposal containing an exact owned base-version ID and a nonempty subset of allowed configuration fields. The server merges those fields with saved configuration, preserves omitted fields, validates the result and renders a new immutable private version. Theme/headline edits no longer require the model to repeat all site copy. Replacing the sections array remains an explicit whole-array operation. The initial launch-page component can be upgraded into the information-page contract using deterministic defaults. Unknown components, cross-owner base IDs and executable fields are rejected. Editing an older version creates a private branch; it never overwrites that version or changes publication.

## Source export

`/export [VERSION_ID]` and “download my website” prepare an owner-only source download in chat. Without an ID, the latest saved version is selected and named in the receipt. Preview messages also offer a source link. The route rechecks ownership on every download; authentication and cross-owner failures return 401 and 404 respectively. Exports do not publish, change versions or consume model units.

Each ZIP includes exact saved `public/index.html`, a static-host `_headers` policy, `tellumo/site.json` with validated configuration and a checksum, and a README. Archive paths are constants, never customer-controlled strings. Only explicit site fields enter the archive; sessions, account IDs, chat, runtime bindings, billing data and platform code are excluded. The schema bounds archive size below 50 KiB. ZIP storage mode avoids compression CPU and a fixed timestamp makes repeated downloads deterministic. The owner can host or edit the HTML without TellUmo or a build tool. Archive import and exports of unsupported future backend components remain unimplemented.

Migration 0011 pins export chat links to exact immutable versions. A database guard checks the conversation and version share an owner. Links are removed by cascading deletion; the API checks current ownership regardless of old conversation content.

## Private photo uploads

The files view is accessible through `/files`, “show photos”, or Details → Project photos. It uploads, lists and previews photos owned by the selected project without AI usage. Browser preparation resizes supported images; server validation strips JPEG metadata and bounds size/dimensions. D1 reservations and create-only R2 writes make retries safe. A private Standard R2 bucket and bounded cleanup job run on the existing account. See [photos.md](photos.md) for the exact API, quota, privacy and recovery contract. Versioned photo composition, private embedded previews, confirmed public photo serving and photo-aware exports are implemented. Reviewed unused-photo removal is implemented; photos referenced by saved versions remain protected.

## Photo versions milestone

Migration 0013 adds immutable version-photo references and atomic R2 operation budgets. `photo-page@1` accepts up to four ready photos owned by the same project. Use in website and `/photo FILE_ID` create private versions without inference; AI focused edits can change photo references while preserving omitted content. Photo bytes are not sent to the model or shared catalog.

Private previews embed checksum-verified JPEGs under a sandbox. The public host checks current publication membership before serving image bytes; restore/unpublish updates access on the next request. ZIP exports include exact images and fail if dependencies cannot be verified. Tests cover cross-owner and same-owner cross-project rejection, replay, missing assets, version restoration, public visibility and operation-budget concurrency. Live signed-in checks and public browser rendering passed. Offline file opening was blocked by browser policy; independent ZIP/image checks passed.

The revised Word design is v0.4. Original sections 1–25 retain product intent; sections 26–32 specify current implementation and remaining contracts through application commit `3827e65` and migration 0024. It covers monthly plan receipts, reviewed photo/version removal, optional provider connections, reviewed DNS, and safe shared backend components. All 30 rendered pages were visually checked. Payments remain disabled at the owner’s request.


## Domain ownership milestone — September 29, 2026

Chat and Details → Domains can prepare, renew and verify project-specific DNS TXT proofs. The fixed resolver, exact proof matching, bounded responses, seven-day expiry, account isolation and atomic claim limits are implemented and tested. Verification consumes no model units. Live tests confirmed creation/replay, a real DNS nonmatch, authentication and the explicit not-connected state.

Custom-hostname provisioning, certificates, domain routing, disconnect/removal, purchases and optional customer account authorization remain incomplete. Existing Wrangler authorization cannot access Cloudflare Custom Hostnames (403); a narrowly scoped provider token was requested. No additional paid service was enabled. See [domain design](domains.md).


## Conversational preferences and first draft — September 29, 2026

Guided setup now collects idea → name → audience/visitor goal → style, saves progress between requests, and finishes with a private launch-page preview. Audience and style can be skipped. Free-form style notes are retained for later AI edits; the initial renderer uses ocean unless an exact supported theme is chosen. `/brief [PROJECT_ID]` reads the private brief and `/build` uses the saved starting theme. `/new` and `/cancel` leave already created projects intact.

The guided flow uses no inference even when AI is configured. Notes enter the owner's bounded AI context on later model requests; they are never automatically copied into the deterministic preview or exported as project metadata. AI drafts still require human review before publication. See [onboarding design](onboarding.md).


## Natural-language project and export actions — September 29, 2026

The validated AI action vocabulary now includes atomic project-plus-private-website creation and source-download receipts for exact owned versions. Customers can request these in natural language after onboarding, or explicitly use `/ask` during setup. Server-selected ownership/IDs, schema validation, project quotas and persisted usage receipts govern execution. Neither action publishes a site or accesses external customer accounts. Model interpretation is metered; deterministic guided alternatives remain free. Full domain, provider-connection and purchase scope remains open. See [workspace AI actions](workspace-agent.md).


## Workspace inspection milestone — September 29, 2026

Natural-language inspection can now request owner-scoped projects, a specific project, saved versions, a specific version, activity, usage and domains. Server records replace model-written status claims for accepted inspection actions. Exact deterministic commands remain available without AI charges. The agent receives all project identities and can inspect versions outside its latest-draft context, then act on exact IDs in a subsequent turn. Automatic multi-step tool chaining is not implemented. See [workspace actions](workspace-agent.md).


## GitHub authorization foundation — September 29, 2026

The secondary Connected accounts panel can initiate GitHub App authorization and disconnect; chat opens the same controls. One-time session-bound PKCE, encrypted expiring user tokens, installation filtering, local revocation and queued provider deletion are implemented and tested with controlled responses. Configuration is absent, so deployment stays disabled. Real GitHub consent/revocation, repository selection and source backup remain unverified or unfinished. Customer Cloudflare authorization remains unfinished. See [GitHub connection design](integrations/github-connection.md).

## Reviewed GitHub backups — September 29, 2026

Repository selection and explicit source-backup reviews are implemented. Readable version folders use atomic expected-head commits, exact source-tree verification and read-only recovery after uncertain writes. Controlled provider tests cover isolation and concurrency; Git independently verifies source-tree hashes. No real GitHub commit has been tested because App configuration is absent. Empty repository initialization, automatic synchronization, live consent/commit acceptance and customer Cloudflare authorization remain outstanding. See [backup design](integrations/github-backups.md).

## Conversational domain ownership — September 29, 2026

AI proposals can prepare domain TXT ownership instructions and check DNS using the existing owner-scoped domain operations. Replies are server-generated, errors release reservations and retries reuse the saved result. Controlled tests cover cross-user IDs, DNS failures, expiry, quota refunds and lost acknowledgements. Hosting, certificates, purchase/renewal and customer Cloudflare authorization remain unfinished; the full domain checklist stays open.

## Custom hostname provisioning implementation — September 29, 2026

Reviewed provisioning, bounded provider access, exact-resource cleanup, direct-CNAME/TXT/certificate checks and expiring public-routing authorization are implemented. The Domains panel includes review/confirm/status/disconnect controls. Activation remains disabled pending the zone token, fallback origin, safe route exclusions and real TLS/routing acceptance. Unknown provider IDs after uncertain requests require operator reconciliation. Apex/proxied-DNS support and the long-lived ownership lifecycle remain unfinished. See [hosting design](integrations/domain-hosting.md). The full domain requirement remains open.

## Hostname recovery and status ordering — September 29, 2026

An operator-only inspect/apply tool can reconcile a known provider ID after an uncertain create, with a reviewed digest, independent evidence note and atomic immutable audit receipt. Routing remains disabled until normal checks pass. Status updates now use attempt IDs and current-proof checks to reject stale verification results. Missing-resource and stuck-creating recovery, provider setup and live acceptance remain outstanding.

## Month-specific plan receipts — September 29, 2026

An internal fulfillment boundary now grants a paid tier for one UTC month with unique immutable payment references, transactional allowance/ledger changes and replay recovery. Upgrades preserve usage and holds; new months require a renewal receipt. Credits persist separately. Publication checks use current-month receipts rather than a stale account plan cache; existing live sites remain available after downgrade, with new publication blocked over the lower limit. Subscription checkout, provider lifecycle events and final downgrade/refund/proration policy remain unfinished. See [plan lifecycle](plan-lifecycle.md).


## Reviewed photo removal — September 29, 2026

The photo panel and `/photos`, `/delete-photo` and `/confirm-photo-delete` commands support owner-scoped, expiring reviews for removing unused photos. Confirmation atomically records the chat receipt, deletes metadata and queues storage cleanup. Original upload IDs cannot resurrect removed photos. Saved-version references block removal, including a reference added after review. Pending physical deletions count toward platform capacity. Saved-version deletion, customer account deletion and full long-lived retention controls remain unfinished. See [photo lifecycle](photos.md).


## Customer Cloudflare OAuth foundation — September 29, 2026

The optional Connected accounts panel now includes a Cloudflare Authorization Code flow with session-bound S256 PKCE, encrypted expiring credentials, cancellation/disconnect fencing, leased provider revocation and authorized-zone discovery. Chat can open the same controls. It stays disabled until a registered OAuth client and vault key are installed; the existing Wrangler login cannot manage OAuth clients (403). No live customer consent, DNS mutation or domain purchase has been performed. Reviewed DNS changes and their live acceptance remain unfinished. See [Cloudflare authorization](integrations/cloudflare-connection.md).


## Reviewed customer DNS proofs — September 29, 2026

The Domains panel can review and explicitly confirm additive TXT proof creation using a customer's own authorized Cloudflare zone. Reviews pin ownership, proof, credential, inventory and expiry. Existing records are preserved, identical proofs need no write, and uncertain requests are observed without retrying POST. Customer OAuth setup and real DNS acceptance remain pending. Website-routing CNAMEs were subsequently implemented (migration 0027); record update/removal and purchases remain unfinished. See [DNS proof workflow](integrations/cloudflare-dns.md).

Deployment verification: migration 0023 and the TXT-review controls are deployed. Disposable provider tests, local browser review/confirmation, and live disabled-access/tenant/Origin checks passed. Customer OAuth setup and real DNS-write acceptance remain pending; see `integrations/cloudflare-dns.md`. Stripe remains disconnected at the owner’s request.

## DNS controls in the conversation — September 29, 2026

Customers can list authorized zones and owned reviews, prepare an exact TXT proof review, explicitly confirm it, and inspect uncertain results using `/dns-zones`, `/dns`, `/review-dns`, `/confirm-dns` and `/check-dns`. The commands consume no AI units and preserve onboarding state. A committed chat turn is required before provider dispatch; stale messages, conflicting IDs and replays cannot dispatch twice. The model can explain these commands but cannot confirm DNS actions. Provider configuration and real DNS acceptance remain pending; subsequent milestones below add model-proposed reviews and fixed-target CNAME routing.

## Natural-language DNS reviews — September 29, 2026

The agent can now discover authorized zones, inspect saved reviews and prepare an exact TXT-proof review from a natural-language request. Strict action validation excludes confirmation and all record mutations. Authoritative server receipts replace model claims; users confirm separately through existing chat/panel controls. Zone discovery is paginated, and the agent asks for ambiguous targets. Fixed-target website-routing reviews were subsequently added below. General record management and domain purchases remain unfinished; customer OAuth and real DNS acceptance remain pending.

## Reviewed saved-version removal — September 29, 2026

Unused saved versions can now be removed through an exact ten-minute review and separate chat/button confirmation, freeing space under the 25-version limit. Live versions, active publication reviews and GitHub backup records remain protected at the database deletion boundary. Original photos remain until separately removed, while deleted preview/export/restore targets become unavailable. Applied reviews retain identity/digest tombstones and retries cannot recreate removed versions. The AI may prepare a review but cannot confirm. Backed-up version removal, automatic retention and customer project/account deletion remain unfinished. See [version retention](version-retention.md).

## Reusable contact forms and private inbox

The first shared dynamic backend now supports reviewed contact-form activation for an exact live publication, a platform-hosted visitor form, and an owner-only inbox accessible with `/inbox`. Name/email/message submissions use server-side Turnstile checks, atomic quotas and 30-day visibility retention. Visitor content never enters the AI context or saved chat automatically. Publishing/restoring disables intake until a fresh review. Static exports remain independent of hosted form settings. See `docs/contact-forms.md` for the runtime contract, retention and acceptance limits. This advances the contact-form requirement described as future work in the v0.4 Word snapshot; broader CRUD apps, isolated execution, email delivery and provider acceptance remain unfinished.

## Private version comparisons

Customers can inspect exact saved changes through `/diff`, natural-language comparison requests, private draft links and publication-review links. Text, positional sections and photo references are compared with a selected or live baseline; chat links retain their exact baseline across later publications. Foreign/project-mismatched versions and stale review pages are rejected. This implements the saved-version comparison requirement for the existing components, with no model use for guided reads. It does not compare arbitrary backend code or application database state. See `docs/version-comparisons.md`.


### Reviewed website-routing CNAMEs (September 29)

Implemented fixed-target DNS-only CNAME reviews through Domains, `/review-routing`, and the validated AI action. Explicit user confirmation remains required. Conflicting records are preserved, dispatch rechecks ownership/access/hosting state, and uncertain results are only observed. Migration 0027 extends the existing DNS review ledger. See [the DNS integration contract](integrations/cloudflare-dns.md#website-routing--migration-0027). Real customer OAuth and custom-hostname setup remain gated; apex routing, DNS replacement/removal and domain purchasing are not implemented. Stripe remains disconnected at the user's request.


### Hosting lifecycle in chat (September 29)

The existing hosting review/confirm/status/disconnect operations are now available through `/hosting`, `/review-hosting`, `/confirm-hosting`, `/check-hosting` and `/disconnect-hosting`. AI requests can list or prepare reviews; explicit user commands retain provider mutation authority. This closes the panel-only hosting-control gap. Real provider configuration, consent, DNS/TLS acceptance, general backend generation and domain purchases remain open; Stripe is still deferred.


### GitHub source backups in chat (September 29)

Installation/repository discovery, exact source reviews, explicit confirmation and read-only uncertain-result checks now work in chat. Reviews disclose public repository exposure and preserve existing expected-head commit/source verification behavior. The AI may discover and prepare; it cannot commit. This closes the panel-only source-backup gap. Real customer GitHub App consent/commit acceptance and automatic synchronization remain unfinished.


### Audited recovery of unresolved AI holds (September 29)

Operators can inspect and explicitly waive an aged uncertain AI hold without retrying the model or fabricating provider usage. Migration 0028 atomically restores held quota/credits, closes the original chat turn and saves an immutable audit receipt. Known token receipts, settled charges and active turns are excluded. Late model-result writes are fenced at the transaction boundary. This closes the indefinite-hold support gap; automatic provider-receipt reconciliation and the deferred payment/subscription lifecycle remain incomplete. See [usage recovery](usage-recovery.md).

## Published website verification

Shared-address publishing now attempts a saved HTTP/content and photo-response check. Chat supports `/health` and `/check-site PROJECT_ID`; bounded hourly maintenance refreshes due results. See [health scope and limits](site-health.md). This is synthetic endpoint verification, not automatic repair, custom-domain verification or a full uptime service.

## Small dynamic directory starter

A reusable directory backend supports private listing create/read/update/delete through chat, exact reviewed public snapshots, a responsive public page and a public JSON read API. Tenant data stays separate from shared code; draft edits cannot silently change published data. Database revision and explicit-confirmation checks govern both model and guided proposals. See [directory service](directories.md). This advances the small dynamic apps/API requirement; arbitrary schemas, customer-site authentication, application data rollback and isolated generated backend execution remain incomplete.

## Directory data recovery

Applied directory snapshots can now be listed, exported privately as JSON, and restored to the private draft through an exact current-versus-replacement review. Restoration preserves listing IDs and records immutable source ancestry; public data requires a separate publication confirmation. This supplies data recovery for the supported directory schema. General application migrations/rollback, arbitrary schemas and portable backend export remain incomplete. See [directory recovery contract](directories.md).

## Connected website delivery acceptance

Chat now links “Review website changes” to the exact pending publication review, including restore and unpublish reviews. The separate general version comparison remains available, but only the review-specific endpoint checks the pending action, expiry and expected live revision. Reading either page never confirms an action.

`test:customer-site-journey` exercises actual platform HTTP handlers and the separate visitor-host handler with disposable local D1: profile/welcome, first project, private draft, authenticated preview/source export, publication review, origin rejection, confirmation retry after discarding its response, a private second version, stale review rejection, exact saved-version restoration and unpublication. It also checks that foreign accounts cannot read previews/exports/comparisons/reviews and that previews survive unpublication. This fixture bypasses native passkey enrollment with synthetic sessions and uses guided builds without inference; live Muse onboarding-to-draft acceptance is separately recorded in [onboarding](onboarding.md). It does not publish a real customer site or prove physical mobile behavior.

September 29, 2026 acceptance: `pnpm test:customer-site-journey`, `pnpm check`, `pnpm build` and diff checks passed. The review-link change is deployed in test platform version `6bc298a1-18ab-46d8-89e8-5d899db1b87e`. Live health returned 200, anonymous exact-review access returned 401, and frontend JS/CSS matched the isolated build. No migration, provider configuration or real customer publication was performed.
