# Android notifications: client, FCM seam and owner steps

**Firebase project (2026-10-30):** `whumpo-18331`, FCM v1 only. `google-services.json` (both apps) is held in the owner secret store and is git-ignored (`android/.gitignore`); copy it to `android/androidApp/google-services.json` for local builds.

**Status, October 29, 2026 (WP7).** The mobile API client for devices and events is built and tested. Push delivery is not: it needs a Firebase project that only the owner can create. The app ships a no-op provider, adds no Firebase dependency and holds no `google-services.json` or any other Firebase config.

## What is built

| Piece | Where | Behaviour |
| --- | --- | --- |
| `DeviceNotifications` | `:shared` `com.whumpo.core.push` | `register(enabled)` sends `PUT /devices/current` with the FCM registration token and the in-app preference; `remove()` sends `DELETE /devices/current`, then deletes the local token; `event(id)` reads `GET /events/{id}`. |
| `PushMessaging` | same | The seam to FCM: `available`, `token()`, `deleteToken()`. |
| `NoOpPushMessaging` | same | The only implementation in this build. `available = false`, no token. Settings explains "Notifications aren't available in this version of the app yet." and offers no switch. |
| `ActivityViewModel.openEvent` | `:shared` | A notification tap reads the event's current server state and shows a notice. Nothing is sent, approved or retried. A missing, foreign or `unavailable` event shows "This item isn't available anymore." |

Push is opt-in in the app (contract decision 6). Lock-screen copy must stay generic and private; the FCM data payload is exactly `{v, eventId, kind}` (`PushMessage.fromData` drops anything else).

## Owner steps to turn push on

These need the owner's Google account. Nothing below is done by the build, and none of it may be committed.

1. **Create a Firebase project** (Cloud Messaging only; no Analytics, Auth or database). Add an Android app with package `com.whumpo.android` and, for the debug flavor, `com.whumpo.android.local`. Add the SHA-256 fingerprints of the upload key and, after Play App Signing is on, the app signing key. Keep keys out of the repo.
2. **Server credential (WH-086).** Create a service account limited to sending FCM messages (role `Firebase Cloud Messaging API Admin` is broader than needed; prefer a custom role with `cloudmessaging.messages.create`). Store its JSON as a Worker secret for the FCM HTTP v1 adapter. Never in the repo, the app or logs.
3. **App config, kept out of git.** Download `google-services.json` and keep it in the owner's secret store. For CI and releases, inject it at build time (a secret file written to `android/androidApp/google-services.json` by the job), and keep `google-services.json` in `.gitignore`. The local and deployed flavors need their own client entries.
4. **Then ask for the code change** (a follow-up work package, not WP7), which will:
   - add the Google services Gradle plugin and `firebase-messaging` (BoM) to `:androidApp` only;
   - implement `PushMessaging` with `FirebaseMessaging.getInstance().token` and `deleteToken()`, and swap it into `AppContainer` in place of `NoOpPushMessaging`;
   - add a `FirebaseMessagingService`: `onNewToken` calls `DeviceNotifications.register` again; `onMessageReceived` parses `PushMessage.fromData` and posts a private notification whose tap opens the app with `eventId`, which `MainActivity` hands to `ActivityViewModel.openEvent`;
   - create the three channels (Needs your review: high; Work finished: default; Something went wrong: default) with `VISIBILITY_PRIVATE` and a generic public version;
   - ask for `POST_NOTIFICATIONS` (Android 13+) in context, after the owner's first successful request, with a **Turn on** / **Not now** card; and show the permission state in Settings with **Open system settings** when denied.
5. **Verify on a physical device** (WH-087): token rotation, invalid-token cleanup, withdrawal after sign-out, and that a lock-screen notification shows no project names, message text or photos.

## Why a seam instead of Firebase now

The owner decides the Firebase project, billing and key custody. Merging `google-services.json` or the plugin without them would break every build, and committing the config would put project identifiers in git. The interface keeps the registration, preference and event code tested today and makes the FCM step an additive change.
