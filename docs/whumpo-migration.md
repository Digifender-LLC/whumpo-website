# Whumpo frontend and domain migration

## Live addresses

- `https://whumpo.com`: advertising home page, invite-only sign-in, owner workspace and APIs.
- `https://PROJECT_ID.whumpo.site/`: each project's published customer website, directory, CMS snapshots and public backend endpoint.
- `https://app-PROJECT_ID.whumpo.site/`: controlled visitor application, project-specific passkeys and host-only session cookies.
- `hosting.whumpo.site`: customer custom-domain hosting target; separate ownership proof and exact DNS review remain required.

Project IDs are UUIDs. Unknown projects return 404. The site host derives identity from the hostname, so a URL path cannot select another project's published content. Generated website code cannot share the controlled application origin. The owner Worker only accepts the platform origin outside local development.

The old platform domain and its apps/sites subdomains have no Worker custom-domain bindings, DNS records, or Worker routes. No redirects or legacy origin fallback exist. The domain registration itself was not canceled. Existing Worker/database/bucket names are retained to preserve stored data and avoid duplicate infrastructure.

## Frontend

React 19, Vite 8, TypeScript, Tailwind 4, shadcn/ui components with Radix primitives, TanStack Router, and TanStack Query. The Vite entry is `frontend/src/main.tsx`; production assets are built into `dist/`. The former main-page static bundle and old brand assets have been removed. Visitor application assets remain a separate, controlled deployment.

Chat is the default first sidebar tab. Dashboard and custom workflow pages have their own full-width views. Settings and the profile photo sit at the sidebar bottom; account email is inside Profile. No Tools menu or Add Workspace control. Empty custom pages invite the user to ask the agent to create one.

The brand uses Deep Sky, Sky Blue, Cloud White, mint and sunshine accents, rounded Nunito display text, Inter body text and the supplied cloud-elephant direction. Fonts and illustration are hosted with the application.

The 700 ms acknowledgment delay and minimum 1,000 ms visible interval reuse the tested presentation helper: a main answer ready at 730 ms displays at 1,700 ms when the acknowledgment appeared at 700 ms. Errors are not held.

## Deployment and checks — September 29, 2026

- Applied migration inventory and built the React application; backend and frontend type checks pass.
- Updated Turnstile to Whumpo and restricted its allowed hostname to `whumpo.com`.
- Configured proxied wildcard and hosting DNS for `whumpo.site`.
- Deployed the runtime, controlled app service, customer site host, and owner platform.
- Publication tests verify review/confirmation, stale releases, per-project serving and cross-project URL rejection.
- Signed visitor passkey tests verify project origin isolation, browser challenges, secure cookies, private state and revocation.
- Profile/password tests include the ten-session pruning boundary and concurrent credential replacement.
- Website backend form and acknowledgment timing checks pass.
- Browser checks cover the real landing/sign-in pages and synthetic local Chat, Dashboard, Profile and mobile layout.
- Live HTTPS probes confirm platform health, protected owner routes and 404 for unpublished customer/visitor hosts. The retired domains no longer resolve from the verification host.

A physical passkey enrollment and human Turnstile completion have not been performed in this migration. Existing password sign-in is retained. Paid subscriptions remain disabled; no Stripe account is configured. Muse Contributor remains the testing model.
