# Project photo storage

Private uploads, versioned photo pages, authenticated previews, confirmed public serving, and portable image exports are implemented. Reviewed removal of unused photos is available in chat and the photo panel. Photos referenced by any saved version are retained. Uploading a photo alone does not publish it or send its bytes to the AI provider.

## Upload contract

`PUT /api/projects/PROJECT_ID/files/UPLOAD_ID` requires a signed-in owner and matching Origin. The UUID is stable across retries. The request contains a prepared `image/jpeg` body and a URI-encoded `x-photo-name` header. API names are plain text, at most 100 characters; they never become storage paths. The browser accepts JPEG, PNG and WebP inputs up to 10 MiB, decodes orientation, resizes to fit 1600 × 1600, flattens transparency onto white, and encodes JPEG. A failed response retains the prepared bytes and ID for retry while the page remains open.

The server bounds the entire body to 1 MiB and accepts a constrained baseline JPEG envelope. It checks marker boundaries, dimensions, baseline scan framing and the final end marker; removes APP and comment segments, including EXIF/GPS, embedded thumbnails and profiles; then stores a checksum of the cleaned bytes. It does not fully decode JPEG pixels or scan image content. Invalid entropy data may still produce an unreadable image, but data is served only as image/jpeg with nosniff and sandbox headers. SVG, animated formats, progressive JPEG and arbitrary files are not accepted directly by the API. Browser preparation converts supported inputs to the accepted format.

## Ownership and storage

`project_files` records an immutable project, name, server-generated object path, checksum, dimensions and size. A pending reservation is written to D1 before R2 is called. D1 atomically enforces 20 photos per project, 50 per account and 500 across the test platform, including pending reservations. With 1 MiB per file, active photo storage is bounded to 500 MiB. There is no public bucket URL. The public-site Worker uses its private bucket binding only after checking the current publication’s exact photo references.

R2 writes use a create-only condition. Concurrent identical requests either create the object or verify its existing checksum and length. Different bytes or names under the same upload ID are rejected. A successful storage write is followed by an atomic D1 ready-state/audit commit. Lost R2 or D1 acknowledgements can be retried without overwriting or duplicating a photo. Pending reservations are not automatically expired; retry the original upload to finish them. Operator recovery is needed if the browser's prepared bytes were lost.

`GET /api/projects/PROJECT_ID/files` lists owned metadata; `GET /api/files/FILE_ID` rechecks the owner and ready state before reading R2. Responses are private/no-store and same-origin. Other owners receive 404; anonymous callers receive 401. These APIs do not reserve AI units.

## Cleanup

Deleting a project or account cascades D1 photo rows into a durable cleanup queue. The workspace Worker's daily 03:17 UTC handler retries up to 100 queued object deletions older than an hour. It also reads the at-most-500 retained object keys and scans up to 1,000 photo objects, batch-deleting old unreferenced objects. This catches a late object write after a deletion acknowledgement; the grace period avoids interfering with recent uploads. Large backlogs are drained over successive runs. Cleanup requires the scheduled handler to run successfully; it is not an immediate deletion guarantee. Individual unused-photo removal is described below. Customer account deletion and removal of saved versions are not exposed yet.

## Budget

The existing account already had R2 enabled. Before adding Whumpo, its only listed bucket had 8 objects totaling 7.92 MB. The separate `whumpo-files` bucket uses Standard storage, with r2.dev public access disabled. Cloudflare's published free tier currently includes 10 GB-month storage, 1 million Class A operations and 10 million Class B operations per month for Standard storage. These allowances are shared across the account. The app's storage and request limits reduce usage but do not impose an account-wide bill cap or reserve unused allowances from other applications. No paid image transformation or image generation service is used.

References: [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [JPEG interchange format](https://www.w3.org/Graphics/JPEG/jfif3.pdf).

## Versioned use and operation budgets

Use in website or `/photo FILE_ID` creates a private immutable page version without inference. `photo-page@1` supports up to four ready photos from the same project. AI edits can change those references and alt text; the model sees photo names and dimensions, not pixels. Photo bytes never enter the generic component catalog.

Private previews embed verified JPEG data URLs under a sandboxed CSP. Publication reviews disclose photo exposure; public assets are available only while referenced by the current published version. Restore switches the references with the saved HTML. Source ZIPs include exact JPEG dependencies under `public/assets`; unavailable or mismatched files fail the export. See [the version contract](photo-publication-plan.md).

Atomic monthly counters cap application R2 reads at 100,000 and writes at 10,000. Reservations count attempted operations, including retries. A photo allowance error leaves text HTML available. The small daily cleanup workload is outside these counters. These caps do not cover other applications or constitute an account-wide billing limit.


## Reviewed photo removal

`/photos [PROJECT_ID]` lists owned photo IDs, pending/ready state and saved-version counts in chat (latest project by default). “Open project photos” or the Project photos screen opens the photo panel. `/files` lists saved metadata in Chat. “Review deletion” sends `/delete-photo PHOTO_ID`; the reply names the exact photo/project and warns that removal is irreversible. `/confirm-photo-delete REVIEW_ID` or its confirmation button applies the review within ten minutes. Both commands are free, explicit guided user actions; no model proposal can confirm a removal.

Migration 0021 saves owner-scoped reviews. The confirmation, chat receipt, photo-row deletion, durable R2 cleanup key and activity event commit atomically. Expiry and ownership are checked again at mutation time. Confirmation replays recover the original chat result. Applied reviews prevent the original upload ID from resurrecting a removed photo; a deliberate new upload requires a new ID. These receipts remain while the project/account exists.

A photo used by **any** saved version cannot be removed, including private drafts and old versions. A database guard protects against a version attaching the photo between review and confirmation. Removing a photo from a newer draft does not remove older references. Existing project/account cascades remain possible for operator cleanup. A future saved-version deletion policy is required before a customer can remove retained assets.

Pending uploads can also be removed. Access stops when confirmation commits, but physical R2 deletion waits for the daily queue and orphan sweep. A late in-flight upload cannot restore its deleted metadata; the orphan sweep eventually removes its bytes. Cleanup failures retain the queue for retry. Active file rows **plus queued deletions** count toward the 500-object platform capacity, so deleting/uploading repeatedly does not evade that capacity while cleanup is pending. Project/account active-photo limits still apply separately.

Verification: `test:photo-removal` covers approval before mutation, ownership, repeated and racing confirmations, upload-ID tombstones, delayed cleanup and late orphan writes, retained-version protection, post-review attachment, commit-time expiry, immutable review identity, lost acknowledgement recovery, storage capacity and account cascades. Existing upload and photo-version suites cover the surrounding storage and rendering contracts. Browser testing uses a local disposable API fixture and verifies review and confirmation controls; it does not prove provider cleanup.

Deployment acceptance (September 29, 2026): migration 0021 applied locally and remotely. Main Worker `64484db2-3b51-47f5-81b4-008e55146605`; public Worker `efc431a2-0697-4265-abc5-4f9557dd920d`. A temporary passkey account uploaded a synthetic JPEG through the live API, listed it in chat, reviewed and confirmed its removal, verified authenticated reads then returned 404, retried the same confirmation without another effect, and verified re-upload under the removed ID returned 409. Build usage stayed at zero. The live durable cleanup row was verified; fixture bytes were subsequently removed with an operator cleanup and the temporary account deleted. Scheduled production cleanup timing was not exercised by this check. TypeScript, chat, upload, photo-version and photo-removal checks passed. The final CSS-only deployment did not change the verified server logic.

## Photo inventory directly in Chat — September 30, 2026

`/files`, `/photos`, “show files” and “show photos” now stay in Chat. Slash commands accept an optional exact owned project ID; otherwise the latest-created owned project is used and named in the reply. A customer with no matching project receives guidance without disclosure of foreign metadata. Malformed IDs/extra arguments are rejected.

The free guided reply shows quoted names, upload state, dimensions, byte size, retained-version count and photo ID. It labels the result as a saved snapshot and explicitly does not certify current storage availability or publication. It fetches no R2 object or image bytes and exposes no storage key. Replay returns the original Chat receipt. “Open project photos” and “upload a photo” still open controls; `/delete-photo` retains separate review and confirmation. Help text now matches these routes. Filename text cannot introduce new lines into the inventory structure.

Verification: `pnpm check`, `pnpm test:photo-removal`, `pnpm test:workspace-navigation` and diff checks passed. Both isolated-release TypeScript projects, `node tools/build.mjs` and `node tests/frontend-loading.mjs` passed. Connected D1/R2 tests cover all inventory aliases with AI configured, metadata fields, guided mode, omitted object keys, foreign-project refusal, malformed IDs and replay, alongside existing upload/removal/retention tests. A 390px browser fixture using release assets rendered the inventory inside Chat with document width 390px and navigated to Photos only on “open project photos”; exactly one Chat write occurred. Evidence: `.secrets/photo-chat-browser-evidence.json`, `.secrets/photo-chat-mobile.png`. Fixture replies are synthetic; this does not establish physical touch or live customer upload acceptance.

Deployed September 30, 2026 to test platform `34ebde22-7a88-4ba1-b6a7-8a24befd75c7`. Independent readback verified the active version, all 16 frontend assets matching the release, health 200 and anonymous Chat/project-file reads 401. Evidence: `.secrets/photo-chat-release-verification.json`. No migration, R2 visibility change, customer upload/removal or publication was performed.
