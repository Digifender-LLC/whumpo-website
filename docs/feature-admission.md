# Current connection eligibility adapters

**WH-090B / [#64](https://github.com/zemdregon/whumpo/issues/64), October 1, 2026. Source implementation; not deployed.** This implements inclusion at the existing GitHub and Cloudflare owner handlers. The complete principal contract and composed acceptance remain open under WH-114/115, #64 and [#65](https://github.com/zemdregon/whumpo/issues/65).

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

## Identity handoff and remaining acceptance

Current HTTP authentication still uses `currentUser`/`recentSession`; Chat still uses its existing owned durable turn claim. These adapters do not implement the [restricted identity principal](workspace-identity.md), account authority epochs, incomplete-identity admission or new membership roles. User IDs passed to domain functions remain server-owned identity inputs, not accepted client or model authority. Inclusion checks are not proof that a session remains current.

**#64 stays open:** WH-114/115 must supply the shared principal at final admission and provider boundaries, followed by direct/Chat/future-job tests for session/grant revocation, incomplete identity, restricted purpose and membership changes. Do not add an alternative authentication engine here. This is the remaining runtime handoff required before #65's composed test release and before claiming complete WH-090 authorization.

No remote grant, schema application, provider activation, real-money billing or customer publication occurred in this implementation. CSAM, Daybreak and CMS functional testing remain deferred.

## Verification

`tests/feature-admission.mjs` runs actual handlers against disposable SQLite or local D1 (`--d1`). It covers denied tiers through direct/HTTP/Chat paths, exact grants, revoked OAuth activation, atomic start/dispatch races, invalidated provider responses, independent prepare/confirm/dispatch permissions and exact read-only recovery after eligibility loss. `tests/connection-history-ui.mjs` checks the rendered connection panel after disconnection and after lost inclusion.

Existing provider suites retain their original behavioral checks and now seed explicit current Business invoice coverage for success cases. They test provider transport using synthetic credentials/responses; they do not prove real provider acceptance or the future identity protocol. Detailed passing results and any remaining verification are recorded on #64.

### Local results, October 1, 2026

- Feature admission: 32 refusal cases plus positive and recovery journeys passed on SQLite and local D1. The D1 fixture applies the complete current schema to a disposable local database.
- GitHub connection, GitHub backups, backup Chat and all 13 GitHub token-lifecycle cases passed.
- Cloudflare connection, TXT/DNS Chat, CNAME routing and DNS agent suites passed. Two stale text assertions were updated to the current natural-language responses; runtime commands were not restored.
- Connection status Chat, rendered history/eligibility UI and the 728-decision inclusion regression passed.
- Type checks, build, roadmap validation/alignment/render verification and whitespace checks passed.

All provider/model responses in these suites are synthetic. No real provider request, remote grant or deployment was part of this verification. Principal/session-epoch acceptance remains pending as described above.
