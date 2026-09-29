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
doc.paragraphs[3].text = 'Version 0.2  |  September 28, 2026'

first_section = next(p for p in doc.paragraphs if p.text.startswith('1. Executive Summary'))
intro = first_section.insert_paragraph_before()
intro.style = 'Normal'
intro.add_run('Implementation status. ').bold = True
intro.add_run('The repository now contains a local first slice of the control plane: account registration and sessions, project creation and read APIs, tenant-scoped queries, an activity feed, a D1 migration, and a simple dashboard. Site generation, AI planning, approvals, previews, publishing, domains, and usage billing remain design work. Sections 26 through 31 define the implementation contract and sequencing for those components.')

doc.add_heading('26 Implementation Baseline and Boundaries', 1)
doc.add_paragraph('The first code slice is intentionally small enough to run end to end in Wrangler with a local D1 database. It establishes resource ownership and a customer vocabulary before connecting an LLM or provisioning customer workloads. A project created in this slice is a draft record; it is not a deployed website.')

def table(headers, rows):
    t = doc.add_table(rows=1, cols=len(headers))
    t.style = 'Table Grid'
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    for cell, label in zip(t.rows[0].cells, headers):
        cell.text = label
    for row in rows:
        cells = t.add_row().cells
        for cell, value in zip(cells, row):
            cell.text = value
    return t

table(['Implemented now', 'Next contract', 'Not yet implemented'], [
    ('Worker API and static dashboard', 'Conversation and plan endpoints', 'Agent tool execution'),
    ('D1 users, sessions, projects, activity', 'Approvals, versions, deployments', 'R2 source store and sandbox builds'),
    ('Opaque cookie sessions; owner checks', 'Membership and role policy', 'Passkeys, recovery, rate limits'),
    ('Local development and type checks', 'Preview/publish and rollback checks', 'Cloudflare resource provisioning and domains'),
])
doc.add_paragraph('The placeholder D1 database ID in wrangler.jsonc is only for local development. A public environment needs a real database, separate staging and production resources, Turnstile configuration, identity hardening, abuse controls, and explicit operational ownership. No public deployment is assumed by this document.')

doc.add_heading('27 Resource and API Contracts', 1)
doc.add_paragraph('Every public API uses an authenticated customer identity. The service layer resolves ownership or membership before returning or changing any project resource. Unknown and cross-tenant project IDs both return 404 so the API does not reveal another customer’s resource existence. Mutation requests use an Origin check in addition to SameSite cookies. The next iteration should adopt a documented CSRF token strategy if cross-origin browser integrations are introduced.')
table(['Resource', 'Required fields and invariants', 'Lifecycle'], [
    ('Project', 'id, owner, name, purpose, desired state, status, timestamps; all reads and writes tenant-scoped', 'draft → building → preview-ready → live; error is recoverable'),
    ('Plan', 'project, requested outcome, normalized operations, cost estimate, risk class, input version', 'proposed → approved or rejected → executing → complete or failed'),
    ('Approval', 'actor, project, exact operation digest, impact text, expiry, authentication age', 'pending → granted, rejected, expired, or consumed'),
    ('Version', 'immutable manifest, source bundle checksum, parent, summary, build result', 'created once; never edited after sealing'),
    ('Deployment', 'version, environment, provider reference, prior known-good version, health result', 'pending → active, failed, or rolled back'),
    ('Audit event', 'actor, action, project, target, result, approval reference, timestamp', 'append-only; corrections are new events'),
])
doc.add_paragraph('Initial public endpoints already present: GET /api/health; POST /api/auth/register, /login, and /logout; GET /api/me; GET and POST /api/projects; GET /api/projects/{id}; and GET /api/activity. Planned endpoints should be added only alongside their policy checks and state transitions. Provider IDs and credentials must stay outside public responses.')

doc.add_heading('28 Agent and Tool Execution Contract', 1)
doc.add_paragraph('The model may draft a plan and request a named tool, but deterministic code decides whether the operation can run. Each tool request carries an authenticated actor, project ID, idempotency key, expected input version, validated arguments, and trace ID. The policy decision is stored before a side effect. Approval grants bind to an exact operation digest, expected price ceiling, and expiry; editing the plan invalidates the grant.')
doc.add_paragraph('Tool execution records one of four outcomes: applied, rejected by policy, failed with no side effect, or uncertain after a provider timeout. Uncertain outcomes require reconciliation against provider state before retry. Replays use the idempotency key and cannot buy a domain or deploy twice. The model receives a redacted result and never receives a reusable provider credential.')
table(['Risk', 'Default gate', 'Examples'], [
    ('Read or draft', 'Automatic after ownership check', 'Inspect status, generate source, estimate cost'),
    ('Preview or reversible project edit', 'Automatic within quota and policy', 'Build and test, create preview'),
    ('Production or network exposure', 'Customer approval until trust policy is established', 'First publish, new public endpoint'),
    ('Spend or destructive action', 'Fresh explicit approval tied to exact impact', 'Domain purchase, deletion, data overwrite'),
])

doc.add_heading('29 Build Version and Deployment Sequence', 1)
doc.add_paragraph('A customer request first becomes a plan against a known project version. A Workflow creates an isolated build environment, restores the immutable source bundle, applies the proposed patch, and runs a bounded validation suite. Successful output is archived in R2 with a content checksum and a manifest that names the source, configuration, build result, and any referenced assets. A preview points to that sealed version. Production promotion is a separate operation after customer review and policy checks.')
doc.add_paragraph('Promotion must retain the previous known-good deployment. If the new deployment fails health checks, mark the attempt failed and restore the prior deployable version. Do not edit or delete the failed version. Record provider response IDs, build logs, health evidence, and the rollback result on the deployment record. A retry creates a new attempt with the same sealed version or a new version if source changes.')
table(['Stage', 'Required evidence before advancing'], [
    ('Plan', 'Project ownership, structured change list, cost/risk evaluation'),
    ('Build', 'Sandbox completion, bounded logs, checksums, test result'),
    ('Preview', 'Immutable version manifest and reachable preview URL'),
    ('Publish', 'Approval if required, expected version still current, deployment ID'),
    ('Healthy', 'Successful synthetic check and retained prior known-good version'),
])

doc.add_heading('30 Security and Operations Decisions', 1)
doc.add_paragraph('Before public beta, complete the identity path: passkeys or a deliberately supported password and recovery path; rate limits on registration, login, and recovery; Turnstile server verification; session rotation and revocation; recent authentication for high-impact approvals; and abuse suspension procedures. The current password implementation uses a per-user salt and PBKDF2, but lacks these public-beta controls.')
doc.add_paragraph('Set retention periods for transcripts, source bundles, build logs, audit records, and deleted-project backups. Document how a customer exports source and files, how a deletion request reaches every storage layer, and how a restore is tested. Record resource usage per project before exposing a customer price estimate. Prices and quotas must be configuration with a date and source, not model-generated claims.')
doc.add_paragraph('Cloudflare capability and pricing statements in the original design are planning inputs. Recheck account access, API limits, pricing, beta status, and terms when each integration is implemented. Artifacts and Registrar remain behind capability flags; the R2 version bundle and existing-domain path define the baseline experience.')

doc.add_heading('31 Delivery Slices and Acceptance Checks', 1)
table(['Slice', 'Done when'], [
    ('Foundation', 'Local registration, sign in, project creation, tenant isolation, activity, and type checks pass'),
    ('Identity hardening', 'Public signup is abuse protected; recovery, rate limits, session controls, and security tests pass'),
    ('Plan and policy', 'A user request produces a structured plan; unauthorized, over-budget, or stale actions are rejected'),
    ('Build and preview', 'A simple business site builds in isolation and receives an immutable preview version'),
    ('Publish and restore', 'Health-checked promotion succeeds; failed promotion leaves the prior site live; restore works'),
    ('Existing domains', 'Customer can connect a supported domain and see certificate/routing state'),
    ('Domain purchase beta', 'Only enabled extensions appear; authoritative price and exact approval precede registration'),
])
doc.add_paragraph('The product name is provisional. Implementation should use the name only in presentation and configuration, not in data contracts or resource assumptions that would make renaming expensive.')

for section in doc.sections:
    for paragraph in section.footer.paragraphs:
        if paragraph.text.strip():
            paragraph.text = 'AI Managed Cloud Platform MVP Design  |  v0.2'

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
doc.save(OUTPUT)
print(OUTPUT)
