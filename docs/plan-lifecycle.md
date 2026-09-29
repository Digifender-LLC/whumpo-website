# Monthly plan entitlements

## Implemented fulfillment boundary; checkout still disabled

`grantPlan` is an internal fulfillment function, not an HTTP endpoint or model action. It accepts only Launch or Studio and a specific UTC calendar month. A future payment adapter must establish the paid invoice, customer ownership, calendar period and product before calling it. The platform has no Stripe account configured, does not sell subscriptions, and has made no real subscription charge. This implementation alone is not a subscription system.

A unique grant ID and globally unique payment/reference ID identify an immutable receipt. Identical retries recover the same result; changes to owner, plan, month or reference are rejected. The receipt, existing-period allowance adjustment and ledger entry commit in one SQLite statement/trigger transaction. A lost acknowledgement is recovered by reading the exact receipt. A browser redirect, cached account plan or model output cannot create an entitlement.

## Monthly behavior

Explore supplies 50 units in each UTC month. A confirmed Launch receipt supplies 250 units for its specified month, and Studio supplies 800. The highest confirmed tier in a month wins. Receiving the same or a lower tier later does not reset usage or add a second allowance. Upgrading changes the allowance ceiling, preserving spent units, reservations and credit balances. For example, moving from Launch to Studio after using 40 units leaves 760 monthly units, not a fresh 800.

An invoice/renewal must grant each new paid month explicitly. Without a grant for the next month, that month uses Explore. A downgrade can take effect by granting the lower tier for the next month. The current month's paid entitlement is preserved. Current-month refunds, entitlement revocation, proration, renewal grace periods and payment dispute policy are not implemented and must be settled before subscriptions are enabled. No automatic plan-cancellation or billing-provider action is implied by the absence of a grant.

Credits remain a separate balance and do not expire at the month boundary. Explicit overage opt-in still governs new operations. Already dispatched or uncertain operations retain their original month and reservation; settling them after a rollover does not debit the new month's allowance. Merely receiving a future-month grant does not run future-dated reservation expiry or alter the current month.

If an entitlement arrives before that month's first use, creating its usage period grants the correct allowance once. If it arrives after period creation, the trigger raises the existing allowance by the difference and records only that delta. Catalog amounts are currently fixed in the catalogue and migrations; changing them requires an explicit versioned entitlement/migration design, not editing one constant in isolation.

## Published sites after a downgrade

Publication confirmation reads current-month receipts directly: Explore allows one site, Launch three, Studio ten. `billing_accounts.plan_id` is a legacy field and is no longer authorization for paid allowance or publication slots. A stale paid cache cannot authorize another site after the entitlement month ends.

Existing published sites are not automatically taken offline by a downgrade or failed renewal. They remain editable/restorable, even when their count exceeds the new tier. The account cannot publish another site while over its current limit; unpublishing frees slots. This is an explicit grandfathering policy for the test platform, not strict automatic enforcement of a lower live-site count. Before sales, decide whether to keep this policy or introduce a communicated grace period and user-selected sites. Never silently choose and delete a user's live sites.

## Verification and remaining work

AI requests reserve quota and claim the expected conversation revision in one D1 batch. Competing messages cannot leave a second hold or call the model. A retry with the same message ID must match its original text and revision; conflicting reuse returns a conflict. If the initial transaction commits but its acknowledgement is lost, replay reads the saved pending turn without dispatching again. An undispatched turn is subsequently reconciled and released after the timeout. Provider-dispatched uncertain calls retain their hold for review.

`test:plan-periods` covers concurrent/replayed receipts, conflicting owners and references, quota/hold preservation, ledger totals, no unconfirmed paid rollover, lower-tier renewal, persistent credits, late settlement, grants before first use, lost acknowledgements, immutable receipts and publication limits independent of the legacy cache. Billing, publication and checkout regression suites cover the surrounding contracts.

Still required for paid subscriptions: customer/subscription mappings, trusted product and invoice-period mapping, subscription checkout, invoice-paid fulfillment, idempotent event handling, missed/out-of-order-event reconciliation, cancellation/downgrade controls, proration and refund policy, authenticated management links, real test-mode acceptance and a tested separation between test entitlements and any future live-money environment. No plan grant was installed for a real account while building or testing this feature.

## Deployment evidence — September 29, 2026

Migration 0020 applied locally and remotely before deployment. Main Worker version `e75566e6-46d9-40be-997b-739d4ff9f896`; public Worker version `955bcbf9-dce2-4227-9d00-85c46fc9c302`. TypeScript, billing (including conflicting concurrent message IDs), plan-period, publication, checkout, site-agent and workspace-agent checks passed. A temporary production account signed in with a passkey and received one live Muse reply: Explore allowance 25, four units settled, zero held. Exact replay did not increase usage; conflicting text under the same ID returned 409. Checkout remained disabled. Logout passed and the temporary account was deleted. Paid receipt behavior was verified only in disposable local databases.


## Explore allowance revision

Migration 0032 raises the normal free allowance from 25 to 50 after live onboarding tests showed the old ceiling could block the first or second edit. Current and future stored 25-unit periods receive an audited 25-unit increase; past periods and paid allowances remain unchanged. Spent usage, pending/dispatched holds and credit balances are preserved. A compatibility trigger also raises current/future periods inserted by the previous Worker during rollout. New code takes the Explore allowance from the shared plan catalogue. Paid prices, paid allowances and credit-pack pricing are unchanged.

`test:explore-allowance` runs the exact migration twice against existing spend and a dispatched hold, verifies one ledger adjustment, then settles the hold. It also covers historical periods, paid ceilings and an old-Worker insert. `test:billing`, `test:plan-periods` and `test:usage-recovery` retain concurrency, settlement, renewal and recovery coverage. This is a bounded invite-only testing allowance, not a promise that every request yields a fixed number of edits.
