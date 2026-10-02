# Chat as the primary Whumpo workspace

**Product direction accepted October 1, 2026; implementation and customer acceptance remain planned.** Source inspection used `628c16f` and the existing working tree. WH-105–112 add this direction to the canonical backlog. This is the signed-in customer's owner/maintainer experience; it does not put Whumpo AI into customer websites, visitor forms or business automations.

**WH-105 decision handoff:** the source-grounded [interaction contract v1](../chat-interactions.md) now freezes bounded definitions, bindings, receipts, identity/feature admission, lifecycle and current-version web/native rejection, with offline fixtures checked against the actual compiler and existing controls. The October 2 [WH-106 storage audit](../chat-interactions.md#wh-106-storage-acceptance-audit--october-2-2026-utc) verifies shared storage/recovery and connected maintained website/project forms in current source and disposable fixtures. The [WH-107 audit](../chat-renderer-acceptance.md) now accepts the renderer and the [current test release](../chat-test-release.md) deploys maintained forms. Custom composition is active under WH-108; broader customer acceptance remains subsequent work.

Customers should accomplish routine work by talking to Whumpo and interacting with what it presents in Chat. The agent selects, composes and maintains dashboards and custom views around the customer's work. Customers should rarely need to navigate elsewhere or configure their own workspace. They can still dismiss a view, correct the agent, request changes and use essential account/recovery controls directly.

The October 1 [identity and data protection amendment](identity-and-data-protection.md) makes low user friction with strong default protection a general product rule. Two-passkey signup and recovery-kit handling stay in trusted dedicated flows outside model forms/context; ordinary sessions need no repeated unlock prompts. Encryption must preserve truthful AI/processing disclosures and existing safety/review boundaries. WH-113–118 own that planned work; this Chat contract does not confer enrollment or recovery authority.

## Existing foundation and the missing work

| Foundation inspected | Reuse and remaining gap |
| --- | --- |
| Natural messages, bounded inspections and validated actions in `src/ai-chat.ts` and `src/site-agent.ts` | Keep the existing owner authority and bounded inference. Add a typed request for information or a view, with persisted state; do not add an open-ended agent loop. |
| Exact `ChatControl` actions and server review receipts | Keep authority in the existing handlers. General form submission must not manufacture an approval control or confirm a review. |
| `frontend/src/workspace.tsx`, specialized review cards and `chat-turn-actions.tsx` | Extend the transcript with a common interactive-element renderer, preserving existing review disclosures and literal historical text. |
| `src/workspace-dashboard.ts` and requested workflow shortcuts | Extend revisioned declarative layouts and scoped data reads. Current fixed cards/tabs are a foundation, not arbitrary custom views. |
| `frontend/src/lib/chat-delivery.ts`, saved history and transcript export | Reuse request identities, readback and the implemented account-scoped session-storage recovery of unsent drafts/interrupted requests. WH-106 now implements current server drafts, immutable submissions, exact recovery and owned history/resumption for maintained forms. WH-107/108 extend the shared renderer and bounded composition; device acceptance remains separate. |
| Specification/compiler and capability-planner work | Reuse supported capability bindings for project changes. Owner information gathering is a separate contract from WH-066/067 visitor-facing forms and WH-070 customer application presentation. |

The October 1 alignment re-read live GitHub evidence: WH-064/065/066 and children #15–17 are closed as completed for the initial supported scope. Reuse the delivered catalog, content/contact/stateless-client compiler and private apply/restore handlers. General records/access/files and notification/rules remain WH-067–069. No Chat-interaction implementation is claimed by those closures.

## Intended experience

An owner says, “Help me update the services on my detailing site.” Whumpo inspects the selected project and presents a short service-details form inside the conversation, prefilled with the current names and prices. The owner edits fields or describes the correction in plain language. Whumpo shows the resulting comparison and private preview, then presents the existing exact review when publication is requested. Opening a form, submitting answers and saving a private draft do not publish the site.

If a standard form does not fit, the agent composes a custom form from supported fields, such as service area, vehicle sizes and optional add-ons. It explains what the answers will be used for and asks only for missing information. A request to “keep a view of this project handy” lets it save a compact overview using the same supported cards and data bindings. A saved view is optional; ordinary work stays in Chat.

| Situation | Presentation |
| --- | --- |
| One simple question | Plain conversation or a small choice control. Do not require a form for every answer. |
| Several related facts | A short inline form with clear labels, defaults, required/optional fields and a submit action. |
| A longer task or comparison | An expandable panel, or a dismissible dialog/sheet attached to a durable transcript entry. Return to the same conversation and preserve entered values. |
| Progress, result or pending decision | An authoritative status/receipt card with the next supported action. Rendering or polling it never invokes inference. |
| Repeated overview work | An agent-composed dashboard or saved custom view, available from Chat and optional navigation. |
| Authentication, provider consent or recovery | A trusted dedicated control or browser handoff, with a return to the originating task when possible. |

Inline is the default. The agent may present a relevant popup during an active task, but must not stack dialogs, steal focus while the customer is typing, or reopen a dismissed form on refresh. Dismiss, cancel, skip an optional answer, resume and “answer in chat” are explicit behaviors. A free-text answer may populate a proposed field value; consequential approvals still require the real review control.

## One bounded interaction contract

WH-105 freezes the current wire contract before implementation. The owner rejects legacy support: use only the current schema/client, reject stale versions explicitly, and reset obsolete test data before cutover. No compatibility renderer, older route or downgrade adapter is supported. Use a versioned, declarative description rendered by Whumpo-owned components. The agent chooses a maintained template first and composes a custom description only when needed. No new UI generation framework, infrastructure service or arbitrary code renderer is required for the first slice.

The contract must include:

- A server-issued interaction ID; authenticated owner and conversation association; an optional verified project; originating turn and task reference; schema/template version and immutable definition digest.
- Stable field IDs, typed values, labels/help, requiredness, bounded choices, defaults with provenance, supported validation and a small declarative conditional-visibility vocabulary. Set explicit limits for serialized bytes, field/option counts, nesting and open interactions.
- Server-registered capability/data binding IDs and expected resource revisions. Separate collecting answers, preparing a private change, opening a view and presenting a server review. Labels and model-supplied IDs grant no authority.
- Presentation hints for inline/panel/dialog, a readable text fallback and client capability/current-version checks. The server and client reject unknown actionable elements; historical or unsupported elements remain readable with a supported recovery path.
- Separate response and operation identities. Answer drafts, submitted snapshots, validation errors, action receipts and pending/unknown outcomes must remain distinguishable. A submitted form is not proof that its downstream operation completed.

The supported vocabulary begins with text, long text, single/multiple choice, boolean, bounded number, date/time with an explicit timezone where relevant, owned-resource selectors and existing safe attachment controls. Display primitives include summaries, key/value cards, bounded lists/tables, status, comparisons and private preview links. Attachments retain existing upload and safety gates; byte content and arbitrary URLs are not form definitions.

Custom forms may reorder/group fields and express bounded show/hide conditions. They cannot embed HTML/JavaScript, executable expressions, arbitrary URLs/fetches/SQL, privileged action payloads, credential inputs or new permission rules. Reject hidden-field submissions that are inapplicable under the validated definition. Escape model-authored labels/help and validate the full definition and answers on the server.

Reuse existing validators and components where practical. If JSON Schema is selected, explicitly close allowed properties and validate its supported subset; merely describing known properties does not reject unknown ones. See the official [object schema reference](https://json-schema.org/understanding-json-schema/reference/object), checked October 1, 2026. This is a contract requirement, not a dependency-install decision.

## Persistence, context and authority

Persist the exact issued definition, answer revision and immutable submitted snapshot. Represent at least open, submitted, canceled, expired and superseded interaction states, with downstream pending/succeeded/failed/unknown receipts tracked separately. Reopening a saved conversation must recover the current state without re-running the model or replaying an action. Changing a question or target creates a new definition/revision and preserves the old receipt; it cannot silently reinterpret already submitted answers.

Answer submission validates current session, origin where applicable, actor/project access, interaction state, schema digest, expected answer/resource revision and the allowed binding. A stable request ID and payload hash support atomic commit and exact readback after a lost response. Duplicate clicks, two tabs/devices and stale answers cannot duplicate work or overwrite newer answers. A corrected answer uses a new submission identity. Never automatically resend an approval or an unresolved side effect on reconnect.

Keep a bounded task context containing the selected project, outstanding questions, current draft and pending reviews. Switching projects visibly changes the target and cannot reuse another project's form. Owners can correct, cancel or resume work. Submitted answers become minimized, untrusted context only for the relevant owner task; do not repeatedly send the full form history to inference. Any model continuation is separately bounded and receipted under current inference policy. A failed continuation must leave the saved answers recoverable.

Retention/export/deletion classes must cover interaction definitions, sensitive labels, answer drafts, submitted values, task summaries and links to reviews/attachments. Use server-owned draft storage where appropriate, minimize local copies, isolate them by account and clear them on logout/account change. Transcript export includes useful owned question/answer history and receipt state without credentials or active authorization tokens. An expired form does not imply immediate deletion of required receipts, and retention policy must not revive an expired action.

Passwords, recovery codes, payment details and OAuth secrets stay in trusted dedicated flows and never enter model-generated forms or model context. Disclose when eligible answers will enter the current model; preserve the contributor-model warning and production privacy gates. Do not harvest customer answers for benchmarks. Existing permissions, plan eligibility, recent authentication, publication, provider mutation and spending reviews remain authoritative at preparation and commit.

## Predesigned forms and agent-controlled views

Ship a small maintained template registry with schema/version, purpose, capability binding, required data, privacy classification and fixtures. Start with an existing-project selector, new-project brief, website content/change brief and structured choice/comparison. Add the current photo intake and connection readiness handoff through their existing contracts. Do not make the first release depend on CMS resumption, payment activation or future mailbox adapters.

Give the agent explicit capabilities to request information, present a supported element, inspect its current answers, prepare an existing action and present/save a view. It may manage presentation within the owner's task, including arranging a relevant temporary view without a separate manual layout step. Persistent create/update/rename/remove operations use expected revisions, preserve unrelated views, show a receipt and support restoring the previous layout. Do not silently replace user-requested views or change workspace structure after an unrelated request. Users can request a different arrangement or undo the change through Chat; a manual dashboard builder is unnecessary.

Saved views reuse the same component/data contracts as Chat. They can show project status, activity, traffic, review queues and later eligible lead or portfolio data when those features exist. Data comes from permission-filtered server queries with source/as-of state; unavailable metrics stay unavailable. Custom labels or filters cannot widen read/write scope. Live render, refresh and background updates make no maintainer calls. An agent can compose a view; the server supplies its data and available actions.

Keep account, security, sign-out, support and urgent takedown/recovery discoverable outside the model path. Simplify the main navigation only after equivalent Chat journeys and deterministic current recovery paths pass connected checks. During an inference outage, customers must still reach saved work, pending reviews, operation status and those essential controls. Do not remove working routes before replacement acceptance.

## Delivery order

All eight packets are P1 in F2, concurrent with foundational work rather than a new phase after F6. WH-105's decision is recorded in [issue #51](https://github.com/zemdregon/whumpo/issues/51); refresh live execution for downstream claims. P0 safety, lifecycle, identity and recovery gates retain priority.

| Packet | Deliverable | Dependencies |
| --- | --- | --- |
| WH-105 | Inventory priority journeys; freeze interaction, template, binding, lifecycle and compatibility contracts. | WH-113, WH-089; current source/contracts and live execution review before claiming. |
| WH-106 | Durable interaction/answer storage and authenticated typed submission/readback. | WH-105, WH-004, WH-009, WH-116, WH-090. |
| WH-107 | Accessible Chat renderer and initial maintained form templates. | WH-106. |
| WH-108 | Agent template selection, bounded custom forms and task-scoped answer continuation. | WH-107, WH-065. |
| WH-109 | Agent-managed dashboards/custom views sharing the Chat component and binding vocabulary. | WH-107. |
| WH-110 | Migrate supported everyday journeys through existing handlers into Chat. | WH-107; custom composition and richer saved views can proceed alongside this work. |
| WH-111 | Simplify navigation and complete reload, interruption and inference-outage continuity. | WH-109, WH-110, WH-024. |
| WH-112 | Accept the primary Chat experience with reproducible journey and usability evidence. | WH-108, WH-111, WH-025, WH-020. |

The first vertical slice is **an existing-project content-change brief → validated answers → private preview/comparison → existing exact review → saved result**, including reload and duplicate-submit recovery. It requires no new provider. Contract, service and renderer deliverables must each include that fixture so the foundation does not become an abstract UI platform. Synthetic/local checks can establish plumbing; any live publication needs the existing authorization and review.

WH-110 then covers new-project intake, choosing/changing the active project, editing and inspecting saved work, preparing publication/restore, reading status/traffic and supported recovery. Photo selection preserves WH-027/safety gates. Connections open real consent flows; later tier tasks add eligible lead, connector and portfolio elements without duplicating their backends. An owner Chat form is never implicitly published as a visitor form.

Extend WH-009/025/058 for data lifecycle, interaction measurements and action-honesty evaluation. WH-081 uses WH-105's version negotiation; WH-084 depends on WH-106 and implements the admitted native subset with current-version rejection for unsupported elements. Web renderer code is not a prerequisite for the Android shell/identity foundation, and full custom-view parity remains deferred. WH-112 feeds both the complete-tier acceptance WH-104 and final commercial WH-049, so new tier dashboards cannot finish against a disposable owner UI. WH-048's bounded free beta remains independent; its advertised paths still require its existing gates. Tier/provider launch, real-money activation and CMS testing gates remain intact.

## Acceptance and measurements

WH-112 must record separate source, local browser, real-model, physical-device and consenting-customer evidence. Before changing navigation, every migrated journey must pass the exact server-handler path with no mandatory Dashboard/Settings detour, apart from identified authentication, external consent and preview handoffs. Both standard templates and a custom form must be exercised through submission, correction, cancellation and resumption.

Use a content-free event vocabulary for presented/started/submitted/canceled/resumed forms, validation failures, time to useful result and required surface changes. Compare with the WH-024/025 baseline, including inference calls/tokens and operation latency. Proposed initial success criteria are at least 90% of supported routine task attempts completed within Chat, allowing an attached panel, and at least 8 of 10 consenting participants completing the selected journey without navigation coaching. Report sample size, failures and approved handoff exclusions; these are proposed targets, not achieved results. High form submission counts alone do not demonstrate customer value.

Forms need labels, grouped controls, clear instructions, associated errors and completion feedback. Longer forms need clear progress. Follow [W3C form guidance](https://www.w3.org/WAI/tutorials/forms/), checked October 1, 2026. Dialogs need deliberate initial focus, contained keyboard navigation, Escape/close behavior and a sensible return focus; follow the [W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/). Test screen readers, keyboard-only use, mobile soft keyboards, zoom, reduced motion and narrow screens; screenshot and automated accessibility checks do not establish physical-device or assistive-technology acceptance.

Negative cases include foreign interactions, changed permissions, stale definitions, two-device edits, unknown client versions, malformed/injected schema, altered field choices, hidden answers, expired reviews, revoked attachments, duplicate submissions, lost replies and interrupted inference. Historical interactions must never recover authority from text. Visitors, jobs, rendering and polling must create zero maintainer calls. There must be zero duplicate consequential effects in the exercised replay/concurrency cases.

No new Cloudflare service, UI framework or paid provider is selected by this plan. Existing hosting, storage and inference still have operating costs; measure the extra persisted state, bounded reads and optional continuations under WH-022/078. Reuse current standard-AI rules and keep paid or external acceptance separately authorized. Roadmap completion alone cannot establish deployment, commercial readiness or customer acceptance.

## Shared implementation sequence

WH-105 follows WH-113 identity and WH-089 feature contracts. WH-106 persists interactions after WH-116 data classification. WH-109 owns supporting owner views; WH-037 health reporting and later lead/portfolio features register bindings there. WH-070 remains the separate customer-app presentation layer. Native WH-081/084 consumes the same interaction identities and receipts, with a bounded renderer subset. These are adapters over existing handlers, not new authority stores. See [the complete alignment](alignment.md).
