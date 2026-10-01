# Stripe sandbox signup and billing

## Scope — October 1, 2026

The owner resumed Stripe **sandbox** work and supplied a working `sk_test_` key. A read of Stripe's balance endpoint confirmed `livemode: false`. This supersedes the earlier setup deferral for sandbox work only. Real payments remain disabled. The installed Stripe plugin does not currently expose callable tools in this chat; the integration uses Stripe's HTTPS API.

This slice adds optional test subscriptions to the final onboarding review and Billing settings: four existing plans, monthly or annual Checkout, paid invoice verification, renewal reconciliation, hosted invoices, payment method management and cancellation at period end. Explore remains available without a card. Onboarding still creates a private first project before Chat/dashboard access. Trial conversion, plan switches/proration, refunds/disputes and real-money launch are later WH-042 work.

## Authority and recovery contract

- Accept only test keys and objects; pin Stripe API `2025-02-24.acacia`, USD, server catalogue amounts, quantity one, fixed Whumpo return URLs and approved Stripe hosted destinations. No user-selected customer, price, return URL or entitlement values.
- Create a durable owner/customer and checkout intent before provider writes. Retry the same intent only inside the bounded idempotency window. Uncertain older writes remain held for operator reconciliation. A cancelled browser return is not proof of an expired Checkout session.
- One pending checkout per owner. Existing nonterminal subscriptions block another purchase. Customer ownership, session metadata, saved price, subscription and invoice relationships must all agree. Never infer ownership from email.
- Signed webhook payloads only supply identifiers. Retrieve provider state before acting. Duplicate or reordered deliveries add no additional entitlement. Authenticated Refresh can reconcile a missed event from saved checkout/customer identities.
- Paid invoices create immutable coverage for the exact **invoice line service interval**, not the invoice's accounting period or the return date. Annual coverage ends at its recorded anniversary; it does not manufacture a thirteenth calendar-month grant. Calendar-month grants are removed. Standard AI stays unlimited fair use with zero customer credit debits; sandbox subscriptions mint no advanced credits or resource-wallet funds.
- Coverage selects the highest current paid interval; an account without one uses Explore. Invalid plan identities fail explicitly. Existing published sites remain online; new publication uses the current plan. A failed renewal cannot extend coverage. End-of-period cancellation preserves the already-paid interval. Invoice history and account/export access remain available.
- Hosted customer portal permits payment method updates, invoice history and end-of-period cancellation only. Subscription changes, promotions, taxes, trials, automatic resource purchases and domain redemption are not activated.
- No raw webhook bodies, payment details, secret values or hosted session URLs in logs. Credentials stay in ignored operator files and platform Worker secrets, never customer-site Workers or model context.

## Provider references

Checked October 1, 2026: [sandbox isolation](https://docs.stripe.com/sandboxes), [hosted subscription Checkout](https://docs.stripe.com/billing/subscriptions/build-subscriptions?payment-ui=checkout&ui=stripe-hosted), [subscription webhooks](https://docs.stripe.com/billing/subscriptions/webhooks), [invoice service periods](https://docs.stripe.com/api/invoices/object?api-version=2025-02-24.acacia), and [portal configuration](https://docs.stripe.com/api/customer_portal/configurations/create). Sandbox transactions do not move real money. Real-money fees, tax, refunds, chargebacks, service grace and commercial terms require a separate launch review.

## Verification status

Implemented: migration 0114, subscription adapter, onboarding/Billing controls and setup helper. Configured: four sandbox products, eight recurring prices, restricted portal and webhook, plus three platform Worker secret bindings. No secret values are committed.

Local verification: `pnpm --config.verify-deps-before-run=false run check`, `pnpm --config.verify-deps-before-run=false run build`, and isolated `tests/subscriptions.mjs`, `checkout.mjs`, `billing.mjs`, `plan-periods.mjs`, `publications.mjs`, `fair-use-reviews.mjs`, `fair-use-finance.mjs`, `fair-use-observation.mjs` passed. The pnpm flag prevents an automatic dependency reinstall against the shared dependency directory; it does not skip the check/build scripts. Fixtures use disposable D1, synthetic users/providers and an allowlisted environment. No CMS functional tests ran.

Browser/provider pre-deployment check: at 390×844, onboarding retained the first-project review and an optional plan picker. Monthly/annual prices, explicit test labels and a real sandbox-hosted $17/month Checkout opened successfully. The crowded annual label was corrected and rebuilt. Deployed invoice/webhook acceptance is recorded below; opening Checkout alone was not treated as payment acceptance.

## Operational setup and bounded recovery

Run `node tools/stripe-sandbox.mjs SECRET_DIRECTORY --configure` with ignored `stripe-test.key`. It verifies test mode, retains stable resource identities in `stripe-setup.json`, saves `stripe-webhook.key` privately and writes `stripe-catalog.json`. Install the test key, signing secret and catalogue JSON as platform-only `STRIPE_TEST_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_SANDBOX_CATALOG`. A lost setup reply older than 20 hours requires inspection; the tool does not blindly create replacement resources.

Checkout expires after one hour. A saved open session can be refreshed to establish expiry; an unknown session/customer write beyond its bounded replay window requires operator reconciliation. Customer history above ten subscriptions requires operator review. Refresh recovers current/latest invoice coverage; arbitrary historical backfill is not implemented. Invoice history shows the most recent 24 verified paid invoices; the portal supplies Stripe's broader history, including unpaid invoices.

The current schema uses invoice-only coverage. The October 1 pre-release reset removes the old credit checkout, calendar grants, unit balances and metered request path. There are no old-Worker compatibility readers. Resource-wallet/advanced credit fulfillment and full financial reconciliation remain open under WH-042/043; this is not real-money launch readiness.


## Deployed sandbox acceptance — October 1, 2026

[PR #31](https://github.com/zemdregon/whumpo/pull/31) merged as `debc93c1ff4fdca4afce1c4686c24ab00d1b8fd2`. Managed release `fcb8723b-0e9d-4c2e-983c-8467128f8f38` archives implementation source `d414df9aef49f4e659d2cebee653c366fb02dc5e` and migration 0114. Independent readback at **13:30:04 UTC** confirmed all four candidate versions, 114 migrations and all 16 frontend assets. All secret/service-binding names and the unchanged CMS inventory reconciled. No CMS functional test or customer publication ran.

| Worker | Verified version |
| --- | --- |
| Platform | `52871209-4d03-4d2a-b23b-9877b779fb05` |
| Sites | `a28af5ce-07f0-4051-bec0-1d5445b2c5b3` |
| Apps | `f3c58fc7-1c66-4e71-aa01-069787e717f5` |
| Runtime | `f08fdadc-8fe0-43f5-9dd8-ed4206cc0909` |

A synthetic owner used the mobile welcome flow (name, default avatar, optional bio, project brief/name/audience/style) through the actual deployed APIs, with a temporary loopback browser harness supplying that fixture's authenticated session. The harness served the built frontend at 390×844; it did not expose a public authentication bypass or run a local server publicly. This verifies onboarding and billing after authentication, **not** a new real-device passkey/Turnstile registration or an authenticated same-browser cross-domain return.

- Deployed Checkout created a real Stripe **sandbox** Starter subscription at $17/month using the published 4242 test card and synthetic contact details. No real money moved.
- At **13:27:31 UTC**, before any refresh/reconciliation call, independent D1/provider reads found Checkout complete/paid, exactly one immutable paid invoice and an active subscription. This establishes actual Stripe-signed webhook fulfillment rather than browser-return authority.
- The paid account still received `409 onboarding_required` from Chat and had `onboardingComplete=false` until “Start my project.” After that action the private project and default Chat appeared. No AI call or customer publication occurred.
- Billing displayed the paid invoice and exact October 1–November 1 service dates. The hosted invoice showed **Invoice paid**, $17, and invoice/receipt download controls. The restricted portal showed invoice history, a test payment method and cancellation; no plan-switch control was present.
- Portal cancellation at period end propagated through Stripe's webhook to Whumpo. At **13:31:58 UTC**, the paid plan remained Starter, standard AI charge and credit balance were zero, and the invoice count remained one. The subscription will not renew. Only the synthetic Whumpo account/project/session were cleaned up; its post-cleanup authenticated request returned 401. Stripe retains the sandbox payment/invoice evidence.
- The earlier unused local-fixture Checkout was explicitly expired without a payment/subscription. Anonymous Billing/subscription reads return 401. `/api/plans` advertises subscriptions enabled with `checkoutMode=test`.

Private artifacts: `.secrets/stripe-release-verification.json`, `stripe-webhook-acceptance.json`, `stripe-cancellation-acceptance.json`, `stripe-mobile-billing.png` and the immutable release archive. The archive's dirty flag covers only the dependency symlink and inspected generated visitor dependency-path comments; implementation source was committed. Browser checks are narrow viewport emulation, not physical-device acceptance. Failed renewal, annual expiry, duplicates/out-of-order delivery and uncertain writes were verified with local synthetic providers; those are not claimed as additional real Stripe transactions.

The sandbox slice is deployed and accepted to this scope. WH-042 remains open for the remaining commercial lifecycle; real-money activation remains unavailable.
