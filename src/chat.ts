import {interactionChatLinks} from './chat-interactions/links';
import {assertWorkspace,workspaceTransport,requireFreshWorkspace} from './workspace-identity/admission';
import {serviceClientActivationChatLinks} from './project-specification/service-clients/activation';
import {linkChatReviewReply,readChatReviewReceipts,backendReviewChatActions} from './chat-review-receipts';
import {chatControl} from './chat-controls';
import {controlReceipt,reviewedReply,reviewChangedMessage} from './chat-review-receipts';
import {transcriptRequests,transcriptReply,isTranscriptRequest} from './chat-transcript';
import {usageReviewCommand,prepareUsageReviewChat} from './usage-review-requests';
import {readStandardAIHistory,readStandardAIRequest,describeStandardAIHistory,describeStandardAIRequest} from './standard-ai-history';
import {describeConnections} from './connection-chat';
import {githubGrantChatControl,githubGrantChatActions} from './github-grant-chat';
import {guestPreviewChatCommand} from './guest-previews/bindings';
import {GuestPreviewError} from './guest-previews/policy';
import {guestPreviewTurnFailure} from './guest-previews/owner';
import {appMaintenanceRequest,listAppMaintenance,describeAppMaintenance} from './app-maintenance-list';
import {appMaintenanceChatActions} from './app-maintenance-chat-actions';
import {appRecoveryChatActions} from './app-recovery-chat-actions';
import {appPageDesignProjectId} from './app-page-design';
import {BillingError} from './billing';
import {applicationChatActions} from './app-chat-actions';
import {cmsPendingRequest,pendingCMSWork,describePendingCMS} from './cms-pending';
import {cmsWordPressLinks} from './cms-wordpress-chat';
import {firstDraftProjectId,firstAppProjectId,welcomeDraftProject} from './first-draft';
import {visitorAccessCommand} from './visitor-navigation';
import {cmsExportLinks} from './cms-export';
import {readAppAccess} from './app-access';
import {cmsDiscardLinks} from './cms-discard';
import {cmsUnpublishLinks} from './cms-unpublish';
import {cmsPublicationLinks} from './cms-publication';
import {cmsPreviewLinks} from './cms-preview';
import {cmsContentCommand} from './cms-content';
import {cmsChatCommand} from './cms-projects';
import {backendChatCommand} from './backend-chat';
import {directoryCommand} from './directory';
import {healthChatCommand,checkHealth,describeHealth} from './site-health';
import {diffCommand} from './version-diff';
import {contactCommand} from './contacts';
import {contactNotificationCommand} from './contact-notifications';
import {versionRemovalCommand} from './version-removal';
import {backupChatCommand} from './backup-chat';
import {hostingChatCommand} from './hosting-chat';
import {dnsChatCommand,type DNSChatOptions} from './dns-chat';
import {listPhotos} from './files';
import {photoRemovalCommand} from './photo-removal';
import {applyServiceClientsCommand,serviceClientChatLinks} from './project-specification/service-clients/store';
import {prepareAccessModuleCommand} from './shared-modules/access-setup';
import {prepareFilesModuleCommand} from './shared-modules/files-setup';
import {prepareGalleryPageCommand} from './shared-modules/files-gallery';
import {BackendError} from './backend-error';
import {prepareModuleActivationCommand,applyModuleActivationCommand,moduleActivationChatLinks,moduleActivationFailure} from './shared-modules/activation';
import {prepareAccessRoleCommand,applyAccessRoleCommand,accessRoleChatLinks,accessRoleFailure} from './shared-modules/access-roles';
import {ModuleError} from './shared-modules/policy';
import {applySpecificationCommand,specificationChatLinks} from './project-specification/store';
import {inspectWorkspace} from './workspace-read';
import {domainCommand} from './domains';
import { publicationCommand, siteURL } from './publications';
import { hashToken } from './security';
import { describePlans } from './plans';
import { getBilling } from './billing';
import { reconcileChat, sendAIChat } from './ai-chat';
import type { AIConfig } from './ai';

type State = { revision: number };
export const greeting = "Hi, I’m your Whumpo guide. What would you like to put online? Tell me about your business, project, or idea. I can save your brief and set up a project with you.";
export async function chatState(db: D1Database, userId: string) {
  await db.prepare("INSERT OR IGNORE INTO workspace_state (user_id,step) VALUES (?,'ready')").bind(userId).run();
  const state = await db.prepare('SELECT revision FROM workspace_state WHERE user_id = ?').bind(userId).first<State>();
  if (!state) throw new Error('Missing workspace state');
  return state;
}
export async function readChat(db: D1Database, userId: string, aiEnabled = false) {
  // Read revision and history together to avoid returning an old revision with newer turns.
  await chatState(db, userId);
  await reconcileChat(db, userId);
  // External reviews may outlive an interrupted transcript. Only offer backup confirmation
  // when its complete server-generated review receipt was saved; /backups can recover it otherwise.
  const result = await db.batch([
    db.prepare('SELECT revision FROM workspace_state WHERE user_id = ?').bind(userId),
    chatTurnQuery(db,userId),
    db.prepare("SELECT COUNT(*) AS projects, COALESCE(SUM(CASE WHEN site_live=1 OR backend_live=1 OR cms_articles>0 THEN 1 ELSE 0 END),0) AS live, COALESCE(SUM(cms_articles),0) AS cms_articles FROM project_service_status WHERE owner_user_id = ?").bind(userId)
  ]);
  await projectChatTurns(db,userId,result[1].results as Record<string,unknown>[]);
  const firstDraft=await welcomeDraftProject(db,userId);
  return { firstDraft, mode: aiEnabled ? 'ai' : 'guided', greeting: Number((result[2].results[0] as {projects:number}|undefined)?.projects)>0 ? 'Your workspace is ready. Tell me what you would like to build or change next.' : greeting, state: result[0].results[0], turns: result[1].results.reverse(), stats: result[2].results[0] };
}


/** A bounded current projection shared by recent Chat and exact saved messages.
 * Text alone never supplies approval authority; the same receipt/domain readers
 * recheck each linked operation. Reading one message invokes no model or action. */
function chatTurnQuery(db:D1Database,userId:string,turnId?:string){
  return db.prepare(`SELECT t.id, t.revision, t.user_text, t.action_json, t.assistant_text, t.created_at, t.mode, t.status, CASE WHEN csr.status='pending' AND t.status='completed' AND csr.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM cms_instances WHERE project_id=csr.project_id) AND instr(t.assistant_text,'Use the confirmation button for setup '||csr.id||' to approve this exact setup request.')>0 THEN csr.id ELSE NULL END AS cms_confirmation_id, CASE WHEN bl.kind='export' AND t.status='completed' AND br.status='applied' THEN br.id ELSE NULL END AS backend_state_export_id, CASE WHEN bl.kind='review' AND t.status='completed' AND br.status='ready' AND br.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND br.base_revision=bs.revision AND br.before_json=bs.state_json AND instr(t.assistant_text,'use the confirmation button for review '||br.id||'. A newer data revision invalidates this review.')>0 THEN br.id ELSE NULL END AS backend_state_confirmation_id, de.review_id AS directory_export_id, der.project_id AS directory_export_project_id, CASE WHEN dr.status='pending' AND t.status='completed' AND dr.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND dr.expected_revision=ds.revision THEN dr.id ELSE NULL END AS directory_confirmation_id, CASE WHEN dc.kind='publish' AND dc.status='applied' AND ds2.live_json=dc.snapshot_json AND ds2.publication_revision=dp.revision AND dp.version_id IS NOT NULL THEN dc.project_id ELSE NULL END AS directory_project_id, COALESCE(v.id,a.version_id) AS version_id, CASE WHEN a.status = 'pending' AND a.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') AND a.expected_revision = s.revision THEN a.id ELSE NULL END AS confirmation_id, done.project_id AS published_project_id, done.kind AS publication_kind, e.version_id AS export_version_id, CASE WHEN r.status='pending' AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM project_files WHERE id=r.file_id) THEN r.id ELSE NULL END AS photo_confirmation_id, CASE WHEN vr.status='pending' AND vr.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM site_versions WHERE id=vr.version_id) THEN vr.id ELSE NULL END AS version_confirmation_id, CASE WHEN cr.status='pending' AND cr.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN cr.id ELSE NULL END AS contact_confirmation_id,CASE WHEN cnr.status='pending' AND cnr.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN cnr.id ELSE NULL END AS contact_notification_confirmation_id,CASE WHEN dpr.status='pending' AND dpr.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM domain_claims WHERE id=dpr.claim_id AND token=dpr.proof_token AND expires_at=dpr.proof_expires_at) THEN dpr.id ELSE NULL END AS domain_proof_confirmation_id,cmp.version_id AS comparison_version_id,cmp.baseline_id AS comparison_baseline_id, CASE WHEN gb.state='pending' AND gb.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND substr(t.assistant_text,-length('Use the confirmation button for backup '||gb.id||' to authorize this exact backup.'))='Use the confirmation button for backup '||gb.id||' to authorize this exact backup.' THEN gb.id ELSE NULL END AS backup_confirmation_id, CASE WHEN gb.state='complete' AND gb.commit_sha IS NOT NULL THEN 'https://github.com/'||gb.repo_owner||'/'||gb.repo_name||'/tree/'||gb.commit_sha||'/'||gb.path ELSE NULL END AS backup_url FROM chat_turns t LEFT JOIN domain_proof_removals dpr ON dpr.id=t.id AND dpr.user_id=t.user_id LEFT JOIN cms_setup_reviews csr ON csr.id=t.id AND csr.user_id=t.user_id LEFT JOIN backend_state_links bl ON bl.turn_id=t.id LEFT JOIN backend_state_reviews br ON br.id=bl.review_id AND br.user_id=t.user_id LEFT JOIN backend_state bs ON bs.project_id=br.project_id LEFT JOIN directory_exports de ON de.turn_id=t.id LEFT JOIN directory_reviews der ON der.id=de.review_id AND der.user_id=t.user_id LEFT JOIN directory_reviews dr ON dr.id=t.id AND dr.user_id=t.user_id LEFT JOIN directories ds ON ds.project_id=dr.project_id LEFT JOIN directory_reviews dc ON dc.confirmed_by=t.id AND dc.user_id=t.user_id LEFT JOIN directories ds2 ON ds2.project_id=dc.project_id LEFT JOIN publications dp ON dp.project_id=dc.project_id LEFT JOIN github_backups gb ON gb.id=t.id AND gb.user_id=t.user_id LEFT JOIN chat_comparisons cmp ON cmp.turn_id=t.id LEFT JOIN contact_reviews cr ON cr.id=t.id AND cr.user_id=t.user_id LEFT JOIN contact_destination_reviews cnr ON cnr.id=t.id AND cnr.user_id=t.user_id LEFT JOIN version_removals vr ON vr.id=t.id AND vr.user_id=t.user_id LEFT JOIN photo_removals r ON r.id=t.id AND r.user_id=t.user_id LEFT JOIN chat_exports e ON e.turn_id=t.id LEFT JOIN site_versions v ON v.id = t.id LEFT JOIN publication_chat_links pl ON pl.turn_id=t.id LEFT JOIN publication_actions a ON a.id=pl.review_id AND a.user_id=t.user_id AND EXISTS(SELECT 1 FROM projects ap WHERE ap.id=a.project_id AND ap.owner_user_id=t.user_id) LEFT JOIN publications s ON s.project_id=a.project_id LEFT JOIN publication_actions done ON done.confirmed_by=t.id AND done.user_id=t.user_id WHERE t.user_id = ? ${turnId?'AND t.id = ?':''} ORDER BY t.revision DESC LIMIT ${turnId?1:100}`).bind(userId,...(turnId?[turnId]:[]));
}
async function projectChatTurns(db:D1Database,userId:string,turns:Record<string,unknown>[]){
  const exports=await cmsExportLinks(db,userId);
  for(const link of exports){const turn=(turns as Record<string,unknown>[]).find(t=>t.id===link.turn_id);if(turn)Object.assign(turn,{cms_export_project_id:link.project_id,cms_export_request_id:link.draft_request_id});}
  const links=await cmsPreviewLinks(db,userId);
  for(const turn of turns as Record<string,unknown>[]){const link=links.find(l=>l.turn_id===turn.id);if(link){turn.cms_preview_project_id=link.project_id;turn.cms_preview_request_id=link.draft_request_id;}}
  const cmsReviews=await cmsPublicationLinks(db,userId);
  for(const turn of turns as Record<string,unknown>[]){const r=cmsReviews.find(r=>r.turn_id===turn.id);if(r){turn.cms_publication_review_id=r.id;if(r.status==='published'&&!r.withdrawn)turn.cms_publication_url=`https://${r.project_id}.whumpo.site/cms/${r.collection}/${r.item_id}`;if(r.status==='approved'||r.status==='pending'&&String(r.expires_at)>new Date().toISOString())turn.cms_publication_confirmation_id=r.id;}}
  const cmsImports=await cmsWordPressLinks(db,userId);
  for(const turn of turns as Record<string,unknown>[]){const r=cmsImports.find(r=>r.turn_id===turn.id);if(r){turn.cms_import_review_id=r.id;if(r.can_confirm&&(r.status==='approved'||r.status==='pending'&&r.expires_at>new Date().toISOString()))turn.cms_import_confirmation_id=r.id;if(r.status==='imported'){turn.cms_preview_project_id=r.project_id;turn.cms_preview_request_id=r.id;}}}
  const cmsDiscards=await cmsDiscardLinks(db,userId);
  for(const turn of turns as Record<string,unknown>[]){const r=cmsDiscards.find(r=>r.turn_id===turn.id);if(r&&(r.status==='approved'||r.status==='pending'&&!r.withdrawn&&String(r.expires_at)>new Date().toISOString())){turn.cms_discard_confirmation_id=r.id;turn.cms_discard_recovery=r.status==='approved';}}
  const cmsRemovals=await cmsUnpublishLinks(db,userId);
  for(const turn of turns as Record<string,unknown>[]){const r=cmsRemovals.find(r=>r.turn_id===turn.id);if(r&&(r.status==='approved'||r.status==='pending'&&!r.withdrawn&&String(r.expires_at)>new Date().toISOString())){turn.cms_unpublish_confirmation_id=r.id;turn.cms_unpublish_recovery=r.status==='approved';}}
  for(const turn of turns as Record<string,unknown>[]){if(turn.status==='completed'&&typeof turn.user_text==='string'&&isTranscriptRequest(turn.user_text)&&turn.assistant_text===transcriptReply)turn.chat_transcript_download=true;}
  const reviewReceipts=await readChatReviewReceipts(db,userId,turns as Record<string,unknown>[]);
  await githubGrantChatActions(db,userId,turns as Record<string,unknown>[],reviewReceipts);
  await backendReviewChatActions(db,userId,turns as Record<string,unknown>[],reviewReceipts);
  await applicationChatActions(db,userId,turns as Record<string,unknown>[],reviewReceipts);
  await appRecoveryChatActions(db,userId,turns as Record<string,unknown>[],reviewReceipts);
  await appMaintenanceChatActions(db,userId,turns as Record<string,unknown>[]);
  await serviceClientChatLinks(db,userId,turns as Record<string,unknown>[]);
  await serviceClientActivationChatLinks(db,userId,turns as Record<string,unknown>[]);
  await specificationChatLinks(db,userId,turns as Record<string,unknown>[]);
  await moduleActivationChatLinks(db,userId,turns as Record<string,unknown>[]);
  await accessRoleChatLinks(db,userId,turns as Record<string,unknown>[]);
  await interactionChatLinks(db,userId,turns as {id:unknown;[key:string]:unknown}[]);
}
export async function readSavedChatTurn(db:D1Database,userId:string,turnId:string){
  await assertWorkspace(db,userId);
  if(!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(turnId))return null;
  const {results}=await chatTurnQuery(db,userId,turnId).all<Record<string,unknown>>();
  if(!results.length)return null;
  await projectChatTurns(db,userId,results);
  const turn=results[0];
  // A completed retention removal or changed reply cannot survive this read.
  const current=await db.prepare('SELECT id FROM chat_turns WHERE id=? AND user_id=? AND revision=? AND user_text=? AND assistant_text=? AND status=?').bind(turn.id,userId,turn.revision,turn.user_text,turn.assistant_text,turn.status).first();
  await assertWorkspace(db,userId);
  return current?turn:null;
}

/** Public messages have no command interpreter, including slash-prefixed text. */
export async function sendConversation(db:D1Database,userId:string,input:Record<string,unknown>,ai?:AIConfig,options?:DNSChatOptions){
  await assertWorkspace(db,userId);
  if(Object.keys(input).some(k=>!['id','revision','content'].includes(k)))return Promise.resolve({status:400,error:'Send a plain chat message.'});
  // Private operator statements and transcript exports must never enter inference.
  const content=typeof input.content==='string'?input.content.trim():'';
  const privateRequest=!content.startsWith('/')&&(isTranscriptRequest(content)||usageReviewCommand(content));
  return sendChat(db,userId,input,ai,options,!privateRequest);
}
/** Only authenticated UI actions may reach the internal receipt adapters. */
export async function sendChatControl(db:D1Database,userId:string,input:Record<string,unknown>,ai?:AIConfig,options?:DNSChatOptions){
  await assertWorkspace(db,userId);
  const control=chatControl(input.action);
  if(!control||Object.keys(input).some(k=>!['id','revision','action'].includes(k)))return Promise.resolve({status:400,error:'Choose a valid reviewed action.'});
  const receipt=controlReceipt(control.action);if(receipt&&!await reviewedReply(db,userId,receipt.kind,receipt.reviewId))return {status:409,error:reviewChangedMessage};
  if(control.recentAuth)await requireFreshWorkspace(db,userId);
  return sendChat(db,userId,{id:input.id,revision:input.revision,content:control.command},ai,options,false,control);
}
/** Internal action adapter retained for existing validated handlers and offline fixtures. */
export async function sendChat(db: D1Database, userId: string, input: Record<string, unknown>, ai?: AIConfig, dnsOptions?: DNSChatOptions, conversationOnly=false, control?:NonNullable<ReturnType<typeof chatControl>>) {
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content || content.length > 1000 || !Number.isSafeInteger(input.revision) || typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/.test(input.id))
    return { status: 400, error: 'Send a message of 1 to 1,000 characters with a valid request ID.' };
  await assertWorkspace(db,userId);
  dnsOptions={...dnsOptions,transport:workspaceTransport(db,userId,dnsOptions?.transport),githubTransport:workspaceTransport(db,userId,dnsOptions?.githubTransport),hostingTransport:workspaceTransport(db,userId,dnsOptions?.hostingTransport),healthTransport:workspaceTransport(db,userId,dnsOptions?.healthTransport)};
  if(await db.prepare('SELECT id FROM chat_interaction_continuations WHERE id=?').bind(input.id).first())return {status:409,error:'Use the saved form to continue this task.'};
  const storedText=control?control.label:content,actionJSON=control?JSON.stringify(control.action):null;
  const matches=(row:{user_text:string;action_json:string|null;revision:number}|null)=>row!==null&&row.user_text===storedText&&row.action_json===actionJSON&&row.revision===Number(input.revision)+1;
  const previous = await db.prepare('SELECT user_text,action_json,revision FROM chat_turns WHERE id = ? AND user_id = ?').bind(input.id, userId).first<{ user_text: string;action_json:string|null;revision:number }>();
  if (previous) return matches(previous) ? { status: 200 } : { status: 409, error: 'This request ID was already used for another message.' };
  const state = await chatState(db, userId);
  await reconcileChat(db, userId);
  if (await db.prepare("SELECT id FROM chat_turns WHERE user_id = ? AND status = 'pending' LIMIT 1").bind(userId).first()) return { status: 409, error: 'Your previous AI reply is still being prepared. Please wait a moment.' };
  if (state.revision !== input.revision) {
    // A simultaneous identical request may commit between the first read and state read.
    const committed = await db.prepare('SELECT user_text,action_json,revision FROM chat_turns WHERE id=? AND user_id=?').bind(input.id,userId).first<{user_text:string;action_json:string|null;revision:number}>();
    if (matches(committed)) return {status:200};
    return { status: 409, error: 'Your conversation changed in another tab. Review the latest messages and send again.' };
  }
  if (state.revision >= 2000) return { status: 409, error: 'This test workspace has reached its conversation limit.' };
  if(conversationOnly){
    if(!ai)return {status:503,error:'Whumpo’s assistant is temporarily unavailable. Your saved work and Dashboard controls are still available. Please try again later.'};
    return sendAIChat(db,userId,input.id,state.revision,content,ai,undefined,dnsOptions);
  }
  let reply: string;
  let exportId: string | undefined;
  const command = ['show versions','my versions','show my saved versions'].includes(content.toLowerCase()) ? '/versions' : content.toLowerCase();
  const maintenance=appMaintenanceRequest(content);
  if(maintenance&&'error' in maintenance)return {status:400,error:maintenance.error};
  const pendingCMS=cmsPendingRequest(content);
  if(pendingCMS&&'error' in pendingCMS)return {status:400,error:pendingCMS.error};
  const usageReview=usageReviewCommand(content);
  let usageReviewReply:Awaited<ReturnType<typeof prepareUsageReviewChat>>|undefined;
  if(usageReview){try{usageReviewReply=await prepareUsageReviewChat(db,userId,input.id,content);}catch(e){return {status:e instanceof BillingError?e.status:503,error:e instanceof BillingError?e.message:'Usage review unavailable. Try again with the same message.'};}}
  if(/^\/design-app-page(?:\s|$)/.test(command)){
    if(!appPageDesignProjectId(content))return {status:400,error:'Choose the approved application from Chat.'};
    if(!ai)return {status:503,error:'AI page design is not connected in this environment.'};
    return sendAIChat(db,userId,input.id,state.revision,content,ai,undefined,dnsOptions,true);
  }
  if(/^\/first-(?:draft|app)(?:\s|$)/.test(command)){
    if(!firstDraftProjectId(content)&&!firstAppProjectId(content))return {status:400,error:'Choose your saved first project from Chat.'};
    if(!ai)return {status:503,error:'AI drafting is not connected. Please try again later.'};
    return sendAIChat(db,userId,input.id,state.revision,content,ai,undefined,dnsOptions,true);
  }
  const known = [...transcriptRequests,'show my ai requests','show ai history','show recent ai requests','/traffic','show traffic','my traffic','visitor access','manage visitor access','/visitor-access','/inbox','show inbox','my inbox','/versions','/brief','show brief','/projects','show my projects','my projects','show services','/plans','show plans','pricing','/usage','show usage','/activity','show activity','/domains','show domains','/connections','show connections','/security','/passkeys','/files','show files','show photos','upload a photo','export my website','download my website'];
  if (ai && !usageReview && !pendingCMS && !maintenance && (command.startsWith('/ask ') || command.startsWith('/edit ') || (!content.startsWith('/') && !known.includes(command)))) return sendAIChat(db, userId, input.id, state.revision, content, ai,undefined,dnsOptions);
  const hosting=hostingChatCommand(db,userId,input.id,command,dnsOptions);
  const dns = dnsChatCommand(db,userId,input.id,command,dnsOptions);
  const backup=backupChatCommand(db,userId,input.id,command,dnsOptions);
  const health=healthChatCommand(db,userId,command,dnsOptions);
  const backend=backendChatCommand(db,userId,input.id,content,dnsOptions?.backendRuntime);
  const cms=dnsOptions?.cmsPublication?.(input.id,content)??cmsContentCommand(content,input.id,dnsOptions?.cmsContent)??cmsChatCommand(db,userId,input.id,content,dnsOptions?.cms);
  let guestPreview:Awaited<ReturnType<typeof guestPreviewChatCommand>>;
  if(control?.action.type==='guestPreview'){try{guestPreview=await guestPreviewChatCommand(db,userId,input.id,content);}catch(e){if(e instanceof GuestPreviewError)return {status:e.status,error:e.message};throw e;}}
  const githubGrant=control?.action.type==='githubGrant'?githubGrantChatControl(db,userId,command,dnsOptions):undefined;
  const external=githubGrant??cms??backend??hosting??dns??backup??health;
  const comparison=await diffCommand(db,userId,input.id,command);
  const directory=await directoryCommand(db,userId,input.id,content);
  const contact=await contactCommand(db,userId,input.id,command)??await contactNotificationCommand(db,userId,input.id,command);
  const versionRemoval=await versionRemovalCommand(db,userId,input.id,command);
  const serviceClients=await applyServiceClientsCommand(db,userId,input.id,command);
  const specification=await applySpecificationCommand(db,userId,input.id,command);
  let moduleReview:Awaited<ReturnType<typeof prepareModuleActivationCommand>>,moduleApply:Awaited<ReturnType<typeof applyModuleActivationCommand>>,accessSetup:Awaited<ReturnType<typeof prepareAccessModuleCommand>>;
  try{
    if(control?.action.type==='moduleActivationReview')moduleReview=await prepareModuleActivationCommand(db,userId,input.id,command);
    if(control?.action.type==='moduleActivationApply')moduleApply=await applyModuleActivationCommand(db,userId,input.id,command);
    // WH-126 staff role reviews share the module review slot: exactly one typed control runs per turn.
    if(control?.action.type==='accessRoleReview')moduleReview=await prepareAccessRoleCommand(db,userId,input.id,command);
    if(control?.action.type==='accessRoleApply')moduleApply=await applyAccessRoleCommand(db,userId,input.id,command);
    // WH-126 owner visitor access setup prepares the existing exact specification review (saved by specificationApply).
    if(control?.action.type==='accessModuleReview')accessSetup=await prepareAccessModuleCommand(db,userId,input.id,command);
    // WH-128 owner photo collection setup: the same slot, the existing exact specification review (saved by specificationApply).
    if(control?.action.type==='filesModuleReview')accessSetup=await prepareFilesModuleCommand(db,userId,input.id,command);
    // WH-128 published gallery: the same slot, the existing exact specification review (saved by specificationApply).
    if(control?.action.type==='galleryPageReview')accessSetup=await prepareGalleryPageCommand(db,userId,input.id,command);
  }catch(e){if(e instanceof ModuleError||e instanceof BackendError)return {status:e.status,error:e.message};throw e;}
  const removal = await photoRemovalCommand(db,userId,input.id,command);
  const domain = await domainCommand(db,userId,input.id,command);
  const publication = await publicationCommand(db,userId,input.id,command);
  if(isTranscriptRequest(content))reply=transcriptReply;
  else if(usageReviewReply)reply=usageReviewReply.reply;
  else if(maintenance){try{reply=describeAppMaintenance(await listAppMaintenance(db,userId,maintenance.projectId,maintenance.page),maintenance.projectId);}catch(e){return {status:(e as {status?:number}).status??503,error:(e as {status?:number}).status===404?'Project not found':'Application maintenance could not be read. Try again; nothing was executed.'};}}
  else if(pendingCMS){try{reply=describePendingCMS(await pendingCMSWork(db,userId,pendingCMS.projectId,pendingCMS.page),pendingCMS.projectId);}catch(e){return {status:(e as {status?:number}).status??503,error:(e as {status?:number}).status===404?'Project not found':'Publishing work could not be read. Try again; no operation was retried.'};}}
  else if(guestPreview)reply=guestPreview.reply;
  else if(githubGrant)reply='GitHub access removal request recorded. Open the saved review in Settings → External connections to check its state. Replaying this message will not send it again.';
  else if(cms)reply="CMS request recorded. Ask to inspect the saved setup or content request "+input.id+' to recover its saved state.';
  else if(backend)reply="Backend request recorded. Its result is not saved yet. Ask to read test receipt "+input.id+'. Replaying this message will not execute again.';
  else if(health)reply="Website check recorded; the result is not saved yet. Ask to read its current saved status.";
  else if(backup)reply="Backup request recorded; its result has not yet been saved. Ask to inspect your saved backup reviews. Replaying this message will not dispatch it again.";
  else if(hosting)reply="Hosting request recorded; its result has not yet been saved. Ask to inspect your saved hosting connections. Replaying this message will not dispatch it again.";
  else if (dns) reply = "DNS request recorded; its result has not yet been saved. Ask to inspect your saved DNS reviews. Replaying this message will not dispatch it again.";
  else if(directory)reply=directory.reply;
  else if(comparison)reply=comparison.reply;
  else if(contact)reply=contact.reply;
  else if(serviceClients)reply=serviceClients.reply;
  else if(specification)reply=specification.reply;
  else if(accessSetup)reply=accessSetup.reply;
  else if(moduleReview)reply=moduleReview.reply;
  else if(moduleApply)reply=moduleApply.reply;
  else if(versionRemoval)reply=versionRemoval.reply;
  else if (removal) reply = removal.reply;
  else if (domain) reply = domain.reply;
  else if (publication) reply = publication.reply;
  else if (/^\/visitor-access(?:\s|$)/.test(command)||['visitor access','manage visitor access'].includes(command)) {
    const access=visitorAccessCommand(command)??{};
    if(access.error)return {status:400,error:access.error};
    const target=await db.prepare('SELECT id,name FROM projects WHERE owner_user_id=? AND (? IS NULL OR id=?) ORDER BY created_at DESC,id DESC LIMIT 1').bind(userId,access.projectId??null,access.projectId??null).first<{id:string;name:string}>();
    if(!target)reply="No matching project found. Start a project first.";
    else {const access=await readAppAccess(db,userId,target.id);reply=`Visitor access for “${target.name}”: ${access.visitors.filter(v=>!v.revoked).length} active visitor(s). Open Dashboard → Visitor access. Create invitations, cancel unused invitations and review revoking a visitor there. Access changes require a recent sign-in. Keep all invitation and recovery codes out of chat. ${access.publicAccessReady?'The reviewed visitor page is published.':'A visitor page still needs to be reviewed and published.'}`;}
  }
  else if (/^\/project-details(?:\s|$)/.test(command)) {const parts=command.split(/\s+/);if(parts.length!==2||! /^[0-9a-f-]{36}$/.test(parts[1]))return {status:400,error:"Choose a project to inspect."};reply=await inspectWorkspace(db,userId,'project',parts[1]);}
  else if (['/traffic','show traffic','my traffic'].includes(command)) reply=await inspectWorkspace(db,userId,'traffic');
  else if (['/inbox','show inbox','my inbox'].includes(command)) reply="Open your private inbox from Dashboard → Contact inbox. Visitor messages are not copied into Chat history or AI prompts. Ask to review enabling or disabling the contact form.";
  else if (/^\/(?:photos|files)(?:\s|$)/.test(command)||['show files','show photos'].includes(command)) {
    const [,id,...extra]=command.startsWith('/')?command.split(/\s+/):['/photos'];
    if(extra.length||(id&&!/^[0-9a-f-]{36}$/.test(id)))return {status:400,error:"Choose the project whose saved photos you want to inspect."};
    const target=await db.prepare('SELECT id,name FROM projects WHERE owner_user_id=? AND (? IS NULL OR id=?) ORDER BY created_at DESC,id DESC LIMIT 1').bind(userId,id??null,id??null).first<{id:string;name:string}>();
    if(!target)reply="No matching project found. Ask to list your projects.";
    else {const {files}=await listPhotos(db,userId,target.id);reply=`Saved photo inventory for ${JSON.stringify(target.name)} when this message was requested:\n\n`+(files.length?files.map(f=>`${JSON.stringify(f.name)} · ${f.status==='ready'?'saved privately':'upload not confirmed'} · ${f.safetyStatus==='approved'?'checks passed':f.safetyStatus==='blocked'?'unavailable':'waiting for safety checks'}\n${f.width} × ${f.height} pixels · ${f.size} bytes · retained by ${f.saved_versions} saved version(s)\nPhoto: ${f.id}`).join('\n\n'):'No photos uploaded for this project yet.')+"\n\nOpen Project photos to preview or upload a photo. Ask to inspect another project’s photos or review removing an unused photo.\n\nThis reads saved metadata only, not image bytes, current publication or storage availability. Ask again for a fresh inventory.";}
  }
  else if (/^\/(?:inspect|project)(?:\s|$)/.test(command)) {
    const [verb,id,...extra]=command.split(/\s+/);
    if(!id||!/^[0-9a-f-]{36}$/.test(id)||extra.length)return {status:400,error:"Choose the saved version or project to inspect."};
    reply=await inspectWorkspace(db,userId,verb==='/inspect'?'version':'project',id);
  }
  else if (/^\/export(?:\s|$)/.test(command) || ['export my website','download my website'].includes(command)) {
    const args=command.startsWith('/export')?command.split(/\s+/):['/export'];
    if(args.length>2 || (args[1]&&!/^[0-9a-f-]{36}$/.test(args[1])))return {status:400,error:"Choose a saved website version to export."};
    const saved=await db.prepare('SELECT v.id,p.name FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE p.owner_user_id=? AND (? IS NULL OR v.id=?) ORDER BY v.created_at DESC,v.id DESC LIMIT 1').bind(userId,args[1]??null,args[1]??null).first<{id:string;name:string}>();
    if(!saved)reply="No saved version found. Create a private draft first, or ask to list your saved versions.";
    else {exportId=saved.id;reply=`Download the saved source for “${saved.name}” below. Version: ${saved.id}. The ZIP includes its HTML, styles and configuration. It contains no account credentials or chat history. This uses no AI units and does not change your live site.`;}
  }
   else if (/^\/brief(?:\s|$)/.test(command) || command==='show brief') {
    const args=command==='show brief'?['/brief']:command.split(/\s+/);
    if(args.length>2 || (args[1]&&!/^[0-9a-f-]{36}$/.test(args[1]))) return {status:400,error:"Choose the project whose brief you want to read."};
    const saved=await db.prepare('SELECT name,purpose,audience,style_notes,preferred_theme FROM projects WHERE owner_user_id=? AND (? IS NULL OR id=?) ORDER BY created_at DESC,id DESC LIMIT 1').bind(userId,args[1]??null,args[1]??null).first<{name:string;purpose:string;audience:string;style_notes:string;preferred_theme:string}>();
    reply=saved?`Private brief for “${saved.name}”\nIdea: ${saved.purpose}\nAudience and goal: ${saved.audience||'Not specified'}\nStyle notes: ${saved.style_notes||'Not specified'}\nStarting theme: ${saved.preferred_theme}\n\nAudience and style notes are planning context for AI edits, not page content.`:"No project found. Start a project first.";
  } else if (['/projects', 'show my projects', 'my projects', 'show services'].includes(command)) {
    const { results } = await db.prepare('SELECT id,name,purpose,service_status AS status,site_live,backend_live,cms_articles FROM project_service_status WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT 20').bind(userId).all<{ id: string; name: string; purpose: string; status: string;site_live:number;backend_live:number;cms_articles:number }>();
    reply = results.length ? results.map(p => `${p.name} — ${p.site_live||p.cms_articles||p.backend_live?'live':p.status}\n${p.purpose}\nID: ${p.id}${p.site_live ? '\n' + siteURL(p.id) : ''}${p.backend_live?'\nPublic JSON backend · https://'+p.id+'.whumpo.site/backend':''}${p.cms_articles?'\n'+p.cms_articles+' public CMS article(s) · https://'+p.id+'.whumpo.site/cms':''}`).join('\n\n') : "No projects yet. Tell me what you would like to build.";
  } else if (/^\/ai-history(?:\s|$)/.test(command)||['show my ai requests','show ai history','show recent ai requests'].includes(command)) {
    const parts=command.startsWith('/')?command.split(/\s+/):['/ai-history'];
    if(parts.length>2||parts[1]&&!/^(?:[1-9]\d{0,2}|1000)$/.test(parts[1]))return {status:400,error:"Choose an AI request history page from 1 to 1000."};
    reply=describeStandardAIHistory(await readStandardAIHistory(db,userId,Number(parts[1]??1)));
  } else if (/^\/ai-request(?:\s|$)/.test(command)) {
    const match=/^\/ai-request ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(command);
    if(!match)return {status:400,error:"Choose a saved request from your AI history."};
    const request=await readStandardAIRequest(db,userId,match[1]);
    if(!request)return {status:404,error:'AI request not found.'};
    reply=describeStandardAIRequest(request)+'\n\nThis is a saved status, not a retry. Read the original Chat response for the work result. An interrupted request is not sent again automatically.';
  } else if (['/usage', 'show usage'].includes(command)) {
    const billing = await getBilling(db, userId);
    reply = `${billing.plan.name} · ${billing.period}\nStandard AI assistance is included under fair use for building and maintaining your projects, with no credit charges. Advanced models are not enabled yet; future advanced work will require explicit credit-spending approval.\n\nAsk to see your recent AI requests. Testing capacity and provider availability can still interrupt service. Subscriptions are sandbox-only; real payments and advanced credit purchases are disabled.`;
  } else if (['/plans', 'show plans', 'pricing'].includes(command)) {
    reply = describePlans();
  } else if (['/activity', 'show activity'].includes(command)) {
    const { results } = await db.prepare('SELECT summary, created_at FROM activity_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').bind(userId).all<{ summary: string; created_at: string }>();
    reply = results.map(event => `${event.created_at.slice(0, 10)}: ${event.summary}`).join('\n') || 'No activity yet.';
  } else if (command==='upload a photo') {
    reply='Open Dashboard → Photos to upload a private photo or view existing files. Uploads use no AI units. Photos are not published automatically.';

  } else if (['/connections', 'show connections'].includes(command)) {
    reply = await describeConnections(db,userId,dnsOptions);
  } else if (['/security', '/passkeys'].includes(command)) {
    reply = 'Open Profile → Passkeys & recovery to add a passkey, remove one, or replace your recovery code. These actions require a recent sign-in and your device confirmation. Never share a recovery code in chat.';

  } else {
    reply = "This internal action is unsupported. Use current workspace controls or describe what you need in Chat.";
  }
  const now = new Date().toISOString();
  const statements = [
    db.prepare("INSERT INTO chat_turns (id, user_id, revision, user_text, assistant_text, created_at, ai_context_allowed, action_json) SELECT ?, user_id, revision + 1, ?, ?, ?, ?, ? FROM workspace_state WHERE user_id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM chat_turns WHERE user_id = ? AND status = 'pending')").bind(input.id, storedText, reply, now, usageReview||isTranscriptRequest(content)?0:1, actionJSON, userId, state.revision, userId),
    db.prepare('UPDATE workspace_state SET revision = revision + 1 WHERE user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND user_id = ?)').bind(userId, state.revision, input.id, userId)
  ];
  if(usageReviewReply)statements.push(...usageReviewReply.statements);
  if(comparison)statements.push(...comparison.statements);
  if(guestPreview)statements.push(...guestPreview.statements);
  if(directory)statements.push(...directory.statements);
  if(contact)statements.push(...contact.statements);
  if(versionRemoval)statements.push(...versionRemoval.statements);
  if(serviceClients)statements.push(...serviceClients.statements);
  if(specification)statements.push(...specification.statements);
  if(accessSetup)statements.push(...accessSetup.statements);
  if(moduleReview)statements.push(...moduleReview.statements);
  if(moduleApply)statements.push(...moduleApply.statements);
  if (removal) statements.push(...removal.statements);
  if (domain) statements.push(...domain.statements);
  if (publication) statements.push(...publication.statements);
  if (exportId) statements.push(db.prepare("INSERT OR IGNORE INTO chat_exports(turn_id,version_id) SELECT id,? FROM chat_turns WHERE id=? AND user_id=?").bind(exportId,input.id,userId));
  try {
    const results = await db.batch(statements);
    if (results[0].meta.changes !== 1) {
      const committed = await db.prepare('SELECT user_text,action_json,revision FROM chat_turns WHERE id=? AND user_id=?').bind(input.id,userId).first<{user_text:string;action_json:string|null;revision:number}>();
      if (matches(committed)) return {status:200};
      return { status: 409, error: 'Your conversation changed. Review the latest messages and try again.' };
    }
  } catch (cause) {
    if(/service_client_|version_removal_service_client/.test(String(cause))){
      const recovered=await db.prepare('SELECT user_text,action_json,revision FROM chat_turns WHERE id=? AND user_id=?').bind(input.id,userId).first<{user_text:string;action_json:string|null;revision:number}>();
      if(matches(recovered))return {status:200};
      return {status:409,error:String(cause).includes('quota')?'Service configuration history has reached its test capacity.':String(cause).includes('version_removal_service_client')?'This website version is retained by saved service settings or a pending review.':'The service settings, references or review changed, expired or are held. Ask for a fresh review.'};
    }
    if(/specification_(changed|expired|quota|held)|version_removal_specification/.test(String(cause))){
      const recovered=await db.prepare('SELECT user_text,action_json,revision FROM chat_turns WHERE id=? AND user_id=?').bind(input.id,userId).first<{user_text:string;action_json:string|null;revision:number}>();
      if(matches(recovered))return {status:200};
      return {status:String(cause).includes('specification_held')?423:409,error:String(cause).includes('version_removal_specification')?'This version is retained by the current website configuration or a pending review.':String(cause).includes('specification_quota')?'Website review history has reached its test capacity.':'The website or its review changed, expired or is held for safety checks. Ask for a fresh review.'};
    }
    if(control?.action.type==='guestPreview'){
      const recovered=await db.prepare('SELECT user_text,action_json,revision FROM chat_turns WHERE id=? AND user_id=?').bind(input.id,userId).first<{user_text:string;action_json:string|null;revision:number}>();
      if(matches(recovered))return {status:200};
      const refused=guestPreviewTurnFailure(cause);
      if(refused)return {status:refused.status,error:refused.message};
    }
    const moduleFailure=moduleActivationFailure(cause)??accessRoleFailure(cause);
    if(moduleFailure){
      const recovered=await db.prepare('SELECT user_text,action_json,revision FROM chat_turns WHERE id=? AND user_id=?').bind(input.id,userId).first<{user_text:string;action_json:string|null;revision:number}>();
      if(matches(recovered))return {status:200};
      return {status:moduleFailure.status,error:moduleFailure.message};
    }
    if(String(cause).includes('photo_safety_required'))return {status:423,error:'A photo is held for safety checks. It cannot be attached or published until approved.'};
    if(String(cause).includes('usage_review_requests.user_id'))return {status:409,error:'Another usage review was opened. Ask “show my usage reviews” to read it.'};
    if(String(cause).includes('directory_changed'))return {status:409,error:'The directory review changed or expired. Read the current directory and prepare a new review.'};
    if(String(cause).includes('directory_capacity'))return {status:409,error:'The test directory listing limit or the limit of unconfirmed directory reviews has been reached. Confirm, wait for or let pending reviews expire, or remove listings.'};
    if(String(cause).includes('comparison_changed'))return {status:409,error:'A compared version changed or was removed. Request the comparison again.'};
    if(String(cause).includes('contact_review_changed'))return {status:409,error:'The contact form review changed or expired. Request a fresh review.'};
    if(String(cause).includes('contact_destination_review_changed'))return {status:409,error:'The contact notification review changed or expired. Request a fresh review.'};
    if(String(cause).includes('contact_destination_suppressed'))return {status:409,error:'That address cannot receive notices from Whumpo.'};
    if(String(cause).includes('safety_preservation_hold')&&command.startsWith('/confirm-contact-notify '))return {status:423,error:'This notification address cannot be changed right now. Contact Whumpo support if you need help.'};
    if(String(cause).includes('domain_proof_removal_retained'))return {status:409,error:'This proof is now retained for hosting or DNS recovery and cannot be removed.'};
    if(/domain_proof_removal_(changed|expired|unreviewed)/.test(String(cause)))return {status:409,error:'The ownership proof changed or its removal review expired. Request a fresh review.'};
    if(String(cause).includes('version_removal_live'))return {status:409,error:'That version is now live and cannot be removed.'};
    if(String(cause).includes('version_removal_publication'))return {status:409,error:'That version now has an active publication review. Wait for it to expire before removal.'};
    if(String(cause).includes('version_removal_backup'))return {status:409,error:'That version is retained for GitHub backup recovery and history.'};
    if(/version_removal_(changed|expired|unreviewed)/.test(String(cause)))return {status:409,error:'The version removal review changed or expired. Request a fresh review.'};
    if (String(cause).includes('photo_removal_referenced')) return {status:409,error:'That photo is now used by a saved website version. It cannot be removed while that version needs it.'};
    if (/photo_removal_(changed|expired)/.test(String(cause))) return {status:409,error:'This photo removal review changed or expired. Request a fresh review.'};
    if (String(cause).includes('domain_claim_quota')) return {status:409,error:'Domain test limit reached: 3 per project, 10 per account and 80 platform-wide.'};
    if (String(cause).includes('published_site_quota')) return {status:409,error:'Your plan’s live-site limit is reached. Unpublish another site before confirming this one.'};
    if (/publication_(changed|expired|version)/.test(String(cause))) return {status:409,error:'The reviewed publication is stale or expired. Request a fresh review before confirming.'};
    if (String(cause).includes('site_version_quota')) return {status:409,error:'This test project has reached its 25 saved preview limit.'};
    if (String(cause).includes('project_quota')) return { status: 409, error: 'The test platform allows 20 projects per account. Your brief is still saved.' };
    // A simultaneous retry can lose the primary-key race; verify ownership and payload.
    const retry = await db.prepare('SELECT user_text,action_json,revision FROM chat_turns WHERE id = ? AND user_id = ?').bind(input.id, userId).first<{ user_text: string;action_json:string|null;revision:number }>();
    if (matches(retry)) return { status: 200 };
    throw cause;
  }
  if(external){
    const result=await external();
    if(backend||githubGrant)await linkChatReviewReply(db,userId,input.id,result);
    await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=? AND user_id=?').bind(result,input.id,userId).run();
  }
  if(dnsOptions?.healthChecks&&publication&&command.startsWith('/confirm ')){
    const applied=await db.prepare("SELECT project_id FROM publication_actions WHERE confirmed_by=? AND user_id=? AND status='applied' AND kind!='unpublish'").bind(input.id,userId).first<{project_id:string}>();
    if(applied){let healthReply:string;try{healthReply=describeHealth(await checkHealth(db,userId,applied.project_id,dnsOptions.healthTransport,'publish'));}catch{healthReply="The publication is saved, but its availability check could not finish. Ask to read saved health checks or check project "+applied.project_id+' to try a new check.';}
      await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=? AND user_id=?').bind(reply.replace('Availability has not been checked yet.','')+'\n\n'+healthReply,input.id,userId).run();}
  }
  return { status: 200 };
}
