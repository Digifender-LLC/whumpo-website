import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import * as ref from '../tools/prototypes/cost-events.mjs';

// WH-169: the source cost-event contract (src/cost-events.ts) and the pure adapters for inference_calls, gateway_spend_attempts and
// storage_project_usage (src/cost-event-adapters.ts). The rows come from the REAL receipt code (inferenceReservation, observeInference,
// reserveGatewaySpend, settleGatewaySpend, reservePublicPhotoRead ...) running against the current schema in disposable in-memory
// SQLite, captured after every state transition because the tables update in place and keep no history. The WH-168 offline reference is
// used ONLY as an independent oracle (a separately written implementation on Node crypto), never as a dependency of the source; every
// agreement check also pins an explicit expectation so the two cannot be wrong in the same way unnoticed. Synthetic identifiers, no
// network, credential, model or provider; no D1 write by any adapter. Each check also runs against deliberately broken copies of the
// source (mutants below), each of which must be caught by the check written for that property.
const explain=Boolean(process.env.COST_EVENT_EXPLAIN);
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const sourceText={'src/cost-events.ts':read('src/cost-events.ts'),'src/cost-event-adapters.ts':read('src/cost-event-adapters.ts')};

async function loadSource(patches=[]){
 const text={...sourceText};for(const [file,find,replace] of patches)text[file]=text[file].replace(find,()=>replace);
 const plugin={name:'patched-source',setup(b){b.onLoad({filter:/src\/cost-event(?:s|-adapters)\.ts$/},args=>({contents:text[args.path.slice(args.path.lastIndexOf('/src/')+1)],loader:'ts'}));}};
 const out=await build({stdin:{contents:"export * as ct from './src/cost-events.ts';export * as ad from './src/cost-event-adapters.ts';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'neutral',write:false,logLevel:'silent',plugins:[plugin]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}

// ---------- Real receipts: produce rows with the actual source, capture each state ----------
const producerBundle=await build({stdin:{contents:"export * from './src/model-costs';export * from './src/gateway-spend';export * from './src/inference-routing';export * from './src/storage-budget';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const producers=await import('data:text/javascript;base64,'+Buffer.from(producerBundle.outputFiles[0].text).toString('base64'));
const scenario=JSON.parse(read('tests/fixtures/inference-routing-scenario.json'));

async function captureFixtures(){
 const store=await databaseFixture(),db=store.db,sql=store.sql;
 const id=()=>crypto.randomUUID(),stamp=()=>new Date().toISOString(),period=stamp().slice(0,7);
 const fx={inference:[],gateway:[],storage:[],columns:{},period};
 try{
  for(const table of ['inference_calls','gateway_spend_attempts','storage_project_usage'])fx.columns[table]=sql.prepare(`PRAGMA table_info(${table})`).all().map(c=>c.name);
  const user=async()=>{const u=id();await db.prepare('INSERT INTO users(id,email,created_at) VALUES(?,?,?)').bind(u,u+'@example.test',stamp()).run();return u;};
  // --- inference_calls: Chat orchestrator and acknowledgment receipts, priced (Muse shadow) and unpriced (offline transport) ---
  const muse={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:'synthetic',protocol:'responses'},offline={baseURL:'https://offline.invalid/v1',model:'offline-double',apiKey:'synthetic',protocol:'chat'};
  const owner=await user();await producers.ensureInferenceBudget(db,owner,period,'explore');
  const turn=async()=>{const t=id();await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Test','Pending',?,'ai','pending')").bind(t,owner,Math.floor(Math.random()*1e9),stamp()).run();
   await db.prepare('INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,?,?)').bind(t,owner,'a'.repeat(64),stamp(),stamp()).run();return t;};
  const row=async receipt=>({...await db.prepare('SELECT * FROM inference_calls WHERE id=?').bind(receipt).first()});
  const call=async(name,config,role,steps,{ack}={})=>{
   const t=await turn(),rid=role==='ack'?t+':ack':t,rows=[];
   await producers.inferenceReservation(db,owner,t,period,config,1000,1000,role).run();rows.push(await row(rid));
   for(const step of steps){
    if(step==='dispatch')await producers.dispatchInference(db,owner,rid);
    if(step==='uncertain')await producers.uncertainInference(db,owner,rid);
    if(step==='observe')await producers.observeInference(db,owner,rid,{inputTokens:1000,outputTokens:200},ack);
    if(step==='release'){await db.prepare("UPDATE standard_ai_requests SET state='released' WHERE id=?").bind(t).run();await producers.ensureInferenceBudget(db,owner,period,'explore');}
    rows.push(await row(rid));
   }
   fx.inference.push({name,rows});
  };
  await call('shadow orchestrator',muse,'orchestrator',['dispatch','observe']);
  await call('shadow acknowledgment',muse,'ack',['dispatch','observe'],{ack:'On it.'});
  await call('shadow lost response resolved late',muse,'orchestrator',['dispatch','uncertain','observe']);
  await call('shadow released before dispatch',muse,'orchestrator',['release']);
  await call('shadow still dispatched',muse,'orchestrator',['dispatch']);
  await call('shadow uncertain',muse,'orchestrator',['dispatch','uncertain']);
  await call('shadow only reserved',muse,'orchestrator',[]);
  await call('unpriced observed',offline,'orchestrator',['dispatch','observe']);
  await call('unpriced still dispatched',offline,'orchestrator',['dispatch']);
  // --- gateway_spend_attempts: standard and premium (inactive in live routing; exercised here through the real functions) ---
  const gOwner=await user(),task=id(),now=Date.now(),expires=now+3600000;
  const candidate={...scenario.candidates[0],rateValidFrom:now-1,rateValidUntil:expires,benchmark:{...scenario.candidates[0].benchmark,validUntil:expires}};
  const request={...scenario.request,ownerId:gOwner,taskId:task,now};
  const buckets={task:id(),account:id(),platform:id(),premium:id(),approval:id()};
  for(const scope of ['task','account','platform','premium'])await db.prepare('INSERT INTO gateway_spend_buckets(id,scope,user_id,task_id,limit_micros) VALUES(?,?,?,?,?)').bind(buckets[scope],scope,scope==='platform'?null:gOwner,scope==='task'?task:null,100000).run();
  const approval={approvalId:buckets.approval,ownerId:gOwner,taskId:task,catalogVersion:request.catalogVersion,policy:producers.inferenceRoutingPolicy,expiresAt:expires,candidateIds:[candidate.id],tariffId:'synthetic-tariff',retailMultiplierBps:15000,maxCustomerMicros:4000,remainingCustomerMicros:10000};
  await db.prepare("INSERT INTO gateway_spend_buckets(id,scope,user_id,task_id,limit_micros,terms_json) VALUES(?,'approval',?,?,4000,?)").bind(buckets.approval,gOwner,task,JSON.stringify(approval)).run();
  const standard={task:buckets.task,account:buckets.account,platform:buckets.platform},decision=producers.planInferenceRoute([candidate],request);
  const premiumDecision=producers.planInferenceRoute([{...candidate,premium:true}],{...request,tier:'premium',premium:approval});
  const attempt=async(name,steps,d=decision,b=standard)=>{
   const aid=id(),rows=[];await producers.reserveGatewaySpend(db,gOwner,aid,d,b);
   const snap=async()=>rows.push({...await db.prepare('SELECT * FROM gateway_spend_attempts WHERE id=?').bind(aid).first()});await snap();
   for(const step of steps){
    if(step==='dispatch')await producers.dispatchGatewaySpend(db,gOwner,aid);
    if(step==='uncertain')await producers.uncertainGatewaySpend(db,gOwner,aid);
    if(step==='settle')await producers.settleGatewaySpend(db,gOwner,aid,100,200);
    if(step==='release')await producers.releaseGatewaySpend(db,gOwner,aid);
    await snap();
   }
   fx.gateway.push({name,tier:d.selected.tier,rows});
  };
  await attempt('standard settled',['dispatch','settle']);
  await attempt('standard lost response resolved late',['dispatch','uncertain','settle']);
  await attempt('standard released',['release']);
  await attempt('standard still dispatched',['dispatch']);
  await attempt('premium settled',['dispatch','settle'],premiumDecision,buckets);
  // --- storage_project_usage: public photo reads, one counter per project and month ---
  const sOwner=await user(),sOther=await user();
  const project=async o=>{const p=id();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Cost fixture','','draft',?,?)").bind(p,o,stamp(),stamp()).run();return p;};
  const p1=await project(sOwner),p2=await project(sOther);
  const readOnce=async(p,n)=>{await producers.reservePublicPhotoRead(db,new Request('https://x.invalid/',{headers:{'cf-connecting-ip':'203.0.113.'+n}}),p);return {...await db.prepare('SELECT * FROM storage_project_usage WHERE project_id=?').bind(p).first()};};
  fx.storage.push({owner:sOwner,project:p1,rows:[await readOnce(p1,1),await readOnce(p1,2),await readOnce(p1,3)]},{owner:sOther,project:p2,rows:[await readOnce(p2,4)]});
  fx.gatewayOwner=gOwner;fx.owner=owner;
  return fx;
 }finally{store.close();}
}
const fx=await captureFixtures();
const T0=new Date().toISOString(),after=n=>new Date(Date.parse(T0)+n*1000).toISOString(),OBSERVED=after(3600);
// The gateway attempt keeps no timestamps (G-C5): each captured state gets a later observation time than the one before it.
const gatewayTimes=(attempt,i)=>({occurredAt:T0,observedAt:after(i),providerEventId:attempt.rows[i].status==='settled'?'provider-event-'+attempt.rows[i].id.slice(0,8):null});
const storageContext=s=>({ownerId:s.owner,observedAt:OBSERVED});

async function suite(m,label){
 const {ct,ad}=m;let count=0;
 const check=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const code=async(fn,expected,message='')=>{try{await fn();}catch(e){assert.equal(e.code,expected,`${message} ${e.message}`);return e;}assert.fail(`${message} expected ${expected}`);};
 const refCode=(fn)=>{try{fn();return 'ACCEPTED';}catch(e){return e.code??'CRASH:'+e.message;}};
 const tsCode=async fn=>{try{await fn();return 'ACCEPTED';}catch(e){return e.code??'CRASH:'+e.message;}};
 const O1='aaaaaaaa-aaaa-4aaa-8aaa-000000000001',P1='bbbbbbbb-bbbb-4bbb-8bbb-000000000001',R1='cccccccc-cccc-4ccc-8ccc-000000000001',OCT='2026-10-02T00:00:00.000Z',OCT_SEEN='2026-10-02T01:00:00.000Z';
 const strip=e=>JSON.parse(JSON.stringify(e));
 const finalRows=(group,pick=x=>x)=>group.map(g=>pick(g.rows.at(-1)));
 const numbers=v=>v&&typeof v==='object'?Object.values(v).flatMap(numbers):typeof v==='number'?[v]:[];

 let all=[];
 // ---------- Registries and the canonical key ----------
 await check('registries: the closed dimension, workload, source and tariff registries equal the frozen contract and are immutable',()=>{
  assert.deepEqual(strip(ct.dimensions),strip(ref.dimensions));assert.deepEqual(strip(ct.workloads),strip(ref.workloads));assert.deepEqual(strip(ct.tariffs),strip(ref.tariffs));
  assert.equal(ct.costScale,ref.costScale);assert.equal(ct.contractVersion,1);
  for(const k of ['unknownReasons','placementClasses','workClasses','outcomes','costBases','platformPools','aiTiers'])assert.deepEqual([...ct[k]],[...ref[k]],k);
  // The only intended difference: the three existing producers now have a source adapter instead of a planned one.
  assert.deepEqual(Object.keys(ct.sources),Object.keys(ref.sources));
  for(const [source,entry] of Object.entries(ct.sources)){
   assert.equal(entry.table,ref.sources[source].table,source);
   assert.equal(entry.readiness,ref.sources[source].readiness==='source-adapter-planned'?'source-adapter':ref.sources[source].readiness,source);
  }
  assert.deepEqual(Object.entries(ct.sources).filter(([,s])=>s.readiness==='source-adapter').map(([k])=>k).sort(),['gateway-settlement','inference-receipt','storage-operations']);
  // Internal consistency of the registries, checked here rather than shipped as runtime code.
  for(const [id,d] of Object.entries(ct.dimensions)){assert.match(id,/^[a-z0-9_.-]+$/);assert.ok(d.sources.every(s=>Object.hasOwn(ct.sources,s)),id);assert.ok(d.kind==='usage'||d.kind==='liability');}
  for(const versions of Object.values(ct.tariffs))for(const t of Object.values(versions)){
   assert.equal(t.allowanceAllocation,'account-wide-not-allocated');
   for(const [dimension,r] of Object.entries(t.rates)){assert.equal(ct.dimensions[dimension].kind,'usage',dimension);assert.equal(ct.costScale%BigInt(r.perUnits),0n,dimension);}
  }
  for(const registry of [ct.dimensions,ct.workloads,ct.sources,ct.tariffs,ct.tariffs['pool-proposal'][1].rates])assert.ok(Object.isFrozen(registry));
  assert.throws(()=>{'use strict';ct.dimensions['worker.requests'].unit='gigabyte';},TypeError);assert.throws(()=>{ct.workloads.invented={};},TypeError);
  assert.ok(Object.values(ct.workloads).every(w=>/^WH-\d{3}$/.test(w.packet)));
  // Every exported closed registry is frozen at runtime, at every depth and including the arrays (TypeScript readonly is not enough), and a
  // failed modification attempt leaves the future admission decision untouched.
  const deepFrozen=(v,where)=>{if(v&&typeof v==='object'){assert.ok(Object.isFrozen(v),where);for(const [k,x] of Object.entries(v))deepFrozen(x,`${where}.${k}`);}};
  const exported=Object.entries(ct).filter(([,v])=>v&&typeof v==='object');
  assert.deepEqual(exported.map(([k])=>k).sort(),['aiTiers','costBases','dimensions','outcomes','placementClasses','platformPools','sources','tariffs','unknownReasons','workClasses','workloads']);
  for(const [name,value] of exported)deepFrozen(value,name);
  const attempts={unknownReasons:'x-reason',placementClasses:'x-placement',workClasses:'x-work-class',outcomes:'x-outcome',costBases:'x-basis',platformPools:'x-pool',aiTiers:'x-tier'};
  for(const [name,added] of Object.entries(attempts)){
   const before=[...ct[name]];
   for(const attempt of [()=>ct[name].push(added),()=>ct[name].unshift(added),()=>{ct[name][0]=added;},()=>{ct[name].length=0;},()=>ct[name].splice(0,1),()=>ct[name].sort(),()=>ct[name].reverse(),()=>ct[name].pop()])assert.throws(attempt,TypeError,name);
   assert.deepEqual([...ct[name]],before,name);
  }
  for(const attempt of [()=>{ct.dimensions['ai.inference.call'].sources.push('liability-register');},()=>{ct.dimensions['ai.inference.call'].detailKeys.push('cachedTokens');},()=>{ct.dimensions['liability.support'].scopes.pop();},
   ()=>{ct.dimensions.invented={};},()=>{delete ct.workloads['chat-ai'];},()=>{ct.sources['connector-call'].readiness='source-adapter';},()=>{ct.tariffs['pool-proposal'][1].rates['worker.requests'].micros=0;},()=>{ct.tariffs['pool-proposal'][2]={};}])assert.throws(attempt,TypeError);
 });
 await check('canonical key: the idempotency key is the SHA-256 of the sorted canonical identity and equals the independent reference',async()=>{
  const sha=(source,sourceEventId,dimension)=>createHash('sha256').update(`{"dimension":${JSON.stringify(dimension)},"source":${JSON.stringify(source)},"sourceEventId":${JSON.stringify(sourceEventId)}}`).digest('hex');
  assert.equal(await ct.idempotencyKey({source:'inference-receipt',sourceEventId:'call-1',dimension:'ai.inference.call'}),sha('inference-receipt','call-1','ai.inference.call'));
  assert.match(await ct.idempotencyKey({source:'inference-receipt',sourceEventId:'call-1',dimension:'ai.inference.call'}),/^[0-9a-f]{64}$/);
  const ids=['x','call-1','a:b.c_d-e','Z'.repeat(128),'turn-é','日本語','0',"quote\"slash\\"];
  for(const sourceEventId of ids)for(const source of ['inference-receipt','storage-operations'])for(const dimension of ['ai.inference.call','r2.class_b_ops']){
   const expected=ref.idempotencyKey({source,sourceEventId,dimension});
   assert.equal(await ct.idempotencyKey({source,sourceEventId,dimension}),expected);assert.equal(expected,sha(source,sourceEventId,dimension));
  }
  // Property order and extra properties never change the key; every identity component does.
  const base=await ct.idempotencyKey({source:'inference-receipt',sourceEventId:'a',dimension:'ai.inference.call'});
  assert.equal(await ct.idempotencyKey({dimension:'ai.inference.call',sourceEventId:'a',source:'inference-receipt',revision:9,cost:{}}),base);
  for(const changed of [{source:'gateway-settlement'},{sourceEventId:'b'},{dimension:'r2.class_b_ops'}])assert.notEqual(await ct.idempotencyKey({source:'inference-receipt',sourceEventId:'a',dimension:'ai.inference.call',...changed}),base);
  const nested={z:[{b:1,a:{d:2,c:3}}],a:null,m:'x'};
  assert.equal(ct.canonical(nested),ref.canonical(nested));assert.equal(ct.canonical(nested),'{"a":null,"m":"x","z":[{"a":{"c":3,"d":2},"b":1}]}');
 });

 // ---------- The validator: every frozen rule, against an explicit expectation and the independent reference ----------
 const usage=(over={})=>{
  const e={contractVersion:1,source:'cloudflare-usage-import',sourceEventId:'cf-1',providerEventId:null,revision:1,kind:'usage',dimension:'worker.requests',workload:'app-runtime',workClass:'standing',taskRef:null,attempt:1,
   attribution:{scope:'tenant',ownerId:O1,projectId:P1,resourceId:R1},placementClass:'shared-api',quantity:{state:'known',value:1000,unit:'request'},cost:{basis:'tariff',tariff:{id:'pool-proposal',version:1}},
   outcome:'settled',customerUnits:0,aiTier:null,detail:{},occurredAt:OCT,observedAt:OCT_SEEN,idempotencyKey:'',...over};
  e.idempotencyKey=over.idempotencyKey??ref.idempotencyKey(e);return e;
 };
 const ai=(over={})=>usage({source:'inference-receipt',sourceEventId:'call-1',dimension:'ai.inference.call',workload:'chat-ai',workClass:'task',taskRef:'turn-1',attribution:{scope:'tenant',ownerId:O1,projectId:null,resourceId:null},
  placementClass:'platform',quantity:{state:'known',value:1,unit:'call'},cost:{basis:'shadow',micros:140,ref:'muse-test-shadow-v1'},aiTier:'standard',detail:{inputTokens:1000,outputTokens:200},...over});
 const liability=(over={})=>usage({source:'liability-register',sourceEventId:'lic-1',dimension:'liability.license',kind:'liability',workload:'platform-standing',attribution:{scope:'platform',pool:'shared-account'},placementClass:'platform',
  quantity:{state:'known',value:1,unit:'item'},cost:{basis:'provider-reported',micros:5000,ref:'invoice-line-1'},...over});
 const deepFreezeCopy=v=>{const c=structuredClone(v);const f=x=>{if(x&&typeof x==='object'){Object.freeze(x);Object.values(x).forEach(f);}};f(c);return c;};
 const broken=[
  ['an unsupported version',usage({contractVersion:2}),'UNSUPPORTED_VERSION'],['an unknown field',{...usage(),extra:1},'UNKNOWN_FIELD'],['a missing field',(()=>{const {outcome,...rest}=usage();return rest;})(),'MISSING_FIELD'],
  ['an unknown source',usage({source:'mystery'}),'UNKNOWN_SOURCE'],['an unknown dimension',usage({dimension:'gpu.hours'}),'UNKNOWN_DIMENSION'],['a prototype dimension',usage({dimension:'__proto__'}),'UNKNOWN_DIMENSION'],
  ['a source emitting another source dimension',usage({source:'inference-receipt'}),'SOURCE_DIMENSION'],['an unknown workload',usage({workload:'invented'}),'UNKNOWN_WORKLOAD'],
  ['a unit other than the dimension unit',usage({quantity:{state:'known',value:5,unit:'gigabyte'}}),'UNIT_MISMATCH'],['a kind other than the dimension kind',usage({kind:'liability'}),'KIND_MISMATCH'],
  ['a negative quantity',usage({quantity:{state:'known',value:-1,unit:'request'}}),'INVALID_QUANTITY'],['a fractional quantity',usage({quantity:{state:'known',value:1.5,unit:'request'}}),'INVALID_QUANTITY'],
  ['an unsafe quantity',usage({quantity:{state:'known',value:2**53,unit:'request'}}),'INVALID_QUANTITY'],['a date-only time',usage({occurredAt:'2026-10-02'}),'INVALID_TIME'],
  ['an observation before the occurrence',usage({observedAt:'2026-10-01T00:00:00.000Z'}),'INVALID_TIME'],['a resource without its project',usage({attribution:{scope:'tenant',ownerId:O1,projectId:null,resourceId:R1}}),'INVALID_ATTRIBUTION'],
  ['a non-UUID owner',usage({attribution:{scope:'tenant',ownerId:'owner-1',projectId:null,resourceId:null}}),'INVALID_ATTRIBUTION'],['an AI tier on a non-AI dimension',usage({aiTier:'standard'}),'INVALID_EVENT'],
  ['no AI tier on an AI dimension',ai({aiTier:null}),'INVALID_EVENT'],['customer units',ai({customerUnits:1}),'BILLING_AUTHORITY'],['a debit field',{...ai(),debit:5},'BILLING_AUTHORITY'],
  ['a locator field',{...ai(),bucket:'files'},'PHYSICAL_LOCATOR'],['a content field',{...ai(),prompt:'hello'},'CONTENT_FIELD'],['content in detail',ai({detail:{inputTokens:1,text:'hello'}}),'CONTENT_FIELD'],
  ['a client-assigned receive time',{...ai(),receivedAt:OCT},'CLIENT_ASSIGNED'],['a secret-shaped reference',ai({cost:{basis:'shadow',micros:1,ref:'sk-abcdefghijkl'}}),'SECRET_IN_EVENT'],
  ['a forged tombstone source ID',ai({sourceEventId:'closed:abc'}),'INVALID_EVENT'],['an invented idempotency key',ai({idempotencyKey:'f'.repeat(64)}),'IDEMPOTENCY_KEY'],
  ['a key derived for another dimension',ai({idempotencyKey:ref.idempotencyKey({source:'inference-receipt',sourceEventId:'call-1',dimension:'r2.class_b_ops'})}),'IDEMPOTENCY_KEY'],
  ['a pending call with a known cost',ai({outcome:'pending'}),'OUTCOME_COST'],['an uncertain call priced by tariff',ai({outcome:'uncertain',cost:{basis:'tariff',tariff:{id:'pool-proposal',version:1}}}),'OUTCOME_COST'],
  ['a released call that consumed quantity',ai({outcome:'released',quantity:{state:'known',value:1,unit:'call'},cost:{basis:'receipt',micros:0,ref:'r'},detail:{}}),'OUTCOME_COST'],
  ['a released call with a cost',ai({outcome:'released',quantity:{state:'known',value:0,unit:'call'},cost:{basis:'receipt',micros:3,ref:'r'},detail:{}}),'OUTCOME_COST'],
  ['a released call with token detail',ai({outcome:'released',quantity:{state:'known',value:0,unit:'call'},cost:{basis:'receipt',micros:0,ref:'r'},detail:{inputTokens:5,outputTokens:0}}),'OUTCOME_COST'],
  ['a released call with an unknown quantity',ai({outcome:'released',quantity:{state:'unknown',reason:'usage-pending'},cost:{basis:'receipt',micros:0,ref:'r'},detail:{}}),'OUTCOME_COST'],
  ['an unknown tariff',usage({cost:{basis:'tariff',tariff:{id:'invented',version:1}}}),'UNKNOWN_TARIFF'],['a prototype tariff',usage({cost:{basis:'tariff',tariff:{id:'constructor',version:1}}}),'UNKNOWN_TARIFF'],
  ['an unknown tariff version',usage({cost:{basis:'tariff',tariff:{id:'pool-proposal',version:2}}}),'UNKNOWN_TARIFF'],['a tariff for an unpriced dimension',usage({source:'notification-delivery',dimension:'notification.message',quantity:{state:'known',value:1,unit:'message'}}),'UNPRICED_DIMENSION'],
  ['a tariff priced before it is effective',usage({occurredAt:'2026-09-01T00:00:00.000Z',observedAt:'2026-09-01T00:00:00.000Z'}),'TARIFF_NOT_EFFECTIVE'],
  ['a tariff over an unknown quantity',usage({quantity:{state:'unknown',reason:'usage-not-reported'}}),'OUTCOME_COST'],['a tariff on a liability',liability({cost:{basis:'tariff',tariff:{id:'pool-proposal',version:1}}}),'OUTCOME_COST'],
  ['a shadow estimate on infrastructure',usage({cost:{basis:'shadow',micros:1,ref:'r'}}),'SHADOW_BASIS'],['a standing cost naming a task',usage({taskRef:'turn-1'}),'OVERHEAD_CLASS'],
  ['task cost without a task',ai({taskRef:null}),'OVERHEAD_CLASS'],['a retry on its first attempt',ai({workClass:'retry'}),'OVERHEAD_CLASS'],['a liability scoped to a tenant',liability({attribution:{scope:'tenant',ownerId:O1,projectId:null,resourceId:null}}),'SCOPE_NOT_ALLOWED'],
  ['an unsafe exposure',ai({outcome:'pending',quantity:{state:'unknown',reason:'usage-pending'},cost:{basis:'unknown',reason:'usage-pending',exposureMicros:2**53}}),'INVALID_COST'],
  ['an unsafe amount',ai({cost:{basis:'shadow',micros:2**53,ref:'r'}}),'INVALID_COST'],['an unknown reason',ai({outcome:'pending',quantity:{state:'unknown',reason:'because'},cost:{basis:'unknown',reason:'usage-pending',exposureMicros:1}}),'INVALID_REASON'],
  ['an unknown detail key',ai({detail:{inputTokens:1,outputTokens:2,cachedTokens:3}}),'UNKNOWN_FIELD'],['a negative token count',ai({detail:{inputTokens:-1,outputTokens:2}}),'UNKNOWN_FIELD'],
  ['an array instead of an event',[],'INVALID_EVENT'],['null instead of an event',null,'INVALID_EVENT'],['a class instance instead of an event',new (class Impostor{})(),'INVALID_EVENT'],['a platform pool that is not registered',usage({attribution:{scope:'platform',pool:'elsewhere'}}),'INVALID_ATTRIBUTION']
 ];
 await check('registries: after every modification attempt the closed registries still refuse unregistered values and still admit the registered ones',async()=>{
  const attempted=[usage({placementClass:'x-placement'}),usage({workClass:'x-work-class'}),usage({outcome:'x-outcome'}),usage({cost:{basis:'x-basis',micros:1,ref:'r'}}),usage({attribution:{scope:'platform',pool:'x-pool'}}),ai({aiTier:'x-tier'}),
   usage({cost:{basis:'unknown',reason:'x-reason',exposureMicros:null}}),ai({detail:{cachedTokens:1}})];
  for(const event of attempted)assert.notEqual(await tsCode(()=>ct.validateCostEvent(event)),'ACCEPTED',JSON.stringify(event));
  assert.deepEqual(await ct.validateCostEvent(usage()),usage());
 });
 await check('validator: accepts a valid event and refuses every broken frozen rule with its specific code, as the independent reference does',async()=>{
  for(const valid of [usage(),ai(),liability(),ai({outcome:'pending',quantity:{state:'unknown',reason:'usage-pending'},cost:{basis:'unknown',reason:'usage-pending',exposureMicros:500},detail:{}}),
   ai({outcome:'released',quantity:{state:'known',value:0,unit:'call'},cost:{basis:'receipt',micros:0,ref:'r'},detail:{}}),usage({quantity:{state:'unknown',reason:'usage-not-reported'},cost:{basis:'unknown',reason:'rate-missing',exposureMicros:null}})]){
   assert.deepEqual(await ct.validateCostEvent(valid),valid);ref.validateEvent(valid);
  }
  for(const [name,event,expected] of broken){
   assert.equal(await tsCode(()=>ct.validateCostEvent(event)),expected,name);
   assert.equal(refCode(()=>ref.validateEvent(event)),expected,`reference: ${name}`);
  }
  assert.equal(broken.length,56);
 });
 await check('validator: the input is never mutated, the result is an isolated copy and later edits of the input change nothing',async()=>{
  const event=ai(),frozen=structuredClone(event);
  const out=await ct.validateCostEvent(event);
  assert.deepEqual(event,frozen);assert.notEqual(out,event);assert.notEqual(out.attribution,event.attribution);assert.notEqual(out.detail,event.detail);
  out.detail.inputTokens=999999;out.attribution.ownerId='x';assert.deepEqual(event,frozen);
  assert.deepEqual(await ct.validateCostEvent(deepFreezeCopy(frozen)),frozen);
 });
  // The input is snapshotted synchronously, before the first await (the SHA-256 digest): edits made while the promise is pending change neither
 // the verdict nor the returned event nor its identity key.
 await check('validator: a private snapshot is taken before the first await, so editing the input while the digest is pending changes nothing',async()=>{
  const identity=e=>ct.idempotencyKey(e);
  const edits=[['top-level source',e=>{e.source='unregistered-source';}],['dimension',e=>{e.dimension='not.a.dimension';}],['sourceEventId (stale identity key)',e=>{e.sourceEventId='another-call';}],
   ['deleted field',e=>{delete e.workload;}],['added billing field',e=>{e.debit=5;}],['customerUnits',e=>{e.customerUnits=7;}],['replaced nested attribution',e=>{e.attribution={scope:'platform',pool:'unregistered-pool'};}],
   ['nested attribution field',e=>{e.attribution.ownerId='not-a-uuid';}],['nested quantity',e=>{e.quantity.value=-1;e.quantity.unit='gigabyte';}],['nested detail',e=>{e.detail.inputTokens=-1;e.detail.cachedTokens=1;}],
   ['nested cost',e=>{e.cost.ref='Bearer secret';e.cost.micros=-1;}],['timestamps',e=>{e.occurredAt='not a time';}]];
  for(const [name,edit] of edits){
   const event=ai({cost:{basis:'receipt',micros:5,ref:'rate-1'}}),expected=structuredClone(event);
   const pending=ct.validateCostEvent(event);edit(event);
   const out=await pending;
   assert.deepEqual(out,expected,name);assert.equal(out.idempotencyKey,await identity(expected),name);
   // The result is also isolated from the edited input and from its own earlier callers.
   out.detail.inputTokens=424242;assert.notEqual(out.detail,event.detail);
  }
  // The reverse: an event invalid when submitted stays rejected even if the caller repairs it while the promise is pending.
  for(const [name,breakIt,fix,expected] of [['customerUnits',e=>{e.customerUnits=5;},e=>{e.customerUnits=0;},'BILLING_AUTHORITY'],['nested unit',e=>{e.quantity.unit='gigabyte';},e=>{e.quantity.unit='call';},'UNIT_MISMATCH'],
   ['source',e=>{e.source='nope';},e=>{e.source='inference-receipt';},'UNKNOWN_SOURCE']]){
   const event=ai();breakIt(event);const pending=ct.validateCostEvent(event);fix(event);await code(()=>pending,expected,name);
  }
  // Plain JSON data only: an accessor is refused without being invoked, a class instance or null-prototype object is not a plain event, and a cycle is refused.
  let reads=0;
  const getter=ai();Object.defineProperty(getter,'source',{get(){reads++;return 'inference-receipt';},enumerable:true,configurable:true});
  const nested=ai();Object.defineProperty(nested.attribution,'ownerId',{get(){reads++;return O1;},enumerable:true,configurable:true});
  const setter=ai();Object.defineProperty(setter.detail,'inputTokens',{set(){reads++;},get(){return 1;},enumerable:true,configurable:true});
  for(const event of [getter,nested,setter])await code(()=>ct.validateCostEvent(event),'INVALID_EVENT','accessor');
  assert.equal(reads,0);
  class Same{constructor(o){Object.assign(this,o);}}
  await code(()=>ct.validateCostEvent(new Same(ai())),'INVALID_EVENT','class instance');await code(()=>ct.validateCostEvent(Object.assign(Object.create(null),ai())),'INVALID_EVENT','null prototype');
  await code(()=>ct.validateCostEvent(ai({attribution:new Same({scope:'tenant',ownerId:O1,projectId:null,resourceId:null})})),'INVALID_ATTRIBUTION','nested class instance');
  await code(()=>ct.validateCostEvent(ai({detail:{inputTokens:new Number(1),outputTokens:2}})),'UNKNOWN_FIELD','boxed number');
  const cyclic=ai();cyclic.detail.self=cyclic;await code(()=>ct.validateCostEvent(cyclic),'INVALID_EVENT','cycle');
  // A JSON-parsed "__proto__" key is data, not a prototype assignment, and is refused as an unknown field.
  await code(()=>ct.validateCostEvent(JSON.parse(JSON.stringify(ai()).replace('{"contractVersion"','{"__proto__":{"source":"x"},"contractVersion"'))),'UNKNOWN_FIELD','__proto__');
  assert.equal(ct.validateCostEvent.length,1);
 });
 // ---------- Adapters over real receipt rows ----------
 await check('adapters: the output equals the reference for every captured real state of every producer and passes the validator',async()=>{
  // Every adapter output for every captured state, with the reference's output for the same row.
  all=[];
  for(const c of fx.inference)for(const row of c.rows)all.push({group:'inference',name:c.name,row,ts:await ad.costEventFromInferenceCall(row),ref:ref.eventFromInferenceCall(row)});
  for(const g of fx.gateway)for(const [i,row] of g.rows.entries()){const t=gatewayTimes(g,i);all.push({group:'gateway',name:g.name,row,ts:await ad.costEventFromGatewayAttempt(row,t),ref:ref.eventFromGatewayAttempt(row,t)});}
  for(const s of fx.storage)for(const row of s.rows){const c=storageContext(s);all.push({group:'storage',name:s.owner,row,ts:await ad.costEventFromProjectStorageUsage(row,c),ref:ref.eventFromProjectStorageUsage(row,c)});}
  assert.equal(all.length,[...fx.inference,...fx.gateway,...fx.storage].reduce((n,x)=>n+x.rows.length,0));assert.equal(all.length,41);
  for(const x of all){
   assert.deepEqual(x.ts,x.ref,`${x.group} ${x.name} ${x.row.status??x.row.read_ops}`);
   assert.deepEqual(await ct.validateCostEvent(x.ts),x.ts);
  }
  assert.deepEqual([...new Set(all.map(x=>x.ts.source))].sort(),['gateway-settlement','inference-receipt','storage-operations']);
 });
 await check('validator: field-by-field mutation of valid events agrees with the independent reference on accept/reject and on the code',async()=>{
  const bases=[usage(),ai(),liability(),...all.filter((_,i)=>i%3===0).map(x=>x.ts)];
  const values=[undefined,null,'',' ','x','closed:abc','a'.repeat(200),0,-1,1.5,2**53,Number.NaN,true,[],{}];
  let compared=0,rejected=0;const looser=[],stringFields={'cost.ref':'INVALID_COST','cost.tariff.id':'INVALID_COST'};
  for(const base of bases){
   const paths=[];
   const walk=(value,path)=>{if(value&&typeof value==='object'&&!Array.isArray(value)){for(const k of Object.keys(value)){paths.push([...path,k]);walk(value[k],[...path,k]);}}};walk(base,[]);
   for(const path of paths)for(const value of values){
    const event=structuredClone(base);let at=event;for(const k of path.slice(0,-1))at=at[k];
    if(value===undefined)delete at[path.at(-1)];else at[path.at(-1)]=value;
    const [expected,actual]=[refCode(()=>ref.validateEvent(event)),await tsCode(()=>ct.validateCostEvent(event))];
    assert.ok(!expected.startsWith('CRASH')&&!actual.startsWith('CRASH'),`${path.join('.')}=${String(value)}: ${expected} / ${actual}`);
    // The reference coerces a non-string identifier through its pattern (`SAFE.test(5)` is true), so it accepts one or fails on it only at a
    // later rule. The source requires a string. Any difference must be exactly that: a non-string value in a string-typed field, refused
    // with that field's own code. Everything else - every other field and every string value - must agree exactly.
    if(actual!==expected){
     const field=path.join('.');looser.push(`${field}=${typeof value}`);
     assert.ok(Object.hasOwn(stringFields,field)&&typeof value!=='string',`${field}=${String(value)}: ${expected} / ${actual}`);assert.equal(actual,stringFields[field],field);
    }
    compared++;if(expected!=='ACCEPTED')rejected++;
   }
  }
  // The reference's only looseness: a non-string cost reference or tariff ID (the frozen WH-168 branch is left unchanged).
  assert.deepEqual([...new Set(looser.map(x=>x.split('=')[0]))].sort(),['cost.ref','cost.tariff.id']);
  if(explain&&label==='source')console.log('field mutations compared',compared,'rejected',rejected,'looser',looser.length);
  assert.ok(compared>1500&&rejected>1000,`${compared} ${rejected}`);
 });

 await check('adapters: revision order follows the receipt state machines and a later state always outranks an earlier one',()=>{
  const revision=(group,name,i)=>all.filter(x=>x.group===group&&x.name===name)[i].ts.revision;
  for(const c of fx.inference){const revisions=c.rows.map((_,i)=>revision('inference',c.name,i));assert.deepEqual(revisions,[...revisions].sort((a,b)=>a-b),c.name);assert.equal(new Set(revisions).size,revisions.length,c.name);}
  for(const g of fx.gateway){const revisions=g.rows.map((_,i)=>revision('gateway',g.name,i));assert.deepEqual(revisions,[...revisions].sort((a,b)=>a-b),g.name);assert.equal(new Set(revisions).size,revisions.length,g.name);}
  const byStatus=Object.fromEntries(all.filter(x=>x.group==='inference').map(x=>[x.row.status,x.ts.revision]));
  assert.deepEqual(byStatus,{reserved:1,dispatched:2,observed:4,released:4,uncertain:3});
  assert.deepEqual(Object.fromEntries(all.filter(x=>x.group==='gateway').map(x=>[x.row.status,x.ts.revision])),{reserved:1,dispatched:2,uncertain:3,settled:4,released:4});
  // Storage: the counter is the revision, so the highest reading wins.
  for(const s of fx.storage)assert.deepEqual(all.filter(x=>x.group==='storage'&&x.name===s.owner).map(x=>x.ts.revision),s.rows.map(r=>r.read_ops));
 });
 await check('adapters: pending, uncertain and unpriced calls stay explicit unknowns with their reserved hold; released calls consumed nothing',()=>{
  for(const x of all.filter(x=>x.group!=='storage')){
   const {row,ts}=x,reserved=row.reserved_micros??row.provider_reserved;
   if(['reserved','dispatched'].includes(row.status)){
    assert.deepEqual(ts.quantity,{state:'unknown',reason:'usage-pending'});assert.deepEqual(ts.cost,{basis:'unknown',reason:'usage-pending',exposureMicros:reserved});assert.equal(ts.outcome,'pending');
   }else if(row.status==='uncertain'){
    assert.deepEqual(ts.quantity,{state:'unknown',reason:'outcome-unknown'});assert.deepEqual(ts.cost,{basis:'unknown',reason:'outcome-unknown',exposureMicros:reserved});assert.equal(ts.outcome,'uncertain');
   }else if(row.status==='released'){
    assert.deepEqual(ts.quantity,{state:'known',value:0,unit:'call'});assert.equal(ts.cost.micros,0);assert.notEqual(ts.cost.basis,'unknown');assert.deepEqual(ts.detail,{});assert.equal(ts.outcome,'released');
   }else if(row.cost_basis==='unpriced'){
    assert.deepEqual(ts.cost,{basis:'unknown',reason:'unpriced',exposureMicros:null});assert.equal(ts.outcome,'settled');assert.deepEqual(ts.quantity,{state:'known',value:1,unit:'call'});
   }else{
    assert.equal(ts.outcome,'settled');assert.deepEqual(ts.detail,{inputTokens:row.input_tokens,outputTokens:row.output_tokens});
    assert.deepEqual(ts.cost,{basis:x.group==='gateway'?'receipt':'shadow',micros:row.estimated_micros??row.provider_actual,ref:ts.cost.ref});
   }
  }
  assert.ok(all.some(x=>x.row.status==='uncertain')&&all.some(x=>x.row.cost_basis==='unpriced'&&x.row.status==='observed')&&all.some(x=>x.row.status==='released'));
  // Provider usage that the tables do not hold is never invented: no provider-reported figure and no provider ID unless supplied.
  assert.ok(all.every(x=>x.ts.cost.basis!=='provider-reported'));assert.ok(all.filter(x=>x.group==='inference'||x.group==='storage').every(x=>x.ts.providerEventId===null));
 });
 await check('adapters: Chat acknowledgments are control cost, tenant attribution is owner-level and the storage reading is a standing tariff-priced operation count',()=>{
  const ack=all.find(x=>x.name==='shadow acknowledgment'&&x.row.status==='observed').ts,main=all.find(x=>x.name==='shadow orchestrator'&&x.row.status==='observed').ts;
  assert.equal(ack.workClass,'control');assert.equal(main.workClass,'task');assert.ok(ack.sourceEventId.endsWith(':ack'));assert.equal(ack.taskRef,all.find(x=>x.ts===ack).row.turn_id);assert.notEqual(ack.taskRef,main.taskRef);
  assert.deepEqual(main.attribution,{scope:'tenant',ownerId:fx.owner,projectId:null,resourceId:null});
  const latest=all.filter(x=>x.group==='storage').find(x=>x.row.read_ops===3).ts;
  assert.deepEqual(latest.quantity,{state:'known',value:3,unit:'operation'});assert.deepEqual(latest.cost,{basis:'tariff',tariff:{id:'pool-proposal',version:1}});assert.equal(latest.workClass,'standing');assert.equal(latest.taskRef,null);
  assert.equal(latest.sourceEventId,`${latest.attribution.projectId}:${fx.period}:read_ops`);assert.equal(latest.occurredAt,`${fx.period}-01T00:00:00.000Z`);
 });

 // ---------- Replay, aggregates and the customer boundary ----------
 const ledgerWith=events=>{
  const directory=ref.createIdentityDirectory();for(const s of fx.storage)directory.addProject(s.project,s.owner);
  const ledger=ref.createLedger({directory,now:()=>'2026-10-08T00:00:00.000Z',closureKey:'k'.repeat(32)});
  for(const e of events)ledger.append(e);return ledger;
 };
 await check('replay: every arrival order, with duplicates and stale revisions, yields identical aggregates equal to those computed from the final receipts',async()=>{
  const events=all.map(x=>x.ts);
  let seed=11;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  const shuffle=a=>{const b=[...a];for(let i=b.length-1;i>0;i--){const j=Math.floor(rnd()*(i+1));[b[i],b[j]]=[b[j],b[i]];}return b;};
  const orders=[events,[...events].reverse(),[...events].sort((a,b)=>b.revision-a.revision),[...events].sort((a,b)=>a.revision-b.revision),[...events,...events]];
  for(let i=0;i<40;i++)orders.push(shuffle([...events,...shuffle(events).slice(0,10)]));
  const expected=JSON.stringify(ledgerWith(events).summary({}));
  for(const order of orders)assert.equal(JSON.stringify(ledgerWith(order).summary({})),expected);
  // The same totals, computed independently from the final receipt rows.
  const s=JSON.parse(expected),inferenceFinal=finalRows(fx.inference),gatewayFinal=finalRows(fx.gateway),storageFinal=fx.storage.map(x=>x.rows.at(-1));
  const pending=r=>['reserved','dispatched','uncertain'].includes(r.status);
  const sum=(rows,f)=>rows.reduce((a,r)=>a+f(r),0);
  assert.equal(s.events,inferenceFinal.length+gatewayFinal.length+storageFinal.length);
  assert.equal(s.shadowMicros,sum(inferenceFinal.filter(r=>r.status==='observed'&&r.cost_basis==='subscription-shadow'),r=>r.estimated_micros));
  assert.equal(s.receiptMicros,sum(gatewayFinal.filter(r=>r.status==='settled'),r=>r.provider_actual));assert.equal(s.providerReportedMicros,0);
  assert.equal(s.boundedExposureMicros,sum(inferenceFinal.filter(pending),r=>r.reserved_micros)+sum(gatewayFinal.filter(pending),r=>r.provider_reserved));
  assert.equal(s.unboundedExposureEvents,inferenceFinal.filter(r=>r.status==='observed'&&r.cost_basis==='unpriced').length);
  assert.equal(s.unknownEvents,inferenceFinal.filter(r=>pending(r)||(r.status==='observed'&&r.cost_basis==='unpriced')).length+gatewayFinal.filter(pending).length);
  assert.equal(s.pending+s.uncertain,inferenceFinal.filter(pending).length+gatewayFinal.filter(pending).length);
  assert.equal(s.uncertain,inferenceFinal.filter(r=>r.status==='uncertain').length+gatewayFinal.filter(r=>r.status==='uncertain').length);
  assert.equal(s.units.call,inferenceFinal.filter(r=>r.status==='observed').length+gatewayFinal.filter(r=>r.status==='settled').length);
  assert.equal(s.units.operation,sum(storageFinal,r=>r.read_ops));assert.equal(s.tariffMicros,Math.ceil(sum(storageFinal,r=>r.read_ops)*360000/1_000_000));
  assert.equal(s.knownEstimateMicros,s.tariffMicros+s.receiptMicros);assert.equal(s.customerUnits,0);
  if(explain&&label==='source')console.log('replay aggregates',orders.length,'orders',JSON.stringify({events:s.events,shadow:s.shadowMicros,receipt:s.receiptMicros,exposure:s.boundedExposureMicros,unbounded:s.unboundedExposureEvents,unknown:s.unknownEvents,pending:s.pending,uncertain:s.uncertain,units:s.units,tariff:s.tariffMicros,known:s.knownEstimateMicros}));
  assert.ok(s.shadowMicros>0&&s.receiptMicros>0&&s.boundedExposureMicros>0&&s.unboundedExposureEvents>0&&s.uncertain>0);
 });
 await check('replay: a stale lower revision arriving after the final state is stored but never counted',()=>{
  const call=fx.inference.find(c=>c.name==='shadow lost response resolved late'),events=all.filter(x=>x.name===call.name).map(x=>x.ts);
  const ledger=ledgerWith([events.at(-1)]);const before=JSON.stringify(ledger.summary({}));
  for(const e of events.slice(0,-1))assert.equal(ledger.append(e).status,'stale-revision');
  assert.equal(JSON.stringify(ledger.summary({})),before);assert.equal(ledger.summary({}).uncertain,0);
 });
 await check('customer boundary: every event has zero customer units and never carries or derives from a customer figure, for standard and premium alike',async()=>{
  const premium=fx.gateway.find(g=>g.name==='premium settled'),settled=premium.rows.at(-1);
  assert.equal(premium.tier,'premium');assert.ok(settled.customer_actual>settled.provider_actual&&settled.customer_actual>0,'the premium fixture must carry a distinct customer debit');
  const standard=fx.gateway.find(g=>g.name==='standard settled').rows.at(-1);assert.equal(standard.customer_actual,0);
  for(const x of all){
   assert.equal(x.ts.customerUnits,0);
   const text=JSON.stringify(x.ts);
   assert.ok(!/customer(?!Units)/i.test(text),text);assert.ok(!/debit|credit|charge|balance|wallet|invoice/i.test(text),text);
  }
  const premiumEvent=all.find(x=>x.group==='gateway'&&x.row.id===settled.id&&x.row.status==='settled').ts;
  assert.equal(premiumEvent.aiTier,'premium');assert.deepEqual(premiumEvent.cost,{basis:'receipt',micros:settled.provider_actual,ref:premiumEvent.cost.ref});
  assert.notEqual(premiumEvent.cost.micros,settled.customer_actual);assert.ok(!numbers(premiumEvent).includes(settled.customer_actual),'the customer debit is not a field of the event');
  assert.equal(all.find(x=>x.group==='gateway'&&x.row.id===standard.id&&x.row.status==='settled').ts.aiTier,'standard');
  assert.ok(all.filter(x=>x.group==='inference').every(x=>x.ts.aiTier==='standard'));
  // The customer figure is not read at all (see the registered-reader check) and cannot be smuggled in through the validator.
  await code(()=>ct.validateCostEvent({...premiumEvent,customerUnits:settled.customer_actual}),'BILLING_AUTHORITY');
  await code(()=>ct.validateCostEvent({...premiumEvent,customerActual:settled.customer_actual}),'UNKNOWN_FIELD');
  await code(()=>ct.validateCostEvent({...premiumEvent,debit:1}),'BILLING_AUTHORITY');
  // Changing only the customer columns never changes the event; changing the provider columns does.
  const changed=await ad.costEventFromGatewayAttempt({...settled,customer_actual:1,customer_reserved:7},gatewayTimes(premium,premium.rows.length-1));
  assert.deepEqual(changed,premiumEvent);
  assert.notDeepEqual(await ad.costEventFromGatewayAttempt({...settled,provider_actual:settled.provider_actual-1},gatewayTimes(premium,premium.rows.length-1)),premiumEvent);
 });

 // ---------- Malformed rows, unknown states, unsafe integers, foreign fields and the registered readers ----------
 const inferenceRow=fx.inference[0].rows.at(-1),pendingRow=fx.inference[4].rows.at(-1),gatewayRow=fx.gateway[0].rows.at(-1),gatewayPending=fx.gateway[3].rows.at(-1),storageRow=fx.storage[0].rows.at(-1);
 const gt=gatewayTimes(fx.gateway[0],fx.gateway[0].rows.length-1),sctx=storageContext(fx.storage[0]);
 await check('malformed rows: every unknown state, unsafe or inconsistent figure and malformed identity is refused with a specific code and nothing is repaired',async()=>{
  const inf=(over,expected,name)=>code(()=>ad.costEventFromInferenceCall({...inferenceRow,...over}),expected,name);
  const infPending=(over,expected,name)=>code(()=>ad.costEventFromInferenceCall({...pendingRow,...over}),expected,name);
  for(const status of ['archived','','OBSERVED','settled','constructor','__proto__',null,undefined,7])await inf({status},'UNKNOWN_STATUS',`status ${String(status)}`);
  await inf({cost_basis:'provider-reported'},'UNKNOWN_COST_BASIS','cost basis');await inf({cost_basis:undefined},'UNKNOWN_COST_BASIS','cost basis missing');
  for(const role of ['visitor','','Orchestrator',null])await inf({role},'INVALID_RECEIPT',`role ${String(role)}`);
  for(const field of ['input_tokens','output_tokens','estimated_micros']){
   await inf({[field]:null},'INVALID_RECEIPT',`observed ${field} null`);await inf({[field]:undefined},'INVALID_RECEIPT',`observed ${field} missing`);await inf({[field]:1.5},'INVALID_RECEIPT',`${field} fraction`);
   await inf({[field]:-1},'INVALID_RECEIPT',`${field} negative`);await inf({[field]:'100'},'INVALID_RECEIPT',`${field} string`);await inf({[field]:Number.NaN},'INVALID_RECEIPT',`${field} NaN`);
   await inf({[field]:2**53},'AMOUNT_UNSAFE',`${field} unsafe`);await inf({[field]:Number.MAX_SAFE_INTEGER+2},'AMOUNT_UNSAFE',`${field} beyond safe`);await inf({[field]:10n},'INVALID_RECEIPT',`${field} bigint`);
   await infPending({[field]:5},'INVALID_RECEIPT',`pending ${field} present`);
  }
  await infPending({reserved_micros:2**53},'AMOUNT_UNSAFE','unsafe hold');await infPending({reserved_micros:-1},'INVALID_RECEIPT','negative hold');await infPending({reserved_micros:undefined},'INVALID_RECEIPT','missing hold');
  await inf({user_id:'owner-1'},'INVALID_ATTRIBUTION','owner is not a UUID');await inf({user_id:''},'INVALID_RECEIPT','empty owner');await inf({created_at:'2026-10-02'},'INVALID_TIME','date-only creation time');
  await inf({id:'has space'},'INVALID_EVENT','receipt ID outside the identifier alphabet');await inf({id:'x'.repeat(129)},'INVALID_RECEIPT','receipt ID too long');await inf({turn_id:'t'.repeat(65)},'INVALID_EVENT','task reference too long');
  await inf({rate_id:'bad rate'},'INVALID_COST','cost reference outside the alphabet');await inf({id:'closed:abc'},'INVALID_EVENT','tombstone-shaped ID');
  for(const bad of [null,undefined,'row',7,[]])await code(()=>ad.costEventFromInferenceCall(bad),'INVALID_RECEIPT',`row ${String(bad)}`);
  const gw=(over,expected,name,times=gt)=>code(()=>ad.costEventFromGatewayAttempt({...gatewayRow,...over},times),expected,name);
  const gwPending=(over,expected,name)=>code(()=>ad.costEventFromGatewayAttempt({...gatewayPending,...over},gt),expected,name);
  for(const status of ['observed','pending','archived','',null])await gw({status},'UNKNOWN_STATUS',`gateway status ${String(status)}`);
  for(const field of ['input_tokens','output_tokens','provider_actual']){
   await gw({[field]:null},'INVALID_RECEIPT',`settled ${field} null`);await gw({[field]:-3},'INVALID_RECEIPT',`${field} negative`);await gw({[field]:2.5},'INVALID_RECEIPT',`${field} fraction`);await gw({[field]:2**53},'AMOUNT_UNSAFE',`${field} unsafe`);
   await gwPending({[field]:1},'INVALID_RECEIPT',`pending ${field} present`);
  }
  await gwPending({provider_reserved:2**53},'AMOUNT_UNSAFE','unsafe gateway hold');await gwPending({provider_reserved:'2100'},'INVALID_RECEIPT','string hold');
  const snapshot=JSON.parse(gatewayRow.snapshot);
  for(const [bad,name] of [[undefined,'missing'],[{},'object, not the stored text'],['not json','not JSON'],['[]','array'],['null','null'],['{}','empty'],[JSON.stringify({...snapshot,tier:'enterprise'}),'unknown tier'],[JSON.stringify({...snapshot,tier:undefined}),'no tier'],
   [JSON.stringify({...snapshot,rate:null}),'no rate'],[JSON.stringify({...snapshot,rate:{}}),'rate without ID'],[JSON.stringify({...snapshot,rate:[]}),'rate array'],[JSON.stringify({...snapshot,ownerId:'someone-else'}),'another owner'],[JSON.stringify({...snapshot,taskId:'another-task'}),'another task']])
   await gw({snapshot:bad},'INVALID_RECEIPT',`snapshot ${name}`);
  await gw({task_id:'task with space',snapshot:JSON.stringify({...snapshot,taskId:'task with space'})},'INVALID_EVENT','task outside the reference alphabet');
  await code(()=>ad.costEventFromGatewayAttempt(gatewayRow),'INVALID_RECEIPT','times are required');await code(()=>ad.costEventFromGatewayAttempt(null,gt),'INVALID_RECEIPT','gateway row null');await code(()=>ad.costEventFromProjectStorageUsage(null,sctx),'INVALID_RECEIPT','storage row null');
  await gw({},'INVALID_TIME','occurredAt missing',{});await gw({},'INVALID_TIME','occurredAt malformed',{occurredAt:'yesterday'});await gw({},'INVALID_TIME','observation before occurrence',{occurredAt:T0,observedAt:after(-5)});
  await gw({},'INVALID_EVENT','provider ID outside the alphabet',{...gt,providerEventId:'bad id'});await gw({},'INVALID_RECEIPT','provider ID empty',{...gt,providerEventId:''});
  const st=(over,expected,name,context=sctx)=>code(()=>ad.costEventFromProjectStorageUsage({...storageRow,...over},context),expected,name);
  for(const read_ops of [0,-1,1.5,'3',null,undefined,Number.NaN])await st({read_ops},'INVALID_RECEIPT',`read_ops ${String(read_ops)}`);
  await st({read_ops:2**53},'AMOUNT_UNSAFE','unsafe counter');
  for(const period of ['2026-13','2026-00','2026-1','202610','2026-10-01',null,undefined,10])await st({period},'INVALID_RECEIPT',`period ${String(period)}`);
  await st({project_id:'project-1'},'INVALID_ATTRIBUTION','project is not a UUID');await st({project_id:undefined},'INVALID_RECEIPT','project missing');
  await st({},'INVALID_ATTRIBUTION','owner is not a UUID',{...sctx,ownerId:'owner'});await st({},'INVALID_TIME','observation before the period starts',{...sctx,observedAt:'2026-01-01T00:00:00.000Z'});
  await st({},'INVALID_TIME','observation time missing',{ownerId:sctx.ownerId});await code(()=>ad.costEventFromProjectStorageUsage(storageRow),'INVALID_RECEIPT','context is required');
  // A period before the pinned planning tariff existed is refused rather than priced under a tariff that was not in force.
  await st({period:'2026-09'},'TARIFF_NOT_EFFECTIVE','period before the tariff',{...sctx,observedAt:'2026-10-01T00:00:00.000Z'});
  // A row of the wrong table is never mistaken for another: its columns are not there.
  await code(()=>ad.costEventFromInferenceCall(gatewayRow),'UNKNOWN_STATUS','settled gateway row given to the inference reader');await code(()=>ad.costEventFromInferenceCall(gatewayPending),'INVALID_RECEIPT','pending gateway row given to the inference reader');
  await code(()=>ad.costEventFromGatewayAttempt(inferenceRow,gt),'UNKNOWN_STATUS','observed inference row given to the gateway reader');await code(()=>ad.costEventFromGatewayAttempt(pendingRow,gt),'INVALID_RECEIPT','pending inference row given to the gateway reader');
  await code(()=>ad.costEventFromProjectStorageUsage(inferenceRow,sctx),'INVALID_RECEIPT','inference row given to the storage reader');
 });
 await check('registered readers: each adapter reads only registered columns of its own table, never customer figures or text, and never writes',async()=>{
  const trace=async(table,fn)=>{
   const seen=new Set();const refuse=()=>{throw new Error('an adapter must never write to a receipt row');};const proxied=row=>new Proxy({...row},{get:(t,k)=>{if(typeof k==='string')seen.add(k);return t[k];},set:refuse,defineProperty:refuse,deleteProperty:refuse});
   const event=await fn(proxied);
   for(const column of seen)assert.ok(fx.columns[table].includes(column),`${table}.${column} is not a column`);
   return {seen,event};
  };
  const forbidden={inference_calls:['ack_text','model','provider_origin','policy','protocol','period'],gateway_spend_attempts:['customer_actual','customer_reserved','task_bucket','account_bucket','platform_bucket','premium_bucket','approval_bucket'],storage_project_usage:[]};
  const reads={
   inference_calls:await trace('inference_calls',p=>ad.costEventFromInferenceCall(p(inferenceRow))),
   gateway_spend_attempts:await trace('gateway_spend_attempts',p=>ad.costEventFromGatewayAttempt(p(gatewayRow),gt)),
   storage_project_usage:await trace('storage_project_usage',p=>ad.costEventFromProjectStorageUsage(p(storageRow),sctx))
  };
  for(const [table,{seen,event}] of Object.entries(reads)){
   for(const column of forbidden[table])assert.ok(!seen.has(column),`${table}.${column} must not be read`);
   assert.equal(ct.sources[event.source].table,table);assert.equal(ct.sources[event.source].readiness,'source-adapter');
   assert.ok(ct.dimensions[event.dimension].sources.includes(event.source));assert.ok(Object.hasOwn(ct.workloads,event.workload));
  }
  assert.deepEqual([...reads.inference_calls.seen].sort(),['cost_basis','created_at','estimated_micros','id','input_tokens','output_tokens','rate_id','reserved_micros','role','status','turn_id','user_id']);
  assert.deepEqual([...reads.gateway_spend_attempts.seen].sort(),['id','input_tokens','output_tokens','provider_actual','provider_reserved','snapshot','status','task_id','user_id']);
  assert.deepEqual([...reads.storage_project_usage.seen].sort(),['period','project_id','read_ops']);
  // Foreign fields: text, customer figures and unregistered columns on a row are ignored and cannot reach an event; rows are not mutated.
  const foreign={ack_text:'Hello there, Alex',prompt:'secret prompt',customer_actual:987654321,apiKey:'sk-abcdefghijklmnop',extra:{nested:1}};
  for(const [row,fn] of [[inferenceRow,r=>ad.costEventFromInferenceCall(r)],[gatewayRow,r=>ad.costEventFromGatewayAttempt(r,gt)],[storageRow,r=>ad.costEventFromProjectStorageUsage(r,sctx)]]){
   const withForeign=Object.freeze({...row,...foreign}),before=structuredClone({...withForeign});
   const out=await fn(withForeign);assert.deepEqual(out,await fn(row));assert.deepEqual({...withForeign},before);
   assert.ok(!/Hello there|secret prompt|sk-abcdefghijklmnop/.test(JSON.stringify(out)));assert.ok(!numbers(out).includes(987654321));
  }
  // Rows from node:sqlite have a null prototype; rows from D1 are plain objects. Both are read the same way.
  assert.deepEqual(await ad.costEventFromInferenceCall(Object.assign(Object.create(null),inferenceRow)),await ad.costEventFromInferenceCall(inferenceRow));
 });
 await check('foreign fields on an event are refused by the validator, and the adapters accept no registry or schema input',async()=>{
  const event=all[0].ts;
  for(const [field,expected] of [['ack_text','UNKNOWN_FIELD'],['customerActual','UNKNOWN_FIELD'],['credit','BILLING_AUTHORITY'],['bucketName','PHYSICAL_LOCATOR'],['email','CONTENT_FIELD'],['receivedSeq','CLIENT_ASSIGNED']])
   await code(()=>ct.validateCostEvent({...event,[field]:1}),expected,field);
  assert.equal(ct.validateCostEvent.length,1);assert.equal(ad.costEventFromInferenceCall.length,1);
 });
 return count;
}

// ---------- Static scope: pure source, no runtime wiring, no schema or consumer change ----------
const walk=(dir)=>readdirSync(new URL('../'+dir+'/',import.meta.url),{withFileTypes:true}).flatMap(d=>d.isDirectory()?walk(dir+'/'+d.name):[dir+'/'+d.name]);
function staticScope(texts=sourceText){
 const contract=texts['src/cost-events.ts'],adapters=texts['src/cost-event-adapters.ts'];
 const imports=text=>[...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+['"]([^'"]+)['"]/gm)].map(x=>x[1]);
 assert.deepEqual(imports(contract),[]);assert.deepEqual(imports(adapters),['./cost-events']);
 for(const [file,text] of Object.entries(texts)){
  assert.ok(!/node:|createHash|createHmac|require\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env|Date\.now|new Date\(\)|Math\.random|randomUUID|D1Database|\.prepare\(|\.batch\(|\.bind\(|\.run\(|INSERT |UPDATE |DELETE |env\./.test(text),file);
  assert.ok(!/prototypes|cost-events[.]mjs/.test(text),file);
 }
 assert.match(contract,/crypto\.subtle\.digest\('SHA-256'/);
 // Nothing in the product imports the contract or adapters: no route, producer or consumer is wired to them in this packet.
 const users=[...walk('src'),...walk('frontend'),...walk('public-app')].filter(f=>/\.(?:ts|tsx|js|mjs)$/.test(f)&&!/src\/cost-event(?:s|-adapters)\.ts$/.test(f)).filter(f=>/cost-event(?:s|-adapters)/.test(readFileSync(new URL('../'+f,import.meta.url),'utf8')));
 assert.deepEqual(users,[]);
 for(const file of ['src/model-costs.ts','src/gateway-spend.ts','src/storage-budget.ts','src/task-cost-report.ts'])assert.ok(!/cost-event/.test(read(file)),file);
 assert.ok(!/cost.?event/i.test(read('schema/platform.sql')),'no schema change');
}
staticScope();

const realSuite=await suite(await loadSource(),'source');
console.log(`cost-event-adapters: ${realSuite} source checks passed over ${fx.inference.reduce((a,c)=>a+c.rows.length,0)} inference, ${fx.gateway.reduce((a,c)=>a+c.rows.length,0)} gateway and ${fx.storage.reduce((a,c)=>a+c.rows.length,0)} storage receipt states`);

// ---------- Mutation check: each deliberately broken source must fail the suite on the check written for that property ----------
const C='src/cost-events.ts',A='src/cost-event-adapters.ts';
const mutants=[
 ['idempotency key not verified',C,"check(e.idempotencyKey === await idempotencyKey(e as { source: string; sourceEventId: string; dimension: string }), 'IDEMPOTENCY_KEY'","check(true, 'IDEMPOTENCY_KEY'"],
 ['idempotency key omits the dimension',C,"canonical({ dimension: identity.dimension, source: identity.source, sourceEventId: identity.sourceEventId })","canonical({ source: identity.source, sourceEventId: identity.sourceEventId })"],
 ['canonical form unsorted',C,"Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))","x"],
 ['customer units accepted',C,"check(e.customerUnits === 0, 'BILLING_AUTHORITY'","check(true, 'BILLING_AUTHORITY'"],
 ['billing field accepted',C,"check(!BILLING_KEY.test(k) || keys.includes(k), 'BILLING_AUTHORITY'","check(true, 'BILLING_AUTHORITY'"],
 ['content field accepted',C,"check(!CONTENT_KEY.test(k), 'CONTENT_FIELD', `${where}.${k}`)","check(true, 'CONTENT_FIELD', `${where}.${k}`)"],
 ['physical locator accepted',C,"check(!LOCATOR_KEY.test(k) || keys.includes(k), 'PHYSICAL_LOCATOR'","check(true, 'PHYSICAL_LOCATOR'"],
 ['secret accepted',C,"check(!SECRET.test(canonical(e)), 'SECRET_IN_EVENT'","check(true, 'SECRET_IN_EVENT'"],
 ['released call may consume',C,"e.quantity.state === 'known' && e.quantity.value === 0 && e.cost.basis !== 'unknown'","e.cost.basis !== 'unknown'"],
 ['released cost not enforced',C,"&& (e.cost.micros ?? 0) === 0","",],
 ['pending call may carry a known cost',C,"if (e.outcome === 'pending' || e.outcome === 'uncertain') check(","if (false) check("],
 ['tariff window ignored',C,"check(e.occurredAt >= t.effectiveFrom && (t.effectiveTo === null || e.occurredAt < t.effectiveTo), 'TARIFF_NOT_EFFECTIVE'","check(true, 'TARIFF_NOT_EFFECTIVE'"],
 ['unpriced dimension accepted',C,"check(Object.hasOwn(t.rates, e.dimension), 'UNPRICED_DIMENSION'","check(true, 'UNPRICED_DIMENSION'"],
 ['unit not checked',C,"check(q.unit === dim.unit, 'UNIT_MISMATCH'","check(true, 'UNIT_MISMATCH'"],
 ['source may emit any dimension',C,"check(dim.sources.includes(e.source), 'SOURCE_DIMENSION'","check(true, 'SOURCE_DIMENSION'"],
 ['unsafe quantity accepted',C,"const isInt = (v: unknown, min = 0): v is number => Number.isSafeInteger(v)","const isInt = (v: unknown, min = 0): v is number => Number.isInteger(v)"],
 ['shadow allowed on infrastructure',C,"if (e.cost.basis === 'shadow') check(dim.provider === 'inference-provider'","if (false) check(dim.provider === 'inference-provider'"],
 ['workload registry not enforced',C,"check(Object.hasOwn(workloads, e.workload), 'UNKNOWN_WORKLOAD'","check(true, 'UNKNOWN_WORKLOAD'"],
 ['validated event aliases the input',C,"const e = snapshot(input);","const e = input as Loose;"],
 ['validated event is a shallow copy',C,"const e = snapshot(input);","const e = plain(input) ? { ...input } : snapshot(input);"],
 ['result re-read from the live input after the digest',C,"return e as CostEvent;","return snapshot(input) as CostEvent;"],
 ['accessor properties are read',C,"check(d && 'value' in d, 'INVALID_EVENT', `${k} is an accessor`);","check(d, 'INVALID_EVENT', `${k} is an accessor`);"],
 ['cycles are not bounded',C,"check(depth <= 8, 'INVALID_EVENT', 'nesting too deep or cyclic');","check(depth <= 1e9, 'INVALID_EVENT', 'nesting too deep or cyclic');"],
 ['non-plain objects copied as plain',C,"if (!plain(value)) return opaque;","if (!plain(value)) return { ...value };"],
 ['registry not frozen',C,"export const workloads = deepFreeze({","export const workloads = ({"],
 ...['unknownReasons','placementClasses','workClasses','outcomes','costBases','platformPools','aiTiers'].map(n=>[`${n} array not frozen`,C,`export const ${n} = deepFreeze(`,`export const ${n} = (`]),
 ['dispatched revision equals reserved',A,"dispatched: [2, 'pending']","dispatched: [1, 'pending']"],
 ['uncertain call reported as pending',A,"uncertain: [3, 'uncertain']","uncertain: [3, 'pending']"],
 ['released outranked by an earlier state',A,"released: [4, 'released']","released: [0, 'released']"],
 ['acknowledgment counted as task cost',A,"workClass: f.control ? 'control' : 'task'","workClass: 'task'"],
 ['pending exposure dropped',A,"exposureMicros: f.reservedMicros","exposureMicros: 0"],
 ['unpriced call priced as zero',A,"cost = f.basis === 'unpriced' ? { basis: 'unknown', reason: 'unpriced', exposureMicros: null } : { basis: f.basis, micros: f.actualMicros!, ref: f.rateRef };","cost = { basis: f.basis === 'unpriced' ? 'shadow' : f.basis, micros: f.actualMicros!, ref: f.rateRef };"],
 ['customer debit used as the provider cost',A,"['input_tokens', 'output_tokens'], 'provider_actual')","['input_tokens', 'output_tokens'], 'customer_actual')"],
 ['premium tier dropped',A,"aiTier: s!.tier as AITier","aiTier: 'standard'"],
 ['storage revision is not the counter',A,"revision: readOps,","revision: 1,"],
 ['storage reading not tariff priced',A,"cost: { basis: 'tariff', tariff: { id: 'pool-proposal', version: 1 } }","cost: { basis: 'unknown', reason: 'unpriced', exposureMicros: null }"],
 ['unknown status accepted as pending',A,"if (typeof status !== 'string' || !vocabulary.includes(status)) throw new CostEventError('UNKNOWN_STATUS', String(status));","if (typeof status !== 'string' || !vocabulary.includes(status)) return 'reserved';"],
 ['unsafe integers accepted',A,"if (!Number.isSafeInteger(v)) throw new CostEventError('AMOUNT_UNSAFE'","if (false) throw new CostEventError('AMOUNT_UNSAFE'"],
 ['figures of an unfinished call ignored',A,"for (const n of names) if (row[n] !== null) bad(`${n} must be null until the call is observed`);","for (const n of names) if (false) bad(`${n} must be null until the call is observed`);"],
 ['snapshot of another owner accepted',A,"if (s!.ownerId !== row.user_id || s!.taskId !== row.task_id) bad('snapshot does not belong to this attempt');",""],
 ['unknown tier accepted',A,"if (s!.tier !== 'standard' && s!.tier !== 'premium') bad('snapshot tier must be standard or premium');",""],
 ['unknown cost basis treated as unpriced',A,"if (row.cost_basis !== 'subscription-shadow' && row.cost_basis !== 'unpriced') throw new CostEventError('UNKNOWN_COST_BASIS', String(row.cost_basis));",""],
 ['acknowledgment text read',A,"rateRef: label(row.rate_id, 'rate_id'),","rateRef: label(row.rate_id, 'rate_id'), ackText: row.ack_text,"],
 ['adapter mutates the row',A,"const row = rowOf(input, 'inference_calls row');\n const status = lifecycleOf(row.status, ['reserved', 'dispatched', 'observed', 'released', 'uncertain']);","const row = rowOf(input, 'inference_calls row'); (row as any).read = true;\n const status = lifecycleOf(row.status, ['reserved', 'dispatched', 'observed', 'released', 'uncertain']);"],
 ['adapter wired into a producer',A,"import { contractVersion","import { dispatchInference } from './model-costs';\nimport { contractVersion"]
];
const killedBy={
 'idempotency key not verified':'validator:','idempotency key omits the dimension':'canonical key:','canonical form unsorted':'canonical key:','customer units accepted':'validator: accepts',
 'billing field accepted':'validator: accepts','content field accepted':'validator: accepts','physical locator accepted':'validator: accepts','secret accepted':'validator: accepts','released call may consume':'validator: accepts',
 'released cost not enforced':'validator: accepts','pending call may carry a known cost':'validator: accepts','tariff window ignored':'validator: accepts','unpriced dimension accepted':'validator: accepts','unit not checked':'validator: accepts',
 'source may emit any dimension':'validator: accepts','unsafe quantity accepted':'validator: accepts','shadow allowed on infrastructure':'validator: accepts','workload registry not enforced':'validator: accepts',
 'validated event aliases the input':'validator: the input is never mutated','validated event is a shallow copy':'validator: the input is never mutated','result re-read from the live input after the digest':'validator: a private snapshot',
 'accessor properties are read':'validator: a private snapshot','cycles are not bounded':'validator: a private snapshot','non-plain objects copied as plain':'validator: accepts','registry not frozen':'registries:',
 'unknownReasons array not frozen':'registries:','placementClasses array not frozen':'registries:','workClasses array not frozen':'registries:','outcomes array not frozen':'registries:','costBases array not frozen':'registries:','platformPools array not frozen':'registries:','aiTiers array not frozen':'registries:',
 'dispatched revision equals reserved':'adapters: the output equals','uncertain call reported as pending':'adapters: the output equals','released outranked by an earlier state':'adapters: the output equals',
 'acknowledgment counted as task cost':'adapters: the output equals','pending exposure dropped':'adapters: the output equals','unpriced call priced as zero':'adapters: the output equals','customer debit used as the provider cost':'adapters: the output equals',
 'premium tier dropped':'adapters: the output equals','storage revision is not the counter':'adapters: the output equals','storage reading not tariff priced':'adapters: the output equals',
 'unknown status accepted as pending':'malformed rows','unsafe integers accepted':'malformed rows','figures of an unfinished call ignored':'malformed rows','snapshot of another owner accepted':'malformed rows','unknown tier accepted':'malformed rows','unknown cost basis treated as unpriced':'malformed rows',
 'acknowledgment text read':'registered readers','adapter mutates the row':'registered readers','adapter wired into a producer':'STATIC'
};
let killed=0;
for(const [name,file,find,replace] of mutants){
 assert.equal(sourceText[file].split(find).length,2,`mutant "${name}" must match the source exactly once`);
 if(killedBy[name]==='STATIC'){
  // A mutant that makes the adapters import a producer is caught by the static-scope check on the patched text.
  assert.throws(()=>staticScope({...sourceText,[file]:sourceText[file].replace(find,()=>replace)}));killed++;continue;
 }
 let outcome;
 try{outcome=await suite(await loadSource([[file,find,replace]]),name);}catch(e){outcome=e;}
 assert.ok(outcome instanceof Error,`mutant survived: ${name}`);
 if(explain)console.log(`${name} => ${outcome.message}`);
 assert.ok(outcome.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${outcome.message}`);killed++;
}
assert.equal(killed,mutants.length);assert.deepEqual(Object.keys(killedBy).sort(),mutants.map(x=>x[0]).sort());
console.log(`cost-event-adapters: ${killed}/${mutants.length} source mutants caught (synthetic identifiers; disposable in-memory SQLite with the current schema; no D1 write by any adapter, network, credential, model or provider).`);
