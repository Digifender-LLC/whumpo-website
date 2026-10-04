Whumpo makes building and running an online presence feel as simple as asking for help. **Friendly enough to ask. Capable enough to trust.** The customer describes the result they want; Whumpo turns that into working websites, domains, data, storage and services — and keeps them running.

> Big ideas. Less work.

## Content fundamentals

Whumpo talks like a competent helper who knows the technical details so the customer doesn't have to. Clear, calm, conversational — an upbeat colleague, not a cartoon sidekick.

- **"Whumpo" is both the platform and the helper.** Whumpo speaks in the first person ("I'll check the current setup first") and addresses the customer as "you". Never "the AI", "the model", or a provider name.
- **Plain language.** "Your site needs more processing capacity." — not "Your container CPU quota is saturated." No DNS, containers, VMs or Git vocabulary in normal mode; say "versions" and "restore".
- **Honest progress.** "I'm checking the upload service and recent errors." — never "I fixed it" before verification. Short acknowledgments ("Got it. I'm checking that now.") must not claim a diagnosis or success.
- **Cost before spending.** "This would add about $18/month. Want me to continue?" Never provision paid resources silently.
- **Confident, not theatrical.** "I can handle that." — not "Leave everything to me, boss!"
- **Useful errors.** "The payment provider rejected the connection. Reconnect it here." — not "Error 403 from OAuth callback."
- Sentence case for UI and headings; the uppercase `overline` is for short labels and the campaign line only. Contractions are fine. No emoji in product copy; the spark (`sunshine`) carries delight. No cloud puns for every concept.

**Tagline hierarchy** — use each only in its place:

| Line | Where |
|---|---|
| Tell Whumpo what you need. | Hero / acquisition; the composer placeholder |
| Your online business, handled. | Supporting |
| Whumpo handles the work. | Product reassurance |
| Big ideas. Less work. | Campaign / brand; overline under the wordmark |
| A brighter internet for everyone. | Broad brand statement |

**Real moments** — Progress: "Your new site is built. I'm connecting the domain and checking that orders work before I put it live." Right-sizing: "You've used less than half of your Business capacity for two billing cycles. Personal should cover your current workload and save you $49/month." Incident: "I found a spike in failed uploads starting at 9:14 AM. I'm checking storage and the processing queue now."

## Visual foundations

**Color.** Airy, trustworthy, optimistic. Build UI from the semantic tokens; the six brand colors (`sky-blue`, `deep-sky`, `cloud-coral`, `sunshine`, `mint`, `cloud-white`) are fixed in both themes for illustration, marketing and the cover.

- Canvas `surface` (Cloud White in light); cards and the chat panel `surface-raised`; tile wells and the transcript `surface-sunken`.
- Text `ink` (Deep Sky in light) on every surface and every `*-soft` tint; secondary text `ink-muted`; blue text and links `link` — never `sky-blue` as text on light grounds.
- Primary action fill `action` (Sky Blue) with `on-action` (Deep Sky) text. Never white on Sky Blue: it fails contrast.
- Status uses soft fill + ink pairs, always with an icon and a word: ready/live `ready-soft` + `ready-ink` (mint), working/pending `spark-soft` + `spark-ink` (sunshine), failed/blocked/approval `attention-soft` + `attention-ink` (coral). Coral is rare — attention and human warmth, never decoration.
- Bright accents are moments of delight, not background noise. No gradients in UI chrome; soft sky gradients belong to marketing illustration only.

**Type.** Rounded personality, disciplined interface. `display` family (Poppins, standing in for the planned Poppins Rounded) for `hero`, `display`, `title` and the `wordmark`; `ui` family (Inter) for everything operational — `heading`, `body`, `body-sm`, `label`, `caption`, `overline`. Dense operational screens use Inter only. Readable beats cute.

**Space and shape.** 4px base: `space-3` between chat bubbles, `space-5` card padding, `space-6` between cards, `space-12` between marketing sections. Soft corners everywhere: `radius-md` bubbles and tiles, `radius-lg` cards, `radius-xl` marketing blocks, `radius-full` buttons, badges and the composer.

**Elevation.** Cloud-light, blue-tinted shadows: `shadow-sm` tiles and composer, `shadow-md` cards, `shadow-lg` dialogs and approvals. Borders `line` for decoration; `line-strong` for control edges (≥3:1).

**Focus and states.** Keyboard focus is a solid 2px `focus-ring` outline at 2px offset (≥5:1 on every surface). Hover on primary deepens to `action-hover`; secondary and quiet buttons tint to `action-soft`. Disabled is 50% opacity.

**Motion.** Quiet and cloud-light: 150–400ms ease, progress rings that fill as real steps complete, friendly micro-interactions. Nothing bounces on billing, security or error screens.

**Layout.** Chat is the default home, but status, projects, billing, domains and activity stay one click away. Approvals state outcome, price and risk. Long work shows real steps — checking, building, testing, deploying, verifying.

## Logo and mascot

- The primary mark is the approved cloud elephant reaching toward a gold star against a blue sky (`assets/Logos`). Pair it with the typeset Whumpo wordmark (`wordmark` style, `ink`) in the website header and workspace sidebar — use the `Brand` component. Use the same artwork alone for favicon, touch and app icons.
- Never recolor, crop, redraw or swap the mark for a rounded-W. Use the 48/96/192/512px derivatives; keep the 1.6 MB master out of page loads.
- Clear space ≈ the height of the lowercase "u". Below ~90px wide, drop the wordmark and use the mark alone. One-color wordmark: `deep-sky`, white or black only.
- The mascot: rounded, cloud-soft, minimal face (soft eyes, small smile, subtle blush); the trunk points, carries a spark, or signals progress. It supports trust; it never carries critical status, billing, security or error information alone, and never celebrates before the system confirms completion. No baby-toy styling, costumes or juvenile expressions on serious screens.

## Iconography

Rounded 2px strokes on a 24px grid, simple silhouettes, limited detail (`Icon` component; single-ink SVGs in `assets/Icons`). Infrastructure is shown with plain metaphors: home (website), globe (domain), database, storage (cloud), server, person, chat. Use the elephant head sparingly as a brand marker, never as every icon. The current icon set was drawn for this system to the brand rules — it is provisional until a production set is approved.

## Using this system

Load `tokens.css`, the fonts, `components/bundle.css`, React 18, then `components/bundle.js` → `window.Whumpo` (`Brand`, `Icon`, `Button`, `StatusBadge`, `ChatMessage`, `Composer`, `ProgressCard`, `ServiceTile`, `ApprovalCard`). Light is the first theme and the fallback; dark is set with `data-theme="dark"`. The brand board in `assets/Reference` is the visual north star.
