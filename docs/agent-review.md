# Agent review

How a pull request is reviewed before it may merge. The owner adopted this on October 31, 2026; the repo rules are in [AGENTS.md](../AGENTS.md). CI computes the tier and checks for approval without secrets or a paid model: `tools/review-tier.mjs` and `.github/workflows/review-gate.yml`. `tests/review-tier.mjs` pins the rules below.

## Approval is a commit status

Approval is a commit status named `review:clean` with state `success` on the PR's **head commit**. It is posted only after every reviewer for the tier passes that exact commit and CI is green. A new push changes the head commit, so approval clears itself; nothing needs to remove it. The gate reads statuses with read-only permissions. The status is posted after the gate job has run, so re-run the "Review gate" job after posting it (the merge tooling reads the status directly and does not depend on that re-run). A label is not approval.

## Rules for every reviewer

- The agent that built a change never reviews it, and a reviewer runs on a different model from the builder's.
- A finding needs a **concrete failure scenario or a failing test** against untouched code: the input, the path, the wrong result. "Could", "might" and "consider" are not findings.
- Say what you ran. Provider errors can arrive as text inside a success; a reviewer that returns fast with nothing is requeued.
- Reviewers do not edit the branch.

## Tiers

Lines are additions plus deletions across the PR, from `git diff --numstat --no-renames` against the base, so a rename counts as a delete plus an add and both paths are checked.

| Tier | Size | Reviewers (Coordinator not counted) |
| --- | --- | --- |
| trivial | 10 lines or fewer | 2 |
| lite | 100 lines or fewer | exactly 4 |
| full | over 100 lines, or any path not on the safe list | 7 or more |

**The tier fails safe.** Everything is full unless it is on this allowlist, and the allowlist is small:

- `README.md`
- `docs/**/*.md`, except policy docs: `docs/legal/`, `agent-review.md`, `boundary-*`, `data-lifecycle*`, `data-protection.md`, `deployment.md`, `disaster-recovery.md`, `identity-authority.md`, `releases.md`, `security-risk-actions.md`, `tenant-*`
- `tests/*.mjs` (top level only), except the gate tests: `secret-custody`, `deploy-ci`, `boundary-*`, `tenant-*`, `verification-profiles`, `review-tier`, `agents-md-check`, `build-snapshot`, `release-*`, `restore-*`, `processing-boundaries`, `sqlite-authorizer`

Everything else is full whatever its size: all of `src/`, `schema/`, `tools/` (including `tools/review-tier.mjs`), `.github/` (including `review-gate.yml`), `android/`, `frontend/`, `wrangler*`, `package.json`, lockfiles, `.gitleaks.toml`, `.gitignore`, `SECURITY.md`, `AGENTS.md`, `CLAUDE.md`, binaries and any file type not listed above. The patterns are `isSafePath` in `tools/review-tier.mjs`; the test pins safe and refused paths.

**The tool does not grade itself.** In CI the gate runs `tools/review-tier.mjs` as it exists on the base branch, not the PR's copy, and the tool and the workflow are themselves full tier. Two limits: for the PR that first adds the tool, the base has no copy and the PR's copy is used (the job prints a warning); and the workflow file itself is read from the PR, which is why it is full tier and needs human-checked review.

## Roles and models

Models: **top = Opus**, **mid = Sonnet**, **cheap = Haiku**. Code is written on Sonnet, so a reviewer must differ from the builder's model: when the builder was Sonnet, mid roles run on Opus.

| Role | Looks at | Model |
| --- | --- | --- |
| Correctness | logic, edge cases, error paths | mid |
| Tests | does the test fail without the change, does it assert the claim | mid |
| Docs | claims match the code, planned vs implemented vs accepted | cheap |
| UI and accessibility | keyboard, labels, focus, contrast, 360 px | mid |
| Security | a PR review of the diff: injection, authz, secret exposure, CSRF, headers | mid |
| Tenancy and authority | owner scoping, cross-account reads and writes, [identity authority](identity-authority.md) | mid |
| Data lifecycle | retention, deletion, export, closure, [data lifecycle](data-lifecycle.md) | mid |
| Coordinator | not a reviewer: it raises no findings, only drops the unproven and gives the verdict | top |

Panels:

- **Trivial (2):** Correctness, Tests.
- **Lite (exactly 4):** Correctness, Tests, Docs, and a fourth that is UI and accessibility when UI changed, otherwise a second Correctness pass on another model.
- **Full (7 or more):** Correctness, Tests, Docs, Security, Tenancy and authority, Data lifecycle, and a seventh that is UI and accessibility when UI changed, otherwise a second Correctness pass on another model. Add a second Security pass on another model for money, secrets, schema and deploy changes.

The Security role here reviews one PR. It is not the scheduled no-network audit, which sweeps the repo on its own schedule and does not gate PRs.

## What NOT to flag

Every reviewer prompt includes the common list plus the list for its role.

**Common (all roles)**
- Style a formatter or the repo's existing compact style already settles: spacing, quotes, semicolons, line length, import order, naming taste.
- Rewrites or tidy-ups of code the PR did not change.
- Speculative issues with no failure path: "if someone later...", "in theory", "might scale badly".
- Anything `pnpm check` (type check, token and generator checks) or the gate (`verify fast`, `verify protection`) already proves.
- Lint-class nits the repo does not enforce, such as `no-replaceall`, preferred array methods or `const` vs `let`.
- Re-litigating a decision recorded in the docs (the [roadmap](roadmap/), [boundary audit](boundary-audit.md), owner decisions). Cite the record and move on; propose a change as a separate question.
- Requests for legacy readers, fallbacks, aliases or data-preserving migrations. The repo is current-version only ([policy](current-version-policy.md)).
- Missing features the PR did not claim.

**Correctness**
- Defensive checks for states the types or earlier validation already exclude.
- Performance worries without a measured or obvious unbounded input.

**Tests**
- Missing tests for code the PR did not touch, or for pure re-exports.
- Coverage percentages. Ask for a test only when you can name the regression it would catch.
- Suites outside the verify profiles by design: browser suites and the WH-054 tenant gates ([verification](verification.md)).

**Docs**
- Wording, tone and heading taste. Flag only a statement that is false against the code, or planned work presented as implemented.
- Historical dated paragraphs: they keep their own dates and are not re-verified.

**UI and accessibility**
- Visual preference with no contrast ratio, missing label, focus loss or unreachable control to show.

**Security**
- Theoretical attacks that need a secret or authority the attacker would not have.
- Missing rate limits on routes that already sit behind the documented limiters or Turnstile ([capacity](capacity-and-fairness.md)).
- Test fixtures and synthetic canaries that look like keys. Gitleaks is in CI.

**Tenancy and authority**
- Queries on tables with no tenant data, or already in `docs/tenant-classification.json` and covered by `tests/tenant-sql-surface.mjs`.

**Data lifecycle**
- Retention periods or classes already set in [data-lifecycle.md](data-lifecycle.md); flag only data the PR adds without a class.

## Verdicts

The Coordinator posts `review:clean` on the head commit when every reviewer for its tier reports no proven finding, the gate and CI are green, and any fix has a test that fails before it and passes after. Findings without proof are dropped, not argued. Merging then follows the owner's standing authority; a PR that needs the owner (schema cutover, new dependency, sending or checkout) still waits.
