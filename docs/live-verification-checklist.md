# Live verification checklist (manual, signed-in)

A person runs this in a real browser against the deployed site. It covers what `tools/live-browser-probe.mjs` cannot: passkeys, the recovery kit, a signed-in session and Stripe Checkout. Nothing here is automated, and no agent should perform these steps.

## Before you start

- Run the read-only probe first: `pnpm exec node tools/live-browser-probe.mjs --live https://<origin>`. It must exit 0. It only loads pages with GET, plus the one config POST (`{"version":1}` to `/api/auth/identity/v1/config`) the signup page makes to fetch the public Turnstile site key; every other write is aborted.
- Use a normal browser profile on a device with a platform passkey, plus a second, different passkey provider or a security key. Two distinct passkeys are required to finish signup.
- Have your own invitation code and an email address you control.
- Stripe: use the SANDBOX (test mode) only. Never enter a real card number. Never use live-mode Stripe. If the Checkout page does not show a test-mode banner, stop and cancel.
- Do not share your invitation code, recovery key or kit in screenshots, chat or tickets.

## 1. Signup with an invitation

1. Open `/workspace/?signup=true`.
2. Confirm the heading is visible and the Turnstile challenge loads.
3. Enter your email, then your own invitation code, and confirm US eligibility. Complete Turnstile yourself.
4. Continue and note any error message verbatim.

## 2. Passkey enrollment and recovery kit

1. Create the first passkey when prompted.
2. Create a second, distinct passkey (a synced copy of the first counts once).
3. Save the recovery kit where only you can reach it. Confirm the page lets you proceed only after the kit is saved.
4. Finish setup and confirm you land in the signed-in workspace.

## 3. Sign out and sign back in

1. Sign out. Confirm the workspace no longer shows signed-in content and a reload returns to the entry page.
2. Sign in with a passkey. Confirm you reach the workspace without re-entering the invitation code.
3. Reload once to confirm the session persists.

## 4. Stripe Checkout (SANDBOX only)

1. Confirm the environment is sandbox/test mode before starting.
2. Start a checkout from the billing screen.
3. On the Stripe page, confirm the email field is prefilled with your account email.
4. Do not pay. Use the back or cancel link and confirm you return to Whumpo with no charge and no plan change.

## 5. Record afterwards

Write these in a private place (not the repo):

- Date and time (with timezone) of the run, and who ran it.
- The deployed commit (version or short SHA shown by the release, or the deploy record).
- Browser, version and OS; which passkey providers were used.
- Result of each section above: pass, fail or not run.
- Screenshots, kept private (they may show your email or kit). Do not attach them to public issues.
- Anything odd: slow steps, wording errors, layout glitches, unexpected redirects, console warnings.
