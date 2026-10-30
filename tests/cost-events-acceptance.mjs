import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {databaseFixture} from './helpers/current-database.mjs';

// WH-172: connected acceptance of shadow cost events on a disposable database (in-memory SQLite, or actual local D1 with --d1).
// Events come only from the real producer paths: the OpenCode Go adapter (complete) with a stubbed transport between the real
// inference receipt transitions, the gateway spend receipt transitions, and public photo reads. No direct cost_events insert,
// no network, credential, paid API or live provider. Every WH-172 acceptance item is tagged A1..A3 / W1..W5 in the check names.
const bundle=await build({stdin:{contents:"export * from './src/cost-events';export * from './src/cost-event-store';export * from './src/cost-event-emission';export * from './src/cost-event-adapters';export * from './src/cost-reconcile';export * from './src/model-costs';export * from './src/gateway-spend';export * from './src/inference-routing';export * from './src/storage-budget';export * from './src/task-cost-report';export {complete,ProviderError} from './src/ai';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const scenario=JSON.parse(readFileSync(new URL('./fixtures/inference-routing-scenario.json',import.meta.url),'utf8'));
const store=await databaseFixture(),db=store.db;
const id=()=>crypto.randomUUID(),stamp=()=>new Date().toISOString(),period=stamp().slice(0,7);
const run=(sql,...v)=>db.prepare(sql).bind(...v).run(),all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results,one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const rejects=(promise,code)=>assert.rejects(promise,e=>e.code===code||String(e).includes(code),code);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const dir=mkdtempSync(join(tmpdir(),'cost-acceptance-'));
const warn=console.warn;console.warn=()=>{};
try{
 const user=async()=>{const u=id();await run('INSERT INTO users(id,email,created_at) VALUES(?,?,?)',u,u+'@example.test',stamp());return u;};
 const project=async o=>{const p=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Cost fixture','','draft',?,?)",p,o,stamp(),stamp());return p;};
 const A=await user(),B=await user(),pa=await project(A),pb=await project(B);
 const heads=async()=>(await all('SELECT e.event_json FROM cost_events e WHERE e.revision=(SELECT MAX(revision) FROM cost_events WHERE idempotency_key=e.idempotency_key) ORDER BY e.seq')).map(r=>JSON.parse(r.event_json));
 const count=async()=>(await one('SELECT count(*) n FROM cost_events')).n;
 const key=(source,sid,dimension='ai.inference.call')=>m.idempotencyKey({source,sourceEventId:sid,dimension});
 const revs=async k=>(await all('SELECT revision,stale FROM cost_events WHERE idempotency_key=? ORDER BY seq',k)).map(r=>[r.revision,r.stale]);
 const evt=async k=>(await all('SELECT event_json FROM cost_events WHERE idempotency_key=? ORDER BY revision',k)).map(r=>JSON.parse(r.event_json));

 // --- Producer 1: Chat AI through the OpenCode Go adapter (stub transport, real receipt transitions) ---
 const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:'synthetic',protocol:'responses',sessionId:'whumpo-acceptance'};
 await m.ensureInferenceBudget(db,A,period,'explore');await m.ensureInferenceBudget(db,B,period,'explore');
 const stub=(inTok,outTok)=>async(url,init)=>{
  assert.equal(url.href,'https://opencode.ai/zen/go/v1/responses');assert.equal(JSON.parse(init.body).store,false);
  return Response.json({status:'completed',model:config.model,output:[{type:'message',content:[{type:'output_text',text:'Synthetic reply'}]}],usage:{input_tokens:inTok,output_tokens:outTok}});
 };
 const down=async()=>new Response('unavailable',{status:503});
 const turn=async owner=>{const t=id();
  await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Test','Pending',?,'ai','pending')",t,owner,Math.floor(Math.random()*1e9),stamp());
  await run('INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,?,?)',t,owner,'a'.repeat(64),stamp(),stamp());
  await m.inferenceReservation(db,owner,t,period,config,1000,1000).run();return t;};
 const ai=async(owner,transport)=>{const t=await turn(owner);assert.equal(await m.dispatchInference(db,owner,t),true);
  try{const r=await m.complete(config,[{role:'user',content:'Make a bakery website'}],transport);await m.observeInference(db,owner,t,r);await run("UPDATE chat_turns SET status='completed' WHERE id=?",t);}
  catch(e){assert.ok(e instanceof m.ProviderError);await m.uncertainInference(db,owner,t);await run("UPDATE chat_turns SET status='failed' WHERE id=?",t);}
  return t;};
 const tA1=await ai(A,stub(1000,200)),tA2=await ai(A,stub(500,100)),tAdown=await ai(A,down),tB=await ai(B,stub(2000,400));

 // --- Producer 2: gateway spend attempts ---
 const gateway=async owner=>{
  const task=id(),now=Date.now(),expires=now+3600000;
  const candidate={...scenario.candidates[0],rateValidFrom:now-1,rateValidUntil:expires,benchmark:{...scenario.candidates[0].benchmark,validUntil:expires}};
  const decision=m.planInferenceRoute([candidate],{...scenario.request,ownerId:owner,taskId:task,now});
  const buckets={task:id(),account:id(),platform:id()};
  for(const scope of ['task','account','platform'])await run('INSERT INTO gateway_spend_buckets(id,scope,user_id,task_id,limit_micros) VALUES(?,?,?,?,?)',buckets[scope],scope,scope==='platform'?null:owner,scope==='task'?task:null,100000);
  const aid=id();await m.reserveGatewaySpend(db,owner,aid,decision,buckets);
  await run('INSERT INTO gateway_inference_requests(attempt_id,request_hash) VALUES(?,?)',aid,'b'.repeat(64));assert.equal(await m.dispatchGatewaySpend(db,owner,aid),true);
  await run("INSERT INTO gateway_provider_receipts(attempt_id,account_id,gateway_id,http_status,event_id) VALUES(?,?,'gw-test',200,'evt-'||?)",aid,'c'.repeat(32),aid.slice(0,8));
  await m.uncertainGatewaySpend(db,owner,aid);return aid;};
 const gA=await gateway(A),gB=await gateway(B);
 const gkey=a=>key('gateway-settlement',a);

 // --- Producer 3: public photo reads ---
 const read=async(p,n)=>{for(let i=1;i<=n;i++)await m.reservePublicPhotoRead(db,new Request('https://x.invalid/',{headers:{'cf-connecting-ip':'203.0.113.'+i}}),p);};
 await read(pa,4);await read(pb,2);
 const skey=p=>key('storage-operations',`${p}:${period}:read_ops`,'r2.class_b_ops');

 await check('W1 events exist for every producer, from receipt transitions only, with shadow estimates and zero customer units',async()=>{
  const k1=await key('inference-receipt',tA1);
  assert.deepEqual(await revs(k1),[[2,0],[4,0]],'dispatched then observed, emitted after each transition');
  const settled=(await evt(k1)).at(-1);
  assert.equal(settled.outcome,'settled');assert.equal(settled.cost.basis,'shadow');assert.equal(settled.customerUnits,0);
  assert.equal(settled.cost.micros,(await one('SELECT estimated_micros e FROM inference_calls WHERE turn_id=?',tA1)).e);assert.ok(settled.cost.micros>0);
  assert.equal(settled.quantity.value,1);assert.equal(settled.attribution.ownerId,A);
  const g=(await evt(await gkey(gA)));assert.deepEqual(g.map(e=>e.revision),[1,2,3]);assert.equal(g.at(-1).outcome,'uncertain');
  assert.equal(g.at(-1).providerEventId,'evt-'+gA.slice(0,8));
  // Public photo reads are recorded at powers of two: 4 reads leave 1, 2 and 4; the exact counter is 4.
  assert.deepEqual(await revs(await skey(pa)),[[1,0],[2,0],[4,0]]);assert.equal((await evt(await skey(pa))).at(-1).quantity.value,4);
  assert.equal((await evt(await skey(pb))).at(-1).quantity.value,2);
  const all=await heads();assert.ok(all.every(e=>e.customerUnits===0),'no event carries customer units');
  assert.ok(!JSON.stringify(all).includes('customer_actual'));
 });
 await check('W2 unknown outcome: a provider failure leaves an uncertain receipt and no invented zero; an unfinished gateway call is unknown and holds reconciliation incomplete',async()=>{
  const down=(await one('SELECT status FROM inference_calls WHERE turn_id=?',tAdown)).status;assert.equal(down,'uncertain');
  const e=(await evt(await key('inference-receipt',tAdown))).at(-1);
  assert.equal(e.outcome,'uncertain');assert.notEqual(e.cost.micros,0);assert.ok(e.cost.basis==='unknown'||e.cost.basis==='shadow');
  const g=(await evt(await gkey(gA))).at(-1);assert.equal(g.outcome,'uncertain');assert.equal(g.cost.basis,'unknown');assert.equal(g.cost.reason,'outcome-unknown');
  const r=m.reconciliationReport([],await heads());
  assert.ok(r.rows.some(x=>x.provider==='inference-provider'&&x.unknownEvents>0),'unknown stays explicit');
 });
 const before=await count();
 await check('W3 idempotency on replay: re-emitting every producer and replaying a settlement adds no row',async()=>{
  for(const t of [tA1,tA2,tAdown,tB]){const o=(await one('SELECT user_id u FROM inference_calls WHERE turn_id=?',t)).u;await m.emitInferenceCall(db,o,(await one('SELECT id FROM inference_calls WHERE turn_id=?',t)).id);}
  await m.emitGatewayAttempt(db,A,gA);await m.emitGatewayAttempt(db,B,gB);await m.emitProjectStorageRead(db,pa);await m.emitProjectStorageRead(db,pb);
  assert.equal(await count(),before,'duplicates are no-ops');
  const e=(await evt(await key('inference-receipt',tA1))).at(-1);
  assert.equal((await m.appendCostEvent(db,structuredClone(e))).status,'duplicate');
  await rejects(m.appendCostEvent(db,{...e,cost:{...e.cost,micros:e.cost.micros+1}}),'IDEMPOTENCY_CONFLICT');
  assert.equal(await count(),before);
 });
 // Resolve the unfinished gateway calls through the real settlement path; replays change nothing.
 const sA=await m.settleGatewaySpend(db,A,gA,100,200),sB=await m.settleGatewaySpend(db,B,gB,300,400);
 await check('W3 a delayed settlement closes the unknown, and a replayed settlement is a no-op',async()=>{
  assert.equal(sA.replayed,false);const after=await count();
  assert.equal((await m.settleGatewaySpend(db,A,gA,100,200)).replayed,true);assert.equal(await count(),after);
  assert.deepEqual((await revs(await gkey(gA))).map(r=>r[0]),[1,2,3,4]);
  const e=(await evt(await gkey(gA))).at(-1);assert.equal(e.outcome,'settled');assert.equal(e.cost.basis,'receipt');assert.equal(e.cost.micros,sA.providerMicros);assert.equal(e.customerUnits,0);
 });
 await check('W4 tenant isolation: per-task cost report and event heads never cross accounts; a cross-tenant append is refused',async()=>{
  const from=new Date(Date.now()-864e5).toISOString(),to=new Date(Date.now()+864e5).toISOString();
  const ra=await m.taskCostReport(db,from,to,A),rb=await m.taskCostReport(db,from,to,B),rall=await m.taskCostReport(db,from,to);
  assert.equal(ra.turns,3);assert.equal(rb.turns,1);assert.equal(rall.turns,4);
  assert.equal(ra.completedFullyObserved.shadowCostMicros.samples,2);assert.equal(rb.completedFullyObserved.shadowCostMicros.samples,1);
  assert.equal(ra.excluded.unfinishedCalls,1,'the uncertain call is excluded, not zero');
  for(const r of [ra,rb]){const s=JSON.stringify(r);assert.ok(!s.includes(A)&&!s.includes(B)&&!s.includes(tA1)&&!s.includes(tB));}
  // The report agrees with the event heads for the same tenant, and the two tenants add up to the unfiltered report.
  const shadow=async o=>(await m.costEventHeads(db,o)).filter(e=>e.source==='inference-receipt'&&e.outcome==='settled').reduce((s,e)=>s+e.cost.micros,0);
  assert.equal(await shadow(A),ra.completedFullyObserved.shadowCostMicros.total);assert.equal(await shadow(B),rb.completedFullyObserved.shadowCostMicros.total);
  assert.equal(ra.completedFullyObserved.shadowCostMicros.total+rb.completedFullyObserved.shadowCostMicros.total,rall.completedFullyObserved.shadowCostMicros.total);
  const ha=await m.costEventHeads(db,A),hb=await m.costEventHeads(db,B);
  assert.ok(ha.length&&hb.length&&ha.every(e=>e.attribution.ownerId===A)&&hb.every(e=>e.attribution.ownerId===B));
  const e=(await evt(await key('inference-receipt',tA1))).at(-1);
  await rejects(m.appendCostEvent(db,{...e,attribution:{...e.attribution,ownerId:B}}),'TENANT_MISMATCH');
  await rejects(m.appendCostEvent(db,await m.costEventFromProjectStorageUsage({project_id:pb,period,read_ops:8},{ownerId:A,observedAt:stamp()})),'TENANT_MISMATCH');
 });
 await check('W2 an uncertain inference call stays unknown (incomplete report) until a late provider receipt settles it',async()=>{
  const incomplete=m.reconciliationReport([],await heads()).rows.find(x=>x.provider==='inference-provider');
  assert.equal(incomplete.unknownEvents,1);assert.equal(incomplete.unfinishedEvents,1);
  await m.observeInference(db,A,tAdown,{inputTokens:300,outputTokens:50}); // a late provider receipt confirms the outcome
  const e=(await evt(await key('inference-receipt',tAdown))).at(-1);assert.equal(e.outcome,'settled');assert.equal(e.cost.basis,'shadow');assert.ok(e.cost.micros>0);
 });
 await check('W5 reconciliation against a synthetic statement file: shadow excluded, reconciled within tolerance',async()=>{
  const ru=(await heads()).filter(e=>e.cost.basis==='shadow').reduce((s,e)=>s+e.cost.micros,0);assert.ok(ru>0);
  // Independent invoice figures: the provider actual from the gateway receipts, and R2 Class B at the pinned tariff (360000 micros per million operations).
  const provider=sA.providerMicros+sB.providerMicros,reads=4+2,r2=Math.ceil(reads*0.36)+1; // the invoice rounds one micro up: inside the stated tolerance
  const csv=[m.statementCsvHeader,
   `inference-provider,inv-acc,${period},USD,g1,inference,usage,,${provider}`,
   `cloudflare,inv-acc,${period},USD,r1,r2,usage,,${r2}`].join('\n');
  const file=join(dir,'statement.csv');writeFileSync(file,csv);
  const report=m.reconciliationReport(m.parseStatementCsv(readFileSync(file,'utf8')),await heads(),{toleranceMicros:1});
  const inf=report.rows.find(x=>x.provider==='inference-provider'),cf=report.rows.find(x=>x.provider==='cloudflare');
  assert.equal(inf.shadowExcludedMicros,ru,'every shadow estimate is excluded from the comparison');
  assert.equal(inf.recordedUsageMicros,provider,'only receipt-priced gateway cost is compared');
    assert.equal(inf.residualMicros,0);assert.equal(inf.unknownEvents,0);assert.equal(inf.unfinishedEvents,0);assert.equal(inf.status,'reconciled');
  assert.equal(cf.recordedUsageMicros,Math.ceil(reads*0.36));assert.equal(cf.residualMicros,1);assert.equal(cf.status,'reconciled','within the stated tolerance');
  assert.equal(m.reconciliationReport(m.parseStatementCsv(csv),await heads()).rows.find(x=>x.provider==='cloudflare').status,'unexplained-residual','with zero tolerance the 1 micro residual is explicit');
  const text=JSON.stringify(report);for(const secret of [A,B,pa,pb])assert.ok(!text.includes(secret),'aggregates only');
  const n=await count();m.reconciliationReport([],await heads());assert.equal(await count(),n,'the report writes nothing');
 });
 await check('A2 no billing authority: events add no customer debit, change no receipt or admission, and the ledger is append-only',async()=>{
  assert.equal((await heads()).filter(e=>e.customerUnits!==0).length,0);
  assert.equal((await one("SELECT count(*) n FROM gateway_spend_attempts WHERE status NOT IN ('settled','released')")).n,0);
  await assert.rejects(run('UPDATE cost_events SET stale=1'),/cost_event_immutable/);await assert.rejects(run('DELETE FROM cost_events'),/cost_event_append_only/);
  // A failing ledger never blocks or changes the customer operation.
  const broken=new Proxy(db,{get:(t,k)=>k==='prepare'?q=>/INSERT INTO cost_events/.test(q)?{bind:()=>({run:async()=>{throw new Error('forced');}})}:t.prepare(q):typeof t[k]==='function'?t[k].bind(t):t[k]});
  const t=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'T','P',?,'ai','pending')",t,A,1,stamp());
  await run('INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,?,?)',t,A,'a'.repeat(64),stamp(),stamp());
  await m.inferenceReservation(db,A,t,period,config,1000,1000).run();assert.equal(await m.dispatchInference(broken,A,t),true);
  assert.equal((await one('SELECT status FROM inference_calls WHERE turn_id=?',t)).status,'dispatched');
 });
 console.log(`Cost events acceptance passed (${cases} checks, ${process.argv.includes('--d1')?'actual local D1':'in-memory SQLite'}): AI via OpenCode Go stub, gateway and storage producers, uncertain outcome, replay, tenant isolation and WH-171 reconciliation with shadow excluded.`);
}finally{console.warn=warn;rmSync(dir,{recursive:true,force:true});await store.close();}
