import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {build} from 'esbuild';
import {identityDatabase} from './helpers/identity-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
const built=await build({stdin:{contents:"export * from './src/workspace-identity/recovery';export * from './src/workspace-identity/kits';export * from './src/workspace-identity/ceremonies';export * from './src/workspace-identity/authority';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {startRecovery,readRecoveryState,reviewRecovery,secureRecovery,recoveryCompletionOptions,recoveryCompletionVerify,removePasskey,prepareKit,acknowledgeKit,rotateKit,completeEnrollment,signupOptions,signupVerify,addPasskeyOptions,addPasskeyVerify,loginOptions,loginVerify,reauthenticationOptions,reauthenticationVerify,resolveIdentity,assertCurrentIdentity,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
// Node fixture supplies the Workers Web Crypto extension with Node's native constant-time primitive.
const originalEqual=crypto.subtle.timingSafeEqual;crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fixture=await identityDatabase(),baseDB=fixture.db;let beforeBatch=null,cases=0,phase='admission';
const db={prepare:q=>baseDB.prepare(q),batch:async statements=>{const hook=beforeBatch;beforeBatch=null;if(hook)await hook();return baseDB.batch(statements);}};
const env={DB:db,ENVIRONMENT:'test',TURNSTILE_SECRET:'synthetic-turnstile-secret'},request=()=>new Request('https://whumpo.com/api/auth/identity/v1/test',{method:'POST',headers:{origin:'https://whumpo.com'}});
const row=(sql,...v)=>db.prepare(sql).bind(...v).first(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),id=()=>crypto.randomUUID();
const current=a=>resolveIdentity(db,{version:1,client:'web',kind:a.kind,token:a.token}),input=credential=>({version:1,credential});
const intent=p=>({version:1,requestId:id(),attemptId:p.attempt?.id??null,expectedRevision:p.attempt?.revision??p.credentialRevision,expectedEpoch:p.authEpoch});
const offered=(p,k)=>({...intent(p),offerId:k.offer.id,generation:k.offer.generation});
const workspace={purpose:'workspace',freshPasskey:false,bindIdentityRevision:false},counters=new Map();
const assertion=(key,options,extra={})=>key.assertion(options,counters.set(key.id,(counters.get(key.id)??0)+1).get(key.id),extra);
const originalFetch=globalThis.fetch;globalThis.fetch=async url=>{assert.equal(String(url),'https://challenges.cloudflare.com/turnstile/v0/siteverify');return Response.json({success:true,hostname:'whumpo.com',action:'register'});};
async function denies(fn,code){await assert.rejects(fn,error=>{assert.equal(error.code,code,error.message);return true;});cases++;}
async function fresh(f,key=f.keys.at(-1)){const p=await current(f.access),options=await reauthenticationOptions(request(),env,p,{version:1});f.access=await reauthenticationVerify(request(),env,p,options.challengeToken,input(assertion(key,options.options)));return f.access.principal;}
async function add(f){const p=await current(f.access),key=authenticator(),options=await addPasskeyOptions(request(),env,p,{version:1,requestId:id(),attemptId:p.attempt?.id??null,expectedRevision:p.attempt?.revision??p.credentialRevision,name:'Saved passkey'});
 await addPasskeyVerify(request(),env,p,options.challengeToken,input(key.registration(options.options)));f.keys.push(key);return key;}
async function login(key){const options=await loginOptions(request(),env,{version:1});return loginVerify(request(),env,options.challengeToken,input(assertion(key,options.options)));}
async function kit(f){const p=await current(f.access),k=await prepareKit(request(),env,p,intent(p)),updated=await current(f.access);await acknowledgeKit(request(),env,updated,{...offered(updated,k),saved:true});return k;}
async function ready(){const email=id()+'@example.invalid',code=id();await run("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)",await hashToken(code));
 const options=await signupOptions(request(),env,{version:1,email,inviteCode:code,usBased:true,turnstileToken:id()}),key=authenticator(),f={email,keys:[key],access:await signupVerify(request(),env,options.challengeToken,input(key.registration(options.options)))};
 await add(f);f.kit=await kit(f);const p=await fresh(f);f.access=(await completeEnrollment(request(),env,p,offered(p,f.kit))).authority;return f;}
async function start(f,key=f.kit.key){return startRecovery(request(),env,{version:1,email:f.email,key});}
async function review(f,mode='all',lostIds=undefined){const p=await current(f.access);if(lostIds===undefined)lostIds=(await readRecoveryState(db,p)).keys.filter(k=>k.status==='active').map(k=>k.id);
 const change={...intent(p),mode,lostIds};await reviewRecovery(request(),env,p,change);f.reviewId=change.requestId;return change;}
async function secure(f){f.replacementKit=await kit(f);const p=await current(f.access),change={...offered(p,f.replacementKit),reviewId:f.reviewId,confirmation:'secure-account'};
 f.secureIntent=change;f.access=(await secureRecovery(request(),env,p,change)).authority;return change;}
async function recovering(mode='all'){const f=await ready();f.ordinary=f.access;f.originalKeys=[...f.keys];f.access=await start(f);
 await review(f,mode,mode==='all'?f.keys.map(k=>k.id):mode==='some'?[f.keys[0].id]:[]);await secure(f);return f;}
async function options(f){const p=await current(f.access),state=await readRecoveryState(db,p),change={...intent(p),reviewId:state.review?.id??id(),generation:state.generation};return {p,change,...await recoveryCompletionOptions(request(),env,p,change)};}
async function finish(f,key=f.keys.at(-1)){const opts=await options(f);const result=await recoveryCompletionVerify(request(),env,opts.p,opts.challengeToken,input(assertion(key,opts.options)));f.access=result.authority;return {opts,result};}
try{
 const f=await ready(),original=f.access,account=original.principal.accountId;
 for(const data of [{version:1,email:f.email,key:'0'.repeat(64)},{version:1,email:'absent@example.invalid',key:f.kit.key},{version:1,email:f.email,key:'bad'}])await denies(()=>startRecovery(request(),env,data),'proof_required');
 await denies(()=>startRecovery(request(),env,{version:0,email:f.email,key:f.kit.key}),'client_upgrade_required');
 await denies(()=>startRecovery(new Request('https://whumpo.com/test',{method:'POST',headers:{origin:'https://bad.invalid'}}),env,{version:1,email:f.email,key:f.kit.key}),'invalid_identity_request');
 f.access=await start(f);const p=await current(f.access);assert.equal(p.purpose,'recovery');assert.equal(p.proof.method,'recovery-key');await assertCurrentIdentity(db,original.principal,workspace);
 await denies(()=>assertCurrentIdentity(db,p,workspace),'identity_incomplete');
 await denies(()=>add(f),'identity_changed');
 const state=await readRecoveryState(db,p);assert.equal(state.keys.length,2);assert.equal(state.review,null);assert.equal(state.status,'open');
 const again=await start(f);assert.equal(again.principal.attempt.id,p.attempt.id);await assertCurrentIdentity(db,await current(original),workspace);
 await denies(()=>readRecoveryState(db,original.principal),'identity_incomplete');
 const base=intent(p);
 for(const change of [{mode:'all',lostIds:[]},{mode:'some',lostIds:[]},{mode:'some',lostIds:f.keys.map(k=>k.id)},{mode:'none',lostIds:[f.keys[0].id]},{mode:'all',lostIds:['unknown']},{mode:'some',lostIds:[f.keys[0].id,f.keys[0].id]}])await denies(()=>reviewRecovery(request(),env,p,{...base,...change}),'invalid_identity_request');
 const outsider=await ready(),outsideAccess=await start(outsider),outsideP=await current(outsideAccess);
 await denies(()=>startRecovery(request(),env,{version:1,email:outsider.email,key:f.kit.key}),'proof_required');
 await denies(()=>reviewRecovery(request(),env,p,{...intent(p),mode:'some',lostIds:[outsider.keys[0].id]}),'invalid_identity_request');
 const reviewed=await review(f);assert.deepEqual((await readRecoveryState(db,await current(f.access))).review.lostIds,f.keys.map(k=>k.id).sort());
 assert((await reviewRecovery(request(),env,await current(f.access),reviewed)).receipt);await denies(async()=>reviewRecovery(request(),env,await current(f.access),{...reviewed,mode:'none',lostIds:[]}),'request_conflict');
 const beforeKit=await current(f.access),unsaved=await prepareKit(request(),env,beforeKit,intent(beforeKit)),beforeSave=await current(f.access),secureIntent={...offered(beforeSave,unsaved),reviewId:f.reviewId,confirmation:'secure-account'};
 await denies(()=>secureRecovery(request(),env,beforeSave,secureIntent),'identity_changed');
 await acknowledgeKit(request(),env,beforeSave,{...offered(beforeSave,unsaved),saved:true});
 await denies(()=>secureRecovery(request(),env,beforeSave,{...secureIntent,reviewId:id()}),'identity_changed');
 const won=await secureRecovery(request(),env,beforeSave,secureIntent);f.access=won.authority;f.replacementKit=unsaved;
 const secured=await current(f.access);assert.equal(secured.proof.method,'recovery-commit');assert.equal(secured.proof.verifiedAt,beforeSave.proof.verifiedAt);assert.equal(secured.expiresAt,beforeSave.expiresAt);assert.equal(secured.authEpoch,p.authEpoch+1);
 await denies(()=>current(original),'proof_required');await denies(()=>current(again),'proof_required');await denies(()=>start(f),'proof_required');
 for(const key of f.keys)await denies(()=>login(key),'proof_required');
 assert.equal((await row('SELECT count(*) n FROM identity_credentials WHERE account_id=?',account)).n,0);
 assert.equal((await row('SELECT count(*) n FROM identity_sessions WHERE account_id=?',account)).n,0);
 await denies(()=>assertCurrentIdentity(db,secured,{purpose:'recovery',freshPasskey:true,bindIdentityRevision:true}),'proof_required');
 const resumed=await start(f,unsaved.key);assert.equal(resumed.principal.attempt.id,p.attempt.id);assert.equal(resumed.principal.authEpoch,secured.authEpoch);
 const secureRead=await secureRecovery(request(),env,resumed.principal,secureIntent);assert.equal(secureRead.authority,null);assert.equal(secureRead.receipt.operationId,secureIntent.requestId);
 await denies(()=>secureRecovery(request(),env,resumed.principal,{...secureIntent,generation:99}),'request_conflict');

 phase='all-loss replacement completion';
 await denies(()=>options(f),'identity_changed');const firstReplacement=await add(f);await denies(()=>options(f),'identity_changed');const secondReplacement=await add(f);
 const entered=await start(f,unsaved.key);assert.equal((await readRecoveryState(db,entered.principal)).keys.length,2);
 const cross=await options(f);
 await denies(()=>recoveryCompletionVerify(request(),env,outsideP,cross.challengeToken,input(assertion(outsider.keys[0],cross.options))),'identity_changed');
 const complete=await options(f);assert.deepEqual(complete.options.allowCredentials.map(k=>k.id).sort(),[firstReplacement.id,secondReplacement.id].sort());
 await denies(()=>recoveryCompletionVerify(request(),env,complete.p,complete.challengeToken,input(assertion(secondReplacement,complete.options,{badSignature:true}))),'proof_required');
 await denies(()=>recoveryCompletionVerify(request(),env,complete.p,complete.challengeToken,input(assertion(secondReplacement,complete.options))),'proof_required');
 const generic=await reauthenticationOptions(request(),env,await current(f.access),{version:1});
 await denies(async()=>recoveryCompletionVerify(request(),env,await current(f.access),generic.challengeToken,input(assertion(secondReplacement,generic.options))),'proof_required');
 const finished=await finish(f);await assertCurrentIdentity(db,f.access.principal,workspace);assert.equal(f.access.principal.proof.credentialId,secondReplacement.id);
 assert.equal((await row('SELECT count(*) n FROM identity_sessions WHERE account_id=?',account)).n,1);
 await denies(()=>current(entered),'proof_required');await denies(()=>recoveryCompletionVerify(request(),env,finished.opts.p,finished.opts.challengeToken,input(assertion(secondReplacement,finished.opts.options))),'proof_required');
 const normal=await login(secondReplacement),readback=await recoveryCompletionOptions(request(),env,normal.principal,finished.opts.change);assert.equal(readback.completed.operationId,finished.opts.change.requestId);assert(!Object.hasOwn(readback,'options'));
 await denies(()=>recoveryCompletionOptions(request(),env,normal.principal,{...finished.opts.change,reviewId:id()}),'request_conflict');

 phase='partial and no-loss';
 for(const mode of ['some','none']){
  const partial=await recovering(mode),retained=partial.originalKeys[1],held=await login(retained);assert.equal(held.kind,'grant');assert.equal(held.principal.purpose,'recovery');
  await denies(()=>assertCurrentIdentity(db,held.principal,workspace),'identity_incomplete');await denies(()=>options(partial),'identity_changed');
  const replacement=await add(partial),opts=await options(partial);
  await denies(()=>recoveryCompletionVerify(request(),env,opts.p,opts.challengeToken,input(assertion(retained,opts.options))),'proof_required');
  const genericFresh=await fresh(partial,replacement);assert.equal(genericFresh.purpose,'recovery');
  const result=await finish(partial,replacement);assert.equal(result.result.authority.kind,'session');
  assert.equal((await row("SELECT count(*) n FROM identity_credentials WHERE account_id=? AND status='active'",genericFresh.accountId)).n,mode==='some'?2:3);
 }

 phase='review changes and stale inventory';
 const revised=await recovering('some'),newKey=await add(revised),existingAttempt=(await current(revised.access)).attempt.id;
 await review(revised,'all',[revised.originalKeys[1].id]);await denies(()=>options(revised),'identity_changed');
 await secure(revised);assert.equal((await current(revised.access)).attempt.id,existingAttempt);assert(await row('SELECT id FROM identity_credentials WHERE id=?',newKey.id));
 await denies(()=>login(revised.originalKeys[1]),'proof_required');await denies(()=>options(revised),'identity_changed');await add(revised);await finish(revised);
 const stale=await ready(),owner=stale.access;stale.access=await start(stale);await review(stale);const staleKit=await kit(stale),sp=await current(stale.access),staleIntent={...offered(sp,staleKit),reviewId:stale.reviewId,confirmation:'secure-account'};
 const ownerFixture={...stale,access:owner,keys:[...stale.keys]};await add(ownerFixture);
 await denies(()=>secureRecovery(request(),env,sp,staleIntent),'identity_changed');await assertCurrentIdentity(db,await current(owner),workspace);
 assert.equal((await row('SELECT kit_generation FROM identity_accounts WHERE account_id=?',sp.accountId)).kit_generation,1);

 phase='secure rollback and races';
 const rollback=await ready();rollback.ordinary=rollback.access;rollback.access=await start(rollback);await review(rollback);const rollbackKit=await kit(rollback),bp=await current(rollback.access),bc={...offered(bp,rollbackKit),reviewId:rollback.reviewId,confirmation:'secure-account'};
 await run(`CREATE TRIGGER test_recovery_failure BEFORE DELETE ON identity_credentials WHEN OLD.account_id='${bp.accountId}' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END`);
 await denies(()=>secureRecovery(request(),env,bp,bc),'identity_unavailable');
 assert.equal((await row('SELECT stage,kit_generation FROM identity_accounts WHERE account_id=?',bp.accountId)).stage,'ready');await assertCurrentIdentity(db,await current(rollback.ordinary),workspace);await current(rollback.access);assert.equal(await row('SELECT id FROM identity_effect_receipts WHERE id=?',bc.requestId),null);
 await run('DROP TRIGGER test_recovery_failure');
 let winning;beforeBatch=async()=>{winning=await secureRecovery(request(),env,bp,bc);rollback.access=winning.authority;await add(rollback);await add(rollback);};
 const loser={...bc,requestId:id()};await denies(()=>secureRecovery(request(),env,bp,loser),'identity_changed');
 assert.equal((await row('SELECT count(*) n FROM identity_credentials WHERE account_id=?',bp.accountId)).n,2);assert.equal(await row('SELECT id FROM identity_effect_receipts WHERE id=?',loser.requestId),null);await current(winning.authority);
 const raceOpts=await options(rollback),winOpts=await options(rollback);let completeWinner;
 beforeBatch=async()=>{completeWinner=await recoveryCompletionVerify(request(),env,winOpts.p,winOpts.challengeToken,input(assertion(rollback.keys.at(-1),winOpts.options)));};
 await denies(()=>recoveryCompletionVerify(request(),env,raceOpts.p,raceOpts.challengeToken,input(assertion(rollback.keys.at(-2),raceOpts.options))),'identity_changed');
 await assertCurrentIdentity(db,completeWinner.authority.principal,workspace);assert.equal((await row('SELECT count(*) n FROM identity_sessions WHERE account_id=?',bp.accountId)).n,1);

 phase='ordinary rotation fences recovery admission';
 const rotatedAway=await ready(),ordinary={...rotatedAway,keys:[...rotatedAway.keys]};rotatedAway.access=await start(rotatedAway);await review(rotatedAway);const target=await kit(rotatedAway),targetP=await current(rotatedAway.access),targetIntent={...offered(targetP,target),reviewId:rotatedAway.reviewId,confirmation:'secure-account'};
 beforeBatch=async()=>{const replacement=await kit(ordinary),ownerP=await current(ordinary.access);await rotateKit(request(),env,ownerP,offered(ownerP,replacement));ordinary.kit=replacement;};
 await denies(()=>secureRecovery(request(),env,targetP,targetIntent),'identity_changed');
 await assertCurrentIdentity(db,await current(ordinary.access),workspace);assert.equal((await row('SELECT count(*) n FROM identity_credentials WHERE account_id=?',targetP.accountId)).n,2);
 // The public proof was read before this concurrent rotation; its commit must still compare current kit/epoch.
 const beforeStartKit=ordinary.kit.key;
 beforeBatch=async()=>{const replacement=await kit(ordinary),ownerP=await current(ordinary.access);await rotateKit(request(),env,ownerP,offered(ownerP,replacement));ordinary.kit=replacement;};
 await denies(()=>start(ordinary,beforeStartKit),'proof_required');
 assert.equal((await row("SELECT count(*) n FROM identity_attempts WHERE account_id=? AND status IN ('open','secured')",targetP.accountId)).n,0);

 phase='completion rollback and fresh challenge';
 const failed=await recovering();await add(failed);await add(failed);const failedP=await current(failed.access),fo=await options(failed);
 await run(`CREATE TRIGGER test_recovery_session_failure BEFORE INSERT ON identity_sessions WHEN NEW.account_id='${failedP.accountId}' BEGIN SELECT RAISE(ABORT,'synthetic_failure'); END`);
 await denies(()=>recoveryCompletionVerify(request(),env,fo.p,fo.challengeToken,input(assertion(failed.keys.at(-1),fo.options))),'identity_unavailable');
 assert.equal((await row('SELECT stage FROM identity_accounts WHERE account_id=?',failedP.accountId)).stage,'recovering');assert.equal(await row('SELECT id FROM identity_effect_receipts WHERE id=?',fo.change.requestId),null);
 await run('DROP TRIGGER test_recovery_session_failure');await denies(()=>recoveryCompletionVerify(request(),env,fo.p,fo.challengeToken,input(assertion(failed.keys.at(-1),fo.options))),'proof_required');
 const counterOpts=await options(failed),counterKey=failed.keys.at(-1);
 beforeBatch=()=>run('UPDATE identity_credentials SET counter=counter+100 WHERE id=?',counterKey.id);
 await denies(()=>recoveryCompletionVerify(request(),env,counterOpts.p,counterOpts.challengeToken,input(assertion(counterKey,counterOpts.options))),'identity_changed');
 counters.set(counterKey.id,(await row('SELECT counter FROM identity_credentials WHERE id=?',counterKey.id)).counter);await finish(failed);

 phase='restricted kit replacement';
 const lostCopy=await recovering();const replacement=await add(lostCopy);await fresh(lostCopy,replacement);const originalRotated=lostCopy.replacementKit,newKit=await kit(lostCopy),notFresh=await current(lostCopy.access);
 await denies(()=>rotateKit(request(),env,notFresh,offered(notFresh,newKit)),'proof_required');
 const rotating=await fresh(lostCopy,replacement),rotation=offered(rotating,newKit),rotationResult=await rotateKit(request(),env,rotating,rotation);lostCopy.access=rotationResult.authority;
 assert.equal(lostCopy.access.kind,'grant');assert.equal(lostCopy.access.principal.proof.verifiedAt,rotating.proof.verifiedAt);assert.equal(lostCopy.access.principal.expiresAt,rotating.expiresAt);assert.equal(lostCopy.access.principal.authEpoch,rotating.authEpoch+1);
 assert.equal((await readRecoveryState(db,await current(lostCopy.access))).keys.length,1);await denies(()=>start(lostCopy,originalRotated.key),'proof_required');
 const currentKit=await start(lostCopy,newKit.key);assert.equal(currentKit.principal.attempt.id,rotating.attempt.id);
 await add(lostCopy);await finish(lostCopy);

 phase='capacity and source key removal';
 const capacity=await ready();while(capacity.keys.length<10)await add(capacity);
 capacity.access=await start(capacity);await review(capacity,'none',[]);await secure(capacity);
 await denies(()=>add(capacity),'identity_changed');
 const sourceKey=capacity.keys[0];await fresh(capacity,sourceKey);await review(capacity,'some',[sourceKey.id]);
 await secure(capacity);assert.equal(capacity.access.principal.proof.method,'recovery-commit');
 await denies(()=>login(sourceKey),'proof_required');await add(capacity);await finish(capacity);
 assert.equal((await row('SELECT count(*) n FROM identity_credentials WHERE account_id=?',capacity.access.principal.accountId)).n,10);

 phase='compromised staged replacement';
 const compromised=await recovering(),unsafe=await add(compromised),safe=await add(compromised),cp=await fresh(compromised,safe),savedKey=compromised.replacementKit.key;
 await removePasskey(request(),env,cp,{...intent(cp),credentialId:unsafe.id,confirmation:'remove-passkey'});
 await denies(()=>current(compromised.access),'proof_required');await denies(()=>login(unsafe),'proof_required');
 compromised.access=await start(compromised,savedKey);assert.equal((await readRecoveryState(db,compromised.access.principal)).review,null);
 assert.equal((await row('SELECT stage FROM identity_accounts WHERE account_id=?',cp.accountId)).stage,'recovering');
 await denies(()=>options(compromised),'identity_changed');await review(compromised,'all',[]);await secure(compromised);assert(await row('SELECT id FROM identity_credentials WHERE id=?',safe.id));await add(compromised);await finish(compromised);

 phase='emergency key removal';
 const emergency=await ready(),emergencyId=emergency.access.principal.accountId,originalKit=emergency.kit;
 await run('INSERT INTO test_effects VALUES(?,?)',id(),emergencyId);
 const ep=await current(emergency.access),remove={...intent(ep),credentialId:emergency.keys[0].id,confirmation:'remove-passkey'};
 await denies(()=>removePasskey(request(),env,ep,{...remove,confirmation:'yes'}),'invalid_identity_request');
 await removePasskey(request(),env,ep,remove);await denies(()=>current(emergency.access),'proof_required');await denies(()=>login(emergency.keys[0]),'proof_required');
 emergency.access=await login(emergency.keys[1]);await assertCurrentIdentity(db,emergency.access.principal,workspace);
 const last=await current(emergency.access);await removePasskey(request(),env,last,{...intent(last),credentialId:emergency.keys[1].id,confirmation:'remove-passkey'});
 await denies(()=>current(emergency.access),'proof_required');assert.equal((await row('SELECT stage FROM identity_accounts WHERE account_id=?',emergencyId)).stage,'recovering');
 assert.equal((await row('SELECT kit_verifier FROM identity_accounts WHERE account_id=?',emergencyId)).kit_verifier,await hashToken(originalKit.key));
 emergency.access=await start(emergency);await review(emergency,'all',[]);await secure(emergency);await add(emergency);await add(emergency);await finish(emergency);
 assert.equal((await row('SELECT count(*) n FROM test_effects WHERE owner=?',emergencyId)).n,1);
 console.log(`Identity recovery (${process.argv.includes('--d1')?'local D1':'SQLite'}): ${cases} refusal/race checks plus real signup, all/some/none recovery, revised loss, restricted rotation and zero-key recovery journeys passed.`);
}catch(error){console.error(`Identity recovery failed in ${phase}: ${error.message}`);process.exitCode=1;}
finally{globalThis.fetch=originalFetch;if(originalEqual)crypto.subtle.timingSafeEqual=originalEqual;else delete crypto.subtle.timingSafeEqual;await fixture.close();}
