# Daily Chat continuity — WH-111

October 3, 2026 UTC. [WH-111 / issue #100](https://github.com/zemdregon/whumpo/issues/100) is **in progress** on `codex/identity-admission`. Dependencies WH-109, WH-110 and WH-024 are accepted to their recorded scope. PR #79 remains draft/open. This packet is not WH-112 whole-customer-experience acceptance.

## Current source contract

Routine work belongs in Chat and its maintained panels. Saved pages are optional. Saved state, account/security/sign-out/support and urgent takedown/recovery must remain accessible without inference; generated layouts cannot own or hide those entry points. Server-owned project/task selection, domain handlers, review receipts and current identity admission remain authoritative. Current-only clients and schemas are required; no old-route adapters or data migrations are introduced.

### Reopening saved forms

The history dialog now searches and lists saved work; its second form editor is removed. Choosing a form closes the dialog and opens its current interaction in Chat. A form already in recent Chat is reused rather than rendered twice; an older form is rendered through the same component and current server read. The `interaction` query parameter is a strict UUID locator. It carries neither answers nor approval authority.

A per-tab `sessionStorage` record, `whumpo.chat-location`, retains only the current version, authenticated account ID, interaction ID and last explicit opening time. It expires after seven days without opening activity. Reading the stored locator does not renew its lifetime; explicitly opening a URL containing the locator counts as opening it. Malformed, stale-version, clock-rollback, expired and other-account records are removed. Existing account/sign-out cleanup clears it alongside Chat/form/photo recovery. Storage errors are visible; they do not pretend navigation has been saved.

This device locator has no model reader, server copy, PWA cache or export contents. The existing interaction API rechecks ownership, current admission, retention and project binding. It cannot select a different project, mutate answers, resume a model, upload a file or approve a review. URL navigation in another tab retrieves that tab's current server state; unsent local answers/composer text are not copied between tabs. Current draft and unresolved operation stores keep their original identities and retention rules.

**Close saved item** removes only the navigation locator. It never discards the form, answers or unresolved request. A form still in recent Chat remains there. Reopening an existing visible item refreshes current server state; removed or unauthorized work cannot become actionable through the saved locator.

## Whole-packet requirements and remaining work

| Original requirement | Current state / next evidence |
| --- | --- |
| Chat-centered desktop/mobile navigation; optional saved views | Existing Chat-first shell and accepted routine adapters. Source change removes the duplicate history editor. Audit and remove superseded routine routes only after equivalent direct recovery is accepted. |
| Composer, selected project, interactions, pending review/result links across reload/returns/tabs | Existing exact Chat/form/consent recovery; reopened interaction locator added. Broader selected-project continuity, older review/result recovery and all current return paths still need the connected acceptance map. |
| Bounded account-scoped saved-work recovery without automatic effects | Reuse current history/index/read handlers; locator opens only fresh reads. Consolidated operation/review access and inference-outage acceptance remain. |
| Essential account/security/sign-out/support, takedown and pending work | Existing profile/security and Dashboard takedown paths; onboarding/profile-load failure still lacks a complete independent support/recovery entry. Complete this before simplifying navigation. |
| Clear private state on logout/account change; refuse stale/revoked authority | Existing identity generation, query-cache and recovery cleanup includes the new locator. Complete cross-tab/current-identity acceptance is still required. |
| Keyboard, screen reader, zoom, reduced motion and soft-keyboard continuity | Existing accepted WH-024/107 evidence is the baseline. Changed navigation needs connected keyboard/Orca and responsive checks; physical device limitations remain explicit. |

## Verification and deployment

The locator storage suite, existing Chat recovery/delivery, provider-return and authenticated history suites pass locally. Current frontend type/compiler checks pass. `node tests/chat-screen-reader.mjs` passes the complete current-Worker/D1/R2/built-workspace journey with 22 scripted main-model calls and eight actual Orca speech checkpoints, including reopening a saved form in Chat. The connected checks cover history beyond 100 turns, navigation/reload, separate-tab server drafts, no duplicate editor or automatic resend, a form discarded after listing, account switching, sign-out and pending-operation fencing. Inspected 360/390/1280px captures show the reopened form and separate unsent composer draft. Existing simulated keyboard resize, magnification, reduced motion and lost-response checks remain in this run. Orca uses an isolated silent speech sink; this is generated-speech evidence, not human listening or physical-device acceptance.

Earlier attempts remain recorded: a selector incorrectly required a field after its form was discarded; a temporary notice change broke discard focus and was reverted; one local Chat read exceeded the former 15-second fixture timeout without an application error; and programmatic focus did not produce the required Orca metadata. The final run uses the current unavailable-form selector, unchanged discard notice behavior, a 30-second fixture timeout with request timing diagnostics, and real keyboard navigation. A passing rerun does not establish a latency or load target.

The focused `node tests/chat-interaction-browser.mjs --d1 --consent-only` journey also passes on this source: signed virtual-passkey authorization, synthetic OAuth start/cancel/success and Chat return, lost committed callback with one synthetic token exchange, older-history reload, another tab, terminal saved status and read outage/access loss without redispatch. It uses nine scripted main-model calls and no real consent or provider resource reads.

This increment remains pending deployment. No server schema/authority change, external inference, provider activation, billing or customer publication is part of it. CSAM, Daybreak and CMS functional testing remain deferred. The broader WH-111 requirements above and WH-112 customer acceptance remain open.
