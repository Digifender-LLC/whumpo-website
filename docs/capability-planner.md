# Versioned capability catalog and composition planner

**WH-065 — September 30, 2026. Implemented and deployed to test; verification scope is recorded below.** [Execution issue](https://github.com/zemdregon/whumpo/issues/13). This implements the discovery/planning layer after the [WH-064 specification decision](project-specification.md). Whole-project specification persistence, compilation and module runtime services remain WH-066–069. A catalog entry describes a contract, not an installed customer service.

## Current account verification — October 2, 2026

The planner and inspection fixtures now initialize the complete current schema and use admitted owner scopes from the same bundle as the domain handlers. Prepared draft statements commit through that same scope. Current D1 tests verify missing/foreign/stale/expired plans, exact replay, lost acknowledgment and atomic source/provenance/activity rollback after an intervening backend change. The supported website fixture makes two synthetic model calls, passes a 1,433-byte relevant lookup and generates no backend source. The private library application path remains separately verified through actual QuickJS.

[Verification](verification.md#reusable-components-application-builds-and-bounded-planning) distinguishes synthetic inference from real runtime execution. Current application build/page-design checks pass; their optional live provider branches were not run. These tests add no provider activation or shared customer-source retrieval, and they do not complete the pending remote identity cutover.

## Owner experience

Chat remains natural language. The agent first uses existing content/theme edits, deterministic diagnostics, shared contact/directory services or exact library helpers where they fit. It can request a capability plan for one to four needs and receive only those contracts and their dependencies in the existing bounded lookup continuation. The plan is a private receipt; it changes no website, setting, permission or service.

**October 2 source addition:** `chat.content-brief` depends on `site.content` and exposes the maintained owner Chat text form with one to eight current content targets. Prefer an ordinary question for a simple missing detail. Whumpo supplies field labels/defaults; the agent can request, read metadata or propose a replacement set of fields on the same task/project. It cannot author questions, submit answers or approve a review. Issuance commits with the Chat result; deterministic preview preparation, private saving and publication retain separate steps. The [first handoff](chat-interactions.md#maintained-agent-handoff--october-2-2026-utc) is locally verified with scripted inference, not deployed or accepted for custom forms, visitor intake or real-model quality.

An ordinary landscaping site can use the existing page renderer and contact service. A matching private task list can use the pinned `private-task-list@1` artifact without generating source. Adding a display field to an existing tested function uses the existing form review. Adding a persisted field to a general record schema, staff file access or staff notification rules is explicitly **unavailable** until the relevant module implementation exists. An appointment request must not be described as a complete booking engine.

For missing pure computation or a bounded per-visitor transition, the agent must record what is missing before saving new source. It supplies that saved plan ID with the later draft/build action. Source remains private and untested on simple save; application builds perform the existing bounded synthetic check and prepare a separate owner review. A plan never approves code execution, activation, publication, a provider connection or spending.

## Catalog and retrieval

`src/capability-catalog.ts` contains platform-authored version-1 contracts. Every entry declares its interface, existing operations, permissions, dependencies, compatibility, qualitative cost characteristics and repository contract reference. The catalog has its own version and SHA-256 digest. A changed contract changes the digest; no remote URLs, user source, filled configuration, file bytes, credentials or customer answers populate the shared catalog.

| Need | Current delivery |
| --- | --- |
| `site.content`, `site.theme`, `site.photos` | Existing immutable page configurations and focused edits; approved same-project photo metadata only. |
| `site.contact`, `site.directory` | Existing deterministic services and their separate exact review lifecycle. |
| `diagnostics.website` | Existing fixed website health observation. No arbitrary URL or automated repair. |
| `function.line-total`, `function.text-statistics` | Exact existing library copies; source digests/provenance remain checked by the library. No source generation. |
| `app.task-list`, `app.visitor-access` | Pinned task-list transition plus existing application authority, controlled page, passkeys and per-visitor document. No generated authentication. |
| `form.function-inputs` | Existing typed input presentation and exact form/page reviews; no new persistent schema. |
| `schema.optional-field`, `access.staff-files`, `notification.staff` | WH-064 contracts only; WH-066–069 still required. No new executable operation offered. |
| `runtime.ai`, `infrastructure.dedicated` | Separate deferred capability/decision. No maintainer fallback or provisioning action. |
| `custom.computation`, `custom.visitor-transition` | Recorded bounded extension only when supported capabilities leave a gap. Existing QuickJS boundary and reviews apply. |

The model-facing tool is a closed object:

```json
{"kind":"capabilities","operation":"plan","projectId":"owned UUID","needs":["site.content","site.contact"]}
```

Known dependencies are added once. Unknown IDs return an unsupported plan; unknown fields, version syntax, URLs, extra authority and executable parameters are rejected. Planned capabilities have no executable operations. Mixing a missing service with a custom extension produces an unsupported plan with **no extension grant**, preventing an unavailable service from silently becoming a generated framework.

Custom needs require `extension:{missing,baseVersionId?}`: a 10–400-character explanation and an existing same-project base when customizing a project that already has backend versions. Only one custom scope is allowed. The explanation is untrusted private planning data, not proof that an LLM has correctly understood the business need. This is an enforceable recorded-scope requirement and a bounded execution boundary, not a semantic proof that every generated program matches its explanation. Real-model classification/usefulness remains an evaluation requirement.

The lookup shares Chat's two-call maximum. Responses over the existing 8,000-byte continuation bound are shown as readable guidance instead of opening an unbounded tool loop. The catalog includes no current customer state; ordinary owned inspections supply missing resource facts. The current base prompt still explains existing actions; this change does not claim to have minimized every prompt family.

## Persistence and concurrency

Migration `0109_composition_plans.sql` adds private `composition_plans`, immutable `backend_extension_uses` and a monotonically increasing backend revision on projects. Existing backend insertions/deletions advance this revision, including library copies and operator fixture paths. A remove-and-replace with the same version count cannot preserve an old plan's validity.

Plan IDs are owned pending AI Chat turn IDs. The server obtains owner identity from the existing authenticated Chat path and checks the project before reading or writing. The immutable record binds normalized needs/extension request hash, catalog digest, project details revision, backend revision/count, bounded plan JSON, extension scope and a 15-minute expiry. No visitor document, source copy or credential is saved in this table. A same-ID replay returns the exact saved plan; changed input conflicts. Lost insertion acknowledgments read back the same record rather than creating another plan.

Generated `backend create` requires a `pure-function` plan; custom `buildApplication` requires a `visitor-transition` plan. Scope, current ownership, expiry, current executing catalog digest and both project revisions are rechecked. The version and its unique plan association commit in the same database batch. Admission triggers require the same project/owner/pending AI turn and exactly one backend revision advance. Intervening details/source changes roll back the whole draft batch, including activity. This uses the existing [D1 batch transaction](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) pattern; no new storage product is provisioned.

One plan can produce at most one custom version. Associations cannot be changed or removed while that version exists. Old exact application-build receipts still recover without repeating tests or reauthorizing publication; new custom builds need a plan. Existing library copies, operator fixture helpers and quarantined import admission remain separate paths; imported source does not become executable through this planner.

Private-test storage bounds are **100 retained plans per project / 5,000 total**, not subscription usage entitlements. Expiry ends eligibility but does not erase evidence. Plan records follow project/account deletion; referenced evidence is retained with the backend version, and chat-only deletion cannot erase an in-use plan. The future lifecycle implementation must reconcile these records with source/version retention before offering destructive closure or transcript-erasure promises. There is no automatic pruning job or new unlimited storage promise.

## Shared application handoff

`backend buildApplication` accepts either:

- `projectId` and exact `reference:"private-task-list@1"`; or
- `projectId`, `planId`, bounded `source`, and synthetic `input`/`expected` for custom work.

These forms cannot be mixed. For the library form, the server resolves the artifact, verifies its digest/availability, selects the platform-authored synthetic example, and atomically records existing component provenance alongside the build. It then uses the existing isolated runtime, expected-output test receipt and application approval. This generates zero new source; it still stores a private exact copy. No visitor is enrolled, program activated or page published automatically. Unknown versions, stateless helpers used as transitions, and replacement source/example fields are refused.

The first-app onboarding handoff now permits one same-project capability-plan lookup before a custom build. A matching library starter can still build directly. Its project and allowed-action guard runs **before** the lookup and before the final action. The complete private welcome brief remains available, while other projects/services and account mutations remain outside that handoff. A failed/stale build preserves the starter state and never claims success.

## Runtime and cost boundary

The planner is mounted only through the owner-maintainer action dispatcher. The catalog/plan modules are not imported by the visitor host, public site host or isolated runtime. Visitors, form handlers, timers and business rules have no planner endpoint or maintainer tool and cannot borrow its inference context, credentials or funding. Existing visitor application acceptance runs without any inference configuration. Optional runtime AI remains a separate disabled contract.

Catalog planning performs bounded database work and no model/provider call of its own. Natural-language interpretation uses the existing Muse test route and at most two metered internal calls. Standard assistance still has zero customer-unit debits. Shared rendering, form handling and diagnostics need no generated backend source; existing runtime/storage costs and allowances continue to apply. New paid services, frameworks, Vectorize/AI Search, provider connections and dedicated infrastructure are not activated. No model-price or new margin claim is made.

## Verification and deployment evidence

Checks passed on Node 24.21.0 / pnpm 11.19.0:

- `pnpm check` (both TypeScript projects) and `pnpm build`.
- `node tests/composition-planner.mjs`: known/unknown/planned contracts, relevant lookup, immutable private records, missing/foreign/wrong-scope/expired/stale plans, source-base ownership, remove-and-replace revision changes, atomic draft/activity rollback, retained evidence and project cascade, exact replay/lost acknowledgment, and scripted Chat lookup to an actual private site draft. Representative contracts were at most 2,041 bytes; the connected lookup was 1,365 bytes, with two scripted model calls and **zero generated backend source bytes**. This is a fixture measurement, not a production savings rate.
- `node tests/application-build.mjs`: actual isolated QuickJS, plan-backed custom build lifecycle, exact pinned task-list handoff/provenance, no replacement source/example, stateless-helper rejection, separate reviews, concurrency and lost draft/test acknowledgment. The shared starter dispatches one synthetic check; replay dispatches none.
- `node tests/backend-chat.mjs`, `node tests/agent-inspection.mjs`, `node tests/agent-prompt-focus.mjs`, `node tests/welcome-first-draft.mjs`, `node tests/backend-library.mjs`, `node tests/natural-chat.mjs`.
- `node tests/customer-app-journey.mjs`: notebook and task-list journeys with real local QuickJS and signed fixture passkeys, isolated documents, replay/recovery/export/erasure, separate program/page approvals and withdrawal. An initial run caught an obsolete fixture sending slash strings to public Chat; the fixture now uses explicit internal setup and the real typed HTTP approval endpoint. The rerun passed. This does not restore command interpretation to public Chat.
- `node tools/roadmap.mjs validate`, `node tools/roadmap.mjs render --check` and `git diff --check`.

No CMS functional tests, live model calls, customer publication, provider activation or physical-device tests ran. Existing lifecycle fixtures seed plans only for their downstream setup; the dedicated planner and onboarding suites exercise the actual lookup/validation path. The optional live-model fixture was adjusted for the bounded planning continuation but not executed. Scripted choices do not prove natural-language classification quality. Source verification and deployment are separate evidence.

GitHub #13 is the execution record. WH-064 closed with the decision/prototype evidence in `d27b46a`. The concurrently edited roadmap source belongs to PR #1; its unrelated files are preserved. Backlog issue mapping must be reconciled with that roadmap change rather than overwriting it.


Test release: platform `7e5014d0-5e60-4c6f-9d0d-059be84f3b5a`, deployed at 2026-09-30T21:35:04.911Z from implementation commit `b457f6b`. Migration `0109_composition_plans.sql` was applied first. Independent live readback at 2026-09-30T21:36:35.806Z verified all 109 migrations with none pending, the backend revision column and all seven new guards, health/landing/workspace 200, anonymous Chat/action POSTs 401, and the workspace HTML plus all 16 frontend assets matching the build byte-for-byte. The first verifier attempt used the wrong local SPA HTML path; correcting it to `dist/index.html` produced this complete readback without redeploying.

The existing platform wrapper preserved configured bindings; it does not create a four-Worker release journal. Previous platform was `2ed299fd-f7d4-4842-88c7-b7d950d7a59a`; rollback can retain the additive schema/evidence. The site, visitor and runtime Workers were not redeployed. Private operator evidence: `.secrets/composition-release-review.json`, `.secrets/composition-migration.log`, `.secrets/composition-deployment.json` and `.secrets/composition-release-verification.json`. No live authenticated owner or real-model acceptance is inferred from this readback.
