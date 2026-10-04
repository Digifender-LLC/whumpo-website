# Content-free funnel measurements (WH-025)

## Status — October 4, 2026 UTC

**Implemented in source; verified only with local SQLite and local D1 fixtures.** Not deployed, no live data read, and no cohort baseline exists. The opt-in consent default below is an agent decision awaiting owner confirmation. Every numeric target on this page and in the [roadmap](roadmap/README.md#what-to-measure) is **proposed until the first cohort baseline**.

No new Cloudflare product, plan or paid service is used. Rows live in the existing private control D1 database and are maintained by the existing hourly and daily [Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/).

## Consent: opt-in, off by default

Whumpo had no analytics or measurement consent before this work. The only related setting (`share_context`) controls AI context and must not be reused for measurement. The current choice is therefore:

- `user_profiles.measurement_consent` defaults to `0`. Absent profile rows count as off. Nothing is recorded for an account until its owner turns the choice on.
- The choice appears unchecked at the welcome "About you" step (saved with the bio, so first-project milestones can be measured) and in **Settings → Product measurements**. Both explain that only categories and minutes are kept and that turning it off deletes them.
- Turning it on stores `measurement_consented_at` (whole seconds). Only receipts dated at or after that time are measured. Consent is **not retroactive**: earlier receipts stay unmeasured, including after renewed consent.
- Turning it off clears the time and deletes that account's `funnel_events` rows in the same D1 batch as the profile update.
- Passkey signup and first-key enrollment happen before the account reaches welcome, so they are **never measured** under this choice. Identity friction is limited to later passkeys, recovery-kit saves and recovery.

**Owner decision requested:** confirm opt-in, or authorize a different basis (for example, a beta participation agreement or anonymous unlinked daily counters for pre-welcome identity steps). Do not change the default without that decision.

## Event contract

`funnel_events` (in [the schema input](../src/funnel-metrics/schema.sql)) is `STRICT`, immutable and keyed by `(user_id, event, source_key)`. A table `CHECK` admits only these event/dimension pairs. `source_key` is limited to `[A-Za-z0-9_.:-]` and names the same-account receipt that the event came from (for example `publication:<review id>`). `occurred_at` is the receipt's UTC minute.

| Family | Event | Dimensions | Source receipt |
| --- | --- | --- | --- |
| Activation | `welcome_completed` | `welcome` | `welcome_onboarding.completed_at` |
| | `draft_created` | `website`, `application` | `project_spec_creations`; first `backend_versions` row per project |
| | `edit_accepted` | `website_content`, `website_services` | Reviewed private saves in `project_spec_applies`, `service_client_applies` |
| | `review_prepared` | `website_publish`, `website_restore`, `application`, `app_page`, `app_restore`, `backend_publication`, `backend_form` | `publication_actions` (time = expiry − 10 minutes); `chat_review_receipts` |
| | `publication_confirmed` | `website_publish`, `website_restore` | Applied `publication_actions` and their `publication:` activity row |
| | `workspace_returned` | `day_7` (days 7–29), `day_30` (days 30–179) | First Chat turn in each window after welcome completion |
| Interaction (WH-112) | `interaction_started`, `interaction_draft_saved`, `interaction_submitted`, `interaction_resumed`, `interaction_canceled`, `interaction_expired`, `interaction_validation_failed` | Template family: `content_change`, `project_brief`, `project_select`, `choice`, `custom`, `status_view`, `other` | `chat_interactions`, `chat_interaction_requests`, `chat_interaction_submissions`; rejected answers and cancel are recorded by the handler |
| | `interaction_continued` | `succeeded`, `failed_stopped`, `failed_changed`, `failed_unavailable` | `chat_interaction_continuations` final state |
| Identity (reported separately) | `passkey_registered` | `signup_first`, `enrollment_additional`, `recovery_replacement`, `workspace_added` | `identity_ceremony_receipts` (`signup`, `add`) |
| | `recovery_kit_saved` | `enrollment`, `recovery`, `workspace` | `identity_effect_receipts` `kit_save` |
| | `enrollment_completed`, `enrollment_cancelled` | `enrollment` | `identity_effect_receipts` |
| | `recovery_started`, `recovery_secured`, `recovery_completed` | `recovery` | `identity_effect_receipts` |

`interaction_resumed` is any later save, submit or cancel after an earlier saved draft. It is a proxy and does not prove a separate visit. `recovery_kit_saved` is the customer's save acknowledgment, not proof that a kit was stored, printed or can recover the account.

### Never stored

No brief, project name, idea or audience; no website/application source; no Chat text, form answer, field ID, label, title or custom purpose; no email or name; no credential ID, public key, session/grant token or hash; no recovery key, kit verifier or recovery review contents; no file name, contents or object key; no provider identifier or secret; no other account's identifier. Template dimensions are code-registered families, not customer text. Funnel rows never enter model context, customer views or exports.

### Not measured in this slice

Client-side inline validation, required surface changes, unsupported or cancelled browser passkey prompts, recovery-kit print/download actions, time from form start to submission, and signup/first enrollment (see consent). These need client beacons or a different consent basis and are excluded rather than inferred.

## Recording and idempotency

The hourly and daily maintenance runs include the `funnel` job (`maintainFunnelEvents`): it prunes expired rows, then runs one bounded D1 batch of `INSERT OR IGNORE … SELECT` derivations (at most 500 rows per statement; later runs continue). Each derivation joins the consent view `funnel_measured_accounts`, requires the receipt time to be at or after consent and inside retention, and skips keys that already exist. Repeating the sweep adds nothing, and replayed handler requests reuse the same receipt and key.

Two handler-side recorders cover facts that a receipt cannot supply later: a server-rejected answer (`interaction_validation_failed`, keyed by the client request ID) and cancellation (which clears the form envelope, so its template family is recorded immediately). Both are best effort, consent-gated in SQL, and never change the customer response; the sweep derives the same cancellation key, using `other` only if the handler write was lost.

Database triggers were deliberately not used. Local D1 testing showed that a statement's `meta.changes` includes rows written by triggers ([D1 result object](https://developers.cloudflare.com/d1/worker-api/return-object/)), and current identity and other handlers assert exact change counts on their receipt statements.

Each account is limited to about 2,000 rows (the consent view stops admission at 2,000; a single sweep statement can exceed it by at most one batch). The 50-account user quota bounds the table.

## Retention and deletion

- Rows older than 180 days (`funnelRetentionDays`) are pruned by the `funnel` job. Derivations only consider receipts inside the same cutoff, so pruned rows are never recreated. Return windows close before day 180.
- Consent withdrawal deletes the account's rows immediately.
- `funnel_events.user_id` cascades on account deletion. The operator [closure inventory](account-closure.md) reports `funnelEvents`.
- The [lifecycle catalog](data-lifecycle.json) classifies `funnel_events` as `product-measurement`. The 180-day window is proposed, not owner-approved.

## Operator aggregate report

`node tools/report-funnel.mjs [--days 1-180] [--minimum 3-50]` reads the remote control database with existing operator authorization and prints JSON. It is read-only and returns only event names, dimensions, counts and median minutes. It never returns account, project, receipt or source identifiers. It has not been run against the test environment.

- Cells with fewer than `--minimum` accounts (default five) are replaced by `{suppressed:true}`. Activation stages, times to first draft/publication, identity counts and the receipt comparison all use the same rule. If fewer than the minimum accounts consent, comparison rows show only their status.
- The activation cohort is consenting accounts whose welcome completed inside the window. Stages are reach counts: welcome, first draft, accepted edit, review prepared, publication confirmed, and day-7/day-30 return.
- `receiptComparison` counts the actual source receipts independently (consenting accounts, after consent, inside retention) and reports `match`, `events_below_receipts` (sweep not yet run or quota reached) or `events_above_receipts` (a receipt was removed later, such as a project or form removal; otherwise investigate).
- Identity events are reported separately from first-project welcome, with `recoveryStartedWithoutCompletion` as the only abandonment proxy.

Small cohorts are not statistically reliable. Complementary suppression is not implemented; with a five-account floor, comparing two windows can still reveal small differences, so share reports only within the restricted operator group.

## Technical success versus usefulness

| Question | Measured by | Not evidence of |
| --- | --- | --- |
| Did the platform work? | Receipts and these events: draft saved, review prepared, publication confirmed, continuation succeeded, recovery completed | That the result was what the owner wanted |
| Did the owner come back? | `workspace_returned` windows | Satisfaction or ongoing value |
| Was it useful? | Only an explicit answer from the owner (feedback request below, or the WH-057 interview) | Anything inferred from counts |

Never treat publication, return or completion counts as usefulness ratings.

## Proposed targets (proposed until first cohort baseline)

These are starting hypotheses only. Replace them explicitly after the first consenting cohort; do not lower them silently.

- At least 8 of 10 consenting beta participants complete welcome → private draft → owner-approved publication, with every failure categorized. State small-sample uncertainty.
- At least 90% of supported routine interaction attempts end in submission or an explicit cancel rather than expiry, with validation failures categorized by template family.
- Identity: establish the supported-device baseline for additional passkeys, kit-save acknowledgment and recovery completion before setting any numeric target.
- Usefulness: the owner's own rating from the feedback request, reported separately from all technical counts.

## Draft feedback request (do not send)

**Status: draft only. Do not send, schedule or automate without explicit owner instruction naming the recipients and channel.** It requests opinions, not content, and must not include any funnel data about the recipient.

> Subject: Two quick questions about your Whumpo test
>
> Hi {first name},
>
> Thanks for trying Whumpo during the private test. Would you answer two short questions? Replying is optional and does not affect your account.
>
> 1. On a scale of 1 (not at all) to 5 (very), how useful was what you made with Whumpo so far?
> 2. What, if anything, stopped you or slowed you down?
>
> Please do not include passwords, recovery kits, or private customer information in your reply. We will use your answer only to improve the product during this test.
>
> Thank you,
> The Whumpo team

## Verification

`node tests/funnel-metrics.mjs` and `node tests/funnel-metrics.mjs --d1` drive actual welcome, profile, form, website creation/apply, publication and identity enrollment/recovery handlers against a disposable current-schema database. They cover the contract `CHECK`s and immutability, the off-by-default choice, non-consenting complete journeys (zero rows), replayed completions/confirmations/submissions and repeated sweeps (exactly one event per receipt), withdrawal deletion, no backfill after renewed consent, cancellation template capture, retention pruning without re-derivation, the per-account quota, account-deletion cascade and closure inventory count, receipt comparison (`match` for every metric), small-cell suppression, and scans of stored rows and reports for seeded private markers, emails, other accounts' identifiers, credential IDs, token hashes, kit verifiers and recovery keys. These are synthetic local results, not live acceptance.

## Open owner decisions

1. Confirm opt-in consent, or name a different basis (see above).
2. Approve or change the proposed 180-day retention and five-account suppression floor.
3. Decide whether pre-welcome identity steps should get anonymous, unlinked aggregate counters.
4. Authorize any operator report run against the test database, and any sending of the feedback request (recipients, channel, timing).
