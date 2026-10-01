# Compiled clients for existing website services

**September 30, 2026 — WH-066C implementation in progress.** This companion compiler and its owned read-time authority resolver are implemented as source libraries. They are not yet connected to Chat, persisted proposals, publication or a new HTTP route. [Execution issue #17](https://github.com/zemdregon/whumpo/issues/17) and [parent #14](https://github.com/zemdregon/whumpo/issues/14) remain open. Local verification is recorded below; no new deployment or live acceptance is implied.

## Contract and reuse

The existing content specification's `forms` point to general record schemas. Neither current contact intake nor a stateless function implements that record contract. This compiler uses a separate closed companion document, leaving `project-content@1`, the v1 specification and all saved versions unchanged:

```json
{
  "schemaVersion": 1,
  "contact": { "component": "contact-link@1" },
  "statelessForm": {
    "component": "stateless-form@1",
    "config": {
      "title": "Garden estimate",
      "description": "Choose how many hours of care you need.",
      "buttonLabel": "Calculate",
      "fields": [{ "key": "hours", "label": "Hours", "type": "number" }]
    }
  }
}
```

Either service may be `null`. That is desired configuration, not a command to disable a currently active service. No URL, account/project ID, backend ID, credentials, executable source, generic records, staff access, uploads, notification rule or arbitrary field mapping is accepted in this document.

| Client | Maintained service reused | Authority and data boundary |
| --- | --- | --- |
| `contact-link@1` | The existing fixed Contact section links to `https://whumpo.com/contact/PROJECT_ID`. That handler retains its name/email/message fields, Turnstile admission, owner-only inbox, quotas and retention. | The companion cannot add fields or read messages. Contact activation remains an exact separate review against the current website publication/settings revisions. |
| `stateless-form@1` | The existing platform form renderer, fixed browser script and number/text/boolean/choice field validator; up to eight fields and 4 KiB normalized configuration. | The target is the project's currently reviewed public backend, pinned by publication review ID. Requests omit credentials and receive only the caller's result. No persistent record access or maintainer inference. Form activation remains a separate exact review. |

The form's schema does not prove that the selected function implements the owner's desired calculation. The existing exact backend test and publication review remain necessary. Configuration compilation never executes source or a sample request.

## Immutable artifact identity

`compiler-locks/project-service-clients-v1.json` pins the rendering bundle, source inputs, wrapper and esbuild version. `project-service-clients@1` resolves `contact-link@1` and `stateless-form@1` from that same maintained bundle. Their shared bundle digest is deliberate; these are not independently downloaded packages. The current server catalog controls availability separately from historical artifact identity. Both module entries must remain available for this compiler version, including a request that only uses one.

`tools/check-service-client-compiler.mjs` checks this identity during `pnpm check` and `pnpm build`; the release build fingerprint includes its lock and checking tool. The existing content compiler lock remains unchanged. Once accepted, do not repin an identity after changing its renderer, schema, browser script or wrapper. Preserve the old implementation and add a reviewed version. No runtime dependency resolver, external package download or model participates in compilation.

Given the same normalized configuration, exact saved site input, target snapshot and lock, compilation yields identical bytes and digests:

- A **private preview** with disabled form fields, no executable script, no form endpoint and no navigable contact link. Its headers retain private/no-store and the script/form/network-disabled sandbox. A future endpoint must authenticate the owner and actually apply those headers.
- A **release candidate** exactly matching the existing `publishedHTML` transform for those settings and backend publication. It contains the platform-authored script and pinned endpoint when a form is requested. These bytes are evidence, not permission to serve them.
- A manifest containing both artifact hashes and UTF-8 sizes, normalized configuration digest, complete target snapshot/digest, exact service destinations, script CSP hash and required separate reviews. `activation: not-authorized` and `published: false` are explicit.

The compiler accepts only exact normalized `site-page@1` configuration and HTML that reproduces it. A substituted HTML body with a recomputed hash still fails. The base page is at most 32 KiB; companion input is at most 6 KiB, target and lock each 4 KiB, and each complete output at most 48 KiB. The larger candidate allowance does not change the existing 32 KiB saved-site limit or give a storage adapter permission to truncate output.

## Ownership and freshness

`compileOwnedServiceClients` takes the authenticated server user plus an owned project/site version. The user identity must never come from a model action. One D1 statement joins the owner, immutable website, current website publication, contact settings, backend publication/review/version and current form settings. It chooses the backend from the same project; the caller cannot nominate another project's backend or endpoint.

The target binds the exact website version/hash, current website publication revision/version, contact revision/active state, backend review/version/hash/revision, and form revision/review/active state. The resolver checks site and backend bytes against their saved digests and refuses recorded required screening holds. Existing specification holds also apply. No raw backend source, visitor content or secret value is returned in the compiled manifest.

`requireCurrentServiceClientTarget` reloads ownership and these identities, rejecting changed settings, republication, withdrawal, removed sites and known holds. **This is a read-time check, not an atomic write guard.** A later save/activation adapter must compare the same authority inside its committing transaction. A successful check cannot authorize a write after a concurrent change. Cloudflare's [D1 batch transaction contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) is the existing route for atomic local statements; checked September 30, 2026.

A pure compiler target is only shaped data. Pure compilation deliberately cannot establish that supplied ownership/publication metadata is real; application callers must use the owned resolver and final transaction guards. Neither library is exposed as an HTTP or model tool in this slice.

## Publication, restore and lifecycle follow-through

Existing website publication changes disable contact intake and hide backend forms until fresh exact reviews. Backend republication, including the same saved source, invalidates old pinned form endpoints. Those rules remain effective; recompilation cannot revive a previous approval.

The remaining #17 integration must:

1. Persist bounded immutable companion proposals, artifacts, comparison envelopes and forward-version snapshots tied to the exact content version. Define how a content edit chooses or carries its desired service configuration without silently activating it.
2. Connect natural-language preparation and private previews to current/recent-auth exact approval controls. Reject concurrent/stale/replayed changed payloads atomically with the owner action receipt.
3. Reuse the separate website, contact and backend/form reviews. Rebind against the newly current publication after publishing/restoring content; never assume a private candidate's former publication revision can grant current activation.
4. Restore compatible configuration as a new forward version after rechecking current module availability, ownership, endpoint withdrawal, content holds and deletion. Old target metadata must not restore source, data, role membership, removed bytes or a withdrawn permission.
5. Preserve deletion/export/retention invariants for companion artifacts and any referenced version. Source export must state that hosted contact intake and backend execution require their separately authorized runtime.
6. Demonstrate the complete connected Chat → preview → private apply → separately reviewed runtime flow and recovery through HTTP and accessible/mobile browser interactions. Prove normal visitor operations with maintainer inference unavailable.

General records/access/files delivery remains WH-067. Notifications/rules and customer runtime AI remain their own tasks. This slice adds no detector and does not complete the broader safety launch gates or change other public handlers' safety coverage. Disabling critical live services remains available through their existing controls even when compilation is held.

## Cost, prerequisites and verification

Uses existing deterministic renderers and read-only D1 queries. No new Cloudflare binding, paid service, provider authorization, DNS change or recurring minimum is introduced. Eventual serving/read queries use the account's existing Worker/D1 allowances; this is not a promise of zero marginal cost. See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) for provider terms; current account entitlement and aggregate use require operational verification.

Verification commands for this source slice:

- `node tests/service-client-compiler.mjs`: exact existing-renderer output, inert previews, strict shape/size/reference rejection, escaped labels, normalized input, stable digests, detached data, unchanged content-v1 identity, an independent copied-tree/process/timezone reproduction, catalog withdrawal, lock/source drift and stale-constant gates. Network/inference is replaced with a throwing stub.
- `node tests/service-client-authority.mjs`: disposable local D1 and the actual isolated QuickJS runtime; two owners and same-owner cross-project refusal; read-only compilation; existing exact contact/form/backend/site reviews; byte equality to the served page; stateless visitor calculation with maintenance inference unavailable; changed settings, website restore/republication, backend republication/withdrawal, deleted versions and known holds. These are source-library/existing-handler fixtures, not a newly connected Chat journey or deployed customer acceptance.

Local results on September 30, 2026: both new suites passed, as did `pnpm check`, `pnpm build`, `node tests/specification-compiler.mjs`, `node tests/release-manifest.mjs` and `git diff --check`. Existing content-v1 digest remains `25a73c88b1a51e9ec9512ca72c22bd515d835403b659c34fc3bc9b96780c3d2b`; the new compiler digest is `c5850e0381d236879c411333eeda2627f9aafabe42f92b9f798a6693e86126cd`.

The first authority fixture attempted a raw version deletion and correctly hit the existing `version_removal_unreviewed` guard. The fixture was corrected to prepare and confirm the actual owner removal review; no guard was relaxed, and the full rerun passed. The reused checkout links to the already installed workspace dependencies (Node 24.21.0, pnpm 11.19.0, esbuild 0.28.2, TypeScript 7.0.2, Wrangler 4.143.0). Initial pnpm execution tried an automatic reinstall and stopped before confirmation; checks/build subsequently ran with `pnpm_config_verify_deps_before_run=false` to preserve that shared installation. The generated visitor bundle's checkout-path comment differences were restored; no frontend source changed and this checkout's build is not an approved deployment artifact.

No new migration, CMS functional testing, Stripe/provider activation, physical-device acceptance or live publication is part of this slice.
