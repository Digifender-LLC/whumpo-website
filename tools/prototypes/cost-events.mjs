import {createHash,createHmac,randomBytes} from 'node:crypto';

// WH-022 / WH-168 offline reference for the planned shadow cost-event contract (docs/cost-events.md).
// Builtins only: no Worker import, database, network, credential or provider. It freezes the envelope, the
// dimension/workload/tariff registries, the append rules and the aggregate reconciliation so the later source,
// storage and import slices implement one contract. It is NOT imported by the product and adds no table.
export const contractVersion=1;
// Cost is held as an exact fraction over this denominator so partitioning usage into events can never inflate a
// total: money is rounded up once per reported total, never per event. Every tariff block size must divide it.
export const costScale=9_000_000n;

export class CostEventError extends Error{
 constructor(code,detail){super(`${code}: ${detail}`);this.name='CostEventError';this.code=code;this.detail=detail;}
}
const check=(ok,code,detail)=>{if(!ok)throw new CostEventError(code,detail);};
const isInt=(v,min=0)=>Number.isSafeInteger(v)&&v>=min;
const deepFreeze=v=>{if(v!==null&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);for(const x of Object.values(v))deepFreeze(x);}return v;};
// Every reported figure is an exact integer. Totals are summed as BigInt and a figure beyond the safe-integer range is refused
// (AMOUNT_UNSAFE), never rounded, so a report cannot silently differ from the sum of the events it reports.
const MAX_SAFE=BigInt(Number.MAX_SAFE_INTEGER);
const exact=(v,what)=>{check(v>=-MAX_SAFE&&v<=MAX_SAFE,'AMOUNT_UNSAFE',`${what} is outside the exactly representable range and is refused rather than rounded`);return Number(v);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const SAFE=/^[A-Za-z0-9._:-]{1,128}$/,UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/,STAMP=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/,DIGEST=/^[0-9a-f]{64}$/;
const SECRET=/sk-[A-Za-z0-9]{8,}|Bearer\s|-----BEGIN|eyJ[A-Za-z0-9_-]{10,}\./;
const BILLING_KEY=/unit|debit|credit|charge|balance|wallet|entitle|authority|price|invoice|payment/i;
const LOCATOR_KEY=/database|bucket|binding|script|namespace|objectkey|accountid|gatewayid|hostname|url/i;
const CONTENT_KEY=/^(prompt|content|text|body|message|email|secret|token|authorization|apikey|password|cookie|name)$/i;
export const canonical=v=>JSON.stringify(v,(_k,x)=>plain(x)?Object.fromEntries(Object.entries(x).sort(([a],[b])=>a<b?-1:a>b?1:0)):x);
export const idempotencyKey=({source,sourceEventId,dimension})=>createHash('sha256').update(canonical({dimension,source,sourceEventId})).digest('hex');
function shape(value,keys,where){
 check(plain(value),'INVALID_EVENT',where);
 for(const k of Object.keys(value)){
  check(!['receivedAt','receivedSeq','late'].includes(k),'CLIENT_ASSIGNED',`${where}.${k}`);
  check(!BILLING_KEY.test(k)||keys.includes(k),'BILLING_AUTHORITY',`${where}.${k}`);
  check(!LOCATOR_KEY.test(k)||keys.includes(k),'PHYSICAL_LOCATOR',`${where}.${k}`);
  check(!CONTENT_KEY.test(k),'CONTENT_FIELD',`${where}.${k}`);
  check(keys.includes(k),'UNKNOWN_FIELD',`${where}.${k}`);
 }
 for(const k of keys)check(Object.hasOwn(value,k),'MISSING_FIELD',`${where}.${k}`);
}

// ---------- Registries (closed; later feature packets add entries through review, never ad hoc) ----------
// Reason codes are enumerated so an event never carries free text or customer content.
export const unknownReasons=['rate-missing','usage-not-reported','usage-pending','outcome-unknown','provider-lag','unpriced','not-measured','invoice-pending','entitlement-unknown'];
export const placementClasses=['static','shared-api','isolated-function','persistent-process','platform'];
export const workClasses=['task','retry','control','standing'];
export const outcomes=['settled','pending','uncertain','released'];
export const costBases=['tariff','receipt','provider-reported','shadow','unknown'];
export const platformPools=['shared-account','control-plane','closed-account'];
export const aiTiers=['standard','premium'];
// workload = which customer-visible capability the cost supports (WH-078/WH-023 measure cost per outcome).
export const workloads={
 'chat-ai':{readiness:'source',packet:'WH-022'},'site-publication':{readiness:'source',packet:'WH-022'},'app-runtime':{readiness:'source',packet:'WH-022'},
 'storage-files':{readiness:'source',packet:'WH-022'},'contact-intake':{readiness:'source',packet:'WH-022'},'platform-standing':{readiness:'source',packet:'WH-022'},
 'guest-preview':{readiness:'planned',packet:'WH-092'},'kit-preview':{readiness:'planned',packet:'WH-091'},'comments':{readiness:'planned',packet:'WH-092'},
 'leads':{readiness:'planned',packet:'WH-093'},'notifications':{readiness:'planned',packet:'WH-068'},'connector-read':{readiness:'planned',packet:'WH-056'},
 'connector-action':{readiness:'planned',packet:'WH-056'},'collaboration':{readiness:'planned',packet:'WH-090'},'staging':{readiness:'planned',packet:'WH-101'},
 'portfolio-bulk':{readiness:'planned',packet:'WH-103'}
};
const meter=(unit,financeCategory,provider,sources,scopes=['tenant','platform'])=>({kind:'usage',unit,financeCategory,provider,sources,scopes,readiness:'planned-producer',detailKeys:[]});
const cf=['cloudflare-usage-import','storage-operations'];
export const dimensions={
 'ai.inference.call':{...meter('call','inference','inference-provider',['inference-receipt','gateway-settlement']),readiness:'source-producer',detailKeys:['inputTokens','outputTokens']},
 'worker.requests':meter('request','hosting','cloudflare',cf),'worker.cpu_ms':meter('cpu_ms','hosting','cloudflare',cf),
 'r2.storage':meter('mb_month','hosting','cloudflare',cf),'r2.class_a_ops':meter('operation','hosting','cloudflare',cf),
 'r2.class_b_ops':{...meter('operation','hosting','cloudflare',cf),readiness:'source-producer'},
 'd1.rows_read':meter('row','hosting','cloudflare',cf),'d1.rows_written':meter('row','hosting','cloudflare',cf),'d1.storage':meter('mb_month','hosting','cloudflare',cf),
 'container.vcpu_seconds':meter('vcpu_second','hosting','cloudflare',cf),'container.memory_gib_seconds':meter('gib_second','hosting','cloudflare',cf),
 'container.disk_gb_seconds':meter('gb_second','hosting','cloudflare',cf),'container.egress':meter('mb','hosting','cloudflare',cf),
 'do.requests':meter('request','hosting','cloudflare',cf),'do.duration':meter('gb_second','hosting','cloudflare',cf),'do.rows_read':meter('row','hosting','cloudflare',cf),
 'do.rows_written':meter('row','hosting','cloudflare',cf),'do.storage':meter('mb_month','hosting','cloudflare',cf),
 'stream.storage':meter('minute_month','hosting','cloudflare',cf),'stream.delivery':meter('minute','hosting','cloudflare',cf),
 // Registered now so later packets only add producers. No price is known: events stay explicit-unknown until reviewed.
 'notification.message':meter('message','other','notification-provider',['notification-delivery']),
 'connector.provider_call':meter('call','other','connector-provider',['connector-call']),
 'liability.account-minimum':{kind:'liability',unit:'item',financeCategory:'hosting',provider:'cloudflare',sources:['liability-register'],scopes:['platform'],readiness:'planned-producer',detailKeys:[]},
 'liability.provider-minimum':{kind:'liability',unit:'item',financeCategory:'hosting',provider:'cloudflare',sources:['liability-register'],scopes:['platform'],readiness:'planned-producer',detailKeys:[]},
 'liability.license':{kind:'liability',unit:'item',financeCategory:'other',provider:'company',sources:['liability-register'],scopes:['platform'],readiness:'planned-producer',detailKeys:[]},
 'liability.renewal':{kind:'liability',unit:'item',financeCategory:'other',provider:'company',sources:['liability-register'],scopes:['platform'],readiness:'planned-producer',detailKeys:[]},
 'liability.support':{kind:'liability',unit:'item',financeCategory:'support',provider:'company',sources:['liability-register'],scopes:['platform','tenant'],readiness:'planned-producer',detailKeys:[]},
 'liability.staging-retained':{kind:'liability',unit:'item',financeCategory:'hosting',provider:'cloudflare',sources:['liability-register'],scopes:['tenant','platform'],readiness:'planned-producer',detailKeys:[]},
 'liability.uncertain-operation':{kind:'liability',unit:'item',financeCategory:'other',provider:'cloudflare',sources:['liability-register','connector-call'],scopes:['tenant','platform'],readiness:'planned-producer',detailKeys:[]}
};
export const sources={
 'inference-receipt':{readiness:'source-adapter-planned',table:'inference_calls'},'gateway-settlement':{readiness:'source-adapter-planned',table:'gateway_spend_attempts'},
 'storage-operations':{readiness:'source-adapter-planned',table:'storage_project_usage'},'cloudflare-usage-import':{readiness:'planned',table:null},
 'liability-register':{readiness:'planned',table:null},'notification-delivery':{readiness:'planned',table:null},'connector-call':{readiness:'planned',table:null}
};
// Tariff catalogue. "pool-proposal" mirrors src/resource-economics.ts (a Whumpo planning proposal, not an invoice).
// perUnits is the provider's block size in the dimension's event unit. Account-wide allowances are metadata only.
const rate=(perUnits,micros)=>({perUnits,micros});
const rates={
 'worker.requests':rate(1_000_000,300_000),'worker.cpu_ms':rate(1_000_000,20_000),'r2.storage':rate(1000,15_000),'r2.class_a_ops':rate(1_000_000,4_500_000),
 'r2.class_b_ops':rate(1_000_000,360_000),'d1.rows_read':rate(1_000_000,1000),'d1.rows_written':rate(1_000_000,1_000_000),'d1.storage':rate(1000,750_000),
 'container.vcpu_seconds':rate(3600,72_000),'container.memory_gib_seconds':rate(3600,9000),'container.disk_gb_seconds':rate(3600,252),'container.egress':rate(1000,50_000),
 'do.requests':rate(1_000_000,150_000),'do.duration':rate(1_000_000,12_500_000),'do.rows_read':rate(1_000_000,1000),'do.rows_written':rate(1_000_000,1_000_000),
 'do.storage':rate(1000,200_000),'stream.storage':rate(1,5000),'stream.delivery':rate(1,1000)
};
export const tariffs={'pool-proposal':{1:{status:'proposal',effectiveFrom:'2026-09-30T00:00:00.000Z',effectiveTo:null,rates,accountAllowance:null,allowanceAllocation:'account-wide-not-allocated'}}};
// Frozen: the exported registry (and the sources, dimensions, workloads and tariffs inside it) cannot be edited by a caller.
export const defaultRegistry=deepFreeze({sources,dimensions,workloads,tariffs});

export function validateRegistry(registry){
 for(const [id,d] of Object.entries(registry.dimensions)){
  check(/^[a-z0-9_.-]+$/.test(id),'INVALID_REGISTRY',id);
  check(d.kind==='usage'||d.kind==='liability','INVALID_REGISTRY',id);
  for(const s of d.sources)check(Object.hasOwn(registry.sources,s),'INVALID_REGISTRY',`${id} source ${s}`);
 }
 for(const [tid,versions] of Object.entries(registry.tariffs))for(const [version,t] of Object.entries(versions)){
  check(Number.isSafeInteger(Number(version))&&Number(version)>=1,'INVALID_TARIFF',`${tid}@${version}`);
  check(STAMP.test(t.effectiveFrom)&&(t.effectiveTo===null||t.effectiveTo>t.effectiveFrom),'INVALID_TARIFF',`${tid}@${version} window`);
  // A free allowance belongs to the account, never to a tenant: it may not be divided or reused per tenant.
  check(t.allowanceAllocation==='account-wide-not-allocated','ALLOWANCE_ALLOCATION',`${tid}@${version}`);
  for(const [dim,r] of Object.entries(t.rates)){
   check(registry.dimensions[dim]?.kind==='usage','INVALID_TARIFF',`${tid}@${version} ${dim}`);
   check(isInt(r.perUnits,1)&&isInt(r.micros,0)&&costScale%BigInt(r.perUnits)===0n,'INVALID_TARIFF',`${tid}@${version} ${dim} rate`);
  }
 }
 return true;
}

// ---------- Envelope ----------
const eventKeys=['contractVersion','source','sourceEventId','providerEventId','revision','idempotencyKey','kind','dimension','workload','workClass','taskRef','attempt','attribution','placementClass','quantity','cost','outcome','customerUnits','aiTier','detail','occurredAt','observedAt'];
function stamp(v,where){check(typeof v==='string'&&STAMP.test(v)&&new Date(v).toISOString()===v,'INVALID_TIME',where);}
function reason(v,where){check(unknownReasons.includes(v),'INVALID_REASON',where);}
function attribution(a){
 check(plain(a),'INVALID_ATTRIBUTION','attribution');
 if(a.scope==='tenant'){
  shape(a,['scope','ownerId','projectId','resourceId'],'attribution');
  check(UUID.test(a.ownerId),'INVALID_ATTRIBUTION','ownerId');
  check(a.projectId===null||UUID.test(a.projectId),'INVALID_ATTRIBUTION','projectId');
  check(a.resourceId===null||UUID.test(a.resourceId),'INVALID_ATTRIBUTION','resourceId');
  check(a.resourceId===null||a.projectId!==null,'INVALID_ATTRIBUTION','a resource needs its project');
 }else if(a.scope==='platform'){shape(a,['scope','pool'],'attribution');check(platformPools.includes(a.pool),'INVALID_ATTRIBUTION','pool');}
 else check(false,'INVALID_ATTRIBUTION','scope');
}
function quantity(q,dim){
 check(plain(q),'INVALID_QUANTITY','quantity');
 if(q.state==='known'){shape(q,['state','value','unit'],'quantity');check(isInt(q.value),'INVALID_QUANTITY','value');check(q.unit===dim.unit,'UNIT_MISMATCH',`${q.unit} != ${dim.unit}`);}
 else if(q.state==='unknown'){shape(q,['state','reason'],'quantity');reason(q.reason,'quantity.reason');}
 else check(false,'INVALID_QUANTITY','state');
}
function cost(c){
 check(plain(c)&&costBases.includes(c.basis),'INVALID_COST','basis');
 if(c.basis==='tariff'){shape(c,['basis','tariff'],'cost');shape(c.tariff,['id','version'],'cost.tariff');check(SAFE.test(c.tariff.id)&&isInt(c.tariff.version,1),'INVALID_COST','tariff');}
 else if(c.basis==='unknown'){
  shape(c,['basis','reason','exposureMicros'],'cost');reason(c.reason,'cost.reason');
  check(c.exposureMicros===null||isInt(c.exposureMicros),'INVALID_COST','exposureMicros');
 }else{shape(c,['basis','micros','ref'],'cost');check(isInt(c.micros),'INVALID_COST','micros');check(SAFE.test(c.ref),'INVALID_COST','ref');}
}
export function validateEvent(input,registry=defaultRegistry){
 shape(input,eventKeys,'event');
 check(input.contractVersion===contractVersion,'UNSUPPORTED_VERSION',String(input.contractVersion));
 check(Object.hasOwn(registry.sources,input.source),'UNKNOWN_SOURCE',String(input.source));
 check(Object.hasOwn(registry.dimensions,input.dimension),'UNKNOWN_DIMENSION',String(input.dimension));const dim=registry.dimensions[input.dimension];
 check(dim.sources.includes(input.source),'SOURCE_DIMENSION',`${input.source} may not emit ${input.dimension}`);
 check(typeof input.sourceEventId==='string'&&SAFE.test(input.sourceEventId),'INVALID_EVENT','sourceEventId');
 check(!input.sourceEventId.startsWith('closed:'),'INVALID_EVENT','the closed: prefix is reserved for closure tombstones');
 check(input.providerEventId===null||(typeof input.providerEventId==='string'&&SAFE.test(input.providerEventId)),'INVALID_EVENT','providerEventId');
 check(isInt(input.revision,1),'INVALID_EVENT','revision');
 check(input.kind===dim.kind,'KIND_MISMATCH',`${input.dimension} is ${dim.kind}`);
 check(input.idempotencyKey===idempotencyKey(input),'IDEMPOTENCY_KEY','must equal the derived digest of source, sourceEventId and dimension');
 check(Object.hasOwn(registry.workloads,input.workload),'UNKNOWN_WORKLOAD',String(input.workload));
 check(workClasses.includes(input.workClass),'INVALID_EVENT','workClass');
 check(input.taskRef===null||(typeof input.taskRef==='string'&&SAFE.test(input.taskRef)&&input.taskRef.length<=64),'INVALID_EVENT','taskRef');
 check(isInt(input.attempt,1)&&input.attempt<=10,'INVALID_EVENT','attempt');
 // Overhead is separate and attributable to its task, never folded into the task's own line.
 if(input.workClass==='standing')check(input.taskRef===null&&input.attempt===1,'OVERHEAD_CLASS','standing cost has no task');
 else check(input.taskRef!==null,'OVERHEAD_CLASS','task, retry and control cost name their task');
 check((input.workClass==='retry')===(input.attempt>=2)||input.workClass==='control','OVERHEAD_CLASS','retry cost is attempt 2 or later');
 attribution(input.attribution);check(dim.scopes.includes(input.attribution.scope),'SCOPE_NOT_ALLOWED',`${input.dimension} ${input.attribution.scope}`);
 check(placementClasses.includes(input.placementClass),'INVALID_EVENT','placementClass');
 quantity(input.quantity,dim);cost(input.cost);
 check(outcomes.includes(input.outcome),'INVALID_EVENT','outcome');
 check(input.customerUnits===0,'BILLING_AUTHORITY','events carry zero customer units; debits live in the entitlement ledger');
 check(input.aiTier===null||aiTiers.includes(input.aiTier),'INVALID_EVENT','aiTier');
 check((input.aiTier===null)===(!input.dimension.startsWith('ai.')),'INVALID_EVENT','aiTier belongs to ai.* dimensions only');
 check(plain(input.detail),'INVALID_EVENT','detail');
 for(const k of Object.keys(input.detail))check(!CONTENT_KEY.test(k),'CONTENT_FIELD',`detail.${k}`);
 check(Object.keys(input.detail).every(k=>dim.detailKeys.includes(k)&&isInt(input.detail[k])),'UNKNOWN_FIELD','detail');
 stamp(input.occurredAt,'occurredAt');stamp(input.observedAt,'observedAt');check(input.observedAt>=input.occurredAt,'INVALID_TIME','observedAt precedes occurredAt');
 const text=canonical(input);check(!SECRET.test(text),'SECRET_IN_EVENT','secret-shaped value');
 // Outcome and cost must agree so an unfinished or unknown operation can never read as a known (or zero) cost.
 if(input.outcome==='pending'||input.outcome==='uncertain')check(input.cost.basis==='unknown','OUTCOME_COST',`${input.outcome} cost is explicit unknown`);
 if(input.outcome==='released')check(input.quantity.state==='known'&&input.quantity.value===0&&input.cost.basis!=='unknown'&&(input.cost.micros??0)===0&&Object.values(input.detail).every(v=>v===0),'OUTCOME_COST','a released reservation consumed nothing: known zero quantity, zero cost and no token detail');
 if(input.cost.basis==='tariff'){
  check(dim.kind==='usage'&&input.quantity.state==='known','OUTCOME_COST','a tariff prices a known quantity');
  const t=registry.tariffs[input.cost.tariff.id]?.[input.cost.tariff.version];
  check(t,'UNKNOWN_TARIFF',`${input.cost.tariff.id}@${input.cost.tariff.version}`);
  check(t.rates[input.dimension],'UNPRICED_DIMENSION',input.dimension);
  check(input.occurredAt>=t.effectiveFrom&&(t.effectiveTo===null||input.occurredAt<t.effectiveTo),'TARIFF_NOT_EFFECTIVE',`${input.cost.tariff.id}@${input.cost.tariff.version}`);
 }
 if(input.cost.basis==='shadow')check(dim.provider==='inference-provider','SHADOW_BASIS','only hypothetical inference estimates are shadow');
 return structuredClone(input);
}

// ---------- Logical identity directory (WH-071 stable IDs; physical locators never appear here) ----------
export function createIdentityDirectory(){
 const projects=new Map();
 return {
  addProject(projectId,ownerId){projects.set(projectId,{ownerId,closed:false,resources:new Map()});},
  addResource(projectId,resourceId,placementClass='shared-api'){projects.get(projectId).resources.set(resourceId,placementClass);},
  movePlacement(projectId,resourceId,placementClass){projects.get(projectId).resources.set(resourceId,placementClass);},
  placementOf:(projectId,resourceId)=>projects.get(projectId)?.resources.get(resourceId)??null,
  closeProject(projectId){projects.get(projectId).closed=true;},
  lookup:projectId=>projects.get(projectId)??null
 };
}

const bucket=()=>({events:0,units:{},tariffNum:0n,receipt:0n,providerReported:0n,shadow:0n,unknownEvents:0,unknownQuantity:0,boundedExposure:0n,unboundedExposure:0,pending:0,uncertain:0});
const ceilScaled=n=>(n+costScale-1n)/costScale;
const knownOf=b=>ceilScaled(b.tariffNum)+b.receipt+b.providerReported;
// Reports are canonical: key order never depends on the order events arrived in.
const sorted=o=>Object.fromEntries(Object.entries(o).sort(([a],[b])=>a<b?-1:a>b?1:0));
function addTo(b,e,registry){
 b.events++;
 if(e.quantity.state==='known')b.units[e.quantity.unit]=(b.units[e.quantity.unit]??0n)+BigInt(e.quantity.value);else b.unknownQuantity++;
 if(e.outcome==='pending')b.pending++;if(e.outcome==='uncertain')b.uncertain++;
 const c=e.cost;
 if(c.basis==='tariff'){
  const r=registry.tariffs[c.tariff.id][c.tariff.version].rates[e.dimension];
  // The pinned tariff version prices the event; a later version never reprices it. No allowance is subtracted.
  const billable=BigInt(e.quantity.value);
  b.tariffNum+=billable*BigInt(r.micros)*(costScale/BigInt(r.perUnits));
 }else if(c.basis==='receipt')b.receipt+=BigInt(c.micros);
 else if(c.basis==='provider-reported')b.providerReported+=BigInt(c.micros);
 else if(c.basis==='shadow')b.shadow+=BigInt(c.micros);
 else{b.unknownEvents++;if(c.exposureMicros===null)b.unboundedExposure++;else b.boundedExposure+=BigInt(c.exposureMicros);}
}
function present(b){
 const tariff=ceilScaled(b.tariffNum),known=knownOf(b);
 return {events:b.events,units:sorted(Object.fromEntries(Object.entries(b.units).map(([k,v])=>[k,exact(v,`units.${k}`)]))),
  tariffMicros:exact(tariff,'tariffMicros'),receiptMicros:exact(b.receipt,'receiptMicros'),providerReportedMicros:exact(b.providerReported,'providerReportedMicros'),knownEstimateMicros:exact(known,'knownEstimateMicros'),
  shadowMicros:exact(b.shadow,'shadowMicros'),unknownEvents:b.unknownEvents,unknownQuantity:b.unknownQuantity,
  boundedExposureMicros:exact(b.boundedExposure,'boundedExposureMicros'),unboundedExposureEvents:b.unboundedExposure,pending:b.pending,uncertain:b.uncertain,customerUnits:0};
}

// Revisions of one identity (source, sourceEventId, dimension) may only ADVANCE. These fields name the event and where its
// cost falls, so they never change after the first revision: a revision cannot move cost to another period (occurredAt), owner,
// workload or attempt. Everything else is an observation that legitimately moves forward and is checked in advances().
// The owner, project, resource, task and provider IDs are also fixed, but account closure erases them, so they are compared
// through keyed digests (`cmp`, and the record's attribution digest) that exist from the first append and survive closure.
const identityFields=['workload','workClass','attempt','placementClass','occurredAt','aiTier'];
const outcomeRank={pending:0,uncertain:1,settled:2,released:2};
const CLOSED_ACCOUNT=Object.freeze({scope:'platform',pool:'closed-account'});
const isClosedAccount=a=>a.scope==='platform'&&a.pool==='closed-account';
// `lower` has the lower revision. The pairwise rule is symmetric in arrival order, so any order of a valid set converges and an
// invalid pair is refused whichever side arrives second. Attribution is fixed per identity and checked once in append().
function advances(lower,higher){
 for(const f of identityFields)check(canonical(lower[f])===canonical(higher[f]),'IMMUTABLE_FIELD',`${f} is fixed by the first revision`);
 check(lower.cmp.task===higher.cmp.task,'IMMUTABLE_FIELD','taskRef is fixed by the first revision');
 // The provider's own ID may be learned later (null -> value) but never replaced or dropped.
 check(lower.cmp.provider===null||lower.cmp.provider===higher.cmp.provider,'IMMUTABLE_FIELD','providerEventId is preserved once known');
 // A tariff pin is the price basis: a revision cannot reprice the event under another tariff version.
 check(lower.cost.basis!=='tariff'||higher.cost.basis!=='tariff'||canonical(lower.cost.tariff)===canonical(higher.cost.tariff),'IMMUTABLE_FIELD','the pinned tariff is fixed once priced');
 check(higher.observedAt>=lower.observedAt,'REVISION_REGRESSION','observedAt does not move backwards');
 check(outcomeRank[higher.outcome]>=outcomeRank[lower.outcome]&&(outcomeRank[lower.outcome]<2||lower.outcome===higher.outcome),'REVISION_REGRESSION','an outcome only advances and a terminal outcome is final');
 check(lower.quantity.state==='unknown'||higher.quantity.state==='known','REVISION_REGRESSION','a known quantity is not made unknown again');
 check(lower.cost.basis==='unknown'||higher.cost.basis!=='unknown','REVISION_REGRESSION','a known cost is not made unknown again');
}

export function createLedger({directory,registry:supplied=defaultRegistry,now=()=>new Date().toISOString(),closureKey=randomBytes(32)}){
 // The ledger prices from a private frozen snapshot: later edits to the caller's registry cannot reprice pinned history.
 const registry=deepFreeze(structuredClone(supplied));validateRegistry(registry);
 // The key is copied once: the ledger never holds the caller's buffer, so editing it afterwards cannot change any digest.
 check(typeof closureKey==='string'||closureKey instanceof Uint8Array,'INVALID_CLOSURE_KEY','closureKey must be a string or a Uint8Array');
 const keyBytes=Buffer.from(closureKey);check(keyBytes.length>=16,'INVALID_CLOSURE_KEY','closureKey must be at least 16 bytes');
 const identities=new Map(),closed=new Map(),closedOwners=new Set();let seq=0;
 const periodOf=e=>e.occurredAt.slice(0,7);
 const heads=()=>[...identities.values()].map(r=>r.revisions.get(Math.max(...r.revisions.keys())));
 // Keyed digests: after account closure the only retained linkage is HMAC(closureKey, original value). It cannot be reversed or
 // guessed from a project/owner UUID without the key, so it is pseudonymous evidence that lives exactly as long as the key.
 const mac=(domain,value)=>createHmac('sha256',keyBytes).update(`${domain}:${value}`).digest('hex');
 const pseudonym=(domain,value)=>`closed:${mac(domain,value).slice(0,32)}`;
 const tombstoneOf=e=>{const sourceEventId=pseudonym('identity',e.idempotencyKey);return {sourceEventId,idempotencyKey:idempotencyKey({source:e.source,sourceEventId,dimension:e.dimension})};};
 // What account closure leaves of one revision: no owner, project, task, provider ID or cost reference, and an opaque keyed
 // source/idempotency identity. Producers choose cost references freely, so every one is replaced, not only the ones seen to hold an ID.
 const closedForm=(e,tomb)=>({...e,sourceEventId:tomb.sourceEventId,idempotencyKey:tomb.idempotencyKey,providerEventId:null,taskRef:null,attribution:CLOSED_ACCOUNT,
  cost:Object.hasOwn(e.cost,'ref')?{...e.cost,ref:pseudonym('ref',e.cost.ref)}:e.cost});
 const attributionMac=a=>mac('attribution',canonical(a));
 function ownership(e){
  const a=e.attribution;if(a.scope!=='tenant')return;
  const p=directory.lookup(a.projectId??'');
  if(a.projectId===null)return;
  check(p,'UNKNOWN_PROJECT','project is not registered');
  check(p.ownerId===a.ownerId,'TENANT_MISMATCH','project belongs to another owner');
  check(!p.closed,'PROJECT_CLOSED','late cost of a closed project is recorded at platform closed-account scope');
  check(a.resourceId===null||p.resources.has(a.resourceId),'TENANT_MISMATCH','resource is not part of the project');
 }
 function append(input){
  const raw=validateEvent(input,registry);const callerKey=raw.idempotencyKey;
  const closedAccount=isClosedAccount(raw.attribution),tomb=tombstoneOf(raw);
  // An identity is found under the caller's key while open, or under its tombstone once closed (redacted, or first recorded at
  // closed-account scope). Redelivery and later revisions of a closed identity converge on it without re-linking the owner.
  let rec=identities.get(callerKey),redirected=false;
  if(!rec){rec=identities.get(tomb.idempotencyKey);redirected=rec!==undefined;}
  const attrMac=attributionMac(raw.attribution);
  // Attribution is fixed per identity. Closure turns a tenant identity into closed-account, so a closed-account emission is the
  // same identity; a tenant emission of an identity first recorded at closed-account scope cannot prove its owner and is refused.
  if(rec)check(attrMac===rec.attrMac||(rec.closed&&closedAccount),'TENANT_MISMATCH','a later revision cannot change attribution, and cost of a closed account cannot move to another owner, pool or back to a tenant');
  if(!redirected&&!closedAccount){
   ownership(raw);
   if(raw.attribution.scope==='tenant')check(!closedOwners.has(mac('owner',raw.attribution.ownerId)),'OWNER_CLOSED','a closed account no longer receives tenant-scoped cost; record it at platform closed-account scope');
  }
  const stored=redirected||closedAccount?closedForm(raw,tomb):raw;
  // The digests of the delivered bytes and of the fields closure erases are computed at append, while the originals are visible,
  // so same-revision conflicts and later revisions are judged the same way before and after closure.
  const cmp={task:raw.taskRef===null?null:mac('task',raw.taskRef),provider:raw.providerEventId===null?null:mac('provider',raw.providerEventId)};
  const fp=mac('revision',canonical({...raw,attribution:rec?.attrMac??attrMac}));
  const same=rec?.revisions.get(raw.revision);
  if(same){
   check(same.fp===fp,'IDEMPOTENCY_CONFLICT','same source event and revision with different content');
   return {status:'duplicate',key:callerKey,revision:raw.revision};
  }
  const candidate={...stored,cmp,fp};
  const prior=rec?[...rec.revisions.values()]:[];
  for(const p of prior){if(p.revision<candidate.revision)advances(p,candidate);else advances(candidate,p);}
  const topBefore=prior.length?Math.max(...rec.revisions.keys()):0;
  if(!rec){rec={revisions:new Map(),attrMac,closed:closedAccount};identities.set(stored.idempotencyKey,rec);}
  seq++;
  const lateAfterClose=closed.has(periodOf(stored))&&seq>closed.get(periodOf(stored)).closedSeq;
  rec.revisions.set(raw.revision,{...candidate,receivedSeq:seq,receivedAt:now(),lateAfterClose});
  return {status:raw.revision>topBefore?'accepted':'stale-revision',key:callerKey,revision:raw.revision};
 }
 const select=({period,ownerId,pool,workClass,workload}={})=>heads().filter(e=>(period===undefined||periodOf(e)===period)&&(ownerId===undefined||e.attribution.ownerId===ownerId)
  &&(pool===undefined||e.attribution.pool===pool)&&(workClass===undefined||e.workClass===workClass)&&(workload===undefined||e.workload===workload));
 function summary(filter={}){
  const events=select(filter),total=bucket(),byDimension={},byWorkClass={},byWorkload={};
  for(const e of events){
   addTo(total,e,registry);addTo(byDimension[e.dimension]??=bucket(),e,registry);addTo(byWorkClass[e.workClass]??=bucket(),e,registry);addTo(byWorkload[e.workload]??=bucket(),e,registry);
  }
  const map=o=>sorted(Object.fromEntries(Object.entries(o).map(([k,v])=>[k,present(v)])));
  return {period:filter.period??null,...present(total),byDimension:map(byDimension),byWorkClass:map(byWorkClass),byWorkload:map(byWorkload)};
 }
 // Closing is idempotent: the first close fixes the snapshot and a repeat returns that same snapshot. Nothing after it can
 // rewrite it; later arrivals surface only through restatement().
 function closePeriod(period){
  check(/^\d{4}-\d\d$/.test(period),'INVALID_PERIOD',period);
  if(!closed.has(period))closed.set(period,{closedSeq:seq,snapshot:summary({period})});
  return structuredClone(closed.get(period).snapshot);
 }
 function restatement(period){
  const c=closed.get(period);check(c,'PERIOD_OPEN',period);
  const late=select({period}).filter(e=>e.lateAfterClose);
  const current=summary({period});
  return {period,closedSnapshot:structuredClone(c.snapshot),lateEvents:late.length,knownEstimateDeltaMicros:exact(BigInt(current.knownEstimateMicros)-BigInt(c.snapshot.knownEstimateMicros),'knownEstimateDeltaMicros'),currentSummary:current};
 }
 function reconcile(period,invoice,{toleranceMicros=0}={}){
  check(isInt(toleranceMicros),'INVALID_TOLERANCE','toleranceMicros must be a non-negative safe integer');
  check(plain(invoice),'INVALID_INVOICE','invoice');
  shape(invoice,['provider','invoiceId','period','currency','totalMicros','lines'],'invoice');
  check(SAFE.test(invoice.invoiceId)&&invoice.currency==='USD'&&invoice.period===period&&isInt(invoice.totalMicros),'INVALID_INVOICE','fields');
  check(typeof invoice.provider==='string'&&Array.isArray(invoice.lines)&&invoice.lines.every(l=>plain(l)&&SAFE.test(l.category)&&isInt(l.amountMicros)),'INVALID_INVOICE','lines');
  check(invoice.lines.reduce((s,l)=>s+BigInt(l.amountMicros),0n)===BigInt(invoice.totalMicros),'INVOICE_LINES_MISMATCH','lines must sum to the total');
  const events=select({period}).filter(e=>registry.dimensions[e.dimension].provider===invoice.provider);
  const priced=events.filter(e=>e.cost.basis!=='shadow'),shadow=events.filter(e=>e.cost.basis==='shadow');
  const usage=bucket(),liabilities=bucket(),sh=bucket();
  for(const e of priced)addTo(registry.dimensions[e.dimension].kind==='liability'?liabilities:usage,e,registry);
  for(const e of shadow)addTo(sh,e,registry);
  const u=present(usage),l=present(liabilities),s=present(sh);
  // A pending or uncertain operation always has an unknown cost (see validateEvent), so unknown > 0 also covers unfinished work.
  const unknown=u.unknownEvents+l.unknownEvents,held=u.pending+u.uncertain+l.pending+l.uncertain;
  const residual=BigInt(invoice.totalMicros)-knownOf(usage)-knownOf(liabilities);
  // A residual is reported, never silently absorbed. It is only "reconciled" when nothing is unknown or unfinished.
  const status=unknown>0?'incomplete':(residual<0n?-residual:residual)<=BigInt(toleranceMicros)?'reconciled':'unexplained-residual';
  const lateAfterClose=select({period}).filter(e=>e.lateAfterClose).length;
  return {period,provider:invoice.provider,invoiceId:invoice.invoiceId,invoiceTotalMicros:invoice.totalMicros,usageKnownMicros:u.knownEstimateMicros,
   liabilityKnownMicros:l.knownEstimateMicros,shadowExcludedMicros:s.shadowMicros,residualMicros:exact(residual,'residualMicros'),unknownEvents:unknown,
   boundedExposureMicros:exact(usage.boundedExposure+liabilities.boundedExposure,'boundedExposureMicros'),unboundedExposureEvents:u.unboundedExposureEvents+l.unboundedExposureEvents,
   unfinishedEvents:held,lateAfterClose,periodClosed:closed.has(period),status,
   allowanceTreatment:'account-wide allowances are never allocated to tenants; a negative residual is account upside, not tenant credit'};
 }
 // Account closure. Company totals are kept; the owner link and every identifier that could name the owner, project, resource,
 // task, provider record or cost reference are replaced (see closedForm). What remains is pseudonymous (see closureKey), not
 // anonymous: timestamps, workload, quantities and costs stay, and the keyed digests can be re-derived by whoever holds the key.
 function redactOwner(ownerId){
  closedOwners.add(mac('owner',ownerId));
  let changed=0;
  for(const [key,rec] of [...identities]){
   if(rec.closed)continue;
   const first=rec.revisions.values().next().value;
   if(first.attribution.ownerId!==ownerId)continue;
   const tomb=tombstoneOf({...first,idempotencyKey:key});
   for(const [rev,e] of rec.revisions){rec.revisions.set(rev,closedForm(e,tomb));changed++;}
   rec.closed=true;identities.delete(key);identities.set(tomb.idempotencyKey,rec);
  }
  return changed;
 }
 return {append,summary,closePeriod,restatement,reconcile,redactOwner,exportHeads:(filter)=>select(filter).map(({cmp,fp,...e})=>structuredClone(e))};
}

// ---------- Existing-producer mapping (pure; the product's source adapters are WH-169) ----------
// Statuses only move forward, so the revision order is monotone and arrival order cannot matter.
const inferenceStatus={reserved:[1,'pending'],dispatched:[2,'pending'],uncertain:[3,'uncertain'],observed:[4,'settled'],released:[4,'released']};
function inferenceEnvelope({status,sourceEventId,providerEventId,owner,taskRef,role,rateRef,reservedMicros,input,output,shadowMicros,costBasis,occurredAt,observedAt,aiTier,source}){
 check(Object.hasOwn(inferenceStatus,status),'UNKNOWN_STATUS',String(status));const [revision,outcome]=inferenceStatus[status];
 let q,c;
 if(status==='observed'){
  q={state:'known',value:1,unit:'call'};
  c=costBasis==='shadow'?{basis:'shadow',micros:shadowMicros,ref:rateRef}:costBasis==='receipt'?{basis:'receipt',micros:shadowMicros,ref:rateRef}:{basis:'unknown',reason:'unpriced',exposureMicros:null};
 }else if(status==='released'){q={state:'known',value:0,unit:'call'};c={basis:'receipt',micros:0,ref:rateRef};}
 else{q={state:'unknown',reason:status==='uncertain'?'outcome-unknown':'usage-pending'};c={basis:'unknown',reason:status==='uncertain'?'outcome-unknown':'usage-pending',exposureMicros:reservedMicros};}
 const event={contractVersion,source,sourceEventId,providerEventId:providerEventId??null,revision,idempotencyKey:'',kind:'usage',dimension:'ai.inference.call',workload:'chat-ai',
  workClass:role==='ack'?'control':'task',taskRef,attempt:1,attribution:{scope:'tenant',ownerId:owner,projectId:null,resourceId:null},placementClass:'platform',quantity:q,cost:c,outcome,customerUnits:0,aiTier,
  detail:status==='observed'?{inputTokens:input,outputTokens:output}:{},occurredAt,observedAt};
 event.idempotencyKey=idempotencyKey(event);return event;
}
/** Row shape of inference_calls (src/model-costs.ts). The table keeps no per-status timestamp: observedAt = created_at. */
export function eventFromInferenceCall(row){
 return inferenceEnvelope({status:row.status,sourceEventId:row.id,owner:row.user_id,taskRef:row.turn_id,role:row.role,rateRef:row.rate_id,reservedMicros:row.reserved_micros,
  input:row.input_tokens,output:row.output_tokens,shadowMicros:row.estimated_micros,costBasis:row.cost_basis==='subscription-shadow'?'shadow':'unpriced',
  occurredAt:row.created_at,observedAt:row.created_at,aiTier:'standard',source:'inference-receipt'});
}
/** Row shape of gateway_spend_attempts plus its parsed snapshot and provider receipt. The table keeps no timestamp: the caller supplies them. */
export function eventFromGatewayAttempt(row,{occurredAt,observedAt=occurredAt,providerEventId=null,rateRef}){
 const snapshot=typeof row.snapshot==='string'?JSON.parse(row.snapshot):row.snapshot;
 return inferenceEnvelope({status:row.status==='settled'?'observed':row.status,sourceEventId:row.id,providerEventId,owner:row.user_id,taskRef:row.task_id,role:'orchestrator',rateRef:rateRef??snapshot.rate.id,
  reservedMicros:row.provider_reserved,input:row.input_tokens,output:row.output_tokens,shadowMicros:row.provider_actual,costBasis:'receipt',occurredAt,observedAt,
  aiTier:snapshot.tier==='premium'?'premium':'standard',source:'gateway-settlement'});
}
/** Row shape of storage_project_usage (WH-075). A monotone counter: its value is the revision, so the latest reading wins in any order. */
export function eventFromProjectStorageUsage(row,{ownerId,observedAt}){
 check(isInt(row.read_ops,1),'INVALID_EVENT','read_ops');
 const occurredAt=`${row.period}-01T00:00:00.000Z`;
 const event={contractVersion,source:'storage-operations',sourceEventId:`${row.project_id}:${row.period}:read_ops`,providerEventId:null,revision:row.read_ops,idempotencyKey:'',kind:'usage',
  dimension:'r2.class_b_ops',workload:'storage-files',workClass:'standing',taskRef:null,attempt:1,attribution:{scope:'tenant',ownerId,projectId:row.project_id,resourceId:null},
  placementClass:'platform',quantity:{state:'known',value:row.read_ops,unit:'operation'},cost:{basis:'tariff',tariff:{id:'pool-proposal',version:1}},outcome:'settled',customerUnits:0,aiTier:null,detail:{},occurredAt,observedAt};
 event.idempotencyKey=idempotencyKey(event);return event;
}
