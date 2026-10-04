# Agent guide

## Product and architecture

Whumpo is a private test-stage, Cloudflare-hosted AI website and application platform. `README.md` is the entry point; feature contracts and deployment evidence live under `docs/`. Read the relevant feature document before changing its behavior. `docs/cloudflare-capability-roadmap.md` maps Cloudflare products to Whumpo opportunities and current status.

- TypeScript Workers are in `src/`; workspace UI is React in `frontend/`; controlled visitor app assets are in `public-app/`; the public website host is `src/site-host.ts`.
- `whumpo-platform`, `whumpo-sites`, `whumpo-apps`, and `whumpo-runtime` are separate Worker services configured by the root `wrangler*.jsonc` files. Keep auth/secrets and customer content boundaries between them.
- D1 uses the complete current schema assembled by `tools/current-schema.mjs`. Update the canonical schema inputs and initialize disposable local fixtures or a distinct empty test database for coordinated cutovers. Do not replay numbered migrations or overlay an obsolete database. Preserve tenant ownership, immutable review/version, idempotency, quota and atomicity invariants documented in the relevant docs.
- R2 `FILES` is private. Serve objects only through authenticated/approved paths; do not make buckets public.
- Customer-written/generated backend source runs through the bounded QuickJS runtime. Do not execute model-produced source in the control Worker or relax publication/activation review gates.
- Cloudflare OAuth credentials are customer-authorized and encrypted. Request only the scopes needed by an explicitly reviewed capability. Never log, print, export, or place credentials in model context.

## Deployment (merge to main deploys)

- Merging a pull request to `main` deploys all four Workers automatically. Cloudflare Workers Builds (trigger on `whumpo-platform`, branch `main`) runs `pnpm check && node tools/verify.mjs fast && node tools/verify.mjs protection && pnpm build`; only if that passes does it run `pnpm run deploy ci` (runtime → apps → sites → platform under the D1 deployment lease). A failing check means no deploy. GitHub cannot block merges on this plan, so keep `main` green: run the same commands locally before merging.
- Routine shipping is by opening and merging PRs. Agents may also run remote Cloudflare operations (`wrangler ... --remote`, `wrangler d1 create`/`execute --remote`, `pnpm run deploy prepare/status/apply`, `pnpm invite`, Cloudflare API writes) **when the owner authorizes that specific operation in the current conversation**. Authorization covers only the operation asked for; it does not carry over to later operations or sessions. Use the session's injected Cloudflare credentials; never ask for, print, log or commit API tokens. (`pnpm deploy` is pnpm's own built-in command; the release script is `pnpm run deploy`.)
- Before any remote write, read the target state first, prefer the repository's journaled tools (`pnpm run deploy`, `tools/*.mjs`) over ad-hoc commands, and record what ran, when (UTC) and the readback result in the relevant doc or issue. Never run destructive remote commands (deleting databases, buckets, Workers, DNS records or secrets) without a separate explicit owner confirmation naming the resource.
- `deploy ci` only releases code onto the exact current schema already live. Any change to the composed schema (`tools/current-schema.mjs` inputs), the control database binding, or CMS registrations makes the automatic deploy refuse. Those need a cutover (new empty D1, `pnpm run deploy prepare/apply` with `schemaChange: "initialize"`, see `docs/releases.md`), which wipes test data. An agent may run the cutover only with the owner's explicit authorization in the current conversation; otherwise say so in the PR description and do not merge such a PR without the owner. After a cutover, merge the released commit to `main` so `main` matches what is live.
- Runtime secrets live on the Workers (`wrangler secret put`) and persist across deploys; never put secret values in Git, `vars` or build variables.

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

When delegating to subagents, route work based on task complexity and requirements. Models are listed from cheapest to most capable; prices are Anthropic API list prices per million input/output tokens as of 2026-09-25 and should be re-checked before relying on them:

- **Haiku 4.5** ($1/$5): Fastest and cheapest. Use for simple, well-defined tasks (file reads, pattern matching, exploratory searches, quick lookups, routine single-file edits, small scripts). Has a 200K context window, so avoid it for work that needs large amounts of code in context.
- **Sonnet 5.5** ($2/$10): Balanced speed and capability for general-purpose work (multi-file refactoring, feature implementation, moderate complexity analysis, code review). The default choice for most substantive tasks.
- **Opus 5.5** ($4/$20): Strong reasoning for complex, high-stakes work (architecture decisions, cross-system design, deep codebase analysis, security review, intricate bug diagnosis). Use when a task requires sustained reasoning across multiple domains or when Sonnet's output quality is insufficient.
- **Fable 5.1** ($10/$50): Most capable and most expensive. Reserve for the hardest reasoning and long-horizon agentic work where Opus 5.5 falls short. Turns can run for many minutes, so it is a poor fit for quick lookups or routine edits.

**Orchestrator responsibilities**: Define the task scope, provide context and constraints, verify subagent work, and coordinate across multiple efforts. Route simple, independent subtasks to Haiku or Sonnet to reduce latency and cost. Reserve Opus for genuinely complex problems requiring deep reasoning or when task failure would be costly, and Fable only when Opus is not enough.

**Subagent responsibilities**: Execute focused work within defined scope—code writes, edits, file operations, targeted analysis. Report results clearly so the orchestrator can verify and coordinate the next step.

## Roadmap execution

- Follow `docs/roadmap/alignment.md` for shared contract ownership and cross-workstream ordering. Task/phase numbers are not build order. Reuse the delivered compiler, billing, credential and receipt foundations; register new features with shared Chat/view/native adapters rather than creating parallel authority or storage implementations.
- Follow `docs/roadmap/composition-architecture.md`: configure/compose maintained capabilities first. Visitors, deterministic jobs and view rendering must not invoke owner-maintenance AI or borrow its credentials/context/funding.

- Start planned work from `docs/roadmap/README.md` and `docs/roadmap/execution.md`. `docs/roadmap/backlog.json` owns task scope, dependencies and planning readiness; mapped GitHub issues own current execution state and claims.
- Use `node tools/roadmap.mjs validate`, `alignment`, `next`, and `show WH-001` to inspect tasks. Check live issue/dependency evidence and current source before claiming work; a planning-ready task may already be assigned or completed.
- Edit the JSON backlog, then run `node tools/roadmap.mjs render` and `render --check`; do not hand-edit generated `docs/roadmap/backlog.md`. Stripe sandbox setup is owner-authorized; preserve the real-money activation gate, owner-deferred CMS testing and CSAM scanner implementation, and distinguish implementation from activation/customer acceptance when closing work.
- Resolve owner blockers with the built-in multiple-choice question tool (`AskUserQuestion`), not long prose lists. When a task is source-complete and waits on owner decisions, batch up to four questions per call, list a recommended option first, and keep options concrete (limits, providers, retention terms, role setup) with an "I'll specify" escape. Ask the most blocking questions first, then record each answer as a comment on the mapped issue and in the feature doc, noting which sub-questions remain open. An answer authorizes only the decision asked, not deployment, spending or provider activation.

## Documentation conventions

- Link Cloudflare product claims to the relevant `https://developers.cloudflare.com/...` official documentation page.
- Include the date/point-in-time for pricing or changing product availability. Label unknown account entitlement/pricing as requiring verification.
- For each capability, state what it does, Whumpo fit, delivery path, prerequisites/cost flags, and status. Do not imply the customer-facing product is provisioned merely because Whumpo itself uses a Cloudflare service.
