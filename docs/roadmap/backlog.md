# Whumpo implementation backlog

> Generated from `backlog.json` by `node tools/roadmap.mjs render`. Edit the JSON source, then render again.

Reviewed 2026-09-30 against source `05443262a88b658c8d72460a75b28facacabec4f`. 63 planned tasks.

Planning readiness and dependencies describe the plan. Current execution, claims, blockers, and completion evidence live in GitHub Issues. A ready task is only a candidate: verify live dependency completion and authorization before work.

Read the [execution contract](execution.md). Use `node tools/roadmap.mjs next` for candidates and `node tools/roadmap.mjs show WH-001` for an issue body.

# F0 — Reliable delivery foundation

A current evidence baseline and repeatable release, verification and operational controls.

## WH-001 — Reconcile current capability and acceptance evidence

Phase: **Reliable delivery foundation** (F0). Priority: **P0**. Planning readiness: **ready**. Kind: verification. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/3. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-002 — Extend release manifests and rehearse partial deployment recovery

Phase: **Reliable delivery foundation** (F0). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An operator can recover from a partial four-Worker release without losing CMS bindings or assuming Worker rollback reverses schema.

### Scope

- Build on committed source/build snapshot guards
- Record four Worker versions, asset/source digests, migration set and CMS binding inventory
- Define forward/backward schema compatibility and partial-release recovery

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

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-003 — Define focused verification profiles and optional free-tier CI

Phase: **Reliable delivery foundation** (F0). Priority: **P0**. Planning readiness: **ready**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/4. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-004 — Audit current tenant and privileged-action boundaries

Phase: **Reliable delivery foundation** (F0). Priority: **P0**. Planning readiness: **ready**. Kind: verification. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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
- [migrations](../../migrations)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/5. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-006 — Add privacy-safe operational health and maintenance diagnostics

Phase: **Reliable delivery foundation** (F0). Priority: **P0**. Planning readiness: **ready**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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
- [src/usage-recovery.ts](../../src/usage-recovery.ts)
- [src/standard-ai-recovery.ts](../../src/standard-ai-recovery.ts)
- [docs/deployment.md](../../docs/deployment.md)
- [docs/usage-recovery.md](../../docs/usage-recovery.md)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/6. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-052 — Choose durable job orchestration from current requirements

Phase: **Reliable delivery foundation** (F0). Priority: **P1**. Planning readiness: **ready**. Kind: decision. Size: S.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Background safety, cleanup and notification work gets one justified durable execution approach.

### Scope

- Compare existing D1/cron receipts with Cloudflare Queues and Workflows for concrete job classes
- Document at-least-once delivery, retries, idempotency, dead letters, cancellation and unknown external outcomes
- Prepare an ADR with cost/entitlement verification and a small synthetic prototype plan

### Acceptance criteria

- [ ] Selected design preserves existing immutable receipts and does not assume exactly-once external effects
- [ ] Polling cost, latency, throughput, retention and operator recovery are explicit
- [ ] No service is provisioned by the decision document
- [ ] Use simpler existing machinery if it meets measured requirements

### Verification

- Read official Cloudflare delivery/retry/pricing docs as of execution date
- Trace two jobs: uncertain scan response and resumable account cleanup
- No provider calls required

### Dependencies and blockers

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/cloudflare-capability-roadmap.md](../../docs/cloudflare-capability-roadmap.md)
- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/account-closure.md](../../docs/account-closure.md)
- [src/index.ts](../../src/index.ts)
- [docs/background-jobs.md](../../docs/background-jobs.md)
- [tools/prototypes/job-journal.mjs](../../tools/prototypes/job-journal.mjs)
- [tests/job-journal-prototype.mjs](../../tests/job-journal-prototype.mjs)

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/11. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-09-30 source/local evidence: docs/background-jobs.md selects D1-owned receipts and bounded scheduled passes initially, with dated provider cost/retry/retention comparison. File-backed SQLite prototype tests pass for uncertain scans and resumable cleanup; production D1 integration, connected load evidence and provider/operator activation remain separate gates. No new service or schedule enabled.

# F1 — Safe customer beta

Operated safety, privacy, identity, recovery and lifecycle for explicitly supported customer journeys.

## WH-005 — Accept owner and visitor identity on physical devices

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **blocked**. Kind: verification. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Actual customers can enroll, return, recover and revoke credentials across supported devices.

### Scope

- Prepare a desktop/mobile browser matrix and disposable invited identities
- Exercise native owner and visitor passkeys plus human Turnstile
- Include all/some/none lost-key recovery and response-loss guidance

### Acceptance criteria

- [ ] Device, OS, browser, date and identity type are recorded for each result
- [ ] Old sessions and selected lost credentials fail after recovery; retained credentials and saved recovery code work
- [ ] Keyboard, touch and viewport behavior are verified on actual hardware
- [ ] Do not change the owner account or real customer credentials for acceptance

### Verification

- pnpm test:owner-recovery
- pnpm test:app-auth
- Manual real-device checklist plus connected loopback baseline; live disposable account only with exact reviewed scope

### Dependencies and blockers

Planning dependencies: WH-001. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Human-operated physical desktop/mobile devices and an approved disposable live identity are required for the remaining acceptance.

### References

- [docs/owner-recovery.md](../../docs/owner-recovery.md)
- [docs/onboarding.md](../../docs/onboarding.md)
- [docs/app-data.md](../../docs/app-data.md)
- [tools/owner-recovery-browser.mjs](../../tools/owner-recovery-browser.mjs)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-007 — Write and exercise incident, spend and provider-outage runbooks

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An operator can contain an outage or cost spike while preserving receipts and customer recovery access.

### Scope

- Define incident ownership, severity, escalation and customer communication drafts
- Cover provider outage, key compromise, runaway cost, public abuse and failed maintenance
- Separate platform emergency controls from financial fair-use Monitor

### Acceptance criteria

- [ ] Each runbook has detection, containment, reconciliation, recovery and evidence steps
- [ ] Kill switches stop new risky work without erasing data or uncertain holds
- [ ] Existing paid resource authorization and new service approvals are distinct
- [ ] A tabletop drill records recovery gaps and owners without sending external messages

### Verification

- Synthetic outage and alert tests
- Tabletop trace of one cost spike and one lost provider response
- Verify credentials and customer content never enter incident artifacts

### Dependencies and blockers

Planning dependencies: WH-006. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/security-risk-actions.md](../../docs/security-risk-actions.md)
- [docs/deployment.md](../../docs/deployment.md)
- [docs/usage-recovery.md](../../docs/usage-recovery.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-008 — Prove control, object and app disaster recovery in isolation

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Recovery covers the whole platform state needed by supported beta workloads, with measured loss/time bounds.

### Scope

- Define proposed RPO/RTO before the drill
- Inventory D1, private R2, immutable versions, Worker artifacts, vault keys and provider references
- Restore synthetic control/app/site state to isolated resources and reconcile publication and identity state

### Acceptance criteria

- [ ] Restored objects match digests and control pointers; missing keys/artifacts fail visibly
- [ ] Restored services stay fenced from customer traffic; publication/identity differences and missing revocation/deletion reconciliation are recorded for WH-019 rather than treated as accepted recovery
- [ ] Measured RPO/RTO and untested provider assumptions are recorded
- [ ] Customer traffic switching and paid isolated cloud resources remain separately reviewed actions

### Verification

- Disposable D1/R2 and real QuickJS drill using synthetic data
- Restore uncertain-operation and revocation records without dispatch; inventory reconciliation gaps for WH-019
- Compare with Cloudflare Time Travel guarantees rather than assuming complete backup

### Dependencies and blockers

Planning dependencies: WH-002, WH-007, WH-009. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/deployment.md](../../docs/deployment.md)
- [docs/app-data.md](../../docs/app-data.md)
- [docs/account-closure.md](../../docs/account-closure.md)
- [docs/emdash.md](../../docs/emdash.md)
- [tools/verify-cms-recovery.mjs](../../tools/verify-cms-recovery.mjs)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-009 — Define retention, deletion and account-export contracts

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **ready**. Kind: decision. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/7. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

- 2026-09-30 source/local evidence: commit 2dcbb7a adds a proposed lifecycle contract and explicit catalog covering all 133 control tables across 29 classes; schema and account-closure inventory checks passed with 107 migrations. Retention choices remain proposed; no closure/export activation or legal-compliance claim. See docs/data-lifecycle.md.
- 2026-10-01 UTC reconciliation against source 0002632 / migrations 0001–0113: all 148 tables classified into 31 groups, including full configuration copies, separate save/activation receipts and planning provenance; 21 direct non-cascading owner references identified. Read-only closure inventory includes the new retained records. Lifecycle catalog, account-closure inventory, specification journey and service-client activation tests passed with synthetic local data; future guest/brand/lead/staging/connector requirements are explicit. Cloudflare retention references rechecked. Policy choices remain proposed; no live data access, runtime deployment, provider activation or deletion was performed. Execution/completion evidence belongs in issue #7.

## WH-010 — Map safety coverage and specify the remaining fail-closed boundaries

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **ready**. Kind: decision. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Every intake, model, execution, preview, export, publication and serving path has a named safety requirement and missing coverage is visible.

### Scope

- Inventory profile/project/CMS media, WordPress sources, pasted/generated/imported code, generated pages and visitor inputs
- Map existing scan tickets, sticky decisions and reviewed risk evidence to callers
- Specify mandatory versus supplemental checks and legacy artifact handling

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

- 2026-10-01 UTC source/local reconciliation against 4e91a8b through migrations 0001–0113: docs/safety-coverage.md inventories 17 path families, actual screening/risk callers, known specification/service holds, mandatory versus supplemental checks, legacy/context gaps and concrete WH-011–017 handoff. Agent safety knowledge now accurately states the unconfigured detectors and remaining coverage gaps. pnpm check/build, specification journey, service-client activation, natural Chat, 67 local document references and roadmap validation/render checks passed. Benign scripted fixtures only; no detector, CMS feature testing, provider activation or safety-launch acceptance. Release and completion evidence belongs in issue #8 and the coverage document.

## WH-011 — Select and authorize moderation providers and response operations

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **blocked**. Kind: decision. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

- Provider eligibility/access, data-processing terms, budget and responsible safety/legal operator need owner decisions; no provider is currently accepted.

### References

- [docs/content-safety.md](../../docs/content-safety.md)
- [src/photo-scan-results.ts](../../src/photo-scan-results.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-012 — Implement bounded private scan dispatch and result reconciliation

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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
- python3 tests/photo-scan-migration.py
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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

CMS and imported media cannot bypass the safety requirements applied to profile/project photos.

### Scope

- Apply the approved coverage contract to CMS uploads, WordPress assets, previews, export and public/custom-host delivery
- Keep original/transformed bytes and policy identity linked
- Design legacy hold/backfill and revocation behavior

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

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-014 — Gate generated and imported code/content across execution and publication

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-016 — Deliver abuse intake, policy consent and independent safety review

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers and operators have a usable reporting/correction route independent of ordinary Chat capacity.

### Scope

- Publish versioned acceptable-use and privacy documents after owner/legal review
- Record policy consent and existing-account rollout separately from US declaration
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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An owner can export supported data and request closure without losing reconciliation or provider revocation authority.

### Scope

- Add fresh-session exact review and durable stop-new-work closure state
- Resolve unknown usage/provider operations before eligible erasure
- Withdraw services, revoke tokens before erasing keys, and clean owned objects/resources resumably

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

Planning dependencies: WH-009, WH-015, WH-006. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/account-closure.md](../../docs/account-closure.md)
- [tools/account-closure-inventory.mjs](../../tools/account-closure-inventory.mjs)
- [src/usage-recovery.ts](../../src/usage-recovery.ts)
- [src/cloudflare-connection.ts](../../src/cloudflare-connection.ts)
- [src/app-lifecycle.ts](../../src/app-lifecycle.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-019 — Reconcile erasure and revocation after restores

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Planning dependencies: None. Verify completion in current issue evidence before execution; ordering is not proof of completion.

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

## WH-048 — Review and admit a bounded real-customer beta

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: release. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An explicitly scoped invited beta is released only with evidence for safety, privacy, recovery and customer value.

### Scope

- Choose supported website/app paths and a small cohort size based on measured capacity
- Review gate matrix, open risks, support ownership and rollback
- Keep unavailable provider/CMS/payment paths explicitly disabled

### Acceptance criteria

- [ ] All required gate evidence refers to the candidate release and admitted paths
- [ ] Owner approves customer/data cohort and provider privacy scope
- [ ] No full-MVP claim; waived/omitted features require explicit scope decision
- [ ] Stop conditions and review cadence are recorded before invitations are issued
- [ ] Support/recovery remains reachable when Chat or onboarding fails, with a responsible operator and tested access path

### Verification

- Candidate-release connected site/app journeys and auth boundaries
- Real-device evidence plus isolated recovery drill
- Release review only; sending invitations requires explicit instruction

### Dependencies and blockers

Planning dependencies: WH-001, WH-002, WH-003, WH-004, WH-005, WH-007, WH-008, WH-017, WH-019, WH-020, WH-024, WH-025, WH-050, WH-059, WH-035. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/roadmap/README.md](../../docs/roadmap/README.md)
- [docs/acceptance.md](../../docs/acceptance.md)
- [docs/content-safety.md](../../docs/content-safety.md)
- [docs/deployment.md](../../docs/deployment.md)
- [docs/mvp.md](../../docs/mvp.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-050 — Measure capacity, distributed abuse and tenant fairness

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-059 — Rehearse release rollback and an end-to-end recovery incident

Phase: **Safe customer beta** (F1). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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
- [docs/usage-recovery.md](../../docs/usage-recovery.md)
- [docs/account-closure.md](../../docs/account-closure.md)
- [docs/roadmap/execution.md](../../docs/roadmap/execution.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-024 — Audit the supported owner journey for usability and accessibility

Phase: **Safe customer beta** (F1). Priority: **P1**. Planning readiness: **ready**. Kind: verification. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers can reach a first useful draft and recover from blocked work on keyboard, small screens and assistive technology.

### Scope

- Trace landing, invitation, welcome, Chat, review cards, preview and recovery
- Assess focus, labels, announcements, contrast, errors, loading and narrow-screen behavior
- Turn observed failures into bounded fixes; preserve Chat-first product choices
- Investigate composer/request persistence, dashboard query-error recovery and Chat new-message announcements from the baseline review; verify before classifying as defects

### Acceptance criteria

- [ ] Complete keyboard journey and screen-reader checks have evidence
- [ ] Pending safety/provider work is understandable and never shown as completed
- [ ] Unavailable trial/contact/payment controls make no false promise
- [ ] Real device gaps remain explicit even if viewport emulation passes

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

### Execution coordination

Issue: https://github.com/zemdregon/whumpo/issues/10. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

# F2 — Useful websites and applications

Better customer outcomes, evaluated generation, usable app interfaces and accepted optional connections.

## WH-025 — Measure activation and first customer value without collecting content

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The team can identify where invited users fail to reach a useful reviewed publication.

### Scope

- Define consent-aware content-free funnel events and bounded retention
- Measure welcome completion, first draft, accepted edit, review, publication and seven-day return
- Separate technical success from user judgment of usefulness

### Acceptance criteria

- [ ] Events carry no brief, source, chat, credentials or cross-tenant identifiers in customer views
- [ ] Funnel counts are idempotent and exclusions documented
- [ ] Targets in roadmap are labeled proposed until the first cohort baseline
- [ ] User interview/feedback requests are drafted but never sent without explicit instruction

### Verification

- Synthetic funnel replay/opt-out/deletion tests
- Compare aggregate counts with operation receipts
- Review privacy/retention contract

### Dependencies and blockers

Planning dependencies: WH-024, WH-009. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/onboarding.md](../../docs/onboarding.md)
- [docs/workspace-agent.md](../../docs/workspace-agent.md)
- [docs/site-health.md](../../docs/site-health.md)
- [src/site-traffic.ts](../../src/site-traffic.ts)
- [frontend/src/onboarding.tsx](../../frontend/src/onboarding.tsx)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-026 — Expand evaluated website layouts and precise editing

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The supported site builder delivers useful, distinct small-business and personal sites with predictable edits.

### Scope

- Prioritize three validated customer site use cases
- Add approved responsive components and bounded composition with SEO/metadata/accessibility defaults
- Improve edit intent preservation and unsupported-request explanations

### Acceptance criteria

- [ ] Each new component has versioned schema, export and preview/publish/restore support
- [ ] Edits preserve fields outside requested scope and never mutate prior versions
- [ ] Fixture acceptance covers mobile layout, semantic headings, link safety and exact restore
- [ ] Do not advertise arbitrary scripts or unrestricted multipage apps beyond supported contracts

### Verification

- pnpm test:site-agent
- pnpm test:customer-site-journey
- Visual and accessibility acceptance for representative outputs
- Outcome benchmark from WH-020

### Dependencies and blockers

Planning dependencies: WH-020, WH-014. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/shared-components.md](../../docs/shared-components.md)
- [docs/mvp.md](../../docs/mvp.md)
- [docs/version-comparisons.md](../../docs/version-comparisons.md)
- [src/components.ts](../../src/components.ts)
- [src/ai-chat.ts](../../src/ai-chat.ts)
- [src/publications.ts](../../src/publications.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-027 — Finish the photo-to-published-site customer experience

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

### Verification

- pnpm test:customer-app-journey
- pnpm test:app-page-design
- pnpm test:app-pages-http after fixture setup
- Browser keyboard/mobile test with two synthetic visitors

### Dependencies and blockers

Planning dependencies: WH-014, WH-020. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/app-data.md](../../docs/app-data.md)
- [docs/shared-components.md](../../docs/shared-components.md)
- [src/app-page-design.ts](../../src/app-page-design.ts)
- [src/app-pages.ts](../../src/app-pages.ts)
- [src/backend-task-list.ts](../../src/backend-task-list.ts)
- [web/visitor.js](../../web/visitor.js)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-029 — Make application upgrades and recovery usable end to end

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Owners can understand and safely complete upgrade, rollback, visitor export and deletion workflows.

### Scope

- Improve authority/change summaries and pending maintenance discovery
- Connect cancellation, stale-review recovery and failed transformation explanations
- Validate program/data rollback against current safety and deletion rules

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

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-030 — Complete reviewed component promotion and update governance

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Reusable components can improve quality without copying private customer source or silently changing installed versions.

### Scope

- Build synthetic candidate promotion from the existing nomination/intake workflow
- Require provenance, license, sensitive-data and security review plus human approval
- Define consent withdrawal, version pinning, deprecation and security update notices

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The configured OAuth flow is proven against a deliberately chosen customer-owned test zone.

### Scope

- Review exact scopes, zone and TXT/CNAME operation
- Exercise consent, inspection, exact review/confirmation, retry and disconnect
- Verify token refresh/revocation and lost provider response reconciliation

### Acceptance criteria

- [ ] Operator credentials never stand in for customer consent
- [ ] Only the reviewed record/resource changes
- [ ] Stale/replayed reviews and uncertain results preserve authority boundaries
- [ ] Acceptance evidence contains no tokens or customer secrets

### Verification

- pnpm test:cloudflare-connection
- pnpm test:cloudflare-dns
- pnpm test:cloudflare-token-refresh
- Live owned-zone acceptance only after exact user review

### Dependencies and blockers

Planning dependencies: WH-004, WH-001. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Real customer consent and an explicitly reviewed owned zone/DNS operation are required.

### References

- [docs/integrations/cloudflare-connection.md](../../docs/integrations/cloudflare-connection.md)
- [docs/integrations/cloudflare-dns.md](../../docs/integrations/cloudflare-dns.md)
- [src/cloudflare-connection.ts](../../src/cloudflare-connection.ts)
- [src/cloudflare-dns.ts](../../src/cloudflare-dns.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-032 — Configure and accept the customer GitHub App and reviewed backups

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **blocked**. Kind: verification. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers can grant scoped repository access, back up an exact reviewed version and revoke access.

### Scope

- Prepare customer GitHub App registration/callback/permission configuration
- Exercise consent and expected-head reviewed backup against an approved repository
- Verify conflict, replay, uncertain-result reconciliation and disconnect

### Acceptance criteria

- [ ] Repository contents match the reviewed exported artifact and target branch
- [ ] Concurrent remote changes are refused without force push
- [ ] No operator gh token substitutes for the customer App
- [ ] Disconnect prevents delayed callbacks and future writes

### Verification

- pnpm test:github-connection
- pnpm test:github-backups
- Live disposable-repository journey after owner config/consent

### Dependencies and blockers

Planning dependencies: WH-004, WH-001. Verify completion in current issue evidence before execution; ordering is not proof of completion.

- Customer GitHub App configuration and reviewed consent/repository are not available; operator repository access is separate.

### References

- [docs/integrations/github-app-setup.md](../../docs/integrations/github-app-setup.md)
- [docs/integrations/github-connection.md](../../docs/integrations/github-connection.md)
- [docs/integrations/github-backups.md](../../docs/integrations/github-backups.md)
- [src/github-backups.ts](../../src/github-backups.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-033 — Accept custom-domain HTTPS, fallback and disconnect

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: verification. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

An owned customer hostname serves the approved site with working TLS and recoverable disconnect.

### Scope

- Verify Cloudflare for SaaS account entitlement, hostname costs and fallback origin
- Prepare exact hostname/DNS/certificate activation review
- Exercise pending/error/TLS-ready/serving/withdraw/disconnect states

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

Planning dependencies: WH-031, WH-007. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/integrations/domain-hosting.md](../../docs/integrations/domain-hosting.md)
- [docs/domains.md](../../docs/domains.md)
- [src/domain-hosting.ts](../../src/domain-hosting.ts)
- [src/site-host.ts](../../src/site-host.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-035 — Deliver customer support independent of Chat limits

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Users can get help, inspect stuck operations and challenge usage decisions even when ordinary Chat is unavailable.

### Scope

- Extend existing usage-review capabilities with independent authenticated access
- Create actionable error/status links and operator response workflow
- Document support hours, escalation and incident communications without promising unstaffed service levels

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

Planning dependencies: WH-016, WH-007. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/usage-review-requests.md](../../docs/usage-review-requests.md)
- [docs/usage-recovery.md](../../docs/usage-recovery.md)
- [src/usage-review-requests.ts](../../src/usage-review-requests.ts)
- [tools/respond-usage-review.mjs](../../tools/respond-usage-review.mjs)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-036 — Add reliable contact delivery and verified sender operations

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-037 — Make site health and analytics useful and privacy-safe

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Owners can distinguish publication, DNS/TLS, form and traffic problems from incomplete telemetry.

### Scope

- Extend existing health/traffic cards with clear supported diagnostics
- Define bot/error exclusions, retention and delayed/missing-data states
- Provide recommended exact actions without arbitrary provider mutation

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

Planning dependencies: WH-006, WH-025. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/site-health.md](../../docs/site-health.md)
- [docs/unified-workspace-and-capacity.md](../../docs/unified-workspace-and-capacity.md)
- [src/site-health.ts](../../src/site-health.ts)
- [src/site-traffic.ts](../../src/site-traffic.ts)
- [frontend/src/traffic-card.tsx](../../frontend/src/traffic-card.tsx)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-038 — Resume and accept the first real native CMS customer journey

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **blocked**. Kind: verification. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Model/prompt/component changes cannot silently degrade accepted site/app outcomes or claim unperformed actions.

### Scope

- Promote representative benchmark fixtures into release evaluation
- Include unsafe/unsupported asks, prompt injection, edit preservation and recovery
- Record model/prompt/tool/component versions and quality/cost changes

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

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-061 — Complete directory hosting, health and sustainable receipt retention

Phase: **Useful websites and applications** (F2). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Owners can change an account email or respond to compromise without mistaking the current unverified identifier for proven ownership.

### Scope

- Define verified address change with fresh authentication, pending expiry and notification
- Coordinate password/passkey/session and provider-connection compromise review
- Keep ordinary lost-passkey recovery separate from broader compromise actions

### Acceptance criteria

- [ ] An unverified email cannot become a new recovery or authorization factor
- [ ] Response loss, stale confirmation and concurrent sign-in cannot restore compromised authority
- [ ] Provider revocation preserves reconciliation authority before credential erasure
- [ ] No real customer address/credential change occurs during synthetic acceptance

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
- [frontend/src/auth.tsx](../../frontend/src/auth.tsx)
- [frontend/src/profile-picture-picker.tsx](../../frontend/src/profile-picture-picker.tsx)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

# F3 — Commercial MVP

Verified provider economics, funded plans and the remaining full delivery-contract capabilities.

## WH-021 — Activate a reviewed production inference route and Gateway canary

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Production routing has verified model/rate/privacy contracts and complete spending receipts without silent paid fallback.

### Scope

- Connect existing route and Gateway foundations to approved task orchestration
- Add versioned model/protocol/context/price configuration and safe log/cache/retry policy
- Reconcile provider receipts, cancellation and orphaned tasks

### Acceptance criteria

- [ ] Standard work never acquires premium debits
- [ ] Task/account/platform reservations precede billable work; uncertain outcomes stay held
- [ ] Real canary verifies provider request/cost receipt and chosen Gateway settings
- [ ] No new provider billing, service or fallback activates without explicit exact review

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

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-022 — Collect authoritative shadow resource and task-cost events

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Real usage and provider costs can be reconciled without prematurely charging customers.

### Scope

- Define immutable source/event IDs, owner attribution, quantity and tariff version
- Capture authoritative infrastructure and complete task costs, separating control/retry overhead
- Reconcile aggregate usage against invoices/account floors

### Acceptance criteria

- [ ] Duplicate and delayed events cannot double-count
- [ ] Missing dimensions/costs remain unknown
- [ ] No per-tenant reuse of account-wide free allowance
- [ ] Standard AI costs remain internal with zero customer units; no shadow event grants billing authority

### Verification

- Synthetic duplicates, late events, tenant mismatch and unknown-rate tests
- Compare existing economic scenarios to measured units
- pnpm test:model-costs and relevant gateway/accounting suites

### Dependencies and blockers

Planning dependencies: WH-020, WH-006. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [docs/company-finance-review.md](../../docs/company-finance-review.md)
- [src/resource-economics.ts](../../src/resource-economics.ts)
- [src/gateway-spend.ts](../../src/gateway-spend.ts)
- [src/standard-ai-usage.ts](../../src/standard-ai-usage.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-023 — Reconcile company finance and validate two complete cost periods

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: verification. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Paid launch economics are supported by verified revenue, complete costs and measured workload distributions.

### Scope

- Implement/import authenticated finance evidence with provenance and closed-period reconciliation
- Include account minimums, refunds, processor fees, moderation, support and retained resource liabilities
- Measure two complete periods and rerun correlated cost/rollover stress cases

### Acceptance criteria

- [ ] Operator attestations remain labeled until independently reconciled
- [ ] Unmatched amounts and changing revenue prevent false abuse/profit conclusions
- [ ] Measured standard AI expense is additional to proposed resource envelopes
- [ ] Owner receives an explicit go/no-go commercial recommendation; prices are not changed automatically

### Verification

- pnpm test:fair-use-finance
- Reconcile synthetic import duplicates/revisions and totals
- Two actual closed periods are evidence gates, not accelerated fixtures

### Dependencies and blockers

Planning dependencies: WH-022. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/company-finance-review.md](../../docs/company-finance-review.md)
- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [src/fair-use-finance.ts](../../src/fair-use-finance.ts)
- [tools/company-finance-input.mjs](../../tools/company-finance-input.mjs)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-041 — Resolve payment activation, commercial terms and plan scope

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **blocked**. Kind: decision. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Commercial engineering has explicit owner-approved provider, pricing, supported features and transaction/retention terms.

### Scope

- Preserve current proposed prices and standard-AI policy while reviewing economics
- Prepare Stripe/provider setup, subscription/tax/refund/dispute policy and customer eligibility decisions
- Distinguish narrower beta packaging from the unchanged full MVP delivery contract

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

- Owner explicitly deferred Stripe setup; payment activation and commercial/legal decisions require resumption.

### References

- [docs/payments.md](../../docs/payments.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/plan-lifecycle.md](../../docs/plan-lifecycle.md)
- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [docs/mvp.md](../../docs/mvp.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-042 — Implement subscription, invoice and entitlement lifecycle

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Paid entitlements follow authoritative financial events and can recover duplicate, reordered or missing delivery.

### Scope

- Implement checkout/subscription mapping, monthly/annual fulfillment and reconciliation
- Handle cancellation, renewal, proration, refund, disputes and failed payment
- Maintain access/export/hosting grace policies and immutable compensating entries

### Acceptance criteria

- [ ] Only verified server events grant entitlements; browser success pages do not
- [ ] Duplicate/reordered events cannot double-grant or silently regress paid state
- [ ] Annual purchase issues monthly grants by recorded periods
- [ ] Sandbox proof precedes separately approved real payments

### Verification

- pnpm test:checkout
- pnpm test:billing
- pnpm test:plan-periods
- Synthetic provider lifecycle and missed-event reconciliation tests

### Dependencies and blockers

Planning dependencies: WH-041, WH-022, WH-023. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/payments.md](../../docs/payments.md)
- [docs/plan-lifecycle.md](../../docs/plan-lifecycle.md)
- [src/checkout.ts](../../src/checkout.ts)
- [src/plans.ts](../../src/plans.ts)
- [src/billing.ts](../../src/billing.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-043 — Implement capacity ledger, grants, rollover and customer explanations

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers see authoritative measured capacity and separately funded balances instead of scenario estimates.

### Scope

- Add integer-unit immutable ledgers and atomic cross-service reservations
- Implement proposed lot/expiry/rollover rules only after terms approval
- Show measured categories, periods, uncertainty and reviewed opt-in top-ups

### Acceptance criteria

- [ ] Legacy test balances preserve original meaning
- [ ] Standard assistance debits zero units; premium funding remains explicit
- [ ] Concurrent work, rollover expiry and refunds settle exactly once
- [ ] Unknown telemetry never displays false full capacity; no automatic upgrade or top-up by default

### Verification

- pnpm test:billing
- pnpm test:plan-periods
- Concurrent reserve/settle, lot-expiry, refund and unknown-dimension fixtures
- UI checks for proposed versus actual balances

### Dependencies and blockers

Planning dependencies: WH-022, WH-023, WH-041. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/resource-pool-economics.md](../../docs/resource-pool-economics.md)
- [docs/unified-workspace-and-capacity.md](../../docs/unified-workspace-and-capacity.md)
- [src/capacity-policy.ts](../../src/capacity-policy.ts)
- [src/resource-economics.ts](../../src/resource-economics.ts)
- [src/billing.ts](../../src/billing.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-044 — Deliver explicit premium funding, dispatch and reconciliation

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: implementation. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-049 — Verify the full commercial MVP delivery contract

Phase: **Commercial MVP** (F3). Priority: **P0**. Planning readiness: **planned**. Kind: release. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Whumpo can claim the agreed MVP only after every contract requirement has appropriate live/customer evidence.

### Scope

- Reconcile the complete original MVP checklist against current implementation and accepted journeys
- Verify paid annual/monthly lifecycle, domain purchase and optional integrations
- Consolidate technical design, runbooks and cost/quality evidence for the release

### Acceptance criteria

- [ ] No unavailable payment/provider/CMS journey is marked complete by a local test
- [ ] Two-period economics and funded entitlements are evidenced
- [ ] Device, tenant, uncertainty, publication/restore and recovery checks are current
- [ ] Any removal of a delivery-contract requirement needs an explicit owner amendment before closure

### Verification

- Full requirement-to-evidence review at candidate release
- Only selected focused suites justified by changes
- Separately authorized live financial/provider customer acceptance

### Dependencies and blockers

Planning dependencies: WH-048, WH-021, WH-023, WH-027, WH-029, WH-030, WH-031, WH-032, WH-033, WH-034, WH-035, WH-037, WH-038, WH-040, WH-042, WH-043, WH-044, WH-045, WH-047, WH-058. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/mvp.md](../../docs/mvp.md)
- [docs/acceptance.md](../../docs/acceptance.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/roadmap/README.md](../../docs/roadmap/README.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-034 — Build reviewed registrar purchase and renewal reconciliation

Phase: **Commercial MVP** (F3). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

The public product describes only fulfilled plans and makes real next steps available.

### Scope

- Replace proposal-only pricing/trial/contact states with approved working enrollment paths
- Reconcile feature entitlements, annual terms, premium consent and domain benefits
- Update help, technical design and operational/support docs together

### Acceptance criteria

- [ ] No unavailable feature is advertised as provisioned
- [ ] Checkout/renewal/limits and cancellation terms agree with server authority
- [ ] Standard AI remains unlimited under fair use without hidden unit charges
- [ ] Marketing, docs and actual journey acceptance reference the same dated release

### Verification

- Landing/pricing keyboard/mobile checks
- Catalogue-to-entitlement contract tests
- Document links and complete paid sandbox journey

### Dependencies and blockers

Planning dependencies: WH-042, WH-043, WH-044, WH-045, WH-035. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [frontend/src/pricing.tsx](../../frontend/src/pricing.tsx)
- [frontend/src/landing.tsx](../../frontend/src/landing.tsx)
- [docs/mvp.md](../../docs/mvp.md)
- [docs/pricing-and-model-policy.md](../../docs/pricing-and-model-policy.md)
- [docs/acceptance.md](../../docs/acceptance.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

# F4 — Measured expansion

Demand-led scale, collaboration, search and advanced hosting after the core product proves useful.

## WH-051 — Optimize measured storage, traffic and cache bottlenecks

Phase: **Measured expansion** (F4). Priority: **P1**. Planning readiness: **planned**. Kind: implementation. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

## WH-053 — Pilot tenant-isolated search over approved published content

Phase: **Measured expansion** (F4). Priority: **P2**. Planning readiness: **deferred**. Kind: implementation. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Customers with measured search demand can query their approved content with bounded retrieval/inference cost.

### Scope

- Evaluate AI Search versus explicit indexing/Vectorize against real retrieval requirements
- Bind tenant, published version and safety state to indexed documents
- Design removal, reindex, citation and query-budget behavior

### Acceptance criteria

- [ ] No private draft, revoked artifact or other tenant document can be retrieved
- [ ] Prompt injection in retrieved content cannot authorize actions
- [ ] Search/index/inference charges and plan eligibility are reviewed
- [ ] Pilot has measurable answer/citation quality and a deletion SLA verified by tests

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

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-054 — Add workspace collaboration with explicit roles and approvals

Phase: **Measured expansion** (F4). Priority: **P2**. Planning readiness: **deferred**. Kind: implementation. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Multi-person customers can collaborate without sharing owner credentials or expanding publication/spending authority accidentally.

### Scope

- Validate demand and define owner/editor/viewer/billing roles
- Design invitation, membership, audit and owner-transfer lifecycle
- Extend tenant predicates and exact approval authority consistently

### Acceptance criteria

- [ ] Role changes revoke stale sessions/reviews as required
- [ ] Editors cannot spend, publish or manage identity unless explicitly granted
- [ ] Last-owner removal and cross-workspace membership are handled
- [ ] Existing single-owner isolation tests remain valid

### Verification

- Role/tenant matrix and concurrent membership/review fixtures
- Device and invitation journeys
- Security review before multi-user activation

### Dependencies and blockers

Planning dependencies: WH-049, WH-004. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/app-data.md](../../docs/app-data.md)
- [docs/security-risk-actions.md](../../docs/security-risk-actions.md)
- [src/publications.ts](../../src/publications.ts)
- [src/billing.ts](../../src/billing.ts)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-055 — Evaluate advanced hosting only for validated unsupported workloads

Phase: **Measured expansion** (F4). Priority: **P2**. Planning readiness: **deferred**. Kind: decision. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

A measured business case determines whether QuickJS needs an additional isolated hosting tier.

### Scope

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

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-056 — Standardize reviewed notifications and limited external connectors

Phase: **Measured expansion** (F4). Priority: **P2**. Planning readiness: **deferred**. Kind: implementation. Size: L.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Demanded integrations reuse scoped consent, exact reviews and reliable delivery instead of adding arbitrary network authority.

### Scope

- Choose one validated customer integration at a time
- Reuse encrypted scoped credentials, delivery receipts, retries and revocation
- Offer safe templates for notifications or inbound email routing where appropriate

### Acceptance criteria

- [ ] Connector target hosts/scopes are server-controlled
- [ ] Unknown results reconcile without duplicate side effects
- [ ] Customer consent and price are explicit
- [ ] No arbitrary outbound fetch from generated source is introduced

### Verification

- Synthetic connector conformance and revoked-token tests
- Approved provider sandbox acceptance
- Review privacy/deletion and rate limits

### Dependencies and blockers

Planning dependencies: WH-049, WH-036. Verify completion in current issue evidence before execution; ordering is not proof of completion.

No external blockers recorded. This does not grant deployment, purchase, provider activation, or customer-action approval.

### References

- [docs/integrations/cloudflare-connection.md](../../docs/integrations/cloudflare-connection.md)
- [docs/contact-forms.md](../../docs/contact-forms.md)
- [docs/backend-execution.md](../../docs/backend-execution.md)

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.

## WH-060 — Keep advanced Cloudflare capabilities in a demand-gated portfolio

Phase: **Measured expansion** (F4). Priority: **P2**. Planning readiness: **deferred**. Kind: decision. Size: S.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

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

## WH-062 — Evaluate bounded multi-agent task execution

Phase: **Measured expansion** (F4). Priority: **P2**. Planning readiness: **deferred**. Kind: decision. Size: M.

Reviewed: 2026-09-30. Source baseline: `05443262a88b658c8d72460a75b28facacabec4f`. This is a planning snapshot, not current execution or deployment status.

Follow the [agent execution contract](../../docs/roadmap/execution.md) and [canonical backlog](../../docs/roadmap/backlog.json). Re-read the current feature contracts before work.

### Outcome

Parallel model roles are introduced only if they improve task outcomes within one explicit authority and cost envelope.

### Scope

- Compare a single bounded agent with planner/builder/evaluator roles on the same synthetic task corpus
- Specify parent/child receipts, shared reservations, cancellation, context minimization and maximum concurrency
- Retain server-only action confirmation and human publication/spending reviews

### Acceptance criteria

- [ ] Every child call rolls up to one task budget and preserves standard versus premium funding
- [ ] Failed/cancelled children cannot orphan dispatch or mutate after withdrawal
- [ ] Customer source and credentials are not broadened across roles without necessity
- [ ] Measured completion quality, latency and total cost justify a go/no-go decision; no automatic paid fan-out

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

### Execution coordination

Issue: Not created. Planning owner: Unassigned. Check the live issue state, assignee, dependencies, and linked pull requests before claiming or starting this task.

### Evidence

No completion evidence recorded. Add verified results and their scope to the execution issue; planning readiness is never a completion status.
