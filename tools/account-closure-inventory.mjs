import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';

// Static SQL fragments only. Caller input is bound once in the scope CTE.
const metrics={
 accounts:['users','id'], projects:['projects','owner_user_id'],
 liveProjects:['project_service_status','owner_user_id','site_live=1 OR backend_live=1 OR cms_articles>0'],
 sessions:['sessions','user_id'], chatTurns:['chat_turns','user_id'],
 chatReviewReceipts:['chat_review_receipts','user_id'],
 compositionPlans:['composition_plans','user_id'],
 specificationProposals:['project_spec_proposals','user_id'],
 specificationSnapshots:['project_spec_versions','project_id IN (SELECT id FROM owned_projects)'],
 specificationSaveReceipts:['project_spec_applies','user_id'],
 serviceClientProposals:['service_client_proposals','user_id'],
 serviceClientSnapshots:['service_client_versions','project_id IN (SELECT id FROM owned_projects)'],
 serviceClientSaveReceipts:['service_client_applies','user_id'],
 serviceActivationReceipts:['service_client_activation_reviews','user_id'],
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
 riskEvidence:['content_risk_evidence','user_id'], riskCorrections:['content_risk_reversals','user_id'],
 scanTickets:['photo_scan_tickets','user_id'],
 pendingScanTickets:['photo_scan_tickets','user_id',"state='reserved'"],
 unresolvedStandardAI:['standard_ai_requests','user_id',"state IN ('reserved','dispatched','uncertain')"],
 usedInvitations:['invitations','used_by'],
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
   'Provider resources, R2 objects and backups have not been reconciled. Row counts are not resource counts.',
   'Saved configuration/proposal counts include full content copies. Metadata receipt counts do not prove independent restore suppression or safe deletion order.',
   'No legal-hold or retention decision has been established; zero blocked records does not establish clearance.',
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
 }catch{console.error('Account closure inventory unavailable. Check authorization and migrations. Nothing was changed.');process.exitCode=1;}
}
