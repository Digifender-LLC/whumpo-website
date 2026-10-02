import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
const built=await build({stdin:{contents:"export * from './src/workspace-identity/http';export {default as worker} from './src/index';export * from './src/workspace-identity/admission';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {worker,workspaceIdentity,identityCookies,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture(),db=fixture.db,originalFetch=globalThis.fetch,originalEqual=crypto.subtle.timingSafeEqual;
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
globalThis.fetch=async()=>Response.json({success:true,hostname:'whumpo.com',action:'register'});
let limited=false,apiLimited=false,rateCalls=0,cases=0,phase='transport refusals';
const env={DB:db,ENVIRONMENT:'test',TURNSTILE_SECRET:'synthetic-only',TURNSTILE_SITE_KEY:'synthetic-public',AUTH_LIMITER:{limit:async()=>{rateCalls++;return {success:!limited}}},API_LIMITER:{limit:async()=>({success:!apiLimited})}};
const handleIdentityRequest=(request,environment)=>worker.fetch(request,environment,{waitUntil:()=>{}});
const workspaceCall=(browser,path,body)=>handleIdentityRequest(new Request('https://whumpo.com/api'+path,{method:body===undefined?'GET':'POST',headers:{cookie:browser.header(),origin:'https://whumpo.com','content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),env);
const base='https://whumpo.com/api/auth/identity/v1/',id=()=>crypto.randomUUID(),run=(sql,...values)=>db.prepare(sql).bind(...values).run(),row=(sql,...values)=>db.prepare(sql).bind(...values).first();
class Browser{
 cookies=new Map();counters=new Map();
 header(){return [...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')}
 async call(action,data={version:1},extra={}){
  const request=new Request(base+action,{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json',cookie:this.header(),...extra.headers},body:JSON.stringify(data),...extra});
  const response=await handleIdentityRequest(request,env);assert(response);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');
  for(const cookie of response.headers.getSetCookie()){
   assert(cookie.includes('; Secure; HttpOnly; SameSite='));assert(!cookie.includes('Domain='));
   const [pair]=cookie.split(';'),[name,value]=pair.split('=');assert(cookie.includes(`SameSite=${name===identityCookies.session?'Lax':'Strict'};`));if(value)this.cookies.set(name,value);else this.cookies.delete(name);
   assert(cookie.includes(`Path=${name===identityCookies.session?'/;':'/api/auth/identity/;'}`));
  }
  const result=await response.json();const text=JSON.stringify(result);
  assert(!/"(token|principal|challengeToken|token_hash|kit_verifier|verifier|public_key|authorityId)"/.test(text));
  for(const value of this.cookies.values())assert(!text.includes(value));
  return {status:response.status,data:result,response};
 }
 async ok(action,data){const r=await this.call(action,data);assert.equal(r.status,200,`${action}: ${r.data.error}`);return r.data}
 async no(action,data,status,extra){const r=await this.call(action,data,extra);assert.equal(r.status,status,`${action}: ${r.data.error}`);cases++;return r.data}
 async state(){return (await this.ok('state')).identity}
 intent(s){return {version:1,requestId:id(),attemptId:s.attemptId,expectedRevision:s.expectedRevision,expectedEpoch:s.expectedEpoch}}
 async assertion(action,key,data){const opts=await this.ok(action+'/options',data),counter=(this.counters.get(key.id)??0)+1;this.counters.set(key.id,counter);return this.ok(action+'/verify',{version:1,credential:key.assertion(opts.options,counter)})}
 async add(name='Second passkey'){const s=await this.state(),opts=await this.ok('add/options',{version:1,requestId:id(),attemptId:s.attemptId,expectedRevision:s.expectedRevision,name}),key=authenticator();await this.ok('add/verify',{version:1,credential:key.registration(opts.options)});return key}
 async kit(){const s=await this.state(),change=this.intent(s),kit=await this.ok('kit/prepare',change);assert.match(kit.key,/^[a-f0-9]{64}$/);assert.equal(kit.filename,'whumpo-recovery-kit.txt');assert(kit.text.includes(kit.key));assert(!JSON.stringify(await this.state()).includes(kit.key));
  const replay=await this.ok('kit/prepare',change);assert.equal(replay.key,null);assert.equal(replay.text,null);
  const saved=await this.state();await this.ok('kit/save',{...this.intent(saved),offerId:kit.offer.id,generation:kit.offer.generation,saved:true});return kit}
}
async function signup(b){const code=id(),email=id()+'@example.invalid';await run("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)",await hashToken(code));
 const opts=await b.ok('signup/options',{version:1,email,inviteCode:code,usBased:true,turnstileToken:id()}),key=authenticator();await b.ok('signup/verify',{version:1,credential:key.registration(opts.options)});return {email,key,code};}
async function ready(b){const f=await signup(b);f.second=await b.add();f.kit=await b.kit();await b.assertion('reauth',f.second);const s=await b.state();await b.ok('enrollment/complete',{...b.intent(s),offerId:f.kit.offer.id,generation:f.kit.offer.generation});return f}
try{
 const b=new Browser();assert.equal(await b.state(),null);const initialCalls=rateCalls;await b.ok('config');await b.state();assert.equal(rateCalls,initialCalls);
 await b.no('state',{version:0},409);await b.no('state',{version:1,extra:true},400);await b.no('state',{version:1},400,{headers:{origin:'https://elsewhere.invalid','content-type':'application/json'}});
 await b.no('state',{},400,{headers:{origin:'https://whumpo.com','content-type':'text/plain'}});
 await b.no('state',{version:1,padding:'x'.repeat(74000)},400);await b.no('state?key=bad',{version:1},400);
 const future=await handleIdentityRequest(new Request('https://whumpo.com/api/auth/identity/v0/state',{method:'POST',headers:{origin:'https://whumpo.com'}}),env);assert.equal(future.status,409);cases++;
 assert.equal((await handleIdentityRequest(new Request('https://whumpo.com/api/auth/login'),env)).status,404);
 await b.no('state',{},400,{method:'GET',body:undefined});
 const stale=new Browser();stale.cookies.set(identityCookies.session,'f'.repeat(64));await stale.no('state',{version:1},401);await stale.ok('logout');assert.equal(stale.cookies.size,0);
 const legacy=new Browser();legacy.cookies.set('tellumo_session','f'.repeat(64));assert.equal(await legacy.state(),null);await assert.rejects(()=>workspaceIdentity(new Request('https://whumpo.com/api/profile',{headers:{cookie:legacy.header()}}),env),e=>e.code==='proof_required');cases++;
 limited=true;await b.no('login/options',{version:1},429);assert.equal(await b.state(),null);limited=false;apiLimited=true;await b.no('state',{version:1},429);apiLimited=false;
 phase='enrollment and strict authority';
 for(const path of ['/profile','/projects','/chat']){assert.equal((await workspaceCall(b,path)).status,401);cases++;}
 const f=await signup(b),firstState=await b.state();assert.equal(firstState.purpose,'enrollment');assert(!b.cookies.has(identityCookies.session));assert(!b.cookies.has(identityCookies.challenge));
 for(const path of ['/profile','/projects','/chat']){assert.equal((await workspaceCall(b,path)).status,401);cases++;}
 await assert.rejects(()=>workspaceIdentity(new Request('https://whumpo.com/api/profile',{headers:{cookie:b.header()}}),env),e=>e.code==='proof_required');cases++;
 const duplicate=await b.call('state',{version:1},{headers:{origin:'https://whumpo.com','content-type':'application/json',cookie:`${b.header()}; ${b.header()}`}});assert.equal(duplicate.status,400);cases++;
 const ambiguous=new Browser();ambiguous.cookies=new Map(b.cookies);ambiguous.cookies.set(identityCookies.session,'f'.repeat(64));await ambiguous.no('state',{version:1},400);
 const held=b.cookies.get(identityCookies.grant),second=await b.add(),kit=await b.kit();
 const saved=await b.state();assert.equal(saved.kit.offer.saved,true);assert.equal(saved.freshPasskey,false);
 await b.no('enrollment/complete',{...b.intent(saved),offerId:kit.offer.id,generation:kit.offer.generation},401);
 await b.assertion('reauth',second);const final=await b.state();assert.equal(final.freshPasskey,true);
 await b.ok('enrollment/complete',{...b.intent(final),offerId:kit.offer.id,generation:kit.offer.generation});assert.equal((await b.state()).purpose,'workspace');assert(!b.cookies.has(identityCookies.grant));assert(b.cookies.has(identityCookies.session));
 const profile=await workspaceCall(b,'/profile');assert.equal(profile.status,200);const publicProfile=await profile.json();assert.equal(publicProfile.onboardingComplete,false);assert(!Object.hasOwn(publicProfile,'passwordEnabled'));
 assert.equal((await workspaceCall(b,'/chat')).status,409);assert.equal((await workspaceCall(b,'/workspace/dashboard')).status,409);
 for(const path of ['/auth/login','/auth/register','/auth/recover','/auth/passkeys/login/options','/auth/logout']){assert.equal((await workspaceCall(b,path,{})).status,404);cases++;}
 const ordinary=b.cookies.get(identityCookies.session);await workspaceIdentity(new Request('https://whumpo.com/api/profile',{headers:{cookie:b.header()}}),env);
 const expiredGrant=new Browser();expiredGrant.cookies.set(identityCookies.grant,held);await expiredGrant.no('state',{version:1},401);
 phase='recovery and lost replies';
 await b.ok('recovery/start',{version:1,email:f.email,key:kit.key});assert(!b.cookies.has(identityCookies.session));assert.equal((await b.state()).purpose,'recovery');
 const stillOrdinary=new Browser();stillOrdinary.cookies.set(identityCookies.session,ordinary);assert.equal((await stillOrdinary.state()).purpose,'workspace');
 let s=await b.state();await b.ok('recovery/review',{...b.intent(s),mode:'all',lostIds:s.keys.map(k=>k.id)});const replacement=await b.kit();s=await b.state();const intent={...b.intent(s),offerId:replacement.offer.id,generation:replacement.offer.generation,reviewId:s.recovery.review.id,confirmation:'secure-account'};
 const lostReply=await b.ok('recovery/secure',intent);assert(lostReply.receipt);
 for(const path of ['/profile','/projects','/chat']){assert.equal((await workspaceCall(stillOrdinary,path)).status,401);cases++;}await stillOrdinary.no('state',{version:1},401);
 b.cookies.clear();await b.ok('recovery/start',{version:1,email:f.email,key:replacement.key});s=await b.state();assert.equal(s.recovery.status,'secured');assert.equal(s.keys.length,0);assert.equal((await b.ok('recovery/secure',intent)).receipt.operationId,intent.requestId);
 await b.no('recovery/start',{version:1,email:f.email,key:kit.key},401);
 await b.add('Replacement one');const replacementKey=await b.add('Replacement two');s=await b.state();assert.equal(s.recovery.canComplete,true);
 await b.assertion('recovery/complete',replacementKey,{...b.intent(s),generation:s.kit.activeGeneration,reviewId:s.recovery.review.id});assert.equal((await b.state()).purpose,'workspace');assert(!b.cookies.has(identityCookies.grant));
 phase='ordinary rotation and logout';
 const newKit=await b.kit();s=await b.state();await b.ok('kit/rotate',{...b.intent(s),offerId:newKit.offer.id,generation:newKit.offer.generation});assert.equal((await b.state()).kit.activeGeneration,3);
 const loggedOutToken=b.cookies.get(identityCookies.session);await b.ok('login/options');const challengeHash=await hashToken(b.cookies.get(identityCookies.challenge));await b.ok('logout');assert.equal(b.cookies.size,0);assert.equal(await b.state(),null);
 assert.equal(await row('SELECT 1 FROM identity_sessions WHERE token_hash=?',await hashToken(loggedOutToken)),null);assert.equal(await row('SELECT 1 FROM identity_challenges WHERE token_hash=?',challengeHash),null);
 phase='cancellation and challenge refusal';
 const pending=new Browser(),cancelled=await signup(pending);s=await pending.state();await pending.ok('enrollment/cancel',{...pending.intent(s),confirmation:'cancel-enrollment'});assert.equal(await pending.state(),null);assert.equal((await row('SELECT used_at FROM invitations WHERE code_hash=?',await hashToken(cancelled.code))).used_at!==null,true);
 await pending.ok('login/options');const invalidJSONHash=await hashToken(pending.cookies.get(identityCookies.challenge));await pending.no('login/verify',{},400,{body:'{'});assert.equal(await row('SELECT 1 FROM identity_challenges WHERE token_hash=?',invalidJSONHash),null);
 await pending.ok('login/options');await pending.no('login/verify',{version:1,credential:{}},401);assert(!pending.cookies.has(identityCookies.challenge));
 await pending.no('login/verify',{version:1,credential:{}},401);
 const separate=new Browser();await ready(separate);s=await separate.state();await separate.ok('passkey/remove',{...separate.intent(s),credentialId:s.keys[0].id,confirmation:'remove-passkey'});assert.equal(await separate.state(),null);
 console.log(`Current Worker identity HTTP: ${cases} refusal checks plus real signed enrollment, lost-reply recovery, rotation, removal and logout (${process.argv.includes('--d1')?'local D1':'SQLite'}).`);
}catch(error){console.error(`Identity HTTP failed during ${phase}: ${error.message}`);process.exitCode=1;}
finally{globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await fixture.close();}
