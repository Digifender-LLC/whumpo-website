# ChatMessage

One chat turn. Whumpo's turns sit on `action-soft` at the left with the mark as avatar; the customer's sit on `surface-raised` at the right.

- Provide `from` (`whumpo` | `you`), `children` (the text), optional `time` and `avatarSrc` (the 96px mark) for Whumpo.
- Whumpo's copy follows the voice rules: plain language, honest progress, cost before spending. Short acknowledgments ("Got it. I'm checking that now.") never claim a diagnosis or success.
- Detailed progress comes from real workflow events — render a ProgressCard rather than narrating.
