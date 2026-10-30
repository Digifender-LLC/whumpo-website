# Digital Asset Links for the Android app: owner steps

**Status, October 29, 2026: staged, not published.** The repository holds [`assetlinks.template.json`](assetlinks.template.json) with a placeholder. Nothing was added to the whumpo.com site, no route was created and no signing identity or fingerprint was handled. Publishing on production is an owner task ([platform ADR, owner tasks 3 and 4](../android-app-platform.md#owner-tasks)).

## Why it is needed

One file serves two features of the app:

- **Passkeys.** Credential Manager only lets `com.whumpo.android` use passkeys whose relying party is `whumpo.com` when the site lists the app with `delegate_permission/common.get_login_creds` ([prerequisites](https://developer.android.com/identity/credential-manager/prerequisites)). Without the file, sign-in with a passkey fails on the device.
- **The browser hand-off return.** Android only opens `https://whumpo.com/app/return` in the app, without a chooser, after verifying `delegate_permission/common.handle_all_urls` ([verified App Links](https://developer.android.com/training/app-links/verify-applinks)). Without it, the browser sign-in cannot return to the app.

The server also needs the same identity as an approved origin for passkey challenges (contract: "Origin binding for passkeys", WH-083). That is server configuration, not part of this file.

## Known fingerprints

- **Upload key** (owner-held, created 2026-10-30): SHA-256 `26:39:DF:A4:76:DC:6A:A5:BE:7F:E4:76:24:47:A2:B9:22:2F:7C:D8:14:FD:B6:81:E6:5F:47:58:1E:73:C0:63`, SHA-1 `E3:59:40:EB:F8:F0:F0:07:8B:B0:D9:8E:C0:A8:22:27:15:56:21:46`. Used for Firebase and to verify bundles. **Never put it in `assetlinks.json`.**
- **App signing key** (Google's): after first upload. Only this one goes in the file.

## Steps

1. **Enrol in Play App Signing** at the first upload and keep custody of the upload key. Google then signs the release with the app-signing key. Only that certificate belongs in the file. Never list a debug or upload certificate: the contract says debug identities must not acquire release authority.
2. **Copy the app-signing certificate SHA-256 fingerprint.** Play Console, the app, Test and release, Setup, App signing, "App signing key certificate", "SHA-256 certificate fingerprint". It looks like `AB:CD:...` (32 pairs).
3. **Fill the template.** Copy `assetlinks.template.json` and replace the placeholder string with that fingerprint. The package name `com.whumpo.android` is final (Q-005). The `local` build flavor (`com.whumpo.android.local`) is not listed and has no App Links or passkey authority on production.
4. **Convert the fingerprint for the server's approved origin.** The passkey origin for an Android app is `android:apk-key-hash:` followed by the base64url (no padding) SHA-256 of the certificate:

   ```sh
   echo "AB:CD:..." | tr -d ':' | xxd -r -p | basenc --base64url | tr -d '='
   ```

   Give the result to whoever sets the WH-083 approved-origin configuration.
5. **Publish the file** at exactly `https://whumpo.com/.well-known/assetlinks.json`. Requirements: HTTP 200, `Content-Type: application/json`, no redirect, no authentication, reachable by Google's crawler. The site needs a route or static asset for it, which is a change outside `android/` and `docs/android*`, so it is a separate pull request. **The owner approves the production deploy.**
6. **Verify.**
   - Google's API: `https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://whumpo.com&relation=delegate_permission/common.handle_all_urls` should list the package and fingerprint (repeat with `common.get_login_creds`).
   - On a device with the Play-installed build: `adb shell pm get-app-links com.whumpo.android` should show `whumpo.com: verified`. To retry: `adb shell pm verify-app-links --re-verify com.whumpo.android`.
7. **Run the device evidence** (WH-087): passkey sign-in, the browser hand-off round trip, and a revoked-session case, on a physical Pixel and a Samsung phone.

## Notes

- Changing the signing identity (for example after a key reset) means updating this file and the server's approved origin together.
- Add a fingerprint to the production file only for the release identity. If a debug build must test passkeys, use a non-production domain and a separate file.
- The app also accepts App Links only for `/app/return`. Activity and Projects deep links arrive with WP7 and need no change to this file, because `handle_all_urls` covers the whole domain.
