# Operational runbooks: deploys, D1, spend, providers and leaked secrets

**WH-007, October 29, 2026 UTC.** Seven command-level runbooks for the failures an operator meets first. They sit under the [incident runbooks](incident-runbooks.md), which keep ownership, severity, escalation, the control list (C1-C16), the gap register (G1-G12), the two separations (platform emergency controls versus fair-use Monitor; existing paid-resource authorization versus new service approval), the incident record and the customer drafts. This page does not repeat them. It gives the exact commands, who decides, and how to confirm recovery. The [exercise record](#exercise-record-october-29-2026-utc) says what was run and what was not.

Rules that apply to every runbook:

- **Roles.** `Owner` is the platform owner. `Agent` is an orchestrating agent acting inside the standing authority in `~/.claude/AGENTS.md` and the memory note on merge and deploy authority: it may merge a PR, run read-only reports, and re-run a Workers Builds build. It never rotates or changes a shared secret, deletes a repository, Worker, database or Pages project, force-pushes or rewrites history, unless the owner asks for that action directly. A step marked **OWNER ONLY** needs the owner in the current chat.
- **Read before touching.** Capture the read-only reports first (each is SELECT-only or a single GET). Contain by stopping new risky work; never delete rows, receipts, holds, keys or archives.
- **Never print a secret value.** Reports show secret and key *names* and IDs only. Use `node --env-file=$HOME/.config/secrets/api-keys.env tools/X.mjs` for the reports that need Cloudflare operator authorization; do not echo the file.
- **No hand deploys.** No `wrangler deploy`, `wrangler versions` or `pnpm run deploy prepare/apply/status` from an agent machine ([deployment](deployment.md)). The only agent route to production is a merge to `main`, then the Workers Builds trigger.
- **Uncertain means held.** A lost response, a timeout or a journal step in `running` or `unknown` is never retried by resetting it. See the [recovery decisions](releases.md#recovery-decisions).

## Quick reference: read-only commands

| Need | Command | Notes |
| --- | --- | --- |
| Is `main` green, did the build run | `gh run list --repo Digifender-LLC/whumpo-website --branch main --limit 5` and `gh api repos/Digifender-LLC/whumpo-website/commits/main/check-runs --jq '.check_runs[] \| [.name,.status,.conclusion] \| @tsv'` | GitHub Actions checks are `Type-check and build` and `Secret scan`; Workers Builds appears as `Workers Builds: whumpo-platform`. |
| Is the platform Worker alive | `node tools/probe-health.mjs https://whumpo.com` | One GET `/api/health`; exit 2 on failure. Liveness only, not D1, R2, AI or providers. |
| Jobs, backlogs, unresolved receipts | `node --env-file=$HOME/.config/secrets/api-keys.env tools/report-maintenance.mjs` | Exit 2 is attention (unobserved, overdue, failed, stalled, unavailable), not necessarily a fault. |
| Shared counters at 50% / 80% of ceiling | `node --env-file=$HOME/.config/secrets/api-keys.env tools/report-maintenance.mjs --counters` | Totals only. |
| Unresolved AI gateway holds | `node --env-file=$HOME/.config/secrets/api-keys.env tools/report-gateway.mjs` | Evidence only; never release a hold from it. |
| Row counts per table (closure/readiness) | `node --env-file=$HOME/.config/secrets/api-keys.env tools/account-closure-inventory.mjs` | Aggregate counts, SELECT only. |
| Cost events against a provider statement | `node --env-file=$HOME/.config/secrets/api-keys.env tools/cost-reconcile.mjs --remote [--tolerance MICROS] STATEMENT.json` | Reads `cost_events`, writes nothing; omit `--remote` to read the local D1. |
| Internal AI cost estimate by window | `node tools/report-task-costs.mjs FROM_ISO TO_EXCLUSIVE_ISO [--account UUID]` | Shadow estimate, not an invoice; at most 93 days. |
| Fair-use observations | `pnpm report:fair-use` | Monitor only; never an enforcement basis. |
| Which secret names are required | `node tools/secret-custody.mjs` | Source metadata; names only, no values, no provider call. |
| One account or project's allowance state | `node tools/operator-containment.mjs --input PRIVATE.json` with `{"action":"status",...}` | Preview/read; `--apply DIGEST` writes and is owner-gated. |
| Live Worker versus a release archive | `pnpm run deploy status RELEASE_ID` | Owner machine only; needs `.secrets/releases/RELEASE_ID/`. |

---

## R1. Failed or partial Workers Builds deploy, docs-only merges and a red `main`

**Decides.** Agent for re-running a build and for a fix-forward PR; Owner for anything that needs the owner cutover path, a Cloudflare dashboard change or an uncertain journal step.

**How the pipeline works.** A merge to `main` triggers Cloudflare Workers Builds on `whumpo-platform`. It runs `pnpm check && node tools/verify.mjs fast && node tools/verify.mjs protection && pnpm build`, then `pnpm run deploy ci` ([deployment](deployment.md)). `deploy ci` refuses outside `WORKERS_CI=1`, refuses schema drift, a changed control database and CMS registrations, then prepares and applies runtime, apps, sites, platform under the D1 lease and prints the journal in the build log ([releases](releases.md#automatic-releases-merge-to-main)). GitHub Actions `CI` runs separately and deploys nothing.

### R1.1 Docs-only merge: there is no build

Changes only under `docs/`, `*.md` or `integrations/emdash/` do not trigger a build. **No Workers Builds check run on the merge commit is correct, not a failure.** The live Workers stay on the last code merge.

1. Confirm the diff: `git diff --name-only PREV..MERGE_SHA`; every path should be under `docs/`, end in `.md`, or sit under `integrations/emdash/`.
2. Confirm GitHub Actions is green: `gh run list --repo Digifender-LLC/whumpo-website --branch main --limit 3`.
3. If a doc change was meant to ride with a code change (for example a schema or contract note), that code change needs its own merge to deploy.

Verify recovery: nothing to recover; `node tools/probe-health.mjs https://whumpo.com` still passes.

### R1.2 Build or deploy failed

1. **Find the failing phase.** `gh api repos/Digifender-LLC/whumpo-website/commits/MERGE_SHA/check-runs --jq '.check_runs[] | [.name,.status,.conclusion] | @tsv'`. The build log is in the Cloudflare dashboard (Workers & Pages, `whumpo-platform`, Builds). It is the only record of the journal ([releases](releases.md#private-archive-and-journal)).
2. **Classify by the message** (all raised before any remote write unless stated):

| Build log says | Meaning | Action |
| --- | --- | --- |
| Gate step fails (`pnpm check`, `verify.mjs fast`, `protection`, `pnpm build`) | Nothing deployed. | Reproduce locally (see R1.3); fix forward in a PR. |
| `Worker changed outside this release` or `Build or remote baseline changed during preparation`, then `Retrying once` | Concurrent merges. One retry is automatic. | If the retry also fails, **re-run the build for the latest `main` commit** (dashboard Retry build, or push nothing). Agent may do this. |
| `CI release refused: ...` (schema, database, CMS) | The commit needs an owner cutover, so nothing was deployed. | **OWNER ONLY.** Follow [releases](releases.md#prepare-before-changing-anything-owner-cutover). Do not merge further PRs until the cutover is done. |
| `Release stopped at <role>. Inspect its journal and live status; do not repeat an uncertain operation.` | A step started and its outcome is unproven (a **partial** deploy: for example runtime and apps new, sites and platform old). | **OWNER ONLY.** Go to R1.4. |
| `Deployment lease expired or changed` or `Another platform deployment is active` | Lease contention. | R2. |

3. **Order problem.** A build for an older commit can finish after a newer one and deploy older code ([open risk in releases](releases.md#automatic-releases-merge-to-main)). After any burst of merges, re-run the build for the latest `main` commit and compare with `gh api repos/Digifender-LLC/whumpo-website/commits/main --jq .sha`.

### R1.3 Red `main`

`main` is red when `Type-check and build` or `Secret scan` fails, or the Workers Builds gate fails, on a merged commit.

1. **Stop merging** other PRs until `main` is green. Merges queue extra Workers builds that will fail the same gate.
2. **Reproduce locally** from a clean checkout of the failing SHA: `mise exec node@24.21.0 pnpm@11.19.0 -- pnpm install --frozen-lockfile`, then `mise exec node@24.21.0 pnpm@11.19.0 -- pnpm check`, `... -- node tools/verify.mjs fast`, `... -- node tools/verify.mjs protection`, `... -- pnpm build`, `... -- node tools/roadmap.mjs validate`. The checkout must have no `.env` or `.dev.vars` (the verify profiles refuse them).
3. **Fix forward** in a new PR; do not force-push or rewrite `main`. A revert PR (`git revert SHA`) is also a normal fix-forward and is the fastest when the cause is not obvious. Agent may open and merge it under its standing authority.
4. **A secret-scan failure is a leak until shown otherwise.** Treat it under R7 before reverting.
5. **Verify.** The fix commit's checks all `success`, the Workers Builds check run is `completed` / `success`, and `node tools/probe-health.mjs https://whumpo.com` passes. The live Workers are the last commit whose build succeeded; a red `main` with a failed build leaves the previous deploy serving.

### R1.4 Partial release, uncertain step (OWNER ONLY)

Never reset a step to `pending`, never re-run `apply` to "finish". Per [recovery decisions](releases.md#recovery-decisions):

1. Capture the build log (journal JSON) and run `node tools/probe-health.mjs https://whumpo.com`.
2. On the owner machine with the release archive: `pnpm run deploy status RELEASE_ID` (read-only) and compare `workers.*.before`, `live` and `candidateTagMatches`, and `schema.observed` against `schema.target`.
3. Establish whether the original operation finished: inspect routing, settings and assets as well as the code tag. A matching tag alone does not prove completion.
4. Choose the **forward repair**: merge a fix and let Workers Builds prepare again from the actual live state (it reconciles against what is live), or, if a `Worker changed outside this release` state persists, reconcile the other operation first.
5. Verify with the Section [Verify recovery](#verify-recovery-common) checks.

There is no rollback command in the protocol. `wrangler rollback` restores a prior Worker version but never reverses database changes ([deployment](deployment.md)); using it is an unrehearsed owner decision (gap G7).

---

## R2. Deploy lease stuck

**Decides.** Agent waits and re-runs a build; Owner for any direct change to the lease row.

**What the lease is.** One row in `cms_platform_deploy_lock` (`id=1`, `token`, `expires_at`). `withPlatformLock` (`tools/deploy-platform.mjs`) sets a random token and `expires_at = now + 15 minutes` only when the old lease has expired, renews it with each guard check during the release, and sets `expires_at = now` in `finally`. `tools/configure-github-app.mjs` uses the same lock. There is no lease-release command, and a crashed holder leaves a lease that **expires by itself within 15 minutes**.

**Symptoms.** `Another platform deployment is active; inspect its process before retrying` (the lease is held by a live or recently crashed run), or `Deployment lease expired or changed; reconcile before retrying` (a run outlived its renewals; it stops before the next step).

**Steps.**

1. Is another deploy actually running? `gh api repos/Digifender-LLC/whumpo-website/commits/main/check-runs --jq '.check_runs[] | [.name,.status] | @tsv'` and the dashboard Builds list. An `in_progress` Workers build, or an owner `apply`, is a legitimate holder. **Wait for it.**
2. If nothing is running, wait **16 minutes** from the failed attempt (15-minute expiry plus a margin), then re-run the build for the latest `main` commit. Agent may do this.
3. **Never** edit `cms_platform_deploy_lock` by hand and never delete the row. Clearing a lease held by a live holder lets two releases race, which the lease exists to prevent. If the lease is still held after the wait and no process is running, that is an anomaly: **OWNER ONLY**, read `SELECT expires_at FROM cms_platform_deploy_lock WHERE id=1` (never select `token`) with `wrangler d1 execute --remote`, record the value, and decide. The expiry comparison uses the database clock.
4. A lease **expiry during a release** means the run stopped between steps: treat it as R1.4 (`Release stopped at ...`), not as a lock problem.

Verify recovery: the next Workers build completes `success`; `node tools/probe-health.mjs https://whumpo.com` passes; no journal step is left `running` or `unknown`.

---

## R3. D1 problem, cutover and forward recovery

**Decides.** Owner for every change to the control database binding, a cutover, a Time Travel restore or any data repair. Agent may only run the read-only reports and prepare a PR.

**Facts.** The control database is `whumpo-control-2026-10-29` (`655854de-5a26-463d-af1e-82d539dd0181`), bound as `DB` in `wrangler.jsonc`, `wrangler.sites.jsonc` and `wrangler.apps.jsonc`. There are no numbered migrations: the complete current schema (`tools/current-schema.mjs`) is initialized into a **new empty database** at a cutover; test data is not carried over (owner decision: test users only). The previous database `whumpo-control-2026-10-28` is kept. `deploy ci` refuses any commit whose schema differs from the live database.

**Detect.** `node tools/probe-health.mjs https://whumpo.com` (Worker only); `node --env-file=$HOME/.config/secrets/api-keys.env tools/account-closure-inventory.mjs` (fails with "Account closure inventory unavailable" if the D1 API or the schema is wrong, which is itself a signal); `... tools/report-maintenance.mjs` (`unavailable` backlogs name the failing query). Check the Cloudflare status page for D1.

**Decision table.**

| Situation | Rule | Who |
| --- | --- | --- |
| D1 provider outage (queries time out or 5xx) | No local fallback. Do not deploy and do not run a cutover during the outage. Preserve the journal; read `status` after service returns. | Owner informed; wait. |
| Merge changes the schema | **Merge only together with the cutover**: PR points the three `DB` bindings at a new empty database; owner runs `deploy prepare` (`schemaChange: "initialize"`, `testDataResetAuthorized: true`, complete schema hash, concrete `cutoverReview`) then `deploy apply`; do not merge other PRs between merge and cutover. | **OWNER ONLY** |
| Schema drift or "not exactly the current schema" at deploy | Never replay into a partly initialized database. A terminal failed attempt is discarded in favour of a **newly reviewed empty database**. | **OWNER ONLY** |
| Cutover interrupted | Inspect the catalog and the original command; follow [recovery decisions](releases.md#recovery-decisions). The lease stays in the baseline database until completion; **do not delete the old database before the journal completes**. | **OWNER ONLY** |
| Data corruption or bad write | D1 Time Travel may hold history for up to 30 days on Workers Paid ([docs](https://developers.cloudflare.com/d1/reference/time-travel/)). Restoring in place is unrehearsed and overwrites newer rows. Prefer a forward repair (reviewed corrective writes) or restore into a new database through the [restore admission](restore-admission.md) path; that admission never authorizes serving, provider dispatch or key retirement. | **OWNER ONLY** |
| Restore from backup | Whole-platform restore is not proven (gaps G10, WH-008/019/059). The local drill is `node tests/recovery-drill.mjs`; it is synthetic, not a cloud restore. | **OWNER ONLY** |

**Never.** Delete a database, bucket or Worker as part of recovery without the owner asking for that exact action. Superseded databases are retired only on owner approval.

**Verify recovery.** `node tools/probe-health.mjs https://whumpo.com`; `tools/account-closure-inventory.mjs` returns counts; `tools/report-maintenance.mjs` returns `jobs` and `backlogs` with no `unavailable` caused by the schema; after a cutover, `deploy status RELEASE_ID` shows all four candidate tags matched and the schema `observed` equal to `target`, then the live checks recorded in [releases](releases.md#test-platform-cutover--october-29-2026-utc) (`/` and `/api/health` 200, anonymous `/api/chat` and `/api/profile` 401).

---

## R4. AI provider (OpenCode Go) down or rate-limited

**Decides.** Owner for removing or restoring `AI_API_KEY` and for any paid fallback; Agent for monitoring and reporting. There is no second route and no paid fallback; adding one is a new service approval ([incident runbooks §4.2](incident-runbooks.md#42-existing-paid-resource-authorization-versus-new-service-approval)).

**Route.** `AI_BASE_URL` `https://opencode.ai/zen/go/v1`, protocol `responses`, model `muse-spark-1.3-contributor` (`wrangler.jsonc`), key in the `AI_API_KEY` secret.

**What users see** (from `src/ai-chat.ts` and `src/ai.ts`):

| Provider behaviour | Classification | What the user sees | Cost and state |
| --- | --- | --- | --- |
| HTTP 4xx including **429 rate limit**, or configuration problem | `rejected` / `configuration` | The turn fails: "The AI provider could not accept this request. Your credits were not used. Please try a new message later; Dashboard controls remain available." | Attempt closed, hold released. A new message is a new request. |
| Reply cut at the 4,096-token limit | `output_limit` | "The model reached its reply limit before finishing. Your credits were not used. Try a shorter or more focused question." | Closed. |
| HTTP 5xx, timeout, network loss | `unavailable` | "The AI response could not be confirmed. Your credits were not used, and this message will not be sent again automatically. Check your saved work before asking again." | Request marked `uncertain`; **cost hold kept**; never redispatched. |
| `AI_API_KEY` removed (control C1) | not configured | Chat sends return 503 "assistant is temporarily unavailable. Your saved work and Dashboard controls are still available." | Pending turns with a saved result still complete without a provider call. |
| Internal inference budget exhausted (C2) | admission | 503 "AI is temporarily unavailable while the platform's testing capacity is reviewed." | Not an outage; do not raise budgets. |

Deterministic Dashboard controls, saved work, publishing and recovery keep working. Standard assistance spends no customer credits, so users are not charged for failures.

**Steps.**

1. **Detect.** User reports, or a run of `uncertain` requests in `node --env-file=$HOME/.config/secrets/api-keys.env tools/report-maintenance.mjs` (`operations` family `standard_ai`, 100 oldest). Check the provider status or account page (contact path not recorded in the repo, gap in [incident runbooks §1](incident-runbooks.md#escalation)). `report-gateway.mjs` shows unresolved gateway holds (zero in the October 29 read).
2. **Preserve.** Save the report outputs. Do not release or redispatch an `uncertain` request from a report; an identical request with a saved result completes settlement without inference ([standard AI accounting](standard-ai-accounting.md#interrupted-requests)).
3. **Contain only if needed.** For a rate limit or a short outage do nothing. If failures are noisy or the cause may be a leaked key, **OWNER ONLY**: apply C1, `wrangler secret delete AI_API_KEY --config wrangler.jsonc`, and record the time. Verify the secret name is gone.
4. **Recover.** Wait for the provider. If C1 was applied, restore the provider-reissued key from private custody (set it by prompt, never by pasting into chat or shell history). Send **one** benign owner request, not a synthetic burst. Re-run the maintenance report: the `uncertain` count is flat or falling, and each remaining item is reconciled by its own receipt.
5. **Evidence.** Status window, uncertain count before and after, time `AI_API_KEY` was removed and restored, secret **names** only.

Local simulation that exists: `node tests/standard-ai-recovery.mjs` (lost settlement acknowledgment, pre-dispatch cleanup, uncertain cost retention, late-result rollback, no redispatch) and `node tests/standard-ai-chat.mjs`.

---

## R5. Spend spike

**Decides.** Owner for any ceiling change, new spend, or a paid mitigation; Agent for detection and for reconciliation reports.

**Which caps exist** (and which do not):

| Cap | Where | Scope | Note |
| --- | --- | --- | --- |
| Per-account monthly inference budget | admission in `src/ai-chat.ts`, `src/model-costs.ts` | One account | Rejects with the "testing capacity" 503. The Muse figures are **shadow estimates**, not an invoice. Do not raise during an incident. |
| 4,096 output tokens, one lookup and one follow-up per call | reservation before dispatch | One call | Bounds single-call growth. |
| `AUTH_LIMITER` 10/60 s and `API_LIMITER` 120/60 s per key | `wrangler.jsonc` | Burst brakes | Not spend caps. `API_LIMITER` refused nothing in live probes at up to 2.5 times its limit; `AUTH_LIMITER` was not measured. |
| `SITE_LIMITER` 300/60 s per client source (sites Worker, WH-075 D38/D39) | `wrangler.sites.jsonc` | Burst brake before any D1 read; 429 with `retry-after: 60` | Not a spend cap; per location, approximate. **Not shown to refuse live (October 31 probes: 0 x 429 in 600 GETs; the same for `API_LIMITER`); treat as unproven.** No charge is listed for the namespace. Deleting the block removes the limit and the code keeps serving. |
| R2 100,000 reads and 10,000 writes per UTC month; per-project photo reads 10,000/month | `src/storage-budget.ts` | Platform and project | 503 when reached. |
| Shared counters (public backend 1,000/day, visitor transitions 1,000/day, contact receipts, R2, visitor rows, `cost_events` 9,000 rows) | `node tools/report-maintenance.mjs --counters` | Platform | `warn` 50%, `act` 80%. |
| Per-project or account freeze and temporary allowance | `node tools/operator-containment.mjs` | One tenant's public traffic | Source and local tests exist; confirm it is in the live schema before relying on it (R5 exercise note). |
| **No** account-wide Cloudflare spend cap, no provider-billing reader, no alert delivery | gap G2, G1 | | Check the Cloudflare billing page by hand. |

**Steps.**

1. **Detect.** `... report-maintenance.mjs --counters` (exit 2 at 80%); `node tools/report-task-costs.mjs FROM_ISO TO_EXCLUSIVE_ISO` over the window; `pnpm report:fair-use`; the Cloudflare and OpenCode usage pages. Compare with the previous period.
2. **Classify.** One legitimate heavy workload (leave Monitor unchanged; manage capacity), abusive traffic ([incident runbooks §10](incident-runbooks.md#10-public-abuse-and-safety-incidents-sev1-for-suspected-illegal-content)), or a leaked key (go to R7). Fair-use Monitor never blocks or warns; cost alone opens a review, not a restriction ([pricing](pricing-and-model-policy.md#monitor-mode-and-company-profitability)).
3. **Contain** the narrowest control. AI cost with no clear legitimate cause: **OWNER ONLY** C1. Hostile signup or intake: C6 on both Workers. One tenant: `node tools/operator-containment.mjs --input PRIVATE.json` (preview prints a digest), then `--apply DIGEST` with a short expiry, **OWNER ONLY**. Nothing erases data or holds.
4. **Reconcile.**
   1. Export the provider statement to a private file (CSV or JSON; the format is in [cost events](cost-events.md#statement-import-and-reconciliation-report-wh-171-october-29-2026)). An empty amount is an explicit unknown, not zero.
   2. `node --env-file=$HOME/.config/secrets/api-keys.env tools/cost-reconcile.mjs --remote STATEMENT.json`. Status `reconciled` only inside the stated tolerance; `incomplete` while unknown or unfinished events exist; `unexplained-residual` otherwise; `no-statement` when events exist with no invoice line. Account minimums and allowances are never split across tenants.
   3. Read unresolved holds with `tools/report-gateway.mjs` and the maintenance `operations` lists. A shadow total is excluded from the comparison.
   4. If `cost_events` is empty or the table is missing, the residual equals the invoice. The October 29 read had no recorded events, so the report is only a total until emission is live (WH-170 cutover).
5. **Recover.** Restore any removed secret from custody and verify one benign request. Lift containment (`lift`) or let it expire. Do not raise a ceiling; a ceiling change or a paid mitigation (WAF, rate-limiting product, plan change) is a **new approval** by the owner.
6. **Evidence.** Window, counters seen, controls used and times, reconcile report (aggregate only; it carries no tenant identifiers), and any manual billing figures without account identifiers.

---

## R6. Stripe, Cloudflare or GitHub outage

**Decides.** Owner for any containment and for customer notice; Agent for monitoring. Never route to another provider automatically.

| Provider | Detect | What breaks | Steps | Verify recovery |
| --- | --- | --- | --- | --- |
| **Stripe (sandbox only; no real money)** | Stripe status; webhook failures in the Stripe dashboard (sandbox); checkout 5xx | Sandbox Checkout, webhooks, invoice reconciliation. Coverage already granted from verified invoice intervals stays. | Do nothing destructive. Do not grant coverage by hand. If the endpoint misbehaves, **OWNER ONLY** C8: delete `STRIPE_WEBHOOK_SECRET` or `STRIPE_TEST_KEY` on `whumpo-platform`. | Restore the secret from custody; an authenticated Refresh reconciles missed events from saved identities. `node tests/stripe-sandbox-cleanup.mjs` (local) shows the cleanup contract; the sandbox CLI is `pnpm setup:stripe`, an owner action. |
| **Cloudflare** (Workers, D1, R2, Turnstile, OAuth, DNS, Workers Builds) | `cloudflarestatus.com`; `node tools/probe-health.mjs https://whumpo.com` failing; 5xx with no recent release; Workers Builds not starting | Everything may be affected. Turnstile failure closes signup and contact forms (fail closed). R2 failures refuse photos. OAuth and DNS actions become uncertain. A build cannot start or finish. | **Do not deploy, cut over or re-run builds** during the incident; a half-run release is an R1.4 case. Preserve outputs. Hosting reviews: `node tools/reconcile-domain-hosting.mjs inspect ... --remote` is read-only (the `apply` form needs a reviewed file and digest). | Probe passes; maintenance report has no new `unavailable`; re-run the latest `main` build only after status is green and no journal step is uncertain; reconcile the lists in [incident runbooks §6](incident-runbooks.md#6-common-procedure). |
| **GitHub** (repo, Actions, App/OAuth) | `githubstatus.com`; `gh run list` failing or stuck | Merges, CI and the Workers Builds trigger (it watches GitHub). Customer backups and OAuth. | If GitHub is down, no merge can deploy, and **that is the safe state**. Do not deploy by hand. Customer backups are idempotent and reviewed: a dispatched backup stays uncertain until read back; disconnect still removes local authority at once. | `gh run list --repo Digifender-LLC/whumpo-website --branch main --limit 3`; a Workers build exists for the latest `main` commit (R1.2 step 3); backup receipts reconcile via the maintenance `operations` family. |

For lost or ambiguous provider responses use [incident runbooks §7.4](incident-runbooks.md#74-lost-or-ambiguous-provider-response-cross-cutting). A timeout is not evidence the provider did nothing.

---

## R7. Leaked secret

**Decides.** Owner for every rotation, deletion or reissue. **An agent never rotates or changes a shared secret.** An agent may detect, preserve, contain-by-report and prepare the PR that removes a committed value.

Steps marked **OWNER ONLY** change a provider or a Worker secret. The secret **inventory** is `node tools/secret-custody.mjs` (names, classes and recovery rule; no values): `CONNECTION_ENCRYPTION_KEYRING`, `GITHUB_CLIENT_SECRET`, `CLOUDFLARE_CLIENT_SECRET`, `CLOUDFLARE_DOMAINS_TOKEN`, `TURNSTILE_SECRET`, `AI_API_KEY`, `STRIPE_TEST_KEY`, `STRIPE_WEBHOOK_SECRET`, `CMS_BRIDGE_MASTER_KEY`. Also the operator-side `CLOUDFLARE_API_TOKEN` and the other keys in the private agent env file.

1. **Detect.** The CI `Secret scan` job (gitleaks with `.gitleaks.toml`), a provider alert, or a suspicious value in a PR, log or chat. Record the **name** and the time. Do not repeat the value anywhere.
2. **Preserve and scope.** Capture the read-only reports for the exposure window: `tools/report-maintenance.mjs`, `tools/report-gateway.mjs`, `tools/report-connections.mjs` (secret-name presence only), and `tools/report-task-costs.mjs` for the window. Determine which operations ran with the key from receipts, not from logs of values.
3. **Stop the leak path** (Agent): if the value is in Git, open a PR removing it. History rewrite and force-push are **OWNER ONLY** and are not needed to stop use: rotating makes the old value dead.
4. **Contain** (**OWNER ONLY**): revoke at the provider first when that is possible (the leaked value stays valid until then), or apply the matching control: C1 `AI_API_KEY`, C6 `TURNSTILE_SECRET` on **both** Workers, C8 Stripe pair, C9 OAuth client secrets (prefer revoking at the provider so revocation retries keep working).
5. **Rotate** (**OWNER ONLY**), per secret:

| Secret | Rotate by | Then |
| --- | --- | --- |
| `AI_API_KEY` | Reissue at the provider; `wrangler secret put AI_API_KEY --config wrangler.jsonc` by prompt | One benign request (R4). |
| `STRIPE_TEST_KEY`, `STRIPE_WEBHOOK_SECRET` | Roll in the Stripe sandbox dashboard ([keys](https://docs.stripe.com/keys), [webhooks](https://docs.stripe.com/webhooks)); `wrangler secret put` each | Authenticated Refresh. |
| `TURNSTILE_SECRET` | Rotate in Cloudflare; put on `whumpo-platform` (`wrangler.jsonc`) **and** `whumpo-apps` (`wrangler.apps.jsonc`) | Contact form and signup preparation recover. |
| `GITHUB_CLIENT_SECRET`, `CLOUDFLARE_CLIENT_SECRET` | Reissue at the provider. **Reconcile issued grants, staged and revoking tokens and uncertain exchanges first** ([connection key lifecycle](connection-key-lifecycle.md)). | `tools/report-connections.mjs`. |
| `CLOUDFLARE_DOMAINS_TOKEN` | Reissue a scoped token; revalidate zone authority. | `tools/reconcile-domain-hosting.mjs inspect`. |
| `CLOUDFLARE_API_TOKEN` (operator) | Create a new scoped token, update the private env file, delete the old token in the dashboard. | Any `--remote` report. |
| `CONNECTION_ENCRYPTION_KEYRING` | **Do not delete or replace as a containment step.** Use the fenced rotation (`beginConnectionRotation`, journaled compare-and-swap, the previous key stays in the keyring) and retain every key version live ciphertext still needs ([incident runbooks §8.3](incident-runbooks.md#83-application-encryption-key-loss-or-rotation-connection_encryption_keyring)). Active-key changes are refused while an exchange is unsettled. | `tools/connection-key-backup.mjs verify` with the recovery key. |
| `CMS_BRIDGE_MASTER_KEY` | Deferred feature; retain exact key versions; do not rotate without a reviewed plan. | |

   Setting a Worker secret is out-of-band: the release lease does not cover it. A release archive prepared before the change records the old secret-name inventory, so `apply` refuses it; discard unapplied archives and `prepare` a new one. Never put the new value in chat, a ticket, a file under version control or a shell history line.
6. **Customer-authorized tokens.** If the keyring or a database read is the exposure path, revoke at the provider for affected accounts and keep every encrypted revocation obligation ([incident runbooks §8.2](incident-runbooks.md#82-customer-authorized-provider-tokens)).
7. **Verify.** Secret **names** are present (`tools/report-connections.mjs`); `node tools/secret-custody.mjs` inventory still valid; `node tools/probe-health.mjs https://whumpo.com`; a read-only report of the dependent path; the old value is rejected by the provider (owner-checked in the provider UI). The CI `Secret scan` job on the removal PR is `success`.
8. **Evidence.** Secret names, times, provider references and counts. Never a value, a prefix or a hash of one.

---

## Verify recovery (common)

After any runbook, all of these before closing:

1. `node tools/probe-health.mjs https://whumpo.com` exits 0.
2. `gh run list --repo Digifender-LLC/whumpo-website --branch main --limit 3` shows `success`, and the Workers Builds check run for the latest *code* commit is `completed` / `success`.
3. `node --env-file=$HOME/.config/secrets/api-keys.env tools/report-maintenance.mjs`: no new `unavailable` or `stalled`; the `uncertain` and unresolved counts have not grown; daily jobs not yet run since a cutover are `unobserved`, which is expected until 03:17 UTC.
4. `node --env-file=$HOME/.config/secrets/api-keys.env tools/report-gateway.mjs`: `unresolved` is 0 or each item is explained.
5. The incident record ([incident runbooks §5](incident-runbooks.md#5-incident-record-and-evidence-handling)) has times, controls used, secret names and the reconciliation list, and no credential or customer content.

## Exercise record: October 29, 2026 UTC

Source: `origin/main` at `db72ccc` (rebased onto `5d35b4e`). Node 24.21.0 and pnpm 11.19.0 through `mise`. **Local suites, dry runs and read-only commands only.** No deploy, no `deploy prepare/apply/status`, no secret read, set or rotation, no Cloudflare or database write, no message sent. Remote reads used the operator token from the private env file and printed no values.

| Runbook | Exercised with | Result |
| --- | --- | --- |
| R1 | `node tests/deploy-ci.mjs` (commit identity, generated schema-unchanged review, schema/database/CMS refusals, Workers Builds-only guard); `tests/release-manifest.mjs`; `tests/release-provider.mjs`; `gh run list` and `gh api .../commits/main/check-runs` on `main` | All suites pass. `main` CI `success`; the check-runs call returned `Workers Builds: whumpo-platform` (in progress), `Secret scan` and `Type-check and build` (success). The red-`main` local reproduction was not run against a broken commit. |
| R2 | `node tests/release-lock.mjs` | Pass: renewal, competing-operator exclusion, cleanup on failure, expired-lease refusal and ownership-safe release. The live lease row was **not** read (needs `wrangler d1 execute --remote`, owner). |
| R3 | `node tests/recovery-drill.mjs` (isolated local restore), `tools/account-closure-inventory.mjs` (remote) | Drill passes (synthetic, local). Remote inventory returned all counts, all zero at 20:43 UTC. No restore, Time Travel or cutover was attempted. |
| R4 | `tests/standard-ai-recovery.mjs`, `tests/standard-ai-chat.mjs`, `tests/gateway-spend.mjs`, `tools/report-gateway.mjs` (remote) | Suites pass; gateway report: 0 unresolved, 0 held micros. No real provider call, no outage injected. `tests/ai-gateway.mjs` **fails on `main`** with `ProviderError: AI provider unavailable` at its override loop (line 18); see gap RB-3. |
| R5 | `tests/cost-reconcile.mjs` (9 cases); `tools/cost-reconcile.mjs --remote` with a synthetic one-line statement; `tests/operator-containment.mjs` (SQLite); `report-maintenance.mjs --counters` (remote) | Suites pass. The remote reconcile worked read-only and returned `unexplained-residual` equal to the whole synthetic invoice (660000 micros), because the live `cost_events` table holds no events. Counters: all `normal` at 0 used. The tool with no files exits 1 and prints its usage. |
| R6 | `tests/stripe-sandbox-cleanup.mjs`; `tools/probe-health.mjs https://whumpo.com` and a rejected `http://example.com` target | Probe: 200 `{"status":"ok"}` in 880 ms, exit 0; non-https target refused, exit 1. No provider outage was simulated. |
| R7 | `tests/secret-custody.mjs`; `node tools/secret-custody.mjs` | Pass: nine declared secrets, readers match source, undeclared env readers refused, 66 refusals; the tool printed names only and `backupCustodyVerified:false`, `retirementAllowed:false`. No rotation. |

Also run: `tests/maintenance.mjs`, `tests/tenant-classification.mjs`, and the full maintenance report (below).

**Full maintenance report, October 29, 20:43 UTC (remote, SELECT only):** 16 jobs, 50 backlog queues, exit 2. Job states: hourly jobs `completed`, `hosting` `skipped` (not configured), eleven daily jobs `unobserved` (the database was created on October 29 and the 03:17 UTC daily run had not yet happened). Backlogs: all `empty` except `review_turnover`, which was `unavailable`.

## Gaps found

| ID | Gap | Owner / next step |
| --- | --- | --- |
| RB-1 | No read-only way to see **which commit is live**, or to read the deploy lease, without a release archive (`deploy status` needs one) or an owner `wrangler d1 execute`. The health body is only `{"status":"ok"}`. | Owner decision: add a build-commit field to `/api/health` or a read-only status helper (small PR). |
| RB-2 | The `review_turnover` backlog was `unavailable` against the live control database at 20:43 UTC, which forces maintenance exit 2 even when nothing is wrong. Source and local tests pass, so the live schema or deployed code may differ for that query. Not diagnosed. | Owner or agent: run the single query with `wrangler d1 execute --remote` (read-only) and reconcile against the October 29 schema digest. |
| RB-3 | `node tests/ai-gateway.mjs` fails on `main` (override loop at line 18). The AI Gateway route is not the active route (OpenCode Go is), and the suite is not in the `fast` or `protection` profiles. | Fix or retire the suite in a separate PR. |
| RB-4 | `cost_events` holds no events in the live database, so the spend reconciliation has nothing to compare; provider billing readers, usage notifications and alert delivery do not exist (gaps G1, G2). | WH-170 cutover and owner decisions on alert delivery. |
| RB-5 | No live drill: no real build failure, lease contention, D1 outage, provider outage, 429 from the model or secret rotation was exercised. The operator-containment tool is not shown to be in the live schema. | Owner-authorized facilitated exercise (see [incident tabletop](incident-tabletop.md)). |
| RB-6 | An older commit's Workers build can finish after a newer one and deploy older code ([releases](releases.md#automatic-releases-merge-to-main)). The runbook relies on re-running the latest build. | Open design item in releases. |
| RB-7 | OpenCode Go support/contact path, and Cloudflare support entitlement, are not recorded (gap in [incident runbooks §1](incident-runbooks.md#escalation)). | Owner records privately. |
