# Owner decisions — October 26, 2026

Answers from the owner to the decisions in the static-site paid beta plan (PR #340). Recorded here so blocked roadmap work can be read against them. This note does not execute anything: the schema cutover (D5) and any deploy still need an explicit go-ahead.

| ID | Decision | Answer | Still open |
| --- | --- | --- | --- |
| D1 | Beta scope | Adopt the narrowed scope (plan section 5) | — |
| D2 | Inference provider | Cloudflare Workers AI | Week 1 benchmark still applies to confirm fit |
| D3 | Price and AI daily cap | $17/month, monthly; daily cap from measured Week 1 cost | Cap value |
| D4 | Legal and DMCA | Adopt Terms, AUP and Privacy drafts after counsel review; file DMCA agent | Counsel review not yet done |
| D5 | Schema cutover | Authorized, main bundle (cutover plan section 6) | Execution not yet run |
| D6 | Sales tax | Stripe Tax, register where required | Accountant confirmation |
| D7 | Support promise | Named email `hello@whumpo.com`, business-day response, owner sole operator | — |
| D8 | Inference ceiling | $50/month fixed provider limit plus per-account daily cap | — |

Unblocked by these answers: plan Weeks 1–2 inference and payments setup. Still blocked: any live Checkout until D6 accountant confirmation, and any invitation until D4 and D7 are complete.

Related: WH-111 (support destination, now answered by D7 as hello@whumpo.com) and WH-020 (paid benchmark budget) remain open and are not answered here.

## Agent decisions — 2026-10-27 (delegated by owner)

The owner delegated every decision that does not cost the owner money to the agents. These answer the open rows in [`docs/chat-daily-workspace.md`](../chat-daily-workspace.md#owner-decisions-needed) and the open rows in [`docs/review-retention.md`](../review-retention.md#open-owner-decisions). Each choice favours a small early beta: the least new code, no schema change unless already planned, and no removal of a working recovery path. Any of them can be revisited with beta evidence. This note executes nothing and deploys nothing.

| ID | Decision | Choice | Reasoning | Tasks unblocked |
| --- | --- | --- | --- | --- |
| D-1 | How far to remove Dashboard, Settings and the control pages | (a) Keep Dashboard, Settings and every control page as optional pages reached from Dashboard; fix only the return links. No route is removed in this round. | Control pages double as outage and secret/provider-confirmation paths that WH-110 requires to stay direct, so removing them adds risk with no beta benefit. Removal can be reconsidered from beta usage. | WH-209 (with D-2, D-3) |
| D-2 | Profile placement on mobile (issue #100 question 1) | Accept the current shape: Profile in the Help sheet, Settings in the bar. | It is already on main and covered by `--navigation`; restoring it costs work and bar space for a rarely used entry. | WH-209 |
| D-3 | Dashboard fixed links duplicating essentials (issue #100 question 2) | Keep them as an outage entry point. | The duplication is cheap redundancy: essentials stay reachable from Dashboard if the bar or a generated layout fails. | WH-209 |
| D-4 | Composer draft retention | Keep the per-tab `sessionStorage` draft at 24 hours. No server-owned draft and no longer device retention. | No schema, lifecycle entry or cutover, and no private draft text left on a shared device after the tab closes. Server drafts are revisited if beta users report lost drafts. | WH-211 (device-only: verify reload, in-tab navigation and provider/checkout return keep the draft; correct the stale docs on the limit) |
| D-5 | Direct confirmation during a conversation-read outage; model-free prepare control | Every saved review kind whose existing exact confirmation handler already runs without the model may be confirmed from Saved work after a fresh exact read of that saved turn. No model-free "prepare restore/recover" control in the beta. | It reuses the existing handlers and their identity, revision, expiry and recent-auth checks, so there is no second approval path. Takedown and provider panels already cover the urgent cases, so a new prepare surface is not worth its risk. | WH-212 |
| D-6 | `POST /api/projects` and the `onboardingComplete` project-existence fallback | Keep the route, gated behind the completed welcome as delivered by WH-207 (#343), for the Android contract. Keep the fallback. | The gate already closes the bypass. Dropping the fallback would churn about 116 test fixtures for no user-visible gain. | None blocked; closes D-6 |
| D-8 | Evidence bar for WH-111 closure | Agent-run Orca and axe plus simulated viewports close WH-111. Physical devices and human listening stay at WH-112. | This matches the WH-111 acceptance ("leave physical-device gaps explicit") and keeps device and listener costs out of the beta path. | WH-213 (evidence bar fixed) |
| D-9 | The 44 px rule for inline text links (F-2) | Restrict the 44 px check to controls: buttons, radios and standalone links. Links inside a sentence are exempt. | WCAG 2.2 SC 2.5.8 exempts inline targets, and padding a `mailto` inside running text breaks the line without helping anyone. Standalone controls keep the stricter 44 px rule. | WH-208 (makes `--support` pass at "Touch targets are at least 44px") |
| D-9 (clarified) | Touch-target thresholds | Clarified 2026-10-27: 44px at phone width / coarse pointer, 24px minimum at desktop / fine pointer (WCAG 2.5.8 AA), inline links exempt; defects fixed in this PR. | Orchestrator clarification after a live smoke test found 40px Account security buttons at 390px and an 18px "Ask Whumpo" button at 1280px. | This PR |
| D-10 | Cost events at account closure (WH-170) | For v1, account closure deletes the owner's cost events with the account (foreign-key cascade through the owner and project). No closure key, no tombstones and no pseudonymised copy. An append for an owner or project that no longer exists is refused (`TENANT_MISMATCH`, `UNKNOWN_PROJECT`). Period close, company totals and provider statements move to WH-171. | Decided by the planning lead, October 28, 2026; no money. It removes the only open design question that blocked the table (key custody, destruction time and the "anonymous" claim), adds no retained personal data, and is reversible: a closure key and tombstones can be added in a later reviewed schema if company totals need to outlive an account. The reference ledger's tombstone design stays offline. | WH-170, WH-171 |
| D-11 | Anonymous visitor login challenge exhaustion (WH-004 B5) | Add `app_auth_challenges.client_hash` (SHA-256 of the connecting address, never the address), cap live challenges at 5 per project and client hash by trigger, keep the 50-per-project and 1,000-platform caps, and return a typed 429 from every capacity refusal. | Decided by the orchestrator under delegated authority, October 28, 2026; no money and no new secret. It stops one client blocking a project (blocking now needs ten clients) with one column, one trigger line and an error type, and rides the already-pending WH-170/WH-201 cutover instead of costing another. | WH-004 B5 |
| OD-1–OD-7 | Review and directory retention parameters (`docs/review-retention.md`) | Adopt the recommendation recorded in each row. | They were written against the current schema and inventory. Adopting them lets WH-181 build against fixed numbers, and all of them can be changed before the cutover runs. | WH-181 to WH-184 (parameters fixed) |

### Implementation decisions inside OD-1 to OD-7 (WH-181, 2026-10-27)

Made while building the schema, within the parameters above, and recorded in full in [`docs/review-retention.md`](../review-retention.md#schema-and-trigger-changes-implemented-in-source-by-wh-181-owner-run-empty-d1-cutover-pending). Any of them can change before the cutover runs.

| Decision | Choice | Reasoning |
| --- | --- | --- |
| Directory slot fair share (OD-7 fixed only the 250 per owner) | Past 1,000 platform slots an owner holding more than 62 may not add more | Same ratios as the policy table (half the ceiling, a quarter of the per-owner limit); only growth is refused, so unpublish and removing listings are never blocked |
| Supersession of a pending withdrawal | A derived state (a newer withdrawal for the same target), accepted by the receipt binding and by the delete guard; no mutation at insert | The immutability triggers forbid changing a review and a row may leave only with its sealed receipt; sealing and deleting superseded rows is the WH-182 turnover job |
| Families left on their lifetime caps | `project_spec_applies`, `service_client_applies`, `service_client_activation_reviews`, `cms_draft_requests` (+ edits), `cms_export_links`, `cms_preview_links`; `app_runs` and `backend_runs` stay with OD-8 | No pending, in-flight or expired state exists to count, or the current-activation reference cannot be read from a trigger; inventing a rule was out of scope |
| Existing stricter limits | `backend_nominations` keeps owner 5, `app_migration_checks` keeps 5 per project and 50 platform, `domain_connections` keeps the 80-connection provider cap | They already count active rows and are stricter than the policy; only their lifetime caps were removed |

### Reserved for the owner (these cost money)

| Item | Why reserved | Agent recommendation |
| --- | --- | --- |
| D3 AI daily cap value (owner decisions above) | Sets provider spend | Set it from the Week 1 measured cost at about 1.5 times the median active-account day, inside the $50/month D8 ceiling. |
| D4 counsel review of Terms, AUP, Privacy and DMCA filing | Legal fees and the DMCA filing fee | Do it before the first invitation, since it gates invitations anyway. |
| D6 accountant confirmation of Stripe Tax registration | Accountant fee and registration costs | Confirm before any live Checkout; keep Checkout in sandbox until then. |
| WH-020 paid benchmark budget | Provider spend | Approve a small fixed budget on Workers AI only (the D2 provider), capped well under the D8 ceiling. |
| OD-8 run receipts to R2 (`docs/review-retention.md`) | Adds R2 storage use | Accept; the volume is small, but it is new storage spend, so the owner confirms it. |
| Notification provider and spending ceiling (`docs/notifications.md`, WH-160) | Per-message provider spend | Extend the Cloudflare Email Service decision, with a low monthly ceiling. Not needed for the beta. |
| Registrar selection, domain purchase canary and moderation provider (WH-195, WH-198, WH-011, WH-133) | Purchases, provider contracts and counsel | Keep them out of the beta scope (D1 narrowed scope). |
