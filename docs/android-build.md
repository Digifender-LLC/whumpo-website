# Android build and checks (WH-082)

**Source and local-build status, October 7, 2026:** the native shell and identity client are implemented in `android/`. Both flavors, both instrumentation APKs, lint and all 52 JVM tests passed against identity commit `4468991`. Credential Manager, bounded native HTTP, protected session/PKCE custody, explicit browser return and sign-out are implemented. Instrumentation APK compilation does not mean device tests ran. No approved release signing, provider activation, domain association, emulator/device execution or physical-device acceptance is claimed. WH-084 workspace client work is tracked separately in [android-workspace](android-workspace.md).

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
- The app declares `INTERNET` for the bounded native transport. The provisional package does not activate server-side signing association; [identity configuration](android-identity.md#association-and-activation) remains required.

## Protected state and backups

- Drafts, the native session (WH-083) and pending operations are stored by `AccountStateStore` under `noBackupFilesDir/account-state/`. Each record is sealed with AES-256-GCM using a non-exportable [Android Keystore](https://developer.android.com/privacy-and-security/keystore) key. Records are bound to a hashed account key and slot. Raw account IDs never appear in file names.
- Changing account erases the previous account's state. Signing out erases all state and deletes the key. Unreadable or restored state is erased rather than trusted. Late writes for an account that is no longer active are refused.
- `allowBackup="false"`. `data_extraction_rules.xml` (cloud backup and device transfer) and `full_backup_content.xml` exclude the `root`, `device_root` and `external` domains ([Auto Backup](https://developer.android.com/identity/data/autobackup)).

## Tests

- `:core` unit tests at identity commit `4468991` (JVM, 28 tests): environment validation, encrypted account state, sign-out/switch fences, exact session expiry, PKCE custody across process death, wrong/foreign/duplicate returns, uncertain exchange, reauthentication and late-response cancellation.
- App unit tests at that commit: 12 per flavor, including bounded cookie-free native HTTP, strict current envelopes, rejection of redirected responses and the actual OkHttp 503 `Retry-After: 0` mutation-replay regression. Request bodies are explicitly one-shot.
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


## Current verification record (October 7, 2026)

The earlier Google Maven/SDK egress blocker was resolved by the session's package-host access. Official SDK components were installed in the disposable `/workspace/whumpo-android-sdk`, with isolated Gradle cache and JDK. No SDK, downloaded dependency, signing key or build output was committed.

At `4468991`, this command completed successfully in 3 minutes 35 seconds with two Gradle workers:

```sh
./gradlew --no-daemon --max-workers=2 :core:test testLocalDebugUnitTest testDeployedDebugUnitTest assembleLocalDebug assembleDeployedDebug lintLocalDebug lintDeployedDebug assembleLocalDebugAndroidTest assembleDeployedDebugAndroidTest
```

Results: 28 core tests and 12 app tests per flavor (52 total), zero lint issues in each flavor, both debug application APKs and both instrumentation APKs assembled. A separate checkout independently ran 15 identity-focused JVM tests. Evidence logs for this session are `/tmp/whumpo-native-client-full.log` and `/tmp/whumpo-verification/android-identity-independent.log`. These are local build and JVM results; no connected instrumentation, emulator, TalkBack, physical passkey, verified App Link, signed upgrade or release installation was run.
