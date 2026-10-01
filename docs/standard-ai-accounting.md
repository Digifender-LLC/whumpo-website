# Standard AI accounting

**Current contract — October 1, 2026.** Standard assistance is unlimited fair use for building and maintaining customer projects, with zero customer credit charges. Advanced models remain a separate future consent/funding path. The Muse testing route records hypothetical internal subscription-shadow costs; those estimates are not customer charges or verified provider invoices.

## One request path

`standard_ai_requests` owns the immutable account/request/hash identity and `reserved → dispatched → completed/uncertain` lifecycle. Only an undispatched reservation can be released. Exact retries read the same record; changed identity or a competing Chat revision fails. Admission atomically claims the Chat turn, reserves the standard receipt and reserves internal inference capacity.

`inference_calls` requires an owned pending Chat turn and current standard receipt in the matching budget month. Inspection continuation requires dispatched standard and inference receipts. The result transaction requires a pending owned turn and dispatched/uncertain standard receipt, so a late result cannot commit its proposed action after closure. Failed validation can still consume provider resources: preserve internal token/cost evidence without claiming the work succeeded.

No test-unit ledger, old credit balance, calendar allowance, legacy metered admission or settlement handler exists. The current schema reset deletes that obsolete test state. `ensureBilling` reads current invoice coverage without initializing a separate billing account or allowance.

## Interrupted requests

`reconcileStandardChat` completes saved results without calling the provider again. Lost settlement acknowledgments are recovered by exact receipt readback. Expired undispatched work releases its receipt and unused internal reservation. Dispatched unknown outcomes remain uncertain; they are not automatically retried or declared free to the provider. Closure rechecks absent token reports atomically to prevent a stale snapshot from discarding a just-saved answer.

A pending AI turn without its current standard receipt fails explicitly and requires review. It is never routed through a historical metering handler. Request history is owner-scoped and metadata-only; Billing shows the latest 20 requests and Chat can inspect further history. Operator maintenance reports inspect only the current receipt path.

## Capacity and fair use

Internal provider capacity and availability can interrupt testing, with a service-capacity response rather than a request to buy standard-AI credits. Unknown plans cannot silently receive an internal budget. Financial Monitor remains the default; cost/volume alone does not establish misuse. Safety policy is independent. Premium routing, actual provider cost attribution and broader fair-use notice/appeal workflows retain their roadmap gates.

## Verification

Focused suites cover competing admission, ownership, immutable identity, dispatch/cancel races, exact completion replay, uncertain costs, interrupted response recovery, late-result atomic rollback, malformed/foreign history queries and zero customer credit charges. `tests/billing.mjs` also proves obsolete tables and routes are absent after a populated disposable reset. Source verification and deployment acceptance are recorded in [the current-only inventory](current-version-policy.md).

Historical September 30 activation evidence remains in [the chronological deployment log](deployment.md). It describes the then-existing dual accounting schema; it is not the current runtime contract.
