# Whumpo branding

Whumpo is the product name. Primary tagline: “Big ideas. Less work.” Conversation prompt: “Tell Whumpo what you need.”

The September 2026 identity supplied by the owner is retained in `brand/whumpo-identity.md` and `brand/whumpo-brand-board.png`. The previous town/street template and its assets have been retired.

Palette: Deep Sky #0F2D5B, Sky Blue #60B5FF, Cloud White #F8FAFC, Mint #A7E3C1, Sunshine #FFD56B and Cloud Coral #FF7B7B. Poppins is the display face (headings, page titles and the typeset wordmark) and Inter is used for body/UI text, as the owner decided on 2026-10-04. Both are bundled locally; the design system's tokens and fonts are the source of truth. The transparent cloud-elephant illustration was generated from the supplied brand direction.

The React landing page, owner workspace, auth screens, settings, profile and controlled visitor page follow this identity. Contact and source-comparison pages use the same navy/cloud palette. Saved customer designs and user content are preserved.

The design system (brand book, tokens, components, icons and logo derivatives) lives in [`design/`](design/README.md); `node tools/design-tokens.mjs` generates `frontend/src/design-tokens.css` from its `tokens.json`, and `pnpm check` fails if that file is stale.

See [Whumpo migration](whumpo-migration.md) for live addresses, deployment and verification. Lowercase persistent resource identifiers retain their original names to preserve existing data.
