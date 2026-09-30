# Security risk decisions and follow-up actions

**Working assessment: September 29, 2026.** This is a decision register for the supplied threat model, not a list of confirmed vulnerabilities or a declaration of live acceptance. Reassess before expanding beyond invitation-only testing and after each new public capability. The current readiness record is [acceptance.md](acceptance.md).

Use these labels consistently: **Fix** for a demonstrated boundary failure or a prerequisite to the stated use; **Reduce and monitor** for residual risk with bounded controls; **Accept for test** for intentional behavior within the private test assumptions; **Activation gate** for a capability not yet available to customers. A test-stage acceptance does not extend automatically to real customer data or open enrollment.

## Decisions needed from the owner

1. Who currently uses the test deployment: owner/synthetic accounts, invited testers with real content, or external customers? Record whether any real visitor application or public backend endpoint has been published.
2. What deletion promise applies: active data deletion, or full erasure including recoverable backups? Do not claim the latter until restore reconciliation and provider retention are addressed.
3. Will testers submit confidential material to the current AI provider? If so, decide on a provider/data-use policy and notice before asking them to do so.
4. Define the escalation path and budget for distributed abuse or unexpected Cloudflare/AI usage. Per-IP and per-project limits are not an account-wide spending cap.

## Fix or verify before wider use

| Area | Action and completion evidence | Status |
| --- | --- | --- |
| Owner recovery after lost passkeys | The [owner-recovery flow](owner-recovery.md) now verifies the recovery code, shows registered passkeys, requires an explicit **all / some / none** choice, and revokes selected passkeys with code rotation and session revocation. The replacement code is displayed before the irreversible step so a lost response does not strand an owner who disabled every passkey. Complete a native-browser/mobile journey and live test-stage acceptance before claiming deployment. Clarify separately whether a suspected-compromise flow must also reset a password and review connected provider access. | **Implemented locally; not deployed or live-accepted.** |
| Tenant and review authorization | Perform one consolidated audit of owner/project/visitor predicates and privileged state transitions, including publication, DNS, hosting, CMS, application activation, backup, deletion and billing. Add focused regression coverage for any gap found. A demonstrated IDOR, stale-review confirmation or model-to-confirm bypass is a **Fix immediately** finding. | **Open verification gate.** See [acceptance.md](acceptance.md). |
| Visitor deletion and recovery | Reconcile deletion when restoring D1 or application backups; implement retained-data deletion for revoked/disabled visitors and owner/project lifecycle. Preserve a durable deletion record through restore. A read-only [platform account closure inventory](account-closure.md) now identifies control-database dependencies; closure and external cleanup remain unimplemented. Verify the exact customer-facing retention promise against D1 Time Travel and other provider backups. | **Open lifecycle work.** See [app-data.md](app-data.md) and [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/). |
| Real-device authentication | Exercise owner and visitor passkey enrollment, login, lost-device recovery, replacement and revocation on actual desktop/mobile devices. Include response-loss and concurrent sign-in around revocation. Synthetic WebAuthn fixtures do not establish this user journey. | **Open acceptance gate.** See [acceptance.md](acceptance.md). |
| Public resource exhaustion | Before broader enrollment, define account-level spend alerts and an operator abuse response, then load-test the bounded public contact, backend, D1 and R2 paths. Keep per-tenant quotas and review whether distributed clients can starve other tenants. | **Open scale gate.** Existing [contact-form caps](contact-forms.md) and [application quotas](app-data.md) reduce test exposure. |

## Reduce and monitor

| Area | Recommended action | Escalate to a fix when |
| --- | --- | --- |
| Authentication abuse | Review distributed guessing, recovery-code attempts, challenge exhaustion and account enumeration; monitor coarse failure rates without logging credentials. Keep rate limits and high-entropy secrets. | Attempts succeed, exhaust legitimate users, or reveal useful account state. |
| Session and CSRF protection | Preserve exact Origin checks on owner mutations, short fresh-session requirements for credential changes, and scoped HttpOnly cookies. Add a focused regression whenever a new mutation route is mounted. | A cross-origin request or stale session can change owner/visitor state. |
| Prompt injection and AI cost | Keep model output within strict server-side schemas and prepare-only authority. Monitor unusual drafts and spending; keep approval gates and atomic usage receipts. Do not send credentials or unnecessary private content to the model. | Model text can publish, mutate providers, grant credits, cross tenants, or spend outside a reservation. |
| AI-provider privacy | Keep training/data-use notice visible, profile sharing opt-in, and prompt/response logging off by default. Revisit provider choice and consent before confidential customer workloads. | Stated notice or consent no longer matches actual provider handling. |
| QuickJS isolation | Keep runtime secrets/storage absent, pinned engine provenance, CPU/heap/stack/output limits, separate Worker binding and adversarial regression tests. Review changes that add a host callback or capability. | Guest code reaches host capabilities or another tenant, or bypasses resource limits materially. Treat a demonstrated escape as urgent. See [backend-execution.md](backend-execution.md). |
| Site/CMS content and files | Continue escaping, restrictive CSP, immutable publication reviews, image validation and membership checks. Recheck rich-text URLs, media and imports as supported formats expand. | Script executes in the platform origin, another tenant's content is served, or a published tenant page gains unintended authority. |
| Contact spam | Keep Turnstile, body limits, per-project/hour and platform caps; monitor capacity and false positives. Give operators a way to suspend abusive intake without losing legitimate messages. | Distributed spam fills inboxes or blocks legitimate submissions. See [contact-forms.md](contact-forms.md). |
| Provider and domain operations | Preserve exact outbound hosts, redirect refusal, encrypted scoped tokens, immutable reviews and uncertain-outcome recovery. Require real customer consent/resource acceptance before activation. | A tenant can choose an outbound authority, use another tenant's token, or mutate DNS/repositories without a current review. |

## Accept for the bounded private test, with stated assumptions

| Area | Decision and trigger to revisit |
| --- | --- |
| Stateless public backends | Unauthenticated cross-origin JSON is intentional for reviewed stateless endpoints. Reassess if an endpoint reads private visitor/owner state or gains durable write authority. |
| Local development mode | Invitation and transport differences are acceptable only on a private localhost server. Publicly exposed local-mode Workers require immediate correction. Deployed config uses `ENVIRONMENT=test`. |
| Minor enumeration and low-value metadata | Accept only where responses reveal no useful credential, tenant data or operational secret. Reclassify on concrete exploit evidence. |
| Test-mode Stripe bookkeeping | Real-money subscription/refund issues are not live while checkout and required bindings are disabled. Prevent test-credit abuse; complete financial lifecycle review before enabling payments. See [payments.md](payments.md). |

## Activation gates

Customer GitHub OAuth, Cloudflare OAuth/DNS, custom-domain hosting and native CMS provisioning remain configuration or acceptance dependent. Before enabling each one, verify scoped customer consent, exact provider resource ownership, token isolation, review/replay behavior, cost/entitlement, rollback and a real end-to-end customer journey. The latest [readiness assessment](acceptance.md) records missing customer integration bindings and zero registered native CMS instances; source implementation alone is not a live security acceptance.
