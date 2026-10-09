# WH-004 boundary audit: mounted platform API registry

**WH-004 slice 1 · October 8, 2026 UTC · source commit `ca17c6a` · source and local-fixture evidence only.** This is a checked, structural inventory of the platform Worker's mounted request surface with an evidence registry and three reproduced findings. It is **not an exhaustive security claim**, not live or device acceptance, and does not close WH-004. Old green suites are cited only where a specific assertion line was read; a passing suite is never treated as proof of a scenario it does not exercise.

It extends the [October 1 source audit](tenant-authority-audit.md) (commit `a34a131`, findings A1–A3, all remediated). That document remains the historical record. This slice re-reviews current code, adds identity/admission, safety withdrawal, shared modules, guest previews and other surfaces added since, and makes the route inventory a regression guard.

Files: [`docs/boundary-audit.json`](boundary-audit.json) (registry), [`tools/boundary-audit.mjs`](../tools/boundary-audit.mjs) (extractor/checker), [`tests/boundary-audit.mjs`](../tests/boundary-audit.mjs) (offline test, `protection` profile and `pnpm test:boundary-audit`).

## Method

1. **Structural extraction.** `tools/boundary-audit.mjs` parses dispatcher source with the TypeScript 7 syntax tree (`typescript/unstable/sync`, the compiler already used by `pnpm check`; no new dependency, offline). Comments, string contents and fixtures cannot create or hide a route. It reads:
   - every path comparison in [`src/index.ts`](../src/index.ts) (`pathname===`, `startsWith`, `pathname.match(/regex/)`), with the methods that reach each matcher;
   - the sub-dispatchers: identity actions ([`src/workspace-identity/http.ts`](../src/workspace-identity/http.ts)), operator safety-case actions ([`src/safety-case-http.ts`](../src/safety-case-http.ts)), Chat interactions ([`src/chat-interactions/http.ts`](../src/chat-interactions/http.ts)), support ([`src/support.ts`](../src/support.ts)) and the body-dispatched module operations table ([`src/shared-modules/policy.ts`](../src/shared-modules/policy.ts));
   - every typed Chat control in [`src/chat-controls.ts`](../src/chat-controls.ts) with its literal `recentAuth` flag (`confirm` expanded per reviewed kind);
   - the dispatch order in `handle()` around the exact-Origin gate, which routes run before that gate, and which routes' consuming code calls `requireFreshWorkspace`.
2. **Registry.** [`docs/boundary-audit.json`](boundary-audit.json) assigns each extracted matcher and control to exactly one family. Each family records an authority class and six cells: authority, origin, freshness (recent passkey proof), immutable target with exact-review binding, replay/idempotency, and stale-state guard. Cell states:
   - `evidenced`: enforcing code located **and** an existing test line asserts the property (negative cases for authority, replay and stale state);
   - `gap`: `gapKind: "test"` means enforced but no test asserts it; `gapKind: "control"` means required by a contract or runbook but not enforced, and must name a finding;
   - `n/a`: with the reason (read-only, or not required by the current contract);
   - `unverified`: not established in this slice, with what is needed.
3. **Anchors instead of line numbers.** Every enforcement and test citation is `{file, contains}`. The test checks that the file exists and still contains that exact text, so a deleted assertion or rewritten guard fails loudly, while unrelated edits do not. 464 anchors are checked.
4. **Review.** Four read-only reviews traced the privileged families end to end (cross-owner/project/visitor access, model-confirmation bypass, Origin, stale/replay, GET side effects). Every candidate finding was then re-checked in source by the auditor; the three reported below were **executed** against disposable fixtures. Candidates that could not be reproduced are listed as unverified risks.

### What the test enforces

`node tests/boundary-audit.mjs` fails if a mounted route, method or typed control is missing from the registry; if a registered entry no longer exists; if a route's `freshnessCall` or `beforeOriginGate` flag, a control's `recentAuth`, or the dispatch order changes; if a privileged family lacks any of the six cells; if an `evidenced` cell lacks code or test anchors; if any anchor file is missing or no longer contains its text; if a control gap lacks a finding; or if the summary below is stale. It includes source mutations (an unregistered route stub, a widened method, a relaxed `recentAuth`, a new identity action, a removed freshness call, a router moved ahead of the Origin gate) and registry mutations, and asserts each is reported. It takes about 2 seconds. The native compiler client may print `context canceled` on stderr while shutting down; this is benign and does not affect results or the exit status.

When a route is added, register it in the JSON with reviewed cells; do not weaken the checker.

## Scope

Covered: the platform Worker request surface (`whumpo.com`), i.e. `fetch()` → `/contact/:id`, `/api/*` → `handle()` → identity router → exact-Origin gate → operator router → session admission → `handleWorkspace()`, its sub-dispatchers, and the typed Chat controls that reach confirmation verbs.

**Not covered in this slice:** the `whumpo-sites`, `whumpo-apps` (visitor gateway) and `whumpo-runtime` Workers except where a cited test exercises them; scheduled maintenance; operator CLI tools under `tools/`; the model's prompt/output quality; Chat interaction continuation semantics (`/api/chat/interactions/v1/continue` model path) beyond authority/Origin; CMS runtime behaviour (CMS functional testing is owner-deferred, source review only); live Cloudflare/GitHub/Stripe behaviour; native devices; D1 Time Travel/backup-aware erasure; distributed abuse. The Codex Security scan workflow named in the packet was not re-run; this slice is a manual plus structural review.

## Matrix summary

<!-- boundary-audit summary: generated by `node tools/boundary-audit.mjs summary`; checked by tests/boundary-audit.mjs -->
Families: 28 (23 privileged). Registered route matchers: 206. Typed Chat controls: 38. Recorded findings: 3.

| Cell | evidenced | gap | n/a | unverified |
| --- | ---: | ---: | ---: | ---: |
| authority | 25 | 2 | 1 | 0 |
| origin | 27 | 0 | 1 | 0 |
| freshness | 7 | 6 | 11 | 0 |
| target | 23 | 1 | 0 | 0 |
| replay | 24 | 0 | 0 | 0 |
| stale | 23 | 1 | 0 | 0 |

Cells not recorded (allowed only for non-privileged families): 16.

| Family | Privileged | Matchers / controls | authority | origin | freshness | target | replay | stale |
| --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| public-entry | no | 4 / 0 | n/a | evidenced | — | — | — | — |
| identity | credential | 23 / 0 | evidenced | evidenced | evidenced | evidenced | evidenced | evidenced |
| operator-safety-cases | safety-operator | 21 / 0 | evidenced | evidenced | evidenced | evidenced | evidenced | evidenced |
| stripe-webhook | billing | 1 / 0 | evidenced | n/a | n/a | evidenced | evidenced | evidenced |
| billing-owner | billing | 5 / 0 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced |
| support | no | 5 / 0 | evidenced | evidenced | — | — | — | — |
| chat-transport | no | 19 / 2 | evidenced | evidenced | evidenced | evidenced | evidenced | evidenced |
| workspace-owner | no | 23 / 0 | evidenced | evidenced | — | — | — | — |
| service-site-safety | publish | 9 / 0 | evidenced | evidenced | gap (control B2) | evidenced | evidenced | evidenced |
| cms | cms, publish | 15 / 5 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced |
| backend | publish, data-change | 10 / 3 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced |
| application-page | publish | 2 / 1 | evidenced | evidenced | n/a | gap (test) | evidenced | evidenced |
| visitor-access | access, deletion | 1 / 0 | evidenced | evidenced | evidenced | evidenced | evidenced | evidenced |
| application-activation | activation | 2 / 1 | evidenced | evidenced | gap (control B2) | evidenced | evidenced | evidenced |
| application-recovery | data-change, activation | 0 / 2 | evidenced | evidenced | evidenced | evidenced | evidenced | evidenced |
| shared-modules | activation, access, deletion | 20 / 7 | evidenced | evidenced | evidenced | evidenced | evidenced | evidenced |
| contacts-directory | publish, deletion | 6 / 3 | evidenced | evidenced | gap (control B2) | evidenced | evidenced | evidenced |
| domain-hosting | dns-hosting | 3 / 0 | gap (test) | evidenced | n/a | evidenced | evidenced | gap (test) |
| domains | dns-hosting, deletion | 1 / 3 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced |
| photos-files | deletion | 2 / 1 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced |
| specification-service-clients | publish, activation | 4 / 2 | gap (test) | evidenced | evidenced | evidenced | evidenced | evidenced |
| guest-previews | publish, deletion | 3 / 2 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced |
| site-publication | publish, deletion | 5 / 3 | evidenced | evidenced | gap (control B2) | evidenced | evidenced | evidenced |
| site-health | no | 2 / 0 | evidenced | evidenced | — | — | — | — |
| cloudflare-dns | dns-hosting | 4 / 0 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced |
| cloudflare-connection | connection | 5 / 0 | evidenced | evidenced | gap (control B2) | evidenced | evidenced | evidenced |
| github-connection | connection, deletion | 8 / 2 | evidenced | evidenced | gap (control B2) | evidenced | evidenced | evidenced |
| github-backups | backup | 3 / 1 | evidenced | evidenced | n/a | evidenced | evidenced | evidenced |
<!-- /boundary-audit summary -->

Shared gates (all machine-checked by the registry test):

- `handle()` order: `handleIdentityRequest` → exact-Origin gate → `handleSafetyCaseRequest` → `workspaceIdentity` → `handleWorkspace`. Only `/api/health` (GET), `/api/stripe/webhook` (signed), the identity router (own POST + exact-Origin check) and, in `fetch()`, `/contact/:id` (own Origin check on POST) precede the gate.
- GET, HEAD and OPTIONS skip the Origin gate; the session cookie is `SameSite=Lax`. Registered handler methods are exact; the `ANY` entries are gates or delegations whose targets compare methods themselves, so HEAD/OPTIONS reach no mutating handler.
- Every workspace D1 statement is batched with an identity assertion ([admission](../src/workspace-identity/admission.ts)); `tests/workspace-admission.mjs` revokes a session mid-request and proves the commit is refused. This replaces the deleted `tests/owner-credential-authority.mjs` that the October 1 A1 record cites.
- Only four direct route blocks call `requireFreshWorkspace`: visitor-access POSTs, Cloudflare OAuth start, GitHub OAuth start, and the `/api/chat`/`/api/chat/actions` POST block (only for a `recentAuth` control). Seven typed controls are `recentAuth` (specification and service-client apply, module activation and staff-role apply, app restore, app maintenance, GitHub grant confirm); no `confirm:*` kind is. GitHub grant confirm also calls it inside the domain function.

### Model-confirmation boundary

No path was found from model output or plain Chat text to a confirmation. Plain `POST /api/chat` rejects an `action` key and sends every `/command` to the model; the only non-model conversation path is a transcript or usage-review phrase, which cannot match any `/verb` parser (every confirm parser is `^`-anchored or compares the exact first token). Model JSON is validated by prepare-only allowlists. Evidence: `tests/natural-chat.mjs` (literal `/confirm` inert, model-emitted confirm rejected, injected control shapes rejected, foreign control ineffective) and per-family model-refusal tests. Five confirm triggers do not themselves require a typed control (R2), so this routing is the only guard for those kinds.

## Findings (reproduced)

Severity reflects the current private, invitation-only test with a sole tester. None crosses tenant data confidentiality or integrity. Remediation needs owner sign-off; no `src/` or schema was changed in this slice. The reproductions are expected to exit 1 while the defect exists and are deliberately **not** in `package.json` scripts or any `tools/verify.mjs` profile. B3 has since been fixed on `main` by #178, so its reproduction now passes as a regression.

### B1 Platform-wide review capacity can be exhausted by one owner (low; availability, cross-tenant)

Each owner review table has a per-project cap of 100 **and a platform-wide cap of 1,000** (for example `backend_form_reviews`, `app_page_reviews`, `app_activation_reviews`, `backend_publication_reviews`, `backend_state_reviews`, `app_restore_reviews` in [`schema/platform.sql`](../schema/platform.sql)). Rows are never deleted while the project exists (delete guards; no cleanup in `src/`, `tools/` or the schema), and `tools/report-maintenance.mjs --counters` does not monitor these tables. An enrolled owner needs only their own projects (20 allowed) to fill a table; reviews need not be confirmed.

- **Reproduction (executed):** `node tests/boundary-review-capacity.mjs` (SQLite) and `--d1` (local D1). Owner A prepares 999 "form off" reviews across 10 of their own projects; owner B's next form review then fails with `409 Form review unavailable: ... review storage is full`. Expected: B unaffected.
- **Consequence traced in source (not executed):** safety withdrawal prepares a new `backend_publication_reviews` or `app_page_reviews` row ([`src/service-safety.ts`](../src/service-safety.ts)), so a full table blocks every owner's withdrawal and unpublish of those services. The per-project 100 is also a lifetime limit.
- **Remediation ownership:** platform schema/capacity maintainers, with an owner decision. Options: count only pending, unexpired reviews toward capacity or expire/prune terminal reviews; per-account caps; exempt withdrawal reviews; add these tables to the counters report. Any trigger change is a schema change requiring a coordinated cutover (`docs/releases.md`). Related: the open "public resource exhaustion" scale gate in [security-risk-actions.md](security-risk-actions.md).

### B2 Runbook says withdrawal/disconnect controls need recent authentication; the code does not (low; documentation/contract mismatch) — resolved October 8, 2026 by correcting the runbook

[`docs/incident-runbooks.md`](incident-runbooks.md) C10 states that unpublishing a site, disabling the application, disabling a contact form, revoking a visitor, removing a passkey, replacing the recovery kit and disconnecting GitHub/Cloudflare each need "the existing review, recent authentication and rate limits". In code, visitor revocation, passkey and kit changes do; the others do not: `confirm:site`, `confirm:application`, `confirm:contact` and the safety-withdrawal confirm routes accept any current session, and `POST /api/connections/{cloudflare,github}/disconnect` have neither freshness nor a rate limit.

- **Reproduction (executed for site unpublish):** `node tests/boundary-recent-auth.mjs`. A session whose passkey proof is one hour old prepares and confirms an unpublish review; the site goes offline (status 200). The other actions are evidenced structurally by the registry (`recentAuth:false` controls; no `freshnessCall` on those routes).
- **Impact:** these are protective actions; Origin and ownership are enforced. The risk is operational: an incident responder relying on C10 would overestimate the protection, and a stolen-but-valid session can take a site, application or connection offline without a passkey.
- **Resolution:** owner decision, October 8, 2026: correct C10 to match the feature contracts rather than add freshness to protective actions. `docs/incident-runbooks.md` C10 now states which controls need a recent passkey sign-in and that disconnects have no rate limit. `tests/boundary-recent-auth.mjs` is now a passing characterization of the documented behavior (still outside verify profiles). The cell stays `gap (control B2)` in the matrix because the code is unchanged; a future freshness policy (see R4) would change the test and runbook together.

### B3 Guest-preview revoke/delete control applies its effect outside the Chat turn's revision check (low; atomicity/receipt) — resolved October 9, 2026 by #178

Every other typed control appends its effect to the batch that inserts the Chat turn under the expected conversation revision ([`src/chat.ts`](../src/chat.ts)). `guestPreview` controls called `guestPreviewChatCommand` ([`src/guest-previews/bindings.ts`](../src/guest-previews/bindings.ts)), which revoked or deleted immediately, before that batch.

- **Reproduction (executed):** `node tests/boundary-guest-preview-race.mjs`. A delete control is paused before its turn batch while another control from the same owner commits. Before the fix, the delete request returned `409 Your conversation changed` and saved no turn, but the link and its comments were already deleted (exit 1). Expected: a refused request has no effect (as for all other controls).
- **Impact (before the fix):** same owner only, on an action they requested; the reported outcome was wrong and the retry path then returned 404. No cross-tenant effect.
- **Resolution (#178, merged October 9, 2026 UTC):** `guestPreviewChatCommand` now only checks ownership and returns the revoke/delete as a statement guarded by the saved Chat turn (`guestPreviewTurnStatements` in [`src/guest-previews/owner.ts`](../src/guest-previews/owner.ts)); [`src/chat.ts`](../src/chat.ts) appends it to the revision-checked turn batch. `node tests/boundary-guest-preview-race.mjs` now passes as a regression (still outside verify profiles); the maintained regression is `tests/guest-preview-chat-atomic.mjs` (SQLite and `--d1`: stale-revision delete and revoke, fresh, replay, foreign-owner and held-comment cases). The `guest-previews` stale cell is now `evidenced`. Not deployed or live-accepted by this audit.
- **Original remediation note:** Chat and guest-preview maintainers: return the revoke/delete statements to the turn batch like other controls. Source change needs owner sign-off.

## Unverified risks and hardening notes

Not reproduced; recorded so they are not lost. None is claimed to be exploitable.

- **R1 Per-dispatch identity recheck missing on some HTTP provider routes.** `confirm/refresh/disconnect` hosting, GitHub backup review/confirm, both disconnects and the provider read routes call domain functions without `workspaceTransport`, so their outbound fetch does not re-assert identity immediately before dispatch (the Chat path and DNS/billing/grant routes do). The preceding D1 claim is still admitted, so the window is after an identity-checked state transition. Hardening.
- **R2 Five confirm triggers accept any same-user Chat turn.** Publication, version removal, photo removal, contact and contact-notification confirmations do not require `mode='guided'` with a matching `action_json`, unlike directory, domain proof, specification/service-client and module apply. Today only `chat.ts` routing prevents a plain or model turn from confirming them (tested by `tests/natural-chat.mjs`). Defence in depth would add the SQL check.
- **R3 GET side effects reachable cross-site.** `GET /api/site-versions/:id/export` sets the operator-only `fair_use_project_lifecycle.export_prepared_at` signal; `GET /api/chat` and `/api/chat/turns/:id` initialise/reconcile Chat state; `GET /api/files/:id`, CMS WordPress source download and CMS publication-preview images reserve reads from the platform-wide monthly `storage_usage` budget, so repeated owner GETs (throttled only per IP) could also exhaust it for every tenant. With `SameSite=Lax`, a top-level cross-site navigation can trigger these, but the export needs the victim's version UUID. Low value; recorded.
- **R4 Freshness policy is inconsistent across consequential actions.** DNS record creation, hosting creation, backups (possibly to a public repository), application activation, backend publication, backend-state snapshot restore, CMS publish/unpublish/discard/import/setup and Stripe sandbox checkout/portal accept a non-fresh session, while app restore, module/role apply and grant revocation require one. This matches the current contracts; it is a policy question for the owner, separate from B2.
- **R5 Shared provider state couples tenants.** GitHub grant dispatch and connect block on state shared across tenants (an uncertain revocation or token without refresh custody can block others). Appears deliberate (`docs/connection-key-lifecycle.md`); not exercised.
- **R6 Informational.** The direct HTTP GitHub grant confirm skips the per-owner `AUTH_LIMITER` used by the typed control (fresh passkey still required); the contact-notification review has no revision check, so a later Dashboard address change can be overwritten by an older review; a Chat confirm racing a site-safety unpublish can record "unpublished" for zero changed rows; owner `records.remove` through `POST /modules` needs no review or fresh proof (contract says owner only); invitation creation has no idempotency key; `hostingConnections` lists by `user_id` without the project-owner join (read-only); operator safety-case findings are append-only with no expected-current-finding check, so a reviewer can record a decision without having seen a concurrent one (may be intended).
- **Observation (deferred CMS suite, not run).** `tests/cms-owner-uploads.mjs` asserts the reply text `Send /confirm-cms-import`, which no `src/` file emits any more (`src/cms-wordpress-chat.ts` now points to the confirmation button). The owner-deferred CMS suite is expected to fail on that line when it is next run; this is test drift, not a runtime boundary.

### Evidence gaps (code enforces, no test asserts)

Recorded per cell in the registry. Notable: foreign-owner apply of a specification/service-client review; foreign-caller `GET /api/projects/:id/versions`; every `/api/domain-hosting` HTTP route and foreign refresh/disconnect; expiry of DNS, hosting, backup, domain-proof-removal, app-page, backend-form and module reviews; hosting proof-hash change before confirm; upgrade/rollback stale revision; page-review immutability; route-specific cross-origin tests for guest previews, contact messages, contact notifications and shared modules (the global gate is evidenced once and its position is machine-checked for every route); visitor cookie presented to owner routes.

## Verification

Commands run on Node 24.21.0 at `ca17c6a` plus this change (see the WH-004 handoff for exact results). After rebasing onto `main` with #178, the B3 reproduction was re-run and now exits 0:

```sh
node tests/boundary-audit.mjs
node tests/verification-profiles.mjs
corepack pnpm check
node tools/verify.mjs fast
node tools/verify.mjs protection
node tests/boundary-review-capacity.mjs        # B1, expected exit 1
node tests/boundary-review-capacity.mjs --d1   # B1 on local D1, expected exit 1
node tests/boundary-recent-auth.mjs            # B2, characterization (exit 0)
node tests/boundary-guest-preview-race.mjs     # B3, regression (exit 0; fixed by #178)
node tools/roadmap.mjs validate && node tools/roadmap.mjs render --check
git diff --check
```

No remote, Cloudflare, provider or deployment operation was performed; fixtures are synthetic and disposable.

## Remaining WH-004 work

- Owner decision and remediation for B1 (and R2/R4 policy). B2 was resolved by correcting the runbook; B3 was fixed by #178.
- Close the evidence gaps above with focused regressions where the owner wants them.
- Extend the same structural registry to the sites, apps and runtime Workers and scheduled jobs.
- Run the security scan workflow named in the packet against the current commit and reconcile with this registry.
