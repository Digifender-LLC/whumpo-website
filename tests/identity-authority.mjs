import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {identityDatabase} from './helpers/identity-database.mjs';
const bundle=await build({stdin:{contents:"export * from './src/workspace-identity/authority';export {hashToken,newSessionToken} from './src/security';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {resolveIdentity:resolve,identityPredicate:predicate,assertCurrentIdentity:check,hashToken,newSessionToken}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const fixture=await identityDatabase(),{db}=fixture,id=()=>crypto.randomUUID();
const workspace={purpose:'workspace',freshPasskey:false,bindIdentityRevision:false};
const sensitive={...workspace,freshPasskey:true,bindIdentityRevision:true};
const restricted=purpose=>({purpose,freshPasskey:false,bindIdentityRevision:true});
const request=(token,kind='session')=>({version:1,client:'web',kind,token});
const stmt=(sql,...values)=>db.prepare(sql).bind(...values),run=(sql,...values)=>stmt(sql,...values).run(),row=(sql,...values)=>stmt(sql,...values).first();
let cases=0;
async function denies(action,code){await assert.rejects(action,e=>e.code===code);cases++;}
async function rejects(action,pattern){await assert.rejects(action,pattern);cases++;}
async function owner(stage='ready'){
 const account=id(),attempt=stage==='enrolling'?id():null;
 await run('INSERT INTO users(id,email,created_at) VALUES(?,?,unixepoch())',account,account+'@example.invalid');
 await run('INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,current_attempt_id,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,?,1,?,?,?,?)',account,stage,attempt,stage==='enrolling'?0:1,stage==='enrolling'?null:'a'.repeat(64),stage==='ready'?id():null);
 if(attempt)await run("INSERT INTO identity_attempts VALUES(?,?,'enrollment','open',0,1,0,unixepoch())",attempt,account);
 return {account,attempt};
}
async function key(user,status=user.attempt?'staged':'active',attempt=user.attempt){
 const credential=id();await run('INSERT INTO identity_credentials VALUES(?,?,?,0,?,?,?,unixepoch(),NULL)',credential,user.account,new Uint8Array([1,2,3]),'Synthetic passkey',status,attempt);return credential;
}
async function session(user,credential,proofOffset=-5,options={}){
 const token=newSessionToken(),authority=id();
 await run(`INSERT INTO identity_sessions VALUES(?,?,?,1,?,'web',?,'passkey',unixepoch()+?,unixepoch()+?,unixepoch()+?)`,authority,await hashToken(token),user.account,options.epoch??1,credential,proofOffset,options.issuedOffset??0,options.expiresOffset??3600);
 return {token,authority};
}
async function recovery(user){
 const attempt=id();await run("INSERT INTO identity_attempts VALUES(?,?,'recovery','open',0,1,1,unixepoch())",attempt,user.account);
 return {...user,attempt};
}
async function grant(user,method='registration',credential=null,options={}){
 const token=newSessionToken(),authority=id(),attempt=await row('SELECT * FROM identity_attempts WHERE id=?',user.attempt);
 await run(`INSERT INTO identity_grants VALUES(?,?,?,1,?,'web',?,?,?,unixepoch()+?,?,?,?,unixepoch()+?,unixepoch()+?)`,authority,await hashToken(token),user.account,
  options.epoch??attempt.auth_epoch,options.purpose??attempt.kind,user.attempt,method,options.proofOffset??-5,options.proofRevision??attempt.revision,credential,method==='recovery-key'?(options.kitGeneration===undefined?1:options.kitGeneration):null,options.issuedOffset??0,options.expiresOffset??1200);
 return {token,authority};
}
function effect(principal,policy=workspace){
 const gate=predicate(db,principal,policy),effectId=id();
 return {effectId,statement:stmt(`INSERT INTO test_effects SELECT ?,? WHERE ${gate.sql}`,effectId,principal.accountId,...gate.params)};
}
async function expectEffect(principal,expected,policy=workspace){
 const {effectId,statement}=effect(principal,policy);await statement.run();assert.equal(!!await row('SELECT 1 FROM test_effects WHERE id=?',effectId),expected);cases++;
}
try{
 // Only the current schema exists. A positive login cannot accidentally rely on old tables.
 assert.equal(await row("SELECT 1 FROM sqlite_master WHERE name IN ('sessions','passkeys','recovery_codes')"),null);
 const a=await owner(),ak=await key(a),as=await session(a,ak),p=await resolve(db,request(as.token));
 await check(db,p,sensitive);await expectEffect(p,true,sensitive);
 assert.equal(p.accountId,a.account);assert.equal(p.proof.method,'passkey');assert.equal(p.attempt,null);
 assert(Object.isFrozen(p)&&Object.isFrozen(p.proof));
 assert(!JSON.stringify(p).includes(as.token));assert(!JSON.stringify(p).includes(await hashToken(as.token)));
 await denies(()=>check(db,JSON.parse(JSON.stringify(p)),workspace),'proof_required');
 await denies(()=>check({prepare:db.prepare},p,workspace),'proof_required');
 await denies(()=>resolve(db,{...request(as.token),role:'owner'}),'invalid_identity_request');
 await denies(()=>resolve(db,{...request(as.token),version:0}),'client_upgrade_required');
 await denies(()=>resolve(db,{...request(as.token),client:'android'}),'proof_required'); // a web token never resolves for the android client (WH-083)
 await denies(()=>resolve(db,{...request(as.token),client:'ios'}),'invalid_identity_request');
 await denies(()=>resolve(db,{...request(as.token,'grant'),client:'android'}),'invalid_identity_request');
 await denies(()=>resolve(db,{...request(as.token),kind:'automatic'}),'invalid_identity_request');
 await denies(()=>resolve(db,request('short')),'proof_required');
 await denies(()=>resolve(db,request(newSessionToken())),'proof_required');
 await denies(()=>resolve(db,request(as.token,'grant')),'proof_required');
 await denies(()=>check(db,p,{...workspace,skipReview:true}),'invalid_identity_request');

 // Enrollment grants admit only their current attempt; registration is never a fresh assertion.
 const e=await owner('enrolling'),ek=await key(e),eg=await grant(e,'registration',ek),ep=await resolve(db,request(eg.token,'grant'));
 await check(db,ep,restricted('enrollment'));assert(Object.isFrozen(ep.attempt));
 await denies(()=>resolve(db,request(eg.token)),'proof_required');
 await denies(()=>check(db,ep,workspace),'identity_incomplete');
 await denies(()=>check(db,ep,restricted('recovery')),'identity_incomplete');
 await denies(()=>check(db,ep,{...restricted('enrollment'),freshPasskey:true}),'proof_required');
 const es=await session(e,ek);await denies(()=>resolve(db,request(es.token)),'proof_required');
 const fresh=await grant(e,'passkey',ek),fp=await resolve(db,request(fresh.token,'grant'));
 await check(db,fp,{...restricted('enrollment'),freshPasskey:true});
 const before=await row('SELECT revision FROM identity_attempts WHERE id=?',e.attempt);
 await run('UPDATE identity_credentials SET counter=counter+1,last_used_at=unixepoch() WHERE id=?',ek);
 assert.deepEqual(await row('SELECT revision FROM identity_attempts WHERE id=?',e.attempt),before);
 await check(db,fp,{...restricted('enrollment'),freshPasskey:true});
 await key(e);await expectEffect(fp,false,restricted('enrollment'));
 const resumed=await resolve(db,request(fresh.token,'grant'));await check(db,resumed,restricted('enrollment'));
 await denies(()=>check(db,resumed,{...restricted('enrollment'),freshPasskey:true}),'proof_required');
 await run("UPDATE identity_attempts SET status='cancelled',revision=revision+1 WHERE id=?",e.attempt);
 await denies(()=>resolve(db,request(fresh.token,'grant')),'proof_required');
 await rejects(()=>run("UPDATE identity_attempts SET status='open',revision=revision+1 WHERE id=?",e.attempt),/identity_attempt/);

 // A merely presented recovery kit does not revoke ordinary access; securing does.
 const r=await recovery(a),rg=await grant(r,'recovery-key'),rp=await resolve(db,request(rg.token,'grant'));
 await check(db,rp,restricted('recovery'));await check(db,p,sensitive);
 await denies(()=>check(db,rp,workspace),'identity_incomplete');
 await denies(()=>check(db,rp,{...restricted('recovery'),freshPasskey:true}),'proof_required');
 await rejects(()=>grant(r,'recovery-key',null,{kitGeneration:null}),/CHECK/);
 await run("UPDATE identity_accounts SET stage='recovering',current_attempt_id=?,auth_epoch=2,kit_generation=2,kit_verifier=? WHERE account_id=?",r.attempt,'b'.repeat(64),a.account);
 await run("UPDATE identity_attempts SET status='secured',auth_epoch=2,kit_generation=2,revision=revision+1 WHERE id=?",r.attempt);
 await denies(()=>resolve(db,request(as.token)),'proof_required');
 await denies(()=>check(db,p,workspace),'identity_changed');
 await expectEffect(p,false);await expectEffect(rp,false,restricted('recovery'));
 const oldKitGrant=await grant(r,'recovery-key');await denies(()=>resolve(db,request(oldKitGrant.token,'grant')),'proof_required');
 const currentKit=await grant(r,'recovery-key',null,{kitGeneration:2});await check(db,await resolve(db,request(currentKit.token,'grant')),restricted('recovery'));
 const retained=await grant(r,'passkey',ak),replacementKey=await key(r),replacement=await grant(r,'passkey',replacementKey);
 await check(db,await resolve(db,request(retained.token,'grant')),restricted('recovery'));
 await check(db,await resolve(db,request(replacement.token,'grant')),{...restricted('recovery'),freshPasskey:true});
 // Recovery registration is not accepted as continued assertion authority.
 await rejects(()=>grant(r,'registration',replacementKey),/CHECK/);
 const lastLost=await owner('recovering'),lastAttempt=await recovery(lastLost),lastGrant=await grant(lastAttempt,'recovery-key');
 await check(db,await resolve(db,request(lastGrant.token,'grant')),restricted('recovery'));

 // Invalid cross-account proof bindings are rejected by SQL, not only by the resolver.
 const b=await owner(),bk=await key(b);
 await rejects(()=>session(b,ak),/FOREIGN KEY/);
 await rejects(()=>grant({...r,account:b.account},'recovery-key'),/FOREIGN KEY/);
 await rejects(()=>key({...b,attempt:r.attempt}),/FOREIGN KEY/);
 const wrongKind=await grant(r,'passkey',ak,{purpose:'enrollment'});await denies(()=>resolve(db,request(wrongKind.token,'grant')),'proof_required');
 const unrelated=await owner('enrolling'),uk=await key(unrelated),us=await session(unrelated,uk);
 await run("UPDATE identity_accounts SET stage='ready',current_attempt_id=NULL,kit_generation=1,kit_verifier=?,completion_receipt_id=? WHERE account_id=?",'c'.repeat(64),id(),unrelated.account);
 await denies(()=>resolve(db,request(us.token)),'proof_required'); // staged key cannot enter workspace

 // Database time enforces exact expiration, issuance and freshness boundaries.
 const expired=await session(b,bk,-10,{issuedOffset:-5,expiresOffset:0});await denies(()=>resolve(db,request(expired.token)),'proof_required');
 const future=await session(b,bk,60,{issuedOffset:60});await denies(()=>resolve(db,request(future.token)),'proof_required');
 const futureIssue=await session(b,bk,-10,{issuedOffset:60});await denies(()=>resolve(db,request(futureIssue.token)),'proof_required');
 const stale=await session(b,bk,-600),sp=await resolve(db,request(stale.token));await check(db,sp,workspace);
 await denies(()=>check(db,sp,sensitive),'proof_required');await expectEffect(sp,false,sensitive);
 await rejects(()=>session(b,bk,-5,{expiresOffset:604800}),/CHECK/);
 await rejects(()=>grant(r,'passkey',ak,{expiresOffset:1800}),/CHECK/);
 const expiredGrant=await grant(r,'passkey',ak,{proofOffset:-10,issuedOffset:-5,expiresOffset:0});await denies(()=>resolve(db,request(expiredGrant.token,'grant')),'proof_required');
 const futureGrant=await grant(r,'passkey',ak,{proofOffset:60,issuedOffset:60});await denies(()=>resolve(db,request(futureGrant.token,'grant')),'proof_required');

 // The committing statement observes revocation after admission, including in the same batch.
 const live=await session(b,bk),bp=await resolve(db,request(live.token)),write=effect(bp);
 await db.batch([stmt('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?',b.account),write.statement]);
 assert.equal(await row('SELECT 1 FROM test_effects WHERE id=?',write.effectId),null);cases++;
 await denies(()=>check(db,bp,workspace),'identity_changed');
 await rejects(()=>run('UPDATE identity_accounts SET auth_epoch=1 WHERE account_id=?',b.account),/identity_account/);
 await rejects(()=>run("UPDATE identity_accounts SET stage='recovering' WHERE account_id=?",b.account),/identity_account/);
 await rejects(()=>run("UPDATE identity_accounts SET stage='enrolling' WHERE account_id=?",b.account),/identity_account/);
 await rejects(()=>run('UPDATE identity_accounts SET kit_verifier=? WHERE account_id=?','d'.repeat(64),b.account),/identity_account/);
 await rejects(()=>run('UPDATE identity_accounts SET kit_generation=kit_generation+1,kit_verifier=? WHERE account_id=?','d'.repeat(64),b.account),/identity_account/);
 const c=await owner(),ck=await key(c),cs=await session(c,ck),cp=await resolve(db,request(cs.token));
 const rollback=effect(cp,sensitive);
 await rejects(()=>db.batch([rollback.statement,stmt('UPDATE identity_sessions SET proof_at=proof_at+1 WHERE id=?',cs.authority)]),/identity_session/);
 assert.equal(await row('SELECT 1 FROM test_effects WHERE id=?',rollback.effectId),null);await check(db,cp,sensitive);
 const rollbackEpoch=effect(cp);await rejects(()=>db.batch([stmt('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?',c.account),rollbackEpoch.statement,stmt('INSERT INTO users(id,email,created_at) VALUES(?,?,unixepoch())',c.account,'duplicate@example.invalid')]),/UNIQUE/);
 await check(db,cp,sensitive);await expectEffect(cp,true,sensitive);
 const second=await key(c);await expectEffect(cp,true,workspace);await expectEffect(cp,false,sensitive);
 const afterAdd=await resolve(db,request(cs.token));await run('DELETE FROM identity_credentials WHERE id=?',second);await expectEffect(afterAdd,false,sensitive);
 const beforeDelete=await resolve(db,request(cs.token));await run('DELETE FROM identity_credentials WHERE id=?',ck);
 await expectEffect(beforeDelete,false);await denies(()=>resolve(db,request(cs.token)),'proof_required');
 const d=await owner(),dk=await key(d),ds=await session(d,dk),dp=await resolve(db,request(ds.token));
 await run('DELETE FROM identity_sessions WHERE id=?',ds.authority);await expectEffect(dp,false);
 const dpending=await owner('enrolling'),dkey=await key(dpending),dg=await grant(dpending,'registration',dkey),dgp=await resolve(db,request(dg.token,'grant'));
 await run('DELETE FROM identity_grants WHERE id=?',dg.authority);await expectEffect(dgp,false,restricted('enrollment'));

 // SQL guards protect proof immutability, exact revisions, key uniqueness and storage bounds.
 const imm=await session(d,dk);
 for(const change of ["expires_at=expires_at+1","issued_at=issued_at+1","token_hash='"+'0'.repeat(64)+"'","client='android'","policy_version=2"]){
  await rejects(()=>run('UPDATE identity_sessions SET '+change+' WHERE id=?',imm.authority),/identity_session|CHECK/);
 }
 await rejects(()=>run('UPDATE identity_grants SET expires_at=expires_at+1 WHERE id=?',replacement.authority),/identity_grant/);
 await rejects(()=>run('UPDATE identity_attempts SET kit_generation=kit_generation+1 WHERE id=?',r.attempt),/identity_attempt/);
 await rejects(()=>run('UPDATE identity_credentials SET account_id=? WHERE id=?',d.account,ak),/identity_credential/);
 await rejects(()=>run('UPDATE identity_credentials SET counter=counter-1 WHERE id=?',ek),/identity_credential|CHECK/);
 await rejects(()=>run('INSERT INTO identity_credentials SELECT id,?,public_key,counter,name,status,NULL,created_at,last_used_at FROM identity_credentials WHERE id=?',d.account,ak),/UNIQUE/);
 const limit=await owner('enrolling');for(let n=0;n<10;n++)await key(limit);
 await rejects(()=>key(limit),/identity_credential_limit/);
 for(let n=0;n<12;n++)await session(d,dk);
 const newest=await session(d,dk);assert.equal((await row('SELECT count(*) AS n FROM identity_sessions WHERE account_id=?',d.account)).n,10);
 await resolve(db,request(newest.token)); // equal-second insertion retains the newly issued session
 const limited=await owner('enrolling'),lk=await key(limited);
 for(let n=0;n<20;n++)await grant(limited,'registration',lk);
 await rejects(()=>grant(limited,'registration',lk),/identity_grant_limit/);
 // Identity lifetime is account owned: deletion removes its authority and effects together.
 await run('DELETE FROM users WHERE id=?',r.account);
 for(const table of ['identity_accounts','identity_attempts','identity_credentials','identity_sessions','identity_grants'])assert.equal((await row(`SELECT count(*) n FROM ${table} WHERE account_id=?`,r.account)).n,0);
 console.log(`identity-authority: ${cases} refusal/committing checks plus current session, enrollment/recovery, bounds and rollback journeys passed (${process.argv.includes('--d1')?'local D1':'SQLite'})`);
}finally{await fixture.close();}
