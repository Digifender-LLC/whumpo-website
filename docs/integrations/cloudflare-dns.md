# Reviewed Cloudflare DNS proofs

## Implemented scope

An authenticated customer with an active Cloudflare OAuth connection can choose an authorized zone in Domains, review an existing owned TellUmo domain claim, and explicitly confirm adding its TXT proof. Chat phrases such as “connect my domain” open the same Domains controls. No model action can confirm DNS changes. The flow is free of AI usage.

This release creates **ownership TXT proofs only**. It never patches/deletes DNS records, changes nameservers, alters website-routing records, purchases domains, or marks a domain connected. CNAME routing, exact-record update/removal, long-lived proof renewal, and conversational model-proposed DNS reviews remain unfinished. Live OAuth consent and DNS mutation acceptance require the separately requested client setup.

## Review and authority

`POST /api/cloudflare/dns/review` accepts a stable UUID, owned claim ID and selected Cloudflare zone ID. The server loads the proof, checks expiry, retrieves the exact zone through the customer's current credential, and requires an active zone that contains the hostname. It reads a bounded complete inventory at the exact `_tellumo.HOSTNAME` name. CNAME/NS conflicts are refused. Other TXT records are preserved. The review pins the credential ID, zone identity, project/claim, record name/value, inventory hash and ten-minute expiry. A database limit allows 100 historical reviews per account.

`POST /api/cloudflare/dns/REVIEW_ID/confirm` rechecks current authorization, zone, inventory, proof and expiry. A changed record set requires a fresh review. A database trigger checks the current owner, exact proof and active credential again when dispatch is claimed. If the proof already exists, the receipt is `unchanged` and no provider write occurs. Otherwise the server POSTs one TXT record with automatic TTL and an action-specific comment. Cloudflare requires quoted TXT character strings; the request quotes the server-generated proof, and matching accepts either that exact quoted representation or the exact plain value. Arbitrary TXT contents are not decoded or normalized into matches.

The inventory check is not a provider-side transaction. An external administrator can change DNS after the check. The only mutation is additive creation; it cannot overwrite those changes. New conflicting records may cause provider rejection or leave duplicate semantically equivalent TXT values. Local uniqueness prevents two TellUmo reviews that saw the same old inventory from both dispatching the same proof. It also reserves a record name while a request is unresolved. Public DNS verification remains a separate exact-resolver check and is the only way to mark the ownership proof verified. Delegated subzones or propagation delays may prevent that public check even when the parent-zone API accepted the record.

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

Command results update their exact owned chat turn. Known provider/domain errors become sanitized conversational messages. A failed final transcript update does not undo the DNS receipt; `/dns` remains authoritative for saved actions. Other chat turns may proceed while a DNS request is in flight; the DNS state machine, pinned proof and credential, inventory checks and dispatch uniqueness still govern the external operation. Conversational model-proposed reviews remain a separate unfinished feature; the model may explain these commands but cannot invoke confirmation.

Conversational deployment evidence: platform `d0259f65-0d0e-4b75-b3ed-45f109a1b506`, public-site Worker `4584a6d9-363a-4cb2-b43a-cd8582c43c14`. TypeScript and disposable DNS/chat tests passed, including zone pagination, AI-configured commands with zero AI usage, simultaneous duplicate confirmation, stale revisions, foreign actions and lost chat-claim acknowledgements. Live signed-passkey checks passed for review discovery, disabled provider responses, chat replay/payload conflicts, owned-claim review gates, foreign action checks, Origin/authentication gates, logout and zero AI usage. No live provider operation occurred. Initial fixture cleanup encountered an expired operator token (401); Wrangler refreshed its existing authorization, and an exact synthetic-account match was removed with absence verified. No setup credentials or account permissions were changed.
