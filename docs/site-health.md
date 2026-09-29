# Published website health

Publishing and restoring a version now attempt an HTTP check after the durable publication succeeds. A failed check does not undo publication. The receipt distinguishes saved publication from verified availability. No automatic rollback or repair is performed.

## Customer controls

- `/health [PROJECT_ID]` reads owned saved results without network requests.
- `/check-site PROJECT_ID` checks a currently published owned project.
- The workspace Details menu includes Website health.
- Natural language can list or check health through a strict server action. Model claims are replaced with the saved server receipt; the model cannot supply a URL or request a rollback.
- Guided commands consume no AI units. Natural-language interpretation retains normal AI usage accounting.

## What passes

A check reads only the fixed shared address `https://PROJECT_ID.whumpo.site/`. Redirects are refused, requests carry no customer cookies or secrets, and each request has a ten-second timeout. The HTML response must succeed, be HTML, fit 48 KiB, and match the exact saved version plus the current platform contact link. The saved artifact digest is checked too.

Up to four referenced photos receive HEAD requests against the same fixed address. They must return HTTP 200, JPEG content type and their recorded byte length. This confirms response availability and metadata, not image decoding or an independent full-body digest. The public host separately enforces object metadata and size.

These results do not test custom-domain routing, visitor form submission, browser layout, accessibility or worldwide availability. They describe a particular point in time, not an uptime guarantee.

## Consistency and limits

Migration 0029 records the owner, version, publication revision, contact revision, source, state and timestamps. A publication or contact change invalidates the previous result. Changes during verification mark that check superseded. Interrupted checks and healthy results older than six hours are labeled accordingly. Tenant ownership is enforced on every customer endpoint.

A database trigger claims the check before network dispatch, limits a given publication/contact state to one check per five minutes, and caps all checks at 500 per UTC day. Repeated requests return the saved result. The global counter survives account/project removal. Each check uses at most five HTTP requests, including four photo reads; photo reads also consume the existing application R2 budget. Existing account allowances remain shared.

The hourly maintenance trigger considers at most 20 due sites, in batches of four, skipping current results started within six hours. This bounded schedule may take longer to cover a large installation. Check history is retained for 30 days; daily counters for 62 days. Activity events contain only a sanitized outcome. No response body or provider error is copied into diagnostics.

## Verification

Disposable D1/R2 tests cover fixed-origin and ownership boundaries, cooldown concurrency, failed HTTP/content/redirect/size checks, publication and contact races, missing photos, publish receipts, replay, guided usage, model action restrictions, scheduling and daily caps. Production acceptance is recorded in deployment.md. A real scheduled production run and successful custom-domain probes are not implied by controlled tests.
