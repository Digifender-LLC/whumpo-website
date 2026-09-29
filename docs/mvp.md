# Whumpo MVP delivery contract

The public homepage advertises the product. The signed-in default is a conversation, with only compact service and usage stats. Account, domain, billing, and project details live in a secondary menu. This checklist preserves the full MVP scope; an unchecked item is not delivered.

## Acceptance checklist

- [x] Public landing page and separate invitation-only workspace deployed at digifender.com.
- [x] Owner-scoped project records, session authentication, activity history, and account/project limits.
- [ ] Passkeys are the default signup/login method, with single-use browser-bound challenges, user verification, credential management, and recovery.
- [ ] Conversational onboarding collects the customer's idea and preferences, resumes after interruption, and clearly identifies guided mode until a model is configured.
- [x] Persistent chat is the default workspace; owner-scoped history and minimal service/usage stats survive reloads.
- [ ] OpenAI-compatible server adapter integrated with chat, with OpenCode Go configuration and verified live provider test when credentials are supplied.
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

`src/ai.ts` supports server-configured OpenAI Chat Completions and Responses text transports. Endpoint, key, model, and protocol are operator configuration, never prompt-controlled. HTTPS only, redirects disabled, 30-second timeout, bounded response size, bounded output, and sanitized errors. The adapter requires usage accounting and rejects truncated/unsupported responses. Tool dispatch and billing integration remain pending.

For later OpenCode Go testing use base URL `https://opencode.ai/zen/go/v1`, a Go API key stored as a Worker secret, and a model supported by the chosen protocol. Model availability varies; no subscription or paid call has been initiated. Models using Anthropic Messages are outside this adapter's compatibility surface.

References checked September 29, 2026:
- https://developers.openai.com/api/docs/guides/migrate-to-responses
- https://opencode.ai/docs/go/#endpoints

## Deployment constraints

GitHub free features only; no paid Actions, packages, or LFS. Cloudflare uses the existing account's included allowance, with no upgrades or paid-only services. Invitations remain required. Product pricing is independent of permission to spend on infrastructure. Payment-provider selection and customer domain purchases will require explicit configuration before real transactions are enabled.

## Guided conversation milestone

The workspace now starts with persistent chat, compact project/live-site stats, and a secondary Details menu. Guided onboarding saves a brief, asks for a name, and creates a project. The conversation supports /new, /cancel, /projects, /activity, /plans, /usage, /domains, /connections, and /help. Domain and connection commands report their pending status honestly; they do not implement those integrations yet.

Migration 0003 adds owner-scoped workspace state and chat turns. Each request carries a UUID and expected revision. D1 batches atomically save the turn, advance onboarding, create a project, and append its audit event. Identical retries are idempotent; concurrent different turns return a conflict so the client can refresh. History displays the latest 100 turns; this test permits 2,000 turns per workspace.

Verified locally: onboarding resumes from the saved step, commands do not discard a brief, simultaneous retries create one project, conflicting tabs cannot overwrite each other, and another account cannot read the conversation. Browser verification covered login, chat onboarding, and project creation. Passkeys and the AI tool loop remain pending.
