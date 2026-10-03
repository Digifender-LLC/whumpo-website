# Agent guide

## Product and architecture

Whumpo is a private test-stage, Cloudflare-hosted AI website and application platform. `README.md` is the entry point; feature contracts and deployment evidence live under `docs/`. Read the relevant feature document before changing its behavior. `docs/cloudflare-capability-roadmap.md` maps Cloudflare products to Whumpo opportunities and current status.

- TypeScript Workers are in `src/`; workspace UI is React in `frontend/`; controlled visitor app assets are in `public-app/`; the public website host is `src/site-host.ts`.
- `tellumo-platform`, `tellumo-sites`, `tellumo-apps`, and `tellumo-runtime` are separate Worker services configured by the root `wrangler*.jsonc` files. Keep auth/secrets and customer content boundaries between them.
- D1 schema changes are numbered SQL migrations in `migrations/`. Preserve tenant ownership, immutable review/version, idempotency, quota, and atomicity invariants documented in the relevant docs.
- R2 `FILES` is private. Serve objects only through authenticated/approved paths; do not make buckets public.
- Customer-written/generated backend source runs through the bounded QuickJS runtime. Do not execute model-produced source in the control Worker or relax publication/activation review gates.
- Cloudflare OAuth credentials are customer-authorized and encrypted. Request only the scopes needed by an explicitly reviewed capability. Never log, print, export, or place credentials in model context.

## Working rules

- Current-version-only product: the owner explicitly rejects legacy support and compatibility fallbacks. Implement one current schema/API/client path, remove superseded adapters/aliases, and reject stale versions explicitly. All environments are disposable testing environments; the owner authorizes deleting obsolete test data. Use direct current-schema cutovers or fixture resets; do not build data-preservation migrations, old readers, dual protocols or downgrade renderers. Current-operation recovery must remain accurate. Historical evidence is not an active compatibility requirement.

- Treat the deployed environment as the `test` environment unless explicitly directed otherwise. Local dev sets `ENVIRONMENT=local`; do not expose the local server publicly.
- Do not enable paid Cloudflare services, upgrade plans, make customer DNS changes, deploy customer code, or perform purchases without explicit authorization and a concrete review step. Explain recurring/minimum charges in feature docs.
- Keep README concise and link to detailed docs. Mark planned versus implemented versus configured/accepted distinctly; do not infer live acceptance from local tests.
- Frontend source is authoritative; do not hand-edit generated bundles. Use existing scripts and patterns. Avoid adding dependencies for routine work.
- Use Node.js 24 and pnpm 11. `pnpm check` type-checks both TypeScript projects. Run only the verification appropriate to the requested change and report exactly what ran.
- Preserve unrelated working-tree changes. Inspect `git status` before edits and review the diff after.

## Subagent routing and orchestration

The primary agent acts as an orchestrator, coordinating work through context-scoped subagents rather than performing coding and edits directly. This division of labor optimizes reasoning effort and keeps the main conversation focused on coordination and decision-making.

When delegating to subagents, route work based on task complexity and requirements:

- **Fable 5.1**: Fast, cost-efficient agent for simple, straightforward tasks (file reads, pattern matching, routine edits, small scripts). Ideal for exploratory searches and quick lookups.
- **Haiku 4.5**: Lightweight reasoning for focused tasks (targeted code analysis, small refactors, single-file changes, fast feedback loops). Best for narrow, well-defined problems without complex cross-file dependencies.
- **Sonnet 5.5**: Balanced capability for general-purpose work (multi-file refactoring, feature implementation, moderate complexity analysis, code review). The default choice for most substantive tasks.
- **Opus 5.5**: Most capable reasoning for complex, high-stakes work (architecture decisions, cross-system design, deep codebase analysis, security review, intricate bug diagnosis). Use when a task requires sustained reasoning across multiple domains or when Sonnet's output quality is insufficient.

**Orchestrator responsibilities**: Define the task scope, provide context and constraints, verify subagent work, and coordinate across multiple efforts. Route simple, independent subtasks to faster models to reduce latency and cost. Reserve Opus for genuinely complex problems requiring deep reasoning or when task failure would be costly.

**Subagent responsibilities**: Execute focused work within defined scope—code writes, edits, file operations, targeted analysis. Report results clearly so the orchestrator can verify and coordinate the next step.

## Roadmap execution

- Follow `docs/roadmap/alignment.md` for shared contract ownership and cross-workstream ordering. Task/phase numbers are not build order. Reuse the delivered compiler, billing, credential and receipt foundations; register new features with shared Chat/view/native adapters rather than creating parallel authority or storage implementations.
- Follow `docs/roadmap/composition-architecture.md`: configure/compose maintained capabilities first. Visitors, deterministic jobs and view rendering must not invoke owner-maintenance AI or borrow its credentials/context/funding.

- Start planned work from `docs/roadmap/README.md` and `docs/roadmap/execution.md`. `docs/roadmap/backlog.json` owns task scope, dependencies and planning readiness; mapped GitHub issues own current execution state and claims.
- Use `node tools/roadmap.mjs validate`, `alignment`, `next`, and `show WH-001` to inspect tasks. Check live issue/dependency evidence and current source before claiming work; a planning-ready task may already be assigned or completed.
- Edit the JSON backlog, then run `node tools/roadmap.mjs render` and `render --check`; do not hand-edit generated `docs/roadmap/backlog.md`. Stripe sandbox setup is owner-authorized; preserve the real-money activation gate, owner-deferred CMS testing and CSAM scanner implementation, and distinguish implementation from activation/customer acceptance when closing work.

## Documentation conventions

- Link Cloudflare product claims to the relevant `https://developers.cloudflare.com/...` official documentation page.
- Include the date/point-in-time for pricing or changing product availability. Label unknown account entitlement/pricing as requiring verification.
- For each capability, state what it does, Whumpo fit, delivery path, prerequisites/cost flags, and status. Do not imply the customer-facing product is provisioned merely because Whumpo itself uses a Cloudflare service.
