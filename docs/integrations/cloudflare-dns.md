# Reviewed Cloudflare DNS proofs and routing

## Implemented scope

An authenticated customer with an active Cloudflare OAuth connection can choose an authorized zone in Domains, review an existing owned Whumpo domain claim, and explicitly confirm adding its TXT proof. Chat phrases such as “connect my domain” open the same Domains controls. No model action can confirm DNS changes. Panel actions and guided commands are free of AI usage; natural-language model requests use the normal AI allowance.

This release creates **ownership TXT proofs and reviewed DNS-only routing CNAMEs**. It never patches/deletes existing DNS records, changes nameservers, purchases domains, or marks a domain connected merely because DNS creation succeeded. Exact-record update/removal, apex routing and long-lived proof renewal remain unfinished. Live OAuth consent and DNS mutation acceptance require the separately requested client setup.

## Review and authority

`POST /api/cloudflare/dns/review` accepts a stable UUID, owned claim ID and selected Cloudflare zone ID. The server loads the proof, checks expiry, retrieves the exact zone through the customer's current credential, and requires an active zone that contains the hostname. It reads a bounded complete inventory at the exact `_whumpo.HOSTNAME` name. CNAME/NS conflicts are refused. Other TXT records are preserved. The review pins the credential ID, zone identity, project/claim, record name/value, inventory hash and ten-minute expiry. A database limit allows 100 historical reviews per account.

`POST /api/cloudflare/dns/REVIEW_ID/confirm` rechecks current authorization, zone, inventory, proof and expiry. A changed record set requires a fresh review. A database trigger checks the current owner, exact proof and active credential again when dispatch is claimed. If the proof already exists, the receipt is `unchanged` and no provider write occurs. Otherwise the server POSTs one TXT record with automatic TTL and an action-specific comment. Cloudflare requires quoted TXT character strings; the request quotes the server-generated proof, and matching accepts either that exact quoted representation or the exact plain value. Arbitrary TXT contents are not decoded or normalized into matches.

The inventory check is not a provider-side transaction. An external administrator can change DNS after the check. The only mutation is additive creation; it cannot overwrite those changes. New conflicting records may cause provider rejection or leave duplicate semantically equivalent TXT values. Local uniqueness prevents two Whumpo reviews that saw the same old inventory from both dispatching the same proof. It also reserves a record name while a request is unresolved. Public DNS verification remains a separate exact-resolver check and is the only way to mark the ownership proof verified. Delegated subzones or propagation delays may prevent that public check even when the parent-zone API accepted the record.

## Idempotency and uncertain outcomes

The `sending` state is committed before POST. A repeated confirmation never sends another POST, including after a timeout, malformed response, credential revocation between claim and send, or lost database acknowledgement. A successful exact provider receipt becomes `applied`; its activity receipt commits through a database trigger. A lost acknowledgement after that commit is recovered from the saved action.

A sending/uncertain action can only perform read-only reconciliation. Exactly one TXT matching the reviewed name/value and action comment yields an `observed` receipt. This proves an exact record was observed; it does **not** assert creation provenance or confer deletion authority. An absent, ambiguous or changed record leaves the result unresolved and blocks another attempt at that name. No unknown provider ID is used for mutation. Reconnection can authorize read-only reconciliation, but a fresh mutation review is bound to its original token.

Applied/observed attempts retain uniqueness for the same zone/name/proof. If someone later removes that record, the platform cannot silently recreate the same proof using another review. Operator recovery or a renewed proof is needed. Historical receipts are not continuous DNS status: use Check DNS proof to query current public DNS. Proof rotation after a provider call may leave an older TXT value; it cannot verify the new claim. Automatic record cleanup and customer account/project deletion policies must account for these external records before those deletion flows are enabled.

## UI and configuration

The Domains panel offers authorized zone selection with pages of fifty zones, review, explicit confirmation and read-only outcome checks. “Review TXT in Cloudflare” is disabled without an active customer connection. It displays the exact zone, record and value before confirmation and warns that hosting is unchanged. Provider errors leave the rest of the domain controls available. The backend's `dnsChangesEnabled` status now describes this limited TXT creation capability when configured and connected; it does not promise general DNS editing.

No operator token is used for customer DNS. The existing Wrangler login cannot read this account's DNS records (403), and no attempt was made to expand it. OAuth setup remains in [Cloudflare connection instructions](cloudflare-connection.md). No live DNS records have been changed while implementing this release.

## Verification

`test:cloudflare-dns` uses disposable D1 and controlled provider responses. It covers review without mutation, tenant and zone boundaries, quoted TXT handling, existing-proof no-op, preserving other TXT values, CNAME conflicts, changed inventory, proof rotation at dispatch, competing reviewed writes, lost provider/database acknowledgements, observational reconciliation, unresolved outcomes, revoked credentials and zero AI units. These tests do not establish real-provider acceptance.

Sources checked September 29, 2026:

- https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/create/
- https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/
- https://developers.cloudflare.com/dns/manage-dns-records/reference/dns-record-types/

## Deployment evidence — September 29, 2026

Migration 0023 was applied locally and remotely. The deployed platform version is `44bb64f4-6b87-427e-86a4-d9e9f65a4dc1`; the public-site Worker version is `fb7f12dc-edce-4e4b-8e40-ac5478acfb9a`. TypeScript, the build, disposable DNS tests, and OAuth regression tests passed.

Local browser verification exercised zone selection, exact TXT review, explicit confirmation and a fixture acknowledgement while the domain stayed awaiting DNS and not connected. This was a simulated provider response, not real Cloudflare DNS acceptance.

Live acceptance used an ephemeral signed-passkey account and an owned domain proof. It verified disabled DNS status, anonymous 401, cross-origin 403, configured-access-required 503 on review, foreign confirmation 404, no saved DNS action and zero AI usage. Passkey replay rejection and logout also passed. The ephemeral account and its project/claim were removed. No live DNS mutation occurred; real OAuth and provider-write acceptance remain pending client setup.

## Conversational controls

The same reviewed TXT flow is available in chat without AI usage:

- `/dns`: list owned historical reviews, exact TXT values and next steps.
- `/dns-zones [PAGE]`: list authorized zones, fifty per page, up to page 100.
- `/review-dns CLAIM_ID ZONE_ID`: read the selected zone and prepare the exact owned TXT proof review.
- `/confirm-dns REVIEW_ID`: explicitly authorize that reviewed addition.
- `/check-dns REVIEW_ID`: inspect an unconfirmed review without authorizing it, or reconcile a dispatched result without resending.

The chat turn and revision are claimed in one D1 transaction before any provider operation. Only the request that inserted that turn executes its deferred command. Replays and stale/conflicting turns cannot dispatch it. The provisional transcript says the command was recorded but no result has been saved; it never claims a DNS write succeeded. Lost acknowledgement of the chat claim stops execution. An interruption before provider dispatch can therefore leave a recorded command with no DNS action: inspect `/dns` and submit a new review if needed. An interruption after dispatch is recovered through the existing action's read-only reconciliation. No automatic retry of a command occurs.

Command results update their exact owned chat turn. Known provider/domain errors become sanitized conversational messages. A failed final transcript update does not undo the DNS receipt; `/dns` remains authoritative for saved actions. Other chat turns may proceed while a DNS request is in flight; the DNS state machine, pinned proof and credential, inventory checks and dispatch uniqueness still govern the external operation. The model may discover zones, list reviews and propose TXT reviews through the validated action contract below; it cannot invoke confirmation.

Conversational deployment evidence: platform `d0259f65-0d0e-4b75-b3ed-45f109a1b506`, public-site Worker `4584a6d9-363a-4cb2-b43a-cd8582c43c14`. TypeScript and disposable DNS/chat tests passed, including zone pagination, AI-configured commands with zero AI usage, simultaneous duplicate confirmation, stale revisions, foreign actions and lost chat-claim acknowledgements. Live signed-passkey checks passed for review discovery, disabled provider responses, chat replay/payload conflicts, owned-claim review gates, foreign action checks, Origin/authentication gates, logout and zero AI usage. No live provider operation occurred. Initial fixture cleanup encountered an expired operator token (401); Wrangler refreshed its existing authorization, and an exact synthetic-account match was removed with absence verified. No setup credentials or account permissions were changed.

## Natural-language review actions

The AI action contract accepts `dns/zones` (page 1–100), `dns/reviews`, `dns/review` (owned claim ID and authorized zone ID), and `dns/routingReview` (owned hosting connection ID and authorized zone ID). Zone discovery returns one bounded page and a next-page command; the model can use a returned zone ID on a subsequent turn. Unknown or ambiguous targets require discovery or clarification. The prompt includes only a local configured/connected/expiry snapshot, never customer provider credentials. No provider reads are performed merely to build AI context.

The server rejects extra fields, invalid IDs/pages, arbitrary record content, confirmation, deletion, and result-check operations before invoking DNS controls. It derives the exact proof from the owned claim and substitutes the authoritative server receipt for model prose. A model cannot select record contents, apply routing, mark ownership verified or confirm any review. A user confirms via the existing Domains button or `/confirm-dns REVIEW_ID`.

These natural-language requests use the usual AI allowance; deterministic DNS commands remain free. Provider/configuration errors are recorded as sanitized receipts for the completed model response. Invalid action shapes are rejected using the existing no-charge validation path. Reviews can be saved before the final AI transcript transaction: if the transcript is interrupted, `/dns` still exposes the owned review, and the AI message is never regenerated automatically. No DNS write occurs during this path.

`test:dns-agent` exercises the complete AI pipeline using controlled model and provider responses, including discovery, exact reviews, forbidden actions/fields, tenant isolation, model-claim replacement, replay, disabled configuration, usage settlement and lost transcript acknowledgement. Real provider DNS-write acceptance still requires OAuth configuration.

Natural-language deployment evidence: platform `2bbc3fa8-308a-408d-af52-4bae5273d09f`, public-site Worker `88024373-00cb-434a-94ee-26a0e159036a`. TypeScript, DNS-agent tests, existing domain-agent tests and billing/AI concurrency tests passed. On the live platform, Muse handled “Show my saved Cloudflare DNS reviews” through the authoritative empty-review receipt. Usage settled at 7 units, replay added no charge, no DNS actions were created and Cloudflare remained disabled. Signed-passkey login/replay/logout passed; the ephemeral account was removed. This validates live model discovery of stored reviews, not real Cloudflare authorization or DNS writes.


## Website routing — migration 0027

`POST /api/cloudflare/dns/routing-review` accepts exactly `id`, `connectionId` and `zoneId`. `/review-routing CONNECTION_ID ZONE_ID` and the AI `dns/routingReview` action prepare the same review. `/dns` also lists eligible owned hosting connection IDs. The Domains panel exposes a review button and a separate **Confirm website routing** button.

The server derives the subdomain and fixed destination `hosting.whumpo.site` from an owned, known-provider hosting connection in provisioning/active state. Platform hosting must be configured. The original hosting proof hash must still match the current unexpired claim. No browser/model field can select another destination, record type, proxy status, arbitrary text or provider endpoint.

Review pins the active customer OAuth credential, exact zone, record inventory (including CNAME proxy status), hosting connection, ownership token and ten-minute expiry. Apex names are refused. An empty name can receive one CNAME; a single existing exact DNS-only CNAME is a no-op. Every other exact-name record set is refused, including A, AAAA, NS, TXT, other targets and proxied CNAMEs. Existing TTLs are preserved on a no-op. A new record uses automatic TTL and `proxied:false`. Creation can supersede wildcard DNS for that hostname, which is disclosed in the review.

Confirmation rechecks configuration, connection, current proof, credential, zone and complete inventory. D1 checks ownership, proof token/expiry, credential and connection state again when claiming dispatch. It preserves the existing one-dispatch/uncertain-observation rules. Configuration and hosting disconnect block new dispatches; a previously uncertain action can still be observed read-only using current customer authorization. Neither an acknowledged record nor an observed marker grants deletion authority or a live hosting lease. The user must check hosting status; existing TXT, direct-CNAME, provider and TLS validation determine whether the site can serve.

An external administrator can race the final read: Cloudflare DNS creation has no compare-and-swap inventory precondition. Whumpo only creates, never overwrites; conflicts result in an uncertain receipt requiring inspection. A disconnect after durable dispatch also cannot cancel an already in-flight create. Disconnecting hosting does not remove the CNAME; customers must remove or redirect it at their DNS provider. General DNS replacement/removal remains future work.

`test:cloudflare-routing` uses disposable D1 and controlled providers to verify the fixed target, owner and configuration gates, apex/conflict refusal, unchanged record handling, stale inventory, proof/connection/credential races at dispatch, read-only uncertain recovery, chat replay with no AI usage, and AI review-only authority. Existing TXT and AI-DNS regression suites are also run. These tests do not establish real OAuth consent, DNS mutation acceptance, propagation, or TLS readiness.

Routing deployment evidence: migration 0027 applied remotely; platform `58c05390-8055-4448-be24-e71e789e304b`, public-site Worker `31e1dd27-f7c7-4f9a-ab4c-8c148fe1f971`. TypeScript, build, deployment dry run, routing tests, existing TXT/chat tests and DNS-agent regression tests passed. A local synthetic browser fixture verified review and explicit confirmation receipts while hosting stayed unverified. Live signed-passkey acceptance verified routing configuration 503, extra-target 400, anonymous 401, cross-origin 403, the guided disabled receipt, no saved action, zero AI units, session replay rejection and logout. The ephemeral account was removed. No real customer DNS mutation occurred; real consent, DNS and TLS acceptance remain pending setup.
