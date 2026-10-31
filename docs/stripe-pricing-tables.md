# Homepage Stripe pricing tables (retired)

Retired in the custom payment flow change (decision D15, see [Stripe sandbox](stripe-sandbox.md)). The homepage no longer embeds Stripe's pricing table, loads no Stripe script and no longer reads `stripe-pricing.json` or its table IDs.

The landing page now renders Whumpo's own plan cards (`PlanCards` in `frontend/src/plan-features.tsx`) from the plan catalogue (`src/plans.ts`, `src/plan-features.ts`). Plans and prices are unchanged. Claims that existed only in the Stripe tables are gone: the seven-day trial, "payment method required" and the Enterprise contact button. Whumpo never implemented trials (see [pricing and model policy](pricing-and-model-policy.md)), and no Enterprise price or process exists. Each card's call to action opens the invite-only sign-up; paid plans are not on sale from the landing page.

The four sandbox pricing tables (`prctbl_...`) were not deleted in Stripe; they are simply unused. The earlier release record (October 2, 2026) is in git history for this file.
