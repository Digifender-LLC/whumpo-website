# Installable Whumpo workspace

**WH-119 — October 1, 2026.** Owner-requested phone home-screen installation; [issue #49](https://github.com/zemdregon/whumpo/issues/49). This is the existing React workspace as an installable web app. It does not complete the separate native Android roadmap or enable offline project editing, background sending or push notifications.

## Customer experience

- Launching the installed app opens `/workspace`, preserving Chat as the default view. Dashboard, workflow pages, Profile and Settings retain their existing navigation and mobile safe-area/keyboard behavior. Authentication and first-project onboarding still apply.
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
- `tests/dashboard-pwa-browser.mjs`: optional Playwright/Chromium acceptance against built assets, actual platform handlers and disposable local D1. Use `WHUMPO_PLAYWRIGHT` for an installed Playwright module and `WHUMPO_CHROMIUM` for a browser executable when not on the normal path. Creates an isolated temporary persistent browser profile because incognito cannot install PWAs. Checks browser-reported manifest/installability, active worker, 390px layout, explicit prompt dismissal, offline/reconnect, the four cache entries, and an unsent draft surviving worker activation. No real inference, publication or billing; fixture/profile removed at completion. Sanitized evidence/screenshots stay in ignored `.secrets/`.

Deployment and browser acceptance are recorded below after verification. No new Cloudflare service, binding, migration, dependency or paid plan is required. OS-level phone installation, mobile passkey enrollment and native app distribution are separate acceptance, not inferred from a manifest or emulator.

### Local acceptance — October 1, 2026

Type checks/build, focused PWA checks, build-snapshot and release-manifest checks, lazy-loading checks and the disposable Chromium/D1 journey passed. Chromium reported no manifest or installability errors. At 390px there was no horizontal overflow; installation dismissal, day/night browser theme, offline/reconnect, four public cache entries and an unsent draft surviving worker activation were verified. Screenshots were visually inspected. The first browser run correctly reported incognito installation as unavailable; the test now uses an isolated disposable persistent profile. No physical phone installation is claimed.

### Hosting compatibility correction

The first test deployment exposed Cloudflare's automatic `/pwa/offline.html` → `/pwa/offline` redirect. Because worker installation deliberately refuses redirects, its offline cache did not activate. The worker now fetches the canonical extensionless screen URL; the local browser fixture reproduces the redirect to prevent this regression. This changed no account or backend behavior. Final deployed acceptance requires the corrected worker to activate and pass the live offline/reconnect check.
