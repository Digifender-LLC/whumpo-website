import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {identityDatabase} from './helpers/identity-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';

// Schema batch 3d (WH-083 native identity schema): android sessions, android challenges, handoffs, the per-client resolver, the exact-origin
// assertion check and revocation reach, over the isolated identity schema on disposable SQLite and, with --d1, actual local D1. Synthetic rows only.
const built=await build({stdin:{contents:"export * from './src/workspace-identity/ceremonies';export * from './src/workspace-identity/authority';export {hashToken} from './src/security';export {androidPasskeyOrigins} from './src/android-signing';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {saveIdentityChallenge,consumeIdentityChallenge,verifyIdentityAssertion,cleanIdentityCeremonies,resolveIdentity,assertCurrentIdentity,hashToken,androidPasskeyOrigins}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const fixture=await identityDatabase(),db=fixture.db,env={DB:db};
const run=(sql,...v)=>db.prepare(sql).bind(...v).run(),row=(sql,...v)=>db.prepare(sql).bind(...v).first(),id=()=>crypto.randomUUID();
const webRp={origin:'https://whumpo.com',rpID:'whumpo.com'},androidOrigin=androidPasskeyOrigins[0],androidRp={origin:androidOrigin,rpID:'whumpo.com'};
const hex=n=>'abcdef0123456789'.repeat(8).slice(0,n);let counterSeed=0;const uniqueHex=()=>(++counterSeed).toString(16).padStart(64,'0');
let cases=0;
const rejects=async(name,fn,pattern=/./)=>{await assert.rejects(fn,pattern,name);cases++;};
const ok=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const now=Math.floor(Date.now()/1000);
const credentialDenied=code=>e=>e.code===code||/proof_required/.test(e.message)&&code==='proof_required';
async function account(){
 const a=id(),key=authenticator();
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-30T00:00:00.000Z')",a,a+'@example.invalid');
 await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,current_attempt_id,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,NULL,1,?,?)",a,'a'.repeat(64),id());
 await run("INSERT INTO identity_credentials(id,account_id,public_key,counter,name,status,attempt_id,created_at) VALUES(?,?,?,0,'Synthetic','active',NULL,?)",key.id,a,key.publicKey,now-100);
 return {a,key};
}
async function session(acct,{client='web',method='passkey',proofAt=now-5}={}){
 const token=uniqueHex(),sid=id();
 await run("INSERT INTO identity_sessions(id,token_hash,account_id,policy_version,auth_epoch,client,credential_id,proof_method,proof_at,issued_at,expires_at) VALUES(?,?,?,1,1,?,?,?,?,?,?)",sid,await hashToken(token),acct.a,client,acct.key.id,method,proofAt,proofAt,proofAt+3600);
 return {sid,token};
}
const handoff=(o={})=>({id:id(),browser_token_hash:uniqueHex(),purpose:'signin',state:'s'.repeat(32),code_challenge:'c'.repeat(43),redirect_uri:'https://whumpo.com/app/return',created_at:now,expires_at:now+300,
 account_id:null,source_session_id:null,auth_epoch:null,code_hash:null,code_issued_at:null,code_expires_at:null,native_session_id:null,...o});
async function insertHandoff(o){const h=handoff(o),keys=Object.keys(h);await run(`INSERT INTO identity_handoffs(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,...keys.map(k=>h[k]));return h;}
const bound=(acct,source)=>({account_id:acct.a,source_session_id:source,auth_epoch:1,code_hash:uniqueHex(),code_issued_at:now,code_expires_at:now+60});
const count=async(sql,...v)=>(await row(`SELECT count(*) n FROM ${sql}`,...v)).n;
const challenge=(o={})=>{const c={id:id(),token_hash:uniqueHex(),challenge:'x'.repeat(43),kind:'login',client:'web',origin:'https://whumpo.com',rp_id:'whumpo.com',account_id:null,request_id:id(),request_hash:hex(64),...o};return c;};
async function insertChallenge(o){const c=challenge(o);await run("INSERT INTO identity_challenges(id,token_hash,challenge,kind,policy_version,client,origin,rp_id,account_id,email,invite_hash,eligibility_version,authority_id,authority_kind,auth_epoch,credential_revision,attempt_id,attempt_revision,request_id,request_hash,credential_name,created_at,expires_at) VALUES(?,?,?,?,1,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)",
 c.id,c.token_hash,c.challenge,c.kind,c.client,c.origin,c.rp_id,c.account_id,c.email??null,c.invite_hash??null,c.eligibility_version??null,c.authority_id??null,c.authority_kind??null,c.auth_epoch??null,c.credential_revision??null,c.attempt_id??null,c.attempt_revision??null,c.request_id,c.request_hash,now,now+300);return c;}
async function loginChallenge(rp,client){
 const challenge=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url'),saved=await saveIdentityChallenge(db,rp,'login',challenge,{requestId:id(),requestHash:hex(64)},client);
 return {challenge,token:saved.challengeToken};
}
try{
 const acct=await account();

 // --- sessions ---
 await ok('android and web sessions with passkey and handoff proof are admitted; native handoff sessions are android only',async()=>{
  await session(acct,{client:'web'});await session(acct,{client:'android'});await session(acct,{client:'android',method:'handoff'});
 });
 await rejects('unknown client',()=>session(acct,{client:'ios'}),/CHECK/);
 await rejects('unknown proof method',()=>session(acct,{client:'android',method:'recovery-key'}),/CHECK/);
 await rejects('web session with handoff proof',()=>session(acct,{client:'web',method:'handoff'}),/CHECK/);
 await rejects('grants stay web-only: no native grant',()=>run("INSERT INTO identity_grants(id,token_hash,account_id,policy_version,auth_epoch,client,purpose,attempt_id,proof_method,proof_at,proof_revision,credential_id,kit_generation,issued_at,expires_at) VALUES(?,?,?,1,1,'android','recovery',?,'passkey',?,0,?,NULL,?,?)",id(),uniqueHex(),acct.a,id(),now,acct.key.id,now,now+60),/CHECK/);

 // --- challenges ---
 await ok('web challenge with either web origin and android challenge with an apk-key-hash origin',async()=>{
  await insertChallenge({});await insertChallenge({origin:'http://localhost:8787',rp_id:'localhost'});
  await insertChallenge({client:'android',origin:androidOrigin});
  await insertChallenge({client:'android',origin:androidOrigin,kind:'reauth',account_id:acct.a,authority_id:id(),authority_kind:'session',auth_epoch:1,credential_revision:0});
 });
 for(const [name,o] of [
  ['unknown client',{client:'ios'}],
  ['web challenge with the android origin',{origin:androidOrigin}],
  ['web challenge with a foreign origin',{origin:'https://attacker.invalid',rp_id:'attacker.invalid'}],
  ['web origin with the wrong rp',{rp_id:'localhost'}],
  ['android challenge with the web origin',{client:'android'}],
  ['android challenge with a foreign origin',{client:'android',origin:'https://attacker.invalid'}],
  ['android origin over 120 characters',{client:'android',origin:'android:apk-key-hash:'+'A'.repeat(100)}],
  ['android challenge with a localhost rp',{client:'android',origin:androidOrigin,rp_id:'localhost'}],
  ['android signup kind',{client:'android',origin:androidOrigin,kind:'signup',account_id:acct.a,email:'a@example.invalid',invite_hash:hex(64),eligibility_version:'v'}],
  ['android add kind',{client:'android',origin:androidOrigin,kind:'add',account_id:acct.a,authority_id:id(),authority_kind:'session',auth_epoch:1,credential_revision:0}],
  ['android recovery_complete kind',{client:'android',origin:androidOrigin,kind:'recovery_complete',account_id:acct.a,authority_id:id(),authority_kind:'session',auth_epoch:1,credential_revision:0}]
 ])await rejects(name,()=>insertChallenge(o),/CHECK/);

 // --- handoffs ---
 const source=await session(acct,{client:'web'});
 await ok('an unbound handoff, then code issued, then consumed',async()=>{
  const h=await insertHandoff({});
  await run('UPDATE identity_handoffs SET account_id=?,source_session_id=?,auth_epoch=1,code_hash=?,code_issued_at=?,code_expires_at=? WHERE id=?',acct.a,source.sid,uniqueHex(),now,now+60,h.id);
  await run('UPDATE identity_handoffs SET native_session_id=? WHERE id=?',id(),h.id);
 });
 for(const [name,o] of [
  ['bad purpose',{purpose:'login'}],['state under 16',{state:'s'.repeat(15)}],['state over 128',{state:'s'.repeat(129)}],['state with a bad character',{state:'s'.repeat(15)+'!'}],
  ['challenge 42 characters',{code_challenge:'c'.repeat(42)}],['challenge with a bad character',{code_challenge:'c'.repeat(42)+'+'}],
  ['other redirect',{redirect_uri:'https://whumpo.com/app/return?x=1'}],['custom scheme redirect',{redirect_uri:'whumpo://return'}],
  ['five minutes and a second',{expires_at:now+301}],['expiry not after creation',{expires_at:now}],['browser token hash not hex',{browser_token_hash:'g'.repeat(64)}],
  ['native session on an unbound handoff',{native_session_id:id()}],['half-set completion',{account_id:acct.a}],['code without account',{code_hash:uniqueHex()}],
  ['code lasting 61 seconds',{...bound(acct,source.sid),code_expires_at:now+61}],['code expiring at issue',{...bound(acct,source.sid),code_expires_at:now}],
  ['code hash not hex',{...bound(acct,source.sid),code_hash:'Z'.repeat(64)}],['native session id wrong length',{...bound(acct,source.sid),native_session_id:'short'}]
 ])await rejects(name,()=>insertHandoff(o),/CHECK|constraint/i);
 await rejects('unknown source session',()=>insertHandoff({...bound(acct,id())}),/FOREIGN|constraint/i);
 await rejects('unknown account',()=>insertHandoff({...bound({a:id()},source.sid)}),/FOREIGN|constraint/i);
 await ok('a bound handoff can be inserted directly (code issued, unconsumed)',()=>insertHandoff(bound(acct,source.sid)));
 await ok('uniqueness: browser token, code hash, native session',async()=>{
  const first=await insertHandoff({}),code=uniqueHex();
  await rejects('duplicate browser token hash',()=>insertHandoff({browser_token_hash:first.browser_token_hash}),/UNIQUE|constraint/i);
  await insertHandoff({...bound(acct,source.sid),code_hash:code});
  await rejects('duplicate code hash',()=>insertHandoff({...bound(acct,source.sid),code_hash:code}),/UNIQUE|constraint/i);
  const n=id();await insertHandoff({...bound(acct,source.sid),native_session_id:n});
  await rejects('duplicate native session id',()=>insertHandoff({...bound(acct,source.sid),native_session_id:n}),/UNIQUE|constraint/i);
 });
 const issuedUpdate=(set,h)=>run(`UPDATE identity_handoffs SET ${set} WHERE id=?`,h.id);
 await ok('transition trigger: exactly two moves, each once',async()=>{
  const h=await insertHandoff({}),b=bound(acct,source.sid);
  await rejects('unbound handoff cannot jump straight to consumed',()=>run('UPDATE identity_handoffs SET account_id=?,source_session_id=?,auth_epoch=1,code_hash=?,code_issued_at=?,code_expires_at=?,native_session_id=? WHERE id=?',acct.a,source.sid,b.code_hash,now,now+60,id(),h.id),/identity_handoff_transition/);
  await rejects('unbound handoff cannot be consumed without a code',()=>issuedUpdate(`native_session_id='${id()}'`,h),/identity_handoff_transition|CHECK/);
  await rejects('purpose cannot change while unbound',()=>issuedUpdate("purpose='signup'",h),/identity_handoff_transition/);
  await run('UPDATE identity_handoffs SET account_id=?,source_session_id=?,auth_epoch=1,code_hash=?,code_issued_at=?,code_expires_at=? WHERE id=?',acct.a,source.sid,b.code_hash,now,now+60,h.id);
  await rejects('a second code cannot be issued',()=>issuedUpdate(`code_hash='${uniqueHex()}'`,h),/identity_handoff_transition/);
  await rejects('code expiry cannot be extended',()=>issuedUpdate(`code_expires_at=${now+30}`,h),/identity_handoff_transition/);
  await rejects('the epoch cannot change after issue',()=>issuedUpdate('auth_epoch=2',h),/identity_handoff_transition/);
  await rejects('the state cannot change after issue',()=>issuedUpdate(`state='${'t'.repeat(32)}'`,h),/identity_handoff_transition/);
  await rejects('an issued handoff cannot be unbound',()=>issuedUpdate('account_id=NULL,source_session_id=NULL,auth_epoch=NULL,code_hash=NULL,code_issued_at=NULL,code_expires_at=NULL',h),/identity_handoff_transition|CHECK/);
  await rejects('consumption cannot be a no-op',()=>issuedUpdate('code_hash=code_hash',h),/identity_handoff_transition/);
  const native=id();await issuedUpdate(`native_session_id='${native}'`,h);
  await rejects('a consumed handoff cannot be consumed again',()=>issuedUpdate(`native_session_id='${id()}'`,h),/identity_handoff_transition/);
  await rejects('a consumed handoff cannot be cleared',()=>issuedUpdate('native_session_id=NULL',h),/identity_handoff_transition/);
 });
 await ok('the 2000-row limit aborts the next insert',async()=>{
  const room=2000-await count('identity_handoffs');
  await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<?) INSERT INTO identity_handoffs(id,browser_token_hash,purpose,state,code_challenge,redirect_uri,created_at,expires_at)
   SELECT lower(hex(randomblob(18))),lower(hex(randomblob(32))),'signin','filler'||printf('%010d',i)||'abcd',substr(lower(hex(randomblob(32))),1,43),'https://whumpo.com/app/return',?,? FROM n`,room,now,now+300);
  assert.equal(await count('identity_handoffs'),2000);
  await rejects('2001st row',()=>insertHandoff({}),/identity_handoff_limit/);
  await run('DELETE FROM identity_handoffs WHERE state LIKE ?','filler%');
 });

 // --- resolver: a token resolves only for its own client ---
 await ok('cross-client tokens are refused in both directions; native has no grant',async()=>{
  const web=await session(acct,{client:'web'}),native=await session(acct,{client:'android',method:'handoff'}),nativeKey=await session(acct,{client:'android'});
  const resolve=(client,kind,token)=>resolveIdentity(db,{version:1,client,kind,token});
  assert.equal((await resolve('web','session',web.token)).client,'web');
  const n=await resolve('android','session',native.token);assert.equal(n.client,'android');assert.equal(n.proof.method,'handoff');
  assert.equal((await resolve('android','session',nativeKey.token)).proof.method,'passkey');
  await rejects('web token as android',()=>resolve('android','session',web.token),e=>e.code==='proof_required');
  await rejects('android token as web',()=>resolve('web','session',native.token),e=>e.code==='proof_required');
  await rejects('android passkey token as web',()=>resolve('web','session',nativeKey.token),e=>e.code==='proof_required');
  await rejects('android grant kind',()=>resolve('android','grant',native.token),e=>e.code==='invalid_identity_request');
  await rejects('unknown client',()=>resolve('ios','session',native.token),e=>e.code==='invalid_identity_request');
  // A handoff session is never fresh; a native passkey session is.
  const fresh={purpose:'workspace',freshPasskey:true,bindIdentityRevision:false};
  await rejects('handoff session is not fresh',()=>assertCurrentIdentity(db,n,fresh),e=>e.code==='proof_required');
  await assertCurrentIdentity(db,n,{...fresh,freshPasskey:false});
  await assertCurrentIdentity(db,await resolve('android','session',nativeKey.token),fresh);cases++;
 });

 // --- challenge save/consume take a client; origins are exact ---
 await ok('a web challenge refuses the android origin and an android challenge refuses the web origin',async()=>{
  const web=authenticator(webRp.origin),droid=authenticator(androidOrigin);
  for(const k of [web,droid])await run("INSERT OR IGNORE INTO identity_credentials(id,account_id,public_key,counter,name,status,attempt_id,created_at) VALUES(?,?,?,0,'Synthetic','active',NULL,?)",k.id,acct.a,k.publicKey,now-100);
  const go=async(rp,client,key,at,counter)=>{
   const {challenge,token}=await loginChallenge(rp,client),c=await consumeIdentityChallenge(db,token,'login',rp,client);
   return verifyIdentityAssertion(env,c,key.assertion({challenge,rpId:'whumpo.com'},counter,{atOrigin:at,handle:Buffer.from(acct.a).toString('base64url')}));
  };
  assert.equal((await go(webRp,'web',web,webRp.origin,1)).newCounter,1);
  assert.equal((await go(androidRp,'android',droid,androidOrigin,1)).newCounter,1);
  await rejects('web challenge, android-origin assertion (the #491 hole)',()=>go(webRp,'web',droid,androidOrigin,2),e=>e.code==='proof_required');
  await rejects('android challenge, web-origin assertion',()=>go(androidRp,'android',web,webRp.origin,2),e=>e.code==='proof_required');
  await rejects('android challenge, another apk-key-hash origin',()=>go(androidRp,'android',droid,'android:apk-key-hash:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',3),e=>e.code==='proof_required');
 });
 await ok('consuming a challenge as the other client is refused and burns it',async()=>{
  for(const [rp,client,other] of [[webRp,'web','android'],[androidRp,'android','web']]){
   const {token}=await loginChallenge(rp,client);
   await rejects(`${client} challenge consumed as ${other}`,()=>consumeIdentityChallenge(db,token,'login',rp,other),e=>e.code==='proof_required');
   assert.equal(await count('identity_challenges WHERE token_hash=?',await hashToken(token)),0);
  }
  const {token}=await loginChallenge({origin:'android:apk-key-hash:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',rpID:'whumpo.com'},'android');
  await rejects('android challenge with a non-allowlisted origin',()=>consumeIdentityChallenge(db,token,'login',{origin:'android:apk-key-hash:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',rpID:'whumpo.com'},'android'),e=>e.code==='proof_required');
  await rejects('web client cannot save an android origin',()=>loginChallenge(androidRp,'web'),e=>e.code==='identity_changed');
 });

 // --- revocation reach and pruning ---
 const seedNative=async a=>{
  const web=await session(a,{client:'web'}),native=await session(a,{client:'android',method:'handoff'});
  const issued=await insertHandoff({...bound(a,web.sid),native_session_id:native.sid}),pending=await insertHandoff({...bound(a,web.sid)});
  return {web,native,issued,pending};
 };
 const live=async a=>({sessions:await count('identity_sessions WHERE account_id=?',a.a),handoffs:await count('identity_handoffs WHERE account_id=?',a.a)});
 await ok('revoking every session (recovery, security-review commit, kit rotation) removes native sessions and pending handoffs',async()=>{
  const a=await account();await seedNative(a);assert.deepEqual(await live(a),{sessions:2,handoffs:2});
  await run('DELETE FROM identity_sessions WHERE account_id=?',a.a);
  assert.deepEqual(await live(a),{sessions:0,handoffs:0});
 });
 await ok('removing a passkey removes its native sessions and the handoffs from its browser sessions',async()=>{
  const a=await account();await seedNative(a);
  await run('DELETE FROM identity_credentials WHERE id=? AND account_id=?',a.key.id,a.a);
  assert.deepEqual(await live(a),{sessions:0,handoffs:0});
 });
 await ok('closing the account removes sessions and handoffs; revoking only the source session removes its pending handoff',async()=>{
  const a=await account(),s=await seedNative(a);
  await run('DELETE FROM identity_sessions WHERE id=?',s.web.sid);
  assert.deepEqual(await live(a),{sessions:1,handoffs:0});
  const b=await account();await seedNative(b);await run('DELETE FROM users WHERE id=?',b.a);assert.deepEqual(await live(b),{sessions:0,handoffs:0});
 });
 await ok('an advanced epoch leaves a native session unresolvable',async()=>{
  const a=await account(),native=await session(a,{client:'android',method:'handoff'});
  await run('UPDATE identity_accounts SET auth_epoch=2 WHERE account_id=?',a.a);
  await rejects('stale epoch',()=>resolveIdentity(db,{version:1,client:'android',kind:'session',token:native.token}),e=>e.code==='proof_required');
 });
 await ok('cleanIdentityCeremonies prunes expired handoffs (bound or not) and keeps live ones',async()=>{
  await run('DELETE FROM identity_handoffs');
  const old=await insertHandoff({created_at:now-1000,expires_at:now-700}),oldBound=await insertHandoff({created_at:now-1000,expires_at:now-700,...bound(acct,source.sid),code_issued_at:now-1000,code_expires_at:now-940}),liveOne=await insertHandoff({});
  await cleanIdentityCeremonies(db);
  assert.equal(await count('identity_handoffs WHERE id IN (?,?)',old.id,oldBound.id),0);assert.equal(await count('identity_handoffs WHERE id=?',liveOne.id),1);
 });
 console.log(`Schema batch 3d: ${cases} cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; android sessions and challenges, identity_handoffs with its transition and limit triggers, per-client resolver, exact-origin assertions, revocation reach and pruning. No provider call.`);
}finally{await fixture.close();}
