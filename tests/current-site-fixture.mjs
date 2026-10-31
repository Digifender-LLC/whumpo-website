import assert from 'node:assert/strict';
import {build} from 'esbuild';
// Synthetic current fixtures use the actual transaction builders. Never seed an
// unversioned page or provide an adapter for retired product actions.
// Callers obtain authority exports from this same bundle: admission capabilities
// are module-private and cannot be passed between separately bundled runtimes.
let module;
// WH-004 R2: the SQL confirm triggers accept only a guided turn that carries the typed confirm control for the exact review, which is what the UI
// sends. Offline suites still type `/confirm <id>`; this wrapper stores the equivalent guided control turn for those six commands (same handler and reply as before, no extra receipt precheck) and leaves everything else alone.
const confirmKinds={'/confirm':'site','/confirm-contact':'contact','/confirm-contact-notify':'contactNotification','/confirm-photo-delete':'photo','/confirm-version-delete':'version','/confirm-notification-setup':'notificationConfiguration'};
export const confirmControlFor=content=>{const [verb,review,...rest]=String(content??'').trim().split(/\s+/);return !rest.length&&Object.hasOwn(confirmKinds,verb)&&/^[0-9a-f-]{36}$/.test(review??'')?{type:'confirm',kind:confirmKinds[verb],reviewId:review}:undefined;};
const withTypedConfirms=m=>({...m,sendChat:(db,user,input,ai,options,conversationOnly,control)=>{const typed=!control&&!conversationOnly?m.chatControl(confirmControlFor(input?.content)):undefined;return typed?m.sendChat(db,user,{...input,content:typed.command},ai,options,false,typed):m.sendChat(db,user,input,ai,options,conversationOnly,control);}});
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
  export * as sharedModules from './src/shared-modules/api';
  export * as moduleRegistry from './src/shared-modules/registry';
  export * as moduleActivation from './src/shared-modules/activation';
  export * as moduleAccess from './src/shared-modules/access';
  export * as moduleAccessRoles from './src/shared-modules/access-roles';
  export * as moduleAccessExport from './src/shared-modules/access-export';
  export * as moduleRecordsExport from './src/shared-modules/records-export';
  export * as moduleFilesExport from './src/shared-modules/files-export';
  export * as accessSetup from './src/shared-modules/access-setup';
  export {readAppAccess} from './src/app-access';
  export * as appResource from './src/app-resource';
  export * as sharedModuleRecords from './src/shared-modules/records';
  export * as sharedModuleFiles from './src/shared-modules/files';
  export * as sharedModuleCollections from './src/shared-modules/collections';
  export {photoRemovalCommand} from './src/photo-removal';
  export * as modulePolicy from './src/shared-modules/policy';
  export {moduleCatalog} from './src/project-specification/catalog';
  export {moduleCompositions} from './src/module-compositions';
  export {validateSpecification} from './src/project-specification/v3/schema';
  export {jsonDigest} from './src/project-specification/v2/json';
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
  export * as serviceClientStore from './src/project-specification/service-clients/store';
  export {publicationCommand} from './src/publications';
  export {versionRemovalCommand} from './src/version-removal';
  export * as contacts from './src/contacts';
  export * as contactNotifications from './src/contact-notifications';
  export * as notificationRecipients from './src/notification-recipients';
  export * as notificationConfigurations from './src/notification-configurations';
  export * as notificationOutbox from './src/notification-outbox';
  export * as contactEmail from './src/contact-email';
  export * as supportDelivery from './src/support-delivery';
  export * as directory from './src/directory';
  export * as reviewTurnover from './src/review-turnover';
  export {contactPage} from './src/contact-page';
  export {welcomeDraftProject} from './src/first-draft';
  export {inspectionRequest,inspectionMessages} from './src/agent-inspection';
  export * as backendDiff from './src/backend-diff';
  export * as backendPublication from './src/backend-publication';
  export * as backendForms from './src/backend-forms';
  export * as cmsDeploy from './src/cms-deploy';
  export * as cmsProjects from './src/cms-projects';
  export * as cmsProvision from './src/cms-provision';
  export * as cmsBridge from './src/cms-bridge';
  export * as cmsContent from './src/cms-content';
  export * as cmsPublication from './src/cms-publication';
  export * as backendFormRender from './src/backend-form-render';
  export * as backendState from './src/backend-state';
  export * as backendChat from './src/backend-chat';
  export * as backendImports from './src/backend-imports';
  export * as appActivation from './src/app-activation';
  export * as buildJobs from './src/build-jobs';
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
  export {listDNSActions,reviewTXT,confirmDNS} from './src/cloudflare-dns';
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
 return withTypedConfirms(module);
}
// `handlers` lets a fixture that bundles its own modules (helpers/current-modules.mjs) pass the same bundle's
// readChat/sendChatControl/createWebsite/prepareSpecification/readSpecificationProposal/jsonDigest/moduleCatalog, because
// admission capabilities are module-private to one bundle.
async function saveProposal(db,user,turn,prepared,handlers){
 const m=handlers??await currentSiteFixtureHandlers(),revision=(await m.readChat(db,user)).state.revision,now=new Date().toISOString();
 await db.batch([
  db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES(?,?,?,'Synthetic current website fixture','','ai','pending',?)").bind(turn,user,revision+1,now),
  ...prepared.statements,
  db.prepare("UPDATE chat_turns SET assistant_text=?,status='completed' WHERE id=?").bind(prepared.reply,turn),
  db.prepare('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?').bind(user)
 ]);
}
export async function createFixtureWebsite(db,user,project,config,handlers){
 const m=handlers??await currentSiteFixtureHandlers(),turn=crypto.randomUUID(),prepared=await m.createWebsite(db,user,turn,project,config);await saveProposal(db,user,turn,prepared,m);return turn;
}
/** Prepares an exact private website review (change operations or `{versionId}` restore) as the AI turn's statements. */
export async function proposeFixtureWebsite(db,user,project,change,handlers){
 const m=handlers??await currentSiteFixtureHandlers(),turn=crypto.randomUUID(),head=await db.prepare('SELECT revision FROM project_spec_heads WHERE project_id=?').bind(project).first();assert.ok(head);
 const request=Array.isArray(change)?{kind:'specification',operation:'change',projectId:project,expectedRevision:head.revision,operations:change}:{kind:'specification',operation:'restore',projectId:project,expectedRevision:head.revision,versionId:change.versionId};
 await saveProposal(db,user,turn,await m.prepareSpecification(db,user,turn,request),m);
 return m.readSpecificationProposal(db,user,turn);
}
/** Applies a prepared review with the recent-sign-in specificationApply control; returns the control response and new version id. */
export async function applyFixtureWebsite(db,user,q,handlers){
 const m=handlers??await currentSiteFixtureHandlers(),version=crypto.randomUUID(),revision=(await m.readChat(db,user)).state.revision;
 return {version,...await m.sendChatControl(db,user,{id:version,revision,action:{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision}})};
}
export async function changeFixtureWebsite(db,user,project,operations,handlers){
 const applied=await applyFixtureWebsite(db,user,await proposeFixtureWebsite(db,user,project,operations,handlers),handlers);
 assert.equal(applied.status,200,applied.error);return applied.version;
}

/** Saves module instances through the real owner path (WH-125/126 fixtures): one exact `modules.put` per new or
 * changed instance, prepared as the AI turn's statements, then the recent-sign-in specificationApply control.
 * Returns the saved version and its review row; an unchanged list saves nothing and returns null. */
export async function configureFixtureModules(db,user,project,instances,handlers){
 const m=handlers??await currentSiteFixtureHandlers(),head=await db.prepare('SELECT v.spec_json FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=?').bind(project).first();assert.ok(head);
 const saved=JSON.parse(head.spec_json).instances,operations=[];
 for(const instance of instances){const prior=saved.find(i=>i.id===instance.id);if(!prior||await m.jsonDigest(prior)!==await m.jsonDigest(instance))operations.push({type:'modules.put',instance});}
 if(!operations.length)return null;
 const version=await changeFixtureWebsite(db,user,project,operations,m);
 return {version,review:await db.prepare('SELECT q.* FROM project_spec_proposals q JOIN project_spec_versions v ON v.proposal_id=q.id WHERE v.version_id=?').bind(version).first()};
}

export async function createFixtureProject(db,user,name,purpose,theme='ocean'){
 const project=crypto.randomUUID(),now=new Date().toISOString();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?)").bind(project,user,name,purpose,now,now).run();
 const version=await createFixtureWebsite(db,user,project,{name,headline:name,description:purpose,theme,aboutTitle:'About us',aboutText:purpose,sections:[],photos:[]});
 return {project,version};
}

/** Some fixtures insert synthetic Chat turns directly without advancing workspace_state; keep the owner's Chat revision
 * ahead of them so the real owner controls below never reuse a turn revision. Fixture-only. */
async function syncFixtureChat(db,user){
 await db.prepare('UPDATE workspace_state SET revision=max(revision,(SELECT coalesce(max(revision),0) FROM chat_turns WHERE user_id=?)) WHERE user_id=?').bind(user,user).run();
}
/** WH-126: project visitor identity belongs to the project's access module instance, which a visitor application
 * consumes. Uses the real owner path end to end: the typed `accessModuleReview` owner control prepares the exact
 * website review for the fixed standard access instance (`visitors`, no staff role, invitation enrollment), the
 * recent-sign-in specificationApply control saves it (`setupFixtureVisitorAccess`), and the exact
 * moduleActivationReview/Apply controls activate it (`setFixtureVisitorAccess`). Projects created without a website
 * first get a minimal private website through a synthetic AI first-draft turn (website drafting is an AI path; the
 * specification is where instances are configured). Returns the registry row. */
export async function enableFixtureVisitorAccess(db,user,project,{handlers}={}){
 const m=handlers??await currentSiteFixtureHandlers();await syncFixtureChat(db,user);
 if(!await db.prepare('SELECT 1 FROM project_spec_heads WHERE project_id=?').bind(project).first()){
  const p=await db.prepare('SELECT name,purpose FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first();assert.ok(p);
  const text=p.purpose||p.name;
  await createFixtureWebsite(db,user,project,{name:p.name,headline:p.name,description:text,theme:'ocean',aboutTitle:'About us',aboutText:text,sections:[],photos:[]},m);
 }
 await setupFixtureVisitorAccess(db,user,project,{handlers:m});
 return setFixtureVisitorAccess(db,user,project,'activate',{handlers:m});
}
/** The owner visitor access setup control (`accessModuleReview`) followed by the recent-sign-in specificationApply
 * control. Returns the saved version id and the exact review row. */
export async function setupFixtureVisitorAccess(db,user,project,{handlers}={}){
 const m=handlers??await currentSiteFixtureHandlers(),turn=crypto.randomUUID();await syncFixtureChat(db,user);
 const r=await m.sendChatControl(db,user,{id:turn,revision:(await m.readChat(db,user)).state.revision,action:{type:'accessModuleReview',projectId:project}});assert.equal(r.status,200,r.error);
 const review=await m.readSpecificationProposal(db,user,turn),applied=await applyFixtureWebsite(db,user,review,m);assert.equal(applied.status,200,applied.error);
 return {version:applied.version,review};
}
/** Runs `fn` with a scoped synthetic core.editing preview grant (prepare and confirm) for this project, revoked right
 * after, so serving never depends on it. Feature inclusion fixture only; it is not an owner action. */
export async function withFixtureEditingGrant(db,user,project,fn){
 const grants=[];
 for(const operation of ['prepare','confirm']){
  const grant=crypto.randomUUID();grants.push(grant);
  await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing',?,'private-test-acceptance','synthetic WH-126 visitor access fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(grant,user,project,operation).run();
 }
 try{return await fn();}
 finally{for(const grant of grants)await db.prepare('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=? AND revoked_at IS NULL').bind(grant).run();}
}
/** Activates or disables the project's access instance with the exact moduleActivationReview/Apply Chat controls.
 * Activation needs current core.editing inclusion: a scoped synthetic preview grant covers this one review
 * (`withFixtureEditingGrant`). Returns the registry row. */
export async function setFixtureVisitorAccess(db,user,project,action,{id='visitors',handlers}={}){
 const m=handlers??await currentSiteFixtureHandlers();await syncFixtureChat(db,user);
 await withFixtureEditingGrant(db,user,project,async()=>{
  const control=async action=>{const turn=crypto.randomUUID(),revision=(await m.readChat(db,user)).state.revision;const r=await m.sendChatControl(db,user,{id:turn,revision,action});assert.equal(r.status,200,r.error);return turn;};
  const turn=await control({type:'moduleActivationReview',projectId:project,instanceId:id,action});
  const review=await db.prepare('SELECT * FROM module_activation_reviews WHERE id=?').bind(turn).first();assert.ok(review);
  await control({type:'moduleActivationApply',reviewId:review.id,reviewDigest:review.review_digest,expectedRevision:review.expected_activation_revision});
 });
 return db.prepare("SELECT i.*,a.state,a.revision activation_revision FROM module_instances i JOIN module_activations a ON a.instance_id=i.id WHERE i.project_id=? AND i.kind='access'").bind(project).first();
}
/** SQL for a synthetic visitor row in the project's access instance: bind (visitor, project, project). */
export const fixtureVisitorSQL="INSERT INTO app_visitors(id,project_id,access_id) SELECT ?,?,id FROM module_instances WHERE project_id=? AND kind='access'";
