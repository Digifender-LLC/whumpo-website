# Expiring guest preview links and feedback (WH-092)

## Status — last reviewed October 25, 2026 UTC (first written October 4)

The WH-150 source merged to `main` in PR #123; WH-151 in #131. The paragraph below is the October 4 statement, kept as written. For the current test results and the line-by-line acceptance mapping see [WH-150 acceptance mapping](#wh-150-acceptance-mapping--october-25-2026-utc).

**WH-150, WH-151 and the local part of WH-152 implemented; verified only with local SQLite, local D1 and local R2 fixtures and local Chromium.** Not deployed, no live data read, no customer acceptance. Owners manage links from the shared view component `guest-previews` (Chat temporary views and saved pages), direct Chat controls for revoke and delete, and the HTTP API below. See [Owner Chat and view bindings](#owner-chat-and-view-bindings--wh-151). No model-facing way to read comments exists yet. The `creator.guest-feedback` catalogue entry moved to `private-test` on October 27, 2026 after the live acceptance below (see [Decomposition](#decomposition)). Parent [WH-092](roadmap/backlog.md) stays open.

No new Cloudflare product, plan or paid service is used. Links and comments live in the existing private control [D1](https://developers.cloudflare.com/d1/) database. Guest pages are served by the existing `whumpo-sites` Worker through its existing `*.whumpo.site/*` [route](https://developers.cloudflare.com/workers/configuration/routing/routes/); retention runs in the existing daily [Cron Trigger](https://developers.cloudflare.com/workers/configuration/cron-triggers/). D1 reads/writes and Worker requests count against existing account allowances. **Requires verification before activation:** that `preview.whumpo.site` resolves through Cloudflare to that route (an existing wildcard DNS record is assumed, not verified). No DNS change was made.

## What a link is

An owner issues a link for **one exact saved website version** (`site_versions` row) of one project they own. The link:

- is a random 256-bit bearer token, shown to the owner **once** in the issuance response. Only its SHA-256 hash is stored; the raw token is never stored, exported, listed or logged. A lost response cannot recover it: revoke and issue another.
- expires after a chosen 1 to 168 hours (7 days) and cannot be extended;
- can be revoked by the owner at any time, immediately and idempotently;
- grants no session, cookie, account, workspace membership, editing, publication approval, spending, Chat or model authority. Guests never sign in.

Guests see only the bound version, rendered by the same isolated preview path the owner uses (`savedVersionHTML`): current-format/hold checks, then digest-verified private photos inlined as `data:` URIs. There is no asset URL, version selector, source export, other version, draft proposal, project data or account data on the guest surface.

A link stops serving (reads **and** comments) when any of these is true, checked in the same SQL statement as the read, and again after rendering so a concurrent change wins over an in-flight response:

- it is revoked or expired;
- its saved version was removed (the FK clears `version_id`; the owner keeps the link record and its feedback) or no longer matches the pinned digest;
- the version has a recorded content hold (`project_spec_held`), is no longer current-format, or a photo fails its clearance/digest check;
- the owner's current inclusion of `creator.guest-feedback` (operation `dispatch`, exact project scope) has ended — invoice coverage (Creator or higher) or an exact private-test [preview grant](feature-inclusion.md).

## Guest flow and host isolation

The link URL is `https://preview.whumpo.site/#TOKEN`. The token is in the URL **fragment**, which browsers never send to a server, so it does not appear in request logs, `Referer` headers or caches. The page script sends it only in POST bodies:

| Request | Purpose |
| --- | --- |
| `GET /` | Static guest page. No link data is embedded. CSP allows only its own hashed script/style, same-origin fetches and frames; `frame-ancestors 'none'`. |
| `POST /api/link` `{token}` | Expiry time and whether comments are allowed, or a uniform 404. |
| `POST /view` (form `token=`) | The preview document, loaded into a sandboxed frame on the guest page. CSP `sandbox` (no scripts, opaque origin), `img-src data:` only, `frame-ancestors 'self'`. |
| `POST /api/feedback` `{token, requestId, name?, text}` | Accept one comment; returns a receipt ID. |

Every response is `no-store` and `noindex, nofollow, noarchive, nosnippet` and sets no cookie. API and preview responses use `no-referrer`; the guest page uses `same-origin`, because browsers send `Origin: null` for a form navigation under `no-referrer` and `/view` requires the exact guest origin (fragments are never part of a `Referer`). POSTs require the exact guest origin. Forged, malformed, expired, revoked and removed links all receive the same 404. Query strings and alternate paths are refused.

`preview.whumpo.site` is on the customer domain, so the workspace `__Host-whumpo_session` cookie for `whumpo.com` is never sent to it. It is not a project host, custom domain or the visitor app host; project hosts do not serve guest routes. Local development serves the same routes under `http://localhost:8788/guest-preview/` (`pnpm dev:sites`).

## Guest feedback

When the owner allows comments, a guest may send plain text (1–2,000 characters, line breaks allowed) and an optional single-line display name (up to 60 characters). The name is labelled **not verified** to guests and returned to owners as `displayNameVerified: false`. Control characters are refused. Text is stored verbatim and returned only as JSON strings; nothing renders it as HTML in this slice.

Comments never reach Chat, a model, a notification, a publication, a job or another processor automatically. Embedded markup or instructions are inert data: the tests store a script tag and a "publish/spend/invite" instruction and verify that no Chat turn, inference call, publication or activity results.

Each comment carries a client `requestId`. Repeating it with the same name/text returns the original receipt; reusing it with different text is refused (409). A replay is answered only while the link is still current.

### Limits

| Limit | Value | Enforcement |
| --- | --- | --- |
| Preview views | 60 per link per 10-minute window | Atomic counter on the link row (429 when exceeded) |
| Comments | 10 per link per 10 minutes; 200 per link | Insert trigger (429) |
| Stored comments | 2,000 per owner; 100,000 platform | Insert trigger |
| Links | 20 active and 200 retained per project; 20,000 platform | Insert trigger (409) |
| Inlined photo reads | One read per photo (up to 4 per view), charged like the project's public photos: 400 per connection per project per UTC day, then the project's 10,000/month budget with the account fair share, then the 100,000/month platform ceiling | `reserveGuestPreviewPhotoReads` ([`src/storage-budget.ts`](../src/storage-budget.ts)) and the existing `public_client_usage` / `storage_project_usage` triggers (429 per connection, otherwise 503) |

These protect the shared test platform; they are not plan allowances. Brute-force token guessing is infeasible at 256 bits; each invalid attempt costs one indexed D1 read.

**Photo read accounting (WH-004 finding B6, October 9, 2026 UTC; local only).** A guest view of a photo version reads each private photo from R2 to inline it. Those reads are charged to the **link's project** with exactly the [WH-075](capacity-and-fairness.md) public-photo semantics, once per photo, after the link, version and safety-hold checks and before any object is read: the connection's per-project photo sub-limit (400 per UTC day, IPv4 address or IPv6 /64, stored only as a daily SHA-256 key and **shared** with that project's public site photos), then, in one all-or-none D1 batch, the project's monthly read budget (10,000, or the operator [containment](capacity-and-fairness.md#wh-050-f7f8-operator-containment-and-counter-thresholds--october-4-2026-utc) allowance for the `photo` scope), the account fair share (once half the platform ceiling is used, an account already holding 10,000 reads this month is refused) and the 100,000/month platform ceiling. Before this change guest views charged only the platform ceiling, so one owner's links could exhaust it and refuse every tenant's public photos. Now a project, account or connection that exhausts its share refuses only its own guests:

- per-connection limit: 429 framed "Too many requests from this connection today. Please try again tomorrow." (the existing public per-client message);
- project budget, containment, fair share or platform ceiling: 503 framed "This preview is temporarily unavailable." (unchanged). The text is identical for all four, so a guest learns nothing about which budget, or another tenant, refused.

A refused view spends no project or platform read. As for public photos, per-connection attempts are never refunded: a view refused by the per-connection limit counts nothing, but one refused afterwards by a project, fair-share or platform limit still counts its attempts. The per-link view window above still applies first. **Not changed:** owner previews (`GET /api/site-versions/{id}/preview`) and exports still charge only the platform ceiling (audit risk R3); public site photo behavior is unchanged. **Owner decisions:** whether guest views should share the 400/day per-connection photo sub-limit with the public site (current) or have their own; and whether an operator `photo` containment, which now also refuses guest-preview photos of the contained project, should keep that reach. No schema change. Verified locally by `tests/boundary-guest-preview-read-pool.mjs` on SQLite and `--d1` (local D1 + R2) and by the local-D1 `guest-preview-photos` check (see [boundary-audit.md](boundary-audit.md#verification)); not deployed.

## Owner API

All routes are on `https://whumpo.com` and require the current workspace session (and same-origin for writes), so they share their transaction with the current-identity assertion. Only **issuance** also requires current feature inclusion, composed into the insert. Listing, revocation, resolution and deletion remain available on every plan, including after inclusion ends.

| Route | Effect |
| --- | --- |
| `GET /api/projects/{project}/guest-previews` | List links: state (`active`, `expired`, `revoked`, `removed`), dates, label and comment counts. Never the token or any hash. |
| `POST /api/projects/{project}/guest-previews/prepare` `{id, versionId, expiresInHours, feedback, label?}` | Validate and return the exact readout (project, saved version and digest, expiry hours, comment setting, label) plus a `confirmation`. Writes nothing; refuses when inclusion is absent. |
| `POST /api/projects/{project}/guest-previews` `{id, versionId, expiresInHours, feedback, label?, confirmation}` | Issue a link. This is the only issuance path: it re-prepares and refuses (409) unless `confirmation` still matches the exact readout. `id` is the idempotency key; a replay returns the link without the token. |
| `POST /api/guest-previews/{link}/revoke` | Revoke immediately (idempotent, one-way). |
| `DELETE /api/guest-previews/{link}` | Delete the link and its comments. |
| `GET /api/guest-previews/{link}/feedback` | Read comments (at most 200 per link). |
| `PATCH /api/guest-previews/{link}/feedback/{comment}` `{resolved}` | Mark resolved or reopen. |
| `DELETE /api/guest-previews/{link}/feedback/{comment}` | Delete one comment. |

Foreign owners receive 404 for every link, comment and project. Losing the session returns 401; already issued links keep their own expiry and revocation rules.

## Owner Chat and view bindings — WH-151

Registered in `src/guest-previews/bindings.ts` as an adapter over the WH-150 handlers. It has no table, token, eligibility or ownership logic of its own: every effect calls the handler the HTTP routes call, so identity, ownership and inclusion are identical on every surface.

| Binding | Mode | Handler | Surface | Inclusion | Model context |
| --- | --- | --- | --- | --- | --- |
| `project.guest-previews@1` | read | `listGuestPreviews` via `readViewBinding` | View component `guest-previews` (project scope), shared by Chat temporary views and saved pages | Identity and ownership only | Link state, dates and comment counts |
| `guest-preview.feedback@1` | read | `listGuestFeedback` | `GET /api/guest-previews/{link}/feedback`, opened by the owner on request | Identity and ownership only | Never |
| `guest-preview.prepare@1` | prepare | `prepareGuestPreviewIssue` | `POST …/guest-previews/prepare` | Current `creator.guest-feedback` | Never |
| `guest-preview.issue@1` | confirm | `confirmGuestPreviewIssue` | `POST …/guest-previews` | Current `creator.guest-feedback`, composed into the insert | Never |
| `guest-preview.revoke@1`, `.delete@1` | action | `revokeGuestPreview`, `deleteGuestPreview` | HTTP and `ChatControl` `guestPreview` | Identity and ownership only | Never |
| `guest-preview.resolve@1`, `.delete-comment@1` | action | `resolveGuestFeedback`, `deleteGuestFeedback` | HTTP (view panel) | Identity and ownership only | Never |

- **Exact confirmation.** Preparation shows the project, the exact saved version (date and digest), the expiry as hours after confirmation, the comment setting and label. Its `confirmation` is a SHA-256 over owner, project, request ID, version, version digest, hours, comment setting and label. Issuance recomputes it, so a changed field, version, owner or a lost inclusion refuses without a row. The absolute expiry is fixed at the moment of confirmation, so the readout states the duration, not a clock time; the issued link then reports its exact `expiresAt`.
- **Models cannot issue.** A model has no route, agent action, interaction binding or control for any row above except that a temporary or saved view may include the read-only `guest-previews` component. It is not offered an issue, revoke, delete, resolve or comment-reading action, and the agent prompt says so. Typed text is never a command, including the internal control strings.
- **Token handling.** The token exists only in the `POST …/guest-previews` response (`no-store`) and in the owner panel's memory until dismissed or unmounted. It is not in any table (only its hash), query cache, storage, Chat turn, transcript, view fact, log or model input. A replay returns no token; a lost token needs revoke and a new link.
- **Comments.** The view shows counts only. Text appears only after the owner presses **Show comments**, as plain text with the name labelled not verified. Nothing sends comments to Chat or a model. A reviewed privacy route for the owner to hand selected comments to the assistant is not built; until it exists, no comment can enter model context.
- **Direct controls.** The panel's **Revoke link** and **Delete…** buttons call the HTTP handlers directly. `ChatControl` `{type:'guestPreview',operation:'revoke',linkId}` and `{…,operation:'delete',linkId,confirmation:'DELETE'}` run the same ownership check through `sendChatControl` with no inference. Since WH-004 finding B3 (October 8, 2026) the control's revoke or delete statement is guarded by the saved Chat turn and runs in the same revision-checked batch that inserts the turn, like every other typed control: a request refused with `409` (stale conversation revision) or aborted by a preservation hold changes nothing and saves no turn, and an exact replay of the same request ID is answered from the saved turn without a second effect. `node tests/guest-preview-chat-atomic.mjs` (SQLite) and `--d1` cover the stale-revision, fresh, replay, foreign-owner and held-comment cases. Both stay available after inclusion ends because the view read, revoke and delete are not feature-gated (the interaction registry names `creator.guest-feedback` as the family, and only issuance enforces it).
- **Boundaries.** The view component needs a project scope (an account-wide page reads as unavailable). A foreign or forged project ID reads as unavailable with no data, a forged link ID returns 404 and leaves the real link unchanged, and a lost workspace identity refuses every read and action.

Direct `POST …/guest-previews` without a matching `confirmation` is no longer accepted.

| Status | State |
| --- | --- |
| Implemented in source | Bindings, `guest-previews` view component and panel, confirmed issuance, ids-only Chat controls, agent prompt wording |
| Configured / accepted | Nothing. Local Chromium journey passes (WH-152, below); not deployed; no real-device, live or customer acceptance (WH-153) |
| Not built | Reviewed owner-requested route for sharing comments with the assistant; Chat card for preparation (the model cannot prepare yet, only the owner can); account-wide link list |

## Lifecycle, export, closure and safety

Registered as the current `guest-feedback` class in the [data lifecycle catalogue](data-lifecycle.md) (`guest_preview_links`, `guest_preview_feedback`), with `managed-readable` protection.

- **Retention:** the daily `guest_previews` [maintenance](maintenance.md) job removes link metadata that ended more than 30 days ago and never received comments (at most 500 per run). Links with comments, and the comments, stay until the owner deletes them or the project/account is deleted. An age limit for abandoned feedback is an open owner decision.
- **Version removal:** clears the link's version; access ends, records remain.
- **Export:** the owner JSON listing is the current export surface (scope, label, state, dates, counts; comment text, unverified name, resolution). Tokens and hashes are never exported. Account-wide export remains planned.
- **Account closure:** the [closure inventory](account-closure.md) counts `guestPreviewLinks`, `activeGuestPreviewLinks` and `guestPreviewFeedback`. Project and account deletion cascade both tables.
- **Safety:** an active account [preservation hold](content-safety.md#restricted-safety-cases-and-preservation-holds--source-foundation-local-only) blocks deletion of comments and of links that have comments, like contact submissions; retention skips them. A recorded content hold on the version stops serving and refuses new links. Comments are not scanned; no detector runs.

## Decomposition

| Child | Scope | Status |
| --- | --- | --- |
| WH-150 | Link authority, isolated guest delivery, bounded feedback, owner API, lifecycle/closure registration (this page) | Source and local tests |
| WH-151 | Register owner list/issue/revoke/resolve/delete through WH-105 bindings and WH-107/109/110 Chat/view adapters; issuance needs exact owner confirmation; comments stay out of model context | Source and local tests; model-prepared issuance and comment hand-off route not built |
| WH-152 | Accountless mobile/keyboard browser journey (preview, comment, revoke) plus owner-surface journey with synthetic approved assets | Local Chromium journey passes; live and real-device acceptance remain WH-153 |
| WH-153 | Verify `preview.whumpo.site` routing, reviewed test deployment and live synthetic acceptance; then mark the catalogue entry `private-test` | Live synthetic acceptance passed October 27, 2026; catalogue entry is `private-test`; devices and human guests unverified |

## WH-151 verification — October 4, 2026 UTC

Node 22 in this environment. `node tests/guest-preview-bindings.mjs` and `node tests/guest-preview-bindings.mjs --d1` pass 8 groups each over the actual worker, sites host, view registry, Chat control path and WH-150 handlers: registry names real handlers and the interaction binding; exact readout and confirmation (missing, malformed, changed field, other owner, other project, lost inclusion all refuse without a row); token absent from every table, Chat history, transcript, view facts, logs and model input; view parity with the HTTP list in a temporary Chat view and a saved page, with forged, foreign, null and non-UUID scopes; ids-only controls with forged and foreign link IDs and typed text; inert comments and no Chat or model effect; revoke, comment, delete and view after inclusion ends; lost identity. `tests/workspace-view-components.mjs` covers the shared component's strict validation. The existing `guest-previews` and `guest-preview-photos` suites now issue through prepare and confirm.

## WH-152 browser journey — October 4, 2026 UTC

`node tests/guest-preview-browser.mjs` (Node 22, Chromium) builds the real client and serves the real `guest-previews` panel on a saved workspace page through the actual platform Worker, and serves the guest page through the actual sites handler, both over one disposable local D1 + R2 database with a synthetic, explicitly approved private photo. It runs the whole journey twice: a keyboard-only desktop profile (1280x800) and a mobile profile (390x844, touch, 44px targets, 320px reflow).

- **Owner:** form focus order and accessible names; prepare writes nothing and shows the exact readout; cancel and reload discard it; confirm issues the link once; Copy link; dismiss (desktop) or navigating away (mobile) removes the link from the page. After either, and after reload, the token is absent from the DOM, client query and mutation cache, local/session storage and cookies (only the workspace session cookie exists), and appears in exactly one owner response (issuance) and no owner request. Comment text appears only after **Show comments**, as plain text with the name labelled not verified; resolve and reopen; revoke affects only that link; two-step delete (Keep, then confirm) removes the link and its comments. Controls are named per link (for example “Revoke link for Print shop copy”) so two links are distinguishable.
- **Guest:** no account; sandboxed frame (`sandbox=""`) with the digest-verified photo inlined; heading, frame title, field and status names; Tab order name, comment, send; keyboard comment stored; no horizontal overflow; `no-store`, `noindex`, CSP (`frame-ancestors 'none'`, frame `sandbox`, `img-src data:`) and no `Set-Cookie`; no cookie, storage or IndexedDB on the guest origin and no `Cookie` header on any guest request; token never in a request path or query; after revocation a late comment is refused, a reload shows the unavailable state, and `/api/link` and `/view` answer 404.
- **Large text:** 200% text size and 320px width (equivalent to 400% zoom) at both surfaces: no horizontal overflow and no control outside the viewport.
- **Logs and network:** captured Worker logs hold no token or guest text; no external request is made.

It found and fixed four defects: focus was lost to the page when a panel control disabled itself or replaced itself (every action, readout, issued-link region, cancel, keep, hide, delete); per-link and per-comment buttons had identical names; the confirm button overflowed the viewport at 200% text (the shared workspace button rule pins `flex-shrink:0`, so the panel's buttons now set `max-w-full`); and the guest page used a fixed `16px` body size that ignored the browser text size.

Not covered: real iOS/Android devices, assistive technology (screen reader speech was not run; names are asserted through the accessibility tree), and the live `preview.whumpo.site` route and release, which remain WH-153.

## Verification — October 4, 2026 UTC

Node 22 in this environment (repository target is Node 24).

- `node tests/guest-previews.mjs` (SQLite) and `node tests/guest-previews.mjs --d1` (local D1) passed, 11 groups each: Starter denial, exact project grant and its revocation, owner session loss; issuance bounds, idempotent replay without token, hash-only storage; guest headers/CSP/noindex/no cookie, exact-version bytes equal to the owner preview, refused selectors, query tokens, aliases, methods and origins; forged/malformed/foreign tokens; feedback bounds, inert markup, request-ID replay/conflict and no Chat/model/publication effect; resolve/delete and immutability triggers; view, comment and active-link limits; immediate and in-flight revocation; expiry, version removal, content hold; preservation hold, retention, closure counts and cascades; no token, hash or guest text in captured logs; zero network calls.
- `node tests/guest-preview-browser.mjs` (Chromium at 390×844 over the actual local sites handler) passed: the exact preview opens in the sandboxed frame, the token never appears in a request path or query, a keyboard-only comment is stored, and a reload after revocation shows the unavailable state with no page errors. It first exposed the `Origin: null` behaviour above. The WH-152 section above supersedes this smoke check.
- `node tests/guest-preview-photos.mjs` (local D1 + R2) passed: a photo version's private bytes are inlined exactly as in the owner preview, no asset URL exists on the guest or project host, and tampered bytes are refused. The photo clearance is explicitly synthetic.
- Related suites passed after the change: account-closure-inventory, current-interfaces, current-schema, current-website-specifications, customer-site-journey, exports, feature-identity, feature-inclusion, funnel-metrics, photo-versions, publications, safety-cases, site-traffic, site-safety, specification-journey, version-diff, version-removal, lifecycle-catalog, maintenance, maintenance-scheduled, maintenance-inventory, release-manifest and roadmap-alignment, plus the type checks and compiler pins. `feature-admission`, `feature-retention` and `plan-catalogue` fail identically on the unmodified base commit (connection-control and pricing-page expectations unrelated to this work).

## WH-150 acceptance mapping — October 25, 2026 UTC

Docs-only check against `origin/main`; no source, test or schema change. Node 24.21.0 and pnpm 11.19.0 through mise, local SQLite and local D1/R2 only. Not deployed, no live read.

**Merging PR.** `git log origin/main -- src/guest-previews/owner.ts` shows the file was added by `5861fa4` "[WH-092/WH-150] Expiring guest preview links and bounded guest feedback (#123)". Later commits on the file: #131 (WH-151) and #178 (WH-004 B3). PR numbers are taken from commit subjects; GitHub was not read.

### Results

| Command | Result |
| --- | --- |
| `node tests/guest-previews.mjs` | pass, 12 groups (SQLite); 18 groups after the October 31 close-out below |
| `node tests/guest-previews.mjs --d1` | pass, 12 groups (local D1); 18 groups after the October 31 close-out below |
| `node tests/boundary-guest-preview-race.mjs` | pass, 1 check (B3: a guest-preview delete refused with 409 leaves the link unchanged) |
| `node tests/boundary-guest-preview-read-pool.mjs` | pass, 1 check (B6: guest photo reads charge the link's project budget, fair share and per-client limit) |
| `node tests/guest-preview-photos.mjs` | pass, 1 check (local D1/R2, synthetic clearance) |
| `node tests/guest-preview-browser.mjs` | **unverified**: Playwright is not in `main`, so it cannot run. The October 4 browser results above are not re-confirmed. |

The two D1-backed commands first failed with `Cannot find module .../node_modules/wrangler/bin/wrangler.js` because the fresh worktree had no `node_modules`. After `pnpm install --frozen-lockfile` both passed. The failure was environmental, not a test failure.

### Acceptance lines to tests and enforcing source

Group names are the `check(...)` titles in `tests/guest-previews.mjs`. The link gate is `guestLinkCurrent` in `src/guest-previews/policy.ts` plus `current()` in `src/guest-previews/guest.ts`, which adds the operator serving stop and `guestInclusion`, all in the same SQL statement as the read or insert. `stillCurrent()` repeats the gate after rendering.

**1. Forged, replayed, expired, revoked, removed, held and no-longer-included links stop reads and comments, including an in-flight view.**

| Case | Test | Source |
| --- | --- | --- |
| Forged / malformed | "forged, malformed and replayed tokens": random, short, extended, upper-cased, empty and hash-of-token all 404 on status, view and comment | `guestTokenHash` (43-char base64url check) and `findLink` return null, then `unavailable()` |
| Replayed | Same group; "feedback bounds, inert markup and idempotency" (same `requestId` returns the original receipt, different text 409); "immediate revocation and in-flight race" (comment refused after revoke) | `feedback()` receipt logic, answered only after the `current()` check |
| Expired | "expiry, version removal and safety holds" | `guestLinkCurrent` (`expires_at>unixepoch()`) |
| Revoked | "immediate revocation and in-flight race"; idempotent revoke; revoke cannot be undone | `revokeGuestPreview` in `owner.ts`, `guestLinkCurrent` (`revoked_at IS NULL`), immutability trigger |
| Removed | "expiry, version removal and safety holds" removes the version through the real command; link state becomes `removed` and feedback is kept | `guestLinkCurrent` (`version_id IS NOT NULL`, digest match), FK clears `version_id` |
| Held | Same group: a content-screening decision stops view, status and comment and issuance returns 423; "preservation hold, retention..." covers deletion of held comments | `guestLinkCurrent` (`project_spec_held`), `requireSpecificationAvailable` in `createGuestPreview` |
| Operator serving stop | "operator serving stop withdraws guest previews..." | `current()` (`operator_serving_stopped`) |
| No longer included | "tier and identity admission": revoking the exact project grant gives 404 on view, status and comment, while listing and revoke still work | `current()` composes `guestInclusion` (`creator.guest-feedback`, `dispatch`) |
| In-flight view | "immediate revocation and in-flight race": a revoke is injected between admission and the version read; the response is 404 with no content | `view()` then `stillCurrent()` |

**2. Guests see only the exact bound version through the shared isolated preview rendering.**

| Test | Source |
| --- | --- |
| "guest shell, exact version and isolation headers": bytes equal the owner preview of the bound version, not the newer head; `&version=` 400; query token 400; path token and `/assets/`, `/s/`, `/cms/`, `/directory.json` 404; GET `/view` 405; missing or project-host `Origin` 403; CSP `sandbox`, no `script-src`, `frame-ancestors`, `noindex`, `no-store`, no cookie | `view()` (reads `admitted.version_id` only), `savedVersionHTML`, `frameHeaders`, `guestPreviewRequest` routing and origin checks |
| `guest-preview-photos.mjs`: owner bytes inlined after digest check, no asset URL or alias, tampered bytes refused | `savedVersionHTML` with the photo reservation callback |
| `boundary-guest-preview-read-pool.mjs`: photo reads charged to the link's project | `reserveGuestPreviewPhotoReads` in `src/storage-budget.ts` |

**3. Raw tokens are never stored, listed, exported or logged; comment markup and instructions stay inert and never reach Chat or a model.**

| Test | Source |
| --- | --- |
| "issuance bounds, idempotency and hashed token": stored hash equals SHA-256 of the token; the row and the list do not contain the token or hash; a replay returns `token:null` | `createGuestPreview` stores only `tokenHash`; `describe()` omits token and hash |
| "no token or guest content in logs": no token, token hash, comment text or name in captured logs; zero network calls | no logging in `guest.ts` or `owner.ts` |
| "feedback bounds, inert markup and idempotency": a script tag and a "publish, invite, spend" instruction are stored verbatim; `chat_turns`, `inference_calls`, `publications` and `activity_events` are unchanged | `feedbackInput` (plain text only) and `feedback()`; no Chat or model code is called |

**4. Owner identity loss and foreign owners are refused; rate, size and capacity limits hold on SQLite and local D1.**

| Case | Test | Source |
| --- | --- | --- |
| Owner identity loss | "tier and identity admission": after `revoke()` every owner route returns 401 and no row is added | `assertWorkspace` in `createGuestPreview`; session check in the HTTP routes |
| Foreign owners | "issuance bounds..." and "forged, malformed and replayed tokens": 404 for foreign project, link, feedback, revoke and delete, with nothing changed; "owner resolution and deletion" for comments | `ownedProject`, `ownedLink` |
| Issuance bounds | "issuance bounds...": hours 0, 169 and 1.5, non-boolean `feedback`, 81-char and multi-line labels, extra keys: all 400 | `issuance()` |
| Comment size | "feedback bounds...": empty, blank, 2,001 chars, control char, 61-char name, multi-line name, wrong types: 400; 2,000 chars accepted | `feedbackInput` |
| Comment rate | "rate limits": 10 per window, the 11th is 429 | trigger `guest_feedback_rate` |
| View rate | "rate limits": 60 views then 429; another link is unaffected | `admitView` |
| Active links | "rate limits": 20 active per project, the 21st is 409, revoking frees a slot | trigger `guest_preview_capacity` |
| Photo read limits | `boundary-guest-preview-read-pool.mjs` | `reserveGuestPreviewPhotoReads` |

Pass counts in the Results table were observed. The per-assertion descriptions above come from reading the test and source files, not from instrumenting the runs.

### Gaps closed by the WH-150 close-out — October 31, 2026 UTC

The seven gaps recorded above each have a test now, in `tests/guest-previews.mjs` (18 groups; `node tests/guest-previews.mjs` and `--d1` both pass on main `be4e6bf` plus this change, Node 24.21.0, pnpm 11.19.0). Cap fixtures lift one admission trigger for a single bulk `INSERT ... SELECT` on the disposable database, then restore the identical trigger, so the real trigger enforces the boundary and no 100,000-row loop runs. Seeded rows are removed by their `SEEDED` marker.

| Former gap | Group | What it asserts |
| --- | --- | --- |
| 1. 200 comments per link | "comment caps: 200 per link, 2,000 per owner, 100,000 platform" | 199 seeded older than the burst window; the 200th is 200, the 201st is 429 ("Too many comments"); the link holds exactly 200. |
| 2. 2,000 per owner, 100,000 platform | same group | Owner reaches exactly 2,000 on another link, then 429 ("not accepting more comments"); with the table at exactly 100,000, a different owner with no comments gets the same 429 and stores nothing; deleting the seeded rows reopens it (200). |
| 3. 200 retained per project, 20,000 platform | "retained link caps: 200 per project, 20,000 platform" | 199 seeded plus one issued is 200, the next issue is 409 ("guest link limit") and the count stays 200; with the table at exactly 20,000 a different owner's issue is 409 with no row; removing the seeded rows reopens it. |
| 4. In-flight view for expiry, version removal, hold, lost inclusion, operator stop (and revoke) | "in-flight view: every ending between admission and response wins over the read" | Each ending runs on the final `stillCurrent()` query, after the page is rendered and before it is returned: 404, no page content, and the link stays ended. Disabling `stillCurrent()` makes this group fail (checked by mutation). Version removal uses the real remove-and-confirm command on a non-head version and asserts the version row is gone. |
| 5. In-flight comment | "in-flight comment: no comment is stored once the link has ended" | The same six endings run immediately before the gated `INSERT`: 404 and no `guest_preview_feedback` row. |
| 6. Replay after expiry, removal, hold | "comment replay stops after revocation, expiry, removal, a hold, lost inclusion or a serving stop" | The same `requestId` returns the original receipt while current, and 404 after each of the six endings. |
| 7. Raw token in exports | "raw tokens are absent from owner listings, the closure inventory and every stored table" | The owner link listing, the feedback listing and the account-closure inventory contain neither the raw token nor its hash; no column of any table in the complete schema contains the raw token. There is still no account-wide export (planned), so this covers the owner listings and the closure inventory only. |

`node tests/guest-preview-browser.mjs` also passes now (desktop 1280x800 keyboard and mobile 390x844) with `WHUMPO_PLAYWRIGHT` pointing at an existing local Playwright and `WHUMPO_CHROMIUM=/usr/bin/chromium`. The full Chromium build asks for `/favicon.ico`, which the fixture owner server answered with a 500 and failed the console-error check; the fixture now answers 204 (test-only change, no product code). `tests/guest-preview-photos.mjs`, `guest-preview-bindings.mjs` (SQLite and `--d1`), `guest-preview-chat-atomic.mjs` (SQLite and `--d1`), `boundary-guest-preview-race.mjs` and `boundary-guest-preview-read-pool.mjs` pass unchanged. No defect was found in the product code.

### Unverified

- `preview.whumpo.site` routing, deployment and real devices (WH-153).
- PR #123 as the merging PR is inferred from `git log` subjects, not from GitHub.

## WH-153 live acceptance — October 27, 2026 UTC

Run by the orchestrator against https://whumpo.com on `main` at commit `054da5c` (all merged work deployed). No hand deploy, no DNS write, no secrets change.

`RUN_LIVE_GUEST_PREVIEW=1 node tests/guest-preview-live.mjs` exited 0 at 2026-10-27T06:44:06.895Z:

```json
{"success":true,"steps":{"dns":4,"issued":true,"viewed":true,"commented":true,"revokedRefused":true},"dnsCloudflare":["172.67.180.73","104.21.56.76","2606:4700:3030::6815:384c","2606:4700:3032::ac43:b449"],"cleanupVerified":true}
```

The same day `RUN_LIVE_WORKSPACE_SMOKE=1 node tests/workspace-smoke-live.mjs` exited 0 at 2026-10-27T06:43:37.602Z: 36 of 36 page checks (9 signed-in pages at 390 and 1280 px, light and dark, including D-9 target sizes after #387), `cleanupVerified` true.

**Decision (orchestrator, delegated authority; no money involved):** `creator.guest-feedback` implementation moves from `planned` to `private-test` in `src/plan-features.ts`. Access still requires current inclusion: an explicit project-scoped [preview grant](feature-inclusion.md) or invoice coverage. Nothing becomes public.

### Still not verified

- Physical phones and tablets (the live and local journeys use headless Chromium only).
- Real human guests and owners; all identities were synthetic `example.test` rows, deleted and verified gone.
- Customer acceptance; the catalogue entry means bounded foundation only, not launch acceptance.
