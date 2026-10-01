import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {identityDatabase} from './helpers/identity-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
const built=await build({stdin:{contents:"export * from './src/workspace-identity/kits';export * from './src/workspace-identity/ceremonies';export * from './src/workspace-identity/authority';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {prepareKit,acknowledgeKit,rotateKit,completeEnrollment,cancelEnrollment,readKitState,signupOptions,signupVerify,addPasskeyOptions,addPasskeyVerify,loginOptions,loginVerify,reauthenticationOptions,reauthenticationVerify,resolveIdentity,assertCurrentIdentity,cleanIdentityCeremonies,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const fixture=await identityDatabase(),baseDB=fixture.db;let beforeBatch=null,cases=0,phase='prepare';
const db={prepare:q=>baseDB.prepare(q),batch:async statements=>{const hook=beforeBatch;beforeBatch=null;if(hook)await hook();return baseDB.batch(statements);}};
const env={DB:db,ENVIRONMENT:'test',TURNSTILE_SECRET:'synthetic-turnstile-secret'},request=()=>new Request('https://whumpo.com/api/auth/identity/v1/test',{method:'POST',headers:{origin:'https://whumpo.com'}});
const row=(sql,...v)=>db.prepare(sql).bind(...v).first(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),id=()=>crypto.randomUUID();
const input=credential=>({version:1,credential}),current=a=>resolveIdentity(db,{version:1,client:'web',kind:a.kind,token:a.token});
const workspace={purpose:'workspace',freshPasskey:false,bindIdentityRevision:false},counters=new Map();
const originalFetch=globalThis.fetch;
globalThis.fetch=async url=>{assert.equal(String(url),'https://challenges.cloudflare.com/turnstile/v0/siteverify');return Response.json({success:true,hostname:'whumpo.com',action:'register'});};
async function denies(fn,code){await assert.rejects(fn,error=>{assert.equal(error.code,code,error.message);return true;});cases++;}
const intent=p=>({version:1,requestId:id(),attemptId:p.attempt?.id??null,expectedRevision:p.attempt?.revision??p.credentialRevision,expectedEpoch:p.authEpoch});
const offered=(p,k)=>({...intent(p),offerId:k.offer.id,generation:k.offer.generation});
const assertion=(key,options)=>key.assertion(options,counters.set(key.id,(counters.get(key.id)??0)+1).get(key.id));
async function invite(){const code=id();await run("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)",await hashToken(code));return code;}
async function enroll(email=id()+'@example.invalid'){
 const code=await invite(),key=authenticator(),data={version:1,email,inviteCode:code,usBased:true,turnstileToken:id()},start=await signupOptions(request(),env,data);
 const access=await signupVerify(request(),env,start.challengeToken,input(key.registration(start.options)));return {data,key,access};
}
async function add(f){const p=await current(f.access),key=authenticator(),change={version:1,requestId:id(),attemptId:p.attempt?.id??null,expectedRevision:p.attempt?.revision??p.credentialRevision,name:'Backup passkey'};
 const options=await addPasskeyOptions(request(),env,p,change);await addPasskeyVerify(request(),env,p,options.challengeToken,input(key.registration(options.options)));f.second=key;return {change,key};}
async function fresh(f,key=f.second??f.key){const p=await current(f.access),options=await reauthenticationOptions(request(),env,p,{version:1});f.access=await reauthenticationVerify(request(),env,p,options.challengeToken,input(assertion(key,options.options)));return f.access.principal;}
async function login(key){const options=await loginOptions(request(),env,{version:1});return loginVerify(request(),env,options.challengeToken,input(assertion(key,options.options)));}
async function prepare(f){const p=await current(f.access),change=intent(p),kit=await prepareKit(request(),env,p,change);return {...kit,change};}
async function save(f,kit){const p=await current(f.access),change={...offered(p,kit),saved:true};await acknowledgeKit(request(),env,p,change);return change;}
async function staged(){const f=await enroll();await add(f);const kit=await prepare(f);await save(f,kit);await fresh(f);return {...f,kit};}
async function ready(){const f=await staged(),p=await current(f.access);f.completion=offered(p,f.kit);f.done=await completeEnrollment(request(),env,p,f.completion);f.access=f.done.authority;return f;}
async function expiredOffer(kit){const old=await row('SELECT * FROM identity_kit_offers WHERE id=?',kit.offer.id),now=(await row('SELECT unixepoch() n')).n;
 await run('DELETE FROM identity_kit_offers WHERE id=?',old.id);await run('INSERT INTO identity_kit_offers VALUES(?,?,?,?,?,?,?,?,?,?,?,NULL)',old.id,old.account_id,old.purpose,old.attempt_id,old.auth_epoch,old.credential_revision,old.attempt_revision,old.generation,old.verifier,now-1801,now-1);}
try{
 const f=await enroll(),first=await current(f.access),change=intent(first);
 await denies(()=>prepareKit(request(),env,first,{...change,version:0}),'client_upgrade_required');
 await denies(()=>prepareKit(request(),env,first,{...change,userId:first.accountId}),'invalid_identity_request');
 await denies(()=>prepareKit(new Request('https://whumpo.com/test',{method:'POST',headers:{origin:'https://elsewhere.invalid'}}),env,first,change),'invalid_identity_request');
 await denies(()=>prepareKit(request(),env,{...first},change),'proof_required');
 const kit=await prepareKit(request(),env,first,change),after=await current(f.access);
 assert.match(kit.key,/^[0-9a-f]{64}$/);assert.equal(kit.filename,'whumpo-recovery-kit.txt');assert(kit.text.includes(f.data.email));assert(kit.text.includes(kit.key));assert(kit.text.includes('https://whumpo.com/workspace/'));assert(!kit.text.includes('?'));
 assert.equal(after.attempt.revision,first.attempt.revision+1);
 const record=await row('SELECT * FROM identity_kit_offers WHERE id=?',kit.offer.id);assert.equal(record.verifier,await hashToken(kit.key));assert.equal(record.saved_at,null);assert.equal(record.expires_at-record.created_at,1800);
 assert(!JSON.stringify(record).includes(kit.key));assert(!JSON.stringify(await row('SELECT * FROM identity_effect_receipts WHERE id=?',change.requestId)).includes(kit.key));
 const state=await readKitState(db,after);assert.equal(state.activeGeneration,0);assert.equal(state.offer.id,kit.offer.id);assert(!JSON.stringify(state).includes(record.verifier));
 const repeated=await prepareKit(request(),env,after,change);assert.equal(repeated.key,null);assert.equal(repeated.text,null);assert.equal(repeated.offer,null);assert.equal(repeated.receipt.operationId,change.requestId);
 await denies(()=>prepareKit(request(),env,after,{...change,expectedRevision:after.attempt.revision}),'request_conflict');
 await denies(()=>acknowledgeKit(request(),env,after,{...offered(after,kit),saved:false}),'invalid_identity_request');
 const saveIntent=await save(f,kit);assert.equal((await readKitState(db,after)).offer.saved,true);
 await acknowledgeKit(request(),env,after,saveIntent);assert.equal((await row('SELECT saved_at FROM identity_kit_offers WHERE id=?',kit.offer.id)).saved_at,(await row('SELECT created_at FROM identity_effect_receipts WHERE id=?',saveIntent.requestId)).created_at);
 await assert.rejects(()=>run('UPDATE identity_kit_offers SET saved_at=NULL WHERE id=?',kit.offer.id),/identity_kit_offer_immutable/);cases++;
 await assert.rejects(()=>run('UPDATE identity_kit_offers SET verifier=? WHERE id=?','e'.repeat(64),kit.offer.id),/identity_kit_offer_immutable/);cases++;
 await denies(()=>completeEnrollment(request(),env,after,offered(after,kit)),'proof_required');
 const oneFresh=await fresh(f);await denies(()=>completeEnrollment(request(),env,oneFresh,offered(oneFresh,kit)),'identity_changed');
 assert.equal((await row('SELECT stage FROM identity_accounts WHERE account_id=?',after.accountId)).stage,'enrolling');

 phase='superseding and exact review';
 const second=await add(f),changed=await current(f.access);assert.equal((await readKitState(db,changed)).offer,null);
 await denies(()=>acknowledgeKit(request(),env,changed,{...offered(changed,kit),saved:true}),'identity_changed');
 await denies(()=>prepareKit(request(),env,changed,{...intent(changed),requestId:second.change.requestId}),'request_conflict');
 const replacement=await prepare(f),replacementP=await current(f.access);
 await denies(()=>addPasskeyOptions(request(),env,replacementP,{...second.change,requestId:replacement.change.requestId,expectedRevision:replacementP.attempt.revision}),'request_conflict');
 await denies(()=>acknowledgeKit(request(),env,replacementP,{...offered(replacementP,replacement),generation:99,saved:true}),'identity_changed');
 await denies(()=>acknowledgeKit(request(),env,replacementP,{...offered(replacementP,replacement),expectedEpoch:99,saved:true}),'identity_changed');
 await denies(()=>acknowledgeKit(request(),env,replacementP,{...offered(replacementP,replacement),offerId:id(),saved:true}),'identity_changed');
 const other=await enroll(),otherP=await current(other.access);
 await denies(()=>acknowledgeKit(request(),env,otherP,{...offered(otherP,replacement),saved:true}),'identity_changed');
 await denies(()=>prepareKit(request(),env,otherP,{...intent(otherP),requestId:replacement.change.requestId}),'request_conflict');
 await denies(()=>rotateKit(request(),env,replacementP,offered(replacementP,replacement)),'identity_incomplete');
 const newer=await prepare(f);assert.notEqual(newer.key,replacement.key);assert.equal((await readKitState(db,await current(f.access))).offer.id,newer.offer.id);
 await denies(async()=>acknowledgeKit(request(),env,await current(f.access),{...offered(await current(f.access),replacement),saved:true}),'identity_changed');
 assert.equal((await row('SELECT count(*) n FROM identity_kit_offers WHERE account_id=?',after.accountId)).n,1);
 assert.equal((await row('SELECT kit_generation FROM identity_accounts WHERE account_id=?',after.accountId)).kit_generation,0);
 await save(f,newer);await fresh(f);
 const staleProof=f.access,proofBeforePrepare=await current(staleProof),finalKit=await prepare(f);await save(f,finalKit);
 await denies(async()=>completeEnrollment(request(),env,await current(f.access),offered(await current(f.access),finalKit)),'proof_required');
 const finalP=await fresh(f),finalIntent=offered(finalP,finalKit);assert(finalP.proof.verifiedAt>=proofBeforePrepare.proof.verifiedAt);
 phase='completion';
 const done=await completeEnrollment(request(),env,finalP,finalIntent),session=done.authority.principal;
 await assertCurrentIdentity(db,session,workspace);assert.equal(session.purpose,'workspace');assert.equal(session.proof.verifiedAt,finalP.proof.verifiedAt);assert.equal(session.expiresAt,finalP.proof.verifiedAt+604800);
 assert.equal((await row('SELECT count(*) n FROM identity_credentials WHERE account_id=? AND status=\'active\'',session.accountId)).n,2);
 assert.equal((await row('SELECT status FROM identity_attempts WHERE id=?',finalIntent.attemptId)).status,'complete');
 for(const table of ['identity_grants','identity_challenges','identity_kit_offers'])assert.equal((await row(`SELECT count(*) n FROM ${table} WHERE account_id=?`,session.accountId)).n,0);
 assert.equal((await row('SELECT kit_verifier FROM identity_accounts WHERE account_id=?',session.accountId)).kit_verifier,await hashToken(finalKit.key));
 assert.equal((await row('SELECT count(*) n FROM test_effects')).n,0);await denies(()=>current(staleProof),'proof_required');
 const readback=await completeEnrollment(request(),env,session,finalIntent);assert.equal(readback.authority,null);assert.equal(readback.receipt.operationId,finalIntent.requestId);
 await denies(()=>completeEnrollment(request(),env,session,{...finalIntent,offerId:id()}),'request_conflict');
 assert.equal((await row('SELECT count(*) n FROM identity_sessions WHERE account_id=?',session.accountId)).n,1);
 const returned=await login(f.second);await assertCurrentIdentity(db,returned.principal,workspace);

 phase='same request interleaving';
 const duplicate=await enroll(),duplicateP=await current(duplicate.access),duplicateIntent=intent(duplicateP);let duplicateWinner;
 beforeBatch=async()=>{duplicateWinner=await prepareKit(request(),env,duplicateP,duplicateIntent);};
 const duplicateRead=await prepareKit(request(),env,duplicateP,duplicateIntent);
 assert.equal(duplicateRead.key,null);assert.equal(duplicateRead.receipt.offerId,duplicateWinner.offer.id);
 assert.equal((await row('SELECT count(*) n FROM identity_kit_offers WHERE account_id=?',duplicateP.accountId)).n,1);
 const duplicateCurrent=await current(duplicate.access),duplicateSave={...offered(duplicateCurrent,duplicateWinner),saved:true};let saveWinner;
 beforeBatch=async()=>{saveWinner=await acknowledgeKit(request(),env,duplicateCurrent,duplicateSave);};
 assert.deepEqual(await acknowledgeKit(request(),env,duplicateCurrent,duplicateSave),saveWinner);
 cases+=2;

 phase='saved offer and reauthentication binding';
 const noSave=await enroll();await add(noSave);const noSaveKit=await prepare(noSave),noSaveP=await fresh(noSave);
 await denies(()=>completeEnrollment(request(),env,noSaveP,offered(noSaveP,noSaveKit)),'identity_changed');
 assert.equal((await row('SELECT stage FROM identity_accounts WHERE account_id=?',noSaveP.accountId)).stage,'enrolling');
 // Bookkeeping does not invalidate the offer; the same acknowledgment is sufficient after a new assertion.
 await save(noSave,noSaveKit);await fresh(noSave);assert.equal((await readKitState(db,await current(noSave.access))).offer.saved,true);
 await completeEnrollment(request(),env,await current(noSave.access),offered(await current(noSave.access),noSaveKit));
 const expiring=await staged(),expiringP=await current(expiring.access),expiringIntent=offered(expiringP,expiring.kit);
 beforeBatch=()=>expiredOffer(expiring.kit);
 await denies(()=>completeEnrollment(request(),env,expiringP,expiringIntent),'identity_changed');
 assert.equal(await row('SELECT id FROM identity_effect_receipts WHERE id=?',expiringIntent.requestId),null);

 phase='completion interleaving and rollback';
 const competing=await staged(),compP=await current(competing.access),a=offered(compP,competing.kit),b=offered(compP,competing.kit);
 let won;beforeBatch=async()=>{won=await completeEnrollment(request(),env,compP,a);};
 await denies(()=>completeEnrollment(request(),env,compP,b),'identity_changed');
 await assertCurrentIdentity(db,won.authority.principal,workspace);assert.equal((await row('SELECT count(*) n FROM identity_sessions WHERE account_id=?',compP.accountId)).n,1);assert.equal(await row('SELECT id FROM identity_effect_receipts WHERE id=?',b.requestId),null);
 const rollback=await staged(),rollbackP=await current(rollback.access),rollbackIntent=offered(rollbackP,rollback.kit);
 await run(`CREATE TRIGGER test_completion_failure BEFORE INSERT ON identity_sessions WHEN NEW.account_id='${rollbackP.accountId}' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END`);
 await denies(()=>completeEnrollment(request(),env,rollbackP,rollbackIntent),'identity_unavailable');
 assert.equal((await row('SELECT stage FROM identity_accounts WHERE account_id=?',rollbackP.accountId)).stage,'enrolling');assert.equal((await row('SELECT count(*) n FROM identity_credentials WHERE account_id=? AND status=\'staged\'',rollbackP.accountId)).n,2);assert.equal(await row('SELECT id FROM identity_effect_receipts WHERE id=?',rollbackIntent.requestId),null);
 await run('DROP TRIGGER test_completion_failure');await completeEnrollment(request(),env,rollbackP,rollbackIntent);
 const revoked=await staged(),revokedP=await current(revoked.access),revokedIntent=offered(revokedP,revoked.kit);
 beforeBatch=()=>run('DELETE FROM identity_credentials WHERE id=?',revoked.second.id);
 await denies(()=>completeEnrollment(request(),env,revokedP,revokedIntent),'identity_changed');
 assert.equal((await row('SELECT kit_generation FROM identity_accounts WHERE account_id=?',revokedP.accountId)).kit_generation,0);assert.equal(await row('SELECT id FROM identity_effect_receipts WHERE id=?',revokedIntent.requestId),null);

 phase='ordinary rotation';
 const r=await ready(),old=r.kit,extra=await login(r.key),rp=await current(r.access),base=await row('SELECT * FROM identity_sessions WHERE id=?',rp.authorityId);
 // Seed only pre-secure kit admission, whose implementation is the remaining WH-115 slice.
 const recoveryId=id(),recoveryToken='f'.repeat(64);
 await run("INSERT INTO identity_attempts VALUES(?,?,'recovery','open',0,1,1,unixepoch())",recoveryId,rp.accountId);
 await run("INSERT INTO identity_grants VALUES(?,?,?,1,1,'web','recovery',?,'recovery-key',unixepoch(),0,NULL,1,unixepoch(),unixepoch()+1800)",id(),await hashToken(recoveryToken),rp.accountId,recoveryId);
 const recoveryAccess={kind:'grant',token:recoveryToken};await current(recoveryAccess);
 await reauthenticationOptions(request(),env,rp,{version:1});
 const rotated=await prepare(r);assert.equal((await row('SELECT kit_verifier FROM identity_accounts WHERE account_id=?',rp.accountId)).kit_verifier,await hashToken(old.key));
 await denies(()=>rotateKit(request(),env,rp,offered(rp,rotated)),'identity_changed');
 await save(r,rotated);const rotation=offered(rp,rotated),rotationResult=await rotateKit(request(),env,rp,rotation),updated=await current(r.access);
 assert.equal(rotationResult.receipt.generation,2);assert.equal(updated.authEpoch,rp.authEpoch+1);assert.equal(updated.proof.verifiedAt,base.proof_at);assert.equal(updated.expiresAt,base.expires_at);
 const afterRotation=await row('SELECT * FROM identity_sessions WHERE id=?',rp.authorityId);assert.equal(afterRotation.issued_at,base.issued_at);assert.equal(afterRotation.token_hash,base.token_hash);
 assert.equal((await row('SELECT kit_verifier FROM identity_accounts WHERE account_id=?',rp.accountId)).kit_verifier,await hashToken(rotated.key));
 await denies(()=>current(extra),'proof_required');await denies(()=>current(recoveryAccess),'proof_required');await denies(()=>assertCurrentIdentity(db,rp,workspace),'identity_changed');
 assert.equal((await row('SELECT status FROM identity_attempts WHERE id=?',recoveryId)).status,'cancelled');
 for(const table of ['identity_grants','identity_challenges','identity_kit_offers'])assert.equal((await row(`SELECT count(*) n FROM ${table} WHERE account_id=?`,rp.accountId)).n,0);
 assert.deepEqual(await rotateKit(request(),env,updated,rotation),rotationResult);
 await denies(()=>rotateKit(request(),env,updated,{...rotation,generation:3}),'request_conflict');

 phase='rotation rollback and competing commit';
 const rotateAgain=await prepare(r);await save(r,rotateAgain);const rr=await current(r.access),rrIntent=offered(rr,rotateAgain),otherSession=await login(r.second);
 await run(`CREATE TRIGGER test_rotation_failure BEFORE DELETE ON identity_sessions WHEN OLD.id='${otherSession.principal.authorityId}' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END`);
 await denies(()=>rotateKit(request(),env,rr,rrIntent),'identity_unavailable');
 assert.equal((await row('SELECT kit_generation FROM identity_accounts WHERE account_id=?',rr.accountId)).kit_generation,2);await current(otherSession);assert.equal(await row('SELECT id FROM identity_effect_receipts WHERE id=?',rrIntent.requestId),null);
 await run('DROP TRIGGER test_rotation_failure');
 const loser=offered(rr,rotateAgain);beforeBatch=()=>rotateKit(request(),env,rr,rrIntent);
 await denies(()=>rotateKit(request(),env,rr,loser),'identity_changed');
 assert.equal((await row('SELECT kit_generation FROM identity_accounts WHERE account_id=?',rr.accountId)).kit_generation,3);assert.equal(await row('SELECT id FROM identity_effect_receipts WHERE id=?',loser.requestId),null);await current(r.access);
 const unsaved=await prepare(r),unsavedP=await current(r.access);await save(r,unsaved);
 beforeBatch=()=>run('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?',unsavedP.accountId);
 await denies(()=>rotateKit(request(),env,unsavedP,offered(unsavedP,unsaved)),'identity_changed');
 assert.equal((await row('SELECT kit_generation FROM identity_accounts WHERE account_id=?',rr.accountId)).kit_generation,3);

 phase='expiry and guarded prepare';
 const exp=await staged(),expP=await current(exp.access);await expiredOffer(exp.kit);
 await denies(()=>completeEnrollment(request(),env,expP,offered(expP,exp.kit)),'identity_changed');assert.equal((await readKitState(db,expP)).offer,null);
 const expKit=await prepare(exp);await save(exp,expKit);const expFresh=await fresh(exp),now=(await row('SELECT unixepoch() n')).n,grant=await row('SELECT * FROM identity_grants WHERE id=?',expFresh.authorityId);
 await run('DELETE FROM identity_grants WHERE id=?',grant.id);
 await run('INSERT INTO identity_grants VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',grant.id,grant.token_hash,grant.account_id,grant.policy_version,grant.auth_epoch,grant.client,grant.purpose,grant.attempt_id,grant.proof_method,now-601,grant.proof_revision,grant.credential_id,grant.kit_generation,now-601,now+1199);
 const oldProof=await current(exp.access);await denies(()=>completeEnrollment(request(),env,oldProof,offered(oldProof,expKit)),'proof_required');
 const prepRace=await enroll(),prepP=await current(prepRace.access),prepIntent=intent(prepP);
 beforeBatch=()=>run('DELETE FROM identity_grants WHERE id=?',prepP.authorityId);
 await denies(()=>prepareKit(request(),env,prepP,prepIntent),'identity_changed');assert.equal(await row('SELECT id FROM identity_effect_receipts WHERE id=?',prepIntent.requestId),null);
 assert.equal((await row('SELECT count(*) n FROM identity_kit_offers WHERE account_id=?',prepP.accountId)).n,0);

 phase='shared pre-secure offers';
 const pre=await ready(),preP=await current(pre.access),preAttempt=id(),preToken=crypto.randomUUID().replaceAll('-','').repeat(2);
 await run("INSERT INTO identity_attempts VALUES(?,?,'recovery','open',0,1,1,unixepoch())",preAttempt,preP.accountId);
 await run("INSERT INTO identity_grants VALUES(?,?,?,1,1,'web','recovery',?,'recovery-key',unixepoch(),0,NULL,1,unixepoch(),unixepoch()+1800)",id(),await hashToken(preToken),preP.accountId,preAttempt);
 const preAccess={kind:'grant',token:preToken},preRecovery=await current(preAccess),preKit=await prepareKit(request(),env,preRecovery,intent(preRecovery));
 assert.equal(preKit.offer.generation,2);await assertCurrentIdentity(db,await current(pre.access),workspace);
 await denies(async()=>rotateKit(request(),env,await current(preAccess),offered(await current(preAccess),preKit)),'identity_incomplete');
 // Zero usable keys enter recovering without a secured attempt. Current-kit proof can still prepare.
 await run("UPDATE identity_accounts SET stage='recovering',auth_epoch=2 WHERE account_id=?",preP.accountId);
 await run('DELETE FROM identity_credentials WHERE account_id=?',preP.accountId);
 await run('UPDATE identity_attempts SET auth_epoch=2,revision=revision+1 WHERE id=?',preAttempt);
 const preRevision=(await row('SELECT revision FROM identity_attempts WHERE id=?',preAttempt)).revision;
 const zeroToken=crypto.randomUUID().replaceAll('-','').repeat(2);
 await run("INSERT INTO identity_grants VALUES(?,?,?,1,2,'web','recovery',?,'recovery-key',unixepoch(),?,NULL,1,unixepoch(),unixepoch()+1800)",id(),await hashToken(zeroToken),preP.accountId,preAttempt,preRevision);
 const zero=await current({kind:'grant',token:zeroToken}),zeroKit=await prepareKit(request(),env,zero,intent(zero));assert.equal(zeroKit.offer.generation,2);
 assert.equal((await row('SELECT kit_generation FROM identity_accounts WHERE account_id=?',preP.accountId)).kit_generation,1);

 phase='cancellation';
 const cancelled=await enroll(),cancelKit=await prepare(cancelled),cancelP=await current(cancelled.access),cancelIntent={...intent(cancelP),confirmation:'cancel-enrollment'};
 await denies(()=>cancelEnrollment(request(),env,cancelP,{...cancelIntent,confirmation:'yes'}),'invalid_identity_request');
 await denies(()=>cancelEnrollment(request(),env,session,{...intent(session),confirmation:'cancel-enrollment'}),'identity_incomplete');
 await cancelEnrollment(request(),env,cancelP,cancelIntent);await denies(()=>current(cancelled.access),'proof_required');
 assert.equal(await row('SELECT id FROM users WHERE id=?',cancelP.accountId),null);
 for(const table of ['identity_accounts','identity_attempts','identity_credentials','identity_grants','identity_kit_offers'])assert.equal((await row(`SELECT count(*) n FROM ${table} WHERE account_id=?`,cancelP.accountId)).n,0);
 const spent=await row('SELECT * FROM invitations WHERE code_hash=?',await hashToken(cancelled.data.inviteCode));assert.equal(spent.used_by,null);assert(spent.used_at);
 const cancelReceipt=await row('SELECT * FROM identity_effect_receipts WHERE id=?',cancelIntent.requestId);assert.equal(cancelReceipt.account_id,null);assert(!JSON.stringify(cancelReceipt).includes(cancelKit.key));
 await denies(()=>cancelEnrollment(request(),env,cancelP,cancelIntent),'identity_changed');
 await denies(()=>signupOptions(request(),env,cancelled.data),'proof_required');
 const newSignup=await enroll(cancelled.data.email);assert.notEqual(newSignup.access.principal.accountId,cancelP.accountId);

 phase='bounded maintenance';
 // Fixtures expire an unused offer and receipts; maintenance cannot erase pending keys.
 const maintenance=await enroll(),maintenanceKit=await prepare(maintenance);await expiredOffer(maintenanceKit);
 const maintenanceP=await current(maintenance.access),beforeKeys=(await row('SELECT count(*) n FROM identity_credentials WHERE account_id=?',maintenanceP.accountId)).n;
 for(let n=0;n<501;n++){const receiptId=id();await run("INSERT INTO identity_effect_receipts VALUES(?,?,NULL,'kit_save',?,NULL,NULL,NULL,unixepoch()-604801)",receiptId,id(),'1'.repeat(64));}
 await cleanIdentityCeremonies(db);
 assert.equal((await row('SELECT count(*) n FROM identity_effect_receipts WHERE created_at<=unixepoch()-604800')).n,1);
 assert.equal(await row('SELECT id FROM identity_kit_offers WHERE id=?',maintenanceKit.offer.id),null);
 assert.equal((await row('SELECT count(*) n FROM identity_credentials WHERE account_id=?',maintenanceP.accountId)).n,beforeKeys);await current(maintenance.access);
 assert(await row('SELECT id FROM identity_effect_receipts WHERE id=?',cancelIntent.requestId));
 await cleanIdentityCeremonies(db);assert.equal((await row('SELECT count(*) n FROM identity_effect_receipts WHERE created_at<=unixepoch()-604800')).n,0);
 console.log(`Identity kits (${process.argv.includes('--d1')?'local D1':'SQLite'}): ${cases} refusal/race checks plus actual enrollment, completion, one-time kit, rotation, cancellation and maintenance journeys passed.`);
}catch(error){console.error(`Identity kits failed in ${phase}: ${error.message}`);process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await fixture.close();}
