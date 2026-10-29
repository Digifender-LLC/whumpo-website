import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {identityDatabase} from './helpers/identity-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
const built=await build({stdin:{contents:"export * from './src/workspace-identity/ceremonies';export * from './src/workspace-identity/authority';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const service=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const {signupOptions,signupVerify,addPasskeyOptions,addPasskeyVerify,loginOptions,loginVerify,reauthenticationOptions,reauthenticationVerify,resolveIdentity,assertCurrentIdentity,cleanIdentityCeremonies,hashToken}=service;
const fixture=await identityDatabase(),baseDB=fixture.db;let beforeBatch=null,cases=0,phase='eligibility';
const db={prepare:q=>baseDB.prepare(q),batch:async statements=>{const hook=beforeBatch;beforeBatch=null;if(hook)await hook();return baseDB.batch(statements);}};
const env={DB:db,ENVIRONMENT:'test',TURNSTILE_SECRET:'synthetic-turnstile-secret'},request=()=>new Request('https://whumpo.com/api/auth/identity/v1/test',{method:'POST',headers:{origin:'https://whumpo.com'}});
const row=(sql,...v)=>db.prepare(sql).bind(...v).first(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),id=()=>crypto.randomUUID();
const input=credential=>({version:1,credential}),current=a=>resolveIdentity(db,{version:1,client:'web',kind:a.kind,token:a.token});
const workspace={purpose:'workspace',freshPasskey:false,bindIdentityRevision:false};
const originalFetch=globalThis.fetch;let turnstileResult={success:true,hostname:'whumpo.com',action:'register'},turnstileCalls=0;
globalThis.fetch=async(url,options)=>{
 assert.equal(String(url),'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(options.redirect,'manual');
 const sent=JSON.parse(options.body);assert.equal(sent.secret,env.TURNSTILE_SECRET);assert(sent.response);turnstileCalls++;
 return typeof turnstileResult==='string'?new Response(turnstileResult):Response.json(turnstileResult);
};
async function denies(fn,code){await assert.rejects(fn,error=>{assert.equal(error.code,code,error.message);return true;});cases++;}
async function invite(){const code=id();await run("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)",await hashToken(code));return code;}
const form=(code,email=id()+'@example.invalid')=>({version:1,email,inviteCode:code,usBased:true,turnstileToken:id()});
async function enroll(code=undefined){
 const data=form(code??await invite()),key=authenticator(),start=await signupOptions(request(),env,data);
 const access=await signupVerify(request(),env,start.challengeToken,input(key.registration(start.options)));
 return {data,key,access,start};
}
const addIntent=p=>({version:1,requestId:id(),attemptId:p.attempt?.id??null,expectedRevision:p.attempt?.revision??p.credentialRevision,name:'Backup passkey'});
async function login(key,counter,overrides={}){const options=await loginOptions(request(),env,{version:1});return loginVerify(request(),env,options.challengeToken,input(key.assertion(options.options,counter,overrides)));}
try{
 // Every environment follows invitation, US declaration and server-side Turnstile verification.
 const code=await invite(),data=form(code),testKey=authenticator();
 await denies(()=>signupOptions(request(),env,{...data,usBased:false}),'invalid_identity_request');
 await denies(()=>signupOptions(request(),env,{...data,inviteCode:'unknown'}),'proof_required');
 await denies(()=>signupOptions(request(),env,{...data,version:0}),'client_upgrade_required');
 await denies(()=>signupOptions(request(),{...env,TURNSTILE_SECRET:undefined},data),'identity_unavailable');
 await denies(()=>signupOptions(new Request('https://whumpo.com/api/auth/identity/v1/signup',{method:'POST',headers:{origin:'https://attacker.invalid'}}),env,data),'invalid_identity_request');
 await denies(()=>signupOptions(request(),{...env,ENVIRONMENT:'old'},data),'identity_unavailable');
 for(const result of [{success:false},{success:true,hostname:'other.invalid',action:'register'},{success:true,hostname:'whumpo.com',action:'wrong'},'x'.repeat(9000)]){
  turnstileResult=result;await denies(()=>signupOptions(request(),env,data),typeof result==='string'?'identity_unavailable':'proof_required');
 }
 turnstileResult={success:true,hostname:'whumpo.com',action:'register'};
 for(const bad of [{atOrigin:'https://attacker.invalid'},{uv:false},{rpID:'attacker.invalid'},{crossOrigin:true}]){
  const start=await signupOptions(request(),env,data);
  await denies(()=>signupVerify(request(),env,start.challengeToken,input(testKey.registration(start.options,bad))),'proof_required');
  await denies(()=>signupVerify(request(),env,start.challengeToken,input(testKey.registration(start.options))),'proof_required');
 }
 assert.equal((await row('SELECT used_by FROM invitations WHERE code_hash=?',await hashToken(code))).used_by,null);
 assert.equal((await row('SELECT count(*) AS n FROM users')).n,0);
 const first=await enroll(code),account=first.access.principal.accountId;
 assert.equal(first.access.kind,'grant');assert.equal(first.access.principal.purpose,'enrollment');
 assert.equal(first.start.options.authenticatorSelection.residentKey,'required');assert.equal(first.start.options.authenticatorSelection.userVerification,'required');
 assert.equal((await row('SELECT used_by FROM invitations WHERE code_hash=?',await hashToken(code))).used_by,account);
 assert.equal((await row('SELECT count(*) n FROM identity_sessions WHERE account_id=?',account)).n,0);
 assert.equal((await row('SELECT signup_method FROM customer_eligibility WHERE user_id=?',account)).signup_method,'passkey');
 await denies(()=>assertCurrentIdentity(db,first.access.principal,workspace),'identity_incomplete');
 await denies(()=>signupVerify(request(),env,first.start.challengeToken,input(first.key.registration(first.start.options))),'proof_required');
 await denies(()=>signupOptions(request(),env,first.data),'proof_required'); // invitation cannot resume

 phase='resume';
 // Losing the first reply or browser grant needs only the passkey that was just created.
 await run('DELETE FROM identity_grants WHERE account_id=?',account);
 const resumed=await login(first.key,1);assert.equal(resumed.kind,'grant');assert.equal(resumed.principal.accountId,account);
 assert.equal(resumed.principal.attempt.id,first.access.principal.attempt.id);
 assert.equal((await row('SELECT count(*) n FROM users')).n,1);
 await denies(()=>assertCurrentIdentity(db,resumed.principal,workspace),'identity_incomplete');
 for(const bad of [{uv:false},{atOrigin:'https://other.invalid'},{rpID:'other.invalid'},{handle:Buffer.from('another-account').toString('base64url')},{badSignature:true},{crossOrigin:true},{handle:null}])await denies(()=>login(first.key,2,bad),'proof_required');
 assert.equal((await row('SELECT counter FROM identity_credentials WHERE id=?',first.key.id)).counter,1);
 await denies(()=>login(first.key,1),'proof_required');
 const mismatch=await loginOptions(request(),env,{version:1});
 await denies(()=>loginVerify(request(),env,mismatch.challengeToken,input(first.key.assertion({...mismatch.options,challenge:'wrong-challenge'},2))),'proof_required');
 await denies(()=>loginVerify(request(),env,mismatch.challengeToken,input(first.key.assertion(mismatch.options,2))),'proof_required');
 const wrongKind=await loginOptions(request(),env,{version:1});
 await denies(()=>signupVerify(request(),env,wrongKind.challengeToken,{version:1,credential:{}}),'proof_required');
 await denies(()=>loginVerify(request(),env,wrongKind.challengeToken,input(first.key.assertion(wrongKind.options,2))),'proof_required');
 const malformed=await loginOptions(request(),env,{version:1});
 await denies(()=>loginVerify(request(),env,malformed.challengeToken,input({id:first.key.id,large:'x'.repeat(70000)})),'proof_required');
 await denies(()=>loginVerify(request(),env,malformed.challengeToken,input(first.key.assertion(malformed.options,2))),'proof_required');

 phase='second registration';
 // Register a second key using the restricted grant. A lost add reply reads a non-secret receipt.
 const p=await current(resumed),change=addIntent(p),secondKey=authenticator(),add=await addPasskeyOptions(request(),env,p,change);
 assert.deepEqual(add.options.excludeCredentials.map(k=>k.id),[first.key.id]);
 const added=await addPasskeyVerify(request(),env,p,add.challengeToken,input(secondKey.registration(add.options)));
 assert.equal(added.credentialId,secondKey.id);
 const afterAdd=await current(resumed),readback=await addPasskeyOptions(request(),env,afterAdd,change);
 assert.deepEqual(readback,{completed:added});assert(!Object.hasOwn(readback,'token'));
 await denies(()=>addPasskeyOptions(request(),env,afterAdd,{...change,name:'Different intent'}),'request_conflict');
 await denies(()=>addPasskeyVerify(request(),env,afterAdd,add.challengeToken,input(secondKey.registration(add.options))),'proof_required');
 assert.equal((await row('SELECT count(*) n FROM identity_credentials WHERE account_id=? AND status=\'staged\'',account)).n,2);
 assert.equal((await row('SELECT count(*) n FROM identity_sessions WHERE account_id=?',account)).n,0);
 await denies(()=>assertCurrentIdentity(db,afterAdd,{purpose:'enrollment',freshPasskey:true,bindIdentityRevision:true}),'proof_required');
 // Reauthentication has a fresh signature bound to the current unchanged semantic revision.
 const freshOptions=await reauthenticationOptions(request(),env,afterAdd,{version:1});
 const fresh=await reauthenticationVerify(request(),env,afterAdd,freshOptions.challengeToken,input(secondKey.assertion(freshOptions.options,1)));
 await assertCurrentIdentity(db,fresh.principal,{purpose:'enrollment',freshPasskey:true,bindIdentityRevision:true});
 await denies(()=>current(resumed),'proof_required'); // replaced grant, not a silent extension
 const revision=await row('SELECT revision FROM identity_attempts WHERE id=?',fresh.principal.attempt.id);
 const reauth=await reauthenticationOptions(request(),env,fresh.principal,{version:1});
 const again=await reauthenticationVerify(request(),env,fresh.principal,reauth.challengeToken,input(first.key.assertion(reauth.options,2)));
 assert.deepEqual(await row('SELECT revision FROM identity_attempts WHERE id=?',again.principal.attempt.id),revision);

 // Duplicate IDs roll back the receipt and leave the verified enrollment intact.
 const dupIntent=addIntent(again.principal),duplicate=await addPasskeyOptions(request(),env,again.principal,dupIntent);
 await denies(()=>addPasskeyVerify(request(),env,again.principal,duplicate.challengeToken,input(first.key.registration(duplicate.options))),'identity_changed');
 assert.equal(await row('SELECT id FROM identity_ceremony_receipts WHERE id=?',dupIntent.requestId),null);
 assert.equal((await row('SELECT count(*) n FROM identity_credentials WHERE account_id=?',account)).n,2);
 const dupInvite=await invite(),dupStart=await signupOptions(request(),env,form(dupInvite));
 await denies(()=>signupVerify(request(),env,dupStart.challengeToken,input(first.key.registration(dupStart.options))),'identity_changed');
 assert.equal((await row('SELECT used_by FROM invitations WHERE code_hash=?',await hashToken(dupInvite))).used_by,null);
 assert.equal((await row('SELECT count(*) n FROM users')).n,1);

 // Two registrations compete for one invitation: only the complete winning transaction persists.
 const raceCode=await invite(),raceData=form(raceCode),a=authenticator(),b=authenticator();
 const [oa,ob]=await Promise.all([signupOptions(request(),env,raceData),signupOptions(request(),env,{...raceData,email:id()+'@example.invalid'})]);
 const race=await Promise.allSettled([signupVerify(request(),env,oa.challengeToken,input(a.registration(oa.options))),signupVerify(request(),env,ob.challengeToken,input(b.registration(ob.options)))]);
 assert.equal(race.filter(r=>r.status==='fulfilled').length,1);assert.equal((await row('SELECT count(*) n FROM users')).n,2);cases++;
 const expiredInvite=await invite(),expired=await signupOptions(request(),env,form(expiredInvite)),expiredKey=authenticator();
 await run("UPDATE invitations SET expires_at='2000-01-01T00:00:00.000Z' WHERE code_hash=?",await hashToken(expiredInvite));
 await denies(()=>signupVerify(request(),env,expired.challengeToken,input(expiredKey.registration(expired.options))),'identity_changed');
 assert.equal((await row('SELECT count(*) n FROM users')).n,2);

 // A granted request cannot commit after its proof or identity changes during cryptographic work.
 const guarded=await enroll(),guardP=guarded.access.principal,guardKey=authenticator(),guardIntent=addIntent(guardP),guardOptions=await addPasskeyOptions(request(),env,guardP,guardIntent);
 beforeBatch=()=>run('DELETE FROM identity_grants WHERE id=?',guardP.authorityId);
 await denies(()=>addPasskeyVerify(request(),env,guardP,guardOptions.challengeToken,input(guardKey.registration(guardOptions.options))),'identity_changed');
 assert.equal(await row('SELECT 1 FROM identity_credentials WHERE id=?',guardKey.id),null);
 assert.equal(await row('SELECT 1 FROM identity_ceremony_receipts WHERE id=?',guardIntent.requestId),null);
 const loginRace=await loginOptions(request(),env,{version:1});
 beforeBatch=()=>run('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?',guardP.accountId);
 await denies(()=>loginVerify(request(),env,loginRace.challengeToken,input(guarded.key.assertion(loginRace.options,1))),'identity_changed');
 assert.equal((await row('SELECT counter FROM identity_credentials WHERE id=?',guarded.key.id)).counter,0);
 const deleted=await enroll(),delLogin=await loginOptions(request(),env,{version:1});
 beforeBatch=()=>run('DELETE FROM identity_credentials WHERE id=?',deleted.key.id);
 await denies(()=>loginVerify(request(),env,delLogin.challengeToken,input(deleted.key.assertion(delLogin.options,1))),'identity_changed');
 assert.equal((await row('SELECT count(*) n FROM identity_grants WHERE account_id=?',deleted.access.principal.accountId)).n,0);

 // Prepare two additions at one revision; the first commits and invalidates the other's review.
 const edits=await enroll(),editP=edits.access.principal,one=authenticator(),two=authenticator();
 const oneOpts=await addPasskeyOptions(request(),env,editP,addIntent(editP)),twoOpts=await addPasskeyOptions(request(),env,editP,addIntent(editP));
 await addPasskeyVerify(request(),env,editP,oneOpts.challengeToken,input(one.registration(oneOpts.options)));
 await denies(()=>addPasskeyVerify(request(),env,editP,twoOpts.challengeToken,input(two.registration(twoOpts.options))),'identity_changed');
 assert.equal(await row('SELECT 1 FROM identity_credentials WHERE id=?',two.id),null);
 const outside=await enroll(),outsideP=outside.access.principal,own=await addPasskeyOptions(request(),env,outsideP,addIntent(outsideP));
 await denies(async()=>addPasskeyVerify(request(),env,await current(edits.access),own.challengeToken,input(authenticator().registration(own.options))),'identity_changed');

 phase='ordinary login';
 // Ordinary login is tested with an explicitly seeded ready identity; this is not signup completion.
 const ready=await enroll(),readyId=ready.access.principal.accountId,attempt=ready.access.principal.attempt.id;
 await run("UPDATE identity_accounts SET stage='ready',current_attempt_id=NULL,kit_generation=1,kit_verifier=?,completion_receipt_id=? WHERE account_id=?",'a'.repeat(64),id(),readyId);
 await run("UPDATE identity_credentials SET status='active' WHERE account_id=?",readyId);
 await run("UPDATE identity_attempts SET status='complete',revision=revision+1 WHERE id=?",attempt);
 const ordinary=await login(ready.key,1);assert.equal(ordinary.kind,'session');await assertCurrentIdentity(db,ordinary.principal,workspace);
 const ordinaryOptions=await reauthenticationOptions(request(),env,ordinary.principal,{version:1});
 const ordinaryNew=await reauthenticationVerify(request(),env,ordinary.principal,ordinaryOptions.challengeToken,input(ready.key.assertion(ordinaryOptions.options,2,{handle:null})));
 await denies(()=>current(ordinary),'proof_required');await assertCurrentIdentity(db,ordinaryNew.principal,{...workspace,freshPasskey:true,bindIdentityRevision:true});
 const ordinaryBackup=authenticator(),ordinaryIntent=addIntent(ordinaryNew.principal),ordinaryAdd=await addPasskeyOptions(request(),env,ordinaryNew.principal,ordinaryIntent);
 await addPasskeyVerify(request(),env,ordinaryNew.principal,ordinaryAdd.challengeToken,input(ordinaryBackup.registration(ordinaryAdd.options)));
 assert.equal((await row('SELECT status FROM identity_credentials WHERE id=?',ordinaryBackup.id)).status,'active');
 let activeOrdinary=ordinaryNew;const sessionHistory=[ordinaryNew];
 for(let count=1;count<=11;count++){activeOrdinary=await login(ordinaryBackup,count);sessionHistory.push(activeOrdinary);}
 assert.equal((await row('SELECT count(*) n FROM identity_sessions WHERE account_id=?',readyId)).n,10);
 const retainedIds=new Set((await db.prepare('SELECT id FROM identity_sessions WHERE account_id=?').bind(readyId).all()).results.map(s=>s.id));
 const pruned=sessionHistory.find(s=>!retainedIds.has(s.principal.authorityId));assert(pruned);
 await denies(()=>current(pruned),'proof_required');await assertCurrentIdentity(db,activeOrdinary.principal,workspace);

 phase='recovery purpose';
 // Seed only recovery-key admission: actual secure/kit flows belong to WH-115.
 const recoveryAttempt=id(),recoveryToken=Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('hex');
 await run("INSERT INTO identity_attempts VALUES(?,?,'recovery','open',0,1,1,unixepoch())",recoveryAttempt,readyId);
 await run("INSERT INTO identity_grants VALUES(?,?,?,1,1,'web','recovery',?,'recovery-key',unixepoch(),0,NULL,1,unixepoch(),unixepoch()+1800)",id(),await hashToken(recoveryToken),readyId,recoveryAttempt);
 const recoveryAccess={kind:'grant',token:recoveryToken},recoveryP=await current(recoveryAccess);
 await denies(()=>addPasskeyOptions(request(),env,recoveryP,addIntent(recoveryP)),'identity_changed');
 const recoveryReauth=await reauthenticationOptions(request(),env,recoveryP,{version:1});
 const recoveryFresh=await reauthenticationVerify(request(),env,recoveryP,recoveryReauth.challengeToken,input(ready.key.assertion(recoveryReauth.options,3)));
 assert.equal(recoveryFresh.kind,'grant');assert.equal(recoveryFresh.principal.purpose,'recovery');assert.equal(recoveryFresh.principal.attempt.id,recoveryAttempt);
 await denies(()=>assertCurrentIdentity(db,recoveryFresh.principal,workspace),'identity_incomplete');
 await assertCurrentIdentity(db,await current(activeOrdinary),workspace);
 await run("UPDATE identity_accounts SET stage='recovering',current_attempt_id=?,auth_epoch=2,kit_generation=2,kit_verifier=? WHERE account_id=?",recoveryAttempt,'b'.repeat(64),readyId);
 await run("UPDATE identity_attempts SET status='secured',auth_epoch=2,kit_generation=2,revision=revision+1 WHERE id=?",recoveryAttempt);
 await denies(()=>current(activeOrdinary),'proof_required');
 const retainedLogin=await login(ready.key,4);assert.equal(retainedLogin.kind,'grant');assert.equal(retainedLogin.principal.purpose,'recovery');
 assert.deepEqual(await addPasskeyOptions(request(),env,retainedLogin.principal,ordinaryIntent),{completed:{operationId:ordinaryIntent.requestId,credentialId:ordinaryBackup.id}});
 const replacement=authenticator(),replacementOptions=await addPasskeyOptions(request(),env,retainedLogin.principal,addIntent(retainedLogin.principal));
 await addPasskeyVerify(request(),env,retainedLogin.principal,replacementOptions.challengeToken,input(replacement.registration(replacementOptions.options)));
 const replacementLogin=await login(replacement,1);assert.equal(replacementLogin.kind,'grant');assert.equal(replacementLogin.principal.attempt.id,recoveryAttempt);
 await denies(()=>assertCurrentIdentity(db,replacementLogin.principal,workspace),'identity_incomplete');
 for(let n=(await row('SELECT count(*) n FROM identity_grants WHERE account_id=?',readyId)).n;n<20;n++){
  await run('INSERT INTO identity_grants SELECT ?,?,account_id,policy_version,auth_epoch,client,purpose,attempt_id,proof_method,proof_at,proof_revision,credential_id,kit_generation,issued_at,expires_at FROM identity_grants WHERE id=?',id(),await hashToken(id()),replacementLogin.principal.authorityId);
 }
 const capOptions=await reauthenticationOptions(request(),env,replacementLogin.principal,{version:1});
 const capRenewal=await reauthenticationVerify(request(),env,replacementLogin.principal,capOptions.challengeToken,input(replacement.assertion(capOptions.options,2)));
 assert.equal(capRenewal.kind,'grant');assert.equal((await row('SELECT count(*) n FROM identity_grants WHERE account_id=?',readyId)).n,20);
 await denies(()=>current(replacementLogin),'proof_required');

 phase='expiry and rollback';
 // Recreate a fixture's immutable challenge at its exact expiry boundary.
 const expireOptions=await loginOptions(request(),env,{version:1});
 const expiredChallenge={...await row('DELETE FROM identity_challenges WHERE token_hash=? RETURNING *',await hashToken(expireOptions.challengeToken))};
 const dbNow=(await row('SELECT unixepoch() AS n')).n;expiredChallenge.created_at=dbNow-300;expiredChallenge.expires_at=dbNow;
 await run(`INSERT INTO identity_challenges(${Object.keys(expiredChallenge).join(',')}) VALUES(${Object.keys(expiredChallenge).map(()=>'?').join(',')})`,...Object.values(expiredChallenge));
 await denies(()=>loginVerify(request(),env,expireOptions.challengeToken,input(replacement.assertion(expireOptions.options,3))),'proof_required');
 assert.equal(await row('SELECT 1 FROM identity_challenges WHERE id=?',expiredChallenge.id),null);
 const rollbackCode=await invite(),rollbackOptions=await signupOptions(request(),env,form(rollbackCode)),rollbackKey=authenticator();
 await run("CREATE TRIGGER test_grant_failure BEFORE INSERT ON identity_grants BEGIN SELECT RAISE(ABORT,'synthetic_grant_failure'); END");
 await denies(()=>signupVerify(request(),env,rollbackOptions.challengeToken,input(rollbackKey.registration(rollbackOptions.options))),'identity_unavailable');
 await run('DROP TRIGGER test_grant_failure');
 assert.equal((await row('SELECT used_by FROM invitations WHERE code_hash=?',await hashToken(rollbackCode))).used_by,null);
 assert.equal(await row('SELECT 1 FROM users WHERE id=?',Buffer.from(rollbackOptions.options.user.id,'base64url').toString()),null);
 assert.equal(await row('SELECT 1 FROM identity_credentials WHERE id=?',rollbackKey.id),null);

 phase='concurrent login';
 const concurrent=await enroll(),concurrentOptions=await Promise.all([loginOptions(request(),env,{version:1}),loginOptions(request(),env,{version:1})]);
 const concurrentResults=await Promise.allSettled(concurrentOptions.map(opt=>loginVerify(request(),env,opt.challengeToken,input(concurrent.key.assertion(opt.options,1)))));
 assert.equal(concurrentResults.filter(r=>r.status==='fulfilled').length,1);cases++;
 assert.equal((await row('SELECT counter FROM identity_credentials WHERE id=?',concurrent.key.id)).counter,1);

 // Cleanup discards expired proof, never an abandoned account's verified keys or progress.
 const pending=await enroll(),pendingId=pending.access.principal.accountId;
 const oldGrant={...await row('SELECT * FROM identity_grants WHERE id=?',pending.access.principal.authorityId)};
 await run('DELETE FROM identity_grants WHERE id=?',oldGrant.id);
 await run("INSERT INTO identity_grants SELECT ?,?,?,1,1,'web','enrollment',?,'registration',unixepoch()-2000,?,?,NULL,unixepoch()-2000,unixepoch()-200",oldGrant.id,oldGrant.token_hash,pendingId,oldGrant.attempt_id,oldGrant.proof_revision,pending.key.id);
 await cleanIdentityCeremonies(db);assert.equal(await row('SELECT 1 FROM identity_grants WHERE id=?',oldGrant.id),null);
 assert(await row('SELECT 1 FROM identity_credentials WHERE id=?',pending.key.id));assert(await row('SELECT 1 FROM identity_attempts WHERE id=?',oldGrant.attempt_id));
 const recoveredProgress=await login(pending.key,1);assert.equal(recoveredProgress.kind,'grant');
 const spent=await enroll(),spentHash=await hashToken(spent.data.inviteCode);
 await run('DELETE FROM users WHERE id=?',spent.access.principal.accountId);
 assert.equal((await row('SELECT used_by FROM invitations WHERE code_hash=?',spentHash)).used_by,null);
 assert.notEqual((await row('SELECT used_at FROM invitations WHERE code_hash=?',spentHash)).used_at,null);
 await assert.rejects(run('UPDATE invitations SET used_at=NULL WHERE code_hash=?',spentHash),/invitation_spent_immutable/);
 await denies(()=>signupOptions(request(),env,spent.data),'proof_required');
 await denies(()=>login(spent.key,1),'proof_required');
 phase='account quota';
 const quotaCode=await invite(),quotaOptions=await signupOptions(request(),env,form(quotaCode)),quotaKey=authenticator();
 for(let n=(await row('SELECT count(*) n FROM users')).n;n<50;n++)await run("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",id(),id()+'@example.invalid');
 await denies(()=>signupVerify(request(),env,quotaOptions.challengeToken,input(quotaKey.registration(quotaOptions.options))),'identity_changed');
 assert.equal((await row('SELECT used_by FROM invitations WHERE code_hash=?',await hashToken(quotaCode))).used_by,null);
 assert.equal((await row('SELECT count(*) n FROM users')).n,50);
 assert(turnstileCalls>0);
 console.log(`identity-ceremonies: ${cases} refusal/race checks plus cryptographic signup, resumption, additions, receipt readback, reauthentication and current login passed (${process.argv.includes('--d1')?'local D1':'SQLite'})`);
}catch(error){console.error(phase,error.name,error.message);process.exitCode=1;}finally{globalThis.fetch=originalFetch;await fixture.close();}
