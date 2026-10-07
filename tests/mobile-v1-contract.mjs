import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {admitClient,authorize,control,controlCapabilities,controlCapability,errors,excluded,exchangeHandoff,fieldTypes,interactionBindings,operationById,operations,pathParams,
 pkceChallengeFor,presentReview,prefix,pushMessage,replay,reviewKinds,sessionPolicy,validateError,validateRequest,validateResponse,verifyExchange} from '../tools/prototypes/mobile-v1.mjs';

// WH-081 offline checks for the frozen /api/mobile/v1 contract. Synthetic fixtures only: no database, HTTP, Worker, provider, device or credential.
// These prove the frozen shapes, admission rules and reference semantics, not a runtime route; WH-083/084 must test the real handlers.
const dir=new URL('./fixtures/mobile-v1/',import.meta.url),read=n=>JSON.parse(readFileSync(new URL(n,dir),'utf8'));
const text=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const fx={client:read('client.json'),operations:read('operations.json'),errors:read('errors.json'),rejections:read('rejections.json'),push:read('push.json'),reviews:read('reviews.json')};
const minimumBuild=fx.client.minimumBuild;
let count=0;
function test(name,fn){try{fn();count++;}catch(error){throw new Error(name,{cause:error});}}
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code,`expected ${code}`);

// ---- Registry integrity -------------------------------------------------------------------------------------------
test('operation IDs, method+path pairs are unique',()=>{
 assert.equal(new Set(operations.map(o=>o.id)).size,operations.length);
 assert.equal(new Set(operations.map(o=>o.method+' '+o.path)).size,operations.length);
});
test('only identity bootstrap routes are anonymous and no route is a generic proxy',()=>{
 assert.deepEqual(operations.filter(o=>o.auth==='none').map(o=>o.id),['config.read','session.loginOptions','session.loginVerify','session.handoffStart','session.handoffExchange']);
 for(const o of operations){assert.ok(!/\{[a-z]+\}\/?\*|\*/.test(o.path),o.id);assert.match(o.path,/^\/[a-z/{}A-Z-]+$/,o.id);assert.ok(['GET','POST','PUT','DELETE'].includes(o.method));}
});
test('every write declares its idempotency; reads declare none',()=>{
 for(const o of operations){
  assert.ok(['none','requestId','submissionId','uploadId','challenge-once','code-once','natural'].includes(o.idempotency),o.id);
  if(!o.write)assert.equal(o.idempotency,'none',o.id);
 }
 // Option/start routes only mint short-lived challenges; every durable effect is keyed.
 const unkeyed=operations.filter(o=>o.write&&o.idempotency==='none').map(o=>o.id).sort();
 assert.deepEqual(unkeyed,['session.handoffStart','session.loginOptions','session.reauthOptions']);
});
test('no excluded surface appears in the route table',()=>{
 for(const o of operations)assert.doesNotMatch(o.path,/passkey|recovery|kit|onboarding|billing|checkout|connection|github|cloudflare|domain|dns|backup|export|cms|publish|restore|delete|unpublish|dashboard|layout|\bviews?\b/i,o.id);
 assert.ok(operations.filter(o=>o.method==='DELETE').every(o=>o.id==='device.remove'));
 assert.ok(excluded.length>=12);
});
test('operations map to existing handlers or declare an explicit new adapter',()=>{
 for(const o of operations){
  if(o.new){assert.deepEqual(o.source,[],o.id);continue;}
  assert.ok(o.source.length>0,o.id);
  for(const [file,symbol] of o.source)assert.ok(text(file).includes(symbol),`${o.id}: ${symbol} not in ${file}`);
 }
});
test('admitted controls match src/chat-controls.ts exactly',()=>{
 const src=text('src/chat-controls.ts');
 for(const needle of ["a.type==='specificationApply'","exact(a,['type','reviewId','proposalDigest','expectedRevision'])","a.type==='confirm'&&exact(a,['type','kind','reviewId'])","site:{verb:'confirm'","application:{verb:'confirm-application'",
  "a.type==='appRestore'&&exact(a,['type','projectId','reviewId','confirmation'])","a.confirmation==='RESTORE'"])assert.ok(src.includes(needle),needle);
 assert.deepEqual(Object.keys(reviewKinds).map(k=>reviewKinds[k].capability).sort(),[...controlCapabilities].sort());
 // Fresh passkey requirement mirrors recentAuth in chatControl: specificationApply/appRestore true; confirm false.
 assert.match(src,/specificationApply[\s\S]{0,400}recentAuth:true/);
 assert.match(src,/appRestore[\s\S]*label:'Restore the exact reviewed application data.',recentAuth:true/);
 assert.equal(reviewKinds['app-restore'].freshPasskey,true);
});
test('admitted interaction field types and bindings exist in the WH-105 registry; photo bindings wait for WH-085',()=>{
 const proto=text('src/chat-interactions/protocol.ts');
 for(const b of interactionBindings)assert.ok(proto.includes(`'${b}': {mode`),b);
 for(const f of fieldTypes)assert.ok(proto.includes(`'${f}'`),f);
 assert.ok(!fieldTypes.includes('attachment'));
 assert.ok(!interactionBindings.includes('owned.photos@1')&&!interactionBindings.includes('project.photos@1'));
});
test('Chat message and request-ID limits match the existing handler',()=>{
 assert.match(text('src/chat.ts'),/content\.length > 1000|content\.length>1000/);
 assert.match(text('src/index.ts'),/16_384/);
 assert.match(text('src/chat-history.ts'),/LIMIT 51/);
});
test('identity policy constants match the shared identity contract',()=>{
 const doc=text('docs/workspace-identity.md');
 assert.match(doc,/five-minute WebAuthn challenges/);assert.match(doc,/ten-minute passkey freshness/);assert.match(doc,/sixty seconds/);assert.match(doc,/seven-day absolute expiry/);
 assert.deepEqual(sessionPolicy,{absoluteSeconds:604800,freshSeconds:600,challengeSeconds:300,handoffSeconds:300,exchangeSeconds:60});
});

// ---- Success fixtures ---------------------------------------------------------------------------------------------
test('every operation has exactly one valid success pair with a matching path',()=>{
 const ids=fx.operations.cases.map(c=>c.operation);
 assert.deepEqual([...ids].sort(),operations.map(o=>o.id).sort());
 for(const c of fx.operations.cases){
  const op=operationById[c.operation];
  assert.equal(c.request.headers['whumpo-client']!==undefined,true,c.operation);
  if(c.path)assert.doesNotThrow(()=>pathParams(op,c.path),c.operation);
  const req={headers:c.request.headers,query:c.request.query,body:c.request.body};
  if(c.request.binary){
   assert.equal(c.request.binary.contentType,op.binary.contentType);assert.ok(c.request.binary.bytes<=op.binary.maxBytes);
   validateRequest(c.operation,{...req,body:undefined},{minimumBuild});
  }else validateRequest(c.operation,req,{minimumBuild});
  if(c.response.binary)assert.equal(c.response.binary.contentType,op.binaryResponse.contentType);
  else validateResponse(c.operation,c.response.body);
  assert.equal(c.response.status,200);
 }
});
test('application reviews require the complete exact source artifact and matching digest',()=>{
 const base=structuredClone(fx.reviews.cases[0].review),source='export default ({state})=>({state,result:null})',digest=createHash('sha256').update(source).digest('hex');
 const r={...base,kind:'application',control:{type:'confirm',kind:'application',reviewId:base.reviewId},requiresFreshPasskey:false,preview:null,artifact:{kind:'application-source',source,digest}};
 validateResponse('review.list',{version:1,items:[r],denied:0,unavailable:0});
 for(const artifact of [null,{...r.artifact,source:source.slice(0,-1)},{...r.artifact,digest:'f'.repeat(64)},{...r.artifact,source:'a'.repeat(8193)}])rejects(()=>validateResponse('review.list',{version:1,items:[{...r,artifact}],denied:0,unavailable:0}),'invalid_request');
});
test('activity preserves bounded prefixed current receipt IDs',()=>{
 const body=structuredClone(fx.operations.cases.find(c=>c.operation==='activity.list').response.body);
 body.items[0].id='application-build:11111111-1111-4111-8111-111111111111';validateResponse('activity.list',body);
 for(const invalid of ['x'.repeat(81),'foreign/path','newline\nkey']){body.items[0].id=invalid;rejects(()=>validateResponse('activity.list',body),'invalid_request');}
});
test('current-client header is admitted; version and capability drift are refused',()=>{
 const h=admitClient(JSON.stringify(fx.client.current),{minimumBuild});assert.equal(h.build,42);
 rejects(()=>admitClient({...fx.client.current,build:minimumBuild-1},{minimumBuild}),'client_update_required');
 rejects(()=>admitClient({...fx.client.current,contract:2},{minimumBuild}),'client_update_required');
});
test('write responses distinguish pending from completed without implying downstream success',()=>{
 for(const id of ['chat.send','review.confirm']){
  const c=fx.operations.cases.find(x=>x.operation===id);
  assert.ok(['pending','completed'].includes(c.response.body.turnStatus));
  assert.equal(c.request.body.requestId,c.response.body.requestId);
 }
});

// ---- Rejection fixtures -------------------------------------------------------------------------------------------
function mutateResponse(kind,body){
 const b=structuredClone(body);
 if(kind==='previewPath')b.items[0].preview.path='/api/files/'+'1'.repeat(8)+'-1111-4111-8111-111111111111';
 if(kind==='approvableWithoutControl')b.items[0].control=null;
 if(kind==='unknownReviewKind')b.items[0].kind='dns';
 if(kind==='approvableExpired')b.items[0].state='expired';
 if(kind==='extraField')b.project.ownerUserId='x';
 return b;
}
for(const c of fx.rejections.cases)test('rejects: '+c.name,()=>{
 if(c.responseOf){
  const base=fx.operations.cases.find(x=>x.operation===c.responseOf).response.body;
  rejects(()=>validateResponse(c.responseOf,mutateResponse(c.mutate,base)),c.expect);
 }else rejects(()=>validateRequest(c.operation,c.request,{minimumBuild}),c.expect);
});
test('rejection suite covers stale client, cookie, absent bearer, unknown control, redirect and PKCE cases',()=>{
 const names=fx.rejections.cases.map(c=>c.name).join('|');
 for(const k of ['stale build','cookie','absent bearer','unknown control','redirect','PKCE','raw Chat command','capability'])assert.ok(names.includes(k),k);
});

// ---- Errors -------------------------------------------------------------------------------------------------------
test('every wire error code has a fixture with its fixed HTTP status',()=>{
 const seen=new Set();
 for(const [name,c] of Object.entries(fx.errors.cases)){
  validateError(c.body);const code=c.body.error.code;seen.add(code);
  assert.equal(c.status,errors[code],name);
 }
 for(const code of Object.keys(errors))if(!['unknown_field','missing_field'].includes(code))assert.ok(seen.has(code),code);
 assert.equal(errors.client_update_required,426);
 assert.equal(fx.errors.cases.client_update_required.body.error.next,'update_app');
});
test('error bodies carry no stack, SQL, provider text or identifiers',()=>{
 for(const c of Object.values(fx.errors.cases))assert.doesNotMatch(JSON.stringify(c),/stack|SELECT|INSERT|at .*\(|provider|requestId/i);
});

// ---- Review presentation: server metadata, not text, grants controls ------------------------------------------------
for(const c of fx.reviews.cases)test('review presentation: '+c.name,()=>{
 validateResponse('review.list',{version:1,items:[c.review],denied:0,unavailable:0});
 const p=presentReview(c.review,fx.reviews.clients[c.client]);
 assert.equal(p.enabled,c.enabled);if(c.reason)assert.equal(p.reason,c.reason);
});
test('a control outside the native set never reaches an enabled approval',()=>{
 for(const bad of [{type:'unpublish'},{type:'confirm',kind:'backup',reviewId:fx.reviews.cases[0].review.reviewId},{type:'githubGrant',operation:'cancel',reviewId:fx.reviews.cases[0].review.reviewId}])
  assert.throws(()=>control(bad),e=>['unsupported_control','invalid_request'].includes(e.code));
 assert.equal(controlCapability(fx.reviews.cases[1].review.control),'site.confirm');
});

// ---- Session, handoff and idempotency reference semantics -----------------------------------------------------------
const now=1_790_000_000,ready={stage:'ready',authEpoch:7,onboardingComplete:true};
const session=(over={})=>({client:'android',expiresAt:now+3600,epoch:7,proofMethod:'passkey',proofAt:now-30,...over});
test('ordinary current session passes; expiry, epoch bump and web-client tokens do not',()=>{
 assert.equal(authorize({session:session(),account:ready,opId:'chat.read',now}).freshPasskey,true);
 rejects(()=>authorize({session:session({expiresAt:now}),account:ready,opId:'chat.read',now}),'proof_required');
 rejects(()=>authorize({session:session({epoch:6}),account:ready,opId:'chat.read',now}),'proof_required');
 rejects(()=>authorize({session:session({client:'web'}),account:ready,opId:'chat.read',now}),'proof_required');
 rejects(()=>authorize({session:null,account:ready,opId:'chat.read',now}),'proof_required');
});
test('incomplete identity and welcome gates fail closed; bootstrap and sign-out stay reachable',()=>{
 for(const stage of ['enrolling','recovering'])rejects(()=>authorize({session:session(),account:{...ready,stage},opId:'chat.read',now}),'identity_incomplete');
 const early={...ready,onboardingComplete:false};
 rejects(()=>authorize({session:session(),account:early,opId:'chat.read',now}),'onboarding_required');
 rejects(()=>authorize({session:session(),account:early,opId:'project.list',now}),'onboarding_required');
 for(const id of ['bootstrap.read','session.read','session.logout'])assert.doesNotThrow(()=>authorize({session:session(),account:early,opId:id,now}),id);
});
test('specification apply needs a fresh passkey proof; site confirmation does not; handoff proof stays stale',()=>{
 const spec=fx.reviews.cases[0].review.control,site=fx.reviews.cases[1].review.control;
 const stale=session({proofAt:now-601}),viaHandoff=session({proofMethod:'recovery-commit'});
 rejects(()=>authorize({session:stale,account:ready,opId:'review.confirm',control:spec,now}),'proof_required');
 rejects(()=>authorize({session:viaHandoff,account:ready,opId:'review.confirm',control:spec,now}),'proof_required');
 assert.doesNotThrow(()=>authorize({session:stale,account:ready,opId:'review.confirm',control:site,now}));
 rejects(()=>authorize({session:session({proofAt:now-600}),account:ready,opId:'review.confirm',control:spec,now}),'proof_required');
 assert.doesNotThrow(()=>authorize({session:session({proofAt:now-599}),account:ready,opId:'review.confirm',control:spec,now}));
});
const start=fx.operations.cases.find(c=>c.operation==='session.handoffStart').request.body;
const exchange=fx.operations.cases.find(c=>c.operation==='session.handoffExchange').request.body;
const handoffState={startedAt:now-100,codeIssuedAt:now-10};
const source={expiresAt:now+1000,epoch:7,proofMethod:'recovery-commit',proofAt:now-5000};
test('fixture PKCE verifier matches the S256 challenge and state',()=>{
 assert.equal(pkceChallengeFor(exchange.codeVerifier),start.codeChallenge);assert.equal(exchange.state,start.state);
 assert.doesNotThrow(()=>verifyExchange(start,exchange));
 rejects(()=>verifyExchange(start,{...exchange,codeVerifier:'B'.repeat(43)}),'proof_required');
 rejects(()=>verifyExchange(start,{...exchange,state:'T'.repeat(24)}),'invalid_request');
});
test('handoff exchange: one use, bounded time, current completed identity, no extra life or freshness',()=>{
 const minted=exchangeHandoff({start,exchange,state:handoffState,source,account:ready,now});
 assert.equal(minted.client,'android');assert.equal(minted.expiresAt,source.expiresAt);assert.equal(minted.proofAt,source.proofAt);
 assert.equal(authorize({session:minted,account:ready,opId:'chat.read',now}).freshPasskey,false);
 rejects(()=>exchangeHandoff({start,exchange,state:handoffState,source,account:ready,now,used:true}),'proof_required');
 rejects(()=>exchangeHandoff({start,exchange,state:{...handoffState,codeIssuedAt:now-61},source,account:ready,now}),'proof_required');
 rejects(()=>exchangeHandoff({start,exchange,state:{...handoffState,startedAt:now-301},source,account:ready,now}),'proof_required');
 for(const stage of ['enrolling','recovering'])rejects(()=>exchangeHandoff({start,exchange,state:handoffState,source,account:{...ready,stage},now}),'identity_incomplete');
 rejects(()=>exchangeHandoff({start,exchange,state:handoffState,source:{...source,epoch:6},account:ready,now}),'proof_required');
 rejects(()=>exchangeHandoff({start,exchange,state:handoffState,source:{...source,expiresAt:now},account:ready,now}),'proof_required');
});
test('idempotency: same ID and payload replays, changed payload conflicts, nested key order is irrelevant',()=>{
 const store=new Map(),body=fx.operations.cases.find(c=>c.operation==='chat.send').request.body;
 assert.equal(replay(store,body.requestId,body),'new');
 assert.equal(replay(store,body.requestId,Object.fromEntries(Object.entries(body).reverse())),'replay');
 rejects(()=>replay(store,body.requestId,{...body,content:'Something else.'}),'request_conflict');
 const conf=fx.operations.cases.find(c=>c.operation==='review.confirm').request.body,s2=new Map();
 replay(s2,conf.requestId,conf);rejects(()=>replay(s2,conf.requestId,{...conf,control:{...conf.control,reviewId:'9'.repeat(8)+'-9999-4999-8999-999999999999'}}),'request_conflict');
});

// ---- Push payload ---------------------------------------------------------------------------------------------------
test('push payloads are opaque',()=>{
 for(const m of fx.push.valid)pushMessage(m,'push');
 for(const m of fx.push.invalid)rejects(()=>pushMessage(m.message,'push'),m.expect);
});

// ---- Secrets and PII-like content -----------------------------------------------------------------------------------
// Real credential-shaped values exist only at declared paths and must carry the synthetic marker. Everything else is denied.
const forbiddenKeys=/^(password|passwd|secret|cookie|authorization|recoverykey|recovery_key|privatekey|private_key|apikey|api_key|accesstoken|refreshtoken|email|phone|ssn|dob|birthdate|street|address|cardnumber|userid|ownerid|accountid|visitorid|bucket|objectkey)$/i;
const secretPaths=[
 [/\.session\.token$/,/^0{48}[0-9a-f]{16}$/],[/\.body\.code$/,/^0{48}[0-9a-f]{16}$/],[/\.body\.codeVerifier$/,/^A{1,128}$/],[/\.body\.codeChallenge$/,/^[A-Za-z0-9_-]{43}$/],
 [/\.headers\.authorization$/,/^Bearer 0{48}[0-9a-f]{16}$/],[/\.body\.fcmRegistrationToken$/,/^synthetic-/],
 [/\.credential\.(id|rawId|response\.\w+)$/,/^A+$/],[/\.options\.challenge$/,/^A{43}$/],
];
const emailLike=/[^\s@*"]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i,phoneLike=/(?<![\d-])(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/,longHex=/^[0-9a-f]{32,}$/i;
let keyCheck=true; // negative cases deliberately name authority fields; their values are still scanned
function scan(value,path='$'){
 if(typeof value==='string'){
  const declared=secretPaths.find(([p])=>p.test(path));
  if(declared){assert.match(value,declared[1],`${path} must be a synthetic secret-shaped value`);return;}
  assert.doesNotMatch(value,emailLike,`${path}: email-like`);assert.doesNotMatch(value,phoneLike,`${path}: phone-like`);
  // Digests are 64-hex by contract and carry the declared field names; bare hex elsewhere is a leaked secret shape.
  if(longHex.test(value)&&!/(digest|Digest)$/.test(path))assert.fail(`${path}: unexpected long hex`);
  assert.doesNotMatch(value,/Bearer\s|BEGIN [A-Z ]*KEY|eyJ[A-Za-z0-9_-]{10,}\./,`${path}: credential-like`);
  return;
 }
 if(Array.isArray(value))return value.forEach((v,i)=>scan(v,`${path}[${i}]`));
 if(value&&typeof value==='object')for(const [k,v] of Object.entries(value)){
  if(keyCheck&&!secretPaths.some(([p])=>p.test(`${path}.${k}`)))assert.doesNotMatch(k,forbiddenKeys,`${path}.${k}: forbidden field`);
  if((k==='token'||k==='code')&&!/\.error\.code$/.test(`${path}.${k}`))assert.ok(secretPaths.some(([p])=>p.test(`${path}.${k}`)),`${path}.${k}: undeclared secret field`);
  scan(v,`${path}.${k}`);
 }
}
test('fixtures contain no secrets or PII-like fields',()=>{
 for(const file of readdirSync(dir)){
  const data=read(file);
  if(file==='operations.json'){for(const c of data.cases){scan(c.request,`${c.operation}.request`);scan(c.response.body??{},`${c.operation}.response`);}}
  else if(file==='rejections.json'){
   for(const c of data.cases){
    if(!c.request)continue;
    const {headers={},...rest}=c.request;
    // Credential-shaped headers in negative cases must still be synthetic.
    for(const [k,v] of Object.entries(headers))if(['cookie','authorization'].includes(k))assert.match(v,/^(Bearer )?(0{48}[0-9a-f]{16}|short)$|^__Host-whumpo_session=0{48}[0-9a-f]{16}$/,c.name);
    keyCheck=false;try{scan({...rest,client:headers['whumpo-client']??null},`${file}:${c.name}`);}finally{keyCheck=true;}
   }
  }else scan(data,file);
 }
});
test('the scanner detects planted secrets and PII',()=>{
 assert.throws(()=>scan({password:'x'}));assert.throws(()=>scan({recoveryKey:'x'}));assert.throws(()=>scan({email:'someone@example.test'}));
 assert.throws(()=>scan({note:'call me at 555-123-4567'}));assert.throws(()=>scan({note:'owner@example.test'}));
 assert.throws(()=>scan({x:{token:'0'.repeat(64)}}));assert.throws(()=>scan({note:'f'.repeat(64)}));assert.throws(()=>scan({note:'Bearer abc'}));
 assert.throws(()=>scan({session:{token:'a'.repeat(64)}},'$.response'),'real-looking session token is refused');
 assert.doesNotThrow(()=>scan({account:{label:'o***@example.test'}}));
});
test('operations fixtures use reserved example domains and the whumpo.com host only',()=>{
 const raw=readFileSync(new URL('operations.json',dir),'utf8');
 for(const m of raw.matchAll(/https?:\/\/([^/"\s]+)/g))assert.ok(['whumpo.com'].includes(m[1])||/(^|\.)example\.(test|com|invalid)$/.test(m[1]),m[1]);
});

// ---- Documentation drift ----------------------------------------------------------------------------------------------
test('docs/mobile-api-v1.md states every operation, error code, control and exclusion; android-app.md links it',()=>{
 const doc=text('docs/mobile-api-v1.md'),android=text('docs/android-app.md');
 for(const o of operations)assert.ok(doc.includes('`'+o.method+' '+o.path+'`'),`${o.method} ${o.path}`);
 for(const code of Object.keys(errors))assert.ok(doc.includes('`'+code+'`'),code);
 for(const cap of controlCapabilities)assert.ok(doc.includes('`'+cap+'`'),cap);
 assert.ok(doc.includes(prefix));assert.match(android,/mobile-api-v1\.md/);
 assert.match(doc,/client_update_required/);assert.match(doc,/Planned|planned/);
});

console.log(`mobile-v1-contract: ${count} offline checks passed (synthetic fixtures; no database, network, device, credential or model).`);
