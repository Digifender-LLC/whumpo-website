import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {readAcknowledgment}=await module('src/acknowledgment.ts');
const {sendAIChat,configuredAI}=await module('src/ai-chat.ts'),{readChat}=await module('src/chat.ts');
const {ensureBilling,usageReservationStatement,dispatchUsage}=await module('src/billing.ts');
const {ensureInferenceBudget,inferenceReservation,dispatchInference,observeInference,uncertainInference}=await module('src/model-costs.ts');
const dir=await mkdtemp('/tmp/whumpo-model-costs-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:'synthetic',protocol:'responses'};
const environment={ENVIRONMENT:'test',AI_API_KEY:config.apiKey,AI_BASE_URL:config.baseURL,AI_MODEL:config.model,AI_PROTOCOL:'responses'};
assert.equal(configuredAI(environment).model,config.model);assert.equal(configuredAI({...environment,AI_MODEL:'paid-other'}),undefined);assert.equal(configuredAI({...environment,ENVIRONMENT:'local'}),undefined);
let calls=0;
const provider=text=>async()=>{calls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:100,output_tokens:200}});};
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(id).run();return id;}
async function send(user,transport){const id=crypto.randomUUID(),chat=await readChat(db,user);return {id,result:await sendAIChat(db,user,id,chat.state.revision,'Say hello',config,transport)};}
async function reserve(user,id,input=1000,output=1000){const now=new Date(),{period}=await ensureBilling(db,user);await ensureInferenceBudget(db,user,period,'explore');await db.batch([
 usageReservationStatement(db,user,id,'a'.repeat(64),1,period,now),
 db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Test','Pending',?,'ai','pending')").bind(id,user,Math.floor(Math.random()*1000000000),now.toISOString()),
 inferenceReservation(db,user,id,period,config,input,output)
]);return period;}
try{
 const user=await account(),other=await account();
 const first=await send(user,provider(JSON.stringify({reply:'Hello',action:null})));assert.equal(first.result.status,200);
 const receipt=await db.prepare('SELECT * FROM inference_calls WHERE id=?').bind(first.id).first();assert.equal(receipt.model,config.model);assert.equal(receipt.cost_basis,'subscription-shadow');assert.equal(receipt.estimated_micros,50);assert.equal(receipt.status,'observed');assert.equal(receipt.input_tokens,100);
 const budget=await db.prepare('SELECT * FROM inference_budgets WHERE user_id=?').bind(user).first();assert.equal(budget.spent_micros,50);assert.equal(budget.reserved_micros,0);
 await sendAIChat(db,user,first.id,0,'Say hello',config,provider('unused'));assert.equal(calls,1);
 // Customer-visible failure still consumed model resources: retain internal observed cost.
 const bad=await send(other,provider('invalid action envelope'));assert.equal(bad.result.status,200);
 assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(bad.id).first()).status,'failed');
 assert.equal((await db.prepare('SELECT estimated_micros FROM inference_calls WHERE id=?').bind(bad.id).first()).estimated_micros,50);
 // Timeout/unknown provider outcome holds the quote and never re-dispatches.
 const unknown=await account(),attempt=await send(unknown,async()=>{calls++;throw new DOMException('unknown','TimeoutError');});
 const uncertain=await db.prepare('SELECT status,reserved_micros FROM inference_calls WHERE id=?').bind(attempt.id).first();assert.equal(uncertain.status,'uncertain');assert.ok(uncertain.reserved_micros>0);
 const before=calls;await sendAIChat(db,unknown,attempt.id,0,'Say hello',config,provider('unused'));assert.equal(calls,before);
 // Budget failure rolls back customer usage and chat, without sending to provider.
 const exhausted=await account();await ensureBilling(db,exhausted);await ensureInferenceBudget(db,exhausted,new Date().toISOString().slice(0,7),'explore');await db.prepare('UPDATE inference_budgets SET spent_micros=budget_micros WHERE user_id=?').bind(exhausted).run();
 const denied=await send(exhausted,provider('unused'));assert.equal(denied.result.status,402);assert.equal(calls,before);assert.equal(await db.prepare('SELECT id FROM chat_turns WHERE id=?').bind(denied.id).first(),null);assert.equal(await db.prepare('SELECT id FROM usage_operations WHERE id=?').bind(denied.id).first(),null);
 // Concurrent admissions share one wallet. Exactly one of two oversized quotes fits.
 const concurrent=await account(),ids=[crypto.randomUUID(),crypto.randomUUID()];
 const admissions=await Promise.allSettled(ids.map(id=>reserve(concurrent,id,100000000,10000000)));assert.equal(admissions.filter(x=>x.status==='fulfilled').length,1);
 const winner=(await db.prepare('SELECT id,reserved_micros FROM inference_calls WHERE user_id=?').bind(concurrent).first());assert.equal(winner.reserved_micros,12000000);
 await dispatchUsage(db,concurrent,winner.id);assert.equal(await dispatchInference(db,concurrent,winner.id),true);assert.equal(await dispatchInference(db,concurrent,winner.id),false);
 await uncertainInference(db,concurrent,winner.id);await observeInference(db,concurrent,winner.id,{text:'x',inputTokens:100,outputTokens:200});await observeInference(db,concurrent,winner.id,{text:'x',inputTokens:100,outputTokens:200});
 assert.equal((await db.prepare('SELECT spent_micros,reserved_micros FROM inference_budgets WHERE user_id=?').bind(concurrent).first()).spent_micros,50);
 await assert.rejects(()=>observeInference(db,concurrent,winner.id,{text:'x',inputTokens:101,outputTokens:200}));await assert.rejects(()=>observeInference(db,user,winner.id,{text:'x',inputTokens:100,outputTokens:200}));
 await assert.rejects(()=>db.prepare("UPDATE inference_calls SET model='other' WHERE id=?").bind(winner.id).run());
 await assert.rejects(()=>db.prepare('DELETE FROM inference_calls WHERE id=?').bind(winner.id).run());
 // Undispatched expired usage releases only its own shadow reservation.
 const unused=await account(),unusedId=crypto.randomUUID();const period=await reserve(unused,unusedId);await db.prepare("UPDATE usage_operations SET status='released',actual_units=0,quota_charged=0,credits_charged=0 WHERE id=?").bind(unusedId).run();await ensureInferenceBudget(db,unused,period,'explore');assert.equal((await db.prepare('SELECT reserved_micros FROM inference_budgets WHERE user_id=?').bind(unused).first()).reserved_micros,0);
 // ACK and main run concurrently, share budget, and carry only latest-message context.
 const ackUser=await account(),ackTurn=crypto.randomUUID();
 let mainRelease,registeredResolve;
 const mainGate=new Promise(resolve=>mainRelease=resolve),registered=new Promise(resolve=>registeredResolve=resolve);
 let background;
 const response=text=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:10,output_tokens:10}});
 const request=sendAIChat(db,ackUser,ackTurn,0,'Check my site',config,async(url,init)=>{
  const body=JSON.parse(init.body);
  if(body.input[0].content.startsWith('Classify')){assert.equal(body.input.length,2);assert.equal(body.input[1].content,'Check my site');assert.equal(body.max_output_tokens,256);assert.equal(body.model,config.model);return response(JSON.stringify({intent:'troubleshooting'}));}
  await mainGate;return response(JSON.stringify({reply:'Here are the next steps.',action:null}));
 },{background:promise=>{background=promise;registeredResolve();}});
 await registered;await background;
 assert.match((await readAcknowledgment(db,ackUser,ackTurn)).ack,/problem you described/);
 assert.equal((await readAcknowledgment(db,user,ackTurn)).ack,null);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM inference_calls WHERE turn_id=?').bind(ackTurn).first()).n,2);
 mainRelease();assert.equal((await request).status,200);
 assert.equal((await readAcknowledgment(db,ackUser,ackTurn)).ack,null);
 assert.equal((await db.prepare('SELECT SUM(estimated_micros) total FROM inference_calls WHERE turn_id=?').bind(ackTurn).first()).total,6);
 console.log('Model cost receipts passed: runtime Muse pin, shadow budget, chat/ack concurrency, minimal ack context, receipt ownership, hidden late ack, unknown holds, replay, atomic budget admission, immutable identity and undispatched release.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
