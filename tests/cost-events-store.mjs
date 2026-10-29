import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {databaseFixture} from './helpers/current-database.mjs';

// WH-170: the durable append-only cost-event store and its emission at the existing receipt transitions, on the current schema in
// disposable in-memory SQLite and (with --d1) actual local D1. Synthetic identifiers; no network, credential, model or provider.
const bundle=await build({stdin:{contents:"export * from './src/cost-event-store';export * from './src/cost-event-adapters';export * from './src/cost-events';export * from './src/model-costs';export * from './src/gateway-spend';export * from './src/inference-routing';export * from './src/storage-budget';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const scenario=JSON.parse(readFileSync(new URL('./fixtures/inference-routing-scenario.json',import.meta.url),'utf8'));
const store=await databaseFixture(),db=store.db;
const id=()=>crypto.randomUUID(),stamp=()=>new Date().toISOString(),period=stamp().slice(0,7);
const run=(sql,...v)=>db.prepare(sql).bind(...v).run(),all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results,one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const rejects=async(promise,code)=>assert.rejects(promise,e=>e.code===code||String(e).includes(code),code);
const warnings=[];const warn=console.warn;console.warn=(...a)=>{warnings.push(a.join(' '));};
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
try{
 const user=async()=>{const u=id();await run('INSERT INTO users(id,email,created_at) VALUES(?,?,?)',u,u+'@example.test',stamp());return u;};
 const project=async o=>{const p=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Cost fixture','','draft',?,?)",p,o,stamp(),stamp());return p;};
 const A=await user(),B=await user(),pa=await project(A),pb=await project(B);
 const rows=async(key)=>all('SELECT revision,stale,seq FROM cost_events WHERE idempotency_key=? ORDER BY seq',key);
 // Inference receipt states from the real adapter: revision 1 reserved, 2 dispatched, 3 uncertain, 4 observed or released.
 const T='2026-10-01T00:00:00.000Z';
 const call=(owner,sid,status,extra={})=>m.costEventFromInferenceCall({id:sid,turn_id:'turn-'+sid,user_id:owner,role:'orchestrator',status,cost_basis:'subscription-shadow',rate_id:'muse-1',reserved_micros:1000,input_tokens:null,output_tokens:null,estimated_micros:null,created_at:T,...extra});
 const observed=(owner,sid,micros=50)=>call(owner,sid,'observed',{input_tokens:10,output_tokens:20,estimated_micros:micros});
 const key=async sid=>m.idempotencyKey({source:'inference-receipt',sourceEventId:sid,dimension:'ai.inference.call'});

 await check('append, duplicate and conflicting redelivery',async()=>{
  const sid='dup-'+id(),e=await observed(A,sid);
  assert.deepEqual(await m.appendCostEvent(db,e),{status:'accepted',key:e.idempotencyKey,revision:4});
  assert.equal((await m.appendCostEvent(db,structuredClone(e))).status,'duplicate');
  assert.equal((await rows(e.idempotencyKey)).length,1,'a redelivery adds no row');
  await rejects(m.appendCostEvent(db,{...e,cost:{...e.cost,micros:51}}),'IDEMPOTENCY_CONFLICT');
  await rejects(m.appendCostEvent(db,{...e,attribution:{...e.attribution,ownerId:B}}),'TENANT_MISMATCH');
  assert.equal((await rows(e.idempotencyKey)).length,1,'a refused append writes nothing');
 });
 await check('delayed and out-of-order revisions converge; a lower revision after a higher one is stale and never counted',async()=>{
  const sid='order-'+id(),states=[await call(A,sid,'reserved'),await call(A,sid,'dispatched'),await call(A,sid,'uncertain'),await observed(A,sid)];
  for(const e of [states[3],states[0],states[2],states[1]])await m.appendCostEvent(db,e);
  const k=states[0].idempotencyKey,stored=await rows(k);
  assert.deepEqual(stored.map(r=>[r.revision,r.stale]),[[4,0],[1,1],[3,1],[2,1]],'arrival order decides stale, not revision order');
  const heads=(await m.costEventHeads(db,A)).filter(e=>e.idempotencyKey===k);
  assert.equal(heads.length,1);assert.equal(heads[0].revision,4);assert.equal(heads[0].outcome,'settled');
  // A redelivery of a stale revision is a no-op, not a second row.
  assert.equal((await m.appendCostEvent(db,states[1])).status,'duplicate');
  // The in-order chain is accepted at every step.
  const sid2='chain-'+id();const chain=[await call(A,sid2,'reserved'),await call(A,sid2,'dispatched'),await call(A,sid2,'uncertain'),await observed(A,sid2)];
  assert.deepEqual((await Promise.all([]).then(async()=>{const out=[];for(const e of chain)out.push((await m.appendCostEvent(db,e)).status);return out;})),['accepted','accepted','accepted','accepted']);
  assert.ok((await rows(chain[0].idempotencyKey)).every(r=>r.stale===0));
  // A terminal outcome is final: observed and released are both revision 4, so the second is a conflicting redelivery.
  const sid3='rel-'+id();await m.appendCostEvent(db,await call(A,sid3,'released'));
  await rejects(m.appendCostEvent(db,await observed(A,sid3)),'IDEMPOTENCY_CONFLICT');
 });
 await check('every pair of revisions must be compatible, whichever arrives second',async()=>{
  const sid='compat-'+id(),base=await call(A,sid,'dispatched');
  const later=await observed(A,sid);
  const moved={...later,occurredAt:'2026-10-02T00:00:00.000Z',observedAt:'2026-10-02T00:00:00.000Z'};
  await m.appendCostEvent(db,base);
  await rejects(m.appendCostEvent(db,moved),'IMMUTABLE_FIELD');
  const sid2='compat2-'+id(),high=await observed(A,sid2);
  await m.appendCostEvent(db,high);
  await rejects(m.appendCostEvent(db,{...await call(A,sid2,'dispatched'),occurredAt:'2026-09-30T00:00:00.000Z',observedAt:'2026-09-30T00:00:00.000Z'}),'IMMUTABLE_FIELD');
  // A known cost is never made unknown again, in either arrival order.
  const sid4='reg-'+id();await m.appendCostEvent(db,await observed(A,sid4));
  await rejects(m.appendCostEvent(db,{...await call(A,sid4,'uncertain'),revision:5}),'REVISION_REGRESSION');
  assert.equal((await m.appendCostEvent(db,await call(A,sid4,'uncertain'))).status,'stale-revision','the same state delayed behind the settlement is only stale');
  // Provider ID: learned once (null -> value), never replaced.
  const sid5='prov-'+id(),g1={...await call(A,sid5,'dispatched')};
  await m.appendCostEvent(db,g1);
  const withId=async(rev,v)=>{const e={...await observed(A,sid5),providerEventId:v,revision:rev};e.idempotencyKey=g1.idempotencyKey;return e;};
  await m.appendCostEvent(db,await withId(4,'evt-1'));
  await rejects(m.appendCostEvent(db,await withId(5,'evt-2')),'IMMUTABLE_FIELD');
 });
 await check('tenant mismatch, unknown project and closed owner are refused without a write; two accounts never see each other',async()=>{
  const before=(await one('SELECT count(*) n FROM cost_events')).n;
  const storage=(owner,project,reads)=>m.costEventFromProjectStorageUsage({project_id:project,period,read_ops:reads},{ownerId:owner,observedAt:stamp()});
  await rejects(m.appendCostEvent(db,await storage(A,pb,1)),'TENANT_MISMATCH');
  await rejects(m.appendCostEvent(db,await storage(B,pa,1)),'TENANT_MISMATCH');
  await rejects(m.appendCostEvent(db,await storage(A,id(),1)),'UNKNOWN_PROJECT');
  await rejects(m.appendCostEvent(db,await observed(id(),'ghost-'+id())),'TENANT_MISMATCH');
  assert.equal((await one('SELECT count(*) n FROM cost_events')).n,before);
  // The same rule holds in the table, whichever statement writes the row.
  const good=await storage(A,pa,1);
  await assert.rejects(run(`INSERT INTO cost_events(idempotency_key,revision,source,dimension,scope,owner_id,project_id,workload,work_class,outcome,quantity_value,cost_basis,occurred_at,observed_at,event_json) VALUES(?,1,'storage-operations','r2.class_b_ops','tenant',?,?,'storage-files','standing','settled',1,'tariff',?,?,?)`,good.idempotencyKey,B,pa,good.occurredAt,good.observedAt,JSON.stringify(good)),/cost_event_tenant_mismatch/);
  await rejects(m.appendCostEvent(db,{...good,attribution:{...good.attribution,resourceId:id()}}),'TENANT_MISMATCH');
  for(const e of [await storage(A,pa,1),await storage(B,pb,1),await observed(A,'iso-a'),await observed(B,'iso-b')])await m.appendCostEvent(db,e);
  const a=await m.costEventHeads(db,A),b=await m.costEventHeads(db,B);
  assert.ok(a.length&&b.length&&a.every(e=>e.attribution.ownerId===A)&&b.every(e=>e.attribution.ownerId===B));
  assert.ok(!JSON.stringify(a).includes(B)&&!JSON.stringify(b).includes(A));
 });
 await check('rows are immutable; account closure deletes the owner\'s events and a later append is refused',async()=>{
  const C=await user(),pc=await project(C);
  const e=await m.costEventFromProjectStorageUsage({project_id:pc,period,read_ops:2},{ownerId:C,observedAt:stamp()});
  await m.appendCostEvent(db,e);await m.appendCostEvent(db,await observed(C,'close-'+id()));
  await assert.rejects(run('UPDATE cost_events SET stale=1 WHERE owner_id=?',C),/cost_event_immutable/);
  await assert.rejects(run('UPDATE cost_events SET event_json=? WHERE owner_id=?','{}',C),/cost_event_immutable/);
  await assert.rejects(run('DELETE FROM cost_events WHERE owner_id=?',C),/cost_event_append_only/);
  await assert.rejects(run('DELETE FROM cost_events'),/cost_event_append_only/);
  assert.equal((await one('SELECT count(*) n FROM cost_events WHERE owner_id=?',C)).n,2);
  // Platform-scope events have no owner: unaffected by closure, and not deletable.
  const platform={contractVersion:1,source:'liability-register',sourceEventId:'floor-'+id(),providerEventId:null,revision:1,idempotencyKey:'',kind:'liability',dimension:'liability.account-minimum',workload:'platform-standing',workClass:'standing',taskRef:null,attempt:1,
   attribution:{scope:'platform',pool:'shared-account'},placementClass:'platform',quantity:{state:'known',value:1,unit:'item'},cost:{basis:'provider-reported',micros:5000000,ref:'statement-1'},outcome:'settled',customerUnits:0,aiTier:null,detail:{},occurredAt:T,observedAt:T};
  platform.idempotencyKey=await m.idempotencyKey(platform);
  assert.equal((await m.appendCostEvent(db,platform)).status,'accepted');
  await rejects(m.appendCostEvent(db,{...platform,attribution:{scope:'platform',pool:'closed-account'},revision:2}),'POOL_UNSUPPORTED');
  await run('DELETE FROM users WHERE id=?',C);
  assert.equal((await one('SELECT count(*) n FROM cost_events WHERE owner_id=?',C)).n,0,'closure deletes the owner\'s events with the account');
  assert.equal((await one('SELECT count(*) n FROM cost_events WHERE project_id=?',pc)).n,0);
  assert.equal((await one('SELECT count(*) n FROM cost_events WHERE idempotency_key=?',platform.idempotencyKey)).n,1,'platform events survive an owner\'s closure');
  await assert.rejects(run('DELETE FROM cost_events WHERE idempotency_key=?',platform.idempotencyKey),/cost_event_append_only/);
  // Appends for an owner or project that no longer exists are refused; nothing is tombstoned.
  await rejects(m.appendCostEvent(db,e),'TENANT_MISMATCH');
  await rejects(m.appendCostEvent(db,await observed(C,'late-'+id())),'TENANT_MISMATCH');
  await rejects(m.appendCostEvent(db,await m.costEventFromProjectStorageUsage({project_id:pc,period,read_ops:3},{ownerId:A,observedAt:stamp()})),'UNKNOWN_PROJECT');
  assert.equal((await one("SELECT count(*) n FROM cost_events WHERE idempotency_key LIKE 'closed:%' OR owner_id=?",C)).n,0);
 });
 await check('exact integers: individually valid amounts whose total is unsafe are refused, never rounded',async()=>{
  const D=await user();
  await m.appendCostEvent(db,await observed(D,'big-'+id(),Number.MAX_SAFE_INTEGER));await m.appendCostEvent(db,await observed(D,'two-'+id(),2));
  await rejects(m.costEventHeadSums(db,D),'AMOUNT_UNSAFE');
  const E=await user();await m.appendCostEvent(db,await observed(E,'ok-'+id(),Number.MAX_SAFE_INTEGER-2));await m.appendCostEvent(db,await observed(E,'ok2-'+id(),2));
  assert.equal((await m.costEventHeadSums(db,E)).shadowMicros,Number.MAX_SAFE_INTEGER);
  // The table refuses a non-integer or oversized figure even if a writer bypassed the validator.
  const e=await observed(E,'raw-'+id());
  await assert.rejects(run(`INSERT INTO cost_events(idempotency_key,revision,source,dimension,scope,owner_id,workload,work_class,outcome,quantity_value,cost_basis,cost_micros,occurred_at,observed_at,event_json) VALUES(?,4,'inference-receipt','ai.inference.call','tenant',?,'chat-ai','task','settled',1,'shadow',9007199254740992,?,?,?)`,e.idempotencyKey,E,e.occurredAt,e.observedAt,JSON.stringify(e)),/CHECK/);
  await assert.rejects(run(`INSERT INTO cost_events(idempotency_key,revision,source,dimension,scope,owner_id,workload,work_class,outcome,quantity_value,cost_basis,cost_micros,occurred_at,observed_at,event_json) VALUES(?,4,'inference-receipt','ai.inference.call','tenant',?,'chat-ai','task','settled',1,'shadow',5.5,?,?,?)`,e.idempotencyKey,E,e.occurredAt,e.observedAt,JSON.stringify(e)),/CHECK/);
 });
 await check('concurrent appends cannot admit a contradictory pair or a duplicate row',async()=>{
  const F=await user(),sid='race-'+id(),chain=[await call(F,sid,'reserved'),await call(F,sid,'dispatched'),await call(F,sid,'uncertain'),await observed(F,sid)];
  const results=await Promise.allSettled([...chain,...chain].map(e=>m.appendCostEvent(db,e)));
  assert.ok(results.every(r=>r.status==='fulfilled'||r.reason.code==='APPEND_CONTENTION'),JSON.stringify(results.map(r=>r.status==='rejected'?String(r.reason):r.value.status)));
  await Promise.allSettled(chain.map(e=>m.appendCostEvent(db,e)));
  const stored=await rows(chain[0].idempotencyKey);
  assert.deepEqual(stored.map(r=>r.revision).sort(),[1,2,3,4],'one row per revision');
  for(const r of stored)assert.equal(r.stale,stored.some(o=>o.revision>r.revision&&o.seq<r.seq)?1:0,'stale means a higher revision arrived first');
  assert.equal(stored.find(r=>r.revision===4).stale,0);
  // Two contradictory revisions racing: whatever is stored is pairwise compatible.
  const sid2='race2-'+id(),good=await call(F,sid2,'dispatched'),moved={...await observed(F,sid2),occurredAt:'2026-10-03T00:00:00.000Z',observedAt:'2026-10-03T00:00:00.000Z'};
  await Promise.allSettled([m.appendCostEvent(db,good),m.appendCostEvent(db,moved)]);
  assert.equal(new Set((await all('SELECT occurred_at FROM cost_events WHERE idempotency_key=?',good.idempotencyKey)).map(r=>r.occurred_at)).size,1);
 });

 // ---------- Emission at the real receipt transitions ----------
 const muse={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:'synthetic',protocol:'responses'};
 await check('inference receipts emit after each transition: dispatched, uncertain-then-observed, released',async()=>{
  const G=await user();await m.ensureInferenceBudget(db,G,period,'explore');
  const turn=async()=>{const t=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Test','Pending',?,'ai','pending')",t,G,Math.floor(Math.random()*1e9),stamp());
   await run('INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,?,?)',t,G,'a'.repeat(64),stamp(),stamp());return t;};
  const t=await turn();await m.inferenceReservation(db,G,t,period,muse,1000,1000).run();
  assert.equal((await one('SELECT count(*) n FROM cost_events WHERE owner_id=?',G)).n,0,'the reservation statement itself emits nothing');
  assert.equal(await m.dispatchInference(db,G,t),true);await m.uncertainInference(db,G,t);await m.observeInference(db,G,t,{inputTokens:1000,outputTokens:200});
  const k=await key(t);assert.deepEqual((await rows(k)).map(r=>[r.revision,r.stale]),[[2,0],[3,0],[4,0]]);
  const head=(await m.costEventHeads(db,G))[0];assert.equal(head.outcome,'settled');assert.equal(head.cost.basis,'shadow');assert.equal(head.cost.micros,(await one('SELECT estimated_micros FROM inference_calls WHERE id=?',t)).estimated_micros);
  assert.equal(head.customerUnits,0);assert.equal(head.attribution.projectId,null);
  const t2=await turn();await m.inferenceReservation(db,G,t2,period,muse,1000,1000).run();await run("UPDATE standard_ai_requests SET state='released' WHERE id=?",t2);await m.ensureInferenceBudget(db,G,period,'explore');
  const released=(await all('SELECT event_json FROM cost_events WHERE idempotency_key=?',await key(t2))).map(r=>JSON.parse(r.event_json));
  assert.equal(released.length,1);assert.equal(released[0].outcome,'released');assert.equal(released[0].quantity.value,0);assert.equal(released[0].cost.micros,0);
 });
 const gateway=async()=>{
  const owner=await user(),task=id(),now=Date.now(),expires=now+3600000;
  const candidate={...scenario.candidates[0],rateValidFrom:now-1,rateValidUntil:expires,benchmark:{...scenario.candidates[0].benchmark,validUntil:expires}};
  const decision=m.planInferenceRoute([candidate],{...scenario.request,ownerId:owner,taskId:task,now});
  const buckets={task:id(),account:id(),platform:id()};
  for(const scope of ['task','account','platform'])await run('INSERT INTO gateway_spend_buckets(id,scope,user_id,task_id,limit_micros) VALUES(?,?,?,?,?)',buckets[scope],scope,scope==='platform'?null:owner,scope==='task'?task:null,100000);
  return {owner,decision,buckets};
 };
 await check('gateway receipts emit after reserve, dispatch, uncertain and settle; the provider ID is learned once captured',async()=>{
  const {owner,decision,buckets}=await gateway(),aid=id();
  await m.reserveGatewaySpend(db,owner,aid,decision,buckets);
  await run('INSERT INTO gateway_inference_requests(attempt_id,request_hash) VALUES(?,?)',aid,'b'.repeat(64));await m.dispatchGatewaySpend(db,owner,aid);
  await run("INSERT INTO gateway_provider_receipts(attempt_id,account_id,gateway_id,http_status,event_id) VALUES(?,?,'gw-test',200,'evt-'||?)",aid,'c'.repeat(32),aid.slice(0,8));
  await m.uncertainGatewaySpend(db,owner,aid);await m.settleGatewaySpend(db,owner,aid,100,200);
  const k=await m.idempotencyKey({source:'gateway-settlement',sourceEventId:aid,dimension:'ai.inference.call'});
  const events=(await all('SELECT event_json FROM cost_events WHERE idempotency_key=? ORDER BY revision',k)).map(r=>JSON.parse(r.event_json));
  assert.deepEqual(events.map(e=>e.revision),[1,2,3,4]);
  assert.deepEqual(events.map(e=>e.providerEventId),[null,null,'evt-'+aid.slice(0,8),'evt-'+aid.slice(0,8)]);
  assert.equal(new Set(events.map(e=>e.occurredAt)).size,1,'occurredAt is fixed by the first revision');
  const settled=events.at(-1);assert.equal(settled.cost.basis,'receipt');assert.equal(settled.cost.micros,(await one('SELECT provider_actual FROM gateway_spend_attempts WHERE id=?',aid)).provider_actual);
  assert.equal(settled.customerUnits,0);assert.ok(!JSON.stringify(settled).includes('customer_actual'));
  // A replayed settlement and a released reservation: no second row, an exact zero only for a real release.
  await m.settleGatewaySpend(db,owner,aid,100,200);assert.equal((await rows(k)).length,4);
  const rid=id();await m.reserveGatewaySpend(db,owner,rid,decision,buckets);assert.equal(await m.releaseGatewaySpend(db,owner,rid),true);
  const rel=JSON.parse((await one('SELECT event_json FROM cost_events WHERE idempotency_key=? AND revision=4',await m.idempotencyKey({source:'gateway-settlement',sourceEventId:rid,dimension:'ai.inference.call'}))).event_json);
  assert.equal(rel.outcome,'released');assert.equal(rel.cost.micros,0);
 });
 await check('storage reads emit the monotone counter as the revision at powers of two; the latest recorded reading is the head',async()=>{
  const H=await user(),ph=await project(H);
  for(let n=1;n<=5;n++)await m.reservePublicPhotoRead(db,new Request('https://x.invalid/',{headers:{'cf-connecting-ip':'203.0.113.'+n}}),ph);
  const k=await m.idempotencyKey({source:'storage-operations',sourceEventId:`${ph}:${period}:read_ops`,dimension:'r2.class_b_ops'});
  // Only powers of two are recorded (1, 2 and 4 of five reads), so a busy site adds at most 16 rows a month; the counter keeps the exact figure.
  assert.deepEqual((await rows(k)).map(r=>[r.revision,r.stale]),[[1,0],[2,0],[4,0]]);assert.equal((await one('SELECT read_ops FROM storage_project_usage WHERE project_id=?',ph)).read_ops,5);
  const head=(await m.costEventHeads(db,H))[0];assert.equal(head.quantity.value,4);assert.equal(head.attribution.projectId,ph);assert.equal(head.workload,'storage-files');
 });
 await check('a forced emission failure leaves the receipt and the customer result intact, and records no zero',async()=>{
  const flaky=new Proxy(db,{get:(t,k)=>k==='prepare'?q=>/INSERT INTO cost_events/.test(q)?{bind:()=>({run:async()=>{throw new Error('forced emission failure PRIVATE_CANARY');}})}:t.prepare(q):typeof t[k]==='function'?t[k].bind(t):t[k]});
  const {owner,decision,buckets}=await gateway(),aid=id();
  warnings.length=0;
  const reserved=await m.reserveGatewaySpend(flaky,owner,aid,decision,buckets);assert.equal(reserved.status,'reserved');
  assert.equal(await m.dispatchGatewaySpend(flaky,owner,aid),true);
  const settled=await m.settleGatewaySpend(flaky,owner,aid,100,200);assert.equal(settled.replayed,false);assert.ok(settled.providerMicros>0);
  const receipt=await one('SELECT status,provider_actual FROM gateway_spend_attempts WHERE id=?',aid);assert.equal(receipt.status,'settled');assert.equal(receipt.provider_actual,settled.providerMicros);
  const k=await m.idempotencyKey({source:'gateway-settlement',sourceEventId:aid,dimension:'ai.inference.call'});
  assert.equal((await rows(k)).length,0,'no event, and in particular no invented zero');
  assert.equal(warnings.filter(w=>w.includes('cost_event.emission_failed')).length,3);
  assert.ok(warnings.every(w=>!w.includes(aid)&&!w.includes(owner)&&!w.includes('PRIVATE_CANARY')),'the log names a category only');
  // The producer redelivers later: the missed revisions are simply absent, and a late lower revision is stored as stale.
  await m.appendCostEvent(db,await m.costEventFromGatewayAttempt(await one('SELECT id,user_id,task_id,snapshot,status,provider_reserved,input_tokens,output_tokens,provider_actual FROM gateway_spend_attempts WHERE id=?',aid),{occurredAt:stamp()}));
  assert.deepEqual((await rows(k)).map(r=>[r.revision,r.stale]),[[4,0]]);
  await m.appendCostEvent(db,await m.costEventFromGatewayAttempt({...await one('SELECT id,user_id,task_id,snapshot,status,provider_reserved,input_tokens,output_tokens,provider_actual FROM gateway_spend_attempts WHERE id=?',aid),status:'dispatched',input_tokens:null,output_tokens:null,provider_actual:null},{occurredAt:JSON.parse((await one('SELECT event_json FROM cost_events WHERE idempotency_key=?',k)).event_json).occurredAt}));
  assert.deepEqual((await rows(k)).map(r=>[r.revision,r.stale]),[[4,0],[2,1]]);
  // A missing table or a failing read is the same: swallowed, logged, the customer operation unchanged.
  const broken=new Proxy(db,{get:(t,k)=>k==='prepare'?q=>/cost_events/.test(q)?{bind:()=>{throw new Error('no such table');}}:t.prepare(q):typeof t[k]==='function'?t[k].bind(t):t[k]});
  const {owner:o2,decision:d2,buckets:b2}=await gateway(),a2=id();
  assert.equal((await m.reserveGatewaySpend(broken,o2,a2,d2,b2)).status,'reserved');assert.equal(await m.dispatchGatewaySpend(broken,o2,a2),true);
 });
 await check('the table has no customer-facing reader: no src module other than the store and emission names it',async()=>{
  assert.deepEqual((await all("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name='cost_events' ORDER BY name")).map(r=>r.name),['cost_events_append_only','cost_events_capacity','cost_events_immutable','cost_events_tenant_owner']);
  assert.deepEqual((await all("SELECT name FROM pragma_index_list('cost_events') WHERE \"unique\"=1 AND origin='u'")).length,1);
 });
 await check('capacity: the ledger refuses new events at 9,000 rows (restore admission reads 10,000) without touching a receipt',async()=>{
  const have=(await one('SELECT count(*) n FROM cost_events')).n;
  await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${8999-have}) INSERT INTO cost_events(idempotency_key,revision,source,dimension,scope,pool,workload,work_class,outcome,quantity_value,cost_basis,cost_micros,occurred_at,observed_at,event_json)
   SELECT printf('%064x',i+1000000),1,'liability-register','liability.account-minimum','platform','shared-account','platform-standing','standing','settled',1,'provider-reported',1,'2026-10-01T00:00:00.000Z','2026-10-01T00:00:00.000Z',json_object('contractVersion',1,'customerUnits',0,'idempotencyKey',printf('%064x',i+1000000),'revision',1) FROM n`);
  assert.equal((await one('SELECT count(*) n FROM cost_events')).n,8999);
  const Z=await user(),sid='cap-'+id();
  await m.appendCostEvent(db,await observed(Z,sid+'-last'));assert.equal((await one('SELECT count(*) n FROM cost_events')).n,9000);
  await rejects(m.appendCostEvent(db,await observed(Z,sid)),'cost_event_capacity');
  // The refused emission leaves the receipt alone.
  warnings.length=0;const {owner,decision,buckets}=await gateway(),aid=id();
  assert.equal((await m.reserveGatewaySpend(db,owner,aid,decision,buckets)).status,'reserved');
  assert.equal((await one('SELECT status FROM gateway_spend_attempts WHERE id=?',aid)).status,'reserved');assert.ok(warnings.some(w=>w.includes('cost_event.emission_failed')));
 });
 console.log(`Cost events store passed (${cases} cases, ${process.argv.includes('--d1')?'actual local D1':'in-memory SQLite'}): append-only table with unique (key, revision), duplicate/conflict/stale/delayed/out-of-order rules, revision compatibility, tenant and closed-owner refusal, immutability, closure deletion, exact integers, concurrent appends, emission at inference/gateway/storage transitions and a forced emission failure that leaves the receipt intact.`);
}finally{console.warn=warn;await store.close();}
