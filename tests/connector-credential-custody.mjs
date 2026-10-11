import assert from 'node:assert/strict';
import {build,transform} from 'esbuild';
import {readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

// WH-144 offline conformance harness for single-flight refresh custody and honest revocation, run against the source
// module src/connector-catalog/credential-custody.ts (bundled with esbuild). Every decision is made by the source. This
// file supplies only the injected ports: a store with real compare-and-swap semantics (two implementations, below), a
// synthetic AES-GCM vault, a scripted token/revocation provider, a clock and an id source. Synthetic providers and
// SYNTHETIC-<KIND>-<NNNN> tokens only: no database, network, OAuth client, credential, model or provider account. It
// proves the source module against its port contract. It does not prove D1 atomicity (the SQL adapter and tables are
// deferred to the next schema cutover) or any real provider's behaviour (WH-031/032/096-100). Every check also runs
// against deliberately broken copies of the source (mutants below), each caught by the check written for it.
const root=fileURLToPath(new URL('..',import.meta.url));
const file='src/connector-catalog/credential-custody.ts';
const read=path=>readFileSync(join(root,path),'utf8');
const entry="export * from './src/connector-catalog/credential-custody';export {catalogVaultContext,connectorCatalog,connectorVaultContext} from './src/connector-catalog/catalog';";
async function load(overrides={}){
 const plugin={name:'mutant',setup(b){b.onLoad({filter:/\.ts$/},args=>{const rel=relative(root,args.path).replaceAll('\\','/');if(Object.hasOwn(overrides,rel))return {contents:overrides[rel],loader:'ts'};});}};
 const out=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',plugins:[plugin]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}

let total=0,suiteCount=0;
async function test(name,fn){try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}}
const rejects=async(fn,code)=>assert.rejects(async()=>fn(),e=>{assert.equal(e.code,code,`${e.message}`);return true;});
/** Waits (by yielding to the event loop, with a generous bound) until a condition holds; never a fixed delay. */
const until=async(condition,what)=>{for(let i=0;i<20000;i++){if(condition())return;await new Promise(resolve=>setImmediate(resolve));}assert.fail(`timed out waiting for ${what}`);};

// ---------- Synthetic fixtures ----------
const T0=Date.parse('2026-10-10T00:00:00Z');
const pad=n=>String(n).padStart(4,'0');
const ACCESS=n=>`SYNTHETIC-ACCESS-${pad(n)}`,REFRESH=n=>`SYNTHETIC-REFRESH-${pad(n)}`,CLIENT_SECRET='SYNTHETIC-CLIENT-0001';
const secretPattern=/SYNTHETIC-(?:ACCESS|REFRESH|CLIENT)-\d{4}/;
const providers=['github','cloudflare','gmail','google-calendar','outlook-email','microsoft-calendar','hubspot'];
const clients=Object.fromEntries(providers.map(p=>[p,{clientId:`client-${p}`,clientSecret:CLIENT_SECRET}]));
const operation={github:'user.get',cloudflare:'zones.list',gmail:'messages.search','google-calendar':'calendars.list','outlook-email':'messages.search','microsoft-calendar':'events.range',hubspot:'contacts.search'};
const b64=bytes=>Buffer.from(bytes).toString('base64url');
const aesKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
/** Synthetic vault: AES-GCM with the vault context as additional data, exactly the binding the real vault provides. */
function makeVault(){
 const log=[];
 return {log,
  async seal(context,value){
   log.push({op:'seal',context});
   const iv=crypto.getRandomValues(new Uint8Array(12));
   const sealed=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(context)},aesKey,new TextEncoder().encode(value));
   return `syn.${b64(iv)}.${b64(new Uint8Array(sealed))}`;
  },
  async unseal(context,ciphertext){
   log.push({op:'unseal',context});
   const [tag,iv,sealed]=ciphertext.split('.');
   assert.equal(tag,'syn');
   const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(iv,'base64url'),additionalData:new TextEncoder().encode(context)},aesKey,Buffer.from(sealed,'base64url'));
   return new TextDecoder().decode(plain);
  },
 };
}
function deepFreeze(value){if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);}return value;}

/** In-memory store implementing the CustodyStore port with real compare-and-swap semantics: every method re-reads
 * state after its entry yield and writes in one step. `frozen` hands out deep-frozen copies and keeps its arguments by
 * reference (so a module that mutates a record, or an argument after passing it, fails loudly). `json` serialises every
 * read and write through JSON text and so catches fields that do not survive a real database round trip. */
function makeStore(m,mode){
 const rows=new Map(),calls=[],hooks=new Map(),limits=m.custodyLimits;
 const get=id=>{const row=rows.get(id);return row===undefined?undefined:mode==='json'?JSON.parse(row):row;};
 const put=record=>{rows.set(record.id,mode==='json'?JSON.stringify(record):record);};
 const view=record=>record===undefined?null:mode==='json'?record:deepFreeze(structuredClone(record));
 async function enter(name,id,args){
  calls.push({name,id,args:structuredClone(args)});
  await null;
  const hook=hooks.get(name);
  if(hook){hooks.delete(name);await hook(args);}
 }
 const claimable=['revoking','revocation-pending','revocation-owner-action'];
 const same=(claim,claimId)=>claim!==null&&claim.claimId===claimId;
 const store={
  calls,
  /** Runs once, inside the next call of `name`, before that call's compare-and-swap. */
  before(name,fn){hooks.set(name,fn);},
  count:name=>calls.filter(c=>c.name===name).length,
  peek:id=>{const row=get(id);return row===undefined?null:structuredClone(row);},
  put:record=>put(structuredClone(record)),
  patch(id,changes){put({...get(id),...structuredClone(changes)});},
  dump:()=>JSON.stringify([...rows.keys()].map(id=>get(id))),
  async load(id){await enter('load',id,{});return view(get(id));},
  async claimRefresh(id,{claimId,expiresAt,now,generation}){
   await enter('claimRefresh',id,{claimId,expiresAt,now,generation});
   const r=get(id);
   if(!r||r.state!=='active'||r.generation!==generation||(r.refreshClaim!==null&&r.refreshClaim.expiresAt>now))return false;
   put({...r,refreshClaim:{claimId,expiresAt}});return true;
  },
  async commitRefresh(id,{claimId,fromGeneration,next}){
   await enter('commitRefresh',id,{claimId,fromGeneration,next});
   const r=get(id);
   if(!r||r.state!=='active'||!same(r.refreshClaim,claimId)||r.generation!==fromGeneration)return false;
   put({...r,generation:fromGeneration+1,accessCiphertext:next.accessCiphertext,accessExpiresAt:next.accessExpiresAt,scopes:[...next.scopes],refreshCiphertext:next.refreshCiphertext,refreshClaim:null});return true;
  },
  async releaseRefreshClaim(id,claimId){
   await enter('releaseRefreshClaim',id,{claimId});
   const r=get(id);if(!r||!same(r.refreshClaim,claimId))return false;
   put({...r,refreshClaim:null});return true;
  },
  async markReauthorizationRequired(id,claimId){
   await enter('markReauthorizationRequired',id,{claimId});
   const r=get(id);if(!r||r.state!=='active'||!same(r.refreshClaim,claimId))return false;
   put({...r,state:'reauthorization-required',accessCiphertext:null,accessExpiresAt:null,refreshCiphertext:null,refreshClaim:null});return true;
  },
  async beginRevocation(id,ownerId){
   await enter('beginRevocation',id,{ownerId});
   const r=get(id);if(!r||r.ownerId!==ownerId)return null;
   if(r.state==='active'||r.state==='reauthorization-required'){
    const work=[...r.revocationWork],recordId=m.custodyRecordId(id,r.generation);
    if(r.accessCiphertext!==null)work.push({ciphertext:r.accessCiphertext,purpose:'token',recordId});
    if(r.refreshCiphertext!==null)work.push({ciphertext:r.refreshCiphertext,purpose:'refresh',recordId});
    put({...r,state:'revoking',generation:r.generation+1,refreshClaim:null,accessCiphertext:null,accessExpiresAt:null,refreshCiphertext:null,revocationWork:work});
   }
   return view(get(id));
  },
  async claimRevocation(id,{claimId,expiresAt,now}){
   await enter('claimRevocation',id,{claimId,expiresAt,now});
   const r=get(id);
   if(!r||!claimable.includes(r.state)||(r.revocationClaim!==null&&r.revocationClaim.expiresAt>now))return false;
   put({...r,revocationClaim:{claimId,expiresAt}});return true;
  },
  async settleRevocation(id,claimId,{state,settled}){
   await enter('settleRevocation',id,{claimId,state,settled});
   const r=get(id);if(!r||!claimable.includes(r.state)||!same(r.revocationClaim,claimId))return null;
   const work=r.revocationWork.filter(item=>!settled.includes(item.ciphertext));
   const stored=state==='revoked'&&work.length>0?'revocation-pending':state;
   put({...r,state:stored,revocationWork:work,revocationClaim:null});return stored;
  },
  async releaseRevocationClaim(id,claimId){
   await enter('releaseRevocationClaim',id,{claimId});
   const r=get(id);if(!r||!same(r.revocationClaim,claimId))return false;
   put({...r,revocationClaim:null});return true;
  },
  async stashRevocationWork(id,work){
   await enter('stashRevocationWork',id,{purpose:work.purpose,recordId:work.recordId});
   const r=get(id);if(!r)return false;
   if(r.revocationWork.some(item=>item.ciphertext===work.ciphertext))return true;
   if(r.revocationWork.length>=limits.maxRevocationWork)return false;
   put({...r,state:r.state==='revoked'?'revocation-pending':r.state,revocationWork:[...r.revocationWork,{ciphertext:work.ciphertext,purpose:work.purpose,recordId:work.recordId}]});return true;
  },
 };
 return store;
}

/** Scripted provider. Token and revocation replies come from queues; the default token reply is a valid refresh and
 * the default revocation reply is the provider's success status. Every request is recorded for inspection. */
function makeProvider(catalog){
 const s={calls:[],tokenReplies:[],revokeReplies:[],gate:null,onCall:null};
 const tokenUrls=new Set(Object.values(catalog.providers).map(e=>e.authorization.token));
 const response=r=>{
  if(r.throw)throw new Error(typeof r.throw==='string'?r.throw:'connection reset');
  const status=r.status??200,body=r.json!==undefined?JSON.stringify(r.json):r.text??'';
  return new Response([204,205,304].includes(status)?null:body,{status});
 };
 s.transport=async request=>{
  const kind=tokenUrls.has(request.url)?'token':'revoke';
  const call={kind,url:request.url,method:request.method,headers:{...request.headers},body:request.body,redirect:request.redirect,bounded:request.signal instanceof AbortSignal,fields:request.body&&request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')?Object.fromEntries(new URLSearchParams(request.body)):null};
  s.calls.push(call);
  if(s.onCall){const hook=s.onCall;s.onCall=null;await hook(call);}
  if(s.gate&&kind==='token')await s.gate;
  const queue=kind==='token'?s.tokenReplies:s.revokeReplies;
  if(queue.length>0)return response(queue.shift());
  if(kind==='token')return response({json:{access_token:ACCESS(s.calls.filter(c=>c.kind==='token').length+1),token_type:'Bearer',expires_in:3600}});
  return response({status:request.method==='DELETE'?204:200});
 };
 s.count=kind=>s.calls.filter(c=>c.kind===kind).length;
 return s;
}

async function suite(m,mode){
 const before=total;
 const synthetic=()=>{const c=structuredClone(m.connectorCatalog);for(const e of Object.values(c.providers))if(e.readiness==='planned')e.readiness='synthetic-conformant';return c;};
 const scopesOf=(c,p)=>[...c.providers[p].scopes];
 // Every value that crosses an API boundary is scanned for any synthetic secret.
 const clean=value=>{
  const text=value instanceof Error?JSON.stringify({name:value.name,code:value.code,path:value.path,message:value.message,stack:value.stack,cause:value.cause&&String(value.cause)}):JSON.stringify(value);
  assert.equal(secretPattern.test(text??''),false,`token material in ${text}`);
 };
 const attempt=async fn=>{try{const value=await fn();clean(value);return value;}catch(error){clean(error);throw error;}};
 async function env({provider='gmail',catalog=synthetic(),allowPath=false,seed={},clientConfig=clients}={}){
  const clock={t:T0},ids={n:0},vault=makeVault(),store=makeStore(m,mode),prov=makeProvider(catalog);
  const custody=m.createCredentialCustody({catalog,store,vault,clients:clientConfig,transport:prov.transport,now:()=>clock.t,newId:()=>`id${++ids.n}`,allowPathTokenRevocation:allowPath});
  const e={m,catalog,clock,store,prov,vault,custody,provider,id:'cred-0001',owner:'owner-a',op:operation[provider]};
  e.use=(ownerId=e.owner,operationId=e.op)=>({kind:'admitted-operation',ownerId,operationId});
  e.sealed=async(purpose,token,generation=1,id=e.id,ownerId=e.owner,providerId=provider)=>vault.seal(m.catalogVaultContext(catalog,providerId,purpose,ownerId,m.custodyRecordId(id,generation)),token);
  e.unsealed=async(purpose,ciphertext,generation,id=e.id)=>vault.unseal(m.catalogVaultContext(catalog,provider,purpose,e.owner,m.custodyRecordId(id,generation)),ciphertext);
  e.seed=async({id=e.id,state='active',generation=1,access=ACCESS(1),refresh=REFRESH(1),expiresAt=T0-1000,scopes=scopesOf(catalog,provider),ownerId=e.owner,providerId=provider}={})=>{
   store.put({id,ownerId,providerId,state,scopes,generation,accessCiphertext:access===null?null:await e.sealed('token',access,generation,id,ownerId,providerId),accessExpiresAt:access===null?null:expiresAt,
    refreshCiphertext:refresh===null?null:await e.sealed('refresh',refresh,generation,id,ownerId,providerId),refreshClaim:null,revocationClaim:null,revocationWork:[]});
  };
  if(seed!==false)await e.seed(seed);
  e.refresh=(ownerId,operationId)=>attempt(()=>custody.refreshAccess(e.use(ownerId,operationId),e.id));
  e.disconnect=(ownerId=e.owner)=>attempt(()=>custody.disconnect(ownerId,e.id));
  e.reconcile=(ownerId=e.owner)=>attempt(()=>custody.reconcileRevocation(ownerId,e.id));
  e.record=()=>store.peek(e.id);
  e.assertClean=()=>assert.equal(secretPattern.test(store.dump()),false,'token material in a stored field');
  return e;
 }
 const googleScopes=scopesOf(m.connectorCatalog,'gmail');
 const tokenBodies=e=>e.prov.calls.filter(c=>c.kind==='token').map(c=>c.fields);

 // ---------- Admission and eligibility ----------
 await test('refresh is refused without an admitted operation, with no provider call',async()=>{
  const e=await env();
  for(const use of [undefined,null,'admitted',{},{kind:'admitted-operation'},{kind:'admitted-operation',ownerId:'owner-a'},{kind:'admitted-operation',ownerId:7,operationId:'messages.search'},
   {kind:'background',ownerId:'owner-a',operationId:'messages.search'},{kind:'scheduled',ownerId:'owner-a',operationId:'messages.search'},{kind:'admitted-operation',ownerId:'owner-a',operationId:'drive.files.delete'}])
   await rejects(()=>attempt(()=>e.custody.refreshAccess(use,e.id)),'NOT_ADMITTED');
  assert.equal(e.prov.calls.length,0);assert.equal(e.store.count('claimRefresh'),0);
  assert.equal(e.record().generation,1);
 });
 await test('refresh is refused for another owner and for an unknown credential, with no provider call',async()=>{
  const e=await env();
  await rejects(()=>e.refresh('owner-b'),'OWNER_MISMATCH');
  await rejects(()=>attempt(()=>e.custody.refreshAccess(e.use(),'cred-9999')),'OWNER_MISMATCH');
  await rejects(()=>e.disconnect('owner-b'),'OWNER_MISMATCH');
  await rejects(()=>e.reconcile('owner-b'),'OWNER_MISMATCH');
  assert.equal(e.prov.calls.length,0);assert.equal(e.record().state,'active');assert.equal(e.record().generation,1);
 });
 await test('providers with refresh kind none or retained-unused never refresh, and planned providers are refused by the catalog',async()=>{
  const kinds=Object.fromEntries(Object.entries(m.connectorCatalog.providers).map(([p,x])=>[p,x.authorization.refresh]));
  assert.equal(kinds.github,'retained-unused');assert.equal(kinds.cloudflare,'none');
  for(const provider of ['github','cloudflare']){
   const e=await env({provider,seed:provider==='cloudflare'?{refresh:null}:{}});
   await rejects(()=>e.refresh(),'REFRESH_NOT_ALLOWED');
   assert.equal(e.prov.calls.length,0,provider);assert.equal(e.store.count('claimRefresh'),0);
   assert.equal(e.record().generation,1);assert.equal(e.record().state,'active');
  }
  // The real catalog: gmail is planned, so the module refuses it before any claim or provider call.
  const real=await env({provider:'gmail',catalog:m.connectorCatalog,seed:false});
  await real.store.put({id:real.id,ownerId:'owner-a',providerId:'gmail',state:'active',scopes:googleScopes,generation:1,accessCiphertext:'syn.x.y',accessExpiresAt:T0-1,refreshCiphertext:'syn.x.y',refreshClaim:null,revocationClaim:null,revocationWork:[]});
  await rejects(()=>real.refresh(),'PROVIDER_PLANNED');
  await rejects(()=>real.disconnect(),'PROVIDER_PLANNED');
  assert.equal(real.prov.calls.length,0);assert.equal(real.store.count('claimRefresh'),0);
 });

 // ---------- Refresh: freshness, request shape, single flight ----------
 await test('a still-valid access token is returned without any provider call, and an expiring one is refreshed',async()=>{
  const e=await env({seed:{expiresAt:T0+31000}});
  const grant=await e.refresh();
  assert.equal(grant.accessToken,ACCESS(1));assert.equal(grant.refreshed,false);assert.equal(grant.generation,1);
  assert.equal(e.prov.calls.length,0);assert.equal(e.store.count('claimRefresh'),0);
  assert.ok(!Object.keys(grant).includes('accessToken')&&!JSON.stringify(grant).includes('SYNTHETIC'),'the token is not enumerable');
  // Exactly at the skew boundary the token is treated as expiring.
  e.store.patch(e.id,{accessExpiresAt:T0+30000});
  const renewed=await e.refresh();
  assert.equal(renewed.refreshed,true);assert.equal(e.prov.count('token'),1);
  e.assertClean();
 });
 await test('the token request is the fixed catalog endpoint with the form body, manual redirects and a timeout',async()=>{
  const e=await env();
  const grant=await e.refresh();
  const [call]=e.prov.calls;
  assert.equal(call.url,e.catalog.providers.gmail.authorization.token);assert.equal(call.method,'POST');
  assert.equal(call.redirect,'manual');assert.equal(call.bounded,true);
  assert.equal(call.headers['content-type'],'application/x-www-form-urlencoded');
  assert.deepEqual(Object.keys(call.fields),['grant_type','refresh_token','client_id','client_secret']);
  assert.deepEqual(call.fields,{grant_type:'refresh_token',refresh_token:REFRESH(1),client_id:'client-gmail',client_secret:CLIENT_SECRET});
  assert.ok(!call.url.includes('SYNTHETIC'));
  assert.equal(grant.accessToken,ACCESS(2));assert.equal(grant.refreshed,true);assert.equal(grant.generation,2);
  assert.equal(grant.expiresAt,T0+3600000);
  // Without a configured client secret the body carries only the client id.
  const open=await env({clientConfig:{gmail:{clientId:'client-gmail'}}});
  await open.refresh();
  assert.deepEqual(Object.keys(open.prov.calls[0].fields),['grant_type','refresh_token','client_id']);
  // A provider without a configured client makes no call at all.
  const none=await env({clientConfig:{}});
  await rejects(()=>none.refresh(),'CLIENT_NOT_CONFIGURED');
  assert.equal(none.prov.calls.length,0);assert.equal(none.store.count('claimRefresh'),0);
 });
 await test('concurrent uses make exactly one token-endpoint call',async()=>{
  // Gated provider: the winner is in flight while the seven losers run.
  const e=await env();
  let release;e.prov.gate=new Promise(resolve=>{release=resolve;});
  let finished=0;
  const uses=Array.from({length:8},()=>e.refresh().then(value=>({value}),error=>({error})).then(r=>{finished++;return r;}));
  await until(()=>finished===7&&e.prov.count('token')>=1,'the seven losing uses and the winner in flight');
  assert.equal(e.prov.count('token'),1,'one call while the winner is in flight');
  release();
  const results=await Promise.all(uses);
  assert.equal(e.prov.count('token'),1);
  const won=results.filter(r=>r.value),lost=results.filter(r=>r.error);
  assert.equal(won.length,1);assert.equal(lost.length,7);
  for(const r of lost)assert.equal(r.error.code,'REFRESH_IN_PROGRESS');
  assert.equal(won[0].value.accessToken,ACCESS(2));
  assert.equal(e.record().generation,2);assert.equal(e.record().refreshClaim,null);
  // Ungated: whoever loses either sees the committed token or reports the in-flight refresh. Still one call.
  const f=await env();
  const free=await Promise.all(Array.from({length:8},()=>f.refresh().then(value=>({value}),error=>({error}))));
  assert.equal(f.prov.count('token'),1);
  for(const r of free)assert.ok(r.value?r.value.accessToken===ACCESS(2):r.error.code==='REFRESH_IN_PROGRESS');
  assert.ok(free.some(r=>r.value));
  // The next use after the commit is served from the stored token with no further call.
  assert.equal((await f.refresh()).accessToken,ACCESS(2));assert.equal(f.prov.count('token'),1);
  e.assertClean();f.assertClean();
 });
 await test('a loser whose claim fails because the winner just committed uses the fresh token without a call',async()=>{
  const e=await env();
  let winner;
  e.store.before('claimRefresh',async()=>{winner=await e.custody.refreshAccess(e.use(),e.id);});
  const grant=await e.refresh();
  assert.equal(winner.accessToken,ACCESS(2));assert.equal(grant.accessToken,ACCESS(2));assert.equal(grant.refreshed,false);
  assert.equal(e.prov.count('token'),1);
 });

 // ---------- Refresh: uncertain outcomes, leases, definitive rejections ----------
 await test('a lost reply fails only that use and the next use retries the same custody under a new claim',async()=>{
  const e=await env();
  const initial=e.record();
  e.prov.tokenReplies.push({throw:true});
  await rejects(()=>e.refresh(),'REFRESH_UNCERTAIN');
  assert.deepEqual(e.record(),{...initial,refreshClaim:null});
  e.assertClean();
  const grant=await e.refresh();
  assert.equal(grant.accessToken,ACCESS(3));
  assert.deepEqual(tokenBodies(e).map(f=>f.refresh_token),[REFRESH(1),REFRESH(1)],'the same retained refresh credential is retried');
  const claims=e.store.calls.filter(c=>c.name==='claimRefresh').map(c=>c.args.claimId);
  assert.equal(new Set(claims).size,2,'a new claim per attempt');
  assert.equal(e.record().generation,2);
  // Every other unusable reply is uncertain too and changes nothing.
  for(const [name,reply] of [['5xx',{status:503,text:'busy'}],['429',{status:429,json:{error:'rate'}}],['408',{status:408,text:''}],['3xx',{status:302,text:''}],['non-JSON 200',{status:200,text:'<html>'}],
   ['truncated JSON',{status:200,text:'{"access_token":'}],['empty 200',{status:200,text:''}],['201',{status:201,json:{}}],['oversized body',{status:200,json:{pad:'x'.repeat(20000),access_token:ACCESS(9),token_type:'Bearer',expires_in:60}}]]){
   const f=await env();const was=f.record();
   f.prov.tokenReplies.push(reply);
   await rejects(()=>f.refresh(),'REFRESH_UNCERTAIN');
   assert.deepEqual(f.record(),{...was,refreshClaim:null},name);assert.equal(f.prov.count('token'),1,name);
  }
 });
 await test('an unexpired claim is not takeable, an expired one is, and the displaced claim can no longer commit',async()=>{
  const e=await env();
  e.store.patch(e.id,{refreshClaim:{claimId:'someone-else',expiresAt:T0+10000}});
  await rejects(()=>e.refresh(),'REFRESH_IN_PROGRESS');
  assert.equal(e.prov.calls.length,0);assert.equal(e.record().refreshClaim.claimId,'someone-else');
  e.clock.t=T0+9999;await rejects(()=>e.refresh(),'REFRESH_IN_PROGRESS');assert.equal(e.prov.calls.length,0);
  e.clock.t=T0+10000;
  const grant=await e.refresh();
  assert.equal(grant.refreshed,true);assert.equal(e.prov.count('token'),1);
  assert.equal(e.record().refreshClaim,null);
  // The stolen claim's holder commits late: its claim no longer exists, so it loses.
  assert.equal(await e.store.commitRefresh(e.id,{claimId:'someone-else',fromGeneration:1,next:{accessCiphertext:'syn.a.b',accessExpiresAt:T0,scopes:[],refreshCiphertext:'syn.a.b'}}),false);
  assert.equal(e.record().generation,2);
  // A claim that expired under a slow call is displaced: the first call's commit loses and its new token is revocation work.
  const f=await env();
  f.prov.onCall=async()=>{
   f.clock.t=T0+60000;
   f.prov.tokenReplies.unshift({json:{access_token:ACCESS(5),token_type:'Bearer',expires_in:3000}});
   assert.equal((await f.custody.refreshAccess(f.use(),f.id)).accessToken,ACCESS(5));
  };
  f.prov.tokenReplies.push({json:{access_token:ACCESS(4),token_type:'Bearer',expires_in:3600}});
  await rejects(()=>f.refresh(),'REFRESH_DISCARDED');
  assert.equal(f.record().generation,2);assert.equal(await f.unsealed('token',f.record().accessCiphertext,2),ACCESS(5));
  assert.equal(f.prov.count('token'),2);
 });
 await test('invalid_grant requires reauthorization, clears both credentials, and later uses make no call',async()=>{
  const e=await env();
  e.prov.tokenReplies.push({status:400,json:{error:'invalid_grant',error_description:'Token has been expired or revoked.'}});
  await rejects(()=>e.refresh(),'REAUTHORIZATION_REQUIRED');
  const r=e.record();
  assert.equal(r.state,'reauthorization-required');assert.equal(r.accessCiphertext,null);assert.equal(r.refreshCiphertext,null);assert.equal(r.refreshClaim,null);
  const calls=e.prov.calls.length;
  for(let i=0;i<3;i++)await rejects(()=>e.refresh(),'REAUTHORIZATION_REQUIRED');
  assert.equal(e.prov.calls.length,calls);
  // Any other definitive rejection fails the use and leaves the credential and its claim untouched.
  for(const reply of [{status:400,json:{error:'invalid_client'}},{status:400,text:'not json'},{status:401,json:{error:'invalid_client'}},{status:403,json:{}},{status:404,json:{}}]){
   const f=await env();const was=f.record();
   f.prov.tokenReplies.push(reply);
   await rejects(()=>f.refresh(),'REFRESH_FAILED');
   assert.deepEqual(f.record(),{...was,refreshClaim:null});
  }
  // A credential with no refresh token and an expired access token cannot be refreshed.
  const g=await env({seed:{refresh:null}});
  await rejects(()=>g.refresh(),'REAUTHORIZATION_REQUIRED');
  assert.equal(g.prov.calls.length,0);assert.equal(g.record().state,'reauthorization-required');
 });

 // ---------- Refresh: rotation, atomic commit, replay ----------
 const rotating={json:{access_token:ACCESS(2),token_type:'Bearer',expires_in:3600,refresh_token:REFRESH(2)}};
 await test('a crash between the token response and the commit leaves the old refresh credential intact',async()=>{
  const e=await env();
  const initial=e.record();
  e.prov.tokenReplies.push(rotating);
  e.store.before('commitRefresh',async()=>{throw new Error('worker crashed before commit');});
  await assert.rejects(()=>e.refresh(),/worker crashed/);
  const r=e.record();
  assert.equal(r.generation,1);assert.equal(r.state,'active');
  assert.equal(r.refreshCiphertext,initial.refreshCiphertext,'old refresh ciphertext untouched');
  assert.equal(r.accessCiphertext,initial.accessCiphertext);
  assert.equal(r.refreshClaim,null,'claim released by the failed attempt');
  assert.equal(await e.unsealed('refresh',r.refreshCiphertext,1),REFRESH(1));
  // The retained credential is still usable: the next use retries it under a new claim and rotates.
  e.prov.tokenReplies.push({json:{access_token:ACCESS(3),token_type:'Bearer',expires_in:3600,refresh_token:REFRESH(3)}});
  assert.equal((await e.refresh()).accessToken,ACCESS(3));
  assert.equal(tokenBodies(e)[1].refresh_token,REFRESH(1));
  e.assertClean();
 });
 await test('a rotated refresh credential, new access token, scopes and expiry are written by one guarded commit',async()=>{
  const e=await env();
  e.prov.tokenReplies.push(rotating);
  const grant=await e.refresh();
  assert.equal(grant.accessToken,ACCESS(2));
  const commits=e.store.calls.filter(c=>c.name==='commitRefresh');
  assert.equal(commits.length,1);
  const claimed=e.store.calls.find(c=>c.name==='claimRefresh');
  assert.equal(commits[0].args.claimId,claimed.args.claimId);assert.equal(commits[0].args.fromGeneration,1);
  assert.equal(claimed.args.generation,1);
  const r=e.record();
  assert.equal(r.generation,2);assert.equal(r.refreshClaim,null);assert.equal(r.accessExpiresAt,T0+3600000);
  assert.equal(await e.unsealed('refresh',r.refreshCiphertext,2),REFRESH(2));
  assert.equal(await e.unsealed('token',r.accessCiphertext,2),ACCESS(2));
  assert.equal(r.refreshCiphertext,commits[0].args.next.refreshCiphertext,'the stored refresh ciphertext is the one the commit carried');
  // Not rotated: the same credential is kept, re-sealed under the new generation's context.
  const f=await env();
  await f.refresh();
  const g=f.record();
  assert.equal(await f.unsealed('refresh',g.refreshCiphertext,2),REFRESH(1));
  // The second refresh uses the rotated credential.
  e.clock.t=T0+3600000+1;e.prov.tokenReplies.push({json:{access_token:ACCESS(7),token_type:'Bearer',expires_in:3600}});
  await e.refresh();
  assert.equal(tokenBodies(e)[1].refresh_token,REFRESH(2));
  e.assertClean();
 });
 await test('ciphertext is bound to its generation: a replayed old ciphertext cannot be unsealed as current',async()=>{
  const e=await env({seed:{expiresAt:T0+31000}});
  const old=e.record();
  e.store.patch(e.id,{accessExpiresAt:T0-1});
  await e.refresh();
  const current=e.record();
  assert.equal(current.generation,2);
  assert.ok(e.vault.log.some(l=>l.op==='seal'&&l.context.endsWith(`:${e.id}-2`)&&l.context.startsWith('whumpo:gmail:token:owner-a:')),'sealed under the generation-2 context');
  assert.ok(e.vault.log.some(l=>l.op==='seal'&&l.context==='whumpo:gmail:refresh:owner-a:'+e.id+'-2'));
  // Put the generation-1 ciphertexts back and make them look fresh.
  e.store.patch(e.id,{accessCiphertext:old.accessCiphertext,accessExpiresAt:T0+3600000});
  await rejects(()=>e.refresh(),'VAULT_UNAVAILABLE');
  assert.equal(e.prov.count('token'),1,'a replayed token does not trigger a refresh');
  e.store.patch(e.id,{accessCiphertext:current.accessCiphertext,accessExpiresAt:T0-1,refreshCiphertext:old.refreshCiphertext});
  await rejects(()=>e.refresh(),'VAULT_UNAVAILABLE');
  assert.equal(e.prov.count('token'),1);
  assert.equal(e.record().refreshClaim,null);
  // Another owner's or credential's ciphertext does not unseal either.
  await assert.rejects(()=>e.unsealed('refresh',current.refreshCiphertext,2,'cred-0002'));
 });

 // ---------- Refresh: scopes and token admission ----------
 await test('scope narrowing is accepted and stored; widening is refused, stores nothing and requires reauthorization',async()=>{
  const [read,send]=googleScopes;
  const e=await env();
  e.prov.tokenReplies.push({json:{access_token:ACCESS(2),token_type:'Bearer',expires_in:3600,scope:read}});
  const narrowed=await e.refresh();
  assert.deepEqual(narrowed.scopes,[read]);assert.deepEqual(e.record().scopes,[read]);assert.equal(e.record().state,'active');
  // Absent scope keeps the previous (now narrower) grant.
  e.clock.t=T0+3600001;e.prov.tokenReplies.push({json:{access_token:ACCESS(3),token_type:'Bearer',expires_in:3600}});
  assert.deepEqual((await e.refresh()).scopes,[read]);
  // The catalog scope that was previously narrowed away must not come back.
  e.clock.t=T0+2*3600001;
  e.prov.tokenReplies.push({json:{access_token:ACCESS(4),token_type:'Bearer',expires_in:3600,refresh_token:REFRESH(4),scope:`${read} ${send}`}});
  const before=e.record();
  await rejects(()=>e.refresh(),'SCOPE_WIDENED');
  const r=e.record();
  assert.equal(r.state,'reauthorization-required');assert.equal(r.generation,before.generation);assert.deepEqual(r.scopes,[read]);
  assert.equal(r.accessCiphertext,null);assert.equal(r.refreshCiphertext,null);assert.equal(r.accessExpiresAt,null);
  assert.equal(e.store.count('commitRefresh'),2,'the widened response was never committed');
  // The issued credential and the still-live retained credential are kept as revocation work, never as custody.
  const work=await Promise.all(r.revocationWork.map(w=>e.vault.unseal(e.m.catalogVaultContext(e.catalog,'gmail',w.purpose,'owner-a',w.recordId),w.ciphertext)));
  assert.deepEqual([...work].sort(),[REFRESH(1),REFRESH(4)]);
  await rejects(()=>e.refresh(),'REAUTHORIZATION_REQUIRED');
  // A scope outside the catalog is also widening, even when the previous grant listed it.
  const f=await env();
  f.prov.tokenReplies.push({json:{access_token:ACCESS(2),token_type:'Bearer',expires_in:3600,scope:'https://www.googleapis.com/auth/drive'}});
  await rejects(()=>f.refresh(),'SCOPE_WIDENED');
  assert.equal(f.record().state,'reauthorization-required');assert.equal(f.record().generation,1);
  f.assertClean();e.assertClean();
 });
 await test('token responses are admitted only when bearer, bounded and well-formed; nothing is stored from a refused one',async()=>{
  const good={access_token:ACCESS(2),token_type:'Bearer',expires_in:3600};
  const max=synthetic().providers.gmail.authorization.maxAccessSeconds;
  for(const [name,body] of [
   ['not bearer',{...good,token_type:'mac'}],['no token type',{access_token:ACCESS(2),expires_in:60}],['no access token',{token_type:'Bearer',expires_in:60}],
   ['empty access token',{...good,access_token:''}],['access token with whitespace',{...good,access_token:'SYNTHETIC-ACCESS 0002'}],['oversized access token',{...good,access_token:'a'.repeat(8193)}],
   ['non-string access token',{...good,access_token:12}],['zero lifetime',{...good,expires_in:0}],['negative lifetime',{...good,expires_in:-5}],['fractional lifetime',{...good,expires_in:1.5}],
   ['string lifetime',{...good,expires_in:'3600'}],['lifetime above the catalog maximum',{...good,expires_in:max+1}],['no lifetime',{access_token:ACCESS(2),token_type:'Bearer'}],
   ['refresh token of the wrong type',{...good,refresh_token:42}],['empty scope',{...good,scope:''}],['scope list with an empty entry',{...good,scope:`${googleScopes[0]}  ${googleScopes[1]}`}],['array body',[good]],
  ]){
   const e=await env();const was=e.record();
   e.prov.tokenReplies.push({json:body});
   await rejects(()=>e.refresh(),'INVALID_TOKEN');
   assert.deepEqual(e.record(),{...was,refreshClaim:null},name);assert.equal(e.store.count('commitRefresh'),0,name);
  }
  // Bearer is case-insensitive per RFC 6749; a refused response that issued a refresh token keeps it as revocation work.
  const e=await env();
  e.prov.tokenReplies.push({json:{...good,token_type:'bearer'}});
  assert.equal((await e.refresh()).refreshed,true);
  const f=await env();
  f.prov.tokenReplies.push({json:{...good,expires_in:0,refresh_token:REFRESH(2)}});
  await rejects(()=>f.refresh(),'INVALID_TOKEN');
  assert.equal(f.record().revocationWork.length,1);assert.equal(f.record().state,'active');
  f.assertClean();
 });

 // ---------- Revocation by catalog kind ----------
 await test('RFC 7009: local use is disabled first; only a definitive 200 or 204 settles revoked and deletes ciphertexts',async()=>{
  for(const status of [200,204]){
   const e=await env();
   let seen;
   e.prov.onCall=async()=>{seen=e.record();};
   e.prov.revokeReplies.push({status});
   const out=await e.disconnect();
   assert.deepEqual(out,{state:'revoked',remote:true,ownerAction:false});
   assert.equal(seen.state,'revoking','local access was already disabled when the provider was called');
   assert.equal(seen.accessCiphertext,null);assert.equal(seen.refreshCiphertext,null);
   const [call]=e.prov.calls;
   assert.equal(call.url,e.catalog.providers.gmail.authorization.revoke);assert.equal(call.method,'POST');
   assert.equal(call.redirect,'manual');assert.equal(call.bounded,true);
   assert.deepEqual(call.fields,{token:REFRESH(1),token_type_hint:'refresh_token',client_id:'client-gmail',client_secret:CLIENT_SECRET});
   assert.equal(e.prov.calls.length,1,'one provider call for the grant');
   const r=e.record();
   assert.equal(r.state,'revoked');assert.equal(r.revocationWork.length,0);assert.equal(r.accessCiphertext,null);assert.equal(r.revocationClaim,null);
   assert.ok(r.generation>1);
   await rejects(()=>e.refresh(),'CREDENTIAL_NOT_ACTIVE');
   // Idempotent: a repeated disconnect and a reconcile make no call.
   assert.equal((await e.disconnect()).state,'revoked');assert.equal((await e.reconcile()).state,'revoked');
   assert.equal(e.prov.calls.length,1);
   e.assertClean();
  }
  // With no refresh credential held the access token is revoked with its own hint (Cloudflare, refresh kind none).
  const c=await env({provider:'cloudflare',seed:{refresh:null,expiresAt:T0+60000}});
  assert.equal((await c.disconnect()).state,'revoked');
  assert.deepEqual(c.prov.calls[0].fields,{token:ACCESS(1),token_type_hint:'access_token',client_id:'client-cloudflare',client_secret:CLIENT_SECRET});
 });
 await test('anything but a definitive acknowledgement keeps encrypted revocation work and is reconciled later',async()=>{
  for(const [name,reply] of [['5xx',{status:503}],['429',{status:429}],['400',{status:400,json:{error:'unsupported_token_type'}}],['3xx',{status:302}],['lost reply',{throw:'connection reset'}],['202',{status:202}]]){
   const e=await env();
   e.prov.revokeReplies.push(reply);
   const out=await e.disconnect();
   assert.deepEqual(out,{state:'revocation-pending',remote:false,ownerAction:false,code:'REVOCATION_PENDING'},name);
   const r=e.record();
   assert.equal(r.state,'revocation-pending',name);assert.equal(r.revocationWork.length,2,name);assert.equal(r.revocationClaim,null,name);
   assert.equal(await e.vault.unseal(e.m.catalogVaultContext(e.catalog,'gmail','refresh','owner-a',r.revocationWork[1].recordId),r.revocationWork[1].ciphertext),REFRESH(1));
   // Local use stays disabled while revocation is pending.
   await rejects(()=>e.refresh(),'CREDENTIAL_NOT_ACTIVE');
   // A repeated disconnect and an explicit reconcile retry the retained work and settle it.
   const retry=await e.reconcile();
   assert.deepEqual(retry,{state:'revoked',remote:true,ownerAction:false},name);
   assert.equal(e.prov.count('revoke'),2,name);assert.equal(e.record().revocationWork.length,0,name);
   e.assertClean();
  }
  const a=await env();
  await rejects(()=>a.reconcile(),'NOT_REVOKING');
  assert.equal(a.prov.calls.length,0);assert.equal(a.record().state,'active');
  const none=await env({clientConfig:{}});
  assert.equal((await none.disconnect()).code,'CLIENT_NOT_CONFIGURED');
  assert.equal(none.prov.calls.length,0);assert.equal(none.record().revocationWork.length,2);
 });
 await test('competing disconnects make at most one provider call, and an unexpired lease is respected until it expires',async()=>{
  const e=await env();
  let release;const gate=new Promise(resolve=>{release=resolve;});
  e.prov.onCall=()=>gate;
  let finished=0;
  const attempts=Array.from({length:4},()=>e.disconnect().then(o=>{finished++;return o;}));
  await until(()=>finished===3&&e.prov.count('revoke')>=1,'the three losing disconnects and the winner in flight');
  assert.equal(e.prov.count('revoke'),1);
  release();
  const outs=await Promise.all(attempts);
  assert.equal(e.prov.count('revoke'),1);
  assert.equal(outs.filter(o=>o.state==='revoked'&&!o.code).length,1);
  for(const o of outs.filter(o=>o.code))assert.equal(o.code,'REVOCATION_IN_PROGRESS');
  assert.equal(e.record().state,'revoked');
  // A live lease held by someone else blocks the attempt; after its expiry the work is taken over.
  const g=await env();
  g.prov.revokeReplies.push({status:500});
  await g.disconnect();
  g.store.patch(g.id,{revocationClaim:{claimId:'other',expiresAt:T0+60000}});
  assert.equal((await g.reconcile()).code,'REVOCATION_IN_PROGRESS');
  assert.equal(g.prov.count('revoke'),1);
  g.clock.t=T0+60000;
  assert.equal((await g.reconcile()).state,'revoked');
  assert.equal(g.prov.count('revoke'),2);
  // The displaced claimant cannot settle.
  assert.equal(await g.store.settleRevocation(g.id,'other',{state:'revoked',settled:[]}),null);
 });
 await test('a disconnect during an in-flight refresh discards the new access token and keeps the new refresh token as revocation work',async()=>{
  const e=await env();
  e.prov.tokenReplies.push(rotating);
  let during;
  e.prov.onCall=async()=>{during=await e.custody.disconnect(e.owner,e.id);};
  await rejects(()=>e.refresh(),'REFRESH_DISCARDED');
  assert.equal(during.state,'revoked','the disconnect settled the credential that existed when it began');
  const r=e.record();
  assert.equal(r.state,'revocation-pending','a new revocation work item reopens a revoked credential');
  assert.equal(r.accessCiphertext,null);assert.equal(r.refreshCiphertext,null);assert.equal(r.refreshClaim,null);
  assert.equal(r.revocationWork.length,1);assert.equal(r.revocationWork[0].purpose,'refresh');
  const stashed=await e.vault.unseal(e.m.catalogVaultContext(e.catalog,'gmail','refresh','owner-a',r.revocationWork[0].recordId),r.revocationWork[0].ciphertext);
  assert.equal(stashed,REFRESH(2));
  assert.equal(e.store.calls.filter(c=>c.name==='commitRefresh').length,1);
  // Reconciliation revokes the stashed credential at the provider and settles.
  const before=e.prov.count('revoke');
  const settled=await e.reconcile();
  assert.equal(settled.state,'revoked');assert.equal(e.prov.count('revoke'),before+1);
  assert.equal(e.prov.calls.at(-1).fields.token,REFRESH(2));
  assert.equal(e.record().revocationWork.length,0);
  // No further local use.
  await rejects(()=>e.refresh(),'CREDENTIAL_NOT_ACTIVE');
  e.assertClean();
  // Disconnect before a provider reply that will not come: the begin step voids the claim, so the commit cannot win.
  const f=await env();
  f.prov.tokenReplies.push(rotating);
  f.prov.revokeReplies.push({status:503,text:''});
  f.prov.onCall=async()=>{await f.custody.disconnect(f.owner,f.id);};
  await rejects(()=>f.refresh(),'REFRESH_DISCARDED');
  assert.ok(['revocation-pending'].includes(f.record().state));
  assert.equal(f.record().revocationWork.length,3,'old access, old refresh and the new refresh are all retained');
 });

  await test('a credential that cannot be preserved as revocation work is reported, and a live credential is not cleared without it',async()=>{
  const full=e=>e.store.patch(e.id,{revocationWork:Array.from({length:e.m.custodyLimits.maxRevocationWork},(_,i)=>({ciphertext:`syn.work.${i}`,purpose:'refresh',recordId:`${e.id}-w-${i}`}))});
  // A lost commit whose new refresh token cannot be stored says so, rather than reporting a clean discard.
  const e=await env();full(e);
  e.prov.tokenReplies.push(rotating);
  e.prov.onCall=async()=>{e.store.patch(e.id,{state:'revoking',generation:2,refreshClaim:null});};
  await rejects(()=>e.refresh(),'REFRESH_DISCARDED_UNSTASHED');
  assert.equal(e.record().revocationWork.length,e.m.custodyLimits.maxRevocationWork);
  // A refused response whose issued refresh token cannot be kept is reported as unstashed, not as a plain refusal.
  const g=await env();full(g);
  g.prov.tokenReplies.push({json:{access_token:ACCESS(2),token_type:'Bearer',expires_in:0,refresh_token:REFRESH(2)}});
  await rejects(()=>g.refresh(),'REFRESH_DISCARDED_UNSTASHED');
  assert.equal(g.record().state,'active');assert.equal(g.record().revocationWork.length,g.m.custodyLimits.maxRevocationWork);
  // A widened response with no room to keep the live retained credential leaves it as custody.
  const f=await env();full(f);
  f.prov.tokenReplies.push({json:{access_token:ACCESS(2),token_type:'Bearer',expires_in:3600,scope:`${googleScopes[0]} https://www.googleapis.com/auth/drive`}});
  const was=f.record();
  await rejects(()=>f.refresh(),'SCOPE_WIDENED');
  assert.deepEqual(f.record(),{...was,refreshClaim:null});
 });
 await test('GitHub token delete: an access-token delete does not settle the retained refresh credential',async()=>{
  const e=await env({provider:'github',seed:{expiresAt:T0+60000}});
  const out=await e.disconnect();
  assert.deepEqual(out,{state:'revocation-pending',remote:'access-only',ownerAction:true,reason:'refresh-grant-retained'});
  const [call]=e.prov.calls;
  assert.equal(call.url,'https://api.github.com/applications/client-github/token');assert.equal(call.method,'DELETE');
  assert.equal(call.headers.authorization,'Basic '+Buffer.from(`client-github:${CLIENT_SECRET}`).toString('base64'));
  assert.deepEqual(JSON.parse(call.body),{access_token:ACCESS(1)});
  assert.ok(!call.url.includes('SYNTHETIC'));
  const r=e.record();
  assert.equal(r.state,'revocation-pending');assert.equal(r.revocationWork.length,1);assert.equal(r.revocationWork[0].purpose,'refresh');
  assert.equal(await e.vault.unseal(e.m.catalogVaultContext(e.catalog,'github','refresh','owner-a',r.revocationWork[0].recordId),r.revocationWork[0].ciphertext),REFRESH(1));
  // Repeats and reconciliation are stable and never call the provider for the refresh credential.
  for(let i=0;i<2;i++){
   assert.deepEqual(await e.disconnect(),out);assert.deepEqual(await e.reconcile(),out);
  }
  assert.equal(e.prov.calls.length,1);
  await rejects(()=>e.refresh(),'REFRESH_NOT_ALLOWED');
  // Only 204 settles the access token; a 200 does not.
  const f=await env({provider:'github'});
  f.prov.revokeReplies.push({status:200,json:{}});
  const pending=await f.disconnect();
  assert.equal(pending.state,'revocation-pending');assert.equal(pending.remote,false);assert.equal(pending.code,'REVOCATION_PENDING');
  assert.equal(f.record().revocationWork.length,2);
  // Without any refresh custody the delete settles revoked.
  const g=await env({provider:'github',seed:{refresh:null}});
  assert.deepEqual(await g.disconnect(),{state:'revoked',remote:true,ownerAction:false});
  e.assertClean();
 });
 await test('HubSpot: by default no token is sent in a URL path; the outcome is owner action, never revoked, and work is retained',async()=>{
  const e=await env({provider:'hubspot'});
  const out=await e.disconnect();
  assert.deepEqual(out,{state:'revocation-owner-action',remote:false,ownerAction:true,reason:'path-token-policy'});
  assert.equal(e.prov.calls.length,0);
  const r=e.record();
  assert.equal(r.state,'revocation-owner-action');assert.equal(r.revocationWork.length,2,'encrypted work retained for the later owner decision');
  assert.equal(r.accessCiphertext,null);assert.equal(r.refreshCiphertext,null);
  for(let i=0;i<2;i++){assert.deepEqual(await e.disconnect(),out);assert.deepEqual(await e.reconcile(),out);}
  assert.equal(e.prov.calls.length,0);
  await rejects(()=>e.refresh(),'CREDENTIAL_NOT_ACTIVE');
  e.assertClean();
 });
 await test('HubSpot with allowPathTokenRevocation: the refresh token is deleted by path, never logged, and only 200/204 settles',async()=>{
  const e=await env({provider:'hubspot',allowPath:true});
  e.prov.revokeReplies.push({status:204});
  const out=await e.disconnect();
  assert.deepEqual(out,{state:'revoked',remote:true,ownerAction:false});
  const [call]=e.prov.calls;
  assert.equal(call.method,'DELETE');assert.equal(call.url,`https://api.hubapi.com/oauth/v1/refresh-tokens/${REFRESH(1)}`);assert.equal(call.body,undefined);
  assert.equal(e.record().revocationWork.length,0);
  // A transport error that carries the URL, and a non-definitive status, leave pending work without echoing the token.
  const f=await env({provider:'hubspot',allowPath:true});
  f.prov.revokeReplies.push({throw:`fetch failed for https://api.hubapi.com/oauth/v1/refresh-tokens/${REFRESH(1)}`},{status:500});
  const first=await f.disconnect();
  assert.equal(first.state,'revocation-pending');assert.equal(first.code,'REVOCATION_PENDING');
  assert.equal(f.record().revocationWork.length,2);
  assert.equal((await f.reconcile()).state,'revocation-pending');
  assert.equal((await f.reconcile()).state,'revoked');
  // Flipping the option later resolves retained owner-action work.
  const h=await env({provider:'hubspot'});
  await h.disconnect();
  const flipped=m.createCredentialCustody({catalog:h.catalog,store:h.store,vault:h.vault,clients,transport:h.prov.transport,now:()=>h.clock.t,newId:()=>'flip1',allowPathTokenRevocation:true});
  assert.equal((await flipped.reconcileRevocation(h.owner,h.id)).state,'revoked');
  assert.equal(h.prov.count('revoke'),1);
  e.assertClean();f.assertClean();
 });
 await test('Microsoft: no provider call, local ciphertexts deleted, owner action with remote false, never revoked',async()=>{
  for(const provider of ['outlook-email','microsoft-calendar']){
   const e=await env({provider});
   const out=await e.disconnect();
   assert.deepEqual(out,{state:'revocation-owner-action',remote:false,ownerAction:true,reason:'local-only-owner-removal'});
   assert.equal(e.prov.calls.length,0);
   const r=e.record();
   assert.equal(r.state,'revocation-owner-action');assert.equal(r.accessCiphertext,null);assert.equal(r.refreshCiphertext,null);assert.equal(r.revocationWork.length,0);
   for(let i=0;i<2;i++){assert.deepEqual(await e.disconnect(),out);assert.deepEqual(await e.reconcile(),out);}
   assert.equal(e.prov.calls.length,0);
   await rejects(()=>e.refresh(),'CREDENTIAL_NOT_ACTIVE');
   // Also from a credential that already needed reauthorization.
   const f=await env({provider,seed:{state:'reauthorization-required',access:null,refresh:null}});
   const again=await f.disconnect();
   assert.equal(again.state,'revocation-owner-action');assert.equal(again.remote,false);
   e.assertClean();
  }
 });
 await test('an owner decision that HubSpot is local-only deletes the retained work with no provider call and never reports revoked',async()=>{
  const k=await env({provider:'hubspot'});
  await k.disconnect();
  assert.equal(k.record().revocationWork.length,2);
  const localOnly=structuredClone(k.catalog);
  Object.assign(localOnly.providers.hubspot.authorization,{revocation:'local-only-owner-removal',revoke:null});
  const decided=m.createCredentialCustody({catalog:localOnly,store:k.store,vault:k.vault,clients,transport:k.prov.transport,now:()=>k.clock.t,newId:()=>'dec1'});
  assert.deepEqual(await decided.reconcileRevocation(k.owner,k.id),{state:'revocation-owner-action',remote:false,ownerAction:true,reason:'local-only-owner-removal'});
  assert.equal(k.record().revocationWork.length,0);assert.equal(k.prov.calls.length,0);
 });
 await test('disconnect from reauthorization-required and with a refresh claim in flight voids the claim and bumps the generation',async()=>{
  const e=await env();
  e.store.patch(e.id,{refreshClaim:{claimId:'inflight',expiresAt:T0+30000}});
  const before=e.record();
  await e.disconnect();
  const r=e.record();
  assert.equal(r.generation,before.generation+1);assert.equal(r.refreshClaim,null);
  assert.equal(await e.store.commitRefresh(e.id,{claimId:'inflight',fromGeneration:before.generation,next:{accessCiphertext:'syn.a.b',accessExpiresAt:T0,scopes:[],refreshCiphertext:'syn.a.b'}}),false);
  const f=await env({seed:{state:'reauthorization-required',access:null,refresh:null}});
  assert.equal((await f.disconnect()).state,'revoked');
  assert.equal(f.prov.calls.length,0,'nothing was held, so there is nothing to send');
 });
 await test('no token material appears in any thrown error, result or non-ciphertext stored field',async()=>{
  const e=await env({provider:'hubspot',allowPath:true});
  e.prov.tokenReplies.push({status:503,text:`oops ${REFRESH(1)}`},{status:400,json:{error:'invalid_request',error_description:`bad ${ACCESS(1)} ${CLIENT_SECRET}`}});
  await rejects(()=>e.refresh(),'REFRESH_UNCERTAIN');
  await rejects(()=>e.refresh(),'REFRESH_FAILED');
  e.prov.revokeReplies.push({throw:`boom ${REFRESH(1)}`});
  await e.disconnect();e.assertClean();
  const f=await env();
  f.prov.tokenReplies.push({throw:`boom ${REFRESH(1)}`});
  try{await f.refresh();assert.fail('must reject');}catch(error){clean(error);assert.equal(error.cause,undefined);assert.ok(!error.message.includes('SYNTHETIC'));}
  f.assertClean();
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
await test('the module is pure: only the catalog is imported, there is no timer, scheduler, network, storage or logging API',async()=>{
  const text=read(file);
  const specifiers=[...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
  assert.deepEqual(specifiers,['./catalog']);
  const code=(await transform(text,{loader:'ts',legalComments:'none'})).code;
  assert.ok(!/\bset(?:Timeout|Interval|Immediate)\b|\bqueueMicrotask\b|\bscheduled\b|\bcron\b|\bkeep-?alive\b|\bWorkflow\b|\balarm\b|\brequestIdleCallback\b/i.test(code),'no timer, scheduler or keep-alive');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env|D1Database|\.prepare\(|\benv\.[A-Z_]+|console\.|\bcrypto\.subtle\b/.test(code),'no network, database, environment, log or crypto access');
  // The exported surface has no scheduler: the factory returns exactly the three request-driven operations.
  assert.deepEqual(Object.keys(real).sort(),['createCredentialCustody','custodyLimits','custodyRecordId','custodyStates','catalogVaultContext','connectorCatalog','connectorVaultContext'].sort());
  const e={clock:T0};
  const custody=real.createCredentialCustody({store:{},vault:{},clients:{},transport:async()=>{throw Error('no');},now:()=>e.clock,newId:()=>'x'});
  assert.deepEqual(Object.keys(custody).sort(),['disconnect','reconcileRevocation','refreshAccess']);
  assert.ok(Object.isFrozen(custody));
  assert.deepEqual([...real.custodyStates],['active','reauthorization-required','revoking','revocation-pending','revocation-owner-action','revoked']);
  assert.ok(real.custodyLimits.refreshLeaseMs>=real.custodyLimits.timeoutMs&&real.custodyLimits.revocationLeaseMs===60000);
});
await test('no Worker module imports the custody module (unwired until the SQL adapter exists)',async()=>{
 const importers=[];
 const {readdirSync,statSync}=await import('node:fs');
 const walk=dir=>{for(const name of readdirSync(join(root,dir))){const rel=`${dir}/${name}`;if(statSync(join(root,rel)).isDirectory())walk(rel);else if(/\.(?:ts|tsx|mjs)$/.test(name)&&/credential-custody/.test(read(rel))&&rel!==file)importers.push(rel);}};
 walk('src');
 assert.deepEqual(importers,[]);
 // No file under src/ imports it, so no Worker entry can reach it. tests/connectors-contract.mjs additionally bundles
 // the four Worker entries and fails if any file under src/connector-catalog other than the catalog and builder is reachable.
});
await test('the catalog-parameterised vault context agrees with the frozen export for the frozen catalog',()=>{
 for(const provider of ['github','cloudflare'])for(const purpose of ['token','refresh'])
  for(const probe of [()=>real.connectorVaultContext(provider,purpose,'owner-a','rec-1'),()=>real.catalogVaultContext(real.connectorCatalog,provider,purpose,'owner-a','rec-1')]){
   let value;try{value=probe();}catch(error){value=error.code;}
   assert.equal(value,purpose==='refresh'&&provider==='cloudflare'?'VAULT_PURPOSE_NOT_ALLOWED':`whumpo:${provider}:${purpose}:owner-a:rec-1`);
  }
 assert.throws(()=>real.connectorVaultContext('gmail','token','owner-a','rec-1'),e=>e.code==='PROVIDER_PLANNED');
});

// ---------- Mutation check: each deliberately broken copy of the source must fail the suite ----------
const mutants=[
 ['claim compare-and-swap ignored',"if(!await store.claimRefresh(record.id,{claimId,expiresAt:clock()+custodyLimits.refreshLeaseMs,now:clock(),generation:record.generation})){","await store.claimRefresh(record.id,{claimId,expiresAt:clock()+custodyLimits.refreshLeaseMs,now:clock(),generation:record.generation});if(false){"],
 ['refresh while access is still valid',"record.accessExpiresAt>clock()+custodyLimits.skewMs","record.accessExpiresAt>clock()+custodyLimits.skewMs*1000"],
 ['scope widening accepted',"if(!parts.every(part=>previous.includes(part)&&entry.scopes.includes(part)))return bad('SCOPE_WIDENED');",""],
 ['rotated refresh not stored',"grant.refreshToken??refreshToken","refreshToken"],
 ['old refresh discarded before the commit',"   let committed:boolean;","   if(grant.refreshToken!==null)await store.markReauthorizationRequired(record.id,claimId);\n   let committed:boolean;"],
 ['invalid_grant not marked',"if(status===400&&plain(reply)&&reply.error==='invalid_grant'){","if(false){"],
 ['Microsoft reports revoked',"const state=kind==='local-only-owner-removal'||kind==='provider-refresh-delete'&&!allowPathTokenRevocation?'revocation-owner-action'","const state=kind==='provider-refresh-delete'&&!allowPathTokenRevocation?'revocation-owner-action'"],
 ['HubSpot default calls the provider',"if(kind==='provider-refresh-delete')return allowPathTokenRevocation?refresh:[];","if(kind==='provider-refresh-delete')return refresh;"],
 ['uncertain revocation reply treated as revoked',"return definitive.includes(response.status);","return true;"],
 ['owner check removed',"check(record!==null&&record.ownerId===ownerId,'OWNER_MISMATCH','credential');\n  return record;","check(record!==null,'OWNER_MISMATCH','credential');\n  return record;"],
 ['admission kind not checked',"use.kind==='admitted-operation'&&typeof use.ownerId","typeof use.ownerId"],
 ['lost reply releases custody',"catch{throw new ConnectorContractError('REFRESH_UNCERTAIN',record.providerId);}\n   let text","catch{finished=await store.markReauthorizationRequired(record.id,claimId);throw new ConnectorContractError('REFRESH_UNCERTAIN',record.providerId);}\n   let text"],
 ['lost commit does not stash the new refresh token',"throw new ConnectorContractError(await stash(record,claimId,token)?'REFRESH_DISCARDED':'REFRESH_DISCARDED_UNSTASHED',record.providerId);","throw new ConnectorContractError('REFRESH_DISCARDED',record.providerId);"],
 ['ciphertext not bound to the generation',"`${credentialId}-${generation}`","`${credentialId}-1`"],
 ['token response not size-bounded',"size+=value.byteLength;check(size<=custodyLimits.maxResponseBytes,'RESPONSE_TOO_LARGE','response');chunks.push(value);","size+=value.byteLength;chunks.push(value);"],
 ['refresh request follows redirects',"body:form(fields),redirect:'manual',signal:AbortSignal.timeout(custodyLimits.timeoutMs)});","body:form(fields),redirect:'follow',signal:AbortSignal.timeout(custodyLimits.timeoutMs)});"],
 ['GitHub access delete settles refresh custody',"const everything=kind==='local-only-owner-removal'||complete&&(kind==='rfc7009'","const everything=kind==='local-only-owner-removal'||complete&&(kind==='github-token-delete'||kind==='rfc7009'"],
 ['competing revocation claim ignored',"if(!await store.claimRevocation(record.id,{claimId,expiresAt:clock()+custodyLimits.revocationLeaseMs,now:clock()})){","await store.claimRevocation(record.id,{claimId,expiresAt:clock()+custodyLimits.revocationLeaseMs,now:clock()});if(false){"],
 ['refused response with an unkeepable refresh token reported as a plain refusal',"issuedKept?grant.code:'REFRESH_DISCARDED_UNSTASHED'","grant.code"],
 ['none and retained-unused providers may refresh',"check(entry.authorization.refresh==='single-flight','REFRESH_NOT_ALLOWED',record.providerId);",""],
];
const killedBy={
 'claim compare-and-swap ignored':'concurrent uses make exactly one token-endpoint call',
 'refresh while access is still valid':'a still-valid access token is returned without any provider call',
 'scope widening accepted':'scope narrowing is accepted and stored; widening is refused',
 'rotated refresh not stored':'a rotated refresh credential, new access token, scopes and expiry are written by one guarded commit',
 'old refresh discarded before the commit':'a crash between the token response and the commit leaves the old refresh credential intact',
 'invalid_grant not marked':'invalid_grant requires reauthorization',
 'Microsoft reports revoked':'Microsoft: no provider call',
 'HubSpot default calls the provider':'HubSpot: by default no token is sent in a URL path',
 'uncertain revocation reply treated as revoked':'anything but a definitive acknowledgement keeps encrypted revocation work',
 'owner check removed':'refresh is refused for another owner and for an unknown credential',
 'admission kind not checked':'refresh is refused without an admitted operation',
 'lost reply releases custody':'a lost reply fails only that use',
 'lost commit does not stash the new refresh token':'a disconnect during an in-flight refresh discards the new access token',
 'ciphertext not bound to the generation':'ciphertext is bound to its generation',
 'token response not size-bounded':'a lost reply fails only that use',
 'refresh request follows redirects':'the token request is the fixed catalog endpoint',
 'GitHub access delete settles refresh custody':'GitHub token delete: an access-token delete does not settle the retained refresh credential',
 'competing revocation claim ignored':'competing disconnects make at most one provider call',
 'refused response with an unkeepable refresh token reported as a plain refusal':'a credential that cannot be preserved as revocation work is reported, and a live credential is not cleared without it',
 'none and retained-unused providers may refresh':'providers with refresh kind none or retained-unused never refresh',
};
let killed=0;
const source=read(file);
for(const [name,find,replace] of mutants){
 assert.equal(source.split(find).length,2,`mutant "${name}" must match ${file} exactly once`);
 const mutant=await load({[file]:source.replace(find,()=>replace)}).catch(error=>{throw new Error(`mutant "${name}" does not bundle`,{cause:error});});
 await assert.rejects(suite(mutant,'frozen'),e=>{
  if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}${e.cause?' / '+String(e.cause.message).slice(0,160):''}`);
  assert.ok(killedBy[name]&&e.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${e.message}${e.cause?' / '+e.cause.message:''}`);return true;
 },`mutant survived: ${name}`);
 killed++;
}
assert.equal(killed,mutants.length);
console.log(`connector-credential-custody: ${suiteCount} source checks on each of 2 store implementations (frozen views and JSON round trips) and 3 static checks passed against src/connector-catalog/credential-custody.ts; ${killed}/${mutants.length} source mutants caught (synthetic providers and tokens; no database, network, credential or model).`);
