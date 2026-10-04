import assert from 'node:assert/strict';
import {build} from 'esbuild';
// Synthetic current fixtures use the actual transaction builders. Never seed an
// unversioned page or provide an adapter for retired product actions.
// Callers obtain authority exports from this same bundle: admission capabilities
// are module-private and cannot be passed between separately bundled runtimes.
let module;
export async function currentSiteFixtureHandlers(){
 if(!module){const b=await build({stdin:{contents:`
  export {default as worker} from './src/index';
  export {comparisonErrorResponse} from './src/comparison-page';
  export {hashToken,newSessionToken} from './src/security';
  export {admitWorkspace} from './src/workspace-identity/admission';
  export {resolveIdentity} from './src/workspace-identity/authority';
  export {createWebsite,prepareSpecification,readSpecificationProposal,readSpecification,specificationPreview,applySpecificationCommand} from './src/project-specification/store';
  export {readChat,sendChat,sendChatControl,sendConversation,chatState} from './src/chat';
  export {chatControl,confirmationControls} from './src/chat-controls';
  export {agentPrompt} from './src/site-agent';
  export {reviewBackup,confirmBackup,listBackups,githubRepositories} from './src/github-backups';
  export * from './src/project-specification/compiler';
  export {ownedPreview} from './src/photo-versions';
  export * as guestPreviews from './src/guest-previews/owner';
  export * as guestPreviewPolicy from './src/guest-previews/policy';
  export * as guestPreviewBindings from './src/guest-previews/bindings';
  export {readViewBinding,readSavedViewComponent} from './src/workspace-view-bindings';
  export {readTemporaryViewComponent} from './src/chat-interactions/view-cards';
  export {prepareWorkspaceView,readInteraction} from './src/chat-interactions/store';
  export {bindings as interactionBindings} from './src/chat-interactions/protocol';
  export {readViewComponentData} from './src/workspace-view-data';
  export {reserveStorage} from './src/storage-budget';
  export {ownedExport} from './src/exports';
  export {seal} from './src/connection-vault';
  export {sendAIChat,reconcileChat} from './src/ai-chat';
  export {uploadPhoto,readPhotoUpload,readPhoto,listPhotos,cleanupPhotos} from './src/files';
export {cleanPhoto} from './src/photo-format';
  export {compareVersions,compareReview,diffPage} from './src/version-diff';
  export {renderSite} from './src/components';
  export * as backend from './src/backend-versions';
  export * as backendLibrary from './src/backend-library';
  export * as capabilityCatalog from './src/capability-catalog';
  export * as compositionPlans from './src/composition-plans';
  export * as backendNominations from './src/backend-nominations';
  export * as appPageDesign from './src/app-page-design';
  export {applicationChatActions} from './src/app-chat-actions';
  export {linkChatReviewReply} from './src/chat-review-receipts';
  export {readOnboarding,saveOnboarding,completeOnboarding} from './src/onboarding';
  export {agentProfile,readProfile,updateProfile} from './src/profile';
  export * as usageReviews from './src/usage-review-requests';
  export {customerEligibilityVersion} from './src/content-policy';
  export {identityCookies} from './src/workspace-identity/http';
  export {describeConnections} from './src/connection-chat';
  export * as serviceClientCompiler from './src/project-specification/service-clients/compiler';
  export * as serviceClientOwned from './src/project-specification/service-clients/owned';
  export {publicationCommand} from './src/publications';
  export {versionRemovalCommand} from './src/version-removal';
  export * as contacts from './src/contacts';
  export * as contactNotifications from './src/contact-notifications';
  export * as directory from './src/directory';
  export {contactPage} from './src/contact-page';
  export {welcomeDraftProject} from './src/first-draft';
  export {inspectionRequest,inspectionMessages} from './src/agent-inspection';
  export * as backendDiff from './src/backend-diff';
  export * as backendPublication from './src/backend-publication';
  export * as backendForms from './src/backend-forms';
  export * as backendFormRender from './src/backend-form-render';
  export * as backendState from './src/backend-state';
  export * as backendChat from './src/backend-chat';
  export * as backendImports from './src/backend-imports';
  export * as appActivation from './src/app-activation';
  export * as appAuth from './src/app-auth';
  export * as appData from './src/app-data';
  export * as appPages from './src/app-pages';
  export * as appGateway from './src/app-gateway';
  export * as appRecovery from './src/app-recovery';
  export * as appDocumentRecovery from './src/app-document-recovery';
  export * as appMigrationChecks from './src/app-migration-checks';
  export * as appMigrationApproval from './src/app-migration-approval';
  export * as appProgramRollback from './src/app-program-rollback';
  export * as appMaintenanceList from './src/app-maintenance-list';
  export {appRecoveryChatActions} from './src/app-recovery-chat-actions';
  export {describeAppRestore} from './src/app-recovery-chat';
  export {appMaintenanceChatActions} from './src/app-maintenance-chat-actions';
  export * as appLifecycle from './src/app-lifecycle';
  export {default as appHost} from './src/app-host';
  export {default as host} from './src/site-host';
  export {hostname,verifyDNS,listDomains} from './src/domains';
  export {reviewHosting,confirmHosting,disconnectHosting,refreshHosting,hostingConnections} from './src/domain-hosting';
  export {inspectRecovery,applyRecovery} from './src/domain-recovery';
  export {listDNSActions} from './src/cloudflare-dns';
  export {siteContext,prepareSiteAction,agentWorkspaceData} from './src/site-agent';
  export {readAgentKnowledge,knowledgeTopics} from './src/agent-knowledge';
  export {exportChatTranscript} from './src/chat-transcript';
  export {checkHealth,listHealth,maintainHealth} from './src/site-health';
  export {readTraffic,recordTraffic,cleanupTraffic,measureTraffic,trafficClass,pendingMeasurementGaps,MAX_IN_FLIGHT} from './src/site-traffic';
  export * as siteDiagnostics from './src/site-diagnostics';
  export {getBilling} from './src/billing';
  export {prepareLayoutChange,mutateLayout,readLayoutReceipt,readLayoutHistory} from './src/workspace-layout';
  export {readLayout,saveCapacity,readCapacity,dashboardData,workspaceAction} from './src/workspace-dashboard';
  export {readProjectDetails,saveProjectDetails} from './src/project-details';
  export {inspectWorkspace} from './src/workspace-read';
  export {shortcutCommand,workspaceShortcuts} from './src/workspace-shortcuts';
  export {planChangeQuote,capacityNotice,overageNotice,recommendPlan} from './src/capacity-policy';
  export {plans,publicPlans,quoteDomainBenefit} from './src/plans';
 `,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});module=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].contents).toString('base64'));}
 return module;
}
async function saveProposal(db,user,turn,prepared){
 const m=await currentSiteFixtureHandlers(),revision=(await m.readChat(db,user)).state.revision,now=new Date().toISOString();
 await db.batch([
  db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES(?,?,?,'Synthetic current website fixture','','ai','pending',?)").bind(turn,user,revision+1,now),
  ...prepared.statements,
  db.prepare("UPDATE chat_turns SET assistant_text=?,status='completed' WHERE id=?").bind(prepared.reply,turn),
  db.prepare('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?').bind(user)
 ]);
}
export async function createFixtureWebsite(db,user,project,config){
 const m=await currentSiteFixtureHandlers(),turn=crypto.randomUUID(),prepared=await m.createWebsite(db,user,turn,project,config);await saveProposal(db,user,turn,prepared);return turn;
}
export async function changeFixtureWebsite(db,user,project,operations){
 const m=await currentSiteFixtureHandlers(),turn=crypto.randomUUID(),head=await db.prepare('SELECT revision FROM project_spec_heads WHERE project_id=?').bind(project).first();assert.ok(head);
 await saveProposal(db,user,turn,await m.prepareSpecification(db,user,turn,{kind:'specification',operation:'change',projectId:project,expectedRevision:head.revision,operations}));
 const q=await m.readSpecificationProposal(db,user,turn),version=crypto.randomUUID(),revision=(await m.readChat(db,user)).state.revision;
 assert.equal((await m.sendChatControl(db,user,{id:version,revision,action:{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision}})).status,200);return version;
}

export async function createFixtureProject(db,user,name,purpose,theme='ocean'){
 const project=crypto.randomUUID(),now=new Date().toISOString();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?)").bind(project,user,name,purpose,now,now).run();
 const version=await createFixtureWebsite(db,user,project,{name,headline:name,description:purpose,theme,aboutTitle:'About us',aboutText:purpose,sections:[],photos:[]});
 return {project,version};
}
