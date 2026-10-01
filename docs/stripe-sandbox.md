# Stripe sandbox signup and billing

## Scope — October 1, 2026

The owner resumed Stripe **sandbox** work and supplied a working `sk_test_` key. A read of Stripe's balance endpoint confirmed `livemode: false`. This supersedes the earlier setup deferral for sandbox work only. Real payments remain disabled. The installed Stripe plugin does not currently expose callable tools in this chat; the integration uses Stripe's HTTPS API.

This slice adds optional test subscriptions to the final onboarding review and Billing settings: four existing plans, monthly or annual Checkout, paid invoice verification, renewal reconciliation, hosted invoices, payment method management and cancellation at period end. Explore remains available without a card. Onboarding still creates a private first project before Chat/dashboard access. Trial conversion, plan switches/proration, refunds/disputes and real-money launch are later WH-042 work.

## Authority and recovery contract

- Accept only test keys and objects; pin Stripe API `2025-02-24.acacia`, USD, server catalogue amounts, quantity one, fixed Whumpo return URLs and approved Stripe hosted destinations. No user-selected customer, price, return URL or entitlement values.
- Create a durable owner/customer and checkout intent before provider writes. Retry the same intent only inside the bounded idempotency window. Uncertain older writes remain held for operator reconciliation. A cancelled browser return is not proof of an expired Checkout session.
- One pending checkout per owner. Existing nonterminal subscriptions block another purchase. Customer ownership, session metadata, saved price, subscription and invoice relationships must all agree. Never infer ownership from email.
- Signed webhook payloads only supply identifiers. Retrieve provider state before acting. Duplicate or reordered deliveries add no additional entitlement. Authenticated Refresh can reconcile a missed event from saved checkout/customer identities.
- Paid invoices create immutable coverage for the exact **invoice line service interval**, not the invoice's accounting period or the return date. Annual coverage ends at its recorded anniversary; it does not manufacture a thirteenth calendar-month grant. Legacy calendar-month grants remain intact. Standard AI stays unlimited fair use with zero customer credit debits; sandbox subscriptions mint no advanced credits or resource-wallet funds.
- Expired coverage falls back to any other valid receipt, then Explore. Existing published sites remain online; new publication uses the current plan. A failed renewal cannot extend coverage. End-of-period cancellation preserves the already-paid interval. Invoice history and account/export access remain available.
- Hosted customer portal permits payment method updates, invoice history and end-of-period cancellation only. Subscription changes, promotions, taxes, trials, automatic resource purchases and domain redemption are not activated.
- No raw webhook bodies, payment details, secret values or hosted session URLs in logs. Credentials stay in ignored operator files and platform Worker secrets, never customer-site Workers or model context.

## Provider references

Checked October 1, 2026: [sandbox isolation](https://docs.stripe.com/sandboxes), [hosted subscription Checkout](https://docs.stripe.com/billing/subscriptions/build-subscriptions?payment-ui=checkout&ui=stripe-hosted), [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [invoice service periods](https://docs.stripe.com/api/invoices/object?api-version=2025-02-24.acacia), and [portal configuration](https://docs.stripe.com/api/customer_portal/configurations/create). Sandbox transactions do not move real money. Real-money fees, tax, refunds, chargebacks, service grace and commercial terms require a separate launch review.

## Verification status

Implemented: migration 0114, subscription adapter, onboarding/Billing controls and setup helper. Configured: four sandbox products, eight recurring prices, restricted portal and webhook, plus three platform Worker secret bindings. No secret values are committed.

Local verification: `pnpm --config.verify-deps-before-run=false run check`, `pnpm --config.verify-deps-before-run=false run build`, and isolated `tests/subscriptions.mjs`, `checkout.mjs`, `billing.mjs`, `plan-periods.mjs`, `publications.mjs`, `fair-use-reviews.mjs`, `fair-use-finance.mjs`, `fair-use-observation.mjs` passed. The pnpm flag prevents an automatic dependency reinstall against the shared dependency directory; it does not skip the check/build scripts. Fixtures use disposable D1, synthetic users/providers and an allowlisted environment. No CMS functional tests ran.

Browser/provider pre-deployment check: at 390×844, onboarding retained the first-project review and an optional plan picker. Monthly/annual prices, explicit test labels and a real sandbox-hosted $17/month Checkout opened successfully. The crowded annual label was corrected and rebuilt. Deployed invoice/webhook acceptance remains to be recorded; opening Checkout alone is not payment acceptance.

## Operational setup and bounded recovery

Run `node tools/stripe-sandbox.mjs SECRET_DIRECTORY --configure` with ignored `stripe-test.key`. It verifies test mode, retains stable resource identities in `stripe-setup.json`, saves `stripe-webhook.key` privately and writes `stripe-catalog.json`. Install the test key, signing secret and catalogue JSON as platform-only `STRIPE_TEST_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SANDBOX_CATALOG`. A lost setup reply older than 20 hours requires inspection; the tool does not blindly create replacement resources.

Checkout expires after one hour. A saved open session can be refreshed to establish expiry; an unknown session/customer write beyond its bounded replay window requires operator reconciliation. Customer history above ten subscriptions requires operator review. Refresh recovers current/latest invoice coverage; arbitrary historical backfill is not implemented. Invoice history shows the most recent 24 verified paid invoices; the portal supplies Stripe's broader history, including unpaid invoices.

Migration 0114 adds four tables and a combined entitlement view. It replaces the publication slot trigger with the same ownership/revision/expiry checks and exact coverage lookup. Existing receipts, ledgers and balances are unchanged. Old Workers can run with the new schema; before the new platform deploys they continue selecting legacy plans, while the database can recognize paid coverage. New subscription checkout is absent from those old Workers. Other Worker service contracts/bindings remain unchanged.

Sandbox plan coverage does not replenish historical unit balances. Those balances are unrelated to standard AI and remain labeled historical. Resource-wallet/advanced credit fulfillment and full financial reconciliation remain open under WH-042/043; this slice must not be presented as real-money launch readiness.
