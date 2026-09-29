# Whumpo

The test platform is at **https://digifender.com**, with source in the private **Digifender-LLC/whumpo-website** GitHub repository. Whumpo is a working name.

The public homepage introduces the product. Sign in at `/workspace/`; invitation links open `/workspace/?signup=1`. The landing page is static and makes no API calls.

Implemented: invitation-only signup with Turnstile, passkeys by default, optional password sign-in, recovery codes, revocable cookie sessions, persistent guided chat, conversational project onboarding, projects, activity, tenant isolation, authentication throttling, and test data quotas. Muse Spark 1.3 Contributor planning chat, monthly build-unit reservations, an immutable usage ledger, and opt-in credit spending are implemented. A Stripe test credit-checkout foundation is implemented but unconfigured; paid entitlements and checkout remain disabled. See [payment integration](docs/payments.md). Chat can assemble private, versioned previews from a reusable launch-page component without model usage. Confirmed publication, exact-version restore and unpublish are available through chat. Natural-language requests can now create private website drafts and prepare publication reviews. Saved sites can be exported as standalone source ZIPs through /export. Domain ownership checks are available through chat and the Domains menu; custom-domain hosting remains pending. See [domain controls](docs/domains.md).

## Local development

Use Node.js 24 and pnpm 11. Run `pnpm install --frozen-lockfile`, `pnpm db:local`, then `pnpm dev`.

The dev command explicitly sets `ENVIRONMENT=local`, using local D1 and bypassing invite/Turnstile checks. Deployment defaults to `test` and never bypasses them. Do not expose the local dev server publicly.

Use `http://localhost:8787` for passkey development: its relying-party origin is intentionally fixed, because Wrangler rewrites route headers internally. With the server running, run `pnpm test:smoke`, `pnpm test:chat`, and `pnpm test:passkeys` in another terminal. `pnpm test:ai` runs provider contract tests without API credentials. `pnpm test:billing` uses a disposable local D1 database to verify concurrency, settlement and AI recovery. Local development never calls the configured real model. Tests check login/logout, tenant boundaries, Origin enforcement, activity, and the project quota under concurrent requests. `pnpm check` checks TypeScript.

## Test deployment

Run `pnpm check`, `pnpm db:remote`, then `pnpm deploy`. Run `pnpm invite` to generate a one-use, seven-day invitation. Its hash is stored in D1; the code is written to a permission-restricted file under `.secrets/`, ignored by Git. Share the code with the intended tester yourself, never through a public issue or URL.

The public Turnstile site key is in Wrangler config. Set its server secret with `wrangler secret put TURNSTILE_SECRET`. The widget is restricted to digifender.com. Signup validates the invitation, hostname, and Turnstile register action.

Password hashing also requires `PASSWORD_PEPPER`, a random secret of at least 32 characters. It is already installed on the test Worker. Preserve the existing value; changing it invalidates stored passwords. See the runtime constraints and versioned hash format in the deployment notes.

GitHub is source storage only. There are no Actions workflows, paid marketplace apps, Packages, or Git LFS. Deploy from the authenticated local Wrangler installation.

## Budget and scope

The user authorized the existing account's included Workers/D1 allowance. No plan upgrade or paid-only service is enabled. Workers Static Assets, a workspace Worker, a separate public-site Worker, one D1 database, a private R2 photo bucket, and a free Turnstile widget form the deployed stack. Allowances are shared with existing apps; this is not a separate free account or an account-wide spending cap. See [deployment notes](docs/deployment.md).

Test limits: 50 accounts, 20 projects per account, 10 retained sessions per user, 10 auth requests per minute per IP and location, and 120 API requests per minute per IP and location. Each account can save ten passkeys. New passkey accounts receive a one-use recovery code; using it rotates the code and revokes previous sessions. Adding/removing passkeys or replacing recovery codes requires authentication within ten minutes. Keep a backup passkey and store the recovery code safely. Email-based password reset is not implemented.

## API

`GET /api/health`, `GET /api/config`, `POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, `GET /api/me`, `GET/POST /api/projects`, `GET /api/projects/:id`, and `GET /api/activity`.

Mutations require a same-origin Origin header. Sessions use hashed random tokens and HttpOnly SameSite cookies, with Secure on HTTPS. Project queries scope by authenticated owner. Project creation and activity commit together. SQL triggers enforce quotas under concurrent requests.

Frontend source lives in `web/app.js`; `pnpm build` bundles it into `public/app.js`. Development and deployment commands rebuild automatically. Do not edit the generated bundle.

Passkey routes are `POST /api/auth/passkeys/{signup,login,add}/{options,verify}`, `GET /api/passkeys`, `POST /api/auth/passkeys/remove`, `POST /api/auth/recover`, and `POST /api/auth/recovery-code`. Chat lives at `GET/POST /api/chat`; draft plans at `GET /api/plans`.

The current delivery checklist and commercial model are in [docs/mvp.md](docs/mvp.md). The expanded design is in `docs/ai_managed_cloud_mvp_design_revised.docx`. The deployment notes supersede its paid-service assumptions for this test platform.

## AI testing

The deployed test uses OpenCode Go at `https://opencode.ai/zen/go/v1`, model `muse-spark-1.3-contributor`, Responses protocol. `AI_API_KEY` is stored as a Worker secret; the supplied `opencode.key` is ignored by Git and never included in assets. There is no automatic provider/model fallback. Contributor prompts and replies may be used for training; the workspace displays this notice.

Guided onboarding and account commands are free. After creating a draft project, ordinary messages use the model; `/ask question` invokes it at any onboarding step. The model can propose private website drafts, focused edits and publication reviews through validated component contracts; it cannot confirm publication or execute arbitrary backend code. Usage reserves a bounded amount before dispatch, settles reported input/output (including reasoning) tokens, and never automatically retries uncertain inference. Use `/usage` or Details → Usage for balances; `/credits on` opts into spending existing credits only. Credit purchases are disabled.

Billing endpoints: `GET /api/billing`, `POST /api/billing/preferences`. Browser input cannot grant credits or select a paid entitlement. Jarvis ports and remaining reusable components are documented in [docs/jarvis-reuse.md](docs/jarvis-reuse.md).

Use `/build`, `/build clay`, or `/build forest` after creating a project to save a private first preview. An optional project UUID selects another project; otherwise the most recently created project is used. Each project retains up to 25 immutable previews. `pnpm test:previews` verifies the local preview flow, tenant boundaries, escaping and quotas.

Publication commands: `/versions` lists saved versions; `/publish VERSION_ID` reviews a release; `/restore VERSION_ID` reviews restoring an earlier release; `/unpublish PROJECT_ID` reviews taking a site offline. Confirm the exact review within ten minutes using `/confirm REVIEW_ID` or its chat button. Explore allows one live site; the database enforces this at confirmation. Public pages are served by the separate `whumpo-sites` Worker at `sites.digifender.com/s/PROJECT_ID`.

Deploy the public host with `pnpm deploy:sites` after applying remote migrations. It has D1 and private R2 bindings and exposes only read-only published-site routes and photos referenced by the current publication. `pnpm test:publications` uses disposable local D1 state to verify confirmation, concurrency, ownership, quotas, restore and unpublish.

Use `/files` or Details → Project photos for private uploads. JPEG, PNG and WebP inputs are resized in your browser and stored as metadata-stripped JPEGs. Choose Use in website to attach a photo to a private version without AI usage. AI edits can arrange up to four project-owned photos; publishing requires confirmation. Source ZIPs include the exact referenced images. See [photo storage](docs/photos.md).

Use `/domains` or Details → Domains to prepare and check a project-specific DNS TXT proof. Proofs expire after seven days and cost no AI units. Verification does not connect a hostname, provision a certificate or purchase a domain. `pnpm test:domains` verifies ownership boundaries, exact DNS proofs, retries, expiry and quotas.

Onboarding collects your idea, project name, intended audience and style, then creates a private first preview without AI units. Use `/skip` for optional questions, `/brief` to inspect the saved planning notes, and `/cancel` to leave setup. Free-form style notes guide later AI edits; the first preview supports ocean, clay and forest themes. `pnpm test:onboarding` covers persistence, retries, owner isolation and quota rollback.

The AI can create a new project and its private website from a request with a name and purpose, and prepare an authenticated source download in ordinary language. These interpreted requests use AI units; `/new` and `/export` stay available without model charges. See [workspace AI actions](docs/workspace-agent.md).

Ask the AI about current projects, saved versions, activity, usage or domain status to inspect authoritative workspace records. `/project PROJECT_ID` and `/inspect VERSION_ID` show exact details without model charges; `show my saved versions` is also free. The agent has an index of every owned project, including projects outside its bounded detailed context.

Optional GitHub authorization has a Connected accounts panel with session-bound PKCE, encrypted expiring tokens and disconnect/revocation. It is disabled pending operator GitHub App configuration. Reviewed source backups are implemented for initialized repositories, with readable files and no-overwrite atomic commits; live acceptance remains pending configuration. See [backup design](docs/integrations/github-backups.md). See [connection design](docs/integrations/github-connection.md) and [app setup](docs/integrations/github-app-setup.md).
