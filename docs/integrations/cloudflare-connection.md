# Customer Cloudflare authorization

## Delivered boundary

Customers can open Connected accounts from Details, `/connections`, “connect cloudflare” or “disconnect cloudflare”. The implemented OAuth Authorization Code flow uses a confidential client, S256 PKCE, a ten-minute state bound to the current TellUmo session, and an exact callback URL. A recent login and matching Origin are required to start. Codes can be exchanged once. Cancellation, a different session/user, expired state and replay cannot authorize access.

This release can connect/disconnect and list authorized zones, fifty per page. It requests `zone.read`, `dns.read`, and `dns.write` for the intended reviewed DNS workflow. **DNS writes are not yet implemented or enabled.** Connection alone changes no records and does not connect a domain to hosting. A valid access token is not proof that all domains in an account are authorized; each subsequent resource API operation must respect provider authorization and local ownership/review checks. No registrar or purchase scopes are requested.

Cloudflare OAuth is documented as available on Free plans. Current OAuth scope identifiers were read from the provider's `/oauth/scopes` endpoint. OAuth-client management returned 403 with the operator's existing Wrangler authorization; no client was created and no customer consent was performed. Deployment therefore remains disabled until the operator supplies a registered client and the connection vault key. No user token or Wrangler credential is deployed as an alternative.

## Credentials and concurrency

Tokens are AES-256-GCM encrypted under the existing separate `CONNECTION_ENCRYPTION_KEY`. Authenticated encryption binds provider, user, record ID and purpose. Plaintext/ciphertext never enters chat, ordinary API status, exports or logging. Provider hosts and paths are fixed, requests do not follow redirects, responses are bounded at 256 KiB, and individual provider calls time out after ten seconds.

Only Bearer tokens with positive, explicit lifetimes of at most eight hours and exactly the requested scopes can become active. RFC 6749 permits omitted response scope to mean the original scope; an explicit missing or broader grant is rejected. No offline/refresh access is requested. Unexpected refresh tokens are retained only as encrypted revocation work and rejected for activation. Invalid token envelopes report that the user should revoke the application in Cloudflare. Token expiry is derived from the provider response; this is not an assertion about Cloudflare's default lifetime.

New credentials enter a staged state that maintenance cannot immediately revoke. Activation checks the still-current, claimed, uncancelled flow atomically. Disconnect marks pending flows cancelled and immediately disables staged/active local access. A callback already in progress may still receive a credential, but cannot activate after cancellation. It queues that credential for revocation. Unfinished staged rows older than two minutes become revocation work. Lost storage/activation acknowledgements recover using the exact server-generated token ID without another code exchange.

There is one active token per TellUmo user. Connecting while any unexpired token exists is refused: disconnect and finish revocation first. Claimed authorization flows also block replacement until completion or ten-minute expiry. This avoids overlapping replacement grants while old credentials are being revoked. Unclaimed flows can be superseded; their old callbacks fail. The vault has a database-enforced ten-row per-user cap.

## Disconnect and maintenance

Disconnect disables local access before contacting Cloudflare. The RFC 7009 revocation endpoint is called with the exact stored token and token-type hint. Only HTTP 200 acknowledges revocation. Failure retains encrypted work; the UI reports pending revocation and links the user conceptually to Cloudflare settings for manual removal. It does not claim remote revocation succeeded. Daily cleanup retries up to five rows. A two-minute lease and attempt ID prevent simultaneous cleanup calls from duplicating revocation or deleting a newer attempt's record. Expired access-only rows can be dropped; unexpected refresh/nonexpiring credentials remain queued until revocation succeeds.

Locally stored connection status is not a continuous provider-side validation. Zone reads recheck local access after the provider response, so a disconnect during that read rejects stale results. The panel still exposes disconnect if a provider zone read fails. A request already sent to the provider cannot be recalled by local disconnect. User-facing account deletion remains pending and must drain revocation work before removing vault rows.

## Acceptance and remaining work

`test:cloudflare-connection` uses disposable D1 and controlled responses for PKCE, binding/replay, encryption isolation, scope/lifetime validation, malformed and redirected responses, cancellation and disconnect races, staged-token cleanup, leased revocation, lost activation acknowledgement and zone filtering/pagination. This is not live provider consent or DNS-change acceptance.

Still needed: registered client and consenting real tester; real token/zone/revocation acceptance; reviewed exact-record DNS creation/update/removal with conflict and uncertain-outcome recovery; linking a selected authorized zone to an owned project/domain claim; domain setup through the customer's own account; final-domain OAuth migration. Domain purchases remain a separate unfinished requirement. Public client promotion is irreversible and requires verified publisher-domain ownership, so private test setup is the first step.

## Operator setup

In Cloudflare → Manage Account → OAuth clients, register a **private** test client:

- Client name: TellUmo test (placeholder).
- Client URL: `https://digifender.com`.
- Grant type: Authorization Code; response type: code.
- Token authentication: `client_secret_basic`.
- Redirect URI: `https://digifender.com/api/connections/cloudflare/callback`.
- Required scopes: `zone.read`, `dns.read`, `dns.write`.
- No offline/refresh, registrar, billing, Workers or account-administration permissions.

Save the client credentials to ignored `.secrets/cloudflare-oauth.json`, keeping secrets out of chat:

```json
{"clientId":"CLIENT_ID","clientSecret":"CLIENT_SECRET"}
```

Install them as Worker secrets `CLOUDFLARE_CLIENT_ID` and `CLOUDFLARE_CLIENT_SECRET` only after validation. Generate the dedicated 256-bit vault key once if absent; reuse and securely retain an existing key. Do not rotate it casually: encrypted GitHub and Cloudflare connections depend on it. Customer consent takes place on Cloudflare, not in chat. Private clients accept only members of the parent account. External-account testers require a later public-client review and publisher-domain verification; no public promotion has been performed.

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
