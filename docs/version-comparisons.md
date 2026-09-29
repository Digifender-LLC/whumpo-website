# Private version comparisons

Website drafts and publication reviews now offer a private comparison page. It shows exact before/after configuration values, while the chat command returns a bounded summary and a link to the full comparison. Comparison never authorizes a publish, restore, unpublish or edit.

## Entry points

- `/diff VERSION_ID` compares an owned saved version with its project's live version at read time. If the project has no live version, it compares against empty content.
- `/diff VERSION_ID BASELINE_ID` chooses an exact saved baseline from the same owned project.
- `/diff VERSION_ID none` explicitly compares against empty content.
- A natural-language request can select the validated `compare` action with `versionId` and optional `baselineId`. The server supplies the result and replaces any model-written claim about the changes.
- Draft messages have a “Compare with live site” link. Pending publication, restore and unpublish reviews have “Review website changes” beside confirmation.

Guided comparisons use no AI units. Natural-language interpretation uses the existing model allowance. Reading the comparison page uses no model or R2 operations.

## Snapshot and authority

Both artifacts, their project owner, and the baseline publication identity are selected in one D1 statement. Explicit baselines must exist in the target's project, including when the same owner has another project. A foreign, missing or deleted baseline is rejected; it is never silently replaced with the live version. HTML SHA-256 is checked before comparison and component configurations pass the existing versioned validators.

`GET /api/site-versions/VERSION_ID/diff?base=BASELINE_ID` is authenticated and read-only. Omit `base` for the live baseline or use `base=none` for empty content. Unknown or repeated query parameters are rejected. Response headers prohibit caching, scripts, forms and framing. All text is escaped before it enters the comparison markup. A responsive table shows full values; narrow screens stack each field's before and after values. Version IDs and checksums are available under Version details.

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
