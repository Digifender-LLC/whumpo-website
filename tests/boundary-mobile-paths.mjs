import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {extractSurface} from '../tools/boundary-audit.mjs';

// WH-004 (D2) per-path evidence for every /api/mobile/v1 operation, through the REAL Worker, on disposable SQLite and, with --d1, actual local D1.
// One table drives every mounted operation (checked against the extracted router so a new path cannot be missed) through the shared
// rules: strict client header, no Cookie, bearer-only authority (anonymous routes refuse a bearer), a revoked, expired, web or missing token,
// per-IP and per-account limits, wrong methods, and cross-account use of another owner's real ids. Domain behaviour is in tests/mobile-*.mjs.
const bundle=await build({stdin:{contents:[
 "export {default as worker} from './src/index';export {newSessionToken,hashToken} from './src/security';export {recordPushEvent} from './src/mobile/push';"
 ].join(''),resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const clients=JSON.parse(readFileSync(new URL('./fixtures/mobile-v1/client.json',import.meta.url),'utf8'));
const clientHeader=JSON.stringify(clients.current),oldClient=JSON.stringify({...clients.current,build:39});
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
let blocked=()=>false;
const limiter=kind=>({limit:async({key})=>({success:!blocked(kind,key)})});
const env={DB:db,ENVIRONMENT:'test',MOBILE_MINIMUM_BUILD:'40',AUTH_LIMITER:limiter('auth'),API_LIMITER:limiter('api')};
const ctx={waitUntil(){}};
async function call(method,path,{token,client=clientHeader,headers={},body}={}){
 const h={...(client===null?{}:{'whumpo-client':client}),...(token?{authorization:'Bearer '+token}:{}),...headers};
 if(body!==undefined)h['content-type']='application/json';
 const response=await m.worker.fetch(new Request('https://whumpo.com/api/mobile/v1'+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);
 const text=await response.text();let data=null;try{data=JSON.parse(text);}catch{}
 assert.equal(response.headers.get('cache-control'),'no-store',method+' '+path);
 return {status:response.status,code:data?.error?.code,data,text};
}
async function owner(){
 const account=id(),project=id(),now=new Date().toISOString();
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,?)",account,`paths${account.slice(0,8)}@example.test`,now);
 await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)",account,'a'.repeat(64),id());
 const credential=id();await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic passkey','active',NULL,unixepoch(),NULL)",credential,account,new Uint8Array(32));
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',?,?)",project,account,now,now);
 const session=async(client,{lifetime=3600}={})=>{
  const token=m.newSessionToken(),sid=id();
  await run("INSERT INTO identity_sessions(id,token_hash,account_id,policy_version,auth_epoch,client,credential_id,proof_method,proof_at,issued_at,expires_at) VALUES(?,?,?,1,1,?,?,'passkey',unixepoch()-205,unixepoch()-200,unixepoch()+?)",sid,await m.hashToken(token),account,client,credential,lifetime);
  return {token,sid};
 };
 const event=await m.recordPushEvent(db,{accountId:account,kind:'attention_required',projectId:project});
 return {account,project,event,session};
}

const ZERO='00000000-0000-4000-8000-000000000001',json={version:1};
// Every operation, as [method, path, body]. `anon` operations take no bearer; the rest need a native session.
const anonymous=[['GET','/config'],['POST','/session/login/options',json],['POST','/session/login/verify',json],['POST','/session/handoff/start',json],['POST','/session/handoff/exchange',json]];
const authenticated=a=>[['POST','/session/reauth/options',json],['POST','/session/reauth/verify',json],['GET','/session'],['POST','/session/logout',json],['GET','/bootstrap'],['GET','/chat'],['GET','/chat/turns/'+a.turn],['POST','/chat/messages',json],['GET','/reviews'],['POST','/reviews/confirm',json],
 ...['list','read','resources','mutate','receipt','continue','stop','reconcile'].map(x=>['POST','/interactions/'+x,json]),
 ['GET','/projects'],['GET','/projects/'+a.project],['GET','/projects/'+a.project+'/versions'],['GET','/projects/'+a.project+'/photos'],['GET','/projects/'+a.project+'/photos/'+ZERO],['PUT','/projects/'+a.project+'/photos/'+ZERO],['GET','/photos/'+ZERO],['GET','/activity'],
 ['PUT','/devices/current',json],['DELETE','/devices/current'],['GET','/events/'+a.event]];
try{
 const a=await owner(),b=await owner();
 const sa=await a.session('android'),sb=await b.session('android'),web=await a.session('web');
 const expired=await a.session('android',{lifetime:-100}),revoked=await a.session('android');await run('DELETE FROM identity_sessions WHERE id=?',revoked.sid);

 a.turn=id();
 const ops=[...anonymous.map(([method,path,body])=>({method,path,body,anon:true})),...authenticated(a).map(([method,path,body])=>({method,path,body,anon:false}))];

 await check('the table covers exactly the mounted mobile router (no operation without per-path evidence, none stale)',async()=>{
  const mounted=extractSurface().routes.filter(r=>r.file==='src/mobile/router.ts');
  assert.ok(mounted.length>=23,'extracted '+mounted.length);
  const hits=(r,o)=>r.methods.includes(o.method)&&(r.kind==='exact'?r.match===o.path.slice(1):new RegExp(r.match.slice(1,-1)).test(o.path.slice(1)));
  for(const r of mounted)for(const method of r.methods)assert.ok(ops.some(o=>o.method===method&&hits(r,o)),`mounted ${r.kind} ${r.match} [${method}] has no operation in this test`);
  for(const o of ops)assert.ok(mounted.some(r=>hits(r,o)),`${o.method} ${o.path} is not a mounted route`);
 });

 await check('every operation requires the strict Whumpo-Client header (400) and a supported build (426, except /config) and refuses a Cookie even beside a valid bearer (400)',async()=>{
  for(const o of ops){
   const base={token:o.anon?undefined:sa.token,body:o.body};
   assert.equal((await call(o.method,o.path,{...base,client:null})).code,'invalid_request',o.method+' '+o.path+' without a client header');
   assert.equal((await call(o.method,o.path,{...base,client:'{"contract":1}'})).status,400,o.path+' with a malformed client header');
   const cookie=await call(o.method,o.path,{...base,headers:{cookie:'__Host-whumpo_session='+web.token}});
   assert.equal(cookie.status,400,o.method+' '+o.path+' with a cookie');assert.equal(cookie.code,'invalid_request');
   if(o.path!=='/config')assert.equal((await call(o.method,o.path,{...base,client:oldClient})).code,'client_update_required',o.path+' below the minimum build');
  }
  assert.equal((await call('GET','/config',{client:oldClient})).status,200,'/config tolerates an old build so the app can learn it must update');
 });

 await check('anonymous operations refuse any bearer (400); bearer operations refuse a missing, web-session, expired or revoked token (401 proof_required signin)',async()=>{
  for(const o of ops){
   const body=o.body;
   if(o.anon){assert.equal((await call(o.method,o.path,{token:sa.token,body})).code,'invalid_request',o.path+' is anonymous and takes no bearer');continue;}
   for(const [label,token] of [['missing',undefined],['web session',web.token],['expired',expired.token],['revoked',revoked.token],['not hex','zz']]){
    const r=await call(o.method,o.path,{token,body});
    assert.equal(r.status,401,`${o.method} ${o.path} with a ${label} token: ${r.text}`);assert.equal(r.code,'proof_required');assert.equal(r.data.error.proof,'signin');
   }
   // A throwaway session per operation (logout would end a shared one) and removed after, because the account session cap evicts the oldest.
   const probe=await a.session('android');
   const admitted=(await call(o.method,o.path,{token:probe.token,body})).status;
   assert.ok(admitted!==401&&admitted<500,o.method+' '+o.path+' admits a current native session without a server error (got '+admitted+')');
   await run('DELETE FROM identity_sessions WHERE id=?',probe.sid);
  }
 });

 await check('a native bearer is a mobile credential only: every other platform route refuses it, beside a web cookie too',async()=>{
  for(const path of ['/api/profile','/api/projects','/api/chat']){
   const r=await m.worker.fetch(new Request('https://whumpo.com'+path,{headers:{authorization:'Bearer '+sa.token,cookie:'__Host-whumpo_session='+web.token}}),env,ctx);
   assert.equal(r.status,401,path);
  }
 });

 await check('limits: bearer operations spend a per-IP and a per-account budget, so one account being limited does not limit another; anonymous operations spend the per-IP auth budget',async()=>{
  const bearerOps=ops.filter(o=>!o.anon),anonOps=ops.filter(o=>o.anon);
  blocked=(kind,key)=>kind==='api'&&key==='mobile-account:'+a.account;
  for(const o of bearerOps){
   const limited=await call(o.method,o.path,{token:sa.token,body:o.body});
   assert.equal(limited.status,429,o.method+' '+o.path);assert.equal(limited.code,'rate_limited');
   const other=await b.session('android');
   assert.notEqual((await call(o.method,o.path,{token:other.token,body:o.body})).status,429,o.path+' must not limit the other account');
   await run('DELETE FROM identity_sessions WHERE id=?',other.sid);
  }
  blocked=(kind,key)=>kind==='auth'&&key==='mobile:local';
  for(const o of anonOps)assert.equal((await call(o.method,o.path,{body:o.body})).status,429,o.method+' '+o.path+' anonymous limit');
  blocked=()=>false;
 });

 await check('a method the router does not mount for a path is not_found (404), for every path',async()=>{
  for(const o of ops){
   const r=await call('PATCH',o.path,{token:o.anon?undefined:sa.token});
   assert.equal(r.status,404,o.path);assert.equal(r.code,'not_found');
  }
 });

 await check('cross-account: owner B using owner A\'s real project, versions, photos and push event ids learns nothing (same answer as an unknown id); A reads the event',async()=>{
  const foreign=(method,path,body)=>call(method,path,{token:sb.token,body}),absent=path=>path.replaceAll(a.project,ZERO).replaceAll(a.event,ZERO);
  assert.equal((await call('GET','/events/'+a.event,{token:sa.token})).data.event.id,a.event,'the owner reads the event');
  for(const o of ops.filter(x=>[a.project,a.event].some(v=>x.path.includes(v)))){
   const live=await foreign(o.method,o.path,o.body),unknown=await foreign(o.method,absent(o.path),o.body);
   assert.equal(live.status,404,o.method+' '+o.path+': '+live.text);assert.equal(live.code,'not_found');
   assert.deepEqual(live.data,unknown.data,o.path+' is distinguishable from an unknown id');
  }
  assert.deepEqual((await call('GET','/projects',{token:sb.token})).data.items.map(p=>p.id),[b.project],'a list shows only the caller\'s own projects');
 });

 await check('logout ends only the bearer\'s own session: a sibling session and another account keep working, and a repeated logout is proof_required',async()=>{
  const one=await b.session('android'),two=await b.session('android');
  assert.equal((await call('POST','/session/logout',{token:one.token,body:json})).status,200);
  assert.equal((await call('POST','/session/logout',{token:one.token,body:json})).code,'proof_required','a logged-out token cannot log out again');
  assert.equal((await call('GET','/session',{token:two.token})).status,200,'the sibling session is untouched');
  assert.equal((await call('GET','/session',{token:sa.token})).status,200,'another account is untouched');
  await run('DELETE FROM identity_sessions WHERE id=?',two.sid);
 });

 await check('a revoked native session stops every operation at once, while the account\'s other session keeps working',async()=>{
  const extra=await b.session('android'),before=await call('GET','/session',{token:extra.token});assert.equal(before.status,200);
  await run('DELETE FROM identity_sessions WHERE id=?',extra.sid);
  for(const o of ops.filter(x=>!x.anon))assert.equal((await call(o.method,o.path,{token:extra.token,body:o.body})).status,401,o.path);
  assert.equal((await call('GET','/session',{token:sb.token})).status,200);
 });

 console.log(`Mobile per-path boundary: ${cases} checks over ${ops.length} operations on ${process.argv.includes('--d1')?'local D1':'SQLite'}.`);
}finally{await fixture.close?.();}
