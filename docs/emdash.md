# EmDash CMS support

EmDash is an explicit TownHello workload, added at the owner's request on September 29, 2026. This is a native Astro/EmDash application, separate from the static website templates and the pure-function QuickJS runtime. Do not attempt to execute EmDash inside QuickJS or represent a static blog export as a functioning CMS.

## Implementation

`integrations/emdash` contains a pinned EmDash 1.0.1 + Cloudflare adapter 1.0.1 application. The blog theme, seed, live content loader and pages derive from upstream commit `5de3bdc4310f6bcca013f05002f05a61e208b2a4`; the MIT notice is retained in `UPSTREAM-LICENSE`. The template includes posts, pages, archives, search, RSS, rich content rendering and admin entry links. Content stays in EmDash's own schema. Fonts and cream/green theme defaults follow TownHello; font licenses remain in `docs/licenses`.

Run `pnpm install`, then `pnpm build:emdash` from the repository root. Run `pnpm --filter @townhello/emdash dev` for local development. The existing TownHello deploy command intentionally does not deploy/provision CMS tenants. Each deployment needs an owned project and a separately resolved resource map.

The production profile uses dedicated D1, R2 and Astro session KV resources. It has no public route, workers.dev address or public preview URL. This protects the initial administrator setup while the ownership/bootstrap integration is being developed. The profile checker examines the generated Cloudflare configuration as well as the source, since Astro can insert bindings at build time.

## Cost and plugin boundary

No Worker Loader, Dynamic Workers, Container, email or Images binding is configured. Astro's default Images binding is explicitly avoided with passthrough image handling. Native plugin arrays are empty, and a sandbox runner is not selected. Upstream supports the core CMS without a Worker Loader; installing/executing sandboxed plugins requires the paid-only loader and is unavailable under the owner's current restriction. Never substitute `sandbox: false` or run untrusted plugins in-process to bypass that restriction. Keep this distinction visible in the future customer interface.

Core EmDash supplies passkey-based administration and a REST/MCP management surface. These are CMS capabilities, not automatic authorization for TownHello's agent. WordPress support means reviewed content/media migration, not PHP plugin/theme execution or guaranteed lossless conversion.

## Required integration contract

1. Provision a dedicated Worker/database/media bucket/session namespace for each owned CMS project. Record immutable provider IDs against the project and reconcile retries before creating another resource. Never use the TownHello account database for CMS migrations or share one CMS administrator across tenants.
2. Bootstrap the first administrator through the already authenticated TownHello owner. Do not expose the setup wizard publicly while it can be claimed. Keep CMS passkeys and roles separate unless a reviewed SSO bridge establishes equivalent authority.
3. Give the agent narrowly scoped management access, held server-side. Remote MCP descriptions and CMS content are untrusted data; they cannot widen authority. Do not put CMS credentials, private posts or other tenant data in reusable templates or general shared prompts.
4. Chat must support creating a CMS project, reading its state, creating/editing drafts, previewing and preparing publication. Public publication, deletion, plugin installation, imports and schema changes require exact reviews. The model cannot confirm its own proposal. Changes made in the CMS admin must invalidate stale reviews.
5. Import WordPress WXR/content into an isolated draft staging area with a report of unsupported blocks, themes and plugins. Media fetches need SSRF defenses, size/count budgets and a domain policy. Preserve authorship/licensing, sanitize rich content and preview before publishing. No PHP execution.
6. Back up CMS content, schemas, media references and required settings with versioned provenance. Restore into an isolated instance and verify it before switching traffic. A static HTML ZIP is not a CMS backup. Core upgrades need pinned releases, a migration snapshot and a tested restore path.
7. Reuse the existing domain ownership/routing review flow, with an explicit CMS destination. Add per-project storage/CPU/request admission and plan accounting. Verify native passkeys, media, roles, publish/unpublish, draft privacy, backup/restore and concurrent tenants on Cloudflare before advertising customer-ready support.

## Verification so far

Production build and Wrangler dry-run passed. The generated profile contains only ASSETS, DB, MEDIA and SESSION bindings. Local workerd initialized the CMS schema, rendered the blog homepage, returned setup status, redirected admin to setup and served the setup page. These checks do not prove completed owner enrollment, authenticated CRUD, WordPress migration or multi-tenant provisioning. Those remain integration gates, not silently dropped requirements.

## Primary references

- [Cloudflare announcement](https://blog.cloudflare.com/emdash-wordpress/)
- [EmDash source](https://github.com/emdash-cms/emdash)
- [Cloudflare deployment guide](https://docs.emdashcms.com/deployment/cloudflare/)
- [Plugin sandbox constraints](https://docs.emdashcms.com/deployment/plugin-sandbox/)
- [Current Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

## Private Cloudflare verification

Deployed `townhello-emdash-preview` version `4cb91bf8-0752-4195-a63f-df683d15497b`, with a dedicated D1 database, R2 bucket and SESSION namespace. Resource IDs are pinned in the profile configuration after provisioning. Startup reported 33 ms. A temporary remote preview called this deployed instance through a service binding: homepage 200 with rendered blog HTML, setup-status 200 with `needsSetup: true`, admin 302 to setup, font and CSS assets 200. Browser rendering was inspected through this private connection. No owner was enrolled and no public route was created.

First initialization was slow while EmDash applied its core schema. Production tenant provisioning must complete migrations and warm-up before routing customer traffic; this is a remaining acceptance gate. A rebuild invalidated a local dev process's asset map; restarting or using the deployed instance resolved the stale asset responses.
