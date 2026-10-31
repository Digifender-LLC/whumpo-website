# Owner review: what is left

Written 2026-10-31. Unattended work is continuing; this list is what is waiting on you. Task numbers are in [the backlog](roadmap/backlog.md).

## What is proven, and what is not

- **Proven live (read back from the deployed platform):** release `077c051b` on `whumpo-control-2026-10-31d`; schema matches source; guest-preview `/view` headers; the synthetic module check (`tests/module-live.mjs`).
- **Proven only locally (disposable SQLite and local D1, simulated providers):** notifications and the visitor address routes (WH-156 to WH-159, WH-214), the batch slot, conversion summary (WH-095), cost events (WH-172), the Android build (emulator only, WH-082), identity and recovery journeys, and every "done" task that says "closed on local evidence".
- **Not proven anywhere:** a real customer notice (receipt, staff or contact) in a real inbox, or a visitor verification code; the real Turnstile widget on `/forms/appointment`; Stripe checkout with real Stripe.js; any physical device, screen reader or real customer.
- **One real email has been proven:** an account verification code reached your inbox through Cloudflare Email Service on 2026-10-30.
- **Rate limits fire only for some clients (root cause found).** Cloudflare's rate-limit binding is enforced per counter, and a counter covers a slice of a location. A client that reuses a connection gets close to the exact limit; a client that opens a new connection for each request mostly slips past (`API_LIMITER` 0 of 480 refused that way, `SITE_LIMITER` 0 of 1,440, against refusals from request 12 on a reused connection). Nothing is broken in our code; upstream issue cloudflare/workers-sdk#16097 is open. The D1 per-source counters on public paths are proven locally, not live. WH-075 stays open. See [capacity](capacity-and-fairness.md#live-probe-site_limiter-and-api_limiter-did-not-refuse--october-31-2026-utc).

## 1. Decisions (free, highest leverage first)

1. **Key custody (Q-010).** Copy the encrypted key capsule and its recovery file (`.secrets/protection-key-custody.json`) to one place off this computer and tell me where, in general terms. Truly stops only WH-117 and the final WH-048 evidence. WH-018, WH-019, WH-008, WH-144 and the export chain proceed locally without it (D53). Recommended: yes, today.
2. **Public forms (Q-009).** Set `TURNSTILE_SECRET` on `whumpo-apps` and check the widget's hostname list covers `app-*.whumpo.site`. Opens appointment and public intake. The first real submission is the first proof of the widget; if it fails the form is a safe dead end.
3. **Scanning (WH-011).** Decide whether to resume CSAM scanning and name a safety operator. **Beta cannot happen without it** (WH-048 needs WH-017, which needs WH-012, WH-014, WH-016). Likely costs money.
4. **Strict rate limiting (Q-011).** Add one free WAF rate-limit rule per zone (Free allows one 10 s rule per zone), matching on path, counting by IP:
   - `whumpo.site`: all paths, 50 requests per 10 s, block.
   - `whumpo.com`: `/api/*` except `/api/stripe/webhook`, 20 requests per 10 s, block.

   Then tell me, and I will rerun the new-connection probes; 429s must come from the edge, not the Worker's "Too many requests" text. It is untested, and Cloudflare says it shares infrastructure with the binding, so it may have the same weakness. The cost option is Durable Objects (exact counts): about $1.35 a month at 10M requests, about $390 a month under a sustained 1,000 rps flood. Recommended: set the WAF rule now; Durable Objects only before open registration.
5. **Hold-erasure (from #541).** A visitor who removes or changes their notification address clears it from their notices even inside a safety-held project, because withdrawing consent is never blocked by a hold. Recommended: keep it, and have counsel confirm in WH-133.
6. **Decisions that overrule "owner decision" docs (check these):** D28 (cohort cap, thresholds, pull-based alerts instead of delivered ones), D30 (one fixed appointment preset), D38 (a fifth rate-limit namespace, now unproven), D47 (planned an agent accepting the Android SDK licence; I overruled that, no agent accepted one, and the licences already on this machine were enough). Reverse any you dislike.
7. **WH-050 alert cadence.** Nothing alerts. The stated procedure is `node tools/report-maintenance.mjs --counters` once per UTC day while a cohort account is active and before each invitation. Recommended: accept, since the cohort is empty.
8. **Interim defaults:** job journal kept 30 days, attachments deleted with the record, receipts only to verified and consenting visitors, visitor addresses kept while the identity lives, daily rule-approval reset, closure rows undeletable, layout history 50. Added (D59 to D61): WH-054 is built as C2, last, with four answers: on transfer the paid interval continues and the recipient subscribes in their own right (sandbox only); retention is 90 days for suspended memberships, 30 days for expired invitations, workspace audit for the workspace's life plus 90 days, GitHub `login` redacted after the authorizer's account is deleted, and a seven-day closure window; late payment is ordinary processing delay, 24 hours until measured; one owned workspace per account, and a transfer needs a recipient who owns none. Domain code defaults: customer as registrant of record, no quote without a tax method, premium off. WH-188 is a static loader under MIT and WH-189 uses `bwrap --unshare-all`. `connector-content` is kept 24 hours. WH-026 use cases: service business, personal portfolio, local shop with hours.
9. **CMS (WH-038, WH-040):** say whether CMS testing resumes. Recommended: no.
10. **The `$` bug (D50).** Text containing `$` can garble an owner's own page (injected text stays escaped, no script runs). Fix deferred to bundle with the next compiler identity change. Recommended: leave.
11. **WH-073 weak mapping.** Its line 5 (no customer extension falls back to Whumpo AI) is met only because no such extension exists (WH-079 is deferred), not by a test. [docs/runtime-ai.md](runtime-ai.md) (2026-10-31) now states the rule and the zero-call test the adapter must ship with; revisit when WH-079 is built.
12. **More building (D48).** Start WH-091 (brand kit)? Recommended: not before a beta.
13. **Re-enroll** with a fresh invitation (regenerate it after the last cutover). Needed for WH-112.

14. **WH-016 abuse intake.** Built as a held PR, waiting on your reading of the scanning deferral (WH-011). Nothing merges until you say so.

## 2. Money

- **Email cap and the $5 ceiling.** `NOTIFICATION_CUSTOMER_CEILING_CENTS` must be set in both `wrangler.jsonc` and `wrangler.apps.jsonc` in one commit (there is no `keep_vars`, so a dashboard-only value is likely wiped on deploy). Set on the platform only, nothing sends but the dashboard says "Sending is on". Recommended: $5 or less; above that review the platform ledger ceiling first. Nothing sends until a sender exists (WH-036).
- **Email provider (WH-036, WH-202).** Cloudflare Email Service already sends account notices from `notify@whumpo.com`, and one test reached your inbox. Both tasks stay blocked on your activation and a recorded canary. Customer notices stay off until then. Unblocks WH-202, WH-205, WH-160, WH-068, WH-069, WH-094. WH-214 (done) and WH-160 (blocked) both end at this step.
- **Checkout (WH-041).** Add `sk_test_`/`pk_test_` keys for the new Stripe account. Then: run the flow on localhost with test cards (Payment Element, 3D Secure, `2026-10-28.endive` field shapes, 402 codes, session `created`, what `expire` does mid-payment, `style-src 'self'` with real Stripe.js); land the code change that reads the live key and relaxes the test-key locks; create live products, prices and webhook; only then add `STRIPE_CHECKOUT_OPEN`. Checkout stays closed (Q-007).
- **Old sandbox key.** `STRIPE_TEST_KEY` is still on `whumpo-platform`, unused while checkout is closed. There is no local copy, so deleting it can only be undone by reissuing it from Stripe. Recommended: keep it until the new account's `sk_test_` keys are in, then delete it.
- **Paid benchmark (WH-020).** Approve a small fixed Workers AI budget. Unblocks WH-022, WH-021, WH-041 to WH-044 and part of WH-048.
- **Registrar (WH-195, WH-198), custom domains (WH-033), provider apps (WH-096 to WH-100).** Pick a registrar; approve a hostname plan once the Cloudflare for SaaS cost is disclosed; register Google, Microsoft and HubSpot apps (Gmail's assessment recurs). Paid AI API (Q-004) stays OpenCode Go.
- **WH-172 liability table.** No producer emits liability or retry cost events (Workers floor, minimums, licences, renewals). Enter the real ones from your invoices, or accept that overhead shows only as an invoice residual.
- **Old D1 databases.** Dropping is irreversible, so I left them. Checked against the account on 2026-10-31: `whumpo-control`, `whumpo-control-2026-10-04`, `-10-28`, `-10-29`, `-10-30`, `-10-30b` to `-10-30g`, `-10-31`, `-10-31b`, `-10-31c`, and `whumpo-control-chat-connections-test`. Only `whumpo-control-2026-10-31d` is live. All hold test data. Recommended: keep `-10-31c` for now and drop the rest.

## 3. Counsel

- **Safety procedure (WH-133):** applicability, preservation term, retention schedule, disclosure.
- **Commercial terms (WH-041, WH-198):** tax, refund, dispute, registrant, chargeback.
- **Legal page edits awaiting your approval:** `docs/legal/` cookies, privacy-policy, service-providers, terms-of-service (list in PR #523). The public pages use the copy vendored in `digifender-website`, so nothing changes until that is synced.

## 4. Devices and Orca

- **Orca:** `sudo pacman -S orca`, then tell an agent. Unblocks WH-208, WH-213, WH-111 and, with devices, WH-112.
- **Physical identity (WH-005, WH-205):** desktop and phone acceptance with a disposable identity.
- **Android (WH-083 to WH-087):** one Pixel and one Samsung; passkey and push on them; approve push activation; internal testers, Play App Signing, store listing, data-safety deletion page, 12 testers for 14 days before production.
- **Docker for `/cso`:** needed for its six isolated scanners; the plain-binary scanners ran without it (D46). Recommended: skip until beta.

## 5. Real customers

Beta (WH-048) needs custody, scanning, the benchmark, devices and a recovery rehearsal above; then up to 10 accounts (about 5 while R2 reads are shared). After it: WH-057, WH-031, WH-032, WH-191, WH-023, finally WH-049.
