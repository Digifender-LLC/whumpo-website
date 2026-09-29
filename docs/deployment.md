# Whumpo test deployment

## Confirmed decisions

On September 28 2026, the user authorized digifender.com as the temporary test domain, invite-only registration, and the existing account's included Workers/D1 allowance without upgrades or paid-only services. GitHub is restricted to free features.

## Deployed resources

| Resource | Name | Purpose |
| --- | --- | --- |
| Worker | whumpo-platform | API and Static Assets |
| Custom domain | digifender.com | HTTPS test platform |
| D1 | whumpo-control | Identity, projects, activity, invitations |
| Turnstile | Whumpo test platform | Free managed signup verification |
| Private repository | Digifender-LLC/whumpo-website | Source history |

The workers.dev endpoint and preview URLs are disabled. Wrangler manages the apex custom domain and its certificate. www is not attached.

## Cost boundary

The domain has a Free Website plan. The existing account reports Workers Standard enabled; the user approved its included allowance after that distinction was explained. This deployment does not change the subscription. Included usage is shared with other apps, so application quotas cannot guarantee an account-wide zero bill.

The stack uses features available with free allowances. R2, Containers, Sandbox SDK, Workers for Platforms, Registrar purchases, AI inference, and hosted build services are not provisioned. Those parts of the broader design remain deferred. No GitHub Actions workflows, hosted runners, Packages, Git LFS, or paid apps are configured; deploy locally with Wrangler.

Static files are served without Worker invocation except /api routes. D1 reads/writes/storage and Worker request/CPU usage remain metered under the existing plan. Log sampling is 10 percent. Rate limits reduce application work but are per Cloudflare location, still require Worker invocation, and are not financial caps.

Official references checked:

- https://developers.cloudflare.com/workers/platform/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/turnstile/plans/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
- https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

## Identity boundaries

Deployed Workers caps Web Crypto PBKDF2 at 100,000 iterations, unlike the current local emulator. Password hashes use PBKDF2-SHA256 at that cap, followed by HMAC-SHA256 with a random server pepper stored as the `PASSWORD_PEPPER` Worker secret. Stored hashes include an algorithm/version prefix. The pepper is never in D1 or Git. Preserve it securely: changing or losing it invalidates existing passwords. This is an explicit early-test tradeoff; migrate identity to passkeys or a reviewed password service before broader release. Existing local accounts from the initial 310,000-iteration prototype cannot sign in after this change; create fresh local test accounts.

Invitation codes are random, expire in seven days, and work once. Only hashes enter D1. Signup atomically inserts the user, consumes the invite, and appends activity. Turnstile is checked server-side, including hostname and action. SQL triggers enforce 50 accounts and 20 projects per account under concurrency. Accounts retain at most 10 sessions. Auth requests are limited to 10 per minute per IP/location, general API calls to 120.

Email is an account identifier, not verified ownership. No special authorization depends on owning an email address. Self-service password recovery, passkeys, email verification, and support tooling remain future work. Keep registration invite-only until those paths are ready.

## Operations

Run `pnpm invite` to create a code; open the generated local `.secrets/invitation-*.txt`. These files are ignored by Git and restricted to the local user. `TURNSTILE_SECRET` is a Wrangler secret. The configured site key is public.

Apply forward migrations with `pnpm db:remote`, then `pnpm deploy`. The current migrations are additive. `wrangler rollback` can restore a prior Worker version, but never assume that it reverses database migrations. Before future destructive migrations, implement and verify database export/restore.

When replacing the temporary domain, update the Worker custom domain and Turnstile allowed hostnames. Cookies are host-only and API mutations enforce same-origin requests.

## Verification of first deployment

Deployed Worker version: `39e82470-efa3-411a-a7fb-bfd85ed20b91`.

TypeScript and local smoke checks passed, including concurrent project quotas. Live HTTPS checks passed for sign in, Secure cookies, project creation/read, cross-tenant denial, activity, and session revocation. Two temporary test users were inserted solely for those API checks and removed afterward with their related records. Missing-invite signup is rejected. The signup screen and its real Turnstile widget were checked in the browser; the widget reported success automatically. A full human invitation signup remains for the first tester.
