# Whumpo implementation backlog

> Generated from `backlog.json` by `node tools/roadmap.mjs render`. Edit the JSON source, then render again.

Reviewed 2026-10-01 against source `db8b740ab2346f55f2985593b1ec531a99027630`. 151 planned tasks.

Planning readiness and dependencies describe the plan. Current execution, claims, blockers, and completion evidence live in GitHub Issues. A ready task is only a candidate: verify live dependency completion and authorization before work.

Read the [execution contract](execution.md). Use `node tools/roadmap.mjs next` for candidates and `node tools/roadmap.mjs show WH-001` for an issue body.

# F0 — Reliable delivery foundation

A current evidence baseline and repeatable release, verification and operational controls.

## WH-001 — Reconcile current capability and acceptance evidence

Phase: **Reliable delivery foundation** (F0). Priority: **P0**. Planning readiness: **ready**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A future agent can distinguish source support, configuration, local acceptance and customer availability without reading contradictory historical milestones.

### Scope

- Read the latest feature/release records and current source
- Create one dated capability matrix with superseded-record links
- Reconcile README, acceptance, security risk and Cloudflare catalog summaries; preserve historical evidence

### Acceptance criteria

- [ ] Every MVP requirement has implementation, configuration, local, live and device evidence or an explicit unknown
- [ ] Owner recovery and committed build snapshots are not proposed as missing implementations
- [ ] Scanner holds, CMS and payment deferrals and provider-consent gaps are visible
- [ ] Any fresh remote observation records time and read-only scope without secret values

### Verification

- Check document links and source paths
- Compare current feature contracts and migration inventory
- Do not run provider mutations or treat repository records as fresh live verification

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [README.md](../../README.md)
- [docs/acceptance.md](../../docs/acceptance.md)
- [docs/deployment.md](../../docs/deployment.md)
- [docs/docs-code-sync.md](../../docs/docs-code-sync.md)
- [docs/security-risk-actions.md](../../docs/security-risk-actions.md)
- [docs/cloudflare-capability-roadmap.md](../../docs/cloudflare-capability-roadmap.md)
- [docs/capability-matrix.md](../../docs/capability-matrix.md)
- [docs/releases.md](../../docs/releases.md)
- [docs/maintenance.md](../../docs/maintenance.md)
- [docs/verification.md](../../docs/verification.md)
- [docs/safety-coverage.md](../../docs/safety-coverage.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/3. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 UTC reconciliation against main a3c5461: all 14 MVP checklist rows and later commitments now distinguish source, dated configuration, local/live evidence and device/activation gaps. Recorded release ee62cc7 has four verified Workers, 113 migrations and 16 assets at 04:28:59 UTC; natural hourly/daily maintenance and real stopped-release reconciliation supersede older missing-evidence claims. Current schema inventory verifies 148 tables/31 classes. README, acceptance, risk register and Cloudflare catalog reconciled; old CMS-first priority removed, CSAM/CMS/Stripe deferrals retained. Runtime/source/config files match recorded deployed source 3a9b61b; no new Cloudflare read, journey, security scan, scanner implementation or provider activation. Word v0.9, full customer/device/security/finance/restore acceptance remain explicit gaps. Detailed evidence and completion belong to docs/capability-matrix.md and issue #3.

## WH-002 — Extend release manifests and rehearse partial deployment recovery

Phase: **Reliable delivery foundation** (F0). Priority: **P0**. Planning readiness: **ready**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An operator can recover from a partial four-Worker release without losing CMS bindings or assuming Worker rollback reverses schema.

### Scope

- Build on committed source/build snapshot guards
- Record four Worker versions, asset/source digests, migration set and CMS binding inventory
- Define one current test schema/runtime cutover, obsolete-test reset and partial-release forward recovery; retain no backward reader or old-runtime deployment path

### Acceptance criteria

- [ ] Manifest pins each artifact and migration set before release
- [ ] Injected failure after each Worker step has a documented recovery path
- [ ] Previous artifacts and CMS registrations remain recoverable
- [ ] Destructive migration plans require a separately reviewed restore and compatibility strategy

### Verification

- node tests/build-snapshot.mjs
- Synthetic wrapper/manifest and partial-failure tests
- Run pnpm check only if TypeScript changes; no deployment required for the implementation task

### Dependencies and blockers

Planning dependencies: WH-001. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/deployment.md](../../docs/deployment.md)
- [tools/build-snapshot.mjs](../../tools/build-snapshot.mjs)
- [tools/build.mjs](../../tools/build.mjs)
- [tools/deploy.mjs](../../tools/deploy.mjs)
- [tools/deploy-platform.mjs](../../tools/deploy-platform.mjs)
- [tests/build-snapshot.mjs](../../tests/build-snapshot.mjs)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/releases.md](../../docs/releases.md)
- [tools/prepare-release.mjs](../../tools/prepare-release.mjs)
- [tests/release-manifest.mjs](../../tests/release-manifest.mjs)
- [tests/release-lock.mjs](../../tests/release-lock.mjs)
- [tests/release-bundles.mjs](../../tests/release-bundles.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/39. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: issue #39 holds active release verification work on codex/release-verification. Existing release protocol is implemented; archive/compiler-lock correction and remaining focused checks are unfinished. Alignment does not close or redeploy this work.
- 2026-10-01: archive/compiler-lock correction and WH-002 focused acceptance completed against aca1bc3. New archives retain both compiler locks; build/checker drift and removal refuse; recovered source/assets match the original snapshot; nonempty synthetic registrations/bindings survive all four interrupted Worker steps without duplicate deployment. Build-snapshot, manifest, lease and actual Wrangler bundle round-trip suites passed (all five executable modules, including Wasm). Exact migration/destructive-restore review gates retained. Historical archives remain immutable; no runtime/schema/deployment, CMS functional test or live fault injection. Full recovery drills remain separate. Detailed evidence: docs/releases.md and issue #39.

## WH-003 — Define focused verification profiles and optional free-tier CI

Phase: **Reliable delivery foundation** (F0). Priority: **P0**. Planning readiness: **ready**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Agents can select repeatable checks by changed capability and separate local fixtures from provider/device acceptance.

### Scope

- Map existing suites to feature boundaries and required setup
- Add fast/scoped journey profiles using disposable D1 and ephemeral loopback ports
- Evaluate a minimal GitHub Actions workflow only within confirmed free allowance

### Acceptance criteria

- [ ] Node 24 and pnpm 11 are pinned/documented
- [ ] Default profiles need no live provider credentials and never expose local mode publicly
- [ ] Each profile names time/resource assumptions and what it does not prove
- [ ] CI has concurrency cancellation, bounded time/artifacts and no paid runner or overage activation; local profiles work if CI is declined

### Verification

- Run each newly grouped local profile once with clean disposable state
- Check failures propagate and no port/database state is shared
- Validate workflow syntax if a workflow is added

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [package.json](../../package.json)
- [pnpm-lock.yaml](../../pnpm-lock.yaml)
- [tests/customer-site-journey.mjs](../../tests/customer-site-journey.mjs)
- [tests/customer-app-journey.mjs](../../tests/customer-app-journey.mjs)
- [docs/acceptance.md](../../docs/acceptance.md)
- [AGENTS.md](../../AGENTS.md)
- [docs/verification.md](../../docs/verification.md)
- [tools/verify.mjs](../../tools/verify.mjs)
- [tests/verification-profiles.mjs](../../tests/verification-profiles.mjs)
- [tests/prompt-data-boundaries.mjs](../../tests/prompt-data-boundaries.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/4. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 UTC reconciliation from main edfb974: local fast/site/app profiles and runner checks revalidated through migrations 0001–0113. Fixed a stale prompt-boundary fixture by exercising actual Chat orchestration and bounded message chunking with synthetic transport and in-memory SQLite; runtime policy/limits unchanged. Removed the unused SITE_AI runner flag. Node 24.21.0/pnpm 11.19.0 pins and credential/failure isolation confirmed. Optional CI evaluation selects local-only verification: private repository confirmed; billing usage unavailable with current auth scope, so no workflow or paid usage activated. Full evidence and future activation prerequisites in docs/verification.md and issue #4. No scanner implementation, CMS functional testing, live model calls, deployment or new services.

## WH-004 — Audit current tenant and privileged-action boundaries

Phase: **Reliable delivery foundation** (F0). Priority: **P0**. Planning readiness: **ready**. Kind: verification. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A consolidated evidence matrix covers current owner, visitor, model and provider authority before enrollment grows.

### Scope

- Review mounted APIs and D1 guards for ownership, Origin and session freshness
- Trace publish, activation, DNS, hosting, backup, CMS, billing and deletion reviews
- Use the security scan workflow when executing this dedicated audit; record findings separately from unverified risks

### Acceptance criteria

- [ ] Every reviewed privileged path has entry point, authority, immutable target, replay and stale-state evidence
- [ ] Cross-owner/project/visitor and model-confirmation bypass attempts are covered
- [ ] Reportable findings have reproduction and remediation ownership
- [ ] No claim of exhaustive security follows merely from old green tests

### Verification

- Use focused existing authorization and concurrency suites selected by the audit
- Add only regression tests for concrete uncovered boundaries
- Review against docs/security-risk-actions.md

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/security-risk-actions.md](../../docs/security-risk-actions.md)
- [src/index.ts](../../src/index.ts)
- [src/app-gateway.ts](../../src/app-gateway.ts)
- [src/publications.ts](../../src/publications.ts)
- [src/domain-hosting.ts](../../src/domain-hosting.ts)
- [src/github-backups.ts](../../src/github-backups.ts)
- [src/billing.ts](../../src/billing.ts)
- [schema](../../schema)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/5. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-006 — Add privacy-safe operational health and maintenance diagnostics

Phase: **Reliable delivery foundation** (F0). Priority: **P0**. Planning readiness: **ready**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Operators can see stuck work and failing maintenance before customers report it.

### Scope

- Inventory scheduled cleanup, revocation, receipt reconciliation and provider jobs
- Record per-job last success, backlog age, duration and sanitized failure category
- Expose a private operator report with links to exact resumable operation IDs

### Acceptance criteria

- [ ] One failing job does not hide the status of other jobs
- [ ] Overdue cleanup and unknown operations appear as actionable states
- [ ] Reports contain no tokens, raw source, media or conversation text
- [ ] Telemetry failure does not create customer charges or grant action authority

### Verification

- Inject independent job failures and verify last-success/backlog results
- Check private authorization and redaction using synthetic markers
- pnpm check if source changes

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [src/index.ts](../../src/index.ts)
- [src/standard-ai-recovery.ts](../../src/standard-ai-recovery.ts)
- [docs/deployment.md](../../docs/deployment.md)
- [docs/standard-ai-accounting.md](../../docs/standard-ai-accounting.md)
- [docs/maintenance.md](../../docs/maintenance.md)
- [tools/report-maintenance.mjs](../../tools/report-maintenance.mjs)
- [tools/maintenance-inventory.mjs](../../tools/maintenance-inventory.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/6. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01T03:21:25.142Z: read-only live report confirms natural daily run at 03:17:59.757 UTC, all configured daily jobs complete, unconfigured GitHub/hosting skipped, and prior hourly health complete. All 27 queues and five receipt families readable; 26 queues empty, one known historical AI hold still actionable. No manual cleanup/retry or new automation. Three offline maintenance suites pass against 113 migrations. Acceptance complete; see docs/maintenance.md and issue #6. This is scheduler/diagnostic acceptance, not provider activation, scanner detection, or a waiver of unresolved work.

## WH-120 — Remove existing legacy compatibility paths

Phase: **Reliable delivery foundation** (F0). Priority: **P0**. Planning readiness: **ready**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Whumpo has one current runtime/API/client path with retired versions, aliases and plan modes removed.

### Scope

- Require the current authenticated account UUID and remove email/missing-account compatibility behavior
- Remove obsolete DNS aliases and update callers to current handlers
- Retire legacy Launch/Studio admission, test-credit interfaces and silent unknown-plan substitution by deleting obsolete test data; no preservation migrations
- Replace historical-command presentation and page-conversion dependencies with current typed action and specification paths
- Consolidate CMS shapes and active release/identity/native plans under current-version-only rules; preserve the separate owner-deferred CMS functional-testing boundary
- Split implementation into concrete reviewed slices while keeping this parent open until the full removal inventory and required test deployment are verified
- Reconcile offline logical-resource read/restore schema lists and placement contracts with strict current-version admission; historical evidence is not a legacy adapter

### Acceptance criteria

- [ ] No retained runtime path supports an obsolete schema/client/route/alias or retired entitlement; unknown and stale inputs reject explicitly
- [ ] Current project creation/editing, typed approvals, tenant ownership, accounting and uncertain-operation identity remain correct through forward changes
- [ ] Documentation and roadmap describe current-only rollout; historical evidence is not interpreted as an active compatibility obligation
- [ ] Focused actual-handler checks cover removed branches and current behavior, and required test deployment is separately verified

### Verification

- Run focused current interface, billing, Chat and compiler/adapter tests for each touched path; do not run deferred CMS functional tests
- Run pnpm check/build for TypeScript/UI changes and roadmap validate/alignment/render/render --check/diff checks
- Inspect current source and test deployment for each inventory entry; keep partial/local completion distinct from complete/deployed cleanup

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/current-version-policy.md](../../docs/current-version-policy.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [src/plans.ts](../../src/plans.ts)
- [src/billing.ts](../../src/billing.ts)
- [frontend/src/chat-reply.tsx](../../frontend/src/chat-reply.tsx)
- [src/cloudflare-dns.ts](../../src/cloudflare-dns.ts)
- [src/project-specification/store.ts](../../src/project-specification/store.ts)
- [src/cms-content-shape.ts](../../src/cms-content-shape.ts)
- [frontend/src/lib/api.ts](../../frontend/src/lib/api.ts)
- [frontend/src/workspace.tsx](../../frontend/src/workspace.tsx)
- [tests/current-interfaces.mjs](../../tests/current-interfaces.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/53. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 owner amendment: remove existing legacy fallbacks and assume current clients/schemas only. WH-105 strict client contract merged in PR #52. Runtime inventory and staged removal tracked in issue #53; full cleanup remains in progress.
- 2026-10-01 WH-120 amendment: active planning now requires current-only admission, reviewed obsolete-test resets and forward repair. Legacy identity stages, old-client/module coexistence and old-runtime rollback are not implementation requirements. This is documentation alignment only, not implementation, policy activation or device acceptance.
- 2026-10-01 18:20 UTC: PR #55 current billing reset accepted in test, release 438cdaa6-4ef5-46b8-a8c1-ea3115ef61af source 75e41ff. Four Worker readbacks, 117 schema files, eight retired tables absent, authenticated API checks and 18 exact frontend assets passed. Remaining inventory stays open; see docs/current-version-policy.md.
- 2026-10-01: offline logical-resource current-only contract verified with 60 checks. Identity/native/module/data plans and this reference are aligned; Chat producer/presentation, website specification creation and CMS shape cleanup remain open.
- 2026-10-01: current website source replaces legacy import, launch/full-page writers and guided creation with atomic schema-2 first saves plus exact reviewed changes/restores, including photos. Current compiler identities replace old implementations; stale snapshots reject. Schema 0119 and the client/platform/site cutover await deployment/reset. Parent stays open for remaining CMS shape inventory and deployment acceptance; see docs/project-specification-storage.md.
- 2026-10-01: website source merged as PR #60, merge 430065bae840868869497c32f4ae289c33f48b54. CMS source cleanup removes status-bearing edit bodies/recovery and incomplete provenance/report shapes. Only source/type/build and fixture syntax verification is performed for CMS; functional testing stays deferred. Coordinated current test cutover remains pending.
- 2026-10-01 20:34 UTC: current-only removal inventory completed in test release 925bb8a8-12b2-44f5-807a-251ab85a5905, source 56cf575. All four Worker identities/bindings, 119 schema files, 17 new/replaced schema objects, 18 asset hashes, foreign-key and anonymous access checks pass. Real Muse/HTTP current first draft, reviewed edit, forward restore, exact retry and ephemeral account cleanup pass. No old content required conversion/deletion; retired guided state cleared and owner uncertain AI receipt retained. CMS cleanup has source/type/build/syntax verification only; CMS functional testing stays deferred. See docs/current-version-policy.md#current-contract-test-release.
- 2026-10-01 current identity release foundation: review v3/archive v2 pins the complete 156-table schema and exact database bindings, removes numbered SQL replay from deployment/local initialization, refuses occupied or active-database reset targets, and initializes only a distinct empty database. Actual local D1/SQLite catalog and current identity invariants, no-write reinitialization, drift refusal, release interruption/no-replay and build/lifecycle checks pass. No remote mutation; fixture/operator conversion, external cleanup, new database selection, coordinated live cutover and owner/device acceptance remain open in #72. See docs/releases.md and draft PR #79.
- 2026-10-02: Removed 120 retired platform migrations and preservation-only fixture; complete-schema initialization passes SQLite/local D1. Current content-risk/operator, eligibility, 728 feature-inclusion decisions (SQLite/D1), website specification and signed probe-loader checks pass. Deferred CMS/scanner setup is source-aligned and syntax-checked only, not functionally accepted. Imported exact already-shipped Stripe pricing overlay 18e9e88 as 0c8fa8c and reconciled live JSON. See docs/verification.md and docs/identity-web.md. New empty database selection, coordinated test cutover and physical-device acceptance remain open under #72.
- 2026-10-02: #72 current-only test cutover completed with release 40e45c39-037a-42da-802c-5eacc75bde77 (6c73ac5). New empty D1 has exact 156-table/702-object schema; four Workers, all 39 served assets and binding/secret inventories pass independent readback. Live signed synthetic two-key login, welcome/first-project, logout and revocation pass with fixture cleanup and zero inference. Mobile entry screenshot inspected. Old test account/database and PASSWORD_PEPPER retired, remaining script/bindings unchanged; fresh owner invite saved privately. Physical-device enrollment, human Turnstile/live recovery and native/parent beta gates remain open. CSAM, Daybreak and CMS testing remain deferred. See docs/identity-web.md final release evidence.

## WH-052 — Choose durable job orchestration from current requirements

Phase: **Reliable delivery foundation** (F0). Priority: **P1**. Planning readiness: **ready**. Kind: decision. Size: S.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Background safety, cleanup and notification work gets one justified durable execution approach.

### Scope

- Compare existing D1/cron receipts with Cloudflare Queues and Workflows for concrete job classes
- Document at-least-once delivery, retries, idempotency, dead letters, cancellation and unknown external outcomes
- Prepare an ADR with cost/entitlement verification and a small synthetic prototype plan
- Freeze one reusable job/outbox envelope for tenant/actor/purpose, input/version, lease/fencing, cancellation, operation/readback and delivery status. WH-036/068/069/074/086 provide adapters, not independent retry or authority engines.
- Consume WH-071 logical resource/version identities and WH-113 actor/restricted-session rules in the shared envelope. Recheck current dispatch authority; job claims and restored receipts never create normal session or provider authority.

### Acceptance criteria

- [ ] Selected design preserves existing immutable receipts and does not assume exactly-once external effects
- [ ] Polling cost, latency, throughput, retention and operator recovery are explicit
- [ ] No service is provisioned by the decision document
- [ ] Use simpler existing machinery if it meets measured requirements
- [ ] Existing D1/cron ADR and prototype are reconciled before new implementation; contract examples cover platform email, deterministic rules and owner push without activating their providers or requiring their completed clients.

### Verification

- Read official Cloudflare delivery/retry/pricing docs as of execution date
- Trace two jobs: uncertain scan response and resumable account cleanup
- No provider calls required

### Dependencies and blockers

Planning dependencies: WH-071, WH-113. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/cloudflare-capability-roadmap.md](../../docs/cloudflare-capability-roadmap.md)
- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/account-closure.md](../../docs/account-closure.md)
- [src/index.ts](../../src/index.ts)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [tools/prototypes/job-journal.mjs](../../tools/prototypes/job-journal.mjs)
- [tests/job-journal-prototype.mjs](../../tests/job-journal-prototype.mjs)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/workload-placement.md](../../docs/workload-placement.md)
- [docs/job-envelope.md](../../docs/job-envelope.md)
- [tools/prototypes/job-envelope.mjs](../../tools/prototypes/job-envelope.mjs)
- [tests/fixtures/job-envelope.mjs](../../tests/fixtures/job-envelope.mjs)
- [tests/job-envelope-contract.mjs](../../tests/job-envelope-contract.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/11. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-09-30 source/local evidence: docs/background-jobs.md selects D1-owned receipts and bounded scheduled passes initially, with dated provider cost/retry/retention comparison. File-backed SQLite prototype tests pass for uncertain scans and resumable cleanup; production D1 integration, connected load evidence and provider/operator activation remain separate gates. No new service or schedule enabled.
- 2026-10-02 UTC: WH-052 reconciled against current workspace identity and WH-071 resource pins. docs/job-envelope.md freezes bounded current envelopes, domain/attempt/delivery identity, current-authority requirements and synthetic email/rule/push examples. Passed 40 envelope cases, 60 placement cases and file-backed SQLite outbox/restart/fencing/uncertain-effect/cancellation/expiry/cleanup checks. Public Cloudflare cost/retry/retention facts refreshed; current maintenance readback at 04:44:30 UTC returned no recorded passes, so no load/capacity claim. D1 scheduled passes remain the initial design; no runtime dispatcher, new service, provider/scanner call or schedule change. Implementing adapters retain D1/current-authority/load/activation gates.

# F1 — Safe customer beta

Operated safety, privacy, identity, recovery and lifecycle for explicitly supported customer journeys.

## WH-005 — Accept owner and visitor identity on physical devices

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **blocked**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Actual customers can enroll, return, recover and revoke credentials across supported devices.

### Scope

- Prepare a desktop/mobile browser matrix and disposable invited identities
- Exercise native owner and visitor passkeys plus human Turnstile
- Exercise the new restricted owner recovery flow, reviewed lost-key selections, two replacement passkeys for lost-all-keys recovery and response-loss guidance; preserve separate visitor identity/recovery acceptance
- Exercise two-passkey signup after a reviewed obsolete-test reset, unsupported/cancelled second-key prompts, recovery download/printing and current native/browser handoff where supported

### Acceptance criteria

- [ ] Device, OS, browser, date and identity type are recorded for each result
- [ ] Old sessions and selected lost credentials fail after recovery; retained trusted credentials remain usable, the rotated kit works only through restricted recovery, and lost-all-keys recovery admits workspace access only after two replacement passkeys and fresh passkey verification
- [ ] Keyboard, touch and viewport behavior are verified on actual hardware
- [ ] Do not change the owner account or real customer credentials for acceptance
- [ ] Two distinct verified credentials are required at owner signup; duplicate or synchronized copies do not count twice, and no independence is inferred from credential count
- [ ] Incomplete owner setup/recovery cannot reach workspace APIs or a normal native session; visitor acceptance remains under its separate contract
- [ ] Downloads, printing/Save as PDF and optional explanations work accessibly on the supported physical-device/provider matrix using disposable synthetic recovery material

### Verification

- pnpm test:identity-recovery
- pnpm test:app-auth
- Manual real-device checklist plus connected loopback baseline; live disposable account only with exact reviewed scope

### Dependencies and blockers

Planning dependencies: WH-001, WH-115. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Human-operated physical desktop/mobile devices and an approved disposable live identity are required for the remaining acceptance.

### References

- [docs/owner-recovery.md](../../docs/owner-recovery.md)
- [docs/onboarding.md](../../docs/onboarding.md)
- [docs/app-data.md](../../docs/app-data.md)
- [tests/identity-browser.mjs](../../tests/identity-browser.mjs)
- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/workspace-identity.md](../../docs/workspace-identity.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-007 — Write and exercise incident, spend and provider-outage runbooks

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An operator can contain an outage or cost spike while preserving receipts and customer recovery access.

### Scope

- Define incident ownership, severity, escalation and customer communication drafts
- Cover provider outage, key compromise, runaway cost, public abuse and failed maintenance
- Separate platform emergency controls from financial fair-use Monitor
- Include stolen recovery kits, passkey/provider compromise, application-encryption key loss/rotation and safe containment across browser/native sessions

### Acceptance criteria

- [ ] Each runbook has detection, containment, reconciliation, recovery and evidence steps
- [ ] Kill switches stop new risky work without erasing data or uncertain holds
- [ ] Existing paid resource authorization and new service approvals are distinct
- [ ] A tabletop drill records recovery gaps and owners without sending external messages
- [ ] Runbooks distinguish account recovery from encrypted-content recovery, preserve needed reconciliation keys and revoke compromised credentials without waiting for a two-key count

### Verification

- Synthetic outage and alert tests
- Tabletop trace of one cost spike and one lost provider response
- Verify credentials and customer content never enter incident artifacts

### Dependencies and blockers

Planning dependencies: WH-006, WH-113. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/security-risk-actions.md](../../docs/security-risk-actions.md)
- [docs/deployment.md](../../docs/deployment.md)
- [docs/standard-ai-accounting.md](../../docs/standard-ai-accounting.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/incident-runbooks.md](../../docs/incident-runbooks.md)
- [docs/incident-tabletop.md](../../docs/incident-tabletop.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/105. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04: runbooks (docs/incident-runbooks.md) and a written desk-check (docs/incident-tabletop.md) added against source 1343111; documentation only, no live drill, deployed control, alert injection or external message. Offline suites for maintenance, standard AI recovery, secret custody, release manifest and identity recovery passed on Node 22.22.0 (repository requires 24). Open: live/facilitated exercise, alert delivery, per-tenant operator controls, stolen-kit takeover path, off-device key custody and counsel/restricted safety handling (gaps G1-G12). Acceptance not complete.

## WH-008 — Prove control, object and app disaster recovery in isolation

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Recovery covers the whole platform state needed by supported beta workloads, with measured loss/time bounds.

### Scope

- Define proposed RPO/RTO before the drill
- Inventory D1, private R2, immutable versions, Worker artifacts, vault keys and provider references
- Restore synthetic control/app/site state to isolated resources and reconcile publication and identity state
- Include recovery-key verifiers, credential/session revocation, encryption-key versions/custody and interrupted current key rotations/cutovers in the isolated restore inventory
- Accept the integrated restore only after WH-117 storage/key changes. WH-117 can run focused disposable key/reset checks first; those checks do not replace this complete recovery drill.

### Acceptance criteria

- [ ] Restored objects match digests and control pointers; missing keys/artifacts fail visibly
- [ ] Restored services stay fenced from customer traffic; publication/identity differences and missing revocation/deletion reconciliation are recorded for WH-019 rather than treated as accepted recovery
- [ ] Measured RPO/RTO and untested provider assumptions are recorded
- [ ] Customer traffic switching and paid isolated cloud resources remain separately reviewed actions
- [ ] Missing encryption keys fail visibly; restoring a backup does not constitute authority to reactivate old recovery kits, revoked credentials or deleted content, and reconciliation gaps remain explicit

### Verification

- Disposable D1/R2 and real QuickJS drill using synthetic data
- Restore uncertain-operation and revocation records without dispatch; inventory reconciliation gaps for WH-019
- Compare with Cloudflare Time Travel guarantees rather than assuming complete backup

### Dependencies and blockers

Planning dependencies: WH-002, WH-007, WH-009, WH-117. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/deployment.md](../../docs/deployment.md)
- [docs/app-data.md](../../docs/app-data.md)
- [docs/account-closure.md](../../docs/account-closure.md)
- [docs/emdash.md](../../docs/emdash.md)
- [tools/verify-cms-recovery.mjs](../../tools/verify-cms-recovery.mjs)
- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-009 — Define retention, deletion and account-export contracts

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **ready**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Lifecycle implementation has an explicit promise for active data, backups, provider resources and restricted preservation.

### Scope

- Extend the existing closure inventory into a documented data/resource ownership map
- Draft export format, retention classes, deletion tombstones and unresolved-operation treatment
- Identify owner/legal decisions without asserting compliance
- Include guest links/comments, brand/section assets, lead records, staging data, connector-derived data and operation receipts in lifecycle classes

### Acceptance criteria

- [ ] All owner/visitor/CMS/provider/media/safety/billing data classes have purpose, retention and deletion authority
- [ ] Customer-owned repositories/zones are never implicitly deleted
- [ ] Backup expiry and restored-data suppression are explicit
- [ ] Decision record distinguishes proposed terms from owner-approved policy and names remaining legal review
- [ ] Define new retention/export/deletion and uncertain-operation treatment; do not silently extend 30-day contact retention or copy provider data into model history

### Verification

- Cross-check schema foreign keys, cleanup jobs and account-closure inventory
- Use synthetic inventories only
- Review existing recorded provider retention documentation before promises

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/account-closure.md](../../docs/account-closure.md)
- [docs/app-data.md](../../docs/app-data.md)
- [docs/version-retention.md](../../docs/version-retention.md)
- [docs/content-safety.md](../../docs/content-safety.md)
- [tools/account-closure-inventory.mjs](../../tools/account-closure-inventory.mjs)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/data-lifecycle.json](../../docs/data-lifecycle.json)
- [tools/lifecycle-catalog.mjs](../../tools/lifecycle-catalog.mjs)
- [tests/lifecycle-catalog.mjs](../../tests/lifecycle-catalog.mjs)
- [tests/account-closure-inventory.mjs](../../tests/account-closure-inventory.mjs)
- [tests/specification-journey.mjs](../../tests/specification-journey.mjs)
- [tests/service-client-activation.mjs](../../tests/service-client-activation.mjs)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)
- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/7. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-09-30 source/local evidence: commit 2dcbb7a adds a proposed lifecycle contract and explicit catalog covering all 133 control tables across 29 classes; schema and account-closure inventory checks passed with 107 migrations. Retention choices remain proposed; no closure/export activation or legal-compliance claim. See docs/data-lifecycle.md.
- 2026-10-01 UTC reconciliation against source 0002632 / migrations 0001–0113: all 148 tables classified into 31 groups, including full configuration copies, separate save/activation receipts and planning provenance; 21 direct non-cascading owner references identified. Read-only closure inventory includes the new retained records. Lifecycle catalog, account-closure inventory, specification journey and service-client activation tests passed with synthetic local data; future guest/brand/lead/staging/connector requirements are explicit. Cloudflare retention references rechecked. Policy choices remain proposed; no live data access, runtime deployment, provider activation or deletion was performed. Execution/completion evidence belongs in issue #7.
- 2026-10-01 alignment: foundation completion remains historical. WH-116 and each new Chat/module/connector/member feature must register new data classes, retention/export/deletion and key custody; they do not inherit complete coverage from issue #7.

## WH-010 — Map safety coverage and specify the remaining fail-closed boundaries

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **ready**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Every intake, model, execution, preview, export, publication and serving path has a named safety requirement and missing coverage is visible.

### Scope

- Inventory profile/project/CMS media, WordPress sources, pasted/generated/imported code, generated pages and visitor inputs
- Map existing scan tickets, sticky decisions and reviewed risk evidence to callers
- Specify mandatory versus supplemental checks and explicit rejection/reset of obsolete test artifacts

### Acceptance criteria

- [ ] Each format/path identifies exact-byte/context binding, required checks, failure behavior and invalidation
- [ ] Quarantine triage, scanner receipts and actual detection are distinct
- [ ] No model refusal or customer risk score grants approval
- [ ] CMS safety design can proceed while owner-deferred CMS feature testing remains paused

### Verification

- Trace mounted handlers and serving aliases against docs/content-safety.md
- Use only benign synthetic fixtures
- List concrete missing tests without claiming detectors are configured

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/content-safety.md](../../docs/content-safety.md)
- [src/photo-safety.ts](../../src/photo-safety.ts)
- [src/photo-scan-results.ts](../../src/photo-scan-results.ts)
- [src/backend-imports.ts](../../src/backend-imports.ts)
- [src/content-screening-decisions.ts](../../src/content-screening-decisions.ts)
- [src/content-risk-evidence.ts](../../src/content-risk-evidence.ts)
- [src/site-host.ts](../../src/site-host.ts)
- [src/cms-media.ts](../../src/cms-media.ts)
- [docs/safety-coverage.md](../../docs/safety-coverage.md)
- [docs/project-specification.md](../../docs/project-specification.md)
- [docs/project-specification-storage.md](../../docs/project-specification-storage.md)
- [docs/project-service-clients.md](../../docs/project-service-clients.md)
- [src/specification-safety.ts](../../src/specification-safety.ts)
- [src/project-specification/service-clients/activation.ts](../../src/project-specification/service-clients/activation.ts)
- [src/agent-knowledge.ts](../../src/agent-knowledge.ts)
- [tests/specification-journey.mjs](../../tests/specification-journey.mjs)
- [tests/service-client-activation.mjs](../../tests/service-client-activation.mjs)
- [tests/natural-chat.mjs](../../tests/natural-chat.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/8. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 UTC source/local reconciliation against 4e91a8b through migrations 0001–0113: docs/safety-coverage.md inventories 17 path families, actual screening/risk callers, known specification/service holds, mandatory versus supplemental checks, legacy/context gaps and concrete WH-011–017 handoff. Agent safety knowledge now accurately states the unconfigured detectors and remaining coverage gaps. pnpm check/build, specification journey, service-client activation, natural Chat, 68 local document references and roadmap validation/render checks passed. Benign scripted fixtures only; no detector, CMS feature testing, provider activation or safety-launch acceptance. Release and completion evidence belongs in issue #8 and the coverage document.
- 2026-10-01 UTC test release 20d37ba0-fca6-4003-a9c8-280f2b23edff from source 3417ea2 deploys the corrected agent knowledge. Readback verified four candidate versions, unchanged service/secret-binding names and CMS registry, 113 applied migrations / none pending, 16 matching platform assets, home/health 200 and anonymous Chat/profile 401. See docs/safety-coverage.md and docs/releases.md. No real-model moderation evaluation, detector connection, CMS functional test or customer publication.

## WH-011 — Select and authorize moderation providers and response operations

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **deferred**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Private intake has reviewed detector coverage, terms, cost and a responsible incident operator.

### Scope

- Compare vetted known-CSAM matching, separate sexual-content checks and text/code moderation
- Review supported formats, private submission, residency/retention, provider errors and references
- Prepare exact enrollment/service/notification configuration for owner review

### Acceptance criteria

- [ ] Coverage matrix includes inconclusive/unsupported formats and transformed copies
- [ ] Current prices, minimums and eligibility are verified before commitments
- [ ] Qualified legal review owns reporting/preservation procedures; no compliance claim from a classifier
- [ ] No suspected illegal material enters agents, GitHub, fixtures or general logs; Cloudflare cache scanning is only an additional delivery layer

### Verification

- Official provider documentation and synthetic API contracts
- Dry-run credential and webhook/authentication design without secret values
- Record provider enrollment and responsible-operator blockers explicitly

### Dependencies and blockers

Planning dependencies: WH-010, WH-009. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Owner decision, 2026-10-01 UTC: CSAM scanning is planned only. Skip scanner implementation, provider enrollment and activation until explicitly resumed; dependent scanner work must not proceed around this deferral.
- Provider eligibility/access, data-processing terms, budget and responsible safety/legal operator need owner decisions; no provider is currently accepted.

### References

- [docs/content-safety.md](../../docs/content-safety.md)
- [src/photo-scan-results.ts](../../src/photo-scan-results.ts)
- [docs/safety-coverage.md](../../docs/safety-coverage.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/21. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 UTC owner deferred CSAM scanning before implementation delivery. Unused uncommitted response helper/test and unfinished provider proposal removed; no scanner/provider deployment or activation. Issue #21 remains open and unclaimed for future planning. Existing quarantine/hold foundations are not detector coverage or safety-launch acceptance.

## WH-012 — Implement bounded private scan dispatch and result reconciliation

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Photo approval results come from authenticated providers over exact private bytes with durable retry and unknown-outcome handling.

### Scope

- Extend existing reservations/results rather than minting a second approval system
- Implement durable jobs, attempt caps, backoff, orphan recovery and quota housekeeping
- Bind provider request/reference, digest, policy and complete required checks

### Acceptance criteria

- [ ] Changed/expired/deleted targets and old tickets cannot release content
- [ ] Timeouts and conflicting callbacks remain held until reconciled
- [ ] Retries cannot rerun a billable uncertain request or exceed bounded attempts
- [ ] Real provider canary uses approved benign/reference fixtures and separately reviewed configuration

### Verification

- node tests/photo-scan-results.mjs
- node tests/current-schema.mjs
- Injected timeouts, response loss, stale approvals and concurrent jobs
- Provider canary only after the concrete activation review

### Dependencies and blockers

Planning dependencies: WH-010, WH-011, WH-015, WH-052. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/content-safety.md](../../docs/content-safety.md)
- [src/photo-scan-results.ts](../../src/photo-scan-results.ts)
- [src/photo-safety.ts](../../src/photo-safety.ts)
- [tests/photo-scan-results.mjs](../../tests/photo-scan-results.mjs)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-013 — Extend exact-artifact media holds to CMS and all delivery aliases

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

CMS and imported media cannot bypass the safety requirements applied to profile/project photos.

### Scope

- Apply the approved coverage contract to CMS uploads, WordPress assets, previews, export and public/custom-host delivery
- Keep original/transformed bytes and policy identity linked
- Design current artifact holds and revocation; reset obsolete test artifacts without a legacy backfill reader

### Acceptance criteria

- [ ] Pending, missing, stale, incomplete and blocked coverage denies every media alias
- [ ] No quarantined media reaches a general model or active renderer
- [ ] Safety changes do not grant CMS publication or provision a live instance
- [ ] Implementation/benign local safety verification is separated from owner-deferred CMS feature acceptance

### Verification

- Focused synthetic byte/digest/alias tests
- pnpm check
- Keep live CMS testing paused until owner resumes it

### Dependencies and blockers

Planning dependencies: WH-010. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/emdash.md](../../docs/emdash.md)
- [src/cms-media.ts](../../src/cms-media.ts)
- [src/cms-import-media.ts](../../src/cms-import-media.ts)
- [src/cms-publication-media.ts](../../src/cms-publication-media.ts)
- [src/cms-media-preview.ts](../../src/cms-media-preview.ts)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/137. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-014 — Gate generated and imported code/content across execution and publication

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Pasted source, generated pages/backends and alternate APIs cannot bypass mandatory checks or sticky supplemental requirements.

### Scope

- Connect persisted screening requirements to immutable actions and trusted completion receipts
- Define a narrowly reviewed import promotion path only after full required coverage exists
- Recheck requirements in final action/publication transactions

### Acceptance criteria

- [ ] Concurrent risk escalation or policy change cannot race an unchecked artifact into use
- [ ] Unsupported scanner results remain quarantined
- [ ] Agent output and customer requests cannot self-approve or lower scrutiny
- [ ] Bounded QuickJS isolation and owner publication reviews remain required after scanning

### Verification

- node tests/content-screening-decisions.mjs
- node tests/backend-imports.mjs
- Race, policy-change and alternate-entrypoint regression tests
- pnpm test:customer-app-journey with trusted benign fixtures

### Dependencies and blockers

Planning dependencies: WH-010, WH-011, WH-012. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/backend-execution.md](../../docs/backend-execution.md)
- [src/content-screening-decisions.ts](../../src/content-screening-decisions.ts)
- [src/backend-imports.ts](../../src/backend-imports.ts)
- [src/ai-chat.ts](../../src/ai-chat.ts)
- [src/publications.ts](../../src/publications.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-015 — Add restricted safety cases and preservation-aware retention

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Ordinary account deletion cannot erase evidence that a reviewed preservation decision requires retaining.

### Scope

- Build on the reviewed risk evidence ledger with restricted case references and explicit access roles
- Separate customer data lifecycle from case retention and independent corrections
- Design reviewed preservation/release/export operations and audit records

### Acceptance criteria

- [ ] No ordinary account cascade destroys an active preserved case
- [ ] Access attempts and decisions are audited without copying raw imagery into normal logs
- [ ] Uncertain flags remain distinct from confirmed policy findings
- [ ] Legal applicability and retention approval remain named human decisions, not model verdicts

### Verification

- node tests/content-risk-evidence.mjs
- node tests/content-risk-review.mjs
- Synthetic deletion/access/correction/release tests
- Qualified review of proposed operational procedure before live activation

### Dependencies and blockers

Planning dependencies: WH-009, WH-010. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/account-closure.md](../../docs/account-closure.md)
- [src/content-risk-evidence.ts](../../src/content-risk-evidence.ts)
- [tools/review-content-risk.mjs](../../tools/review-content-risk.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/109. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-016 — Deliver abuse intake, policy consent and independent safety review

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers and operators have a usable reporting/correction route independent of ordinary Chat capacity.

### Scope

- Publish versioned acceptable-use and privacy documents after owner/legal review
- Record current policy consent separately from US declaration; reset obsolete test consent fixtures rather than grandfather them
- Implement private intake, triage, notice and independent correction/appeal with delivery evidence

### Acceptance criteria

- [ ] Abuse reporting and legitimate remediation are not classified as violations
- [ ] Reports are tenant-scoped and accessible when Chat/onboarding is unavailable
- [ ] Notice generation is distinct from successful delivery
- [ ] Mandatory reporting stays with the responsible human/operator and restricted process

### Verification

- Authorization, replay, disclosure and support-access tests with benign reports
- Check consent migration and account lifecycle behavior
- Keyboard/mobile intake verification

### Dependencies and blockers

Planning dependencies: WH-015, WH-011. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/usage-review-requests.md](../../docs/usage-review-requests.md)
- [src/content-policy.ts](../../src/content-policy.ts)
- [src/content-risk-evidence.ts](../../src/content-risk-evidence.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-017 — Validate safety coverage, revocation and scanner operations before beta

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Supported beta paths have real operated safety checks and a reliable adverse-finding response.

### Scope

- Run approved benign/provider reference canaries and failure drills
- Measure false positives, incomplete coverage and time-to-resolution in shadow evaluation
- Verify revocation, cache invalidation and exact-content rechecks across hosts

### Acceptance criteria

- [ ] No unsupported path is silently offered to customers
- [ ] Detector coverage and accuracy limitations remain explicit
- [ ] Outage/stale/expired approvals fail closed with recoverable customer status
- [ ] Financial Monitor mode never disables mandatory safety

### Verification

- Coverage-matrix acceptance from WH-010
- Synthetic stale-cache, revocation, policy-change and provider-outage drills
- Document live canary scope, date and account approval separately

### Dependencies and blockers

Planning dependencies: WH-012, WH-013, WH-014, WH-015, WH-016. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/photos.md](../../docs/photos.md)
- [docs/emdash.md](../../docs/emdash.md)
- [src/photo-safety.ts](../../src/photo-safety.ts)
- [src/site-host.ts](../../src/site-host.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-018 — Implement reviewed platform export and resumable account closure

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An owner can export supported data and request closure without losing reconciliation or provider revocation authority.

### Scope

- Add fresh-session exact review and durable stop-new-work closure state
- Resolve unknown usage/provider operations before eligible erasure
- Withdraw services, revoke tokens before erasing keys, and clean owned objects/resources resumably
- Implement export/closure against WH-116/117 data and key custody contracts before acceptance; distinguish platform account export from WH-077 portable project delivery. Future data modules register lifecycle adapters rather than add a second closure/export engine.
- Use WH-052 job/outbox identities, fencing and uncertain-effect recovery for resumable closure; feature-specific deletion receipts remain authoritative. Do not build an independent scheduler or retry engine.

### Acceptance criteria

- [ ] Closure blocks delayed OAuth callbacks and new work
- [ ] Customer-owned GitHub repositories and Cloudflare zones are preserved unless specifically reviewed
- [ ] Legal holds and unresolved operations remain visible with an honest pending state
- [ ] Final receipt survives account cascades and enumerates uncompleted external cleanup

### Verification

- node tests/account-closure-inventory.mjs
- Synthetic lost-response, duplicate, callback-race and provider-timeout tests
- Verify export excludes secrets and other tenants
- pnpm check

### Dependencies and blockers

Planning dependencies: WH-009, WH-015, WH-006, WH-117, WH-052. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/account-closure.md](../../docs/account-closure.md)
- [tools/account-closure-inventory.mjs](../../tools/account-closure-inventory.mjs)
- [src/standard-ai-recovery.ts](../../src/standard-ai-recovery.ts)
- [src/cloudflare-connection.ts](../../src/cloudflare-connection.ts)
- [src/app-lifecycle.ts](../../src/app-lifecycle.ts)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/workload-placement.md](../../docs/workload-placement.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-019 — Reconcile erasure and revocation after restores

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A restored backup cannot resurrect deleted accounts, visitor data or revoked publication/credential authority.

### Scope

- Persist deletion/revocation tombstones outside the deleted scope
- Replay them before restored services can receive customer traffic
- Reconcile external backup expiry, retained documents and object orphans

### Acceptance criteria

- [ ] Old-backup restore preserves closure and visitor deletion decisions
- [ ] Unknown external cleanup stays pending
- [ ] Recovery evidence verifies object and relational erasure scope without promising impossible immediate backup destruction
- [ ] Retention promises match tested provider behavior
- [ ] Combined capture/restore plus tombstone reconciliation is proven before WH-059 and any reviewed traffic switch

### Verification

- Synthetic restore of pre-deletion snapshots and duplicate tombstone replay
- pnpm test:app-lifecycle
- pnpm test:app-document-recovery

### Dependencies and blockers

Planning dependencies: WH-008, WH-018. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/account-closure.md](../../docs/account-closure.md)
- [docs/app-data.md](../../docs/app-data.md)
- [src/app-lifecycle.ts](../../src/app-lifecycle.ts)
- [src/app-document-recovery.ts](../../src/app-document-recovery.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-020 — Benchmark customer outcomes and decide production inference privacy

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **ready**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Model choice and commercial estimates use reproducible completion quality, total task cost and appropriate data handling.

### Scope

- Create representative site/app/edit/unsupported-request/recovery fixtures from synthetic briefs
- Score validated drafts, preserved intent, hallucinated actions, latency and all calls including acknowledgments/failures
- Compare provider data-use terms and define confidential-customer eligibility
- Include backend input/page-form compatibility, clarification quality and honest unsupported-work handling; recheck current concurrent fixes before proposing duplicates

### Acceptance criteria

- [ ] Baseline distinguishes synthetic transport tests from real provider quality
- [ ] Total task cost includes retries/tools/safety/acknowledgments and unknown prices remain unknown
- [ ] Current Muse Contributor training notice is reflected; confidential beta content is not assumed eligible
- [ ] Any paid benchmark or provider switch requires its own exact budget/data review

### Verification

- Use existing connected journey suites as harnesses
- Run offline/synthetic benchmark first
- Record sample size, fixture/model/prompt versions and uncertainty before comparisons

### Dependencies and blockers

Planning dependencies: WH-121. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [docs/standard-ai-accounting.md](../../docs/standard-ai-accounting.md)
- [tests/customer-site-journey.mjs](../../tests/customer-site-journey.mjs)
- [tests/customer-app-journey.mjs](../../tests/customer-app-journey.mjs)
- [src/ai.ts](../../src/ai.ts)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [tools/benchmark.mjs](../../tools/benchmark.mjs)
- [tests/fixtures/customer-benchmark.json](../../tests/fixtures/customer-benchmark.json)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/9. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-09-30: offline benchmark foundation passed seven scripted fixture families with unchanged source manifest; all-call inference receipt accounting and unknown total expense preserved. Provider privacy comparison recorded. No real-provider quality/cost or confidential beta acceptance; see docs/customer-benchmarks.md.
- 2026-10-02 UTC: current seven-family synthetic cohort passed at 9d64b9a with source fingerprint unchanged. The completed offline/privacy deliverable is extracted as WH-121 for WH-116. Parent remains open for the real-provider cohort, quality adjudication and complete cost/uncertainty evidence; no model switch or confidential-beta approval.

## WH-048 — Review and admit a bounded real-customer beta

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: release. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An explicitly scoped invited beta is released only with evidence for safety, privacy, recovery and customer value.

### Scope

- Choose supported website/app paths and a small cohort size based on measured capacity
- Review gate matrix, open risks, support ownership and rollback
- Keep unavailable provider/CMS/payment paths explicitly disabled
- Require WH-117 transparent data-protection acceptance and the WH-113–115 owner identity/recovery policy through WH-005; WH-118 feasibility is outside beta prerequisites

### Acceptance criteria

- [ ] All required gate evidence refers to the candidate release and admitted paths
- [ ] Owner approves customer/data cohort and provider privacy scope
- [ ] No full-MVP claim; waived/omitted features require explicit scope decision
- [ ] Stop conditions and review cadence are recorded before invitations are issued
- [ ] Support/recovery remains reachable when Chat or onboarding fails, with a responsible operator and tested access path
- [ ] Supported visitor/service flows continue with Whumpo maintenance inference unavailable and create zero maintainer requests, reservations or conversation changes; any optional customer runtime AI remains separately scoped
- [ ] Admitted workspace paths enforce passkey-only ordinary login and completed two-key signup/recovery, with one reviewed current-policy cutover and visitor policy kept separate
- [ ] WH-117 protection and current-key/reset/restore evidence covers admitted data/processing paths without claims of end-to-end encryption or a PRF support requirement

### Verification

- Candidate-release connected site/app journeys and auth boundaries
- Real-device evidence plus isolated recovery drill
- Release review only; sending invitations requires explicit instruction

### Dependencies and blockers

Planning dependencies: WH-001, WH-002, WH-003, WH-004, WH-005, WH-007, WH-008, WH-017, WH-019, WH-020, WH-024, WH-025, WH-050, WH-059, WH-035, WH-117. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/README.md](../../docs/roadmap/README.md)
- [docs/acceptance.md](../../docs/acceptance.md)
- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/deployment.md](../../docs/deployment.md)
- [docs/mvp.md](../../docs/mvp.md)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/protection-candidate.md](../../docs/protection-candidate.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: consume WH-117D candidate release 7c4f9344-bd6c-4fc7-a3ab-964e631ad8f3 and docs/protection-candidate.md for exact current schema/bindings/assets, stored-key readback, signed project-first HTTP checks and measured CPU/bytes/storage. This is actual deployed test evidence, not closed WH-117 or beta acceptance: independent/off-device custody, human enrollment/devices, real providers and full recovery retain their separate gates.

## WH-050 — Measure capacity, distributed abuse and tenant fairness

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Enrollment limits reflect tested serving/runtime/D1 behavior and available operating budget.

### Scope

- Load-test contact, site/photo, public backend and visitor paths with synthetic distributed clients locally
- Measure latency, failure rate, D1 work, runtime saturation and noisy-neighbor effects
- Define account-level alerts and conservative cohort admission limits

### Acceptance criteria

- [ ] One tenant cannot consume the entire allowed public execution budget in the tested envelope
- [ ] Traffic serving and recovery remain available after saturation
- [ ] Per-IP limits are not claimed as financial caps
- [ ] Any live load/cost experiment requires an exact bounded plan; no unreviewed cloud load

### Verification

- Local/disposable workload harness with bounded duration
- pnpm test:backend-runtime and related quota/concurrency suites
- Report measured envelope and untested scale assumptions

### Dependencies and blockers

Planning dependencies: WH-006, WH-004. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/security-risk-actions.md](../../docs/security-risk-actions.md)
- [docs/backend-execution.md](../../docs/backend-execution.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [src/backend-publication.ts](../../src/backend-publication.ts)
- [src/runtime/worker.ts](../../src/runtime/worker.ts)
- [src/site-traffic.ts](../../src/site-traffic.ts)
- [docs/workload-placement.md](../../docs/workload-placement.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/111. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 first slice (main ae96716 plus uncommitted work, Node 22.22.0, repository requires 24): local-only synthetic-client harness tools/capacity.mjs (pnpm capacity) and docs/capacity-and-fairness.md. Four synthetic tenants including one noisy tenant drove site, photo, contact, public backend and visitor-application paths over loopback against disposable local D1/R2 and the real QuickJS runtime; recorded latency percentiles, 429/503 responses, runtime bounds, D1 statements per request and a victim-versus-noisy comparison (victim p50 512 to 1084 ms, p95 1129 to 4091 ms; 4 of 120 victim public-backend calls refused busy). One tenant held to its project/account allowances; two filler accounts drained the shared 1,000/day backend budget and a victim under its own cap was refused; a pre-set shared R2 read counter denied every tenant's photos while HTML kept serving. Findings F1-F8 (shared first-come budgets, no admission control on the public site host, global tenant-blind runtime gate, allowances keyed by target, narrow per-IP coverage, time-only recovery, no alerts) are recorded, not fixed. Alerts and cohort limits are proposals pending owner decision. No live load, deployment, Cloudflare or provider contact; figures are not Cloudflare production limits and not cost evidence. Open: owner decision on cohort limits/alerts, remedies for F1-F5, Node 24 re-record, any live experiment (needs an exact bounded reviewed plan). Acceptance not complete.

## WH-059 — Rehearse release rollback and an end-to-end recovery incident

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An operator other than the implementing agent can follow the release and incident procedures successfully.

### Scope

- Use a disposable candidate release with a failed migration-compatible rollout and a lost provider response
- Follow published runbooks without undocumented shortcuts
- Record timings, missing access, stale documentation and next actions

### Acceptance criteria

- [ ] Recovered release serves expected immutable version and maintains privacy/identity boundaries
- [ ] Unknown provider receipts remain held until evidence resolves them
- [ ] No production credentials or traffic are required for the rehearsal
- [ ] Any live drill remains a separate concrete approval

### Verification

- Isolated tabletop plus local/disposable execution
- Inspect manifest, audit and restored digest evidence
- Update runbooks with observed gaps

### Dependencies and blockers

Planning dependencies: WH-002, WH-007, WH-008, WH-019. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/deployment.md](../../docs/deployment.md)
- [docs/standard-ai-accounting.md](../../docs/standard-ai-accounting.md)
- [docs/account-closure.md](../../docs/account-closure.md)
- [docs/roadmap/execution.md](../../docs/roadmap/execution.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-113 — Freeze current workspace identity, recovery, cutover and usability contracts

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **ready**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Implementers have a source-grounded contract for passkey-only ordinary workspace access, two-key enrollment, restricted recovery and a current-only test cutover.

### Scope

- Map current web/session/recovery handlers and planned Android/member access; preserve independent customer-application visitor identity
- Freeze resumable restricted signup/recovery authority, server-side completion checks, invitation handling, recent-authentication rules, expiry, concurrency and normal-session issuance
- Specify two distinct verified signup credentials with optional explanations and independent-storage guidance, without mandatory purchases or proof of provider independence
- Define recovery-kit download/copy/print, save-before-rotation, lost-all-keys and reviewed partial-loss behavior, rotation and emergency revocation below two keys
- Freeze obsolete-test reset, password-route removal, incomplete-current-account treatment and forward recovery without legacy identity stages or reauthorizing revoked credentials

### Acceptance criteria

- [ ] Two-key signup and lost-all-keys recovery, one kit-save acknowledgment and fresh replacement-passkey verification before ordinary recovery completion are explicit; incomplete flows have no workspace/AI/provider/native-session authority
- [ ] Passwords are unavailable after activation; recovery-key possession grants only restricted replacement enrollment and email/support is not an alternative factor
- [ ] Fresh current enrollment and saved-kit recovery are verified after the reviewed reset; invitation/resume/recovery failures preserve current progress and never bypass completion
- [ ] A user can revoke a compromised key below the minimum; ordinary valid sessions require no routine extra prompts and essential help/recovery works without AI
- [ ] Sanitized state/API examples separate account recovery from content-key recovery, include browser/native compatibility and name required real-device evidence; policy acceptance is not implementation acceptance

### Verification

- Trace src/workspace-identity/ceremonies.ts, src/index.ts, frontend/src/identity/flow.tsx and existing recovery/onboarding/native contracts using credential-free examples
- Review duplicate credentials, cancelled second enrollment, competing recovery, lost replies and current-only reset/cutover as state transitions
- Run roadmap validate/render/render --check, local-reference checks and git diff --check

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/owner-recovery.md](../../docs/owner-recovery.md)
- [docs/onboarding.md](../../docs/onboarding.md)
- [docs/android-app.md](../../docs/android-app.md)
- [docs/security-risk-actions.md](../../docs/security-risk-actions.md)
- [src/workspace-identity/ceremonies.ts](../../src/workspace-identity/ceremonies.ts)
- [src/index.ts](../../src/index.ts)
- [frontend/src/identity/flow.tsx](../../frontend/src/identity/flow.tsx)
- [docs/workspace-identity.md](../../docs/workspace-identity.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/42. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: docs/workspace-identity.md freezes the protocol against d415398: separate restricted grants/current account epochs, invitation-safe two-key signup/resume, shared kit prepare/save/commit, reviewed partial/all-loss recovery, fresh replacement assertion, emergency revocation and staged existing-account retirement with compatible rollback. Source and failure-transition review completed; WH-114/115 implementation and physical/live/native acceptance remain separate. No runtime, schema, credential or deployment change. Issue #42 records verification and delivery.
- 2026-10-01 WH-120 amendment: active planning now requires current-only admission, reviewed obsolete-test resets and forward repair. Legacy identity stages, old-client/module coexistence and old-runtime rollback are not implementation requirements. This is documentation alignment only, not implementation, policy activation or device acceptance.

## WH-114 — Implement passkey-only access and resumable two-passkey enrollment

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Workspace signup requires two distinct verified passkeys, preserves incomplete progress and closes password and incomplete-enrollment access paths in one coordinated current-policy test cutover.

### Scope

- Implement the shared server-enforced enrollment/completion policy for workspace owners and future member admission; keep visitor handlers under their existing policy
- Add resumable first/second-key setup, optional passkey/backup explanations and actionable provider/device guidance with no required purchase
- Disable password signup/login/creation in backend and frontend at the reviewed cutover; preserve invitation, eligibility, Turnstile and recent-authentication guards
- Implement the WH-113 current-only test cutover: reset obsolete identities and remove retired routes; reuse deterministic enrollment/recovery/help, with no legacy stage, migration grant or parallel policy
- Allow immediate compromised-key revocation below two and guide replacement without adding repeated prompts to ordinary sessions

### Acceptance criteria

- [ ] Duplicate credential IDs and synchronized copies cannot satisfy two-key completion; do not infer independent storage from two registrations
- [ ] One-key, cancelled, stale and incomplete setup cannot access workspace content, projects, Chat, provider actions or normal mobile sessions through direct APIs or UI
- [ ] Reload, a cancelled prompt, invitation retry and lost verification response resume owned progress without duplicated accounts/credentials or weaker enrollment requirements
- [ ] Backend password routes cannot authenticate, register or add a password under the new current policy; fresh enrollment establishes replacement test access
- [ ] Existing passkey verification, ownership, origin, replay and revocation guards remain effective; ordinary sessions and visitor identity retain their intended behavior
- [ ] Connected synthetic/browser evidence precedes WH-005 physical-device acceptance; no real user credential is changed by automated fixtures

### Verification

- Run pnpm check and focused passkey/profile/onboarding/recovery suites after inspecting fixture setup
- Add meaningful connected D1/handler cases for partial enrollment, direct access bypasses, duplicate credentials, concurrent completion and current-policy test cutover
- Use quality-managed browser checks and inspect desktop/mobile screenshots with synthetic credentials; leave real passkey/provider acceptance to WH-005

### Dependencies and blockers

Planning dependencies: WH-113, WH-004. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/owner-recovery.md](../../docs/owner-recovery.md)
- [docs/onboarding.md](../../docs/onboarding.md)
- [docs/android-app.md](../../docs/android-app.md)
- [src/index.ts](../../src/index.ts)
- [src/workspace-identity/ceremonies.ts](../../src/workspace-identity/ceremonies.ts)
- [frontend/src/identity/flow.tsx](../../frontend/src/identity/flow.tsx)
- [schema/platform.sql](../../schema/platform.sql)
- [src/workspace-identity/schema.sql](../../src/workspace-identity/schema.sql)
- [tools/current-schema.mjs](../../tools/current-schema.mjs)
- [docs/workspace-identity.md](../../docs/workspace-identity.md)
- [docs/identity-authority.md](../../docs/identity-authority.md)
- [docs/identity-ceremonies.md](../../docs/identity-ceremonies.md)
- [docs/identity-kits.md](../../docs/identity-kits.md)
- [docs/identity-recovery.md](../../docs/identity-recovery.md)
- [docs/identity-web.md](../../docs/identity-web.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/68. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 WH-120 amendment: active planning now requires current-only admission, reviewed obsolete-test resets and forward repair. Legacy identity stages, old-client/module coexistence and old-runtime rollback are not implementation requirements. This is documentation alignment only, not implementation, policy activation or device acceptance.
- 2026-10-01: WH-114A #70 implements the isolated current-policy account/attempt/credential/session/grant schema and shared principal/committing guard. WH-114B #71 owns verified ceremonies/enrollment, WH-115 #69 owns shared kits/restricted recovery, and WH-114C #72 connects them for one current-only test cutover. No live schema, auth route, credential or deployment changes; full implementation and acceptance remain open.
- 2026-10-01: #71 adds isolated cryptographic WebAuthn signup, restricted resumption, reviewed key addition, same-purpose reauthentication, current login, one-use challenge/receipt records and bounded cleanup. Target canonical identity inputs remove password fields and retain invitation spending after owner deletion. Kit-bound completion/cancellation and WH-115 recovery remain open; no active route, remote schema, owner credential or deployment changed.
- 2026-10-01: Shared current kit offers, one-time text preparation, exact save acknowledgment, guarded ordinary rotation, two-key/fresh-assertion enrollment completion and authenticated cancellation now complete #71 backend scope and part of #69. Actual cryptographic signup-to-session journeys and 47 refusal/race checks passed on SQLite/local D1; 62 ceremony and 72 authority checks also pass. Restricted recovery, kit delivery UI, shared transport/lifecycle admission and one current-only cutover remain open under #69/#72; no remote or active authentication change.
- 2026-10-01: #69 source now implements current-kit restricted entry, exact all/some/none review, saved-kit securing/revocation, replacement-specific assertion completion, restricted kit rotation and emergency removal including compromised staged keys. It reuses the shared authority, verification, offers and receipts; recovery-commit grants preserve original proof time/expiry. Actual cryptographic journeys and 64 refusal/race checks pass on SQLite/local D1, with 47 kit/62 ceremony/72 authority regressions. Browser kit delivery, HTTP/admission/lifecycle and the coordinated current-only test reset remain open; no remote schema, active auth or deployment change.
- 2026-10-01: #69/#72 now add the isolated current-version HTTP adapter and trusted React identity gate/security flow: strict cookie selection, private bounded/no-store transport, progress reads, logout, two-key setup and reviewed recovery with download/copy/print kit delivery. Twenty-two HTTP refusal cases plus real signed journeys pass on SQLite/local D1; mobile Chromium with virtual authenticators verifies signup, saved-kit resume, lost secure reply, partial recovery, replacement completion and removal. No active platform route, identity schema or owner credential changed. Common HTTP/Chat/provider admission, lifecycle registration, current-only reset and deployed acceptance remain open.
- 2026-10-01: Current source now installs the identity router, identity-before-profile web gate and atomic common workspace admission at HTTP/Chat/provider boundaries. Complete-schema HTTP (36 refusals), workspace admission (21) and feature/provider (37) checks pass on SQLite/local D1; real mobile app signup/welcome/Chat revocation passes. Lifecycle catalog covers 156 tables/37 classes and bounded expiry cleanup. Service-client compiler v3 has a new immutable lock. Remaining fixture/release-schema alignment, remote reset/deployment and owner-device acceptance stay open. No remote mutation.
- 2026-10-01 current identity release foundation: review v3/archive v2 pins the complete 156-table schema and exact database bindings, removes numbered SQL replay from deployment/local initialization, refuses occupied or active-database reset targets, and initializes only a distinct empty database. Actual local D1/SQLite catalog and current identity invariants, no-write reinitialization, drift refusal, release interruption/no-replay and build/lifecycle checks pass. No remote mutation; fixture/operator conversion, external cleanup, new database selection, coordinated live cutover and owner/device acceptance remain open in #72. See docs/releases.md and draft PR #79.
- 2026-10-01 current onboarding follow-through: API, React and canonical SQL require exact non-null question/stage checkpoints; chapter-only client fallbacks are removed. Welcome fixtures now use current admitted identity and full schema. SQLite/local D1 pass private profile/project steps, lost-response/concurrent completion, HTTP gates and identity revocation immediately before commit with no project created. The actual mobile React/WebAuthn journey passes again. Source/local only; full test cutover and physical-device acceptance remain open in #72.
- 2026-10-02 current identity follow-through: billing/plan, subscription, GitHub/Cloudflare connection, token custody, GitHub backup/Chat, TXT/CNAME routing, standard AI cost/history/recovery and signed HTTP/workspace smoke fixtures now use current schemas and admitted owner scopes. Focused SQLite/local D1 suites pass with synthetic providers; no real charges, DNS writes, GitHub backups or inference. The smoke command exercises actual signed identity before workspace isolation/quota/logout. Specific coverage is in docs/verification.md. Remaining older domain/operator fixtures, remote resource reconciliation and coordinated test cutover are still open under #72; no remote mutation or device-acceptance claim.
- 2026-10-02 domains/workspace identity follow-through: fourteen local D1 suites now initialize the complete current schema and use admitted owner scopes for domain proof/removal, synthetic DNS/hosting/Chat, exact operator recovery, specification approvals, project details, dashboard/inspection, health/traffic and Chat history/export. Actual current website transactions replace retired guided fixtures; aged proofs use distinct sessions and fault injection matches committed operations. Exact coverage and synthetic/provider/device boundaries are in docs/verification.md. Remaining fixtures and coordinated remote reset/deployment remain open in #72; no provider activation, CMS functional testing or remote mutation.
- 2026-10-02 maintenance/PWA/asset follow-through: eight additional suites pass with current schemas and authority: three SQLite maintenance tests, freshly built mobile Chromium/D1 PWA acceptance, and four D1/R2 photo/export/version-comparison/removal journeys. Actual scheduled identity expiry preserves unfinished enrollment; overdue reporting now matches the hourly identity schedule. Offline reconnect refuses revoked identity, worker updates preserve drafts, caches contain only four public resources, and screenshots were inspected. Asset/version checks cover tenant isolation, exact downloads, commit-time races and lost replies. No remote reset/deployment, scanner/provider activation or physical-device acceptance; #72 remains open. Exact commands and boundaries: docs/verification.md.
- 2026-10-02 backend/application authority follow-through: fifteen focused current-D1 suites pass for private code/tests/state, exact comparisons and expected-output checks, publication/forms, quarantined imports, activation, signed visitor passkeys/data and 17 visitor-deletion cases. Four loopback HTTP suites run the actual workerd/QuickJS service using current owner cookies and complete schema. Owner, visitor, public and scheduled authority remain separate; operation-matched lost replies and admitted-batch source corruption are verified. Exact scope and remaining fixture/device limits are in docs/verification.md. No remote reset/deployment, scanner/provider activation or CMS functional testing; #72 remains open.
- 2026-10-02 application recovery/lifecycle follow-through: three more complete-schema D1 suites pass for signed visitor signup/export/erasure, sealed document snapshots/restoration, and actual workerd/QuickJS upgrades with retained-program/data restoration. Current owner scopes/cookies authorize typed controls; aged proof uses distinct sessions. Operation-matched lost acknowledgments, atomic rollback, roster/deletion/cancellation fences, metadata-only inventory and zero inference are verified. These current-contract customer data changes do not replay platform migrations. Source/local evidence only; remaining build/design/library/content/operator fixtures, coordinated remote cutover and physical-device acceptance remain open in #72.
- 2026-10-02 reuse/build/planning follow-through: seven complete-schema D1 suites pass for library copies, exact private nomination consent, backend Chat, application builds, focused page design, bounded agent inspection and composition planning. Library/build examples execute in real isolated workerd/QuickJS; inference is synthetic. Same-scope commit, operation-matched lost responses, immutable provenance, plan/revision/owner gates, private-context exclusion and no automatic publication are verified. The connected supported-site fixture uses two model calls and generates zero backend source. The updated live model harness remains unrun. Exact commands/limits: docs/verification.md. Remaining fixture alignment, coordinated remote cutover and physical-device acceptance stay open in #72; no scanner/provider activation or CMS functional testing.
- 2026-10-01: #72 adds six passing complete-schema local D1 suites for contacts, directories/history, publication, current site-agent drafts and first-project site/application handoff. Owner admission and independent public/scheduled authority are preserved; transaction-matched expiry/removal/lost-response cases pass. Competing website fixtures use actual current builders. Directory docs now match natural Chat/typed reviews and zero standard-AI customer debits. Model, runtime and Turnstile transports are synthetic. Remaining observation/operator/service-client/live/deferred fixtures, resource review, coordinated remote cutover and physical-device acceptance remain open. No provider, scanner or CMS functional activation.
- 2026-10-01: #72 adds five passing complete-schema suites for current-cookie profile identity/revocation (SQLite), connection metadata, atomic workspace projects/exports, a four-turn website journey and service authority (local D1). Owner statements share admitted scope; visitor execution uses real isolated QuickJS with maintainer/provider fetch disabled. Model transports and vault/hold metadata are synthetic. Required current photos configuration and transaction-matched lost creation recovery are verified; standard AI remains zero customer debit. No remote cutover, provider/scanner activation or CMS functional testing; remaining observation/operator/live/deferred fixtures and owner/device acceptance stay open.
- 2026-10-01: #72 adds eight passing complete-schema D1 suites for fair-use observation/reviews, private usage support, dormant Gateway spend/dispatch, stored screening requirements, scripted conversation and current signup eligibility. Customer admission and independent operator/ledger authority remain distinct. Actual ES256 registration verifies mandatory declaration/invitation/Turnstile in local/test, enrollment-only grants and atomic receipt-failure rollback/fresh retry. Financial, model, gateway, Turnstile and risk-history inputs are synthetic. No scanner, routing/provider activation or remote cutover. Remaining media/live/deferred fixtures and physical/live acceptance stay open.
- 2026-10-02: #72 adds passing complete-schema local D1/R2 photo-version and removal suites. Current owner admission, private dependency/digest checks, publication withdrawal, portable ZIP/JPEG exports, retained-version races, exact lost-response recovery and delayed orphan cleanup are verified. Ready accounts, images, clearance and domain records are synthetic; no scanner implementation, DNS/provider activation, CMS functional testing or remote cutover. Live/deferred fixtures and physical/live acceptance remain open.
- 2026-10-02: #72 aligns six opt-in model/deployment probes with current schemas/scopes. Shared probe support passes local D1 exact-schema refusal before writes, two signed credentials, current cookie/login/state/logout, onboarding checkpoint, workspace admission, cleanup and all opt-in refusals. Remote probes retain cleanup journals and refuse obsolete deployments. No live model/deployment, scanner or CMS functional acceptance; only deferred-lane obsolete fixture setup, resource reconciliation and coordinated cutover remain.
- 2026-10-02: Removed 120 retired platform migrations and preservation-only fixture; complete-schema initialization passes SQLite/local D1. Current content-risk/operator, eligibility, 728 feature-inclusion decisions (SQLite/D1), website specification and signed probe-loader checks pass. Deferred CMS/scanner setup is source-aligned and syntax-checked only, not functionally accepted. Imported exact already-shipped Stripe pricing overlay 18e9e88 as 0c8fa8c and reconciled live JSON. See docs/verification.md and docs/identity-web.md. New empty database selection, coordinated test cutover and physical-device acceptance remain open under #72.
- 2026-10-02: #72 current-only test cutover completed with release 40e45c39-037a-42da-802c-5eacc75bde77 (6c73ac5). New empty D1 has exact 156-table/702-object schema; four Workers, all 39 served assets and binding/secret inventories pass independent readback. Live signed synthetic two-key login, welcome/first-project, logout and revocation pass with fixture cleanup and zero inference. Mobile entry screenshot inspected. Old test account/database and PASSWORD_PEPPER retired, remaining script/bindings unchanged; fresh owner invite saved privately. Physical-device enrollment, human Turnstile/live recovery and native/parent beta gates remain open. CSAM, Daybreak and CMS testing remain deferred. See docs/identity-web.md final release evidence.

## WH-115 — Implement recovery-kit download and restricted replacement enrollment

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Users can save or print an account recovery kit and replace lost passkeys without recovery secrets granting ordinary workspace access.

### Scope

- Provide high-entropy text-key download, accessible copy and local printer-friendly Print / Save as PDF with concise account/recovery instructions and one save acknowledgment
- Keep recovery secrets out of URLs, QR links, filenames, persistent browser application storage, AI, ordinary logs and analytics; use only verifiers in server storage
- Replace direct recovery-to-session with the WH-113 bounded enrollment authority; require two replacement passkeys and a fresh replacement-passkey assertion for lost-all-keys workspace access
- Preserve reviewed old-key selections, session revocation, rate/origin limits, save-before-rotation, concurrent-attempt isolation and durable interrupted-response recovery
- Implement safe kit replacement/rotation and restricted browser/native handoffs; keep encrypted-content recovery separate from the account kit promise

### Acceptance criteria

- [ ] Download/copy and print/save-PDF paths work with accessible instructions and synthetic secrets; printing is encouraged but never required or presumed successful from a button click
- [ ] Recovery-key proof alone cannot reach workspace data, AI, provider operations or a normal native session; incomplete/abandoned enrollment stays restricted
- [ ] Lost-all-keys recovery completes only with two distinct verified replacement passkeys, saved rotated kit and fresh passkey verification; old sessions, lost credentials and rotated-out kits fail
- [ ] Replay, stale selection, simultaneous rotation, lost final reply and second-key cancellation preserve the winning attempt and a recoverable save-before-rotation path
- [ ] Emergency revocation can reduce the key count; secret values never enter logs/model context/URLs/visual evidence and no kit claims to recover unspecified content-encryption keys
- [ ] Implementation/local acceptance is recorded separately from WH-005 physical-device and approved live recovery evidence

### Verification

- Run pnpm check and inspect/run existing test:identity-recovery and test:identity-ceremonies fixture suites plus focused enrollment/native-handoff cases
- Use connected disposable D1/handler tests for restricted authority, rotation/replay/concurrency, session fencing and response loss
- Use quality-managed browser checks and inspect synthetic text download, print layout and saved PDF on desktop/mobile; manually verify keyboard and screen-reader operation

### Dependencies and blockers

Planning dependencies: WH-114. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/owner-recovery.md](../../docs/owner-recovery.md)
- [docs/onboarding.md](../../docs/onboarding.md)
- [docs/android-app.md](../../docs/android-app.md)
- [src/workspace-identity/ceremonies.ts](../../src/workspace-identity/ceremonies.ts)
- [src/index.ts](../../src/index.ts)
- [frontend/src/identity/flow.tsx](../../frontend/src/identity/flow.tsx)
- [tests/identity-recovery.mjs](../../tests/identity-recovery.mjs)
- [tests/identity-browser.mjs](../../tests/identity-browser.mjs)
- [docs/workspace-identity.md](../../docs/workspace-identity.md)
- [docs/identity-authority.md](../../docs/identity-authority.md)
- [docs/identity-ceremonies.md](../../docs/identity-ceremonies.md)
- [docs/identity-kits.md](../../docs/identity-kits.md)
- [docs/identity-recovery.md](../../docs/identity-recovery.md)
- [docs/identity-web.md](../../docs/identity-web.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/69. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: WH-114A #70 implements the isolated current-policy account/attempt/credential/session/grant schema and shared principal/committing guard. WH-114B #71 owns verified ceremonies/enrollment, WH-115 #69 owns shared kits/restricted recovery, and WH-114C #72 connects them for one current-only test cutover. No live schema, auth route, credential or deployment changes; full implementation and acceptance remain open.
- 2026-10-01: #71 adds isolated cryptographic WebAuthn signup, restricted resumption, reviewed key addition, same-purpose reauthentication, current login, one-use challenge/receipt records and bounded cleanup. Target canonical identity inputs remove password fields and retain invitation spending after owner deletion. Kit-bound completion/cancellation and WH-115 recovery remain open; no active route, remote schema, owner credential or deployment changed.
- 2026-10-01: Shared current kit offers, one-time text preparation, exact save acknowledgment, guarded ordinary rotation, two-key/fresh-assertion enrollment completion and authenticated cancellation now complete #71 backend scope and part of #69. Actual cryptographic signup-to-session journeys and 47 refusal/race checks passed on SQLite/local D1; 62 ceremony and 72 authority checks also pass. Restricted recovery, kit delivery UI, shared transport/lifecycle admission and one current-only cutover remain open under #69/#72; no remote or active authentication change.
- 2026-10-01: #69 source now implements current-kit restricted entry, exact all/some/none review, saved-kit securing/revocation, replacement-specific assertion completion, restricted kit rotation and emergency removal including compromised staged keys. It reuses the shared authority, verification, offers and receipts; recovery-commit grants preserve original proof time/expiry. Actual cryptographic journeys and 64 refusal/race checks pass on SQLite/local D1, with 47 kit/62 ceremony/72 authority regressions. Browser kit delivery, HTTP/admission/lifecycle and the coordinated current-only test reset remain open; no remote schema, active auth or deployment change.
- 2026-10-01: #69/#72 now add the isolated current-version HTTP adapter and trusted React identity gate/security flow: strict cookie selection, private bounded/no-store transport, progress reads, logout, two-key setup and reviewed recovery with download/copy/print kit delivery. Twenty-two HTTP refusal cases plus real signed journeys pass on SQLite/local D1; mobile Chromium with virtual authenticators verifies signup, saved-kit resume, lost secure reply, partial recovery, replacement completion and removal. No active platform route, identity schema or owner credential changed. Common HTTP/Chat/provider admission, lifecycle registration, current-only reset and deployed acceptance remain open.
- 2026-10-01: Current source now installs the identity router, identity-before-profile web gate and atomic common workspace admission at HTTP/Chat/provider boundaries. Complete-schema HTTP (36 refusals), workspace admission (21) and feature/provider (37) checks pass on SQLite/local D1; real mobile app signup/welcome/Chat revocation passes. Lifecycle catalog covers 156 tables/37 classes and bounded expiry cleanup. Service-client compiler v3 has a new immutable lock. Remaining fixture/release-schema alignment, remote reset/deployment and owner-device acceptance stay open. No remote mutation.
- 2026-10-02: #72 current-only test cutover completed with release 40e45c39-037a-42da-802c-5eacc75bde77 (6c73ac5). New empty D1 has exact 156-table/702-object schema; four Workers, all 39 served assets and binding/secret inventories pass independent readback. Live signed synthetic two-key login, welcome/first-project, logout and revocation pass with fixture cleanup and zero inference. Mobile entry screenshot inspected. Old test account/database and PASSWORD_PEPPER retired, remaining script/bindings unchanged; fresh owner invite saved privately. Physical-device enrollment, human Turnstile/live recovery and native/parent beta gates remain open. CSAM, Daybreak and CMS testing remain deferred. See docs/identity-web.md final release evidence.

## WH-121 — Accept inference privacy and offline benchmark handoff

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **ready**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Data-protection implementation receives a dated current provider-processing boundary without waiting for real-model quality benchmarking.

### Scope

- Extract the completed offline evidence and provider privacy decision from WH-020 while preserving its real-cohort, quality and cost acceptance
- Reconcile current synthetic journeys and complete receipt accounting; reject incomplete or contradictory reports and retain unknown actual expense
- Define current Contributor data eligibility and the exact evidence required before confidential inference, using existing lifecycle classes and route ownership

### Acceptance criteria

- [ ] Current seven-family synthetic baseline and all-call evidence remain distinct from real-model quality, customer latency and verified expense
- [ ] Current Muse Contributor training and retention statements are dated and confidential beta content remains ineligible
- [ ] Workers AI and Gateway are candidate processing boundaries only; exact model, contract, region, storage, logging and auxiliary processors require admission evidence
- [ ] The WH-116 handoff names current data classes, account/content recovery distinctions and revoked/expired route behavior without creating a second catalogue or activating providers

### Verification

- Run the complete current offline cohort and benchmark-evidence checks
- Read current official Go/Zen, Workers AI data-use and Gateway logging sources
- Check referenced lifecycle classes and roadmap dependency/render consistency

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/inference-privacy.md](../../docs/inference-privacy.md)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [docs/data-lifecycle.json](../../docs/data-lifecycle.json)
- [tools/benchmark.mjs](../../tools/benchmark.mjs)
- [tools/benchmark-evidence.mjs](../../tools/benchmark-evidence.mjs)
- [tests/benchmark-evidence.mjs](../../tests/benchmark-evidence.mjs)
- [tests/fixtures/customer-benchmark.json](../../tests/fixtures/customer-benchmark.json)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/80. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: extracted from open WH-020/#9 to supply its privacy foundation to WH-116. Current seven-family cohort at 9d64b9a passed with unchanged sources, 35 retained receipts and zero real-provider samples. Official model/privacy terms were rechecked. Current source adds closed evidence validation and compiler-lock fingerprinting; final connected rerun is recorded in the execution issue. Real-model comparison, confidential-route approval and provider activation remain open under WH-020/021.
- 2026-10-02 UTC final acceptance: strict report admission rejected 19 malformed/contradictory inputs; full current cohort passed 7/7 at 04:58:18–05:01:04 UTC with unchanged 542-file fingerprint and 35 receipts (7 acknowledgments, 1 uncertain, 1 released). Real-provider samples remain zero; actual cost/latency remain unknown. Source digest and private run ID are in docs/customer-benchmarks.md. Fourteen roadmap dependency regressions and current graph checks passed. No runtime/provider activation or confidential-customer approval.

## WH-131 — Restricted safety case contract, current schema and account-scope preservation holds

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **ready**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An active, named-human preservation hold blocks the ordinary account cascade and related deletion/expiry paths, while case records, findings and audit live outside the account lifecycle.

### Scope

- Canonical schema for cases, append-only findings, evidence links, account-scope holds, operator roles and audit
- Deterministic trigger enforcement on account/project deletion, project owner change and contact deletion/expiry
- Trusted operator module with role checks and same-transaction audit; closure inventory and lifecycle catalogue registration

### Acceptance criteria

- [ ] No ordinary account cascade destroys an actively held account, its risk evidence or its case records
- [ ] Every attempt is audited as allowed/denied/rejected with opaque identifiers only
- [ ] Cases open as uncertain flags; confirmation and correction are separate append-only human decisions
- [ ] Holds require a preservation approver and legal basis reference, have a bounded review term, never lapse silently and release only explicitly

### Verification

- node tests/safety-cases.mjs
- node tests/safety-cases.mjs --d1
- node tests/content-risk-evidence.mjs
- node tests/content-risk-review.mjs
- node tests/account-closure-inventory.mjs
- node tests/lifecycle-catalog.mjs

### Dependencies and blockers

Planning dependencies: WH-009, WH-010. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [src/safety-cases.ts](../../src/safety-cases.ts)
- [schema/platform.sql](../../schema/platform.sql)
- [tests/safety-cases.mjs](../../tests/safety-cases.mjs)
- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/account-closure.md](../../docs/account-closure.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-132 — Authenticated restricted case operations and remaining preservation paths

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Named operators authenticate to a restricted case surface, and holds also protect evidence objects and every remaining per-object deletion or expiry path.

### Scope

- Authenticated operator identity bound to case roles; restricted CLI or review surface without model access
- Restricted evidence object storage and object/project-scoped holds covering R2 cleanup, photo replacement, draft/traffic expiry and backup/restore suppression
- Reviewed lawful export/disclosure operation design with audit; customer-facing behaviour during holds without disclosing a case

### Acceptance criteria

- [ ] Operator actions require authenticated identity, not declared references
- [ ] Every ordinary deletion or expiry path for held scope is blocked or explicitly excluded with rationale
- [ ] Export/disclosure is a separate audited reviewed operation; no raw material enters ordinary logs, GitHub or model context

### Verification

- Synthetic deletion/access/export/release tests on disposable SQLite and local D1
- Inventory of every DELETE/expiry path against hold scope

### Dependencies and blockers

Planning dependencies: WH-131. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [src/safety-cases.ts](../../src/safety-cases.ts)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/132. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC: owner decisions on issue #132, parts (a), (b) and (d), implemented in source with local verification only; not deployed, not configured, no operator bootstrapped. Changes the composed schema (schema/platform.sql), so it needs the owner-run empty-D1 schema cutover held on PR #160. (a) safety_preserved_records capacity raised from 10,000 to 50,000 and still fails closed: at capacity the preserving app-document write is refused. (b) New triggers safety_hold_app_document (previous revision kept on every app_documents state overwrite: visitor transition, recovery restore or migration apply) and safety_hold_app_recovery_document (app_recovery_documents cleared by recovery-point removal or visitor revocation are kept) inside an account or project hold. Customer writes still succeed. Object holds do not capture app documents. tools/safety-hold-inventory.mjs reclassifies both paths as preserved and also classifies two module review-expiry deletes from WH-125/126 (module_activation_reviews, module_access_role_reviews) that left the inventory failing on this branch; it now lists 85 sites with none unclassified. (d) docs/content-safety.md adds the outside-hold-control procedure for D1 Time Travel and customer-owned CMS/GitHub copies, required before case operations are activated. Recorded owner decisions: default case/evidence retention is one year with operator review at expiry, pending counsel (not implemented in code); visitors may not delete their own data while held (current behaviour, unchanged). Local checks: node tests/safety-case-operations.mjs passed 106 checks on SQLite and with --d1 on local D1 + local R2. Also passed: node tests/safety-cases.mjs (+ --d1), tests/chat-interaction-storage.mjs, tests/app-recovery.mjs, tests/lifecycle-catalog.mjs, pnpm check, node tools/verify.mjs fast and protection, pnpm build.
- 2026-10-04 UTC: owner decision on issue #132, part (c), implemented in source with local verification only; not deployed, no schema change. New minimal read-only restricted case review page /workspace/operator-safety (frontend/src/operator-safety.tsx; client frontend/src/lib/operator-safety.ts) over the existing operator API. It calls only holds/list, cases/read, cases/audit and disclosures/read. It is not linked from customer navigation. Each section shows restricted, not found or the result; one passkey reauthentication per stale read; no caching or storage. Server-side role, fresh-proof and audit enforcement are unchanged. No operators are configured (owner decision), so there is no live reader. Write actions keep no UI. Local checks: node tests/operator-safety-review.mjs passed 17 checks on SQLite and with --d1 on local D1 (read-only action set, per-section role gating, customer and case-subject non-disclosure, single reauthentication, audited refusals, no navigation link, no state change). Also passed: pnpm check, node tools/verify.mjs fast and protection, pnpm build. Not exercised in a browser (Playwright not installed here). Activation remains blocked on the outside-hold-control procedure, counsel review (WH-133) and operator bootstrap.
- 2026-10-04 UTC: owner decision on issue #132 (default one-year case/evidence retention with operator review at expiry, pending counsel) implemented in source with local verification only; not deployed, not configured, no operator bootstrapped, counsel review (WH-133) outstanding. Changes the composed schema (schema/platform.sql: retention_due_at on safety_cases and safety_evidence_objects, new append-only safety_retention_decisions, view safety_case_retention, three audit actions), so it rides the owner-run empty-D1 cutover held on PR #160; deploy ci refuses it. safetyRetentionDays=365 in src/safety-cases.ts sets each term at opening/capture. Past its due date (latest extension or own term, never earlier than any undisposed evidence term) a case is listed by retention/list as retention_review_due (released cases with stored evidence as released_pending_disposal); expiry changes and deletes nothing; self-cases are never listed. A preservation approver previews (retention/preview: facts plus reviewSha256 over the exact decision, reviewed due date, closure and evidence digests/terms) and applies (retention/apply) extend (1-366 days) or release; changes in between are refused, the schema re-checks the due date, exact retries are idempotent, every attempt is audited. Release is final and needs a closed case, no active hold on the case or its subject, no open disclosure and no unfinished capture; evidence disposal now also requires a release and no active hold on the case or subject. The read-only page /workspace/operator-safety lists the queue (retention/list added to its read actions) and shows each case's retention term and decisions; write actions have no UI. Lifecycle catalog maps 219 tables. Local checks: node tests/safety-case-operations.mjs 147 checks and tests/operator-safety-review.mjs 19 checks, both on SQLite and --d1; tests/safety-cases.mjs (+ --d1), lifecycle-catalog, restore-admission, account-closure-inventory, restore-inventory, shared-modules-records/files, guest-previews, contact-notifications, chat-interaction-storage (SQLite and --d1), node tools/safety-hold-inventory.mjs (93 sites, none unclassified), pnpm check, verify fast/protection, pnpm build. Not exercised in a browser. Remaining: counsel review of the term and of any closed-case metadata purge; write-action UI stays out of scope.
- 2026-10-04 UTC: documentation correction only; no code or schema change. docs/content-safety.md quoted a stale 85 deletion sites; it now matches node tools/safety-hold-inventory.mjs at the WH-128 Remove from collection slice: 94 sites (14 blocked, 5 skips-held, 2 preserved, 2 hold-mechanism, 71 excluded, 10 other paths; none unclassified or stale), and the blocked summary names the module upload, contact destination and module record sites. Verified: node tools/safety-hold-inventory.mjs, tests/safety-case-operations.mjs, roadmap validate/alignment/render --check, git diff --check.

## WH-133 — Qualified review and activation of restricted case and preservation procedure

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **blocked**. Kind: decision. Size: S.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Legal applicability, hold terms, case retention and the operating procedure are approved by named humans before any live use.

### Scope

- Counsel review of preservation/reporting applicability, default review term and extension rules
- Case-retention schedule for closed/released cases and audit
- Named responsible operator, role administration and emergency escalation

### Acceptance criteria

- [ ] Approved procedure recorded with named decision owners; no model verdict
- [ ] Live schema deployment and operator onboarding are separately reviewed; scanner/reporting work stays owner-deferred

### Verification

- Qualified review record (sanitized reference)
- Desk-check of incident-runbooks Section 10 against the approved procedure

### Dependencies and blockers

Planning dependencies: WH-132. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Qualified US counsel review of applicability, preservation term, retention schedule and disclosure; owner names the responsible safety operator

### References

- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/incident-runbooks.md](../../docs/incident-runbooks.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-024 — Audit the supported owner journey for usability and accessibility

Phase: **Safe customer beta** (F1). Priority: **P1**. Planning readiness: **ready**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers can reach a first useful draft and recover from blocked work on keyboard, small screens and assistive technology.

### Scope

- Trace landing, invitation, welcome, Chat, review cards, preview and recovery
- Assess focus, labels, announcements, contrast, errors, loading and narrow-screen behavior
- Turn observed failures into bounded fixes; preserve Chat-first product choices
- Investigate composer/request persistence, dashboard query-error recovery and Chat new-message announcements from the baseline review; verify before classifying as defects
- Audit first and second passkey enrollment, optional explanations, resumable cancellation, recovery-kit save/print and restricted recovery under the accepted low-friction policy

### Acceptance criteria

- [ ] Complete keyboard journey and screen-reader checks have evidence
- [ ] Pending safety/provider work is understandable and never shown as completed
- [ ] Unavailable trial/contact/payment controls make no false promise
- [ ] Real device gaps remain explicit even if viewport emulation passes
- [ ] Users receive actionable guidance when a second distinct key is unavailable, with progress preserved and no mandatory purchase or printing; ordinary sessions gain no routine unlock prompts

### Verification

- Existing navigation/onboarding/chat-delivery and review-card tests as relevant
- Manual keyboard/screen-reader and 360/390px browser checks
- pnpm check/build only for implemented frontend changes

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [frontend/src/onboarding.tsx](../../frontend/src/onboarding.tsx)
- [frontend/src/workspace.tsx](../../frontend/src/workspace.tsx)
- [frontend/src/chat-turn-actions.tsx](../../frontend/src/chat-turn-actions.tsx)
- [frontend/src/landing.tsx](../../frontend/src/landing.tsx)
- [frontend/src/pricing.tsx](../../frontend/src/pricing.tsx)
- [docs/workspace-refinement-acceptance.md](../../docs/workspace-refinement-acceptance.md)
- [frontend/src/query-recovery.tsx](../../frontend/src/query-recovery.tsx)
- [frontend/src/lib/chat-announcements.ts](../../frontend/src/lib/chat-announcements.ts)
- [tests/chat-announcements.mjs](../../tests/chat-announcements.mjs)
- [tests/workspace-identity-browser.mjs](../../tests/workspace-identity-browser.mjs)
- [tests/helpers/owner-usability-journey.mjs](../../tests/helpers/owner-usability-journey.mjs)
- [tests/helpers/accessibility-audit.mjs](../../tests/helpers/accessibility-audit.mjs)
- [tests/chat-screen-reader.mjs](../../tests/chat-screen-reader.mjs)
- [docs/owner-usability-audit.md](../../docs/owner-usability-audit.md)
- [frontend/src/lib/chat-recovery.ts](../../frontend/src/lib/chat-recovery.ts)
- [frontend/src/use-chat-recovery.ts](../../frontend/src/use-chat-recovery.ts)
- [tests/chat-recovery.mjs](../../tests/chat-recovery.mjs)
- [tests/chat-recovery-profile.mjs](../../tests/chat-recovery-profile.mjs)
- [frontend/src/lib/welcome-delivery.ts](../../frontend/src/lib/welcome-delivery.ts)
- [tests/welcome-delivery.mjs](../../tests/welcome-delivery.mjs)
- [tools/owner-journey-browser.mjs](../../tools/owner-journey-browser.mjs)
- [docs/onboarding.md](../../docs/onboarding.md)
- [src/comparison-page.ts](../../src/comparison-page.ts)
- [docs/version-comparisons.md](../../docs/version-comparisons.md)
- [tests/comparison-page-http.mjs](../../tests/comparison-page-http.mjs)
- [tools/comparison-recovery-browser.mjs](../../tools/comparison-recovery-browser.mjs)
- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [tests/pricing-display-browser.mjs](../../tests/pricing-display-browser.mjs)
- [tests/chat-interaction-browser.mjs](../../tests/chat-interaction-browser.mjs)
- [tests/chat-task-connection-status.mjs](../../tests/chat-task-connection-status.mjs)
- [tests/photo-handoff.mjs](../../tests/photo-handoff.mjs)
- [docs/stripe-pricing-tables.md](../../docs/stripe-pricing-tables.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/10. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 UTC: initial/refresh error recovery, accessible reply notices, pending-turn presentation, keyboard focus and mobile sheet corrections verified with types/build, delivery/announcement/timing/loading checks and a synthetic loopback browser fixture at desktop/360/390 px. Draft and same-request identity survive workspace navigation; full reload persistence, complete owner journey and real screen-reader/device acceptance remain open. See docs/workspace-refinement-acceptance.md and issue #10. Deployment is recorded separately.
- 2026-10-01 UTC test release 02370893-1c87-419d-ad49-9162ddb0f135 from source 524cf00: all four versions, 113 applied migrations / none pending, unchanged bindings/CMS registry, 16 exact assets, home/workspace/health 200 and anonymous Chat/profile 401 verified. Interactive UI checks used synthetic loopback APIs. PR #23 delivers this slice; complete journey, real assistive-technology/device acceptance and full reload persistence remain open in issue #10.
- 2026-10-01 UTC: account-bound per-tab draft and exact unresolved-request persistence now survives reload. Synthetic browser verifies accepted-response loss without resending, pre-acceptance loss with explicit exact-ID retry, account switching and sign-out cleanup at desktop/390 px; focused storage/API/delivery tests and types/build/loading checks pass. See the superseding reload-recovery section in docs/workspace-refinement-acceptance.md. Complete journey, actual screen-reader/device acceptance remain open. Deployment recorded separately.
- 2026-10-01T03:32:00.755Z: test release dfd7f653-d7ec-483d-b54d-ec089f093edc from 272e3d7 verified: four versions/tags, 113 migrations and none pending, unchanged bindings/CMS registry, 16 exact assets, matching workspace HTML, home/workspace/health 200 and anonymous Chat/profile 401. PR #24; interactive recovery acceptance used synthetic APIs. Full journey, actual screen-reader speech and physical phones remain open.
- 2026-10-01 UTC: connected actual-handler/disposable-D1 owner journey with scripted inference reproduced and corrected lost-response welcome saves, avatar/error focus and review wording. Natural Chat created/edited private drafts and opened preview/review; unshared bio excluded. Trial/contact/payment unavailability inspected. See connected-owner-journey evidence in docs/workspace-refinement-acceptance.md; real invitation/passkeys, screen-reader speech and physical devices remain open. Deployment recorded separately.
- 2026-10-01T04:07:14.190Z: test release 1abae8bd-fa49-4878-afb8-bdbd1615b41f from 2add4c0 verified four versions, 113 migrations / none pending, unchanged bindings/CMS registry, 16 exact assets and workspace HTML, health/home/workspace 200 and anonymous Chat/profile 401. PR #25 delivers welcome save/focus recovery and connected synthetic owner-journey evidence; real authentication, screen-reader/device and friendly expired-page acceptance remain open.
- 2026-10-01 UTC: readable comparison recovery resolves the previously unaccepted expired-page UX. Actual-handler HTTP checks preserve status/JSON/auth/owner/state boundaries; disposable D1 regression and browser 200/409/404/401 navigation pass. Keyboard return reaches Chat/sign-in; Before/After labels remain visible at 360/390 px and desktop. Sampled palette contrast exceeds 6.27:1; actual speech/device and broader review remain open. See docs/version-comparisons.md and docs/workspace-refinement-acceptance.md. Deployment recorded separately.
- 2026-10-01T04:28:59.444Z: release ee62cc7e-a655-4aba-a84b-2568051415cf from 3a9b61b verified all four Worker versions, 113 migrations / none pending, unchanged bindings/CMS registry, 16 exact assets and workspace HTML, home/workspace/health 200, anonymous Chat/profile 401 and comparison HTML/JSON 401 compatibility. PR #26 resolves bounded expired-review recovery and responsive comparison labeling. Real authentication, screen-reader speech, physical phones and broader acceptance remain open.
- 2026-10-03 UTC: connected current-D1 keyboard/Orca audit corrects first-passkey, kit, initial welcome, recovery-review and landing-entry focus; late identity responses preserve moved focus. Landing gains a main landmark/skip link, small-label contrast improves from 3.37:1 to 4.99:1, and deferred CMS wording is explicit. Seven full-workspace entry and four isolated recovery speech checkpoints pass; virtual WebAuthn, saved-progress/lost-response recovery and private-kit checks retain authority boundaries. WH-024 stays open for complete combined Chat/review/preview/outage and broader contrast/manual/device acceptance. See docs/owner-usability-audit.md. Source 4b853fb is deployed as platform a0467ecf-f106-46f8-8e6d-0bd827f1d3be; independent 2026-10-03T16:43:42.678Z readback verifies 40 exact assets, unchanged other Workers/schema/bindings and anonymous rendered entry. No remote enrollment/provider action.
- 2026-10-03 UTC connected owner audit: source 980ae5f fixes verified late-welcome focus theft and missing actual Orca Chat announcements. Ten speech checkpoints and the enrolled-owner current Worker/D1 keyboard journey pass through private draft, exact retry, saved-response readback, comparison/preview, signed private save, Dashboard outage/newer focus and unavailable billing/connections. Two scripted model calls, two private versions, zero publications. Nine axe states have zero reported violations; manual/incomplete checks and sandboxed-preview tool limitation are explicit. Obsolete auth recovery fixture removed. Types/build, delivery/recovery/announcements, comparison HTTP/browser and roadmap checks pass. Platform 4a147e32-7185-4309-b794-eeb7c4140b43, readback 2026-10-03T17:28:42.997Z: 40 assets exact, other Workers/current 177-table-806-object schema/bindings unchanged, anonymous live phone/desktop checks pass. No remote enrollment/model/provider/billing/publication action. WH-024 remains open for consolidated pending-state and Enterprise contact verification; physical/human acceptance remains separate. See docs/owner-usability-audit.md.
- 2026-10-03 UTC final original-scope audit accepted: all five scope items, five criteria and three verification requirements mapped in docs/owner-usability-audit.md. Fresh current-D1 media/consent browser journeys, nine photo-handoff and 21 provider-status cases pass; private-held/unknown/read-outage copy and 360/390px controls inspected. All four live sandbox pricing tables and both exact approved Enterprise mailto intents pass; no checkout/email sent. Ten connected owner Orca checkpoints and four prior restricted-recovery checkpoints remain separately scoped; no human listening, physical-device or whole-customer acceptance implied. Source runtime 980ae5f and test platform 4a147e32 remain unchanged; final test/docs audit requires no deployment. WH-111 follows; WH-112/048 retain whole-experience/customer gates.

## WH-116 — Classify data protection, processing access and recovery requirements

Phase: **Safe customer beta** (F1). Priority: **P1**. Planning readiness: **ready**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Each admitted data class has an honest protection and processing-access contract, with justified transparent improvements and separate account/content recovery promises.

### Scope

- Extend the existing lifecycle inventory for private files/drafts/chat, visitor records, credentials, public artifacts and operational metadata; avoid a second independent catalog
- Distinguish Cloudflare-managed at-rest protection, server-managed application encryption and candidate client-side/passkey encryption, including transit and key custody
- Map authorized AI, safety, search, publication, image processing, app execution and background-integration access with data minimization and provider privacy rules
- Specify retention/export/deletion, backup keys, current key rotation, missing-key failure, obsolete-test reset and current restore reconciliation per class
- Select required WH-117 encryption/control changes by concrete exposure and usability benefit; document sufficient existing controls, incremental costs and unknown account entitlement/pricing
- Register extension classes including guest feedback, brand kits, lead/staging/provider data, Chat interactions and incomplete enrollment. The closed WH-009 foundation remains complete only for its recorded inventory; each implementing packet owns its new adapters and evidence.

### Acceptance criteria

- [ ] Every admitted class records data purpose, authorized reader/processor, encryption owner, recovery/backup behavior and remaining exposure; no processing path is mislabeled end-to-end encrypted
- [ ] No new routine prompt, default private vault or PRF-device requirement is introduced; sensitive processing is minimized while current product and safety boundaries remain operable
- [ ] Account recovery and any future content-key recovery are separate; the recovery kit cannot promise to reconstruct absent keys
- [ ] The WH-117 implementation list names required changes and current-key/reset acceptance checks; unchanged protection has an explicit sufficiency rationale
- [ ] Official Cloudflare/product references and changing availability/cost facts are dated; real contributor-model confidentiality and separate service/spending authorization remain explicit

### Verification

- Cross-check current D1/R2 paths, connection-vault primitives, lifecycle inventory and inference/privacy contracts without reading secret values
- Review data-class examples and key-loss/backup/deletion scenarios using synthetic records only
- Run lifecycle-catalog checks if the catalog changes, plus roadmap/reference and diff checks

### Dependencies and blockers

Planning dependencies: WH-113, WH-009, WH-121. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/data-lifecycle.json](../../docs/data-lifecycle.json)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/integrations/cloudflare-connection.md](../../docs/integrations/cloudflare-connection.md)
- [docs/integrations/github-connection.md](../../docs/integrations/github-connection.md)
- [src/connection-vault.ts](../../src/connection-vault.ts)
- [docs/workspace-identity.md](../../docs/workspace-identity.md)
- [docs/data-protection.md](../../docs/data-protection.md)
- [docs/inference-privacy.md](../../docs/inference-privacy.md)
- [tools/lifecycle-catalog.mjs](../../tools/lifecycle-catalog.mjs)
- [tests/lifecycle-catalog.mjs](../../tests/lifecycle-catalog.mjs)
- [tests/connection-vault.mjs](../../tests/connection-vault.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/81. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 WH-120 amendment: active planning now requires current-only admission, reviewed obsolete-test resets and forward repair. Legacy identity stages, old-client/module coexistence and old-runtime rollback are not implementation requirements. This is documentation alignment only, not implementation, policy activation or device acceptance.
- 2026-10-02 UTC: consume the explicit current privacy-processing handoff WH-121 instead of waiting for the full WH-020 real-model benchmark. Classification and WH-117 still cannot approve confidential routes; WH-020/021 and launch acceptance retain their original gates.
- 2026-10-02 UTC: WH-116 decision in docs/data-protection.md classifies all 156 current tables/37 current classes and eight planned classes in the one lifecycle catalogue. Current-version-only validation rejects 42 malformed contract/reference cases; actual AES-GCM primitive passes 73 synthetic isolation/corruption/key-loss checks. DP-01–04 remain WH-117 implementation; DP-05 supplies metadata drift checks. No deployed encryption, confidential-route approval, retention approval or operational restore claim.

## WH-117 — Implement transparent encryption and complementary protection controls

Phase: **Safe customer beta** (F1). Priority: **P1**. Planning readiness: **ready**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Admitted data paths have the justified WH-116 protections, verified current-key/reset/restore behavior and no added routine customer unlock burden.

### Scope

- Implement the bounded WH-116 change list using existing architecture and maintained authenticated-encryption primitives where extra encryption is justified
- Preserve tenant/purpose isolation, least privilege, private storage, scoped processing, short-lived credentials, retention minimization and redacted diagnostics
- Version current keys and encrypted records, restrict decryption authority and reset obsolete test encodings; current key rotation retains interruption/readback, without legacy readers or old-runtime rollback
- Cover key custody/rotation, backup recovery, missing/corrupt keys and restored revocation/deletion reconciliation; keep provider credentials out of exports and model context
- Measure incremental compute/storage/support effects and verify existing AI/safety/search/publication/background jobs through their permitted data boundaries
- Implement DP-01–04 and preserve DP-05 from docs/data-protection.md: bounded current key IDs and CAS rotation across GitHub/Cloudflare token/PKCE/staging/revocation paths; existing-selector minimization and export/diagnostic proof; isolated current restore admission; separately protected key/artifact custody. Split this L packet into implementation and connected/candidate acceptance children before execution without dropping the parent criteria.

### Acceptance criteria

- [ ] Each WH-116 requirement has implementation or documented existing-control evidence and a truthful statement of who can read the protected data
- [ ] Cross-tenant/purpose substitution and corrupt/unknown-key ciphertexts fail; cryptographic failure never causes plaintext fallback
- [ ] Current cutover interruption, competing updates and key rotation preserve admitted current data without exposing plaintext or deleting a still-required key; obsolete test formats may be reset
- [ ] Isolated restore retains required key versions and reconciles deletion/revocation before service; absent keys fail visibly and backup limits are disclosed
- [ ] Ordinary sign-in/work does not gain repeated unlock prompts; AI/safety/background behavior remains authorized and no PRF support or new service is assumed
- [ ] Candidate-release evidence feeds WH-048; local checks do not claim live cutover, provider acceptance or encrypted-content recovery

### Verification

- Run pnpm check for TypeScript changes and focused existing vault, authorization, lifecycle and affected feature suites selected by WH-116
- Use synthetic tenant/purpose/key-version, corruption and interruption fixtures against actual affected storage/handlers
- Rehearse isolated current-format reset/rotation/restore and inspect sanitized evidence; use quality-managed browser checks if user-facing behavior changes

### Dependencies and blockers

Planning dependencies: WH-116, WH-004. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/owner-recovery.md](../../docs/owner-recovery.md)
- [docs/security-risk-actions.md](../../docs/security-risk-actions.md)
- [docs/releases.md](../../docs/releases.md)
- [docs/integrations/cloudflare-connection.md](../../docs/integrations/cloudflare-connection.md)
- [src/connection-vault.ts](../../src/connection-vault.ts)
- [schema](../../schema)
- [docs/data-protection.md](../../docs/data-protection.md)
- [docs/data-lifecycle.json](../../docs/data-lifecycle.json)
- [docs/inference-privacy.md](../../docs/inference-privacy.md)
- [tools/lifecycle-catalog.mjs](../../tools/lifecycle-catalog.mjs)
- [tests/lifecycle-catalog.mjs](../../tests/lifecycle-catalog.mjs)
- [tests/connection-vault.mjs](../../tests/connection-vault.mjs)
- [docs/connection-key-lifecycle.md](../../docs/connection-key-lifecycle.md)
- [tests/connection-keyrings.mjs](../../tests/connection-keyrings.mjs)
- [src/connection-rotation.ts](../../src/connection-rotation.ts)
- [src/connection-write-policy.ts](../../src/connection-write-policy.ts)
- [tests/connection-rotation.mjs](../../tests/connection-rotation.mjs)
- [tests/connection-rotation-custody.mjs](../../tests/connection-rotation-custody.mjs)
- [tests/processing-boundaries.mjs](../../tests/processing-boundaries.mjs)
- [tools/secret-custody.mjs](../../tools/secret-custody.mjs)
- [tools/artifact-protection.mjs](../../tools/artifact-protection.mjs)
- [tests/secret-custody.mjs](../../tests/secret-custody.mjs)
- [docs/restore-admission.md](../../docs/restore-admission.md)
- [tools/restore-admission.mjs](../../tools/restore-admission.mjs)
- [tests/restore-admission.mjs](../../tests/restore-admission.mjs)
- [src/connection-oauth-response.ts](../../src/connection-oauth-response.ts)
- [tests/connection-oauth-outcomes.mjs](../../tests/connection-oauth-outcomes.mjs)
- [tools/connection-key-backup.mjs](../../tools/connection-key-backup.mjs)
- [tests/connection-key-backup.mjs](../../tests/connection-key-backup.mjs)
- [tools/operator-private-files.mjs](../../tools/operator-private-files.mjs)
- [tools/restore-inventory.mjs](../../tools/restore-inventory.mjs)
- [tests/restore-inventory.mjs](../../tests/restore-inventory.mjs)
- [tests/github-refresh-custody.mjs](../../tests/github-refresh-custody.mjs)
- [tools/maintenance-inventory.mjs](../../tools/maintenance-inventory.mjs)
- [tools/account-closure-inventory.mjs](../../tools/account-closure-inventory.mjs)
- [src/github-grant-revocation.ts](../../src/github-grant-revocation.ts)
- [tests/github-grant-revocation.mjs](../../tests/github-grant-revocation.mjs)
- [src/github-grant-chat.ts](../../src/github-grant-chat.ts)
- [src/github-grant-shape.ts](../../src/github-grant-shape.ts)
- [frontend/src/github-grant-review.tsx](../../frontend/src/github-grant-review.tsx)
- [tests/github-grant-chat.mjs](../../tests/github-grant-chat.mjs)
- [tests/workspace-identity-browser.mjs](../../tests/workspace-identity-browser.mjs)
- [tests/restore-inventory-freshness.mjs](../../tests/restore-inventory-freshness.mjs)
- [docs/protection-candidate.md](../../docs/protection-candidate.md)
- [tests/remote-d1.mjs](../../tests/remote-d1.mjs)
- [tests/release-provider.mjs](../../tests/release-provider.mjs)
- [tools/release-provider.mjs](../../tools/release-provider.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/82. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 WH-120 amendment: active planning now requires current-only admission, reviewed obsolete-test resets and forward repair. Legacy identity stages, old-client/module coexistence and old-runtime rollback are not implementation requirements. This is documentation alignment only, not implementation, policy activation or device acceptance.
- 2026-10-02 UTC: WH-116 supplies the concrete DP-01–05 handoff and current synthetic vault baseline. Additional blanket content encryption and routine unlock/PRF requirements are not selected. WH-117 remains implementation work; account closure and whole-platform operational restore remain WH-018/019/008/059.
- 2026-10-02 UTC: parent #82 split into #83 current credential envelope/configuration, #84 fenced resumable rotation, #85 processing/isolated-restore/custody controls and #86 connected candidate/test-release acceptance. DP-01–05 and every original parent criterion remain required; no partial format deployment. Child #83 claimed at bee963a.
- 2026-10-02 UTC: child #83 source uses only CONNECTION_ENCRYPTION_KEYRING/current wv2 envelopes, authenticates key ID and scoped context, and refuses missing/old/plaintext values with bounded HTTP errors. 164 primitive/configuration cases, actual retained-key PKCE/current-key token and missing-key revocation custody on local D1, affected provider/admission/backup/DNS tests, both TypeScript projects and build pass. No remote keys or data changed. Parent stays open for #84 rotation fences/journal, #85 processing/restore/custody and #86 candidate release acceptance.
- 2026-10-02 UTC: child #84 source implements reviewed immutable key identity, forward-only D1 write fencing and bounded exact-CAS rotation/readback across four stores. Actual SQLite/local D1 checks cover stale/newer writers, interrupted/duplicate/lost-response batches, concurrent disconnect/revocation/flow replacement/deletion, and eight OAuth exchange-custody races. Unknown exchanges retain custody and block key activation; all key retirement remains refused pending independent restore/custody evidence. Local row/byte/runner-CPU measurements are documented; 162 current tables are classified. No remote key/schema/binding change or deployment. Parent #82 remains open for #85 DP-02/03/04 and #86 candidate acceptance.
- 2026-10-02 UTC: child #85 source adds DP-02 field projection/private-boundary canaries, DP-04 nine-secret custody metadata and artifact exclusion, and DP-03 current-schema/compiler/key/data manifests with isolated restore checks. SQLite includes a real read-only backup copy refused after current-source session revocation; local D1 exercises the same verifier. Fresh independent evidence is supplied only by a separate synthetic archive/event service in these checks. Missing/stale/gapped evidence, revoked authority, unknown effects, nonterminal/mismatched receipts, missing objects/keys and candidate/evidence races refuse verification. Every result keeps serving, dispatch and key retirement disabled. Five-script protection profile passes; no live suppression store, key-backup custody, provider reconciliation or deployment is claimed. Child C remains open for independent custody and exact OAuth outcome reconciliation; child D and all parent acceptance remain required.
- 2026-10-02 UTC: child #85 now records exact direct OAuth rejection/known-token revocation outcomes with immutable client/owner/provider/key/dispatch metadata. Receipt, exact flow cleanup and exchange release are atomic; unknown or ambiguous responses and incomplete refresh-token revocation remain held. SQL refuses unaccounted exchange deletion. Isolated restore requires independently recorded exact outcome digests. Current schema has 163 classified tables. Source/synthetic checks only; independent key/archive custody, genuinely unknown provider reconciliation and child D release remain required. No whole-platform restore or live provider acceptance.
- 2026-10-02 UTC: child #85 adds current encrypted operator key backups with a distinct recovery key, authenticated metadata, private separate external files, no-overwrite CLI and fresh-process persisted readback. Isolated restore now requires a process-local stored-backup capability and an independent version-2 backup ID/digest/key-list binding; copied reports, raw keyrings, earlier protocol, missing/wrong keys and loss during verification fail. Backup capsules are excluded from source/build/release artifacts. Seven-script protection profile and SQLite/local D1 restore checks pass with synthetic keys; no real key/capsule or independent offsite custody was created. Permitted-source inventory operation, physical custody acceptance, unresolved provider outcomes and child D release remain required.
- 2026-10-02 UTC: child #85 now has a persistent private operator archive/withdrawal/constraint inventory outside application backups and Git worktrees. Registration captures actual current archives and verifies saved encrypted-key backups; observations derive exact metadata from the configured current source. Read-only copies and fresh-process tests cover revocation, epoch/effect receipts, permanent withdrawals, reply-loss replay, competing writes, file/schema refusal and artifact exclusion. The eight-script protection profile passes. This is bounded local recording, not continuously synchronized suppression coverage, anti-rollback/offsite custody, provider acceptance or deployment. Genuinely lost outcomes, GitHub refresh-grant custody and child D/cumulative gates remain open.
- 2026-10-02 UTC: child #85 now atomically preserves returned GitHub refresh credentials in a separate owner/client/token-bound encrypted store. Access expiry and single-token revocation retain the grant obligation; purpose isolation, current key fencing/CAS rotation, restore admission, maintenance and closure inventory include the fifth store. The current schema has 164 classified tables. 14 actual callback/lifecycle journeys with 17 refusals pass on SQLite/local D1; duplicate successful-response credential fields are rejected. Source/local checks only: full provider grant reconciliation, reviewed broader effects, independent custody, key retirement and child D release remain required. No real provider/key/schema/deployment change.
- 2026-10-02 UTC: child #85 now binds each retained GitHub refresh grant to the numeric provider identity from that exact token's authenticated lookup. The write-once value survives canceled lookups and lost write replies, is included in current rotation comparisons, and must agree with any activated connection. Later consent cannot relabel known or unidentified earlier grants. Expanded SQLite/local D1 fixtures cover 22 callback journeys and 24 refusals. The schema remains 164 current tables. This is attribution for eventual provider reconciliation, not a new revoke endpoint, webhook settlement, full grant reconciliation or deployed acceptance; all remaining parent/child D gates remain required.
- 2026-10-02 UTC: child #85 adds immutable reviewed GitHub app-grant revocation through the existing workspace HTTP authority. Confirmation binds the original provider identity and exact retained credential set, requires recent passkey proof, fences unknown/shared grants and concurrent exchanges/cleanup, and allows one dispatch. A direct 204 atomically saves the terminal outcome and deletes exactly the reviewed credentials; ambiguous or lost responses retain custody without automatic retry. The current schema has 165 classified tables. Twenty actual handler scenarios and 18 refusals pass on SQLite/local D1, including independent terminal restore evidence; the Worker identity HTTP suite covers the new API boundary. Backend/API source only: trusted customer renderer/Chat handoff, real App acceptance, genuinely unknown/expired grant recovery, independent suppression/custody and child D release remain required. No remote schema, grant, key or deployment changed; every parent criterion remains open until its complete evidence passes.
- 2026-10-02 UTC: child #85 now exposes reviewed GitHub grant removal through the existing natural Chat catalogue and typed customer controls. Models can prepare/list/read only; immutable owned reply receipts attach current cards, while confirmation requires a signed recent passkey and the existing exclusive provider dispatch. The shared mobile-friendly card and saved results are also reachable in External connections with inference disabled. SQLite/local D1 Chat tests, the existing natural Chat suite and a full current-identity browser journey pass, including cancelled passkey, local cancellation, one synthetic deletion, no duplicate calls and reload. No real provider, physical-device or deployed acceptance is claimed. Unknown/expired grant recovery, independent suppression/custody and coordinated child D release still retain all original parent gates. The schema remains 165 tables and uses only the current contract.
- 2026-10-02 UTC: child #85 operator inventory now captures archive record identities/digests and compares them to the current source on each evidence request. Missed session revocations and changed rows derive a complete atomic bounded constraint batch; missing/failed/obsolete sources, unresolved current effects, source/journal/withdrawal races and permanent-suppression identity reuse hold verification. Current operator-file schema version 2 replaces version 1 without migration or fallback. The source deadline and cancellation cannot wedge subsequent inventory status reads. Real read-only copied SQLite, persisted key-backup and metadata-canary fixtures cover this on-demand path; all serving/dispatch/retirement flags remain false. Continuous/disaster-time suppression operation, independent physical/offsite/anti-rollback custody, full provider reconciliation and child D acceptance remain required. No live data, key, provider state or deployment changed.
- 2026-10-02 UTC: explicit DP-02/03/04 acceptance audit at 964fa38 maps every original child C criterion to actual handlers and synthetic/isolated verification, completing the bounded source/local scope. Parent and child D remain open for combined candidate, configured custody, measures and coordinated release; continuous suppression/whole-platform recovery retain their original WH-008/018/019/059 ownership. Fresh live metadata/count inventory found zero test users/projects/credential/provider/billing records, 156 tables and the obsolete single-key binding; the candidate has 165 tables and needs an explicit current-only reset/binding transition. The operator D1 adapter now supplies immutable statements and one batch request for the existing key initializer, with twelve synthetic refusal cases and real read-only batch verification. No remote mutation, key creation, deployment, CMS/scanner test or offsite-custody acceptance occurred.
- 2026-10-02 UTC: WH-117D current test release 7c4f9344-bd6c-4fc7-a3ab-964e631ad8f3 (runtime source df90276) deployed all four Workers onto the exact 165-table/760-object schema. Actual current-key initialization and stored-capsule readback passed; deployed PKCE ciphertext decrypts with recovered material and matches its challenge. Thirty-nine assets and signed project-first/profile/Chat/session-refusal HTTP checks pass, with fixture cleanup and no provider authorization/model/CMS/scanner calls. Old key binding and unreferenced empty DB retired after all 13 Worker references and old table counts were checked; other databases preserved and fresh private invitation issued. Twenty bounded encryption writes plus sampled deployed CPU and account storage inventory are recorded in docs/protection-candidate.md. Status observation now follows the active platform database, with focused synthetic and live after-retirement verification. Off-device/independently operated custody and final D/parent acceptance remain open; no provider/device/confidential-inference or whole-platform recovery claim.

# F2 — Useful websites and applications

Better customer outcomes, evaluated generation, usable app interfaces and accepted optional connections. Chat is the primary owner surface, with interactive forms and agent-managed supporting views.

## WH-025 — Measure activation and first customer value without collecting content

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The team can identify where invited users fail to reach a useful reviewed publication.

### Scope

- Define consent-aware content-free funnel events and bounded retention
- Measure welcome completion, first draft, accepted edit, review, publication and seven-day return
- Separate technical success from user judgment of usefulness
- Measure content-free interactive-element starts/submits/cancels/resumes, validation failure, required surface changes and time to useful result for WH-112; exclude field values and custom labels
- Measure content-free first/second-passkey completion, unsupported/cancelled enrollment, recovery-kit save/print action and recovery completion/abandonment; an invoked print action does not prove a printed or saved kit

### Acceptance criteria

- [ ] Events carry no brief, source, chat, credentials or cross-tenant identifiers in customer views
- [ ] Funnel counts are idempotent and exclusions documented
- [ ] Targets in roadmap are labeled proposed until the first cohort baseline
- [ ] User interview/feedback requests are drafted but never sent without explicit instruction
- [ ] Identity events contain no recovery keys, credential IDs, account emails, file contents or provider secrets; report enrollment/recovery friction separately from first-project welcome

### Verification

- Synthetic funnel replay/opt-out/deletion tests
- Compare aggregate counts with operation receipts
- Review privacy/retention contract

### Dependencies and blockers

Planning dependencies: WH-024, WH-009, WH-105, WH-113. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/onboarding.md](../../docs/onboarding.md)
- [docs/workspace-agent.md](../../docs/workspace-agent.md)
- [docs/site-health.md](../../docs/site-health.md)
- [src/site-traffic.ts](../../src/site-traffic.ts)
- [frontend/src/onboarding.tsx](../../frontend/src/onboarding.tsx)
- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)
- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/113. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC source slice on branch claude/wh-025-funnel-metrics (not deployed): opt-in content-free funnel_events (allowlisted event/dimension CHECK, receipt keys, UTC minute) derived by the hourly funnel maintenance job from existing receipts, plus handler-side rejected-answer and cancel recorders; consent off by default (welcome bio step and Settings), not retroactive, deleted on withdrawal, 180-day pruning without re-derivation, account cascade and closure-inventory count; lifecycle class product-measurement; read-only suppressed operator report with receipt comparison; docs/funnel-metrics.md with proposed-until-baseline targets and an unsent feedback draft. node tests/funnel-metrics.mjs passes on SQLite and --d1 with actual handlers. Owner consent basis, retention and suppression floor remain undecided; signup, client prompts, print actions and surface changes are not measured. No live data, report run or feedback request sent.

## WH-026 — Expand evaluated website layouts and precise editing

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The supported site builder delivers useful, distinct small-business and personal sites with predictable edits.

### Scope

- Prioritize three validated customer site use cases
- Add approved responsive components and bounded composition with SEO/metadata/accessibility defaults
- Improve edit intent preservation and unsupported-request explanations
- Expose routine owner operations through WH-105 registered read/action bindings and WH-107/109/110 Chat/view adapters; implement domain handlers once. Feature acceptance uses the shared owner surface, with essential direct recovery/security controls retained.

### Acceptance criteria

- [ ] Each new component has versioned schema, export and preview/publish/restore support
- [ ] Edits preserve fields outside requested scope and never mutate prior versions
- [ ] Fixture acceptance covers mobile layout, semantic headings, link safety and exact restore
- [ ] Do not advertise arbitrary scripts or unrestricted multipage apps beyond supported contracts
- [ ] Use validated project specification changes and maintained module APIs first; generate only a justified missing component, with no visitor access to the Whumpo maintainer model

### Verification

- pnpm test:site-agent
- pnpm test:customer-site-journey
- Visual and accessibility acceptance for representative outputs
- Outcome benchmark from WH-020

### Dependencies and blockers

Planning dependencies: WH-020, WH-014, WH-066. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/shared-components.md](../../docs/shared-components.md)
- [docs/mvp.md](../../docs/mvp.md)
- [docs/version-comparisons.md](../../docs/version-comparisons.md)
- [src/components.ts](../../src/components.ts)
- [src/ai-chat.ts](../../src/ai-chat.ts)
- [src/publications.ts](../../src/publications.ts)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-027 — Finish the photo-to-published-site customer experience

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A customer can understand photo holds, select approved media, publish it deliberately and recover or remove it.

### Scope

- Connect scan progress and actionable failure states to Chat/photo workflows
- Verify alt text, responsive rendering, export and retained-version references
- Reconcile deletion and safety revocation through publication and restore

### Acceptance criteria

- [ ] Only approved exact bytes can enter the published page
- [ ] Pending/expired/blocked photos have truthful UI and retain existing approved content where policy permits
- [ ] Export/public aliases and restored versions recheck current approval
- [ ] No duplicate Use in website control is added from stale historical docs

### Verification

- pnpm test:photo-versions
- pnpm test:photo-removal
- pnpm test:customer-site-journey
- Connected browser photo-review/publish/restore journey with approved benign fixtures

### Dependencies and blockers

Planning dependencies: WH-012, WH-017, WH-026. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/photos.md](../../docs/photos.md)
- [docs/photo-publication-plan.md](../../docs/photo-publication-plan.md)
- [docs/version-retention.md](../../docs/version-retention.md)
- [src/photo-versions.ts](../../src/photo-versions.ts)
- [frontend/src/project-details.tsx](../../frontend/src/project-details.tsx)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-028 — Deliver typed visitor interfaces for supported app starters

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The task-list and notebook starters become usable applications instead of generic action/JSON entry forms.

### Scope

- Build bounded page components for the existing reviewed data/program contracts
- Provide accessible create/edit/complete actions and explicit validation/conflict states
- Evaluate at least two complete supported app workloads

### Acceptance criteria

- [ ] UI actions bind the approved program/page/data revisions
- [ ] Visitor identities/documents remain isolated; rejected transitions preserve prior data
- [ ] No frontend can enlarge storage/execution authority
- [ ] Export, revocation and program withdrawal remain discoverable and tested
- [ ] Use validated project specification changes and maintained module APIs first; generate only a justified missing component, with no visitor access to the Whumpo maintainer model

### Verification

- pnpm test:customer-app-journey
- pnpm test:app-page-design
- pnpm test:app-pages-http after fixture setup
- Browser keyboard/mobile test with two synthetic visitors

### Dependencies and blockers

Planning dependencies: WH-014, WH-020, WH-066, WH-067, WH-070. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/app-data.md](../../docs/app-data.md)
- [docs/shared-components.md](../../docs/shared-components.md)
- [src/app-page-design.ts](../../src/app-page-design.ts)
- [src/app-pages.ts](../../src/app-pages.ts)
- [src/backend-task-list.ts](../../src/backend-task-list.ts)
- [web/visitor.js](../../web/visitor.js)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-029 — Make application upgrades and recovery usable end to end

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Owners can understand and safely complete upgrade, rollback, visitor export and deletion workflows.

### Scope

- Improve authority/change summaries and pending maintenance discovery
- Connect cancellation, stale-review recovery and failed transformation explanations
- Validate program/data rollback against current safety and deletion rules
- Expose routine owner operations through WH-105 registered read/action bindings and WH-107/109/110 Chat/view adapters; implement domain handlers once. Feature acceptance uses the shared owner surface, with essential direct recovery/security controls retained.

### Acceptance criteria

- [ ] Owner sees exact code/data effect before approval
- [ ] Lost responses recover the exact receipt without rerunning a migration
- [ ] Withdrawn apps and revoked visitors cannot be silently reactivated
- [ ] Physical-device acceptance gaps are recorded

### Verification

- pnpm test:app-migration-checks
- pnpm test:app-document-recovery
- pnpm test:app-lifecycle
- Connected browser upgrade/rollback/export journey

### Dependencies and blockers

Planning dependencies: WH-028, WH-019. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/app-data.md](../../docs/app-data.md)
- [frontend/src/app-maintenance-card.tsx](../../frontend/src/app-maintenance-card.tsx)
- [frontend/src/app-restore-review-card.tsx](../../frontend/src/app-restore-review-card.tsx)
- [src/app-migration-approval.ts](../../src/app-migration-approval.ts)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-030 — Complete reviewed component promotion and update governance

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Reusable components can improve quality without copying private customer source or silently changing installed versions.

### Scope

- Build synthetic candidate promotion from the existing nomination/intake workflow
- Require provenance, license, sensitive-data and security review plus human approval
- Define consent withdrawal, version pinning, deprecation and security update notices
- Distinguish copied starter templates from maintained versioned module dependencies; WH-076 defines module upgrade governance

### Acceptance criteria

- [ ] No cross-customer source harvesting or automatic promotion
- [ ] Only approved generic artifacts enter the shared catalog
- [ ] Customer copies remain pinned and updates require an explicit scoped review
- [ ] Withdrawal and urgent update handling have tested receipts

### Verification

- pnpm test:backend-library
- node tests/backend-nominations.mjs
- node tests/backend-nomination-intake.mjs
- Synthetic candidate with rejected private/license-sensitive content

### Dependencies and blockers

Planning dependencies: WH-014, WH-015, WH-020. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/shared-components.md](../../docs/shared-components.md)
- [docs/jarvis-reuse.md](../../docs/jarvis-reuse.md)
- [src/backend-nominations.ts](../../src/backend-nominations.ts)
- [src/backend-nomination-intake.ts](../../src/backend-nomination-intake.ts)
- [tools/review-backend-nominations.mjs](../../tools/review-backend-nominations.mjs)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-031 — Accept real Cloudflare customer consent, DNS and revocation

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **blocked**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The configured OAuth flow is proven against a deliberately chosen customer-owned test zone.

### Scope

- Review exact scopes, zone and TXT/CNAME operation
- Exercise consent, inspection, exact review/confirmation, retry and disconnect
- Verify token refresh/revocation and lost provider response reconciliation
- Cover Business/Business Pro eligibility across consent, callbacks, reviewed use and queued dispatch

### Acceptance criteria

- [ ] Operator credentials never stand in for customer consent
- [ ] Only the reviewed record/resource changes
- [ ] Stale/replayed reviews and uncertain results preserve authority boundaries
- [ ] Acceptance evidence contains no tokens or customer secrets
- [ ] Starter/Creator cannot authorize provider use; eligibility loss stops new work while preserving history, disconnect/revocation and narrow uncertain-outcome reconciliation

### Verification

- pnpm test:cloudflare-connection
- pnpm test:cloudflare-dns
- pnpm test:cloudflare-token-refresh
- Live owned-zone acceptance only after exact user review

### Dependencies and blockers

Planning dependencies: WH-004, WH-001, WH-122, WH-056. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Real customer consent and an explicitly reviewed owned zone/DNS operation are required.

### References

- [docs/integrations/cloudflare-connection.md](../../docs/integrations/cloudflare-connection.md)
- [docs/integrations/cloudflare-dns.md](../../docs/integrations/cloudflare-dns.md)
- [src/cloudflare-connection.ts](../../src/cloudflare-connection.ts)
- [src/cloudflare-dns.ts](../../src/cloudflare-dns.ts)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.

## WH-032 — Configure and accept the customer GitHub App and reviewed backups

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **blocked**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers can grant scoped repository access, back up an exact reviewed version and revoke access.

### Scope

- Prepare customer GitHub App registration/callback/permission configuration
- Exercise consent and expected-head reviewed backup against an approved repository
- Verify conflict, replay, uncertain-result reconciliation and disconnect
- Cover Business/Business Pro eligibility across consent, callbacks, reviewed use and queued dispatch

### Acceptance criteria

- [ ] Repository contents match the reviewed exported artifact and target branch
- [ ] Concurrent remote changes are refused without force push
- [ ] No operator gh token substitutes for the customer App
- [ ] Disconnect prevents delayed callbacks and future writes
- [ ] Starter/Creator cannot authorize provider use; eligibility loss stops new work while preserving history, disconnect/revocation and narrow uncertain-outcome reconciliation

### Verification

- pnpm test:github-connection
- pnpm test:github-backups
- Live disposable-repository journey after owner config/consent

### Dependencies and blockers

Planning dependencies: WH-004, WH-001, WH-122, WH-056. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Customer GitHub App configuration and reviewed consent/repository are not available; operator repository access is separate.

### References

- [docs/integrations/github-app-setup.md](../../docs/integrations/github-app-setup.md)
- [docs/integrations/github-connection.md](../../docs/integrations/github-connection.md)
- [docs/integrations/github-backups.md](../../docs/integrations/github-backups.md)
- [src/github-backups.ts](../../src/github-backups.ts)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.

## WH-033 — Accept custom-domain HTTPS, fallback and disconnect

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An owned customer hostname serves the approved site with working TLS and recoverable disconnect.

### Scope

- Verify Cloudflare for SaaS account entitlement, hostname costs and fallback origin
- Prepare exact hostname/DNS/certificate activation review
- Exercise pending/error/TLS-ready/serving/withdraw/disconnect states
- Accept Whumpo-managed hostname/TLS and manual customer DNS paths without requiring Business-tier customer Cloudflare OAuth. Optional automated customer-zone DNS has separate WH-031 consent/acceptance; annual registrar benefits remain their own funding contract.

### Acceptance criteria

- [ ] Ownership proof alone is never shown as working hosting
- [ ] Foreign hosts cannot reach private workspace or another project
- [ ] Unknown provider operations recover without duplicate resources
- [ ] Recurring/minimum/overage costs and renewal responsibility are disclosed before activation

### Verification

- pnpm test:domain-hosting
- pnpm test:domain-recovery
- Live DNS/TLS acceptance only for an explicitly reviewed domain/resource plan

### Dependencies and blockers

Planning dependencies: WH-007, WH-004, WH-122. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/integrations/domain-hosting.md](../../docs/integrations/domain-hosting.md)
- [docs/domains.md](../../docs/domains.md)
- [src/domain-hosting.ts](../../src/domain-hosting.ts)
- [src/site-host.ts](../../src/site-host.ts)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.

## WH-035 — Deliver customer support independent of Chat limits

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Users can get help, inspect stuck operations and challenge usage decisions even when ordinary Chat is unavailable.

### Scope

- Extend existing usage-review capabilities with independent authenticated access
- Create actionable error/status links and operator response workflow
- Document support hours, escalation and incident communications without promising unstaffed service levels
- Deliver essential support/status independently of deferred scanner/operator activation. WH-016 later attaches its separately authorized restricted abuse-intake/case adapter; generic support must not pretend that detection or case handling is configured.

### Acceptance criteria

- [ ] Chat/onboarding/usage limits do not block recovery/export/support
- [ ] Cross-tenant tickets and internal finance/safety evidence stay private
- [ ] Saved response, successful delivery and customer read are distinct states
- [ ] External notifications require a selected provider and reviewed configuration

### Verification

- pnpm test:usage-review-requests
- Authorization, outage and delivery-retry fixtures
- Keyboard/mobile support journey

### Dependencies and blockers

Planning dependencies: WH-007, WH-010. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/usage-review-requests.md](../../docs/usage-review-requests.md)
- [docs/standard-ai-accounting.md](../../docs/standard-ai-accounting.md)
- [src/usage-review-requests.ts](../../src/usage-review-requests.ts)
- [tools/respond-usage-review.mjs](../../tools/respond-usage-review.mjs)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/135. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC: owner contact decision (issue #135) implemented in source with local verification only; not deployed, not accepted, no schema change. Customer contact starts through the Whumpo agent; the support page form remains the path when Chat is unavailable. hello@whumpo.com is fixed public source copy (lockoutContact in src/support-shape.ts) shown only as a lockout path on /workspace/support and in the signed-out passkey/recovery help; it does not bypass passkey/kit recovery. The SUPPORT_CONTACT Worker variable is removed from src/support.ts, src/secrets.d.ts and tools/secret-custody.mjs; SUPPORT_HOURS remains unset (no published hours). The 72-hour internal flag and the Chat-unavailable support link are unchanged. Local checks: node tests/support-access.mjs (9 cases) and node tests/usage-review-requests.mjs passed; pnpm check, node tools/verify.mjs fast, node tools/verify.mjs protection and pnpm build passed. tests/helpers/support-journey.mjs was updated for the lockout copy but the Playwright browser journey (pnpm test:support-browser) was not run: Playwright is not installed in this environment. Agent-led intake/readback for general help requests is not built (Chat handles usage reviews only).
- 2026-10-04 UTC: Chat help intake and response readback implemented in source on branch c/great-curie-8ryukc (draft PR #160) with local verification only; not deployed, not accepted. It changes the composed schema (usage_review_requests source check adds chat_form; insert trigger binds a chat_form row to the owner's exact submitted support-request@1 statement and stops support-page rows reusing a submission ID), so it ships only with the owner-run empty-D1 cutover. The owner agent's interaction requestSupport issues the maintained support-request@1 form (WH-105 protocol, submit binding support.request@1, model text as a suggested default); only the owner's explicit submit commits the form submission and one existing usage_review_requests help row together. No agent action submits. readSupport (single bounded lookup) returns the owner's own help statements and customer-visible responses (usage-review text excluded); showSupport issues a fixed support status view whose support.requests@1 card uses the Support page projection. Read is recorded only when the owner opens a response (Chat view or Support page, existing read receipt); agent lookups and card reads are not read receipts; delivery is unchanged. The Support page remains the identity-only fallback when Chat, limits or the welcome block Chat. hello@whumpo.com stays the lockout-only line. Local checks: node tests/support-chat.mjs (8 cases, SQLite and --d1) covering agent preparation, model-cannot-submit, DB trigger refusal, owner submit, exact/changed replay, one-open bound, foreign-owner isolation, agent readback, card read/read receipt, usage-review exclusion and Chat-unavailable/welcome-closed fallback; node tests/usage-review-requests.mjs, tests/support-access.mjs (9), chat-interaction contract/input/storage/intake/composition/model-continuation/agent/history/cards/cards-client/photos, chat-temporary-views, site-agent, prompt-data-boundaries, agent-prompt-focus, natural-chat, chat-history, saved-work, current-schema (SQLite and local D1), account-closure-inventory and workspace-view-bindings passed; pnpm check, node tools/verify.mjs fast, node tools/verify.mjs protection and pnpm build passed. Not run: browser/Playwright journeys for the new Chat form/card (Playwright not installed) and any real-model selection check. External notification remains unconfigured.

## WH-036 — Add reliable contact delivery and verified sender operations

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Site owners can receive contact notifications without losing the durable inbox or creating an open relay.

### Scope

- Research a transactional email provider and exact sender/DNS requirements
- Add reviewed destination, delivery queue, deduplication, retries and bounce state
- Keep inbox ownership, Turnstile, spam limits and safe rendering

### Acceptance criteria

- [ ] Inbound Cloudflare Email Routing is not presented as outbound transactional delivery
- [ ] Provider timeout/replay does not duplicate messages
- [ ] Sender/destination verification and unsubscribe/abuse behavior match the selected service
- [ ] Provider pricing, minimums and DNS changes receive concrete review before enablement

### Verification

- pnpm test:contacts
- Synthetic mail provider duplicate/bounce/timeout tests
- Live delivery canary only to explicitly approved addresses

### Dependencies and blockers

Planning dependencies: WH-035, WH-010, WH-052. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/contact-forms.md](../../docs/contact-forms.md)
- [src/contacts.ts](../../src/contacts.ts)
- [docs/cloudflare-capability-roadmap.md](../../docs/cloudflare-capability-roadmap.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/146. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC, branch c/great-curie-8ryukc (draft PR #160, held for the owner empty-D1 cutover because the composed schema changes): implemented locally, NOT activated. Owner decisions from issue #146 are recorded in docs/contact-forms.md: Cloudflare Email Service, notify@whumpo.com, every-minute cron over the D1 outbox (Queues not chosen), $5/month ceiling, 10/hour and 50/day caps, exact Chat review plus Dashboard control, operator-reviewed suppression reset; removal during a safety hold stays refused (open). Source: src/contact-email.ts is the Cloudflare adapter (binding shape and error codes checked against developers.cloudflare.com on October 4, 2026; no idempotency key is documented, so uncertain calls are never resent) and the only activation path, which needs the provider var, review var and CONTACT_EMAIL send_email binding. src/contact-notifications.ts adds the runner (at most one call per claimed attempt, a 32-day ledger ceiling of 14,285 calls refused in the database), contact_destination_reviews (exact Chat review) and Dashboard routes and UI. tools/contact-suppression-reset*.mjs adds the preview/digest operator reset with an immutable audit row. No binding, var, cron, DNS or domain onboarding was added, nothing was deployed, and there was no live canary. Tests use synthetic transports only (pnpm test:contacts plus related suites, as listed in the PR). Remaining: owner activation steps, sending-domain DNS approval, re-verified beta pricing and plan entitlement, a live canary to approved addresses, and Queues-based bounce event intake (not chosen).

## WH-037 — Make site health and analytics useful and privacy-safe

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Owners can distinguish publication, DNS/TLS, form and traffic problems from incomplete telemetry.

### Scope

- Extend existing health/traffic cards with clear supported diagnostics
- Define bot/error exclusions, retention and delayed/missing-data states
- Provide recommended exact actions without arbitrary provider mutation
- Expose routine owner operations through WH-105 registered read/action bindings and WH-107/109/110 Chat/view adapters; implement domain handlers once. Feature acceptance uses the shared owner surface, with essential direct recovery/security controls retained.

### Acceptance criteria

- [ ] Analytics show only owned projects and disclose partial/delayed samples
- [ ] No raw visitor identifiers or customer request bodies in UI
- [ ] Published version, domain state and evidence timestamp are visible
- [ ] Traffic measurement overhead is budgeted and does not block serving

### Verification

- pnpm test:site-health
- node tests/site-traffic.mjs
- Synthetic missing/late/failed telemetry and cross-owner tests

### Dependencies and blockers

Planning dependencies: WH-006, WH-025, WH-109. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/site-health.md](../../docs/site-health.md)
- [docs/unified-workspace-and-capacity.md](../../docs/unified-workspace-and-capacity.md)
- [src/site-health.ts](../../src/site-health.ts)
- [src/site-traffic.ts](../../src/site-traffic.ts)
- [frontend/src/traffic-card.tsx](../../frontend/src/traffic-card.tsx)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/139. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-038 — Resume and accept the first real native CMS customer journey

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **blocked**. Kind: verification. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

When the owner resumes CMS work, one approved instance proves its full private-edit and reviewed-publication lifecycle.

### Scope

- Review concrete per-project resources, cost, deployment bindings and rollback
- Provision only after renewed authorization
- Exercise private image/import/edit/review/publish/withdraw and tenant isolation

### Acceptance criteria

- [ ] Instance identity and bindings match the reviewed project
- [ ] Native/content/control receipts recover interrupted responses
- [ ] Safety holds apply before any real media is served
- [ ] Physical-device and live-native evidence is separate from existing local browser acceptance

### Verification

- pnpm test:cms-projects
- pnpm test:cms-provision
- Existing native browser journey only after owner resumes CMS acceptance
- Live provisioning needs concrete capability/resource review

### Dependencies and blockers

Planning dependencies: WH-013, WH-008, WH-004. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- CMS testing is explicitly owner-deferred. Do not provision or run CMS feature acceptance until that decision changes.

### References

- [docs/emdash.md](../../docs/emdash.md)
- [src/cms-provision.ts](../../src/cms-provision.ts)
- [src/cms-deploy.ts](../../src/cms-deploy.ts)
- [tools/provision-cms.mjs](../../tools/provision-cms.mjs)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-040 — Complete quiescent CMS backup and provider recovery

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **blocked**. Kind: verification. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

CMS recovery includes content, media, keys/artifacts and control/publication state with an exact reviewed cutover.

### Scope

- Extend existing logical DB/media captures and local native restore
- Coordinate writes and capture matching control/configuration state
- Rehearse isolated provider restore and reviewed route switch when authorized

### Acceptance criteria

- [ ] Capture manifest proves consistent database/media/control identity
- [ ] Native boot, content/media fidelity and deletion replay succeed
- [ ] RPO/RTO measured; partial capture and wrong target fail closed
- [ ] No traffic switch or paid restore resources without explicit review

### Verification

- pnpm test:cms-database-snapshot
- pnpm test:cms-media-snapshot
- pnpm test:cms-d1-restore
- Provider drill after CMS resumption and resource approval

### Dependencies and blockers

Planning dependencies: WH-038, WH-019. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- CMS feature testing remains owner-deferred; provider restore/traffic switch also requires a concrete reviewed resource plan.

### References

- [docs/emdash.md](../../docs/emdash.md)
- [tools/snapshot-cms-database.mjs](../../tools/snapshot-cms-database.mjs)
- [tools/verify-cms-recovery.mjs](../../tools/verify-cms-recovery.mjs)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-057 — Run cohort learning and prioritize demonstrated demand

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Expansion decisions are driven by activation, retention and customers completing real tasks.

### Scope

- Review aggregate funnel and support reasons after each bounded cohort
- Draft interviews and collect feedback only with authorized outreach
- Compare website/app use cases, value and support burden

### Acceptance criteria

- [ ] Report sample size and uncertainty rather than overstating product-market fit
- [ ] Separate model quality, usability, unmet capability and operational failures
- [ ] Choose the next small experiment with measurable success/stop criteria
- [ ] No paid acquisition or unsolicited customer contact by an agent

### Verification

- Aggregate privacy-reviewed reports
- Reconcile complaints with exact operation receipts without exposing customer content
- Update roadmap priorities and decision log with evidence

### Dependencies and blockers

Planning dependencies: WH-048, WH-025. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/README.md](../../docs/roadmap/README.md)
- [docs/onboarding.md](../../docs/onboarding.md)
- [docs/usage-review-requests.md](../../docs/usage-review-requests.md)
- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-058 — Continuously evaluate supported generation and action honesty

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Model/prompt/component changes cannot silently degrade accepted site/app outcomes or claim unperformed actions.

### Scope

- Promote representative benchmark fixtures into release evaluation
- Include unsafe/unsupported asks, prompt injection, edit preservation and recovery
- Record model/prompt/tool/component versions and quality/cost changes
- Evaluate configuration/composition selection and justified custom-code fallback for owner maintenance; standard visitor/service execution must have zero maintainer dispatches, including errors and retries
- Extend owner evaluations with maintained/custom form selection, bounded answer continuation, target correction, saved-view changes and authority-safe fallback when WH-108 is delivered

### Acceptance criteria

- [ ] Evaluators distinguish prepared, confirmed and completed operations
- [ ] Regression thresholds and human review criteria are documented
- [ ] Customer private content is not harvested into fixtures
- [ ] New paid evaluations or provider routes require their own budget approval

### Verification

- Offline deterministic evaluation plus selected approved real-model samples
- pnpm test:customer-site-journey
- pnpm test:customer-app-journey
- Compare quality/cost to WH-020 baseline

### Dependencies and blockers

Planning dependencies: WH-020, WH-026, WH-028. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/workspace-agent.md](../../docs/workspace-agent.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [tests/customer-site-journey.mjs](../../tests/customer-site-journey.mjs)
- [tests/customer-app-journey.mjs](../../tests/customer-app-journey.mjs)
- [src/ai-chat.ts](../../src/ai-chat.ts)
- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-061 — Complete directory hosting, health and sustainable receipt retention

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Directory owners can maintain a live snapshot on supported domains without eventually hitting an unrecoverable private-test receipt ceiling.

### Scope

- Verify directory paths on approved custom hostnames and connect health/status checks
- Design review/history retention around immutable evidence and active references
- Evaluate bounded bulk import/schema expansion only after the existing lifecycle is complete

### Acceptance criteria

- [ ] Directory publication, JSON/export, draft restore and custom-host serving agree on exact approved snapshot
- [ ] Retention never deletes active review/unknown-operation authority or referenced versions
- [ ] Routine review turnover does not require raw operator database edits
- [ ] New schemas/imports get separate scoped reviews and preserve tenant isolation

### Verification

- pnpm test:directories
- pnpm test:directory-history
- Synthetic review-cap/retention/restore tests and approved-domain acceptance

### Dependencies and blockers

Planning dependencies: WH-033, WH-037, WH-009. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/directories.md](../../docs/directories.md)
- [docs/version-retention.md](../../docs/version-retention.md)
- [docs/site-health.md](../../docs/site-health.md)
- [docs/integrations/domain-hosting.md](../../docs/integrations/domain-hosting.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-063 — Define verified email changes and compromised-account recovery

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Owners can change an account email or respond to compromise without mistaking the current unverified identifier for proven ownership.

### Scope

- Define verified address change with fresh authentication, pending expiry and notification
- Coordinate current passkey/session, recovery-kit and provider-connection compromise review; current-policy repair cannot revive retired password authority
- Keep ordinary lost-passkey recovery separate from broader compromise actions

### Acceptance criteria

- [ ] An unverified email cannot become a new recovery or authorization factor
- [ ] Response loss, stale confirmation and concurrent sign-in cannot restore compromised authority
- [ ] Provider revocation preserves reconciliation authority before credential erasure
- [ ] No real customer address/credential change occurs during synthetic acceptance
- [ ] Recovery secrets grant only the shared restricted enrollment authority; emergency credential revocation is allowed below the two-key count, and compromise review never fabricates encrypted-content recovery

### Verification

- Existing owner recovery/passkey/profile tests selected by changes
- Synthetic email verification replay/expiry/competing-change tests
- Physical-device and approved delivery canary evidence before activation

### Dependencies and blockers

Planning dependencies: WH-005, WH-035, WH-036. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/owner-recovery.md](../../docs/owner-recovery.md)
- [docs/deployment.md](../../docs/deployment.md)
- [docs/account-closure.md](../../docs/account-closure.md)
- [frontend/src/identity/flow.tsx](../../frontend/src/identity/flow.tsx)
- [frontend/src/profile-picture-picker.tsx](../../frontend/src/profile-picture-picker.tsx)
- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-092 — Deliver expiring private preview links and guest feedback

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A Creator shares one immutable private preview for accountless comments and can revoke access without granting workspace or release authority.

### Scope

- Bind expiring revocable guest capability to an exact owner/project/version and approved preview assets
- Add guest comments and owner resolution with safe rendering, abuse/rate limits and lifecycle/export coverage; unverified display names are not verified identities
- Keep feedback separate from edits, team membership, publication approval, spending and model authority
- Split link/asset authority, comment lifecycle and browser acceptance; remove access when the referenced preview is removed or no longer permitted
- Expose routine owner operations through WH-105 registered read/action bindings and WH-107/109/110 Chat/view adapters; implement domain handlers once. Feature acceptance uses the shared owner surface, with essential direct recovery/security controls retained.
- Use WH-116 feedback/guest-capability data classification before storage and WH-105 registered owner bindings before clients. Guest capabilities remain separate from member identity and cannot grant workspace access.

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] No Whumpo account is required; guests see only the exact preview/allowed assets, never source exports, other versions, account data or secrets
- [ ] Expiry/revocation/removal stops reads and comments across asset aliases, caches and in-flight races
- [ ] Comment markup and embedded instructions remain inert and cannot publish, spend, expand sharing or invoke the maintainer
- [ ] Owner resolution, deletion/export, retention and safety-preservation behavior are explicit and tested

### Verification

- Guest/owner/foreign-tenant matrix with expiry/revocation, token replay, asset aliases and cache checks
- Comment injection, duplicate/stale posting, deletion and retention fixtures
- Accountless mobile/keyboard preview/comment/revoke journey with synthetic approved assets

### Dependencies and blockers

Planning dependencies: WH-089, WH-066, WH-004, WH-009, WH-010, WH-122, WH-105, WH-116, WH-150, WH-151, WH-152, WH-153. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/mvp.md](../../docs/mvp.md)
- [docs/version-retention.md](../../docs/version-retention.md)
- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/project-specification-storage.md](../../docs/project-specification-storage.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/plan-feature-contract.md](../../docs/plan-feature-contract.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/121. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.
- 2026-10-04 UTC: decomposed into WH-150 (link authority, isolated delivery, bounded feedback, owner API and lifecycle; implemented in source with local tests), WH-151 (shared Chat/view adapters), WH-152 (browser acceptance) and WH-153 (release and live acceptance). The parent stays open until all four pass.

## WH-093 — Extend maintained records into the Business lead pipeline

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Business owners track accepted enquiries through stages, notes and due dates while retaining submission identity and private record ownership.

### Scope

- Extend maintained form records with typed lead stages, notes, due dates, bounded filters and revision-checked updates
- Reuse scoped inbox access and durable submission identities instead of generating another CRM/storage backend
- Specify lead lifecycle, export/deletion and retention separately from the current 30-day contact inbox
- Keep Business owner-operated; approved staff notification destinations do not grant Pro workspace membership
- Expose routine owner operations through WH-105 registered read/action bindings and WH-107/109/110 Chat/view adapters; implement domain handlers once. Feature acceptance uses the shared owner surface, with essential direct recovery/security controls retained.

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] Duplicate delivery creates one lead; accepted records survive subsequent notification failure
- [ ] Cross-owner access, stale note/stage updates and deleted-record resurrection are refused
- [ ] Current contact expiry is not silently changed to indefinite CRM retention; deletion/export retain required minimal receipts
- [ ] Private lead/message content is not automatically added to maintainer context

### Verification

- Existing contact/module tests plus duplicate intake and concurrent lead transitions
- Owner/foreign-tenant filters, export/deletion and due-date/timezone cases
- Connected inbox-to-stage/note/due-date browser journey

### Dependencies and blockers

Planning dependencies: WH-089, WH-067, WH-009, WH-122. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [src/contacts.ts](../../src/contacts.ts)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/plan-feature-contract.md](../../docs/plan-feature-contract.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.

## WH-095 — Report Business submission and lead conversion outcomes honestly

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Business owners compare accepted submissions and lead-stage outcomes using explicit periods and denominators without fabricated visitor attribution.

### Scope

- Add privacy-safe aggregate submission/lead-transition events with stable identities and project scope
- Define reporting windows, exclusions, conversion denominators, event-time corrections and missing/delayed-data states
- Present results alongside health/traffic without raw visitor identifiers or message bodies
- Apply lifecycle/export/deletion rules to aggregates and minimal reconciliation receipts
- Expose routine owner operations through WH-105 registered read/action bindings and WH-107/109/110 Chat/view adapters; implement domain handlers once. Feature acceptance uses the shared owner surface, with essential direct recovery/security controls retained.

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] Successful HTML GET counts remain request counts, including disclosed repeats/bots/checks; never label them unique visitors
- [ ] Repeated delivery/stage changes cannot double-count a defined conversion; missing evidence is not zero
- [ ] Only authorized project data is reported with period, denominator and collection coverage
- [ ] Telemetry failure does not block visitor serving or accepted lead intake

### Verification

- Known-count fixtures for duplicates, delayed/out-of-order events, stage reversals and partial periods
- Tenant filters, deletion/retention and unavailable denominator cases
- Accessible browser charts/tables and honest empty/partial-data states

### Dependencies and blockers

Planning dependencies: WH-093, WH-037, WH-025, WH-009. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [docs/unified-workspace-and-capacity.md](../../docs/unified-workspace-and-capacity.md)
- [src/site-traffic.ts](../../src/site-traffic.ts)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-105 — Define the primary Chat experience and interactive element contract

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **ready**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Implementers have one bounded contract for owner Chat forms, task context, agent-managed views and exact action handoffs.

### Scope

- Inventory supported routine journeys and current controls; specify Chat as the primary surface and infrequent authentication, consent, preview and recovery handoffs
- Freeze versioned interaction IDs, definition digests, field and binding schemas, templates, presentation hints, answer states, request identities and client negotiation
- Define short predesigned forms and bounded custom composition; distinguish owner intake from WH-066/067 visitor forms and WH-070 customer app presentation
- Specify retention/model-context rules, target-project changes, cancel/resume/correction, view revisions and deterministic current-version recovery
- Use an existing-project content-change brief, private preview and exact review as the first complete slice
- Freeze actor/project/feature eligibility and binding IDs using WH-113/089, including future membership and denied/read-only states; share these contracts across web, native and feature adapters.

### Acceptance criteria

- [ ] Concrete examples map each field/control to a registered handler or read binding, with explicit size/depth/count bounds and rejected unknown fields
- [ ] Collecting answers, preparing a private change and approving consequential effects have separate authority and receipt states
- [ ] Agent-managed presentation preserves user correction/dismissal, essential direct controls and current publication/provider/spending gates
- [ ] Web/native use the current interaction schema only; stale clients/schemas fail explicitly without downgrade rendering or inferred action authority
- [ ] Source inventory names delivered foundations and missing work; live issue/dependency evidence is refreshed before claims

### Verification

- Validate representative template/custom-form/view and malformed schema examples against current action and review contracts
- Trace the first vertical slice through Chat, transcript, dashboard and delivery modules; review lifecycle and compatibility cases
- Run node tools/roadmap.mjs validate, render, render --check and git diff --check for the contract update

### Dependencies and blockers

Planning dependencies: WH-113, WH-089. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)
- [docs/natural-language-chat.md](../../docs/natural-language-chat.md)
- [docs/unified-workspace-and-capacity.md](../../docs/unified-workspace-and-capacity.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/android-app.md](../../docs/android-app.md)
- [src/chat-controls.ts](../../src/chat-controls.ts)
- [src/chat-review-receipts.ts](../../src/chat-review-receipts.ts)
- [src/workspace-dashboard.ts](../../src/workspace-dashboard.ts)
- [frontend/src/workspace.tsx](../../frontend/src/workspace.tsx)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/workspace-identity.md](../../docs/workspace-identity.md)
- [docs/plan-feature-contract.md](../../docs/plan-feature-contract.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)
- [src/chat-interactions/protocol.ts](../../src/chat-interactions/protocol.ts)
- [tests/chat-interaction-contract.mjs](../../tests/chat-interaction-contract.mjs)
- [tests/fixtures/chat-interactions.json](../../tests/fixtures/chat-interactions.json)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/51. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: accepted planning direction against 628c16f and the existing working tree; implementation and customer acceptance remain open. Live GitHub refresh was blocked by local command approval policy; no issue or claim created.
- 2026-10-01: WH-105 source-grounded interaction v1 decision and offline reference/fixtures prepared against 26b9fa4 under issue #51. WH-113/#42 and WH-089/#44 completion evidence refreshed before claim. Owner amendment removes legacy/unsupported-client fallback; current-version-only rejection replaces downgrade rendering. 63 offline contract/compiler/control cases pass. Production storage/admission/rendering remain WH-106–112; no runtime or deployment change.

## WH-106 — Persist and submit typed Chat interactions with exact readback

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **ready**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Forms and their submitted answers survive reloads and interrupted requests without duplicate work or lost authority boundaries.

### Scope

- Extend the complete current schema with issued definitions, answer revisions, immutable submissions and separate downstream operation receipts; initialize disposable current fixtures or a reviewed empty test database, without numbered migration replay or old readers
- Implement owner-scoped read, draft/save, submit, cancel and resume adapters with strict schemas, current actor/project authority and expected revisions
- Bind stable submission IDs to exact payloads and recover committed state after lost acknowledgements without automatic effect redispatch
- Extend history/export and lifecycle inventory for definitions, answers and attachment references; minimize model and local-device copies
- Implement the content-change-brief fixture through existing domain handlers rather than a generic command or network proxy
- Enforce WH-122 shared current feature decisions when issuing, submitting and handing off interactions; protected history/readback remains scoped to current actor authority. Do not retrofit plan checks into a second interaction permission system later.

### Acceptance criteria

- [ ] Atomic submission and exact same-ID replay produce one answer receipt and at most one admitted downstream operation; changed payloads conflict
- [ ] Foreign, expired, superseded, stale and malformed interactions cannot submit; two tabs/devices cannot overwrite newer answers
- [ ] Submitted answers remain recoverable when a later action or inference fails; unknown outcomes remain distinct from completion
- [ ] Opening, reading, rendering and polling an interaction makes no model call and cannot confirm publication or any other review
- [ ] Export/deletion/retention and logout/account switching preserve ownership and remove private caches without reviving old approvals
- [ ] Passwords, recovery codes, OAuth secrets and payment credentials cannot be requested through custom definitions or added to model context

### Verification

- Add focused disposable-D1 interaction state, atomicity, ownership, concurrent submission and lost-acknowledgement tests
- Run pnpm check, node tests/natural-chat.mjs, node tests/chat-history.mjs and node tests/chat-delivery.mjs where adapters change
- Exercise answer-save then failed continuation and exact receipt recovery with scripted inference; no live provider calls

### Dependencies and blockers

Planning dependencies: WH-105, WH-004, WH-009, WH-116, WH-122. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)
- [docs/natural-language-chat.md](../../docs/natural-language-chat.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [src/chat-controls.ts](../../src/chat-controls.ts)
- [src/chat-history.ts](../../src/chat-history.ts)
- [src/chat-transcript.ts](../../src/chat-transcript.ts)
- [frontend/src/lib/chat-delivery.ts](../../frontend/src/lib/chat-delivery.ts)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)
- [src/chat-interactions/protocol.ts](../../src/chat-interactions/protocol.ts)
- [src/chat-interactions/store.ts](../../src/chat-interactions/store.ts)
- [src/chat-interactions/continuation.ts](../../src/chat-interactions/continuation.ts)
- [tests/chat-interaction-storage.mjs](../../tests/chat-interaction-storage.mjs)
- [src/chat-interactions/agent.ts](../../src/chat-interactions/agent.ts)
- [tests/chat-interaction-agent.mjs](../../tests/chat-interaction-agent.mjs)
- [src/chat-interactions/history-shape.ts](../../src/chat-interactions/history-shape.ts)
- [frontend/src/chat-interaction-history.tsx](../../frontend/src/chat-interaction-history.tsx)
- [frontend/src/chat-history-dialog.tsx](../../frontend/src/chat-history-dialog.tsx)
- [tests/chat-interaction-history.mjs](../../tests/chat-interaction-history.mjs)
- [tests/chat-interaction-browser.mjs](../../tests/chat-interaction-browser.mjs)
- [src/chat-interactions/maintained.ts](../../src/chat-interactions/maintained.ts)
- [tests/chat-interaction-intake.mjs](../../tests/chat-interaction-intake.mjs)
- [src/chat-interactions/submitted-context.ts](../../src/chat-interactions/submitted-context.ts)
- [frontend/src/chat-resource-picker.tsx](../../frontend/src/chat-resource-picker.tsx)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/87. Planning owner: Codex /root (codex/identity-admission). Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: accepted planning direction against 628c16f and the existing working tree; implementation and customer acceptance remain open. Live GitHub refresh was blocked by local command approval policy; no issue or claim created.
- 2026-10-02 UTC: removed stale numbered-additive-migration wording from active scope to match WH-120 and the complete-current-schema contract. Implementation uses current fixtures/reviewed empty test databases. Feature scope, dependencies and acceptance remain unchanged; this amendment does not implement the feature.
- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.
- 2026-10-02 UTC: claimed #87 from c87aa04 in codex/identity-admission. Current TypeScript protocol, bounded input, durable content-brief drafts/submissions/continuation, scoped HTTP and nonactionable history/export are implemented in source. Full packet acceptance remains open: generalized maintained/custom adapters, correction/resume and lifecycle/client integration, remaining race cases and deployment. WH-107/108 renderer and semantic agent admission are downstream; no custom credential collection is activated.
- 2026-10-02 UTC: linked content-brief replacement, bounded owned resume index and explicit local-preview reconciliation implemented over aa0ee3e. Replacements preserve immutable prior answers, re-read current website baselines and atomically reject competing edits/claims or revoked authority. History/export include nonactionable correction links. Recovery fences interrupted local preparation without redispatch or inventing provider outcomes. Source only; issue #87 remains open for original lifecycle/resource/client and connected acceptance, with no deployment or deferred provider work.
- 2026-10-02 UTC: owner approved LC-10, seven days of inactivity for unsubmitted Chat form drafts. Current source adds immediate cutoff filtering, fixed bounded hourly payload cleanup, immediate cancel/discard cleanup, retained replay metadata, draft-inclusive Chat exports and content-free maintenance backlog/health. Submitted answers and unresolved continuations remain excluded. Original account/attachment/restore/client and renderer/agent acceptance stays open; source only, no deployment or new retention policy for other classes.
- 2026-10-02 UTC: current content-brief client connected under #87: owned Chat pointers, typed current readback, exact request-hash recovery, seven-day local drafts with independent unresolved retention, account-switch/sign-out clearing and late-response fencing. Inline validation/collapse/draft/discard and explicit private-preview continuation provide the first WH-107 handoff. Original generalized/resource/history/resume/agent, lifecycle/restore and reviewed deployment acceptance remains open; no new public issuer or provider activation.
- 2026-10-02 UTC: maintained content-brief agent handoff under #87 connects requestContent/read/replaceContent to the existing bounded owner Chat loop. Prepared form writes commit with the final Chat result; model reads receive metadata only. Content forms now match the compiler limit of eight operations. Scripted actual HTTP/SQLite/local-D1 journeys cover lookup, correction, exact private preview/save, replay and late authority/base/answer changes. Broader custom/resource/lifecycle/restore and deployment acceptance remains open; no live inference or publication.
- 2026-10-02 UTC: current content-form history and paged resume connected under #87. Read-only submitted/removal facts exclude copied unsubmitted defaults; the unfinished index locates forms beyond 100 Chat turns and opens only current scoped readback. Existing-card navigation avoids duplicate editors; dialog dismissal preserves eligible local edits and evicts private queries. Full original lifecycle/resource/restore and coordinated deployment acceptance remains open.
- 2026-10-02 UTC: maintained project-brief/project-select storage and scoped project-resource HTTP reads extend the same issuance/mutation handlers. Information-only submission has no continuation, project creation or automatic task retargeting. Fresh selected-resource ownership is rechecked inside the write transaction, with exact loss/replay and truthful history/export. Initial trusted storage handoff only; renderer/agent activation, broader resource/custom/lifecycle/restore and deployment acceptance remain open.
- 2026-10-02 UTC: maintained project brief/selection renderer and closed agent issuers connect the prior storage handoff. Native owned-project picker, shared drafts/exact recovery and information-only submission start no automatic work. Subsequent owner Chat can inspect an exact submitted intake through the existing bounded lookup; ordinary context stays metadata-only. Agent inspection/provider copies are registered in lifecycle docs. General custom/resource/device/model-quality/lifecycle/restore and coordinated deployment acceptance remain open.
- 2026-10-02 UTC: same-task project-intake corrections now reuse shared guarded replacement storage. Immutable prior submissions, carried user defaults across untouched chains, fresh copied-project ownership, revision/retention/authority fences and exact lost-response replay connect through metadata-only agent lookup and the current mobile renderer. This also fixes content correction chains losing earlier user text. No schema, public arbitrary issuer, automatic work or deployment; original broader acceptance remains open.
- 2026-10-02 cleared-draft correction: current reads distinguish no draft (null) from a saved complete empty snapshot. Renderer and replacement handlers never merge omitted answers back from defaults; blank required text can be carried as a user default but still fails submission, and native resource clearing omits the UUID key. Regression reproduced before fix. 69 protocol cases, 20 intake cases on SQLite/local D1, 38 content-storage cases on local D1, 20 scripted agent cases on SQLite and full built-workspace HTTP/local-D1 mobile lost-response/reload/correction checks pass. Type/compiler and current history/client/prompt checks pass. Source/local only; no deployment. See docs/chat-interactions.md and docs/verification.md. Original WH-106 acceptance still governs closure; WH-107/108 own broader renderer and custom agent composition.
- 2026-10-02 final WH-106 original-scope audit: the shared storage/receipt/privacy/lifecycle foundation is accepted on the current disposable schema. The audit reproduced account deletion erasing pending continuation custody; a pre-delete current-schema guard now preserves pending/unknown receipts until explicit reconciliation and permits unrelated or terminal-account cascades. All 39 storage scenarios and 21 scripted Chat agent scenarios pass on SQLite/local D1, including rejected/uncertain model follow-up with immutable answer/receipt recovery and no redispatch. Type/compiler, lifecycle catalogue and closure-inventory checks pass; unchanged renderer/cache behavior retains the 291baf4 browser evidence. Six original acceptance criteria map to source/tests in docs/chat-interactions.md; deployment was not required by the fixture option. General renderer/custom composition remain WH-107/108; whole-account closure/restore remain WH-018/008. No deployment, external inference, paid activation, CMS functional testing, CSAM or Daybreak.

## WH-107 — Render accessible Chat forms and maintained interaction templates

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The agent can present useful predesigned forms and review/status elements directly inside the conversation.

### Scope

- Build a shared Whumpo-owned renderer for bounded fields, summaries, comparisons, status and owned preview links
- Create versioned templates for project selection, project brief, website-change brief and choices using existing components and handlers
- Support inline forms first, with expandable panels and dismissible dialogs/sheets when needed; maintain a durable transcript entry
- Add required/optional labels, prefill provenance, field errors, correction, cancellation, resumption and text-answer alternatives
- Complete the existing-project brief-to-preview-to-exact-review connected slice before broad template expansion

### Acceptance criteria

- [ ] A template is selected by registered identity and version; clients reject unknown actionable schemas and keep history readable
- [ ] Validated answers prepare the intended change; existing server review metadata remains the only source of approval controls
- [ ] Reload, navigation and dialog dismissal retain eligible answers and never resubmit an action or force a dismissed popup open
- [ ] Keyboard/screen-reader focus, error association, dialog close/return, mobile keyboard and 360/390px behavior have inspected evidence
- [ ] Current review disclosures, request recovery and current-format retained history remain accurate; no older-schema decoder or model HTML/code rendering

### Verification

- Add focused renderer/template and connected real-handler browser fixtures for success, validation, correction and resumption
- Use the committed build/browser verification workflow; inspect screenshots and perform keyboard/screen-reader checks. Adopt the separate quality-manager work only after it is merged and verified
- Run pnpm check and focused chat-reply, chat-delivery and customer-site-journey tests for modified paths; report fixture versus device scope

### Dependencies and blockers

Planning dependencies: WH-106. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)
- [frontend/src/workspace.tsx](../../frontend/src/workspace.tsx)
- [frontend/src/chat-turn-actions.tsx](../../frontend/src/chat-turn-actions.tsx)
- [frontend/src/chat-history-dialog.tsx](../../frontend/src/chat-history-dialog.tsx)
- [frontend/src/components/ui/dialog.tsx](../../frontend/src/components/ui/dialog.tsx)
- [docs/verification.md](../../docs/verification.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)
- [frontend/src/chat-interaction-history.tsx](../../frontend/src/chat-interaction-history.tsx)
- [tests/chat-interaction-history.mjs](../../tests/chat-interaction-history.mjs)
- [tests/chat-interaction-browser.mjs](../../tests/chat-interaction-browser.mjs)
- [frontend/src/chat-interaction-field.tsx](../../frontend/src/chat-interaction-field.tsx)
- [frontend/src/chat-date-time-field.tsx](../../frontend/src/chat-date-time-field.tsx)
- [frontend/src/lib/interaction-fields.ts](../../frontend/src/lib/interaction-fields.ts)
- [tests/chat-interaction-fields.mjs](../../tests/chat-interaction-fields.mjs)
- [tests/chat-interaction-fields-browser.mjs](../../tests/chat-interaction-fields-browser.mjs)
- [frontend/src/chat-resource-picker.tsx](../../frontend/src/chat-resource-picker.tsx)
- [src/chat-interactions/resource-options.ts](../../src/chat-interactions/resource-options.ts)
- [src/chat-interactions/resource-shape.ts](../../src/chat-interactions/resource-shape.ts)
- [tests/chat-resource-options.mjs](../../tests/chat-resource-options.mjs)
- [frontend/src/mobile-workspace.tsx](../../frontend/src/mobile-workspace.tsx)
- [tests/helpers/chat-viewport.mjs](../../tests/helpers/chat-viewport.mjs)
- [tests/helpers/orca-output.mjs](../../tests/helpers/orca-output.mjs)
- [tests/chat-screen-reader.mjs](../../tests/chat-screen-reader.mjs)
- [docs/chat-test-release.md](../../docs/chat-test-release.md)
- [tests/helpers/live-chat.mjs](../../tests/helpers/live-chat.mjs)
- [docs/chat-renderer-acceptance.md](../../docs/chat-renderer-acceptance.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/90. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: accepted planning direction against 628c16f and the existing working tree; implementation and customer acceptance remain open. Live GitHub refresh was blocked by local command approval policy; no issue or claim created.
- 2026-10-02 UTC: WH-106/#87 delivers the initial inline content-change@1 client and connected transport/recovery fixture as a bounded handoff. This is not a claim/completion of WH-107: broader maintained templates/cards, historical renderer, resource/custom adapters, dialogs, full accessibility/device acceptance and agent integration remain under the original packet. WH-106 is still open; dependencies and planning readiness are unchanged.
- 2026-10-02 UTC: WH-106/#87 adds the bounded content-form historical renderer and existing-dialog resume handoff. Actual HTTP/local-D1 browser evidence covers 110 later turns, pagination, dismissal/recovery, private cache eviction, current removal and mobile/focus behavior. General templates/cards, resource/custom adapters, spoken screen-reader and physical-device acceptance remain under the original WH-107 packet; no claim or completion, dependency/readiness unchanged.
- 2026-10-02 UTC: WH-106/#87 supplies maintained project-brief/project-select renderer and agent handoffs, including native owned selection and exact submitted-intake inspection. This does not claim or complete this task; original broader scope, dependencies and readiness remain unchanged.
- 2026-10-02 source cecef97: WH-106/#87 closed after its original storage/privacy/lifecycle audit. Existing maintained website/project forms, linked corrections, exact receipt recovery and mobile browser checks are reusable partial WH-107 evidence; broader bounded field/display and maintained choice coverage, accessibility and text alternatives remain this packet. Execution claimed by the current root on codex/identity-admission in issue #90. No deployment or full renderer/device acceptance claimed.
- 2026-10-02 UTC: WH-107/#90 adds the fixed choice@1 writing-style form, shared maintained field renderer and requestWritingStyle action through existing intake issuance, admission, corrections, exact receipts and selected submitted-answer inspection. Verified 22 intake and 23 scripted agent scenarios on SQLite/local D1; actual HTTP/built-workspace browser covers keyboard radio selection/error focus, 360/390px touch rows, clearing and repeated corrections, lost responses/reload and zero automatic continuation. General bounded fields/cards, full presentation/accessibility and the original complete renderer acceptance remain open. No schema change, deployment, provider call, customer publication or full WH-107 closure.
- 2026-10-02 UTC: WH-107/#90 adds the maintained project-status panel to current website briefs through the existing interaction API and shared Dashboard projection. Ten actual-handler scenarios on SQLite/local D1 cover ownership, exact binding, unavailable/denied reads, late revocation/transfer and no side effects. Built-workspace HTTP/D1 browser evidence covers closed-by-default behavior, keyboard open, 360/390px targets, refresh/recovery, stale-data hiding and private cache eviction. Type/build, protocol/history/lifecycle and Chat/site-journey checks pass. Broader fields, summary/comparison/preview displays and full presentation/accessibility acceptance remain open. No schema or deployment change; WH-109 continues to own persistent views.
- 2026-10-02 UTC: WH-107/#90 adds the shared exact website comparison display inside Chat, reusing existing immutable proposals, current owner/feature/identity/safety/base checks and protected previews. Nine actual-handler scenarios pass on SQLite/local D1; built-workspace browser covers keyboard/mobile before-after facts, outage recovery, closed reload, private cache eviction and no approval on rendering. Existing specification and Chat/site journeys, type/build, protocol and lifecycle checks pass. Summary/comparison and owned preview presentation now have current local evidence; broader bounded fields and complete presentation/accessibility acceptance remain open. No new schema or deployment; custom composition/views retain WH-108/109 scope.
- 2026-10-02 UTC: WH-107/#90 adds shared multiple-choice, explicit boolean, number, date and zoned date/time controls. Explicit snapshots validate typed wire values while local recovery retains unfinished input, zero, false and empty lists. Helper/protocol/recovery checks cover ranges, exact receipts and skipped/repeated local times; the actual shared components pass keyboard, 360/390px, reload, clearing and no-effect checks in Chromium with a different device timezone. The existing maintained-form HTTP/local-D1 journey and Chat/site/type/build checks pass. These components do not enable runtime custom issuance or new agent actions. Owned photo/attachment and multiple-resource adapters plus complete presentation/accessibility acceptance remain open. No schema change or deployment; WH-108 owns custom composition.
- 2026-10-02 UTC: WH-107/#90 replaces the single-purpose project chooser with shared single/multiple resource and metadata-only photo controls. The maintained project route now requires the current digest and registered read eligibility, refuses replaced forms and checks fresh owned metadata; the shared domain adapter reuses the existing photo inventory clearance predicate. Seven domain/shape cases pass on SQLite/local D1 and 23 maintained intake cases cover current HTTP contracts. Component browser checks cover keyboard, caps, literal metadata, clearing/reload, no image requests and 360/390px touch layout. Runtime photo/custom issuance remains refused pending connected intake, submit and copy-lifecycle admission. Complete WH-107 presentation/accessibility remains open; no schema, scanner or deployment change.
- 2026-10-02 UTC: maintained requestPhotoUpload now issues a fixed project-scoped Chat view using the existing sealed interaction/task store and shared Photos uploader. Exact unresolved metadata is persisted before PUT; reload reads status without resend and requires matching cleaned bytes for explicit original-ID retry. View cancel preserves upload custody, while draft/submit and model-supplied upload content are refused. Actual HTTP/local D1/R2 browser, scripted agent, file/recovery and current history checks verify lost replies, tenant/account boundaries, storage failure, phone layouts and held-image non-display. No photo-bearing answers/custom composition, scanner, schema or deployment; full WH-107 accessibility/presentation acceptance remains open. See docs/photos.md, docs/chat-interactions.md and docs/verification.md.
- 2026-10-02 UTC: mobile history sheets track visible bottom/scroll and layout-resizing keyboards, preserve reading space and avoid zoom/transition lag. Heading entry, reverse Tab/arrow navigation, inline cancel/return, removed-action result focus and delayed-response focus custody have connected browser checks. The opt-in isolated Orca 50.2 runner passes seven real speech-generation checkpoints through the actual built workspace/local HTTP/D1/R2 journey; phone keyboards are simulated, with inspected 360/390px and enlarged-text screenshots. This is not human listening or physical-device acceptance. No protocol/schema, deployment, provider, CMS, scanner or Daybreak change; original remaining WH-107 acceptance and WH-108/109/112 scope remain open. See docs/verification.md and tests/chat-screen-reader.mjs.
- 2026-10-02 UTC: coordinated test release 8542278b-700b-4816-8c83-ec8b61333188 deploys source be2152a, all four Workers, 172-table/785-object current schema and 39 exact assets. Signed HTTP and live 390px Chromium verify draft reload/exact replay, private preview/exact save, writing choices, history focus and photo-handoff metadata; no model call, image upload or publication. Verified key-capsule policy and PKCE start/cancel remain intact. Synthetic data cleanup counted all 172 tables; all 14 account Workers had no obsolete-DB reference before confirmed retirement. New private owner invitation issued. This supersedes pending-cutover statements, not remaining WH-107 physical-device/product acceptance; CSAM, Daybreak and CMS testing remain deferred.
- 2026-10-02 UTC original-scope audit at 6b2c062 maps every WH-107 scope item and all five criteria to inspected current source, connected local/browser/Orca evidence and the verified Chat test release. Runtime matches deployed be2152a. The 69-case protocol and current-history suites pass again. Original renderer/inspected-evidence scope is accepted; earlier notes conflating physical-device/customer acceptance with this packet are corrected. WH-024/112 retain those explicit broader gates; WH-108 retains custom semantic admission/prose proposals/continuations and WH-109 views. No scope, criteria or dependency changed. See docs/chat-renderer-acceptance.md; issue #90 owns closure.

## WH-108 — Let the agent compose bounded custom forms and use task-scoped answers

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Whumpo asks for missing information with an appropriate maintained or custom form and continues the same owner task using validated answers.

### Scope

- Add bounded request-information/present-element capabilities to the relevant capability catalog and focused agent context
- Prefer plain conversation for simple questions, then a maintained template, then custom composition from approved fields and bindings
- Support stable field IDs, bounded conditional visibility, typed validation and declared purposes without executable expressions or arbitrary destinations
- Keep active project, open questions, submitted answer summary and pending review references in bounded owner task state
- Map text corrections to proposed field changes and separately receipt any bounded model continuation after submission

### Acceptance criteria

- [ ] Representative requests choose a short suitable interaction, reuse known facts and do not ask for unnecessary or prohibited data
- [ ] Custom forms support a real task beyond the fixed templates using the same renderer, validation and authority contract
- [ ] Injected labels, forged binding IDs, unknown fields, altered options and inapplicable hidden answers cannot widen scope or execute code
- [ ] Project switches, corrections, skip/cancel/resume and failed continuation preserve target clarity and immutable submitted evidence
- [ ] Model context contains only eligible minimized answers with current data-use disclosure; contributor-model privacy gates remain
- [ ] No unbounded agent loop, visitor/job maintainer dispatch or model approval is introduced; inference usage and latency are measurable

### Verification

- Add synthetic selection/composition fixtures for simple text, template, custom, unavailable, canceled and malicious requests
- Run focused agent-prompt-focus, natural-chat and interaction fixtures with scripted inference and bounded call-count assertions
- Record separately authorized real-model quality/cost samples for WH-112; deterministic fixtures do not prove interpretation quality

### Dependencies and blockers

Planning dependencies: WH-107, WH-065. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)
- [docs/capability-planner.md](../../docs/capability-planner.md)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [docs/natural-language-chat.md](../../docs/natural-language-chat.md)
- [src/site-agent.ts](../../src/site-agent.ts)
- [src/ai-chat.ts](../../src/ai-chat.ts)
- [src/agent-inspection.ts](../../src/agent-inspection.ts)
- [tests/agent-prompt-focus.mjs](../../tests/agent-prompt-focus.mjs)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)
- [src/chat-interactions/agent.ts](../../src/chat-interactions/agent.ts)
- [tests/chat-interaction-agent.mjs](../../tests/chat-interaction-agent.mjs)
- [src/chat-interactions/composition.ts](../../src/chat-interactions/composition.ts)
- [src/chat-interactions/submitted-context.ts](../../src/chat-interactions/submitted-context.ts)
- [tests/chat-interaction-composition.mjs](../../tests/chat-interaction-composition.mjs)
- [src/chat-interactions/task-context.ts](../../src/chat-interactions/task-context.ts)
- [src/chat-interactions/model-continuation.ts](../../src/chat-interactions/model-continuation.ts)
- [tests/chat-interaction-model-continuation.mjs](../../tests/chat-interaction-model-continuation.mjs)
- [src/chat-interactions/task-progress.ts](../../src/chat-interactions/task-progress.ts)
- [tests/chat-task-memory-live.mjs](../../tests/chat-task-memory-live.mjs)
- [src/chat-interactions/selected-photos.ts](../../src/chat-interactions/selected-photos.ts)
- [tests/chat-interaction-photos.mjs](../../tests/chat-interaction-photos.mjs)
- [tests/helpers/live-photo-selection.mjs](../../tests/helpers/live-photo-selection.mjs)
- [docs/chat-composition-acceptance.md](../../docs/chat-composition-acceptance.md)
- [tests/chat-interaction-selection-live.mjs](../../tests/chat-interaction-selection-live.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/93. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: accepted planning direction against 628c16f and the existing working tree; implementation and customer acceptance remain open. Live GitHub refresh was blocked by local command approval policy; no issue or claim created.
- 2026-10-02 UTC: WH-106/#87 supplies the initial maintained content-change@1 agent adapter and bounded task metadata as a handoff from d9003a1. No WH-108 claim/completion: custom composition, prose-to-answer changes, eligible submitted-answer model continuation, real-model quality and full renderer/task acceptance remain in the original scope. WH-106/107 remain open; dependencies and readiness are unchanged.
- 2026-10-02 UTC: WH-106/#87 supplies maintained project-brief/project-select renderer and agent handoffs, including native owned selection and exact submitted-intake inspection. This does not claim or complete this task; original broader scope, dependencies and readiness remain unchanged.
- 2026-10-02 UTC: WH-107/#90 is accepted to its original renderer scope after criterion-by-criterion audit at 33e8f70. Current root claims WH-108 in https://github.com/zemdregon/whumpo/issues/93; reuse current templates, typed storage/receipts and bounded agent loop. Complete original conditional/custom semantic admission, task context, prose proposals and continuation scope; source/local/live/device evidence stays distinct.
- 2026-10-02 UTC: shared conditional rendering and explicit snapshot exclusion plus same-task prose answer proposals are implemented. Existing current receipts, revision/ownership guards and bounded owner inference loop are reused; suggested defaults remain unapproved and private until submission. Focused protocol, numeric/conditional, SQLite/local D1, scripted agent, natural Chat, actual built component/full workspace browser, type/compiler and build checks passed. Full custom purpose/question admission, minimized task context and separately receipted model continuation remain open; no WH-108 completion claim. See docs/chat-interactions.md.
- 2026-10-02 23:42 UTC: source e293ce1 deployed as platform 1eba60f3-b783-4730-b7bc-937828458bd9; exact 39 assets, current schema/bindings and other three Workers verified. Signed-in live 390px proposed-answer review, private preview, separate exact save, choice submission and history focus passed with synthetic fixture cleanup. No real model, publication or photo upload. Full WH-108 scope remains open; details in docs/chat-test-release.md.
- 2026-10-03 UTC: source/local progress composes purpose-bound public service/presentation questions through existing typed storage and renderer, preserves same-task correction/proposal meanings, and replaces the old intake-only reader with explicit selected-field submitted-answer inspection. Ten actual-handler scenarios pass on SQLite/local D1; 32 scripted agent cases pass with bounded inspection and preserved failure receipts. No new inference route, arbitrary wording/resource admission or automatic continuation. Full WH-108 criteria remain open; broader task state, custom admission, separately receipted model continuation and real-model owner-experience acceptance remain required.
- 2026-10-03 00:20 UTC: source 792ff24 deployed as platform 459aa504-4aeb-46e5-8ee3-2a9c4283e5ba; all 39 assets match, schema/platform bindings and the other three Workers unchanged. Live synthetic 390px custom form submission, conditional draft reload, hidden-answer exclusion and existing private-preview/exact-save/history checks pass; fixture cleanup verified. No inference/publication/payment. WH-108 original scope remains open; docs/chat-test-release.md records the exact evidence.
- 2026-10-03 UTC: current source connects custom Save and continue through separately receipted, bounded owner Chat. Atomic claim/dispatch/final guards pin immutable submission, task revision and project; context excludes unrelated history/projects/drafts, and response turns cannot enter later general context. Twenty-two actual-handler scenarios pass on SQLite/local D1, including interruption, rejected/unknown response, revocation, scoped effects and same-task correction. Broader custom admission and original full WH-108 acceptance remain open. The full built HTTP/local D1/R2 browser rerun passes unavailable/stop, two-call scripted continuation, lost response and reload without redispatch. The coordinated current-schema test cutover is in preparation; see docs/verification.md and docs/chat-test-release.md. One separately opted-in real Muse/local-D1 sample passed exact submitted service-area interpretation in two calls (15,019 ms), with unchanged saved website, zero customer credits/publication and no replay dispatch. This is not broader model quality or live Worker/device acceptance; no paid activation occurred.
- 2026-10-03 01:15 UTC: coordinated release cc5abfdb-fd7c-4d50-a9d7-39dd28ecc15a deployed current model-continuation schema/client/runtime. All 448 archived source files match f96c384; all four Worker versions, 39 assets, bindings and 172-table/786-object schema verified. Signed HTTP/live 390px synthetic form/review/recovery journey passes with explicit custom-inference interception and fixture cleanup. Real-model continuation evidence remains the separate local-D1 two-call sample. WH-108 stays open for broader question/resource composition, unresolved questions across subsequent turns and its original connected acceptance; no criterion is replaced by narrower receipt tests.
- 2026-10-03 UTC: current source adds immutable bounded task progress and explicit natural-language same-task resumption using the existing two-call owner loop. Summaries/open questions remain outside ordinary history; current task/project/submission and progress-head guards fence results. Forty actual-handler scenarios pass on SQLite/local D1, full built mobile HTTP/D1/R2 question/reply/reload passes, and one real Muse three-call/two-turn sample carries a question and submitted area into an exact private edit review. A routing bypass seen in an earlier real sample was corrected and the final sample selected resumeTask; broader quality remains unproven. New 173-table current schema is source/local only, not deployed. Original WH-108 composition/selection/connected acceptance remains open; see docs/verification.md.
- 2026-10-03 02:18 UTC: release c3f3eaae-2d19-47b4-baf7-278d51e0256c deploys bounded task memory; all 449 archived source files match 5e903a6, four Workers/39 assets/bindings and the 173-table/791-object schema verify. Signed HTTP/390px forms pass. A real Muse/deployed-Worker two-turn sample uses 3 main calls to combine submitted service area and later season answer into one exact private review, with unchanged saved website, zero publications/customer credits and no replay dispatch. A prior live sample ended failed with its cause not retained; a fresh passing sample does not resolve reliability. Acknowledgment cost remains uncertain. Synthetic cleanup and old-database retirement verified. The final screenshot captured loading and is not visual acceptance; probe diagnostics/readiness were strengthened for future samples. Original WH-108 resource/composition and representative selection, plus WH-112 model/device acceptance, remain open. See docs/chat-test-release.md.
- 2026-10-03 UTC source/local: custom presentation forms admit up to four currently approved same-project photos. Explicit IDs only are retained; selected metadata is minimized, and current ownership/digest/clearance guards fence draft/submit/correction, model dispatch and final effects. Seven resource scenarios pass on SQLite/local D1; 44 scripted continuation cases and the built 360/390px HTTP/D1/R2 journey pass. No image bytes/scanner/real inference/publication. This source addition awaits scoped platform deployment. Original WH-108 representative interaction selection and broader WH-112 quality/device acceptance remain open; see docs/verification.md.
- 2026-10-03 03:01 UTC: a992f95 deployed as platform 8164406e-5bde-4565-8662-1b34edb3fa0a. Exact 39 assets, all platform bindings, unchanged 173-table/791-object schema and other three Workers verify. Signed 390px synthetic photo selection/draft reload/revocation/reselection/submission and previous private review/recovery journeys pass. No image bytes/scanner/inference/publication, fixtures removed. Original model-selection and broader acceptance remain open; detailed evidence in docs/chat-test-release.md.
- 2026-10-03 UTC original-scope audit at a992f95: all five scope bullets, six criteria and three verification bullets mapped in docs/chat-composition-acceptance.md. Seven frozen real Muse selection requests passed objective checks and inspected rubrics without product/prompt changes; all fourteen real calls including the earlier harness-failed attempt are retained. Plain/template/custom/known-fact/unavailable/prohibited/ambiguous selection, connected private task changes, typed conditional/resource admission, prose correction, bounded task state, replay and authority guards are accepted within the original packet. WH-020/024/109–112 retain full journeys, broader model reliability (including the unresolved earlier live follow-up), complete economics and physical-device acceptance. No MVP, scanner or commercial acceptance is claimed.

## WH-109 — Compose and maintain dashboards and custom views through the agent

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Dashboards and custom views are supporting surfaces the agent builds around the owner task using the same trusted components as Chat.

### Scope

- Extend existing revisioned workspace layouts with versioned component and registered data/action bindings shared with Chat
- Allow the agent to present temporary views and save/create/update/rename/remove requested persistent views through bounded operations
- Reuse existing project, activity, traffic and review data; add future lead/portfolio bindings only when their underlying feature is implemented and eligible
- Record layout change receipts and restore/undo, preserve unrelated views and refresh permission-filtered data without inference
- Keep static account/security/support and urgent recovery controls independent of generated layout configuration

### Acceptance criteria

- [ ] Chat and a saved view can render the same element against the same authoritative binding without duplicate backend implementation
- [ ] The agent manages layout under the owner task; customers can request correction/undo and dismiss temporary views without a manual builder
- [ ] Concurrent layout edits use expected revisions and preserve unrelated cards/pages; historical layouts cannot restore lost permissions
- [ ] No arbitrary queries, HTML/code, external destinations, invented metrics or permission changes can be stored as view configuration
- [ ] Permission changes and unsupported data remain visible; render/refresh/poll create zero maintainer calls and no side effects
- [ ] Existing current-contract tabs/shortcuts remain usable; undo revalidates current definitions and permissions. Incompatible shapes use an explicit disposable test cutover without legacy readers or migrations

### Verification

- Extend tests/workspace-dashboard.mjs with shared bindings, stale revisions, isolation, restore and zero-inference rendering cases
- Run pnpm check and the maintained connected Chat-to-view-to-Chat browser fixtures against the actual Worker and disposable current D1; inspect narrow-screen images
- Exercise current layouts, explicit current-schema test cutover, project removal, inaccessible metrics and user-requested layout correction

### Dependencies and blockers

Planning dependencies: WH-107. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)
- [docs/unified-workspace-and-capacity.md](../../docs/unified-workspace-and-capacity.md)
- [src/workspace-dashboard.ts](../../src/workspace-dashboard.ts)
- [src/workspace-shortcuts.ts](../../src/workspace-shortcuts.ts)
- [frontend/src/workspace-pages.tsx](../../frontend/src/workspace-pages.tsx)
- [tests/workspace-dashboard.mjs](../../tests/workspace-dashboard.mjs)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)
- [docs/workspace-views.md](../../docs/workspace-views.md)
- [docs/workspace-views-acceptance.md](../../docs/workspace-views-acceptance.md)
- [docs/workspace-view-release.md](../../docs/workspace-view-release.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/94. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: accepted planning direction against 628c16f and the existing working tree; implementation and customer acceptance remain open. Live GitHub refresh was blocked by local command approval policy; no issue or claim created.
- 2026-10-03 UTC: WH-107/#90 and WH-108/#93 are accepted. Source-grounded WH-109 contract in docs/workspace-views.md identifies current widgets/shared project projection, missing shared components/layout receipts/undo and the immediate-write workspaceAction gap. Owner current-version-only instructions supersede the old migration wording: use explicit disposable cutovers and current-definition undo, no legacy adapter. Original scope and remaining criteria retained; implementation is not claimed complete.
- 2026-10-03 UTC: current root claims execution in #94 on codex/identity-admission after inspecting current source and upstream closures. Planned implementation contract is committed separately from runtime; first code work is shared current view definitions/bindings and atomic layout history/receipt preparation.
- 2026-10-03 UTC: shared exact website review queues/comparisons are locally verified in 03fa3cf; WH-109 remains open for full lifecycle/cutover/audit. The current tool inventory has no callable quality-manager browser runner; verification uses maintained Playwright fixtures with the actual Worker, built client, current D1 and inspected narrow-screen images. This updates tooling wording without reducing the connected browser or original acceptance scope.
- 2026-10-03 UTC: original six-criterion audit accepted. Frozen b765913 local real-Muse and deployed 81a7b9f eight-step mobile lifecycles pass, preserving unrelated views and exact replay. Release 0955f19c-b69e-4dae-b7e7-972e5df3aa3c verifies four Workers, current 175-table/796-object schema, 39 assets, shared exact review comparisons, current permission loss, zero-inference rendering and settled 360/390px images. Synthetic fixtures removed, all 14 account Worker inventories checked and obsolete DB retired. Retired layout route/undo argument rejected. Earlier model failures and separate acknowledgment uncertainty remain WH-020; physical devices and full owner/beta/commercial acceptance remain separate. Full evidence: docs/workspace-views-acceptance.md and docs/workspace-view-release.md; execution closure in #94.

## WH-110 — Complete routine owner workflows within Chat

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers finish supported daily project work in Chat, with forms, results and exact reviews presented when needed.

### Scope

- Split by journey: new-project intake and selection, website changes and previews, publication/restore reviews, status/traffic and supported recovery
- Replace mandatory page detours with maintained Chat elements calling existing domain handlers; keep current routes until replacement acceptance
- Adapt photo intake only under current media gates and connections through trusted consent handoffs; keep CMS testing deferred and Stripe restricted to the authorized sandbox
- Bring typed server progress, failure, unknown outcomes and next supported actions into the originating task
- Define extension points for later eligible tier/connector features without making the initial slice wait for those backends
- Reuse saved onboarding/first-project state and the shared identity completion gate. Entry onboarding stays deterministic before workspace access; Chat handles later project intake without becoming an authentication or first-project bypass.

### Acceptance criteria

- [ ] Each admitted routine journey completes from Chat with no required Dashboard/Settings detour except documented authentication, consent and preview handoffs
- [ ] New-project guidance does not duplicate onboarding state; existing project selection is explicit before forms or changes target it
- [ ] Submitting a brief is distinct from applying a private version and from publishing; exact existing reviews retain disclosures and server checks
- [ ] Lost replies, duplicate actions, stale/foreign reviews, unavailable capabilities and failed operations show honest recoverable state
- [ ] Existing media/tenant/entitlement/consent boundaries apply across Chat and direct APIs; no runtime/visitor maintainer access
- [ ] Connected journey evidence precedes removal of an existing entry point; large packets retain separate contract, adapter and acceptance children

### Verification

- Run pnpm check and selected existing onboarding, natural-chat, customer-site-journey, workspace-read and recovery suites matching each child
- Use maintained Playwright connected browser fixtures with real local Worker handlers/current D1 and synthetic inference; inspect desktop/mobile results
- Document every allowed external handoff and separately blocked provider/media/customer acceptance; do not run deferred CMS checks

### Dependencies and blockers

Planning dependencies: WH-107. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)
- [docs/onboarding.md](../../docs/onboarding.md)
- [docs/natural-language-chat.md](../../docs/natural-language-chat.md)
- [docs/photos.md](../../docs/photos.md)
- [docs/owner-recovery.md](../../docs/owner-recovery.md)
- [frontend/src/onboarding.tsx](../../frontend/src/onboarding.tsx)
- [frontend/src/workspace-controls.tsx](../../frontend/src/workspace-controls.tsx)
- [tests/customer-site-journey.mjs](../../tests/customer-site-journey.mjs)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)
- [docs/chat-routine-journeys.md](../../docs/chat-routine-journeys.md)
- [docs/chat-routine-release.md](../../docs/chat-routine-release.md)
- [docs/chat-connection-handoffs.md](../../docs/chat-connection-handoffs.md)
- [docs/chat-routine-acceptance.md](../../docs/chat-routine-acceptance.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/95. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: accepted planning direction against 628c16f and the existing working tree; implementation and customer acceptance remain open. Live GitHub refresh was blocked by local command approval policy; no issue or claim created.
- 2026-10-03 UTC: source baseline cbcdf2a and live upstream WH-107/#90 and WH-109/#94 closure inspected. Current root claims #95 on codex/identity-admission. Source-grounded full journey contract in docs/chat-routine-journeys.md; separate contract #96, intake/selection #97, remaining routine adapters #98 and original-scope acceptance #99. Existing intake forms save information without continuation; first implementation connects selected website tasks to the existing bounded continuation/receipts with fresh account/project fences. Additional-project and other parent branches remain required. Maintained direct Playwright is available; quality-manager runner is not. No parent criterion removed or marked complete.
- 2026-10-03: current parent #95 and native children #96–99 mapped; contract child #96 accepted against source 9faefad and validated dependency/readback evidence. Selected-project Save and continue now reuses bounded task context, current account/project guards, exact receipts and same-task resumption in source. Additional-project intake and remaining routines/full acceptance remain open; no deployment or real-model/device claim. Detailed current verification is in docs/chat-routine-journeys.md.
- 2026-10-03: additional-project briefs now explicitly continue through the existing task engine and project/first-private-website handler. A server-written immutable creation locator retains the same project across clarification, corrections and lost replies, survives project deletion and grants no resource authority. Current schema is 175 tables/798 objects and requires a coordinated empty-database test cutover. Seventy-nine continuation cases pass on SQLite/current D1; combined actual Worker/D1/R2/built-browser suite passes with 22 scripted main calls. First-project onboarding remains separate. #97 stays open for coordinated release/deployed acceptance; #98/#99 and full parent scope remain open. No external inference, deployment or device acceptance. See docs/chat-routine-journeys.md for exact evidence and retained failed attempts.
- 2026-10-03: release 708ce636 deploys source 0cafbb1 and complete current schema (175 tables/798 objects). Four Worker identities/bindings, 39 asset digests and identity-entry/consent-cancel checks passed. The actual deployed Muse/browser issued the intake form, then creation failed proposal validation with no applied effect; fixture cleanup confirmed. One separate Muse/local-D1 sample passed but does not resolve that failure. #97, #98/#99 and parent #95 remain open; count stays 24/122. Old database retirement deferred pending connected acceptance. See docs/chat-routine-release.md.
- 2026-10-03: follow-up release 8f6cb76e deploys c5ab256. Six real-Muse mobile browser steps pass: intake, private creation/lost-response recovery, corrected brief/same-project name review, and selected-project headline review. Natural task resumption wrongly denies the pending review; synthetic cleanup confirmed. Current source shares an owned pending-review reader and routes task-status questions through exact resumeTask. 86 SQLite handler cases and two frozen real-Muse/local-D1 status conversations pass; source deployment/full acceptance remain pending. #97 and parent scope stay open, count 24/122; old database retirement remains pending. All failed attempts are preserved in docs/chat-routine-release.md and docs/chat-routine-journeys.md.
- 2026-10-03 08:41 UTC: WH-110B/#97 accepted after the complete seven-step actual deployed Muse/browser journey on release 6edf35f2 (runtime 0994c52, verifier 97266b8). Private creation/lost-response recovery, same-project correction, explicit selection and truthful pending-review resumption pass with unchanged saved revisions, zero publications/customer units and no replay inference. Inspected 360/390px captures, signed identity/logout/second-key/revocation, encrypted PKCE cancellation and fixture cleanup pass. All 86 handler cases pass on both SQLite/current local D1; two frozen real-Muse local-D1 status cases pass. Four uncertain acknowledgment receipts remain WH-020 work; all failed attempts preserved. The original child-scope audit is in docs/chat-routine-journeys.md. After fresh checks of 14 Workers, the unreferenced old database was retired and all other databases preserved. #98/#99 and full parent #95 remain open; count stays 24/122. No physical-device/customer admission, CMS/scanner/provider/real-money acceptance.
- 2026-10-03: WH-110C photo adapter source 706e85a deployed as 8f92ad86-e7e1-4013-9923-785ba410adc3. 143 SQLite/13 focused D1 continuation cases, nine D1/R2 handoff cases, eleven-call mobile browser and two seven-call real Muse conversations pass. Deployed seven-stage private upload/readback/task-status/dismissal/revocation/identity journey, current schema/assets, cleanup and old database retirement verified. Consent and broader adverse recovery remain #98; full original-scope audit #99 and parent #95 remain open. Detailed evidence: docs/chat-routine-release.md.
- 2026-10-03 source/local checkpoint: fixed GitHub/Cloudflare consent cards share Settings controls and existing provider authority; exact session-bound OAuth state returns to originating Chat. 15 handler cases each on SQLite/D1, seven-call actual mobile browser and two one-call real-Muse issuance samples pass. Current start body/schema required; no compatibility path. Deployment, real provider consent, task-scoped outcome reporting and expanded recovery remain pending. #98/#99/#95 stay open and accepted parent count remains 24/122. See docs/chat-connection-handoffs.md.
- 2026-10-03 source/local callback recovery: #98 now saves immutable Chat-return links atomically with OAuth start, independently of one-time state. Consumed/rejected/cancelled/replaced callbacks retain their exact origin without renewed exchange authority; current owner/session/project and seven-day navigation retention apply. Replaced OAuth-state locator columns are removed, with one current reader and no migration. Handler coverage passes 21 cases each on SQLite/local D1; actual built mobile browser passes lost committed callback, older-history reload and another tab with seven scripted main calls, three explicit starts and one synthetic token exchange. Provider/custody/keyring, 39 storage scenarios, navigation, lifecycle, type/build checks pass. Candidate 177 tables/806 objects remains undeployed. Task-scoped outcome reporting, broader outage recovery, coordinated deployed acceptance and original-scope audit remain #98/#99/#95 work; no parent closure, provider activation, CMS or scanner work.
- 2026-10-03 UTC WH-110C task-scoped saved connection status is implemented and locally accepted, not deployed. Terminal interaction.connectionStatus uses existing provider readers after inference; only exact-task provider locators enter model context. Fresh admission/origin/metadata guards fence the reply; previous task memory is preserved and the result is excluded from later inference. Both SQLite and local D1 pass 21 cases (83 main/30 ack each), combined nine-call browser passes after fixing older returned-card locator loss on message send, and two frozen real-Muse conversations pass at three calls each. Existing 150 continuation, seven focused consent, 32 agent cases, account status, type/build checks pass. Pending 177-table/806-object candidate schema is unchanged. Test deployment, broader outages and provider/device/customer acceptance remain open; #98/#99/#95 stay open. Details: docs/chat-connection-handoffs.md.
- 2026-10-03 13:51 UTC: current Chat connection release 5dfb930c-7241-4516-97fd-dff9f461de1e, runtime 577702e, passes exact four-Worker/binding/schema/39-asset verification and eight-stage real-Muse/deployed-browser acceptance: scoped controls, signed reauth/lost-start recovery, cancelled-consent return, older-history/multi-tab recovery, terminal same-task saved status, unavailable-read recovery, revoked access/reload and two-key identity. Inspected 360/390px captures and synthetic cleanup pass; first synthetic-page timeout is preserved and corrected verifier passes on unchanged runtime. Current 177-table/806-object schema cut over without migration; old empty DB retired after all 14 account Worker binding checks, other DBs preserved, current key policy and fresh private invitation verified. One uncertain acknowledgment remains WH-020; actual provider/device/customer acceptance, broader recovery and #98/#99/#95 remain open. Evidence: docs/chat-routine-release.md and docs/chat-connection-handoffs.md.
- 2026-10-03 UTC: original-scope audit accepts WH-110/#95 and remaining children #98/#99 against all six scope items, six acceptance criteria and three verification requirements. Runtime remains deployed 577702e / release 5dfb930c; this audit adds tests/docs only. Fresh actual Worker/current D1/built-browser full journey passes 22 scripted calls; exact publication/reopen/confirm/restore/withdrawal passes 19; new adverse recovery passes ten, including AI-unavailable private save, saved-answer explicit resume, rejected/unknown/pending outcomes and timeout fencing of late results with uncertain costs retained. Onboarding, first-draft, customer-site, workspace-read, natural-chat and compiler/type checks pass. Phone/desktop captures inspected; earlier interrupted/terminated browser attempts retained. Existing exact-source handler, bounded real-Muse and deployed adapter evidence are mapped individually. No direct routes removed, runtime/visitor authority added, provider activation, remote publication, physical-device/customer admission, CMS/scanner work or real billing. WH-024 precedes WH-111 navigation/continuity; model, provider, safety, protection, device and commercial gates remain separate. See docs/chat-routine-acceptance.md.

## WH-111 — Make Chat the daily workspace with durable continuity and direct recovery

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **ready**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The workspace opens on the current conversation and needs little navigation, while essential saved work and recovery remain reachable during outages.

### Scope

- Simplify desktop/mobile navigation around Chat and optional agent-managed views after migrated journeys are accepted
- Preserve composer drafts, selected project, open interactions and pending review/result links across reload and browser/provider returns
- Offer bounded account-scoped recovery of saved work without automatic inference, form submission or approval on reconnect
- Keep discoverable deterministic paths for account/security/sign-out/support, urgent takedown and pending operation/review state
- Remove superseded routes and adapters; use current return points and explicit forward data conversion preserving current drafts and submitted receipt identity

### Acceptance criteria

- [ ] Routine journeys remain in Chat and agent-presented panels; optional saved views do not become a mandatory control directory
- [ ] Navigation, reload, multi-tab work and lost responses preserve the correct account/project task with no duplicate effect
- [ ] Logout/account change clears private device state; stale or revoked actions cannot regain authority from a cached view
- [ ] With inference unavailable, an owner can inspect saved state and use eligible direct recovery/review controls without a model round trip
- [ ] Onboarding failure does not strand support/recovery, and a generated layout cannot hide essential controls
- [ ] Keyboard, screen reader, zoom, reduced motion and mobile soft-keyboard continuity have evidence beyond screenshots alone

### Verification

- Run focused chat-delivery, chat-history, workspace-navigation and provider-return suites plus pnpm check for changed TypeScript
- Exercise quality-managed connected reload/network-loss/two-account/inference-outage fixtures and inspect screenshot results
- Record manual keyboard/assistive-technology evidence and leave physical-device gaps explicit

### Dependencies and blockers

Planning dependencies: WH-109, WH-110, WH-024. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)
- [docs/unified-workspace-and-capacity.md](../../docs/unified-workspace-and-capacity.md)
- [docs/usage-review-requests.md](../../docs/usage-review-requests.md)
- [frontend/src/workspace.tsx](../../frontend/src/workspace.tsx)
- [frontend/src/mobile-workspace.tsx](../../frontend/src/mobile-workspace.tsx)
- [frontend/src/lib/chat-delivery.ts](../../frontend/src/lib/chat-delivery.ts)
- [frontend/src/lib/workspace-navigation.ts](../../frontend/src/lib/workspace-navigation.ts)
- [tests/chat-delivery.mjs](../../tests/chat-delivery.mjs)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)
- [docs/chat-workspace-continuity.md](../../docs/chat-workspace-continuity.md)
- [frontend/src/lib/chat-location.ts](../../frontend/src/lib/chat-location.ts)
- [tests/chat-location.mjs](../../tests/chat-location.mjs)
- [frontend/src/account-help.tsx](../../frontend/src/account-help.tsx)
- [tests/helpers/account-help-journey.mjs](../../tests/helpers/account-help-journey.mjs)
- [tests/workspace-identity-browser.mjs](../../tests/workspace-identity-browser.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/100. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: accepted planning direction against 628c16f and the existing working tree; implementation and customer acceptance remain open. Live GitHub refresh was blocked by local command approval policy; no issue or claim created.

## WH-112 — Accept Chat as the primary customer experience

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: verification. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

One candidate demonstrates useful routine work through Chat, reliable interactive elements and agent-managed views with little required navigation.

### Scope

- Maintain a routine-journey matrix linking forms, task state, view bindings, existing action handlers, allowed handoffs and evidence scope
- Evaluate template selection, custom-form usefulness, corrections/cancel/resume, view changes, action honesty and inference-outage recovery
- Measure content-free surface changes, completion, abandonment, validation errors, time to useful result and inference cost against the existing baseline
- Split deterministic/browser, approved real-model, device/accessibility and consenting-customer acceptance without treating mocks as substitutes
- Feed commercial WH-049 acceptance; keep bounded free beta WH-048 independent and existing tier/provider/payment/CMS gates intact

### Acceptance criteria

- [ ] All migrated routine journeys pass connected local handler checks, including at least one maintained and one custom form and saved view correction
- [ ] Proposed initial targets: at least 90% of supported routine attempts complete within Chat/attached panels and at least 8 of 10 consenting participants finish without navigation coaching; record counts, exclusions and small-sample uncertainty
- [ ] Foreign/stale/expired schemas, changed permissions, two-device edits and lost acknowledgements produce zero duplicate consequential effects in tested cases
- [ ] Every approval comes from current server review evidence; text, form completion, view loading and model output never confer approval
- [ ] Keyboard/screen-reader/mobile acceptance and inference-outage access are evidenced; visitors/jobs/render/polling create zero maintainer calls
- [ ] Candidate release, model/template/schema versions, costs and source/local/live/device/customer evidence are explicit; missing real acceptance keeps this gate open
- [ ] No invitation, paid evaluation, provider mutation or deployment is authorized by this verification packet alone

### Verification

- Run only focused candidate-release interaction, natural-chat, workspace-dashboard, delivery/history and selected site/recovery regression suites
- Use quality-managed connected browser checks and inspect screenshots; conduct manual accessibility/device sessions with appropriate access
- Compare privacy-safe WH-025 measurements and approved real-model samples with WH-020; obtain separate authorization before customer recruitment or new paid calls

### Dependencies and blockers

Planning dependencies: WH-108, WH-111, WH-025, WH-020. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [docs/workspace-refinement-acceptance.md](../../docs/workspace-refinement-acceptance.md)
- [docs/roadmap/README.md](../../docs/roadmap/README.md)
- [docs/acceptance.md](../../docs/acceptance.md)
- [tests/natural-chat.mjs](../../tests/natural-chat.mjs)
- [tests/customer-site-journey.mjs](../../tests/customer-site-journey.mjs)
- [docs/verification.md](../../docs/verification.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: accepted planning direction against 628c16f and the existing working tree; implementation and customer acceptance remain open. Live GitHub refresh was blocked by local command approval policy; no issue or claim created.

## WH-119 — Make the dashboard an installable PWA

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **ready**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers can add the existing mobile workspace to their phone home screen and open it as an app.

### Scope

- Stable workspace manifest and elephant app/touch icons
- User-triggered Settings installation with iPhone/manual browser guidance
- Public-only offline navigation screen with explicit reconnect; preserve existing account and Chat recovery authority
- Fingerprint worker/cache assets and verify installability, mobile layout and safe worker updates

### Acceptance criteria

- [ ] Installed app starts at the Chat-first workspace and preserves authentication/onboarding and mobile navigation
- [ ] Browser installability criteria pass; manifest and 192/512px icons are served on the test domain
- [ ] Service worker never caches private/API/auth/chat responses or queues mutations; network failures get a public reconnect screen
- [ ] Worker updates preserve the current document and unsent draft
- [ ] Installation is user-triggered; standalone state and manual guidance are usable; physical-device acceptance remains explicitly distinct from Chromium emulation

### Verification

- Type/build and focused PWA cache/routing/update checks
- Build snapshot/release manifest and lazy-loading regressions
- Disposable Chromium plus actual local D1/platform journey; no model/provider calls
- Deployed asset/readback and browser manifest/worker checks; report physical-device limits honestly

### Dependencies and blockers

Planning dependencies: WH-001, WH-003. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/dashboard-pwa.md](../../docs/dashboard-pwa.md)
- [docs/unified-workspace-and-capacity.md](../../docs/unified-workspace-and-capacity.md)
- [frontend/public/manifest.webmanifest](../../frontend/public/manifest.webmanifest)
- [frontend/public/workspace-sw.js](../../frontend/public/workspace-sw.js)
- [frontend/src/install-app.tsx](../../frontend/src/install-app.tsx)
- [tools/build-pwa.mjs](../../tools/build-pwa.mjs)
- [tests/dashboard-pwa.mjs](../../tests/dashboard-pwa.mjs)
- [tests/dashboard-pwa-browser.mjs](../../tests/dashboard-pwa-browser.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/49. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 local/source: installable workspace manifest, elephant 192/512px icons, Settings install/manual guidance and public-only offline worker implemented. Type/build, PWA cache/routing/version checks, build/release snapshot and lazy-loading checks pass. Disposable Chromium with actual local platform/D1 reports zero manifest/installability errors and verifies mobile layout, install dismissal, offline/reconnect and worker updates preserving an unsent draft. Deployment evidence follows in docs/dashboard-pwa.md and issue #49; physical-phone OS install remains unverified.
- 2026-10-01T16:55:49.916Z test acceptance: corrected release e6edca89-4021-494c-a4b0-0875531e3132, source aa8b2c38b4c69e1a4dba76fb01b0fe0bea544778, deployed and reconciled. Twenty selected assets match archive bytes; live Chromium reports zero manifest/installability errors, active worker, four public cached files and successful offline/reconnect to sign-in. Health 200, anonymous session 401/no-store. No new migration/service/paid activation. Physical-phone OS installation remains unverified. See docs/dashboard-pwa.md and issue #49.

## WH-150 — Bind guest preview links to exact saved versions with bounded accountless feedback

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **ready**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An owner with current inclusion issues an expiring, revocable, hash-stored link to one immutable saved version; guests view only that isolated preview on a separate host and may leave bounded plain-text comments the owner can read, resolve and delete.

### Scope

- Current schema for guest_preview_links/guest_preview_feedback with immutability, capacity, rate and preservation-hold guards
- Owner HTTP handlers under current workspace identity; issuance composes creator.guest-feedback inclusion; list/revoke/resolve/delete stay outside the paid gate
- Anonymous sites-Worker guest page, status, sandboxed view and feedback on preview.whumpo.site with the token only in the URL fragment and POST bodies
- Lifecycle class, closure inventory counts, daily retention job and feature contract document

### Acceptance criteria

- [ ] Forged, replayed, expired, revoked, removed, held and no-longer-included links stop reads and comments, including an in-flight view
- [ ] Guests see only the exact bound version through the shared isolated preview rendering; no other version, asset alias, draft, project or account data
- [ ] Raw tokens are never stored, listed, exported or logged; comment markup and instructions stay inert and never reach Chat or a model
- [ ] Owner identity loss and foreign owners are refused; rate, size and capacity limits hold on SQLite and local D1

### Verification

- node tests/guest-previews.mjs and node tests/guest-previews.mjs --d1
- node tests/guest-preview-photos.mjs (local D1/R2, synthetic clearance)
- Lifecycle catalog, closure inventory, maintenance and related preview/specification/publication suites

### Dependencies and blockers

Planning dependencies: WH-089, WH-066, WH-004, WH-009, WH-010, WH-122, WH-116. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/guest-previews.md](../../docs/guest-previews.md)
- [docs/project-specification-storage.md](../../docs/project-specification-storage.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/feature-inclusion.md](../../docs/feature-inclusion.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC: implemented in source on branch claude/wh-092-preview-links with local SQLite, local D1 and local D1/R2 fixtures; not deployed. See docs/guest-previews.md.

## WH-151 — Register guest preview owner operations with shared Chat and view adapters

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Owners list, issue, revoke, resolve and delete guest preview links and comments from the shared Chat/view surface using the WH-150 domain handlers, with exact confirmation before a link is issued.

### Scope

- Register read/action bindings for the existing WH-150 handlers; no second authority or storage
- Issuance shows the exact version, expiry and comment setting and requires explicit owner confirmation; a model may only prepare it
- Comments are shown to the owner as inert text and enter model context only by an explicit owner request with a reviewed privacy route
- Keep the direct revoke control reachable without inference

### Acceptance criteria

- [ ] Chat and views enforce the same identity, ownership and inclusion as the HTTP handlers; hidden UI or forged identifiers cannot bypass them
- [ ] The one-time token is shown only to the owner and never stored in Chat history, transcripts or model context
- [ ] Revocation and deletion remain available after inclusion ends

### Verification

- Connected Chat/view fixtures over the actual handlers with forged identifiers and lost inclusion
- Transcript/model-context checks that no token or unrequested comment text is present

### Dependencies and blockers

Planning dependencies: WH-150, WH-105, WH-107, WH-109, WH-110. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/guest-previews.md](../../docs/guest-previews.md)
- [docs/project-specification-storage.md](../../docs/project-specification-storage.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/feature-inclusion.md](../../docs/feature-inclusion.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/130. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-08 UTC: the Chat guestPreview revoke/delete controls now save their effect in the same revision-checked batch as the Chat turn (WH-004 finding B3), so a request refused with 409 changes nothing. Verified only locally by node tests/guest-preview-chat-atomic.mjs on SQLite and --d1; not deployed. See docs/guest-previews.md.

## WH-152 — Accept the accountless guest preview journey in real browsers

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A guest on mobile and keyboard-only desktop opens a link, views the preview, sends a comment and sees the link stop working after the owner revokes it from the shared owner surface.

### Scope

- Playwright journey at 390x844 and desktop with keyboard-only operation and screen-reader names for the guest page
- Owner issue/revoke/resolve through the WH-151 surface with synthetic approved photo assets
- Check headers, sandbox, no cookies, no horizontal overflow and focus order

### Acceptance criteria

- [ ] Accountless preview, comment and revoke journey passes on mobile and keyboard
- [ ] No workspace cookie, token in a URL path/query or guest text in logs

### Verification

- Local browser fixtures over the platform and sites Workers with disposable D1/R2

### Dependencies and blockers

Planning dependencies: WH-150, WH-151. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/guest-previews.md](../../docs/guest-previews.md)
- [docs/project-specification-storage.md](../../docs/project-specification-storage.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/feature-inclusion.md](../../docs/feature-inclusion.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/141. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-153 — Release and live-accept guest previews on the test platform

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: release. Size: S.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The guest preview host is verified to route to the sites Worker, the current schema and Workers are deployed in a reviewed test release, and a synthetic live journey passes before the catalogue marks the feature private-test.

### Scope

- Verify preview.whumpo.site resolves through the existing *.whumpo.site route without a customer DNS change; request explicit approval if a Whumpo-zone record is missing
- Reviewed four-Worker release with the current schema cutover
- Live synthetic issue/view/comment/revoke with cleanup; then set creator.guest-feedback implementation to private-test

### Acceptance criteria

- [ ] Live readback of host routing, headers and refusal paths with a disposable identity
- [ ] Catalogue changes only after live acceptance; no paid service, purchase or customer DNS change

### Verification

- Release manifest readback and an opt-in live fixture with cleanup evidence

### Dependencies and blockers

Planning dependencies: WH-150, WH-152. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/guest-previews.md](../../docs/guest-previews.md)
- [docs/project-specification-storage.md](../../docs/project-specification-storage.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/feature-inclusion.md](../../docs/feature-inclusion.md)
- [docs/releases.md](../../docs/releases.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

# F3 — Commercial MVP

Verified provider economics, funded cumulative plans and every selected Creator/Business/Business Pro feature and seven connections accepted before first paid launch, alongside the original full delivery contract.

## WH-021 — Activate reviewed owner-maintenance inference and Gateway canary

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Owner-facing maintenance and Chat routing has verified model/rate/privacy contracts and complete spending receipts without silent paid fallback.

### Scope

- Connect existing route and Gateway foundations to approved task orchestration
- Add versioned model/protocol/context/price configuration and safe log/cache/retry policy
- Reconcile provider receipts, cancellation and orphaned tasks

### Acceptance criteria

- [ ] Standard work never acquires premium debits
- [ ] Task/account/platform reservations precede billable work; uncertain outcomes stay held
- [ ] Real canary verifies provider request/cost receipt and chosen Gateway settings
- [ ] No new provider billing, service or fallback activates without explicit exact review
- [ ] Visitor requests and customer service workflows cannot invoke this route, borrow its credentials/context or consume owner maintenance funding; optional customer runtime AI is a separate WH-079 capability

### Verification

- pnpm test:ai-gateway
- pnpm test:gateway-inference
- pnpm test:gateway-spend
- pnpm test:inference-routing
- Bounded live synthetic canary only after authorization

### Dependencies and blockers

Planning dependencies: WH-020, WH-014, WH-022. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/ai-gateway-transport.md](../../docs/ai-gateway-transport.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [src/gateway-inference.ts](../../src/gateway-inference.ts)
- [src/gateway-provider-receipt.ts](../../src/gateway-provider-receipt.ts)
- [src/gateway-spend.ts](../../src/gateway-spend.ts)
- [src/inference-routing.ts](../../src/inference-routing.ts)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-022 — Collect authoritative shadow resource and task-cost events

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Real usage and provider costs can be reconciled without prematurely charging customers.

### Scope

- Define immutable source/event IDs, owner attribution, quantity and tariff version
- Capture authoritative infrastructure and complete task costs, separating control/retry overhead
- Reconcile aggregate usage against invoices/account floors
- Instrument expanded launch workloads: kits/previews, comments, leads, notifications, requested connector reads/actions, collaboration, staging and portfolio/bulk work
- Deliver the versioned event envelope and existing producer adapters first; later feature packets register additional dimensions through that interface. Initial delivery does not require those future feature implementations or WH-023 closed-period acceptance.
- Attribute events to WH-071 stable logical project/resource identities, independently of the physical Worker/database. Preserve original provider event IDs and tariff versions across placement changes.

### Acceptance criteria

- [ ] Duplicate and delayed events cannot double-count
- [ ] Missing dimensions/costs remain unknown
- [ ] No per-tenant reuse of account-wide free allowance
- [ ] Standard AI costs remain internal with zero customer units; no shadow event grants billing authority
- [ ] Include provider licenses/minimums, verification/security-assessment renewals, support, retained staging/feedback and uncertain-operation liabilities; unknown costs stay explicit

### Verification

- Synthetic duplicates, late events, tenant mismatch and unknown-rate tests
- Compare existing economic scenarios to measured units
- pnpm test:model-costs and relevant gateway/accounting suites

### Dependencies and blockers

Planning dependencies: WH-020, WH-006, WH-071. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [docs/company-finance-review.md](../../docs/company-finance-review.md)
- [src/resource-economics.ts](../../src/resource-economics.ts)
- [src/gateway-spend.ts](../../src/gateway-spend.ts)
- [src/standard-ai-usage.ts](../../src/standard-ai-usage.ts)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/workload-placement.md](../../docs/workload-placement.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-023 — Reconcile company finance and validate two complete cost periods

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Paid launch economics are supported by verified revenue, complete costs and measured workload distributions.

### Scope

- Implement/import authenticated finance evidence with provenance and closed-period reconciliation
- Include account minimums, refunds, processor fees, moderation, support and retained resource liabilities
- Measure two complete periods and rerun correlated cost/rollover stress cases
- Begin measurement early, but complete final two-period acceptance using implemented expanded tier workloads rather than the smaller pre-extension product

### Acceptance criteria

- [ ] Operator attestations remain labeled until independently reconciled
- [ ] Unmatched amounts and changing revenue prevent false abuse/profit conclusions
- [ ] Measured standard AI expense is additional to proposed resource envelopes
- [ ] Owner receives an explicit go/no-go commercial recommendation; prices are not changed automatically
- [ ] Measured Creator/Business/Pro workloads and connector/collaboration costs support launch prices and calibrated seats/volumes/retention; prices change only through separate owner choice
- [ ] Sandbox transactions are never revenue. Before real receipts exist, price-based revenue/margin is an explicit forecast paired with measured costs; no positive operating-profit claim or automatic fair-use enforcement is inferred.

### Verification

- pnpm test:fair-use-finance
- Reconcile synthetic import duplicates/revisions and totals
- Two actual closed periods are evidence gates, not accelerated fixtures

### Dependencies and blockers

Planning dependencies: WH-022, WH-091, WH-092, WH-094, WH-095, WH-096, WH-097, WH-098, WH-099, WH-100, WH-101, WH-102, WH-103. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/company-finance-review.md](../../docs/company-finance-review.md)
- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [src/fair-use-finance.ts](../../src/fair-use-finance.ts)
- [tools/company-finance-input.mjs](../../tools/company-finance-input.mjs)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-041 — Resolve payment activation, commercial terms and plan scope

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **blocked**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Commercial engineering has explicit owner-approved provider, pricing, supported features and transaction/retention terms.

### Scope

- Preserve current proposed prices and standard-AI policy while reviewing economics
- Prepare Stripe/provider setup, subscription/tax/refund/dispute policy and customer eligibility decisions
- Distinguish narrower beta packaging from the unchanged full MVP delivery contract
- Use the approved cumulative tier contract and full-set launch gate; calibrate seats, usage, retention and third-party cost terms without automatic repricing

### Acceptance criteria

- [ ] No new payment account, charge or plan change without owner choice
- [ ] Annual domain, premium credit and capacity promises map to funded fulfillment
- [ ] Processor fees and jurisdiction/tax questions use current authoritative inputs and qualified review
- [ ] Any decision to defer an original MVP requirement is explicit, not hidden in marketing

### Verification

- Compare payments, pricing, lifecycle and resource-economics contracts
- List unresolved owner decisions and exact proposed configuration
- No live financial action during planning

### Dependencies and blockers

Planning dependencies: WH-020, WH-009. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Real-money activation, commercial/tax/refund/dispute terms and cost evidence remain undecided. Sandbox setup was resumed explicitly by the owner on October 1, 2026.

### References

- [docs/payments.md](../../docs/payments.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/plan-lifecycle.md](../../docs/plan-lifecycle.md)
- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [docs/mvp.md](../../docs/mvp.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: owner authorized Stripe sandbox signup/invoice/billing work and supplied a verified sk_test key. No real-money activation. Sandbox contract: docs/stripe-sandbox.md.

## WH-042 — Implement subscription, invoice and entitlement lifecycle

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Paid entitlements follow authoritative financial events and can recover duplicate, reordered or missing delivery.

### Scope

- Implement checkout/subscription mapping, monthly/annual fulfillment and reconciliation
- Handle cancellation, renewal, proration, refund, disputes and failed payment
- Maintain access/export/hosting grace policies and immutable compensating entries
- Feed verified paid events into WH-090 shared feature entitlements while retaining personal as the Creator identity
- Extend deployed WH-042 sandbox subscriptions, immutable paid invoice intervals and combined entitlement view; integrate WH-090 without creating a second subscription/grant resolver. WH-041 policies remain required before enabling each affected commercial behavior.

### Acceptance criteria

- [ ] Only verified server events grant entitlements; browser success pages do not
- [ ] Duplicate/reordered events cannot double-grant or silently regress paid state
- [ ] Annual purchase records exact service-interval coverage; future resource allowances reset by recorded periods without adding an extra month
- [ ] Sandbox proof precedes separately approved real payments
- [ ] Sandbox implementation/acceptance does not depend on WH-104/049; first paid activation stays gated by WH-104/047/049 and separate authorization

### Verification

- pnpm test:checkout
- pnpm test:billing
- pnpm test:plan-periods
- Synthetic provider lifecycle and missed-event reconciliation tests
- pnpm test:subscriptions

### Dependencies and blockers

Planning dependencies: WH-022, WH-122. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/payments.md](../../docs/payments.md)
- [docs/plan-lifecycle.md](../../docs/plan-lifecycle.md)
- [src/stripe-billing.ts](../../src/stripe-billing.ts)
- [src/plans.ts](../../src/plans.ts)
- [src/billing.ts](../../src/billing.ts)
- [docs/stripe-sandbox.md](../../docs/stripe-sandbox.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/30. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- Sandbox slice authorized independently of commercial cost-period gates: optional onboarding Checkout, exact paid invoice coverage, renewal reconciliation and restricted billing portal. WH-022/023 remain prerequisites for real-money activation. Proration, refunds/disputes and resource-wallet funding remain open.
- 2026-10-01: PR31 merged, release fcb8723b deployed 114 migrations/four Workers/16 assets. Synthetic owner completed mobile onboarding against deployed APIs and a real Stripe sandbox test-card Checkout; webhook independently recorded one paid invoice before any refresh. Paid state did not bypass project-first gate. Invoice portal and end-of-period cancellation accepted; paid access preserved, standard AI/customer credits zero, fixture cleaned. Detailed scoped evidence in docs/stripe-sandbox.md. Full commercial lifecycle remains open.
- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.

## WH-043 — Implement capacity ledger, grants, rollover and customer explanations

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers see authoritative measured capacity and separately funded balances instead of scenario estimates.

### Scope

- Add integer-unit immutable ledgers and atomic cross-service reservations
- Implement proposed lot/expiry/rollover rules only after terms approval
- Show measured categories, periods, uncertainty and reviewed opt-in top-ups
- Build ledger mechanisms with explicitly synthetic terms and no purchased balance first. WH-041 approves real lot/expiry/rollover terms and WH-023 calibrates values before WH-047/049 commercial activation; neither is a prerequisite to offline implementation.

### Acceptance criteria

- [ ] Retired test-unit balances remain deleted; current capacity/premium accounting cannot translate or revive them
- [ ] Standard assistance debits zero units; premium funding remains explicit
- [ ] Concurrent work, rollover expiry and refunds settle exactly once
- [ ] Unknown telemetry never displays false full capacity; no automatic upgrade or top-up by default

### Verification

- pnpm test:billing
- pnpm test:plan-periods
- Concurrent reserve/settle, lot-expiry, refund and unknown-dimension fixtures
- UI checks for proposed versus actual balances

### Dependencies and blockers

Planning dependencies: WH-022, WH-122. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [docs/unified-workspace-and-capacity.md](../../docs/unified-workspace-and-capacity.md)
- [src/capacity-policy.ts](../../src/capacity-policy.ts)
- [src/resource-economics.ts](../../src/resource-economics.ts)
- [src/billing.ts](../../src/billing.ts)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.

## WH-044 — Deliver explicit premium funding, dispatch and reconciliation

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Advanced-model work runs only against the exact customer-approved scope and funded tariff.

### Scope

- Connect approved premium quote, wallet reservation and provider dispatch
- Show maximum estimated spend and handle approved scope changes
- Reconcile actual receipts, refunds, cancellations and unknown outcomes

### Acceptance criteria

- [ ] Standard work and internal model escalation cannot silently consume premium credit
- [ ] Quote identity/model/tariff/limits are server-owned and immutable
- [ ] Lost acknowledgments cannot dispatch twice or release an uncertain hold
- [ ] Customer receives a plain-language authoritative receipt
- [ ] Premium maintenance inference is owner-facing only; visitor/service AI cannot use this wallet or route and requires the separate customer-configured WH-079 contract

### Verification

- pnpm test:gateway-spend
- pnpm test:gateway-inference
- Concurrent premium quote/confirmation/timeout tests
- Approved sandbox/provider canary before activation

### Dependencies and blockers

Planning dependencies: WH-021, WH-042, WH-043. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/ai-gateway-transport.md](../../docs/ai-gateway-transport.md)
- [src/gateway-spend.ts](../../src/gateway-spend.ts)
- [src/gateway-inference.ts](../../src/gateway-inference.ts)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-049 — Verify the full commercial MVP delivery contract

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: release. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Whumpo can claim the agreed MVP only after every contract requirement has appropriate live/customer evidence.

### Scope

- Reconcile the complete original MVP checklist against current implementation and accepted journeys
- Verify paid annual/monthly lifecycle, domain purchase and optional integrations
- Consolidate technical design, runbooks and cost/quality evidence for the release
- Require the entire Creator/Business/Business Pro extension and seven-provider set before first paid launch
- Require WH-112 acceptance of Chat as the primary owner surface, including reusable/custom forms and agent-managed supporting views

### Acceptance criteria

- [ ] No unavailable payment/provider/CMS journey is marked complete by a local test
- [ ] Two-period economics and funded entitlements are evidenced
- [ ] Device, tenant, uncertainty, publication/restore and recovery checks are current
- [ ] Any removal of a delivery-contract requirement needs an explicit owner amendment before closure
- [ ] Supported visitor/service flows continue with Whumpo maintenance inference unavailable and create zero maintainer requests, reservations or conversation changes; any optional customer runtime AI remains separately scoped
- [ ] WH-104 and expanded two-period WH-023 economics are accepted; no feature/connector implementation depends on this gate or activates paid checkout earlier

### Verification

- Full requirement-to-evidence review at candidate release
- Only selected focused suites justified by changes
- Separately authorized live financial/provider customer acceptance

### Dependencies and blockers

Planning dependencies: WH-048, WH-021, WH-023, WH-027, WH-029, WH-030, WH-031, WH-032, WH-033, WH-034, WH-035, WH-037, WH-038, WH-040, WH-042, WH-043, WH-044, WH-045, WH-047, WH-058, WH-104, WH-112. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/mvp.md](../../docs/mvp.md)
- [docs/acceptance.md](../../docs/acceptance.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/roadmap/README.md](../../docs/roadmap/README.md)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-034 — Build reviewed registrar purchase and renewal reconciliation

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The remaining MVP domain purchase contract has authoritative quotes and safe financial fulfillment.

### Scope

- Select a registrar adapter after eligibility/cost/terms research
- Show availability, initial/renewal price, taxes/fees, expiry and exact consent
- Implement idempotent purchase, uncertain-outcome reconciliation, renewal/disconnect/transfer lifecycle

### Acceptance criteria

- [ ] No client/model can set price, funding or purchase authority
- [ ] Expired quotes and changed prices require a new review
- [ ] Unknown outcomes never cause a second purchase
- [ ] No real purchase, auto-renewal or provider commitment occurs without exact authorization

### Verification

- pnpm test:domain-purchase-quote
- Synthetic registrar contract tests for duplicate/reordered/timeout results
- Sandbox and live purchase require separate owner approval

### Dependencies and blockers

Planning dependencies: WH-041, WH-042, WH-033. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/domains.md](../../docs/domains.md)
- [docs/payments.md](../../docs/payments.md)
- [docs/plan-lifecycle.md](../../docs/plan-lifecycle.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-045 — Fulfill annual domain benefits without unfunded purchases

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Eligible annual customers can redeem only the explicitly promised domain benefit under a verified wholesale cap.

### Scope

- Implement eligibility, already-used benefit, reserved cash and exact quote review
- Handle refunds, cancellation, renewal, ownership and transfer terms
- Keep premium names and prices outside caps unavailable without a separate approved purchase

### Acceptance criteria

- [ ] Concurrent redemptions cannot double-spend a benefit
- [ ] Annual benefit never authorizes automatic unreviewed purchase
- [ ] Uncertain registration preserves financial reservation
- [ ] Marketing matches implemented plan counts/caps and renewal responsibility

### Verification

- Synthetic concurrent redemption, quote expiry, refund and uncertain registration tests
- Review plan/domain contract consistency
- No real domain registration without exact authorization

### Dependencies and blockers

Planning dependencies: WH-034, WH-042, WH-023. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/domains.md](../../docs/domains.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/plan-lifecycle.md](../../docs/plan-lifecycle.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-046 — Finish fair-use notices and appeals before optional enforcement

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Any future restrictions have verified financial basis, independent appeal and explicit operator activation.

### Scope

- Connect trusted finance to reviewed individual cases
- Implement notice delivery, appeal, restriction scope/expiry/recheck and restoration
- Preserve Monitor as default and separate safety from financial usage policy

### Acceptance criteria

- [ ] Unknown profit or high cost alone cannot establish abuse
- [ ] Monitor sends no warnings, throttles or restrictions
- [ ] Appeals and essential support/export/recovery remain available under restrictions
- [ ] Enforcement activation is a separate operator decision, not required merely to mark the support workflow implemented

### Verification

- pnpm test:fair-use
- pnpm test:fair-use-reviews
- pnpm test:fair-use-finance
- Synthetic notice/appeal/reversal and Monitor invariance tests

### Dependencies and blockers

Planning dependencies: WH-023, WH-035. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/fair-use-reviews.md](../../docs/fair-use-reviews.md)
- [docs/usage-review-requests.md](../../docs/usage-review-requests.md)
- [docs/company-finance-review.md](../../docs/company-finance-review.md)
- [src/fair-use-finance.ts](../../src/fair-use-finance.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-047 — Reconcile launch pricing, availability, onboarding and support promises

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The public product describes only fulfilled plans and makes real next steps available.

### Scope

- Replace proposal-only pricing/trial/contact states with approved working enrollment paths
- Reconcile feature entitlements, annual terms, premium consent and domain benefits
- Update help, technical design and operational/support docs together
- Publish the cumulative matrix, Creator name and seven selected connections only with complete WH-104 evidence

### Acceptance criteria

- [ ] No unavailable feature is advertised as provisioned
- [ ] Checkout/renewal/limits and cancellation terms agree with server authority
- [ ] Standard AI remains unlimited under fair use without hidden unit charges
- [ ] Marketing, docs and actual journey acceptance reference the same dated release
- [ ] No staged paid launch or reduced provider/feature subset substitutes for the approved full set; missing benefits hold paid enrollment

### Verification

- Landing/pricing keyboard/mobile checks
- Catalogue-to-entitlement contract tests
- Document links and complete paid sandbox journey

### Dependencies and blockers

Planning dependencies: WH-042, WH-043, WH-044, WH-045, WH-035, WH-104, WH-023, WH-041. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [frontend/src/pricing.tsx](../../frontend/src/pricing.tsx)
- [frontend/src/landing.tsx](../../frontend/src/landing.tsx)
- [docs/mvp.md](../../docs/mvp.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/acceptance.md](../../docs/acceptance.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-054 — Add workspace collaboration with explicit roles and approvals

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Multi-person customers can collaborate without sharing owner credentials or expanding publication/spending authority accidentally.

### Scope

- Define and implement the Business Pro owner/editor/viewer/billing role contract and explicit project/release approval authority
- Design invitation, membership, audit and owner-transfer lifecycle
- Extend tenant predicates and exact approval authority consistently
- Split contract/schema, membership/invitations and approval/connected acceptance into coherent children; retain the parent gate
- Creator guest reviewers and Business notification destinations are not team members
- Expose routine owner operations through WH-105 registered read/action bindings and WH-107/109/110 Chat/view adapters; implement domain handlers once. Feature acceptance uses the shared owner surface, with essential direct recovery/security controls retained.
- Reuse WH-113/115 workspace enrollment, restricted recovery and current-authority policy for members. Do not add a separate member login, password fallback or account recovery route.
- Freeze membership data/readers/retention under WH-116 and register owner-facing bindings under WH-105 before new schema or clients. Connected feature acceptance uses the shared Chat renderer when available; backend work does not wait for the whole Chat rollout.

### Acceptance criteria

- [ ] Role changes revoke stale sessions/reviews as required
- [ ] Editors cannot spend, publish or manage identity unless explicitly granted
- [ ] Last-owner removal and cross-workspace membership are handled
- [ ] Existing single-owner isolation tests remain valid
- [ ] Business Pro eligibility/current membership govern shared reads/edits/approvals in APIs, Chat and jobs; revocation/downgrade invalidates ineligible access without deleting owner content

### Verification

- Role/tenant matrix and concurrent membership/review fixtures
- Device and invitation journeys
- Security review before multi-user activation

### Dependencies and blockers

Planning dependencies: WH-004, WH-009, WH-122, WH-115, WH-105, WH-116. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/app-data.md](../../docs/app-data.md)
- [docs/security-risk-actions.md](../../docs/security-risk-actions.md)
- [src/publications.ts](../../src/publications.ts)
- [src/billing.ts](../../src/billing.ts)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/workspace-identity.md](../../docs/workspace-identity.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.

## WH-056 — Standardize bounded external lookups and reviewed connector actions

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

All selected connections reuse server-controlled explicit bounded reads, reviewed actions, scoped consent, current eligibility and reliable reconciliation.

### Scope

- Define common capabilities for GitHub, Cloudflare, Gmail, Google Calendar, Outlook email, Microsoft Calendar and HubSpot; new adapter delivery belongs to WH-096–100
- Reuse encrypted scoped credentials, account binding, refresh/revocation, current eligibility and durable dispatch/readback receipts
- Define request-bound lookup/data-use consent and allowlisted operations; exclude arbitrary outbound fetch, continuous sync and visitor-triggered maintainer
- Keep WH-036 platform delivery independent of customer mailbox OAuth; split contract/implementation/conformance children without depending on provider children or WH-049
- Adapt existing Cloudflare/GitHub vault, consent and receipt machinery to the common contract before WH-031/032 final acceptance; platform sender delivery WH-036 is an independent adapter, not a prerequisite for all connectors.
- Classify provider-selected data, minimized receipts and key custody under WH-116 before new adapters persist data. Reuse the existing encrypted vault, allowing each provider to retain narrower operation and consent rules.

### Acceptance criteria

- [ ] Connector target hosts/scopes are server-controlled
- [ ] Unknown results reconcile without duplicate side effects
- [ ] Customer consent and price are explicit
- [ ] No arbitrary outbound fetch from generated source is introduced
- [ ] Connector and notification runtime actions remain deterministic and cannot invoke the owner maintainer; any customer-configured AI route is separately governed by WH-079
- [ ] Keep inclusion, consent/configuration and readiness distinct; common conformance does not imply provider acceptance
- [ ] Reads need explicit bounded owner requests; external data cannot authorize tools or enter the training-enabled test model
- [ ] Approved deterministic recipes retain exact rule/destination limits and require accepted provider adapters
- [ ] Each operation declares owner-request or specifically approved deterministic-rule authority. Provider adapters that admit owner requests only cannot be called by background rules merely because their scopes permit sending.

### Verification

- Synthetic connector conformance and revoked-token tests
- Approved provider sandbox acceptance
- Review privacy/deletion and rate limits

### Dependencies and blockers

Planning dependencies: WH-004, WH-009, WH-052, WH-122, WH-105, WH-116, WH-140, WH-141, WH-142, WH-143, WH-144, WH-145, WH-146. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/integrations/cloudflare-connection.md](../../docs/integrations/cloudflare-connection.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [docs/backend-execution.md](../../docs/backend-execution.md)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [src/connection-vault.ts](../../src/connection-vault.ts)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/connectors.md](../../docs/connectors.md)
- [tools/prototypes/connectors.mjs](../../tools/prototypes/connectors.mjs)
- [tests/connectors-contract.mjs](../../tests/connectors-contract.mjs)
- [docs/integrations/github-connection.md](../../docs/integrations/github-connection.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/115. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.
- 2026-10-04 UTC: WH-140 freezes the common connector contract in docs/connectors.md with an offline reference and synthetic conformance harness, and splits delivery into WH-141–146. Parent acceptance is unchanged and closes only after every child; provider sandbox/customer acceptance remains in WH-031/032/096–100.

## WH-089 — Define cumulative tier contracts and roll out the Creator display name

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **ready**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The catalogue, API labels, pricing UI, Settings and Chat describe the approved cumulative launch matrix without presenting undelivered features as available.

### Scope

- Implement the Starter/Creator/Business/Business Pro feature matrix and stable feature identifiers; preserve monthly/annual prices and standard-AI policy
- Rename plan-specific Personal display text to Creator while retaining personal identifiers, saved preferences, historical receipts/evidence and product mappings
- Define separate plan inclusion, provider configuration/consent and actual readiness; specify downgrade/expiry and protected recovery access
- Keep the entire feature/provider set behind WH-104/047/049; calibrate remaining seats, volumes, retention and costs through WH-009/023/041

### Acceptance criteria

- [ ] Business inherits Creator and Business Pro inherits Business; external connections are absent from Starter/Creator and all seven selected providers are named
- [ ] No new creator plan ID, repricing, grant replay or historical receipt rewrite; existing API and preference identities remain compatible
- [ ] Guest feedback is accountless, expiring and revocable; security, exact reviews, basic recovery, supported export and standard assistance remain common
- [ ] Catalogue/UI/Chat distinguish planned from implemented/configured/accepted functionality and retain free-preview, explicit sandbox-checkout and unavailable real-payment labels until commercial activation
- [ ] The documented loss-of-eligibility contract requires newly ineligible actions/unsent work to stop while preserving history/export/disconnect/uncertain reconciliation and published sites; runtime enforcement is WH-090

### Verification

- pnpm test:plan-periods and catalogue-to-API/UI/Chat contract checks for all four tiers
- Pricing/Settings keyboard/mobile checks with current personal plan preferences and invoice receipts
- pnpm check/build for code changes; docs/backlog checks without billing or provider mutation

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [src/plans.ts](../../src/plans.ts)
- [src/billing.ts](../../src/billing.ts)
- [frontend/src/pricing.tsx](../../frontend/src/pricing.tsx)
- [frontend/src/workspace-pages.tsx](../../frontend/src/workspace-pages.tsx)
- [src/connection-chat.ts](../../src/connection-chat.ts)
- [docs/plan-lifecycle.md](../../docs/plan-lifecycle.md)
- [docs/plan-feature-contract.md](../../docs/plan-feature-contract.md)
- [src/plan-features.ts](../../src/plan-features.ts)
- [frontend/src/plan-features.tsx](../../frontend/src/plan-features.tsx)
- [tests/plan-catalogue.mjs](../../tests/plan-catalogue.mjs)
- [tools/plan-catalogue-browser.mjs](../../tools/plan-catalogue-browser.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/44. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: cumulative version-1 launch feature catalogue and Creator display rollout implemented against 9cb2a62. personal IDs/prices/preferences/provider mappings and immutable receipts preserved. API/pricing/Settings/Chat distinguish planned inclusions, existing foundations, required provider consent and pending launch acceptance; all seven Business/Pro connections named and common security/recovery/export/standard AI retained. Catalogue, plan-period and synthetic subscription regressions, TypeScript/build/loading and connected loopback mobile/keyboard preference checks passed. No runtime feature enforcement, real billing/provider action, schema or deployment; WH-090 and feature/launch acceptance remain separate. See docs/plan-feature-contract.md and issue #44.
- 2026-10-01 15:54:10 UTC: archived fe5e5db deployed as release 37497b4a-0b2d-4004-94cf-12838eff9e96. Independent readback verified all four Worker versions, 116 migrations with none pending, unchanged bindings/CMS inventory, 18 exact assets and the complete public catalogue; Creator remains personal. Anonymous/foreign-origin denials and sandbox-only billing remain correct. No customer/provider mutation or new feature activation. See docs/plan-feature-contract.md.

## WH-090 — Enforce shared server feature entitlements independently of billing activation

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Every admission path uses authoritative current eligibility without confusing planned inclusion or an OAuth token with usable authority.

### Scope

- Extend the existing authoritative subscription/coverage resolver from the deployed WH-042 sandbox; expose common feature eligibility with scoped synthetic preview grants, preserving invoice service intervals and historical receipts.
- Expose distinct inclusion, configuration/consent and readiness to UI/Chat while enforcing actor/tenant/resource authority inside APIs, handlers and jobs
- Recheck OAuth start/callback activation, review confirmation and external dispatch across renewal/expiry and revocation races
- Define explicit server-owned scoped private-preview grants; neither Explore, an environment flag nor a draft preference implicitly grants paid access
- Separate new privileged actions from history/export/disconnect and narrow uncertain-effect reconciliation; split interface, enforcement and connected acceptance children

### Acceptance criteria

- [ ] Current invoice coverage is the paid-plan source; deleted test balances, client flags, model output and launchFeatures are never authorization
- [ ] Starter/Creator cannot authorize connections; inheritance and Business Pro collaboration are enforced through every direct/Chat/background entrypoint
- [ ] Unsent work stops on eligibility loss; reconciliation cannot create new side effects or repeat an uncertain send
- [ ] History/export/revocation and existing published sites survive entitlement loss without retaining unauthorized collaborator access or leaking another tenant
- [ ] Explicit preview test grants permit controlled acceptance without enabling paid checkout or granting real customer subscriptions
- [ ] No second paid-plan truth or calendar-month reinterpretation of invoice intervals; existing sandbox coverage and explicit preview grants feed one feature decision, while standard AI remains non-billable.

### Verification

- Existing billing/plan-period and connection suites plus complete feature/tier/actor matrix
- Direct-handler/HTTP/Chat/job races around rollover, revoked grants, OAuth callbacks and confirmation
- Lost-response/replay/uncertain readback and protected recovery/export cases with disposable D1

### Dependencies and blockers

Planning dependencies: WH-089, WH-004, WH-113, WH-122, WH-054, WH-056, WH-091, WH-092, WH-093, WH-094, WH-095, WH-096, WH-097, WH-098, WH-099, WH-100, WH-101, WH-102, WH-103. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [src/plans.ts](../../src/plans.ts)
- [src/billing.ts](../../src/billing.ts)
- [docs/plan-lifecycle.md](../../docs/plan-lifecycle.md)
- [docs/integrations/github-connection.md](../../docs/integrations/github-connection.md)
- [docs/integrations/cloudflare-connection.md](../../docs/integrations/cloudflare-connection.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/workspace-identity.md](../../docs/workspace-identity.md)
- [docs/plan-feature-contract.md](../../docs/plan-feature-contract.md)
- [docs/feature-inclusion.md](../../docs/feature-inclusion.md)
- [docs/feature-admission.md](../../docs/feature-admission.md)
- [docs/feature-acceptance.md](../../docs/feature-acceptance.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/62. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01: split into #63 current inclusion/preview-grant interface, #64 enforcement and #65 connected acceptance/test release. The foundation extends current invoice coverage rather than creating paid-plan truth. Parent stays open; inclusion alone is not authorization and no current handler is represented as gated until its adapter acceptance.
- 2026-10-01: #64 source adapters enforce current inclusion at GitHub/Cloudflare OAuth, provider reads, exact review/confirmation and dispatch boundaries; protected uncertain recovery is bound to recorded read-only destinations. Full #64/#65 acceptance still requires the shared WH-114/115 principal runtime, session/epoch/restricted-purpose revocation and future membership/job adapters. Source implementation is not a deployed or full-authorization claim.
- 2026-10-02 UTC: current owner GitHub/Cloudflare admission and shared identity handoff accepted for #64/#65. Current-schema SQLite and local D1: 434 composed identity checks, 728 inclusion decisions, 37 provider refusal/race cases, real invoice/preview expiry with retained publication/export, and connection UI. Independent deployed four-Worker/schema/39-asset readback plus signed synthetic login, five digest-reviewed preview grants, explicit revocation and scoped cleanup passed. No provider exchange, inference or real billing. Parent remains open for broader planned feature/collaboration acceptance; physical devices and future provider/job adapters keep their own gates. See docs/feature-acceptance.md.
- 2026-10-02 UTC: preserved all scope/acceptance and made the remaining cumulative adapter gate explicit. Completed current foundation is WH-122/#65; WH-090 now waits for collaboration, connector and WH-091–103 feature delivery. Implementers consume WH-122 so they do not wait on their own parent acceptance. WH-104 still requires full WH-090.

## WH-096 — Deliver requested Gmail reads and reviewed send or reply actions

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A Business owner requests bounded Gmail lookups and reviews exact outgoing messages without granting background mailbox automation.

### Scope

- Split this L packet into contract/scope, isolated implementation and separately blocked live-acceptance children; retain parent acceptance until all selected behavior is proven
- Specify customer OAuth gmail.readonly plus gmail.send and required identity/refresh access only; exclude mailbox modification/deletion, bulk campaigns and background polling/indexing
- Execute only explicit bounded owner-request lookups; minimize selected content, obtain in-context data-use consent and enforce retention and the accepted WH-020/021 production privacy route before real data reaches AI
- Bind exact reviewed resource/recipient/content/field changes and current connection/entitlement to durable operation receipts; reconcile uncertainty without blind redispatch
- Treat searches, selected message/body reads and send/reply as bounded operations; distinguish provider acceptance from confirmed delivery

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] Provider content is untrusted input, never authority for more tools; credentials and unrelated private data never enter model context
- [ ] No continuous synchronization, unattended polling, indexing or webhook-triggered maintainer calls
- [ ] Local evidence, configuration and real customer acceptance are separate; implementation does not activate providers or paid services
- [ ] Requested search/result/body bounds and connected-account scope are enforced server-side; unrelated threads/attachments are not silently fetched
- [ ] Every send/reply pins recipients, subject/body and attachment policy; lost sends remain uncertain rather than automatically repeating
- [ ] Restricted-scope verification and applicable security assessment or verified exception, renewal owner and reviewed initial/recurring cost are accepted before public launch
- [ ] Real mailbox content never enters the contributor/training-enabled test model

### Verification

- Synthetic OAuth state/PKCE/account binding, scope refusal, token replacement/revocation and tenant-isolation checks
- Direct API/Chat lookups and exact review/confirmation fixtures with stale authority, replay, throttling and lost-response recovery
- Focused mobile/keyboard browser consent-return and action-review journey; pnpm check/build when implementation changes code
- Separately reviewed real-account consent, bounded lookup, exact mutation and revocation evidence with sanitized receipts
- Restricted-data consent/privacy, prompt-injection, duplicate-send and no-background-read fixtures; reverify Google launch requirements

### Dependencies and blockers

Planning dependencies: WH-056, WH-020. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Public Gmail OAuth registration and restricted-scope verification remain prerequisites.
- Applicable security assessment/verified exception, initial/recurring cost review and renewal ownership require explicit acceptance.
- Consenting test accounts and accepted production privacy are required for connected-data acceptance.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/integrations/github-connection.md](../../docs/integrations/github-connection.md)
- [src/connection-vault.ts](../../src/connection-vault.ts)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-09 UTC: planning-only provider readiness plan in docs/connector-provider-readiness.md (offline check tests/connector-provider-readiness.mjs) re-read official provider documentation for gmail.readonly (restricted) and gmail.send (sensitive). Blocking approvals: separate Google Cloud test/production projects, Search Console domain verification, brand plus sensitive- and restricted-scope verification with a demo video, an annual CASA security assessment by a developer-paid authorized assessor, and counsel review of Limited Use and the Workspace AI-training clause before any model-context use. No provider account, client, consent screen or submission was created and no approval, verification or assessment is claimed. Status unchanged: not delivered.

## WH-097 — Deliver requested Google Calendar reads and reviewed event changes

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A Business owner inspects selected owned calendars and approves event changes with visible timing and notification effects.

### Scope

- Split this L packet into contract/scope, isolated implementation and separately blocked live-acceptance children; retain parent acceptance until all selected behavior is proven
- Specify calendar-list read and owned-event authorization; app-created-only scope does not satisfy existing-calendar lookup
- Execute only explicit bounded owner-request lookups; minimize selected content, obtain in-context data-use consent and enforce retention and the accepted WH-020/021 production privacy route before real data reaches AI
- Bind exact reviewed resource/recipient/content/field changes and current connection/entitlement to durable operation receipts; reconcile uncertainty without blind redispatch
- Bound date ranges/event fields; review timezones, recurrence, attendee notifications and cancellation; exclude calendar administration and general/shared-calendar sync

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] Provider content is untrusted input, never authority for more tools; credentials and unrelated private data never enter model context
- [ ] No continuous synchronization, unattended polling, indexing or webhook-triggered maintainer calls
- [ ] Local evidence, configuration and real customer acceptance are separate; implementation does not activate providers or paid services
- [ ] Only selected owned calendars are admitted; broad provider consent never authorizes arbitrary calendars or all-history reads
- [ ] Create/update/delete reviews capture current event/resource state and notification effects; remote conflicts require fresh review
- [ ] Duplicate confirmations, timeouts and cancelled/revoked authority recover the existing operation rather than create duplicate events
- [ ] Current OAuth verification, quotas/cost and real consent/revocation are accepted

### Verification

- Synthetic OAuth state/PKCE/account binding, scope refusal, token replacement/revocation and tenant-isolation checks
- Direct API/Chat lookups and exact review/confirmation fixtures with stale authority, replay, throttling and lost-response recovery
- Focused mobile/keyboard browser consent-return and action-review journey; pnpm check/build when implementation changes code
- Separately reviewed real-account consent, bounded lookup, exact mutation and revocation evidence with sanitized receipts
- DST/timezone, recurrence, remote edit, attendee-notification disclosure and duplicate-event fixtures

### Dependencies and blockers

Planning dependencies: WH-056, WH-020. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Google customer OAuth registration/scope verification and current quota/price review remain prerequisites.
- Selected owned calendars, consenting accounts and accepted production privacy are required for real-data journeys.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [src/connection-vault.ts](../../src/connection-vault.ts)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-09 UTC: planning-only provider readiness plan in docs/connector-provider-readiness.md (offline check tests/connector-provider-readiness.mjs) re-read official provider documentation for calendar.calendarlist.readonly and calendar.events.owned (sensitivity class requires verification). Blocking approvals: the shared Google projects and domain verification, brand and sensitive-scope verification with a demo video, and counsel review of Limited Use and the AI clause; client event IDs do not guarantee duplicate detection, so readback stays required. No provider account, client, consent screen or submission was created and no approval, verification or assessment is claimed. Status unchanged: not delivered.

## WH-098 — Deliver requested Outlook email reads and reviewed send or reply actions

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A Business owner requests bounded Outlook lookups and approves outgoing messages using their own delegated account.

### Scope

- Split this L packet into contract/scope, isolated implementation and separately blocked live-acceptance children; retain parent acceptance until all selected behavior is proven
- Specify delegated Mail.Read and Mail.Send plus necessary identity/refresh access; exclude application-wide/shared mailboxes, mailbox modification/deletion and bulk campaigns
- Execute only explicit bounded owner-request lookups; minimize selected content, obtain in-context data-use consent and enforce retention and the accepted WH-020/021 production privacy route before real data reaches AI
- Bind exact reviewed resource/recipient/content/field changes and current connection/entitlement to durable operation receipts; reconcile uncertainty without blind redispatch
- Support eligible personal/work-school accounts and explicit tenant-consent denial; provider acceptance does not prove delivery

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] Provider content is untrusted input, never authority for more tools; credentials and unrelated private data never enter model context
- [ ] No continuous synchronization, unattended polling, indexing or webhook-triggered maintainer calls
- [ ] Local evidence, configuration and real customer acceptance are separate; implementation does not activate providers or paid services
- [ ] Bind delegated identity/account through consent, lookup and sending; never substitute tenant-wide application authority
- [ ] Exact recipients/content require review; 202/provider acceptance is not delivered status
- [ ] Lost sends, token replacement and admin-consent refusal produce honest recoverable state without hidden scopes/fallback credentials
- [ ] Publisher/tenant requirements, mailbox entitlement, throttling and supported account types are accepted before launch

### Verification

- Synthetic OAuth state/PKCE/account binding, scope refusal, token replacement/revocation and tenant-isolation checks
- Direct API/Chat lookups and exact review/confirmation fixtures with stale authority, replay, throttling and lost-response recovery
- Focused mobile/keyboard browser consent-return and action-review journey; pnpm check/build when implementation changes code
- Separately reviewed real-account consent, bounded lookup, exact mutation and revocation evidence with sanitized receipts
- Personal/work-school/admin-blocked consent, selected-body reads and uncertain-send fixtures

### Dependencies and blockers

Planning dependencies: WH-056, WH-020. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Microsoft registration, applicable publisher verification/tenant consent and account/license review remain prerequisites.
- Consenting supported account types and accepted production privacy are required for real-data acceptance.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [src/connection-vault.ts](../../src/connection-vault.ts)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-09 UTC: planning-only provider readiness plan in docs/connector-provider-readiness.md (offline check tests/connector-provider-readiness.mjs) re-read official provider documentation for delegated offline_access, Mail.Read and Mail.Send (admin consent not required by default). Blocking approvals: an Entra work/school tenant, a verified Microsoft AI Cloud Partner Program account and publisher verification with a matching verified domain, tenant consent/admin-approval handling, and counsel review of Microsoft APIs Terms of Use sections 3(c) and 5; Graph paging conflicts with the contract's token-extraction rule (first page only recommended). No provider account, client, consent screen or submission was created and no approval, verification or assessment is claimed. Status unchanged: not delivered.

## WH-099 — Deliver requested Microsoft Calendar reads and reviewed event changes

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A Business owner inspects selected user calendars and approves exact event changes without tenant-wide or continuous calendar sync.

### Scope

- Split this L packet into contract/scope, isolated implementation and separately blocked live-acceptance children; retain parent acceptance until all selected behavior is proven
- Specify delegated Calendars.ReadWrite plus required identity/refresh access; enforce narrower selected-calendar boundaries inside Whumpo
- Execute only explicit bounded owner-request lookups; minimize selected content, obtain in-context data-use consent and enforce retention and the accepted WH-020/021 production privacy route before real data reaches AI
- Bind exact reviewed resource/recipient/content/field changes and current connection/entitlement to durable operation receipts; reconcile uncertainty without blind redispatch
- Review timezone, recurrence, attendees/invitations and cancellation; exclude application-wide/shared-calendar sync and calendar administration

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] Provider content is untrusted input, never authority for more tools; credentials and unrelated private data never enter model context
- [ ] No continuous synchronization, unattended polling, indexing or webhook-triggered maintainer calls
- [ ] Local evidence, configuration and real customer acceptance are separate; implementation does not activate providers or paid services
- [ ] Requested ranges and resource IDs stay within selected user calendars on every read/mutation
- [ ] Broader provider permission cannot be exercised through forged IDs or alternate API/Chat paths
- [ ] Event/transaction receipts, remote revision checks and targeted readback prevent unsafe repeats after lost responses
- [ ] Tenant consent, supported personal/work-school accounts, throttling and real revocation/notification behavior are accepted

### Verification

- Synthetic OAuth state/PKCE/account binding, scope refusal, token replacement/revocation and tenant-isolation checks
- Direct API/Chat lookups and exact review/confirmation fixtures with stale authority, replay, throttling and lost-response recovery
- Focused mobile/keyboard browser consent-return and action-review journey; pnpm check/build when implementation changes code
- Separately reviewed real-account consent, bounded lookup, exact mutation and revocation evidence with sanitized receipts
- Calendar selection, DST/timezone, recurrence, remote conflicts, invitations and duplicate/cancelled events

### Dependencies and blockers

Planning dependencies: WH-056, WH-020. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Microsoft registration, publisher/tenant policy and current account entitlement/limits require review.
- Selected calendars, consenting supported accounts and production privacy are required for real-data acceptance.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [src/connection-vault.ts](../../src/connection-vault.ts)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-09 UTC: planning-only provider readiness plan in docs/connector-provider-readiness.md (offline check tests/connector-provider-readiness.mjs) re-read official provider documentation for delegated offline_access and Calendars.ReadWrite. Blocking approvals: the same Microsoft tenant, partner account and publisher verification, and section 3(c) counsel review; attendee invitations cannot be suppressed and must be disclosed in the review. No provider account, client, consent screen or submission was created and no approval, verification or assessment is claimed. Status unchanged: not delivered.

## WH-100 — Deliver requested HubSpot contact lookup and reviewed lead mapping

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Business owners inspect contacts and deliberately link or apply selected lead fields without overwriting unrelated CRM data.

### Scope

- Split this L packet into contract/scope, isolated implementation and separately blocked live-acceptance children; retain parent acceptance until all selected behavior is proven
- Use customer OAuth contacts read/write only; define bounded search/read, match and Whumpo-lead-to-contact mapping
- Execute only explicit bounded owner-request lookups; minimize selected content, obtain in-context data-use consent and enforce retention and the accepted WH-020/021 production privacy route before real data reaches AI
- Bind exact reviewed resource/recipient/content/field changes and current connection/entitlement to durable operation receipts; reconcile uncertainty without blind redispatch
- Review existing matches/conflicts before link/create; update only selected fields against recorded contact identity; exclude deals, marketing workflows, bulk imports and continuous sync

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] Provider content is untrusted input, never authority for more tools; credentials and unrelated private data never enter model context
- [ ] No continuous synchronization, unattended polling, indexing or webhook-triggered maintainer calls
- [ ] Local evidence, configuration and real customer acceptance are separate; implementation does not activate providers or paid services
- [ ] Account/contact identity is verified; ambiguous or changed matches need review rather than blind upsert
- [ ] Unmapped fields survive updates; duplicate/lost creation responses resolve through targeted evidence or remain uncertain
- [ ] Revocation, plan loss and account replacement stop new access/writes while retaining local history and permitted reconciliation
- [ ] Authorized installation, distribution capacity, quotas/scopes and real contact/read/write/revocation are evidenced

### Verification

- Synthetic OAuth state/PKCE/account binding, scope refusal, token replacement/revocation and tenant-isolation checks
- Direct API/Chat lookups and exact review/confirmation fixtures with stale authority, replay, throttling and lost-response recovery
- Focused mobile/keyboard browser consent-return and action-review journey; pnpm check/build when implementation changes code
- Separately reviewed real-account consent, bounded lookup, exact mutation and revocation evidence with sanitized receipts
- Ambiguous matches, selected-field preservation, remote edit conflicts and duplicate contact-create fixtures

### Dependencies and blockers

Planning dependencies: WH-056, WH-093, WH-020. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- HubSpot OAuth app, authorized installer and approved distribution capacity/current account limits require verification.
- Consenting test account/contact records and production privacy are required for real-data acceptance.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [src/connection-vault.ts](../../src/connection-vault.ts)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-09 UTC: planning-only provider readiness plan in docs/connector-provider-readiness.md (offline check tests/connector-provider-readiness.mjs) re-read official provider documentation for oauth, crm.objects.contacts.read and crm.objects.contacts.write. Blocking approvals: HubSpot developer and test accounts, a Marketplace-distributed OAuth app and signed Acceptable Use Policy (25-install cap until listed; listing needs three unaffiliated active installs and HubSpot review), and counsel review of the Developer Terms AI-training and third-party-sharing clauses. The catalog's OAuth v1 token and refresh-token delete endpoints are deprecated on 2027-02-16 and must move to date-versioned endpoints before a client is registered. No provider account, client, consent screen or submission was created and no approval, verification or assessment is claimed. Status unchanged: not delivered.

## WH-101 — Deliver Business Pro staging and exact release promotion

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A team validates a private candidate with synthetic state, then promotes that exact reviewed release with compatible recovery.

### Scope

- Define staging for supported composed project versions/module locks through existing preview/release machinery
- Separate staging data/credentials/runtime bindings; use synthetic scoped data and suppress real email/calendar/CRM/DNS/other external effects
- Bind current membership, candidate/artifact digests, tests and production base to release reviews; changed candidates require validation
- Split isolation, promotion/restore and team acceptance children; dedicated infrastructure and arbitrary live-data clones are not included
- Expose routine owner operations through WH-105 registered read/action bindings and WH-107/109/110 Chat/view adapters; implement domain handlers once. Feature acceptance uses the shared owner surface, with essential direct recovery/security controls retained.

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] Staging cannot mutate production records, publish candidates or dispatch real provider actions
- [ ] Promotion uses exact approved candidate and authorized approver; changed membership/base/module versions invalidate stale review
- [ ] Failed promotion preserves receipts and compatible recovery without bypassing current safety/deletion rules
- [ ] Production availability follows the established release contract; staging does not promise unrestricted environments

### Verification

- Two-tenant staging/production isolation with provider spies proving zero real effects
- Concurrent release/base edits, membership loss, interrupted promotion and compatible restore
- Connected team preview/review/promotion/recovery and focused accessibility checks

### Dependencies and blockers

Planning dependencies: WH-054, WH-066, WH-029, WH-076. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/releases.md](../../docs/releases.md)
- [docs/project-specification-storage.md](../../docs/project-specification-storage.md)
- [docs/app-data.md](../../docs/app-data.md)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-102 — Deliver permission-filtered Business Pro portfolio reports

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A team sees truthful health, traffic and lead outcomes across only projects each viewer can currently access.

### Scope

- Aggregate selected workspace projects using existing health/traffic/conversion contracts
- Apply current membership/project permissions to queries, cached results and supported exports
- Show evidence timestamps, partial availability, compatible windows and exclusions without inferred zeros or fabricated total capacity
- Expose routine owner operations through WH-105 registered read/action bindings and WH-107/109/110 Chat/view adapters; implement domain handlers once. Feature acceptance uses the shared owner surface, with essential direct recovery/security controls retained.

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] Revoked/foreign projects are excluded from reads/caches/exports and unauthorized aggregate clues
- [ ] Totals reconcile to permitted project reports with unchanged traffic/conversion definitions
- [ ] Missing telemetry/provider evidence and different reporting coverage remain visible; reads do not trigger provider mutations or new infrastructure
- [ ] Export/deletion and retained reporting evidence follow the lifecycle contract

### Verification

- Synthetic multi-project/role totals, revocation/cache and mixed-period fixtures
- Reconcile exports/totals with accepted per-project outcomes
- Responsive keyboard-accessible charts/tables with empty/partial states

### Dependencies and blockers

Planning dependencies: WH-054, WH-095, WH-037. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/unified-workspace-and-capacity.md](../../docs/unified-workspace-and-capacity.md)
- [src/site-traffic.ts](../../src/site-traffic.ts)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-103 — Deliver reviewed Business Pro changes across multiple projects

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A team prepares exact brand/content changes across selected projects with bounded execution, per-project outcomes and recovery.

### Scope

- Prepare immutable candidates for selected authorized projects and pinned kit/module versions
- Show each diff and required authority; approve the exact candidate set rather than a later-expanded selection
- Use per-project durable receipts; refuse stale/unauthorized candidates, surface partial success and retry only safe unresolved work
- Retain individual compatible restore and separate publication approval; split proposal/review, execution/recovery and connected acceptance
- Expose routine owner operations through WH-105 registered read/action bindings and WH-107/109/110 Chat/view adapters; implement domain handlers once. Feature acceptance uses the shared owner surface, with essential direct recovery/security controls retained.

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] Reviewed selections cannot grow, cross tenant authority or overwrite unrelated content/custom overrides silently
- [ ] Concurrent edits, membership loss or incompatible modules require refusal/fresh review
- [ ] Retries and lost responses do not duplicate application or claim all-project atomicity; every project has a truthful outcome
- [ ] Bulk changes never silently publish or restore unrelated changes; current safety/deletion rules remain effective

### Verification

- Two-owner multi-project prepare/review/apply with stale selections and foreign IDs
- Failure after each project, replay, lost acknowledgements, backpressure and individual restore
- Accessible browser diff selection/approval and partial-outcome presentation

### Dependencies and blockers

Planning dependencies: WH-091, WH-054, WH-066, WH-075, WH-076. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/project-specification-storage.md](../../docs/project-specification-storage.md)
- [docs/version-comparisons.md](../../docs/version-comparisons.md)
- [docs/version-retention.md](../../docs/version-retention.md)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-104 — Accept the complete cumulative tier set before the first paid launch

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: verification. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

One candidate release proves every selected tier benefit and all seven provider journeys before commercial presentation or paid activation.

### Scope

- Maintain a tier/feature/entrypoint evidence matrix for all four tiers, inheritance and selected connector operations
- Complete Creator reuse/feedback, Business lead/workflow/lookup/action/reporting and Pro collaboration/staging/portfolio/bulk journeys
- Reconcile grants with WH-042 sandbox subscription events and Creator identity; verify renewal/downgrade and protected recovery
- Require accepted production privacy and real provider consent/action/revocation evidence and cost/readiness reviews; split fixture/browser/external acceptance children
- Require WH-080 composed-pilot evidence in addition to the tier journeys, so launch cannot precede shared-module isolation and zero-maintainer visitor-serving proof. The pilot remains synthetic; real provider/customer acceptance is still separately required.

### Acceptance criteria

- [ ] Every new packet and promoted WH-054/056 foundation meets acceptance; configuration or mock success cannot satisfy live provider delivery
- [ ] All seven connections and cumulative tier benefits are accepted against one candidate release with lower-tier bypass tests
- [ ] Guest expiry/revocation, tenant isolation, stale approvals, duplicate intake, uncertainty, membership loss, staging and partial bulk recovery pass
- [ ] Standard AI has zero customer-unit debits; visitors/services/jobs create zero maintainer calls; real connected data never enters the training-enabled test model
- [ ] WH-047/049 cannot approve first paid launch while this gate is incomplete; free WH-048 beta and Android remain independent
- [ ] This gate does not activate Stripe, resume CMS testing, send invitations, deploy customer code or replace WH-023 economics/original MVP acceptance

### Verification

- Candidate-release feature/tier/actor matrix across direct APIs, Chat and jobs
- Connected desktop/mobile/keyboard/accessibility journeys for each tier
- Separately authorized real provider lookups/reviews/actions/revocation with privacy/scope evidence
- WH-042 sandbox transition/reconciliation and protected history/export/recovery checks
- Focused relevant suites and sanitized source/config/local/live/device evidence; no invented acceptance from mocks

### Dependencies and blockers

Planning dependencies: WH-089, WH-090, WH-091, WH-092, WH-093, WH-094, WH-095, WH-096, WH-097, WH-098, WH-099, WH-100, WH-101, WH-102, WH-103, WH-031, WH-032, WH-042, WH-021, WH-112, WH-080. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Real provider approvals, consenting accounts and accepted production privacy remain required; see WH-031/032 and WH-096–100.
- Stripe sandbox is deployed and owner-authorized; real-money activation and CMS testing remain gated. Local/connected evidence never authorizes commercial activation.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/roadmap/README.md](../../docs/roadmap/README.md)
- [docs/acceptance.md](../../docs/acceptance.md)
- [docs/plan-lifecycle.md](../../docs/plan-lifecycle.md)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/plan-feature-contract.md](../../docs/plan-feature-contract.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-122 — Accept shared feature admission foundation for implementing adapters

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **ready**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Future feature implementations consume one accepted current inclusion and identity-admission foundation while cumulative adapter acceptance remains in WH-090.

### Scope

- Name the completed WH-090A/B/C interface, implemented owner/provider enforcement and connected acceptance as a reusable handoff
- Retain one invoice-coverage and scoped-preview resolver, shared current identity, current dispatch predicates and protected history/recovery
- Require each future feature to register its own role, resource, Chat/job and provider adapters before the full WH-090 acceptance gate

### Acceptance criteria

- [ ] Current inclusion matrix, owned GitHub/Cloudflare API/Chat paths and current identity/restricted-purpose/epoch boundaries are verified
- [ ] Actual invoice and preview expiry block new actions while owned history/export/disconnect and already published sites retain their intended behavior
- [ ] Exact uncertain readback never repeats a write, temporary test grants are explicitly revoked and synthetic identities are cleaned up
- [ ] Deployed current schema/Worker/assets and configuration/readiness presentation have independent evidence; future features remain unavailable until implemented
- [ ] Parent WH-090 stays open for all cumulative tier and collaboration adapters; consuming this handoff neither narrows that acceptance nor activates a paid subscription

### Verification

- Review completed #63/#64/#65 and docs/feature-acceptance.md criterion evidence at e21a106
- Preserve the recorded 434 identity, 728 inclusion, 37 refusal/race, retention and live probe verification limits
- Validate the graph rejects waiting for cumulative feature acceptance before implementing those features

### Dependencies and blockers

Planning dependencies: WH-089, WH-004, WH-113. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/feature-acceptance.md](../../docs/feature-acceptance.md)
- [docs/feature-admission.md](../../docs/feature-admission.md)
- [docs/plan-feature-contract.md](../../docs/plan-feature-contract.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [tests/feature-identity.mjs](../../tests/feature-identity.mjs)
- [tests/feature-retention.mjs](../../tests/feature-retention.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/65. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: maps the already completed WH-090C/#65 handoff without reopening it or expanding its historical acceptance. e21a106 verified current schema/identity/provider boundaries and live cleanup; e27e088 later changed only favicon assets. Future tier/collaboration adapters remain required by parent WH-090/#62.

## WH-140 — Freeze the common connector contract and decompose WH-056

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **ready**. Kind: decision. Size: S.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Every connector slice and provider adapter builds against one frozen catalog, operation declaration, authority/consent/receipt model and offline conformance suite instead of inventing its own.

### Scope

- Freeze the provider catalog shape: server-controlled origins, scopes, typed path/query/body templates, bounds, price and WH-116 data class per operation
- Freeze authority classes (owner-request versus approved deterministic rule), request-bound lookup/data-use consent, receipt states, unknown-outcome reconciliation, refresh/revocation and the four distinct inclusion/configuration/consent/readiness states
- Map existing GitHub/Cloudflare vault, admission, review and receipt machinery onto the contract with exact gaps; declare planned operations for the five new providers without verifying or enabling them
- Add an offline reference runtime and synthetic-provider conformance harness without Worker imports

### Acceptance criteria

- [ ] docs/connectors.md states the frozen contract, gap map, planned provider declarations and child slices, marked planned
- [ ] Offline checks reject widened hosts/scopes/paths, caller URLs, rule reads and unpriced or unreconcilable actions, and prove revoked/expired refusal, lost-response reconciliation without duplicate effect, consent binding and owner-request-only refusal from rule context
- [ ] Existing pure GitHub/Cloudflare recovery, vault and catalogue functions agree with the catalog
- [ ] WH-056 keeps its acceptance and depends on every child; no child reaches WH-031/032/036/049/096–100/104
- [ ] Open owner decisions are listed rather than assumed

### Verification

- node tests/connectors-contract.mjs
- node tools/roadmap.mjs validate, alignment and render --check
- git diff --check

### Dependencies and blockers

Planning dependencies: WH-004, WH-009, WH-052, WH-105, WH-116, WH-122. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/connectors.md](../../docs/connectors.md)
- [tools/prototypes/connectors.mjs](../../tools/prototypes/connectors.mjs)
- [tests/connectors-contract.mjs](../../tests/connectors-contract.mjs)
- [docs/integrations/github-connection.md](../../docs/integrations/github-connection.md)
- [docs/integrations/cloudflare-connection.md](../../docs/integrations/cloudflare-connection.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-141 — Shared connector catalog, typed request builder and operation admission in source

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

GitHub and Cloudflare transports can only send catalog-declared operations built from typed parameters, and provider identity, feature mapping and vault contexts derive from one server catalog.

### Scope

- TypeScript catalog and request builder matching the frozen v1 shapes; replace githubAccess.send free paths/caller-chosen operation and the Cloudflare path regex with operation IDs
- Derive ConnectionProvider, isConnectionProvider, connectionFeature and vault context patterns from the catalog; planned providers stay unconfigured and refused
- Record operation authority and readiness in the catalog; coordinate vault-context changes with the WH-117 key lifecycle

### Acceptance criteria

- [ ] No provider request can be built from a caller URL, host, path or undeclared query/body; existing GitHub/Cloudflare suites pass unchanged
- [ ] Planned providers cannot start OAuth, seal credentials or reach a transport
- [ ] No new scope, endpoint, binding or customer-visible behaviour

### Verification

- pnpm check
- pnpm test:github-connection
- pnpm test:github-backups
- pnpm test:cloudflare-connection
- node tests/connection-handoff.mjs
- node tests/connection-vault.mjs
- node tests/connectors-contract.mjs

### Dependencies and blockers

Planning dependencies: WH-140, WH-117. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/connectors.md](../../docs/connectors.md)
- [tools/prototypes/connectors.mjs](../../tools/prototypes/connectors.mjs)
- [tests/connectors-contract.mjs](../../tests/connectors-contract.mjs)
- [src/github-connection.ts](../../src/github-connection.ts)
- [src/cloudflare-connection.ts](../../src/cloudflare-connection.ts)
- [src/connection-vault.ts](../../src/connection-vault.ts)
- [src/feature-admission.ts](../../src/feature-admission.ts)
- [src/connection-handoff-shape.ts](../../src/connection-handoff-shape.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-142 — Adapt GitHub and Cloudflare handlers to the common connector contract

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The existing GitHub backup and Cloudflare DNS journeys satisfy the common contract and pass the shared conformance suite against their D1-backed handlers.

### Scope

- Bind the explicit plan-inclusion price into backup/DNS reviews and confirmations; expose a common receipt-state view over github_backups and cloudflare_dns_actions without rewriting their history
- Verify and register whether discovery metadata Chat replies re-enter later model context
- Extract runConformance into a test helper and run it against the real handlers with disposable D1 and synthetic providers

### Acceptance criteria

- [ ] Conformance passes for both existing providers; lost replies still never redispatch
- [ ] Explicit price, authority and receipt state appear in reviews and status without credentials
- [ ] WH-031/032 live acceptance remains separate

### Verification

- pnpm check
- pnpm test:github-connection
- pnpm test:github-backups
- pnpm test:cloudflare-connection
- node tests/connection-handoff.mjs
- node tests/chat-task-connection-status.mjs

### Dependencies and blockers

Planning dependencies: WH-141. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/connectors.md](../../docs/connectors.md)
- [tools/prototypes/connectors.mjs](../../tools/prototypes/connectors.mjs)
- [tests/connectors-contract.mjs](../../tests/connectors-contract.mjs)
- [src/github-backups.ts](../../src/github-backups.ts)
- [src/cloudflare-dns.ts](../../src/cloudflare-dns.ts)
- [src/connection-recovery.ts](../../src/connection-recovery.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-143 — Request-bound lookup consent and common minimized connector receipts

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Provider-selected content can be read only through an owner-confirmed, single-use, exact-query consent, and new connector actions record minimized durable receipts under admitted lifecycle classes.

### Scope

- Current-schema lookup-consent and connector-receipt tables with tenant, credential, digest and expiry guards; no data-preservation migration
- Admit connector-content (after the owner retention decision) and register connector-receipts with readers, retention, deletion and export policy
- Chat card bindings for lookup consent and action review via the WH-105 interaction contract; model-context destination gated on an approved non-training route record

### Acceptance criteria

- [ ] Consent is bound to owner, credential, operation, parameter digest and destination, single-use and voided by disconnect
- [ ] External results are marked untrusted and cannot confirm consent, reviews or tools
- [ ] Real connected content cannot reach the training-enabled test route
- [ ] Receipts hold digests and identifiers only

### Verification

- Synthetic SQLite and local D1 consent/receipt tests
- node tools/lifecycle-catalog.mjs and node tests/lifecycle-catalog.mjs
- node tests/connectors-contract.mjs

### Dependencies and blockers

Planning dependencies: WH-141, WH-009, WH-105, WH-116. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/connectors.md](../../docs/connectors.md)
- [tools/prototypes/connectors.mjs](../../tools/prototypes/connectors.mjs)
- [tests/connectors-contract.mjs](../../tests/connectors-contract.mjs)
- [docs/data-protection.md](../../docs/data-protection.md)
- [docs/data-lifecycle.json](../../docs/data-lifecycle.json)
- [docs/inference-privacy.md](../../docs/inference-privacy.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-144 — Single-flight refresh custody and honest revocation for refresh-token providers

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Refresh-token providers renew access only inside admitted operations with one fenced refresh per credential, and disconnect reports remote revocation honestly per provider capability.

### Scope

- Generalize encrypted refresh custody beyond GitHub with catalog-derived purpose contexts and rotation-safe atomic replacement
- Per-credential refresh claim, reauthorization-required state, lost-refresh retry with the same custody and no scope widening
- Revocation kinds rfc7009, refresh-token delete and local-only owner removal with existing lease/claim discipline

### Acceptance criteria

- [ ] Concurrent uses cause one token-endpoint call; invalid_grant requires reauthorization
- [ ] No background keep-alive refresh; credentials never leave the vault boundary
- [ ] Owner-removal providers never claim remote revocation

### Verification

- Synthetic provider refresh/revocation tests on SQLite and local D1
- node tests/connection-rotation.mjs
- node tests/connectors-contract.mjs

### Dependencies and blockers

Planning dependencies: WH-141, WH-117. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/connectors.md](../../docs/connectors.md)
- [tools/prototypes/connectors.mjs](../../tools/prototypes/connectors.mjs)
- [tests/connectors-contract.mjs](../../tests/connectors-contract.mjs)
- [docs/connection-key-lifecycle.md](../../docs/connection-key-lifecycle.md)
- [src/connection-rotation.ts](../../src/connection-rotation.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-145 — Approved deterministic-rule authority for rule-eligible connector actions

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A WH-052 deterministic-rule job can invoke only connector actions that declare approved-rule authority, within its exact approved destination, template and limits, and only on a live-accepted adapter.

### Scope

- Rule approval binding {operation, destination digest, body template digest, limit, credential} to a rule revision; admission and claim-time limit enforcement
- Refuse owner-request-only operations, reads and reconciliation from rule context; refuse visitor, runtime, webhook and maintainer contexts
- No owner-maintenance inference import or funding; WH-069 consumes this bridge for rule execution

### Acceptance criteria

- [ ] Owner-request-only operations are refused from rule context even when scopes permit
- [ ] Destination/template mismatch, exceeded limits and non-accepted adapters are refused before dispatch
- [ ] Runtime connector actions run with maintenance inference unavailable

### Verification

- Synthetic job-envelope plus connector tests on SQLite and local D1
- node tests/job-envelope-contract.mjs
- node tests/connectors-contract.mjs

### Dependencies and blockers

Planning dependencies: WH-143, WH-052. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/connectors.md](../../docs/connectors.md)
- [tools/prototypes/connectors.mjs](../../tools/prototypes/connectors.mjs)
- [tests/connectors-contract.mjs](../../tests/connectors-contract.mjs)
- [docs/job-envelope.md](../../docs/job-envelope.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-146 — Connected synthetic connector acceptance and privacy/rate-limit review

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The full owner lookup, consent, review, dispatch, lost-reply, reconcile, eligibility-loss and revocation journey passes on local D1 with synthetic providers, and privacy/deletion and rate limits are reviewed.

### Scope

- Connected local journeys for existing providers and one synthetic refresh-token provider through Chat cards and Settings
- Per-owner/provider request limits and provider 429 handling; privacy/deletion review of connector classes
- Record readiness as synthetic-conformant only; provider sandbox/customer acceptance stays in WH-031/032/096–100

### Acceptance criteria

- [ ] All conformance cases pass against implemented handlers on SQLite and local D1
- [ ] Rate limits and deletion/export behaviour are documented and tested
- [ ] No provider readiness above synthetic-conformant is claimed

### Verification

- Connected local D1 journey tests with synthetic providers
- Privacy/deletion and rate-limit review record

### Dependencies and blockers

Planning dependencies: WH-142, WH-143, WH-144, WH-145. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/connectors.md](../../docs/connectors.md)
- [tools/prototypes/connectors.mjs](../../tools/prototypes/connectors.mjs)
- [tests/connectors-contract.mjs](../../tests/connectors-contract.mjs)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/feature-admission.md](../../docs/feature-admission.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

# F4 — Measured expansion

Demand-led scale, search and advanced hosting beyond the accepted launch set; required collaboration and selected connectors belong to F3.

## WH-051 — Optimize measured storage, traffic and cache bottlenecks

Phase: **Measured expansion** (F4). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Performance improves without weakening current publication, privacy or revocation semantics.

### Scope

- Profile D1 query/write hot spots and per-page traffic writes
- Evaluate batching, retention/indexing and safe cache keys from measured evidence
- Assess tenant partitioning only when the shared control database is a demonstrated constraint

### Acceptance criteria

- [ ] Before/after benchmarks show lower latency/cost at equivalent correctness
- [ ] Private responses remain uncacheable and unpublish/safety revoke takes effect within the explicit tested bound
- [ ] Delayed analytics cannot block serving or corrupt billing
- [ ] Any new Cloudflare product has documented entitlement, minimum and usage cost

### Verification

- Targeted load regression plus publish/restore/unpublish and revocation suites
- Query plans and measured D1 operations
- No architecture migration solely because a product exists

### Dependencies and blockers

Planning dependencies: WH-037, WH-050, WH-022. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/site-health.md](../../docs/site-health.md)
- [docs/cloudflare-capability-roadmap.md](../../docs/cloudflare-capability-roadmap.md)
- [src/site-traffic.ts](../../src/site-traffic.ts)
- [src/site-host.ts](../../src/site-host.ts)
- [src/app-data.ts](../../src/app-data.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-039 — Expand bounded WordPress migration with redirects and source fidelity

Phase: **Measured expansion** (F4). Priority: **P2**. Planning readiness: **deferred**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Proven customer demand can justify repeatable bulk migrations beyond the accepted bounded article import.

### Scope

- Inventory real approved source formats, unsupported blocks, taxonomies/media and redirect requirements
- Add resumable batches with exact review and per-item receipts
- Provide migration diff/report and safe rerun/cancel

### Acceptance criteria

- [ ] Unsupported fields and lossy transforms are visible before confirmation
- [ ] No arbitrary source URL fetch or active imported HTML execution
- [ ] Interrupted batches resume without duplicate native articles/media
- [ ] Redirects preserve ownership, review and rollback

### Verification

- Existing WordPress source/runtime/taxonomy/media suites selected by changes
- Representative sanitized customer-export fixtures with consent
- CMS testing remains deferred until WH-038 unblocks

### Dependencies and blockers

Planning dependencies: WH-038, WH-040. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/emdash.md](../../docs/emdash.md)
- [src/cms-wordpress-sources.ts](../../src/cms-wordpress-sources.ts)
- [src/cms-wordpress-mapped-media.ts](../../src/cms-wordpress-mapped-media.ts)
- [src/cms-import-taxonomies.ts](../../src/cms-import-taxonomies.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-053 — Pilot approved-content search with optional customer-configured AI

Phase: **Measured expansion** (F4). Priority: **P2**. Planning readiness: **deferred**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Projects with measured search demand can use deterministic search; optional inference requires their explicitly configured runtime AI capability, independent of the Whumpo maintainer.

### Scope

- Evaluate AI Search versus explicit indexing/Vectorize against real retrieval requirements
- Bind tenant, published version and safety state to indexed documents
- Design removal, reindex, citation and query-budget behavior
- Choose deterministic indexed search by default; semantic/answer generation uses only an explicitly enabled customer-configured provider or exposed Cloudflare runtime route
- Deterministic search may proceed independently; an AI-enabled variant must be a separate reviewed child dependent on WH-079, never an implicit use of owner-maintenance inference

### Acceptance criteria

- [ ] No private draft, revoked artifact or other tenant document can be retrieved
- [ ] Prompt injection in retrieved content cannot authorize actions
- [ ] Search/index/inference charges and plan eligibility are reviewed
- [ ] Pilot has measurable answer/citation quality and a deletion SLA verified by tests
- [ ] Visitor search never invokes Whumpo maintenance inference or shares its credentials/context; disabled customer AI has no platform-model fallback

### Verification

- Cross-tenant retrieval, removal and unsafe-source fixtures
- Representative relevance/citation evaluation
- Live paid indexing only after product and cost approval

### Dependencies and blockers

Planning dependencies: WH-049, WH-017, WH-022. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/cloudflare-capability-roadmap.md](../../docs/cloudflare-capability-roadmap.md)
- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-055 — Evaluate advanced hosting only for validated unsupported workloads

Phase: **Measured expansion** (F4). Priority: **P2**. Planning readiness: **deferred**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A measured business case determines whether QuickJS needs an additional isolated hosting tier.

### Scope

- Evaluate existing configuration/shared modules first; justify any isolated custom or dedicated runtime by a specific unsupported execution, dependency, networking, capacity or isolation requirement
- Collect concrete unsupported customer workloads
- Compare bounded QuickJS, Workers for Platforms, Containers and Durable Objects against those workloads
- Specify secrets/network boundaries, review, metering, backup, abuse controls and minimum charges

### Acceptance criteria

- [ ] No automatic replacement of existing runtime
- [ ] Recurring/minimum/idle and supporting-service costs are included
- [ ] Decision has go/no-go criteria tied to demand, margin and operations
- [ ] No paid resource/customer code deployment during the ADR

### Verification

- Official current Cloudflare documentation and price/eligibility checks
- Synthetic compatibility prototypes only if approved budget permits
- Threat model for any newly proposed execution boundary

### Dependencies and blockers

Planning dependencies: WH-049, WH-050, WH-023. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/backend-execution.md](../../docs/backend-execution.md)
- [docs/cloudflare-capability-roadmap.md](../../docs/cloudflare-capability-roadmap.md)
- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [src/runtime/worker.ts](../../src/runtime/worker.ts)
- [docs/workload-placement.md](../../docs/workload-placement.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-060 — Keep advanced Cloudflare capabilities in a demand-gated portfolio

Phase: **Measured expansion** (F4). Priority: **P2**. Planning readiness: **deferred**. Kind: decision. Size: S.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The broad Cloudflare catalog remains a research inventory instead of an implicit commitment to build every product.

### Scope

- Review demand for video/realtime, private networking, BYO databases, advanced security and analytics
- Require one-page outcome/architecture/cost/operations case per promoted candidate
- Clarify ambiguous product names before proposing delivery

### Acceptance criteria

- [ ] Each promoted candidate has customer evidence, dependencies, entitlement, current pricing and explicit scope
- [ ] Stream/Containers/enterprise services never inherit authorization from Workers Paid
- [ ] No cloud console clone or unrequested paid service is built
- [ ] Deferred capabilities have revisit triggers, not invented launch dates

### Verification

- Current official Cloudflare documentation for any promoted service
- Roadmap dependency and cost review
- No provisioning or purchase in portfolio review

### Dependencies and blockers

Planning dependencies: WH-049. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/cloudflare-capability-roadmap.md](../../docs/cloudflare-capability-roadmap.md)
- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [AGENTS.md](../../AGENTS.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-062 — Evaluate bounded multi-agent execution for owner maintenance only

Phase: **Measured expansion** (F4). Priority: **P2**. Planning readiness: **deferred**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Parallel maintainer roles may improve explicitly authorized owner maintenance within one authority and cost envelope; customer website/service execution remains independent.

### Scope

- Compare a single bounded agent with planner/builder/evaluator roles on the same synthetic task corpus
- Specify parent/child receipts, shared reservations, cancellation, context minimization and maximum concurrency
- Retain server-only action confirmation and human publication/spending reviews

### Acceptance criteria

- [ ] Every child call rolls up to one task budget and preserves standard versus premium funding
- [ ] Failed/cancelled children cannot orphan dispatch or mutate after withdrawal
- [ ] Customer source and credentials are not broadened across roles without necessity
- [ ] Measured completion quality, latency and total cost justify a go/no-go decision; no automatic paid fan-out
- [ ] No visitor event, schedule or customer service workflow invokes these maintainer roles; optional runtime AI is a separate customer-controlled capability

### Verification

- Offline orchestration/failure/concurrency prototype
- Approved bounded model evaluation only with exact spending scope
- Review injection and cross-role authority propagation

### Dependencies and blockers

Planning dependencies: WH-021, WH-044, WH-058. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/workspace-agent.md](../../docs/workspace-agent.md)
- [src/gateway-spend.ts](../../src/gateway-spend.ts)
- [src/ai-chat.ts](../../src/ai-chat.ts)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-118 — Evaluate passkey-backed encryption compatibility and usability

Phase: **Measured expansion** (F4). Priority: **P2**. Planning readiness: **planned**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A bounded feasibility result establishes whether selected client-side encryption can meet Whumpo usability, processing and recovery requirements before any adoption packet.

### Scope

- Evaluate current WebAuthn PRF support across supported browsers/devices/passkey providers and native/browser handoffs using isolated synthetic data
- Prototype random content-key wrapping per authorized passkey and normal-sign-in unlock; keep client-only PRF results and content keys out of authentication payloads sent to the server
- Exercise second-key enrollment, provider sync/restore, lost-all-keys content recovery, revocation/rotation, export and account closure separately from account recovery
- Measure extra prompts/time/failure/abandonment and identify affected AI/safety/search/publication/background features; include client and previously disclosed-data limitations
- Record adoption/no-adoption criteria and evidence; specify a separate implementation packet only if viable, otherwise retain transparent protections without weakening claims

### Acceptance criteria

- [ ] Device/provider capabilities and dated official sources are recorded; normal passkey authentication is never assumed to provide a PRF or content-encryption key
- [ ] Any adoption recommendation demonstrates compatible normal-sign-in unlock, reliable additional-key access and independent content recovery with no recurring unlock burden
- [ ] Server-only account recovery cannot silently decrypt client-only content; unsupported or missing-key scenarios are honest and have no plaintext fallback
- [ ] A provider/key-loss recovery drill and readable-processing boundary report use only synthetic data; physical-device gaps remain open
- [ ] WH-048/049 and ordinary account access do not depend on PRF feasibility; no mandatory vault, new paid service or production encryption behavior activates under this decision task

### Verification

- Run an isolated synthetic PRF/key-wrapping proof and inspect authentication serialization for secret exclusion
- Record supported real browser/device/provider enrollment and recovery evidence with approved disposable identities; emulate only where labeled
- Review friction measurements and negative recovery cases against WH-115/116, then validate roadmap and contract updates

### Dependencies and blockers

Planning dependencies: WH-115, WH-116. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/owner-recovery.md](../../docs/owner-recovery.md)
- [docs/android-app.md](../../docs/android-app.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [src/workspace-identity/ceremonies.ts](../../src/workspace-identity/ceremonies.ts)
- [frontend/src/identity/flow.tsx](../../frontend/src/identity/flow.tsx)
- [docs/workspace-identity.md](../../docs/workspace-identity.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

# F5 — Configuration and shared capabilities

Configure and compose maintained modules first; generate only missing custom behavior; preserve isolated customer data and execution with workload-appropriate infrastructure. Whumpo AI maintains projects and chats with owners only.

## WH-064 — Define versioned project specifications and supported change operations

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **ready**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Owner requests become validated changes to a project specification before any custom-code or infrastructure proposal.

### Scope

- Inventory existing site components, app/page/data contracts and reusable helpers before designing the shared schema
- Define pages, design, content references, feature/module versions, data schemas, project permissions, integrations and deterministic workflow rules
- Specify operation schemas and exact input/output/error contracts for propose, validate, preview, apply and version
- Record the owner-facing maintainer boundary and a narrow initial content/forms/files/access/notification capability set

### Acceptance criteria

- [ ] Unknown fields, unsupported module versions and incompatible permission/schema combinations fail closed
- [ ] Tenant/project scope comes from verified authorization, never model-provided ownership fields
- [ ] An operation records expected revision, immutable diff, preview and acceptance evidence; permission/publication/spending changes retain their exact approval gates
- [ ] Business hours, a supported vehicle field, notification rule and staff-only upload policy can be expressed without generating a new application stack
- [ ] No operation wires Whumpo maintenance inference into visitors, customer service jobs or website traffic

### Verification

- Schema and operation examples validated against existing contracts using benign fixtures
- Review detailing-site change table with compatibility, stale-revision and unauthorized-policy cases
- Decision artifact only; no module, database or AI provider is provisioned

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/shared-components.md](../../docs/shared-components.md)
- [docs/app-data.md](../../docs/app-data.md)
- [docs/workspace-agent.md](../../docs/workspace-agent.md)
- [src/components.ts](../../src/components.ts)
- [src/site-agent.ts](../../src/site-agent.ts)
- [src/ai-chat.ts](../../src/ai-chat.ts)
- [docs/project-specification.md](../../docs/project-specification.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/12. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 alignment: live GitHub completion evidence re-read. Decision contract completed in d27b46a, issue #12; closed-schema/offline operation evidence only. Reuse it; service delivery remains separate.

## WH-065 — Build a versioned capability catalog and composition planner

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The maintainer discovers supported modules and proposes the smallest configuration or composition change before custom generation.

### Scope

- Publish module interfaces, supported operations, permissions, dependencies, compatibility and cost characteristics
- Retrieve only the relevant catalog/contract subset for the owner request
- Extend current site/backend library inspection and application handoff instead of creating a parallel lifecycle
- Require a recorded missing capability and bounded extension scope before custom code

### Acceptance criteria

- [ ] Catalog lookup never exposes another customer source, configuration, files or credentials
- [ ] Planner prefers supported content/config/schema/policy operations and deterministic diagnostics
- [ ] Unknown capabilities do not become invented configuration fields or silent framework migrations
- [ ] Representative supported requests produce no new backend source or infrastructure plan
- [ ] Owner maintenance model cannot be invoked through a visitor or deterministic automation action

### Verification

- Offline planner fixtures covering configuration, composition, unsupported behavior and custom escape hatch
- Existing library/agent inspection and application journey suites where modified
- Measure retrieved context and generated source without paid model tests by default

### Dependencies and blockers

Planning dependencies: WH-064. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/shared-components.md](../../docs/shared-components.md)
- [docs/backend-execution.md](../../docs/backend-execution.md)
- [src/backend-library.ts](../../src/backend-library.ts)
- [src/site-agent.ts](../../src/site-agent.ts)
- [src/agent-inspection.ts](../../src/agent-inspection.ts)
- [src/ai-chat.ts](../../src/ai-chat.ts)
- [docs/capability-planner.md](../../docs/capability-planner.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/13. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 alignment: live GitHub completion evidence re-read. Catalog/planner implementation completed in b457f6b and issue #13 with local and deployed readback evidence. General service modules remain WH-067–069.

## WH-066 — Compile specification changes into deterministic previews and releases

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The same validated specification and pinned module/compiler versions reproduce exact artifacts and recoverable project versions.

### Scope

- Implement schema validation and deterministic render/compiler adapters for the initial supported presentation/forms/API clients
- Connect proposal diff, permission/compatibility checks, isolated preview, explicit apply and immutable version recording
- Reuse existing publication/export/restore receipts and expected-revision guards
- Create only current-version project specifications; retire obsolete test fixtures and readers

### Acceptance criteria

- [ ] Identical supported inputs and pinned versions yield byte-identical outputs/digests without model generation
- [ ] Stale/concurrent changes cannot partially apply incompatible config/content/data references
- [ ] Visibility, permission expansion, publication and destructive/data migration changes keep relevant reviews and safety gates
- [ ] Content restoration uses a recorded specification admitted by the current schema/compiler, and rechecks current safety/deletion rules; unsupported historical formats require reset rather than a legacy reader
- [ ] Configuration-only changes require focused deterministic checks and do not trigger an open-ended coding session

### Verification

- Reproducibility/digest and migration-compatibility fixtures
- Existing preview/publication/version/export concurrency and lost-response tests
- Connected loopback spec change, preview, apply, restore with zero compiler model calls

### Dependencies and blockers

Planning dependencies: WH-064, WH-065. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/mvp.md](../../docs/mvp.md)
- [docs/version-retention.md](../../docs/version-retention.md)
- [docs/version-comparisons.md](../../docs/version-comparisons.md)
- [src/components.ts](../../src/components.ts)
- [src/publications.ts](../../src/publications.ts)
- [docs/releases.md](../../docs/releases.md)
- [docs/project-service-clients.md](../../docs/project-service-clients.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/14. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-09-30 issue readback for the tier extension: parent #14 remains open; #15 compiler/schema and #16 durable private proposal/apply/restore are closed with recorded source and synthetic acceptance. Forms/API child #17 remains open; content-only compilation is not complete WH-066/067 delivery. Source at review: 628c16f. This roadmap update does not verify a deployment.
- 2026-10-01 alignment: live GitHub completion evidence re-read. Initial supported compiler scope completed through #15/#16/#17 and merged PR #18 (0002632). Content, fixed contact intake and reviewed stateless clients have deterministic/private apply/restore and scoped connected evidence. General records/access/files and notification/rule services remain WH-067–069.

## WH-067 — Expose shared content, forms, records, files and access modules

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Composed interfaces and custom frontends reuse the same maintained tenant-scoped standard APIs.

### Scope

- Define stable API/schema boundaries for content, form validation/submissions/record views, scoped files/galleries and project users/roles
- Adapt existing contact/directory/visitor-data/photo services instead of generating new auth/storage/CRUD implementations
- Keep module organization independent of deployment count; several modules can share the current backend
- Evaluate proven libraries or managed services before building complex identity/payment engines
- Consume WH-071 logical storage/runtime interfaces and WH-116 data classification; freeze module instance/config/version and migration hooks before tables or client APIs. Add services to the delivered WH-066 compiler/catalog instead of replacing its supported adapters.
- Keep customer-application visitor/staff roles distinct from Whumpo workspace membership in WH-054. A staff upload rule does not grant owner Chat/admin access or require creating a parallel workspace authentication system.
- Use WH-090 for owner feature admission/configuration and WH-105 for registered owner-facing bindings from the first module. Visitor/staff authorization remains the separate application policy; ordinary published serving does not become a workspace-subscription check or silently stop on plan loss.

### Acceptance criteria

- [ ] Authenticated scope and field/record/file permissions are enforced inside every API, including direct/custom frontend use
- [ ] Standard form/gallery/record actions execute deterministically with zero maintainer inference
- [ ] Staff-only upload access is a project role policy, not a filename prefix or public bucket
- [ ] Shared APIs do not bypass media quarantine, exact publication reviews or restricted preservation
- [ ] Initial delivery is split into coherent API slices; no universal no-code engine or unsupported booking promise is implied

### Verification

- Cross-tenant/user/role/direct-API fixtures with replay and revocation
- Existing contact/directory/photo/app lifecycle suites relevant to each slice
- Two different frontend compositions share one API contract without custom auth/handlers

### Dependencies and blockers

Planning dependencies: WH-065, WH-066, WH-009, WH-010, WH-071, WH-116, WH-122, WH-105, WH-123, WH-124, WH-125, WH-126, WH-127, WH-128, WH-129, WH-130. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [docs/directories.md](../../docs/directories.md)
- [docs/photos.md](../../docs/photos.md)
- [docs/app-data.md](../../docs/app-data.md)
- [src/contacts.ts](../../src/contacts.ts)
- [src/app-gateway.ts](../../src/app-gateway.ts)
- [src/photo-safety.ts](../../src/photo-safety.ts)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/workload-placement.md](../../docs/workload-placement.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)
- [docs/shared-modules.md](../../docs/shared-modules.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/107. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.
- 2026-10-04 UTC: decomposed into WH-123–130 with the planned contract in docs/shared-modules.md. Planning only: no module table, API, binding or deployment exists; the parent acceptance is unchanged and closes only after every child.
- 2026-10-04 UTC status note (WH-130): not complete and not accepted. Local synthetic evidence covers the delivered operations for each criterion; it is mapped in docs/shared-modules.md#wh-067-acceptance-map--october-4-2026-utc and comes from tests/shared-modules-compositions.mjs plus the registry/access/records/files/collections suites, SQLite and local D1/R2. Open before acceptance: the owner-run empty-D1 cutover and release of PR #160; the WH-126 identity ownership cutover (staff still needs an enabled visitor application); the WH-127 records export serializer and hooks, form attachments, TURNSTILE_SECRET on whumpo-apps and publication-revision binding of public forms; the WH-128 owner photo collection, owner module uploads, published galleries and files export; restricted preservation LC-06; an owner-reachable authoring path (the site agent prompt deliberately advertises no module operation, and capability entries are still planned); and a served composition (WH-070) with browser evidence. Live, browser and device acceptance has not been attempted.
- 2026-10-04 UTC status note (WH-126 identity cutover): module visitor and staff principals now belong to the access instance with no visitor application in any module suite; the acceptance map in docs/shared-modules.md is updated. WH-067 stays open and not accepted (see the remaining gaps there, including the owner path to save an access instance).

## WH-071 — Specify workload placement and bounded custom execution paths

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **ready**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Placement favors static assets and shared maintained APIs, with isolated on-demand custom logic and persistent resources only for measured workload needs.

### Scope

- Define static/shared API/custom isolated function/persistent process admission classes and reviewed placement criteria
- Keep existing QuickJS for supported custom logic; evaluate Workers for Platforms for workloads needing a broader execution boundary
- Plan project route bundling rather than one script per tiny feature
- Compare Containers/VMs for actual sustained/native workloads including supporting services and minimum costs
- Freeze logical project/resource IDs, scoped storage/runtime adapters, schema/version and migration/export hooks before WH-067; current shared D1 and QuickJS remain the initial implementations.
- Freeze minimum module lifecycle/export descriptors now: logical IDs, exact schema/module version, owned data/asset references, export eligibility, dependency manifest and exact current-schema restore and reviewed placement hooks. WH-067 supplies adapters with its first schema; WH-077 later verifies a runnable portable subset, without redesigning storage around an export format after launch.

### Acceptance criteria

- [ ] Customer-controlled code never runs in the privileged shared platform process or receives cross-tenant connections
- [ ] Separate tenant data/execution remains mandatory even when capacity is pooled
- [ ] Static sites need no project database/always-on process by default
- [ ] WfP, container or VM selection requires current account entitlement, full cost model, threat/lifecycle review and explicit activation
- [ ] Whumpo owner maintenance inference is not part of any visitor placement path
- [ ] WH-050/022 measurements inform later physical-placement decisions and activation; they do not block this interface contract or justify a provider purchase. WH-072 changes adapters behind the same contract, not every module or client.

### Verification

- Official provider pricing/limit review at execution date
- Synthetic workload/placement compatibility and rejection table
- No resource provisioning, guest deployment or automatic platform migration in this decision task

### Dependencies and blockers

Planning dependencies: WH-064, WH-009. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/backend-execution.md](../../docs/backend-execution.md)
- [docs/cloudflare-capability-roadmap.md](../../docs/cloudflare-capability-roadmap.md)
- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [src/runtime/worker.ts](../../src/runtime/worker.ts)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/workload-placement.md](../../docs/workload-placement.md)
- [tools/prototypes/workload-placement.mjs](../../tools/prototypes/workload-placement.mjs)
- [tests/workload-placement-prototype.mjs](../../tests/workload-placement-prototype.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/47. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 WH-071 decision/source evidence against d9f5d26: docs/workload-placement.md freezes logical project/resource and exact module/schema identities, scoped adapter obligations, lifecycle/export descriptors and fenced migration handoff. Offline reference and 60 synthetic checks verify compatibility/rejections and marginal container examples; current official provider prices/limits reviewed. Existing shared D1/private R2/QuickJS remain. No production imports, runtime/config/schema changes, provider activation, customer migration or export acceptance. Execution/completion evidence belongs in issue #47.
- 2026-10-01 WH-120 amendment: offline descriptors remove read/restore compatibility lists; retired fields and mismatched schema versions/digests reject. docs/workload-placement.md removes the proposed legacy placement adapter and specifies forward repair/current-schema restoration. All 60 offline checks pass; no production consumer, provider call, deployment or CMS functional test.

## WH-073 — Serve published content and standard actions without maintenance inference

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Published sites and deterministic customer services remain functional while Whumpo owner AI is unavailable.

### Scope

- Pre-render supported public content on approved changes and serve immutable assets repeatedly
- Use shared APIs only for real dynamic reads/writes; ordinary menus/forms/galleries/availability rules use no model
- Choose delivery/cache invalidation that preserves current unpublish, permission and safety-revocation behavior
- Measure direct-asset versus Worker-routed requests accurately

### Acceptance criteria

- [ ] Visitor/service route inventories and transport stubs prove zero Whumpo maintainer model dispatch
- [ ] Maintenance model outage or exhausted owner premium balance does not break published standard services
- [ ] No serving optimization makes pending/private/revoked content publicly cacheable
- [ ] A routing/auth Worker is counted as execution; direct static-asset allowances are not applied to dynamic traffic
- [ ] Model-required customer extensions are separately configured under WH-079 and never fall back to Whumpo AI

### Verification

- Connected visitor/site journeys with maintainer transport unavailable and dispatch count asserted zero
- Publish/restore/unpublish, permission-change and scanner-revocation cache tests
- Measured request path and cold/warm cost evidence before delivery changes

### Dependencies and blockers

Planning dependencies: WH-066, WH-067, WH-071. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/mvp.md](../../docs/mvp.md)
- [docs/site-health.md](../../docs/site-health.md)
- [docs/content-safety.md](../../docs/content-safety.md)
- [src/site-host.ts](../../src/site-host.ts)
- [src/app-host.ts](../../src/app-host.ts)
- [src/app-gateway.ts](../../src/app-gateway.ts)
- [docs/workload-placement.md](../../docs/workload-placement.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-08 UTC: verification slice only; local synthetic evidence, not deployed, not live-accepted; no Worker, schema, cache or delivery change; WH-073 stays open. tests/standard-service-no-maintainer.mjs (SQLite and --d1 on local D1; in the site verify profile) proves that src/site-host.ts, app-host.ts, app-gateway.ts, runtime/worker.ts and contact-page.ts reach no owner-maintenance inference module (src/index.ts is the positive control), and that the published site, directory, CMS, asset, guest-preview, visitor-app, contact form/submission, unpublish and safety-hold routes plus all three cron schedules record zero network calls, inference_calls, gateway_spend_attempts, standard-AI and gateway requests and Chat turns, with no cacheable response, both with no AI configuration and with a provider answering 503. The same route inventory and crons also run with the owners' funding exhausted in the durable rows (the standard usage allowance, inference_budgets, spent to its ceiling; and premium credit, premium approval and task, account and platform operator gateway buckets all spent to their limits), still with zero network calls and inference rows, every seeded budget/bucket/attempt row unchanged (no new attempt, reservation, dispatch or balance movement); the same rows refuse owner maintenance admission (inference_budget trigger, gateway reservation 409) while funded controls are admitted. Six mutations (inference import, provider fetch, public cache header, spend row) plus four funding mutations (a reservation import in the site root, a site-root check refusing on an exhausted allowance, a site-root write to a premium bucket, a site-root write to the usage allowance) each failed the test. Not proven: cache/pre-render/direct-asset delivery and revocation cache tests, request-path cost measurement, purchased credits or a real provider outage, WH-079 extensions, runtime Worker execution and live behavior. See docs/workload-placement.md.

## WH-075 — Bound shared capacity and separate interactive from batch failures

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Pooling reduces idle work without allowing one project or job class to exhaust another project service.

### Scope

- Carry server-verified project/actor/purpose scope into jobs, cached results and provider adapters
- Enforce per-project and platform concurrency, queue length, database work, upload/transform bytes, custom CPU/memory and spend bounds
- Reserve interactive capacity separately from scans/imports/builds; plan bounded failure groups as observed load grows
- Support reviewed selective dedicated isolation only when performance/containment evidence warrants it
- Consume WH-090 current operation eligibility and WH-116 data/cache protection requirements before pooling. Capacity admission cannot bypass actor revocation or convert standard owner assistance into customer-credit usage.

### Acceptance criteria

- [ ] Forged tenant arguments/headers and copied job IDs cannot cross records, files, caches or outputs
- [ ] Permission-sensitive cache entries key/invalidate by tenant and required actor/authorization revision
- [ ] Load tests demonstrate bounded noisy-neighbor impact and recoverable backpressure, with no silent data loss
- [ ] Quotas do not silently meter standard owner AI or automatically upgrade a plan
- [ ] Unknown cost and pooled fixed overhead remain visible in internal accounting

### Verification

- Cross-tenant job/cache/file/result access fixtures
- Interactive-versus-batch saturation and recovery tests using bounded local workloads
- Re-run the WH-050 envelope for newly introduced bottlenecks

### Dependencies and blockers

Planning dependencies: WH-065, WH-050, WH-052, WH-113, WH-122, WH-116. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/security-risk-actions.md](../../docs/security-risk-actions.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [docs/app-data.md](../../docs/app-data.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/workload-placement.md](../../docs/workload-placement.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/128. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.

## WH-078 — Measure composition reuse and full lifecycle cost per outcome

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Architecture choices are judged by successful owner changes and active-project operating cost instead of token prices alone.

### Scope

- Classify configuration, composition, custom-component, custom-backend and dedicated-runtime outcomes
- Track custom-code fallback reason and repeated missing capability with necessary metadata only
- Measure AI, build/test, runtime, database, storage, external services, retries, support and module maintenance separately
- Evaluate shared-module break-even and recurring active-project cost without claiming an unmeasured savings percentage

### Acceptance criteria

- [ ] No prompt/source/visitor content is copied into analytics
- [ ] Internal category/event attribution prevents double counting even if a later customer balance combines eligible usage
- [ ] Standard owner AI remains non-billable under existing policy; optional visitor AI has its own explicit funding and caps
- [ ] Reporting separates observed cost, estimates, unknown dimensions and fixed pooled overhead
- [ ] Savings comparisons use equivalent successful outcomes, quality and maintenance scope; no automatic upgrades or implicit budget expansion

### Verification

- Synthetic cost-event duplication, category reconciliation and fallback classification fixtures
- Representative composition-versus-custom benchmark using existing WH-020 corpus
- Record sample size, versions, quality and uncertainty; paid evaluation only within approved scope

### Dependencies and blockers

Planning dependencies: WH-065, WH-066, WH-022. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [docs/company-finance-review.md](../../docs/company-finance-review.md)
- [docs/standard-ai-accounting.md](../../docs/standard-ai-accounting.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-080 — Accept a specification-composed business-site and portal pilot

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A representative customer outcome proves reuse, visual flexibility and independent deterministic visitor operation.

### Scope

- Use a mobile-detailing site with service packages, appointment requests, approved photo intake, staff-only access and confirmation emails
- Demonstrate changes to business hours, vehicle field, notification rule, staff file policy and premium visual composition
- Reuse maintained modules; an appointment request is not a promise of a full booking/calendar engine
- Exercise preview/review/version/restore and measured maintenance/serving cost on disposable synthetic projects

### Acceptance criteria

- [ ] First four changes alter supported records/specification/policy without bespoke generated backend/auth/upload/email stacks
- [ ] Visitor submission, file access and confirmation flow use zero Whumpo maintainer model calls and remain functional during its outage
- [ ] Two differently styled synthetic customers have isolated records/files/jobs and reuse the same maintained API implementations
- [ ] Custom visual work is bounded to the missing component; module/version provenance and fallback reason are recorded
- [ ] Media safety, real sender/provider, devices, live customer publication and payments remain their separate activation/acceptance gates
- [ ] This packet accepts the local synthetic composition pilot only; any live pilot requires WH-017 safety acceptance plus separately reviewed media/provider/device/customer-publication scope

### Verification

- Connected loopback two-tenant pilot with maintainer transport disabled for visitor flows
- Replay/stale permission/notification timeout/quarantine/version-restore checks
- Cost and fallback report with synthetic versus live evidence labels

### Dependencies and blockers

Planning dependencies: WH-066, WH-067, WH-068, WH-069, WH-070, WH-073, WH-075, WH-078. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [docs/photos.md](../../docs/photos.md)
- [docs/shared-components.md](../../docs/shared-components.md)
- [docs/app-data.md](../../docs/app-data.md)
- [docs/roadmap/README.md](../../docs/roadmap/README.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-123 — Freeze the shared module contract and decompose WH-067

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **ready**. Kind: decision. Size: S.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Every WH-067 slice builds against one frozen module identity, instance/configuration/version shape, API envelope and authorization model instead of inventing its own.

### Scope

- Freeze module kinds/pins, the instance envelope, kind configurations, configRevision and current-only migration hook classes on top of the WH-071 descriptor
- Freeze the request envelope, closed operation set, principals, policy table, revocation behavior and host boundaries for content collections, records/forms, files/galleries and access
- Map contact, directory, photos and visitor identity/data onto modules with explicit gaps; record WH-090/122 admission, WH-105 binding and WH-066 catalog registration points
- Evaluate proven libraries/managed services with dated sources; add an offline shape/policy reference and checks without Worker imports

### Acceptance criteria

- [ ] docs/shared-modules.md states the frozen shapes, authorization rules, safety/publication/preservation boundaries and existing-service mapping, marked planned
- [ ] Offline checks reject unknown/stale versions, caller-supplied authority, prefix/public-bucket authorization, workspace-membership principals and over-wide views/galleries
- [ ] WH-067 keeps its acceptance and depends on every child; no child reaches WH-070/072/077/080/104
- [ ] Open owner decisions are listed rather than assumed

### Verification

- node tests/shared-modules-contract.mjs
- node tools/roadmap.mjs validate, alignment and render --check
- git diff --check

### Dependencies and blockers

Planning dependencies: WH-065, WH-066, WH-071, WH-105, WH-116, WH-122. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/shared-modules.md](../../docs/shared-modules.md)
- [tools/prototypes/shared-modules.mjs](../../tools/prototypes/shared-modules.mjs)
- [tests/shared-modules-contract.mjs](../../tests/shared-modules-contract.mjs)
- [docs/workload-placement.md](../../docs/workload-placement.md)
- [docs/project-specification.md](../../docs/project-specification.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC: contract and offline reference only, no implementation. Merged PR #108 (2fbfd6c) added docs/shared-modules.md (marked planned: module kinds/pins, instance envelope v1, kind configurations, configRevision, none/additive-optional/migration-required hook classes on the WH-071 descriptor; whumpo-modules request envelope v1, closed operation set, derived principals, policy table, revocation and visitor/workspace host boundaries; contact/directory/photos/visitor identity mapping with gaps; WH-090/122 admission, WH-105 binding and WH-066 catalog registration points; dated library/managed-service evaluation), tools/prototypes/shared-modules.mjs (imports only node:crypto and the offline WH-071 prototype) and tests/shared-modules-contract.mjs, and decomposed WH-067 into WH-123–130. Re-run at ff3d410: node tests/shared-modules-contract.mjs passed 75 offline checks with synthetic identifiers; this proves frozen examples only, not runtime authorization, persistence, safety or acceptance. Both open owner decisions (records retention, visitor values in Chat) were decided by the owner on #107 and are recorded in the contract. WH-067 depends on every child WH-123–130 and no child reaches WH-070/072/077/080/104. No table, route, binding, provider, Cloudflare resource or deployment is added by WH-123; WH-124 (#157) separately implemented schema 3 in source. Live GitHub issue state was not re-read from this session.

## WH-124 — Cut over to specification schema 3 with module pins and data classes

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Owners can describe records, forms, files and staff access in the saved specification using the frozen module configuration, without anything serving yet.

### Scope

- Replace schema 2 library-only records/forms/files/access sections with the frozen schema 3 configuration and exact module pins; pin a new compiler identity and remove the schema 2 reader
- Reset obsolete schema 2 test specifications at a coordinated empty-database cutover; no conversion or old reader
- Add trusted module catalog entries (available/withdrawn) beside the compiler and service-client catalogs; keep unimplemented kinds unsupported in the capability catalog
- Register module-records, module-files and project-roles lifecycle classes with readers, processing, retention and export policy before any table
- Keep the mounted single-homepage adapter, content@2 and page components unchanged

### Acceptance criteria

- [ ] Schema 3 rejects PNG, >1 MiB collections, public read audiences, unknown roles, over-wide views and missing access dependencies; staff upload and staff write are expressible
- [ ] Permission widening classifies a permissions review; required/rename/type changes return MIGRATION_REQUIRED; optional field additions are additive-optional
- [ ] Compiler pin drift, stale constants and schema 2 input reject; existing homepage creation/change/restore journeys still pass
- [ ] Lifecycle catalogue validation passes with the new planned classes; no runtime table is admitted

### Verification

- node tools/check-specification-compiler.mjs --check and node tests/specification-compiler.mjs
- node tests/current-website-specifications.mjs and node tests/specification-journey.mjs on disposable D1
- node tools/lifecycle-catalog.mjs checks and tsc for both projects

### Dependencies and blockers

Planning dependencies: WH-123, WH-009. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/shared-modules.md](../../docs/shared-modules.md)
- [docs/project-specification.md](../../docs/project-specification.md)
- [docs/project-specification-compiler.md](../../docs/project-specification-compiler.md)
- [src/project-specification/v3/schema.ts](../../src/project-specification/v3/schema.ts)
- [docs/data-lifecycle.json](../../docs/data-lifecycle.json)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/157. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-125 — Add the module instance registry, activation reviews and shared policy engine

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Approved module configuration becomes a scoped, activatable instance whose every API call passes one shared resolver and policy decision.

### Scope

- Current-schema instance and activation tables binding descriptor, configuration digest, configRevision and source specification version
- Exact owner activation/disable reviews with recent authentication, consuming WH-122 inclusion (core.forms/core.editing) and current identity in the committing statement
- Server-side resolveResource and policy decision composed into commit SQL; request envelope, idempotent receipts, typed errors and client_update_required
- Register module.instances@1 and moduleActivationApply under WH-105; keep visitor-submitted values out of Chat and model context
- Static import/fixture check that module handlers never reach owner-maintenance inference

### Acceptance criteria

- [ ] Foreign, stale configRevision, withdrawn pin, inactive instance and changed-input replay fail with the frozen typed errors inside every handler
- [ ] Plan loss blocks new activation/widening but keeps owner read/export/disable and published serving
- [ ] Lost acknowledgements read back existing receipts; concurrent activation/disable has one winner
- [ ] Module paths pass with maintenance inference unavailable

### Verification

- Disposable SQLite/local D1 suite over actual handlers with two owners/projects, revocation and replay
- node tests/feature-admission.mjs and chat interaction suites remain green
- tsc for both projects

### Dependencies and blockers

Planning dependencies: WH-124. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/shared-modules.md](../../docs/shared-modules.md)
- [docs/workload-placement.md](../../docs/workload-placement.md)
- [docs/feature-admission.md](../../docs/feature-admission.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)
- [src/project-specification/service-clients/activation.ts](../../src/project-specification/service-clients/activation.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC: source and local verification only; not deployed, not accepted, issue not created or claimed from this session. Branch c/great-curie-8ryukc (PR #160) adds the current schema input src/shared-modules/schema.sql (module_instances, module_activations, module_activation_reviews/links/applies, module_request_receipts; lifecycle class module-registry) with commit triggers, src/shared-modules/{policy,registry,activation,api,bindings,shape}.ts (whumpo-modules v1 envelope with client_update_required and typed ModuleError codes; resolveResource and decideModule; exact owner activation/disable reviews via moduleActivationReview/moduleActivationApply ChatControls with recent passkey sign-in, core.forms/core.editing prepare check and confirm inclusion composed into the applied-receipt insert; idempotent request receipts), module.instances@1 as the feature-null modules view with an owner card, and the apply button in Chat. No kind data handler, visitor-origin route or visitor session binding is delivered (moduleHandlers is empty; visitor principals cannot commit until WH-126). The content compiler still refuses instance-bearing specifications (UNAVAILABLE_CAPABILITY); lifting it is a separate compiler identity cutover, so the registry is reachable only from fixtures that rewrite the saved head in a disposable database. Local checks: node tests/shared-modules-registry.mjs passed 11 groups on SQLite and with --d1 on local D1 (two owners/projects, Starter, revocation, stale proof, replay, concurrent winners, lost-ack readback, withdrawn/stale catalog variants, plan loss, commit-time races, closure/cascades, static no-inference check); feature-admission, 14 offline chat-interaction suites, guest-preview, site-diagnostics, workspace-view, lifecycle, closure, release-manifest, restore-admission, pnpm check, verify fast and protection passed. The schema change requires the owner-run empty-database cutover (pnpm run deploy prepare/apply with schemaChange initialize); deploy ci refuses it and the PR must not merge without the owner.
- 2026-10-04 UTC: project-content@4 compiler identity cutover (owner decision 2026-10-04: lift the compiler gate first). Source and local verification only; not deployed, not accepted. Branch c/great-curie-8ryukc (PR #160) replaces project-content@3 with project-content@4 (lock compiler-locks/project-content-v4.json generated by tools/check-specification-compiler.mjs --init after the v3 lock was removed; module/schema pin digests unchanged; no @3 reader; @3 locks refused by the compiler, the serving check and SQL admission in schema/platform.sql). The content compiler now admits pinned instances as saved, inactive configuration (no artifact; notifications/automation, rules and staff pages stay refused). Owners save instance-bearing specifications through the existing exact review: one comparison row per changed instance, classified review classes (schema/permissions/integration/spending) bound in the proposal envelope and named in the reply, recent-sign-in specificationApply. Restore is classified against the current head (instance or field removal refused with MIGRATION_REQUIRED). Saving activates nothing; the site agent prompt and read inspection are unchanged. This closes the WH-125 known gap: tests/shared-modules-registry.mjs and tests/shared-modules-access.mjs create instances only through the real save path (configureFixtureModules); one direct head seed remains in the registry suite solely to show activation refusing a migration-bearing head, which no owner path can produce. Local checks: shared-modules-registry and shared-modules-access on SQLite and --d1, specification-compiler, specification-journey (local D1), specification-review-details/display, current-website-specifications, current-interfaces, feature-admission, shared-modules-contract, release-manifest, build-snapshot, 12 chat-interaction suites, chat-saved-turn, chat-reply, saved-work, site-agent, lifecycle-catalog, mobile-v1-contract, pnpm check, verify fast, verify protection and pnpm build passed. Rides the same owner-run empty-database cutover as WH-125/126; deploy ci refuses it.
- 2026-10-04 UTC: never-activated module instance removal (owner decision 2026-10-04). Source and local verification only; not deployed, not accepted. Branch c/great-curie-8ryukc (PR #160) adds the modules.remove specification operation: a saved instance with no module_instances row (never activated) may be removed through the exact owner specification review and recent-sign-in specificationApply (hook none, no review class, one comparison row, reply names the removal); restores may drop never-activated instances too; an instance that was ever activated (including disabled) stays MIGRATION_REQUIRED until WH-077 export exists. The pure compiler takes the removable id list from its caller (default none); prepareSpecification derives it from the registry, and the module_instance_spec_retained trigger on project_spec_versions refuses any saved version that drops or re-kinds a registered instance (commit-time activation race). Compiler classification changed, so project-content@5 replaces @4 (lock compiler-locks/project-content-v5.json via --init; module/schema pin digests unchanged; @3/@4 locks refused by compiler and SQL admission). Verified: tests/shared-modules-registry.mjs (SQLite and --d1, 12 groups), tests/specification-compiler.mjs, tests/current-website-specifications.mjs, shared-modules access/contract suites, pnpm check, verify fast/protection, pnpm build. Schema change: rides the same owner-run empty-database cutover; deploy ci refuses it.
- 2026-10-04 UTC: review fixes on branch c/great-curie-8ryukc (PR #160); source and local verification only; not deployed, not accepted. module_request_admit now caps visitor/staff/public writes at 20,000 receipts per instance in a sliding 24 hours (owner operations exempt and not counted) and staff/visitor records.update at 60 per identity per instance per hour; receipts keep a documented 30-day replay window and are pruned by the daily contacts maintenance job (cleanupModuleRequestReceipts; safety-hold inventory: excluded content-free receipt). Activation and access role review capacity (500/project, 50,000/platform) counts only pending reviews without an applied receipt. TURNSTILE_SECRET custody lists src/app-gateway.ts (whumpo-apps) and the validator refuses undeclared env readers; incident control C6 adds the wrangler.apps.jsonc step. docs/shared-modules.md states the shared photo quota consequence of visitor uploads. Local checks: shared-modules registry/access/records/files/collections/compositions on SQLite and --d1, contract, maintenance, maintenance-inventory, maintenance-scheduled, safety-case-operations (hold inventory), secret-custody test and tool, lifecycle-catalog, account-closure-inventory, pnpm check, verify fast, verify protection and pnpm build passed. Still requires the owner-run empty-database cutover.

## WH-126 — Deliver the access module for project visitors and staff roles

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A project owner can grant and revoke a staff role on an enrolled project visitor without giving that person workspace, Chat or owner authority.

### Scope

- Move project visitor identity ownership from the application space to the access instance by current-schema cutover, reusing passkeys, invitations, recovery and sessions
- Staff role grant/revoke through exact owner reviews with an access revision that invalidates sessions-bound decisions, cursors and pending writes
- access.me on the visitor origin; owner access.list and access.roles@1/accessRoleApply bindings
- Keep the existing per-visitor document and QuickJS transitions as an execution resource depending on the access instance

### Acceptance criteria

- [ ] Staff and visitors cannot use workspace cookies; owners and WH-054 members gain no visitor/staff authority; staff gain no Chat, publication, spending or identity management
- [ ] Revocation takes effect on the next request and inside in-flight commits; replay never re-grants
- [ ] Existing visitor sign-in, recovery, document transition, export and erasure suites pass after the cutover
- [ ] Role grants, reviews and suppressions follow the project-roles lifecycle class

### Verification

- node tests/app-auth.mjs, tests/app-data.mjs and visitor deletion/recovery suites on complete-schema local D1
- Two-project, revoked-visitor, revoked-staff and cross-origin cookie fixtures
- tsc for both projects

### Dependencies and blockers

Planning dependencies: WH-125. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/shared-modules.md](../../docs/shared-modules.md)
- [docs/app-data.md](../../docs/app-data.md)
- [src/app-gateway.ts](../../src/app-gateway.ts)
- [src/app-auth.ts](../../src/app-auth.ts)
- [src/app-access.ts](../../src/app-access.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC: partial slice; source and local verification only; not deployed, not accepted, issue not created or claimed from this session; WH-126 stays open. Branch c/great-curie-8ryukc (PR #160) extends the pending current schema input src/shared-modules/schema.sql with module_access_states (access revision), module_access_roles (staff grants and revoked suppressions), module_access_role_reviews/links/applies and commit triggers (lifecycle class project-roles admitted), adds src/shared-modules/access.ts (visitorPrincipal from the project visitor session cookie only, visitorPredicate composed into module commits and read fences, access.me and owner access.list handlers, access.roles@1 roster) and access-roles.ts (exact owner accessRoleReview/accessRoleApply ChatControls with recent passkey sign-in; grant composes core.editing, revoke needs identity and ownership only), the visitor-origin POST /modules route in src/app-gateway.ts, the access-roles view card and the Chat apply button. Visitor revocation and reviewed erasure suppress/delete grants and advance the access revision. Not done: moving visitor identity ownership from app_spaces to the access instance (staff still require an enabled visitor application), registering the per-visitor document as an execution resource, and a roles export serializer; access.prepareRole/confirmRole stay unavailable. Local checks: node tests/shared-modules-access.mjs passed 11 groups on SQLite and with --d1 on local D1 (signed-passkey visitors, actual gateway, anonymous/workspace/foreign/cross-origin cookie refusals, visitor cookie refused on the workspace origin, two projects, non-owner account, replay without re-grant, one-winner race, revoke inside an in-flight staff commit, revoked and erased visitors, plan loss, disable, closure/cascades, static no-inference check); shared-modules-registry (SQLite and --d1), shared-modules-contract, app-auth, app-data, app-recovery, app-lifecycle, visitor-deletion-review, verify app (customer app journey, owner erasure, task-list journey), lifecycle-catalog, restore-admission, account-closure-inventory, feature-admission, 14 offline chat-interaction suites, guest-preview, site-diagnostics, workspace-view-bindings/components, processing-boundaries, pnpm check, verify fast, verify protection and pnpm build passed (browser suites needing @playwright/test were not run). The schema change still requires the owner-run empty-database cutover (pnpm run deploy prepare/apply with schemaChange initialize, one cutover with WH-125); deploy ci refuses it and the PR must not merge without the owner.
- 2026-10-04 UTC: project-content@4 (see WH-125 evidence) lets owners save an access instance through the exact owner specification review, so the identity ownership cutover is no longer blocked by the compiler; that cutover, the per-visitor document resource and the roles export serializer remain open. tests/shared-modules-access.mjs now creates instances only through the real save path (SQLite and --d1 passed). Source only; not deployed or accepted.
- 2026-10-04 UTC: WH-126 identity cutover slice (owner decision of October 4, 2026); source and local verification only; not deployed, not accepted, issue not created or claimed from this session; WH-126 stays open. Branch c/great-curie-8ryukc (PR #160) changes the current schema inputs schema/platform.sql and src/shared-modules/schema.sql: app_visitors is keyed by project_id and access_id (no app_spaces reference); app_invitations and app_auth_challenges bind access_id and the access instance's activation revision; sessions drop the page binding; enrollment, passkeys, sign-in, recovery and sessions need only the project's active access instance activated by the current owner; at most one access instance per project (validator plus module_instance_access_single); disabling the access instance deletes its sessions and challenges and re-activation never revives invitations, challenges or sessions. The visitor application consumes identity: app_spaces.access_id/resource_id, enabling needs the active access instance, application disable/page change/migration/restore no longer sign visitors out and each app_runs row binds the page live at admission. The visitor gateway serves auth, export and the deletion review without a page. src/app-resource.ts derives the per-visitor document custom-function descriptor depending on the access instance (validated with the WH-071 reference and manifest check); src/shared-modules/access-export.ts adds the access-roles-export-v1 serializer (whumpo-access-roles v1) with import validation, and the access descriptor names it. Tests save and activate access instances through configureFixtureModules plus the exact activation controls (enableFixtureVisitorAccess). Local checks passed: shared-modules-access/registry/records/files/collections/compositions on SQLite and --d1, shared-modules-contract, app-activation, app-activation-http, app-auth, app-authenticator, app-data, app-lifecycle, app-migration-checks, app-page-design, app-recovery, visitor-data, visitor-deletion-review, customer-app-journey (with the task-list journey), verify app, lifecycle-catalog, account-closure-inventory, restore-admission, restore-inventory, restore-inventory-freshness, safety-case-operations, tools/safety-hold-inventory, service-safety, processing-boundaries, build-jobs, application-build, backend-checks, operator-containment, public-fairness, saved-work, chat-reply, specification-compiler, current-website-specifications, feature-admission, workspace-view-bindings/components, backend-chat, composition-planner, site-diagnostics, site-agent, agent-prompt-focus, prompt-data-boundaries, pnpm check, verify fast, verify protection and pnpm build. Not run: Playwright browser suites (workspace-view-lifecycle, workspace-identity-browser, visitor-deletion browser harness; @playwright/test is not installed) and app-pages-http (needs a .secrets fixture). Remaining: access.prepareRole/confirmRole, a role-review terminal-receipt schedule, staff sign-in in a composed frontend, and an owner product path to save an access instance; after the cutover the Chat visitor-application journey depends on that owner decision. The schema change still requires the owner-run empty-database cutover (pnpm run deploy prepare/apply with schemaChange initialize); deploy ci refuses it and the PR must not merge without the owner.
- 2026-10-04 UTC: WH-126 owner visitor access setup; source and local verification only; not deployed, not accepted, issue not created or claimed from this session; WH-126 stays open. Branch c/great-curie-8ryukc (PR #160) adds the typed owner ChatControl accessModuleReview (project id only; never a model action; the site agent prompt still advertises no module operation, asserted) and src/shared-modules/access-setup.ts: it prepares the existing exact specification review (prepareSpecification, one modules.put) for the fixed standard access instance (id visitors, current catalog pins, no dependencies, roles [], invitation enrollment), saved by the existing recent-sign-in specificationApply control and activated by the existing exact moduleActivationReview/Apply pair (three separate reviews; nothing combined). Schema input schema/platform.sql: project_spec_proposal_admit admits a completed guided accessModuleReview turn for the same project (change only) and the new project_spec_access_setup_admit trigger requires the proposal to be the head plus exactly that appended instance with nothing else changed. readAppAccess returns accessSetup (states and ids only, not in the agent's application read); the Visitors panel shows Set up visitor access and Review activating visitor access. A project without a website configuration is refused with a reason (website drafting stays an AI path). tests/customer-app-journey.mjs and the shared task-list journey now set up visitor access through these controls on the real /api/chat/actions endpoint (only the first private website draft and the core.editing grant are synthetic); enableFixtureVisitorAccess uses the same owner control. Local checks passed: customer-app-journey, verify app, app-activation(-http), app-auth, app-data, app-lifecycle, app-migration-checks, app-page-design, app-recovery, application-build, shared-modules-access/collections/compositions/contract/files/records/registry on SQLite and --d1, 13 offline chat-interaction suites, feature-admission, tools/safety-hold-inventory, processing-boundaries, build-jobs, backend-checks, operator-containment, public-fairness, saved-work, service-safety, safety-case-operations, visitor-deletion-review, visitor-data, chat-reply, specification-compiler, current-website-specifications, site-agent, agent-prompt-focus, prompt-data-boundaries, workspace-view-bindings/components, pnpm check, verify fast, verify protection, pnpm build, roadmap validate/alignment/render --check. Not run: app-pages-http (needs a .secrets fixture) and Playwright browser suites. Remaining WH-126: access.prepareRole/confirmRole, role-review terminal-receipt schedule, staff sign-in in a composed frontend, an owner path to add the staff role; visitor access setup needs the project's first private website. The schema change still requires the owner-run empty-database cutover; deploy ci refuses it and the PR must not merge without the owner.

## WH-127 — Deliver the records and forms module with contact as a fixed instance

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Visitors submit validated forms into private records that owners, staff and submitters read only through their permitted views and fields.

### Scope

- Record storage adapter on shared D1 with forms.submit, records.view/get/update/remove, opaque scoped cursors and field projection
- Public submissions reuse contact admission: Origin, body bound, rate limiter, Turnstile, atomic caps; visitor/staff submissions use the access session
- Expose the existing contact inbox as a fixed-schema records instance over its current tables without changing its fields or 30-day retention
- records.summary@1 binding, descriptor lifecycle hooks and visitor-scoped export serializer; form.accepted event handoff for WH-069

### Acceptance criteria

- [ ] Field/record permissions hold for owner, staff, submitter and anonymous callers on direct requests, including owner-only fields and own-record scope
- [ ] Replay, changed-payload conflict, stale configRevision, quota and lost-response cases behave per contract; zero maintainer inference
- [ ] Contact behavior and its suites are unchanged apart from the shared handler path
- [ ] No booking, scheduling or arbitrary query capability is implied

### Verification

- node tests/contacts.mjs plus a new records suite on disposable D1 with two tenants and role revocation
- Direct HTTP fixtures against the visitor and workspace origins
- tsc for both projects

### Dependencies and blockers

Planning dependencies: WH-126. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/shared-modules.md](../../docs/shared-modules.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [src/contacts.ts](../../src/contacts.ts)
- [src/backend-form-shape.ts](../../src/backend-form-shape.ts)
- [docs/job-envelope.md](../../docs/job-envelope.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC: partial slice; source and local verification only; not deployed, not accepted, issue not created or claimed from this session; WH-127 stays open. Branch c/great-curie-8ryukc (PR #160) adds module_records and module_record_events to the pending current schema input src/shared-modules/schema.sql (lifecycle class module-records admitted) and src/shared-modules/records.ts handlers registered in the WH-125 engine: visitor/staff forms.submit through the access session (nested values, bounded field validation, opaque entry id), records.get/records.view with the policy field projection and own-record scope repeated in each query and cursors bound to view, principal, configRevision and access revision, records.update (owner any field, staff staffWrite only, revision compare-and-swap) and owner records.remove (any activation state, refused inside safety holds). Commit triggers repeat instance/form/schema/retention/visitor/caps; content-free events prove each write and are the form.accepted handoff. Retention expiry (current retentionDays) runs in the contacts maintenance job and skips held projects; the delete site is classified blocked in tools/safety-hold-inventory.mjs. Owner routes on the workspace origin: POST /api/projects/P/modules and GET /api/projects/P/module-records/R/S. Verified: tests/shared-modules-records.mjs (SQLite and --d1, 9 groups, two owners/projects, roles, revocation, replay), registry/access/lifecycle/restore-admission/contacts/maintenance/app-auth/app-lifecycle suites, pnpm check, verify fast/protection, pnpm build. Remaining: anonymous public intake with Turnstile and caps, contact inbox as a fixed-schema instance, records.summary@1 and dashboard panel, visitor-subject export serializer and descriptor hooks, attachments (WH-128). Schema change: same owner-run empty-database cutover; deploy ci refuses it.
- 2026-10-04 UTC: anonymous public intake slice; source and local verification only; not deployed, not accepted; WH-127 stays open. Same branch and pending schema cutover. An anonymous forms.submit to a public form passes the resolver and policy, reads an exact replay back without re-verification, then the visitor gateway's public admission reuses the contact form's protections: fail closed without TURNSTILE_SECRET, the contact per-connection allowance (public_client_usage scope contact, shared with the contact form) and the shared Siteverify helper src/turnstile.ts (now also used by the contact page) bound to the visitor host, action module-form and the exact resource id; the engine refuses public writes without that admission. module_record_admit repeats a public form, a live publication and the contact caps over anonymous module receipts (20/hour or the contact containment allowance, 100 per project and 1,000 platform-wide in 30 days, fair share above 500). Anonymous rows have submitter_kind public and no visitor id. Verified: tests/shared-modules-records.mjs (SQLite and --d1, 10 groups), tests/shared-modules-registry.mjs (SQLite and --d1), shared-modules-access, contacts, pnpm check, verify fast/protection, pnpm build. Activation needs the owner to set TURNSTILE_SECRET on whumpo-apps and confirm Turnstile hostnames cover app-PROJECT.whumpo.site (requires verification); no composed visitor frontend renders the widget yet (WH-070).
- 2026-10-04 UTC: records.summary@1 and owner records panel slice; source and local verification only; not deployed, not accepted; WH-127 stays open. The records-summary view (registry feature null) and GET /api/projects/P/module-records return per registered records instance its state, configuration revision, retention, per schema the field count and retained records by submitter kind, and form/view ids with audiences; never field labels, values, entry ids or visitor ids, so the binding is safe for Chat temporary views. The fixed Form records control page (/workspace/records, frontend/src/records-panel.tsx) reads values only from the owner list route, renders them as text, pages with the opaque cursor and deletes through an owner records.remove request. Verified: tests/shared-modules-records.mjs (SQLite and --d1, 11 groups), shared-modules-registry/access, workspace-view-bindings/components, workspace-layout, chat-temporary-views, chat-interaction-contract, workspace-dashboard suites, pnpm check, verify fast/protection, pnpm build; the panel itself has no browser test (tests/workspace-view-lifecycle.mjs needs @playwright/test, not installed here).
- 2026-10-04 UTC: contact inbox as a fixed-schema records instance deliberately not built (documentation only, docs/shared-modules.md#contact-inbox-stays-on-its-own-tables--october-4-2026-utc). It cannot be done without duplicating storage or breaking a current contract: contact's 2,000-character message and validated email exceed the frozen records v1 field types (a new type is a compiler identity cutover), contact intake is enabled by publication-bound contact_reviews outside the module registry (a wrapped instance would need a platform-created registry row with no specification source or a second activation authority), and serving contact_submissions through the records handlers would add a second storage path to every handler and trigger. Public module forms reuse the contact admission instead. This scope item needs an owner decision (retire contact in favour of a records instance at a cutover, or add long-text/email field types) before it can close; WH-127 stays open for it and the export serializer.
- 2026-10-04 UTC: records export serializer slice; source and local verification only; not deployed, not accepted; WH-127 stays open. Records descriptors name exportHook records-export-v1 with the module-records data set separate-approval (hook ids in src/shared-modules/export-hooks.ts). exportRecords (src/shared-modules/records-export.ts) is owner-only in every activation state without a feature grant, refuses a stale configRevision or a descriptor without the hook, and returns whumpo-module-records v1 for one schema: fields and every currently retained record and value, 200 per page with the records cursor, optionally limited to one project visitor's own submissions (the WH-077 separate-approval slice; no visitor route). validateRecordsExport checks the wrapper, the schema with the current field validator, each record and value, the subject scope and the SHA-256; nothing imports. No route, table, Chat surface or compiler identity change; values never reach Chat, model context, receipts, events or logs. Verified: tests/shared-modules-records.mjs (SQLite and --d1, 12 groups), shared-modules-registry/access/collections/compositions/contract, workload-placement-prototype, lifecycle-catalog, safety-hold-inventory, pnpm check, verify fast/protection, pnpm build. Remaining: form attachments, the contact-instance owner decision, public intake activation (TURNSTILE_SECRET, hostname list).

## WH-128 — Deliver the files and galleries module over private photo storage

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Staff or visitors upload files into collections governed by role policy, and permitted viewers see only approved files, without any public bucket.

### Scope

- Extend project_files with instance/collection and uploader identity by current-schema cutover; keep JPEG cleaning, 1 MiB bound, create-only R2 and reservations
- files.prepareUpload/putBytes/read/gallery on the visitor origin; owner collection for existing project photos and the Chat upload handoff
- Pending safety receipt on every upload; approved exact-digest reads with byte re-hash; reviewed removal and cleanup queue
- Descriptor lifecycle hooks and export serializer for eligible approved files

### Acceptance criteria

- [ ] Staff-only upload is enforced by the collection role policy; names, prefixes and URLs grant nothing; visitors and anonymous callers are refused
- [ ] Held, blocked or revoked files are never served, referenced or published; removal respects held state and preservation hooks
- [ ] Existing photo upload, version, removal and publication suites pass
- [ ] Public exposure happens only through existing exact publication reviews

### Verification

- node tests/files.mjs, tests/photo-versions.mjs and tests/photo-removal.mjs on disposable D1/R2
- New two-tenant role/revocation/direct-API upload fixtures with synthetic clearances only
- tsc for both projects

### Dependencies and blockers

Planning dependencies: WH-126, WH-010. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/shared-modules.md](../../docs/shared-modules.md)
- [docs/photos.md](../../docs/photos.md)
- [src/files.ts](../../src/files.ts)
- [src/photo-safety.ts](../../src/photo-safety.ts)
- [docs/safety-coverage.md](../../docs/safety-coverage.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC: partial slice; source and local verification only; not deployed, not accepted, issue not created or claimed from this session; WH-128 stays open. Branch c/great-curie-8ryukc (PR #160) adds module_files to the pending current schema input src/shared-modules/schema.sql (lifecycle class module-files admitted, 215 tables) as a 1:1 row beside an ordinary project_files photo row, so the WH-013 pipeline applies unchanged: cleanPhoto, 1 MiB and collection maxBytes, create-only private R2 object under photos/ with a server key, photo quotas, the pending project_photo_safety receipt written with the ready row, the approved_project_photos exact-digest view, byte re-hash, photo removal review, safety holds, cleanup queue and orphan sweep. src/shared-modules/files.ts registers files.putBytes (visitor origin POST /modules/upload, JPEG body with the envelope in a header; declared type/length/SHA-256 checked; no caller name, path, prefix or bucket), files.gallery and files.read (approved bytes only, re-hashed, sandboxed image response). Staff upload is the collection role policy (policy table, engine receipt predicate, module_file_admit with the staff role on the governing access instance and 10/hour/visitor); over-wide galleries are refused by the validator and at serving time. Module uploads are excluded from the owner photo library, Chat pickers, website specifications, the agent's photo context, workspace inspection and saved work, and get server-assigned names. Visitor erasure and files-instance removal delete their photo rows (blocked inside holds; classified in tools/safety-hold-inventory.mjs). whumpo-apps gains the existing private FILES binding. Verified: tests/shared-modules-files.mjs (SQLite with in-memory bucket and --d1 with local R2, 8 groups), tests/files.mjs, photo-versions, photo-removal, shared-modules-records/registry/access, contacts, app-auth, app-lifecycle, chat-interaction-photos, saved-work, workspace-view-bindings, agent-inspection, guest-preview-photos, current-website-specifications, lifecycle-catalog, restore-admission, safety-hold-inventory, pnpm check, verify fast/protection, pnpm build. Remaining: existing photos as an owner collection, owner module uploads and Chat handoff, prepareUpload/requestRemoval as module operations, form attachments, galleries in published websites, descriptor hooks and export serializer, scanner integration (owner-deferred). Schema change: same owner-run empty-database cutover; deploy ci refuses it.
- 2026-10-04 UTC: files export serializer slice; source and local verification only; not deployed, not accepted; WH-128 stays open. Files descriptors name exportHook files-export-v1 with the module-files data set separate-approval. exportFiles (src/shared-modules/files-export.ts) is owner-only in every activation state, refuses a stale configRevision or a descriptor without the hook, and returns whumpo-module-files v1 for one collection: only ready files with a current exact-digest approval, 8 per page, cleaned JPEG bytes re-hashed against the approved digest (a tampered object fails the export), dimensions, size, digest, uploader kind and visitor id, and a withheld count for held/blocked files; optionally limited to one visitor's own uploads (WH-077 separate approval). No object key, bucket, file name, safety receipt or scanner reference is exported. validateFilesExport checks shapes, bytes (JPEG start, size, SHA-256) and the page SHA-256; nothing imports. Verified: tests/shared-modules-files.mjs (SQLite with an in-memory bucket and --d1 with local R2, 9 groups), tests/files.mjs, photo-versions, photo-removal, shared-modules-registry/access/collections/compositions/contract, lifecycle-catalog, safety-hold-inventory, pnpm check, verify fast/protection, pnpm build. Remaining: existing photos as an owner collection, galleries on published websites, Chat handoff into a collection, prepareUpload/requestRemoval as operations, scanner integration (owner-deferred).
- 2026-10-04 UTC: owner collections and published galleries slice; source and local verification only; not deployed, not accepted; WH-128 stays open. module_files gains owner rows (uploader_kind owner, no visitor): the owner's files.putBytes on the workspace module route names an existing ready project photo by id and exact SHA-256 and files it into a collection whose upload lists owner, with no second photo row, object or reservation; module_file_admit repeats the active instance, owner upload policy and a ready same-project photo. ownerLibrarySQL and saved work exclude only staff/visitor uploads, so filed photos stay in the owner library; instance removal deletes only staff/visitor photo rows; module_file_not_published refuses staff/visitor uploads as website photos. The typed owner Chat control galleryPageReview (ids only, not advertised to the site agent) prepares the existing exact specification review with one pages.setPhotos of the newest approved owner-filed photos (at most four, photo-page@1); project_spec_gallery_admit repeats the shape inside the commit; saving is specificationApply and going public is the existing exact publication review with the unchanged WH-013 approval and re-hash gates. No compiler identity change (project-content@5 unchanged). Verified: tests/shared-modules-files.mjs (SQLite and --d1 with local R2, 10 groups), files, photo-versions, photo-removal, chat-interaction-photos/contract, chat-temporary-views, saved-work, workspace-view-bindings, agent-inspection, guest-preview-photos, current-website-specifications, restore-admission, specification-compiler, lifecycle-catalog, app-auth, app-lifecycle, contacts, shared-modules-registry/access/records/collections/compositions (SQLite and --d1), safety-hold-inventory, pnpm check, verify fast/protection, pnpm build. Schema change: same owner-run empty-database cutover; deploy ci refuses it. Remaining: Chat upload handoff directly into a collection, removing a photo from a collection, an owner panel control (files instances are fixture-configured only), prepareUpload/requestRemoval as operations, scanner integration (owner-deferred).
- 2026-10-04 UTC: owner Photos panel controls slice; source and local verification only; not deployed, not accepted, not exercised in a browser; WH-128 stays open. No schema, authority or review change. GET /api/projects/P/module-files (owner only; readOwnerFileCollections in src/shared-modules/files-gallery.ts, OwnerFileCollections in shape.ts) returns saved page ids/paths, unfiled ready owner photos with their exact SHA-256 and owner collections with owner-filed photo ids and safety state (never staff/visitor uploads; dashboard only, not Chat or model context). The Photos panel (frontend/src/photo-collections.tsx, client frontend/src/lib/photo-collections.ts) adds Add to collection on ready photos (owner files.putBytes envelope {fileId, sha256} on the workspace module route, one request id reused per photo and collection until confirmed) and a Collections and gallery pages section whose Prepare gallery page button sends the typed galleryPageReview control through runAction; saving and publishing stay the existing exact reviews. Verified: tests/shared-modules-files.mjs (11 groups, SQLite with in-memory bucket and --d1 with local D1/R2; new group drives the panel client through the real routes: owner-only facts, exact envelope, lost-ack replay with the same request id, gallery refused while held and prepared after approval with nothing saved, disabled instance refused, no staff/visitor uploads listed, no prompt mention), tests/files.mjs, photo-versions, photo-removal, chat-interaction-photos, saved-work, agent-inspection, shared-modules-registry/access/compositions, pnpm check, verify fast/protection, pnpm build. Remaining: Chat upload handoff directly into a collection, removing a photo from a collection without deleting it, prepareUpload/requestRemoval as operations, owner authoring of files instances (fixture-only), scanner integration (owner-deferred).
- 2026-10-04 UTC: owner photo collection setup slice; source and local verification only; not deployed, not accepted, not exercised in a browser; WH-128 stays open. The typed owner Chat control filesModuleReview {projectId} (src/shared-modules/files-setup.ts; never accepted from model output, not advertised to the site agent) prepares the existing exact specification review with one modules.put of a fixed standard files instance: id photos, current catalog module-files/files-data pins, no dependencies, one collection library (owner read, owner-only upload, 1 MiB, JPEG, no gallery; schema review class only). Refused with reasons for a project without a website (404), an existing saved or registered owner collection, a taken photos instance id or library collection id (400) and foreign projects (404). Saving is specificationApply (recent sign-in) and activation the separate moduleActivationReview/Apply pair. project_spec_proposal_admit gains a filesModuleReview branch and the new project_spec_files_setup_admit trigger (src/shared-modules/schema.sql) requires head plus exactly that appended instance (exact key counts). GET /api/projects/P/module-files returns setup states; the Photos panel Collections and gallery pages section offers Set up photo collection and Review activating photo collection. Verified: tests/shared-modules-files.mjs (12 groups, SQLite with in-memory bucket and --d1 with local D1/R2; new group covers malformed/foreign controls, exact instance and pins, linked review, 13 tampered proposals refused inside the commit, exact copy accepted, separate save and activation, panel setup states and client actions, filing into the set-up collection, disable, repeated setup, existing collection, taken ids, no website, prompt check), shared-modules-access (SQLite and --d1), shared-modules-registry/compositions/contract, chat-interaction-photos, service-safety, current-website-specifications, specification-compiler, safety-hold-inventory, pnpm check, verify fast/protection, pnpm build. Schema change: same owner-run empty-database cutover; deploy ci refuses it. Remaining: Chat upload handoff directly into a collection, removing a photo from a collection without deleting it, prepareUpload/requestRemoval as operations, staff/visitor files instances (fixture-only), scanner integration (owner-deferred).
- 2026-10-04 UTC: Remove from collection slice; source and local verification only; not deployed, not accepted, not exercised in a browser; WH-128 stays open. No schema, trigger, review, Chat surface or module operation change (the closed WH-123 operation set is unchanged). POST /api/projects/P/module-files/remove (owner only; removeOwnerFileFromCollection in src/shared-modules/files-gallery.ts) takes exactly {resourceId, collectionId, fileId} and deletes one owner-filed photo's module_files row only: the photo, its private object, safety receipt and saved versions stay, nothing is queued, and the photo returns to the unfiled list. Idempotent (removed:false when already out). Staff/visitor uploads are not_found, non-owner collections forbidden, malformed bodies invalid_request; works while disabled and inside a safety hold (deletes no content; new WH-132 inventory site classified excluded). Conservative choice: refused (409) while the current saved head version or the live publication shows the photo, repeated inside the deleting statement, because a gallery page is a snapshot of photo ids; the owner changes the page first or uses the photo removal review. The Photos panel shows Remove from collection on filed photos. Verified: tests/shared-modules-files.mjs (13 groups, SQLite with in-memory bucket and --d1 with local D1/R2; new group drives the panel client through the real route: exact body, lost-ack retry, photo/receipt/object kept, re-filing, foreign/unknown/non-owner/staff-upload/malformed refusals, refusal while the saved website shows the photo, removal while disabled and inside a project hold, prompt check), safety-case-operations, shared-modules-compositions, photo-removal, files, photo-versions, saved-work, safety-hold-inventory (94 sites), pnpm check, verify fast/protection, pnpm build. Remaining: Chat upload handoff directly into a collection, prepareUpload/requestRemoval as operations, staff/visitor files instances (fixture-only), scanner integration (owner-deferred).

## WH-130 — Accept shared modules across two frontend compositions

Phase: **Configuration and shared capabilities** (F5). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Two different frontends use one module API contract with no custom authentication or handlers, and the WH-067 acceptance is evidenced.

### Scope

- Build two synthetic compositions (a staff portal and a visitor intake/gallery) against the same records/files/access instances on the visitor origin
- Cross-tenant, cross-user, role, direct-API, replay and revocation fixtures over actual handlers with maintenance inference unavailable
- Run the existing contact, directory, photo and app lifecycle suites relevant to each slice and record evidence levels

### Acceptance criteria

- [ ] Every WH-067 acceptance criterion maps to passing local evidence; live or device acceptance is reported separately
- [ ] Neither composition contains authentication, authorization or storage code of its own
- [ ] No universal no-code engine, booking promise or public bucket is introduced

### Verification

- Connected local D1/R2 journey with two compositions and two tenants
- Existing lifecycle suites listed in each slice
- Import graph shows no maintainer inference in module paths

### Dependencies and blockers

Planning dependencies: WH-127, WH-128, WH-129. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/shared-modules.md](../../docs/shared-modules.md)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/verification.md](../../docs/verification.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC: local synthetic evidence only; not deployed, not browser-tested, not live- or customer-accepted; issue not created or claimed from this session; WH-130 stays open. Branch c/great-curie-8ryukc (PR #160, held for the owner empty-D1 cutover) adds two synthetic compositions, tests/fixtures/module-compositions/staff-portal.mjs and visitor-intake.mjs, that call only same-origin POST /modules and /modules/upload with the whumpo-modules v1 envelope and a manifest of resource ids and configRevisions. A static check refuses auth, cookie, session, principal/role, SQL, storage-location, absolute-origin, handler and inference code and any import in both. tests/shared-modules-compositions.mjs (11 groups, passing on SQLite with an in-memory private bucket and with --d1 on local D1/R2) drives both against the same access/records/files/content instances of two tenants through the actual visitor gateway, module engine, handlers, commit triggers, activation/role/directory/publication reviews and owner workspace routes. It covers cross-user, role, cross-tenant and direct-API refusals; replay (a write readback, conflict, anonymous replay without re-verification, replay refused after revocation); staff and visitor revocation, disable and a stale manifest after an additive field; approved-only files with re-hash; no values in Chat, model context, receipts or logs; no public bucket; and no maintainer inference, with fetch throwing and the import graphs checked. The harness plays the browser: no Worker serves a composition yet (WH-070) and Playwright is not installed. The acceptance map and the exact gaps that block the first criterion are in docs/shared-modules.md#wh-067-acceptance-map--october-4-2026-utc: WH-126 identity cutover, WH-127/128 export serializers and form attachments, the owner photo collection, owner uploads and published galleries, LC-06, the owner authoring path, a served composition, and the deployed cutover.

## WH-068 — Implement shared notification templates and delivery configuration

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers configure deterministic notifications while Whumpo maintains one delivery implementation.

### Scope

- Build on the selected contact/outbound delivery contract and durable receipts
- Define versioned templates, verified senders, recipient scope, consent/preferences and delivery events
- Offer standard appointment-request receipt and staff-notification rules as configuration

### Acceptance criteria

- [ ] Submission and notification delivery never invoke the Whumpo maintainer model
- [ ] Provider secrets remain in authorized backend adapters and recipient/template inputs cannot form an open relay
- [ ] Retries, delivery timeouts, bounces and cancellation use exact receipts and bounded reconciliation
- [ ] Sender/DNS/provider charges require concrete review; no service is provisioned by a template
- [ ] A failed notification does not lose the accepted form record

### Verification

- Synthetic configured notification, duplicate event, timeout/bounce and revoked-recipient tests
- Existing contact/delivery tests selected by changes
- Approved provider canary only after sender/recipient and cost review

### Dependencies and blockers

Planning dependencies: WH-067, WH-036, WH-052, WH-154, WH-155, WH-156, WH-157, WH-158, WH-159, WH-160. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [docs/integrations/cloudflare-dns.md](../../docs/integrations/cloudflare-dns.md)
- [docs/notifications.md](../../docs/notifications.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-08 UTC: decomposed into WH-154 to WH-160 with the planned contract in docs/notifications.md (WH-154). Planning and offline reference only: no table, route, binding, provider, sender, DNS record, schedule or deployment, and no src/ behavior change. The parent acceptance is unchanged and closes only after every child; no child depends on WH-069, WH-080 or WH-094. WH-036 source (owner-destination contact notices) is mapped with exact gaps G-N1 to G-N10; its live canary stays a WH-036/WH-160 gate.

## WH-069 — Run stored automation rules on a shared deterministic engine

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customer workflows are versioned definitions and execution state, with no always-running per-customer scheduler or maintainer-agent step.

### Scope

- Implement a narrow trigger/condition/action catalog for records, approvals, notifications and bounded schedules
- Use the current D1-owned receipt/scheduled-pass ADR; evaluate Queues/Workflows only at its measured adoption triggers
- Bind each execution to verified project scope, exact rule/module version, actor authority and event ID
- Support wait, cancel, resume and read-only progress with current permission checks

### Acceptance criteria

- [ ] Catalog has no Whumpo maintainer, agent callback, prompt or premium-model action
- [ ] Visitor events may start approved deterministic workflows but cannot start owner maintenance sessions
- [ ] Duplicate/out-of-order events and uncertain external effects cannot repeat unsafe email/payment/provisioning operations
- [ ] Waits persist state rather than keeping a process/request alive; expired/revoked permission prevents later steps
- [ ] Scheduling retries do not imply exactly-once external delivery or permission to provision paid services

### Verification

- Synthetic appointment request to saved record to staff approval to confirmation with model transport disabled
- Job receipt, cancellation, lost response and replay fixtures
- No live customer automation or new schedule activated by local acceptance

### Dependencies and blockers

Planning dependencies: WH-065, WH-067, WH-068, WH-052, WH-075. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [docs/app-data.md](../../docs/app-data.md)
- [tools/prototypes/job-journal.mjs](../../tools/prototypes/job-journal.mjs)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-070 — Separate visual customization from maintained backend behavior

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Distinctive sites and portals use different presentation while retaining the same tested standard APIs.

### Scope

- Deliver three extension levels: design configuration, component composition and a small custom frontend component
- Define versioned frontend/backend contracts, scoped API clients and safe custom-component boundaries
- Load/edit only the affected component and its contracts for owner maintenance
- Customer-facing application presentation consumes maintained WH-067 APIs; this renderer is separate from the WH-107/109 owner Chat/view renderer and neither may fork backend authority.

### Acceptance criteria

- [ ] Custom presentation cannot enlarge backend permissions or access platform credentials/model transports
- [ ] Standard backend services are not copied/forked merely to change typography, navigation or gallery interaction
- [ ] Existing frontend isolation/CSP, content checks, preview and publication reviews still apply
- [ ] Visual diversity and accessibility are evaluated independently of functional reuse
- [ ] Templates and maintained module dependencies are identified separately in the project specification

### Verification

- Compare three different compositions against identical API/permission conformance cases
- Visual/accessibility and focused-edit preservation checks
- Export/build deterministic output tests for supported composition levels

### Dependencies and blockers

Planning dependencies: WH-066, WH-067. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/shared-components.md](../../docs/shared-components.md)
- [docs/app-data.md](../../docs/app-data.md)
- [docs/mvp.md](../../docs/mvp.md)
- [src/components.ts](../../src/components.ts)
- [src/app-page-design.ts](../../src/app-page-design.ts)
- [web/visitor.js](../../web/visitor.js)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-072 — Design project data provisioning, migrations and recovery boundaries

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Static projects avoid unnecessary databases; projects with application data can use separate managed project databases with complete lifecycle.

### Scope

- Keep shared platform registry/catalog metadata while assessing per-project D1 for application data
- Implement a reviewed registry/provision/schema-migrate/export/restore/delete workflow with immutable resource identity
- Define trusted routing/binding limits, migration fan-out, failure recovery and safe upgrades from current shared visitor data
- For a justified PostgreSQL adapter, specify non-owner/non-superuser/non-BYPASSRLS request roles and scoped connections
- Implement justified physical provisioning/migration behind WH-071 interfaces; preserve WH-067 client contracts, module identities and existing shared-data behavior until separately reviewed migration.

### Acceptance criteria

- [ ] No blind migration of existing tenants or database-count reduction as a cost goal
- [ ] Database choice accounts for query/storage pricing, per-database limits and contention rather than assumed per-server rent
- [ ] Guest code receives project resources or a scoped API, never an all-customer database credential
- [ ] Partial provisioning/migration and lost provider responses reconcile without duplicated resources or dropped data
- [ ] Per-project backup/deletion/restoration preserves platform publication, revoked identity, legal holds and tombstones

### Verification

- Disposable schema/registry/provisioning-adapter and cross-project routing fixtures
- Restore/migration failure and deletion reconciliation tests
- Cloud provider creation requires a separate exact resource/cost review

### Dependencies and blockers

Planning dependencies: WH-064, WH-067, WH-071, WH-009, WH-019. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/app-data.md](../../docs/app-data.md)
- [docs/account-closure.md](../../docs/account-closure.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/deployment.md](../../docs/deployment.md)
- [docs/emdash.md](../../docs/emdash.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/workload-placement.md](../../docs/workload-placement.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-074 — Pool isolated builds and on-demand owner maintenance sessions

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Persistent project/owner context uses stored state while shared capacity runs clean bounded jobs only when authorized work arrives.

### Scope

- Reuse approved immutable toolchains/dependency caches and content-addressed artifacts
- Give every build/conversion job a fresh isolated writable workspace, scoped inputs/outputs, short-lived authority and explicit cleanup
- Load the relevant owner conversation/project state for bounded maintenance and release capacity afterward
- Run schema/type/dependency/build diagnostics before model repair; return focused failure context and use supported prompt caching only after privacy/provider validation

### Acceptance criteria

- [ ] No always-running agent container or automation server is allocated per customer by default
- [ ] Writable shells, credentials and private customer caches/workspaces are never shared
- [ ] Visitor requests or customer workflow events cannot wake the maintainer agent
- [ ] Cancelled/expired jobs cannot publish, spend or reuse another job authority; cleanup failures are recorded
- [ ] Prepared-image/cache reuse is distinguished from private artifact reuse and does not assume idle running memory/disk is free

### Verification

- Two-tenant build/cache contamination, cleanup, cancelled-job and output-ownership fixtures
- Owner session resume/concurrency and bounded resource tests
- Synthetic maintenance task with deterministic diagnostics preceding any optional model call

### Dependencies and blockers

Planning dependencies: WH-065, WH-071, WH-052, WH-075. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [docs/backend-execution.md](../../docs/backend-execution.md)
- [docs/releases.md](../../docs/releases.md)
- [docs/workspace-agent.md](../../docs/workspace-agent.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/workload-placement.md](../../docs/workload-placement.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/148. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC: owner decision on issue #148 implemented in source with local verification only; not deployed, not accepted. Changes the composed schema (schema/platform.sql: operator_containments scope 'build', freeze-only CHECK; build_job_admit refuses an active build freeze with the generic build_job_capacity error; new operator_containment_build_cancel trigger), so it needs the owner-run empty-D1 schema cutover held on PR #160 and cannot ship through deploy ci. tools/operator-containment-input.mjs accepts scopes {build:'freeze'} for a project or account (no allowance; limits stay as built) and reports active build jobs in status. A freeze refuses new jobs and cancels running and succeeded-but-unpublished jobs in scope exactly like owner cancellation (no dispatch/finish/spend/publish; an already-sent test is not recalled; cleanup recorded by reconcileBuildJobs); published jobs and other projects/tenants are untouched; lift restores admission. The owner-facing 429 text in src/application-build.ts is now generic so a freeze is not disclosed. Local checks: node tests/build-jobs.mjs (new section 11, SQLite with the actual QuickJS runtime; a mutation removing the cancel trigger made it fail), node tests/operator-containment.mjs and --d1 (local D1), node tests/application-build.mjs, tests/maintenance-inventory.mjs, tests/lifecycle-catalog.mjs, tests/contact-notifications.mjs, pnpm check, node tools/verify.mjs fast and protection, and pnpm build passed. Not rehearsed against any deployed database.

## WH-076 — Govern maintained module versions and controlled upgrades

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Reuse produces maintained dependencies with predictable upgrades rather than many independently forked templates.

### Scope

- Define exact current module interfaces and dependency pins, conformance tests and security maintenance ownership; reject unsupported versions
- Implement reviewed current-version cutovers, obsolete-test resets, withdrawal and forward repair; no old module reader or runtime rollback
- Productize repeated missing capabilities deliberately with provenance, rights and privacy review
- Extend existing immutable compiler/module pins with current cutover and withdrawal operations; WH-067 first schemas already carry exact version metadata

### Acceptance criteria

- [ ] Project specification records exact module versions and custom overrides
- [ ] An upstream release never silently changes customer behavior/permissions/data schema
- [ ] Content restoration uses the current schema/compiler and preserves current safety/deletion requirements; old runtime versions remain unsupported
- [ ] No automatic copying or model-context sharing of private customer implementations
- [ ] Promotion considers aggregate development, support and maintenance cost against repeated custom work avoided

### Verification

- Current module conformance and explicit stale/unknown-version rejection fixtures
- Reviewed cutover/failure/forward repair on two disposable synthetic projects
- Existing nomination consent/withdrawal and provenance tests

### Dependencies and blockers

Planning dependencies: WH-065, WH-066, WH-030. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/shared-components.md](../../docs/shared-components.md)
- [docs/jarvis-reuse.md](../../docs/jarvis-reuse.md)
- [docs/app-data.md](../../docs/app-data.md)
- [src/backend-nominations.ts](../../src/backend-nominations.ts)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 WH-120 amendment: active planning now requires current-only admission, reviewed obsolete-test resets and forward repair. Legacy identity stages, old-client/module coexistence and old-runtime rollback are not implementation requirements. This is documentation alignment only, not implementation, policy activation or device acceptance.

## WH-077 — Define and verify portable project exports and managed-service adapters

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers can export what they own with an honest account of managed dependencies and a tested route to running supported outcomes elsewhere.

### Scope

- Export specification, content, allowed customer data, custom source, asset manifests/digests and exact module/compiler versions
- Distinguish static source download, data portability and a functioning standalone application
- Select a supported self-hostable runtime, replacement adapters or a documented migration path for each shared capability
- Include export format/version/migrations, unavailable feature report and secure secret reconfiguration instructions
- Verify exports for currently supported placement adapters using WH-071 logical identities. WH-072 physical database provisioning is optional future coverage, not a prerequisite for the first portable subset; if adopted, add its adapter and fresh acceptance before claiming it is portable.

### Acceptance criteria

- [ ] Exports never include platform/other-tenant secrets or unapproved private data
- [ ] A frontend still requiring private Whumpo APIs is never described as a complete runnable export
- [ ] A fresh isolated environment runs at least the claimed portable subset with Whumpo APIs and maintainer model unavailable
- [ ] Unsupported managed integrations and customer action/cost steps are explicit
- [ ] Whumpo internal platform source need not be disclosed to provide the defined customer ownership/exit contract

### Verification

- Deterministic bundle/checksum and permission-filter tests
- Clean-environment import/boot for advertised subset
- Compare restored data/assets/module versions and documented exclusions

### Dependencies and blockers

Planning dependencies: WH-066, WH-067, WH-076, WH-009, WH-071. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/mvp.md](../../docs/mvp.md)
- [docs/account-closure.md](../../docs/account-closure.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/shared-components.md](../../docs/shared-components.md)
- [docs/app-data.md](../../docs/app-data.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/workload-placement.md](../../docs/workload-placement.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-091 — Deliver the Creator brand kit and reusable section library

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Creators reuse their own versioned brand assets, shared styles and supported page sections through explicit recoverable project changes.

### Scope

- Define tenant-owned versioned kits/design tokens and supported section references over the maintained specification/compiler
- Use approved private assets and supported component contracts; preserve unrelated content and custom overrides
- Prepare per-project previews, exact apply reviews and immutable versions; never propagate library edits silently to installed or published projects
- Split schema/library, editing/application and connected acceptance children; portfolio-wide changes belong to WH-103
- Expose routine owner operations through WH-105 registered read/action bindings and WH-107/109/110 Chat/view adapters; implement domain handlers once. Feature acceptance uses the shared owner surface, with essential direct recovery/security controls retained.

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] Foreign kits/assets and incompatible component versions are refused; kits and sections remain owner-scoped
- [ ] Pinned inputs compile deterministically; changing a shared style cannot mutate existing versions/publications
- [ ] Stale apply, withdrawal/deletion and restore recheck ownership, asset safety and compatible version state
- [ ] Library export/deletion follows WH-009 without exposing another owner or platform secrets

### Verification

- Two-owner/two-project save/reuse/edit/restore journey with byte/digest checks
- Existing specification/compiler/publication/photo-safety suites plus override-preservation and stale-review cases
- Browser visual/accessibility checks for kit selection, section preview and exact apply

### Dependencies and blockers

Planning dependencies: WH-089, WH-066, WH-070, WH-009, WH-010, WH-122. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/project-specification.md](../../docs/project-specification.md)
- [docs/project-specification-compiler.md](../../docs/project-specification-compiler.md)
- [docs/project-specification-storage.md](../../docs/project-specification-storage.md)
- [docs/shared-components.md](../../docs/shared-components.md)
- [docs/photos.md](../../docs/photos.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)
- [docs/plan-feature-contract.md](../../docs/plan-feature-contract.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: implementation now consumes the explicit completed shared admission handoff WH-122/#65. Full cumulative feature/collaboration acceptance remains in WH-090/#62 and WH-104; this corrects a dependency on the feature being built, not an entitlement bypass.

## WH-094 — Deliver configured Business follow-up and notification workflows

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A reviewed deterministic recipe saves a lead, notifies an approved destination and schedules follow-up with visible cancellation and recovery.

### Scope

- Compose form-to-record-to-notification and due follow-up recipes using WH-068/069 and existing D1-owned jobs
- Bind rule/template/version, event identity, recipient scope, timing and allowed actions in the configuration review
- Expose scheduled/completed/failed/cancelled/uncertain receipts; recheck rule/connection/feature authority before each unsent step
- Wire provider-backed recipes only through their accepted adapters; split workflow core, selected adapters and connected acceptance children
- Expose routine owner operations through WH-105 registered read/action bindings and WH-107/109/110 Chat/view adapters; implement domain handlers once. Feature acceptance uses the shared owner surface, with essential direct recovery/security controls retained.
- Initial automatic notifications use the approved WH-036/068 platform sender. Customer mailbox/calendar/CRM recipes require a separately supported adapter operation and reviewed rule authority; WH-096–100 owner-request consent alone never enables unattended sends or polling.

### Acceptance criteria

- [ ] Direct APIs, Chat and background work enforce shared current feature eligibility; hidden UI and forged identifiers cannot bypass the tier or tenant boundary
- [ ] Visitor/service events and schedules execute deterministically with zero maintainer inference, context, credentials or funding
- [ ] Failed/uncertain notifications never discard accepted leads or trigger blind resend
- [ ] Duplicate/out-of-order events, due-date edits, cancellation and lost acknowledgements preserve one recoverable operation identity
- [ ] Revoked rules, membership, credentials or eligibility stop unsent work while dispatched uncertainty remains visible
- [ ] Provider-backed recipes require adapter acceptance and exact rule/destination/cost review; no open relay or automatic sales campaign

### Verification

- Two-tenant form/lead/notification/reminder journey with maintainer transport disabled
- Restart, duplicate events, stale due dates, timezone boundaries, cancellation and uncertain-delivery fixtures
- Separately reviewed provider/template acceptance; ordinary local checks send no real notifications

### Dependencies and blockers

Planning dependencies: WH-093, WH-068, WH-069. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/maintenance.md](../../docs/maintenance.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-129 — Expose the directory as a content collections module

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: S.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Directory listings use the shared module envelope and lifecycle while keeping their exact draft, publication and restore reviews.

### Scope

- Wrap directories, directory_reviews and directory_exports as a content-collections instance of type directory-listing@1
- collections.readPublic through the module envelope; owner edits keep the existing review handlers
- Descriptor lifecycle hooks and export serializer matching the current directory export

### Acceptance criteria

- [ ] Public reads return only the approved snapshot; drafts and history stay owner-only
- [ ] Existing directory and history suites pass; stale configRevision and withdrawn pins refuse
- [ ] No staff editing or new collection types are added

### Verification

- node tests/directories.mjs and node tests/directory-history.mjs on local D1
- tsc for both projects

### Dependencies and blockers

Planning dependencies: WH-125. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/shared-modules.md](../../docs/shared-modules.md)
- [docs/directories.md](../../docs/directories.md)
- [src/directory.ts](../../src/directory.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-04 UTC: source and local verification only; not deployed, not accepted, issue not created or claimed from this session; WH-129 stays open until accepted. Branch c/great-curie-8ryukc (PR #160) makes the project directory the content-collections instance (directory-listing@1) without a schema change: at most one content instance per project governs the existing directories/directory_reviews/directory_exports rows. src/shared-modules/collections.ts registers collections.readPublic (target {collectionId}, read) through the shared resolver, policy table and read fence, serving only the approved snapshot via the same publicDirectory reader as /directory.json (unpublished, offline or parent-restore-invalidated is unavailable; drafts, revisions and history never appear) on the visitor origin and the owner module route. Owner edits keep the existing directory Chat reviews; no write, staff path or collection type is added. The content descriptor marks directories eligible project data with exportHook collections-directory-export-v1 (deleteHook project-cascade, restoreHook unsupported); exportCollectionSnapshot returns exportDirectory's whumpo-directory v1 document (owner, current configRevision, every activation state, withdrawn or restaged pin) and validateDirectoryExport is its import validation. Compiler identity, schema inputs and module pins unchanged. Conservative default: the public site routes /directory and /directory.json keep serving without an instance (requiring activation would gate the free directory behind core.editing; owner decision). Verified: tests/shared-modules-collections.mjs (SQLite and --d1, 7 groups), tests/directories.mjs and tests/directory-history.mjs (local D1), shared-modules-registry/access/records/files (SQLite and --d1), shared-modules-contract, tools/safety-hold-inventory.mjs, pnpm check, verify fast/protection, pnpm build. Remaining: custom-domain directory paths, a lifecycle restore/import hook, the site-route decision; deploys only with the owner-run empty-database cutover that the module registry needs.

## WH-154 — Freeze the shared notification contract and decompose WH-068

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **ready**. Kind: decision. Size: S.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Every WH-068 slice builds against one frozen template, sender, recipient-scope, consent, receipt-state and review model instead of inventing its own.

### Scope

- Freeze the versioned template shape (closed segments, typed variables, fixed platform links, plain text), the verified sender catalog and provider review/price/ceiling facts
- Freeze recipient scopes derived from server-side records (owner destination, current opted-in staff, verified consenting submitter), consent/preferences, receipt states, delivery events and bounded unknown-outcome reconciliation
- Map the existing WH-036 contact notification source onto the contract with exact gaps; express the standard appointment-request receipt and staff notice as configuration
- Evaluate provider options with dated official sources; add an offline reference and mutation-checked conformance harness without Worker imports

### Acceptance criteria

- [ ] docs/notifications.md states the frozen shapes, authority class, secret custody, review gates, failure isolation, existing-source gap map and child slices, marked planned
- [ ] Offline checks reject unknown versions/fields, caller-supplied recipients/URLs/headers, unverified senders, template injection, unpriced or unreviewed charges and redispatch after a lost response, and prove bounce, cancellation and accepted-record isolation
- [ ] The catalog reproduces the existing contact notices byte for byte and agrees with the WH-036 sender, ceiling, error classes and outbox states
- [ ] WH-068 keeps its acceptance and depends on every child; no child reaches WH-069, WH-080 or WH-094
- [ ] Open owner decisions are listed rather than assumed

### Verification

- node tests/notifications-contract.mjs
- node tools/verify.mjs fast
- node tools/roadmap.mjs validate, alignment and render --check
- git diff --check

### Dependencies and blockers

Planning dependencies: WH-052, WH-123. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/notifications.md](../../docs/notifications.md)
- [tools/prototypes/notifications.mjs](../../tools/prototypes/notifications.mjs)
- [tests/notifications-contract.mjs](../../tests/notifications-contract.mjs)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [docs/job-envelope.md](../../docs/job-envelope.md)
- [docs/shared-modules.md](../../docs/shared-modules.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-08 UTC: contract and offline reference only, local commit on branch claude/wh-068-notification-contract (not pushed or merged; issue not created or claimed from this session). Added docs/notifications.md (planned), tools/prototypes/notifications.mjs (imports only node:crypto) and tests/notifications-contract.mjs, registered as pnpm test:notifications-contract and in the fast verification profile. node tests/notifications-contract.mjs passed 31 reference checks and 6 source-agreement/static checks, and caught 20 of 20 deliberate mutants of the reference, each by its intended check. Synthetic identifiers, addresses and provider only; proves the frozen contract and reference, not D1 storage, provider delivery, consent flows or acceptance. Provider facts read from official pages on October 8, 2026; entitlement and pricing require verification. No table, route, binding, provider, DNS or deployment change.

## WH-155 — Source notification catalog and renderer with contact notices expressed through it

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Templates, senders and provider facts come from one server catalog with closed validators and a plain-text renderer, and the existing contact notices render through it unchanged.

### Scope

- TypeScript catalog matching the frozen v1 shapes: template entries with digests, the verified platform sender with its DNS review reference, provider review/price/ceiling/idempotency/lookup facts and error classes (gaps G-N1 to G-N3)
- Closed template/configuration validators and the segment renderer; replace the hard-coded contactEmailMessage text with catalog rendering
- Point the conformance harness agreement checks at the source catalog; no schema change, provider, binding or customer-visible change

### Acceptance criteria

- [ ] Contact new-message and verification notices are byte-identical to the current text; existing contact suites pass unchanged
- [ ] No configuration, template or caller value can supply an address, header, URL, provider or credential
- [ ] No new provider, sender, binding, cron, DNS change or schema change

### Verification

- pnpm check
- pnpm test:contacts
- node tests/notifications-contract.mjs

### Dependencies and blockers

Planning dependencies: WH-154. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/notifications.md](../../docs/notifications.md)
- [tools/prototypes/notifications.mjs](../../tools/prototypes/notifications.mjs)
- [src/contact-email.ts](../../src/contact-email.ts)
- [src/contact-notifications.ts](../../src/contact-notifications.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-156 — Shared notification outbox, receipt states and bounded reconciliation

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Every notice kind uses one durable outbox with the frozen receipt states, at-most-once provider calls, bounded read-only reconciliation and one spending ledger per provider.

### Scope

- Generalize the contact outbox to queued, dispatching, deferred, accepted, delivered, unknown-outcome, unresolved, bounced, complained, failed and cancelled with database-enforced transitions (gap G-N4); build on the durable-dispatch prerequisite if owner PR #174 is merged, never duplicate it
- One ledger and ceiling per provider across all notice kinds (G-N5); an authenticated provider event-intake interface without activating Queues (G-N6)
- Reconcile the attempt bound with the WH-052 envelope maxAttempts rule by a reviewed contract change or envelope-per-attempt design (G-N10)
- Complete current schema with lifecycle/export/closure registration and an owner-run empty-database cutover; no compatibility reader

### Acceptance criteria

- [ ] A lost response, thrown call or interrupted worker becomes unknown-outcome and is never redispatched; reconciliation is read-only and ends unresolved at its bound
- [ ] Duplicate and out-of-order events, replays and concurrent passes keep one notice per recipient and event
- [ ] Notification failures never alter or remove the accepted record or inbox message; unresolved evidence outlives ordinary expiry
- [ ] Every provider call counts against the ceiling before the call

### Verification

- pnpm check
- pnpm test:contacts
- node tests/notifications-contract.mjs
- Focused outbox suite on SQLite and local D1 with a simulated provider

### Dependencies and blockers

Planning dependencies: WH-155, WH-052. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/notifications.md](../../docs/notifications.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [docs/job-envelope.md](../../docs/job-envelope.md)
- [schema/platform.sql](../../schema/platform.sql)
- [src/contact-notifications.ts](../../src/contact-notifications.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-157 — Notification recipient scopes, consent and preferences

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Staff and submitters can receive notices only through server-resolved, verified and consented addresses that are rechecked before every call.

### Scope

- Staff notification opt-in, address verification and opt-out on the visitor origin through the same provider and sender; role revocation stops unsent notices (gap G-N7)
- Verified project-visitor address and an explicit per-submission receipt consent stored with the record; anonymous typed addresses are never recipients
- Shared per-account suppression across scopes and templates; new data classes registered with lifecycle, export and closure

### Acceptance criteria

- [ ] Recipients derive only from current records; caller, configuration and visitor input cannot add an address
- [ ] Revoked, opted-out, unverified or suppressed recipients are cancelled before any provider call
- [ ] Two-tenant and cross-origin isolation for staff and visitor addresses

### Verification

- pnpm check
- node tests/shared-modules-access.mjs
- node tests/notifications-contract.mjs
- node tests/lifecycle-catalog.mjs

### Dependencies and blockers

Planning dependencies: WH-155, WH-126, WH-116. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/notifications.md](../../docs/notifications.md)
- [docs/shared-modules.md](../../docs/shared-modules.md)
- [docs/data-protection.md](../../docs/data-protection.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-158 — Customer notification configuration and standard appointment presets

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An owner configures the standard appointment-request receipt and staff notice through an exact review, and accepted form records trigger them deterministically.

### Scope

- Store notification configurations bound to a records instance form.accepted event; the exact owner review binds template digest, sender, recipient scope, limits and provider price (gap G-N8)
- Implement the approved-configuration resolver for the fixed form.accepted trigger under the WH-052 envelope; WH-069 later reuses it rather than adding a second resolver
- Register Chat/view bindings and an essential dashboard control through WH-105 with WH-122 feature admission; ship the standard appointment presets as configuration

### Acceptance criteria

- [ ] Submission and notification delivery never invoke the maintainer model, its context, credentials or funding
- [ ] The model may prepare but cannot confirm a configuration; a changed price, template or configuration makes the review stale
- [ ] Configuring provisions no sender, DNS record, provider or schedule
- [ ] Owner and staff notices stay content-free; submitter receipts carry only choice/number/boolean values and the reference

### Verification

- pnpm check
- node tests/shared-modules-records.mjs
- node tests/notifications-contract.mjs

### Dependencies and blockers

Planning dependencies: WH-156, WH-157, WH-127, WH-105, WH-122. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/notifications.md](../../docs/notifications.md)
- [docs/shared-modules.md](../../docs/shared-modules.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)
- [docs/feature-admission.md](../../docs/feature-admission.md)
- [src/shared-modules/records.ts](../../src/shared-modules/records.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-159 — Connected synthetic acceptance of configured notifications

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A local two-tenant appointment journey proves configured notifications end to end on the actual handlers with the maintainer transport disabled.

### Scope

- Two synthetic tenants: appointment form to record to staff notice, owner notice and submitter receipt on SQLite and local D1 with a simulated provider
- Duplicate events, timeout/bounce, lost response, revoked recipient, cancellation, ceiling, template withdrawal and accepted-record isolation against the D1 handlers
- Run the contract conformance scenarios against the implementation, not only the reference

### Acceptance criteria

- [ ] Every WH-068 acceptance criterion has local synthetic evidence on the actual handlers
- [ ] No real message, provider call, DNS change or deployment; local evidence is not live acceptance

### Verification

- Connected notification suite on SQLite and local D1
- pnpm test:contacts
- node tools/verify.mjs fast

### Dependencies and blockers

Planning dependencies: WH-158. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/notifications.md](../../docs/notifications.md)
- [tests/notifications-contract.mjs](../../tests/notifications-contract.mjs)
- [tests/contact-notifications.mjs](../../tests/contact-notifications.mjs)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-160 — Approved provider canary for configured notifications

Phase: **Configuration and shared capabilities** (F5). Priority: **P1**. Planning readiness: **blocked**. Kind: verification. Size: S.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Configured notifications are proven against the real reviewed provider using only explicitly approved addresses.

### Scope

- Exact sender/recipient and cost review before any send; canary only to owner-approved addresses
- Record provider readback, receipt states and spend; raise template readiness only from this evidence

### Acceptance criteria

- [ ] Canary messages reach only approved addresses with correct receipts and no duplicate on lost responses
- [ ] Provider charges stay within the reviewed ceiling; no service, DNS or plan change beyond the reviewed activation

### Verification

- Approved provider canary with readback recorded in the feature doc and issue

### Dependencies and blockers

Planning dependencies: WH-159, WH-036. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Owner decisions in docs/notifications.md: provider, sender domain/display name, retention, submitter receipts, plan gating and spending ceiling
- WH-036 sender activation and its live canary to explicitly approved addresses

### References

- [docs/notifications.md](../../docs/notifications.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-079 — Design optional customer-configured runtime AI as a separate capability

Phase: **Configuration and shared capabilities** (F5). Priority: **P2**. Planning readiness: **deferred**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A customer may later connect their own AI provider or a separately exposed Cloudflare AI capability without giving visitors access to Whumpo maintenance inference.

### Scope

- Define explicit per-project opt-in for customer-owned provider access or an exposed Gateway/Workers AI route
- Use dedicated project-scoped adapters, credentials, model configuration, identity/permissions, budgets, data-use terms and receipts
- Specify customer request/response handling separately from Whumpo owner conversation, prompts, tools and memory
- Keep this outside default deterministic capability delivery and select implementation only after customer demand

### Acceptance criteria

- [ ] Visitor and service calls cannot use Whumpo maintainer credentials, context, tools, premium wallet or implicit provider fallback
- [ ] Customer credentials remain server-side; an exposed Gateway is not itself a free model or funded inference entitlement
- [ ] Disabled/unconfigured/exhausted runtime AI fails explicitly without waking the owner maintainer
- [ ] Rate/abuse/concurrency controls and cost caps bound visitor exposure; owner receives a concrete provider/data/cost review
- [ ] Customer AI requests cannot gain publication, infrastructure, ownership or maintenance authority through this extension

### Verification

- Architecture/credential/budget separation review with negative route and configuration cases
- Synthetic disabled/exhausted/forged-project tests with zero maintainer dispatch
- No live provider activation or visitor AI endpoint in this decision task

### Dependencies and blockers

Planning dependencies: WH-065, WH-071, WH-075. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/composition-architecture.md](../../docs/roadmap/composition-architecture.md)
- [docs/ai-gateway-transport.md](../../docs/ai-gateway-transport.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/backend-execution.md](../../docs/backend-execution.md)
- [wrangler.apps.jsonc](../../wrangler.apps.jsonc)
- [wrangler.runtime.jsonc](../../wrangler.runtime.jsonc)
- [docs/workload-placement.md](../../docs/workload-placement.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

# F6 — Native Android owner experience

A native Kotlin/Compose owner app delivers reliable Chat, project reviews, photos, sharing and push to an invited Android beta. Foundations proceed alongside the web roadmap; customer admission inherits WH-048 and Android device, signing, provider and release acceptance.

## WH-081 — Define Android owner journeys and freeze the native API contract

Phase: **Native Android owner experience** (F6). Priority: **P1**. Planning readiness: **ready**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Android implementers have a source-grounded v1 operation contract and a bounded native owner beta without duplicating platform authority.

### Scope

- Refine docs/android-app.md against current source and live issue/dependency evidence; map every admitted operation to an existing domain handler or explicit new adapter
- Freeze /api/mobile/v1 routes, typed requests/responses, sanitized fixtures, error/pagination/revision behavior, supported review controls and strict current-client admission
- Specify Credential Manager identity, bearer-session lifecycle, PKCE browser returns, onboarding and preview handoffs while preserving web Origin protections
- Define Kotlin/Compose with a recorded current Android/API matrix, Chat-first surfaces, photos/sharing/push, protected retry state and the beta evidence matrix; no old-platform shims
- Adopt WH-105 current-version-only interactions and Chat-primary navigation; unsupported versions/forms/views reject explicitly, with no browser downgrade
- Consume the shared workspace identity policy, two-key completion state and restricted recovery authority; remove password fallback from the native/browser contract

### Acceptance criteria

- [ ] Each first-beta journey has native/browser ownership, an authoritative server contract, failure/readback behavior and an evidence requirement
- [ ] Only server-issued typed metadata can expose native approval; unknown controls reject with update-required and no approval or browser downgrade
- [ ] Session expiry, revocation, recovery and recent-authentication rules cover native and browser clients without granting authority from a package header or absent Origin
- [ ] WH-048 remains a prerequisite for Android customer admission, not a dependency on Android for the web beta
- [ ] Full offline sync, iOS, generated customer Android apps, public distribution and full workspace parity remain deferred; real-money and CMS testing gates remain explicit
- [ ] Incomplete signup/recovery cannot exchange into ordinary native access; web and native adapters use the same policy without requiring the Android shell to wait for the web implementation

### Verification

- Trace the operation matrix against src/index.ts, src/workspace-identity/ceremonies.ts, src/chat-controls.ts and the current feature contracts
- Review sanitized API examples for ownership, replay, stale-state and unsupported-client rejection without real credentials or provider calls
- Run roadmap validate, render, render --check and git diff --check; verify local references

### Dependencies and blockers

Planning dependencies: WH-105, WH-113. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/android-app.md](../../docs/android-app.md)
- [docs/natural-language-chat.md](../../docs/natural-language-chat.md)
- [docs/owner-recovery.md](../../docs/owner-recovery.md)
- [docs/onboarding.md](../../docs/onboarding.md)
- [docs/photos.md](../../docs/photos.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [src/index.ts](../../src/index.ts)
- [src/chat-controls.ts](../../src/chat-controls.ts)
- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)
- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/workspace-identity.md](../../docs/workspace-identity.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)
- [docs/mobile-api-v1.md](../../docs/mobile-api-v1.md)
- [tools/prototypes/mobile-v1.mjs](../../tools/prototypes/mobile-v1.mjs)
- [tests/mobile-v1-contract.mjs](../../tests/mobile-v1-contract.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/117. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-09-30: docs/android-app.md records the accepted product/architecture baseline and current service mapping against f90bf5f plus the working tree. Exact v1 wire contracts and native implementation acceptance remain this lane's future work; no Android execution issue or release is claimed.
- 2026-10-01 WH-120 amendment: active planning now requires current-only admission, reviewed obsolete-test resets and forward repair. Legacy identity stages, old-client/module coexistence and old-runtime rollback are not implementation requirements. This is documentation alignment only, not implementation, policy activation or device acceptance.
- 2026-10-04: docs/mobile-api-v1.md freezes the /api/mobile/v1 contract (34 operations mapped to existing handlers or declared new adapters, native bearer/handoff/revocation model, client_update_required admission, four admitted review controls, idempotency, pagination, exclusions, journey/evidence matrix and source gaps) against b4671f9, with synthetic fixtures and an offline contract test. docs/android-app.md is refreshed against current source. Planned only: no mobile route, native session, Android code, FCM adapter or device acceptance. Owner decisions (minimum Android version, Play distribution/identity, Play Integrity, session cap, native take-down, push default, stale-client status code) are listed in the contract. Live issue/dependency state was not re-checked offline.

## WH-082 — Build the native Android foundation and reproducible checks

Phase: **Native Android owner experience** (F6). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A maintained Kotlin/Compose application shell can be built, navigated and tested reproducibly without live customer services.

### Scope

- Create android/ with a pinned compatible Gradle/Kotlin/Compose/JDK toolchain, API 28 minimum and documented local build commands
- Implement Whumpo branding and accessible Chat, Projects, Activity and Settings navigation using ViewModels and repositories
- Separate loopback development from the deployed test environment; add Keystore-protected account-scoped state and backup exclusions
- Add focused Android build/lint/unit/instrumentation checks with no paid CI activation or secret-bearing fixtures

### Acceptance criteria

- [ ] A clean checkout produces the documented debug artifact and tests using the pinned toolchain; Node 24/pnpm 11 workflows remain separate
- [ ] Navigation, large text, TalkBack semantics, keyboard insets and configuration changes work in the selected emulator matrix
- [ ] Draft/session/pending-operation storage is account-scoped and cleared on logout/account change; credentials never enter logs, backups or fixtures
- [ ] Local connectivity uses loopback or device forwarding and does not expose the development server publicly
- [ ] A working shell or emulator pass is not reported as native identity, provider, signed-release or physical-device acceptance

### Verification

- Run the documented Android assemble, lint, unit and focused instrumentation commands on a clean local fixture
- Exercise navigation, rotation/process recreation, account-state clearing and protected-storage backup exclusions
- Review CI permissions and free-tier limits; record unavailable emulator/device checks explicitly

### Dependencies and blockers

Planning dependencies: WH-081. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/android-app.md](../../docs/android-app.md)
- [docs/brand/whumpo-identity.md](../../docs/brand/whumpo-identity.md)
- [docs/verification.md](../../docs/verification.md)
- [AGENTS.md](../../AGENTS.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-083 — Implement native identity, versioned API access and browser returns

Phase: **Native Android owner experience** (F6). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An Android owner can authenticate and reach supported platform services through a bounded native contract while web identity and review authority remain intact.

### Scope

- Add /api/mobile/v1 adapters and shared authenticated owner/session context over the existing domain handlers, with typed Kotlin/TypeScript contracts
- Implement native passkey challenge/verification and current-credential session issuance with approved RP/signing origins and verified App Links
- Implement one-time PKCE S256 browser-return exchange for completed passkey signup, welcome and completed restricted recovery with bound state/account/redirect/expiry; no password fallback
- Reuse authoritative revocation, seven-day expiry and ten-minute recent-authentication rules; extend the complete current schema and initialize disposable current fixtures or a reviewed empty test database, without numbered migration replay or old readers
- Separate native bearer and browser cookie admission without weakening existing Origin, rate-limit, onboarding or tenant guards

### Acceptance criteria

- [ ] Wrong origin/RP/signature, missing user verification, replayed or expired challenges, and credentials revoked during login cannot issue a session
- [ ] Browser return replay, wrong PKCE verifier/state/account/redirect and expired codes fail; old authentication is not made fresh by exchanging a code
- [ ] Account recovery/passkey removal invalidates native sessions as well as browser sessions; retained trusted credentials and save-before-rotation recovery-kit behavior remain correct under the shared restricted recovery contract
- [ ] Only the closed supported native operation set is reachable; cookie-authenticated browser mutations still require valid Origin
- [ ] Local/disposable identity and contract tests pass before approved signed-app/device verification; mobile secrets never appear in URLs, logs, model context or generated content
- [ ] Older supported v1 clients remain compatible; unknown controls have no approval and retired clients retain browser support/recovery access
- [ ] One-key signup and incomplete recovery cannot issue or exchange a normal native session; lost-all-keys recovery requires two replacement passkeys and fresh passkey verification before handoff

### Verification

- Run pnpm check and the existing test:identity-recovery, test:identity-ceremonies and test:onboarding-welcome suites after inspecting their setup
- Add connected two-owner native identity/API fixtures covering challenge, PKCE, session/recovery races, Origin regression and recent-authentication boundaries
- Run Kotlin DTO/transport tests against the same sanitized fixtures; record signed App Link/passkey evidence separately from emulators

### Dependencies and blockers

Planning dependencies: WH-081, WH-115. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Real app association requires a verified package/signing identity and approved Digital Asset Links configuration; synthetic assertions cannot establish that acceptance.

### References

- [docs/android-app.md](../../docs/android-app.md)
- [docs/owner-recovery.md](../../docs/owner-recovery.md)
- [docs/onboarding.md](../../docs/onboarding.md)
- [docs/security-risk-actions.md](../../docs/security-risk-actions.md)
- [src/index.ts](../../src/index.ts)
- [src/workspace-identity/ceremonies.ts](../../src/workspace-identity/ceremonies.ts)
- [src/security.ts](../../src/security.ts)
- [schema](../../schema)
- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)
- [docs/workspace-identity.md](../../docs/workspace-identity.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-02 UTC: removed stale numbered-additive-migration wording from active scope to match WH-120 and the complete-current-schema contract. Implementation uses current fixtures/reviewed empty test databases. Feature scope, dependencies and acceptance remain unchanged; this amendment does not implement the feature.

## WH-084 — Deliver the native Chat, project and explicit-review journey

Phase: **Native Android owner experience** (F6). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An owner completes a supported project change and explicit review from Android, with honest server state and recoverable interrupted requests.

### Scope

- Implement native natural-language Chat/history, owned project details/status, Activity and supported review presentations
- Deliver exact static/photo publication and restore plus bounded application activation controls using existing server-issued review authority
- Persist protected drafts and original submitted request IDs/payloads; read committed results before explicit same-ID retry
- Open authenticated website previews and unsupported workflows in allowlisted Custom Tabs without transferring native bearer credentials
- Render the admitted native subset of durable interaction definitions, answers and receipts from WH-106; keep Projects/Activity supporting Chat and preserve protected draft recovery

### Acceptance criteria

- [ ] A disposable owner can request a change, inspect the current result and explicitly approve an eligible immutable review end to end
- [ ] Two-owner isolation, expected revisions, expiry, recent sign-in and publication/activation safety gates apply identically through native adapters
- [ ] Lost responses, duplicate taps, process death and reconnect do not duplicate inference or reviewed effects; changed payloads cannot reuse a committed ID
- [ ] Unknown review types, unavailable inference and interrupted server execution show actionable incomplete states rather than fabricated success
- [ ] Browser previews retain ownership and safety checks; missing browser authentication prompts sign-in and generated customer code never runs in the native app
- [ ] Onboarding/support/recovery remain reachable when workspace admission fails; backgrounding or a notification never grants approval
- [ ] Unknown/noncurrent interaction schemas reject explicitly without a compatibility summary or browser downgrade; current trusted handoff returns read state without duplicate submission or approval

### Verification

- Run Android repository/ViewModel and focused connected UI tests with disposable accounts, synthetic model responses and forced process/network interruptions
- Run pnpm check when adapters change, node tests/natural-chat.mjs and focused test:chat-delivery, test:chat-history, test:customer-site-journey and test:app-activation-http checks
- Exercise stale/concurrent/foreign reviews and browser preview handoffs; physical-device and real-model acceptance remain separately recorded

### Dependencies and blockers

Planning dependencies: WH-082, WH-083, WH-106. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/android-app.md](../../docs/android-app.md)
- [docs/natural-language-chat.md](../../docs/natural-language-chat.md)
- [docs/photo-publication-plan.md](../../docs/photo-publication-plan.md)
- [docs/app-data.md](../../docs/app-data.md)
- [src/chat-controls.ts](../../src/chat-controls.ts)
- [src/chat-review-receipts.ts](../../src/chat-review-receipts.ts)
- [frontend/src/lib/chat-delivery.ts](../../frontend/src/lib/chat-delivery.ts)
- [src/project-details.ts](../../src/project-details.ts)
- [docs/roadmap/chat-first-experience.md](../../docs/roadmap/chat-first-experience.md)
- [docs/chat-interactions.md](../../docs/chat-interactions.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-085 — Add explicit Android photo and share intake with upload recovery

Phase: **Native Android owner experience** (F6). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Owners intentionally bring supported photos, text and links into an owned project without automatic sends, lost retry bytes or weakened safety holds.

### Scope

- Implement the system photo picker/document fallback and bounded incoming share intents with explicit project selection and submission
- Match existing admitted formats, input/output bounds, orientation/resize/JPEG preparation and server metadata stripping
- Persist exact protected prepared bytes, filename and upload ID across interruption; release temporary files/URI grants on completion or logout
- Present storage and safety states separately and preserve private file/version/publication rules

### Acceptance criteria

- [ ] A share intent never sends Chat, fetches a URL, uploads, invokes AI or publishes until the owner explicitly submits the selected content
- [ ] Interrupted uploads retry the same bytes/name/ID; unsupported, oversized, malformed, foreign-project and conflicting-ID inputs fail safely
- [ ] Held/blocked media is neither rendered nor attached/published; a successful storage response is never presented as safety clearance
- [ ] Quota and retained-version rules remain enforced; logout/account change purges local private upload material
- [ ] Local synthetic photo acceptance is recorded separately from WH-017/048 real safety/provider/customer acceptance

### Verification

- Run Android picker/share/preparation tests for URI grants, byte bounds, orientation, process death, denied/cancelled selection and cleanup
- Run pnpm check if adapters change and focused test:files, test:photo-versions and safety-result fixtures after verifying local setup
- Exercise two-owner upload/read isolation and held media in connected fixtures; no real customer upload or scanner activation by implication

### Dependencies and blockers

Planning dependencies: WH-084. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/android-app.md](../../docs/android-app.md)
- [docs/photos.md](../../docs/photos.md)
- [docs/photo-publication-plan.md](../../docs/photo-publication-plan.md)
- [docs/safety-coverage.md](../../docs/safety-coverage.md)
- [src/files.ts](../../src/files.ts)
- [src/photo-safety.ts](../../src/photo-safety.ts)
- [src/photo-scan-results.ts](../../src/photo-scan-results.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-086 — Deliver bounded owner push notifications through FCM

Phase: **Native Android owner experience** (F6). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Opted-in owners receive privacy-preserving notices about committed work and can safely reopen its current state without triggering any project action.

### Scope

- Implement owner/device registration and preferences with token rotation, permission denial, revocation, logout and invalid-token cleanup
- Derive completion, attention-required failure and pending-review events from committed receipts and recover the commit-to-outbox gap idempotently
- Implement an FCM HTTP v1 Worker adapter and D1-owned bounded dispatch following WH-052, with fairness, expiry, fencing and uncertain-result handling
- Add generic notification copy, opaque event destinations, authenticated current-state readback and sanitized operational diagnostics
- Use the shared WH-052 job/outbox and WH-075 admission contract with an FCM adapter. Delivery identity and unknown-result recovery must not introduce a second notification scheduler; web/native account authority remains shared.

### Acceptance criteria

- [ ] Dispatch rechecks owner/session registration, preferences and event relevance; no message text, project names, source, photos or credentials enter notification payloads
- [ ] Duplicate, delayed, expired, revoked-device and wrong-account events cannot disclose private details or repeat an underlying operation
- [ ] Lost acknowledgements retain uncertain evidence instead of blind redispatch; FCM acceptance is not represented as device display or exactly-once delivery
- [ ] Permission denial or absent Play services leaves core workflows usable through Activity and ordinary reads
- [ ] Push and dispatcher execution make zero maintainer/model calls and never approve reviews or restart project work
- [ ] Local dispatch fixtures, configured FCM, physical delivery and measured latency/cost are separate evidence; no new paid service, plan upgrade or schedule is activated without its review

### Verification

- Run pnpm check and connected D1/Worker fixtures for event/outbox recovery, token ownership, lease races, timeout uncertainty, expiry, fairness and cancellation
- Run Android permission/token/deep-link tests with sanitized messages, including account change and deleted destinations
- After exact activation review, measure real signed-device delivery and supporting Worker/D1 costs; never close provider/device acceptance using mocks

### Dependencies and blockers

Planning dependencies: WH-083, WH-084, WH-052, WH-075. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Configured FCM project/sender permissions and real device delivery are unverified; activation needs the exact credential, privacy and dispatcher latency/cost review.

### References

- [docs/android-app.md](../../docs/android-app.md)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [docs/maintenance.md](../../docs/maintenance.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [src/index.ts](../../src/index.ts)
- [wrangler.jsonc](../../wrangler.jsonc)
- [docs/roadmap/alignment.md](../../docs/roadmap/alignment.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-087 — Accept and distribute a bounded private Android beta

Phase: **Native Android owner experience** (F6). Priority: **P1**. Planning readiness: **blocked**. Kind: release. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Invited owners receive a signed, supported Android beta backed by actual device, provider, privacy, safety and release-recovery evidence.

### Scope

- Prepare signed AAB distribution through Google Play internal testing with private signing custody and current target-SDK/store checks
- Exercise the recorded current Android matrix on physical Pixel and Samsung devices, including passkeys, recovery, TalkBack, large text, keyboard, backgrounding and upgrades
- Bind acceptance to the app artifact/signing identity and backend release/schema; record configured, local, device and customer evidence separately
- Rehearse native-work halt, session revocation, current backend forward repair and higher-version app recovery with accessible web support
- Admit only WH-048-approved paths/cohort with current photo-safety, inference privacy, support ownership and measured notification delivery
- Accept the shared two-key signup/recovery policy through browser handoff, accessible recovery-kit save/print and returning native passkey login without routine extra unlock prompts

### Acceptance criteria

- [ ] A real invited disposable owner completes the supported change/review/recovery journey on the recorded physical-device matrix
- [ ] All required safety, identity, lifecycle and provider gates match the candidate app/backend release; no critical boundary failure is waived by internal testing
- [ ] Permission denial, lost connectivity, upgrade and stale app versions preserve support/recovery and cannot bypass review authority
- [ ] Release stop/recovery is demonstrated without assuming Play instantly downgrades installed apps; signing keys and user content stay out of evidence/logs
- [ ] Named support owner, cohort/data scope, stop conditions and sanitized diagnostics exist before invitations; no public-store or full-MVP acceptance claim
- [ ] Recorded real-device identity evidence includes the required distinct-key/provider combinations and incomplete-recovery handoff refusal; visitor-app policy is unaffected

### Verification

- Run the documented Android build/lint/unit/instrumentation checks and the focused backend regression profiles for the candidate release
- Record real passkey/Turnstile, signed App Link, photo-clearance and FCM journeys with disposable reviewed identities
- Run current app/backend admission and forward-recovery drills; compare the evidence matrix with WH-048 before distribution

### Dependencies and blockers

Planning dependencies: WH-084, WH-085, WH-086, WH-048. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Google Play developer-account ownership, package identity, signing custody and approved app association require verification before signed distribution.
- Physical Pixel/Samsung devices, approved disposable identities, real FCM and photo-safety acceptance, and an explicitly admitted Android cohort are required.

### References

- [docs/android-app.md](../../docs/android-app.md)
- [docs/acceptance.md](../../docs/acceptance.md)
- [docs/releases.md](../../docs/releases.md)
- [docs/owner-recovery.md](../../docs/owner-recovery.md)
- [docs/safety-coverage.md](../../docs/safety-coverage.md)
- [docs/customer-benchmarks.md](../../docs/customer-benchmarks.md)
- [docs/roadmap/README.md](../../docs/roadmap/README.md)
- [docs/roadmap/identity-and-data-protection.md](../../docs/roadmap/identity-and-data-protection.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-10-01 WH-120 amendment: active planning now requires current-only admission, reviewed obsolete-test resets and forward repair. Legacy identity stages, old-client/module coexistence and old-runtime rollback are not implementation requirements. This is documentation alignment only, not implementation, policy activation or device acceptance.

## WH-088 — Prioritize native expansion and review public Android distribution

Phase: **Native Android owner experience** (F6). Priority: **P2**. Planning readiness: **deferred**. Kind: decision. Size: M.

Reviewed: 2026-10-01. Source baseline: `db8b740ab2346f55f2985593b1ec531a99027630`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Evidence from the private beta determines the next native workflows and whether Whumpo is ready for a separately reviewed public Play release.

### Scope

- Review measured completion, recovery, accessibility, support and native/browser handoff friction before selecting broader native coverage
- Recheck current Play testing, target-SDK, privacy/data safety, account-deletion, content and any applicable billing policies for a concrete public release
- Create bounded follow-on packets for justified features and required external prerequisites; retain current-client admission and forward release recovery
- Keep iOS, full offline synchronization, generated customer Android apps and full workspace parity outside automatic expansion

### Acceptance criteria

- [ ] Each promoted feature has customer evidence, scoped implementation/verification, costs and activation boundaries
- [ ] A public-distribution recommendation names unresolved policy/provider/account/operational gates and cannot rely only on internal-test acceptance
- [ ] No payment provider, purchase, CMS testing, new platform or customer code distribution is activated by this decision
- [ ] Public release and any commercial scope receive their own accepted plan; earlier private beta evidence retains its original limits

### Verification

- Review sanitized beta outcomes and the current official Play requirements with dated sources
- Validate any new roadmap packets and dependencies; no provider mutation or store publication in this decision task

### Dependencies and blockers

Planning dependencies: WH-087. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/android-app.md](../../docs/android-app.md)
- [docs/roadmap/README.md](../../docs/roadmap/README.md)
- [docs/data-lifecycle.md](../../docs/data-lifecycle.md)
- [docs/payments.md](../../docs/payments.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.
