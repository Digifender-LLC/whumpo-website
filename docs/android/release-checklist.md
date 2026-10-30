# Android private beta: owner release checklist (WH-087)

**Status, October 29, 2026.** Everything the repository can prepare is done: a minified release bundle job, a version scheme, listing drafts and screenshots. What is left needs your accounts. Do the parts in order; each says what to click or run and what to check afterwards. No secret or keystore is ever committed or pasted into chat.

Facts this relies on: package `com.whumpo.android` (final, Q-005); the Play account is personal and was created after November 13, 2023 (Q-006), so **12 closed testers for 14 continuous days** are required before production. **Internal testing is exempt** and is where the beta starts.

## 0. Build version scheme

- `android/version.properties`: `versionName` (edit by hand per release, for example `0.1.0`) and `versionCodeBase` (leave at `0`).
- `versionCode = versionCodeBase + the run number of the "Android" workflow run that built it`. It rises on every run, so Play always accepts a newer upload. If the workflow is ever recreated and its run numbers restart, raise `versionCodeBase` above the last uploaded code. Never lower it.
- A local build gets `versionCode = versionCodeBase + 1`; it is never uploaded.
- Builds without your upload key are signed with the debug key, get the suffix `-debugsigned` in `versionName` and the file name `whumpo-deployed-release-DEBUGSIGNED-not-for-upload-run<N>.aab`. Play rejects them. They exist to prove the build.

## 1. Create the app in Play Console

1. Open [Play Console](https://play.google.com/console), **Create app**.
2. App name `Whumpo`, default language English (United States), **App**, **Free**. Accept the declarations.
3. Package name is fixed by the first upload (`com.whumpo.android`); you will confirm it in step 4.

## 2. Generate the upload key (on your own machine)

Play App Signing keeps the real signing key at Google. You hold only the **upload key**, which can be reset if lost. Generate it once and back it up in your password manager.

```sh
keytool -genkeypair -v -storetype PKCS12 \
  -keystore whumpo-upload.jks -alias whumpo-upload \
  -keyalg RSA -keysize 4096 -validity 9125 \
  -dname "CN=Whumpo upload key, O=Digifender LLC, C=US"
```

You are prompted for a password (use the same for store and key). Then:

```sh
# Print the upload certificate fingerprint (needed for Firebase, step 6)
keytool -list -v -keystore whumpo-upload.jks -alias whumpo-upload | grep SHA256
# Base64 for the GitHub secret, one line
base64 -w0 whumpo-upload.jks > whumpo-upload.jks.b64
```

Store `whumpo-upload.jks` and the password in your password manager. Delete the `.b64` file after step 3. `*.jks` and `*.p12` are gitignored; never `git add` them.

## 3. Add the GitHub secrets

Repository `Digifender-LLC/whumpo-website`, **Settings, Secrets and variables, Actions, New repository secret** (or `gh secret set NAME`):

| Secret | Value |
| --- | --- |
| `ANDROID_UPLOAD_KEYSTORE_BASE64` | contents of `whumpo-upload.jks.b64` |
| `ANDROID_UPLOAD_STORE_PASSWORD` | the keystore password |
| `ANDROID_UPLOAD_KEY_ALIAS` | `whumpo-upload` |
| `ANDROID_UPLOAD_KEY_PASSWORD` | the key password (same as the store password if you followed step 2) |

```sh
gh secret set ANDROID_UPLOAD_KEYSTORE_BASE64 --repo Digifender-LLC/whumpo-website < whumpo-upload.jks.b64
gh secret set ANDROID_UPLOAD_STORE_PASSWORD --repo Digifender-LLC/whumpo-website
gh secret set ANDROID_UPLOAD_KEY_ALIAS --repo Digifender-LLC/whumpo-website --body whumpo-upload
gh secret set ANDROID_UPLOAD_KEY_PASSWORD --repo Digifender-LLC/whumpo-website
```

(The two password commands prompt for the value so it stays out of shell history.) The job reads them only on a manual run. If any is missing it falls back to the debug key and says so in the run log.

## 4. Build the upload bundle

```sh
gh workflow run android.yml --repo Digifender-LLC/whumpo-website --ref main -f release_bundle=true
gh run watch --repo Digifender-LLC/whumpo-website            # pick the run
gh run download <run-id> --repo Digifender-LLC/whumpo-website -n whumpo-deployed-release-upload-signed-run<N>
```

Check: the artifact name contains `upload-signed` (not `DEBUGSIGNED-not-for-upload`) and the job's emulator smoke test is green. The artifact holds the `.aab` and `mapping.txt` (R8 mapping; already inside the bundle for Play).

## 5. Play App Signing enrolment and the first upload

1. Play Console, the app, **Test and release, Testing, Internal testing, Create new release**.
2. At **App signing** choose **Use Play App Signing** (the default for new apps) and continue. Google generates and holds the app signing key.
3. Upload the `.aab` from step 4. Name the release `0.1.0 (<versionCode>)`. Paste the release notes from [store-listing/listing.md](store-listing/listing.md).
4. Save, then **Next** and fix any Console warnings (see step 8 for the declarations Play requires first).
5. Afterwards: **Test and release, Setup, App signing**. You now see two certificates: the **App signing key** (Google's) and the **Upload key** (yours). Copy the **SHA-256** of the **App signing key**: you need it for step 6. Check the upload key's SHA-256 matches what you printed in step 2.

## 6. Publish `assetlinks.json` with the fingerprint

Passkeys and verified App Links both depend on this file. Use the **App signing key** fingerprint only, never the upload key and never a debug key. Full explanation: [assetlinks-setup.md](assetlinks-setup.md).

1. Copy `docs/android/assetlinks.template.json` and replace the placeholder with the colon-separated SHA-256 from step 5.
2. Ask for the site change: the file must be served at exactly `https://whumpo.com/.well-known/assetlinks.json` (HTTP 200, `Content-Type: application/json`, no redirect). That is a separate pull request outside `android/`; **you approve the production deploy**.
3. Give the server owner the passkey origin value for the WH-083 approved-origin config:

   ```sh
   echo "AB:CD:..." | tr -d ':' | xxd -r -p | basenc --base64url | tr -d '='
   ```

   The origin is `android:apk-key-hash:` followed by that output.
4. Verify:
   - `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://whumpo.com&relation=delegate_permission/common.get_login_creds` lists the package and fingerprint (repeat with `common.handle_all_urls`).
   - On a device with the Play-installed build: `adb shell pm get-app-links com.whumpo.android` shows `whumpo.com: verified`.

## 7. Firebase (push): project created, finish the key steps

The first internal build works without push: the app ships a no-op provider and Settings says notifications are not available yet. Details: [android-notifications.md](../android-notifications.md).

**Done by the owner:** Firebase project `whumpo`, ID `whumpo-18331`, on the free Spark plan. FCM HTTP v1 API enabled, sender ID `178300328353`. Google Analytics is off (keep it off; it would change the Data safety answers). Android apps `com.whumpo.android` and `com.whumpo.android.local` are registered with **no SHA fingerprints yet**.

**Still to do:**

1. Add SHA-256 fingerprints once the Play keys exist: **Project settings, Your apps, `com.whumpo.android`, Add fingerprint** for the **upload key** (step 2) and the **App signing key** (step 5). The `.local` app needs none for production.
2. Download `google-services.json` and keep it in your secret store. It is injected at build time (a CI secret file written to `android/androidApp/google-services.json`) and is **never committed**.
3. Create the FCM sender service-account key (**Project settings, Service accounts**; custom role with only `cloudmessaging.messages.create`) and store its JSON as the Worker secret for the FCM adapter (WH-086). Never in the repo.
4. Tell the agents "Firebase keys are ready": a follow-up work package wires `firebase-messaging` and the CI secret file. The Data safety form then needs the Device IDs row ([data-safety.md](store-listing/data-safety.md)).
5. Test token registration and a notification on a physical device (step 10, item 6).

## 8. Fill the Play Console declarations

Required before any track, including internal. Drafts to paste:

| Console page | Source |
| --- | --- |
| Main store listing: title, short and full description, graphics | [store-listing/listing.md](store-listing/listing.md); screenshots in [store-listing/screenshots/](store-listing/screenshots/README.md) |
| App content: Data safety | [store-listing/data-safety.md](store-listing/data-safety.md) |
| App content: Content rating | [store-listing/content-rating.md](store-listing/content-rating.md) |
| App content: Privacy policy URL, target audience (18+), ads (none), app access | Publish the privacy policy and a deletion-request page first. App access: see [reviewer-access.md](store-listing/reviewer-access.md); for internal and closed tracks you can say "invite-only; testers use their own passkeys" |
| App category and contact details | Business; your support email and the website |

## 9. Create the internal testing track and add testers

1. **Test and release, Testing, Internal testing, Testers tab, Create email list**: name `whumpo-internal`, add up to 100 Google-account emails (yours, the Pixel and Samsung owners).
2. Tick the list, **Save changes**.
3. Release from step 5 must be **Rolled out** (the review is short for internal).
4. Copy the **opt-in URL** (**Testers tab, How testers join, Copy link**). Each tester opens it on their phone signed into the Google account on the list, taps **Become a tester**, then installs from Play.
5. Testers also need a Whumpo invite and a passkey. Create the invite on the website as usual.

Internal testing is exempt from the 12-tester rule and does not need to wait for review of the store listing.

## 10. Physical-device evidence (WH-087 acceptance)

On a **Pixel** and a **Samsung** phone, installed from the internal track (not sideloaded):

1. Passkey sign-in.
2. Browser hand-off round trip and `pm get-app-links` shows `verified`.
3. A revoked-session case: revoke the device on the website, confirm the app returns to sign-in and shows no stale data.
4. Chat request, review and approve; photo add from the system picker.
5. Dark mode, 200% font size, TalkBack on the sign-in and Chat screens.
6. (After Firebase) token rotation, sign-out withdrawal and a private lock-screen notification.

Record the results in the WH-087 issue.

## 11. The 12-tester closed test (before production)

Needed because the account is personal and newer than November 13, 2023. Plan for at least **14 consecutive days** with **12 or more opted-in testers**; Play counts testers who stay opted in.

1. **Test and release, Testing, Closed testing, Create track** (name `closed-beta`). **Testers tab**: create a list `whumpo-closed` (or a Google Group) with at least 15 addresses, to leave a margin for drop-outs. Do not rely on exactly 12.
2. **Countries**: add the ones where the testers live.
3. **Create new release**, add the same signed bundle (a higher `versionCode` than the internal one is fine), release notes, **Rolled out**. Closed tracks go through Google review; expect up to several days the first time.
4. Send testers the opt-in link. Ask each to **install and keep the app installed**, and to open it at least a few times over the period.
5. Check **Dashboard, Testing requirements** in Console: it shows the opted-in count and the day counter. Day 1 starts when the 12th tester is opted in. If the count dips below 12 the clock may reset; top up the list.
6. After 14 days, **Apply for production access** on the Dashboard, answer the questions about testing (what you tested, feedback you acted on). Review takes a few days.
7. Production also needs the reviewer access note ([reviewer-access.md](store-listing/reviewer-access.md)): option D must be built first.

## Open items for you

- Decide the privacy policy and deletion-request URLs (the in-app links point at the draft policy).
- Confirm the AI provider terms for the Data safety "shared" answer ([data-safety.md](store-listing/data-safety.md#data-types)).
- Approve the production deploy of `assetlinks.json` and the passkey origin config.
- Choose whether to spend on a second environment for reviewer access (option D).
- Provide the 512x512 icon export and the 1024x500 feature graphic if you want them custom.
