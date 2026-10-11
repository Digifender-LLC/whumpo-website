# Shared job and outbox contract

**WH-052 decision, October 2, 2026 (UTC), source review `e21a106`.** Extends the [existing D1/cron ADR](background-jobs.md), consumes [WH-071 resource identity](workload-placement.md) and the deployed [workspace identity](workspace-identity.md). This is an offline reference contract and SQLite transaction prototype. There is no runtime job API, dispatcher, general authority resolver or new service binding.

## One intent, separate receipts

A domain handler first admits a specific action under current authority and records its immutable review/operation receipt. If work must continue asynchronously, the **same supported transaction** records the job envelope and outbox entry. A wake-up names that saved job; it cannot define a new action, grant access or replace its domain receipt.

The envelope is a closed, version 1 JSON object, bounded to 8 KiB and ten levels. Unknown fields, non-integer numbers, unknown/currently unsupported versions, unregistered purposes and invalid pins are rejected. There is no old-envelope reader or default interpretation of a missing field. Runtime integration adds the current canonical schema and resets obsolete test fixtures; it does not preserve the previous untyped prototype representation.

| Immutable field | Meaning and bounds |
| --- | --- |
| `contractVersion`, `jobId` | Exactly `1`; unique UUID. Same ID and exact canonical digest reads the existing job; changed input conflicts. |
| `ownerAccountId`, `projectId` | Exact tenant account UUID; explicit null for account scope or exact project UUID. Ownership must still be resolved from authoritative state. |
| `purpose`, `adapter` | One reserved domain purpose and exact `{name, version, digest}` adapter pin. Version 1 names are in the table below. A shape-valid digest is not admission to a trusted runtime catalogue. |
| `actor` | One of the three closed authority-reference shapes below. IDs and revisions are provenance, never a serialized authenticated principal or bearer credential. |
| `resource` | Explicit null for the defined account-scoped jobs, or `{ref, descriptorDigest, module, schema, placementRevision}`. `ref` and pins reuse the WH-071 validators. Every resource belongs to `projectId`; pin/descriptor/placement drift refuses dispatch. |
| `intent` | `{operationId, receiptId, receiptDigest, revision, inputReferenceId, inputDigest}`. IDs resolve registered domain selectors. There is no arbitrary SQL, script, URL or inline payload. The exact approved effect and target remain in the domain receipt. |
| `eligibility` | An exact feature/operation/project request when required by the adapter. The current deterministic-rule example requires `business.workflows`, `dispatch`, and its project. Other reserved examples use null and retain their domain policy; null never means unrestricted access. New paid operations must register their exact request before implementation. |
| `schedule` | `{createdAt, notBefore, expiresAt}` in epoch **milliseconds**; creation ≤ due < expiry. Identity epochs are counters, not timestamps. Domain policy determines the allowed lifetime; expiry stops new work and cannot erase an unknown effect. |
| `limits` | `{maxAttempts, deadlineMs}`: 1–3 attempts and 1–20,000 ms per admitted handler. A lease may cover bookkeeping beyond the handler deadline. More retries or longer tasks require a reviewed contract/adapter change, not client/model flags. |

The reference hashes canonical JSON with SHA-256. Canonical object key ordering is irrelevant; any actor, intent, schedule, adapter, resource or budget change creates a different digest. The complete immutable envelope is retained in the journal for exact replay/readback; indexed tenant/purpose/due fields are derived from it.

## Actor references and current admission

| Shape | Current checks required by the implementing adapter |
| --- | --- |
| `workspace-session`: `accountId`, `authorityId`, `authEpoch`, `purpose: "workspace"`, `membership` | Resolve the same current workspace principal through WH-113/114; check session existence/expiry, current account/credential/epoch and any fresh-proof requirement. A restricted enrollment/recovery grant cannot issue this intent. No token is stored in the job. An expired/revoked initiating session stops unsent interactive work; prepare a fresh exact action rather than minting a session from the job. |
| `approved-rule`: `ruleId`, `revision`, `approvalReceiptId` | Resolve an explicit current deterministic rule and its approval; check tenant/project, enabled revision, owner/member authority, inputs/target, current feature inclusion and independent runtime funding/quota. It cannot borrow the maintainer's session, AI, provider credentials or standard-assistance funding. WH-069 owns this resolver. |
| `platform-obligation`: `obligationId`, `policyRevision` | Resolve the exact server-created domain obligation and current policy. This may survive the initiating browser session for an explicitly reviewed closure or mandatory security notice, but grants only that operation. Check cancellation, suppression, preservation, tenant/recipient/provider scope and current state. It cannot reopen a workspace or become a general owner action. |

For a workspace owner, `membership` is null and `accountId` equals `ownerAccountId`. A future member reference has `{id, revision}` with a distinct acting account. That shape does **not** implement membership: until WH-054 supplies its server resolver and tests (proposed in [workspace collaboration](workspace-collaboration.md#jobs-receipts-and-immutable-history), which would also replace the null-membership owner form above because every actor, owners included, would act through a membership; until that ships this paragraph is the current rule), runtime admission must refuse it. Replays and retained history also recheck current membership before disclosure. Updating a role, removing a member or transferring a resource invalidates the old reference; a copied role or `allowed` field is rejected.

Do not implement authentication by comparing these JSON fields. The shared identity admission capability remains module-private. The runtime domain adapter must consume it or an independently verified rule/obligation, and use atomic current predicates with local writes. Job claims, operator re-drive, restored journals and valid envelope hashes create no authority. The offline validator proves only structure and reference consistency.

Immediately before dispatch and commit, resolve the current WH-071 resource descriptor/placement and exact adapter/schema. Read the current eligibility, recipient preferences, provider credential identity and review state; never persist an open DB handle or freeze inclusion at enqueue. If a physical placement or module changes, reject the stale snapshot and reconcile the old intent. Do not silently route the old write to a new adapter or accept an obsolete schema. Across services/providers, retained receipts and fences handle uncertainty; there is no distributed transaction guarantee.

## Reserved adapter examples

These are concrete contract examples in [job-envelope.mjs](../tests/fixtures/job-envelope.mjs), with synthetic UUIDs and artifact digests. The names reserve future maintained adapters; none is activated by this decision.

| Purpose / adapter name | Actor / scope | Registered inputs and result | Required future implementation |
| --- | --- | --- | --- |
| `platform-email` | Platform obligation; account scope | Exact notification/recipient/template revision in a domain receipt; message content stays in approved storage. Result distinguishes provider acceptance, uncertain send, bounce and delivery evidence. | WH-036 chooses a delivery provider and privacy/consent policy. Platform delivery is separate from customer mailbox OAuth; no arbitrary sender/recipient or recovery secret in the outbox. |
| `deterministic-rule` | Approved rule; pinned project automation resource | Exact rule revision, event/input receipt and approved action. Result commits only the allowed resource change or its external-operation receipt. | WH-069 owns rule admission, feature/funding checks and fairness; WH-067 supplies maintained record/action adapters and WH-068 notification configuration. No model invocation to interpret or repair a rule. |
| `owner-push` | Platform obligation; account scope | Notification intent and current registered owner device/subscription, looked up inside the adapter. A generic notice plus opaque saved receipt reference avoids private lock-screen content. | WH-086 provides FCM consent, current device revocation, privacy, TTL and delivery acceptance. Provider acceptance is not a device-open/read receipt. |
| `account-cleanup` | Reviewed closure obligation; account scope | Exact closure manifest, grace/preservation/suppression state and registered phase/cursor. Each local chunk commits data and cursor together; external deletion has a separate intent/result. | WH-018/019 own the executor and independent restore suppression. The journal cannot authorize deletion of shared infrastructure or customer-owned provider resources. |
| `project-build` | Current workspace session; pinned project resource | Exact source/specification version and reviewed build input; result artifact/checks reference. Build success is separate from publication or activation. | **Implemented in source for the application build path (WH-074, [build jobs](build-jobs.md))**: owner-Chat-only admission, per-job lease digest and expiry, one spend, cancel/expire refusal, private artifact key and publish ownership trigger, append-only cleanup records, deterministic diagnostics and project/account/pool bounds. Not deployed. No owner AI invoked as a retry path; a model repair is offered only on a new owner request. |

An implementation registers the real pinned code, data/lifecycle class, input and result schemas, auth/eligibility functions, cancellation boundary, supported readback and cost policy **before** accepting an envelope. Extensions amend the one current contract and add their own tests; they do not invent another scheduler or permission engine.

## Delivery, fences and honest recovery

The separate closed wake is at most 512 bytes:

```json
{"contractVersion":1,"deliveryId":"UUID","jobId":"UUID","envelopeDigest":"SHA256"}
```

The outbox generates one stable delivery ID in the job admission transaction. A lost enqueue reply reads the same job/outbox, and a lost delivery acknowledgement resends the same identity. `acknowledged_at` records the producer's transport submission acknowledgement only, never domain completion or consumer settlement. A consumer acknowledges its message only after a domain result or durable uncertain/operator state commits; the offline prototype does not implement that transport consumer. D1 state is authoritative even after message expiry or dead-letter deletion. A trusted receiver loads and matches the saved envelope before attempting the current-state claim; an unknown job, wrong digest, or wrong delivery ID cannot create work. Transport authentication remains the implementing boundary.

Leases increment a monotonic fence. A duplicate/out-of-order wake cannot claim already leased, cancelled, expired, completed or uncertain work. Expired **pre-dispatch** leases may be reclaimed. Once an intent is recorded, an expired lease means an uncertain attempt; it never resets the operation to ready. The immutable envelope's `intent.operationId` identifies the domain action; the prototype's `attempt_id` identifies one possible remote attempt. They are distinct from the transport delivery ID. Provider idempotency must follow its approved domain/provider contract, not blindly use queue or attempt IDs.

An unsent job that reaches its expiry becomes `expired`; an in-flight effect remains held for reconciliation beyond that time. Cancellation likewise prevents new steps but retains any eventual effect evidence. Only authenticated domain readback can complete or establish that an operation provably was not sent and its former sender cannot later act. The prototype's manual evidence functions are trusted fixture inputs, not an operator HTTP API. There is no bulk “retry uncertain” action.

Current restore requires the same envelope/adapter/schema, then replays independent deletion suppression, revocation, cancelled intent and provider results before dispatch. A restored job does not restore its session, member access, provider token, review approval or idempotency guarantee. Missing state/keys or an unqueryable provider result goes to a durable restricted operator backlog. Terminal retention is domain/lifecycle policy; job TTL, queue retention and workflow retention are not permission to erase unresolved evidence. The control journal cannot replace the independent restore-suppression store.

## Evidence and delivery boundary

- `node tests/job-envelope-contract.mjs`: current metadata, email/rule/push examples, resource pin/placement drift, restricted-actor shapes, unknown/oversized/secret fields, exact scope and wake identity.
- `node tests/job-journal-prototype.mjs`: disposable file-backed SQLite; same-envelope replay, atomic outbox rollback, two connections, expired leases/fencing, duplicate wakes, response loss, bounded proven-unsent retries, expiry/cancellation and scoped local cleanup with restart.
- `node tests/workload-placement-prototype.mjs`: the reused reference shapes preserve the existing WH-071 acceptance.

These checks do not prove runtime authorization, D1 transaction integration, real provider idempotency/latency, notification delivery, account closure or load/fairness. Implementing packets retain those gates and must use the complete current schema. No CSAM detector/scanner is called or implemented; the uncertain-scan trace in the original ADR is conceptual only. CMS testing and Daybreak remain deferred. The existing cron schedules and Worker deployment are unchanged.
