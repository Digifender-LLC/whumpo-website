# Whumpo

Whumpo is an invitation-only AI website and application platform in private testing at **https://whumpo.com**. The signed-in workspace is `/workspace/`; customer sites use project subdomains of **whumpo.site**. Source: private **zemdregon/whumpo** repository. Historical `tellumo-*` service names remain internal infrastructure identifiers.

**MVP is not complete.** Start with the [current readiness assessment](docs/acceptance.md#current-mvp-readiness--september-29-2026) and [delivery contract](docs/mvp.md). Detailed feature documents distinguish implemented code, configured services and verified customer journeys; an implemented integration is not automatically available to customers.

## Current product

- React workspace with Chat first, a separate dashboard, workflow pages, mobile navigation, and separate Profile and Settings screens. Exact navigation requests use no AI units.
- Passkeys by default, invite/Turnstile signup, optional password sign-in, recovery codes and revocable sessions. Guided conversational onboarding persists without requiring AI or an external account.
- Muse-assisted private drafts and edits, saved versions, source export, and explicit publication/restore reviews. Supported static/photo sites publish to customer subdomains.
- Bounded customer backend execution in a separate QuickJS Worker, reviewed application activation, controlled visitor pages and scoped visitor accounts/data. This is not a general-purpose VPS or unrestricted deployment environment.
- CMS content editing, reviews and private media viewing are implemented; native customer provisioning and complete media/import workflows still need acceptance. See [EmDash](docs/emdash.md).

## Plans and inference

Proposed monthly/annual prices: **Starter $17/$170**, **Personal $30/$300**, **Business $79/$790**, **Business Pro $139/$1,390**. Paid launch assistance is planned as unlimited standard site work under fair use. Annual domain benefits, infrastructure allowances and premium model funding have separate rules; none imply an enabled purchase. [Pricing and model policy](docs/pricing-and-model-policy.md) is authoritative.

Owner testing uses `muse-spark-1.3-contributor` on OpenCode Go via the OpenAI-compatible Responses adapter. Chat Completions is also supported by the transport. There is no automatic paid fallback. Contributor prompts/replies may be used for training; the UI displays the testing notice. Keep credentials and sensitive customer data out of model context.

Cloudflare AI Gateway, comparative Workers AI/external routing and premium-model credits are planned; route selection and spending-reservation foundations do not constitute live provider dispatch. **Monitor mode is deployed by default:** fair-use observations never warn, throttle or block users. Company finance data and active enforcement remain unimplemented. Run `pnpm report:fair-use` for a private read-only operator report.

Explore retains its 50-unit test allowance and atomic reservation/settlement. Test credits require explicit overage opt-in. These preview rules are separate from the intended paid-plan fair-use policy. Stripe checkout is disabled because the owner has no Stripe account; no subscriptions or credit purchases are available. See [payments](docs/payments.md).

## Development

Use **Node.js 24 and pnpm 11**:

```sh
pnpm install --frozen-lockfile
pnpm db:local
pnpm dev
```

The local server sets `ENVIRONMENT=local`; do not expose it publicly. Use `http://localhost:8787` for passkey development. Deployment uses `ENVIRONMENT=test` and keeps invitation/security checks enabled. Run `pnpm check` for backend/frontend types, and the focused `test:*` scripts listed in `package.json` for the feature being changed. Some HTTP tests require a running local server; inspect their documented setup.

| Area | Authoritative source |
| --- | --- |
| Owner workspace and landing page | `frontend/` → Vite build in `dist/` |
| Platform API and orchestration | `src/index.ts` and feature modules |
| Public website host | `src/site-host.ts`, `wrangler.sites.jsonc` |
| Controlled visitor frontend | `web/visitor.js` → `public-app/visitor.js` |
| Separate visitor/runtime services | `wrangler.apps.jsonc`, `wrangler.runtime.jsonc` |
| Database changes | Numbered `migrations/` SQL files |

Run `pnpm build` to generate assets. Never hand-edit bundles. The older owner UI in `web/app.js` is not the current frontend.

## Deployment and boundaries

The owner authorized Workers Paid ($5/month) resources, with GitHub restricted to free-tier use. New paid services, purchases and customer deployments still require the applicable review. R2 `FILES` remains private; customer credentials never enter generated source or model context. Scope resource access by owner and preserve publication/activation confirmations.

For the full test stack, `pnpm deploy` applies migrations, builds assets, deploys runtime/visitor/site Workers and then deploys the platform with its registered CMS service bindings. For a platform-only update, apply required migrations, run `pnpm build`, then `node tools/deploy-platform.mjs`. Do not bypass that platform wrapper: it preserves per-project CMS bindings. Check the active Worker version and appropriate live behavior after deployment. See [deployment notes](docs/deployment.md) and [domain boundaries](docs/whumpo-migration.md).

`pnpm invite` creates a one-use invitation in ignored `.secrets/`. Share it privately. Never commit keys, session cookies, recovery codes or provider credentials. The supplied key files and `.secrets/` remain ignored.

## Feature references

- [Chat tools and navigation](docs/workspace-agent.md)
- [Domain ownership](docs/domains.md) and [custom hosting](docs/integrations/domain-hosting.md)
- [GitHub authorization](docs/integrations/github-connection.md) and [reviewed backups](docs/integrations/github-backups.md)
- [Cloudflare authorization](docs/integrations/cloudflare-connection.md) and [reviewed DNS](docs/integrations/cloudflare-dns.md)
- [Photos](docs/photos.md), [CMS](docs/emdash.md), and [visitor applications/data](docs/app-data.md)
- [Safe reuse and Jarvis ports](docs/jarvis-reuse.md)

The revised Word design in `docs/ai_managed_cloud_mvp_design_revised.docx` is a historical design snapshot. Current feature contracts and acceptance evidence supersede its old pricing, domains and implementation status; the Word document still needs a final MVP reconciliation.
