# Android build and checks (WH-082)

**Status, October 4, 2026: the native shell is implemented in source (`android/`). Only the pure-Kotlin `:core` module has been built and tested locally. The Android app module, lint and instrumentation tests are verified only in CI (`.github/workflows/android.yml`), and CI has not run yet.** This is a navigable shell with no network calls. It is **not** acceptance of native identity, providers, mobile API routes, signed releases or physical devices. Those belong to WH-083–087 ([Android contract](android-app.md), [v1 contract](mobile-api-v1.md)).

## Toolchain (pinned)

| Item | Version | Where pinned |
| --- | --- | --- |
| Gradle wrapper | 9.7.1, `distributionSha256Sum=acd53f1e…d20a` | `android/gradle/wrapper/gradle-wrapper.properties` |
| Android Gradle plugin | 9.3.2 (uses built-in Kotlin, so there is no `kotlin-android` plugin) | `android/gradle/libs.versions.toml` |
| Kotlin / Compose compiler plugin | 2.3.0 | catalog |
| Compose BOM | 2025.09.01 | catalog |
| compileSdk / targetSdk / minSdk | 36 / 36 / 28 (Android 9) | catalog |
| JDK | 17 bytecode target. Gradle runs on JDK 17+ (CI uses Temurin 21) | `app/build.gradle.kts`, workflow |

AGP 9.4.0 (September 2026) was the newest AGP on the [AGP release page](https://developer.android.com/build/releases/gradle-plugin) as of October 4, 2026. We pinned 9.3.2 + Kotlin 2.3.0 + Gradle 9.7.1 because a public, CI-built reference project already uses that exact combination, and Google Maven could not be reached from the authoring environment. Upgrade on purpose: change the catalog, run the full checks and update this table. The API 28 minimum comes from the WH-082 packet. The minimum/target matrix in [mobile-api-v1 open decisions](mobile-api-v1.md#open-owner-decisions) is still an owner decision.

Android tooling is kept separate from the Node 24/pnpm 11 workspace: `android/` is not a pnpm package, and `ci.yml` does not build it.

## Local build

You need JDK 17+ and an Android SDK with `platforms;android-36` and build-tools. Set `ANDROID_HOME` or write `android/local.properties` (`sdk.dir=…`). `local.properties` is gitignored. The SDK is not part of the repository.

```sh
cd android
./gradlew assembleLocalDebug assembleDeployedDebug
./gradlew lintLocalDebug lintDeployedDebug
./gradlew :core:test testLocalDebugUnitTest testDeployedDebugUnitTest
./gradlew assembleLocalDebugAndroidTest assembleDeployedDebugAndroidTest
# With an emulator or device attached:
./gradlew connectedLocalDebugAndroidTest
```

Debug APKs are written to `android/app/build/outputs/apk/{local,deployed}/debug/`. Build outputs (`.gradle/`, `.kotlin/`, `build/`), `local.properties` and signing files (`*.jks`, `*.keystore`) are gitignored. There is no release signing configuration.

## Environments

- **`local` flavor** (`com.whumpo.android.local`) targets `http://127.0.0.1:8787`, which is the default `pnpm dev` (`wrangler dev`) port. Run `adb reverse tcp:8787 tcp:8787` so the device's loopback reaches your machine. Do not bind the dev server to `0.0.0.0`, a LAN address or a tunnel. The local [network security config](https://developer.android.com/privacy-and-security/security-config) allows cleartext only to `127.0.0.1`/`localhost`. `WhumpoEnvironment` rejects any non-loopback local origin at startup.
- **`deployed` flavor** targets exactly `https://whumpo.com` (the private test platform). It allows HTTPS only.
- The shell does not declare the `INTERNET` permission yet. Remote screens report "sign in required" or "not connected" and never show invented data. The package name is provisional (owner decision 2).

## Protected state and backups

- Drafts, the native session (WH-083) and pending operations are stored by `AccountStateStore` under `noBackupFilesDir/account-state/`. Each record is sealed with AES-256-GCM using a non-exportable [Android Keystore](https://developer.android.com/privacy-and-security/keystore) key. Records are bound to a hashed account key and slot. Raw account IDs never appear in file names.
- Changing account erases the previous account's state. Signing out erases all state and deletes the key. Unreadable or restored state is erased rather than trusted. Late writes for an account that is no longer active are refused.
- `allowBackup="false"`. `data_extraction_rules.xml` (cloud backup and device transfer) and `full_backup_content.xml` exclude the `root`, `device_root` and `external` domains ([Auto Backup](https://developer.android.com/identity/data/autobackup)).

## Tests

- `:core` unit tests (JVM, 19 tests): environment validation, account scope hashing, encrypted store (account switch, sign-out, restore after restart, foreign key, slot binding), and shell repositories.
- App unit tests: Chat draft debounce/sign-out/account change, Projects loading state, Settings sign-out.
- Instrumentation tests: navigation and Tab semantics/headings for the four destinations, rotation (`recreate`), environment display, 200% font scale, Keystore round trip and associated-data binding, no-backup location and ciphertext-only storage, account switch/sign-out erasure, sign-out from the Settings screen, draft surviving recreation and restart, backup flag and rules, and the composer staying above the soft keyboard. The keyboard test is *skipped* (`assume`) if the emulator never shows an IME.

## CI emulator matrix

`.github/workflows/android.yml` runs on changes under `android/**` (and to the workflow itself) and on `workflow_dispatch`. It uses `permissions: contents: read`, no secrets, SHA-pinned actions and wrapper validation.

| Job | Runner | Runs |
| --- | --- | --- |
| `build` | `ubuntu-latest` | assemble (both flavors, plus test APKs), lint, `:core` and app unit tests |
| `instrumented` | `ubuntu-latest` with KVM | `reactivecircus/android-emulator-runner` v2.38.0, `google_apis` x86_64, **API 28 and API 36**, both flavors |

Standard GitHub-hosted runners are free for public repositories. Private repositories consume the account's included Actions minutes; entitlement must be verified, and no paid plan is enabled. Each emulator job is bounded at 45 minutes. Not covered: TalkBack spoken output, physical Pixel/Samsung devices, signed upgrades, Play-enabled push, and passkeys.

## Verification record (October 4, 2026)

- **Passed locally:** the Gradle 9.7.1 distribution and wrapper JAR hashes match the pinned values (`gradle-wrapper.jar` SHA-256 `7a9ce74c…262c5d`). `:core:test` passed (19/19) using a scratch Gradle settings file that includes only `android/core`.
- **Not run locally:** the authoring sandbox's egress policy blocks `dl.google.com`, which also serves Google Maven artifacts, so AGP, AndroidX and the Android SDK could not be resolved. The app's assemble, lint, unit and instrumentation tasks are verified only in CI. The first CI run is the first compile of the app module.
