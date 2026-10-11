import assert from 'node:assert/strict';
import {build,transform} from 'esbuild';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

// WH-145 offline conformance harness for approved deterministic-rule authority, run against the source module
// src/connector-catalog/rule-authority.ts (bundled with esbuild). Every decision is made by the source. This file
// supplies only the injected ports: a store with real compare-and-swap semantics (two implementations, below), the
// repository's own canonical digest (connectorDigest from src/connector-receipts.ts), a recorded-acceptance function, a
// clock and an id source. Synthetic catalogs, providers and SYNTHETIC-<KIND>-<NNNN> identifiers only: no database,
// network, OAuth client, credential, model or provider account. It proves the source module against its port contract.
// It does not prove D1 atomicity (the SQL adapter and tables are deferred to the next schema cutover), the WH-052
// envelope resolver, WH-069 rule execution or any real provider's behaviour (WH-031/032/096-100). Every check also
// runs against deliberately broken copies of the source (mutants below), each caught by the check written for it.
const root=fileURLToPath(new URL('..',import.meta.url));
const file='src/connector-catalog/rule-authority.ts';
const read=path=>readFileSync(join(root,path),'utf8');
const entry="export * from './src/connector-catalog/rule-authority';export {connectorCatalog} from './src/connector-catalog/catalog';export {createRequestBuilder} from './src/connector-catalog/builder';export {connectorDigest} from './src/connector-receipts';";
async function load(overrides={},metafile=false){
 const plugin={name:'mutant',setup(b){b.onLoad({filter:/\.ts$/},args=>{const rel=relative(root,args.path).replaceAll('\\','/');if(Object.hasOwn(overrides,rel))return {contents:overrides[rel],loader:'ts'};});}};
 const out=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',plugins:[plugin],metafile});
 const module=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
 return metafile?{module,inputs:Object.keys(out.metafile.inputs)}:module;
}

let total=0,suiteCount=0;
async function test(name,fn){try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}}
const rejects=async(fn,code)=>assert.rejects(async()=>fn(),e=>{assert.equal(e.code,code,`${e.message}`);return true;});

// ---------- Synthetic fixtures ----------
const T0=Date.parse('2026-10-10T10:30:00Z');
const OWNER='SYNTHETIC-OWNER-0001',OTHER='SYNTHETIC-OWNER-0002',REV1='SYNTHETIC-RULE-0001',REV2='SYNTHETIC-RULE-0002';
const CRED='SYNTHETIC-CRED-0001',CRED2='SYNTHETIC-CRED-0002',CAL='SYNTHETIC-CALENDAR-0001',CAL2='SYNTHETIC-CALENDAR-0002';
const secretPattern=/SYNTHETIC-(?:ACCESS|REFRESH|CLIENT)-\d{4}|syn\./;
const template={properties:{email:'{{lead.email}}',firstname:'{{lead.name}}',lifecyclestage:'lead'}};
const calendarTemplate={summary:'{{lead.name}} intro call',start:'{{slot.start}}',end:'{{slot.end}}'};
const zone='0123456789abcdef0123456789abcdef';
const dnsTemplate={type:'CNAME',name:'{{lead.slug}}.example.com',content:'sites.example.com',ttl:300,proxied:false,comment:'whumpo-rule'};
const scopesOf={hubspot:['crm.objects.contacts.write'],'google-calendar':['https://www.googleapis.com/auth/calendar.events.owned'],
 gmail:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send'],cloudflare:['dns.write'],'microsoft-calendar':['Calendars.ReadWrite']};
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);}return value;}
const fingerprint=error=>JSON.stringify({name:error.name,code:error.code,path:error.path,message:error.message});

/** In-memory store implementing the RuleStore port with real compare-and-swap semantics: every method re-reads state
 * after its entry yield and writes in one step. `frozen` hands out deep-frozen copies and keeps its arguments by
 * reference (so a module that mutates an argument after passing it fails loudly). `json` serialises every read and
 * write through JSON text and so catches fields that do not survive a real database round trip. `hostile` flags make a
 * store that ignores a key, to prove that the module re-checks what it was handed. */
function makeStore(mode){
 const approvals=new Map(),credentials=new Map(),counters=new Map(),claims=new Map(),calls=[],hooks=new Map(),hostile={};
 const enc=value=>mode==='json'?JSON.stringify(value):value;
 const dec=value=>value===undefined?undefined:mode==='json'?JSON.parse(value):value;
 const view=value=>value===undefined||value===null?null:mode==='json'?value:deepFreeze(structuredClone(value));
 async function enter(name,args){
  calls.push({name,args:structuredClone(args)});
  await null;
  const hook=hooks.get(name);
  if(hook){hooks.delete(name);await hook(args);}
 }
 const approvalById=id=>[...approvals.keys()].map(key=>dec(approvals.get(key))).find(a=>a.approvalId===id);
 const store={
  calls,hostile,
  /** Runs once, inside the next call of `name`, before that call's compare-and-swap. */
  before(name,fn){hooks.set(name,fn);},
  count:name=>calls.filter(c=>c.name===name).length,
  seedCredential(record){credentials.set(record.id,enc(structuredClone(record)));},
  patchCredential(id,changes){credentials.set(id,enc({...dec(credentials.get(id)),...structuredClone(changes)}));},
  dropCredential(id){credentials.delete(id);},
  seedApproval(record){approvals.set(record.ruleRevisionId,enc(structuredClone(record)));},
  approval:rev=>{const row=dec(approvals.get(rev));return row===undefined?null:structuredClone(row);},
  claim:id=>{const row=dec(claims.get(id));return row===undefined?null:structuredClone(row);},
  counters:()=>Object.fromEntries(counters),
  claimCount:()=>claims.size,
  dump:()=>JSON.stringify({approvals:[...approvals.values()].map(dec),claims:[...claims.values()].map(dec),counters:[...counters]}),
  async insertApproval(approval){
   await enter('insertApproval',approval);
   if(approvals.has(approval.ruleRevisionId))return false;
   approvals.set(approval.ruleRevisionId,enc(approval));return true;
  },
  async loadApproval(ruleRevisionId){
   await enter('loadApproval',{ruleRevisionId});
   const key=hostile.approval?hostile.approval:ruleRevisionId;
   return view(dec(approvals.get(key)));
  },
  async loadCredential(credentialId){
   await enter('loadCredential',{credentialId});
   return view(dec(credentials.get(credentialId)));
  },
  async claimQuota(claim){
   await enter('claimQuota',claim);
   const approval=approvalById(claim.approvalId);
   if(!approval||approval.revokedAt!==null)return 'revoked';
   const key=`${claim.approvalId}|${claim.periodKey}`,used=counters.get(key)??0;
   if(used>=claim.max)return 'exceeded';
   counters.set(key,used+1);
   const {max,...stored}=claim;
   claims.set(claim.claimId,enc({...stored,state:'claimed'}));
   return 'claimed';
  },
  async redeemClaim({ownerId,ruleRevisionId,claimId,now}){
   await enter('redeemClaim',{ownerId,ruleRevisionId,claimId,now});
   const row=dec(claims.get(claimId));
   if(!row||row.state!=='claimed'||row.expiresAt<=now)return null;
   if(!hostile.redeem&&(row.ownerId!==ownerId||row.ruleRevisionId!==ruleRevisionId))return null;
   const approval=dec(approvals.get(row.ruleRevisionId));
   if(!approval||approval.revokedAt!==null)return null;
   claims.set(claimId,enc({...row,state:'used'}));
   const {state,...claim}=row;
   return view(claim);
  },
  async revokeApproval(ownerId,ruleRevisionId,at){
   await enter('revokeApproval',{ownerId,ruleRevisionId,at});
   const approval=dec(approvals.get(ruleRevisionId));
   if(!approval||approval.ownerId!==ownerId)return false;
   if(approval.revokedAt===null){
    approvals.set(ruleRevisionId,enc({...approval,revokedAt:at}));
    for(const [id,raw] of claims){const claim=dec(raw);if(claim.approvalId===approval.approvalId&&claim.state==='claimed')claims.set(id,enc({...claim,state:'voided'}));}
   }
   return true;
  },
 };
 return store;
}

async function suite(m,mode){
 const before=total;
 const synthetic=()=>{
  const c=structuredClone(m.connectorCatalog);
  for(const provider of ['hubspot','google-calendar','gmail'])c.providers[provider].readiness='live-accepted';
  // Rule-eligible actions on providers that are not accepted: one private-test, one synthetic-conformant.
  c.providers.cloudflare.operations['dnsRecord.create'].authority=['owner-request','approved-rule'];
  c.providers['microsoft-calendar'].readiness='synthetic-conformant';
  c.providers['microsoft-calendar'].operations['event.create'].authority=['owner-request','approved-rule'];
  // A rule-eligible action with a typed destination parameter.
  c.providers['google-calendar'].operations['event.create'].authority=['owner-request','approved-rule'];
  return c;
 };
 const clean=value=>{
  const text=value instanceof Error?JSON.stringify({name:value.name,code:value.code,path:value.path,message:value.message}):JSON.stringify(value);
  assert.equal(secretPattern.test(text??''),false,`credential material in ${text}`);
 };
 const attempt=async fn=>{try{const value=await fn();clean(value);return value;}catch(error){clean(error);throw error;}};
 async function env({catalog=synthetic(),accepted=['hubspot.contact.create','google-calendar.event.create'],digest=m.connectorDigest,prefix='id'}={}){
  const clock={t:T0},ids={n:0},store=makeStore(mode),acceptedSet=new Set(accepted);
  const options={...(catalog===null?{}:{catalog}),store,now:()=>clock.t,newId:()=>`${prefix}-${++ids.n}`,acceptance:(provider,operation)=>acceptedSet.has(`${provider}.${operation}`),digest};
  const authority=m.createRuleAuthority(options);
  const e={m,catalog:catalog??m.connectorCatalog,clock,ids,store,options,accepted:acceptedSet,authority};
  e.identity=(id,providerId,account='SYNTHETIC-ACCOUNT-0001')=>m.connectorDigest({credentialId:id,providerId,account});
  e.seed=async({id=CRED,ownerId=OWNER,providerId='hubspot',state='active',scopes=scopesOf[providerId],account,extra={}}={})=>{
    store.seedCredential({id,ownerId,providerId,state,scopes,identityDigest:await e.identity(id,providerId,account),...extra});
  };
  e.principal=(ownerId=OWNER)=>({kind:'owner-request',ownerId});
  e.context=(over={})=>({kind:'deterministic-rule',purpose:'deterministic-rule',ruleRevisionId:REV1,ownerId:OWNER,...over});
  e.approval=(over={})=>({ruleRevisionId:REV1,providerId:'hubspot',operationId:'contact.create',destination:{},bodyTemplate:template,maxPerPeriod:3,period:'hour',credentialId:CRED,...over});
  e.invocation=(over={})=>({providerId:'hubspot',operationId:'contact.create',destination:{},bodyTemplate:template,...over});
  e.calendar=(over={})=>({providerId:'google-calendar',operationId:'event.create',destination:{calendar:CAL},bodyTemplate:calendarTemplate,...over});
  e.approve=(over,principal=e.principal())=>attempt(()=>authority.approve(principal,e.approval(over)));
  e.admit=(invocation,context)=>attempt(()=>authority.admit(e.context(context),e.invocation(invocation)));
  e.claim=(invocation,context)=>attempt(()=>authority.claim(e.context(context),e.invocation(invocation)));
  e.redeem=(claimId,context)=>attempt(()=>authority.redeem(e.context(context),claimId));
  e.revoke=(ruleRevisionId=REV1,principal=e.principal())=>attempt(()=>authority.revokeApproval(principal,ruleRevisionId));
  e.assertClean=()=>{assert.equal(secretPattern.test(store.dump()),false,'credential material in a stored field');assert.equal(secretPattern.test(JSON.stringify(store.calls)),false,'credential material in a port argument');};
  /** Seeds the hubspot credential and approves REV1. */
  e.ready=async(over)=>{await e.seed();return e.approve(over);};
  /** Calls made to the port after this point. */
  e.mark=()=>store.calls.length;
  e.since=(mark)=>store.calls.slice(mark).map(c=>c.name);
  return e;
 }
 const refusedContexts={visitor:'VISITOR_FORBIDDEN','published-site':'PUBLISHED_REQUEST_FORBIDDEN','published-app':'PUBLISHED_REQUEST_FORBIDDEN','quickjs-runtime':'RUNTIME_FORBIDDEN',
  webhook:'WEBHOOK_FORBIDDEN','incoming-message':'WEBHOOK_FORBIDDEN',schedule:'SCHEDULE_WITHOUT_APPROVED_RULE','maintenance-agent':'MAINTENANCE_AGENT_FORBIDDEN',
  'provider-content':'UNTRUSTED_CONTENT_FORBIDDEN','untrusted-content':'UNTRUSTED_CONTENT_FORBIDDEN'};

 // ---------- Approval ----------
 await test('approval binds the operation, destination and template digests, limit, period and credential identity to one revision',async()=>{
  const e=await env();
  const credentialDigest=await e.identity(CRED,'hubspot');
  await e.seed({extra:{accessCiphertext:'syn.SYNTHETIC-ACCESS-0001.x',refreshCiphertext:'syn.SYNTHETIC-REFRESH-0001.y'}});
  const approval=await e.approve();
  assert.deepEqual(Object.keys(approval).sort(),['approvalId','approvedAt','bodyTemplateDigest','credentialId','credentialIdentityDigest','destinationDigest','maxPerPeriod','ownerId','operationId','period','providerId','readinessAtApproval','revokedAt','ruleRevisionId','version'].sort());
  assert.deepEqual({...approval},{version:1,approvalId:'id-1',ruleRevisionId:REV1,ownerId:OWNER,providerId:'hubspot',operationId:'contact.create',
   destinationDigest:await m.connectorDigest({}),bodyTemplateDigest:await m.connectorDigest(template),maxPerPeriod:3,period:'hour',
   credentialId:CRED,credentialIdentityDigest:credentialDigest,readinessAtApproval:'live-accepted',approvedAt:T0,revokedAt:null});
  assert.match(approval.destinationDigest,/^[0-9a-f]{64}$/);assert.match(approval.bodyTemplateDigest,/^[0-9a-f]{64}$/);
  assert.ok(Object.isFrozen(approval));
  assert.deepEqual(e.store.approval(REV1),{...approval});
  // A typed destination parameter is part of the destination digest.
  await e.seed({id:CRED2,providerId:'google-calendar'});
  const cal=await e.approve({ruleRevisionId:REV2,...e.calendar(),credentialId:CRED2});
  assert.equal(cal.destinationDigest,await m.connectorDigest({calendar:CAL}));
  assert.notEqual(cal.destinationDigest,approval.destinationDigest);
  e.assertClean();
 });
 await test('only the current admitted owner principal may approve or revoke',async()=>{
  const e=await env();await e.seed();
  const mark=e.mark();
  const bad=[undefined,null,'owner-request',{},{kind:'owner-request'},{kind:'owner-request',ownerId:OWNER,extra:1},{kind:'visitor',ownerId:OWNER},{kind:'rule',ownerId:OWNER},
   {kind:'maintenance-agent',ownerId:OWNER},{kind:'owner-request',ownerId:'not an id'},{kind:'owner-request',ownerId:7},e.context()];
  for(const principal of bad){
   await rejects(()=>attempt(()=>e.authority.approve(principal,e.approval())),'PRINCIPAL_FORBIDDEN');
   await rejects(()=>attempt(()=>e.authority.revokeApproval(principal,REV1)),'PRINCIPAL_FORBIDDEN');
  }
  assert.deepEqual(e.since(mark),[],'no store call for a refused principal');
 });
 await test('reads, reconciliation and owner-request-only operations cannot be approved, even when the credential holds the scope',async()=>{
  const e=await env();
  await e.seed();await e.seed({id:CRED2,providerId:'gmail'});await e.seed({id:'SYNTHETIC-CRED-0003',providerId:'cloudflare'});
  const mark=e.mark();
  const cases=[
   ['hubspot read',{providerId:'hubspot',operationId:'contacts.search',destination:{}},'RULE_READ_FORBIDDEN'],
   ['reconcile read of the approved action',{providerId:'hubspot',operationId:'contacts.search',destination:{},bodyTemplate:{filterGroups:[],properties:[],limit:1}},'RULE_READ_FORBIDDEN'],
   ['Cloudflare reconcile read',{providerId:'cloudflare',operationId:'zone.get',destination:{zone},bodyTemplate:null,credentialId:'SYNTHETIC-CRED-0003'},'RULE_READ_FORBIDDEN'],
   ['gmail send holds the scope but is owner-request only',{providerId:'gmail',operationId:'message.send',destination:{},bodyTemplate:{raw:'SYNTHETIC-RAW-0001'},credentialId:CRED2},'OWNER_REQUEST_ONLY'],
   ['unknown operation',{providerId:'hubspot',operationId:'contacts.delete',destination:{}},'UNKNOWN_OPERATION'],
   ['inherited property name',{providerId:'hubspot',operationId:'constructor',destination:{}},'UNKNOWN_OPERATION'],
   ['planned provider',{providerId:'outlook-email',operationId:'message.send',destination:{},bodyTemplate:{message:{},saveToSentItems:false}},'PROVIDER_PLANNED'],
   ['unknown provider',{providerId:'slack',operationId:'message.send',destination:{}},'UNKNOWN_PROVIDER'],
   ['inherited provider name',{providerId:'__proto__',operationId:'message.send',destination:{}},'UNKNOWN_PROVIDER'],
  ];
  for(const [,over,code] of cases)await rejects(()=>e.approve(over),code);
  // The same operation becomes approvable only because this suite's catalog declares it rule-eligible (separately gated by readiness).
  const real=await env({catalog:m.connectorCatalog});
  await real.seed({id:'SYNTHETIC-CRED-0003',providerId:'cloudflare'});
  await rejects(()=>real.approve({providerId:'cloudflare',operationId:'dnsRecord.create',destination:{zone},bodyTemplate:dnsTemplate,credentialId:'SYNTHETIC-CRED-0003'}),'OWNER_REQUEST_ONLY');
  assert.equal(e.store.count('insertApproval')+real.store.count('insertApproval'),0);
  assert.equal(e.since(mark).filter(n=>n==='loadCredential').length,0,'eligibility is decided from the catalog before any credential read');
 });
 await test('approval refuses a foreign or unknown credential identically, an inactive or mismatched one, and unusable inputs',async()=>{
  const e=await env();
  await e.seed({id:CRED,ownerId:OTHER});
  const foreign=await e.approve().catch(error=>error);
  const unknown=await e.approve({credentialId:'SYNTHETIC-CRED-9999'}).catch(error=>error);
  assert.equal(foreign.code,'OWNER_MISMATCH');
  assert.equal(fingerprint(foreign),fingerprint(unknown),'one error for an unknown and another owner\'s credential');
  const f=await env();
  await f.seed({providerId:'google-calendar'});
  await rejects(()=>f.approve(),'CREDENTIAL_MISMATCH');
  for(const state of ['reauthorization-required','revoking','revocation-pending','revocation-owner-action','revoked']){
   const g=await env();await g.seed({state});
   await rejects(()=>g.approve(),'CREDENTIAL_NOT_ACTIVE');
  }
  const scoped=await env();await scoped.seed({scopes:[]});
  await rejects(()=>scoped.approve(),'INSUFFICIENT_SCOPE');
  const widened=await env();await widened.seed({scopes:['crm.objects.contacts.write','crm.objects.deals.write']});
  await rejects(()=>widened.approve(),'SCOPE_WIDENED');
  const identity=await env();identity.store.seedCredential({id:CRED,ownerId:OWNER,providerId:'hubspot',state:'active',scopes:scopesOf.hubspot,identityDigest:'SYNTHETIC-IDENT-0001'});
  await rejects(()=>identity.approve(),'INVALID_CREDENTIAL');
  const h=await env();await h.seed();await h.seed({id:CRED2,providerId:'google-calendar'});
  const bad=[
   [{maxPerPeriod:0},'INVALID_LIMIT'],[{maxPerPeriod:101},'INVALID_LIMIT'],[{maxPerPeriod:1.5},'INVALID_LIMIT'],[{maxPerPeriod:'3'},'INVALID_LIMIT'],[{maxPerPeriod:Number.NaN},'INVALID_LIMIT'],
   [{period:'month'},'INVALID_PERIOD'],[{period:undefined},'INVALID_PERIOD'],[{ruleRevisionId:'not an id'},'INVALID_APPROVAL'],[{credentialId:7},'INVALID_APPROVAL'],
   [{destination:{extra:1}},'UNKNOWN_FIELD'],[{destination:null},'INVALID_PARAM'],[{destination:[]},'INVALID_PARAM'],
   [{bodyTemplate:null},'BODY_NOT_ALLOWED'],[{bodyTemplate:undefined},'BODY_NOT_ALLOWED'],[{bodyTemplate:{properties:{},extra:1}},'BODY_NOT_ALLOWED'],[{bodyTemplate:{properties:()=>1}},'BODY_NOT_ALLOWED'],
   [{...e.calendar(),destination:{calendar:'not an id!'},credentialId:CRED2},'INVALID_PARAM'],[{...e.calendar(),destination:{},credentialId:CRED2},'MISSING_FIELD'],
  ];
  for(const [over,code] of bad)await rejects(()=>h.approve(over),code);
  const noKey=h.approval();delete noKey.period;
  await rejects(()=>attempt(()=>h.authority.approve(h.principal(),noKey)),'MISSING_FIELD');
  await rejects(()=>attempt(()=>h.authority.approve(h.principal(),{...h.approval(),inference:{}})),'UNKNOWN_FIELD');
  assert.equal(h.store.count('insertApproval'),0);
 });
 await test('an approval is immutable and a new revision is a new approval with its own binding',async()=>{
  const e=await env();await e.seed();
  const first=await e.approve();
  await rejects(()=>e.approve(),'APPROVAL_EXISTS');
  await rejects(()=>e.approve({maxPerPeriod:100,bodyTemplate:{properties:{email:'{{other}}'}}}),'APPROVAL_EXISTS');
  assert.deepEqual(e.store.approval(REV1),{...first},'the stored approval did not change');
  const second=await e.approve({ruleRevisionId:REV2,bodyTemplate:{properties:{email:'{{lead.email}}',company:'{{lead.company}}'}},maxPerPeriod:5,period:'day'});
  assert.notEqual(second.approvalId,first.approvalId);assert.notEqual(second.bodyTemplateDigest,first.bodyTemplateDigest);
  // Each revision admits only its own template.
  await e.admit({},{ruleRevisionId:REV1});
  await rejects(()=>e.admit({},{ruleRevisionId:REV2}),'TEMPLATE_MISMATCH');
  await e.admit({bodyTemplate:{properties:{email:'{{lead.email}}',company:'{{lead.company}}'}}},{ruleRevisionId:REV2});
  await rejects(()=>e.admit({bodyTemplate:{properties:{email:'{{lead.email}}',company:'{{lead.company}}'}}},{ruleRevisionId:REV1}),'TEMPLATE_MISMATCH');
  // A revision that was never approved is refused: approval is not inherited from the previous revision.
  await rejects(()=>e.admit({},{ruleRevisionId:'SYNTHETIC-RULE-0003'}),'APPROVAL_NOT_FOUND');
 });
 await test('approval on an adapter that is not live-accepted is recorded with its readiness and never admitted',async()=>{
  const e=await env();
  await e.seed({id:CRED2,providerId:'cloudflare'});await e.seed({id:'SYNTHETIC-CRED-0003',providerId:'microsoft-calendar'});
  const dns=await e.approve({ruleRevisionId:REV1,providerId:'cloudflare',operationId:'dnsRecord.create',destination:{zone},bodyTemplate:dnsTemplate,credentialId:CRED2});
  assert.equal(dns.readinessAtApproval,'private-test');
  const ms=await e.approve({ruleRevisionId:REV2,providerId:'microsoft-calendar',operationId:'event.create',destination:{calendar:CAL},bodyTemplate:{subject:'x',start:{},end:{},transactionId:'SYNTHETIC-TX-0001'},credentialId:'SYNTHETIC-CRED-0003'});
  assert.equal(ms.readinessAtApproval,'synthetic-conformant');
  // Even if the acceptance record claims them, catalog readiness below live-accepted refuses before any credential read.
  e.accepted.add('cloudflare.dnsRecord.create');e.accepted.add('microsoft-calendar.event.create');
  const mark=e.mark();
  await rejects(()=>e.admit({providerId:'cloudflare',operationId:'dnsRecord.create',destination:{zone},bodyTemplate:dnsTemplate}),'ADAPTER_NOT_ACCEPTED');
  await rejects(()=>e.claim({providerId:'microsoft-calendar',operationId:'event.create',destination:{calendar:CAL},bodyTemplate:{subject:'x',start:{},end:{},transactionId:'SYNTHETIC-TX-0001'}},{ruleRevisionId:REV2}),'ADAPTER_NOT_ACCEPTED');
  assert.deepEqual(e.since(mark).filter(n=>n!=='loadApproval'),[],'no credential read and no claim');
  assert.deepEqual(e.store.counters(),{});
 });

 // ---------- Admission ----------
 await test('an approved invocation is admitted, consumes nothing, and the full path works with no inference or funding at all',async()=>{
  const e=await env();await e.seed({extra:{accessCiphertext:'syn.SYNTHETIC-ACCESS-0001.x'}});await e.approve();
  // The option set is exactly five ports (plus an optional catalog): there is no inference, model or funding option.
  assert.deepEqual(Object.keys(e.options).sort(),['acceptance','catalog','digest','newId','now','store']);
  const admission=await e.admit();
  assert.deepEqual({...admission},{authority:'approved-rule',approvalId:'id-1',ruleRevisionId:REV1,ownerId:OWNER,providerId:'hubspot',operationId:'contact.create',credentialId:CRED,
   destinationDigest:await m.connectorDigest({}),bodyTemplateDigest:await m.connectorDigest(template),maxPerPeriod:3,period:'hour'});
  assert.ok(Object.isFrozen(admission));
  assert.deepEqual(e.store.counters(),{});assert.equal(e.store.count('claimQuota'),0);
  const claim=await e.claim();
  assert.equal(claim.periodKey,m.rulePeriodKey('hour',T0));assert.equal(claim.expiresAt,T0+60000);assert.equal(claim.credentialId,CRED);
  const used=await e.redeem(claim.claimId);
  assert.deepEqual({...used},{...claim});
  // The admitted request is a real catalog request under approved-rule authority, built by the shared builder.
  const request=m.createRequestBuilder(e.catalog)({providerId:claim.providerId,operationId:claim.operationId,params:{},authority:'approved-rule',grantedScopes:scopesOf.hubspot,body:template});
  assert.equal(request.url,'https://api.hubapi.com/crm/v3/objects/contacts');assert.equal(request.redirect,'manual');
  // The builder agrees on the gates this module owns.
  const builder=m.createRequestBuilder(e.catalog);
  assert.throws(()=>builder({providerId:'gmail',operationId:'message.send',params:{},authority:'approved-rule',grantedScopes:scopesOf.gmail,body:{raw:'x'}}),x=>x.code==='OWNER_REQUEST_ONLY');
  assert.throws(()=>builder({providerId:'hubspot',operationId:'contacts.search',params:{},authority:'approved-rule',grantedScopes:scopesOf.hubspot,body:{filterGroups:[],properties:[],limit:1}}),x=>x.code==='RULE_READ_FORBIDDEN');
  assert.throws(()=>builder({providerId:'cloudflare',operationId:'dnsRecord.create',params:{zone},authority:'approved-rule',grantedScopes:scopesOf.cloudflare,body:dnsTemplate}),x=>x.code==='ADAPTER_NOT_ACCEPTED');
  e.assertClean();
 });
 await test('construction takes no inference, model or funding option and a bad port, digest or catalog is refused',async()=>{
  const e=await env();
  const base=e.options;
  for(const extra of ['inference','model','funding','maintenance','gateway','env','fetch'])
   assert.throws(()=>m.createRuleAuthority({...base,[extra]:()=>{}}),x=>x.code==='UNKNOWN_FIELD',extra);
  for(const missing of ['store','now','newId','acceptance','digest']){const o={...base};delete o[missing];assert.throws(()=>m.createRuleAuthority(o),x=>x.code==='MISSING_FIELD',missing);}
  for(const [key,value] of [['store',null],['now',1],['newId','x'],['acceptance',{}],['digest',null]])assert.throws(()=>m.createRuleAuthority({...base,[key]:value}),x=>x.code==='INVALID_RULE_OPTIONS',key);
  assert.throws(()=>m.createRuleAuthority(null),x=>x.code==='INVALID_SHAPE');
  const widened=structuredClone(e.catalog);widened.providers.hubspot.operations['contact.create'].origin='https://evil.example';
  assert.throws(()=>m.createRuleAuthority({...base,catalog:widened}),x=>x.code==='HOST_NOT_ALLOWED');
  const noRead=structuredClone(e.catalog);noRead.providers.hubspot.operations['contacts.search'].authority=['owner-request','approved-rule'];
  assert.throws(()=>m.createRuleAuthority({...base,catalog:noRead}),x=>x.code==='RULE_READ_FORBIDDEN');
  // The default catalog is the frozen v1 catalog: HubSpot is planned, so its rule candidate is refused.
  const real=await env({catalog:null,accepted:['hubspot.contact.create']});
  await real.seed();
  await rejects(()=>real.approve(),'PROVIDER_PLANNED');
  // A catalog changed after construction does not change the authority's decisions.
  const f=await env();await f.seed();await f.approve();
  f.catalog.providers.hubspot.operations['contact.create'].authority=['owner-request'];
  f.catalog.providers.hubspot.readiness='planned';
  await f.admit();
  // A broken digest port is a refusal, never a stored approval.
  for(const digest of [async()=>'abc',async()=>{throw new Error('boom');},async()=>7]){
   const g=await env({digest});await g.seed();
   await rejects(()=>g.approve(),'DIGEST_UNAVAILABLE');
   assert.equal(g.store.count('insertApproval'),0);
  }
 });
 await test('every refused context kind has its own code and is refused before any store call',async()=>{
  const e=await env();await e.ready();
  const mark=e.mark();
  for(const [kind,code] of Object.entries(refusedContexts)){
   await rejects(()=>e.admit({},{kind}),code);
   await rejects(()=>e.claim({},{kind}),code);
   await rejects(()=>e.redeem('id-1',{kind}),code);
   // A forged purpose does not turn a refused kind into a rule.
   await rejects(()=>e.admit({},{kind,purpose:'deterministic-rule'}),code);
  }
  assert.deepEqual(Object.keys(m.ruleContextRefusals).sort(),Object.keys(refusedContexts).sort());
  assert.equal(new Set(Object.values(refusedContexts)).size,7,'seven distinct refusal codes, plus CONTEXT_FORBIDDEN for anything else');
  const other=[{kind:'owner-request',ownerId:OWNER},{kind:'constructor'},{kind:'__proto__'},{kind:'deterministic-rule'},{purpose:'deterministic-rule'},{kind:'deterministic-rule',purpose:'workspace'},e.context({purpose:'workspace'}),e.context({purpose:'platform-email'}),e.context({kind:'workspace-session'}),
   {kind:'deterministic-rule',purpose:'deterministic-rule',ruleRevisionId:REV1},{kind:'deterministic-rule',purpose:'deterministic-rule',ownerId:OWNER},
   {kind:'deterministic-rule',purpose:'deterministic-rule',ruleRevisionId:'not an id',ownerId:OWNER},{kind:'deterministic-rule',purpose:'deterministic-rule',ruleRevisionId:REV1,ownerId:7}];
  for(const context of other)await rejects(()=>attempt(()=>e.authority.admit(context,e.invocation())),'CONTEXT_FORBIDDEN');
  await rejects(()=>e.admit({},{extra:'visitor'}),'CONTEXT_FORBIDDEN');
  for(const context of [undefined,null,'deterministic-rule',7,[],new (class Context{})()])await rejects(()=>attempt(()=>e.authority.claim(context,e.invocation())),'CONTEXT_FORBIDDEN');
  assert.deepEqual(e.since(mark),[],'no port call, in particular no credential or approval read');
  assert.deepEqual(e.store.counters(),{});
 });
 await test('invocations are strict and reads, reconciliation and owner-request-only operations are refused from rule context before any approval is read',async()=>{
  const e=await env();await e.ready();await e.seed({id:CRED2,providerId:'gmail'});
  // Corrupt or old stored approvals for operations that rules may never use cannot be used either.
  const row=await e.store.approval(REV1);
  e.store.seedApproval({...row,ruleRevisionId:REV2,approvalId:'id-9',providerId:'gmail',operationId:'message.send',credentialId:CRED2});
  e.store.seedApproval({...row,ruleRevisionId:'SYNTHETIC-RULE-0003',approvalId:'id-10',operationId:'contacts.search'});
  e.store.seedApproval({...row,ruleRevisionId:'SYNTHETIC-RULE-0004',approvalId:'id-11',providerId:'cloudflare',operationId:'zone.get',credentialId:CRED});
  const mark=e.mark();
  await rejects(()=>e.admit({providerId:'gmail',operationId:'message.send',bodyTemplate:{raw:'SYNTHETIC-RAW-0001'}},{ruleRevisionId:REV2}),'OWNER_REQUEST_ONLY');
  await rejects(()=>e.claim({providerId:'gmail',operationId:'message.send',bodyTemplate:{raw:'SYNTHETIC-RAW-0001'}},{ruleRevisionId:REV2}),'OWNER_REQUEST_ONLY');
  await rejects(()=>e.admit({operationId:'contacts.search',bodyTemplate:{filterGroups:[],properties:[],limit:1}},{ruleRevisionId:'SYNTHETIC-RULE-0003'}),'RULE_READ_FORBIDDEN');
  await rejects(()=>e.claim({operationId:'contacts.search',bodyTemplate:{filterGroups:[],properties:[],limit:1}},{ruleRevisionId:'SYNTHETIC-RULE-0003'}),'RULE_READ_FORBIDDEN');
  await rejects(()=>e.admit({providerId:'cloudflare',operationId:'zone.get',destination:{zone},bodyTemplate:null},{ruleRevisionId:'SYNTHETIC-RULE-0004'}),'RULE_READ_FORBIDDEN');
  await rejects(()=>e.admit({providerId:'outlook-email',operationId:'message.send'}),'PROVIDER_PLANNED');
  assert.deepEqual(e.since(mark),[],'decided from the catalog alone');
  // Invocation shape.
  for(const [invocation,code] of [[undefined,'INVALID_SHAPE'],[null,'INVALID_SHAPE'],['hubspot','INVALID_SHAPE'],[{},'MISSING_FIELD'],[{providerId:'hubspot'},'MISSING_FIELD'],
   [{...e.invocation(),extra:1},'UNKNOWN_FIELD'],[{...e.invocation(),credentialId:CRED},'UNKNOWN_FIELD']])
   await rejects(()=>attempt(()=>e.authority.admit(e.context(),invocation)),code);
  // The approved operation, named with another provider or operation, is a mismatch.
  await e.seed({id:'SYNTHETIC-CRED-0003',providerId:'google-calendar'});
  await rejects(()=>e.admit(e.calendar()),'OPERATION_MISMATCH');
 });
 await test('approvals are not an existence oracle between owners: unknown, foreign and revoked-by-other are indistinguishable',async()=>{
  const e=await env();await e.ready();
  const unknown=await e.admit({},{ruleRevisionId:'SYNTHETIC-RULE-0009'}).catch(error=>error);
  const foreign=await e.admit({},{ownerId:OTHER}).catch(error=>error);
  assert.equal(unknown.code,'APPROVAL_NOT_FOUND');assert.equal(fingerprint(unknown),fingerprint(foreign));
  const claimUnknown=await e.claim({},{ruleRevisionId:'SYNTHETIC-RULE-0009'}).catch(error=>error);
  const claimForeign=await e.claim({},{ownerId:OTHER}).catch(error=>error);
  assert.equal(fingerprint(claimUnknown),fingerprint(claimForeign));
  const revokeUnknown=await e.revoke('SYNTHETIC-RULE-0009').catch(error=>error);
  const revokeForeign=await e.revoke(REV1,e.principal(OTHER)).catch(error=>error);
  assert.equal(revokeUnknown.code,'APPROVAL_NOT_FOUND');assert.equal(fingerprint(revokeUnknown),fingerprint(revokeForeign));
  assert.equal(e.store.approval(REV1).revokedAt,null,'another owner could not revoke it');
  // The redeem error is one code for unknown and foreign claims too.
  const own=await e.claim();
  const redeemForeign=await e.redeem(own.claimId,{ownerId:OTHER}).catch(error=>error);
  const redeemUnknown=await e.redeem('id-999').catch(error=>error);
  assert.equal(redeemForeign.code,'CLAIM_NOT_REDEEMABLE');assert.equal(fingerprint(redeemForeign),fingerprint(redeemUnknown));
  // The foreign attempt did not consume the owner's claim.
  assert.equal((await e.redeem(own.claimId)).claimId,own.claimId);
 });
 await test('the revision and owner are compared again on the loaded approval, whatever a store returns',async()=>{
  const e=await env();await e.ready();
  await e.approve({ruleRevisionId:REV2,bodyTemplate:{properties:{email:'{{lead.email}}'}}});
  // A store that answers every lookup with REV1's approval is not believed for REV2.
  e.store.hostile.approval=REV1;
  await rejects(()=>e.admit({},{ruleRevisionId:REV2}),'APPROVAL_NOT_FOUND');
  await rejects(()=>e.claim({},{ownerId:OTHER}),'APPROVAL_NOT_FOUND');
  // A store that does not enforce owner or revision on redeem is not believed either.
  delete e.store.hostile.approval;
  e.store.hostile.redeem=true;
  const claim=await e.claim();
  await rejects(()=>e.redeem(claim.claimId,{ruleRevisionId:REV2}),'CLAIM_NOT_REDEEMABLE');
  await rejects(()=>e.redeem('id-777',{ownerId:OTHER}),'CLAIM_NOT_REDEEMABLE');
 });
 await test('a stale stored approval version is refused explicitly',async()=>{
  const e=await env();await e.ready();
  e.store.seedApproval({...e.store.approval(REV1),version:0});
  await rejects(()=>e.admit(),'UNSUPPORTED_VERSION');
  await rejects(()=>e.claim(),'UNSUPPORTED_VERSION');
 });
 await test('catalog readiness is not enough: the recorded acceptance is required, and acceptance is not enough without catalog readiness',async()=>{
  const e=await env();await e.ready();
  await e.admit();
  // No acceptance record for the operation.
  e.accepted.clear();
  const mark=e.mark();
  await rejects(()=>e.admit(),'ADAPTER_NOT_ACCEPTED');
  await rejects(()=>e.claim(),'ADAPTER_NOT_ACCEPTED');
  assert.deepEqual(e.since(mark).filter(n=>n!=='loadApproval'),[],'refused before any credential read or claim');
  // Another operation's acceptance does not cover this one.
  e.accepted.add('google-calendar.event.create');
  await rejects(()=>e.admit(),'ADAPTER_NOT_ACCEPTED');
  // An acceptance lookup that fails, or answers loosely, is a refusal.
  for(const acceptance of [()=>{throw new Error('lookup failed');},async()=>{throw new Error('lookup failed');},()=>'yes',()=>1,()=>undefined]){
   const f=await env();await f.ready();
   const g=m.createRuleAuthority({...f.options,acceptance});
   await rejects(()=>attempt(()=>g.admit(f.context(),f.invocation())),'ADAPTER_NOT_ACCEPTED');
  }
  // Acceptance without catalog readiness (private-test) is also refused.
  const lower=synthetic();lower.providers.hubspot.readiness='private-test';
  const h=await env({catalog:lower});await h.seed();
  assert.equal((await h.approve()).readinessAtApproval,'private-test');
  await rejects(()=>h.admit(),'ADAPTER_NOT_ACCEPTED');
  assert.equal(h.store.count('claimQuota'),0);
 });
 await test('destination and body template must match the approval exactly, and a mismatch consumes nothing',async()=>{
  const e=await env();await e.seed({id:CRED2,providerId:'google-calendar'});
  await e.approve({...e.calendar(),credentialId:CRED2});
  const cal=over=>({...e.calendar(),...over});
  const ok=await e.admit(e.calendar());
  assert.equal(ok.operationId,'event.create');
  // Object key order never changes a digest (the repository's canonical form), a value or shape change does.
  await e.admit(cal({bodyTemplate:{end:'{{slot.end}}',start:'{{slot.start}}',summary:'{{lead.name}} intro call'}}));
  const mark=e.mark();
  await rejects(()=>e.admit(cal({destination:{calendar:CAL2}})),'DESTINATION_MISMATCH');
  await rejects(()=>e.claim(cal({destination:{calendar:CAL2}})),'DESTINATION_MISMATCH');
  await rejects(()=>e.admit(cal({bodyTemplate:{...calendarTemplate,attendees:[{email:'{{lead.email}}'}]}})),'TEMPLATE_MISMATCH');
  await rejects(()=>e.claim(cal({bodyTemplate:{...calendarTemplate,summary:'{{lead.name}} sales call'}})),'TEMPLATE_MISMATCH');
  await rejects(()=>e.admit(cal({bodyTemplate:{summary:'{{lead.name}} intro call',start:'{{slot.start}}'}})),'TEMPLATE_MISMATCH');
  await rejects(()=>e.admit(cal({bodyTemplate:{...calendarTemplate,id:7}})),'TEMPLATE_MISMATCH');
  // Typed parameters and the body are still validated by the builder, with the credential's real scopes.
  await rejects(()=>e.admit(cal({destination:{calendar:'not an id!'}})),'INVALID_PARAM');
  await rejects(()=>e.admit(cal({destination:{}})),'MISSING_FIELD');
  await rejects(()=>e.admit(cal({bodyTemplate:null})),'BODY_NOT_ALLOWED');
  await rejects(()=>e.admit(cal({bodyTemplate:{...calendarTemplate,body:'x'}})),'BODY_NOT_ALLOWED');
  assert.equal(e.since(mark).includes('claimQuota'),false);
  assert.deepEqual(e.store.counters(),{});assert.equal(e.store.claimCount(),0);
 });
 await test('a changed, replaced or disconnected credential is refused before any claim',async()=>{
  const e=await env();await e.ready();
  await e.admit();
  // A refresh changes custody fields but not the connection identity.
  e.store.patchCredential(CRED,{generation:5,accessExpiresAt:T0+1000});
  await e.admit();
  e.store.patchCredential(CRED,{scopes:[]});
  await rejects(()=>e.admit(),'INSUFFICIENT_SCOPE');
  e.store.patchCredential(CRED,{scopes:scopesOf.hubspot});
  for(const state of ['reauthorization-required','revoking','revocation-pending','revocation-owner-action','revoked']){
   e.store.patchCredential(CRED,{state});
   await rejects(()=>e.admit(),'CREDENTIAL_NOT_ACTIVE');
   await rejects(()=>e.claim(),'CREDENTIAL_NOT_ACTIVE');
  }
  e.store.patchCredential(CRED,{state:'active'});
  await e.admit();
  // Reconnected to another account: same credential id, different identity.
  e.store.patchCredential(CRED,{identityDigest:await e.identity(CRED,'hubspot','SYNTHETIC-ACCOUNT-0002')});
  await rejects(()=>e.admit(),'CREDENTIAL_CHANGED');
  e.store.patchCredential(CRED,{identityDigest:await e.identity(CRED,'hubspot')});
  e.store.patchCredential(CRED,{ownerId:OTHER});
  await rejects(()=>e.admit(),'CREDENTIAL_CHANGED');
  e.store.patchCredential(CRED,{ownerId:OWNER,providerId:'gmail'});
  await rejects(()=>e.admit(),'CREDENTIAL_CHANGED');
  e.store.patchCredential(CRED,{providerId:'hubspot'});
  e.store.dropCredential(CRED);
  await rejects(()=>e.admit(),'CREDENTIAL_CHANGED');
  await rejects(()=>e.claim(),'CREDENTIAL_CHANGED');
  assert.equal(e.store.count('claimQuota'),0);
 });

 // ---------- Claim, limit, revocation ----------
 await test('the limit is enforced at claim: the fourth claim is refused and a refused claim consumes nothing',async()=>{
  const e=await env();await e.ready();
  const claims=[];
  for(let i=0;i<3;i++)claims.push(await e.claim());
  assert.equal(new Set(claims.map(c=>c.claimId)).size,3);
  assert.deepEqual(e.store.counters(),{[`id-1|hour:${Math.floor(T0/3600000)}`]:3});
  for(let i=0;i<3;i++)await rejects(()=>e.claim(),'RULE_LIMIT_EXCEEDED');
  assert.deepEqual(Object.values(e.store.counters()),[3]);assert.equal(e.store.claimCount(),3);
  // Admission alone is still allowed and consumes nothing.
  await e.admit();
  assert.deepEqual(Object.values(e.store.counters()),[3]);
  // A limit of one.
  const f=await env();await f.seed();await f.approve({maxPerPeriod:1});
  await f.claim();await rejects(()=>f.claim(),'RULE_LIMIT_EXCEEDED');
  e.assertClean();
 });
 await test('concurrent claims never exceed the limit, across callers sharing one store',async()=>{
  const e=await env();await e.ready();
  const other=m.createRuleAuthority({...e.options,newId:(()=>{let n=0;return()=>`other-${++n}`;})()});
  const run=(authority,n)=>Array.from({length:n},()=>authority.claim(e.context(),e.invocation()).then(value=>({value}),error=>({error})));
  const results=await Promise.all([...run(e.authority,8),...run(other,8)]);
  assert.equal(results.filter(r=>r.value).length,3);
  assert.equal(results.filter(r=>r.error&&r.error.code==='RULE_LIMIT_EXCEEDED').length,13);
  assert.deepEqual(Object.values(e.store.counters()),[3]);assert.equal(e.store.claimCount(),3);
  assert.equal(new Set(results.filter(r=>r.value).map(r=>r.value.claimId)).size,3);
 });
 await test('the period is derived from the injected clock and a new window starts a new count',async()=>{
  const e=await env();await e.ready();
  for(let i=0;i<3;i++)await e.claim();
  await rejects(()=>e.claim(),'RULE_LIMIT_EXCEEDED');
  e.clock.t=Date.parse('2026-10-10T10:59:59.999Z');
  await rejects(()=>e.claim(),'RULE_LIMIT_EXCEEDED');
  e.clock.t=Date.parse('2026-10-10T11:00:00Z');
  const next=await e.claim();
  assert.equal(next.periodKey,m.rulePeriodKey('hour',e.clock.t));assert.notEqual(next.periodKey,m.rulePeriodKey('hour',T0));
  await e.claim();await e.claim();await rejects(()=>e.claim(),'RULE_LIMIT_EXCEEDED');
  // The earlier window keeps its count when the clock is read there again.
  e.clock.t=T0;
  await rejects(()=>e.claim(),'RULE_LIMIT_EXCEEDED');
  // Day and week windows are UTC aligned; a week starts on Monday.
  const d=await env();await d.seed();await d.approve({period:'day',maxPerPeriod:1});
  await d.claim();
  d.clock.t=Date.parse('2026-10-10T23:59:59Z');await rejects(()=>d.claim(),'RULE_LIMIT_EXCEEDED');
  d.clock.t=Date.parse('2026-10-11T00:00:00Z');await d.claim();
  const w=await env();await w.seed();await w.approve({period:'week',maxPerPeriod:1});
  await w.claim();
  w.clock.t=Date.parse('2026-10-11T23:59:59Z');await rejects(()=>w.claim(),'RULE_LIMIT_EXCEEDED');
  w.clock.t=Date.parse('2026-10-12T00:00:00Z');await w.claim();
  assert.equal(m.rulePeriodKey('week',Date.parse('2026-10-12T00:00:00Z')),m.rulePeriodKey('week',Date.parse('2026-10-18T23:59:59Z')));
  assert.notEqual(m.rulePeriodKey('week',Date.parse('2026-10-11T23:59:59Z')),m.rulePeriodKey('week',Date.parse('2026-10-12T00:00:00Z')));
  assert.throws(()=>m.rulePeriodKey('month',T0),x=>x.code==='INVALID_PERIOD');
  assert.throws(()=>m.rulePeriodKey('hour',-1),x=>x.code==='INVALID_CLOCK');
  // A broken clock is a refusal at every entry point.
  for(const value of [Number.NaN,-1,1.5,'now']){
   const f=await env();await f.seed();f.clock.t=T0;
   await f.approve();f.clock.t=value;
   await rejects(()=>f.claim(),'INVALID_CLOCK');
   await rejects(()=>f.redeem('id-1'),'INVALID_CLOCK');
   await rejects(()=>f.revoke(),'INVALID_CLOCK');
   assert.equal(f.store.count('claimQuota'),0);
  }
 });
 await test('limits are per approval: a new revision has its own count and the first revision\'s exhaustion does not spend it',async()=>{
  const e=await env();await e.ready({maxPerPeriod:1});
  await e.approve({ruleRevisionId:REV2,maxPerPeriod:2});
  await e.claim();await rejects(()=>e.claim(),'RULE_LIMIT_EXCEEDED');
  await e.claim({},{ruleRevisionId:REV2});await e.claim({},{ruleRevisionId:REV2});
  await rejects(()=>e.claim({},{ruleRevisionId:REV2}),'RULE_LIMIT_EXCEEDED');
  assert.deepEqual(Object.values(e.store.counters()).sort(),[1,2]);
 });
 await test('a claim token is usable once, only by its own revision and owner, and only until it expires',async()=>{
  const e=await env();await e.ready();
  const claim=await e.claim();
  const used=await e.redeem(claim.claimId);
  assert.deepEqual({...used},{...claim});assert.ok(Object.isFrozen(used));
  await rejects(()=>e.redeem(claim.claimId),'CLAIM_NOT_REDEEMABLE');
  await rejects(()=>e.redeem('not a claim id!'),'CLAIM_NOT_REDEEMABLE');
  const fresh=await e.claim();
  await rejects(()=>e.redeem(fresh.claimId,{ownerId:OTHER}),'CLAIM_NOT_REDEEMABLE');
  await e.approve({ruleRevisionId:REV2});
  await rejects(()=>e.redeem(fresh.claimId,{ruleRevisionId:REV2}),'CLAIM_NOT_REDEEMABLE');
  assert.equal((await e.redeem(fresh.claimId)).claimId,fresh.claimId,'refused attempts did not consume it');
  // Expiry: redeemable up to, not at, the lease end.
  const late=await e.claim();
  e.clock.t=T0+60000;
  await rejects(()=>e.redeem(late.claimId),'CLAIM_NOT_REDEEMABLE');
  const edge=await env();await edge.ready();
  const near=await edge.claim();edge.clock.t=T0+59999;
  assert.equal((await edge.redeem(near.claimId)).claimId,near.claimId);
  // Concurrent redemption: exactly one wins.
  const race=await env();await race.ready();
  const token=await race.claim();
  const results=await Promise.all(Array.from({length:6},()=>race.redeem(token.claimId).then(value=>({value}),error=>({error}))));
  assert.equal(results.filter(r=>r.value).length,1);
  for(const r of results.filter(r=>r.error))assert.equal(r.error.code,'CLAIM_NOT_REDEEMABLE');
 });
 await test('revocation voids the approval and every unredeemed claim, is idempotent, and later admission and claims fail',async()=>{
  const e=await env();await e.ready();
  await e.approve({ruleRevisionId:REV2});
  const redeemed=await e.claim(),pending=await e.claim();
  await e.redeem(redeemed.claimId);
  assert.deepEqual({...await e.revoke()},{ruleRevisionId:REV1,state:'revoked'});
  assert.equal(e.store.approval(REV1).revokedAt,T0);
  e.clock.t=T0+5000;
  await e.revoke();
  assert.equal(e.store.approval(REV1).revokedAt,T0,'a repeat changes nothing');
  await rejects(()=>e.admit(),'APPROVAL_REVOKED');
  await rejects(()=>e.claim(),'APPROVAL_REVOKED');
  await rejects(()=>e.redeem(pending.claimId),'CLAIM_NOT_REDEEMABLE');
  assert.equal(e.store.claim(pending.claimId).state,'voided');assert.equal(e.store.claim(redeemed.claimId).state,'used','a dispatched claim cannot be recalled');
  await rejects(()=>e.approve(),'APPROVAL_EXISTS');
  // Another revision is untouched.
  await e.admit({},{ruleRevisionId:REV2});
  await rejects(()=>e.revoke('SYNTHETIC-RULE-0009'),'APPROVAL_NOT_FOUND');
  // A claim racing a revocation loses and consumes nothing.
  const f=await env();await f.ready();
  f.store.before('claimQuota',()=>f.authority.revokeApproval(f.principal(),REV1));
  await rejects(()=>f.claim(),'APPROVAL_REVOKED');
  assert.deepEqual(f.store.counters(),{});assert.equal(f.store.claimCount(),0);
  // Revocation racing a redemption: whichever commits first wins, and a redeemed request is not recalled.
  const g=await env();await g.ready();
  const claim=await g.claim();
  g.store.before('redeemClaim',()=>g.authority.revokeApproval(g.principal(),REV1));
  await rejects(()=>g.redeem(claim.claimId),'CLAIM_NOT_REDEEMABLE');
 });
 await test('no credential material reaches an approval, claim, error or port argument',async()=>{
  const e=await env();
  await e.seed({extra:{accessCiphertext:'syn.SYNTHETIC-ACCESS-0001.x',refreshCiphertext:'syn.SYNTHETIC-REFRESH-0001.y',clientSecret:'SYNTHETIC-CLIENT-0001'}});
  await e.approve();
  const claim=await e.claim();await e.redeem(claim.claimId);
  for(const probe of [()=>e.admit({destination:{extra:1}}),()=>e.claim({},{kind:'visitor'}),()=>e.approve({credentialId:'SYNTHETIC-CRED-9999'}),()=>e.redeem('id-404')])await probe().catch(()=>{});
  e.assertClean();
  assert.equal(JSON.stringify(e.store.calls).includes('Ciphertext'),false);
 });
 return total-before;
}

// ---------- Run the suite against both store implementations ----------
const real=await load();
const frozen=await suite(real,'frozen');
const jsonRun=await suite(real,'json');
suiteCount=frozen;
assert.equal(jsonRun,frozen);

// ---------- Static checks, run once ----------
await test('the module imports only the catalog and the builder, has no timer, network, storage, log or inference API and a five-operation surface',async()=>{
 const text=read(file);
 const code=(await transform(text,{loader:'ts',legalComments:'none'})).code;
 const specifiers=[...code.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
 assert.deepEqual(specifiers.sort(),['./builder','./catalog'],'runtime imports (type-only imports are erased)');
 const typeOnly=[...text.matchAll(/^import type [^;]+ from '([^']+)'/gm)].map(x=>x[1]);
 assert.deepEqual(typeOnly,['../connector-receipts']);
 assert.ok(!/\bset(?:Timeout|Interval|Immediate)\b|\bqueueMicrotask\b|\bscheduled\b|\bcron\b|\bkeep-?alive\b|\bWorkflow\b|\balarm\b|\bDate\b|\bperformance\b/i.test(code),'no timer, scheduler, keep-alive or wall clock');
 assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env|D1Database|\.prepare\(|\benv\.[A-Z_]+|console\.|\bcrypto\.subtle\b|\bcrypto\.getRandomValues\b|\bMath\.random\b/.test(code),'no network, database, environment, log, crypto or randomness');
 assert.ok(!/\bimport\s+[^;]*\b(?:inference|gateway|ai-chat|ai-gateway|maintenance|openai)\b/i.test(text.replace(/^\s*\*.*$/gm,'')),'no inference import');
 assert.deepEqual(Object.keys(real).sort(),['connectorCatalog','connectorDigest','createRequestBuilder','createRuleAuthority','ruleContextRefusals','ruleContractVersion','ruleLimits','rulePeriodKey','rulePeriods']);
 const authority=real.createRuleAuthority({store:{},now:()=>T0,newId:()=>'x',acceptance:()=>false,digest:real.connectorDigest});
 assert.deepEqual(Object.keys(authority).sort(),['admit','approve','claim','redeem','revokeApproval']);
 assert.ok(Object.isFrozen(authority)&&Object.isFrozen(real.ruleLimits)&&Object.isFrozen(real.ruleContextRefusals)&&Object.isFrozen(real.rulePeriods));
 assert.deepEqual([...real.rulePeriods],['hour','day','week']);
});
await test('the bundle reaches only the catalog, the builder and the shared digest: no inference, index, database or Worker module',async()=>{
 const {inputs}=await load({},true);
 const reached=inputs.filter(p=>p.includes('src/')).sort();
 assert.deepEqual(reached,['src/connector-catalog/builder.ts','src/connector-catalog/catalog.ts','src/connector-catalog/rule-authority.ts','src/connector-receipts.ts','src/security.ts']);
 // The module's own graph, without the suite's digest export, is the three connector-catalog files.
 const own=await build({entryPoints:[join(root,file)],bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',metafile:true});
 assert.deepEqual(Object.keys(own.metafile.inputs).sort(),['src/connector-catalog/builder.ts','src/connector-catalog/catalog.ts','src/connector-catalog/rule-authority.ts']);
});
await test('no Worker module imports the rule-authority module (unwired until the adapter and WH-069 exist)',async()=>{
 const importers=[];
 const walk=dir=>{for(const name of readdirSync(join(root,dir))){const rel=`${dir}/${name}`;if(statSync(join(root,rel)).isDirectory())walk(rel);else if(/\.(?:ts|tsx|mjs)$/.test(name)&&/rule-authority/.test(read(rel))&&rel!==file)importers.push(rel);}};
 walk('src');
 assert.deepEqual(importers,[]);
});

// ---------- Mutation check: each deliberately broken copy of the source must fail the suite ----------
const mutants=[
 ['owner principal kind not checked',"check(plain(principal)&&principal.kind==='owner-request'&&Object.keys(principal).length===2","check(plain(principal)&&Object.keys(principal).length===2"],
 ['reads and reconciliation allowed',"check(op.kind==='action','RULE_READ_FORBIDDEN',operationId);",""],
 ['owner-request-only operations allowed',"check(op.authority.includes('approved-rule'),'OWNER_REQUEST_ONLY',operationId);",""],
 ['refused context kinds fall through',"if(typeof kind==='string'&&Object.hasOwn(ruleContextRefusals,kind))throw new ConnectorContractError(ruleContextRefusals[kind],'context');",""],
 ['context purpose not checked',"context.kind==='deterministic-rule'&&context.purpose==='deterministic-rule'&&Object.keys(context)","context.kind==='deterministic-rule'&&Object.keys(context)"],
 ['approval owner not compared',"approval.ruleRevisionId===ruleRevisionId&&approval.ownerId===ownerId,'APPROVAL_NOT_FOUND'","approval.ruleRevisionId===ruleRevisionId,'APPROVAL_NOT_FOUND'"],
 ['approval revision not compared',"approval!==null&&approval.ruleRevisionId===ruleRevisionId&&approval.ownerId===ownerId","approval!==null&&approval.ownerId===ownerId"],
 ['revoked approval admitted',"check(approval.revokedAt===null,'APPROVAL_REVOKED','approval');",""],
 ['approved operation not compared',"check(approval.providerId===providerId&&approval.operationId===operationId,'OPERATION_MISMATCH',operationId);",""],
 ['catalog readiness alone is enough',"entry.readiness==='live-accepted'&&await accepted(providerId,operationId)","entry.readiness==='live-accepted'"],
 ['recorded acceptance alone is enough',"entry.readiness==='live-accepted'&&await accepted(providerId,operationId)","await accepted(providerId,operationId)"],
 ['destination digest not compared',"check(destinationDigest===approval.destinationDigest,'DESTINATION_MISMATCH',operationId);",""],
 ['template digest not compared',"check(bodyTemplateDigest===approval.bodyTemplateDigest,'TEMPLATE_MISMATCH',operationId);",""],
 ['credential identity not compared',"&&credential.providerId===approval.providerId&&credential.identityDigest===approval.credentialIdentityDigest,","&&credential.providerId===approval.providerId,"],
 ['inactive credential admitted',"check(credential.state==='active','CREDENTIAL_NOT_ACTIVE',providerId);\n  wellFormed(providerId,operationId,invocation.destination","wellFormed(providerId,operationId,invocation.destination"],
 ['limit not applied at claim',"const result=await store.claimQuota({...token,max:admission.maxPerPeriod});","const result=await store.claimQuota({...token,max:Number.MAX_SAFE_INTEGER});"],
 ['refused claim result ignored',"if(result!=='claimed')throw new ConnectorContractError(result==='exceeded'?'RULE_LIMIT_EXCEEDED':'APPROVAL_REVOKED',admission.operationId);",""],
 ['revoked disposition treated as claimed',"if(result!=='claimed')throw","if(result!=='claimed'&&result!=='revoked')throw"],
 ['period ignores the clock',"periodKey:rulePeriodKey(admission.period,at),","periodKey:rulePeriodKey(admission.period,0),"],
 ['claim never expires',"expiresAt:at+ruleLimits.claimTtlMs,","expiresAt:at+ruleLimits.claimTtlMs*1000000,"],
 ['claim redeemed by another revision',"stored.ownerId===ownerId&&stored.ruleRevisionId===ruleRevisionId,'CLAIM_NOT_REDEEMABLE'","stored.ownerId===ownerId,'CLAIM_NOT_REDEEMABLE'"],
 ['unknown options accepted',"shape(options,['store','now','newId','acceptance','digest'],'rule-authority',['catalog']);","check(plain(options),'INVALID_SHAPE','rule-authority');"],
 ['immutable approval overwritten',"check(await store.insertApproval(approval),'APPROVAL_EXISTS','approval');","await store.insertApproval(approval);"],
 ['builder validation skipped at admission',"wellFormed(providerId,operationId,invocation.destination,invocation.bodyTemplate,credential.scopes);",""],
];
const expected={
 'owner principal kind not checked':'only the current admitted owner principal may approve or revoke',
 'reads and reconciliation allowed':'reads, reconciliation and owner-request-only operations cannot be approved',
 'owner-request-only operations allowed':'reads, reconciliation and owner-request-only operations cannot be approved',
 'refused context kinds fall through':'every refused context kind has its own code',
 'context purpose not checked':'every refused context kind has its own code',
 'approval owner not compared':'approvals are not an existence oracle between owners',
 'approval revision not compared':'the revision and owner are compared again on the loaded approval',
 'revoked approval admitted':'revocation voids the approval and every unredeemed claim',
 'approved operation not compared':'invocations are strict and reads, reconciliation',
 'catalog readiness alone is enough':'catalog readiness is not enough',
 'recorded acceptance alone is enough':'approval on an adapter that is not live-accepted is recorded',
 'destination digest not compared':'destination and body template must match the approval exactly',
 'template digest not compared':'an approval is immutable and a new revision is a new approval',
 'credential identity not compared':'a changed, replaced or disconnected credential is refused',
 'inactive credential admitted':'a changed, replaced or disconnected credential is refused',
 'limit not applied at claim':'the limit is enforced at claim',
 'refused claim result ignored':'the limit is enforced at claim',
 'revoked disposition treated as claimed':'revocation voids the approval and every unredeemed claim',
 'period ignores the clock':'an approved invocation is admitted, consumes nothing',
 'claim never expires':'an approved invocation is admitted, consumes nothing',
 'claim redeemed by another revision':'the revision and owner are compared again on the loaded approval',
 'unknown options accepted':'construction takes no inference, model or funding option',
 'immutable approval overwritten':'an approval is immutable and a new revision is a new approval',
 'builder validation skipped at admission':'destination and body template must match the approval exactly',
};
let killed=0;
const source=read(file);
const explain=process.argv.includes('--explain');
for(const [name,find,replace] of mutants){
 assert.equal(source.split(find).length,2,`mutant "${name}" must match ${file} exactly once`);
 const mutant=await load({[file]:source.replace(find,()=>replace)}).catch(error=>{throw new Error(`mutant "${name}" does not bundle`,{cause:error});});
 await assert.rejects(suite(mutant,'frozen'),e=>{
  if(explain)console.log(`${name} => ${e.message}${e.cause?' / '+String(e.cause.message).slice(0,160):''}`);
  if(explain&&!Object.hasOwn(expected,name))return true;
  assert.ok(Object.hasOwn(expected,name)&&e.message.startsWith(expected[name]),`mutant "${name}" was caught by an unexpected check: ${e.message}${e.cause?' / '+e.cause.message:''}`);return true;
 },`mutant survived: ${name}`);
 killed++;
}
assert.equal(killed,mutants.length);
console.log(`connector-rule-authority: ${suiteCount} source checks on each of 2 store implementations (frozen views and JSON round trips) and 3 static checks passed against src/connector-catalog/rule-authority.ts; ${killed}/${mutants.length} source mutants caught (synthetic catalogs and identifiers; no database, network, credential or model).`);
