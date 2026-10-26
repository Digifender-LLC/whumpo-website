# Paused Whumpo roadmap handoff

Owner requested a stopping point, all pending source saved to GitHub, and the active goal paused on October 3, 2026. This handoff is a checkpoint, not task, beta or MVP completion. Resume only on the owner's instruction.

## Authoritative development and release state

- Repository: https://github.com/zemdregon/whumpo
- **Resume development on `codex/identity-admission`**, using the commit containing this handoff. PR #79 stays OPEN and DRAFT. Its current source is newer than the older primary `main` checkout.
- Worktree on this host: see `git worktree list`. `/home/ender/Documents/Whumpo` is the older checkout described below.
- Last deployed runtime source: `f84eac35170d4caecd738e00b89f8bf6efcab432`. Release-evidence commit: `4aaa85baacc22487e28b253db15eb9aee255e66b`.
- Test platform Worker: `7890ab49-4c01-4a1e-90a8-2c3792e3f77c`, independently verified October 3 at `21:58:41.824Z`. All 40 served assets match; the other three Workers, bindings, 177-table/806-object schema and CMS registry are unchanged. See [release evidence](../chat-workspace-continuity.md#backendapp-safety-test-deployment--october-3-2026-utc).
- Latest roadmap count: **26/122 accepted parent tasks**. [WH-111/#100](https://github.com/zemdregon/whumpo/issues/100) remains open. The broader goal remains incomplete. GitHub issues own live claims/status; `backlog.json` owns scope/dependencies. Refresh both before resuming.

## Completed last increment

Site & app safety independently reads and withdraws a website, backend endpoint or visitor app through existing exact reviews. It stays available through profile/Chat/generated-dashboard outages, retains saved code/data, refuses stale or revoked authority and recovers interrupted responses without repeating mutations. Visitor-page withdrawal revokes sessions/challenges and prevents their in-flight writes. Seven local-D1 service scenario groups, existing backend/website regressions, twelve actual Orca speech checkpoints, mobile/large-text inspection, type/build/lifecycle/roadmap checks and separate anonymous live verification passed. Authenticated effects were verified locally; physical devices, installed-PWA suspension, human listening/support and customer acceptance remain open.

## Work stopped in progress: consolidated saved work

`src/saved-work-shape.ts` and `src/saved-work.ts` are **draft, unwired source**. They are not imported by the HTTP router or frontend and have not been deployed. The proposed read-only index projects existing owner metadata; it creates no schema/ledger or new mutation path. It covers Chat/forms, inference receipts, website/service reviews and saved results, backend/app operations, provider requests, media/source holds, sandbox checkout and usage requests. Deferred CMS and operator/visitor-private records are excluded.

Checkpoint verification: `pnpm --config.verify-deps-before-run=false check` passed both TypeScript projects and compiler consistency checks. One synthetic owner/empty current SQLite query compiled every UNION branch. That is syntax/schema evidence only: **no populated-state, local-D1, HTTP, browser, pagination, authority or behavior acceptance exists for this draft**. The first ad-hoc check passed the wrong process-argument shape to the fixture helper and failed before database setup; its corrected invocation passed.

Before wiring or calling this complete:

1. Audit every source/state/link against its current domain contract. Account-wide forms have a nullable project; the current inner project join must be corrected and tested. Submitted continuations must not be hidden merely because the form's admission expiry passed. Expired reviews, unknown provider effects and applied history need distinct truthful treatment. Photo upload and safety states must not imply clearance. App upgrade metadata is not an acceptance result.
2. Preserve ownership/current identity/retention and feature boundaries. The index must never expose code, answers, credentials, visitor documents, internal moderation evidence or provider raw payloads. A link and stored status confer no approval authority. Current domain readers and exact human reviews remain authoritative.
3. Add bounded pagination/filter tests, strict invalid inputs, cross-owner/current-identity loss, removed/retained records, lost-result discovery, and readonly/no-provider/no-inference assertions against real populated current fixtures. Preserve unknown results rather than inventing completion.
4. Wire the read-only APIs and an identity-gated Saved work page outside profile/Chat/dashboard readers. Fixed Dashboard/Account help access must remain independent of generated layouts. Reuse existing exact Chat/form/readback and safety destinations. Do not add routine action controls or replay mutations on navigation/refresh.
5. Include tab-local unresolved Chat/form/photo recovery using the existing validated stores, without copying answers/payloads into another store. Distinguish unsaved local state, absent server records and proven saved receipts. Clear private state on account change; fence late responses.
6. Verify current connected browser recovery, keyboard/screen reader, mobile/large-text/reduced motion and real state isolation. Current `SavedChatTurn` client validation should be reconciled with the schema's `uncertain` Chat status as part of this work.
7. Update feature/lifecycle/verification docs and the issue; only then use the normal build/release wrapper and independent verification if the increment is ready. Do not deploy this checkpoint as a completed feature.

Remaining WH-111 work also includes selected-project/provider-return continuity, navigation simplification and a configured human-support destination. The earlier support-address question is unanswered; do not invent an address. WH-112 owns whole-owner acceptance. The incoming portfolio thread reports legal-link integration work in #88/#91/#92 and a cookie-name discrepancy; treat that as unverified coordination context, inspect current issues/source before acting, and preserve Draft policy/adoption/formation status. The pause did not integrate or deploy legal changes.

## Older primary checkout preserved separately

The owner also requested all pending changes be saved. The older `/home/ender/Documents/Whumpo` checkout had **336 modified/new files** against `628c16fe596f335a92689761caa95ed0baaf23ae`. Its complete nonignored working contents are preserved on:

- Branch: **`codex/paused-primary-snapshot-2026-10-03`**
- Commit: **`1fc2108fdfb9aafdbcf945593936755704c8600c`**

A temporary Git index captured the files; current-file equality and the remote ref were checked. Its ordinary index, branch and working files were not changed, so that checkout still reports local modifications/untracked files relative to its old `main`. Their captured bytes are in the snapshot commit. This is an **unvalidated preservation snapshot**, not a merge, release, current-schema baseline, legal policy adoption or alternate development branch. It includes older documentation/legal/tooling/code work and obsolete schema material. Inspect and port relevant changes deliberately; never replace the newer active implementation or revive old protocols/migrations from it.

## Intentionally outside Git

These local files were excluded from both commits/snapshots. They are not portable through a Git clone:

| Local material | Locations / purpose |
| --- | --- |
| Credentials and private evidence | `.secrets/` in both checkouts; `cloudflare.key`, `opencode.key` in the primary checkout. Includes provider credentials, deployment receipts, logs and verification screenshots. Transfer required credentials securely if moving hosts; never commit or paste key values. |
| Dependencies | `node_modules` (a local symlink in the active worktree), `integrations/emdash/node_modules/`. Reinstall using the pinned package manager; the ignore rule now covers both a directory and a symlink. |
| Generated builds | `dist/`, `integrations/emdash/dist/`. Rebuild from source. |
| Local runtime/framework state | `.wrangler/`, `integrations/emdash/.wrangler/`, `integrations/emdash/.astro/`, `integrations/emdash/.emdash/`. Do not treat local caches as current remote state. |
| Private quality outputs | `.lighthouseci/`, `.quality-reports/`, `playwright-report/`, `test-results/`; additional isolated evidence under `/tmp/whumpo-*`. Tracked docs retain bounded results and reproduction commands, not the raw private evidence. |
| Explicitly ignored owner folder | `donteditme/` in the primary checkout. Preserved locally and not uploaded. |

Provider-key patterns were checked in the 336 snapshot inputs, including DOCX XML, without printing file contents; none were detected. This does not convert private evidence or ignored files into approved source.

## Resume setup and boundaries

Clone/fetch `codex/identity-admission`; use Node.js 24 and pnpm 11 (`package.json` pins pnpm). Install with `pnpm install --frozen-lockfile`, then check live issue #100, source, remote release and `docs/roadmap/{README,execution,alignment}.md`. Run focused checks appropriate to the next actual changes. Some fixtures require Playwright/browser/accessibility tools; see `docs/verification.md`. Do not run a production asset build while a frontend fixture HTML is active. No task-owned fixture or deployment process needs to remain running at this pause.

- All environments are **testing**, with current-version-only schemas/protocols. No legacy readers, compatibility adapters or numbered migrations. Disposable current-schema cutovers are authorized when needed.
- **CSAM implementation, Daybreak and CMS functional testing stay deferred.**
- Standard AI uses no customer credits under fair use; premium funding and provider activation remain separate gates. Existing Muse testing and Workers Paid allowances do not authorize new purchases or paid services.
- Keep exact human approvals, tenant boundaries, private R2, bounded guest execution and durable receipt identity.
- Deploy only through `node tools/deploy-platform.mjs`, with concrete current-source checks and independent live verification. Do not overwrite unrelated changing work or close PR #79.
- GitHub roadmap updates are owner-authorized; messaging other Codex threads is not authorized merely by receiving a message from them.
