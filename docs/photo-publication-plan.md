# Connecting photos to saved websites

This is the next implementation contract, not a description of deployed behavior. Private uploads are implemented in photos.md.

## Versioned component

Add a new immutable component ID for pages with photos, preserving existing renderers. Its validated configuration references project-owned ready photo IDs and plain-text alt descriptions. Never accept image URLs, R2 keys, inline SVG, arbitrary markup or credentials from the model. The planner may see owned photo IDs, names and dimensions; photo bytes do not go to the model in this phase. It must not invent visual descriptions it has not been given.

Save a normalized version-to-photo relation in the same D1 transaction as the immutable HTML, chat response and token receipt. Every referenced file must belong to that version's project and be ready. Preserve original text-only component behavior, focused-edit ancestry and restore semantics. Reject cross-project references even when the same account owns both projects.

## Private preview

Keep the current authenticated preview route and sandbox. One option is to replace assembler-owned image placeholders with bounded JPEG data URLs at response time. This avoids distributing bearer URLs and avoids relying on session cookies from an opaque sandbox origin. Limit references and total bytes; fetch only exact version-bound objects. Permit only data images in preview CSP while keeping scripts, forms and network resources disabled. Stored HTML stays immutable; the preview response is assembled from immutable dependencies. This design needs a browser verification before adoption.

## Publication

The separate public-site Worker can receive the private bucket binding, but it must serve only photos referenced by the project's current published version. An uploaded photo, an old version's unreferenced photo, or a guessed ID returns 404. Restore switches the exact version and its file references together. Unpublish revokes HTML and image access immediately; retain no-store responses during testing. Bucket public access remains disabled.

Use relative asset paths in stored HTML and a canonical trailing slash on the public page URL so those paths resolve correctly. Public image routes include both project and photo IDs, and enforce the current publication relation before reading R2. A publication review must explicitly say attached photos become public, replacing its text-only exposure warning.

## Portable export

Extend the ZIP to include every exact referenced JPEG under public/assets. Keep metadata outside public, validate checksums and byte bounds, and fail with a clear retryable error if a required object is missing. Do not return a misleading partial export. Text-only exports stay byte-compatible where possible. Browser opening of the extracted HTML must display the included photos without network requests.

## Deletion and acceptance

User-facing file deletion must respect retained versions and the cleanup queue; it must not silently break publication or restore. Decide on removing unused files versus retaining dependencies before adding a delete button.

Acceptance evidence: no photo publication on upload/draft; same-owner cross-project rejection; cross-owner read rejection; private preview works with sandbox; public image appears only after exact confirmation; restore/unpublish change image access; archive reproduces images offline; private-only metadata and credentials are absent; publication receipt describes image exposure; no vision/model charge for ordinary file operations.
