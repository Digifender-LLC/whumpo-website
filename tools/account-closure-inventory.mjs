import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';

// Static SQL fragments only. Caller input is bound once in the scope CTE.
const metrics={
 featurePreviewGrants:['feature_preview_grants','user_id'],
 accounts:['users','id'], projects:['projects','owner_user_id'],
 liveProjects:['project_service_status','owner_user_id','site_live=1 OR backend_live=1 OR cms_articles>0'],
 identityAccounts:['identity_accounts','account_id'],
 identityAttempts:['identity_attempts','account_id'],
 identityCredentials:['identity_credentials','account_id'],
 identitySessions:['identity_sessions','account_id'],
 identityGrants:['identity_grants','account_id'],
 identityChallenges:['identity_challenges','account_id'],
 identityCeremonyReceipts:['identity_ceremony_receipts','account_id'],
 identityKitOffers:['identity_kit_offers','account_id'],
 identityEffectReceipts:['identity_effect_receipts','account_id'],
 identityRecoveryReviews:['identity_recovery_reviews','account_id'],
 chatTurns:['chat_turns','user_id'],
 chatConversations:['chat_conversations','user_id'],
 chatInteractionTasks:['chat_interaction_tasks','user_id'],
 chatTaskProgress:['chat_task_progress','user_id'],
 chatInteractions:['chat_interactions','user_id'],
 chatInteractionRequests:['chat_interaction_requests','user_id'],
 chatInteractionSubmissions:['chat_interaction_submissions','user_id'],
 chatInteractionContinuations:['chat_interaction_continuations','id IN (SELECT id FROM chat_interaction_submissions WHERE user_id IN (SELECT id FROM scope))'],
 unresolvedChatInteractionContinuations:['chat_interaction_continuations','id IN (SELECT id FROM chat_interaction_submissions WHERE user_id IN (SELECT id FROM scope))',"state IN ('pending','unknown')"],
 chatReviewReceipts:['chat_review_receipts','user_id'],
 compositionPlans:['composition_plans','user_id'],
 specificationProposals:['project_spec_proposals','user_id'],
 specificationSnapshots:['project_spec_versions','project_id IN (SELECT id FROM owned_projects)'],
 specificationCreationReceipts:['project_spec_creations','user_id'],
 specificationSaveReceipts:['project_spec_applies','user_id'],
 serviceClientProposals:['service_client_proposals','user_id'],
 serviceClientSnapshots:['service_client_versions','project_id IN (SELECT id FROM owned_projects)'],
 serviceClientSaveReceipts:['service_client_applies','user_id'],
 serviceActivationReceipts:['service_client_activation_reviews','user_id'],
 unresolvedConnectionExchanges:['connection_oauth_exchanges','user_id'],
 connectionOutcomeReceipts:['connection_oauth_outcomes','user_id'],
 githubRefreshCustody:['github_refresh_custody','user_id'],
 githubGrantReviews:['github_grant_revocations','user_id'],
 githubGrantUncertain:['github_grant_revocations','user_id',"state IN ('dispatching','uncertain')"],
 githubCredentials:['github_token_vault','user_id'], cloudflareCredentials:['cloudflare_token_vault','user_id'],
 githubStagedCredentials:['github_token_vault','user_id','EXISTS(SELECT 1 FROM github_token_staging WHERE token_id=github_token_vault.id)'],
 githubPendingRevocations:['github_token_vault','user_id',"state='revoking'"],
 cloudflarePendingRevocations:['cloudflare_token_vault','user_id',"state='revoking'"],
 githubAuthorizationAttempts:['github_oauth_states','user_id'], cloudflareAuthorizationAttempts:['cloudflare_oauth_states','user_id'],
 domainRecords:['domain_connections','user_id'],
 unresolvedDomainRecords:['domain_connections','user_id',"state NOT IN ('review','disconnected')"],
 cmsInstances:['cms_instances','user_id'],
 cmsResourceRecords:['cms_resource_jobs','project_id IN (SELECT id FROM owned_projects)'],
 projectFileRecords:['project_files','project_id IN (SELECT id FROM owned_projects)'],
 profilePhotos:['user_profiles','user_id','photo IS NOT NULL'],
 cmsMediaRecords:['cms_media_uploads','user_id'], cmsImportFiles:['cms_wordpress_sources','user_id'],
 backendImports:['backend_imports','user_id'],
 blockedBackendImports:['backend_imports','user_id',"state='blocked'"],
 blockedProfilePhotos:['profile_photo_safety','user_id',"state='blocked'"],
 blockedProjectPhotos:['project_photo_safety','user_id',"state='blocked'"],
 blockedCMSMedia:['cms_media_safety','user_id',"state='blocked'"],
 riskEvidence:['content_risk_evidence','user_id'], riskCorrections:['content_risk_reversals','user_id'],
 activePreservationHolds:['safety_preservation_holds','subject_user_id','released_at IS NULL'],
 scanTickets:['photo_scan_tickets','user_id'],
 pendingScanTickets:['photo_scan_tickets','user_id',"state='reserved'"],
 unresolvedStandardAI:['standard_ai_requests','user_id',"state IN ('reserved','dispatched','uncertain')"],
 usedInvitations:['invitations','used_by'],
 funnelEvents:['funnel_events','user_id'],
 guestPreviewLinks:['guest_preview_links','owner_user_id'],
 activeGuestPreviewLinks:['guest_preview_links','owner_user_id','revoked_at IS NULL AND expires_at>unixepoch() AND version_id IS NOT NULL'],
 guestPreviewFeedback:['guest_preview_feedback','link_id IN (SELECT id FROM guest_preview_links WHERE owner_user_id IN (SELECT id FROM scope))'],
 moduleInstances:['module_instances','project_id IN (SELECT id FROM owned_projects)'],
 activeModuleInstances:['module_instances','project_id IN (SELECT id FROM owned_projects)',"EXISTS(SELECT 1 FROM module_activations a WHERE a.instance_id=module_instances.id AND a.state='active')"],
 moduleActivationReceipts:['module_activation_applies','user_id'],
 moduleRequestReceipts:['module_request_receipts','project_id IN (SELECT id FROM owned_projects)'],
 staffRoles:['module_access_roles','project_id IN (SELECT id FROM owned_projects)',"state='granted'"],
 accessRoleReceipts:['module_access_role_applies','user_id'],
 moduleRecords:['module_records','project_id IN (SELECT id FROM owned_projects)'],
 moduleFiles:['module_files','project_id IN (SELECT id FROM owned_projects)'],
 // WH-170: shadow cost events deleted with the account and its projects (no tombstones). WH-201: the account's address changes
 // (open ones and undo reservations), rate-limit evidence and compromise-review records, all deleted with the account.
 costEvents:['cost_events','owner_id'],
 emailChanges:['owner_email_changes','account_id'],
 openEmailChanges:['owner_email_changes','account_id',"state='pending' OR (state='confirmed' AND undo_until>unixepoch()*1000)"],
 emailChangeLimits:['owner_email_change_limits','account_id'],
 securityReviews:['owner_security_reviews','account_id'],
 // WH-143: lookup consents (open ones are unexpired, unused) and connector receipts (open ones may still hold a provider effect), deleted with the account.
 lookupConsents:['lookup_consents','owner_id'],
 openLookupConsents:['lookup_consents','owner_id',"state IN ('issued','confirmed') AND expires_at>unixepoch()*1000"],
 connectorReceipts:['connector_receipts','owner_id'],
 openConnectorReceipts:['connector_receipts','owner_id',"state IN ('review','dispatching','uncertain')"],
};
export const closureInventorySQL=`WITH scope AS (SELECT id FROM users WHERE (?1 IS NULL OR id=?1)),
 owned_projects AS (SELECT id FROM projects WHERE owner_user_id IN (SELECT id FROM scope))
 SELECT ${Object.entries(metrics).map(([name,[table,owner,condition]])=>
 `(SELECT COUNT(*) FROM ${table} WHERE ${owner.includes(' IN ')?owner:`${owner} IN (SELECT id FROM scope)`}${condition?` AND (${condition})`:''}) AS ${name}`).join(',\n')}`;

export async function accountClosureInventory(db,userId=null){
 if(userId!==null&&(typeof userId!=='string'||!userId.length||userId.length>128))throw Error('Invalid account scope');
 const row=await db.prepare(closureInventorySQL).bind(userId).first();
 if(!row||Object.keys(metrics).some(key=>!Number.isSafeInteger(row[key])||row[key]<0))throw Error('Closure inventory unavailable');
 if(userId!==null&&row.accounts!==1)throw Error('Account scope unavailable');
 const counts=Object.fromEntries(Object.keys(metrics).map(key=>[key,row[key]]));
 return {observedAt:new Date().toISOString(),scope:userId===null?'platform_aggregate':'single_account',counts,
  readyForDeletion:false,
  limitations:[
   'Read-only control-database snapshot; not a complete data export or deletion authorization.',
   'Identity counts cover rows linked to extant accounts; anonymous login/signup challenges and detached effect receipts need separate platform retention.',
   'Provider resources, R2 objects and backups have not been reconciled. Row counts are not resource counts.',
   'Saved configuration/proposal counts include full content copies. Metadata receipt counts do not prove independent restore suppression or safe deletion order.',
   'An active preservation hold blocks the account cascade until its audited release. Zero active holds or blocked records does not establish legal clearance.',
   'Account closure, provider cancellation and restore-safe deletion orchestration are not implemented.',
  ]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==2)throw Error('Unexpected arguments');
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const credentials=process.env.CLOUDFLARE_API_TOKEN?{type:'api_token',token:process.env.CLOUDFLARE_API_TOKEN}:undefined;
  const api=cloudflareClient(config.account_id,fetch,credentials);
  const db=remoteD1(api,config.d1_databases.find(b=>b.binding==='DB').database_id);
  console.log(JSON.stringify(await accountClosureInventory(db),null,2));
 }catch{console.error('Account closure inventory unavailable. Check authorization and the complete current schema. Nothing was changed.');process.exitCode=1;}
}
