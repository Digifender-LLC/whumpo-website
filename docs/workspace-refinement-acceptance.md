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
