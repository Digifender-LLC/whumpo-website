# WH-041 owner decisions (commercial terms)

Recorded as the owner answers through the ask app. A decision here is an owner choice, not an activation: checkout stays closed (`STRIPE_CHECKOUT_OPEN` unset), no real-money account, charge or plan change exists, and every behavior below still needs its own implementation and acceptance. WH-041 stays open until every row is answered and the tax and counsel items are reviewed.

| Id | Question | Owner answer | Date (UTC) | What it means for the code |
| --- | --- | --- | --- | --- |
| Q-29 (A) | Customer refund policy for paid plans | **No automatic refunds.** Cancellation takes effect at the paid period end (as implemented); a refund is at the owner's discretion through support. | 2026-11-01 | Nothing to build for proration or automatic refunds. A refund the owner issues in Stripe arrives as `charge.refunded`; a full refund voids the invoice coverage (WH-042, `stripe_invoice_voids`, merged in #580). Partial refunds keep access. Pro-rata refunds are not planned. |
| Q-30 (B) | Paid access after a failed renewal | **7 days.** Reading, export and existing published sites stay up; no new expensive work. | 2026-11-01 | Replaces "no grace is approved" for the failed-renewal case only. Grace has no persistence or wiring yet: the live `plan_entitlements` view has no failure signal, and `src/entitlement-facts.ts` (unwired) models the 7-day window. Needs a stored payment-failure fact (a schema change) before it can apply. Cancelled subscriptions get no grace. |
| Q-31 (C) | Lost card dispute | Open. Proposed: void coverage and flag the account for support review. | | Voiding is implemented (#580). |
| Q-32 (D) | Sales tax before real money | Open. Proposed: keep checkout closed until a qualified accountant reviews tax; then decide on Stripe Tax. | | No tax configuration exists or is changed. |
| Q-33 (E) | Top-up ($10 / 1,000 units) and monthly rollover for the first beta | Open. Proposed: defer both until two measured cost periods (WH-023). | | `src/capacity-ledger.ts` stays unwired with synthetic terms. |
