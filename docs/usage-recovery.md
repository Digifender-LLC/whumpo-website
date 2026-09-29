# Recovering unresolved AI usage holds

## Policy

Unknown provider usage remains held by default. Whumpo never automatically retries the model call or treats a timeout as proof of zero provider cost. An operator may explicitly absorb that unresolved cost and release the customer's reservation through the reviewed waiver workflow below.

A waiver changes customer accounting only. `actual_units=0` means zero customer build units charged; it does **not** assert zero provider tokens. Token receipt fields remain null. Saved drafts, publication reviews, domain/hosting reviews and backups remain intact. Customers are told to inspect saved work before making another request. Previously settled charges, confirmed token receipts, active/pending turns and recently changed uncertain requests cannot be waived through this tool.

## Operator workflow

The tool runs locally using the existing Wrangler D1 authorization. It is not imported into the HTTP Worker or exposed as an AI action, customer endpoint or browser control. It needs no model key and makes no provider request. Never place prompts, credentials, personal data or private visitor messages in the operator/reason fields.

```sh
node tools/waive-ai-usage.mjs list --remote
node tools/waive-ai-usage.mjs inspect OPERATION_ID --remote
node tools/waive-ai-usage.mjs apply .secrets/usage-waiver-REVIEW_ID.json \
  --confirm REVIEW_DIGEST --operator OPERATOR_NAME \
  --reason 'Support reference and reason the platform absorbs this unknown cost' --remote
```

`list` returns the oldest 100 eligible operation IDs with owner IDs, month and held units. It excludes prompts, answers, email addresses and secrets. `inspect` verifies eligibility and writes a mode-0600 ten-minute review under ignored `.secrets/`. Inspect the exact owner, operation, period, quota hold and credit hold before applying. If state changed, inspect again rather than changing the review file. The digest protects the reviewed snapshot against accidental editing; operator authorization comes from D1 credentials, not from possession of a digest.

Only an AI chat turn and its matching usage operation that are both uncertain, have no saved token receipt, and whose operation has been unchanged for at least ten minutes are eligible. A valid response receipt should use normal settlement/reconciliation, not a waiver. Broader provider-receipt reconciliation remains unfinished.

## Atomicity and recovery

Migration 0028 adds an immutable `usage_waivers` audit table. An insert trigger rechecks the exact operation identity, owner, month, reserved amounts, update timestamp, chat revision/state, missing token receipt, minimum age and review expiry. Within the same D1 statement, it releases the operation through the existing billing triggers, restores held credits, updates the original usage month, records activity, and closes the chat turn with an honest waiver message. Operator name/reason remain in the audit table, not in chat/AI context.

One waiver is allowed per operation. Same-review replay returns the exact recorded receipt; different metadata or a competing review conflicts. A lost database acknowledgement is recovered by reading the audit receipt. No repeat release or grant occurs. Audit records cannot be edited/deleted while their owning account/operation remains; normal operator account cleanup can cascade them. This is application retention and does not promise removal from Cloudflare backups.

The AI path now rechecks that its turn is open after the provider responds. A database trigger also guards token-receipt writes. Those writes share a transaction with proposed draft statements, so a turn closed by timeout recovery or waiver cannot accept late draft statements through that transaction. Separately persisted, reviewed integration actions may already exist and are preserved; none is automatically confirmed or undone. The original message ID remains consumed, preventing another model call on replay.

## Verification

`test:usage-recovery` covers quota/credit restoration, immutable audit, concurrent waivers, same-request replay, stale/settled/pending/recent/known-receipt rejection, lost acknowledgements, settlement races at insertion, closed-result transaction rollback, late model response fencing, absent token fabrication and owner cleanup. Existing billing and site-agent suites cover normal settlement, drafts, usage reservations, owner isolation and lost result acknowledgements. Tests use synthetic data; live acceptance must use a disposable account and artificial hold, never a real customer's balance without a support decision.

Deployment evidence (September 29): migration 0028 applied remotely; platform `1126dbb7-8cc5-4348-bae2-7d041ed7f781`, public-site Worker `54f63bbb-4437-4dfd-99d0-c1e80633956c`. TypeScript, build, recovery, billing/AI integration and site-agent regression suites passed. A signed-passkey temporary live account received artificial credits and an aged unresolved hold. The actual CLI inspected/applied/replayed its waiver; quota and credits were restored exactly once, token receipts remained null, the transcript closed, the customer waiver endpoint was absent, and message replay charged nothing. A subsequent normal Muse response settled at 5 units with zero held and no replay charge. Owner cleanup removed the synthetic account/grants/operation/waiver. No real customer balance was altered.

The long site-agent regression fixture now receives explicit synthetic credits so its final saved-version-limit scenario is not intercepted by unrelated allowance exhaustion. Its helper asserts each request status. Production allowances are unchanged; the separate billing suite still exercises insufficient funds and concurrency.

D1 batch rollback semantics were checked against [Cloudflare's D1 binding documentation](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) on September 29, 2026, and exercised by the closed-result rollback test.
