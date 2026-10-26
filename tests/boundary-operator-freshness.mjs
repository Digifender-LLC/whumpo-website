// WH-004 slice 7 regression: the operator safety-case commit re-checks the identity inside its own SQL. Local SQLite
// (default) or local D1 (`--d1`); synthetic accounts, no network.
// Closes the evidence gap recorded in docs/boundary-audit.json (operator surface, freshness cell): "checked before the
// action and again in the committing SQL (the in-SQL recheck path itself is untested)".
// The pre-check in src/safety-cases.ts attempt() passes, then, immediately before the committing batch, the session is
//   1. revoked, or
//   2. aged past the ten-minute passkey window (by waiting, never by editing the recorded proof time).
// Either way the batch must commit nothing and audit the refusal. A negative control commits through the same interception.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession,interceptDatabase} from './helpers/workspace-identity.mjs';

const built=await build({stdin:{contents:"export * as cases from './src/safety-cases.ts';export {newSessionToken,hashToken} from './src/security.ts';export {resolveIdentity,IdentityError} from './src/workspace-identity/authority.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')),{cases:c}=m;
const store=await databaseFixture(),db=store.db;
const row=(q,...p)=>db.prepare(q).bind(...p).first();
const count=async(table,where,...p)=>Number((await row(`SELECT count(*) AS n FROM ${table} WHERE ${where}`,...p)).n);
const lastAudit=async()=>({...await row('SELECT actor_ref AS actor,action,case_id AS caseId,outcome,reason FROM safety_case_audit ORDER BY seq DESC LIMIT 1')});
const principal=(database,token)=>m.resolveIdentity(database,{version:1,client:'web',kind:'session',token});
// Only the committing audit statement (`... SELECT unixepoch(), ...`) matches; the pre-commit refusal record uses VALUES.
const commit=/INSERT INTO safety_case_audit\([^)]*\) SELECT/;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 const admin=await workspaceFixture(db,m),reviewer=await workspaceFixture(db,m),ref='human:'+reviewer.account;
 await c.bootstrapSafetyRoleAdministrator(db,{grantId:'grant-admin',accountId:admin.account});
 await c.grantSafetyCaseRole(db,await principal(db,admin.token),{grantId:'grant-reviewer',operatorAccountId:reviewer.account,role:'case_reviewer'});
 const subject=crypto.randomUUID();
 await db.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-20')").bind(subject,subject+'@example.invalid').run();
 const open=(database,p,caseId)=>c.openSafetyCase(database,p,{caseId,subjectUserId:subject,intakeRef:'intake-'+caseId});
 const committed=async caseId=>({cases:await count('safety_cases','id=?',caseId),findings:await count('safety_case_findings','case_id=?',caseId)});
 const changed=e=>e instanceof m.IdentityError&&e.code==='identity_changed'&&e.status===409;

 // 1. Revoked between the pre-check and the commit.
 {
  const session=await workspaceSession(db,m,{account:reviewer.account,credential:reviewer.credential});
  let reached=0;
  const gated=interceptDatabase(db,commit,async()=>{reached++;await session.revoke();});
  await assert.rejects(async()=>open(gated,await principal(gated,session.token),'case-revoked'),changed,'a session revoked after admission cannot commit');
  assert.equal(reached,1,'the pre-check admitted the request and the commit was reached');
  assert.deepEqual(await committed('case-revoked'),{cases:0,findings:0},'nothing was committed');
  assert.deepEqual(await lastAudit(),{actor:ref,action:'open_case',caseId:'case-revoked',outcome:'denied',reason:'unauthenticated'});
 }

 // 2. Aged past ten minutes between the pre-check and the commit. The proof starts 595 seconds old; the hook waits on the
 // database clock until it is at least 600 seconds old, so the pre-check (fresh) and the commit (stale) disagree.
 {
  const session=await workspaceSession(db,m,{account:reviewer.account,credential:reviewer.credential},-595);
  let reached=0,proofAt=null;
  const gated=interceptDatabase(db,commit,async()=>{
   reached++;
   for(const deadline=Date.now()+20000;Number((await row('SELECT unixepoch()-? AS n',proofAt)).n)<600;await pause(100))
    if(Date.now()>deadline)throw Error('the proof did not age within 20 seconds');
  });
  const p=await principal(gated,session.token);proofAt=p.proof.verifiedAt;
  await assert.rejects(()=>open(gated,p,'case-aged'),e=>{
   assert.equal(reached,1,`the pre-check must admit the still-fresh proof (got ${e?.code??e}); rerun if this host stalled for 5 seconds`);
   return changed(e);
  },'a proof that ages past ten minutes after admission cannot commit');
  assert.deepEqual(await committed('case-aged'),{cases:0,findings:0},'nothing was committed');
  assert.deepEqual(await lastAudit(),{actor:ref,action:'open_case',caseId:'case-aged',outcome:'denied',reason:'unauthenticated'});
  assert.equal(await count('identity_sessions','id=?',session.authority),1,'the session was aged, not revoked');
  // The same session, now stale, is refused by the pre-check as well (proof_required, not identity_changed).
  await assert.rejects(()=>open(db,p,'case-aged'),e=>e instanceof m.IdentityError&&e.code==='proof_required');
 }

 // Negative control: the same interception with a fresh, unrevoked session commits.
 {
  const session=await workspaceSession(db,m,{account:reviewer.account,credential:reviewer.credential});
  let reached=0;
  const gated=interceptDatabase(db,commit,async()=>{reached++;});
  await open(gated,await principal(gated,session.token),'case-control');
  assert.equal(reached,1);
  assert.deepEqual(await committed('case-control'),{cases:1,findings:1},'negative control: the case and its first finding were committed');
  assert.deepEqual(await lastAudit(),{actor:ref,action:'open_case',caseId:'case-control',outcome:'allowed',reason:'ok'});
 }
 console.log('Operator freshness: a safety-case commit whose session is revoked, or whose passkey proof ages past ten minutes, after the pre-check commits nothing, answers 409 identity_changed and audits denied/unauthenticated (positive control commits through the same interception).');
}catch(error){console.error(String(error?.stack??error).split('\n').filter(line=>!line.includes('data:text/javascript')).join('\n'));process.exitCode=1;}
finally{await store.close?.();}
