# TownHello EmDash integration

Pinned native EmDash CMS profile, currently a private Cloudflare verification instance. See [support contract](../../docs/emdash.md).

Build from the workspace root with `pnpm build:emdash`. Run local development with `pnpm --filter @townhello/emdash dev`. Do not add a public route until TownHello ownership and first-admin setup are connected. Never deploy this profile against the TownHello control database or reuse it for another customer.

Upstream blog template: emdash-cms/emdash commit 5de3bdc4310f6bcca013f05002f05a61e208b2a4, MIT (UPSTREAM-LICENSE). Local changes use the Cloudflare D1/R2 adapter without sandboxed plugins, passthrough images, local fonts and TownHello theme defaults. Font license notices are in ../../docs/licenses.
