# Workspace collaboration contract (WH-054)

**Proposed contract, October 8, 2026 (UTC). Source baseline `ca17c6a`. Planned feature; nothing here is implemented, deployed, priced or accepted.** `pro.members` and `pro.approvals` remain `planned` in [the feature catalogue](plan-feature-contract.md). Decisions below are marked *proposed*, *open* or *blocking*; this document is **not frozen** and must not be treated as a schema freeze until the blocking decisions in [Owner decisions needed](#owner-decisions-needed) have owner answers recorded. The backlog packet ([WH-054](roadmap/backlog.md#wh-054--add-workspace-collaboration-with-explicit-roles-and-approvals)) records no mapped issue and no claim at this baseline; refresh live issue and dependency state before any claim.

This is the implementer contract for Business Pro workspace collaboration: owner / editor / viewer / billing roles, explicit project and release approval, invitations, membership, audit and owner transfer. It reuses the delivered [workspace identity](workspace-identity.md), [feature admission](feature-admission.md), [Chat interaction](chat-interactions.md) and [view](workspace-views.md) foundations rather than adding authentication, entitlement, job or approval engines. It follows [composition architecture](roadmap/composition-architecture.md) and [alignment](roadmap/alignment.md): configure and register once, never build a parallel authority.

## Scope and non-goals

In scope: the role and capability model; the tenant/actor split every converted handler needs; invitation, claim, membership, removal, plan-loss and ownership-transfer lifecycles; approval provenance and stale-review invalidation; job and receipt rules; audit, lifecycle and protection classes; owner Chat/view bindings; verification and acceptance gates; and child-packet decomposition.

Not in scope and not implied: a public seat count, price, quota or allowance; real-money billing or payer changes; new provider setup; native (Android) member clients; staging, portfolio or bulk-change features that consume this contract; a legacy reader, compatibility alias or data-preserving conversion (the owner's [current-version rule](current-version-policy.md) applies: one current schema, a reviewed empty-database cutover, disposable test data). Retention windows are **not approved**; every retention statement below is a proposal under the existing LC decisions in [data lifecycle](data-lifecycle.md).

## Source baseline: what the code does at `ca17c6a`

The platform is single-tenant-per-login today. The same account ID is simultaneously the tenant, the actor and the preparer. Every converted handler must break that coupling explicitly.

| Anchor | Observed behavior | Consequence for collaboration |
| --- | --- | --- |
| [`src/index.ts:154–158`](../src/index.ts) | `workspaceIdentity` resolves the principal; `admitWorkspace` scopes the database to it; `users` is read by `principal.accountId`; `handleWorkspace(…, user)` receives that one `user.id`. | Tenant and actor are the same value. A member would be treated as an owner of their own empty account, or denied. |
| [`src/workspace-identity/admission.ts:10–14`](../src/workspace-identity/admission.ts) | `scope()` rejects any `userId` that is not `principal.accountId`. | Keep this for owner-only paths so they fail closed. Do not loosen it globally; add an explicit, narrower membership-aware context (below). |
| [`admission.ts:24–31`](../src/workspace-identity/admission.ts) | Every admitted statement runs in one batch with an `identity_admission_checks` insert that aborts the batch if the identity predicate fails. | This is the existing composable fence. The membership clause belongs in the same committing batch, with tenant/member closure, current role, revision, grants, scope and Business Pro inclusion. Revocation between admission and commit then aborts the write. |
| [`src/feature-admission.ts:10`](../src/feature-admission.ts), [`feature-inclusion.ts:9,29–30,46`](../src/feature-inclusion.ts) | `featurePredicate` composes `workspacePredicate(db, input.userId)` with inclusion keyed by `userId`; project scope requires `projects.owner_user_id = userId`. | Inclusion is keyed by the tenant and can be reused unchanged. The *actor* half needs an explicit actor-aware composition; today it silently means owner. |
| [`schema/platform.sql`](../schema/platform.sql) `publication_actions` and triggers `publication_action_identity`, `publication_confirm_guard` | `user_id` is owner, preparer and confirmer; the confirm guard checks `owner_user_id = NEW.user_id` and sizes the published-site quota from `NEW.user_id`'s plan coverage. | An editor-prepared / approver-confirmed review needs separate tenant and actor provenance. The plan used for quota must be the tenant's. The same pattern recurs in specification apply, service-client activation, CMS, backend and application reviews. |
| [`src/shared-modules/api.ts:33–37`](../src/shared-modules/api.ts) | Module owner principal is `{userId, projectId}` and its predicate is `workspacePredicate(db, p.userId)` plus `owner_user_id`. | Module activation and staff-role reviews are owner-only until converted. They are also a *different* concept: staff roles are project application policy on visitor identities ([shared modules rule 2](shared-modules.md)); a member never receives staff authority and the reverse. |
| [`docs/job-envelope.md`](job-envelope.md#actor-references-and-current-admission), `tools/prototypes/job-envelope.mjs:31–35` | The envelope already reserves `membership: {id, revision}`; runtime admission must refuse it until WH-054 supplies a resolver. | This document defines that resolver's contract; no job may carry a member reference before it ships. |
| [`src/plan-features.ts:40–41`](../src/plan-features.ts) | `pro.members`, `pro.approvals` are `planned`. | No feature is gated or advertised as delivered. |
| [`docs/data-lifecycle.json`](data-lifecycle.json) class `workspace-memberships` | Reserved, `planned`, no tables, requirements DP-02–05, packet WH-054. | Tables register in the same change that creates them. |
| `canonical-inputs.sql` `invitations`, `user_quota` | Platform signup invitations (`used_by`) and a 50-account total quota. | Workspace invitations are a **different** record and namespace from platform signup invitations. |

Measured against the composed current schema (`tools/current-schema.mjs` inputs built into an in-memory SQLite database, `PRAGMA foreign_key_list`, read-only; trigger figures are text heuristics, not proofs): **219 tables and 640 triggers; 111 tables hold a foreign key to `users(id)`** (86 `CASCADE`, 17 `NO ACTION`, 7 `RESTRICT`, 1 `SET NULL`); 55 of them also carry a project reference, 56 do not; **62 triggers enforce immutability of `user_id`/`owner_user_id`** and 57 repeat `owner_user_id = NEW.user_id`. These numbers bound the cost of any tenant-key change and will drift; the drift gate described under [Coordinated current-schema consequences](#coordinated-current-schema-consequences) is what keeps them honest.

## Terms, and who is not a member

- **Account**: one person's identity (passkeys, kit, sessions, personal profile and Chat). Defined by [workspace identity](workspace-identity.md).
- **Workspace (tenant)**: the unit that owns projects, versions, reviews, provider credentials, entitlements and the payer relationship. Whether the tenant key is an account ID or a separate row is the central open architecture decision ([below](#ownership-transfer-and-the-tenant-key)). Handlers must treat it as an opaque `tenantId`.
- **Acting context**: `{tenantId, actorAccountId, membership | null, principal}`. For an owner of a tenant with no membership indirection, `membership` is null and `actorAccountId` equals the tenant's owner account; this is exactly today's behavior.
- **Member**: an account with an `active` membership row for a workspace. Role: `owner`, `editor`, `viewer` or `billing`. Optional explicit grants (off by default) extend an editor.
- **Not members and never promoted by this feature**: Creator guest reviewers (accountless expiring [preview links](guest-previews.md)); Business approved notification recipients ([contact notification destinations](contact-forms.md)); customer-application visitors and project staff ([access roles](shared-modules.md)); platform operators and the support/safety case surface; anyone holding only a copied link, role string, receipt or model statement.

## Invariants

1. **One identity, one authority path.** Members sign in with the same passkey/kit/recovery model; there is no member password, magic link, workspace-only login or separate recovery. Membership removal revokes only that workspace's authority and never a personal credential; an emergency personal key removal or recovery advances the account epoch and therefore ends every workspace access through that account at the next admission ([identity authority](identity-authority.md)).
2. **Membership is authority only when evaluated server-side at the effect.** A role, grant, selected workspace, cached view, Chat statement, saved interaction, preview link or receipt ID is not authority. Admission rechecks tenant, membership revision, role, grants, project scope and inclusion inside the committing statements.
3. **Spend, publication, provider writes, membership changes and ownership changes are separate capabilities** that no role holds by accident (see the [matrix](#roles-grants-and-capabilities)). Editors have none of them without an explicit grant; ownership and billing-plan authority are not grantable at all (proposed).
4. **Models prepare; named humans confirm.** The existing rule ([security register](security-risk-actions.md), [tenant authority audit](tenant-authority-audit.md)) is unchanged: typed controls, exact immutable reviews, recent passkey proof for consequential effects. Visitors, webhooks, scheduled rules and view rendering never invoke the owner maintainer or borrow member identity.
5. **Immutable history stays immutable.** Reviews, versions, receipts and published content keep the tenant and actor provenance they were created with. No operation rewrites them; ownership change is a new fact, not an update to history.
6. **Exit paths never depend on the paid feature.** Owner roster read, member removal, voluntary leave, export, disconnect and uncertain-effect readback stay reachable after plan loss ([feature loss table](plan-feature-contract.md#loss-of-eligibility-and-protected-access)). A revoked collaborator is never treated as a protected owner.
7. **Current-version only, honest recovery.** One current schema and API; stale clients and schemas fail explicitly; lost responses are resolved by authenticated readback, never by resending.

## Ownership, transfer and the tenant key

The original requirement includes a real owner-transfer lifecycle. This section keeps that requirement intact and assesses what it needs; it does not substitute a co-owner for a transfer.

### Three different operations

| Operation | What changes | What must not change | Needs a tenant that outlives one person's account? |
| --- | --- | --- | --- |
| **Co-owner addition** | A second account holds the `owner` role in the same workspace. | Tenant identity, payer, custody, history; the first owner is unaffected. | No, but the workspace then lives or dies with whichever account anchors it. |
| **Owner authority transfer** (workspace transfer) | Accountable owner/payer-of-record becomes another account; the sender leaves or takes a lesser role. The sender's personal account is untouched and may later be deleted. | Workspace ID, project IDs and `{projectId}.whumpo.site` URLs, immutable versions/reviews/receipts, published sites, uncertain-operation authority. | **Yes**, unless the sender's login row *is* the tenant row. |
| **Project transfer** | One project moves between two workspaces. | Project ID and URL, versions, immutable history; the source workspace's audit still shows who acted. | Yes, and children must not hard-code a tenant that cannot change. |

Co-owner addition is cheap and useful, but it is **not** a transfer: it leaves the first account as the anchor, so account deletion, payer and credential custody are unchanged.

### What a transfer must preserve

| Invariant | Evidence in current source |
| --- | --- |
| Immutable tenant on reviews/receipts | 62 immutability triggers on `user_id`/`owner_user_id`; `publication_action_identity` refuses any change to `user_id`. |
| Payer / liability | `stripe_customers`, `stripe_subscription_orders`, `stripe_subscriptions`, `stripe_paid_invoices` are keyed by `user_id`; entitlement coverage is `plan_entitlements` by `user_id`; the confirm guard reads the plan of `NEW.user_id`. |
| Secret custody | Provider token ciphertext is sealed with context `whumpo:github:token:{user}:{tokenId}` ([`github-grant-revocation.ts:42`](../src/github-grant-revocation.ts), [`connection-vault.ts`](../src/connection-vault.ts)); rewriting the user without resealing makes it undecryptable. A provider authorization is also *personal consent* by the person who gave it. |
| Account deletion | 86 cascades plus 24 `NO ACTION`/`RESTRICT` references in the composed schema already make raw `DELETE users` unusable (the [lifecycle constraints](data-lifecycle.md#verified-current-constraints) counted 21 at their earlier checkpoint); a person who leaves a workspace must not take it with them, and must not leave their personal data behind in it. |
| Personal identity separation | Passkeys, kit, sessions, profile and private Chat belong to the account. |
| Stable public identity | `siteURL(projectId)` in [`src/publications.ts`](../src/publications.ts); custom domains point at the project. |
| Uncertain operations | In-flight revocation/dispatch authority must survive the owner who started it ([job envelope `platform-obligation`](job-envelope.md#actor-references-and-current-admission)). |
| Safety preservation | Triggers block account/project owner changes and deletion under a hold (`safety_hold_project_owner`). |

### Candidate architectures

| | **A. Account-anchored tenant** (tenant = the first owner's `users.id`; members and optional co-owners in a membership table) | **B. Re-key tenant in place** (update `user_id`/`owner_user_id` when ownership moves) | **C1. Workspace as a distinct `users`-kind row** (each workspace gets its own row of kind `workspace`; people are `account` rows; ownership is a membership) | **C2. Dedicated `workspaces` table** (tenant columns re-pointed to it; actor columns keep `users`) |
| --- | --- | --- | --- | --- |
| Immutable provenance | Preserved | **Refused**: needs relaxing 62 immutability triggers | Preserved (tenant never changes) | Preserved |
| Payer / custody | Anchor stays payer and custodian | Custody must be resealed under new context | Workspace row is payer and custody key; personal consent still revoked on transfer | Same as C1 |
| Original account deletion | Deletes the workspace unless blocked | Safe only after the rewrite | Personal account deletion cannot cascade a workspace | Same |
| Personal separation | Weak: person and tenant share one row | Weak until rewritten | Strong in intent; weak in typing (one table, two kinds) | Strongest |
| Disruption | Lowest | Moderate rows, **very high trigger and review risk** | Low DDL: existing keys and most triggers keep working; every handler picks the right ID; a kind guard and classification gate needed | Highest: rename or add tenant columns across most of the 111 `users`-referencing tables and roughly 60 triggers |
| Delivers owner-authority transfer | **No** | Only by violating immutability | **Yes** | **Yes** |
| Delivers project transfer | No | Same problem per child table | Possible if project children derive tenant from the project | Same |

### Why in-place re-keying is refused (not "impossible")

Option B would require updating tenant columns that dozens of triggers deliberately make immutable, resealing provider tokens under a new context, and moving a payer record, all while claiming immutable reviews are unchanged. Each step is technically possible for the platform; together they defeat the invariants that make reviews trustworthy, and resealing a token transfers one person's provider consent to another. The assessment is therefore: **B is refused by the project's own invariants, not by a technical impossibility.** The statement "transfer cannot be done without an organization rewrite" is also not proven: it is true only if the tenant key must be the departing person's login row (A) or must change in place (B). Separating tenant from login (C1/C2) delivers transfer without rewriting content, reviews or receipts.

### Recommendation (proposed; conditional on the first blocking decision)

1. **Keep full owner-authority transfer as a requirement** unless the owner explicitly narrows it ([Owner decisions needed](#owner-decisions-needed)). Do not ship co-owner plus "export and recreate" as if it were transfer.
2. **If transfer is required, choose C1: a distinct workspace tenant row of kind `workspace` in `users`, with a classification gate and kind guards, delivered in the same coordinated current-schema cutover as membership.** It is the least disruptive design that satisfies the invariants: content, reviews, vault rows, billing and most triggers keep their key, and "who is the tenant" becomes a row that no person's account deletion can cascade. C2 is the stricter alternative if the owner prefers type-level separation and accepts the rename cost.
3. **If the owner narrows scope** to roles, approvals and co-owner addition (A), document in the product that departing-owner transfer is unavailable, that the first account anchors the workspace, and that moving a project to another workspace is a portable export/import with new immutable versions and re-granted provider consent (the WH-077 [portable export boundary](roadmap/composition-architecture.md#9-export-a-recoverable-application-with-honest-portability-boundaries)); do not describe that as transfer.
4. **Either way, build the acting-context seam first** (next section). Handlers consume an opaque `tenantId` and an `actorAccountId`; A versus C1/C2 changes only what `tenantId` resolves to and what the schema keys. Conversion of handlers can therefore start before the tenant decision, but **no membership, billing, vault or project key may be frozen before it**.

### Coordinated current-schema consequences

These apply if C1 or C2 is chosen. All are done in one reviewed empty-database cutover under the [release rules](releases.md); there is no conversion of existing test accounts.

- **Classification gate.** Every one of the 111 `users`-referencing tables is classified exactly once as *workspace-scoped* (tenant), *account-scoped* (a person) or *actor provenance* (who did it), in a registry beside the lifecycle catalogue, and a check fails when a new table is unclassified. This mirrors `tools/lifecycle-catalog.mjs` ("every table has exactly one classification") and is what prevents silent tenant/actor confusion in C1. Proposed classification of the user-only tables (to be confirmed at the schema freeze): workspace-scoped — provider token vaults and connection tables, billing/Stripe tables, inference/gateway budgets and spend, fair-use and usage reviews, capacity preferences and project-level safety receipts; account-scoped — profile, welcome, workspace layout preference, private Chat turns/interactions and support deliveries; mixed cases (workspace preferences and layout receipts, contact suppression) need a per-table decision.
- **Roots and guards.** `projects` references the workspace; `stripe_*`, vaults and entitlement coverage reference the workspace; identity tables reference accounts. A guard rejects a workspace-kind row on identity/session tables and an account-kind row on tenant roots. `user_quota` must count accounts only. A workspace row has no credentials, email delivery or eligibility record; its `email` placeholder must never be used for delivery (code paths that read `users.email` need a kind check).
- **Signup transaction.** Creating a person's first workspace belongs after identity completion (the first-project welcome), not inside the signup ceremony, so the deployed identity ceremonies stay untouched.
- **Provenance columns.** Review/receipt tables that members can reach gain explicit actor provenance (`prepared_by`, `confirmed_by` as account references through a pseudonymous actor reference, plus membership ID and revision at prepare and confirm). Tenant columns stay as they are.
- **Cascade and deletion.** Actor references use a pseudonymous, per-(workspace, account) `actor_ref` with `ON DELETE SET NULL` toward the person, so history survives the person's deletion without keeping an email or credential. Account deletion for a sole owner of a workspace with members is refused until transfer or closure. Workspace closure removes member access first.
- **Safety holds.** Holds are keyed by `subject_user_id` today. The hold subject must be decided (workspace, person, or both) and must block transfer and member-driven deletion exactly as it blocks `projects.owner_user_id` changes now.
- **Billing.** Stripe customer/subscription attach to the workspace, not a login. See *Payer on transfer* below.
- **Lifecycle, closure inventory, export, restore suppression** register in the same change ([Audit, lifecycle and protection](#audit-lifecycle-protection-export-closure-and-restore)).
- **Collisions.** Work pending outside this baseline changes the same files (identity admission, authority errors, current-schema inputs, lifecycle catalogue, feature admission, Chat, publications, shared modules and a route boundary registry). Reconcile with those changes before any code starts; this document makes no claim about unmerged branches ([Sequencing](#sequencing-with-unmerged-work)).

### Owner-authority transfer lifecycle

States are `proposed → accepted → completed`, with `cancelled`, `expired` and `refused` as terminal alternatives. There is no persisted `committing` state because commit is a single guarded database batch with no external call inside it.

1. **Propose** (current owner, fresh passkey, exact review). Fields: workspace, recipient (must already be an *active member* of this workspace), what the sender becomes (`leave`, `viewer`, `editor` or `billing`; **not** `owner`), a digest of the plain-language liability statement shown, and an expiry (proposed seven days, no extension). At most one open transfer per workspace.
2. **Accept** (recipient, fresh passkey). The recipient acknowledges payer and custody responsibilities by digest. Acceptance changes nothing yet.
3. **Complete** (sender still owner, recipient still active member, same workspace ownership epoch, same membership revisions, workspace not closing, no blocking hold, Business Pro inclusion not required for the move itself): one batch (a) promotes the recipient to owner, (b) applies the sender's new role or removal, (c) advances the workspace ownership epoch, (d) voids pending reviews, invitations and member-prepared jobs, (e) records unique completion and audit rows, (f) records post-commit obligations. D1 batches are sequential and roll back together ([D1 batch behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/)); external effects are never inside it.
4. **Post-commit obligations** run as separate receipts under a platform-obligation actor that survives the sender's session: revoke the sender-authorized provider connections through the existing revocation path (recipient must re-consent with their own provider account), stop sender-authorized backups, pause rules approved by the sender until the new owner re-affirms them. An unknown revocation outcome stays visible and retains its reconciliation authority.
5. **Recovery.** A lost reply is resolved by authenticated readback of the transfer ID by either party. Retried acceptance or completion with the same request identity returns the stored result; a changed payload is `409 request_conflict`. A stale epoch, revision or closed state is `409` and requires a new proposal. The sender can cancel before completion; after completion there is no undo, only a new transfer.

**Payer on transfer (open sub-decision).** Completion changes *who may act*, not who is charged. Whumpo must not silently charge a new person or move a payment method. Recommended default: the workspace's already-paid interval continues; the recipient starts their own subscription in their own right (sandbox flow only until real-money activation); the previous payer keeps the existing cancel-at-period-end ability until the interval ends; if no replacement coverage exists at expiry, ordinary downgrade rules apply. Any proration, refund or card-transfer behavior is outside this contract.

### Co-owner addition

Optional (proposed), explicit, and never described as a transfer. A co-owner holds every owner capability except those listed as non-grantable-to-others: only an existing owner can add an owner; the recipient accepts with a fresh passkey; any owner can remove a non-owner; removing or demoting an owner requires that owner's own action unless a documented owner-recovery decision is made (open). The last-owner rule applies ([below](#membership-lifecycle)).

### Project transfer

Defined here so schema does not preclude it; **not required for member acceptance** unless the owner decides otherwise. Constraint for the schema child: project-scoped children should derive tenant from the project and record actors as provenance, so a project move is one reviewed update of the project's workspace plus a transfer receipt, not a rewrite of immutable children. Provider connections, domains and guest links need explicit per-resource rules in a future contract.

## Roles, grants and capabilities

Capabilities are expressed by **consequence class**, not by endpoint. Every registered action declares exactly one class; an action without a class, or a role without a mapping, is denied.

| Class | Examples | Owner | Editor | Viewer | Billing |
| --- | --- | --- | --- | --- | --- |
| `read` | Project status, versions, previews, saved reviews, approvals queue (read) | ✓ | ✓ in scope | ✓ in scope | workspace plan/usage summary only |
| `private-write` | Draft changes, private specification apply, layout, comparisons | ✓ | ✓ in scope | — | — |
| `limited-exposure` | Expiring, revocable guest preview links (no edit/publish authority) | ✓ | ✓ with `creator.guest-feedback` | — | — |
| `public-effect` | Publish, restore live, unpublish, activate a form/module or widen visitor access | ✓ | grant `approve-release`, plus the second-approver rule | — | — |
| `provider-effect` | OAuth connect/disconnect, backups, DNS, hosting, connector actions | ✓ | grant `manage-connections` | — | — |
| `spend` | Premium/advanced model approvals, future domain purchases | ✓ (existing exact approval) | grant `approve-spend` (not a default) | — | — |
| `membership` | Invite, change editor/viewer/billing roles, remove, edit scope | ✓ | grant `manage-members` (never owners, never beyond own authority) | — | — |
| `ownership` | Add/remove owner, transfer, close workspace, delete project, change payer | ✓ only | — | — | — |
| `billing-read` | Plan, invoice intervals, usage summary | ✓ | — | — | ✓ (read-only, proposed) |
| `export` | Supported project-content export | ✓ | ✓ in scope | — | — |
| `uncertain-readback` | Read-only reconciliation of unknown provider outcomes | ✓ | holder of that class's grant, if still active | — | — |

Rules (all proposed):

- **Grants are explicit, owner-assigned, off by default and not transitive.** Four grants only: `approve-release`, `manage-connections`, `approve-spend`, `manage-members`. Nobody can grant more than they hold; a `manage-members` holder cannot assign grants or touch an equal or higher authority.
- **No role may self-escalate.** A member cannot change their own role or grants.
- **Billing is read-only.** It sees plan, invoice intervals and usage summary. Purchasing authority (plan changes, payment method, subscription start/cancel, spend approvals) stays with the owner and is **not** granted by the billing role. This is a recommendation; making billing a purchaser is a separate owner decision that would also need the real-money gate.
- **Resource scope.** A membership covers either *all projects* or an *explicit list*. New projects do not join an explicit list automatically. Owners always cover everything. Account-wide dashboards, usage and history are filtered on the server by the actor's scope; nothing project-limited is sent to the client for later filtering ([Chat interactions](chat-interactions.md#shared-authority-and-eligibility)).
- **Chat privacy.** Chat transcripts and drafts are private to the acting account within a workspace; model context is built from the actor's authorized projection, never the whole tenant. Rosters, member emails and invitation tokens never enter model context or Chat history.
- **Standard assistance for members** is an open decision ([Owner decisions needed](#owner-decisions-needed)); in every option, standard assistance has zero customer-unit debit and no member request can fund premium work without `approve-spend` and an exact premium approval.

## Acting context and admission

The shared seam, designed once:

- **Owner-only paths unchanged.** `admitWorkspace` and `workspacePredicate` keep their account-equals-principal check. Existing handlers stay owner-only and fail closed for any non-owner context.
- **A separate, narrower membership-aware admission** produces the acting context: it takes the resolved principal and an explicit `tenantId` and returns a scoped database whose batch fence adds the membership clause to the existing `identity_admission_checks` insert. The clause requires, at the committing instant: tenant exists and is active; for a non-owner, an `active` membership for (tenant, actor) at the revision read at admission; role in the action class's allowed set; the required grant bit; project inside scope; the workspace ownership epoch unchanged; and Business Pro inclusion (`pro.members`) current for the tenant. The identity predicate is unchanged. Revocation, role change, transfer or plan loss between admission and commit aborts the batch.
- **Explicit workspace, never ambient.** A principal can belong to several workspaces. Every request names its workspace or resolves it from a project ID whose single tenant is then checked against the actor's membership. A missing or ambiguous workspace is `400`, a project in another workspace is `404`. A cookie or client-side "current workspace" is a hint only. Caches key on (tenant, actor, membership revision) and are discarded on any switch.
- **Handler registry and allowlist.** A closed registry maps each converted handler or binding to `{class, allowed roles, required grant, feature, operation}`. A non-owner context may reach only registered handlers; a test enumerates routes, Chat actions and bindings and fails on any unregistered or uncategorized one. Reuse the route boundary inventory rather than creating a second one.
- **Actor-aware feature admission.** `featurePredicate` gains a variant that takes the acting context: inclusion stays keyed by the tenant, the actor half composes the membership clause. For an owner context it must produce the same decisions as today (existing owner tests unchanged).
- **Provenance rule.** Tenant columns record whose workspace; separate columns record the preparer and confirmer (actor reference, membership ID, revision). A review prepared and confirmed by one member records the same actor twice; it is never rewritten to look like the owner.
- **Shared module principals.** The `owner` module principal gains a tenant/actor split through the same context; `visitor`, `staff` and `public` principals are unaffected and never accept a workspace cookie.
- **Job actors.** The membership reference in the job envelope is admitted only through this resolver. See [Jobs, receipts and immutable history](#jobs-receipts-and-immutable-history).

## Approvals and release authority

- **Preparer and approver are separate fields.** A member with `private-write` may prepare a consequential review; confirmation of a `public-effect`, `provider-effect` or `spend` review requires an owner or a holder of the matching grant, with a **fresh passkey assertion** (the existing ten-minute window) and the same exact-review binding used today: immutable version/source/data digest, destination, policy and current revision. The approval receipt also records preparer and approver membership ID and revision.
- **Reuse, not a new engine.** Approval wraps the existing review types (publication, specification, service client, application, domain, connection, module activation). A shared review-class registry assigns each its consequence class so staging promotion and bulk-change work can reuse the same approvals later.
- **Separation of duties (open, blocking).** Options: (1) *recommended*: an owner may approve their own preparation (single-owner behavior is preserved), an editor can never approve their own prepared review even with a grant, and a workspace policy flag can require a second approver for owner-prepared reviews (default off); (2) a second approver is always required once any non-owner member exists; (3) self-approval allowed for anyone holding the grant. The choice changes the approval child's schema and tests.
- **Withdrawal.** Unpublish and rollback are `public-effect` actions. Whether any editor may take a site offline without a grant is deliberately left conservative (no); emergency safety withdrawal by the platform is unaffected.
- **Queue.** Pending reviews are visible to eligible approvers through a read binding; opening one never approves it. Expiry (existing ten-minute review windows) is unchanged and independent of membership.

## Invitations and membership lifecycle

### Invitation contract

A workspace invitation is its own record, never a platform signup invitation. Fields (conceptual): workspace, proposed role, grants and scope, inviter membership ID, a hash of a 256-bit random secret shown once to the inviter, a masked contact hint for display, state, expiry. The secret follows the guest-link handling rules: stored only as a hash, never in Chat, model context, logs, analytics or exports.

- **Possession is required; an email address alone is never authority.** Whumpo's signup does not verify mailbox control, so an email match proves nothing. Acceptance needs (1) possession of the secret, (2) a *ready* account with a current passkey session, (3) the inviter's authority still current, (4) the workspace's Business Pro inclusion current and the member bound not exceeded, and (5) the claim and, for elevated cases, an inviter-side confirmation (below).
- **Claim then confirm (proposed).** The recipient claims the invitation; the inviter side sees a masked account label and confirms. Activation without confirmation is available only for viewer-only invitations if the inviter chooses it. Unconfirmed claims expire with the invitation and grant nothing. First valid claim wins; a second claimant receives the same generic response as an expired or unknown secret (no enumeration).
- **Expiry**: seven days is the proposed routine default and maximum; owners may choose shorter; no extension (issue a new invitation). Request IDs make issuance idempotent; pending invitations and issuance rate are bounded.
- **Delivery**: owner-delivered link first (as with guest links). Platform email delivery is a later adapter through the shared job outbox, content-minimal, and not part of the first acceptance.
- **Existing accounts versus invite-as-signup (open, blocking).**
  - *Existing ready accounts only (recommended first slice):* the invitee must already hold a completed account. No change to deployed signup ceremonies, eligibility, Turnstile or the 50-account quota. In the invite-only test stage this means the invitee arrives through the ordinary platform invitation first.
  - *Invite-as-signup:* a workspace invitation would also authorize account creation. It requires amending the signup options/verify ceremonies to accept a workspace invitation verifier, consuming it atomically with the first registration, keeping eligibility and Turnstile, resuming across the two-key and kit steps, and holding the claim until identity is `ready`. It also needs a platform decision on whether a workspace invitation counts as a platform invitation. This belongs to the identity workstream and must not start without that decision.
- **Account states.** An `enrolling` or `recovering` account has no workspace authority and cannot claim; its progress is untouched.

### Membership lifecycle

States: `invited` (invitation exists) → `claimed` → `active` → `suspended` (derived from plan loss; row retained) → `removed` or `left` (terminal tombstone; the same account can later be invited again as a new membership). Every change increments the membership revision and, where it affects access, the workspace access revision. Unique (workspace, account) among non-terminal memberships; a person can hold one membership per workspace and many workspaces.

- **Bound.** An active-membership bound per workspace with a proposed default of **5 (counting owners)** is an engineering and abuse limit, not a public seat allowance, price or promise; whether it counts owners and how pending invitations are bounded are minor open items. Pricing copy must not mention it.
- **Last owner.** A workspace always has at least one active owner. Removal, voluntary leave, demotion, personal-account deletion and transfer all enforce this in the committing statements (a trigger or conditional write that sees the preceding statements of the same batch), so two owners demoting each other concurrently leave exactly one.
- **Removal and leave** take effect at the next admission; they need no workspace session to revoke because workspace authority is evaluated per request. A removed member's unconfirmed reviews, drafts, invitations and sender-authorized provider connections are handled by the [invalidation matrix](#invalidation-matrix).
- **Cross-workspace isolation.** Authority never crosses workspaces: an owner of A who is an editor of B has only editor authority in B; IDs from A presented in B are `404`; roster and audit reads are workspace-scoped.
- **Single-owner isolation.** A workspace with no non-owner membership behaves as today. The existing single-owner suites must pass unchanged on an owner context (fixtures will be re-seeded for the new schema; assertions are not weakened).
- **Member-only accounts (open).** Workspace entry currently requires completed first-project welcome. Whether an account with only memberships may enter member surfaces without creating its own workspace is not decided here.

## Plan eligibility, downgrade and revocation

- **Effective access** for any non-owner requires current Business Pro inclusion (`pro.members`; `pro.approvals` for approver confirmations) for the *tenant*, evaluated in the same predicate as other features. Loss of coverage is derived from the existing invoice-only resolver, never a stored member flag.
- **On loss** (renewal expiry, downgrade, revocation): reads, edits, approvals, Chat and jobs by non-owners are denied everywhere; memberships are retained as `suspended` (no content deleted, published sites unchanged); unsent member-prepared reviews cannot be confirmed by non-owners; scheduled work approved by a member stops before dispatch; the owner keeps roster read, removal, export, disconnect and uncertain-effect readback; reconciliation cannot create a new side effect. A former collaborator is never given protected-history access.
- **On regain**: suspended memberships do not silently resume. Proposed: the owner reviews and resumes them (and expired invitations are reissued). Retention of suspended rows and any grace period are **not approved** and must be decided with the LC decisions and the commercial gates (pricing policy already defers seats, grace and retention).
- **Entitlement is not billing authority.** Inclusion shows who may use the feature; it grants no spend and no payer change.

## Invalidation matrix

Prepared reviews bind the preparer's membership ID and revision; approvals are checked against the approver's current membership at commit. A change to a membership revision therefore voids that member's *unconfirmed* prepared reviews of non-read classes (strict but simple; they re-prepare).

| Event | Pending prepared reviews | Approval at commit | Drafts / interactions | Unsent jobs | Invitations issued | Provider credentials authorized by the member |
| --- | --- | --- | --- | --- | --- | --- |
| Role, grant or scope change of member M | M's unconfirmed reviews void | Checked against M's current authority | Read-only forms close | Jobs referencing M's old revision void | Kept if M still holds `manage-members` | Kept if M still holds `manage-connections` |
| M removed, left or suspended | Void | Fails | Cleared on detection | Void | Void | Revoked or disconnected through the existing path |
| M's personal identity epoch advances | All of M's workspace authority fails at the next admission | Fails | Clears on next read | Void | Void | Unchanged until M's membership ends |
| Workspace plan inclusion lost | Non-owner confirmation denied | Denied | Denied | Stop before dispatch | Void | Unchanged; disconnect stays available |
| Ownership transfer completes | All pending non-read reviews void | Fails if prepared before | Cleared | Sender-actor jobs void | Void | Sender-authorized connections revoked |
| Project leaves M's scope | Void for that project | Fails for that project | Cleared for that project | Void for that project | n/a | n/a |
| Target revision changes | Existing review rules apply (stale) | Existing rules | n/a | n/a | n/a | n/a |

Open minor items: whether guest preview links issued by a removed member are kept (proposed), and whether an approver's removal pauses rules they approved or only those in the public/provider/spend classes (proposed: only those).

## Jobs, receipts and immutable history

- **Jobs.** The job envelope's `actor.membership {id, revision}` is admitted only by this resolver. Dispatch and commit re-resolve current tenant, membership revision, role, grants, scope and inclusion; a mismatch rejects the stale snapshot. Claims, restored journals and operator re-drive create no authority. Updating a role, removing a member or transferring invalidates the old reference. Replays and retained history recheck current membership before disclosing a receipt.
- **Receipts and reviews are append-only facts.** They record tenant, actor reference, membership ID and revision at the time. A member's removal changes future authority, never past receipts.
- **Uncertain operations** keep their original authority record. After ownership change or member removal, readback is owner-only (or the live grant holder); a platform obligation completes revocation. Nothing is re-sent because a member left.
- **Rules and automation** (the deterministic-rule adapter) do not invent member authority: a rule approved under a membership is paused for public/provider/spend effects if that approval's membership ends, until an owner re-affirms it.

## Audit, lifecycle, protection, export, closure and restore

- **Audit (proposed).** An append-only, content-minimized workspace log: invitation created/claimed/confirmed/expired/revoked, role/grant/scope changes, removal and leave, plan suspension and resume, transfer proposed/accepted/completed/cancelled, and approvals as references to the underlying review. Each event records workspace, event kind, pseudonymous actor reference, subject reference, membership revision before and after, request ID and time. **No email, token, credential, Chat or content.** Readable by owners and `manage-members` holders; a member sees events about themselves. It survives member removal and personal-account deletion because the actor reference is pseudonymous. Retention is not approved.
- **Lifecycle class.** Fill the reserved `workspace-memberships` class and any new classes in the same change as the tables; run the lifecycle catalogue check. Owner-readable role-filtered views; no model or third-party processor; invitation secrets hashed; classification under [data protection DP-02–05](data-protection.md).
- **Export.** Owner roster export (labels, roles, grants, scope, dates; no emails unless later approved, never tokens). A person's own account export includes their memberships. Workspace export is owner-only.
- **Closure.** Closing a workspace ends member access first, voids invitations, then follows the existing resumable closure ([account closure](account-closure.md)); closure counts membership, invitation, transfer and audit rows. Deleting a personal account removes that person's memberships; it is refused while they are the sole owner of a workspace with other members.
- **Restore suppression.** A restored backup must not resurrect removed members, claimed invitations or completed transfers: independent tombstones with revisions are checked at restore admission ([data lifecycle LC-08](data-lifecycle.md), [restore admission](restore-admission.md)). A restored receipt confers no authority.

## Owner surface bindings

Domain handlers are implemented **once**; web, Chat, saved views and later native clients register adapters over them ([alignment rule](roadmap/alignment.md#implementation-rules-that-prevent-another-rewrite)). Proposed registry entries (names are proposals until the interaction child registers them):

| Binding or control | Kind | Feature / authority | Notes |
| --- | --- | --- | --- |
| `workspace.members@1` | read | identity + membership; no plan gate for owner roster | Roster by opaque member reference, role, grants, scope, state, revisions; masked labels only. |
| `workspace.invitations@1` | read | owner / `manage-members` | Pending invitations with expiry; never a secret. |
| `workspace.access@1` | read | any member | The caller's role, grants, scope and denied/suspended reasons. |
| `workspace.approvals@1` | read | approvers | Pending reviews with class and preparer reference. |
| `workspace.audit@1` | read | owner / `manage-members` | Minimized events. |
| `memberInviteReview` / `memberInviteApply` | prepared exact review → apply | `pro.members` prepare/confirm, fresh passkey | Model may prepare; human applies. |
| `memberRoleReview` / `memberRoleApply`, `memberRemove`, `leaveWorkspace` | review/apply | `pro.members`; removal and leave need none | Exit paths stay available after plan loss. |
| `ownershipTransferReview` / `ownershipTransferAccept` / `ownershipTransferApply` | review/apply | owner and recipient, fresh passkey | Never a model-executable verb. |
| `invitationClaim` | direct trusted page, not Chat | possession + ready account | The secret never passes through Chat or a model. |

View components `members` and `approvals` register in the workspace view contract with feature `null` for reads (as `access-roles` and `modules` do) so the owner roster survives plan loss; prepare and confirm re-check inclusion in their own handlers. Essential direct controls — leave, remove, accept/decline an invitation, see my access, sign out, security and recovery — stay reachable without inference. Registering these is the interaction child's job; backend work does not wait for the whole Chat rollout.

## Concurrency and recovery catalogue

| Scenario | Required outcome |
| --- | --- |
| Two claims of one invitation | One winner; loser gets the generic invalid response. |
| Claim races inviter removal or invitation revoke | No membership; claim receipt is readable; nothing activates. |
| Role change races an in-flight write by that member | The write's batch aborts on the revision clause; no partial effect. |
| Approval races approver demotion | Commit aborts; the review stays pending and re-approvable by a current approver. |
| Two owners demote or remove each other | Exactly one succeeds; at least one active owner remains. |
| Last owner leaves, deletes their account or is removed | Refused with a clear reason. |
| Transfer proposed twice, or accepted twice | One open transfer; replays return the stored result. |
| Transfer completion races member removal, plan loss or closure | Guard rows decide once; the loser changes nothing. |
| Lost response on invite, claim, role change, remove, transfer | Authenticated readback by request ID; never auto-resend a first dispatch. |
| Provider revocation after transfer is unknown | Visible pending obligation with retained readback authority; no new write. |
| Plan loss during an unsent member-prepared job | Job stops before dispatch; status stays honest; no maintainer invoked. |

## Verification and acceptance gates

Evidence levels stay distinct: **source only → local fixture (SQLite and local D1) → connected local browser → physical device → independent security review → deployed test platform**. A passing fixture does not imply a later level.

| Area | Required checks | Level |
| --- | --- | --- |
| Role × class × tenant matrix | Generated from the handler registry: every action × role × grant × scope, through direct handler, HTTP, Chat and job paths; unregistered handlers deny non-owners | Local |
| Tenant isolation | Two workspaces, one account with different roles in each; ID confusion, cache and selected-workspace switching | Local |
| Interleavings | Hold a request after admission and change role/grants/scope/removal/transfer/plan before commit (the pattern used for the identity authority fixes); stale review, approver demotion, last-owner races | Local |
| Invitations | Possession, wrong account, enrolling account, replay, expiry, concurrent claim, enumeration, inviter removed, bound exceeded, cross-workspace secret | Local |
| Transfer | Proposal/accept/complete state machine, concurrent transfer/removal/closure, lost responses, payer acknowledgment, post-commit obligations, hold refusal, immutability of existing receipts | Local |
| Single-owner regression | Existing owner suites (feature admission, workspace admission, publications, identity HTTP, shared modules, guest previews) unchanged on an owner context | Local |
| Downgrade | Real elapsed invoice and preview intervals (as in the feature-retention fixture): members suspended, owner content and published sites intact, exit paths available, jobs stop | Local |
| Jobs | Membership reference refused until the resolver exists; role change invalidates unsent jobs; restored journal grants nothing | Local |
| Lifecycle, audit, export | Catalogue classification, closure inventory counts, audit minimization (no email/token), account deletion with pseudonymous history, restore suppression | Local |
| Surfaces | Binding negative cases; viewer cannot draft; model context excludes roster data; client caches cleared on switch | Local / connected |
| Connected journeys | Built frontend + actual handlers: invite → claim → confirm → edit → prepare → approve → publish; removal mid-flight; downgrade | Connected local |

**Pending gates (not satisfied by this document):** the independent security review required before multi-user activation; invitation and approval journeys on physical devices; real-device and human recovery for member accounts (WH-115 acceptance remains open at this baseline); deployed test-platform readback after the coordinated current-schema cutover; sandbox downgrade drill; cumulative WH-090/WH-104 acceptance including "membership loss and approvals". Provider, real-money and customer evidence remain separate and unclaimed.

## Child packets

The parent retains its gate. Children have no IDs yet (the backlog is not edited here; packet numbering waits on pending backlog publication). Each is a coherent, separately verifiable delivery.

1. **Contract, schema and acting-context seam.** Resolve the blocking decisions; freeze the tenant model; add current-schema inputs (memberships, grants, scope, invitations, transfers, audit, tombstones, provenance columns); register lifecycle/protection classes and the classification gate; build the acting-context admission, handler registry and drift test; keep owner-only paths fail-closed; enable the job-envelope membership resolver. *Exit:* single-owner regression green, matrix generator and isolation tests pass, catalogue checks pass, empty-database cutover plan reviewed. Excludes invitations UX, approvals and Chat.
2. **Membership and invitations.** Invitation issue/claim/confirm, roles/grants/scope, remove/leave, last-owner rules, plan suspension/resume, owner-transfer lifecycle and post-commit obligations, audit, roster/access bindings. *Exit:* race and lost-response fixtures, downgrade fixture, audit minimization. Excludes approvals.
3. **Approvals and connected acceptance.** Preparer/approver provenance on the converted release handlers, review-class registry, stale-review invalidation, approvals queue, Chat and view adapters, connected browser journeys, device and invitation journeys, security review, and the sandbox downgrade drill. *Exit:* parent acceptance criteria satisfied; the parent stays open until the pending gates above pass.

Dependencies named by capability, not number: completed identity and feature-admission foundations, recovery acceptance for members, the interaction contract, lifecycle/protection classification, the job envelope. Staging promotion, portfolio and bulk-change features consume the approval child's review-class registry and must not add their own approval engine.

## Decision register

| Decision | Status | Proposal |
| --- | --- | --- |
| Tenant model and owner transfer scope | **Open, blocking** | Keep transfer required; C1 workspace row with classification gate; A + co-owner only if the owner explicitly narrows scope |
| Payer on transfer | Open (part of the above) | Never move a card; recipient subscribes; paid interval continues; previous payer may cancel at period end |
| Invite path | **Open, blocking** | Existing ready accounts first; invite-as-signup as a separate identity amendment |
| Separation of duties | **Open, blocking** | Owner may self-approve; editor never self-approves; optional second-approver policy |
| Member AI and spend authority | **Open, blocking** | Standard assistance under the tenant's fair-use envelope attributed per actor; premium only with `approve-spend` and an exact approval; billing read-only |
| Billing role | Proposed | Read-only |
| Member bound | Proposed | Default 5 (engineering limit, no seat promise) |
| Invitation expiry | Proposed | 7 days default and maximum; owner-delivered link |
| Claim-then-confirm | Proposed | Confirm required except viewer-only opt-in |
| Suspended rows, audit and invitation retention | **Not approved** | Decide under the LC decisions |
| Safety-hold subject (workspace, person or both) | Open (technical) | Decide at schema freeze |
| Member-only accounts and the welcome gate | Open | Decide before the membership child |
| Project transfer between workspaces | Open, deferred | Schema must not preclude it |
| Guest links issued by a removed member | Proposed | Keep, flag issuer-removed |

## Owner decisions needed

Ask these in order; each answer authorizes only the decision asked, not deployment, spending or provider activation.

1. **Is departing-owner workspace transfer (same workspace, projects, URLs and history; sender may delete their account) a Business Pro launch requirement?** Recommended: **yes — build it on a distinct workspace tenant (C1)**; this is a larger coordinated schema change but cheapest now while test data is disposable. Alternatives: no, launch with roles, approvals and optional co-owners only, and describe transfer as unavailable; or I'll specify.
2. **How do invitees join?** Recommended: **existing completed accounts first**, with invite-as-signup as a later identity amendment. Alternatives: invite-as-signup in the first slice (requires identity-ceremony changes and a platform-invitation decision); I'll specify.
3. **Who may approve a release prepared by an editor?** Recommended: **owner or an explicit `approve-release` grant holder, never the preparer themselves; owners may self-approve (optional second-approver policy, default off)**. Alternatives: always require a second approver once any member exists; allow self-approval for grant holders; I'll specify.
4. **What can non-owner roles consume or spend?** Recommended: **billing read-only; editors use standard assistance under the workspace's fair-use envelope (zero customer-unit debit); premium or purchasing only with `approve-spend` and an exact approval**. Alternatives: members get no AI assistance; billing role may purchase; I'll specify.

## Remaining unknowns

- Exact set of review types and handlers to convert in the first slice, and their consequence classes; the registry must be compiled from the route/Chat inventory at implementation time.
- Whether the tenant row (C1) or table (C2) is chosen, and the final classification of mixed `users`-referenced tables.
- Payer mechanics in Stripe beyond the sandbox-only default, and any grace/proration terms (pricing policy defers seats, grace and retention to later gates).
- Interaction of the safety-hold subject with workspace ownership; the platform decision on workspace versus signup invitations.
- Whether member-only accounts skip the first-project welcome.
- Real-device behavior of two-key enrollment for invitees, which depends on open recovery acceptance.
- The boundary registry and other unmerged changes (below) may change the file-level seams named here.

## Sequencing with unmerged work

This document was written against `ca17c6a` only. The coordinating audit reported pending pull requests that change identity admission, authority errors, current-schema inputs and the lifecycle catalogue (and, in one case, feature admission, Chat, the index, publications and shared modules), and a boundary registry that will require an entry for every new route; none of that was re-verified from this worktree. Reconcile with whatever has merged before code starts, do not pull or edit those branches from this contract, and treat file anchors above as of the baseline.

## Verification of this document

Docs-only. Local links and anchors in this file and in the cross-linked sections were resolved with a throwaway script outside the repository; `git diff --check` was run; no application test, schema build against deployment, remote Cloudflare operation, push, pull request or issue was made. The schema figures come from a read-only in-memory SQLite build of the current-schema inputs.
