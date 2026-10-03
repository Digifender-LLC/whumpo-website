# Homepage Stripe pricing tables

October 2, 2026 (UTC). The homepage embeds four tables from Whumpo sandbox (`acct_1ULu0ZEz67CfHgqS`). The public configuration in `frontend/public/stripe-pricing.json` contains only a test publishable key and table IDs. Personal/Business and Monthly/Annual switches select a single-interval table; changing audience retains the chosen interval. A missing table fails visibly instead of substituting another interval. Script/configuration loading supports retry and rejects live publishable keys.

| Audience | Monthly | Annual |
| --- | --- | --- |
| Personal | `prctbl_1ULvrNEz67CfHgqS3o37Hfin` | `prctbl_1ULwQYEz67CfHgqS25ItsHdm` |
| Business | `prctbl_1ULvw4Ez67CfHgqSfSW4MuWZ` | `prctbl_1ULwTZEz67CfHgqS4nKkxEYZ` |

Starter and Creator offer seven-day, payment-method-required trials on both intervals; Business and Business Pro have no trial. The separate Try it card is removed. Both Business tables include the contact-only Enterprise product `whumpo_enterprise_v1`, with no price or Checkout charge. Its custom **Contact us** button opens `mailto:enterprise@whumpo.com`, the owner-approved destination. This opens the visitor's email composer; it does not send a message or guarantee delivery. SSO and custom integrations remain scoped proposals, not provisioned entitlements. The separate Enterprise card is removed, and the Business embed fills the pricing container. See [Stripe custom call-to-action support](https://docs.stripe.com/payments/checkout/pricing-table#add-a-custom-call-to-action).

Tables use Stripe's supported background setting `#f8fafc` to match the page, navy `#0f2d5b` pill buttons, and Nunito. Each table has one interval, so no duplicate Stripe interval control appears. No cross-origin iframe styling or undocumented messaging is used. See [Stripe pricing tables](https://docs.stripe.com/payments/checkout/pricing-table).

Anonymous table Checkout is separate from the authenticated [sandbox subscription flow](stripe-sandbox.md). It does not establish Whumpo customer ownership or grant trial/paid access. Whumpo trial eligibility, lifecycle and conversion remain pending; the table and confirmation copy state this boundary. Automatic Tax remains off pending tax setup. This release does not modify the deployed subscription adapter, secrets, prices, payment methods, migrations or other Workers.

## Release verification

The isolated release starts at `fa377220a414472e10710747d76ab6e2f54d7352`. Before the pricing overlay, its fresh build matched all 41 deployable base files (including headers); 40 served files matched the live homepage version `dd43babe-aa06-4fd6-b9ea-8ed748727c24`. Only the internal Vite manifest's dependency filesystem paths differed. Existing PWA headers and all unrelated source are preserved.

After the overlay, `pnpm check`, `pnpm build` and `git diff --check` passed. Chromium verified all four real Stripe tables with `#f8fafc` backgrounds, correct trial/Subscribe buttons and no internal interval selector; both audiences fit 390px width without horizontal overflow. Desktop screenshots were inspected. No checkout was submitted. Source fingerprints stayed unchanged and no page errors occurred. Evidence: `.quality-reports/2026-10-02T03-10-25.535Z-44a47672-ee52-4997-8153-81b555b39cd6/`. The release base predates the managed CLI, so the preview check used its pinned Vite preview plus the existing quality-run lock and fingerprint helpers.

Deployed using `node tools/deploy-platform.mjs` as platform version `cea0fa86-7770-4255-a9f7-551ea462ecf7`. Independent readback confirmed all 39 served build files, Stripe script/frame CSP, health 200 and anonymous Billing 401. Other Worker versions, service/secret-binding names, 119 migrations and the empty CMS registry were unchanged. The public homepage passed the same four-table and mobile checks with zero page errors and stable source fingerprints; live desktop/mobile screenshots were inspected. Evidence: `.quality-reports/2026-10-02T03-13-25.135Z-250291e6-cb11-4a3f-900e-674c18f2d990/` and `.quality-reports/stripe-pricing-release/after.json`. No checkout, customer publication, Tax activation or real-money activation occurred.

## Enterprise contact release — October 2, 2026 (UTC)

Added Enterprise inside both Business tables using Stripe's custom CTA, retaining existing checkout, trial and appearance settings and leaving portal product switching disabled. No Enterprise price was created. `pnpm check`, `pnpm build`, focused ESLint and `git diff --check` passed. The main checkout's managed Chromium pricing suite passed all seven tests. Real-provider preview and live checks covered all four table selections, the two Enterprise buttons' exact `mailto:enterprise@whumpo.com` navigation, 390px mobile layouts, matching backgrounds and no duplicate interval selector. Desktop and mobile screenshots were inspected; both runs had unchanged source fingerprints and zero page errors. No checkout or email was submitted.

Deployed through `node tools/deploy-platform.mjs` as platform version `e4c2a15f-c24d-4eae-a525-e4b4687c80a6`. Independent readback matched all 39 served build files and the expected CSP; health returned 200 and anonymous Billing returned 401. Other Worker versions, service/secret-binding names, 119 migrations and the empty CMS registry were unchanged. This remains a sandbox integration.

Evidence: preview `.quality-reports/2026-10-02T03-38-06.101Z-827aaa66-f825-4f32-844b-90bcc55584e5/`, live `.quality-reports/2026-10-02T03-39-32.395Z-9b4f6fea-9b4e-4f29-88ef-d518f1672a62/`, provider readback `.quality-reports/enterprise-release/after.json`, and main-checkout managed regression `.quality-reports/2026-10-02T03-34-55.391Z-37bcef93-c54c-4780-90f3-886b158d93f9/`.

## Current usability readback — October 3, 2026 (UTC)

`node tests/pricing-display-browser.mjs --live` passed against the testing homepage and real Stripe embeds at 17:36:43 UTC. All four audience/interval tables show the configured amounts, sandbox/no-Whumpo-entitlement disclosure, no duplicate interval selector and no 390px horizontal overflow. Both Enterprise buttons emit exactly the approved email-composer intent. The fixture observes page and cross-origin frame browser protocol events because `mailto:` is not an HTTP request. No checkout or email was submitted, mailbox delivery is unverified, and no provider configuration changed. See the [owner usability audit](owner-usability-audit.md#final-pending-state-and-pricing-audit).
