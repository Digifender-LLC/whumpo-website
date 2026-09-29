# TellUmo MVP delivery contract

The public homepage advertises the product. The signed-in default is a conversation, with only compact service and usage stats. Account, domain, billing, and project details live in a secondary menu. This checklist preserves the full MVP scope; an unchecked item is not delivered.

## Acceptance checklist

- [x] Public landing page and separate invitation-only workspace deployed at digifender.com.
- [x] Owner-scoped project records, session authentication, activity history, and account/project limits.
- [x] Passkeys are the default signup/login method, with single-use browser-bound challenges, user verification, credential management, and recovery.
- [ ] Conversational onboarding collects the customer's idea and preferences, resumes after interruption, and clearly identifies guided mode until a model is configured.
- [x] Persistent chat is the default workspace; owner-scoped history and minimal service/usage stats survive reloads.
- [x] OpenAI-compatible server adapter integrated with chat, with OpenCode Go configuration and a verified live Muse provider test.
- [ ] Chat tools create projects, show status/activity/usage, propose edits, preview, publish, and restore versions. Server-side permissions and confirmation gates govern actions.
- [ ] Working site generation, isolated previews, published sites, retained versions, rollback, and bounded uploads.
- [ ] Plans and monthly quotas enforced atomically; credits cover overage only with explicit opt-in; retries cannot charge twice; failures release reservations.
- [ ] Domain setup and status available through chat and a secondary screen, including verified ownership and DNS instructions.
- [ ] Domain purchase flow shows availability, price, renewal terms, and explicit confirmation before any purchase.
- [ ] Optional customer GitHub and Cloudflare connections use scoped authorization, revocation, and secret storage. Chat can initiate the same flows; provider consent occurs in the provider UI.
- [ ] End-to-end verification covers tenant isolation, auth replay, budget concurrency, provider failures, publish/restore, and mobile usability.
- [ ] Technical design and operations instructions reflect the actual deployed implementation and remaining limitations.

## Proposed commercial model (draft; no checkout enabled)

| Plan | Monthly USD | Published sites | Monthly build units |
| --- | ---: | ---: | ---: |
| Explore | $0 | 1 | 25 |
| Launch | $12 | 3 | 250 |
| Studio | $29 | 10 | 800 |

One build unit covers 1,000 weighted model tokens: input tokens count once and output tokens count four times. Round up once per completed operation, not per internal model call. Read-only account/status tools and guided onboarding are free. This is a product allowance, not a promise of unlimited infrastructure. Final pricing needs measured provider and hosting costs before sale.

Proposed top-up: $5 for 100 credits, each covering one build unit after monthly quota. Monthly units reset each UTC calendar month and do not roll over. Purchased credits do not reset monthly. Credits cannot bypass storage, site count, abuse, or infrastructure safety limits. Domain registration/renewal is separately priced and never silently paid from build credits.

Reserve the maximum bounded cost before a model operation; settle actual usage afterward and release unused units. Use a unique operation ID and an append-only ledger with conditional atomic debits. A timeout with uncertain provider usage must remain reconcilable; never automatically retry a potentially billable call. Reject before calling the provider if funds are insufficient. The initial test remains free and does not collect payments or grant a paid entitlement from browser input.

## Provider interface

`src/ai.ts` supports server-configured OpenAI Chat Completions and Responses text transports. Endpoint, key, model, and protocol are operator configuration, never prompt-controlled. HTTPS only, redirects disabled, 60-second timeout, bounded response size, bounded output, and sanitized errors. The adapter requires usage accounting and rejects truncated/unsupported responses. Billing integration is implemented; tool dispatch remains pending.

The deployed OpenCode Go test uses base URL `https://opencode.ai/zen/go/v1`, the supplied Go API key stored as `AI_API_KEY`, and `muse-spark-1.3-contributor` via Responses. This uses the existing subscription explicitly authorized by the user. No upgrade or automatic fallback is enabled. Models using Anthropic Messages are outside this adapter's compatibility surface.

References checked September 29, 2026:
- https://developers.openai.com/api/docs/guides/migrate-to-responses
- https://opencode.ai/docs/go/#endpoints

## Deployment constraints

GitHub free features only; no paid Actions, packages, or LFS. Cloudflare uses the existing account's included allowance, with no upgrades or paid-only services. Invitations remain required. Product pricing is independent of permission to spend on infrastructure. Payment-provider selection and customer domain purchases will require explicit configuration before real transactions are enabled.

## Guided conversation milestone

The workspace now starts with persistent chat, compact project/live-site stats, and a secondary Details menu. Guided onboarding saves a brief, asks for a name, and creates a project. The conversation supports /new, /cancel, /projects, /activity, /plans, /usage, /domains, /connections, and /help. Domain and connection commands report their pending status honestly; they do not implement those integrations yet.

Migration 0003 adds owner-scoped workspace state and chat turns. Each request carries a UUID and expected revision. D1 batches atomically save the turn, advance onboarding, create a project, and append its audit event. Identical retries are idempotent; concurrent different turns return a conflict so the client can refresh. History displays the latest 100 turns; this test permits 2,000 turns per workspace.

Verified locally: onboarding resumes from the saved step, commands do not discard a brief, simultaneous retries create one project, conflicting tabs cannot overwrite each other, and another account cannot read the conversation. Browser verification covered login, chat onboarding, and project creation. Passkeys have since been delivered; the AI tool loop remains pending.

## Passkey milestone

Passkeys are now the default signup and sign-in method. The optional password flow preserves existing accounts and provides a fallback on unsupported devices. Registration requires a discoverable credential and user verification. SimpleWebAuthn validates the RP ID, origin, challenge, public key, signature, user-verification flag, and authenticator counter. A discoverable login also checks that the credential's user handle matches its owner.

Challenge tokens are random, hashed in D1, bound to a five-minute HttpOnly SameSite cookie, and atomically consumed before verification. Signup consumes the invitation and creates the user, passkey, and hashed recovery code in one transaction. Pending signup does not create a user. Recovery codes rotate on use and revoke prior sessions. Removing a passkey also revokes sessions atomically; a passkey-only account cannot remove its last credential. Security changes require a sign-in within ten minutes. `/security` or `/passkeys` opens the account security controls from chat.

Production RP ID is `digifender.com`; development uses `localhost` at port 8787. Passkeys are scoped to the RP domain. When choosing the final brand/domain, retain access to the old account origin and implement an authenticated migration/re-enrollment flow before retiring it. Do not assume existing passkeys will work on the new domain.

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

The separate `tellumo-sites` Worker serves only GET/HEAD `/s/PROJECT_ID` on `sites.digifender.com`; it has no AI/auth secrets and no workspace routes. Responses retain CSP sandbox, scripts/forms/network denial and no-store to make unpublication visible on the next request. It shares the existing D1 database via a binding; code limits reads to explicitly published versions, but the binding itself is not a database read-only role. Arbitrary customer scripts/backends are not supported by this serving boundary.

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

The files view is accessible through `/files`, “show photos”, or Details → Project photos. It uploads, lists and previews photos owned by the selected project without AI usage. Browser preparation resizes supported images; server validation strips JPEG metadata and bounds size/dimensions. D1 reservations and create-only R2 writes make retries safe. A private Standard R2 bucket and bounded cleanup job run on the existing account. See [photos.md](photos.md) for the exact API, quota, privacy and recovery contract. Page composition with photos, public photo serving, photo-aware exports and user-facing deletion are still required for the full MVP.
