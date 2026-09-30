# Fair-use review records

## Internal review foundation — September 30, 2026

Status: operator CLI implemented and review storage configured in the test database; not connected to customer request handling. Migration `0091_fair_use_reviews.sql` and `src/fair-use-reviews.ts` persist an internal review and its final decision. This implements the recordkeeping portion of the [fair-use policy](pricing-and-model-policy.md#unlimited-standard-ai-under-fair-use--september-29-2026-decision). It does not implement customer notices, enforcement appeals, restrictions or finance verification. A separate [customer-initiated usage-review channel](usage-review-requests.md) now implements guided requests and intentional operator responses without exposing these internal records.

A review records its account, policy version, operator-recorded plan label, category, reviewer and bounded context. Categories separate unrelated chat, project churn and legitimate capacity. Context should explain the relevant pattern and legitimate-work possibilities without copying raw customer prompts, source code or credentials. Operator identities and notes are private support data; do not expose these rows through customer APIs or send them to inference providers. For new reviews with migration 0092, the requested plan must match the current-period entitlement receipts. Earlier records without a snapshot retain their historical reviewer assertion; it is not upgraded into verified evidence. Entitlement receipts do not establish collected subscription revenue.

An open review can resolve once as legitimate use, insufficient evidence or a confirmed pattern. All three are historical findings, never authority to deny service. Original context, identity and policy scope are immutable. A later reassessment requires a new review; changing a plan or renewing a subscription does not rewrite history. Account deletion removes its reviews.

The service requires an exact account and caller-generated request UUID. Repeating an identical open or resolution returns the existing record, including after a lost acknowledgment. Reusing an ID with different context or resolving an already-decided case differently returns a conflict. Concurrent decisions cannot overwrite each other. SQL constraints enforce immutable scope and the single open-to-resolved transition; the account-scoped service refuses foreign records.

The local operator CLI uses the existing Wrangler/Cloudflare credential authorized for the configured control D1 database. There is no customer HTTP, model-tool or browser-dashboard mount. The reviewer name is an audit label supplied by the operator, not independently verified identity. Every returned mutation receipt explicitly has `enforcementEnabled: false`. The module never writes mode, Chat, billing, notices or restrictions. Monitor remains non-blocking and sends no customer warning.

## Remaining delivery path

- Reconcile verified provider expense and purpose evidence; current read-time observations deliberately keep unverified classification and shadow cost out of enforcement evidence.
- Add a browser operator interface with role-based authorization; the local CLI and bounded account history are available.
- Connect independently verified company finances and an audited, explicit operator mode decision.
- Add customer-visible notices with actual delivery receipts. Notice creation must not count as delivery, and Monitor must suppress notice delivery.
- The customer-initiated usage-review Chat path and preview/apply operator response are implemented separately. Bind future enforcement appeals to actual notice/restriction decisions and provide account-level access independent of Chat limits; never expose internal notes.
- Add dated restrictions with expiry/recheck and scope limited to confirmed offending categories; preserve maintenance, hosting, account access, export, backups, deletion and appeal.

Verification uses disposable D1, never a live customer review. `pnpm test:fair-use-reviews` covers owner isolation, immutable SQL scope, racing creation and conflicting decisions, exact replay, limits, deletion cascade and unchanged Monitor/Chat/billing state. `pnpm check` covers both TypeScript projects. No recurring service or external provider is added.

## Operator CLI

Run `pnpm review:fair-use --input PRIVATE_JSON_FILE` from the operator checkout. The input file must be at most 16 KiB. Output includes private review notes; keep it in the operator terminal or redirect it to an ignored private file. Never send it to customer Chat or model context. This command requires migration 0091 and Cloudflare access to the configured control database; it does not provision either.

Supported input shapes (use actual account/review UUIDs):

```json
{"action":"open","account":"ACCOUNT_UUID","id":"NEW_REQUEST_UUID","plan":"starter","category":"legitimate_capacity","reviewer":"operator-name","context":"Check whether the volume is normal client work."}
```

```json
{"action":"resolve","account":"ACCOUNT_UUID","id":"REVIEW_UUID","revision":0,"outcome":"legitimate_use","reviewer":"operator-name","resolution":"The customer maintains client websites; the exports are part of delivery."}
```

Open and resolve default to a read-only preview including the existing review, proposed request and `applyDigest`. Inspect that exact preview, then run the same command with `--apply DIGEST`. A changed account, scope, note or decision invalidates the digest. The digest binds intent, not database state: a concurrent incompatible decision still returns a conflict. An uncertain write must be read or retried using the same request ID. It must not be replaced by a new case.

Read a case with `{"action":"read","account":"ACCOUNT_UUID","id":"REVIEW_UUID"}`. List with `{"action":"list","account":"ACCOUNT_UUID"}`. History returns up to 25 reviews ordered by creation time and ID; pass the exact `nextBefore` object as `before` for the next page. It never lists accounts. Read/list reject `--apply`. Unknown fields/actions are refused before database access.

Disposable-D1 acceptance covers the complete preview/apply/read/list flow, changed-input refusal, exact mutation replay, resolving a contextual legitimate-use decision, tied-timestamp pagination without duplicates, foreign account isolation and unchanged Monitor mode. Both TypeScript projects pass. No actual customer review was created by these checks.

Test storage acceptance: the isolated release listed only migration 0091 as pending and applied it. Independent remote reads confirmed its migration receipt, both SQL guards, zero review rows and persisted `requested_mode=monitor`. Inactive Gateway migrations 0075/0076 remain unapplied. Evidence: `.secrets/fair-use-review-schema.json`. No Worker deployment or live customer review was needed. The platform remains version `3359f27b-34c1-4315-82d6-de97ba6ac72b`.

## Immutable observation snapshots — September 30, 2026

Implemented, with migration 0092 configured in test: new review preparation resolves the account's highest current-period entitlement receipt using the same tier ordering as the operator report. A mismatched requested plan is refused. At insertion, the service rechecks that plan and calendar period atomically; an upgrade or rollover between observation and save cannot silently assign an outdated tier to the case. Identical retries return the original case before reading new usage, including after a later upgrade.

The snapshot records its observation time, activity/cost windows, entitlement period/basis, completed AI turn count, project creations, ordered export/removal observations, separate Muse shadow estimates, coverage limitations and the shadow assessment. It contains no account/project identifiers, private prompts or source content. Actual provider expense remains null, purpose remains unclassified and enforcement remains false. This is a read-time operational observation, not an audited financial snapshot or proof of misuse.

The operator preview shows the current observation. Saving gathers a fresh snapshot and rechecks entitlement; the applied receipt contains the exact saved evidence. The preview digest binds the operator's intended account, plan, category and notes, not a promise that counters remain frozen while the operator reads them. Original snapshots cannot be edited or replaced when a review is resolved. Old rows keep a null observation rather than receiving invented historical usage.

Disposable D1 checks verify snapshot privacy, explicit unknown expense, immutable snapshots, current-plan mismatch, exact replay after upgrade, and refusal when a higher plan is granted between observation and insertion. Existing preview, pagination, review conflict and ownership checks remain in the same suite. The collection is internal-only and does not change admission, send a warning or fund inference.

Storage acceptance: only migration 0092 was pending in the isolated release. After applying it, independent remote reads confirmed the migration receipt, snapshot column and both new SQL guards, zero review rows and Monitor mode. Evidence: `.secrets/fair-use-review-snapshot-schema.json`. No Worker deployment, customer review or notice was created. `pnpm test:fair-use-reviews`, `pnpm check` and diff checks passed.
