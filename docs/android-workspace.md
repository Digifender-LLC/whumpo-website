# Native workspace transport (WH-084)

**October 7, 2026: implemented in server source with disposable HTTP/database verification.** `src/mobile/workspace.ts` admits the closed workspace, Chat, history, review and maintained-form subset of [the current native contract](mobile-api-v1.md). It creates no native copy of domain authority or storage. Android screen/rendering progress and installed-device acceptance are separate from these server results. Photos, sharing, push and the full native form/review renderer remain later work; an identity-only or browsing client declares no unsupported control or field capability.

## Current admission

The shared Android bearer resolver supplies the ready-account principal. Each workspace request uses `admitWorkspace` and `workspaceBindings`, so every database batch repeats identity, credential, epoch and expiry admission in the committing transaction. Storage/service/provider calls retain the existing guarded transport. Cookie and Origin refusal, global non-mobile bearer refusal and address/session limits remain unchanged. Sensitive controls also use the shared recent-authentication gate and authorization limiter.

`GET /bootstrap` reports an incomplete welcome without exposing workspace data. Every other workspace operation requires the existing `onboardingComplete` predicate. Restricted enrollment/recovery principals cannot reach this layer. The default and hard minimum build is **3**; `MOBILE_MINIMUM_BUILD` can raise it but cannot lower it. Build 2 cannot be re-enabled by stale configuration. There is one current response shape, with no legacy parser.

Projects, Activity and history are bounded owner-scoped reads. Cursors encode positions bound to owner, exact route and search; they grant no authority. Project and Activity ordering includes the immutable ID as a timestamp tie breaker. Activity preserves existing IDs such as `domain:<turn UUID>` as bounded opaque ASCII keys. Versions return at most 25 existing saved-version identities with allowlisted browser preview paths. Native bearers never enter the browser preview request. These preview paths currently require an existing browser cookie; without it the API returns 401 JSON. The automatic browser sign-in and allowlisted return bridge is not implemented or accepted here. Native review UI must not claim that missing-browser-session journey is complete.

## Chat and result recovery

`POST /chat/messages` calls `sendConversation` with only the original request ID, expected conversation revision and bounded text. Slash-prefixed text is still ordinary text; the adapter cannot reach a private command interpreter. `POST /reviews/confirm` is a separate closed route over `sendChatControl`. Natural-language model proposals retain the existing domain review boundary.

A saved turn matches the original canonical text/control and expected revision. A same-ID exact replay returns that saved result; changed input conflicts. New sends retain the shared conversation revision and pending-turn gate. Success means the request has a durable turn status, not that an arbitrary downstream operation succeeded. The app must resolve a lost reply using `GET /chat/turns/{requestId}` and show completed/pending/failed/uncertain honestly; opening the app or refreshing history never resends a mutation.

Recent history uses `readChat`; older/search pages use `chatHistory`. Current receipt-derived review metadata is offered only from the matching saved turn/domain readers. Historical prose creates no control. Exact turn readback uses `readSavedChatTurn`, including its final identity and saved-reply consistency check.

## Four exact review controls

- **Specification apply:** the current proposal digest and expected specification revision, full browser comparison/preview and an actual passkey proof younger than ten minutes. Approval saves the private specification/version.
- **Site confirmation:** current publication comparison, immutable saved version and publication revision. The adapter excludes unpublish even though the shared control type could represent it.
- **Application enable:** the exact linked server receipt and current shared presentation, complete verified source (8192 UTF-8 bytes maximum), SHA-256 and all effect/limit disclosures. Application disable is excluded. The client must show the full source and disclosure before advertising `application.confirm`.
- **Application data restore:** exact linked receipt, restore point, document count, program/roster/offline eligibility and an actual fresh passkey. This restores documents without enabling the application or publishing a visitor page.

The server derives the control from current domain metadata and compares it to the exact submitted control again before the shared handler executes. Every domain handler retains its atomic ownership, safety, quota, expiry and revision guards. Unsupported capabilities receive no enabled control; unknown controls never fall through to another handler. Code is never truncated to create approval metadata. The build-3 review shape includes `artifact:null` for other reviews and `{kind:"application-source",source,digest}` for application enable.

## Durable information forms

The adapter calls the existing list/read/resources/mutate/receipt/continue/stop/reconcile functions directly. It accepts no client-created definition, view or dispatch instruction. A current form must need only the declared native field and binding subset, have `kind:"form"`, and contain no cards. The same capability check applies to read, resource lookup, new mutation and continuation. Attachment, photo, connection, custom-view and card definitions fail closed; a generic form never creates review approval.

Drafts, answer revisions, immutable submission/request identities, exact digest conflicts, resource ownership, retention tombstones and continuation readback remain owned by WH-105/106. A repeated committed mutation may read its exact shared receipt after cancel has erased its envelope; it cannot execute again or change the saved payload. Submitting information alone does not dispatch continuation. The existing WH-105 error codes/field IDs are wrapped in the mobile envelope with bounded fixed messages, never raw provider or SQL text.

## Verification and limits

`node tests/mobile-workspace.mjs` and its `--d1` form exercise actual Worker dispatch with current disposable SQLite/local D1 databases and scoped synthetic authority. Coverage includes welcome gates; two owners; Cookie/Origin/web-token refusal; equal-timestamp project and actual domain-producer Activity paging; foreign route/search cursor refusal; plain-message and same-ID concurrency/readback; saved versions; all four exact controls; complete application source; stale proof; unpublish/disable refusal; draft/submit/cancel/receipt and capability checks; owned resource selection; explicit stopped/reconciled continuations; unsupported views; history beyond 100 recent turns; and late revocation at read and specification commit.

Website health readback triggered by a synthetic publication is served through the actual site-host Worker inside the fixture. No external provider, DNS change, inference, signing configuration, native deployment or device action runs. Existing native identity and contract checks plus TypeScript checks cover integration. This establishes server transport behavior only; signed association, real Credential Manager/App Link journeys, installed native review/form renderers, physical devices and beta admission remain separate evidence.
