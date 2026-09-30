# Customer usage-review requests

September 30, 2026. Customer-initiated requests and operator responses are deployed in the private test platform. This is a support channel, not evidence of abuse, delivery of a warning, an appeal decision or authorization to restrict an account. Monitor remains non-blocking. It does not change service capacity, billing, provider routes or internal fair-use review records.

## Customer flow

- Type `request a usage review: YOUR EXPLANATION` or `/usage-review YOUR EXPLANATION` in Chat. Statements are bounded to 950 characters; Chat retains its existing 1,000-character message limit.
- `show my usage reviews` or `/usage-reviews` lists the latest 25 requests. `/usage-reviews REQUEST_ID` reads the full owned statement and any customer-visible response; older known IDs remain readable.
- One open request is allowed per account. Read it before opening another. An answered request permits a new follow-up request. No response time, email, external contact or automatic change is promised.
- There are no default dashboard buttons and no model mutation action. Only the customer's explicit guided command submits a request. Guided reads and submissions use no inference or customer credits.

Request insertion shares the transaction with the Chat claim and revision. Replay uses the same Chat ID and exact original content. Lost acknowledgments do not create replacement requests. The database enforces owned guided turns, immutable statements and one terminal response. A racing different answer cannot overwrite the winner. Account deletion cascades; records cannot be independently deleted while the account exists.

## Privacy boundary

Migration 0097 adds a monotonic `ai_context_allowed` flag on Chat turns. Submission, help, list and detail commands in this flow store their turns with that flag disabled. Later orchestrator history excludes them; no acknowledgment model is dispatched for these guided requests. The flag cannot be re-enabled. This does not retroactively remove information the customer separately sends to the AI, nor does it redact secrets pasted elsewhere.

Customer reads select only request identity, statement, creation time, state, customer response and answer time. They do not read internal fair-use notes, observation snapshots or reviewer identities. Operator identity is an audit label, never included in the customer response projection. Operators must write an intentional customer-visible response, not copy private investigation notes.

## Operator response

Use `node tools/respond-usage-review.mjs --input PRIVATE_JSON_FILE` with the existing operator credential for the configured control database. The tool is not mounted on a customer endpoint or exposed to the model. Input/output contain private customer statements; keep them in private operator storage, not model context or public logs.

Input shapes:

```json
{"action":"list","account":"ACCOUNT_UUID"}
{"action":"read","account":"ACCOUNT_UUID","id":"REQUEST_UUID"}
{"action":"answer","account":"ACCOUNT_UUID","id":"REQUEST_UUID","response":"Customer-visible response","operator":"Operator audit label"}
```

An answer first returns the exact request/current record and `applyDigest`. After reviewing the customer-visible response, apply using the same input plus `--apply DIGEST`. Changed input invalidates that digest. The digest binds the response intent; concurrent answers still recheck the stored open state. Identical answer retries return the saved response. An uncertain write must be read or retried with the same identity/text, never replaced blindly. No actual customer response is sent as part of development tests.

## Remaining launch work

Customer-requested support is not the full enforcement appeal system. Verified notices, delivery receipts, restriction scope/expiry, appeals bound to actual restriction decisions and independent access when Chat is unavailable remain required. This Chat path currently shares the existing pending-request/conversation limits and onboarding gate. Those limits must not become a barrier to a future restricted customer's appeal. A separate account-level appeal entry and authorization need implementation before enabling restrictions. Operator notifications, service-level response commitments and a browser operator interface are not configured.

## Verification

Use `node tests/usage-review-requests.mjs` for disposable-D1 checks of submission/read/replay, tenant isolation, one-open enforcement, immutable context exclusion, racing operator responses, exact preview/apply, lost acknowledgments, provider-request privacy and account deletion. Actual customer messages and live operator responses are outside this test. Existing fair-use policy and observation tests remain separate; this feature does not enable them as blockers.

Passed: `node tests/usage-review-requests.mjs`, `node tests/standard-ai-chat.mjs`, `node tests/fair-use-policy.mjs`, `pnpm check`, release-checkout TypeScript checks, frontend build and loading checks. The private test database applied migration 0097 at September 30 16:08 UTC: all 97 migrations applied, none pending, all four guards present, Monitor persisted and zero customer requests. Private evidence: `.secrets/usage-review-migration.json`. No actual customer support response was authored or submitted.

Platform `828912b1-21d7-484d-ace4-c623f5c82173` deployed this feature. Independent September 30 16:11 UTC checks verified active version, all 16 frontend assets, health, anonymous private-route denial, recovery-origin denial, all 97 migrations with none pending, the private-context guard and persisted Monitor mode. Evidence: `.secrets/usage-review-release-verification.json`. No new paid service, notification integration, customer connection, CMS test or customer publication was added.
