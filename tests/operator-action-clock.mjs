// WH-050 operator action identity across the real 90-day retention, end to end, on a test-only SQLite clock.
// The actual operator tool (tools/operator-containment-input.mjs, inputs parsed by containmentInput) applies a containment, a
// session revocation and cleanup receipts to the complete current schema at past instants; later cleanups purge them; then every
// cleaned id is proposed again through the tool and, directly, at the schema. No id or timestamp is ever rewritten after the
// fact: each action is minted and stamped for the moment it was applied.
// The clock is the shim in helpers/sqlite-clock.mjs (text-level, tests only, system clock untouched). Only the identity account,
// session, project and user rows are synthetic fixtures; every action row is written by the tool. SQLite only: the actual local
// D1 runs the same triggers on its real clock in `operator-containment.mjs --d1` and `operator-session-revocation.mjs --d1`.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {sqliteClockD1} from './helpers/sqlite-clock.mjs';
import {runContainment,containmentInput,containmentDigest,retentionMs,actionIdTime,newActionId} from '../tools/operator-containment-input.mjs';
if(process.argv.length>2)throw Error('Unsupported argument: the clock shim exists for SQLite only');
const day=86400000,hour=3600000,OPERATOR='human:CLOCK-OPERATOR-CANARY',REASON='CLOCK-REASON-CANARY clock-shim test',staleId=/new UUIDv7 minted within the last day/;
const t0=Date.now()-320*day,s=await sqliteClockD1(t0),db=s.db,iso=ms=>new Date(ms).toISOString(),uuid=()=>crypto.randomUUID();
const run=(sql,...values)=>db.prepare(sql).bind(...values).run(),row=(sql,...values)=>db.prepare(sql).bind(...values).first();
// The real tool at the shim clock's current instant, with its input parsed by the real input contract.
const op=(input,apply)=>runContainment(db,containmentInput(JSON.stringify(input)),apply,s.clock.ms);
const apply=async input=>{const preview=await op(input);assert.equal(preview.preview,true);return {preview,applied:await op(input,preview.applyDigest)};};
const at=ms=>{assert.ok(ms>=s.clock.ms,'The shim clock only moves forward');s.at(ms);return ms;};
const exists=async(table,rid)=>(await row(`SELECT count(*) n FROM ${table} WHERE id=?`,rid)).n>0;
const containmentRow=(rid,project,expires)=>run("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'photo','project',?,NULL,'human:x','r',?,?)",rid,project,'f'.repeat(64),expires);
const forgeRevocation=async(rid,account)=>{const st=await row('SELECT auth_epoch,credential_revision FROM identity_accounts WHERE account_id=?',account),ids=(await row('SELECT json_group_array(id) ids FROM (SELECT id FROM identity_sessions WHERE account_id=? ORDER BY id)',account)).ids;
 return run('INSERT INTO operator_session_revocations(id,account_id,auth_epoch,credential_revision,sessions,operator_ref,reason,request_digest,review_digest) VALUES(?,?,?,?,?,?,?,?,?)',rid,account,st.auth_epoch,st.credential_revision,ids,'human:x','r','a'.repeat(64),'b'.repeat(64));};
const forgeReceipt=(rid,listed)=>run("INSERT INTO operator_retention_receipts(id,cutoff,containments,revocations,receipts,operator_ref,request_digest,review_digest) VALUES(?,?,?,'[]','[]','human:x',?,?)",rid,iso(s.clock.ms-retentionMs),JSON.stringify(listed),'a'.repeat(64),'b'.repeat(64));
// Synthetic identity rows (the tool only reads them): one account with a credential, and a session issued at the shim's instant.
async function account(){
 const a=uuid();
 await run('INSERT INTO users(id,email,created_at) VALUES(?,?,?)',a,a+'@example.invalid',iso(s.clock.ms));
 await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)",a,'a'.repeat(64),uuid());
 const credential=uuid();await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic passkey','active',NULL,unixepoch(),NULL)",credential,a,new Uint8Array([1,2,3]));
 return {a,credential};
}
const session=({a,credential})=>run("INSERT INTO identity_sessions VALUES(?,?,?,1,1,'web',?,'passkey',unixepoch()-5,unixepoch(),unixepoch()+3600)",uuid(),randomBytes(32).toString('hex'),a,credential);
const sessions=a=>row('SELECT count(*) n FROM identity_sessions WHERE account_id=?',a).then(r=>r.n);
async function project(owner){const p=uuid();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Clock fixture','Testing','draft',?,?)",p,owner,iso(s.clock.ms),iso(s.clock.ms));return p;}
let groups=0;
try{
 // ---- Day 0: the tool applies a project freeze and, for an account with two sessions, a session revocation.
 const owner=await account(),p1=await project(owner.a);await session(owner);await session(owner);
 const idC=newActionId(at(t0)),contain={action:'contain',id:idC,subject:{kind:'project',id:p1},scopes:{photo:'freeze'},expiresAt:iso(t0+2*hour),operator:OPERATOR,reason:REASON};
 assert.equal((await apply(contain)).applied.applied,true);
 const idR=newActionId(s.clock.ms),revoke={action:'revoke-sessions',id:idR,account:owner.a,operator:OPERATOR,reason:REASON};
 assert.equal((await apply(revoke)).applied.revocation.revokedSessions,2);assert.equal(await sessions(owner.a),0);
 // The database clock really is the shim's: the stored times are the instant the tool applied them, and the ids carry that instant.
 for(const [table,rid] of [['operator_containments',idC],['operator_session_revocations',idR]]){
  const stored=await row(`SELECT created_at FROM ${table} WHERE id=?`,rid);assert.ok(Math.abs(Date.parse(stored.created_at)-t0)<2000,`${table} created_at ${stored.created_at} vs ${iso(t0)}`);assert.ok(Math.abs(actionIdTime(rid)-t0)<2000);}
 groups++;
 // ---- One hour later: lift. Then day 100: the first cleanup (K1), by the tool, with the reviewed state.
 at(t0+hour);const lift={action:'lift',id:idC,operator:OPERATOR,reason:'Reviewed'};await apply(lift);
 assert.equal((await op({action:'status',subject:{kind:'project',id:p1}})).containments.find(r=>r.id===idC).state,'lifted');
 const t1=at(t0+100*day),idK1=newActionId(t1),k1={action:'cleanup',id:idK1,before:iso(t1-retentionMs),operator:OPERATOR},k1Run=await apply(k1);
 assert.deepEqual(k1Run.applied.receipt.deleted,{containments:1,revocations:1,receipts:0});
 assert.equal(await exists('operator_containments',idC),false);assert.equal(await exists('operator_session_revocations',idR),false);assert.equal(await exists('operator_retention_receipts',idK1),true);
 groups++;
 // ---- Right after: all three cleaned ids are refused for good, while each fresh id with the same everything is accepted.
 // Containment: tool and schema (the schema refuses even a request the tool is never asked to review).
 const reborn={...contain,expiresAt:iso(t1+2*hour)};
 for(const withApply of [undefined,containmentDigest(containmentInput(JSON.stringify(reborn)))])await assert.rejects(op(reborn,withApply),staleId);
 await assert.rejects(containmentRow(idC,p1,iso(t1+2*hour)),/operator_containment_invalid/);assert.equal(await exists('operator_containments',idC),false);
 // Revocation: a new session exists, so the reviewed state is current; the cleaned id is still refused.
 await session(owner);
 for(const withApply of [undefined,'f'.repeat(64)])await assert.rejects(op(revoke,withApply),staleId);
 await assert.rejects(forgeRevocation(idR,owner.a),/operator_revocation_invalid/);assert.equal(await sessions(owner.a),1,'The reuse attempts revoked nothing');
 // Cleanup receipt: the stored K1 still answers an exact replay (even the same instant); a different request under it is "already used".
 assert.equal((await op(k1,k1Run.preview.applyDigest)).replayed,true);assert.equal((await op(k1)).alreadyApplied,true);
 await assert.rejects(op({...k1,before:iso(t1-retentionMs-day)}),/already used/);
 groups++;
 // ---- Fresh ids work: a new containment (applied then lifted) that a later cleanup will purge, and a new revocation.
 const idD=newActionId(at(t1+hour)),second={...contain,id:idD,expiresAt:iso(t1+3*hour)};await apply(second);
 at(t1+2*hour);await apply({action:'lift',id:idD,operator:OPERATOR,reason:'Reviewed'});
 const idR2=newActionId(at(t1+3*hour)),revoke2={...revoke,id:idR2};assert.equal((await apply(revoke2)).applied.revocation.revokedSessions,1);
 // E: resolved long after cleanup K2's cutoff, so K2 will not list it although it is eligible by day 100 + 5 days.
 await session(owner);const idE=newActionId(at(t1+5*day)),third={...contain,id:idE,expiresAt:iso(t1+5*day+2*hour)};await apply(third);
 at(t1+5*day+hour);await apply({action:'lift',id:idE,operator:OPERATOR,reason:'Reviewed'});
 groups++;
 // ---- Day 200: the second cleanup (K2) purges D, R2 and the first cleanup receipt K1 itself, by the tool.
 const t2=at(t1+100*day),idK2=newActionId(t2),k2={action:'cleanup',id:idK2,before:iso(t1+day),operator:OPERATOR},k2Run=await apply(k2);
 assert.deepEqual(k2Run.applied.receipt.deleted,{containments:1,revocations:1,receipts:1});
 assert.equal(await exists('operator_retention_receipts',idK1),false,'The first cleanup receipt was purged by the second');
 for(const rid of [idD]) assert.equal(await exists('operator_containments',rid),false);assert.equal(await exists('operator_session_revocations',idR2),false);
 assert.equal(await exists('operator_containments',idE),true,'E is eligible but was not listed by K2');
 groups++;
 // ---- Every cleaned id (containment C and D, revocation R and R2, receipt K1) is now refused by the tool and the schema.
 // The exact K1 request with the review it was applied under cannot repeat: no receipt answers it and its id is 100 days old.
 await assert.rejects(op(k1,k1Run.preview.applyDigest),staleId);await assert.rejects(op(k1),staleId);
 assert.equal(await exists('operator_retention_receipts',idK1),false);assert.equal(await exists('operator_containments',idE),true,'The refused replay deleted nothing');
 await assert.rejects(forgeReceipt(idK1,[idE+':photo']),/operator_retention_invalid/,'A valid, eligible record listed under the purged receipt id');
 assert.equal(await exists('operator_containments',idE),true);assert.equal(await exists('operator_retention_receipts',idK1),false);
 for(const rid of [idC,idD]){await assert.rejects(op({...contain,id:rid,expiresAt:iso(t2+2*hour)}),staleId);await assert.rejects(containmentRow(rid,p1,iso(t2+2*hour)),/operator_containment_invalid/);assert.equal(await exists('operator_containments',rid),false);}
 await session(owner);const live=await sessions(owner.a);
 for(const rid of [idR,idR2]){await assert.rejects(op({...revoke,id:rid}),staleId);await assert.rejects(forgeRevocation(rid,owner.a),/operator_revocation_invalid/);assert.equal(await exists('operator_session_revocations',rid),false);}
 assert.equal(await sessions(owner.a),live,'Nothing was revoked by the reuse attempts');
 groups++;
 // ---- The ids were the only cause: fresh ids with the same subject, scope, expiry and listed record are accepted by the tool.
 await apply({...contain,id:newActionId(t2),expiresAt:iso(t2+2*hour)});
 assert.equal((await apply({...revoke,id:newActionId(t2)})).applied.revocation.revokedSessions,live);
 const k3=await apply({action:'cleanup',id:newActionId(t2),before:iso(t2-retentionMs),operator:OPERATOR});assert.equal(k3.applied.receipt.deleted.containments,1);assert.equal(await exists('operator_containments',idE),false);
 groups++;
 // ---- Replay of an applied action keeps working for its whole retention however old its id: K2 is a day old here, and 89 days on.
 assert.equal((await op(k2,k2Run.preview.applyDigest)).replayed,true);
 at(t2+89*day);assert.equal((await op(k2,k2Run.preview.applyDigest)).replayed,true);assert.equal((await op(k2)).alreadyApplied,true);
 assert.ok(s.clock.ms-actionIdTime(idK2)>day,'K2 replays from its stored row although its id is older than the window');
 await assert.rejects(op({...k2,before:iso(t1+2*day)}),/already used/);groups++;
 console.log(`Operator action clock passed on SQLite with a test-only clock shim: ${groups} groups — the actual tool applied a containment, a session revocation and cleanup receipts at past instants (ids minted and stamped for their own moment, never rewritten), later cleanups purged them, and every cleaned containment, revocation and receipt id was refused for good by the tool and the schema while fresh ids with the same subject, scope, expiry and listed record were accepted; replay of an applied receipt kept working through its retention.`);
}finally{s.close();}
