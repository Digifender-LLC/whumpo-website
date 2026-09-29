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
doc.paragraphs[3].text = 'Version 0.3  |  September 29, 2026'

first_section = next(p for p in doc.paragraphs if p.text.startswith('1. Executive Summary'))
intro = first_section.insert_paragraph_before()
intro.add_run('Current implementation. ').bold = True
intro.add_run('Whumpo now runs an invitation-only test at digifender.com. Passkeys, conversational onboarding, metered Muse planning and edits, reusable static pages, private photos, confirmed publication, restore and source export are deployed. The full MVP remains incomplete. Sections 1 through 25 retain the original product vision; sections 26 through 32 supersede their infrastructure assumptions and define the current implementation, verification limits and remaining delivery contracts. No Stripe account is configured, and payments remain disabled.')

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
paragraph('The homepage is an advertising and early-access page. The signed-in workspace opens directly into a persistent conversation, with compact project, live-site and usage statistics. A Details menu exposes files, versions, security and billing. The same capabilities can be reached from chat; domain and account-connection commands currently explain their unfinished status.')
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
paragraph('Guided onboarding collects a brief and project name without inference and resumes from D1 after reload. Each message carries a UUID and expected conversation revision. One atomic batch commits the response, project/version changes and activity. Identical retries return the saved result. Competing tabs receive a conflict and refresh; pending model operations serialize the conversation. The test retains up to 2,000 turns per workspace and displays the latest 100.')
sub('The model proposes and the server decides')
paragraph('The model returns a validated JSON proposal in text. This is not native SDK function calling. Server code selects an allowlisted action, validates arguments, resolves ownership and checks quotas. The model can create a private draft, edit an owned version or prepare a publication review. It cannot confirm a review, alter entitlements, read another project or supply executable backend code.')
paragraph('Publishing, restoring and unpublishing require a separate confirmation tied to an exact version or action, owner, project, expected publication revision and ten-minute expiry. D1 guards apply the pointer, activity event and chat receipt atomically. Draft work never changes the public pointer. Future purchases and destructive operations need equally exact impact and price approvals; ordinary language from a model is not authority.')

heading('28 AI Usage Credits and Payment Boundaries')
paragraph('The server adapter supports OpenAI Chat Completions and Responses text protocols. Operator configuration fixes the HTTPS endpoint, model, key and protocol. Prompts cannot change the destination. Requests use manual redirects, a 60-second timeout, bounded input/output and sanitized errors. Redirect responses are rejected. Automatic provider retries and fallback models are disabled.')
paragraph('The live test uses https://opencode.ai/zen/go/v1 and muse-spark-1.3-contributor through Responses, under the existing OpenCode Go subscription. Contributor data-use disclosure is shown to testers. Photo names and dimensions can be supplied to the planner; photo pixels are not sent, and the model must not invent visual descriptions. The provider boundary adapts reviewed Jarvis response validation and diagnostics; docs/jarvis-reuse.md records provenance and differences.')
table(['Plan', 'Monthly USD', 'Live sites', 'Monthly units'], [
 ('Explore', '0', '1', '25'), ('Launch', '12 proposed', '3', '250'), ('Studio', '29 proposed', '10', '800'),
])
paragraph('One build unit is the ceiling of (input tokens + four times output tokens) divided by 1,000. Provider reasoning tokens count as output usage. Reserve the bounded maximum before inference, save the answer and token receipt before settlement, then charge actual units and release the remainder. Monthly allowance is consumed before credits; credit overage requires explicit opt-in. Credits cannot bypass site, file, storage or abuse limits.')
paragraph('Dispatch is claimed once. Saved receipts reconcile after a lost commit acknowledgement without another inference. Confirmed failures release reservations; uncertain provider outcomes retain a hold for operator reconciliation. Undispatched reservations expire after five minutes. There is no automated provider-receipt reconciliation yet. Status reads, guided builds, uploads, ordinary photo attachment, publication and export consume no AI units.')
paragraph('The proposed top-up is USD 5 for 100 credits. Monthly units reset on the UTC calendar month; purchased credits do not reset monthly. A Stripe test credit-checkout implementation exists, with server-fixed price, test-only keys, signed timestamped webhooks, authoritative session retrieval and idempotent grants. It is unconfigured because the owner has no Stripe account. Checkout, real charges, subscriptions and paid entitlements remain disabled. Domain registration is a separate future charge, never silently paid with build credits.')

heading('29 Immutable Websites Photos and Exports')
paragraph('The generic catalog currently contains launch-page@1, site-page@1 and photo-page@1. Configuration is validated plain text, allowlisted themes, up to six text sections and at most four same-project ready photo references. The assembler escapes text and records exact HTML, configuration, component ID, digest, source and optional base version. D1 limits a project to 25 retained versions, 32 KiB HTML and 8 KiB configuration per version.')
paragraph('Focused AI edits specify an owned base and changed fields. Omitted fields are preserved; a new immutable version records ancestry. /build assembles a project brief without inference. Use in website or /photo FILE_ID attaches an owned photo to the latest version of its project, also without inference. All version dependencies commit with the chat receipt. Same-owner cross-project photos are rejected.')
sub('Private preview and public serving')
paragraph('Private previews require the current owner session and use no-store caching and a CSP sandbox that denies scripts and forms. Photo previews read and verify exact dependencies, then embed bounded JPEG data URLs into the response. Stored HTML retains relative asset paths. This avoids public bearer links and opaque-origin cookie dependencies.')
paragraph('Confirmed publication points to an exact retained version at sites.digifender.com/s/PROJECT_ID. Photo pages canonicalize a trailing slash. The public Worker checks the current publication relation before serving /s/PROJECT_ID/assets/FILE_ID.jpg. Unattached uploads and photos referenced only by other versions are inaccessible. Restore switches HTML and references together; unpublish revokes both on the next request. Publication reviews explicitly disclose photo exposure.')
sub('Uploads and retention')
paragraph('The browser accepts JPEG, PNG and WebP up to 10 MiB, decodes orientation, resizes to 1600 by 1600 and encodes a JPEG up to 1 MiB. The server validates the bounded baseline-JPEG envelope and strips APP/COM metadata; it is not a complete pixel decoder. D1 reserves immutable file identity before create-only R2 writes. Retries verify checksum and size; conflicting reuse is rejected. Pending reservations count toward limits and require operator recovery if the prepared upload bytes were lost.')
paragraph('Limits are 20 photos per project, 50 per account and 500 platform-wide, bounding active photo storage to 500 MiB. Atomic monthly operation counters cap application R2 reads at 100,000 and writes at 10,000. Daily cleanup is outside these counters. Allowances are shared with other applications; these controls are not an account-wide billing cap.')
paragraph('Source export returns a bounded ZIP with exact HTML/CSS, referenced JPEGs under public/assets, security headers, README and configuration/checksum metadata outside the public directory. Missing or mismatched assets fail the export. Accounts, chats, keys, billing records and database contents are excluded. User-facing file deletion is pending: retained version dependencies must not be silently broken. Project/account cascades queue R2 cleanup; daily 03:17 UTC processing has a one-hour grace period.')

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
paragraph('Existing-domain setup is an MVP requirement. The next domain service should record hostname, owner, target project, ownership proof, provider IDs and routing/TLS status. The customer receives clear connection instructions and progress through chat and a secondary screen. Check domain ownership before activation, reject conflicting claims, and reconcile the provider state after timeouts. Never report a domain connected from DNS presence alone.')
paragraph('Cloudflare for SaaS/custom-hostname capabilities, included limits, account access and certificate behavior must be verified before implementation. No paid add-on may be enabled to complete this flow under the current authorization. The deployed test host does not demonstrate arbitrary customer-domain routing. Nameserver delegation and optional customer Cloudflare DNS control need distinct setup paths.')
paragraph('Domain purchase is a separate limited capability. Search and availability are advisory until an authoritative price quote identifies registration term, total charge, renewal terms, supported extension and expiry. Purchase requires exact explicit confirmation and an idempotent operation record. Unknown registrar results must be reconciled before another attempt. Registrar access, payments and customer terms are not configured; do not simulate successful registration or charge build credits.')
paragraph('Optional GitHub and Cloudflare connections should use scoped authorization, server-stored encrypted credentials, state/PKCE where supported, expiry and revocation. Chat initiates the flow; provider consent occurs in the provider UI. GitHub repository export must honor customer-selected repository/branch and version boundaries. DNS credentials should be limited to the selected zone and operations. Disconnect must revoke access and explain which existing deployments continue to serve.')
paragraph('General small CRUD apps, scheduled jobs and isolated build execution remain in the original MVP scope. The free/included-service constraint means Containers/Sandbox cannot be adopted merely because the original design proposed them. First implement bounded trusted backend components, with per-tenant authorization and operation quotas. Any later arbitrary-code execution needs a separately verified isolation boundary and compatible cost model before being offered to customers.')
paragraph('Traditional VPS workloads, fixed-machine semantics and email mailbox hosting remain outside the intended product. Durable workflow execution, automatic health checks, restore of application data and version diffs are also outstanding. Static HTML pointer restoration currently proves version restore for the supported sites; it does not prove database rollback or general service recovery.')

heading('32 Verification Operations and Remaining Gates')
paragraph('Deploy with tools/deploy.mjs: apply remote D1 migrations, build assets, deploy the public host, then deploy the workspace Worker. A migration failure stops deployment. An earlier trigger syntax accepted locally failed remotely; the deployment gate and compatible trigger form were corrected. Record both Worker versions and migration state in docs/deployment.md. Do not run paid CI or enable additional provider services automatically.')
table(['Area', 'Evidence and limitation'], [
 ('Identity and chat', 'Local isolation/concurrency/replay tests and live signed passkey assertions pass. Native synced-device acceptance remains.'),
 ('AI and metering', 'Real Muse drafting/editing, receipt settlement and replay pass. Unknown provider outcomes still need operator reconciliation.'),
 ('Versions and photos', 'Local ownership, cross-project rejection, restore/unpublish, archive integrity and quota concurrency pass. Live publication and browser photo rendering pass.'),
 ('Export', 'Independent ZIP CRC and image decoding pass. Browser policy blocked opening local file URLs; direct offline browser rendering is unverified.'),
 ('Cleanup', 'Local queued/orphan cleanup tests pass. First scheduled production execution has not yet been observed.'),
 ('Payments and integrations', 'Checkout contract tests pass without Stripe. Real checkout, subscriptions, domains and optional connections are unconfigured or unimplemented.'),
])
paragraph('Operations still need documented transcript/audit retention, user-facing deletion and export coverage beyond static sites, account suspension/abuse handling, operator recovery for pending uploads, provider-usage reconciliation and tested disaster recovery. Current R2 deletion is eventually processed, not immediate. Infrastructure usage must be monitored across the shared Cloudflare account; app caps do not guarantee zero provider charges.')
paragraph('The next delivery gates are: trusted contact forms and a tenant inbox; safe removal of unused photos; existing-domain ownership and TLS setup; optional account connections; domain quote/purchase capability when providers and funding are configured; and broader dynamic workload execution within the deployment constraint. Preserve the full MVP checklist in docs/mvp.md rather than declaring the static-site milestone complete MVP.')
paragraph('Detailed contracts and evidence are maintained in docs/mvp.md, docs/photos.md, docs/photo-publication-plan.md, docs/shared-components.md, docs/payments.md, docs/jarvis-reuse.md and docs/deployment.md. Original product intent is retained in docs/reference/ai_managed_cloud_mvp_design.docx. Provider references are recorded in those contracts; recheck capabilities and pricing at each integration change.')

from docx.oxml import OxmlElement
for t in doc.tables:
    if len(t.rows) > 1:
        repeat = OxmlElement('w:tblHeader')
        t.rows[0]._tr.get_or_add_trPr().append(repeat)
        for c in t.rows[0].cells:
            for p in c.paragraphs: p.paragraph_format.keep_with_next = True

for section in doc.sections:
    for p in section.footer.paragraphs:
        if p.text.strip(): p.text = 'AI Managed Cloud Platform MVP Design  |  v0.3'
for name in ['Title','Subtitle','Heading 1','Heading 2','Heading 3']:
    doc.styles[name].font.color.rgb = RGBColor(0,0,0)
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUTPUT)
print(OUTPUT)
