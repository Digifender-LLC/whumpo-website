# Standard AI accounting

September 30, 2026. Implements the owner's decision that standard assistance is unlimited under fair use and advanced models consume explicitly approved credits.

## Status

`src/standard-ai-usage.ts` and migration `0094_standard_ai_requests.sql` introduce non-billable request receipts. This is the accounting foundation, **not an activated unlimited Chat path**. Current Muse Chat still uses historical test-unit accounting. Premium dispatch and billing remain disabled. Migration 0094 is applied in the private test database; September 30 at 15:21 UTC readback confirms all 94 migrations, no pending files, both transition/identity triggers and zero standard requests. The receipt module is not imported by the deployed Chat handler. Do not advertise that current test balances have stopped limiting requests until the integration work below passes.

## Contract

- An immutable request ID, owner and hash identify an operation. Store no raw prompt or credentials in this table.
- Reservation does not create a billing account, deduct units, hold credits, grant provider budget, or authorize tools. Project/action permissions remain with the task handler.
- Only one competing dispatcher can move a reserved receipt to dispatched. A reserved receipt can instead be cancelled; cancellation and dispatch cannot both succeed.
- Dispatched requests may complete or become uncertain. Uncertain outcomes retain their identity and cannot be cancelled or dispatched again. Reconciliation can complete them from authoritative provider evidence.
- Completion records nonnegative safe-integer input/output token reports without converting them to customer units. Matching completion replay returns the existing receipt; changed totals conflict.
- The database enforces immutable identity and terminal states. Reads and transitions are owner-scoped. Standard assistance does not draw from advanced-model credits.

The token counts are evidence, not invoice amounts, provider-cost reservations, a cost ceiling or a model-price schedule. Internal provider admission, per-request output bounds, concurrency, security and fair-use monitoring still need their own controls. Unlimited fair use does not authorize unlimited paid provider spend.

## Remaining integration

1. Connect Chat admission, dispatch, completion, failure and interrupted-response reconciliation to these receipts for standard routes. Preserve exact replay of historical metered requests.
2. Internal inference admission now accepts owned standard receipts through migration 0095, while preserving legacy admission, unknown cost holds and budget checks. Wire the Chat handler to this path and verify its complete recovery behavior.
3. Keep advanced-model consent and credits separate. Internal model choice cannot silently convert a standard task into premium work.
4. Update balance/status/history UI and Chat responses together. Historical test debits remain labelled historical; new standard work must not suggest purchasing credits to continue.
5. Test zero-balance standard work, concurrent admission, recovery after lost provider/database acknowledgments, monitor mode, provider-cost admission and customer-unit non-mutation through the full handler before activation.

## Verification

`node tests/standard-ai-usage.mjs` uses actual disposable local D1. It checks competing reservations/dispatch, foreign-owner denial, changed request hashes, cancellation races, uncertain-result retention, exact completion replay, invalid token reports and immutable identity. It also verifies that the entire receipt lifecycle creates no billing accounts, usage periods, usage operations, customer ledger entries, credit grants or provider inference receipts. This last check establishes separation, not completed provider accounting.

## Internal inference integration

Migration 0095 accepts an owned pending Chat turn backed by either a historical usage operation or a standard receipt. The standard receipt must be reserved/dispatched and its creation month must match the inference budget period. Database guards prevent any request ID from appearing in both customer-accounting paths. Existing inference role, cost, budget, immutable identity and transition checks remain in force.

Inspection continuation likewise requires an owned pending turn, dispatched internal inference receipt and a dispatched receipt in the selected customer-accounting path. A standard reservation cancelled before dispatch can release an undispatched internal cost reservation during budget maintenance. Dispatched/uncertain internal inference is never released by this cleanup.

The D1 integration test now reserves and settles internal estimated costs for standard work with no customer billing account, unit reservation or credit debit. It checks wrong owner/month, cancelled admission, premature continuation, provider-budget denial and cross-path request-ID collisions. These checks do not activate standard Chat dispatch or turn subscription-shadow estimates into invoices. `node tests/model-costs.mjs` passed against the updated schema, preserving historical metered admission and cost accounting. `pnpm check` passed for both TypeScript projects. Remote readback at 15:26 UTC on September 30 confirms all 95 migrations applied, none pending, both updated admission triggers and both cross-path guards. No Worker release or Chat activation was performed for this step.
