# Fair-use review records

## Internal review foundation — September 30, 2026

Status: implemented locally, not deployed or connected to customer request handling. Migration `0091_fair_use_reviews.sql` and `src/fair-use-reviews.ts` persist an internal review and its final decision. This implements the recordkeeping portion of the [fair-use policy](pricing-and-model-policy.md#unlimited-standard-ai-under-fair-use--september-29-2026-decision). It does not implement customer notices, appeals, restrictions or finance verification.

A review records its account, policy version, operator-recorded plan label, category, reviewer and bounded context. Categories separate unrelated chat, project churn and legitimate capacity. Context should explain the relevant pattern and legitimate-work possibilities without copying raw customer prompts, source code or credentials. Operator identities and notes are private support data; do not expose these rows through customer APIs or send them to inference providers. The plan label is a reviewer assertion, not a billing receipt or proof of current entitlement.

An open review can resolve once as legitimate use, insufficient evidence or a confirmed pattern. All three are historical findings, never authority to deny service. Original context, identity and policy scope are immutable. A later reassessment requires a new review; changing a plan or renewing a subscription does not rewrite history. Account deletion removes its reviews.

The service requires an exact account and caller-generated request UUID. Repeating an identical open or resolution returns the existing record, including after a lost acknowledgment. Reusing an ID with different context or resolving an already-decided case differently returns a conflict. Concurrent decisions cannot overwrite each other. SQL constraints enforce immutable scope and the single open-to-resolved transition; the account-scoped service refuses foreign records.

These are internal functions, with no HTTP, model-tool, operator dashboard or CLI mount yet. Authentication and operator authorization must be added at the eventual operator boundary. Every returned mutation receipt explicitly has `enforcementEnabled: false`. The module never writes mode, Chat, billing, notices or restrictions. Monitor remains non-blocking and sends no customer warning.

## Remaining delivery path

- Resolve actual entitlement and verified observation snapshots when an operator opens a case; keep unverified classification and shadow cost out of enforcement evidence.
- Add an authorized operator interface with bounded account-scoped history and review references.
- Connect independently verified company finances and an audited, explicit operator mode decision.
- Add customer-visible notices with actual delivery receipts. Notice creation must not count as delivery, and Monitor must suppress notice delivery.
- Add an authenticated customer appeal view and Chat action with private customer statements, operator responses and exact replay. Internal notes must not leak through it.
- Add dated restrictions with expiry/recheck and scope limited to confirmed offending categories; preserve maintenance, hosting, account access, export, backups, deletion and appeal.

Verification uses disposable D1, never a live customer review. `pnpm test:fair-use-reviews` covers owner isolation, immutable SQL scope, racing creation and conflicting decisions, exact replay, limits, deletion cascade and unchanged Monitor/Chat/billing state. `pnpm check` covers both TypeScript projects. No recurring service or external provider is added.
