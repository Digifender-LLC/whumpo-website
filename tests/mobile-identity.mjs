import assert from 'node:assert/strict';
import {createHash,timingSafeEqual} from 'node:crypto';
import {build} from 'esbuild';
import {databaseFixture as mobileDatabase} from './helpers/current-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
import {admitClient,operations} from '../tools/prototypes/mobile-v1.mjs';
const built=await build({stdin:{contents:"export {default as worker} from './src/index';export * from './src/workspace-identity/ceremonies';export * from './src/workspace-identity/authority';export * from './src/workspace-identity/kits';export {hashToken} from './src/security';export {cleanMobileHandoffs} from './src/mobile/handoff';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const fixture=await mobileDatabase(),baseDB=fixture.db;let hook=null,cases=0,phase='admission';
const db={prepare:q=>baseDB.prepare(q),batch:async statements=>{const before=hook;hook=null;if(before)await before();return baseDB.batch(statements);}};
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),row=(sql,...v)=>db.prepare(sql).bind(...v).first();
const originalFetch=globalThis.fetch,originalEqual=crypto.subtle.timingSafeEqual;
globalThis.fetch=async()=>Response.json({success:true,hostname:'whumpo.com',action:'register'});
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
let limited=false;
const env={DB:db,ENVIRONMENT:'test',TURNSTILE_SECRET:'synthetic-only',TURNSTILE_SITE_KEY:'synthetic-public',MOBILE_ANDROID_PACKAGE:'com.whumpo.fixture',MOBILE_ANDROID_CERT_SHA256:Array(32).fill('A1').join(':'),MOBILE_MINIMUM_BUILD:'2',API_LIMITER:{limit:async()=>({success:!limited})},AUTH_LIMITER:{limit:async()=>({success:!limited})}};
const signingOrigin='android:apk-key-hash:'+Buffer.alloc(32,0xa1).toString('base64url');
const client={contract:1,build:4,platform:'android',controls:[],interaction:{versions:[1],fieldTypes:[],bindings:[]}};
const request=()=>new Request('https://whumpo.com/api/auth/identity/v1/test',{method:'POST',headers:{origin:'https://whumpo.com'}});
const counters=new Map();
const assertion=(key,options,overrides={})=>{const count=(counters.get(key.id)??0)+1;counters.set(key.id,count);return key.assertion(options,count,overrides);};
async function call(path,body,token,extra={},environment=env){
 const response=await m.worker.fetch(new Request('https://whumpo.com/api/mobile/v1'+path,{method:body===undefined?'GET':'POST',headers:{'whumpo-client':JSON.stringify(client),...(body===undefined?{}:{'content-type':'application/json'}),...(token?{authorization:'Bearer '+token}:{}),...extra.headers},...(body===undefined?{}:{body:JSON.stringify(body)}),...Object.fromEntries(Object.entries(extra).filter(([k])=>k!=='headers'))}),environment,{waitUntil:()=>{}});
 const data=await response.json();assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(response.headers.get('set-cookie'),null);
 assert(!/"(?:token_hash|public_key|authorityId|auth_epoch|email|codeVerifier|principal)"/.test(JSON.stringify(data)));
 return {status:response.status,data,response};
}
async function ok(path,body,token,extra,environment){const r=await call(path,body,token,extra,environment);assert.equal(r.status,200,`${phase} ${path}: ${JSON.stringify(r.data)}`);return r.data;}
async function no(path,body,status,code,token,extra,environment){const r=await call(path,body,token,extra,environment);assert.equal(r.status,status,`${phase} ${path}: ${JSON.stringify(r.data)}`);assert.equal(r.data.error.code,code);cases++;return r.data;}
const resolve=(access,client='web')=>m.resolveIdentity(db,{version:1,client,kind:access.kind??'session',token:access.token});
async function enroll(complete=true){
 const email=id()+'@example.invalid',invite=id(),key=authenticator();
 await run("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)",await m.hashToken(invite));
 const start=await m.signupOptions(request(),env,{version:1,email,inviteCode:invite,usBased:true,turnstileToken:'synthetic'});
 let access=await m.signupVerify(request(),env,start.challengeToken,{version:1,credential:key.registration(start.options)});
 const account=access.principal.accountId;if(!complete)return {key,access,account,email};
 let p=await resolve(access);const second=authenticator(),options=await m.addPasskeyOptions(request(),env,p,{version:1,requestId:id(),attemptId:p.attempt.id,expectedRevision:p.attempt.revision,name:'Second'});
 await m.addPasskeyVerify(request(),env,p,options.challengeToken,{version:1,credential:second.registration(options.options)});
 p=await resolve(access);const intent=p=>({version:1,requestId:id(),attemptId:p.attempt?.id??null,expectedRevision:p.attempt?.revision??p.credentialRevision,expectedEpoch:p.authEpoch});
 const kit=await m.prepareKit(request(),env,p,intent(p));p=await resolve(access);
 await m.acknowledgeKit(request(),env,p,{...intent(p),offerId:kit.offer.id,generation:kit.offer.generation,saved:true});p=await resolve(access);
 const reauth=await m.reauthenticationOptions(request(),env,p,{version:1});access=await m.reauthenticationVerify(request(),env,p,reauth.challengeToken,{version:1,credential:assertion(second,reauth.options)});p=await resolve(access);
 access=(await m.completeEnrollment(request(),env,p,{...intent(p),offerId:kit.offer.id,generation:kit.offer.generation})).authority;
 return {key,second,access,account,email,kit};
}
async function nativeLogin(f,overrides={}){const start=await ok('/session/login/options',{version:1});return {start,body:{version:1,challengeId:start.challengeId,credential:assertion(f.key,start.options,{atOrigin:signingOrigin,...overrides})}};}
async function native(f){const {body}=await nativeLogin(f);return (await ok('/session/login/verify',body)).session;}
async function browser(path,f,body,extra={}){
 const response=await m.worker.fetch(new Request('https://whumpo.com'+path,{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json',cookie:'__Host-whumpo_session='+f.access.token,...extra},body:JSON.stringify(body)}),env,{waitUntil:()=>{}});
 return {status:response.status,data:await response.json()};
}
async function handoff(f,{complete=true}={}){
 const verifier=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),state=Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
 const input={version:1,purpose:'signin',state,codeChallenge:createHash('sha256').update(verifier).digest('base64url'),codeChallengeMethod:'S256',redirectUri:'https://whumpo.com/app/return'};
 const started=await ok('/session/handoff/start',input),browserToken=started.browserPath.split('/').at(-1);
 const read=await browser('/api/mobile-handoff/v1/read',f,{version:1,browserToken});assert.equal(read.status,200);assert.equal(read.data.account.label,f.email.slice(0,1)+'***@example.invalid');
 if(!complete)return {started,browserToken,state,verifier};
 const completed=await browser('/api/mobile-handoff/v1/complete',f,{version:1,browserToken});assert.equal(completed.status,200);
 const returned=new URL(completed.data.returnUrl);assert.equal(returned.origin+returned.pathname,'https://whumpo.com/app/return');assert.deepEqual([...returned.searchParams.keys()],['handoffId','code']);
 return {started,browserToken,state,verifier,exchange:{version:1,handoffId:started.handoffId,code:returned.searchParams.get('code'),state,codeVerifier:verifier}};
}
async function replaceImmutable(table,key,value,changes){const saved=await row(`DELETE FROM ${table} WHERE ${key}=? RETURNING *`,value);assert(saved);const next={...saved,...changes};await run(`INSERT INTO ${table}(${Object.keys(next).join(',')}) VALUES(${Object.keys(next).map(()=>'?').join(',')})`,...Object.values(next));}
try{
 admitClient(client,{minimumBuild:4});
 assert.equal((await ok('/config')).minimumBuild,4); // Even a stale MOBILE_MINIMUM_BUILD=2 cannot re-enable retired builds.
 assert.equal((await ok('/config',undefined,undefined,{}, {...env,MOBILE_MINIMUM_BUILD:undefined})).minimumBuild,4);
 assert.equal((await ok('/config',undefined,undefined,{}, {...env,MOBILE_MINIMUM_BUILD:'5'})).minimumBuild,5);
 await no('/session/login/options',{version:1},426,'client_update_required',undefined,{headers:{'whumpo-client':JSON.stringify({...client,build:3})}});
 await ok('/config',undefined,undefined,{headers:{'whumpo-client':JSON.stringify({...client,build:1})}});
 await no('/session/login/options',{version:1},426,'client_update_required',undefined,{headers:{'whumpo-client':JSON.stringify({...client,build:1})}});
 for(const header of [{...client,contract:0},{...client,platform:'ios'},{...client,controls:['unknown']},{...client,interaction:{...client.interaction,versions:[2]}}])await no('/config',undefined,426,'client_update_required',undefined,{headers:{'whumpo-client':JSON.stringify(header)}});
 for(const header of [{...client,extra:true},{...client,controls:['site.confirm','site.confirm']}])await no('/config',undefined,400,Object.hasOwn(header,'extra')?'unknown_field':'invalid_request',undefined,{headers:{'whumpo-client':JSON.stringify(header)}});
 for(const headers of [{cookie:''},{origin:'https://whumpo.com'},{authorization:'Bearer '+'f'.repeat(64)},{'whumpo-client':'bad'}])await no('/config',undefined,400,'invalid_request',undefined,{headers});
 await no('/config?x=1',undefined,400,'invalid_request');await no('/unknown',{version:1},404,'not_found');await no('/session/login/options',{version:0},426,'client_update_required');
 await no('/session/login/options',{version:1,unknown:1},400,'unknown_field');await no('/session/login/options',{},400,'missing_field');
 await no('/session/login/options',{version:1,padding:'x'.repeat(17000)},413,'payload_too_large');
 await no('/session/login/options',{version:1},503,'unavailable',undefined,undefined,{...env,MOBILE_ANDROID_CERT_SHA256:undefined});
 limited=true;await no('/config',undefined,429,'rate_limited');limited=false;
 const asset=await m.worker.fetch(new Request('https://whumpo.com/.well-known/assetlinks.json'),env,{});assert.equal(asset.status,200);assert.equal((await asset.json())[0].target.package_name,env.MOBILE_ANDROID_PACKAGE);
 assert.equal((await m.worker.fetch(new Request('https://whumpo.com/.well-known/assetlinks.json'),{...env,MOBILE_ANDROID_PACKAGE:undefined},{})).status,404);
 phase='real passkeys';const a=await enroll(),b=await enroll(),enrolling=await enroll(false);
 const incomplete=await nativeLogin(enrolling);await no('/session/login/verify',incomplete.body,403,'identity_incomplete');
 assert.equal((await row("SELECT count(*) n FROM identity_sessions WHERE account_id=? AND client='android'",enrolling.account)).n,0);
 for(const bad of [{atOrigin:'https://whumpo.com'},{atOrigin:'android:apk-key-hash:'+Buffer.alloc(32,0xb2).toString('base64url')},{rpID:'wrong.invalid'},{uv:false},{badSignature:true},{crossOrigin:true},{handle:Buffer.from(b.account).toString('base64url')}]){
  const f=await nativeLogin(a,bad);await no('/session/login/verify',f.body,401,'proof_required');await no('/session/login/verify',f.body,401,'proof_required');
 }
 const good=await nativeLogin(a),access=(await ok('/session/login/verify',good.body)).session;
 await no('/session/login/verify',good.body,401,'proof_required');
 const session=await ok('/session',undefined,access.token);assert.equal(session.account.id,a.account);assert(!JSON.stringify(session).includes(a.email));
 const sessionOp=operations.find(op=>op.id==='session.read');sessionOp.response(session,'session');
 await no('/session',undefined,401,'proof_required',a.access.token);await no('/session',undefined,401,'proof_required');
 const cookieMobile=await m.worker.fetch(new Request('https://whumpo.com/api/profile',{headers:{cookie:'__Host-whumpo_session='+access.token}}),env,{});assert.equal(cookieMobile.status,401);
 for(const path of ['/api/profile','/api/auth/identity/v1/state','/workspace','/contact/'+id()])assert.equal((await m.worker.fetch(new Request('https://whumpo.com'+path,{headers:{authorization:'Bearer '+access.token}}),env,{})).status,400);
 const originDenied=await browser('/api/profile',a,{name:'changed'},{origin:'https://elsewhere.invalid'});assert.equal(originDenied.status,403);
 const webOrigin=await browser('/api/auth/identity/v1/state',a,{version:1},{origin:'https://elsewhere.invalid'});assert.equal(webOrigin.status,400);
 const invalid=await nativeLogin(a);await no('/session/login/verify',{...invalid.body,extra:true},400,'unknown_field');await no('/session/login/verify',invalid.body,401,'proof_required');
 const oversized=await nativeLogin(a);await no('/session/login/verify',{...oversized.body,credential:{...oversized.body.credential,padding:'x'.repeat(8500)}},413,'payload_too_large');await no('/session/login/verify',oversized.body,401,'proof_required');
 const expiry=await nativeLogin(a),now=(await row('SELECT unixepoch() now')).now;
 await replaceImmutable('identity_challenges','id',expiry.start.challengeId,{created_at:now-300,expires_at:now});await no('/session/login/verify',expiry.body,401,'proof_required');
 phase='reauth';
 const before=await row('SELECT * FROM identity_sessions WHERE token_hash=?',await m.hashToken(access.token));
 const opts=await ok('/session/reauth/options',{version:1},access.token);
 const reauth=await ok('/session/reauth/verify',{version:1,challengeId:opts.challengeId,credential:assertion(a.second,opts.options,{atOrigin:signingOrigin})},access.token);
 assert.equal(reauth.session.expiresAt,access.expiresAt);assert(!Object.hasOwn(reauth.session,'token'));
 const after=await row('SELECT * FROM identity_sessions WHERE token_hash=?',await m.hashToken(access.token));assert.equal(after.expires_at,before.expires_at);assert.notEqual(after.id,before.id);assert.equal(after.credential_id,a.second.id);
 const mismatch=await ok('/session/reauth/options',{version:1},access.token);
 await no('/session/reauth/verify',{version:1,challengeId:mismatch.challengeId,credential:assertion(b.key,mismatch.options,{atOrigin:signingOrigin})},401,'proof_required',access.token);
 phase='handoff';
 const flow=await handoff(a);
 for(const override of [{state:'wrongstate'.repeat(3)},{codeVerifier:'x'.repeat(43)},{code:'f'.repeat(64)},{handoffId:id()}])await no('/session/handoff/exchange',{...flow.exchange,...override},401,'proof_required');
 const exchanged=(await ok('/session/handoff/exchange',flow.exchange)).session;
 assert.equal((await ok('/session',undefined,exchanged.token)).account.id,a.account);
 const webP=await resolve(a.access),mobileP=await resolve(exchanged,'android');assert.equal(mobileP.proof.verifiedAt,webP.proof.verifiedAt);assert.equal(mobileP.expiresAt,webP.expiresAt);
 await no('/session/handoff/exchange',flow.exchange,401,'proof_required');
 const raw=await row('SELECT * FROM mobile_identity_handoffs WHERE id=?',flow.started.handoffId),stored=JSON.stringify(raw);
 for(const secret of [flow.browserToken,flow.state,flow.verifier,flow.exchange.code,exchanged.token])assert(!stored.includes(secret));
 const accountSwitch=await handoff(a,{complete:false});assert.equal((await browser('/api/mobile-handoff/v1/complete',b,{version:1,browserToken:accountSwitch.browserToken})).status,401);
 assert.equal((await browser('/api/mobile-handoff/v1/read',b,{version:1,browserToken:accountSwitch.browserToken})).status,401);
 for(const origin of ['', 'https://wrong.invalid'])assert.equal((await browser('/api/mobile-handoff/v1/complete',a,{version:1,browserToken:accountSwitch.browserToken},{origin})).status,400);
 const incompleteStart=await ok('/session/handoff/start',{version:1,purpose:'signup',state:'a'.repeat(24),codeChallenge:'b'.repeat(43),codeChallengeMethod:'S256',redirectUri:'https://whumpo.com/app/return'});
 const incompleteRead=await browser('/api/mobile-handoff/v1/read',enrolling,{version:1,browserToken:incompleteStart.browserPath.split('/').at(-1)});assert.equal(incompleteRead.status,401);
 for(const redirectUri of ['https://evil.invalid/app/return','https://whumpo.com/app/return?x=1','whumpo://return','https://whumpo.com:443/app/return'])await no('/session/handoff/start',{version:1,purpose:'signin',state:'a'.repeat(24),codeChallenge:'b'.repeat(43),codeChallengeMethod:'S256',redirectUri},400,'invalid_request');
 const expired=await handoff(a),at=(await row('SELECT unixepoch() now')).now;
 await replaceImmutable('mobile_identity_handoffs','id',expired.started.handoffId,{created_at:at-300,expires_at:at,code_expires_at:at});await no('/session/handoff/exchange',expired.exchange,401,'proof_required');
 // An old browser proof remains old after exchange and cannot authorize a fresh-passkey action.
 const old=await enroll(),oldRow=await row('SELECT * FROM identity_sessions WHERE id=?',old.access.principal.authorityId),clock=(await row('SELECT unixepoch() now')).now;
 await replaceImmutable('identity_sessions','id',oldRow.id,{proof_at:clock-601,issued_at:clock-600,expires_at:clock+3600});
 const oldFlow=await handoff(old),oldMobile=(await ok('/session/handoff/exchange',oldFlow.exchange)).session,oldP=await resolve(oldMobile,'android');
 assert.equal(oldP.proof.verifiedAt,clock-601);await assert.rejects(()=>m.assertCurrentIdentity(db,oldP,{purpose:'workspace',freshPasskey:true,bindIdentityRevision:true}),e=>e.code==='proof_required');cases++;
 phase='atomic races';
 const raced=await enroll(),racedLogin=await nativeLogin(raced);hook=()=>run('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?',raced.account);await no('/session/login/verify',racedLogin.body,409,'identity_changed');
 assert.equal((await row("SELECT count(*) n FROM identity_sessions WHERE account_id=? AND client='android'",raced.account)).n,0);
 const removed=await enroll(),removedLogin=await nativeLogin(removed);hook=()=>run('DELETE FROM identity_credentials WHERE id=?',removed.key.id);await no('/session/login/verify',removedLogin.body,409,'identity_changed');
 const revoked=await enroll(),revokedFlow=await handoff(revoked);hook=()=>run('DELETE FROM identity_sessions WHERE id=?',revoked.access.principal.authorityId);await no('/session/handoff/exchange',revokedFlow.exchange,401,'proof_required');
 const epoch=await enroll(),epochFlow=await handoff(epoch);hook=()=>run('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?',epoch.account);await no('/session/handoff/exchange',epochFlow.exchange,401,'proof_required');
 const recovery=await enroll(),recoverySession=await native(recovery),attempt=id();
 await run("INSERT INTO identity_attempts VALUES(?,?,'recovery','secured',1,2,1,unixepoch())",attempt,recovery.account);
 await run("UPDATE identity_accounts SET stage='recovering',auth_epoch=2,current_attempt_id=? WHERE account_id=?",attempt,recovery.account);
 await no('/session',undefined,401,'proof_required',recoverySession.token);const recoveryLogin=await nativeLogin(recovery);await no('/session/login/verify',recoveryLogin.body,403,'identity_incomplete');
 const deletion=await enroll(),deletionSession=await native(deletion);await run('DELETE FROM identity_credentials WHERE id=?',deletion.key.id);await no('/session',undefined,401,'proof_required',deletionSession.token);
 // Deleting an account removes both authority and its pending browser return.
 const closed=await enroll(),closedSession=await native(closed),closedFlow=await handoff(closed);await run('DELETE FROM users WHERE id=?',closed.account);await no('/session',undefined,401,'proof_required',closedSession.token);await no('/session/handoff/exchange',closedFlow.exchange,401,'proof_required');
 const concurrent=await handoff(a),race=await Promise.all([call('/session/handoff/exchange',concurrent.exchange),call('/session/handoff/exchange',concurrent.exchange)]);assert.deepEqual(race.map(r=>r.status).sort(),[200,401]);cases++;
 await m.cleanMobileHandoffs(db);assert.equal(await row('SELECT id FROM mobile_identity_handoffs WHERE id=?',expired.started.handoffId),null);
 phase='logout';await ok('/session/logout',{version:1},access.token);await no('/session',undefined,401,'proof_required',access.token);assert.equal((await resolve(a.access)).accountId,a.account);
 assert.equal((await row("SELECT count(*) n FROM identity_sessions WHERE account_id=? AND client='android'",enrolling.account)).n,0);
 console.log(`mobile-identity: ${cases} refusal/race assertions plus signed Android passkeys, shared web authority, stable-token reauth/absolute expiry, two-owner PKCE returns, stale proof, cookie/Origin isolation and revocation passed (${process.argv.includes('--d1')?'D1':'SQLite'}).`);
}catch(error){console.error('mobile-identity phase:',phase);throw error;}
finally{globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await fixture.close();}
