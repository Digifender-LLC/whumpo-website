# Contact forms and private inbox

The first reusable dynamic capability is a platform-authored contact form, shared as implementation code while each project's settings and visitor messages remain separate. It runs on the existing workspace Worker and D1 database. No new paid service, outbound email provider, arbitrary customer code, or AI processing is involved in submission handling.

## Customer flow

1. Publish a saved website version.
2. Ask the agent to enable a contact form for the project. It prepares an exact review.
3. Confirm that review with its approval button within ten minutes.
4. The public host adds a Contact link to that live version. It opens a Whumpo-hosted form at `https://whumpo.com/contact/PROJECT_ID`.
5. Open Dashboard → Contact inbox to read messages. This panel does not copy visitor content into chat history or model context.
6. Ask the agent to disable the contact form. Confirming the disabling review stops new intake. Existing messages remain private until deletion or expiry.

Chat accepts natural language; slash-shaped strings in internal handlers and older fixtures are implementation details, not customer commands. See [natural-language Chat](natural-language-chat.md).

Publishing, restoring or unpublishing advances the publication revision and disables the previous form. Publication reviews disclose this effect. A fresh review is needed to activate intake for the new live version, including restoration of the same saved HTML. Contact settings are a hosted runtime capability: they do not alter the immutable site artifact, its checksum, private preview or static source ZIP.

## Review and transaction boundary

`contact_reviews` pins owner, project, desired enabled state, settings revision, publication revision and ten-minute expiry. D1 confirmation triggers recheck ownership, current settings, expiry, current publication for enablement, and the confirming chat turn. They atomically advance settings and record a content-free activity event with the chat receipt. Replays do not reapply changes. The model can prepare `contactReview` with an exact project ID and boolean; it cannot confirm, read the inbox or supply arbitrary backend code.

The public host joins the active setting into its existing publication read. The only injected markup is a fixed platform-authored link. Its sandbox permits opening that link in a separate browsing context; generated scripts and forms remain disabled. The destination has its own restrictive CSP and denies framing. Both the link and form require an active setting matching the current publication. The database rechecks this relationship at submission insertion, protecting against publication/disable races after bot verification.

[Saved service settings](project-service-clients.md) can also prepare this same independent contact review from the current saved configuration. The complete current schema includes immutable provenance, full current-target checks at confirmation and submission-time blocking for later known holds on the linked configuration. Critical direct disable reviews remain available. Test release `03b74965-16b8-4a41-8848-33cb1e21867f` records the earlier deployment of this capability; it does not establish deployment of the pending current identity/schema cutover. See the linked evidence for its local and live scope.

## Submission boundary

The public form accepts only name (1–100 characters), email (up to 254) and message (1–2,000), plus a random submission ID, settings revision and Turnstile token. POST requires exact Origin, URL-encoded input, unique allowlisted fields and a streaming 32 KiB body bound. The existing Workers rate limiter uses a separate contact/IP key. Deployed environments fail closed without Turnstile configuration.

Server-side Siteverify validates success, the platform hostname, `contact` action and exact project `cdata`. The response is bounded to 8 KiB, redirects are rejected and the request has a ten-second timeout. Local development alone can omit the challenge. Incoming visitor data and verification responses are not logged. No uploaded attachments, sender-selected recipient, email delivery or model processing is supported.

Database guards allow at most 20 accepted submissions per project in an hour, 100 per project and 1,000 platform-wide while receipts are retained. Concurrent submissions cannot bypass these caps. The capacity limit is shared across all plans during this test. Expired receipts may occupy capacity until daily cleanup; deletion does not recycle the allowance. Rate limiting is an application control, not an account-wide Cloudflare billing cap.

A minimal receipt stores submission ID, project, request hash and timestamps. Duplicate payloads reuse that receipt; different payloads using the same ID fail. Receipts survive owner deletion of message content until expiry, preventing retry resurrection and quota recycling. After the receipt's retention window, a newly bot-verified submission is treated as new. No automatic POST retry is performed after an uncertain response.

## Inbox and retention

Authenticated `GET /api/projects/PROJECT_ID/inbox` joins the project owner and returns only that project's unexpired messages, at most 100. Foreign projects return 404. `DELETE /api/contact-messages/MESSAGE_ID` checks authenticated ownership and Origin; the UI requires an explicit deletion confirmation. Deletion is idempotent and does not reveal foreign-message existence.

All submitted text is rendered with `textContent`, including names and email addresses; it is never interpreted as HTML or instructions. Closing the panel clears its content and invalidates pending reads. The AI's history and workspace context contain no automatic visitor-message read path. A customer manually pasting visitor content into chat is a separate action, subject to the existing AI-provider disclosure.

Messages become inaccessible at 30 days. Daily 03:17 UTC maintenance removes expired message rows and minimal receipts; physical deletion can therefore lag visibility expiry until that run. This is application retention, not a guarantee about provider backup retention. Project/account operator cleanup cascades through settings, reviews, messages and receipts. Customer-wide account deletion remains a separate unfinished lifecycle requirement.

## Verification

The current-schema checkpoint passes `node --stack-trace-limit=0 tests/contacts.mjs` on local D1 with admitted owner scopes; public submissions and cleanup keep separate authority. Expiry injection occurs immediately before the actual confirmation transaction. Turnstile responses are synthetic. See [verification](verification.md#website-contacts-directories-and-first-project-handoff) for precise scope and remaining live/browser gates.

`pnpm test:contacts` uses disposable local D1 state and controlled provider responses. It covers review/confirmation and replay, cross-owner access, duplicate and deleted-message replay, public rendering, Origin rejection, body bounds, Turnstile hostname/action/project checks, oversized verification responses, publication and disable races, atomic hourly/project/global caps, expiry inside confirmation, forbidden model confirmation/inbox reads, context exclusion and retention cleanup. Publication and site-agent regressions also pass.

Historical browser inspection of a synthetic inbox verified the then-current inbox entry, readable status and messages, and literal display of markup in a visitor name. That evidence does not establish the current Dashboard entry's browser acceptance. Live acceptance results are recorded in `docs/deployment.md`. Successful real Turnstile completion remains a distinct browser acceptance gate; seeded live inbox fixtures do not prove that flow.

Sources: [Cloudflare D1 batching](https://developers.cloudflare.com/d1/worker-api/d1-database/), [Turnstile server validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/), and [Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), checked September 29, 2026.
