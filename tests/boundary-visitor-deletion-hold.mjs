// WH-004 slice 8 regression: a safety preservation hold refusing a visitor's own account deletion, through the mounted
// visitor gateway (applicationGateway, as the whumpo-apps Worker calls it). Closes the evidence gap recorded in
// docs/boundary-audit.json (visitor-account-lifecycle, stale cell: "A safety hold refusal surfaces as a generic 503
// (untested through the gateway)"). safety_hold_visitor_retained aborts the committing batch, so:
//   1. A project-scope or account-scope hold refuses a fresh, exact review with the generic 503 deletion text; the
//      response never discloses the hold, the visitor, its session and its document remain, and no receipt is saved.
//   2. The refusal is not a half-commit: the same review retried under the hold gets the same 503 (not "ID already
//      used") and the read-only status says deleted:false.
//   3. Controls: another tenant's visitor without a hold deletes normally, and after an audited release the original
//      review confirms with 200 and the status then proves completion.
// Local D1, synthetic visitors and a stub runtime; no network or provider.
import assert from 'node:assert/strict';
import {deletionFixture} from './visitor-deletion-fixture.mjs';

const f=await deletionFixture(),{db,id,app,visitor,call}=f;
const generic='Deletion could not be confirmed. Check the saved deletion result before taking another action';
const run=(sql,...values)=>db.prepare(sql).bind(...values).run();
const first=(sql,...values)=>db.prepare(sql).bind(...values).first();
const exists=async v=>!!await first('SELECT id FROM app_visitors WHERE id=?',v.who);
const retained=async v=>{
 assert.ok(await exists(v),'visitor retained');
 assert.equal((await first('SELECT count(*) n FROM app_sessions WHERE visitor_id=?',v.who)).n,1,'session retained');
 assert.equal((await first('SELECT count(*) n FROM app_documents WHERE visitor_id=?',v.who)).n,1,'document retained');
};
const review=async(a,v)=>{const res=await call(a,v,'account/deletion-review',{});assert.equal(res.status,200,'review under the hold');return res.json();};
const confirm=(a,v,r)=>call(a,v,'account/delete',{id:r.id,revision:r.revision,confirmation:'DELETE'});
const status=async(a,v,r)=>(await call(a,v,'account/deletions/'+r.id+'/'+r.revision)).json();
async function hold(a,scope){
 const caseId='case-'+id(),holdId='hold-'+id();
 await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",caseId,a.user);
 await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,?,?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",holdId,caseId,a.user,scope,scope==='project'?a.project:null);
 return holdId;
}
async function refusedUnderHold(a,v,r,label){
 const response=await confirm(a,v,r),text=await response.text();
 assert.equal(response.status,503,label);
 assert.deepEqual(JSON.parse(text),{error:generic},label);
 assert.doesNotMatch(text,/hold|safety|preserv/i,label+': the hold is not disclosed');
 await retained(v);
 assert.equal(await first('SELECT id FROM app_deletion_receipts WHERE id=?',r.id),null,label+': no receipt');
}
try{
 const a=await app(),b=await app(),c=await app();
 const A=await visitor(a,'Held A'),B=await visitor(b,'Unheld B'),C=await visitor(c,'Account-held C');
 // 1. Project-scope hold on a.
 const projectHold=await hold(a,'project');
 const r=await review(a,A);
 await refusedUnderHold(a,A,r,'project hold');
 // 2. Retry with the same exact review: same refusal, nothing half-committed; status stays read-only and unconfirmed.
 await refusedUnderHold(a,A,r,'project hold retry');
 assert.deepEqual(await status(a,A,r),{deleted:false,id:r.id});
 // Account-scope hold on c's owner covers c's visitors too.
 await hold(c,'account');
 await refusedUnderHold(c,C,await review(c,C),'account hold');
 // 3. Control: another tenant's visitor, no hold, deletes normally.
 const rb=await review(b,B);
 assert.equal((await confirm(b,B,rb)).status,200,'unheld tenant deletes');
 assert.equal(await exists(B),false);
 // Control: an audited release lets the original review complete.
 await run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?",projectHold);
 assert.deepEqual(await (await confirm(a,A,r)).json(),{deleted:true,id:r.id},'released hold');
 assert.equal(await exists(A),false);
 assert.deepEqual(await status(a,A,r),{deleted:true,id:r.id});
 await retained(C);
 console.log('Visitor deletion under a safety hold: a project- or account-scope hold refuses an exact, fresh deletion review over HTTP with the generic 503 deletion text (hold not disclosed), keeps the visitor, session and document, saves no receipt and refuses an identical retry the same way; an unheld tenant deletes normally and the same review completes after an audited release.');
}finally{await f.close();}
