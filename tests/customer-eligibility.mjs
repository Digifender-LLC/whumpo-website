import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
const {worker,hashToken,customerEligibilityVersion,identityCookies}=await currentSiteFixtureHandlers();
const store=await databaseFixture({d1:true}),db=store.db,originalFetch=globalThis.fetch;
const id=()=>crypto.randomUUID(),row=(sql,...args)=>db.prepare(sql).bind(...args).first();
let hostname='whumpo.com',verifications=0;
const env={DB:db,ENVIRONMENT:'test',TURNSTILE_SECRET:'synthetic',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
const origin=mode=>mode==='local'?'http://localhost:8787':'https://whumpo.com';
function cookies(response){return new Map(response.headers.getSetCookie().map(cookie=>cookie.split(';')[0].split('=')));}
const call=(mode,path,data,cookie='')=>worker.fetch(new Request(origin(mode)+'/api/auth/identity/v1/'+path,{method:'POST',headers:{origin:origin(mode),'content-type':'application/json',cookie},body:JSON.stringify(data)}),{...env,ENVIRONMENT:mode},{waitUntil(){throw Error('Unexpected background work');}});
async function input(){const inviteCode=id();await db.prepare("INSERT INTO invitations(code_hash,expires_at,created_at) VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(await hashToken(inviteCode)).run();return {version:1,email:id()+'@example.test',inviteCode,turnstileToken:'synthetic',usBased:true};}
async function prepare(mode,data){
 hostname=new URL(origin(mode)).hostname;
 const response=await call(mode,'signup/options',data);assert.equal(response.status,200,await response.clone().text());
 const options=(await response.json()).options,key=authenticator(origin(mode)),challenge=cookies(response).get(identityCookies.challenge);assert.ok(challenge);
 assert.equal(await row('SELECT id FROM users WHERE email=?',data.email),null,'Options cannot create an account or eligibility receipt');
 const body={version:1,credential:key.registration(options)},cookie=identityCookies.challenge+'='+challenge;
 return {key,body,cookie,verify:()=>call(mode,'signup/verify',body,cookie)};
}
try{
 globalThis.fetch=async url=>{assert.equal(String(url),'https://challenges.cloudflare.com/turnstile/v0/siteverify');verifications++;return Response.json({success:true,hostname,action:'register'});};
 const failed=[];
 for(const mode of ['test','local']){
  const data=await input(),proof=await prepare(mode,data),response=await proof.verify();assert.equal(response.status,200,await response.clone().text());
  const user=await row('SELECT id FROM users WHERE email=?',data.email),receipt=await row('SELECT * FROM customer_eligibility WHERE user_id=?',user.id);
  assert.equal(receipt.declaration_version,customerEligibilityVersion);assert.equal(receipt.country_scope,'US');assert.equal(receipt.signup_method,'passkey');assert.ok(Number.isFinite(Date.parse(receipt.accepted_at)));
  await assert.rejects(db.prepare("UPDATE customer_eligibility SET declaration_version='invented' WHERE user_id=?").bind(user.id).run(),/customer_eligibility_immutable/);
  assert.equal((await row('SELECT stage FROM identity_accounts WHERE account_id=?',user.id)).stage,'enrolling');
  assert.equal((await row('SELECT status FROM identity_credentials WHERE id=?',proof.key.id)).status,'staged');
  const granted=cookies(response);assert.ok(granted.get(identityCookies.grant));assert.ok(!granted.get(identityCookies.session));
  const workspace=await worker.fetch(new Request(origin(mode)+'/api/profile',{headers:{cookie:identityCookies.grant+'='+granted.get(identityCookies.grant)}}),{...env,ENVIRONMENT:mode},{waitUntil(){}});assert.equal(workspace.status,401,'A declaration and one key cannot grant workspace access');
  // No declaration, invitation or Turnstile exemptions in either environment.
  const missing=await input(),before=verifications;
  for(const usBased of [false,null,'true'])assert.equal((await call(mode,'signup/options',{...missing,usBased})).status,403);
  const {usBased,...absent}=missing;assert.equal((await call(mode,'signup/options',absent)).status,400);assert.equal(verifications,before);
  assert.equal(await row('SELECT id FROM users WHERE email=?',missing.email),null);
  assert.equal((await call(mode,'signup/options',{...missing,inviteCode:''})).status,401);
  assert.equal((await call(mode,'signup/options',{...missing,turnstileToken:''})).status,400);
  assert.equal((await row('SELECT used_at FROM invitations WHERE code_hash=?',await hashToken(missing.inviteCode))).used_at,null);
  // A failed receipt aborts the complete account/key/attempt/grant transaction.
  await db.prepare("CREATE TRIGGER synthetic_eligibility_failure BEFORE INSERT ON customer_eligibility BEGIN SELECT RAISE(ABORT,'synthetic_receipt_failure'); END").run();
  const rejectedData=await input(),rejected=await prepare(mode,rejectedData),failure=await rejected.verify();assert.equal(failure.status,503);
  const failureCookies=cookies(failure);assert.ok(!failureCookies.get(identityCookies.session));assert.ok(!failureCookies.get(identityCookies.grant));
  assert.equal(await row('SELECT id FROM users WHERE email=?',rejectedData.email),null);assert.equal(await row('SELECT id FROM identity_credentials WHERE id=?',rejected.key.id),null);
  const invite=await row('SELECT used_by,used_at FROM invitations WHERE code_hash=?',await hashToken(rejectedData.inviteCode));assert.deepEqual(invite,{used_by:null,used_at:null});
  assert.equal((await rejected.verify()).status,401,'The failed verification consumes its challenge');
  await db.prepare('DROP TRIGGER synthetic_eligibility_failure').run();failed.push({mode,data:rejectedData});
 }
 assert.equal((await row('SELECT count(*) n FROM customer_eligibility')).n,2);
 for(const {mode,data} of failed){const fresh=await prepare(mode,data);assert.equal((await fresh.verify()).status,200,'An unused invitation works with a fresh ceremony after repair');}
 for(const table of ['users','identity_accounts','identity_credentials','identity_attempts','identity_grants','identity_ceremony_receipts','customer_eligibility'])assert.equal((await row('SELECT count(*) n FROM '+table)).n,4,table+' has no partial failed signup rows');
 assert.equal((await row('SELECT count(*) n FROM identity_sessions')).n,0);
 console.log('Current eligibility passed: real ES256 credential registration, immutable US/version/method/time receipt, required declaration/invitation/Turnstile in test and local, enrollment-only grant, atomic receipt-failure rollback, consumed challenge and fresh retry. Turnstile is synthetic; no provider or physical-device acceptance.');
}finally{globalThis.fetch=originalFetch;await store.close();}
