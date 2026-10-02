# AI Gateway transport

## Status — September 29, 2026

Implemented and locally contract-tested in `src/ai-gateway.ts`. This is the network adapter for the [gateway routing and spending design](pricing-and-model-policy.md#delivery-architecture). The server-only dispatch service now connects an existing planner-derived spending reservation to this adapter. It is **not connected to live Chat or a funded production route**. Muse remains the only live owner-test model. No gateway was provisioned, API token installed, paid call made, or billing setting changed by this increment.

## Contract and Whumpo fit

`completeGateway` accepts trusted server configuration (account, gateway, token, explicit model, protocol, output bound and deadline) and Whumpo's existing message array. It returns the same normalized text/input-token/output-token result as the direct OpenAI-compatible transport. The account determines a fixed Cloudflare `/ai/v1` base URL; callers cannot supply another host or arbitrary headers. Chat Completions and Responses are separate explicit choices. Support for a protocol by this adapter does not prove a specific model supports that protocol.

The request names its gateway and asks for no shared caching, no content logging, one attempt, and no fallback to Cloudflare-managed third-party credentials. No customer identity, email, project name, or session identifier is added as gateway metadata. Prompt content itself still goes to the selected inference service. Redirects are not followed and the adapter does not retry or switch models. Tokens with whitespace/header controls, malformed account/gateway/model identifiers and dynamic-route selectors are rejected before transport. Native Workers fetch retains its required global receiver.

The existing parser bounds response bytes/text, rejects unexpected model identities, tools and credential echoes, and requires integer usage counts. Provider errors return sanitized categories without upstream response bodies or credentials. The client deadline includes response reading. Provider-side timeout settings do not prove billing stopped when the client timed out; unknown outcomes must retain their spending reservation.

## Delivery and prerequisites

The dispatch service described below consumes an existing immutable admitted attempt. Live Chat still needs authoritative route configuration, funding admission and an approved model-specific input counter. The low-level adapter alone is not a funding or authorization boundary.

Activation requires a scoped Workers AI Read token, a configured gateway whose billing/logging/cache/attempt settings have been reviewed, an explicit versioned model catalogue with verified prices and protocol conformance, gateway/provider receipt linkage, and a reviewed canary. Third-party BYOK credentials must be present on the gateway when using this adapter's required-credentials policy. It does not purchase gateway credits or use the owner's broad Cloudflare management key for inference. Gateway configuration, provider retention, effective header behavior and model-specific reasoning/token costs remain live acceptance requirements.

Workers Paid is not an unlimited inference entitlement. Usage can create Workers AI or provider charges; account-specific allocation, tariffs, recurring/minimum charges and billing mode must be verified before activation. This source change enables no service and accepts no recurring charge.

## Official references checked on September 29, 2026

- [REST API and authentication](https://developers.cloudflare.com/ai-gateway/usage/rest-api/): fixed account endpoints, both protocols, model naming and explicit gateway selection.
- [Workers AI routing](https://developers.cloudflare.com/ai-gateway/usage/providers/workersai/): `@cf/` model IDs and gateway requirement.
- [Header glossary](https://developers.cloudflare.com/ai-gateway/glossary/): per-request cache/log/attempt settings and required-provider-credentials header.
- [Request handling](https://developers.cloudflare.com/ai-gateway/configuration/request-handling/): timeout and attempt semantics.
- [Gateway configuration](https://developers.cloudflare.com/ai-gateway/configuration/manage-gateway/) and [Workers AI pricing](https://developers.cloudflare.com/workers-ai/platform/pricing/): activation-time billing review.

## Verification

`pnpm test:ai-gateway` exercises both actual adapter paths with an injected transport: fixed endpoint, headers, request payload, usage normalization, configuration rejection before any call, redirects/429/500 without retry, timeout redaction, credential-echo rejection, missing usage rejection and native fetch binding. `pnpm test:ai`, `pnpm test:model-policy`, `pnpm check`, and diff checks also pass. These are local contract checks, not live Cloudflare inference or provider-cost acceptance.


## Durable dispatch and recovery — September 29, 2026

`src/gateway-inference.ts` consumes an existing owner-scoped reservation created by `reserveGatewaySpend`. It verifies the configured model, protocol, hosting class and output ceiling against that immutable receipt. A trusted server input counter must be approved for the exact model/protocol; unverified client estimates must never be passed as that counter. Invalid or over-bound input cannot dispatch. Configuration and messages are copied before asynchronous work to prevent mutation during admission.

Migration `0075_gateway_inference_requests.sql` binds the reservation to a hash of its exact messages, account/gateway, model, protocol, output ceiling, timeout and measured input bound. Prompts and credentials are not stored in this table. Different request content or routing cannot reuse the same attempt. API token rotation does not change request identity. The record does store the validated private answer and usage for owner-scoped recovery; it is not a shared cache, public API or model context source.

The existing database transition claims dispatch once. Concurrent duplicates may observe an in-progress status but cannot call the provider again. A lost claim response or crash after claiming leaves a retained hold, even if no provider call occurred. This is deliberate at-most-once dispatch, not a guarantee that every admitted attempt completes. Such attempts need reconciliation rather than blind retries or release.

After a validated response, the service stores it before settling through the existing ledger. These are recoverable stages, not one database transaction. If the response is durable but settlement or its acknowledgment is lost, an identical retry uses the saved answer/usage to finish or replay settlement without inference. If the provider answer is lost before durable storage, the attempt remains uncertain with its hold. A response exceeding the reservation is retained for investigation but cannot settle above the approved amount. No error path automatically calls another provider, releases a dispatched hold or raises a cap.

The request/result identity is immutable and deletion is denied. Retention/anonymization, provider invoice reconciliation, orphan reconciliation, cancellation, model-counter version management, funding/approval endpoints and live route activation remain required before real customer use. No new public endpoint exposes this service. Migration 0075 was subsequently applied September 30 under the owner’s all-pending test migration policy. Gateway dispatch/spending remains inactive.

Verification: `pnpm test:gateway-inference` uses disposable actual D1 initialized from the complete current schema and an injected provider transport. It verifies identical and conflicting concurrent requests, one provider call, owner/model/gateway/content isolation, saved-answer replay, immutable request/result records, lost insert/dispatch/result/settlement responses, failed result persistence, timeout holds, usage-overrun denial and exact final bucket balances. `pnpm test:gateway-spend`, `pnpm test:ai-gateway`, `pnpm check`, and diff checks pass. These tests incur no inference charges and do not establish live gateway behavior.

## Provider evidence and operator report — September 29, 2026

Migration `0076_gateway_provider_receipts.sql` adds one immutable header-evidence record per dispatched attempt. The server captures the configured Cloudflare account/gateway, HTTP status, receipt time and bounded `cf-aig-event-id` / `cf-aig-log-id` values before parsing the body. This also covers error responses and malformed usage. These identifiers are documented in Cloudflare's [header glossary](https://developers.cloudflare.com/ai-gateway/glossary/); their presence with content logging disabled still needs live verification. Missing identifiers remain null. They are diagnostic evidence, never proof of billable usage, a free request or authorization to release funds.

Only the two allowlisted identifier headers are retained; malformed, oversized or credential-echoing values are discarded. No raw provider body, complete header set, prompt, or token is stored in this evidence table. Owner checks and a database dispatch-state gate restrict insertion; update/deletion are denied. Exact duplicate capture can recover a lost database acknowledgment without replacing evidence. If recording headers fails, the response body is canceled and the attempt becomes uncertain, preserving its hold. A transport timeout without headers does not invent a provider ID.

`pnpm report:gateway` is a read-only private operator report. It returns unresolved-attempt counts, provider/customer holds counted once per attempt, and up to 50 attempts with status/header references and a boolean indicating whether an answer was saved. It marks truncated results. It projects no prompt/answer content, email, token, or full route snapshot. Totals exceeding safe integer bounds fail closed. The report cannot settle, release, retry or change billing. Use identifiers to investigate provider records; do not blindly redispatch unresolved work.

Verification: the actual-D1 `pnpm test:gateway-inference` suite now covers successful/error header capture, immutable evidence, foreign-owner rejection, credential/oversize filtering, absent headers after timeout, lost insert acknowledgment, failed evidence persistence with body cancellation, unchanged single-call recovery, report bounds/redaction and final financial balances. `pnpm check` and diff checks pass. Migration 0076 was subsequently applied September 30; its table and the request table were verified empty. The private operator report was then run remotely: zero unresolved attempts, zero provider/customer holds, no entries and no truncation. Evidence is ignored at `.secrets/gateway-report-2026-09-30.json`. This verifies read-only reporting, not live inference; Muse remains the live test route. Provider invoice reconciliation and approved live gateway acceptance remain open.


## Current-schema ledger verification

`node --stack-trace-limit=0 tests/gateway-spend.mjs` and `tests/gateway-inference.mjs` pass against complete-schema local D1. These server-only fixtures exercise authoritative synthetic buckets/approvals, atomic admission, one dispatch, exact settlement and unknown holds, plus immutable bounded provider-header evidence and private operator reporting. They use current account rows without impersonating workspace sessions. All provider responses and prices are synthetic; this does not activate routing, issue customer premium funding or verify real provider expense. See [verification](verification.md#usage-operator-records-gateway-ledger-and-eligibility).
