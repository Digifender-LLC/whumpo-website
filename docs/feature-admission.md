# Current connection eligibility adapters

**WH-090B / [#64](https://github.com/zemdregon/whumpo/issues/64). Shared identity integration deployed and verified October 2, 2026 (UTC).** Current GitHub/Cloudflare owner handlers compose feature inclusion with the shared workspace principal. [Packet C / #65](https://github.com/zemdregon/whumpo/issues/65) and [feature acceptance](feature-acceptance.md) record composed local and test-platform evidence; future collaboration/provider adapters retain their own delivery gates.

## Current entrypoints

The adapters consume [current feature inclusion](feature-inclusion.md). Business and Business Pro invoice coverage includes these connections; an exact private-test grant can include one operation and scope. Explore, Starter and Creator receive no implicit connection access. Provider credentials, a saved review and the model's action proposal cannot substitute for inclusion.

| Operation | Scope | Shared handlers |
| --- | --- | --- |
| `connect` | Account | OAuth start, one-time callback claim, token exchange and activation for both providers |
| `read` | Account | GitHub installation/repository discovery; Cloudflare authorized-zone discovery |
| `prepare` | Exact owned project | GitHub source-backup review; Cloudflare TXT/CNAME review, including their provider reads |
| `confirm` | Exact owned project | Revalidate an unsent backup or DNS review, including current destination and contents |
| `dispatch` | Exact owned project | Atomic transition to dispatching/sending and the final provider write |

HTTP routes call these domain handlers. Chat's server-owned command/action adapters call the same handlers; model output cannot add a grant or invoke a recovery bypass. The internal command representation is not a user slash-command interface. Existing background processing only cleans up credentials for these providers; no new connection-write job adapter is introduced. Future job/provider adapters must use the same domain boundaries and current principal.

`featurePredicate` is generated from the same current catalogue and invoice-only view as the inclusion resolver. It checks current ownership, invoice intervals or an exact unrevoked preview grant at database execution time. Invalid active coverage cannot fall through to a preview grant. OAuth insertion/claim/activation, review insertion and confirmation claims compose this predicate into the effect's SQL. It does not save or cache an execution permission. Provider credential identity, existing exact review/proof checks and resource ownership remain separate conditions.

Provider calls recheck current credential and inclusion together in one database read after decrypting the token and immediately before transport. Read results are checked again after headers and the bounded body as applicable. An eligibility change during a provider call invalidates its result. Local database checks cannot make an external API request and a local revocation one distributed transaction: an already accepted remote effect may still need reconciliation. No uncertain write is automatically repeated.

## Protected recovery and local access

Local connection status, owned history, supported source downloads and disconnect remain outside the paid-feature gate. No plan transition takes down a published site. GitHub/DNS history and replay recheck project ownership; a previous owner does not inherit protected access after ownership changes.

Recovery access requires an existing owned receipt already in `dispatching`/`uncertain` (GitHub) or `sending`/`uncertain` (DNS), plus a current provider credential. It derives its scope from the stored receipt on every read. There is no `skipEligibility` flag or general provider proxy:

- GitHub may read the recorded repository, its recorded branch head and the exact four source-path tree queries. GraphQL is limited to the shared fixed query with exact repository/path variables and one commit hash. Mutations, unrelated repositories and arbitrary GraphQL are rejected before transport.
- Cloudflare may GET the recorded zone and the exact bounded DNS inventory for the recorded record name. Other zones, names and POST operations are rejected before transport.

Confirmation of an unsent review always follows the normal confirm/dispatch checks. Replaying a terminal receipt is a local historical read. Provider revocation/cleanup remains available after feature loss. Recovering an old effect never issues a new write or grants current access to a different owner.

## Presentation

`/api/connections` now returns explicit account-level `inclusion.connect` and `inclusion.read`, current plan ID and inclusion source alongside configured/connected/expired/revocation state. These are presentation facts; APIs always recheck. A project-scoped grant must still be checked for its exact operation by the domain handler.

Settings and Chat distinguish saved consent from current inclusion. Cached repository discovery is hidden when read inclusion is lost. History, disconnect and uncertain-outcome checks remain available while ordinary connection actions are disabled. Planned providers remain unimplemented, and neither a connection nor an included feature implies provider health, publication or commercial acceptance.

## Current identity admission

HTTP resolves the current `__Host-whumpo_session` with `workspaceIdentity`, then passes one `admitWorkspace` database scope to the domain handlers and Chat. A module-private capability binds account, purpose, session, credential and authority epoch to that database. A copied object, raw database, foreign account or restricted enrollment/recovery grant cannot supply workspace authority.

Every scoped database statement shares its actual transaction with the current identity assertion. The feature predicate additionally checks identity at the local effect admission point. Session revocation, account epoch changes, removed credentials, expired sessions and loss of current feature inclusion stop unsent work. OAuth start also requires a fresh passkey proof; starting a new request cannot refresh an old proof.

Provider access checks the same workspace and current feature/credential before transport and revalidates returned data. If a requested OAuth exchange finishes after session loss, the exact cleanup-custody capability can retain its returned token for revocation. It cannot activate that token or read provider data. Scheduled credential cleanup remains narrowly scoped maintenance and does not obtain an owner workspace capability. The outer HTTP response also fences identity changes after asynchronous work.

[Composed tests](feature-acceptance.md) cover signed enrollment and recovery with Business, Business Pro and exact preview grants, along with held-session, epoch, credential, expiry and commit races. Collaboration roles and new business-job adapters are still planned; their implementing packets must supply current membership and principal evidence. Physical authenticator and human recovery acceptance remain with the identity workstream.

## Verification

`tests/feature-admission.mjs` runs actual handlers against disposable SQLite or local D1 (`--d1`). It covers denied tiers through direct/HTTP/Chat paths, exact grants, revoked OAuth activation, atomic start/dispatch races, invalidated provider responses, independent prepare/confirm/dispatch permissions and exact read-only recovery after eligibility loss. `tests/connection-history-ui.mjs` checks the rendered connection panel after disconnection and after lost inclusion.

Existing provider suites seed explicit current Business invoice coverage and synthetic provider credentials/responses. The inclusion interface suite supplies the full current tier/catalogue/operation matrix; the composed identity suite proves that included connections cannot elevate a restricted or revoked actor. The retention suite exercises real interval expiry and preserved public/private read paths. Exact commands, counts, deployment identifiers, cleanup and limits are in [feature acceptance](feature-acceptance.md).
