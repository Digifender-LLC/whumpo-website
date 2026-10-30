# Play reviewer access: options and recommendation

**Status, October 29, 2026: options only. Nothing here is built, and nothing may be added to the production flavour.**

## The problem

Play's App access policy requires reviewers to reach every part of the app without help. Whumpo is passkey-only and invite-only. A reviewer has no passkey, cannot receive an invite and, on a pre-launch report device, has no Google account with a Whumpo credential. There is no password to hand over. "Contact us for access" is rejected by Play.

## Options

| # | Option | Pros | Cons |
| --- | --- | --- | --- |
| A | **Real test account plus passkey on a reviewer-owned device** | No code. | Passkeys are bound to a device and a Google account; Play cannot import one. Fails. |
| B | **Test account with a recorded video** (Play accepts a video link in App access instructions) | No code. Shows the real production app. | Reviewers still cannot try it. Often rejected as insufficient on its own. Good as a supplement. |
| C | **A review-only sign-in mode in the production build**, for example a hidden code field | Reviewers can sign in. | A backdoor in the shipped authentication path. Rejected: the identity contract forbids secondary authority, and an in-app bypass would be attack surface for every user. |
| D | **A separate `review` product flavour with a synthetic account and no real data** | The production flavour and its server authority stay untouched. Reviewers use a real running app. | Needs code, a server fixture and a second listing track. Details below. |
| E | **Closed track plus an invite and a server-side reviewer account that accepts a passkey created on the reviewer's own device** | Real flow end to end. | Needs the reviewer to create a passkey on a device we do not control; reviewers will not do a signup ceremony. Fragile. |

## Recommendation: D, with B as a supplement

Build option D only when the owner starts the production-track submission. It is not needed for internal testing or the closed test, where testers are known people who sign in with real passkeys.

### Shape of D

- **Flavour, not flag.** A third product flavour `review` in the `environment` dimension (next to `local` and `deployed`) with the same `applicationId` as production, because Play ties a track to one package. It is uploaded only to a closed track that the reviewer is pointed at (Play takes App access instructions per release) and is never promoted to production. Its version codes come from the same scheme, so it never collides with a production code.
- **Synthetic data, server side.** `review` points `WHUMPO_ORIGIN` at an isolated environment (a separate Worker and database, or a seeded sandbox account on the test platform) holding one synthetic owner with the same example projects used in the [listing screenshots](screenshots/README.md). The server holds no real customer data, no provider keys and no ability to publish. Chat replies in this environment come from a canned or heavily rate-limited model.
- **Entry.** The welcome screen shows a clearly labelled **"Review mode (demo account)"** button only in the `review` flavour. It calls a single server route, `session/review/start`, that exists only on the review deployment and returns a normal session for the synthetic account. The route is absent from production (not disabled by a flag: not deployed).
- **Banner.** Every screen shows "Demo account: no real data" in the review flavour so no one mistakes it for production.
- **Not a backdoor.** The review build cannot authenticate against `https://whumpo.com`. Its origin is compiled in; the production server never learns of the route; the production APK has no code path for it (separate source set `src/review`). Reviewing the diff is how this stays true: CI should assert that `src/main` and `src/deployed` contain no reference to `review/start`.
- **Evidence for Play.** App access instructions: "Install from the closed track. On the welcome screen tap 'Review mode (demo account)'. No password or code is needed. Everything in the app works on synthetic data."

### Work and ownership

| Item | Who |
| --- | --- |
| `review` source set and flavour in `:androidApp` | Android work package (small; client only) |
| `session/review/start` route and synthetic seed on an isolated deployment | Backend work package. Needs an owner decision on the infrastructure (second Worker and D1) |
| Decision to spend on a second environment | Owner |
| App access instructions text in Play Console | Owner (copy above) |

Until D exists, the closed and internal tracks are enough for the beta, and the production submission waits on it.
