# Whumpo design system

`whumpo-design-system/` is an export of the owner's Claude Design system "Whumpo" ([source artifact](https://claude.ai/artifact/54fhNthQuXKFUrsH7oqwPM), private), captured 2026-10-04 from the version last changed 2026-10-04T01:44Z. It is reference material: the app does not load these files yet.

Status: **imported, not implemented.** `frontend/` still follows [branding.md](../branding.md); adopting these tokens and components is separate work.

## Contents

- `README.md` — the brand book: voice and content rules, tagline hierarchy, color/type/space/elevation/motion foundations, logo and mascot rules, iconography.
- `tokens.json` — 27 color tokens (six fixed brand colors plus light/dark semantic tokens), type styles, 8 spacing, 5 radius and 3 shadow tokens.
- `components/` — nine React 18 components (`Brand`, `Icon`, `Button`, `StatusBadge`, `ChatMessage`, `Composer`, `ProgressCard`, `ServiceTile`, `ApprovalCard`) as a classic script assigning `window.Whumpo`, plus `bundle.css`, `index.d.ts` types, and per-component guidelines and previews. Previews reference logo images by the artifact's `/_blob/<id>` URLs and render only inside the artifact.
- `assets/` — 12 provisional icons, the 48/96/192/512px mark derivatives and the brand board. The 1.6 MB master mark is identical to [`../brand/whumpo-mark-original.png`](../brand/whumpo-mark-original.png) and is not duplicated here.
- `fonts/` — Inter (400/500/600) and Poppins (500/700) woff2.
- `design-system.json` — the artifact's index (asset records, libraries, namespace).

`tokens.css` and the generated API cards exist only inside the artifact viewer and are not included.

## Differences from the current branding doc

- Display face: this system uses Poppins (standing in for a planned Poppins Rounded); [branding.md](../branding.md) says rounded Nunito.
- The brand board here (`assets/Reference/whumpo-brand-board.png`) is a different file from [`../brand/whumpo-brand-board.png`](../brand/whumpo-brand-board.png).
