# Whumpo

Whumpo is an invitation-only AI website and application platform in private testing at **https://whumpo.com**. The signed-in workspace is `/workspace/`; customer sites use project subdomains of **whumpo.site**. Source: private **zemdregon/whumpo** repository. Historical `whumpo-*` service names remain internal infrastructure identifiers.

**MVP is not complete.** Start with the [dated capability matrix](docs/capability-matrix.md), [current readiness assessment](docs/acceptance.md) and [delivery contract](docs/mvp.md). Detailed feature documents distinguish implemented code, configured services and verified customer journeys; an implemented integration is not automatically available to customers.

For future work, use the [product and delivery roadmap](docs/roadmap/README.md), the [architecture and sequencing alignment](docs/roadmap/alignment.md), its [prioritized task backlog](docs/roadmap/backlog.md), and [agent execution guide](docs/roadmap/execution.md). Run `node tools/roadmap.mjs next` for planning candidates, then check their linked GitHub issues for current ownership and completion evidence.

Development follows the owner's [current-version-only policy](docs/current-version-policy.md): remove legacy routes/adapters and reset obsolete test data directly. All environments are testing; preservation migrations are unnecessary. The linked inventory records the removed paths and their test deployment. The test platform runs the complete current schema and shared workspace identity/admission contract; see [current deployment evidence](docs/chat-routine-release.md) and the latest recorded cutover (October 4, 2026, PR #160) in the [release records](docs/releases.md#pr-160-shared-modules-and-contact-email-cutover--october-4-2026-utc). Those records are dated and were not re-read live in the October 8 documentation refresh. Since #186 (October 9) the source schema differs from that recorded cutover; no later cutover is recorded. CMS functional testing remains deferred.

## Current product

- [Installable workspace](docs/dashboard-pwa.md) with phone home-screen icons, browser installation guidance and a public offline reconnect screen.
- React workspace with Chat first, agent-managed dashboards and custom pages, mobile navigation, and separate Profile and Settings screens. Shared components show current project, activity and review data in Chat or saved pages; requested layout changes support exact replay and undo. Chat accepts natural-language messages, retains account-scoped drafts/interrupted requests across reloads, and uses explicit review controls for critical actions.
- Passkey-only workspace access, invite/Turnstile signup, two-key enrollment, a downloadable recovery kit and revocable sessions. Restricted recovery cannot access the workspace. Guided conversational onboarding persists without requiring AI or an external account.
- Muse-assisted current specification drafts, exact reviews for private edits/restores, saved versions, source export, and separate publication reviews. Publication, restore and withdrawal tasks retain their exact reviews and recorded outcomes in Chat; models cannot approve them. Task status and page-request views share the dashboard readers, refresh without inference, and clear unavailable or revoked facts. See [current verification scope](docs/chat-routine-release.md). Supported static/photo sites publish to customer subdomains.
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

The native Android shell (WH-082) is a separate Gradle project in `android/`; see [Android build and checks](docs/android-build.md).

The local server sets `ENVIRONMENT=local`; do not expose it publicly. Use `http://localhost:8787` for passkey development. Deployment uses `ENVIRONMENT=test` and keeps invitation/security checks enabled. Run `pnpm check` for backend/frontend types, and the focused `test:*` scripts listed in `package.json` for the feature being changed. For credential-free local checks, use `pnpm verify` (fast), `pnpm verify site`, `pnpm verify app`, or `pnpm verify protection`; see [verification profiles](docs/verification.md) for coverage and limitations. Some other HTTP tests require a running local server; inspect their documented setup.

| Area | Authoritative source |
| --- | --- |
| Owner workspace and landing page | `frontend/` → Vite build in `dist/` |
| Platform API and orchestration | `src/index.ts` and feature modules |
| Public website host | `src/site-host.ts`, `wrangler.sites.jsonc` |
| Controlled visitor frontend | `web/visitor.js` → `public-app/visitor.js` |
| Separate visitor/runtime services | `wrangler.apps.jsonc`, `wrangler.runtime.jsonc` |
| Database schema | Six current SQL files (`schema/platform.sql`, `src/workspace-identity/canonical-inputs.sql` and `schema.sql`, and the funnel-metrics, guest-previews and shared-modules `schema.sql`) composed by `tools/current-schema.mjs`: 221 tables, 51 current and 6 planned data classes on October 9, 2026 (219 before #186 added the WH-050 operator tables; that schema change awaits an owner-authorized cutover) |

Run `pnpm build` to generate assets. Never hand-edit bundles.

## Deployment and boundaries

The owner authorized Workers Paid ($5/month) resources, with GitHub restricted to free-tier use. New paid services, purchases and customer deployments still require the applicable review. R2 `FILES` remains private; customer credentials never enter generated source or model context. Scope resource access by owner and preserve publication/activation confirmations.

**Deployment:** merging to `main` deploys. Cloudflare Workers Builds runs `pnpm check && node tools/verify.mjs fast && node tools/verify.mjs protection && pnpm build` and then `pnpm run deploy ci`, which prepares and applies the four-Worker release (runtime → apps → sites → platform) for an unchanged current schema. Do not deploy by hand. Schema or control-database changes require an owner cutover with `pnpm run deploy prepare/apply`; see [deployment](docs/deployment.md) and the [release protocol](docs/releases.md). The standalone platform wrapper requires an already current database.

`pnpm invite` creates a one-use invitation in ignored `.secrets/`. Share it privately. Never commit keys, session cookies, recovery codes or provider credentials. The supplied key files and `.secrets/` remain ignored.

## Feature references

- [Private maintenance diagnostics](docs/maintenance.md) — scheduled run status and read-only backlog inspection
- [Incident, spend and provider-outage runbooks](docs/incident-runbooks.md) and [desk-check record](docs/incident-tabletop.md) — documented only: existing controls, gaps and drafts; no live drill or alerting
- [Isolated disaster-recovery drill](docs/disaster-recovery.md) — synthetic local restore of control D1, private objects, Worker artifacts and QuickJS app data; proposed (unapproved) RPO/RTO; no cloud restore
- [Capacity, abuse and tenant-fairness measurement](docs/capacity-and-fairness.md) — local-only synthetic-client harness results and fairness gaps (WH-050 first slice); not Cloudflare production limits
- [Workload placement contract](docs/workload-placement.md) — logical resources, scoped adapters and lifecycle/export requirements; broader hosting remains conditional
- [Pooled build jobs](docs/build-jobs.md) — owner-requested bounded builds with per-job lease, expiry, cleanup records and deterministic diagnostics; no always-on per-customer capacity (source implementation; Containers owner-gated)
- [Project specification decision](docs/project-specification.md) — versioned configuration, supported change operations and the offline composition contract
- [Shared module contract](docs/shared-modules.md) — WH-067 content, records/forms, files, collections and access modules: frozen contract plus WH-124 to WH-130 source and local tests; deployed in the October 4 cutover per the release record, with no customer or live acceptance claimed
- [Notification contract](docs/notifications.md) — planned WH-068 templates, verified senders, server-derived recipients, receipt states and delivery slices; the WH-155 source catalog and renderer (contact notices unchanged) are implemented in source and not deployed; no provider or sender added
- [Email change and compromise contract](docs/email-change-and-compromise.md) — planned WH-063 verified address change (email never a factor), compromise review and WH-199–205 slices; no route, schema or sender added
- [Portable project exports](docs/portable-exports.md) — planned WH-077 bundle format, permission filter, static/data/application tiers and unavailable-feature report; offline reference only, no export route added
- [Capability catalog and planner](docs/capability-planner.md) — reuse existing configuration and helpers; record bounded missing behavior before generating source
- [Guest preview links and feedback](docs/guest-previews.md) — WH-092 first slice: expiring, revocable, hash-stored links to one saved version on an isolated host, with bounded accountless comments; owner Chat/view controls and HTTP API, source and local tests only
- [Content-free funnel measurements](docs/funnel-metrics.md) — WH-025 opt-in milestones, aggregate operator report and draft feedback request; source and local tests only, targets proposed until the first cohort baseline
- [Data lifecycle proposal](docs/data-lifecycle.md), [protection contract](docs/data-protection.md) and [background-job decision](docs/background-jobs.md) — storage access, key recovery, retention/export/closure and durable operations
- [Customer benchmarks and inference privacy](docs/customer-benchmarks.md) — synthetic outcome checks, cost evidence and real-model evaluation gates
- [Content safety and US customer eligibility](docs/content-safety.md) — CSAM scanning is planned and owner-deferred; existing holds are not detection. Wider safety acceptance remains open
- [Chat tools and navigation](docs/workspace-agent.md)
- [Natural-language Chat and agent knowledge](docs/natural-language-chat.md): messages, explicit approvals, scoped lookups and the retrieval decision.
- [Chat interaction contract](docs/chat-interactions.md) — versioned forms, views and exact action handoffs; storage, the shared renderer and routine adapters are implemented and were deployed in the October 3 test releases (per the dated release records), while whole-owner-experience, physical-device and customer acceptance remain open.
- [Domain ownership](docs/domains.md) and [custom hosting](docs/integrations/domain-hosting.md)
- [GitHub authorization](docs/integrations/github-connection.md) and [reviewed backups](docs/integrations/github-backups.md)
- [Cloudflare authorization](docs/integrations/cloudflare-connection.md) and [reviewed DNS](docs/integrations/cloudflare-dns.md)
- [Photos](docs/photos.md), [CMS](docs/emdash.md), and [visitor applications/data](docs/app-data.md)
- [Safe reuse and Jarvis ports](docs/jarvis-reuse.md)

The maintained Word design is [Whumpo MVP technical design](docs/whumpo_mvp_design.docx). The original document under `docs/reference/` and `docs/ai_managed_cloud_mvp_design_revised.docx` are historical snapshots, not current implementation contracts. See the [documentation/code reconciliation](docs/docs-code-sync.md) for checked-off work, resolved decisions and verification boundaries.

The [Cloudflare capability catalog and roadmap](docs/cloudflare-capability-roadmap.md) explains the Cloudflare services Whumpo already uses, the customer-facing features that are feasible next, official documentation links, and cost/plan caveats. Repository-specific contribution and agent guidance is in [AGENTS.md](AGENTS.md).
