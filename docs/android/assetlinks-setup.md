# Digital Asset Links for the Android app: owner steps

**Status: implemented in code, awaiting the production deploy.** `https://whumpo.com/.well-known/assetlinks.json` is served by the platform Worker (`src/android-signing.ts`, route in `src/index.ts`, test `tests/android-assetlinks.mjs`, registered in the [boundary audit](../boundary-audit.md)). The server also allows the app's passkey origin. Deploy approval and the verification below are owner steps.

## Why it is needed

One file serves two features of the app:

- **Passkeys.** Credential Manager only lets `com.whumpo.android` use passkeys whose relying party is `whumpo.com` when the site lists the app with `delegate_permission/common.get_login_creds` ([prerequisites](https://developer.android.com/identity/credential-manager/prerequisites)). Without the file, sign-in with a passkey fails on the device.
- **The browser hand-off return.** Android only opens `https://whumpo.com/app/return` in the app, without a chooser, after verifying `delegate_permission/common.handle_all_urls` ([verified App Links](https://developer.android.com/training/app-links/verify-applinks)). Without it, the browser sign-in cannot return to the app.

The server also needs the same identity as an approved origin for passkey challenges (contract: "Origin binding for passkeys", WH-083). That is server configuration, not part of this file.

## Fingerprints and origin (live values)

- **App signing key** (Google's, signs what users install from Play), SHA-256 `40:8B:8F:8E:AA:DF:43:A9:5F:D6:CB:6A:ED:83:D6:E4:BD:8A:01:D3:E3:2F:88:1B:D9:2D:EE:31:F2:E9:DC:FE`. Listed first.
- **Upload key** (owner-held, created 2026-10-30), SHA-256 `26:39:DF:A4:76:DC:6A:A5:BE:7F:E4:76:24:47:A2:B9:22:2F:7C:D8:14:FD:B6:81:E6:5F:47:58:1E:73:C0:63`. Also listed, by owner decision, so builds signed with it before Play re-signing verify. It is not an installed identity once Play signs, so it is **not** an allowed passkey origin.
- **Passkey origin** accepted by the server (strict allowlist in `src/android-signing.ts`): `android:apk-key-hash:QIuPjqrfQ6lf1stq7YPW5L2KAdPjL4gb2S3uMfLp3P4`. RP ID stays `whumpo.com`.

Served body: the same two statements as [assetlinks.template.json](assetlinks.template.json), both relations on one target.

## Steps

1. **Enrol in Play App Signing** at the first upload and keep custody of the upload key. Google then signs the release with the app-signing key. Only that certificate belongs in the file. Never list a debug certificate: the contract says debug identities must not acquire release authority. (The owner approved also listing the upload key in the file.)
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
- Never add a debug fingerprint to the production file. If a debug build must test passkeys, use a non-production domain and a separate file.
- The app also accepts App Links only for `/app/return`. Activity and Projects deep links arrive with WP7 and need no change to this file, because `handle_all_urls` covers the whole domain.
