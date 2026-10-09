import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {workspaceFixture} from './workspace-identity.mjs';
/** Owner-side funding fixtures shared by the WH-073 standard-service independence tests.
 * `modules` is the caller's currentFixtureModules bundle and must declare src/model-costs.ts, src/gateway-spend.ts and
 * src/inference-routing.ts (admission capabilities are module-private to one bundle). Standard allowance: the owner's
 * monthly inference budget (explore ceiling) fully spent, the same row tests/model-costs.mjs exhausts. Premium/operator
 * funding: task, account and platform buckets plus the premium credit bucket and an approved premium approval, each
 * spent to its limit, inserted as tests/gateway-spend.mjs creates them. */
export async function ownerFunding({db,modules}){
 const [costs,gateway,routing]=await Promise.all(['src/model-costs.ts','src/gateway-spend.ts','src/inference-routing.ts'].map(path=>modules.module(path)));
 const id=()=>crypto.randomUUID(),run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
 const period=new Date().toISOString().slice(0,7),scenario=JSON.parse(await readFile('tests/fixtures/inference-routing-scenario.json','utf8'));
 const muse={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:'synthetic-not-a-secret',protocol:'responses'};
 async function account(){const auth=await workspaceFixture(db,modules.identity),o={user:auth.account,scope:await auth.scope(),task:id()};await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",o.user);return o;}
 async function standardAllowance(o,exhausted){await costs.ensureInferenceBudget(db,o.user,period,'explore');if(exhausted)await run('UPDATE inference_budgets SET spent_micros=budget_micros WHERE user_id=? AND period=?',o.user,period);}
 // Terms for one owner/task: a standard decision and a premium decision with an approval, both valid at call time.
 function terms(o){
  const now=Date.now(),expires=now+3600000,candidate={...scenario.candidates[0],rateValidFrom:now-1,rateValidUntil:expires,benchmark:{...scenario.candidates[0].benchmark,validUntil:expires}};
  const request={...scenario.request,ownerId:o.user,taskId:o.task,now},approval={approvalId:o.gw.approval,ownerId:o.user,taskId:o.task,catalogVersion:request.catalogVersion,policy:routing.inferenceRoutingPolicy,expiresAt:expires,candidateIds:[candidate.id],tariffId:'synthetic-tariff',retailMultiplierBps:15000,maxCustomerMicros:4000,remainingCustomerMicros:10000};
  return {candidate,request,approval};
 }
 // `spent` selects which scopes are exhausted (limit === spent, so nothing remains); the rest are funded.
 async function gatewayFunding(o,spent=['task','account','platform','premium','approval']){
  o.gw={task:id(),account:id(),platform:id(),premium:id(),approval:id()};const {approval}=terms(o);
  for(const [scope,limit] of [['task',3000],['account',3000],['platform',3000],['premium',10000],['approval',4000]])
   await run('INSERT INTO gateway_spend_buckets(id,scope,user_id,task_id,limit_micros,spent_micros,terms_json) VALUES(?,?,?,?,?,?,?)',o.gw[scope],scope,scope==='platform'?null:o.user,scope==='task'||scope==='approval'?o.task:null,limit,spent.includes(scope)?limit:0,scope==='approval'?JSON.stringify(approval):'{}');
 }
 const reserveGateway=(o,tier)=>{const {candidate,request,approval}=terms(o),premium=tier==='premium',decision=routing.planInferenceRoute([{...candidate,premium}],premium?{...request,tier:'premium',premium:approval}:request);assert.ok(decision.selected,'The synthetic decision is valid');
  return gateway.reserveGatewaySpend(db,o.user,id(),decision,premium?o.gw:{task:o.gw.task,account:o.gw.account,platform:o.gw.platform});};
 // Owner standard admission exactly as Chat does it: request receipt, pending turn and priced reservation in one batch.
 const reserveStandard=o=>{const turn=id(),now=new Date().toISOString();return o.scope.batch([
  o.scope.prepare('INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,?,?)').bind(turn,o.user,'a'.repeat(64),now,now),
  o.scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Test','Pending',?,'ai','pending')").bind(turn,o.user,Math.floor(Math.random()*1000000000),now),
  costs.inferenceReservation(o.scope,o.user,turn,period,muse,100000,10000)]);};
 const tables=['inference_budgets','inference_calls','gateway_spend_buckets','gateway_spend_attempts','standard_ai_requests','gateway_inference_requests'];
 // Every funding row, in full: a visitor or scheduled route may not move a balance, start an attempt or dispatch anything.
 const funding=async()=>Object.fromEntries(await Promise.all(tables.map(async t=>[t,(await db.prepare(`SELECT * FROM ${t} ORDER BY 1,2`).all()).results])));
 const exhausted={
  'funded owner (no balance set)':{},
  'standard usage allowance exhausted':{
   seed:o=>standardAllowance(o,true),
   verify:async o=>{const b=await row('SELECT budget_micros,spent_micros,reserved_micros FROM inference_budgets WHERE user_id=? AND period=?',o.user,period);assert.ok(b.budget_micros>0&&b.spent_micros===b.budget_micros&&b.reserved_micros===0,'Nothing remains of the standard allowance');},
   // Owner maintenance would be refused by the budget trigger, and the batch leaves no turn or receipt behind.
   refused:async o=>{const turns=(await row('SELECT COUNT(*) n FROM chat_turns WHERE user_id=?',o.user)).n;await assert.rejects(()=>reserveStandard(o),/inference_budget/);assert.equal((await row('SELECT COUNT(*) n FROM chat_turns WHERE user_id=?',o.user)).n,turns);assert.equal((await row('SELECT COUNT(*) n FROM standard_ai_requests WHERE user_id=?',o.user)).n,0);}},
  'premium credit, approval and operator funding exhausted':{
   seed:o=>gatewayFunding(o),
   verify:async o=>{for(const scope of ['task','account','platform','premium','approval']){const b=await row('SELECT limit_micros,held_micros,spent_micros FROM gateway_spend_buckets WHERE id=?',o.gw[scope]);assert.ok(b.limit_micros>0&&b.spent_micros===b.limit_micros&&b.held_micros===0,scope+' bucket has nothing remaining');}},
   refused:async o=>{for(const tier of ['standard','premium'])await assert.rejects(()=>reserveGateway(o,tier),e=>e.status===409,tier+' owner maintenance is unfundable');assert.equal((await row('SELECT COUNT(*) n FROM gateway_spend_attempts WHERE user_id=?',o.user)).n,0);}}
 };
 return {period,account,standardAllowance,gatewayFunding,reserveGateway,reserveStandard,funding,exhausted};
}
/** Nothing a visitor or service route returns may allow a shared or browser cache to keep content that can be revoked. */
export const uncacheable=response=>{const cache=response.headers.get('cache-control')??'';assert.match(cache,/no-store/);assert.ok(!/public|s-maxage|max-age=[1-9]|immutable|stale-/i.test(cache),cache);for(const h of ['etag','last-modified','expires'])assert.equal(response.headers.get(h),null,h);};
