# Project photo storage

Private uploads are implemented. Connecting photos to page components, version references, public serving, archive export, and user-facing deletion controls remains outstanding. Uploading a photo alone does not publish it or send its bytes to the AI provider.

## Upload contract

`PUT /api/projects/PROJECT_ID/files/UPLOAD_ID` requires a signed-in owner and matching Origin. The UUID is stable across retries. The request contains a prepared `image/jpeg` body and a URI-encoded `x-photo-name` header. API names are plain text, at most 100 characters; they never become storage paths. The browser accepts JPEG, PNG and WebP inputs up to 10 MiB, decodes orientation, resizes to fit 1600 × 1600, flattens transparency onto white, and encodes JPEG. A failed response retains the prepared bytes and ID for retry while the page remains open.

The server bounds the entire body to 1 MiB and accepts a constrained baseline JPEG envelope. It checks marker boundaries, dimensions, baseline scan framing and the final end marker; removes APP and comment segments, including EXIF/GPS, embedded thumbnails and profiles; then stores a checksum of the cleaned bytes. It does not fully decode JPEG pixels or scan image content. Invalid entropy data may still produce an unreadable image, but data is served only as image/jpeg with nosniff and sandbox headers. SVG, animated formats, progressive JPEG and arbitrary files are not accepted directly by the API. Browser preparation converts supported inputs to the accepted format.

## Ownership and storage

`project_files` records an immutable project, name, server-generated object path, checksum, dimensions and size. A pending reservation is written to D1 before R2 is called. D1 atomically enforces 20 photos per project, 50 per account and 500 across the test platform, including pending reservations. With 1 MiB per file, active photo storage is bounded to 500 MiB. There is no public bucket URL and no photo binding on the public-site Worker.

R2 writes use a create-only condition. Concurrent identical requests either create the object or verify its existing checksum and length. Different bytes or names under the same upload ID are rejected. A successful storage write is followed by an atomic D1 ready-state/audit commit. Lost R2 or D1 acknowledgements can be retried without overwriting or duplicating a photo. Pending reservations are not automatically expired; retry the original upload to finish them. Operator recovery is needed if the browser's prepared bytes were lost.

`GET /api/projects/PROJECT_ID/files` lists owned metadata; `GET /api/files/FILE_ID` rechecks the owner and ready state before reading R2. Responses are private/no-store and same-origin. Other owners receive 404; anonymous callers receive 401. These APIs do not reserve AI units.

## Cleanup

Deleting a project or account cascades D1 photo rows into a durable cleanup queue. The workspace Worker's daily 03:17 UTC handler retries up to 100 queued object deletions older than an hour. It also reads the at-most-500 retained object keys and scans up to 1,000 photo objects, batch-deleting old unreferenced objects. This catches a late object write after a deletion acknowledgement; the grace period avoids interfering with recent uploads. Large backlogs are drained over successive runs. Cleanup requires the scheduled handler to run successfully; it is not an immediate deletion guarantee. Individual file removal and customer account deletion flows are not exposed yet.

## Budget

The existing account already had R2 enabled. Before adding Whumpo, its only listed bucket had 8 objects totaling 7.92 MB. The separate `whumpo-files` bucket uses Standard storage, with r2.dev public access disabled. Cloudflare's published free tier currently includes 10 GB-month storage, 1 million Class A operations and 10 million Class B operations per month for Standard storage. These allowances are shared across the account. The app's storage and request limits reduce usage but do not impose an account-wide bill cap or reserve unused allowances from other applications. No paid image transformation or image generation service is used.

References: [R2 Workers API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/), [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [JPEG interchange format](https://www.w3.org/Graphics/JPEG/jfif3.pdf).
