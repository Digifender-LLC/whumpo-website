# WH-004 slice 5: route-specific Origin tests (October 20, 2026)

This slice adds tests only. It changes no `src/`, schema, Worker configuration, verify profile or roadmap file.

## Source of the gaps

`docs/boundary-audit.md` lists route-specific cross-origin tests as an open evidence gap. See "Evidence gaps" (guest previews, contact messages, contact notifications, shared modules), "Still open after slice 3", and "Still open (slice 2)" (`modules/upload`). The task also named `docs/boundary-audit-origin-review-2026-10-20.md`. That file is not in this tree, so this slice uses the `boundary-audit.md` entries.

## The new test

`tests/boundary-origin-routes.mjs` is standalone. It is not in a verify profile or `package.json`. It runs with `node tests/boundary-origin-routes.mjs` on SQLite, or with `--d1` on local D1. It follows `tests/boundary-owner-authority.mjs`: same fixtures, real Worker entry points, synthetic accounts, no network.

Each route gets a state-changing request from a wrong origin. The test checks the exact answer from the source: 403 `Origin check failed`. It also checks that row counts did not change. The wrong origins are a foreign site, the opaque `null` origin, plain `http`, a Whumpo sibling host and a missing Origin header. The visitor gateway also gets `Sec-Fetch-Site: cross-site` sent with the correct origin.

Each route also has a negative control. The legitimate holder sends the same request from the correct origin, and the Origin check does not refuse it.

## Routes now covered

| Route | Gate under test | Negative control shows |
| --- | --- | --- |
| `POST /api/projects/:id/guest-previews/prepare` | global gate in `handle()` | 200 with a confirmation |
| `POST /api/projects/:id/guest-previews` (confirm) | global gate | 200, one link issued |
| `POST /api/guest-previews/:id/revoke` | global gate | link revoked |
| `DELETE /api/guest-previews/:id` | global gate | link deleted |
| `PATCH /api/guest-previews/:id/feedback/:comment` | global gate | comment resolved |
| `DELETE /api/guest-previews/:id/feedback/:comment` | global gate | comment deleted |
| guest `POST /api/feedback` (sites Worker, preview host) | guest host's own exact-Origin check | 200, comment stored |
| `DELETE /api/contact-messages/:id` | global gate | message deleted |
| `PUT /api/projects/:id/contact-notifications` | global gate | address saved unverified |
| `POST .../contact-notifications/verification` | global gate | 200 `provider_not_configured` |
| `POST .../contact-notifications/confirm` | global gate | wrong code counted (400) |
| `DELETE /api/projects/:id/contact-notifications` | global gate | address removed |
| `POST /api/projects/:id/modules` | global gate | module handler answers `not_found` |
| `POST /api/projects/:id/module-files/remove` | global gate | collection handler answers `not_found` |
| visitor `POST modules/upload` (visitor gateway) | gateway Origin/Sec-Fetch-Site check | module upload handler answers |

## Not covered, and why

- No route was skipped.
- The two owner module routes and visitor `modules/upload` do not show a real write in their negative control. No existing fixture activates a records or files instance with an owner collection cheaply. These controls name an unknown resource. They prove the request passed the Origin check and reached the module handler. They do not prove a write from the correct origin.
- The test does not mutate the gates. No temporary source change was made to show that each check fails without its guard.
- The test is not in a verify profile. Adding it is the owner's decision, as for slices 2 and 3.

## Findings

None. Every listed route refuses a wrong origin with 403 before any state change. No expected-failure case was needed.

## Status

WH-004 stays open. Other evidence gaps in `docs/boundary-audit.md` remain. The controller runs the verification commands. This doc does not claim a result for them.
