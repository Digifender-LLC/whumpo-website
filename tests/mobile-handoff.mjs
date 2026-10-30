import assert from 'node:assert/strict';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
import {createFixtureWebsite,proposeFixtureWebsite} from './current-site-fixture.mjs';

// WH-083 M3: the browser handoff (start, complete, exchange) through the REAL Worker, with signed synthetic WebAuthn for the web passkey and
// the allowlisted Android origin for reauthentication, on disposable SQLite and, with --d1, actual local D1. No network, secret or real address.
const bundle=await build({stdin:{contents:[
 "export {default as worker} from './src/index';export {androidPasskeyOrigins} from './src/android-signing';",
 "export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity,assertCurrentIdentity} from './src/workspace-identity/authority';",
 "export {newSessionToken,hashToken} from './src/security';",
 "export {createWebsite,prepareSpecification,readSpecificationProposal} from './src/project-specification/store';export {readChat,sendChat,sendChatControl} from './src/chat';"
 ].join(''),resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fixtures=name=>JSON.parse(readFileSync(new URL('./fixtures/mobile-v1/'+name,import.meta.url),'utf8'));
const operations=Object.fromEntries(fixtures('operations.json').cases.map(c=>[c.operation,c])),errors=fixtures('errors.json').cases,clients=fixtures('client.json');
const clientHeader=JSON.stringify(clients.current);
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const count=async(table,where='1=1',...v)=>(await one(`SELECT count(*) n FROM ${table} WHERE ${where}`,...v)).n;
const androidOrigin=m.androidPasskeyOrigins[0],base='https://whumpo.com',sessionCookie='__Host-whumpo_session',challengeCookie='__Secure-whumpo_identity_challenge',grantCookie='__Secure-whumpo_identity_grant';
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const limits={auth:[],counts:null};
const env={DB:db,ENVIRONMENT:'test',MOBILE_MINIMUM_BUILD:'40',TURNSTILE_SECRET:'synthetic-only',
 AUTH_LIMITER:{limit:async({key})=>{limits.auth.push(key);if(!limits.counts)return {success:true};limits.counts[key]=(limits.counts[key]??0)+1;return {success:limits.counts[key]<=10};}},API_LIMITER:{limit:async()=>({success:true})}};
const ctx={waitUntil(){}};
const same=(live,fixture)=>assert.deepEqual(live,fixture);
function shaped(live,fixture,at='body'){
 if(fixture===null||live===null)return;
 assert.equal(typeof live,typeof fixture,at);
 if(Array.isArray(fixture)){assert(Array.isArray(live),at);return;}
 if(fixture&&typeof fixture==='object')for(const k of Object.keys(fixture)){assert(Object.hasOwn(live,k),`${at}.${k} missing`);shaped(live[k],fixture[k],at+'.'+k);}
}
const fixtureCall=(name,live)=>{assert.equal(live.status,operations[name].response.status,live.text);shaped(live.data,operations[name].response.body);};
async function mobile(path,{method='POST',headers={},body,token,client=clientHeader}={}){
 const h={...(client===null?{}:{'whumpo-client':client}),...(token?{authorization:'Bearer '+token}:{}),...headers};
 if(body!==undefined)h['content-type']='application/json';
 const response=await m.worker.fetch(new Request(base+'/api/mobile/v1'+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);
 const text=await response.text();let data=null;try{data=JSON.parse(text);}catch{}
 assert.equal(response.headers.get('cache-control'),'no-store');
 return {status:response.status,data,text};
}
// The browser: exact-Origin POSTs to the identity router, with a tiny cookie jar passed by the caller.
async function web(action,{body={version:1},cookies={},origin=base}={}){
 const headers={'content-type':'application/json',...(origin?{origin}:{})},jar=Object.entries(cookies).map(([k,v])=>k+'='+v).join('; ');
 if(jar)headers.cookie=jar;
 const response=await m.worker.fetch(new Request(base+'/api/auth/identity/v1/'+action,{method:'POST',headers,body:JSON.stringify(body)}),env,ctx);
 const text=await response.text(),set={};
 for(const line of response.headers.getSetCookie()){const [pair]=line.split(';'),at=pair.indexOf('=');set[pair.slice(0,at)]=pair.slice(at+1);}
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
 return {status:response.status,data:JSON.parse(text),set,text};
}
const handleOf=account=>Buffer.from(account).toString('base64url');
let counter=0;
// A ready account with `keys` active passkeys (each an independent ES256 signer); a project only when the freshness case needs one.
async function owner({keys=2,project=false}={}){
 const account=id(),all=Array.from({length:keys},()=>authenticator());
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",account,`owner${++counter}${account.slice(0,6)}@example.test`);
 await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)",account,'a'.repeat(64),id());
 for(const k of all)await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic passkey','active',NULL,unixepoch(),NULL)",k.id,account,k.publicKey);
 const o={account,key:all[0],all,n:0};
 o.webAssert=(options,key=o.key)=>key.assertion(options,++o.n,{atOrigin:base,handle:handleOf(account)});
 o.nativeAssert=options=>o.key.assertion(options,++o.n,{atOrigin:androidOrigin,handle:handleOf(account)});
 if(project){
  const token=m.newSessionToken();
  await run("INSERT INTO identity_sessions VALUES(?,?,?,1,1,'android',?,'passkey',unixepoch()-5,unixepoch(),unixepoch()+3600)",id(),await m.hashToken(token),account,o.key.id);
  o.scope=async()=>m.admitWorkspace(db,await m.resolveIdentity(db,{version:1,client:'android',kind:'session',token}));
  o.project=id();const now=new Date().toISOString();
  await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',?,?)",o.project,account,now,now);
  await createFixtureWebsite(await o.scope(),account,o.project,{name:'Garden',headline:'Neighborhood gardens',description:'Local gardening',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[],photos:[]},m);
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','read','private-test-acceptance','synthetic mobile handoff fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),account,o.project);
 }
 return o;
}
// A genuine web sign-in: options, an independently signed assertion at the web origin, verify. Returns the session cookie value.
async function webSignIn(o,key=o.key){
 // The shared 10-session cap evicts by (issued_at,id), a tie within one second: start every sign-in from an empty account so no check races it.
 await run("DELETE FROM identity_sessions WHERE account_id=? AND NOT (client='android' AND proof_method='passkey')",o.account);
 const options=await web('login/options');assert.equal(options.status,200,options.text);
 const verify=await web('login/verify',{cookies:{[challengeCookie]:options.set[challengeCookie]},body:{version:1,credential:o.webAssert(options.data.options,key)}});
 assert.equal(verify.status,200,verify.text);return verify.set[sessionCookie];
}
const sha256=v=>createHash('sha256').update(v).digest('base64url');
async function start(purpose='signin'){
 const verifier=randomBytes(32).toString('base64url'),state=randomBytes(24).toString('base64url');
 const r=await mobile('/session/handoff/start',{body:{version:1,purpose,state,codeChallenge:sha256(verifier),codeChallengeMethod:'S256',redirectUri:'https://whumpo.com/app/return'}});
 assert.equal(r.status,200,r.text);
 return {r,verifier,state,id:r.data.handoffId,token:r.data.browserPath.split('/').pop()};
}
const complete=(h,cookie,more={})=>web('handoff/complete',{cookies:{[sessionCookie]:cookie},body:{version:1,browserToken:h.token},...more});
const codeOf=r=>{const u=new URL(r.data.returnUrl);return {code:u.searchParams.get('code'),state:u.searchParams.get('state'),u};};
const exchange=(h,code,over={},opts={})=>mobile('/session/handoff/exchange',{body:{version:1,handoffId:h.id,code,state:h.state,codeVerifier:h.verifier,...over},...opts});
const denied=r=>{assert.equal(r.status,401,r.text);same(r.data,errors.proof_required_signin.body);};
// A handoff row written straight into the table (the schema's own CHECKs still apply) to place time where a test needs it.
async function bound(h,o,sourceId,{createdAgo=10,issuedAgo=5,codeTtl=60}={}){
 const code=randomBytes(32).toString('hex');
 await run('DELETE FROM identity_handoffs WHERE id=?',h.id);
 await run(`INSERT INTO identity_handoffs(id,browser_token_hash,purpose,state,code_challenge,redirect_uri,created_at,expires_at,account_id,source_session_id,auth_epoch,code_hash,code_issued_at,code_expires_at)
  VALUES(?,?,'signin',?,?,'https://whumpo.com/app/return',unixepoch()-?,unixepoch()-?+300,?,?,1,?,unixepoch()-?,unixepoch()-?+?)`,
  h.id,await m.hashToken(randomBytes(32).toString('hex')),h.state,sha256(h.verifier),createdAgo,createdAgo,o.account,sourceId,await m.hashToken(code),issuedAgo,issuedAgo,codeTtl);
 return code;
}
const sourceOf=async cookie=>(await one('SELECT * FROM identity_sessions WHERE token_hash=?',await m.hashToken(cookie)));
try{
 const a=await owner(),b=await owner();

 await check('start: fixture pair, anonymous, browser token stored only as its SHA-256, 300 second life, state and challenge recorded',async()=>{
  limits.auth.length=0;
  const h=await start('signup');fixtureCall('session.handoffStart',h.r);
  assert.match(h.id,/^[0-9a-f-]{36}$/);assert.match(h.r.data.browserPath,/^\/workspace\/native\/[0-9a-f]{64}$/);
  assert.deepEqual(limits.auth,['mobile:local','handoff:local','handoff:local','handoff:local'],'anonymous route limited by AUTH_LIMITER, start on its own tighter key');
  const row=await one('SELECT * FROM identity_handoffs WHERE id=?',h.id);
  assert.equal(row.browser_token_hash,await m.hashToken(h.token));assert.equal(await count('identity_handoffs','browser_token_hash=?',h.token),0,'the browser token itself is never stored');
  assert.equal(row.purpose,'signup');assert.equal(row.state,h.state);assert.equal(row.code_challenge,sha256(h.verifier));assert.equal(row.redirect_uri,'https://whumpo.com/app/return');
  assert.equal(row.expires_at-row.created_at,300);assert.equal(Date.parse(h.r.data.expiresAt)/1000,row.expires_at);
  assert.equal(row.account_id,null);assert.equal(row.code_hash,null);
 });

 await check('start: wrong redirect, method, purpose, state, challenge, extra field, cookie, bearer and missing client are refused and write nothing',async()=>{
  const before=await count('identity_handoffs'),good={version:1,purpose:'signin',state:randomBytes(24).toString('base64url'),codeChallenge:sha256('v'.repeat(43)),codeChallengeMethod:'S256',redirectUri:'https://whumpo.com/app/return'};
  for(const [name,over] of [['other host',{redirectUri:'https://evil.example/app/return'}],['query',{redirectUri:'https://whumpo.com/app/return?x=1'}],['custom scheme',{redirectUri:'whumpo://return'}],['http',{redirectUri:'http://whumpo.com/app/return'}],
   ['plain PKCE',{codeChallengeMethod:'plain'}],['purpose',{purpose:'admin'}],['short state',{state:'short'}],['state chars',{state:'!'.repeat(24)}],['challenge length',{codeChallenge:'A'.repeat(42)}],['extra field',{extra:1}]]){
   const r=await mobile('/session/handoff/start',{body:{...good,...over}});assert.equal(r.status,400,name+r.text);
  }
  assert.equal((await mobile('/session/handoff/start',{body:good,headers:{cookie:sessionCookie+'='+'a'.repeat(64)}})).status,400);
  assert.equal((await mobile('/session/handoff/start',{body:good,token:'a'.repeat(64)})).status,400);
  assert.equal((await mobile('/session/handoff/start',{body:good,client:null})).status,400);
  assert.equal((await mobile('/session/handoff/start',{method:'GET'})).status,404);
  assert.equal(await count('identity_handoffs'),before);
 });

 await check('happy path: web sign-in with a signed passkey, complete issues one 60 second code, exchange mints an android handoff session with the source proof time',async()=>{
  const h=await start(),cookie=await webSignIn(a),source=await sourceOf(cookie);
  const done=await complete(h,cookie);assert.equal(done.status,200,done.text);
  const {code,state,u}=codeOf(done);
  assert.equal(u.origin+u.pathname,'https://whumpo.com/app/return');assert.equal([...u.searchParams.keys()].join(','),'code,state','exactly code and state');
  assert.match(code,/^[0-9a-f]{64}$/);assert.equal(state,h.state);assert.equal(u.hash,'');
  const bound1=await one('SELECT * FROM identity_handoffs WHERE id=?',h.id);
  assert.equal(bound1.account_id,a.account);assert.equal(bound1.source_session_id,source.id);assert.equal(bound1.auth_epoch,1);assert.equal(bound1.code_hash,await m.hashToken(code));
  assert.equal(bound1.code_expires_at-bound1.code_issued_at,60);assert.equal(await count('identity_handoffs','code_hash=?',code),0,'the code itself is never stored');assert.equal(bound1.native_session_id,null);
  const r=await exchange(h,code);fixtureCall('session.handoffExchange',r);
  const s=r.data.session;assert.match(s.token,/^[0-9a-f]{64}$/);assert.equal(s.freshUntil,null,'a handoff creates no freshness');
  const row=await one('SELECT * FROM identity_sessions WHERE token_hash=?',await m.hashToken(s.token));
  assert.equal(row.client,'android');assert.equal(row.proof_method,'handoff');assert.equal(row.proof_at,source.proof_at,'the proof time is the source session proof time');
  assert.equal(row.account_id,a.account);assert.equal(row.credential_id,source.credential_id);assert(row.expires_at<=source.expires_at);assert.equal(Date.parse(s.expiresAt)/1000,row.expires_at);
  assert.equal(await count('identity_sessions','token_hash=?',s.token),0,'the bearer is never stored');
  assert.equal((await one('SELECT native_session_id FROM identity_handoffs WHERE id=?',h.id)).native_session_id,row.id);
  const read=await mobile('/session',{method:'GET',token:s.token});assert.equal(read.status,200,read.text);assert.equal(read.data.session.freshUntil,null);assert.match(read.data.account.label,/^o\*\*\*@example\.test$/);
  assert.equal(await count('identity_grants','account_id=?',a.account),0,'native never receives a grant');
 });

 await check('complete: exact Origin, JSON body, cookie session and the browser token are required',async()=>{
  const h=await start(),cookie=await webSignIn(a);
  assert.equal((await complete(h,cookie,{origin:'https://elsewhere.invalid'})).status,400);
  assert.equal((await complete(h,cookie,{origin:null})).status,400);
  assert.equal((await web('handoff/complete',{body:{version:1,browserToken:h.token}})).status,401,'no cookie');
  assert.equal((await web('handoff/complete',{cookies:{[sessionCookie]:cookie},body:{version:1,browserToken:'xyz'}})).status,400);
  assert.equal((await web('handoff/complete',{cookies:{[sessionCookie]:cookie},body:{version:1,browserToken:h.token,extra:1}})).status,400);
  assert.equal((await web('handoff/complete',{cookies:{[sessionCookie]:cookie},body:{version:1,browserToken:randomBytes(32).toString('hex')}})).status,409,'unknown token');
  const bearer=await m.worker.fetch(new Request(base+'/api/auth/identity/v1/handoff/complete',{method:'POST',headers:{origin:base,'content-type':'application/json',authorization:'Bearer '+cookie},body:JSON.stringify({version:1,browserToken:h.token})}),env,ctx);
  assert.equal(bearer.status,401,'a bearer is no browser session');
  assert.equal((await one('SELECT account_id FROM identity_handoffs WHERE id=?',h.id)).account_id,null,'nothing was bound');
 });

 await check('PKCE: a wrong verifier or wrong state is refused and burns the code; a short verifier and a malformed body never reach the database',async()=>{
  for(const [name,over] of [['verifier',{codeVerifier:randomBytes(32).toString('base64url')}],['state',{state:randomBytes(24).toString('base64url')}]]){
   const h=await start(),cookie=await webSignIn(a),{code}=codeOf(await complete(h,cookie));
   denied(await exchange(h,code,over));
   assert.equal(await count('identity_handoffs','id=?',h.id),0,name+': the code is burned');
   denied(await exchange(h,code),'the right verifier no longer works');
  }
  const h=await start(),cookie=await webSignIn(a),{code}=codeOf(await complete(h,cookie));
  for(const over of [{codeVerifier:'short'},{state:'short'},{code:'z'.repeat(64)},{handoffId:'not-a-uuid'},{extra:1}]){const r=await exchange(h,code,over);assert.equal(r.status,400,JSON.stringify(over));}
  assert.equal((await exchange(h,code,{},{token:'a'.repeat(64)})).status,400,'a bearer is refused on an anonymous route');
  assert.equal((await exchange(h,code)).status,200,'malformed attempts did not spend the code');
 });

 await check('replay: a spent code is refused, concurrent exchanges mint exactly one session, and the code belongs to its own handoff id',async()=>{
  const h=await start(),cookie=await webSignIn(a),{code}=codeOf(await complete(h,cookie));
  const [x,y]=await Promise.all([exchange(h,code),exchange(h,code)]);
  assert.deepEqual([x.status,y.status].sort(),[200,401]);
  const sessions=await count('identity_sessions',"client='android' AND proof_method='handoff' AND account_id=? AND id=(SELECT native_session_id FROM identity_handoffs WHERE id=?)",a.account,h.id);assert.equal(sessions,1);
  denied(await exchange(h,code));
  const other=await start(),otherCookie=await webSignIn(a),second=codeOf(await complete(other,otherCookie));
  denied(await exchange(h,second.code),'another handoff code under this id');
  assert.equal((await exchange(other,second.code)).status,200);
 });

 await check('code expiry (60 seconds) and handoff expiry (300 seconds) deny the exchange; an expired handoff cannot be completed',async()=>{
  const cookie=await webSignIn(a),source=await sourceOf(cookie);
  const stale=await start(),staleCode=await bound(stale,a,source.id,{createdAgo:100,issuedAgo:70,codeTtl:60});denied(await exchange(stale,staleCode));
  const late=await start(),lateCode=await bound(late,a,source.id,{createdAgo:310,issuedAgo:30,codeTtl:60});
  assert.equal(await count('identity_handoffs','id=? AND code_expires_at>unixepoch() AND expires_at<=unixepoch()',late.id),1,'code alive, handoff dead');
  denied(await exchange(late,lateCode));
  const live=await start(),liveCode=await bound(live,a,source.id,{createdAgo:100,issuedAgo:30,codeTtl:60});assert.equal((await exchange(live,liveCode)).status,200,'inside both windows');
  const old=await start();await run('DELETE FROM identity_handoffs WHERE id=?',old.id);
  await run("INSERT INTO identity_handoffs(id,browser_token_hash,purpose,state,code_challenge,redirect_uri,created_at,expires_at) VALUES(?,?,'signin',?,?,'https://whumpo.com/app/return',unixepoch()-310,unixepoch()-10)",old.id,await m.hashToken(old.token),old.state,sha256(old.verifier));
  assert.equal((await complete(old,cookie)).status,409);assert.equal((await one('SELECT account_id FROM identity_handoffs WHERE id=?',old.id)).account_id,null);
 });

 await check('source revocation before the exchange: sign-out cascades the handoff away and a changed epoch or removed key denies',async()=>{
  const h=await start(),cookie=await webSignIn(a),{code}=codeOf(await complete(h,cookie));
  assert.equal((await web('logout',{cookies:{[sessionCookie]:cookie}})).status,200);
  assert.equal(await count('identity_handoffs','id=?',h.id),0,'the foreign key cascade removes the handoff with its source session');
  denied(await exchange(h,code));assert.equal(await count('identity_sessions',"proof_method='handoff' AND account_id=? AND id IN (SELECT native_session_id FROM identity_handoffs WHERE id=?)",a.account,h.id),0);
  const e=await owner(),h2=await start(),cookie2=await webSignIn(e),{code:code2}=codeOf(await complete(h2,cookie2));
  await run('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?',e.account);
  denied(await exchange(h2,code2));assert.equal(await count('identity_sessions',"client='android' AND account_id=?",e.account),0);
  const k=await owner(),h3=await start(),cookie3=await webSignIn(k),{code:code3}=codeOf(await complete(h3,cookie3));
  await run('DELETE FROM identity_sessions WHERE token_hash=?',await m.hashToken(cookie3));
  denied(await exchange(h3,code3));
 });

 await check('one-key and incomplete accounts are refused at complete and at exchange',async()=>{
  const one1=await owner({keys:1}),h=await start(),cookie=await webSignIn(one1,one1.key);
  const r=await complete(h,cookie);assert.equal(r.status,403,r.text);assert.equal(r.data.code,'identity_incomplete');assert.equal((await one('SELECT account_id FROM identity_handoffs WHERE id=?',h.id)).account_id,null);
  // recovery grant (restricted purpose, not an ordinary session)
  const rec=await owner(),attempt=id(),grant=m.newSessionToken();
  await run("INSERT INTO identity_attempts VALUES(?,?,'recovery','open',0,1,1,unixepoch())",attempt,rec.account);
  await run("INSERT INTO identity_grants VALUES(?,?,?,1,1,'web','recovery',?,'recovery-key',unixepoch()-5,0,NULL,1,unixepoch(),unixepoch()+900)",id(),await m.hashToken(grant),rec.account,attempt);
  const hr=await start('recovery'),g=await web('handoff/complete',{cookies:{[grantCookie]:grant},body:{version:1,browserToken:hr.token}});
  assert.equal(g.status,403,g.text);assert.equal(g.data.code,'identity_incomplete');assert.equal((await one('SELECT account_id FROM identity_handoffs WHERE id=?',hr.id)).account_id,null);
  // an enrolling account holds an enrollment grant
  const enr=id(),attempt2=id(),grant2=m.newSessionToken(),key=authenticator();
  await run("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",enr,`enrol${enr.slice(0,6)}@example.test`);
  await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,current_attempt_id) VALUES(?,1,'enrolling',1,?)",enr,attempt2);
  await run("INSERT INTO identity_attempts VALUES(?,?,'enrollment','open',0,1,0,unixepoch())",attempt2,enr);
  await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'First passkey','staged',?,unixepoch(),NULL)",key.id,enr,key.publicKey,attempt2);
  await run("INSERT INTO identity_grants VALUES(?,?,?,1,1,'web','enrollment',?,'passkey',unixepoch()-5,0,?,NULL,unixepoch(),unixepoch()+900)",id(),await m.hashToken(grant2),enr,attempt2,key.id);
  const he=await start('signup'),ge=await web('handoff/complete',{cookies:{[grantCookie]:grant2},body:{version:1,browserToken:he.token}});assert.equal(ge.status,403,ge.text);assert.equal(ge.data.code,'identity_incomplete');
  // a code issued earlier is not honoured once the account no longer has two active keys
  const two=await owner(),h2=await start(),cookie2=await webSignIn(two),{code}=codeOf(await complete(h2,cookie2));
  await run('DELETE FROM identity_credentials WHERE id=? AND account_id=?',two.all[1].id,two.account);
  denied(await exchange(h2,code));
 });

 await check('cross-account: another account cannot bind a bound handoff, spend its code, or reach its session',async()=>{
  const h=await start(),cookieA=await webSignIn(a),cookieB=await webSignIn(b),{code}=codeOf(await complete(h,cookieA));
  const steal=await complete(h,cookieB);assert.equal(steal.status,409,steal.text);
  assert.equal((await one('SELECT account_id FROM identity_handoffs WHERE id=?',h.id)).account_id,a.account,'still bound to A');
  // B's own handoff and verifier cannot spend A's code
  const hb=await start();denied(await exchange(hb,code));
  // A's code with B's verifier burns it for everyone
  denied(await exchange(h,code,{codeVerifier:hb.verifier}));denied(await exchange(h,code));
  // a legitimate exchange yields a session for A only
  const h2=await start(),c2=codeOf(await complete(h2,cookieA)),s=(await exchange(h2,c2.code)).data.session;
  const row=await one('SELECT account_id FROM identity_sessions WHERE token_hash=?',await m.hashToken(s.token));assert.equal(row.account_id,a.account);assert.notEqual(row.account_id,b.account);
  assert.equal(await count('identity_sessions',"client='android' AND account_id=? AND proof_method='handoff'",b.account),0);
 });

 await check('a handoff session is never fresh: confirm needs reauth, then the same request ID succeeds; the web fresh predicate also refuses it',async()=>{
  const f=await owner({project:true}),cookie=await webSignIn(f),h=await start(),{code}=codeOf(await complete(h,cookie)),session=(await exchange(h,code)).data.session;
  const proofAt=(await one('SELECT proof_at FROM identity_sessions WHERE token_hash=?',await m.hashToken(session.token))).proof_at;assert(proofAt>=Math.floor(Date.now()/1000)-30,'the source proof is only seconds old');
  const principal=await m.resolveIdentity(db,{version:1,client:'android',kind:'session',token:session.token});
  await assert.rejects(()=>m.assertCurrentIdentity(db,principal,{purpose:'workspace',freshPasskey:true,bindIdentityRevision:false}),e=>e.code==='proof_required');
  const revisionOf=async()=>(await m.readChat(await f.scope(),f.account)).state.revision;
  const q=await proposeFixtureWebsite(await f.scope(),f.account,f.project,[{type:'content.replace',contentId:'headline',text:'Handoff garden'}],m);
  const control={type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision},requestId=id();
  const confirm=async token=>mobile('/reviews/confirm',{token,body:{version:1,requestId,expectedRevision:await revisionOf(),control}});
  const versions=()=>count('project_spec_applies','project_id=?',f.project),before=await versions();
  const refused=await confirm(session.token);assert.equal(refused.status,401,refused.text);same(refused.data,errors.proof_required_fresh.body);assert.equal(await versions(),before);
  const options=await mobile('/session/reauth/options',{token:session.token,body:{version:1}});assert.equal(options.status,200,options.text);
  const done=await mobile('/session/reauth/verify',{token:session.token,body:{version:1,challengeId:options.data.challengeId,credential:f.nativeAssert(options.data.options)}});assert.equal(done.status,200,done.text);
  assert.match(done.data.session.freshUntil,/Z$/,'only a real native passkey assertion creates freshness');
  const ok=await confirm(session.token);assert.equal(ok.status,200,ok.text);assert.equal(await versions(),before+1);
 });

 await check('web completion needs a fresh web passkey: a stale proof is proof_required until the page reauthenticates',async()=>{
  const g=await owner(),h=await start(),old=m.newSessionToken();
  await run("INSERT INTO identity_sessions VALUES(?,?,?,1,1,'web',?,'passkey',unixepoch()-3000,unixepoch()-3000,unixepoch()+3000)",id(),await m.hashToken(old),g.account,g.key.id);
  const refused=await complete(h,old);assert.equal(refused.status,401,refused.text);assert.equal(refused.data.code,'proof_required');
  assert.equal((await one('SELECT account_id FROM identity_handoffs WHERE id=?',h.id)).account_id,null);
  const options=await web('reauth/options',{cookies:{[sessionCookie]:old}});assert.equal(options.status,200,options.text);
  const verified=await web('reauth/verify',{cookies:{[sessionCookie]:old,[challengeCookie]:options.set[challengeCookie]},body:{version:1,credential:g.webAssert(options.data.options)}});assert.equal(verified.status,200,verified.text);
  const fresh=verified.set[sessionCookie];assert.equal((await complete(h,fresh)).status,200);
 });

 await check('/app/return: static, no-store, no-referrer, never echoes the query, GET only',async()=>{
  const code='c'.repeat(64),state='s'.repeat(24);
  const r=await m.worker.fetch(new Request(`${base}/app/return?code=${code}&state=${state}`),env,ctx),body=await r.text();
  assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/^text\/html/);assert.equal(r.headers.get('cache-control'),'no-store');assert.equal(r.headers.get('referrer-policy'),'no-referrer');
  assert(!body.includes(code)&&!body.includes(state)&&!/<script/i.test(body));assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
  assert.equal((await m.worker.fetch(new Request(base+'/app/return',{method:'POST'}),env,ctx)).status,405);
 });

 await check('no browser token or code is ever echoed in an error body or logged',async()=>{
  const logged=[],original=console.error;console.error=(...x)=>logged.push(x.join(' '));
  try{
   const h=await start(),cookie=await webSignIn(a),{code}=codeOf(await complete(h,cookie)),r=await exchange(h,code,{codeVerifier:'x'.repeat(43)});
   assert(!r.text.includes(code)&&!r.text.includes(h.token)&&!logged.join('').includes(code));
   const w=await complete(h,cookie);assert(!w.text.includes(code)&&!w.text.includes(h.token));
  }finally{console.error=original;}
 });

 await check('start has its own 3 per minute budget per client, IPv6 is keyed by /64, and start is limited before login is',async()=>{
  const body=()=>({version:1,purpose:'signin',state:randomBytes(24).toString('base64url'),codeChallenge:sha256('v'.repeat(43)),codeChallengeMethod:'S256',redirectUri:'https://whumpo.com/app/return'});
  const from=(ip,path='/session/handoff/start',b=body())=>mobile(path,{body:b,headers:{'cf-connecting-ip':ip}});
  limits.counts={};limits.auth.length=0;
  try{
   assert.equal((await from('2001:db8:1:2::1')).status,200);
   assert.equal((await from('2001:0DB8:0001:0002:aaaa:bbbb:cccc:dddd')).status,200,'expanded, upper-case form of the same /64');
   assert.equal((await from('2001:db8:1:2:ffff::9')).status,200);
   const blocked=await from('2001:db8:1:2:1234::5');assert.equal(blocked.status,429,blocked.text);same(blocked.data,errors.rate_limited.body);
   assert(limits.auth.includes('handoff:2001:db8:1:2::/64'),'keyed by the /64 prefix');
   assert.equal((await from('2001:db8:1:3::1')).status,200,'a neighbouring /64 has its own budget');
   assert.equal((await from('203.0.113.7')).status,200);
   // login is not yet limited for the blocked /64: start trips first (3 starts cost 9 of its 10 units on the mobile key).
   assert.equal((await from('2001:db8:1:2::77','/session/login/options',{version:1})).status,200,'login still works where start is blocked');
   assert((limits.counts['mobile:2001:db8:1:2::/64']??0)<=10);
  }finally{limits.counts=null;}
 });

 await check('preview (consent page): shows only the purpose of an open handoff to a signed-in session; bound, unknown and anonymous are refused',async()=>{
  const h=await start('recovery'),cookie=await webSignIn(a),preview=t=>web('handoff/preview',{cookies:{[sessionCookie]:cookie},body:{version:1,browserToken:t}});
  const r=await preview(h.token);assert.equal(r.status,200,r.text);same(r.data,{version:1,purpose:'recovery'});
  assert.equal((await web('handoff/preview',{body:{version:1,browserToken:h.token}})).status,401);
  assert.equal((await preview(randomBytes(32).toString('hex'))).status,409);
  assert.equal((await complete(h,cookie)).status,200);assert.equal((await preview(h.token)).status,409,'a bound handoff reveals nothing');
 });

 await check('the 2000 row cap: a full table refuses a new handoff with unavailable and writes nothing',async()=>{
  await run('DELETE FROM identity_handoffs');
  await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<2000)
   INSERT INTO identity_handoffs(id,browser_token_hash,purpose,state,code_challenge,redirect_uri,created_at,expires_at)
   SELECT lower(hex(randomblob(18))),lower(hex(randomblob(32))),'signin',?,?,'https://whumpo.com/app/return',unixepoch(),unixepoch()+300 FROM n`,'s'.repeat(24),'c'.repeat(43));
  assert.equal(await count('identity_handoffs'),2000);
  const body={version:1,purpose:'signin',state:randomBytes(24).toString('base64url'),codeChallenge:sha256('v'.repeat(43)),codeChallengeMethod:'S256',redirectUri:'https://whumpo.com/app/return'};
  const full=await mobile('/session/handoff/start',{body});assert.equal(full.status,503,full.text);assert.equal(full.data.error.code,'unavailable');assert.equal(await count('identity_handoffs'),2000);
  await run('DELETE FROM identity_handoffs');
 });

 console.log(`Mobile handoff M3: ${cases} checks over start, complete, exchange and /app/return on ${process.argv.includes('--d1')?'local D1':'SQLite'}.`);
}catch(error){console.error(error);process.exitCode=1;}
finally{await fixture.close();}
