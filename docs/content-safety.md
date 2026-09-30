# Content safety and US customer eligibility

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

## Implemented and deployed to private test

- New non-local password registration requires the explicit boolean `usBased:true` before password hashing, invitation mutation or account creation.
- Both passkey signup options and verification require the same declaration before their respective work. Login, recovery and adding a passkey remain available.
- Registration presents an unchecked required US eligibility declaration. It passes the declaration to both passkey stages. Loopback local development remains exempt server-side, consistent with the existing test-only invitation exception.
- The shared AI transport prepends the versioned platform content policy to both supported inference protocols, covering orchestration and auxiliary model calls using this transport. Internal cost reservations include the added policy text. The future, inactive AI Gateway transport still needs its own policy integration before activation.

These are eligibility and agent-instruction foundations, **not comprehensive content enforcement**. Self-declaration does not verify residence. Existing accounts are not rechecked; a persisted policy-acceptance/eligibility record and existing-account rollout remain outstanding. No IP location is treated as legal residence. Instructions cannot certify an image or source tree as safe, and do not replace server-side action/publication gates. No new scanner or paid service was activated.

Verification: `pnpm check`, `node tests/content-policy.mjs`, `node tests/ai.mjs`, and `node tests/standard-ai-chat.mjs` passed. Both TypeScript projects, production build and frontend loading checks also passed in the isolated release checkout. Tests verify rejected password/passkey declarations cause no account database operations or session cookies, strict declaration types, and policy inclusion in both inference protocols. No actual prohibited imagery, customer content or external inference was used.

## Required import and upload contract — planned, release gate

Imported code must be scanned **in the background before management**, not after activation. The same principle applies to customer media and generated publication artifacts.

1. Accept bounded inputs into private quarantine. Record owner, immutable digest, format, source provenance and policy/scanner versions. Do not execute imported source, install dependencies, render active HTML, pass source to the general agent, or expose media while pending.
2. Process durable, idempotent jobs. Inspect archive expansion/path traversal/symlinks, binaries and dependencies; detect malware/secrets and prohibited functionality/content. Scan referenced assets separately. Repository URLs, filenames and README claims are untrusted. Do not follow arbitrary network links during scanning.
3. Require all checks relevant to that format. Unsupported formats, scanner failure, timeout, missing coverage and inconclusive verdicts remain quarantined. An empty result or an LLM's “safe” answer cannot approve anything.
4. Bind trusted scan receipts to exact bytes, owner and policy version. Client/model fields cannot mint approval. Edits, new assets, changed dependencies and policy invalidation require new scans. Existing immutable version/publication reviews still apply afterward.
5. Enforce approval in execution, management, preview/export, publication **and serving paths**, including direct APIs and alternative hosts. No grandfathering old unscanned assets as clean. Restrict cached copies and revoke affected publications on a later safety match.
6. Maintain restricted safety cases, evidence retention and customer-facing refusal/appeal state separately. Do not copy suspected CSAM into chat, model context, ordinary logs, GitHub, tests or general support queues. Safety handling must survive customer deletion and ordinary cleanup where legally required, with restricted access and explicit retention authority.

Initial implementation inventory must include profile photos, project photos, CMS uploads/imports, WordPress references, imported/generated backend source, generated pages, visitor inputs and private/public serving paths. General GitHub source import is not made available simply because the backup integration exists. CMS feature acceptance stays paused; safety gates are a separate requirement. Static scanning cannot prove arbitrary code's future behavior; runtime isolation, restricted networking, publication review and subsequent abuse response remain necessary.

## CSAM detection delivery path and limitations

As checked September 30, 2026, Cloudflare's [CSAM Scanning Tool](https://developers.cloudflare.com/cache/reference/csam-scanning/) compares images passing through Cloudflare cache against known CSAM lists. It requires a notification email; notifications describe detections and whether blocking succeeded. It is a useful additional public-delivery layer, **not a private R2 upload scanning API or a guarantee of detection before the first delivery**. Do not publish quarantine objects to make this tool scan them. Verify zone entitlement, service terms, charges and compatibility with each Worker delivery path before activation; none is claimed configured here.

Private intake needs a vetted pre-publication service/partnership for known-CSAM matching plus separate sexual-content detection. Known-hash matching alone does not identify every new image; an adult-content classifier is not verified CSAM detection. Coverage for images, video, transformed copies and unsupported formats must be explicit. Provider selection, access, data processing terms and pricing require verification. Do not let the building agent inspect suspected CSAM or make final reporting decisions.

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

Verification for this slice: `pnpm check`, `node tests/backend-imports.mjs`, and `node tests/customer-app-journey.mjs` passed. Disposable D1 tests cover authenticated HTTP 202/replay, private metadata-only inventory, denied execution, tenant isolation, immutable source, terminal triage states, bounded scanning and quotas. The application journey exercises actual isolated QuickJS, visitor passkeys/data/recovery and the shared task-list using an explicitly seeded trusted synthetic backend; it does not bypass quarantine for a customer import. The isolated release passed TypeScript and frontend asset-loading checks, reusing unchanged frontend assets. Legacy standalone HTTP fixture scripts (`backend-http`, `backend-form-http`, `app-activation-http`, `backend-diff-http`) still assume direct uploads create executable versions and require fixture migration before reuse; they were not run or counted as current acceptance.

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

September 30, 2026: `src/content-risk.ts` implements an internal risk calculation and proposed supplemental scanning schedule. **It is not connected to a durable event ledger, moderation provider, sampling dispatcher or customer restrictions yet.** Existing upload/import quarantine remains unchanged. Neither a low score nor the output of this helper is an approval receipt.

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

The ledger stores a canonical result fingerprint and the photo safety row references its ticket. It does not retain full provider responses, raw imagery or separate retrievable provider case references. It is bounded at 100 tickets per account and 5,000 platform-wide, with one reserved attempt per kind/subject/digest/policy. Migration 0102 preserves all old attempts and allows new attempts after terminal or expired reservations. Reservation atomically retires expired attempts and resets expired approvals to pending with unknown checks; live approvals and blocked results cannot be reset. Inconclusive results can retry, but neither retries nor rescans extend an old approval. Older tokens cannot complete a newer attempt. Durable dispatch, retry backoff/attempt limits, quota housekeeping and provider-reference reconciliation still need implementation before enabling a dispatcher. The ledger currently follows account deletion; it is **not a legal preservation store**. Restricted case handling, preservation/reporting, provider onboarding and authentication, verified coverage and costs remain activation prerequisites. No real suspected-illegal material was used or sent to a provider.

Local verification: `pnpm check` and `node tests/photo-scan-results.mjs`. The disposable D1/R2 test uses generated solid-color JPEGs and synthetic evidence to verify authority hashing, ownership/digest/policy binding, strict check coverage, pending/blocked/approved delivery, replay/conflict/concurrency, lost batch acknowledgement, changed targets, expired reservations and immutable terminal records. These tests establish result-handling behavior, not detector accuracy or live provider acceptance.

Retry verification: `node tests/photo-scan-results.mjs` also covers profile/project expired-clearance rescans, inconclusive retries, expired-ticket supersession, blocked/live-clearance refusal, competing reservations and lost reservation acknowledgements. `python3 tests/photo-scan-migration.py` verifies migration 0102 preserves reserved/completed/stale rows, foreign keys and terminal immutability while replacing the lifetime uniqueness constraint with one reserved attempt. Synthetic evidence only.

## Supplemental screening selection — source implementation, inactive

September 30, 2026: `src/content-screening.ts` connects the risk calculation to a deterministic internal sampling decision. It has no live caller or configured key and does not grant publication, execution or serving permission. `required:false` means only that this particular supplemental check was not sampled; all baseline protections remain mandatory.

A dedicated server-held 256-bit random HMAC key selects a sample from the owner, format, policy version and exact content/context digest. Request IDs and wall-clock time are excluded, so resubmitting identical work under a new request ID cannot reroll it. The integration must hash the exact normalized content **and all action-relevant context**, including relevant conversation and tool/action scope; hashing the newest message alone is insufficient. New content needs a new decision. The sampler uses a fixed threshold with the risk-selected percentage, so increasing scrutiny cannot unselect the same sample. Media/imports always require checks; missing/incomplete history or a current content flag requires full supplemental screening. A missing/malformed key or cryptographic failure also requires screening.

Keep the key, scores and sampling decisions internal; do not expose a sampling oracle to customers or the building agent. Use a dedicated key rather than an authentication, encryption or provider credential. No key was provisioned by this change. Before live use, persist selected checks against immutable owned actions/artifacts and make them sticky: later risk decay, key rotation or policy changes must not cancel an outstanding selected check. Dispatcher integration, trusted risk history, rate limiting against content mutation attempts, calibration and scanner availability remain outstanding. The helper is not an enforcement layer or provider integration.

Verification: `node tests/content-screening.mjs` checks stable retries, independent Node/Web Crypto HMAC agreement, scrutiny escalation, tenant/format validation, missing-key and crypto-failure behavior, and mandatory media/import checks. `pnpm check` verifies both TypeScript projects. No migration, deployment, provider call or customer-content processing occurs in these tests.
