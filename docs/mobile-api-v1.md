# Native `/api/mobile/v1` contract

**Current contract — October 7, 2026.** WH-081 froze this contract October 4. WH-082 delivered the Android shell; WH-083 now implements the nine identity/config routes below, the shared Android session and passkey authority, cookie-authenticated browser completion, PKCE exchange and configured Digital Asset Links in source. WH-084 now implements the workspace/Chat/history, exact review and bounded information-form server adapters in source ([workspace evidence](android-workspace.md)); photo and push operations remain **planned**. Runtime identity evidence is in [android-identity](android-identity.md); no deployed mobile route, approved signing association, physical-device passkey or native customer acceptance is claimed. The [offline reference](../tools/prototypes/mobile-v1.mjs) and [synthetic fixtures](../tests/fixtures/mobile-v1/) remain contract checks; [mobile-identity](../tests/mobile-identity.mjs) exercises the real Worker and database handlers.

**Current build-2 amendment:** `GET /session` returns `account:{id,label}`. `id` is the opaque authoritative account UUID and is the sole account key for protected local data; a masked email label is never an identity key. The account-key amendment first shipped with build 2. The current default and hard minimum floor is build 3. This is a direct current-contract change, with no older-client adapter.

**Current build-3 amendment:** exact reviews include the complete application-source artifact described below, application restore requires fresh authentication, and Activity IDs are bounded opaque ASCII keys (up to 80 characters, `A–Z`, `a–z`, digits, `:`, `_`, `-`) because existing receipt writers prefix their IDs. These are direct current shapes; the runtime cannot lower its build-3 floor via configuration.

Whumpo is current-version-only ([policy](current-version-policy.md)): one contract version, no old DTOs, no compatibility adapter, no browser downgrade. Anything outside this document is not a v1 operation. A change to a frozen shape requires a reviewed amendment here, fixtures, and a minimum-build bump.

## Principles

1. **A thin transport over existing domain handlers.** Each operation reuses the handler named in the [operation table](#operations); `new` marks the only genuinely new adapters. There is no proxy into `/api/*`, no raw Chat command string and no caller-supplied URL. Existing handlers keep ownership, quota, review and feature-admission checks.
2. **Native authority is a bearer session, nothing else.** A package name, user agent, `Whumpo-Client` header or absent `Origin` grants nothing. Cookie sessions never cross: a Whumpo cookie on a mobile route is refused, and a bearer is refused on every non-mobile route. The browser's `Origin` check on `/api/*` is unchanged.
3. **Server-issued typed metadata is the only source of approval.** The client enables a control only when the server sent it for a current review and the client declared the capability. Text, push arrival and model prose never create approval.
4. **Reads are cheap and authoritative; writes are keyed.** Every durable write carries a client-generated ID. A lost reply is resolved by reading, never by guessing or blind resend.
5. **Strict admission.** Missing or unsupported versions, fields, controls, field types or bindings return `client_update_required` or a closed validation error, never a reduced experience.

## Transport

- Base `https://whumpo.com/api/mobile/v1` (HTTPS only; `local` mode may use the documented loopback origin). Responses are `application/json; charset=utf-8` with `cache-control: no-store`, `x-content-type-options: nosniff` and `referrer-policy: no-referrer`, except photo bytes (`image/jpeg`, `private, no-store`).
- JSON requests are UTF-8, at most 16 KiB (interaction routes 32 KiB, matching [WH-105](chat-interactions.md)). Unknown or missing keys are rejected. Photo upload is the only binary request: `image/jpeg`, at most 1 MiB.
- Rate limits reuse the platform limiters (per client address) plus a per-session limit; exceeding returns `429 rate_limited` with `retryAfterSeconds`.
- Every success body carries `"version": 1`. Dates are ISO-8601 UTC. Resource IDs are lowercase UUIDs; Activity IDs use the bounded opaque key above. Server cursors are opaque, bound to owner/route/search, and never confer authority.

### Required headers

| Header | Value | Rule |
| --- | --- | --- |
| `Whumpo-Client` | Compact ASCII JSON, at most 4096 bytes: `{"contract":1,"build":<versionCode>,"platform":"android","controls":[...],"interaction":{"versions":[1],"fieldTypes":[...],"bindings":[...]}}` | Admission and capability declaration only. `contract` must equal `1`, `build` must be at least the server's `minimumBuild`, `interaction.versions` must be exactly `[1]`. Any other value is `426 client_update_required`; malformed or unknown keys are `400`. Present on every request, including anonymous ones. |
| `Authorization` | `Bearer <64 lowercase hex>` | Required on every non-anonymous route, refused on anonymous ones. |
| `Cookie` | none | Presence is `400 invalid_request`. |

`GET /config` is the only route a below-minimum build may still call to learn `minimumBuild`; a wrong `contract` is refused there too.

Declared `controls` are exactly the [admitted capabilities](#native-review-controls) the build implements. Declared `interaction` capabilities must be a subset of the native admission set (below) and must equal what the build renders. The server then issues `canApprove:true` only for a control whose capability is declared, and `interaction/read` rejects any definition needing something undeclared.

## Auth and session model

**Implemented in source:** `identity_sessions`, `resolveIdentity` and login/reauthentication challenges distinguish `web` and `android` in the existing shared identity tables ([authority](../src/workspace-identity/authority.ts), [ceremonies](../src/workspace-identity/ceremonies.ts)). Restricted enrollment/recovery grants remain web-only. Native issuance is unavailable until the approved package and signing-certificate configuration is present.

- **Issue.** A native session exists only after (a) a Credential Manager passkey assertion for an `ready` account, or (b) a PKCE-bound handoff exchange for an account whose browser enrollment/recovery completed. Native never receives an enrollment or recovery grant. `session/login/verify` for an `enrolling` or `recovering` account issues nothing and returns `403 identity_incomplete` with `next:"browser"`.
- **Token.** 256-bit random, stored only as a hash, bound to the account, authority epoch, policy version 1, `client:'android'`, authenticating credential and **actual** passkey verification time. It travels only in `Authorization`. It is held in Android Keystore-protected app-private storage, excluded from backups, logs, URLs, model context and WebViews, and never copied into a browser cookie or query string.
- **Origin binding for passkeys.** The challenge records `client:'android'` and the approved package signing identity (`android:apk-key-hash:...`) from server configuration; RP ID stays `whumpo.com`. Verification requires user verification, the stored credential and counter, and the exact bound identity. Debug identities never acquire release authority. Digital Asset Links for the approved identity are served by `whumpo.com`.
- **Lifetime.** Seven-day absolute expiry; no refresh endpoint and no silent renewal. An expired or revoked token is `401 proof_required` with `proof:"signin"`; the owner signs in again. Challenges last five minutes and are single-use; invalid verification consumes them.
- **Freshness.** Sensitive controls need a passkey verified within ten minutes. `session/reauth/*` runs a new assertion and moves `freshUntil`; it never extends `expiresAt`. A handoff exchange and the recovery-commit proof create **no** freshness. The `fresh_passkey` form of `proof_required` tells the app to reauthenticate and retry with the same `requestId`.
- **Revocation.** Logout, sign-out-everywhere, credential removal, ordinary kit rotation and recovery delete the session or bump the account authority epoch in the same guarded statements as the web contract ([identity](workspace-identity.md#authority-and-persistent-state)). Each request resolves current authority; each write repeats the epoch/stage/expiry predicate inside its committing statement, so a request admitted before revocation fails its later commit. A revoked app clears local private state on the first `401`, and a retained retry waits for the owner to authenticate again. Push registration is withdrawn server-side at the same moment.
- **Gates.** Mobile routes require `stage:'ready'` (`403 identity_incomplete` otherwise) and a completed welcome (`409 onboarding_required` on every workspace route except `GET /bootstrap`, `GET /session` and `POST /session/logout`).
- **Handoff.** `session/handoff/start` records `purpose`, `state`, an S256 `codeChallenge` and the only allowed return URI `https://whumpo.com/app/return` (a verified App Link; no query, fragment, port, custom scheme or other host). The browser returns to the trusted identity flow at `browserPath`; only after the account is `ready` (two verified passkeys, saved kit, completed recovery where applicable) does the browser issue a one-time code (sixty seconds; the handoff itself five minutes). The code is sent to the app only through the verified App Link, never a session, key or provider credential. The App Link query contains exactly `handoffId` and `code`; the app checks its persisted initiating handoff ID and supplies the original local `state` and verifier during exchange. The server stores only the state hash. The browser first binds and displays the current account through `POST /api/mobile-handoff/v1/read`, then an explicit confirmation calls `/complete`; both require the web cookie and exact Origin. A subsequent account/session switch is refused. `session/handoff/exchange` requires the matching `handoffId`, `state` and the app-held verifier, rechecks stage, epoch and the source browser session **at consumption**, and mints a native session that expires no later than that source session and carries its original proof time. Replay, wrong state or verifier, wrong redirect, expiry, source revocation or a changed epoch deny with no session. Authenticated browser completion is implemented at `/workspace/native/{browserToken}` and the two `/api/mobile-handoff/v1/*` routes outside `/api/mobile`; it uses the existing web identity flow and never issues a restricted native grant.
- **Credentials and recovery stay in the browser.** Adding or removing passkeys, recovery-kit handling, lost-key recovery, signup, invitation, eligibility and Turnstile open in the system browser; the app starts a handoff and waits for the return.
- **Custom Tab preview** uses the browser session. The app never injects its bearer into a browser. A signed-out browser shows normal sign-in and returns to the allowlisted path. Paths come from the server and must match the preview allowlist (below); the app composes the URL with its constant host.

## Operations

All paths are relative to `/api/mobile/v1`. Fixtures: [operations.json](../tests/fixtures/mobile-v1/operations.json) has one valid pair per row. "Idempotency" is the key that makes a retry safe.

### Identity and session (WH-083 — implemented in source)

| Operation | Auth | Request / response | Reuses | Idempotency |
| --- | --- | --- | --- | --- |
| `GET /config` | none | `minimumBuild`, `rpId:"whumpo.com"`, `browserReturn` | **new**: minimum-build and RP configuration | none |
| `POST /session/login/options` | none | `{version}` → `challengeId`, `expiresAt`, WebAuthn `options` | `loginOptions` | none (mints one challenge) |
| `POST /session/login/verify` | none | `{version,challengeId,credential}` → `session{token,expiresAt,freshUntil}` | `loginVerify` | challenge is single use |
| `POST /session/handoff/start` | none | `{version,purpose,state,codeChallenge,codeChallengeMethod:"S256",redirectUri}` → `handoffId`, `browserPath`, `expiresAt` | **new**: native handoff over the shared identity flow | none |
| `POST /session/handoff/exchange` | none | `{version,handoffId,code,state,codeVerifier}` → `session` | **new**: one-time code exchange | code is single use |
| `POST /session/reauth/options` | bearer | challenge for the current account | `reauthenticationOptions` | none |
| `POST /session/reauth/verify` | bearer | `{version,challengeId,credential}` → `session{expiresAt,freshUntil}` | `reauthenticationVerify` | challenge is single use |
| `GET /session` | bearer | `session{expiresAt,freshUntil}`, `account{id,label}` (opaque account UUID and masked address, never the raw email) | `resolveIdentity` | none |
| `POST /session/logout` | bearer | `{version}` → `{signedOut:true}`; the app clears local state even on `401` | identity `logout` | natural |

### Workspace, Chat and reviews (WH-084 — server implemented in source)

| Operation | Auth | Request / response | Reuses | Idempotency |
| --- | --- | --- | --- | --- |
| `GET /bootstrap` | bearer | `onboarding{complete,browserPath}`, `chat{revision,mode}`, `projectCount`, `pendingReviewCount`; the first call after sign-in | `onboardingComplete`, `readChat` | none |
| `GET /chat` | bearer | `?limit=1..50&cursor&q` → `revision`, `mode`, `items[turn]` oldest-first, `nextCursor` for older turns | `readChat`, `chatHistory` | none |
| `GET /chat/turns/{turnId}` | bearer | `{version,turn}`; the readback after a lost reply | `readSavedChatTurn` | none |
| `POST /chat/messages` | bearer | `{version,requestId,expectedRevision,content(1..1000)}` → `accepted`, `revision`, `turnStatus` | `sendConversation` | `requestId` is the turn ID |
| `GET /reviews` | bearer | up to five pending exact reviews with server-issued control metadata | `readWorkspaceReviews` | none |
| `POST /reviews/confirm` | bearer | `{version,requestId,expectedRevision,control}` → as `chat/messages` | `sendChatControl`, `chatControl` | `requestId` |
| `POST /interactions/list` | bearer | WH-105 payload | interaction `list` | none |
| `POST /interactions/read` | bearer | `{version,interactionId,client}`; `client` must equal the header capability | interaction `read` + `requireCurrentClient` | none |
| `POST /interactions/resources` | bearer | WH-105 payload | interaction `resources` | none |
| `POST /interactions/mutate` | bearer | WH-105 mutation: `save-draft`, `submit`, `cancel` | interaction `mutate` | `requestId` |
| `POST /interactions/receipt` | bearer | `{version,requestId}` readback | interaction `receipt` | none |
| `POST /interactions/continue` | bearer | `{version,submissionId,expectedChatRevision}` | interaction `continue` | `submissionId` |
| `POST /interactions/stop` | bearer | `{version,submissionId}` | interaction `stop` | `submissionId` |
| `POST /interactions/reconcile` | bearer | `{version,submissionId}`; resolves an unknown continuation | interaction `reconcile` | `submissionId` |
| `GET /projects` | bearer | `?limit&cursor` → `items[project]` | `project_service_status` read | none |
| `GET /projects/{projectId}` | bearer | `{project}`; foreign IDs are `404 not_found` | same + `readProjectDetails` | none |
| `GET /projects/{projectId}/versions` | bearer | `?limit<=25` → versions with allowlisted preview paths | `site_versions` read | none |
| `GET /activity` | bearer | `?limit&cursor` → owned operation records | `activity_events` read | none |

The interaction operations are thin authenticated aliases for the frozen [WH-105/WH-106 payloads](chat-interactions.md#wire-objects-and-digest) and return their existing error vocabulary wrapped in the mobile error envelope. The native admission set is bounded:

- **Field types:** `text`, `long-text`, `choice`, `multi-choice`, `boolean`, `number`, `date`, `datetime`, `resource`. `attachment` waits for WH-085.
- **Bindings:** `answer.value@1`, `interaction.answers@1`, `owned.projects@1`, `site.content@1`, `agent.task-continue@1`, `site.content-prepare@1`. Photo, display, view, connection, comparison and preview bindings are excluded.
- A definition needing anything else returns `426 client_update_required`. There is no simplified form, text projection or browser downgrade. `canApprove` is always false for generic forms.

### Photos (WH-085)

| Operation | Auth | Request / response | Reuses | Idempotency |
| --- | --- | --- | --- | --- |
| `GET /projects/{projectId}/photos` | bearer | `items[photo{id,name,width,height,size,status,safetyStatus}]` | `listPhotos` | none |
| `PUT /projects/{projectId}/photos/{uploadId}` | bearer | JPEG body ≤ 1 MiB, `X-Photo-Name` (URL-encoded, 1–100 characters) → `photo` | `uploadPhoto` | `uploadId`; same ID with different bytes, name or project is `409 request_conflict` |
| `GET /projects/{projectId}/photos/{uploadId}` | bearer | `photo`; the upload readback | `readPhotoUpload` | none |
| `GET /photos/{photoId}` | bearer | JPEG bytes for approved, owned media only | `readPhoto` | none |

Preparation follows the [photo contract](photos.md): at most 10 MiB input, orientation-correct resize within 1600 x 1600, baseline JPEG within 1 MiB; the exact prepared bytes, name and ID persist for retry. `status:"ready"` with `safetyStatus:"pending"` or `"blocked"` is never rendered as usable media. The [safety gates](photos.md) are unchanged; Android receives no bucket credential.

### Push (WH-086)

| Operation | Auth | Request / response | Reuses | Idempotency |
| --- | --- | --- | --- | --- |
| `PUT /devices/current` | bearer | `{version,fcmRegistrationToken,notificationsEnabled}` → `deviceId`, `preferences` | **new**: owner/device registration | natural (one registration per session) |
| `DELETE /devices/current` | bearer | → `{removed:true}` | **new**: withdrawal | natural |
| `GET /events/{eventId}` | bearer | `event{kind,destination,state}`; `destination` is `null` and `state:"unavailable"` for a deleted, expired or foreign target | **new**: readback from committed receipts | none |

The FCM data payload is exactly `{"v":"1","eventId":<uuid>,"kind":"review_pending"|"operation_completed"|"attention_required"}`. It carries no project name, message text, source, photo or credential; lock-screen copy is generic. A registration token is a delivery address, not authentication, and is bound to the current session; logout, revocation and account closure remove it. Receiving or opening a notification only triggers an authenticated read; it never sends, approves or retries anything.

## Native review controls

Four controls are admitted. Each is the **exact** `ChatControl` shape from [`src/chat-controls.ts`](../src/chat-controls.ts); the server revalidates it through `chatControl`, so a native client cannot reach any other control or a raw command string.

| Capability | Wire control | Fresh passkey | Journey |
| --- | --- | --- | --- |
| `specification.apply` | `{type:"specificationApply",reviewId,proposalDigest,expectedRevision}` | required | Save the exact private website version prepared from a content brief |
| `site.confirm` | `{type:"confirm",kind:"site",reviewId}` | no | Publish the reviewed website version |
| `application.confirm` | `{type:"confirm",kind:"application",reviewId}` | no | Activate the reviewed bounded application change |
| `app.restore` | `{type:"appRestore",projectId,reviewId,confirmation:"RESTORE"}` | required | Restore reviewed application data |

A review sent to the app is `{kind,reviewId,project,state,expiresAt,canApprove,control,requiresFreshPasskey,disclosure{title,lines},preview,artifact,unavailableReason}`. Invariants (checked offline): `canApprove` implies `state:"pending"`, a `control` whose type matches `kind` and `reviewId`, and no `unavailableReason`; otherwise `control` is `null`. A review whose capability the build did not declare arrives with `canApprove:false` and `unavailableReason:"client_update_required"`; an unknown `kind` makes the client show update-required with no enabled control. Expired, stale, foreign or withdrawn reviews expose no control. The [disclosure](../tests/fixtures/mobile-v1/reviews.json) lines are server-written exact-effect text; the app shows them before confirmation and does not synthesize them.

Application enable reviews include `artifact:{kind:"application-source",source,digest}` with the complete, byte-exact saved program (at most 8192 UTF-8 bytes) and its verified SHA-256. Other reviews carry `artifact:null`. The native client must show that code and every disclosure line before advertising or enabling `application.confirm`; it cannot truncate code or infer approval from a prose summary. Application disable and site unpublish remain outside these native controls. Application data restore requires the same ten-minute actual passkey proof as the shared browser handler.

Preview `path` values are only `/api/site-versions/{id}/preview`, `/api/specification-reviews/{id}/preview|diff` and `/api/publication-reviews/{id}/diff`, opened in an authenticated Custom Tab. Any other path is rejected by the client. Current server preview paths require an existing web session and otherwise return 401 JSON; the planned sign-in/allowlisted-return browser entry still needs implementation and an unsigned-browser journey test before native review acceptance.

Everything else stays web-only: provider-grant revocation, DNS/domain proof, GitHub backup, CMS, backend/application publication reviews beyond the above, version/photo deletion, unpublish and take-down shortcuts, and review-detail/shortcut controls. A native request naming them returns `400 unsupported_control`.

## Pagination, revisions and idempotency

- **Lists** use `limit` (1–50 default 25; versions 1–25) and an opaque `cursor`; responses carry `nextCursor` or `null`. Cursors are bound to the account and endpoint; a foreign or malformed cursor is `400 invalid_cursor`. Chat pages are oldest-first within a page, with `nextCursor` reaching older turns. Today's bounded sources (100 projects/activity, 25 versions) are paged by the adapter.
- **Chat revision** is the monotonic workspace revision. Writes send `expectedRevision`; a mismatch is `409 stale_revision` with `currentRevision` and the app refreshes before offering a new action. A pending prior reply is `409 chat_busy`.
- **Same `requestId`, same canonical payload** reads the committed result (no second effect). **Same ID, different payload** is `409 request_conflict`. A reply lost in flight is resolved with `GET /chat/turns/{requestId}` (`404 not_found` means nothing committed), `interactions/receipt` or the photo status route, never by regenerating an ID. The app does not auto-resend on reconnect, launch, notification or process restart; a retry is an explicit owner action that reuses the original payload.
- A write result reports acceptance, not downstream success. `turnStatus:"pending"` and `"uncertain"` are shown honestly and resolved by reads.

## Errors

Every error is `{version:1,error:{code,message,...}}`. Workspace/identity errors use the fixed status below; interaction errors additionally preserve the WH-105 code/status and optional `fieldId`, as specified above. messages are plain and carry no stack, SQL, provider text or internal identifiers ([fixtures](../tests/fixtures/mobile-v1/errors.json)).

| Code | Status | Meaning and client action |
| --- | --- | --- |
| `client_update_required` | 426 | Unsupported contract, build, version, control, field type or binding. Body has `minimumBuild`/`contract` and `next:"update_app"`. No downgrade and no approval. |
| `proof_required` | 401 | Missing, expired, revoked or non-android session (`proof:"signin"`), or a stale passkey for a sensitive control (`proof:"fresh_passkey"`). |
| `identity_incomplete` | 403 | Account is enrolling or recovering. Open the browser; no native session exists. |
| `onboarding_required` | 409 | Welcome is not complete. Open the browser; reads and writes are refused. |
| `identity_changed` | 409 | Epoch or credential state changed under an action. Sign in and review again. |
| `invalid_request`, `unknown_field`, `missing_field`, `invalid_cursor`, `unsupported_control` | 400 | Closed validation failures. |
| `not_found` | 404 | Missing, expired or foreign resource; deliberately indistinguishable. |
| `request_conflict`, `stale_revision`, `chat_busy`, `review_unavailable` | 409 | Replay with changed payload, stale conversation, a pending reply, or a stale/expired review. |
| `payload_too_large` | 413 | Over the route bound. |
| `unsupported_media_type` | 415 | Not a prepared JPEG. |
| `rate_limited` | 429 | Wait `retryAfterSeconds`. |
| `unavailable` | 503 | Platform or provider unavailable; authentication and help stay reachable. |

The web identity code `client_upgrade_required` (409) belongs to `/api/auth/identity/v1`; mobile uses the native codes above and the explicitly admitted WH-105 interaction errors.

## Journey ownership and evidence

| Journey | Native | Browser | Authoritative contract | Failure and readback | Evidence required |
| --- | --- | --- | --- | --- | --- |
| Returning sign-in | Credential Manager passkey, token storage | none | `session/login/*` over `loginOptions/loginVerify` | wrong or replayed challenge: generic `proof_required`; `GET /session` | Physical device, approved signing identity, replay/expiry cases |
| New or recovering owner | Handoff start/return/exchange | Signup, two passkeys, saved kit, restricted recovery | WH-113 shared identity; `session/handoff/*` | Incomplete flow never exchanges; resumes in the browser | PKCE/state/redirect mismatch, replay, revocation during handoff, one-key and incomplete-recovery denial, process death |
| First workspace entry | Detect via `bootstrap` | Welcome/onboarding | `/api/onboarding`, `onboarding_required` | Refresh `bootstrap` after return | Gate holds on every route; two-owner isolation |
| Chat request and history | Compose, list, status | none | `chat/*` over `sendConversation`, `readChat`, `chatHistory` | Same-ID readback; honest pending/uncertain | Duplicate taps, lost reply, stale revision, inference unavailable |
| Answer a maintained form | Render the admitted subset | none | `interactions/*` | `receipt`, `reconcile`; unsupported definition is update-required | Field/binding admission, stale digest, unknown field |
| Review and approve | Disclosure, control, fresh-passkey reauth | Preview in Custom Tab | `reviews/*`, four controls | Stale/foreign/withdrawn reviews expose no control; same-ID replay | Per-control exact/stale/concurrent tests, no client-created approval |
| Projects, versions, activity | Lists and details | Website preview | `projects/*`, `activity` | `404` for foreign IDs | Two-owner isolation, pagination |
| Photos and sharing | Picker, preparation, explicit upload | none | `projects/{id}/photos/*` | Status route; same-ID byte conflict | Size/format/URI cases, held and blocked media, no automatic send or publish from a share |
| Push and preferences | Permission, token, display | none | `devices/current`, `events/{id}` | Open reads current state; unavailable destinations are safe | Token rotation, revocation, duplicate/delayed events, no private payload |
| Sign-out and revocation | Local purge, `session/logout` | Security, recovery, sign-out everywhere | WH-113 revocation semantics | `401` clears local state; retained retries wait | Revocation mid-request, account switch |
| Security, recovery, support, billing, providers, take-down | Open the browser | Everything | Existing web contracts | n/a | Remains reachable with Chat or inference down |

WH-048 remains a prerequisite for **Android customer admission** only. It does not depend on Android, and Android does not delay the web beta.

## Source integration and remaining gaps

1. **Dispatcher — implemented.** [`src/index.ts`](../src/index.ts) dispatches the closed mobile router before the web cookie transport, rejects bearer material on non-mobile routes, and preserves the web Origin rule. Mobile requests reject cookies and Origin headers.
2. **Principal — implemented.** The shared resolver, commit predicates and challenge verifier require the selected `web`/`android` client. Cross-client tokens fail. The native passkey origin derives from the configured signing certificate, with no debug default.
3. **Handoff — implemented.** `mobile_identity_handoffs` binds the browser session/account/epoch and one-time PKCE exchange. The browser source must still resolve as ready at consumption. All proof times and source session expiry are retained.
4. **Review metadata — implemented.** `src/mobile/reviews.ts` derives current native controls from the shared specification/comparison readers and exact Chat receipts. It excludes unpublish/disable aliases, preserves fresh proof and supplies the complete verified application source artifact.
5. **Resources — implemented.** Mobile projects/Activity/history use bounded owner/route/search cursor pagination over existing reads. Saved versions remain bounded to 25. Actual prefixed Activity receipt keys round-trip without UUID coercion.
6. **Push.** Device registration, outbox/event identity and the FCM adapter are WH-086 work over the [job design](background-jobs.md). No FCM acceptance exists.

## Explicitly outside v1

Cookie or `Origin`-based mobile access; bearer access to non-mobile routes; a generic proxy or command strings; password, recovery-code or email-link sign-in; passkey add/remove, recovery-kit and recovery flows, signup and invitation; onboarding answers; provider connections, DNS/domains and billing/checkout; backups, exports, CMS/WordPress and the other publication reviews; unpublish, deletion and take-down shortcuts; custom/temporary views, interaction cards, dashboard layout writes and attachment fields until WH-085; full offline sync or cached workspace snapshots; iOS, customer-generated Android apps and public Play distribution (WH-088). Real-money payments stay disabled and CMS testing stays owner-deferred.

## Open owner decisions

1. **Minimum Android version and API matrix.** Options: the oldest release with maintained Credential Manager passkey support (smallest test matrix per device, widest reach), or only the current and previous major releases. Recommendation: latest two majors for the first beta, recorded in WH-082 with the checked Android documentation date.
2. **Play distribution and identity.** Confirm internal testing only for the beta, the developer-account owner, package name, signing custody and Play App Signing fingerprint (these feed the approved origin and Digital Asset Links).
3. **Play Integrity.** Require device/app attestation before issuing a session, or rely on passkey user verification plus the signing-identity binding. Default here: no attestation.
4. **Native session cap.** Share the existing bounded session count with web, or give native its own cap. Default here: shared.
5. **Native take-down.** Whether the beta must include urgent unpublish in the app, or keep it in the browser (this contract excludes it).
6. **Push default.** Explicit opt-in per the Android doc, or default-on after the permission is granted. Default here: explicit in-app opt-in.
7. **Error status — resolved in source.** Mobile consistently uses `426 client_update_required`; the web identity adapter retains its separate `409 client_upgrade_required` contract.

None of these is assumed by the fixtures beyond the stated defaults.

## Verification

Contract verification: `node tests/mobile-v1-contract.mjs` checks the registry against the repository sources, validates every fixture and rejection, the control and capability rules, session/handoff/idempotency reference semantics, the push payload, the secret/PII scan (including planted negatives) and that this document names every operation and error code. It does not run a Worker, database, device, provider or model, and a passing run does not establish any runtime, device or customer acceptance.

Runtime verification for WH-083: `node tests/mobile-identity.mjs` and `node tests/mobile-identity.mjs --d1` run the actual Worker routes, shared signature verifier and current SQLite/local-D1 schema, including two-owner denial, races, reauthentication expiry, PKCE replay and cookie/Origin isolation. See [recorded boundaries](android-identity.md). Signing configuration, actual Digital Asset Links verification and device/provider acceptance remain separate.

Runtime verification for WH-084: `node tests/mobile-workspace.mjs` and `node tests/mobile-workspace.mjs --d1` exercise actual Worker routes and shared current-domain commits; see [native workspace evidence](android-workspace.md).
