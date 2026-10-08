import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {taskCostReport} from '../src/task-cost-report.ts';
import {resourceTariff,estimateWorkload} from '../src/resource-economics.ts';

// WH-022 / WH-168 offline conformance for the planned shadow cost-event contract (docs/cost-events.md). Synthetic
// identifiers, rates and providers only: no database write, network, credential, model or provider account. It proves
// the frozen contract and its reference ledger, plus read-only agreement with the existing producers and economic
// scenarios. It does not prove the D1-backed event table, producer emission, provider usage import or any period's
// real cost (WH-170 to WH-172, WH-023). Every suite check also runs against deliberately broken copies of the
// reference (mutants below), each of which must be caught by the check written for that property.
const prototypeURL=new URL('../tools/prototypes/cost-events.mjs',import.meta.url);
const prototypeSource=readFileSync(prototypeURL,'utf8');
const O1='aaaaaaaa-aaaa-4aaa-8aaa-000000000001',O2='aaaaaaaa-aaaa-4aaa-8aaa-000000000002';
const P1='bbbbbbbb-bbbb-4bbb-8bbb-000000000001',P2='bbbbbbbb-bbbb-4bbb-8bbb-000000000002';
const R1='cccccccc-cccc-4ccc-8ccc-000000000001',R2='cccccccc-cccc-4ccc-8ccc-000000000002';
const OCT='2026-10-02T00:00:00.000Z',OCT_SEEN='2026-10-02T01:00:00.000Z';

async function suite(m){
 let count=0,n=0;
 const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const throws=(fn,code)=>assert.throws(fn,e=>{assert.equal(e.code,code,e.message);return true;});
 const fresh=(registry=m.defaultRegistry,extra={})=>{
  const dir=m.createIdentityDirectory();
  dir.addProject(P1,O1);dir.addResource(P1,R1);dir.addProject(P2,O2);dir.addResource(P2,R2);
  return {dir,ledger:m.createLedger({directory:dir,registry,now:()=>'2026-10-08T00:00:00.000Z',...extra})};
 };
 const usage=(over={})=>{
  const e={contractVersion:1,source:'cloudflare-usage-import',sourceEventId:`cf-${++n}`,providerEventId:null,revision:1,kind:'usage',dimension:'worker.requests',workload:'app-runtime',
   workClass:'standing',taskRef:null,attempt:1,attribution:{scope:'tenant',ownerId:O1,projectId:P1,resourceId:R1},placementClass:'shared-api',
   quantity:{state:'known',value:1000,unit:'request'},cost:{basis:'tariff',tariff:{id:'pool-proposal',version:1}},outcome:'settled',customerUnits:0,aiTier:null,detail:{},
   occurredAt:OCT,observedAt:OCT_SEEN,idempotencyKey:'',...over};
  if(!over.idempotencyKey)e.idempotencyKey=m.idempotencyKey(e);
  return e;
 };
 const liability=(dimension,cost,over={})=>usage({source:'liability-register',dimension,kind:'liability',workload:'platform-standing',attribution:{scope:'platform',pool:'shared-account'},placementClass:'platform',quantity:{state:'known',value:1,unit:'item'},cost,...over});
 const call=(o={})=>({id:'call-1',turn_id:'turn-1',user_id:O1,role:'orchestrator',status:'observed',cost_basis:'subscription-shadow',rate_id:'muse-test-shadow-v1',reserved_micros:500,
  input_tokens:1000,output_tokens:200,estimated_micros:140,created_at:'2026-10-03T10:00:00.000Z',...o});
 const pending=(o={})=>call({status:'reserved',input_tokens:null,output_tokens:null,estimated_micros:null,...o});
 const tariffs2=()=>{
  const r=structuredClone(m.defaultRegistry);
  r.tariffs['pool-proposal'][1].effectiveTo='2026-11-01T00:00:00.000Z';
  r.tariffs['pool-proposal'][2]={status:'proposal',effectiveFrom:'2026-11-01T00:00:00.000Z',effectiveTo:null,rates:{...r.tariffs['pool-proposal'][1].rates,'worker.requests':{perUnits:1_000_000,micros:600_000}},accountAllowance:null,allowanceAllocation:'account-wide-not-allocated'};
  return r;
 };

 // ---------- Registries and envelope shape ----------
 await test('registries are valid, closed and list every launch workload and the existing producers',()=>{
  assert.equal(m.validateRegistry(m.defaultRegistry),true);
  for(const w of ['kit-preview','guest-preview','comments','leads','notifications','connector-read','connector-action','collaboration','staging','portfolio-bulk'])assert.equal(m.workloads[w].readiness,'planned',w);
  for(const s of ['inference-receipt','gateway-settlement','storage-operations'])assert.ok(m.sources[s]);
  assert.deepEqual(Object.keys(m.dimensions).filter(d=>m.dimensions[d].readiness==='source-producer').sort(),['ai.inference.call','r2.class_b_ops']);
  assert.ok(Object.values(m.workloads).every(w=>/^WH-\d{3}$/.test(w.packet)));
 });
 await test('unknown versions, fields, sources, dimensions, workloads, units and kinds are rejected',()=>{
  const {ledger}=fresh();
  throws(()=>ledger.append(usage({contractVersion:2})),'UNSUPPORTED_VERSION');
  throws(()=>ledger.append({...usage(),extra:1}),'UNKNOWN_FIELD');
  throws(()=>{const {outcome,...rest}=usage();ledger.append(rest);},'MISSING_FIELD');
  throws(()=>ledger.append(usage({source:'mystery'})),'UNKNOWN_SOURCE');
  throws(()=>ledger.append(usage({dimension:'gpu.hours'})),'UNKNOWN_DIMENSION');
  throws(()=>ledger.append(usage({dimension:'__proto__'})),'UNKNOWN_DIMENSION');
  throws(()=>ledger.append(usage({source:'inference-receipt'})),'SOURCE_DIMENSION');
  throws(()=>ledger.append(usage({workload:'invented'})),'UNKNOWN_WORKLOAD');
  throws(()=>ledger.append(usage({quantity:{state:'known',value:5,unit:'gigabyte'}})),'UNIT_MISMATCH');
  throws(()=>ledger.append(usage({kind:'liability'})),'KIND_MISMATCH');
  throws(()=>ledger.append(usage({quantity:{state:'known',value:-1,unit:'request'}})),'INVALID_QUANTITY');
  throws(()=>ledger.append(usage({quantity:{state:'known',value:1.5,unit:'request'}})),'INVALID_QUANTITY');
  throws(()=>ledger.append(usage({occurredAt:'2026-10-02'})),'INVALID_TIME');
  throws(()=>ledger.append(usage({observedAt:'2026-10-01T00:00:00.000Z'})),'INVALID_TIME');
  throws(()=>ledger.append(usage({attribution:{scope:'tenant',ownerId:O1,projectId:null,resourceId:R1}})),'INVALID_ATTRIBUTION');
  throws(()=>ledger.append(usage({aiTier:'standard'})),'INVALID_EVENT');
 });
 await test('identity: the key is derived, redelivery is a no-op and conflicting redelivery is refused',()=>{
  const {ledger}=fresh();
  throws(()=>ledger.append(usage({idempotencyKey:'f'.repeat(64)})),'IDEMPOTENCY_KEY');
  const e=usage();
  assert.equal(ledger.append(e).status,'accepted');
  assert.equal(ledger.append(structuredClone(e)).status,'duplicate');
  const changed=usage({sourceEventId:e.sourceEventId,quantity:{state:'known',value:9999,unit:'request'}});
  throws(()=>ledger.append(changed),'IDEMPOTENCY_CONFLICT');
  assert.equal(ledger.summary({period:'2026-10'}).units.request,1000);
  assert.notEqual(m.idempotencyKey({source:'a',sourceEventId:'x',dimension:'worker.requests'}),m.idempotencyKey({source:'a',sourceEventId:'x',dimension:'worker.cpu_ms'}));
 });

 // ---------- Duplicate, late and out-of-order events ----------
 await test('a duplicate or redelivered event cannot double-count',()=>{
  const {ledger}=fresh();
  const e=usage();for(let i=0;i<5;i++)ledger.append(structuredClone(e));
  const s=ledger.summary({period:'2026-10'});
  assert.equal(s.events,1);assert.equal(s.units.request,1000);assert.equal(s.tariffMicros,300);
 });
 await test('delayed and out-of-order revisions converge to identical totals in any arrival order',()=>{
  const events=[
   ...[1,2,4].map(r=>m.eventFromInferenceCall(call({id:'ack-1',role:'ack',status:['','reserved','dispatched','','observed'][r],estimated_micros:r===4?20:null,input_tokens:r===4?100:null,output_tokens:r===4?10:null}))),
   ...[1,3,4].map(r=>m.eventFromInferenceCall(call({id:'main-1',status:['','reserved','','uncertain','observed'][r]}))),
   ...[5,7,9].map(r=>m.eventFromProjectStorageUsage({project_id:P1,period:'2026-10',read_ops:r},{ownerId:O1,observedAt:OCT_SEEN}))
  ];
  assert.equal(events.length,9);
  const expected=(()=>{const {ledger}=fresh();for(const e of events)ledger.append(e);return JSON.stringify(ledger.summary({period:'2026-10'}));})();
  let seed=7;const rnd=()=>(seed=(seed*1103515245+12345)%2147483648)/2147483648;
  const orders=[[...events].reverse()];
  for(let i=0;i<30;i++)orders.push([...events].sort(()=>rnd()-.5));
  for(const order of orders){const {ledger}=fresh();for(const e of order)ledger.append(e);assert.equal(JSON.stringify(ledger.summary({period:'2026-10'})),expected);}
  const s=JSON.parse(expected);
  assert.equal(s.unknownEvents,0);assert.equal(s.units.operation,9);assert.equal(s.units.call,2);
  const {ledger}=fresh();
  assert.equal(ledger.append(events[2]).status,'accepted');assert.equal(ledger.append(events[0]).status,'stale-revision');
  assert.equal(ledger.summary({period:'2026-10'}).events,1);
 });
 await test('a late event for a closed period is flagged, restates without rewriting the closed snapshot',()=>{
  const {ledger}=fresh();
  ledger.append(usage());
  const closed=ledger.closePeriod('2026-10');
  assert.equal(closed.tariffMicros,300);
  const late=usage({quantity:{state:'known',value:2000,unit:'request'},observedAt:'2026-11-03T00:00:00.000Z'});
  assert.equal(ledger.append(late).status,'accepted');
  const r=ledger.restatement('2026-10');
  assert.equal(r.lateEvents,1);assert.deepEqual(r.closedSnapshot,closed);assert.equal(r.knownEstimateDeltaMicros,600);assert.equal(r.currentSummary.tariffMicros,900);
  assert.equal(ledger.reconcile('2026-10',{provider:'cloudflare',invoiceId:'inv-1',period:'2026-10',currency:'USD',totalMicros:900,lines:[{category:'workers',amountMicros:900}]}).lateAfterClose,1);
  throws(()=>ledger.restatement('2026-09'),'PERIOD_OPEN');
 });

 // ---------- Unknown stays unknown ----------
 await test('missing quantities and costs stay explicit unknowns and never read as zero',()=>{
  const {ledger}=fresh();
  ledger.append(m.eventFromInferenceCall(pending({id:'p1'})));
  ledger.append(m.eventFromInferenceCall(call({id:'u1',status:'uncertain',reserved_micros:300})));
  ledger.append(m.eventFromInferenceCall(call({id:'np1',status:'observed',cost_basis:'unpriced',estimated_micros:null})));
  ledger.append(usage({quantity:{state:'unknown',reason:'usage-not-reported'},cost:{basis:'unknown',reason:'usage-not-reported',exposureMicros:null}}));
  ledger.append(usage({source:'notification-delivery',dimension:'notification.message',workload:'notifications',quantity:{state:'known',value:12,unit:'message'},cost:{basis:'unknown',reason:'rate-missing',exposureMicros:null}}));
  const s=ledger.summary({period:'2026-10'});
  assert.equal(s.unknownEvents,5);assert.equal(s.boundedExposureMicros,800);assert.equal(s.unboundedExposureEvents,3);assert.equal(s.knownEstimateMicros,0);assert.equal(s.unknownQuantity,3);
  assert.equal(s.byDimension['notification.message'].unknownEvents,1);assert.equal(s.byDimension['notification.message'].units.message,12);
  assert.equal(s.pending,1);assert.equal(s.uncertain,1);
  throws(()=>ledger.append(usage({quantity:{state:'unknown',reason:'usage-not-reported'}})),'OUTCOME_COST');
  throws(()=>ledger.append(usage({cost:{basis:'unknown',reason:'because the customer asked for it',exposureMicros:null}})),'INVALID_REASON');
 });
 await test('a pending or uncertain operation can only carry an explicit unknown cost; a released one consumed nothing',()=>{
  const {ledger}=fresh();
  for(const outcome of ['pending','uncertain'])throws(()=>ledger.append(usage({outcome})),'OUTCOME_COST');
  throws(()=>ledger.append(usage({outcome:'pending',cost:{basis:'receipt',micros:0,ref:'r1'}})),'OUTCOME_COST');
  throws(()=>ledger.append(usage({outcome:'released'})),'OUTCOME_COST');
  throws(()=>ledger.append(usage({outcome:'released',quantity:{state:'known',value:0,unit:'request'},cost:{basis:'unknown',reason:'unpriced',exposureMicros:null}})),'OUTCOME_COST');
  // A released reservation consumed nothing: known zero quantity, zero cost and no token detail, whatever the cost basis.
  const released=(over={})=>usage({outcome:'released',quantity:{state:'known',value:0,unit:'request'},cost:{basis:'receipt',micros:0,ref:'rel'},...over});
  for(const cost of [{basis:'receipt',micros:500,ref:'rel'},{basis:'provider-reported',micros:1,ref:'rel'}])throws(()=>ledger.append(released({cost})),'OUTCOME_COST');
  throws(()=>ledger.append(released({quantity:{state:'known',value:1,unit:'request'}})),'OUTCOME_COST');
  const inferred=m.eventFromInferenceCall(call({id:'rel-1',status:'released'}));
  const variant=(sourceEventId,over)=>{const v={...inferred,sourceEventId,...over};v.idempotencyKey=m.idempotencyKey(v);return v;};
  throws(()=>ledger.append(variant('rel-2',{cost:{basis:'receipt',micros:500,ref:'rate'}})),'OUTCOME_COST');
  throws(()=>ledger.append(variant('rel-3',{cost:{basis:'shadow',micros:1,ref:'rate'}})),'OUTCOME_COST');
  throws(()=>ledger.append(variant('rel-4',{detail:{inputTokens:10,outputTokens:0}})),'OUTCOME_COST');
  throws(()=>ledger.append(variant('rel-5',{detail:{inputTokens:0,outputTokens:3}})),'OUTCOME_COST');
  assert.equal(ledger.summary({period:'2026-10'}).events,0);
  assert.equal(ledger.append(released()).status,'accepted');
  assert.equal(ledger.append(inferred).status,'accepted');
  assert.equal(ledger.append(variant('rel-6',{detail:{inputTokens:0,outputTokens:0}})).status,'accepted');
  const none=ledger.summary({period:'2026-10'});
  assert.equal(none.events,3);assert.equal(none.knownEstimateMicros,0);assert.equal(none.receiptMicros,0);assert.equal(none.shadowMicros,0);assert.equal(none.units.request,0);
  const e=m.eventFromGatewayAttempt({id:'gw-1',user_id:O1,task_id:'task-9',snapshot:JSON.stringify({tier:'standard',rate:{id:'rate-1'}}),status:'uncertain',provider_reserved:900,input_tokens:null,output_tokens:null,provider_actual:null},{occurredAt:OCT});
  ledger.append(e);
  const s=ledger.summary({period:'2026-10'});
  assert.equal(s.boundedExposureMicros,900);assert.equal(s.knownEstimateMicros,0);
  const settled=m.eventFromGatewayAttempt({id:'gw-1',user_id:O1,task_id:'task-9',snapshot:JSON.stringify({tier:'standard',rate:{id:'rate-1'}}),status:'settled',provider_reserved:900,input_tokens:100,output_tokens:20,provider_actual:410},{occurredAt:OCT});
  ledger.append(settled);
  const after=ledger.summary({period:'2026-10'});
  assert.equal(after.boundedExposureMicros,0);assert.equal(after.receiptMicros,410);assert.equal(after.uncertain,0);
 });
 await test('an unknown or unpriced rate is rejected as a priced event and is only recorded as explicit unknown',()=>{
  const {ledger}=fresh();
  throws(()=>ledger.append(usage({cost:{basis:'tariff',tariff:{id:'pool-proposal',version:9}}})),'UNKNOWN_TARIFF');
  throws(()=>ledger.append(usage({cost:{basis:'tariff',tariff:{id:'nonexistent',version:1}}})),'UNKNOWN_TARIFF');
  throws(()=>ledger.append(usage({source:'notification-delivery',dimension:'notification.message',workload:'notifications',quantity:{state:'known',value:3,unit:'message'}})),'UNPRICED_DIMENSION');
  throws(()=>ledger.append(usage({source:'connector-call',dimension:'connector.provider_call',workload:'connector-read',quantity:{state:'known',value:3,unit:'call'}})),'UNPRICED_DIMENSION');
  assert.equal(ledger.summary({period:'2026-10'}).events,0);
 });

 // ---------- Tenant isolation, pinning and allowances ----------
 await test('tenant mismatch, unknown and closed projects are refused and a revision cannot move cost between tenants',()=>{
  const {ledger,dir}=fresh();
  throws(()=>ledger.append(usage({attribution:{scope:'tenant',ownerId:O2,projectId:P1,resourceId:R1}})),'TENANT_MISMATCH');
  throws(()=>ledger.append(usage({attribution:{scope:'tenant',ownerId:O1,projectId:P1,resourceId:R2}})),'TENANT_MISMATCH');
  throws(()=>ledger.append(usage({attribution:{scope:'tenant',ownerId:O1,projectId:'bbbbbbbb-bbbb-4bbb-8bbb-0000000000ff',resourceId:null}})),'UNKNOWN_PROJECT');
  const e=usage();ledger.append(e);
  const moved=usage({sourceEventId:e.sourceEventId,revision:2,attribution:{scope:'tenant',ownerId:O2,projectId:P2,resourceId:R2}});
  throws(()=>ledger.append(moved),'TENANT_MISMATCH');
  assert.equal(ledger.summary({period:'2026-10',ownerId:O2}).events,0);
  throws(()=>ledger.append(usage({attribution:{scope:'platform',pool:'private-lab'}})),'INVALID_ATTRIBUTION');
  throws(()=>ledger.append(usage({dimension:'liability.license',kind:'liability',source:'liability-register',attribution:{scope:'tenant',ownerId:O1,projectId:P1,resourceId:null},quantity:{state:'known',value:1,unit:'item'}})),'SCOPE_NOT_ALLOWED');
  dir.closeProject(P1);
  throws(()=>ledger.append(usage()),'PROJECT_CLOSED');
 });
 await test('tariff versions stay pinned to their events across placement changes and later tariff versions',()=>{
  const registry=tariffs2();
  const {ledger,dir}=fresh(registry);
  const first=usage({sourceEventId:'cf-pin-1',occurredAt:OCT,observedAt:OCT_SEEN,placementClass:dir.placementOf(P1,R1)});
  ledger.append(first);
  dir.movePlacement(P1,R1,'isolated-function');
  const second=usage({sourceEventId:'cf-pin-2',occurredAt:'2026-11-02T00:00:00.000Z',observedAt:'2026-11-02T01:00:00.000Z',placementClass:dir.placementOf(P1,R1),cost:{basis:'tariff',tariff:{id:'pool-proposal',version:2}}});
  ledger.append(second);
  assert.equal(ledger.summary({period:'2026-10'}).tariffMicros,300);assert.equal(ledger.summary({period:'2026-11'}).tariffMicros,600);
  const both=ledger.exportHeads({ownerId:O1});
  assert.deepEqual(both.map(e=>e.attribution.resourceId),[R1,R1]);assert.deepEqual(both.map(e=>e.placementClass),['shared-api','isolated-function']);
  // Publishing a later version never reprices the earlier event, and neither version may price outside its window.
  assert.equal(ledger.summary({period:'2026-10'}).tariffMicros,300);
  throws(()=>ledger.append(usage({occurredAt:OCT,cost:{basis:'tariff',tariff:{id:'pool-proposal',version:2}}})),'TARIFF_NOT_EFFECTIVE');
  throws(()=>ledger.append(usage({occurredAt:'2026-11-05T00:00:00.000Z',observedAt:'2026-11-05T01:00:00.000Z'})),'TARIFF_NOT_EFFECTIVE');
 });
 await test('an account-wide free allowance is never reused or divided per tenant',()=>{
  const registry=structuredClone(m.defaultRegistry);registry.tariffs['pool-proposal'][1].accountAllowance={quantity:10000};
  const {ledger}=fresh(registry);
  ledger.append(usage({quantity:{state:'known',value:6000,unit:'request'}}));
  ledger.append(usage({attribution:{scope:'tenant',ownerId:O2,projectId:P2,resourceId:R2},quantity:{state:'known',value:6000,unit:'request'}}));
  const one=ledger.summary({period:'2026-10',ownerId:O1}),two=ledger.summary({period:'2026-10',ownerId:O2}),all=ledger.summary({period:'2026-10'});
  assert.equal(one.tariffMicros,1800);assert.equal(two.tariffMicros,1800);assert.equal(all.tariffMicros,3600);
  const r=ledger.reconcile('2026-10',{provider:'cloudflare',invoiceId:'inv-allow',period:'2026-10',currency:'USD',totalMicros:1000,lines:[{category:'workers',amountMicros:1000}]});
  assert.equal(r.residualMicros,-2600);assert.match(r.allowanceTreatment,/never allocated to tenants/);
  const bad=structuredClone(m.defaultRegistry);bad.tariffs['pool-proposal'][1].allowanceAllocation='per-tenant';
  throws(()=>m.validateRegistry(bad),'ALLOWANCE_ALLOCATION');
  const badRate=structuredClone(m.defaultRegistry);badRate.tariffs['pool-proposal'][1].rates['worker.requests']={perUnits:7,micros:1};
  throws(()=>m.validateRegistry(badRate),'INVALID_TARIFF');
 });
 await test('partitioning usage into many events cannot inflate cost through rounding',()=>{
  const whole=fresh().ledger,parts=fresh().ledger;
  whole.append(usage({quantity:{state:'known',value:1000,unit:'request'}}));
  for(let i=0;i<1000;i++)parts.append(usage({quantity:{state:'known',value:1,unit:'request'}}));
  assert.equal(parts.summary({period:'2026-10'}).events,1000);
  assert.equal(parts.summary({period:'2026-10'}).tariffMicros,whole.summary({period:'2026-10'}).tariffMicros);
 });

 // ---------- Authority, overhead and privacy ----------
 await test('standard AI stays internal: zero customer units and no event or ledger surface grants billing authority',()=>{
  const {ledger}=fresh();
  const e=m.eventFromInferenceCall(call());
  assert.equal(e.customerUnits,0);assert.equal(e.aiTier,'standard');
  ledger.append(e);
  const s=ledger.summary({period:'2026-10'});
  assert.equal(s.customerUnits,0);assert.equal(s.shadowMicros,140);assert.equal(s.knownEstimateMicros,0);assert.equal(s.providerReportedMicros,0);
  throws(()=>ledger.append({...m.eventFromInferenceCall(call({id:'c2'})),customerUnits:1}),'BILLING_AUTHORITY');
  for(const key of ['debit','creditUnits','chargeMicros','walletId','balance','entitlementId','authority','invoiceId','price'])
   throws(()=>ledger.append({...usage(),[key]:1}),'BILLING_AUTHORITY');
  throws(()=>ledger.append({...m.eventFromInferenceCall(call({id:'c3'})),aiTier:null}),'INVALID_EVENT');
  throws(()=>ledger.append(usage({cost:{basis:'shadow',micros:5,ref:'r'}})),'SHADOW_BASIS');
  const premium=m.eventFromGatewayAttempt({id:'gw-2',user_id:O1,task_id:'task-3',snapshot:JSON.stringify({tier:'premium',rate:{id:'rate-2'}}),status:'settled',provider_reserved:5000,input_tokens:10,output_tokens:5,provider_actual:900,customer_actual:1350},{occurredAt:OCT});
  assert.equal(premium.customerUnits,0);assert.equal(premium.aiTier,'premium');assert.ok(!JSON.stringify(premium).includes('1350'));
  // The only operations are append and read-side reports: there is no reserve, debit, credit or grant to call.
  assert.deepEqual(Object.keys(ledger).sort(),['append','closePeriod','exportHeads','reconcile','redactOwner','restatement','summary']);
  assert.ok(!Object.keys(ledger).some(k=>/debit|credit|charge|reserve|grant|wallet|balance|entitle/i.test(k)));
 });
 await test('control and retry overhead stay separate from the task but remain attributable to it',()=>{
  const {ledger}=fresh();
  const task=m.eventFromInferenceCall(call({id:'main-1',role:'orchestrator',estimated_micros:140}));
  const ack=m.eventFromInferenceCall(call({id:'ack-1',role:'ack',estimated_micros:20}));
  ledger.append(task);ledger.append(ack);
  const retry={...task,sourceEventId:'main-1-retry',workClass:'retry',attempt:2,cost:{basis:'shadow',micros:90,ref:'muse-test-shadow-v1'}};retry.idempotencyKey=m.idempotencyKey(retry);
  ledger.append(retry);
  const s=ledger.summary({period:'2026-10'});
  assert.equal(s.byWorkClass.task.shadowMicros,140);assert.equal(s.byWorkClass.control.shadowMicros,20);assert.equal(s.byWorkClass.retry.shadowMicros,90);assert.equal(s.shadowMicros,250);
  assert.ok(ledger.exportHeads({}).filter(e=>e.workClass!=='standing').every(e=>e.taskRef==='turn-1'));
  const bad={...task,sourceEventId:'x1',workClass:'retry',attempt:1};bad.idempotencyKey=m.idempotencyKey(bad);throws(()=>ledger.append(bad),'OVERHEAD_CLASS');
  const bad2={...task,sourceEventId:'x2',workClass:'task',taskRef:null};bad2.idempotencyKey=m.idempotencyKey(bad2);throws(()=>ledger.append(bad2),'OVERHEAD_CLASS');
  throws(()=>ledger.append(usage({workClass:'standing',taskRef:'turn-1'})),'OVERHEAD_CLASS');
 });
 await test('events are content-free: fields for content, secrets, physical locators and client-assigned times are rejected',()=>{
  const {ledger}=fresh();
  for(const key of ['prompt','email','body','authorization','apiKey'])throws(()=>ledger.append({...usage(),[key]:'x'}),'CONTENT_FIELD');
  for(const key of ['bucket','databaseId','objectKey','scriptName'])throws(()=>ledger.append({...usage(),[key]:'x'}),'PHYSICAL_LOCATOR');
  throws(()=>ledger.append(usage({attribution:{scope:'tenant',ownerId:O1,projectId:P1,resourceId:R1,databaseId:'d1'}})),'PHYSICAL_LOCATOR');
  for(const key of ['receivedAt','receivedSeq','late'])throws(()=>ledger.append({...usage(),[key]:1}),'CLIENT_ASSIGNED');
  throws(()=>ledger.append(usage({sourceEventId:'sk-abcdefghijkl'})),'SECRET_IN_EVENT');
  throws(()=>ledger.append(usage({providerEventId:'Bearer token'})),'INVALID_EVENT');
  throws(()=>ledger.append(usage({detail:{prompt:1}})),'CONTENT_FIELD');
  throws(()=>ledger.append(usage({detail:{inputTokens:5}})),'UNKNOWN_FIELD');
  const ok=m.eventFromInferenceCall(call());
  assert.deepEqual(Object.keys(ok.detail).sort(),['inputTokens','outputTokens']);
  assert.ok(!/prompt|content|assistant|user_text|ack_text/i.test(JSON.stringify(ok)));
 });

 // ---------- Liabilities and reconciliation ----------
 await test('provider minimums, licenses, renewals, support, staging and uncertain operations are explicit liabilities',()=>{
  const {ledger}=fresh();
  ledger.append(liability('liability.account-minimum',{basis:'provider-reported',micros:5_000_000,ref:'inv-1-line-1'}));
  ledger.append(liability('liability.provider-minimum',{basis:'provider-reported',micros:5_000_000,ref:'inv-1-line-2'}));
  ledger.append(liability('liability.license',{basis:'unknown',reason:'entitlement-unknown',exposureMicros:null}));
  ledger.append(liability('liability.renewal',{basis:'unknown',reason:'rate-missing',exposureMicros:null}));
  ledger.append(liability('liability.support',{basis:'receipt',micros:12_000,ref:'support-q3'},{attribution:{scope:'tenant',ownerId:O1,projectId:P1,resourceId:null}}));
  ledger.append(liability('liability.staging-retained',{basis:'receipt',micros:2000,ref:'staging-r1'},{attribution:{scope:'tenant',ownerId:O1,projectId:P1,resourceId:R1}}));
  ledger.append(liability('liability.uncertain-operation',{basis:'unknown',reason:'outcome-unknown',exposureMicros:10_000},{outcome:'uncertain'}));
  const s=ledger.summary({period:'2026-10'});
  assert.equal(s.unknownEvents,3);assert.equal(s.unboundedExposureEvents,2);assert.equal(s.boundedExposureMicros,10_000);assert.equal(s.knownEstimateMicros,10_014_000);
  const r=ledger.reconcile('2026-10',{provider:'cloudflare',invoiceId:'inv-1',period:'2026-10',currency:'USD',totalMicros:10_002_000,lines:[{category:'floors',amountMicros:10_000_000},{category:'staging',amountMicros:2000}]});
  assert.equal(r.status,'incomplete');assert.equal(r.unfinishedEvents,1);assert.equal(r.boundedExposureMicros,10_000);assert.equal(r.liabilityKnownMicros,10_002_000);
  // The unresolved operation is closed by a later revision, never rewritten.
  ledger.append(liability('liability.uncertain-operation',{basis:'receipt',micros:0,ref:'verified-not-sent'},{revision:2,outcome:'settled',sourceEventId:ledger.exportHeads({}).find(e=>e.dimension==='liability.uncertain-operation').sourceEventId}));
  const after=ledger.reconcile('2026-10',{provider:'cloudflare',invoiceId:'inv-1',period:'2026-10',currency:'USD',totalMicros:10_002_000,lines:[{category:'floors',amountMicros:10_000_000},{category:'staging',amountMicros:2000}]});
  assert.equal(after.status,'reconciled');assert.equal(after.unfinishedEvents,0);
 });
 await test('reconciliation reports an explicit residual and is reconciled only when nothing is unknown or unfinished',()=>{
  const {ledger}=fresh();
  ledger.append(usage({quantity:{state:'known',value:1_000_000,unit:'request'}}));
  ledger.append(usage({dimension:'r2.class_b_ops',workload:'storage-files',quantity:{state:'known',value:1_000_000,unit:'operation'}}));
  ledger.append(liability('liability.account-minimum',{basis:'provider-reported',micros:5_000_000,ref:'floor'}));
  const invoice=(total,over={})=>({provider:'cloudflare',invoiceId:'inv-2',period:'2026-10',currency:'USD',totalMicros:total,lines:[{category:'all',amountMicros:total}],...over});
  const exact=ledger.reconcile('2026-10',invoice(5_660_000));
  assert.equal(exact.usageKnownMicros,660_000);assert.equal(exact.liabilityKnownMicros,5_000_000);assert.equal(exact.residualMicros,0);assert.equal(exact.status,'reconciled');
  const short=ledger.reconcile('2026-10',invoice(5_700_000));
  assert.equal(short.residualMicros,40_000);assert.equal(short.status,'unexplained-residual');
  assert.equal(ledger.reconcile('2026-10',invoice(5_700_000),{toleranceMicros:40_000}).status,'reconciled');
  ledger.append(usage({quantity:{state:'unknown',reason:'usage-not-reported'},cost:{basis:'unknown',reason:'usage-not-reported',exposureMicros:null}}));
  const unknown=ledger.reconcile('2026-10',invoice(5_660_000));
  assert.equal(unknown.status,'incomplete');assert.equal(unknown.unknownEvents,1);assert.equal(unknown.unboundedExposureEvents,1);assert.equal(unknown.residualMicros,0);
  ledger.append(m.eventFromInferenceCall(call()));
  const shadow=ledger.reconcile('2026-10',invoice(0,{provider:'inference-provider',lines:[]}));
  assert.equal(shadow.shadowExcludedMicros,140);assert.equal(shadow.usageKnownMicros,0);assert.equal(shadow.status,'reconciled');
  throws(()=>ledger.reconcile('2026-10',invoice(100,{lines:[{category:'a',amountMicros:99}]})),'INVOICE_LINES_MISMATCH');
  throws(()=>ledger.reconcile('2026-10',invoice(100,{period:'2026-09'})),'INVALID_INVOICE');
  throws(()=>ledger.reconcile('2026-10',{...invoice(100),extra:1}),'UNKNOWN_FIELD');
 });
 // ---------- Isolation of every read surface and of the pricing registry ----------
 await test('every read surface returns an isolated copy and the caller keeps no handle on stored events',()=>{
  const {ledger}=fresh();
  const input=m.eventFromInferenceCall(call({id:'iso-1'}));
  ledger.append(input);
  // The caller edits its own object after append: stored history is unchanged.
  input.cost.micros=999;input.detail.inputTokens=1;input.attribution.ownerId=O2;
  const expected=ledger.summary({period:'2026-10'});
  assert.equal(expected.shadowMicros,140);
  const head=ledger.exportHeads({})[0];
  head.cost.micros=999;head.detail.inputTokens=0;head.attribution.ownerId='mutated';head.quantity.value=7;
  ledger.exportHeads()[0].cost.micros=999;
  assert.deepEqual(ledger.summary({period:'2026-10'}),expected);
  assert.equal(ledger.exportHeads({})[0].cost.micros,140);assert.equal(ledger.exportHeads({})[0].attribution.ownerId,O1);
  const report=ledger.summary({period:'2026-10'});
  report.byDimension['ai.inference.call'].shadowMicros=1;report.byWorkload['chat-ai'].shadowMicros=1;report.units.call=0;delete report.byWorkClass.task;
  assert.deepEqual(ledger.summary({period:'2026-10'}),expected);
  const closed=ledger.closePeriod('2026-10');
  closed.shadowMicros=1;closed.byWorkload['chat-ai'].shadowMicros=1;
  const restated=ledger.restatement('2026-10');
  assert.equal(restated.closedSnapshot.shadowMicros,140);
  restated.closedSnapshot.shadowMicros=0;restated.closedSnapshot.byWorkClass.task.shadowMicros=0;restated.currentSummary.shadowMicros=0;
  const again=ledger.restatement('2026-10');
  assert.equal(again.closedSnapshot.shadowMicros,140);assert.equal(again.closedSnapshot.byWorkClass.task.shadowMicros,140);assert.equal(again.currentSummary.shadowMicros,140);
  const repeat=ledger.closePeriod('2026-10');repeat.shadowMicros=0;
  assert.equal(ledger.closePeriod('2026-10').shadowMicros,140);
 });
 await test('the ledger prices from a frozen registry snapshot, so a caller edit cannot reprice pinned history',()=>{
  const custom=structuredClone(m.defaultRegistry);
  const {ledger}=fresh(custom);
  ledger.append(usage({dimension:'r2.class_b_ops',workload:'storage-files',quantity:{state:'known',value:1_000_000,unit:'operation'}}));
  assert.equal(ledger.summary({period:'2026-10'}).tariffMicros,360_000);
  const rates=custom.tariffs['pool-proposal'][1].rates;
  rates['r2.class_b_ops'].micros=1;delete rates['worker.requests'];
  custom.tariffs['pool-proposal'][1].effectiveTo='2026-10-01T00:00:00.000Z';custom.dimensions['r2.class_b_ops'].unit='gigabyte';
  assert.equal(ledger.summary({period:'2026-10'}).tariffMicros,360_000);
  // New events are still priced from the construction-time snapshot, not the edited registry.
  assert.equal(ledger.append(usage({quantity:{state:'known',value:1_000_000,unit:'request'}})).status,'accepted');
  assert.equal(ledger.summary({period:'2026-10'}).tariffMicros,660_000);
  // The exported registry and every catalogue inside it are immutable.
  assert.throws(()=>{m.defaultRegistry.tariffs['pool-proposal'][1].rates['r2.class_b_ops'].micros=1;},TypeError);
  assert.throws(()=>{m.tariffs['pool-proposal'][2]={};},TypeError);assert.throws(()=>{m.dimensions['gpu.hours']={};},TypeError);
  assert.throws(()=>{m.workloads['invented']={};},TypeError);assert.throws(()=>{m.sources['invented']={};},TypeError);
  assert.equal(m.tariffs['pool-proposal'][1].rates['r2.class_b_ops'].micros,360_000);
 });

 // ---------- Exact integers ----------
 await test('amounts beyond the exactly representable range are refused on every reported surface, never rounded',()=>{
  const MAX=Number.MAX_SAFE_INTEGER;
  const unsafe=fn=>throws(fn,'AMOUNT_UNSAFE');
  const shadow=(id,micros)=>m.eventFromInferenceCall(call({id,estimated_micros:micros}));
  const fill=(events,registry)=>{const {ledger}=fresh(registry);for(const e of events)ledger.append(e);return ledger;};
  // A figure that is exactly representable is reported exactly; one more event that cannot be is refused, not reported as ...992.
  assert.equal(fill([shadow('big-1',MAX)]).summary({period:'2026-10'}).shadowMicros,MAX);
  unsafe(()=>fill([shadow('big-1',MAX),shadow('big-2',2)]).summary({period:'2026-10'}));
  unsafe(()=>fill([shadow('big-1',MAX),shadow('big-2',1)]).summary({period:'2026-10'}));
  assert.equal(fill([shadow('big-1',MAX-2),shadow('big-2',2)]).summary({period:'2026-10'}).shadowMicros,MAX);
  // Quantity, with an unknown cost so only the unit total overflows.
  const qty=()=>usage({quantity:{state:'known',value:MAX,unit:'request'},cost:{basis:'unknown',reason:'rate-missing',exposureMicros:null}});
  assert.equal(fill([qty()]).summary({period:'2026-10'}).units.request,MAX);
  unsafe(()=>fill([qty(),qty()]).summary({period:'2026-10'}));
  // Bounded exposure.
  const held=()=>usage({quantity:{state:'unknown',reason:'usage-not-reported'},cost:{basis:'unknown',reason:'usage-not-reported',exposureMicros:MAX}});
  unsafe(()=>fill([held(),held()]).summary({period:'2026-10'}));
  // Money: each basis alone, and a known estimate whose parts are individually exact but whose sum is not.
  const money=basis=>liability('liability.account-minimum',{basis,micros:MAX,ref:'big'});
  for(const basis of ['receipt','provider-reported'])unsafe(()=>fill([money(basis),money(basis)]).summary({period:'2026-10'}));
  unsafe(()=>fill([money('receipt'),money('provider-reported')]).summary({period:'2026-10'}));
  assert.equal(fill([money('receipt')]).summary({period:'2026-10'}).knownEstimateMicros,MAX);
  // Tariff cost: units stay exact (4e15) while the 4.5 micro-dollar rate pushes the priced total past the limit.
  const ops=()=>usage({dimension:'r2.class_a_ops',workload:'storage-files',quantity:{state:'known',value:2_000_000_000_000_000,unit:'operation'}});
  assert.equal(fill([ops()]).summary({period:'2026-10'}).tariffMicros,9_000_000_000_000_000);
  unsafe(()=>fill([ops(),ops()]).summary({period:'2026-10'}));
  // Period delta: exact at the limit, refused beyond it.
  const late=(micros)=>liability('liability.account-minimum',{basis:'provider-reported',micros,ref:'late'});
  const restate=fill([]);restate.closePeriod('2026-10');
  restate.append(late(MAX));
  assert.equal(restate.restatement('2026-10').knownEstimateDeltaMicros,MAX);
  restate.append(late(1));
  unsafe(()=>restate.restatement('2026-10'));
  // Reconciliation: line sums, residual, exposure and tolerance.
  const invoice=(total,lines)=>({provider:'cloudflare',invoiceId:'inv-big',period:'2026-10',currency:'USD',totalMicros:total,lines});
  const both=fill([usage({cost:{basis:'provider-reported',micros:MAX,ref:'a'}}),liability('liability.account-minimum',{basis:'provider-reported',micros:MAX,ref:'b'})]);
  unsafe(()=>both.reconcile('2026-10',invoice(0,[])));
  assert.equal(both.reconcile('2026-10',invoice(MAX,[{category:'all',amountMicros:MAX}]),{toleranceMicros:MAX}).usageKnownMicros,MAX);
  const exposures=fill([held(),liability('liability.uncertain-operation',{basis:'unknown',reason:'outcome-unknown',exposureMicros:MAX},{outcome:'uncertain'})]);
  unsafe(()=>exposures.summary({period:'2026-10'}));
  unsafe(()=>exposures.reconcile('2026-10',invoice(0,[])));
  throws(()=>both.reconcile('2026-10',invoice(MAX,[{category:'a',amountMicros:MAX},{category:'b',amountMicros:1},{category:'c',amountMicros:1}])),'INVOICE_LINES_MISMATCH');
  throws(()=>both.reconcile('2026-10',invoice(2**53,[{category:'a',amountMicros:2**53}])),'INVALID_INVOICE');
  for(const bad of [Number.NaN,Infinity,-1,1.5,'5',null,2**53])throws(()=>both.reconcile('2026-10',invoice(MAX,[{category:'all',amountMicros:MAX}]),{toleranceMicros:bad}),'INVALID_TOLERANCE');
 });

 // ---------- Revisions: identity is fixed, observations advance ----------
 await test('revisions keep their identity fields and only advance observations and cost resolution, in any arrival order',()=>{
  const rev=(revision,over={})=>usage({sourceEventId:'rev-x',revision,...over});
  const pendingRev=()=>rev(1,{outcome:'pending',quantity:{state:'unknown',reason:'usage-pending'},cost:{basis:'unknown',reason:'usage-pending',exposureMicros:700}});
  const tariffRev=()=>rev(2,{providerEventId:'prov-1',observedAt:'2026-10-03T00:00:00.000Z'});
  const actualRev=()=>rev(3,{providerEventId:'prov-1',cost:{basis:'provider-reported',micros:450,ref:'inv-9'},observedAt:'2026-10-04T00:00:00.000Z'});
  const sequence=[pendingRev(),tariffRev(),actualRev()];
  // Unknown -> known and a learned provider ID are legitimate advances; every arrival order converges.
  const result=order=>{const {ledger}=fresh();for(const i of order)ledger.append(structuredClone(sequence[i]));return ledger;};
  const expected=JSON.stringify(result([0,1,2]).summary({period:'2026-10'}));
  for(const order of [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]]){
   const ledger=result(order);
   assert.equal(JSON.stringify(ledger.summary({period:'2026-10'})),expected,order.join());
   const [head]=ledger.exportHeads({});assert.equal(head.revision,3);assert.equal(head.providerEventId,'prov-1');assert.equal(head.cost.micros,450);
  }
  const final=JSON.parse(expected);
  assert.equal(final.providerReportedMicros,450);assert.equal(final.unknownEvents,0);assert.equal(final.boundedExposureMicros,0);assert.equal(final.pending,0);
  // A refused pair is refused whichever revision arrives second.
  const bothOrders=(lower,higher,code)=>{
   const first=fresh().ledger;first.append(structuredClone(lower));throws(()=>first.append(structuredClone(higher)),code);
   const second=fresh().ledger;second.append(structuredClone(higher));throws(()=>second.append(structuredClone(lower)),code);
   assert.equal(first.summary({}).events+second.summary({}).events,2,'the refused revision is not stored');
  };
  const known=over=>rev(1,{providerEventId:'prov-1',...over});
  // Cost cannot move to another period, workload, placement label or owner.
  bothOrders(known(),rev(2,{providerEventId:'prov-1',occurredAt:'2026-11-02T00:00:00.000Z',observedAt:'2026-11-02T01:00:00.000Z'}),'IMMUTABLE_FIELD');
  bothOrders(known(),rev(2,{providerEventId:'prov-1',workload:'storage-files'}),'IMMUTABLE_FIELD');
  bothOrders(known(),rev(2,{providerEventId:'prov-1',placementClass:'isolated-function'}),'IMMUTABLE_FIELD');
  bothOrders(known(),rev(2,{providerEventId:'prov-1',attribution:{scope:'tenant',ownerId:O2,projectId:P2,resourceId:R2}}),'TENANT_MISMATCH');
  // The provider's ID is preserved once known: it cannot change or disappear.
  bothOrders(known(),rev(2,{providerEventId:'prov-2'}),'IMMUTABLE_FIELD');
  bothOrders(known(),rev(2,{providerEventId:null}),'IMMUTABLE_FIELD');
  // Task, attempt and tier identify the work.
  const inference=(status,over={})=>({...m.eventFromInferenceCall(call({id:'idf-1',status})),...over});
  bothOrders(inference('reserved'),inference('observed',{taskRef:'another-turn'}),'IMMUTABLE_FIELD');
  bothOrders(inference('reserved'),inference('observed',{workClass:'retry',attempt:2}),'IMMUTABLE_FIELD');
  bothOrders(inference('reserved'),inference('observed',{aiTier:'premium'}),'IMMUTABLE_FIELD');
  const ack=(status,over={})=>({...m.eventFromInferenceCall(call({id:'idf-ack',role:'ack',status})),...over});
  bothOrders(ack('reserved'),ack('observed',{attempt:2}),'IMMUTABLE_FIELD');
  // A pinned tariff version is the price basis; a revision cannot reprice under another version, but may replace it with an actual.
  const overlap=structuredClone(m.defaultRegistry);
  overlap.tariffs['pool-proposal'][2]={...structuredClone(overlap.tariffs['pool-proposal'][1]),rates:{...overlap.tariffs['pool-proposal'][1].rates,'worker.requests':{perUnits:1_000_000,micros:600_000}}};
  const priced=(revision,version,over={})=>rev(revision,{cost:{basis:'tariff',tariff:{id:'pool-proposal',version}},...over});
  {
   const {ledger}=fresh(overlap);ledger.append(priced(1,1));
   throws(()=>ledger.append(priced(2,2)),'IMMUTABLE_FIELD');
   assert.equal(ledger.append(rev(2,{cost:{basis:'provider-reported',micros:450,ref:'inv-9'}})).status,'accepted');
   throws(()=>ledger.append(priced(3,2)),'IMMUTABLE_FIELD');
   assert.equal(ledger.summary({period:'2026-10'}).providerReportedMicros,450);
   const reverse=fresh(overlap).ledger;reverse.append(priced(2,2));throws(()=>reverse.append(priced(1,1)),'IMMUTABLE_FIELD');
  }
  // Observations do not run backwards: a known cost or quantity is not made unknown again, a terminal outcome is final.
  const settled=(over={})=>rev(1,{cost:{basis:'provider-reported',micros:450,ref:'inv-9'},...over});
  bothOrders(settled(),rev(2,{outcome:'uncertain',cost:{basis:'unknown',reason:'outcome-unknown',exposureMicros:450}}),'REVISION_REGRESSION');
  bothOrders(settled(),rev(2,{cost:{basis:'unknown',reason:'invoice-pending',exposureMicros:450}}),'REVISION_REGRESSION');
  bothOrders(settled(),rev(2,{cost:{basis:'provider-reported',micros:450,ref:'inv-9'},quantity:{state:'unknown',reason:'usage-not-reported'}}),'REVISION_REGRESSION');
  bothOrders(settled(),rev(2,{outcome:'released',quantity:{state:'known',value:0,unit:'request'},cost:{basis:'receipt',micros:0,ref:'rel'}}),'REVISION_REGRESSION');
  bothOrders(settled({observedAt:'2026-10-05T00:00:00.000Z'}),settled({revision:2,observedAt:'2026-10-04T00:00:00.000Z',cost:{basis:'provider-reported',micros:500,ref:'inv-9'}}),'REVISION_REGRESSION');
 });
 await test('closing a period twice never rewrites the closed snapshot',()=>{
  const {ledger}=fresh();
  ledger.append(usage());
  const first=ledger.closePeriod('2026-10');
  assert.equal(first.tariffMicros,300);
  ledger.append(usage({quantity:{state:'known',value:2000,unit:'request'},observedAt:'2026-11-03T00:00:00.000Z'}));
  assert.deepEqual(ledger.closePeriod('2026-10'),first);
  const restated=ledger.restatement('2026-10');
  assert.deepEqual(restated.closedSnapshot,first);assert.equal(restated.lateEvents,1);assert.equal(restated.knownEstimateDeltaMicros,600);assert.equal(restated.currentSummary.tariffMicros,900);
  // Further late arrivals and further close calls leave the first snapshot, the late flags and the baseline of the delta alone.
  ledger.append(usage({quantity:{state:'known',value:3000,unit:'request'},observedAt:'2026-11-04T00:00:00.000Z'}));
  assert.deepEqual(ledger.closePeriod('2026-10'),first);
  const later=ledger.restatement('2026-10');
  assert.deepEqual(later.closedSnapshot,first);assert.equal(later.lateEvents,2);assert.equal(later.knownEstimateDeltaMicros,1500);
  assert.equal(ledger.reconcile('2026-10',{provider:'cloudflare',invoiceId:'inv-2',period:'2026-10',currency:'USD',totalMicros:1800,lines:[{category:'workers',amountMicros:1800}]}).lateAfterClose,2);
  throws(()=>ledger.closePeriod('2026-1'),'INVALID_PERIOD');
 });

 // ---------- Account closure ----------
 await test('account closure replaces every linkable identifier with a keyed tombstone while keeping totals, dedupe and recovery',()=>{
  const KEY_A='0123456789abcdef0123456789abcdef',KEY_B='fedcba9876543210fedcba9876543210';
  const gatewayRow=(over={})=>({id:'gw-secret-id',user_id:O1,task_id:'task-secret',snapshot:JSON.stringify({tier:'premium',rate:{id:'rate-2'}}),status:'settled',provider_reserved:5000,input_tokens:10,output_tokens:5,provider_actual:900,...over});
  const build=(closureKey)=>{
   const {ledger,dir}=fresh(m.defaultRegistry,{closureKey});
   const storage=m.eventFromProjectStorageUsage({project_id:P1,period:'2026-10',read_ops:9},{ownerId:O1,observedAt:OCT_SEEN});
   const events={
    storage,gateway:m.eventFromGatewayAttempt(gatewayRow(),{occurredAt:OCT,providerEventId:'prov-secret-id'}),done:m.eventFromInferenceCall(call({id:'call-done',turn_id:'turn-done'})),
    flightA:m.eventFromInferenceCall(pending({id:'call-secret-a',turn_id:'turn-secret-a'})),flightB:m.eventFromInferenceCall(pending({id:'call-secret-b',turn_id:'turn-secret-b'})),
    resource:usage({sourceEventId:'cf-resource-1'}),other:usage({attribution:{scope:'tenant',ownerId:O2,projectId:P2,resourceId:R2}})
   };
   for(const e of Object.values(events))ledger.append(e);
   return {ledger,dir,events};
  };
  const {ledger,dir,events}=build(KEY_A);
  const before=ledger.summary({period:'2026-10'});
  const linkable=[O1,P1,R1,'gw-secret-id','task-secret','prov-secret-id','call-done','turn-done','call-secret-a','turn-secret-a','call-secret-b','turn-secret-b',
   ...['storage','gateway','done','flightA','flightB','resource'].map(k=>events[k].idempotencyKey),'cf-resource-1'];
  const surfaces=()=>JSON.stringify([ledger.exportHeads({}),ledger.exportHeads({period:'2026-10'}),ledger.summary({period:'2026-10'})]);
  assert.ok(linkable.every(id=>surfaces().includes(id)),'sanity: the identifiers are visible before closure');
  assert.equal(ledger.redactOwner(O1),6);
  assert.equal(ledger.redactOwner(O1),0);
  // Nothing the ledger reports names the owner, project, resource, task, provider record or the original idempotency identity.
  const after=surfaces();
  for(const id of linkable)assert.ok(!after.includes(id),`still linkable: ${id}`);
  assert.deepEqual(ledger.summary({period:'2026-10'}),before);
  assert.equal(ledger.summary({period:'2026-10',ownerId:O1}).events,0);assert.equal(ledger.summary({period:'2026-10',pool:'closed-account'}).events,6);assert.equal(ledger.summary({period:'2026-10',ownerId:O2}).events,1);
  const heads=ledger.exportHeads({pool:'closed-account'});
  assert.equal(new Set(heads.map(e=>e.sourceEventId)).size,6);
  for(const e of heads){
   assert.deepEqual(e.attribution,{scope:'platform',pool:'closed-account'});assert.equal(e.taskRef,null);assert.equal(e.providerEventId,null);assert.match(e.sourceEventId,/^closed:[0-9a-f]{32}$/);
   assert.equal(e.idempotencyKey,m.idempotencyKey(e),'the tombstone still satisfies the derived-key rule');
  }
  // The tombstone is keyed: another key gives other identifiers, the same key the same ones. An unkeyed hash would not.
  const tombstones=l=>l.exportHeads({pool:'closed-account'}).map(e=>e.sourceEventId).sort();
  const same=build(KEY_A),other=build(KEY_B);same.ledger.redactOwner(O1);other.ledger.redactOwner(O1);
  assert.deepEqual(tombstones(same.ledger),tombstones(ledger));assert.notDeepEqual(tombstones(other.ledger),tombstones(ledger));
  // Dedupe survives closure: a redelivery of the producer's original bytes is a no-op and a conflicting one is refused.
  for(const k of ['storage','gateway','done','flightA'])assert.equal(ledger.append(structuredClone(events[k])).status,'duplicate',k);
  const conflict={...events.done,detail:{inputTokens:1,outputTokens:1}};
  throws(()=>ledger.append(conflict),'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(ledger.summary({period:'2026-10'}),before);
  // Recovery survives closure: an in-flight operation resolves through its later revision, re-scoped to closed-account, exactly once.
  const observed=m.eventFromInferenceCall(call({id:'call-secret-a',turn_id:'turn-secret-a'}));
  assert.equal(ledger.append(observed).status,'accepted');
  const recovered=ledger.summary({period:'2026-10'});
  assert.equal(recovered.events,before.events);assert.equal(recovered.shadowMicros,before.shadowMicros+140);assert.equal(recovered.boundedExposureMicros,before.boundedExposureMicros-500);assert.equal(recovered.pending,before.pending-1);
  assert.equal(ledger.summary({period:'2026-10',ownerId:O1}).events,0);
  assert.ok(!surfaces().includes('call-secret-a'));
  // The producer may also re-emit at platform scope (the documented recovery for a closed project).
  assert.equal(ledger.append({...m.eventFromInferenceCall(call({id:'call-secret-b',turn_id:'turn-secret-b'})),attribution:{scope:'platform',pool:'closed-account'}}).status,'accepted');
  assert.equal(ledger.summary({period:'2026-10'}).events,before.events);assert.equal(ledger.summary({period:'2026-10'}).pending,0);
  // Cost of a closed identity cannot move to another owner or pool, and a closed owner is never re-linked.
  const later=(over)=>{const e={...observed,revision:5,...over};return e;};
  throws(()=>ledger.append(later({attribution:{scope:'tenant',ownerId:O2,projectId:null,resourceId:null}})),'TENANT_MISMATCH');
  throws(()=>ledger.append(later({attribution:{scope:'platform',pool:'shared-account'}})),'TENANT_MISMATCH');
  throws(()=>ledger.append(m.eventFromInferenceCall(call({id:'post-close'}))),'OWNER_CLOSED');
  assert.equal(ledger.append({...m.eventFromInferenceCall(call({id:'post-close'})),attribution:{scope:'platform',pool:'closed-account'}}).status,'accepted');
  dir.closeProject(P1);
  throws(()=>ledger.append(usage({sourceEventId:'cf-late'})),'PROJECT_CLOSED');
  assert.equal(ledger.append(usage({sourceEventId:'cf-late',attribution:{scope:'platform',pool:'closed-account'}})).status,'accepted');
  // A later reading of a redacted storage counter still replaces the earlier one instead of adding to it.
  const reading=m.eventFromProjectStorageUsage({project_id:P1,period:'2026-10',read_ops:12},{ownerId:O1,observedAt:OCT_SEEN});
  assert.equal(ledger.append(reading).status,'accepted');
  assert.equal(ledger.summary({period:'2026-10',pool:'closed-account'}).byDimension['r2.class_b_ops'].units.operation,12);
  assert.ok(!surfaces().includes(P1));
 });
 return count;
}

const suiteCount=await suite(await import(prototypeURL.href));
let total=suiteCount;
async function checkOnce(name,fn){try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}}

// ---------- Agreement with existing producers, tariffs and scenarios (read-only) ----------
const m=await import(prototypeURL.href);
const sandbox=()=>{
 const dir=m.createIdentityDirectory();dir.addProject(P1,O1);dir.addResource(P1,R1);dir.addProject(P2,O2);dir.addResource(P2,R2);
 return m.createLedger({directory:dir,now:()=>'2026-10-08T00:00:00.000Z'});
};
await checkOnce('the tariff catalogue agrees with the planning tariff in src/resource-economics.ts and covers every non-AI resource',()=>{
 const map={'worker.requests':'workerRequests','worker.cpu_ms':'workerCPU','r2.storage':'r2Storage','r2.class_a_ops':'r2Writes','r2.class_b_ops':'r2Reads','d1.rows_read':'d1Reads','d1.rows_written':'d1Writes',
  'd1.storage':'d1Storage','container.vcpu_seconds':'containerCPU','container.memory_gib_seconds':'containerMemory','container.disk_gb_seconds':'containerDisk','container.egress':'containerEgress',
  'do.requests':'doRequests','do.duration':'doDuration','do.rows_read':'doReads','do.rows_written':'doWrites','do.storage':'doStorage','stream.storage':'streamStorage','stream.delivery':'streamDelivery'};
 const rates=m.tariffs['pool-proposal'][1].rates;
 assert.deepEqual(Object.keys(rates).sort(),Object.keys(map).sort());
 for(const [dimension,key] of Object.entries(map))assert.equal(rates[dimension].micros,Math.round(resourceTariff[key].costUSD*1_000_000),dimension);
 // Standard task classes are modeled completion targets, not measurable provider dimensions (task classes are not recorded).
 assert.deepEqual(Object.keys(resourceTariff).filter(k=>!Object.values(map).includes(k)).sort(),['advanced','intensive','quick','standard']);
});
await checkOnce('every economic scenario in docs/economics reproduces from measured units within one microdollar per dimension',()=>{
 const map={workerRequests:'worker.requests',workerCPU:'worker.cpu_ms',r2Storage:'r2.storage',r2Writes:'r2.class_a_ops',r2Reads:'r2.class_b_ops',d1Reads:'d1.rows_read',d1Writes:'d1.rows_written',d1Storage:'d1.storage',
  containerCPU:'container.vcpu_seconds',containerMemory:'container.memory_gib_seconds',containerDisk:'container.disk_gb_seconds',containerEgress:'container.egress',streamStorage:'stream.storage',streamDelivery:'stream.delivery'};
 const scenarios=JSON.parse(readFileSync(new URL('../docs/economics/resource-pool-scenarios.json',import.meta.url),'utf8')).workloads;
 assert.equal(scenarios.length,4);
 for(const scenario of scenarios){
  const ledger=sandbox(),modeled={};let i=0;
  for(const [key,quantity] of Object.entries(scenario.quantities)){
   if(!map[key])continue;
   modeled[key]=quantity;
   const rate=m.tariffs['pool-proposal'][1].rates[map[key]],value=Math.round(quantity*rate.perUnits),dim=m.dimensions[map[key]];
   const e={contractVersion:1,source:'cloudflare-usage-import',sourceEventId:`scenario-${i++}`,providerEventId:null,revision:1,idempotencyKey:'',kind:'usage',dimension:map[key],workload:'app-runtime',workClass:'standing',taskRef:null,attempt:1,
    attribution:{scope:'tenant',ownerId:O1,projectId:P1,resourceId:R1},placementClass:'shared-api',quantity:{state:'known',value,unit:dim.unit},cost:{basis:'tariff',tariff:{id:'pool-proposal',version:1}},outcome:'settled',customerUnits:0,aiTier:null,detail:{},occurredAt:OCT,observedAt:OCT_SEEN};
   e.idempotencyKey=m.idempotencyKey(e);ledger.append(e);
  }
  const expected=estimateWorkload(modeled).costUSD*1_000_000,got=ledger.summary({period:'2026-10'}).tariffMicros;
  assert.ok(Math.abs(got-expected)<=Object.keys(modeled).length&&got>=Math.floor(expected),`${scenario.name}: ${got} vs ${expected}`);
 }
});
await checkOnce('adapter totals agree with the existing task-cost report over real SQLite semantics, including unknowns',async()=>{
 const sql=new DatabaseSync(':memory:');
 sql.exec(`CREATE TABLE chat_turns(id TEXT PRIMARY KEY,user_id TEXT,status TEXT,mode TEXT,created_at TEXT);
 CREATE TABLE inference_calls(id TEXT,turn_id TEXT,user_id TEXT,status TEXT,cost_basis TEXT,input_tokens INTEGER,output_tokens INTEGER,estimated_micros INTEGER,reserved_micros INTEGER,created_at TEXT,role TEXT,rate_id TEXT);`);
 const db={prepare(query){const s=sql.prepare(query);return {bind(...args){return {async all(){return {results:s.all(...args)}}}}}}};
 const from='2026-10-01T00:00:00.000Z',to='2026-11-01T00:00:00.000Z',at='2026-10-03T10:00:00.000Z';
 const rows=[];
 const add=(turn,id,status,basis,over={})=>{
  sql.prepare('INSERT OR IGNORE INTO chat_turns VALUES(?,?,?,?,?)').run(turn,O1,'completed','ai',at);
  const observed=status==='observed';
  const row={id,turn_id:turn,user_id:O1,status,cost_basis:basis,input_tokens:observed?100:null,output_tokens:observed?10:null,estimated_micros:observed&&basis==='subscription-shadow'?over.micros??0:null,reserved_micros:over.reserved??400,created_at:at,role:over.role??'orchestrator',rate_id:'muse-test-shadow-v1'};
  sql.prepare('INSERT INTO inference_calls VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(row));rows.push(row);
 };
 add('t1','a','observed','subscription-shadow',{micros:120});add('t1','a-ack','observed','subscription-shadow',{micros:30,role:'ack'});
 add('t2','b','uncertain','subscription-shadow',{reserved:250});add('t3','c','observed','unpriced');add('t4','d','released','subscription-shadow',{reserved:600});
 add('t5','e','dispatched','subscription-shadow',{reserved:75});add('t6','f','reserved','subscription-shadow',{reserved:40});
 const report=await taskCostReport(db,from,to,O1);
 const ledger=sandbox();for(const row of rows)ledger.append(m.eventFromInferenceCall(row));
 const s=ledger.summary({period:'2026-10'});
 const sum=k=>Object.values(report.groups).reduce((a,g)=>a+g[k],0);
 assert.equal(s.shadowMicros,sum('observedShadowMicros'));assert.equal(s.shadowMicros,150);
 assert.equal(s.boundedExposureMicros,sum('heldShadowMicros'));assert.equal(s.boundedExposureMicros,365);
 assert.equal(s.unboundedExposureEvents,1);assert.equal(report.excluded.unpriced,1);
 assert.equal(s.byWorkClass.control.shadowMicros,30);assert.equal(s.knownEstimateMicros,0);assert.equal(report.actualProviderExpenseMicros,null);
 assert.equal(s.events,rows.length);assert.equal(s.pending+s.uncertain,3);
});
await checkOnce('adapter status vocabularies match the current schema and replay the real receipt state machines',()=>{
 const schema=readFileSync(new URL('../schema/platform.sql',import.meta.url),'utf8');
 const statuses=table=>{const body=schema.match(new RegExp(`CREATE TABLE ${table} \\(([\\s\\S]*?)\\n\\);`))[1];return body.match(/status TEXT NOT NULL DEFAULT '[a-z]+' CHECK\(status IN \(([^)]*)\)\)/)[1].split(',').map(x=>x.trim().replaceAll("'",'')).sort();};
 const inference=statuses('inference_calls'),gateway=statuses('gateway_spend_attempts');
 assert.deepEqual(inference,['dispatched','observed','released','reserved','uncertain']);assert.deepEqual(gateway,['dispatched','released','reserved','settled','uncertain']);
 const inferenceRow=status=>({id:'x',turn_id:'t',user_id:O1,role:'orchestrator',status,cost_basis:'subscription-shadow',rate_id:'r',reserved_micros:1,
  input_tokens:status==='observed'?1:null,output_tokens:status==='observed'?1:null,estimated_micros:status==='observed'?1:null,created_at:OCT});
 const gatewayRow=status=>({id:'x',user_id:O1,task_id:'t',snapshot:{tier:'standard',rate:{id:'r'}},status,provider_reserved:1,
  input_tokens:status==='settled'?1:null,output_tokens:status==='settled'?1:null,provider_actual:status==='settled'?1:null});
 for(const status of inference)assert.ok(m.eventFromInferenceCall(inferenceRow(status)));
 for(const status of gateway)assert.ok(m.eventFromGatewayAttempt(gatewayRow(status),{occurredAt:OCT}));
 assert.throws(()=>m.eventFromInferenceCall({status:'archived'}),e=>e.code==='UNKNOWN_STATUS');
 // Revisions strictly increase along every legal path of the real state machines.
 const rev=status=>m.eventFromInferenceCall(inferenceRow(status)).revision;
 assert.ok(rev('reserved')<rev('dispatched')&&rev('dispatched')<rev('uncertain')&&rev('uncertain')<rev('observed'));assert.equal(rev('released'),rev('observed'));
});
await checkOnce('cost dimensions map onto the company finance categories used by the existing finance review',async()=>{
 const code=await build({entryPoints:['src/fair-use-finance.ts'],bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
 const {companyCostCategories}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 for(const [id,d] of Object.entries(m.dimensions))assert.ok(companyCostCategories.includes(d.financeCategory),id);
 assert.ok(['inference','hosting','support','other'].every(c=>Object.values(m.dimensions).some(d=>d.financeCategory===c)));
});
await checkOnce('the reference imports only node builtins, performs no network call and no product source imports it',async()=>{
 const specifiers=[...prototypeSource.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
 assert.deepEqual(specifiers,['node:crypto']);
 assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env|Date\.now\(/.test(prototypeSource));
 const {spawnSync}=await import('node:child_process');
 const grep=spawnSync('git',['grep','-l','-E','prototypes/cost-events|cost-events[.]mjs','--','src','frontend','public-app','schema'],{encoding:'utf8'});
 assert.equal(grep.status,1,'no product source may import the reference: '+grep.stdout);
});

// ---------- Mutation check: each deliberately broken reference must fail the suite ----------
const mutants=[
 ['every revision counted',"const heads=()=>[...identities.values()].map(r=>r.revisions.get(Math.max(...r.revisions.keys())));","const heads=()=>[...identities.values()].flatMap(r=>[...r.revisions.values()]);"],
 ['lowest revision wins',"r.revisions.get(Math.max(...r.revisions.keys())));","r.revisions.get(Math.min(...r.revisions.keys())));"],
 ['conflicting redelivery accepted',"check(same.canon===canon,'IDEMPOTENCY_CONFLICT'","check(true,'IDEMPOTENCY_CONFLICT'"],
 ['idempotency key not verified',"check(input.idempotencyKey===idempotencyKey(input),","check(true,"],
 ['tenant mismatch accepted',"check(p.ownerId===a.ownerId,'TENANT_MISMATCH'","check(true,'TENANT_MISMATCH'"],
 ['resource of another project accepted',"check(a.resourceId===null||p.resources.has(a.resourceId),'TENANT_MISMATCH'","check(true,'TENANT_MISMATCH'"],
 ['revision may change attribution',"check(canonical(lower.attribution)===canonical(higher.attribution),'TENANT_MISMATCH'","check(true,'TENANT_MISMATCH'"],
 ['closed project still accepted',"check(!p.closed,'PROJECT_CLOSED'","check(true,'PROJECT_CLOSED'"],
 ['unknown cost not counted',"else{b.unknownEvents++;if(c.exposureMicros===null)b.unboundedExposure++;else b.boundedExposure+=BigInt(c.exposureMicros);}","else{}"],
 ['pending operation priced',"if(input.outcome==='pending'||input.outcome==='uncertain')check(","if(false)check("],
 ['released reservation may have quantity',"input.quantity.value===0&&input.cost.basis!=='unknown'","input.cost.basis!=='unknown'"],
 ['unknown tariff accepted',"check(t,'UNKNOWN_TARIFF'","check(true,'UNKNOWN_TARIFF'"],
 ['unpriced dimension accepted',"check(t.rates[input.dimension],'UNPRICED_DIMENSION'","check(true,'UNPRICED_DIMENSION'"],
 ['tariff version not pinned',"registry.tariffs[c.tariff.id][c.tariff.version].rates[e.dimension];","registry.tariffs[c.tariff.id][Math.max(...Object.keys(registry.tariffs[c.tariff.id]))].rates[e.dimension];"],
 ['tariff window ignored',"check(input.occurredAt>=t.effectiveFrom&&(t.effectiveTo===null||input.occurredAt<t.effectiveTo),'TARIFF_NOT_EFFECTIVE'","check(true,'TARIFF_NOT_EFFECTIVE'"],
 ['allowance subtracted per tenant',"const billable=BigInt(e.quantity.value);","const free=BigInt(registry.tariffs[c.tariff.id][c.tariff.version].accountAllowance?.quantity??0),billable=BigInt(e.quantity.value)>free?BigInt(e.quantity.value)-free:0n;"],
 ['per-tenant allowance allocation accepted',"check(t.allowanceAllocation==='account-wide-not-allocated','ALLOWANCE_ALLOCATION'","check(true,'ALLOWANCE_ALLOCATION'"],
 ['per-event rounding',"b.tariffNum+=billable*BigInt(r.micros)*(costScale/BigInt(r.perUnits));","b.tariffNum+=ceilScaled(billable*BigInt(r.micros)*(costScale/BigInt(r.perUnits)))*costScale;"],
 ['customer units accepted',"check(input.customerUnits===0,'BILLING_AUTHORITY'","check(true,'BILLING_AUTHORITY'"],
 ['billing field accepted',"check(!BILLING_KEY.test(k)||keys.includes(k),'BILLING_AUTHORITY'","check(true,'BILLING_AUTHORITY'"],
 ['shadow counted as expense',"else if(c.basis==='shadow')b.shadow+=BigInt(c.micros);","else if(c.basis==='shadow')b.receipt+=BigInt(c.micros);"],
 ['shadow allowed on infrastructure',"if(input.cost.basis==='shadow')check(dim.provider==='inference-provider','SHADOW_BASIS'","if(false)check(dim.provider==='inference-provider','SHADOW_BASIS'"],
 ['overhead folded into task',"addTo(byWorkClass[e.workClass]??=bucket(),e,registry);","addTo(byWorkClass[e.workClass==='task'||e.workClass==='control'||e.workClass==='retry'?'task':e.workClass]??=bucket(),e,registry);"],
 ['retry attempt not enforced',"check((input.workClass==='retry')===(input.attempt>=2)||input.workClass==='control','OVERHEAD_CLASS'","check(true,'OVERHEAD_CLASS'"],
 ['secret accepted',"check(!SECRET.test(text),'SECRET_IN_EVENT'","check(true,'SECRET_IN_EVENT'"],
 ['content field accepted',"check(!CONTENT_KEY.test(k),'CONTENT_FIELD',`${where}.${k}`)","check(true,'CONTENT_FIELD',`${where}.${k}`)"],
 ['content detail accepted',"for(const k of Object.keys(input.detail))check(!CONTENT_KEY.test(k),'CONTENT_FIELD',`detail.${k}`);",""],
 ['physical locator accepted',"check(!LOCATOR_KEY.test(k)||keys.includes(k),'PHYSICAL_LOCATOR'","check(true,'PHYSICAL_LOCATOR'"],
 ['client-assigned time accepted',"check(!['receivedAt','receivedSeq','late'].includes(k),'CLIENT_ASSIGNED'","check(true,'CLIENT_ASSIGNED'"],
 ['late events not flagged',"const lateAfterClose=closed.has(periodOf(e))&&seq>closed.get(periodOf(e)).closedSeq;","const lateAfterClose=false;"],
 ['closed snapshot rewritten',"closedSnapshot:structuredClone(c.snapshot)","closedSnapshot:current"],
 ['residual silently absorbed',"const status=unknown>0?'incomplete':(residual<0n?-residual:residual)<=BigInt(toleranceMicros)?'reconciled':'unexplained-residual';","const status='reconciled';"],
 ['unknown ignored by reconciliation',"const status=unknown>0?'incomplete':","const status="],
 ['shadow compared with the invoice',"const priced=events.filter(e=>e.cost.basis!=='shadow'),shadow=events.filter(e=>e.cost.basis==='shadow');","const priced=events,shadow=[];"],
 ['liability not separated',"addTo(registry.dimensions[e.dimension].kind==='liability'?liabilities:usage,e,registry);","addTo(usage,e,registry);"],
 ['owner link kept on closure',"if(first.attribution.ownerId!==ownerId)continue;","continue;"],
 ['unit not checked',"check(q.unit===dim.unit,'UNIT_MISMATCH'","check(true,'UNIT_MISMATCH'"],
 ['source may emit any dimension',"check(dim.sources.includes(input.source),'SOURCE_DIMENSION'","check(true,'SOURCE_DIMENSION'"],
 ['unknown workload accepted',"check(Object.hasOwn(registry.workloads,input.workload),'UNKNOWN_WORKLOAD'","check(true,'UNKNOWN_WORKLOAD'"],
 ['unknown version accepted',"check(input.contractVersion===contractVersion,'UNSUPPORTED_VERSION'","check(true,'UNSUPPORTED_VERSION'"],
 ['invoice lines not summed',"check(invoice.lines.reduce((s,l)=>s+BigInt(l.amountMicros),0n)===BigInt(invoice.totalMicros),'INVOICE_LINES_MISMATCH'","check(true,'INVOICE_LINES_MISMATCH'"],
 ['standing cost may name a task',"if(input.workClass==='standing')check(input.taskRef===null&&input.attempt===1,'OVERHEAD_CLASS'","if(input.workClass==='standing')check(true,'OVERHEAD_CLASS'"],
 // --- review corrections: isolation, exact amounts, released, revision identity, close-once, closure boundary ---
 ['exported heads share nested objects',".map(({canon,...e})=>structuredClone(e))",".map(({canon,...e})=>e)"],
 ['restatement aliases the closed snapshot',"closedSnapshot:structuredClone(c.snapshot)","closedSnapshot:c.snapshot"],
 ['close returns the stored snapshot',"return structuredClone(closed.get(period).snapshot);","return closed.get(period).snapshot;"],
 ['ledger shares the caller registry',"const registry=deepFreeze(structuredClone(supplied));validateRegistry(registry);","const registry=supplied;validateRegistry(registry);"],
 ['exported registry mutable',"export const defaultRegistry=deepFreeze({sources,dimensions,workloads,tariffs});","export const defaultRegistry={sources,dimensions,workloads,tariffs};"],
 ['unsafe amounts rounded',"const exact=(v,what)=>{check(v>=-MAX_SAFE&&v<=MAX_SAFE,'AMOUNT_UNSAFE'","const exact=(v,what)=>{check(true,'AMOUNT_UNSAFE'"],
 ['unit totals converted unchecked',"[k,exact(v,`units.${k}`)]","[k,Number(v)]"],
 ['shadow total converted unchecked',"shadowMicros:exact(b.shadow,'shadowMicros')","shadowMicros:Number(b.shadow)"],
 ['known estimate converted unchecked',"knownEstimateMicros:exact(known,'knownEstimateMicros')","knownEstimateMicros:Number(known)"],
 ['exposure converted unchecked',"boundedExposureMicros:exact(b.boundedExposure,'boundedExposureMicros')","boundedExposureMicros:Number(b.boundedExposure)"],
 ['reconciliation exposure sum unchecked',"boundedExposureMicros:exact(usage.boundedExposure+liabilities.boundedExposure,'boundedExposureMicros')","boundedExposureMicros:Number(usage.boundedExposure+liabilities.boundedExposure)"],
 ['residual converted unchecked',"residualMicros:exact(residual,'residualMicros')","residualMicros:Number(residual)"],
 ['tolerance unchecked',"check(isInt(toleranceMicros),'INVALID_TOLERANCE'","check(true,'INVALID_TOLERANCE'"],
 ['released cost not enforced',"&&(input.cost.micros??0)===0",""],
 ['released token detail not enforced',"&&Object.values(input.detail).every(v=>v===0)",""],
 ['revision may move occurredAt',"'attempt','placementClass','occurredAt','aiTier'","'attempt','placementClass','aiTier'"],
 ['revision may change workload',"['workload','workClass','taskRef'","['workClass','taskRef'"],
 ['revision may change placement',"'attempt','placementClass','occurredAt'","'attempt','occurredAt'"],
 ['revision may change task',"'workClass','taskRef','attempt','placementClass'","'workClass','attempt','placementClass'"],
 ['revision may change attempt',"'taskRef','attempt','placementClass'","'taskRef','placementClass'"],
 ['revision may change tier',"'occurredAt','aiTier']","'occurredAt']"],
 ['provider event ID replaceable',"check(lower.providerEventId===null||lower.providerEventId===higher.providerEventId,'IMMUTABLE_FIELD'","check(true,'IMMUTABLE_FIELD'"],
 ['revision may reprice the tariff pin',"check(lower.cost.basis!=='tariff'||higher.cost.basis!=='tariff'||canonical(lower.cost.tariff)===canonical(higher.cost.tariff),'IMMUTABLE_FIELD'","check(true,'IMMUTABLE_FIELD'"],
 ['observedAt may run backwards',"check(higher.observedAt>=lower.observedAt,'REVISION_REGRESSION'","check(true,'REVISION_REGRESSION'"],
 ['outcome may regress',"check(outcomeRank[higher.outcome]>=outcomeRank[lower.outcome]&&(outcomeRank[lower.outcome]<2||lower.outcome===higher.outcome),'REVISION_REGRESSION'","check(true,'REVISION_REGRESSION'"],
 ['known quantity may be unknown again',"check(lower.quantity.state==='unknown'||higher.quantity.state==='known','REVISION_REGRESSION'","check(true,'REVISION_REGRESSION'"],
 ['known cost may be unknown again',"check(lower.cost.basis==='unknown'||higher.cost.basis!=='unknown','REVISION_REGRESSION'","check(true,'REVISION_REGRESSION'"],
 ['period close overwrites the snapshot',"if(!closed.has(period))closed.set(period,{closedSeq:seq,snapshot:summary({period})});","closed.set(period,{closedSeq:seq,snapshot:summary({period})});"],
 ['closure keeps the source event ID',"({...e,sourceEventId:tomb.sourceEventId,","({...e,sourceEventId:e.sourceEventId,"],
 ['closure keeps the idempotency key',"sourceEventId:tomb.sourceEventId,idempotencyKey:tomb.idempotencyKey,","sourceEventId:tomb.sourceEventId,idempotencyKey:e.idempotencyKey,"],
 ['closure keeps the provider event ID',"idempotencyKey:tomb.idempotencyKey,providerEventId:null,","idempotencyKey:tomb.idempotencyKey,providerEventId:e.providerEventId,"],
 ['closure keeps the task reference',"providerEventId:null,taskRef:null,attribution:","providerEventId:null,taskRef:e.taskRef,attribution:"],
 ['closure tombstone unkeyed',"createHmac('sha256',closureKey).update(","createHash('sha256').update("],
 ['closed identity not found again',"rec=identities.get(tomb.idempotencyKey);","rec=undefined;"],
 ['closed identity may move owner',"check(a.scope==='tenant'?mac('owner',a.ownerId)===rec.ownerMac:a.pool==='closed-account','TENANT_MISMATCH'","check(true,'TENANT_MISMATCH'"],
 ['closed owner receives tenant cost again',"check(!closedOwners.has(mac('owner',e.attribution.ownerId)),'OWNER_CLOSED'","check(true,'OWNER_CLOSED'"],
];
// Each mutant must be caught by the check written for that property, not by an unrelated failure.
const killedBy={
 'every revision counted':'delayed and out-of-order','lowest revision wins':'delayed and out-of-order',
 'conflicting redelivery accepted':'identity:','idempotency key not verified':'identity:',
 'tenant mismatch accepted':'tenant mismatch','resource of another project accepted':'tenant mismatch','revision may change attribution':'tenant mismatch','closed project still accepted':'tenant mismatch',
 'unknown cost not counted':'missing quantities','pending operation priced':'a pending or uncertain','released reservation may have quantity':'a pending or uncertain',
 'unknown tariff accepted':'an unknown or unpriced rate','unpriced dimension accepted':'an unknown or unpriced rate',
 'tariff version not pinned':'tariff versions stay pinned','tariff window ignored':'tariff versions stay pinned',
 'allowance subtracted per tenant':'an account-wide free allowance','per-tenant allowance allocation accepted':'an account-wide free allowance',
 'per-event rounding':'partitioning usage','customer units accepted':'standard AI stays internal','billing field accepted':'standard AI stays internal',
 'shadow counted as expense':'standard AI stays internal','shadow allowed on infrastructure':'standard AI stays internal',
 'overhead folded into task':'control and retry overhead','retry attempt not enforced':'control and retry overhead','standing cost may name a task':'control and retry overhead',
 'secret accepted':'events are content-free','content field accepted':'events are content-free','content detail accepted':'events are content-free','physical locator accepted':'events are content-free','client-assigned time accepted':'events are content-free',
 'late events not flagged':'a late event for a closed period','closed snapshot rewritten':'a late event for a closed period',
 'residual silently absorbed':'provider minimums','unknown ignored by reconciliation':'provider minimums',
 'shadow compared with the invoice':'reconciliation reports','liability not separated':'provider minimums','invoice lines not summed':'reconciliation reports',
 'owner link kept on closure':'account closure','unit not checked':'unknown versions, fields','source may emit any dimension':'unknown versions, fields',
 'unknown workload accepted':'unknown versions, fields','unknown version accepted':'unknown versions, fields',
 'exported heads share nested objects':'every read surface','restatement aliases the closed snapshot':'every read surface','close returns the stored snapshot':'every read surface',
 'ledger shares the caller registry':'the ledger prices from a frozen registry','exported registry mutable':'the ledger prices from a frozen registry',
 'unsafe amounts rounded':'amounts beyond the exactly representable range','unit totals converted unchecked':'amounts beyond the exactly representable range','shadow total converted unchecked':'amounts beyond the exactly representable range',
 'known estimate converted unchecked':'amounts beyond the exactly representable range','exposure converted unchecked':'amounts beyond the exactly representable range',
 'reconciliation exposure sum unchecked':'amounts beyond the exactly representable range','residual converted unchecked':'amounts beyond the exactly representable range','tolerance unchecked':'amounts beyond the exactly representable range',
 'released cost not enforced':'a pending or uncertain','released token detail not enforced':'a pending or uncertain',
 'revision may move occurredAt':'revisions keep their identity fields','revision may change workload':'revisions keep their identity fields','revision may change placement':'revisions keep their identity fields',
 'revision may change task':'revisions keep their identity fields','revision may change attempt':'revisions keep their identity fields','revision may change tier':'revisions keep their identity fields',
 'provider event ID replaceable':'revisions keep their identity fields','revision may reprice the tariff pin':'revisions keep their identity fields','observedAt may run backwards':'revisions keep their identity fields',
 'outcome may regress':'revisions keep their identity fields','known quantity may be unknown again':'revisions keep their identity fields','known cost may be unknown again':'revisions keep their identity fields',
 'period close overwrites the snapshot':'closing a period twice',
 'closure keeps the source event ID':'account closure','closure keeps the idempotency key':'account closure','closure keeps the provider event ID':'account closure','closure keeps the task reference':'account closure',
 'closure tombstone unkeyed':'account closure','closed identity not found again':'account closure','closed identity may move owner':'account closure','closed owner receives tenant cost again':'account closure'
};
let killed=0;
for(const [name,find,replace] of mutants){
 assert.equal(prototypeSource.split(find).length,2,`mutant "${name}" must match the reference exactly once`);
 const mutant=await import('data:text/javascript;base64,'+Buffer.from(prototypeSource.replace(find,()=>replace)).toString('base64'));
 await assert.rejects(suite(mutant),e=>{
  if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}`);
  assert.ok(killedBy[name]&&e.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${e.message}`);return true;
 },`mutant survived: ${name}`);killed++;
}
assert.equal(killed,mutants.length);
assert.deepEqual(Object.keys(killedBy).sort(),mutants.map(x=>x[0]).sort());
console.log(`cost-events-contract: ${suiteCount} reference checks and ${total-suiteCount} source-agreement/static checks passed; ${killed}/${mutants.length} mutants caught (synthetic providers and identifiers; no database write, network, credential or model).`);
