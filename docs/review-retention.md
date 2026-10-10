# Review and receipt retention (WH-061)

**Status: planned. Design and offline reference only (WH-180, October 9, 2026 UTC, at `ca17c6a`; ported onto `d3ebaf2` the same day with the same 640 triggers and 88 capped tables; re-ported onto `4dea09c` the same day after WH-050 (#186) added reviewed operator retention, where `--inventory` and the contract test report 648 triggers and 90 capped tables: `operator_retention_receipts` and `operator_session_revocations` are new R5 operator evidence rows, and `operator_containments` is now deleted by the reviewed `operator_retention_apply` cleanup trigger; the ceiling, shared-ceiling and other-lifetime sets are unchanged; rebuilt onto `d948f06` on October 10, 2026 UTC, where no schema input had changed since `89fa009` and `--inventory` again reports the same 90 rows from 648 triggers over 221 tables).** Nothing here is implemented, deployed or accepted. No schema, trigger, route, scheduled job or Worker source changes. Every trigger change below is a proposal. It needs the owner-run empty-D1 cutover (`pnpm run deploy prepare/apply` with `schemaChange: "initialize"`, see [releases](releases.md)), which wipes test data.

WH-061's outcome: directory owners can maintain a live snapshot on supported domains without eventually hitting an unrecoverable private-test receipt ceiling. This document:

- inventories every row-count capacity trigger in the complete current schema;
- classifies review and receipt rows by state;
- chooses a retention design; and
- specifies the exact cutover, the directory serving agreement and the child slices.

The offline reference is [`tools/prototypes/review-retention.mjs`](../tools/prototypes/review-retention.mjs) and its conformance suite is [`tests/review-retention-contract.mjs`](../tests/review-retention-contract.mjs). The suite reads the canonical schema inputs, `src/`, `tools/` and [`data-lifecycle.json`](data-lifecycle.json), so the inventory and sets below cannot drift from the real triggers.

## Problem

Two failures share one cause: review and receipt rows that stay in a table after they stop mattering still count against a capacity trigger, and only project or account deletion removes them.

- **Per-project ceiling (directories).** `directory_review_insert` refuses the 101st non-offline directory review for a project. Applied, expired and superseded reviews all count, nothing deletes them, and [directories](directories.md) says that reaching the limit "currently requires operator intervention". `tests/directory-history.mjs` fills the cap and shows that only taking the directory offline still works.
- **Shared ceiling (B1).** The WH-004 [boundary audit](boundary-audit.md#b1-platform-wide-review-capacity-can-be-exhausted-by-one-owner-low-availability-cross-tenant) finding B1 (on `main` since #224; reproduced by `tests/boundary-review-capacity.mjs`) shows this: one owner fills a platform-wide 1,000-row review table across their own projects, and every other owner's next review fails with "review storage is full". The safety withdrawal path in [`src/service-safety.ts`](../src/service-safety.ts) prepares `backend_publication_reviews` and `app_page_reviews` rows, so a full table also blocks withdrawals.

The inventory below shows the same pattern in 22 tables with a platform-wide lifetime cap and 6 more with a lifetime per-project or per-owner cap.

## Capacity inventory (machine-checked)

Regenerate with `node tools/prototypes/review-retention.mjs --inventory`. The rows must match exactly.

The suite derives the first three columns from the composed schema: each `(SELECT count(*)|sum(…) FROM t …)` that a trigger compares against an integer literal with `>=` or `>`.

- **Counted table:** `a+b` means a summed cap across two tables.
- **Caps column:** each entry is a scope and its limit. `≤N` means the sum must stay at or below N. *(window)* marks a time-window counter; *(filtered)* marks a count that applies a row-state predicate.

**Deleted by** is computed from code. It is `app` when a `DELETE FROM` exists in `src/` or `tools/` (outside prototypes), `trigger` when a schema trigger deletes rows, `cascade` when a parent has `ON DELETE CASCADE`, and `none` otherwise.

The WH-009 class comes from [`data-lifecycle.json`](data-lifecycle.json). Class, lane and turnover come from the reference's registry, and the suite checks them for consistency with the computed columns.

Class, lane and turnover values:

- **Class:**
  - `review` is a prepared review that becomes an applied receipt.
  - `receipt` is an applied, idempotency, run or link receipt.
  - `operation` is an external dispatch with unknown-outcome states.
  - `version` is a referenced artifact or live slot.
  - `evidence` is restricted safety or operator evidence.
  - `inventory` is a live identity or resource row.
  - `rate` is a windowed counter.
- **Lane:**
  - R1: active caps and compaction.
  - R2: receipt ring with a replay horizon.
  - R3: reconcile first, then compact.
  - R4: [version retention](version-retention.md).
  - R5: restricted ([WH-015](data-lifecycle.md#wh-015-restricted-cases--october-4-2026-utc) cases, or WH-050 operator records removed only by reviewed operator cleanup, see [capacity and fairness](capacity-and-fairness.md)); never pruned here.
  - R6: unchanged.
- **Turnover today:**
  - `lifetime`: terminal rows count until project or account cleanup.
  - `pending-only`: the cap excludes applied or expired rows.
  - `expiring`: a sweep deletes expired rows.
  - `window`: a time-window counter.
  - `owner-removable`: the owner can remove live rows.
  - `restricted`: WH-015 retention decisions or WH-050 reviewed operator cleanup govern removal.

<!-- review-retention:inventory:start -->
| Counted table | Capacity trigger(s) | Caps | Class | Lane | Turnover today | Deleted by | WH-009 class |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `app_activation_reviews` | `app_activation_admit` | project 100 · platform 1000 | review | R1 | lifetime | none | visitor-app-data |
| `app_auth_challenges` | `app_challenge_admit` | project 50 · platform 1000 | inventory | R6 | expiring | app+trigger+cascade | visitor-identity |
| `app_daily_usage` | `app_run_admit` | owner 100 (window) · platform 500 (window) · platform 1000 (window) | rate | R6 | window | app | visitor-app-data |
| `app_deletion_receipts` | `app_deletion_receipt_capacity` | platform 1000 | receipt | R2 | expiring | app+cascade | visitor-identity |
| `app_deletion_reviews` | `app_deletion_review_capacity` | platform 5000 | review | R1 | expiring | app+cascade | visitor-identity |
| `app_invitations` | `app_invitation_admit` | project 100 · platform 1000 | inventory | R6 | expiring | app+trigger+cascade | visitor-identity |
| `app_migration_checks` | `app_migration_check_admit` | project 5 · platform 1000 | review | R1 | lifetime | none | application-recovery |
| `app_migration_current` | `app_migration_check_admit` | platform 50 | review | R1 | pending-only | none | application-recovery |
| `app_owner_erasures` | `app_owner_erasure_admit` | platform 1000 | receipt | R2 | expiring | app+cascade | visitor-identity |
| `app_page_reviews` | `app_page_admit` | project 100 · platform 1000 | review | R1 | lifetime | none | visitor-app-data |
| `app_passkeys` | `app_passkey_admit` | visitor 5 | inventory | R6 | owner-removable | app+trigger | visitor-identity |
| `app_recovery_points` | `app_recovery_admit` | project 10 (filtered) · platform 100 (filtered) · platform 1000 | version | R4 | lifetime | none | application-recovery |
| `app_restore_reviews` | `app_restore_admit` | project 100 · platform 1000 | review | R1 | lifetime | none | application-recovery |
| `app_runs` | `app_run_admit` | visitor 20 (window) · platform 10000 | receipt | R2 | lifetime | trigger | visitor-app-data |
| `app_sessions` | `app_session_admit` | visitor 5 · platform 5000 | inventory | R6 | expiring | app+trigger | visitor-identity |
| `app_visitors` | `app_visitor_admit` | project 100 · platform 1000 | inventory | R6 | owner-removable | app+trigger+cascade | visitor-identity |
| `backend_form_reviews` | `backend_form_admit` | project 100 · platform 1000 | review | R1 | lifetime | none | backend-artifacts |
| `backend_imports` | `backend_import_quota` | project 25 · owner 100 · platform 1000 | inventory | R6 | lifetime | cascade | import-quarantine |
| `backend_nominations` | `backend_nomination_insert` | owner 5 (filtered) · owner 20 | review | R1 | lifetime | cascade | shared-reuse |
| `backend_public_usage` | `backend_public_usage_insert` | owner 100 (window) · owner 500 (window) · platform 500 (window) · platform 1000 (window) | rate | R6 | window | cascade | backend-artifacts |
| `backend_publication_reviews` | `backend_publication_review_admit` | project 100 · platform 1000 | review | R1 | lifetime | none | backend-artifacts |
| `backend_runs` | `backend_runs_quota` | project 20 (window) · owner 100 (window) · platform 1000 (window) · platform 5000 | receipt | R2 | lifetime | cascade | backend-artifacts |
| `backend_state_reviews` | `backend_state_review_insert` | project 100 · platform 1000 | review | R1 | lifetime | cascade | backend-artifacts |
| `backend_versions` | `backend_versions_quota` | project 25 · platform 1000 | version | R4 | lifetime | cascade | backend-artifacts |
| `build_jobs` | `build_job_admit` | project 1 (filtered) · owner 3 (filtered) · platform 16 (filtered) | operation | R3 | pending-only | cascade | pooled-build-jobs |
| `cloudflare_dns_actions` | `cloudflare_dns_quota` | owner 100 | operation | R3 | lifetime | cascade | domains-dns |
| `cloudflare_token_vault` | `cloudflare_vault_quota` | owner 10 | inventory | R6 | owner-removable | app+cascade | connections |
| `cms_discard_reviews` | `cms_discard_admission` | owner 100 · platform 500 | review | R1 | lifetime | none | cms-content |
| `cms_draft_requests` | `cms_draft_admission` | project 90 · platform 450 | review | R1 | lifetime | cascade | cms-content |
| `cms_draft_requests+cms_edit_requests` | `cms_draft_edit_capacity`, `cms_edit_admission` | project 90 · platform 450 | review | R1 | lifetime | cascade | cms-content |
| `cms_export_links` | `cms_export_link_owner` | owner 1000 · platform 5000 | receipt | R2 | lifetime | cascade | cms-content |
| `cms_import_reviews` | `cms_import_admission` | owner 100 · platform 500 | review | R1 | lifetime | cascade | cms-media-imports |
| `cms_instances` | `cms_instances_insert` | owner 2 · platform 5 | inventory | R6 | lifetime | cascade | cms-resources |
| `cms_media_uploads` | `cms_media_upload_admit` | project 20 · owner 50 · platform 500 | inventory | R6 | lifetime | cascade | cms-media-imports |
| `cms_preview_links` | `cms_preview_admission` | owner 100 · platform 1000 | receipt | R2 | lifetime | cascade | cms-content |
| `cms_publication_media` | `cms_publication_media_create` | platform ≤500 | version | R4 | lifetime | cascade | cms-media-imports |
| `cms_publication_reviews` | `cms_publication_admission` | owner 100 · platform 500 | review | R1 | lifetime | cascade | cms-content |
| `cms_setup_reviews` | `cms_setup_review_guard` | owner 100 · platform 1000 | review | R1 | lifetime | cascade | cms-resources |
| `cms_unpublish_reviews` | `cms_unpublish_admission` | owner 100 · platform 500 | review | R1 | lifetime | cascade | cms-content |
| `cms_wordpress_sources` | `cms_wordpress_source_admit` | project 5 · owner 10 · platform 50 | inventory | R6 | lifetime | cascade | cms-media-imports |
| `composition_plans` | `composition_plan_admit` | project 100 · platform 5000 | review | R1 | lifetime | cascade | backend-artifacts |
| `contact_notification_outbox` | `contact_outbox_insert` | owner 10 (window) · destination 3 (window) · destination 10 (window) · destination 50 (window) | operation | R3 | window | app+cascade | contact-notifications |
| `contact_receipts` | `contact_submission_guard` | project 100 · owner 100 · platform 500 · platform 1000 | receipt | R2 | expiring | app+cascade | contacts |
| `content_risk_evidence` | `content_risk_evidence_admit` | owner 10000 · platform 100000 | evidence | R5 | restricted | cascade | safety-cases |
| `content_screening_decisions` | `content_screening_capacity` | owner 10000 · platform 100000 | evidence | R5 | restricted | cascade | safety-checks |
| `directories` | `directory_capacity` | platform ≤2000 | version | R4 | owner-removable | cascade | directories |
| `directory_reviews` | `directory_review_insert` | project 100 (filtered) | review | R1 | lifetime | cascade | directories |
| `domain_claims` | `domain_claim_quota` | project 3 · owner 10 · platform 80 | inventory | R6 | owner-removable | trigger+cascade | domains-dns |
| `domain_connections` | `domain_connection_capacity`, `domain_connection_owner` | owner 100 · platform 80 (filtered) | operation | R3 | lifetime | none | domains-dns |
| `feature_preview_grants` | `feature_preview_admit` | owner 1000 · platform 20000 | inventory | R6 | lifetime | cascade | feature-preview-authority |
| `github_backups` | `github_backup_owner` | owner 100 | operation | R3 | lifetime | cascade | github-backups |
| `github_grant_revocations` | `github_grant_review` | owner 100 | operation | R3 | lifetime | none | connections |
| `github_token_vault` | `github_token_quota` | owner 10 | inventory | R6 | owner-removable | app+cascade | connections |
| `guest_preview_feedback` | `guest_preview_feedback_admit` | owner 2000 · link 10 (window) · link 200 · platform 100000 | inventory | R6 | owner-removable | app+cascade | guest-feedback |
| `guest_preview_links` | `guest_preview_links_admit` | project 20 (filtered) · project 200 · platform 20000 | inventory | R6 | owner-removable | app+cascade | guest-feedback |
| `identity_ceremony_receipts` | `identity_ceremony_receipt_limit` | platform 50000 | receipt | R2 | expiring | app+cascade | owner-identity-receipts |
| `identity_challenges` | `identity_challenge_limit` | account 20 · platform 5000 | inventory | R6 | expiring | app+trigger | owner-identity-admission |
| `identity_credentials` | `identity_credential_limit` | account 10 | inventory | R6 | owner-removable | app+cascade | owner-identity-progress |
| `identity_effect_receipts` | `identity_effect_receipt_limit` | platform 50000 | receipt | R2 | expiring | app | owner-identity-receipts |
| `identity_grants` | `identity_grant_limit` | account 20 · platform 20000 | inventory | R6 | expiring | app+cascade | owner-identity-admission |
| `module_access_role_reviews` | `module_access_role_review_admit` | project 500 (filtered) · platform 50000 (filtered) | review | R1 | pending-only | app+cascade | project-roles |
| `module_activation_reviews` | `module_activation_review_admit` | project 500 (filtered) · platform 50000 (filtered) | review | R1 | pending-only | app+cascade | module-registry |
| `module_files` | `module_file_admit` | visitor+instance 10 (window) | inventory | R6 | window | app+cascade | module-files |
| `module_records` | `module_record_admit` | project 20000 · visitor+instance 20 (window) · instance 10000 | inventory | R6 | expiring | app+cascade | module-records |
| `module_request_receipts` | `module_record_admit`, `module_request_admit` | project 100 (window) · owner 100 (window) · instance 60 (window) · instance 20000 (window) · platform 500 (window) · platform 1000 (window) | receipt | R2 | window | app+cascade | module-registry |
| `operator_containments` | `operator_containment_admit` | platform 10000 | evidence | R5 | restricted | trigger | operator-containment |
| `operator_retention_receipts` | `operator_retention_apply` | platform ≤10000 | evidence | R5 | restricted | trigger | operator-containment |
| `operator_session_revocations` | `operator_session_revocation_admit` | platform 10000 | evidence | R5 | restricted | trigger | operator-containment |
| `photo_scan_tickets` | `photo_scan_ticket_quota` | owner 100 · platform 5000 | evidence | R5 | lifetime | cascade | safety-checks |
| `project_files` | `project_file_quota` | project 20 · owner 50 · platform 500 | inventory | R6 | owner-removable | trigger+cascade | project-media |
| `project_files+file_cleanup` | `project_file_cleanup_capacity` | platform 500 | inventory | R6 | owner-removable | app+trigger+cascade | project-media |
| `project_spec_applies` | `project_spec_apply_admit` | project 500 · platform 20000 | receipt | R2 | lifetime | cascade | configuration-authority |
| `project_spec_proposals` | `project_spec_proposal_admit` | project 50 · platform 4000 | review | R1 | expiring | app+trigger+cascade | project-configurations |
| `projects` | `project_quota` | owner 20 | inventory | R6 | owner-removable | cascade | projects |
| `safety_case_audit` | `safety_case_audit_capacity` | platform 100000 | evidence | R5 | restricted | none | safety-case-access |
| `safety_case_evidence` | `safety_case_evidence_admit` | case 1000 | evidence | R5 | restricted | none | restricted-safety-cases |
| `safety_case_roles` | `safety_case_roles_capacity` | platform 1000 | evidence | R5 | restricted | none | safety-case-access |
| `safety_cases` | `safety_cases_admit` | platform 10000 | evidence | R5 | restricted | none | restricted-safety-cases |
| `safety_disclosures` | `safety_disclosures_admit` | case 100 | evidence | R5 | restricted | none | restricted-safety-cases |
| `safety_evidence_objects` | `safety_evidence_objects_admit` | case 1000 · platform 10000 | evidence | R5 | restricted | none | restricted-safety-cases |
| `safety_preservation_holds` | `safety_preservation_holds_admit` | platform 10000 | evidence | R5 | restricted | none | restricted-safety-cases |
| `safety_preserved_records` | `safety_preserved_records_admit` | platform 50000 | evidence | R5 | restricted | trigger | restricted-safety-cases |
| `safety_retention_decisions` | `safety_retention_decisions_admit` | platform 100000 | evidence | R5 | restricted | none | restricted-safety-cases |
| `service_client_activation_reviews` | `service_client_activation_admit` | project 500 · platform 20000 | review | R1 | lifetime | cascade | configuration-authority |
| `service_client_applies` | `service_client_apply_admit` | project 500 · platform 20000 | receipt | R2 | lifetime | cascade | configuration-authority |
| `service_client_proposals` | `service_client_proposal_admit` | project 20 · platform 400 | review | R1 | expiring | app+trigger+cascade | project-configurations |
| `service_client_versions` | `service_client_version_admit` | project 25 · platform 1000 | version | R4 | lifetime | cascade | project-configurations |
| `site_versions` | `site_versions_quota` | project 25 | version | R4 | owner-removable | trigger+cascade | site-versions |
| `storage_project_usage` | `storage_project_usage_insert` | owner 10000 (window) | rate | R6 | window | app+cascade | public-admission-counters |
| `users` | `user_quota` | platform 50 | inventory | R6 | owner-removable | app | owner-identity |
<!-- review-retention:inventory:end -->

### Derived sets (machine-checked)

<!-- review-retention:sets:start -->
- **Ceiling set** (retention-class tables whose terminal rows count forever): `app_activation_reviews`, `app_migration_checks`, `app_page_reviews`, `app_restore_reviews`, `app_runs`, `backend_form_reviews`, `backend_nominations`, `backend_publication_reviews`, `backend_runs`, `backend_state_reviews`, `cloudflare_dns_actions`, `cms_discard_reviews`, `cms_draft_requests`, `cms_draft_requests+cms_edit_requests`, `cms_export_links`, `cms_import_reviews`, `cms_preview_links`, `cms_publication_reviews`, `cms_setup_reviews`, `cms_unpublish_reviews`, `composition_plans`, `directory_reviews`, `domain_connections`, `github_backups`, `github_grant_revocations`, `project_spec_applies`, `service_client_activation_reviews`, `service_client_applies` (28).
- **Shared ceiling set, the B1 class** (those with a platform-wide lifetime cap, so one owner can exhaust them for everyone): `app_activation_reviews`, `app_migration_checks`, `app_page_reviews`, `app_restore_reviews`, `app_runs`, `backend_form_reviews`, `backend_publication_reviews`, `backend_runs`, `backend_state_reviews`, `cms_discard_reviews`, `cms_draft_requests`, `cms_draft_requests+cms_edit_requests`, `cms_export_links`, `cms_import_reviews`, `cms_preview_links`, `cms_publication_reviews`, `cms_setup_reviews`, `cms_unpublish_reviews`, `composition_plans`, `project_spec_applies`, `service_client_activation_reviews`, `service_client_applies` (22).
- **Other lifetime platform-wide ceilings** (version, inventory and evidence tables; routed to their owners below, not pruned by WH-061): `app_recovery_points`, `backend_imports`, `backend_versions`, `cms_instances`, `cms_media_uploads`, `cms_publication_media`, `cms_wordpress_sources`, `feature_preview_grants`, `photo_scan_tickets`, `service_client_versions` (10).
<!-- review-retention:sets:end -->

Findings beyond B1 that the inventory exposes:

- **Run receipts.** `app_runs` (platform 10,000) and `backend_runs` (platform 5,000) have lifetime platform caps. Only the visitor-erasure trigger removes `app_runs`, and only project cleanup removes `backend_runs`, so visitor and backend runs eventually stop for every tenant. Backend publication, application activation and migration reviews reference a `backend_runs.run_id`, so referenced runs must be kept.
- **Protective actions inside capacity.** `cms_unpublish_reviews` (platform 500) and `github_grant_revocations` (owner 100) are protective actions that capacity can refuse. Unlike `directory_review_insert`, which already exempts `kind='unpublish'`, `backend_publication_reviews` and `app_page_reviews` do not exempt their withdrawals.
- **Directory listing slots.** `directory_capacity` (platform ≤2,000 draft-plus-live listing slots) is a shared live-data ceiling. Listings are removable by their owner, but two owners with 20 projects each can reach the limit. This needs per-owner fair share; see the directory section.
- **Other lifetime platform ceilings.** These belong to their own packets and are listed for routing only: versions and recovery points ([version retention](version-retention.md)), CMS rows (CMS testing is owner-deferred), quarantine imports (WH-014), photo scan tickets and preview grants (WH-012/WH-122).

## Row states and what each must remain

<!-- review-retention:states:start -->
| State | Meaning | Disposition |
| --- | --- | --- |
| `pending` | Prepared, unexpired, unconfirmed; a confirmation can still apply it | active-authority |
| `uncertain` | External dispatch whose result is unknown (`uncertain`, `dispatching`, `sending`, `creating`, `disconnecting`) | active-authority |
| `applied-referenced` | Applied and pointed to by current state (live snapshot, head, publication, activation, export link, run evidence) | active-authority |
| `held` | Inside an active account, project or object safety preservation hold (`safety_held_projects` and object holds) | retained-evidence |
| `applied-history` | Applied, unreferenced, among the newest *K* applied changes for its project and family (restorable recovery source) | retained-evidence |
| `applied-unreferenced` | Applied, unreferenced and outside the history window | compact |
| `superseded` | Pending but invalidated by a later revision, or a pending withdrawal replaced by a newer one | compact |
| `expired` | Pending past `expires_at` and the grace period, never applied | compact |
| `failed` | Terminal failure with no effect (for example `backend_state_reviews.failed`, `github_backups.failed`) | compact |
<!-- review-retention:states:end -->

Active authority and retained evidence are never deleted by retention. A row is compacted only into a **sealed receipt**: family, id, owner, project, kind, target, outcome, payload digest, request hash, confirming turn, applied time, WH-009 class, sealed time and a SHA-256 seal over those fields. The receipt is what replay and idempotency need. It holds no payload. An unknown outcome is never inferred from age.

## Options and decision

| Option | Rule | Trade-offs |
| --- | --- | --- |
| A: prune terminal rows beyond a window | Delete expired, superseded and old applied rows | Restores turnover, but deleting applied rows loses replay and idempotency answers, and a full window still lets one owner fill a platform-wide cap |
| B: per-owner and per-project caps | Replace platform lifetime caps with per-owner caps under a global ceiling | Fixes cross-tenant starvation (B1), but with lifetime counting each owner still hits a permanent ceiling (the directory problem) |
| C: compaction into digest receipts | Replace terminal rows with sealed metadata receipts | Keeps replay and idempotency with small rows, but receipts still grow forever and caps stay shared. The precedent is [version retention](version-retention.md), whose metadata-only apply receipts prevent resurrection |
| **D: combination (recommended)** | Count only active rows against per-project and per-owner caps under a fair-share global ceiling. Keep a history window of full applied snapshots. Compact other terminal rows into sealed receipts kept for a replay horizon. Withdrawals are exempt from capacity | Bounded storage per project without operator edits, and no cross-tenant starvation. Costs: a schema cutover, one new table and rewritten delete guards. Payloads of old snapshots outside the window become digest-only (not restorable) |

**Decision (proposed, owner decision OD-1): option D.** Each piece has a precedent in the current schema:

- **Active-only counts:** `module_activation_reviews` counts only unapplied rows, and [`src/shared-modules/activation.ts`](../src/shared-modules/activation.ts) deletes expired unapplied ones at admission.
- **Fair share:** the WH-050 F1 rule in `contact_submission_guard` ([capacity and fairness](capacity-and-fairness.md)).
- **Replay horizon:** `module_request_receipts` are kept for a 30-day replay window and then deleted by the daily `contacts` pass.
- **Withdrawal exemption:** `directory_review_insert` already exempts `kind='unpublish'`.
- **Metadata-only receipts:** [version retention](version-retention.md).

### Proposed policy (machine-checked against the reference)

<!-- review-retention:policy:start -->
| Constant | Value | Rule |
| --- | --- | --- |
| `activePerProject` | 25 | Pending plus uncertain non-withdrawal rows per project per family |
| `activePerOwner` | 100 | Same, summed over the owner's projects |
| `activeGlobal` | 5000 | Platform safety ceiling per family; must be at least the invited-account cap (`user_quota`, 50) × `activePerOwner` |
| `fairShareFrom` | 2500 | At or above this many active rows platform-wide, an owner already holding `fairSharePerOwner` is refused |
| `fairSharePerOwner` | 25 | Keeps a reserve for light owners even if the invite cap later grows |
| `historyPerProject` | 25 | Newest applied changes kept in full per project per family (restorable) |
| `receiptsPerProject` | 2000 | Sealed receipts per project per family inside the replay horizon; at the limit, new non-withdrawal reviews wait for older receipts to age out |
| `replayHorizonMs` | 2592000000 | 30 days: sealed receipts answer retries for this long, then leave |
| `terminalGraceMs` | 3600000 | Expired pending rows are kept one hour before compaction |
| `reviewLifetimeMs` | 600000 | Existing ten-minute review expiry |
| `turnoverBatch` | 200 | Rows compacted per turnover call |
<!-- review-retention:policy:end -->

Rules, each proved offline by the conformance suite:

1. **Capacity counts active rows only.** Per project, per owner and global, with fair share. Terminal rows never count, so one owner at their cap cannot block another. Because `activeGlobal ≥ 50 × activePerOwner`, the global ceiling is a backstop that the invited cohort cannot reach. It still bounds the platform if the invite cap grows.
2. **Turnover needs no operator or scheduler.** Each admission first compacts eligible rows for that project and family (bounded by `turnoverBatch`), inside the admitting batch. A new daily `reviews` job in the existing `runMaintenance` pass (cron `17 3 * * *`) does the same for idle projects. Neither job needs raw operator database edits.
3. **Pruning never removes authority or evidence.** Rows that are pending, uncertain, referenced, held or inside the history window are never compacted. The deleting statement re-evaluates each predicate, and a rewritten `BEFORE DELETE` guard rechecks them at deletion time.
4. **Compaction keeps replay.** A row leaves only together with its sealed receipt, written in the same batch. A retried prepare with the same request hash replays, and a different hash conflicts. A retried confirmation returns the original outcome and never applies twice. A tampered receipt fails closed. After the replay horizon the receipt is removed; `chat_turns` (WH-009 `conversation`) remains the long-lived idempotency key for the turn, and `activity_events` remains the audit record.
5. **Withdrawals are exempt from capacity.** Unpublish, disable and revoke rows, from the owner or from safety withdrawal, are never refused for active, global, fair-share or receipt capacity. A new pending withdrawal supersedes the previous pending withdrawal of the same target, so withdrawal rows stay bounded by the number of targets rather than by a count limit.
6. **Lifecycle is inherited.** A receipt carries its source table's WH-009 class and goes with ordinary project or account cleanup. Safety holds preserve rows and receipts. LC-06 preservation runs before any cascade, as WH-132 already does for photos and documents.

## References that keep an applied row (ceiling-set families)

A row named here is `applied-referenced` while the reference exists. The withdrawal column lists the rows that the proposal exempts from capacity.

<!-- review-retention:references:start -->
| Family | Current references (never compacted while present) | Withdrawal rows exempt from capacity |
| --- | --- | --- |
| `app_activation_reviews` | `app_spaces.review_id` (current activation) | `enabled=0` |
| `app_migration_checks` | `app_migration_current`, approvals, cancellations and documents | — |
| `app_page_reviews` | `app_live_pages`, `app_runs.page_review_id` | `config_json IS NULL` |
| `app_restore_reviews` | `app_spaces.rollback_id` | — |
| `app_runs` | `running` rows (in flight); no table references a finished visitor run | — |
| `backend_form_reviews` | `backend_live_forms`, `site_health_checks.form_review_id` of the current check | `enabled=0` |
| `backend_nominations` | Nominated rows (consent stays active until withdrawn) | — |
| `backend_publication_reviews` | `backend_publications.review_id`, `backend_form_reviews.backend_publication_id`, `backend_public_usage.publication_id` | `operation='unpublish'` |
| `backend_runs` | `run_id` of retained `backend_publication_reviews`, `app_activation_reviews` and `app_migration_checks`; `running` rows | — |
| `backend_state_reviews` | The applied review that produced the current `backend_state` revision, `backend_state_links`, `restore_review_id` sources | — |
| `cloudflare_dns_actions` | `sending` or `uncertain` rows (reconcile first) | — |
| `cms_discard_reviews` | Pending only (CMS testing owner-deferred) | — |
| `cms_draft_requests` | Drafts referenced by `cms_live_articles`, edits, previews, exports and publications | — |
| `cms_draft_requests+cms_edit_requests` | As above (summed cap) | — |
| `cms_export_links` | Unexpired chat-bound download links | — |
| `cms_import_reviews` | `cms_import_taxonomy_jobs` | — |
| `cms_preview_links` | Unexpired chat-bound preview links | — |
| `cms_publication_reviews` | `cms_live_articles`, `cms_publication_media`, unpublish/discard reviews | — |
| `cms_setup_reviews` | `cms_instances.review_id` | — |
| `cms_unpublish_reviews` | Pending only | `every row` |
| `composition_plans` | `backend_extension_uses` | — |
| `directory_reviews` | Live snapshot (proposed `directories.live_review_id`), `directory_exports.review_id`, the history window | `kind='unpublish'` |
| `domain_connections` | Active, creating, provisioning, uncertain and disconnecting rows; serving mapping in `src/site-host.ts` | `disconnect` |
| `github_backups` | `dispatching` or `uncertain` rows | — |
| `github_grant_revocations` | `dispatching` or `uncertain` rows | `every row` |
| `project_spec_applies` | `project_spec_heads`, chat links, version-retention metadata receipts | — |
| `service_client_activation_reviews` | `service_client_activation_links`, the current activation | `enabled=0` |
| `service_client_applies` | `service_client_heads`, chat links | — |
<!-- review-retention:references:end -->

## Proposed schema and trigger changes (for an owner-run empty-D1 cutover)

Affected canonical inputs: `schema/platform.sql` and `src/shared-modules/schema.sql` (withdrawal exemption for `module_activation_reviews` and `module_access_role_reviews`; their counts are already pending-only). `src/workspace-identity/schema.sql`, `src/workspace-identity/canonical-inputs.sql`, `src/funnel-metrics/schema.sql` and `src/guest-previews/schema.sql` need no change.

1. **`review_receipts` table.** Columns: `family`, `id`, `owner_user_id`, `project_id`, `kind`, `target`, `outcome` (`applied`/`withdrawn`/`expired`/`superseded`/`failed`), `payload_digest`, `request_hash`, `confirmed_by`, `applied_at`, `sealed_at` and `seal`, with primary key `(family,id)`. Foreign keys cascade from `projects` and `users`. An insert trigger binds every field to the still-present source row in the same batch, and an immutability trigger forbids updates. The Worker computes the seal with `hashToken` and verifies it on every read. Add the table to [`data-lifecycle.json`](data-lifecycle.json) with deletion authority inherited from the source class plus the replay horizon (`tests/lifecycle-catalog.mjs` asserts the table count).
2. **Capacity triggers for every ceiling-set family.** Replace lifetime `count(*)` with active counts (`status='pending' AND expires_at>now`, plus each operation table's in-flight states), per project, per owner (join `projects.owner_user_id`) and global, with fair share. Exclude the withdrawal predicate above. Cap codes stay unchanged so existing error mapping (for example "review storage is full") keeps working.
3. **Withdrawal supersession.** For a withdrawal, the preparing batch first seals and deletes the previous pending withdrawal of the same target. Tables whose `status` is only `pending`/`applied` need no new status value.
4. **Delete guards.** Rewrite `*_retained` and `*_delete_guard` triggers (`app_activation_delete_guard`, `project_spec_apply_retained`, `service_client_activation_retained`, `service_client_apply_retained`, `github_grant_retained`, `cms_import_retained`, `module_*_retained`, `app_migration_check_delete`, `app_restore_delete_guard`). Add the same guard to unguarded families (`directory_reviews`, `backend_*_reviews`, `app_page_reviews`, `cms_*_reviews`, run tables). A guard allows deletion only for project or account cleanup (as today), or when the row is terminal, unreferenced (per the table above), not in `safety_held_projects` or an object hold, outside the history window, and has a matching `review_receipts` row.
5. **Run receipts.** `app_runs` and `backend_runs` keep their day-window caps. Their platform lifetime caps become active and windowed counts, and unreferenced runs past the replay horizon are compacted (owner decision OD-8).
6. **Directory.** Add `directories.live_review_id` and `live_digest`. `directory_review_apply` sets them on publish and clears them on unpublish. Replace `directory_capacity`'s platform-only 2,000 slots with a per-owner slot cap plus fair share (OD-7).
7. **Health identity.** Add `site_health_checks.directory_review_id`, compared like `form_review_id` in [`src/site-health.ts`](../src/site-health.ts) (see below).

Tests to update or re-run with the cutover: `tests/directories.mjs` and `tests/directory-history.mjs` (the 100-row capacity fixture becomes an active-count fixture). Also `tests/backend-forms.mjs`, `tests/backend-form-http.mjs`, `tests/backend-publication.mjs`, `tests/backend-state.mjs`, `tests/app-pages-http.mjs`, `tests/app-activation.mjs`, `tests/app-activation-http.mjs`, `tests/app-recovery.mjs`, `tests/app-migration-checks.mjs`, `tests/service-safety.mjs`, `tests/service-client-activation.mjs`, `tests/github-grant-revocation.mjs`, `tests/domain-hosting.mjs`, `tests/composition-planner.mjs`, `tests/site-health.mjs`, `tests/lifecycle-catalog.mjs`, `tests/maintenance-inventory.mjs`, `tests/maintenance-scheduled.mjs`, `tests/restore-inventory.mjs` and this suite: its inventory rows change by construction, and the update must re-derive them. PR #177's `tests/boundary-review-capacity.mjs` should flip from expected-fail to pass. The CMS suites stay owner-deferred; the CMS trigger changes ship as schema only.

## Directory snapshot agreement, custom hosts and health

| Path | Current source | Agrees on the approved snapshot? | Gap |
| --- | --- | --- | --- |
| Publication | `directory_review_apply` copies the publish review's `snapshot_json` to `directories.live_json`, bound to the parent `publications.revision` | Yes, by bytes | The live row does not name its review; "which review is live" is inferred. Proposal: `live_review_id`/`live_digest` |
| Public page and JSON | `publicDirectory` in [`src/directory.ts`](../src/directory.ts), served by [`src/site-host.ts`](../src/site-host.ts) at `PROJECT.whumpo.site/directory(.json)` | Yes: both render `live_json` only while `publication_revision` matches | No digest is exposed for verification; proposal: an `ETag` of `live_digest` |
| Export | `exportDirectory` reads an applied `edit`/`publish` review and rechecks its SHA-256 | Yes, for any retained snapshot | After compaction, snapshots outside the history window are digest-only: history must label them "not restorable" |
| Draft restore | `directory_restore_source` requires the applied source row with identical bytes and digest | Yes | Same compaction labelling; restore must target a retained row |
| Custom hostname | `src/site-host.ts` maps an `active` `domain_connections` hostname but allows only `/` and `/assets/*.jpg` | **No**: `/directory` and `/directory.json` return 404 on custom hosts | Allow both paths behind the same mapping and `publicDirectory`. Hosting activation is still disabled and unverified (WH-033), so this child verifies with local fixtures only |
| Health | `site_health_checks` identity is publication revision, contact revision and live form | **No**: directory publication is not part of health | Add `directory_review_id` to the identity. The check fetches `/directory.json`, and on custom hosts when active, and compares it with `live_digest` |

Live custom-host acceptance stays with the parent WH-061, which keeps its WH-033 dependency. No child reaches WH-033, WH-049 or WH-104 acceptance.

## Bulk import and schema expansion (deferred)

Bounded bulk import and directory schema expansion (more fields or more listings) come only after the lifecycle above is complete. Each needs its own scoped review: tenant isolation, size bounds, the existing `whumpo-directory` v1 validation in `validateDirectoryExport`, safety screening of imported text (S13-class gap in [safety coverage](safety-coverage.md)) and a fresh capacity inventory. That work is WH-185, which is deferred and is not a WH-061 dependency; WH-061 acceptance only requires that such work stays separately reviewed.

## What the offline reference proves and does not prove

`node tests/review-retention-contract.mjs` runs offline on SQLite in memory with synthetic identifiers. It proves:

- the inventory, sets, states, policy table and references table above agree with the real triggers, code deleters and WH-009 classes;
- the invariant `activeGlobal ≥ user_quota × activePerOwner`;
- in the synthetic model: per-owner non-starvation with a bounded global ceiling and fair share; pruning never touching pending, uncertain, held or referenced rows; capacity-exempt and bounded withdrawals; replay and idempotency after compaction, with tamper detection; turnover with no operator edit and bounded storage; and receipts inheriting WH-009 classes through project cleanup and holds;
- that today's lifetime policy fails the starvation and turnover properties;
- that every mutant in its mutation set is caught by a named check.

It does not prove D1 trigger behavior, the real deleting statements, Worker routes, custom-host serving, health checks or any deployment. Those are WH-181–184.

## Open owner decisions

| ID | Decision | Recommendation |
| --- | --- | --- |
| OD-1 | Retention option | D (combination) |
| OD-2 | Active caps 25/100/5,000 and fair share at 2,500/25 per family | Accept; revisit if the invite cap rises above 50 |
| OD-3 | History window *K* of full restorable snapshots (directory history currently lists up to 100) | 25 per project per family; older snapshots digest-only |
| OD-4 | Replay horizon and receipt ring | 30 days and 2,000 per project per family, matching `module_request_receipts`. Alternative: a 90-day LC-05 evidence target for applied receipts |
| OD-5 | Withdrawal exemption scope | Owner and safety unpublish, disable and revoke, including `github_grant_revocations` and `cms_unpublish_reviews`; supersede instead of refuse |
| OD-6 | Cutover timing | Bundle with the next owner-run empty-D1 cutover; it wipes test data |
| OD-7 | Directory listing slots (platform 2,000) and custom-host directory paths | Per-owner 250 slots with fair share; serve `/directory(.json)` on active custom hosts once WH-033 is accepted |
| OD-8 | Run receipts (`app_runs` 10,000, `backend_runs` 5,000 lifetime) | Include in this cutover as R2 receipts |

## Child slices

| ID | Slice | Depends on | Boundary |
| --- | --- | --- | --- |
| WH-180 | Retention contract and offline reference (this document) | WH-009, WH-004 | Planning and offline reference only |
| WH-181 | Active-only caps, sealed receipts, withdrawal exemption and delete guards in the canonical schema | WH-180 | Source and local; cutover only with explicit owner authorization |
| WH-182 | Admission-time turnover, the daily `reviews` maintenance job and capacity counters | WH-181 | Source and local; no operator edits |
| WH-183 | Directory live-review identity, custom-host directory paths and health wiring (local fixtures) | WH-181, WH-037 | Does not activate hosting; does not depend on WH-033 |
| WH-184 | Connected local acceptance: long-lived directory journey, B1 regression, withdrawal at capacity, restore/export after compaction | WH-182, WH-183 | Local acceptance only; live custom-host acceptance stays in WH-061 |
| WH-185 | Bounded directory bulk import and schema expansion | WH-184 | Deferred; separate scoped review |

WH-061 depends on WH-180–184 and keeps WH-033, WH-037 and WH-009. Its acceptance is unchanged.
