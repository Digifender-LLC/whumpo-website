# Brand

The approved cloud-elephant mark beside the typeset Whumpo wordmark — use it in the website header and the workspace sidebar.

- Provide `src`: the mark's URL. Use `whumpo-mark-96.png` (retina for the 44px slot) or `whumpo-mark-48.png`; never the 1.6 MB master on a normal page.
- `size="md"` (44px mark, desktop header and sidebar) or `"sm"` (32px, mobile header). The image box is fixed so the layout never shifts.
- `tagline` adds the overline under the wordmark — only "Big ideas. Less work." or "Your ideas live here."
- `wordmark={false}` gives the compact mark alone; do this whenever the lockup would render under ~90px wide.
- Don't recolor, crop, outline or replace the mark with a rounded-W; don't place the wordmark on `action` fills.
