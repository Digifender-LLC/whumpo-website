# Routine Chat journeys: original-scope audit — WH-110

**Accepted October 3, 2026 UTC for WH-110, routine adapter child #98 and original-scope audit child #99.** The original six scope items, six acceptance criteria and three verification requirements are retained below. This audit covers the admitted routine adapters defined by [the original contract](chat-routine-journeys.md), not general application generation or customer/provider admission.

Runtime source is `577702e510c99c6038812585516dda9b30ef66ea`; evidence baseline is `a26c55db1a3d26074c6daa28916cd193f5246cbf`. Runtime/frontend/configuration/schema are unchanged by this audit. The [recorded test deployment](chat-routine-release.md) is `5dfb930c-7241-4516-97fd-dff9f461de1e`, with the complete current 177-table/806-object schema. Its final independent readback was **13:51:31 UTC**. This audit does not represent a new remote observation or deployment.

## Original scope, item by item

| Item | Delivered behavior and authoritative source | Connected evidence |
| --- | --- | --- |
| S1 — Split new-project/selection, website changes/previews, publication/restore, status/traffic and recovery | `src/chat-interactions/maintained.ts`, `task-context.ts`, `website-results.ts`, `publication-results.ts`, `src/workspace-observations.ts` and `model-continuation.ts` connect those branches to their existing domain handlers and originating tasks. | Intake/selection child #97; private review, publication, observations and recovery journeys below. Separate contract #96, adapters #97/#98 and audit #99 retain the parent scope. |
| S2 — Replace mandatory page detours using maintained Chat elements; retain routes until replacement acceptance | `frontend/src/chat-interaction.tsx`, `chat-interaction-cards.tsx` and shared review/consent/upload components render forms, results and exact controls inline. Review details and current receipts use authenticated domain reads. | Built-browser journeys complete the admitted flows in Chat. Full previews and security/provider consent are the documented handoffs below. Existing direct entry points are retained; WH-111 owns navigation simplification after its dependencies. |
| S3 — Adapt photos under media gates and connections through trusted consent; preserve CMS/Stripe boundaries | `photo-handoff.ts`, `photo-results.ts`, `connection-handoff.ts`, `connection-results.ts`, `src/files.ts` and existing provider handlers. Uploads remain private/held; consent controls grant no provider authority. | Nine D1/R2 photo handoff cases; photo browser/real-Muse/deployed evidence; 21 consent and 21 saved-status cases on each SQLite/D1; nine-call consent browser and eight-stage deployed cancellation/status journey. No CMS testing, scanner implementation or billing activation. |
| S4 — Typed progress/failure/unknown and supported actions in the original task | `task-progress.ts`, `model-continuation.ts`, `src/standard-ai-recovery.ts` and the shared renderer. Submission, continuation and consequential action receipts remain distinct. | Full form/browser recovery plus the new ten-call recovery journey: saved/unstarted, rejected, unknown, pending, timed out and late-result refusal. Publication, upload and consent use their existing exact readback. |
| S5 — Explicit extension points without waiting for future backends | Closed binding registry, validated action union, maintained/composed definitions, domain-specific task restrictions and shared read/display components. The registration contract below names the current source owners. | Current adapters use those extension points. Direct malformed/foreign/unsupported action cases are covered by existing contract, agent and continuation suites. New tier/connector/runtime work remains separately gated. |
| S6 — Reuse onboarding and identity completion; no first-project bypass | `src/index.ts` checks admitted workspace identity and persisted onboarding completion before Chat/workspace routes; `src/onboarding.ts` owns first-project state. Later `project-brief@1` uses the task engine and immutable creation locator. | Current-D1 welcome suite, first-draft suite and customer-site journey; deployed intake evidence refuses Chat before first-project completion. Additional intake does not reset or duplicate welcome. |

## Original acceptance criteria, item by item

| Criterion | Evidence and result |
| --- | --- |
| A1 — Every admitted routine journey completes in Chat, except documented authentication, consent and preview handoffs | Intake/selection, private preview/save, public review/restore/withdrawal, status/traffic, private held-photo intake and consent/status have connected actual-handler/browser evidence. Public effects and successful provider exchange remain disposable local fixtures; their deployment limits are explicit below. No routine Dashboard/Settings detour is required for these adapters. |
| A2 — No duplicate onboarding state; explicit selection before targeting an existing project | Current welcome checks plus selection/intake browser and continuation cases. Selected project IDs are immutable submitted answers; task lookup checks current ownership. Corrections retain the task-created project and never retarget an already issued form or review. Unsupported application/provider requests do not silently create websites. |
| A3 — Submitting a brief, saving a private version and publishing are separate | The actual browser prepares a private change, opens the exact comparison/preview, signs virtual reauthentication and explicitly saves. Publication/restore/withdrawal use separately prepared immutable reviews and typed confirmation. `informationTaskProposalFailure` rejects model approval and out-of-task actions. Public restore preserves the private editing head. |
| A4 — Lost, duplicate, stale/foreign, unavailable and failed operations show truthful recovery | Full browser covers lost draft/submit replies, concurrent edits, unavailable receipt/detail/resource reads and reload. Continuation cases cover expired/changed/foreign reviews and late authority/result changes. The new recovery journey proves saved answers survive provider failure, uncertain cost stays uncertain, timeout fences late results, reload/duplicate/stop do not redispatch, and an existing private approval works without AI. |
| A5 — Media, tenant, feature and consent boundaries apply in Chat and direct APIs; no visitor/runtime maintainer | Current task result/commit guards recheck owner, submission, task revision, feature and observed resource state. File clearance, provider consent and domain confirmation stay in existing handlers. Local D1/HTTP suites refuse foreign reads/actions, unsupported actions and late revocation; browser account-switch/sign-out removes private caches. No visitor/runtime route or funding path is added; the unchanged authorization boundary is covered by WH-004 and current natural-chat/customer-site checks. |
| A6 — Connected replacement evidence precedes removal; keep separate children | Children #96–99 are retained. No direct entry point is removed in WH-110 or this audit. WH-111 remains downstream of WH-109/110/024 and must verify continuity and outage recovery before simplifying navigation. |

## Original verification requirements

| Requirement | Evidence |
| --- | --- |
| V1 — Type/compiler check and selected onboarding, natural-chat, website, workspace-read and recovery suites | Fresh audit commands and outcomes below. Prior exact-source continuation/consent/status/agent suites remain listed separately; they are not described as fresh reruns. |
| V2 — Maintained Playwright with actual Worker/current D1/scripted inference; desktop/mobile inspection | The full built-client fixture, focused publication fixture and focused ten-call recovery fixture. Recovery captures are 360/390/1280 CSS px; inspected saved/unstarted at 360, unknown at 390 and terminal/late-result refusal at 1280. Controls and state remain readable without horizontal overflow. The refreshed full-browser new-project result at 390px, brief at 1280px and exact publication review/controls at 390px were also inspected. Earlier adapter phone/desktop inspections are recorded in the linked feature/release evidence. |
| V3 — Allowed handoffs and separate provider/media/customer gates; no deferred CMS checks | The explicit handoff and remaining-gate sections below. Type checking the maintained CMS schema generator is a static generated-source check, not CMS functional testing. |

## Fresh audit verification

The current fixtures use synthetic accounts/content, current disposable local D1, private local R2 where needed, actual Worker HTTP/domain handlers and the built React client. Model choices are scripted and passkey signatures come from a virtual authenticator. No external inference, provider activation, remote publication, payment or physical-device acceptance is claimed.

| Command | Outcome |
| --- | --- |
| `pnpm --config.verify-deps-before-run=false check` | Passed both TypeScript projects and generated-source checks. |
| `node tests/onboarding-welcome.mjs --d1` | Passed persisted profile/brief/checkpoints, atomic first-project creation, concurrency/lost-response recovery, session/origin and identity-revocation checks. |
| `node tests/welcome-first-draft.mjs` | Passed first website/app brief ownership, scoped dispatch, review separation, replay and late-build/race refusal. |
| `node tests/customer-site-journey.mjs` | Passed connected welcome, private preview/export, exact review, lost-response replay, stale denial, byte-exact restore, withdrawal and retained preview; seven scripted main/seven acknowledgment calls, zero standard customer units. |
| `node tests/workspace-read.mjs` | Passed sourced facts, owner isolation, rejected query/URL fields, missing IDs and exact AI replay. |
| `node tests/chat.mjs` | Passed natural text, typed reviews, replay/foreign isolation, malformed/approval refusal, unavailable AI, bounded knowledge and saved-review recovery. |
| `node tests/chat-interaction-browser.mjs --d1 --recovery-only` | Passed ten scripted main calls, existing private save with AI unavailable/lost committed response, explicit resume, rejected/unknown responses, pending reload/replay/timeout and late-result refusal. Unrelated website unchanged; no publication. |
| `node tests/chat-interaction-browser.mjs --d1` | Passed the complete current Worker/D1/R2/built-client form/intake/selection/preview/recovery journey; 22 scripted main calls, 360/390px and desktop checks, keyboard/focus and account-switch/sign-out isolation. No external inference or publication. |
| `node tests/chat-interaction-browser.mjs --d1 --publications-only` | Passed cancelled-passkey recovery, exact same-task publish/reopen/confirmation/restore/withdrawal/status and reload without additional inference; 19 scripted main calls. Publication effects exist only in disposable local state. |

Private logs are `.secrets/chat-routine-audit-*.log` and `.secrets/chat-routine-recovery-browser.log`; captures are `/tmp/whumpo-task-recovery-{saved,unknown,closed}-{360,390,1280}.png`. The first full-browser and natural-chat processes lost their handles during an interrupted turn and were confirmed absent from the process table, with no completion output. Their `.interrupted` logs are retained; only those unfinished checks were restarted. They are not counted as passes or runtime failures. The next full-browser attempt ended with exit 143 (termination signal) and no completion output; its `.terminated-143` log is retained. The subsequent standalone full-browser run passed; the signal does not establish a product defect or a passing journey.

The previous exact-source verification record, `.secrets/task-connection-status-verification.json`, reports **150 continuation cases**, 21 task connection-status cases each on SQLite/D1, seven focused D1 consent cases, 32 agent cases, account-status checks and type/build checks. [Routine adapter evidence](chat-routine-journeys.md) and [consent evidence](chat-connection-handoffs.md) retain all earlier failed attempts and final bounded real-Muse samples. This audit adds no model-quality claim.

## Registering later adapters

These are extension points in the current implementation, not dynamic executable plug-ins. A new capability must:

1. Own one admitted domain handler and current feature/actor/project authority. Register its closed read/prepare binding in `src/chat-interactions/protocol.ts`; reuse `src/workspace-view-bindings.ts` for existing view data. Binding discovery grants no permission.
2. Add a maintained definition in `maintained.ts`, or a bounded purpose/question catalogue in `composition.ts`. Validate the current definition and answer shape; forms cannot collect passwords, provider tokens, recovery material or implicit approval.
3. Register its exact action in `agent-request.ts` and dispatch in `agent.ts`. Add only its required context and allowed actions in `task-context.ts`; pin current authority before dispatch and atomically at result commit. Never broaden the website adapter into a general application/provider executor.
4. Reuse the domain review and immutable receipt. Add task-owned result reads like `website-results.ts`, `publication-results.ts`, `photo-results.ts` or `connection-results.ts`; preserve unavailable/denied/unknown and historical-versus-current distinctions. Sensitive provider status can use terminal server formatting without returning credentials to inference.
5. Reuse the shared renderer/cards and native protocol subset. Add lifecycle/protection classification for any new retained records. Verify actual-handler/browser replay, outages, stale/foreign targets, late revocation, unrelated-work preservation and zero visitor maintainer access before removing an existing route.

General application, later tier and connector backends retain their own roadmap acceptance. Their absence does not authorize substituting a website or advertising unsupported work.

## Allowed external handoffs

- Trusted identity/enrollment/recovery and deterministic first-project welcome remain outside Chat. Sensitive approval may invoke the browser's passkey ceremony and return to the same review.
- Full private website previews open the existing authenticated preview route. Exact review, confirmation and result remain in Chat.
- GitHub/Cloudflare consent opens only the existing registered authorization destination after explicit action. Durable server-owned return links recover the originating card, including cancellation or lost callback response. The Chat return itself never proves consent or current provider health.
- The maintained private file picker receives the explicitly selected upload. It cannot clear safety holds or authorize website insertion/publication.

Account/security/billing/support and urgent withdrawal/recovery stay directly reachable. Stripe remains the authorized sandbox; this adapter audit adds no payment workflow or charge.

## Gates this audit does not close

| Gate | Retained scope |
| --- | --- |
| WH-020 / WH-112 | General real-model quality, acknowledgment reliability and full primary-owner experience. Real-Muse samples are bounded; the latest deployed connection probe retained an uncertain acknowledgment. |
| WH-024 / WH-005 / WH-114 / WH-115 | Complete owner usability/screen-reader journey, physical-device passkeys and recovery. Viewport emulation and signed virtual credentials are not physical-device/customer acceptance. |
| WH-117 | Independent off-device key custody and remaining protection/restore acceptance. Test key initialization is recorded, not upgraded to completed custody. |
| WH-031 / WH-032 and later connector packets | Real consenting accounts, permissions, reviewed operations and revocation. GitHub customer configuration remains unactivated. Successful token-exchange recovery is local synthetic evidence; deployed evidence uses intercepted consent and cancellation. |
| Safety/media and customer admission | Private held-photo intake does not clear photos for public use. CSAM/scanner implementation and Daybreak remain owner-deferred; CMS functional testing remains deferred. WH-048 and its safety/operations requirements still gate real customers. |
| Commercial acceptance | Real payments, complete cumulative tiers/providers, economics and original MVP fulfillment remain separate. This audit does not admit paying customers. |

The recorded deployed journeys cover intake/private website creation, review preparation/reopening/outcomes, status/traffic, private held-photo upload and cancelled consent/saved status. Actual publish/restore/withdraw effects are accepted here only in disposable local tests. Historical releases, current deployment, scripted behavior, real-model samples and physical/customer acceptance remain distinct.
