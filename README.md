# Whumpo

Whumpo is an invitation-only AI website and application platform in private testing at **https://whumpo.com**. The signed-in workspace is `/workspace/`; customer sites use project subdomains of **whumpo.site**. Source: private **zemdregon/whumpo** repository. Historical `whumpo-*` service names remain internal infrastructure identifiers.

**MVP is not complete.** Start with the [dated capability matrix](docs/capability-matrix.md), [current readiness assessment](docs/acceptance.md) and [delivery contract](docs/mvp.md). Detailed feature documents distinguish implemented code, configured services and verified customer journeys; an implemented integration is not automatically available to customers.

For future work, use the [product and delivery roadmap](docs/roadmap/README.md), the [architecture and sequencing alignment](docs/roadmap/alignment.md), its [prioritized task backlog](docs/roadmap/backlog.md), and [agent execution guide](docs/roadmap/execution.md). Run `node tools/roadmap.mjs next` for planning candidates, then check their linked GitHub issues for current ownership and completion evidence.

Development follows the owner's [current-version-only policy](docs/current-version-policy.md): remove legacy routes/adapters and reset obsolete test data directly. All environments are testing; preservation migrations are unnecessary. The linked inventory records the removed paths and their test deployment. The test platform runs the complete current schema and shared workspace identity/admission contract; see [current deployment evidence](docs/chat-routine-release.md). CMS functional testing remains deferred.

## Current product

- [Installable workspace](docs/dashboard-pwa.md) with phone home-screen icons, browser installation guidance and a public offline reconnect screen.
- React workspace with Chat first, agent-managed dashboards and custom pages, mobile navigation, and separate Profile and Settings screens. Shared components show current project, activity and review data in Chat or saved pages; requested layout changes support exact replay and undo. Chat accepts natural-language messages, retains account-scoped drafts/interrupted requests across reloads, and uses explicit review controls for critical actions.
- Passkey-only workspace access, invite/Turnstile signup, two-key enrollment, a downloadable recovery kit and revocable sessions. Restricted recovery cannot access the workspace. Guided conversational onboarding persists without requiring AI or an external account.
- Muse-assisted current specification drafts, exact reviews for private edits/restores, saved versions, source export, and separate publication reviews. Publication, restore and withdrawal tasks retain their exact reviews and recorded outcomes in Chat; models cannot approve them. See [current verification scope](docs/chat-routine-release.md). Supported static/photo sites publish to customer subdomains.
- Maintained capability lookup and versioned private project/service settings with pinned compilers and exact owner reviews; saving configuration does not publish or activate a service.
- Bounded customer backend execution in a separate QuickJS Worker, reviewed application activation, controlled visitor pages and scoped visitor accounts/data. This is not a general-purpose VPS or unrestricted deployment environment.
- CMS content editing, reviews and private media viewing are implemented; bounded image and WordPress taxonomy/media import workflows have connected local-native/browser acceptance. First live customer provisioning and broader migration coverage remain open; CMS testing is owner-deferred. See [EmDash](docs/emdash.md).

## Plans and inference

Proposed monthly/annual prices: **Starter $17/$170**, **Creator $30/$300**, **Business $79/$790**, **Business Pro $139/$1,390**. Standard AI remains unlimited under fair use; explicitly approved advanced-model work consumes credits. New standard Chat requests use no customer test units or credits. See [resolved decisions](docs/docs-code-sync.md). Annual domain benefits, infrastructure allowances and premium model funding have separate rules; none imply an enabled purchase. [Pricing and model policy](docs/pricing-and-model-policy.md) is authoritative. [Cumulative feature packaging](docs/plan-feature-contract.md) uses Creator as the display name for the unchanged `personal` identity; new tier features remain planned.

Owner testing uses `muse-spark-1.3-contributor` on OpenCode Go via the OpenAI-compatible Responses adapter. Chat Completions is also supported by the transport. There is no automatic paid fallback. Contributor prompts/replies may be used for training; the UI displays the testing notice. Keep credentials and sensitive customer data out of model context.

Cloudflare AI Gateway, comparative Workers AI/external routing and premium-model credits are planned; route selection and spending-reservation foundations do not constitute live provider dispatch. **Monitor mode is deployed by default:** fair-use observations never warn, throttle or block users. An operator-attested company-finance comparison and internal review CLI are implemented; automatic verified finance ingestion and active enforcement remain unimplemented. Run `pnpm report:fair-use` for a private read-only operator report.

Retired test units, credit purchases and plan-grant paths are removed from current source. Standard assistance uses one non-billable receipt path; the internal Muse testing-capacity ceiling remains. See [standard AI accounting](docs/standard-ai-accounting.md). Stripe sandbox signup, subscriptions, invoices and cancellation are deployed and verified for owner testing; no real payments are enabled. See the [sandbox contract and verification](docs/stripe-sandbox.md) and [payments](docs/payments.md).

## Development

Use **Node.js 24 and pnpm 11**:

```sh
pnpm install --frozen-lockfile
pnpm db:local
pnpm dev
```

The local server sets `ENVIRONMENT=local`; do not expose it publicly. Use `http://localhost:8787` for passkey development. Deployment uses `ENVIRONMENT=test` and keeps invitation/security checks enabled. Run `pnpm check` for backend/frontend types, and the focused `test:*` scripts listed in `package.json` for the feature being changed. For credential-free local checks, use `pnpm verify` (fast), `pnpm verify site`, or `pnpm verify app`; see [verification profiles](docs/verification.md) for coverage and limitations. Some other HTTP tests require a running local server; inspect their documented setup.

| Area | Authoritative source |
| --- | --- |
| Owner workspace and landing page | `frontend/` → Vite build in `dist/` |
| Platform API and orchestration | `src/index.ts` and feature modules |
| Public website host | `src/site-host.ts`, `wrangler.sites.jsonc` |
| Controlled visitor frontend | `web/visitor.js` → `public-app/visitor.js` |
| Separate visitor/runtime services | `wrangler.apps.jsonc`, `wrangler.runtime.jsonc` |
| Database schema | `schema/platform.sql` and current identity SQL composed by `tools/current-schema.mjs` |

Run `pnpm build` to generate assets. Never hand-edit bundles.

## Deployment and boundaries

The owner authorized Workers Paid ($5/month) resources, with GitHub restricted to free-tier use. New paid services, purchases and customer deployments still require the applicable review. R2 `FILES` remains private; customer credentials never enter generated source or model context. Scope resource access by owner and preserve publication/activation confirmations.

For a four-Worker release, run `pnpm build`, then `pnpm deploy prepare REVIEW.json`, inspect the private archive, and use `pnpm deploy apply RELEASE_ID`. The version-3 review pins the complete current schema; occupied old schemas reject, and reset initialization requires a distinct empty database. The journal records schema initialization and each Worker step. See the [release protocol](docs/releases.md). The [current Chat test release](docs/chat-test-release.md) deploys the 173-table current schema and all four Workers; the obsolete test database is retired. Signed HTTP and live mobile Chromium acceptance pass. Physical-device, provider and whole-platform recovery acceptance remain separate. Provider activation and CMS functional testing remain deferred. The standalone platform wrapper requires an already current database.

`pnpm invite` creates a one-use invitation in ignored `.secrets/`. Share it privately. Never commit keys, session cookies, recovery codes or provider credentials. The supplied key files and `.secrets/` remain ignored.

## Feature references

- [Private maintenance diagnostics](docs/maintenance.md) — scheduled run status and read-only backlog inspection
- [Workload placement contract](docs/workload-placement.md) — logical resources, scoped adapters and lifecycle/export requirements; broader hosting remains conditional
- [Project specification decision](docs/project-specification.md) — versioned configuration, supported change operations and the offline composition contract
- [Capability catalog and planner](docs/capability-planner.md) — reuse existing configuration and helpers; record bounded missing behavior before generating source
- [Data lifecycle proposal](docs/data-lifecycle.md), [protection contract](docs/data-protection.md) and [background-job decision](docs/background-jobs.md) — storage access, key recovery, retention/export/closure and durable operations
- [Customer benchmarks and inference privacy](docs/customer-benchmarks.md) — synthetic outcome checks, cost evidence and real-model evaluation gates
- [Content safety and US customer eligibility](docs/content-safety.md) — CSAM scanning is planned and owner-deferred; existing holds are not detection. Wider safety acceptance remains open
- [Chat tools and navigation](docs/workspace-agent.md)
- [Natural-language Chat and agent knowledge](docs/natural-language-chat.md): messages, explicit approvals, scoped lookups and the retrieval decision.
- [Chat interaction contract](docs/chat-interactions.md) — versioned forms, views and exact action handoffs; production interaction storage/rendering remain planned.
- [Domain ownership](docs/domains.md) and [custom hosting](docs/integrations/domain-hosting.md)
- [GitHub authorization](docs/integrations/github-connection.md) and [reviewed backups](docs/integrations/github-backups.md)
- [Cloudflare authorization](docs/integrations/cloudflare-connection.md) and [reviewed DNS](docs/integrations/cloudflare-dns.md)
- [Photos](docs/photos.md), [CMS](docs/emdash.md), and [visitor applications/data](docs/app-data.md)
- [Safe reuse and Jarvis ports](docs/jarvis-reuse.md)

The maintained Word design is [Whumpo MVP technical design](docs/whumpo_mvp_design.docx). The original document under `docs/reference/` and `docs/ai_managed_cloud_mvp_design_revised.docx` are historical snapshots, not current implementation contracts. See the [documentation/code reconciliation](docs/docs-code-sync.md) for checked-off work, resolved decisions and verification boundaries.

The [Cloudflare capability catalog and roadmap](docs/cloudflare-capability-roadmap.md) explains the Cloudflare services Whumpo already uses, the customer-facing features that are feasible next, official documentation links, and cost/plan caveats. Repository-specific contribution and agent guidance is in [AGENTS.md](AGENTS.md).
