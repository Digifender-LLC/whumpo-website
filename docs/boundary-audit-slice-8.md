# WH-004 boundary audit, slice 8: contact form admission branches

Slice 8 adds one test, `tests/boundary-contact-admission.mjs`. It changes no existing file. `docs/boundary-audit.json` is not updated here, so a later slice can cite the new test lines in the entry's `tests` list.

## Entry

`docs/boundary-audit.json`, public contact form, `admission` cell (state `evidenced`). The detail ends: "The per-IP 429 and missing-token branches are untested." This is an anonymous, internet-facing write surface: any visitor can post to a published, enabled form. These two branches stop a single source from flooding the endpoint, and stop a submission that has no bot verification.

Skipped, because earlier slices already cover them: the origin routes (`tests/boundary-origin-routes.mjs`), the custom-domain owner join (PR #308) and operator safety-case freshness (PR #307).

## Code

`src/contact-page.ts`, `contactPage()`:

- Line 25: `if(!(await env.API_LIMITER.limit({key:'contact:'+ip})).success)throw new ContactError(429,'Too many requests. Please try again later.');`. `ip` is `cf-connecting-ip`, or `'local'` when that header is missing (line 24). This runs after the Origin check (line 23) and before everything else.
- Line 37 (only outside `ENVIRONMENT=local`): `if(!token||token.length>2048)throw new ContactError(400,'Complete verification before sending.');`. This runs after the per-client daily allowance is reserved (line 35) and before `verifyTurnstile` (line 38).

## What the test asserts

Fixture: a synthetic account with a published site and an enabled contact form, set up as seeded rows like `tests/boundary-origin-routes.mjs`. It uses a recording `API_LIMITER` stub and a Siteverify stub that counts its calls. There is no network access.

1. **Per-IP 429.** With the limiter refusing:
   - GET, HEAD and POST each return 429 with `cache-control: no-store` and `x-frame-options: DENY`. GET and POST also show the message.
   - The limiter key is `contact:198.51.100.40`, or `contact:local` when `cf-connecting-ip` is missing.
   - Siteverify is never called.
   - No message is stored, and `public_client_usage` is unchanged, so the refusal comes before the daily allowance is counted.
   - A cross-origin POST returns 403 and never reaches the limiter.
   - Negative control: the same POST with the limiter admitting returns 200, is verified once, and is stored.
2. **Missing token.** A POST with no `cf-turnstile-response` field, with an empty one, or with one of 2,049 characters:
   - Each returns 400 "Complete verification before sending."
   - Siteverify is never called and nothing is stored.
   - Each attempt still adds one to the daily client allowance. This is intended: the entry says "counted before verification", and the test records it.
   - Negative control: a 2,048-character token reaches Siteverify unchanged, and the message is stored.

The test has no expected-failure case, because both branches work as the source describes.

## Running

```
node tests/boundary-contact-admission.mjs        # local SQLite
node tests/boundary-contact-admission.mjs --d1   # local D1
```

The SQLite run passed when this slice was written (base `52e885bf1eb5c6ff2b001d1c28c483f25ac1f95c`). The `--d1` run has not been done.
