> September 30 update: standard Chat activation is now deployed at `be22062c-8178-40eb-90d0-64858af27411`. All 96 migrations are applied; current standard requests spend no customer units/credits. Historical billing records remain intact. The older version/schema observations below are point-in-time evidence, superseded by [current readiness](acceptance.md) and [standard AI accounting](standard-ai-accounting.md). The Word design has not yet been regenerated for this activation.

# Documentation and code reconciliation

September 30, 2026. Compared the current checkout (source through `a8906af` plus existing local edits), feature contracts, numbered migrations, scripts, maintained Word design and fresh read-only Cloudflare state. This is a documentation/status audit, not a new security audit or proof of every customer journey. No runtime code, account, billing, DNS or deployment was changed for this sync.

## Owner decisions — resolved September 30

The owner resolved both conflicts after the initial audit:

- Standard AI remains unlimited under fair use as much as possible. Advanced models consume explicitly approved credits. The shared capacity calculator now assigns no customer units to standard AI while retaining its internal cost and exposing separate cost-stress cases. Production billing remains unfinished.
- Apply all pending migrations in the private, owner-only test environment. The existing deployment scripts already follow this policy. Migrations 0075/0076 were applied at 14:21 UTC; independent readback confirms all 93 migrations, no pending files and empty Gateway receipt tables. Muse routing is unchanged; schema application does not activate inference.

The snapshot below preserves the initial audit evidence. Current migration status supersedes its earlier exclusions. No policy decision remains open from this audit.

## Completed work checked off or corrected

- [x] Core Chat tools for owned projects, status/activity/usage, edits, previews, publication and restore. Sources: `src/chat.ts`, `src/ai-chat.ts`, `src/publications.ts`; connected website journey evidence in [MVP delivery](mvp.md). Broad arbitrary application support is still a separate gate.
- [x] Static/photo website generation, isolated preview, saved versions, reviewed publication/restore and bounded uploads. Corrected stale unchecked MVP items without marking final cross-device acceptance complete.
- [x] Domain ownership instructions and status in Chat and Domains controls. `src/domains.ts` and domain Chat paths implement this; registrar purchases and live custom-hostname TLS remain open.
- [x] Current paid-tier identities at the internal monthly entitlement boundary. `grantPlan` accepts Starter/Personal/Business/Business Pro as well as historical Launch/Studio, not just the legacy two. Updated the allowance/site-count description to match `src/plans.ts` and migration 0052. This is not a completed paid subscription lifecycle.
- [x] CMS structured/image writing and image publication are connected to owner API/UI/Chat. Migrations 0068/0069 are applied. Older renderer-only and upload-only status statements now point to the subsequent implementation.
- [x] Bounded WordPress source upload, analysis, review, confirmed private import, taxonomy and image mapping are implemented with platform coordination deployed (0070/0071/0079/0090). Connected local native/browser evidence exists in [EmDash](emdash.md); first live customer CMS acceptance is still open.
- [x] App upgrade checks, offline code/data replacement, cross-version program/document rollback, cancellation, staged-output cleanup and Chat cards are implemented and deployed (0085–0089). Corrected the earlier “not connected/not deployed” paragraphs in [application data](app-data.md). Whole-infrastructure recovery remains open.
- [x] Internal fair-use review records, entitlement/observation snapshots and operator CLI are implemented; migrations 0091/0092 are applied. Operator-attested company-finance comparison also exists. Corrected the implication that all finance/review work is absent; verified ingestion, customer notices/appeals and enforcement are still absent.
- [x] Reusable backend nominations, explicit consent and terminal withdrawal are deployed (0093). Private maintainer inventory/integrity checks are implemented. Shared publication/license/privacy screening and human promotion are still open.
- [x] Earlier Chat access and search already exist. `src/chat-history.ts`, `/api/chat/history` (including its `q` search parameter), and frontend history controls are present. The latest-100-turn primary query is not the only history access path; no duplicate feature was added.
- [x] Current document identity corrected: maintained `whumpo_mvp_design.docx` is now v0.9, not the v0.5/v0.6 overview linked or named in some older text. Original and v0.5 documents are retained as historical inputs.

## Verified deployment snapshot

Read September 30, 2026 at 14:03 UTC; private raw evidence is ignored at `.secrets/docs-sync-live.json`.

| Service | Active version |
|---|---|
| Platform | `b21f6da7-9703-41bd-963b-bf5dd4665aa8` |
| Public sites | `d1208b4c-f49b-496a-b659-ad6d84f9566e` |
| Visitor applications | `9bee8593-ee7f-4dd3-8934-2b41f43d692e` |
| Bounded runtime | `662ea586-726d-4a00-ad22-d84024a7c0b2` |

Migrations 0001–0093 are present except 0075/0076. Monitor mode is persisted. Registered CMS instances: zero. Platform binding names confirm AI, private files, runtime, identity, Turnstile and Cloudflare OAuth/vault configuration. Customer GitHub App, Stripe and custom-hostname activation bindings are absent. No secret values were inspected or printed. Binding presence is not proof of customer consent or complete service operation.

## Correctly still incomplete

- Paid checkout/renewal/refund/proration and funded customer top-ups; Stripe is deliberately deferred.
- Shared-pool production ledger and task-class metering, rollover grants, actual invoice attribution and economic calibration.
- Live AI Gateway/provider dispatch and verified production model/rate catalog.
- Customer GitHub App setup and real GitHub/Cloudflare consent, reviewed backup and DNS acceptance.
- Registrar purchase integration, annual-domain redemption and real custom-hostname TLS/serving lifecycle.
- First approved native CMS customer deployment, broader/bulk and cross-export WordPress migration.
- Human passkey/Turnstile and physical-device journeys, whole-account lifecycle, automated retention and production disaster-recovery drills.
- Reuse synthetic candidates, privacy/license/security review, publication and security-update handling.

Enhanced owner recovery is **implemented in the existing local working tree, undeployed**. The local source/docs/tests were preserved and not merged into the test deployment as a side effect of this audit. The pricing UI's unavailable trial/contact controls are proposals, not working trial admission or an Enterprise sales handoff.

## Scope and verification

Reviewed status claims and their source/migration/deployment evidence; checked local Markdown links, literal source-file paths and referenced `pnpm` scripts across README and the Markdown documentation tree. Updated the maintained Word design and rendered all ten pages for visual inspection. Original design inputs, license notices and historical release IDs remain historical rather than being rewritten as current facts. Historical paragraphs explicitly identified as milestones are not claims that those old versions are still active.

No application regression suites or new provider journeys were run during this documentation-only sync. Existing tests and recorded acceptance were inspected for scope; fresh live reads establish configuration and migration status only. The maintained documents now separate implemented, deployed, locally verified, live-verified and still-planned behavior. The full MVP remains incomplete.
