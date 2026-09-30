import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {sendAIChat,reconcileChat}=await module('src/ai-chat.ts');
const {getBilling,reserveUsage,dispatchUsage,finishUsage}=await module('src/billing.ts');
const {readStandardAI}=await module('src/standard-ai-usage.ts');
const {ensureInferenceBudget}=await module('src/model-costs.ts');
const dir=await mkdtemp('/tmp/whumpo-standard-chat-');
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const config={baseURL:'https://opencode.ai/zen/go/v1',apiKey:'synthetic',model:'muse-spark-1.3-contributor',protocol:'responses'};
let calls=0;
const response=(text=JSON.stringify({reply:'Ready to help with your website.',action:null}))=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:100,output_tokens:200}});
const provider=async()=>{calls++;return response();};
async function account(){const user=crypto.randomUUID();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',new Date().toISOString()).run();await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(user).run();await getBilling(db,user);return user;}
async function snapshot(user){return Promise.all(['billing_accounts','usage_periods','usage_operations','billing_ledger','credit_grants'].map(async table=>({table,rows:(await db.prepare('SELECT * FROM '+table+' WHERE user_id=?').bind(user).all()).results})));}
async function state(user,id){return db.prepare('SELECT status FROM chat_turns WHERE id=? AND user_id=?').bind(id,user).first();}
try{
 const user=await account(),historical=crypto.randomUUID();await reserveUsage(db,user,historical,'a'.repeat(64),50);await dispatchUsage(db,user,historical);await finishUsage(db,user,historical,50);assert.equal((await getBilling(db,user)).quota.available,0);
 const before=await snapshot(user),id=crypto.randomUUID();assert.equal((await sendAIChat(db,user,id,0,'Help with my website',config,provider)).status,200);assert.equal((await readStandardAI(db,user,id)).state,'completed');assert.equal((await state(user,id)).status,'completed');assert.equal(calls,1);assert.deepEqual(await snapshot(user),before);
 assert.equal((await sendAIChat(db,user,id,0,'Help with my website',config,provider)).status,200);assert.equal(calls,1);assert.equal((await sendAIChat(db,user,id,0,'Changed request',config,provider)).status,409);assert.equal(calls,1);
 const internal=await db.prepare('SELECT status,estimated_micros FROM inference_calls WHERE id=?').bind(id).first();assert.equal(internal.status,'observed');assert.ok(internal.estimated_micros>0);
 const bad=crypto.randomUUID();await sendAIChat(db,user,bad,1,'Change the website',config,async()=>{calls++;return response('invalid proposal');});assert.equal((await state(user,bad)).status,'failed');assert.equal((await readStandardAI(db,user,bad)).state,'completed');assert.deepEqual(await snapshot(user),before);
 const uncertain=crypto.randomUUID();await sendAIChat(db,user,uncertain,2,'Inspect my website',config,async()=>{calls++;throw Error('Synthetic transport failure');});assert.equal((await state(user,uncertain)).status,'uncertain');assert.equal((await readStandardAI(db,user,uncertain)).state,'uncertain');assert.deepEqual(await snapshot(user),before);
 // Admission and credit balances remain separate even with explicit legacy overage enabled.
 await db.prepare('UPDATE billing_accounts SET overage_enabled=1,credits_available=100 WHERE user_id=?').bind(user).run();const creditBefore=await snapshot(user),creditId=crypto.randomUUID();await sendAIChat(db,user,creditId,3,'Help with my site layout',config,provider);assert.deepEqual(await snapshot(user),creditBefore);
 // Competing messages claim one revision and create no orphan standard receipt.
 const race=await account();let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let raceCalls=0;
 const one=crypto.randomUUID(),two=crypto.randomUUID();const run=sendAIChat(db,race,one,0,'First request',config,async()=>{raceCalls++;entered();await gate;return response();});await started;
 assert.equal((await sendAIChat(db,race,two,0,'Second request',config,provider)).status,409);assert.equal(await readStandardAI(db,race,two),null);assert.equal((await sendAIChat(db,race,one,0,'First request',config,provider)).status,200);release();await run;assert.equal(raceCalls,1);
 // Internal spend capacity failure rolls back admission, never asks for customer credits.
 const capped=await account(),period=new Date().toISOString().slice(0,7);await ensureInferenceBudget(db,capped,period,'explore');await db.prepare('UPDATE inference_budgets SET spent_micros=budget_micros WHERE user_id=?').bind(capped).run();const capId=crypto.randomUUID(),priorCalls=calls;const rejected=await sendAIChat(db,capped,capId,0,'Help with my site',config,provider);assert.equal(rejected.status,503);assert.equal(calls,priorCalls);assert.equal(await readStandardAI(db,capped,capId),null);assert.equal(await state(capped,capId),null);
 // Lost admission acknowledgment does not generate a replacement provider request.
 const lost=await account(),lostId=crypto.randomUUID();let injected=false;
 const flaky={prepare:sql=>db.prepare(sql),async batch(statements){const result=await db.batch(statements);if(!injected&&await readStandardAI(db,lost,lostId)){injected=true;throw Error('Synthetic admission acknowledgment lost');}return result;}};
 await assert.rejects(()=>sendAIChat(flaky,lost,lostId,0,'Help with my site',config,provider),/acknowledgment lost/);const callsBeforeRetry=calls;assert.equal((await sendAIChat(db,lost,lostId,0,'Help with my site',config,provider)).status,200);assert.equal(calls,callsBeforeRetry);await db.prepare('UPDATE chat_turns SET created_at=? WHERE id=?').bind(new Date(Date.now()-180000).toISOString(),lostId).run();await reconcileChat(db,lost);assert.equal((await readStandardAI(db,lost,lostId)).state,'released');
 console.log('Standard Chat passed: zero monthly units/credits, explicit legacy overage non-spend, exact replay, changed-ID refusal, failed proposal cost retention, uncertain provider outcomes, concurrent revision claims, atomic capacity denial and lost-admission recovery.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
