# Static-site paid beta plan — October 2026

**PLAN — proposed October 25, 2026 (UTC) from `main` at `6828f1c`. Not approved, not started.** This is the scoped packet for [WH-048](backlog.md) (bounded real-customer beta) and the beta part of [WH-041](backlog.md) (payment activation and commercial terms). It narrows the beta. It does **not** narrow the [MVP contract](../mvp.md), and the beta must never be marketed as the full MVP.

Facts are labelled **established** (read on October 25 from the repo, local commands or a read-only API call) or **UNVERIFIED**. Every remote mutation in this plan (deploy, cutover, Stripe live keys, provider keys, DNS, invitations) needs the owner's explicit authorization for that operation, under the existing [release protocol](../releases.md).

## 1. Goal and scope

**Goal:** 10–20 invited, paying, US-based customers each run a real static website on Whumpo, built and maintained through Chat, for at least 60 days. Learn whether customers stay and pay, and what a customer costs to serve.

**In scope (only these paths are admitted):**

| Path | Current state (established) |
| --- | --- |
| Invitation signup, two-passkey enrollment, recovery kit, sessions | Deployed, local and synthetic evidence; no physical-device acceptance |
| Conversational onboarding → first draft | Deployed |
| Chat site drafting, edits, exact reviews, versions, restore | Deployed for owner testing |
| Publish/unpublish to `<project>.whumpo.site` | Deployed for owner testing |
| Source export of a site | Implemented |
| Contact forms on published sites | Implemented; notice delivery runs on the minute cron |
| One paid plan through Stripe Checkout, invoices, cancellation | Sandbox only; `src/stripe-billing.ts` hard-requires `livemode===false` and `cs_test` ids |

**Explicitly disabled or out of scope for the beta** (keep them off server-side, not just hidden in the UI):

- Photo upload, serving and publication. Bytes are already held pending a scanner ([photos](../photos.md)); the beta keeps that hold and offers no upload entry point. This is what makes the beta possible without the deferred CSAM scanner.
- Customer backends and visitor applications (QuickJS), shared modules, CMS/WordPress import, guest previews.
- Customer GitHub/Cloudflare connections, domain purchase, premium-model credits, annual domain benefits.
- Custom domains: **stretch goal only** (section 4, Week 5). Activation is disabled today ([custom hosting](../integrations/domain-hosting.md)).
- Android app.

**Beta packaging (owner decision D3):** one plan, not four. Recommended: Starter features at **$17/month**, monthly only, cancel any time, with a "beta" label and a written price lock for beta customers. Standard AI is "included within a daily limit" during beta. Not "unlimited": there is no account-wide spend cap today (incident gap G2), and fair use runs in Monitor mode only.

## 2. Owner decisions needed first

Nothing in sections 3–4 should start until these are made. Each one blocks specific work.

| # | Decision | Recommendation | Blocks |
| --- | --- | --- | --- |
| D1 | Adopt this narrowed beta scope, and the WH-048 dependency treatment in section 5 | Adopt | Everything |
| D2 | Production inference provider for customer content. Muse Contributor may train on prompts and is ineligible for confidential beta content ([benchmarks](../customer-benchmarks.md)) | A paid API with no training on API data and short or zero retention, reached through the existing OpenAI-compatible transport. Pick by a small Whumpo task benchmark (Week 1); Cloudflare Workers AI is the simplest privacy story because Cloudflare is already the infrastructure provider | Inference work, privacy policy text |
| D3 | Beta plan, price and AI daily limit | $17/month, monthly; daily standard-AI cap set from Week 1 measured cost so that a capped heavy user still costs under ~50% of the plan price | Stripe live setup, Terms |
| D4 | Adopt the legal drafts (with counsel review) and file the DMCA agent | Yes; budget a short counsel review of Terms, Privacy and AUP focused on the beta | Inviting anyone |
| D5 | Authorize the schema cutover in [cutover plan](../cutover-plan-2026-10.md) section 6 | Yes, `main` bundle as recommended there | Deploying anything after October 9 |
| D6 | Sales tax approach | Turn on Stripe Tax and register where required; confirm with an accountant (Idaho LLC selling SaaS nationally) | Live Checkout |
| D7 | Support promise | Email support at a named address, business-day response, owner as sole operator, stated in Terms | Inviting anyone |
| D8 | Inference budget ceiling for the whole beta | Fixed monthly ceiling at the provider (hard limit in its console) plus the per-account daily cap | Inference go-live |

## 3. Week 0 — unblock delivery (est. 1–3 days)

**Established:** the four Workers were last deployed **2026-10-09 10:11–10:12 UTC** (read-only Cloudflare deployments API, October 25). That matches commit `033e7d9`, the last commit before #186 changed the schema. **Nothing merged to `main` since October 9 is live.** The [cutover plan](../cutover-plan-2026-10.md) explains why `deploy ci` refuses: the live database still has the October 4 schema.

Also established: this repository is now `Digifender-LLC/whumpo-website`, and its PR checks show only `Type-check and build` and `Secret scan`, with no Workers Builds run. **UNVERIFIED:** whether Workers Builds is still connected to the old `zemdregon/whumpo` repository.

1. Confirm which repository Workers Builds watches and reconnect it to this one.
2. With D5 approved, run the cutover per [cutover plan](../cutover-plan-2026-10.md) and record it in [releases](../releases.md) with a full readback (Worker versions, schema digest, assets).
3. Confirm one ordinary docs-free merge then deploys through `deploy ci` on its own.
4. Clean up: close or merge the stale dependency PRs (#296–#298, #328), fix the failing Dependabot update jobs, and update the README's source-repository line.
5. Pause audit-only and evidence-only work (WH-001/WH-004 slices) until the beta ships, except the boundary checks this plan names. Add a `delivered` readiness value to `backlog.json` so finished tasks stop appearing in `roadmap.mjs next` ([ready-queue audit](ready-queue-audit-2026-10-21.md)).
6. Require that every PR states the tests it actually ran. Do not merge PRs whose tests were never run.

**Exit:** `main` deploys automatically again, and the live schema matches the source.

## 4. Build plan

Estimates assume one owner plus agents. They are planning numbers, not commitments.

### Weeks 1–2 — commercial and legal path

**Inference (D2, D8)**
- Run the offline benchmark suite ([customer benchmarks](../customer-benchmarks.md)) against 2–3 candidate providers on the beta tasks only: onboarding first draft, page edits, review summaries. Record success rate, p95 latency and cost per successful task. This is the narrow, budgeted version of WH-020.
- Switch `AI_BASE_URL`/`AI_MODEL` for the beta route to the chosen provider. Keep Muse only for owner testing, or remove it.
- Add a per-account daily standard-AI cap that actually refuses requests (a narrow enforcement path, not the full fair-use system) and a platform daily ceiling. Show remaining allowance in Chat. Test: the cap holds under concurrent requests, and a refused request creates no reservation or charge.
- Set the provider console's hard monthly limit (D8).

**Payments (D3, D6)**
- Add an explicit `STRIPE_MODE` (`test` | `live`) setting. Make the `livemode` and `cs_test`/`cs_live` checks in `src/stripe-billing.ts` and the webhook verifier follow it. One mode per environment, never both. Tests: a live-mode event is refused in test mode and vice versa; a browser return still never grants a plan.
- Create the live product and price for the beta plan, a live webhook endpoint and secret, and turn on Stripe Tax. Keep the sandbox environment working for testing.
- Make the other three plans unpurchasable server-side for the beta.
- Write the refund and dispute policy (recommended: prorated refund on request in the first 30 days; disputes handled manually).

**Legal (D4)**
- Counsel review, then adopt Terms, AUP, Privacy and Cookie notices with an effective date. Update `service-providers.md` for the D2 provider.
- Add a Terms acceptance step to signup: a checkbox, a stored version hash and timestamp, and a re-acceptance prompt when the version changes. Existing test accounts must accept before they continue.
- File the DMCA designated agent with the US Copyright Office and publish its details in `copyright.md`.
- Add a beta notice: features that are off, data-export path, support address.

### Weeks 3–4 — operations and customer safety

**Alerting (gaps G1, G11)**
- Schedule the existing health probe (`tools/probe-health.mjs`) from outside Cloudflare, or set up an uptime monitor, alerting to the owner's phone.
- Turn on Cloudflare usage notifications and budget alerts, Stripe webhook-failure emails and the provider spend alert.
- Daily: read the private maintenance report (`pnpm report:fair-use` and the maintenance diagnostics) until a week passes with nothing new.

**Recovery (narrowed WH-008/WH-059)**
- Restore the control D1 database from D1 Time Travel into a scratch database and verify it is complete. Record the measured restore time. **UNVERIFIED:** Time Travel retention on this account; check it in the dashboard.
- Rehearse one Worker rollback to the previous version (G7), using the release protocol.
- Move the application-encryption recovery key and capsule to a second, offline location (G9). Without this, losing one computer loses customer connection data.
- Write a one-page beta runbook: who to contact, how to freeze an account (C15), how to stop invitations (C6/C7), how to roll back, how to refund.

**Account safety (narrowed WH-005, WH-063)**
- Send an email notice when recovery starts or a passkey is added or removed (gap G5). Contact-email sending already exists. This is the cheapest mitigation for a stolen recovery kit (G6).
- Physical-device test of the full beta journey: one iPhone (Safari, iCloud Keychain) and one Android phone (Chrome, Google Password Manager). Cover signup with two passkeys, sign-in, recovery with the kit, first draft, edit, review, publish, cancel. Record the results the way [owner usability audit](../owner-usability-audit.md) records them.
- Human Turnstile check on signup.

**Customer data**
- Manual account closure and data export procedure for beta customers. The automated version (WH-018/WH-077) can wait. State the retention windows used for the beta in the Privacy notice; choose from the proposals in [data lifecycle](../data-lifecycle.md).
- Abuse handling: a report address on every published site footer, and a written procedure for reviewing and unpublishing a reported site. Publication is text-only because photos stay held.

**Support (narrowed WH-035)**
- A support email that works when Chat, onboarding or sign-in fails, linked from the lockout and error screens. Test it from a signed-out browser.

### Week 5 — release candidate and owner dry run

- Freeze a release candidate, deploy it through `deploy ci`, and record the readback.
- Owner runs the full journey on production with a real card: pay, build, publish, edit, restore, cancel, refund. Check that the Stripe dashboard, invoice and in-app plan state agree.
- Re-run the boundary checks that cover admitted paths: `node tools/verify.mjs fast`, `protection` and `site`, all on the candidate commit.
- Inference-outage check: published sites and contact forms keep working while the AI provider is unreachable ([daily workspace](../chat-daily-workspace.md) outage test).
- Stretch: activate custom hostnames for one controlled domain, following the activation checklist in [custom hosting](../integrations/domain-hosting.md). Leave it off for customers unless every step passes.

### Weeks 6–7 — canary

- Invite **3 customers** who know it is a beta (friends or warm leads). Do not use a waitlist yet.
- Review every day: cost per account, cap refusals, errors, support emails, stuck reviews.
- **Exit to wider beta:** no stop condition triggered for 14 days, all 3 published a site, and measured AI cost per active customer is within the D3 budget.

### Week 8+ — wider beta

- Invite up to 20 customers in groups of 5, one group a week, reviewing between groups.
- Collect funnel metrics through the existing content-free milestones ([funnel metrics](../funnel-metrics.md)): signup → first draft → first publish → second-week edit → second invoice paid.

## 5. WH-048 dependency treatment (for D1)

WH-048 lists 16 dependencies. For this narrowed scope:

| Task | Treatment for this beta |
| --- | --- |
| WH-001 evidence reconciliation | **Narrowed:** the release-candidate readback (Week 5) replaces further reconciliation |
| WH-002 release manifests | Required; delivered, re-run on the candidate |
| WH-003 verification profiles | Required; delivered, run on the candidate |
| WH-004 boundary audit | **Narrowed:** admitted paths only; existing `protection` profile on the candidate |
| WH-005 physical-device identity | **Narrowed:** two-phone owner test in Weeks 3–4 |
| WH-007 incident runbooks | **Narrowed:** one-page beta runbook plus alerting |
| WH-008 disaster recovery | **Narrowed:** one D1 Time Travel restore and a key-custody fix |
| WH-017 safety coverage | **Narrowed:** satisfied by keeping all media held and uploads off; text abuse handled by the manual procedure. Must be redone before photos are enabled |
| WH-019 erasure after restore | **Deferred:** manual note in the closure procedure that a restore may bring back deleted data, which is then re-deleted |
| WH-020 inference privacy | Required in narrowed form (D2 plus the Week 1 benchmark) |
| WH-024 usability audit | Required; delivered |
| WH-025 activation metrics | Required; existing funnel milestones |
| WH-050 capacity and fairness | **Narrowed:** daily AI cap plus a cohort of 20 or fewer |
| WH-059 rollback rehearsal | **Narrowed:** one Worker rollback rehearsal |
| WH-035 support | **Narrowed:** support email reachable when signed out |
| WH-117 data protection | Required; delivered pending operator key custody (Week 3–4 fix) |

## 6. Stop conditions (record before the first invitation)

Stop new invitations, and freeze affected accounts if needed, on any of:

- any cross-account data exposure, or any unreviewed publication;
- any suspected illegal content;
- payment state that disagrees with Stripe for any customer;
- AI spend above the D8 ceiling, or a customer's cost above plan price for 3 days;
- an outage over 4 hours without a working rollback;
- a recovery or sign-in failure that support cannot resolve within 2 business days.

Review cadence: daily during the canary, weekly during the wider beta. Write each review down.

## 7. Success measures (decide at day 60)

| Measure | Target to proceed toward public launch |
| --- | --- |
| Signup → first published site | ≥ 70% within the first session or day |
| Customers active in week 4 (any edit or publish) | ≥ 50% |
| Second invoice paid | ≥ 60% of paying customers |
| AI + infrastructure cost per active customer | ≤ 40% of plan price |
| Security or data incidents | 0 |
| Median support response | ≤ 1 business day |

If the targets miss, the next step is product work on the first-draft and edit experience, not wider features.

## 8. What comes after the beta (not part of this plan)

Photo uploads (needs scanner selection, WH-011/017), custom domains for everyone, the other three plans and premium credits, backends and visitor apps, customer connections, domain purchase, automated export and closure, and a second operator. Each needs its own admission review.
