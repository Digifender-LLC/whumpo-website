import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const bundled=await build({stdin:{resolveDir:process.cwd(),contents:"export {fairUseReport} from './src/fair-use-report.ts';export {agentContentPolicy} from './src/content-policy.ts';export {readAcknowledgment} from './src/acknowledgment.ts';export {sendAIChat,configuredAI} from './src/ai-chat.ts';export {readChat} from './src/chat.ts';export {ensureBilling} from './src/billing.ts';export {dispatchStandardAI,cancelStandardAI} from './src/standard-ai-usage.ts';export {ensureInferenceBudget,inferenceReservation,dispatchInference,observeInference,uncertainInference} from './src/model-costs.ts';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';"},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const {fairUseReport,agentContentPolicy,readAcknowledgment,sendAIChat,configuredAI,readChat,ensureBilling,dispatchStandardAI,cancelStandardAI,ensureInferenceBudget,inferenceReservation,dispatchInference,observeInference,uncertainInference}=m;
const fixture=await databaseFixture({d1:true}),db=fixture.db,scopes=new Map(),scope=user=>scopes.get(user);
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:'synthetic',protocol:'responses'};
const environment={ENVIRONMENT:'test',AI_API_KEY:config.apiKey,AI_BASE_URL:config.baseURL,AI_MODEL:config.model,AI_PROTOCOL:'responses'};
assert.equal(configuredAI(environment).model,config.model);assert.equal(configuredAI({...environment,AI_MODEL:'paid-other'}),undefined);assert.equal(configuredAI({...environment,ENVIRONMENT:'local'}),undefined);
let calls=0,releaseMain;
const provider=text=>async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:100,output_tokens:200}});};
async function account(){const a=await workspaceFixture(db,m),user=a.account;scopes.set(user,await a.scope());await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(user).run();return user;}
async function send(user,transport){const id=crypto.randomUUID(),chat=await readChat(scope(user),user);return {id,result:await sendAIChat(scope(user),user,id,chat.state.revision,'Say hello',config,transport)};}
async function reserve(user,id,input=1000,output=1000){const db=scope(user),now=new Date(),{period}=await ensureBilling(scope(user),user);await ensureInferenceBudget(scope(user),user,period,'explore');await db.batch([
 db.prepare('INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,user,'a'.repeat(64),now.toISOString(),now.toISOString()),
 db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Test','Pending',?,'ai','pending')").bind(id,user,Math.floor(Math.random()*1000000000),now.toISOString()),
 inferenceReservation(scope(user),user,id,period,config,input,output)
]);return period;}
try{
 const user=await account(),other=await account();
 const first=await send(user,provider(JSON.stringify({reply:'Hello',action:null})));assert.equal(first.result.status,200);
 const receipt=await db.prepare('SELECT * FROM inference_calls WHERE id=?').bind(first.id).first();assert.equal(receipt.model,config.model);assert.equal(receipt.cost_basis,'subscription-shadow');assert.equal(receipt.estimated_micros,50);assert.equal(receipt.status,'observed');assert.equal(receipt.input_tokens,100);
 const budget=await db.prepare('SELECT * FROM inference_budgets WHERE user_id=?').bind(user).first();assert.equal(budget.spent_micros,50);assert.equal(budget.reserved_micros,0);
 await sendAIChat(scope(user),user,first.id,0,'Say hello',config,provider('unused'));assert.equal(calls,1);
 // Customer-visible failure still consumed model resources: retain internal observed cost.
 const bad=await send(other,provider('invalid action envelope'));assert.equal(bad.result.status,200);
 assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(bad.id).first()).status,'failed');
 assert.equal((await db.prepare('SELECT estimated_micros FROM inference_calls WHERE id=?').bind(bad.id).first()).estimated_micros,50);
 // Timeout/unknown provider outcome holds the quote and never re-dispatches.
 const unknown=await account(),attempt=await send(unknown,async()=>{calls++;throw new DOMException('unknown','TimeoutError');});
 const uncertain=await db.prepare('SELECT status,reserved_micros FROM inference_calls WHERE id=?').bind(attempt.id).first();assert.equal(uncertain.status,'uncertain');assert.ok(uncertain.reserved_micros>0);
 const before=calls;await sendAIChat(scope(unknown),unknown,attempt.id,0,'Say hello',config,provider('unused'));assert.equal(calls,before);
 // Budget failure rolls back customer usage and chat, without sending to provider.
 const exhausted=await account();await ensureBilling(scope(exhausted),exhausted);await ensureInferenceBudget(scope(exhausted),exhausted,new Date().toISOString().slice(0,7),'explore');await db.prepare('UPDATE inference_budgets SET spent_micros=budget_micros WHERE user_id=?').bind(exhausted).run();
 const denied=await send(exhausted,provider('unused'));assert.equal(denied.result.status,503);assert.equal(calls,before);assert.equal(await db.prepare('SELECT id FROM chat_turns WHERE id=?').bind(denied.id).first(),null);
 // Concurrent admissions share one wallet. Exactly one of two oversized quotes fits.
 const concurrent=await account(),ids=[crypto.randomUUID(),crypto.randomUUID()];
 const admissions=await Promise.allSettled(ids.map(id=>reserve(concurrent,id,100000000,10000000)));assert.equal(admissions.filter(x=>x.status==='fulfilled').length,1);
 const winner=(await db.prepare('SELECT id,reserved_micros FROM inference_calls WHERE user_id=?').bind(concurrent).first());assert.equal(winner.reserved_micros,12000000);
 await dispatchStandardAI(scope(concurrent),concurrent,winner.id);assert.equal(await dispatchInference(scope(concurrent),concurrent,winner.id),true);assert.equal(await dispatchInference(scope(concurrent),concurrent,winner.id),false);
 await uncertainInference(scope(concurrent),concurrent,winner.id);await observeInference(scope(concurrent),concurrent,winner.id,{text:'x',inputTokens:100,outputTokens:200});await observeInference(scope(concurrent),concurrent,winner.id,{text:'x',inputTokens:100,outputTokens:200});
 assert.equal((await db.prepare('SELECT spent_micros,reserved_micros FROM inference_budgets WHERE user_id=?').bind(concurrent).first()).spent_micros,50);
 await assert.rejects(()=>observeInference(scope(concurrent),concurrent,winner.id,{text:'x',inputTokens:101,outputTokens:200}));await assert.rejects(()=>observeInference(scope(user),user,winner.id,{text:'x',inputTokens:100,outputTokens:200}));
 await assert.rejects(()=>db.prepare("UPDATE inference_calls SET model='other' WHERE id=?").bind(winner.id).run());
 await assert.rejects(()=>db.prepare('DELETE FROM inference_calls WHERE id=?').bind(winner.id).run());
 // Undispatched expired usage releases only its own shadow reservation.
 const unused=await account(),unusedId=crypto.randomUUID();const period=await reserve(unused,unusedId);await cancelStandardAI(scope(unused),unused,unusedId);await ensureInferenceBudget(scope(unused),unused,period,'explore');assert.equal((await db.prepare('SELECT reserved_micros FROM inference_budgets WHERE user_id=?').bind(unused).first()).reserved_micros,0);
 // ACK and main run concurrently, share budget, and carry only latest-message context.
 const ackUser=await account(),ackTurn=crypto.randomUUID();
 let mainRelease,registeredResolve;
 const mainGate=new Promise(resolve=>{mainRelease=resolve;releaseMain=resolve;}),registered=new Promise(resolve=>registeredResolve=resolve);
 let background;
 const response=text=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:10,output_tokens:10}});
 const request=sendAIChat(scope(ackUser),ackUser,ackTurn,0,'Check my site',config,async(url,init)=>{
  const body=JSON.parse(init.body);
  if(body.max_output_tokens===256){assert.equal(body.input.length,3);assert.equal(body.input[0].content,agentContentPolicy);assert.match(body.input[1].content,/^Classify/);assert.equal(body.input[2].content,'Check my site');assert.equal(body.max_output_tokens,256);assert.equal(body.model,config.model);return response(JSON.stringify({intent:'troubleshooting'}));}
  await mainGate;return response(JSON.stringify({reply:'Here are the next steps.',action:null}));
 },{background:promise=>{background=promise;registeredResolve();}});
 await Promise.race([registered,request.then(result=>{throw Error('Main request ended before ACK registration: '+JSON.stringify(result));})]);await background;
 assert.match((await readAcknowledgment(scope(ackUser),ackUser,ackTurn)).ack,/problem you described/);
 assert.equal((await readAcknowledgment(scope(user),user,ackTurn)).ack,null);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM inference_calls WHERE turn_id=?').bind(ackTurn).first()).n,2);
 mainRelease();assert.equal((await request).status,200);
 assert.equal((await readAcknowledgment(scope(ackUser),ackUser,ackTurn)).ack,null);
 assert.equal((await db.prepare('SELECT SUM(estimated_micros) total FROM inference_calls WHERE turn_id=?').bind(ackTurn).first()).total,6);
 // Operator diagnostics include consumed resources behind unsuccessful Chat turns.
 const diagnosticUser=await account(),heldId=crypto.randomUUID();await reserve(diagnosticUser,heldId);await dispatchStandardAI(scope(diagnosticUser),diagnosticUser,heldId);await dispatchInference(scope(diagnosticUser),diagnosticUser,heldId);await uncertainInference(scope(diagnosticUser),diagnosticUser,heldId);
 const reservedId=crypto.randomUUID();await reserve(diagnosticUser,reservedId);
 const readOnly={prepare(sql){assert.match(sql,/^(SELECT|WITH)\b/);return db.prepare(sql);}};
 const report=await fairUseReport(readOnly),ops=report.inferenceOperations30d;assert.equal(report.mode.mode,'monitor');assert.deepEqual(report.activeRestrictions,[]);assert.equal(ops.actualProviderExpenseMicros,null);
 assert.ok(ops.groups.some(r=>r.role==='ack'&&r.providerState==='observed'));assert.ok(ops.groups.some(r=>r.providerState==='observed'&&r.chatState==='failed'&&r.observedShadowMicros>0));assert.ok(ops.groups.some(r=>r.providerState==='uncertain'&&r.heldShadowMicros>0));assert.ok(ops.groups.some(r=>r.providerState==='released'&&r.heldShadowMicros===0));
 const ownerOps=(await fairUseReport(readOnly,diagnosticUser)).inferenceOperations30d;assert.equal(ownerOps.totals.calls,2);assert.equal(ownerOps.totals.observedShadowMicros,0);assert.ok(ownerOps.totals.heldShadowMicros>0);assert.deepEqual(ownerOps.groups.map(r=>r.providerState).sort(),['reserved','uncertain']);
 const raw=JSON.stringify(ops);for(const value of [diagnosticUser,heldId,config.model,config.baseURL,'Say hello','Here are the next steps.'])assert.ok(!raw.includes(value));
 const future=await fairUseReport(readOnly,diagnosticUser,Date.now()+32*86400000);assert.equal(future.inferenceOperations30d.totals.calls,0);
 const held=await db.prepare('SELECT status FROM inference_calls WHERE id=?').bind(heldId).first();assert.equal(held.status,'uncertain');
 console.log('Inference operations report passed: failed/ack usage, reserved/unknown/released states, account scope, time window, no content/identity/provider configuration, no writes and no enforcement.');
 console.log('Model cost receipts passed: runtime Muse pin, shadow budget, chat/ack concurrency, minimal ack context, receipt ownership, hidden late ack, unknown holds, replay, atomic budget admission, immutable identity and undispatched release.');
}catch(error){console.error(error);throw error;}finally{releaseMain?.();await fixture.close();}
