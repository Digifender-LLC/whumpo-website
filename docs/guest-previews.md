# Expiring guest preview links and feedback (WH-092)

## Status — October 4, 2026 UTC

**First slice (WH-150) implemented in source; verified only with local SQLite, local D1 and local R2 fixtures.** Not deployed, no live data read, no customer acceptance. There is no owner UI or Chat adapter yet: owners use the HTTP API below. The `creator.guest-feedback` catalogue entry stays `planned` until the remaining children pass (see [Decomposition](#decomposition)). Parent [WH-092](roadmap/backlog.md) stays open.

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

These protect the shared test platform; they are not plan allowances. Brute-force token guessing is infeasible at 256 bits; each invalid attempt costs one indexed D1 read.

## Owner API

All routes are on `https://whumpo.com` and require the current workspace session (and same-origin for writes), so they share their transaction with the current-identity assertion. Only **issuance** also requires current feature inclusion, composed into the insert. Listing, revocation, resolution and deletion remain available on every plan, including after inclusion ends.

| Route | Effect |
| --- | --- |
| `GET /api/projects/{project}/guest-previews` | List links: state (`active`, `expired`, `revoked`, `removed`), dates, label and comment counts. Never the token or any hash. |
| `POST /api/projects/{project}/guest-previews` `{id, versionId, expiresInHours, feedback, label?}` | Issue a link. `id` is the idempotency key; a replay returns the link without the token. |
| `POST /api/guest-previews/{link}/revoke` | Revoke immediately (idempotent, one-way). |
| `DELETE /api/guest-previews/{link}` | Delete the link and its comments. |
| `GET /api/guest-previews/{link}/feedback` | Read comments (at most 200 per link). |
| `PATCH /api/guest-previews/{link}/feedback/{comment}` `{resolved}` | Mark resolved or reopen. |
| `DELETE /api/guest-previews/{link}/feedback/{comment}` | Delete one comment. |

Foreign owners receive 404 for every link, comment and project. Losing the session returns 401; already issued links keep their own expiry and revocation rules.

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
| WH-151 | Register owner list/issue/revoke/resolve/delete through WH-105 bindings and WH-107/109/110 Chat/view adapters; issuance needs exact owner confirmation; comments stay out of model context | Planned |
| WH-152 | Accountless mobile/keyboard browser journey (preview, comment, revoke) plus owner-surface journey with synthetic approved assets | Planned |
| WH-153 | Verify `preview.whumpo.site` routing, reviewed test deployment and live synthetic acceptance; then mark the catalogue entry `private-test` | Planned |

## Verification — October 4, 2026 UTC

Node 22 in this environment (repository target is Node 24).

- `node tests/guest-previews.mjs` (SQLite) and `node tests/guest-previews.mjs --d1` (local D1) passed, 11 groups each: Starter denial, exact project grant and its revocation, owner session loss; issuance bounds, idempotent replay without token, hash-only storage; guest headers/CSP/noindex/no cookie, exact-version bytes equal to the owner preview, refused selectors, query tokens, aliases, methods and origins; forged/malformed/foreign tokens; feedback bounds, inert markup, request-ID replay/conflict and no Chat/model/publication effect; resolve/delete and immutability triggers; view, comment and active-link limits; immediate and in-flight revocation; expiry, version removal, content hold; preservation hold, retention, closure counts and cascades; no token, hash or guest text in captured logs; zero network calls.
- `node tests/guest-preview-browser.mjs` (Chromium at 390×844 over the actual local sites handler) passed: the exact preview opens in the sandboxed frame, the token never appears in a request path or query, a keyboard-only comment is stored, and a reload after revocation shows the unavailable state with no page errors. It first exposed the `Origin: null` behaviour above. This is a smoke check, not WH-152 device acceptance.
- `node tests/guest-preview-photos.mjs` (local D1 + R2) passed: a photo version's private bytes are inlined exactly as in the owner preview, no asset URL exists on the guest or project host, and tampered bytes are refused. The photo clearance is explicitly synthetic.
- Related suites passed after the change: account-closure-inventory, current-interfaces, current-schema, current-website-specifications, customer-site-journey, exports, feature-identity, feature-inclusion, funnel-metrics, photo-versions, publications, safety-cases, site-traffic, site-safety, specification-journey, version-diff, version-removal, lifecycle-catalog, maintenance, maintenance-scheduled, maintenance-inventory, release-manifest and roadmap-alignment, plus the type checks and compiler pins. `feature-admission`, `feature-retention` and `plan-catalogue` fail identically on the unmodified base commit (connection-control and pricing-page expectations unrelated to this work).
