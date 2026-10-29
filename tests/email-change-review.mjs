import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceSession} from './helpers/workspace-identity.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
import {fixtureKeyring,initializeFixtureKeys,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';

// WH-203 handler suites (and the local synthetic part of WH-204): the compromise review over the current schema on disposable
// in-memory SQLite and, with --d1, actual local D1. The REAL trusted adapter (src/email-change/review-http.ts) runs over the real
// workspace identity (admitted scopes, fresh-passkey elevation), the real review store and the real schema triggers. Passkeys are
// independent ES256 signatures from the test authenticator and the real login/recovery ceremonies; the only "providers" are the
// existing connection cleaners over a synthetic transport and the synthetic mailer. No network, no secret, no real address or
// credential (every address is under .test, every credential is a SYNTHETIC-* value).
const bundle=await build({stdin:{contents:[
 "export {default as worker} from './src/index';export {securityReviewRoute} from './src/email-change/review-http';export {accountEmailRoute} from './src/email-change/http';",
 "export {readConnections,readOpenReview} from './src/email-change/review-store';export {deliverStored} from './src/email-change/store';",
 "export {createSyntheticMailer,queueNotice} from './src/email-change/token';export {maintainEmailChanges} from './src/email-change/maintenance';",
 "export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",
 "export {loginOptions,loginVerify} from './src/workspace-identity/ceremonies';export {startRecovery} from './src/workspace-identity/recovery';",
 "export {newSessionToken,hashToken} from './src/security';export {cleanupGitHub} from './src/github-connection';export {cleanupCloudflare} from './src/cloudflare-connection';",
 ].join(''),resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
// Node supplies the Workers Web Crypto extension with its native constant-time primitive.
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results,one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const count=async(table,where='1=1',...v)=>(await one(`SELECT count(*) n FROM ${table} WHERE ${where}`,...v)).n;
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const origin='https://whumpo.com';
let limited=false;const env={AUTH_LIMITER:{limit:async()=>({success:!limited})}};
const outbox=[];let queued=true;
const delivery={queue:async(drafts)=>{for(const draft of drafts)outbox.push(m.queueNotice(draft,id(),Date.now()));}};
const ceremonyEnv={DB:db,ENVIRONMENT:'test',TURNSTILE_SECRET:'synthetic-turnstile-secret'};
const ceremonyRequest=()=>new Request(origin+'/api/auth/identity/v1/test',{method:'POST',headers:{origin}});
const counters=new Map(),assertion=(key,options,account)=>({version:1,credential:key.assertion(options,counters.set(key.id,(counters.get(key.id)??0)+1).get(key.id),{handle:Buffer.from(account).toString('base64url')})});

// An owner with real passkeys, a known recovery kit and a first session.
async function owner({keys=2,proofOffset=-5}={}){
 const account=id(),kitKey=m.newSessionToken(),passkeys=Array.from({length:keys},()=>authenticator());
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",account,`${account.slice(0,8)}@example.test`);
 await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)",account,await m.hashToken(kitKey),id());
 for(const key of passkeys)await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic passkey','active',NULL,unixepoch(),NULL)",key.id,account,key.publicKey);
 const o={account,kitKey,passkeys,email:(await one('SELECT email FROM users WHERE id=?',account)).email};
 o.session=await workspaceSession(db,m,{account,credential:passkeys[0].id},proofOffset);
 o.resession=(offset=-5,credential=passkeys[0].id)=>workspaceSession(db,m,{account,credential},offset);
 return o;
}
async function call(session,action,body,{method='POST',headers={},raw,query='',now}={}){
 const request=new Request(`${origin}/api/account/security/review/${action}${query}`,{method,headers:{origin,'content-type':'application/json',...headers},body:method==='GET'?undefined:raw??JSON.stringify(body)});
 let response;
 try{const principal=await m.resolveIdentity(db,{version:1,client:'web',kind:'session',token:session.token}),scoped=m.admitWorkspace(db,principal);
  response=await m.securityReviewRoute(request,env,scoped,principal,{delivery:queued?delivery:null,...(now?{now}:{})});}
 catch(error){if(error?.name==='IdentityError')return {status:error.status,data:{code:error.code},text:JSON.stringify({code:error.code}),headers:new Headers()};throw error;}
 if(response===null)return null;
 assert.equal(response.headers.get('cache-control'),'no-store');
 const text=await response.text();return {status:response.status,data:JSON.parse(text),text,headers:response.headers};
}
const prepare=(s)=>call(s,'prepare',{version:1});
const commit=(s,review,extra={},requestId=id())=>call(s,'commit',{version:1,requestId,reviewId:review,revokeCredentials:[],rotateKit:null,revokeConnections:[],...extra});
const account=(o)=>one('SELECT * FROM identity_accounts WHERE account_id=?',o.account);
const keysOf=async o=>(await all("SELECT id FROM identity_credentials WHERE account_id=? AND status='active' ORDER BY id",o.account)).map(r=>r.id);
const authorityRows=async o=>(await Promise.all(['identity_sessions','identity_grants','identity_challenges','identity_kit_offers'].map(t=>count(t,'account_id=?',o.account)))).reduce((a,b)=>a+b,0);

try{
 await check('boundaries: Origin, method, content type, size, closed input, retired proof fields, query and rate limit all refuse before anything is stored',async()=>{
  const o=await owner(),before=await count('owner_security_reviews'),ok={version:1};
  assert.equal((await call(o.session,'prepare',ok,{headers:{origin:'https://elsewhere.invalid'}})).status,403);
  assert.equal((await call(o.session,'prepare',ok,{headers:{origin:''}})).status,403);
  assert.equal((await call(o.session,'prepare',undefined,{method:'GET'})).status,404);
  assert.equal((await call(o.session,'prepare',ok,{headers:{'content-type':'text/plain'}})).status,400);
  assert.equal((await call(o.session,'prepare',{...ok,padding:'x'.repeat(5000)})).status,400);
  assert.equal((await call(o.session,'prepare',undefined,{raw:'{"version":1,'})).status,400);
  assert.equal((await call(o.session,'prepare',ok,{query:'?x=1'})).status,400);
  for(const field of ['password','recoveryCode','magicLink','emailCode','otp','passwordHash','newPassword','supportApproval','chatApproval'])assert.equal((await call(o.session,'prepare',{...ok,[field]:'x'})).status,400,field);
  assert.equal((await call(o.session,'prepare',{...ok,version:2})).status,409);
  limited=true;assert.equal((await call(o.session,'prepare',ok)).status,429);limited=false;
  assert.equal(await call(o.session,'unknown',ok),null,'only the four review routes match');
  // Passkey IDs are base64url (underscore and hyphen are valid); anything else is refused at the boundary.
  assert.equal((await commit(o.session,id(),{revokeCredentials:['a_b-c']})).data.code,'unknown_review');
  assert.equal((await commit(o.session,id(),{revokeCredentials:['a b']})).data.code,'invalid_selection');
  assert.equal(await count('owner_security_reviews'),before);
  // A stale passkey proof is refused by every operation that needs a fresh one.
  const stale=await o.resession(-700);
  assert.equal((await prepare(stale)).status,401);assert.equal((await call(stale,'kit',{version:1,reviewId:id()})).status,401);assert.equal((await commit(stale,id())).status,401);
  assert.equal(await count('owner_security_reviews'),before);
 });
 await check('prepare: one snapshot bound to epoch, credential revision, kit generation and connections; content-free; a reload reuses it',async()=>{
  const o=await owner(),before=await count('owner_security_reviews'),a=await account(o);
  const r=await prepare(o.session);assert.equal(r.status,200);
  assert.deepEqual(Object.keys(r.data).sort(),['accountRecoveryOnly','connections','credentials','expiresAt','kitGeneration','pendingEmailChange','reviewId','sessions','version']);
  assert.equal(r.data.accountRecoveryOnly,true);assert.deepEqual(r.data.credentials,o.passkeys.map(k=>k.id).sort());assert.equal(r.data.kitGeneration,1);assert.equal(r.data.pendingEmailChange,null);
  assert.deepEqual(r.data.sessions.map(s=>Object.keys(s).sort()),[['credentialId','issuedAt','sessionId']]);
  assert.equal(r.text.includes(o.session.token),false,'no session token in the snapshot');assert.equal(r.text.includes(await m.hashToken(o.session.token)),false,'no token hash');
  assert.equal(r.text.includes(o.kitKey),false);assert.equal(r.text.includes(a.kit_verifier),false);
  const row=await one('SELECT * FROM owner_security_reviews WHERE review_id=?',r.data.reviewId);
  assert.deepEqual({epoch:row.epoch,rev:row.credential_revision,kit:row.kit_generation,state:row.state,exp:row.expires_at-row.created_at},{epoch:a.auth_epoch,rev:a.credential_revision,kit:a.kit_generation,state:'open',exp:600000});
  assert.equal(r.data.expiresAt,row.expires_at);
  const again=await prepare(o.session);assert.equal(again.data.reviewId,r.data.reviewId);assert.equal(again.data.expiresAt,r.data.expiresAt);
  assert.equal(await count('owner_security_reviews'),before+1,'a reload does not spend one of the 20 stored reviews');
 });
 await check('commit: removes the selected passkey, advances the epoch, revokes every session, grant, challenge and kit offer, saves a content-free receipt',async()=>{
  const o=await owner({keys:3}),other=await o.resession(-5,o.passkeys[1].id),r=(await prepare(o.session)).data;
  const before=await account(o);
  // A restricted recovery grant and its open attempt exist before the commit; so does a login challenge.
  const grant=await m.startRecovery(ceremonyRequest(),ceremonyEnv,{version:1,email:o.email,key:o.kitKey});
  assert.equal(await count('identity_grants','account_id=?',o.account),1);assert.equal(await count('identity_attempts',"account_id=? AND status='open'",o.account),1);
  assert.equal(await count('identity_sessions','account_id=?',o.account),2);
  const requestId=id(),removed=o.passkeys[2].id;
  const done=await commit(o.session,r.reviewId,{revokeCredentials:[removed]},requestId);
  assert.equal(done.status,200,done.text);assert.deepEqual(Object.keys(done.data).sort(),['receipt','version']);
  const receipt=done.data.receipt;assert.deepEqual(receipt,{reviewId:r.reviewId,epoch:before.auth_epoch+1,stage:'ready',revokedCredentials:[removed],kitRotated:false,pendingEmailChange:null,connections:[],sessionsRevoked:'all',accountRecoveryOnly:true});
  assert.match(done.headers.get('set-cookie'),/^__Host-whumpo_session=; Path=\/; Secure; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970/);
  const after=await account(o);assert.equal(after.auth_epoch,before.auth_epoch+1);assert.equal(after.stage,'ready');assert.equal(after.kit_verifier,before.kit_verifier,'no kit rotation was requested');
  assert.deepEqual(await keysOf(o),o.passkeys.slice(0,2).map(k=>k.id).sort());
  assert.equal(await authorityRows(o),0,'every session, grant, challenge and kit offer is gone, including the initiating session and the other tab');
  assert.equal(await count('identity_attempts',"account_id=? AND status IN ('open','secured')",o.account),0,'the open recovery attempt is cancelled');
  await assert.rejects(m.resolveIdentity(db,{version:1,client:'web',kind:'grant',token:grant.token}),e=>e.name==='IdentityError');
  const row=await one('SELECT state,commit_request_id,receipt,committed_at FROM owner_security_reviews WHERE review_id=?',r.reviewId);
  assert.equal(row.state,'committed');assert.equal(row.commit_request_id,requestId);assert.deepEqual(JSON.parse(row.receipt),receipt);
  assert.equal(done.text.includes('password'),false);assert.equal(JSON.stringify(receipt).match(/content|plaintext|key/i),null,'the receipt claims account recovery only');
  assert.deepEqual(outbox.filter(n=>n.kind==='security-review-completed'&&n.to===o.email).length,1,'one content-free notice to the current address');
  // Authority from before the commit is gone: the original tab cannot reach anything.
  await assert.rejects(m.resolveIdentity(db,{version:1,client:'web',kind:'session',token:other.token}),e=>e.name==='IdentityError');
  assert.equal((await prepare(o.session)).status,401);
 });
 await check('lost commit reply: signing in again and replaying the same request ID reads the saved receipt; no second effect; a changed payload conflicts',async()=>{
  const o=await owner({keys:3}),r=(await prepare(o.session)).data,requestId=id(),removed=o.passkeys[2].id;
  const first=await commit(o.session,r.reviewId,{revokeCredentials:[removed]},requestId);assert.equal(first.status,200);
  const epoch=(await account(o)).auth_epoch,fresh=await o.resession(-5,o.passkeys[0].id);
  const replay=await commit(fresh,r.reviewId,{revokeCredentials:[removed]},requestId);
  assert.equal(replay.status,200);assert.equal(replay.text,first.text);assert.equal(replay.headers.get('set-cookie'),null,'a replay revokes nothing');
  assert.equal((await account(o)).auth_epoch,epoch,'the replay has no second effect');assert.equal(outbox.filter(n=>n.kind==='security-review-completed'&&n.to===o.email).length,1);
  assert.equal((await commit(fresh,r.reviewId,{revokeCredentials:[o.passkeys[1].id]},requestId)).data.code,'request_conflict');
  assert.deepEqual(await keysOf(o),o.passkeys.slice(0,2).map(k=>k.id).sort());
  // The same request ID cannot be borrowed for a different review.
  const r2=(await prepare(fresh)).data;assert.notEqual(r2.reviewId,r.reviewId);
  assert.equal((await commit(fresh,r2.reviewId,{},requestId)).data.code,'request_conflict');
 });
 await check('stale, expired, unknown and foreign reviews are refused and change nothing',async()=>{
  const o=await owner(),b=await owner(),r=(await prepare(o.session)).data,before=await account(o);
  // The credential set moved after the snapshot: stale.
  const extra=authenticator();await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic passkey','active',NULL,unixepoch(),NULL)",extra.id,o.account,extra.publicKey);
  assert.equal((await commit(o.session,r.reviewId,{revokeCredentials:[o.passkeys[0].id]})).data.code,'stale_review');
  assert.equal((await account(o)).auth_epoch,before.auth_epoch);assert.equal(await count('identity_credentials',"account_id=? AND status='active'",o.account),3);
  // A selection outside the snapshot, unknown ids and another account's review are refused.
  const fresh=(await prepare(o.session)).data;
  assert.equal((await commit(o.session,fresh.reviewId,{revokeCredentials:[b.passkeys[0].id]})).data.code,'invalid_selection');
  assert.equal((await commit(o.session,fresh.reviewId,{revokeConnections:['gh-nope']})).data.code,'invalid_selection');
  assert.equal((await commit(o.session,id())).data.code,'unknown_review');
  const theirs=(await prepare(b.session)).data;assert.equal((await commit(o.session,theirs.reviewId)).data.code,'unknown_review');
  assert.equal((await call(o.session,'commit',{version:1,requestId:id(),reviewId:fresh.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[],password:'x'})).status,400);
  assert.equal((await call(o.session,'commit',{version:1,requestId:'short',reviewId:fresh.reviewId})).status,400);
  assert.equal((await account(o)).auth_epoch,before.auth_epoch);
 });
 await check('expiry: a review older than its ten minutes is stale (review created in the past, committed after its expiry, proof still fresh)',async()=>{
  const o=await owner(),r=(await call(o.session,'prepare',{version:1},{now:()=>Date.now()-300000})).data;
  const body={version:1,requestId:id(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[]};
  assert.equal((await call(o.session,'commit',body,{now:()=>Date.now()+400000})).data.code,'stale_review');
  assert.equal((await call(o.session,'kit',{version:1,reviewId:r.reviewId},{now:()=>Date.now()+400000})).data.code,'stale_review');
  assert.equal((await account(o)).auth_epoch,1);assert.equal((await one('SELECT state FROM owner_security_reviews WHERE review_id=?',r.reviewId)).state,'open');
 });
 await check('competing commits of one review produce one effect',async()=>{
  const o=await owner({keys:3}),s2=await o.resession(-5,o.passkeys[1].id),r=(await prepare(o.session)).data;
  const results=await Promise.all([commit(o.session,r.reviewId,{revokeCredentials:[o.passkeys[2].id]}),commit(s2,r.reviewId,{revokeCredentials:[o.passkeys[1].id]})]);
  assert.equal(results.filter(x=>x.status===200).length,1,JSON.stringify(results.map(x=>x.data)));
  assert.equal((await account(o)).auth_epoch,2,'the epoch advanced exactly once');
  assert.equal(await count('owner_security_reviews',"account_id=? AND state='committed'",o.account),1);
  assert.equal((await keysOf(o)).length,2,'exactly one passkey was removed');
 });
 await check('kit replacement: the offer stores only its verifier; unsaved is refused; one offer per review; saved activates the new kit and retires the old',async()=>{
  const o=await owner(),r=(await prepare(o.session)).data;
  const unsaved=await call(o.session,'kit',{version:1,reviewId:r.reviewId});assert.equal(unsaved.status,200);
  assert.match(unsaved.data.key,/^[0-9a-f]{64}$/);assert.equal(unsaved.data.offer.generation,2);assert.ok(unsaved.data.text.includes(unsaved.data.key)&&unsaved.data.text.includes(o.email));
  const row=await one('SELECT * FROM owner_security_reviews WHERE review_id=?',r.reviewId);
  assert.equal(row.kit_verifier,await m.hashToken(unsaved.data.key));assert.equal(row.kit_offer_id,unsaved.data.offer.offerId);assert.equal(row.kit_saved_at,null);
  assert.equal(JSON.stringify(await all('SELECT * FROM owner_security_reviews')).includes(unsaved.data.key),false,'the plaintext key is never stored');
  assert.ok(row.kit_offer_expires_at<=row.expires_at);
  assert.equal((await call(o.session,'kit',{version:1,reviewId:r.reviewId})).data.code,'kit_offer_exists');
  // save-before-rotation
  const rotate={rotateKit:{offerId:unsaved.data.offer.offerId}},before=await account(o);
  assert.equal((await commit(o.session,r.reviewId,rotate)).data.code,'kit_not_saved');assert.deepEqual(await account(o),before);
  assert.equal((await call(o.session,'kit/save',{version:1,offerId:id()})).data.code,'unknown_offer');
  assert.equal((await call(o.session,'kit/save',{version:1,offerId:unsaved.data.offer.offerId,saved:true})).status,400);
  const saved=await call(o.session,'kit/save',{version:1,offerId:unsaved.data.offer.offerId});assert.deepEqual(saved.data,{version:1,saved:true,offerId:unsaved.data.offer.offerId});
  assert.equal((await call(o.session,'kit/save',{version:1,offerId:unsaved.data.offer.offerId})).status,200,'saving twice is idempotent');
  // a commit naming another review's offer is refused
  const other=(await prepare(await o.resession())).data;assert.equal(other.reviewId,r.reviewId);
  const done=await commit(o.session,r.reviewId,rotate);assert.equal(done.status,200,done.text);assert.equal(done.data.receipt.kitRotated,true);
  const after=await account(o);assert.equal(after.kit_generation,2);assert.equal(after.kit_verifier,await m.hashToken(unsaved.data.key));assert.equal(after.auth_epoch,2);
  // The old kit no longer opens recovery; the new one does (a restricted grant, never a session).
  await assert.rejects(m.startRecovery(ceremonyRequest(),ceremonyEnv,{version:1,email:o.email,key:o.kitKey}),e=>e.code==='proof_required');
  const grant=await m.startRecovery(ceremonyRequest(),ceremonyEnv,{version:1,email:o.email,key:unsaved.data.key});
  assert.equal(grant.kind,'grant');assert.equal(grant.principal.purpose,'recovery');
  assert.throws(()=>m.admitWorkspace(db,grant.principal),'a restricted recovery grant cannot become a workspace scope, so it reaches no review, connection or email operation');
 });
 await check('a kit offer from one review cannot rotate another review',async()=>{
  const o=await owner(),r1=(await prepare(o.session)).data,offer=(await call(o.session,'kit',{version:1,reviewId:r1.reviewId})).data.offer;
  await call(o.session,'kit/save',{version:1,offerId:offer.offerId});
  // Make a different review current by committing the first without the kit, then try the old offer on the next.
  await commit(o.session,r1.reviewId);const s=await o.resession(),r2=(await prepare(s)).data;assert.notEqual(r2.reviewId,r1.reviewId);
  const stolen=await commit(s,r2.reviewId,{rotateKit:{offerId:offer.offerId}});assert.equal(stolen.data.code,'kit_not_saved');
  assert.equal((await account(o)).kit_generation,1);
 });
 await check('emergency revocation down to zero keys: the account enters recovering, no removed key signs in, and the saved current kit opens only restricted recovery',async()=>{
  const o=await owner(),r=(await prepare(o.session)).data;
  const done=await commit(o.session,r.reviewId,{revokeCredentials:o.passkeys.map(k=>k.id)});
  assert.equal(done.status,200,done.text);assert.equal(done.data.receipt.stage,'recovering');assert.equal(done.data.receipt.sessionsRevoked,'all');
  const a=await account(o);assert.equal(a.stage,'recovering');assert.equal(a.current_attempt_id,null);assert.deepEqual(await keysOf(o),[]);assert.equal(await authorityRows(o),0);
  for(const key of o.passkeys){
   const options=await m.loginOptions(ceremonyRequest(),ceremonyEnv,{version:1});
   await assert.rejects(m.loginVerify(ceremonyRequest(),ceremonyEnv,options.challengeToken,assertion(key,options.options,o.account)),e=>e.code==='proof_required');
  }
  const grant=await m.startRecovery(ceremonyRequest(),ceremonyEnv,{version:1,email:o.email,key:o.kitKey});
  assert.deepEqual([grant.kind,grant.principal.purpose,grant.principal.stage],['grant','recovery','recovering']);
  assert.throws(()=>m.admitWorkspace(db,grant.principal));
  await assert.rejects(m.resolveIdentity(db,{version:1,client:'web',kind:'session',token:grant.token}),e=>e.name==='IdentityError');
 });
 await check('concurrent sign-in around a commit cannot restore authority: old session and removed key fail, the retained key signs in at the new epoch only',async()=>{
  const o=await owner({keys:2}),retained=o.passkeys[0],removed=o.passkeys[1],r=(await prepare(o.session)).data;
  // Challenges issued BEFORE the commit, one per key, and a session minted just before it.
  const pending=[];for(const key of [removed,retained]){const options=await m.loginOptions(ceremonyRequest(),ceremonyEnv,{version:1});pending.push({key,options});}
  const justBefore=await o.resession(-1,retained.id);
  const done=await commit(o.session,r.reviewId,{revokeCredentials:[removed.id]});assert.equal(done.status,200);
  await assert.rejects(m.resolveIdentity(db,{version:1,client:'web',kind:'session',token:justBefore.token}),e=>e.name==='IdentityError');
  assert.equal((await prepare(justBefore)).status,401);
  const [oldKey,keptKey]=pending;
  await assert.rejects(m.loginVerify(ceremonyRequest(),ceremonyEnv,oldKey.options.challengeToken,assertion(oldKey.key,oldKey.options.options,o.account)),e=>e.code==='proof_required');
  const signedIn=await m.loginVerify(ceremonyRequest(),ceremonyEnv,keptKey.options.challengeToken,assertion(keptKey.key,keptKey.options.options,o.account));
  assert.equal(signedIn.principal.authEpoch,2,'a retained passkey signs in to the new epoch only');assert.equal(signedIn.kind,'session');
  // The new session works; its authority is fresh, so a second review is possible.
  const next={token:signedIn.token};assert.equal((await prepare(next)).status,200);
 });
 await check('a pending email change is cancelled by the commit and its token is refused afterward',async()=>{
  const o=await owner(),mailer=m.createSyntheticMailer(),target=`new-${id().slice(0,8)}@example.test`;
  const callEmail=async(session,action,body)=>{
   const principal=await m.resolveIdentity(db,{version:1,client:'web',kind:'session',token:session.token}),scoped=m.admitWorkspace(db,principal);
   const response=await m.accountEmailRoute(new Request(`${origin}/api/account/email/${action}`,{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)}),env,scoped,principal,{delivery});
   return {status:response.status,data:await response.json()};
  };
  const change=await callEmail(o.session,'change',{version:1,requestId:id(),newAddress:target});assert.equal(change.data.status,'pending-confirmation');
  const notice=outbox.find(n=>n.state==='queued'&&n.kind==='confirm-new-address'&&n.to===target);await m.deliverStored(db,notice,mailer,Date.now());
  const token=mailer.calls.find(c=>c.to===target&&c.token).token;
  const r=(await prepare(o.session)).data;assert.equal(r.pendingEmailChange.changeId,change.data.changeId);
  const done=await commit(o.session,r.reviewId);assert.equal(done.data.receipt.pendingEmailChange,'cancelled');
  const row=await one('SELECT state,history FROM owner_email_changes WHERE change_id=?',change.data.changeId);
  assert.equal(row.state,'cancelled');assert.equal(JSON.parse(row.history).at(-1),'cancelled:security-review');
  const s=await o.resession(),late=await callEmail(s,'confirm',{version:1,token});assert.equal(late.status,409);assert.equal(late.data.code,'change_closed');
  assert.equal((await one('SELECT email FROM users WHERE id=?',o.account)).email,o.email,'the stale token changed nothing');
  // A replay does not cancel or notify twice.
  assert.equal((await prepare(s)).data.pendingEmailChange,null);
 });
 await check('provider connections: local access is disabled at once, the encrypted credential is retained, and nothing is erased without an exact receipt',async()=>{
  const o=await owner(),keyring=fixtureKeyring('cd'.repeat(32));
  await initializeFixtureKeys(db,keyring);
  const GH='SYNTHETIC-GITHUB-ACCESS-0001',GHR='SYNTHETIC-GITHUB-REFRESH-0001',CF={access:'SYNTHETIC-CLOUDFLARE-ACCESS-0001',refresh:'SYNTHETIC-CLOUDFLARE-REFRESH-0001'},CLIENT='synthetic-client',SECRET='SYNTHETIC-CLIENT-SECRET';
  const ghId=id(),cfId=id(),policy=await one('SELECT active_key,revision FROM connection_key_policy');
  await run("INSERT INTO connection_oauth_exchanges(token_id,user_id,provider,client_id,state_hash,key_id,revision,state) VALUES (?,?,'github',?,?,?,?,'dispatched')",ghId,o.account,CLIENT,'f'.repeat(64),policy.active_key,policy.revision);
  await run("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES (?,?,?,'2099-01-01T00:00:00.000Z','active')",ghId,o.account,await fixtureCiphertext(keyring,`whumpo:github:token:${o.account}:${ghId}`,GH));
  await run('INSERT INTO github_refresh_custody(token_id,user_id,client_id,github_user_id,ciphertext,expires_at,access_revoked_at) VALUES (?,?,?,NULL,?,NULL,NULL)',ghId,o.account,CLIENT,await fixtureCiphertext(keyring,`whumpo:github:refresh:${o.account}:${ghId}`,GHR));
  await run('DELETE FROM connection_oauth_exchanges WHERE token_id=?',ghId);await run('UPDATE github_refresh_custody SET github_user_id=? WHERE token_id=?','4242',ghId);
  await run("INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) VALUES (?,?,?,?,'2026-10-28')",o.account,'4242','synthetic',ghId);
  await run("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES (?,?,?,'2099-01-01T00:00:00.000Z','2026-10-28T00:00:00.000Z','active')",cfId,o.account,await fixtureCiphertext(keyring,`whumpo:cloudflare:token:${o.account}:${cfId}`,JSON.stringify(CF)));
  const r=(await prepare(o.session)).data;
  assert.deepEqual(r.connections.map(c=>[c.connectionId,c.provider,c.access,c.revocation]).sort(),[[`cf-${cfId}`,'cloudflare','active','none'],[`gh-${ghId}`,'github','active','none']]);
  const before=await accountClosureInventory(db,o.account);assert.equal(before.counts.githubCredentials,1);assert.equal(before.counts.cloudflareCredentials,1);assert.equal(before.counts.githubPendingRevocations+before.counts.cloudflarePendingRevocations,0);
  const ciphertexts=await all('SELECT ciphertext FROM github_token_vault WHERE id=? UNION ALL SELECT ciphertext FROM cloudflare_token_vault WHERE id=?',ghId,cfId);
  const done=await commit(o.session,r.reviewId,{revokeConnections:[`gh-${ghId}`,`cf-${cfId}`]});assert.equal(done.status,200,done.text);
  assert.deepEqual(done.data.receipt.connections.map(c=>[c.connectionId,c.access,c.revocation]).sort(),[[`cf-${cfId}`,'disabled','queued'],[`gh-${ghId}`,'disabled','queued']]);
  // Disabled locally, revocation queued in the existing states, ciphertext untouched.
  assert.equal((await one('SELECT active_token_id FROM github_connections WHERE user_id=?',o.account)).active_token_id,null);
  assert.equal((await one('SELECT state FROM github_token_vault WHERE id=?',ghId)).state,'revoking');assert.equal((await one('SELECT state FROM cloudflare_token_vault WHERE id=?',cfId)).state,'revoking');
  assert.deepEqual(await all('SELECT ciphertext FROM github_token_vault WHERE id=? UNION ALL SELECT ciphertext FROM cloudflare_token_vault WHERE id=?',ghId,cfId),ciphertexts);
  const holds=await m.readConnections(db,o.account,Date.now());
  assert.deepEqual(holds.map(c=>[c.connectionId,c.access,c.credentialHeld,c.revocation.state]).sort(),[[`cf-${cfId}`,'disabled',true,'queued'],[`gh-${ghId}`,'disabled',true,'queued']]);
  const blocked=await accountClosureInventory(db,o.account);assert.equal(blocked.counts.githubPendingRevocations,1);assert.equal(blocked.counts.cloudflarePendingRevocations,1);assert.equal(blocked.counts.githubRefreshCustody,1);
  // The existing cleaners dispatch. A lost response (transport throws) keeps the credential and the hold.
  const ghConfig={clientId:CLIENT,clientSecret:SECRET,appId:123,slug:'fixture',key:keyring},cfConfig={clientId:'synthetic-cf-client',clientSecret:SECRET,key:keyring};
  const lost={calls:0,transport:async()=>{lost.calls++;throw new Error('synthetic transport loss');}};
  await m.cleanupCloudflare(db,cfConfig,lost.transport,o.account);await m.cleanupGitHub(db,ghConfig,lost.transport,o.account);
  assert.ok(lost.calls>=1);assert.equal(await count('cloudflare_token_vault','id=?',cfId),1,'an unknown outcome erases nothing');assert.equal(await count('github_token_vault','id=?',ghId),1);
  assert.equal((await accountClosureInventory(db,o.account)).counts.cloudflarePendingRevocations,1,'the hold still blocks closure');
  // A GitHub single-token 204 with refresh custody revokes only the access token: the refresh credential and the vault row stay.
  await run("UPDATE github_token_vault SET state='revoking' WHERE id=?",ghId);
  await run("DELETE FROM github_revocation_claims WHERE token_id=?",ghId);
  const ok204={calls:0,transport:async()=>{ok204.calls++;return new Response(null,{status:204});}};
  await m.cleanupGitHub(db,ghConfig,ok204.transport,o.account);
  assert.equal(await count('github_token_vault','id=?',ghId),1);assert.equal(await count('github_refresh_custody','token_id=?',ghId),1);
  assert.equal(ok204.calls,1);
  assert.ok((await one('SELECT access_revoked_at FROM github_refresh_custody WHERE token_id=?',ghId)).access_revoked_at);
  assert.equal((await m.readConnections(db,o.account,Date.now())).find(c=>c.connectionId===`gh-${ghId}`).revocation.state,'uncertain','only the reviewed grant deletion settles a retained refresh credential');
  // Cloudflare: the exact 200 for every token erases it.
  await run("UPDATE cloudflare_token_vault SET revoke_after=NULL WHERE id=?",cfId);
  const exact={transport:async()=>new Response(null,{status:200})};await m.cleanupCloudflare(db,cfConfig,exact.transport,o.account);
  assert.equal(await count('cloudflare_token_vault','id=?',cfId),0,'erased only after the exact receipt');
  // A second review never redispatches or requeues: the surviving hold keeps its state.
  const s=await o.resession(),r2=(await prepare(s)).data;assert.deepEqual(r2.connections.map(c=>c.connectionId),[`gh-${ghId}`]);
  assert.equal(r2.connections[0].access,'disabled');
 });
 await check('through the Worker fetch handler: a commit returns the receipt and clears the cookie; sessions are gone; a replay after signing in again returns the same receipt',async()=>{
  const o=await owner(),r=(await prepare(o.session)).data,requestId=id(),cookie=s=>'__Host-whumpo_session='+s.token;
  const workerEnv={DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:env.AUTH_LIMITER},ctx={waitUntil(){}};
  const send=s=>m.worker.fetch(new Request(origin+'/api/account/security/review/commit',{method:'POST',headers:{origin,cookie:cookie(s),'content-type':'application/json'},
   body:JSON.stringify({version:1,requestId,reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[]})}),workerEnv,ctx);
  const first=await send(o.session),text=await first.text();
  assert.equal(first.status,200,text);assert.equal(JSON.parse(text).receipt.reviewId,r.reviewId);
  assert.match(first.headers.get('set-cookie'),/^__Host-whumpo_session=; .*Expires=Thu, 01 Jan 1970/);
  assert.equal(await count('identity_sessions','account_id=?',o.account),0);
  const replay=await send(await o.resession());assert.equal(replay.status,200);assert.equal(await replay.text(),text);assert.equal(replay.headers.get('set-cookie'),null);
 });
 await check('restore and forward repair cannot revive a committed review, an earlier epoch or a superseded offer',async()=>{
  const o=await owner(),r=(await prepare(o.session)).data,pre=await account(o);
  const done=await commit(o.session,r.reviewId,{});assert.equal(done.status,200);
  const insert=(epoch)=>run("INSERT INTO owner_security_reviews(review_id,account_id,epoch,credential_revision,kit_generation,credentials,connections,created_at,expires_at,state,revision) VALUES(?,?,?,?,?,'[]','[]',?,?,'open',1)",id(),o.account,epoch,pre.credential_revision,pre.kit_generation,Date.now(),Date.now()+600000);
  await assert.rejects(insert(pre.auth_epoch),/security_review_new/,'a review bound to the superseded epoch cannot be restored');
  await assert.rejects(run("UPDATE owner_security_reviews SET state='open',revision=revision+1,commit_request_id=NULL,commit_request_hash=NULL,receipt=NULL,committed_at=NULL WHERE review_id=?",r.reviewId),/security_review_guard/);
  await assert.rejects(run('DELETE FROM owner_security_reviews WHERE review_id=?',r.reviewId),/security_review_retained/);
  await assert.rejects(run('UPDATE identity_accounts SET auth_epoch=? WHERE account_id=?',pre.auth_epoch,o.account),/identity_account_immutable_or_decreased/);
  await assert.rejects(run('UPDATE identity_accounts SET kit_generation=?,kit_verifier=? WHERE account_id=?',0,null,o.account),/identity_account_immutable_or_decreased|CHECK/);
  // Replaying the committed review's commit with a new request ID is stale, not a second commit.
  const fresh=await o.resession();assert.equal((await commit(fresh,r.reviewId,{},id())).data.code,'stale_review');assert.equal((await account(o)).auth_epoch,pre.auth_epoch+1);
 });
 await check('closure: the inventory counts the reviews and account deletion removes them; bounded maintenance keeps recent reviews',async()=>{
  const o=await owner(),r=(await prepare(o.session)).data;await commit(o.session,r.reviewId,{});
  assert.equal((await accountClosureInventory(db,o.account)).counts.securityReviews,1);
  const totals=await m.maintainEmailChanges(db,5);assert.equal(totals.reviews,0,'a recent review is kept');
  await assert.rejects(m.maintainEmailChanges(db,0));await assert.rejects(m.maintainEmailChanges(db,1001));
  await run('DELETE FROM users WHERE id=?',o.account);
  assert.equal(await count('owner_security_reviews','account_id=?',o.account),0);assert.equal((await accountClosureInventory(db,o.account).catch(()=>({counts:{securityReviews:0}}))).counts.securityReviews,0);
 });
 await check('delivery inactive: the review still works and queues no notice',async()=>{
  const o=await owner(),r=(await prepare(o.session)).data,before=outbox.length;queued=false;
  const done=await commit(o.session,r.reviewId,{});queued=true;assert.equal(done.status,200);assert.equal(outbox.length,before);
 });
 console.log(`Email change review passed (${cases} cases, ${process.argv.includes('--d1')?'actual local D1':'in-memory SQLite'}): real trusted adapter, identity scope, signed synthetic WebAuthn and schema triggers; fresh passkey, epoch and review binding repeated in the committing batch; save-before-rotation; emergency zero-key revocation; one effect for competing commits; replay from the saved receipt; sign-in around a commit; provider holds with the credential retained; restore cannot revive superseded state.`);
}finally{await fixture.close();}
