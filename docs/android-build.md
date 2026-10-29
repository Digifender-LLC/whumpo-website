# Android build and checks (WH-082)

**Status, October 29, 2026: the shell is a Kotlin Multiplatform build (`:shared` plus `:androidApp`, work package 1). The Android modules, lint and instrumentation tests are verified only in CI (`.github/workflows/android.yml`); the dev machine has no Android SDK.** This is a navigable shell with no network calls. It is **not** acceptance of native identity, providers, mobile API routes, signed releases or physical devices. Those belong to WH-083–087 ([Android contract](android-app.md), [v1 contract](mobile-api-v1.md)).

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
| `:shared` | Kotlin Multiplatform, `com.android.kotlin.multiplatform.library`, Compose Multiplatform, serialization | Targets Android and JVM (desktop). `commonMain`: `SecretBox`, `StateSlot`. `jvmCommonMain` (compiled into both targets): the account-scoped encrypted store, environment guard, repositories and the ViewModels. |
| `:androidApp` | `com.android.application` | The Android shell: Activity, Compose screens, Keystore `SecretBox`, resources, backup rules, flavours, instrumentation tests. Application ID and namespace `com.whumpo.android`. |

`jvmCommonMain` exists because that code uses `java.io` and `java.security`; both targets are JVM-based, so the directory is added to both. When a non-JVM target arrives it moves behind `expect`/`actual`. The `com.whumpo.core.*` and `com.whumpo.android.ui.*` package names were kept so the move changes no imports. ViewModel factories that need the Android-only `AppContainer` live in `:androidApp` (`ViewModelFactories.kt`).

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
- The shell does not declare the `INTERNET` permission yet. Remote screens report "sign in required" or "not connected" and never show invented data. The package name `com.whumpo.android` is final (owner answer Q-005, 2026-10-29).

## Protected state and backups

- Drafts, the native session (WH-083) and pending operations are stored by `AccountStateStore` under `noBackupFilesDir/account-state/`. Each record is sealed with AES-256-GCM using a non-exportable [Android Keystore](https://developer.android.com/privacy-and-security/keystore) key. Records are bound to a hashed account key and slot. Raw account IDs never appear in file names.
- Changing account erases the previous account's state. Signing out erases all state and deletes the key. Unreadable or restored state is erased rather than trusted. Late writes for an account that is no longer active are refused.
- `allowBackup="false"`. `data_extraction_rules.xml` (cloud backup and device transfer) and `full_backup_content.xml` exclude the `root`, `device_root` and `external` domains ([Auto Backup](https://developer.android.com/identity/data/autobackup)).

## Tests

- `:shared` tests (run on the JVM target and on the Android host-test target; the 19 original `:core` tests plus the ViewModel tests, which moved with the code, plus a `commonTest` smoke test): environment validation, account scope hashing, encrypted store (account switch, sign-out, restore after restart, foreign key, slot binding), and shell repositories.
- ViewModel tests (now in `:shared`): Chat draft debounce/sign-out/account change, Projects loading state, Settings sign-out.
- Instrumentation tests: navigation and Tab semantics/headings for the four destinations, rotation (`recreate`), environment display, 200% font scale, Keystore round trip and associated-data binding, no-backup location and ciphertext-only storage, account switch/sign-out erasure, sign-out from the Settings screen, draft surviving recreation and restart, backup flag and rules, and the composer staying above the soft keyboard. The keyboard test is *skipped* (`assume`) if the emulator never shows an IME.

## CI emulator matrix

`.github/workflows/android.yml` runs on changes under `android/**` (and to the workflow itself) and on `workflow_dispatch`. It uses `permissions: contents: read`, no secrets, SHA-pinned actions and wrapper validation.

| Job | Runner | Runs |
| --- | --- | --- |
| `build` | `ubuntu-latest` | assemble (both flavors, plus test APKs), lint, `:shared` JVM and Android host tests, desktop (JVM) compile, app unit tests |
| `instrumented` | `ubuntu-latest` with KVM | `reactivecircus/android-emulator-runner` v2.38.0, `google_apis` x86_64, **API 28 and API 36**, both flavors |

Standard GitHub-hosted runners are free for public repositories. Private repositories consume the account's included Actions minutes; entitlement must be verified, and no paid plan is enabled. Each emulator job is bounded at 45 minutes. Not covered: TalkBack spoken output, physical Pixel/Samsung devices, signed upgrades, Play-enabled push, and passkeys.

## Verification record

- **October 4, 2026 (original shell):** Gradle wrapper hashes matched; `:core:test` passed 19/19 locally; the Android modules were CI-only.
- **October 29, 2026 (WP1):** the dev machine still has no Android SDK, and no SDK license was accepted locally. The restructure was verified in GitHub Actions on the pull request: see the PR for the run. The Gradle wrapper JAR is unchanged (SHA-256 `7a9ce74c…262c5d`); only the distribution URL and checksum moved to 9.8.2.
