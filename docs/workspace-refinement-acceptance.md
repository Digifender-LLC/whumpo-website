# Workspace refinement acceptance — 29 September 2026

The workspace uses Chat as its first/default full-page view. Dashboard and custom pages hide Chat completely. Settings and the profile photo stay inline at opposite ends of the sidebar footer; email is visible only inside Profile. There is no Tools or Add workspace button. Accounts without custom pages get an invitation to ask Whumpo for a workflow page.

This pass adds consistent settings widths, visual theme previews, aligned project actions, custom-page navigation icons, keyboard-accessible photo selection, page-specific browser titles, and a return button inside settings/project panels. The dashboard starts hidden to prevent a flash of two views during initialization. Closing a previously open panel no longer redraws an unrelated current page.

Verified using the local Worker and synthetic account in the browser:
- Reload starts in Chat; Dashboard has no visible chat pane.
- Profile contains name, photo, email, About me, sign-in/security and sign-out.
- Settings contains appearance, billing/usage, external connections and plan preferences.
- Billing opens within Settings and its return button restores Settings.
- Day and Night rendering; 390 px mobile Dashboard and Settings have no horizontal overflow.
- Empty custom-page navigation shows the call to action; selecting it fills and focuses Chat without submitting an AI request. Synthetic layout restored afterward.
- Build, TypeScript check and whitespace check pass.

Deployed platform version: `4ffc2240-4202-45af-89de-89424465ef98`. The live workspace HTML, stylesheet and JavaScript were checked byte-for-byte against the local build. Existing unfinished visitor lifecycle work was not activated or migrated by this UI release.

Email editing remains unavailable until verified email changes are supported. Billing remains a preview; no payment account was connected.

## Mobile interaction design — September 29, 2026

Phones now use a full-width workspace with a five-item bottom navigation bar: Chat, Dashboard, Your pages, Settings and Profile. Your pages opens a bottom sheet containing existing workflow pages or the agent-led empty-state invitation. Desktop retains its sidebar. Chat stays a separate view, and account email remains inside Profile.

The composer follows the visible viewport, supports multiline Enter on phones and uses the explicit Send button. Fine-pointer desktop Enter retains send behavior. Navigation yields space while a focused editor has a substantially reduced viewport. Safe-area padding, 44–52px touch targets, 16px form text, independently scrollable content, bounded bottom-sheet dialogs and compact page spacing support phone use. Landing navigation, hero actions and sign-in have dedicated mobile layouts. Sign-up requests the flexible Turnstile layout.

Browser verification: 390px workspace, 360px landing/settings/navigation and 320px sign-in; no horizontal document overflow on the inspected landing, settings or final sign-in views. Verified multiline Enter did not send, sheet cancellation retained a chat draft, navigation labels and active states rendered, dashboard customization opened as a sheet, and 52px bottom-nav touch targets. Simulated reduced-height editing kept the Send button at y=414–458 in a 480px viewport. A discovered sheet transform issue and 320px sign-in overflow were corrected. TypeScript, production build, chat-delivery regression and acknowledgment-timing tests passed.

The tests use browser viewport emulation and synthetic local account data. Physical iOS/Android keyboards, autofill, safe-area hardware, native passkey prompts and human Turnstile remain device acceptance work; this is not a claim of native application installation or OS integration.

Deployed platform version `c0fc3f0c-fafa-487c-98a3-cbdc398a77c2`. Live verification confirmed the viewport metadata, exact tested JavaScript/CSS assets and platform health.

## Mobile navigation refinement — September 29, 2026

Nested controls now retain their parent destination in bottom navigation (billing/connections under Settings; security under Profile; project controls under Dashboard), with an explicit return link. Chat uses exact route matching so it no longer appears selected on every workspace screen. Changing workspace pages or selected projects resets the main scroll position. Phone form controls have 48px minimum height, icon actions have 44px minimum width, wrapped action groups avoid crowding, and tab strips scroll horizontally. Sheets account for the keyboard inset; landscape safe areas protect page content. Landing headings and cards have tighter phone proportions.

Verified locally with a disposable account: 360px landing has no horizontal overflow; 360px Billing shows only Settings selected, its return link works, and Your pages opens/closes as a bottom sheet. Settings has no document overflow at 360px or 320px. Screenshot: `.secrets/mobile-refinement.png`. TypeScript and production build pass. Physical device keyboard and landscape safe-area behavior still require iOS/Android acceptance.

Deployed platform version `d57956df-ae5a-45b3-9079-d7f44a8f1d90`; live frontend asset bytes match the tested production build.

## Phone conversation polish — September 29, 2026

Chat follows incoming content only while the reader is at the end. Reading older messages keeps the scroll position; a thumb-accessible “Latest messages” action returns to the end. Viewport/composer resizing follows the end only when already there. Sending a new message resumes following. The composer recalculates its height when a draft is cleared programmatically, and its phone bottom padding respects the safe area.

Verified with a synthetic eight-turn conversation at 360×780: no horizontal document overflow; scrolling back showed the latest-message action; growing a four-line draft kept the same conversation scroll position (342.5px); clearing it shrank the composer from 112px to 64px; tapping Latest messages left a zero-pixel gap at the end. TypeScript, production build and `test:chat-delivery` passed. Screenshot: `.secrets/mobile-chat-polish.png`. Physical iOS/Android keyboard acceptance remains outstanding.

Also checked 320×700 with no horizontal overflow and the Send control inside the viewport. Deployed platform version: `d98036d4-7e10-4a56-9299-c2086c719c73`; live JavaScript/CSS bytes match the tested build.

## On-demand workspace downloads — September 29, 2026

The landing route now defers the workspace module until entry. The persistent workspace defers Dashboard, Profile, Settings and secondary controls until one is opened. Chat draft/request state remains in the parent component; changing secondary pages does not remount it. The existing profile/onboarding gate still runs before workspace data requests or controls render. This uses React's documented [lazy and Suspense boundaries](https://react.dev/reference/react/lazy).

Loading states announce progress. A failed page render/download displays a reload action and warns that unsaved changes will be lost; no automatic reload or request replay occurs. The secondary-page boundary leaves desktop/mobile navigation available so customers can return to Chat. The boundary resets when the selected page changes.

The isolated release reduced initial landing JavaScript from 548,320 to 346,754 bytes (about 37%). Opening Chat loads 450,988 bytes total; the secondary-controls chunk adds 101,864 bytes only when needed. Gzipped initial JavaScript is 111,625 bytes versus the previous build's approximately 168,250. These figures exclude CSS, fonts, images and external analytics, and measure transferred code size rather than device load time. Code splitting slightly increases the complete set of JavaScript (552,852 bytes) and adds a first-open request for each deferred module.

Verification: `pnpm check` and `pnpm build` passed in the primary workspace; both TypeScript projects, the production build and `node tests/frontend-loading.mjs` passed in the isolated release. The loading test walks the Vite manifest, proves landing does not eagerly import Workspace and Chat does not eagerly import secondary controls, and verifies referenced artifacts exist. Existing independent pricing changes were preserved; unfinished account-recovery changes were excluded from the release.

Deployed test platform version `195f2a90-4bbc-4e0d-b073-330c4db29264`. All 18 manifest output files matched the release byte-for-byte; health returned 200 and anonymous onboarding returned 401. A live browser opened the landing page with only the entry/shared module preloads, selected Your workspace, observed its loading state, then reached passkey-first sign-in with the workspace module added and no secondary-controls preload. Authenticated panel transitions, simulated failed-download recovery, and physical-phone timing were not exercised in this increment.

## Workspace connection recovery and accessible replies — October 1, 2026 UTC

WH-024 ([issue #10](https://github.com/zemdregon/whumpo/issues/10)), source baseline `bab3812`. This increment fixes observed workspace failures; it does not complete the whole owner-journey or assistive-technology acceptance task.

- Chat and Dashboard now distinguish an initial read failure from a failed refresh. An explicit retry repeats only the read. Previously loaded conversation/dashboard content remains visible during a failed refresh, with a stale-view explanation. The mobile Your pages sheet no longer treats an unavailable page list as an empty account.
- Successful read retries put keyboard focus in the recovered workspace/sheet unless the person moved elsewhere during the request. The mobile sheet uses Radix's actual dialog trigger, so Escape returns focus to Your pages. A skip link reaches the main workspace without traversing the sidebar. The desktop custom-page invitation focuses the composer when it fills a request.
- A polite, atomic status region announces new or updated saved replies without moving focus or reading the initial history aloud. Identical polling snapshots and unfinished turns remain silent. A saved failure response is announced as a reply, never as successful work. Acknowledgments retain their existing timing and get status semantics. This follows [W3C status-message guidance](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html) and [keyboard-focus guidance](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/), checked October 1; markup/browser inspection is not a screen-reader certification.
- Accepted turns that are still pending display a working message. Send/help/review controls wait for the outstanding reply, while the customer can write the next draft and use other workspace views. Explicit uncertain-delivery retry retains the original request ID, revision and payload. Ordinary sends and message retries focus the composer at initiation, not when a later reply arrives.
- Dashboard activity is filtered to the requested page before deciding whether it is empty. Its empty state no longer tells customers with an existing project to create their first one. Requested shortcut/withdrawal errors use the existing notice, and withdrawal preparation respects the busy state.

### Verification

`pnpm check`, `pnpm build`, `node tests/frontend-loading.mjs`, `node tests/chat-delivery.mjs`, `node tests/chat-announcements.mjs`, and `node tests/ack-timing.mjs` passed. The announcement fixture covers initial history, identical polls, pending-to-finished and new replies, changed text, saved failure responses, empty text and multiple updates. Delivery checks retain committed-result readback, same-ID recovery, mismatched content/identity refusal and definitive-error behavior. Timing checks preserve the 700/730 → 1700 ms acknowledgment rule.

`node tools/workspace-recovery-browser.mjs` serves the production frontend against an explicitly synthetic, loopback-only API. Browser checks at desktop, 360×780 and 390×844 verified initial Chat/dashboard failures, keyboard read retry, preservation of previously loaded data after refresh failure, draft/pending-request survival across Dashboard navigation, visible pending status, disabled overlapping send, a second draft surviving reply arrival, repeated reply announcements, multiline phone Enter, page-sheet recovery and Escape focus return. The fixture independently asserted that lost-response retry used the exact original ID/revision/content and that the subsequent message had a different ID; there were three saved turns including initial history. No real inference, billing, publication, database or provider was involved. Private evidence: `.secrets/workspace-recovery-browser.json` and `.secrets/workspace-recovery-mobile.png`.

Observed document width matched 360/390 px with no horizontal overflow. At 390×844, Send was 44×44 px inside the viewport (x=322, y=674). After a reply arrived, the next draft and composer focus remained intact. A new page load had an empty announcement region. Keyboard inspection verified the skip link, read-retry focus, and final Radix-trigger focus return. These are rendered browser/accessibility-tree checks, not actual speech-output tests.

### Still open

At this increment, WH-024 remained open for the complete invitation → welcome → draft → review/preview/recovery keyboard journey, actual screen-reader output, broader contrast/error-state review and physical iOS/Android checks. The following historical reload limitation is superseded by the next increment. Full reload/tab-close persistence was unresolved: draft and uncertain request state are held in the mounted workspace, not durable browser storage. Navigation and read retries preserve that state; reload still loses an unsent draft or client-only uncertain-request identity. Server-saved turns remain readable. No silent local storage of messages or automatic resubmission was introduced. CMS testing and CSAM implementation remain owner-deferred.

### Test deployment

Managed release `02370893-1c87-419d-ad49-9162ddb0f135` deployed source `524cf00`. Independent readback at **2026-10-01T03:04:55.347Z** confirmed all four candidate versions, unchanged service/secret-binding names and CMS registrations, all 113 migrations applied with none pending, and all 16 platform assets matching the archive. Home, workspace and health returned 200; anonymous Chat/profile returned 401. The workspace document references the exact reviewed entry assets. Platform version: `e9f01d13-47cd-4a8b-84ad-3df7e6e43b70`. Private evidence: `.secrets/workspace-release-verification.json`, `.secrets/workspace-entry-verification.json` and the immutable release archive.

This verifies that the tested frontend is deployed. Interactive acceptance was performed against the synthetic loopback API, not a live authenticated owner session. No new schema, service contract, route, schedule or binding change was needed. The checked generated visitor difference was dependency-path comments only. Automated GitHub review bots reported account review quotas exhausted; no automated review approval is claimed.


## Chat reload recovery — October 1, 2026 UTC

WH-024, source baseline `45693b1`. Chat now stores a bounded draft and unresolved request in this tab’s session storage, keyed to the authenticated account ID. The profile API exposes that ID only for the signed-in owner; profile writes cannot change it, and agent profile context excludes it. The workspace mounts fresh on account identity changes; Chat/dashboard query caches are account scoped. Old API responses without an account ID remain usable in memory and show that browser recovery is unavailable.

A restored unresolved request first checks fresh saved Chat history. An exact ID/text match clears the local pending state without another send. Otherwise explicit Retry retains the original ID, revision, text and validated typed action; no automatic replay occurs. Retry remains disabled while that initial read is unavailable. Existing server ownership, idempotency, current review and reauthentication gates stay authoritative. New drafts survive arrival of a prior reply. Sign-out clears this tab’s record; another account cannot restore it. Late callbacks from an unmounted account cannot overwrite recovery storage.

Drafts expire after 24 hours since the last edit. Pending request details are retained until resolution/sign-out/browser removal so a timeout does not lose operation identity. Browser session restore can retain the data and duplicate tabs can inherit a copy; this is not cross-device synchronization or guaranteed tab-close recovery. Storage is same-origin readable, not a credentials store; blocked/quota failures are surfaced beside the composer. Expiry is checked on app access, not through background deletion. [Data lifecycle](data-lifecycle.md) records these limits.

### Local acceptance

`node tests/chat-recovery.mjs` checks account separation, bounded strict parsing, exact natural/typed request preservation, expiry and clock rollback, unresolved retention, clearing and storage failures (including a failed expiry write preserving valid request identity). `node tests/chat-recovery-profile.mjs` checks owned/authenticated profile IDs, rejected ID updates and no addition to agent context using disposable SQLite and the actual bundled Worker. `node tests/chat-delivery.mjs`, `node tests/chat-announcements.mjs`, `node tests/ack-timing.mjs`, `pnpm check`, the production build and `node tests/frontend-loading.mjs` cover the affected delivery/presentation/type/asset boundaries.

The loopback-only synthetic browser fixture (`node tools/workspace-recovery-browser.mjs --reload`) verified unsent draft reload, reload after an accepted request’s response was lost, disabled request retry while Chat reads fail, history recovery without another POST, and reload before acceptance followed by an explicit exact-envelope retry. Its three POSTs comprise the first accepted request plus the second request and its exact retry; saved history contains three turns including the initial fixture turn. Account switching discarded the old draft and displayed only the other account’s empty history; returning to the original account did not restore that draft. Signing out and returning cleared a fresh draft. At 390×844 the document width was 390 px with no horizontal overflow. Evidence: `.secrets/chat-reload-browser.json`, `.secrets/chat-reload-recovery-mobile.png`. No real inference, provider, customer data or publication was involved.

WH-024 remains open for the complete invitation/welcome/review/preview keyboard journey, actual screen-reader speech, broader contrast/error states and physical phone checks. This increment resolves reload persistence, not those remaining acceptance criteria. Deployment evidence is recorded separately after verification.
