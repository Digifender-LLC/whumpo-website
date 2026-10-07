# Reusable directory service

The business-directory starter adds a small hosted CRUD application to the existing static-site and contact-form capabilities. One platform-authored backend serves separate project-owned collections. It requires no additional Cloudflare service, subscription, provider credential or executable customer code.

## Customer workflow

1. Start a project, then ask Chat to inspect or create its directory. Publish the website before publishing a directory.
2. Ask to add a listing with its title, description and optional HTTPS link.
3. Read the exact proposed change and press **Confirm reviewed directory change**.
4. Ask to edit or remove a listing, then confirm that exact private-draft change.
5. Ask to publish the directory. Review and confirm the complete public snapshot separately. The saved receipt links to it.
6. Ask to take the directory offline and confirm the review. Both public endpoints stop serving it; private data and review history remain.

Customer Chat accepts natural language. Internal dispatch strings in domain handlers and fixtures are not a public command interface. Models prepare reviews; only the owner's typed review control can authorize them. Standard owner assistance has zero customer-unit debits, with provider usage accounted for internally. Listing text, link casing and literal pipe characters are preserved. See [natural-language Chat](natural-language-chat.md).

## Publication and APIs

- `GET /api/projects/PROJECT_ID/directory` returns the authenticated owner's private draft, revision and publication status.
- `GET https://PROJECT_ID.whumpo.site/directory` renders the current approved snapshot as a responsive page.
- `GET https://PROJECT_ID.whumpo.site/directory.json` exposes that same snapshot as JSON (`name`, `publishedAt`, `listings`). Each listing has stable `id`, `title`, `description` and `url` fields.
- Public endpoints accept GET/HEAD only, use no-store, and never return the private draft or review history. Public JSON allows cross-origin reads without credentials. There is no unauthenticated write API.
- **Module envelope (WH-129, source only, not deployed).** When the owner saves and activates a `content` module instance (`directory-listing@1`), that instance is this directory: `collections.readPublic` on the visitor origin returns the same approved snapshot, and the instance descriptor's export hook is the snapshot export below. Draft, publication, restore and export stay the reviews on this page. See [content collections module](shared-modules.md#content-collections-module-wh-129--october-4-2026-utc).

Draft create/update/delete operations do not change the public snapshot. Publication binds the collection to the current parent website publication revision. Publishing or restoring the parent website disables the directory until another explicit review. Unpublishing the parent removes public access. A directory update does not mutate the immutable website artifact. Directory runtime data and backend code are not included in static source ZIPs or GitHub static backups. The same `/directory` and `/directory.json` paths now work on an approved active custom hostname while its existing serving lease is valid. The shared and custom paths use the same approved snapshot reader; disabled, disconnected or expired host mappings expose nothing. Directory-specific health checks and real-domain acceptance remain outstanding; this source change provisions no domain or DNS record.

## Data and authorization

The complete current schema stores one private draft and one separately approved public snapshot per project, plus exact review snapshots and digests. Each review expires after ten minutes. Any intervening directory action invalidates older reviews. Publication also checks the parent publication revision. Database triggers enforce owner identity, compare-and-swap revisions, atomic review application and a matching explicit owner confirmation turn. A stale confirmation rolls back its chat receipt; retrying an applied review cannot apply it twice.

Titles are at most 100 characters, descriptions 500, and HTTPS links 250. Control characters, executable URL schemes and embedded credentials are rejected. The renderer escapes all tenant text and uses a script-free sandboxed document. Links are displayed, never fetched by the backend. Listing IDs cannot select another project's records. Shared code and synthetic examples contain no customer content; no tenant data is promoted into the component library.

The test allows 25 listings and a 24 KiB snapshot per project, 100 retained edit/publication reviews per project, and 2,000 stored draft-plus-live listing slots across the platform. Reaching the retained edit/publication-review limit currently requires operator intervention for further changes. Taking a directory offline and reading/exporting existing history remain available. Automatic pruning is not implemented. Deleting a draft listing does not erase its previous reviews, chat receipts or public copies. Account/project cascade cleanup removes owned directory rows. There is no standalone account-deletion UI yet.

## Verification

The current-schema checkpoint passes `node --stack-trace-limit=0 tests/directories.mjs` and `node --stack-trace-limit=0 tests/directory-history.mjs` on local D1. Current owner admission covers maintenance, while public reads remain independent. Typed owner controls authorize exact changes; fixtures also exercise internal proposal adapters. See [verification](verification.md#website-contacts-directories-and-first-project-handoff). No browser/device or remote acceptance was added.

The disposable D1 suites test owner/project boundaries, private CRUD reviews, exact public snapshots, concurrent/stale revisions, replay, public read-only behavior, parent-publication invalidation, escaped hostile HTML, rejected link schemes, AI confirmation restrictions, schema bounds and cleanup. Earlier browser inspection covered desktop and 390-pixel responsive layout using synthetic community listings; that historical evidence does not establish current browser/device acceptance. Test-platform deployment evidence is recorded separately in [deployment](deployment.md).

This starter advances the small dynamic apps/APIs requirement. It does not provide arbitrary schemas, generated backend execution, customer-site authentication, rollback for arbitrary application schemas or a portable backend export. Those remain broader MVP work.

## Saved data, restoration and downloads

The current schema includes immutable source-snapshot ancestry and chat-bound export links. Ask Chat for the project's directory history to list up to 100 applied edit/publication snapshots with revision, application time, listing count, digest and any restoration source. Pending proposals and offline-only operations are not recovery sources.

Ask to restore a saved snapshot to prepare an exact replacement of the private draft. The review shows both the current draft and proposed replacement, including removed records. Confirmation uses the existing ten-minute, owner-scoped revision check. A concurrent change invalidates the review. The original listing IDs and complete listing data are preserved, and the new applied snapshot records its source. Restoration never modifies the public directory or the immutable website version. A separate directory publication review makes restored data public. An empty saved collection can be restored too.

Ask to download a saved directory snapshot to attach an authenticated download link to the chat turn. It returns private JSON with format `whumpo-directory`, schema version 1, project metadata, snapshot identity/time, source ancestry, listing SHA-256 and exact saved listings. The digest covers the serialized listing array, not the complete export wrapper. This is a data export, not an executable backend bundle or import endpoint. Public readers cannot download private history.

API reads: `GET /api/projects/PROJECT_ID/directory/history` and `GET /api/projects/PROJECT_ID/directory/snapshots/SNAPSHOT_ID/export`. They enforce both owner and project boundaries. Exports use an attachment filename, JSON content type, no-store and nosniff. Each request rechecks ownership and artifact digest. The public JSON route continues serving only the approved public snapshot.

Natural language may list history, prepare restoration, or attach an export. It cannot confirm restoration. Database triggers verify the copied source is an applied snapshot from the same owner/project with identical bytes/digest and prevent ancestry changes. Confirmations require a matching explicit owner control receipt. Review history is retained until project/account cleanup; exporting does not change retention or grant another account access.


## Shared lifecycle restoration and custom hosts — October 7, 2026 UTC

Source implemented and tested locally; not deployed or accepted on a real custom hostname. An active leased custom-domain mapping now admits only the existing root/assets routes plus the exact `/directory` and `/directory.json` paths. GET and HEAD have the same snapshot and no-store policy as the shared host; other paths remain unavailable. Parent website publication or restore invalidates the directory on every hostname until the owner reviews publishing it again. Hosting proof, certificate and provider checks stay in the existing reviewed hosting workflow.

The content collection descriptor now names `collections-directory-restore-v1`. Its owner-only `prepareCollectionRestore` adapter and typed `collectionRestoreReview` control select a retained applied snapshot by project, logical resource, current configuration revision and snapshot ID. They prepare the existing ten-minute directory restore review; the existing recent-sign-in confirmation is still required to replace only the private draft. Public bytes and module activation remain unchanged until their own reviews. Disabled modules retain owner recovery; stale or withdrawn compiler/module pins, an unsupported hook, a changed saved collection, unknown snapshots and foreign ownership are refused explicitly. The committing preparation and confirmation both check the immutable control's resource/configuration, current source/head compiler lock and exact applied snapshot ancestry. No arbitrary file import, new table, serializer, schema type or staff edit is introduced.

`tests/shared-modules-collections.mjs` now has nine groups (SQLite and current local D1), including shared/custom snapshot equality, private draft exclusion, read-only/HEAD behavior, foreign path/host refusals, domain lease/disconnect and parent-restore invalidation, plus exact lifecycle restore preparation/confirmation, lost-response replay, disabled recovery, stale/withdrawn pins, forged resource revision, hook change before confirmation and concurrent draft changes. The existing `tests/directories.mjs` and `tests/directory-history.mjs` run on local D1. All provider responses and identities in these checks are synthetic; no DNS or hosting operation is sent to a real provider. This slice does not change the review-history ceiling or claim directory-specific network health acceptance.
