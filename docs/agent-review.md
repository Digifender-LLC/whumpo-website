# Agent review

How a pull request is reviewed before `review:clean` is added. The owner adopted this on October 31, 2026; the repo rules are in [AGENTS.md](../AGENTS.md). CI computes the tier and checks the label without secrets or a paid model: `tools/review-tier.mjs` and `.github/workflows/review-gate.yml`. Both use the same rules as this page, and `tests/review-tier.mjs` pins them.

## Rules for every reviewer

- The agent that built a change never reviews it, and reviewers run on a different model from the builder.
- A finding needs a **concrete failure scenario or a failing test** against untouched code: the input, the path, the wrong result. "Could", "might" and "consider" are not findings.
- Say what you ran. Provider errors can arrive as text inside a success; a reviewer that returns fast with nothing is requeued.
- Reviewers do not edit the branch.

## Tiers

Lines are additions plus deletions across the PR (`git diff --numstat` against the base).

| Tier | Size | Reviewers |
| --- | --- | --- |
| trivial | 10 lines or fewer | 2 |
| lite | 100 lines or fewer | 4 |
| full | over 100 lines, or any sensitive path | 7 or more |

A sensitive path forces **full** whatever the size. Sensitive means auth, identity, money, secrets, schema, tenancy, deletion, deploy tooling or CI. In this repo (the patterns live in `sensitivePaths` in `tools/review-tier.mjs`):

- `.github/`, `.gitleaks.toml`, `SECURITY.md`, `AGENTS.md`
- `schema/`, `wrangler*.jsonc`
- deploy and release tooling: `tools/deploy*`, `tools/release-*`, `tools/prepare-release.mjs`, `tools/secret-custody.mjs`, `tools/artifact-protection.mjs`, `tools/build-snapshot.mjs`, `tools/verify.mjs`, `tools/database.mjs`, `tools/restore-*`
- gate tests: `tests/secret-custody.mjs`, `tests/deploy-ci.mjs`, `tests/boundary-*`, `tests/tenant-*`
- `src/` files for secrets, billing and Stripe, Turnstile, connections and OAuth, app auth, account closure and owner erasure, workspace identity, push, Android signing, and any `src/` file whose name has auth, identity, session, passkey, crypt, keyring, tenant, erasure or webhook
- `android/` signing, Gradle and manifest files

## Roles and models

Coordinate on a top model, use mid-tier for security and quality, and a cheap model for docs. A reviewer is never the model that wrote the code.

| Role | Looks at | Model | trivial | lite | full |
| --- | --- | --- | --- | --- | --- |
| Correctness | logic, edge cases, error paths | mid | yes | yes | yes |
| Tests | does the test fail without the change, does it assert the claim | mid | yes | yes | yes |
| Docs | claims match the code, planned vs implemented vs accepted | cheap | | yes | yes |
| UI and accessibility | keyboard, labels, focus, contrast, 360 px | mid | | if UI changed | if UI changed |
| Security | injection, authz, secret exposure, CSRF, headers | mid | | | yes |
| Tenancy and authority | owner scoping, cross-account reads and writes, [identity authority](identity-authority.md) | mid | | | yes |
| Data lifecycle | retention, deletion, export, closure, [data lifecycle](data-lifecycle.md) | mid | | | yes |
| Coordinator | merges findings, drops the unproven, decides the verdict | top | | | yes |

Trivial gets Correctness and Tests. Lite adds Docs and the UI role when UI changed, plus a second Correctness pass from another model to reach four. Full runs every role that applies and adds a second security pass on another model for money, secrets, schema and deploy changes.

## What NOT to flag

Every reviewer prompt includes the list for its role plus the common list.

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

A PR gets `review:clean` when every reviewer for its tier reports no proven finding, the gate and CI are green, and any fix has a test that fails before it and passes after. Findings without proof are dropped, not argued. Merging then follows the owner's standing authority; a PR that needs the owner (schema cutover, new dependency, sending or checkout) still waits.
