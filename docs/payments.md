# Payments

**Current contract — October 1, 2026.** Whumpo runs only in testing environments. Optional Stripe sandbox subscriptions are the single payment path; see [Stripe sandbox signup and billing](stripe-sandbox.md). Real payments remain disabled.

## Current authority

Checkout uses the four current paid plans, fixed catalogue prices and monthly/annual intervals. Signed webhook identifiers are resolved against authoritative Stripe objects and the saved owner/customer/order relationships. Verified paid invoice service intervals supply plan coverage. Browser return parameters never grant a plan.

The shared webhook requires a bounded, unmodified body, valid HMAC signature, timestamp within five minutes and test-mode event. A missing current subscription catalogue fails explicitly. Unrelated or retired payment-mode checkout events are acknowledged without database fulfillment; there is no alternate credit handler.

## Retired test billing removed

`POST /api/billing/checkout`, `POST /api/billing/preferences`, the `credits-100` pack, legacy catalogue fields, test-credit grants/holds/history and the old waiver tool are removed. The current Billing screen exposes subscription management and standard AI request status. [Standard assistance](standard-ai-accounting.md) incurs no customer credit charges. Future advanced-model credits require their own approved contract; old test packs cannot be reused as that currency.

The current-schema reset drops the obsolete tables and test rows. It does not copy or interpret old records. Fresh local schemas and the deployed test schema must match; old Workers are unsupported. [Current-only policy](current-version-policy.md) and [release procedure](releases.md) govern this cutover.

## Verification

`tests/checkout.mjs` checks signed payload bounds, signature age/rotation, test mode, current-catalogue failure and retired-event nonfulfillment. `tests/billing.mjs` checks the populated test reset, retired route/plan rejection and invoice-only coverage. `tests/subscriptions.mjs` covers subscription ownership, provider reconciliation, invoice intervals, replay, failed renewal and uncertain writes. These fixtures use no real charges or live provider calls. Deployment evidence is recorded separately.
