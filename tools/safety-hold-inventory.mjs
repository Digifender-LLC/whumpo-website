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
 'schema/platform.sql::project_files':blocked('safety_hold_file_retained','Confirmed photo removal (photo_removal_apply) inside an account/project/object hold fails with the existing generic error; the R2 object is never queued.'),
 'schema/platform.sql::site_versions':blocked('safety_hold_version_retained','Confirmed saved-version removal (version_removal_apply) inside a held project.'),
 'schema/platform.sql::app_visitors':blocked('safety_hold_visitor_retained','Owner erasure of a revoked visitor (app_owner_erasure_apply) inside a held project.'),
 'schema/platform.sql::app_documents':blocked('safety_hold_visitor_retained','Only reached through app_visitors deletion, which the hold refuses.'),
 'schema/platform.sql::app_runs':blocked('safety_hold_visitor_retained','Only reached through app_visitors deletion, which the hold refuses.'),
 'schema/platform.sql::app_auth_challenges':excluded(credential),
 'schema/platform.sql::app_invitations':excluded(credential),
 'schema/platform.sql::app_passkeys':excluded(credential),
 'schema/platform.sql::app_recovery_codes':excluded(credential),
 'schema/platform.sql::app_sessions':excluded(credential),
 'schema/platform.sql::app_recovery_documents':excluded('Point-in-time copies cleared by visitor revocation or recovery-point removal. Revocation is a security control that must not fail visibly; the primary visitor document stays because visitor deletion is blocked. Capturing earlier copies needs an owner decision (see owner questions).'),
 'schema/platform.sql::app_migration_documents':excluded('Transient migration outputs; the primary visitor documents are retained.'),
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
 'src/fair-use-observation.ts::fair_use_project_lifecycle':excluded('Platform economics observation of removed projects; no customer content.'),
 'src/funnel-metrics/events.ts::funnel_events':excluded('Content-free consented measurement events; bounded expiry is a privacy commitment, not customer content.'),
 'src/profile.ts::funnel_events':excluded('Measurement-consent withdrawal must be honoured; events are content-free.'),
 'src/project-specification/store.ts::project_spec_proposals':excluded(proposals),
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
 'visitor document overwrite by app runs, app recovery restore or migration apply':{decision:'excluded',rationale:'Ordinary service operation, not deletion; freezing it would disclose the hold. Primary documents and recovery points remain; capture of a point-in-time copy is an owner question.'},
 'website unpublish / publication withdrawal':{decision:'excluded',rationale:'No data is deleted; saved versions stay and are covered by the version hold.'},
 'Cloudflare D1 Time Travel / provider-managed backups ageing':{decision:'excluded',rationale:'Provider-managed point-in-time history, not an ordinary Whumpo deletion path; held current data is retained in place.'},
 'native CMS resources and GitHub backups in customer-owned Cloudflare/GitHub accounts':{decision:'excluded',rationale:'External customer-owned resources Whumpo cannot preserve; CMS testing is owner-deferred. Withdrawal/deletion of these is not a Whumpo cleanup path.'},
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
