# Customer welcome and project setup

## First entry — September 29, 2026

New customers complete a three-step welcome before the workspace renders or requests Chat/dashboard data. Direct workspace links show the same welcome. Existing customers with an owned project skip it; completed welcome remains complete if that project is later deleted. Chat remains the default workspace tab after entry.

1. **Your profile:** required name, optional bio and an explicit choice to share that context with the agent. Choose Cloud, Sun, Moon, Leaf, Star or Planet artwork, or upload a photo. Photos are cropped to a square, reduced to a bounded JPEG and served privately through the existing authenticated profile route. Selecting artwork removes the uploaded photo. These controls also remain available in Profile.
2. **Your first project:** required working name and idea, optional intended audience, and an initial Ocean, Clay or Forest theme. Suggestion chips help customers get started. Each step saves when they continue; a refresh resumes saved progress.
3. **Review and start:** check the details, return to edit, then create a private draft project. No inference, publication, domain purchase or paid service is triggered. Chat opens after the project exists and offers the next build step.

Migration 0073 stores owner-scoped welcome progress and an immutable reserved project ID. Revision checks reject stale changes. A database trigger creates the project, workspace state, Chat receipt and activity atomically with completion. Retrying a lost completion response returns the recorded result without creating another project. Completion requires a saved nonblank name and reviewed project idea. Profile email/photo are excluded from agent context; bio/name use the existing explicit opt-in.

Local verification: `pnpm check`, `pnpm test:onboarding-welcome`, `pnpm test:profile`, `pnpm build` and diff checks passed. Disposable D1/HTTP tests cover tenant and origin boundaries, stale edits, strict fields/limits, concurrent completion and lost-commit recovery. A connected local browser session chose artwork, uploaded a photo, saved/reloaded the review and recovered a deliberately lost completion response: one project, no early workspace reads. The 390px layout had no horizontal document overflow. Physical-device passkeys and touch acceptance remain unverified.

## Additional projects through Chat

The existing conversational flow collects an idea and project name, creates another project, then asks for its audience and visual direction. Those questions are optional (`/skip`). Finishing style selection saves a private immutable launch-page version with preview and source-export links. Nothing is published.

## Persistence and boundaries

Migration 0015 adds bounded audience/style fields and an allowlisted preferred theme to projects, plus a pending project/stage to workspace state. Existing accounts and projects keep their current setup state and receive empty notes with an ocean default. No existing version is rewritten.

Every transition, chat receipt, preference update and automatic preview uses the conversation revision transaction. A failed preview quota rolls back the preference and transition so the user can recover. Replayed message IDs cannot create duplicate versions. Each target project is checked against the authenticated owner; the pending project pointer is never authority by itself. Foreign or deleted pointers clear the pending question without exposing the project.

Normal setup messages stay guided even with AI configured. Explicit `/ask` or `/edit` can invoke AI during setup and leave the pending question intact. Other account commands also preserve progress. `/new` resets unfinished setup; `/cancel` leaves existing projects and already saved preferences intact. Audience, style and starting-theme preferences can be revised in Dashboard → Details or through the agent. Later website edits use the normal AI draft workflow.

## Preferences and rendering

Exact ocean, clay and forest responses choose the first preview theme. Other style descriptions are saved verbatim as bounded plain text, with ocean as the initial fallback. The reply explains that fallback. `/build` with no theme uses the stored preference; explicit `/build clay` overrides it for that version only. `/brief` optionally accepts an owned project ID; without one it shows the most recently created project.

Audience and style notes are private project planning data. They are included in later model context for up to five owned projects and covered by the existing Contributor-model notice. They are not added to deterministic preview text or source-export metadata. The model is instructed to use them as guidance, not copy them into public copy; this instruction is not a guarantee of model behavior. All AI output remains a private draft until the user reviews and confirms publication.

## Verification

`test:onboarding` uses disposable local D1 and an unusable provider endpoint, proving ordinary setup does not invoke AI. It covers saved stages, command interruption, simultaneous replay, automatic preview, no automatic publication, note exclusion, owner isolation, malformed pending ownership, skip, free-form style notes, cancellation, remembered themes and atomic version-quota rollback. Existing chat and site-agent regression suites also pass. Browser verification covers reload at the style question and the resulting preview link.

## Editing existing project details

Migration 0062 adds a dedicated details revision. Dashboard project cards now link to a phone-friendly Details editor for the project name and description. The editor keeps input on save errors, offers an explicit reload, and warns before leaving unsaved edits. The authenticated `GET/PATCH /api/projects/:id/details` endpoints check ownership and require the last-read revision for writes. Concurrent or stale changes return 409. A name/description change increments its revision and writes an activity event atomically; an unchanged save does neither.

`/project-details PROJECT_ID` reads the owned project's details without inference. The agent's project inspection includes the current details revision; the `projectDetails` action can change the name/description on request, preserving unrelated fields. The response uses the server result rather than an unsupported model success claim.

The project name is also used by existing public contact forms and directory headings; the editor and agent instructions disclose this. Saved website versions and CMS articles are not rewritten. Changing their copy still requires the existing draft/review/publication flow. The description is model context, and the editor tells users to keep secrets out. The original name/description editor is extended by the brief controls below.

Local D1 and HTTP checks cover strict fields/limits, anonymous and foreign-owner denial, cross-origin denial, stale/no-op/concurrent writes, revision reads, atomic activity and model response authority. Browser checks on a synthetic 390px phone workspace verify the unsaved-change prompt, save/readback, updated dashboard name and Details link. No real customer project has been renamed for testing.

Deployed September 29, 2026: migration 0062 and platform version `da6c7981-2e45-4edc-8704-4e886d871126`. TypeScript and production build passed. Live checks verified platform health, exact tested frontend assets, anonymous denial and cross-origin write denial. Agent mutation was verified locally; a live model-driven rename was not performed.

## Revising the private brief

Migration 0063 extends the details revision and atomic activity trigger to audience, style notes and starting theme, including writes from guided onboarding. The details API accepts partial updates: revision plus at least one supported field. Omitted fields are preserved; explicit empty audience/style notes clear those preferences. Text remains bounded at 1,000 characters per field, with an allowlist of ocean/clay/forest themes. Every field update is guarded by ownership and the exact revision. A no-op save does not increment the revision or add activity.

Dashboard → Details presents the brief controls as a grouped, phone-friendly form with the existing unsaved-edit guard. The agent may change only requested fields using `projectDetails`; stale revisions, invalid fields and unknown/foreign projects produce server-authored failure replies. Provider interpretation is still metered, but a known rejected edit is no longer treated as an uncertain provider operation. Actual persistence failures retain existing uncertainty handling.

Audience and style notes stay private planning context. The existing model context includes them, and `/brief` and project inspection read them. The starting theme affects subsequent guided builds when no theme is supplied. Saving preferences does not generate or publish a new version, restyle existing pages, change CMS content, or authorize extra inference. The editor explains this scope and warns against entering secrets.

Local checks cover partial preservation, explicit validation, no-op behavior, stale conflicts caused by onboarding writes, authoritative agent failure/success replies, and propagation into the model context. Existing ownership, concurrency, HTTP and activity tests remain in the same suite.

Deployed September 29, 2026: migration 0063, platform version `6c957a83-6509-48d6-9310-3c9afa3dc46a`. Passed `pnpm check`, `pnpm test:project-details`, `pnpm test:onboarding` and `pnpm build`. A synthetic 390px browser session saved/reloaded audience, style and theme, retained name/description, and showed no horizontal document overflow. Live verification confirmed platform health, the authenticated-details gate and byte-for-byte matching frontend assets. Screenshot: `.secrets/project-brief-mobile.png`. No real user brief or publication was changed, and live Muse interpretation of this new preference action remains unverified.

### Live model brief acceptance

September 29, 2026: the first opt-in Muse probe found that an ordinary style-preference request only inspected the project. Explore could afford one call, and the prompt required a separate revision lookup: 7 units were spent without completing the edit. Project context and the owner-scoped index now include `details_revision`; the model uses that value for partial updates and inspects only when missing or stale. Server revision checks remain authoritative.

`RUN_LIVE_MUSE=1 pnpm test:project-brief-live` uses the operator's configured Muse subscription with synthetic content and disposable local D1. It does not change public/customer data or increase the normal Explore allowance. After the correction, Muse selected the requested project by name, saved the exact style string in one call for 7 of 50 units, preserved name/description/audience/theme and the unrelated project, created no page/publication, and left zero reserved units. Replaying the message performed no extra inference, charge or update. The ordinary project-details suite also verifies that revision context matches the stored row. This proves the tested interaction, not general model reliability or physical-device acceptance.

Deployed platform version `21e383b8-a0d8-45d6-8e8a-741e6f8ff896`. TypeScript and project-details checks passed; live health, anonymous details denial and cross-origin write denial passed. No schema or frontend change was required for this correction.
