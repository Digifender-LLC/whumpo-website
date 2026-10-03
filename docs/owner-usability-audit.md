# Owner usability audit — October 3, 2026 UTC

WH-024 / [issue #10](https://github.com/zemdregon/whumpo/issues/10) remains **open**. This record preserves its complete scope and separates the current entry/recovery fixes from whole-owner acceptance. Baseline: `d93d9ac`. No identity authority, schema, billing, publication or provider-consent behavior changes.

## Verified failures and corrections

| Observed failure | Correction and inspected evidence |
| --- | --- |
| Completing the first passkey left focus on the document body | Identity actions focus the resulting step or error. A held successful second-key reply cannot steal focus after the owner opens Help. |
| Preparing/saving the kit and opening confirmations did not reliably announce the new step | Kit and confirmation headings are focus targets under the same action guard. Actual Orca output announces prepared/saved kit and the secure-account confirmation. |
| Completing setup mounted the first welcome question without announcing it | The initial question takes focus only when the body still has focus. Existing subsequent-question behavior is retained; later welcome-request focus custody needs its own audit. |
| Submitting the exact lost-passkey choice replaced the form without announcing the review | The review heading is focusable and announced. Changing or retaining the loss review uses the shared action controller. |
| Landing-to-signup navigation left no announcement of the loaded entry | Entry focuses its heading on mount only when focus remains on the body. The actual CTA-to-signup Orca checkpoint passes. |
| Landing had no main landmark or bypass link | Main content has a landmark and a keyboard-accessible Skip to content link; activation focuses the main container. |
| Small blue landing text measured 3.37:1 against its background | The small section labels now use `#206fb7`, measured 4.99:1 against `#f8fafc`. Large display text and the brand palette remain. This is a sampled contrast result, not a whole-site conformance claim. |
| Landing presented connected CMS publishing as available | The card now explicitly says CMS publishing is planned and unavailable in the preview. CMS functional testing remains deferred. |

## Connected verification

- `node tests/chat-screen-reader.mjs --identity`: actual current Worker, full disposable local D1 schema, built React routes, virtual Chromium WebAuthn and real isolated Orca. Keyboard entry starts at the landing page, uses the invitation CTA, registers two distinct passkeys, exercises cancelled second enrollment and preserved progress, opens optional Help during a held reply, saves the kit, completes every welcome question, creates exactly one private project, reloads an unsent Chat draft and verifies immediate workspace closure after session revocation. Seven generated-speech checkpoints cover entry, first passkey, cancellation, prepared/saved kit and the first two welcome questions.
- `node tests/chat-screen-reader.mjs --recovery`: actual identity HTTP handlers and current identity schema on local D1, built identity UI and virtual Chromium passkeys. Keyboard flow covers partial loss, exact review, saved replacement kit, secure confirmation, lost successful response with no duplicate secure request, new-kit resumption, replacement proof, key removal and ordinary sign-in. Four generated-speech checkpoints cover restricted entry, exact review, confirmation and uncertain outcome. The isolated fixture does not pretend to be the complete platform UI.
- The existing ordinary `node tests/identity-browser.mjs --d1` regression passed before adding Orca/keyboard instrumentation. Successful registrations/assertions use Chromium's actual virtual authenticator. Only cancellation, Turnstile and browser print dispatch are synthetic. Download/copy/print contents agree; hidden/cleared kit contents and HttpOnly cookies retain their existing checks.
- Landing captures and overflow checks at 360, 390 and 1280 CSS pixels; recovery/enrollment captures at 390 and security at 1280. The landing fixture deliberately supplies unavailable pricing configuration and verifies the free invite-only state; it does not inspect Stripe's embedded UI or activate checkout.
- Focused welcome-delivery, Chat announcements, Chat recovery and Chat delivery checks pass. Both TypeScript/compiler checks pass. The source build and deployed evidence are recorded separately below.

The initial first-passkey/body-focus, welcome announcement, lost-passkey review and landing entry failures were reproduced before fixes. Failed Orca attempts are retained privately. Two fixture mistakes were corrected: radio groups need arrow-key navigation, and the picture question says “Pick a face for your space.” Keyboard helpers issue Tab/Shift+Tab/arrow/Enter/Space events; they do not programmatically focus target controls. Orca checkpoints consume actual generated speech, not DOM text or ARIA snapshots.

Private logs live under `.secrets/usability-*`; synthetic screenshots are `/tmp/whumpo-landing-audit-{360,390,1280}.png`, `/tmp/whumpo-identity-{mobile-enrollment,mobile-recovery,desktop-security}.png`, and `/tmp/whumpo-current-workspace-mobile.png`. Private session logs/downloads and credentials are excluded from Git. Generated speech used a silent sink; nobody listened to spoken audio. Virtual passkeys do not establish hardware/provider usability or independent backup custody.

## Original scope and remaining acceptance

| WH-024 requirement | Current evidence and remaining work |
| --- | --- |
| Landing → invitation → welcome → Chat → review → preview → recovery | Entry through first project and separate restricted recovery now have current connected keyboard/Orca evidence. Existing [routine Chat](chat-routine-acceptance.md), [renderer](chat-renderer-acceptance.md) and [comparison](version-comparisons.md) evidence remains valid within its stated scope. Finish the combined keyboard draft/edit/review/preview and outage journey against the current candidate. |
| Focus, labels, announcements, contrast, errors/loading and narrow screens | Above failures fixed; current renderer already covers forms/dialogs/late replies. Broader landing/workspace control contrast, welcome late-response focus and full combined error/loading review remain to be checked. |
| Composer persistence, Dashboard read recovery and new replies | Current entry test verifies unsent-draft reload; exact-request and announcement suites pass. Recheck the actual current Dashboard outage/retry UI. The old `tools/workspace-recovery-browser.mjs` fixture still uses retired auth endpoints and is not current acceptance evidence; replace its useful scenarios with current identity/handlers rather than restore old endpoints. |
| Pending safety/provider work is never presented as completed | CMS landing copy corrected. Existing held-photo and connection handoff evidence distinguishes saved/held/pending from clearance or consent. Complete the consolidated pending-state audit; no scanner or real provider approval is implied. |
| Trial/contact/payment controls make no false promise | Current unavailable-pricing landing state inspected. Separately inspect configured sandbox/table and workspace billing states; existing Stripe sandbox acceptance is not real-money activation. |
| Second key guidance and recovery kit | Optional Help explains distinct credentials, provider alternatives, no hardware purchase and saved-passkey resumption. Cancellation retains the first credential. Download/copy/optional print and kit resumption pass. No new routine unlock prompts were introduced. Physical providers/devices remain unverified. |
| Manual and device acceptance | Agent-inspected browser captures and generated Orca speech are recorded above. Human keyboard/screen-reader usability, physical iOS/Android keyboards, hardware passkeys and PWA behavior remain explicit gaps. Do not call this whole-product or physical-device acceptance. |

WH-111 still follows WH-024; this increment does not close the parent or change that dependency. All environments remain testing-only. CSAM implementation, Daybreak and CMS functional testing remain deferred.

## Deployment

Source/local evidence above is not deployment evidence. The scoped platform release will be recorded after actual asset, schema/binding and rendered readback. Other Worker services and the current database do not require a cutover for these frontend-only changes.
