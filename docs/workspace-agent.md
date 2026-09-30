# AI project and export actions

The model can now propose a new project with a private first website, or attach a source download for an existing owned version. Natural-language requests after onboarding use these capabilities. During guided setup, `/ask` explicitly invokes AI. Guided `/new` and `/export` remain available without inference.

## New project

The allowlisted action contains only `kind: project`, a nonempty purpose of at most 1,000 characters, and the existing validated site-page configuration. The model must ask for a missing name/purpose, and use this action only when the customer requests a new project. The server chooses IDs and owner, validates and escapes all site text, enforces existing schema/output bounds and atomically commits the project, first version, chat result, setup-state transition and activity record. It uses the same reusable platform renderer as existing site drafts.

The result contains server-generated project and version receipts. The model cannot select another owner, set a plan, publish, create a domain or execute backend code. New projects receive the selected starting theme. Existing project versions are unchanged. The account's 20-project test limit still applies; a quota failure rolls back the entire project/version transaction and refunds the request's units.

## Source download

The allowlisted export action contains only an exact version ID. The server rechecks version ownership and records the version in `chat_exports`, whose database trigger also enforces owner agreement. The existing chat UI displays an authenticated download link from that record. It never uses a model-generated URL. Downloading rechecks ownership and returns the exact bounded saved HTML, configuration, styles and referenced photo dependencies.

No current publication is changed. The source download excludes account credentials and chat history. Model interpretation is metered as an ordinary AI reply; deterministic `/export` and the existing download link use no model units.

## Retry and failure behavior

Both actions share the existing usage reservation and persisted AI-response transaction. A saved message replay makes no additional inference call. If the commit succeeds but its acknowledgement is lost, reconciliation uses the saved token receipt and existing artifacts rather than generating another project. Invalid fields, foreign versions and malformed component configurations produce no artifacts and refund the failed proposal's units. An uncertain provider response retains its existing hold for reconciliation.

## Evidence and limitations

`test:workspace-agent` covers atomic project/first-version creation, no publication, source receipts, foreign/missing exports, invalid properties, replay, lost commit acknowledgement and project-limit refunds. `test:site-agent` retains edit, photo, publication-review and validation coverage.

The action vocabulary is intentionally explicit and validated, but model intent classification remains probabilistic. The prompt asks for clarification when the project target or required details are missing. Domain provisioning, provider authorization and arbitrary backend execution remain unfinished. Read-only inspection is described below. Source export still depends on an exact version known in the bounded context; `/versions` exposes older choices.


## Read-only workspace inspection

The `inspect` action accepts an allowlisted scope: projects, project, versions, version, activity, usage or domains. Single project/version scopes require an exact ID; versions can be filtered by project. Other scopes reject target IDs. Extra fields, arbitrary queries, URLs and unsupported scopes are rejected. Every database read is scoped to the authenticated owner. Foreign and missing IDs return the same not-found result.

The server replaces the proposed model reply with the actual record summary. Inspecting a version shows saved text, theme and publication state without modifying it. These tools execute no publication, purchase, DNS or provider mutation. Usage reads can initialize normal billing metadata; they do not grant units or credits. An AI usage snapshot explicitly identifies the current request's pending hold, and directs the user to `/usage` for the settled balance.

A compact index includes all twenty permitted project IDs, names and statuses; rich context remains bounded to five projects and the latest saved version. This lets the model find older projects, inspect their versions and use an exact ID on a subsequent request. Preview permission is checked against the database owner rather than membership in the rich-context subset. The index and all detailed context remain private to the current account.

When the available allowance can cover both bounded calls, an inspection can feed one additional model step in the same request. That step can propose a validated draft/edit or return an answer. If the reserve cannot cover both calls, or the lookup exceeds the bounded context, the inspection returns directly as before. A later request can still reference its result. `/project PROJECT_ID`, `/inspect VERSION_ID` and `show my saved versions` are deterministic alternatives requiring no model units. Natural-language interpretation consumes ordinary AI units.

`test:workspace-read` verifies read-only statements, server-generated receipts, tenant boundaries, exact records, missing targets, rejected arbitrary query/URL fields, replay, free guided inspection and discovery of projects outside the five-project detailed context. Version, site-agent and workspace-agent contracts continue to govern subsequent changes.

## Conversational domain ownership

The `domain` action accepts exactly one of:

- `operation: prepare`, an owned `projectId` and a user-supplied `hostname`.
- `operation: check` and an owned `claimId`.

Preparation and verification reuse the deterministic domain command implementation, including strict hostname validation, fixed bounded DNS resolution, account/project/platform quotas and transactional activity records. Preparation returns the exact TXT instructions; verification returns the actual DNS outcome. The model's proposed reply is discarded. It cannot invent successful ownership, purchase, routing or certificate results. Expired proofs must be renewed before checking.

The model receives at most ten owned claim metadata entries (ID, project, hostname, expiry and last verification time), never the proof token through this metadata. Recent conversation history can contain previously displayed TXT instructions; these are public DNS proofs, not provider credentials. Metadata is explicitly not current DNS authority. No customer/operator provider token is supplied to the model.

A completed action and its model usage receipt commit together. Saved retries make neither another inference nor another DNS request. Validation, ownership, resolver and domain-quota failures make no domain mutation and release the AI reservation. An uncertain persistence failure follows the existing reconciliation path. The free `/domain`, `/verify-domain` and `/domains` commands remain available. Natural-language interpretation consumes normal build units.

`test:domain-agent` exercises authoritative receipts despite a false proposed model reply, owned metadata, creation/reuse, DNS checks, replay, expiry/renewal, foreign IDs, rejected extra fields and unsupported operations, provider failure refunds, quota refunds and lost database acknowledgements. This does not implement domain hosting, registration, purchases or customer Cloudflare authorization.

Live acceptance (September 29, 2026): Worker `76ac4d4b-e652-4c42-8595-59495d28de3a` used the configured Muse Spark model to prepare instructions for a temporary project's `www.example.com` claim and then check DNS. The actual absent proof was reported, connection remained false and the project remained unpublished. Saved replay did not increase charges; the two AI replies consumed 12 build units and left no reservation. Signed passkey authentication, replay rejection and logout passed. The temporary user/project/claim records were removed. This is a negative-DNS live test; successful TXT verification remains covered by controlled resolver tests, not a live customer DNS edit.

## Prompt size and first-use allowance

September 30, 2026: the full catalog had grown to 24,028 bytes in the empty-context fixture. The unchanged previous release failed the normal 50-unit creation-plus-three-edits regression at the third edit because its conservative reservation could no longer fit. Explicit website requests now omit the unrelated native CMS/backend schemas. Simple theme/headline/description/section follow-ups use that scope only when the most recent completed turn created the current latest website version; otherwise they retain the full catalog. Mixed requests (including CMS, backends, DNS, accounts and billing) retain all tools. Existing explicit CMS focus remains. Common ownership, untrusted-context, approval and credential rules are preserved. This selects instruction context, not a different model or a permission grant; server action validation remains authoritative.

The welcome first-draft action always uses the website catalog and independently enforces its exact-project preview-only scope. It makes a single model call with the complete saved brief, not a paid preparatory inspection. See [first-build contract](onboarding.md).

The website-only empty-context fixture is 11,952 bytes versus 24,028 for the full catalog. Prompt-focus and the normal 50-unit creation-plus-three-edits regression pass, preserving ancestry, exact changes, replay and zero unsettled holds. The final real Muse welcome probe used 9 test units in one call; this is an observed example, not a fixed price or guaranteed model cost. Released with platform `f1476f42-f652-46a2-8451-bbac05c7192b`.

An earlier compacting pass reduced prompt source from 14,096 to about 7,000 UTF-8 bytes while retaining all then-supported action families. The catalog subsequently grew as CMS/backend capabilities were added; current scoped behavior and the new baseline are described above. No extra classifier model call is made. Server validation, explicit confirmation, owner checks and atomic metering remain authoritative; actual requests also include private context and bounded conversation history.

The baseline live run created a site for 6 units but rejected its first edit with 19 available: conservative input reservation plus minimum output capacity exceeded the balance. This is a usability failure even though no excess charge occurred. The compact instructions address that overhead without changing token accounting. A second live run still stopped after creation and one edit (15 spent, 10 remaining), so Explore now supplies 50 normal monthly units. `npm run test:first-ai-journey` exercises creation and three edits with a synthetic provider charging 10 units for creation and 5 for each edit, verifies content preservation and ancestry, and checks replay without extra inference. Actual model acceptance is recorded in deployment.md. Large contexts and longer outputs can still exhaust an allowance; this does not promise a fixed number of edits for every request.

## Free workspace navigation

`/chat`, `/dashboard`, `/settings`, `/profile`, `/appearance`, and `/billing` open the corresponding controls in the workspace. Exact phrases such as “open my profile”, “go to settings”, and “open billing settings” work too. `/pages` lists the current account's custom workflow pages; `/page Publishing desk` or “open page Publishing desk” opens one by its unique name. Missing or ambiguous names do not pick an arbitrary page. The custom-page list is refreshed before resolving a destination.

These browser navigation requests never enter chat history or call the model. They open controls without saving profile, billing, theme, authentication or connection changes. Longer requests such as “open my profile and change my email” remain ordinary agent requests. `/ask` explicitly bypasses navigation parsing. API clients receive free server-authored navigation guidance and an owner-scoped page list; unfinished onboarding data remains unchanged. `/help workspace` explains the commands.

Acceptance: `test:workspace-navigation` verifies exact parsing, non-interception of longer tasks, duplicate-name refusal, scoped page discovery, preserved onboarding and absence of usage reservations/provider calls. Browser checks verify Profile and a saved custom publishing page open directly from Chat.

Navigation release: platform `79433041-baee-4ae7-b90e-f14b2dd56ede`, verified live JavaScript matches the local build. Browser acceptance also covers `/billing`; the page opened without changing credit preferences.


## Bounded inspection continuation (0059)

One original request may make at most two sequential model calls: an allowlisted workspace inspection, then a final reply/action. This is not a general durable automation runner; general backend/CMS tool chains, evaluators and subagents remain separate unfinished work. Both calls use the same configured Muse route during testing.

Before dispatch, the usage ledger reserves the conservative combined input/output bound when available units permit it. Otherwise it reserves a single call. Settlement sums reported input/output tokens and rounds once per completed user operation. The orchestrator inference row is the turn's aggregate shadow-cost receipt; ACK remains separate. The private `agent_inspections` record preserves the first call's token counts and bounded server lookup, rather than treating the aggregate as proof of one provider call. Future routing across different models/rates requires per-call settlement before activation.

The lookup is read only, account scoped, limited to 8,000 UTF-8 bytes and wrapped as untrusted data. Oversized lookup results return directly; they are not silently truncated into mutation context. Provider token reports exceeding their reserved per-call bounds stop progression. Each provider call has a 45-second timeout. The second call cannot confirm publication, DNS, billing or other reviews; it uses the existing action validator and owner checks. A second inspection is returned directly and never makes a third model call.

The first lookup receipt is committed before calling the provider again. Lost database acknowledgment, provider interruption or an uncertain final save never automatically redispatches the original turn. Unknown outcomes keep their reservation for review. Failed proposals keep the existing customer refund policy; internal unknown inference costs remain held. The existing pending-turn reconciliation can settle a saved final result without inference.

`test:agent-inspection` verifies read-then-draft, aggregate charging, exact replay, a maximum of two calls, interrupted follow-up, lost receipt acknowledgment, rejected foreign mutation, excessive token reports and a low-balance single-call fallback. The live synthetic probe `RUN_LIVE_MUSE=1 node tests/agent-inspection-live.mjs` uses only a temporary local database and the operator's ignored key; it requires two real Muse calls, a private draft and zero publications.

Release evidence (29 September 2026): migration 0059 applied remotely and platform version `e87be46e-1d6b-4ba8-a9b7-5d89b15a1442` verified active. The live Muse probe completed exactly two calls, reported 7,938 input tokens and 2,124 output tokens, created the requested synthetic private draft, and published nothing. Its database was temporary/local and removed afterward. Existing model-cost and workspace-action regression suites passed alongside the new continuation suite; TypeScript and build checks passed.


### Inspect backend source before editing

The bounded continuation also recognizes exactly three backend reads: `list(projectId)`, `inspect(versionId)` and `result(receiptId)`. Each requires the exact allowed fields and a valid ID. Existing backend functions recheck ownership. Source and saved output are untrusted context, not executable instructions. Creating code, running tests, reading/exporting private state, restoring snapshots and preparing/applying reviews are not lookup steps and cannot trigger an automatic extra call.

The final model step can use the existing validated `backend.create` action to save a new immutable private draft. It cannot replace the original source or publish it. A saved code draft is still untested until a separate execution is requested. The same two-call ceiling, aggregate budget reservation, persisted lookup receipt and uncertain-outcome handling apply.

Automated acceptance seeds an original function, inspects it, creates a changed private version, and verifies the original source remains intact with no test runs or publication. `RUN_LIVE_MUSE=1 LIVE_INSPECTION_KIND=backend node tests/agent-inspection-live.mjs` uses a synthetic local account and a local runtime at `http://localhost:8794`; after the agent completes, the harness runs the generated source in the existing isolated QuickJS runtime against three non-sensitive inputs to verify the requested arithmetic change and preservation of unrelated output fields. This probe publishes nothing and changes no customer data.

Backend continuation release: platform `6510fe26-08b9-4bba-bbe0-1b68e000d0ef` verified active. The live Muse backend probe completed two model calls (8,423 input tokens, 1,833 output tokens). Three subsequent local QuickJS executions confirmed the arithmetic change and unchanged label/nested metadata. The agent itself executed no code and published nothing; the test database was temporary and removed afterward. The continuation regression suite, malformed-operation check, TypeScript check and build passed.


## Direct control navigation and fresh custom pages — September 29, 2026

Exact navigation phrases now open Domains, Photos, Contact inbox, External connections, Passkeys & recovery, and Visitor access directly from Chat. Examples include “open my domains”, “open external connections”, “open project photos”, “open contact inbox”, “open passkeys” and “open visitor access”. GitHub/Cloudflare connection aliases open the existing connection screen; opening it grants no authorization and does not disconnect an account. Profile/settings separation and existing confirmation rules remain unchanged.

These phrases use the shared exact navigation parser. Longer instructions such as “open external connections and disconnect GitHub” are not consumed as navigation, and `/ask` remains an explicit model request. Browser navigation does not submit a chat turn; API clients receive free guided navigation help without AI reservation and without interrupting onboarding. Existing slash commands retain their previous server behavior.

Custom-page lookup and listing now force a fresh dashboard read rather than accepting the query cache. A removed or ambiguous name leaves the request intact with a notice; lookup failures keep the draft and report the error instead of producing an unhandled rejection. Static destinations need no dashboard lookup. This prevents opening a removed cached page or omitting a newly created one.

Verification: `pnpm check`, `pnpm test:workspace-navigation`, `pnpm build`, and diff checks passed. Tests cover all new destinations, longer-request preservation, no AI calls or usage reservations, preserved onboarding, owner-scoped page lists, refreshed/removed/duplicate page names and rejected lookup handling. A synthetic browser fixture opened Domains from natural language, resolved a newly available custom page, and opened External connections at 360px width; custom-page width was exactly 360px without overflow. Fixture counters recorded zero chat submissions. Keyboard activation returned to Chat. Pointer automation was inconsistent during this check, so this is not physical-device tap acceptance. Screenshot: `.secrets/navigation-mobile.png`. Provider consent and service panels were not exercised by this navigation-only fixture.

Deployed platform version `91feddcb-78e5-4b45-8dad-eca931860e45`; live JS/CSS matched the tested build byte-for-byte, landing returned 200 and anonymous dashboard read returned 401. No schema migration, provider authorization, paid inference or customer mutation was performed for this release.

### Unfinished publishing work in Chat — September 30, 2026

`/cms-pending`, “show unfinished publishing work”, and “show pending cms work” are deterministic guided reads. `/cms-pending PROJECT_ID` narrows the inventory; `/cms-pending all 2` (or a project ID plus page) reads another page. Help → CMS documents these commands. The model can request `cms.pendingWork` for an exact owned project; that ordinary model turn uses the existing inference accounting, while the exact guided commands use no AI units.

The owner-scoped inventory includes unfinished CMS setup, source-bound WordPress imports, article creation, article edits, publication reviews, unpublish reviews and discard reviews. It orders approved/unresolved work before unapproved reviews, oldest first, with a deterministic tie-break and 20 results per page. Expired unapproved reviews and completed requests are omitted; approved requests remain recoverable after their original review deadline. Setup disappears only once its own instance is ready and connected, and obsolete competing setup reviews are omitted. Import-backed draft reservations are represented by their original import review rather than a misleading generic draft retry.

Every entry supplies its existing read-review or exact draft/edit retry command. Listing does not call a provider, retry a write, confirm anything or publish content. A customer must separately send the displayed command; subsequent confirmation/capability/revision checks remain authoritative. The agent's proposed prose is replaced with the server's actual inventory. It cannot claim that a saved pending record proves the current native outcome. The list excludes article bodies, source HTML, credentials and provider metadata, and does not include incomplete uploads or non-CMS operations. Upload recovery remains in the publishing desk.

The lookup is read-only and uses one database statement with bounded materialized groups; Chat still saves its ordinary conversation receipt. Pages reflect saved state when read, not a frozen multi-page snapshot. Invalid project IDs/pages are rejected; foreign project scope returns 404. No schema, provider service or customer CMS deployment is required.

Verification: `pnpm check`, `pnpm test:cms-pending`, `pnpm test:cms-mapped-import` and `pnpm test:agent-prompt-focus` passed (the initial mapped-import invocation used the existing test script). The inventory test seeds read fixtures for all seven lifecycle families, restores production triggers before Chat checks, and covers ownership/content canaries, completion/expiry, competing/connected setup, exact pagination, model-tool validation/server-authored replies, guided routing with AI configured, same-ID Chat replay and unchanged usage. The mapped-import regression verifies the actual approved import appears once after a lost native response and disappears after recovery, using production write guards. A read-only probe against remote D1 verified the inventory query for an unused random identity without creating an account or reading customer content. The isolated platform release passed backend type checking; frontend assets are unchanged.

Release: platform `2304496a-7c65-429c-a201-72254448b33e` is live in test. No migration or frontend bundle change. Active-version readback, health 200, and anonymous Chat/CMS reads 401 passed. Authenticated command behavior was verified locally against real D1; no real customer Chat was mutated for the release check.

### Find interrupted uploads from Chat — September 30, 2026

The inventory now also includes unresolved owner image uploads and pending WordPress XML source uploads. Each shows its original request ID and a project-specific **Open publishing desk** link. Completed uploads disappear; source filenames, contents, native media metadata and credentials are excluded. These entries use the same ownership, ordering and pagination rules as the other seven families. This supersedes the earlier exclusion of incomplete uploads.

Opening the list or link does not retry a write. In the publishing desk, the customer selects the original pending request and original file; existing immutable identity/digest checks govern recovery. Images should use the same browser preparation. There is no replacement-request shortcut. Model-assisted inventory uses the same server-authored result; guided `/cms-pending` remains free of inference.

Chat recognizes only complete internal `/workspace/cms?project=UUID` lines as navigation links, with a 44px minimum target. Other response text stays escaped plain text; arbitrary URLs, Markdown, HTML, extra parameters and action paths are not interpreted. The publishing desk resolves the project through the authenticated owner's instance inventory.

Verification: `pnpm check`, `pnpm test:chat-reply`, `pnpm test:cms-pending`, `pnpm test:cms-owner-uploads`, `pnpm test:wordpress-sources` and `pnpm build` passed. Inventory fixtures cover all nine families and private-data canaries; production-guarded image and XML tests verify lost-acknowledgement visibility, no writes from inventory reads, and removal after exact recovery. The image fixture needed its native draft response updated to include the existing required version and reserved slug; no runtime draft-identity check was weakened. A read-only remote D1 query for an unused identity returned no records. Link rendering was verified using React server rendering; physical touch and a live customer upload were not exercised.

Released to the test platform as `d9a0931d-502f-4a38-acab-13021e8efbc7`. The isolated release passed both TypeScript projects, the production build and `node tests/frontend-loading.mjs`; direct Node entry points were used after pnpm's linked-checkout dependency check requested an unnecessary reinstall. Independent readback confirmed the active version, landing entry and all 18 live JS/CSS/font assets against the tested release bytes. Health returned 200; anonymous Chat/CMS reads returned 401. No migration, customer CMS provisioning, inference or publication was performed.

## Readable guided requests — September 30, 2026

Implemented: recognized WordPress source-list, inspection, import review and confirmation commands display as plain-language customer requests in the current conversation, pending message and saved history. Image review wording distinguishes explicitly selected local images; confirmation asks to import or recover the exact private draft and makes no success claim. Existing first-build/app/brief labels use the same shared display component.

A collapsed **Request details** disclosure retains the original request verbatim as escaped, wrapping text. It has no links or execution controls. Complete bounded syntax is required for relabeling; malformed IDs, extra arguments, more than four images, unsafe item numbers and prose mentioning commands remain unchanged. Stored history, search, provider inputs, replay identity and server approval checks are unchanged. Authoritative assistant replies and review links remain visible in full.

Verification: `pnpm test:chat-reply` covers recognized requests, disclosure rendering, malformed/prose preservation, HTML escaping and absence of generated action controls. Both TypeScript projects, the production build and `node tests/frontend-loading.mjs` passed in the isolated release checkout.

Released to the test platform as `3359f27b-34c1-4315-82d6-de97ba6ac72b`. Independent live readback confirmed the active version, all 16 JS/CSS/font files matching the tested bytes, the homepage loading the new entry bundle, health 200 and anonymous Chat/onboarding/private-photo requests returning 401. Evidence: `.secrets/readable-chat-release.json`. The release preserved the existing pricing/frontend changes and excluded unfinished owner-recovery work. No migration, new service or customer-content change was required. Authenticated presentation behavior is covered by rendering tests; this release check did not mutate a live customer conversation.
