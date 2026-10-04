import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
// Synthetic, benign placeholders only. No real allegation, imagery, message or identity is used.
const built=await build({stdin:{contents:"export * as cases from './src/safety-cases.ts';export * as contacts from './src/contacts.ts';export * as risk from './src/content-risk-evidence.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {cases:c,contacts,risk}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture(),{db}=fixture;let checks=0;
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first(),all=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results;
const count=async(table,where='1',...p)=>(await row(`SELECT count(*) AS n FROM ${table} WHERE ${where}`,...p)).n;
const refused=async(fn,reason)=>{await assert.rejects(fn,e=>e instanceof c.SafetyCaseError&&e.reason===reason,reason);checks++;};
const blocked=async(fn)=>{await assert.rejects(fn,/safety_preservation_hold/);checks++;};
const lastAudit=async()=>({...await row('SELECT actor_ref AS actor,action,case_id AS caseId,target_ref AS target,outcome,reason FROM safety_case_audit ORDER BY seq DESC LIMIT 1')});
const MARK='SYNTHETIC-PRIVATE-MARKER';
const owner='human:owner-1',reviewer='human:reviewer-1',approver='human:approver-1',auditor='human:auditor-1',nobody='human:nobody-1';
try{
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
 for(const [id,op,role] of [['grant-1',reviewer,'case_reviewer'],['grant-2',approver,'preservation_approver'],['grant-3',auditor,'case_auditor']]){
  await c.grantSafetyCaseRole(db,{grantId:id,operatorRef:op,role,grantedBy:owner});await c.grantSafetyCaseRole(db,{grantId:id,operatorRef:op,role,grantedBy:owner});
 }
 assert.equal(await count('safety_case_roles'),3);
 await refused(()=>c.grantSafetyCaseRole(db,{grantId:'grant-1',operatorRef:nobody,role:'case_reviewer',grantedBy:owner}),'conflict');
 await refused(()=>c.grantSafetyCaseRole(db,{grantId:'grant-self',operatorRef:owner,role:'case_reviewer',grantedBy:owner}),'invalid_input');
 await refused(()=>c.grantSafetyCaseRole(db,{grantId:'grant-model',operatorRef:'model:assistant',role:'preservation_approver',grantedBy:owner}),'invalid_input');
 await refused(()=>c.grantSafetyCaseRole(db,{grantId:'grant-x',operatorRef:nobody,role:'case_admin',grantedBy:owner}),'invalid_input');
 await assert.rejects(()=>run("INSERT INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) VALUES('direct','agent:bot','case_reviewer',?,1)",owner));checks++;

 // Opening requires the reviewer role; a model/agent actor or raw text is rejected without being copied.
 await refused(()=>c.openSafetyCase(db,{caseId:'case-1',subjectUserId:a,intakeRef:'intake-1',actor:nobody}),'missing_role');
 assert.deepEqual(await lastAudit(),{actor:nobody,action:'open_case',caseId:'case-1',target:null,outcome:'denied',reason:'missing_role'});
 await refused(()=>c.openSafetyCase(db,{caseId:'case-1',subjectUserId:a,intakeRef:'intake-1',actor:approver}),'missing_role');
 await refused(()=>c.openSafetyCase(db,{caseId:'case-1',subjectUserId:a,intakeRef:'intake-1',actor:'model:assistant'}),'invalid_input');
 assert.deepEqual(await lastAudit(),{actor:null,action:'open_case',caseId:'case-1',target:null,outcome:'rejected',reason:'invalid_input'});
 await refused(()=>c.openSafetyCase(db,{caseId:'case-1',subjectUserId:a,intakeRef:MARK+' raw text',actor:reviewer}),'invalid_input');
 await refused(()=>c.openSafetyCase(db,{caseId:'case-missing',subjectUserId:crypto.randomUUID(),intakeRef:'intake-1',actor:reviewer}),'not_found');
 assert.equal(await count('safety_cases'),0);
 await Promise.all([c.openSafetyCase(db,{caseId:'case-1',subjectUserId:a,intakeRef:'intake-1',actor:reviewer}),c.openSafetyCase(db,{caseId:'case-1',subjectUserId:a,intakeRef:'intake-1',actor:reviewer})]);
 await refused(()=>c.openSafetyCase(db,{caseId:'case-1',subjectUserId:b,intakeRef:'intake-1',actor:reviewer}),'conflict');
 let view=await c.readSafetyCase(db,{caseId:'case-1',actor:reviewer});
 assert.equal(view.currentFinding,'uncertain_flag');assert.equal(view.findings.length,1);assert.deepEqual(view.holds,[]);

 // Evidence links bind the same subject's reviewed ledger rows and never change the finding.
 await c.linkSafetyCaseEvidence(db,{caseId:'case-1',evidenceId:'evidence-a2',actor:reviewer});
 await c.linkSafetyCaseEvidence(db,{caseId:'case-1',evidenceId:'evidence-a2',actor:reviewer});
 await refused(()=>c.linkSafetyCaseEvidence(db,{caseId:'case-1',evidenceId:'evidence-b1',actor:reviewer}),'not_found');
 await refused(()=>c.linkSafetyCaseEvidence(db,{caseId:'case-1',evidenceId:'evidence-a1',actor:approver}),'missing_role');
 view=await c.readSafetyCase(db,{caseId:'case-1',actor:auditor});
 assert.deepEqual(view.evidenceIds,['evidence-a2']);assert.equal(view.currentFinding,'uncertain_flag');

 // Confirmation and correction are separate named human decisions, append-only.
 await refused(()=>c.recordSafetyCaseFinding(db,{caseId:'case-1',finding:'confirmed_policy_finding',decisionRef:'decision-1',actor:approver}),'missing_role');
 await refused(()=>c.recordSafetyCaseFinding(db,{caseId:'case-1',finding:'uncertain_flag',decisionRef:'decision-0',actor:reviewer}),'conflict');
 await refused(()=>c.recordSafetyCaseFinding(db,{caseId:'case-1',finding:'model_verdict',decisionRef:'decision-0',actor:reviewer}),'invalid_input');
 await c.recordSafetyCaseFinding(db,{caseId:'case-1',finding:'confirmed_policy_finding',decisionRef:'decision-1',actor:reviewer});
 await c.recordSafetyCaseFinding(db,{caseId:'case-1',finding:'confirmed_policy_finding',decisionRef:'decision-1',actor:reviewer});
 await refused(()=>c.recordSafetyCaseFinding(db,{caseId:'case-1',finding:'not_confirmed',decisionRef:'decision-1',actor:reviewer}),'conflict');
 assert.equal((await c.readSafetyCase(db,{caseId:'case-1',actor:reviewer})).currentFinding,'confirmed_policy_finding');
 await c.recordSafetyCaseFinding(db,{caseId:'case-1',finding:'not_confirmed',decisionRef:'decision-2',actor:reviewer});
 await c.recordSafetyCaseFinding(db,{caseId:'case-1',finding:'confirmed_policy_finding',decisionRef:'decision-3',actor:reviewer});
 view=await c.readSafetyCase(db,{caseId:'case-1',actor:reviewer});
 assert.deepEqual(view.findings.map(f=>f.finding),['uncertain_flag','confirmed_policy_finding','not_confirmed','confirmed_policy_finding']);
 // The separate risk ledger keeps its own kinds: a case finding does not rewrite risk evidence.
 assert.equal((await row("SELECT kind FROM content_risk_evidence WHERE id='evidence-a1'")).kind,'uncertain_flag');checks++;

 // Holds: preservation approver only, named legal basis, bounded review term.
 await refused(()=>c.placePreservationHold(db,{holdId:'hold-1',caseId:'case-1',legalBasisRef:'basis-1',reviewDays:30,actor:reviewer}),'missing_role');
 for(const reviewDays of [0,367,1.5,'30'])await refused(()=>c.placePreservationHold(db,{holdId:'hold-1',caseId:'case-1',legalBasisRef:'basis-1',reviewDays,actor:approver}),'invalid_input');
 await refused(()=>c.placePreservationHold(db,{holdId:'hold-1',caseId:'case-unknown',legalBasisRef:'basis-1',reviewDays:30,actor:approver}),'not_found');
 assert.equal(await count('safety_preservation_holds'),0);
 await c.placePreservationHold(db,{holdId:'hold-1',caseId:'case-1',legalBasisRef:'basis-1',reviewDays:30,actor:approver});
 await c.placePreservationHold(db,{holdId:'hold-1',caseId:'case-1',legalBasisRef:'basis-1',reviewDays:30,actor:approver});
 await refused(()=>c.placePreservationHold(db,{holdId:'hold-1',caseId:'case-1',legalBasisRef:'basis-other',reviewDays:30,actor:approver}),'conflict');
 const hold=await row("SELECT placed_at,review_due_at,subject_user_id FROM safety_preservation_holds WHERE id='hold-1'");
 assert.equal(hold.review_due_at-hold.placed_at,30*86400);assert.equal(hold.subject_user_id,a);
 await assert.rejects(()=>run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('too-long','case-1',?,'account','b',?,unixepoch(),unixepoch()+31708800)",a,approver));checks++;
 // An overdue review keeps blocking: it never lapses silently.
 await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-overdue','case-1',?,'account','basis-0',?,unixepoch()-200*86400,unixepoch()-86400)",a,approver);
 const listed=await c.listActivePreservationHolds(db,{actor:auditor});
 assert.deepEqual(listed.map(h=>[h.id,h.overdue]).sort(),[['hold-1',false],['hold-overdue',true]]);
 await refused(()=>c.listActivePreservationHolds(db,{actor:reviewer}),'missing_role');
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
 await refused(()=>c.closeSafetyCase(db,{caseId:'case-1',closeRef:'close-1',actor:reviewer}),'active_hold');
 assert.deepEqual(await lastAudit(),{actor:reviewer,action:'close_case',caseId:'case-1',target:'close-1',outcome:'rejected',reason:'active_hold'});
 // Unrelated accounts are unaffected.
 await contacts.deleteContact(db,b,'contact-b-old');await run('DELETE FROM users WHERE id=?',b);
 assert.equal(await count('users','id=?',b),0);checks++;

 // Restricted records are append-only, including against direct SQL.
 for(const q of ["UPDATE safety_preservation_holds SET legal_basis_ref='x'","UPDATE safety_preservation_holds SET review_due_at=review_due_at+1","DELETE FROM safety_preservation_holds","DELETE FROM safety_cases",
  "UPDATE safety_cases SET subject_user_id='x'","UPDATE safety_case_findings SET finding='not_confirmed'","DELETE FROM safety_case_findings","DELETE FROM safety_case_evidence","UPDATE safety_case_audit SET reason='ok'","DELETE FROM safety_case_audit","DELETE FROM safety_case_roles"])
  {await assert.rejects(()=>run(q),q);checks++;}

 // Lost acknowledgement after commit: the attempt is recorded as uncertain, then exact retry confirms it.
 const lost={prepare:(...x)=>db.prepare(...x),batch:async s=>{await db.batch(s);throw Error('lost acknowledgement');}};
 await refused(()=>c.placePreservationHold(lost,{holdId:'hold-2',caseId:'case-1',legalBasisRef:'basis-2',reviewDays:1,actor:approver}),'unavailable');
 await c.placePreservationHold(db,{holdId:'hold-2',caseId:'case-1',legalBasisRef:'basis-2',reviewDays:1,actor:approver});

 // Release: approver only, explicit reference, exact replay; every hold must be released.
 await refused(()=>c.releasePreservationHold(db,{holdId:'hold-1',caseId:'case-1',releaseRef:'release-1',actor:reviewer}),'missing_role');
 await refused(()=>c.releasePreservationHold(db,{holdId:'hold-unknown',caseId:'case-1',releaseRef:'release-1',actor:approver}),'not_found');
 for(const id of ['hold-1','hold-overdue','hold-2']){await c.releasePreservationHold(db,{holdId:id,caseId:'case-1',releaseRef:'release-'+id,actor:approver});await c.releasePreservationHold(db,{holdId:id,caseId:'case-1',releaseRef:'release-'+id,actor:approver});}
 await refused(()=>c.releasePreservationHold(db,{holdId:'hold-1',caseId:'case-1',releaseRef:'release-other',actor:approver}),'conflict');
 await assert.rejects(()=>run("UPDATE safety_preservation_holds SET released_at=NULL,released_by=NULL,release_ref=NULL WHERE id='hold-1'"));checks++;
 assert.equal((await accountClosureInventory(db,a)).counts.activePreservationHolds,0);

 // After release the ordinary account cascade proceeds; the case, decisions, links and holds remain outside it.
 await run('DELETE FROM users WHERE id=?',a);
 assert.equal(await count('content_risk_evidence','user_id=?',a),0);assert.equal(await count('projects','id=?',pa),0);checks++;
 view=await c.readSafetyCase(db,{caseId:'case-1',actor:approver});
 assert.equal(view.subjectUserId,a);assert.deepEqual(view.evidenceIds,['evidence-a2']);assert.equal(view.findings.length,4);assert.equal(view.holds.length,3);assert.ok(view.holds.every(h=>!h.active&&!h.overdue));
 await refused(()=>c.placePreservationHold(db,{holdId:'hold-late',caseId:'case-1',legalBasisRef:'basis-3',reviewDays:30,actor:approver}),'not_found');
 await c.closeSafetyCase(db,{caseId:'case-1',closeRef:'close-1',actor:reviewer});await c.closeSafetyCase(db,{caseId:'case-1',closeRef:'close-1',actor:reviewer});
 await refused(()=>c.recordSafetyCaseFinding(db,{caseId:'case-1',finding:'not_confirmed',decisionRef:'decision-4',actor:reviewer}),'case_closed');
 await assert.rejects(()=>run("UPDATE safety_cases SET closed_at=NULL,closed_by=NULL,close_ref=NULL WHERE id='case-1'"));checks++;

 // An account with no projects is held by the account trigger itself, not only through project cascades.
 const d=crypto.randomUUID();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-04')",d,d+'@example.invalid');
 await risk.recordContentRiskEvidence(db,{...evidence,id:'evidence-d1',userId:d});
 await c.openSafetyCase(db,{caseId:'case-2',subjectUserId:d,intakeRef:'intake-2',actor:reviewer});
 await c.placePreservationHold(db,{holdId:'hold-d',caseId:'case-2',legalBasisRef:'basis-d',reviewDays:366,actor:approver});
 await blocked(()=>run('DELETE FROM users WHERE id=?',d));assert.equal(await count('content_risk_evidence','user_id=?',d),1);
 await c.releasePreservationHold(db,{holdId:'hold-d',caseId:'case-2',releaseRef:'release-d',actor:approver});
 await run('DELETE FROM users WHERE id=?',d);assert.equal(await count('content_risk_evidence','user_id=?',d),0);assert.equal(await count('safety_cases',"id='case-2'"),1);checks++;

 // Revocation is one-way and immediately effective.
 await c.revokeSafetyCaseRole(db,{grantId:'grant-1',revokedBy:owner,revokeRef:'revoke-1'});await c.revokeSafetyCaseRole(db,{grantId:'grant-1',revokedBy:owner,revokeRef:'revoke-1'});
 await refused(()=>c.readSafetyCase(db,{caseId:'case-1',actor:reviewer}),'missing_role');
 await refused(()=>c.revokeSafetyCaseRole(db,{grantId:'grant-unknown',revokedBy:owner,revokeRef:'revoke-2'}),'not_found');

 // Audit: auditor only; every attempt and decision is present; no private values copied.
 await refused(()=>c.readSafetyCaseAudit(db,{caseId:'case-1',actor:approver}),'missing_role');
 const audit=await c.readSafetyCaseAudit(db,{caseId:'case-1',actor:auditor});
 const seen=new Set(audit.map(e=>e.action+':'+e.outcome+':'+e.reason));
 for(const expected of ['open_case:denied:missing_role','open_case:rejected:invalid_input','open_case:allowed:ok','open_case:rejected:conflict','link_evidence:rejected:not_found','record_finding:allowed:ok','record_finding:rejected:conflict',
  'place_hold:denied:missing_role','place_hold:allowed:ok','place_hold:rejected:unavailable','close_case:rejected:active_hold','release_hold:allowed:ok','release_hold:denied:missing_role','read_case:allowed:ok','read_case:denied:missing_role','record_finding:rejected:case_closed','close_case:allowed:ok'])
  {assert.ok(seen.has(expected),expected);checks++;}
 const everything=JSON.stringify([await all('SELECT * FROM safety_case_audit'),await all('SELECT * FROM safety_cases'),await all('SELECT * FROM safety_case_findings'),await all('SELECT * FROM safety_preservation_holds'),view,audit]);
 assert.doesNotMatch(everything,new RegExp(MARK+'|example\\.invalid|raw text|model:|agent:'));checks++;
 console.log(`Safety cases passed (${process.argv.includes('--d1')?'local D1':'SQLite'}): ${checks} checks. Named-human roles, audited allowed/denied/rejected attempts, uncertain vs confirmed append-only findings, bounded holds that block account/project/contact deletion and contact expiry, overdue holds that never lapse, explicit release, case survival outside the account cascade, lost acknowledgement and closure inventory. Synthetic placeholders only; no scanner, provider or reporting path.`);
}finally{await fixture.close();}
