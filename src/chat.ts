import {describeConnections} from './connection-chat';
import {appMaintenanceRequest,listAppMaintenance,describeAppMaintenance} from './app-maintenance-list';
import {appMaintenanceChatActions} from './app-maintenance-chat-actions';
import {appRecoveryChatActions} from './app-recovery-chat-actions';
import {appPageDesignProjectId} from './app-page-design';
import {readUsageHistory,describeUsageHistory} from './billing';
import {applicationChatActions} from './app-chat-actions';
import {cmsPendingRequest,pendingCMSWork,describePendingCMS} from './cms-pending';
import {cmsWordPressLinks} from './cms-wordpress-chat';
import {firstDraftProjectId,firstAppProjectId,welcomeDraftProject} from './first-draft';
import {visitorAccessCommand} from './visitor-navigation';
import {cmsExportLinks} from './cms-export';
import {workspaceNavigation,workspaceNavigationHelp} from './workspace-navigation';
import {readLayout} from './workspace-dashboard';
import {readAppAccess} from './app-access';
import {chatHelp} from './chat-help';
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
import {versionRemovalCommand} from './version-removal';
import {backupChatCommand} from './backup-chat';
import {hostingChatCommand} from './hosting-chat';
import {dnsChatCommand,type DNSChatOptions} from './dns-chat';
import {listPhotos} from './files';
import {photoRemovalCommand} from './photo-removal';
import {inspectWorkspace} from './workspace-read';
import {domainCommand} from './domains';
import { attachPhoto } from './photo-versions';
import { publicationCommand, siteURL } from './publications';
import { renderLaunch, type LaunchConfig } from './components';
import { hashToken } from './security';
import { describePlans } from './plans';
import { ensureBilling, getBilling } from './billing';
import { reconcileChat, sendAIChat } from './ai-chat';
import type { AIConfig } from './ai';

type State = { revision: number; step: 'idea' | 'name' | 'ready'; idea: string; brief_project_id: string | null; brief_stage: 'audience' | 'style' | null };
export const greeting = "Hi, I’m your Whumpo guide. What would you like to put online? Tell me about your business, project, or idea. I can save your brief and set up a project with you.";
export async function chatState(db: D1Database, userId: string) {
  await db.prepare('INSERT OR IGNORE INTO workspace_state (user_id) VALUES (?)').bind(userId).run();
  const state = await db.prepare('SELECT revision, step, idea, brief_project_id, brief_stage FROM workspace_state WHERE user_id = ?').bind(userId).first<State>();
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
    db.prepare('SELECT revision, step, brief_stage FROM workspace_state WHERE user_id = ?').bind(userId),
    db.prepare("SELECT t.id, t.revision, t.user_text, t.assistant_text, t.created_at, t.mode, t.status, CASE WHEN csr.status='pending' AND t.status='completed' AND csr.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND NOT EXISTS(SELECT 1 FROM cms_instances WHERE project_id=csr.project_id) AND instr(t.assistant_text,'Send /confirm-cms '||csr.id||' to approve this exact setup request.')>0 THEN csr.id ELSE NULL END AS cms_confirmation_id, CASE WHEN bl.kind='export' AND t.status='completed' AND br.status='applied' THEN br.id ELSE NULL END AS backend_state_export_id, CASE WHEN bl.kind='review' AND t.status='completed' AND br.status='ready' AND br.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND br.base_revision=bs.revision AND br.before_json=bs.state_json AND instr(t.assistant_text,'send /confirm-backend-state '||br.id||'. A newer data revision invalidates this review.')>0 THEN br.id ELSE NULL END AS backend_state_confirmation_id, de.review_id AS directory_export_id, der.project_id AS directory_export_project_id, CASE WHEN dr.status='pending' AND t.status='completed' AND dr.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND dr.expected_revision=ds.revision THEN dr.id ELSE NULL END AS directory_confirmation_id, CASE WHEN dc.kind='publish' AND dc.status='applied' AND ds2.live_json=dc.snapshot_json AND ds2.publication_revision=dp.revision AND dp.version_id IS NOT NULL THEN dc.project_id ELSE NULL END AS directory_project_id, COALESCE(v.id,a.version_id) AS version_id, CASE WHEN a.status = 'pending' AND a.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') AND a.expected_revision = s.revision THEN a.id ELSE NULL END AS confirmation_id, done.project_id AS published_project_id, done.kind AS publication_kind, e.version_id AS export_version_id, CASE WHEN r.status='pending' AND r.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM project_files WHERE id=r.file_id) THEN r.id ELSE NULL END AS photo_confirmation_id, CASE WHEN vr.status='pending' AND vr.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM site_versions WHERE id=vr.version_id) THEN vr.id ELSE NULL END AS version_confirmation_id, CASE WHEN cr.status='pending' AND cr.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN cr.id ELSE NULL END AS contact_confirmation_id,CASE WHEN dpr.status='pending' AND dpr.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND EXISTS(SELECT 1 FROM domain_claims WHERE id=dpr.claim_id AND token=dpr.proof_token AND expires_at=dpr.proof_expires_at) THEN dpr.id ELSE NULL END AS domain_proof_confirmation_id,cmp.version_id AS comparison_version_id,cmp.baseline_id AS comparison_baseline_id, CASE WHEN gb.state='pending' AND gb.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND substr(t.assistant_text,-length('Send /confirm-backup '||gb.id||' to authorize this exact backup.'))='Send /confirm-backup '||gb.id||' to authorize this exact backup.' THEN gb.id ELSE NULL END AS backup_confirmation_id, CASE WHEN gb.state='complete' AND gb.commit_sha IS NOT NULL THEN 'https://github.com/'||gb.repo_owner||'/'||gb.repo_name||'/tree/'||gb.commit_sha||'/'||gb.path ELSE NULL END AS backup_url FROM chat_turns t LEFT JOIN domain_proof_removals dpr ON dpr.id=t.id AND dpr.user_id=t.user_id LEFT JOIN cms_setup_reviews csr ON csr.id=t.id AND csr.user_id=t.user_id LEFT JOIN backend_state_links bl ON bl.turn_id=t.id LEFT JOIN backend_state_reviews br ON br.id=bl.review_id AND br.user_id=t.user_id LEFT JOIN backend_state bs ON bs.project_id=br.project_id LEFT JOIN directory_exports de ON de.turn_id=t.id LEFT JOIN directory_reviews der ON der.id=de.review_id AND der.user_id=t.user_id LEFT JOIN directory_reviews dr ON dr.id=t.id AND dr.user_id=t.user_id LEFT JOIN directories ds ON ds.project_id=dr.project_id LEFT JOIN directory_reviews dc ON dc.confirmed_by=t.id AND dc.user_id=t.user_id LEFT JOIN directories ds2 ON ds2.project_id=dc.project_id LEFT JOIN publications dp ON dp.project_id=dc.project_id LEFT JOIN github_backups gb ON gb.id=t.id AND gb.user_id=t.user_id LEFT JOIN chat_comparisons cmp ON cmp.turn_id=t.id LEFT JOIN contact_reviews cr ON cr.id=t.id AND cr.user_id=t.user_id LEFT JOIN version_removals vr ON vr.id=t.id AND vr.user_id=t.user_id LEFT JOIN photo_removals r ON r.id=t.id AND r.user_id=t.user_id LEFT JOIN chat_exports e ON e.turn_id=t.id LEFT JOIN site_versions v ON v.id = t.id LEFT JOIN publication_actions a ON a.id = t.id AND a.user_id=t.user_id LEFT JOIN publications s ON s.project_id=a.project_id LEFT JOIN publication_actions done ON done.confirmed_by=t.id AND done.user_id=t.user_id WHERE t.user_id = ? ORDER BY t.revision DESC LIMIT 100").bind(userId),
    db.prepare("SELECT COUNT(*) AS projects, COALESCE(SUM(CASE WHEN site_live=1 OR backend_live=1 OR cms_articles>0 THEN 1 ELSE 0 END),0) AS live, COALESCE(SUM(cms_articles),0) AS cms_articles FROM project_service_status WHERE owner_user_id = ?").bind(userId)
  ]);
  const exports=await cmsExportLinks(db,userId);
  for(const link of exports){const turn=(result[1].results as Record<string,unknown>[]).find(t=>t.id===link.turn_id);if(turn)Object.assign(turn,{cms_export_project_id:link.project_id,cms_export_request_id:link.draft_request_id});}
  const links=await cmsPreviewLinks(db,userId);
  for(const turn of result[1].results as Record<string,unknown>[]){const link=links.find(l=>l.turn_id===turn.id);if(link){turn.cms_preview_project_id=link.project_id;turn.cms_preview_request_id=link.draft_request_id;}}
  const cmsReviews=await cmsPublicationLinks(db,userId);
  for(const turn of result[1].results as Record<string,unknown>[]){const r=cmsReviews.find(r=>r.turn_id===turn.id);if(r){turn.cms_publication_review_id=r.id;if(r.status==='published'&&!r.withdrawn)turn.cms_publication_url=`https://${r.project_id}.whumpo.site/cms/${r.collection}/${r.item_id}`;if(r.status==='approved'||r.status==='pending'&&String(r.expires_at)>new Date().toISOString())turn.cms_publication_confirmation_id=r.id;}}
  const cmsImports=await cmsWordPressLinks(db,userId);
  for(const turn of result[1].results as Record<string,unknown>[]){const r=cmsImports.find(r=>r.turn_id===turn.id);if(r){turn.cms_import_review_id=r.id;if(r.can_confirm&&(r.status==='approved'||r.status==='pending'&&r.expires_at>new Date().toISOString()))turn.cms_import_confirmation_id=r.id;if(r.status==='imported'){turn.cms_preview_project_id=r.project_id;turn.cms_preview_request_id=r.id;}}}
  const cmsDiscards=await cmsDiscardLinks(db,userId);
  for(const turn of result[1].results as Record<string,unknown>[]){const r=cmsDiscards.find(r=>r.turn_id===turn.id);if(r&&(r.status==='approved'||r.status==='pending'&&!r.withdrawn&&String(r.expires_at)>new Date().toISOString())){turn.cms_discard_confirmation_id=r.id;turn.cms_discard_recovery=r.status==='approved';}}
  const cmsRemovals=await cmsUnpublishLinks(db,userId);
  for(const turn of result[1].results as Record<string,unknown>[]){const r=cmsRemovals.find(r=>r.turn_id===turn.id);if(r&&(r.status==='approved'||r.status==='pending'&&!r.withdrawn&&String(r.expires_at)>new Date().toISOString())){turn.cms_unpublish_confirmation_id=r.id;turn.cms_unpublish_recovery=r.status==='approved';}}
  await applicationChatActions(db,userId,result[1].results as Record<string,unknown>[]);
  await appRecoveryChatActions(db,userId,result[1].results as Record<string,unknown>[]);
  await appMaintenanceChatActions(db,userId,result[1].results as Record<string,unknown>[]);
  const billing = await getBilling(db, userId);
  const firstDraft=await welcomeDraftProject(db,userId);
  return { firstDraft, mode: aiEnabled ? 'ai' : 'guided', greeting: Number((result[2].results[0] as {projects:number}|undefined)?.projects)>0 ? 'Your workspace is ready. Tell me what you would like to build or change next.' : aiEnabled ? greeting + ' After we save your brief, we can discuss your website with AI. Use /ask followed by a question at any time.' : greeting, state: result[0].results[0], turns: result[1].results.reverse(), stats: result[2].results[0], usage: { available: billing.quota.available, reserved: billing.quota.reserved, credits: billing.credits.available } };
}

export async function sendChat(db: D1Database, userId: string, input: Record<string, unknown>, ai?: AIConfig, dnsOptions?: DNSChatOptions) {
  const content = typeof input.content === 'string' ? input.content.trim() : '';
  if (!content || content.length > 1000 || !Number.isSafeInteger(input.revision) || typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/.test(input.id))
    return { status: 400, error: 'Send a message of 1 to 1,000 characters with a valid request ID.' };
  const previous = await db.prepare('SELECT user_text FROM chat_turns WHERE id = ? AND user_id = ?').bind(input.id, userId).first<{ user_text: string }>();
  if (previous) return previous.user_text === content ? { status: 200 } : { status: 409, error: 'This request ID was already used for another message.' };
  const state = await chatState(db, userId);
  await reconcileChat(db, userId);
  if (await db.prepare("SELECT id FROM chat_turns WHERE user_id = ? AND status = 'pending' LIMIT 1").bind(userId).first()) return { status: 409, error: 'Your previous AI reply is still being prepared. Please wait a moment.' };
  if (state.revision !== input.revision) {
    // A simultaneous identical request may commit between the first read and state read.
    const committed = await db.prepare('SELECT user_text FROM chat_turns WHERE id=? AND user_id=?').bind(input.id,userId).first<{user_text:string}>();
    if (committed?.user_text === content) return {status:200};
    return { status: 409, error: 'Your conversation changed in another tab. Review the latest messages and send again.' };
  }
  if (state.revision >= 2000) return { status: 409, error: 'This test workspace has reached its conversation limit.' };
  let step = state.step;
  let idea = state.idea;
  let briefProject = state.brief_project_id;
  let briefStage = state.brief_stage;
  let preference: {projectId:string; audience?:string; style?:string; theme?:LaunchConfig['theme']} | undefined;
  let reply: string;
  let project: { id: string; name: string; purpose: string } | undefined;
  let overage: boolean | undefined;
  let exportId: string | undefined;
  let version: { projectId: string; config: LaunchConfig; html: string; digest: string } | undefined;
  const command = ['show versions','my versions','show my saved versions'].includes(content.toLowerCase()) ? '/versions' : content.toLowerCase();
  const navigation=workspaceNavigation(content);
  const maintenance=appMaintenanceRequest(content);
  if(maintenance&&'error' in maintenance)return {status:400,error:maintenance.error};
  const pendingCMS=cmsPendingRequest(content);
  if(pendingCMS&&'error' in pendingCMS)return {status:400,error:pendingCMS.error};
  const help=chatHelp(command,!!ai);
  if(/^\/design-app-page(?:\s|$)/.test(command)){
    if(!appPageDesignProjectId(content))return {status:400,error:'Choose the approved application from Chat.'};
    if(!ai)return {status:503,error:'AI page design is not connected in this environment.'};
    return sendAIChat(db,userId,input.id,state.revision,content,ai,undefined,dnsOptions);
  }
  if(/^\/first-(?:draft|app)(?:\s|$)/.test(command)){
    if(!firstDraftProjectId(content)&&!firstAppProjectId(content))return {status:400,error:'Choose your saved first project from Chat.'};
    if(!ai)return {status:503,error:'AI drafting is not connected. You can still create a free starter preview from Chat.'};
    return sendAIChat(db,userId,input.id,state.revision,content,ai,undefined,dnsOptions);
  }
  const known = ['/traffic','show traffic','my traffic','visitor access','manage visitor access','/visitor-access','/inbox','show inbox','my inbox','/versions','/brief','show brief','/projects','show my projects','my projects','show services','/plans','show plans','pricing','/usage','show usage','show usage history','show my usage history','/credits','/credits on','/credits off','/activity','show activity','/domains','show domains','/connections','show connections','/security','/passkeys','/help','help','/new','/cancel','/files','show files','show photos','upload a photo','export my website','download my website'];
  if (ai && !help && !navigation && !pendingCMS && !maintenance && (command.startsWith('/ask ') || command.startsWith('/edit ') || (state.step === 'ready' && !state.brief_stage && !content.startsWith('/') && !known.includes(command)))) return sendAIChat(db, userId, input.id, state.revision, content, ai,undefined,dnsOptions);
  const hosting=hostingChatCommand(db,userId,input.id,command,dnsOptions);
  const dns = dnsChatCommand(db,userId,input.id,command,dnsOptions);
  const backup=backupChatCommand(db,userId,input.id,command,dnsOptions);
  const health=healthChatCommand(db,userId,command,dnsOptions);
  const backend=backendChatCommand(db,userId,input.id,content,dnsOptions?.backendRuntime);
  const cms=dnsOptions?.cmsPublication?.(input.id,content)??cmsContentCommand(content,input.id,dnsOptions?.cmsContent)??cmsChatCommand(db,userId,input.id,content,dnsOptions?.cms);
  const external=cms??backend??hosting??dns??backup??health;
  const comparison=await diffCommand(db,userId,input.id,command);
  const directory=await directoryCommand(db,userId,input.id,content);
  const contact=await contactCommand(db,userId,input.id,command);
  const versionRemoval=await versionRemovalCommand(db,userId,input.id,command);
  const removal = await photoRemovalCommand(db,userId,input.id,command);
  const domain = await domainCommand(db,userId,input.id,command);
  const photoCommand=command.match(/^\/photo\s+([0-9a-f-]{36})$/);
  const photoDraft=photoCommand?await attachPhoto(db,userId,input.id,photoCommand[1]):undefined;
  const publication = await publicationCommand(db,userId,input.id,command);
  if(navigation){const pages=(navigation.view==='pages'||navigation.view==='page')?(await readLayout(db,userId)).layout.tabs:[];reply=workspaceNavigationHelp+(navigation.view==='pages'||navigation.view==='page'?'\n'+(pages.length?'Your pages: '+pages.map(p=>p.label).join(', '):'No custom pages yet. Ask Whumpo to create one for your workflow.'):'');}
  else if(maintenance){try{reply=describeAppMaintenance(await listAppMaintenance(db,userId,maintenance.projectId,maintenance.page),maintenance.projectId);}catch(e){return {status:(e as {status?:number}).status??503,error:(e as {status?:number}).status===404?'Project not found':'Application maintenance could not be read. Try again; nothing was executed.'};}}
  else if(pendingCMS){try{reply=describePendingCMS(await pendingCMSWork(db,userId,pendingCMS.projectId,pendingCMS.page),pendingCMS.projectId);}catch(e){return {status:(e as {status?:number}).status??503,error:(e as {status?:number}).status===404?'Project not found':'Publishing work could not be read. Try again; no operation was retried.'};}}
  else if(cms)reply='CMS command recorded. Inspect /cms or /cms-review '+input.id+' to recover its saved state.';
  else if(backend)reply='Backend command recorded. Its result is not saved yet. Use /backend-result '+input.id+' to inspect a test receipt. Replaying this message will not execute again.';
  else if(health)reply='Website check recorded; the result is not saved yet. Use /health for current status.';
  else if(backup)reply='Backup command recorded; its result has not yet been saved. Use /backups to inspect reviews. Replaying this message will not dispatch it again.';
  else if(hosting)reply='Hosting command recorded; its result has not yet been saved. Use /hosting to inspect saved connections. Replaying this message will not dispatch it again.';
  else if (dns) reply = 'DNS command recorded; its result has not yet been saved. Use /dns to inspect saved reviews. Replaying this message will not dispatch it again.';
  else if(directory)reply=directory.reply;
  else if(comparison)reply=comparison.reply;
  else if(contact)reply=contact.reply;
  else if(versionRemoval)reply=versionRemoval.reply;
  else if (removal) reply = removal.reply;
  else if (domain) reply = domain.reply;
  else if (photoDraft) reply = photoDraft.reply;
  else if (publication) reply = publication.reply;
  else if (/^\/visitor-access(?:\s|$)/.test(command)||['visitor access','manage visitor access'].includes(command)) {
    const access=visitorAccessCommand(command)??{};
    if(access.error)return {status:400,error:access.error};
    const target=await db.prepare('SELECT id,name FROM projects WHERE owner_user_id=? AND (? IS NULL OR id=?) ORDER BY created_at DESC,id DESC LIMIT 1').bind(userId,access.projectId??null,access.projectId??null).first<{id:string;name:string}>();
    if(!target)reply='No matching project found. Create one with /new first.';
    else {const access=await readAppAccess(db,userId,target.id);reply=`Visitor access for “${target.name}”: ${access.visitors.filter(v=>!v.revoked).length} active visitor(s). Open Dashboard → Visitor access, or use /visitor-access ${target.id} in the workspace. Create invitations, cancel unused invitations and review revoking a visitor there. Access changes require a recent sign-in. Keep all invitation and recovery codes out of chat. ${access.publicAccessReady?'The reviewed visitor page is published.':'A visitor page still needs to be reviewed and published.'}`;}
  }
  else if (/^\/project-details(?:\s|$)/.test(command)) {const parts=command.split(/\s+/);if(parts.length!==2||! /^[0-9a-f-]{36}$/.test(parts[1]))return {status:400,error:'Use /project-details PROJECT_ID'};reply=await inspectWorkspace(db,userId,'project',parts[1]);}
  else if (['/traffic','show traffic','my traffic'].includes(command)) reply=await inspectWorkspace(db,userId,'traffic');
  else if (['/inbox','show inbox','my inbox'].includes(command)) reply='Open your private inbox from Dashboard → Contact inbox or type /inbox in the workspace. Visitor messages are not copied into chat history or AI prompts. Use /contact-on PROJECT_ID or /contact-off PROJECT_ID to review form settings.';
  else if (/^\/photos(?:\s|$)/.test(command)) {
    const [,id,...extra]=command.split(/\s+/);
    if(extra.length||(id&&!/^[0-9a-f-]{36}$/.test(id)))return {status:400,error:'Use /photos, optionally followed by a project ID.'};
    const target=await db.prepare('SELECT id,name FROM projects WHERE owner_user_id=? AND (? IS NULL OR id=?) ORDER BY created_at DESC,id DESC LIMIT 1').bind(userId,id??null,id??null).first<{id:string;name:string}>();
    if(!target)reply='No matching project found. Use /projects to choose a project.';
    else {const {files}=await listPhotos(db,userId,target.id);reply=`Photos for “${target.name}”:\n\n`+(files.length?files.map(f=>`${f.name} · ${f.status} · ${f.saved_versions} saved version(s)\nPhoto: ${f.id}`).join('\n\n')+'\n\nUse /delete-photo PHOTO_ID to review removal of an unused photo.':'No photos yet. Open /files to upload one.');}
  }
  else if (/^\/(?:inspect|project)(?:\s|$)/.test(command)) {
    const [verb,id,...extra]=command.split(/\s+/);
    if(!id||!/^[0-9a-f-]{36}$/.test(id)||extra.length)return {status:400,error:'Use /inspect VERSION_ID or /project PROJECT_ID.'};
    reply=await inspectWorkspace(db,userId,verb==='/inspect'?'version':'project',id);
  }
  else if (/^\/export(?:\s|$)/.test(command) || ['export my website','download my website'].includes(command)) {
    const args=command.startsWith('/export')?command.split(/\s+/):['/export'];
    if(args.length>2 || (args[1]&&!/^[0-9a-f-]{36}$/.test(args[1])))return {status:400,error:'Use /export, optionally followed by a saved version ID from /versions.'};
    const saved=await db.prepare('SELECT v.id,p.name FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE p.owner_user_id=? AND (? IS NULL OR v.id=?) ORDER BY v.created_at DESC,v.id DESC LIMIT 1').bind(userId,args[1]??null,args[1]??null).first<{id:string;name:string}>();
    if(!saved)reply='No saved version found. Create a private draft first, or choose a version with /versions.';
    else {exportId=saved.id;reply=`Download the saved source for “${saved.name}” below. Version: ${saved.id}. The ZIP includes its HTML, styles and configuration. It contains no account credentials or chat history. This uses no AI units and does not change your live site.`;}
  }
  else if (/^\/build(?:\s|$)/.test(command)) {
    const args = command.split(/\s+/);
    let theme = args[1] || 'ocean';
    if (!['ocean','clay','forest'].includes(theme) || args.length > 3 || (args[2] && !/^[0-9a-f-]{36}$/.test(args[2]))) return {status:400,error:'Use /build ocean, /build clay, or /build forest, optionally followed by a project ID.'};
    const target = await db.prepare('SELECT id,name,purpose,preferred_theme FROM projects WHERE owner_user_id = ? AND (? IS NULL OR id = ?) ORDER BY created_at DESC,id DESC LIMIT 1').bind(userId,args[2] ?? null,args[2] ?? null).first<{id:string;name:string;purpose:string;preferred_theme:LaunchConfig['theme']}>();
    if (!target) reply = 'Create a project with /new first, or check its ID with /projects.';
    else {
      if (!args[1]) theme = target.preferred_theme;
      const config: LaunchConfig = {name:target.name,description:target.purpose,theme:theme as LaunchConfig['theme']};
      const html = renderLaunch(config);
      version = {projectId:target.id,config,html,digest:await hashToken(html)};
      reply = `I assembled a private first draft for “${target.name}” using the reusable launch-page layout (${theme}). Open the preview below. No AI units were used. This is a saved preview, not a published site. Try another theme with /build clay or /build forest.`;
    }
  } else if (/^\/brief(?:\s|$)/.test(command) || command==='show brief') {
    const args=command==='show brief'?['/brief']:command.split(/\s+/);
    if(args.length>2 || (args[1]&&!/^[0-9a-f-]{36}$/.test(args[1]))) return {status:400,error:'Use /brief, optionally followed by a project ID.'};
    const saved=await db.prepare('SELECT name,purpose,audience,style_notes,preferred_theme FROM projects WHERE owner_user_id=? AND (? IS NULL OR id=?) ORDER BY created_at DESC,id DESC LIMIT 1').bind(userId,args[1]??null,args[1]??null).first<{name:string;purpose:string;audience:string;style_notes:string;preferred_theme:string}>();
    reply=saved?`Private brief for “${saved.name}”\nIdea: ${saved.purpose}\nAudience and goal: ${saved.audience||'Not specified'}\nStyle notes: ${saved.style_notes||'Not specified'}\nStarting theme: ${saved.preferred_theme}\n\nAudience and style notes are planning context for AI edits, not page content.`:'No project found. Use /new to start one.';
  } else if (['/projects', 'show my projects', 'my projects', 'show services'].includes(command)) {
    const { results } = await db.prepare('SELECT id,name,purpose,service_status AS status,site_live,backend_live,cms_articles FROM project_service_status WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT 20').bind(userId).all<{ id: string; name: string; purpose: string; status: string;site_live:number;backend_live:number;cms_articles:number }>();
    reply = results.length ? results.map(p => `${p.name} — ${p.site_live||p.cms_articles||p.backend_live?'live':p.status}\n${p.purpose}\nID: ${p.id}${p.site_live ? '\n' + siteURL(p.id) : ''}${p.backend_live?'\nPublic JSON backend · https://'+p.id+'.whumpo.site/backend':''}${p.cms_articles?'\n'+p.cms_articles+' public CMS article(s) · https://'+p.id+'.whumpo.site/cms':''}`).join('\n\n') : 'No projects yet. Tell me your idea, or type /new to start.';
  } else if (/^\/usage-history(?:\s|$)/.test(command)||['show usage history','show my usage history'].includes(command)) {
    const parts=command.startsWith('/')?command.split(/\s+/):['/usage-history'];
    if(parts.length>2||parts[1]&&!/^(?:[1-9]\d{0,2}|1000)$/.test(parts[1]))return {status:400,error:'Use /usage-history, optionally followed by a page from 1 to 1000.'};
    reply=describeUsageHistory(await readUsageHistory(db,userId,Number(parts[1]??1)));
  } else if (['/usage', 'show usage', '/credits'].includes(command)) {
    const billing = await getBilling(db, userId);
    reply = `${billing.plan.name} · ${billing.period}\n${billing.quota.available} of ${billing.quota.allowance} monthly build units available. ${billing.quota.spent} used; ${billing.quota.reserved} held for pending work.\n${billing.credits.available} credits available; ${billing.credits.reserved} held.\nUsing existing credits after your monthly allowance is ${billing.credits.overageEnabled ? 'enabled' : 'disabled'}.\n\nGuided chat is free. Monthly units reset on the first day of each month (UTC); credits carry over. Use /usage-history for individual requests. Use /credits on or /credits off to change overage use. Buying credits and paid upgrades are not enabled yet.`;
  } else if (['/credits on', '/credits off'].includes(command)) {
    await ensureBilling(db, userId);
    overage = command === '/credits on';
    reply = overage ? 'Existing credits may now cover build usage after your monthly allowance runs out. This does not buy credits or charge a payment method. You can turn this off with /credits off.' : 'Credit overage is off for new operations. Already reserved work can still settle against its existing hold.';
  } else if (['/plans', 'show plans', 'pricing'].includes(command)) {
    reply = describePlans();
  } else if (['/activity', 'show activity'].includes(command)) {
    const { results } = await db.prepare('SELECT summary, created_at FROM activity_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 10').bind(userId).all<{ summary: string; created_at: string }>();
    reply = results.map(event => `${event.created_at.slice(0, 10)}: ${event.summary}`).join('\n') || 'No activity yet.';
  } else if (['/files','show files','show photos','upload a photo'].includes(command)) {
    reply='Open Dashboard → Photos to upload a private photo or view existing files. Uploads use no AI units. Photos are not published automatically.';

  } else if (['/connections', 'show connections'].includes(command)) {
    reply = await describeConnections(db,userId,dnsOptions);
  } else if (['/security', '/passkeys'].includes(command)) {
    reply = 'Open Profile → Passkeys & recovery to add a passkey, remove one, or replace your recovery code. These actions require a recent sign-in and your device confirmation. Never share a recovery code in chat.';
  } else if (help) {
    reply = help;
  } else if (command === '/new') {
    step = 'idea'; idea = ''; briefProject = null; briefStage = null; reply = 'Let’s start something new. What would you like to put online, and who is it for?';
  } else if (command === '/cancel') {
    step = 'ready'; idea = ''; briefProject = null; briefStage = null; reply = 'I’ve cleared the unfinished brief. Your existing projects are unchanged. Type /new whenever you’re ready.';
  } else if (briefStage && (!content.startsWith('/') || command === '/skip')) {
    const target = await db.prepare('SELECT id,name,purpose FROM projects WHERE id=? AND owner_user_id=?').bind(briefProject,userId).first<{id:string;name:string;purpose:string}>();
    if (!target) { briefProject=null; briefStage=null; reply='That project is no longer available. Use /new to start another idea.'; }
    else if (briefStage === 'audience') {
      preference={projectId:target.id,audience:command==='/skip'?'':content}; briefStage='style';
      reply='What should it feel like? Choose ocean (crisp blue), clay (warm terracotta), or forest (calm green), or describe your style. I’ll save your preferences and assemble a private first draft. Use /skip for ocean. This uses no AI units.';
    } else {
      const theme:LaunchConfig['theme'] = ['ocean','clay','forest'].includes(command)?command as LaunchConfig['theme']:'ocean';
      preference={projectId:target.id,style:command==='/skip'?'':content,theme};
      const config:LaunchConfig={name:target.name,description:target.purpose,theme};const html=renderLaunch(config);
      version={projectId:target.id,config,html,digest:await hashToken(html)};
      briefProject=null;briefStage=null;
      reply=`Your first private draft for “${target.name}” is ready. I used the ${theme} theme${!['ocean','clay','forest','/skip'].includes(command)?' as a starting point and saved your style notes for AI edits':''}. Your audience and style notes stay in the project brief; they are not added to the page. No AI units were used. Open the preview below, then tell me what to change${ai?'': ' once AI is connected'}. Use /publish to review making it public; nothing is published automatically.`;
    }
  } else if (command === '/skip') {
    reply='There is no audience or style question to skip. Use /new to start a project.';
  } else if (content.startsWith('/')) {
    reply = 'I don’t recognize that command yet. Type /help to see what I can do.';
  } else if (step === 'idea') {
    idea = content; step = 'name'; reply = 'I’ve saved that brief. What would you like to call the project? You can change direction with /cancel.';
  } else if (step === 'name') {
    if (content.length > 100) reply = 'Let’s use a shorter project name—100 characters or fewer.';
    else {
      project = { id: input.id, name: content, purpose: idea };
      step = 'ready'; idea = ''; briefProject=project.id; briefStage='audience';
      reply = `Your project “${content}” is saved. Who should this website speak to, and what would you like visitors to do? I’ll keep this as private planning context. Use /skip if you’re not sure yet.`;
    }
  } else {
    reply = 'I’ve kept your message in our conversation. In guided mode, use /new to turn an idea into a project, or /help to see the available actions. AI-generated changes are unavailable in this environment.';
  }
  const now = new Date().toISOString();
  const statements = [
    db.prepare("INSERT INTO chat_turns (id, user_id, revision, user_text, assistant_text, created_at) SELECT ?, user_id, revision + 1, ?, ?, ? FROM workspace_state WHERE user_id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM chat_turns WHERE user_id = ? AND status = 'pending')").bind(input.id, content, reply, now, userId, state.revision, userId),
    db.prepare('UPDATE workspace_state SET revision = revision + 1, step = ?, idea = ?, brief_project_id = ?, brief_stage = ? WHERE user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND user_id = ?)').bind(step, idea, briefProject, briefStage, userId, state.revision, input.id, userId)
  ];
  if (preference) statements.push(db.prepare('UPDATE projects SET audience=COALESCE(?,audience),style_notes=COALESCE(?,style_notes),preferred_theme=COALESCE(?,preferred_theme),updated_at=? WHERE id=? AND owner_user_id=? AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(preference.audience??null,preference.style??null,preference.theme??null,now,preference.projectId,userId,input.id,userId));
  if(comparison)statements.push(...comparison.statements);
  if(directory)statements.push(...directory.statements);
  if(contact)statements.push(...contact.statements);
  if(versionRemoval)statements.push(...versionRemoval.statements);
  if (removal) statements.push(...removal.statements);
  if (domain) statements.push(...domain.statements);
  if (publication) statements.push(...publication.statements);
  if (photoDraft) statements.push(...photoDraft.statements);
  if (exportId) statements.push(db.prepare("INSERT OR IGNORE INTO chat_exports(turn_id,version_id) SELECT id,? FROM chat_turns WHERE id=? AND user_id=?").bind(exportId,input.id,userId));
  if (version) {
    statements.push(db.prepare("INSERT INTO site_versions (id,project_id,component_id,config_json,html,digest,created_at) SELECT ?,?,'launch-page@1',?,?,?,? WHERE EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND user_id = ?) AND EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_user_id = ?)").bind(input.id,version.projectId,JSON.stringify(version.config),version.html,version.digest,now,input.id,userId,version.projectId,userId));
    statements.push(db.prepare("INSERT INTO activity_events (id,user_id,project_id,action,summary,created_at) SELECT ?,?,?, 'site.preview.created','Created a private preview with launch-page@1',? WHERE EXISTS (SELECT 1 FROM site_versions WHERE id = ?)").bind(`preview:${input.id}`,userId,version.projectId,now,input.id));
  }
  if (overage !== undefined) {
    statements.push(db.prepare('UPDATE billing_accounts SET overage_enabled = ? WHERE user_id = ? AND EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND user_id = ?)').bind(overage ? 1 : 0, userId, input.id, userId));
    statements.push(db.prepare("INSERT INTO activity_events (id,user_id,action,summary,created_at) SELECT ?,user_id,'billing.preference',?,? FROM chat_turns WHERE id = ? AND user_id = ?").bind(`billing:${input.id}`, overage ? 'Enabled existing credits for quota overage' : 'Disabled credits for new operations', now, input.id, userId));
  }
  if (project) {
    statements.push(db.prepare("INSERT INTO projects (id, owner_user_id, name, purpose, status, created_at, updated_at) SELECT ?, ?, ?, ?, 'draft', ?, ? WHERE EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND user_id = ?)").bind(project.id, userId, project.name, project.purpose, now, now, input.id, userId));
    statements.push(db.prepare("INSERT INTO activity_events (id, user_id, project_id, action, summary, created_at) SELECT ?, ?, ?, 'project.created', ?, ? WHERE EXISTS (SELECT 1 FROM projects WHERE id = ? AND owner_user_id = ?)").bind(crypto.randomUUID(), userId, project.id, `Created project ${project.name} through chat`, now, project.id, userId));
  }
  try {
    const results = await db.batch(statements);
    if (results[0].meta.changes !== 1) {
      const committed = await db.prepare('SELECT user_text FROM chat_turns WHERE id=? AND user_id=?').bind(input.id,userId).first<{user_text:string}>();
      if (committed?.user_text === content) return {status:200};
      return { status: 409, error: 'Your conversation changed. Review the latest messages and try again.' };
    }
  } catch (cause) {
    if(String(cause).includes('directory_changed'))return {status:409,error:'The directory review changed or expired. Read the current directory and prepare a new review.'};
    if(String(cause).includes('directory_capacity'))return {status:409,error:'The test directory capacity or review-history limit has been reached.'};
    if(String(cause).includes('comparison_changed'))return {status:409,error:'A compared version changed or was removed. Request the comparison again.'};
    if(String(cause).includes('contact_review_changed'))return {status:409,error:'The contact form review changed or expired. Request a fresh review.'};
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
    const retry = await db.prepare('SELECT user_text FROM chat_turns WHERE id = ? AND user_id = ?').bind(input.id, userId).first<{ user_text: string }>();
    if (retry?.user_text === content) return { status: 200 };
    throw cause;
  }
  if(external){
    const result=await external();
    await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=? AND user_id=?').bind(result,input.id,userId).run();
  }
  if(dnsOptions?.healthChecks&&publication&&command.startsWith('/confirm ')){
    const applied=await db.prepare("SELECT project_id FROM publication_actions WHERE confirmed_by=? AND user_id=? AND status='applied' AND kind!='unpublish'").bind(input.id,userId).first<{project_id:string}>();
    if(applied){let healthReply:string;try{healthReply=describeHealth(await checkHealth(db,userId,applied.project_id,dnsOptions.healthTransport,'publish'));}catch{healthReply='The publication is saved, but its availability check could not finish. Use /health to inspect saved checks or /check-site '+applied.project_id+' to try a new check.';}
      await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=? AND user_id=?').bind(reply.replace('Availability has not been checked yet.','')+'\n\n'+healthReply,input.id,userId).run();}
  }
  return { status: 200 };
}
