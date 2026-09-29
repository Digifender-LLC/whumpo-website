# Reviewed custom hostname hosting

## Activation is still disabled

The provisioning, checking, disconnect and public-routing code is implemented. It is not a claim that a real customer hostname works. The zone-scoped token is absent, the fallback origin and wildcard route have not been configured, and real certificate/routing acceptance remains outstanding. Never set `DOMAIN_HOSTING_READY=verified` merely because the code deploys.

Before activation, the operator must:

1. Verify the zone's included Cloudflare for SaaS allowance and enable only the included/free hostname feature. No paid add-ons, custom origins, custom metadata, apex proxying, dedicated certificates or Workers for Platforms are used.
2. Install the previously requested zone-limited SSL and Certificates Edit token as `CLOUDFLARE_DOMAINS_TOKEN`. Do not reuse Wrangler's interactive OAuth token.
3. Configure `hosting.digifender.com` as an originless proxied AAAA record (`100::`) and the zone's fallback origin. Confirm its provider state is active.
4. Configure the customer-hostname route to `whumpo-sites`, with explicit more-specific exclusions for `digifender.com/*`, `sites.digifender.com/*` and other existing platform hostnames as appropriate. Test custom-domain/route precedence before enabling customer traffic. Do not install a blanket route that intercepts workspace traffic. Current Wrangler configuration deliberately does not add this wildcard route yet.
5. Verify the actual domain and certificate with a controlled customer hostname, including photo assets, HTTPS, root path, unknown paths, publish/restore/unpublish, workspace exclusion and disconnect. Check the hourly job and its request budget under the existing account allowance. Then set the activation flag only after the infrastructure prerequisites have been confirmed; finish live customer acceptance before claiming the feature delivered.

The current connection check requires a direct, publicly visible DNS-only CNAME to `hosting.digifender.com`. Flattened apex records, proxied customer DNS, and nameserver delegation are not supported by this first connection verifier. These remain follow-up work, not silently accepted routing configurations.

## Review and provisioning

Authenticated endpoints under `/api/domain-hosting` list connection reviews and receipts. `POST /review` takes an idempotency UUID and owned claim ID. `POST /:id/confirm`, `/refresh` and `/disconnect` perform explicit user actions behind the normal origin check. Details → Domains exposes the same flow, and chat phrases such as `connect my domain` open it. The AI cannot directly confirm provisioning.

A review binds the owner, claim, project, hostname, zone, CNAME target and proof hash for ten minutes. Confirmation requires a current unexpired proof and a fresh exact TXT check. It also checks Cloudflare inventory below eighty hostnames and proves no matching hostname exists before reserving the name locally. The D1 transition enforces a platform limit of eighty non-review/non-disconnected records, including uncertain requests. One active/reserved hostname cannot belong to two users/projects. At most 100 review records are retained per user. These controls do not cap other applications sharing the Cloudflare account; account-wide monitoring remains necessary.

The request creates one standard DV certificate with HTTP validation. No customer DNS record is written and no site is automatically published. Only the exact returned provider ID is retained. Provider calls use a fixed zone URL, no redirects, ten-second timeout and at most 128 KiB of JSON. Untrusted provider URLs, messages, metadata and HTTP challenge bodies are not executed, fetched or shown.

A create request is sent at most once per review. A timeout or lost response with no persisted provider ID becomes uncertain and keeps the hostname reserved. Confirmation never repeats that create, nor adopts a resource found by hostname search. A provider ID persisted despite a lost database acknowledgement can continue through normal checks. A disconnect racing creation preserves the eventual resource ID for cleanup and never restores routing.

## Serving and maintenance

A known resource is rechecked by its exact ID and hostname. Both hostname and certificate must be active, the current Whumpo TXT proof must match, and a direct CNAME must match the configured target. Only then is local routing granted for at most two hours, capped by the proof expiry. The hourly cron at minute 47 checks up to eighty connections in batches of four. With activation absent it returns without provider calls. Failed checks immediately remove local serving permission; missing scheduled checks allow leases to expire. Seven-day ownership proofs must currently be renewed manually; that test limitation needs a longer-lived ownership lifecycle before a broad rollout.

The public Worker maps the incoming URL hostname to exactly one currently authorized project. It serves only `/` and that project's current published JPEG dependencies under `/assets/`. It rejects API routes, foreign site-ID paths and unknown hosts. Publish/restore changes follow the existing publication pointer; unpublishing immediately removes content. Workspace sessions and configuration are unavailable to this Worker. A hosting connection alone never makes a private draft public.

Disconnect clears local routing before any provider request. It checks the stored provider resource identity, then deletes only that exact ID. Failed deletion retains a disconnected-from-serving cleanup state and can be retried by the user or hourly job. Missing activation configuration cannot prevent local disablement. References use RESTRICT so future project/account deletion cannot silently discard an external cleanup obligation.

## Uncertain resource recovery remains operator work

A request without a recorded provider ID cannot safely be retried, adopted or deleted automatically. Inspect Cloudflare's audit/history and exact resource data to establish whether this application created a resource. Preserve the database row and capacity reservation while investigating. The operator recovery command described below can attach an independently verified exact resource ID with an atomic audit receipt. There is intentionally no public API accepting an arbitrary provider ID. Do not unblock by deleting rows without accounting for external resources.

## Verification boundary

`test:domain-hosting` uses disposable D1 and controlled Cloudflare/DNS responses. It covers owner checks, idempotent reviews, current proofs, inventory limits, conflicting resources, concurrent confirmation, certificate/DNS/identity failures, published-only host routing, lease expiry, immediate disconnect, retried deletion and uncertain outcomes without repeated creation. Existing domain, domain-agent, publication and photo tests exercise adjacent contracts. Tests do not prove provider entitlement, actual TLS issuance, wildcard routing or a real scheduled execution.

References checked September 29, 2026:

- [Worker fallback origins and route exclusions](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/)
- [Create custom hostname](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/create/)
- [List custom hostnames](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/list/)
- [Delete custom hostname](https://developers.cloudflare.com/api/resources/custom_hostnames/methods/delete/)

Deployment evidence (September 29, 2026): migration 0018 applied locally and remotely. Main Worker `5e3ad349-dc69-43d1-a7a3-84b857275afe`, public Worker `fcbb0d6f-1cd8-4538-8412-2a74cbf7a903`. TypeScript, hosting, domain-agent and photo-version tests passed; the photo test now checks custom-host root/asset rendering, foreign assets and restore/unpublish revocation. Local browser fixtures passed review, pending-certificate display, reload and disconnect. Live signed-passkey checks passed disabled status, anonymous denial, cross-origin denial, disabled review (503), missing-resource disconnect and existing GitHub controls. No provider hostname call or AI inference was made; the temporary account was removed. The hourly cron is deployed but real configured provider maintenance remains unverified.


## Operator recovery command

`tools/reconcile-domain-hosting.mjs` handles an **existing** Cloudflare resource whose create response was lost. It requires the ignored zone token file and the operator's local Wrangler login. Wrangler's credential is used only locally for D1 queries, never copied to a Worker or sent to the model. The recovery module is not imported by the HTTP Worker.

First inspect the exact resource from Cloudflare audit records:

```sh
node tools/reconcile-domain-hosting.mjs inspect CONNECTION_ID PROVIDER_ID resume --remote
```

Use `cleanup` instead of `resume` to preserve or request disconnect. The tool reads the connection and the exact provider ID, checks hostname/zone/creation time and saves a ten-minute review in `.secrets/hosting-recovery-UUID.json` with mode 0600. It prints a digest and the resource summary. This inspection makes no provider or database mutation. **Matching name and timestamp do not prove that Whumpo created the resource.** The operator must establish ownership from independent request/audit evidence; never adopt another application's hostname.

After reviewing that evidence and the saved file:

```sh
node tools/reconcile-domain-hosting.mjs apply .secrets/hosting-recovery-UUID.json --confirm REVIEW_DIGEST --operator OPERATOR_LABEL --evidence 'Audit reference and reason the resource belongs to this request' --remote
```

Apply validates the review digest, expiry and current immutable connection snapshot, then re-reads the same provider resource. One conditional D1 update attaches the ID, keeps routing disabled and triggers an immutable audit row plus a fixed user activity event in the same transaction. Repeating the same review/evidence returns its receipt, including after a lost acknowledgement. Changed connection state, identity, evidence or review content is rejected. An already disconnecting record cannot resume service. Recovery sends only GET requests to the provider; it neither creates nor deletes resources. Normal refresh or cleanup must run afterward.

Do not put secrets or personal information in evidence notes. The audit notes are operator records and are not supplied to the model; users see only a fixed recovery event. The audit rows prevent deletion of their referenced connection. Account/project deletion must account for retained operational records explicitly.

Still unresolved automatically: a missing resource, ambiguous provider audit evidence, or a request stuck in `creating`. These keep their reservation; this tool does not infer nonexistence or release capacity from a name search. A separately reviewed absence/retry recovery flow remains follow-up work.

## Concurrent verification

Each hosting refresh stores a unique check ID while disabling the prior serving lease. Only that attempt may commit its status. A newer refresh or disconnect invalidates the older attempt; an old success cannot override a newer failed proof check. Final activation also requires the same proof token and expiry still in D1, so renewal during DNS IO cannot grant routing from the old result.

`test:domain-recovery` covers exact identity/time checks, digest tampering, evidence validation, atomic audit rollback, immutable receipts, concurrent/replayed/lost-ack application, cleanup-only recovery after disconnect, changed-state rejection, overlapping refreshes, disconnect races and proof rotation during verification. It uses disposable local D1 and controlled read-only provider responses. Real operator recovery remains unverified until an eligible real resource exists; no production recovery record was manufactured for testing.

Recovery deployment evidence (September 29, 2026): migration 0019 applied locally and remotely; main Worker `149b5bce-7a9e-4a34-88ad-55b26248f3c1`, public Worker `a3fc7072-624a-41b5-aa27-37a501fbe777`. TypeScript, hosting and recovery tests passed. The initial remote migration request failed with Cloudflare 7403, correctly preventing deployment. Wrangler subsequently confirmed the expected account/D1 permission and a remote read confirmed the migration was still pending; the gated retry succeeded without credential changes. Live signed-passkey/disabled-hosting/auth/origin checks passed with zero AI units and temporary-account cleanup. No production reconciliation or provider mutation was attempted; the operator CLI's real provider/D1 recovery flow remains unverified pending an eligible resource and zone token.
