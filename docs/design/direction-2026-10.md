# Design direction, October 2026

Status: proposed by the design lead on 2026-10-29. Audit base: `origin/main` 93e1aad.
Method: ui-ux-pro-max (priority order: accessibility, touch, performance, style, layout, type and colour, motion, forms, navigation), with its design-system and ui-styling guidance.

## What the audit looked at

- The code: `frontend/src` (house components, landing, pricing, identity, onboarding, workspace shell, pages), `tools/design-tokens.mjs`, `docs/design/whumpo-design-system/tokens.json`, `public-app/`.
- The rendered UI: the repo's own browser harness (`tests/workspace-identity-browser.mjs`, a synthetic D1 fixture with real Chromium passkeys, on local port 8787) took screenshots of Landing, Sign-up, Sign-in, Chat, Dashboard, Profile, Billing, Saved work, Settings, Account security and Support. Each page was captured at 390 and 1280 px, in light and dark mode, and axe ran on every page.
- Axe: the five recovery pages had 0 findings in all 20 states. Landing had 1 **serious** `frame-title` finding in all 4 states: the Stripe pricing-table iframe has no title. Sign-up and Sign-in had 0 findings. One contrast failure that axe missed is listed below.

## Findings, by severity

1. **Broken in dark mode (accessibility).** On the sign-up and sign-in screens at 1280 px, the right-hand art panel uses `.hero-sky`, a hard-coded light gradient. In dark mode, "Your ideas belong here." is drawn in `ink` (#f1f6fd) on a near-white sky, so the heading is almost invisible. The 404 page uses the same class.
2. **The pricing section leaves a hole.** When the Stripe table is configured but its iframe has not painted, the section is about 900 px of blank space. The iframe has no title (the axe finding above), and nothing reserves its height, so the page shifts. When Stripe is not configured, the section shows only "Plans are coming soon", even though the draft plans already exist in `src/plans.ts`.
3. **The landing page has no proof.** The landing page never shows the product. There is no chat example and no screenshot, and the trust strip is three faint 14px phrases. The real safety facts are strong (passkeys only, nothing is spent or published without approval, you can take any site offline yourself), but they appear only inside the workspace.
4. **The CTAs point in different directions.** The landing page has "Meet Whumpo" (sign-up), "Your workspace" / "Sign in" (sign-in) and "Start a conversation" (sign-in, although its copy invites a new user). That is three labels across two destinations.
5. **The type scale exists but is not used.** `tokens.json` defines hero, display, title, heading, body, body-sm, label and caption, but `design-tokens.mjs` does not emit them. The code has 7 arbitrary sizes (`text-[10px]`, `[13px]`, `[15px]`, `[28px]`, `[40px]`, `[56px]`, `[72px]`). Every h1, h2 and h3 is set in Poppins, so 16–18px card headings come out cramped ("Chat message:uncertain"). The brand book limits Poppins to marketing, onboarding and page titles.
6. **There are two colour vocabularies.** The shadcn aliases (`text-muted-foreground` ×295, `bg-card` ×39, `bg-background` ×38) sit alongside the semantic tokens (`text-ink-muted` and others). They resolve to the same values today, but they will drift. There are also 5 raw hex values in TSX.
7. **Loading, empty and error states are bare.** Loading is a lone spinner, and the code has no skeletons. Empty and denied cards say "This information is not available with your current access." and offer a Refresh button. Errors are plain bordered text. The composer disclaimer is 10px.
8. **Actions have no hierarchy.** A publish review in Chat offers four equal pill buttons, and "Confirm reviewed change" (the consequential one) looks the same as "Open private preview". The brand rule "one primary per view" is not applied.
9. **Copy is written in the system's terms.** Support shows internal states ("AI request: reserved", "uncertain"), raw locale timestamps, and stacks of caveat paragraphs ahead of the action.
10. **There is no motion system.** There are no duration or easing tokens, and the only motion is ad-hoc `transition-colors` and a few `animate-in` classes. Reduced motion is respected globally, which is good.
11. **The public app pages ignore the brand.** `public-app/visitor.css` has hand-coded hex values, a 900-weight system-ui wordmark and no dark mode.

Already good, and to keep: 44–52px touch targets on phones, safe-area handling, a bottom nav of 5 items or fewer, skip links, focus rings drawn from the `focus-ring` token, `StatusBadge` pairing every colour with an icon and a word, balanced and pretty text wrapping, and the dark palette itself.

## Decisions

- **D1. Keep the brand and change the system.** The skill's generic SaaS palette (indigo and emerald) is rejected. The owner-approved Whumpo palette, mascot, Poppins and Inter stay. "Amazing" here means consistency, proof and craft, not a new look.
- **D2. Tokens are the only source.** The type scale, motion (durations 150/250/400 ms, easings standard/enter/exit) and a themed `hero-sky` gradient are added to `tokens.json` and emitted by `tools/design-tokens.mjs`. Tailwind exposes them as `text-hero`, `text-display`, `text-title`, `text-heading`, `text-body`, `text-body-sm` and `text-caption`, plus `duration-*` and `ease-*`. No arbitrary `text-[Npx]` is used anywhere.
- **D3. Poppins only where the brand book allows it.** Poppins is used for the hero, display, page title (h1) and wordmark. Card and panel headings (h2 and h3 inside the workspace) use Inter 18/26 at weight 600. This is enforced in base styles, not in each file.
- **D4. One colour vocabulary.** New code uses only the semantic names (`ink`, `ink-muted`, `surface-*`, `action`). The shadcn aliases stay mapped for one release as compatibility. Each package migrates the files it owns, and a later cleanup removes the aliases.
- **D5. Honest proof instead of testimonials.** The preview has no customers we can quote truthfully, so we use no fake logos, quotes or star ratings. Proof is (a) a static, accessible rendering of a real chat-to-draft exchange built from house components, and (b) a trust row of verifiable product facts: sign in with passkeys and no password; nothing is published or paid for without your approval; take any site offline yourself; plain-language reviews before changes.
- **D6. One conversion path.** Every acquisition CTA reads "Start with an invite" and goes to `/workspace?signup=true`. Sign-in is a secondary text link, "Sign in". The final CTA band goes to sign-up.
- **D7. Pricing renders natively first.** Native plan cards built from `publicPlans` (labelled "Planned launch pricing — not available yet") are the default, and they reserve space. The Stripe table enhances in place only when configured, inside a container with a fixed minimum height, and its iframe gets a title. No backend change is needed.
- **D8. One primary action per view.** In review cards, the consequential confirm is `primary`, the inspection actions are `secondary`, and cancel or dismiss is `quiet`. The labels and their order stay the same, because tests and screen-reader journeys depend on them.
- **D9. Every state is designed.** A shared `Skeleton` component (with a reduced-motion-safe shimmer) replaces bare spinners where the layout is known. Empty states get the mascot, one sentence of what to do next, and one action. Error states use `attention-soft` with an icon, what happened, what is safe, and a retry.
- **D10. Motion stays quiet.** Only opacity and transform are animated, for 150–400 ms. Nothing bounces on billing, security or error screens (brand book). The landing page gets one entrance fade-up. Chat gets a typing indicator while a reply is pending.
- **D11. The landing page follows the device theme.** The landing page currently forces light mode, so the first screen of the workspace flips the theme on the visitor. The landing page should honour the saved or device theme, now that the hero gradient is themed. Rejected alternative: keep marketing light-only. Rejected because it conflicts with the sign-up dark flow.
- **D12. No new dependencies.** Everything here is done with Tailwind v4, the existing Radix and shadcn components, and lucide. No animation library is added.

## Work packages

Order: **WP1 lands first and alone.** WP2–WP8 then run in parallel, because their file sets are disjoint. Only WP1 edits `styles.css`, the token generator and `components/ui/*`, so every later package styles itself with utilities in the files it owns.

**Gate for every package:** `pnpm check`, `node tools/verify.mjs fast`, `node tools/verify.mjs protection` and `pnpm build` all pass. Screenshots at 390 and 1280 px, in light and dark mode, are reviewed for every page the package touches. There is no horizontal scroll at 360, 390 or 1280 px. Where a harness exists, axe reports 0 findings (`pnpm test:recovery-axe` and `node tests/workspace-identity-browser.mjs --accessibility`). No string that a test asserts is changed unless the same package updates that test and says why. The passkey, recovery, session and approval logic is untouched.

### WP1 — Foundation: tokens, type scale, motion, base components (value 5, effort M)
Files: `docs/design/whumpo-design-system/tokens.json`, `tools/design-tokens.mjs`, `frontend/src/design-tokens.css` (generated), new `public-app/design-tokens.css` (generated; `--check` covers it), `frontend/src/styles.css`, `frontend/src/components/ui/*` (plus new `skeleton.tsx`), `docs/design/README.md`.
Changes:
- Emit type, motion and themed `hero-sky` tokens (D2), and register the Tailwind `@theme` utilities.
- Base layer: Poppins for h1 and `.text-display`/`.text-hero` only, Inter 600 for h2 and h3 in `.workspace-main` (D3).
- `.hero-sky` gets dark values.
- Button: disabled state uses `surface-sunken` and `ink-muted`, not 50% opacity (the washed-out blue CTA). Hover and press use the motion tokens.
- Input and Textarea: 44px minimum height, plus an error ring.
- Add `Skeleton`.
Acceptance: the generated files match `--check`. Contrast is 4.5:1 or better for every text token pair in both themes (add an assert-based check to `design-tokens.mjs`). The existing component tests pass.

### WP2 — Landing and conversion path (value 5, effort M)
Files: `frontend/src/landing.tsx`, new `frontend/src/landing-demo.tsx`, `frontend/src/legal-links.tsx`, `frontend/src/main.tsx` (the 404 page only).
Changes:
- Hero CTA "Start with an invite", with "Sign in" as a text link (D6).
- A demo section that renders a static `ChatMessage` exchange leading to a `ServiceTile` with a "Ready" badge (D5).
- A trust row of four facts with icons (D5).
- Section rhythm on `space-12`/`space-24`.
- Remove the forced-light code (D11).
- A fade-up entrance, disabled under reduced motion.
- Footer: group the legal links.
Acceptance: the `--accessibility` landing journey passes, including its skip-link, contrast and "not available in this preview" assertions. The LCP image keeps `fetchPriority`.

### WP3 — Pricing (value 4, effort S–M)
Files: `frontend/src/pricing.tsx`, `frontend/src/stripe-pricing-table.tsx`, `frontend/src/plan-features.tsx`.
Changes:
- Native plan cards from `publicPlans`, with the "Planned" labelling.
- Mark one plan as recommended.
- Reserve a minimum height. Render a skeleton while loading.
- Set a title on the Stripe iframe through a MutationObserver. This is a shortcut that breaks if Stripe changes its DOM; drop it once Stripe exposes a title prop.
- Keep "Plans are coming soon" and the test-mode notice text.
Acceptance: axe `frame-title` reports 0. CLS is under 0.1 in the landing journey. `pnpm test:billing-ui` passes.

### WP4 — Sign-up, sign-in and onboarding (value 5, effort M)
Files: `frontend/src/identity/flow.tsx`, `frontend/src/identity/kit.tsx`, `frontend/src/onboarding.tsx`, `frontend/src/profile-picture-picker.tsx`.
Changes:
- Visible step progress (Account → Passkeys → Recovery kit → Welcome) as text and a bar.
- The art panel uses the themed sky (this fixes finding 1).
- Explain why the passkey button is disabled, near the field.
- Raw hex becomes tokens.
- The onboarding question type goes to `text-title`, and the "picture" step gets a selected-state ring.
Acceptance: `node tests/workspace-identity-browser.mjs` (default, `--accessibility`, `--cross-tab`, `--account-help`) passes unchanged. All focus-heading assertions hold.

### WP5 — Workspace shell and Chat (value 5, effort M–L)
Files: `frontend/src/workspace.tsx`, `frontend/src/mobile-workspace.tsx`, `frontend/src/components/whumpo/chat-message.tsx`, `frontend/src/chat-reply.tsx`, `frontend/src/chat-turn-actions.tsx`, `frontend/src/chat-request.tsx`, `frontend/src/first-draft-card.tsx`, `frontend/src/saved-chat-turn.tsx`.
Changes:
- Action hierarchy in review turns (D8).
- A typing indicator while waiting.
- Long URLs and IDs in replies are set in mono and truncated with the full value on copy.
- The composer disclaimer goes from 10px to `text-caption`.
- An empty-conversation state with 3 starter prompts that fill the draft.
- The sidebar active state is consistent for every link.
- The toast uses tokens and an enter/exit transition.
Acceptance: `pnpm test:chat-screen-reader`, `test:chat-fields`, `test:chat-interactions` and the identity browser journeys pass.

### WP6 — Dashboard and generated pages (value 4, effort M)
Files: `frontend/src/workspace-pages.tsx`, `frontend/src/workspace-view-components.tsx`, `frontend/src/workspace-controls.tsx`, `frontend/src/query-recovery.tsx`, `frontend/src/deferred-area.tsx`, `frontend/src/traffic-card.tsx`, `frontend/src/site-health-card.tsx`, `frontend/src/module-instances-card.tsx`, `frontend/src/records-panel.tsx`, `frontend/src/components/whumpo/{service-tile,progress-card,status-badge}.tsx`.
Changes:
- Skeleton cards replace `DeferredArea` spinners.
- Designed empty and denied states (D9). "Not available with your current access" becomes "You don’t have access to this yet", followed by who can grant it.
- Place `ServiceTile` for projects and sites.
- Updated times become relative ("Updated 2 min ago"), with the absolute time in a `title`.
Acceptance: `pnpm test:site-health`, `test:app-page-design` and `--navigation` pass.

### WP7 — Support, saved work, safety, account and settings (value 3, effort M)
Files: `frontend/src/support.tsx`, `saved-work.tsx`, `site-safety.tsx`, `security-review.tsx`, `account-help.tsx`, `account-email.tsx`, `subscription-panel.tsx`, `install-app.tsx`, `service-safety.tsx`, `operator-safety.tsx`.
Changes:
- Internal states map to `StatusBadge` and plain words ("uncertain" becomes "Still finishing", "reserved" becomes "Waiting for review"). Keep the raw state in `sr-only` text if a test reads it.
- Caveats go into a `<details>` labelled "What to know".
- `Intl.RelativeTimeFormat` for times.
- One primary action per card.
Acceptance: `pnpm test:recovery-axe` (0 findings), `test:support-browser`, `test:account-email-ui`, `test:security-review-ui` and `test:billing-ui` pass.

### WP8 — Public app pages (value 3, effort S)
Files: `public-app/index.html`, `public-app/visitor.css`.
Changes:
- Link the generated `design-tokens.css`.
- Replace hex values with variables, and add a dark mode through `prefers-color-scheme`.
- The wordmark goes to weight 700, labels get a 44px touch height, and the focus ring uses the token.
Acceptance: `pnpm test:app-page-design` and `test:customer-app-journey` pass, and the visitor flows are screenshotted at 390 and 1280 px in light and dark mode.

## Resolved questions

Resolved by the orchestrator on 2026-10-29.

- **D7 (draft plan prices): decided, show them**, labelled "Planned launch pricing — not available yet". Reason: honest proof, and it is not a commitment.
- **D11 (landing page theme): decided, the landing page follows the device theme.** Reason: consistency with the signup dark flow.

## Onboarding journey, 2026-10-31

The owner asked for registration and onboarding to be an animated, captivating experience that stays dead simple. Before this work the flow had two layouts and a hard swap between them: a split signup and setup page, then a centered welcome column, then Chat. Setup kept the same heading across four states, and on a phone the recovery kit began below the fold.

Decisions, each with its reason:

- **D13. One frame from signup to the first question.** `JourneyFrame` (`frontend/src/journey/stage.tsx`) holds the header, the sky and the form column, so moving between identity and welcome changes content, not the page. Sign-in and recovery use it too.
- **D14. The sketch is the real first draft, not an illustration.** It uses the palette and typefaces of `renderPageShell` in `src/components.ts` at miniature size and shows what the person typed inside fixed template labels ("Hi, I'm", "Made for"). It says "Sketch from your answers" at every size. A test pins the palette, so a later template change fails until the sketch follows. No build or loading is implied.
- **D15. View Transitions and Web Animations, no GSAP.** This keeps D12. View Transitions handle exits and shared elements through snapshots, so nothing clones the DOM, which matters here because a clone would duplicate the recovery key and the Turnstile iframe. Entrances are Web Animations on the live page, so they run where View Transitions do not exist. Browsers do not hit-test a captured element, so anything interactive is captured only as it leaves, and the new step is live from the first frame. CSS durations come from the motion tokens. Web Animations cannot read those, so `motion.ts` copies 150ms, 400ms and the enter easing, and the journey suite holds the copies to the tokens.
- **D16. Direction means something.** Forward rises, back falls. Changes inside one setup step (`update`) do not travel: only the new section enters, because re-animating an unchanged heading read as a flicker. The palette choice (`morph`) leaves the step alone and crossfades only the sketch.
- **D17. Data first, motion second.** A transition starts only after the server's reply is in hand and it decorates that commit. Nothing waits on an animation, no timer advances a step, and a skipped, interrupted or unsupported transition leaves the same screen. This is also why no step can be left half finished.
- **D18. Reduced motion is the same journey without travel.** No View Transitions; each step fades in over 150ms. Everything else is identical.
- **D19. Progress is earned and comes from saved state.** One rail of six chapters replaces the two separate step lists. The spark at its tip moves only when a real step finishes, and the three stars by the mascot are the two passkeys and the saved kit. This follows the brand book's "progress rings that fill as real steps complete" and "never celebrates before the system confirms completion". Nothing bounces: it is a security screen.
- **D20. Less on each step.** On phones the next action stays on screen. "Your answers so far" is gone, because Back and the review page already edit every answer and the sketch shows them. The two optional privacy choices sit behind one disclosure and stay off by default, with their full text intact. The disclosure's closed label states the current AI position, and one quiet line under each question says what it promises: "No AI usage · answers save when you continue", or on the picture step, which saves on selection, "No AI usage · your picture saves when you choose it". Once two passkeys are saved, the passkey list compacts and adding another moves into a disclosure, so the recovery kit fits the first screen. The feel swatches show the real palettes, not brand accents.
- **D21. The question is the hero (design review, 2026-10-31).** The first version stacked a speech card and a field card on every step and read as a form with a mascot beside it. Each step is now one display-weight question on the bare surface, its field, and one primary button.
- **D22. The sketch builds from the first answer.** It appears on the name step and takes one line per answer: name as the greeting, idea as the headline, project name as the brand, audience as the tagline, feel as the palette. On Continue the answer flies from its field to its line, and the mascot reacts. On a phone it is a compact live card above the question. With the keyboard open it folds to the one line being written, so typing stays visibly alive.
- **D23. Review is a moment, not a page.** The sketch, one Start button and a closed "Check details" that holds every edit. Billing left the flow: it needed a plan decision nobody has to make to start, and it stays in Settings.

Rejected: slow parallax clouds behind the sky. They were invisible in the recordings and cost a full-column layer on every step.
