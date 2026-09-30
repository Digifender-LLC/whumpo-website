# Company finance review for fair-use monitoring

## Status — September 30, 2026

Implemented as an **operator-only, read-only report**, with local fixture acceptance. It accepts a private, manually reviewed company-wide summary and compares two closed periods using the existing proposed profitability tolerances. It adds no customer route, model tool, inference call, database write, billing entitlement or enforcement switch. No new Cloudflare service or recurring charge is required.

This is not a payment/provider integration or an independent audit. Supplied numbers are labeled `operator_attested_summary` and `independentlyVerified:false`. The ordinary report's `economics.verified:false`, unknown actual company profit and Monitor fallback remain unchanged. The optional comparison is a separate `financeReview`; it cannot be passed into customer admission or used as proof of customer misuse. Stripe remains deferred by the owner, and provider invoice reconciliation remains outstanding.

## Operator workflow

### Inference operations diagnostics

The ordinary `pnpm report:fair-use` report also includes `inferenceOperations30d`, independent of an optional finance file. It groups retained inference receipts by role, provider-receipt state, Chat outcome and cost basis. This includes acknowledgement calls and observed model usage behind failed, pending or uncertain Chat turns, which are excluded from the existing successful-Chat shadow metric. An unsuccessful Chat outcome can still have consumed model resources.

Each group reports receipt count, observed input/output tokens, observed subscription-shadow estimates and unresolved subscription-shadow reservations. Reserved receipts may never have dispatched; one Chat request may contain multiple calls. Held estimates are not measured usage or paid charges. Unpriced records have unknown prices, so zero monetary totals never prove free inference. Actual provider expense remains `null`. Deleted-account history cannot be reconstructed, and the window follows receipt creation time rather than invoice settlement time.

Use this breakdown to investigate provider failures, unknown outcomes and orchestration overhead before attributing higher costs to customer behavior. It does not classify intent, prove waste, retry calls, release reservations, change customer credits or enable enforcement. Unknown provider outcomes need existing reconciliation rather than automatic re-dispatch. The report contains no account/receipt IDs, provider configuration, prompts, replies, acknowledgement text or customer source. `--account` retains the same private, already-known account scope as the rest of the report. Company finance and individual misuse evidence remain separate.

### Preparing the optional finance comparison

1. Prepare company-wide totals from the same accounting basis for adjacent closed periods, each 28–31 days and of equal length. The latest period must have closed within seven days. Calendar months of different lengths need a separately prepared comparable window; this tool does not prorate invoices or invent daily allocations.
2. Include earned revenue before refunds and excluding tax. Do not automatically substitute collected deposits, price-list totals, financing or hypothetical Muse/API estimates for earned revenue. Payments received before the associated service is delivered can be deferred; use the earned amounts from the reviewed books ([Stripe overview](https://stripe.com/resources/more/deferred-revenue-explained), checked September 30, 2026). For this operational report, refunds appear once in the cost breakdown rather than being subtracted again from revenue. This gross-revenue/refunds-as-cost layout is a Whumpo monitoring convention, not a financial-statement presentation or bookkeeping instruction. Have the person responsible for the books prepare/confirm this consistent operational summary; the tool does not perform accounting recognition or currency conversion.
3. Enter all seven cost categories: inference, hosting, domains, payment fees, refunds, support and other. Company inference expense includes premium work, retries and operational calls; these totals are **not** individual standard-plan abuse costs. Shared allowances/subscriptions and support allocations need the same treatment across both periods. Use `0` only for an explicitly checked zero and `null` for an unknown amount. Costs and revenue use nonnegative integer USD millionths (`1 USD = 1,000,000`).
4. Record a review timestamp after each period closes and the SHA-256 digest of its privately retained supporting evidence. Set `complete:true` only after checking company-wide coverage. Digests identify evidence; the tool does not open, verify or audit that evidence.
5. Save the aggregate JSON in ignored `.secrets/`, with restrictive file permissions. Do not include invoices, account IDs, customer names, email, source code, credentials or free-form notes in this summary. Unknown fields are rejected.
6. Run `pnpm report:fair-use --economics .secrets/company-finance.json`. Optionally combine it with `--account ACCOUNT_UUID` for an already known account; the finance comparison remains company-wide. Output contains aggregate financial amounts, so keep saved reports private. The command uses the existing operator's Wrangler authentication for ordinary activity reporting.

No data is stored remotely by the optional comparison. The original input file's SHA-256 is included as `inputDigest`; reformatting or changing the file produces a different digest. The two underlying evidence digests are omitted from report output, along with source paths and review metadata. Input size is limited to 64 KiB, decoded as strict UTF-8 and validated before the live database read. Failures print a generic message without file contents, paths, raw provider errors or credentials.

## Input contract

Dates are UTC calendar dates; `endExclusive` is not included in the period. `reviewedAt` is a canonical UTC timestamp. `previous.endExclusive` must equal `current.start`. All fields are required; `null` represents unknown financial amounts. This template is intentionally incomplete: replace the evidence placeholders and enter reviewed totals before expecting an assessment.

```json
{
  "version": 1,
  "currency": "USD",
  "basis": "earned-revenue-before-refunds-excluding-tax",
  "previous": {
    "start": "2026-08-01",
    "endExclusive": "2026-08-31",
    "revenueMicros": null,
    "costs": {
      "inference": null,
      "hosting": null,
      "domains": null,
      "paymentFees": null,
      "refunds": null,
      "support": null,
      "other": null
    },
    "review": {
      "complete": false,
      "reviewedAt": "2026-09-01T00:00:00.000Z",
      "evidenceDigest": "REPLACE_WITH_SHA256_OF_PRIVATE_SUPPORTING_EVIDENCE"
    }
  },
  "current": {
    "start": "2026-08-31",
    "endExclusive": "2026-09-30",
    "revenueMicros": null,
    "costs": {
      "inference": null,
      "hosting": null,
      "domains": null,
      "paymentFees": null,
      "refunds": null,
      "support": null,
      "other": null
    },
    "review": {
      "complete": false,
      "reviewedAt": "2026-09-30T00:00:00.000Z",
      "evidenceDigest": "REPLACE_WITH_SHA256_OF_PRIVATE_SUPPORTING_EVIDENCE"
    }
  }
}
```

## Assessment and boundaries

The output shows each period's revenue, total cost and profit, plus changes for each cost category. Unknown costs make total cost/profit unknown rather than zero. Invalid dates, future/unclosed periods, fractional/negative/unsafe monetary values, unsupported currency/basis, missing categories and overflow are refused. Incomplete review, unknown amounts, stale or nonadjacent windows and unequal/out-of-range durations cannot suggest financial escalation.

The existing proposed tolerance is revenue within 5%, a margin decline of at least five percentage points, and lower absolute profit. Calculations use integer arithmetic for threshold comparisons. A matching decline sets only `reviewSuggested:true` with `reason:profit_decline_needs_operator_review`. Costs increasing because of provider pricing, retry waste, support or legitimate customer workload do not establish abuse. Operators can continue ignoring outliers while reviewing overall economics. Every result returns `action:observe_only`, `enforcementEnabled:false` and empty `activeRestrictions`.

Before active enforcement can ship, authoritative financial ingestion/reconciliation, purpose classification, contextual review, delivered notices, continued-misuse evidence, appeals and expiry/rechecks still need implementation and acceptance. The report does not satisfy those gates. See [fair-use policy](pricing-and-model-policy.md).

## Verification

Inference operations extension (September 30, 2026): `pnpm check`, `node tests/model-costs.mjs`, `pnpm test:fair-use` and diff checks passed. Actual disposable-D1 receipts exercise observed resources behind failed replies, acknowledgement calls, reserved/uncertain/released states, account scoping, a window excluding old calls, content/identity/configuration canaries and read-only queries. Reporting leaves uncertain reservations untouched. Live read-only reporting also passed, with Monitor mode, zero restrictions and actual profit/expense still unknown; the live inference grouping was empty at this observation. Nonempty classifications are verified by the local fixtures, not inferred from that live result. Private output: `.secrets/fair-use-inference-operations.json`. No Worker deployment, schema change or customer-facing behavior change is required.

`pnpm check`, `pnpm test:fair-use-finance` and `pnpm test:fair-use` cover type checking, exact revenue/margin threshold boundaries, loss reporting, missing values, complete-review requirements, temporal comparability/freshness, input precision/shape/size/encoding, stable source digests, generic CLI failures and preservation of Monitor behavior. Finance fixtures are synthetic and make no network requests. No real company finance summary has been accepted, and no assertion about Whumpo's actual profitability is made.

Live read-only check: the ordinary report completed against the test control database after this change, with Monitor mode, empty active restrictions, unknown actual profit and no finance comparison when no input was supplied. The private result is saved in ignored `.secrets/fair-use-after-finance.json`. No synthetic financial figures were mixed into that live report, no configuration was changed, and no deployment was needed.
