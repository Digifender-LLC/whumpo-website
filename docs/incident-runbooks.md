# Incident, spend and provider-outage runbooks

**WH-007 — written October 4, 2026 against source `1343111`.** Status: **documentation, desk-checked against current source and docs; not live-drilled.** The [desk-check record](incident-tabletop.md) lists what was traced and what was not. Nothing here was run against the deployed test environment, no provider was called, and no external message was sent. Read it with [maintenance diagnostics](maintenance.md), the [release protocol](releases.md), [standard AI accounting](standard-ai-accounting.md), the [security decision register](security-risk-actions.md) and the [workspace identity contract](workspace-identity.md). The current environment is the private `test` environment with a sole tester; every severity, role and communication below is written so it still holds when a real cohort exists, but it must be re-read before one does.

Rules for using this document:

- **Only controls that exist are described as available.** Section 2 lists them, and Section 3 lists the controls this runbook needs that do **not** exist. A gap is an open work item with an owner (see [the roadmap tasks it names](roadmap/README.md)), not a step to improvise.
- **Contain by stopping new risky work, never by erasing state.** Do not delete rows, receipts, holds, keys or archives to "clean up" during an incident. [Execution rules](roadmap/execution.md#preserve-the-invariants): retries recover existing receipts, and unknown external outcomes keep their holds and authority.
- **No credentials or customer content in incident artifacts, chat, GitHub, ordinary logs or model context.** Section 5 defines the incident record and a mechanical check.
- This is not legal advice. Reporting and preservation duties for suspected CSAM need qualified US legal review that has not been done ([content safety](content-safety.md#us-operational-prerequisites--not-yet-configured)).

## 1. Ownership, severity and escalation

### Roles

| Role | Who today | Notes |
| --- | --- | --- |
| Incident owner | The platform owner (the sole operator and sole tester). | Declares severity, authorizes any control in Section 2, and is the only person who may authorize new spend or a new service (Section 4). |
| Operator | The same person, using the local checkout, Wrangler login and private `.secrets/` files. | No second operator, deputy or on-call rotation is documented. This is gap G1. |
| Scribe | The operator, writing the Section 5 record as they go. | |
| Customer communicator | The owner. | Cloudflare Email Service is selected for content-free contact notices but not activated, and no platform email for incidents exists ([WH-036](contact-forms.md#owner-notification-delivery-wh-036)); an in-app support page and saved responses exist ([Section 15](#15-support-hours-escalation-and-customer-communication)); the drafts in Section 14 are unsent templates. |
| Legal/safety | Not established. | Required before a real cohort: restricted incident handling, NCMEC provider-reporting access and counsel ([content safety](content-safety.md)). Owner-deferred scanner work does not remove this. |

### Severity

| Level | Meaning in this platform | Target first action | Examples |
| --- | --- | --- | --- |
| **SEV1** | Active or probable harm: credential or key exposure, cross-tenant or cross-authority access, account takeover in progress, suspected illegal content, uncontrolled spend, or loss of an encryption key needed for live credentials. | Contain immediately (minutes); owner decides next steps the same day. | Leaked `AI_API_KEY`; stolen recovery kit used; wrong-owner data served; suspected CSAM; spend rising with no stop. |
| **SEV2** | Core path down or data at risk, no active harm. | Contain or work around within hours. | Platform Worker/D1 down; all Chat unavailable; failed release leaving mixed Workers; unresolved uncertain provider outcomes growing. |
| **SEV3** | Degraded or single optional capability affected; customers can still build, publish and recover. | Same working day. | AI provider outage (deterministic Dashboard controls still work); Stripe sandbox webhook failing; one daily maintenance job overdue. |
| **SEV4** | Observation or near miss; no customer effect. | Review at the next routine check. | A queue in `attention`; a fair-use observation; one rate-limit burst. |

Raise a level when impact is unknown and the incident touches credentials, keys, identity, content safety or money; lower it only with recorded evidence. A "no customer effect" claim requires the Section 6 reconciliation, not an absence of reports.

### Escalation

| Condition | Escalate to | Status |
| --- | --- | --- |
| Any SEV1 or SEV2 | Platform owner (immediately) | Exists. |
| Cloudflare service failure or billing question | Cloudflare support/status; the plan's support entitlement is unverified, so confirm it before depending on it. [Cloudflare Notifications](https://developers.cloudflare.com/notifications/) availability for this plan also requires verification. | **Unverified.** |
| Model provider outage or key compromise | OpenCode Go account/provider contact for the Muse testing route | Contact path not recorded in the repository; record it privately. |
| Stripe sandbox problem | Stripe dashboard (sandbox) | Sandbox only; real money is gated. |
| GitHub App or OAuth problem | GitHub App settings for the Whumpo App | Exists in provider UI. |
| Suspected CSAM or other illegal content | Counsel and the restricted-handling process | **Not established.** See Section 10; do not improvise. |
| Customer notice or legal exposure | Owner plus counsel before sending | Counsel not engaged. |

## 2. Controls that exist today

Every control below was checked against source or an official document. "Exercised" means a deployed rehearsal; none were rehearsed live for this task, so every row is **desk-checked only**. Re-check any command against the linked page before use, because Cloudflare tooling changes.

| ID | Control | How to invoke | What it stops | What it preserves | Evidence |
| --- | --- | --- | --- | --- | --- |
| C1 | **Stop AI inference platform-wide** by removing the platform Worker's `AI_API_KEY` secret. | `wrangler secret delete AI_API_KEY --config wrangler.jsonc` ([Wrangler secret commands](https://developers.cloudflare.com/workers/wrangler/commands/workers/#secret), [secrets](https://developers.cloudflare.com/workers/configuration/secrets/)). Verify afterward that the platform Worker's active secret names no longer include it. | `configuredAI()` returns undefined, so Chat sends return 503 "assistant is temporarily unavailable. Your saved work and Dashboard controls are still available" and drafting/page-design report AI not connected. | All D1 receipts. A pending turn that already has a saved result still completes without calling the provider; expired undispatched work releases; a dispatched request with no saved answer is marked `uncertain` (after a two-minute window, when the owner next reads Chat, because reconciliation is request driven) and is never redispatched ([`reconcileStandardChat`](../src/standard-ai-recovery.ts)). | `src/ai-chat.ts`, `src/chat.ts`, `tests/standard-ai-recovery.mjs` |
| C2 | **Internal inference budget** per account per month. | Automatic. Admission rejects when the reserved budget is exhausted: "AI is temporarily unavailable while the platform's testing capacity is reviewed." | New AI turns for that account. | Existing receipts and saved work. | `src/ai-chat.ts`, `src/model-costs.ts`, [pricing](pricing-and-model-policy.md#cost-accounting-and-budgets) |
| C3 | **Per-call reservation bounds.** | Automatic: 4,096 output tokens per call, at most one lookup/follow-up, both reserved before dispatch. | Single-request cost growth. | Receipts. | [standard AI accounting](standard-ai-accounting.md#current-muse-response-allowance--october-3-2026-utc) |
| C4 | **Request rate limits** on the platform and the visitor service. | Automatic via `AUTH_LIMITER` 10 requests/60 s and `API_LIMITER` 120 requests/60 s per key in `wrangler.jsonc`; the apps Worker has its own pair. Changing a limit is a reviewed release. | Bursts of sign-in, API, contact and visitor traffic. See [Workers rate limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/) for exact semantics; these are abuse brakes, not a spend cap. | Everything. | `wrangler.jsonc`, `src/index.ts`, `src/app-gateway.ts` |
| C5 | **Platform R2 operation ceiling.** | Automatic: 100,000 reads and 10,000 writes per UTC month, then 503 "monthly photo allowance has been reached." Public photo reads (site and CMS images) also charge a per-project budget of 10,000/month (503 "This site's monthly photo allowance"), an account fair share past 50,000 platform reads, and 400/day per connection per project (429), so one tenant or client no longer exhausts every tenant's photos (WH-075, local evidence only). | Further photo reads/writes via `reserveStorage`/`reservePublicPhotoRead`. | Stored objects. | `src/storage-budget.ts`, `src/public-admission.ts` |
| C6 | **Stop new signups and public contact intake** by removing `TURNSTILE_SECRET` from **both** Workers that hold it. | `wrangler secret delete TURNSTILE_SECRET --config wrangler.jsonc` (whumpo-platform) **and** `wrangler secret delete TURNSTILE_SECRET --config wrangler.apps.jsonc` (whumpo-apps). Removing only the platform copy leaves anonymous module forms on `app-PROJECT.whumpo.site` accepting submissions. Verify afterward that neither Worker's secret names include it. | Platform: signup preparation (`turnstile()` fails closed) and every customer contact form (`503 Contact forms are temporarily unavailable`). Apps: every anonymous `public` module form submission (`409 unavailable`, "Public form submissions are temporarily unavailable."); signed-in visitor and staff module writes are not Turnstile-gated and continue (the owner can disable the module, C10). | Existing accounts, passkey sign-in, invitations (unused ones stay unused), stored messages and module records. | `src/workspace-identity/ceremonies.ts`, `src/contact-page.ts`, `src/app-gateway.ts`, `src/turnstile.ts`, [custody inventory](../tools/secret-custody.mjs) |
| C7 | **Stop issuing invitations.** | Simply do not run `pnpm invite`. | New accounts when combined with C6. | Existing invitations remain valid until their seven-day expiry; there is no revoke tool (gap G4). | `tools/create-invite.mjs` |
| C8 | **Disable sandbox billing** by removing `STRIPE_WEBHOOK_SECRET` or `STRIPE_TEST_KEY`. | `wrangler secret delete …`. The sandbox pair is only accepted as `sk_test_`/`whsec_` values; no live key is accepted. | New sandbox Checkout and webhook signature verification. | Stored invoice-interval coverage; a missed event is reconciled later from saved checkout/customer identities by authenticated Refresh. | `src/stripe-common.ts`, [stripe sandbox](stripe-sandbox.md) |
| C9 | **Stop customer OAuth connection starts** by removing the provider client secret. | Per provider; see caution below. | New GitHub/Cloudflare authorization. | Local disconnect still removes use authority immediately; encrypted revocation obligations are retained. | `tools/report-connections.mjs`, [connection lifecycle](connection-key-lifecycle.md) |
| C10 | **Owner-reviewed customer controls**: unpublish a site, disable the application (deletes visitor sessions), disable a contact form, revoke a visitor, remove a passkey, replace the recovery kit, disconnect GitHub/Cloudflare. | In the owner's Chat/workspace; each needs the existing review and a current session. Revoking a visitor, removing a passkey and replacing the recovery kit also need a passkey sign-in within the last 10 minutes. Unpublishing a site, disabling the application or a contact form and disconnecting GitHub/Cloudflare do not (owner decision, October 8, 2026: protective actions stay low-friction; see [boundary audit B2](boundary-audit.md)); disconnects have no rate limit. | The specific customer capability. | Saved versions, documents and history. | [app data](app-data.md), [contact forms](contact-forms.md), [identity](workspace-identity.md) |
| C11 | **Identity epoch revocation.** Removing a credential (including the last one), securing recovery, or replacing a kit advances the account authority epoch and revokes old sessions, grants and challenges; admitted requests fail a later unauthorized commit. | Owner-driven (C10). **No operator tool**; see G3. | Compromised passkeys and all earlier browser sessions, without waiting for a two-key count. | Account identity and content. | `docs/workspace-identity.md`, `tests/identity-recovery.mjs` |
| C12 | **Read-only detection reports.** | `node tools/report-maintenance.mjs` (exit 2 means attention), `node tools/report-connections.mjs` (exit 2 means missing secret name or recovery required), `node tools/report-gateway.mjs`, `pnpm report:fair-use`, `node tools/report-task-costs.mjs FROM TO [--account UUID]`, `pnpm run deploy status RELEASE_ID`. All use the existing Wrangler/Cloudflare operator authorization and SELECT only. | Nothing; they observe. | Everything. | [maintenance](maintenance.md), [releases](releases.md) |
| C13 | **Release recovery protocol.** | `pnpm run deploy status/prepare/apply`, a journaled forward repair, and a distinct empty database for a schema reset. No numbered migration replay. | Repeating an uncertain command. | The sealed archive and journal. | [releases](releases.md) |
| C14 | **Reviewed operator records**: fair-use review, usage-review response, content-risk evidence, domain-hosting reconciliation. | Preview then `--apply DIGEST`. | Nothing is enforced; they record. | The records are immutable. | [fair-use reviews](fair-use-reviews.md), [content safety](content-safety.md), `tools/reconcile-domain-hosting.mjs` |
| C15 | **Operator containment of one account or project** (WH-050 F7, partial G3; serving stop, session revocation and retention per owner decisions of October 8, 2026). **Implemented locally only** (local SQLite/D1 tests); not configured against the test environment, not rehearsed, not accepted; needs the owner-authorized empty-D1 cutover. | `node tools/operator-containment.mjs --input PRIVATE.json` to preview, then `--apply DIGEST`. Actions `status`, `contain` (freeze, or a temporary per-project allowance, per scope; expiry at most 30 days), `stop-serving` (one project, its own action, expiry at most 30 days), `revoke-sessions` (one account), `lift` (while active), `close` (after expiry) and `cleanup` (resolved records at least 90 days old). Each needs an operator reference; all but cleanup a private reason. Reviews of `stop-serving`, `revoke-sessions` and `cleanup` bind the exact current state. | Containment: new public backend calls, visitor transitions, contact submissions and/or public photo reads, or owner build jobs (freeze only; cancels running and unpublished ones, [build jobs](build-jobs.md#envelope-invariants)). Serving stop: every public site page, photo, CMS article/image, directory page, custom domain, guest preview, contact form, public backend call and visitor application configuration/module/signup/execution of that project (the visitor page stays as an account-only view). Revocation: every current workspace session of that account (ordinary signed-out response). Customers see only existing generic responses. | Publications, reviewed versions, all customer and visitor data, owner workspace, standard owner AI, passkeys, recovery kit, identity epoch, in-progress recovery and safety holds. Existing visitors keep their own sign-in, recovery, passkey replacement, saved data, last-request receipt, export and deletion in the same visitor page during a stop. Records are deleted only by reviewed cleanup 90 days after resolution, never while unresolved or held. | [capacity and fairness](capacity-and-fairness.md#wh-050-owner-decisions-retention-serving-stop-and-session-revocation--october-8-2026-utc), `tests/operator-containment.mjs`, `tests/operator-session-revocation.mjs`, `tests/operator-serving-browser.mjs` |
| C16 | **Platform counter thresholds and health probe** (WH-050 F8 / G1 and G11 slices, pull-based). **Implemented locally only.** | `node tools/report-maintenance.mjs --counters` (exit 2 at 80% of any shared ceiling or on an unreadable counter; 50% is reported as `warn`). `node tools/probe-health.mjs https://ORIGIN` (one read-only `GET /api/health`; exit 2 on failure). | Nothing; they observe. Nothing is scheduled or delivered. | Everything. | [capacity and fairness](capacity-and-fairness.md#f8-shared-counter-thresholds-implemented-locally-pull-based), `tests/maintenance-inventory.mjs`, `tests/probe-health.mjs` |

**Cautions that apply to the secret-removal controls (C1, C6, C8, C9):**

- They are out-of-band provider commands. The [release lease](releases.md#private-archive-and-journal) covers cooperating tools, not these. Record the time and the exact secret **name** in the incident record.
- A release archive prepared **before** the change records the old secret-name inventory and `apply` refuses a Worker that "lost a required secret binding" (`tools/release-manifest.mjs`). After a containment change, discard unapplied archives and `prepare` a new one against the actual state.
- Cleanup routines run "when configured." Removing `GITHUB_CLIENT_SECRET` or `CLOUDFLARE_CLIENT_SECRET` can stop revocation retries for tokens still valid at the provider. Prefer revoking at the provider (Section 8) over removing the client secret unless connection starts must stop immediately.
- Restoring a secret requires the **provider-reissued** value from private custody. Never paste it into Chat, a ticket or a shell history line; set it by prompt or private file, and verify only that the name is present.

## 3. Gap register: controls this runbook needs that do not exist

These are not available steps. Each has an owning roadmap item; the incident owner should treat the manual workaround, where one is named, as an unreviewed operator action and record it.

| ID | Gap | Consequence today | Interim, with limits | Owner / roadmap |
| --- | --- | --- | --- | --- |
| G1 | No paging, alert delivery, on-call or second operator. Reports are pull-based; [monitoring/alert delivery is not installed](maintenance.md#acceptance-and-wh-006-completion). **Partly addressed locally:** C16 flags each shared platform counter at 50%/80% of its ceiling, but still only when someone runs it. | A SEV event is noticed only when someone runs a report or a user reports it. | Run C12 and C16 on a fixed cadence while a cohort is active; record the cadence. | Platform owner; follow-on to WH-006/WH-007. **Alert delivery stays owner-gated:** installation needs separate authorization, with price/entitlement review if any paid or external service is involved. |
| G2 | No account-wide spend cap or verified Cloudflare usage notification. Per-IP/project limits are not a spend cap ([decision 4](security-risk-actions.md#decisions-needed-from-the-owner), [scale gate](security-risk-actions.md#fix-or-verify-before-wider-use)). Workers Paid is usage-based; check [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) before relying on allowances (last read October 2, 2026 in [protection candidate](protection-candidate.md#measured-overhead-and-limits)). | Distributed abuse could accrue Cloudflare charges unseen. | Check Cloudflare billing/usage manually; verify whether a usage notification exists for this plan; do not enable a paid WAF/rate-limiting product without Section 4 approval. | Platform owner; WH-023 (finance), WH-048 beta gate. |
| G3 | **Partly addressed locally (C15):** an operator can freeze or temporarily re-allowance one account's or project's public backend calls, visitor transitions, contact submissions and public photo reads, freeze pooled owner build jobs, stop one project's public serving (site, photos, CMS, directory, custom domains, guest previews, contact form, public backend and visitor application) without unpublishing, and revoke one account's workspace sessions without touching passkeys, recovery or the identity epoch (owner decisions October 8, 2026). **Still missing:** revocation of individual visitor sessions, customer notices for an operator action (open owner question) and any deployed configuration or rehearsal. Owner-reviewed controls (C10/C11) cover the rest. Restricted case handling is planned ([WH-015](roadmap/backlog.md), [WH-016](roadmap/backlog.md)). | Once C15 is deployed through the schema cutover, an abusive tenant's public traffic, public serving and workspace sessions can be contained per tenant; individual visitor sessions cannot. | C15 for public allowances, serving and workspace sessions; otherwise platform-wide levers C1/C6/C8 only. Direct D1 SQL or removing the whole `*.whumpo.site/*` route in the Cloudflare dashboard are **unreviewed, all-tenant actions with no repository tooling or rehearsal**; use only on the owner's explicit decision and record them. | WH-015, WH-016, WH-017, WH-035. |
| G4 | No invitation revocation tool. | An issued, unused invitation stays usable for up to seven days. | C6 blocks signup preparation platform-wide. | Identity owner (WH-114/115 follow-up). |
| G5 | No owner notification when recovery starts, is secured, or a passkey is added or removed, and no platform email sender. | An owner may not learn that their kit was used. | None. Educate owners to replace the kit after any suspected exposure. | WH-063 (verified email changes, compromised-account recovery) and WH-036 (delivery). |
| G6 | A stolen recovery kit plus the account email is a bearer path into restricted recovery. As the contract is written, an attacker can run "all lost", secure the account, enroll two passkeys of their own and receive an ordinary session (derived from the specified flow; not exercised against the deployed system). The kit alone does not mint a session. Support and email cannot restore access afterward. | After a completed attacker recovery the owner cannot regain the account by any current path. | Section 9. The only pre-takeover containment is the owner replacing the kit from a recent passkey session. | WH-063, WH-005 (device acceptance), WH-118 (separate encryption feasibility). |
| G7 | No platform-wide read-only or maintenance mode and no general feature-flag system. | There is no "stop all writes" switch. | C1/C6/C8 are narrow; a Worker rollback is out-of-band and unrehearsed (Section 11). | WH-059 (release rollback rehearsal). |
| G8 | Native sessions do not exist yet. Android is planned ([Android contract](android-app.md)); only browser sessions exist. | "Browser/native containment" is browser-only today. | When native lands, it must reuse the same authority epoch so C11 covers it; verify that in WH-083/087 acceptance. | WH-081, WH-083, WH-087. |
| G9 | Application-encryption key backup custody is on one computer; off-device or independently operated custody is unaccepted ([protection candidate](protection-candidate.md#remaining-acceptance)). Retirement is never admitted. | Loss of that computer plus the Worker secret could make live credential ciphertext unreadable. | Section 8. | WH-117D (#86), WH-008. |
| G10 | Whole-platform restore (D1, R2, app data, keys) has not been proven ([WH-008](roadmap/backlog.md), [WH-019](roadmap/backlog.md), [WH-059](roadmap/backlog.md)). | Section 12 is a decision outline; a synthetic isolated local drill exists ([disaster recovery](disaster-recovery.md)), not a cloud restore. | None. | WH-008/019/059. |
| G11 | No hosted CI alert or provider-outage detector in the repository. **Partly addressed locally:** a manual synthetic probe of the platform health endpoint exists (C16, `tools/probe-health.mjs`); it is unscheduled, checks Worker liveness only and was not run against a deployed URL. | Provider outages are detected by symptoms (503s, uncertain counts) or a manual probe. | Section 7 symptoms; run the probe by hand. | WH-007 follow-up; scheduling or delivery is owner-gated (G1). |
| G12 | CSAM detection, NCMEC reporting access, restricted evidence storage and legal preservation process are not implemented (owner-deferred scanner; WH-011/015/016/017). Account-scope preservation holds that block ordinary deletion exist in source only, have only local test evidence and have no operator tooling ([WH-015](content-safety.md#restricted-safety-cases-and-preservation-holds--source-foundation-local-only)). | A suspected-illegal-content incident has no tested path. | Section 10 stops, preserves nothing in ordinary systems, and escalates. | Owner decision to resume; counsel. |

## 4. Two separations that must not blur

### 4.1 Platform emergency controls versus financial fair-use Monitor

| | Platform emergency controls (this document) | Financial fair-use Monitor |
| --- | --- | --- |
| Purpose | Stop new risky work during an outage, compromise, abuse or runaway cost. | Observe usage and economics to inform a later, separate enforcement decision. |
| Authority | Incident owner, platform-wide, via Section 2. | Operator mode in the database; defaults to `monitor` and cannot self-switch to enforce. |
| Effect on customers | May interrupt AI, signup or intake for everyone, with a clear service-capacity message. | Never warns, throttles or blocks. `enforcementEnabled` is false and `activeRestrictions` is empty in every mode. |
| Basis | Security, availability, provider failure, an uncontrolled spend signal. | Cost and volume only ever open a contextual review; they do not establish misuse. |
| Records | The Section 5 incident record. | Fair-use reviews, which are historical findings, never authority to deny service. |

Rules that follow ([pricing policy](pricing-and-model-policy.md#monitor-mode-and-company-profitability), [fair-use reviews](fair-use-reviews.md)):

- Do not use a fair-use review, `fairUseMode` or the Monitor-to-Enforce path as incident containment, and do not frame an emergency control as a customer penalty.
- A cost spike attributed to one account is first an economic and routing-efficiency question. Never shut down live sites, block export or hold source hostage because an AI cost threshold was reached.
- Monitor never disables content safety, and an emergency control never weakens it.
- Security, fraud, credential protection and explicitly approved premium-spend caps are separate from Monitor and stay in force during an incident.

### 4.2 Existing paid-resource authorization versus new service approval

| | Existing authorization | New service or spend approval |
| --- | --- | --- |
| What it covers | Standard AI under fair use with zero customer credit debits; the owner-authorized Workers Paid resources already in use (README); invoice-interval plan coverage from the Stripe **sandbox**; the internal inference budget. | Anything not already authorized: a paid Cloudflare feature or plan change, WAF or rate-limiting products, a new or additional AI provider or route, scanner or moderation enrollment, higher internal budgets, premium credits, any purchase, any customer DNS change or customer-code deployment, activating real-money Stripe. |
| During an incident | Containment may stop or slow use of what is already authorized. | **Urgency does not grant approval.** [AGENTS.md](../AGENTS.md#working-rules) requires explicit authorization and a concrete review step. The owner may approve in the incident, but record the exact service, cost, recurring minimum and exit, and use a distinct review. |
| Not allowed | Redispatching or "settling" an uncertain request to make numbers tidy. | Silently raising budgets, enabling an Enforce mode, routing to a paid fallback, or enabling a provider because the primary is down. There is no automatic paid fallback. |

## 5. Incident record and evidence handling

Create one private record per incident outside every repository checkout (the `.secrets/` directory is ignored by Git but is **not** a backup; see [operator private files](connection-key-lifecycle.md#encrypted-operator-key-backup)). Never commit it.

**Allowed content:** incident ID; UTC timestamps; severity and changes; coarse symptoms; component names; **names** of controls and secrets touched; operation, receipt, release and review UUIDs; report outputs from C12 (they are designed to omit tokens, source, media and conversation text); decisions with the decider; counts; sanitized references to private evidence by file name and SHA-256.

**Prohibited content:** secret or token values, recovery kits or codes, passkey material, session cookies, customer prompts, source, media, email addresses, raw provider responses or logs, and anything that may be illegal material. If sensitive material is accidentally captured, stop, do not paste it elsewhere, and remove it from the record using private operator storage; if it could be suspected CSAM, follow Section 10 first.

**Mechanical check before saving or attaching any artifact** (patterns for Stripe, GitHub, Bearer and PEM material; extend as providers change):

```sh
grep -nE 'sk_(test|live)_|rk_(test|live)_|whsec_|gh[pousr]_[A-Za-z0-9]|github_pat_|-----BEGIN|[Bb]earer [A-Za-z0-9._-]{20,}|[0-9a-f]{64}' INCIDENT_FILE
```

Any match must be reviewed and removed. A 64-hex match may be a legitimate digest; confirm it is one. This check cannot find customer prose or media, so the allowed-content rule still governs.

## 6. Common procedure

1. **Detect and declare.** Note the UTC time, source and a severity. Start the record.
2. **Preserve first, then contain.** Capture the C12 report outputs relevant to the incident (they are read-only) and `pnpm run deploy status RELEASE_ID` for the current release. Then apply the narrowest control from Section 2.
3. **Do not retry unknown outcomes.** A lost or ambiguous provider response keeps its hold. Read the exact receipt first (Section 7.4).
4. **Reconcile.** Account for every in-flight operation: AI requests (`standard_ai_requests`, `inference_calls`), gateway holds (`report-gateway`), GitHub backups, DNS actions, hosting reviews, OAuth exchanges, Stripe checkout intents and releases. The maintenance report lists up to 100 oldest unresolved IDs per family with a link to the recovery contract.
5. **Recover** only after the cause is understood and the reconciliation list is clear or explicitly accepted. Reverse a containment control by restoring its secret from private custody, then verify with a read-only check.
6. **Close with a review** (Section 15) and update the feature contract or gap register.

## 7. Detection, cost spikes and provider outages

### 7.1 Detection checklist

Run on a cadence set by the owner while any real user is active; the platform does not push alerts (G1).

| Signal | Command or place | Meaning |
| --- | --- | --- |
| Scheduled jobs and backlogs | `node tools/report-maintenance.mjs`; exit 2 means unobserved, overdue, failed, stalled or unavailable work, or a shared counter at 80% | The allowlisted scheduled jobs, 36 backlog queues, four receipt families and the shared counters; `unobserved`/`unavailable` is not healthy. |
| Shared platform counters | `node tools/report-maintenance.mjs --counters` (C16) | Each shared ceiling (public backend, visitor transitions, contact receipts, R2 reads/writes, visitor rows, owner test runs, photo files, containment rows): `warn` at 50%, `act` at 80%. Totals only; use C15 `status` for one subject. |
| Platform Worker liveness | `node tools/probe-health.mjs https://ORIGIN` (C16) | `GET /api/health` only; a pass says nothing about D1, R2, AI or customer sites. |
| Connection readiness | `node tools/report-connections.mjs` | Missing configured secret **names** or recovery required; presence is not credential validation. |
| Gateway holds | `node tools/report-gateway.mjs` | Header IDs are evidence, not proof of usage or no charge. |
| Cost attribution | `node tools/report-task-costs.mjs FROM_ISO TO_EXCLUSIVE_ISO [--account UUID]` (maximum 93 days); `pnpm report:fair-use` | Internal shadow estimates only, not provider invoices. |
| Release identity | `pnpm run deploy status RELEASE_ID` | Versions, bindings, schema and secret-binding **names** against the archive. |
| Cloudflare spend and errors | Cloudflare dashboard (manual); Workers logs are enabled at a 10% head sampling rate in `wrangler.jsonc` ([Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/)) | The only spend and error-rate view; no repository tooling reads provider billing. |

### 7.2 Runaway AI inference cost (SEV2, SEV1 if uncontrolled)

- **Detect.** Rising AI 503s with the capacity message; `report:fair-use` and `report-task-costs` showing a jump; the provider's own usage page; a leaked-key suspicion (then use Section 8).
- **Contain.** If the rise is not clearly one legitimate workload, apply **C1**. C2/C3 already bound a single account and call; they are not a platform cap and the Muse figures are shadow estimates, not an invoice. Do not change budgets upward.
- **Reconcile.** Run the maintenance report and `report-gateway`. Each dispatched standard AI request that never produced a result remains `uncertain` with its cost hold; do not release or redispatch it from a report alone. Failed validation can still have consumed provider resources, so keep the recorded internal cost.
- **Recover.** Decide cause: legitimate load (leave Monitor unchanged and manage capacity), abusive load (a safety/security matter, Section 10 or G3), or credential leak (Section 8). Restore `AI_API_KEY` only after the cause is addressed. Verify with one owner-controlled benign request after the secret is back, not a synthetic burst.
- **Evidence.** Report outputs, the time `AI_API_KEY` was removed and restored, the reconciliation list, and the cost-attribution window.

### 7.3 Cloudflare usage spike or public resource exhaustion (SEV2)

- **Detect.** 429 spikes from C4; Worker or D1 errors; R2 503s from C5; a surprising Cloudflare usage figure (manual, G2).
- **Contain.** C4/C5 already refuse excess. For hostile signup or contact traffic, apply **C6**. To contain one tenant's public backend, visitor transition, contact or photo traffic, preview and apply **C15** for that project or account with a short expiry, then confirm with C15 `status` and C16. Containing site HTML or one hostname still has no tool (G3). Any paid mitigation (WAF, rate-limiting rules, plan change) is a **new service approval** (Section 4.2): review its price and entitlement first ([WAF rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/) availability by plan requires verification).
- **Reconcile.** Check unresolved uploads and `file_cleanup`/photo backlogs in the maintenance report; do not delete private objects to relieve a limit.
- **Recover.** Reverse C6 on both Workers after traffic normalizes; confirm contact forms, public module forms and signup preparation recover. Lift C15 (or let it expire) once the tenant's traffic is reviewed. Do not raise `reserveStorage` or platform ceilings without an approved release; a C15 allowance raise never lifts them.
- **Evidence.** Time range, limiter/ceiling responses seen, controls used, and a note of any manual billing readback (figures only, no account identifiers).

### 7.4 Lost or ambiguous provider response (cross-cutting)

A lost response, timeout or crash after dispatch is **not** evidence that the provider did nothing.

1. Identify the exact request ID (UUID) from the maintenance report or the owner's saved request. Never mint a new request ID to "retry."
2. **AI turn:** the saved answer, if present, completes without a provider call; otherwise the request stays `uncertain` and keeps its internal cost hold. The owner may resend only as a new, reviewed request.
3. **GitHub backup, DNS action, hosting hostname:** read the existing receipt and follow its [recovery contract](maintenance.md#backlogs-and-recovery); `tools/reconcile-domain-hosting.mjs inspect … --remote` creates or deletes no Cloudflare resource, and `apply` needs a reviewed file, digest, operator name and evidence note. A hostname and time match alone does not prove ownership.
4. **OAuth token exchange:** an unresolved exchange has no TTL, blocks another consent for that owner/provider and must be resolved by authenticated provider reconciliation; a ten-minute age is an attention flag, not permission to forget an issued token.
5. **Stripe:** webhooks only carry identifiers; authenticated Refresh reconciles a missed event. An uncertain older write stays held for operator reconciliation.
6. **Release step:** do not reset an uncertain journal step to pending (Section 11).

### 7.5 Provider outages

For each provider, detection is by symptom plus the provider's own status page; there is no probe (G11). Never route to a different provider automatically.

| Provider | What breaks | Contain / workaround | Recovery | Evidence |
| --- | --- | --- | --- | --- |
| **AI (OpenCode Go, Muse test route)** | Chat AI turns fail or time out. | Do nothing destructive. Deterministic Dashboard controls, saved work, publication and recovery still work with AI unavailable. Optionally apply C1 so users get one clear message rather than repeated failures. There is **no paid fallback** and no second route; enabling one is a new approval. | Wait for the provider; reconcile `uncertain` requests (7.4); resume with one benign request. | Status time window, uncertain count before/after. |
| **Stripe (sandbox)** | Checkout, webhooks, invoice reconciliation. | No money is live. Coverage already granted from verified invoice intervals remains; do not grant coverage manually. C8 if the endpoint is misbehaving. | After recovery, authenticated Refresh reconciles missed events from saved identities. | Event IDs, reconciliation result. |
| **Cloudflare (Workers, D1, R2, Turnstile, OAuth, DNS)** | Everything may be affected. Turnstile failure closes signup and contact forms (fail closed); R2 failures refuse photo operations; OAuth/DNS actions become uncertain. | There is no local fallback for D1/Workers. Do not deploy or run releases during a provider incident. Preserve the journal, and read `pnpm run deploy status` once service returns. | Resume from status, never from assumption; run the full reconciliation list. | Provider incident reference, journal state. |
| **GitHub** | Customer backups and OAuth. | Backups are customer-reviewed and idempotent; a dispatched backup stays uncertain until read back. Disconnect still removes local authority immediately. | Resume only through the existing receipt. | Backup receipt IDs. |

### 7.6 Existing paid-resource limits during a spike

Treat C2–C5 as the bounds of the *existing* authorization. Reaching them is a signal to investigate, not to raise them. Raising a ceiling or enabling paid mitigation is Section 4.2.

## 8. Credential and key compromise (SEV1)

### 8.1 Platform secret exposure

Applies to `AI_API_KEY`, `STRIPE_TEST_KEY`, `STRIPE_WEBHOOK_SECRET`, `TURNSTILE_SECRET`, `GITHUB_CLIENT_SECRET`, `CLOUDFLARE_CLIENT_SECRET`, `CLOUDFLARE_DOMAINS_TOKEN`, `CONNECTION_ENCRYPTION_KEYRING` and the deferred `CMS_BRIDGE_MASTER_KEY` ([custody inventory](../tools/secret-custody.mjs)). Never print a value to confirm a leak.

1. **Contain** with the matching control (C1, C6, C8, or C9) *or* revoke at the provider first (preferred for OAuth client secrets, Section 2 caution). Provider revocation and reissue are provider actions; use the provider's own documentation ([Stripe keys](https://docs.stripe.com/keys), [webhooks](https://docs.stripe.com/webhooks)).
2. **Reconcile** exposure window: which operations ran with the key (receipts and reports, not logs of values).
3. **Recover** by installing the reissued value from private custody and re-running `report-connections` (secret-name presence only) and `pnpm run deploy status`.
4. **Evidence:** secret *names*, times, provider reference, no values.

`CONNECTION_ENCRYPTION_KEYRING` is special: do not delete or replace it as a containment step. See 8.3.

### 8.2 Customer-authorized provider tokens

The platform holds encrypted OAuth credentials per owner. Compromise of the platform encryption key or a database read is the exposure path.

- **Contain:** stop connection starts (C9) only if needed; **revoke at the provider** (GitHub App authorization, Cloudflare OAuth) for affected accounts, which needs provider-side action and, for unknown identities, is incomplete ([known-grant revocation](connection-key-lifecycle.md#reviewed-app-grant-revocation--october-2-2026-utc)). Customer disconnect removes local authority first and retains the encrypted revocation obligation.
- **Reconcile:** `report-connections` and the maintenance connection-cleanup queues. An unresolved exchange or a retained refresh credential must be kept until revoked; never delete it.
- **Recover:** a customer reconnects only through a new reviewed consent. Reconnecting does not prove that the old token was revoked.
- **Evidence:** counts and credential-free queue states.

### 8.3 Application-encryption key loss or rotation (`CONNECTION_ENCRYPTION_KEYRING`)

This keyring encrypts customer OAuth and PKCE state. **It is not the account recovery kit, and account recovery cannot reconstruct it** ([data protection](data-protection.md#key-custody-and-recovery)).

- **Preserve reconciliation keys.** Retain every key version that any live ciphertext, unsettled OAuth exchange, staged or revoking credential, retained refresh credential or permitted restore source still needs. Retirement is never admitted by the tooling (`retirementAllowed` is always false); do not delete a retained key.
- **If the active key may be exposed:** rotate with the reviewed fenced procedure (`beginConnectionRotation`, journaled compare-and-swap replacement, resume after interruption). Rotation requires the previous active key to remain in the supplied keyring. Active-key changes are refused while any exchange is unsettled. See [connection key lifecycle](connection-key-lifecycle.md#reviewed-current-key-storage-operations).
- **If a key is lost:** affected credential ciphertext cannot be decrypted. The system shows an unavailable/reconciliation state; it does not fall back or try other keys. If cleanup cannot decrypt, it keeps the encrypted revocation obligation and lease and does **not** claim the provider token was revoked. Recovery is: restore the key from the encrypted operator backup (`tools/connection-key-backup.mjs verify` with the separate recovery key and independently recorded digest), or, if no backup exists, revoke affected provider grants at the provider and have each owner reconnect. Remote revocation of unknown tokens may be incomplete.
- **Backup custody** is a known gap (G9): the recovery key and capsule live on one computer, off-device custody is unaccepted, and a copy in `.secrets/` is not disaster recovery.
- **Evidence:** key **IDs** and counts only. Never key material, capsule contents or recovery keys.

## 9. Owner identity and session incidents (SEV1)

### 9.1 Account recovery is not content recovery

| | Account recovery | Encrypted-content (key) recovery |
| --- | --- | --- |
| Restores | The ability to sign in: a fresh passkey set and ordinary session. | The ability to decrypt a particular key-protected secret. |
| Uses | Current passkey, or the recovery kit through restricted two-step recovery; fences old sessions. | A separately held key (for example the encrypted operator key backup). |
| Does **not** do | Recreate platform encryption keys, a client content key, erased objects or expired backups; revoke third-party provider grants. | Restore access to an account. |

Most customer project content is server-readable under current ownership and policy and is not wrapped in a customer-held key; only the provider-credential vault is key-protected. Client-held or passkey-backed content encryption is a separate, unaccepted feasibility item ([WH-118](roadmap/identity-and-data-protection.md)). No incident step may promise reconstruction of a lost content key.

### 9.2 Stolen recovery kit (G5/G6)

- **Facts.** The kit is a 256-bit key; the server stores only a verifier and never rereads plaintext. The kit plus the account email can start restricted recovery, but cannot alone mint a workspace session. See the exposure described in G6.
- **Owner-side containment before takeover (preferred):** from a recent passkey-authenticated session, **replace the recovery kit** (prepare, save, commit). The old kit stops working, outstanding grants, challenges and other sessions are invalidated in the same transaction, and the commit is fenced. A lost commit reply is resolved by authenticated generation readback.
- **If the owner has no recent session but still has a passkey:** sign in, then replace the kit; remove any unrecognized passkey (C11).
- **After a suspected takeover:** if the attacker completed recovery, the owner's credentials were removed and the kit rotated; **no email, support or Chat path restores access.** Record it as account loss, preserve evidence (account ID, timestamps from the identity receipts), and revoke third-party grants that the attacker may use (8.2). If recovery is secured but not yet completed, the saved **current** kit can resume the restricted attempt, and a retained or staged passkey can too; do not rotate again blindly.
- **Operator limits:** no operator freeze or session-revoke tool (G3). The platform-wide levers are C6/C7 for signup only.
- **Evidence:** account ID, epoch and kit generation as identifiers; no kit material.

### 9.3 Passkey or sync-provider compromise

An unauthorized synced passkey is a valid credential. The owner removes it using **emergency removal**: a recent passkey-authenticated user can remove a compromised credential even when fewer than two would remain; warn, do not keep an unsafe key to satisfy a minimum. Removal revokes all sessions and outstanding identity authority in the same batch. This works **without waiting for a two-key count.**

- If one key remains, ordinary sign-in still works; recommend adding a replacement from a different provider, but do not require it first.
- If none remains, the account enters `recovering`; the saved current kit opens the restricted all-loss flow. Without a usable passkey **and** the current kit, access cannot be regained.
- Ordinary sessions after the fresh-passkey window expires cannot remove keys; re-authenticate.
- After credential removal, review connected provider access (8.2); recovery does not revoke it.

### 9.4 Session containment across browser and native

Sessions carry the account authority epoch, so advancing it (C11) invalidates every earlier browser session at the next request, and a request admitted before revocation still fails a later unauthorized commit. Visitor identity is separate and customer origins never gain workspace authority; disabling a customer application deletes visitor sessions but not workspace ones. **Native sessions do not exist yet (G8):** the Android contract requires the same server authority, so verify epoch revocation in native acceptance rather than assuming it.

## 10. Public abuse and safety incidents (SEV1 for suspected illegal content)

**Owner decisions preserved:** CSAM scanner implementation, provider enrollment and activation are **owner-deferred** (WH-011); existing quarantine and recorded holds are not detection and do not approve held content ([content safety](content-safety.md#csam-detection--planned-owner-deferred)). CMS functional testing remains deferred. This runbook adds no scanner and does not re-open that decision.

### 10.1 Suspected CSAM or other illegal material

1. **Stop.** Do not open, copy, screenshot, summarize, transmit or paste the material. Do not send it to Chat, a model, GitHub, ordinary logs or this record. Do not "clean up" by deleting it: preservation and reporting duties may apply (18 USC 2258A; applicability needs counsel).
2. Record only a content-free note: UTC time, how it was reported, the project/account **identifiers**, and that you stopped.
3. **Escalate to counsel / restricted handling.** None is established (G12). Until it is, the owner decides; this is a known gap and the reason the scanner deferral is a launch gate, not a reason to improvise.
4. **Containment available today** is the owner-reviewed set (C10), the narrow photo/import/specification holds and WH-132 preservation holds that already exist, and C15 (once configured) to stop that tenant's public backend, visitor, contact and photo traffic without deleting anything. An operator still cannot take a tenant's site pages offline selectively (G3). A whole-platform action is an all-tenant decision.
5. **Do not** tell the customer details of an open report; use only the neutral policy notice in Section 14 once counsel agrees.

### 10.2 Other prohibited content, phishing, scams, harassment

Follow the same containment limits. Content safety is mandatory at every plan and level; Monitor mode never disables it. Record the policy category and identifiers. The operator content-risk review tool (`tools/review-content-risk.mjs`, preview then `--apply DIGEST`) records reviewed evidence and corrections; it does **not** remove content. Removal is owner-driven today (G3), so a non-cooperating customer cannot be forced offline except by the all-tenant levers; C15 can freeze its public backend, visitor, contact and photo traffic meanwhile.

### 10.3 Abusive public traffic, contact spam, visitor-application abuse

- C4 limits, Turnstile, contact caps per project and hour, and the 100-attempt/day application ceiling reduce exposure. Per-tenant intake suspension without losing messages is **C15** (`contact` freeze, or a lower hourly allowance), implemented locally and not yet configured; C6 still stops all contact forms. A C15 `transition` freeze stops visitor writes but not visitor pages or sign-in.
- **Reconcile:** stored contact messages remain private until deletion or expiry; do not purge them to stop abuse.
- **Evidence:** counts and time windows, never message bodies.

## 11. Failed maintenance or release (SEV2)

Authoritative contract: [releases](releases.md#recovery-decisions). Summary of required behavior:

| Situation | Action |
| --- | --- |
| Failure during `prepare` | No remote write occurred; fix, create a new sealed archive. |
| Schema initialization failed | Inspect the actual catalog and the original command; **never replay into a partial database.** A terminal failed attempt may be abandoned for a new reviewed empty database. |
| Worker step done, readback interrupted | Confirm tag, version, service/database bindings and secret names with `pnpm run deploy status`; resume only remaining steps. |
| CLI outcome uncertain | Do not reset the step to pending. Inspect routing, settings and assets as well as code; review a forward repair. No automatic repeat. |
| Out-of-band change (including C1/C6/C8) | `prepare` again against the real state. |

- **Rollback is not a repository control.** A [Cloudflare Worker rollback](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/) is an out-of-band provider action that the lease and journal do not cover, schemas are forward-only, and "release rollback rehearsal" is open work (WH-059). Treat it as an owner decision requiring a fresh `status` read afterward, not a documented step.
- Preserve the full archive and original logs; `.secrets/` is not a backup.
- Maintenance job failure: other jobs still report independently; fix the cause, let the schedule re-run, and watch the overdue threshold (interval plus one hour). Nothing here retries a provider operation.

## 12. Data loss and restore (outline only)

[D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/) is a documented provider capability (up to 30 days on Workers Paid per the October 2 reading). Whumpo has not demonstrated a restore, and it does not include Worker secrets, private R2 bodies or independent deletion suppressions (G10). Do not restore over a live database or assume an old backup is current authority: an admitted restore must reconcile epochs, withdrawn publications, deletion records, uncertain provider results and key IDs **before** serving or dispatch. The isolated verifier (`tools/restore-admission.mjs`) never grants serving or dispatch. Preserve the incident record and escalate to the owner; use the [restore admission contract](restore-admission.md) rather than improvising.

A synthetic isolated local drill of this outline (control D1, private objects, Worker artifacts, QuickJS app data, and the restored Workers executed in loopback-only workerd) is recorded in [disaster recovery](disaster-recovery.md). It proves local fencing and visible failures only; cloud restore, independent custody and WH-019 reconciliation remain open.

## 13. Recovery and return to normal

Return to normal only when all hold: the cause is identified; the reconciliation list from the Section 6 step 4 is clear or each remaining item is accepted by the owner with a reason; each containment control is reversed or consciously left; `report-maintenance` has no unexplained attention; `pnpm run deploy status` matches; and one benign owner journey passes. Customer-visible recovery access (sign-in, recovery kit flow, export and deletion) must remain reachable throughout and be re-verified at the end.

## 14. Customer communication drafts (unsent)

**Status: drafts for the owner. No outbound channel exists (G5), nothing was sent, and each requires owner review (and counsel where marked) before use.** Use placeholders in brackets. Never include credentials, internal IDs of other customers, or details of an open safety report.

**A. AI assistant unavailable (SEV3).**

> Subject: Whumpo assistant is temporarily unavailable
> The Whumpo assistant is not responding right now because of a service issue [at our AI provider / while we review capacity]. Your projects, saved versions, published sites and Dashboard controls are unchanged and still work. Any request that was in progress will not be repeated automatically; we will check each one before you are asked to resend. We will update you by [time] or when service resumes.

**B. Billing sandbox issue.**

> Whumpo's test billing is behaving unexpectedly. No real payments are involved. Your current plan coverage has not changed. We are reconciling sandbox events and will confirm when it is resolved.

**C. Possible account compromise (owner-facing; SEV1).**

> We saw activity that may indicate your Whumpo recovery kit or passkey was exposed. Please sign in with a passkey you trust and, from Security, (1) replace your recovery kit, (2) remove any passkey you do not recognize, and (3) review connected GitHub and Cloudflare access. Whumpo cannot reset your access by email or support if you lose both your passkeys and your current recovery kit. [Add time window and next update.]

**D. Lost recovery material — limits of recovery.**

> Whumpo can restore your ability to sign in only with a current passkey or your current recovery kit. Recovering your account does not recover encrypted connection keys, deleted files or expired backups. If you disconnect and reconnect GitHub or Cloudflare, reconnecting does not by itself prove the earlier access token was revoked.

**E. Policy or safety notice (counsel review required).**

> A part of your project does not meet Whumpo's acceptable-use policy ([category]). We [paused / removed] [item identifier]. Your other work is unaffected. [Appeal path: not yet implemented — fill in only when WH-016 provides one.] *Do not use this draft for suspected CSAM; follow Section 10.1.*

**F. Data exposure notice (counsel review required).**

> [Counsel to draft. Facts to supply: what categories were involved, the time window, whether customer content or credentials were affected, what we did, and what the customer should do.] Do not state "no customer was affected" unless the Section 6 reconciliation supports it.

## 15. Post-incident review

Within [7 days], the owner records, in the private incident record and (sanitized) in the feature contract:

1. Timeline (detected, declared, contained, reconciled, recovered) with UTC times and the control IDs used.
2. Whether detection was by report, user or luck (G1), and the time lag.
3. Whether any control behaved differently than described here; correct this document.
4. Reconciliation results: operations left uncertain and why.
5. Customer communications actually sent, by whom, and when.
6. New or changed gaps in Section 3, each with an owner and roadmap ID.
7. Evidence check (Section 5 grep) result and where private evidence is stored.

## 16. WH-007 acceptance mapping

| Acceptance criterion | Where addressed | Evidence level |
| --- | --- | --- |
| Each runbook has detection, containment, reconciliation, recovery and evidence steps | Sections 7–11 each carry those five elements; common procedure in Section 6 | Written; desk-checked |
| Kill switches stop new risky work without erasing data or uncertain holds | Section 2 table "What it preserves"; C1 traced to `reconcileStandardChat` and passing `tests/standard-ai-recovery.mjs` (offline) | Desk-checked plus offline regression; **not** a live drill |
| Existing paid-resource authorization and new service approvals are distinct | Section 4.2 | Policy statement |
| A tabletop drill records recovery gaps and owners without sending external messages | [incident-tabletop.md](incident-tabletop.md) | Desk-check only, honestly labelled |
| Account recovery vs encrypted-content recovery; preserve reconciliation keys; revoke compromised credentials without a two-key count | Sections 8.3, 9.1, 9.3 | Written; traced to the identity and key-lifecycle contracts |

**WH-050/WH-007 follow-up slice (October 4, 2026, local only):** C15 operator containment (partial G3), C16 counter thresholds (partial G1) and a manual health probe (partial G11) are implemented with local SQLite/D1 and loopback tests; none is configured, rehearsed or accepted.

**Not done and not claimed:** a live provider-outage or alert injection, installation of alerting, a deployed rehearsal of any control, off-device key custody, restore proof, or counsel/NCMEC readiness. WH-007 remains open for those gates; see the [tabletop record](incident-tabletop.md#recovery-gaps-and-owners).

## 15. Support hours, escalation and customer communication

WH-035, October 4, 2026. Desk-written; not live-drilled. Customers reach support at `/workspace/support` even when Chat is down ([usage reviews and support](usage-review-requests.md#independent-support-access-wh-035)).

- **Hours.** The platform has one owner-operator (G1). **Owner decision (October 4, 2026): no support hours are published.** `SUPPORT_HOURS` stays unset, so the page says none are set.
- **Intake and triage.** Run `{"action":"queue","state":"open"}` with `tools/respond-usage-review.mjs` on the same cadence as C12 (the maintenance report lists `support_open`). Work oldest first. Treat a request that mentions credentials, suspected illegal content, takeover or spend as a SEV1/SEV2 candidate (Section 1) and move it out of the support channel; generic support does not detect or handle abuse and no restricted case workflow is configured here (G12, WH-016).
- **Responding.** Write a deliberate customer-visible answer, preview, then apply. Saving the answer is not delivery and is not a read; check `{"action":"queue","state":"answered"}` for notification and read state. Never paste private notes, other customers' identifiers or provider detail.
- **Escalation.** Same table as Section 1; the owner decides. No second operator exists.
- **Incident communication.** There is no outbound channel (G5) unless the owner selects and reviews a notification provider; until then the only customer-visible channel is the saved response and the support page status links. Section 14 drafts remain unsent templates. Promise no response time, no uptime and no staffing outside the hours the owner actually sets.
- **Contact address.** **Owner decision (October 4, 2026):** customer contact starts through the customer's Whumpo agent, which also handles responses back. Lockouts go to `hello@whumpo.com`, shown only on lockout paths (support page lockout line and signed-out passkey/recovery help). The operator answers lockout email from that mailbox; this does not bypass the passkey/kit recovery rules, and no response time is promised. There is no general contact address and no `SUPPORT_CONTACT` variable.
