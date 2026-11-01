# Owner actions that block the rest of the roadmap

State at November 1, 2026 UTC (source `main` after #584). Everything an agent can do without these has been done or is waiting on one of them. The blocker text comes from `docs/roadmap/backlog.json`; nothing here grants an activation, purchase or deployment. The decisions already given are in [owner decisions](wh-041-owner-decisions.md) and [owner decisions of 2026-10-26](owner-decisions-2026-10-26.md).

## 1. Cloudflare access and the pending cutover

- The Cloudflare API token in `~/.config/secrets/cloudflare.env` on ampere is rejected (`Invalid access token`, code 9109) and wrangler is not logged in, so no agent can create a D1 database or run `pnpm run deploy prepare/apply` from there.
- `main` is ahead of the live control database (`whumpo-control-2026-11-01`) by four schema groups, all merged and none cut over (owner answers Q-22 and Q-25: merge only): **C2** WH-194 domain orders and WH-196 domain lifecycle; **C3** WH-091 brand kits and the D50 compiler change; **C4** WH-042 `stripe_invoice_voids` and the `plan_entitlements` view; **C5** WH-051 index `contact_reviews_project`. The automatic deploy refuses a schema change, so routine deploys of `main` are stopped until a cutover runs. It wipes test data.
- Unblocks: live acceptance for WH-194, WH-196, WH-191, WH-033 (custom-domain HTTPS) and the first deploy of everything merged since the last cutover.

## 2. Stripe (nothing here has been changed)

- Only a live key (`sk_live_`) exists on ampere and it must not be used. For response-shape checks add a restricted read-only test key (`rk_test_`, read access to Charges, Refunds, Disputes, Invoices, Invoice Payments), for example as `STRIPE_TEST_SECRET_KEY`; WH-042's refund/dispute mapping is unverified against `2026-10-28.endive` until then.
- Q-32 (Stripe Tax from day one): set the four plan prices to tax-inclusive, add a product tax code, and register for tax where it is owed. Qualified tax review is still an acceptance line.
- WH-041 stays open until real-money activation, jurisdiction and refund/dispute terms get qualified review; WH-198 also needs the registrar account, funding and an exact canary purchase.
- Q-33 approved top-up and rollover; a company reserve for the correlated 2x cost shock is still named in `resource-pool-economics.md`.

## 3. Providers and accounts

- WH-195 and WH-197: choose the registrar and approve its sandbox or test account.
- WH-036, WH-202, WH-160: Cloudflare Email Service activation, sending-domain DNS approval, owner decisions in `docs/notifications.md`, and a canary to approved addresses.
- WH-031, WH-032: a consented Cloudflare zone and DNS operation; customer GitHub App configuration and a reviewed repository.
- WH-020: a small fixed paid-benchmark budget (Workers AI only, under the D8 ceiling).
- WH-075: the WAF rate-limit rule (Q-011) and the Durable Object cost decision recorded in `docs/capacity-and-fairness.md`.
- WH-133: qualified US counsel review of the restricted case and preservation procedure, and the named safety operator.

## 4. People, devices and the agent host

- WH-005, WH-112, WH-087: physical desktop and mobile devices, an approved disposable identity, real FCM and photo-safety acceptance, an admitted Android cohort, and Google Play account type, signing custody and app association (a personal account created after 2023-11-13 needs 12 testers for 14 days of closed testing).
- WH-111, WH-115, WH-208, WH-213: install Orca on the agent host (`sudo pacman -S orca`; it needs sudo) so the screen-reader checkpoints can run.
- WH-117: copy the encrypted key capsule and its recovery file (`.secrets/protection-key-custody.json`) off this computer and say where in general terms (Q-010).
- WH-112: re-enroll the owner account through a fresh invitation.

## 5. Deferred by the owner

CMS functional testing (WH-038, WH-040), CSAM implementation and Daybreak stay deferred until the owner changes that decision. WH-070 level 3 (custom JavaScript) waits for WH-014 and the hosting/isolation contract.
