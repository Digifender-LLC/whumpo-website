# Reusable directory service

The business-directory starter adds a small hosted CRUD application to the existing static-site and contact-form capabilities. One platform-authored backend serves separate project-owned collections. It requires no additional Cloudflare service, subscription, provider credential or executable customer code.

## Customer workflow

1. Create a project through chat. Publish its website before publishing a directory.
2. Use Details → Directories or `/directory` to choose a project, then `/directory PROJECT_ID` to inspect the private draft.
3. Add a listing with `/directory-add PROJECT_ID | title | description | optional HTTPS link`.
4. Read the exact proposed change and press **Confirm reviewed directory change**, or send `/confirm-directory REVIEW_ID`.
5. `/directory-edit PROJECT_ID LISTING_ID | title | description | optional HTTPS link` replaces a listing after review. `/directory-remove PROJECT_ID LISTING_ID` reviews removal from the private draft.
6. `/directory-publish PROJECT_ID` reviews the complete snapshot for public exposure. Confirm it separately. The chat receipt links to the published directory.
7. `/directory-off PROJECT_ID` reviews taking both public endpoints offline. Private data and review history remain.

Natural-language requests use the same read/review operations. The model cannot authorize a review. Guided commands use no AI units; natural-language interpretation uses the normal metered provider. Listing text and link casing are preserved. Pipe separators belong to the guided syntax; natural-language fields may contain pipes.

## Publication and APIs

- `GET /api/projects/PROJECT_ID/directory` returns the authenticated owner's private draft, revision and publication status.
- `GET https://sites.digifender.com/s/PROJECT_ID/directory` renders the current approved snapshot as a responsive page.
- `GET https://sites.digifender.com/s/PROJECT_ID/directory.json` exposes that same snapshot as JSON (`name`, `publishedAt`, `listings`). Each listing has stable `id`, `title`, `description` and `url` fields.
- Public endpoints accept GET/HEAD only, use no-store, and never return the private draft or review history. Public JSON allows cross-origin reads without credentials. There is no unauthenticated write API.

Draft create/update/delete operations do not change the public snapshot. Publication binds the collection to the current parent website publication revision. Publishing or restoring the parent website disables the directory until another explicit review. Unpublishing the parent removes public access. A directory update does not mutate the immutable website artifact. Directory runtime data and backend code are not included in static source ZIPs or GitHub static backups. Custom-domain directory paths and directory-specific health checks are not implemented yet.

## Data and authorization

Migration 0030 stores one private draft and one separately approved public snapshot per project, plus exact review snapshots and digests. Each review expires after ten minutes. Any intervening directory action invalidates older reviews. Publication also checks the parent publication revision. Database triggers enforce owner identity, compare-and-swap revisions, atomic review application and a matching explicit guided confirmation turn. A stale confirmation rolls back its chat receipt; retrying an applied review cannot apply it twice.

Titles are at most 100 characters, descriptions 500, and HTTPS links 250. Control characters, executable URL schemes and embedded credentials are rejected. The renderer escapes all tenant text and uses a script-free sandboxed document. Links are displayed, never fetched by the backend. Listing IDs cannot select another project's records. Shared code and synthetic examples contain no customer content; no tenant data is promoted into the component library.

The test allows 25 listings and a 24 KiB snapshot per project, 100 retained edit/publication reviews per project, and 2,000 stored draft-plus-live listing slots across the platform. Reaching the retained edit/publication-review limit currently requires operator intervention for further changes. Taking a directory offline and reading/exporting existing history remain available. Automatic pruning is not implemented. Deleting a draft listing does not erase its previous reviews, chat receipts or public copies. Account/project cascade cleanup removes owned directory rows. There is no standalone account-deletion UI yet.

## Verification

The disposable D1 suite tests owner/project boundaries, private CRUD reviews, exact public snapshots, concurrent/stale revisions, replay, public read-only behavior, parent-publication invalidation, escaped hostile HTML, rejected link schemes, AI confirmation restrictions, schema bounds and cleanup. Browser inspection covers desktop and 390-pixel responsive layout using synthetic community listings. Production acceptance is recorded separately in deployment.md.

This starter advances the small dynamic apps/APIs requirement. It does not provide arbitrary schemas, generated backend execution, customer-site authentication, rollback for arbitrary application schemas or a portable backend export. Those remain broader MVP work.

## Saved data, restoration and downloads

Migration 0031 adds immutable source-snapshot ancestry and chat-bound export links. `/directory-history PROJECT_ID` lists up to 100 applied edit/publication snapshots with revision, application time, listing count, digest and any restoration source. Pending proposals and offline-only operations are not recovery sources.

`/directory-restore PROJECT_ID SNAPSHOT_ID` prepares an exact replacement of the private draft. The review shows both the current draft and proposed replacement, including removed records. Confirmation uses the existing ten-minute, owner-scoped revision check. A concurrent change invalidates the review. The original listing IDs and complete listing data are preserved, and the new applied snapshot records its source. Restoration never modifies the public directory or the immutable website version. A separate directory publication review makes restored data public. An empty saved collection can be restored too.

`/directory-export PROJECT_ID SNAPSHOT_ID` attaches an authenticated download link to the chat turn. It returns private JSON with format `whumpo-directory`, schema version 1, project metadata, snapshot identity/time, source ancestry, listing SHA-256 and exact saved listings. The digest covers the serialized listing array, not the complete export wrapper. This is a data export, not an executable backend bundle or import endpoint. Public readers cannot download private history.

API reads: `GET /api/projects/PROJECT_ID/directory/history` and `GET /api/projects/PROJECT_ID/directory/snapshots/SNAPSHOT_ID/export`. They enforce both owner and project boundaries. Exports use an attachment filename, JSON content type, no-store and nosniff. Each request rechecks ownership and artifact digest. The public JSON route continues serving only the approved public snapshot.

Natural language may list history, prepare restoration, or attach an export. It cannot confirm restoration. Database triggers verify the copied source is an applied snapshot from the same owner/project with identical bytes/digest and prevent ancestry changes. Confirmations continue to require a matching guided user turn. Review history is retained until project/account cleanup; exporting does not change retention or grant another account access.
