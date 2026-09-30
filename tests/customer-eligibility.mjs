Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
import {authenticator} from './app-authenticator.mjs';
const bundle=await build({stdin:{resolveDir:process.cwd(),contents:"export {default as platform} from './src/index';export {hashToken} from './src/security';export {customerEligibilityVersion} from './src/content-policy';"},bundle:true,format:'esm',platform:'node',write:false});
const {platform,hashToken,customerEligibilityVersion}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-eligibility-');let proxy;const originalFetch=globalThis.fetch;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const env={...proxy.env,ENVIRONMENT:'test',PASSWORD_PEPPER:'synthetic-eligibility-test-pepper',TURNSTILE_SECRET:'synthetic',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
 globalThis.fetch=async url=>{assert.equal(String(url),'https://challenges.cloudflare.com/turnstile/v0/siteverify');return Response.json({success:true,hostname:'whumpo.com',action:'register'});};
 const call=(path,data,cookie='',e=env)=>platform.fetch(new Request('https://whumpo.com/api/auth/'+path,{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json',cookie},body:JSON.stringify(data)}),e,{waitUntil(){throw Error('Unexpected background work');}});
 async function input(){const inviteCode=crypto.randomUUID();await db.prepare('INSERT INTO invitations(code_hash,expires_at,created_at) VALUES(?,?,?)').bind(await hashToken(inviteCode),new Date(Date.now()+3600000).toISOString(),new Date().toISOString()).run();return {email:crypto.randomUUID()+'@example.test',password:'Synthetic-eligibility-password',inviteCode,turnstileToken:'synthetic',usBased:true};}
 async function passkeySignup(data){const options=await call('passkeys/signup/options',data);assert.equal(options.status,200,await options.clone().text());const {options:opts}=await options.json();return call('passkeys/signup/verify',{usBased:data.usBased,credential:authenticator('https://whumpo.com').registration(opts)},options.headers.get('set-cookie').split(';')[0]);}
 for(const method of ['password','passkey']){
  const data=await input(),r=method==='password'?await call('register',data):await passkeySignup(data);assert.equal(r.status,200,await r.clone().text());
  const {user}=await r.json(),receipt=await db.prepare('SELECT * FROM customer_eligibility WHERE user_id=?').bind(user.id).first();
  assert.equal(receipt.declaration_version,customerEligibilityVersion);assert.equal(receipt.country_scope,'US');assert.equal(receipt.signup_method,method);assert.ok(Number.isFinite(Date.parse(receipt.accepted_at)));
  await assert.rejects(()=>db.prepare("UPDATE customer_eligibility SET declaration_version='invented' WHERE user_id=?").bind(user.id).run());
  assert.ok(r.headers.get('set-cookie'));
 }
 // Without the declaration there is no new account or declaration record.
 const missing=await input();assert.equal((await call('register',{...missing,usBased:false})).status,403);assert.equal(await db.prepare('SELECT id FROM users WHERE email=?').bind(missing.email).first(),null);
 // Failure to record acceptance rolls back account, invitation, credentials and recovery codes.
 await db.prepare("CREATE TRIGGER synthetic_eligibility_failure BEFORE INSERT ON customer_eligibility BEGIN SELECT RAISE(ABORT,'synthetic_receipt_failure'); END").run();
 for(const method of ['password','passkey']){
  const data=await input(),r=method==='password'?await call('register',data):await passkeySignup(data);assert.ok(r.status>=400);assert.equal(r.headers.get('set-cookie'),null);
  assert.equal(await db.prepare('SELECT id FROM users WHERE email=?').bind(data.email).first(),null);
  assert.equal((await db.prepare('SELECT used_by FROM invitations WHERE code_hash=?').bind(await hashToken(data.inviteCode)).first()).used_by,null);
 }
 await db.prepare('DROP TRIGGER synthetic_eligibility_failure').run();
 // Local exemption is not fabricated as an accepted declaration.
 const local=await call('register',{email:crypto.randomUUID()+'@example.test',password:'Synthetic-local-password'},'',{...env,ENVIRONMENT:'local'});assert.equal(local.status,200);const {user:localUser}=await local.json();assert.equal(await db.prepare('SELECT user_id FROM customer_eligibility WHERE user_id=?').bind(localUser.id).first(),null);
 assert.equal((await db.prepare('SELECT count(*) n FROM customer_eligibility').first()).n,2);
 console.log('Eligibility receipts passed: password and independently signed passkey signup, version/time/method recording, immutable receipt, atomic rollback with unused invitation, missing declaration rejection, and truthful local exemption.');
}finally{globalThis.fetch=originalFetch;await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
