# Domain ownership and connection

## Implemented ownership stage

Customers ask Chat to list domains, prepare an ownership proof for a hostname and project, or check a saved proof. Dashboard → Domains exposes the existing deterministic controls. Preparation creates a random 256-bit TXT proof at `_whumpo.HOSTNAME`. Creation, renewal, verification status, activity and Chat receipts commit under the conversation revision. Retry of a saved message does not repeat the DNS request. Proofs expire after seven days; renewal rotates the token and clears verification.

Current source accepts natural-language messages and closed, typed review controls. Internal domain dispatch strings are private implementation details. Dated deployment evidence below records earlier interfaces; it does not define a supported command interface. The current identity/schema cutover remains pending under [WH-114C](https://github.com/zemdregon/whumpo/issues/72).

Hostname inputs are lowercase ASCII DNS names (IDNs must use their ASCII form), with no URL, path, port, credentials, wildcard, IP address or platform hostname. Proof names fit the DNS name limit. Ownership of the project is checked before producing instructions or querying DNS. Different accounts may prepare independent proofs for the same hostname: a pending request cannot reserve someone else's domain globally.

The fixed Cloudflare DNS-over-HTTPS resolver receives only the proof record name, never a customer-controlled request URL. Responses are bounded to 32 KiB with a five-second timeout and no redirect following. Verification requires an exact TXT value at the exact requested owner name. NXDOMAIN or a wrong proof does not verify ownership. Resolver errors remain retryable failures. Checking a missing proof clears the prior verified state. A future connection must recheck the current proof immediately before provisioning; historical verification is not durable routing authority.

Limits are three claims per project, ten per account and eighty across this test platform, enforced atomically before insert. Unused claims can be removed through the reviewed flow below. Claims referenced by hosting or Cloudflare DNS history remain retained for recovery. These claims do not create provider custom hostnames, reserve registrations, change DNS, issue certificates, publish sites or consume AI units.

## Hosting activation remains pending

Cloudflare documents 100 included custom hostnames on Free, Pro and Business plans. The September 30 management-token preflight confirms that whumpo.site has no allocated SaaS hostname quota and no fallback-origin feature access; this is not resolved merely by replacing Wrangler's OAuth credential. Operator feature enrollment, a zone-scoped SSL and Certificates Edit runtime token and verified fallback routing are required before provider provisioning can be accepted. See the [live activation preflight](integrations/domain-hosting.md#live-activation-preflight--september-30-2026) for the exact current state and billing review. Do not deploy the interactive Wrangler OAuth credential or broad local management key into a Worker.

Provisioning, checks, disconnect, maintenance, public hostname mapping and reviewed operator reconciliation are implemented in [hosting design](integrations/domain-hosting.md), with activation disabled. Local checks cover exact provider IDs, bounded hostname reservations, certificate/DNS requirements, published-only routing, disconnect and uncertain-outcome recovery. Provider enrollment, origin/Worker routing, actual certificate issuance, real scheduled execution and live recovery acceptance remain outstanding. Ownership verification alone must never display Connected.

Domain purchases remain a separate unfinished integration; the planned [domain purchase contract](domain-purchases.md) (WH-034/WH-192, October 9, 2026) defines quotes, consent, orders and registrar selection without enabling any of them. Stripe sandbox billing does not configure a registrar or authorize a purchase. Customer Cloudflare/GitHub connections retain their own configuration, consent and acceptance gates.

References checked September 29, 2026:
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/
- https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/common-api-calls/

## Natural-language ownership actions

Customers can ask the agent to prepare domain ownership instructions for a named project and hostname, or to check a prepared proof. The server executes the validated domain handlers and supplies their actual receipts. All ten permitted owned claims are discoverable in compact model context; proof tokens are excluded from that metadata. The secondary Domains panel uses the same handlers. Standard assistance has no customer-credit charge. See [workspace agent contract](workspace-agent.md#conversational-domain-ownership).

## Removing unused ownership proofs

Domains → Review proof removal opens the same Chat review that the agent can prepare with `domain.reviewRemoval`. The agent cannot confirm. A ten-minute review identifies the hostname and explains that only Whumpo’s saved proof is removed. Registration, DNS records (including manually added TXT records), hosting and public websites remain unchanged. A new proof for the same hostname can be prepared afterward with a new token.

Confirmation checks current owner authority, the exact token/expiry and the typed `confirm` action with `kind: domainProof` and the review ID inside the database transaction. Renewed proofs and expired reviews fail closed. Hosting and Cloudflare DNS references are rechecked at deletion, including references added after review; their history is retained even for completed or disconnected operations. Chat confirmation, proof removal and activity commit atomically. Retrying cannot remove a replacement proof or duplicate the activity. Project deletion retains its existing separate policy and is not authorized by this feature.

Status: implemented; focused disposable D1 tests cover foreign owners, raw/model deletion rejection, renewal conflicts, hosting/DNS races, replay, simultaneous confirmations, fresh re-addition and no inference. October 2, 2026 UTC revalidation uses the complete current schema and admitted identity scopes. Domain-agent tests also verify proof-token exclusion, validated preparation/checking, renewal, rejected purchase/connect authority and lost-result recovery. [Verification evidence](verification.md) separates these local passes from provider activation and physical-device acceptance.

Deployed September 29, 2026 to test platform `163964e5-5570-4e1e-98a3-1cc29504a642`, with migration 0074. Passed `pnpm check`, `pnpm test:domain-proof-removal`, `pnpm test:domains`, `pnpm build` and diff checks. Live health returned 200, anonymous Domains/Chat returned 401, and deployed frontend JS/CSS matched the tested isolated build. No real customer proof or external DNS record was removed during verification. Natural-language interpretation and physical mobile interaction for this new action remain unverified; the model action allowlist and server guards were checked locally.

## In-place workspace proof controls — September 29, 2026

Domains now prepares, renews and checks ownership proofs without switching to Chat on a normal result. The page shows the server's reply and refreshes its proof list. Hostname entry disables phone auto-capitalization, autocorrection and spellcheck. Controls are disabled while the shared Chat request is running or its initial state is unavailable.

These controls still use the same deterministic, revision-checked Chat command transaction internally, so the result is retained in conversation history. They do not call a second domain mutation service, consume inference, modify provider records, connect hosting or publish a site. The workspace captures its pending request before navigation and finds its reply by that exact request ID. If delivery remains uncertain, it opens Chat's existing same-ID Retry control. Known failures remain visible in the workspace notice; a retry cannot silently replace an unresolved request. Successful Chat requests invalidate cached domain controls without fetching every hidden panel.

Verification: `pnpm check`, `pnpm test:chat-delivery`, `pnpm test:domains`, `pnpm build`, `node tests/frontend-loading.mjs`, and diff checks passed. The isolated release also passed both TypeScript checks, production build and loading-graph check. Domain tests cover ownership, proof validation, unchanged hosting, replay and absence of AI charges; delivery tests cover request-identity recovery. Authenticated browser interaction and physical-phone acceptance of the new in-place controls were not exercised in this increment.

Deployed test platform version `5d276f56-f5a9-43ee-8eed-7904b7b4a79f`. All 18 manifest output files matched the tested release; Domains route HTML loaded, health returned 200, and anonymous domain reads returned 401. Existing pricing was preserved and unrelated account-recovery edits were excluded. No schema or customer DNS changes were made.

## Registrar quote review foundation — September 29, 2026

**Superseded October 9, 2026 (WH-193):** the helper described below was deleted and replaced by the v1 quote and order modules in `src/domain-purchase/`; see the [domain purchase contract](domain-purchases.md#source-implementation-wh-193). This section is the dated record of what was built then.

`src/domain-purchase-quote.ts` now validates a registrar-independent **read-only** purchase review. There is no connected registrar, availability search, payment, order endpoint, registration/renewal dispatch or benefit redemption. Provider selection is awaiting the owner's direction. No registry call or purchase was made for this work.

A trusted registrar adapter must establish the exact canonical domain, owner/project, registration-versus-renewal eligibility, one-year term, USD customer price, fees, taxes, current renewal-price breakdown, premium flag, provider reference, terms version and quote validity. These must be provider-verified/server-priced values, never AI guesses, public domain-search snippets or user-supplied prices. For renewal, `available` means eligible for this owner's renewal operation; it must not be populated using a registration-availability check. Hostname validation does not prove registrability, registry policy compliance or ownership; those remain the adapter's responsibility.

The helper rejects missing/unknown fields, unknown taxes, invalid currency/term, fractional/negative amounts, noncanonical or platform hostnames, foreign owner/project, future/expired quotes and validity periods longer than 15 minutes. Zero tax is permitted only as an explicit input from the trusted adapter. The review includes price/fee/tax components and all-in purchase and current renewal totals. It labels renewal pricing as not guaranteed, auto-renew as off, and purchasing/redemption as disabled. Annual domain eligibility in the plan catalogue remains an estimate: no paid entitlement or domain-benefit slot is consumed by a quote.

A canonical fingerprint binds every quote field, including provider reference, domain, operation, current price, renewal terms and expiry. Reordering object keys preserves identity; changing a term requires a new review. `matchesDomainPurchaseReview` checks that identity, current expiry and the customer's chosen ceiling. It does not make a legal agreement, reserve funds, confer domain ownership or authorize provider dispatch by itself. It is not exposed as a customer API or model tool.

Delivery still requires registrar selection and account terms, authentic quote/availability/renewal adapters, registration contact/privacy/consent handling, authoritative subscription/annual-benefit grants, tax/retail pricing, durable approval and money/benefit reservations, single-dispatch orders, uncertain-result reconciliation, customer ownership/transfer rules, notifications and live acceptance. Minimum deposits, recurring account fees and registrar/registry charges are unknown until a provider/account is chosen and must be reviewed before activation. The existing test build-credit units are not money and cannot fund domain registration.

Verification: `pnpm test:domain-purchase-quote`, `pnpm check`, and diff checks pass. Fixtures cover exact totals, canonical identity, missing fees/terms, owner/project isolation, expiry, all reviewed-field changes, ceiling rejection and caller-mutation isolation. This module has no network, database, purchase or redemption effects and has not been activated on the deployment.

## Domain snapshots directly in Chat — September 30, 2026

`/domains` and the exact phrase “show domains” now stay in the conversation instead of being intercepted by the workspace's navigation shortcuts. “Open my domains” and “connect my domain” still open the existing controls. The server's free guided reply lists only owned claims with ownership state, last verification, proof expiry, saved hosting status and an exact check-or-renew command. It does not repeat TXT proof values. Empty accounts get setup guidance; purchases remain explicitly unavailable.

The heading labels this as a snapshot of saved records, not a fresh DNS/certificate check. Replaying a completed request returns its original snapshot, even after proof renewal. Sending a new request refreshes the saved metadata without contacting DNS, providers or a model. Explicit `/verify-domain` and `/check-hosting` commands retain their separate validation and authorization behavior.

Verification: `pnpm check`, `pnpm test:domains`, `pnpm test:workspace-navigation` and diff checks passed. The isolated release passed both TypeScript projects, `node tools/build.mjs` and `node tests/frontend-loading.mjs`. Disposable D1 tests verify expired/check/renew guidance, omitted proof values, foreign-claim exclusion, no extra DNS reads or AI charge, and unchanged historical replies after renewal. A browser fixture with actual release assets verified one status Chat write followed by navigation to Domains without another write. Its synthetic response does not establish live DNS or hosting. Evidence: `.secrets/domain-chat-browser-evidence.json`, `.secrets/domain-chat-preview.png`.

Deployed September 30, 2026 to test platform `728b0580-8755-4795-a8a6-945a065bed48`. Independent readback verified the active version, all 16 frontend assets matching the tested release, health 200 and anonymous Chat/domains 401. Evidence: `.secrets/domain-chat-release-verification.json`. No migration, purchase, DNS change or hostname provisioning occurred. Authenticated status acceptance used disposable local records.
