# Cookie Notice

Draft updated October 1, 2026. Effective date: pending adoption. This inventory describes the current application source; edge-service behavior also depends on deployment settings.

## Essential storage

Digifender LLC uses cookies and limited browser session storage to operate Whumpo, secure sign-in and recover interrupted visitor-app actions. Some internal names retain earlier product names; they are Whumpo storage identifiers.

- **__Host-whumpo_session:** a first-party owner session cookie on the Whumpo workspace host, lasting up to seven days. It keeps you signed in. Signing out clears that browser cookie; revoking a session also ends its server-side authority.
- **__Secure-whumpo_identity_challenge:** a first-party passkey challenge cookie scoped to /api/auth/identity/, lasting up to five minutes. It associates a sign-in or registration attempt with the browser that started it.
- **\__Host-whumpo-app-session-PROJECT_ID** and **\__Host-whumpo-app-challenge-PROJECT_ID:** the separate hosted application uses a project identifier in these names. Sessions last up to 24 hours and passkey challenges up to five minutes. These cookies authenticate access to that customer's application, separately from your owner workspace account.
- **whumpo-request:** browser session-storage entries, with an application path suffix, remember an outstanding visitor-app request identifier so an interrupted reply does not cause an unintended repeated action.
- **whumpo-deletion:** browser session-storage entries, with an application path suffix, remember a visitor-app deletion review identifier and revision during the recovery flow. Session storage normally lasts for the tab session, may survive a browser's session restoration, and can be cleared through browser controls.

The authentication cookies are not advertising identifiers. On HTTPS, they use Secure and HttpOnly attributes. Blocking essential cookies can prevent sign-in and supported recovery flows. Clearing a cookie or session-storage entry does not delete server-side account or customer data.

## Cloudflare and bot protection

Whumpo uses Cloudflare hosting and Turnstile protection on relevant forms. Cloudflare processes connection and browser signals to provide security and improve bot detection. Turnstile itself does not use cookies for advertising; related Cloudflare challenge configurations may set a clearance cookie such as cf_clearance. We do not claim that every Cloudflare cookie listed in its documentation is installed on Whumpo, or invent a fixed lifetime for settings that have not been verified.

See the [Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/) and [Cloudflare cookie documentation](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/cloudflare-cookies/). Customer-connected websites or CMS installations may add their own technologies, which their operators must disclose.

## Stripe sandbox pricing and checkout

Where the homepage displays configured Stripe pricing tables, it loads Stripe's script and embedded content; selecting a plan can open Stripe's test checkout. Those requests reach Stripe even though no live Whumpo subscription or trial entitlement is available. Stripe may use cookies and similar technologies for provider functionality, security and fraud prevention. We have not verified a complete browser-by-browser inventory or lifetime for every item set by the embedded provider, and do not claim that sandbox mode makes those technologies exempt from privacy requirements.

See [Stripe's Cookies Policy](https://stripe.com/legal/cookies-policy) and [Privacy Policy](https://stripe.com/privacy). Browser controls can block or clear provider storage, but blocking it may prevent an embedded table or checkout from working. Any consent or opt-out controls required for the actual provider configuration and applicable law must be in place before the relevant processing is offered.

## Analytics, advertising and choices

We have not added Whumpo advertising pixels or a standalone third-party analytics SDK. This statement does not exclude storage or data collection by the embedded Stripe content described above. The built-in website traffic feature counts successful public HTML requests by project and day without storing visitor identifiers or setting an analytics cookie. This does not mean infrastructure providers process no request metadata.

An optional-technology consent manager has not been implemented. Before offering processing that requires consent or opt-out controls, we must complete the inventory and provide the applicable controls; this notice alone does not supply consent. You can inspect, block or clear cookies in your browser and contact [legal@digifender.com](mailto:legal@digifender.com) about privacy choices. For access or deletion requests, use the [Privacy Policy](privacy-policy.md).
