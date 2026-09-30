# Local verification profiles

WH-003 implementation, September 30, 2026. These profiles group existing checks by customer boundary. They are local fixture acceptance, not production, provider, browser or physical-device acceptance. Implementation is recorded in this checkout. [WH-003](https://github.com/zemdregon/whumpo/issues/4) was created concurrently by roadmap work and was observed open, unassigned and without comments before this commit; this change does not claim or close that issue.

## Setup

Use Node **24.21.0** (`.node-version`) and pnpm **11.19.0** (`packageManager` in `package.json`). Install dependencies with `pnpm install --frozen-lockfile`. Profiles require installed dependencies and Linux-compatible local workerd/Miniflare for journeys; no running development server is needed.

Run `pnpm check` separately for backend/frontend types. Run `pnpm verify` for the default `fast` profile, or choose explicitly:

| Command | Covered boundary | Resources and limits | Does not prove |
| --- | --- | --- | --- |
| `pnpm verify fast` | OpenAI-compatible Chat/Responses transport, Go session validation, saved-data role boundaries, acknowledgment timing including 700/730 → 1700 ms | In-memory bundles and simulated timers; three scripts, five-minute ceiling each | Live model availability/quality, UI appearance, billing or full prompt-injection resistance |
| `pnpm verify site` | Onboarding gate, synthetic AI private draft/edit, exact publication reviews, owner/origin isolation, replay, restore/unpublish, zero standard-AI units | Unique temporary D1/R2 state; all local migrations; local Wrangler proxy with dynamically selected ports; one script, five-minute ceiling | Real customer publication, Cloudflare configuration, real inference, native passkeys, media moderation |
| `pnpm verify app` | Welcome, actual bounded QuickJS, separate program/page approvals, visitor passkey fixtures/data isolation, replay/recovery/export/deletion and task-list workflow | Unique temporary D1/R2 and runtime bundle; local Miniflare with dynamically selected ports; one script, five-minute ceiling | Physical-device authentication, remote runtime bindings, arbitrary customer source safety or deployment |

Runtime ceilings are safeguards, not performance promises. Journeys require more CPU/memory and disk than `fast`; exact requirements depend on workerd and the host. Run profiles sequentially on a constrained machine. They do not share a persistent database or fixed server port. Each suite removes its fixture storage on its normal success/failure paths. A forced process termination can leave temporary files/processes requiring inspection; the runner is not a container supervisor.

## Credentials and live operations

The runner allows only basic OS executable/temp paths into child environments, uses a unique empty home/config directory, disables Wrangler metrics and dotenv loading, and excludes inherited provider tokens, proxies, `NODE_OPTIONS` and live-test flags. It refuses a checkout containing `.env`, `.env.*`, `.dev.vars` or `.dev.vars.*`, because Wrangler can load those independently of environment variables. Use a separate credential-free checkout in that case; do not remove operator secrets to make a test pass.

The site profile explicitly sets `SITE_AI=1`: this particular suite intercepts all model requests with synthetic Responses. It is not live inference. None of the selected suites reads the ignored root key files. The app runtime build uses Wrangler **dry-run**, and both journeys use local-only platform proxies with remote bindings disabled. This is an audited allowlist of repository tests, not an OS filesystem/network sandbox; re-review any added script or setup change before including it. No CMS functional tests, paid providers, customer DNS or deployed customer code are part of these profiles.

Live Muse, remote provider, browser and real-device acceptance remain explicit separate operations with their own prerequisites. Do not add them to a default profile or interpret these passes as their acceptance.

## Failure handling and CI

An unknown profile, extra arguments, wrong Node major, local secret configuration, failed script, signal or timeout produces a nonzero exit. Scripts stop at the first failure. `node tests/verification-profiles.mjs` verifies the runner's environment allowlist, unique homes, cleanup, local-secret refusal and failure propagation without calling providers.

No GitHub Actions workflow is enabled by this change. The repository is private; remaining included Actions allowance has not been verified. These local profiles provide the default route without GitHub consumption. A future workflow must first verify free allowance/billing controls, use ordinary included runners, cancel superseded runs, set job timeouts, restrict artifact retention, and exclude credentials/live tests. This does not authorize purchasing minutes or enabling overages.

## Verification evidence — September 30, 2026

`node tests/verification-profiles.mjs`, all three profiles (`fast`, `site`, `app`), `pnpm check` and `git diff --check` passed in the repository checkout on Node 24.21.0. Each connected journey created its own disposable local state with all current migrations. The site journey observed two synthetic main-model calls and two acknowledgments, with zero customer units charged. The app journey passed actual QuickJS execution plus signed fixture passkeys, task-list transitions, owner erasure and visitor data isolation. No provider credentials, CMS functional acceptance, remote deployment or physical-device test was used. This is source/tooling acceptance; no Worker deployment is needed for this change.
