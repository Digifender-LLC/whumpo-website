# Content safety and US customer eligibility

The [WH-010 safety coverage map](safety-coverage.md), reconciled October 1, 2026 UTC through migration 0113, traces mounted intake, model, execution, preview/export, publication and serving paths. It distinguishes photo/import holds and recorded specification/service holds from unconnected detector/risk producers and the remaining CMS/generated-content/visitor-data gaps. It is a design and source inventory; no scanner or CMS feature acceptance is implied.

## Product decisions — September 30, 2026

Whumpo initially accepts **US-based customers only**, including organizations based in the US. This is customer eligibility, not a promise to restrict every visitor of a customer website to the US. Foreign travel is not evidence that an existing customer is ineligible. US-only customers do not remove federal/state obligations or settle every jurisdiction question.

Prohibited work and hosted content:

- Illegal activity, child sexual exploitation and CSAM.
- Sexual content of any kind; no adult-content exception.
- Copyright piracy, including unauthorized movie distribution, streaming or download services. Lawful original, licensed and public-domain media services are not automatically piracy.
- Scams, phishing, credential theft, deceptive clicks and click fraud.
- Hate and targeted harassment.
- Gambling services, wagering, betting and casinos. This exclusion avoids an additional regulated business area; it is not a moral judgment or dependent on whether a particular jurisdiction permits it.

**Graphic violence alone is not a blanket ban.** Threats, targeted abuse and otherwise illegal activity remain prohibited. Avoid an undefined automated “immoral” category. New categories require an explicit product decision. Abuse reporting, prevention, removal and lawful security education must not be mistaken for requests to create prohibited content.

Content safety is mandatory at every plan and every usage level. Financial fair-use **Monitor mode cannot disable it**, and buying credits cannot override it. Distinguish a policy refusal from a determination that a person committed a crime.

## Current source and test deployment

The current [identity contract](identity-web.md) requires `usBased:true`, an unused invitation and successful Turnstile validation when preparing passkey signup in both test and local environments. Signup verification accepts the current credential response and uses the declaration version bound into its one-use challenge. Registration commits the declaration with the account, staged credential and restricted enrollment grant. Workspace access still requires completing current enrollment. There is no password signup or local exemption in this source.

The shared AI transport prepends the versioned platform content policy to both supported inference protocols, covering orchestration and auxiliary model calls using this transport. Internal cost reservations include the policy text. The inactive AI Gateway transport still needs its own policy integration before activation.

These are eligibility and agent-instruction foundations, not comprehensive content enforcement. Self-declaration does not verify residence. No IP location is treated as legal residence. Instructions do not certify images or source trees or replace server-side publication gates. Separate acceptable-use-policy consent remains outstanding. No scanner or paid service is activated by this work.

The current identity/schema cutover is pending. Earlier deployment records below describe their historical release only. The current eligibility fixture verifies real ES256 credential registration with synthetic Turnstile, strict declaration types, unchanged invitations after refusal, immutable receipt fields and full account/credential/grant rollback when receipt storage fails. See [current verification](verification.md#usage-operator-records-gateway-ledger-and-eligibility).

## Required import and upload contract — planned, release gate

Imported code must be scanned **in the background before management**, not after activation. The same principle applies to customer media and generated publication artifacts.

1. Accept bounded inputs into private quarantine. Record owner, immutable digest, format, source provenance and policy/scanner versions. Do not execute imported source, install dependencies, render active HTML, pass source to the general agent, or expose media while pending.
2. Process durable, idempotent jobs. Inspect archive expansion/path traversal/symlinks, binaries and dependencies; detect malware/secrets and prohibited functionality/content. Scan referenced assets separately. Repository URLs, filenames and README claims are untrusted. Do not follow arbitrary network links during scanning.
3. Require all checks relevant to that format. Unsupported formats, scanner failure, timeout, missing coverage and inconclusive verdicts remain quarantined. An empty result or an LLM's “safe” answer cannot approve anything.
4. Bind trusted scan receipts to exact bytes, owner and policy version. Client/model fields cannot mint approval. Edits, new assets, changed dependencies and policy invalidation require new scans. Existing immutable version/publication reviews still apply afterward.
5. Enforce approval in execution, management, preview/export, publication **and serving paths**, including direct APIs and alternative hosts. No grandfathering old unscanned assets as clean. Restrict cached copies and revoke affected publications on a later safety match.
6. Maintain restricted safety cases, evidence retention and customer-facing refusal/appeal state separately. Do not copy suspected CSAM into chat, model context, ordinary logs, GitHub, tests or general support queues. Safety handling must survive customer deletion and ordinary cleanup where legally required, with restricted access and explicit retention authority.

Initial implementation inventory must include profile photos, project photos, CMS uploads/imports, WordPress references, imported/generated backend source, generated pages, visitor inputs and private/public serving paths. General GitHub source import is not made available simply because the backup integration exists. CMS feature acceptance stays paused; safety gates are a separate requirement. Static scanning cannot prove arbitrary code's future behavior; runtime isolation, restricted networking, publication review and subsequent abuse response remain necessary.

## CSAM detection — planned, owner-deferred

As checked September 30, 2026, Cloudflare's [CSAM Scanning Tool](https://developers.cloudflare.com/cache/reference/csam-scanning/) compares images passing through Cloudflare cache against known CSAM lists. It requires a notification email; notifications describe detections and whether blocking succeeded. It is a useful additional public-delivery layer, **not a private R2 upload scanning API or a guarantee of detection before the first delivery**. Do not publish quarantine objects to make this tool scan them. Verify zone entitlement, service terms, charges and compatibility with each Worker delivery path before activation; none is claimed configured here.

Private intake needs a vetted pre-publication service/partnership for known-CSAM matching plus separate sexual-content detection. Known-hash matching alone does not identify every new image; an adult-content classifier is not verified CSAM detection. Coverage for images, video, transformed copies and unsupported formats must be explicit. Provider selection, access, data processing terms and pricing require verification. Do not let the building agent inspect suspected CSAM or make final reporting decisions.

**Owner decision, October 1, 2026 UTC:** CSAM scanning is planned only. Skip scanner implementation, provider enrollment and activation until the owner explicitly resumes this work. WH-011 is deferred, not completed. The unused provider-response helper and its test prepared during research were removed before commit or deployment. Existing quarantine and recorded-hold foundations do not constitute CSAM detection; this deferral does not approve held content.

## US operational prerequisites — not yet configured

The current [18 USC 2258A](https://usc-cdn.house.gov/view.xhtml?edition=prelim&num=0&req=granuleid%3AUSC-prelim-title18-section2258A) establishes reporting and preservation duties for covered providers when the statutory knowledge conditions are met. US-only eligibility does not eliminate these duties. Before real beta, establish restricted incident handling, a responsible operator, NCMEC provider reporting access, a legally reviewed preservation/removal process and an emergency escalation path. Do not treat automatic deletion as a substitute for required preservation, or assume Cloudflare makes Whumpo's report for it. Exact applicability and procedures need qualified US legal review.

Also establish a published acceptable-use policy, abuse-report intake, copyright notice/takedown process, repeat-infringer procedure and an appeal path with independent review. These are launch prerequisites, not claims of completed legal compliance. No external reports or messages are sent by this implementation.

## Deployment evidence

Deployed September 30, 2026 as platform `bb54e8fa-2f96-48fa-89b5-1f7492cb7be7`. Independent readback at 16:22 UTC confirmed the active version, all 16 frontend assets matching the tested release, health 200, anonymous workspace reads 401, and all three signup endpoints rejecting missing US declarations with 403 and no session cookies. All 97 migrations remain applied; none was added. Financial Monitor mode remains enabled. No scanner, safety-reporting integration, customer publication or paid service was activated. Evidence: `.secrets/content-policy-release-verification.json`.

## Direct backend import quarantine — deployed to private test

Migration 0098 separates imported JavaScript from executable `backend_versions`. The existing authenticated code-upload endpoint now returns 202 with a private `backend_imports` receipt. It no longer creates a testable version. Immutable source/digest, owner/project and policy version are bound together; exact replay returns the current status, changed payload/foreign ownership is rejected. Quarantine storage is bounded at 25 per project, 100 per account and 1,000 platform-wide, each at most 8 KiB. No archive, repository or dependency fetching is introduced.

Existing scheduled maintenance processes at most ten pending imports each run, normally hourly. Preliminary checks validate the stored digest and flag a narrow set of credential, dynamic-code and module-dependency patterns. They never execute source, call a model, fetch dependencies or log source. These checks can flag benign comments and miss obfuscation; they are triage, not a complete malware/content classifier. Findings produce `blocked`; no findings produce `requires_review`. **There is intentionally no approval/promotion path while a full scanner is unavailable.** Pending, blocked and review-required imports cannot be used as backend versions, tested or published. Direct insertion of a backend version using a quarantined ID is also rejected by a database trigger.

GET backend inventory adds metadata-only `imports`; `/backend-imports PROJECT_ID` and the agent's `backend / imports` action provide that status in Chat. Neither returns source or internal finding details. No import source is passed to the general agent.

Scope remaining: generated source and source pasted directly into Chat are not comprehensively scanned yet; neither are existing backend versions, media/profile uploads, CMS imports or visitor data. The quarantine gate covers this direct external-code upload path only. Restricted legal-hold storage is still outstanding; ordinary account/project deletion currently cascades these non-approved source receipts. This is not a complete safety launch gate and does not enable CSAM detection.

Verification for this slice: `pnpm check`, `node tests/backend-imports.mjs`, and `node tests/customer-app-journey.mjs` passed. Disposable D1 tests cover authenticated HTTP 202/replay, private metadata-only inventory, denied execution, tenant isolation, immutable source, terminal triage states, bounded scanning and quotas. The application journey exercises actual isolated QuickJS, visitor passkeys/data/recovery and the shared task-list using an explicitly seeded trusted synthetic backend; it does not bypass quarantine for a customer import. The isolated release passed TypeScript and frontend asset-loading checks, reusing unchanged frontend assets. The four standalone HTTP fixtures were subsequently migrated to disposable environments; see [current quarantine-aware backend acceptance](backend-execution.md#quarantine-aware-http-acceptance--september-30-2026). They now assert direct uploads are quarantined and seed distinct trusted synthetic versions for runtime acceptance. This does not provide a customer import promotion path.

Deployed September 30, 2026 as platform `aab040f8-7c60-46ec-8344-3133f4af8214`. Live readback at 16:31 UTC verified all 98 migrations, the four new quarantine triggers, unchanged Monitor mode, 16 matching frontend assets and health/auth/signup boundaries. The scheduled triage function was exercised locally; an actual scheduled cloud invocation has not yet been observed. Evidence: `.secrets/backend-import-release-verification.json`. No customer import or publication was created by live verification.

## Profile-photo safety gate — deployed to private test

Migration 0099 adds a digest bound to the prepared JPEG and a private, per-account safety receipt. Upload and pending receipt commit atomically under the existing profile revision check. Built-in artwork remains usable; uploaded photos are hidden until a current-policy receipt records both known-CSAM and sexual-content checks as clear, with a scanner reference and a valid unexpired timestamp. No client/model field can set that status. There is **no production provider adapter or approval endpoint yet**, so real uploads remain pending. This is enforcement of a hold, not detection.

Profile reads expose only `photoSafety` and whether a photo can be displayed; no digest, scanner reference or image enters model context. The image endpoint returns 423 before image delivery for missing, blocked, expired or unapproved receipts, then verifies the exact stored bytes against the approved digest before serving. New bytes and selecting built-in artwork invalidate the old receipt. A blocked receipt cannot transition back to approved. Existing photos without a scan are held too. The picker explains the hold and continues displaying the chosen artwork. Name, bio, authentication and onboarding remain available.

This bounded receipt is not a legal-evidence archive: ordinary photo replacement/deletion currently removes it. Restricted incident retention and reporting remain separate unfinished launch work. Project/CMS media still need equivalent gates; do not infer those are protected from this profile-only change.

## Scanner discovery — September 30, 2026

Read-only account inspection found the CSAM tool disabled and email verification incomplete on both `whumpo.com` and `whumpo.site`. A monitored notification address has been requested; no setting was changed. [Cloudflare's settings API](https://developers.cloudflare.com/api/resources/csam_scanner/methods/get/) and [CSAM tool documentation](https://developers.cloudflare.com/cache/reference/csam-scanning/) describe the additional cache-delivery layer. Evidence: `.secrets/csam-settings-inspection.json`.

[Microsoft PhotoDNA Cloud Service](https://www.microsoft.com/en-us/photodna/CloudService) is advertised free for qualified organizations subject to vetting. It offers known-image hash matching; it does not by itself fulfill Whumpo's broader sexual-content ban or establish coverage for every upload format. Whumpo has not applied or been accepted, and API credentials, service terms and integration coverage are unverified. No images were sent to Microsoft or any moderation provider. [Thorn Safer Match](https://safer.io/resources/introducing-safer-essential-api-based-csam-detection/) is another API candidate; pricing and access require verification before any commitment.

Local verification for the profile gate: `pnpm check` and `node tests/profile.mjs` passed, including pending denial, incomplete-check rejection, a synthetic trusted approval, revocation, non-reapproval of blocked receipts, legacy-image hold, invalid/expired receipt denial, deletion/selection invalidation and private model context. These tests used generated solid-color JPEG fixtures and direct synthetic database receipts; they do not establish provider detection accuracy. The isolated release passed both TypeScript projects, production build and `node tests/frontend-loading.mjs`. No new browser/touch acceptance or external image scanning was performed.

Deployed September 30, 2026 as platform `2aa7f348-b078-4a73-885a-03cbff9d1510`. Independent readback at 16:40 UTC verified all 99 migrations, three profile safety triggers, all 16 frontend assets, health/auth/signup boundaries and unchanged financial Monitor mode. Evidence: `.secrets/profile-safety-release-verification.json`. No real account photo was uploaded, inspected or approved during verification.

## Project photo gate — deployed to private test

[Project-photo safety](photos.md) now separates storage completion from approval. Migration 0100 backfills existing images into pending and prevents unapproved image references/publication at the database boundary. Exact-byte, owner/policy/coverage/expiry checks protect private reads, previews, downloads, public image URLs and custom-domain delivery. The scanner remains unconfigured, so this is a fail-closed hold, not CSAM detection. CMS image paths and general generated-content screening remain outstanding.

## Adaptive customer risk — calculated policy, not live enforcement

September 30, 2026: `src/content-risk.ts` implements an internal risk calculation and proposed supplemental scanning schedule. **A durable internal evidence ledger is now implemented below, but trusted evidence ingestion, moderation providers, sampling dispatch and customer restrictions are not connected yet.** Existing upload/import quarantine remains unchanged. Neither a low score nor the output of this helper is an approval receipt.

Risk is based on trusted, tenant-scoped safety findings, not raw keyword matches, plan price, demographics, or a customer's description of their business. A landscaping brief alone does not establish trust. Count confirmed requests to create prohibited material and confirmed attempts to evade safeguards; legitimate reporting, removal, discussion and educational work are not violations. Model refusals, cost limits, technical failures and preliminary code-scan matches do not automatically qualify as confirmed violations. A detector flag is uncertain until appropriately adjudicated. Do not give the general building agent authority to write or overturn these records.

Initial internal scoring defaults (subject to calibration before activation):

| Evidence | Points |
|---|---:|
| Verified benign interaction | 0; contributes to established history |
| Uncertain safety flag | 3; all uncertain flags together capped at 10 |
| Confirmed policy violation | 15 |
| Confirmed safeguard evasion | 25 |
| Unresolved critical safety incident | 100 until explicit resolution |

Ordinary adverse points halve every 30 days and leave the calculation after 90 days. Two or more separate confirmed incidents in seven days add 10 points per incident after the first, capped at 20. Scores cap at 100. Retries and multiple detectors for the same incident count once using its strongest active finding and earliest timestamp for that finding. An adjudicated reversal excludes the entire incident. Benign activity never subtracts adverse points, and critical unresolved incidents do not decay. The score is an operational signal, **not a probability of wrongdoing**.

| Score / history | Supplemental chat-text screening | Supplemental generated-artifact screening | Response |
|---|---:|---:|---|
| Established, score 0 | 5% | 10% | Baseline checks plus unpredictable sampling |
| New/unestablished, score 0–19 | 25% | 100% | Build verified history |
| Elevated, score 20–49 | 100% | 100% | Additional scrutiny |
| High, score 50–79 | 100% | 100% | Additional scrutiny; inspect repeated patterns |
| Review, score 80–100 | 100% | 100% | Restricted operator review; score alone does not ban an account |
| Missing/incomplete history | 100% | 100% | Fail conservative; do not infer trust from missing records |

Established requires a complete trusted history, score zero, and at least 20 independently verified benign interactions across seven distinct UTC days in the last 30 days. A successful model response or absence of a block is not verification. These percentages apply only to **additional** screening. Every request retains the agent policy and action authorization; every uploaded media item and imported code item retains the relevant mandatory scans and quarantine. Existing publication, isolation and serving checks always apply. Specific current-content risk overrides history and sampling; a previously harmless customer may upload unsafe material or have a compromised account. An unchanged exact artifact can reuse a valid, owner-bound, unexpired receipt under the current policy; account reputation cannot create or extend that receipt.

Remaining activation work:

- A restricted durable evidence ledger with provenance, stable incident IDs, authoritative occurrence times, audit history and explicit reversal decisions. No raw suspected illegal media or full conversations in score records. Account deletion and legal preservation require separate restricted procedures.
- Trusted classification/adjudication and event producers. Do not mine existing chat with crude keyword rules or treat existing model refusals as proven violations. Retrospective scoring must respect corrections, ownership and retention.
- Server-controlled, unpredictable sampling bound to immutable request/artifact IDs so retries cannot reroll a check. Selected checks complete before the applicable action; unavailable or inconclusive scanners hold that action. Current suspicious content triggers checks regardless of sample selection.
- Bounded history aggregation that includes unresolved critical cases even outside the ordinary 90-day window. A truncated or failed query marks history incomplete. All tenants/plans follow the same content-safety policy, independent of financial Monitor mode.
- Calibrate false positives and sampling rates in shadow evaluation before activating lighter paths. Measure sampled violation rates, scanner failures and missed coverage. Provide an independent correction/appeal path. Restrict the offending action based on its evidence, rather than automatically removing unrelated sites based solely on a numeric score.

Verification: `node tests/content-risk.mjs` covers tenant separation, deduplication, time decay, repeated evasion, uncertainty caps, reversals, critical-case persistence, missing history, established-history requirements and mandatory baseline checks. This is local policy verification, not live detection or acceptance evidence.

## Trusted photo scan results — integration foundation

September 30, 2026: `src/photo-scan-results.ts` and migration 0101 implement internal scan reservations and atomic result recording for profile/project photos. No HTTP endpoint, model tool, cron dispatcher or provider adapter invokes this module yet. It does not detect CSAM or sexual content. Current image holds remain in effect.

Reservations bind an owned pending photo's exact digest and policy to a random scan ID and a private capability token. Only its hash is stored. Tokens must never enter customer responses, agent context or logs. Reservations expire after 15 minutes. Strict evidence requires both checks and bounded opaque provider references; extra fields, mismatched digests/policies and malformed checks are rejected. The provider adapter must verify actual bytes and authenticated provider responses before constructing evidence; possession of a token alone is not a scan.

Both clear checks permit a 24-hour approval; either match blocks; an inconclusive check keeps the photo pending. Ticket completion and the safety transition occur in one database batch. Removed/replaced targets and expired reservations record a stale result without releasing anything. Identical retries recover the recorded result, including lost acknowledgements; competing different results cannot overwrite it. `applied` describes the original transition, not present-day serving permission: serving still rechecks current approval, digest and expiry. A later adverse finding needs a separate revocation/incident path, not reuse of an already-completed ticket.

The ledger stores a canonical result fingerprint and the photo safety row references its ticket. It does not retain full provider responses, raw imagery or separate retrievable provider case references. It is bounded at 100 tickets per account and 5,000 platform-wide, with one reserved attempt per kind/subject/digest/policy. Migration 0102 preserves all old attempts and allows new attempts after terminal or expired reservations. Reservation atomically retires expired attempts and resets expired approvals to pending with unknown checks; live approvals and blocked results cannot be reset. Inconclusive results can retry, but neither retries nor rescans extend an old approval. Older tokens cannot complete a newer attempt. Durable dispatch, retry backoff/attempt limits, quota housekeeping and provider-reference reconciliation still need implementation before enabling a dispatcher; [WH-052](background-jobs.md) specifies the selected journal/recovery design and an uncertain-scan trace, with local prototype evidence only. The ledger currently follows account deletion; it is **not a legal preservation store**. Restricted case handling, preservation/reporting, provider onboarding and authentication, verified coverage and costs remain activation prerequisites. No real suspected-illegal material was used or sent to a provider.

Local verification: `pnpm check` and `node tests/photo-scan-results.mjs`. The disposable D1/R2 test uses generated solid-color JPEGs and synthetic evidence to verify authority hashing, ownership/digest/policy binding, strict check coverage, pending/blocked/approved delivery, replay/conflict/concurrency, lost batch acknowledgement, changed targets, expired reservations and immutable terminal records. These tests establish result-handling behavior, not detector accuracy or live provider acceptance.

Retry verification: `node tests/photo-scan-results.mjs` also covers profile/project expired-clearance rescans, inconclusive retries, expired-ticket supersession, blocked/live-clearance refusal, competing reservations and lost reservation acknowledgements. The former migration-preservation fixture is retired: disposable test databases now initialize the complete current schema, verified by `node tests/current-schema.mjs`. Historical migration evidence does not establish current scanner acceptance. Scanner implementation/testing remains owner-deferred; this source alignment does not resume it.

## Supplemental screening selection — source implementation, inactive

September 30, 2026: `src/content-screening.ts` connects the risk calculation to a deterministic internal sampling decision. It has no live caller or configured key and does not grant publication, execution or serving permission. `required:false` means only that this particular supplemental check was not sampled; all baseline protections remain mandatory.

A dedicated server-held 256-bit random HMAC key selects a sample from the owner, format, policy version and exact content/context digest. Request IDs and wall-clock time are excluded, so resubmitting identical work under a new request ID cannot reroll it. The integration must hash the exact normalized content **and all action-relevant context**, including relevant conversation and tool/action scope; hashing the newest message alone is insufficient. New content needs a new decision. The sampler uses a fixed threshold with the risk-selected percentage, so increasing scrutiny cannot unselect the same sample. Media/imports always require checks; missing/incomplete history or a current content flag requires full supplemental screening. A missing/malformed key or cryptographic failure also requires screening.

Keep the key, scores and sampling decisions internal; do not expose a sampling oracle to customers or the building agent. Use a dedicated key rather than an authentication, encryption or provider credential. No key was provisioned by this change. Before live use, persist selected checks against immutable owned actions/artifacts and make them sticky: later risk decay, key rotation or policy changes must not cancel an outstanding selected check. Dispatcher integration, trusted risk history, rate limiting against content mutation attempts, calibration and scanner availability remain outstanding. The helper is not an enforcement layer or provider integration.

Verification: `node tests/content-screening.mjs` checks stable retries, independent Node/Web Crypto HMAC agreement, scrutiny escalation, tenant/format validation, missing-key and crypto-failure behavior, and mandatory media/import checks. `pnpm check` verifies both TypeScript projects. No migration, deployment, provider call or customer-content processing occurs in these tests.

## Persisted screening requirements — source foundation, inactive

Migration 0103 and `src/content-screening-decisions.ts` persist supplemental requirements keyed by owner, content/context digest, format and risk-policy version. Initial reason, sampling percentage and risk score remain immutable. A subsequent assessment can upgrade an unsampled decision to required, recording its escalation reason/time; no update can downgrade a required check. Requests with new IDs reuse the same content-bound record. Key changes, risk decay and same-policy retries cannot erase a saved requirement. No raw conversation, source, provider key or imagery is stored in this table.

The helper calculates from trusted server history, inserts only when no record exists, and escalates in the same atomic batch. It reads the retained requirement before returning; a lost acknowledgement may recover a committed requirement, while absent/unconfirmed required state yields 503 and must hold the action. Customer/model-supplied history is not an authorized input. This is not the trusted evidence ledger, a detector verdict, a completed check or permission to act. There is still no runtime caller, moderation dispatcher or customer endpoint. Existing live gates are unchanged.

The eventual action/publication transaction must recheck the current requirement and matching completed scan at commit time: a result returned before a concurrent escalation is not authorization. Policy changes require explicit invalidation/re-evaluation, rather than silently treating a new policy key as cleared. Capacity is bounded at 10,000 records per owner and 100,000 globally for this inactive foundation. Cleanup/retention, unresolved-case preservation and capacity operations must be designed before activation; these storage safeguards are not advertised AI quotas. Account deletion currently cascades these records, so they are not a legal evidence archive.

Verification: `pnpm check`, `node tests/content-risk.mjs`, `node tests/content-screening.mjs`, and disposable-D1 `node tests/content-screening-decisions.mjs`. Tests cover sticky selection, upward escalation, competing requests, tenant isolation, immutable identity, lost-response recovery, database failure holds and absence of execution permission. Real moderation, trusted-history ingestion and live acceptance remain outstanding.

### Current requirement consumers — October 1, 2026 UTC

The earlier “inactive foundation” description applies to automatic requirement creation and scanner dispatch. Since migrations 0110–0113, saved [website specifications](project-specification-storage.md#removal-bounds-and-safety) and [service configurations/activation](project-service-clients.md) **do consume recorded required rows**. Exact owned specification, manifest, preview/candidate, website and backend dependency digests can hold private reads/changes/restores, proposal previews/comparisons, final private apply/publication, and linked contact/form activation. Later requirements suppress linked live clients/contact intake, including a final SQL contact-insertion guard. Critical separate disable reviews remain available.

This does not create or complete scans. `reserveContentScreening`, `reservePhotoScan` and `recordPhotoScan` still have no running dispatcher/provider adapter. Current hold consumers do not ignore an outstanding requirement from an older policy. There is no general-content approval mechanism that can release it. Legacy website versions without a specification row, ordinary unlinked service reviews, separately published backend endpoints, submitted visitor/contact data and old Chat/inspection copies retain the gaps listed in S08–S17 of the coverage map. Pinned compiler output and a successful runtime test are not clearance.

The agent's knowledge guidance names those limits and forbids bypassing a hold or claiming that unscanned work passed. Source requirements and actual server checks remain authoritative; knowledge text is not enforcement. The [lifecycle contract](data-lifecycle.md) handles duplicated snapshots and future restricted preservation separately.

## Recorded US declaration at signup

The complete current schema records `us-based-customer-2026-09-30-v1`, US scope, the `passkey` signup method and a server timestamp in `customer_eligibility`. The explicit declaration is required in test and local environments and bound to the signup challenge. Successful credential verification saves it atomically with account creation, invitation consumption, enrollment attempt, staged passkey, ceremony receipt and restricted grant. Receipt storage failure rolls the whole transaction back. The challenge is consumed; a fresh ceremony can use the still-unused invitation after storage is repaired. No workspace session is issued at this enrollment stage.

The declaration is immutable through updates and cascades on account deletion. It stores no IP address, inferred location or copied email. Login, recovery and adding passkeys do not invent signup declarations. This records self-declaration only; a separately versioned acceptable-use agreement remains outstanding. The current test cutover initializes fresh state and does not backfill old accounts.

`node --stack-trace-limit=0 tests/customer-eligibility.mjs` passes on complete-schema local D1 using independently generated ES256 credentials and a synthetic Turnstile response. Both environment modes verify exact version/method/time, immutable records, false/missing/wrong-type declaration refusal, mandatory invitation/Turnstile, enrollment-only access, receipt-failure rollback with no partial account/key/attempt/grant rows, unused invitations, one-use challenge refusal and successful fresh retry. This is not physical-device or human Turnstile acceptance.

## Durable reviewed risk evidence — inactive integration foundation

Migration 0105 and `src/content-risk-evidence.ts` add internal recording, correction and history-reading functions for adaptive safety. There is no customer endpoint, general-agent tool or automated classifier writing these records. The reviewed operator CLI below is now available. The live build does not use this history to change scanning or restrict customers. Do not automatically turn a model refusal, keyword mention, preliminary import flag or high cost into a confirmed violation.

Evidence records bind an immutable ID, owner, incident, kind, occurrence time and opaque evidence/reviewer references. References must point to independently reviewed evidence in the future restricted case system; accepting a syntactically valid reference does not authenticate an adjudicator or verify the evidence. Raw messages, source, media, secrets and reviewer names do not belong in these fields. The API permits exact replay, recovers a committed insert after a lost acknowledgement, and rejects conflicting reuse. Database triggers reject future occurrence times, mutation and ordinary deletion, and bound storage at 10,000 evidence rows per owner / 100,000 globally. This is an inactive storage safeguard, not an advertised customer AI quota.

Corrections are immutable per owner/incident and require an existing incident belonging to that owner. A correction excludes all receipts for that incident from scoring, including later duplicates. Reopening a corrected case is not implemented; do not reuse an incident ID to override a correction. The evidence remains retained for review. The existing risk calculator counts the strongest finding once per incident, so multiple detector receipts or repeated insert attempts do not multiply the score.

History reads use a single tenant-scoped evidence/correction query and retain all ages, including old unresolved critical incidents. More than 10,000 results, malformed evidence or a failed query raises an error; callers must hold the applicable action rather than substitute an empty history. Missing accounts are rejected. Evidence/reviewer references are omitted from the calculation input. History currently always reports `complete:false`: no trusted ingestion/backfill or coverage certification exists, so even an empty ledger cannot establish lower-risk sampling. Media/import baseline gates remain mandatory.

Ordinary account deletion cascades these rows unless a [WH-015 preservation hold](#restricted-safety-cases-and-preservation-holds--source-foundation-local-only) is active. The ledger itself is **not a legal preservation archive**; deployment of the WH-132 restricted case surface, adjudication policy, independent appeals, calibrated evidence producers and dispatcher/action integration remain required before activation. No existing customer Chat was read or retrospectively scored, and no customer evidence was invented.

Verification: `pnpm check`, `node tests/content-risk-evidence.mjs`, `node tests/content-risk.mjs` and `node tests/account-closure-inventory.mjs` passed. The evidence test applies the full schema to disposable in-memory SQLite and covers owner separation, duplicate/conflicting records, correction replay/conflicts, strongest-incident scoring, a 400-day-old critical incident, lost insert/correction acknowledgements, immutable records, future-date refusal, read failures and account cascades. These are local SQL/service tests, not detector or live evidence-ingestion acceptance.

Migration 0105 was applied to the private test D1 database on September 30, 2026. Readback at **17:50:54 UTC** confirmed 105 applied migrations, all six ledger triggers and zero evidence/correction rows. No Worker deployment was needed because the module has no runtime caller. Local ignored evidence: `.secrets/content-risk-evidence-migration.json` and `.secrets/content-risk-evidence-migration.log`.

## Restricted safety cases and preservation holds — source foundation, local only

October 4, 2026 UTC. The WH-015 contract/current-schema slice is [WH-131](roadmap/backlog.md); the authenticated operator surface, evidence storage, scoped holds and disclosure are [WH-132](roadmap/backlog.md). Implemented in `src/safety-cases.ts`, `src/safety-case-http.ts` and the canonical `schema/platform.sql` (ten tables and two views). **Implemented in source and verified locally only. Not deployed, not configured and not accepted. No operator has been bootstrapped, no live database was read, and no evidence was captured.** The case tables hold only opaque identifiers and digests, never allegations, messages, names or credentials.

### Authenticated operators (WH-132)

- **Identity.** Every operation takes the operator's resolved Whumpo passkey principal (`resolveIdentity` → `IdentityPrincipal`) and derives the actor `human:<accountId>` itself. Declared actor references are not accepted anywhere; an `actor` field in an HTTP body is refused as `invalid_input`. The SQL that commits each operation repeats the identity gate (ready account, live session, **passkey proof within the last 10 minutes**), so a session revoked or a proof that goes stale between the read and the write is refused. Unauthenticated attempts are audited as `denied/unauthenticated` with no actor.
- **Roles.** `role_administrator` grants and revokes the other roles. `case_reviewer` opens cases, links evidence, records findings, requests disclosures and closes cases. `preservation_approver` places and releases holds and captures and disposes of evidence. `case_auditor` reads the audit. `disclosure_approver` approves and records disclosures. Grants require a ready passkey identity and are refused for oneself. Revocation is one-way and immediate.
- **Bootstrap.** The first `role_administrator` is created once with `node tools/safety-case-bootstrap.mjs --grant ID --account ACCOUNT_UUID [--apply]`. That uses the operator Cloudflare D1 credential, which is the same trust root as the other operator tools. It only succeeds while no administrator is active. Every later grant needs that administrator's authenticated session.
- **Conflict of interest.** An operator cannot act on, read or list a case or hold whose subject is their own account. Such a case is answered exactly as an absent case (`not_found`) and audited as `conflict_of_interest`.
- **Restricted surface.** `POST /api/operator/safety-cases/v1/<action>` serves same-origin JSON only, behind the existing origin check and API rate limiter. Bodies must use exact keys with `version: 1` and be at most 16 KB. Responses are `no-store`. The surface has no Chat tool, agent, model access or customer route. Nothing is logged. Identity failures return the ordinary `proof_required`/`identity_changed` codes so the browser can reauthenticate. **No review UI was built**; the actions are callable by an authenticated operator client only.

### Cases, findings and audit

Cases have no foreign key to `users`, so an ordinary account cascade cannot remove them. Every case opens as `uncertain_flag`. Linking ledger evidence never changes the finding. Only an explicit reviewer decision with a decision reference records `confirmed_policy_finding`, and a later `not_confirmed` decision appends a correction. The findings history is append-only. A case closes only after every hold is released, every disclosure is closed and every evidence capture has finished. Every attempt, read or write, is written to `safety_case_audit` in the same transaction as the outcome it states. Capacity limits fail closed: 10,000 cases, holds, preserved records or evidence objects; 1,000 roles; 1,000 evidence objects or links per case; 100 disclosures per case; and 100,000 audit rows.

### Holds and their scope

A hold needs a preservation approver, an opaque `legal_basis_ref` and a review term of 1–366 days. It stays in force until an explicit audited release. Past its review date it reports `overdue`, but it never lapses. There are three scopes:

- `account`: everything the subject owns.
- `project`: one project owned by the subject.
- `object`: one project photo. The hold also pins its project against deletion and owner transfer.

Every per-object deletion and expiry path is listed in `tools/safety-hold-inventory.mjs`. That script scans the source for `DELETE FROM`, R2 deletes and cascades and fails on any path that is unclassified or stale. At October 4, 2026 it lists **78 deletion sites**:

| Decision | Sites |
|---|---|
| Blocked by a hold trigger | 10 |
| Skipped by expiry | 3 |
| Preserved | 1 |
| Hold mechanism itself | 2 |
| Explicitly excluded, with rationale | 62 |

It also lists **10 other paths**, such as overwrites, cascades, restore, Time Travel and external copies. In summary:

- **Blocked** (`RAISE(ABORT,'safety_preservation_hold')`): account deletion and its cascade; project deletion; project owner change; photo removal (`project_files`); site version removal; app visitor deletion and owner visitor erasure; contact deletion; guest-preview feedback and links; and the R2 cleanup queue row.
- **Skipped by expiry:** contact expiry, traffic rollup expiry, and R2 photo cleanup. A photo removed shortly before an account or project hold stays queued and stored, because queue rows now carry the project and owner. The orphan sweep only lists `photos/` and treats queued keys as retained.
- **Preserved without visible difference:** profile-photo replacement or removal, and Chat draft discard or inactive expiry. The trigger copies the previous payload into restricted `safety_preserved_records`. Copies follow a covering hold and are deleted when no hold covers them.
- **Restore:** restore admission refuses (`preservation-hold`) while a hold, an open disclosure or an unfinished capture exists, and inventory evidence must include every stored evidence object with its exact size and digest.
- **Explicitly excluded, with rationale in the inventory:** authentication, session, queue and idempotency rows; content-free operational records; app document overwrite and recovery points (an owner question); D1 Time Travel and external copies (CMS, GitHub), which are outside this database's control; and browser-only drafts.

**Customer behaviour.** A hold is never disclosed. A blocked action fails with the existing generic error for that action. Expired rows that are retained stay outside the customer's read window. Preserved overwrites look exactly like ordinary success.

### Restricted evidence objects

`captureSafetyEvidence` is available to preservation approvers. It copies a held project photo, a held profile photo or a preserved record into private R2 under `restricted/safety-evidence/<case>/<id>`. The source facts are read server-side, never supplied by the operator. The capture is recorded before the copy, the copy is conditional (`onlyIf` absent) and carries a sha256, and an exact retry resumes after a lost R2 response. No ordinary path lists or deletes the `restricted/` prefix; R2 stays private, with no public route. `disposeSafetyEvidence` deletes an object only after the case is closed and no disclosure is open, and the disposal is audited.

### Lawful export and disclosure — design, manifest-only

Disclosure is a separate two-person operation:

1. A `case_reviewer` requests it with an opaque `legal_process_ref`, a `recipient_ref` and 1–100 stored evidence objects. The manifest sha256 is computed over the sorted items.
2. A **different** `disclosure_approver` approves that exact manifest. Approval requires every item to be stored, not disposed of and digest-matching.
3. A `disclosure_approver` records the out-of-band transfer's opaque `outcome_ref`. Either role can cancel before the transfer is recorded.

**Whumpo transmits nothing.** There is no export endpoint, provider, email or download of evidence bytes. The actual transfer procedure is an owner and counsel question. Manifests contain identifiers and digests only.

### Not implemented

- A review UI.
- A case-retention schedule.
- Capture of app documents and recovery points.
- Preservation of D1 Time Travel or external copies.
- The counsel-approved transfer procedure.
- Any scanner, hash matching, provider or NCMEC reporting work, which remains owner-deferred.

Legal applicability and the procedure require qualified review before live use (WH-133).

### Verification (local only)

All runs used synthetic placeholders on disposable databases. `node tests/safety-cases.mjs` passed with 84 checks on disposable SQLite and with `--d1` on local D1. `node tests/safety-case-operations.mjs` passed with 99 checks on SQLite with in-memory R2, and with `--d1` on local D1 and local R2. It covers the HTTP surface (declared, stale, revoked, foreign-origin and customer sessions refused), all three hold scopes over every blocked or expiring path, R2 retention, profile-photo preservation, evidence capture, resume and disposal, two-person disclosure, restore suppression, release, conflict-of-interest non-disclosure, and an audit with no raw markers. `tests/chat-interaction-storage.mjs` covers held Chat draft expiry.

## Operator safety review workflow

`tools/review-content-risk.mjs` provides `read`, `record` and `reverse` through private JSON input. This uses operator D1 credentials, not customer OAuth or a model credential. Preview/apply uses the same pattern as financial review tools, but content-safety decisions remain independent of economic Monitor mode. No customer notice, appeal UI, automatic intake, provider detector or restriction is activated by this command.

```sh
node tools/review-content-risk.mjs --input .secrets/content-risk-review.json
node tools/review-content-risk.mjs --input .secrets/content-risk-review.json --apply EXACT_PREVIEW_DIGEST
```

The input file must contain exactly the fields for its action:

- Read: `action: "read"`, `account` (UUID).
- Record: `action: "record"`, `account`, `id` (unique evidence receipt), `incident` (shared across receipts for one incident), `kind`, `occurredAt` (UTC Unix milliseconds), `evidenceRef`, `reviewerRef`, `reviewed: true`.
- Correct: `action: "reverse"`, `account`, `incident`, `evidenceRef` (the correction decision), `reviewerRef`, `reviewed: true`.

Kinds are `verified_benign`, `uncertain_flag`, `confirmed_violation`, `confirmed_evasion` and `critical_incident`. IDs/references are opaque identifiers containing only letters, digits, underscores, dots, colons and hyphens (1–128 characters). Do not put allegations, messages, imagery, source, names or credentials in the input. The independently reviewed case and the actual operator identity must be established outside this tool. The `reviewed` flag and digest are declarations/accidental-change protection, not authentication or proof that a finding is correct. A future restricted case system must enforce that linkage before automated intake is enabled.

Without `--apply`, mutations return the proposed input, current aggregate assessment and the digest without writing. The digest binds the canonical exact action and all its fields; it does not freeze a score or concurrent evidence. Read actions reject `--apply`. Reports contain the selected account, evidence-row count and aggregate assessment; they omit incident lists, evidence/reviewer references and private content. Case references appear only in the explicit proposed mutation preview. These are private operator reports, not customer/model context.

Apply uses the immutable ledger functions and then reads the current assessment. Identical retries do not create another finding/correction; changed receipt IDs are not a recovery strategy. After an unknown outcome, read or retry the same input and digest. If the final report read fails after a successful insert, the ledger remains committed and the same retry is safe. A correction applies to the entire owned incident permanently, including later duplicate receipts; it does not delete history, reopen a corrected case, release quarantined content or change customer access. Empty history remains incomplete and cannot lower screening requirements.

Verification: `node tests/content-risk-review.mjs` passed against all migrations in disposable SQLite. It covers strict schemas, malformed/oversized inputs, no-write previews, digest tampering, read-only reporting, duplicate/conflicting receipts, cross-account refusal, correction replay/conflict and reference-free aggregate reports. The real CLI was also exercised in read-only mode against the sole owner test account; no evidence or correction was added. Customer-history completeness and enforcement remained false. Evidence is stored locally in ignored `.secrets/content-risk-read-report.json`; no customer messages were accessed. No migration or Worker deployment was needed for this operator-only tool.

## AI message roles for saved data — September 30, 2026

Workspace names, opted-in profile text, project briefs, saved configuration and file metadata are now serialized as a separately labeled `workspace_context` **user-role** data message. The system messages contain only platform-owned rules/tool schemas, catalogue information and server-selected action constraints. Saved customer text is no longer interpolated into the system prompt. The existing focus filter still excludes irrelevant backend/photo/config context, and unshared profile data remains excluded before serialization.

Visitor-page design similarly separates the approved program source and project text into `application_design_context` user-role data. Only the server-validated target project ID is interpolated into the system action constraint. Original source, private receipt values and account history are not promoted into platform instructions. The existing inspection follow-up already uses a user-role result with a system reminder that it is untrusted.

Long system/data messages are chunked independently without changing their roles. Internal cost reservations include all message bytes after construction. The latest user request remains separate and last. The mandatory content policy is still prepended by the transport for both Chat Completions and Responses. Server-side ownership, quarantine, schema validation and human-confirmation gates remain authoritative: role separation reduces instruction confusion but is not a classifier, scan approval or proof of immunity to prompt injection.

Verification: `pnpm check`, `node tests/prompt-data-boundaries.mjs`, `SITE_AI=1 node tests/customer-site-journey.mjs` and `node tests/app-page-design.mjs` passed. Adversarial instruction markers in synthetic profile/project/source data are absent from system messages and preserved only as user data across both transports. The connected website fixture verifies the actual outgoing main-model payload and the private draft/edit/review/restore/unpublish flow at zero standard-AI customer units. The visitor-page test checks source role placement, owned approved programs, private-history/receipt exclusion, replay and separate publication approval. All provider responses in these suites are synthetic; no CMS functional suite was run.

A real Muse compatibility attempt remained **unverified**: the configured provider rejected the request, and a minimal greeting control also returned HTTP 400 at 18:15 UTC. This does not isolate a regression in the new data-message layout or prove live inference readiness. No provider setting, model, credential or fallback was changed; only synthetic content was submitted. Evidence: `.secrets/prompt-boundaries-muse-failure.json`. This was subsequently diagnosed as a missing session header in the standalone probe; the real Chat-path acceptance below supersedes that failure.

Deployed to private test as platform `e7cb7faf-dffa-4240-a795-fd234ed72af5`. The release passed backend TypeScript, a fresh build with the build-snapshot gate, and frontend asset-loading checks. Independent readback at 18:16:35 UTC confirmed the active version, all 16 frontend asset hashes, health 200 and anonymous onboarding/Chat 401. No migration was required. This verifies deployment, not the unresolved real-provider inference path. Evidence: `.secrets/prompt-boundaries-release-verification.json`.

## OpenCode Go session verification — September 30, 2026

The earlier standalone probe failed with the explicit provider error `MissingSessionID`: it omitted `x-opencode-session`. Whumpo's `sendAIChat` already sets a stable owner-workspace conversation identifier for both the main call and bounded follow-up, and the acknowledgment path sets its own stable identifier. The failed probe therefore did not reproduce the real Chat request. [OpenCode Go's client requirements](https://opencode.ai/docs/go/#where-can-i-use-it), checked September 30, require a stable conversation session header and a client-specific user agent.

The shared adapter now rejects a Go request lacking a session before network dispatch, using the safe `configuration / missing_session` classification. Explicit OpenCode session identifiers must be 1–128 characters containing only letters, digits, dots, underscores, colons or hyphens; invalid values return `invalid_session`. The adapter does not invent a new ID per retry. Existing Chat identifiers are unchanged. Provider-specific session headers are never forwarded to other hosts. Other OpenAI-compatible providers do not acquire a Go-specific session requirement, and no endpoint, model, credential or paid fallback was changed.

Verification: `pnpm check` and `node tests/ai.mjs` passed, including both API formats, missing/invalid session refusal before fetch, stable identifiers across repeated calls and no header forwarding to another provider. `RUN_LIVE_MUSE=1 node tests/app-page-design.mjs` passed through the actual `sendAIChat` path against Muse with disposable local D1 and synthetic project/program data. Exactly one real provider call produced the expected note-input page review, without publication or code execution, with zero customer units spent or reserved. The test also retained its ownership/revision/replay checks. No real customer messages, visitor documents or source were submitted. Evidence: `.secrets/prompt-boundaries-live-app-test.log`. This closes the specific new message-layout/provider compatibility question; it does not establish all-workload quality, physical-device acceptance or a full live customer journey.
