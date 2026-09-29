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

The current inspection returns its result directly to the user in one AI turn. It does not run an automatic second inference or chain an inspection into a mutation. A follow-up can reference the returned version; the existing bounded conversation history supplies recent results. Large results or older versions may require the user to specify the exact displayed ID. `/project PROJECT_ID`, `/inspect VERSION_ID` and `show my saved versions` are deterministic alternatives requiring no model units. Natural-language interpretation consumes ordinary AI units.

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

The shared action instructions are compact so the reservation can fit the Explore allowance as the conversation grows. All supported action families remain in the prompt; no keyword router hides tools or adds a classification call. Server validation, explicit confirmation, owner checks and atomic metering remain authoritative. The change reduced prompt source from 14,096 to about 7,000 UTF-8 bytes; actual requests also include private context and bounded conversation history.

The baseline live run created a site for 6 units but rejected its first edit with 19 available: conservative input reservation plus minimum output capacity exceeded the balance. This is a usability failure even though no excess charge occurred. The compact instructions address that overhead without changing token accounting. A second live run still stopped after creation and one edit (15 spent, 10 remaining), so Explore now supplies 50 normal monthly units. `npm run test:first-ai-journey` exercises creation and three edits with a synthetic provider charging 10 units for creation and 5 for each edit, verifies content preservation and ancestry, and checks replay without extra inference. Actual model acceptance is recorded in deployment.md. Large contexts and longer outputs can still exhaust an allowance; this does not promise a fixed number of edits for every request.

## Free workspace navigation

`/chat`, `/dashboard`, `/settings`, `/profile`, `/appearance`, and `/billing` open the corresponding controls in the workspace. Exact phrases such as “open my profile”, “go to settings”, and “open billing settings” work too. `/pages` lists the current account's custom workflow pages; `/page Publishing desk` or “open page Publishing desk” opens one by its unique name. Missing or ambiguous names do not pick an arbitrary page. The custom-page list is refreshed before resolving a destination.

These browser navigation requests never enter chat history or call the model. They open controls without saving profile, billing, theme, authentication or connection changes. Longer requests such as “open my profile and change my email” remain ordinary agent requests. `/ask` explicitly bypasses navigation parsing. API clients receive free server-authored navigation guidance and an owner-scoped page list; unfinished onboarding data remains unchanged. `/help workspace` explains the commands.

Acceptance: `test:workspace-navigation` verifies exact parsing, non-interception of longer tasks, duplicate-name refusal, scoped page discovery, preserved onboarding and absence of usage reservations/provider calls. Browser checks verify Profile and a saved custom publishing page open directly from Chat.

Navigation release: platform `79433041-baee-4ae7-b90e-f14b2dd56ede`, verified live JavaScript matches the local build. Browser acceptance also covers `/billing`; the page opened without changing credit preferences.
