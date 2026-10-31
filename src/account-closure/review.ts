/** WH-018 slice 1: the account closure review. Pure functions over plain data (the inventory counts of
 * tools/account-closure-inventory.mjs and the classes of docs/data-lifecycle.json passed in by the caller). No storage,
 * route, provider call or Worker import. The review states what a closure would cancel, delete or retain and why; it
 * is not an authorization to delete, and the proposed retention windows it quotes are unapproved. */

export class ClosureError extends Error {
 constructor(readonly code:string,readonly detail=''){super(detail?`${code}: ${detail}`:code);this.name='ClosureError';}
}
export function check(condition:unknown,code:string,detail=''):asserts condition {
 if(!condition)throw new ClosureError(code,detail);
}
export const plain=(value:unknown):value is Record<string,unknown>=>
 !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;

export const contractVersion=1;
export type Disposition='cancel'|'delete'|'retain';
export type LifecycleClass={id:string;tables:readonly string[];proposedRetention?:string};
export type Counts=Record<string,number>;
export type ReviewItem={key:string;table:string;classId:string;disposition:Disposition;count:number;reason:string;proposedRetention:string};
export type ClosureReview={contractVersion:1;items:ReviewItem[];blockers:string[];digest:string};

const reasons={
 cancel:'Open or in-flight work is cancelled or revoked before any deletion.',
 delete:'Purged with the account after export and settlement; no tombstone in the deleted scope.',
 hold:'Retained: an active preservation hold blocks deletion until an audited release.',
 retain:'Retained outside the account cascade under its safety or invitation class.',
} as const;
/** inventory key -> [table, lifecycle class id, disposition]. A key missing here fails the review (unknown-category).
 * Subset keys (unresolved/open/pending) repeat their parent table as 'cancel' next to the parent's 'delete'. */
const c:Record<string,[string,string,Disposition]>={
 featurePreviewGrants:['feature_preview_grants','feature-preview-authority','delete'],
 accounts:['users','owner-identity','delete'],
 projects:['projects','projects','delete'],
 liveProjects:['projects','projects','cancel'],
 identityAccounts:['identity_accounts','owner-identity-progress','delete'],
 identityAttempts:['identity_attempts','owner-identity-progress','delete'],
 identityCredentials:['identity_credentials','owner-identity-progress','delete'],
 identitySessions:['identity_sessions','owner-identity-admission','cancel'],
 identityHandoffs:['identity_handoffs','owner-identity-admission','cancel'],
 identityGrants:['identity_grants','owner-identity-admission','cancel'],
 identityChallenges:['identity_challenges','owner-identity-admission','cancel'],
 identityCeremonyReceipts:['identity_ceremony_receipts','owner-identity-receipts','delete'],
 identityKitOffers:['identity_kit_offers','owner-identity-kits','delete'],
 identityEffectReceipts:['identity_effect_receipts','owner-identity-receipts','delete'],
 identityRecoveryReviews:['identity_recovery_reviews','owner-identity-receipts','delete'],
 chatTurns:['chat_turns','conversation','delete'],
 chatConversations:['chat_conversations','chat-interactions','delete'],
 chatInteractionTasks:['chat_interaction_tasks','chat-interactions','delete'],
 chatTaskProgress:['chat_task_progress','chat-interactions','delete'],
 chatInteractions:['chat_interactions','chat-interactions','delete'],
 chatInteractionRequests:['chat_interaction_requests','chat-interactions','delete'],
 chatInteractionSubmissions:['chat_interaction_submissions','chat-interactions','delete'],
 chatInteractionContinuations:['chat_interaction_continuations','chat-interactions','delete'],
 unresolvedChatInteractionContinuations:['chat_interaction_continuations','chat-interactions','cancel'],
 chatReviewReceipts:['chat_review_receipts','conversation','delete'],
 compositionPlans:['composition_plans','backend-artifacts','delete'],
 specificationProposals:['project_spec_proposals','project-configurations','delete'],
 specificationSnapshots:['project_spec_versions','project-configurations','delete'],
 specificationCreationReceipts:['project_spec_creations','configuration-authority','delete'],
 specificationSaveReceipts:['project_spec_applies','configuration-authority','delete'],
 serviceClientProposals:['service_client_proposals','project-configurations','delete'],
 serviceClientSnapshots:['service_client_versions','project-configurations','delete'],
 serviceClientSaveReceipts:['service_client_applies','configuration-authority','delete'],
 serviceActivationReceipts:['service_client_activation_reviews','configuration-authority','delete'],
 unresolvedConnectionExchanges:['connection_oauth_exchanges','connections','cancel'],
 connectionOutcomeReceipts:['connection_oauth_outcomes','connections','delete'],
 githubRefreshCustody:['github_refresh_custody','connections','cancel'],
 githubGrantReviews:['github_grant_revocations','connections','delete'],
 githubGrantUncertain:['github_grant_revocations','connections','cancel'],
 githubCredentials:['github_token_vault','connections','cancel'],
 cloudflareCredentials:['cloudflare_token_vault','connections','cancel'],
 githubStagedCredentials:['github_token_vault','connections','cancel'],
 githubPendingRevocations:['github_token_vault','connections','cancel'],
 cloudflarePendingRevocations:['cloudflare_token_vault','connections','cancel'],
 githubAuthorizationAttempts:['github_oauth_states','connections','cancel'],
 cloudflareAuthorizationAttempts:['cloudflare_oauth_states','connections','cancel'],
 domainRecords:['domain_connections','domains-dns','cancel'],
 unresolvedDomainRecords:['domain_connections','domains-dns','cancel'],
 cmsInstances:['cms_instances','cms-resources','cancel'],
 cmsResourceRecords:['cms_resource_jobs','cms-resources','cancel'],
 projectFileRecords:['project_files','project-media','delete'],
 profilePhotos:['user_profiles','profile-workspace','delete'],
 cmsMediaRecords:['cms_media_uploads','cms-media-imports','delete'],
 cmsImportFiles:['cms_wordpress_sources','cms-media-imports','delete'],
 backendImports:['backend_imports','import-quarantine','delete'],
 blockedBackendImports:['backend_imports','import-quarantine','retain'],
 blockedProfilePhotos:['profile_photo_safety','safety-checks','retain'],
 blockedProjectPhotos:['project_photo_safety','safety-checks','retain'],
 blockedCMSMedia:['cms_media_safety','safety-checks','retain'],
 riskEvidence:['content_risk_evidence','safety-cases','retain'],
 riskCorrections:['content_risk_reversals','safety-cases','retain'],
 activePreservationHolds:['safety_preservation_holds','restricted-safety-cases','retain'],
 scanTickets:['photo_scan_tickets','safety-checks','delete'],
 pendingScanTickets:['photo_scan_tickets','safety-checks','cancel'],
 unresolvedStandardAI:['standard_ai_requests','standard-ai','cancel'],
 usedInvitations:['invitations','identity-invitations','retain'],
 funnelEvents:['funnel_events','product-measurement','delete'],
 guestPreviewLinks:['guest_preview_links','guest-feedback','delete'],
 activeGuestPreviewLinks:['guest_preview_links','guest-feedback','cancel'],
 guestPreviewFeedback:['guest_preview_feedback','guest-feedback','delete'],
 moduleInstances:['module_instances','module-registry','delete'],
 activeModuleInstances:['module_instances','module-registry','cancel'],
 moduleActivationReceipts:['module_activation_applies','module-registry','delete'],
 moduleRequestReceipts:['module_request_receipts','module-registry','delete'],
 staffRoles:['module_access_roles','project-roles','cancel'],
 accessRoleReceipts:['module_access_role_applies','project-roles','delete'],
 moduleRecords:['module_records','module-records','delete'],
 moduleRecordFiles:['module_record_files','module-records','delete'],
 moduleRecordLeads:['module_record_leads','module-records','delete'],
 moduleFiles:['module_files','module-files','delete'],
 staffNotificationOptins:['staff_notification_optins','contact-notifications','delete'],
 visitorNotificationAddresses:['visitor_notification_addresses','contact-notifications','delete'],
 costEvents:['cost_events','cost-events','delete'],
 emailChanges:['owner_email_changes','owner-email-changes','delete'],
 openEmailChanges:['owner_email_changes','owner-email-changes','cancel'],
 emailChangeLimits:['owner_email_change_limits','owner-email-change-limits','delete'],
 securityReviews:['owner_security_reviews','owner-security-reviews','delete'],
 lookupConsents:['lookup_consents','connector-receipts','delete'],
 openLookupConsents:['lookup_consents','connector-receipts','cancel'],
 connectorReceipts:['connector_receipts','connector-receipts','delete'],
 openConnectorReceipts:['connector_receipts','connector-receipts','cancel'],
 ruleApprovals:['rule_approvals','connector-receipts','delete'],
 activeRuleApprovals:['rule_approvals','connector-receipts','cancel'],
 notificationNotices:['notification_notices','contact-notifications','delete'],
 notificationConfigurations:['notification_configurations','contact-notifications','delete'],
 notificationConfigurationReviews:['notification_configuration_reviews','contact-notifications','delete'],
 pushDevices:['push_devices','contact-notifications','delete'],
 pushEvents:['push_events','contact-notifications','delete'],
 jobJournal:['job_journal','job-journal','delete'],
 openJobJournal:['job_journal','job-journal','cancel'],
 unresolvedJobs:['job_journal','job-journal','cancel'],
};
export const closureCategories:Readonly<Record<string,readonly [string,string,Disposition]>>=Object.freeze(c);
/** Open provider work: closure refuses until each settles (cancelling a local row never settles a provider effect). */
export const settleFirstKeys:readonly string[]=Object.freeze(['unresolvedStandardAI','unresolvedConnectionExchanges','githubGrantUncertain','githubPendingRevocations','cloudflarePendingRevocations','unresolvedDomainRecords','unresolvedChatInteractionContinuations','unresolvedJobs','openConnectorReceipts']);

export const isCount=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
/** Every category present as a non-negative integer, nothing unknown. */
export function checkCounts(counts:unknown):asserts counts is Counts {
 check(plain(counts),'invalid-inventory','counts must be a plain object');
 for(const key of Object.keys(c))check(isCount(counts[key]),'invalid-inventory',key);
 for(const key of Object.keys(counts))check(Object.hasOwn(c,key),'unknown-category',key);
}

export function buildReview(counts:unknown,classes:unknown):ClosureReview {
 checkCounts(counts);
 check(Array.isArray(classes),'invalid-lifecycle');
 const byId=new Map((classes as LifecycleClass[]).map(x=>[x.id,x]));
 const items:ReviewItem[]=[];
 for(const [key,[table,classId,disposition]] of Object.entries(c)){
  const count=counts[key];if(!count)continue;
  const cls=byId.get(classId);
  check(cls&&cls.tables.includes(table),'unknown-class',`${key} -> ${classId}`);
  items.push({key,table,classId,disposition,count,
   reason:key==='activePreservationHolds'?reasons.hold:reasons[disposition],
   proposedRetention:cls.proposedRetention??'unapproved'});
 }
 const blockers:string[]=[];
 if(counts.activePreservationHolds)blockers.push('preservation-hold');
 if(settleFirstKeys.some(k=>counts[k]))blockers.push('provider-work-open');
 // Canonical text: the owner confirms exactly this review, and a changed inventory changes it.
 const digest=JSON.stringify(items.map(i=>[i.key,i.count,i.disposition]));
 return {contractVersion:1,items,blockers,digest};
}
