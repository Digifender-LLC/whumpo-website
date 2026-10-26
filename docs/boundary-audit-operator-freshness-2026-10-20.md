# WH-004 slice 7: operator commit-time identity recheck (October 20, 2026)

**Unverified: the new test was written from a static read and has not been run.** Bash was unavailable in this session, so no test, build or tool was executed. No existing file was changed, and that includes [`docs/boundary-audit.json`](boundary-audit.json), which still records the cell below as untested.

## Entry chosen

Registry entry `operator-safety-cases`, `freshness` cell ([boundary-audit.json:831-847](boundary-audit.json)): "Passkey proof under ten minutes, checked before the action and again in the committing SQL (the in-SQL recheck path itself is untested)."

The registry has eight "untested" remarks. Two are out of scope: the custom-domain owner join (slice 6) and the Origin routes (slices 4-5). Of the rest, I ranked this one highest-risk. It is the only one on a privileged surface: restricted safety cases, preservation holds and lawful disclosures. Its untested branch is also the one that makes revoking an operator mid-action effective. The others are admission 429 mappings (contact form, photo host), a held specification on the photo route, the backend-publication 503 digest branch and the apps-host forwarding.

## Code path

- [`src/safety-cases.ts:31`](../src/safety-cases.ts): `operatorPolicy` requires `freshPasskey:true`.
- [`src/safety-cases.ts:75-105`](../src/safety-cases.ts): `attempt()`. The pre-check is `assertCurrentIdentity` at [:83](../src/safety-cases.ts). The SQL `identity` predicate is built at [:79](../src/safety-cases.ts) and goes into the commit `gate` at [:91](../src/safety-cases.ts) and into the audit `CASE` at [:93-96](../src/safety-cases.ts). The batch runs at [:98](../src/safety-cases.ts), and a commit-time `unauthenticated` result becomes `IdentityError(409,'identity_changed')` at [:101](../src/safety-cases.ts).
- [`src/workspace-identity/authority.ts:50-68`](../src/workspace-identity/authority.ts): `identityPredicate`. The freshness clause `proof_at>unixepoch()-600` is at [:66](../src/workspace-identity/authority.ts).

## What the test asserts

[`tests/boundary-operator-freshness.mjs`](../tests/boundary-operator-freshness.mjs) is built like `tests/boundary-owner-authority.mjs`. It is standalone, uses local SQLite by default or local D1 with `--d1`, uses synthetic accounts and makes no network calls. Run it with `node tests/boundary-operator-freshness.mjs`. It is not wired into any npm script. It calls the real `openSafetyCase` with a reviewer that holds `case_reviewer`, through `interceptDatabase` ([tests/helpers/workspace-identity.mjs:19](../tests/helpers/workspace-identity.mjs)). The hook fires only on the committing audit statement, so it runs after the pre-check has passed.

1. **Revoked mid-flight:** the hook deletes the session. The test expects `409 identity_changed`, the hook to have been reached exactly once, no `safety_cases` or `safety_case_findings` row, and a final audit row of `denied`/`unauthenticated` for that reviewer.
2. **Aged mid-flight:** the session's proof starts 595 s old. The hook waits on the database clock until the proof is at least 600 s old, without editing the proof. The test expects the same four results as case 1. It also checks that the session row still exists, so the refusal comes from age rather than revocation, and that a retry is now refused by the pre-check with `proof_required`.
3. **Negative control:** a fresh session goes through the same interception and commits. The test expects the case and its first finding to be written and the audit row to read `allowed`/`ok`.

Known fragility: case 2 relies on the pre-check running within about 5 s of creating the session. If the host stalls longer than that, the assertion message says so.

## Follow-up (not done here)

Once the test has been run and passes, the `freshness` cell in `docs/boundary-audit.json` can cite it and drop "(the in-SQL recheck path itself is untested)". I left that edit out because of the add-only constraint.
