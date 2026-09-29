# Optional GitHub connection

## Current delivery

The workspace has a Connected accounts panel, accessible through Details, `/connections`, `connect github` and `disconnect github`. GitHub App authorization, encrypted expiring user-token storage, installation discovery and disconnect/revocation are implemented. Until all operator configuration exists, the Connect button is disabled and API start returns 503. The operator's `gh` credential is never reused.

This release does **not** back up code, bind a project to a repository, create repositories, grant access to the AI, refresh tokens automatically or implement customer Cloudflare authorization. Those capabilities remain required work. A GitHub App must be registered and a real consenting user must complete authorization before this integration can pass live acceptance. Setup is in [github-app-setup.md](github-app-setup.md).

## Authorization boundary

Start requires a recent authenticated Whumpo session and the normal same-origin POST check. A fresh random state and PKCE verifier are created. D1 stores only the state hash, the session-token hash and an encrypted verifier, expiring in ten minutes. Starting again replaces the old flow. The callback must match the current user, session, state and expiry; it atomically claims the flow before any provider exchange. A replay never exchanges the code twice.

The callback URL is fixed to the test workspace origin, independent of incoming host headers or browser-supplied redirect destinations. All provider requests use fixed GitHub hosts, redirects disabled, a ten-second timeout and bounded JSON reads (512 KiB). Codes, secrets and tokens are sent in request bodies/headers, never appended to provider URLs. Callback responses use no-store and no-referrer, then redirect to a fixed workspace route. The browser clears the completion marker. Callback URLs necessarily contain GitHub's one-use code/state; infrastructure request logs must be treated as sensitive operational data.

Only expiring `ghu_` GitHub App user tokens with at most eight hours of validity can become active. OAuth-app or nonexpiring tokens are rejected and queued for revocation, with no assumed expiry for unknown lifetimes. Refresh tokens are discarded. GitHub identity is read from the authenticated `/user` API, not browser input. Only numeric identity, login, connection time and expiry enter ordinary connection records.

## Vault and concurrency

AES-256-GCM uses a dedicated Worker secret, a random 96-bit nonce, and authenticated data including provider, purpose, user ID and record ID. Ciphertexts cannot be moved to another user or substituted between PKCE and token records. Neither ciphertexts nor tokens are returned in API status, chat, site previews or exports. Keep the encryption key separate from the database and preserve it during deployments. A rotation requires an explicit migration or disconnect/re-authorization.

New tokens first enter a revoking state. Only the still-current claimed flow can activate one and atomically update the connection pointer. A disconnect or newer start while provider work is in flight prevents activation. Prior tokens enter the revocation queue on successful replacement. Lost commit acknowledgements are recovered by checking the exact active token ID; no additional provider exchange occurs. Insert failure attempts immediate token revocation and reports an unconfirmed connection. Up to ten retained vault rows per user are enforced in D1; start refuses five unexpired rows to leave headroom for in-flight completion/revocation.

## Disconnect and cleanup

Disconnect first removes pending authorization state, disables all local token access and clears the active pointer atomically. Provider deletion targets a **single token**, so replacing/disconnecting one connection does not deliberately revoke another independently authorized token for the same GitHub account. Failure retains only encrypted revocation work and displays pending status. GitHub app installation and the broader authorization grant can still be removed manually in GitHub settings.

Cleanup removes expired state/tokens and retries up to five queued revocations per invocation. It runs after authorization/disconnect and in the existing daily scheduled handler, independently of photo cleanup. A successful 204 deletion removes the queued row; other responses remain pending until retry or known token expiry. Removing operator configuration disables use but cannot perform remote revocation until it is restored. Account deletion is not yet user-facing; a future deletion flow must disconnect first before cascading away vault rows.

## Installation discovery

The current user's expiring token reads GitHub's installation API. Returned entries are filtered to the configured app ID, unsuspended installations and validated account identifiers. The first 100 installations are checked; truncation is reported explicitly. No API- or model-supplied URL is fetched. A connected identity is not a claim of repository backup capability, and status describes locally stored authorization rather than continuously proving provider acceptance. Revocation at GitHub is detected by subsequent provider calls or expiry.

## Verification

`test:github-connection` uses disposable D1 and controlled provider responses. It covers PKCE challenge/verifier agreement, user/session/state matching, replay, expiry, ciphertext context/key rejection, owner triggers, installation filtering, replacing tokens, cancellation during provider work, immediate local disconnect, failed/retried revocation, rejected nonexpiring/OAuth tokens, redirects, oversized responses and lost-commit recovery. It uses no real GitHub credentials. Browser inspection verifies the disabled deployment state and opening from chat. Real provider consent and token revocation remain unverified until the operator supplies a GitHub App.
