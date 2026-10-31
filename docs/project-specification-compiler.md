# Deterministic project specification compiler

**Current source contract — October 4, 2026. WH-124, `project-content@4` and `project-content@5` cutovers of the WH-120 / [#53](https://github.com/zemdregon/whumpo/issues/53) compiler; implemented in source, not deployed.** The only supported website specification is schema **3**, compiled by `project-content@5`. `@4` replaced `@3` so that owners can save module instances as inactive configuration ([cutover](shared-modules.md#compiler-identity-cutover-project-content4--october-4-2026-utc)); `@5` replaces `@4` to add never-activated instance removal ([cutover](shared-modules.md#never-activated-instance-removal-project-content5--october-4-2026-utc)). There is no `@3` or `@4` reader. Schema 2 / `project-content@2` (deployed to test on October 1) and all earlier readers, locks and import adapters are removed. Obsolete test drafts are reset at the coordinated empty-database cutover; they are never converted. See the [current-version policy](current-version-policy.md).

The [specification ADR](project-specification.md) owns shapes and operations. The [storage contract](project-specification-storage.md) owns authenticated creation, review, apply and delivery. The [capability planner](capability-planner.md) selects maintained capabilities before source generation. Compilation grants no publication, provider or spending authority.

## Implemented scope

| Layer | Current behavior | Boundary |
| --- | --- | --- |
| Closed schema | `src/project-specification/v3/schema.ts` validates schema 3, compiler module versions, references and page permissions; `v3/modules.ts` validates the frozen [shared module](shared-modules.md) instance configuration, dependencies and change classification. The shared bounded JSON codec stays at `v2/json.ts` because the pinned service-client compiler also hashes it. | Records, files, access, notification and automation declarations are configuration only; they do not implement those services. |
| New website | `compileNewWebsite` takes a new bounded plain-text `PhotoConfig`, including required `photos: []` when unused, constructs content references and compiles immediately. | No saved HTML, origin/version record or old configuration is accepted as an import. |
| Edits and restore | Text, theme, site name, ordered sections and photo references produce detached validated candidates. `modules.put`/`records.addField` classify schema and permission reviews and the `additive-optional` hook, or reject with `MIGRATION_REQUIRED`. Page audience and rules classify permission, integration and spending reviews. `compileSpecificationRestore` compiles a saved target under its own lock and classifies it against the current base with the same table. `modules.remove` and a restore that drops an instance pass only for ids the caller supplies as never activated (the storage adapter reads the registry); otherwise a removed instance is `MIGRATION_REQUIRED`. | No arbitrary replacement document, SQL, source, provisioning, data deletion, removal of an activated instance or generic patch action. |
| Content rendering | Only the `content@2` compiler module (`notifications`/`automation` return `UNAVAILABLE_CAPABILITY`). Pinned module instances are admitted as saved configuration and add no artifact. One to four public pages. `site-page@1` renders a page without photos; `photo-page@1` renders a page with one to four photos. Both are current maintained components. | The mounted storage/host adapter supports one homepage. Multiple routes and staff delivery remain unsupported. |
| Evidence | Ordered artifact metadata records page/path/component, media type, byte length and SHA-256. The manifest binds spec digest, exact lock and preview headers. | No clock, random ID, inference or provider state enters rendering. `activation: not-configured` and `published: false` remain explicit. |
| Build gate | `pnpm check` and `pnpm build` recompute source pins and generated constants. Release snapshots include both compiler locks. | Reproducibility is not a signature or live acceptance. |

Pages always include `photos`. Their component must match the presence of photo references. Replacing sections preserves content referenced by other pages; replacing photos changes the component deterministically. Ownership, clearance, immutable reference rows and private bytes are checked by the storage/delivery adapter, not the pure compiler.

## Identity and availability

`compiler-locks/project-content-v6.json` pins ten source inputs, the rendering bundle, shared component source, esbuild version, target and the four WH-067 module/schema pins. The runtime lock names schema 3, `project-content@6`, `content@2` and both current page components. `compiler-artifacts.generated.ts` carries verified compiler and module digests into Worker code; `moduleCatalog` beside `compilerCatalog` sets their `available | withdrawn` state, and a different pin digest rejects with `STALE_MODULE_VERSION`. Object keys are canonicalized; array order is significant.

`tools/check-specification-compiler.mjs --check` rejects changed source or stale constants. `--generate` restores constants only for unchanged inputs. `--init` refuses an already pinned identity. A future behavior change gets a newly reviewed identity and direct current-only cutover; remove the superseded implementation and reset obsolete test records. Never rewrite an accepted pin or retain a downgrade reader.

The trusted server catalog controls current availability separately from immutable identity. Missing or withdrawn artifacts reject compilation and saved-version access. Clients/models cannot substitute a catalog. No runtime resolver downloads packages, evaluates source, reads secrets, contacts providers or invokes inference. The [service-client compiler](project-service-clients.md) is now `project-service-clients@2`; its own fixed-contact/stateless-form specification remains schema 1, with no alternate accepted version.

## Bounds and failure

- Canonical specification JSON: 32 KiB and 32 nested levels; lock: 4 KiB; new page input: 8 KiB. Non-JSON values, sparse arrays, accessors, symbols and serialization hooks reject without invocation.
- Four pages, six sections per page, four photos per page and forty content records. Existing field/form ceilings still apply.
- Each rendered page: 32 KiB maximum; four library artifacts: 128 KiB maximum. The connected adapter accepts one homepage only.
- Errors use fixed codes/paths, including `UNSUPPORTED_VERSION`, `UNSUPPORTED_DELIVERY`, `COMPILER_LOCK_MISMATCH`, `COMPILER_UNAVAILABLE` and `OUTPUT_TOO_LARGE`. HTTP adapters return fixed safe messages.
- Text is escaped; previews are private/no-store and sandboxed. Authenticated photo previews permit only inline, owned, cleared, digest-verified image bytes.
- A failed edit batch leaves its input unchanged. D1 atomicity, late revocation, exact approval and retry identity are separately enforced by storage.

## Verification and status

Current local compiler checks cover instance-bearing compile, change and restore classification, `@3` lock refusal, closed/current-only schemas, all edit classes, photos and section-reference preservation, rejected missing-photo/old-schema input, repeated rendering, key order, themes, routes, escaped content and output bounds. An independent checkout/process/timezone reproduces the exact manifest. Pin drift, stale constants, reinitialization and catalog withdrawal reject. Network/inference is replaced with a throwing stub and remains unused.

`tests/current-website-specifications.mjs` exercises actual creation/review handlers with disposable SQLite, synthetic photo receipts and scripted inference. `tests/specification-journey.mjs` exercises authenticated HTTP handlers with disposable local D1. See [storage evidence](project-specification-storage.md) for the complete boundary and verification record.

The September 30 v1 deployment/acceptance record remains in the storage document as dated history; it is not acceptance of this cutover. No remote schema reset, customer publication, provider activation or CMS functional testing is implied. Broader records/staff/files and notifications/rules remain their roadmap workstreams.
