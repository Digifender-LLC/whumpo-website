import {recordFixtureBenchmark} from '../tools/benchmark-evidence.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const bundled=await build({stdin:{resolveDir:process.cwd(),contents:"export {sendAIChat,reconcileChat} from './src/ai-chat.ts';export {getBilling} from './src/billing.ts';export {readStandardAI} from './src/standard-ai-usage.ts';export {ensureInferenceBudget} from './src/model-costs.ts';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';"},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const {sendAIChat,reconcileChat,getBilling,readStandardAI,ensureInferenceBudget}=m;
const fixture=await databaseFixture({d1:true}),db=fixture.db,identities=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
const config={baseURL:'https://opencode.ai/zen/go/v1',apiKey:'synthetic',model:'muse-spark-1.3-contributor',protocol:'responses'};
let calls=0;
const response=(text=JSON.stringify({reply:'Ready to help with your website.',action:null}))=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:100,output_tokens:200}});
const provider=async()=>{calls++;return response();};
async function account(){const a=await workspaceFixture(db,m),user=a.account;identities.set(user,a);scopes.set(user,await a.scope());await db.prepare("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(user).run();return user;}
async function snapshot(user){return (await db.prepare('SELECT * FROM stripe_paid_invoices WHERE user_id=? ORDER BY id').bind(user).all()).results;}
async function state(user,id){return db.prepare('SELECT status FROM chat_turns WHERE id=? AND user_id=?').bind(id,user).first();}
try{
 const user=await account();
 const before=await snapshot(user),id=crypto.randomUUID();assert.equal((await sendAIChat(scope(user),user,id,0,'Help with my website',config,provider)).status,200);assert.equal((await readStandardAI(scope(user),user,id)).state,'completed');assert.equal((await state(user,id)).status,'completed');assert.equal(calls,1);assert.deepEqual(await snapshot(user),before);
 assert.equal((await sendAIChat(scope(user),user,id,0,'Help with my website',config,provider)).status,200);assert.equal(calls,1);assert.equal((await sendAIChat(scope(user),user,id,0,'Changed request',config,provider)).status,409);assert.equal(calls,1);
 const internal=await db.prepare('SELECT status,estimated_micros FROM inference_calls WHERE id=?').bind(id).first();assert.equal(internal.status,'observed');assert.ok(internal.estimated_micros>0);
 const bad=crypto.randomUUID();await sendAIChat(scope(user),user,bad,1,'Change the website',config,async()=>{calls++;return response('invalid proposal');});assert.equal((await state(user,bad)).status,'failed');assert.equal((await readStandardAI(scope(user),user,bad)).state,'completed');assert.deepEqual(await snapshot(user),before);
 const uncertain=crypto.randomUUID();await sendAIChat(scope(user),user,uncertain,2,'Inspect my website',config,async()=>{calls++;throw Error('Synthetic transport failure');});assert.equal((await state(user,uncertain)).status,'uncertain');assert.equal((await readStandardAI(scope(user),user,uncertain)).state,'uncertain');assert.deepEqual(await snapshot(user),before);
 // Competing messages claim one revision and create no orphan standard receipt.
 const race=await account();let entered,release;const started=new Promise(r=>entered=r),gate=new Promise(r=>release=r);let raceCalls=0;
 const one=crypto.randomUUID(),two=crypto.randomUUID();const run=sendAIChat(scope(race),race,one,0,'First request',config,async()=>{raceCalls++;entered();await gate;return response();});await started;
 assert.equal((await sendAIChat(scope(race),race,two,0,'Second request',config,provider)).status,409);assert.equal(await readStandardAI(scope(race),race,two),null);assert.equal((await sendAIChat(scope(race),race,one,0,'First request',config,provider)).status,200);release();await run;assert.equal(raceCalls,1);
 // Internal spend capacity failure rolls back admission, never asks for customer credits.
 const capped=await account(),period=new Date().toISOString().slice(0,7);await ensureInferenceBudget(scope(capped),capped,period,'explore');await db.prepare('UPDATE inference_budgets SET spent_micros=budget_micros WHERE user_id=?').bind(capped).run();const capId=crypto.randomUUID(),priorCalls=calls;const rejected=await sendAIChat(scope(capped),capped,capId,0,'Help with my site',config,provider);assert.equal(rejected.status,503);assert.equal(calls,priorCalls);assert.equal(await readStandardAI(scope(capped),capped,capId),null);assert.equal(await state(capped,capId),null);
 // Lost admission acknowledgment does not generate a replacement provider request.
 const lost=await account(),lostId=crypto.randomUUID();let injected=false;
 const flaky=await identities.get(lost).scope(interceptDatabase(db,/INSERT INTO standard_ai_requests/,async()=>{},async()=>{if(!injected){injected=true;throw Error('Synthetic admission acknowledgment lost');}}));
 await assert.rejects(()=>sendAIChat(flaky,lost,lostId,0,'Help with my site',config,provider),/acknowledgment lost/);assert.equal(injected,true);const callsBeforeRetry=calls;assert.equal((await sendAIChat(scope(lost),lost,lostId,0,'Help with my site',config,provider)).status,200);assert.equal(calls,callsBeforeRetry);await db.prepare('UPDATE chat_turns SET created_at=? WHERE id=?').bind(new Date(Date.now()-180000).toISOString(),lostId).run();await reconcileChat(scope(lost),lost);assert.equal((await readStandardAI(scope(lost),lost,lostId)).state,'released');
 await recordFixtureBenchmark(db,'failures',{transportCalls:calls+raceCalls,runtimeCalls:0});
 console.log('Standard Chat passed: standard assistance without a customer credit ledger, exact replay, changed-ID refusal, failed proposal cost retention, uncertain provider outcomes, concurrent revision claims, atomic capacity denial and lost-admission recovery.');
}finally{await fixture.close();}
