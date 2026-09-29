# TellUmo

The test platform is at **https://digifender.com**, with source in the private **zemdregon/TellUmo** GitHub repository. TellUmo is a working name.

The public homepage introduces the product. Sign in at `/workspace/`; invitation links open `/workspace/?signup=1`. The landing page is static and makes no API calls.

Implemented: invitation-only signup with Turnstile, passkeys by default, optional password sign-in, recovery codes, revocable cookie sessions, persistent guided chat, conversational project onboarding, projects, activity, tenant isolation, authentication throttling, and test data quotas. Draft plans and credit calculations are available; paid entitlements and checkout are not enabled. AI planning, site generation, previews, customer-site publishing, and customer domain management are not implemented yet.

## Local development

Use Node.js 24 and pnpm 11. Run `pnpm install --frozen-lockfile`, `pnpm db:local`, then `pnpm dev`.

The dev command explicitly sets `ENVIRONMENT=local`, using local D1 and bypassing invite/Turnstile checks. Deployment defaults to `test` and never bypasses them. Do not expose the local dev server publicly.

Use `http://localhost:8787` for passkey development: its relying-party origin is intentionally fixed, because Wrangler rewrites route headers internally. With the server running, run `pnpm test:smoke`, `pnpm test:chat`, and `pnpm test:passkeys` in another terminal. `pnpm test:ai` runs provider contract tests without API credentials. Tests check login/logout, tenant boundaries, Origin enforcement, activity, and the project quota under concurrent requests. `pnpm check` checks TypeScript.

## Test deployment

Run `pnpm check`, `pnpm db:remote`, then `pnpm deploy`. Run `pnpm invite` to generate a one-use, seven-day invitation. Its hash is stored in D1; the code is written to a permission-restricted file under `.secrets/`, ignored by Git. Share the code with the intended tester yourself, never through a public issue or URL.

The public Turnstile site key is in Wrangler config. Set its server secret with `wrangler secret put TURNSTILE_SECRET`. The widget is restricted to digifender.com. Signup validates the invitation, hostname, and Turnstile register action.

Password hashing also requires `PASSWORD_PEPPER`, a random secret of at least 32 characters. It is already installed on the test Worker. Preserve the existing value; changing it invalidates stored passwords. See the runtime constraints and versioned hash format in the deployment notes.

GitHub is source storage only. There are no Actions workflows, paid marketplace apps, Packages, or Git LFS. Deploy from the authenticated local Wrangler installation.

## Budget and scope

The user authorized the existing account's included Workers/D1 allowance. No plan upgrade or paid-only service is enabled. Workers Static Assets, one Worker API, one D1 database, and a free Turnstile widget form the deployed stack. Allowances are shared with existing apps; this is not a separate free account or an account-wide spending cap. See [deployment notes](docs/deployment.md).

Test limits: 50 accounts, 20 projects per account, 10 retained sessions per user, 10 auth requests per minute per IP and location, and 120 API requests per minute per IP and location. Each account can save ten passkeys. New passkey accounts receive a one-use recovery code; using it rotates the code and revokes previous sessions. Adding/removing passkeys or replacing recovery codes requires authentication within ten minutes. Keep a backup passkey and store the recovery code safely. Email-based password reset is not implemented.

## API

`GET /api/health`, `GET /api/config`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`, `GET/POST /api/projects`, `GET /api/projects/:id`, and `GET /api/activity`.

Mutations require a same-origin Origin header. Sessions use hashed random tokens and HttpOnly SameSite cookies, with Secure on HTTPS. Project queries scope by authenticated owner. Project creation and activity commit together. SQL triggers enforce quotas under concurrent requests.

Frontend source lives in `web/app.js`; `pnpm build` bundles it into `public/app.js`. Development and deployment commands rebuild automatically. Do not edit the generated bundle.

Passkey routes are `POST /api/auth/passkeys/{signup,login,add}/{options,verify}`, `GET /api/passkeys`, `POST /api/auth/passkeys/remove`, `POST /api/auth/recover`, and `POST /api/auth/recovery-code`. Chat lives at `GET/POST /api/chat`; draft plans at `GET /api/plans`.

The current delivery checklist and commercial model are in [docs/mvp.md](docs/mvp.md). The expanded design is in `docs/ai_managed_cloud_mvp_design_revised.docx`. The deployment notes supersede its paid-service assumptions for this test platform.
