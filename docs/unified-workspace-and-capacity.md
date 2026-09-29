# Unified workspace and flexible capacity

## Product decisions

The three September 29 proposals are product context. The final proposal supersedes automatic upgrade suggestions in the first: **no automatic plan changes**, including under an agent-selected spending ceiling. Start at Starter ($17/month or $170/year) when paid subscriptions launch; permit an explicit choice of higher tiers for migrations. The current invite-only Explore preview remains free. Personal $30/$300, Business $79/$790, Business Pro $139/$1,390 remain unchanged. Annual domain eligibility remains unchanged and redemption remains disabled.

A plan will provide a flexible infrastructure cost envelope across object storage, compute, databases and ordinary processing. Remove prominent fixed storage inclusions. Preserve per-resource safety ceilings separately, including the preview's existing photo, request and execution limits. AI inference accounting remains a distinct internal budget. Do not mislabel AI build units as infrastructure capacity or display a fabricated overall percentage. Containers, GPU, dedicated servers and managed database clusters remain unavailable here; a dashboard card never provisions these services.

Infrastructure budgets, customer overage tariffs, normalization, tax treatment and provider reconciliation are **not yet specified**. Example amounts in the proposals are not tariffs. Consequently, the product saves draft preferences only; no additional paid capacity, subscriptions or overage charges are authorized or activated by these settings. Existing opt-in use of already-granted AI test credits is a different control.

## Plan and spending rules

- Overage protection starts off. Presets $0/$10/$25/$50/$100 plus a custom draft limit. Activation will require an explicit owner review of real prices and terms once billing exists. Stored draft choices must never auto-activate at launch.
- Prices shown for additional capacity must be normalized retail charges, not unexplained raw provider bills. Provider costs remain internal and require versioned tariff receipts.
- Account recurring maximum is the subscription charge plus authorized overages plus separately approved recurring add-ons; disclose tax and annual prepayment separately. An annual-plan monthly equivalent is not a monthly invoice.
- At 50% of authorized overages: inform. At 80%: warn. At 94%: urgent. At 100%: refuse new discretionary capacity. Prioritize existing critical services where feasible without promising unlimited uptime or bypassing the cap. Outstanding holds count against available capacity; lowering a limit cannot erase already-incurred charges.
- Capacity projection: sustained 75% monitor, projected 85% inform, 90% recommend a capacity review, 100% require review before expansion. Thresholds alone do not justify a more expensive plan.
- Recommend an upgrade if two consecutive complete billing periods show a candidate that fits the workload and costs less than the current plan plus retail overages/add-ons. A migration that cannot fit the current plan may warrant an earlier manual review. Never automatically execute.
- Recommend a downgrade only after two consecutive complete periods fit within 65% of the lower tier and reduce the total bill. Missing/partial telemetry cannot count as zero usage. Let users retain headroom.
- Upgrade quote credits unused subscription value and charges the positive price difference for the remaining interval, rounded up to cents. Preserve the renewal date for monthly and annual plans. Actual provider proration, taxes and promotions must be reconciled before approval.
- Downgrade takes effect at the next monthly or annual renewal after approval. No automatic mid-term refund.
- Dedicated resources have separately reviewed recurring prices and cancellation terms, outside the flexible pool. No purchases are enabled in the preview.

`src/capacity-policy.ts` implements deterministic preview quotes, warning thresholds and evidence requirements. It does not claim to enforce a provider billing ceiling. Before enabling variable charges, implement authenticated consent receipts, immutable tariff snapshots, atomic cost reservations, settlement/uncertainty accounting, monthly resets, notifications, verified workload admission and critical/discretionary scheduling. There is no public endpoint for injecting usage evidence into recommendations.

## Workspace

Chat is the first and default navigation item. Chat, Dashboard, Settings, Profile and workflow pages occupy separate full-width views; Dashboard never includes a side chat. There is no global header. Brand sits top left; Settings icon and private profile-photo button share the bottom sidebar row. Email and sign-out appear only in Profile. No Tools menu or Add Workspace button exists. An empty workflow list invites the user to ask Whumpo for a custom page. Existing pages remain customizable.

Default dashboard includes projects, AI test allowance and activity. Static account controls remain available independently of customization. Connections, domains, photos, billing and contact inbox render inside the workspace; sensitive passkey/recovery flows retain dialogs. CMS drafting/editing/review opens the Chat tab, rather than requiring the user to leave for a separate admin website.

Customers and the agent can arrange cards and add/rename/remove up to eight tabs. Each tab may filter to an owned project. Supported card types:

- Projects: recorded publication/service status and project actions.
- AI assistance: current account-wide test allowance, used/held units; never represented as infrastructure utilization.
- File storage: ready uploaded project photo bytes only; scope explicitly excludes CMS media and database storage.
- Activity: recorded owner activity with timestamps, optionally project filtered.
- Publishing desk: actual published CMS article counts and in-workspace content commands.
- Visitor traffic and processing performance: explicitly unavailable until telemetry is connected. No sample figures shown as real measurements.

Model action `workspace/read` returns the current revision/layout. `workspace/save` accepts only strict declarative JSON and a matching revision; no HTML, code, URLs, custom SQL, arbitrary metric values or permission changes. Preserve unrelated widgets/tabs. Settings and account controls cannot be hidden by layout data. The model cannot save capacity preferences. Each save rechecks project ownership. All data queries separately scope to the authenticated owner, including after ownership changes.

Migration 0054 adds per-owner layout and draft capacity preferences. Revisions prevent stale or concurrent overwrites. REST GET/PUT endpoints under `/api/workspace/` use the existing session, origin, request-body and rate limits. Dashboard refreshes on opening, explicit refresh and completed chat; it is not real-time telemetry.

## Verification / remaining work

`tests/workspace-dashboard.mjs`: real local D1, account isolation, invalid/foreign layouts, revision races, strict model authority, draft preferences without entitlements, honest missing metrics, monthly/annual proration, overage thresholds, break-even and complete consecutive-period requirements. Browser and HTTP checks are recorded in the acceptance log.

Remaining beyond this increment: production traffic/processing instrumentation; provider cost ingestion and complete-cycle history; calibrated budgets and tariffs; actual subscription/overage consent and settlement; notification delivery and scheduling; arbitrary customer-specific dashboard integrations through reviewed connectors. This document does not advertise those services as live.


## Profile and appearance refinement

Migration 0055 stores per-owner name, About me, explicit AI-sharing preference, day/night/device appearance, and one private avatar (prepared JPEG ≤256px and 32KiB, metadata stripped). Revision checks prevent stale writes. Profile email is displayed read-only: changing it awaits a verified-email flow. No avatar URL or email enters agent context. Name/About me enter only after opt-in and remain untrusted personalization data, never tool authority. Turning sharing off removes them from future context; it does not retract data already sent to a provider.

Profile groups personal details, private photo, password/passkeys/recovery, and sign-out. Settings groups appearance, billing, usage, external connections, plans and draft spending preferences. Project photos/inbox/domains and publishing/maintenance controls live in Dashboard. Password changes require a recent session; password-enabled accounts also prove the existing password. The credential replacement and old-session revocation are atomic, with a fresh session issued afterward. Losing the response can leave the customer signed out with the new password, which is recoverable by signing in again. Email changes, account deletion and avatar public sharing are not enabled.

The workspace stylesheet now uses shared day/night semantic colors, one typography/spacing scale, consistent form controls, aligned footer icons, and responsive independent views. No email address appears in navigation. Profile text/photo and theme changes are saved independently from paid-plan preferences.

## Chat continuity and response recovery — September 29, 2026

The React workspace now has one persistent parent route for Chat, Dashboard and controls. Sidebar navigation retains the current draft and in-flight message. Finishing a request clears only its submitted draft, preserving a different message typed while waiting. Drafts remain in memory; a full browser reload still discards an unsent draft.

When a message POST loses its response or returns a server error, the browser reads the authenticated transcript once. Only the exact request ID and message text can establish acceptance; a saved pending turn continues through the existing poller. No automatic POST retry occurs. If acceptance cannot be verified, an explicit Retry message control reuses the original ID, revision and content; a new message cannot replace the unresolved request. Validation, authentication, conflict and quota errors remain immediate.

Verification: TypeScript/build, `test:chat-delivery`, and the existing ACK timing tests pass. A real local Worker/browser test deliberately discarded a committed `/usage` response and returned 502. The UI recovered its single saved reply through readback, retained a separately typed next draft, and preserved state through Chat → Dashboard → Chat navigation. No model calls or customer data were used in this fixture.
