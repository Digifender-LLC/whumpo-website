# WHUMPO

## Brand Identity System

**Version 1.1 • October 2026**

> **BIG IDEAS. LESS WORK.**

Whumpo makes building and running an online presence feel as simple as asking for help.

---

# 01 • Brand Board

## The identity at a glance

This board is the visual north star for Whumpo. It establishes the cloud-elephant mascot, soft sky palette, rounded product language, and the balance between friendliness and operational credibility.

---

# 02 • Brand Foundation

## Brand essence

> **Whumpo is the capable online helper that turns plain-language intent into working digital services.**

| | |
|---|---|
| **Purpose** | Make the internet easier to build, operate, and own for people who do not want to become infrastructure experts. |
| **Promise** | Tell Whumpo what you need. Whumpo handles the technical work and keeps you informed. |
| **Difference** | The customer buys outcomes and capacity, not a collection of servers, cloud primitives, or developer tools. |
| **Emotional payoff** | Relief. Momentum. Confidence that the technical side is being looked after. |

## Positioning statement

For nontechnical individuals and small businesses that need websites, applications, domains, data, storage, and online services, Whumpo is an AI-managed internet platform that lets them get work done by chatting. Unlike traditional hosting or website builders, Whumpo continuously builds, operates, troubleshoots, and right-sizes the underlying services on the customer’s behalf.

## What Whumpo is not

- Not “a VPS with a chatbot.”
- Not a developer-first cloud dashboard.
- Not a one-shot AI website generator.
- Not a mascot-first toy product. The mascot supports trust and approachability; it does not replace clarity.

---

# 03 • Audience

## Designed for people who want outcomes, not infrastructure

Primary customers may never have heard of Cloudflare, GitHub, containers, DNS, or microservices. The product should never require that vocabulary for routine use.

| Audience | What they say | What Whumpo should hear |
|---|---|---|
| **Local business owner** | “I need customers to book appointments online.” | Website + booking flow + domain + notifications. |
| **Solo operator** | “I want a customer portal where people upload videos.” | Auth + portal + storage + processing + database. |
| **Creator / hobbyist** | “Can you make this idea work online?” | Choose the lightest suitable services and build it. |
| **Growing SMB** | “Traffic is spiking. Keep it online and tell me if I need a better plan.” | Use approved overage buffer, preserve uptime, then recommend right-sizing. |

## Experience principle

> **The customer describes the desired result. Whumpo translates that intent into infrastructure, code, configuration, and operations.**

---

# 04 • Personality

## Friendly enough to ask. Capable enough to trust.

| | |
|---|---|
| **Friendly** | Warm, approachable, never intimidating. |
| **Capable** | Confident in execution without boasting. |
| **Magical** | Complexity disappears, but the product never pretends work happened when it did not. |
| **Helpful** | Explains decisions in plain language and offers next steps. |
| **Nontechnical** | Avoids infrastructure jargon unless the user asks for it. |
| **Dependable** | Status, approvals, cost, and risk are communicated precisely. |
| **Conversational** | Feels like working with one consistent helper. |
| **Modern** | Fast, quiet, polished, and comfortable with automation. |

## Personality balance

Whumpo should feel more like a reliable, upbeat colleague than a cartoon sidekick. The cloud elephant brings warmth, memory, and softness; the product itself stays organized, transparent, and professional.

---

# 05 • Mascot

## The cloud elephant

The cloud elephant is Whumpo’s signature brand asset. It combines cloud-like lightness with the elephant’s associations of memory, steadiness, intelligence, and gentle strength. The character should be recognizable even without the wordmark.

## Mascot behavior

- Use simple, expressive poses: listening, working, thinking, celebrating, waiting, carrying, pointing, or gently floating.
- Keep facial features minimal: soft eyes, small smile, subtle blush.
- Use the trunk as a useful gesture device for pointing, carrying a spark, interacting with UI, or signaling progress.
- Keep proportions rounded and cloud-soft. Avoid realistic elephant anatomy.
- The mascot may acknowledge progress, but should never visually imply that work is complete before the system confirms completion.

## Avoid

- Baby-toy styling, diapers, pacifiers, nursery cues, or overly juvenile facial expressions.
- Busy costumes or role-play that competes with the core cloud-elephant silhouette.
- Using the mascot as the sole carrier of critical status, billing, security, or error information.

---

# 06 • Logo System

## Elephant mark with the Whumpo wordmark

On October 1, 2026, the owner selected the supplied cloud-elephant artwork reaching toward a gold star against a blue sky as the main brand mark. Pair it with the Whumpo wordmark on the homepage and workspace sidebar; use the same artwork for the favicon and touch icon. The wordmark remains legible independently.

The exact supplied master is [whumpo-mark-original.png](whumpo-mark-original.png). Committed PNG derivatives in `frontend/public/brand/whumpo-mark-*.png` preserve the full composition and colors, using size reduction only. The shared `Brand` component serves 48/96/192px variants; HTML declares 16/32px favicons and the 180px touch icon. The retired rounded-W asset is removed. Desktop header/sidebar use a fixed 44px image (the existing mobile header uses 32px) to avoid layout shifts and a rounded container suitable for both themes. These small files keep the 1.6 MB master out of normal page downloads.

| Variant | Use |
|---|---|
| **Primary** | Approved elephant/star mark with the Whumpo wordmark. Use in the website header and workspace. |
| **Mascot lockup** | Wordmark plus cloud elephant. Preferred for marketing, onboarding, app-store creative, and social. |
| **Compact mark** | The same approved elephant/star artwork, reduced to the required icon size. No rounded-W substitute. |
| **One-color** | Use deep navy, white, or black only when production constraints require a single color. |

## Clear space & minimum size

Maintain clear space around the signature equal to approximately the height of the lowercase “u.”

For digital use, do not render the full wordmark below roughly **90 px wide**; switch to the compact mark instead.

Final production measurements should be locked after vector artwork is created.

---

# 07 • Color

## Airy, trustworthy, optimistic

| Color | Hex | Primary use |
|---|---|---|
| **Deep Sky** | `#0F2D5B` | Primary brand, headings, navigation, trust surfaces |
| **Sky Blue** | `#60B5FF` | Primary action, progress, links, active states |
| **Cloud Coral** | `#FF7B7B` | Human warmth, highlights, rare attention states |
| **Sunshine** | `#FFD56B` | Sparks, ideas, delight, small emphasis |
| **Mint** | `#A7E3C1` | Healthy/ready states, growth, balance |
| **Cloud White** | `#F8FAFC` | Primary canvas and quiet space |

### Accessibility

Do not assume pastel accents provide sufficient text contrast.

Use **Deep Sky** or another verified high-contrast foreground for body text.

Pair status color with an icon and text label.

---

# 08 • Typography & Iconography

## Rounded personality, disciplined interface

| Display | Product UI |
|---|---|
| **Aa — Poppins Rounded** | **Aa — Inter** |
| Display / marketing / selected headings | UI / body text / data / long-form copy |
| Use a rounded geometric sans with strong lowercase forms if Poppins Rounded is unavailable. | Readable beats cute. Dense operational screens should favor Inter and clear hierarchy. |

## Icon style

- Rounded stroke geometry, simple silhouettes, limited detail.
- Use the elephant head sparingly as a brand marker, not as every icon.
- Infrastructure concepts should use plain-language visual metaphors: home, globe, storage, database, server, person, chat.

---

# 09 • Voice & Tone

## Clear, calm, conversational

> **Whumpo talks like a competent helper who knows the technical details so the customer does not have to.**

| Principle | Do | Avoid |
|---|---|---|
| **Plain language** | “Your site needs more processing capacity.” | “Your container CPU quota is saturated.” |
| **Honest progress** | “I’m checking the upload service and recent errors.” | “I fixed it” before verification. |
| **Cost-aware** | “This would add about $18/month. Want me to continue?” | Provisioning paid resources silently. |
| **Confident, not theatrical** | “I can handle that. I’ll check the current setup first.” | “Leave everything to me, boss!” |
| **Useful errors** | “The payment provider rejected the connection. Reconnect it here.” | “Error 403 from OAuth callback.” |

## Acknowledgment model

Short latency-masking responses may say:

> “Got it. I’m checking that now.”

They must not claim diagnosis, completion, or success.

Detailed progress messages should come from real workflow events, not invented narration.

---

# 10 • Messaging

## Core message architecture

### PRIMARY PROMISE

> **Tell Whumpo what you need.**

### VALUE PROPOSITION

> **Your online business, handled.**

### OPERATIONAL PROOF

Whumpo builds, runs, watches, and improves the services behind your online presence.

### COMPLEXITY PROMISE

No servers, cloud dashboards, or deployment knowledge required.

### OWNERSHIP PROMISE

Your domains, code, and data remain yours. Whumpo manages them for you.

### COST PROMISE

Whumpo watches usage and tells you when a different plan would save money or prevent disruption.

## Tagline hierarchy

- **Hero / acquisition:** “Tell Whumpo what you need.”
- **Supporting:** “Your online business, handled.”
- **Product reassurance:** “Whumpo handles the work.”
- **Campaign / brand:** “Big ideas. Less work.”
- **Broader brand statement:** “A brighter internet for everyone.”

---

# 11 • Product Experience

## The interface should feel like one capable agent

### Experience rules

- Chat is the default home, but status, projects, billing, domains, and activity remain directly accessible.
- The user should never need to select cloud providers, VM sizes, databases, or deployment targets in normal mode.
- Approvals should state the outcome, price impact, and risk in plain language.
- Long-running work should expose real workflow progress: checking, building, testing, deploying, verifying.
- Version history should read as **“versions”** and **“restore,”** not Git terminology, unless Developer Mode is enabled.
- Usage should be shown as overall plan capacity and understandable categories, not raw cloud billing primitives.

---

# 12 • Brand in Use

## Example customer moments

### Onboarding

**Customer:**

> “I need a website for my bakery.”

**Whumpo:**

> “Got it. I’ll help you get the site, domain, and online ordering set up. What’s the bakery called?”

---

### Progress

> “Your new site is built. I’m connecting the domain and checking that orders work before I put it live.”

---

### Cost approval

> “Video processing now needs dedicated capacity. It would add about $84/month. Your current overage limit does not cover that, so I need your approval.”

---

### Right-sizing

> “You’ve used less than half of your Business capacity for two billing cycles. Personal should cover your current workload and save you $49/month.”

---

### Incident

> “I found a spike in failed uploads starting at 9:14 AM. I’m checking storage and the processing queue now.”

---

# 13 • Governance

## Keep Whumpo coherent as it grows

### DO

- Use the mascot to make complex moments feel approachable.
- Keep operational language precise and verifiable.
- Favor plain-English outcomes over technical primitives.
- Use bright accents as moments of delight, not as background noise.
- Preserve one-agent continuity even when multiple models/subagents work behind the scenes.

### DON’T

- Turn every infrastructure concept into a cloud pun.
- Use babyish mascot expressions on billing/security/error screens.
- Claim success before the workflow has verified it.
- Expose provider terminology by default.
- Create separate personalities for every subagent.

## Naming conventions

Use **“Whumpo”** as both the platform and the conversational helper unless product research later supports a separate mascot name.

In customer-facing copy, prefer **“Whumpo”** over:

- “the AI”
- “the model”
- provider names

Internal systems, subagents, and infrastructure providers remain invisible unless disclosure is useful or required.

## Status of this document

This is a working identity system based on the current exploratory brand board.

Before public launch, finalize:

- any future approved simplified icon geometry
- production wordmark files
- mascot turnarounds
- animation rules
- final accessibility contrast values

## October 1 mark verification

Source master SHA-256: `ec1a7c90c66eacae1f697af4e259e179bdc9122660ce587149d07fe66b4b814b`. Only resampling/PNG encoding was applied; no artwork was generated, recolored or cropped. The normal 48px image is 5,202 bytes; the 96px retina version is 17,215 bytes.

Type checks, production build and frontend-loading checks passed. A loopback fixture with the built frontend and disposable D1 verified the homepage header/footer, dashboard sidebar and 16/32/180px icon declarations. Desktop (1280px) and mobile (390px outer viewport) checks found no horizontal overflow; the logo loaded in the light homepage and dark workspace. Synthetic profile/project setup remained local, and browsing performed only read requests with no inference, publication or billing effects. Screenshots and fixture evidence remain private under `.secrets/brand-*`. No physical-device or browser-cache-refresh claim is made.
