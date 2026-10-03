import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession,interceptDatabase} from './helpers/workspace-identity.mjs';
import {liveWorkspaceBrowser} from './helpers/live-workspace.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';

const modules=await currentFixtureModules([
 'src/index.ts','src/workspace-identity/http.ts',
 'src/feature-inclusion.ts','src/feature-admission.ts','src/feature-preview-grants.ts',
 'src/backup-chat.ts','src/dns-chat.ts',
]);
const m=modules.identity,{default:worker}=await modules.module('src/index.ts');
const {identityCookies}=await modules.module('src/workspace-identity/http.ts');
const inclusion=await modules.module('src/feature-inclusion.ts');
const features=await modules.module('src/feature-admission.ts');
const grants=await modules.module('src/feature-preview-grants.ts');
const {backupChatCommand}=await modules.module('src/backup-chat.ts');
const {dnsChatCommand}=await modules.module('src/dns-chat.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const run=(sql,...args)=>db.prepare(sql).bind(...args).run();
const row=(sql,...args)=>db.prepare(sql).bind(...args).first();
const base='https://whumpo.com',identityPath='/api/auth/identity/v1/';
const gh={clientId:'fixture',clientSecret:'synthetic',appId:1,slug:'fixture',key:fixtureKeyring('a'.repeat(64))};
const cf={clientId:'fixture',clientSecret:'synthetic',key:gh.key};
const env={DB:db,ENVIRONMENT:'test',TURNSTILE_SECRET:'synthetic',TURNSTILE_SITE_KEY:'synthetic',
 AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},
 GITHUB_CLIENT_ID:gh.clientId,GITHUB_CLIENT_SECRET:gh.clientSecret,GITHUB_APP_ID:'1',GITHUB_APP_SLUG:gh.slug,
 CLOUDFLARE_CLIENT_ID:cf.clientId,CLOUDFLARE_CLIENT_SECRET:cf.clientSecret,CONNECTION_ENCRYPTION_KEYRING:gh.key};
const originalFetch=globalThis.fetch,originalEqual=crypto.subtle.timingSafeEqual;
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
let checks=0,phase='enrollment',externalCalls=0;
globalThis.fetch=async input=>{
 assert.equal(String(input),'https://challenges.cloudflare.com/turnstile/v0/siteverify','Unexpected provider/inference transport');
 externalCalls++;return Response.json({success:true,hostname:'whumpo.com',action:'register'});
};
const dispatch=(input,init,environment=env)=>worker.fetch(new Request(input,init),environment,{waitUntil:()=>{}});
const request=(userId,projectId,provider,operation)=>({userId,projectId,featureId:'connections.'+provider,operation});
const intent=s=>({version:1,requestId:id(),attemptId:s.attemptId,expectedRevision:s.expectedRevision,expectedEpoch:s.expectedEpoch});
async function refused(fn,code){await assert.rejects(fn,e=>{assert.equal(e.code,code,e.message);return true;});checks++;}
async function httpStatus(response,status){assert.equal(response.status,status,await response.clone().text());checks++;return response;}
function client(){
 const tokens=new Map();
 const browser=liveWorkspaceBrowser(base,async(input,init)=>{
  const response=await dispatch(input,init);
  // Fixture-only observation. Production responses never expose these tokens to JS.
  for(const cookie of response.headers.getSetCookie()){
   const [pair]=cookie.split(';'),at=pair.indexOf('=');tokens.set(pair.slice(0,at),pair.slice(at+1));
  }
  return response;
 });
 const api=(action,data={version:1})=>browser.json(identityPath+action,'POST',data);
 const state=async()=>(await api('state')).identity;
 async function add(){const s=await state(),key=authenticator(),o=await api('add/options',{version:1,requestId:id(),attemptId:s.attemptId,expectedRevision:s.expectedRevision,name:'Fixture passkey'});await api('add/verify',{version:1,credential:key.registration(o.options)});return key;}
 async function kit(){let s=await state();const k=await api('kit/prepare',intent(s));s=await state();await api('kit/save',{...intent(s),offerId:k.offer.id,generation:k.offer.generation,saved:true});return k;}
 return {browser,api,state,add,kit,tokens};
}
async function restricted(f,account,project,purpose){
 const s=await f.state();assert.equal(s.purpose,purpose);
 const token=f.tokens.get(identityCookies.grant);
 const principal=await m.resolveIdentity(db,{version:1,client:'web',kind:'grant',token});
 assert.equal(principal.purpose,purpose);
 assert.throws(()=>m.admitWorkspace(db,principal),e=>e.code==='identity_incomplete');checks++;
 for(const provider of ['github','cloudflare'])for(const projectId of [null,project])for(const op of inclusion.featureOperations){
  const r=request(account,projectId,provider,op);
  assert.equal((await inclusion.resolveFeatureInclusion(db,r)).included,true);
  await refused(()=>features.requireFeature(db,r),'proof_required');
 }
 for(const [path,method] of [
  ['/api/connections','GET'],['/api/github/backups','GET'],['/api/cloudflare/dns','GET'],['/api/chat','GET'],
  ...['github','cloudflare'].flatMap(p=>[
   ['/api/connections/'+p+'/start','POST'],['/api/connections/'+p+'/disconnect','POST'],
   ['/api/connections/'+p+'/callback?state=synthetic&code=synthetic','GET'],
  ]),
  ['/api/connections/github/installations','GET'],['/api/connections/cloudflare/zones','GET'],
  ['/api/github/backups/review','POST'],['/api/cloudflare/dns/review','POST'],
 ])await httpStatus(await f.browser.call(path,method),401);
 // Moving a genuine restricted grant into the session cookie cannot elevate it.
 await httpStatus(await dispatch(base+'/api/connections/github/start',{method:'POST',body:JSON.stringify({handoff:null}),headers:{'content-type':'application/json',origin:base,cookie:identityCookies.session+'='+token}}),401);
 assert.match(await backupChatCommand(db,account,project,'/github-installations',{github:gh})(),/will not be dispatched again/);checks++;
 assert.match(await dnsChatCommand(db,account,project,'/dns-zones',{config:cf})(),/will not be dispatched again/);checks++;
}
try{
 await initializeFixtureKeys(db,gh.key);
 for(const funding of ['business','business-pro','preview']){
  phase=funding+' enrollment';
  const f=client(),email=id()+'@example.invalid',code=id(),first=authenticator();
  await run("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)",await m.hashToken(code));
  const options=await f.api('signup/options',{version:1,email,inviteCode:code,usBased:true,turnstileToken:id()});
  await f.api('signup/verify',{version:1,credential:first.registration(options.options)});
  const account=(await f.state()).accountId,project=id();
  await run("INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,'Landscaping fixture',datetime('now'),datetime('now'))",project,account);
  if(funding==='preview'){
   const at=Math.floor(Date.now()/1000);
   for(const provider of ['github','cloudflare'])for(const projectId of [null,project])for(const operation of inclusion.featureOperations)
    await grants.issueFeaturePreviewGrant(db,{id:id(),...request(account,projectId,provider,operation),purpose:'private-test-acceptance',reviewReference:'https://github.com/zemdregon/whumpo/issues/65',startsAt:at-1,endsAt:at+3600},'local');
  }else await paidPlan(db,account,funding);
  await restricted(f,account,project,'enrollment');
  const second=await f.add(),kit=await f.kit(),reauth=await f.api('reauth/options');
  await f.api('reauth/verify',{version:1,credential:second.assertion(reauth.options,1)});
  let s=await f.state();await f.api('enrollment/complete',{...intent(s),offerId:kit.offer.id,generation:kit.offer.generation});
  const token=f.tokens.get(identityCookies.session),principal=await m.resolveIdentity(db,{version:1,client:'web',kind:'session',token});
  const scoped=m.admitWorkspace(db,principal);
  for(const provider of ['github','cloudflare'])for(const projectId of [null,project])for(const operation of inclusion.featureOperations){
   assert.equal((await features.requireFeature(scoped,request(account,projectId,provider,operation))).included,true);checks++;
  }
  assert.throws(()=>m.admitWorkspace(db,{...principal}),e=>e.code==='proof_required');checks++;
  assert.throws(()=>m.admitWorkspace({prepare:db.prepare.bind(db)},principal),e=>e.code==='proof_required');checks++;
  await refused(()=>features.requireFeature(scoped,request(id(),null,'github','connect')),'proof_required');
  const configured=await f.browser.json('/api/connections');
  const noConfig=await dispatch(base+'/api/connections',{headers:{cookie:identityCookies.session+'='+token}},{...env,GITHUB_CLIENT_SECRET:undefined,CLOUDFLARE_CLIENT_SECRET:undefined});
  const unconfigured=await (await httpStatus(noConfig,200)).json();
  for(const provider of ['github','cloudflare']){
   assert.equal(configured[provider].inclusion.connect,true);assert.equal(configured[provider].enabled,true);assert.equal(configured[provider].connected,false);
   assert.equal(unconfigured[provider].inclusion.connect,true);assert.equal(unconfigured[provider].enabled,false);assert.equal(unconfigured[provider].connected,false);
   const start=await f.browser.json('/api/connections/'+provider+'/start','POST',{handoff:null});
   const state=new URL(start.url).searchParams.get('state');assert.ok(state);
   await httpStatus(await f.browser.call('/api/connections/'+provider+'/callback?error=access_denied&state='+encodeURIComponent(state)),303);
  }
  phase=funding+' recovery';
  await f.api('recovery/start',{version:1,email,key:kit.key});
  await restricted(f,account,project,'recovery');
  // Starting a review is not yet account lockdown. Securing it revokes held authority.
  await features.requireFeature(scoped,request(account,null,'github','connect'));
  s=await f.state();await f.api('recovery/review',{...intent(s),mode:'all',lostIds:s.keys.map(k=>k.id)});
  const replacement=await f.kit();s=await f.state();
  await f.api('recovery/secure',{...intent(s),offerId:replacement.offer.id,generation:replacement.offer.generation,reviewId:s.recovery.review.id,confirmation:'secure-account'});
  await refused(()=>features.requireFeature(scoped,request(account,null,'github','connect')),'identity_changed');
  await httpStatus(await dispatch(base+'/api/connections',{headers:{cookie:identityCookies.session+'='+token}}),401);
  await restricted(f,account,project,'recovery');
 }
 phase='current session and commit races';
 for(const change of ['revoked','epoch','credential']){
  const actor=await workspaceFixture(db,m);await paidPlan(db,actor.account,'business');
  const held=await actor.scope(),r=request(actor.account,null,'github','connect');await features.requireFeature(held,r);
  if(change==='revoked')await actor.revoke();
  else if(change==='epoch')await run('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?',actor.account);
  else await run('DELETE FROM identity_credentials WHERE id=?',actor.credential);
  assert.equal((await inclusion.resolveFeatureInclusion(db,r)).included,true);
  await refused(()=>features.requireFeature(held,r),'identity_changed');
 }
 const aged=await workspaceFixture(db,m,undefined,-601);await paidPlan(db,aged.account,'business');
 await httpStatus(await dispatch(base+'/api/connections/github/start',{method:'POST',body:JSON.stringify({handoff:null}),headers:{'content-type':'application/json',origin:base,cookie:identityCookies.session+'='+aged.token}}),401);
 const fresh=await workspaceSession(db,m,aged);await httpStatus(await dispatch(base+'/api/connections/github/start',{method:'POST',body:JSON.stringify({handoff:null}),headers:{'content-type':'application/json',origin:base,cookie:identityCookies.session+'='+fresh.token}}),200);
 // Historical session fixture, without mutating an immutable proof/expiry record.
 const expired=m.newSessionToken(),account=await row('SELECT policy_version,auth_epoch FROM identity_accounts WHERE account_id=?',aged.account);
 await run("INSERT INTO identity_sessions VALUES(?,?,?,?,?,'web',?,'passkey',unixepoch()-3600,unixepoch()-3600,unixepoch()-1)",id(),await m.hashToken(expired),aged.account,account.policy_version,account.auth_epoch,aged.credential);
 assert.equal((await inclusion.resolveFeatureInclusion(db,request(aged.account,null,'github','connect'))).included,true);
 await refused(()=>m.resolveIdentity(db,{version:1,client:'web',kind:'session',token:expired}),'proof_required');
 await httpStatus(await dispatch(base+'/api/connections/github/start',{method:'POST',body:JSON.stringify({handoff:null}),headers:{'content-type':'application/json',origin:base,cookie:identityCookies.session+'='+expired}}),401);
 const racer=await workspaceFixture(db,m);await paidPlan(db,racer.account,'business');let intercepted=0;
 const racing=interceptDatabase(db,/INSERT INTO github_oauth_states/,async()=>{intercepted++;await racer.revoke();});
 await httpStatus(await dispatch(base+'/api/connections/github/start',{method:'POST',body:JSON.stringify({handoff:null}),headers:{'content-type':'application/json',origin:base,cookie:identityCookies.session+'='+racer.token}},{...env,DB:racing}),409);
 assert.equal(intercepted,1);assert.equal(await row('SELECT 1 FROM github_oauth_states WHERE user_id=?',racer.account),null);
 assert.equal((await row('SELECT count(*) n FROM inference_calls')).n,0);
 for(const table of ['github_token_vault','cloudflare_token_vault','identity_admission_checks'])assert.equal((await row('SELECT count(*) n FROM '+table)).n,0);
 assert.equal(externalCalls,3);assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 console.log(`Feature/identity composition passed: ${checks} checks; signed enrollment and recovery under Business, Pro and exact previews; HTTP/Chat denial, configuration distinction and atomic session loss (${process.argv.includes('--d1')?'local D1':'SQLite'}). No provider or inference calls.`);
}catch(error){console.error(`Feature/identity failed during ${phase}: `+String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await fixture.close();}
