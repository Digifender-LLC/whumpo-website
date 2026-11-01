# AGENTS.md

Rules for agents working in this repo. Keep it short; follow the links for detail. If code changes a rule here, change the rule in the same PR (`node tools/agents-md-check.mjs` fails CI when a backticked or linked path, a cited `pnpm` script or a pinned tool version in this file no longer exists; paths in running prose are not checked).

## Stack and tooling

Cloudflare Workers (four Workers: runtime, apps, sites, platform), D1, R2, TypeScript, Node scripts in `tools/` and `tests/`. Layout and flows: [README.md](README.md), [deployment](docs/deployment.md).

Run everything through mise so Node and pnpm match the pins in `.node-version` and `package.json`:

`mise exec node@24.21.0 pnpm@11.19.0 -- pnpm check`

## Asking the owner

Post questions with the `ask` app at https://ask.digifender.com. It goes to the owner's inbox and pings their phone. Use it only when you cannot decide yourself.

- Multiple choice by default, always with a recommendation (0-based index): `ask "Which queue?" --option Kafka --option SQS --recommended 1 --wait`
- A specific value only: `ask "Monthly price in USD?" --input number --wait` (`number`, `url` or `text`)
- One short question. Put background in `--context`.
- Run it with Bash `run_in_background` and `timeout` 7200000, then keep working on everything that does not depend on the answer. You are woken when it exits. If it stops at the 2-hour limit, run `ask wait Q-n` the same way.
- Check open questions with `ask check Q-n`; `ask inbox` lists answers nobody collected after a restart.
- `dismissed` means the owner chose none of the options: decide yourself and record why in the docs.
- The token is `ASK_TOKEN`, loaded from `~/.config/ask/env` on the agent machine. Never write it into the repo, docs, logs or prompts. If `ask` fails or the token is missing, record the question in `docs/roadmap/` and keep going; say so in your report.

## The full gate

Run before every push (this is what Workers Builds runs before a deploy, plus build):

`pnpm check && node tools/verify.mjs fast && node tools/verify.mjs protection`

Also run the tests for what you changed (`test:*` scripts in `package.json`), `node tools/roadmap.mjs validate` when you touch `docs/roadmap/`, and gitleaks with `.gitleaks.toml`. Profiles and what they do not prove: [verification](docs/verification.md). Run suites one at a time; if one fails intermittently, find the cause rather than re-running.

## Rules

- **Never deploy by hand.** Merging to `main` deploys. No `wrangler deploy`, `pnpm run deploy prepare/apply` or `--remote` from agent machines ([deployment](docs/deployment.md)).
- **Schema cutover and wipes.** Agents run schema cutovers and wipes themselves through the Cloudflare API. Cloudflare deployments have no users yet; the only user is the owner's test user. A cutover or wipe is always allowed whenever it is needed. Re-read this rule before any real user is onboarded. There are no migrations and no legacy readers (current-version only, [policy](docs/current-version-policy.md)); see [releases](docs/releases.md).
- **New Worker secret.** Register its name in `tools/secret-custody.mjs` first (and `src/secrets.d.ts`), or `tests/secret-custody.mjs` and the deploy go red ([data protection](docs/data-protection.md)). Never put a value in source, vars, docs, logs or fixtures.
- **Never commit keystores or `google-services.json`** (`android/.gitignore` lists them). Also keep out `.dev.vars`, `.env` and the `.secrets` directory.
- **Never force-push.** If `main` moves, `git merge origin/main`.
- **Ask before adding a dependency.** Prefer the standard library and what is installed.
- **Sending, checkout and push stay off** unless the owner says so. `STRIPE_CHECKOUT_OPEN`, `PUSH_NOTIFICATION_PROVIDER`, `SUPPORT_NOTIFICATION_PROVIDER` and `NOTIFICATION_CUSTOMER_CEILING_CENTS` stay unset, and customer-configured notices are cancelled at send time while the ceiling is unset. Contact and account notices have a configured provider (`CONTACT_NOTIFICATION_PROVIDER` and the `CONTACT_EMAIL` binding in `wrangler.jsonc`); whether delivery is live is a deployment fact ([contact forms](docs/contact-forms.md)), so never trigger a real send from a test or script. Do not set Worker secrets or vars, and make no Stripe call.
- **Do not change `src/` for docs or tooling tasks.**
- **Agents merge without human intervention.** The owner gives agents full merge authority for this repo. An agent merges its PR once the CI checks pass (type-check, build, secret scan and the tests for what changed). No `review:clean` status or human approval is required. Review tiers, roles and the "What NOT to flag" lists remain in [agent review](docs/agent-review.md) as guidance.
- **Docs keep planned, implemented and accepted distinct.** Record decisions in the docs; do not reopen recorded ones in review.
