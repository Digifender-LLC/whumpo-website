# Whumpo owner app: UX spec (Android first, desktop-ready)

**Status: proposed October 29, 2026 by the mobile and app lead. Docs only, with no app code.** The platform decision is in the [ADR](../android-app-platform.md): Kotlin Multiplatform with Compose Multiplatform, Android first. Product scope, authority and the wire contract are owned by the [Android owner app contract](../android-app.md) and [mobile-api-v1](../mobile-api-v1.md). This spec does not widen them. Where it names an API, endpoint or control, that is a reference to the frozen contract, not a new one.

**Method.** The ui-ux-pro-max skill (priority order: accessibility, touch, performance, style, layout, type and colour, motion, forms, navigation), its `jetpack-compose` stack guidance and mobile pre-delivery checklist, and its design-system skill (primitive, then semantic, then component tokens). It follows the October 2026 design direction, `docs/design/direction-2026-10.md`, decisions D1–D12. That doc was proposed the same day in a separate PR and is not on main yet. This spec cites its decisions as D-numbers. The brand palette, mascot, Poppins and Inter stay (D1). The skill's generic palettes are not used.

Skill rules applied throughout, with their source:

| Rule (ui-ux-pro-max) | How the app applies it |
| --- | --- |
| Touch targets: 48dp on Android, 44pt on iOS, at least 8dp apart | Every control is at least 48×48dp, with the hit area expanded when the icon is smaller. On desktop the minimum is 40dp pointer targets, and keyboard focus is always visible. |
| Text contrast at least 4.5:1, non-text at least 3:1, checked separately in dark mode | The token pairs below are computed. Light and dark are each tested. |
| Model UI state as a sealed type, not boolean flags (`jetpack-compose`, severity High) | Each screen has `Loading`, `Content`, `Empty`, `Error`, `SignedOut` and `UpdateRequired` states. |
| Event-based navigation from the ViewModel (`jetpack-compose`, High) | Navigation events go through a `Channel` and are collected once. Navigation never comes from replayed state. |
| `rememberSaveable` for UI state that must survive configuration change (High) | Drafts persist in the protected store. Scroll position and sheet state use `rememberSaveable`. |
| Bottom navigation of 5 items or fewer, predictable back, deep links | 4 destinations, system back and predictive back, and App Links only for supported destinations. |
| Reduced motion; animate 1–2 key elements per view | The system animator scale is honoured. Only opacity and transform are animated. |
| Accessible authentication with no cognitive test | Passkey only. No passwords and no OTP transcription. |
| Confirm consequential actions; confirm success | Review sheet before confirm, and a receipt after it. |
| Vector icons only, no emoji as icons | Material Symbols (rounded) plus the Whumpo mascot as a vector. |

## Information architecture

Chat comes first ([chat-first direction](../roadmap/chat-first-experience.md)). Navigation has four top-level destinations, unchanged from the shell:

| Destination | Purpose | Contents |
| --- | --- | --- |
| **Chat** (start) | Ask for changes and handle reviews | Transcript, composer, in-line review cards, admitted interactive forms (nine field types per the contract), and a typing indicator while a reply is pending |
| **Projects** | See what Whumpo runs for you | Project list with status, then project detail: versions, preview (Custom Tab) and "Ask about this project" (opens Chat with context) |
| **Activity** | What happened and what needs you | Owner operations, newest first. "Needs your review" is pinned at the top. Notification taps land here. |
| **Settings** | Infrequent account work | Account, appearance, notifications, security (opens the browser), help and support, about, sign out |

Outside the navigation: **Welcome and sign-in** (signed out), **Update required** (blocks the app on `client_update_required`), the **Review sheet** (modal), **Photo and share intake** (WH-085, entered from the share sheet or Chat), and **Help and support**, which stays reachable when signed out or when Chat fails.

Back behaviour: system back and predictive back follow the navigation stack. From a top-level destination other than Chat, back returns to Chat. From Chat, back leaves the app. A review sheet closes on back without confirming anything.

Deep links (verified App Links, only for supported destinations): `https://whumpo.com/app/activity/{eventId}`, `/app/projects/{id}` and the browser-handoff return URI. Every other path opens in the browser.

## Core journeys

Each journey lists the happy path, then its states and failures. Wording follows the brand voice (plain, warm, and no internal terms such as "uncertain" or "reserved", per direction finding 9).

### 1. Sign in with a passkey

1. **Welcome** (signed out): the mascot, "Welcome back to Whumpo." One primary action, **Sign in with passkey**. A secondary text link, **New to Whumpo? Start with an invite** (D6), and a quiet **Get help** link.
2. Tap **Sign in with passkey**. The app calls `session/login/options`, then Credential Manager `getCredential` with the passkey request. The system sheet shows the account. Biometric or screen lock gives user verification.
3. On success: `session/login/verify`, the native session is sealed in the Keystore-backed store, then `bootstrap`. If onboarding is incomplete, the app shows **Finish setting up in your browser** and opens a Custom Tab handoff. Otherwise it goes to Chat.

| Case | What the owner sees |
| --- | --- |
| The owner dismisses the system sheet | Back on Welcome with no error. The button stays enabled. |
| No Whumpo passkey on this device | "There's no Whumpo passkey on this phone." Actions: **Use a passkey from another device** (the system hybrid/QR flow) and **Sign in through the browser** (the handoff). |
| Network failure | Inline error card: "Couldn't reach Whumpo. Nothing was changed." Action: **Try again**. |
| Enrolling or recovering account (incomplete) | "Finish your account setup in the browser first." Opens the handoff. Native access is refused per the contract. |
| `client_update_required` | Full-screen **Update required**, with an **Open Play Store** action and a **Get help** link. |
| New owner | **Start with an invite** opens the browser handoff (`session/handoff/start`, PKCE S256). Signup with two passkeys and the recovery kit happens in the browser. The app exchanges the one-time code on return. |

Sensitive controls reauthenticate with the same Credential Manager call. They never ask for a password. Ordinary sessions get no recurring unlock prompts.

### 2. Chat

- Transcript on `surface-sunken`, with bubbles on `surface-raised` at `radius-md`. Owner messages align right, Whumpo's left with the small mascot avatar. Timestamps are relative ("2 min ago"), with the absolute time available to TalkBack.
- The composer is a pill (`radius-full`) that stays above the keyboard (`imePadding`; the existing `KeyboardInsetsTest` stays). The send button is 48dp, in `action` with an `on-action` icon. It is disabled with an explanation when the draft is empty.
- Pending reply: a three-dot typing indicator (opacity only, static under reduced motion) and a polite live region, "Whumpo is working on it."
- The draft is protected. It survives process death and rotation and is purged on sign-out.
- **Interrupted send** (lost response): the message shows "Didn't hear back yet." The app reads the result by request ID. If nothing was committed, the owner gets an explicit **Send again** with the same ID and payload. It never resends automatically.
- Empty conversation: the mascot, "What can I help with today?", and 3 starter prompts that fill the draft without sending it.

### 3. Review and confirm a change

1. A review card appears in Chat (and in Activity under "Needs your review"). It shows the project, what will change and a status badge. Actions follow D8: **Review change** is primary, **Open preview** is secondary.
2. **Review change** opens the Review sheet: a modal bottom sheet on compact widths, a side sheet on expanded widths. It lists the exact project, artifact and version, the proposed effect in plain words, the required disclosures, and when the review expires.
3. The consequential action is the only primary button at the bottom: **Publish website**, **Save private website**, **Turn on app** or **Restore app data**, named by the control. These are the four frozen controls. **Not now** is quiet.
4. Tap the primary action. If the last passkey proof is older than the freshness window, Credential Manager reauthenticates first. The button then shows progress and ignores repeat taps. The request carries its idempotency key.
5. Result: a receipt replaces the sheet content: "Published. Your site is live." It uses the `ready` colours, a Confirm haptic and a live-region announcement. On failure: the `attention` colours, what happened, what is safe ("Nothing was published"), and **Try again** with the same request.

| Case | Behaviour |
| --- | --- |
| Stale, expired, withdrawn or foreign review | The sheet refreshes the state and shows "This review is no longer current" with no enabled confirm. |
| Unknown control type | The card shows **Update required**. There is no approval and no browser downgrade (contract rule). |
| Notification or model text says "approve" | It has no effect. Only server-issued review metadata enables the button. |

### 4. Projects and sites

- List: one card per project, with the name, a status badge (icon plus word plus colour, never colour alone) and "Updated 5 min ago". It uses skeleton cards while loading.
- Detail: status, current version, a version list and **Open preview**, which opens an authenticated Custom Tab. Generated HTML never renders in the app. **Ask about this project** opens Chat with the project attached as context.
- Expanded widths use a list-detail layout (`ListDetailPaneScaffold`): the list on the left and the detail on the right, with selection kept on rotation and fold.

### 5. Notifications

- **Permission in context, never at launch.** After the owner's first successful request, an in-app card asks: "Want a heads-up when this is done?" with **Turn on** and **Not now**. **Turn on** triggers `POST_NOTIFICATIONS` on Android 13+. Push is opt-in in-app by default (contract decision 6).
- Channels, each switchable in Settings and the system: **Needs your review** (high importance), **Work finished** (default), **Something went wrong** (default).
- Lock-screen copy is generic and private: "Whumpo: a change is ready for your review." It never contains project names, message text or photos. Notifications are set to `VISIBILITY_PRIVATE` with a public version.
- A tap opens Activity at the event. The app fetches current server state. A deleted or foreign event shows "This item isn't available anymore."
- Denied permission: Activity and Chat work fully. Settings shows the state with **Open system settings**.

### 6. Settings and security

| Row | Behaviour |
| --- | --- |
| Account | Name and email from `session`. Read-only. |
| Appearance | Theme: **System** (default), Light, Dark. Dynamic colour is not offered (see the colour policy). |
| Notifications | The three channels, plus the system permission state. |
| Security | **Passkeys and recovery kit** opens the browser (adding and removing passkeys is a browser journey). **Signed-in devices** opens the browser. |
| Help and support | Opens the browser support page. Also reachable from Welcome and Update required. |
| About | App version, build and API version, which support can use. |
| Sign out | A confirmation dialog: "Sign out of Whumpo on this phone? Unsent drafts will be removed." It calls `session/logout`, erases all protected state and deletes the key (existing shell behaviour). |

## Theming: Material 3 from Whumpo tokens

Source: [`tokens.json`](../design/whumpo-design-system/tokens.json). Three layers, per the design-system skill:

1. **Primitive:** the six brand colours (Sky Blue `#60b5ff`, Deep Sky `#0f2d5b`, Cloud Coral `#ff7b7b`, Sunshine `#ffd56b`, Mint `#a7e3c1`, Cloud White `#f8fafc`).
2. **Semantic:** the tokens.json themed tokens (`surface*`, `ink*`, `action*`, `link`, `*-soft`, `*-ink`, `line*`, `focus-ring`).
3. **Component:** Material 3 `ColorScheme` roles plus a small `WhumpoColors` extension for roles M3 lacks.

The Kotlin token file is **generated** from tokens.json by `tools/design-tokens.mjs` (extended in WP2, with `--check` in CI). Nobody edits hex in Kotlin (D2).

**Key mapping decision:** M3 uses `primary` as a *text* colour (text buttons, focused field labels, links). Sky Blue as text on light surfaces is 2.20:1 and fails contrast. Therefore **`primary` = `link`**, which passes as text, and the brand Sky Blue fill is **`primaryContainer`**, carrying Deep Sky text (6.17:1). Whumpo's primary button uses `primaryContainer` colours. That matches the brand rule "Sky Blue fill, Deep Sky text, never white on Sky Blue".

| M3 role | Light | Dark | Contrast check |
| --- | --- | --- | --- |
| `primary` | `link` #1a66c2 | `link` #8ccbff | 5.39:1 on surface (L), 10.19:1 (D) |
| `onPrimary` | #ffffff | `deep-sky` #0f2d5b | 5.64:1 (L), 7.82:1 (D) |
| `primaryContainer` (brand action fill) | `action` #60b5ff | `action` #60b5ff | — |
| `onPrimaryContainer` | `on-action` #0f2d5b | `on-action` #0f2d5b | 6.17:1 |
| `secondary` | `deep-sky` #0f2d5b | `ink` #f1f6fd | — |
| `onSecondary` | `cloud-white` #f8fafc | `deep-sky` #0f2d5b | — |
| `secondaryContainer` (nav indicator, chips) | `action-soft` #e3f1ff | `action-soft` #17355f | ink on it: 11.83:1 (L), 11.30:1 (D) |
| `onSecondaryContainer` | `ink` | `ink` | — |
| `tertiaryContainer` / `onTertiaryContainer` | `spark-soft` / `spark-ink` | same tokens | 6.31:1 (L) |
| `error` / `onError` | `attention-ink` #b02a35 / #ffffff | `attention-ink` #ffa3a3 / `deep-sky` | 6.50:1 (L), 7.12:1 (D) |
| `errorContainer` / `onErrorContainer` | `attention-soft` / `attention-ink` | same tokens | 5.60:1 (L), 7.84:1 (D) |
| `background`, `surface` | `surface` #f8fafc | `surface` #0b1830 | — |
| `onSurface`, `onBackground` | `ink` | `ink` | — |
| `onSurfaceVariant` | `ink-muted` | `ink-muted` | 5.60:1 on sunken (L), 8.04:1 on raised (D) |
| `surfaceContainerLowest` / `Low` | `surface-raised` | `surface-raised` | — |
| `surfaceContainer` / `High` | `surface-sunken` | `surface-sunken` | — |
| `outline` (control edges) | `line-strong` #738aaa | `line-strong` #5f7aa0 | 3.53:1 (L), 4.02:1 (D) |
| `outlineVariant` (decorative) | `line` | `line` | decorative only |
| `inverseSurface` / `inverseOnSurface` | `surface-inverse` / `ink-inverse` | same tokens | — |
| `inversePrimary` | `link` dark value | `link` light value | — |

`WhumpoColors` (a `CompositionLocal`) carries the roles M3 lacks: `readySoft`/`readyInk` (6.03:1 L), `sparkSoft`/`sparkInk`, `focusRing`, and the fixed brand six for illustration.

**Shapes** come from the radius tokens: `extraSmall` 8dp (`radius-sm`), `small` and `medium` 12dp (`radius-md`), `large` 20dp (`radius-lg`), `extraLarge` 28dp (`radius-xl`). Buttons, chips, the composer and badges use full pills (`radius-full`), which is the M3 Expressive default for buttons. **Elevation:** use tonal surfaces first. The cloud-light shadows (`shadow-sm/md/lg`) appear only on the composer, cards and sheets. **Spacing:** 4dp base, taken from `space-1…12`.

**Component states** (design-system skill pattern):

| Whumpo button | Default | Pressed | Focused | Disabled |
| --- | --- | --- | --- | --- |
| Primary | `primaryContainer` fill, `onPrimaryContainer` text | `action-hover` fill | 2dp `focus-ring` outline with a 2dp offset | `surface-sunken` fill, `ink-muted` text, not 38% opacity (direction WP1) |
| Secondary | `outline` border, `primary` text | `secondaryContainer` fill | the same focus ring | `line` border, `ink-muted` text |
| Quiet | `primary` text only | `secondaryContainer` fill | the same focus ring | `ink-muted` text |

There is **one primary per view** (D8). Destructive confirms (sign out) use `error` text in the dialog.

### Material 3 Expressive

Adopt the Expressive **shape and type emphasis** now through tokens: pill buttons, larger headline contrast, rounded cards. Adopt the Expressive **components** (ButtonGroup, FloatingToolbar, flexible top app bar, LoadingIndicator) only once Material 3 1.5.0 is stable in both androidx and Compose Multiplatform. As of October 21, 2026 it is in beta ([release notes](https://developer.android.com/jetpack/androidx/releases/compose-material3)). Use the **standard motion scheme** and not the expressive spring scheme on billing, security, error and review screens (the brand rule: nothing bounces there).

## Typography

Fonts: Poppins (500, 700) and Inter (400, 500, 600), bundled as TTF under the SIL OFL. The design-system folder ships only `.woff2`, which Android font resources do not load, so WP2 adds TTF sources with their licence. Poppins is limited to display and page titles (D3).

| M3 role | Token | Font | Size / line (sp) | Weight | Use |
| --- | --- | --- | --- | --- | --- |
| `displayMedium` | display | Poppins | 40 / 48 | 700 | Welcome screen only |
| `headlineMedium` | title | Poppins | 28 / 36 | 700 | Top-level screen titles |
| `titleLarge` | wordmark | Poppins | 24 / 28 | 700 | The wordmark in the top bar |
| `titleMedium` | heading | Inter | 18 / 26 | 600 | Card, sheet and section headings |
| `bodyLarge` | body | Inter | 16 / 24 | 400 | Chat messages and long copy |
| `bodyMedium` | body-sm | Inter | 14 / 20 | 400 | Secondary copy and tile text |
| `labelLarge` | label | Inter | 14 / 20 | 500 | Buttons, tabs and inputs |
| `labelMedium` / `labelSmall` | caption | Inter | 12 / 16 | 500 | Badges, timestamps and metadata |
| (overline style) | overline | Inter | 12 / 16 | 600, uppercase | Section labels, used sparingly |

All sizes are in `sp`, so text follows the system font scale. Nothing is smaller than 12sp. Layouts must hold at 200% font scale with no clipped text (the existing `LargeTextTest` is extended to every screen).

## Motion

| Token | Duration | Easing | Use |
| --- | --- | --- | --- |
| `motion-fast` | 150 ms | standard | State changes, pressed states, badge updates |
| `motion-base` | 250 ms | enter (decelerate) / exit (accelerate) | Sheets, list item insert, chat bubble arrival |
| `motion-slow` | 400 ms | standard | Destination change (fade-through), the receipt reveal |

These durations come from direction D2 and are added to tokens.json by the web WP1. The Kotlin generator reads the same values. Only opacity and transform (translate and scale) are animated. Layout size is never animated. Exits are faster than enters. Predictive back uses the system animations.

**Reduced motion.** Compose honours the system animator duration scale. When "Remove animations" is on (scale 0), transitions become instant cuts, the typing indicator becomes static text ("Working on it…") and the skeleton shimmer becomes a static tint. CI already runs emulators with animations disabled, so tests cover that path.

## Haptics

Haptics are sparse and meaningful. They use `HapticFeedbackType` from Compose, which respects the system haptics setting.

| Moment | Haptic |
| --- | --- |
| Review confirmed (receipt received) | `Confirm` |
| Review or send failed | `Reject` |
| Toggling a notification channel or theme option | `ToggleOn` / `ToggleOff` |
| Long-press on a message (copy menu) | `LongPress` |

There is no haptic on send, on navigation or on scroll, and haptics are never the only signal.

## Dark mode and dynamic colour policy

- Dark mode follows the system by default, with an in-app override (System, Light, Dark). Both themes come from tokens.json. Dark contrast is verified independently (pro-rules checklist).
- **Dynamic colour (Material You) is off.** Whumpo is a trust product. The brand colours carry meaning (Sky Blue for action, Mint for ready, Coral for attention), and dynamic palettes would break the tested contrast pairs. Rejected alternative: dynamic colour on Android 12+. It was rejected because it would make review and status colours device-dependent and untested.
- The system contrast setting (Android 14+) is honoured by bumping `ink-muted` to `ink` and `line` to `line-strong` when the user requests more contrast. This is cheap to do because the tokens already exist.
- The status and navigation bars are edge-to-edge (required at target API 35+), and the app draws inside window insets.

## Accessibility targets

Target: WCAG 2.2 AA equivalents plus the Android accessibility guidance. Each item has a check.

| Target | Check |
| --- | --- |
| Every interactive element is at least 48×48dp, at least 8dp apart | Compose UI tests with `enableAccessibilityChecks()` (Accessibility Test Framework); lint |
| Text at least 4.5:1, non-text at least 3:1 in light and dark | Generated token check (asserted in `tools/design-tokens.mjs` for every pair in this spec); ATF contrast checks |
| Every icon-only control has a content description; decorative images have `null` | ATF; a test that walks the semantics tree |
| Screen titles are `heading()`; tabs expose selected state | Existing `NavigationTest`, extended |
| Chat replies, receipts and errors are announced politely through a live region | Compose UI test asserts `LiveRegionMode.Polite` |
| Status is never colour alone (icon plus word plus colour) | Screenshot review plus a semantics test on the badge |
| 200% font scale with no clipping or overlap | `LargeTextTest` on every screen; screenshots at fontScale 2.0 |
| Keyboard and Switch Access: a logical focus order, a visible focus ring, Enter activates, and Ctrl/Cmd+Enter sends in Chat | Compose UI key-event tests; manual on a tablet with a keyboard |
| TalkBack reads each journey end to end | Manual on physical Pixel and Samsung devices (WH-087 evidence); not claimable from emulators |
| No time limits on reading a review; expiry is shown as text | Review sheet test |
| Reduced motion respected | Emulator runs with animations disabled |
| Desktop: VoiceOver on macOS (CMP supports it); the `jdk.accessibility` module is packaged | WP8 manual check with Accessibility Inspector |

## Empty, loading and error states

| State | Design | Copy pattern |
| --- | --- | --- |
| Loading (layout known) | A skeleton of the real layout, with a 1.2 s opacity shimmer that is static under reduced motion. Never a lone spinner. | None (TalkBack hears "Loading projects") |
| Loading (action in progress) | Progress inside the button that was pressed; repeat taps ignored | "Publishing…" |
| Empty | The mascot (vector), one sentence and one action | Projects: "No projects yet. Tell Whumpo what you need." Action: **Go to Chat** |
| Error (recoverable) | An `errorContainer` card with an icon: what happened, what is safe, and **Try again** | "Couldn't load your projects. Nothing was changed." |
| Offline | A slim banner above the content. Content already shown stays visible but read-only. Sending is disabled with an explanation. | "You're offline. We'll be ready when you're back." |
| Not available or forbidden | A neutral card that says who can help | "This isn't available to your account." Action: **Get help** |
| Session expired or revoked | Return to Welcome with a reason; drafts are purged per policy | "You've been signed out. Sign in again to continue." |
| Update required | A full screen with the mascot and the Play Store action; help stays reachable | "This version of Whumpo is out of date." |

## Adaptive layouts: phones, tablets, foldables and the desktop baseline

Window size classes (Material 3 adaptive) drive the layout. The same composables serve the desktop target, so **the expanded layout is the desktop baseline**.

| Width class | Navigation | Chat | Projects | Review |
| --- | --- | --- | --- | --- |
| Compact (< 600dp, phones) | Bottom navigation bar (4) | Full width | List, then detail on a new screen | Modal bottom sheet |
| Medium (600–839dp: foldables open, small tablets, portrait) | Navigation rail | Transcript with a max width of 720dp, centred | List-detail with a single pane and an animated swap | Modal bottom sheet, max width 640dp |
| Expanded (≥ 840dp: tablets, desktop windows) | Navigation rail, or a permanent drawer at ≥ 1200dp | Transcript plus a context pane (the active project and pending reviews) | Two panes, list and detail | Side sheet; the transcript stays visible |

- `NavigationSuiteScaffold` switches between bar, rail and drawer automatically.
- **Foldables:** respect the hinge. Panes never straddle a separating fold (`WindowInfoTracker` / adaptive pane scaffold). In tabletop posture the review sheet sits on the lower half, with the summary on the upper half.
- **Rotation and resize** keep the selection, scroll position and draft. Multi-window and freeform windows are supported down to 360×480dp.
- **Desktop baseline** (WP8): pointer hover states, right-click context menu on messages, keyboard shortcuts (Ctrl/Cmd+Enter to send, Ctrl/Cmd+1–4 for destinations, Esc to close a sheet), a resizable window with a minimum of 480×600dp, and a native menu bar on macOS.

## Implementation plan

Eight packages for Sonnet agents, one PR each, in order. Packages 4–7 can run in parallel once 1–3 have landed. Everything is Android-only until WP8.

**Gate for every package:** the CI `build` job passes (`assembleLocalDebug assembleDeployedDebug`, lint for both flavours, `:shared` and app unit tests), the `instrumented` job passes on API 28 and 36, Roborazzi screenshots are recorded and reviewed in light, dark and fontScale 2.0, `git diff --check` is clean, and no network call goes to anything but the configured environment. No secrets, signing material or Play actions are involved.

| # | Package | Files | Acceptance tests | Depends on |
| --- | --- | --- | --- | --- |
| 1 | **KMP restructure.** Convert `:core` into `:shared` (`commonMain`, `androidMain`, `jvmMain` stub). Move `:app` to `:androidApp`. Add the CMP and kotlinx-serialization plugins. Move the shell's ViewModels to multiplatform `lifecycle-viewmodel`. | `android/settings.gradle.kts`, `android/build.gradle.kts`, `android/gradle/libs.versions.toml`, `android/shared/**`, `android/androidApp/**` (moved from `app/`, `core/`), `.github/workflows/android.yml`, `docs/android-build.md` | All 19 existing core tests and the app unit and instrumentation tests pass after the move. `:shared:jvmTest` runs in CI. `assembleDebug` passes for both flavours. Lint is clean. The wrapper is still validated. | — |
| 2 | **Theme and tokens.** Extend `tools/design-tokens.mjs` to emit `WhumpoTokens.kt` (colours, type, shapes, spacing, motion) with `--check`. Add `WhumpoTheme` with the mapping above, `WhumpoColors`, bundled Poppins and Inter TTF with the OFL text, and the three button styles. | `tools/design-tokens.mjs`, `android/shared/src/commonMain/kotlin/.../theme/**`, `android/shared/src/commonMain/composeResources/font/**`, `tests/` (generator check) | `node tools/design-tokens.mjs --check` passes. An assert-based contrast check covers every pair in the mapping table (all ≥ the stated threshold). Roborazzi snapshots of the button states and type scale in light and dark. A unit test proves `primary` is never Sky Blue in the light theme. | 1 |
| 3 | **Adaptive shell and state components.** `NavigationSuiteScaffold`, window-size-class layouts, predictive back, the sealed `UiState`, and the `Skeleton`, `EmptyState`, `ErrorCard`, `OfflineBanner` and `UpdateRequiredScreen` components. | `android/shared/src/commonMain/kotlin/.../ui/{app,common}/**`, `android/androidApp/src/main/**` (activity, manifest edge-to-edge), tests | Compose UI tests at 360, 700 and 1000dp widths assert bar, rail and two-pane. `enableAccessibilityChecks()` passes on every screen. Rotation keeps the selection. Screenshots of all state components. Reduced-motion snapshots. | 1, 2 |
| 4 | **API client and session store.** A Ktor client for `/api/mobile/v1` with kotlinx DTOs generated by hand from the frozen fixtures, strict unknown-field rejection, `client_update_required` handling, idempotency keys and the sealed session in `SecureStore`. | `android/shared/src/commonMain/kotlin/.../api/**`, `android/shared/src/androidMain/kotlin/.../security/**`, `android/shared/src/commonTest/**` | Contract tests decode every file in `tests/fixtures/mobile-v1/` and reject every case in `rejections.json`. A `MockEngine` test covers errors, pagination, revision and the stale-client path. There is no live server (the routes are WH-083). | 1 |
| 5 | **Passkey sign-in and browser handoff (client side of WH-083).** The Welcome screen, Credential Manager `PasskeyAuthenticator`, reauthentication, the PKCE handoff through Custom Tabs, the App Links intent filter with `autoVerify`, and a staged `assetlinks.json` template (not deployed). | `android/shared/src/{commonMain,androidMain}/kotlin/.../auth/**`, `android/androidApp/src/main/AndroidManifest.xml`, `docs/android/assetlinks.template.json`, tests | Unit tests use a fake authenticator for success, cancel, no-credential, network failure, incomplete-account and update-required. A PKCE verifier and state test. Compose UI tests of each Welcome state. Real passkeys are a physical-device check in WH-087. | 3, 4 |
| 6 | **Chat and review (client side of WH-084).** Transcript, composer, protected drafts, the typing indicator, interrupted-send recovery, the review card and sheet with the four controls, the receipt, haptics and live regions. | `android/shared/src/commonMain/kotlin/.../ui/chat/**`, `.../ui/review/**`, `.../domain/chat/**`, tests | ViewModel tests: duplicate tap sends once, a lost response reads back by ID, a stale review disables confirm, an unknown control shows update-required, sign-out purges drafts. Compose UI tests for live-region announcements and focus order. Screenshots of the review sheet in compact and expanded layouts. | 3, 4 |
| 7 | **Projects, Activity, Settings and notifications client (client side of WH-084/086).** List-detail Projects, Custom Tab preview, Activity with "Needs your review", Settings rows, in-context `POST_NOTIFICATIONS`, the three channels, a `PushRegistrar` (FCM) behind an interface, and deep links to `/app/activity/{id}`. | `android/shared/src/commonMain/kotlin/.../ui/{projects,activity,settings}/**`, `android/shared/src/androidMain/kotlin/.../push/**`, `android/androidApp/src/main/**`, tests | Tests: permission denied keeps Activity usable, a notification tap fetches current state, a deleted event shows the unavailable state, sign-out unregisters the token (fake registrar). The FCM dependency compiles but has no `google-services.json` in the repo (that is an owner task). Screenshots at 3 widths. | 3, 4, 6 |
| 8 | **Desktop (macOS) baseline, gated after WH-087.** A `:desktopApp` running `:shared` with a browser-handoff sign-in, Keychain or JVM secure storage, keyboard shortcuts and the menu bar. Builds an unsigned DMG locally. | `android/desktopApp/**`, `android/shared/src/jvmMain/**`, `.github/workflows/android.yml` (Linux compile only) | `:desktopApp:compileKotlinJvm` and `:shared:jvmTest` pass on Linux CI. Desktop screenshot tests at 1280×800. Manual VoiceOver check on a Mac. No signing or notarization (owner task). | 1–7, WH-087 |

Photo and share intake (WH-085) follows WP6 as its own package under the existing [photo contract](../photos.md). It is not re-specified here.

## Pre-delivery checklist (per screen, from ui-ux-pro-max pro-rules)

- [ ] Vector icons only, with consistent rounded Material Symbols and no emoji.
- [ ] Touch targets of at least 48dp and no content hidden under system bars or the IME.
- [ ] Light and dark contrast checked independently. Pressed, focused and disabled states are distinguishable in both.
- [ ] One primary action per view. Destructive actions are confirmed. Success is confirmed.
- [ ] The loading, empty, error, offline and update-required states exist and are screenshotted.
- [ ] TalkBack labels, headings, live regions and focus order are covered by tests.
- [ ] 200% font scale and the reduced-motion path are screenshotted.
- [ ] Compact, medium and expanded layouts are screenshotted.
