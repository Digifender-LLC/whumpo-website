# Domain ownership and connection

## Implemented ownership stage

`/domains` and Details → Domains list owned claims. `/domain HOSTNAME PROJECT_ID` prepares a random 256-bit TXT proof at `_whumpo.HOSTNAME`; `/verify-domain CLAIM_ID` checks it. Creation, renewal, verification status, activity and chat receipts commit under the conversation revision. Retry of a saved message does not repeat the DNS request. Proofs expire after seven days; renewal rotates the token and clears verification.

Hostname inputs are lowercase ASCII DNS names (IDNs must use their ASCII form), with no URL, path, port, credentials, wildcard, IP address or platform hostname. Proof names fit the DNS name limit. Ownership of the project is checked before producing instructions or querying DNS. Different accounts may prepare independent proofs for the same hostname: a pending request cannot reserve someone else's domain globally.

The fixed Cloudflare DNS-over-HTTPS resolver receives only the proof record name, never a customer-controlled request URL. Responses are bounded to 32 KiB with a five-second timeout and no redirect following. Verification requires an exact TXT value at the exact requested owner name. NXDOMAIN or a wrong proof does not verify ownership. Resolver errors remain retryable failures. Checking a missing proof clears the prior verified state. A future connection must recheck the current proof immediately before provisioning; historical verification is not durable routing authority.

Limits are three claims per project, ten per account and eighty across this test platform, enforced atomically before insert. Unused claims can be removed through the reviewed flow below. Claims referenced by hosting or Cloudflare DNS history remain retained for recovery. These claims do not create provider custom hostnames, reserve registrations, change DNS, issue certificates, publish sites or consume AI units.

## Hosting activation remains pending

Cloudflare documents 100 included custom hostnames on Free, Pro and Business plans. The existing Wrangler OAuth login returns 403 for Custom Hostnames and fallback-origin APIs. A zone-scoped SSL and Certificates Edit token and enabled included Cloudflare for SaaS capability are required before provider provisioning can be verified. Do not deploy the interactive Wrangler OAuth credential into a Worker.

Provisioning, checks, disconnect, maintenance and public hostname mapping are now implemented in [hosting design](integrations/domain-hosting.md), with activation disabled. Remaining acceptance and operations work includes reconciling custom hostname creation after uncertain responses; store exact provider IDs; enforce a global active-hostname allowance below the included limit; configure the origin/Worker route without intercepting workspace traffic; require both hostname and certificate active states plus correct routing; map hostnames to the current published project version; revoke public access on disconnect; add repair/status checks and operator recovery. Verification alone must never display Connected.

Domain purchases and optional customer Cloudflare/GitHub authorization remain separate unfinished integrations. No Stripe account is configured and no purchases are enabled.

References checked September 29, 2026:
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/common-api-calls/

## Natural-language ownership actions

Customers can ask the agent to prepare domain ownership instructions for a named project and hostname, or to check a prepared proof. The server executes the same validated `/domain` and `/verify-domain` operations and supplies their actual receipts. All ten permitted owned claims are discoverable in compact model context; proof tokens are excluded from that metadata. The secondary Domains panel and free commands remain available. See [workspace agent contract](workspace-agent.md#conversational-domain-ownership).

## Removing unused ownership proofs

Migration 0074 adds `/remove-domain-proof CLAIM_ID` and the separate user confirmation `/confirm-domain-proof-remove REVIEW_ID`. Domains → Review proof removal opens the same Chat review. The agent may prepare a review with `domain.reviewRemoval`; it cannot confirm. A ten-minute review identifies the hostname and explains that only Whumpo’s saved proof is removed. Registration, DNS records (including manually added TXT records), hosting and public websites remain unchanged. A new proof for the same hostname can be prepared afterward with a new token.

Confirmation checks the owner, exact token/expiry and explicit guided user command inside the database transaction. Renewed proofs and expired reviews fail closed. Hosting and Cloudflare DNS references are rechecked at deletion, including references added after review; their history is retained even for completed or disconnected operations. Chat confirmation, proof removal and activity commit atomically. Retrying cannot remove a replacement proof or duplicate the activity. Project deletion retains its existing separate policy and is not authorized by this feature.

Status: implemented; focused disposable D1 tests cover foreign owners, raw/model deletion rejection, renewal conflicts, hosting/DNS races, replay, simultaneous confirmations, fresh re-addition and unchanged AI allowance. Deployment evidence is recorded after release.
