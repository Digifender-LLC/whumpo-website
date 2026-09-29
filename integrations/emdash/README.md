# TownHello EmDash integration

Pinned native EmDash 1.0.1 CMS profile with TownHello's signed owner bridge. A private Cloudflare verification instance is deployed; the tenant provisioner consumes reviewed setup requests. See the [current support matrix and integration contract](../../docs/emdash.md#current-support-status--september-29-2026).

Build from the workspace root with `pnpm build:emdash`. Run local development with `pnpm --filter @townhello/emdash dev`. Keep the native Worker private: TownHello sends signed management requests and serves approved article snapshots through its public site host. Never deploy this profile against the TownHello control database or reuse its stores for another customer.

Run `npm run test:emdash-bridge` from the workspace root for an isolated native lifecycle and recovery test. It creates local stores, verifies setup, owner identity, posts/pages edits and publication, then boots the restored native database and verifies a new edit. It does not provision or modify production resources.

WordPress import, media authoring, full production recovery and CMS custom domains remain unfinished. Sandboxed plugins are disabled to honor the no-paid-only-services constraint.

Upstream blog template: emdash-cms/emdash commit 5de3bdc4310f6bcca013f05002f05a61e208b2a4, MIT (UPSTREAM-LICENSE). Local changes use the Cloudflare D1/R2 adapter without sandboxed plugins, passthrough images, local fonts and TownHello theme defaults. Font license notices are in ../../docs/licenses.
