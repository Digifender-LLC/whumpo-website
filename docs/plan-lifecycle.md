# Current plan coverage

**October 1, 2026.** Explore is the free testing plan when there is no active paid invoice coverage. Starter, Creator (`personal` is its current stored ID), Business and Business Pro are the only paid plans. Their prices and feature packaging are defined in [the shared catalogue](plan-feature-contract.md).

`plan_entitlements` contains only verified `stripe_paid_invoices` intervals. Coverage starts inclusively and ends exclusively, in Unix seconds. Overlapping current receipts select the highest tier. Missing coverage selects Explore; an unrecognized or retired plan raises a billing error. Draft capacity preferences grant no entitlement.

Launch, Studio, calendar-month plan grants, cached account plan IDs and monthly test-unit allowances are removed. The pre-release schema reset deletes their disposable data. There is no compatibility reader, translation or substitute paid plan.

Current paid invoice records remain immutable and tenant-scoped. Stripe renewal, failed payment, cancellation and annual boundaries use the same [sandbox subscription contract](stripe-sandbox.md). Subscription coverage does not mint resource or advanced-model credits.

## Publication limits

The confirmation transaction checks owned current revisions, exact saved versions, expiry and the current paid coverage. Explore and Starter allow one published site; Creator five; Business ten; Business Pro twenty-five. Existing published sites remain editable if coverage expires; a new publication cannot exceed the current limit. This is the current publication policy, independent of billing history.

## Verification

`tests/plan-periods.mjs` checks paid service intervals, tier ordering, expiry, preference non-authority, publication limits and current domain quote policy. `tests/subscriptions.mjs` verifies actual adapter behavior with a synthetic Stripe transport. `tests/billing.mjs` checks retired and unknown identities explicitly. See [current-only acceptance](current-version-policy.md) for source/deployment status.

A fully refunded charge or a dispute closed as lost voids the invoice it settled (WH-042, `stripe_invoice_voids`): the invoice row is never edited, a compensating row ends its coverage and `plan_entitlements` skips it. Partial refunds and open disputes change nothing yet. Delivery order does not matter: a refund or lost dispute that arrives before its invoice was recorded reads that invoice through the same verified path as `invoice.paid` and records it together with its void in one batch, so no later event or Refresh grants it; a returned payment for an invoice of ours that is not paid throws 409 so the provider retries. A refund or loss whose event is never delivered is not yet reconciled by Refresh. Source and synthetic tests only, schema group C4 not cut over; the Stripe response shapes are not verified against the pinned API version.
