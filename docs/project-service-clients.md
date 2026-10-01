# Compiled clients for existing website services

**September 30, 2026 — WH-066C implementation in progress.** The pinned companion compiler now has bounded private proposals, immutable saved settings, forward restore, natural-language Chat tools and authenticated preview/comparison routes. Saving settings does not publish or activate a service. Migration `0112_service_client_specifications.sql` is pending deployment. [Execution issue #17](https://github.com/zemdregon/whumpo/issues/17) and [parent #14](https://github.com/zemdregon/whumpo/issues/14) remain open. Local verification is recorded below; no new deployment or live acceptance is implied.

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

- A **private preview** with disabled form fields, no executable script, no form endpoint and no navigable contact link. Its headers retain private/no-store and the script/form/network-disabled sandbox. The authenticated proposal/snapshot routes apply those headers.
- A **release candidate** exactly matching the existing `publishedHTML` transform for those settings and backend publication. It contains the platform-authored script and pinned endpoint when a form is requested. These bytes are evidence, not permission to serve them.
- A manifest containing both artifact hashes and UTF-8 sizes, normalized configuration digest, complete target snapshot/digest, exact service destinations, script CSP hash and required separate reviews. `activation: not-authorized` and `published: false` are explicit.

The compiler accepts only exact normalized `site-page@1` configuration and HTML that reproduces it. A substituted HTML body with a recomputed hash still fails. The base page is at most 32 KiB; companion input is at most 6 KiB, target and lock each 4 KiB, and each complete output at most 48 KiB. The larger candidate allowance does not change the existing 32 KiB saved-site limit or give a storage adapter permission to truncate output.

## Ownership and freshness

`compileOwnedServiceClients` takes the authenticated server user plus an owned project/site version. The user identity must never come from a model action. One D1 statement joins the owner, immutable website, current website publication, contact settings, backend publication/review/version and current form settings. It chooses the backend from the same project; the caller cannot nominate another project's backend or endpoint.

The target binds the exact website version/hash, current website publication revision/version, contact revision/active state, backend review/version/hash/revision, and form revision/review/active state. The resolver checks site and backend bytes against their saved digests and refuses recorded required screening holds. Existing specification holds also apply. No raw backend source, visitor content or secret value is returned in the compiled manifest.

`requireCurrentServiceClientTarget` reloads ownership and these identities, rejecting changed settings, republication, withdrawal, removed sites and known holds. **This is a read-time check, not an atomic write guard.** The private save adapter now compares the same authority inside its committing transaction. Existing activation reviews independently check their own current authority. A successful check cannot authorize a write after a concurrent change. Cloudflare's [D1 batch transaction contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) is the existing route for atomic local statements; checked September 30, 2026.

A pure compiler target is only shaped data. Pure compilation deliberately cannot establish that supplied ownership/publication metadata is real; application callers must use the owned resolver and final transaction guards. The private store calls the owned resolver; the pure compiler is not an HTTP or model execution tool.

## Private saved settings and Chat

Migration 0112 adds immutable proposals, full settings snapshots, metadata-only apply receipts, a per-project revision head and exact reply-digest Chat links. The model can `read`, `prepare`, `history`, `restore` or reopen a `review` using the `serviceClients` action. Read supplies the current desired configuration, exact website ID and revision to the existing single follow-up model step. History supplies at most 25 saved IDs/revisions to that same bounded continuation, so the agent can prepare a requested restore without showing raw JSON. It exposes no backend source, visitor records or credentials. The model cannot apply or confirm.

Preparation selects one exact owned website version. The comparison shows readable previous/requested service and field summaries. Complete configuration and exact service references remain in collapsed technical details. Saving against a new website requires an explicit preparation; a content edit does not silently carry or activate clients. The ten-minute proposal binds the owner/project, prior settings revision/version/digest, selected site, optional restore version, configuration, compiler lock, complete target, manifest, comparison, policy and expiry.

The server-issued `serviceClientApply` control requires recent authentication and origin/rate-limit checks. One D1 batch creates the confirmation turn, full independent settings snapshot, metadata receipt, revision head and activity. Database guards recheck ownership, current publication/contact/backend/form references, expected revision, expiry, known holds and exact proposal artifacts inside that transaction. A proposal removed after application validation aborts the whole batch. Competing approvals cannot advance the same revision twice. A retry recovers an existing receipt; changed payloads cannot reuse it.

Owner-only routes:

- `GET /api/service-client-reviews/:id/preview`: current disabled proposal preview.
- `GET /api/service-client-reviews/:id/diff`: escaped before/after comparison and exact references.
- `GET /api/service-client-versions/:id/preview`: historical disabled saved preview, recompiled and checked against its recorded artifacts and current safety holds.

These links reject extra query parameters and use the existing private/no-store sandbox policy. No route serves the stored release candidate as active content. Chat exposes approval controls only from immutable server reply evidence and current owned review state. Routine service operations remain natural-language requests.

Bounds: 20 pending/stored proposals per project and 400 globally; 25 full snapshots per project and 1,000 globally; 500 metadata receipts per project and 20,000 globally. Preparation removes expired proposals for that project and up to 100 other expired proposals. These are private test storage bounds, not public plan allowances. A snapshot independently stores the full normalized configuration, target, lock, manifest, disabled preview and release candidate within the compiler's byte limits.

## Publication, restore and deletion

Saving desired settings neither enables nor disables contact intake or a website tool. Existing website publication changes disable contact intake and hide backend forms until fresh exact reviews. Backend republication, including the same saved source, invalidates old pinned form endpoints. The agent must inspect current services and prepare the separate existing publication/contact/backend-form reviews. A historical candidate is never activation permission. Static source exports explicitly disclose that hosted contact intake and website tools are excluded and require their separately authorized runtime; the archive does not transfer endpoints, visitor data or approvals.

Restore creates a new forward private settings version. It rechecks current module availability, ownership, holds, retained website bytes and current endpoint authority. A saved stateless form must still resolve to the same backend version and digest; a newly reviewed publication of that same source can be rebound, while replacement source or withdrawal is refused. Contact-only restore has no backend compatibility requirement. Historical metadata never restores source, visitor data, memberships, credentials or removed permissions.

The current settings head and unexpired unapplied proposals retain their referenced website versions, including the prior/restore settings' websites. Both removal preparation and the final deletion transaction enforce retention. Removing an eligible website through its existing exact review cascades full companion snapshots and purges every associated full proposal/comparison copy. Independent settings on another retained website remain. Metadata-only receipts survive to prevent replay from recreating deleted bytes. Direct receipt/head deletion is refused while the parent exists; otherwise eligible operator project/account cascades clean up the new private state. Existing backend review retention can still block parent deletion and requires its separate operator cleanup; this migration does not weaken it. There is no new customer delete route or automatic pruning of saved snapshots.

Remaining #17 acceptance includes a direct saved-configuration handoff to the separate activation reviews, the full activation/recovery browser journey, and deployment/readback. Source-library checks and local scripted Chat are not real-model or deployed customer acceptance. The parent remains open.

General records/access/files delivery remains WH-067. Notifications/rules and customer runtime AI remain their own tasks. This slice adds no detector and does not complete the broader safety launch gates or change other public handlers' safety coverage. Disabling critical live services remains available through their existing controls even when compilation is held.

## Cost, prerequisites and verification

Uses existing deterministic renderers and bounded D1 reads/transactions. No new Cloudflare binding, paid service, provider authorization, DNS change or recurring minimum is introduced. Eventual serving/read queries use the account's existing Worker/D1 allowances; this is not a promise of zero marginal cost. See [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) for provider terms; current account entitlement and aggregate use require operational verification.

Initial compiler-library verification (commit `6a71137`):

- `node tests/service-client-compiler.mjs`: exact existing-renderer output, inert previews, strict shape/size/reference rejection, escaped labels, normalized input, stable digests, detached data, unchanged content-v1 identity, an independent copied-tree/process/timezone reproduction, catalog withdrawal, lock/source drift and stale-constant gates. Network/inference is replaced with a throwing stub.
- `node tests/service-client-authority.mjs`: disposable local D1 and the actual isolated QuickJS runtime; two owners and same-owner cross-project refusal; read-only compilation; existing exact contact/form/backend/site reviews; byte equality to the served page; stateless visitor calculation with maintenance inference unavailable; changed settings, website restore/republication, backend republication/withdrawal, deleted versions and known holds. These are source-library/existing-handler fixtures, not a newly connected Chat journey or deployed customer acceptance.

Initial library results on September 30, 2026: both new suites passed, as did `pnpm check`, `pnpm build`, `node tests/specification-compiler.mjs`, `node tests/release-manifest.mjs` and `git diff --check`. Existing content-v1 digest remains `25a73c88b1a51e9ec9512ca72c22bd515d835403b659c34fc3bc9b96780c3d2b`; the new compiler digest is `c5850e0381d236879c411333eeda2627f9aafabe42f92b9f798a6693e86126cd`.

The first authority fixture attempted a raw version deletion and correctly hit the existing `version_removal_unreviewed` guard. The fixture was corrected to prepare and confirm the actual owner removal review; no guard was relaxed, and the full rerun passed. The reused checkout links to the already installed workspace dependencies (Node 24.21.0, pnpm 11.19.0, esbuild 0.28.2, TypeScript 7.0.2, Wrangler 4.143.0). Initial pnpm execution tried an automatic reinstall and stopped before confirmation; checks/build subsequently ran with `pnpm_config_verify_deps_before_run=false` to preserve that shared installation. The generated visitor bundle's checkout-path comment differences were restored; that initial slice changed no frontend source. The continuation below adds Chat controls. This checkout's build is not an approved deployment artifact.

Migration 0112 is additive and pending deployment; the deployed test release still has 111 applied migrations. Earlier Workers ignore its new tables. No CMS functional testing, Stripe/provider activation, physical-device acceptance or live publication is part of this continuation.

### Connected private-settings continuation

`node tests/service-client-journey.mjs` uses disposable local D1, actual HTTP handlers, scripted model interpretation and real isolated QuickJS. It covers the owned read continuation, exact private apply/restore, current backend compatibility, separate existing activation reviews, visitor operation without maintainer inference, stale/expiry/hold rollback, replay/recovery and deletion/cascade invariants. Passed September 30, 2026 (local date; browser receipts October 1 UTC), including actual read → prepare and history → restore model continuations. `pnpm check`, `pnpm build`, `node tests/service-client-compiler.mjs`, `node tests/specification-journey.mjs`, `node tests/version-removal.mjs`, `node tests/release-manifest.mjs`, `node tests/agent-prompt-focus.mjs`, `node tests/chat-reply.mjs` and `git diff --check` passed. pnpm automatic dependency reinstallation was disabled for the shared dependency symlink, as above; the generated visitor bundle's path-only comments were restored after inspection. No deployment artifact is approved by this local build.

`WHUMPO_SERVICE_BROWSER=1 node tests/service-client-journey.mjs` passed with the actual built React UI and the same disposable HTTP/D1 fixture. At a 390×844 viewport, Chat stayed within 390 pixels; all three review controls were 44 pixels tall. The comparison presented readable service/field summaries with technical details collapsed. The private preview had no script, endpoint or enabled input. Keyboard approval issued one exact typed action, saved one private revision, and activated neither the website nor its form. The browser portion made no model or runtime calls. Private evidence: `.secrets/service-client-browser.json` and `.secrets/service-client-mobile.png`. This is viewport testing, not physical-device acceptance.

Two initial fixture expectations were corrected: a disabled form element is valid inert preview markup, and pre-existing backend review foreign keys intentionally block direct parent deletion. The final test explicitly proves that refusal and separately proves new-table cascades for eligible parents. No activation, retention or safety guard was relaxed. General records/CMS/provider testing, a direct saved-configuration activation handoff and real-model/live acceptance remain outside this evidence.
