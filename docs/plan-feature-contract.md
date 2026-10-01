# Cumulative plan and feature contract

**WH-089, October 1, 2026. Catalogue/presentation implemented and deployed to private testing; commercial feature activation remains separate.** [Pricing policy](pricing-and-model-policy.md) owns the approved product scope. [Issue #44](https://github.com/zemdregon/whumpo/issues/44) records verification. WH-090 implements runtime enforcement; this catalogue grants no authority.

## One catalogue, stable identities

[plans.ts](../src/plans.ts) owns prices and current display names. [plan-features.ts](../src/plan-features.ts) owns version 1 feature identifiers, cumulative packaging and readiness labels. Public `/api/plans`, landing pricing, Settings, subscription plan labels and Chat consume these sources. The prior local connection-only presentation draft is incorporated into the cumulative contract, without overwriting its unrelated primary-checkout changes.

| Stored/API/provider identity | Current display name | Monthly / annual USD | Inheritance |
| --- | --- | --- | --- |
| `starter` | Starter | $17 / $170 | Common foundation |
| `personal` | Creator | $30 / $300 | Starter |
| `business` | Business | $79 / $790 | Creator |
| `business-pro` | Business Pro | $139 / $1,390 | Business |

There is no `creator` plan ID, schema migration, grant replay, receipt rewrite or price change. Existing `personal` preferences, Stripe price mappings, invoice coverage and historical test entitlements retain their identities. Current presentation resolves Creator from the catalogue; historical documents, stored descriptions and provider-owned invoice/product labels are not rewritten. The Personal/Business audience switch and profile's “Personal details” are categories, not plan names. Legacy `launch`/`studio` receipts keep their original names and rules and receive no inferred modern feature tier.

Explore remains a free invitation-only preview. It is not a paid launch tier and carries no launch feature grant. Private test access is still governed by current configured handlers; future preview grants belong to WH-090. Saving a preference, a configured OAuth credential or a sandbox invoice does not activate the full launch matrix.

## Stable feature families

Identifiers describe product capabilities, not UI routes, payment products, provider scopes or permission strings. Keep them stable when display wording changes. Introduce new capabilities explicitly rather than repurposing an existing ID; unknown IDs have no enabled operation. Future permission checks must use the shared resolver, never a prefix comparison or `launchFeatures` Boolean.

| First included tier | Identifiers | Scope |
| --- | --- | --- |
| Starter, inherited by all | `core.editing`, `core.forms`, `core.publication`, `core.insights` | Supported website/app editing, forms/basic contacts, exact publication/version reviews, basic traffic/health. Existing foundations have bounded acceptance; no general VPS or unique-visitor promise. |
| All four paid plans | `core.security`, `core.recovery`, `core.export`, `ai.standard` | Security, exact reviews, basic recovery, supported exports and standard owner assistance remain common. Standard assistance has zero customer-credit debit under fair use. Advanced spending is separate and disabled. |
| Creator | `creator.brand-kits`, `creator.saved-sections`, `creator.shared-styles`, `creator.guest-feedback` | Planned versioned/reusable design tools and reviewed project application. Guest links are accountless, expiring and revocable; no workspace, editing, publication or spending authority. |
| Business | `connections.github`, `connections.cloudflare`, `connections.gmail`, `connections.google-calendar`, `connections.outlook-email`, `connections.microsoft-calendar`, `connections.hubspot` | All seven selected adapters, subject to implementation, provider setup, consent, privacy and actual acceptance. None included in Starter/Creator. |
| Business | `business.leads`, `business.reminders`, `business.workflows`, `business.conversions` | Planned lead stages/notes/dates, reminders, reviewed form-to-record-to-notification workflows and conversion summaries. Basic contact handling remains common. |
| Business Pro | `pro.members`, `pro.approvals`, `pro.staging`, `pro.portfolio`, `pro.bulk-updates` | Planned workspace roles/approvals, isolated staging and reviewed releases, portfolio summaries and per-project reviewed bulk changes. No automatic cross-project publication or dedicated infrastructure promise. |

Business includes every Creator feature; Business Pro includes every Business feature. Custom domains, manual DNS instructions, eligible annual domain benefits, source downloads and Whumpo sign-in are separate from customer external-account connections. Whumpo-hosted infrastructure does not require a customer's Cloudflare authorization. Business staff notification recipients do not become workspace members.

## Inclusion, configuration and readiness

The API adds `featureCatalogue` version 1 with `purpose: "launch-packaging-only"`, `commercialActivation: false`, stable definitions and `customerAcceptance: "pending"`. Each public plan adds cumulative `launchFeatures.featureIds`, `inherits` and `externalConnections`. Existing fields/IDs remain compatible. Private internal allowance figures remain omitted from public plans.

Definitions distinguish `implementation: "private-test"` (existing bounded foundations, not full launch acceptance) from `"planned"` (not delivered). Connections also carry `configuration: "per-account-consent-required"`. This is a prerequisite label, never a statement that the current account is connected. `/api/connections` and existing readiness handlers still supply actual current configuration/consent status; setup, saved authorization and provider health remain different facts. Non-provider features do not imply that all their prerequisites have passed.

Pricing and Settings label the matrix as planned inclusions and expose a keyboard-accessible disclosure showing inherited features and delivery limitations. Chat states inheritance, all seven provider names, protected common features and preview/sandbox boundaries. No new feature action button is created. Current sandbox subscriptions remain explicitly test-mode; real payments, domain redemption, advanced-model funds and resource-pool activation remain unavailable. The trial and Enterprise contact buttons retain their existing unavailable states.

WH-090 must extend current `plan_entitlements`/Stripe invoice service coverage from [plan lifecycle](plan-lifecycle.md) and [sandbox billing](stripe-sandbox.md). Do not introduce a second paid-plan truth, interpret annual invoice coverage as calendar-month grants, or trust the `billing_accounts.plan_id` cache. Its versioned result must distinguish:

1. **Actor authority:** current identity/session/purpose, account/tenant, workspace membership, target resource and current revision, under [workspace identity](workspace-identity.md).
2. **Inclusion:** feature included by authoritative current coverage or an explicit scoped preview grant; source and expiry included.
3. **Configuration/consent:** required provider setup, current customer authorization, approved resources/scopes and data-use consent. Report absent, expired and pending revocation accurately.
4. **Readiness:** implemented scope, accepted environment/cohort, safety/privacy/commercial gates and supported client operation.
5. **Allowed operation:** conjunction of those requirements plus current resource/review/funding checks. Explain a denial without disclosing another tenant's state.

UI/Chat may present that result but cannot create it. Check admission, OAuth callback activation, review confirmation and external dispatch; a previously prepared action or a copied catalogue snapshot is insufficient. Registry metadata and examples in this document do not implement that resolver.

## Loss of eligibility and protected access

The following is required **WH-090 enforcement**, not newly implemented by WH-089:

| Operation after downgrade, expiry or revocation | Required result |
| --- | --- |
| New privileged work, connector reads/writes, approval or OAuth activation | Deny if newly ineligible; recheck current authority at the effect boundary. Existing tokens do not override inclusion. |
| Unsent scheduled/queued work | Stop before dispatch; retain honest status and the original operation identity. No maintainer AI triggered by deterministic work. |
| Uncertain provider outcome | Permit only narrowly scoped readback/reconciliation under owner/resource authority. No blind resend, new mutation or renewed spending approval. |
| Owner history, supported export, disconnect/revocation and basic recovery | Preserve access with ordinary identity/ownership/security checks. Lack of a higher plan is not permission to hide exit/recovery paths. |
| Former collaborator or revoked identity | Never preserve access by treating it as protected owner history. Membership/identity revocation remains authoritative. |
| Existing published sites and saved customer data | Do not silently unpublish/delete on plan loss. Existing publication/capacity/lifecycle contracts apply; no promise of indefinite retention or newly available slots. |
| Existing connected credential | Report connection state separately from plan eligibility. Do not label it disconnected until actual local revocation; allow disconnect and unresolved cleanup. |

A recommendation considers required features as well as sustained usage/cost. A lower plan that lacks a required feature is not a suitable downgrade even with spare capacity. Plan changes, dedicated resources and future spending require their own approval. Final grace periods, seats, volumes, retention, support promises and costs are calibrated by WH-009/023/041; this catalogue invents none.

## Delivery and launch gates

Creator tools remain WH-091/092; Business workflows and connections WH-093–100 plus existing WH-031/032/056; team/release/portfolio work WH-054/101–103. Full paid launch still requires the complete selected matrix and all seven providers through WH-104/047/049. The independent bounded free-beta gate WH-048 remains separate. Standard AI is unlimited fair use with Monitor mode default; safety controls remain active. CSAM implementation, CMS testing and Daybreak remain owner-deferred.

No provider purchase, app registration, customer consent, DNS operation, real checkout, paid feature grant or additional service is authorized by catalogue inclusion. The source changes add no database schema or dependency. Verification and any later test release are recorded below and in issue #44.

## Source and connected local verification — October 1, 2026

- `pnpm --config.verify-deps-before-run=false run check` passed both TypeScript projects and the existing schema/compiler consistency guards. No CMS functional suite ran.
- `node tests/plan-catalogue.mjs` passed the real public handler, all four cumulative tiers, provider/common-feature boundaries, unchanged IDs/prices, no implicit activation, Chat and rendered pricing/preferences.
- `pnpm --config.verify-deps-before-run=false run test:plan-periods` passed real disposable D1 grant/ledger replay, ownership, period rollover/publication protections, existing `personal` preferences and Creator presentation. The new comparison initially included D1 timing metadata; it was corrected to compare the actual ledger rows, then passed. No product assertion was relaxed.
- `pnpm --config.verify-deps-before-run=false run test:subscriptions` passed synthetic-provider/disposable-D1 coverage of the existing price mappings, signed events, exact paid service intervals, renewal/cancellation, uncertainty and immutable receipts. It made no real Stripe requests.
- `pnpm --config.verify-deps-before-run=false run build` and `node tests/frontend-loading.mjs` passed. Frontend source is authoritative; no generated bundle was hand-edited.
- `tools/plan-catalogue-browser.mjs` serves the built frontend with actual handlers and disposable D1 on loopback. Browser checks covered both audiences, monthly/annual prices, inherited features/provider labels, keyboard disclosure and saves, a Business Pro draft followed by Creator, and retained `personal`/annual preferences after reload. The mobile 390px layout had no horizontal overflow and a 44px disclosure target. These are emulated browser checks, not a physical-device or screen-reader claim.

Private connected evidence is `.secrets/plan-catalogue-browser.json` and `.secrets/plan-catalogue-settings-mobile.png`. The fixture independently checks the saved preference and verifies zero inference, publication, usage operations, plan grants or Stripe invoices. No real account preference or customer/provider state changed. Standalone browser screenshot capture was unavailable; the documented combined accessibility/screenshot capture supplied the visual evidence.

This completes WH-089's catalogue/local-acceptance scope. Runtime feature admission remains WH-090, and feature delivery/customer acceptance remains with the individual packets and full paid-launch gates. The source has not been deployed by this checkpoint.

## Private test deployment — October 1, 2026

Release `37497b4a-0b2d-4004-94cf-12838eff9e96` deployed archived source `fe5e5db63b0da5cc455c89af69febc4c318d4b3c`. Independent readback at **2026-10-01 15:54:10 UTC** verified all four candidate versions, unchanged bindings and CMS registration inventory, all 116 existing migrations with none pending, and all 18 archived platform assets. No schema migration was required.

| Worker | Verified version |
| --- | --- |
| Runtime | `516c2056-ff32-4d1e-b8fd-2e8e3a77fad2` |
| Apps | `c548f969-7bcd-4b00-9c42-a0fc6badec80` |
| Sites | `157ee3b4-cd78-4e5f-8109-55cf163d005e` |
| Platform | `728fce77-a0b8-4489-83c0-f82e1de4a797` |

The public catalogue exactly matched the source definitions and retained Creator's `personal` identity. Landing/workspace assets and health returned 200; anonymous profile/Chat/capacity/subscription requests returned 401 and a foreign-origin capacity mutation returned 403. Stripe remained in test mode and domain redemption disabled. Private evidence: `.secrets/tier-release-verification.json` and the matching release archive. These readbacks verify the deployment and entry boundaries; they do not add authenticated live customer acceptance, provider/billing mutations, feature activation, CMS functional testing or customer publication.
