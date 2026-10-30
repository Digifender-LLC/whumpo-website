# Play Data safety form: draft

**Status, October 29, 2026: draft answered from the source at the time of writing, for the owner to enter.** Re-check it against the code and the published privacy policy before every release that changes data handling. Play compares the form to the app's behaviour and the policy; a mismatch can get a release rejected.

How the answers were derived: the app's dependencies (`android/gradle/libs.versions.toml`), the manifest, `NoOpPushMessaging`, the photo pipeline and the mobile API client were read. The app contains **no analytics, advertising, crash-reporting or other third-party SDK that collects data**. It does contain Google Play services Credential Manager (passkeys), which Google operates.

## Top-level questions

| Question | Answer | Why |
| --- | --- | --- |
| Does the app collect or share any of the required user data types? | Yes | See below. |
| Is all collected data encrypted in transit? | Yes | Release builds allow HTTPS only (`network_security_config.xml`, `cleartextTrafficPermitted=false`, system trust anchors). The `local` developer flavour (loopback cleartext) is not published. |
| Do you provide a way for users to request data deletion? | Yes | See [Deletion](#deletion). |
| Independent security review (optional badge) | No | Not done. |

## Data types

Collected means sent off the device to Whumpo's servers. Play does not count processing by a service provider acting on Whumpo's behalf as sharing; see the AI note.

| Play category and type | Collected | Shared | Required | Purpose | Notes |
| --- | --- | --- | --- | --- | --- |
| Personal info: Email address | Yes | No | Required | Account management | The account email is held server-side and shown to the owner masked (for example `o***@example.test`). It is created and changed in the browser, not typed into the app. |
| Personal info: User IDs | Yes | No | Required | App functionality, Account management | Account and project identifiers; passkey credential ID and public key held by the server. |
| Photos and videos: Photos | Yes | No | Optional | App functionality | Only photos the user picks with the system photo picker and approves for a project. Re-encoded to a bounded JPEG on the phone and cleaned again on the server: **EXIF, GPS, thumbnails and profiles are removed**. The app holds no storage, camera or location permission. |
| App activity: Other user-generated content | Yes | See AI note | Required | App functionality | Chat messages, requested changes, project names and purposes, saved site versions, review decisions. |
| App activity: Other actions | Yes | No | Required | App functionality | Activity events (what happened to a project and when) and review approvals. |
| Device or other IDs: Device or other IDs | **Not yet** | No | Optional | App functionality (notifications) | The FCM registration token is sent to `PUT /devices/current` **only after push ships and the user turns notifications on**. The current build uses `NoOpPushMessaging` and sends no token. Declare it in the release that ships push, not before. |
| Financial info, Health and fitness, Messages, Contacts, Calendar, Audio, Files and docs, Web browsing, Location, App info and performance | No | No | n/a | n/a | Not collected. Crash logs and diagnostics are not sent anywhere; there is no crash-reporting SDK. |

**Biometrics.** Passkey unlock (fingerprint, face or screen lock) happens inside Android and Google Password Manager. The app never receives biometric data, so do not declare it.

**Ephemeral processing** is not claimed; Whumpo stores chat and project content to run the service.

**AI note (owner to confirm).** Chat content is processed by an AI provider selected by the Whumpo platform to prepare changes (see [ai-gateway-transport](../../ai-gateway-transport.md) and [data-protection](../../data-protection.md)). Treat the provider as a service provider processing on Whumpo's behalf and **do not tick "shared"**, provided the provider terms prohibit its own use of the data. The owner must confirm that against the current provider contract before submitting. If it is not true, tick Shared for user-generated content.

## Data handling details

- **Encryption in transit:** TLS for every request. Session tokens and drafts on the phone are stored in no-backup app storage, encrypted with a non-exportable Android Keystore key. Backups and device transfer are disabled.
- **Retention on the phone:** signing out erases all account state and deletes the key; changing account erases the previous account's state.
- **Not used for:** advertising, marketing or data sale. No data is sold.

## Deletion

Honest state: **in-app account deletion does not exist yet.** Platform account closure is a documented, partly built process ([account-closure](../../account-closure.md)), not a self-service feature.

What a user can do today:

- Delete a photo through the Chat review flow on the Whumpo website: access stops at once and the stored bytes go in the daily cleanup ([photos](../../photos.md)).
- Sign out on the phone: erases all local data.
- Ask for full account deletion through Help and support (`/workspace/support` on the website).

For the Play form: answer "Yes, users can request deletion" and give a **public web URL** that explains the request path (the Whumpo support page or a section of the privacy policy). The owner must publish that page before submission, and it must say what is deleted, what is kept and for how long. Accounts are created in the browser, not in the app, so Play's in-app deletion requirement for account creation does not apply in its strict form, but the web link is still required.

## Checks before each submission

1. `grep -n "implementation(" android/*/build.gradle.kts`: no new SDK that collects data (analytics, ads, crash).
2. Push shipped? Add Device IDs and the FCM purpose.
3. New permissions in `AndroidManifest.xml`? Today only `INTERNET`.
4. The privacy policy text matches this table.
