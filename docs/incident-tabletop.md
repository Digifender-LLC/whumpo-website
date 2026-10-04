# Incident runbook desk-check (WH-007)

**October 4, 2026, source `1343111`. This is a written desk-check of the [incident runbooks](incident-runbooks.md) against current source, tools and feature contracts. It is not a live drill.** No deployed system, provider, customer account or database was contacted. No message of any kind was sent to anyone, and the customer drafts in the runbook remain unsent. The scenarios are synthetic: they use invented UUIDs and no real credential, customer content or account. "Traced" below means a source or document was read and cited; "ran" means an offline fixture was executed locally.

The WH-007 acceptance item asks for a tabletop that records recovery gaps and owners without external messages. This record satisfies the written-trace form of that item only. A facilitated live exercise with a second participant, injected provider failures and an installed alert path has **not** happened and remains open.

## What ran (offline, synthetic)

Run in the task worktree after `pnpm install --frozen-lockfile`. The environment had Node.js v22.22.0, **not** the repository's required Node.js 24, so these results are supporting evidence, not a verification claim under the documented toolchain. Each uses disposable in-memory SQLite or a fake provider and makes no network or provider call.

| Command | Result | Relevance |
| --- | --- | --- |
| `node --stack-trace-limit=0 tests/maintenance.mjs` | Passed | Independent job failures, last completion, missing telemetry, private-data exclusion (detection). |
| `node --stack-trace-limit=0 tests/maintenance-inventory.mjs` | Passed | 32 read-only queues, four receipt families, retention eligibility. |
| `node --stack-trace-limit=0 tests/maintenance-scheduled.mjs` | Passed | Isolated failing job does not hide others; recovery on next run. |
| `node --stack-trace-limit=0 tests/standard-ai-recovery.mjs` | Passed | Persisted answer, lost settlement acknowledgment, pre-dispatch cleanup, uncertain cost retention, late-result rollback, no redispatch. |
| `node --stack-trace-limit=0 tests/standard-ai-usage.mjs` | Passed | Receipt lifecycle, dispatch/cancel race, uncertain retention, zero customer ledger change. |
| `node --stack-trace-limit=0 tests/standard-ai-chat.mjs`, `tests/model-costs.mjs` | Passed | Uncertain provider outcomes, replay, budget admission and cost retention. |
| `node --stack-trace-limit=0 tests/secret-custody.mjs` | Passed | Nine declared secret names match source readers; no values handled. |
| `node --stack-trace-limit=0 tests/release-manifest.mjs` | Passed | Partial-failure steps, uncertain-command hold, binding drift refusal. |
| `node --stack-trace-limit=0 tests/identity-recovery.mjs` | Passed | all/some/none recovery, emergency removal, restricted rotation, zero-key recovery. |

None of these is an alert test. There is no alert delivery path to test (G1). The "synthetic outage" verification in the WH-007 packet is therefore only partly met: provider-outage handling was traced and the AI-uncertain path was exercised offline, but no outage was injected into a deployed system and no alert was raised.

## Trace 1: AI cost spike (synthetic)

**Scenario.** On a day with an active cohort, the owner notices the provider usage page rising faster than normal and one account showing many large turns. No customer has complained.

| Step | Runbook reference | What the trace found |
| --- | --- | --- |
| Detect | 7.1, 7.2 | Detection depends on someone looking: the provider usage page or `report:fair-use` / `report-task-costs`. No alert exists (**G1**). `report-task-costs` accepts a window of at most 93 days and reads aggregates; it does not print prompts. Costs are Muse **shadow** estimates, so the real spend signal is the provider's own page. |
| Classify | 1 | SEV2 unless the key may be leaked, then SEV1. Cost alone does not establish misuse (pricing policy). |
| Preserve | 6 | Capture `report-maintenance` and `report-gateway` first (SELECT only). |
| Contain | 2 (C1) | Removing `AI_API_KEY` makes `configuredAI()` return undefined; `sendChat` then returns the 503 "temporarily unavailable ... Dashboard controls remain available" message. No row is deleted. Alternatives C2/C3 already bound one account and one call but are not a platform cap. There is no per-account AI stop (**G3**). |
| Do not | 4.1 | Do not use a fair-use review or Enforce to stop the account; Monitor stays default and the mode cannot self-enable. |
| Reconcile | 7.2, 7.4 | Requests dispatched before the key was removed are marked `uncertain` on the next Chat read after two minutes; reserved-but-undispatched work is released; saved answers complete without a provider call. Internal cost holds stay. Confirmed against `src/standard-ai-recovery.ts` and the offline test above. |
| Recover | 7.2, 13 | Restore the secret from private custody; verify by one benign request, not a burst. Any budget increase or paid route is a new approval (4.2). |
| Evidence | 5 | Names of the secret and times, report outputs, window. No key value. |

**Findings.**

1. **F1: No spend alert or account-wide cap** (G1, G2). Owner: platform owner, WH-023 for finance gates. Not fixable inside a docs task.
2. **F2: Secret removal is out-of-band.** `tools/release-manifest.mjs` refuses a Worker that "lost a required secret binding", so a release archive prepared before C1 would fail at apply. The runbook now requires a fresh `prepare` after any containment change. Owner: platform owner; WH-059 should cover it in rollback rehearsal.
3. **F3: Customer copy mentions credits that no longer exist.** The budget-exhaustion message in `src/ai-chat.ts` and the reconciliation messages in `src/standard-ai-recovery.ts` say "Your credits were not used", although standard AI has no customer credit ledger. This is source/copy and was **not changed** here. Owner: chat/billing copy owner (follow-up to the standard AI accounting contract).
4. **F4: Reconciliation is request driven.** An abandoned request is only marked `uncertain` when its owner reads Chat. In an incident the operator's maintenance report lists them but nothing sweeps them. Acceptable under the contract; note it when deciding "all clear". Owner: platform owner.

## Trace 2: Lost provider response (synthetic)

**Scenario.** A Chat turn with request ID `00000000-0000-4000-8000-0000000000a1` is dispatched to the model provider. The Worker connection drops before any answer or token usage is recorded. Separately, a GitHub backup dispatch has the same shape.

| Step | Runbook reference | What the trace found |
| --- | --- | --- |
| Detect | 7.4 | `report-maintenance` lists the provider-operation families (standard AI, hosting, GitHub backup, DNS) with up to 100 oldest unresolved IDs and a ten-minute attention threshold. The exact request ID is the key. |
| Contain | 7.4 | Nothing is redispatched. `dispatchStandardAI` moved the receipt `reserved` to `dispatched`; retry reads the same record and changed identity or a competing revision fails. |
| Reconcile | 7.4 | `reconcileStandardChat`: if tokens are saved, settle and complete; else, after two minutes, release if undispatched, mark `uncertain` if dispatched, and set the turn to failed/uncertain with a "not sent twice" message. The cost reservation is retained. |
| Recover | 7.4 | The owner sends a new, reviewed request. The runbook forbids minting a new ID to bypass the hold. |
| Evidence | 5 | Request ID, state before and after, no prompt or reply text. |

**Findings.**

5. **F5: An uncertain request cannot be closed from a report.** The maintenance report and `report-gateway` give identifiers, not proof of usage or no charge. The operator must reconcile with the provider's own records if cost matters. There is no tool that attaches provider evidence to an uncertain AI receipt (the gateway ledger has `uncertain → settled` only for the inactive Gateway path). Owner: WH-021 (Gateway canary) and WH-023.
6. **F6: Lost OAuth exchanges may be unrecoverable by owner identity alone.** Per the connection contract, an unknown initial provider account may not be identifiable from the Whumpo owner. Runbook 8.2 states this. Owner: WH-056, the connector framework, and provider reconciliation.

## Desk-check of each runbook

| Runbook | Checked against | Result |
| --- | --- | --- |
| 7.3 Resource exhaustion | `wrangler.jsonc` limiters, `src/storage-budget.ts`, `src/contact-page.ts`, `src/app-gateway.ts` | Controls exist as described. C5's ceiling is platform-wide and photo-specific. No paid mitigation is configured, and the account's WAF/rate-limiting entitlement is unverified. **Gaps G2, G3.** |
| 7.5 Provider outages | `src/chat.ts`, `src/stripe-common.ts`, `src/workspace-identity/ceremonies.ts`, `src/contact-page.ts`, maintenance contract | Turnstile outage closes signup and contact forms (fail closed). Stripe sandbox failure leaves stored invoice-interval coverage. No automatic paid AI fallback exists. No probe (G11). |
| 8.1 Platform secret exposure | `tools/secret-custody.mjs` (nine names), `tools/release-manifest.mjs` | Names match source. A client-secret removal can stop revocation retries (F7 below). |
| 8.2 Provider tokens | Connection lifecycle, GitHub/Cloudflare connection docs | Local disconnect is immediate; provider revocation is incomplete for unknown identities. |
| 8.3 Key loss/rotation | `docs/connection-key-lifecycle.md`, `docs/data-protection.md`, `tools/connection-key-backup.mjs` | Retirement is never admitted, so a retained key must not be deleted. Off-device custody is unaccepted (**G9**). Rotation procedure exists in source and local tests; no deployed rotation has been done. |
| 9.2 Stolen kit | `docs/workspace-identity.md`, `docs/identity-recovery.md` | The contract leaves a kit-plus-email takeover path and no notification (**G5, G6**). The owner-side containment (kit replacement from a recent session) is specified and offline-tested. |
| 9.3 Passkey compromise | Same | Emergency removal works below two keys, as the packet requires. A last-key removal enters `recovering`. |
| 9.4 Sessions | `docs/identity-authority.md` | Epoch fencing covers browser sessions; native does not exist yet (**G8**). |
| 10 Safety | `docs/content-safety.md`, `docs/safety-coverage.md` | The scanner deferral is preserved. There is no operator takedown, restricted case store, NCMEC access or counsel (**G3, G12**). The runbook therefore stops and escalates rather than prescribing tool steps. |
| 11 Failed release | `docs/releases.md`, `tools/deploy.mjs` (only prepare/status/apply) | No rollback command exists; the runbook forbids resetting an uncertain step. Rollback rehearsal is WH-059. |
| 12 Restore | `docs/data-protection.md`, `docs/restore-admission.md` | Outline only; no restore has been demonstrated. |

7. **F7: Revocation retries depend on configuration.** `docs/maintenance.md` lists GitHub and Cloudflare cleanup as "when configured". Removing a client secret to stop connection starts can therefore also stop retried revocation of still-valid tokens. The runbook prefers revoking at the provider. Owner: connection owner (WH-056/063).
8. **F8: No per-tenant operator control.** The same gap (G3) appears in the cost, abuse, safety and identity traces. It is the largest recovery gap: every operator lever is all-tenant. Owner: WH-015/016/035 with the platform owner.

## Recovery gaps and owners

| ID | Gap | Owner (accountable) | Roadmap item | State |
| --- | --- | --- | --- | --- |
| G1 | No alert delivery, paging or second operator | Platform owner | WH-007 follow-up | Open; any paid/external service needs separate authorization |
| G2 | No account-wide spend cap or verified usage notification | Platform owner | WH-023, WH-048 | Open |
| G3 | No operator per-account freeze, takedown or session revoke | Platform owner | WH-015, WH-016, WH-035 | Open |
| G4 | No invitation revoke tool | Platform owner | WH-114/115 follow-up | Open |
| G5 | No owner notification on recovery or passkey changes | Platform owner | WH-063, WH-036 | Open |
| G6 | Kit-plus-email recovery takeover path, no support restore | Platform owner | WH-063, WH-005 | Open; needs owner decision |
| G7 | No read-only/maintenance mode or feature flags | Platform owner | WH-059 | Open |
| G8 | No native sessions yet; epoch coverage unproven for native | Platform owner | WH-081, WH-083, WH-087 | Open (planned) |
| G9 | Key backup custody on one computer | Platform owner | WH-117D (#86), WH-008 | Open |
| G10 | Restore not demonstrated | Platform owner | WH-008, WH-019, WH-059 | Open |
| G11 | No synthetic probe or outage detector | Platform owner | WH-007 follow-up | Open |
| G12 | No CSAM detection, restricted case store, reporting access or counsel | Owner decision | WH-011, WH-015, WH-016, WH-017 | Open; scanner owner-deferred |
| F3 | "Credits were not used" copy is stale | Platform owner | Standard AI accounting | Open; source copy not changed |

There is one named person for every item because the project has a sole operator today (itself **G1**). Assign real names when a team exists.

## What this desk-check does not establish

- No deployed control was exercised. Every row in the runbook's control table is desk-checked only.
- No alert, outage or cost event was injected; no alert was tested.
- No live account, provider or customer data was read. No external message was sent.
- The evidence-hygiene check (Section 5 of the runbook) was run only over the two documents written for WH-007; it found no credential or customer content, but it cannot prove the absence of customer prose in future incident records.
- Offline suites ran on Node.js v22.22.0 rather than the repository's Node.js 24; re-run them under Node 24 before citing them as release evidence.
- WH-007 acceptance is **not complete**: the live exercise, alerting, and the gaps above remain. Do not close the execution issue from this record alone.
