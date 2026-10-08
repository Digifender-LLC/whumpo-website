# Workspace collaboration contract (WH-054)

**Proposed contract, revised October 8, 2026 (UTC). Source baseline `ca17c6a`. Planned feature; nothing here is implemented, deployed, priced or accepted.** `pro.members` and `pro.approvals` remain `planned` in [the feature catalogue](plan-feature-contract.md). Four owner product decisions were recorded on October 8 UTC ([below](#owner-decisions-recorded)); the schema is **not frozen** until the four remaining product questions in [Remaining product questions](#remaining-product-questions) are answered and the child-1 schema review accepts the engineering choices marked *proposed*. The backlog packet ([WH-054](roadmap/backlog.md#wh-054--add-workspace-collaboration-with-explicit-roles-and-approvals)) records no mapped issue and no claim; a live GitHub search on October 8 UTC found no WH-054 issue. Refresh live issue and dependency state before any claim.

This is the implementer contract for Business Pro workspace collaboration: owner / editor / viewer / billing roles, explicit project and release approval, invitations, membership, audit and full owner transfer. It reuses the delivered [workspace identity](workspace-identity.md), [feature admission](feature-admission.md), [Chat interaction](chat-interactions.md) and [view](workspace-views.md) foundations rather than adding authentication, entitlement, job or approval engines. It follows [composition architecture](roadmap/composition-architecture.md) and [alignment](roadmap/alignment.md): configure and register once, never build a parallel authority.

## Owner decisions recorded

Recorded October 8, 2026 (UTC) as the owner's answers to the questions the first draft proposed. They are no longer open and must not be re-asked. **Each answer authorizes only the product decision it answers, not deployment, spending, provider activation or a schema cutover.**

| Question | Owner answer (recorded as given) | Where applied |
| --- | --- | --- |
| How do invitees join? | Invitations go to **existing COMPLETED accounts first**. | [Invitations](#invitations-and-membership-lifecycle) |
| Who approves a release prepared by an editor? | An editor-prepared release requires **ANOTHER owner or an explicitly granted approver**; an **editor cannot self-approve**. **Owners retain self-approval.** | [Approvals](#approvals-and-release-authority) |
| What can non-owner roles consume or spend? | **Editors get standard AI within the workspace's fair use (zero customer units).** **Premium spend requires an explicit grant plus exact approval.** The **billing role is read-only.** | [Roles](#roles-grants-and-effect-sets), [Approvals](#approvals-and-release-authority) |

Departing-owner workspace transfer is **not an open question**: it is an existing requirement of the WH-054 packet ("owner-transfer lifecycle") and stays required. Which table holds the tenant is an engineering choice made and justified here ([Ownership](#ownership-transfer-and-the-tenant-key)); it is not an owner decision. The first draft's *optional* second-approver policy for owner-prepared releases is **not** part of this contract (the owner retained owner self-approval); any stricter policy would be a new decision.

## Scope and non-goals

In scope: the role and capability model; the tenant/actor split every converted handler needs; invitation, claim, membership, removal, plan-loss and ownership-transfer lifecycles; workspace closure; approval provenance and stale-review invalidation; job and receipt rules; audit, lifecycle, protection and safety-hold rules; owner Chat/view bindings; verification gates; and child-packet decomposition.

Not in scope and not implied: a public seat count, price, quota or allowance; real-money billing or payer changes; new provider setup; native (Android) member clients; staging, portfolio or bulk-change features that consume this contract; invite-as-signup (an invitation never creates an account); a legacy reader, compatibility alias or data-preserving conversion (the owner's [current-version rule](current-version-policy.md) applies: one current schema, a reviewed empty-database cutover, disposable test data). Retention windows are **not approved**; every retention statement below is a proposal under the existing LC decisions in [data lifecycle](data-lifecycle.md).

## Source baseline: what the code does at `ca17c6a`

The platform is single-tenant-per-login today. The same account ID is simultaneously the tenant, the actor and the preparer. Every converted handler must break that coupling explicitly.

| Anchor | Observed behavior | Consequence for collaboration |
| --- | --- | --- |
| [`src/index.ts:154–158`](../src/index.ts) | `workspaceIdentity` resolves the principal; `admitWorkspace` scopes the database to it; `handleWorkspace(…, user)` receives that one `user.id`. | Tenant and actor are the same value everywhere downstream. |
| [`src/workspace-identity/admission.ts`](../src/workspace-identity/admission.ts) `scope()` | Every helper (`workspacePredicate`, `assertWorkspace`, `requireFreshWorkspace`, `workspaceTransport`, `workspaceBindings`) rejects any `userId` that is not `principal.accountId`. | This equality **is** the tenant check today. Once the tenant is not the person's account it is false for the owner too, so every owner path must be converted ([below](#converting-every-workspace-owner-path)); it cannot be kept as "owner-only unchanged". |
| [`admission.ts` `batch`](../src/workspace-identity/admission.ts) | Every admitted statement runs in one batch with an `identity_admission_checks` insert that aborts the batch if the identity predicate fails. | The existing composable fence. The membership clause belongs in the same committing batch. |
| [`src/feature-admission.ts:10`](../src/feature-admission.ts), [`feature-inclusion.ts`](../src/feature-inclusion.ts) | `featurePredicate` composes `workspacePredicate(db, input.userId)` with `inclusionPredicate` keyed by `userId`; project scope requires `projects.owner_user_id = userId`. | Inclusion is keyed by the tenant and is reusable once the key is the tenant; the actor half needs an actor-aware composition. |
| [`schema/platform.sql`](../schema/platform.sql) `plan_entitlements` | A **view** over `stripe_paid_invoices`; invoice rows are immutable (`stripe_invoice_immutable`) and deletion is guarded while the user exists. Preview grants (`feature_preview_grants`) can be revoked. | Invoice coverage only grows by insertion; it ends by time passing. This makes the [coverage lease](#plan-eligibility-downgrade-and-durable-suspension) sound. |
| `publication_actions` and triggers `publication_action_identity`, `publication_confirm_guard` | `user_id` is owner, preparer and confirmer; the confirm guard checks `owner_user_id = NEW.user_id` and sizes the published-site quota from `NEW.user_id`'s plan. | Editor-prepared / approver-confirmed reviews need separate tenant and actor provenance, and quota must use the tenant's plan. The pattern recurs in specification apply, service-client activation, CMS, backend and application reviews. |
| `projects.owner_user_id` | **Mutable**: no general immutability trigger; only `safety_hold_project_owner` blocks a change, and only under a hold. | The tenant of a project is mutable today. History must therefore never be attributed through it ([project transfer](#project-transfer)). |
| [`src/shared-modules/api.ts:33–37`](../src/shared-modules/api.ts) | Module owner principal is `{userId, projectId}` with `workspacePredicate(db, p.userId)` plus `owner_user_id`. | Module activation and staff-role reviews are owner-only until converted. Staff roles are project application policy on visitor identities ([shared modules rule 2](shared-modules.md)): a member never receives staff authority and the reverse. |
| [`docs/job-envelope.md`](job-envelope.md#actor-references-and-current-admission) | The envelope reserves `membership: {id, revision}` and says a workspace owner has `membership` null with `accountId` equal to `ownerAccountId`. Runtime admission must refuse a member reference until WH-054 supplies a resolver. | This contract replaces the "owner has no membership" form ([Jobs](#jobs-receipts-and-immutable-history)); the envelope document is amended in the same change. No job may carry a member reference before then. |
| [`src/plan-features.ts:40–41`](../src/plan-features.ts) | `pro.members`, `pro.approvals` are `planned`. | Nothing is gated or advertised as delivered. |
| [`docs/data-lifecycle.json`](data-lifecycle.json) class `workspace-memberships` | Reserved, `planned`, no tables, requirements DP-02–05, packet WH-054. | Tables register in the same change that creates them. |
| `canonical-inputs.sql` `invitations`, `user_quota` | Platform signup invitations (`used_by`) and a 50-account total quota. | Workspace invitations are a **different** record and namespace. |

Measured against the composed current schema (`tools/current-schema.mjs` inputs built into an in-memory SQLite database, `PRAGMA foreign_key_list`, read-only; counts are heuristics, not proofs): **219 tables and 640 triggers; 111 tables hold a foreign key to `users(id)`** through 111 columns (105 `user_id`, 3 `owner_user_id`, and one each `owner_id`, `account_id`, `used_by`); 55 of those tables also carry `project_id`, 56 do not; 33 further tables reference `projects` only; **312 triggers mention `user_id`/`owner_user_id`**. `users` itself has three columns (`id`, `email`, `created_at`); `identity_accounts` holds the account state. A text count at the baseline finds `assertWorkspace` at **77 call sites in 31 files**, `workspacePrincipal` at 10 in 3 files, `requireFreshWorkspace` at 6 in 3, `workspaceTransport` at 3 in 3, and `workspacePredicate`/`admitWorkspace`/`workspaceBindings` at one to two uses each; handlers that use `user.id` directly in SQL without calling these helpers are not counted. These numbers bound the conversion cost, will drift, and are what the drift gate under [Coordinated current-schema consequences](#coordinated-current-schema-consequences) keeps honest.

## Terms, and who is not a member

- **Account**: one person's identity (passkeys, kit, sessions, personal profile and Chat). Defined by [workspace identity](workspace-identity.md). The `users` row is, and stays, an account.
- **Workspace (tenant)**: the unit that owns projects, versions, reviews, provider credentials, entitlements and the payer relationship. It is its own row and is never a person's account.
- **Acting context**: `{tenantId, actorAccountId, membershipId, membershipRevision, principal}`. **Every** actor, including a sole owner, acts through a membership; there is no "owner without membership" form once the tenant is not the account.
- **Member**: an account with an `active` membership row for a workspace. Role: `owner`, `editor`, `viewer` or `billing`. Optional explicit grants (off by default) extend an editor.
- **Not members and never promoted by this feature**: Creator guest reviewers (accountless expiring [preview links](guest-previews.md)); Business approved notification recipients ([contact notification destinations](contact-forms.md)); customer-application visitors and project staff ([access roles](shared-modules.md)); platform operators and the support/safety case surface; anyone holding only a copied link, role string, receipt or model statement.

## Invariants

1. **One identity, one authority path.** Members sign in with the same passkey/kit/recovery model; there is no member password, magic link, workspace-only login or separate recovery. Membership removal revokes only that workspace's authority and never a personal credential; an emergency personal key removal or recovery advances the account epoch and therefore ends every workspace access through that account at the next admission ([identity authority](identity-authority.md)).
2. **Membership is authority only when evaluated server-side at the effect.** A role, grant, selected workspace, cached view, Chat statement, saved interaction, preview link or receipt ID is not authority. Admission rechecks tenant, membership revision, role, grants, project scope and inclusion inside the committing statements.
3. **Spend, publication, provider writes, membership changes and ownership changes are separate capabilities** that no role holds by accident. An action with several effects needs **all** of them ([effect sets](#roles-grants-and-effect-sets)); the strongest effect never authorizes the others. Editors have none without an explicit grant; ownership and billing-plan authority are not grantable.
4. **Models prepare; named humans confirm.** Typed controls, exact immutable reviews and recent passkey proof for consequential effects are unchanged ([security register](security-risk-actions.md), [tenant authority audit](tenant-authority-audit.md)). Visitors, webhooks, scheduled rules and view rendering never invoke the owner maintainer or borrow member identity.
5. **Immutable history stays immutable.** Reviews, versions, receipts and published content keep the tenant and actor provenance they were created with. Ownership change is a new fact, never an update to history.
6. **Exit paths never depend on the paid feature.** Owner roster read, member removal, voluntary leave, export, disconnect and uncertain-effect readback stay reachable after plan loss ([feature loss table](plan-feature-contract.md#loss-of-eligibility-and-protected-access)). A revoked collaborator is never treated as a protected owner.
7. **Current-version only, honest recovery.** One current schema and API; stale clients and schemas fail explicitly; lost responses are resolved by authenticated readback, never by resending.
8. **Providers' consent is personal and never moves implicitly.** An OAuth authorization belongs to the person who gave it. Ownership change, project move or role change never re-labels, re-seals or reuses it for someone else.

## Ownership, transfer and the tenant key

The WH-054 packet requires an owner-transfer lifecycle. This section keeps that requirement intact: **full transfer** means the accountable owner becomes another account while the workspace, its projects, `{projectId}.whumpo.site` URLs, immutable history and uncertain-operation authority are preserved, and the departing owner may then delete their personal account without losing any of it. A co-owner is not a substitute.

### Three different operations

| Operation | What changes | What must not change | Needs a tenant that outlives one person's account? |
| --- | --- | --- | --- |
| **Co-owner addition** | A second account holds the `owner` role. | Tenant identity, payer, custody, history. | No, but the workspace then lives or dies with whichever account anchors it. |
| **Owner authority transfer** | Accountable owner and payer-of-record become another account; the sender leaves or takes a lesser role. The sender's personal account is untouched and may later be deleted. | Workspace ID, project IDs and URLs, immutable versions/reviews/receipts, published sites, uncertain-operation authority. | **Yes**, unless the sender's login row *is* the tenant row. |
| **Project transfer** | One project moves between two workspaces. | Project ID and URL, immutable history and its origin provenance. | Yes. **Not designed here** ([below](#project-transfer)). |

### What a transfer must preserve

| Invariant | Evidence in current source |
| --- | --- |
| Immutable tenant on reviews/receipts | 62 immutability triggers on `user_id`/`owner_user_id`; `publication_action_identity` refuses any change to `user_id`. |
| Payer / liability | `stripe_customers`, `stripe_subscription_orders`, `stripe_subscriptions`, `stripe_paid_invoices` are keyed by `user_id`; the confirm guard reads the plan of `NEW.user_id`. |
| Secret custody | Provider token ciphertext is sealed with context `whumpo:github:token:{user}:{tokenId}` ([`github-grant-revocation.ts:42`](../src/github-grant-revocation.ts), [`connection-vault.ts`](../src/connection-vault.ts)); rewriting the owner without resealing makes it undecryptable. An authorization is also personal consent by whoever gave it. |
| Account deletion | 86 cascades plus 24 `NO ACTION`/`RESTRICT` references already make raw `DELETE users` unusable; a person who leaves must neither take the workspace with them nor leave personal data in it. |
| Personal identity separation | Passkeys, kit, sessions, profile and private Chat belong to the account. |
| Stable public identity | `siteURL(projectId)` in [`src/publications.ts`](../src/publications.ts); custom domains point at the project. |
| Uncertain operations | In-flight revocation/dispatch authority survives the owner who started it ([job envelope `platform-obligation`](job-envelope.md#actor-references-and-current-admission)). |
| Safety preservation | Triggers block account/project owner changes and deletion under a hold (`safety_hold_project_owner`, `safety_hold_account_retained`). |

### Candidate architectures

| | **A. Account-anchored tenant** (tenant = first owner's `users.id`) | **B. Re-key in place** | **C1. Workspace as a `kind` row in `users`** | **C2. Dedicated `workspaces` table** (tenant columns re-pointed to it; actor columns keep `users`) |
| --- | --- | --- | --- | --- |
| Immutable provenance | Preserved | **Refused**: relaxes 62 immutability triggers | Preserved | Preserved |
| Payer / custody | Anchor stays payer and custodian | Custody must be resealed | Workspace row | Workspace row |
| Original account deletion | Deletes the workspace unless blocked | Safe only after the rewrite | Possible; **only triggers** stop a cascade or a person ID landing in a tenant column | **Structural**: no foreign key from a workspace to a person, so no cascade exists |
| Person vs tenant typing | Collapsed | Collapsed until rewritten | **One FK type for both**: all 111 columns still accept either kind; every tenant column needs a kind-guard trigger, and an unconverted handler that passes `user.id` silently compiles, runs, and reads or writes under the wrong key | **FK-typed**: tenant columns reference `workspaces`, so a person ID cannot be stored as a tenant; stale SQL naming the old column fails loudly |
| `users.email` hazard | n/a | n/a | A workspace row needs a placeholder email that delivery code could use | None: workspaces have no email |
| Delivers full owner transfer | **No** | Only by violating immutability | Yes | Yes |
| Disruption under the current-schema rule | Lowest | Very high trigger/review risk | Low DDL, but the same source/test conversion as C2 | Highest DDL (up to ~108 tenant columns, ≤312 triggers), same source/test conversion as C1 |

### Why in-place re-keying is refused (not "impossible")

Option B would update tenant columns that dozens of triggers make immutable, reseal provider tokens under a new context and move a payer record, all while claiming immutable reviews are unchanged. Each step is technically possible; together they defeat the invariants that make reviews trustworthy, and resealing a token transfers one person's provider consent to another. **B is refused by the project's own invariants, not by technical impossibility.** The statement "transfer cannot be done without an organization rewrite" is not proven either: it is true only if the tenant key must be the departing person's row (A) or change in place (B).

### Engineering decision: C2, a dedicated `workspaces` tenant (proposed; engineering, not an owner question)

The first draft recommended C1 on least-DDL grounds. That argument does not survive the project's own rules, and C1's cost was understated:

1. **The DDL saving is not real here.** The platform has one current schema and a reviewed empty-database cutover; there is no data to preserve, so rewriting canonical inputs and triggers costs source churn, not migration risk. Meanwhile **source and test conversion is required under C1 as well** ([below](#converting-every-workspace-owner-path)): the tenant is no longer the account, so every owner path changes regardless. C1 saves only the column renames, and only by giving up typing.
2. **C1 overloads a person and a tenant across 111 columns.** One foreign-key type for both means correctness depends on a guard trigger on every tenant column and on every handler choosing the right ID forever. The failure mode is silent mis-tenanting (an account ID written as a tenant, or a workspace ID read as a person), which is exactly the tenant/actor confusion this contract exists to prevent. C2 turns most of that class into a foreign-key or compile-time failure.
3. **C2 makes the deletion invariants structural.** A person's account deletion cannot cascade into a workspace because no such reference exists; the workspace-closure path ([below](#workspace-closure-and-personal-account-deletion)) is therefore the only way a workspace is removed, and it is explicit.
4. **Honest costs of C2.** Tenant-scoped tables (the 111 `users`-referencing tables minus the account-scoped ones; the 33 project-only children derive their tenant through the project and need review) change key and triggers, including the 57 triggers that repeat `owner_user_id = NEW.user_id` and 62 that enforce immutability of the tenant column (both re-counted October 8 by text pattern); Stripe, vault, entitlement-coverage and budget tables move to the workspace; sealing contexts are rebuilt on the workspace ID plus the authorizing account. No prototype has been built, so the effort is **unmeasured**: the schema child must start with the classification registry and a composed in-memory build under the new keys, and its exit gate includes the unchanged owner suites ([verification](#verification-and-acceptance-gates)). If that spike shows C2 cannot be completed within one reviewed cutover, the fallback is C1 **with** a kind guard on every tenant column, not option A.

Shape (conceptual; names follow repository conventions at implementation):

- `users` stays an account (`id`, `email`, `created_at`) and `user_quota` counts accounts only. A new `workspaces` row holds the tenant: ID, state (`active`, `closing`, `closed-held`), an **ownership epoch** and a revision. It has no owner column and no email.
- **Ownership is only memberships.** `workspace_memberships` rows carry workspace, account, role, grants, scope, state, revision, a pseudonymous per-(workspace, account) `actor_ref`, and the collaboration epoch ([durable suspension](#plan-eligibility-downgrade-and-durable-suspension)). A database guard keeps every `active` workspace at ≥ 1 active owner.
- Tenant columns are named `workspace_id` and reference `workspaces`; account columns keep `user_id`; tables that need both (reviews, receipts, Chat) carry `workspace_id` plus actor provenance columns. Immutability triggers move to `workspace_id` and are unchanged in effect.
- **Creation.** A person's first workspace and owner membership are created in one transaction after identity completion, at the first-project welcome, so deployed identity ceremonies stay untouched.

### Coordinated current-schema consequences

All of these are done in one reviewed empty-database cutover under the [release rules](releases.md); there is no conversion of existing test accounts.

- **Classification gate.** Every `users`-referencing table is classified exactly once as *workspace-scoped* (tenant), *account-scoped* (a person) or *both* (tenant plus actor provenance), in a registry beside the lifecycle catalogue; a check fails when a new table is unclassified, mirroring `tools/lifecycle-catalog.mjs`. Obvious account-scoped tables include identity, eligibility, profile and platform-signup invitation tables; provider vaults and connections, billing, budgets, fair-use/usage reviews and project-level safety receipts are tenant-scoped; Chat, workspace preferences and layout receipts need a per-table decision. This document does not pre-classify beyond that.
- **Roots and cascade.** `projects` and every tenant root reference the workspace; identity tables reference accounts. Tenant tables cascade from `workspaces` (used only by closure). Actor provenance references an `actor_ref` that survives person deletion without an email or credential.
- **Provenance columns.** Review/receipt tables that members can reach gain `prepared_by`/`confirmed_by` actor references plus membership ID and revision at prepare and confirm; tenant columns stay as they are.
- **Billing.** Stripe customer/subscription/invoice rows and entitlement coverage attach to the workspace; the account that completes checkout is recorded as payer-of-record provenance. See *Payer on transfer*.
- **Custody.** Sealing context binds workspace and authorizing account; the vault records who authorized.
- **Lifecycle, closure inventory, export, restore suppression** register in the same change ([Audit and lifecycle](#audit-lifecycle-protection-export-and-restore)).
- **Collisions.** Open pull requests change the same files ([Sequencing](#sequencing-with-unmerged-work)); reconcile before any code starts.

### Converting every workspace-owner path

Under C2 the old rule "the account is the tenant" is never true, so the pre-existing owner behavior cannot be preserved by leaving `admitWorkspace`/`workspacePredicate` as they are: they would deny every owner. The contract is therefore **convert all of them, in the same cutover, and let anything unconverted fail rather than guess**.

1. **One acting-context admission replaces the account-equals-tenant helpers.** `admitWorkspace(db, principal)` stays an *account-level* identity admission. A new tenant admission takes the principal, an explicit `tenantId` and the action's [effect set](#roles-grants-and-effect-sets) and returns a scoped database. The old tenant-taking helpers (`assertWorkspace(db, userId)`, `workspacePredicate`, `requireFreshWorkspace`, `workspaceTransport`, `workspaceBindings`, `workspacePrincipal`) are **removed**, not aliased: a signature that accepts an account ID as a tenant must not exist. Every one of the call sites counted above, every `user.id` that reaches tenant SQL, and every maintenance/background entry that reads tenant data is converted.
2. **Conversion does not widen anyone.** A converted former owner path is registered `owner`-only until a later child adds roles to it. Conversion changes the key, not who may act.
3. **Unconverted code fails closed, in layers.** (i) The removed exports make `pnpm check` fail. (ii) Renamed tenant columns make stale SQL error. (iii) Foreign-key typing rejects a person ID as a tenant. (iv) An AST-level test (the compiler-based method of the open [boundary audit](#sequencing-with-unmerged-work); not text search) enumerates routes, Chat actions, bindings, job runners and maintenance entry points and fails on any that reaches a tenant table or statement without an acting context or an explicit platform-obligation actor.
4. **Tests preserve behavior, not predicate equality.** The existing single-owner suites (feature admission, workspace admission, publications, identity HTTP, shared modules, guest previews, account closure and others) keep their assertions on status codes, rows, receipts and ordering. Only the fixture seeding changes (create account, workspace and owner membership). No test may assert that an account ID equals a tenant ID. The conversion PR lists the test inventory before and after and every changed assertion with its reason; a weakened assertion is a review blocker. The same suites then run with non-owner contexts and must deny exactly what is not registered.
5. **No partial state ships.** The new keys are a schema change, so the automatic deploy refuses it and merge waits for an owner-authorized cutover; the conversion lands complete or not at all. It is large (the dominant cost of child 1) and may be built as a series of reviews on an integration branch, but only a fully converted tree merges.

### Owner-authority transfer lifecycle

States are `proposed → accepted → completed`, with `cancelled`, `expired` and `refused` as terminal alternatives. There is no persisted `committing` state: commit is a single guarded batch with no external call inside it.

1. **Propose** (current owner, fresh passkey, exact review). Fields: workspace, recipient (must already be an *active member* of this workspace), what the sender becomes (`leave`, `viewer`, `editor` or `billing`; **not** `owner`), a digest of the plain-language liability and custody statement shown, and an expiry (proposed seven days, no extension). At most one open transfer per workspace.
2. **Accept** (recipient, fresh passkey). The recipient acknowledges payer and custody responsibilities by digest. Acceptance changes nothing yet.
3. **Complete** (sender still owner, recipient still active, same ownership epoch and membership revisions, workspace `active`, **no blocking hold** ([holds](#safety-holds)), `pro.members` inclusion not required for the move itself): one batch (a) promotes the recipient to owner, (b) applies the sender's new role or removal, (c) advances the ownership epoch, (d) voids pending reviews, invitations and member-prepared jobs, (e) records unique completion and audit rows, (f) records post-commit obligations. D1 batches are sequential and roll back together ([D1 batch behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/)); external effects are never inside it.
4. **Post-commit obligations** run as separate receipts under a platform-obligation actor that survives the sender's session: revoke the sender-authorized provider connections through the existing revocation path (the recipient must give their own consent; nothing is re-sealed, relabeled or reused), stop sender-authorized backups, pause rules the sender approved until the new owner re-affirms them. An unknown revocation outcome stays visible and keeps its reconciliation authority.
5. **Recovery.** A lost reply is resolved by authenticated readback of the transfer ID by either party. Retried acceptance or completion with the same request identity returns the stored result; a changed payload is `409 request_conflict`. A stale epoch, revision or non-active state is `409` and needs a new proposal. The sender can cancel before completion; after completion there is no undo, only a new transfer.
6. **After completion the sender may delete their personal account** subject only to the closure rules for what they still hold ([below](#workspace-closure-and-personal-account-deletion)); the workspace, projects, URLs and history are unaffected.

**Payer on transfer (unresolved commercial detail, see [questions](#remaining-product-questions)).** Completion changes *who may act*, not who is charged. Whumpo must not silently charge a new person or move a payment method. Proposed default: the already-paid interval continues; the recipient starts their own subscription in their own right (sandbox flow only until real-money activation); the previous payer keeps cancel-at-period-end until the interval ends; with no replacement coverage at expiry, ordinary downgrade rules apply. Proration, refund or card transfer are outside this contract.

### Co-owner addition

Optional, explicit, and never described as a transfer. Only an existing owner can add an owner, by invitation ([owner-only role](#invitations-and-membership-lifecycle)); the recipient accepts with a fresh passkey; any owner can remove a non-owner; removing or demoting an owner requires that owner's own action unless a documented owner-recovery decision is made (unresolved). The last-owner rule applies. Co-owners keep owner authority regardless of plan; *adding* one requires current `pro.members` inclusion.

### Project transfer

**Not designed and not promised.** It is deferred; this section only fixes the constraints the schema must obey so a future design is not precluded and so history cannot be silently reattributed. Today `projects.owner_user_id` is mutable, and children repeat `owner_user_id = NEW.user_id` as a *creation-time* check, so a naive move would make old immutable receipts appear to belong to the destination.

1. **Origin provenance is immutable.** Every review, version, receipt and audit row keeps its own immutable `workspace_id`. Nothing reads `projects.workspace_id` to attribute a historical row; a test fails any authorization, export, billing or audit query that joins a historical row to its project's *current* workspace to find its tenant.
2. **The creation-time check stays creation-time.** "Child workspace equals project workspace" is enforced when the child is created, not as a standing invariant. The project's own `workspace_id` is immutable in this contract (the same effect as an owner-change refusal today); a future project-transfer child lifts that for one reviewed operation only.
3. **A move is a new fact.** A future design adds a transfer receipt in both workspaces and treats pre-move history as origin history: readable by the destination only through explicit rules, never inheriting the source's approvals, grants, provider connections, domains, guest links or uncertain operations. Those per-resource rules and the destination's billing/quota effect are **unknown** and need their own contract.
4. Until then the supported path is the portable export/import of the WH-077 [export boundary](roadmap/composition-architecture.md#9-export-a-recoverable-application-with-honest-portability-boundaries), with new immutable versions and re-granted provider consent; it is not called a transfer.

## Roles, grants and effect sets

A role never maps to an endpoint's single "danger level". Every registered action declares an **effect set**: the non-empty set of consequence classes its committed effects can have. Authorization is the **conjunction**: the actor's role must allow every class in the set and the actor must hold the grant required by every class in it. An action without a declared set, a role without a mapping for a class, or an effect set smaller than the effects its payload can have, is denied.

| Class | Examples | Owner | Editor | Viewer | Billing |
| --- | --- | --- | --- | --- | --- |
| `read` | Project status, versions, previews, saved reviews, approvals queue (read) | ✓ | ✓ in scope | ✓ in scope | workspace plan/usage summary only |
| `private-write` | Draft changes, private specification apply, layout, comparisons | ✓ | ✓ in scope | — | — |
| `limited-exposure` | Expiring, revocable guest preview links | ✓ | ✓ with `creator.guest-feedback` | — | — |
| `public-effect` | Publish, restore live, unpublish, activate a form/module or widen visitor access | ✓ | grant `approve-release` | — | — |
| `provider-effect` | OAuth connect/disconnect, backups, DNS, hosting, connector actions | ✓ | grant `manage-connections` | — | — |
| `spend` | Premium/advanced model approvals, future domain purchases | ✓ (existing exact approval) | grant `approve-spend` (not a default) | — | — |
| `membership` | Invite, change roles/grants/scope, remove | ✓ | grant `manage-members`, limited as below | — | — |
| `ownership` | Add/remove owner, transfer, close workspace, delete project, change payer | ✓ only | — | — | — |
| `billing-read` | Plan, invoice intervals, usage summary | ✓ | — | — | ✓ (read-only; owner decision) |
| `export` | Supported project-content export | ✓ | ✓ in scope | — | — |
| `uncertain-readback` | Read-only reconciliation of unknown provider outcomes | ✓ | holder of that class's grant, if still active | — | — |

Rules:

- **No weakest-class bypass, no strongest-class shortcut.** A release that publishes (`public-effect`), dispatches to a provider (`provider-effect`) and reserves premium spend (`spend`) has the effect set `{public-effect, provider-effect, spend}`. Confirming it needs `approve-release` **and** `manage-connections` **and** `approve-spend` (an owner holds all three). Holding `approve-release` alone confirms nothing that also touches a provider or spend.
- **The effect set is computed from the immutable review, not declared by the caller.** The review type declares which effects its payload can carry; the prepared review's digest fixes the *actual* set (destination, provider, spend estimate present or absent). A confirmer lacking any required grant cannot confirm; the review stays pending for a holder.
- **Enforcement is at the sink, not only at the entry.** Each effect sink (publication commit, provider dispatch through `workspaceTransport`, spend reservation, membership change, ownership change) takes the acting context and adds its own class check to its committing batch. An entry whose declared set omits a class its code reaches therefore fails at that sink; the registry test also fails it statically.
- **Or review the effects separately.** An action whose effects belong to different authorities may be split into independently reviewed steps, each with its own class, approver and receipt (for example a publication review and a separate connection review). A combined action never runs under the weaker step's authority.
- **Grants are explicit, owner-assigned, off by default and not transitive.** Four grants only: `approve-release`, `manage-connections`, `approve-spend`, `manage-members`. **Only an owner assigns, changes or revokes a grant.** Nobody can grant more than they hold. No role may self-escalate; a member cannot change their own role or grants.
- **`manage-members` is bounded.** A holder may invite viewers, and editors **without grants**, only for projects inside their own scope, and may remove viewers and editors; they cannot invite or promote to owner or billing, assign grants, change an owner, or widen a scope beyond their own.
- **Billing is read-only (owner decision).** It sees plan, invoice intervals and usage summary. Purchasing, payment method, subscription start/cancel and spend approvals stay with the owner. Making billing a purchaser would be a new decision that also needs the real-money gate.
- **Standard AI for members (owner decision).** Editors may use standard assistance within the workspace's fair-use envelope, attributed per actor for abuse review and **zero customer units**; this adds no allowance, seat or price. Any premium or advanced-model spend needs `approve-spend` **and** an exact premium approval; no member request funds premium work implicitly. The owner's answer covered editors only: viewers and billing receive **no model-prepared work** and use direct controls (the conservative default; see [unknowns](#remaining-unknowns)).
- **Resource scope.** A membership covers *all projects* or an *explicit list*; new projects do not join a list automatically; owners always cover everything. Dashboards, usage and history are filtered on the server by the actor's scope ([Chat interactions](chat-interactions.md#shared-authority-and-eligibility)).
- **Chat privacy.** Transcripts and drafts are private to the acting account within a workspace; model context is built from the actor's authorized projection. Rosters, member emails and invitation tokens never enter model context or Chat history.

## Acting context and admission

- **Tenant admission.** Described in [Converting every workspace-owner path](#converting-every-workspace-owner-path): account-level `admitWorkspace` is unchanged; a tenant admission adds the membership clause to the **same** `identity_admission_checks` insert, so the identity predicate and the membership clause commit or abort together.
- **The clause** requires at the committing instant: workspace `active`; an `active` membership for (workspace, actor) with the revision read at admission; role in the allowed set of **every** class in the effect set; the grant bit for each class that needs one; project inside scope; the ownership epoch unchanged; and for a non-owner role the [collaboration lease](#plan-eligibility-downgrade-and-durable-suspension) current for the membership's epoch **and** `pro.members` inclusion current. Revocation, role change, transfer, suspension or closure between admission and commit aborts the batch.
- **Explicit workspace, never ambient.** Every request names its workspace or resolves it from a project ID whose single tenant is then checked against the actor's membership. Missing or ambiguous is `400`; a project in another workspace is `404`. A cookie or client-side "current workspace" is a hint only. Caches key on (tenant, actor, membership revision) and are discarded on switch.
- **Handler registry and allowlist.** A closed registry maps each converted handler or binding to `{effect set, allowed roles, required grants, feature, operation}`. A non-owner context may reach only registered handlers; a test enumerates routes, Chat actions, bindings and jobs and fails on any unregistered one.
- **Actor-aware feature admission.** `featurePredicate` takes the acting context: inclusion keyed by the workspace, the actor half is the membership clause. For an owner context in a single-owner workspace it must produce the same decisions as today.
- **Provenance rule.** Tenant columns record whose workspace; separate columns record the preparer and confirmer (actor reference, membership ID, revision). A review prepared and confirmed by one member records that actor twice; it is never rewritten to look like the owner.
- **Shared module principals.** The `owner` module principal gains the tenant/actor split through the same context; `visitor`, `staff` and `public` principals are unaffected and never accept a workspace cookie.

## Approvals and release authority

- **Preparer and approver are separate fields.** A member with `private-write` may prepare a consequential review. Confirmation needs the [grants for the review's whole effect set](#roles-grants-and-effect-sets), a **fresh passkey assertion** (the existing ten-minute window) and the existing exact-review binding (immutable version/source/data digest, destination, policy, current revision). The receipt records preparer and approver membership ID and revision.
- **Owner decision (recorded).** A release prepared by an editor must be approved by **another** account who is an owner or an explicitly granted approver (`approve-release`, plus the other grants the effect set needs). **An editor can never approve a review they prepared, even holding every grant.** The rule at commit is: `approver ≠ preparer`, unless the preparer is an **owner**, who retains self-approval (a sole owner behaves exactly as today). If no other eligible approver exists, the editor's review stays pending until an owner acts; it never degrades to self-approval.
- **Reuse, not a new engine.** Approval wraps the existing review types (publication, specification, service client, application, domain, connection, module activation). A shared review-class registry assigns each its effect set so staging promotion and bulk-change work reuse it later.
- **Withdrawal.** Unpublish and rollback are `public-effect` actions; no editor may take a site offline without `approve-release` (conservative; emergency safety withdrawal by the platform is unaffected).
- **Queue.** Pending reviews are visible to eligible approvers through a read binding; opening one never approves it. Existing ten-minute review windows are unchanged and independent of membership.

## Invitations and membership lifecycle

### Invitation contract

A workspace invitation is its own record, never a platform signup invitation. Fields (conceptual): workspace, proposed role, grants and scope (immutable once issued), inviter membership ID and revision, a hash of a 256-bit random secret shown once to the inviter, a masked contact hint, state, expiry. The secret follows the guest-link rules: stored only as a hash, never in Chat, model context, logs, analytics or exports.

- **Existing completed accounts first (owner decision, recorded).** The invitee must already hold a *ready* account. An invitation never creates an account and never changes the deployed signup ceremonies, eligibility, Turnstile or the 50-account quota. In the invite-only test stage the invitee arrives through the ordinary platform invitation first. Invite-as-signup is out of scope; adding it later would be a new identity-workstream decision.
- **Possession is required; an email address alone is never authority.** Acceptance needs (1) possession of the secret, (2) a ready account with a current passkey session (an `enrolling` or `recovering` account cannot claim and its progress is untouched), (3) the inviter's authority still current, (4) current Business Pro inclusion and the member bound not exceeded, (5) the confirmation step below.
- **Grants and elevated roles are owner-only.** An invitation that carries **any grant**, the `billing` or `owner` role, or a scope wider than the inviter's own can be **issued and confirmed only by an owner**. A `manage-members` holder may issue only the bounded invitations in the [rules](#roles-grants-and-effect-sets).
- **Claim then confirm.** The recipient claims; the inviter side sees a masked account label and confirms. Confirmation runs in the committing batch and **rechecks everything**: the confirmer's current membership revision, role and grant, the invitation's role/grants/scope still inside the confirmer's authority (an owner always qualifies), workspace `active` and ownership epoch unchanged, `pro.members` inclusion, the bound, and that the invitation is unexpired, unrevoked and unclaimed by anyone else. If the original inviter lost authority, the claim waits and any owner may confirm the same immutable content. Owner and grant-carrying confirmations need a fresh passkey. Activation without confirmation exists only for a viewer-only invitation the inviter opted into at issue time; its activation batch performs the same rechecks. First valid claim wins; a second claimant gets the same generic response as an expired or unknown secret.
- **Expiry**: seven days is the proposed routine default and maximum; shorter allowed; no extension. Request IDs make issuance idempotent; pending invitations and issuance rate are bounded.
- **Delivery**: owner-delivered link first (as with guest links). Platform email is a later adapter through the shared job outbox, content-minimal, outside first acceptance.

### Membership lifecycle

States: `invited` → `claimed` → `active` → `suspended` (durable, see [below](#plan-eligibility-downgrade-and-durable-suspension)) → `removed` or `left` (terminal tombstone; the same account can later be invited again as a new membership). Every change increments the membership revision and, where it affects access, the workspace access revision. Unique (workspace, account) among non-terminal memberships; one person holds many memberships.

- **Bound.** A per-workspace active-membership limit with a proposed default of **5** is an engineering and abuse limit, not a seat allowance, price or promise; whether it counts owners and how pending invitations count are [unresolved](#remaining-product-questions). Pricing copy must not mention it.
- **Last owner.** An `active` workspace always has ≥ 1 active owner. Removal, voluntary leave, demotion, personal-account deletion and transfer all enforce this in the committing statements (a guard that sees the preceding statements of the same batch), so two owners demoting each other concurrently leave exactly one. The only zero-owner workspace states are `closing` and `closed-held`, which are platform-continued ([closure](#workspace-closure-and-personal-account-deletion)).
- **Removal and leave** take effect at the next admission; authority is evaluated per request, so no workspace session needs revoking. Effects on the member's reviews, drafts, invitations and connections follow the [invalidation matrix](#invalidation-matrix).
- **Cross-workspace isolation.** Authority never crosses workspaces; IDs from workspace A presented in B are `404`; roster and audit reads are workspace-scoped.
- **Single-owner isolation.** A workspace whose only member is its owner behaves as today.
- **Member-only accounts.** Whether an account holding only memberships may enter member surfaces without creating its own workspace is [unresolved](#remaining-product-questions).

## Plan eligibility, downgrade and durable suspension

Non-owner access requires current Business Pro inclusion (`pro.members`; `pro.approvals` for approver confirmations) for the *workspace*, evaluated by the existing inclusion predicate. Owner authority does not depend on the plan, but owner `membership`-class actions (invite, role change) need current `pro.members`; exit paths do not.

**Problem.** Inclusion is derived from invoice intervals. If suspension were only "inclusion is false right now", a workspace that lapsed and later bought a new invoice would silently restore every non-owner. The owner's rule is the opposite: **loss is sticky; regain does nothing until an owner explicitly resumes.**

**Design: a coverage lease that can only deny.** One `workspace_collaboration` row per workspace holds `state` (`enabled`, `suspended`), a collaboration `epoch`, `covered_until` and a revision. Each non-owner membership records the epoch it was activated or last resumed under.

1. **Effective non-owner access = membership `active` ∧ membership epoch = workspace epoch ∧ `state = enabled` ∧ `unixepoch() < covered_until` ∧ the inclusion predicate currently true.** The lease is an additional condition in the admission clause; it never grants access the inclusion predicate would deny, so a future coverage retraction (see 5) cannot be hidden by a valid lease.
2. **Enable.** The first non-owner membership activation requires current inclusion and creates the row with `epoch = 1` and `covered_until` = end of the contiguous coverage chain containing now.
3. **Extend only across a contiguous successor.** `covered_until` may advance, in a conditional update inside the admitting batch (so ordinary renewals need no operator), only to the end of the chain of paid intervals each of which starts **at or before** the stored `covered_until` (a bounded recursive query over `stripe_paid_invoices` through the `plan_entitlements` view). The test is on stored data, not on when the write happens: a renewal after a real gap has `starts_at > covered_until`, can never extend the lease, and so cannot restore access regardless of whether anything observed the gap. Because invoices are immutable and only grow, lapse is purely the passing of time past `covered_until`; no write is needed at the moment of loss for correctness.
4. **Observe and record.** Any admission that finds a non-owner denied for lapse, the hourly maintenance pass and every owner roster read run the same idempotent observer that moves `enabled → suspended` with `suspended_from = covered_until` (the lapse time, not the observation time), appends the audit event `collaboration_suspended`, voids pending invitations and member-prepared reviews and stops unsent member jobs. A missed or late observation delays visibility only; the lease already denies.
5. **Revocable coverage.** Preview grants can be revoked, and a future refund/dispute design may retract coverage. Any such event must, **in its own transaction**, write `suspended` (a trigger or the same batch), because a lease with time remaining would otherwise outlive it and re-admit members when coverage returns. The billing change that introduces retraction carries this requirement; today only the revocable preview grant needs it.
6. **Resume is an explicit owner action.** `resumeCollaboration` is a reviewed exact action (owner, fresh passkey, current inclusion required) listing the memberships to resume by ID, revision, role, grants and scope. Commit sets `state = enabled`, increments `epoch`, recomputes `covered_until` from the coverage in force at that moment, and sets each listed membership to the new epoch with a bumped revision. Unlisted memberships stay suspended; invitations and member-prepared reviews voided by the lapse are reissued/re-prepared, never revived. Two concurrent resumes: one wins on the workspace revision, the other receives the stored result.
7. **Observability.** The owner roster and `workspace.access@1` always show the *derived* truth even before the observer writes: "paused: plan coverage ended <time>; resumable" or "not resumable: no current coverage". A non-owner sees "your access is paused by the workspace" without plan or billing detail. The audit log carries suspension (with lapse time), failed resume attempts, and resume with the listed memberships. Nothing resumes without an `owner` actor in the audit.
8. **No grace.** Grace periods and retention of suspended rows are not approved ([questions](#remaining-product-questions)); until decided, access ends exactly at `covered_until`.

On loss, as before: non-owner reads, edits, approvals, Chat and jobs are denied; content and published sites are untouched; unsent member-prepared reviews cannot be confirmed by non-owners; scheduled work approved by a member stops before dispatch; the owner keeps roster read, removal, export, disconnect and uncertain-effect readback; reconciliation cannot create a new side effect. A former collaborator is never given protected-history access. **Entitlement is not billing authority:** inclusion shows who may use the feature; it grants no spend and no payer change.

## Invalidation matrix

Prepared reviews bind the preparer's membership ID and revision; approvals are checked against the approver's current membership at commit. A membership revision change voids that member's *unconfirmed* non-read reviews (strict and simple; they re-prepare).

| Event | Pending prepared reviews | Approval at commit | Drafts / interactions | Unsent jobs | Invitations issued | Provider credentials the member authorized |
| --- | --- | --- | --- | --- | --- | --- |
| Role, grant or scope change of member M | M's unconfirmed reviews void | Checked against M's current authority | Read-only forms close | Jobs on M's old revision void | Kept if M still holds `manage-members` | Kept if M still holds `manage-connections` |
| M removed, left or suspended | Void | Fails | Cleared on detection | Void | Void | Revoked or disconnected through the existing path |
| M's personal identity epoch advances | All of M's workspace authority fails at next admission | Fails | Clears on next read | Void | Void | Unchanged until M's membership ends |
| Plan lapse / lease expiry | Non-owner confirmation denied | Denied | Denied | Stop before dispatch | Void | Unchanged; disconnect stays available |
| Ownership transfer completes | All pending non-read reviews void | Fails if prepared before | Cleared | Sender-actor jobs void | Void | Sender-authorized connections revoked, not reused |
| Project leaves M's scope | Void for that project | Fails for that project | Cleared for that project | Void for that project | n/a | n/a |
| Workspace enters `closing` | Void | Fails | Cleared | Void | Void | Revoked by the closure step |
| Target revision changes | Existing review rules apply (stale) | Existing rules | n/a | n/a | n/a | n/a |

Open minor items: guest preview links issued by a removed member are kept and flagged issuer-removed (proposed); an approver's removal pauses only the rules they approved in the public/provider/spend classes (proposed).

## Jobs, receipts and immutable history

- **Jobs.** The envelope's `actor.membership {id, revision}` becomes the **only** workspace actor form (an owner also has a membership); the envelope document and prototype are amended in the same change and a legacy "membership null" shape is rejected. It is admitted only by this resolver. Dispatch and commit re-resolve tenant, membership revision, role, grants, scope, lease and inclusion; a mismatch rejects the stale snapshot. Claims, restored journals and operator re-drive create no authority. Replays and retained history recheck current membership before disclosing a receipt.
- **Receipts and reviews are append-only facts** recording tenant, actor reference, membership ID and revision at the time. A removal changes future authority, never past receipts.
- **Uncertain operations** keep their original authority record. After ownership change or removal, readback is owner-only (or the live grant holder) and a platform obligation completes revocation. Nothing is re-sent because a member left.
- **Rules and automation** do not invent member authority: a rule approved under a membership is paused for public/provider/spend effects if that membership ends, until an owner re-affirms it.

## Audit, lifecycle, protection, export and restore

- **Audit (proposed).** An append-only, content-minimized workspace log: invitation created/claimed/confirmed/expired/revoked, role/grant/scope changes, removal and leave, suspension (with lapse time) and resume, transfer and closure steps, and approvals as references to the underlying review. Each event records workspace, event kind, pseudonymous `actor_ref`, subject reference, membership revision before and after, request ID and time. **No email, token, credential, Chat or content.** Readable by owners and `manage-members` holders; a member sees events about themselves. It survives member removal and personal-account deletion because the actor reference is pseudonymous. Retention is not approved.
- **Lifecycle class.** Fill the reserved `workspace-memberships` class and any new classes in the same change as the tables; run the lifecycle catalogue check. Role-filtered owner views; no model or third-party processor; invitation secrets hashed; classification under [data protection DP-02–05](data-protection.md).
- **Export.** Owner roster export (labels, roles, grants, scope, dates; no emails unless later approved, never tokens). A person's own account export includes their memberships. Workspace export is owner-only.
- **Restore suppression.** A restored backup must not resurrect removed members, claimed invitations, completed transfers, suspensions or a closed workspace: independent tombstones with revisions are checked at restore admission ([data lifecycle LC-08](data-lifecycle.md), [restore admission](restore-admission.md)). A restored receipt confers no authority.

### Workspace closure and personal account deletion

The first draft said the last owner can never be removed or delete their account, yet also refused deletion only for a sole owner with other members. These are reconciled as one rule:

> **A personal account cannot be deleted while it holds any active `owner` membership**, whether or not other members exist. The owner first resolves each such workspace by one of: transfer ([lifecycle](#owner-authority-transfer-lifecycle)), removal or demotion by another owner, or **explicit workspace closure**. Deletion is refused with a clear reason otherwise. A person who is only an editor, viewer or billing member may delete their account; their memberships are tombstoned first, in the same closure transaction.

**Workspace closure** is a distinct, reviewed, resumable operation owned by the workspace, modeled on the account-closure design (exact review, fresh passkey, durable closure row, journaled idempotent steps; [account closure](account-closure.md)):

1. **Review and confirm** (an owner, fresh passkey). The review names the workspace, counts projects, live sites, members, pending invitations, provider connections, domains and unresolved operations, and lists exactly what remains after closure (customer-owned repositories and zones, copies already downloaded, provider-side data, backups until expiry). It states plainly if other members will lose access. A model cannot approve closure; any required prior actions (disconnect domains, remove CMS sites and the like) are listed as blockers, as for account closure.
2. **Freeze.** The workspace becomes `closing`: non-owner access ends first, invitations and open transfers are cancelled, member-prepared jobs void, and ordinary workspace batches abort. Members' personal accounts are untouched.
3. **Withdraw, revoke, hold check, reconcile, purge** in the order and with the semantics of account closure (public serving withdrawn, provider authorizations revoked through the existing paths, unresolved operations reconciled rather than re-sent, then deletion of tenant data). The closure row and journal carry no foreign key to the workspace or to any person and remain as the final receipt.
4. **Continuation without an owner.** A `closing` workspace is continued by the platform maintenance pass, not by any person's session, so the initiating owner may delete their personal account once closure has *started* without stranding the tenant. Because workspaces have no foreign key to accounts, there is also no hidden cascade in either direction: deleting an account never deletes a workspace, and closing a workspace never deletes an account.
5. **A sole owner with no other members** does the same two steps in order: close the workspace, then delete the account. A combined account-closure review may present both as one chained flow, but each stage keeps its own durable receipt and either can stop, resume or be refused independently. A sole owner **with** other members has the same two-step path; the review shows the member count and the members are told access ended without any content of the workspace.
6. **Holds.** See below. A held workspace does not purge; it stays `closed-held`.

### Safety holds

Today holds are keyed by `subject_user_id` ([hold triggers](../schema/platform.sql)): an account-scope hold covers the account cascade, every project of the subject, project owner changes and contact deletion, and customer-facing refusals are generic so a hold is never disclosed ([account closure](account-closure.md) step 2). With a separate tenant that subject is ambiguous, so the contract fixes the rule:

1. **Two subject kinds.** A hold or case subject is a `workspace` or an `account` (a person). A **workspace hold** preserves tenant data: it blocks workspace purge, closure completion, ownership transfer, project/owner changes, member or owner removal that would change who controls the workspace, and project moves, exactly as `safety_hold_project_owner`/`safety_hold_account_retained` do for the account today. An **account hold** preserves the person's own data (identity, profile, private Chat, memberships and audit references) and blocks personal account deletion and membership tombstone purge.
2. **No silent expansion and no escape through the gap.** Holds are placed explicitly per subject by the named safety operator with the existing legal-basis and approver fields. The case surface shows which workspaces a person owns or belongs to so linked workspace holds can be placed in the same reviewed action, but coverage is never inferred. To keep the current guarantee that an owner change cannot move held material out of reach, **any ownership-changing operation (transfer, owner removal/demotion/leave, closure, project move) aborts if an active hold covers the workspace, any project or object in it, or any person whose owner membership the operation ends or changes.** Refusals use the same generic customer response, so a hold is not disclosed to members or owners.
3. **Capture and deletion paths.** New deletion and expiry paths (membership tombstone purge, invitation expiry purge, audit retention, workspace purge) are classified in `tools/safety-hold-inventory.mjs` and blocked under either subject kind; holds extend invisible preservation to anything the new tables hold that a hold could cover.
4. **Review required.** The subject taxonomy changes legal-hold semantics. The schema child must put this section before the named safety operator and the counsel responsibility named in LC-06 as a design review before freeze; this document makes no legal determination, and a blocked verdict from the inventory tool is a review signal, not clearance.
5. **Provider consent is not transferred by a hold or by any ownership change** (invariant 8). A held transfer does not occur at all; an unheld one revokes the sender-authorized connections.

## Owner surface bindings

Domain handlers are implemented **once**; web, Chat, saved views and later native clients register adapters over them ([alignment rule](roadmap/alignment.md#implementation-rules-that-prevent-another-rewrite)). Proposed entries (names are proposals until the interaction child registers them):

| Binding or control | Kind | Feature / authority | Notes |
| --- | --- | --- | --- |
| `workspace.members@1` | read | owner, `manage-members`; no plan gate for the owner roster | Roster by opaque member reference, role, grants, scope, state, revisions; masked labels only. |
| `workspace.invitations@1` | read | owner / `manage-members` | Pending invitations with expiry; never a secret. |
| `workspace.access@1` | read | any member | The caller's role, grants, scope, and derived paused/resumable state. |
| `workspace.approvals@1` | read | approvers | Pending reviews with effect set and preparer reference. |
| `workspace.audit@1` | read | owner / `manage-members` | Minimized events. |
| `memberInviteReview` / `memberInviteApply` | prepared exact review → apply | `pro.members`, fresh passkey | Grant-carrying and elevated invitations owner-only. |
| `memberRoleReview` / `memberRoleApply`, `memberRemove`, `leaveWorkspace` | review/apply | `pro.members`; removal and leave need none | Exit paths stay available after plan loss. |
| `collaborationResumeReview` / `collaborationResumeApply` | review/apply | owner, fresh passkey | The only way a lapsed workspace's members return. |
| `ownershipTransferReview` / `ownershipTransferAccept` / `ownershipTransferApply` | review/apply | owner and recipient, fresh passkey | Never a model-executable verb. |
| `workspaceClosureReview` / `workspaceClosureConfirm` | review/apply | owner, fresh passkey | Never a model-executable verb. |
| `invitationClaim` | direct trusted page, not Chat | possession + ready account | The secret never passes through Chat or a model. |

View components `members` and `approvals` register in the workspace view contract with feature `null` for reads (as `access-roles` and `modules` do) so the owner roster survives plan loss; prepare and confirm re-check inclusion in their own handlers. Essential direct controls (leave, remove, accept/decline an invitation, see my access, sign out, security and recovery) stay reachable without inference. Registering these is the interaction child's job; backend work does not wait for the whole Chat rollout.

## Concurrency and recovery catalogue

| Scenario | Required outcome |
| --- | --- |
| Two claims of one invitation | One winner; loser gets the generic invalid response. |
| Claim races inviter removal, role change or invitation revoke | No membership; claim receipt readable; nothing activates. |
| Confirmation races inviter demotion or grant loss | The confirm batch aborts on the recheck; claim stays pending for an owner. |
| Role change races an in-flight write by that member | The write's batch aborts on the revision clause; no partial effect. |
| Approval races approver demotion or grant revocation | Commit aborts; review stays pending for a current approver. |
| Editor tries to confirm own review (with all grants) | Refused (`approver = preparer`, preparer not owner); review unchanged. |
| Review with spend + provider + public effects, approver holds one grant | Refused; stays pending for a holder of all required grants. |
| Two owners demote or remove each other | Exactly one succeeds; ≥ 1 active owner remains. |
| Last owner leaves, is removed, or deletes their account | Refused with a clear reason; closure or transfer is the path. |
| Lease expires mid-request | The write's batch aborts on `covered_until`; no partial effect. |
| New invoice arrives after a gap | `starts_at > covered_until`: lease cannot extend; non-owners stay denied until an owner resumes. |
| Renewal arrives contiguously while nobody is active | Next non-owner admission extends the lease inside its batch; no operator. |
| Preview grant revoked, then re-granted before `covered_until` | Revocation wrote `suspended` in its own transaction; members stay suspended until resume. |
| Resume races renewal, removal, or a second resume | One wins on the workspace revision; others receive the stored result or abort. |
| Transfer proposed twice, or accepted twice | One open transfer; replays return the stored result. |
| Transfer completion races removal, plan loss, closure or a hold | Guard rows decide once; the loser changes nothing. Under a hold, refused generically. |
| Workspace closure starts while a transfer or invitation is open | They are cancelled by the freeze step; none completes afterwards. |
| Owner deletes personal account right after starting closure | Allowed once closure has started; platform continues; the tenant is not stranded. |
| Hold placed while closure is `closing` | Closure pauses at the holds step with a generic retention reason; workspace becomes `closed-held`. |
| Lost response on invite, claim, role change, remove, resume, transfer, closure | Authenticated readback by request ID; never auto-resend a first dispatch. |
| Provider revocation after transfer is unknown | Visible pending obligation with retained readback authority; no new write. |
| Plan loss during an unsent member-prepared job | Job stops before dispatch; status stays honest; no maintainer invoked. |

## Verification and acceptance gates

Evidence levels stay distinct: **source only → local fixture (SQLite and local D1) → connected local browser → physical device → independent security review → deployed test platform**. A passing fixture does not imply a later level.

| Area | Required checks | Level |
| --- | --- | --- |
| Role × effect set × tenant matrix | Generated from the handler registry: every action × role × grant × scope, through direct handler, HTTP, Chat and job paths; multi-effect actions with each partial grant; unregistered handlers deny non-owners | Local |
| Sink enforcement | Every effect sink rejects a context whose effect set omits its class | Local |
| Tenant isolation | Two workspaces, one account with different roles in each; ID confusion, cache and selected-workspace switching; person ID rejected as tenant by foreign key | Local |
| Conversion completeness | AST test over routes, Chat actions, bindings, jobs, maintenance entry points; removed exports; changed-assertion report for owner suites | Local |
| Interleavings | Hold a request after admission, then change role/grants/scope/removal/transfer/lease/plan before commit; stale review, approver demotion, last-owner races | Local |
| Invitations | Possession, wrong account, enrolling account, replay, expiry, concurrent claim, enumeration, inviter removed or demoted, bound exceeded, cross-workspace secret, grant-carrying invitation by a non-owner, confirmation recheck | Local |
| Approvals | Editor cannot self-approve with every grant; owner self-approval unchanged; approver ≠ preparer; split reviews | Local |
| Suspension | Real elapsed invoice intervals: lapse, gap then renewal (no resume), contiguous renewal (extends), selective resume, revoked preview grant, observer lost | Local |
| Transfer | State machine, concurrent transfer/removal/closure/hold, lost responses, payer acknowledgment, post-commit obligations, no re-sealing or reuse of sender connections, immutable receipts | Local |
| Closure and deletion | Sole owner alone, with members, hold during closing, deletion after closure starts, no cascade either way, member tombstone before account deletion | Local |
| Single-owner regression | Existing owner suites (feature admission, workspace admission, publications, identity HTTP, shared modules, guest previews, account closure) assert the same observable results on an owner context | Local |
| Downgrade | Members suspended, owner content and published sites intact, exit paths available, jobs stop | Local |
| Jobs | Legacy owner shape and unresolved membership refused; role change invalidates unsent jobs; restored journal grants nothing | Local |
| Lifecycle, audit, export, holds | Catalogue classification, closure inventory counts, audit minimization, pseudonymous history after deletion, restore suppression, hold-inventory classification | Local |
| Surfaces | Binding negative cases; viewer cannot draft; model context excludes roster data; caches cleared on switch | Local / connected |
| Connected journeys | Built frontend + actual handlers: invite → claim → confirm → edit → prepare → approve → publish; removal mid-flight; downgrade and resume | Connected local |

**Pending gates (not satisfied by this document):** independent security review before multi-user activation; invitation and approval journeys on physical devices; real-device and human recovery for member accounts (WH-115 acceptance remains open at this baseline); deployed test-platform readback after the coordinated cutover (owner-authorized); sandbox downgrade drill; cumulative WH-090/WH-104 acceptance including "membership loss and approvals"; the safety-operator and counsel design review of the hold subjects. Provider, real-money and customer evidence remain separate and unclaimed.

## Child packets

The parent retains its gate. Children have no IDs yet (the backlog is not edited here). Each is a coherent, separately verifiable delivery.

1. **Contract, schema and acting-context conversion.** Resolve the remaining product questions; classification registry and composed-schema spike under the C2 keys; current-schema inputs (workspaces, memberships, grants, scope, invitations, transfers, closure, collaboration lease, audit, tombstones, provenance columns); conversion of every owner path to the acting context; handler/sink registry and drift tests; job-envelope amendment; lifecycle/protection classes; hold-subject design review. *Exit:* converted owner suites green with assertions intact, matrix generator and isolation tests, catalogue checks, empty-database cutover plan reviewed. Excludes invitation UX, approvals and Chat. Dominant cost of the whole feature.
2. **Membership, invitations, transfer and closure.** Invitation issue/claim/confirm, roles/grants/scope, remove/leave, last-owner rules, lease suspension/resume, owner-transfer lifecycle and post-commit obligations, workspace closure and personal-deletion rules, audit, roster/access bindings. *Exit:* race and lost-response fixtures, downgrade and resume fixtures, audit minimization. Excludes approvals.
3. **Approvals and connected acceptance.** Preparer/approver provenance on the converted release handlers, effect-set review registry, stale-review invalidation, approvals queue, Chat and view adapters, connected browser journeys, device and invitation journeys, security review and sandbox downgrade drill. *Exit:* parent acceptance criteria met; the parent stays open until the pending gates pass.

Dependencies by capability: completed identity and feature-admission foundations, recovery acceptance for members, the interaction contract, lifecycle/protection classification, the job envelope. Staging promotion, portfolio and bulk-change features consume the approval child's review registry and must not add their own approval engine.

## Decision register

| Decision | Status | Content |
| --- | --- | --- |
| Invite path | **Decided (owner, Oct 8 UTC)** | Existing completed accounts first; no invite-as-signup |
| Separation of duties | **Decided (owner, Oct 8 UTC)** | Editor-prepared release needs another owner or granted approver; editor never self-approves; owners keep self-approval |
| Member AI and spend authority | **Decided (owner, Oct 8 UTC)** | Editors: standard AI within fair use, zero customer units; premium needs grant + exact approval; billing read-only |
| Full owner transfer | **Required (WH-054 packet)** | Not an owner question |
| Tenant model | Proposed (engineering) | C2 dedicated `workspaces`; C1 only as a guarded fallback if the spike fails |
| Effect sets | Proposed (engineering) | Conjunctive; computed from the immutable review; enforced at sinks |
| Durable suspension | Proposed (engineering) | Deny-only coverage lease; sticky; explicit owner resume |
| Closure and deletion | Proposed (engineering) | No personal delete while holding owner membership; explicit workspace closure |
| Hold subjects | Proposed, **needs safety/counsel design review** | Workspace and account kinds; ownership changes abort under either |
| Project transfer | Deferred, **not designed** | Constraints only |
| Payer on transfer | Unresolved | Proposed default below |
| Member bound | Unresolved | 5 is an engineering limit only |
| Retention (suspended rows, audit, invitations) and closure cancellation window | Not approved | Decide under the LC decisions |
| Member-only accounts and the welcome gate | Unresolved | Decide before the membership child |
| Guest links issued by a removed member | Proposed | Keep, flag issuer-removed |

## Remaining product questions

For the parent to put to the owner (not asked here); each is bounded and none re-opens a recorded decision:

1. **Payer on transfer.** Proposed default: the paid interval continues, the recipient subscribes in their own right (sandbox only), the previous payer may cancel at period end, no card moves. Alternatives: require the recipient to subscribe before completion; or I'll specify.
2. **Member-only accounts.** May a person who holds only memberships enter without creating their own workspace? Proposed: yes; the first-project welcome applies only when they create a workspace.
3. **Retention and closure window.** How long suspended membership rows, workspace audit and expired invitations are kept, and whether workspace closure has the seven-day cancellation window proposed in LC-01 or none. Aligns with the pending LC decisions.
4. **Member limit.** Whether the engineering default of 5 active members counts owners, and whether pricing copy may ever mention a limit (pricing policy currently defers seats).

## Remaining unknowns

- Exact set of review types and handlers converted in the first slice and their effect sets; compiled from the route/Chat inventory at implementation time.
- Effort of the C2 conversion (counts only; no prototype) and the final classification of mixed `users`-referenced tables.
- Payer mechanics beyond the sandbox default; grace and proration terms.
- Whether viewers and billing members should get any model assistance (the owner's answer covered editors; the contract gives them none).
- Owner-recovery policy when a co-owner is unreachable.
- Hold-subject semantics until the safety/counsel review.
- Project transfer, entirely.
- Real-device behavior of two-key enrollment for invitees (depends on open recovery acceptance).
- Cost and entitlement facts beyond the sandbox are unverified.

## Sequencing with unmerged work

Written against `ca17c6a`. On October 8 UTC the changed-file lists and descriptions of open pull requests **#170, #174 and #177** were read through the GitHub API (read-only; nothing merged, checked out or modified). None is part of the baseline, so every anchor above is as of `ca17c6a` and this contract depends on none of them:

- **#170** (account export/closure WH-018, restore suppression WH-019, abuse intake WH-016) changes `src/workspace-identity/admission.ts`, `schema/platform.sql`, the lifecycle catalogue, `tools/current-schema.mjs` and `src/account-lifecycle/*`. Its closure is keyed to the account and uses a durable closure row without a foreign key to `users`, a holds step with a generic retention reason, and a `restricted` set kept out of the owner's review. Workspace closure here reuses that shape; **if #170 merges first, the account closure it ships must be re-keyed to workspace plus account in child 1, and the conversion counts above change**.
- **#177** (WH-004 boundary audit) adds an AST-based route/control registry (`tools/boundary-audit.mjs`, `docs/boundary-audit.json`) in the `protection` profile, so any new route or control needs an entry. Child 1's conversion test should extend that registry if it has merged, and otherwise use the same compiler-based method.
- **#174** (owner module workflows, connector consent, native identity) changes shared-module and connector docs and the Android/native identity surface, and is the most likely to touch member-facing flows.

Reconcile with whatever has merged before code starts; do not edit those branches from this contract.

## Verification of this document

Docs-only. Local links and anchors in this file and in the cross-linked sections were resolved with a script kept outside the repository; `git diff --check`, `node tools/roadmap.mjs validate`, `alignment` and `render --check` were run; no application test, schema build against deployment, remote Cloudflare operation, push, pull request or issue was made. Schema figures come from a read-only in-memory SQLite build of the current-schema inputs; source-use counts are text searches at `ca17c6a`. The three open pull requests were read through the GitHub API only.
