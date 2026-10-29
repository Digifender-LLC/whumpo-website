# ADR: Android app platform and the Mac path

**WH-081/WH-082 — October 29, 2026 (UTC). Engineering decision by the mobile and app lead. Docs only: no app code, build change, Play Console action, signing identity, deployment or secret is part of this decision.** Source base: `origin/main` at the time of the PR. The frozen [native API contract](mobile-api-v1.md) and the [Android owner app contract](android-app.md) stay authoritative for behaviour. This ADR decides only the client platform, the module shape and the path to macOS. The UX is specified in [android/app-ux.md](android/app-ux.md).

## Decision

**Build the Whumpo owner app with Kotlin Multiplatform (KMP) and Compose Multiplatform (CMP), shipping Android first.** On Android, CMP *is* Jetpack Compose with Material 3, so the Android app gets the full native platform: Credential Manager passkeys, FCM, TalkBack, Android Keystore, Custom Tabs, photo picker and adaptive layouts. Shared code (domain models, the `/api/mobile/v1` client, ViewModels and most screens) lives in `commonMain`. Platform services stay behind small interfaces in `androidMain` (and later `jvmMain` for desktop and `iosMain`).

**The Mac path is a CMP Desktop (JVM) target for macOS**, built from the same shared UI once the Android private beta (WH-087) is accepted. Mac sign-in uses the browser handoff that the v1 contract already freezes (`session/handoff/start` and `exchange`, PKCE S256), so the user signs in with their passkey in Safari or Chrome and the app exchanges a one-time code. A native AuthenticationServices passkey bridge is a later enhancement, not a requirement. Until then, the installed PWA ([WH-119](dashboard-pwa.md)) remains the Mac answer.

**The existing `android/` shell is restructured, not kept as-is.** Its module layout is Android-only. WP1 of the [implementation plan](#implementation-plan) moves it into a KMP layout (`:shared` with `commonMain`/`androidMain`/`jvmMain`, plus `:androidApp`). Parts that pass review on their merits move with it: the Keystore-sealed `AccountStateStore`, backup exclusions, the environment guard and their tests. Anything that conflicts with the UX spec (for example the current light theme, which puts white text on a darker non-brand blue) is replaced.

## Owner direction (2026-10-29)

The owner has a Google Play developer account and asked for an Android app, choosing between native Android and a platform that can later reach desktop macOS. On 2026-10-29 the owner also directed that **reuse of existing code is not a criterion**: neither the Android shell nor the React/TypeScript frontend counts in the score, and replacing all existing code is acceptable if it gives a better app. The platform is chosen on the quality of the result alone: native feel, accessibility, passkeys, push, the Mac path, iOS later, performance, maintainability and Play policy. The scoring below follows that direction.

## Verified facts (checked 2026-10-29)

| Fact | Source |
| --- | --- |
| Compose Multiplatform stability: **iOS Stable, Desktop (JVM) Stable**, Web Beta. | [Kotlin docs, supported platforms](https://kotlinlang.org/docs/multiplatform/supported-platforms.html); [CMP 1.8.0 iOS stable announcement](https://blog.jetbrains.com/kotlin/2025/05/compose-multiplatform-1-8-0-released-compose-multiplatform-for-ios-is-stable-and-production-ready/) |
| Latest CMP stable **1.12.2** (October 15); prerelease 1.13.0-beta01 (October 23). | [JetBrains/compose-multiplatform releases](https://github.com/JetBrains/compose-multiplatform/releases) |
| CMP desktop accessibility: **macOS fully supported**, Windows via Java Access Bridge, Linux not supported. Native distributions must include the `jdk.accessibility` module. | [CMP desktop accessibility](https://kotlinlang.org/docs/multiplatform/compose-desktop-accessibility.html) |
| Credential Manager passkeys work on **Android 9 (API 28)** and higher. | [Android passkeys](https://developer.android.com/identity/passkeys) |
| Credential Manager needs Digital Asset Links at `https://<domain>/.well-known/assetlinks.json` with `delegate_permission/common.get_login_creds` (plus `handle_all_urls` for App Links), served as HTTP 200 `application/json` with no redirect. | [Credential Manager prerequisites](https://developer.android.com/identity/credential-manager/prerequisites) |
| Apple platform passkeys use `ASAuthorizationPlatformPublicKeyCredentialProvider` (macOS 12+, iOS 15+, Mac Catalyst 15+). Native apps need the `webcredentials:` Associated Domains entitlement and an `apple-app-site-association` file. There is no Kotlin/JVM passkey API on desktop. | [Apple API metadata](https://developer.apple.com/documentation/authenticationservices/asauthorizationplatformpublickeycredentialprovider) |
| Play target API: since **August 31, 2026**, new apps and updates must target **Android 16 (API 36)**. The shell already targets 36. | [Play target API requirement](https://developer.android.com/google/play/requirements/target-sdk); [Play Console help](https://support.google.com/googleplay/android-developer/answer/11926878) |
| New **personal** developer accounts created after November 13, 2023 need a closed test with **at least 12 testers opted in continuously for 14 days** before applying for production access. Internal testing is not subject to it. | [Play Console help: testing requirements](https://support.google.com/googleplay/android-developer/answer/14151465) |
| Android developer verification: Play-distributed apps are registered automatically through the Play Console. Enforcement starts September 30, 2026 in Brazil, Indonesia, Singapore and Thailand, and goes global in 2027. | [Android developer verification](https://developer.android.com/developer-verification/guides) |
| Material 3 for Compose: stable **1.4.0**; **1.5.0-beta02** (October 21, 2026) carries the graduated Expressive components (ButtonGroup, FloatingToolbar, flexible app bars, SplitButton). | [Compose Material 3 releases](https://developer.android.com/jetpack/androidx/releases/compose-material3) |
| FCM is a no-cost Firebase product. `POST_NOTIFICATIONS` is a runtime permission from Android 13 (API 33). | [Firebase pricing](https://firebase.google.com/pricing); [notification permission](https://developer.android.com/develop/ui/views/notifications/notification-permission) |
| GitHub-hosted standard runners are free for public repositories. Private repositories consume included minutes, and macOS minutes cost about 10x Linux ($0.062 vs $0.006 per minute). | [GitHub Actions billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions) |
| Flutter has no first-party passkey plugin. The community `passkeys` package bridges to Credential Manager and AuthenticationServices. | [pub.dev `passkeys`](https://pub.dev/packages/passkeys) |
| `react-native-macos` (Microsoft) tracks upstream React Native with a lag. The newest line found was 0.81.x in mid-2026. Expo does not target macOS. | [npm advisory listing](https://security.snyk.io/package/npm/react-native-macos) |

Not verified: Apple's prose page on passkeys did not render outside a browser, so the Associated Domains detail is from Apple's API metadata and standard practice. Whether the owner's Play account is **personal or organization**, and its creation date, is unknown. That decides whether the 12-tester rule applies (see [owner tasks](#owner-tasks)).

## Options and scoring

Scores run from 1 (poor) to 5 (best). Code reuse is excluded per the owner direction. "Android" means quality on Android. The Mac and iOS columns score the realistic path.

| Criterion | 1. Native Kotlin + Jetpack Compose | 2. KMP + Compose Multiplatform | 3. Flutter | 4. React Native / Expo + react-native-macos | 5. Capacitor or Tauri wrapper |
| --- | --- | --- | --- | --- | --- |
| Passkeys (Android, then Mac) | 5 (Credential Manager directly) | 5 Android; Mac via browser handoff now, native bridge later | 3 (community plugin over the same APIs) | 3 (community modules) | 2 (WebView WebAuthn support varies; relies on the browser engine) |
| Push | 5 (FCM directly) | 5 Android (FCM in `androidMain`); Mac needs APNs later | 4 (official `firebase_messaging`) | 4 | 3 (plugin) |
| Native feel and accessibility (TalkBack, VoiceOver) | 5 | 5 Android (it is Jetpack Compose); 4 Mac (JVM window chrome, VoiceOver supported) | 3 (draws its own widgets; semantics tree is good but not native Material) | 4 (native views, but no Material 3 Expressive) | 2 (a web page in a frame) |
| Mac path quality | 1 (none) | 4 (CMP Desktop stable, a11y on macOS supported) | 4 (macOS desktop stable) | 2 (fork lags upstream; no Expo) | 3 (Tauri desktop is good; mobile less mature) |
| iOS later | 1 (rewrite) | 4 (CMP iOS stable; SwiftUI/UIKit interop for platform screens) | 4 | 5 | 3 |
| Performance | 5 | 5 Android; JVM start-up cost on desktop | 4 | 4 | 2 |
| Team leverage (agents write, owner reviews) | 4 (one language, best-documented Android path) | 4 (same Kotlin; more Gradle complexity) | 3 (Dart, separate toolchain) | 4 (TypeScript, but native-module debugging is costly) | 4 |
| Play policy | 5 | 5 | 5 | 5 | 3 (thin wrappers risk Minimum Functionality review) |
| Build and CI cost | 5 (Linux only) | 4 (Linux for Android and desktop compile; macOS runners only to sign and package Mac builds) | 4 | 3 (iOS/macOS builds need macOS runners) | 4 |
| Maintenance | 4 | 4 (two plugin ecosystems, Android-first keeps it small) | 3 (plugin drift on passkeys) | 2 (RN upgrades plus the macOS fork) | 3 |
| **Total (of 50)** | **40** | **45** | **37** | **36** | **29** |

### Why option 2

- **Android quality is identical to option 1.** CMP's Android target uses the androidx Compose runtime and Material 3, so the score difference comes only from the Mac and iOS columns. Android users give up nothing.
- **Passkeys and push stay first-party on Android.** Credential Manager, FCM, Keystore and Custom Tabs are called directly from `androidMain`. No community bridge sits between Whumpo and its only sign-in method.
- **The Mac path is real, not a rewrite.** CMP Desktop is stable and supports macOS accessibility. The v1 contract's browser handoff already covers sign-in where no native passkey API exists. iOS is also stable in CMP, so "iOS later" reuses the same shared module.
- **Agents stay in one language.** Kotlin everywhere, with Material 3 semantics the UX spec relies on.

### Rejected options

- **1. Native Kotlin + Jetpack Compose only.** It gives the same Android result but closes the Mac and iOS doors. Moving to KMP later means re-splitting modules after screens exist. Option 2 costs one restructuring package now (WP1) and avoids that.
- **3. Flutter.** Good desktop support, but its Material widgets are re-implementations, its passkey support is community-maintained, and it adds Dart as a third language. Passkeys are Whumpo's only sign-in method, so that dependency risk is not acceptable.
- **4. React Native or Expo with react-native-macos.** Strong for iOS, weak for macOS (a fork that lags upstream, and Expo has no macOS target). Passkeys need community native modules. Upgrade maintenance is the highest of the options.
- **5. Capacitor or Tauri wrapper around the PWA.** It is the weakest native feel and accessibility, it carries Play Minimum Functionality risk, and it adds little over the installable PWA that already exists. The PWA itself stays the zero-cost web and Mac answer today.

## Consequences

- **Module layout (WP1):** `android/` becomes a KMP Gradle build with `:shared` (`commonMain`, `androidMain`, `jvmMain`) and `:androidApp`. `:desktopApp` arrives only in the Mac package (WP8). There is no iOS target until iOS is scoped.
- **Libraries:** Compose Multiplatform 1.12.x (stable), androidx Lifecycle/ViewModel and Navigation in their multiplatform artifacts, Ktor client and kotlinx.serialization for `/api/mobile/v1`. Material 3 starts on the stable line. Expressive components are adopted when the 1.5.0 line is stable in both androidx and CMP. Until then the expressive look comes from Whumpo shape, type and motion tokens on stable components.
- **Platform services behind interfaces:** `PasskeyAuthenticator`, `PushRegistrar`, `SecureStore`, `BrowserHandoff`, `Haptics`. Each has an `androidMain` implementation, and fakes in `commonTest`.
- **Tests:** JVM unit tests in `commonTest`/`androidUnitTest`, Compose UI tests with accessibility checks, and JVM screenshot tests (Roborazzi on Robolectric, so CI needs no emulator). The existing emulator job stays for instrumentation.
- **CI cost:** all Android work runs on `ubuntu-latest`. No macOS runner is needed until Mac packaging. Spending on macOS minutes or signing is the owner's call.
- **Policy stays as frozen:** current-version-only clients, `client_update_required`, no approval from notifications or models, and browser ownership of signup, recovery and passkey management ([android-app.md](android-app.md)).
- **Risk:** CMP's Material 3 artifacts trail androidx by weeks. Mitigation: Android-only UI can depend on androidx Material 3 directly from `androidMain` when a needed API is missing in common.
- **Risk:** the build gets more complex (KMP plus AGP). Mitigation: pin versions in the catalog as WH-082 already does, and keep one build check per target in CI.

## Mac path

1. **Now:** the installed PWA (WH-119) on macOS Safari (Add to Dock) or Chrome. Passkeys, Chat and reviews already work there.
2. **After WH-087 (gated, WP8):** a `:desktopApp` CMP target that reuses `:shared`. Sign-in uses the frozen browser handoff (system browser passkey, then a PKCE code exchange through a custom URL scheme or loopback redirect, chosen by contract amendment). Secrets go in the macOS Keychain. There is no push at first; Activity refreshes while the app is open. Packaged as a DMG with `nativeDistributions` including `jdk.accessibility`.
3. **Mac release (owner gate):** signing and notarization need an Apple Developer Program membership (a recurring fee, the owner's call) and a macOS runner or a local Mac. Native passkeys (an AuthenticationServices helper with the `webcredentials:whumpo.com` entitlement) and APNs push come after that, only if beta evidence asks for them.
4. **Alternative if iOS ships first:** a CMP iOS app can run on Apple-silicon Macs. It gets native passkeys and VoiceOver, but an iPad-shaped UI. Choose between this and step 2 when iOS is scoped.

## Implementation plan

The work packages, their order, file sets and acceptance tests are in [android/app-ux.md § Implementation plan](android/app-ux.md#implementation-plan). Each package is sized for one Sonnet agent and lands as its own PR.

## Owner tasks

Agents do not perform these. Each needs the owner (money, accounts or production).

1. **Answered 2026-10-29 (Q-006): the Play account is personal and was created after November 13, 2023, so the 12-tester, 14-day closed-test rule applies before production. It may become an organization account later.** Original question: confirm the Play account type and creation date. A personal account created after November 13, 2023 must run a 12-tester, 14-day closed test before production. An organization account avoids that rule but needs organization verification. This does not block the internal-testing beta (WH-087).
2. **Answered 2026-10-29 (Q-005): the package name is `com.whumpo.android`, now final.** It is permanent once uploaded.
3. **Enrol in Play App Signing** at the first upload, keep custody of the upload key, and share the app-signing certificate SHA-256. It feeds `assetlinks.json` and the server's approved-origin list (WH-083).
4. **Approve publishing `/.well-known/assetlinks.json` on production `whumpo.com`** with `get_login_creds` and `handle_all_urls` for the release signing identity only. Agents prepare the file and the route. The owner approves the production deploy.
5. **Create the Firebase project for FCM** (no cost) and approve the server credential's custody (WH-086).
6. **Store listing and app content:** privacy policy URL, Data safety form, content rating, target audience, and **App access instructions for Play review**. The app is passkey-only, so reviewers need a disposable reviewed account or a documented review path. Decide which.
7. **Testers and devices:** invite internal testers. Recruit 12 closed testers for 14 days if task 1 says the rule applies. Provide a physical Pixel and a Samsung device for WH-087.
8. **Answer the open decisions** in [mobile-api-v1](mobile-api-v1.md#open-owner-decisions). For the minimum Android version, passkeys work from API 28, which the shell already uses.
9. **Later, Mac or iOS only:** Apple Developer Program membership and macOS runner minutes. Both cost money, and neither is needed for Android.

## Verification

Docs only. `node tools/roadmap.mjs validate`, `alignment` and `render --check` pass, and `git diff --check` is clean. No Gradle build was run, because no Android source changed.
