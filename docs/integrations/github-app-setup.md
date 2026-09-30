# GitHub App setup for Whumpo

The existing `gh` login belongs to the operator. It is not a customer authorization service and must never be deployed as a shared token. Customer connections require a GitHub App registered by the operator.

Register at https://github.com/settings/apps/new with:

- Name: a unique Whumpo test name.
- Homepage: https://whumpo.com
- Callback: https://whumpo.com/api/connections/github/callback
- User access tokens: expiration enabled (the default eight-hour lifetime).
- Request user authorization during installation: optional; the workspace's Connect button starts authorization.
- Webhook: inactive for this initial connection release.
- Repository permissions: Metadata read (required by GitHub), Contents read/write for the reviewed source-backup feature. No Actions, Workflows, Administration, organization or email permissions.
- Installation audience: any account if inviting external testers; users should select only intended backup repositories during installation.

Connecting alone does not write repositories. The separate source-backup flow lets users select an initialized repository, review an exact saved version and explicitly confirm a commit. See [backup design](github-backups.md). Live consent and commit acceptance remain pending configuration. Do not enable Actions or any paid GitHub feature.

Save the following JSON to ignored `.secrets/github-app.json`, replacing placeholders:

```json
{
  "appId": "NUMERIC_APP_ID",
  "slug": "APP_URL_SLUG",
  "clientId": "CLIENT_ID",
  "clientSecret": "CLIENT_SECRET"
}
```

Keep credentials out of chat. No GitHub App private key is needed: this integration uses the consenting user's expiring access token, which intersects app permissions with that user's access. Cloudflare setup has already installed the shared dedicated connection encryption key. Reuse it; do not generate or install a replacement for GitHub. Retain the existing key securely. Changing it requires disconnecting/re-authorizing stored connections or an explicit migration.

Current callback tokens are encrypted, never returned to the browser/model, and expire after eight hours. Refresh tokens are discarded; users reconnect explicitly after expiry. Disconnect immediately disables local access and queues single-token revocation. GitHub App installation and app authorization are separate: uninstall or revoke the app in GitHub settings to remove the provider-side installation/grant itself.

References checked September 29, 2026:
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-token

## Configuration readiness

Run `pnpm report:connections` with the operator’s existing authorization to inspect deployed secret names and aggregate credential/revocation counts. Exit 0 means required names are present, **not** that credentials or customer consent work; exit 2 identifies incomplete configuration, and exit 1 means the inspection failed. No credentials, identities or ciphertext are printed, and nothing is changed. If encrypted rows exist without the vault key, recover the original key before proceeding. Never generate a replacement to bypass this condition.

Registration and a real customer consent/disconnect check remain required. Current callbacks use only `https://whumpo.com`; do not register the retired domain.

Read-only acceptance on September 29, 2026 (America/Chicago): the live report returned exit 2 with all GitHub/Cloudflare connection secrets absent, zero retained credentials and zero pending revocations for both providers. The focused readiness suite passed missing-name, unvalidated-presence, retained-vault recovery, malformed-inventory, read-only query and source-callback alignment checks. This run did not register applications, activate connections or test real consent.

## Guided first-time setup — September 29, 2026

The operator CLI login is available, but the in-app browser requires a separate GitHub sign-in. Registration has not been completed. [Open the prefilled private-test registration](https://github.com/settings/apps/new?name=Whumpo+test+zemdregon&description=Reviewed+source+backups+for+the+private+Whumpo+test+platform&url=https%3A%2F%2Fwhumpo.com&callback_urls%5B%5D=https%3A%2F%2Fwhumpo.com%2Fapi%2Fconnections%2Fgithub%2Fcallback&request_oauth_on_install=false&public=false&webhook_active=false&contents=write&metadata=read). Review the form before submitting: exact Whumpo callback, expiring user tokens, Contents read/write and Metadata read only, no webhook events and private installation audience. Public availability for external testers remains a later choice. These [GitHub URL parameters](https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-using-url-parameters) prefill the form; they do not create or approve an app themselves.

After placing the four app credentials in the ignored file above, run `pnpm setup:github` to inspect registered app identity and permissions against GitHub, along with live platform readiness. It does not change configuration. Callback and expiring-token settings still need verification in the GitHub registration UI because the app metadata endpoint does not establish those settings.

After that review, `pnpm setup:github --apply` installs only the four GitHub App secrets under the platform deployment lock. It refuses existing GitHub credentials/vault rows or a missing shared encryption key, preserves existing secret names and checks readback. It never creates or rotates the vault key, installs the operator GitHub token, publishes repositories or authorizes a customer. An ambiguous installation must be inspected with `pnpm report:connections`; do not blindly repeat it.

`pnpm test:github-app-setup` covers identity/permission mismatch, invalid credential fields, existing credential refusal and vault-key preservation. Customer consent, selected-repository backup and disconnect remain required after setup.
