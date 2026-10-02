import {policyInputBound} from './ai';
import {standardAIReservationStatement,dispatchStandardAI,markStandardAIUncertain,closeStandardAIAttempt} from './standard-ai-usage';
import {reconcileStandardChat} from './standard-ai-recovery';
import {appPageDesignProjectId,readAppPageDesign,appPageDesignPrompt,appPageDesignData,appPageDesignProposalAllowed} from './app-page-design';
import {inspectionRequest,inspectionMessages,inspectionAllowance} from './agent-inspection';
import {firstDraftProjectId,firstAppProjectId,welcomeDraftProject,firstDraftProposalAllowed} from './first-draft';
import { startAcknowledgment } from './acknowledgment';
import { ensureInferenceBudget, inferenceReservation, dispatchInference, observeInference, uncertainInference } from './model-costs';
import { museTestRoute } from './model-policy';
import {cloudflareStatus} from './cloudflare-connection';
import type {DNSChatOptions} from './dns-chat';
import {DomainError} from './domains';
import { siteContext, agentPrompt,agentWorkspaceData,agentPromptFocus, prepareSiteAction, ProposalError } from './site-agent';
import { complete, ProviderError, type AIConfig, type ChatMessage } from './ai';
import { BillingError, ensureBilling } from './billing';
import { hashToken } from './security';

export function configuredAI(env: Env): AIConfig | undefined {
  if (!env.AI_API_KEY || !env.AI_BASE_URL || !env.AI_MODEL || String(env.ENVIRONMENT) === 'local') return;
  try { return museTestRoute({ baseURL: env.AI_BASE_URL, apiKey: env.AI_API_KEY.trim(), model: env.AI_MODEL, protocol: env.AI_PROTOCOL === 'responses' ? 'responses' : 'chat' }).config; } catch { return; }
}

/** Finish persisted results after a disconnect, without ever calling the provider again. */
export async function reconcileChat(db: D1Database, userId: string) {
  const { results } = await db.prepare("SELECT id,input_tokens,output_tokens,created_at FROM chat_turns WHERE user_id = ? AND status = 'pending' LIMIT 5").bind(userId).all<{ id: string; input_tokens: number | null; output_tokens: number | null; created_at: string }>();
  for (const turn of results) {
    if (!await reconcileStandardChat(db,userId,turn)) throw new BillingError(409, 'Missing current AI request receipt. This request needs review.');
  }
}

export async function sendAIChat(db: D1Database, userId: string, id: string, revision: number, content: string, config: AIConfig, transport: typeof fetch = globalThis.fetch.bind(globalThis), dnsOptions?:DNSChatOptions, internalIntent=false) {
  const previous = await db.prepare('SELECT user_text,revision,action_json FROM chat_turns WHERE id = ? AND user_id = ?').bind(id, userId).first<{ user_text: string; revision: number; action_json:string|null }>();
  if (previous) return previous.action_json===null && previous.user_text === content && previous.revision === revision + 1 ? { status: 200 } : { status: 409, error: 'This message ID was already used for another request' };
  const pageDesignId=internalIntent?appPageDesignProjectId(content):undefined,pageDesign=pageDesignId?await readAppPageDesign(db,userId,pageDesignId):null;
  if(pageDesignId&&!pageDesign)return {status:409,error:'Choose an approved application without a live visitor page. Refresh Chat to see its current status.'};
  const firstApp=internalIntent&&!!firstAppProjectId(content);
  const firstProjectId=internalIntent?(firstDraftProjectId(content)??firstAppProjectId(content)):undefined;
  const firstProject=firstProjectId?await welcomeDraftProject(db,userId,firstProjectId):null;
  if(firstProjectId&&!firstProject)return {status:409,error:'That first project is no longer waiting for its first build. Refresh Chat to see your saved work.'};
  const context = await siteContext(db,userId);
  if(firstProject)context.projects=[firstProject,...context.projects.filter(p=>p.id!==firstProject.id)].slice(0,5);
  const dnsStatus=await cloudflareStatus(db,userId,dnsOptions?.config);
  context.dnsConnection={enabled:dnsStatus.enabled,connected:dnsStatus.connected,expiresAt:dnsStatus.expiresAt};
  const { results: history } = await db.prepare("SELECT id,user_text,assistant_text FROM chat_turns WHERE user_id = ? AND status = 'completed' AND ai_context_allowed=1 ORDER BY revision DESC LIMIT 4").bind(userId).all<{id:string;user_text:string;assistant_text:string}>();
  const websiteFollowup=!!context.latest&&history[0]?.id===context.latest.id;
  const focus=firstProject?(firstApp?'all':'website'):agentPromptFocus(content,websiteFollowup);
  const system = pageDesign?appPageDesignPrompt(pageDesign):agentPrompt(context,focus)+(firstProject&&firstApp?`\nThis request is specifically the first private application build for existing project ${firstProject.id}. Use its complete saved purpose and audience. The only allowed actions are capabilities plan and backend buildApplication for that exact projectId, or action:null to ask one essential question or explain an unsupported requirement. Prefer reference:"private-task-list@1" when it fully fits. Otherwise first request a capability plan recording the missing visitor-transition behavior, then use its planId with source and a non-sensitive synthetic expected-output check derived from the brief. Never substitute a website or CMS, create another project, inspect another service, publish, activate, connect or purchase anything. A successful synthetic check prepares an owner approval only. If the brief needs unavailable capabilities or is too vague to derive a meaningful check, ask before building. One capability planning lookup is available; the complete brief is in context.`:firstProject?`\nThis request is specifically the first private website draft for existing project ${firstProject.id}. Use its full saved purpose, audience and style. Reuse its name and selected theme. The only allowed action is specification with operation:create and all page config fields (including photos:[]) for that exact projectId, or action:null to ask one essential question or explain an unsupported requirement. Never create another project, run another tool, publish, connect a service or purchase anything. No inspection call is needed; the complete brief is in context.`:'');
  // Keep each transport message within its limit without dropping system policy.
  // Budget reservations still include every byte across all chunks.
  const messages: ChatMessage[] = [];
  function appendContext(role:'system'|'user',text:string){
  for(let offset=0;offset<text.length;){
    let end=Math.min(offset+16000,text.length);
    if(end<text.length){const newline=text.lastIndexOf('\n',end-1);if(newline>=offset)end=newline+1;else if(/[\uD800-\uDBFF]/.test(text[end-1]))end--;}
    messages.push({role,content:text.slice(offset,end)});offset=end;
  }
  }
  appendContext('system',system);
  appendContext('user',pageDesign?appPageDesignData(pageDesign):agentWorkspaceData(context,focus));
  if(!pageDesign)for (const turn of history.reverse()) messages.push({ role: 'user', content: turn.user_text.slice(0, 600) }, { role: 'assistant', content: turn.assistant_text.slice(0, 900) });
  messages.push({ role: 'user', content: pageDesign?'Design the visitor page for this approved application and prepare my review. Keep it unpublished.':firstProject?`Build the first private ${firstApp?'application, check a synthetic example, and prepare my approval':'website draft'} for project ${firstProject.id} using my saved brief. Keep it private.`:content });
  const budgetDate=new Date();
  const billing = await ensureBilling(db, userId,budgetDate);
  await ensureInferenceBudget(db,userId,billing.period,billing.plan.id);
  // Standard work has bounded calls, not a customer-unit admission threshold.
  const boundInput = () => policyInputBound(messages);
  const outputLimit = 2048;
  async function noReservation(){
    const prior=await db.prepare('SELECT user_text,revision,action_json FROM chat_turns WHERE id=? AND user_id=?').bind(id,userId).first<{user_text:string;revision:number;action_json:string|null}>();
    if(prior)return prior.action_json===null&&prior.user_text===content&&prior.revision===revision+1?{status:200}:{status:409,error:'This message ID was already used for another request'};
    const state=await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(userId).first<{revision:number}>();
    if(state?.revision!==revision)return {status:409,error:'Another message changed the conversation. Refresh and try again.'};
    return {status:409,error:'Another request is still being processed. Refresh Chat before sending a new message.'};
  }
  // Reserve internal costs for both bounded calls before dispatch.
  const followupInputBound=boundInput()+inspectionAllowance;
  const canFollow=(!firstProject||firstApp)&&!pageDesign&&messages.length<=48;
  const reservedInput=boundInput()+(canFollow?followupInputBound:0);
  const requestHash=await hashToken(JSON.stringify({content,revision}));
  const now = budgetDate.toISOString();
  let inserted;
  try {
    inserted = await db.batch([
      standardAIReservationStatement(db,userId,id,requestHash,budgetDate,revision),
      db.prepare("INSERT INTO chat_turns (id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,?,'Working on your request…',?,'ai','pending' FROM workspace_state WHERE user_id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM chat_turns WHERE user_id = ? AND status = 'pending') AND EXISTS(SELECT 1 FROM standard_ai_requests WHERE id=? AND user_id=? AND request_hash=? AND state='reserved') ON CONFLICT(id) DO NOTHING").bind(id, content, now, userId, revision, userId,id,userId,requestHash),
      inferenceReservation(db,userId,id,billing.period,config,reservedInput,outputLimit*(canFollow?2:1)),
      db.prepare('UPDATE workspace_state SET revision = revision + 1 WHERE user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND user_id = ?)').bind(userId, revision, id, userId)
    ]);
  } catch (cause) {
    // A failed batch rolls back the reservation together with the chat claim.
    // A lost acknowledgement is handled by the same message's persisted receipt on retry.
    if(String(cause).includes('inference_budget')) return {status:503,error:'AI is temporarily unavailable while the platform’s testing capacity is reviewed. Your credits were not used. Your saved work and Dashboard controls remain available.'};
    throw cause;
  }
  if (inserted[1].meta.changes !== 1) return noReservation();
  if (!(await dispatchStandardAI(db, userId, id))) return { status: 200 };
  if (!(await dispatchInference(db,userId,id))) return {status:200};
  if(dnsOptions?.background)dnsOptions.background(startAcknowledgment(db,userId,id,billing.period,content,config,transport));
  const started = Date.now();
  try {
    let result = await complete({ ...config, maxOutputTokens: outputLimit, timeoutMs:canFollow?45000:config.timeoutMs, sessionId: `whumpo-${userId}` }, messages, transport);
    if(result.inputTokens>boundInput()||result.outputTokens>outputLimit)throw new ProviderError('invalid_response');
    let proposal;
    if(canFollow&&inspectionRequest(result.text)){
      if(firstProject&&!firstDraftProposalAllowed(result.text,firstProject.id,'app'))throw new ProposalError();
      const lookup=await prepareSiteAction(db,userId,id,result.text,context,dnsOptions);
      const inspection='inspection' in lookup&&typeof lookup.inspection==='string'?lookup.inspection:lookup.reply;
      const next=inspectionMessages(messages,inspection);
      if(next&&new TextEncoder().encode(JSON.stringify(next)).length+512<=followupInputBound){
        // Persist the lookup before dispatch; lost acknowledgments never retry it.
        await db.prepare('INSERT INTO agent_inspections(turn_id,user_id,result_text,input_tokens,output_tokens) VALUES(?,?,?,?,?)').bind(id,userId,inspection,result.inputTokens,result.outputTokens).run();
        const final=await complete({...config,maxOutputTokens:outputLimit,timeoutMs:45000,sessionId:`whumpo-${userId}`},next,transport);
        if(final.inputTokens>followupInputBound||final.outputTokens>outputLimit)throw new ProviderError('invalid_response');
        result={text:final.text,inputTokens:result.inputTokens+final.inputTokens,outputTokens:result.outputTokens+final.outputTokens};
      }else proposal=lookup;
    }
    await observeInference(db,userId,id,result);
    // Timeout reconciliation or an operator waiver may have closed this turn while the provider ran.
    const open=await db.prepare("SELECT t.id FROM chat_turns t JOIN standard_ai_requests o ON o.id=t.id AND o.user_id=t.user_id WHERE t.id=? AND t.user_id=? AND t.status='pending' AND o.state IN ('dispatched','uncertain')").bind(id,userId).first();
    if(!open)return {status:200};
    if(pageDesign&&!appPageDesignProposalAllowed(result.text,pageDesign.projectId))throw new ProposalError();
    if(firstProject&&!firstDraftProposalAllowed(result.text,firstProject.id,firstApp?'app':'website'))throw new ProposalError();
    if(firstProject&&!await welcomeDraftProject(db,userId,firstProject.id))throw new Error('welcome_first_draft_changed');
    proposal ??= await prepareSiteAction(db,userId,id,result.text,context,dnsOptions,pageDesign??undefined);
    // Claim in the same transaction as the version and reply, after model validation.
    // This also refuses a project removed while the provider was responding.
    const firstDraftClaim=firstProject&&!firstApp&&proposal.statements.length?[db.prepare('INSERT INTO welcome_first_drafts(turn_id,project_id,user_id) VALUES(?,?,?)').bind(id,firstProject.id,userId)]:[];
    await db.batch([
      ...firstDraftClaim,
      ...proposal.statements,
      db.prepare("UPDATE chat_turns SET assistant_text = ?, input_tokens = ?, output_tokens = ? WHERE id = ? AND user_id = ?").bind(proposal.reply,result.inputTokens,result.outputTokens,id,userId)
    ]);
    await reconcileChat(db, userId);
  } catch (cause) {
    await uncertainInference(db,userId,id);
    if(String(cause).includes('chat_result_closed'))return {status:200};
    // Recover a committed answer/draft after an acknowledgement was lost. Never regenerate.
    const persisted = await db.prepare("SELECT input_tokens FROM chat_turns WHERE id=? AND user_id=?").bind(id,userId).first<{input_tokens:number|null}>();
    if(persisted?.input_tokens != null){await reconcileChat(db,userId);return {status:200};}
    if(String(cause).includes('welcome_first_draft_changed')){
      await closeStandardAIAttempt(db,userId,id);
      await db.prepare("UPDATE chat_turns SET status='failed',assistant_text='Your first project changed while I was drafting. No additional draft was saved and your credits were not used. Open your saved versions to continue.' WHERE id=? AND user_id=? AND status='pending'").bind(id,userId).run();
      return {status:200};
    }
    if(String(cause).includes('composition_plan_changed')){
      await closeStandardAIAttempt(db,userId,id);
      await db.prepare("UPDATE chat_turns SET status='failed',assistant_text='The project changed while I was preparing the custom draft. No draft was saved. Ask me to inspect it and prepare a fresh plan.' WHERE id=? AND user_id=? AND status='pending'").bind(id,userId).run();
      return {status:200};
    }
    if(String(cause).includes('chat_interaction_changed')){
      await closeStandardAIAttempt(db,userId,id);
      await db.prepare("UPDATE chat_turns SET status='failed',assistant_text='The form, website or access changed while I was preparing the form. No new form was saved. Read its current state and ask for a fresh form.' WHERE id=? AND user_id=? AND status='pending'").bind(id,userId).run();
      return {status:200};
    }
    if(/specification_(changed|expired|quota|held|current_required)|service_client_(changed|quota|activation_changed)/.test(String(cause))){
      await closeStandardAIAttempt(db,userId,id);
      await db.prepare("UPDATE chat_turns SET status='failed',assistant_text='The website changed, its review storage is full, or the content is held for safety checks. No configuration was applied. Read the saved website and ask for a fresh review.' WHERE id=? AND user_id=? AND status='pending'").bind(id,userId).run();
      return {status:200};
    }
    if(String(cause).includes('comparison_changed')){
      await closeStandardAIAttempt(db,userId,id);
      await db.prepare("UPDATE chat_turns SET status='failed',assistant_text='A compared version was removed before the comparison could be saved. Request a fresh comparison. Your credits were not used.' WHERE id=? AND user_id=? AND status='pending'").bind(id,userId).run();
      return {status:200};
    }
    if(cause instanceof DomainError || String(cause).includes('domain_claim_quota')) {
      await closeStandardAIAttempt(db,userId,id);
      const detail=cause instanceof DomainError?cause.message:'Domain test limit reached: 3 per project, 10 per account and 80 platform-wide.';
      await db.prepare("UPDATE chat_turns SET status='failed',assistant_text=? WHERE id=? AND user_id=? AND status='pending'").bind(detail+' No domain change was applied and your credits were not used.',id,userId).run();
      return {status:200};
    }
    if(cause instanceof ProposalError || String(cause).includes('site_version_quota') || String(cause).includes('project_quota') || String(cause).includes('version_photo_owner')) {
      await closeStandardAIAttempt(db,userId,id);
      await db.prepare("UPDATE chat_turns SET status='failed',assistant_text=? WHERE id=? AND user_id=? AND status='pending'").bind((cause instanceof ProposalError || String(cause).includes('version_photo_owner')) ? 'The proposed change did not pass validation, so nothing was applied and your credits were not used. Try describing a smaller change.' : String(cause).includes('project_quota') ? 'Your account has reached its 20-project test limit. No project or draft was created and your credits were not used.' : 'This project has reached its 25 saved-version limit. No change was applied and your credits were not used.',id,userId).run();
      return {status:200};
    }
    // Jarvis-style fixed categories: never log envelopes, prompts, credentials or raw errors.
    console.warn(JSON.stringify({ event: 'ai_request_failed', operation: id, kind: cause instanceof ProviderError ? cause.kind : 'persistence', reason: cause instanceof ProviderError ? cause.reason : undefined, elapsedMs: Date.now() - started }));
    if (cause instanceof ProviderError && ['configuration', 'rejected', 'output_limit'].includes(cause.kind)) {
      await closeStandardAIAttempt(db,userId,id);
      const message = cause.kind === 'output_limit' ? 'The model reached its reply limit before finishing. Your credits were not used. Try a shorter or more focused question.' : 'The AI provider could not accept this request. Your credits were not used. Please try a new message later; Dashboard controls remain available.';
      await db.prepare("UPDATE chat_turns SET status = 'failed', assistant_text = ? WHERE id = ? AND user_id = ? AND status = 'pending'").bind(message, id, userId).run();
    } else {
      await markStandardAIUncertain(db,userId,id);
      await db.prepare("UPDATE chat_turns SET status = 'uncertain', assistant_text = 'The AI response could not be confirmed. Your credits were not used, and this message will not be sent again automatically. Check your saved work before asking again.' WHERE id = ? AND user_id = ? AND status = 'pending'").bind(id, userId).run();
    }
  }
  return { status: 200 };
}
