import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {buildRequest,connectorCatalog,createReferenceRuntime,digest,graphqlDocuments,providers,validateCatalog} from '../tools/prototypes/connectors.mjs';

// WH-056 / WH-140 offline connector conformance harness. Synthetic providers and invented identifiers only:
// no database, network, OAuth client, credential, model or provider account. It proves the frozen contract and the
// reference runtime, plus exact agreement with the existing pure GitHub/Cloudflare recovery/vault/catalogue functions.
// It does not prove the D1-backed adapters; WH-142 must run runConformance() against them.
const bundled=await build({stdin:{contents:"export {backupPathsQuery,backupPathsVariables,backupRecoveryRead,dnsRecoveryRead} from './src/connection-recovery';export {seal,unseal} from './src/connection-vault';export {launchFeatureCatalogue,connectionProviders} from './src/plan-features';export {isConnectionProvider} from './src/connection-handoff-shape';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'neutral',write:false,logLevel:'silent'});
const src=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));

let count=0;
async function test(name,fn){try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}}
const rejects=async(fn,code)=>assert.rejects(async()=>fn(),e=>{assert.equal(e.code,code);return true;});
const throws=(fn,code)=>assert.throws(fn,e=>{assert.equal(e.code,code);return true;});
const owner=(ownerId='owner-a')=>({kind:'owner',ownerId});
const clone=()=>structuredClone(connectorCatalog);

// ---------- Frozen catalog ----------
await test('frozen catalog is valid and covers exactly the seven selected providers',()=>{
 assert.equal(validateCatalog(connectorCatalog),true);
 assert.deepEqual(Object.keys(connectorCatalog.providers).sort(),[...providers].sort());
});
await test('catalog providers and readiness match the launch feature catalogue',()=>{
 const features=new Map(src.launchFeatureCatalogue.features.map(f=>[f.id,f]));
 for(const [p,e] of Object.entries(connectorCatalog.providers)){
  const f=features.get(e.featureId);assert.ok(f,e.featureId);assert.equal(f.connection,p);
  assert.equal(f.implementation==='private-test'?'private-test':'planned',e.readiness);
 }
 assert.deepEqual(src.connectionProviders.map(p=>p.id).sort(),[...providers].sort());
});
await test('every planned provider is planned, and no provider claims live acceptance',()=>{
 for(const e of Object.values(connectorCatalog.providers))assert.notEqual(e.readiness,'live-accepted');
});
await test('operation data classes are current lifecycle classes or the reserved/proposed connector classes',()=>{
 const classes=new Map(JSON.parse(readFileSync(new URL('../docs/data-lifecycle.json',import.meta.url))).classes.map(c=>[c.id,c.storageStatus]));
 for(const [p,e] of Object.entries(connectorCatalog.providers))for(const [id,op] of Object.entries(e.operations)){
  if(op.dataClass==='connector-receipts'){assert.equal(classes.has('connector-receipts'),false,'proposed class is registered by WH-143');continue;}
  assert.ok(classes.has(op.dataClass),`${p}.${id}`);
  assert.equal(classes.get(op.dataClass),e.readiness==='planned'?'planned':'current',`${p}.${id}`);
 }
});
const invalid=(name,mutate,code)=>test(name,()=>{const c=clone();mutate(c);throws(()=>validateCatalog(c),code);});
await invalid('future contract version',c=>c.contractVersion=2,'UNSUPPORTED_VERSION');
await invalid('unknown provider',c=>c.providers.slack=c.providers.gmail,'UNKNOWN_PROVIDER');
await invalid('plain-HTTP origin',c=>c.providers.github.origins.push('http://api.github.com'),'HOST_NOT_ALLOWED');
await invalid('origin with port',c=>c.providers.github.origins.push('https://api.github.com:8443'),'HOST_NOT_ALLOWED');
await invalid('origin with userinfo',c=>c.providers.github.origins.push('https://user@api.github.com'),'HOST_NOT_ALLOWED');
await invalid('IP-literal origin',c=>c.providers.github.origins.push('https://140.82.112.5'),'HOST_NOT_ALLOWED');
await invalid('wildcard origin',c=>c.providers.gmail.origins.push('https://*.googleapis.com'),'HOST_NOT_ALLOWED');
await invalid('operation host outside provider origins',c=>c.providers.gmail.operations['message.get'].origin='https://www.googleapis.com','HOST_NOT_ALLOWED');
await invalid('path traversal in template',c=>c.providers.cloudflare.operations['zone.get'].path='/client/v4/../zones/{zone}','INVALID_PATH');
await invalid('absolute URL as path',c=>c.providers.cloudflare.operations['zone.get'].path='//evil.example/{zone}','INVALID_PATH');
await invalid('query embedded in path',c=>c.providers.cloudflare.operations['zone.get'].path='/client/v4/zones/{zone}?x=1','INVALID_PATH');
await invalid('caller-supplied URL field',c=>c.providers.github.operations['repository.get'].url='https://evil.example','UNKNOWN_FIELD');
await invalid('undeclared parameter in template',c=>c.providers.github.operations['repository.get'].path='/repos/{owner}/{name}/{extra}','PARAM_MISMATCH');
await invalid('free-form URL parameter type',c=>c.providers.github.operations['repository.get'].params.owner='url','INVALID_PARAM_TYPE');
await invalid('operation scope not requested by provider',c=>c.providers.cloudflare.operations['zone.get'].scopes=['account.write'],'SCOPE_NOT_DECLARED');
await invalid('rule authority on a read',c=>c.providers.gmail.operations['messages.search'].authority=['owner-request','approved-rule'],'RULE_READ_FORBIDDEN');
await invalid('rule-only operation without owner request',c=>c.providers.hubspot.operations['contact.create'].authority=['approved-rule'],'INVALID_AUTHORITY');
await invalid('action without reconciliation reads',c=>c.providers.cloudflare.operations['dnsRecord.create'].reconcile=[],'INVALID_ACTION_CONTRACT');
await invalid('action without idempotency',c=>c.providers.cloudflare.operations['dnsRecord.create'].idempotency=null,'INVALID_ACTION_CONTRACT');
await invalid('reconciliation through another action',c=>c.providers.github.operations['backup.commit'].reconcile=['backup.commit'],'INVALID_RECONCILE');
await invalid('missing price',c=>delete c.providers.github.operations['backup.commit'].price,'MISSING_FIELD');
await invalid('nonzero price disguised as plan inclusion',c=>c.providers.github.operations['backup.commit'].price={customerUnits:5,basis:'plan-inclusion'},'INVALID_PRICE');
await invalid('model-context destination with owner-control consent',c=>c.providers.gmail.operations['messages.search'].consent='owner-control','CONSENT_TOO_WEAK');
await invalid('unbounded response',c=>c.providers.gmail.operations['message.get'].bounds.maxBytes=50*1048576,'INVALID_BOUNDS');
await invalid('access lifetime above eight hours',c=>c.providers.gmail.authorization.maxAccessSeconds=86400,'INVALID_LIFETIME');
await invalid('revocation endpoint with query',c=>c.providers.cloudflare.authorization.revoke='https://dash.cloudflare.com/oauth2/revoke?next=x','HOST_NOT_ALLOWED');
await invalid('local-only revocation claiming an endpoint',c=>c.providers['outlook-email'].authorization.revoke='https://graph.microsoft.com/x','INVALID_REVOCATION');

// ---------- Request construction: no caller URL, typed parameters only ----------
await test('built requests use exact origin, manual redirects and encoded typed parameters',()=>{
 const r=buildRequest(connectorCatalog,'github','branch.head',{owner:'synthetic-org',name:'site',branch:'feature/x'});
 assert.equal(r.url,'https://api.github.com/repos/synthetic-org/site/git/ref/heads/feature%2Fx');assert.equal(r.redirect,'manual');assert.equal(r.method,'GET');
});
for(const [name,params,code] of [
 ['host injection in owner',{owner:'evil.example/x',name:'site'},'INVALID_PARAM'],
 ['traversal in name',{owner:'org',name:'..'},'INVALID_PARAM'],
 ['extra parameter',{owner:'org',name:'site',url:'https://evil.example'},'UNKNOWN_FIELD'],
 ['missing parameter',{owner:'org'},'MISSING_FIELD'],
])await test(`request refuses ${name}`,()=>throws(()=>buildRequest(connectorCatalog,'github','repository.get',params),code));
await test('GraphQL operations accept only the registered document',()=>{
 throws(()=>buildRequest(connectorCatalog,'github','backup.paths',{},{query:'mutation{deleteRepository}',variables:{}}),'BODY_NOT_ALLOWED');
 throws(()=>buildRequest(connectorCatalog,'github','backup.paths',{},{query:graphqlDocuments.BackupCommit,variables:{}}),'BODY_NOT_ALLOWED');
});
await test('JSON bodies are closed to declared fields',()=>throws(()=>buildRequest(connectorCatalog,'cloudflare','dnsRecord.create',{zone:'a'.repeat(32)},{type:'TXT',name:'x.example',content:'v',ttl:1,comment:'m',priority:1}),'BODY_NOT_ALLOWED'));
await test('unknown operation and reads with bodies are refused',()=>{
 throws(()=>buildRequest(connectorCatalog,'github','repository.delete',{}),'UNKNOWN_OPERATION');
 throws(()=>buildRequest(connectorCatalog,'github','installations.list',{},{x:1}),'BODY_NOT_ALLOWED');
});

// ---------- Existing GitHub/Cloudflare pure functions agree with the catalog ----------
const zone='0123456789abcdef0123456789abcdef',strip=p=>p.replace(/^\/client\/v4/,'');
await test('GitHub BackupPaths document is the exact recovery query in source',()=>assert.equal(graphqlDocuments.BackupPaths,src.backupPathsQuery));
await test('Cloudflare dnsRecoveryRead admits exactly the catalog reconcile reads',()=>{
 const a={zone_id:zone,record_name:'_tellumo.www.example.com'};
 for(const op of connectorCatalog.providers.cloudflare.operations['dnsRecord.create'].reconcile){
  const params=op==='zone.get'?{zone}:{zone,name:a.record_name};
  assert.equal(src.dnsRecoveryRead(a,strip(buildRequest(connectorCatalog,'cloudflare',op,params).path),'GET',undefined),true,op);
 }
 const create=buildRequest(connectorCatalog,'cloudflare','dnsRecord.create',{zone},{type:'TXT',name:a.record_name,content:'"x"',ttl:1,comment:'m'});
 assert.equal(src.dnsRecoveryRead(a,strip(create.path),'POST',JSON.parse(create.body)),false);
 assert.equal(src.dnsRecoveryRead(a,strip(buildRequest(connectorCatalog,'cloudflare','zone.get',{zone:'f'.repeat(32)}).path),'GET',undefined),false);
 assert.equal(src.dnsRecoveryRead(a,strip(buildRequest(connectorCatalog,'cloudflare','zones.list',{page:1}).path),'GET',undefined),false);
});
await test('GitHub backupRecoveryRead admits exactly the catalog reconcile reads',()=>{
 const b={repo_owner:'synthetic-org',repo_name:'site',branch:'main',path:'tellumo/11111111-1111-4111-8111-111111111111/versions/22222222-2222-4222-8222-222222222222'},head='a'.repeat(40);
 const repo=buildRequest(connectorCatalog,'github','repository.get',{owner:b.repo_owner,name:b.repo_name});
 const ref=buildRequest(connectorCatalog,'github','branch.head',{owner:b.repo_owner,name:b.repo_name,branch:b.branch});
 const paths=buildRequest(connectorCatalog,'github','backup.paths',{},{query:graphqlDocuments.BackupPaths,variables:src.backupPathsVariables(b.repo_owner,b.repo_name,b.path,head)});
 assert.equal(src.backupRecoveryRead(b,repo.path,{method:'GET'}),true);
 assert.equal(src.backupRecoveryRead(b,ref.path,{method:'GET'}),true);
 assert.equal(src.backupRecoveryRead(b,paths.path,{method:'POST',body:paths.body}),true);
 const commit=buildRequest(connectorCatalog,'github','backup.commit',{},{query:graphqlDocuments.BackupCommit,variables:{input:{}}});
 assert.equal(src.backupRecoveryRead(b,commit.path,{method:'POST',body:commit.body}),false);
 assert.deepEqual(connectorCatalog.providers.github.operations['backup.commit'].reconcile,['repository.get','branch.head','backup.paths']);
});
const keyring=JSON.stringify({version:2,active:'fixture-current',keys:[{id:'fixture-current',secret:'ab'.repeat(32)}]});
await test('existing vault binds ciphertext to provider, purpose, owner and record',async()=>{
 const sealed=await src.seal(keyring,'whumpo:github:token:owner-a:record-1','synthetic-token');
 assert.equal(await src.unseal(keyring,'whumpo:github:token:owner-a:record-1',sealed),'synthetic-token');
 for(const context of ['whumpo:cloudflare:token:owner-a:record-1','whumpo:github:token:owner-b:record-1','whumpo:github:pkce:owner-a:record-1','whumpo:github:token:owner-a:record-2'])
  await assert.rejects(()=>src.unseal(keyring,context,sealed));
});
await test('gap G-C3/G-C4: current vault contexts and handoff providers admit only GitHub and Cloudflare',async()=>{
 await assert.rejects(()=>src.seal(keyring,'whumpo:gmail:token:owner-a:record-1','synthetic-token'));
 assert.deepEqual(providers.filter(p=>src.isConnectionProvider(p)),['github','cloudflare']);
});

// ---------- Reusable runtime conformance suite ----------
const allowedOrigins=new Set(Object.values(connectorCatalog.providers).flatMap(e=>[...e.origins,...[e.authorization.token,e.authorization.revoke].filter(Boolean).map(u=>new URL(u).origin)]));
function fakeProvider(){
 const s={calls:[],effects:[],mode:{},token:{},revoke:200};
 async function transport(req){
  s.calls.push(req);assert.equal(req.redirect,'manual');const u=new URL(req.url);assert.ok(allowedOrigins.has(u.origin),'unexpected host '+u.origin);
  if(s.mode.beforeReply){const f=s.mode.beforeReply;s.mode.beforeReply=null;await f(req);}
  if(/\/(token|oauth2\/v2\.0\/token|oauth\/v1\/token)$/.test(u.pathname)){
   if(s.token.lose)throw Error('connection reset');
   if(s.token.invalid)return {status:400,json:{error:'invalid_grant'}};
   s.token.count=(s.token.count??0)+1;return {status:200,json:{access_token:'synthetic-access-'+s.token.count,token_type:'Bearer',expires_in:3600}};
  }
  if(/revoke|refresh-tokens|applications/.test(u.pathname))return {status:s.revoke,json:null};
  if(s.mode.status)return {status:s.mode.status,json:{}};
  if(s.mode.redirect)return {status:302,json:null};
  if(req.method==='POST'&&s.mode.action!=='read'&&/send|events$|contacts$|dns_records$/.test(u.pathname)){
   const marker=JSON.parse(req.body).marker??JSON.parse(req.body).comment??JSON.parse(req.body).properties?.marker;
   if(s.mode.lose==='before')throw Error('timeout before provider accepted');
   if(s.mode.reject)return {status:422,json:{error:'invalid'}};
   s.effects.push(marker);
   if(s.mode.lose==='after')throw Error('response lost after provider accepted');
   return {status:200,json:{id:'provider-'+s.effects.length}};
  }
  return {status:200,json:{items:s.effects.map(marker=>({marker})),note:s.mode.injected??null}};
 }
 return {s,transport};
}
const liveCatalog=()=>{const c=clone();for(const e of Object.values(c.providers))e.readiness='live-accepted';return c;};
const trainingRoute={connectorContent:{trainingUse:true,approvedForConnectorContent:false}},approvedRoute={connectorContent:{trainingUse:false,approvedForConnectorContent:true}};
const token=(scope,extra={})=>({access_token:'synthetic-access',token_type:'Bearer',expires_in:3600,...(scope?{scope}:{}),...extra});
const gmailScopes='https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
const send={raw:'c3ludGhldGlj',threadId:'t1'};

/** Conformance cases any adapter runtime must pass. `make` returns {rt, s, clock}. */
async function runConformance(label,make){
 const t=(name,fn)=>test(`${label}: ${name}`,fn);
 // Host/scope allowlist.
 await t('only allowlisted hosts are contacted and redirects are refused, not followed',async()=>{
  const {rt,s}=make();rt.connect('owner-a','cloudflare',token('zone.read dns.read dns.write',{expires_in:3600}));
  s.mode.redirect=true;await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'REDIRECT_REFUSED');assert.equal(s.calls.length,1);
 });
 await t('token responses with widened scope, long lifetime, wrong type or unexpected refresh are refused',async()=>{
  const {rt}=make();
  throws(()=>rt.connect('owner-a','cloudflare',token('zone.read dns.read dns.write account.write')),'SCOPE_WIDENED');
  throws(()=>rt.connect('owner-a','cloudflare',token(undefined,{expires_in:86400*30})),'INVALID_TOKEN');
  throws(()=>rt.connect('owner-a','cloudflare',token(undefined,{token_type:'mac'})),'INVALID_TOKEN');
  throws(()=>rt.connect('owner-a','cloudflare',token(undefined,{refresh_token:'synthetic-refresh'})),'UNEXPECTED_REFRESH');
  rt.connect('owner-a','cloudflare',token());throws(()=>rt.connect('owner-a','cloudflare',token()),'DISCONNECT_FIRST');
 });
 await t('an operation needing an ungranted scope is refused before dispatch',async()=>{
  const {rt,s}=make();rt.connect('owner-a','gmail',token('https://www.googleapis.com/auth/gmail.readonly',{refresh_token:'r'}));
  await rejects(()=>rt.prepareAction(owner(),'gmail','message.send',{},send),'INSUFFICIENT_SCOPE');assert.equal(s.calls.length,0);
 });
 // Revoked / expired credentials.
 await t('disconnect disables local access before revocation; later use never reaches the provider',async()=>{
  const {rt,s}=make();rt.connect('owner-a','cloudflare',token());s.revoke=500;
  assert.equal((await rt.disconnect('owner-a','cloudflare')).state,'revocation-pending');const before=s.calls.length;
  await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'NOT_CONNECTED');assert.equal(s.calls.length,before);
  assert.equal(rt.status('owner-a','cloudflare').consent,'revocation-pending');
 });
 await t('a provider without a revocation endpoint reports owner action, never claims revocation',async()=>{
  const {rt,s}=make();rt.connect('owner-a','outlook-email',token('offline_access Mail.Read Mail.Send',{refresh_token:'r'}));
  assert.equal((await rt.disconnect('owner-a','outlook-email')).state,'revocation-owner-action');assert.equal(s.calls.length,0);
 });
 await t('expired access without refresh custody is refused with zero provider calls',async()=>{
  const {rt,s}=make();rt.connect('owner-a','cloudflare',token());rt.expire('owner-a','cloudflare');
  await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'EXPIRED');assert.equal(s.calls.length,0);
  assert.equal(rt.status('owner-a','cloudflare').consent,'expired');
 });
 await t('refresh is single-flight, bounded and never widens scope',async()=>{
  const {rt,s}=make();rt.connect('owner-a','google-calendar',token(undefined,{refresh_token:'r'}));rt.expire('owner-a','google-calendar');
  await Promise.all([rt.read(owner(),'google-calendar','calendars.list',{}),rt.read(owner(),'google-calendar','calendars.list',{})]);
  assert.equal(s.calls.filter(c=>c.url.endsWith('/token')).length,1);
 });
 await t('lost refresh reply fails that use and retries the same custody next time; invalid_grant requires reauthorization',async()=>{
  const {rt,s}=make();rt.connect('owner-a','google-calendar',token(undefined,{refresh_token:'r'}));rt.expire('owner-a','google-calendar');
  s.token.lose=true;await rejects(()=>rt.read(owner(),'google-calendar','calendars.list',{}),'REFRESH_UNCERTAIN');
  s.token.lose=false;s.token.invalid=true;await rejects(()=>rt.read(owner(),'google-calendar','calendars.list',{}),'REAUTHORIZATION_REQUIRED');
  const before=s.calls.length;await rejects(()=>rt.read(owner(),'google-calendar','calendars.list',{}),'NOT_CONNECTED');assert.equal(s.calls.length,before);
  assert.equal(rt.status('owner-a','google-calendar').consent,'reauthorization-required');
 });
 await t('disconnect during an in-flight read refuses the stale result',async()=>{
  const {rt,s}=make();rt.connect('owner-a','cloudflare',token());s.mode.beforeReply=()=>rt.disconnect('owner-a','cloudflare');
  await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'ACCESS_CHANGED');
 });
 await t('provider 401 marks access rejected with no retry',async()=>{
  const {rt,s}=make();rt.connect('owner-a','cloudflare',token());s.mode.status=401;
  await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'PROVIDER_REJECTED');assert.equal(s.calls.length,1);
  await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'NOT_CONNECTED');assert.equal(s.calls.length,1);
 });
 // Durable dispatch receipts and unknown outcomes.
 const prepared=async(rt,marker='m-1')=>{rt.connect('owner-a','cloudflare',token());return rt.prepareAction(owner(),'cloudflare','dnsRecord.create',{zone},{type:'TXT',name:'_tellumo.www.example.com',content:'"v"',ttl:1,comment:marker});};
 const observe=marker=>r=>({operationId:'dnsRecords.findExact',params:{zone,name:'_tellumo.www.example.com'},matches:j=>j.items.some(i=>i.marker===marker)});
 await t('lost response after the provider applied: uncertain, never redispatched, reconciled by readback',async()=>{
  const {rt,s}=make(),p=await prepared(rt);s.mode.lose='after';
  assert.equal((await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price})).state,'uncertain');
  s.mode.lose=null;assert.deepEqual(await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price}),{state:'uncertain',dispatched:false});
  assert.equal((await rt.reconcile(owner(),p.receiptId,observe('m-1'))).state,'observed');
  assert.equal(s.effects.length,1);assert.equal(rt.receipt(p.receiptId).dispatches,1);
 });
 await t('lost request before the provider applied stays held; reconciliation never resends',async()=>{
  const {rt,s}=make(),p=await prepared(rt);s.mode.lose='before';
  await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price});s.mode.lose=null;
  assert.equal((await rt.reconcile(owner(),p.receiptId,observe('m-1'))).state,'uncertain');
  await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price});
  assert.equal(s.effects.length,0);assert.equal(rt.receipt(p.receiptId).dispatches,1);
 });
 await t('concurrent confirmations dispatch once',async()=>{
  const {rt,s}=make(),p=await prepared(rt),c={reviewDigest:p.reviewDigest,acceptedPrice:p.price};
  await Promise.all([rt.confirmAction(owner(),p.receiptId,c),rt.confirmAction(owner(),p.receiptId,c),rt.confirmAction(owner(),p.receiptId,c)]);
  assert.equal(s.effects.length,1);assert.equal(rt.receipt(p.receiptId).dispatches,1);
 });
 await t('a definitive provider rejection fails without retry; it is not uncertain',async()=>{
  const {rt,s}=make(),p=await prepared(rt);s.mode.reject=true;
  assert.equal((await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price})).state,'failed');
  assert.equal((await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price})).dispatched,false);
 });
 await t('reconciliation is limited to the action\'s declared reads',async()=>{
  const {rt,s}=make(),p=await prepared(rt);s.mode.lose='before';await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price});s.mode.lose=null;
  await rejects(()=>rt.reconcile(owner(),p.receiptId,()=>({operationId:'dnsRecord.create',params:{zone},body:{type:'TXT'},matches:()=>true})),'RECONCILE_NOT_DECLARED');
  await rejects(()=>rt.reconcile(owner(),p.receiptId,()=>({operationId:'zones.list',params:{page:1},matches:()=>true})),'RECONCILE_NOT_DECLARED');
  await rejects(()=>rt.reconcile(owner('owner-b'),p.receiptId,observe('m-1')),'NOT_FOUND');
  assert.equal(s.effects.length,0);
 });
 await t('price is explicit and bound into the exact review',async()=>{
  const {rt,clock}=make(),p=await prepared(rt);
  assert.deepEqual(p.price,{customerUnits:0,basis:'plan-inclusion'});
  await rejects(()=>rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest}),'PRICE_NOT_ACCEPTED');
  await rejects(()=>rt.confirmAction(owner(),p.receiptId,{reviewDigest:'0'.repeat(64),acceptedPrice:p.price}),'STALE_REVIEW');
  rt.catalog.providers.cloudflare.operations['dnsRecord.create'].price={customerUnits:3,basis:'quoted'};
  await rejects(()=>rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price}),'STALE_REVIEW');
  rt.catalog.providers.cloudflare.operations['dnsRecord.create'].price={customerUnits:0,basis:'plan-inclusion'};
  clock.t+=11*60e3;await rejects(()=>rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price}),'REVIEW_EXPIRED');
 });
 await t('a review bound to replaced access is stale',async()=>{
  const {rt}=make(),p=await prepared(rt);await rt.disconnect('owner-a','cloudflare');rt.connect('owner-a','cloudflare',token());
  await rejects(()=>rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price}),'STALE_REVIEW');
 });
 // Request-bound lookup/data-use consent.
 const gmail=(rt)=>rt.connect('owner-a','gmail',token(gmailScopes,{refresh_token:'r'}));
 await t('content reads need confirmed consent bound to owner, credential, exact query and destination',async()=>{
  const {rt,s}=make();gmail(rt);
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'invoice'}),'CONSENT_REQUIRED');
  const c=rt.proposeLookup(owner(),'gmail','messages.search',{q:'invoice'},'owner-panel');
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'invoice'},{consentId:c.consentId}),'CONSENT_MISMATCH');
  throws(()=>rt.confirmLookup(owner('owner-b'),c.consentId),'NOT_FOUND');rt.confirmLookup(owner(),c.consentId);
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'payroll'},{consentId:c.consentId}),'CONSENT_MISMATCH');
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'invoice'},{consentId:c.consentId,destination:'model-context'}),'CONSENT_REQUIRED');
  await rejects(()=>rt.read(owner('owner-b'),'gmail','messages.search',{q:'invoice'},{consentId:c.consentId}),'NOT_CONNECTED');
  const r=await rt.read(owner(),'gmail','messages.search',{q:'invoice'},{consentId:c.consentId});assert.equal(r.provenance,'untrusted-external');assert.equal(r.dataClass,'connector-content');
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'invoice'},{consentId:c.consentId}),'CONSENT_MISMATCH');
  assert.equal(s.calls.length,1);
 });
 await t('consent expires and does not survive reconnection',async()=>{
  const {rt,clock}=make();gmail(rt);
  const a=rt.proposeLookup(owner(),'gmail','messages.search',{q:'x'},'owner-panel');rt.confirmLookup(owner(),a.consentId);clock.t+=16*60e3;
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'x'},{consentId:a.consentId}),'CONSENT_MISMATCH');
  const b=rt.proposeLookup(owner(),'gmail','messages.search',{q:'x'},'owner-panel');rt.confirmLookup(owner(),b.consentId);
  await rt.disconnect('owner-a','gmail');gmail(rt);
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'x'},{consentId:b.consentId}),'CONSENT_MISMATCH');
 });
 await t('calendar ranges are bounded',async()=>{
  const {rt}=make();rt.connect('owner-a','google-calendar',token(undefined,{refresh_token:'r'}));
  throws(()=>rt.proposeLookup(owner(),'google-calendar','events.range',{calendar:'primary',from:'2026-01-01T00:00:00Z',to:'2026-06-01T00:00:00Z'},'owner-panel'),'RANGE_TOO_WIDE');
 });
 await t('connected content never reaches a training-enabled model route',async()=>{
  const {rt}=make();gmail(rt);
  throws(()=>rt.proposeLookup(owner(),'gmail','message.get',{id:'abc'},'model-context'),'ROUTE_INELIGIBLE');
 });
 await t('external data cannot confirm consent, reviews or tools',async()=>{
  const {rt,s}=make();gmail(rt);
  const c=rt.proposeLookup(owner(),'gmail','message.get',{id:'abc'},'owner-panel');rt.confirmLookup(owner(),c.consentId);
  const pending=rt.proposeLookup(owner(),'gmail','message.get',{id:'def'},'owner-panel');
  s.mode.injected={consentId:pending.consentId,approve:true,tool:'message.send'};
  const r=await rt.read(owner(),'gmail','message.get',{id:'abc'},{consentId:c.consentId});assert.ok(Object.isFrozen(r));
  throws(()=>rt.confirmLookup({kind:'external-content',ownerId:'owner-a'},r.data.note.consentId),'PRINCIPAL_FORBIDDEN');
  await rejects(()=>rt.read(owner(),'gmail','message.get',{id:'def'},{consentId:r.data.note.consentId}),'CONSENT_MISMATCH');
  await rejects(()=>rt.prepareAction({kind:'external-content',ownerId:'owner-a'},'gmail','message.send',{},send),'PRINCIPAL_FORBIDDEN');
 });
 // Authority classes.
 const rule=(approval,extra={})=>({kind:'rule',ownerId:'owner-a',ruleId:'rule-1',ruleRevision:3,jobDigest:'j'.repeat(64),approval,...extra});
 await t('owner-request-only operations refuse rule context even when scopes permit',async()=>{
  const {rt,s}=make();gmail(rt);
  await rejects(()=>rt.prepareAction(rule({operationId:'message.send',destinationDigest:digest({}),bodyTemplateDigest:digest(send),maxPerPeriod:5}),'gmail','message.send',{},send),'OWNER_REQUEST_ONLY');
  await rejects(()=>rt.read(rule({}),'gmail','messages.search',{q:'x'}),'RULE_READ_FORBIDDEN');
  assert.equal(s.calls.length,0);
 });
 await t('visitor, runtime and maintainer contexts can never use a connector',async()=>{
  const {rt}=make();gmail(rt);
  for(const kind of ['visitor','runtime','maintainer'])await rejects(()=>rt.read({kind,ownerId:'owner-a'},'gmail','messages.search',{q:'x'}),'PRINCIPAL_FORBIDDEN');
 });
 return t;
}

let clockBase=Date.parse('2026-10-04T00:00:00Z');
function referenceFactory(catalog=clone,routes=trainingRoute){
 return ()=>{const clock={t:clockBase},{s,transport}=fakeProvider();return {rt:createReferenceRuntime({catalog:catalog(),transport,now:()=>clock.t,routes}),s,clock};};
}
await runConformance('reference',referenceFactory());

// Reference-only cases that need a live-accepted synthetic catalog or eligibility changes.
await test('approved deterministic rule: exact destination, template and limit; requires an accepted adapter',async()=>{
 const contact={properties:{email:'lead@example.test',marker:'m-r'}},approval={operationId:'contact.create',destinationDigest:digest({}),bodyTemplateDigest:digest(contact),maxPerPeriod:1};
 const planned=referenceFactory()();planned.rt.connect('owner-a','hubspot',token(undefined,{refresh_token:'r',expires_in:1800}));
 await rejects(()=>planned.rt.prepareAction({kind:'rule',ownerId:'owner-a',ruleId:'rule-1',ruleRevision:3,jobDigest:'j',approval},'hubspot','contact.create',{},contact),'ADAPTER_NOT_ACCEPTED');
 const {rt,s}=referenceFactory(liveCatalog)();rt.connect('owner-a','hubspot',token(undefined,{refresh_token:'r',expires_in:1800}));
 const r=principal=>({kind:'rule',ownerId:'owner-a',ruleId:'rule-1',ruleRevision:3,jobDigest:'j',...principal});
 await rejects(()=>rt.prepareAction(r({approval}),'hubspot','contact.create',{},{properties:{email:'other@example.test',marker:'m-r'}}),'RULE_DESTINATION_MISMATCH');
 await rejects(()=>rt.prepareAction(r({}),'hubspot','contact.create',{},contact),'RULE_APPROVAL_REQUIRED');
 const p=await rt.prepareAction(r({approval}),'hubspot','contact.create',{},contact);
 assert.equal((await rt.confirmAction(r({approval}),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price})).state,'applied');
 assert.equal(rt.receipt(p.receiptId).authority,'approved-rule');assert.equal(s.effects.length,1);
 await rejects(()=>rt.prepareAction(r({approval}),'hubspot','contact.create',{},contact),'RULE_LIMIT');
});
await test('inclusion, configuration, consent and readiness are reported and enforced separately',async()=>{
 const {rt,s}=referenceFactory()();rt.connect('owner-a','cloudflare',token());
 assert.deepEqual(rt.status('owner-a','cloudflare'),{inclusion:'included',configuration:'configured',consent:'active',readiness:'private-test'});
 const p=await rt.prepareAction(owner(),'cloudflare','dnsRecord.create',{zone},{type:'TXT',name:'_tellumo.www.example.com',content:'"v"',ttl:1,comment:'m-2'});
 s.mode.lose='after';await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price});s.mode.lose=null;
 rt.setInclusion('owner-a','cloudflare',false);
 assert.deepEqual(rt.status('owner-a','cloudflare'),{inclusion:'not-included',configuration:'configured',consent:'active',readiness:'private-test'});
 await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'NOT_INCLUDED');
 // Loss of eligibility keeps reconciliation of an existing effect and disconnect available.
 assert.equal((await rt.reconcile(owner(),p.receiptId,()=>({operationId:'dnsRecords.findExact',params:{zone,name:'_tellumo.www.example.com'},matches:j=>j.items.some(i=>i.marker==='m-2')}))).state,'observed');
 assert.equal((await rt.disconnect('owner-a','cloudflare')).state,'revoked');
 rt.setInclusion('owner-a','cloudflare',true);rt.setConfigured('cloudflare',false);
 assert.equal(rt.status('owner-a','cloudflare').configuration,'unconfigured');
 await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'NOT_CONFIGURED');
});
await test('an approved non-training route admits model-context consent; output stays untrusted',async()=>{
 const {rt}=referenceFactory(clone,approvedRoute)();rt.connect('owner-a','gmail',token(gmailScopes,{refresh_token:'r'}));
 const c=rt.proposeLookup(owner(),'gmail','message.get',{id:'abc'},'model-context');rt.confirmLookup(owner(),c.consentId);
 const r=await rt.read(owner(),'gmail','message.get',{id:'abc'},{consentId:c.consentId,destination:'model-context'});
 assert.equal(r.provenance,'untrusted-external');assert.equal(r.destination,'model-context');
});

console.log(`connectors-contract: ${count} offline checks passed (synthetic providers; no database, network, credential or model).`);
