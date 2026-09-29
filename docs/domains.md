# Domain ownership and connection

## Implemented ownership stage

`/domains` and Details → Domains list owned claims. `/domain HOSTNAME PROJECT_ID` prepares a random 256-bit TXT proof at `_tellumo.HOSTNAME`; `/verify-domain CLAIM_ID` checks it. Creation, renewal, verification status, activity and chat receipts commit under the conversation revision. Retry of a saved message does not repeat the DNS request. Proofs expire after seven days; renewal rotates the token and clears verification.

Hostname inputs are lowercase ASCII DNS names (IDNs must use their ASCII form), with no URL, path, port, credentials, wildcard, IP address or platform hostname. Proof names fit the DNS name limit. Ownership of the project is checked before producing instructions or querying DNS. Different accounts may prepare independent proofs for the same hostname: a pending request cannot reserve someone else's domain globally.

The fixed Cloudflare DNS-over-HTTPS resolver receives only the proof record name, never a customer-controlled request URL. Responses are bounded to 32 KiB with a five-second timeout and no redirect following. Verification requires an exact TXT value at the exact requested owner name. NXDOMAIN or a wrong proof does not verify ownership. Resolver errors remain retryable failures. Checking a missing proof clears the prior verified state. A future connection must recheck the current proof immediately before provisioning; historical verification is not durable routing authority.

Limits are three claims per project, ten per account and eighty across this test platform, enforced atomically before insert. Claims currently remain until project/account deletion; a user-facing disconnect/removal flow is still needed. These claims do not create provider custom hostnames, reserve registrations, change DNS, issue certificates, publish sites or consume AI units.

## Hosting connection remains pending

Cloudflare documents 100 included custom hostnames on Free, Pro and Business plans. The existing Wrangler OAuth login returns 403 for Custom Hostnames and fallback-origin APIs. A zone-scoped SSL and Certificates Edit token and enabled included Cloudflare for SaaS capability are required before provider provisioning can be verified. Do not deploy the interactive Wrangler OAuth credential into a Worker.

Next steps: reconcile custom hostname creation after uncertain responses; store exact provider IDs; enforce a global active-hostname allowance below the included limit; configure the origin/Worker route without intercepting workspace traffic; require both hostname and certificate active states plus correct routing; map hostnames to the current published project version; revoke public access on disconnect; add repair/status checks and operator recovery. Verification alone must never display Connected.

Domain purchases and optional customer Cloudflare/GitHub authorization remain separate unfinished integrations. No Stripe account is configured and no purchases are enabled.

References checked September 29, 2026:
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/common-api-calls/
