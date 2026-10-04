/** WH-009/WH-018 account closure inventory: one read-only aggregate SELECT over the control database. Shared by the
 * operator CLI (tools/account-closure-inventory.mjs) and the customer closure review (closure.ts), so the review counts
 * exactly what the operator inventory counts. Static SQL fragments only; the account id is bound once in the scope CTE.
 * No credential, identity, source code, Chat text, filename, object key or provider identifier is returned. */
// Static SQL fragments only. Caller input is bound once in the scope CTE.
export const closureMetrics:Record<string,readonly [string,string,string?]>={
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
 // WH-018 closure classification. Rows with non-cascading account/project references need their own reviewed
 // teardown (owner action) or operator reconciliation (retained finance/revocation records) before the purge.
 visitorApplications:['app_spaces','owner_user_id'],
 backendPublicationReviews:['backend_publication_reviews','user_id'],
 backendFormReviews:['backend_form_reviews','user_id'],
 backendFormSettings:['backend_form_settings','project_id IN (SELECT id FROM owned_projects)'],
 appActivationReviews:['app_activation_reviews','user_id'],
 gatewaySpendBuckets:['gateway_spend_buckets','user_id'],
 gatewaySpendAttempts:['gateway_spend_attempts','user_id'],
 connectionRotationGuards:['connection_rotation_guards','owner_id'],
 uncertainGitHubBackups:['github_backups','user_id',"state IN ('dispatching','uncertain')"],
 githubBackupRepositories:['(SELECT DISTINCT user_id,repo_owner,repo_name FROM github_backups WHERE state=\'complete\')','user_id'],
};
export const closureInventorySQL=`WITH scope AS (SELECT id FROM users WHERE (?1 IS NULL OR id=?1)),
 owned_projects AS (SELECT id FROM projects WHERE owner_user_id IN (SELECT id FROM scope))
 SELECT ${Object.entries(closureMetrics).map(([name,[table,owner,condition]])=>
 `(SELECT COUNT(*) FROM ${table} WHERE ${owner.includes(' IN ')?owner:`${owner} IN (SELECT id FROM scope)`}${condition?` AND (${condition})`:''}) AS ${name}`).join(',\n')}`;


export type ClosureCounts=Record<string,number>;
/** Counts for every metric, or a thrown error: missing schema, failed queries and invalid counts never read as zero.
 * With an account id, an unknown account fails rather than returning a reassuring empty report. */
export async function closureCounts(db:Pick<D1Database,'prepare'>,userId:string|null):Promise<ClosureCounts>{
 if(userId!==null&&(typeof userId!=='string'||!userId.length||userId.length>128))throw Error('Invalid account scope');
 const row=await db.prepare(closureInventorySQL).bind(userId).first<Record<string,unknown>>();
 if(!row||Object.keys(closureMetrics).some(key=>!Number.isSafeInteger(row[key])||(row[key] as number)<0))throw Error('Closure inventory unavailable');
 if(userId!==null&&row.accounts!==1)throw Error('Account scope unavailable');
 return Object.fromEntries(Object.keys(closureMetrics).map(key=>[key,row[key] as number]));
}
