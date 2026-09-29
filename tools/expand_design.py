from pathlib import Path
from docx import Document
from docx.shared import Inches, Pt
from docx.enum.text import WD_BREAK
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.shared import RGBColor
from docx.oxml.ns import qn

SOURCE = Path(__file__).resolve().parents[1] / 'docs' / 'reference' / 'ai_managed_cloud_mvp_design.docx'
OUTPUT = Path(__file__).resolve().parents[1] / 'docs' / 'ai_managed_cloud_mvp_design_revised.docx'

doc = Document(SOURCE)
doc.paragraphs[0].style = doc.styles['Title']
doc.paragraphs[0].text = 'AI Managed Cloud Platform MVP Design'
for run in doc.paragraphs[0].runs:
    run.font.color.rgb = RGBColor(0, 0, 0)
for element in (doc.styles['Title']._element, doc.paragraphs[0]._p):
    ppr = element.find(qn('w:pPr'))
    if ppr is not None:
        border = ppr.find(qn('w:pBdr'))
        if border is not None:
            ppr.remove(border)
doc.paragraphs[1].text = 'Product and technical design'
doc.paragraphs[3].text = 'Version 0.4  |  September 29, 2026'

first_section = next(p for p in doc.paragraphs if p.text.startswith('1. Executive Summary'))
intro = first_section.insert_paragraph_before()
intro.add_run('Current implementation. ').bold = True
intro.add_run('Whumpo now runs an invitation-only test at digifender.com. Passkeys, conversational onboarding, metered Muse planning and edits, reusable static pages, private photos, confirmed publication, restore and source export are deployed. Domain ownership, reviewed customer DNS, optional provider-connection code, month-specific plan receipts and reviewed photo/version removal have since been added. Customer provider setup and real DNS/backup acceptance remain pending. The full MVP remains incomplete. Sections 1 through 25 retain the original product vision; sections 26 through 32 supersede their implementation and infrastructure assumptions and define the current implementation, verification limits and remaining delivery contracts. No Stripe account is configured, and payments remain disabled.')

def paragraph(text):
    doc.add_paragraph(text)

def heading(text):
    doc.add_heading(text, 1)

def sub(text):
    doc.add_heading(text, 2)

def table(headers, rows):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = 'Table Grid'
    t.autofit = False
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for cell, label in zip(t.rows[0].cells, headers):
        cell.text = label
        for run in cell.paragraphs[0].runs: run.bold = True
    for row in rows:
        cells = t.add_row().cells
        for cell, value in zip(cells, row): cell.text = value
    from docx.oxml import OxmlElement
    repeat = OxmlElement('w:tblHeader')
    t.rows[0]._tr.get_or_add_trPr().append(repeat)
    for row in t.rows:
        no_split = OxmlElement('w:cantSplit')
        row._tr.get_or_add_trPr().append(no_split)
    if len(headers) == 2:
        for row in t.rows:
            row.cells[0].width = Inches(1.9)
            row.cells[1].width = Inches(5.1)
    return t

heading('26 Deployed Test Platform and Scope')
paragraph('The homepage advertises the product. The signed-in workspace opens into a persistent conversation with compact project, live-site and usage statistics. A Details menu exposes files, versions, domains, connected accounts, security and billing. Chat supports guided commands and validated natural-language proposals. Provider consent and passkey device interaction occur outside the conversation; domain and backup reviews remain explicit customer decisions.')
paragraph('The infrastructure constraint is GitHub free features and Cloudflare services within existing included allowances. The owner authorized the current Workers Standard account allowance; this is not a separate Workers Free account. No upgrades or paid-only services are authorized. The application is invitation-only, and digifender.com is temporary. Whumpo is a placeholder name.')
table(['Boundary', 'Deployed implementation'], [
 ('Workspace', 'whumpo-platform Worker, Static Assets and Turnstile at digifender.com'),
 ('State', 'One D1 database for identity, chat, projects, usage, versions and publication reviews'),
 ('Files', 'Private Standard R2 bucket whumpo-files; public bucket access disabled'),
 ('Published sites', 'whumpo-sites Worker at sites.digifender.com; current version and exact photo references only'),
 ('AI provider', 'OpenAI-compatible Responses transport to OpenCode Go Muse Spark 1.3 Contributor'),
 ('Source control', 'Private GitHub repository Digifender-LLC/whumpo-website; deployment from the local CLI'),
])
paragraph('Durable Objects, Workflows, Queues, Containers, Sandbox, Workers AI, AI Gateway, Artifacts and Registrar described earlier are architectural options, not deployed dependencies. The current assembler accepts reviewed components and bounded configuration; it does not execute arbitrary customer-generated code. General dynamic apps and isolated build execution remain open requirements under the cost constraint.')
paragraph('Source of truth: wrangler.jsonc, wrangler.sites.jsonc, migrations, src and the deployment log. The public Worker has D1 and R2 bindings, but no identity or AI secrets. These bindings are not read-only credentials; route code enforces the public read boundary. No customer receives platform provider credentials.')

heading('27 Identity Conversation and Action Authority')
sub('Identity and tenant ownership')
paragraph('Passkeys are the default registration and login method. SimpleWebAuthn validates the relying party, origin, challenge, signature, user verification and authenticator counter. Challenges are hashed, browser-cookie bound, single-use and five minutes long. Invitations and Turnstile gate signup. Optional passwords, rotating recovery codes, session revocation and recent authentication for security changes are available.')
paragraph('Every project resource is joined to the authenticated owner before it is returned or changed. Cross-owner resources return 404. Browser mutations check Origin; session cookies are Secure, HttpOnly and SameSite. Provider credentials are Worker secrets. opencode.key and local test credentials are ignored by Git and must never enter prompts, exports or logs.')
paragraph('Production passkeys are bound to digifender.com. A final-domain migration needs authenticated enrollment on the new relying-party domain while the old account origin remains available. Signed assertion fixtures pass live verification, but synced-device passkey prompts still require a user-device acceptance check.')
sub('Conversation consistency')
paragraph('Guided onboarding collects idea, project name, audience or visitor goal, and style preferences without inference, resumes after interruption, and creates the first private draft. Audience and style can be skipped. Private planning notes are not automatically exported or copied into page text. Each message carries a UUID and expected revision. Atomic D1 claims prevent competing turns and duplicate work. Pending model calls serialize the conversation. The test retains up to 2,000 turns and displays the latest 100.')
sub('The model proposes and the server decides')
paragraph('The model returns a validated JSON proposal in text rather than native SDK function calls. The server validates allowlisted arguments, ownership and quotas. Actions can create projects and private drafts, make focused edits, inspect owned workspace records, export source, prepare/check domain proofs, discover authorized DNS zones, and prepare publication, TXT-proof or version-removal reviews. The model cannot confirm these reviews, grant entitlements, supply arbitrary DNS contents or execute customer backend code.')
paragraph('Publishing, restoring and unpublishing require a separate confirmation tied to an exact version or action, owner, project, expected publication revision and ten-minute expiry. D1 guards apply the pointer, activity event and chat receipt atomically. Draft work never changes the public pointer. Future purchases and destructive operations need equally exact impact and price approvals; ordinary language from a model is not authority.')

heading('28 AI Usage Credits and Payment Boundaries')
paragraph('The server adapter supports OpenAI Chat Completions and Responses text protocols. Operator configuration fixes the HTTPS endpoint, model, key and protocol. Prompts cannot change the destination. Requests use manual redirects, a 60-second timeout, bounded input/output and sanitized errors. Redirect responses are rejected. Automatic provider retries and fallback models are disabled.')
paragraph('The live test uses https://opencode.ai/zen/go/v1 and muse-spark-1.3-contributor through Responses, under the existing OpenCode Go subscription. Contributor data-use disclosure is shown to testers. Photo names and dimensions can be supplied to the planner; photo pixels are not sent, and the model must not invent visual descriptions. The provider boundary adapts reviewed Jarvis response validation and diagnostics; docs/jarvis-reuse.md records provenance and differences.')
table(['Plan', 'Monthly USD', 'Live sites', 'Monthly units'], [
 ('Explore', '0', '1', '25'), ('Launch', '12 proposed', '3', '250'), ('Studio', '29 proposed', '10', '800'),
])
paragraph('One build unit is the ceiling of (input tokens + four times output tokens) divided by 1,000. Provider reasoning tokens count as output usage. Reserve the bounded maximum before inference, save the answer and token receipt before settlement, then charge actual units and release the remainder. Monthly allowance is consumed before credits; credit overage requires explicit opt-in. Credits cannot bypass site, file, storage or abuse limits.')
paragraph('AI reservation and chat-turn claim commit atomically before dispatch. Saved token receipts reconcile after a lost acknowledgement without another inference. Confirmed failures release reservations; uncertain provider outcomes retain a hold for operator review. Undispatched reservations expire after five minutes. There is no automated provider-receipt reconciliation yet. Guided commands, static builds, uploads, photo attachment, publication, source export and guided DNS controls use no AI units; natural-language interpretation uses the normal allowance.')
paragraph('The proposed top-up is USD 5 for 100 credits. Monthly units use UTC calendar months; credits persist separately. An internal plan-fulfillment boundary now requires immutable month-specific payment references. Upgrades raise the allowance ceiling without resetting spending or holds. New paid months need new receipts; otherwise the account uses Explore. Existing live sites remain available after a lower allowance, but new publication is blocked over the current tier limit. This internal function is not a public or model-grant endpoint.')

paragraph('Stripe test credit checkout has server-fixed orders, signed timestamped webhooks, authoritative session retrieval and idempotent grants. It remains unconfigured because the owner has no Stripe account. Subscriptions, refunds, disputes, proration, real checkout acceptance and real charges are unfinished. Domain registration is a separate future charge and cannot silently consume build credits.')

heading('29 Immutable Websites Photos and Exports')
paragraph('The generic catalog currently contains launch-page@1, site-page@1 and photo-page@1. Configuration is validated plain text, allowlisted themes, up to six text sections and at most four same-project ready photo references. The assembler escapes text and records exact HTML, configuration, component ID, digest, source and optional base version. D1 limits a project to 25 retained versions, 32 KiB HTML and 8 KiB configuration per version.')
paragraph('Focused AI edits specify an owned base and changed fields. Omitted fields are preserved; a new immutable version records ancestry. /build assembles a project brief without inference. Use in website or /photo FILE_ID attaches an owned photo to the latest version of its project, also without inference. All version dependencies commit with the chat receipt. Same-owner cross-project photos are rejected.')
sub('Private preview and public serving')
paragraph('Private previews require the current owner session and use no-store caching and a CSP sandbox that denies scripts and forms. Photo previews read and verify exact dependencies, then embed bounded JPEG data URLs into the response. Stored HTML retains relative asset paths. This avoids public bearer links and opaque-origin cookie dependencies.')
paragraph('Confirmed publication points to an exact retained version at sites.digifender.com/s/PROJECT_ID. Photo pages canonicalize a trailing slash. The public Worker checks the current publication relation before serving /s/PROJECT_ID/assets/FILE_ID.jpg. Unattached uploads and photos referenced only by other versions are inaccessible. Restore switches HTML and references together; unpublish revokes both on the next request. Publication reviews explicitly disclose photo exposure.')
sub('Uploads and retention')
paragraph('The browser accepts JPEG, PNG and WebP up to 10 MiB, decodes orientation, resizes to 1600 by 1600 and encodes a JPEG up to 1 MiB. The server validates the bounded baseline-JPEG envelope and strips APP/COM metadata; it is not a complete pixel decoder. D1 reserves immutable file identity before create-only R2 writes. Retries verify checksum and size; conflicting reuse is rejected. Pending reservations count toward limits and require operator recovery if the prepared upload bytes were lost.')
paragraph('Limits are 20 photos per project, 50 per account and 500 platform-wide, with queued physical deletions counted toward capacity. Each photo is at most 1 MiB. Atomic monthly counters cap application R2 reads at 100,000 and writes at 10,000; daily cleanup runs outside those counters. The included allowance is shared with other applications, so these controls are not an account-wide billing cap.')
paragraph('Source export returns exact HTML/CSS, referenced JPEGs, security headers, README and configuration/checksum metadata in a bounded ZIP. Missing or mismatched assets fail the export. Accounts, chats, keys, billing and database contents are excluded. Reviewed removal of an unused photo immediately removes access and queues R2 cleanup. Any retained version reference blocks removal, including a reference added after review. Applied-review tombstones prevent delayed uploads from recreating removed files.')

paragraph('Saved versions can be removed only after an exact ten-minute review and separate user confirmation. The transaction checks the owner, digest and expiry, deletes the version, invalidates its preview/export/restore links and records an audit event. Live versions, active publication reviews and all GitHub backup records retain their versions. Original photos and independent newer artifacts remain; photo references are released. Tombstones prevent old version IDs from being recreated. Removing backed-up versions, automatic pruning and whole-project/account deletion remain unfinished.')

heading('30 Shared Components and Backend Reuse')
paragraph('The first iteration of a customer site should reuse reviewed generic code whenever possible. Customer prompts, generated sites, uploads, business content, credentials and records must remain private. The shared catalog contains platform-authored source, appropriately licensed upstream code and synthetic fixtures. Customer customization is not a catalog contribution.')
paragraph('Each package version needs a stable ID, digest, provenance, license, configuration schema, runtime compatibility, dependencies, migrations and declared capabilities. Only catalog maintainers publish versions. Agents select exact approved IDs and validated parameters; download URLs, shell commands and executable configuration are not accepted. Immutable versions keep existing customer sites reproducible when the library changes.')
sub('Authentication and forms as the next backend components')
paragraph('A reusable sign-in component must separate constrained presentation from reviewed credential verification, sessions, recovery and access checks. Styling requests cannot alter authentication policy. Each instance resolves tenant identity from verified server context, not model-supplied owner IDs. Sharing implementation must never share accounts, sessions, secrets or customer database rows. Platform account authentication is implemented; authentication for customer-generated applications is not yet packaged.')
paragraph('The first proposed dynamic component is a contact-request form with a fixed server endpoint and project-scoped schema. It should validate bounded fields, apply bot and rate controls, enforce retention and per-project submission limits, and show submissions only to the owner. Publication must explicitly enable the endpoint. Start with an inbox in the workspace; outbound email should require a separately configured provider and abuse controls. This component remains a design contract, not a deployed feature.')
sub('Promotion review and caches')
paragraph('A customer adaptation stays private by default. Explicit consent permits nomination only. A separate synthetic candidate must remove customer configuration and identifiers, then pass human source review, secret scanning, dependency/license review and security/behavior checks. Pattern matching or a model assertion cannot prove that customer data is absent. Opaque assets and copied real-data fixtures are excluded.')
paragraph('Catalog retrieval searches only shared metadata and synthetic examples. Cache package bytes by immutable digest. Never cache customer prompts, filled configurations or completed sites globally. Private caches include owner and project boundaries and deletion semantics. Withdrawn components block new adoption and need a reviewed migration path for affected sites; do not silently rewrite customer deployments.')
paragraph('Measure component matches, avoided model calls, tokens per initial preview, later customization and defects. Guided static assembly and photo attachment already avoid inference. No percentage cost-saving claim is justified yet. The broader backend library, promotion workflow, component withdrawal and runtime isolation remain unfinished.')

heading('31 Domains Connections and Future Workloads')
paragraph('Existing-domain ownership is implemented through owner-scoped hostname claims, random TXT proofs, seven-day expiry and bounded fixed-resolver checks. The agent and guided commands can prepare, renew and check proofs. Exact positive matching verifies ownership only. It does not connect hosting, issue a certificate or imply domain registration. Project/account/platform limits are three, ten and eighty claims respectively.')
paragraph('Custom-hostname hosting code reviews and provisions exact provider resources, verifies current ownership and direct CNAME routing, and requires active hostname/TLS state before granting a short serving lease. Refresh results are fenced by attempt ID and current proof. Unknown creation outcomes never trigger a blind second POST or adoption by name. Disconnect removes the serving lease before exact-ID cleanup. Operator recovery can reconcile a known provider ID only with independent evidence and an immutable audit receipt. This code remains disabled pending scoped platform credentials and verified fallback-origin setup; no real customer hostname or certificate has been provisioned.')
paragraph('Domain purchase is a separate limited capability. Search and availability are advisory until an authoritative price quote identifies registration term, total charge, renewal terms, supported extension and expiry. Purchase requires exact explicit confirmation and an idempotent operation record. Unknown registrar results must be reconciled before another attempt. Registrar access, payments and customer terms are not configured; do not simulate successful registration or charge build credits.')
paragraph('Optional GitHub App and Cloudflare OAuth code uses one-time session-bound S256 PKCE, encrypted expiring credentials, scoped authorization, immediate local disconnect and leased remote revocation. AES-GCM binds provider, owner, record and purpose under a separate vault key. No operator GitHub or Wrangler token is used as a customer credential. The flows remain disabled because client/App credentials and the vault key are absent. Private Cloudflare clients initially accept only parent-account members; external testers require a separate public-client review.')
sub('Reviewed source backups and customer DNS')
paragraph('GitHub backup reviews pin a saved version and source hash, selected repository visibility/branch and expected branch head. A confirmed commit writes a readable version folder with an expected-head condition and skip-ci message. Exact tree checks verify the result. Uncertain writes are reconciled read-only, never resent. The implementation requires an existing initialized repository; real consent and backup commits remain unverified without App setup.')
paragraph('Customer DNS reviews pin an owned claim, active authorized zone, exact TXT proof, credential ID, complete record inventory and ten-minute expiry. Identical existing proofs need no write. Only explicit user confirmation can add the TXT record; current records are never overwritten. A committed dispatch state and unique attempt guards prevent duplicate writes. An uncertain outcome is only observed, and a matching marker does not grant deletion authority. Public DNS verification remains separate.')
paragraph('Guided /dns-zones, /dns, /review-dns, /confirm-dns and /check-dns provide the same controls in chat without AI usage. A model may discover zones, list saved reviews and prepare a review, but cannot confirm or select arbitrary record content. The chat turn is durably claimed before provider work. Lost transcript acknowledgements can leave an owned review discoverable through /dns; replay never repeats the external dispatch. CNAME routing, exact-record editing/removal, long-lived renewal and registrar operations are unfinished.')

paragraph('General small CRUD apps, scheduled jobs and isolated build execution remain in the original MVP scope. The free/included-service constraint means Containers/Sandbox cannot be adopted merely because the original design proposed them. First implement bounded trusted backend components, with per-tenant authorization and operation quotas. Any later arbitrary-code execution needs a separately verified isolation boundary and compatible cost model before being offered to customers.')
paragraph('Traditional VPS workloads, fixed-machine semantics and email mailbox hosting remain outside the intended product. Durable workflow execution, automatic health checks, restore of application data and version diffs are also outstanding. Static HTML pointer restoration currently proves version restore for the supported sites; it does not prove database rollback or general service recovery.')

heading('32 Verification Operations and Remaining Gates')
paragraph('Deploy with tools/deploy.mjs: apply remote D1 migrations, build assets, deploy the public host, then deploy the workspace Worker. A migration failure stops deployment. An earlier trigger syntax accepted locally failed remotely; the deployment gate and compatible trigger form were corrected. Record both Worker versions and migration state in docs/deployment.md. Do not run paid CI or enable additional provider services automatically.')
table(['Area', 'Evidence and limitation'], [
 ('Identity and chat', 'Local isolation/concurrency/replay tests and live signed passkey assertions pass. Native synced-device acceptance remains.'),
 ('AI and metering', 'Live Muse creation/editing, inspection and DNS-review discovery pass. Atomic month receipts and concurrent claims pass controlled tests. Unknown provider outcomes need operator reconciliation.'),
 ('Versions and photos', 'Local ownership, cross-project rejection, restore/unpublish, archive integrity and quota concurrency pass. Live publication and browser photo rendering pass.'),
 ('Export', 'Independent ZIP CRC and image decoding pass. Browser policy blocked opening local file URLs; direct offline browser rendering is unverified.'),
 ('Retention', 'Photo and version removal tests cover review races, replay, expiry and lost acknowledgements. Live individual-removal checks pass. Whole-account lifecycle and first scheduled production cleanup observation remain open.'),
 ('Payments and integrations', 'Controlled OAuth, backup, TXT and custom-hostname tests pass. Live disabled-access checks pass. Real customer consent, provider writes, TLS and checkout acceptance remain pending configuration.'),
])
paragraph('Application snapshot: source commit 3827e65; migrations through 0024. Workspace Worker 33b737b3-b224-477b-ab6d-226d17192395 and public Worker 80b6e5f1-ef3d-4da2-bbd7-f97ff0783f5e. Daily 03:17 UTC maintenance handles photos and provider revocation; hourly minute 47 handles hostname maintenance, currently a no-op while hosting is disabled. Later documentation-only commits do not imply a new deployment.')
paragraph('Operations still need transcript/audit retention policy, customer project/account deletion, export beyond static sites, abuse suspension, pending-upload recovery, provider-usage reconciliation and tested disaster recovery. Existing reviewed photo/version removal covers individual unused artifacts only. Provider connection revocation and external resources must be accounted for before whole-account deletion. R2 cleanup is eventual. Account-wide infrastructure usage must be monitored separately from application caps.')
paragraph('The next delivery gates are trusted contact forms and a tenant inbox; real customer hostname/TLS and optional-account acceptance after setup; website-routing DNS control; registrar availability/price/renewal quotes and exact purchase confirmation after provider/funding setup; broader dynamic workloads within the cost constraint; and full device/mobile/operations acceptance. Payment setup remains deferred by the owner. The static-site and domain-review milestones do not complete the full MVP.')
paragraph('Detailed current contracts are in docs/mvp.md, docs/version-retention.md, docs/photos.md, docs/plan-lifecycle.md, docs/payments.md, docs/shared-components.md, docs/workspace-agent.md, docs/deployment.md and docs/integrations. Original product intent remains in docs/reference/ai_managed_cloud_mvp_design.docx. Appendix product notes retain their historical date and are not current eligibility or pricing guarantees. Recheck provider capabilities before enabling an integration.')

import re
for p in doc.paragraphs:
    if p.style.name.startswith('Heading'):
        p.text = re.sub(r'[^A-Za-z0-9 ]+', ' ', p.text)
        p.text = re.sub(r' +', ' ', p.text).strip()

from docx.oxml import OxmlElement
for t in doc.tables:
    if len(t.rows) > 1:
        repeat = OxmlElement('w:tblHeader')
        t.rows[0]._tr.get_or_add_trPr().append(repeat)
        for c in t.rows[0].cells:
            for p in c.paragraphs: p.paragraph_format.keep_with_next = True

for section in doc.sections:
    for p in section.footer.paragraphs:
        if p.text.strip(): p.text = 'AI Managed Cloud Platform MVP Design  |  v0.4'
for name in ['Title','Subtitle','Heading 1','Heading 2','Heading 3']:
    doc.styles[name].font.color.rgb = RGBColor(0,0,0)
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUTPUT)
print(OUTPUT)
