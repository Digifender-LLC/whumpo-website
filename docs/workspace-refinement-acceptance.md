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
