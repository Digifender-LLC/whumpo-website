# Reviewed GitHub source backups

## Delivery and limits

The workspace's Connected accounts panel (also `/backup`) can select a GitHub App installation, a writable repository and a saved website version. The user reviews repository visibility, branch, version, destination folder, file list and source archive SHA-256 before explicitly confirming. Historical reviews and receipts remain visible after reload. No AI request or credit charge is involved. The deployed integration remains disabled until operator GitHub App configuration; real provider consent and a real commit still require acceptance testing.

An existing repository with an initialized default branch is required. TellUmo does not create repositories or initialize empty ones yet. Repository discovery pages contain 20 entries, with at most 50 pages per installation; installation discovery checks the first 100. A user can retain 100 backup reviews. Reviews expire after ten minutes. Expiring user tokens require reconnecting after eight hours; reconnecting invalidates pending reviews.

## Artifact boundary

Each backup adds readable files under `tellumo/PROJECT_ID/versions/VERSION_ID/`: `public/index.html`, `public/_headers`, `tellumo/site.json`, `README.txt` and, for photo versions, up to four checked JPEG assets. The exact deterministic source archive is used to bind the review to the saved artifact. The archive is unpacked on the server; GitHub receives readable files, not a ZIP. No workspace accounts, chat, runtime secrets, billing data or databases are included. Website text, photos and configuration are included, including in a public repository when explicitly selected.

Generic shared components remain platform-authored and reviewed. A customer's backup is never ingested into the cross-user component catalog. See the existing component reuse design for that separate boundary.

## Write protocol

1. Check TellUmo ownership and current encrypted user authorization. Read repository numeric identity, visibility, writable status, default branch and current commit. Build a bounded export and record immutable review fields in D1, including its SHA-256, expected Git subtree SHA-1 and branch head. A client UUID makes repeated review requests idempotent; changed inputs under that UUID are rejected.
2. Confirmation rechecks ownership, token identity, GitHub identity, repository identity, visibility, branch and source digest. Query the exact current Git tree: all existing ancestor paths must be directories and the version directory must either be absent or exactly match the expected tree.
3. Claim the review atomically in D1. An already matching tree produces a receipt without a provider write. Otherwise the current branch head must still match the reviewed head.
4. Use GitHub GraphQL `createCommitOnBranch`, with `expectedHeadOid`, additions only and no deletions. GitHub atomically checks the head and updates the branch, so a concurrent write cannot bypass the path inspection. The commit headline includes `[skip ci]`; this suppresses push/pull_request GitHub Actions, not every possible external integration or other workflow trigger. TellUmo creates no workflow, uses no paid GitHub feature, and does not guarantee a user's existing integrations are cost-free.
5. Read the resulting commit's version directory and verify its whole Git tree SHA. Persist a commit-bound source URL and one activity event.

If a request fails after dispatch, the result becomes uncertain. Further confirmations **only read** GitHub and may recover a matching copy. They never repeat a write. This applies even if the original request failed before GitHub received it. The user may prepare a new review; a matching version folder then avoids another commit. A response lost after D1 committed is recovered from the receipt. Files at conflicting paths are never replaced. Reconciliation at a later matching branch head proves the source exists at that commit; it does not assert TellUmo authored that commit.

## API and verification

Authenticated routes: `GET /api/connections/github/repositories`, `GET /api/github/backups`, `POST /api/github/backups/review`, `POST /api/github/backups/:id/confirm`. Writes retain the normal same-origin protection. Provider addresses and queries are fixed, API responses are bounded, and every request rechecks that the encrypted token remains active. Tokens never enter the browser, model, backup or receipt.

`node tests/github-backups.mjs` uses disposable D1 and controlled GitHub responses. It compares source-tree hashes against independent `git write-tree`, checks exact committed file bytes and concurrent confirmations, and exercises owner isolation, identity/visibility/head/path conflicts, malformed responses, matching copies, lost provider/database acknowledgements, expiry and immutable review fields. It performs no real GitHub write. This complements connection and export tests; it cannot prove live GitHub App permissions or provider behavior.

References:

- [GitHub commit mutation](https://docs.github.com/en/graphql/reference/commits)
- [Git branch and file input types](https://docs.github.com/en/graphql/reference/git)
- [Workflow skip rules](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)

Deployment verification (September 29, 2026): migration 0017 applied locally and remotely; main Worker `1409c6c3-b413-4da1-b033-fca16547c107`, public Worker `3327e78d-3a4a-4a39-988f-2e66135e0a55`. TypeScript, connection tests and backup tests passed. Local browser fixtures verified repository/version selection, review, confirmation receipt and callback reopening; the actual local deployment verified disabled configuration. Live signed-passkey checks verified authenticated empty backup history, anonymous denial, nonexistent confirmation denial, malformed review rejection, cross-origin rejection and zero AI units. The first immediate post-deploy check saw an old-route 404; the repeat passed after the new assets/routes were observed. All temporary live account records were removed. No real provider backup was attempted.


## Conversational backup workflow

The existing backup engine is available through guided chat commands without AI units:

- `/backups` lists owned reviews and historical receipts.
- `/github-installations` lists the connected App's active authorized installations (first 100; truncation is disclosed).
- `/github-repos INSTALLATION_ID [PAGE]` lists up to 20 writable repositories per page, with IDs, visibility and default branches; pages 1–50 are supported.
- `/review-backup VERSION_ID OWNER/REPO REPO_ID` prepares the same ten-minute source review as the panel. It shows visibility, exact saved version, branch, folder, files, byte count and SHA-256.
- `/confirm-backup REVIEW_ID` explicitly authorizes the existing expected-head commit workflow.
- `/check-backup REVIEW_ID` never authorizes a pending/expired review. It only observes already dispatched requests and does not resend a commit.

Reviews explicitly disclose that a public repository exposes source and included photos. Server-derived export contents exclude account credentials and chat history. The original chat review gets a confirmation button only after the complete authoritative receipt is saved; an interrupted transcript cannot expose a button beside an incomplete review. `/backups` recovers the exact saved review for explicit command confirmation. Once verified, the original review exposes an allowlisted immutable-commit GitHub link. Receipts are historical, not evidence of current repository visibility or retention.

Chat durably claims each turn and revision before dispatching any provider operation. Stale revisions, conflicting payloads, replays and lost claim acknowledgements cannot repeat dispatch. A saved external review can survive an interrupted final chat update; inspect `/backups`. Source backup uses the customer App credential only, never the platform's operator `gh` login. Connecting/disconnecting the account still uses Connected accounts.

AI actions allow only `backup/list`, `backup/installations`, `backup/repositories` and `backup/review`, with strict fields and bounded IDs/pages. The server replaces model prose with its receipt. Model confirmation, arbitrary paths/files, check/retry and mutation actions are rejected. Unknown repository identities require discovery; ambiguous targets require clarification. Configuration, tokens and storage bindings are internal options and are not serialized into prompts. Natural-language calls consume the standard AI allowance; malformed actions use the existing validation refund path.

`test:backup-chat` covers discovery, public-source disclosure, complete review/confirmation separation, tenant isolation, stale/concurrent/replayed turns, uncertain read-only recovery, lost chat claims and final transcripts, confirmation-button eligibility, free guided usage and the AI allowlist/token boundary. `test:github-backups` continues to verify the underlying independent Git tree hash, branch/repository/visibility conflicts, concurrent commits and lost acknowledgements. Real App consent and commit acceptance remain pending configuration; these controlled tests do not establish real GitHub acceptance.

Conversational deployment evidence (September 29): platform `9b595e8a-af4a-423d-85ad-e7f67f68a5c9`, public-site Worker `05f01772-e25a-475a-b88d-af68e7e55662`. TypeScript, build, backup-chat tests and existing backup regression tests passed. Local browser verification used a synthetic public-repository review, explicit confirmation, and an allowlisted commit link; no repository was changed. Live signed-passkey checks passed for empty owned discovery, missing-configuration gates, foreign-review rejection, no saved backup and zero guided units. Muse returned the authoritative backup-list receipt; usage settled at 7 units, zero held and no replay charge. Logout and temporary account cleanup passed. GitHub App setup remains absent; real consent and customer commits are not yet verified.
