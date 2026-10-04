# Whumpo design system

`whumpo-design-system/` is an export of the owner's Claude Design system "Whumpo" ([source artifact](https://claude.ai/artifact/54fhNthQuXKFUrsH7oqwPM), private), captured 2026-10-04 from the version last changed 2026-10-04T01:44Z. The app does not load these files directly: `frontend/` generates its token stylesheet from `tokens.json` and bundles its own copies of the fonts.

Status: **being adopted in stages.**

- Stage 1 (implemented): `tools/design-tokens.mjs` generates `frontend/src/design-tokens.css` from `tokens.json`; the workspace and landing styles draw color, radius, shadow, focus and type from it. Poppins (500/700) is bundled for display text and Inter stays the UI face. `pnpm check` rejects a stale token file.
- Stage 2 (planned): shared components replace their existing equivalents.
- Stage 3 (planned): screen-by-screen migration.

## Contents

- `README.md` — the brand book: voice and content rules, tagline hierarchy, color/type/space/elevation/motion foundations, logo and mascot rules, iconography.
- `tokens.json` — 27 color tokens (six fixed brand colors plus light/dark semantic tokens), type styles, 8 spacing, 5 radius and 3 shadow tokens.
- `components/` — nine React 18 components (`Brand`, `Icon`, `Button`, `StatusBadge`, `ChatMessage`, `Composer`, `ProgressCard`, `ServiceTile`, `ApprovalCard`) as a classic script assigning `window.Whumpo`, plus `bundle.css`, `index.d.ts` types, and per-component guidelines and previews. Previews reference logo images by the artifact's `/_blob/<id>` URLs and render only inside the artifact.
- `assets/` — 12 provisional icons, the 48/96/192/512px mark derivatives and the brand board. The 1.6 MB master mark is identical to [`../brand/whumpo-mark-original.png`](../brand/whumpo-mark-original.png) and is not duplicated here.
- `fonts/` — Inter (400/500/600) and Poppins (500/700) woff2.
- `design-system.json` — the artifact's index (asset records, libraries, namespace).

`tokens.css` and the generated API cards exist only inside the artifact viewer and are not included.

## Notes

- Display face: Poppins stands in for a planned Poppins Rounded, which is not a published face. [branding.md](../branding.md) now records Poppins for display and Inter for UI.
- The 12 icons are provisional until a production set is approved.
- The brand board here (`assets/Reference/whumpo-brand-board.png`) is a different file from [`../brand/whumpo-brand-board.png`](../brand/whumpo-brand-board.png).
