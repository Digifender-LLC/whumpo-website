# Boundary test: in-app billing management

- **Task:** WH-004. Replaces the retired `billing-portal-customer` test when the hosted billing portal was replaced by in-app routes (decision D15 in [Stripe sandbox](../stripe-sandbox.md)).
- **Test:** `tests/boundary-billing-management.mjs` (`node tests/boundary-billing-management.mjs`, add `--d1` for local D1). Passes on local SQLite and local D1.
- **Audit cell:** `docs/boundary-audit.json`, family `billing-owner`, cell `authority`.

## What it exercises

It goes through the platform Worker's real default export (`src/index.ts`) with real fixture session cookies and the correct Origin, on `POST /api/billing/subscription/cancel`, `/resume`, `/retry`, `POST /api/billing/payment-method/setup`, `/complete` and `GET /api/billing/payment-method`. Global `fetch` is replaced by a recording Stripe stub. Stripe configuration values are built at runtime from obviously fake parts.

## What it proves

- **Foreign customer.** An owner with no `stripe_customers` row, or a row with a `NULL` customer id, gets `409 {"error":"Start a sandbox checkout first."}` from every mutating route and `{card:null}` from the card read. No Stripe request is made and no customer row is created, changed or borrowed.
- **Foreign subscription.** An owner with a customer but no subscription is refused from their own rows before any Stripe call. A subscription whose Stripe customer or `metadata.order` is not the caller's is refused, and no write is sent.
- **Foreign invoice.** The latest invoice of the caller's subscription, if it belongs to another customer or another subscription, is never paid.
- **Foreign setup session.** A completed setup session of another owner (customer, `metadata.owner`, or a payment method attached to another customer) never becomes the caller's default payment method; a non-test session id is a 400.
- **Negative control.** The owner of the objects completes the payment-method update and cancels at period end, and every Stripe write names only that owner's customer and subscription ids.

## What it does not prove

- Real Stripe behavior or response shapes; the stub is not Stripe.
- Concurrency with an in-flight checkout lease, or the freshness policy (R4: the `freshness` cell is `n/a`).
