# Boundary test: billing portal without a Stripe customer

- **Task:** WH-004 (P0), next slice. Written on 2026-10-20 against worktree HEAD `d2c79b779cafbb6cbac1d623c04dc63d5218cca4`.
- **Audit cell:** `docs/boundary-audit.json`, family `billing-owner`, cell `authority`. Its remark says: "No test calls the portal for an owner without a customer (code returns 409)." No existing test under `tests/` cites this branch. `tests/subscriptions.mjs` calls `billingPortal` only for an owner who has a customer, and checks only the 403/401 HTTP gates for the route.
- **Test:** `tests/boundary-billing-portal-customer.mjs` (`node tests/boundary-billing-portal-customer.mjs`, add `--d1` for local D1).
- **Status: not run.** Bash was denied in the session that wrote it, so the test is unverified until someone runs it.

## What it exercises

It goes through `POST /api/billing/portal` on the platform Worker's real default export (`src/index.ts`) with a real fixture session cookie and the correct Origin. It also calls `billingPortal` (`src/stripe-billing.ts`) directly. Global `fetch` is replaced by a recording Stripe stub that answers only `billing_portal/sessions`. Stripe configuration values are built at runtime from obviously fake parts.

## What it proves

- An owner with **no `stripe_customers` row** gets `409 {"error":"Start a sandbox checkout first."}`. This holds while another owner has a customer.
- An owner whose row has a **`NULL` `customer_id`** (a checkout was started but the provider customer was never created) gets the same 409.
- In both cases the function-level call rejects with the same status and message, **no Stripe request** is made, and the `stripe_customers` table is unchanged. No customer is created, and none is borrowed from another owner.
- **Negative control:** the owner with a customer gets 200 and a `billing.stripe.com` URL. Exactly one portal session is opened, and it names that owner's own customer id. This happens both before and after the refusals.

## What it does not prove

- Real Stripe behaviour, portal configuration validity or live-mode handling. The stub is not Stripe.
- The `requireMatch` 409 path when Stripe returns a session for a different customer or configuration, and the `hostedURL` 502 path. Neither is exercised.
- Whether the portal should require recent authentication. That is the separate policy question R4, and the `freshness` cell is `n/a`.
- Concurrency with an in-flight checkout lease, and anything about the other billing routes.

`docs/boundary-audit.json` was not edited. If the test passes, the controller can add it to the `billing-owner` → `authority` cell's `tests` list.
