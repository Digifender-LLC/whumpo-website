# Deterministic project specification compiler

**September 30, 2026 — WH-066A, source implementation and local verification.** [Parent #14](https://github.com/zemdregon/whumpo/issues/14) retains the complete WH-066 acceptance criteria. [Compiler slice #15](https://github.com/zemdregon/whumpo/issues/15) supplies a Worker-compatible library and build gate. Durable proposals, authenticated preview/apply/restore and forms/API delivery remain [#16](https://github.com/zemdregon/whumpo/issues/16) and [#17](https://github.com/zemdregon/whumpo/issues/17). This slice adds no route, Chat action, migration or live deployment.

The [WH-064 specification ADR](project-specification.md) owns the schema and operation contract. The [capability planner](capability-planner.md) selects capabilities before source generation. This compiler turns supported configuration into exact private artifacts without inference. It does not grant publication, identity, storage or provider authority.

## Connected storage follow-up

WH-066B now mounts the single-homepage compiler through authenticated Chat tools, saved proposals, private preview/diff and exact typed apply/forward restore. See [saved configuration storage](project-specification-storage.md) for implementation, limits, verification and deployment status. The original WH-066A evidence below remains a source-only historical claim; forms/API and broader runtime delivery remain #17.

## Implemented scope

| Layer | Implementation | Boundary |
| --- | --- | --- |
| Full schema | `src/project-specification/v1/schema.ts` validates the closed v1 document, module/version dependencies, references, field shapes and permission compatibility. | Validation of records, files, staff access, integration slots and rules does not implement their runtime services. |
| Supported edits | All six ADR operations create a detached, validated candidate. Whole ordered-array diffs and additional review classes are deterministic. | No replacement JSON, source, provisioning, deletion or generic patch operation. Adding a field permits optional text only; other changes require a migration contract. |
| Content compiler | `src/project-specification/compiler.ts` accepts an exact compiler lock and a specification declaring **only `content@1`**, with one to four public `site-page@1` pages. It resolves content references through the existing renderer. | Staff routes and any additional module declaration, even unused, fail closed. Multiple output paths are private artifacts; the current site host does not thereby acquire multi-route delivery. |
| Artifact evidence | Every page records its route, ID, audience, component, media type, UTF-8 byte length and SHA-256. A manifest records the spec digest, exact lock, ordered artifact metadata and preview headers; it has its own digest. | No timestamp, random ID, model choice or provider data enters rendering. `activation: not-configured` and `published: false` are explicit. |
| Legacy import | `importLegacySpecification` accepts an existing normalized `site-page@1` config, exact HTML/digest and origin version UUID; the projected config and rendered bytes must match exactly. | This pure adapter cannot authenticate a version ID. The storage caller must first load the owned immutable version. Photo, launch, CMS, custom backend and visitor-state adapters are absent; unsupported types are rejected. |
| Build enforcement | `pnpm check` and `pnpm build` verify the pinned compiler source and generated constants. The deployment build snapshot includes the lock and checking tool. | This is an integrity/reproducibility gate, not a code signature or proof of live customer acceptance. |

The existing form validator moved without behavior changes into `src/backend-form-config.ts`, with its error type in `src/backend-error.ts`. Previous imports remain valid through re-exports. The compiler reuses this pure contract without importing D1 operations, runtime execution or the visitor form script. Customer forms still use the existing reviewed handlers.

## Identity and availability

`compiler-locks/project-content-v1.json` pins nine source inputs, the bundled rendering core, component source, esbuild version and target. `compiler-artifacts.generated.ts` carries the verified digests into Worker code. The lock names `project-content@1`, `content@1`, `site-page@1`, schema version 1 and the content module's empty dependency list. Object-key order does not matter; ordered arrays do.

`tools/check-specification-compiler.mjs --check` recomputes these inputs and rejects drift. `--generate` only restores constants from an unchanged lock. `--init` refuses an existing identity. Do not update an accepted v1 lock to accommodate changed behavior: retain its implementation/lock and introduce a separately reviewed compiler version. Changes to shared validators/renderers also trigger this conservative gate. Future upgrades must preserve the old implementation or explicitly mark it unavailable, never silently reinterpret saved versions.

`src/project-specification/catalog.ts` is current, trusted server availability policy, separate from immutable artifact identity. Withdrawing an entry rejects new compilation/import/change requests without altering the historical digest. The public compiler functions always use this catalog; a caller cannot supply an alternative catalog. The exported availability checker exists for future storage/apply checks and takes **trusted server policy only**. No database withdrawal UI or migration policy is implemented in this slice. WH-076 remains responsible for the wider installed-module upgrade/recovery lifecycle.

No runtime lock resolver downloads packages, evaluates source, reads secrets, contacts a provider or calls a model. The compiler has no paid service prerequisite or recurring service charge of its own. D1/R2 persistence and associated quotas are part of the next delivery slice; no new service was provisioned here.

## Bounds and safe failure

- Canonical JSON is limited to 32 KiB and 32 nested levels. It sorts object keys, preserves arrays and hashes UTF-8 with SHA-256. Non-JSON values, sparse arrays, accessors, symbol properties and serialization hooks are rejected rather than invoked. Future HTTP handlers still need a streaming transport limit before parsing.
- Schema bounds remain those in WH-064: four pages, six sections each, forty content records, bounded records/forms/files/rules and closed nested objects. Existing site/form validators retain their stricter field and byte ceilings.
- Each rendered page is at most 32 KiB; four pages total at most 128 KiB of HTML. Lock input is capped at 4 KiB. Legacy import envelopes are bounded at 48 KiB and their HTML at 32 KiB. Exceeding a bound fails before an artifact is accepted.
- Schema/lock errors contain fixed codes and schema paths, never the submitted value or raw provider error. Additional compiler codes include `UNAVAILABLE_CAPABILITY`, `UNSUPPORTED_DELIVERY`, `COMPILER_LOCK_MISMATCH`, `COMPILER_UNAVAILABLE`, `OUTPUT_TOO_LARGE`, `UNSUPPORTED_LEGACY`, `NON_CANONICAL_LEGACY` and `ARTIFACT_MISMATCH`. The reused renderer also retains its fixed `Rendered site too large` error when escaped HTML exceeds its ceiling; #16's HTTP adapter must map that bounded failure to its safe response contract.
- Page copy remains escaped text. Artifacts carry the existing private/no-store, sandboxed preview headers, with no scripts, network sources or form actions allowed. A future preview endpoint must authenticate the request and actually apply these headers; their presence in a manifest alone is not an access control.
- An operation batch is all-or-nothing in memory: a failed later edit returns no candidate and never mutates the input. This does **not** prove transactional D1 apply, concurrency or lost-response recovery; #16 must deliver those properties.

## Verification — September 30, 2026

`pnpm test:specification-compiler` verifies:

- The full detailing fixture and all six changes against the independent WH-064 prototype; unknown fields/modules/versions, broken references, incompatible permissions, field migrations, unsupported executable operations and size/depth limits.
- Detached inputs/results, semantic diffs and required schema/permission/integration/spending reviews. Validation remains separate from owner approval.
- Identical bytes/digests across key reordering, repeated calls, all three themes and four ordered routes. A separate temporary checkout/process/timezone produces the same manifest digest.
- Exact lock matching, missing and withdrawn artifacts, including a real public compiler call after withdrawal in the isolated checkout. Withdrawal leaves the immutable artifact identity unchanged.
- Literal hostile text, escape-heavy configuration near the HTML ceiling, original legacy bytes/config/origin preservation, tampered HTML with both stale and recomputed digests, changed config and rejected unsupported import types.
- Build rejection of source drift, stale constants and attempts to reinitialize an existing identity; exact constant regeneration succeeds. Network/inference is replaced with a throwing stub and is unused.

Also run: `pnpm check`, `pnpm build`, `node tests/project-specification-prototype.mjs`, `node tests/backend-forms.mjs`, roadmap validation/render checks and `git diff --check`. The backend form suite exercises its existing local D1 review, ownership, stale-target, rendering/CSP and replay behavior after validator extraction. No CMS functional suite, real model call, provider activation or live customer publication was run.

## Connected delivery remains open

The current platform continues its existing Chat/site-version flow. This library is not yet mounted. #16 must persist tenant-owned heads, immutable specification versions and exact candidates/diffs/artifacts; verify authority, current catalog and content safety; bind approvals and request identities; atomically apply with expected revisions; connect private previews; and restore forward versions under current safety/deletion rules. Existing publication/export/removal receipts must account for new references and cannot be bypassed by a spec version.

#17 retains the forms/API-client and full connected acceptance scope. General record/staff/file services need their actual WH-067 contracts; fixed contact forms cannot stand in for arbitrary records, and visitor identity cannot stand in for staff authorization. Do not close WH-066 on this content-only compiler. Notifications/rules, provider dispatch, storage provisioning and customer runtime AI remain their separate roadmap tasks.

The parent/child GitHub issues are the execution record. The concurrently edited roadmap extension in PR #1 is preserved; WH-065/066 issue URL mapping must be reconciled when that extension integrates.
