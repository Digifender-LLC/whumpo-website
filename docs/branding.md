# TownHello branding

TownHello replaces the placeholder TellUmo name in the customer interface. Tagline: “Whatever you need online, just ask.”

The landing page and illustrations were inherited from the final local template built in “Check Wrangler registrar search”, source `outputs/townhello/dist`, September 29, 2026. The template’s full-width street, conversation/doorway logo, serif wordmark, sample conversations and responsive layouts are retained.

Palette: cream #fff8e9, ink #243e34, green #2d503e, yellow #edc25c, terracotta #9a4c30. DM Sans, DM Serif Display and Caveat are self-hosted under public/brand; their OFL notices are in docs/licenses. No external font CSP permissions are needed.

Sign-in, registration, chat, detail dialogs, contact and comparison pages use the new presentation. Existing customer website designs are preserved. Lowercase internal IDs, cookies, backup paths, database names, infrastructure names and DNS operation markers remain compatible. Existing saved content and history are not rewritten.

The deployment stays on digifender.com and Cloudflare. The template’s future services are labeled as possibilities, not currently available capabilities. Invitation CTAs open the existing registration flow; paid services remain disabled.

## Verification

Deployed to digifender.com on September 29, 2026. Main Worker version: `9b8cdf4e-d510-4d28-b441-d3dcc40dd14c`. TypeScript, persisted chat, cryptographic passkey and version-comparison suites passed. Browser checks covered 1440px desktop and 390px mobile landing layouts, loaded imagery, future-example switching, authenticated local workspace/details/billing, and the live invitation form. Live passkey enrollment and human Turnstile completion were not attempted.
