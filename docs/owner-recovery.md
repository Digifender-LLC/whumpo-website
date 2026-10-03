> Current owner identity uses [the passkey/kit protocol](workspace-identity.md) and [current web integration](identity-web.md). Run `pnpm test:identity-recovery`, `pnpm test:identity-browser`, or `pnpm test:workspace-identity-browser`; the old one-key/code-rotation browser runner has been removed. Dated evidence below is historical and does not describe the supported current implementation.

# Owner recovery and lost passkeys

## Accepted policy amendment — October 1, 2026

**Replacement backend and browser delivery implemented in isolated source; platform admission and cutover remain pending. The deployed recovery journey below is unchanged.** The [identity and data protection contract](roadmap/identity-and-data-protection.md), WH-113–115, replaces ordinary password sign-in with passkeys and requires two distinct verified passkeys at workspace signup. A downloadable text recovery key and accessible Print / Save as PDF view encourage an independent printed backup with one save acknowledgment. Recovery-key use will grant only restricted replacement enrollment; lost-all-keys recovery requires two verified replacement passkeys, a saved rotated kit and a fresh replacement-passkey assertion before workspace access. Preserve save-before-rotation, lost-response recovery, selected-credential revocation and concurrent-attempt protections. Emergency revocation must not be blocked by a two-key minimum. Account recovery does not itself recover future client-encrypted content; visitor identity retains its separate contract.

The [WH-113 protocol decision](workspace-identity.md) now fixes the exact two-stage recovery, partial-loss rule, kit prepare/save/commit, session fencing and current-only forward-repair contract. WH-114/115 must reuse those records across web/native/member access. The [restricted recovery backend](identity-recovery.md) now verifies this flow, shared kit rotation and emergency removal on SQLite/local D1. The [trusted browser and HTTP adapter](identity-web.md) now pass isolated mobile/D1 acceptance. Common admission/lifecycle composition and the coordinated test reset are still required to replace the deployed behavior below.

## Current implementation and evidence

**Status: deployed to the private test platform September 30, 2026; connected local browser acceptance passed. Physical-device and live authenticated recovery acceptance remain open.** This extends the original passkey/recovery milestone in [mvp.md](mvp.md). The platform owner account is separate from controlled application visitor accounts; visitor recovery is described in [app-data.md](app-data.md).

## Recovery journey

1. The owner enters their email and existing 64-character recovery code. `POST /api/auth/recover/passkeys` checks both and returns only that account's registered passkey IDs, names and usage dates. It rotates nothing and signs in no one. The same Origin check, authentication rate limit, bounded JSON body and no-store response policy as other authentication routes apply. An invalid email/code pair gives the same error.
2. The browser **stops** and requires a choice: **all**, **some**, or **none** of the owner's passkeys may be lost or compromised. For **some**, the owner selects exact listed passkeys. Passkeys may sync across devices; disabling one registered credential makes it unusable for Whumpo wherever that credential is available. Choosing **none** keeps every passkey active.
3. Before the final request, the browser derives and displays a new recovery code from the old code and a fresh 256-bit nonce. The owner must save it before continuing. Neither code nor nonce is stored in local storage, sent to AI, or placed in a URL. If the final response is lost after the database commit, the already-saved new code can recover access again.
4. `POST /api/auth/recover` requires the choice, exact selected IDs and nonce. A D1 batch atomically rotates the recovery code, removes the chosen passkeys, revokes all prior sessions and writes a content-free activity event. A stale selection or code is rejected without silently removing a different passkey. The resulting new session lets an owner who chose **all** enroll a replacement passkey immediately; the new recovery code remains their fallback.

Passkey login also rechecks that the verified credential still exists when issuing its session. Passkey enrollment rechecks the owner's fresh session at insertion. These checks prevent a verified assertion or in-flight enrollment from restoring access after recovery removes credentials. Recovery does not reset a password or revoke third-party OAuth grants. A broader suspected-compromise response remains a separate decision tracked in [MVP acceptance](acceptance.md).

## Verification and remaining acceptance

`pnpm check`, `pnpm db:local` and `pnpm test:passkeys` passed locally. The signed WebAuthn fixture covers invalid preflight, missing choice, stale selected ID, **some/none/all** results, old-session revocation, old-passkey rejection, deterministic code readback and replacement passkey enrollment. `pnpm dev` built the frontend for a local Worker. This is local source and synthetic-account evidence. It does not establish a native passkey prompt, mobile layout, production deployment, or a live account-recovery journey. Do not test by disabling a real customer's credentials without a separately reviewed disposable account.

## Concurrent recovery acceptance — September 30, 2026

Recovery cleanup now requires the unique activity receipt created immediately after that attempt successfully rotates the code. The receipt and cleanup use one [D1 batch transaction](https://developers.cloudflare.com/d1/worker-api/d1-database/). A matching replacement-code hash alone cannot authorize a losing same-nonce attempt. Session creation also rechecks the current recovery-code hash; a newer recovery cannot be bypassed by an older handler finishing late.

`node tests/owner-recovery-concurrency.mjs` passed against disposable actual D1. It pauses an admitted attempt, completes a competing same-nonce attempt, adds replacement credentials/session, and then resumes the loser. Duplicate and conflicting all/some/none choices preserve the winner’s state and produce one activity record. A forced cleanup failure rolls back the code, credential removal and activity. A separate handler interleaving verifies that superseded completion returns 401 without a session cookie. Both failures were reproduced before the corrections.

`node tests/owner-passkeys-http.mjs` passed the existing signed WebAuthn suite through the actual platform handler served on loopback with disposable D1. Coverage includes registration/login, origin and user verification, challenge replay, reviewed recovery choices, session revocation and replacement credential enrollment. This runner uses Node for the handler and local Cloudflare D1; it does not establish deployed Worker or native-device behavior. Both TypeScript checks also passed. At that checkpoint, source remained undeployed and browser/mobile recovery acceptance was open; the subsequent release is recorded below. No real credentials were changed.

## Browser acceptance and test release — September 30, 2026

The retired `owner-recovery-browser.mjs` runner served the built frontend and actual platform handler on loopback with disposable D1, two synthetic passkeys and a deliberately lost first recovery response. Browser verification selected only the lost phone, saved the derived code, received the interrupted-response guidance, restarted using that saved code, kept the remaining passkey and returned to the signed-in welcome. Independent database readback verified one retained backup key, two recovery events, one final session and no Chat turns. No real account or provider was involved.

At a 360 CSS-pixel layout, primary controls are at least 48 pixels high, long passkey names wrap, and the document stays within the layout width. Keyboard activation completed the journey. The browser reported a 165-pixel visual viewport despite its 360-pixel override, so this does not establish physical-phone touch/keyboard acceptance. Evidence: `.secrets/owner-recovery-browser.json` and `.secrets/owner-recovery-browser.png`. The first runner’s terminal input was closed; its state was checked independently and the process stopped. That historical runner also supported `/_acceptance/finish` for noninteractive sessions.

Deployed platform version `cb34d460-4938-45c1-8447-fbcc254ebbd2` from the isolated release checkout. This includes reviewed recovery choices, save-before-rotation, competing-attempt isolation, current-credential session admission and mobile control refinements. Existing pricing assets and CMS bindings were preserved; no migration or customer credential change occurred. Root `pnpm check`, `pnpm build`, frontend-loading checks and diff checks passed. The release checkout’s package-manager dependency check refused its shared module layout, so both TypeScript projects, the build and frontend-loading checks were run directly with the existing Node 24 tools and passed, without reinstalling dependencies.

Live verification records are in `.secrets/owner-recovery-release-verification.json`: exact active version, deployed frontend asset bytes, health and anonymous-access boundaries, invalid recovery denial and foreign-Origin denial. These probes never supply a real recovery code. Native passkey prompts, real-device interaction and an authenticated live recovery remain separate acceptance work.


## Revoked-session credential changes — October 1, 2026

Recovery-code replacement and passkey removal recheck the initiating owner/session **inside the committing database statement**, including expiry and ten-minute freshness against database time. A request admitted before account recovery or password change cannot finish its credential mutation after that operation revokes its session. Passkey removal's guarded activity receipt, key deletion and session revocation remain one atomic batch. The last-passkey rule is unchanged. Replacement recovery codes are returned only after the guarded insertion/update succeeds; denials return no new code or cookie.

`tests/owner-credential-authority.mjs` reproduced ten failures before correction, then passed all 21 expanded cases afterward. It exercises actual mounted handlers with disposable local D1, synthetic owners/credentials and pauses before the real mutation. Coverage includes recovery/password revocation, expiry/freshness crossing after statement preparation, changed session owner, delayed streamed body, insertion and replacement, foreign/last-key rejection, normal changes and cleanup-failure rollback. The `test:owner-recovery` script includes this regression. No real owner credentials or provider state were used. See the [A1 audit follow-up](tenant-authority-audit.md#a1-remediation--october-1-2026); A2/A3 remain open.

Additional verification passed: `node tests/owner-recovery-concurrency.mjs`, `node tests/owner-passkeys-http.mjs`, `pnpm --config.verify-deps-before-run=false run check`, and `pnpm --config.verify-deps-before-run=false run build`. The fixture suites used separate temporary homes and disposable D1; the pnpm flag prevents dependency reinstallation against the shared module directory. Roadmap validation, generated-backlog and whitespace checks passed. No CMS functional test ran.


### A1 test release

[PR #33](https://github.com/zemdregon/whumpo/pull/33) merged as `e7036b1a9d753648d3b779b22cf3adff05721f3c`. Managed release `4c4be7bc-1354-4e05-b4f1-533bd6f92b79` archives implementation source `a27039bc214373129f747502cf9c4a0fab59e87d`. The mixed-version review compared the two changed platform routes with deployed Stripe source `d414df9`; schema, other Workers, service contracts, bindings, routes, schedules, compilers and frontend behavior are unchanged. All 114 migrations were already applied; no SQL ran. Every deployment step completed without repair/retry.

| Worker | Verified version |
| --- | --- |
| runtime | `0d96e17c-ff7f-4feb-80ff-48db97969163` |
| apps | `795ba1e2-7858-4662-a32e-744c774a1979` |
| sites | `f8c82bb9-baa7-4787-b7d1-6fcbccc5edf0` |
| platform | `33f03069-722f-449a-a2ed-e94046fb5707` |

Independent readback at **2026-10-01T13:48:45.687Z** confirmed all four candidate versions/tags, unchanged service/secret-binding names and CMS registration inventory, 114 migrations, all 16 exact frontend assets and workspace HTML. Home/workspace/health returned 200; anonymous Chat/profile and both credential mutations returned 401; foreign-Origin credential mutations returned 403. Credential denials returned no replacement code or session cookie and retained `no-store`. Stripe still advertises sandbox mode.

Private evidence: `.secrets/credential-release-verification.json` and the immutable release archive. The archive's dirty flag covers only the shared dependency symlink and inspected generated visitor dependency-path comments; implementation source was committed. Generated comment differences were restored after deployment. This confirms deployed code/artifacts and entry boundaries; the interleavings were accepted locally, not repeated with a real owner's credentials or physical passkey. No customer content, CMS functional test, new paid service or live payment was involved.
