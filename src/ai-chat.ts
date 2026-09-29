import { startAcknowledgment } from './acknowledgment';
import { ensureInferenceBudget, inferenceReservation, dispatchInference, observeInference, uncertainInference } from './model-costs';
import { museTestRoute } from './model-policy';
import {cloudflareStatus} from './cloudflare-connection';
import type {DNSChatOptions} from './dns-chat';
import {DomainError} from './domains';
import { siteContext, agentPrompt, prepareSiteAction, ProposalError } from './site-agent';
import { complete, ProviderError, type AIConfig, type ChatMessage } from './ai';
import { dispatchUsage, finishUsage, getBilling, getOperation, usageReservationStatement, uncertainUsage } from './billing';
import { buildUnits } from './plans';
import { hashToken } from './security';

export function configuredAI(env: Env): AIConfig | undefined {
  if (!env.AI_API_KEY || !env.AI_BASE_URL || !env.AI_MODEL || String(env.ENVIRONMENT) === 'local') return;
  try { return museTestRoute({ baseURL: env.AI_BASE_URL, apiKey: env.AI_API_KEY.trim(), model: env.AI_MODEL, protocol: env.AI_PROTOCOL === 'responses' ? 'responses' : 'chat' }).config; } catch { return; }
}

/** Finish persisted results after a disconnect, without ever calling the provider again. */
export async function reconcileChat(db: D1Database, userId: string) {
  const { results } = await db.prepare("SELECT id,input_tokens,output_tokens,created_at FROM chat_turns WHERE user_id = ? AND status = 'pending' LIMIT 5").bind(userId).all<{ id: string; input_tokens: number | null; output_tokens: number | null; created_at: string }>();
  for (const turn of results) {
    if (turn.input_tokens !== null && turn.output_tokens !== null) {
      try {
        await finishUsage(db, userId, turn.id, buildUnits(turn.input_tokens, turn.output_tokens));
        await db.prepare("UPDATE chat_turns SET status = 'completed' WHERE id = ? AND user_id = ? AND status = 'pending'").bind(turn.id, userId).run();
      } catch {
        await uncertainUsage(db, userId, turn.id);
        await uncertainInference(db,userId,turn.id);
        await db.prepare("UPDATE chat_turns SET status = 'uncertain', assistant_text = 'The AI response needs a usage review. Its units remain held; retrying this message will not make another model call.' WHERE id = ? AND user_id = ? AND status = 'pending'").bind(turn.id, userId).run();
      }
    } else if (Date.parse(turn.created_at) < Date.now() - 120000) {
      const op = await getOperation(db, userId, turn.id);
      if (op?.status === 'reserved' || op?.status === 'released') {
        if (op.status === 'reserved') await finishUsage(db, userId, turn.id, 0);
        await db.prepare("UPDATE chat_turns SET status = 'failed', assistant_text = 'The request stopped before reaching the AI. No units were charged. Send a new message to try again.' WHERE id = ? AND user_id = ? AND status = 'pending'").bind(turn.id, userId).run();
      } else {
        await uncertainUsage(db, userId, turn.id);
        await uncertainInference(db,userId,turn.id);
        await db.prepare("UPDATE chat_turns SET status = 'uncertain', assistant_text = 'The AI request was interrupted. Its units remain held while usage is checked. This message will not be sent twice.' WHERE id = ? AND user_id = ? AND status = 'pending'").bind(turn.id, userId).run();
      }
    }
  }
}

export async function sendAIChat(db: D1Database, userId: string, id: string, revision: number, content: string, config: AIConfig, transport: typeof fetch = globalThis.fetch.bind(globalThis), dnsOptions?:DNSChatOptions) {
  const previous = await db.prepare('SELECT user_text,revision FROM chat_turns WHERE id = ? AND user_id = ?').bind(id, userId).first<{ user_text: string; revision: number }>();
  if (previous) return previous.user_text === content && previous.revision === revision + 1 ? { status: 200 } : { status: 409, error: 'This message ID was already used for another request' };
  const context = await siteContext(db,userId);
  const dnsStatus=await cloudflareStatus(db,userId,dnsOptions?.config);
  context.dnsConnection={enabled:dnsStatus.enabled,connected:dnsStatus.connected,expiresAt:dnsStatus.expiresAt};
  const { results: history } = await db.prepare("SELECT user_text,assistant_text FROM chat_turns WHERE user_id = ? AND status = 'completed' ORDER BY revision DESC LIMIT 4").bind(userId).all<{ user_text: string; assistant_text: string }>();
  const system = agentPrompt(context);
  // Keep each transport message within its limit without dropping system policy.
  // Budget reservations still include every byte across all chunks.
  const messages: ChatMessage[] = [];
  for(let offset=0;offset<system.length;){
    let end=Math.min(offset+16000,system.length);
    if(end<system.length){const newline=system.lastIndexOf('\n',end-1);if(newline>=offset)end=newline+1;else if(/[\uD800-\uDBFF]/.test(system[end-1]))end--;}
    messages.push({role:'system',content:system.slice(offset,end)});offset=end;
  }
  const systemMessages=messages.length;
  for (const turn of history.reverse()) messages.push({ role: 'user', content: turn.user_text.slice(0, 600) }, { role: 'assistant', content: turn.assistant_text.slice(0, 900) });
  messages.push({ role: 'user', content: content.startsWith('/ask ') ? content.slice(5) : content.startsWith('/edit ') ? content.slice(6) : content });
  const budgetDate=new Date();
  const billing = await getBilling(db, userId,budgetDate);
  await ensureInferenceBudget(db,userId,billing.period,billing.plan.id);
  const available = billing.quota.available + (billing.credits.overageEnabled ? billing.credits.available : 0);
  // UTF-8 bytes bound normal text tokenization conservatively; include per-message framing headroom.
  // Trim old context before reducing the output budget, so small remaining balances stay usable.
  const boundInput = () => new TextEncoder().encode(JSON.stringify(messages)).length + 512;
  while (messages.length > systemMessages + 1 && buildUnits(boundInput(), 2048) > available) messages.splice(systemMessages, 2);
  const outputLimit = Math.min(2048, Math.floor((available * 1000 - boundInput()) / 4));
  async function noReservation(){
    const prior=await db.prepare('SELECT user_text,revision FROM chat_turns WHERE id=? AND user_id=?').bind(id,userId).first<{user_text:string;revision:number}>();
    if(prior)return prior.user_text===content&&prior.revision===revision+1?{status:200}:{status:409,error:'This message ID was already used for another request'};
    const state=await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(userId).first<{revision:number}>();
    if(state?.revision!==revision)return {status:409,error:'Another message changed the conversation. Refresh and try again.'};
    return {status:402,error:'Not enough available units to reserve this AI reply. Guided commands are still free; use /usage to see your balance.'};
  }
  if (outputLimit < 1024) return noReservation();
  const units = buildUnits(boundInput(), outputLimit);
  const requestHash=await hashToken(JSON.stringify({content,revision}));
  const now = new Date().toISOString();
  let inserted;
  try {
    inserted = await db.batch([
      usageReservationStatement(db,userId,id,requestHash,units,billing.period,budgetDate,revision),
      db.prepare("INSERT INTO chat_turns (id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,?,'Working on your request…',?,'ai','pending' FROM workspace_state WHERE user_id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM chat_turns WHERE user_id = ? AND status = 'pending') AND EXISTS(SELECT 1 FROM usage_operations WHERE id=? AND user_id=? AND request_hash=? AND quoted_units=? AND status='reserved') ON CONFLICT(id) DO NOTHING").bind(id, content, now, userId, revision, userId,id,userId,requestHash,units),
      inferenceReservation(db,userId,id,billing.period,config,boundInput(),outputLimit),
      db.prepare('UPDATE workspace_state SET revision = revision + 1 WHERE user_id = ? AND revision = ? AND EXISTS (SELECT 1 FROM chat_turns WHERE id = ? AND user_id = ?)').bind(userId, revision, id, userId)
    ]);
  } catch (cause) {
    // A failed batch rolls back the reservation together with the chat claim.
    // A lost acknowledgement is handled by the same message's persisted receipt on retry.
    if(String(cause).includes('inference_budget')) return {status:402,error:'The monthly AI testing allowance is reached. Guided commands remain available.'};
    throw cause;
  }
  if (inserted[1].meta.changes !== 1) return noReservation();
  if (!(await dispatchUsage(db, userId, id))) return { status: 200 };
  if (!(await dispatchInference(db,userId,id))) return {status:200};
  if(dnsOptions?.background)dnsOptions.background(startAcknowledgment(db,userId,id,billing.period,content,config,transport));
  const started = Date.now();
  try {
    const result = await complete({ ...config, maxOutputTokens: outputLimit, sessionId: `tellumo-${userId}` }, messages, transport);
    await observeInference(db,userId,id,result);
    // Timeout reconciliation or an operator waiver may have closed this turn while the provider ran.
    const open=await db.prepare("SELECT t.id FROM chat_turns t JOIN usage_operations o ON o.id=t.id AND o.user_id=t.user_id WHERE t.id=? AND t.user_id=? AND t.status='pending' AND o.status IN ('dispatched','uncertain')").bind(id,userId).first();
    if(!open)return {status:200};
    const proposal = await prepareSiteAction(db,userId,id,result.text,context,dnsOptions);
    await db.batch([
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
    if(String(cause).includes('comparison_changed')){
      await finishUsage(db,userId,id,0);
      await db.prepare("UPDATE chat_turns SET status='failed',assistant_text='A compared version was removed before the comparison could be saved. Request a fresh comparison. No build units were charged.' WHERE id=? AND user_id=? AND status='pending'").bind(id,userId).run();
      return {status:200};
    }
    if(cause instanceof DomainError || String(cause).includes('domain_claim_quota')) {
      await finishUsage(db,userId,id,0);
      const detail=cause instanceof DomainError?cause.message:'Domain test limit reached: 3 per project, 10 per account and 80 platform-wide.';
      await db.prepare("UPDATE chat_turns SET status='failed',assistant_text=? WHERE id=? AND user_id=? AND status='pending'").bind(detail+' No domain change was applied and no build units were charged.',id,userId).run();
      return {status:200};
    }
    if(cause instanceof ProposalError || String(cause).includes('site_version_quota') || String(cause).includes('project_quota') || String(cause).includes('version_photo_owner')) {
      await finishUsage(db,userId,id,0);
      await db.prepare("UPDATE chat_turns SET status='failed',assistant_text=? WHERE id=? AND user_id=? AND status='pending'").bind((cause instanceof ProposalError || String(cause).includes('version_photo_owner')) ? 'The proposed change did not pass validation, so nothing was applied and no build units were charged. Try describing a smaller change.' : String(cause).includes('project_quota') ? 'Your account has reached its 20-project test limit. No project or draft was created and no build units were charged.' : 'This project has reached its 25 saved-version limit. No change was applied and no build units were charged.',id,userId).run();
      return {status:200};
    }
    // Jarvis-style fixed categories: never log envelopes, prompts, credentials or raw errors.
    console.warn(JSON.stringify({ event: 'ai_request_failed', operation: id, kind: cause instanceof ProviderError ? cause.kind : 'persistence', reason: cause instanceof ProviderError ? cause.reason : undefined, elapsedMs: Date.now() - started }));
    if (cause instanceof ProviderError && ['configuration', 'rejected', 'output_limit'].includes(cause.kind)) {
      await finishUsage(db, userId, id, 0);
      const message = cause.kind === 'output_limit' ? 'The model reached its reply limit before finishing. No build units were charged. Try a shorter or more focused question.' : 'The AI provider could not accept this request. No build units were charged. Please try a new message later; guided commands still work.';
      await db.prepare("UPDATE chat_turns SET status = 'failed', assistant_text = ? WHERE id = ? AND user_id = ? AND status = 'pending'").bind(message, id, userId).run();
    } else {
      await uncertainUsage(db, userId, id);
      await db.prepare("UPDATE chat_turns SET status = 'uncertain', assistant_text = 'The AI response could not be confirmed. Its units remain held for review, and this message will not be sent again automatically. Use /usage to see held units.' WHERE id = ? AND user_id = ? AND status = 'pending'").bind(id, userId).run();
    }
  }
  return { status: 200 };
}
