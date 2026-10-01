# Deterministic project specification compiler

**Current source contract — October 1, 2026. WH-120 / [#53](https://github.com/zemdregon/whumpo/issues/53). Deployment pending.** This supersedes the original WH-066A compiler/import contract. The only supported website specification is schema **2**, compiled by `project-content@2`. Version-1 readers, locks, import adapters and the duplicate offline specification prototype are removed. Obsolete test drafts must be reset; they are never converted. See the [current-version policy](current-version-policy.md).

The [specification ADR](project-specification.md) owns shapes and operations. The [storage contract](project-specification-storage.md) owns authenticated creation, review, apply and delivery. The [capability planner](capability-planner.md) selects maintained capabilities before source generation. Compilation grants no publication, provider or spending authority.

## Implemented scope

| Layer | Current behavior | Boundary |
| --- | --- | --- |
| Closed schema | `src/project-specification/v2/schema.ts` validates schema 2, exact module versions, references, field shapes and permission dependencies. | Records, files, staff, notification and automation declarations remain library contracts; they do not implement those services. |
| New website | `compileNewWebsite` takes a new bounded plain-text `PhotoConfig`, including required `photos: []` when unused, constructs content references and compiles immediately. | No saved HTML, origin/version record or old configuration is accepted as an import. |
| Edits | Text, theme, site name, ordered sections and photo references produce detached validated candidates. Additional library operations classify schema, permission, integration and spending reviews. | No arbitrary replacement document, SQL, source, provisioning, deletion or generic patch action. |
| Content rendering | Only `content@2`; one to four public pages. `site-page@1` renders a page without photos; `photo-page@1` renders a page with one to four photos. Both are current maintained components. | The mounted storage/host adapter supports one homepage. Multiple routes and staff delivery remain unsupported. |
| Evidence | Ordered artifact metadata records page/path/component, media type, byte length and SHA-256. The manifest binds spec digest, exact lock and preview headers. | No clock, random ID, inference or provider state enters rendering. `activation: not-configured` and `published: false` remain explicit. |
| Build gate | `pnpm check` and `pnpm build` recompute source pins and generated constants. Release snapshots include both compiler locks. | Reproducibility is not a signature or live acceptance. |

Pages always include `photos`. Their component must match the presence of photo references. Replacing sections preserves content referenced by other pages; replacing photos changes the component deterministically. Ownership, clearance, immutable reference rows and private bytes are checked by the storage/delivery adapter, not the pure compiler.

## Identity and availability

`compiler-locks/project-content-v2.json` pins nine source inputs, the rendering bundle, shared component source, esbuild version and target. The runtime lock names schema 2, `project-content@2`, `content@2` and both current page components. `compiler-artifacts.generated.ts` carries verified digests into Worker code. Object keys are canonicalized; array order is significant.

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

Current local compiler checks cover closed/current-only schemas, all edit classes, photos and section-reference preservation, rejected missing-photo/old-schema input, repeated rendering, key order, themes, routes, escaped content and output bounds. An independent checkout/process/timezone reproduces the exact manifest. Pin drift, stale constants, reinitialization and catalog withdrawal reject. Network/inference is replaced with a throwing stub and remains unused.

`tests/current-website-specifications.mjs` exercises actual creation/review handlers with disposable SQLite, synthetic photo receipts and scripted inference. `tests/specification-journey.mjs` exercises authenticated HTTP handlers with disposable local D1. See [storage evidence](project-specification-storage.md) for the complete boundary and verification record.

The September 30 v1 deployment/acceptance record remains in the storage document as dated history; it is not acceptance of this cutover. No remote schema reset, customer publication, provider activation or CMS functional testing is implied. Broader records/staff/files and notifications/rules remain their roadmap workstreams.
