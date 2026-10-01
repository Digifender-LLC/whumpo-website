# Stripe test checkout

Current launch catalogue and model-cost policy: [pricing-and-model-policy.md](pricing-and-model-policy.md). Launch/Studio references below describe legacy test entitlements.

Status — October 1, 2026: the owner resumed Stripe sandbox work and supplied a verified test key. Optional subscription signup, paid invoices and management are implemented in [the sandbox adapter](stripe-sandbox.md); that document records configuration/deployment/acceptance separately. No real payments are enabled. The legacy credit-pack path below remains for historical tests and is not offered as advanced-model credit purchasing.

## Credit orders

`POST /api/billing/checkout` requires an authenticated same-origin request containing a UUID and the single product `credits-100`. Amount (500 US cents), currency and units (100) come from the server. No caller-provided prices, return URLs or entitlement values are accepted. An immutable D1 order is created before contacting Stripe. Concurrent/retried requests use one Stripe idempotency key; saved sessions are retrieved, not recreated. Orders expire in one hour, safely before Stripe can discard its idempotency record. Limits are five new orders per rolling day and 100 per test account.

The browser opens a verified `https://checkout.stripe.com` URL. Returning to the workspace never grants credit. Usage can be refreshed to see webhook-confirmed balances. Historical test credits settle older reservations; new standard AI costs zero customer credits. Overage opt-in does not authorize premium dispatch.

## Webhook authority

`POST /api/stripe/webhook` intentionally bypasses browser Origin/session checks. It instead requires a valid HMAC-SHA256 signature over the bounded, unchanged request body and a timestamp within five minutes. Signature checks use Web Crypto verification, including multiple v1 signatures during rotation. The event and retrieved session must both be in test mode.

For checkout completion/payment-success events, retrieve the authoritative session from Stripe. It must match the saved order, fixed amount, USD currency and payment mode; it must be complete and paid. A single D1 batch inserts a uniquely identified credit grant and marks the order fulfilled. The existing grant trigger updates balance and immutable ledger. Replayed events, concurrent delivery and lost commit acknowledgements cannot add credits twice. A webhook can fulfill an order even when the initial Stripe session reply was lost. Unknown orders and deleted accounts are acknowledged without grants. No webhook body or credentials are logged.

Network calls go only to the fixed Stripe API origin, do not follow redirects, time out after 15 seconds, and bound response bytes. API version is pinned to `2025-02-24.acacia`.

## Sandbox configuration

For the owner-authorized sandbox, install `STRIPE_TEST_KEY` and `STRIPE_WEBHOOK_SECRET` as workspace Worker secrets using Wrangler. Only `sk_test_` credentials are accepted; live keys leave checkout disabled. The webhook endpoint will be `https://whumpo.com/api/stripe/webhook`, listening for `checkout.session.completed` and `checkout.session.async_payment_succeeded` in test mode. Store operator files under ignored `.secrets/`. Do not put payment secrets on the public-site Worker.

Run a real Stripe test checkout and webhook delivery before claiming this integration is connected. Current validation uses synthetic signed events and disposable D1, including failed signatures, stale/future timestamps, unpaid/live sessions, incorrect amounts, cross-owner IDs, concurrent requests, duplicate events, lost provider/database acknowledgements and API gates.

## Historical foundation and remaining commercial work

The sandbox adapter now implements customer/subscription mappings, monthly/annual Checkout, paid invoice service-interval coverage, failed renewal/cancellation state, authenticated portal links and latest-invoice reconciliation. Refunds/disputes, plan changes/proration, production grace and financial cost/fee/tax evidence remain required before real payments. A key change cannot switch this foundation to live billing.

References: [Checkout session creation](https://docs.stripe.com/api/checkout/sessions/create), [webhook signature verification](https://docs.stripe.com/webhooks/signature), [test credentials](https://docs.stripe.com/api/authentication).

## Monthly entitlement implementation

The internal [plan lifecycle](plan-lifecycle.md) now records immutable, month-specific paid entitlement receipts. Upgrades preserve spent/reserved units and credits; unconfirmed renewals do not perpetuate paid limits. Current-month receipts also authorize new publication slots. There is no public plan-grant endpoint. Sandbox subscriptions use separate exact service-interval invoice receipts; historical unit grants remain unchanged.

## Request-level preview usage history — September 30, 2026

`/usage-history [PAGE]`, “show usage history”, and “show my usage history” list the authenticated customer's recorded AI usage requests without inference. `/usage` and `/help billing` explain the command. Billing & usage shows the ten latest requests with dates, state, separate monthly-unit/credit charges or holds, expandable request IDs, and a Chat entry for the full paginated list. Balance-change entries remain a separate section.

Completed requests report settled amounts, released requests report zero charge, and reserved/dispatched/uncertain requests show outstanding holds rather than asserting a final charge. The screen explicitly describes preview build units/test credits, not dollar costs or premium-model prices. It does not implement or advertise unlimited paid-plan entitlements; the active preview ledger and planned fair-use/premium-funding policies remain distinct.

History reads are owner-scoped and omit request fingerprints, prompts, answers, tokens and credentials. They do not initialize a billing account, reserve spending, retry inference or release unresolved operations. The existing billing API includes the first 20 records. Chat supports 20 records per page, newest first with a deterministic ID tie-break, up to 1,000 pages; the final page explicitly reports truncation instead of offering an invalid next page. Pages reflect current saved state, not a frozen multi-page snapshot. Read-only history itself makes no changes; ordinary Chat receipt persistence and billing reconciliation retain their existing behavior.

Verification: `pnpm check`, `pnpm test:usage-history`, `pnpm test:usage-history-ui`, `pnpm build` and diff checks passed. Disposable D1 coverage exercises all request states, mixed monthly/credit settlement, privacy/owner boundaries, deterministic pagination and final-page truncation, invalid arguments, no billing initialization from direct history reads, and free guided Chat/replay with AI configured. History reads preserve balances and operation counts. React server-rendering checks cover charge/hold/release wording, request details, the empty state and the Chat entry. The isolated release passed both TypeScript projects, build and frontend loading checks. A remote read-only query for an unused identity returned no records. Physical-device interaction and real payment acceptance remain unverified.

Released to test as platform `a680be51-5e1f-4232-aaf5-b7ddf5b31098`. Independent active-version readback, landing entry and all 18 live JS/CSS/font assets matched the isolated release; health returned 200 and anonymous billing/Chat reads returned 401. No migration, entitlement grant, payment or model dispatch was performed for release acceptance.

## Preview allowance clarity and preference synchronization — September 30, 2026

Billing now labels the current balance as monthly test units, explains UTC resets and non-rollover, and distinguishes preview units from money and future paid-plan limits. A zero available balance distinguishes pending holds from spent usage, explains whether existing credits are available/enabled, and offers the free Chat help controls. A positive balance is not a promise that another request's reservation will fit.

The existing-credit preference explains that it never purchases credit or charges a payment method, and that disabling it affects new requests while existing holds may still settle. The control uses the server-returned billing result after saving and refreshes Chat/dashboard data. Successful Chat requests invalidate cached Billing data, including changes made with `/credits on` and `/credits off`, so returning immediately does not retain the previous preference for the cache freshness window. No ledger, reservation, checkout or entitlement behavior changed.

Verification: `pnpm check` and `pnpm test:usage-history-ui` passed. The isolated release passed the frontend TypeScript check, production build and `node tests/frontend-loading.mjs`. Deployed test version `7e8c405e-1d78-450e-bdab-ab26f412343b`; independent readback confirmed that version, all 16 frontend JS/CSS/font assets matched, health returned 200, and anonymous Billing/Chat returned 401. No authenticated live balance was changed and no payment was performed. The updated interactions were not tested on a physical mobile device.
