# Standard AI accounting

September 30, 2026. Implements the owner's decision that standard assistance is unlimited under fair use and advanced models consume explicitly approved credits.

## Status

New Chat admission, dispatch, completion and failure handling now use non-billable standard receipts. The same receipt month is used for internal cost admission, including UTC month boundaries. Customer test-unit balances and legacy credit opt-in no longer constrain standard replies or bounded inspection follow-ups. Historical receipts retain their original settlement and operator-waiver path. Premium dispatch and billing remain disabled. Migrations 0094–0096 are applied; all 96 files were verified at 15:34 UTC on September 30.

This implements customer-credit separation, **not unlimited provider capacity**. The private test's existing internal monthly subscription-shadow ceiling remains enforced. Exhaustion returns temporary unavailability (503), not a payment/credit prompt. Monitor-mode abuse restrictions remain non-blocking, but Monitor does not disable this separate test-provider capacity ceiling. Replacing that testing ceiling with calibrated platform-wide capacity controls and launch fair-use enforcement remains a beta gate.

## Contract

- An immutable request ID, owner and hash identify an operation. Store no raw prompt or credentials in this table.
- Reservation does not create a billing account, deduct units, hold credits, grant provider budget, or authorize tools. Project/action permissions remain with the task handler.
- Only one competing dispatcher can move a reserved receipt to dispatched. A reserved receipt can instead be cancelled; cancellation and dispatch cannot both succeed.
- Dispatched requests may complete or become uncertain. Uncertain outcomes retain their identity and cannot be cancelled or dispatched again. Reconciliation can complete them from authoritative provider evidence.
- Completion records nonnegative safe-integer input/output token reports without converting them to customer units. Matching completion replay returns the existing receipt; changed totals conflict.
- The database enforces immutable identity and terminal states. Reads and transitions are owner-scoped. Standard assistance does not draw from advanced-model credits.

The token counts are evidence, not invoice amounts, provider-cost reservations, a cost ceiling or a model-price schedule. Internal provider admission, per-request output bounds, concurrency, security and fair-use monitoring still need their own controls. Unlimited fair use does not authorize unlimited paid provider spend.

## Remaining integration

1. Keep advanced-model consent and credits separate when premium dispatch is built. Internal model choice cannot silently convert a standard task into premium work.
2. Calibrate real-provider cost accounting and platform capacity before beta. Current Muse costs are hypothetical subscription-shadow estimates; they are not invoices or fair-use misuse evidence.
3. Complete the independent fair-use notice, appeal and narrowly scoped restriction workflow. Monitor remains non-blocking; cost/volume alone must not establish abuse.
4. Add pagination/detail views for standard receipt history when needed; Billing currently shows the latest 20 owned receipts. Chat keeps the corresponding work result. Historical test-unit history remains separately available.

## Verification

`node tests/standard-ai-usage.mjs` uses actual disposable local D1. It checks competing reservations/dispatch, foreign-owner denial, changed request hashes, cancellation races, uncertain-result retention, exact completion replay, invalid token reports and immutable identity. It also verifies that the entire receipt lifecycle creates no billing accounts, usage periods, usage operations, customer ledger entries, credit grants or provider inference receipts. This last check establishes separation, not completed provider accounting.

## Internal inference integration

Migration 0095 accepts an owned pending Chat turn backed by either a historical usage operation or a standard receipt. The standard receipt must be reserved/dispatched and its creation month must match the inference budget period. Database guards prevent any request ID from appearing in both customer-accounting paths. Existing inference role, cost, budget, immutable identity and transition checks remain in force.

Inspection continuation likewise requires an owned pending turn, dispatched internal inference receipt and a dispatched receipt in the selected customer-accounting path. A standard reservation cancelled before dispatch can release an undispatched internal cost reservation during budget maintenance. Dispatched/uncertain internal inference is never released by this cleanup.

The D1 integration test now reserves and settles internal estimated costs for standard work with no customer billing account, unit reservation or credit debit. It checks wrong owner/month, cancelled admission, premature continuation, provider-budget denial and cross-path request-ID collisions. These checks do not activate standard Chat dispatch or turn subscription-shadow estimates into invoices. `node tests/model-costs.mjs` passed against the updated schema, preserving historical metered admission and cost accounting. `pnpm check` passed for both TypeScript projects. Remote readback at 15:26 UTC on September 30 confirms all 95 migrations applied, none pending, both updated admission triggers and both cross-path guards. No Worker release or Chat activation was performed for this step.

## Interrupted-response recovery

`src/standard-ai-recovery.ts` is called by the Chat reconciler before historical metered settlement. It completes saved standard answers without changing customer balances. If settlement commits but its acknowledgment is lost, the answer remains pending and the next read completes it idempotently; it never calls the provider again.

An expired request that never dispatched releases its standard receipt and undispatched internal cost reservations. An expired dispatched request closes as uncertain and retains unknown internal provider costs. Its message explicitly states that credits were not used. Closure rechecks pending status and absent token reports within a transaction, so a stale recovery snapshot cannot discard a newly saved response.

Migration 0096 extends the existing atomic late-result guard to standard receipts while retaining the historical path. A result requires an owned dispatched/uncertain receipt and a pending Chat turn. A late result and its proposed action writes roll back together. Migrations use the existing [Cloudflare D1 migration mechanism](https://developers.cloudflare.com/d1/reference/migrations/).

`node tests/standard-ai-recovery.mjs` passed using actual disposable D1 and the Chat reconciler: persisted answer, lost settlement acknowledgment, pre-dispatch cleanup, retained uncertain cost, late-result transaction rollback, exact request replay without inference, stale-snapshot race, foreign ownership, pre-dispatch result rejection and zero customer billing mutations. Both TypeScript checks passed. No new standard request admission or premium dispatch is enabled by this recovery integration.

Historical recovery regression (`node tests/usage-recovery.mjs`) also passed, including credit holds, operator waivers, lost acknowledgments and late-result rollback. Remote readback at 15:34 UTC on September 30 verified all 96 migrations applied, none pending and the result guard admitting both accounting paths. At that schema-only step, the recovery source was not yet deployed and the platform still used historical test-unit Chat admission. The activation below supersedes that status.

## Standard Chat activation verification — September 30, 2026

`tests/standard-ai-chat.mjs` exercises the actual Chat handler with disposable D1: zero monthly units and zero credits, enabled legacy overage without spending, exact replay, changed-request refusal, failed-proposal internal costs, unknown provider outcomes, competing revisions, rollback when internal capacity is unavailable and lost admission acknowledgment recovery. Existing historical balances and ledger rows remain byte-for-byte unchanged by standard requests. The recovery suite also closes a failed action whose internal receipt settled before its Chat update was lost.

Passed: `pnpm check`, `node tests/billing.mjs`, `node tests/standard-ai-chat.mjs`, `node tests/standard-ai-recovery.mjs`, `node tests/first-ai-journey.mjs`, `node tests/model-costs.mjs`, `node tests/agent-inspection.mjs`, `node tests/welcome-first-draft.mjs`, `node tests/usage-recovery.mjs`, `node tests/usage-history-ui.mjs`, frontend builds and `node tests/frontend-loading.mjs`. Release checkout TypeScript checks and build/loading checks also passed.

Live Muse acceptance (`RUN_LIVE_MUSE=1 node tests/workspace-shortcuts-live.mjs`) used a synthetic local account with zero available test units: one call, 5,984 input tokens and 1,061 output tokens; zero customer units/credits, exact requested page/shortcuts, replay without another call, and no publication. This is real-provider/local-storage acceptance, not a hosted authenticated customer journey.

Browser acceptance used the actual local platform and disposable D1. Billing distinguished standard requests from historical balances; Dashboard showed included assistance instead of an AI-unit meter. Desktop and 390 CSS-pixel mobile layouts were inspected. The fixture verified authenticated reads and zero mutations/inference/publications. Its assertions passed; the fixture process needed explicit shutdown after its connection cleanup stalled, and its disposable directory was removed. The harness now closes open connections during cleanup. Physical-device acceptance remains separate. Evidence: `.secrets/standard-billing-browser.json`, `.secrets/standard-billing-browser.png`, `.secrets/standard-dashboard-mobile.png`.

Deployment: platform `be22062c-8178-40eb-90d0-64858af27411` activates this path. Independent public readback at 15:47 UTC confirms the active version, all 16 built JS/CSS/font assets, health 200, anonymous private-route denial, recovery-origin denial, all 96 applied migrations and no pending migrations. Evidence: `.secrets/standard-ai-release-verification.json`. No CMS test, new provider, account connection, purchase or customer publication occurred.
