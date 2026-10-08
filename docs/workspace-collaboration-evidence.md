# WH-054 feasibility review: evidence, method and limits

**October 8, 2026 (UTC). Evidence level: repository source plus in-memory SQLite and a small in-memory simulation. Nothing here is live acceptance, a deployment, a Stripe or Cloudflare observation, or an implementation.** This supports the [workspace collaboration contract](workspace-collaboration.md); the contract states what the platform will do, and this page records what was measured, how, and what the measurements cannot show. Two evidence kinds are kept apart throughout: the **feasibility review's measurements and counts** (in-memory SQLite, AST and simulation, taken at `b319f33`) and a later **source-classified dispositions** follow-up (repository source reading only; [below](#source-classified-dispositions-follow-up-source-reading-only)). The follow-up does not recompute or replace the review's counts. A third kind, the **packet 1a local checks** (implemented source run against the current tree), is recorded [below](#packet-1a-local-checks-implemented-source-run-on-the-current-schema); it too leaves the review's counts as the historical record.

The reviewed tree was the contract commit `b319f33` on the WH-054 branch, whose source and schema are identical to baseline `ca17c6a` (the branch differs only in documentation). The review only read the repository and wrote nothing into it. The exploratory scripts and their raw output were kept outside the repository and are deliberately not part of this record: the figures below are what remains useful, and the packet 1a tooling ([tenant classification](tenant-classification.md)) is the supported way to regenerate and check them.

## Method

| Measurement | How |
| --- | --- |
| Tables, triggers, views, foreign keys | The composed canonical inputs from `tools/current-schema.mjs` executed into an in-memory SQLite database; `PRAGMA foreign_key_list` and `sqlite_master`. Heuristic counts of trigger text are substring or word-boundary patterns. |
| Helper call counts | TypeScript compiler AST over `src` (calls, not text). |
| SQL surface | The same AST: every `prepare()` call classified as literal, static template, interpolated template or non-literal argument. |
| Per-column classification | A hand-decided table, one entry per foreign-key column, recording on-delete action, source schema file, other keys, composite children, immutability and "retained while the account exists" triggers, the `src` statements naming the table, and the decision with its basis. A coverage check flagged any unclassified or stale column; a negative control (an injected new `users` foreign key) was rejected. |
| Transform spike | The schema text was rewritten in memory (97 tenant-class foreign keys retargeted, `RENAME COLUMN`, nullable actor columns, three new tables with guards) and 22 assertions were run. |
| Lease simulation | A SQLite model of the b319f33 extension and observer rules and one candidate rule, over three invoice shapes. |
| Stripe facts | Official Stripe documentation pages read on October 8, 2026 (linked below). No Stripe account, key, connector, event or sandbox was used. |

## Figures against the first draft

| First-draft claim | Measured | Verdict |
| --- | --- | --- |
| 219 tables, 640 triggers | 219 tables, 640 triggers, 27 views | confirmed |
| 111 tables with a `users` foreign key through 111 columns (105 `user_id`, 3 `owner_user_id`, one each `owner_id`, `account_id`, `used_by`) | identical; no table has two such keys | confirmed |
| 86 `CASCADE` and 24 `NO ACTION`/`RESTRICT` | 86 `CASCADE`, 17 `NO ACTION`, 7 `RESTRICT`, **1 `SET NULL`** (`invitations.used_by`) | confirmed, but the `SET NULL` was omitted |
| 55 with `project_id`, 56 without | 55 / 56 | confirmed |
| 33 further tables reference `projects` only | 78 tables without a `users` key reach `projects` through some key chain (38 directly); 29 are platform, safety or identity tables with no tenant path; 6 tables carry a textual `project_id` with no key (`file_cleanup`, `safety_preservation_holds`, `safety_preserved_records`, `cms_media_safety`, `fair_use_project_lifecycle`, `welcome_onboarding`) | **understated** |
| 312 triggers mention `user_id`/`owner_user_id` | 312 by substring, 303 by word boundary (the substring also matches `subject_user_id`) | confirmed with a qualifier |
| 57 triggers repeat `owner_user_id = NEW.user_id`; 62 enforce immutability | 57 / 62 | confirmed |
| `assertWorkspace`: 77 call sites in 31 files | AST: 81 calls in 32 files; 4 are inside `admission.ts`, so 77 in 31 outside it | confirmed |
| Tenant-taking helpers counted | **not counted:** `assertFeature` 50 calls in 21 files, `featurePredicate` 33 in 20, `requireFeature` 9 in 4, `connectionInclusion` 2; all take `userId` as the tenant through `workspacePredicate`/`assertWorkspace` ([`src/feature-admission.ts:10–25`](../src/feature-admission.ts)) | **understated** |
| `users` has three columns | `id`, `email`, `created_at` | confirmed |

Composite foreign keys that carry `user_id`: `chat_interaction_submissions` to `chat_interactions(id, user_id)` and to `chat_interaction_requests(user_id, request_id)`; `chat_interaction_tasks` to `chat_conversations(id, user_id)`; `chat_interactions` to `chat_interaction_tasks(id, user_id, conversation_id)`; `inference_calls` to `inference_budgets(user_id, period)`. One foreign-key cycle exists among `app_spaces`, `app_migration_checks`, `app_migration_approvals`, `app_recovery_points` and `app_restore_reviews`.

## Classification of the 111 columns (historical review counts; proposed, not frozen)

These are the counts as the feasibility review left them at `b319f33`, including **6 `unknown` and 1 `polymorphic`** entries that the review could not classify. They are kept as the historical record and are **not edited** when later source reading classifies those entries; see the [follow-up](#source-classified-dispositions-follow-up-source-reading-only) for what changed and why the totals are not recomputed. Class meaning is in the [contract](workspace-collaboration.md#coordinated-current-schema-consequences). `[NA]`/`[R]` mark `NO ACTION`/`RESTRICT`, the 24 columns that block a raw cascade. Columns are `user_id` unless named.

| Class | Count | Tables |
| --- | --- | --- |
| `account` | 7 | `customer_eligibility`, `funnel_events`, `identity_accounts` (`account_id`), `invitations` (`used_by`, `SET NULL`), `profile_photo_safety`, `user_profiles`, `welcome_onboarding` |
| `workspace` | 16 | `app_recovery_points` [NA], `app_spaces` (`owner_user_id`) [NA], `capacity_preferences`, `cms_instances`, `cms_media_safety`, `cms_publication_media`, `contact_notification_destinations`, `contact_notification_outbox`, `contact_notification_suppression_resets`, `contact_notification_suppressions`, `fair_use_project_lifecycle`, `feature_preview_grants`, `inference_budgets`, `project_photo_safety`, `projects` (`owner_user_id`), `site_health_checks` |
| `workspace+actor` | 65 | `activity_events`, `agent_inspections`, `app_activation_reviews` [NA], `app_maintenance_chat_links` [NA], `app_migration_approvals` [NA], `app_migration_cancellations` [NA], `app_migration_checks` [NA], `app_owner_erasures`, `app_page_reviews` [NA], `app_restore_reviews` [NA], `application_builds`, `backend_form_reviews` [NA], `backend_imports`, `backend_nominations`, `backend_publication_reviews` [NA], `backend_runs`, `backend_state_reviews`, `build_jobs`, `chat_conversations`, `chat_interaction_requests`, `chat_interaction_submissions`, `chat_interaction_tasks`, `chat_interactions`, `chat_review_receipts` [NA], `chat_task_progress`, `chat_turns`, `cloudflare_dns_actions`, `cms_discard_reviews` [NA], `cms_draft_requests` [NA], `cms_export_links`, `cms_import_reviews`, `cms_media_uploads`, `cms_preview_links` [NA], `cms_publication_reviews` [NA], `cms_setup_reviews`, `cms_unpublish_reviews` [NA], `cms_wordpress_sources`, `composition_plans`, `contact_destination_reviews`, `contact_reviews`, `directory_reviews`, `domain_connections` [R], `domain_proof_removals`, `fair_use_reviews`, `gateway_spend_attempts` [R], `gateway_spend_buckets` [R], `guest_preview_links` (`owner_user_id`), `inference_calls`, `module_access_role_applies`, `module_access_role_reviews`, `module_activation_applies`, `module_activation_reviews`, `photo_removals`, `project_spec_applies`, `project_spec_creations`, `project_spec_proposals`, `publication_actions`, `service_client_activation_reviews`, `service_client_applies`, `service_client_proposals`, `standard_ai_requests`, `support_deliveries`, `usage_review_requests`, `version_removals`, `welcome_first_drafts` |
| `workspace+custody` | 12 | `cloudflare_oauth_states`, `cloudflare_token_vault`, `connection_chat_links`, `connection_oauth_exchanges` [R], `connection_oauth_outcomes`, `connection_rotation_guards` (`owner_id`) [R], `github_backups`, `github_connections`, `github_grant_revocations` [R], `github_oauth_states`, `github_refresh_custody` [R], `github_token_vault` |
| `workspace+payer` | 4 | `stripe_customers`, `stripe_paid_invoices`, `stripe_subscription_orders`, `stripe_subscriptions` |
| `polymorphic` | 1 | `photo_scan_tickets`: `kind = 'profile'` is account data; `project` and `cms` are tenant data (split) |
| `unknown` | 6 | `workspace_state`, `workspace_preferences`, `workspace_layout_receipts` (the review deferred them); `content_screening_decisions`, `content_risk_evidence`, `content_risk_reversals` (the review could not tell whether the subject is a person or a workspace) |

Non-foreign-key identity columns that a mechanical rename must not touch: `file_cleanup.owner_user_id` and `domain_reconciliations.user_id` (tenant copies, textual); `safety_cases`, `safety_preservation_holds`, `safety_preserved_records` and `safety_evidence_objects` `.subject_user_id` and `operator_containments.subject_id` (hold and containment subjects); `module_request_receipts.principal_hash`; the textual `confirmed_by` columns on `publication_actions`, `contact_reviews`, `contact_destination_reviews`, `directory_reviews`; `fair_use_reviews.opened_by`/`resolved_by` and `usage_review_requests.answered_by` (operator or actor text); `identity_challenges.account_id` (account, nullable); provider `github_user_id` (the authorizer's provider identity); and the Cloudflare `account_id` columns on `cms_deployments`, `cms_resource_jobs` and `gateway_provider_receipts` (provider accounts, not persons).

Encrypted custody contexts: `whumpo:{provider}:{purpose}:{user}:{id}` in five stores ([`src/connection-rotation.ts:5–11,70`](../src/connection-rotation.ts), [`src/github-connection.ts:22`](../src/github-connection.ts), [`src/cloudflare-connection.ts:15`](../src/cloudflare-connection.ts), [`src/github-grant-revocation.ts:42`](../src/github-grant-revocation.ts)).

## Transform spike: 19 of 22 assertions passed

| # | Assertion | Result |
| --- | --- | --- |
| 1–3 | Every tenant-class key located and retargeted (97); transformed schema executes; `foreign_key_check` empty | pass |
| 4 | `RENAME COLUMN … TO workspace_id` succeeds everywhere (every trigger and view re-parses) | **fail** (3 columns) |
| 5–10 | Nullable actor columns added; no tenant-class column still references `users`; account-class columns still do; the identity credential chain stays on the account; `projects` references `workspaces`; unknown and polymorphic columns left on `users` | pass |
| 11 | No cross-type comparison left by the rename | **fail** (at least 22 trigger bodies) |
| 12–14 | A person ID is rejected as a tenant; the workspace owns its project; an editor's account can be deleted | pass |
| 15 | Account deletion leaves workspace, project and history; `actor_ref` survives with its account link null | pass |
| 16–18 | A sole active owner cannot delete their account; the last owner cannot leave; after promote-then-leave the departing person deletes their account and the workspace and project remain | pass |
| 19 | The historical tenant column cannot be updated after the rename | pass |
| 20 | A new `actor_ref` is refused on a pending `publication_action` | pass, but only because that trigger permits just pending-to-applied; it is not a general actor rule |
| 21 | `DELETE workspaces` is blocked by the `NO ACTION`/`RESTRICT` tenant rows (closure cannot be a cascade) | pass (demonstrates the constraint) |
| 22 | An account hold on the owner still protects the project after the rename | **fail**: blocked in the original schema (`safety_preservation_hold`), succeeded afterwards |

**Rename failures (assertion 4):** `cms_media_uploads.user_id` (trigger `cms_publication_media_admit`, alias `a.user_id`); `projects.owner_user_id` (view `service_client_valid_proposals`, alias `c.owner_user_id`); `stripe_paid_invoices.user_id` (trigger `publication_confirm_guard`, `user_id` through the `plan_entitlements` view).

**Silently wrong bodies (assertion 11), a lower bound.** Nineteen retention guards of the form `EXISTS(SELECT 1 FROM users WHERE id = OLD.workspace_id)`: `inference_delete_guard`, `cms_publication_media_retained`, `cms_import_retained`, `cms_wordpress_source_retained`, `app_owner_erasure_retention`, `usage_review_delete`, `contact_suppression_delete`, `cms_media_safety_retained`, `project_spec_apply_retained`, `service_client_apply_retained`, `service_client_activation_retained`, `project_spec_creation_retained`, `feature_preview_retained`, `chat_interaction_request_retained`, `chat_interaction_retained`, `chat_interaction_submission_retained`, `chat_task_created_project_retained`, `module_activation_review_retained`, `module_access_role_review_retained`; and three hold triggers comparing a person with a workspace column: `safety_hold_chat_draft`, `safety_hold_guest_feedback_retained`, `safety_hold_guest_link_retained`. Views and triggers on the three un-renamed columns (for example `safety_held_projects`, `operator_contained_projects`) are equally wrong and were not counted. The registry records 26 "retained while the account exists" guards in total.

SQLite accepted `CREATE TRIGGER` bodies naming unknown columns and failed only at the first statement that fired them, so the existing artifact check cannot see this class of defect.

**Not exercised:** closure purge, custody resealing, billing, the lease, any handler, NOT NULL actor columns (these need rebuilt `CREATE` statements), and the miniflare `--d1` mode.

## Source-classified dispositions (follow-up, source reading only)

**Evidence level: repository source read in place at the contract commit, with no test, build, database, in-memory SQLite run or simulation.** Nothing below measures behavior; each claim is an anchor to a file the follow-up read, and the dispositions are **engineering recommendations derived from current semantics**, not owner choices. The contract carries the proposals ([dispositions](workspace-collaboration.md#source-classified-dispositions-for-the-seven-undecided-entries-and-two-refinements)); this section records what was read and what it cannot show.

**Relation to the review's counts.** The review's `unknown` (6) and `polymorphic` (1) counts above describe what the review could not decide at the time. The follow-up *source-classifies* those seven entries and refines two already-classified ones (`github_connections`, counted in `workspace+custody`, and `backend_nominations`, counted in `workspace+actor`). Two of the seven change shape: `content_risk_evidence` and `content_risk_reversals` gain typed account/workspace subject columns, and `photo_scan_tickets` splits into two tables, so the 111-column and per-class totals **change when the registry is authored** and are deliberately not restated here.

| Entry | Source anchors read (paths relative to the repository root) | What the source shows |
| --- | --- | --- |
| `workspace_state` | `schema/platform.sql` (table near line 24, welcome trigger near 4292); `src/chat.ts`, `src/ai-chat.ts`, `src/standard-ai-usage.ts`, `src/chat-interactions/{continuation,store,task-context}.ts`; `src/site-agent.ts` | A per-person Chat concurrency head; `step`, `idea`, `brief_project_id`, `brief_stage` are only reset, and `step='ready'` predicates mean "the head exists". The search for readers of the other three fields found none, which makes them removal candidates, not proven dead |
| `workspace_preferences`, `workspace_layout_receipts` | `schema/platform.sql` (triggers `workspace_layout_receipt_immutable`, `workspace_layout_receipt_current`, `workspace_layout_current_update`); `src/workspace-layout.ts` | Layout written only through the person's own pending AI Chat turn or a direct mutation; the receipt trigger requires the Chat turn to share the person |
| `content_screening_decisions` | `schema/platform.sql` (table near 1535, readers near 2085–2148, triggers near 3829–3840, `specification_held` triggers); `src/content-screening.ts` (HMAC message with `target.userId`), `src/content-screening-decisions.ts`, `src/project-specification/store.ts`, `src/project-specification/service-clients/{owned,store}.ts` | A requirement bound to content digest; read as a gate through the project owner; the only writer, `reserveContentScreening`, has no runtime caller (tests only) |
| `content_risk_evidence`, `content_risk_reversals` | `schema/platform.sql` (tables near 1555–1566, triggers near 3842–3855, `safety_case_evidence_admit` near 5016); `src/content-risk-evidence.ts`, `src/content-risk.ts`, `tools/content-risk-review-input.mjs`, `tools/review-content-risk.mjs` | Operator-only immutable ledger; retained-while-`users`-row-exists guards; case evidence must share the case subject |
| `photo_scan_tickets` | `schema/platform.sql` (table near 1517, one-reserved index near 2001, triggers near 3787–3799); `src/photo-scan-results.ts`; `tools/account-closure-inventory.mjs` | A transient scanner attempt, with `kind` selecting a person or a project/CMS id; no runtime caller (tests only) |
| `github_connections` | `schema/platform.sql` (tables near 204 and 222, index `github_grant_pending_client`); `src/github-connection.ts`, `src/github-backups.ts`, `src/github-grant-revocation.ts`; `tools/safety-hold-inventory.mjs` | One row and one OAuth state per account; backups bind the connection identity and token; the app-wide grant revocation deletes a person's whole grant for the OAuth client and is already disclosed as reaching other authorizations |
| `backend_nominations` | `schema/platform.sql` (trigger `backend_nomination_update` near 3609); `src/backend-nominations.ts`; `docs/shared-components.md`; `docs/data-lifecycle.json` (class `shared-reuse`) | Consent is a typed confirmation recorded as `consent_at`; every transition re-checks that the consenter is the current project owner through `owner_user_id` |

**What the follow-up cannot show.** No behavior was run. Absence of a reader or caller was established by text and structural search over `src`, `tools` and `schema`, which cannot see dynamic or composed SQL, so every "removal candidate" and "no runtime caller" statement is a finding to re-confirm in the canonical-input review. The key shapes, triggers and predicates are designs, not fixtures. The proposals do not exercise closure order, billing, custody resealing or any handler.

**Additional no-op regressions required.** The review's spike showed a hold that stopped protecting a project after a mechanical rename. The dispositions add cases of the same kind, each of which must fail first against a mechanical rename before the rewritten body is accepted:

1. A `required = 1` content-screening decision still blocks website, service-client and activation actions after conversion and after an ownership transfer, and identical content from a second member gets no fresh decision (a gate comparing `d.user_id = p.owner_user_id` after one side is re-keyed never matches and publishes held content).
2. Retention guards on content-risk evidence and reversals refuse deletion while their own subject kind (account or workspace) exists; a guard comparing a workspace id with `users` never matches.
3. A nomination consented to by a former owner is not effective for the new owner, and no row is relabeled.
4. Transfer revokes the sender-authorized GitHub slot at token level, does not invoke the app-wide grant revocation, and leaves other workspaces' connections untouched; recovery for an unknown outcome stays accurate.
5. Two members of one workspace keep independent Chat heads and layouts (no collision, no cross-reading), and a transfer does not move either.

These are required test designs, not results. None of these regression tests has been written or run. The packet 1a registry and local checks exist ([below](#packet-1a-local-checks-implemented-source-run-on-the-current-schema)); the gates these regressions need do not.

## SQL surface and what static analysis cannot see

1,307 `prepare()` calls in `src`: 984 literal strings, 65 static templates, 235 interpolated templates (17 interpolate the table name: `connection-rotation.ts` three, `photo-scan-results.ts` two, `chat-interactions/connection-handoff.ts` one, `support.ts` one, ten in `workspace-identity/*`) and 23 passing a non-literal (`sql`, `uploadSQL + …`, `snapshot.sql`, `currentPlanSQL`). At least 1,017 statements name a tenant or project table in literal text. `gateway_spend_buckets` is never named in a `src` statement (triggers write it), and `contact_notification_suppression_resets` is written only from `tools/`.

An AST registry can enumerate entry points and helper calls. It cannot resolve dynamic or composed SQL, trigger-side writes (312 triggers) or operator scripts. `admitWorkspace` ([`admission.ts:20–55`](../src/workspace-identity/admission.ts)) proves only that the principal is current; nothing ties a bound tenant parameter to the principal except `assertWorkspace`'s `userId === principal.accountId`, and that equality disappears under C2. The membership clause in `identity_admission_checks` proves membership for workspace W but cannot see whether the domain statements in the same D1 batch bind W, because prepared statements are opaque.

The test-time authorizer (Node 24.21 `DatabaseSync.setAuthorizer`) reported every table and column touched at prepare time, including trigger-originated access tagged with the trigger name. Its hook point is `tests/sqlite-d1.mjs`, the default path of `tests/helpers/current-database.mjs` (177 tests use `databaseFixture`). It cannot see predicates or bound values, covers only executed paths, and is unavailable in the `--d1` mode. Two-workspace unique-marker fixtures are the only value-level proof.

## Lease simulation

Model: SQLite; unit hours; 720-hour periods; `recorded` is when Whumpo stores the paid invoice (a quantity the current schema does not have). Each scenario ran with an hourly observer running and missed, under the b319f33 rule (extend across any successor with `starts_at ≤ covered_until`; record a pause on any observed lapse) and a candidate rule (also require `recorded ≤ covered_until + W`; record a pause only at `now ≥ covered_until + W`) with **W = 24 hours used as an arbitrary stand-in**.

| Scenario | b319f33 | Candidate (W = 24 h) |
| --- | --- | --- |
| S1: on-time renewal recorded 1 h after the boundary (assumed latency) | `suspended`, `suspended_from = 720`, in all four observer cases | extended to 1440, `enabled`, in all observer cases; access denied from 720 to the recording, allowed after |
| S2: renewal paid 10 days late, period contiguous (assumed) | observer missed: extended to 1440, `enabled`, access allowed at t = 961; observer ran: `suspended` | `suspended` in both |
| S3: new subscription after a real gap | `suspended` | `suspended` |

Findings, restated precisely in the [contract](workspace-collaboration.md#plan-eligibility-downgrade-and-durable-suspension): the b319f33 statement that a missed or late observation delays visibility only is false (S2), and the same rule suspends ordinary renewals permanently (S1). **Limits:** three shapes; the 1 h latency and 24 h window are assumptions; the simulation has no preview grants, backdating, revocation, refunds, Whumpo downtime or clock skew; it shows that a receipt-time rule improves two failures, not that it solves every timing scenario; it is not a repository fixture.

Source facts that make the lease problem real: `stripe_paid_invoices.created_at` is the Stripe `invoice.created` value ([`src/stripe-billing.ts:83`](../src/stripe-billing.ts)), so there is no Whumpo receipt time; `stripe_subscriptions` is upserted, overwriting past-due history; only `checkout.session.*`, `invoice.*` and `customer.subscription.*` events are handled (`stripe-billing.ts:160–171`), with no refund, dispute or credit-note path; and preview grants may be backdated because issue checks only `endsAt > now` and `startsAt ≤ now + 7 days` ([`src/feature-preview-grants.ts`](../src/feature-preview-grants.ts)).

## Stripe documentation read (October 8, 2026)

- [Subscription invoices](https://docs.stripe.com/billing/invoices/subscription): a renewal creates an invoice, leaves it in `draft` for about an hour, then attempts to finalize and pay it.
- [Automatic collection](https://docs.stripe.com/invoicing/automatic-collection): Smart Retries can retry within 1 week, 2 weeks, 3 weeks, 1 month or 2 months, with a recommended default of 8 tries within 2 weeks; custom retry rules can replace it.
- [Invoice object](https://docs.stripe.com/api/invoices/object): `hosted_invoice_url` is the page that lets customers view and pay an invoice (null before finalization); `status_transitions.paid_at` is present on the object.

**Not verified:** period contiguity for payments recovered by retries; actual renewal webhook latency; `paid_at` semantics for retried or out-of-band payments; anything about disputes or refunds. Pricing and product availability pages were not consulted and no figure here is a price.

## Packet 1a local checks (implemented source, run on the current schema)

**Evidence level: local source and in-memory SQLite plus the TypeScript syntax tree, run on the tree that contains this text. No behavior, schema, deployment, provider or owner decision.** Tool usage, limits and the exact gates are in [tenant classification](tenant-classification.md); this section records what they measured and where it differs from the review.

| Check | Result on the current tree | Caveat |
| --- | --- | --- |
| Registry coverage | 111 users foreign-key columns, 111 tables, each classified once; delete actions 86 `CASCADE`, 17 `NO ACTION`, 7 `RESTRICT`, 1 `SET NULL`; schema fingerprint recorded | Classifications are proposals: 105 `proposed`, 6 `undecided` (named owner questions), 0 `accepted`; 102 from the review, 9 from source reading (not fixture-proven) |
| Indirect tenants | 78 tables without a `users` key reach `projects` or a `users`-keyed table (38 through a `project_id` foreign key, 40 through a longer chain); 29 have no tenant path; 6 carry a textual `project_id` | Reproduces the review's 78/38/29 by the recorded method |
| Reparse validator | All 640 triggers and 27 views compile; 640 INSERT/UPDATE/DELETE statements prepared in a disposable database, none executed; no `UPDATE OF` names a missing column; nothing unsupported | Proves resolution, not correctness; triggers compiled in isolation. Canaries prove it fires on SQLite-accepted stale columns, aliases, views, nested views and `UPDATE OF` a missing column |
| Cross-type lint | 5,512 comparisons resolved to base columns, 0 unresolved operands, 0 unsupported bodies; **50 findings in 46 objects**, all baselined | The 19 retention guards and 3 hold triggers the spike found by renaming are all found structurally, plus 24 further objects the spike called uncounted. Function, `CASE`, `CAST`, literal and parameter operands are untyped and never reported; assignments are not compared |
| Authorizer probe | One `DELETE FROM projects` reaches 137 tables through triggers and views, each tagged with the trigger or view name; restored per fixture; reports unavailable under `--d1` | Reports references only. A scoped query, a tautology and a wrong bound value give identical reports; only the unique-marker check separates them |
| SQL surface | 1,307 `.prepare` calls in `src`: 983 literal, 65 static template, 235 interpolated (**17 table-name interpolations**, one of them inside a nested template), 11 concatenations and 13 other non-literals (24 non-literal); 41 dynamic sites, each a fingerprinted allowlist entry with a reviewed reason | The review's text inventory counted 984 literal and 23 non-literal; the syntax tree classifies one `'…'+x` concatenation as non-literal, so **the tree is authoritative at 983/24**. Helper counts match the review exactly. Four tenant-bearing tables are never named in static SQL |

Every unresolved `unknown` or `polymorphic` entry of the review now has a registry entry with the status and evidence level above. That is a recording, not an acceptance: the child-1 schema review has not run, no owner answer to any of the six [remaining product questions](workspace-collaboration.md#remaining-product-questions) is recorded, and the 1b freeze command refuses.

## Not done, and unknown

There was no live D1, Stripe or GitHub access. Closure purge order, transfer obligations, custody resealing and total conversion effort are unmeasured beyond the counts above. The `github_connections` cardinality, the seven formerly undecided entries and the `backend_nominations` consent semantics now have **source-only proposed dispositions** that no fixture has exercised; the child-1 schema review must accept them. The hold-subject model remains an input to the existing WH-133/LC-06 review. The retention of the provider `login` in terminal GitHub revocation receipts is part of the open retention question, not a new one. Workspace-level bounds on platform-funded budgets are an unanswered owner question; the review adopted no cap.
