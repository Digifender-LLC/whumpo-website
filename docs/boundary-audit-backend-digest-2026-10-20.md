# WH-004 slice: public backend digest check at serve time (October 20, 2026)

**Add-only. WH-004 stays open.** This slice adds one standalone test, [`tests/boundary-backend-digest.mjs`](../tests/boundary-backend-digest.mjs), and this note. No `src/`, schema, registry, roadmap or existing test file was changed.

## Gap chosen

The `target` cell of the `site-backend` family in [boundary-audit.json](boundary-audit.json) says: "Immutable source digest-checked at serve time (the 503 branch is untested)". The surface is anonymous public execution (privileged class `execution`), so if the check failed, stored code that the owner never reviewed could run on the public internet. The check is the `if(!service||await hashToken(row.source)!==row.digest)` line in `publicBackend` ([src/backend-publication.ts](../src/backend-publication.ts)). The only evidence until now was the `backend_versions_immutable` trigger test in [tests/backend-versions.mjs](../tests/backend-versions.mjs), which shows the write is blocked but not what serving does if the bytes change anyway.

Other untested cells considered and not chosen this run: the site-assets 429 mapping and held specification, the visitor app-shell 429 and forwarding, and the visitor deletion safety-hold 503 through the gateway. All of them are availability or admission cells. This one is about code integrity on an execution surface.

## What the test covers

It runs the sites Worker's default export (`m.host`) against a project host `https://<project>.whumpo.site/backend`. The publication is created with the real `saveBackend`, `testBackend`, `prepareBackendPublication` and `confirmBackendPublication`. The runtime binding is a counting stub, and global `fetch` throws.

1. **Control:** the intact publication returns 200, makes one runtime dispatch, and is charged once in `backend_public_usage` and once in `public_client_usage`.
2. **Missing runtime binding** (the other half of the same condition): 503 `unavailable`, `no-store`, with no dispatch and no charge.
3. **Digest mismatch:** the test drops the immutability trigger, rewrites `backend_versions.source`, then recreates the trigger with the exact schema text. It asserts that the rewrite landed and that the trigger blocks updates again. After that, `/backend` and the pinned `/backend/<publication>` both return 503 `unavailable` with `no-store`. There is no runtime dispatch, no project or client admission charge, and the `backend_publications` row stays in place.
4. **Control:** writing back the original bytes (digest untouched) serves 200 from the pinned path again, with exactly one more dispatch and one more charge.

## Verification

- `node tests/boundary-backend-digest.mjs` passed on SQLite (9 checks).
- `node tests/boundary-backend-digest.mjs --d1` passed on local D1 (9 checks).
- Not done: a mutation run (removing the digest comparison to confirm the test fails). It would require temporarily editing `src/`, which was out of scope for this add-only slice.
- Local and synthetic only. No deployed Worker, and the real `whumpo-runtime` was not involved.
