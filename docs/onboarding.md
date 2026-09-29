# Conversational onboarding

The default workspace remains a chat. New setup collects an idea and project name, creates the project, then asks who the site is for and its visual direction. The audience and style questions are optional (`/skip`). Finishing style selection saves a private immutable launch-page version with preview and source-export links. Nothing is published.

## Persistence and boundaries

Migration 0015 adds bounded audience/style fields and an allowlisted preferred theme to projects, plus a pending project/stage to workspace state. Existing accounts and projects keep their current setup state and receive empty notes with an ocean default. No existing version is rewritten.

Every transition, chat receipt, preference update and automatic preview uses the conversation revision transaction. A failed preview quota rolls back the preference and transition so the user can recover. Replayed message IDs cannot create duplicate versions. Each target project is checked against the authenticated owner; the pending project pointer is never authority by itself. Foreign or deleted pointers clear the pending question without exposing the project.

Normal setup messages stay guided even with AI configured. Explicit `/ask` or `/edit` can invoke AI during setup and leave the pending question intact. Other account commands also preserve progress. `/new` resets unfinished setup; `/cancel` leaves existing projects and already saved preferences intact. There is no dedicated preference editor yet; later website edits use the normal AI draft workflow.

## Preferences and rendering

Exact ocean, clay and forest responses choose the first preview theme. Other style descriptions are saved verbatim as bounded plain text, with ocean as the initial fallback. The reply explains that fallback. `/build` with no theme uses the stored preference; explicit `/build clay` overrides it for that version only. `/brief` optionally accepts an owned project ID; without one it shows the most recently created project.

Audience and style notes are private project planning data. They are included in later model context for up to five owned projects and covered by the existing Contributor-model notice. They are not added to deterministic preview text or source-export metadata. The model is instructed to use them as guidance, not copy them into public copy; this instruction is not a guarantee of model behavior. All AI output remains a private draft until the user reviews and confirms publication.

## Verification

`test:onboarding` uses disposable local D1 and an unusable provider endpoint, proving ordinary setup does not invoke AI. It covers saved stages, command interruption, simultaneous replay, automatic preview, no automatic publication, note exclusion, owner isolation, malformed pending ownership, skip, free-form style notes, cancellation, remembered themes and atomic version-quota rollback. Existing chat and site-agent regression suites also pass. Browser verification covers reload at the style question and the resulting preview link.
