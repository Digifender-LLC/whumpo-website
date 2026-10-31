# Domain purchase operator runbook (WH-197 slice)

**Status: synthetic level. Written October 31, 2026 UTC against the synthetic registrar; nothing here has been run against a real registrar, a Stripe sandbox or a real domain.** There is no registrar adapter (WH-195), no payment hold (WH-042 extension) and no route or Chat card that creates an order, so today an unresolved order cannot exist outside a test. The runbook exists so that the first connected run (WH-197 V1, owner-approved sandbox credentials) starts from a written procedure, and so a reviewer can check that the storage in [domain-purchases.md](domain-purchases.md) leaves an operator something safe to do. Evidence levels are kept apart: **synthetic** (this document and `tests/domain-purchase-journey.mjs`), **sandbox** (not run), **live** (not run, and not allowed before WH-198).

## The one rule

An order that may have reached the registrar is never sent again. There is no retry, no bulk redispatch and no operator action that calls the registrar's purchase call. Every way out is evidence: a read-only lookup, or an event the adapter authenticated. If you cannot show which of the two happened, the order stays as it is and the funding hold stays held.

## Reading the state

All reads are owner-scoped in the product. An operator reads with a restricted, audited diagnostic query; nothing below edits a row.

| State | Meaning | What to do |
| --- | --- | --- |
| `reserved` | Hold placed, registrar not asked. | Nothing. It expires with its quote, or the owner cancels. A reserved order older than its quote expiry is released by the next dispatch or sweep. |
| `dispatching` older than 60 seconds | A worker claimed it and may have called the registrar, then stopped. | Wait for the lease sweep (`sweepLeases`); it moves the order to `unknown-outcome` once. Never reset it. |
| `unknown-outcome` | The purchase may have happened. Hold kept. | Wait for bounded reconciliation: at most three read-only lookups within 72 hours (`reconcileUnknown`). A registration naming this order ends it as `registered`; this order's failed workflow, or the name held by someone else, ends it as `failed`. "Not found" and "in progress" prove nothing. |
| `unresolved` | The bound ran out with no evidence. Hold kept; the account cannot be purged; closure waits. | Obtain evidence outside Whumpo (the registrar's order record for the client reference equal to the order ID). Apply it only as an authenticated registrar event (`receiveRegistrarEvent`: `registered` or `failed`, naming the current attempt). Duplicates and stale attempts are ignored by design. |
| `registered` | Registrar evidence names this order. Hold captured. | Nothing. Check the charge mismatch flag below. |
| `failed`, `cancelled`, `expired` | Settled before or without a purchase. Hold released. | Nothing. |

## Unresolved orders

1. Read the order, its single attempt row and its events. There is exactly one attempt row per order (`UNIQUE(order_id)`); if a second ever appears the schema was bypassed, which is an incident, not a procedure.
2. Ask the registrar, through its own console or API with its own credentials, for the order with client reference equal to the order ID, and for the name itself. Do not use Whumpo to ask again.
3. If the registrar shows the registration for this order: record it as an authenticated `registered` event. The hold is captured and the registration row is written by the same statement. Auto-renew is off.
4. If the registrar shows a failed workflow for this order, or the name held by someone else: record an authenticated `failed` event. The hold is released and the name is free to order again.
5. If the registrar shows nothing and you cannot tell whether the call was ever made, do nothing and record why. A wrong `failed` can lead to a second purchase; a late `registered` after a `failed` is ignored, so be sure.

## Charge mismatches

`domain_registrations.charge_mismatch = 1` means the registrar's charged wholesale differs from the quoted wholesale. The customer was never charged more than the consented total (the hold is for exactly that amount). Compare the registrar invoice with the stored quote, record the difference for the finance review (WH-198), and do not adjust the order or the hold. A refund or credit is a payments action under WH-042 and counsel, not an edit.

## Held funds without a live order

A `held` hold whose order is not `reserved`, `dispatching`, `unknown-outcome` or `unresolved` should not exist (the order's own transition settles it). If one is found, stop and treat it as an incident; do not release it by hand.

## Transfer-out and renewal

- A transfer request in `unknown-outcome` means the unlock may have been sent. Reconcile by reading (`reconcileTransfers`): the registrar's own lock report decides. Never send the unlock again for the same request.
- The authorization code is never copied into a ticket, a chat, a log or a model. It is shown only to the owner, read from the registrar at that moment. If an owner reports a lost code, they ask again in the product; that is a read.
- A renewal approval is the only record that lets a renewal be charged. If a renewal charge is ever reported without an approval row covering its price, stop the charger and open an incident.

## What never to do

- Edit a state, version, hold, attempt or event row, or delete an order, hold or active registration.
- Call the registrar's purchase or unlock call by hand for an order or request that already has an attempt.
- Paste a registrar credential, an authorization code or registrant contact into Chat, a model prompt, a log or GitHub.
- Run any of this against a real registrar or Stripe live key before WH-198 (counsel and money items) and WH-197 V1.
