# WH-112 device, screen-reader and human acceptance checklist

Everything here is what an agent host cannot do: a real screen reader (Orca needs sudo, so it is not installed on the agent host), physical phones, the real soft keyboard, the installed PWA across OS suspension, human listening and customer acceptance. It is the manual half of WH-112 (whole-owner acceptance) and the gaps carried over by the [WH-213 audit](chat-daily-workspace.md#wh-213-acceptance-audit--2026-10-27-utc) under decision D-8 ([owner decisions](roadmap/owner-decisions-2026-10-26.md)). Allow about 60 minutes in total: part A 15, B 20 per phone (run in parallel with C), C 10, D 5, E 5.

A person runs this. No agent should. It extends [live-verification-checklist.md](live-verification-checklist.md), which covers desktop signup, passkeys and Stripe; do not repeat that desktop pass here. PWA background: [dashboard-pwa.md](dashboard-pwa.md).

## Rules for every step

- **Cost: no step costs money.** Stripe steps use the free Stripe SANDBOX (test mode) only and end in cancel. Never enter any card number, real or test. Never use live-mode Stripe. If Checkout shows no test-mode banner, stop and cancel. Signup, passkeys, Chat drafts and the installed app are free. Do not send a Chat message that asks for new work (it may call a paid model); use drafts, reading and saved items only.
- **Needs a Stripe sandbox (free):** B7 only. Everything else works without Stripe.
- Use your own invitation code and an email you control. Keep invitation codes, recovery keys, kits and screenshots private; never put them in public issues or this repo.
- Test the deployed candidate whose commit you record in part F. Mark each step Pass, Fail or Not run. For a Fail, note the exact wording or behavior seen.

## A. Screen reader (about 15 minutes)

Pick one: **Orca on Linux (preferred, the reference)**, NVDA with Firefox or Chrome on Windows, or VoiceOver with Safari on macOS or iPhone. Use the keyboard only (Tab, Shift+Tab, arrows, Enter, Space, Escape). Do not move focus with the mouse. The agent fixture asserts these phrases against real Orca output; NVDA and VoiceOver word things differently, so judge on meaning (the heading or control name and its state are announced) rather than exact words.

Linux setup: Orca on (Super+Alt+S, or `orca` from a terminal), Firefox or Chromium, a normal profile on the deployed site. Source of the expectations: [tests/chat-screen-reader.mjs](../tests/chat-screen-reader.mjs), which runs the journeys in `tests/workspace-identity-browser.mjs`, `tests/identity-browser.mjs` and `tests/chat-interaction-browser.mjs` through `tests/helpers/orca-output.mjs`. The steps below follow the checkpoint labels in those tests.

| # | Action (keyboard) | Expect Orca to speak | Pass/Fail |
| --- | --- | --- | --- |
| A1 | Open the landing page, Tab to "Meet Whumpo", Enter | "A little hello", heading |  |
| A2 | On invited signup: email, invitation code, eligibility checkbox, then "Create my first passkey" (complete the browser prompt) | "Make this account yours", heading |  |
| A3 | Cancel the browser prompt when adding the second passkey | "The passkey step was not completed" and "saved progress is unchanged" (as an alert, focus not lost) |  |
| A4 | Complete the second passkey, then "Prepare recovery kit" | "Save your recovery kit", heading |  |
| A5 | "I've saved my recovery kit" | "Your kit is saved", heading |  |
| A6 | "Verify a passkey and finish setup" | "What should I call you", heading |  |
| A7 | Type a name, Continue | "Pick a face for your space", heading |  |
| A8 | In Chat, Tab to "Find past messages", Enter | "Past messages & forms", dialog; Escape returns focus to "Find past messages" |  |
| A9 | Open a form with a required field (a saved or maintained form) and Tab to it | Field name, "required", and where the starting value came from, for example "Starting value: saved website text" |  |
| A10 | Leave that field empty and press the prepare/save button | "Add an answer before continuing" and focus lands on the invalid field |  |
| A11 | On a required radio group, arrow to an option | Group name with "Required", the option name, "radio button"; empty submit says "Choose an option before continuing" |  |
| A12 | Type text in a form, press "Discard form" | "Discard this form and its unsent answers" and "Keep editing" |  |
| A13 | Signed-out restricted recovery: "Use my recovery kit", then start | "Recover your account", heading; then "Review before securing", heading; then "Secure your account now", heading |  |
| A14 | Open Account help during welcome | "Account help", "Manage your passkeys", heading; closing returns to its button |  |
| A15 | Dashboard, Site & app safety link | "Site & app safety", heading; after confirming a withdrawal, "Withdrawal applied" |  |
| A16 | After a Chat reply arrives (use an existing saved turn; do not request new work) | "New reply from Whumpo in Chat", without focus moving |  |

**Gaps the agent audit could not cover (listen for these specifically; no expected phrase exists):** Help sheet and desktop sidebar group, Saved work list and "Read this review here" panel, and the Support page. For each, record whether the heading is announced on arrival, tab order is logical, and the result of every action is spoken.

## B. Phones (about 20 minutes each, one iPhone and one Android)

Use the real browser (Safari on iPhone, Chrome on Android), a real network, portrait. Record model and OS version.

| # | Step | Expect | iPhone | Android |
| --- | --- | --- | --- | --- |
| B1 | Open `/workspace/?signup=true`; email, invitation code, eligibility, Turnstile | Page fits the screen, no sideways scroll; errors are readable |  |  |
| B2 | Create the first passkey with the phone's own provider (Face ID, fingerprint or PIN), then a second distinct one (a security key, or the other provider) | Both succeed; cancelling a prompt keeps progress |  |  |
| B3 | Prepare and save the recovery kit | You can proceed only after saving it; the kit is where only you can reach it |  |  |
| B4 | Finish welcome, reach Chat. Type an unsent draft, switch to another app for 30 seconds, return; then reload the tab | Draft is still there after returning; after reload it is restored (drafts live in the tab for up to 24 hours) |  |  |
| B5 | Help sheet, then Support | Opens from the bottom bar, reads and scrolls, returns to where you came from |  |  |
| B6 | Saved work: open an item, "Read this review here", then confirm one pending review with the explicit confirm button (only if a pending site-publish review exists, otherwise Not run) | Panel shows the current review; confirm applies once; after reload it offers nothing; a stale review is refused with a message |  |  |
| B7 | **Billing, Stripe sandbox (free):** Billing, start checkout | Test-mode banner visible; email prefilled with your account email; do not pay; use back or cancel; return to Whumpo with no charge and no plan change |  |  |
| B8 | Dark mode: set the phone to dark, reload Chat, Dashboard, Settings, Billing; then light | Text is readable, no invisible controls; theme follows the system |  |  |
| B9 | Sign out, sign in again with a passkey | Reaches the workspace without the invitation code |  |  |

## C. Installed PWA (about 10 minutes, on each phone)

Install from Settings, "Whumpo, a tap away" (Chrome menu, Install app; Safari Share, Add to Home Screen, Open as Web App). Launch the icon so it opens standalone with no browser bar.

| # | Step | Expect | iPhone | Android |
| --- | --- | --- | --- | --- |
| C1 | Install and launch | Opens `/workspace` in its own window; Settings shows the installed state |  |  |
| C2 | Sign in, type an unsent Chat draft, leave the app (home screen) for 2 minutes | Returning shows the draft and the signed-in workspace |  |  |
| C3 | Swipe the app away or force-quit it, relaunch | Record what is kept: sign-in state and draft. A cleared draft here is expected (drafts are per tab); a cleared sign-in is not |  |  |
| C4 | Suspend for longer (lock the phone for 10+ minutes), resume | No blank or stuck screen; if the session lapsed you reach the passkey sign-in, not stale private content |  |  |
| C5 | Turn on airplane mode and open the app | Branded offline page with "Try again"; no account data shown; turn airplane mode off and Try again returns you |  |  |
| C6 | Update: after a new release is deployed, open the app twice (the second launch picks up the new worker) | New version loads; an unsent draft typed beforehand is not lost by the update itself |  |  |

## D. Real soft keyboard (about 5 minutes, on each phone)

The agent test only simulates the keyboard by changing the visual viewport height. Check the real thing in Chat, a form field and the Support form.

| # | Step | Expect |
| --- | --- | --- |
| D1 | Tap the Chat box so the keyboard opens | The input stays visible above the keyboard; it is not covered by the keyboard or the bottom bar |
| D2 | Type several lines | The page scrolls to keep the cursor visible; the send button stays reachable |
| D3 | Tap a lower form field, then Next through fields | Each focused field scrolls into view; no field is hidden behind the keyboard |
| D4 | Dismiss the keyboard, rotate to landscape and back | Layout recovers; no stuck gap and no sideways scroll |
| D5 | Set the phone's largest text size and open Chat and Help | Controls wrap, nothing is cut off, targets are still tappable |

## E. Human listening and customer notes (about 5 minutes)

With a screen reader on (part A) and on a phone, listen and write plain notes:

- Does each new screen announce where you are, without you hunting?
- Is any announcement too long, repeated, or in the wrong order?
- Do error messages say what to do next, in words you would say yourself?
- Is anything spoken that should be silent (decorative text), or silent that should be spoken?
- Customer acceptance (separate authorization is needed before recruiting anyone): note whether a consenting participant finished a routine task without navigation coaching. WH-112 proposes 8 of 10 as the target; record counts and exclusions, not a verdict from one person.

## F. What to record

Keep this in a private place, not the repo.

- Date and time with timezone, and who ran it.
- Deployed commit (short SHA from the release or deploy record).
- Device model, OS version, browser and version; screen reader and version; passkey providers used.
- Pass, Fail or Not run for every step ID (A1 to A16, B1 to B9, C1 to C6, D1 to D5), with the verbatim error or speech for each Fail.
- Screenshots, kept private (they can show your email, invitation or kit). Do not attach them to public issues or PRs.
- Listening notes from part E and anything odd: slow steps, wording errors, layout glitches, unexpected redirects.
- Confirmation that nothing cost money: no card entered, Stripe in test mode, checkout cancelled.

Reporting results to the roadmap is a separate step by the owner; this checklist changes no status by itself.
