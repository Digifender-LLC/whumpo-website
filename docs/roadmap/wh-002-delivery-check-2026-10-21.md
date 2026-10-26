# WH-002 delivery check — October 21, 2026 UTC

Finding: WH-002 (extend release manifests and rehearse partial deployment recovery) is already delivered on `main`. No implementation was made. This is a static read of the checkout at `71a1d1d`. No test, roadmap command, GitHub, Cloudflare or provider call was run, and no deployment was made.

## What was read

- `docs/roadmap/readiness-reconciliation-2026-10-20.md` lists WH-002 only under "other ready tasks", whose latest evidence does not claim unmerged work. It did not re-audit them.
- `docs/roadmap/backlog.json` WH-002 evidence (2026-10-01) records the archive/compiler-lock correction and focused acceptance against `aca1bc3`. [docs/releases.md](../releases.md#archive-input-correction-and-wh-002-acceptance--october-1-2026) holds the detail, and `docs/cutover-plan-2026-10.md` calls WH-002's cutover contract delivered.
- `tools/build-snapshot.mjs`, `tools/build.mjs`, `tools/deploy.mjs` and `tests/build-snapshot.mjs` include the compiler checker/lock inputs, fail closed on removal, and save the snapshot only if the build inputs were unchanged during the build.
- `tools/release-manifest.mjs` (format 2) pins the file inventory with per-file SHA-256 and a payload digest. It also records the archived build inputs, the exact current schema SQL digest with its before/expected fingerprints, the four-Worker order with a tag and bindings per Worker, and the CMS registration inventory. `verifyRelease` refuses any mismatch.
- `tests/release-manifest.mjs` injects a failure after each of the four Worker steps and resumes without duplicate deployment. It checks that nonempty CMS registrations and bindings survive, and that recovered source and assets validate against the original build snapshot.
- Recovery per step is documented in the "Recovery decisions" table of `docs/releases.md`. Destructive or initializing schema changes require data-reset authorization and a cutover review (`validateCompatibility`), and a nonempty CMS inventory blocks a reset.

## Acceptance mapping

| Criterion | Where it is met |
| --- | --- |
| Manifest pins each artifact and migration set before release | `release-manifest.mjs`; the numbered migration set was replaced by one pinned current schema (October 3 contract) |
| Failure after each Worker step has a recovery path | `tests/release-manifest.mjs`; `docs/releases.md` recovery table |
| Previous artifacts and CMS registrations recoverable | Immutable archives; CMS preservation tests |
| Destructive plans need separate review | `validateCompatibility` |

## Not verified in this session

Bash was denied, so `node tests/build-snapshot.mjs`, `tests/release-manifest.mjs`, `tests/release-lock.mjs` and `tests/release-bundles.mjs` were not re-run. Their passing status rests on the October 1 evidence. The claim that all four Worker versions are pinned comes from reading the source (per-Worker `tag` and baseline ids), not from a run.

`backlog.json` and `backlog.md` were not edited. Run `node tests/release-manifest.mjs` to re-confirm before relying on this. Full disaster recovery remains a separate gate.
