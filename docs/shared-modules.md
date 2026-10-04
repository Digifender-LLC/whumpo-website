# Shared content, forms, records, files and access modules

**WH-067 contract slice (WH-123), October 4, 2026 UTC; source baseline `1343111`.** This freezes module identity, instance/configuration/version shapes, current-only migration hooks, API boundaries and the authorization model for the [WH-067](roadmap/backlog.md#wh-067--expose-shared-content-forms-records-files-and-access-modules) shared modules, and splits delivery into WH-124–130. It is a **planned contract**: no table, route, catalog entry, client, binding, provider or deployment is added. The [offline reference](../tools/prototypes/shared-modules.mjs) and [synthetic checks](../tests/shared-modules-contract.mjs) exercise the frozen shapes and policy table only; no Worker imports them. **Update (WH-124):** specification schema 3, the trusted module catalog and planned lifecycle classes are now [implemented in source](#specification-schema-3-delivery-wh-124--october-4-2026-utc); **Update (WH-125):** the instance registry, exact owner activation/disable reviews, scoped resolver, policy engine and request envelope are [implemented in source](#instance-registry-activation-reviews-and-policy-engine-wh-125--october-4-2026-utc) as a current-schema change that is **not deployed** (it needs the owner-run empty-database cutover); kind data handlers, visitor-origin routes and serving remain WH-126–130.

It consumes, and does not replace: [WH-064/066 specification and compiler](project-specification.md), [WH-065 capability catalog](capability-planner.md), [WH-071 logical resources and descriptors](workload-placement.md), [WH-116 data classes](data-protection.md) in the [lifecycle catalogue](data-lifecycle.json), [WH-122/090 feature inclusion and admission](feature-admission.md), the [WH-105 Chat interaction and binding contract](chat-interactions.md), the [WH-052 job envelope](job-envelope.md), [content-safety states](safety-coverage.md) and the [current-version policy](current-version-policy.md).

## Decision

Expose four maintained module kinds — **content collections, records (including forms and record views), files (including galleries) and access (project visitor/staff users and roles)** — as narrow, typed, tenant-scoped APIs over the current shared D1, private R2 `FILES` and the existing visitor Worker. Existing contact, directory, photo and visitor-data services become instances or adapters of these modules ([mapping](#existing-services-and-the-module-each-becomes)); WH-067 adds no second authentication system, storage engine or generic CRUD/SQL layer. Notifications and rules stay in WH-068/069; presentation stays in WH-070.

- Module organization is independent of deployment count. All four kinds can run inside the current platform (`whumpo-platform`) and visitor (`whumpo-apps`) Workers. A module is a contract plus maintained handler code, never a per-project script or database.
- Every module operation is deterministic. No module handler imports or invokes owner-maintenance inference, its context, credentials or funding. Standard actions must pass with maintenance inference unavailable.
- Configuration is not activation. The approved specification describes desired configuration; a separate exact owner activation review makes a module instance serve visitors, as with [service clients](project-service-clients.md).

## Module identity and pins

| Kind (WH-071 `kind`) | Module pin name | Storage schema pin name | Surfaces |
| --- | --- | --- | --- |
| `content` | `module-collections` | `collections-data` | Owner-curated collections with private draft and reviewed public snapshot. v1 type: `directory-listing@1` only. Site copy remains the delivered `content@2` compiler module, unchanged. |
| `records` | `module-records` | `records-data` | Record schemas, form submission (validation + intake), record views, staff field updates, owner removal. |
| `files` | `module-files` | `files-data` | Scoped collections: upload intent/bytes, approved reads, galleries, reviewed removal. |
| `access` | `module-access` | `access-data` | Project visitor principals, invitation enrollment, the `staff` role, owner role reviews. |

All v1 pins are `{name, version: 1, digest}` with SHA-256 digests resolved only from the trusted server catalog. The **module pin** identifies the maintained handler/validator artifact; the **schema pin** identifies the current platform storage layout for that kind. A customer's record fields are configuration (below), not a storage schema pin. `latest`, ranges, URLs, unknown names or a digest mismatch fail catalog admission (`stale_module_version` / unavailable), never fall back to another version.

## Instance, configuration and version

An installed module is one WH-071 logical resource `{projectId, resourceId}`. Its closed **instance envelope v1** is:

```json
{
  "contractVersion": 1,
  "descriptor": "<WH-071 descriptor v1: ref, kind, module, schema, ownership, dependencies, lifecycle>",
  "config": "<closed kind-specific configuration below>",
  "configRevision": 3,
  "source": {"specificationVersionId": "UUID", "specificationDigest": "SHA-256"}
}
```

- `descriptor` is exactly the [WH-071 descriptor](workload-placement.md#minimum-descriptor-fields); physical locators, owner IDs and secrets stay server-only. Records/files instances that use visitor or staff audiences must declare a same-project dependency on an `access` instance; that is the only route to visitor/staff principals.
- `configRevision` is a positive monotonic integer per instance. It advances when an approved specification changes this instance's configuration, a module/schema pin changes, or an activation changes its effective configuration. Every API request carries it; a mismatch returns `409 stale_configuration`.
- `source` binds the configuration to the exact immutable specification version it was compiled from. Configuration is never edited in place outside a specification proposal/apply.
- Activation state (`inactive | active | suspended | migrating`) and the activation review receipt are stored separately and bind the instance digest. Only `active` instances serve visitor/staff/public operations; owner reads, export, disable and role revocation remain available in every state.

Kind configurations (all objects closed; unknown keys reject):

| Kind | Frozen v1 configuration |
| --- | --- |
| `records` | `retentionDays: 30|90|365` (added by WH-124; see [retention](#records-retention-and-visitor-values--wh-124)); `schemas[1..4]: {id, fieldsRevision, fields[1..8]: {key, label, type: text|number|boolean|choice, optional, read: owner|staff|submitter}, staffWrite[]}`; `forms[0..4]: {id, recordId, submit: public|visitor|staff, uploadCollectionId|null}`; `views[0..8]: {id, recordId, audience: staff|visitor, scope: all|own, fields[], limit ≤ 50}`. Field shapes and bounds reuse [`backend-form-shape.ts`](../src/backend-form-shape.ts). |
| `files` | `collections[1..4]: {id, read: owner|staff|submitter, upload[]: owner|staff|visitor, maxBytes ≤ 1 MiB, mediaTypes: ["image/jpeg"], gallery: null | {audience: staff|visitor}}` |
| `access` | `{roles: [] | ["staff"], enrollment: "invitation"}` |
| `content` | `collections[1]: {id, type: "directory-listing@1"}` |

Audience lattice for reads: `owner ⊇ staff ⊇ submitter`. `read: owner` is owner-only; `staff` adds current staff; `submitter` additionally lets a visitor read **their own** submitted record or upload. Views and galleries can never project more than their audience may read: a staff view excludes `owner` fields; a visitor view must be `scope: own` and include only `submitter` fields. `staffWrite` names fields staff may change and must be staff-readable. Owner authority is implicit for reads and management but **upload is explicit**: an owner uploads to a collection only if `owner` is listed, so a staff-only intake cannot be confused with the owner's media library.

Deliberate narrowing from specification v2: PNG and >1 MiB are removed because no current server path accepts them ([photos](photos.md#upload-contract)); `upload` gains `owner`/`staff`; `forms.submit` gains `staff`; views, field `read`, `staffWrite` and collection galleries are added; `public` read audiences are absent (public exposure happens only through exact publication reviews).

## Versions and migration hooks under the current-version-only rule

There is one current module version, one current storage schema and one current configuration per instance. No legacy reader, dual-write, mixed-version serving, downgrade renderer or compatibility list exists ([policy](current-version-policy.md); WH-071 [amendment](workload-placement.md#current-only-contract-amendment--october-1-2026)).

| Change | Hook class | Behavior |
| --- | --- | --- |
| Labels, view/gallery projection, policy narrowing, removing a view | `none` | New `configRevision`; no stored-data rewrite. Narrowing applies at the next decision. Widening a read/upload/staff audience requires the specification `permissions` review. |
| Add an optional field (`records.addField`) | `additive-optional` | `fieldsRevision` + `configRevision` advance; existing records report the field as absent, never a backfilled default. |
| Required field, removal, rename, type change, new storage schema or module version | `migration-required` | Refused with `MIGRATION_REQUIRED` until a reviewed migrate hook for that exact source→target pin pair exists (WH-076). In disposable test environments the owner-authorized alternative is an explicit fixture/data reset. |

A reviewed migration fences writes (instance `migrating`, writes return `409 unavailable`), applies the pinned hook to current data in bounded transactions, verifies counts/digests, then compare-and-swaps module/schema pins and `configRevision` together. Old-pin requests and cursors fail with `stale_configuration` or `stale_module_version`; clients reload. Repair is forward. Restore re-admits through the **current** schema/hooks and reapplies deletion suppression, revocations and safety holds ([restore boundary](workload-placement.md#export-and-restoration-boundary)).

## API boundaries

### Request envelope

Every module call — from the platform-authored visitor client, a WH-070 composed frontend or a direct HTTP request — carries `api: "whumpo-modules"`, `version: 1`, `operation`, `resourceId`, `configRevision`, `requestId` (UUID for writes, `null` for reads), `target` and `input`. Missing or other versions return `400 client_update_required`; there is no fallback interpretation. Callers can never supply `projectId`, owner/user/visitor IDs, roles, `approved` flags, storage paths/prefixes, bucket names or SQL; those keys are rejected, and scope is derived from the host, route and session.

Writes are idempotent on `(project, resource, requestId)` with an immutable request hash: same ID + same input reads the original receipt after rechecking current permission; changed input returns `409 request_conflict`. Errors use the WH-071 typed set (`unavailable`, `forbidden`, `stale`, `incompatible`, `limited`, `unresolved`) plus generic `404` for foreign or missing resources, and never echo submitted values. An unknown storage outcome is `unresolved` and invites readback, never a resend.

### Operations

| Module | Operations (closed set) | Boundary notes |
| --- | --- | --- |
| Records / forms | `forms.submit`, `records.view` (opaque cursor bound to project, audience, `configRevision`, access revision), `records.get`, `records.update` (staff/owner fields), `records.remove` (owner) | Server validation reuses the existing bounded field validator. Public submissions keep the [contact admission](contact-forms.md#submission-boundary): exact Origin, streaming body bound, rate limiter, Turnstile Siteverify, atomic hourly/project/platform caps. No visitor-chosen recipient, project, query or follow-up action. |
| Files / galleries | `files.prepareUpload` (name, media type, byte length, SHA-256), `files.putBytes`, `files.read`, `files.gallery`, `files.requestRemoval` (owner exact review) | Worker-proxied bounded upload with server JPEG cleaning, create-only R2 write and D1 reservation, as in [photos](photos.md#ownership-and-storage). Stored ≠ cleared: reads and galleries return only bytes with a current exact-digest approval. Object keys stay server-only. |
| Access | `access.me` (visitor), owner `access.list`, `access.prepareRole` / `access.confirmRole` (grant or revoke staff by exact review) | Enrollment reuses project visitor passkeys/invitations/recovery ([app data](app-data.md)). |
| Content collections | `collections.readPublic`; owner draft/edit/publish/restore remain the existing [directory reviews](directories.md) | Public reads serve only the approved snapshot. |

**Hosts.** Visitor, staff and anonymous operations are served only on the project's visitor origin (`https://app-PROJECT.whumpo.site`) by the visitor Worker, same-origin, with `SameSite=Strict` project session cookies and no credentialed CORS. Owner operations are served on the workspace origin by the platform Worker using the admitted workspace scope. The public contact form and public directory/JSON keep their current hosts until their slices move them behind the same handlers. A third-party-origin frontend is not supported in v1; "custom frontend" means a WH-070 composition served from the visitor origin, and any direct request is treated as untrusted and gets identical checks.

## Authorization model

Principals are derived on the receiving side, never from request JSON:

| Principal | Source | May do |
| --- | --- | --- |
| `owner` | Current `admitWorkspace` scope (WH-113) + `projects.owner_user_id` | Configure via specification proposals, activation/role/removal reviews, read all records/files, export. Never acts through a visitor session. |
| `visitor` | Project visitor session on the visitor origin, current `app_visitors` row not revoked | Operations whose audience is `visitor`/`submitter`, limited to own records/uploads. |
| `staff` | A `visitor` holding an unrevoked `staff` role at the current access revision | Staff views, `staffWrite` fields, staff galleries/uploads per collection policy. |
| `public` | Anonymous request on a published, active instance | `public` form submission and approved public collection snapshots only. |
| `job` | WH-052 envelope, purpose `deterministic-rule` | Nothing in WH-067; WH-069 registers its operations through its own admission. |

Rules:

1. **Inside every API.** Each handler resolves `resolveResource(context, ref, expectedPin)` ([WH-071](workload-placement.md#scoped-adapters-and-operations)) and evaluates the policy table; the same predicate (project, instance active state, `configRevision`, principal, role/access revision, record/file ownership, field set) is repeated **inside the committing SQL statement**, like the existing contact and app-data guards. A presentation flag or client view definition never grants access.
2. **Roles are project application policy, not workspace membership.** Staff is a role on a project visitor identity. It is distinct from [WH-054](roadmap/backlog.md#wh-054--add-workspace-collaboration-with-explicit-roles-and-approvals) workspace membership: a staff member gets no workspace session, owner Chat, maintainer, billing, publication, spending or identity management, and a WH-054 member gets no visitor/staff authority. A workspace cookie never authenticates on the visitor origin, and a visitor cookie never authenticates on the workspace origin.
3. **Staff upload is a collection role policy.** `upload: ["staff"]` admits only current staff principals. File names, object prefixes, URLs and bucket placement are never consulted for authorization; R2 stays private with no public bucket or bearer URL.
4. **Revocation is immediate at the next decision.** Revoking staff or a visitor, disabling an instance or narrowing a policy advances the relevant revision; cursors, cached reads and pending writes bound to the old revision fail. Replays recheck current permission before revealing an old receipt.
5. **Owner admission ([WH-122](feature-admission.md)).** Owner configuration, activation and role reviews consume feature inclusion with the shared identity predicate: `core.forms` for records/forms, `core.editing` for files/access/collections, with operations `read`, `prepare` and `confirm`. Owner reads of collected data, export, disable, revoke and removal remain reachable without a paid-feature grant (protected history/recovery). Visitor/staff/public serving checks the instance's activation and publication state, **not** the owner's subscription; plan loss blocks new activations or widening but does not silently stop published serving.
6. **Owner Chat bindings ([WH-105](chat-interactions.md#templates-bindings-and-concrete-mappings)).** The first module slice registers its own binding IDs instead of reusing `core.editing` intake: `module.instances@1` (status table), `records.summary@1` (counts/states per view, no visitor field values), `access.roles@1` (staff list with opaque IDs and dates), plus server-generated review controls `moduleActivationApply` and `accessRoleApply`. Visitor/staff-submitted values never become model input or Chat history; owners read them in the dedicated panel, as with the contact inbox.

### Safety, publication and preservation

Module APIs cannot bypass existing gates:

- **Media quarantine.** Every module upload creates a pending safety receipt atomically with storage readiness, exactly like `project_files` today ([photo gate](photos.md#mandatory-project-photo-safety-gate--september-30-2026)). Reads, galleries, references and publication require the `approved_project_photos`-style exact-digest approval and re-hash bytes on delivery. Scanner integration remains owner-deferred; uploads therefore stay held in test.
- **Exact publication reviews.** Nothing becomes public through a module operation. Public galleries are website photo references published through the existing exact review; public collections use the directory publication review; public form links require activation against the current publication revision. Visitor/staff have no publish operation.
- **Restricted preservation.** Removal and deletion go through each module's lifecycle hook, which must consult held/blocked safety state and, once LC-06 exists, restricted preservation before ordinary deletion ([lifecycle](data-lifecycle.md)). A module delete never cascades away held evidence or applies to another tenant's data.
- Text submissions remain a recorded safety gap (S12/S13 in [safety coverage](safety-coverage.md#mounted-path-inventory)); records slices must not display visitor text to the model or claim it is screened.

## Registration with existing foundations

| Foundation | WH-067 registration |
| --- | --- |
| WH-125 registry and policy engine | **Implemented in source, not deployed** ([delivery](#instance-registry-activation-reviews-and-policy-engine-wh-125--october-4-2026-utc)). Registry, activation state, reviews and request receipts are current schema input `src/shared-modules/schema.sql` with lifecycle class `module-registry`; `module.instances@1`, `moduleActivationReview` and `moduleActivationApply` are registered under WH-105. |
| WH-066 specification/compiler | **Implemented in source by WH-124** ([delivery](#specification-schema-3-delivery-wh-124--october-4-2026-utc)). Specification **schema 3** replaces schema 2's library-only `records/forms/files/access` sections with the frozen configurations above and exact module pins; a new compiler identity is pinned with `tools/check-specification-compiler.mjs`, schema-2 test specs are reset, and no schema-2 reader remains. The mounted homepage adapter and `content@2`/page components are unchanged. |
| WH-065 capability catalog | `schema.optional-field`, `access.staff-files` and the new records/forms/collections entries move from `planned` to `available` only in the slice that implements them. Unimplemented module configuration returns `unsupported`; it never triggers generated source. |
| Trusted module catalog | **Implemented in source by WH-124.** Module/schema pins sit beside `compilerCatalog`/`serviceClientCatalog` with `available | withdrawn` state; withdrawal blocks new activation and makes existing instances `unavailable` with owner disable/export intact. |
| WH-071 descriptors | Each slice ships its descriptor, lifecycle hooks (`export`, `delete`, `restore`, `migrate`), export serializer and import validation with its schema. Visitor-subject data sets use `separate-approval` export. |
| WH-116 / lifecycle catalogue | **Registered by WH-124.** Planned classes registered before tables: `module-records` (visitor-subject submissions/records), `module-files` (module uploads, extending `project-media` handling) and `project-roles` (role grants and reviews), each with readers, processing, retention and export policy. General records do **not** inherit the 30-day contact window silently. |
| WH-052 / WH-069 | Records expose `form.accepted` events and record/action adapters through the job envelope; rule execution and notifications are not part of WH-067. |

## Existing services and the module each becomes

| Existing service (current source) | Becomes | Kept as-is | Gaps to close in its slice |
| --- | --- | --- | --- |
| Contact form and inbox ([contacts.ts](../src/contacts.ts), [contact page](../src/contact-page.ts), [doc](contact-forms.md)) | A `records` instance with a fixed platform schema (name/email/message, all `owner` read) and one `public` form; its storage adapter wraps the current `contact_*` tables and lifecycle class `contacts`. | Turnstile, Origin/body bounds, atomic caps, 30-day expiry, receipts, owner-only inbox, publication-revision binding, service-client activation. | Fields stay fixed (no field additions to the contact schema); module envelope/`configRevision`; owner reads through the shared records handler; descriptor/export serializer; no staff view until the owner opts into a general records instance. |
| Directory ([directory.ts](../src/directory.ts), [doc](directories.md)) | A `content` instance, `directory-listing@1` collection; its adapter wraps `directories`/`directory_reviews`/`directory_exports`. | Private draft, exact change/publication/restore reviews, public HTML/JSON snapshot, history export. | One collection per project; no staff editing; module envelope for public reads; descriptor/export hook; custom-domain directory paths remain unimplemented. |
| Project photos ([files.ts](../src/files.ts), [photo-safety.ts](../src/photo-safety.ts), [doc](photos.md)) | A `files` instance with an owner-upload, owner-read collection; galleries are views over approved files. Website photo pages keep their existing publication references. | JPEG cleaning, 1 MiB bound, create-only R2, D1 reservations/quotas, safety receipt/approval view, byte re-hash, reviewed removal, cleanup queue, Chat upload handoff. | `project_files` gains instance/collection and uploader-principal identity by current-schema cutover; visitor/staff upload paths on the visitor origin; per-collection read/gallery policy; descriptor/export hook. |
| Visitor identity and data ([app-gateway.ts](../src/app-gateway.ts), [app-data.ts](../src/app-data.ts), [app-auth.ts](../src/app-auth.ts), [app-access.ts](../src/app-access.ts), [doc](app-data.md)) | Identity becomes the `access` instance's visitor principal; the per-visitor document stays an execution resource (`custom-function` kind) that depends on that access instance, with its document as a visitor-subject data set. | Passkeys, invitations, recovery, sessions, per-visitor document, QuickJS transitions, replay/receipts, erasure and export. | Visitor identity is currently tied to an activated application space (`app_visitors.project_id → app_spaces`), so staff cannot exist without a program; there are no roles, shared records or staff APIs. WH-126 moves identity ownership to the access instance by current-schema cutover. |
| Stateless backend forms ([backend-form-shape.ts](../src/backend-form-shape.ts)) | Not a module; its field shapes are reused by records validation. | Separate stateless-function contract and service client. | None in WH-067. |

## Proven libraries and managed services — checked October 4, 2026 UTC

| Option | What it does | Whumpo fit / decision |
| --- | --- | --- |
| Existing [SimpleWebAuthn](https://simplewebauthn.dev/) server/browser packages (already dependencies, `^14`) | Passkey registration/authentication verification. | **Keep.** Already proven in visitor and workspace identity; no new identity engine. |
| [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/applications/) | Identity-aware proxy that checks each request against Access policies using identity-provider signals before the request reaches an application. | **Not for customer visitors/staff.** It is administered in Whumpo's Zero Trust organization, would put customers' end users under Whumpo's account policies and per-seat terms (plan/pricing **requires verification**), and cannot express per-record/field policy. Not configured. |
| Hosted customer-identity services (e.g. Auth0, Clerk) | External user directories and sessions. | **Not adopted.** New data processor, credentials and per-active-user pricing (**requires verification**) without removing the need for in-API record/file policy. |
| [R2 presigned URLs](https://developers.cloudflare.com/r2/api/s3/presigned-urls/) | Signed URLs that let anyone holding them perform one operation on one object until expiry (1 second–7 days); documented as bearer tokens. | **Not used for v1.** Bearer reads contradict "URL possession is insufficient"; direct uploads would bypass server JPEG cleaning before storage. Revisit only for larger uploads into a separate quarantine area with server verification. |
| [Turnstile](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/) | Server-validated bot challenge. | **Keep** for public form submissions, as contact intake already does. |
| [D1](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) / [R2](https://developers.cloudflare.com/r2/pricing/) | Current shared storage with batch transactions; private object storage. | **Keep** per WH-071; per-project databases remain WH-072 ([data isolation patterns](https://developers.cloudflare.com/use-cases/saas/data-isolation/)). |
| Schema/validation libraries | Generic validators. | **Not added.** Existing closed validators cover the bounded shapes (AGENTS: avoid routine dependencies). |
| Payments / booking engines | — | **Out of scope.** An appointment-request form is not a scheduling engine; Stripe remains its own gated workstream. |

The Cloudflare Access and R2 presigned URL descriptions were retrieved October 4, 2026; other links are earlier dated citations reused from their feature contracts. No service, plan or entitlement is enabled by this document.

## Delivery slices

WH-067 stays the parent with its acceptance unchanged; it closes only when every child below is accepted. Task scopes live in [backlog.json](roadmap/backlog.json).

| ID | Slice | Depends on |
| --- | --- | --- |
| WH-123 | Freeze this contract, offline reference and decomposition | WH-065, 066, 071, 105, 116, 122 |
| WH-124 | Specification schema 3, module catalog pins and lifecycle class registration | WH-123, WH-009 |
| WH-125 | Instance registry, activation reviews, scoped resolver, policy engine and API envelope | WH-124 |
| WH-126 | Access module: project visitor identity, staff role reviews and revocation | WH-125 |
| WH-127 | Records and forms module, with contact as a fixed-schema instance | WH-126 |
| WH-128 | Files and galleries module, with project photos as an owner collection | WH-126, WH-010 |
| WH-129 | Content collections module over the directory service | WH-125 |
| WH-130 | Connected acceptance: two frontend compositions, cross-tenant/role/direct-API fixtures | WH-127, WH-128, WH-129 |

## Specification schema 3 delivery (WH-124) — October 4, 2026 UTC

**Implemented in source; not deployed or accepted.** [Specification schema 3](project-specification.md#specification-v3) replaces schema 2's library-only `records/forms/files/access` sections with `instances[0..8]: {id, kind, module, schema, dependencies, config}` using the closed configurations above and exact `{name, version: 1, digest}` pins. `project-content@3` is the only compiler identity; the schema 2 reader, lock and SQL admission are removed and schema 2 test specifications are reset at the coordinated empty-database cutover, never converted.

- **Trusted module catalog.** `moduleCatalog` in [`src/project-specification/catalog.ts`](../src/project-specification/catalog.ts) sits beside `compilerCatalog` and `serviceClientCatalog` with `available | withdrawn` state. Its digests are generated by `tools/check-specification-compiler.mjs`: a module digest binds the pin name to the pinned configuration validator ([`v3/modules.ts`](../src/project-specification/v3/modules.ts)); a schema digest binds the storage pin name to its lifecycle classes with storage `not-admitted`. Compilation rejects a different digest with `STALE_MODULE_VERSION` and a missing/withdrawn kind with `MODULE_UNAVAILABLE`. A later handler or storage layout is a reviewed identity cutover, not a repin.
- **Validation.** Pure validation rejects PNG, collections above 1 MiB, `public` read/upload/view audiences, roles other than `staff`, views/galleries/`staffWrite` wider than field or collection policy, visitor views of all records, public attachment intake and records/files audiences without a same-project access dependency (or without the declared `staff` role). Staff upload (`upload: ["staff"]`) and staff write (`staffWrite`) are expressible. Forms resolve upload collections only through a declared files dependency.
- **Change classification.** `modules.put` (complete instance) and `records.addField` are classified against the saved base: widening a read/upload/submit/view/gallery/staff audience, adding a non-owner field/view/form or lengthening retention returns the `permissions` review; an optional field addition is `additive-optional` with `fieldsRevision + 1` and the `schema` review; required/removed/renamed/retyped fields, changed choice options or optionality, removed schemas/collections and pin or kind changes reject with `MIGRATION_REQUIRED`. Narrowing, labels and view projection changes are hook `none`.
- **Not serving.** Configuration is not activation: the compiler admits pins and then returns `UNAVAILABLE_CAPABILITY` for any instance, so the mounted single-homepage adapter, `content@2` and page components are unchanged and save only content specifications until WH-125 adds the registry and activation reviews. Capability catalog entries for these modules stay `planned` (`unsupported`).
- **Lifecycle classes.** `module-records`, `module-files` and `project-roles` are registered as planned classes in [`data-lifecycle.json`](data-lifecycle.json) with readers, processors, retention and export policy; no table is admitted.

### Records retention and visitor values — WH-124

**Owner decision, October 4, 2026 (recorded on #107).** Each records instance declares `retentionDays`: default 90 days, owner-selectable 30, 90 or 365 days, maximum 365 days, counted from submission. General records never inherit the 30-day contact window silently. Shortening applies at the next expiry pass; lengthening requires the permissions review. Account or project closure deletes ordinary records, and active safety holds or restricted preservation override deletion until released. The values live only in `recordsRetention` in [`v3/modules.ts`](../src/project-specification/v3/modules.ts); `tests/specification-compiler.mjs` fails if this section or the `module-records` lifecycle class drifts. Changing them is a compiler identity cutover.

**Owner decision, October 4, 2026 (recorded on #107):** visitor-submitted values stay dashboard-only. They never enter owner Chat, model context or Chat history; WH-125 bindings expose counts and states only.

## Instance registry, activation reviews and policy engine (WH-125) — October 4, 2026 UTC

**Implemented in source and verified locally (disposable SQLite and local D1); not deployed or accepted.** The tables are a new current schema input (`src/shared-modules/schema.sql`, listed in `tools/current-schema.mjs`), so the automatic `deploy ci` refuses this change: it needs the owner-run empty-database cutover in [releases](releases.md). No route on the visitor origin, kind data handler, provider, binding or Cloudflare resource is added.

- **Registry.** `module_instances` holds one WH-071 logical resource per project/specification instance id: server-assigned resource UUID, kind, exact module/schema digests, canonical configuration and its digest, the [WH-071 descriptor](workload-placement.md#minimum-descriptor-fields) (logical refs only, no owner id or locator; data sets `excluded` and no export hook because WH-125 stores no module data), dependency resource ids, a monotonic `configRevision` and the source specification version/digest. `module_activations` stores state (`inactive | active | suspended | migrating`), its own revision and the review/descriptor/configuration revision it applied. Identity, project, kind and pins are immutable; a pin change needs a reviewed migration.
- **Exact owner reviews.** `moduleActivationReview` (owner ChatControl or the `modules` card) prepares a ten-minute review bound to the current saved specification head, configuration digest, descriptor, dependencies and the expected configuration and activation revisions; its digest binds every field. Activation requires current `core.forms` (records) or `core.editing` `prepare` inclusion, active dependencies, an available catalog pin and an unheld specification; a changed configuration is classified with the WH-124 hook table (widening flagged, `MIGRATION_REQUIRED` refused) and advances `configRevision` by one. Disabling binds the current registry row and needs identity and ownership only. `moduleActivationApply` requires a recent passkey sign-in; its applied receipt insert composes `featurePredicate(... 'confirm')` (activation) and the admitted workspace identity, and the `module_activation_apply_admit` trigger repeats the typed control, digest, expiry, ownership, registry/activation revisions, pins, source head, dependencies and safety hold before the `AFTER INSERT` trigger registers or updates the instance and state. One receipt per review and the activation-revision check give one winner; a lost acknowledgement reads the saved receipt.
- **Resolver and policy.** `resolveResource` (`src/shared-modules/registry.ts`) derives scope from the server principal (owner workspace, public; visitor/staff arrive with WH-126), returns one generic `not_found` for foreign/missing resources, fails withdrawn pins (`unavailable`), different digests (`stale_module_version`) and a different `configRevision` (`stale_configuration`), and requires an active instance with active dependencies for non-owners; owners keep reads, export, removal and revocation in every state. `decideModule` (`policy.ts`) is the frozen policy table.
- **Envelope and receipts.** `handleModuleRequest` (`api.ts`) accepts only `whumpo-modules` v1 (`client_update_required` otherwise), rejects authority keys, resolves and decides, then for writes reads an existing `(resource, requestId)` receipt after rechecking permission (same hash: readback; different hash or principal: `request_conflict`) or commits the handler's statements with a receipt whose `module_request_admit` trigger repeats active state, dependencies, revisions, pins and the composed principal predicate. Unknown outcomes read back and otherwise return `unresolved`. Errors are the typed codes above (`ModuleError`) and never echo submitted values. `moduleHandlers` is empty: every operation is `unavailable` until WH-126–129 register handlers.
- **Chat and views.** `module.instances@1` (`modules` view, feature null) shows ids, kinds, states, serving, revisions and catalog state only. Review/apply replies name instance ids, kinds and revisions, never configuration or visitor values; visitor-submitted values never enter Chat history or model context.
- **No maintenance inference.** `tests/shared-modules-registry.mjs` statically bundles `api.ts`, `registry.ts`, `policy.ts` and `activation.ts` and fails if any reaches the AI/agent/Chat modules, and runs every module path with no AI configuration and a throwing `fetch`.

**Known gap.** The content compiler still refuses instance-bearing specifications (`UNAVAILABLE_CAPABILITY`, WH-124), so owners cannot yet save a specification that contains instances; lifting that gate is a reviewed compiler identity cutover (`project-content@4`) that has not been made. Until then the registry is reachable only from fixtures, and the test rewrites the saved head specification in its disposable database. Visitor sessions/access revisions (WH-126), kind handlers and visitor-origin routes (WH-126–129) and lifecycle hooks/export serializers per kind remain open.

## Owner decisions

Both WH-123 open decisions were decided by the owner on October 4, 2026 and recorded on #107:

1. **Default retention for general module records.** 90-day default; owner-selectable 30, 90 or 365 days; 365-day maximum; account closure deletes; safety holds override ([details](#records-retention-and-visitor-values--wh-124)).
2. **Visitor-submitted values in owner Chat.** Dashboard-only; never in owner Chat, model context or Chat history. WH-125 bindings expose counts and states only.

## Verification

`node tests/shared-modules-registry.mjs` (add `--d1` for local D1) runs the WH-125 handlers over the complete current schema with two owners/projects, a Starter owner, revocation, stale passkey proof, replay, concurrent winners, lost-acknowledgement readback, withdrawn/stale catalog variants, plan loss through revoked preview grants and an ended invoice, commit-time disable/revision races, closure counts and cascades, and the static no-inference check. It proves source behavior in disposable databases only, not deployment or customer acceptance.

`node tests/shared-modules-contract.mjs` runs offline checks over the instance envelope, catalog pin admission, request envelope, principals and policy table with invented identifiers. It proves the frozen examples only — not runtime authorization, persistence, migration, safety or acceptance. Roadmap validation/alignment/render checks and `git diff --check` cover the backlog change. No database, provider, model, Cloudflare resource, CMS test or deployment is involved.
