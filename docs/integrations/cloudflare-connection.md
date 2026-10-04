# Customer Cloudflare authorization

## Common connector contract — October 4, 2026 UTC

Cloudflare is mapped onto the planned [common bounded connector contract](../connectors.md) (WH-140), with its exact gaps listed there. That mapping changes no current behaviour, scope or endpoint; WH-141/142 adapt the handlers.

## Planned plan eligibility — September 30, 2026

Customer Cloudflare OAuth and its reviewed DNS operations are planned **Business and Business Pro** benefits; Starter and Creator (the accepted new name for Personal; display rollout is WH-089) do not include external account connections. This is a launch-catalogue decision, not current server enforcement: the private Explore preview and existing provider configuration, consent and exact DNS reviews are unchanged, and real-money subscriptions remain disabled (the authorized sandbox is separately available). Ordinary custom-domain eligibility, manual DNS instructions and annual domain benefits keep their separate existing rules. Hosting on Whumpo does not require a customer Cloudflare account connection.

Before paid launch, enforce current eligibility when starting/activating authorization and using provider capabilities, including pending and background work. Define expiry/downgrade behavior while preserving status, disconnect/revocation and recovery of uncertain DNS operations. Real customer consent, scoped resources, DNS and revocation acceptance remain required; configured bindings alone do not meet these gates. See the [accepted pricing decision](../pricing-and-model-policy.md#accepted-external-connections-decision--september-30-2026). This policy change neither provisions customer infrastructure nor authorizes DNS changes or provider charges.

## Delivered boundary

Customers can open Connected accounts from Details, `/connections`, “connect cloudflare” or “disconnect cloudflare”. The implemented OAuth Authorization Code flow uses a confidential client, S256 PKCE, a ten-minute state bound to the current Whumpo session, and an exact callback URL. A recent login and matching Origin are required to start. Codes can be exchanged once. Cancellation, a different session/user, expired state and replay cannot authorize access.

This release can connect/disconnect and list authorized zones, fifty per page. It requests `zone.read`, `dns.read`, and `dns.write` for the intended reviewed DNS workflow. Reviewed ownership TXT creation and fixed-target routing CNAME creation are implemented separately in [DNS controls](cloudflare-dns.md); general DNS editing remains unfinished. Connection alone changes no records and does not connect a domain to hosting. A valid access token is not proof that all domains in an account are authorized; each subsequent resource API operation must respect provider authorization and local ownership/review checks. No registrar or purchase scopes are requested.

Cloudflare OAuth is documented as available on Free plans. Current OAuth scope identifiers were read from the provider's `/oauth/scopes` endpoint. The earlier Wrangler-only attempt returned 403. The owner-supplied API token subsequently enabled private client registration and vault configuration, as recorded below. Real customer consent remains unverified. No operator token is deployed as a substitute for customer authorization.

## Credentials and concurrency

Tokens are AES-256-GCM encrypted in current source under the separate `CONNECTION_ENCRYPTION_KEYRING`; see [current format and pending rotation/cutover](../connection-key-lifecycle.md). Authenticated encryption binds provider, user, record ID and purpose. Plaintext/ciphertext never enters chat, ordinary API status, exports or logging. Provider hosts and paths are fixed, requests do not follow redirects, responses are bounded at 256 KiB, and individual provider calls time out after ten seconds.

Only Bearer tokens with positive, explicit lifetimes of at most eight hours and exactly the requested scopes can become active. RFC 6749 permits omitted response scope to mean the original scope; an explicit missing or broader grant is rejected. No offline/refresh access is requested. Unexpected refresh tokens are retained only as encrypted revocation work and rejected for activation. Invalid token envelopes report that the user should revoke the application in Cloudflare. Token expiry is derived from the provider response; this is not an assertion about Cloudflare's default lifetime.

New credentials enter a staged state that maintenance cannot immediately revoke. Activation checks the still-current, claimed, uncancelled flow atomically. Disconnect marks pending flows cancelled and immediately disables staged/active local access. A callback already in progress may still receive a credential, but cannot activate after cancellation. It queues that credential for revocation. Unfinished staged rows older than two minutes become revocation work. Lost storage/activation acknowledgements recover using the exact server-generated token ID without another code exchange.

There is one active token per Whumpo user. Connecting while any unexpired token exists is refused: disconnect and finish revocation first. Claimed authorization flows also block replacement until completion or ten-minute expiry. This avoids overlapping replacement grants while old credentials are being revoked. Unclaimed flows can be superseded; their old callbacks fail. The vault has a database-enforced ten-row per-user cap.

## Disconnect and maintenance

Disconnect disables local access before contacting Cloudflare. The RFC 7009 revocation endpoint is called with the exact stored token and token-type hint. Only HTTP 200 acknowledges revocation. Failure retains encrypted work; the UI reports pending revocation and links the user conceptually to Cloudflare settings for manual removal. It does not claim remote revocation succeeded. Daily cleanup retries up to five rows. A two-minute lease and attempt ID prevent simultaneous cleanup calls from duplicating revocation or deleting a newer attempt's record. Expired access-only rows can be dropped; unexpected refresh/nonexpiring credentials remain queued until revocation succeeds.

Locally stored connection status is not a continuous provider-side validation. Zone reads recheck local access after the provider response, so a disconnect during that read rejects stale results. The panel still exposes disconnect if a provider zone read fails. A request already sent to the provider cannot be recalled by local disconnect. User-facing account deletion remains pending and must drain revocation work before removing vault rows.

## Acceptance and remaining work

`test:cloudflare-connection` uses disposable D1 and controlled responses for PKCE, binding/replay, encryption isolation, scope/lifetime validation, malformed and redirected responses, cancellation and disconnect races, staged-token cleanup, leased revocation, lost activation acknowledgement and zone filtering/pagination. This is not live provider consent or DNS-change acceptance.

Still needed: registered client and consenting real tester; real token/zone/revocation acceptance; real reviewed TXT/CNAME creation acceptance; exact-record update/removal; domain setup through the customer's own account; registered Whumpo callback verification. Domain purchases remain a separate unfinished requirement. Public client promotion is irreversible and requires verified publisher-domain ownership, so private test setup is the first step.

## Operator setup

In Cloudflare → Manage Account → OAuth clients, register a **private** test client:

- Client name: Whumpo test.
- Client URL: `https://whumpo.com`.
- Grant type: Authorization Code; response type: code.
- Token authentication: `client_secret_basic`.
- Redirect URI: `https://whumpo.com/api/connections/cloudflare/callback`.
- Required scopes: `zone.read`, `dns.read`, `dns.write`.
- No offline/refresh, registrar, billing, Workers or account-administration permissions.

Save the client credentials to ignored `.secrets/cloudflare-oauth.json`, keeping secrets out of chat:

```json
{"clientId":"CLIENT_ID","clientSecret":"CLIENT_SECRET"}
```

Install them as Worker secrets `CLOUDFLARE_CLIENT_ID` and `CLOUDFLARE_CLIENT_SECRET` only after validation. The current keyring/ciphertext format must be installed only through the coordinated WH-117 candidate cutover. Securely retain required key versions; a replacement key cannot decrypt prior ciphertext or prove old remote tokens were revoked. Do not change active material outside the reviewed rotation/custody flow. Customer consent takes place on Cloudflare, not in chat. Private clients accept only members of the parent account. External-account testers require a later public-client review and publisher-domain verification; no public promotion has been performed.

Sources checked September 29, 2026:

- https://developers.cloudflare.com/fundamentals/oauth/
- https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/
- https://developers.cloudflare.com/fundamentals/oauth/integrate-with-cloudflare/
- https://dash.cloudflare.com/.well-known/openid-configuration
- https://api.cloudflare.com/client/v4/oauth/scopes
- https://www.rfc-editor.org/rfc/rfc6749#section-5.1
- https://www.rfc-editor.org/rfc/rfc7009

## Deployment evidence — September 29, 2026

Migration 0022 applied locally and remotely before the Workers deployed. Main version `e62105fd-a60d-4d1c-bdff-dc2e48c02748`; public version `4ea34b3a-4fba-451a-b1b5-5cd59587f2a4`. TypeScript, the Cloudflare OAuth suite (including expiry reconnect, unexpected refresh rejection and HTTP route gates), and the GitHub authorization regression passed. A local UI fixture verified opening from chat, retaining disconnect controls after a zone-read failure, and rendering the disconnected state.

A temporary production passkey account verified disabled Cloudflare status, 503 for unconfigured start/zone requests, anonymous 401, cross-origin 403, the fixed no-referrer callback redirect, idempotent local disconnect and zero AI usage. It was removed after the check. No real customer authorization, revocation, DNS change, OAuth client creation or new service activation was tested or performed. Callback URLs necessarily contain a one-use code and state; infrastructure request logs must be treated as sensitive operational data even though application errors omit provider bodies.

## Configuration readiness

Run `pnpm report:connections` with the operator’s existing authorization to inspect deployed secret names and aggregate credential/revocation counts. Exit 0 means required names are present, **not** that credentials or customer consent work; exit 2 identifies incomplete configuration, and exit 1 means the inspection failed. No credentials, identities or ciphertext are printed, and nothing is changed. If encrypted rows exist without the vault key, recover the original key before proceeding. Never generate a replacement to bypass this condition.

Registration and a real customer consent/disconnect check remain required. Current callbacks use only `https://whumpo.com`; do not register the retired domain.

## Private client configured — September 29, 2026

The owner-supplied API token successfully listed OAuth clients (HTTP 200, empty inventory), superseding the earlier Wrangler-only 403 limitation. Created one private `Whumpo test` client and read back its exact Whumpo URL/callback, Authorization Code grant, code response, client_secret_basic authentication and zone.read/dns.read/dns.write scopes. No refresh grant, public promotion or customer permission grant was added. See [Cloudflare client creation](https://developers.cloudflare.com/fundamentals/oauth/create-an-oauth-client/) and [API contract](https://developers.cloudflare.com/api/resources/iam/subresources/oauth_clients/methods/create/). Private clients accept only members of the parent account.

Saved credentials in ignored owner-readable `.secrets/cloudflare-oauth.json`. After verifying both customer credential vaults were empty and no deployed vault key existed, generated a dedicated key in `.secrets/connection-encryption.key`. Preserve this key for recovery; never casually rotate it. Installed the two client secrets and vault key under the platform deployment lock, preserving all existing secret names. Configuration-only Worker version: `e7790a80-a69a-4c6a-8c34-a1be31b6816d`. Secret values were not printed or placed in model context.

A temporary live test account verified enabled/disconnected status, exact PKCE authorization URL and callback, cross-origin start denial, cancellation with a no-store/no-referrer redirect, cancelled-state persistence and zero issued credentials. The test account was removed and absence checked. No real provider login, consent, token exchange, DNS change or AI call occurred. Real consent, zone access and revocation remain open; the owner has been asked to connect through Settings → External connections.

The workspace now recognizes the server’s `connection_error` marker, reports cancellation/failure without echoing provider query data, refreshes connection/billing status, and removes callback query parameters when opening the corresponding fixed workspace page. Checkout return also avoids claiming payment success from a URL. Passed `pnpm check`, `node tests/provider-return.mjs`, isolated frontend type checking and production build.

Return-flow fix deployed as `233afcd4-59f6-4345-84f4-bb963c667458`. Readback verified that the Cloudflare client/vault secret names survived deployment, live JS/CSS matched the tested build, health returned 200 and anonymous connections returned 401. Real credential exchange and customer consent remain distinct open checks.

## Connection status and reconnect guidance — September 30, 2026

The owner-only status read can distinguish retained expired authorization from a never-connected account. It reads timestamps and state only, never token ciphertext or the provider. Expired authorization keeps `connected` and `dnsChangesEnabled` false. Cleanup may remove expired metadata; after that the status is simply disconnected, without inventing a reason. Chat labels its saved snapshot and reports expiry and pending cleanup; `/connections` refreshes it without inference.

External connections explains that active Cloudflare access must be disconnected before switching accounts. Its Connect button is unavailable while that connection or provider revocation is active, matching the existing server admission rule. Disconnect/revocation and a new provider consent remain explicit user actions. A pending authorization not represented by those two states can still be refused by the server; its bounded-expiry message remains authoritative.

GitHub continues to permit reviewed reconnection. When a prior GitHub token is awaiting cleanup while the new connection is active, Settings and Chat accurately preserve the current connected state. Provider status remains a local authorization snapshot, not a live account-health test. No new scope, credential handling, automatic reconnection or DNS mutation is introduced.

Verification: both TypeScript projects, the production build and the disposable-D1 Cloudflare OAuth suite passed. Connection Chat tests cover owner isolation, no credential/provider disclosure, retained expired authorization, active connection plus old revocation, immutable historical replies and refreshed zero-inference status. Live customer consent remains a separate setup/acceptance gate.

Deployed September 30 as platform `4712f560-b629-4860-b0a0-fe30eae0953e`. Independent live checks confirm the version, all 16 frontend JS/CSS/font assets, health 200 and anonymous connections 401. This verifies release/configuration boundaries, not a customer provider consent flow.
