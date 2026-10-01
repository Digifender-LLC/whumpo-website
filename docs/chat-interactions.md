# Owner Chat interaction contract v1

**WH-105 decision, October 1, 2026; source `26b9fa496aa34c304434b53352fd2dc1451c1711`.** [Issue #51](https://github.com/zemdregon/whumpo/issues/51). This freezes the protocol and implementation handoffs for [primary Chat](roadmap/chat-first-experience.md). The offline reference and fixtures are implemented; production persistence, adapters, rendering and customer acceptance remain WH-106–112. No endpoint, schema, model tool or permission is activated here.

The first complete journey is **existing-project content brief → private comparison/preview → exact private save → separate publication review**. It works with the delivered content compiler and requires neither CMS nor a new provider. The following preserves every current domain review, including the explicit review before saving a structured private version. Customer visitor forms and app presentation remain separate WH-067/070 contracts; a visitor never acquires owner Chat or maintainer inference.

**Owner amendment, October 1:** Whumpo is current-version-only. No legacy schema/client decoder, downgrade renderer, compatibility projection or old-route adapter is supported. This supersedes the earlier roadmap compatibility language. Reset obsolete test data before a cutover; reject stale requests explicitly. Saved receipts retain their exact facts and never become authority to run an older path.

## Source-grounded journey inventory

| Journey | Current foundation | Required interaction handoff |
| --- | --- | --- |
| Ask, inspect, answer or edit | [ai-chat.ts](../src/ai-chat.ts), [site-agent.ts](../src/site-agent.ts), bounded inspection and validated `prepareSiteAction` | Add request-information/present/read-answer capabilities to the existing bounded turn. No second agent loop, raw command tool or arbitrary execution. |
| Inspect/change an existing page | [specification store](../src/project-specification/store.ts): `readSpecification`, `prepareSpecification`, `specificationPreview`, `applySpecificationCommand` | Bind selected content IDs and revision to a short form. Preparation creates a private proposal; existing `specificationApply` human control saves it. Keep compiler lock, safety, expiry and concurrent-draft checks. |
| Save/publish/restore/withdraw | [chat-controls.ts](../src/chat-controls.ts), [chat-review-receipts.ts](../src/chat-review-receipts.ts), specialized review cards and domain receipts | Use exact typed controls from revalidated server review metadata. Generic forms cannot carry these actions. Keep urgent withdrawal/recovery directly reachable. |
| Project intake and profile | Existing welcome/onboarding; `/api/projects`, owned details/profile handlers in [index.ts](../src/index.ts) | First project still precedes workspace access. Later-project briefs can collect answers; creation uses the existing validated handler with current limits. Profile/avatar edits retain their safe native controls. |
| Photos, connections, domains, billing | Existing authenticated upload/clearance, connection consent, domain ownership/reviews and sandbox checkout | Show an owned resource picker or a trusted handoff; never collect bytes, secrets, arbitrary URLs or payment information in generated forms. Return to the same task and recheck state. CMS testing remains deferred. |
| Dashboard and custom pages | [workspace-dashboard.ts](../src/workspace-dashboard.ts): `readLayout`, `saveLayout`, `dashboardData`; [workspace-shortcuts.ts](../src/workspace-shortcuts.ts) | Preserve the existing revision and data authority. Current seven widget kinds, eight tabs and five shortcuts per project tab are the delivered bounds; richer views require WH-109 adapters. |
| Delivery and history | [workspace.tsx](../frontend/src/workspace.tsx), [chat delivery](../frontend/src/lib/chat-delivery.ts), account-scoped session-storage recovery, [history](../src/chat-history.ts), [transcript export](../src/chat-transcript.ts) | Add durable element/snapshot references alongside text. Existing request/draft recovery is implemented; generic server form drafts and interactive history are not. History/export never recreate action authority. |

WH-113's [identity decision](workspace-identity.md) and WH-089's [feature catalogue](plan-feature-contract.md) were verified completed in issues #42/#44 before this claim. Their runtime implementations are separate gates. The currently deployed PWA consumes the same web client; [Android](android-app.md) must implement this exact current protocol through its own authenticated adapter.

## Wire objects and digest

The [offline reference](../tools/prototypes/chat-interactions.mjs) defines the closed v1 structural subset; [synthetic fixtures](../tests/fixtures/chat-interactions.json) are its readable examples. It performs no authorization, persistence, rendering, inference or network operation. Production code must enforce raw body limits **before** JSON parsing and use Workers-compatible hashing; importing this Node prototype into a Worker is not the implementation plan.

An issued element contains exactly:

```text
{ version: 1, id: UUID,
  scope: { accountId, actorId, conversationId, projectId: UUID|null, taskId, originTurnId },
  createdAt: UTC timestamp, expiresAt: UTC timestamp,
  definition: { version: 1, kind: "form"|"view", template, title, summary,
    presentation: "inline"|"panel"|"dialog", fields: [...], cards: [...],
    submitBinding: "interaction.answers@1"|null,
    continuationBinding: "site.content-prepare@1"|null },
  definitionDigest: SHA-256 hex }
```

All scope IDs are server-resolved UUIDs. The current owner account supplies both account and actor; future members retain a distinct actor. Conversation/task IDs are new logical identities in WH-106, not existing separate conversation tables. Origin turn must belong to the same account/conversation. V1 drafts/submissions belong to the issuing actor; another member cannot take over by knowing the ID. An explicitly authorized reassignment creates a new interaction and preserves prior receipts. Project can be null only for account-wide reads or intake that needs no project resource. Scope is association, not a bearer authorization token.

Hash the entire issued object except `definitionDigest`: sorted object keys recursively, array order preserved, JSON strings/numbers and UTF-8 bytes, no Unicode normalization. Reject non-JSON/non-finite values. Changing scope, target, revision, field order/labels/defaults, conditions, template, bindings, timestamps or presentation requires **a new interaction ID and digest**; old snapshots retain their meaning. Digest equality is integrity evidence, not proof that a client is entitled to issue an element. Production reads use the stored server-issued object, never a client-resealed replacement.

The agent proposes only a definition and owned references. The server verifies references, rebuilds saved defaults/provenance from owned state, selects permissible bindings, assigns scope/identity/time, validates, and persists the issued object. A model cannot assert `saved` provenance, choose another actor/conversation, extend a deadline, or mint an active review by computing a hash.

### Limits and fields

| Item | v1 bound |
| --- | --- |
| Complete issued element / definition / submitted answers | 32 KiB / 24 KiB / 16 KiB UTF-8; complete mutation body at most 32 KiB |
| Structural complexity | At most 10 container levels and 1,024 total visited JSON values, including arrays; no recursive components |
| Fields / cards / options | 12 fields, 8 cards, 12 options per choice; 20 rows per card; server output at most 32 KiB per element |
| Text | Title 100, summary 400, field label 80, help 240; short answer at most 200, long answer at most 2,000 UTF-16 code units; downstream field limits may be stricter |
| Identifiers | Field/content/card/choice: `[a-z][a-z0-9-]{0,39}`, reserved prototype names forbidden; owned IDs UUID; digest 64 lowercase hex |
| Conditions / groups | One equality condition per field against an earlier unconditional boolean or single-choice field; at most three flat numbered groups. No AND/OR trees, expressions or dependency cycles |
| Active work | At most 5 open forms per conversation, 20 per account, one automatic presentation per turn. Do not silently cancel old forms to fit a quota |
| Drafts / expiry | Draft revision CAS; no more than one accepted draft save per second per interaction, bounded existing account rate limits as well. Issued answer window at most 7 days; no heartbeat extension |

Every field has exactly `id,type,label,help,required,binding,constraints`, with optional `default,when,source,group`. `binding` is always `answer.value@1`; `id` is its key in the submitted snapshot. No model-authored endpoint, path expression or action payload appears in a field.

| Field type | Closed constraints and value |
| --- | --- |
| `text`, `long-text` | `{maxLength}`; plain string. Empty allowed only when optional. Render as text, including markup-like input; never interpret labels/help/answers as HTML. |
| `choice`, `multi-choice` | `{options:[{id,label}]}`; one option ID or unique option IDs. Required multi-choice is nonempty. |
| `boolean` | `{}`; true/false, including false as a complete answer. |
| `number` | `{min,max,step}`; finite value within ±1 billion and the step grid. No string coercion. Currency/spending is not implied by a numeric field. |
| `date` | `{}`; actual `YYYY-MM-DD` calendar date, no timezone conversion. |
| `datetime` | `{zone}` with an explicit supported IANA timezone; value is an exact UTC ISO instant with milliseconds. Renderer displays the zone and resolves ambiguous/nonexistent local times explicitly before submission. |
| `resource` | `{collection:"projects"|"photos",multiple,maxItems}`; UUID or unique UUID array, at most five. Picker queries a registered server collection, never arbitrary search/URLs. |
| `attachment` | Same shape, collection fixed to `photos`; references existing cleared project photos only. New uploads use the existing trusted photo flow and safety checks before a selectable reference exists. |

Optional `default` is `{value,provenance:"saved"|"user"|"suggested"}`. Saved text also has `source:{binding:"site.content@1",contentId,revision}`. The server verifies that source; suggested values are visibly suggestions. Defaults are not silently inserted on submission: the client submits the values the customer actually reviewed. An omitted required visible field fails validation. Reject answers for unknown or hidden fields, duplicates, missing owned resources, unsafe/removed photos, invalid dates and wrong types. Returning to a form may restore a hidden draft locally, but submitting it while hidden is rejected. `when:{fieldId,equals}` never executes code.

The full vocabulary is protocol scope. Clients implement the current admitted controls; a missing type or binding rejects the interaction with an explicit update-required result. There is no degraded form or read-only compatibility renderer. There are no password, passkey, recovery-key, OAuth-token, payment, file-byte, SQL or executable fields. Sensitive information accidentally entered in ordinary text follows content/privacy handling; field names alone cannot detect secrets or establish safe model processing.

Before issuance, the adapter also validates the proposed purpose/questions against its maintained task and content/privacy policy; a text field asking for a recovery key is still prohibited. Such a request must use the trusted identity flow instead. The offline structural checker cannot prove that arbitrary natural-language questions are safe; WH-108 must test semantic credential-solicitation rejection and context minimization, independently of schema validity.

## Templates, bindings and concrete mappings

Maintained templates come first. `content-change@1` accepts 1–12 required text fields, each bound to a distinct existing content ID at one specification revision, no conditional fields, at most 1,000 characters each and the actual target component's stricter limit. `project-brief@1` fixes required `name` (100) and `purpose` (1,000) without automatic creation. `project-select@1` has one required owned-project selection; `choice@1` has one single/multiple-choice question, with no automatic effect. Selecting a project can explicitly update task context under its own revision; it never retargets a prior form. `custom@1` composes the vocabulary for information gathering; a content continuation is permitted only with the same complete content mapping. `status@1` is a read-only view. Definitions cannot insert approval/spending/connection actions.

| Registered binding | Feature family / authoritative foundation | New adapter work and output |
| --- | --- | --- |
| `answer.value@1`, `interaction.answers@1` | `core.editing`; WH-106 new owned interaction storage | Typed field values and immutable submission receipt only. Additional feature-specific intake requires that feature's own binding/admission. |
| `owned.projects@1`, `owned.photos@1` | `core.editing`; `dashboardData` and [listPhotos](../src/files.ts) | Fixed `projects`/`photos` collection mapping. Return only allowed IDs/names/cleared photo metadata, bounded to 20 items; keep project ownership/safety checks at selection and submit. New uploads still use `uploadPhoto` outside the definition. |
| `site.content@1` | `core.editing`; `readSpecification` | Current owned content and source revision; server checks each content ID and component field limit before issuing a form. |
| `site.content-prepare@1` | `core.editing`; `prepareSpecification` | Derive `content.replace` operations from the submitted snapshot; prepare the existing private review in the current atomic Chat result path. No apply or publish. |
| `workspace.projects@1` | `core.editing`; `dashboardData` | Bounded summary/table of authorized projects; no cross-member project leak when memberships arrive. |
| `project.status@1` | `core.editing`; `dashboardData` | Filter by authorized target **on the server**; status/key-value presentation. Do not send a whole owner's dashboard to a project-limited member. |
| `project.traffic@1` | `core.insights`; `readTraffic` | Bounded project request telemetry, source/window/as-of and unavailable status. No invented unique visitors/conversion attribution. |
| `site.comparison@1`, `site.preview@1` | `core.editing`; `specificationPreview` | Revalidate an exact owned review; generate the existing same-origin authenticated route from its UUID. No arbitrary URLs or approval authority. |

Cards are exactly `{id,binding,display,limit,reviewId}`. `reviewId` is null except the comparison/preview bindings. Displays are registry-specific: summary/table, status/key-values, comparison or preview. Tables have maintained allowlisted columns; models cannot supply SQL, render functions or unrestricted selectors. Read results include `status` (ready, empty, unavailable, denied), `asOf`, source and bounded rows. Unavailable is never an empty successful metric. Lists are the one-column table preset. Pure rendering/refresh/history read performs no inference or mutation.

Human review bindings remain a **separate server-generated channel**, using the closed `ChatControl` union. `specificationApply` binds review UUID, proposal digest and expected revision, with recent authentication; site confirmation binds its current domain review. `serviceClientApply`, restore/maintenance, backend/form and provider reviews keep their own exact contracts. Models and generic definitions cannot select these controls. Review cards are issued only through current domain validation and immutable turn/reply links; client capability negotiation does not substitute for that proof.

### First slice trace

1. Owner selects the detailing project or resolves ambiguity in Chat. `readSpecification` supplies revision 3 with `headline` and `services` content IDs. A current specification is required; do not route through a legacy page converter. Missing/noncurrent data requires the explicit forward cutover or new current project creation. If another draft diverged, show the conflict and require a current reviewed baseline.
2. The server issues the fixture's content form with verified defaults and project/task scope. Customer edits `headline` and `services`, or asks for a natural-language correction that becomes proposed draft values. Plain “yes” never approves anything.
3. Explicit **Prepare preview** submits the complete answer snapshot using the operation envelope below. The successful submission receipt means answers were saved. A separate continuation receipt prepares `{kind:"specification",operation:"change",projectId,expectedRevision:3,operations:[{type:"content.replace",contentId:"headline",text:…},{type:"content.replace",contentId:"services",text:…}]}`. The prototype checks this mapping against the actual compiler in the focused test.
4. `prepareSpecification` rechecks current ownership/revision/draft/compiler/safety; its statements commit with the existing Chat turn. It returns the current ten-minute proposal and exact preview/comparison links. Form's seven-day answer lifetime never lengthens this review. If content changed while answering, retain the answers, show the conflict and explicitly prepare a fresh form/review against the new baseline.
5. `specificationChatLinks` revalidates the immutable reply digest and current proposal before supplying `specification_review` metadata. The existing React review card uses `specificationApply` through `/api/chat/actions`; `recentSession` and the existing domain receipt/transaction apply exactly that private version. Answer submission cannot call this path. A lost reply reads the receipt, never creates another save.
6. Customer sees the private result and can request publication. That creates the existing publication review; only its separate exact control updates the live site. Dashboard/current status reflects domain truth. General history shows the form/snapshot/result as read-only; export includes those customer-visible records without active controls.

The custom fixture collects service area, mobile-service choice, conditional radius, vehicle sizes and optional cleared photo IDs. All answers go only to `interaction.answers@1`; no generated visitor form, upload or website operation occurs. The view fixture binds project status and traffic to the same selected project, with zero inference on refresh. These examples exhaust their field/control mappings rather than implying an arbitrary action executor.

## Submission, state and operation identity

WH-106 reserves versioned handlers for create/read/list, save-draft, submit, cancel and read-receipt. WH-108 wraps them in bounded agent capabilities. Exact HTTP/native route names belong to their implementations; this decision freezes the shared payload, not nonexistent routes.

All writes carry `{version:1,requestId,interactionId,definitionDigest,expectedAnswerRevision,operation,answers?}`. `operation` is `save-draft`, `submit` or `cancel`; only the first two accept answers. Actor/account/project/target are resolved from current authority and stored scope, never accepted as override fields. Response supplies current definition digest, answer revision, interaction state and operation receipt. Readback authenticates the caller again. Request hashes include operation, digest, expected revision and exact answers using the same canonical encoding. New corrections use a new request ID.

Persist domain states separately:

| Layer | States and invariants |
| --- | --- |
| Interaction | `open → submitted | canceled | expired | superseded`; immutable terminal snapshot. Client dismissal changes presentation only and leaves open answers resumable. Explicit cancel ends collection; expiry ends authority, not retention. |
| Draft | Monotonic `answerRevision`, CAS and current digest. Partial drafts may omit required answers or retain empty text/selections while editing, but every provided value must be correctly typed and applicable. Submission requires all visible required answers and their nonempty rules. Invalid saves return field errors without replacing valid state. Concurrent edits fail visibly; no last-writer-wins overwrite. |
| Submission | Immutable submission UUID, request hash and answer snapshot; exactly one accepted snapshot per interaction. Correction creates a linked replacement interaction and new submission, preserving previous receipts. |
| Continuation | Separate operation UUID deterministically associated with the submission; `not-started → pending → succeeded | failed | unknown`. Explicitly requested preview preparation can run once after collection; no model run on read/render. |
| Domain effect | Existing proposal/apply/publication/provider/job identity and result. These remain authoritative even if a form is canceled or a Chat reply fails. |

Uniqueness on `(accountId, requestId)` plus immutable hash gives same-ID/same-payload readback; changed bytes get `409 request_conflict`. Current identity/ownership still applies to retries. Commit answer revision, immutable snapshot, submission identity and one continuation claim atomically with current digest/state/expiry checks. Expired, revoked or superseded state cannot win through a stale preflight. A duplicate request may read its committed receipt, but cannot initiate fresh work after expiry/revocation. Production must test interleavings in disposable D1; the offline schema reference does not prove this transaction.

Draft save/cancel require current open revision. A cancel racing submission has one database winner. After submission, **stop further work** may suppress an unstarted continuation; it cannot roll back a private save, undo publication, cancel an already-dispatched provider mutation or release an uncertain funding reservation. Report the actual domain outcome and use its reviewed recovery procedure.

On transport loss, keep the exact original request and read receipt/current state first, including after reload or navigation. Never auto-resend from session storage, service workers, background sync or native reconnect. An explicit retry reuses the exact identity only when the domain contract permits it. Pending/unknown operations retain their identity and show status/recovery; never label a timeout failed-and-safe-to-repeat. Unsupported/malformed returns `400`; validation `422` with bounded field IDs/codes; stale/digest/request conflict `409`; unauthenticated `401`; unavailable foreign scope generic `404`; identity/eligibility/policy denials use an allowlisted reason without foreign data.

Task context is a bounded pointer record: task UUID/revision, selected project, at most five open interaction IDs, five pending domain review references and one 1,000-character untrusted summary. No credentials, full visitor inbox or hidden permanent conversation memory. Changing selected project is visible; old forms stay associated with their original project. Explicit retarget creates a fresh definition after reads/admission; it cannot reuse an answer/request/review under a different scope. Task summaries never override the current domain state.

## Shared authority and eligibility

At issue/read/draft/submit/continue/confirm/dispatch, consume WH-090's shared operation admission over WH-113 identity, current owner/member/project rights, stable feature ID, actual configuration/consent, implementation/readiness and current resource/review/funding policy. Registry metadata is not that resolver. Do not reconstruct eligibility from plan labels, form claims, stored grants or a cached view.

| Actor/state | Required behavior |
| --- | --- |
| Anonymous, enrollment, recovery or incomplete welcome | No interaction/workspace/model authority. Use trusted authentication/progress/welcome routes; never render a credential form from the model. |
| Ordinary current owner, eligible feature | Allow only the binding's admitted operation and owned scope. Existing recent-auth requirements apply at sensitive effects; viewing or routine answers add no repeated unlock prompt. |
| Future member with read only | Authorized read bindings/history only; no draft, submit, model maintenance, prepare, apply or layout mutation without explicit member permissions. Account-wide history is not automatically project-shared. |
| Revoked member/session, removed project permission | Deny current reads and writes; close/clear client-held private state on detection. A saved form/view/receipt ID is not continuing access. |
| Downgraded/expired feature, missing consent or unready adapter | Deny new privileged continuation/effect; display current reason. Preserve owner-only permitted history/export/revocation/uncertain readback and security/recovery. No automatic unpublish or destruction. |
| Guest feedback/customer visitor | No workspace bindings, owner inference or maintainer credentials, even with a valid visitor account or expiring review link. |

Standard owner assistance remains unlimited fair use with zero customer-credit debit; existing internal testing capacity and safety apply. Advanced spending, provider consent and real payment changes keep separate explicit approval/funding paths. Monitor mode does not disable safety or authorization. Per-feature/module bindings added later must register their own stable IDs, field schemas, lifecycle and admission requirements, rather than laundering a new feature through `core.editing` intake.

## Presentation, saved views and current clients

Inline is default. Panels/sheets/dialogs are hints; the renderer can choose an accessible mobile layout. One dialog at a time, no stealing focus from the composer, no automatic reopening after dismissal. Labels/errors have programmatic associations; retain tab order, visible focus, touch targets, safe areas and keyboard space. Status updates use bounded polite announcements. Required/optional/default provenance and project are visible; **Cancel**, **Resume**, correction and answer-in-Chat remain available. Sensitive reviews retain their disclosures regardless of the agent's wording.

WH-109 evolves `workspace_preferences` and its revision, not a second layout store. Each save includes request ID, expected layout revision and the exact resulting declarative layout; update/rename/delete changes only the intended tab and preserves unrelated entries. Store the resulting receipt and prior layout for a reviewed forward restore at a new revision. Existing limits/shortcut allowlist remain until explicitly extended. Saved definitions contain binding IDs/references, not read results or session tokens. Resolve current authority on every refresh; a denied/stale binding renders an honest unavailable state. Never infer it succeeded from a saved layout title. New generalized view schemas include version/digest from their first persistence.

WH-107 and WH-081 send exactly the current protocol version and their field/binding support. The server requires the current version and all controls needed by the issued definition. Missing/unknown version, field type or binding yields `client_update_required` with a fixed **Update Whumpo** message. No simpler form, older decoder, text projection or browser downgrade is served. Unknown fields are rejected, not ignored. The reference's `requireCurrentClient` demonstrates this rejection; a current generic form still returns `canApprove:false`.

Retained conversations use the current history/interaction schema. Schema changes require an explicit forward migration before serving retained rows; historical receipts may be archived as nonactionable facts in the current export format. Do not mutate immutable approval digests to make a historical action executable. Submitted/canceled/expired/superseded current elements are read-only because of their state, not their age. A current review action requires a new authenticated domain read. Native returns preserve task/interaction IDs and read current state; account changes clear client-held state. Trusted authentication/consent/preview handoffs are current product flows, never alternative protocol implementations.

Keep Profile, Settings, sign-out, authentication/recovery, support and urgent take-down/recovery paths directly accessible without inference. Dashboard remains a separate view; Chat remains the default upper navigation item, not a permanent pane beside it. Routine capabilities move into Chat only after their replacement and inference-outage recovery journey pass WH-110/111. This decision removes no current route or control.

## Data lifecycle and model context

Register these classes in WH-106/109 migrations, closure/export inventories and WH-116/117 protection before activation. This adds no approved retention SLA; [data lifecycle](data-lifecycle.md) still owns unresolved LC policy decisions.

| Class | Handling |
| --- | --- |
| Definitions, labels, defaults and submitted snapshots | Private account/project content, potentially personal data. Retain useful accepted history subject to explicit deletion/closure and approved policy. Expiry/supersession disables writes but does not erase copied text. Export allowlisted labels/answers/provenance/status, excluding active capabilities and secret links. |
| Unsubmitted server drafts | Minimize and delete on explicit discard where no receipt/preservation requires them. Proposed idle cleanup: seven days after last accepted edit; WH-116/106 must ratify and implement this before claiming retention. An expired form remains readable only while its data is retained. |
| Local drafts and unresolved requests | Reuse account-bound browser recovery semantics; 24-hour unsent draft expiry, no credential storage, honest storage-failure warning. Uncertain request identity survives for readback. No PWA Cache Storage or cross-account/native backup copies. Restriction/logout clears what the client can reach; server revocation does not promise remote byte erasure. |
| Task summary, view definitions, read results | Owned summary/layout is private content; model/visitor data not shared across accounts. Read results are transient, no-store; avoid storing full metrics or provider records in view definitions. View changes retain necessary revision/restore receipts under lifecycle policy. |
| Submission/continuation/effect receipts | Minimize to scope, hash, identity, state and references separately from answer bodies. Keep unresolved identity for reconciliation; policy-controlled terminal deletion must preserve replay protection (tombstones when necessary). Raw deletion cannot enable same-ID replay. |
| Attachment and preview references | Preserve project/safety/expiry/revocation checks; no raw bytes, bearer URLs or credentials in ordinary exports/model input. Deletion includes form/default/history/inspection/derived copies and restore suppression, not just the photo/version row. |

Only selected, explicitly submitted answers relevant to the active task may enter the existing bounded model continuation; ordinary draft typing, saved view refresh and history reads do not. Treat all labels, answers, summaries and fetched content as untrusted data. A deterministic content mapping requires no additional model call to prepare its proposal; custom interpretation uses at most the existing bounded continuation and retains separate inference/operation receipts. Inference failure leaves the submitted snapshot readable and correction/retry explicit. Keep the current Muse Contributor privacy notice; no confidential beta claim or new provider permission is created. Never include identity/recovery data or provider credentials in context/logs/GitHub.

## Implementation handoff and acceptance cases

| Packet | Required next evidence |
| --- | --- |
| WH-106 | Depends on WH-105/090/116/009. Implement shared storage, closed validation, atomic draft/submission/continuation admission, ownership/privacy/export registration, concurrency and lost-reply cases in disposable D1. |
| WH-107 / WH-108 | Render current elements with mobile/accessibility/version-rejection tests, then connect bounded agent capabilities and the complete content-change journey. Real handlers retain their authority. |
| WH-109 | Revisioned views/bindings through the shared layout and admission engine; denial, stale data, restore, zero-inference refresh and cross-project/member tests. |
| WH-110 / WH-111 / WH-112 | Move routine journeys onto the current handlers, preserve deterministic recovery, then accept current history/native handoffs. Remove superseded routes with the replacement; no legacy route adapters. |
| WH-081 / WH-067 / feature adapters | Consume stable types/bindings and register new capability-specific contracts; do not duplicate permission, lifecycle or domain effect logic. |

Mandatory implementation scenarios: valid template/custom/view; malformed/deep/oversized/unknown definitions; hidden/foreign/unsafe resource answers; digest/scope tampering; duplicate/reused IDs; submit-vs-cancel and two-tab CAS; expiry/revocation between read and commit; changed project/content revision; lost submission and continuation replies; inference failure after submission; superseded correction; unknown effect reconciliation; unsupported old/new clients; history/export without active actions; view rename/delete/restore preserving unrelated tabs; no inference on navigation/reload/refresh; keyboard/screen reader/mobile dismissal and essential controls during inference outage. Each must exercise the actual layer it claims, rather than substituting prototype tests for persistence or devices.

### WH-105 verification

The focused offline test validates all six fixture definitions, field vocabulary, malformed cases, scope/digest and strict client rejection, then maps the content answers through the **actual compiler**, checks the resulting private artifact and unchanged unrelated content, and validates existing exact `ChatControl`/layout/feature identifiers. These are schema/compiler decision checks; they do not prove D1 concurrency, deployed routes, renderer accessibility, provider or physical-device acceptance. Roadmap validation/rendering and local link/diff checks accompany the decision. Results are recorded in issue #51 when completed.

**Decision verification after the owner amendment — October 1:** `node tests/chat-interaction-contract.mjs` passed 63 offline cases, including strict current-client rejection, with no network calls. The earlier compatibility projection and its tests were removed. Roadmap validation/alignment/rendering, local links and diff checks accompany the decision. No production interaction storage, renderer, application build or device acceptance is claimed.
