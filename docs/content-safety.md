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
