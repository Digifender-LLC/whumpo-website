// WH-050 operator workspace session revocation (owner decision October 8, 2026): exact reviewed identity state, atomic
// audit receipt, old sessions denied, new passkey sign-in and recovery kept, tenant isolation and 90-day retention.
// Actual platform identity handler and complete current schema with independently signed ES256 credentials, on
// disposable SQLite or actual local D1 with --d1. No network, provider, deployed resource or real credential.
import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
import {interceptDatabase} from './helpers/workspace-identity.mjs';
import {runContainment,containmentInput,containmentDigest,retentionMs,actionIdTime} from '../tools/operator-containment-input.mjs';
import {newActionId,actionIdAged,withoutTriggers,windowIds} from './helpers/operator-action-ids.mjs';
const built=await build({stdin:{contents:"export {default as worker} from './src/index';export * from './src/workspace-identity/http';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false,logLevel:'silent'});
const {worker,identityCookies,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture(),db=fixture.db,originalFetch=globalThis.fetch,originalEqual=crypto.subtle.timingSafeEqual;
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
globalThis.fetch=async()=>Response.json({success:true,hostname:'whumpo.com',action:'register'});
const env={DB:db,ENVIRONMENT:'test',TURNSTILE_SECRET:'synthetic-only',TURNSTILE_SITE_KEY:'synthetic-public',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
const handle=request=>worker.fetch(request,env,{waitUntil:()=>{}});
// `id` is for ordinary ids; every operator action id is a UUIDv7 minted for its moment (`aid`).
const base='https://whumpo.com/api/auth/identity/v1/',id=()=>crypto.randomUUID(),aid=()=>newActionId(),run=(sql,...values)=>db.prepare(sql).bind(...values).run(),row=(sql,...values)=>db.prepare(sql).bind(...values).first();
const counters=new Map();// WebAuthn signature counters are per authenticator, shared by every browser that uses it.
class Browser{
 cookies=new Map();
 header(){return [...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')}
 async call(action,data={version:1}){
  const response=await handle(new Request(base+action,{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json',cookie:this.header()},body:JSON.stringify(data)}));
  for(const cookie of response.headers.getSetCookie()){const [pair]=cookie.split(';'),[name,value]=pair.split('=');if(value)this.cookies.set(name,value);else this.cookies.delete(name);}
  return {status:response.status,data:await response.json()};
 }
 async ok(action,data){const r=await this.call(action,data);assert.equal(r.status,200,`${action}: ${r.data.error}`);return r.data}
 async state(){return (await this.ok('state')).identity}
 intent(s){return {version:1,requestId:id(),attemptId:s.attemptId,expectedRevision:s.expectedRevision,expectedEpoch:s.expectedEpoch}}
 async assertion(action,key,data){const opts=await this.ok(action+'/options',data),counter=(counters.get(key.id)??0)+1;counters.set(key.id,counter);return this.ok(action+'/verify',{version:1,credential:key.assertion(opts.options,counter)})}
 async add(name='Second passkey'){const s=await this.state(),opts=await this.ok('add/options',{version:1,requestId:id(),attemptId:s.attemptId,expectedRevision:s.expectedRevision,name}),key=authenticator();await this.ok('add/verify',{version:1,credential:key.registration(opts.options)});return key}
 async kit(){const s=await this.state(),kit=await this.ok('kit/prepare',this.intent(s)),saved=await this.state();await this.ok('kit/save',{...this.intent(saved),offerId:kit.offer.id,generation:kit.offer.generation,saved:true});return kit}
 profile(){return handle(new Request('https://whumpo.com/api/profile',{headers:{cookie:this.header(),origin:'https://whumpo.com'}}))}
}
async function ready(){
 const b=new Browser(),code=id(),email=id()+'@example.invalid';
 await run("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)",await hashToken(code));
 const opts=await b.ok('signup/options',{version:1,email,inviteCode:code,usBased:true,turnstileToken:id()}),first=authenticator();await b.ok('signup/verify',{version:1,credential:first.registration(opts.options)});
 const second=await b.add(),kit=await b.kit();await b.assertion('reauth',second);const s=await b.state();
 await b.ok('enrollment/complete',{...b.intent(s),offerId:kit.offer.id,generation:kit.offer.generation});
 const account=(await row('SELECT id FROM users WHERE email=?',email)).id;
 return {b,email,first,second,kit,account};
}
const OPERATOR='human:PRIVATE-OPERATOR-CANARY',REASON='PRIVATE-REASON-CANARY stolen session report';
const identity=account=>row(`SELECT a.stage,a.auth_epoch,a.credential_revision,a.kit_generation,a.kit_verifier,(SELECT count(*) FROM identity_credentials WHERE account_id=a.account_id) credentials,
 (SELECT count(*) FROM identity_grants WHERE account_id=a.account_id) grants,(SELECT count(*) FROM identity_attempts WHERE account_id=a.account_id) attempts,(SELECT count(*) FROM identity_sessions WHERE account_id=a.account_id) sessions FROM identity_accounts a WHERE a.account_id=?`,account);
let cases=0;
try{
 const a=await ready(),other=await ready();
 // A second signed-in device, and a recovery already in progress on a third: both must be handled exactly.
 const phone=new Browser();await phone.assertion('login',a.second);assert.equal((await phone.profile()).status,200);
 const recovering=new Browser();await recovering.ok('recovery/start',{version:1,email:a.email,key:a.kit.key});assert.equal((await recovering.state()).purpose,'recovery');
 assert.equal((await a.b.profile()).status,200);
 const revoke={action:'revoke-sessions',id:aid(),account:a.account,operator:OPERATOR,reason:REASON};
 for(const bad of [{...revoke,id:crypto.randomUUID()},{...revoke,id:revoke.id.toUpperCase()},{...revoke,account:'x'},{...revoke,sessions:[]},{...revoke,operator:'has space'},{...revoke,reason:''}])assert.throws(()=>containmentInput(JSON.stringify(bad)),/Invalid operator containment request/);cases++;
 await assert.rejects(runContainment(db,{...revoke,account:id()}),/Subject not found/);cases++;

 // Preview writes nothing and reports what is preserved.
 const before=await identity(a.account),preview=await runContainment(db,revoke);
 assert.equal(preview.state.sessions,2);assert.deepEqual(preview.preserved,{passkeys:2,pendingEnrollmentOrRecoveryGrants:1,kitGeneration:before.kit_generation});
 assert.equal((await identity(a.account)).sessions,2);assert.equal((await row('SELECT count(*) n FROM operator_session_revocations')).n,0);cases++;
 // Stale review: a new sign-in after preview changes the reviewed session set.
 const laptop=new Browser();await laptop.assertion('login',a.first);
 await assert.rejects(runContainment(db,revoke,preview.applyDigest),/Review is stale or differs/);cases++;
 // Racing review: a sign-in between the final read and the write is refused by the receipt's own trigger.
 const racePreview=await runContainment(db,revoke),tablet=new Browser();
 await assert.rejects(runContainment(interceptDatabase(db,/INSERT INTO operator_session_revocations/,()=>tablet.assertion('login',a.second)),revoke,racePreview.applyDigest),/Review is stale; account sessions or passkeys changed/);
 assert.equal((await identity(a.account)).sessions,4,'A refused revocation deletes nothing');assert.equal((await row('SELECT count(*) n FROM operator_session_revocations')).n,0);cases++;
 // The trigger also refuses a forged receipt naming a different session set or epoch.
 const ids=(await row('SELECT json_group_array(id) ids FROM (SELECT id FROM identity_sessions WHERE account_id=? ORDER BY id)',a.account)).ids;
 for(const [epoch,sessions] of [[before.auth_epoch+1,ids],[before.auth_epoch,JSON.stringify(JSON.parse(ids).slice(1))]])
  await assert.rejects(run('INSERT INTO operator_session_revocations(id,account_id,auth_epoch,credential_revision,sessions,operator_ref,reason,request_digest,review_digest) VALUES(?,?,?,?,?,?,?,?,?)',aid(),a.account,epoch,before.credential_revision,sessions,'human:x','r','a'.repeat(64),'b'.repeat(64)),/operator_revocation_stale/);cases++;

 // Apply with the exact current review: every listed session is deleted in the receipt's own statement.
 const exact=await runContainment(db,revoke);const applied=await runContainment(db,revoke,exact.applyDigest);
 assert.equal(applied.applied,true);assert.equal(applied.revocation.revokedSessions,4);assert.equal(applied.revocation.state,'completed');
 const after=await identity(a.account);assert.equal(after.sessions,0);
 for(const k of ['stage','auth_epoch','credential_revision','kit_generation','kit_verifier','credentials','grants','attempts'])assert.equal(after[k],before[k],k+' is preserved');cases++;
 // Old sessions are denied with the ordinary signed-out response; nothing about the operator is disclosed.
 for(const browser of [a.b,phone,laptop,tablet]){const p=await browser.profile();assert.equal(p.status,401);const text=await p.text();for(const marker of ['PRIVATE','operator','revok'])assert.ok(!text.includes(marker),text);
  const s=await browser.call('state');assert.equal(s.status,401);assert.equal(s.data.code,'proof_required');}cases++;
 // Recovery in progress continues, and a fresh recovery with the saved kit still starts.
 assert.equal((await recovering.state()).purpose,'recovery');const fresh=new Browser();await fresh.ok('recovery/start',{version:1,email:a.email,key:a.kit.key});assert.equal((await fresh.state()).purpose,'recovery');cases++;
 // New ordinary sign-in with a current passkey works immediately.
 const again=new Browser();await again.assertion('login',a.first);assert.equal((await again.profile()).status,200);assert.equal((await again.state()).purpose,'workspace');cases++;
 // Tenant isolation: the other account's session is untouched.
 assert.equal((await other.b.profile()).status,200);assert.equal((await identity(other.account)).sessions,1);cases++;
 // Idempotent replay and ID reuse; immutable receipt; deletion refused inside retention.
 assert.equal((await runContainment(db,revoke,exact.applyDigest)).replayed,true);assert.equal((await runContainment(db,revoke)).alreadyApplied,true);
 assert.equal((await identity(a.account)).sessions,1,'Replay does not revoke the new session');
 await assert.rejects(runContainment(db,{...revoke,reason:'Other'}),/already used/);
 await assert.rejects(run("UPDATE operator_session_revocations SET reason='edited' WHERE id=?",revoke.id),/operator_revocation_immutable/);
 await assert.rejects(run('DELETE FROM operator_session_revocations WHERE id=?',revoke.id),/operator_revocation_immutable/);cases++;
 const status=await runContainment(db,{action:'status',subject:{kind:'account',id:a.account}});assert.equal(status.sessionRevocations.length,1);assert.equal(status.sessionRevocations[0].operator,OPERATOR);cases++;
 // Nothing to revoke is refused rather than recorded.
 const empty=new Browser(),code=id(),email=id()+'@example.invalid';await run("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)",await hashToken(code));
 const o=await empty.ok('signup/options',{version:1,email,inviteCode:code,usBased:true,turnstileToken:id()});await empty.ok('signup/verify',{version:1,credential:authenticator().registration(o.options)});
 await assert.rejects(runContainment(db,{...revoke,id:aid(),account:(await row('SELECT id FROM users WHERE email=?',email)).id}),/No workspace sessions to revoke/);cases++;

 // Retention: completed on application, deletable by reviewed cleanup 90 days later, never inside a safety hold.
 // Fixture history: receipts of long-past revocations, each inserted whole with an id minted for its own creation time
 // (never a young id with an aged created_at); only the admission trigger, which compares with the clock now, is skipped.
 // The listed session is long gone, so the receipt's apply trigger deletes nothing.
 const N=Date.now(),day=86400000;
 const history=async(account,createdMs)=>{const input={action:'revoke-sessions',id:newActionId(createdMs),account,operator:OPERATOR,reason:REASON};
  await withoutTriggers(db,['operator_session_revocation_admit'],()=>run('INSERT INTO operator_session_revocations(id,account_id,auth_epoch,credential_revision,sessions,operator_ref,reason,request_digest,review_digest,created_at) VALUES(?,?,1,0,?,?,?,?,?,?)',
   input.id,account,'["long-gone-session"]',OPERATOR,REASON,containmentDigest(input),'b'.repeat(64),new Date(createdMs).toISOString()));return input;};
 const agedA=await history(a.account,N-100*day),agedHeld=await history(other.account,N-100*day);
 await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES('case-wh050-revocation',?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",other.account);
 await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-wh050-revocation','case-wh050-revocation',?,'account','basis-1','human:approver',unixepoch(),unixepoch()+86400)",other.account);
 await assert.rejects(run('DELETE FROM operator_session_revocations WHERE id=?',agedHeld.id),/operator_revocation_immutable/,'Held receipts stay');
 await assert.rejects(run('DELETE FROM operator_session_revocations WHERE id=?',revoke.id),/operator_revocation_immutable/,'A receipt inside retention stays');
 const cleanup={action:'cleanup',id:aid(),before:new Date(N-retentionMs).toISOString(),operator:OPERATOR},cp=await runContainment(db,cleanup,undefined,N);
 assert.equal(cp.delete.revocations,1);assert.equal(cp.retained.revocationsRetained,2);
 assert.deepEqual((await runContainment(db,cleanup,cp.applyDigest,N)).receipt.deleted,{containments:0,revocations:1,receipts:0});
 const present=rid=>row('SELECT count(*) n FROM operator_session_revocations WHERE id=?',rid).then(r=>r.n===1);
 assert.equal(await present(agedA.id),false);assert.equal(await present(agedHeld.id),true);assert.equal(await present(revoke.id),true);cases++;
 // A cleaned id can never return: the tool refuses a new preview and apply under it, and the schema refuses a receipt that
 // names the exact current reviewed state under it (the id's own time is older than the one-day window).
 const forge=async(rid,seconds=0)=>{const st=await identity(a.account),ids=(await row('SELECT json_group_array(id) ids FROM (SELECT id FROM identity_sessions WHERE account_id=? ORDER BY id)',a.account)).ids;
  return run(`INSERT INTO operator_session_revocations(id,account_id,auth_epoch,credential_revision,sessions,operator_ref,reason,request_digest,review_digest,created_at) VALUES(?,?,?,?,?,'human:x','r',?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','${seconds} seconds'))`,rid,a.account,st.auth_epoch,st.credential_revision,ids,'a'.repeat(64),'b'.repeat(64));};
 const signIn=()=>new Browser().assertion('login',a.first),sessions=async()=>(await identity(a.account)).sessions,staleId=/new UUIDv7 minted within the last day/;
 for(const apply of [undefined,'f'.repeat(64)])await assert.rejects(runContainment(db,agedA,apply),staleId);
 assert.equal(await sessions(),1,'The current session survives the reuse attempts');
 await assert.rejects(forge(agedA.id),/operator_revocation_invalid/);assert.equal(await present(agedA.id),false);assert.equal(await sessions(),1);cases++;
 // Window edges at the schema boundary: every refused id aborts the very receipt that each accepted id records.
 const edge=windowIds();
 for(const [name,rid] of Object.entries(edge.refused)){await assert.rejects(forge(rid),/operator_revocation_invalid/,name);assert.equal(await present(rid),false,name);}
 await assert.rejects(forge(null),/operator_revocation_invalid/,'A NULL id is refused although a TEXT primary key admits it');
 // The window is the database clock's, never the receipt's created_at: a created_at at its one-minute tolerance cannot carry a later or older id.
 await assert.rejects(forge(newActionId(Date.now()+120000),55),/operator_revocation_invalid/);await assert.rejects(forge(actionIdAged(day+3600000),-55),/operator_revocation_invalid/);
 assert.equal(await sessions(),1,'Refused receipts revoke nothing');
 for(const [name,rid] of Object.entries(edge.accepted)){if(!await sessions())await signIn();await forge(rid);assert.equal(await present(rid),true,name);assert.equal(await sessions(),0,name);}
 await signIn();const tolerant=aid();await forge(tolerant,55);assert.equal(await present(tolerant),true);cases++;
 // The tool agrees: a request matching no stored receipt needs a new id, whatever the account state.
 for(const name of ['25 hours old','2 minutes ahead','epoch zero','far future'])for(const apply of [undefined,'f'.repeat(64)])await assert.rejects(runContainment(db,{...revoke,id:edge.refused[name]},apply),staleId,name);
 // Replay of an applied receipt is unaffected by the window: its stored row answers, however old the id; only a never-applied request needs a new id.
 const twoDays=2*day,appliedOld=await history(a.account,Date.now()-twoDays);
 assert.equal((await runContainment(db,appliedOld,'b'.repeat(64))).replayed,true);assert.equal((await runContainment(db,appliedOld)).alreadyApplied,true);
 await assert.rejects(runContainment(db,{...appliedOld,reason:'Another'}),/already used/);
 await assert.rejects(runContainment(db,{...appliedOld,id:newActionId(Date.now()-twoDays)}),staleId);cases++;
 console.log(`Operator session revocation passed on ${process.argv.includes('--d1')?'actual local D1':'SQLite'}: ${cases} groups — exact reviewed state with stale and racing refusal, atomic receipt and deletion, old sessions denied with the ordinary signed-out response, passkeys/kit/epoch/recovery preserved, new sign-in and recovery work, tenant isolation, idempotent replay, immutable receipt, 90-day cleanup with safety-hold retention, a cleaned revocation ID refused for good (UUIDv7 time window at the schema, fail-closed shape and NULL, created_at tolerance not usable), and replay of an applied old receipt unaffected.`);
}finally{globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await fixture.close();}
