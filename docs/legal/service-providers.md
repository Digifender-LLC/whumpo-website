# Service Providers

Draft inventory dated October 1, 2026. This page distinguishes current infrastructure, the restricted AI testing route, optional customer connections and planned services. It is not yet a completed contractual subprocessor schedule.

## Cloudflare

Cloudflare supplies Whumpo's hosting, request delivery and security infrastructure, database and object storage. Depending on the feature used, it processes account and project data, stored content, visitor data and technical request information. Turnstile is used for bot protection on relevant forms and also processes signals under Cloudflare's own disclosed bot-detection improvement purposes.

The platform uses [Workers](https://developers.cloudflare.com/workers/), [D1](https://developers.cloudflare.com/d1/), [R2](https://developers.cloudflare.com/r2/) and [Turnstile](https://developers.cloudflare.com/turnstile/). Private storage is not a promise of US-only processing or of a particular backup-deletion interval. Exact contracted entities, processing locations and applicable data-processing terms must be verified before adopting a business-customer processing schedule. See [Cloudflare's privacy policy](https://www.cloudflare.com/privacypolicy/) and [Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/).

## OpenCode Go and Muse Contributor

Current owner testing uses Muse Spark 1.3 Contributor through OpenCode Go, with Meta as the upstream Muse model provider. The route receives AI request context and returns output. **Prompts and replies may be used to train future Meta models; zero data retention is not established for this route.** It is restricted to non-sensitive testing and is not an approved confidential-customer subprocessor route. Hosting a draft privately in Whumpo does not change these conditions when its content is sent for AI processing.

See [OpenCode Go's model-specific privacy information](https://opencode.ai/docs/go/#privacy). Do not substitute terms for another OpenCode product or model. Provider legal entities, any upstream model recipients, contractual roles, locations and retention must be verified before allowing confidential customer workloads.

## Optional GitHub and customer Cloudflare connections

If you authorize a GitHub connection and confirm a supported backup, selected project source and backup metadata may be written to your chosen repository. Repository visibility and copies remain subject to your settings and GitHub's terms. Disconnecting Whumpo does not erase repository history. See [GitHub's privacy statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).

A customer-authorized Cloudflare connection permits supported account, domain or DNS operations within granted permissions and applicable approval controls. The customer's own relationship with Cloudflare is separate from Digifender LLC's use of Cloudflare infrastructure. Not every customer-authorized integration is automatically a Whumpo subprocessor acting only on our behalf.

## Stripe sandbox checkout

The homepage loads no Stripe content. In Billing, Whumpo's own checkout page uses Stripe.js and Stripe's embedded payment form. Stripe receives technical request information, and the payment form collects the information entered into it. We may receive sandbox customer and transaction records through our Stripe account. Use test information and documented test payment methods only. Stripe describes its own processing in its [Privacy Policy](https://stripe.com/privacy) and [Cookies Policy](https://stripe.com/legal/cookies-policy).

Live Whumpo subscriptions and trial entitlements remain unavailable. A test subscription, test trial or checkout confirmation does not activate Whumpo access. Sandbox configuration is not evidence of completed live billing, a final provider contract schedule or compliance with every consent requirement for an embedded widget. See the [Cookie Notice](cookies.md) for the remaining provider-storage assessment.

## Planned or unconnected services

Whumpo currently has no live payment-processing route. Planned AI Gateway or alternative model routing, moderation-provider candidates and future email-delivery services are not represented here as activated subprocessors. A CMS capability or customer-specific integration requires its own actual data-flow assessment; implementing code is not proof of a configured provider relationship.

The provider handling correspondence sent to legal@digifender.com and any separate support systems still need to be recorded in the final inventory. Avoid sending sensitive documents until an appropriate handling method is arranged.

## Changes and questions

Before a material new provider use, we will update the relevant notice and meet any applicable contractual notice, authorization or objection requirements. A signed data processing agreement may impose additional requirements. Contact [legal@digifender.com](mailto:legal@digifender.com) for questions about a specific feature or proposed workload.
