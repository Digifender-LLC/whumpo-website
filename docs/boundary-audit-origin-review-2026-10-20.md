# WH-004 slice 4: route-specific Origin review (October 20, 2026)

**Static source read only. Not exhaustive. No tests, builds, tools or network calls were run. WH-004 stays open.** This is a read-only review on `main` at `802cd9d`. It checks where each state-changing (non-GET/HEAD) route enforces Origin or host, and which tests assert that check for that route. [`docs/boundary-audit.md`](boundary-audit.md) lists this as still open: "route-specific cross-origin tests for guest previews, contact messages, contact notifications and shared modules" ([boundary-audit.md:235](boundary-audit.md), [:247](boundary-audit.md)) and "route-specific Origin test for `modules/upload`" ([boundary-audit.md:251](boundary-audit.md)). No `src/`, `tests/`, schema, workflow, registry or roadmap file was changed.

When this document calls a route "tested", it means a test file contains an assertion line that sends that route a missing or foreign `Origin` and expects a refusal. Each of those lines was read. None was executed, so this document does not claim any of them passes today. When a route is called "untested", it means only that no such line turned up in the searches made for this review. Those searches were over `tests/` for `evil`, `attacker`, `foreign`, `elsewhere`, `Origin check`, `sec-fetch-site`, `noOrigin` and `origin:null`, plus a check of each matching helper's request path. Other assertions could exist under different wording.

## Method

1. Read the platform dispatcher [`src/index.ts`](../src/index.ts) end to end (`handle()`, `handleWorkspace()`, `fetch()`), plus the routers it calls before or after the gate: [`src/workspace-identity/http.ts`](../src/workspace-identity/http.ts), [`src/workspace-identity/protocol.ts`](../src/workspace-identity/protocol.ts), [`src/safety-case-http.ts`](../src/safety-case-http.ts), [`src/chat-interactions/http.ts`](../src/chat-interactions/http.ts) (method check only), [`src/support.ts`](../src/support.ts) (method dispatch only) and [`src/contact-page.ts`](../src/contact-page.ts).
2. Read the other Worker entry points and the Origin-relevant parts of their handlers: [`src/site-host.ts`](../src/site-host.ts), [`src/guest-previews/guest.ts`](../src/guest-previews/guest.ts), `publicBackend` in [`src/backend-publication.ts`](../src/backend-publication.ts), [`src/app-host.ts`](../src/app-host.ts), [`src/app-gateway.ts`](../src/app-gateway.ts) (`applicationGateway`) and the request check in [`src/runtime/worker.ts`](../src/runtime/worker.ts).
3. Domain handlers (`src/publications.ts`, `src/domain-hosting.ts`, `src/github-backups.ts`, `src/billing.ts` and the others) were **not** read for Origin logic. Every one of them is reached only through a dispatcher above, and none receives the request's `Origin` header from the dispatcher. The one exception found is `updateProfilePhoto`, which receives the whole `Request` ([src/index.ts:183](../src/index.ts)). It reads `if-match` and `content-type` ([src/profile.ts:39-42](../src/profile.ts)), and the global gate has already run before it is called. So Origin enforcement is decided at the dispatcher level. This review does not claim that no domain handler performs a redundant check.
4. Cross-checked against the registry's `origin` cells in [`docs/boundary-audit.json`](boundary-audit.json) and the CSRF row in [`docs/security-risk-actions.md:33`](security-risk-actions.md).

## Origin and host gates found

| Id | Gate | Location | Kind | Missing `Origin` | Foreign `Origin` |
| --- | --- | --- | --- | --- | --- |
| G0 | Platform host pin: outside `ENVIRONMENT=local`, any URL origin other than `https://whumpo.com` gets 404 before routing | [src/index.ts:663](../src/index.ts) | shared (Worker entry) | n/a (checks the URL, not the header) | n/a |
| G1 | Platform exact-Origin gate: every method except GET, HEAD and OPTIONS needs `Origin` equal to the request URL's origin | [src/index.ts:137-140](../src/index.ts), [:147](../src/index.ts) | shared middleware in `handle()`, before rate limit, operator router, session admission and `handleWorkspace()` ([:149-158](../src/index.ts)) | 403 JSON `{"error":"Origin check failed"}` (`sameOrigin` returns false for a `null` header, [:139](../src/index.ts)) | 403, same body |
| G2 | Identity router: POST only, with `Origin` and URL origin both equal to the configured origin | [src/workspace-identity/protocol.ts:15-21](../src/workspace-identity/protocol.ts), called first in [src/workspace-identity/http.ts:101](../src/workspace-identity/http.ts) and again by each ceremony, kit and recovery function (for example [src/workspace-identity/kits.ts:23](../src/workspace-identity/kits.ts), [src/workspace-identity/recovery.ts:17](../src/workspace-identity/recovery.ts)) | route-local to the identity prefix; it runs **before** G1 ([src/index.ts:144](../src/index.ts)) | 400 `invalid_identity_request` ([protocol.ts:5](../src/workspace-identity/protocol.ts), mapped at [http.ts:146-148](../src/workspace-identity/http.ts)) | 400, same body |
| G3 | Public contact page: a POST needs `Origin` equal to the URL origin | [src/contact-page.ts:23](../src/contact-page.ts) | route-local; it runs before G1 ([src/index.ts:665-666](../src/index.ts)) | 403 HTML page "Open the contact form before sending a message." ([contact-page.ts:48](../src/contact-page.ts)) | 403, same page |
| G4 | Visitor gateway: refuses `Sec-Fetch-Site: cross-site`, any foreign `Origin` on any method, and any POST without the exact visitor origin | [src/app-gateway.ts:64](../src/app-gateway.ts) (the origin is computed from the host at [:57](../src/app-gateway.ts), the host is required at [:59](../src/app-gateway.ts) and only GET/POST pass [:63](../src/app-gateway.ts)) | shared middleware for every gateway route; only the host and route matchers run before it | POST: 403 JSON `{"error":"Origin check failed"}`. GET without `Origin`: admitted unless `Sec-Fetch-Site` is `cross-site` | 403 on any method |
| G5 | Guest preview host: every non-root path is POST only and needs `Origin` equal to `https://preview.whumpo.site` (the URL origin in local mode) | [src/guest-previews/guest.ts:156-158](../src/guest-previews/guest.ts), origin constant [src/hosts.ts:12-13](../src/hosts.ts) | shared for the three guest POST paths | 403 JSON `{"error":"Origin check failed"}` | 403, same body |
| G6 | Site host method refusal: every serving route below the public backend is GET/HEAD only | [src/site-host.ts:30](../src/site-host.ts) | shared | 405 for every other method | 405 |
| — | Public stateless backend: **no Origin check, by design** (CORS without credentials) | [src/site-host.ts:28-29](../src/site-host.ts) then [src/backend-publication.ts:51-53](../src/backend-publication.ts) | route-local (OPTIONS 204, POST only, JSON only) | admitted | admitted |
| — | Runtime: only `POST /execute` | [src/runtime/worker.ts:72](../src/runtime/worker.ts) | service binding only ([boundary-audit.md:138](boundary-audit.md)) | n/a | n/a |

The registry anchors G1 as `if (!["GET", "HEAD", "OPTIONS"].includes(method) && !sameOrigin(request)) return error(403, "Origin check failed");` ([boundary-audit.json:1093](boundary-audit.json)). It also checks G4's position mechanically ([tests/boundary-audit.mjs:82](../tests/boundary-audit.mjs), [:84](../tests/boundary-audit.mjs)).

## Shared-gate evidence (applies to every route behind the gate)

- **G1, foreign Origin:** [tests/identity-http.mjs:79](../tests/identity-http.mjs). It sends `POST /api/connections/github/grant-reviews` with `origin:'https://elsewhere.invalid'` through `worker.fetch` and expects 403 (the local `handleIdentityRequest` there is an alias for `worker.fetch`, [tests/identity-http.mjs:13](../tests/identity-http.mjs)).
- **G1, missing Origin:** [tests/subscriptions.mjs:68](../tests/subscriptions.mjs). Three billing POSTs with no `Origin` get 403, and the same requests with the right `Origin` get 401. This runs with `ENVIRONMENT:'local'` ([:67](../tests/subscriptions.mjs)), so G0 is not exercised there.
- **G1 position:** [tests/boundary-audit.mjs](../tests/boundary-audit.mjs) reports a router moved ahead of the gate (registry anchor at [boundary-audit.json:1104](boundary-audit.json)).
- **G4:** [tests/boundary-visitor-gateway-isolation.mjs:35](../tests/boundary-visitor-gateway-isolation.mjs) refuses `Sec-Fetch-Site: cross-site` on `GET data`, and [:36](../tests/boundary-visitor-gateway-isolation.mjs) is the matching positive control (same-origin GET with no `Origin`).

## Route inventory: state-changing routes

"Gate" is the row in the table above. "Test" cites a line that sends a missing or foreign `Origin` to **this route**. "Gate only" means the route relies on the shared gate and no route-specific line turned up.

### Platform Worker, before G1 (`handle()` and `fetch()`)

| Route and method | Origin check | Kind | Missing / foreign Origin | Route-specific test |
| --- | --- | --- | --- | --- |
| `POST /api/auth/identity/v1/*` (signup, login, recovery, add, reauth, kit, enrollment, passkey removal, logout, state, config) | G2, [http.ts:101](../src/workspace-identity/http.ts) runs before rate limit, body read, cookie clearing ([:105-106](../src/workspace-identity/http.ts)) and the challenge burn ([:114](../src/workspace-identity/http.ts)) | route-local, one check for the whole prefix | 400 `invalid_identity_request` / 400 | Foreign: [tests/identity-http.mjs:47](../tests/identity-http.mjs) (`state` through the worker). [tests/identity-ceremonies.mjs:37](../tests/identity-ceremonies.mjs) calls `signupOptions` directly with a foreign `Origin`. Missing `Origin`: none found. The other actions share the same line-101 check, so they are not separately tested. |
| `POST /api/stripe/webhook` | none; dispatched before G1 ([index.ts:146](../src/index.ts)) | exempt (signed provider call; [boundary-audit.json:941-944](boundary-audit.json)) | admitted (signature is the authority) | n/a |
| `POST /contact/:id` | G3, [contact-page.ts:23](../src/contact-page.ts) | route-local | 403 HTML / 403 HTML | Foreign: [tests/contacts.mjs:31](../tests/contacts.mjs) (also asserts no Turnstile call). Missing: none found. |

### Platform Worker, behind G1 (operator router and `handleWorkspace()`)

Every row below is reached only after [src/index.ts:147](../src/index.ts), so a missing or foreign `Origin` gets **403 `Origin check failed`** before any rate limit, session read or handler runs. The table therefore lists only the dispatch line and the test status.

| Route and method | Dispatch | Route-specific test |
| --- | --- | --- |
| `POST /api/operator/safety-cases/v1/*` | [safety-case-http.ts:58-63](../src/safety-case-http.ts) via [index.ts:153](../src/index.ts) | Foreign: [tests/safety-case-operations.mjs:106](../tests/safety-case-operations.mjs) (`cases/read` through `m.worker.fetch`). The direct `handleSafetyCaseRequest` calls at [:43](../tests/safety-case-operations.mjs) skip G1 by construction. |
| `POST /api/support/v1/requests` | [index.ts:167-169](../src/index.ts), [support.ts:120](../src/support.ts) | Foreign: [tests/support-access.mjs:50](../tests/support-access.mjs) |
| `POST /api/support/v1/requests/:id/read` | [support.ts:123](../src/support.ts) | gate only |
| `PUT /api/onboarding` | [index.ts:174](../src/index.ts) | Foreign: [tests/onboarding-welcome.mjs:40](../tests/onboarding-welcome.mjs) (local origin) |
| `POST /api/onboarding/complete` | [index.ts:176](../src/index.ts) | gate only |
| `PATCH /api/profile` | [index.ts:179](../src/index.ts) | Foreign: [tests/profile.mjs:45](../tests/profile.mjs) |
| `PUT`, `DELETE /api/profile/photo` | [index.ts:183](../src/index.ts) | gate only |
| `POST /api/workspace/service-safety/reviews` | [index.ts:193](../src/index.ts) | gate only |
| `POST /api/workspace/service-safety/reviews/:kind/:id/confirm` | [index.ts:196](../src/index.ts) | Foreign: [tests/service-safety.mjs:43](../tests/service-safety.mjs) (backend kind) |
| `POST /api/workspace/site-safety/reviews` | [index.ts:215](../src/index.ts) | gate only |
| `POST /api/workspace/site-safety/reviews/:id/confirm` | [index.ts:218](../src/index.ts) | Foreign: [tests/site-safety.mjs:40](../tests/site-safety.mjs) |
| `POST /api/workspace/views/v1/mutate` | [index.ts:224](../src/index.ts) | gate only |
| `POST /api/workspace/views/v1/component`, `.../receipt` (reads sent as POST) | [index.ts:221](../src/index.ts), [:225](../src/index.ts) | gate only |
| `PUT /api/workspace/capacity` | [index.ts:228](../src/index.ts) | gate only |
| `PUT /api/cms/:p/wordpress/sources/:s` | [index.ts:235](../src/index.ts) | Foreign: [tests/cms-wordpress-api.mjs:32](../tests/cms-wordpress-api.mjs) |
| `POST /api/cms/:p/wordpress/sources/:s/import-reviews` | [index.ts:239](../src/index.ts) | Foreign: [tests/cms-owner-uploads.mjs:205](../tests/cms-owner-uploads.mjs) (path at [:204](../tests/cms-owner-uploads.mjs); this is part of the owner-deferred CMS suite, [boundary-audit.md:218](boundary-audit.md)) |
| `POST /api/cms-import-reviews/:id/confirm` | [index.ts:253](../src/index.ts) | Foreign: [tests/cms-wordpress-api.mjs:40](../tests/cms-wordpress-api.mjs) |
| `POST /api/cms/:p/content` | [index.ts:266-269](../src/index.ts) | Foreign: [tests/cms-deploy.mjs:63](../tests/cms-deploy.mjs), [tests/cms-structured-lifecycle.mjs:67](../tests/cms-structured-lifecycle.mjs) |
| `PATCH /api/cms/:p/content/:id` | [index.ts:266-269](../src/index.ts) | gate only |
| `PUT /api/cms/:p/media/uploads/:id` | [index.ts:277](../src/index.ts) | Foreign: [tests/cms-owner-uploads.mjs:217](../tests/cms-owner-uploads.mjs) |
| `POST /api/cms/setup-reviews` | [index.ts:289-293](../src/index.ts) | Foreign: [tests/cms-projects-http.mjs:18](../tests/cms-projects-http.mjs) |
| `POST /api/cms/setup-reviews/:id/confirm` | [index.ts:297](../src/index.ts) | gate only |
| `POST /api/backend-state-snapshots/:id/restore` | [index.ts:304-306](../src/index.ts) | Foreign: [tests/backend-http.mjs:41](../tests/backend-http.mjs) |
| `POST /api/projects/:id/backend-state` | [index.ts:312-315](../src/index.ts) | gate only (non-Origin cases at [tests/backend-http.mjs:27-28](../tests/backend-http.mjs)) |
| `POST /api/backend-state-reviews/:id/confirm` | [index.ts:321](../src/index.ts) | Foreign: [tests/backend-http.mjs:32](../tests/backend-http.mjs) |
| `POST /api/projects/:id/application-page` | [index.ts:326](../src/index.ts) | gate only |
| `POST /api/application-page-reviews/:id/confirm` | [index.ts:329](../src/index.ts) | Foreign: [tests/customer-app-journey.mjs:108](../tests/customer-app-journey.mjs) |
| `POST /api/projects/:id/application-access/invitations` | [index.ts:334-340](../src/index.ts) (G1 runs before `requireFreshWorkspace` at [:335](../src/index.ts)) | Foreign: [tests/app-auth.mjs:167](../tests/app-auth.mjs) |
| `POST .../invitations/:id/cancel` | [index.ts:341](../src/index.ts) | gate only |
| `POST .../visitors/:id/revoke` | [index.ts:342](../src/index.ts) | Foreign: [tests/app-auth.mjs:184](../tests/app-auth.mjs) (path at [:182](../tests/app-auth.mjs)) |
| `POST .../visitors/:id/erase` | [index.ts:338](../src/index.ts) | Foreign: [tests/customer-app-journey.mjs:142](../tests/customer-app-journey.mjs) |
| `POST /api/projects/:id/application` | [index.ts:349](../src/index.ts) | Foreign: [tests/app-activation-http.mjs:18](../tests/app-activation-http.mjs) |
| `POST /api/application-reviews/:id/confirm` | [index.ts:354](../src/index.ts) | Foreign: [tests/app-activation-http.mjs:23](../tests/app-activation-http.mjs) |
| `POST /api/projects/:id/backend-form` | [index.ts:359](../src/index.ts) | Foreign: [tests/backend-form-http.mjs:17](../tests/backend-form-http.mjs) |
| `POST /api/backend-form-reviews/:id/confirm` | [index.ts:364](../src/index.ts) | Foreign: [tests/backend-form-http.mjs:20](../tests/backend-form-http.mjs) |
| `POST /api/projects/:id/backend-publication` | [index.ts:369-372](../src/index.ts) | Foreign: [tests/backend-http.mjs:49](../tests/backend-http.mjs) |
| `POST /api/backend-publication-reviews/:id/confirm` | [index.ts:378](../src/index.ts) | Foreign: [tests/backend-http.mjs:53](../tests/backend-http.mjs) |
| `POST /api/projects/:id/backends` (import quarantine) | [index.ts:385-387](../src/index.ts) | Foreign: [tests/backend-http.mjs:16](../tests/backend-http.mjs) |
| `POST /api/projects/:id/backends/:v/test` (runs the backend) | [index.ts:385-387](../src/index.ts) | gate only |
| `POST /api/projects/:id/modules` (owner module operations, including `records.remove`, R6) | [index.ts:393](../src/index.ts) | gate only. [tests/shared-modules-compositions.mjs:250](../tests/shared-modules-compositions.mjs) covers the **visitor** `/modules` route, not this one |
| `POST /api/projects/:id/module-files/remove` | [index.ts:400](../src/index.ts) | gate only |
| `DELETE /api/contact-messages/:id` | [index.ts:414](../src/index.ts) | gate only (recorded at [boundary-audit.json:3770](boundary-audit.json)) |
| `PUT`, `DELETE /api/projects/:id/contact-notifications`; `POST .../verification` (sends email when delivery is active); `POST .../confirm` | [index.ts:420-423](../src/index.ts) | gate only (recorded at [boundary-audit.json:3770](boundary-audit.json)) |
| `POST /api/domain-hosting/review`; `POST /api/domain-hosting/:id/{confirm,refresh,disconnect}` | [index.ts:427-432](../src/index.ts) | Foreign, all four: [tests/boundary-provider-reviews.mjs:66-71](../tests/boundary-provider-reviews.mjs) |
| `PUT /api/projects/:id/files/:fid` (photo upload) | [index.ts:438](../src/index.ts) | gate only |
| `POST /api/projects/:id/guest-previews/prepare` | [index.ts:463](../src/index.ts) | gate only |
| `POST /api/projects/:id/guest-previews` (issue link) | [index.ts:470](../src/index.ts) | gate only (the 403s at [tests/guest-preview-bindings.mjs:90-97](../tests/guest-preview-bindings.mjs) are plan and feature refusals, not Origin refusals) |
| `DELETE /api/guest-previews/:id`; `POST .../revoke`; `PATCH`, `DELETE .../feedback/:c` | [index.ts:477-481](../src/index.ts) | gate only |
| `POST /api/billing/subscription/refresh`, `.../checkout`, `/api/billing/portal` | [index.ts:495-497](../src/index.ts) | Missing: [tests/subscriptions.mjs:68](../tests/subscriptions.mjs). Foreign: none found |
| `POST /api/projects/:id/health` | [index.ts:508](../src/index.ts) | gate only ("fixed-origin" in [tests/site-health.mjs:36](../tests/site-health.mjs) refers to the probe target, not the request header) |
| `POST /api/cloudflare/dns/review`, `.../routing-review`, `.../:id/confirm` | [index.ts:510-519](../src/index.ts) | gate only |
| `POST /api/connections/cloudflare/start` | [index.ts:525-527](../src/index.ts) | Foreign: [tests/cloudflare-connection.mjs:57](../tests/cloudflare-connection.mjs) |
| `POST /api/connections/cloudflare/disconnect` | [index.ts:535](../src/index.ts) | gate only |
| `POST /api/connections/github/start` | [index.ts:537-539](../src/index.ts) | gate only |
| `POST /api/connections/github/disconnect` | [index.ts:548](../src/index.ts) | gate only |
| `POST /api/connections/github/grant-reviews` | [index.ts:550-552](../src/index.ts) | Foreign: [tests/identity-http.mjs:79](../tests/identity-http.mjs) |
| `POST /api/connections/github/grant-reviews/:id/{confirm,cancel}` | [index.ts:554-558](../src/index.ts) | gate only |
| `POST /api/github/backups/review` | [index.ts:566-568](../src/index.ts) | Foreign: [tests/github-backups.mjs:67](../tests/github-backups.mjs) |
| `POST /api/github/backups/:id/confirm` | [index.ts:570-571](../src/index.ts) | gate only (the test at [:67](../tests/github-backups.mjs) checks a foreign **session** on confirm, not a foreign Origin) |
| `POST /api/chat/interactions/v1/*` | [index.ts:575](../src/index.ts), POST only at [chat-interactions/http.ts:25](../src/chat-interactions/http.ts) | gate only ("foreign origin" in [tests/chat-interaction-intake.mjs:176](../tests/chat-interaction-intake.mjs) refers to an origin **turn**, not the HTTP header) |
| `POST /api/chat/actions` | [index.ts:585-596](../src/index.ts) | Foreign: [tests/customer-site-journey.mjs:48](../tests/customer-site-journey.mjs) (typed `confirm` control; also asserts the site was not served) |
| `POST /api/chat` | [index.ts:585-596](../src/index.ts) | gate only |
| `POST /api/projects` | [index.ts:603-617](../src/index.ts) | gate only |
| `PATCH /api/projects/:id/details` | [index.ts:621](../src/index.ts) | gate only |

OPTIONS and HEAD skip G1 ([index.ts:147](../src/index.ts)). Every route above compares an exact mutating method, so neither OPTIONS nor HEAD reaches a mutator in the lines read. The only code that runs before a method comparison is a set of owner-scoped reads: the onboarding check ([:171](../src/index.ts)), the WordPress source ownership read ([:236](../src/index.ts)), the import-review read ([:250](../src/index.ts)) and the support dispatch, which matches only GET/POST ([support.ts:119-123](../src/support.ts)). This agrees with [boundary-audit.md:129](boundary-audit.md).

### Visitor application gateway (`whumpo-apps`, via `APP_HOST` from the sites Worker)

[src/app-host.ts](../src/app-host.ts) itself serves only GETs ([:12](../src/app-host.ts), [:14](../src/app-host.ts)) and passes everything else to `applicationGateway` ([:21](../src/app-host.ts)). Every POST below is reached only after G4 ([app-gateway.ts:64](../src/app-gateway.ts)), so a missing or foreign `Origin` gets **403 `Origin check failed`**.

| Route and method | Dispatch | Route-specific test |
| --- | --- | --- |
| `POST account/delete` | [app-gateway.ts:70-74](../src/app-gateway.ts) | Foreign: [tests/app-lifecycle.mjs:34](../tests/app-lifecycle.mjs) |
| `POST modules/upload` | [app-gateway.ts:88-100](../src/app-gateway.ts) | **gate only** (recorded at [boundary-audit.json:7741](boundary-audit.json) and [boundary-audit.md:251](boundary-audit.md)) |
| `POST modules` | [app-gateway.ts:101-131](../src/app-gateway.ts) | Foreign: [tests/shared-modules-compositions.mjs:250](../tests/shared-modules-compositions.mjs) (`records.view`, staff cookie; helper at [:122-123](../tests/shared-modules-compositions.mjs)) |
| `POST account/deletion-review` | [app-gateway.ts:138-141](../src/app-gateway.ts) | gate only |
| `POST auth/{signup,login,add}/{options,verify}` | [app-gateway.ts:142-153](../src/app-gateway.ts) | Missing and foreign: [tests/app-auth.mjs:135-136](../tests/app-auth.mjs) (`auth/login/options` only) |
| `POST auth/recover` | [app-gateway.ts:154-158](../src/app-gateway.ts) | gate only |
| `POST auth/logout` | [app-gateway.ts:159-161](../src/app-gateway.ts) | gate only |
| `POST data` (runs the program, writes visitor data) | [app-gateway.ts:172-178](../src/app-gateway.ts) | Foreign: [tests/customer-app-journey.mjs:115](../tests/customer-app-journey.mjs) (`origin:'https://whumpo.com'` sent to the visitor host) |

### Sites Worker (`whumpo-sites`)

| Route and method | Origin check | Kind | Missing / foreign Origin | Route-specific test |
| --- | --- | --- | --- | --- |
| `POST` guest host `/view` | G5, [guest.ts:158](../src/guest-previews/guest.ts) | shared for guest POSTs | 403 / 403 | Missing: [tests/guest-previews.mjs:126](../tests/guest-previews.mjs). Foreign (a project site origin): [tests/guest-previews.mjs:127](../tests/guest-previews.mjs) |
| `POST` guest host `/api/link` (link status; read) | G5 | shared | 403 / 403 | gate only |
| `POST` guest host `/api/feedback` (guest comment write) | G5, dispatch at [guest.ts:162](../src/guest-previews/guest.ts) | shared | 403 / 403 | **gate only** (matches [boundary-audit.md:235](boundary-audit.md)) |
| `POST` project host `/backend[/:publication]` | none ([site-host.ts:29](../src/site-host.ts); [backend-publication.ts:51-53](../src/backend-publication.ts)) | exempt by design ([security-risk-actions.md:45](security-risk-actions.md); [boundary-audit.json:6342-6344](boundary-audit.json)) | admitted / admitted | n/a |
| Any other non-GET/HEAD on a site, custom-domain or local host | G6, [site-host.ts:30](../src/site-host.ts) | shared | 405 / 405 | method refusal is checked mechanically by the registry ([boundary-audit.md:136](boundary-audit.md)); no Origin test is needed |

### Runtime (`whumpo-runtime`)

`POST /execute` ([src/runtime/worker.ts:72](../src/runtime/worker.ts)) is reachable only through service bindings ([boundary-audit.md:138](boundary-audit.md)), so a browser `Origin` does not apply.

## Concrete findings

**None.** In the files read, no state-changing route was found that a browser can reach with ambient credentials and without an Origin check:

- every non-GET/HEAD/OPTIONS platform route after [src/index.ts:147](../src/index.ts) is behind G1;
- the three platform paths before G1 each have their own check (identity G2, contact G3) or a signature (Stripe webhook);
- every visitor gateway POST is behind G4;
- every guest preview POST is behind G5;
- every other site-host method stops at G6;
- the one route with no Origin check, the public backend, reads no cookie and is documented as intentional ([security-risk-actions.md:45](security-risk-actions.md)).

This is a result of reading the source, not a proof. See the limits below.

## Evidence gaps (Origin is enforced; no route-specific test found)

These are test gaps, not control gaps. Each route relies on a shared gate whose position is checked mechanically. They are the concrete inputs for the open item at [boundary-audit.md:235](boundary-audit.md) and [:247](boundary-audit.md):

1. **Named as open in slice 3, still gate only:** owner guest-preview routes ([index.ts:463-481](../src/index.ts)) and guest `/api/feedback` ([guest.ts:162](../src/guest-previews/guest.ts)); `DELETE /api/contact-messages/:id` ([index.ts:414](../src/index.ts)); contact-notification PUT/DELETE/POST ([index.ts:420-423](../src/index.ts)); owner `POST /api/projects/:id/modules` and `module-files/remove` ([index.ts:393](../src/index.ts), [:400](../src/index.ts)); visitor `modules/upload` ([app-gateway.ts:88](../src/app-gateway.ts)).
2. **Higher-consequence routes this read also found to be gate only:** Cloudflare DNS review/confirm ([index.ts:510-519](../src/index.ts)); both provider disconnects and GitHub start ([index.ts:535](../src/index.ts), [:537](../src/index.ts), [:548](../src/index.ts)); GitHub grant confirm/cancel ([index.ts:554-558](../src/index.ts)); GitHub backup confirm ([index.ts:570-571](../src/index.ts)); backend test run ([index.ts:385-387](../src/index.ts)); application-access cancel ([index.ts:341](../src/index.ts)); visitor `auth/recover`, `auth/logout` and `account/deletion-review` ([app-gateway.ts:138-161](../src/app-gateway.ts)).
3. **Lower consequence, gate only:** onboarding complete, profile photo, service- and site-safety prepare, workspace views mutate, capacity, CMS PATCH content and setup confirm, backend-state prepare, application-page prepare, photo upload, health check, plain `POST /api/chat`, Chat interactions, `POST /api/projects`, project details, and support read receipts (lines in the inventory above).
4. **Missing-Origin variants:** apart from G1 ([tests/subscriptions.mjs:68](../tests/subscriptions.mjs)), G4 ([tests/app-auth.mjs:135](../tests/app-auth.mjs)) and G5 ([tests/guest-previews.mjs:126](../tests/guest-previews.mjs)), the tests found assert only a *foreign* `Origin`. No line was found that sends a request with **no** `Origin` to the identity router (G2) or the contact page (G3).
5. **G0 in tests:** every platform test helper that was read uses `https://whumpo.com` or a local origin with `ENVIRONMENT` set to `local` or `test`. No test asserting the G0 host pin ([index.ts:663](../src/index.ts)) was found in the searches above. This review did not check whether one exists under other wording.

## Unverified risks (not reproduced; none is claimed exploitable)

- **U1 GET OAuth callbacks change state without an Origin check.** `GET /api/connections/{cloudflare,github}/callback` finishes a pending connection, or cancels it when `error` is present ([index.ts:529-534](../src/index.ts), [:541-547](../src/index.ts)). GET skips G1 by design, and the session cookie is `SameSite=Lax` ([workspace-identity/http.ts:15-17](../src/workspace-identity/http.ts)), so a cross-site top-level navigation sends it. The registry treats the owner- and session-bound one-use `state` as the control ([boundary-audit.json:5258](boundary-audit.json), [:5488](boundary-audit.json)). An attacker would need the victim's current `state` value to cancel the victim's pending connection. That was not tested here. It belongs in the same class as R3 ([boundary-audit.md:214](boundary-audit.md)).
- **U2 G1 compares against the request URL, not a constant.** `sameOrigin` accepts any `Origin` equal to `new URL(request.url).origin` ([index.ts:137-140](../src/index.ts)). This is safe only because G0 pins the URL origin outside `ENVIRONMENT=local` ([index.ts:663](../src/index.ts)). If a deployment ever ran with `ENVIRONMENT=local`, or served the platform on a second hostname, G1 would accept that hostname's own origin. The live `ENVIRONMENT` value and routing were not inspected ([boundary-audit.md:50](boundary-audit.md)). G2, by contrast, pins a constant ([protocol.ts:18-19](../src/workspace-identity/protocol.ts)).
- **U3 G4 admits a GET with no `Origin` and no `Sec-Fetch-Site`** ([app-gateway.ts:64](../src/app-gateway.ts); positive control at [tests/boundary-visitor-gateway-isolation.mjs:36](../tests/boundary-visitor-gateway-isolation.mjs)). Every gateway GET read here is a read ([:76](../src/app-gateway.ts), [:134](../src/app-gateway.ts), [:166-169](../src/app-gateway.ts)), so this only matters with R16 (sibling `*.whumpo.site` same-site GETs, [boundary-audit.md:231](boundary-audit.md)).
- **U4 Public backend POSTs spend shared allowance cross-origin.** By design, any site can make a visitor's browser call a published backend. Each call reserves the per-client allowance and increments `backend_public_usage` ([backend-publication.ts:66](../src/backend-publication.ts), [:70](../src/backend-publication.ts)). This is an admission and fairness question already tracked under R11 and the public-exhaustion gate ([security-risk-actions.md:45](security-risk-actions.md)), not an Origin defect.
- **U5 Different status codes for the same refusal.** G2 returns 400 `invalid_identity_request` for a bad `Origin` ([protocol.ts:5](../src/workspace-identity/protocol.ts), [:19](../src/workspace-identity/protocol.ts)), G1, G4 and G5 return 403, and G3 returns an HTML 403. Any monitoring or client that counts Origin refusals by status would miss the identity ones. This is informational only.
- **U6 Some cited tests depend on fixtures that were not inspected.** [tests/backend-http.mjs](../tests/backend-http.mjs), [tests/app-activation-http.mjs](../tests/app-activation-http.mjs) and [tests/backend-form-http.mjs](../tests/backend-form-http.mjs) send requests with global `fetch` to `backendHttpFixture().base` ([tests/backend-http.mjs:3-4](../tests/backend-http.mjs)). This review did not read that fixture to confirm it serves the platform Worker's default export. Most of these suites are also outside verify profiles (R7, [boundary-audit.md:222](boundary-audit.md)).

## Limits

- Static reading only, at `802cd9d`. Nothing was executed: no test, `tools/boundary-audit.mjs`, build, Wrangler command or network request.
- Line numbers are from this read and will drift. The registry's `{file, contains}` anchors remain the maintained guard.
- Live Cloudflare routing, custom hostnames, `ENVIRONMENT` values and browser behaviour (which requests carry `Origin` or `Sec-Fetch-Site`) were not verified.
- Domain handlers were not audited for Origin logic (method step 3). Routes added after `802cd9d` are not covered.
- WH-004 stays open. Closing the gaps above needs focused regressions through each Worker's default export, which is outside this docs-only slice.
