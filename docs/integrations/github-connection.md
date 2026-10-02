# Optional GitHub connection

## Planned plan eligibility — September 30, 2026

GitHub authorization and reviewed repository backups are planned **Business and Business Pro** benefits; Starter and Creator (the accepted new name for Personal; display rollout is WH-089) do not include external account connections. This is a launch-catalogue decision, not current server enforcement: the private Explore preview and existing provider configuration, consent and review gates are unchanged, and real-money subscriptions remain disabled (the authorized sandbox is separately available). Downloadable source export and owner sign-in are separate features with unchanged rules.

Before paid launch, enforce current eligibility when starting/activating authorization and using provider capabilities, including pending and background work. Define expiry/downgrade behavior while preserving status, disconnect/revocation and recovery of uncertain backup operations. Real App setup, consent and backup acceptance remain required. See the [accepted pricing decision](../pricing-and-model-policy.md#accepted-external-connections-decision--september-30-2026); inclusion in a proposed plan does not enable this integration.

## Disconnect and in-flight replies — September 30, 2026

GitHub capabilities now recheck the exact captured user/token identity, active pointer, vault state and expiry after receiving a provider response. If local authorization was disconnected, replaced or expired, the response body is cancelled and the result is refused. Installation discovery uses the same capability and rechecks again after consuming the complete bounded JSON body, preventing an in-flight stream from returning stale installation metadata after disconnect. No additional permissions, refresh tokens or provider endpoints are introduced.

A provider write already dispatched cannot be recalled by disconnect. Its response may now be refused, but the capability never automatically retries it. The existing backup coordinator retains its claimed request and uncertain-outcome recovery rules; disconnect does not establish that a remote commit was undone or never occurred. Customers reconnect and inspect the original backup receipt rather than creating another write request.

Read-only live setup inspection on September 30 confirmed all four customer GitHub App bindings are still absent, the shared vault key is present, and GitHub/Cloudflare vault and revocation counts are zero. Cloudflare OAuth binding names are present but this alone does not validate real consent or provider operations. Customer GitHub authorization remains disabled pending the existing [App setup](github-app-setup.md); the operator CLI login is not reused.

Verification: `pnpm check`, `pnpm test:github-connection` and `pnpm test:github-backups` passed. New disposable-D1 cases cover disconnect before headers, disconnect during streamed JSON, token replacement during lookup, refusal by an already captured capability, stale-body cancellation and one dispatch of a possibly accepted write. Existing backup tests retain exact files, expected-head checks, immutable reviews, concurrent confirmation and lost-response reconciliation. No real GitHub credentials or repository writes were used.

Deployed as test platform `3b13242b-35fc-4d3b-befa-fab0340ac12c`, with the isolated backend TypeScript check passing. Live readback verified the exact active version, health 200 and anonymous Chat/connection/installation requests returning 401. No schema, frontend, customer grant or repository changed. Evidence: `.secrets/github-disconnect-release.json`.

## Current delivery

Connected accounts are available in Settings and through natural-language Chat requests such as “connect my GitHub account” or “disconnect GitHub.” GitHub App authorization, encrypted expiring user-token storage, installation discovery and disconnect/revocation are implemented. Until all operator configuration exists, the Connect button is disabled and API start returns 503. The operator's `gh` credential is never reused.

A separate [reviewed backup flow](github-backups.md) now selects repositories and writes readable source files after explicit confirmation. Creating repositories, persistent automatic project/repository synchronization, AI access, automatic token refresh and customer Cloudflare authorization remain unfinished. A GitHub App must be registered and a real consenting user must complete authorization before this integration can pass live acceptance. Setup is in [github-app-setup.md](github-app-setup.md).

## Authorization boundary

Start requires a recent authenticated Whumpo session and the normal same-origin POST check. A fresh random state and PKCE verifier are created. D1 stores only the state hash, the session-token hash and an encrypted verifier, expiring in ten minutes. Starting again replaces the old flow. The callback must match the current user, session, state and expiry; it atomically claims the flow before any provider exchange. A replay never exchanges the code twice.

The callback URL is fixed to the test workspace origin, independent of incoming host headers or browser-supplied redirect destinations. All provider requests use fixed GitHub hosts, redirects disabled, a ten-second timeout and bounded JSON reads (512 KiB). Codes, secrets and tokens are sent in request bodies/headers, never appended to provider URLs. Callback responses use no-store and no-referrer, then redirect to a fixed workspace route. The browser clears the completion marker. Callback URLs necessarily contain GitHub's one-use code/state; infrastructure request logs must be treated as sensitive operational data.

Only expiring `ghu_` GitHub App user tokens with at most eight hours of validity can become active. OAuth-app or nonexpiring tokens are rejected and queued for revocation, with no assumed expiry for unknown lifetimes. Refresh tokens are discarded. GitHub identity is read from the authenticated `/user` API, not browser input. Only numeric identity, login, connection time and expiry enter ordinary connection records.

## Vault and concurrency

AES-256-GCM uses a dedicated Worker secret, a random 96-bit nonce, and authenticated data including provider, purpose, user ID and record ID. Ciphertexts cannot be moved to another user or substituted between PKCE and token records. Neither ciphertexts nor tokens are returned in API status, chat, site previews or exports. Keep the encryption key separate from the database and preserve it during deployments. The [current source keyring/envelope](../connection-key-lifecycle.md) authenticates key IDs and rejects the old encoding. Fenced rotation and candidate cutover are still required; do not rotate deployed keys or use reconnect as proof that an earlier provider token was revoked.

New encrypted tokens and a separate one-minute staging lease are saved in one transaction. The vault row uses the existing `active` storage value but grants no capability until the connection pointer is admitted: every capability requires the owner, exact pointer, state and expiry. Only the still-current claimed flow/session and an unexpired staging lease/token can update that pointer. The same transaction then retires the previous usable token and removes the staging record. A disconnect, newer flow, expired lease or missing token prevents activation and preserves any prior connection. Staged tokens never enter ordinary revocation work while validation still holds its lease. Lost commit acknowledgements are recovered by checking the exact active token ID; no additional provider exchange occurs. Insert failure attempts immediate token revocation and reports an unconfirmed connection. Up to ten retained vault rows per user are enforced in D1; start refuses five unexpired rows to leave headroom for in-flight completion/revocation.

## Disconnect and cleanup

Disconnect first removes pending authorization state, disables all local token access and clears the active pointer atomically. Provider deletion targets a **single token**, so replacing/disconnecting one connection does not deliberately revoke another independently authorized token for the same GitHub account. Failure retains only encrypted revocation work and displays pending status. GitHub app installation and the broader authorization grant can still be removed manually in GitHub settings.

Cleanup removes expired state/tokens, queues abandoned/expired staging records and retries up to five queued revocations per invocation. Authorization/disconnect cleanup is restricted to that owner; only the existing scheduled pass scans all owners. Each revocation requires an atomic one-minute claim, rechecked before provider dispatch and successful deletion. Concurrent cleaners skip a held claim. A definitive failed response releases only that claim; an interrupted attempt retains its claim until expiry, after which a later pass can retry the same single-token deletion. A late acknowledgment cannot settle a replacement claim. Cleanup runs independently of photo cleanup. A successful 204 deletion removes the queued row; other responses remain pending until retry or known token expiry. Removing operator configuration disables use but cannot perform remote revocation until it is restored. Account deletion is not yet user-facing; a future deletion flow must disconnect first before cascading away vault rows.

## Installation discovery

The current user's expiring token reads GitHub's installation API. Returned entries are filtered to the configured app ID, unsuspended installations and validated account identifiers. The first 100 installations are checked; truncation is reported explicitly. No API- or model-supplied URL is fetched. A connected identity is not a claim of repository backup capability, and status describes locally stored authorization rather than continuously proving provider acceptance. Revocation at GitHub is detected by subsequent provider calls or expiry.

## Verification

`test:github-connection` uses disposable D1 and controlled provider responses. It covers PKCE challenge/verifier agreement, user/session/state matching, replay, expiry, ciphertext context/key rejection, owner triggers, installation filtering, replacing tokens, cancellation during provider work, immediate local disconnect, failed/retried revocation, rejected nonexpiring/OAuth tokens, redirects, oversized responses and lost-commit recovery. It uses no real GitHub credentials. Browser inspection verifies the disabled deployment state and opening from chat. Real provider consent and token revocation remain unverified until the operator supplies a GitHub App.


## Staging isolation and cleanup claims — October 1, 2026

WH-004/A2 was reproduced against `858845e`: disconnecting one synthetic owner or running scheduled cleanup during another token's identity lookup revoked the pending token; a missing replacement retired the old connection; concurrent cleanup dispatched duplicate revocations. The corrected lifecycle uses migration **0115**, which adds `github_token_staging` and `github_revocation_claims` as metadata children of the unchanged vault. Cascading token deletion removes both records. The existing ten-token quota counts staged credentials too; start still leaves headroom at five retained tokens. Neither metadata table contains a plaintext credential. Operator maintenance reports include expired staging, and account-closure inventory counts staged credentials separately while retaining the full vault total.

The migration is additive: no existing table, trigger, encrypted value, grant or connection pointer is rewritten. Old Workers continue using the unchanged vault and connection contract; new staging rows have no pointer and cannot be used by either version. Old scheduled code may leave staging metadata for the new cleanup pass, so full lifecycle acceptance requires the new platform version. All other Workers, service contracts, bindings, routes and schedules remain unchanged. No new resource, permission or recurring minimum is introduced. Customer GitHub App configuration and real consent/backup/revocation acceptance remain separate activation gates.

Provider contract checked October 1, 2026: GitHub's [single-token deletion](https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-token) retains the existing 204 success rule; no whole-grant revocation or new provider endpoint is introduced. Local atomic admission uses a [D1 batch transaction](https://developers.cloudflare.com/d1/worker-api/d1-database/). A claim bounds concurrent local dispatch; provider calls are not an exactly-once guarantee, and an uncertain deletion can be retried only for the same permanently retired token.

Local acceptance passed: all **13** cases in `tests/github-token-lifecycle.mjs`, existing `github-connection.mjs` and `github-backups.mjs`, plus `maintenance-inventory.mjs` and `account-closure-inventory.mjs`. The expanded regression covers cross-owner/scheduled cleanup during validation, absent/expired/superseded replacement, no capability from staging, concurrent claims, rollback of retirement/staging failures and late acknowledgments after claim takeover. Fixtures use Node 24, allowlisted environments, temporary homes, disposable D1/SQLite and synthetic providers. Both TypeScript projects and the build passed via `pnpm --config.verify-deps-before-run=false run check` / `run build`; roadmap validation/render and whitespace checks passed. No real GitHub credential or repository operation was used.

Read-only live inspection at **2026-10-01T14:01:06.784Z** confirmed all four GitHub App binding names absent, zero retained GitHub credentials and zero queued revocations. The shared vault key remains present. This is configuration evidence only; customer connection activation is not part of A2 remediation.


### A2 test release

[PR #35](https://github.com/zemdregon/whumpo/pull/35) merged as `514c438538c227469605457dd7aaa0744b74b1d1`. Managed release `6116b6b5-f398-437c-b947-32376e75e629` archives implementation source `e07394657ca4779d2f78a95a03299c583bd5f826` and migration 0115, SHA-256 `bba1ae5a3d940ff6288d03eae32b9d7b82801089b91c0b165dd4908a11b973dc`. The compatibility review above was bound to the exact build/SQL. All five migration/Worker steps completed without repair/retry.

| Worker | Verified version |
| --- | --- |
| runtime | `37cefe92-3aa1-4ca1-be43-a7613b19586f` |
| apps | `c905f029-7a14-4363-af85-bc6b68b4f13f` |
| sites | `69d43a75-d4e8-4c3c-80b9-2e483699dd2b` |
| platform | `7bffe3ef-16a5-4ef6-b5ff-5e599ffd1045` |

Independent readback at **2026-10-01T14:07:26.091Z** confirmed all four candidate versions/tags, unchanged service/secret-binding names and CMS registry, **115 applied migrations** with none pending, all 16 exact frontend assets and workspace HTML. Both metadata table column sets, cascading foreign keys and the staging-expiry index match. All 28 maintenance backlog queries are available; staged credential count is zero in maintenance and closure inventory. GitHub App binding names remain absent and the vault is empty, so no customer grant was created or revoked.

Home/workspace/health returned 200; anonymous connection/installation/start/disconnect requests returned 401 and foreign-Origin start/disconnect returned 403. Stripe remains in test mode. Private evidence: `.secrets/github-lifecycle-release-verification.json` and the immutable release archive. The dirty archive flag comprises only the shared dependency symlink and inspected generated visitor dependency-path comments; source was committed and those generated comment differences were restored afterward. This accepts deployed schema/code and entry boundaries, not real GitHub consent, repository writes or remote revocation. No CMS functional test, scanner or new paid service was activated.
