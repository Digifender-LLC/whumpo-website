# Current feature eligibility acceptance

WH-090B / [#64](https://github.com/zemdregon/whumpo/issues/64), WH-090C / [#65](https://github.com/zemdregon/whumpo/issues/65). Evidence recorded October 2, 2026 (UTC).

**Reusable handoff:** WH-122 maps the already completed #65 packet. Feature implementers depend on that foundation; parent WH-090/#62 retains cumulative adapter acceptance. See the [October 2 dependency alignment](roadmap/alignment.md#completed-foundations-versus-cumulative-acceptance--october-2-2026-utc). This names the existing deliverable and does not expand its verification scope.

## Accepted scope

The current owner GitHub and Cloudflare operations combine the deployed workspace identity boundary with invoice-derived inclusion or an exact operator preview grant. Inclusion cannot elevate enrollment/recovery, forge a workspace principal, preserve a revoked session, replace provider consent or authorize an unreviewed effect. Local history, supported source downloads, disconnect and exact uncertain-effect readback retain their own ownership/identity checks after feature loss. Existing published sites remain served.

This packet covers implemented owner paths and provider credential cleanup. Business Pro collaboration, new providers and business-job adapters remain planned and must implement the same contract with their own actor/resource/role evidence. Parent [#62](https://github.com/zemdregon/whumpo/issues/62) retains the broader product acceptance, including future collaboration; these local/provider packets do not establish commercial readiness.

## Requirement-to-evidence map

All commands below ran against this candidate's current code and complete schema. `--d1` means a disposable local Cloudflare D1 fixture, without remote bindings or live provider credentials.

| Requirement | Verified evidence |
| --- | --- |
| Current cumulative tiers, feature IDs, operations and scopes; invoice intervals and exact previews | `node tests/feature-inclusion.mjs --d1`: 728 decisions plus annual/overlapping/future coverage, foreign scopes, expiry/revocation, immutable grants, concurrent/lost acknowledgement and operator destination review. |
| Included access cannot elevate restricted actors | `node tests/feature-identity.mjs` and `node tests/feature-identity.mjs --d1`: 434 checks each. Actual signed HTTP enrollment/recovery with Business, Business Pro and operator preview grants; both providers, account/project scopes and all five operations. |
| Current actor authority at the commit boundary | The same composed suite verifies cloned/foreign-database capabilities, wrong account, restricted tokens placed in ordinary cookies, revoked sessions, changed account epoch, removed credentials, expired sessions, aged passkey proof and revocation at actual OAuth-state commit. Recovery securing invalidates the previously held ordinary session. |
| OAuth and provider races; exact review/confirmation/dispatch | `node tests/feature-admission.mjs --d1`: 37 refusal cases plus positive HTTP/Chat/OAuth journeys, revoked activation and provider responses, atomic local admission, independent prepare/confirm/dispatch grants and source-backup/TXT review flows. |
| Uncertain effects cannot be resent or expanded into general provider access | That suite verifies one uncertain GitHub commit and one uncertain DNS write, followed by bounded read-only reconciliation after eligibility loss. Wrong repository, path/query, zone, method, receipt or owner is rejected; no duplicate provider write. |
| Background processing cannot inherit lost owner access | That suite revokes a session during each provider's token exchange. Returned credentials retain only exact revocation custody. Actual cleanup handlers remove them with one synthetic revoke request; they perform no identity discovery or activation. No general owner-write job adapter exists yet. |
| Real interval expiry preserves exit and publication paths | `node tests/feature-retention.mjs` and `node tests/feature-retention.mjs --d1`: actual elapsed invoice and preview expiry refuse new OAuth and pending callbacks. Existing published HTML and source ZIP bytes stay identical; history/disconnect remain available. Foreign and revoked owners cannot download private source. No real customer site was published. |
| Inclusion, configuration and consent stay distinct | Composed identity tests verify included but unconfigured versus included/configured/unconnected states. `node tests/connection-history-ui.mjs` verified rendered history and uncertainty controls, hidden cached discovery and disabled privileged actions after inclusion/connection loss when recorded. **October 8 re-run: this suite now fails on `main` (`ca17c6a`) at its first `Reconnect` button assertion** (`Missing Reconnect`). Cause not diagnosed; `frontend/src/workspace-controls.tsx` contains no `Reconnect` button label. Treat this row's UI evidence as stale until the test or UI is reconciled. The other suites in this table passed on October 8 with the counts shown. |
| Current schema, deployed code/assets and ordinary authentication | Independent test-platform readback described below, plus the [coordinated identity release](identity-web.md). Local signed WebAuthn and live synthetic-key login do not imply physical-device or human Turnstile acceptance. |

Local provider and Turnstile responses are synthetic. No maintenance inference, provider purchase, customer provider activation or real-money charge was made. Standard AI retains its existing zero customer debit policy.

## Test-platform readback

The reviewed candidate is managed release `40e45c39-037a-42da-802c-5eacc75bde77`, executable source `6c73ac5`, with post-cutover documentation/declaration cleanup at `c4f11b5`. This acceptance adds fixtures and documentation, plus a current-schema operator error message; it does not change the deployed application. No redundant deployment or schema replay is required.

Active versions independently checked before the preview probe:

| Worker | Active version |
| --- | --- |
| Platform | `64b7ea36-10bd-4f57-a642-66ea5c9eb826` |
| Runtime | `7c902e8b-287e-4e63-b08a-eacf370eb801` |
| Apps | `4900069c-cc00-44a3-97ee-96f9db4d26aa` |
| Sites | `c60d6775-bb22-43a0-8bdc-76b2d7196720` |

At that readback, platform/apps/sites selected control database `9a321890-cd09-4ecb-9dc6-882aa902845f` (the checked-in Wrangler configs now bind `whumpo-control-2026-10-04`). Its exact 156-table / 702-object schema fingerprint was `4d5e8d0a37a8d0039d543cdbad9109078fe05042813f1d15c9e835c2cddd42ad` (October 2 readback; the current source schema was 219 tables / 1,050 objects on October 8 and is 221 / 1,063 since #186 on October 9 (re-measured at source `d948f06`, October 11), and the control database was replaced in the October 4 cutover, so this is historical). All 39 served frontend assets matched the immutable release archive byte for byte.

The first preview run verified the GitHub unconfigured boundary, then encountered an expected Cloudflare cancellation redirect that the probe helper refused. Its generated account and every grant/OAuth/session row were removed and verified absent before another run. The helper now observes redirects without following them or forwarding cookies; identity JSON endpoints still require HTTP 200. This was a verifier correction, not an application failure or a replay of an uncertain provider write.

The completed probe at **04:20:00 UTC** verified:

- Signed current-session login for one synthetic completed identity. Plan remained Explore; grants created no paid subscription.
- GitHub was unconfigured. Connect/read inclusion changed independently as exact grants were issued and revoked; absent configuration still prevented OAuth start.
- Cloudflare was configured but unconnected. Connect inclusion allowed only a local OAuth start. Revocation stopped another start; cancellation and disconnect removed pending local authorization. No token exchange or provider resource read occurred.
- Revoking the ordinary session denied `/api/connections` even while a read grant remained active.
- All **five grants** were explicitly revoked and read back. The synthetic account, identity/session/credential records, grants and OAuth rows were removed and verified absent. No owner account was reset.
- No provider token, invoice, project or inference record was created for the fixture. Worker versions/bindings, exact schema and CMS registration readback matched before and after.

Private evidence: `.secrets/feature-acceptance-live.json`, `.secrets/feature-acceptance-cleanup-2.json`; the cleaned initial attempt remains in `.secrets/feature-acceptance-cleanup.json`. These ignored artifacts contain only operator/synthetic test metadata, never customer content. The current API cannot issue operator grants; the probe used the actual digest-reviewed `tools/feature-preview.mjs` CLI.

## Remaining product gates

- Physical authenticator support, human Turnstile signup and human live recovery remain in WH-114/115 acceptance.
- GitHub provider setup/consent and actual authorized provider operations require their own acceptance. A configured Cloudflare OAuth client alone proves neither customer consent nor provider reachability.
- Collaboration and future provider/job implementations must register their admission adapters and connected tests before becoming available. Planned catalogue inclusion is not execution readiness.
- CSAM implementation, Daybreak and CMS functional testing remain deferred. Real payments and broader launch acceptance remain gated by their own roadmap packets.
