import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceSession} from './helpers/workspace-identity.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';

// WH-083 M1: the seven native identity operations of /api/mobile/v1 through the REAL Worker (mounted first in handle()), over the
// shared mobile-v1 fixtures, on disposable SQLite and, with --d1, actual local D1. Passkeys are independent ES256 signatures made at
// the allowlisted Android apk-key-hash origin. No network, no secret, no real address.
const bundle=await build({stdin:{contents:[
 "export {default as worker} from './src/index';export {securityReviewRoute} from './src/email-change/review-http';",
 "export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",
 "export {newSessionToken,hashToken} from './src/security';export {androidPasskeyOrigins} from './src/android-signing';"
 ].join(''),resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fixtures=name=>JSON.parse(readFileSync(new URL('./fixtures/mobile-v1/'+name,import.meta.url),'utf8'));
const operations=Object.fromEntries(fixtures('operations.json').cases.map(c=>[c.operation,c])),errors=fixtures('errors.json').cases,clients=fixtures('client.json');
const clientHeader=JSON.stringify(clients.current),clientWith=o=>JSON.stringify({...clients.current,...o});
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const count=async(table,where='1=1',...v)=>(await one(`SELECT count(*) n FROM ${table} WHERE ${where}`,...v)).n;
const androidOrigin=m.androidPasskeyOrigins[0],wait=ms=>new Promise(r=>setTimeout(r,ms));
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const limits={auth:[],api:[],authDeny:false,apiDeny:false};
const env={DB:db,ENVIRONMENT:'test',MOBILE_MINIMUM_BUILD:'40',TURNSTILE_SECRET:'synthetic-only',
 AUTH_LIMITER:{limit:async({key})=>{limits.auth.push(key);return {success:!limits.authDeny};}},API_LIMITER:{limit:async({key})=>{limits.api.push(key);return {success:!limits.apiDeny};}}};
const ctx={waitUntil(){}};
const base='https://whumpo.com';
async function call(path,{method='POST',headers={},body,raw,token,client=clientHeader,environment=env}={}){
 const h={...(client===null?{}:{'whumpo-client':client}),...(token?{authorization:'Bearer '+token}:{}),...headers};
 if(method==='POST'&&(body!==undefined||raw!==undefined))h['content-type']??='application/json';
 const response=await m.worker.fetch(new Request(base+path,{method,headers:h,body:raw??(body===undefined?undefined:JSON.stringify(body))}),environment,ctx);
 const text=await response.text();let data=null;try{data=JSON.parse(text);}catch{}
 assert.equal(response.headers.get('cache-control'),'no-store');
 return {status:response.status,data,text,headers:response.headers};
}
const mobile=(p,o)=>call('/api/mobile/v1'+p,o);
const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
// Every fixture key is present in the live body with the same JSON type (null in a fixture accepts any value); the values are live.
function shaped(live,fixture,at='body'){
 if(fixture===null)return;
 assert.equal(typeof live,typeof fixture,at);
 if(Array.isArray(fixture)){assert(Array.isArray(live),at);return;}
 if(fixture&&typeof fixture==='object')for(const k of Object.keys(fixture)){assert(Object.hasOwn(live,k),`${at}.${k} missing`);shaped(live[k],fixture[k],at+'.'+k);}
}
function fixtureCall(name,live,expectedStatus=200){
 assert.equal(live.status,expectedStatus,live.text);shaped(live.data,operations[name].response.body);
}
const handleOf=account=>Buffer.from(account).toString('base64url');
let counter=0;
async function owner({stage='ready',sessions=0}={}){
 const account=id(),key=authenticator();
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",account,`owner${account.slice(0,6)}@example.test`);
 if(stage==='ready'){
  await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)",account,'a'.repeat(64),id());
  await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic passkey','active',NULL,unixepoch(),NULL)",key.id,account,key.publicKey);
 }else{
  const attempt=id();
  await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,current_attempt_id) VALUES(?,1,'enrolling',1,?)",account,attempt);
  await run("INSERT INTO identity_attempts VALUES(?,?,'enrollment','open',0,1,0,unixepoch())",attempt,account);
  await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'First passkey','staged',?,unixepoch(),NULL)",key.id,account,key.publicKey,attempt);
 }
 const o={account,key,email:(await one('SELECT email FROM users WHERE id=?',account)).email,n:0};
 o.assert=(options,atOrigin=androidOrigin,extra={})=>key.assertion(options,++o.n,{atOrigin,handle:handleOf(account),...extra});
 return o;
}
// A native session minted straight into the table (an older proof when `proofAge` is large), for cases that need a known token.
async function nativeSession(o,{proofAge=5,client='android',lifetime=3600}={}){
 const token=m.newSessionToken(),authority=id();
 await run("INSERT INTO identity_sessions VALUES(?,?,?,1,(SELECT auth_epoch FROM identity_accounts WHERE account_id=?),?,?,'passkey',unixepoch()-?,unixepoch(),unixepoch()+?)",authority,await m.hashToken(token),o.account,o.account,client,o.key.id,proofAge,lifetime);
 return {token,authority};
}
async function login(o,{origin=androidOrigin}={}){
 const options=await mobile('/session/login/options',{body:{version:1}});assert.equal(options.status,200,options.text);
 return {options,verify:await mobile('/session/login/verify',{body:{version:1,challengeId:options.data.challengeId,credential:o.assert(options.data.options,origin)}})};
}
const same=(live,fixture)=>assert.deepEqual(live,fixture);
try{
 const a=await owner();

 await check('config: the fixture pair; a below-minimum build may still read it, a wrong contract may not',async()=>{
  const r=await call('/api/mobile/v1/config',{method:'GET',client:operations['config.read'].request.headers['whumpo-client']});
  same(r.data,{...operations['config.read'].response.body,minimumBuild:40});assert.equal(r.status,200);
  assert.equal((await call('/api/mobile/v1/config',{method:'GET',client:clientWith({build:39})})).status,200);
  assert.equal((await call('/api/mobile/v1/config',{method:'GET',client:clientWith({contract:2})})).status,426);
  assert.equal((await call('/api/mobile/v1/session/login/options',{client:clientWith({build:39}),body:{version:1}})).status,426);
 });

 await check('login options and verify: fixture pairs, native android session, 256-bit token stored only as its SHA-256',async()=>{
  const {options,verify}=await login(a);
  fixtureCall('session.loginOptions',options);
  assert.match(options.data.challengeId,/^[0-9a-f-]{36}$/);assert.match(options.data.expiresAt,iso);
  assert.equal(options.data.options.rpId,'whumpo.com');assert.equal(options.data.options.userVerification,'required');
  const c=await one('SELECT client,origin,rp_id,kind FROM identity_challenges WHERE id=?',options.data.challengeId);
  assert.equal(c,null,'the challenge is single use and gone after verification');
  fixtureCall('session.loginVerify',verify);
  const s=verify.data.session;assert.match(s.token,/^[0-9a-f]{64}$/);assert.match(s.expiresAt,iso);assert.match(s.freshUntil,iso);
  const row=await one('SELECT * FROM identity_sessions WHERE token_hash=?',await m.hashToken(s.token));
  assert.equal(row.client,'android');assert.equal(row.proof_method,'passkey');assert.equal(row.account_id,a.account);assert.equal(row.credential_id,a.key.id);
  assert.equal(row.expires_at,row.proof_at+604800);assert.equal(Date.parse(s.expiresAt)/1000,row.expires_at);assert.equal(Date.parse(s.freshUntil)/1000,row.proof_at+600);
  assert.equal(await one('SELECT 1 FROM identity_sessions WHERE token_hash=?',s.token),null,'the token itself is never stored');
  assert.equal(await count('identity_grants','account_id=?',a.account),0,'native never receives a grant');
 });

 await check('login options record an android challenge with the allowlisted origin',async()=>{
  const options=await mobile('/session/login/options',{body:{version:1}});
  const c=await one('SELECT client,origin,rp_id,kind FROM identity_challenges WHERE id=?',options.data.challengeId);
  assert.deepEqual({...c},{client:'android',origin:androidOrigin,rp_id:'whumpo.com',kind:'login'});
 });

 await check('session: fixture pair, masked label, never the raw address',async()=>{
  const s=await nativeSession(a,{proofAge:5}),r=await mobile('/session',{method:'GET',token:s.token});
  fixtureCall('session.read',r);assert.match(r.data.account.label,/^o\*\*\*@example\.test$/);assert(!r.text.includes(a.email));assert.match(r.data.session.freshUntil,iso);
  const old=await nativeSession(a,{proofAge:3000}),r2=await mobile('/session',{method:'GET',token:old.token});assert.equal(r2.data.session.freshUntil,null);
 });

 await check('reauth options and verify: fixture pairs; same token, expires_at is NOT extended, freshUntil moves',async()=>{
  const s=await nativeSession(a,{proofAge:3000,lifetime:1800}),before=await one('SELECT expires_at,proof_at FROM identity_sessions WHERE id=?',s.authority);
  const options=await mobile('/session/reauth/options',{token:s.token,body:{version:1}});fixtureCall('session.reauthOptions',options);
  const done=await mobile('/session/reauth/verify',{token:s.token,body:{version:1,challengeId:options.data.challengeId,credential:a.assert(options.data.options)}});
  fixtureCall('session.reauthVerify',done);assert(!('token' in done.data.session),'no new token is issued');
  assert.equal(Date.parse(done.data.session.expiresAt)/1000,before.expires_at,'expiry is unchanged');
  const after=await one('SELECT expires_at,proof_at,client FROM identity_sessions WHERE token_hash=?',await m.hashToken(s.token));
  assert.equal(after.expires_at,before.expires_at);assert(after.proof_at>before.proof_at);assert.equal(after.client,'android');
  assert.equal(await one('SELECT 1 FROM identity_sessions WHERE id=?',s.authority),null,'the old authority row is replaced');
  const read=await mobile('/session',{method:'GET',token:s.token});assert.equal(read.status,200);assert.match(read.data.session.freshUntil,iso);
  // the challenge is single use and bound to the session that asked for it
  const replay=await mobile('/session/reauth/verify',{token:s.token,body:{version:1,challengeId:options.data.challengeId,credential:a.assert(options.data.options)}});assert.equal(replay.status,401);same(replay.data,errors.proof_required_fresh.body);
  const other=await nativeSession(a),again=await mobile('/session/reauth/options',{token:s.token,body:{version:1}});
  const stolen=await mobile('/session/reauth/verify',{token:other.token,body:{version:1,challengeId:again.data.challengeId,credential:a.assert(again.data.options)}});assert.equal(stolen.status,409);same(stolen.data,errors.identity_changed.body);
 });

 await check('reauth verify with a changed credential set is identity_changed (a changed revision burns the challenge)',async()=>{
  const s=await nativeSession(a),options=await mobile('/session/reauth/options',{token:s.token,body:{version:1}}),extra=authenticator();
  await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Second','active',NULL,unixepoch(),NULL)",extra.id,a.account,extra.publicKey);
  const r=await mobile('/session/reauth/verify',{token:s.token,body:{version:1,challengeId:options.data.challengeId,credential:a.assert(options.data.options)}});
  assert.equal(r.status,409);same(r.data,errors.identity_changed.body);
 });

 await check('logout: fixture pair, revokes the session and its challenges, then 401 proof_required',async()=>{
  const s=await nativeSession(a),options=await mobile('/session/reauth/options',{token:s.token,body:{version:1}});assert.equal(options.status,200);
  const r=await mobile('/session/logout',{token:s.token,body:{version:1}});fixtureCall('session.logout',r);same(r.data,{version:1,signedOut:true});
  assert.equal(await count('identity_sessions','id=?',s.authority),0);assert.equal(await count('identity_challenges','id=?',options.data.challengeId),0);
  const after=await mobile('/session',{method:'GET',token:s.token});assert.equal(after.status,401);same(after.data,errors.proof_required_signin.body);
  assert.equal((await mobile('/session/logout',{token:s.token,body:{version:1}})).status,401);
 });

 await check('error codes and statuses match the shared fixtures exactly',async()=>{
  const s=await nativeSession(a);
  const want=(r,status,fixture)=>{assert.equal(r.status,status,r.text);same(r.data,fixture.body);};
  want(await mobile('/session',{method:'GET',token:s.token,client:clientWith({build:39})}),426,errors.client_update_required);
  want(await mobile('/session',{method:'GET',token:s.token,client:clientWith({contract:2})}),426,errors.client_update_required);
  want(await mobile('/session',{method:'GET',token:s.token,client:clientWith({interaction:{...clients.current.interaction,versions:[1,2]}})}),426,errors.client_update_required);
  want(await mobile('/session',{method:'GET',client:clientHeader}),401,errors.proof_required_signin);
  want(await mobile('/session',{method:'GET',token:'f'.repeat(64)}),401,errors.proof_required_signin);
  want(await mobile('/session',{method:'GET',headers:{authorization:'Bearer short'}}),401,errors.proof_required_signin);
  want(await mobile('/session',{method:'GET',client:null,token:s.token}),400,errors.invalid_request);
  want(await mobile('/session',{method:'GET',client:clientWith({platform:'ios'}),token:s.token}),400,errors.invalid_request);
  want(await mobile('/session',{method:'GET',client:clientWith({controls:['nope']}),token:s.token}),400,errors.invalid_request);
  want(await mobile('/session',{method:'GET',client:'{not json',token:s.token}),400,errors.invalid_request);
  assert.equal((await mobile('/session',{method:'GET',client:JSON.stringify({...clients.current,extra:1}),token:s.token})).data.error.code,'unknown_field');
  assert.equal((await mobile('/session',{method:'GET',client:JSON.stringify({contract:1,build:42,platform:'android',controls:[]}),token:s.token})).data.error.code,'missing_field');
  assert.equal((await mobile('/session?x=1',{method:'GET',token:s.token})).data.error.code,'unknown_field');
  want(await mobile('/session',{method:'GET',token:s.token,headers:{'content-length':'2'}}),400,errors.invalid_request);
  want(await mobile('/session/login/options',{body:{version:1},token:s.token}),400,errors.invalid_request);
  want(await mobile('/session/login/options',{body:{version:2}}),400,errors.invalid_request);
  want(await mobile('/session/login/options',{raw:'{"version":1',}),400,errors.invalid_request);
  want(await mobile('/session/login/options',{body:{version:1},headers:{'content-type':'text/plain'}}),400,errors.invalid_request);
  assert.equal((await mobile('/session/login/options',{body:{version:1,x:1}})).data.error.code,'unknown_field');
  assert.equal((await mobile('/session/login/verify',{body:{version:1,challengeId:id()}})).data.error.code,'missing_field');
  want(await mobile('/session/login/verify',{body:{version:1,challengeId:'nope',credential:{}}}),400,errors.invalid_request);
  want(await mobile('/nothing',{method:'GET'}),404,errors.not_found);
  want(await mobile('/session/login/options',{method:'GET'}),404,errors.not_found);
  want(await call('/api/mobile/v2/config',{method:'GET'}),404,errors.not_found);
  want(await mobile('/session/login/options',{body:{version:1,padding:'x'.repeat(17000)}}),413,errors.payload_too_large);
  want(await mobile('/session/login/options',{raw:JSON.stringify({version:1,padding:'x'.repeat(17000)}),headers:{'content-length':'5'}}),413,errors.payload_too_large);
  // the credential JSON is bounded at 8 KiB, below the 16 KiB request limit
  const big={id:'AAAA',rawId:'AAAA',type:'public-key',response:{clientDataJSON:'A'.repeat(8300)}};
  want(await mobile('/session/login/verify',{body:{version:1,challengeId:id(),credential:big}}),413,errors.payload_too_large);
  want(await mobile('/session/login/verify',{body:{version:1,challengeId:id(),credential:{...big,response:{clientDataJSON:'A'.repeat(7000)}}}}),401,errors.proof_required_signin);
  limits.authDeny=true;want(await mobile('/session/login/options',{body:{version:1}}),429,errors.rate_limited);limits.authDeny=false;
  const limited=await mobile('/session/login/options',{body:{version:1}});assert.equal(limited.status,200);
  limits.apiDeny=true;const r429=await mobile('/session',{method:'GET',token:s.token});want(r429,429,errors.rate_limited);assert.equal(r429.headers.get('retry-after'),'60');limits.apiDeny=false;
  const broken={...env,DB:{prepare(){throw new Error('SQL secret detail SELECT * FROM identity_sessions');},batch(){throw new Error('x');}}};
  const down=await mobile('/session/login/options',{body:{version:1},environment:broken});want(down,503,errors.unavailable);assert(!down.text.includes('SQL'));
 });

 await check('incomplete account: login issues nothing and returns 403 identity_incomplete next browser',async()=>{
  const e=await owner({stage:'enrolling'}),{verify}=await login(e);
  assert.equal(verify.status,403);same(verify.data,errors.identity_incomplete.body);
  assert.equal(await count('identity_sessions','account_id=?',e.account),0);assert.equal(await count('identity_grants','account_id=?',e.account),0);
 });

 await check('passkey ceremony: unknown apk-key-hash origin, web origin, replay and a foreign key are all proof_required',async()=>{
  const b=await owner(),unknown='android:apk-key-hash:'+Buffer.alloc(32,7).toString('base64url');
  for(const origin of [unknown,'https://whumpo.com',base]){
   const {verify}=await login(b,{origin});assert.equal(verify.status,401,origin);same(verify.data,errors.proof_required_signin.body);
  }
  assert.equal(await count('identity_sessions','account_id=?',b.account),0);
  const options=await mobile('/session/login/options',{body:{version:1}}),credential=b.assert(options.data.options);
  assert.equal((await mobile('/session/login/verify',{body:{version:1,challengeId:options.data.challengeId,credential}})).status,200);
  const replay=await mobile('/session/login/verify',{body:{version:1,challengeId:options.data.challengeId,credential:b.assert(options.data.options)}});assert.equal(replay.status,401);
  const wrongRp=await mobile('/session/login/options',{body:{version:1}}),w=await mobile('/session/login/verify',{body:{version:1,challengeId:wrongRp.data.challengeId,credential:b.assert(wrongRp.data.options,androidOrigin,{rpID:'attacker.invalid'})}});assert.equal(w.status,401);
  const bad=await mobile('/session/login/options',{body:{version:1}}),x=await mobile('/session/login/verify',{body:{version:1,challengeId:bad.data.challengeId,credential:b.assert(bad.data.options,androidOrigin,{badSignature:true})}});assert.equal(x.status,401);
  assert.equal(await count('identity_challenges','id=?',bad.data.challengeId),0,'a failed verification burns the challenge');
  const uv=await mobile('/session/login/options',{body:{version:1}}),y=await mobile('/session/login/verify',{body:{version:1,challengeId:uv.data.challengeId,credential:b.assert(uv.data.options,androidOrigin,{uv:false})}});assert.equal(y.status,401);
 });

 await check('cookies never cross: a cookie on a mobile route is 400 even with a valid bearer',async()=>{
  const s=await nativeSession(a);
  for(const cookie of ['__Host-whumpo_session='+'a'.repeat(64),'x=1']){
   const r=await mobile('/session',{method:'GET',token:s.token,headers:{cookie}});assert.equal(r.status,400);same(r.data,errors.invalid_request.body);
  }
  const anon=await mobile('/session/login/options',{body:{version:1},headers:{cookie:'x=1'}});assert.equal(anon.status,400);
  assert.equal((await mobile('/config',{method:'GET',headers:{cookie:'x=1'}})).status,400);
  assert.equal(limits.api.concat(limits.auth).filter(k=>k.startsWith('mobile-authority:')&&k.includes('undefined')).length,0);
 });

 await check('bearer tokens work only on mobile routes; a web token fails on mobile and an android token fails on web',async()=>{
  const s=await nativeSession(a),web=await workspaceSession(db,m,{account:a.account,credential:a.key.id});
  const cookie='__Host-whumpo_session='+web.token;
  // a native bearer on web routes: refused, even alongside a valid web cookie
  for(const path of ['/api/profile','/api/projects','/api/health','/api/auth/identity/v1/state']){
   const r=await call(path,{method:'GET',client:null,token:s.token});assert.equal(r.status,401,path);assert.equal(r.data.code,'proof_required');
   const both=await call(path,{method:'GET',client:null,token:s.token,headers:{cookie}});assert.equal(both.status,401,path);
  }
  assert.equal((await call('/api/profile',{method:'GET',client:null,headers:{cookie}})).status,200,'the same web cookie works without the bearer');
  // a native token presented as the web cookie
  assert.equal((await call('/api/profile',{method:'GET',client:null,headers:{cookie:'__Host-whumpo_session='+s.token}})).status,401);
  // a web token presented as a mobile bearer
  const r=await mobile('/session',{method:'GET',token:web.token});assert.equal(r.status,401);same(r.data,errors.proof_required_signin.body);
  assert.equal((await mobile('/session/logout',{token:web.token,body:{version:1}})).status,401);
  assert.equal(await count('identity_sessions','id=?',web.authority),1,'the refused logout did not touch the web session');
  // anonymous mobile routes refuse a bearer
  const anon=await mobile('/session/login/options',{body:{version:1},token:s.token});assert.equal(anon.status,400);
 });

 await check('rate limits: anonymous routes use AUTH_LIMITER per IP; bearer routes use API_LIMITER per IP and per authorityId',async()=>{
  const s=await nativeSession(a);limits.auth.length=0;limits.api.length=0;
  await mobile('/config',{method:'GET',headers:{'cf-connecting-ip':'203.0.113.9'}});
  assert.deepEqual([limits.auth,limits.api],[['mobile:203.0.113.9'],[]]);
  limits.auth.length=0;await mobile('/session',{method:'GET',token:s.token,headers:{'cf-connecting-ip':'203.0.113.9'}});
  assert.deepEqual([limits.auth,limits.api],[[],['mobile:203.0.113.9','mobile-authority:'+s.authority]]);
  limits.api.length=0;await mobile('/session',{method:'GET',token:'e'.repeat(64)});assert.deepEqual(limits.api,['mobile:local'],'an unknown token is limited per IP only');
 });

 await check('the session cap (10) is shared with web: a native sign-in evicts a session of either client and the cap holds',async()=>{
  const c=await owner();
  const webs=[];for(let i=0;i<10;i++){webs.push(await workspaceSession(db,m,{account:c.account,credential:c.key.id}));await wait(5);}
  assert.equal(await count('identity_sessions','account_id=?',c.account),10);
  const {verify}=await login(c);assert.equal(verify.status,200,verify.text);
  assert.equal(await count('identity_sessions','account_id=?',c.account),10);
  assert.equal(await count("identity_sessions","account_id=? AND client='android'",c.account),1);
  const d=await login(c);assert.equal(d.verify.status,200);assert.equal(await count('identity_sessions','account_id=?',c.account),10);
 });

 await check('a committed security review kills native sessions (and the session is 401 on the very next call)',async()=>{
  const c=await owner(),second=authenticator();
  await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Second','active',NULL,unixepoch(),NULL)",second.id,c.account,second.publicKey);
  const native=await nativeSession(c),{verify}=await login(c);const logged=verify.data.session.token;
  assert.equal((await mobile('/session',{method:'GET',token:native.token})).status,200);
  const web=await workspaceSession(db,m,{account:c.account,credential:c.key.id}),origin=base;
  const route=async(action,body)=>{
   const principal=await m.resolveIdentity(db,{version:1,client:'web',kind:'session',token:web.token});
   const response=await m.securityReviewRoute(new Request(origin+'/api/account/security/review/'+action,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),{AUTH_LIMITER:env.AUTH_LIMITER},m.admitWorkspace(db,principal),principal,{delivery:{queue:async()=>{}}});
   return {status:response.status,data:await response.json()};
  };
  const prepared=await route('prepare',{version:1});assert.equal(prepared.status,200,JSON.stringify(prepared.data));
  const done=await route('commit',{version:1,requestId:id(),reviewId:prepared.data.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[]});assert.equal(done.status,200,JSON.stringify(done.data));
  for(const token of [native.token,logged]){const r=await mobile('/session',{method:'GET',token});assert.equal(r.status,401);same(r.data,errors.proof_required_signin.body);}
  assert.equal(await count("identity_sessions","account_id=? AND client='android'",c.account),0);
 });

 await check('no token or credential is ever echoed in an error body or logged',async()=>{
  const logged=[],original=console.error;console.error=(...x)=>logged.push(x.join(' '));
  try{
   const s=await nativeSession(a),r=await mobile('/session/reauth/verify',{token:s.token,body:{version:1,challengeId:id(),credential:{id:'AAAA'}}});
   assert(!r.text.includes(s.token));assert(!logged.join('').includes(s.token));
  }finally{console.error=original;}
 });
 console.log(`Mobile identity M1: ${cases} checks over the seven operations on ${process.argv.includes('--d1')?'local D1':'SQLite'}.`);
}catch(error){console.error(error);process.exitCode=1;}
finally{await fixture.close();}
