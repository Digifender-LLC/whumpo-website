# Business lead pipeline (WH-093)

**October 8, 2026 UTC; source baseline `ca17c6a`.** This document is the contract for [WH-093](roadmap/backlog.md#wh-093--extend-maintained-records-into-the-business-lead-pipeline): owner-operated stages, notes and due dates on accepted enquiries for Business plans. It separates what is **implemented**, what is only **proposed**, what depends on **shared adapters**, and what waits on **owner decisions**. Nothing here is deployed or accepted, and the task is not complete.

| Status word | Meaning in this document |
| --- | --- |
| Implemented in source | Code and a local test exist on this branch. Not merged, not deployed. |
| Proposed | Design only. No table, route, binding or UI exists, and it is not approved. |
| Owner decision pending | Do not build dependent behavior and do not treat any recommended answer as approved. |
| Accepted | Live or customer acceptance. Nothing for WH-093 is at this level. |

## Implemented pure core

[`src/shared-modules/leads-domain.ts`](../src/shared-modules/leads-domain.ts) is a synchronous module with no storage, clock, timezone, network, inference, route or catalog access. Later handlers read a lead, call it once, and commit the returned state; the caller supplies every time, id and reference date. It reuses the project's bounded JSON helpers ([`json.ts`](../src/project-specification/v2/json.ts)) and the fixed `ModuleError` messages ([`policy.ts`](../src/shared-modules/policy.ts)), so errors never echo a submitted value. [`tests/leads-domain.mjs`](../tests/leads-domain.mjs) runs in `pnpm verify fast` (`pnpm test:leads-domain`).

| Rule | Behavior |
| --- | --- |
| Stages | Closed, current-only: `new`, `contacted`, `qualified`, `won`, `lost`. Any stage may move to any other. A lead with no stored state is `new`, revision 0. Unknown, differently-cased or non-string stages are `invalid_request`. |
| Due date | A real proleptic Gregorian calendar date `YYYY-MM-DD`, years 1-9999, no time of day and no timezone. Impossible dates (`2026-02-29`, `2026-04-31`), year 0, other shapes and non-ASCII digits are refused, never rolled forward. `null` clears it. |
| Overdue | `leadDueBucket(lead, referenceDate)` needs an explicit civil reference date; there is no default and no instant is accepted. Only `new`, `contacted` and `qualified` leads can be `overdue`, `today` or `week`; `won` and `lost` keep their date as history (`inactive`). The module uses integer day arithmetic and no `Date`, so the process timezone cannot affect it (tested under several zones, including DST dates). |
| Notes | Up to 20 per lead; each non-blank, 1-1,000 Unicode code points, no control characters except tab, newline and carriage return, no unpaired surrogates; stored verbatim (no trimming or normalization). The canonical JSON of all notes is at most 16,384 UTF-8 bytes. Exceeding a count or byte cap is `limited`; an unknown note id is `not_found`. |
| Changes | `{changes:{stage?, dueOn?, note?}}` with `note` one of `{op:'add',text}`, `{op:'edit',noteId,text}`, `{op:'remove',noteId}`. Unknown fields, prototype keys, accessors, symbols, non-plain objects, `undefined`, non-finite numbers, coerced types and oversize bodies are `invalid_request`. A request that changes nothing is `invalid_request`, not a silent revision bump. |
| Revision check | `applyLeadChanges` requires `expectedRevision` to equal the state's revision (`stale_configuration` otherwise). It returns a new deeply frozen state and a bit mask of what changed; it never mutates its inputs. Timestamps never move backwards. The core imposes **no** revision cap other than the safe-integer ceiling (see [Open items](#proposed-storage-and-open-items)). |
| Filters | `parseLeadFilter` validates only decision-independent fields: `stages` (1-5 distinct), `hasNotes`, inclusive `dueFrom`/`dueTo` civil dates with `dueFrom <= dueTo`. The result is canonical (stages in vocabulary order); `matchesLeadFilter` is the reference semantics a later query must match. Bucket filters such as "overdue" depend on a reference date and are not part of the filter. |
| Stored notes | `readLeadNotes` accepts only the exact canonical text the module writes and otherwise reports `unavailable`; it does not repair rows. |

Deliberately not built: a cursor codec (no list API exists to need one), a reference-date function (which date counts as "today" is the pending timezone decision), any retention rule, any intake source, any constant for a revision cap or bulk-apply size.

### Private notes

Notes are owner-typed but may copy visitor text, so they are private content. The owner's note input must stay in a native control and must never be a Chat or model value; notes do not enter Chat history, bindings, receipts, events, errors, logs or maintainer context. Stage and due-date changes may be offered through the shared Chat/view adapters below, with exact review.

## Shared adapters are required for acceptance

WH-093 requires routine owner operations to go through the registered WH-105 read/action bindings and the WH-107/109/110 Chat/view adapters, with the domain handlers implemented once. A dashboard panel on its own **does not satisfy** the task. Every per-lead edit is a routine owner operation, so a dashboard control is an additional surface, not the acceptance path; only essential recovery and security controls are direct-only. The pure core above is the single implementation those adapters and any dashboard control will share.

Not implemented: the handlers and operation registration, read routes, a counts-only `leads.summary@1` read binding and workspace view, exact-review Chat actions for stage and due date, and a native note editor.

## Acceptance criteria: all unfinished

| Criterion | Status |
| --- | --- |
| Direct APIs, Chat and background work enforce shared current feature eligibility (`business.leads`); forged identifiers cannot bypass tier or tenant | **Not met.** No handler, route, admission or tenant scoping exists. |
| Duplicate delivery creates one lead; accepted records survive notification failure | **Not met.** No storage or intake path exists. |
| Cross-owner access, stale note/stage updates and deleted-record resurrection are refused | **Partly shown only for the pure revision check.** Tenant and resurrection checks need storage and handlers. |
| Contact expiry is not silently changed to indefinite CRM retention; deletion/export keep minimal receipts | **Not met.** No retention, deletion or export behavior is implemented or decided. Contact messages keep their 30-day window and are untouched. |
| Private lead/message content is not added to maintainer context | **Not met.** Only the module-level rule above is in place; no surface exists to prove it. |
| Connected inbox-to-stage/note/due-date browser journey | **Not met.** |

The task also needs a mapped issue, shared Chat/view/native adapters, eligibility and D1 atomicity tests, tenant, export and deletion tests, and the browser journey before it can close.

## Proposed storage and open items

None of this is approved or built.

- **Sidecar storage.** A table keyed to the accepted record (`module_records`), created lazily on the owner's first change and removed with the record, so intake and the visitor-writable records schema are untouched. Owner-only fields must not be added to the intake schema, because `forms.submit` takes every schema field from the visitor.
- **Eligibility.** Writes compose the `business.leads` feature predicate into the committing statement; reads, export and deletion remain available after plan loss. `business.leads` stays `planned` until a usable surface ships.
- **History.** Content-free events (revision, stage from/to, change mask, time) for later follow-up and reporting work.
- **Revision cap.** The design floated 200 revisions per lead as a proposal. No capacity rationale has been written, so the core does not enforce it.
- **Any schema change** needs an owner-authorized empty-database cutover (`docs/releases.md`); this change adds none.

## Owner decisions pending

Answers are not recorded, and no recommended option has been adopted. The pure core makes none of these choices.

1. **Intake sources:** whether leads come only from maintained form records or can also be explicitly promoted from other sources. No contact-inbox code or copy exists, and the 30-day contact window is unchanged.
2. **Retention:** whether lead state, notes and history follow the record's existing retention or have their own policy. No lead retention is approved; the existing 90/30/365-day module record retention covers records, not lead data.
3. **Due-date timezone:** which zone defines "today" for overdue and due-today. This sets one argument (the reference date) a future handler passes in; the core does not assume UTC or any zone.

## Not claimed

Nothing here claims storage, routes, Chat or dashboard delivery, entitlement activation (WH-090), reminders (WH-094), conversion reporting (WH-095), CRM integrations, Pro collaboration, deployment, purchase or acceptance.
