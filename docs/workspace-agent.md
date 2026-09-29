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
