# Installable Whumpo workspace

**WH-119 — October 1, 2026.** Owner-requested phone home-screen installation; [issue #49](https://github.com/zemdregon/whumpo/issues/49). This is the existing React workspace as an installable web app. It does not complete the separate native Android roadmap or enable offline project editing, background sending or push notifications.

## Customer experience

- Launching the installed app opens `/workspace`, preserving Chat as the default view. Dashboard, workflow pages, Profile and Settings keep the current navigation (desktop sidebar; mobile bar of Chat, Dashboard, Your pages, Settings and Help, with the essentials and Profile in the Help sheet) and mobile safe-area/keyboard behavior. Fixed pages return to the page they were opened from, or to Dashboard when that is unknown. Authentication and first-project onboarding still apply.
- **Settings → Whumpo, a tap away** offers a browser install prompt when available. The prompt runs only after a click; dismissing it does not repeatedly prompt. Otherwise the card explains browser-menu installation. An installed standalone window shows its installed state.
- iPhone/iPad guidance uses Safari's Share → Add to Home Screen flow, including Open as Web App when shown. The existing 180px Apple touch icon is the supplied elephant mark. The manifest includes matching 192/512px icons; they use `purpose: any` to preserve the artwork rather than falsely claiming a mask-safe design.
- A failed workspace navigation displays a public branded offline page with a **Try again** action. Reconnecting reloads the requested workspace route. Saved server projects remain available after reconnection; unsent text retains only the existing [Chat recovery](unified-workspace-and-capacity.md) guarantees, not a new cross-device/offline sync promise.

The [manifest](../frontend/public/manifest.webmanifest) has a stable `/workspace` app identity, matching launch/scope, standalone display, name and theme colors. The landing page still has the manifest so visitors can install before signing in. Browser support and installation UI vary; see [MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable) (checked October 1, 2026). Physical phone/OS installation must be checked on the actual device; desktop mobile emulation is not that evidence.

## Cache and update contract

The [service worker](../frontend/public/workspace-sw.js) registers from production builds on secure contexts with scope `/workspace`. It controls future workspace requests and caches exactly four fixed public files: offline HTML, CSS, reconnect script and the 96px elephant image. Install fetches omit credentials and require successful, non-redirected responses of the expected type.

Workspace GET navigations use the network. Only a network failure returns the public offline screen. HTTP errors, including authentication or service errors, remain real network responses. API requests, authentication/provider callbacks, POSTs, other origins, customer sites and the public landing page never receive a synthetic app response. Network HTML, JS bundles, chat, previews, photos, profiles, tokens and account responses are never saved to Cache Storage. A missing offline cache returns a plain reconnect message rather than an account snapshot.

[Build preparation](../tools/build-pwa.mjs) hashes the worker and all four offline files into the cache version. Any changed offline bytes also change the worker script. Activation deletes only obsolete caches with Whumpo's exact dashboard prefix and claims future requests. It does not reload a page, clear application storage, retry a mutation or dismiss a form. There is no background sync or push handler. The new build helper is included in the [build fingerprint](../tools/build-snapshot.mjs) and release source archive so changed build behavior cannot evade release verification.

The worker/manifest use revalidation headers. Browsers can update the small worker without keeping an old app bundle installed indefinitely. Existing account authentication, authorization, recent-authentication, explicit reviews and session/draft cleanup remain the authority. Installing an app does not register a new passkey or grant access. See [MDN service worker lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers) (checked October 1, 2026).

## Verification

- `pnpm check` and `pnpm build`: frontend/backend type checks and the authoritative frontend build.
- `node tests/dashboard-pwa.mjs`: manifest/icon dimensions, fixed public cache, credentials omitted on install, API/callback/private-route exclusion, unchanged HTTP errors, offline/missing-cache recovery, own-cache cleanup and cache/worker rotation when an offline file changes.
- `node tests/build-snapshot.mjs`, `node tests/release-manifest.mjs`: build-helper drift protection and release recovery with the required helper retained. Synthetic files/provider driver only; no live operations or CMS functional test.
- `node tests/frontend-loading.mjs`: existing lazy workspace/control boundaries and complete asset graph.
- `tests/dashboard-pwa-browser.mjs`: optional Playwright/Chromium acceptance that builds the current frontend and versioned offline assets in a temporary directory, uses actual platform handlers and initializes the complete current schema in disposable local D1. Use `WHUMPO_PLAYWRIGHT` for an installed Playwright module and `WHUMPO_CHROMIUM` for a browser executable when not on the normal path. Creates an isolated temporary persistent browser profile because incognito cannot install PWAs. Checks browser-reported manifest/installability, active worker, 390px layout, explicit prompt dismissal, offline/reconnect, the four cache entries, an unsent draft surviving worker activation, and refusal of revoked identity after offline reconnect. Current synthetic owner setup uses the Secure/HttpOnly host cookie and exact welcome checkpoints; it does not prove signed enrollment. No real inference, publication or billing; fixture/profile removed at completion. Sanitized evidence/screenshots stay in ignored `.secrets/`.

Deployment and browser acceptance are recorded below after verification. No new Cloudflare service, binding, migration, dependency or paid plan is required. OS-level phone installation, mobile passkey enrollment and native app distribution are separate acceptance, not inferred from a manifest or emulator.

### Current identity revalidation — October 2, 2026 UTC

The updated disposable Chromium/D1 journey passes with current source and identity. Chromium reports zero manifest/installability errors. Day/night theme metadata, the mobile Settings/offline screens, four public-only cached resources, dismissed installation, offline recovery and update-preserved draft all pass. Cache comparisons use the exact resource set because concurrent installation does not define insertion order. Server-side revocation while offline returns to the current passkey sign-in gate on reconnect, without restoring Chat or creating a turn. The mobile screenshots were inspected. This is local browser evidence for #72; no remote cutover or physical OS installation occurred.

### Local acceptance — October 1, 2026

Type checks/build, focused PWA checks, build-snapshot and release-manifest checks, lazy-loading checks and the disposable Chromium/D1 journey passed. Chromium reported no manifest or installability errors. At 390px there was no horizontal overflow; installation dismissal, day/night browser theme, offline/reconnect, four public cache entries and an unsent draft surviving worker activation were verified. Screenshots were visually inspected. The first browser run correctly reported incognito installation as unavailable; the test now uses an isolated disposable persistent profile. No physical phone installation is claimed.

### Hosting compatibility correction

The first test deployment exposed Cloudflare's automatic `/pwa/offline.html` → `/pwa/offline` redirect. Because worker installation deliberately refuses redirects, its offline cache did not activate. The worker now fetches the canonical extensionless screen URL; the local browser fixture reproduces the redirect to prevent this regression. This changed no account or backend behavior. Final deployed acceptance requires the corrected worker to activate and pass the live offline/reconnect check.

### Test deployment accepted — 2026-10-01T16:55:49.916Z

Corrected release `e6edca89-4021-494c-a4b0-0875531e3132`, archived source `aa8b2c38b4c69e1a4dba76fb01b0fe0bea544778`, is deployed. All four service versions were reconciled; all 116 existing migrations remain applied with zero new/pending migrations and zero CMS registrations. The archive's dirty flag reflects only the existing untracked node_modules symlink; versioned source was committed.

| Worker | Active version |
| --- | --- |
| runtime | `aa2cbcf9-47ea-4cd3-bcf0-e1c69eccc84c` |
| apps | `cfec8388-0932-4511-b3dc-d4ff6a054af8` |
| sites | `21bd2ced-2db1-4d00-8f32-f56cc9116574` |
| platform | `59bb90b9-7d4e-4c33-953d-644558ef41c1` |

Readback matched all 20 selected deployed HTML/JS/CSS/brand/PWA assets byte-for-byte to the archive. The canonical offline page returns 200 without redirect; worker/manifest MIME and revalidation headers are correct. Fresh-profile Chromium at whumpo.com reports no manifest/installability errors, activates the worker, and stores exactly four public cache entries. Offline reload displays the branded screen; reconnect returns to the actual sign-in page. Health returns 200 and an anonymous session read returns 401 with no-store. Private evidence: .secrets/pwa-release-verification.json and .secrets/pwa-live-offline-mobile.png.

The earlier `01c93c6d-d69e-49ce-94b8-42a13c44720d` release did not pass offline activation because of the documented HTML redirect; this corrected release supersedes it. OS-level installation on physical iPhone/Android and mobile credential enrollment remain unverified; no browser-emulation result is labeled as device acceptance.

### Local revalidation — October 2026

Re-run on 2026-10-25 against `origin/main` commit `2e74dc7317f7c53587a55aee751a11e0f8eceb5e` (WH-119 re-acceptance, Node 24.21.0 / pnpm 11.19.0, installed Chromium from `~/.cache/ms-playwright`). No source, test or deploy file changed.

| Command | Result |
| --- | --- |
| `node tests/dashboard-pwa.mjs` | Exit 0 (needs `dist/` from `pnpm build`; the first run before any build failed with `ENOENT dist/manifest.webmanifest`, a missing prerequisite, not a defect). Prints one summary line; no per-assertion count is emitted (the file contains 21 `assert` call sites). |
| `node tests/dashboard-pwa-browser.mjs` | Exit 0. Prints one summary line; no per-assertion count is emitted. |
| `pnpm check` | Exit 0 |
| `pnpm build` | Exit 0 (existing chunk-size and ineffective-dynamic-import warnings only) |

What the browser test asserts, by item:

- **Manifest and installability:** Chromium's `Page.getAppManifest` URL is `/manifest.webmanifest` with zero manifest errors, and `Page.getInstallabilityErrors` is empty. The install prompt is a synthetic `beforeinstallprompt` event; only the explicit dismiss path is checked. No installation happens.
- **Offline and reconnect:** with the context offline, a reload shows the branded offline heading; going online and pressing Try again returns to Settings. After server-side revocation, an offline reload then reconnect lands on the passkey sign-in gate with no Chat textbox and no new chat turn.
- **Worker update keeps an unsent draft:** a draft is typed in Chat, the served worker bytes are changed, `registration.update()` is awaited until `controllerchange`, then the document marker, the draft text and the exact four-entry cache set are unchanged. The update is a synthetic byte append to the served worker, not a real new release.
- Also asserted: 390px width has no horizontal overflow, theme-color follows Day/Night, no page errors, and zero inference, publication or paid-invoice rows.

Not covered by these local runs:

- Deployed or test-domain checks (whumpo.com, Cloudflare redirect/header behavior beyond the local 307 mirror).
- Physical iPhone/Android devices and OS-level installation.
- Installed-PWA (standalone window) behavior; the installed state, launch URL and OS app-switcher behavior are not exercised.
- The browser test does not assert screenshots (they are written to ignored `.secrets/` and were not inspected in this run), the manifest field values (name, icons, scope) beyond zero errors, or the real Safari/Firefox engines.
