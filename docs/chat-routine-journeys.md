# Routine owner journeys in Chat — WH-110

**October 3, 2026 UTC; source baseline `cbcdf2a`. Status: implementation open. Parent [#95](https://github.com/zemdregon/whumpo/issues/95); contract [#96](https://github.com/zemdregon/whumpo/issues/96), intake/selection [#97](https://github.com/zemdregon/whumpo/issues/97), routine adapters [#98](https://github.com/zemdregon/whumpo/issues/98), full acceptance [#99](https://github.com/zemdregon/whumpo/issues/99).** This contract preserves all six scope bullets and six acceptance criteria in WH-110. It reuses accepted WH-106–109 storage, renderer, task memory and shared view components. Closing an adapter child does not close the parent or constitute full owner, provider or device acceptance.

## Source-grounded journey map

| Journey | Existing authority and evidence | Remaining connected work |
| --- | --- | --- |
| First project | Deterministic `onboarding.ts` and current identity completion gate; welcome completion creates the first private project before workspace routes become available. | Keep that entry gate. Later Chat intake must never reset welcome or bypass incomplete enrollment/onboarding. |
| Additional project | Maintained `project-brief@1` saves immutable name/purpose answers; natural Chat's bounded `project` action atomically creates an additional project and first private website specification. | Join intake, suitable clarification, private project creation and first supported result into the originating task, without making the owner repeat submitted answers. Preserve ordinary unsupported-app explanations; a website is not a substitute for another requested workload. |
| Existing project selection | Maintained `project-select@1` uses the current owned resource picker; submitted-answer inspection explicitly reads its immutable selection. | Save-and-continue the original task with only that selected project. Recheck both original account admission and current project authority before dispatch and commit. Correction must not retarget existing forms/reviews. |
| Website changes | Maintained content forms call the existing specification compiler, private preview and exact user-only save; composed information forms have receipted one-lookup model continuation. | Connected ordinary request → intake/selection → preview → exact private save, including interruption and unavailable inference; preserve original questions and unrelated fields. |
| Publish, restore, withdraw | Typed Chat controls and immutable owned review links already call existing publication handlers; previews/comparisons have authenticated routes. | Present exact destination/version/change/recovery evidence in the originating task, then accept full Chat journeys. Private save and public publication remain separate approvals; keep urgent withdrawal directly reachable. |
| Status and traffic | WH-109 shares registered current readers across temporary Chat views and saved pages; denied/unavailable metrics are explicit and reads do not invoke inference. | Integrate these results with the relevant task and supported recovery. Do not recreate a reader or make dashboard navigation mandatory. |
| Photos and connections | Maintained private photo handoff, held uploads, approved-photo selection and trusted consent routes exist. | Complete only admitted media/consent handoffs in Chat; retain clearance and current feature gates. No scanner/CMS work, real billing or external provider authorization follows from this packet. |

## Delivery children and full-parent acceptance

1. **WH-110A: journey/adapter contract.** Freeze this map, allowed external handoffs, shared authority and acceptance coverage before runtime changes.
2. **WH-110B: project intake and selected-project continuation.** Reuse the existing interaction, submission, task-progress, standard AI reservation and exact receipt pipeline. Deliver selected website-task continuation first, then additional-project intake through its existing creation handler. The child stays open until both branches and connected browser acceptance pass. Broader application selection must have an admitted adapter; never silently run a website action for it.
3. **WH-110C: routine results, exact reviews and supported recovery.** Complete website edits/publication/restore/status and admitted media/consent handoffs through existing handlers. Include adverse cases and honest progress/unknown outcomes. Preserve remaining parent scope.
4. **WH-110D: connected original-scope acceptance.** Audit every parent criterion against actual Worker/current D1/built-browser evidence, plus separately labeled deployed/model/device/provider gates. Remove a redundant entry point only after its replacement journey and outage/recovery path are accepted.

No separate project-selection session, answer store, entitlement resolver, provider queue or billing ledger is introduced. Definitions and adapters are current-only. An incompatible maintained-form change requires a coordinated disposable current-client/schema/data cutover, with no prior null-continuation reader, alias or migration. Existing current receipt reconciliation never redispatches a model or an uncertain external operation.

## Selected-project adapter boundary

The maintained picker remains account-scoped while collecting the explicit project ID. Its submitted answers are immutable. The continuation resolves that ID into a current owned project and uses the existing bounded task engine: original request, selected project's current facts, task questions/summary and exact pending reviews only. Other projects, profile, unsubmitted drafts and unrelated history are excluded.

Both account-scoped form eligibility and project-scoped task eligibility are checked before model dispatch and in the final transaction. The guards pin the submission/answers digest, task revision and selected project ownership. Permission loss, removal, transfer or correction during inference must prevent the prepared result from committing. Readback may retain the owner's immutable selection/receipt without restoring lost project authority. A new selection does not retarget an already issued project form or review.

The first selected-project implementation admits the existing bounded website specification read/create/change task actions only; exact private application/publication still requires its independent user review. General runtime/application/provider actions are not enabled by a project picker. Further adapters register their own action scope within WH-110C. Keep the original request visible and respond truthfully when that selected task is outside the admitted continuation.

## Allowed handoffs

- Current authentication, recovery, credential enrollment and first-project welcome remain trusted deterministic screens outside Chat. Forms must not collect credentials or recovery material.
- Owner-only full website previews may open in their existing protected browser route; reviews and task results remain in Chat.
- Provider consent uses the registered provider destination and return/cancel receipt. Chat cannot grant consent or send an external message on the user's behalf without its existing authorization.
- Uploading a file uses the maintained private upload control; held/unsupported media cannot be inserted or published by bypassing clearance.
- Account/security/billing/essential support and urgent recovery controls remain independently reachable. Routine navigation cleanup belongs after connected replacement acceptance.

## Required evidence

Use maintained Playwright fixtures with the actual Worker and current disposable D1; the available tooling has no callable quality-manager runner. Inspect narrow and desktop images. Prove scope/canary exclusion, current eligibility before and after inference, duplicate submission/continuation, exact receipt recovery, late correction/removal, stale/foreign review refusal and unavailable inference without automatic retry. Verify the onboarding gate separately from already admitted Chat fixtures. Tests must observe real handlers; scripted model choices, actual Muse responses and deployed/device acceptance remain separate evidence.

Current implementation remains open. CSAM/scanner implementation, Daybreak and CMS functional testing remain deferred. Stripe stays within the authorized sandbox; no real money, customer publication, new paid service or provider activation is authorized by this plan.
