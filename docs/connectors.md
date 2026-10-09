# Common bounded connector contract

**WH-056 contract slice (WH-140), October 4, 2026 UTC; source baseline `d6d669a`.** This freezes one capability contract for the seven selected customer connections — GitHub, Cloudflare, Gmail, Google Calendar, Outlook email, Microsoft Calendar and HubSpot — maps the existing GitHub and Cloudflare machinery onto it with exact gaps, and splits the remaining [WH-056](roadmap/backlog.md#wh-056--standardize-bounded-external-lookups-and-reviewed-connector-actions) work into WH-141–146. It is a **planned contract**. It adds no table, route, OAuth client, scope request, provider adapter, binding or deployment. The [offline reference](../tools/prototypes/connectors.mjs) and [conformance harness](../tests/connectors-contract.mjs) exercise the frozen catalog and a synthetic in-memory runtime with fake providers. No Worker imports them.

This contract uses these existing contracts and does not replace them: the [connection vault and key lifecycle](connection-key-lifecycle.md), [GitHub](integrations/github-connection.md) and [Cloudflare](integrations/cloudflare-connection.md) authorization, [Chat connection handoffs](chat-connection-handoffs.md), [WH-122 feature admission](feature-admission.md), the [WH-052 job envelope](job-envelope.md), [WH-116 data protection](data-protection.md) with the [lifecycle catalogue](data-lifecycle.json), the [inference privacy handoff](inference-privacy.md), the [bounded connection contracts](pricing-and-model-policy.md#bounded-connection-contracts) and the [current-version policy](current-version-policy.md). Its style and versioning follow the [shared module contract](shared-modules.md).

## Decision

Every connector is a **server-owned catalog entry plus maintained adapter code**. It is never a generic HTTP client, a customer script or a model tool that takes URLs. A provider adapter can only:

1. Authorize through its catalog `authorization` endpoints with exact scopes and bounded lifetimes, and store credentials only in the existing encrypted vault.
2. Execute declared **operations**. Each operation has a fixed origin, a path template, typed parameters, closed query and body shapes, required scopes, an authority class, a consent kind, allowed destinations, a WH-116 data class, response bounds and an explicit price.
3. For actions, use one exact review, one atomic dispatch claim, a durable minimized receipt and read-only reconciliation through declared reads.

The contract does not change GitHub/Cloudflare behaviour, enable any planned provider or narrow any provider's stricter existing rules. A provider may be narrower than this contract, never broader.

## Catalog shape (contract version 1)

The frozen catalog is `connectorCatalog` in the [reference](../tools/prototypes/connectors.mjs). `validateCatalog` rejects an unknown version, field, provider or authority class. It also rejects any widening shown in the table below.

| Element | Frozen v1 rule |
| --- | --- |
| Provider entry | `{readiness, featureId: "connections.<provider>", authorization, origins[], scopes[], operations{}}`. `featureId` must be the existing [launch feature](../src/plan-features.ts) for the same provider. |
| `authorization` | `{kind, authorize, token, revoke, revocation, refresh, maxAccessSeconds ≤ 28800}`. Endpoints are fixed `https` URLs with no port, userinfo, IP literal, wildcard or query. `revoke` is `null` only for `local-only-owner-removal`. `refresh` is one of `none`, `retained-unused` or `single-flight`. |
| `origins` | Exact API origins. An operation origin must be one of them. No redirects are followed: every request uses `redirect: "manual"`, and a 3xx response is refused. |
| `scopes` | The complete set the provider client may request. Each operation names its required subset. A token response that grants scopes outside the set is refused. A grant that lacks an operation's scope refuses that operation before dispatch. |
| Operation id | `<resource>.<verb>`, unique per provider. |
| `kind` / `feature` | A `read` maps to WH-122 feature operation `read`. An `action` maps to `dispatch`, preceded by `prepare`/`confirm` reviews. |
| `method`, `origin`, `path`, `query`, `body`, `params` | `GET` or `POST`. The path is a template whose `{param}` slots are percent-encoded server values of closed types (`int`, `hex32`, `login`, `repo`, `branch`, `hostname`, `opaque`, `instant`, `query`). Query keys and constants are fixed. A body is `null`, a registered fixed GraphQL document or a closed JSON field list. There is no URL, host, path, header or free-form query parameter. |
| `authority` | Starts with `owner-request`. Only an action may add `approved-rule` ([authority](#authority-classes)). |
| `consent` | `owner-control` for metadata or review inputs shown only to the owner. `request-bound` for provider-selected content, and always for a `model-context` destination ([consent](#request-bound-lookup-and-data-use-consent)). |
| `destinations` | A subset of `owner-panel`, `chat-reply`, `model-context` and `review-receipt`. |
| `dataClass` | The WH-116 lifecycle class that governs every persisted copy ([data](#data-classification-wh-116)). |
| `review`, `idempotency`, `reconcile` | Reads have none. An action has `review: "exact"`, one idempotency kind (`precondition-and-mutation-id`, `marker-readback` or `provider-idempotency-key`) and at least one declared reconcile read. A reconcile read has owner-request authority only. |
| `price` | `{customerUnits, basis}`. `0` with `plan-inclusion`, or a positive integer with `quoted` ([price](#price)). |
| `bounds` | `maxBytes ≤ 1 MiB`, `maxItems ≤ 100`, optional `maxRangeDays`. Requests also keep the existing ten-second timeout. |

Provider readiness is one of `planned`, `synthetic-conformant`, `private-test` or `live-accepted`. It is catalog metadata, and the catalog never derives it. Only a recorded acceptance packet may raise it: WH-031/032 for the existing providers, WH-096–100 for the new ones.

## The four distinct states

The server reports each connection as four separate facts. It never collapses them into one "enabled" flag. Each operation call rechecks the facts it needs.

| State | Values | Source | Effect |
| --- | --- | --- | --- |
| **Inclusion** | `included` / `not-included` | WH-122 `featurePredicate` for `connections.<provider>` and the operation (current invoice coverage or exact preview grant) | New connects, reads, reviews and dispatch require it. Status, history, disconnect/revocation and reconciliation of an existing uncertain receipt do not ([existing rule](feature-admission.md#protected-recovery-and-local-access)). |
| **Configuration** | `configured` / `unconfigured` | Platform client secrets and vault keyring present (`cloudflareConfig`, `githubConfig`) | Missing configuration returns 503 for start and use. Configuration does not prove that consent works. |
| **Consent** | `none`, `pending`, `active`, `expired`, `reauthorization-required`, `provider-rejected`, `revoking`, `revocation-pending`, `revocation-owner-action`, `revoked` | Vault and OAuth state for the owner | Only `active` admits provider use. Every other value reports honestly. |
| **Readiness** | Catalog readiness | Recorded acceptance evidence | `approved-rule` use requires `live-accepted`. Owner-request use in private test also needs the provider's own activation gate. |

Common conformance (WH-146) at most raises a provider to `synthetic-conformant`. It does not establish provider acceptance, customer consent or plan availability.

## Authority classes

Each operation declares which authority classes may invoke it. The principal is derived on the server and never taken from request JSON.

| Class | Principal | May invoke |
| --- | --- | --- |
| `owner-request` | The current admitted workspace owner (WH-113 `admitWorkspace`), acting through an explicit Settings control or a server-issued Chat card. Actions also need recent authentication where the existing review requires it. | Any declared operation, subject to inclusion, consent, scope, review and consent rules. |
| `approved-rule` | A WH-052 job envelope with purpose `deterministic-rule` and an exact approved rule revision. The approval binds `{operationId, destinationDigest, bodyTemplateDigest, maxPerPeriod}` and the credential identity at approval. | Only actions that list `approved-rule`, and only when provider readiness is `live-accepted`. The destination and template must match the approval exactly, and the limit is enforced at claim. Rules can never read or reconcile. |

Every other context is refused before any credential is read. This covers visitors, published-site/app requests, QuickJS customer runtime, webhooks/incoming messages, schedules without an approved rule, the owner-maintenance agent's own tool calls and content returned by a provider. A provider adapter **never imports or invokes owner-maintenance inference**. It never shares that agent's context, credentials or funding. Any customer-configured runtime AI is a separate WH-079 capability and is not a connector caller. Holding a scope does not grant authority. Gmail `gmail.send` permits sending, but `message.send` is owner-request-only, so a rule cannot call it.

v1 declarations: every GitHub, Cloudflare, Gmail, Google Calendar, Outlook and Microsoft Calendar operation is `owner-request` only. The single rule candidate is HubSpot `contact.create` (from an admitted lead), and it stays unusable until WH-100 live acceptance and WH-069 rule admission. Adding a rule-eligible operation is a catalog change that needs its own review.

## Request-bound lookup and data-use consent

OAuth consent authorizes Whumpo to hold a credential. It does not authorize copying mailbox, calendar or CRM content anywhere. For operations with `consent: "request-bound"`:

1. The owner asks, or the agent proposes, an exact bounded lookup. The server validates it against the operation (typed parameters, item/byte/range bounds) and **issues** a lookup-consent record: `{owner, provider, operationId, credentialId, paramsDigest, destination, expiresAt ≤ 15 min, state}`. A proposal from the model creates nothing executable.
2. Only the current owner principal can confirm it, through a server-issued card or control. Model output, provider content and rule jobs cannot confirm it.
3. The read must match the confirmed record exactly: same owner, provider, operation, credential, parameter digest and destination. The record is single-use, and disconnect or reconnection voids it.
4. `model-context` is admitted only when the selected inference route is recorded as **not training-enabled and approved for connector content** under the [inference privacy handoff](inference-privacy.md#required-admission-record-for-a-future-route). The current Muse Contributor test route is training-enabled, so real connected content cannot reach it. `owner-panel` display remains available. Synthetic fixtures may exercise the path.
5. Results carry `provenance: "untrusted-external"`. Nothing in a result can confirm consent, approve a review, select a tool, widen a destination or become an instruction. Only results whose operation lists that destination may enter Chat history.

`owner-control` reads serve only the owner's explicit control or card. Examples are GitHub installations/repositories, Cloudflare zones, and review inputs such as repository identity or DNS inventory. They return minimized metadata, never mailbox/calendar/CRM content, and cannot target `model-context`.

## Actions, receipts and unknown outcomes

Actions reuse the pattern already proven by [GitHub backups](integrations/github-backups.md) and [Cloudflare DNS](integrations/cloudflare-dns.md):

| Step | Rule |
| --- | --- |
| Prepare (`prepare`) | Owner-request or approved rule. Reads only declared review inputs. Writes an immutable receipt in `review` with `operationDigest` (the catalog declaration), `requestDigest` (typed params and body), `credentialId`, destination, price, `reviewDigest` and expiry. |
| Confirm (`confirm`) | Rechecks the current principal, inclusion, consent (the same credential), operation digest, review digest, unexpired review and accepted price. Any change makes the review stale, and a fresh review is needed. |
| Claim (`dispatch`) | One compare-and-swap `review → dispatching` that repeats the inclusion and credential predicates inside the committing statement (as `confirmBackup`/`confirmDNS` do today). Only the claimant sends, exactly once. |
| Settle | Verified 2xx gives `applied`, with the provider object ID saved. A definitive provider rejection gives `failed`. A timeout, lost reply, 3xx, 408/429/5xx, unreadable or unverifiable reply, or a local access change after dispatch gives `uncertain`. A provider adapter may treat 429 as definitive only if the provider documents that throttled requests have no effect. |
| Retry / replay | A repeated confirm on any non-`review` receipt returns the saved state and **never redispatches**. |
| Reconcile | Owner-request only, bound to the receipt's recorded destination. Uses only the action's declared `reconcile` reads and the same credential. A match gives `observed`. No match keeps the receipt `uncertain`, which can then go to operator review. Losing eligibility does not block reconciliation, and reconciliation never authorizes a new mutation. |

The idempotency kinds are `precondition-and-mutation-id` (GitHub `expectedHeadOid` with `clientMutationId`), `marker-readback` (Cloudflare record comment, or a message/contact marker property the adapter can search for) and `provider-idempotency-key` (a client-chosen event ID or transaction ID, where the provider documents it). A provider without one of these cannot offer that action.

Receipt states are frozen as `review | dispatching | applied | unchanged | uncertain | observed | failed | expired | cancelled`. Existing tables keep their own names until WH-142: DNS uses `sending` for `dispatching`, and GitHub uses `pending`/`complete` for `review`/`applied`.

## Credentials, refresh and revocation

- **Vault.** All providers use the existing AES-256-GCM keyring vault. Ciphertext is authenticated to provider, purpose, owner and record ([lifecycle](connection-key-lifecycle.md)). Plaintext and ciphertext never enter Chat, model context, logs, exports, GitHub or fixtures.
- **Token admission.** Only Bearer tokens with an explicit lifetime of at most `maxAccessSeconds` and at most the catalog scopes become active. A missing `scope` means the requested scopes, per RFC 6749. A refresh token returned to a `refresh: "none"` provider is refused for activation and retained only as revocation work, as Cloudflare does today. One active credential per owner and provider. Replacement requires disconnect first, unless a provider's existing reconnect rule is narrower (GitHub's reviewed reconnect remains).
- **Refresh (`single-flight`, planned for Google, Microsoft and HubSpot).** A refresh happens only inside an operation that has already been admitted. There is no background keep-alive. A per-credential claim admits one token-endpoint call. A rotated refresh token is stored atomically before the old one is discarded, and refreshed scopes may not widen. `invalid_grant` gives `reauthorization-required`. A lost refresh reply fails only that use. The next admitted use may retry the same retained refresh credential under a new claim, because a refresh is a credential outcome with no customer-visible side effect. GitHub stays `retained-unused`: refresh custody is kept for revocation and never used. Cloudflare stays `none`.
- **Revocation.** Disconnect first disables local access atomically, voiding lookup consents and blocking new claims. Then it calls the provider's revocation with the existing lease/claim discipline. Only a definitive acknowledgement settles remote revocation. Failure keeps encrypted revocation work (`revocation-pending`). Microsoft has no per-token delegated revocation endpoint, so it reports `revocation-owner-action` and points the customer to remove app consent; it does not claim remote revocation. A request already dispatched cannot be recalled. Its receipt keeps reconciling.
- **In-flight change.** Each provider reply is checked again against the exact captured credential identity, consent state and inclusion before use. A disconnect, replacement or eligibility loss during a read discards the result. During an action it settles the receipt as `uncertain`.

## No arbitrary outbound fetch

- Only catalog adapters in the platform Worker hold provider credentials or call provider origins. The QuickJS customer runtime, visitor/site Workers and generated source get no connector capability, network binding or credential.
- A request is built only by the server from an operation ID and typed parameters (`buildRequest` in the reference). A provider pagination URL such as Graph `@odata.nextLink` is never followed as a URL. The adapter extracts its opaque token, revalidates it as an `opaque` parameter and rebuilds the request from the same template.
- There is no continuous sync, polling, mailbox indexing, webhook-driven maintainer call or unattended read-and-reply loop.

## Price

Every operation declares its customer price, and the review binds it. v1 sets all seven providers to `{customerUnits: 0, basis: "plan-inclusion"}`: the connection is a Business/Business Pro benefit with no per-use charge. Confirmation must echo the exact reviewed price, and a changed declaration makes the review stale. A future nonzero `quoted` price must appear in the consent or review card and debit through the existing billing ledger with an exact receipt. It is never inferred. Provider-side costs to Whumpo, such as Google restricted-scope assessment, publisher verification or distribution limits, are operator costs tracked in the [pricing contract](pricing-and-model-policy.md#provider-readiness-costs-and-sequencing), not customer prices. This document enables no paid service.

## Data classification (WH-116)

| Data | Class | Status |
| --- | --- | --- |
| Credentials, OAuth state, revocation work, Chat return links | `connections` | Current. Export is metadata only. |
| GitHub/Cloudflare discovery metadata (installations, repositories, zones) shown to the owner | `connections` ("selected resource metadata" export policy) | Current. These are server-formatted Chat replies; WH-142 must confirm whether they re-enter later model context and register that exposure. |
| GitHub backup receipts and reconcile reads | `github-backups` | Current |
| Cloudflare DNS reviews/receipts and inventory reads | `domains-dns` | Current |
| Provider-selected mailbox/calendar/CRM content (owner panel, approved model context) | `connector-content` | **Planned** reservation (`planned-adapter`). WH-143 must admit it with exact tables, readers, the retention window (an owner decision) and deletion/export rules before any adapter persists content. The default is not to persist: show and discard. |
| Minimized action receipts for new providers | `connector-receipts` | **Proposed new class.** It splits receipts out of the `connector-content` reservation so receipts can outlive transient content. WH-143 registers it. |

A **minimized receipt** contains: receipt ID, owner, project (if any), provider, operation ID, authority class, rule revision (if any), credential ID, provider account ID, exact destination identifier, `operationDigest`, `requestDigest`, `reviewDigest`, price, state, provider object ID, bounded detail code and timestamps. It never contains the message/event/contact body, attendee or recipient lists beyond the reviewed destination digest, provider error bodies or credentials. The reviewed body itself lives only in `connector-content` under its retention rule, and the receipt keeps its digest.

## Existing GitHub and Cloudflare machinery

The existing code already provides credential custody, account binding, feature admission, exact reviews, atomic dispatch claims and read-only recovery. What is missing is the common, declared form of these. The harness checks the pure parts against the catalog: the GitHub `BackupPaths` document, `backupRecoveryRead`, `dnsRecoveryRead` and vault context isolation.

| Contract element | GitHub ([connection](../src/github-connection.ts), [backups](../src/github-backups.ts)) | Cloudflare ([connection](../src/cloudflare-connection.ts), [DNS](../src/cloudflare-dns.ts)) |
| --- | --- | --- |
| Fixed hosts, manual redirects, timeouts, size bounds | Implemented. API base fixed to `api.github.com`; 512 KiB JSON; 16 KiB token reader. | Implemented. `api.cloudflare.com/client/v4`; 256 KiB. |
| Operation-declared paths and methods | **Gap G-GH-1.** `githubAccess().send` accepts any path beginning with `/`, any method and a caller-chosen `operation` argument. Only recovery reads are allowlisted (`backupRecoveryRead`). | **Gap G-CF-1.** `cloudflareAccess().send` uses a path regex that allows any query string on `/zones/{id}`, `/dns_records` and `/dns_records/{id}`. POST is limited to `dns_records`. Operations are not named. |
| Scopes and permissions | App permissions `metadata:read` and `contents:write` are set on the GitHub App. User tokens must be expiring `ghu_` tokens of at most 8 h. | Exact `zone.read dns.read dns.write`; explicit broader grant refused. Implemented. |
| Authority class | Implicitly owner-request; no rule path exists. **Gap G-C1:** not declared. | Same (**G-C1**). |
| Inclusion / configuration / consent / readiness | Implemented separately (`connectionInclusion`, `githubConfig`, saved status, `plan-features` `implementation: private-test`). **Gap G-C2:** readiness lives only in launch packaging, not in an operation-checked catalog. | Same (**G-C2**). |
| Exact review, atomic claim, durable receipt | Implemented (`github_backups`: `pending → dispatching → complete / uncertain / failed`, claim predicate includes inclusion and active token). | Implemented (`cloudflare_dns_actions`: `review → sending / unchanged → applied / uncertain → observed`). |
| Unknown-outcome reconciliation without redispatch | Implemented (`backupRecoveryRead`, expected-head precondition, `clientMutationId`). | Implemented (`dnsRecoveryRead`, comment marker). |
| Explicit price in review | **Gap G-C5.** The review text does not state "included in your plan; no per-use charge", and the price is not bound into the review digest. | Same (**G-C5**). |
| Lookup/data-use consent | Not needed for current metadata (`owner-control`). **Gap G-C6:** discovery replies' later model-context exposure is unverified (see data table). | Same (**G-C6**). |
| Refresh | Refresh custody retained, never used (`retained-unused`); grant revocation is a separate reviewed flow. Conforms. | None requested; unexpected refresh refused. Conforms. |
| Revocation | Single-token delete with claims plus a reviewed app-grant removal. Conforms. | RFC 7009 with lease. Conforms. |
| Provider type unions | **Gap G-C4.** `ConnectionProvider`, `isConnectionProvider` and `connectionFeature` accept only `github`/`cloudflare`. | Same |
| Vault contexts | **Gap G-C3.** The vault context pattern admits only `github`/`cloudflare` token/PKCE and GitHub refresh. New providers need catalog-derived contexts, coordinated with WH-117 key lifecycle. | Same |
| Common receipt names | **Gap G-C7.** State names differ per table. A shared receipt view or adapter is needed; the existing tables need no rewrite. | Same (**G-C7**). |

None of these gaps is a known exploitable defect: hosts are fixed and all current callers pass server-built paths. They are places where the contract is only implicit. WH-141/142 close them without new scopes, endpoints or customer-visible behaviour.

## Planned provider declarations

The table below records the frozen operation **set** and authority for each new provider. Hosts, scopes and paths are planning values taken from the [September 30 bounded connection contracts](pricing-and-model-policy.md#bounded-connection-contracts). They were **not re-verified** in this offline session. Each provider's contract child (WH-096–100) must verify them against current provider documentation, with dates, before registering a client. The planning-only [provider readiness plan](connector-provider-readiness.md) (October 9, 2026) re-reads them against official documentation and lists the differences, external approvals and counsel questions; it changes no declaration.

| Provider (packet) | Reads (`request-bound` unless noted) | Actions (all owner-request unless noted) | Revocation / refresh | Notes requiring verification |
| --- | --- | --- | --- | --- |
| Gmail (WH-096) | `messages.search` (≤10), `message.get` | `message.send` (marker readback) | RFC 7009 / single-flight | `gmail.readonly` is restricted and `gmail.send` sensitive; security assessment and data-use terms are launch prerequisites. |
| Google Calendar (WH-097) | `calendars.list` (`owner-control`), `events.range` (≤31 days) | `event.create` (client event ID) | RFC 7009 / single-flight | Granular calendar-list and owned-event scopes; update/delete are added by WH-097 with the same rules. |
| Outlook email (WH-098) | `messages.search`, `message.get` | `message.send` (marker readback) | owner removal / single-flight | `sendMail` returns no message ID, so readback relies on a marker. Personal versus work/school accounts and tenant consent need checking. |
| Microsoft Calendar (WH-099) | `events.range` (≤31 days) | `event.create` (transaction ID) | owner removal / single-flight | `Calendars.ReadWrite` is broader than selected calendars, so Whumpo enforces the selection. |
| HubSpot (WH-100) | `contacts.search` | `contact.create` (**owner-request + approved-rule candidate**) | refresh-token delete / single-flight | The refresh-token delete API carries the token in the URL path. That conflicts with the "never in URLs" rule, and WH-100 must decide on it. Preserve unmapped fields. |

## Delivery slices

WH-056 stays the parent with its acceptance unchanged. It closes only when every child below is accepted. Provider sandbox and customer acceptance stay in WH-031/032 (existing providers) and WH-096–100 (new providers), which depend on WH-056. Task scopes live in [backlog.json](roadmap/backlog.json).

| ID | Slice | Depends on |
| --- | --- | --- |
| WH-140 | Freeze this contract, offline reference/conformance harness and decomposition | WH-004, 009, 052, 105, 116, 122 |
| WH-141 | Shared source catalog, request builder and operation admission; catalog-derived provider unions and vault contexts (G-GH-1, G-CF-1, G-C1–C4) | WH-140, WH-117 |
| WH-142 | Adapt GitHub/Cloudflare handlers to the catalog: explicit price, receipt view, metadata exposure check; run the conformance suite against the D1 handlers (G-C5–C7) | WH-141 |
| WH-143 | Request-bound lookup consent, common minimized receipts, `connector-content`/`connector-receipts` admission, Chat card bindings, model-route gate | WH-141, WH-009, WH-105, WH-116 |
| WH-144 | Single-flight refresh custody and local-only/owner-action revocation for refresh-token providers (synthetic) | WH-141, WH-117 |
| WH-145 | Approved deterministic-rule bridge from the WH-052 envelope to rule-eligible operations | WH-143, WH-052 |
| WH-146 | Connected synthetic acceptance on local D1, plus privacy/deletion and rate-limit review | WH-142, WH-143, WH-144, WH-145 |

## Open owner decisions

1. **Connector content retention** (before WH-143 admits `connector-content`). Options: never persist (show and discard; the receipt keeps digests only), keep for the Chat card's seven-day retention, or an owner-configurable bounded window.
2. **Rule-eligible connector actions at launch.** This contract allows only HubSpot `contact.create` as a candidate. Confirm it, or confirm that no connector action is rule-eligible at first launch. Gmail/Outlook automated notifications would otherwise use the WH-036 platform sender.
3. **HubSpot refresh-token revocation URL.** Accept HubSpot's documented path-token delete as a narrow exception, with the request excluded from all logging, or treat HubSpot as `local-only-owner-removal`.
4. **Parent verification wording.** The WH-056 packet lists "Approved provider sandbox acceptance", but every provider packet depends on WH-056. This decomposition puts sandbox acceptance in WH-031/032/096–100. Confirm, or reorder so that WH-056 waits for them.

## Verification

`node tests/connectors-contract.mjs` runs 71 offline checks. It validates the frozen catalog and rejects widened hosts, scopes and paths. It covers typed request construction and agreement with the existing pure GitHub/Cloudflare recovery, vault and catalogue functions. A reusable `runConformance` suite runs against the synthetic reference runtime with fake providers. It checks the host allowlist and redirect refusal, scope refusal, revoked, expired and provider-rejected credentials, single-flight refresh, in-flight disconnect, and lost-response reconciliation without a duplicate side effect (lost before or after acceptance, plus concurrent confirmation). It also checks consent binding, the training-route refusal, untrusted external data, owner-request-only operations refused from rule context and other principals, rule destination/limit/readiness gates, the four separate states and price binding.

These checks prove the frozen contract and the reference only. They do not prove D1 atomicity, real provider behaviour, OAuth consent or acceptance. No database, network, model, credential, Cloudflare resource, CMS test or deployment is involved.
