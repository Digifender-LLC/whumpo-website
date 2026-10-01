# Saved-version retention and reviewed removal

Projects retain up to 25 complete immutable site versions. Ask the agent to list saved versions or prepare removal of a specific version. A ten-minute review names the exact owned version; the user confirms through its typed Chat control. The model cannot confirm it. Confirmation uses no inference, and standard AI interpretation remains unlimited fair use with zero customer-unit debits. Internal slash adapters are not public Chat commands; see [natural-language Chat](natural-language-chat.md).

The review identifies the project, exact version and creation time; the server also pins its component and digest. It explains that the saved HTML/configuration and preview, download and restore links will be removed. Copies already downloaded are outside this deletion. Original project photos remain; removing the version only releases its `version_photos` references. Photos with no remaining version references can then be removed through the separate photo-review flow. Independently saved child versions contain full artifacts and remain usable. Their `base_version_id` remains a provenance identifier even when that ancestor no longer exists.

## Transaction and protection

Migration 0024 adds immutable version-removal reviews. The confirmation turn, state revision, applied review, version deletion and activity event commit in one D1 batch. The database checks exact owner, project, version digest/component/creation time and review expiry. A `BEFORE DELETE` guard rechecks dependencies at deletion time, including ones added after review:

- A currently published version cannot be removed.
- A [saved specification](project-specification-storage.md) head and any version needed as a base/target by an unexpired unapplied specification review are retained (migration 0110). Removing an eligible version also removes its full specification snapshot and associated proposal/diff copies. Independent later snapshots remain; metadata-only apply receipts prevent resurrection through retries.
- [Saved service settings](project-service-clients.md) retain the website used by their current head and unexpired unapplied proposal/base/restore references. Eligible removal purges full companion snapshots and proposal/comparison copies while preserving metadata-only replay receipts. Pending unexpired activation reviews also retain their saved configuration and website; immutable metadata remains after eligible source deletion so old reviews cannot lose their provenance and reactivate. These protections are implemented and deployed through migrations 0112/0113; [service-client evidence](project-service-clients.md) supersedes the older deployment inventory below.
- An unexpired pending publication/restore review retains its version until expiry.
- Any GitHub backup record retains its source version to preserve external-operation recovery and receipts. Removing backed-up versions requires a future receipt-retention design; it is not currently supported.
- Direct deletion without an applied exact removal review is rejected while the parent project exists.

Applied reviews retain the version identity/digest as tombstones. Reusing that version ID cannot recreate content, and replaying the original draft chat turn returns the old result without executing it. Repeated removal confirmations do not duplicate the activity event. Expired reviews require a fresh explicit review. Stale chat revisions cannot confirm anything.

Version deletion cascades its photo-reference rows, authenticated export-link rows and publication-action rows tied to that deleted version. Historical chat text and activity remain; an old message is not evidence that its preview or restore target still exists. Applied removal reviews preserve exact removal identity. The live publication pointer cannot be removed by this flow. There is no background version pruning, trash/restore for removed versions, customer project/account deletion or external GitHub deletion in this release.

Parent project/account cascading deletion remains possible for explicit operator cleanup. Those operator paths require their own external-resource review before use on customer accounts and are not exposed as a customer delete route.

## Verification

`test:version-removal` covers owner isolation, no mutation before confirmation, atomic confirmation/replay, live/publication/backup references added after review, export-link invalidation, photo preservation and later photo cleanup, recovering a full project's version slot, expiry inside the transaction, unreviewed delete rejection, model confirmation rejection, lost database acknowledgement and parent cascade. Existing photo-removal regression tests cover retained assets and physical cleanup independently.

## Deployment evidence — September 29, 2026

Migration 0024 was applied locally and remotely. Platform version: `33b737b3-b224-477b-ab6d-226d17192395`; public-site Worker version: `80b6e5f1-ef3d-4da2-bbd7-f97ff0783f5e`. TypeScript, build, disposable version-removal tests and photo-removal regression tests passed. Local browser inspection verified the exact review text and confirmation button using a synthetic fixture; no deletion was performed in that browser fixture.

Live signed-passkey acceptance created two temporary drafts, published one, reviewed and removed the other, and verified deleted preview/export routes returned 404. Replaying removal and original creation did not recreate the version. The unrelated live page stayed available and a removal request for that live version was refused. Guided commands used zero AI units. The temporary publication was explicitly unpublished, then the temporary account and project were removed. Real-device passkey acceptance and the broader MVP gates remain separate.

## Comparison links

Migration 0026 adds exact target/baseline links for chat comparisons. Removing either referenced version clears that link receipt. An explicit missing baseline is rejected by the comparison route rather than substituted with another version. Historical chat summaries remain under chat retention. See `docs/version-comparisons.md`.
