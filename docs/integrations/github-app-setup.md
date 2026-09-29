# GitHub App setup for Whumpo

The existing `gh` login belongs to the operator. It is not a customer authorization service and must never be deployed as a shared token. Customer connections require a GitHub App registered by the operator.

Register at https://github.com/settings/apps/new with:

- Name: a unique Whumpo test name (placeholder brand).
- Homepage: https://digifender.com
- Callback: https://digifender.com/api/connections/github/callback
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

Keep credentials out of chat. No GitHub App private key is needed: this integration uses the consenting user's expiring access token, which intersects app permissions with that user's access. The operator will install the values as Worker secrets and separately generate a dedicated 256-bit connection encryption key. Retain that key securely; changing it requires disconnecting/re-authorizing stored connections or an explicit migration.

Current callback tokens are encrypted, never returned to the browser/model, and expire after eight hours. Refresh tokens are discarded; users reconnect explicitly after expiry. Disconnect immediately disables local access and queues single-token revocation. GitHub App installation and app authorization are separate: uninstall or revoke the app in GitHub settings to remove the provider-side installation/grant itself.

References checked September 29, 2026:
- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app
- https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-token
