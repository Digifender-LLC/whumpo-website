# Schema cutover plan — October 2026

**PLAN — NOT EXECUTED. Prepared October 9, 2026 (UTC) from the repository and GitHub metadata only.** Nothing in this document has been run against Cloudflare. No Wrangler, D1, R2, Workers or `pnpm run deploy` command of any kind was used to write it, and no live state was read. Every remote operation in [section 6](#6-operations-that-need-explicit-owner-authorization) needs the owner's explicit authorization **in the conversation where it runs, naming that operation** (the owner operating rules (AGENTS.md, removed from this repository)). Approving this plan, or a bundle choice, authorizes none of them.

Facts below are labelled **established** (computed from Git, read from the repo or from GitHub check-run metadata) or **UNVERIFIED** (needs a live read; how to verify is given). Do not treat inferences about live state as readback.

## 0. Summary

- **Why `deploy ci` fails.** Since PR #186 (WH-050, merge commit `4dea09c`) the composed current schema on `main` differs from the schema recorded live at the October 4 cutover. `deploy ci` refuses any release whose live control database is not exactly the current schema in the commit (`tools/deploy-ci.mjs:43-48`). Workers Builds has reported `failure` on every `main` commit from `4dea09c` onward and `success` on the commit just before it (section 1.3). The refusal reason itself is in the build log, which needs Cloudflare dashboard access to read (UNVERIFIED).
- **The delta is one PR.** Only #186 changed the composed schema since October 4: 219 → 221 tables, 1050 → 1063 catalog objects (+14 objects, −1 trigger, 5 changed). Nothing else merged to `main` touches schema, compiler locks or the compiler catalog.
- **Queued schema work.** No **open** PR changes the composed schema. Two pieces of schema work exist off `main`: closed draft #252 (three operator trigger bodies, ported onto `4dea09c`) and the local-only WH-093 lead pipeline branch `claude/wh-093-lead-integrated` (six tables, a compiler identity bump to `project-content@6`; **not on `origin`**). The planned schema children WH-156, WH-170, WH-181, WH-194 and WH-201 have no source branch yet.
- **Recommended bundle: `main` as it is (#186 only), plus the three-binding change to a new empty D1.** It is the smallest set that clears `deploy ci`, it is already merged and gate-green, and it matches the schema fingerprint that the WH-054 tenant registry (#250) pins. #252 and WH-093 follow in one later batched cutover once they are rebuilt on `main` and verified (section 2.4).

## 1. Schema delta: what changed since the recorded October 4 cutover

### 1.1 How the fingerprints were computed

`tools/current-schema.mjs` composes six inputs in order (`tools/current-schema.mjs:7`): `src/workspace-identity/canonical-inputs.sql`, `schema/platform.sql`, `src/workspace-identity/schema.sql`, `src/funnel-metrics/schema.sql`, `src/guest-previews/schema.sql`, `src/shared-modules/schema.sql`. `currentSchemaArtifact()` returns two different digests, and both matter:

| Digest | What it hashes | Where it is used |
| --- | --- | --- |
| `sqlSha256` | The complete concatenated SQL text | The review file's `schemaSha256` must equal it (`tools/release-manifest.mjs:51`) |
| `expected.sha256` (inventory) | The ordered `sqlite_master` catalog rows after executing the SQL (`tools/current-schema.mjs:12-16`) | Live readback compares it (`tools/deploy-ci.mjs:44`, `tools/deploy-platform.mjs:25`) |

For each commit, the repository's own `tools/current-schema.mjs` and schema inputs were extracted with `git archive` and passed to `currentSchemaArtifact()` (in-memory SQLite, foreign-key check on). No database or network was touched.

**Record correction:** the October 4 entry in [releases](releases.md#pr-160-shared-modules-and-contact-email-cutover--october-4-2026-utc) gives "Schema SHA256: `68617fbf…`". That value is the **inventory** digest, not the complete-SQL digest a review file pins. For the same source, the complete-SQL digest is `6acfc1d0…` (table below).

### 1.2 Then and now (established)

| Point | Commit | Tables | Objects (index/view/trigger) | Inventory `expected.sha256` | Complete SQL `sqlSha256` |
| --- | --- | --- | --- | --- | --- |
| Recorded live, Oct 4 cutover (`ebe32e52-6b71-4977-b56e-8976d1cf26c5`) | PR #160, merged as `e5902dc` | 219 | 1050 (164/27/640) | `68617fbf7b3757411247514411e3a7beb637df9ce1d1b090a22fc03c1c6f2742` | `6acfc1d07cfd1abb6d2f5da6a4443dcc3711bc19de5c0b5353d6adab48cd2cac` |
| Last commit before #186 | `033e7d9` | 219 | 1050 | same as above | same as above |
| After #186 / `origin/main` today | `4dea09c` … `89fa009` | 221 | 1063 (166/28/648) | `42d5aaa76d22870d0aacbb96590c1e54f7f5c3ad434cbad4cc5ab024f0806388` | `b035ce44331131b8fe2d32429b7152c1badaad344b0edefd2f93f579026c8c22` |

All 18 first-parent `main` commits from `e5902dc` to `033e7d9` produce the identical artifact; all five from `4dea09c` to `89fa009` produce the new one. The recorded October 4 counts (219 tables, 1050 objects, `68617fbf…`) match the computed pre-#186 inventory exactly.

**Objects changed by #186** (only `schema/platform.sql`, +119/−19 lines):

- Added (14): tables `operator_session_revocations`, `operator_retention_receipts`; indexes `operator_containments_resolved`, `operator_session_revocations_account`; view `operator_serving_stopped`; triggers `operator_containment_resolve`, `operator_retention_admit`, `operator_retention_apply`, `operator_retention_immutable`, `operator_retention_retained`, `operator_session_revocation_admit`, `operator_session_revocation_apply`, `operator_session_revocation_immutable`, `operator_session_revocation_retained`.
- Removed (1): trigger `operator_containment_lift`.
- Changed (5): table `operator_containments` (renamed resolution columns), index `operator_containments_subject`, triggers `operator_containment_admit`, `operator_containment_retained`, view `operator_contained_projects`.

The feature contract is [capacity and fairness, WH-050 status](capacity-and-fairness.md) (line 258: "needs the owner-authorized empty-D1 cutover … No cutover was run"). #186 also changed `src/` to use these tables, so its Workers cannot run on the October 4 schema.

### 1.3 What that implies for `deploy ci`

`ciPreflight` (`tools/deploy-ci.mjs:43-48`) refuses when (a) the live schema inventory differs from the commit's, (b) the configured `DB` differs from the database bound to the live platform, or (c) CMS registrations exist. It runs before preparation and before the D1 lease, so a refused run deploys and writes nothing. With live = `68617fbf…` and `main` = `42d5aaa7…`, condition (a) holds for every commit after #186. It follows that **nothing merged after `033e7d9` has been deployed**, including the non-schema commits `91717e6`, `b4453a6` and `89fa009`. This is an inference from the check runs; live Worker versions are UNVERIFIED.

GitHub check runs for `Workers Builds: whumpo-platform` (read with `gh api …/check-runs` on October 9; established as metadata, not as build-log content):

| Commit | Conclusion | Completed (UTC) |
| --- | --- | --- |
| `e5902dc` (#160) | success | 2026-10-04 20:22:32 |
| `ca17c6a` | success | 2026-10-05 02:45:18 |
| `64cab65` | success | 2026-10-09 05:32:00 |
| `cf39edd`, `92a001f` | **failure** | 2026-10-09 05:31:52 / 05:31:44 |
| `6efc29f` … `033e7d9` (12 commits with a run) | success | 09:29:35 … 10:12:09 |
| `4dea09c` (#186) | **failure** | 10:14:44 |
| `91717e6`, `b4453a6`, `89fa009` | **failure** | 13:30:24, 13:33:06, 13:30:59 |
| `348690c`, `5485cd5` | no Workers Builds run | both docs-only; such changes do not build ([deployment](deployment.md)) |

UNVERIFIED, with how to verify:

- **The refusal text.** The likely message is `CI release refused: the live control database does not match the current schema in this commit.` Confirm in the Workers Builds logs for builds `32f0b102-002a-43b4-9400-bdaeb35e7447` (`4dea09c`) and `e68f7ab9-12ad-4df5-8fd1-e3f8a6a75945` (`89fa009`) in the Cloudflare dashboard. The build gate itself passes locally at `89fa009` (section 4.1), so a gate failure is unlikely but not excluded.
- **The two 05:31 failures** (`cf39edd`, `92a001f`) predate #186 and carry no schema change. They finished within eight seconds of a successful build of `64cab65`, which is consistent with contention for the D1 deployment lease (`tools/deploy-platform.mjs:9-12`). Read their build logs before relying on that.
- **Live state.** The success at `033e7d9` (10:12:09) implies that, at that moment, the live database matched `68617fbf…` and the platform was bound to the configured `dba4c707-a0c0-4084-969b-6c43f6afebde`. Live Worker versions and data counts have not been read. Verify with the read-only items A1/A4 in section 6.

## 2. Queued schema and compiler-identity work

Method: `gh pr list --repo zemdregon/whumpo --state all --limit 100`, then, for every `origin` branch and every local branch, `git diff --stat origin/main...BRANCH -- schema 'src/**/*.sql' compiler-locks src/project-specification/catalog.ts tools/current-schema.mjs`. Each candidate was trial-merged onto `origin/main` with `git merge-tree --write-tree`, and the merged tree's composed schema was computed as in 1.1. Merged-tree digests are **indicative only**: they come from an automatic merge with unresolved conflicts in non-schema files, not from a reviewed branch.

### 2.1 Open PRs (10): none changes the composed schema

#256–#265 (WH-034, WH-193, WH-022, WH-169, WH-004 audit/B4, WH-200, WH-203 ×2, WH-061) change no path above. #262/#263/#264 (WH-200/203) are pure, unwired modules. #265 (WH-061) and #258 (WH-022) only plan schema children (WH-181, WH-170). None needs a cutover, and none blocks one.

### 2.2 Branches that carry schema or compiler-identity changes

| Work | Where | What changes | Readiness | Needs a cutover? |
| --- | --- | --- | --- | --- |
| **#186 WH-050** operator controls | merged (`4dea09c`) | Section 1.2 | Merged, gate-green locally | **Yes, already blocking `deploy ci`** |
| **#252 WH-008/WH-050** action identity and current recovery | `origin/claude/wh-008-wh-050-current-recovery-main` (`a51b5cf`), base `4dea09c`, 4 behind `main`. PR **closed** 2026-10-09 21:29 UTC ("stack needs a single train2 rebuild onto main after Actions billing is restored") | `schema/platform.sql` +26/−2. Trigger bodies of `operator_containment_admit`, `operator_session_revocation_admit` and `operator_retention_admit` now refuse any action ID that is not a lowercase 36-byte UUIDv7 stamped within [now − 1 day, now + 1 minute]. No table, column or count change. Indicative: 221 tables / 1063 objects, inventory `fdb620e9…`, SQL `c41babc3…` | Not ready. Draft and closed. The PR body says the `--d1` variants of five suites and `contact-notifications` were **not run to completion** (local `/tmp` quota). Trial merge conflicts with `main` in `docs/verification.md` and `tools/verify.mjs` only | Yes (trigger bodies are in the inventory). Can follow later: it hardens the same, empty operator tables |
| **WH-093** lead pipeline | **local only**: `claude/wh-093-lead-integrated` (`d900728`) in worktree `.claude/worktrees/wh-093-lead-integrated`. **Not on `origin`, no PR.** Base `ca17c6a` (pre-#186), 21 behind `main` | New input `src/shared-modules/leads.sql` (7th file in `tools/current-schema.mjs`). Six tables `module_leads`, `module_lead_events`, `lead_project_settings`, `lead_zone_reviews`, `lead_zone_links`, `lead_zone_applies`, plus indexes and triggers (+32 objects on its own base). `safety_preserved_records.source` gains `module_lead`. **Compiler identity** `project-content@5` → `@6` (`compiler-locks/project-content-v5.json` renamed to `-v6.json`, `src/project-specification/catalog.ts`, and the three `project_spec_*` admit triggers now require `compiler.version` 6). Indicative on `main`: 227 tables / 1095 objects, inventory `4dd3d7e3…`, SQL `23b87edb…` | Not ready. The branch's own `docs/business-leads.md` (local only) says "Nothing here is deployed or accepted, and the task is not complete" and states that the schema change needs an owner-authorized cutover before merge. The trial merge onto `main` conflicts in six files, including `src/chat.ts`. Must be pushed, rebased onto `main`, reviewed and gate-green | Yes. Can follow later |
| #250 WH-054 tenant registry | `origin/claude/wh-054-tenant-registry-review-main`. PR **closed** 2026-10-09 21:28 UTC as conflict-stale | **No schema change.** Its `docs/tenant-classification.json` pins `reviewedSchemaSha256` = `42d5aaa7…` (221 tables), which is exactly today's `main` inventory | Closed; rebuild pending | No. But **any** further schema change (#252, WH-093) makes its drift gate fail until it is re-reviewed. Another reason to keep the first cutover to `main` |
| #170 WH-018/019/014 account export and closure (+ #217/WH-187 stacked) | `origin/c/great-curie-8ryukc`, `origin/claude/wh-187-portable-bundle-builder`; PRs **closed** (draft) | New `src/account-lifecycle/schema.sql`; +12 tables (account closures, export usage, restore suppressions, abuse reports, policy consents, safety notices/appeals…); indicative 233 tables / 1177 objects | Closed, stale | Not a candidate unless reopened |
| #173 safety audit capacity | `origin/fix-safety-audit-capacity`; **closed as superseded** by `458a1af` on #170 | Subset of #170 (231 tables) | Superseded | No |
| #174 roadmap completion (codex) | `origin/codex/roadmap-completion-20261007`; **closed** draft ("superseded by rebased main-line PRs") | 236 tables / 1216 objects; connectors, mobile, account lifecycle; **also claims `project-content@6`** | Closed, stale | No. **Identity collision:** #174's `compiler-locks/project-content-v6.json` has content digest `88b59ff5…`; WH-093's `-v6.json` has `88bcc7b7…`. If #174's work returns it must take a new compiler version, never reuse `@6` |
| WH-015, WH-025, WH-092 early branches | `origin/claude/wh-015-safety-cases`, `…/wh-025-funnel-metrics`, `…/wh-092-preview-links` (Oct 4) | All 51 objects they create already exist on `main` (merged by squash) | Merged | No |
| `codex/keen-curie-pqlpt2`, `codex/identity-admission`, `codex/portfolio-links-20261002` | `origin`, Oct 2–3, 57–134 commits ahead / 62–66 behind | Pre–current-schema branches; 171–184 conflicting files including `schema/platform.sql` and `tools/current-schema.mjs` | Stale | No |
| WH-156, WH-170, WH-181, WH-194, WH-201 | Backlog only (WH-170 in #258, WH-181 in #265, WH-194 in #256; WH-156 and WH-201 on `main`) | Planned schema children. Each task scope says it needs its own owner-run empty-D1 cutover | No source exists | Later batch |

A merge-tree of #252 together with WH-093 gives 227 tables / 1095 objects (inventory `9a358435…`, SQL `e3c26d5d…`), also indicative only.

### 2.3 What compiler-identity changes cost

The compiler version is enforced inside schema triggers (`project_spec_current_proposal`, `project_spec_version_admit`, `project_spec_creation_admit` in `schema/platform.sql`), so a compiler bump is itself a schema change and rides a cutover. Under the [current-version policy](current-version-policy.md) (`@3`/`@4` locks "reject, never read"), every saved schema-3 specification pinned to `project-content@5` becomes unadmittable. Because the cutover already starts from an empty database, the extra loss is only that test specifications and saved website configurations must be recreated under `@6`. A bump that ships **without** a cutover cannot happen: the triggers would differ and `deploy ci` refuses.

### 2.4 Bundle options and recommendation

| Option | Contents | Clears `deploy ci` | Ready now | Data wipes before WH-093 reaches the test platform | Main risk |
| --- | --- | --- | --- | --- | --- |
| **A (recommended)** | `main` as is (#186) + three `DB` bindings to a new empty D1 | Yes | Yes. Merged; build gate passes locally at `89fa009` | 2 (this one + a later batch) | One more reset later; cheap in a test-only environment |
| B | A + #252 rebuilt on `main` and merged first | Yes | No. Needs a rebuild, the unfinished `--d1` suites, a reopened PR and a #250 re-baseline | 2 | Delays unblocking by at least one review cycle |
| C | B + WH-093 rebased, completed and merged | Yes | No. Not on `origin`, 6 conflicts, task incomplete, compiler bump | 1 | Longest wait; `main` stays undeployable meanwhile; the largest unreviewed schema delta lands at once |
| D | Wait for WH-156/170/181/194/201 | — | No source | 1 | Indefinite |

**Recommendation: Option A now; later, one batched cutover (#252 + WH-093 + whichever WH-1xx children are merged by then).** Reasons:

1. `main` is already undeployable. Every merge since `4dea09c` is stranded (section 1.3), so each day of waiting strands more work.
2. Option A's content is merged, passes the build gate locally and matches the fingerprint #250 pins. Nothing new needs review apart from the binding change.
3. A cutover here is low cost. The established practice is a fresh owner invitation, re-enrollment and key-policy initialization (October 2–4 records: at least five empty-database cutovers in three days, for example releases `40e45c39-…` and `7c4f9344-…` on October 2, `5dfb930c-…` on October 3, and `2295230d-…` and `ebe32e52-…` on October 4). Bundling saves at most one reset and costs days of blocked deploys.
4. Until the second cutover, keep schema PRs (#252, WH-093, later WH-1xx) **unmerged** (as open PRs, not merged to `main`). Merging any of them re-blocks `deploy ci` until that cutover.

**Ordering for the later batch:** merge in dependency order to a single integration point (#252 → WH-093 → WH-1xx children). Re-baseline #250 against the final inventory. Then follow this same procedure with the merged `main`.

## 3. Test data the cutover destroys and what must be re-created

Prepare/apply copies **no** row from the old database (`tools/current-schema.mjs:18`; [releases, Current schema and account resets](releases.md#current-schema-and-account-resets)). The old database keeps its rows untouched; it simply stops being bound. Every class in [`data-lifecycle.json`](data-lifecycle.json) becomes empty on the platform, including:

| Class (`data-lifecycle.json`) | Tables (examples) | Consequence | Re-create / action |
| --- | --- | --- | --- |
| `owner-identity`, `owner-identity-progress`, `owner-identity-admission`, `owner-identity-kits` | `users`, `identity_accounts`, `identity_credentials` (passkeys), `identity_sessions` | Every account, passkey and session is gone; existing passkeys on devices become useless for this platform | Owner re-enrolls with a fresh invitation (two-key enrollment); old device passkeys can be removed from the devices |
| `identity-invitations` | `invitations` | Unused invitations stop working | `pnpm invite` (authorization item A8) |
| `projects`, `site-versions`, `project-configurations`, `conversation`, `project-media`, … | `projects`, `project_spec_*`, Chat turns | All test projects, specifications and Chat history disappear from the platform | Recreate synthetic fixtures as needed |
| `connections` | `github_token_vault`, `cloudflare_token_vault`, OAuth exchanges/outcomes | **Encrypted provider tokens become unreachable**, so their grants can no longer be revoked through Whumpo ([account closure, step 5](account-closure.md)) | **Before cutover:** count connected credentials and unresolved OAuth exchanges; if any, disconnect/revoke first or accept orphaned provider grants explicitly |
| `platform-operations` | `connection_key_registry`, `connection_key_policy`, `cms_platform_deploy_lock` | Key policy and registry must be re-initialized. The keyring **secret** `CONNECTION_ENCRYPTION_KEYRING` stays on the Worker | Register the existing key ID with the verified encrypted capsule ([connection-key lifecycle](connection-key-lifecycle.md#encrypted-operator-key-backup); [protection candidate](protection-candidate.md): key `test-20261002`, policy revision 1). Without it, credential work is refused (item A7) |
| `billing` | `stripe_customers`, `stripe_subscriptions`, … | Links to **Stripe sandbox** customers/subscriptions are lost; sandbox objects remain in Stripe | Preflight count; if any active sandbox subscription, decide (cancel in sandbox, or accept orphan). No real money is involved (sandbox) |
| `domains-dns` | `domain_claims`, `domain_connections`, `cloudflare_dns_actions` | Any provider hostname created for a domain connection is orphaned from its record | Preflight count must be zero, or run a hosting **retirement review** first (`tools/reconcile-domain-hosting.mjs`, [domains](domains.md)). The September 30 preflight found no SaaS hostname quota on `whumpo.site`, so none is expected (UNVERIFIED live) |
| `cms-resources` | `cms_instances`, `cms_deployments` | **A nonempty registry blocks the reset outright** (`tools/prepare-release.mjs:59`) | Must be zero. Otherwise a separate CMS resource-retirement decision is needed (owner-deferred CMS; no review-file field overrides it) |
| `restricted-safety-cases`, `safety-case-access`, `operator-containment` | `safety_cases`, `safety_preservation_holds`, `safety_case_roles`, `operator_containments` | Preserved evidence and the role administrator are gone from the platform (the old database keeps them while it exists) | Preflight: zero active holds/cases expected in test. Afterwards bootstrap the first safety-case role administrator ([content safety](content-safety.md); `tools/safety-case-bootstrap.mjs`, item A9) |
| `guest-feedback`, `visitor-identity`, `visitor-app-data`, `module-*`, `contacts` | Guest links, visitor passkeys, app data, module records | Visitor-side test data disappears | Recreate fixtures if needed |
| R2 `FILES` (not in D1) | `whumpo-files` objects | Objects referenced by old rows become **orphans**; the cutover does not delete R2 | Preflight object count (earlier cutovers required "empty private R2", [chat routine release](chat-routine-release.md)); decide whether to clean up afterwards |

**Not destroyed (persist on the Workers):** runtime secrets such as `TURNSTILE_SECRET`, `TURNSTILE_SITE_KEY`, `AI_API_KEY`, `STRIPE_TEST_KEY`, `STRIPE_WEBHOOK_SECRET`, GitHub/Cloudflare OAuth client secrets, `CONNECTION_ENCRYPTION_KEYRING` (the names checked by `tools/secret-custody.mjs`). Apply refuses to drop a previously bound secret name (`tools/release-manifest.mjs:86`). Routes, the custom domain and cron schedules come from the archived configuration.

**Irreversible or unknown steps:**

- CMS registrations, if any exist, block the reset, and retiring them is a separate owner decision (CMS testing is owner-deferred).
- Provider grants (GitHub/Cloudflare OAuth) whose tokens exist only in the old database cannot be revoked by Whumpo after the switch.
- Provider hostnames tied to domain connections need a retirement review; a hostname/time match alone does not establish ownership (`tools/reconcile-domain-hosting.mjs` usage text).
- Deleting the old database is irreversible and removes the emergency rollback path (section 4.5).
- The key-policy initializer: the repository has the domain function (`initializeConnectionKeys` in `src/connection-rotation.ts`) and the backup CLI (`tools/connection-key-backup.mjs init|create|verify`), but **no CLI that registers the policy in a remote database**. The October 2/3 records say it was done "with the actual domain initializer … using the verified stored capsule". **UNVERIFIED:** the exact command, whether the capsule and recovery file for `test-20261002` still exist on the operator machine, and whether the October 4 (#160) cutover re-initialized the policy at all ([releases](releases.md#pr-160-shared-modules-and-contact-email-cutover--october-4-2026-utc) does not mention it).

## 4. Procedure

### 4.1 Local checks (no credentials; an agent may run these)

Run on the exact cutover commit, with `TMPDIR` set to a directory under `$HOME` on this host:

```sh
corepack pnpm install --frozen-lockfile
corepack pnpm check && node tools/verify.mjs fast && node tools/verify.mjs protection && corepack pnpm build   # the Workers Builds gate
node tests/current-schema.mjs        # actual local D1 initialization/readback
node tools/roadmap.mjs validate && node tools/roadmap.mjs render --check
node --input-type=module -e "import {currentSchemaArtifact} from './tools/current-schema.mjs';const a=await currentSchemaArtifact();console.log(JSON.stringify({sqlSha256:a.sqlSha256,expected:a.expected}))"
node -e "console.log(require('./.secrets/build-snapshot.json').inputs.sha256)"   # after pnpm build
```

**Already run for this plan on `89fa009` (`origin/main`), October 9:** the full gate passed (8 fast + 15 protection scripts, including `deploy-ci`, `build-snapshot`, `release-manifest` and `release-provider`, then the build), and `node tests/current-schema.mjs` passed. The artifact printed `sqlSha256` `b035ce44…` and inventory `42d5aaa7…` (221/1063). The build-inputs digest at `89fa009` was `323e34c99020157b10217be6617d9d0733731f440ebb55defa36356ddd707e86`. This is informational only: the binding change alters the inputs, so recompute it on the cutover commit. The build rewrote the generated `public-app/visitor.js` (dependency-path comments, as noted in earlier release records); restore it with `git checkout -- public-app/visitor.js` so that `prepare` does not record a dirty checkout.

### 4.2 Pre-flight readbacks (need authorized Cloudflare access; listed as items A1–A4)

Run by the owner, or by an agent the owner has authorized for each named item. Record the UTC time and the result.

1. **D1 inventory** (A1): `wrangler d1 list`, confirm `whumpo-control-2026-10-04` (`dba4c707-…`) exists. UNVERIFIED: whether the October 4 baseline `whumpo-control` (`418b20b6-…`) still exists. [Releases](releases.md) says it "remains (not deleted)", while [deployment, Current resources](deployment.md) still lists it as **the** D1, which is stale relative to `wrangler*.jsonc`.
2. **Platform aggregate counts** (A1): `node tools/account-closure-inventory.mjs` (read-only, one SELECT, no identities). Record accounts, projects, sessions, provider credentials, OAuth exchanges, domains, CMS registrations, guest links, module instances and active preservation holds.
3. **CMS registry must be empty.** This is shown by `prepare` itself; it refuses otherwise (`tools/prepare-release.mjs:59`).
4. **R2 object count** for `whumpo-files` (A1). UNVERIFIED: the exact command used by earlier cutovers is not recorded in the repo.
5. **Stripe sandbox**: active sandbox subscriptions linked in `stripe_subscriptions` (from item 2, or a direct read-only count).
6. **Key custody**: confirm the `test-20261002` capsule and recovery file exist and verify with `node tools/connection-key-backup.mjs verify --backup-file … --recovery-key-file … --expected-digest …`. This is local, but reads private key files, so the owner should run it.

### 4.3 The cutover itself

1. **Create the new empty D1** (A2), for example `whumpo-control-2026-10-DD`. Record its ID. Confirm it is empty and bound to no Worker.
2. **Binding PR (docs and config only, no merge yet):** change `database_name`/`database_id` for the `DB` binding in `wrangler.jsonc`, `wrangler.apps.jsonc` and `wrangler.sites.jsonc` (all three must be identical, `tools/prepare-release.mjs:54`). The PR description must say: schema change, owner cutover required, do not merge before the cutover (the owner operating rules (AGENTS.md, removed from this repository); [deployment](deployment.md)).
3. On that branch, rerun 4.1. Write the private review `.secrets/release-review-2026-10-DD.json` (exact format from `tools/release-manifest.mjs:48-55`; retired fields `migrations`, `previousWorkersCompatible`, `restoreReview` and `restoreEvidence` are rejected):

   ```json
   {
     "version": 3,
     "environment": "test",
     "buildInputs": "<inputs.sha256 from .secrets/build-snapshot.json on the cutover commit>",
     "review": "<actual source and mixed-Worker review: commit SHA, what changed since 033e7d9 (#186 operator controls + later non-schema commits), inter-Worker contracts unchanged>",
     "mixedWorkersCompatible": true,
     "schemaChange": "initialize",
     "schemaSha256": "b035ce44331131b8fe2d32429b7152c1badaad344b0edefd2f93f579026c8c22",
     "testDataResetAuthorized": true,
     "cutoverReview": "<owner authorization reference (conversation and date), new database name/ID, preflight counts from 4.2, decision on old database, CMS registry empty>"
   }
   ```

   - `schemaSha256` is the **complete-SQL** digest for Option A. For any other bundle, recompute it.
   - `testDataResetAuthorized: true` is the owner's reset authorization. Without it, `initialize` is refused.
   - **No CMS field exists.** A nonempty CMS registry cannot be waived in the review; it needs separate retirement first.
   - **Mixed-Worker interval:** apply deploys runtime → apps → sites → platform. Between the apps/sites deploys and the platform deploy, apps and sites read the **new empty** database while the platform still uses the old one ([releases](releases.md#current-schema-and-account-resets): "not a zero-downtime claim"). Acceptable only because there are no customers. State that in `review`.
4. `pnpm run deploy prepare .secrets/release-review-2026-10-DD.json` (A4). It compiles the four Workers with `wrangler deploy --dry-run`, reads the baseline and seals `.secrets/releases/RELEASE_ID/`. **No remote mutation.** It refuses when the target database is bound to an active Worker, when CMS registrations exist, on a build/digest mismatch, or when the baseline changes during preparation.
5. `pnpm run deploy status RELEASE_ID` (A5, read-only): `reconciliation: "ready"`, schema `observed.objects` = 0 for the target, `cmsRegistryMatches: true`.
6. **Go/no-go** (4.4).
7. `pnpm run deploy apply RELEASE_ID` (A6). It takes the lease in the **baseline** database (`tools/release-provider.mjs:46`), initializes the new database with `wrangler d1 execute DB --remote --file payload/schema/current.sql` (`tools/release-provider.mjs:73-76`), then deploys runtime → apps → sites → platform, journaling each step. On any error it stops with `needs-reconciliation`. **Never re-run an uncertain step by hand** ([releases, Recovery decisions](releases.md#recovery-decisions)).
8. Post-cutover verification (4.6). Then **merge the binding PR** (A11). Workers Builds then runs `deploy ci` on `main`; its preflight should pass (live schema = commit schema, configured `DB` = live `DB`, CMS empty) and redeploy the same code. A green Workers Builds check on that merge commit is the proof that `deploy ci` is unblocked.

Freeze merges to `main` from step 4 until step 8. A merge in that window is harmless (CI refuses at preflight), but it makes the deployed source differ from `main` until the binding PR merges.

### 4.4 Go / no-go criteria

**Go only if all hold:**

- The owner has authorized, in the current conversation, each remote item to be run (section 6), naming it.
- The local gate and `tests/current-schema.mjs` pass on the exact cutover commit, and `git status` is clean apart from the documented generated-file noise.
- `prepare` succeeded, and `status` shows `reconciliation: "ready"`, the target database empty, the CMS registry empty and the baseline matching.
- Preflight counts (4.2) show zero CMS registrations, zero connected provider credentials and unresolved OAuth exchanges, zero domain connections with provider hostnames, and zero active preservation holds/cases. Any nonzero count has an explicit owner decision recorded in `cutoverReview`.
- If credential work is expected after cutover, the key capsule verification for `test-20261002` passes.
- No other operator or Workers Builds run holds the deployment lease. Confirm no build is in progress.
- The old database will be left untouched until the journal is `deployed` and verification passes.

**No-go:** any refusal from `prepare`/`status`, an unexplained nonzero preflight count, a missing key capsule when connections matter, a dirty checkout with real source changes, or an operator who is not available to follow through to 4.6.

### 4.5 What "rollback" means here

There is **no rollback command** in this protocol ([releases](releases.md#recovery-decisions): "no rollback command is part of this protocol"); recovery is forward. Concretely:

- **Before apply:** abandon the archive; nothing remote changed except the new empty database (delete it or reuse it).
- **Schema initialization failed:** never replay into a partially initialized database. A terminally failed attempt may be discarded in favour of a **newly created** empty database and a new prepare.
- **Partway through the Workers:** the journal shows which steps are confirmed. Establish the terminal state of the uncertain step, then `apply` again to resume (confirmed steps are skipped). The lease stays in the baseline database, so **the old database must not be deleted before the journal completes** ([releases](releases.md#current-schema-and-account-resets)).
- **Emergency outside the protocol:** Cloudflare can roll a Worker back to an earlier version, which brings back that version's bindings, including the old `DB` ([Workers rollbacks](https://developers.cloudflare.com/workers/configuration/versions-and-deployments/rollbacks/), checked October 9, 2026). This puts old code back on the old database (which still has the old schema). That is an older binary as a running mode, which the [current-version policy](current-version-policy.md) does not support; it bypasses the lease and the journal, which must then be reconciled. Use it only on an explicit owner instruction. It needs the old database to still exist (Cloudflare documents rollback limits when bound resources have changed or been deleted).
- **Keep the previous database (`dba4c707-…`) untouched** at least until verification passes and the binding PR is merged. Deleting it is a separate destructive decision (A12).

The CI archives of earlier releases live only on the Workers Builds machine ([deployment](deployment.md)); there is no local archive of the currently live `033e7d9` release to re-apply.

### 4.6 Post-cutover verification

1. `pnpm run deploy status RELEASE_ID`: journal `deployed`; all four `candidateTagMatches: true`; `schema.observed` equals the target (221/1063, `42d5aaa7…`); `cmsRegistryMatches: true`.
2. Independent readback, recorded with UTC times (pattern from the October 2–4 records): four active versions and tags; all three `DB` bindings select the new ID; service bindings and secret names unchanged; platform assets match the archive (38 files under `dist` at `89fa009`; compare to the archive, not to this count); `GET /` and `/api/health` 200; anonymous `/api/chat` and `/api/profile` 401; an unregistered customer subdomain 404. `node tools/probe-health.mjs https://whumpo.com` covers the health check (no credentials).
3. Key policy initialization and registry fingerprint readback (A7), before issuing any invitation (the order recorded in [protection candidate](protection-candidate.md)).
4. `pnpm invite` (A8). The invitation file is written privately under `.secrets/`; never paste the code.
5. Signed project-first HTTP check: the synthetic two-key ES256 identity from `tests/helpers/live-workspace.mjs` (`seedCurrentProbeIdentity`) through an opt-in live suite, for example `RUN_LIVE_SPECIFICATION=1 node tests/specification-live.mjs` (A10). It writes a synthetic account into the remote database, calls the configured model and must clean up `.secrets/specification-live-account.json`.
6. Owner re-enrollment through the invitation; then `node tools/safety-case-bootstrap.mjs --grant ID --account UUID` (dry run), then `--apply` (A9).
7. Merge the binding PR (A11). Confirm the Workers Builds check on the merge commit is `success`.

### 4.7 Documentation updates required afterwards (same PR as the binding change, or a follow-up)

- [`docs/releases.md`](releases.md): a new dated section in the October 4 format. Include the release ID, source commit, new database name/ID, both digests (complete SQL `b035ce44…` and inventory `42d5aaa7…`), 221 tables/1063 objects, initialization time, the four Worker versions, readback time and results, CMS registry empty, key policy state, the private invitation file name, the disposition of the old database(s), and what was **not** done. Update the header paragraph (line 3), which still describes the October 3 release as current.
- [`docs/deployment.md`](deployment.md) "Current resources": replace the stale D1 row (`418b20b6-…`) with the new database.
- `README.md` lines 9 and 52: replace "awaits an owner-authorized cutover" with the dated cutover reference.
- [`docs/capacity-and-fairness.md`](capacity-and-fairness.md) line 258: WH-050 status "Not deployed … No cutover was run" → deployed in the dated cutover (still not rehearsed/accepted unless that is done).
- This plan: mark it **EXECUTED on DATE**, or superseded, with a link to the releases section.

## 5. Owner decisions

| # | Decision | Options | Recommendation |
| --- | --- | --- | --- |
| D1 | Bundle composition | A / B / C / D (section 2.4) | **A** (main as is); batch #252 + WH-093 + WH-1xx later |
| D2 | Timing | As soon as an operator can follow through to merge, or wait | **Soon:** every merge since `4dea09c` is stranded. Choose a window with a merge freeze and no Workers Builds run in progress |
| D3 | Who runs the remote steps | Owner by hand, or an agent with per-operation authorization | Either is allowed (AGENTS.md permits an agent "only with the owner's explicit authorization in the current conversation"; [deployment](deployment.md) line 15 reads as owner-only for prepare/apply). **Recommend:** the owner runs A4–A6 (they need the private review and key material); an agent may run A1/A5 reads and the post-cutover readbacks when named |
| D4 | Old database `whumpo-control-2026-10-04` (`dba4c707-…`) | Keep for N days, or delete after verification | **Keep** until the binding PR is merged and one routine CI deploy has succeeded; then decide deletion by name (A12) |
| D5 | Older baseline `whumpo-control` (`418b20b6-…`), if it still exists | Keep or delete | Verify existence first (UNVERIFIED); if unbound by all Workers, retire it in the same reviewed deletion step |
| D6 | Data to preserve | None (default), or specific rows | **None.** Test-only, and policy forbids preservation migrations ([current-version policy](current-version-policy.md)). Copying rows is not supported by the tooling |
| D7 | Nonzero preflight counts | Provider grants, Stripe sandbox subscriptions, domain hostnames, safety holds, R2 objects | Revoke or disconnect provider grants **before** cutover; accept or cancel sandbox subscriptions explicitly; a hostname retirement review if any; R2 orphan cleanup as a later reviewed step |
| D8 | Key policy | Re-register the existing `test-20261002` (revision 1), or rotate to a new key | Re-register the existing key with its verified capsule (no secret change). Rotation is a separate WH-117 decision |
| D9 | Schema PRs while waiting for the second batch | Merge now (re-blocks CI), or keep unmerged | **Keep unmerged** until the next scheduled cutover |

## 6. Operations that need explicit owner authorization

Each line is a separate authorization. Authorizing one does not authorize the next (the owner operating rules (AGENTS.md, removed from this repository): "Authorization covers only the operation asked for").

| ID | Operation | Remote effect | Blast radius |
| --- | --- | --- | --- |
| A1 | Read-only inventory: `wrangler d1 list` / `wrangler d1 info NAME`; `node tools/account-closure-inventory.mjs`; R2 object listing for `whumpo-files`; Worker version/binding reads | Reads only | None to service; exposes private metadata to the operator's terminal |
| A2 | `wrangler d1 create whumpo-control-2026-10-DD` | Creates one empty D1 database | New resource only; live traffic unaffected. Storage cost negligible but account entitlement/pricing needs verification ([D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)) |
| A3 | (Optional) fence the unused invitation(s) in the old database under the deployment lock, as on October 3 | Deletes unused invitation rows in the old database | Stops enrollment into the soon-orphaned database during the mixed interval; irreversible for those rows |
| A4 | `pnpm run deploy prepare .secrets/release-review-…json` | Remote reads; local `wrangler deploy --dry-run`; private archive | None to service |
| A5 | `pnpm run deploy status RELEASE_ID` | Reads only | None |
| A6 | `pnpm run deploy apply RELEASE_ID` | Initializes the new database; deploys all four Workers; takes and renews the lease in the old database | **Whole test platform**: every account, session, project and link stops resolving; a mixed-database interval during the sequence |
| A7 | Key-policy initialization in the new database (command UNVERIFIED, section 3) | Writes the key registry/policy rows | Enables or blocks credential work; a wrong key ID cannot be rebound (`src/connection-rotation.ts` contract) |
| A8 | `pnpm invite` | Inserts one invitation row | One single-use, seven-day invitation |
| A9 | `node tools/safety-case-bootstrap.mjs --grant ID --account UUID --apply` | Grants the first safety-case role administrator | Role authority over restricted cases; only while no administrator exists |
| A10 | Opt-in live suites (`RUN_LIVE_*=1 node tests/*-live.mjs`) | Synthetic rows in the remote database; real model calls | Model spend; leftover fixtures if cleanup fails |
| A11 | Merge the binding PR to `main` (the owner merges; agents do not push or merge to `main`) | Workers Builds runs `deploy ci` and redeploys four Workers | Same code redeployed onto the new database |
| A12 | `wrangler d1 delete NAME` for an old database | Deletes a database | **Destructive and irreversible.** Needs a separate explicit confirmation naming the resource (the owner operating rules (AGENTS.md, removed from this repository)); only after the journal completes and every Worker binding is checked (the October 3 practice checked all account Workers); removes the emergency rollback path |
| A13 | Stripe sandbox subscription cancellation, provider grant revocation or hostname retirement (if D7 requires) | Provider writes | Per resource; sandbox only for Stripe |
| A14 | `wrangler rollback` of any Worker (emergency only, section 4.5) | Reactivates an older version and its bindings | Out of protocol; requires journal reconciliation afterwards |

## 7. UNVERIFIED items and how to verify them

| Item | How to verify |
| --- | --- |
| The failures since `4dea09c` are the schema refusal | Workers Builds logs for builds `32f0b102-…` and `e68f7ab9-…` (dashboard) |
| Cause of the 05:31 UTC failures on `cf39edd`/`92a001f` | Their build logs (lease contention suspected) |
| Live schema is still `68617fbf…` and the platform is bound to `dba4c707-…` | A5 `status` after `prepare`, or A1 reads |
| Live Worker versions (expected: the CI release of `033e7d9`) | A1 version reads |
| Live data counts (accounts, passkeys, projects, connections, Stripe sandbox links, domains, CMS, holds) and R2 objects | A1 (`account-closure-inventory`, R2 listing) |
| Whether `418b20b6-…` (and any other old test databases) still exist | A1 `wrangler d1 list` |
| Key policy present in the current database; capsule and recovery file present locally; the exact initializer command | Owner check of the private files; read `connection_key_policy` (A1); locate the operator script used on October 2–3 |
| Turnstile and other secret **names** still bound | `prepare` records them; apply refuses to drop one |
| D1 creation entitlement/pricing on this account | Cloudflare account plan page / [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |

## 8. Backlog

No roadmap task exists for this cutover (`docs/roadmap/backlog.json` has no task whose purpose is the cutover; WH-002's cutover contract is delivered). This plan therefore adds no backlog entry or evidence string. The schema children (WH-156, WH-170, WH-181, WH-194, WH-201) each carry their own cutover scope line.
