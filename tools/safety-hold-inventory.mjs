// WH-132 inventory of every ordinary deletion/expiry path against preservation-hold scope.
// `checkHoldInventory()` scans source and canonical schema for every `DELETE FROM` site and R2 `FILES.delete(` call,
// and fails when a site is unclassified or a classification no longer matches source. Non-DELETE overwrite/clear
// paths are listed separately. Decisions: `blocked` (database trigger refuses inside held scope), `skips-held`
// (expiry/cleanup query excludes held scope; database trigger backs it), `preserved` (prior payload copied to restricted
// storage while held; the customer action still succeeds), `hold-mechanism`, or `excluded` (with rationale).
import {readdir,readFile} from 'node:fs/promises';
import {join,relative,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const credential='Authentication/credential material or OAuth state. Holds preserve customer content, not live access: expiry, logout, revocation and rotation must keep working, and retaining them would extend access rather than preserve evidence.';
const receipts='Process receipt, quota counter or review token without customer content; the content it refers to is covered separately.';
const proposals='Unapplied, short-lived proposal/review state; saved versions and applied specifications remain and are covered by the version/project holds.';
const blocked=(trigger,note)=>({decision:'blocked',mechanism:trigger,note});
const excluded=rationale=>({decision:'excluded',rationale});
export const deletionSites={
 'src/shared-modules/schema.sql::project_files':blocked('safety_hold_file_retained','WH-128 module uploads are project_files rows: module_file_visitor_erased (visitor erasure) and module_file_instance_removed (files instance removal, today only with its project) and module_record_files_removed (the uploads attached to a WH-127 record, deleted with the record) delete them through the same table, so a held file refuses the delete and the erasure or removal fails; nothing is queued for R2 cleanup.'),
 'schema/platform.sql::project_files':blocked('safety_hold_file_retained','Confirmed photo removal (photo_removal_apply) inside an account/project/object hold fails with the existing generic error; the R2 object is never queued.'),
 'schema/platform.sql::site_versions':blocked('safety_hold_version_retained','Confirmed saved-version removal (version_removal_apply) inside a held project.'),
 'schema/platform.sql::app_visitors':blocked('safety_hold_visitor_retained','Owner erasure of a revoked visitor (app_owner_erasure_apply) inside a held project.'),
 'schema/platform.sql::app_documents':blocked('safety_hold_visitor_retained','Only reached through app_visitors deletion, which the hold refuses.'),
 'schema/platform.sql::app_runs':blocked('safety_hold_visitor_retained','Only reached through app_visitors deletion, which the hold refuses.'),
 'schema/platform.sql::app_auth_challenges':excluded(credential),
 // WH-126: disabling the access instance signs its visitors out (module_activation_apply); credentials only, no evidence.
 'src/shared-modules/schema.sql::app_auth_challenges':excluded(credential),
 'src/shared-modules/schema.sql::app_sessions':excluded(credential),
 'schema/platform.sql::app_invitations':excluded(credential),
 'schema/platform.sql::app_passkeys':excluded(credential),
 'schema/platform.sql::app_recovery_codes':excluded(credential),
 'schema/platform.sql::app_sessions':excluded(credential),
 'schema/platform.sql::app_recovery_documents':{decision:'preserved',mechanism:'safety_hold_app_recovery_document',note:'Point-in-time copies cleared by visitor revocation or recovery-point removal inside a held project are copied into safety_preserved_records first (owner decision, October 4, 2026); revocation and removal still succeed without visible difference.'},
 'schema/platform.sql::app_migration_documents':excluded('Transient migration outputs; the primary visitor documents are retained.'),
 // WH-050 operator controls (#186). The two record tables refuse deletion inside held scope or inside 90 days, and the
 // retention receipt only names ids: no customer content is held by any of the four sites.
 'schema/platform.sql::operator_containments':blocked('operator_containment_retained','Reviewed retention cleanup (operator_retention_apply) of a resolved containment older than 90 days: the trigger refuses an unresolved or recent record and any record whose subject is a held account, a held project or the owner of a held project.'),
 'schema/platform.sql::operator_session_revocations':blocked('operator_session_revocation_retained','Reviewed retention cleanup of an operator session-revocation record: refused inside 90 days and for any account under an unreleased preservation hold.'),
 'schema/platform.sql::operator_retention_receipts':excluded('Process receipt naming only record ids and a cutoff, no customer content; its own trigger (operator_retention_retained) keeps it 90 days, and the records it refers to are covered by the containment and revocation triggers.'),
 'schema/platform.sql::identity_sessions':excluded(credential),
// B11 layout receipt cap (#465): per-account dashboard layout history (card order and sizes), no project, visitor or customer content.
 'schema/platform.sql::workspace_layout_receipts':excluded('Dashboard layout history per account (card arrangement only): no project, visitor or customer content, and not safety evidence. The cap trigger and nightly pruning keep the latest 50.'),
 'src/workspace-layout-maintenance.ts::workspace_layout_receipts':excluded('Nightly pruning of dashboard layout history beyond the latest 50 receipts; same rationale as the schema site.'),
 'schema/platform.sql::domain_claims':excluded('DNS ownership-claim workflow state; no customer content.'),
 'src/public-admission.ts::public_client_usage':excluded('Hashed per-client admission counters (WH-075); no customer content and no source address, only a daily SHA-256 key.'),
 'src/public-admission.ts::storage_project_usage':excluded('Per-project monthly photo-read counters (WH-075); usage totals only, no customer content.'),
 'schema/platform.sql::profile_photo_safety':{decision:'preserved',mechanism:'safety_hold_profile_photo',note:'The replaced photo and its safety receipt are copied into safety_preserved_records before profile_photo_safety_invalidate removes the receipt.'},
 'schema/platform.sql::project_spec_proposals':excluded(proposals),
 'schema/platform.sql::service_client_proposals':excluded(proposals),
 'schema/platform.sql::safety_preserved_records':{decision:'hold-mechanism',mechanism:'safety_preservation_holds_release',note:'Preserved payloads are removed only when the last covering hold is released; a direct delete under an active hold is refused.'},
 'src/workspace-identity/kits.ts::users':blocked('safety_hold_account_retained','Pending-enrollment cancellation (account deletion) of a held account fails with its existing generic error.'),
 'src/contacts.ts::contact_submissions':{decision:'blocked',mechanism:'safety_hold_contact_retained + cleanupContacts excludes safety_held_projects',note:'Owner deletion is refused; expiry skips held projects. The inbox already hides expired messages.'},
 'src/contacts.ts::contact_receipts':excluded(receipts),
 'src/shared-modules/api.ts::module_request_receipts':excluded(receipts),
 'src/review-turnover.ts::${f.table}':blocked('review turnover guards (directory_review_retained and the other 20 receipt-requiring BEFORE DELETE guards)','WH-182 compaction deletes a terminal review row only when its own statement finds no account or project hold (the generated guard predicate includes safety_held_projects or the account hold) and the schema guard repeats the check; the sealed receipt it leaves carries the same hold protection (review_receipt_retained).'),
 'src/review-turnover.ts::review_receipts':blocked('review_receipt_retained','WH-182 removes a sealed receipt only after the 30-day replay horizon and never inside an account or project hold; the statement repeats the trigger conditions.'),
 // WH-128 owner "Remove from collection": deletes one owner-filed photo's collection membership row only.
 'src/shared-modules/files-gallery.ts::module_files':excluded('Owner collection membership row (ids only) for an owner photo; the photo row, its R2 object, its safety receipt and every saved version stay, so the content stays covered by the project_files hold (safety_hold_file_retained). Staff/visitor upload rows are never deleted here.'),
 'src/contacts.ts::contact_notification_outbox':{decision:'skips-held',mechanism:'cleanupContacts excludes safety_held_projects + safety_hold_contact_outbox_retained',note:'Content-free delivery metadata (no visitor name, email or message); expiry skips held projects and a direct delete is refused while held.'},
 // WH-157 (schema batch 3c): consent and preference rows. Opt-out, address removal and role revocation must always work (a hold preserves customer content, not the right to stop receiving mail); the rows hold no content, only an address the person gave.
 'src/notification-recipients.ts::staff_notification_optins':excluded('WH-157 staff opt-out: a consent withdrawal must always succeed; the row is a visitor id, an access instance id and a timestamp.'),
 'src/notification-recipients.ts::visitor_notification_addresses':excluded('WH-157 visitor removal of their own notification address (a consent withdrawal, always allowed); the address is supplied by the visitor and carries no project content. The row also goes with the visitor identity, which a hold already protects (safety_hold_visitor_retained).'),
 'src/shared-modules/schema.sql::staff_notification_optins':excluded('WH-157 opt-in removed by staff role revocation (staff_notification_optin_revoked) or by a changed or removed address (visitor_notification_address_changed/removed); a consent withdrawal that must not be blocked, with no content beyond ids and a timestamp.'),
 'src/contacts.ts::contact_notification_send_ledger':excluded('WH-036 content-free daily provider-call counters enforcing the spending ceiling; no customer content.'),
 'schema/platform.sql::contact_notification_destinations':blocked('safety_hold_contact_destination_retained','A confirmed Chat review that replaces the address (contact_destination_review_apply) or an operator suppression reset that removes a suppressed address (contact_suppression_reset_apply) inside a held project is refused as a whole.'),
 'schema/platform.sql::contact_notification_suppressions':excluded('WH-036 delivery-control row (address and reason), removed only by an immutable operator-reviewed reset audit row; the reset fails as a whole when its held destination cannot be removed.'),
 'src/contact-notifications.ts::contact_notification_destinations':blocked('safety_hold_contact_destination_retained','Owner removal or replacement of a notification address inside a held project is refused; the destination carries only the owner-supplied address.'),
 'src/guest-previews/owner.ts::guest_preview_feedback':blocked('safety_hold_guest_feedback_retained','Owner comment deletion inside a held account/project.'),
 'src/guest-previews/owner.ts::guest_preview_links':{decision:'blocked',mechanism:'safety_hold_guest_link_retained',note:'Link deletion with feedback is refused while held; maintenance pruning only removes ended comment-free links (token hashes, no content).'},
 'src/files.ts::file_cleanup':{decision:'skips-held',mechanism:'cleanupPhotos excludes held queue rows + safety_hold_file_cleanup_retained',note:'Queue rows carry project/owner ids, so objects removed shortly before an account or project hold stay queued and stored until release. An object hold needs a still-referenced file, which cannot be queued while held.'},
 'src/files.ts::R2':{decision:'skips-held',mechanism:'queue row deleted first (refused when held); orphan sweep lists only photos/ and retains every queued key',note:'Restricted evidence under restricted/safety-evidence/ is never listed or deleted by ordinary cleanup.'},
 'src/safety-cases.ts::R2':{decision:'hold-mechanism',mechanism:'disposeSafetyEvidence',note:'Audited restricted-evidence disposal by an authenticated preservation approver, only after case closure with no open disclosure.'},
 'src/site-traffic.ts::site_traffic_daily':{decision:'skips-held',mechanism:'cleanupTraffic excludes safety_held_projects',note:'Readers only show the 30-day window, so retained rows are not visible.'},
 'src/site-traffic.ts::site_traffic_quality':{decision:'skips-held',mechanism:'cleanupTraffic excludes safety_held_projects',note:'Content-free daily counters of excluded automated requests and missed measurements; readers only show the 30-day window.'},
 'src/app-lifecycle.ts::app_visitors':blocked('safety_hold_visitor_retained','Visitor self-deletion inside a held project returns the existing "could not be confirmed" error. Visitor deletion rights during a hold need counsel review (owner question).'),
 'src/app-lifecycle.ts::app_daily_usage':excluded(receipts),
 'src/app-lifecycle.ts::app_deletion_receipts':excluded(receipts),
 'src/app-lifecycle.ts::app_deletion_reviews':excluded(receipts),
 'src/app-lifecycle.ts::app_migration_documents':excluded('Transient migration outputs; the primary visitor documents are retained.'),
 'src/app-lifecycle.ts::app_owner_erasures':excluded(receipts),
 'src/app-auth.ts::app_auth_challenges':excluded(credential),
 'src/app-auth.ts::app_invitations':excluded(credential),
 'src/app-auth.ts::app_passkeys':excluded(credential),
 'src/app-auth.ts::app_sessions':excluded(credential),
 'src/app-data.ts::app_sessions':excluded(credential),
 'src/chat-interactions/retention.ts::connection_chat_links':excluded(credential),
 'src/cloudflare-connection.ts::cloudflare_oauth_states':excluded(credential),
 'src/cloudflare-connection.ts::cloudflare_token_vault':excluded(credential),
 'src/connection-rotation.ts::connection_rotation_guards':excluded(credential),
 'src/github-connection.ts::github_oauth_states':excluded(credential),
 'src/github-connection.ts::github_revocation_claims':excluded(credential),
 'src/github-connection.ts::github_token_staging':excluded(credential),
 'src/github-connection.ts::github_token_vault':excluded(credential),
 'src/workspace-identity/admission.ts::${table}':excluded(credential),
 'src/workspace-identity/admission.ts::cloudflare_oauth_states':excluded(credential),
 'src/workspace-identity/admission.ts::connection_oauth_exchanges':excluded(credential),
 'src/workspace-identity/admission.ts::github_oauth_states':excluded(credential),
 'src/workspace-identity/admission.ts::github_refresh_custody':excluded(credential),
 'src/workspace-identity/admission.ts::github_token_staging':excluded(credential),
 'src/workspace-identity/admission.ts::github_token_vault':excluded(credential),
 "src/workspace-identity/ceremonies.ts::${p.kind==='session'?'identity_sessions':'identity_grants'}":excluded(credential),
 'src/workspace-identity/ceremonies.ts::identity_ceremony_receipts':excluded(credential),
 'src/workspace-identity/ceremonies.ts::identity_challenges':excluded(credential),
 'src/workspace-identity/ceremonies.ts::identity_effect_receipts':excluded(credential),
 'src/workspace-identity/ceremonies.ts::identity_grants':excluded(credential),
 'src/workspace-identity/ceremonies.ts::identity_handoffs':excluded(credential),
 'src/workspace-identity/ceremonies.ts::identity_kit_offers':excluded(credential),
 'src/workspace-identity/ceremonies.ts::identity_sessions':excluded(credential),
 'src/workspace-identity/http.ts::${table}':excluded(credential),
 'src/workspace-identity/http.ts::identity_challenges':excluded(credential),
 'src/workspace-identity/kits.ts::identity_challenges':excluded(credential),
 'src/workspace-identity/kits.ts::identity_grants':excluded(credential),
 'src/workspace-identity/kits.ts::identity_kit_offers':excluded(credential),
 'src/workspace-identity/kits.ts::identity_sessions':excluded(credential),
 'src/workspace-identity/recovery.ts::${table}':excluded(credential),
 'src/workspace-identity/recovery.ts::identity_credentials':excluded(credential),
 'src/workspace-identity/recovery.ts::identity_kit_offers':excluded(credential),
 'src/workspace-identity/recovery.ts::identity_recovery_reviews':excluded(credential),
 'src/workspace-identity/schema.sql::identity_challenges':excluded(credential),
 'src/workspace-identity/schema.sql::identity_sessions':excluded(credential),
 // Owner email-change and connector maintenance/revocation sites: ids, digests and timestamps only, no customer content.
 'src/connector-records-maintenance.ts::connector_receipts':excluded(receipts),
 'src/connector-records-maintenance.ts::lookup_consents':excluded(receipts),
 'src/email-change/maintenance.ts::owner_email_change_limits':excluded(receipts),
 'src/email-change/maintenance.ts::owner_email_changes':excluded(receipts),
 // WH-052 P-2: the nightly `jobs` pass removes finished journal jobs (events and outbox entry by cascade) 30 days after their last transition.
 'src/job-journal.ts::job_journal':excluded('Job control state (opaque ids, digests, schedule and receipt references; no customer content, message or payload): the content a job acts on is covered by its own domain tables and holds. The statement removes only finished jobs and the schema trigger job_journal_retained refuses any other.'),
 'src/email-change/maintenance.ts::owner_security_reviews':excluded(receipts),
 'src/email-change/review-store.ts::${table}':excluded(credential),
 'src/email-change/review-store.ts::github_oauth_states':excluded(credential),
 'src/email-change/review-store.ts::github_token_staging':excluded(credential),
 'src/email-change/review-store.ts::identity_credentials':excluded(credential),
 'src/fair-use-observation.ts::fair_use_project_lifecycle':excluded('Platform economics observation of removed projects; no customer content.'),
 'src/funnel-metrics/events.ts::funnel_events':excluded('Content-free consented measurement events; bounded expiry is a privacy commitment, not customer content.'),
 'src/profile.ts::funnel_events':excluded('Measurement-consent withdrawal must be honoured; events are content-free.'),
 'src/project-specification/store.ts::project_spec_proposals':excluded(proposals),
 'src/shared-modules/records.ts::module_records':{decision:'blocked',mechanism:'safety_hold_module_record_retained + cleanupModuleRecords excludes safety_held_projects',note:'WH-127 owner record removal (records.remove) is refused as unavailable inside a held project; retention expiry skips held projects and the delete trigger backs both. Visitor erasure cascades only through app_visitors, which the visitor hold refuses.'},
 'src/project-specification/service-clients/store.ts::service_client_proposals':excluded(proposals),
 'src/site-health.ts::site_health_budget':excluded('Platform monitoring budget; no customer content.'),
 'src/site-health.ts::site_health_checks':excluded('Platform availability checks of public pages; no customer content beyond the public URL status.'),
};
/** Overwrite/clear paths and storage outside D1 DELETE statements. */
export const otherPaths={
 'profile photo replacement or avatar change (user_profiles.photo)':{decision:'preserved',mechanism:'safety_hold_profile_photo'},
 'Chat form draft discard or seven-day expiry (chat_interactions envelope/draft cleared)':{decision:'preserved',mechanism:'safety_hold_chat_draft'},
 'account/project cascades (users, projects and every child table)':{decision:'blocked',mechanism:'safety_hold_account_retained, safety_hold_project_retained, safety_hold_project_owner'},
 'R2 objects queued before the hold was placed':{decision:'skips-held',mechanism:'file_cleanup project_id/owner_user_id + project_file_cleanup_owner'},
 'restore of a D1 archive (backup/restore)':{decision:'blocked',mechanism:'restore admission and inventory evidence refuse while a hold, open disclosure or unfinished capture exists (preservation-hold); stored evidence objects must be present with exact digests'},
 'visitor document overwrite by app runs, app recovery restore or migration apply':{decision:'preserved',mechanism:'safety_hold_app_document (previous revision copied to safety_preserved_records while an account/project hold is active; the write still succeeds, and past preserved-record capacity it fails closed)'},
 'website unpublish / publication withdrawal':{decision:'excluded',rationale:'No data is deleted; saved versions stay and are covered by the version hold.'},
 'Cloudflare D1 Time Travel / provider-managed backups ageing':{decision:'excluded',rationale:'Provider-managed point-in-time history, not an ordinary Whumpo deletion path; held current data is retained in place. Handled by the written outside-hold-control procedure (docs/content-safety.md), required before case operations are activated.'},
 'native CMS resources and GitHub backups in customer-owned Cloudflare/GitHub accounts':{decision:'excluded',rationale:'External customer-owned resources Whumpo cannot preserve; CMS testing is owner-deferred. Withdrawal/deletion of these is not a Whumpo cleanup path. Handled by the written outside-hold-control procedure (docs/content-safety.md), required before case operations are activated.'},
 'Workers logs, local operator files and browser-local drafts':{decision:'excluded',rationale:'No case or evidence content is logged or written to operator files by the case surface; browser drafts are on the customer device.'},
};
async function walk(directory){
 const entries=await readdir(directory,{withFileTypes:true});
 return (await Promise.all(entries.map(e=>e.isDirectory()?(e.name==='vendor'?[]:walk(join(directory,e.name))):[join(directory,e.name)]))).flat();
}
export async function scanDeletionSites(directory=root){
 const files=[...(await walk(join(directory,'src'))).filter(f=>/\.(ts|sql)$/.test(f)),join(directory,'schema/platform.sql')];
 const sites=new Set();
 for(const file of files){
  const text=await readFile(file,'utf8'),name=relative(directory,file);
  for(const match of text.matchAll(/DELETE\s+FROM\s+(\$\{[^}]+\}|[A-Za-z_]+)/gi))sites.add(name+'::'+match[1]);
  if(/\bFILES\.delete\(/.test(text))sites.add(name+'::R2');
 }
 return [...sites].sort();
}
export async function checkHoldInventory(directory=root){
 const sites=await scanDeletionSites(directory);
 const unclassified=sites.filter(s=>!Object.hasOwn(deletionSites,s)),stale=Object.keys(deletionSites).filter(s=>!sites.includes(s));
 for(const [site,entry] of Object.entries(deletionSites))if(!['blocked','skips-held','preserved','hold-mechanism','excluded'].includes(entry.decision)||(entry.decision==='excluded'?!entry.rationale:!entry.mechanism))throw Error('Incomplete hold inventory entry: '+site);
 return {sites:sites.length,unclassified,stale,counts:Object.values(deletionSites).reduce((c,e)=>({...c,[e.decision]:(c[e.decision]??0)+1}),{}),otherPaths:Object.keys(otherPaths).length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const result=await checkHoldInventory();
 console.log(JSON.stringify(result,null,2));
 if(result.unclassified.length||result.stale.length)process.exitCode=2;
}
