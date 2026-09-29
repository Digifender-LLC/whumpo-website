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

## Publishing desk follow-through — September 29, 2026

The React workspace now includes `/workspace/cms`, linked from CMS dashboard controls and available through “open publishing desk” or `/publishing` in Chat. Owners can select an initialized EmDash project, create a private post/page, edit supported plain text, reload its current revision, open a private preview, and prepare publication in Chat. Existing saved publication reviews and edit recovery receipts remain accessible. Publication, withdrawal and staged-edit discard retain their separate review/confirmation steps.

The content API uses the existing owner checks, revision fences and durable request receipts. An uncertain save retains its exact request ID and payload for retry. Rich or malformed content is refused by this plain-text editor rather than flattened. The editor is limited to a 100-character title and 2,400 UTF-8 bytes of body text; richer authoring, media and WordPress import remain future work. CMS provisioning still requires the existing operator workflow.

Migration 0060 updates the active database admission triggers for private CMS origins and customer DNS targets to Whumpo. It preserves ownership, approval, domain-proof and credential constraints. Production inventory before migration contained zero CMS instances/deployments. Historical migration files remain unchanged.

Verification: backend/frontend type checks, production build, CMS editor shape checks, navigation checks, complete CMS deployment/publication suite and Cloudflare routing suite passed. A synthetic local browser session using the real platform HTTP handler and a mock native CMS service verified saved multiline text readback and a publication review containing the edited title. This is not a live native EmDash acceptance test.

Migration 0060 applied successfully in production. Platform version `3fbc6c8c-0850-4f85-93c5-66b316c49b26` serves the publishing desk. Post-deployment checks confirmed HTTP 200 health and the exact built frontend asset, HTTP 401 for anonymous content reads, HTTP 403 for foreign-origin writes, and all three active database triggers using Whumpo origins without retired-domain targets.

## Unsaved publishing work

The publishing desk guards router navigation, draft/project switching, reload-saved-version controls and CMS-to-Chat actions while local edits exist. One shared dialog lets the owner stay or explicitly discard local changes. A save in progress holds workspace navigation; an uncertain save explains that the request may already exist and preserves exact-request retry while the editor stays open. Browser reload/close uses the router's native before-unload protection (browser support varies; this is not crash recovery or automatic draft backup).

Successful saves establish a new clean baseline, including when a provider returns an unchanged revision. Cancelling navigation retains title and body. No unsaved CMS content is copied to local storage or shared between accounts.

Browser verification used the real local platform handler with a synthetic CMS service: cancelling sidebar navigation retained a new draft; switching to existing content required explicit discard; a delayed PATCH held navigation; a proxy then discarded the successful save response and returned 502; the dialog changed to uncertain-save guidance; exact-request retry recovered successfully; subsequent dashboard navigation proceeded without an unsaved-change prompt. Backend/frontend type checks and the production build passed. The native browser close/reload prompt was not separately exercised.

Deployed as platform version `20d5a951-416d-4c52-8dea-2866d3a433fa`. Live checks confirmed the CMS route, byte-for-byte frontend bundle match and healthy platform response.
