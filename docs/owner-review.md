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
11. **WH-073 weak mapping.** Its line 5 (no customer extension falls back to Whumpo AI) is met only because no such extension exists (WH-079 is deferred), not by a test. Revisit when WH-079 starts.
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
- **Liability amounts (WH-172 done, real figures left to WH-023).** `tools/liability-register.mjs` now records liabilities (Workers floor, minimums, licences, renewals) from a private JSON file into the local ledger, with unknown amounts kept unknown; the repository holds only a synthetic example. Enter the real ones from your invoices when you want them counted, or accept that overhead shows only as an invoice residual. Writing the remote ledger is not built and would be your call. No retry cost exists because nothing retries a billable call.
- **Old D1 databases.** Dropping is irreversible, so I left them. Checked against the account on 2026-10-31: `whumpo-control`, `whumpo-control-2026-10-04`, `-10-28`, `-10-29`, `-10-30`, `-10-30b` to `-10-30g`, `-10-31`, `-10-31b`, `-10-31c`, and `whumpo-control-chat-connections-test`. Only `whumpo-control-2026-10-31d` is live. All hold test data. Recommended: keep `-10-31c` for now and drop the rest.

## 2a. Money sheet, October 31, 2026 UTC

One number and one recommended answer per item. Every figure is from a public page read on 2026-10-31 (a person should reopen the link before signing anything). No account was created, no trial started, no billing prompt followed; "not listed" means the public page did not say. Figures marked (second read) were read twice; the rest were read once by a research pass and are less certain.

### WH-020 paid benchmark budget (Workers AI only, inside the D8 ceiling of $50 a month)

- **Price.** $0.011 per 1,000 Neurons, with 10,000 Neurons a day free on Workers Free and on Workers Paid (page "Last updated Oct 20, 2026"): <https://developers.cloudflare.com/workers-ai/platform/pricing/>. Example models as listed: `@cf/meta/llama-3.1-8b-instruct-fp8-fast` at $0.045 per million input tokens and $0.384 per million output tokens (4,119 and 34,868 Neurons per million); `@cf/meta/llama-3.2-3b-instruct` at $0.051 and $0.335.
- **Scale.** At the 8B rates a call with 2,000 input and 500 output tokens is about 26 Neurons, so 1,000 calls is about 26,000 Neurons (about $0.29 before the free allowance). The seven-family cohort is on the order of hundreds of calls.
- **Data use.** Workers AI states no training on customer content without consent (recorded in [inference-privacy.md](inference-privacy.md) from <https://developers.cloudflare.com/workers-ai/platform/data-usage/>, checked 2026-10-02, not reread today). The current OpenCode Go Contributor route trains on its data. Both statements are the providers' own and neither is a contract.
- **Proposed fixed budget: $5 in total, hard stop**, about 450,000 Neurons, roughly 15 times the cohort estimate and a tenth of one month of the D8 ceiling.
- **Recommended answer: approve $5, Workers AI only, one run of the seven-family cohort, stop on reaching it.** Unblocks WH-020, and through it WH-022 closure by real data, WH-021 and WH-041 to WH-044.

### WH-036 Cloudflare Email Service (customer and account notices)

- **Status and plan.** Email Sending is Beta; sending to arbitrary recipients needs Workers Paid (second read): <https://developers.cloudflare.com/email-service/platform/pricing/>, overview <https://developers.cloudflare.com/email-service/>.
- **Price.** 3,000 emails a month included, then $0.35 per 1,000 (second read). Sends to verified destination addresses are free and uncounted.
- **Limits.** New accounts start with "a conservative daily quota and scale up over time"; no numeric daily limit is listed. 50 recipients per message, 25 MiB per message (<https://developers.cloudflare.com/email-service/platform/limits/>, updated 2026-10-30). A sending domain must be onboarded before sending to arbitrary recipients; the DNS records are not listed on that page.
- **Entitlement.** Whether this account is on Workers Paid is not checked here (no account access was used).
- **The $5 ceiling.** At $0.35 per 1,000, $5 buys about 14,000 emails beyond the 3,000 included, so the existing `NOTIFICATION_CUSTOMER_CEILING_CENTS` recommendation of $5 or less is not binding for a long while.
- **Recommended answer: keep the ceiling at $5 or less, set it only when you want customer notices on, and accept that it is a Beta product.** Nothing sends until you do.

### WH-033 Cloudflare for SaaS (custom hostnames)

- **Included and price.** 100 hostnames included on Free, Pro and Business; $0.10 per additional hostname; up to 50,000 without Enterprise (second read): <https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/> (updated 2026-08-14). The page does not state a billing period for the $0.10: **not listed**. It lists no plan above Free as required.
- **Fallback origin.** Required, and must be proxied: a proxied `A`, `AAAA` or `CNAME` record pointing at the fallback origin (from the getting-started page excerpt, <https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/>; the full page was not read, and the dedicated fallback-origin page returned 404).
- **Cost at the first hundred.** $0 for the first 100 customer hostnames; the first 100 additional would be $10 if the price is monthly.
- **Recommended answer: approve custom hostnames capped at the 100 included, create the proxied fallback-origin record when you do, and revisit the cap before hostname 101.**

### WH-195 registrar facts (Gandi first, per [domain-purchases.md](domain-purchases.md))

Read from public price pages, USD, first-year registration / renewal / transfer. Prices at checkout were not checked.

| Registrar | .com | .site | .app | WHOIS privacy | Registration API |
| --- | --- | --- | --- | --- | --- |
| Gandi (<https://www.gandi.net/en-US/domain/tld/com>) | $11.00 / $38.38 / $11.00 | $1.99 first year promo, $34.87 after; renewal $56.74 | $9.99 promo; renewal $47.98 | not listed | REST v5 with an API key; approval rules not read |
| Porkbun (<https://porkbun.com/tld/com>) | $11.08 / $11.08 / $11.08 | $1.96 sale, $28.84 regular | $8.75 sale, $14.93 regular | free | v3 API; each domain needs API access enabled; some registrations may need ID verification |
| Namecheap (<https://www.namecheap.com/domains/domain-name-search/>) | $11.28 sale / $18.48 / not listed | not listed | $10.98 / $22.98 | free with eligible domains | needs activation (a minimum of 20 domains or similar) |
| Cloudflare Registrar (<https://www.cloudflare.com/domains/>) | not listed | not listed | not listed | free redaction | not listed |

Gandi's renewal price is far above Porkbun's. The quote contract already says renewal prices are not guaranteed ([domain-purchases.md](domain-purchases.md)), and a customer pays it, but it affects margin.

- **Recommended answer: Gandi as planned, because docs/domain-purchases.md already recommends Gandi v5 for the sandbox adapter, with the renewal gap shown to the customer in the quote. Ask again only if you want lower renewals, in which case Porkbun is the comparison.**

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
