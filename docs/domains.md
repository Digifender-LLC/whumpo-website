# Domain ownership and connection

## Implemented ownership stage

`/domains` and Details → Domains list owned claims. `/domain HOSTNAME PROJECT_ID` prepares a random 256-bit TXT proof at `_whumpo.HOSTNAME`; `/verify-domain CLAIM_ID` checks it. Creation, renewal, verification status, activity and chat receipts commit under the conversation revision. Retry of a saved message does not repeat the DNS request. Proofs expire after seven days; renewal rotates the token and clears verification.

Hostname inputs are lowercase ASCII DNS names (IDNs must use their ASCII form), with no URL, path, port, credentials, wildcard, IP address or platform hostname. Proof names fit the DNS name limit. Ownership of the project is checked before producing instructions or querying DNS. Different accounts may prepare independent proofs for the same hostname: a pending request cannot reserve someone else's domain globally.

The fixed Cloudflare DNS-over-HTTPS resolver receives only the proof record name, never a customer-controlled request URL. Responses are bounded to 32 KiB with a five-second timeout and no redirect following. Verification requires an exact TXT value at the exact requested owner name. NXDOMAIN or a wrong proof does not verify ownership. Resolver errors remain retryable failures. Checking a missing proof clears the prior verified state. A future connection must recheck the current proof immediately before provisioning; historical verification is not durable routing authority.

Limits are three claims per project, ten per account and eighty across this test platform, enforced atomically before insert. Unused claims can be removed through the reviewed flow below. Claims referenced by hosting or Cloudflare DNS history remain retained for recovery. These claims do not create provider custom hostnames, reserve registrations, change DNS, issue certificates, publish sites or consume AI units.

## Hosting activation remains pending

Cloudflare documents 100 included custom hostnames on Free, Pro and Business plans. The September 30 management-token preflight confirms that whumpo.site has no allocated SaaS hostname quota and no fallback-origin feature access; this is not resolved merely by replacing Wrangler's OAuth credential. Operator feature enrollment, a zone-scoped SSL and Certificates Edit runtime token and verified fallback routing are required before provider provisioning can be accepted. See the [live activation preflight](integrations/domain-hosting.md#live-activation-preflight--september-30-2026) for the exact current state and billing review. Do not deploy the interactive Wrangler OAuth credential or broad local management key into a Worker.

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

Deployed September 29, 2026 to test platform `163964e5-5570-4e1e-98a3-1cc29504a642`, with migration 0074. Passed `pnpm check`, `pnpm test:domain-proof-removal`, `pnpm test:domains`, `pnpm build` and diff checks. Live health returned 200, anonymous Domains/Chat returned 401, and deployed frontend JS/CSS matched the tested isolated build. No real customer proof or external DNS record was removed during verification. Natural-language interpretation and physical mobile interaction for this new action remain unverified; the model action allowlist and server guards were checked locally.

## In-place workspace proof controls — September 29, 2026

Domains now prepares, renews and checks ownership proofs without switching to Chat on a normal result. The page shows the server's reply and refreshes its proof list. Hostname entry disables phone auto-capitalization, autocorrection and spellcheck. Controls are disabled while the shared Chat request is running or its initial state is unavailable.

These controls still use the same deterministic, revision-checked Chat command transaction internally, so the result is retained in conversation history. They do not call a second domain mutation service, consume inference, modify provider records, connect hosting or publish a site. The workspace captures its pending request before navigation and finds its reply by that exact request ID. If delivery remains uncertain, it opens Chat's existing same-ID Retry control. Known failures remain visible in the workspace notice; a retry cannot silently replace an unresolved request. Successful Chat requests invalidate cached domain controls without fetching every hidden panel.

Verification: `pnpm check`, `pnpm test:chat-delivery`, `pnpm test:domains`, `pnpm build`, `node tests/frontend-loading.mjs`, and diff checks passed. The isolated release also passed both TypeScript checks, production build and loading-graph check. Domain tests cover ownership, proof validation, unchanged hosting, replay and absence of AI charges; delivery tests cover request-identity recovery. Authenticated browser interaction and physical-phone acceptance of the new in-place controls were not exercised in this increment.

Deployed test platform version `5d276f56-f5a9-43ee-8eed-7904b7b4a79f`. All 18 manifest output files matched the tested release; Domains route HTML loaded, health returned 200, and anonymous domain reads returned 401. Existing pricing was preserved and unrelated account-recovery edits were excluded. No schema or customer DNS changes were made.

## Registrar quote review foundation — September 29, 2026

`src/domain-purchase-quote.ts` now validates a registrar-independent **read-only** purchase review. There is no connected registrar, availability search, payment, order endpoint, registration/renewal dispatch or benefit redemption. Provider selection is awaiting the owner's direction. No registry call or purchase was made for this work.

A trusted registrar adapter must establish the exact canonical domain, owner/project, registration-versus-renewal eligibility, one-year term, USD customer price, fees, taxes, current renewal-price breakdown, premium flag, provider reference, terms version and quote validity. These must be provider-verified/server-priced values, never AI guesses, public domain-search snippets or user-supplied prices. For renewal, `available` means eligible for this owner's renewal operation; it must not be populated using a registration-availability check. Hostname validation does not prove registrability, registry policy compliance or ownership; those remain the adapter's responsibility.

The helper rejects missing/unknown fields, unknown taxes, invalid currency/term, fractional/negative amounts, noncanonical or platform hostnames, foreign owner/project, future/expired quotes and validity periods longer than 15 minutes. Zero tax is permitted only as an explicit input from the trusted adapter. The review includes price/fee/tax components and all-in purchase and current renewal totals. It labels renewal pricing as not guaranteed, auto-renew as off, and purchasing/redemption as disabled. Annual domain eligibility in the plan catalogue remains an estimate: no paid entitlement or domain-benefit slot is consumed by a quote.

A canonical fingerprint binds every quote field, including provider reference, domain, operation, current price, renewal terms and expiry. Reordering object keys preserves identity; changing a term requires a new review. `matchesDomainPurchaseReview` checks that identity, current expiry and the customer's chosen ceiling. It does not make a legal agreement, reserve funds, confer domain ownership or authorize provider dispatch by itself. It is not exposed as a customer API or model tool.

Delivery still requires registrar selection and account terms, authentic quote/availability/renewal adapters, registration contact/privacy/consent handling, authoritative subscription/annual-benefit grants, tax/retail pricing, durable approval and money/benefit reservations, single-dispatch orders, uncertain-result reconciliation, customer ownership/transfer rules, notifications and live acceptance. Minimum deposits, recurring account fees and registrar/registry charges are unknown until a provider/account is chosen and must be reviewed before activation. The existing test build-credit units are not money and cannot fund domain registration.

Verification: `pnpm test:domain-purchase-quote`, `pnpm check`, and diff checks pass. Fixtures cover exact totals, canonical identity, missing fees/terms, owner/project isolation, expiry, all reviewed-field changes, ceiling rejection and caller-mutation isolation. This module has no network, database, purchase or redemption effects and has not been activated on the deployment.
