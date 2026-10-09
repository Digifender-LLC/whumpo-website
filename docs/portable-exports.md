# Portable project exports and managed-service adapters

**WH-077 contract slice (WH-186), October 8, 2026 UTC; source baseline `ca17c6a` (rebased October 9 onto `92a001f`; the intervening merges #175, #178 and #180 changed no export, module or schema source, and the contract test still passes). Planned, not implemented.** **Update (WH-187, October 9, 2026 UTC):** the bundle builder, permission filter and owner route are [implemented in source with disposable local tests only](#builder-and-permission-filter-in-source-wh-187--october-9-2026-utc); nothing is deployed, the standalone runtime, clean-room and live slices (WH-188–191) remain planned, and the source stacks on the unmerged WH-018 draft (PR #170), which needs an owner-run cutover. This freezes the portable export bundle format, the permission filter, three honestly named portability tiers, the unavailable-feature report and the clean-environment verification plan for [WH-077](roadmap/backlog.md#wh-077--define-and-verify-portable-project-exports-and-managed-service-adapters), and splits delivery into WH-186–191. It adds no route, table, binding, provider, Cloudflare resource, schema change or deployment, and no `src/` behavior changes. The [offline reference](../tools/prototypes/portable-export.mjs) and [conformance checks](../tests/portable-export-contract.mjs) use synthetic data only. No Worker imports them.

It consumes, and does not replace: [WH-071 logical identities and the export boundary](workload-placement.md#export-and-restoration-boundary), [WH-067 module serializers](shared-modules.md) (records, files, roles, collections), the [WH-009/116 lifecycle classes](data-lifecycle.md) in [data-lifecycle.json](data-lifecycle.json), the [current-version policy](current-version-policy.md), the existing [static source download](mvp.md#source-export) and the WH-018 platform account export (`whumpo-account-export-v1`, open PR #170, not merged when this was written).

## Decision

A customer can download one **portable project bundle** per project: a deterministic, checksummed ZIP with a strict manifest. It contains what the owner owns and is cleared to receive: the saved specification, public static pages and their approved photos, owner data sets, separately approved visitor data sets, reviewed custom source, and the exact compiler, component, module and data-format versions. It also states what it leaves out, which managed capabilities do not run outside Whumpo, and what the customer must set up themselves.

- **Honest tiers.** The bundle separates a static source download, data portability and a functioning standalone application ([tiers](#three-portability-tiers)). Only the first is runnable in v1. A frontend that still calls private Whumpo APIs is never described as complete or runnable.
- **One filter, current versions only.** The bundle is built by one server-side permission filter ([`portable-filter@1`](#permission-filter-portable-filter1)) over the same module serializers the account export uses. Readers accept exactly format version 1; there is no legacy decoder.
- **Verified, not assumed.** A clean process with no Whumpo APIs, credentials, network or model must boot the claimed subset from the bundle alone before the claim is shown to a customer ([verification plan](#clean-environment-verification-plan)).
- **No platform source disclosure.** The exit contract is the customer's content, data, configuration, reviewed custom source, documented formats and migration paths. Whumpo's internal platform source, catalog implementation and maintained handlers are not part of the bundle. A future standalone adapter is a separately published component with its own license decision ([owner decisions](#open-owner-decisions)).

Export never deletes, moves, unpublishes or transfers anything in Whumpo, and it does not transfer a subscription, domain, provider authorization or publication approval.

## Current evidence

| Existing path | What it proves today | Gap this contract closes |
| --- | --- | --- |
| Static source download ([`src/exports.ts`](../src/exports.ts), [MVP](mvp.md#source-export)) | `whumpo-static-site` v1: one exact saved homepage, `_headers`, checked photos and a checksum in a deterministic stored ZIP (fixed timestamp). Owner-only existing route. | One page only; no data, module versions, exclusion list or capability report. It is the existing tier-1 path and stays the static projection ([decision 4](#open-owner-decisions)). |
| GitHub backup ([github-backups.md](integrations/github-backups.md)) | Pushes that same archive to a customer repository. | Same scope as the static download. |
| Module serializers ([shared modules](shared-modules.md#records-export-serializer-wh-127--october-4-2026-utc)) | `whumpo-module-records` v1, `whumpo-module-files` v1, `whumpo-access-roles` v1 and the directory export (`whumpo-directory` v1) with import validation. Source and local tests only; **not deployed** (pending empty-database cutover). | Not composed into one per-project bundle; visitor slices are owner-run with separate approval. |
| Account export (WH-018, PR #170 branch) | Exact owner review, single-use download, per-account allowance, secret/other-tenant exclusion, approved-only media. Source and local tests only, not merged. | Account-wide and human-readable, explicitly **not** a restore input or portable project delivery. |
| Other exports | Visitor self-export (`whumpo-visitor-export-v1`), backend state (`whumpo-backend-state`), CMS content draft download. | Separate audiences; not composed here. The visitor document stays on its own visitor-authenticated path. |

## Three portability tiers

| Tier | Contents | Claim allowed in v1 |
| --- | --- | --- |
| **1. Static source download** | `site/public/`: compiled public pages, approved photos, `_headers`. | **Runnable** only if every static file passes the tier check: no script, no network call, no Whumpo origin, no platform route (`/api`, `/modules`, `/backend`, `/app`, `/workspace`), no form action or form endpoint. |
| **2. Data portability** | `specification/`, `data/` (JSON data sets and JPEG files), `source/` (reviewed custom source), `frontend/` (custom presentation source). | **Data only.** Readable, checksummed and importable elsewhere; nothing here runs by itself. |
| **3. Functioning standalone application** | A frontend plus working replacements for the managed capabilities it uses. | **Unavailable in v1.** Records, forms, files, access, notifications, connectors and custom functions have no supported standalone runtime yet ([report](#unavailable-feature-report)). WH-188 may add a narrow subset only with WH-189 clean-room evidence. |

The rule is mechanical: a file is in the runnable tier only when the reader's own scan passes, not because the manifest says so. A [WH-070 composition](shared-modules.md#connected-acceptance-two-frontend-compositions-wh-130--october-4-2026-utc) calls `POST /modules` on the visitor origin, and a stateless backend tool posts to `https://PROJECT.whumpo.site/backend/…`. Both are exported as source with their requirements listed (`frontends[].requires`) and are never runnable. A page that embeds such a tool drops the whole static tier to data-only. Staff-audience pages never enter the runnable tier, because serving them from a static host would remove their access control. Their text stays in the specification.

## Bundle format v1 (`whumpo-portable-export`)

### Packaging

- **ZIP, stored (no compression), deterministic.** Every entry uses method 0, general-purpose flag `0x0800` (UTF-8 names), version 2.0, the fixed DOS timestamp 1980-01-01 00:00, no extra fields, no comments, no data descriptors and no ZIP64. Like the existing static download, storage mode avoids compression CPU and keeps repeated downloads byte-identical. Any ZIP tool can open it.
- **Order.** `manifest.json` is the first entry. All other entries follow in ascending byte order of their paths.
- **Paths** are constants or validated local identifiers: `[A-Za-z0-9_.-]` segments separated by `/` (only the fixed `README.txt` and `RECONFIGURE.txt` use capitals), at most 200 bytes, no empty, absolute, `..` or backslash segments. Customer-chosen names never become paths.
- **Bounds** (reference values, not customer allowances): 4,096 entries, 2 MiB per file, 64 MiB per bundle. A project over a bound fails with `BUNDLE_TOO_LARGE` rather than a silently partial bundle. WH-187 sets production bounds against the existing per-account export allowance.

### Layout

| Path | Tier | Lifecycle class (WH-009/116) |
| --- | --- | --- |
| `manifest.json` | root of trust | — |
| `README.txt`, `RECONFIGURE.txt`, `report/unavailable.json` | report | `projects` |
| `specification/specification.json` | specification | `project-configurations` |
| `site/public/index.html`, `site/public/<path>/index.html`, `site/public/_headers`, `site/public/assets/<photo>.jpg` | static (or source when not runnable) | `site-versions`, `project-media` |
| `data/media/<photo>.jpg` | data | `project-media` (approved, not used by an exported page) |
| `data/directory.json` | data | `directories` |
| `data/access/<instance>/roles.json` | data | `project-roles` |
| `data/records/<instance>/<schema>.json` | data, visitor scope only | `module-records` |
| `data/files/<instance>/<collection>.json`, `data/files/<instance>/<collection>/<file>.jpg` | data, visitor scope only | `module-files` |
| `source/<program>/program.js`, `source/<program>/program.json` | source | `backend-artifacts` |
| `frontend/<id>/…` | source | `project-configurations` |

### Manifest

`manifest.json` is canonical JSON (object keys sorted, two-space indentation, trailing newline). Its top-level keys are closed:

| Key | Meaning |
| --- | --- |
| `format`, `formatVersion`, `filter` | `whumpo-portable-export`, `1`, `portable-filter@1`. Anything else is refused. |
| `project` | `{projectId, name}`. The logical project UUID is the customer's own identity ([WH-071](workload-placement.md#identity-and-physical-resolution)); owner IDs and physical locators are absent. |
| `snapshot` | `{cutoff, specificationVersionId, specificationDigest}`. The cutoff comes from the export review, never from the build clock. |
| `scope` | `{visitorData}`, the owner's explicit choice ([LC-09](data-lifecycle.md#established-decisions-and-open-decisions)). |
| `versions` | Exact compiler pin `{name, version, digest}`, specification schema, component IDs and digests, every module instance `{resourceId, localId, kind, module, schema, configRevision}`, and the closed data-set format list. |
| `claims.runnable` | `[]` or `["static-site"]`. No other claim exists in v1. |
| `frontends` | `{id, runnable: false, requires[]}` for each custom frontend. |
| `files` | Every other entry: `{path, sha256, bytes, tier, classId}`, sorted by path. |
| `exclusions` | `{category, count}` per [exclusion category](#exclusion-categories). |
| `unavailable` | The [report](#unavailable-feature-report), one entry per shared capability. |
| `reconfigure` | `{capability, setting, instruction}` for settings the customer must recreate. |

Data-set formats in v1 are exactly `whumpo-module-records@1`, `whumpo-portable-files@1`, `whumpo-access-roles@1`, `whumpo-directory@1` and `whumpo-backend-source@1`. `whumpo-portable-files` is the bundle projection of the WH-128 files serializer: bytes are stored as separate JPEG entries (re-hashed against the approved digest) instead of base64 inside JSON.

### Determinism and checksums

The same inputs (store state, project, scope, cutoff) give byte-identical bundles and the same SHA-256. The builder sorts every unordered collection itself, canonicalizes JSON and reads no clock or random source. Ordered content (specification arrays, record field lists, directory listings) keeps its defined order. One object shape is exempt from key sorting: `data/directory.json` is the WH-129 `whumpo-directory` v1 document with canonical wrapper keys, but each listing keeps the serializer's key order (`id`, `title`, `description`, `url`) and the applied snapshot's listing order, because the WH-129 import validator re-serializes the listings in that form and compares them with `snapshot.listingsSha256`, which stays the applied snapshot's own digest.

Integrity has three layers: each entry's CRC-32, each file's SHA-256 and byte count in the manifest, and the whole bundle's SHA-256 returned out of band in the download receipt. Checksums detect corruption and inconsistent edits. A consistent rewrite of both files and manifest passes local checks, so only the out-of-band digest detects it. **There is no signature** in v1 ([decision 5](#open-owner-decisions)).

### Reader rules

The reference `readBundle` is the only decoder. It refuses, with a typed code:

- digest different from the receipt (`ARCHIVE_DIGEST_MISMATCH`); bad CRC, encoding, offsets, flags or trailing bytes (`ARCHIVE_CORRUPT`); any non-canonical encoding, including another timestamp (`NONCANONICAL_ARCHIVE`);
- unsafe or duplicate paths (`UNSAFE_PATH`, `DUPLICATE_PATH`); a missing first `manifest.json` (`INVALID_MANIFEST`);
- another format, version or filter (`UNSUPPORTED_FORMAT`, `UNSUPPORTED_FORMAT_VERSION`), unknown keys (`UNKNOWN_FIELD`), a data set with another format version (`UNSUPPORTED_DATASET_FORMAT`);
- unlisted, missing or altered files (`UNLISTED_FILE`, `MISSING_FILE`, `CHECKSUM_MISMATCH`);
- an incomplete report (`REPORT_INCOMPLETE`), or any runnable claim not confirmed by its own re-scan or not allowed for that capability (`FALSE_RUNNABLE_CLAIM`);
- credential-shaped structural keys anywhere (`SECRET_FIELD`).

## Permission filter (`portable-filter@1`)

**Authority.** Only the verified current owner of the project can prepare or download a bundle, through the same exact-review pattern as the WH-018 account export: request ID, opaque server-random review digest, ten-minute expiry, recent passkey proof at download, single-use download and the per-account export allowance. Visitors, staff, deterministic jobs, Chat turns and the maintainer model cannot start an export or read a bundle. The download route rechecks ownership; possession of a URL is insufficient ([LC-04](data-lifecycle.md#established-decisions-and-open-decisions)).

**Included** (allowlist, per lifecycle class export policy): the saved specification; public pages whose saved HTML digest matches and whose every photo belongs to the project and is approved; other approved owner photos; the directory; staff role list (opaque visitor IDs, grant dates, state); reviewed and cleared custom source; custom frontend source; and, only with `visitorData`, retained module records and approved module files.

**Never included:** other tenants' data; platform secrets and bindings; passkeys, sessions, recovery material, invitation codes, provider tokens and ciphertext, verification codes and proof tokens; R2 keys, database IDs and other physical locators; internal review envelopes, hashes and receipts; safety cases, evidence and holds; held, pending, blocked or unapproved media and imports; uncleared source; records past their retention window; and the contact inbox (it keeps its own export path). The builder never reads credential tables. As defense in depth, any credential-shaped structural key in included JSON fails the build (`SECRET_FIELD`). Customer-defined record field values are customer data and are not reinterpreted.

**Cross-tenant references.** Every row and object is checked against the requested project at build time, not only by query scope. A page that references a photo stored for another project is not exported (`not-cleared`), and the foreign bytes are never read into the bundle.

### Exclusion categories

| Category | Meaning |
| --- | --- |
| `not-cleared` | One generic count for every item that is not exportable for clearance reasons: pending, blocked or unapproved media, a hold, uncleared source, a dependency that fails ownership or digest checks. |
| `staff-page-not-served` | Staff-audience pages left out of the static tier; their text stays in the specification. |
| `visitor-dataset-not-requested` | Visitor-subject data sets left out because the owner did not select visitor data. |
| `credentials-and-sessions` | Always present with count `null`: credentials are never read, so they are not counted. |
| `contact-inbox-separate-export` | The project has a contact inbox; its messages use the existing inbox export. |

**Hold non-disclosure.** Following the WH-018 security review, a hold adds nothing a bundle, review or count would otherwise not show. A preservation hold never changes the bundle. A screening-held photo, page or source version produces the same bytes as an item that is uncleared for any other reason (pending, unapproved, expired approval or unreviewed). The one item without an uncleared twin is a screening-held saved specification: no other state leaves `specification/specification.json` out, so its absence identifies the hold, but the owner is already told that exact version is held for safety review (the workspace refuses it with HTTP 423, `src/specification-safety.ts`), so the bundle discloses nothing new. Export never places, releases or bypasses a hold, and a hold placed after the review applies at download time under the same generic category. Restricted preservation (LC-06) remains its own operator process. Whether the generic count itself is acceptable is a counsel/safety-owner question ([decision 3](#open-owner-decisions)).

**Visitor data** (records, uploads) is a separate owner choice in the review, as in LC-09 and WH-018. A visitor's own self-export remains the visitor-authenticated path. Exporting visitor data for migration does not change the visitor's rights or the 30/90/365-day retention of the source.

## Secrets and reconfiguration

No password, key, token, passkey, session or verification value is ever in a bundle. `RECONFIGURE.txt` and `manifest.reconfigure` list, by name only, what the customer must create for the capabilities the project uses:

- **Response headers:** apply `site/public/_headers` on hosts without Cloudflare-style header files.
- **Bot protection:** create their own site key and secret; Whumpo's Turnstile secret is never exported.
- **Visitor passkeys:** WebAuthn credentials are bound to the original relying-party domain and cannot move. Visitors and staff enroll again at the new domain.
- **Email:** sending credentials and SPF/DKIM records with their own provider.
- **Provider authorization:** GitHub, Cloudflare and other connectors are reauthorized under the customer's own account. Whumpo tokens are revoked on Whumpo's side by the normal connection lifecycle, never handed over.
- **DNS:** the customer changes records at their DNS provider. Export never changes DNS.

Instructions must never ask the customer to paste a secret into Chat, a support message or a Whumpo form.

## Unavailable-feature report

`report/unavailable.json` and `manifest.unavailable` contain exactly one entry per shared capability, sorted: `access`, `automation`, `connectors`, `contact-inbox`, `content-collections`, `content-pages`, `custom-functions`, `domains`, `files`, `forms`, `maintainer-ai`, `notifications`, `records`. Each entry has `used`, `status` (`runnable`, `data-only`, `unavailable` or `not-used`), the logical resource IDs, customer actions, a cost flag (`none` or `customer-provider`: the destination's own pricing, unknown to Whumpo) and a migration link below. A missing entry, a used capability without actions, or a status outside the capability's allowed set is refused. `maintainer-ai` is always listed as unavailable: the exported subset never needs it.

## Capability migration paths

Official sources were retrieved on **October 9, 2026 UTC**. They are planning inputs, not verified Whumpo or customer account entitlement, a quote or an activation. Customer-side prices are the customer's own provider terms and **require verification** before relying on them.

| Option | Documented facts (retrieved October 9, 2026) | Whumpo use |
| --- | --- | --- |
| Customer's own Cloudflare account, [Workers static assets](https://developers.cloudflare.com/workers/static-assets/) with [`_headers`](https://developers.cloudflare.com/workers/static-assets/headers/) | Static assets uploaded with a Worker are cached and served by Cloudflare; `_headers` in the asset directory overrides response headers, up to 100 rules and 2,000 characters per line. [Pricing](https://developers.cloudflare.com/workers/platform/pricing/): static asset requests are free and unlimited; Workers Free has 100,000 requests/day and 10 ms CPU per invocation; Workers Paid is a $5/month account minimum with 10 million requests included. | Supported destination for the static tier. The existing `_headers` file fits these limits. Deploying it is the customer's action in their account; Whumpo neither deploys nor pays for it. |
| Any static host or the reference Node loader | The bundle's `site/public` is plain files. | Supported. The reference loader is a verification tool, not a production server. |
| [workerd](https://github.com/cloudflare/workerd) | Apache-2.0; can be used "as an application server, to self-host applications designed for Cloudflare Workers"; "not a hardened sandbox" (run possibly malicious code only inside e.g. a VM); tested on Linux/macOS (x86-64, arm64) and Windows x86-64. | Candidate runtime for a future published standalone adapter (WH-188). Not used for v1 claims. |
| [Wrangler](https://developers.cloudflare.com/workers/wrangler/) / [Miniflare](https://developers.cloudflare.com/workers/testing/miniflare/) | Miniflare is a simulator for developing and testing Workers. | Development and clean-room testing only; never described as production hosting. |
| [Node.js `node:sqlite`](https://nodejs.org/docs/latest-v24.x/api/sqlite.html) | Node 24 documents it as Stability 1.2, release candidate since v24.15.0. | Candidate store for a future records adapter; not stable enough to promise in v1. |
| [D1 import/export](https://developers.cloudflare.com/d1/best-practices/import-export-data/) | `wrangler d1 export` writes SQL; no virtual-table support; a running export blocks other requests; numbers have 52-bit JavaScript precision. | **Never** used on Whumpo's shared multi-tenant D1 for a customer. Relevant only to a future WH-072 per-project database adapter. Customers can import the JSON data sets into their own D1 or SQLite. |
| [R2 S3 API](https://developers.cloudflare.com/r2/api/s3/api/) | "R2 implements the S3 API to allow users and their applications to migrate with ease." | Customer-side destination option for exported files; Whumpo's private bucket stays private and is never exposed. |
| QuickJS (`quickjs-emscripten-core` 0.32.0, MIT, already a Whumpo dependency) | The engine family Whumpo's bounded runtime uses (from `package.json`; not re-retrieved). | Candidate for a standalone JSON-in/JSON-out runner of exported custom functions (WH-188 decision). |

### Static pages

**Runnable** when the tier check passes. Upload `site/public` anywhere, apply `_headers`, and point DNS yourself. The pages contain no scripts and no Whumpo calls; the existing CSP (`default-src 'none'`, `form-action 'none'`) keeps them self-contained. Hosted contact intake and other Whumpo-served tools are not included.

### Content collections

**Data only.** `data/directory.json` holds the published snapshot. A static rendering of the public directory is a WH-188 candidate because it is read-only.

### Records and forms

**Records data only, forms unavailable.** Retained records export as `whumpo-module-records` v1 (visitor scope). Record views, staff updates, retention timers and public intake (Turnstile, quotas, receipts) need the customer's own database, form handler and bot protection. Candidate adapter: SQLite or the customer's own D1 behind a published handler (WH-188/190), with no Whumpo source disclosed.

### Files and galleries

**Data only.** Approved JPEGs with SHA-256 per file. Read and upload policies must be rebuilt on the destination's storage. Published galleries are already static pages.

### Visitor access and staff roles

**Unavailable.** The staff list exports as data. Passkeys, sessions and recovery cannot move (passkeys are domain-bound), so visitors re-enroll on the destination.

### Notifications

**Unavailable.** Templates and rules stay in the specification. Delivery needs the customer's own email provider, sender domain and DNS. Align with the WH-068 notification contract when it merges.

### Connectors

**Unavailable.** Connector catalog entries and consent receipts are Whumpo's ([connector contract](connectors.md)). The customer reauthorizes providers directly; repositories, zones and other customer-owned resources stay where they are.

### Custom functions

**Data only.** Reviewed, cleared source plus `program.json` (engine `quickjs`, JSON I/O, digest). Whumpo's gateway, budgets and review gates do not travel with it.

### Contact inbox

**Unavailable.** Messages keep the existing inbox export and 30-day retention. Intake needs the customer's own handler and bot protection.

### Domains and DNS

**Unavailable.** Hostnames and DNS stay with the customer's registrar or DNS provider. Whumpo detaches only its own hosting under the normal domain lifecycle; export changes nothing.

### Automation rules

**Unavailable.** Rule configuration stays in the specification; execution needs the customer's own scheduler or workflow tool.

### Maintainer AI

**Unavailable by design.** The owner-maintenance model, its context and its funding are never exported, and nothing in the exported subset depends on it. Chat history belongs to the WH-018 account export.

## Format versions under the current-version-only policy

There is one current bundle format, one filter and one current version of each data-set format. A reader refuses every other version, older or newer; it never upgrades or downgrades a bundle. When the format must change, the change ships a new version with a reviewed cutover: new bundles use the new version, and old bundles are documented as readable only by their recorded format description, not by Whumpo tooling ([policy](current-version-policy.md)). Bundles are customer-held files, so this is a documentation obligation, not a legacy reader. Importing a bundle back into Whumpo is not part of v1. Any later import must re-admit data through the current schema, compiler and safety gates and must reject stale pins, as restore does ([WH-071](workload-placement.md#export-and-restoration-boundary), [WH-076](roadmap/backlog.md#wh-076--govern-maintained-module-versions-and-controlled-upgrades)).

## Relation to other contracts

- **WH-018 account export:** reuse its review, allowance and serializer composition. Do not build a second export engine. The account export stays an account-wide, human-readable archive that is not a restore input. The portable bundle is per project, machine-verifiable and tiered. WH-187 should factor one per-project section composer that both call.
- **WH-071 logical identities:** the bundle names logical project and resource IDs and exact pins, never physical locators. Portability classifications in descriptors (`not-verified`, `adapter-required`, `platform-only`) map onto report statuses. Only WH-189 evidence can reclassify a capability as runnable.
- **WH-072 physical databases:** optional future adapter. If adopted, it adds its own serializer and fresh clean-room acceptance before any claim. WH-077 and its children do not depend on it.
- **WH-067 serializers / WH-070 presentation / WH-068 notifications / WH-140 connectors:** consumed as data sources and as reasons a frontend is not runnable. WH-070's compiled compositions are exported as source with `requires` and never as runnable.
- **WH-076 module versions:** the bundle records exact pins. Version governance stays in WH-076.

## Builder and permission filter in source (WH-187) — October 9, 2026 UTC

**Status: implemented in source; disposable SQLite and local D1 tests only. Not deployed, not browser-tested, not live- or customer-accepted.** It adds no table, column, trigger, view, binding, provider, compiler identity or paid service. It reuses the WH-018 review and allowance tables, which are themselves new schema on the unmerged draft PR #170 (`src/account-lifecycle/schema.sql`), so this source can ship only with that owner-run empty-database cutover. Owner decisions 2, 3, 4, 5 and 7 [below](#open-owner-decisions) are still open; the source follows each recommended option provisionally and says so here.

**Route and authority.** `POST /api/account/v1/portable/prepare` (`{requestId, projectId, visitorData}`) and `portable/download` (`{reviewId, reviewDigest}`) run in the same account-lifecycle router as the account export (`src/account-lifecycle/http.ts`, `portable.ts`), with the ordinary passkey session and no Chat, agent, job or model path. They reuse the WH-018 machinery instead of a second engine (`review.ts`): an `export`-kind review in `account_lifecycle_reviews` (request ID, opaque server-random digest, ten-minute expiry, per-account capacity) whose content-free binding names `whumpo-portable-export`, the project and its specification, directory, backend publication, application and module-configuration revisions. A foreign or missing project is one generic `not_found`; a replay, wrong digest, changed binding or an account-export review is `stale_review`; a stale proof is `proof_required`; a reused request ID with another scope is `request_conflict`. Download consumes the review and one monthly download of the **shared** per-account allowance (decision 2, recommended option). Every private object read draws on the same 5,000 monthly photo reads before the platform-wide storage ceiling: each owner library photo and, with visitor data, each module file (an owner photo filed in a module collection is read, and charged, twice). Module file reads go through the WH-128 serializer's `reserveRead` option; the WH-018 account export's module file reads are charged the same way. An exhausted allowance is the generic `unavailable` refusal for either kind of read. Approval, screening-hold and preservation-hold state are never part of the binding, so a hold placed after the review neither makes it stale nor shows; it applies at download time.

**One section reader, shared with the account export.** `project-sections.ts` now holds the per-project reads both exports use: the saved specification head (with its WH-014 `project_spec_held` flag), the newest applied directory snapshot (`exportDirectory`), the approved owner photo library (approved-only, size-checked and re-hashed after the private read), the staff role list (`exportAccessRoles`) and the visitor records/files serializer pages (`exportRecords`, `exportFiles`). The `_headers` file comes from `src/static-site-headers.ts`, which the `whumpo-static-site` download (`src/exports.ts`) now also uses (decision 4: one static path, same code). Credential, session, recovery, provider-token, safety-case and contact-message tables are never read; contact inbox, domains, connectors and backend forms are reported from counts only.

**Pure composer and filter.** `portable-bundle.ts` has no database, storage, clock, randomness, network or model access. It re-checks every row against the requested project, verifies the specification against its stored digest and the page against its saved HTML digest, and writes the frozen layout with canonical JSON and the deterministic stored ZIP. Paths other than `README.txt` and `RECONFIGURE.txt` must be lowercase (`UNSAFE_PATH` otherwise), so with the exact-duplicate check no two entries can collide on a case-insensitive filesystem, including customer frontend file names such as `index.html` and `Index.html`. The current compiler saves one homepage per version, so the static tier is that page (`site/public/index.html`) plus its approved photos; a public page at any other path fails closed. What the filter treats as each item in this slice:

| Contract item | Source rows | Cleared when |
| --- | --- | --- |
| Specification, static page | Specification head and the same saved version's page and `version_photos` | The version is not WH-014 held; digests match; every photo is this project's photo in the approved set. A held version is one `not-cleared` item. |
| Owner photos (`data/media`) | Approved owner library | Exact-digest approval is current (`approved_project_photos`). Pending, blocked and no-longer-current approvals are one withheld count. |
| Directory, staff roles | WH-129 / WH-126 serializers | Owner data; always included when present. The directory is the newest applied snapshot, the same one the account export uses, which can be newer than the published snapshot. Its listings must be exactly `{id, title, description, url}` strings whose serialization matches `snapshot.listingsSha256` (otherwise the build fails closed), and they are written in that form so `validateDirectoryExport` accepts `data/directory.json` unchanged. |
| Records, files (visitor scope) | WH-127 / WH-128 serializers, only with `visitorData` | Records inside their retention window at the review cutoff; files with a current approval. |
| Custom source (`source/backend`, `source/application`) | Published backend version, activated visitor-application version | An applied owner publication (or activation) review for that exact version, and the version is not WH-014 held. A saved but never reviewed program is uncleared. |
| Frontends | None stored: WH-070 has no served composition, and compiled service-client pages are not exported in this slice | Never runnable; the composer gives any frontend a non-empty `requires` list. |

**Holds.** A WH-014 screening hold (specification, page or source digest) and a non-current photo approval are excluded under the single `not-cleared` count. For photos and source the bundle is byte-identical to the pending or unreviewed case (tested). A held saved specification has no unheld twin (every other saved head is exported), so its missing `specification/` and `site/` entries identify it; that hold is already visible to the owner, whose workspace refuses the version as held for safety review (HTTP 423), so the bundle adds no disclosure. A restricted WH-015/132 **preservation hold** never changes what an owner can export: it only retains data, and [content safety](content-safety.md) requires that a hold is never visible to the customer. Excluding preservation-held items would make the hold detectable by comparing the bundle with the workspace or with the WH-018 account export, which includes them, so preservation holds leave the bundle byte-identical (tested; a reader mutant that withholds held photos is caught). Retained-past-window rows stay outside the read window, like any expired row. Whether even the generic count is acceptable remains decision 3.

**Bounds, determinism and receipt.** Production bounds: 4,096 entries, 2 MiB per file, **32 MiB per bundle** (half the reference value, because the manifest is the first entry so the Worker builds the bundle in memory), one records serializer page (200 records) per schema and 64 files pages (512 files) per collection. Over a bound the request fails with `bundle_too_large` (HTTP 413) and nothing partial. The archive bound is enforced in three places so a doomed export costs nothing it can avoid: (1) prepare sums the stored sizes of every approved owner library photo and, with visitor data, every approved module file of a configured collection (a lower bound of the bundle) and refuses before a review exists; (2) download repeats that check before the review or any allowance is consumed, because photos approved after the review do not make it stale; (3) while reading, a running budget over stored sizes stops before the first object that would cross the bound, before it is reserved, charged or read. Files pages are decoded one at a time, so each module file is held once rather than as base64 plus bytes. Bounds found only while reading (more than one records page, more than 64 files pages, a size that grew after the check) still fail after the single-use review is consumed, like an interrupted account export. The cutoff is the review's creation time, never the build clock. The response carries `x-whumpo-bundle-sha256`, the out-of-band receipt digest (no signature, decision 5), and nothing is staged (decision 7). Serializer digests (`recordsSha256`, `rolesSha256`) are recomputed over the stored canonical form, so the WH-126/127 import validators accept the bundle's data sets. The directory's `listingsSha256` is instead verified and kept, with its listings stored in serializer key order ([determinism](#determinism-and-checksums)), so the WH-129 validator accepts `data/directory.json`.

**Not done in this slice:** an owner page or button (the client has `preparePortableExport`/`downloadPortableExport` only), WH-188 standalone runtime, WH-189 OS-isolated clean room, WH-190 adapter documentation, WH-191 live acceptance, multi-page bundles of large record sets, compiled service-client pages, and every open owner decision.

**Verification (October 9, 2026 UTC, Node 24.21.0).** `node tests/portable-export.mjs` (`pnpm test:portable-export`) passed 11 groups on disposable SQLite and with `--d1` on local D1: the actual routes and section reader over the complete current schema with two owners; every bundle re-read by the frozen reference `readBundle` against the receipt digest, served by its static loader and booted in a `--permission` child process; exact compiler, component and module pins; the WH-126/127 validators accepting the data sets; held (non-current approval), pending, blocked and preservation-held photos; held, staff-audience and script-bearing pages (never runnable, forged claims refused by the reader); an expired record; screening-held and unreviewed source (byte-identical); credential, DNS-proof, contact-message and hold fixtures absent; replay, wrong digest, stale binding, stale proof, foreign owner, request conflict and cross-format refusals; the shared allowance; route bytes equal to the composer over the same rows; the 413 bound; and an empty inference import graph for the route, reader and composer. A mutation check then rebuilds the composer 19 times and the section reader 4 times with one deliberate filter defect each; every mutant is caught by its named check (`PORTABLE_EXPLAIN=1` prints the mapping). `node tests/account-lifecycle.mjs`, `node tests/account-lifecycle-client.mjs` (both also `--d1`), `node tests/exports.mjs` and `node tests/portable-export-contract.mjs` still pass. This proves source behavior in disposable stores only.

**Review fixes (October 9, 2026 UTC, source and disposable local tests only).** An independent review of the first slice found, and each was reproduced before fixing: every bundle with a directory failed `validateDirectoryExport` (fixed as described under [determinism](#determinism-and-checksums)); a project within upload quota (20 approved 1 MiB owner photos filed in the owner collection, with visitor data: 40 MiB of entries) consumed the review, read and charged all 40 objects and only then returned 413 (fixed by the three-place size bound above; now prepare refuses, and a review prepared earlier stays unconsumed with nothing read or charged); module file reads charged only the platform ceiling (now the per-account photo reads too); capital letters in customer frontend paths could collide on case-insensitive filesystems (now refused); and the hold non-disclosure text overstated the held-specification case (now precise). `node tests/portable-export.mjs` now passes 13 groups on SQLite and `--d1`, with 12 composer checks, 23/23 composer mutants and 9/9 section-reader mutants (directory key order, directory digest and listing shape, capital paths; size floor at prepare and before consumption, visitor files in the floor, running budget, module file charge), each caught by its named check.

## Clean-environment verification plan

1. **Reference (this slice, offline):** a fresh Node process started with `--permission`, read access to only the bundle directory and the loader, no write or child-process permission, an empty environment, outbound network calls disabled in-process (`fetch`, sockets, TLS, HTTP clients, DNS), and a self-test proving each guard fires. It verifies the bundle against the receipt digest, serves only the static claim on loopback, and the harness compares every served byte with the manifest. Tampered and non-runnable bundles are refused.
2. **WH-189 clean room:** the same boot inside OS-level isolation (a container or VM with no network interface or a deny-all egress policy, fresh filesystem, no Whumpo credentials or model endpoint), plus an import of every data set and a comparison of restored data, assets, module versions and exclusions with the source project. The in-process network guard above is **not** OS-level isolation. On this development host, `unshare` network namespaces are not permitted (checked October 9, 2026), which is why OS isolation is a separate slice.
3. **WH-191 live acceptance:** a synthetic project on the deployed `test` environment, exported by its owner through the real route, verified in the WH-189 clean room. Customer acceptance is separate.

## Customer actions and costs

Everything the customer must do is explicit: choose and pay for a destination host, upload files, apply headers, point DNS, recreate secrets with their own providers, reauthorize connectors, ask visitors to re-enroll, and import data into their own tools. Whumpo spends nothing at the destination. On Whumpo's side, a bundle costs Worker CPU and R2 Class B reads per exported object, bounded by the existing per-account export allowance (10 downloads/month and 5,000 photo reads/month in the WH-018 branch). Whether bundles share that allowance is [decision 2](#open-owner-decisions). No paid service, plan or provider is enabled by this contract.

## Open owner decisions

1. **First runnable subset beyond static pages.** Recommended: static pages only for v1, then a static directory projection. Alternatives: add a QuickJS runner for stateless custom functions, or a records adapter (higher support cost). *I'll specify* is available.
2. **Export allowance.** Recommended: portable bundles share the WH-018 per-account allowance. Alternative: a separate, smaller allowance.
3. **Visitor data and hold disclosure.** Recommended: the same LC-09 separate visitor-data choice as the account export, generic `not-cleared` counts, and counsel/safety-owner review of whether even the generic count is acceptable.
4. **One static path.** Recommended: keep `whumpo-static-site` v1 as the quick tier-1 download, built from the same code as the bundle's `site/public`. Alternative: retire it in a reviewed cutover so only the bundle remains.
5. **Signatures.** Recommended: none in v1 (checksums plus out-of-band receipt digest). Alternative: an Ed25519 platform signature with key custody and rotation work.
6. **License of a future standalone adapter** (for example MIT or Apache-2.0), published separately from platform source.
7. **Prepared-bundle retention.** Recommended: LC-04's proposed 24-hour expiry for any staged bundle; stream without staging where possible.

## Delivery slices

WH-077 stays the parent with its acceptance unchanged and depends on every child. No child depends on WH-049, WH-072 or WH-104. The contract (WH-186) also does not depend on WH-018 or WH-067, which it supports.

| ID | Slice | Depends on |
| --- | --- | --- |
| WH-186 | This contract, offline reference, conformance harness and decomposition | WH-009, WH-071, WH-116, WH-123 |
| WH-187 | Bundle builder and permission filter in source: owner review route reusing WH-018's review/allowance, per-project section composer over the WH-126–129 serializers, deterministic ZIP and receipt digest | WH-186, WH-018, WH-126, WH-127, WH-128, WH-129 |
| WH-188 | Standalone runtime for the claimed subset: published static loader and any owner-selected addition (decision 1) | WH-187 |
| WH-189 | Clean-room verification: OS-isolated boot/import, data/asset/version comparison and documented exclusions | WH-188 |
| WH-190 | Managed-service adapter and migration documentation per shared capability, with dated provider facts and customer cost/action steps | WH-186, WH-140 |
| WH-191 | Live and customer acceptance on the deployed `test` environment | WH-189, WH-190 |

## Verification

`node tests/portable-export-contract.mjs` (`pnpm test:portable-export-contract`) runs offline with synthetic data: deterministic bytes and hashes (including reordered inputs and fixed ZIP timestamps); other-tenant, platform-secret, credential, private, unapproved, held, expired and staff-page exclusion; hold non-disclosure; separate visitor-data approval; tier labelling and forged runnable claims; report completeness and documented migration anchors; version, format and data-set refusals with no legacy decoder; tamper detection; an in-process static loader; restored data/asset/version comparison; and the clean-environment boot in a permission-restricted child process. Each of 28 deliberate mutants of the reference must be caught by its named check. It is not in `pnpm verify fast` because it measured above that profile's 2-second budget on the development host ([verification](verification.md#wh-077-portable-export-contract--october-8-2026-utc)). It proves the frozen contract and the reference, not the WH-187 builder over D1/R2 (see `tests/portable-export.mjs` [above](#builder-and-permission-filter-in-source-wh-187--october-9-2026-utc)), OS-level isolation or any live behavior.

**Result at this slice (October 9, 2026 UTC, Node 24.21.0):** 12 reference checks, 2 clean-environment boot checks and 1 static check passed; 28 of 28 mutants were caught, each by its intended check (`--explain` prints the mapping).
