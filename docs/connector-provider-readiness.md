# Connector provider readiness and approval plan

**Planned. Planning-only readiness plan for WH-096–100, reviewed October 9, 2026 UTC against source `9847281`.** It lists the external approvals, provider policies and owner or counsel decisions that sit between the [frozen connector contract](connectors.md) and a live Gmail, Google Calendar, Outlook email, Microsoft Calendar or HubSpot adapter. It adds no OAuth client, scope request, provider account, app registration, consent screen, verification submission, adapter, route, table, binding or deployment. No provider console or account was opened to write it. This plan records no approval and claims none.

Every provider statement cites a row in the dated [Sources](#sources) table. Each row was fetched from official provider documentation on 2026-10-09, or is marked `unverified` where the page could not be read in full. A pricing, timeline or entitlement statement either cites a source or says **requires verification**. Provider pages change; recheck every cited row before a submission, a client registration or any spending commitment. Short quotes are copied from the cited page. This is an engineering plan, not legal advice: rows marked *needs owner or counsel decision* need that person's answer before the design is relied on.

## How this fits the roadmap

- The [common connector contract](connectors.md) (WH-140) froze the operation set, authority classes, request-bound consent, receipts, refresh and revocation rules for these five providers. Its [planned provider declarations](connectors.md#planned-provider-declarations) said the hosts and scopes were "not re-verified"; this plan re-checks them against provider documentation and lists the differences.
- The [bounded connection contracts](pricing-and-model-policy.md#bounded-connection-contracts) and [provider readiness sequencing](pricing-and-model-policy.md#provider-readiness-costs-and-sequencing) make all seven connections a paid-launch requirement (WH-104). Provider approvals are therefore launch blockers, not reasons to stop isolated synthetic implementation.
- Connected content stays under [request-bound lookup consent](connectors.md#request-bound-lookup-and-data-use-consent), the [inference privacy handoff](inference-privacy.md#required-admission-record-for-a-future-route) and the [data protection contract](data-protection.md). The `connector-content` class is still a `planned-adapter` reservation in [the lifecycle catalogue](data-lifecycle.json), and the current Muse Contributor route is training-enabled, so no real connected content may reach it.
- The catalog, now in [source](../src/connector-catalog/catalog.ts) (WH-141, same declarations as the WH-140 reference), is unchanged by this plan. Where provider documentation disagrees with it, this plan records a required catalog change for the provider's contract child; it does not make the change.

## Cross-provider matrix

| Provider | Packet | Catalog scopes | Highest scope class | External long-pole | Access / refresh | Revocation | Blocks private test | Blocks public launch |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gmail | [WH-096](roadmap/backlog.md#wh-096--deliver-requested-gmail-reads-and-reviewed-send-or-reply-actions) | `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.send` | Restricted (`gmail.readonly`) [S1] | Restricted-scope verification plus an annual third-party security assessment [S3]; Google's estimate is 6 weeks, "not guaranteed" [S8] | Testing-status refresh tokens expire in 7 days [S9] | `https://oauth2.googleapis.com/revoke` [S10] | Google Cloud projects, consent screen, test users | Brand, sensitive and restricted verification, assessment, Limited Use and AI-policy counsel review |
| Google Calendar | [WH-097](roadmap/backlog.md#wh-097--deliver-requested-google-calendar-reads-and-reviewed-event-changes) | `https://www.googleapis.com/auth/calendar.calendarlist.readonly`, `https://www.googleapis.com/auth/calendar.events.owned` | Sensitive (expected; requires verification) [S2] [S4] | Sensitive-scope verification; sources disagree between 3–5 and 10 business days [S4] [S8] | Same Google rules [S9] | Same Google endpoint [S10] | Same as Gmail | Brand and sensitive verification, Limited Use and AI-policy counsel review |
| Outlook email | [WH-098](roadmap/backlog.md#wh-098--deliver-requested-outlook-email-reads-and-reviewed-send-or-reply-actions) | `offline_access`, `Mail.Read`, `Mail.Send` | Delegated, admin consent "No" [S22] | Microsoft publisher verification (free once a verified partner account exists) [S23]; counsel reading of the email-API use clause [S41] | Refresh 90 days by default, rotated on use [S29] | No per-token endpoint found; owner removes consent [S32] [S33] | Entra app registration in a work or school tenant | Publisher verification, tenant-consent handling, Terms of Use counsel review |
| Microsoft Calendar | [WH-099](roadmap/backlog.md#wh-099--deliver-requested-microsoft-calendar-reads-and-reviewed-event-changes) | `offline_access`, `Calendars.ReadWrite` | Delegated, admin consent "No" [S22] | Same publisher verification [S23] | Same Microsoft rules [S29] | Same as Outlook [S32] | Same as Outlook | Same as Outlook |
| HubSpot contact lookup | [WH-100](roadmap/backlog.md#wh-100--deliver-requested-hubspot-contact-lookup-and-reviewed-lead-mapping) | `oauth`, `crm.objects.contacts.read`, `crm.objects.contacts.write` | "Available to all accounts" [S52] | OAuth v1 token API deprecation on February 16, 2027 [S51]; Marketplace listing past 25 installs [S54] [S55] | Access tokens 30 minutes [S49]; refresh lifetime not stated (requires verification) | v1 path-token delete, replaced by a POST revoke [S51] | Developer account, test account, signed Acceptable Use Policy [S54] | Catalog endpoint migration, listing review, Developer Terms counsel review |

## Gmail (WH-096)

Catalog key: `gmail`. Operations: `messages.search`, `message.get` (request-bound reads) and `message.send` (owner-request action).

### Scopes and sensitivity

| Scope | Class | Used by |
| --- | --- | --- |
| `https://www.googleapis.com/auth/gmail.readonly` | Restricted: "View your email messages and settings." [S1] | `messages.search`, `message.get`, reconcile of `message.send` |
| `https://www.googleapis.com/auth/gmail.send` | Sensitive: "Send email on your behalf." [S1] | `message.send` |

Google states: "If you store or transmit restricted scope data on servers, then you need to complete a security assessment." [S3] Whumpo's server-side adapter transmits mailbox content, so the contract's default of showing and discarding content does not avoid the assessment. Users may grant only some requested scopes, and the app "must verify which scopes were actually granted" [S10]; this matches the contract rule that a grant lacking an operation's scope refuses that operation. Account identity for binding is not covered by these two scopes alone; whether the adapter adds an identity scope or reads the profile through an existing scope requires verification in the WH-096 contract child.

### Verification and approvals

- **Brand verification.** Needed for an External, In production app that shows a name or logo. Google verifies authorized domains through Google Search Console, and the home page "must be publicly accessible" and link to the privacy policy [S5]. Google's estimate is "2-3 Business days" [S8].
- **Sensitive-scope verification** for `gmail.send`: a privacy policy "hosted within the same domain as your application's home page", a justification per scope, an unlisted YouTube demo video of the consent flow, and Search Console domain verification [S4]. Google's estimates differ: "3-5 business days" [S4] versus "10 Business days" [S8].
- **Restricted-scope verification** for `gmail.readonly`: "Every app that requests access to Google users' restricted data and has the ability to access data from or through a third-party server must go through a security assessment from Google-empanelled security assessors." [S3] The process "can potentially take several weeks" [S3]; the FAQ estimate is "6 weeks", and "these estimates are not guaranteed" [S8]. The unverified-app help page warns that verification "might require several months" depending on data sensitivity [S6].
- **Annual assessment.** Apps "must be reverified for compliance and complete a security assessment at least every 12 months" [S3]. Google assigns an assurance level (AL1 or AL2) and the result is a letter from the assessor [S13]; under the CASA framework, "All applications must be revalidated every year" and the framework user, not the developer, decides the level [S14].
- **Who pays.** "Google does not charge the developer any fees for security assessment"; the assessor's price "is agreed on between the developer and the assessor without any involvement from Google" [S8]. No official price was found; the assessment cost requires verification by quote.
- **Separate projects.** Google's policies "require separate projects for testing and production" [S21].
- **Test users and caps.** A Testing project is "limited to up to 100 test users" [S7]. An unverified production app using sensitive or restricted scopes is limited to "100 new users in total" [S6], and that cap applies "over the entire lifetime of the project" [S7].
- **Exceptions.** Google lists personal use, development or testing projects, internal-only use and service-owned data as exceptions [S3]. None fits a public multi-customer Business feature, so Whumpo should plan for full verification.

### Tokens, refresh and revocation

- Access tokens: the response gives "The remaining lifetime of the access token in seconds", and Google's sample shows `3920` [S10]. The catalog caps Gmail at `maxAccessSeconds: 3600`, so a real response above 3600 would be refused at token admission. The real value requires verification in a test project before WH-144 sets the cap.
- Offline access uses `access_type=offline` [S10], not an extra scope.
- Refresh tokens for an External app in Testing status expire in 7 days [S9], and test-user authorizations "expire seven days from the time of consent" [S7]. Private-test acceptance must plan re-consent at least weekly.
- A refresh token stops working when the user revokes access, after six months unused, when "The user changed passwords and the refresh token contains Gmail scopes", when the per-account token limit is exceeded, or when time-based access ends [S9]. There is "a limit of 100 refresh tokens per Google Account per OAuth 2.0 client ID", and a new token "automatically invalidates the oldest refresh token without warning" [S9]. Each of these maps to `reauthorization-required`.
- Revocation: a request to `https://oauth2.googleapis.com/revoke` revokes an access or refresh token, and revoking an access token also revokes its refresh token [S10]. This matches the catalog's `rfc7009` kind.

### Rate limits and quotas

Gmail allows "6,000 quota units" per minute per user per project and "1,200,000 quota units" per minute per project [S15]. `messages.list` costs 5 units, `messages.get` 20 and `messages.send` 100 [S15], so the contract's bounded reads (at most 10 results, then single messages) are far below the limits. Google states that standard use is "available at no additional cost" and that exceeding quota is "planned to incur charges to your Google Cloud billing account later in 2026" [S15]; the future charge requires verification. A message is limited to 500 recipients [S15].

### Push alternatives (not used)

Gmail push uses Cloud Pub/Sub, and the watch must be renewed "at least once every 7 days" [S17]. Whumpo does not use it: the contract excludes continuous sync, polling, mailbox indexing and webhook-triggered maintainer calls.

### Data use and AI policy

- **Limited Use** (API Services User Data Policy, "Additional Requirements for Specific API Scopes", item 2) [S11]: "Limit your use of data to providing or improving user-facing features that are prominent in the requesting application's user interface". "Transfers of data are not allowed, except" to provide user-facing features "and only with the user's consent", for security, for law, or in a merger with prior consent. "Don't allow humans to read the data, unless" the user gave "affirmative agreement to view specific messages", or for security, law, or aggregated internal operations.
- **AI and model training** (Workspace user data and developer policy, "Limited use of user data") [S12] prohibits "using user data to create, train, or improve a machine learning or artificial intelligence model beyond that specific user's personalized model for the appropriate use case or user-facing feature." The same policy lists "providing generative AI summaries" among approved Gmail productivity uses [S12].
- **Required disclosure** [S12]: a page linked from the home page or privacy policy must state "The use of information received from Google Workspace scopes will adhere to the Google User Data Policy, including the Limited Use requirements."
- **Security** [S12]: tokens "encrypted at rest", and "Protecting against prompt injection techniques by either using Google Cloud Platform's Model Armor or other prompt injection protection." Restricted scopes follow CASA [S12].

### Contract mapping

| Contract element | Gmail fit |
| --- | --- |
| Request-bound lookup consent | `messages.search` and `message.get` are `request-bound`. The single-use consent record is the in-context "user's consent" the Limited Use transfer exception needs [S11], and the "affirmative agreement to view specific messages" basis for any human view [S11]. Counsel must confirm that reading. |
| Owner-request-only authority | `message.send` is owner-request only. No rule may send, which matches Limited Use's user-facing purpose [S11]. |
| Data classes | Content is `connector-content` (planned reservation); receipts are `connector-receipts` (proposed). Default show-and-discard still transmits restricted data through servers, so the assessment applies [S3]. |
| Minimized receipts | Receipts hold digests and the provider message ID, never bodies. `messages.send` returns a Message with `id` and `threadId` [S20]; reconcile uses `messages.search` with the marker. |
| `model-context` destination | Allowed only for an approved non-training route. A training-enabled route conflicts with the Workspace AI clause [S12]; the contract already refuses it. |
| Refresh | `single-flight`; `invalid_grant` gives `reauthorization-required` for all the causes in [S9]. |
| Revocation | `rfc7009` against the Google endpoint [S10]. |
| No continuous sync | Push and watch are not used [S17]. |

### Conflicts needing owner or counsel decision

1. **Limited Use transfer to a model provider** (*needs counsel decision*). Sending selected mail to a third-party inference provider is a "transfer" unless counsel concludes a processor acting for Whumpo is not one. The exception requires a user-facing feature "and only with the user's consent" [S11]. Recommendation: treat the request-bound consent card as that consent, name the processor in it, and keep `model-context` closed until WH-021 admits a non-training route.
2. **AI training clause** (*conflicts with any training-enabled route*). The Workspace AI clause [S12] forbids the current Contributor route for real mail. The contract already blocks it; the admission record must also show the route provider does not train on the content.
3. **Human reading by support or operators** (*needs owner decision*). Limited Use restricts human reading [S11]. Support tooling and incident handling must not show connector content without the owner's affirmative agreement for specific messages.
4. **Prompt-injection protection** (*needs owner and counsel decision*). The Workspace policy asks for Model Armor "or other prompt injection protection" [S12]. Whumpo's `untrusted-external` provenance and owner-only authority are the planned mitigation; whether reviewers accept that as the protection requires verification during restricted-scope review.
5. **Access-token lifetime cap** (*engineering decision for WH-144*). The sample `3920` [S10] exceeds the catalog cap of 3600; confirm and, if needed, raise the cap within the contract's 28800 maximum.

### Owner and counsel actions

1. Create separate Google Cloud projects for testing and production [S21] under a Whumpo-controlled Google account.
2. Verify `whumpo.com` (or the production workspace domain) in Google Search Console [S5].
3. Publish a public home page and a privacy policy on the same domain [S4], including the Limited Use statement [S12].
4. Configure the consent screen (External), add test users (at most 100) [S7], and register the redirect URI.
5. Record a demo video of the built consent and lookup flow for the sensitive and restricted submissions [S4].
6. Obtain quotes from more than one CASA-authorized assessor [S8]; name the renewal owner for the 12-month cycle [S3].
7. Counsel: Limited Use transfer reading, human-reading policy and AI clause sign-off [S11] [S12].

### Prepare now versus blocked

- **Prepare now (no account needed):** privacy-policy and Limited Use text drafts, scope justifications, the consent-card copy, synthetic adapter work under WH-141–146, and the CASA control self-review against the Whumpo vault and logging design.
- **Blocked on the owner:** Google account and projects, Search Console verification of the domain, consent screen, test users and OAuth client secrets.
- **Blocked on the built adapter:** the demo video and the restricted-scope submission.
- **Blocked on counsel and WH-021:** any `model-context` use of real mail.

### Customer-visible cost flags

The catalog declares `{customerUnits: 0, basis: "plan-inclusion"}` for every Gmail operation. Google states no charge to the end user for Gmail API use [S15]. Operator costs are the assessor's annual fee (requires verification) and the planned quota overage charges (requires verification) [S15]; neither may become a customer price without the contract's quoted-price review.

## Google Calendar (WH-097)

Catalog key: `google-calendar`. Operations: `calendars.list` (owner-control read), `events.range` (request-bound read) and `event.create` (owner-request action).

### Scopes and sensitivity

| Scope | Class | Used by |
| --- | --- | --- |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | "See the list of Google calendars you're subscribed to." [S2] The page gives no sensitivity class; requires verification. | `calendars.list` |
| `https://www.googleapis.com/auth/calendar.events.owned` | "See, create, change, and delete events on Google calendars you own." [S2] Expected to be sensitive, because Google's examples of sensitive scopes include "reading events stored in Google Calendar" [S4]; requires verification. | `events.range`, `event.create` |

Both scope strings exist exactly as the catalog declares them [S2]. The calendar list includes calendars the user subscribes to but does not own, so Whumpo must admit only owned calendars before `events.range`; `calendar.events.owned` already limits events to owned calendars [S2].

### Verification and approvals

- Brand verification and Search Console domain verification, as for Gmail [S5]. The same project and consent screen can carry both Google adapters.
- Sensitive-scope verification: privacy policy, justification, demo video and domain verification [S4]. Estimates disagree: 3–5 business days [S4] or 10 business days [S8].
- No restricted Calendar scope is requested, so no security assessment is expected; this depends on the scope classes that still require verification [S2].
- The same 100-test-user and unverified-app caps apply [S6] [S7].

### Tokens, refresh and revocation

The same Google rules as Gmail apply [S9] [S10]: 7-day refresh tokens in Testing status, the 100-tokens-per-account limit, partial grants and RFC 7009 revocation. The Gmail-specific password-change rule [S9] does not apply to Calendar-only tokens.

### Rate limits and quotas

Calendar allows "600 requests" per minute per user per project and "10,000 requests" per minute per project [S16]. Google states standard use is "available at no additional cost", and overage is "planned to incur charges" later in 2026 with billing details "with at least 90 days' notice" [S16]; requires verification before launch.

### Push alternatives (not used)

Calendar push uses HTTPS webhook channels that the developer must renew [S18]. Whumpo does not use them.

### Data use and AI policy

Limited Use applies to "data derived from both Sensitive and Restricted scopes" [S12], so the Gmail Limited Use, human-reading and AI-training rules apply equally to calendar content [S11] [S12].

### Contract mapping

| Contract element | Google Calendar fit |
| --- | --- |
| Request-bound lookup consent | `events.range` is `request-bound` with `maxRangeDays: 31`; same Limited Use reading as Gmail [S11]. |
| Owner-control metadata | `calendars.list` returns calendar metadata to the owner panel only. It cannot target `model-context`. |
| Owner-request-only authority | `event.create` is owner-request only. Attendee notification behaviour of `events.insert` requires verification in WH-097 before the review card is written. |
| Idempotency | The catalog uses `provider-idempotency-key` (a client event `id`). IDs must use base32hex characters and be 5–1024 characters, but Google "cannot guarantee that ID collisions will be detected at event creation time" [S19]. Reconcile through `events.range` remains required. |
| Data classes and receipts | `connector-content` and `connector-receipts`, as for Gmail. |
| Refresh and revocation | `single-flight` and `rfc7009` [S10]. |

### Conflicts needing owner or counsel decision

1. **Limited Use and AI clause** (*needs counsel decision*): same as Gmail [S11] [S12].
2. **Idempotency strength** (*engineering decision for WH-097*): a client event ID is weaker than the contract's `provider-idempotency-key` assumption, because duplicate detection is not guaranteed [S19]. Recommendation: keep the ID, and always reconcile by reading back that ID before any owner retry.
3. **Scope class** (*requires verification*): confirm the consent-screen class of both scopes in the production project [S2] [S4].

### Owner and counsel actions

1. Reuse the Google projects, domain verification, home page and privacy policy from Gmail [S4] [S5] [S21].
2. Add the two Calendar scopes to the consent screen and record the Calendar demo video [S4].
3. Counsel: the Gmail Limited Use and AI review covers calendar content [S12].

### Prepare now versus blocked

- **Prepare now:** scope justifications, owned-calendar filtering, event-ID generation and readback tests with synthetic providers.
- **Blocked on the owner:** the same Google account, project and domain steps as Gmail.
- **Blocked on the built adapter:** the demo video and sensitive-scope submission.

### Customer-visible cost flags

All operations are plan-included with zero customer units. Google's planned overage charge is an operator cost and requires verification [S16].

## Outlook email (WH-098)

Catalog key: `outlook-email`. Operations: `messages.search`, `message.get` (request-bound reads) and `message.send` (owner-request action).

### Scopes and sensitivity

| Scope | Class | Used by |
| --- | --- | --- |
| `offline_access` | Delegated; admin consent "No"; requests a refresh token [S22] | refresh for every operation |
| `Mail.Read` | Delegated; admin consent "No"; "available for consent in personal Microsoft accounts" [S22] | `messages.search`, `message.get`, reconcile of `message.send` |
| `Mail.Send` | Delegated; admin consent "No"; available for personal accounts [S22] | `message.send` |

Listing messages needs only `Mail.ReadBasic` as least privilege [S46], but `message.get` needs bodies, so `Mail.Read` stays. Account identity for binding (for example `/me`) may need an extra scope such as `User.Read`; requires verification in WH-098.

### Verification and approvals

- **Publisher verification.** It needs a verified Microsoft AI Cloud Partner Program account with a Partner One ID, an app registered with an Entra work or school account ("Apps that are registered by using a Microsoft account can't be publisher verified"), and a publisher domain or DNS-verified domain matching the partner account's email domain [S23]. "Microsoft doesn't charge developers for publisher verification" [S23], and once prerequisites are met developers "can be verified in minutes" [S23]. The time to verify the partner account itself requires verification.
- **Why it matters.** "If risk-based step-up consent is enabled, users can't consent to most newly registered multitenant apps that aren't publisher verified." [S23] Such requests step up to admin approval, and without an admin consent workflow the user sees error AADSTS90094 [S26].
- **Tenant controls.** By default users may consent to permissions that do not need admin consent, "for example ... access to their mailbox" [S25]. A tenant can restrict consent to verified publishers and low-impact permissions, or disable user consent; users can then request admin approval through the admin consent workflow [S25] [S27].
- **Account types.** The `common` endpoint serves "both Microsoft accounts and work or school accounts" [S45]; the matching audience is multitenant plus personal accounts [S28].
- **Microsoft 365 App Compliance.** Publisher Attestation is a self-assessment; Certification is an annual independent audit through a contract with Claranet, and "In some cases, certification may be required for apps to be enabled within a Microsoft tenant." [S40] The certification cost requires verification.

### Tokens, refresh and revocation

- Access tokens: a random default "between 60-90 minutes (75 minutes on average)" [S30], which fits the catalog cap of 5400 seconds. If a client declares continuous access evaluation (CAE) capability, tokens can be "up to 28 hours" [S31]; non-CAE clients keep the default [S31]. Whumpo must not declare CAE capability while the cap stands.
- Refresh tokens: "90 days" by default for web apps, and "Refresh tokens replace themselves with a fresh token upon every use" while the old one is not revoked [S29]. This fits `single-flight` with atomic storage of the rotated token.
- Revocation: admin action, user action or credential change can revoke refresh tokens; a user password change leaves a confidential client's refresh token alive [S29]. No per-token delegated revocation endpoint was found. `revokeSignInSessions` invalidates all of a user's refresh tokens across apps and is "Not supported" for personal accounts [S32]. Deleting the permission grant needs admin-level `DelegatedPermissionGrant.ReadWrite.All` [S33]. Users remove access in My Apps for work or school accounts [S34]; for personal accounts, Microsoft's terms point to `account.live.com/consent/Manage` [S41]. This confirms the catalog's `local-only-owner-removal` kind.

### Rate limits and quotas

Outlook limits each app and mailbox pair to "10,000 API requests in a 10-minute period" and "Four concurrent requests" [S35]. A 429 response carries `Retry-After`, and immediate retries count against limits [S35]. Mail and Calendar APIs are not on the metered API list [S43]. A `$search` returns "up to 1,000 results" [S38]; the catalog asks for 10.

### Push alternatives (not used)

Graph change notifications deliver webhooks for message and event changes, with subscriptions renewed at least weekly [S42]. Whumpo does not use them.

### Data use and AI policy

- **Email API use** (Microsoft APIs Terms of Use, section 3(c), "Accessing the Exchange and Outlook Services through Microsoft email protocols and APIs") [S41]: "Unless you have use permissions expressly and specifically granted by Customers in connection with using your Application, you may not use Microsoft email protocols and APIs for any purpose other than" syncing or backing up messages, calendar events and contacts.
- **Copies and data use** (section 3(b)) [S41]: no databases or copies "except as necessary to enable an intended usage scenario", and no use "outside any permissions expressly granted by Customers".
- **Privacy** (section 5) [S41]: "implement proper retention and deletion policies, including deleting all data when your user abandons your Application, uninstalls your Application", and the privacy statement must link to `account.live.com/consent/Manage` and/or `myapps.microsoft.com` so users can revoke consent.
- **AI training.** No clause naming AI or model training was found in the Terms of Use [S41]. The permission, copy and redistribution limits above still govern any model use.

### Contract mapping

| Contract element | Outlook fit |
| --- | --- |
| Request-bound lookup consent | `messages.search` and `message.get` are `request-bound`. The consent record is the candidate "use permissions expressly and specifically granted by Customers" [S41]; counsel must confirm. |
| Owner-request-only authority | `message.send` is owner-request only, using the owner's delegated token; tenant-wide application permissions are never requested [S22]. |
| Receipts and idempotency | `sendMail` "returns `202 Accepted`" with no body, and 202 "doesn't indicate that the request processing has completed" [S36]. The catalog's `marker-readback` through `messages.search` matches; acceptance is not delivery. |
| Paging | Microsoft says "Don't try to extract the `$skiptoken` or `$skip` value and use it in a different request." [S39] The contract's rule of extracting the token conflicts; see below. |
| Data classes | `connector-content` with show-and-discard by default, which also fits the section 3(b) copy limit [S41]. |
| Refresh and revocation | `single-flight` [S29]; `local-only-owner-removal` with the owner pointed to My Apps or the personal-account consent page [S34] [S41]. |

### Conflicts needing owner or counsel decision

1. **Section 3(c) email use** (*needs counsel decision*). Owner-requested lookup and reviewed send are neither syncing nor backup, so Whumpo relies on permissions "expressly and specifically granted by Customers" [S41]. Recommendation: name lookup, send and any model use explicitly on the connect screen and in each consent card, and have counsel confirm before private test with real mailboxes.
2. **Model use of mail** (*needs counsel decision*). Sections 3(b) and 5 [S41] limit use to customer-granted permissions; `model-context` stays closed until WH-021 admits a route and counsel accepts the consent wording.
3. **Paging token** (*engineering decision for WH-098*). The contract's "extract and rebuild" rule conflicts with [S39]. Recommendation: v1 reads only the first page (the catalog already caps results at 10) and never follows `@odata.nextLink`.
4. **Admin-blocked consent** (*owner decision on copy*). AADSTS90094 [S26] must surface as an honest consent failure that tells the owner to ask their administrator; no fallback credential.
5. **CAE** (*engineering decision*): do not declare CAE capability while `maxAccessSeconds` is 5400 [S31].

### Owner and counsel actions

1. Create or confirm a Microsoft Entra work or school tenant to own the app registration [S23].
2. Enroll in and verify a Microsoft AI Cloud Partner Program account; the verified email domain must match the publisher domain [S23] [S24].
3. Add and DNS-verify `whumpo.com` as the publisher domain [S23].
4. Register a multitenant plus personal-account app with the `common` endpoint and the exact delegated scopes [S28].
5. Add the Microsoft consent-revocation links to the privacy statement [S41].
6. Decide whether to complete Publisher Attestation, and whether Certification is worth its cost (requires verification) [S40].
7. Counsel: section 3(c) and section 5 review [S41].

### Prepare now versus blocked

- **Prepare now:** privacy-statement text, consent-card wording for section 3(c), the admin-consent failure path, first-page-only search and marker readback with synthetic providers.
- **Blocked on the owner:** the Entra tenant, partner account, domain verification, app registration and secrets.
- **Blocked on counsel:** real-mailbox private test and any model use.

### Customer-visible cost flags

All operations are plan-included with zero customer units. Work or school users need mail "stored in a mailbox in the cloud on Exchange Online as part of Microsoft 365" [S47], so a customer without that licence cannot use the adapter; licence entitlement per account type requires verification. Graph mail calls are not metered [S43].

## Microsoft Calendar (WH-099)

Catalog key: `microsoft-calendar`. Operations: `events.range` (request-bound read) and `event.create` (owner-request action).

### Scopes and sensitivity

| Scope | Class | Used by |
| --- | --- | --- |
| `offline_access` | Delegated; admin consent "No" [S22] | refresh for every operation |
| `Calendars.ReadWrite` | Delegated; admin consent "No"; "create, read, update, and delete events in user calendars"; available for personal accounts [S22] | `events.range`, `event.create` |

The scope covers every user calendar [S22], so Whumpo enforces the owner's selected calendars on every read and create, as the contract requires.

### Verification and approvals

The same Entra registration, partner account, publisher verification and tenant-consent rules as Outlook apply [S23] [S25] [S26]. One multitenant app may carry both Microsoft adapters, but then one consent screen asks for mail and calendar together; whether to use one app or two is an owner decision below.

### Tokens, refresh and revocation

The same rules as Outlook apply: 60–90 minute access tokens [S30], 90-day rotating refresh tokens [S29], no CAE declaration [S31], and owner-action revocation [S32] [S33].

### Rate limits and quotas

Calendar calls share the Outlook per-app, per-mailbox limits [S35] and are not metered [S43].

### Push alternatives (not used)

Graph change notifications cover events too [S42]. Whumpo does not use them.

### Data use and AI policy

Section 3(c) of the Microsoft APIs Terms of Use names "calendar events" alongside email, so the Outlook counsel question applies equally [S41]. Sections 3(b) and 5 apply as for Outlook [S41].

### Contract mapping

| Contract element | Microsoft Calendar fit |
| --- | --- |
| Request-bound lookup consent | `events.range` is `request-bound` with `maxRangeDays: 31`. |
| Owner-request-only authority | `event.create` is owner-request only. When an event has attendees, "the server sends invitations to all attendees" and this "can't be configured" [S44]; the review card must say so. |
| Idempotency | `transactionId` is "A custom identifier specified by a client app for the server to avoid redundant POST operations in case of client retries" [S37]; it fits `provider-idempotency-key`, with `events.range` readback still required. |
| Data classes and receipts | `connector-content` and `connector-receipts`. |
| Refresh and revocation | `single-flight` and `local-only-owner-removal`. |

### Conflicts needing owner or counsel decision

1. **Section 3(c)** (*needs counsel decision*): as for Outlook [S41].
2. **Invitations cannot be suppressed** (*owner decision on review copy*) [S44].
3. **One or two Microsoft apps** (*owner decision*): see Open owner decisions.

### Owner and counsel actions

Reuse the Outlook steps [S23] [S28] [S41]. Add `Calendars.ReadWrite` to the registration and record the review copy for invitations [S44].

### Prepare now versus blocked

- **Prepare now:** selected-calendar enforcement, `transactionId` generation, invitation disclosure and DST/recurrence fixtures with synthetic providers.
- **Blocked on the owner:** the shared Microsoft registration prerequisites.
- **Blocked on counsel:** real-calendar private test.

### Customer-visible cost flags

All operations are plan-included with zero customer units. The Exchange Online mailbox requirement for work or school accounts applies [S47]; licence entitlement requires verification. Not metered [S43].

## HubSpot contact lookup (WH-100)

Catalog key: `hubspot`. Operations: `contacts.search` (request-bound read) and `contact.create` (owner-request action; the only `approved-rule` candidate).

### Scopes and sensitivity

| Scope | Class | Used by |
| --- | --- | --- |
| `oauth` | "Basic scope required for OAuth. This scope is added by default to all apps. Available to all accounts." [S52] | authorization |
| `crm.objects.contacts.read` | "View properties and other details about contacts. Available to all accounts." [S52] | `contacts.search` |
| `crm.objects.contacts.write` | "Create, delete, and make changes to contacts. Available to all accounts." [S52] | `contact.create` |

Access tokens "reflect the scopes requested from the app and do not reflect the permissions or limitations of what a user can do in their HubSpot account" [S48], so Whumpo, not HubSpot, limits what the owner's connection can touch.

### Verification and approvals

- **App type.** "Any app designed for installation by multiple HubSpot accounts or listing on the HubSpot Marketplace must use OAuth." [S48] Legacy private apps use a single-account static token [S66] and do not fit a multi-customer connector.
- **Distribution.** A `private` distribution installs in "up to 10 allowlisted accounts", a Marketplace-distributed app before listing "can be installed in up to 25 accounts", and a listed app in unlimited accounts [S53] [S54].
- **Acceptable Use Policy.** "Until the AUP is signed, you won't be able to install your app in accounts other than developer test accounts." [S54] Unreviewed apps show a warning that installers must accept [S54].
- **Installer.** The installing user must be a Super Admin or have Marketplace Access permissions [S48].
- **Listing.** OAuth only, "at least three active, unique installs" from unaffiliated production accounts, live terms and privacy policy URLs, a support contact, and only scopes the app uses [S55]. The first review is "within 10 business days", and the whole process "should take no more than 60 days" from feedback [S55]. The Technology Partner Program Agreement says "No fees, commissions or other payments will be due or payable" [S62].
- **AI connectors.** A listed app that "primarily connects HubSpot to external generative AI tools" must "require user-level permissions" or use HubSpot's MCP server [S55]. Whether Whumpo's listing counts is an owner decision below.

### Tokens, refresh and revocation

- Access tokens are "short-lived (30 minutes)" [S49], matching the catalog's `maxAccessSeconds: 1800`. A 401 "is not a valid indicator that a new access token must be retrieved" [S56], so refresh follows the recorded expiry.
- Refresh-token lifetime is not stated in the fetched pages; requires verification.
- **Endpoint deprecation.** "On February 16, 2027, HubSpot will deprecate the legacy OAuth v1 endpoints" [S51]; after that date v1 calls "will begin returning errors" [S51]. The catalog's token endpoint and refresh-token delete are both v1.
- **Revocation.** The v1 delete "will only delete the refresh token", leaves issued access tokens alive and does not uninstall the app [S50]. The replacement is a POST to the date-versioned revoke endpoint with "the refresh token in a URL-encoded request body" [S51], and "Requests that include sensitive data in the URL will return an error" [S51].
- Examples use both `api.hubapi.com` and `api.hubspot.com` hosts for the new endpoints [S49] [S51]; the exact host requires verification before the catalog origin changes.

### Rate limits and quotas

A Marketplace-distributed app is limited to "110 requests every 10 seconds" per installing account, excluding search [S56]. Search is "rate limited to five requests per second per account", returns at most 200 objects per page and 10,000 results per query, and newly created objects may take "a few moments" to appear [S57]. Search responses carry no rate-limit headers [S56]. A privately distributed app has per-account daily limits by customer tier [S56]. The search guide documents date-versioned CRM paths; whether the catalog's `/crm/v3/` paths are deprecated requires verification [S57].

### Push alternatives (not used)

HubSpot's webhooks journal (beta) offers event subscriptions [S59]. Whumpo does not use it.

### Data use and AI policy

- **AI and model training** (Developer Terms, "Limits and Restrictions") [S60]: "You must not use Customer Data or Content to train, fine-tune, improve, or otherwise develop any artificial intelligence or machine learning model, product, or service", except a model trained solely on one customer's data for that customer with express permission. A Technology Partner exception exists only while in good standing [S62].
- **Third parties** [S60]: "You must also obtain express permission from each Customer before You share their data with any third parties."
- **Retention and deletion** [S60]: no caching or storage "other than for reasonable and lawful periods", and when a customer stops using the app, delete their data "including all tokens".
- **Privacy** [S60] [S61]: a legally adequate privacy policy, and the app "should clearly explain your data privacy practices".
- **Scopes** [S61]: no scopes "not required for your Application".
- The customer-facing HubSpot DPA could not be read in full [S63].

### Contract mapping

| Contract element | HubSpot fit |
| --- | --- |
| Request-bound lookup consent | `contacts.search` is `request-bound`; the consent card is the candidate "express permission" before contact data reaches a third-party model provider [S60]. |
| Authority | `contact.create` is owner-request, plus the `approved-rule` candidate that stays unusable until WH-100 live acceptance and WH-069 rule admission. A deterministic rule invokes no AI agent. |
| Idempotency | `marker-readback` through `contacts.search`. Email is "the primary unique identifier to avoid duplicate contacts" [S58]; no idempotency key is documented, and search lag [S57] can leave a just-created contact unseen, so reconciliation stays `uncertain` and retries later rather than redispatching. |
| Data classes and receipts | `connector-content` with show-and-discard, which fits the "reasonable and lawful periods" rule [S60]; minimized `connector-receipts`. |
| Refresh | `single-flight`; 30-minute access tokens [S49]. |
| Revocation | Catalog kind `provider-refresh-delete` points at the v1 path-token URL, which is deprecated [S51]. |

### Conflicts needing owner or counsel decision

1. **Catalog endpoints are deprecated** (*catalog change in the WH-100 contract child*). The v1 token and refresh-token delete endpoints stop working after February 16, 2027 [S51]. The date-versioned revoke takes the token in the body [S51], which also resolves open decision 3 in [the contract](connectors.md#open-owner-decisions) without a path-token exception. Recommendation: WH-100 replaces the v1 endpoints and switches the revocation kind to a body-token revoke before registering a client.
2. **Third-party sharing for model use** (*needs counsel decision*). `model-context` needs express customer permission [S60] and a non-training route [S60]; the consent card wording must be confirmed.
3. **AI connector listing rule** (*needs owner decision*). If HubSpot treats Whumpo as an AI connector, listing needs user-level permissions or the MCP server [S55].
4. **Install cap** (*owner decision*). Without a listing, the app reaches at most 25 accounts [S54]; a paid launch with more Business customers needs the listing.

### Owner and counsel actions

1. Create a HubSpot developer account and up to 10 free developer test accounts [S64].
2. Create a Marketplace-distributed OAuth app with exactly the three scopes [S52] [S53], and sign the Acceptable Use Policy [S54].
3. Verify the `whumpo.com` domain by DNS TXT record for the install page [S54].
4. Publish terms of service, privacy policy and support contact [S55].
5. Before listing: gather three unaffiliated active installs, accept the Technology Partner Program Agreement and submit for review [S55] [S62].
6. Counsel: Developer Terms AI, third-party sharing and deletion clauses [S60], and the customer DPA [S63].

### Prepare now versus blocked

- **Prepare now:** the endpoint migration design, search lag handling, field-preserving contact create, consent-card wording and synthetic tests.
- **Blocked on the owner:** developer account, app, AUP signature, domain record and client secrets.
- **Blocked on customers:** three unaffiliated active installs for listing [S55].

### Customer-visible cost flags

All operations are plan-included with zero customer units. Contacts scopes are "Available to all accounts" [S52], so a free HubSpot CRM customer can connect. HubSpot's API Limit Increase add-on is a customer purchase of "$500 per month" [S65] and "does not increase the limits" of Marketplace-distributed apps [S56], so customers must never be told to buy it for Whumpo. Developer test accounts are free [S64].

## Recommended adapter order

Engineering order, lowest external friction first:

1. **HubSpot contact lookup (WH-100).** Up to 25 installs need no HubSpot review [S54], test accounts are free [S64], and the only hard external prerequisite is the AUP signature [S54]. The endpoint migration [S51] is internal catalog work that should precede any client registration.
2. **Microsoft Calendar (WH-099).** Publisher verification is free and quick once the partner account exists [S23]; calendar events carry a real idempotency key [S37] and less sensitive content than mail.
3. **Outlook email (WH-098).** Same Microsoft prerequisites [S23], plus the section 3(c) counsel question [S41] and no message ID from `sendMail` [S36].
4. **Google Calendar (WH-097).** Brand and sensitive-scope verification with a demo video [S4] [S5]; quota billing is planned [S16].
5. **Gmail (WH-096).** Restricted-scope verification and an annual paid assessment [S3] [S8] make it the longest pole.

The external clocks run in the opposite order, so start them now in parallel. Google domain verification, brand verification, the privacy policy and assessor quotes need no adapter [S5] [S8], but the restricted-scope submission needs a demo of the built Gmail flow [S4]. Gmail synthetic implementation should therefore reach demo quality early, even though its live acceptance comes last. Because WH-104 requires all seven connections before paid launch, the Gmail assessment, not engineering, is the likely critical path.

## Risks

- **Google assessment delay or cost.** The assessment price is unpublished and requires verification [S8]; the estimate is "not guaranteed" [S8]. Mitigation: get quotes early and name a renewal owner.
- **Testing-status token expiry.** Seven-day refresh tokens [S9] make long private tests fail weekly. Mitigation: plan re-consent and record it as expected, not as a defect.
- **Lifetime project caps.** The unverified-app user cap lasts for the life of the project [S7]. Mitigation: never use the production project for ad-hoc testing [S21].
- **Microsoft tenant consent.** Many work tenants will require admin approval for an unverified or high-impact app [S25] [S26]. Mitigation: complete publisher verification before inviting work-account customers.
- **HubSpot deprecation.** A v1 client would break after February 16, 2027 [S51]. Mitigation: build only against date-versioned endpoints.
- **Policy drift.** Google's Workspace policy was updated in September 2026 and its AI clause is newer than the general data policy [S11] [S12]. Mitigation: recheck every source before each submission.
- **Counsel answers narrow the design.** If counsel rejects model use for any provider, that provider stays owner-panel only. The contract already supports that without code changes.
- **Duplicate side effects.** Gmail and Outlook send and HubSpot create lack a guaranteed provider idempotency key [S36] [S58]; Google event IDs do not guarantee duplicate detection [S19]. Mitigation: the contract's single claim, marker readback and `uncertain` state, never a blind resend.

## Open owner decisions

1. **Start the Google verification track now?** Recommendation: yes. Verify the domain, publish the privacy policy with the Limited Use statement and request assessor quotes now [S5] [S8] [S12]; it is the longest external clock.
2. **Who owns the provider accounts and renewals?** Recommendation: one named owner for the Google projects, the Microsoft partner account and tenant, and the HubSpot developer account, with the CASA renewal date tracked in the WH-096 issue [S3].
3. **Model use of connected content at launch.** Recommendation: launch with `owner-panel` only for all five providers and open `model-context` per provider only after counsel sign-off on [S11] [S12] [S41] [S60] and WH-021 route admission.
4. **One or two Microsoft apps.** Recommendation: one multitenant app for both Microsoft adapters, so publisher verification and tenant approval happen once [S23]; the consent screen then lists mail and calendar together.
5. **HubSpot listing.** Recommendation: run private test under the 25-install cap [S54], and plan the listing (three unaffiliated installs, 10-business-day first review) before paid launch [S55].
6. **Microsoft 365 Certification.** Recommendation: complete the free Publisher Attestation and defer paid Certification until a customer tenant requires it [S40]; its cost requires verification.

## Sources

All rows were retrieved on 2026-10-09 (UTC) from public documentation without signing in. `unverified` means the page could not be read in full, so nothing in this plan depends on it alone.

| ID | Source | Fetched | Status | Used for |
| --- | --- | --- | --- | --- |
| S1 | [Gmail API scopes](https://developers.google.com/workspace/gmail/api/auth/scopes) | 2026-10-09 | fetched | Gmail scope classes, server-storage rule |
| S2 | [Choose Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth) | 2026-10-09 | fetched | Calendar scope strings; no sensitivity column |
| S3 | [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification) | 2026-10-09 | fetched | Assessment requirement, 12-month cycle, exceptions |
| S4 | [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification) | 2026-10-09 | fetched | Privacy policy, justification, demo video, timeline |
| S5 | [Brand verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification) | 2026-10-09 | fetched | Search Console domains, home page |
| S6 | [Unverified apps](https://support.google.com/cloud/answer/7454865) | 2026-10-09 | fetched | 100-new-user cap, possible months |
| S7 | [Manage app audience](https://support.google.com/cloud/answer/15549945) | 2026-10-09 | fetched | Test users, 7-day test authorizations, lifetime cap |
| S8 | [OAuth verification FAQ](https://support.google.com/cloud/answer/13463817) | 2026-10-09 | fetched | Verification estimates, assessment fees |
| S9 | [Google OAuth 2.0 overview](https://developers.google.com/identity/protocols/oauth2) | 2026-10-09 | fetched | Refresh-token expiration and limits |
| S10 | [OAuth 2.0 for web server apps](https://developers.google.com/identity/protocols/oauth2/web-server) | 2026-10-09 | fetched | Offline access, revocation, partial grants |
| S11 | [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy) | 2026-10-09 | fetched | Limited Use |
| S12 | [Google Workspace user data and developer policy](https://developers.google.com/workspace/workspace-api-user-data-developer-policy) | 2026-10-09 | fetched | AI clause, disclosure, prompt injection |
| S13 | [Google security assessment](https://support.google.com/cloud/answer/13465431) | 2026-10-09 | fetched | Annual assessment, assurance levels |
| S14 | [CASA assurance levels](https://appdefensealliance.dev/casa/casa-tiering) | 2026-10-09 | fetched | Yearly revalidation, level set by framework user |
| S15 | [Gmail API usage limits](https://developers.google.com/workspace/gmail/api/reference/quota) | 2026-10-09 | fetched | Quota units, planned overage charges |
| S16 | [Calendar API quotas](https://developers.google.com/workspace/calendar/api/guides/quota) | 2026-10-09 | fetched | Request limits, planned overage charges |
| S17 | [Gmail push notifications](https://developers.google.com/workspace/gmail/api/guides/push) | 2026-10-09 | fetched | Push alternative |
| S18 | [Calendar push notifications](https://developers.google.com/workspace/calendar/api/guides/push) | 2026-10-09 | fetched | Push alternative |
| S19 | [Calendar events.insert](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert) | 2026-10-09 | fetched | Client event ID rules |
| S20 | [Gmail users.messages.send](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send) | 2026-10-09 | fetched | Send returns a Message |
| S21 | [Google OAuth policy compliance](https://developers.google.com/identity/protocols/oauth2/production-readiness/policy-compliance) | 2026-10-09 | fetched | Separate test and production projects |
| S22 | [Microsoft Graph permissions reference](https://learn.microsoft.com/en-us/graph/permissions-reference) | 2026-10-09 | fetched | Delegated scopes, admin consent, personal accounts |
| S23 | [Publisher verification](https://learn.microsoft.com/en-us/entra/identity-platform/publisher-verification-overview) | 2026-10-09 | fetched | Requirements, cost, consent effect |
| S24 | [Mark an app as publisher verified](https://learn.microsoft.com/en-us/entra/identity-platform/mark-app-as-publisher-verified) | 2026-10-09 | fetched | Verification steps and domain match |
| S25 | [Configure user consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-user-consent) | 2026-10-09 | fetched | Default and restricted consent policies |
| S26 | [Risk-based step-up consent](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-risk-based-step-up-consent) | 2026-10-09 | fetched | Unverified-app step-up, AADSTS90094 |
| S27 | [Admin consent workflow](https://learn.microsoft.com/en-us/entra/identity/enterprise-apps/configure-admin-consent-workflow) | 2026-10-09 | fetched | Admin approval requests |
| S28 | [Supported account types](https://learn.microsoft.com/en-us/entra/identity-platform/supported-accounts-validation) | 2026-10-09 | fetched | Multitenant plus personal audience |
| S29 | [Refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens) | 2026-10-09 | fetched | 90-day default, rotation, revocation causes |
| S30 | [Access tokens](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens) | 2026-10-09 | fetched | 60–90 minute default |
| S31 | [Continuous access evaluation](https://learn.microsoft.com/en-us/entra/identity/conditional-access/concept-continuous-access-evaluation) | 2026-10-09 | fetched | CAE lifetimes, non-CAE default |
| S32 | [user: revokeSignInSessions](https://learn.microsoft.com/en-us/graph/api/user-revokesigninsessions) | 2026-10-09 | fetched | User-wide revocation only |
| S33 | [Delete oAuth2PermissionGrant](https://learn.microsoft.com/en-us/graph/api/oauth2permissiongrant-delete) | 2026-10-09 | fetched | Admin-level grant deletion |
| S34 | [Revoke app permissions in My Apps](https://support.microsoft.com/en-us/accounts-billing/work-school/edit-or-revoke-application-permissions-in-the-my-apps-portal) | 2026-10-09 | unverified | Work or school self-service revocation |
| S35 | [Graph throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits) | 2026-10-09 | fetched | Outlook per-mailbox limits, 429 handling |
| S36 | [user: sendMail](https://learn.microsoft.com/en-us/graph/api/user-sendmail) | 2026-10-09 | fetched | 202 with no body |
| S37 | [Graph event resource](https://learn.microsoft.com/en-us/graph/api/resources/event) | 2026-10-09 | fetched | `transactionId` |
| S38 | [Graph $search parameter](https://learn.microsoft.com/en-us/graph/search-query-parameter) | 2026-10-09 | fetched | Search result cap |
| S39 | [Graph paging](https://learn.microsoft.com/en-us/graph/paging) | 2026-10-09 | fetched | Do not extract paging tokens |
| S40 | [Microsoft 365 App Compliance](https://learn.microsoft.com/en-us/microsoft-365-app-certification/overview) | 2026-10-09 | fetched | Attestation and Certification |
| S41 | [Microsoft APIs Terms of Use](https://learn.microsoft.com/en-us/legal/microsoft-apis/terms-of-use) | 2026-10-09 | fetched | Sections 3(b), 3(c), 5 |
| S42 | [Graph change notifications](https://learn.microsoft.com/en-us/graph/change-notifications-overview) | 2026-10-09 | fetched | Push alternative |
| S43 | [Graph metered APIs](https://learn.microsoft.com/en-us/graph/metered-api-list) | 2026-10-09 | fetched | Mail and Calendar not metered |
| S44 | [user: create event](https://learn.microsoft.com/en-us/graph/api/user-post-events) | 2026-10-09 | fetched | Attendee invitations |
| S45 | [Microsoft identity platform protocols](https://learn.microsoft.com/en-us/entra/identity-platform/v2-protocols) | 2026-10-09 | fetched | `common` endpoint audience |
| S46 | [user: list messages](https://learn.microsoft.com/en-us/graph/api/user-list-messages) | 2026-10-09 | fetched | Least-privileged list permission |
| S47 | [Outlook mail API overview](https://learn.microsoft.com/en-us/graph/outlook-mail-concept-overview) | 2026-10-09 | fetched | Exchange Online mailbox requirement |
| S48 | [HubSpot: working with OAuth](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/working-with-oauth) | 2026-10-09 | fetched | OAuth requirement, installer role, token scopes |
| S49 | [HubSpot: manage OAuth tokens](https://developers.hubspot.com/docs/api-reference/latest/authentication/manage-oauth-tokens) | 2026-10-09 | fetched | 30-minute access tokens |
| S50 | [HubSpot OAuth v1 guide](https://developers.hubspot.com/docs/api-reference/legacy/authentication/oauth-tokens/v1/guide) | 2026-10-09 | fetched | v1 refresh-token delete semantics |
| S51 | [HubSpot OAuth v1 migration guide](https://developers.hubspot.com/docs/api-reference/legacy/authentication/oauth-tokens/v1/migration-guide) | 2026-10-09 | fetched | Deprecation date, body-token revoke |
| S52 | [HubSpot scopes](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/scopes) | 2026-10-09 | fetched | Scope names and availability |
| S53 | [HubSpot app configuration](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/app-configuration) | 2026-10-09 | fetched | Distribution values |
| S54 | [Manage apps in HubSpot](https://developers.hubspot.com/docs/apps/developer-platform/build-apps/manage-apps-in-hubspot) | 2026-10-09 | fetched | Install caps, AUP, domain verification |
| S55 | [HubSpot Marketplace listing requirements](https://developers.hubspot.com/docs/apps/developer-platform/list-apps/listing-your-app/app-marketplace-listing-requirements) | 2026-10-09 | fetched | Listing rules, AI connectors, review timeline |
| S56 | [HubSpot usage guidelines](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines) | 2026-10-09 | fetched | Rate limits, 401 guidance |
| S57 | [HubSpot: search the CRM](https://developers.hubspot.com/docs/api-reference/latest/crm/search-the-crm) | 2026-10-09 | fetched | Search limits and lag |
| S58 | [HubSpot contacts guide](https://developers.hubspot.com/docs/api-reference/latest/crm/objects/contacts/guide) | 2026-10-09 | fetched | Email as unique identifier |
| S59 | [HubSpot webhooks journal](https://developers.hubspot.com/docs/api-reference/legacy/webhooks/webhooks-journal) | 2026-10-09 | fetched | Push alternative |
| S60 | [HubSpot Developer Terms](https://legal.hubspot.com/developer-terms) | 2026-10-09 | fetched | AI, third-party sharing, retention, deletion |
| S61 | [HubSpot Developer Policy](https://legal.hubspot.com/hubspot-developer-policy) | 2026-10-09 | fetched | Privacy explanation, minimum scopes |
| S62 | [HubSpot Technology Partner Program Agreement](https://legal.hubspot.com/technology-program-agreement) | 2026-10-09 | fetched | No fees, AI training exception |
| S63 | [HubSpot Data Processing Agreement](https://legal.hubspot.com/dpa) | 2026-10-09 | unverified | Customer DPA terms |
| S64 | [HubSpot account types](https://developers.hubspot.com/docs/getting-started/account-types) | 2026-10-09 | fetched | Free developer test accounts |
| S65 | [HubSpot product and services catalog](https://legal.hubspot.com/hubspot-product-and-services-catalog) | 2026-10-09 | fetched | API Limit Increase price |
| S66 | [HubSpot legacy private apps](https://developers.hubspot.com/docs/apps/legacy-apps/private-apps/overview) | 2026-10-09 | fetched | Single-account static tokens |

## Verification

`node tests/connector-provider-readiness.mjs` (`pnpm test:connector-provider-readiness`) is an offline check of this document. It is not in any `tools/verify.mjs` profile. It bundles the frozen catalog from [source](../src/connector-catalog/catalog.ts) and checks that:

- the plan is marked Planned with its October 9, 2026 date, and each of the five planned catalog providers has its section, catalog key and all eleven subsections;
- each provider's scope table and matrix row equal the catalog scopes exactly, and every catalog operation is named in the contract mapping;
- every external link is `https` on an allow-listed official documentation host and appears in the Sources table; every source row is dated 2026-10-09, is `fetched` or `unverified`, and is cited;
- every pricing, timeline or entitlement sentence cites a source or says requires verification, and no sentence claims that an approval or verification already exists;
- local links and anchors resolve.

A built-in mutation set (dropping a provider, changing or adding a scope, dropping an operation, adding an `http`, non-official or unlisted link, removing or corrupting a source row, adding an approval claim or an unsourced spending or schedule claim, dropping a section, breaking a local link or anchor, and removing the date) must each be caught by its named check. The check proves the plan's structure and sourcing discipline only. It does not prove any provider requirement, approval, account state or legal conclusion.
