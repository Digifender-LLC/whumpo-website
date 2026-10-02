# Inference privacy handoff

**[WH-121 / #80](https://github.com/zemdregon/whumpo/issues/80), extracted from WH-020; reviewed October 2, 2026 UTC against `9d64b9a`.** This decision supplies the provider-processing boundary needed by WH-116. It does not approve a confidential-customer route, change the testing model, establish legal compliance or complete real-model benchmarking. WH-020 retains its complete outcome-quality and cost acceptance; WH-021 owns activation.

## Current decision

The existing route is OpenCode **Go**, `https://opencode.ai/zen/go/v1`, model `muse-spark-1.3-contributor`, Responses protocol. Sole-owner testing with synthetic or deliberately non-sensitive content remains permitted under the owner's existing instruction. Confidential beta content, real connected mailbox/calendar/CRM content, credentials and restricted safety material are not eligible for that route. The current Chat training notice must remain visible. A successful generation, enabled OAuth scope or encrypted database does not change provider-processing eligibility.

The provider's [Go privacy table](https://opencode.ai/docs/go/#privacy), checked October 2, lists training use for Muse Contributor and does not offer zero data retention for it. Its retention duration is unspecified there. OpenCode [Zen](https://opencode.ai/docs/zen/#privacy) also describes Contributor training, but Zen's other models or general statements do not establish the Go model's terms. No numerical deletion window, US-only processing or contractual confidentiality is inferred.

The [Workers AI data-use policy](https://developers.cloudflare.com/workers-ai/platform/data-usage/), checked October 2, says Cloudflare does not train/improve models or services on customer content without explicit consent, requires attention to model licenses, and notes that connected storage retains its own copies. This makes Workers AI a candidate for review, not an approved route. Exact model/license, processing location, retention, contract and all connected services remain unresolved.

[AI Gateway logging](https://developers.cloudflare.com/ai-gateway/observability/logging/), checked October 2, can retain prompts/responses, and logging is enabled by default. Per-request controls can disable logs or payload collection; logs may also include separate guardrail/DLP evaluations. The existing Whumpo adapter asks for no logging, no shared cache and one attempt. Those headers are a request, not observed configuration evidence. Backend terms, Gateway settings, extra processing and retention must all be reviewed before confidential use. No Gateway/model/service is activated by this handoff.

## Reuse the lifecycle inventory

WH-116 extends [the existing lifecycle catalogue](data-lifecycle.json); this document is a processing rule, not a second data inventory. These examples locate the relevant current classes:

| Existing class | Inference constraint |
| --- | --- |
| `conversation`, `profile-workspace` | Send only necessary owner task context. Profile sharing is explicit opt-in; it cannot authorize disclosure of credentials or unrelated people’s data. Current Contributor testing remains non-sensitive. |
| `projects`, `site-versions`, `project-configurations`, `backend-artifacts` | Exact owned, admitted task inputs only. Public publication is separate authority; generated artifacts and private drafts are not automatically public. |
| `connections`, `github-backups`, `contacts`, `visitor-app-data` | Provider consent or read access does not authorize model sharing. Real confidential connected/visitor content cannot enter the current Contributor route. Future adapters need exact use consent, minimization, lifecycle registration and an approved route. |
| `owner-identity`, `owner-identity-progress`, `owner-identity-kits`, `visitor-identity` | Authentication/recovery secrets never enter model context. Account recovery does not recover content keys or authorize a new processor. |
| `safety-cases`, `import-quarantine`, `project-media` | Preserve restricted handling, quarantine and media gates. This decision does not implement or test scanning. No restricted case material is allowed as ordinary agent context. |
| `standard-ai`, `premium-gateway`, `platform-operations` | Prefer bounded cost/usage/receipt metadata. Raw replies retained for scoped request recovery remain private content; neither tokens nor customer identifiers belong in public diagnostics. |

US-based customer eligibility does not guarantee US-only processing, storage or visitor residence. At-rest encryption does not make server/model-readable content end-to-end encrypted. Provider-side deletion and training use cannot be undone by deleting Whumpo's local copy.

## Required admission record for a future route

WH-021 must bind this evidence to its existing server-owned candidate/route identity. WH-116/117 supplies data-class controls. Do not create a parallel route selector or let a model/client supply an `approved` boolean.

- Exact provider, endpoint, protocol, model/version and catalogue identity; every processor and any separately approved auxiliary call.
- Allowed lifecycle classes, task purpose, minimization and owner consent. Recovery/safety credentials remain prohibited regardless of route.
- Dated training-use terms, retention/deletion guarantees or explicitly unknown fields, model license, contract/DPA applicability, processing/storage regions and access controls.
- Effective logging/cache/guardrail settings, configuration evidence and expiry, not only requested headers. Include secondary copies, exports and diagnostic sinks.
- Named review evidence and validity interval, current revoked/expired state, key custody, incident handling and the unresolved conditions that prevent admission.
- Separate conformance/quality/cost evidence, funding and exact activation authority. Standard assistance still charges the customer zero units; that does not make provider expense zero.

Missing, expired, changed or contradictory evidence means **no eligible confidential route**. Revalidate immediately before dispatch. A busy or unavailable route must not switch providers/models or lower privacy requirements. Current source has an offline cost/region planner and inactive Gateway adapters; this handoff does not claim a runtime privacy-admission implementation exists.

## Scenarios and verification limits

1. Synthetic landscaping brief on the owner's existing Go route: acceptable testing data, with the training notice. It supplies no customer-quality, price or confidentiality conclusion.
2. A Business plan connects a real mailbox: plan inclusion and OAuth are insufficient. The current Contributor route remains ineligible; a future connector must avoid forwarding content until the exact approved use/route is available.
3. A Gateway request disables logs but effective settings/auxiliary processors are unverified: retain the activation hold. Local encrypted storage does not settle that exposure.
4. A retained job or restored database references a revoked/expired route: current admission still refuses dispatch; restoration cannot recreate privacy approval or provider authority.
5. An owner replaces lost passkeys: account access may recover under WH-115. Neither a lost application key nor deletion of an external provider's retained/training copies is promised.

The current seven-family offline cohort verifies application behavior with scripted replies and actual local D1/QuickJS where specified. It reports zero real-provider samples, unknown actual cost and no model ranking. [Benchmark evidence](customer-benchmarks.md) records exact runs and remaining work. These scenarios and public statements are a design handoff for WH-116, not a provider audit, confidential beta approval, real-device acceptance or an activated model switch. CSAM and Daybreak remain deferred; CMS functional testing remains paused.
