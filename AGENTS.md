# AGENTS.md

Rules for agents working in this repo. Keep it short; follow the links for detail. If code changes a rule here, change the rule in the same PR (`node tools/agents-md-check.mjs` fails CI when this file cites a path, `pnpm` script or tool version that no longer exists).

## Stack and tooling

Cloudflare Workers (four Workers: runtime, apps, sites, platform), D1, R2, TypeScript, Node scripts in `tools/` and `tests/`. Layout and flows: [README.md](README.md), [deployment](docs/deployment.md).

Run everything through mise so Node and pnpm match the pins in `.node-version` and `package.json`:

`mise exec node@24.21.0 pnpm@11.19.0 -- pnpm check`

## The full gate

Run before every push (this is what Workers Builds runs before a deploy, plus build):

`pnpm check && node tools/verify.mjs fast && node tools/verify.mjs protection`

Also run the tests for what you changed (`test:*` scripts in `package.json`), `node tools/roadmap.mjs validate` when you touch `docs/roadmap/`, and gitleaks with `.gitleaks.toml`. Profiles and what they do not prove: [verification](docs/verification.md). Run suites one at a time; if one fails intermittently, find the cause rather than re-running.

## Rules

- **Never deploy by hand.** Merging to `main` deploys. No `wrangler deploy`, `pnpm run deploy prepare/apply` or `--remote` from agent machines ([deployment](docs/deployment.md)).
- **Schema cutover.** A change to `schema/platform.sql` or the control database is an owner cutover, not an ordinary merge: the automatic deploy refuses it. There are no migrations and no legacy readers (current-version only, [policy](docs/current-version-policy.md)). Ask the owner; see [releases](docs/releases.md).
- **New Worker secret.** Register its name in `tools/secret-custody.mjs` first (and `src/secrets.d.ts`), or `tests/secret-custody.mjs` and the deploy go red ([data protection](docs/data-protection.md)). Never put a value in source, vars, docs, logs or fixtures.
- **Never commit keystores or `google-services.json`** (`android/.gitignore` lists them). Also keep out `.dev.vars`, `.env` and the `.secrets` directory.
- **Never force-push.** If `main` moves, `git merge origin/main`.
- **Ask before adding a dependency.** Prefer the standard library and what is installed.
- **Sending, checkout and push stay off** unless the owner says so: `STRIPE_CHECKOUT_OPEN`, `PUSH_NOTIFICATION_PROVIDER` and the notification provider variables are unset by default. Do not set Worker secrets or vars, and make no Stripe call.
- **Do not change `src/` for docs or tooling tasks.**
- **Merges wait on the risk-tiered review.** The `review:clean` label is added only after the tier's reviewers pass and CI is green. Tiers, sensitive paths and the "What NOT to flag" lists: [agent review](docs/agent-review.md). The agent that built a change never reviews it.
- **Docs keep planned, implemented and accepted distinct.** Record decisions in the docs; do not reopen recorded ones in review.
