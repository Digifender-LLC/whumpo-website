import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
// Synthetic, benign placeholders only. No real allegation, imagery, message or identity is used.
const built=await build({stdin:{contents:"export * as cases from './src/safety-cases.ts';export * as contacts from './src/contacts.ts';export * as risk from './src/content-risk-evidence.ts';export {newSessionToken,hashToken} from './src/security.ts';export {resolveIdentity,IdentityError} from './src/workspace-identity/authority.ts';export {admitWorkspace} from './src/workspace-identity/admission.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')),{cases:c,contacts,risk}=m;
const fixture=await databaseFixture(),{db}=fixture;let checks=0;
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first(),all=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results;
const count=async(table,where='1',...p)=>(await row(`SELECT count(*) AS n FROM ${table} WHERE ${where}`,...p)).n;
const refused=async(fn,reason)=>{await assert.rejects(fn,e=>e instanceof c.SafetyCaseError&&e.reason===reason,reason);checks++;};
const blocked=async(fn)=>{await assert.rejects(fn,/safety_preservation_hold/);checks++;};
const lastAudit=async()=>({...await row('SELECT actor_ref AS actor,action,case_id AS caseId,target_ref AS target,outcome,reason FROM safety_case_audit ORDER BY seq DESC LIMIT 1')});
const lastDenied=async()=>({...await row('SELECT principal_ref AS actor,action,outcome,reason FROM safety_case_denied_attempts ORDER BY seq DESC LIMIT 1')});
const MARK='SYNTHETIC-PRIVATE-MARKER';
// Operators are real ready passkey identities with fresh session proofs; actor references are derived, never declared.
const principal=(token,database=db)=>m.resolveIdentity(database,{version:1,client:'web',kind:'session',token});
async function operator(){const f=await workspaceFixture(db,m);return {id:f.account,ref:'human:'+f.account,fixture:f,p:await principal(f.token)};}
try{
 const admin=await operator(),rev=await operator(),appr=await operator(),aud=await operator(),none=await operator();
 const owner=admin.p,reviewer=rev.p,approver=appr.p,auditor=aud.p,nobody=none.p;
 assert.equal((await c.bootstrapSafetyRoleAdministrator(db,{grantId:'grant-admin',accountId:admin.id})).operatorRef,admin.ref);
 await c.bootstrapSafetyRoleAdministrator(db,{grantId:'grant-admin',accountId:admin.id});
 await refused(()=>c.bootstrapSafetyRoleAdministrator(db,{grantId:'grant-admin-2',accountId:rev.id}),'conflict');
 const a=crypto.randomUUID(),b=crypto.randomUUID(),pa=crypto.randomUUID(),pb=crypto.randomUUID();
 for(const id of [a,b])await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-04')",id,id+'@example.invalid');
 for(const [p,u] of [[pa,a],[pb,b]])await run("INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,?,'2026-10-04','2026-10-04')",p,u,MARK);
 // Seed stored submissions directly: publication/intake admission is covered by tests/contacts.mjs, not here.
 await run('DROP TRIGGER contact_submission_guard');
 for(const [id,p,expires] of [['contact-a-old',pa,'2026-01-01T00:00:00.000Z'],['contact-a-new',pa,'2999-01-01T00:00:00.000Z'],['contact-b-old',pb,'2026-01-01T00:00:00.000Z']])
  await run("INSERT INTO contact_submissions(id,project_id,settings_revision,request_hash,name,email,message,created_at,expires_at) VALUES(?,?,1,'h',?,?,?,'2026-01-01T00:00:00.000Z',?)",id,p,MARK,'v@example.invalid',MARK,expires);
 const evidence={userId:a,incidentId:'incident-1',kind:'uncertain_flag',occurredAt:Date.now()-1000,evidenceRef:'intake-1',reviewerRef:'reviewer-1'};
 await risk.recordContentRiskEvidence(db,{...evidence,id:'evidence-a1'});
 await risk.recordContentRiskEvidence(db,{...evidence,id:'evidence-a2',incidentId:'incident-2',kind:'confirmed_violation'});
 await risk.recordContentRiskEvidence(db,{...evidence,id:'evidence-b1',userId:b});

 // Role administration: named humans only, no self-grant, exact replay, audited refusal.
 for(const [id,op,role] of [['grant-1',rev,'case_reviewer'],['grant-2',appr,'preservation_approver'],['grant-3',aud,'case_auditor']]){
  await c.grantSafetyCaseRole(db,owner,{grantId:id,operatorAccountId:op.id,role});await c.grantSafetyCaseRole(db,owner,{grantId:id,operatorAccountId:op.id,role});
 }
 assert.equal(await count('safety_case_roles'),4);
 await refused(()=>c.grantSafetyCaseRole(db,owner,{grantId:'grant-1',operatorAccountId:none.id,role:'case_reviewer'}),'conflict');
 await refused(()=>c.grantSafetyCaseRole(db,owner,{grantId:'grant-self',operatorAccountId:admin.id,role:'case_reviewer'}),'not_found');
 await refused(()=>c.grantSafetyCaseRole(db,reviewer,{grantId:'grant-by-reviewer',operatorAccountId:none.id,role:'case_reviewer'}),'missing_role');
 await refused(()=>c.grantSafetyCaseRole(db,owner,{grantId:'grant-model',operatorAccountId:'model:assistant',role:'preservation_approver'}),'not_found');
 await refused(()=>c.grantSafetyCaseRole(db,owner,{grantId:'grant-x',operatorAccountId:none.id,role:'case_admin'}),'invalid_input');
 // Declared references are no longer accepted: a plain object or another database's principal is not authentication.
 await assert.rejects(()=>c.openSafetyCase(db,{accountId:rev.id},{caseId:'case-x',subjectUserId:'u',intakeRef:'i'}),e=>e instanceof m.IdentityError&&e.code==='proof_required');checks++;
 await assert.rejects(()=>c.openSafetyCase(db,'human:'+rev.id,{caseId:'case-x',subjectUserId:'u',intakeRef:'i'}),e=>e instanceof m.IdentityError);checks++;
 await assert.rejects(()=>run("INSERT INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) VALUES('direct','agent:bot','case_reviewer',?,1)",admin.ref));checks++;
 await assert.rejects(()=>run("INSERT INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) VALUES('direct','human:x','case_reviewer','operator:bootstrap',1)"));checks++;
 // A stale passkey proof (older than ten minutes) is refused and audited before any role check.
 const stale=await principal((await workspaceSession(db,m,{account:rev.id,credential:rev.fixture.credential},-700)).token);
 await assert.rejects(()=>c.openSafetyCase(db,stale,{caseId:'case-1',subjectUserId:'u',intakeRef:'intake-1'}),e=>e instanceof m.IdentityError&&e.code==='proof_required');checks++;
 assert.deepEqual(await lastDenied(),{actor:rev.ref,action:'open_case',outcome:'denied',reason:'unauthenticated'});

 // Opening requires the reviewer role; a model/agent actor or raw text is rejected without being copied.
 await refused(()=>c.openSafetyCase(db,nobody,{caseId:'case-1',subjectUserId:a,intakeRef:'intake-1'}),'missing_role');
 assert.deepEqual(await lastDenied(),{actor:none.ref,action:'open_case',outcome:'denied',reason:'missing_role'});
 await refused(()=>c.openSafetyCase(db,approver,{caseId:'case-1',subjectUserId:a,intakeRef:'intake-1'}),'missing_role');
 await assert.rejects(()=>c.openSafetyCase(db,'model:assistant',{caseId:'case-1',subjectUserId:a,intakeRef:'intake-1'}),e=>e instanceof m.IdentityError);checks++;
 assert.deepEqual(await lastDenied(),{actor:null,action:'open_case',outcome:'denied',reason:'unauthenticated'});
 // Identity and role failures never reach the immutable privileged audit.
 assert.equal(await count('safety_case_audit',"reason IN ('unauthenticated','missing_role','invalid_input')"),0);checks++;
 // An operator cannot open (or see) a case about their own account.
 await refused(()=>c.openSafetyCase(db,reviewer,{caseId:'case-self',subjectUserId:rev.id,intakeRef:'intake-1'}),'not_found');
 assert.deepEqual(await lastAudit(),{actor:rev.ref,action:'open_case',caseId:'case-self',target:null,outcome:'denied',reason:'conflict_of_interest'});
 await refused(()=>c.openSafetyCase(db,reviewer,{caseId:'case-1',subjectUserId:a,intakeRef:MARK+' raw text'}),'invalid_input');
 await refused(()=>c.openSafetyCase(db,reviewer,{caseId:'case-missing',subjectUserId:crypto.randomUUID(),intakeRef:'intake-1'}),'not_found');
 assert.equal(await count('safety_cases'),0);
 await Promise.all([c.openSafetyCase(db,reviewer,{caseId:'case-1',subjectUserId:a,intakeRef:'intake-1'}),c.openSafetyCase(db,reviewer,{caseId:'case-1',subjectUserId:a,intakeRef:'intake-1'})]);
 await refused(()=>c.openSafetyCase(db,reviewer,{caseId:'case-1',subjectUserId:b,intakeRef:'intake-1'}),'conflict');
 let view=await c.readSafetyCase(db,reviewer,{caseId:'case-1'});
 assert.equal(view.currentFinding,'uncertain_flag');assert.equal(view.findings.length,1);assert.deepEqual(view.holds,[]);

 // Evidence links bind the same subject's reviewed ledger rows and never change the finding.
 await c.linkSafetyCaseEvidence(db,reviewer,{caseId:'case-1',evidenceId:'evidence-a2'});
 await c.linkSafetyCaseEvidence(db,reviewer,{caseId:'case-1',evidenceId:'evidence-a2'});
 await refused(()=>c.linkSafetyCaseEvidence(db,reviewer,{caseId:'case-1',evidenceId:'evidence-b1'}),'not_found');
 await refused(()=>c.linkSafetyCaseEvidence(db,approver,{caseId:'case-1',evidenceId:'evidence-a1'}),'missing_role');
 view=await c.readSafetyCase(db,auditor,{caseId:'case-1'});
 assert.deepEqual(view.evidenceIds,['evidence-a2']);assert.equal(view.currentFinding,'uncertain_flag');

 // Confirmation and correction are separate named human decisions, append-only.
 await refused(()=>c.recordSafetyCaseFinding(db,approver,{caseId:'case-1',finding:'confirmed_policy_finding',decisionRef:'decision-1'}),'missing_role');
 await refused(()=>c.recordSafetyCaseFinding(db,reviewer,{caseId:'case-1',finding:'uncertain_flag',decisionRef:'decision-0'}),'conflict');
 await refused(()=>c.recordSafetyCaseFinding(db,reviewer,{caseId:'case-1',finding:'model_verdict',decisionRef:'decision-0'}),'invalid_input');
 await c.recordSafetyCaseFinding(db,reviewer,{caseId:'case-1',finding:'confirmed_policy_finding',decisionRef:'decision-1'});
 await c.recordSafetyCaseFinding(db,reviewer,{caseId:'case-1',finding:'confirmed_policy_finding',decisionRef:'decision-1'});
 await refused(()=>c.recordSafetyCaseFinding(db,reviewer,{caseId:'case-1',finding:'not_confirmed',decisionRef:'decision-1'}),'conflict');
 assert.equal((await c.readSafetyCase(db,reviewer,{caseId:'case-1'})).currentFinding,'confirmed_policy_finding');
 await c.recordSafetyCaseFinding(db,reviewer,{caseId:'case-1',finding:'not_confirmed',decisionRef:'decision-2'});
 await c.recordSafetyCaseFinding(db,reviewer,{caseId:'case-1',finding:'confirmed_policy_finding',decisionRef:'decision-3'});
 view=await c.readSafetyCase(db,reviewer,{caseId:'case-1'});
 assert.deepEqual(view.findings.map(f=>f.finding),['uncertain_flag','confirmed_policy_finding','not_confirmed','confirmed_policy_finding']);
 // The separate risk ledger keeps its own kinds: a case finding does not rewrite risk evidence.
 assert.equal((await row("SELECT kind FROM content_risk_evidence WHERE id='evidence-a1'")).kind,'uncertain_flag');checks++;

 // Holds: preservation approver only, named legal basis, bounded review term.
 await refused(()=>c.placePreservationHold(db,reviewer,{holdId:'hold-1',caseId:'case-1',legalBasisRef:'basis-1',reviewDays:30}),'missing_role');
 for(const reviewDays of [0,367,1.5,'30'])await refused(()=>c.placePreservationHold(db,approver,{holdId:'hold-1',caseId:'case-1',legalBasisRef:'basis-1',reviewDays}),'invalid_input');
 await refused(()=>c.placePreservationHold(db,approver,{holdId:'hold-1',caseId:'case-unknown',legalBasisRef:'basis-1',reviewDays:30}),'not_found');
 assert.equal(await count('safety_preservation_holds'),0);
 await c.placePreservationHold(db,approver,{holdId:'hold-1',caseId:'case-1',legalBasisRef:'basis-1',reviewDays:30});
 await c.placePreservationHold(db,approver,{holdId:'hold-1',caseId:'case-1',legalBasisRef:'basis-1',reviewDays:30});
 await refused(()=>c.placePreservationHold(db,approver,{holdId:'hold-1',caseId:'case-1',legalBasisRef:'basis-other',reviewDays:30}),'conflict');
 const hold=await row("SELECT placed_at,review_due_at,subject_user_id FROM safety_preservation_holds WHERE id='hold-1'");
 assert.equal(hold.review_due_at-hold.placed_at,30*86400);assert.equal(hold.subject_user_id,a);
 await assert.rejects(()=>run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('too-long','case-1',?,'account','b',?,unixepoch(),unixepoch()+31708800)",a,appr.ref));checks++;
 // The schema itself requires a current preservation approver to place or release a hold (single approver for now).
 for(const by of [rev.ref,none.ref,'human:'+a])await assert.rejects(()=>run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-raw','case-1',?,'account','b',?,unixepoch(),unixepoch()+86400)",a,by),/safety_hold_approver/);checks++;
 for(const by of [rev.ref,none.ref,'human:'+a])await assert.rejects(()=>run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by=?,release_ref='raw' WHERE id='hold-1'",by),/safety_hold_approver/);checks++;
 // An overdue review keeps blocking: it never lapses silently.
 await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-overdue','case-1',?,'account','basis-0',?,unixepoch()-200*86400,unixepoch()-86400)",a,appr.ref);
 const listed=await c.listActivePreservationHolds(db,auditor);
 assert.deepEqual(listed.map(h=>[h.id,h.overdue]).sort(),[['hold-1',false],['hold-overdue',true]]);
 await refused(()=>c.listActivePreservationHolds(db,reviewer),'missing_role');
 assert.equal((await accountClosureInventory(db,a)).counts.activePreservationHolds,2);assert.equal((await accountClosureInventory(db,b)).counts.activePreservationHolds,0);

 // Ordinary deletion and retention paths cannot erase held evidence.
 const before={evidence:await count('content_risk_evidence','user_id=?',a),contacts:await count('contact_submissions','project_id=?',pa)};
 await blocked(()=>run('DELETE FROM users WHERE id=?',a));
 await blocked(()=>run('DELETE FROM projects WHERE id=?',pa));
 await blocked(()=>run('UPDATE projects SET owner_user_id=? WHERE id=?',b,pa));
 await blocked(()=>contacts.deleteContact(db,a,'contact-a-new'));
 await contacts.cleanupContacts(db);
 assert.equal(await count('contact_submissions',"id='contact-a-old'"),1);assert.equal(await count('contact_submissions',"id='contact-b-old'"),0);checks++;
 assert.deepEqual({evidence:await count('content_risk_evidence','user_id=?',a),contacts:await count('contact_submissions','project_id=?',pa)},before);
 await refused(()=>c.closeSafetyCase(db,reviewer,{caseId:'case-1',closeRef:'close-1'}),'active_hold');
 assert.deepEqual(await lastAudit(),{actor:rev.ref,action:'close_case',caseId:'case-1',target:'close-1',outcome:'rejected',reason:'active_hold'});
 // Unrelated accounts are unaffected.
 await contacts.deleteContact(db,b,'contact-b-old');await run('DELETE FROM users WHERE id=?',b);
 assert.equal(await count('users','id=?',b),0);checks++;

 // Restricted records are append-only, including against direct SQL.
 for(const q of ["UPDATE safety_preservation_holds SET legal_basis_ref='x'","UPDATE safety_preservation_holds SET review_due_at=review_due_at+1","DELETE FROM safety_preservation_holds","DELETE FROM safety_cases",
  "UPDATE safety_cases SET subject_user_id='x'","UPDATE safety_case_findings SET finding='not_confirmed'","DELETE FROM safety_case_findings","DELETE FROM safety_case_evidence","UPDATE safety_case_audit SET reason='ok'","DELETE FROM safety_case_audit","DELETE FROM safety_case_roles"])
  {await assert.rejects(()=>run(q),q);checks++;}

 // Lost acknowledgement after commit: the attempt is recorded as uncertain, then exact retry confirms it.
 const lost={prepare:(...x)=>db.prepare(...x),batch:async s=>{await db.batch(s);throw Error('lost acknowledgement');}};
 await refused(async()=>c.placePreservationHold(lost,await principal(appr.fixture.token,lost),{holdId:'hold-2',caseId:'case-1',legalBasisRef:'basis-2',reviewDays:1}),'unavailable');
 await c.placePreservationHold(db,approver,{holdId:'hold-2',caseId:'case-1',legalBasisRef:'basis-2',reviewDays:1});

 // Release: approver only, explicit reference, exact replay; every hold must be released.
 await refused(()=>c.releasePreservationHold(db,reviewer,{holdId:'hold-1',caseId:'case-1',releaseRef:'release-1'}),'missing_role');
 await refused(()=>c.releasePreservationHold(db,approver,{holdId:'hold-unknown',caseId:'case-1',releaseRef:'release-1'}),'not_found');
 for(const id of ['hold-1','hold-overdue','hold-2']){await c.releasePreservationHold(db,approver,{holdId:id,caseId:'case-1',releaseRef:'release-'+id});await c.releasePreservationHold(db,approver,{holdId:id,caseId:'case-1',releaseRef:'release-'+id});}
 await refused(()=>c.releasePreservationHold(db,approver,{holdId:'hold-1',caseId:'case-1',releaseRef:'release-other'}),'conflict');
 await assert.rejects(()=>run("UPDATE safety_preservation_holds SET released_at=NULL,released_by=NULL,release_ref=NULL WHERE id='hold-1'"));checks++;
 assert.equal((await accountClosureInventory(db,a)).counts.activePreservationHolds,0);

 // After release the ordinary account cascade proceeds; the case, decisions, links and holds remain outside it.
 await run('DELETE FROM users WHERE id=?',a);
 assert.equal(await count('content_risk_evidence','user_id=?',a),0);assert.equal(await count('projects','id=?',pa),0);checks++;
 view=await c.readSafetyCase(db,approver,{caseId:'case-1'});
 assert.equal(view.subjectUserId,a);assert.deepEqual(view.evidenceIds,['evidence-a2']);assert.equal(view.findings.length,4);assert.equal(view.holds.length,3);assert.ok(view.holds.every(h=>!h.active&&!h.overdue));
 await refused(()=>c.placePreservationHold(db,approver,{holdId:'hold-late',caseId:'case-1',legalBasisRef:'basis-3',reviewDays:30}),'not_found');
 await c.closeSafetyCase(db,reviewer,{caseId:'case-1',closeRef:'close-1'});await c.closeSafetyCase(db,reviewer,{caseId:'case-1',closeRef:'close-1'});
 await refused(()=>c.recordSafetyCaseFinding(db,reviewer,{caseId:'case-1',finding:'not_confirmed',decisionRef:'decision-4'}),'case_closed');
 await assert.rejects(()=>run("UPDATE safety_cases SET closed_at=NULL,closed_by=NULL,close_ref=NULL WHERE id='case-1'"));checks++;

 // An account with no projects is held by the account trigger itself, not only through project cascades.
 const d=crypto.randomUUID();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-04')",d,d+'@example.invalid');
 await risk.recordContentRiskEvidence(db,{...evidence,id:'evidence-d1',userId:d});
 await c.openSafetyCase(db,reviewer,{caseId:'case-2',subjectUserId:d,intakeRef:'intake-2'});
 await c.placePreservationHold(db,approver,{holdId:'hold-d',caseId:'case-2',legalBasisRef:'basis-d',reviewDays:366});
 await blocked(()=>run('DELETE FROM users WHERE id=?',d));assert.equal(await count('content_risk_evidence','user_id=?',d),1);
 await c.releasePreservationHold(db,approver,{holdId:'hold-d',caseId:'case-2',releaseRef:'release-d'});
 await run('DELETE FROM users WHERE id=?',d);assert.equal(await count('content_risk_evidence','user_id=?',d),0);assert.equal(await count('safety_cases',"id='case-2'"),1);checks++;

 // Audit exhaustion (owner security review, October 6, 2026): identity, input and role failures go only to the bounded,
 // self-pruning denied-attempt log with a per-principal budget, so they can never stop an approver from placing a hold.
 const e=crypto.randomUUID();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-04')",e,e+'@example.invalid');
 await c.openSafetyCase(db,reviewer,{caseId:'case-3',subjectUserId:e,intakeRef:'intake-3'});
 const auditRows=await count('safety_case_audit');
 // Snapshot the earlier refusals before the flood evicts them (asserted with the audit below).
 const deniedSeen=new Set((await all('SELECT action,outcome,reason FROM safety_case_denied_attempts')).map(e=>e.action+':'+e.outcome+':'+e.reason));
 for(let i=0;i<80;i++){
  await refused(()=>c.placePreservationHold(db,nobody,{holdId:'hold-flood-'+i,caseId:'case-3',legalBasisRef:'basis-flood',reviewDays:30}),'missing_role');
  await refused(()=>c.placePreservationHold(db,nobody,{holdId:'hold-flood-'+i,caseId:'case-3',legalBasisRef:'raw text',reviewDays:30}),'invalid_input');
  await assert.rejects(()=>c.placePreservationHold(db,'model:assistant',{holdId:'hold-flood-'+i,caseId:'case-3',legalBasisRef:'basis-flood',reviewDays:30}),e=>e instanceof m.IdentityError);
 }
 assert.equal(await count('safety_case_audit'),auditRows,'Denied attempts never consume the privileged audit');checks++;
 assert.equal(await count('safety_case_denied_attempts','principal_ref=?',none.ref),60,'Per-principal hourly budget');checks++;
 assert.equal(await count('safety_case_denied_attempts','principal_ref IS NULL'),60,'Shared anonymous budget');checks++;
 // Fill the log to its cap (many distinct principals); the oldest rows are evicted and inserts keep succeeding.
 await run("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<10050) INSERT INTO safety_case_denied_attempts(at,principal_ref,action,outcome,reason) SELECT unixepoch(),'human:filler-'||i,'place_hold','denied','missing_role' FROM n");
 assert.equal(await count('safety_case_denied_attempts'),10000);assert.equal(await count('safety_case_denied_attempts','principal_ref=?',none.ref),0,'Oldest rows evicted first');checks++;
 await refused(()=>c.placePreservationHold(db,nobody,{holdId:'hold-flood-x',caseId:'case-3',legalBasisRef:'basis-flood',reviewDays:30}),'missing_role');
 assert.equal(await count('safety_case_denied_attempts'),10000);checks++;
 await run("UPDATE safety_case_denied_attempts SET at=0 WHERE seq=(SELECT max(seq) FROM safety_case_denied_attempts)").then(()=>assert.fail('denied log is append-only'),()=>{});checks++;
 // A real approver still places (and audits) a hold in the same transaction.
 await c.placePreservationHold(db,approver,{holdId:'hold-cap',caseId:'case-3',legalBasisRef:'basis-cap',reviewDays:30});
 assert.equal(await count('safety_preservation_holds',"id='hold-cap' AND released_at IS NULL"),1);
 assert.deepEqual(await lastAudit(),{actor:appr.ref,action:'place_hold',caseId:'case-3',target:'hold-cap',outcome:'allowed',reason:'ok'});
 assert.equal(await count('safety_case_audit'),auditRows+1);checks++;
 await c.releasePreservationHold(db,approver,{holdId:'hold-cap',caseId:'case-3',releaseRef:'release-cap'});

 // Revocation is one-way and immediately effective.
 await c.revokeSafetyCaseRole(db,owner,{grantId:'grant-1',revokeRef:'revoke-1'});await c.revokeSafetyCaseRole(db,owner,{grantId:'grant-1',revokeRef:'revoke-1'});
 await refused(()=>c.readSafetyCase(db,reviewer,{caseId:'case-1'}),'missing_role');
 await refused(()=>c.revokeSafetyCaseRole(db,owner,{grantId:'grant-unknown',revokeRef:'revoke-2'}),'not_found');

 // Audit: auditor only; every attempt and decision is present; no private values copied.
 await refused(()=>c.readSafetyCaseAudit(db,approver,{caseId:'case-1'}),'missing_role');
 const audit=await c.readSafetyCaseAudit(db,auditor,{caseId:'case-1'});
 const seen=new Set(audit.map(e=>e.action+':'+e.outcome+':'+e.reason));
 for(const expected of ['open_case:allowed:ok','open_case:rejected:conflict','link_evidence:rejected:not_found','record_finding:allowed:ok','record_finding:rejected:conflict',
  'place_hold:allowed:ok','place_hold:rejected:unavailable','close_case:rejected:active_hold','release_hold:allowed:ok','read_case:allowed:ok','record_finding:rejected:case_closed','close_case:allowed:ok'])
  {assert.ok(seen.has(expected),expected);checks++;}
 // Identity, input and role failures are in the separate bounded denied-attempt log, never in the privileged audit.
 assert.ok(audit.every(e=>!['unauthenticated','missing_role','invalid_input'].includes(e.reason)));checks++;
 for(const expected of ['open_case:denied:missing_role','open_case:rejected:invalid_input','open_case:denied:unauthenticated','place_hold:denied:missing_role','release_hold:denied:missing_role'])
  {assert.ok(deniedSeen.has(expected),expected);checks++;}
 for(const action of ['read_case','read_audit'])assert.equal(await count('safety_case_denied_attempts',"action=? AND outcome='denied' AND reason='missing_role'",action),1,action);checks++;
 const everything=JSON.stringify([await all('SELECT * FROM safety_case_audit'),await all('SELECT * FROM safety_case_denied_attempts'),await all('SELECT * FROM safety_cases'),await all('SELECT * FROM safety_case_findings'),await all('SELECT * FROM safety_preservation_holds'),view,audit]);
 assert.doesNotMatch(everything,new RegExp(MARK+'|example\\.invalid|raw text|model:|agent:'));checks++;
 // Privileged audit headroom: one operator's routine actions are bounded per day, and the last 10,000 of the 100,000 rows
 // are reserved for protective actions, so a hold can still be placed when routine reads are refused for capacity.
 const rev2=await operator(),reviewer2=rev2.p,f=crypto.randomUUID();
 await c.grantSafetyCaseRole(db,owner,{grantId:'grant-r2',operatorAccountId:rev2.id,role:'case_reviewer'});
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-04')",f,f+'@example.invalid');
 await c.openSafetyCase(db,reviewer2,{caseId:'case-4',subjectUserId:f,intakeRef:'intake-4'});
 const used=(await row('SELECT count(*) AS n FROM safety_case_audit WHERE actor_ref=? AND at>unixepoch()-86400',appr.ref)).n;
 await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${2000-used}) INSERT INTO safety_case_audit(at,actor_ref,action,case_id,target_ref,outcome,reason) SELECT unixepoch(),?,'list_holds',NULL,NULL,'allowed','ok' FROM n`,appr.ref);
 await refused(()=>c.listActivePreservationHolds(db,approver),'capacity');
 await c.placePreservationHold(db,approver,{holdId:'hold-budget',caseId:'case-4',legalBasisRef:'basis-budget',reviewDays:30});
 assert.equal((await lastAudit()).target,'hold-budget');checks++;
 const capacity=(await row("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='safety_case_audit_capacity'")).sql;
 await run('DROP TRIGGER safety_case_audit_capacity');
 const total=await count('safety_case_audit');
 await run(`WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${90000-total}) INSERT INTO safety_case_audit(at,actor_ref,action,case_id,target_ref,outcome,reason) SELECT 0,NULL,'list_holds',NULL,NULL,'allowed','ok' FROM n`);
 await run(capacity);
 await refused(()=>c.readSafetyCase(db,reviewer2,{caseId:'case-4'}),'capacity');
 await c.placePreservationHold(db,approver,{holdId:'hold-reserve',caseId:'case-4',legalBasisRef:'basis-reserve',reviewDays:30});
 assert.equal((await lastAudit()).target,'hold-reserve');assert.equal(await count('safety_preservation_holds',"case_id='case-4' AND released_at IS NULL"),2);checks++;
 console.log(`Safety cases passed (${process.argv.includes('--d1')?'local D1':'SQLite'}): ${checks} checks. Fresh-passkey authenticated operators (declared, forged and stale actors refused), bootstrap-only role administration, conflict-of-interest refusal, audited allowed/denied/rejected attempts, uncertain vs confirmed append-only findings, bounded holds that block account/project/contact deletion and contact expiry, overdue holds that never lapse, explicit release, case survival outside the account cascade, lost acknowledgement and closure inventory. Synthetic placeholders only; no scanner, provider or reporting path.`);
}finally{await fixture.close();}
