# Android build and checks (WH-082)

**Status, October 29, 2026: the shell is a Kotlin Multiplatform build (`:shared` plus `:androidApp`, work package 1). The Android modules, lint, Roborazzi and instrumentation tests are verified only in CI (`.github/workflows/android.yml`); the dev machine has no Android SDK.** Since work package 5 (WP5) the shell signs in with a passkey and calls `/api/mobile/v1` for identity only. It is **not** acceptance of native identity, providers, mobile API routes, signed releases or physical devices. Those belong to WH-083–087 ([Android contract](android-app.md), [v1 contract](mobile-api-v1.md)).

## Toolchain (pinned)

WP1 moved the build to Kotlin Multiplatform with Compose Multiplatform ([platform ADR](android-app-platform.md)). Versions were checked on 2026-10-29 and are the newest stable releases at that date.

| Item | Version | Where pinned | Checked at |
| --- | --- | --- | --- |
| Gradle wrapper | 9.8.2, `distributionSha256Sum=21bd5da2…9607` | `android/gradle/wrapper/gradle-wrapper.properties` | [services.gradle.org/versions/current](https://services.gradle.org/versions/current) (`current`, not a release candidate; built 2026-10-19) |
| Android Gradle plugin | 9.5.0 (built-in Kotlin; KMP library module uses `com.android.kotlin.multiplatform.library`) | `android/gradle/libs.versions.toml` | [Google Maven metadata](https://dl.google.com/dl/android/maven2/com/android/tools/build/gradle/maven-metadata.xml), newest non-alpha/beta/rc |
| Kotlin (and Compose compiler plugin, serialization plugin) | 2.4.21 | catalog | [Maven Central metadata](https://repo.maven.apache.org/maven2/org/jetbrains/kotlin/kotlin-gradle-plugin/maven-metadata.xml), newest non-beta (2.5.0 is only in beta) |
| Compose Multiplatform | 1.12.2 | catalog | [Maven Central metadata](https://repo.maven.apache.org/maven2/org/jetbrains/compose/compose-gradle-plugin/maven-metadata.xml) and the [CMP compatibility page](https://kotlinlang.org/docs/multiplatform/compose-compatibility-and-versioning.html) (1.12.2 uses Jetpack Compose 1.12.1) |
| Compose BOM (Android app) | 2026.09.00 (Compose 1.12.1, matching CMP 1.12.2) | catalog | [Google Maven BOM POM](https://dl.google.com/dl/android/maven2/androidx/compose/compose-bom/2026.09.00/compose-bom-2026.09.00.pom) |
| compileSdk / targetSdk / minSdk | 37 / 36 / 28 (Android 9) | catalog | Compose 1.12 and Lifecycle 2.11 require compileSdk 37 (found by the first CI run). targetSdk stays 36, the Play requirement |
| JDK | 17 bytecode target. Gradle runs on JDK 17+ (CI uses Temurin 21) | workflow | |

Compatibility note: the [Kotlin 2.4.21 compatibility table](https://kotlinlang.org/docs/gradle-configure-project.html) lists Gradle up to 9.7.0 and AGP up to 9.3.1 as fully supported. Gradle 9.8.2 and AGP 9.5.0 are newer than that range, so Kotlin may print compatibility warnings. If a later Kotlin release breaks on them, fall back to Gradle 9.7.x and AGP 9.3.x. Upgrade on purpose: change the catalog, run the full checks and update this table.

Android tooling is kept separate from the Node 24/pnpm 11 workspace: `android/` is not a pnpm package, and `ci.yml` does not build it.

## Module layout

| Module | Plugin | Contents |
| --- | --- | --- |
| `:shared` | Kotlin Multiplatform, `com.android.kotlin.multiplatform.library`, Compose Multiplatform, serialization | Targets Android and JVM (desktop). `commonMain`: `SecretBox`, `StateSlot`. `jvmCommonMain` (compiled into both targets): the account-scoped encrypted store, environment guard, repositories, the ViewModels and the sign-in logic (`core/auth`). `commonMain` also holds the sign-in screens (`ui/auth`) and `AuthState`. |
| `:androidApp` | `com.android.application` | The Android shell: Activity, Compose screens, Keystore `SecretBox`, resources, backup rules, flavours, instrumentation tests. Application ID and namespace `com.whumpo.android`. |

`jvmCommonMain` exists because that code uses `java.io` and `java.security`; both targets are JVM-based, so the directory is added to both. When a non-JVM target arrives it moves behind `expect`/`actual`. The `com.whumpo.core.*` and `com.whumpo.android.ui.*` package names were kept so the move changes no imports. ViewModel factories that need the Android-only `AppContainer` live in `:androidApp` (`ViewModelFactories.kt`).

## Mobile API client (WP4)

`com.whumpo.core.api` in `:shared` is the typed client for the frozen [v1 contract](mobile-api-v1.md): `Models.kt` (kotlinx.serialization wire models), `MobileApiException.kt` (one subtype per contract error code), `MobileApiClient.kt` (one method per operation, 34 in all) and `OkHttpEngine.kt`. It has no UI and no sign-in of its own: WP5 supplies the `SessionProvider` (`SessionManager`, below).

- **HTTP stack (decision, 2026-10-29, WP4): Ktor client 3.6.1 core with the OkHttp engine, plus kotlinx.serialization-json 1.12.0.** The plan (platform ADR, Libraries) already named Ktor and kotlinx.serialization. OkHttp is the lightest single engine that runs on both Android and the JVM desktop target, so there is one engine dependency and no per-platform engine code. `MobileApiClient` takes any `HttpClientEngine`, so tests inject Ktor's `MockEngine`. No ContentNegotiation plugin: bodies are encoded and decoded by one strict `Json` instance in the client.
- **Strict responses.** Unknown or missing keys, a version other than 1, a preview path outside the allowlist, or an approvable review whose control does not match its kind fail as `InvalidResponse`. The unknown review `kind` stays a string so the app can show update-required; `Review.present(client)` enables approval only for a control capability the build declared.
- **Errors.** `proof_required` (`ProofRequired.Proof.SIGN_IN` or `FRESH_PASSKEY`), `client_update_required` (426, with `minimumBuild`), `rate_limited` (`retryAfterSeconds`, falling back to `Retry-After`), `stale_revision` (`currentRevision`) and the rest map to subtypes of `MobileApiException`; a gateway page, redirect or unknown code is `Unrecognized`. On an authenticated route, `proof_required` with `signin` or `identity_changed` calls `SessionProvider.onSessionRejected()` before throwing.
- **Request IDs and replay.** Writes take the caller's request, upload or submission ID (`newRequestId()` makes a lowercase UUID). The client never retries and never regenerates an ID. A lost write reply is `Transport(outcomeUnknown = true)`; resolve it by reading (`resolveSend`/`getChatTurn`, `interactionReceipt`, `getPhotoUpload`), and retry only as an explicit owner action with the same ID and payload. `fresh_passkey` is surfaced for the caller to reauthenticate and retry with the same ID.
- **Interactions.** `interactions/list`, `read` and `resources` return the WH-105 payload as a `JsonObject` (version checked); the contract freezes only the envelopes. `mutate`, `receipt`, `continue`, `stop` and `reconcile` are typed from the fixtures.
- **Single source of truth.** The tests read `tests/fixtures/mobile-v1/*.json`, the same files `tests/mobile-v1-contract.mjs` reads, found by walking up from the module directory. Nothing was copied or moved. `android.yml` now also runs when those fixtures change.

## Local build

You need JDK 17+ and an Android SDK with `platforms;android-36` and build-tools. Set `ANDROID_HOME` or write `android/local.properties` (`sdk.dir=…`). `local.properties` is gitignored. The SDK is not part of the repository.

```sh
cd android
./gradlew assembleLocalDebug assembleDeployedDebug
./gradlew lintLocalDebug lintDeployedDebug
./gradlew :shared:jvmTest :shared:testAndroidHostTest :shared:compileKotlinJvm
./gradlew testLocalDebugUnitTest testDeployedDebugUnitTest
./gradlew assembleLocalDebugAndroidTest assembleDeployedDebugAndroidTest
# With an emulator or device attached:
./gradlew connectedLocalDebugAndroidTest
```

Debug APKs are written to `android/androidApp/build/outputs/apk/{local,deployed}/debug/`. Build outputs (`.gradle/`, `.kotlin/`, `build/`), `local.properties` and signing files (`*.jks`, `*.keystore`) are gitignored. There is no release signing configuration.

## Environments

- **`local` flavor** (`com.whumpo.android.local`) targets `http://127.0.0.1:8787`, which is the default `pnpm dev` (`wrangler dev`) port. Run `adb reverse tcp:8787 tcp:8787` so the device's loopback reaches your machine. Do not bind the dev server to `0.0.0.0`, a LAN address or a tunnel. The local [network security config](https://developer.android.com/privacy-and-security/security-config) allows cleartext only to `127.0.0.1`/`localhost`. `WhumpoEnvironment` rejects any non-loopback local origin at startup.
- **`deployed` flavor** targets exactly `https://whumpo.com` (the private test platform). It allows HTTPS only.
- WP5 added the `INTERNET` permission. Signed out, the app shows the sign-in screens; signed in, Projects and Activity still report "not connected" until WP7 and never show invented data. The package name `com.whumpo.android` is final (owner answer Q-005, 2026-10-29).

## Protected state and backups

- Drafts, the native session (WP5, `SessionManager`) and pending operations are stored by `AccountStateStore` under `noBackupFilesDir/account-state/`. Each record is sealed with AES-256-GCM using a non-exportable [Android Keystore](https://developer.android.com/privacy-and-security/keystore) key. Records are bound to a hashed account key and slot. Raw account IDs never appear in file names.
- Changing account erases the previous account's state. Signing out erases all state and deletes the key. Unreadable or restored state is erased rather than trusted. Late writes for an account that is no longer active are refused.
- `allowBackup="false"`. `data_extraction_rules.xml` (cloud backup and device transfer) and `full_backup_content.xml` exclude the `root`, `device_root` and `external` domains ([Auto Backup](https://developer.android.com/identity/data/autobackup)).

## Tests

- `:shared` tests (run on the JVM target and on the Android host-test target; the 19 original `:core` tests plus the ViewModel tests, which moved with the code, plus a `commonTest` smoke test): environment validation, account scope hashing, encrypted store (account switch, sign-out, restore after restart, foreign key, slot binding), and shell repositories.
- `MobileApiClientTest` (WP4, in `jvmCommonTest`, so it runs on the JVM and Android host targets): every one of the 34 operations is called against its fixture pair with a mock engine (method, path, query, body, `Whumpo-Client`, bearer only on authenticated routes, no cookie, and the typed result re-encodes to the fixture body); every error code; response rejection fixtures; review presentation and the four controls; lost-reply, retry and fresh-passkey flows; client-side admission from the request rejection fixtures; FCM data parsing; the client header.
- ViewModel tests (now in `:shared`): Chat draft debounce/sign-out/account change, Projects loading state, Settings sign-out.
- Instrumentation tests: navigation and Tab semantics/headings for the four destinations, rotation (`recreate`), environment display, 200% font scale, Keystore round trip and associated-data binding, no-backup location and ciphertext-only storage, account switch/sign-out erasure, sign-out from the Settings screen, draft surviving recreation and restart, backup flag and rules, and the composer staying above the soft keyboard. The keyboard test is *skipped* (`assume`) if the emulator never shows an IME.

## CI emulator matrix

`.github/workflows/android.yml` runs on changes under `android/**` (and to the workflow itself) and on `workflow_dispatch`. It uses `permissions: contents: read`, no secrets, SHA-pinned actions and wrapper validation.

| Job | Runner | Runs |
| --- | --- | --- |
| `build` | `ubuntu-latest` | assemble (both flavors, plus test APKs), lint, `:shared` JVM and Android host tests (including the Roborazzi screenshot verification), desktop (JVM) compile, app unit tests |
| `instrumented` | `ubuntu-latest` with KVM | `reactivecircus/android-emulator-runner` v2.38.0, `google_apis` x86_64, **API 28 and API 36**, both flavors |

Standard GitHub-hosted runners are free for public repositories. Private repositories consume the account's included Actions minutes; entitlement must be verified, and no paid plan is enabled. Each emulator job is bounded at 45 minutes. Not covered: TalkBack spoken output, physical Pixel/Samsung devices, signed upgrades, Play-enabled push, and passkeys.

## Verification record

- **October 4, 2026 (original shell):** Gradle wrapper hashes matched; `:core:test` passed 19/19 locally; the Android modules were CI-only.
- **October 29, 2026 (WP4):** `:shared:jvmTest` (including `MobileApiClientTest`) and `:shared:compileKotlinJvm` passed locally on Temurin 21; the Android targets are verified in GitHub Actions only (see the PR). The client is not wired into the app yet and the shell still has no `INTERNET` permission.
- **October 29, 2026 (WP1):** the dev machine still has no Android SDK, and no SDK license was accepted locally. The restructure was verified in GitHub Actions on the pull request: see the PR for the run. The Gradle wrapper JAR is unchanged (SHA-256 `7a9ce74c…262c5d`); only the distribution URL and checksum moved to 9.8.2.

## Theme (WP2)

- `android/shared/src/commonMain/kotlin/com/whumpo/android/ui/theme/WhumpoTokens.kt` is **generated** by `node tools/design-tokens.mjs` from `docs/design/whumpo-design-system/tokens.json` (palettes, the mapped Material 3 scheme for light and dark, type, radii, spacing, motion). `--check` (part of `pnpm check`) fails when the file is stale. The same run asserts 4.5:1 for every mapped text pair and 3:1 for outline and focus ring in both themes, and that light `primary` is not Sky Blue. `WhumpoTheme.kt` and `WhumpoButtons.kt` are hand-written and contain no hex.
- Fonts: `composeResources/font/*.ttf` (Poppins Medium and Bold, Inter Regular, Medium and SemiBold) are lossless TTF conversions of the design system's `.woff2` files, so the app and the web ship the same glyphs. Licences (SIL OFL 1.1): `composeResources/files/OFL-Poppins.txt` and `OFL-Inter.txt`.
- Material 3 for Compose Multiplatform is versioned apart from Compose: `composeMaterial3 = 1.9.0` in the catalog.
- Roborazzi is not introduced in WP2 (it needs Robolectric and the Android SDK, which only CI has). Verification is `WhumpoTokensTest` (JVM, `:shared:jvmTest`) plus the generator check. Screenshot tests arrived with WP3 (below).
- `overline` is exposed as `WhumpoTheme.overline`; callers apply uppercase to the text (a `TextStyle` cannot).

## Adaptive shell, state components and screenshots (WP3)

- **Shell** (`:shared` `commonMain`, `ui/shell`): `WhumpoShell` picks the navigation from the window width: a bottom bar below 600dp, a navigation rail from 600dp. `AdaptivePanes` shows list and detail side by side (40/60) from 840dp. Destinations (Chat, Projects, Activity, Settings), icons and labels live in `TopDestination`; the app (`:androidApp` `WhumpoApp`) only supplies the screens. Selection survives rotation and resize (`rememberSaveable`), each destination keeps its own saved state, and back returns to Chat from any other destination (predictive back, with a scale and fade preview). Edge-to-edge itself stays in `MainActivity` (`enableEdgeToEdge`, `enableOnBackInvokedCallback`); the shell applies the safe-drawing insets.
- **State components** (`ui/state`): `Skeleton` (loading, with a 1.2 s opacity shimmer, static when `animated = false` or when the system animator scale is 0), `EmptyState` (mascot, one sentence, one action), `ErrorCard` (what happened, what is safe, Try again; polite live region), `OfflineBanner` (slim, polite live region), `UpdateRequiredScreen` (mascot, Open Play Store, Get help), the `UiState` sealed type, and `WhumpoMascot` (a code-drawn vector, decorative). Copy is passed in by the caller; the defaults are English only until localisation is scoped. Every button has a 48dp minimum height, and status is icon plus words plus colour.
- **Decisions.** (1) No `NavigationSuiteScaffold` and no navigation-compose: both need extra artifacts and the shell is a few dozen lines on plain Material 3 `NavigationBar` and `NavigationRail` driven by `BoxWithConstraints`, which also makes the size class testable at any width. (2) Drawn icons and mascot instead of resources, so they are in `commonMain` and need no Android resource loading. (3) `androidx.activity` moved from 1.9.3 to 1.13.0 (current stable) because Compose Multiplatform's Android back handler delegates to `androidx.activity.compose`, whose back handling is built on the navigation-event dispatcher from 1.12. (4) `PredictiveBackHandler` is deprecated for `NavigationEventHandler`; it still works on CMP 1.12 and is suppressed with a `shortcut:` note. (5) Not done yet: foldable hinge handling and the permanent drawer at 1200dp or more (`WindowInfoTracker`), and the review side sheet (WP6).
- **Screenshot tests** (Roborazzi 1.77 on Robolectric 4.17, native graphics, SDK 35): `ScreenshotTest` records every state component at compact (360x720), medium (700x900) and expanded (1000x700), light and dark, plus 200% font scale at compact; and the shell at the three widths in both themes, offline, and at 200% font. `ShellBehaviorTest` asserts bar, rail and two panes by width, tab roles and 48dp targets, headings, selection after recreation and back to Chat. They run in the normal `:shared:testAndroidHostTest` CI step, so there is no emulator and no new job. The Roborazzi Gradle plugin is not used (it does not target the KMP Android library host test): `shared/build.gradle.kts` sets the `roborazzi.test.verify` system property, or `roborazzi.test.record` with `-Pscreenshots.record`.
- **Goldens** are committed in `android/shared/src/androidHostTest/screenshots/`. To change a screen: run the `Android` workflow by hand on the branch with `record_screenshots` ticked (Actions, Run workflow), download the `android-screenshot-goldens` artifact, replace the folder, review the images and commit. A failing verify uploads the diffs (`android/shared/build/outputs/roborazzi`) with the failure reports. Images are recorded on the CI runner; do not record locally.

## Chat and the review-and-confirm sheet (WP6)

- **Where it lives.** `ChatSession` (conversation logic, no Android code), `ChatContent`/`ChatLayout` and `ReviewSheet` are in `:shared` `commonMain` under `ui/chat`. `ChatViewModel` (draft plus session) stays in `jvmCommonMain` because the account-scoped draft store is JVM code. The app only supplies the ViewModel and three hand-offs (preview, update, help).
- **Lost replies (decision, 2026-10-29).** A send takes its request ID once (the turn ID). If the reply is lost the outcome is unknown: `ChatSession` reads `chat/turns/{id}` through `MobileApiClient.resolveSend` and never re-sends. Only an explicit "Send again" re-sends, with the same ID, text and `expectedRevision`. The draft is cleared only once the send is committed, so a lost reply or a stale revision never costs the owner their text. Known limit: the in-flight request ID is not persisted, so after process death the draft is still there and sending it again is a new, explicit owner action.
- **Confirm (decision).** Confirm sends the turn's `revision` as `expectedRevision` and one request ID per review. `proof_required` with `fresh_passkey` calls `ReauthHook.reauthenticate()` once and retries with the same ID. `ReauthHook` is the seam WP5 implements next to `SessionProvider` (Credential Manager plus `reauthOptions`/`reauthVerify`); tests use a fake. Until WP5 lands the app wires a hook that returns false and a session with no token, so Chat reports "Sign in to continue" and still keeps the draft. A lost confirm reply is checked by reading the conversation, never by confirming again. `stale_revision` or `review_unavailable` leaves a sheet with no enabled confirm.
- **Sheet.** Bottom sheet below 840dp, a side pane (the shell's detail pane) on expanded widths. Order and labels follow D8: the named effect (Publish website, Save private website, Turn on app, Restore app data) is the only primary, Open preview is secondary, Not now is quiet. The disclosure lines are shown verbatim. An unknown review kind or a control this build did not declare shows "Update required" and nothing is enabled.
- **Interactions.** A turn carrying an interaction shows a generic card (status only). No payload is parsed or rendered until WH-105 lands.
- **Haptics and announcements.** `Confirm` on an accepted confirm, `Reject` on a failed send or confirm; no haptic on send. New replies and review outcomes go through one polite live region, and the typing indicator is itself a polite live region with visible words.
- **Tests.** `ChatSessionTest` and `ChatViewModelTest` run against `MockEngine` serving the frozen fixtures (lost reply, stale revision, proof_required, unknown control). `ChatBehaviorTest` checks semantics; `ChatScreenshotTest` records `chat-*` and `review-*` goldens at 360 and 1000dp, light and dark.
- **Open.** Relative timestamps ("2 min ago") are not shown yet (no date library in `:shared`); previews open in the default browser until WP7 adds the authenticated Custom Tab; the app has no `INTERNET` permission until WP5.

## Passkey sign-in, browser hand-off and App Links (WP5)

**What exists.** `com.whumpo.core.auth` (`:shared`, `jvmCommonMain`) is the sign-in logic with no Android types: `AuthController` (state machine), `SessionManager` (the `SessionProvider` for `MobileApiClient` and the sealed storage), `Pkce`, and the `PasskeyAuthenticator` and `BrowserLauncher` interfaces. `commonMain` holds `AuthState`/`AuthActions` and the screens (`ui/auth/AuthScreens.kt`). `:androidApp` supplies Credential Manager (`CredentialManagerPasskeys`), Custom Tabs (`CustomTabsBrowser`), the `AuthGate` composable that decides between sign-in and the shell, and the App Link handling in `MainActivity` (`launchMode="singleTask"`, `onNewIntent`).

**Journeys.** Passkey: `session/login/options`, Credential Manager `getCredential`, `session/login/verify`, `GET /session` (account label), the session sealed in the Keystore-backed store, then `GET /bootstrap`. An unfinished welcome shows "Finish setting up in your browser" and holds the shell shut. Browser hand-off (the fallback, the invite, and an incomplete account): PKCE S256 `session/handoff/start`, the browser page from the server's `browserPath` (the app composes the URL from its constant origin and refuses any path that is not a single-slash path), the verified App Link `https://whumpo.com/app/return?code=...&state=...` back, then `session/handoff/exchange`. A hand-off is single use and held in memory, so the process dying while the browser is open means starting again. Fresh passkey: `AuthController.reauthenticate()` runs `session/reauth/*` with the same Credential Manager call and moves `freshUntil`; WP6 calls it when a control answers `proof_required` with `fresh_passkey`. Sign-out: `session/logout` (best effort, bounded to five seconds), then `AccountStateStore.signOut()` erases every record and destroys the key. A `401 proof_required` with `signin`, `identity_changed` or a local expiry does the same erase and returns to Welcome with "You've been signed out."

**Storage.** The session (token, expiry, `freshUntil`, label) is one `StateKind.SESSION` record in the existing `AccountStateStore`, so it is AES-256-GCM sealed by the Keystore `SecretBox`, in no-backup storage, and excluded from backups. "Signed in" means an account is active in that store. The contract exposes no account id, so the store scope is the masked address label; every sign-in starts from an erased store, so two accounts with the same mask cannot see each other's drafts.

**Assumptions to confirm with WH-083/WH-115.** (1) The contract fixes the return URI and a one-time code but not the query names; the app reads `code` and `state`. (2) For an account that is not ready, the hand-off purpose is `signup`. (3) Credential Manager's authentication response JSON is sent to `session/login/verify` unchanged; if the server's strict schema rejects `clientExtensionResults` or `authenticatorAttachment`, the server schema (or this client) must change. (4) The `local` flavor reaches loopback for the API, but the contract fixes the return link to whumpo.com, so a hand-off cannot complete against a local server.

**Not tested in CI, plainly.** Real passkeys cannot run in CI: Credential Manager needs a physical device or a Google-services emulator image with a credential provider, a Google account, and the published `assetlinks.json` for the signing identity. The unit tests drive the state machine with a fake `PasskeyAuthenticator`, a fake browser and the WP4 client on Ktor's `MockEngine`; the screenshot and Robolectric tests cover the screens. App Link verification, the Custom Tab round trip, "Use a passkey from another device" (it re-opens the system sheet; whether it shows the hybrid option when no credential exists is a device check), TalkBack speech and the whole sign-in against a real server are WH-087 device evidence.

**App Links and Digital Asset Links.** `AndroidManifest.xml` declares one verified App Link (`autoVerify`) for `https://whumpo.com/app/return`; WP7 adds the Activity and Projects links. Verification and passkeys both need `https://whumpo.com/.well-known/assetlinks.json`. The repository holds only a template, [`docs/android/assetlinks.template.json`](android/assetlinks.template.json), with a placeholder for the Play App Signing certificate fingerprint. It is **not** published. The owner steps are in [android/assetlinks-setup.md](android/assetlinks-setup.md).

**Tests added.** `AuthControllerTest` and `PkceTest` (`jvmCommonTest`, so they run on the JVM and Android host targets): success, cancel, no credential, unavailable provider, network failure, rejected assertion, rate limit, outage, update required, double taps, incomplete account, unfinished welcome, unsafe browser paths, the full hand-off (PKCE challenge equals the SHA-256 of the sent verifier, state mismatch, replay, foreign and malformed return links, failed exchange, cancel), 401 and local expiry, sign-out with and without the server, restart persistence, reauthentication. `AuthScreensTest` (Robolectric): headings, 48dp targets, live regions, disabled-while-busy, 200% text and 1000dp reachability. `AuthScreenshotTest`: goldens `auth-*` at 360dp and 1000dp, light and dark, and 200% text for two screens. The instrumented `NavigationTest` and `AccountStateTest` now sign a fixture account in first, because the shell is behind the sign-in gate.

**Verification record, October 29, 2026 (WP5).** `:shared:jvmTest` and `:shared:compileKotlinJvm` passed locally on Temurin 21 with no Android SDK. Everything Android (assemble, lint, Robolectric and Roborazzi, instrumentation) is verified in GitHub Actions on the pull request only. No SDK was installed and no licence accepted locally.
