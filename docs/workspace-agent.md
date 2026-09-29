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

The action vocabulary is intentionally explicit and validated, but model intent classification remains probabilistic. The prompt asks for clarification when the project target or required details are missing. Read-only workspace inspection, domain provisioning, provider authorization and arbitrary backend execution are not implemented by these two actions. Source export still depends on an exact version known in the bounded context; `/versions` exposes older choices.
