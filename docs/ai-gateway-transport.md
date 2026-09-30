# AI Gateway transport

## Status — September 29, 2026

Implemented and locally contract-tested in `src/ai-gateway.ts`. This is the network adapter for the [gateway routing and spending design](pricing-and-model-policy.md#delivery-architecture). It is **not connected to live Chat, the route planner, or spending dispatch**. Muse remains the only live owner-test model. No gateway was provisioned, API token installed, paid call made, or billing setting changed by this increment.

## Contract and Whumpo fit

`completeGateway` accepts trusted server configuration (account, gateway, token, explicit model, protocol, output bound and deadline) and Whumpo's existing message array. It returns the same normalized text/input-token/output-token result as the direct OpenAI-compatible transport. The account determines a fixed Cloudflare `/ai/v1` base URL; callers cannot supply another host or arbitrary headers. Chat Completions and Responses are separate explicit choices. Support for a protocol by this adapter does not prove a specific model supports that protocol.

The request names its gateway and asks for no shared caching, no content logging, one attempt, and no fallback to Cloudflare-managed third-party credentials. No customer identity, email, project name, or session identifier is added as gateway metadata. Prompt content itself still goes to the selected inference service. Redirects are not followed and the adapter does not retry or switch models. Tokens with whitespace/header controls, malformed account/gateway/model identifiers and dynamic-route selectors are rejected before transport. Native Workers fetch retains its required global receiver.

The existing parser bounds response bytes/text, rejects unexpected model identities, tools and credential echoes, and requires integer usage counts. Provider errors return sanitized categories without upstream response bodies or credentials. The client deadline includes response reading. Provider-side timeout settings do not prove billing stopped when the client timed out; unknown outcomes must retain their spending reservation.

## Delivery and prerequisites

Before enabling this adapter in Chat, connect it to an immutable admitted attempt: reserve operator/customer funds, atomically claim dispatch, use that receipt's exact model/rates/bounds, then settle observed usage. Record unknown outcomes for reconciliation without automatically replaying the provider call. The present adapter is intentionally not a funding or authorization boundary by itself.

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
