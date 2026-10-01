# Private version comparisons

Website drafts and publication reviews now offer a private comparison page. It shows exact before/after configuration values, while Chat returns a bounded summary and a link to the full comparison. Comparison never authorizes a publish, restore, unpublish or edit.

## Entry points

- Ask Whumpo to compare a saved draft with the live website, another saved version of the same project, or empty content.
- The validated `compare` action accepts `versionId` and optional `baselineId`. The server supplies the result and replaces any model-written claim about the changes.
- Legacy `/diff` adapters remain internal for handlers and offline fixtures. Public Chat accepts natural language only; customers do not enter commands or need version IDs.
- Draft messages have a “Compare with live site” link. Pending publication, restore and unpublish reviews have “Review website changes” beside confirmation.

Direct comparison reads use no inference. Natural-language interpretation uses standard fair-use assistance with no customer credit debit. Reading the comparison page uses no model or R2 operations.

## Snapshot and authority

Both artifacts, their project owner, and the baseline publication identity are selected in one D1 statement. Explicit baselines must exist in the target's project, including when the same owner has another project. A foreign, missing or deleted baseline is rejected; it is never silently replaced with the live version. HTML SHA-256 is checked before comparison and component configurations pass the existing versioned validators.

`GET /api/site-versions/VERSION_ID/diff?base=BASELINE_ID` is authenticated and read-only. Omit `base` for the live baseline or use `base=none` for empty content. Unknown or repeated query parameters are rejected. Response headers prohibit caching, scripts, forms and framing. All text is escaped before it enters the comparison markup. Each field has a labeled section and a definition list with full Before and After values. Wide screens show the pair side by side; narrow screens stack it with both labels intact. Version IDs and checksums are available under Version details.

`GET /api/publication-reviews/REVIEW_ID/diff` reads the exact pending review and current publication together. It rejects expired, applied, foreign or stale reviews, including when another confirmation has advanced publication revision. Publish/restore compares the reviewed target to the live baseline; unpublish compares current live content to empty content. No confirmation control is embedded in this read page. Confirmation remains a separate authenticated, Origin-checked chat action with the existing transaction guards.

A page already opened is a snapshot and may become stale after it renders. It says so explicitly. Opening the page does not extend review expiry or weaken the later confirmation checks.

## Durable chat comparisons

Migration 0026 adds `chat_comparisons`, written with the comparison's chat receipt in the same transaction. It retains exact target and optional baseline IDs. Thus an old chat comparison link still selects the original baseline after the live site changes. An initially empty baseline stays empty. The database validates chat ownership and same-project references; updates are prohibited. Removal of either saved version cascades the link receipt, while historical chat text follows the existing chat-retention policy.

Same-ID chat replay and lost commit acknowledgement recover the stored comparison without a new model call or charge. A version removed before receipt insertion fails validation; a metered comparison that encounters this known validation failure releases its reservation under the existing failed-proposal policy.

## Scope of comparison

The supported `launch-page@1`, `site-page@1` and `photo-page@1` configurations are compared field by field. Empty strings, additions and removals remain distinct. Sections are positional, so reordered sections appear as changes at those positions. Photos are identified by immutable project file ID; changed position and alt text are reported without retrieving image bytes. These are reference comparisons, not pixel comparisons.

Saved HTML identity is reported separately. Different HTML with identical configuration is not presented as identical source. This is not a code-line, CSS or rendered-pixel diff; previews remain the way to inspect the visual result. Hosted contact-form settings, inbox messages, domains, credentials and account data are excluded. Publication changes still disable contact intake until reviewed again.

Chat includes at most twelve changed fields with 180-character excerpts per before/after value; it labels excerpts and remaining fields. The full private page contains all supported configuration changes. No comparison is published, exported into another customer's project or added to a shared catalog.

## Verification

`test:version-diff` covers initial publication, exact/default/empty baselines, text and section changes, photo order/removal/alt text, byte-only differences, integrity failures, owner and project boundaries, escaped output, expired/applied/stale reviews, restore/unpublish, durable chat metadata, forbidden model fields, authoritative model receipts, replay, zero-unit guided access, lost acknowledgement and deleted-baseline behavior. Publication and version-removal regression suites also pass.

Browser inspection checks the actual rendered comparison at desktop and 390-pixel mobile widths. Live deployment evidence and remaining acceptance limitations are recorded in `docs/deployment.md`.


## Readable recovery and responsive comparison — October 1, 2026 UTC

`src/comparison-page.ts` owns comparison HTML presentation. Both comparison routes retain their exact auth, owner, immutable review, integrity, expiry and publication-revision checks. For GET requests that explicitly accept HTML, errors now render a Whumpo recovery page with the original HTTP status. Signed-out reads link to sign-in; expired/stale reviews explain how to request a fresh review in Chat; missing/foreign reviews share the same generic page. Invalid links, existing safety holds, rate limits and unavailable comparisons have bounded guidance. Pages expose no error detail, project name, source or identifiers on failures. There is no automatic retry, new review, approval or publication. JSON clients, non-GET requests and other API routes retain their previous responses.

Successful and error pages use private no-store caching, no-referrer, frame denial, no scripts/forms and escaped content. `Vary: Accept` distinguishes presentation; Retry-After is preserved when supplied. This uses ordinary [Workers Response status/headers](https://developers.cloudflare.com/workers/runtime-apis/response/) (checked October 1, 2026); no service or binding is added. Whumpo colors, responsive spacing, visible keyboard focus and system day/night preference replace the old comparison styling. No font/image/third-party fetch is required. This isolated document follows the device color preference; it does not read the account's saved appearance preference.

Passed `node tests/comparison-page-http.mjs` (actual bundled Worker with disposable in-memory SQLite) and `node tests/version-diff.mjs` (disposable Wrangler D1). HTTP checks cover 200/400/401/404/409/429/500/503, generic foreign/missing equality, JSON compatibility including HTML refusal, escaped values, retained labels/security headers, existing held-status presentation, and unchanged review/version/publication state. The comparison regression retains exact/default/empty baselines, owner/project isolation, integrity, stale/expired reviews, restore/unpublish, chat receipt identity and replay. `pnpm check`, `pnpm build` and `node tests/frontend-loading.mjs` also passed.

The connected loopback browser fixture, `node tools/comparison-recovery-browser.mjs`, confirmed readable 409, 404 and 401 pages; keyboard Return to Chat reached the actual workspace, and Sign in reached the passkey-first sign-in screen. Current comparisons retained all Before/After labels and keyboard-expandable version details at 360/390 px; a 1100 px viewport showed two columns. No horizontal overflow was observed. Synthetic review/version/publication state remained unchanged; no real authentication, inference, scanner or customer publication occurred. Private evidence: `.secrets/comparison-recovery-browser.json` and `.secrets/comparison-expired-mobile.png`.

Rendered dark-mode colors matched the stylesheet. Sampled light/dark text, muted text and link pairs compute to at least 6.27:1 using [W3C's contrast formula](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html); the sampled dark focus pair is 8.98:1. This is a bounded palette check, not whole-product contrast or accessibility certification. Real screen-reader speech and physical phone acceptance remain open under WH-024. Deployment evidence is recorded separately after live verification.


### Verified comparison test release

Release `ee62cc7e-a655-4aba-a84b-2568051415cf` from source `3a9b61b` was independently verified at **2026-10-01T04:28:59.444Z**. All four versions/tags, unchanged service/secret-binding names and CMS registry, 113 applied migrations with none pending, all 16 frontend assets and workspace HTML match the archive. Home/workspace/health returned 200; anonymous Chat/profile returned 401. Anonymous comparison navigation now returns the readable sign-in HTML with 401 and private/no-store/security headers; an explicit JSON caller retains the original 401 JSON error. Authenticated expired/missing/current comparisons were accepted with disposable local fixtures, not a live customer session. No scanner, CMS functional test, provider activation or customer publication. Private evidence: `.secrets/comparison-release-verification.json`. Automated GitHub reviews were unavailable due quotas; no automated approval is claimed.
