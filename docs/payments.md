# Stripe test checkout

Current launch catalogue and model-cost policy: [pricing-and-model-policy.md](pricing-and-model-policy.md). Launch/Studio references below describe legacy test entitlements.

Status: implemented credit-pack checkout foundation, disabled on the deployment. The owner has no Stripe account and chose to defer connecting one. No account was created and no real payment or Stripe API request was made. Paid subscriptions remain unavailable.

## Credit orders

`POST /api/billing/checkout` requires an authenticated same-origin request containing a UUID and the single product `credits-100`. Amount (500 US cents), currency and units (100) come from the server. No caller-provided prices, return URLs or entitlement values are accepted. An immutable D1 order is created before contacting Stripe. Concurrent/retried requests use one Stripe idempotency key; saved sessions are retrieved, not recreated. Orders expire in one hour, safely before Stripe can discard its idempotency record. Limits are five new orders per rolling day and 100 per test account.

The browser opens a verified `https://checkout.stripe.com` URL. Returning to the workspace never grants credit. Usage can be refreshed to see webhook-confirmed balances. Test credits fund real model requests in this test platform; overage spending remains separately opt-in.

## Webhook authority

`POST /api/stripe/webhook` intentionally bypasses browser Origin/session checks. It instead requires a valid HMAC-SHA256 signature over the bounded, unchanged request body and a timestamp within five minutes. Signature checks use Web Crypto verification, including multiple v1 signatures during rotation. The event and retrieved session must both be in test mode.

For checkout completion/payment-success events, retrieve the authoritative session from Stripe. It must match the saved order, fixed amount, USD currency and payment mode; it must be complete and paid. A single D1 batch inserts a uniquely identified credit grant and marks the order fulfilled. The existing grant trigger updates balance and immutable ledger. Replayed events, concurrent delivery and lost commit acknowledgements cannot add credits twice. A webhook can fulfill an order even when the initial Stripe session reply was lost. Unknown orders and deleted accounts are acknowledged without grants. No webhook body or credentials are logged.

Network calls go only to the fixed Stripe API origin, do not follow redirects, time out after 15 seconds, and bound response bytes. API version is pinned to `2025-02-24.acacia`.

## Deferred connection

When the owner chooses to connect Stripe, install `STRIPE_TEST_KEY` and `STRIPE_WEBHOOK_SECRET` as workspace Worker secrets using Wrangler. Only `sk_test_` credentials are accepted; live keys leave checkout disabled. The webhook endpoint will be `https://digifender.com/api/stripe/webhook`, listening for `checkout.session.completed` and `checkout.session.async_payment_succeeded` in test mode. Store operator files under ignored `.secrets/`. Do not put payment secrets on the public-site Worker.

Run a real Stripe test checkout and webhook delivery before claiming this integration is connected. Current validation uses synthetic signed events and disposable D1, including failed signatures, stale/future timestamps, unpaid/live sessions, incorrect amounts, cross-owner IDs, concurrent requests, duplicate events, lost provider/database acknowledgements and API gates.

## Subscription work still required

Plans require a server-owned customer/subscription mapping, a unique active subscription per account, invoice-paid fulfillment, renewal failure/cancellation handling, authenticated management links and reconciliation after missed/out-of-order events. Month-based model allowances currently reset on the first UTC day; define proration and billing-period alignment before enabling paid plan changes. Never grant a plan merely because Checkout returned successfully. Refund/reversal policy and a tested transition from test balances to any future real-money environment also remain required. This foundation intentionally cannot switch to live payments through a key change.

References: [Checkout session creation](https://docs.stripe.com/api/checkout/sessions/create), [webhook signature verification](https://docs.stripe.com/webhooks/signature), [test credentials](https://docs.stripe.com/api/authentication).

## Monthly entitlement implementation

The internal [plan lifecycle](plan-lifecycle.md) now records immutable, month-specific paid entitlement receipts. Upgrades preserve spent/reserved units and credits; unconfirmed renewals do not perpetuate paid limits. Current-month receipts also authorize new publication slots. There is no public plan-grant endpoint and no paid subscription checkout. The Stripe subscription adapter and lifecycle tasks above remain unfinished.
