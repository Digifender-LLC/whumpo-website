// WH-181 schema conformance: sealed review receipts (binding and immutability), delete guards that let only a terminal,
// unreferenced, unheld row outside the history window leave with its receipt, active-only capacity with withdrawals
// exempt, and the directory live-review identity and per-owner slot cap. Offline: disposable SQLite (or `--d1` local D1),
// synthetic owners and projects, no network or credentials.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),raw=store.db,id=()=>crypto.randomUUID();
const run=(sql,...bind)=>raw.prepare(sql).bind(...bind).run(),one=(sql,...bind)=>raw.prepare(sql).bind(...bind).first(),count=async(sql,...bind)=>(await one(sql,...bind)).n;
const hex=c=>c.repeat(64),now=()=>new Date().toISOString(),future=()=>new Date(Date.now()+600000).toISOString(),past='2000-01-01T00:00:00.000Z';
async function owner(){const user=id();await workspaceFixture(raw,m,user);return user;}
async function project(user){
 const p=id(),at=now();
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Synthetic','Synthetic retention fixture','draft',?,?)",p,user,at,at);
 await run('INSERT INTO directories(project_id) VALUES(?)',p);
 return p;
}
let revision=0;
/** One directory review row; `applied` rows get their own confirming id and fire the real apply trigger. */
async function review(user,p,kind,{status='applied',expires=future(),digest=hex('a')}={}){
 const rid=id(),turn='turn-'+rid;
 await run("INSERT INTO directory_reviews(id,user_id,project_id,kind,snapshot_json,digest,expected_revision,publication_revision,expires_at) VALUES(?,?,?,?,'[]',?,?,0,?)",rid,user,p,kind,digest,++revision,expires);
 if(status==='applied')await run("UPDATE directory_reviews SET status='applied',confirmed_by=? WHERE id=?",turn,rid);
 return {id:rid,user,project:p,kind,digest,confirmed:status==='applied'?turn:null};
}
const receipt=(r,over={})=>{
 const f={family:'directory_reviews',id:r.id,owner:r.user,project:r.project,kind:r.kind==='unpublish'?'withdrawal':'change',target:r.project,outcome:r.confirmed?(r.kind==='unpublish'?'withdrawn':'applied'):'expired',digest:r.digest,hash:hex('b'),confirmed:r.confirmed,appliedAt:r.confirmed?now():null,cls:'directories',sealed:now(),seal:hex('c'),...over};
 return run('INSERT INTO review_receipts(family,id,owner_user_id,project_id,kind,target,outcome,payload_digest,request_hash,confirmed_by,applied_at,lifecycle_class,sealed_at,seal) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',f.family,f.id,f.owner,f.project,f.kind,f.target,f.outcome,f.digest,f.hash,f.confirmed,f.appliedAt,f.cls,f.sealed,f.seal);
};
const del=r=>run('DELETE FROM directory_reviews WHERE id=?',r.id),retained=/directory_retained/;
const exists=async r=>(await count('SELECT count(*) n FROM directory_reviews WHERE id=?',r.id))===1;
const slots=n=>'['+Array(n).fill(0).join(',')+']';
const setDraft=(p,n)=>run('UPDATE directories SET draft_json=? WHERE project_id=?',slots(n),p);
try{
 // Test-only: the confirm trigger needs a Chat turn and a published site per row; tests/directories.mjs covers that path.
 await run('DROP TRIGGER directory_review_confirm');
 const a=await owner(),b=await owner(),pa=await project(a),pb=await project(b);

 // Live identity: publish names its review and digest; edits keep it; unpublish clears it.
 const edit=await review(a,pa,'edit'),pub=await review(a,pa,'publish',{digest:hex('d')});
 assert.deepEqual({...await one('SELECT live_review_id,live_digest FROM directories WHERE project_id=?',pa)},{live_review_id:pub.id,live_digest:hex('d')});
 await review(a,pa,'edit');
 assert.equal((await one('SELECT live_review_id FROM directories WHERE project_id=?',pa)).live_review_id,pub.id,'an edit does not change the live snapshot');
 await assert.rejects(()=>run('UPDATE directories SET live_review_id=NULL WHERE project_id=?',pa),/CHECK|constraint/i);

 // Receipts bind every field the source row carries; nothing can be backdated, updated or removed early.
 for(const [label,over] of [['owner',{owner:b}],['project',{project:pb}],['kind',{kind:'withdrawal'}],['target',{target:pb}],['outcome',{outcome:'expired'}],['digest',{digest:hex('e')}],['confirming turn',{confirmed:'turn-other'}],['lifecycle class',{cls:'contacts'}],['sealed time',{sealed:past}]])
  await assert.rejects(()=>receipt(edit,over),/review_receipt_bind/,label);
 await assert.rejects(()=>receipt(edit,{family:'unknown_reviews'}),/CHECK|constraint/i);
 await assert.rejects(()=>receipt(edit,{seal:'xyz'}),/CHECK|constraint/i);
 await assert.rejects(()=>receipt({...edit,id:id()}),/review_receipt_bind/,'a receipt needs its still-present source row');
 await receipt(edit);
 await assert.rejects(()=>run('UPDATE review_receipts SET seal=? WHERE id=?',hex('f'),edit.id),/review_receipt_immutable/);
 await assert.rejects(()=>run('DELETE FROM review_receipts WHERE id=?',edit.id),/review_receipt_retained/);

 // Delete guard. Inside the newest-25 history window a receipted row stays...
 await assert.rejects(()=>del(edit),retained);
 const later=[];for(let n=0;n<26;n++)later.push(await review(a,pa,'edit'));
 // ...a row outside it needs its receipt, is never deleted while the live snapshot or a pending review needs it,
 const bare=await review(a,pa,'edit'); // newest: inside the window
 await assert.rejects(()=>del(later[0]),retained);                   // outside the window, no receipt
 await assert.rejects(()=>receipt(later[0],{outcome:'expired'}),/review_receipt_bind/,'an applied row cannot be sealed as expired');
 await receipt(later[0]);await del(later[0]);assert.equal(await exists(later[0]),false);
 await receipt(pub);await assert.rejects(()=>del(pub),retained);      // receipted but live-referenced
 const pending=await review(a,pa,'edit',{status:'pending'});
 await assert.rejects(()=>del(pending),retained);
 await assert.rejects(()=>receipt(pending),/review_receipt_bind/,'a pending unexpired row cannot be sealed');
 // expired pending rows (kept one hour past expiry, here long past) leave only as 'expired'.
 const stale=await review(a,pa,'edit',{status:'pending',expires:past});
 await assert.rejects(()=>del(stale),retained);
 await assert.rejects(()=>receipt(stale,{outcome:'applied'}),/review_receipt_bind/);
 await receipt(stale);await del(stale);assert.equal(await exists(stale),false);
 // withdrawals: applying unpublish clears the live reference, so the old publish row can then be compacted.
 const off=await review(a,pa,'unpublish');
 assert.equal((await one('SELECT live_review_id,live_digest FROM directories WHERE project_id=?',pa)).live_review_id,null);
 await del(pub);assert.equal(await exists(pub),false);
 await receipt(off);await del(off);assert.equal(await exists(off),false);
 // a newer pending withdrawal for the same target supersedes the older one; the newest cannot be sealed as superseded.
 const w1=await review(a,pa,'unpublish',{status:'pending'}),w2=await review(a,pa,'unpublish',{status:'pending'});
 await assert.rejects(()=>receipt(w2,{outcome:'superseded'}),/review_receipt_bind/);
 await receipt(w1,{outcome:'superseded'});await del(w1);assert.equal(await exists(w1),false);
 await assert.rejects(()=>del(w2),retained);

 // A safety hold keeps an otherwise eligible row and its receipt; release restores ordinary compaction.
 const held=await review(a,pa,'edit');for(let n=0;n<25;n++)await review(a,pa,'edit');
 await receipt(held);
 const hold='hold-'+id(),caseId='case-'+id();
 await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",caseId,a);
 await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",hold,caseId,a,pa);
 await assert.rejects(()=>del(held),retained);
 await run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?",hold);
 await del(held);assert.equal(await exists(held),false);

 // Capacity counts pending, unexpired, non-withdrawal rows only: 25 per project, 100 per owner. History never counts.
 for(let n=0;n<80;n++)await review(a,pa,'edit');
 assert.ok(await count('SELECT count(*) n FROM directory_reviews WHERE user_id=?',a)>100,'applied history exceeds the old lifetime cap');
 const active=(u,p=null)=>count("SELECT count(*) n FROM directory_reviews WHERE user_id=? AND (? IS NULL OR project_id=?) AND kind!='unpublish' AND status='pending' AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')",u,p,p);
 const pc=await project(a);
 for(let n=0;n<30;n++)await review(a,pc,'edit',{status:'pending',expires:past}); // expired rows are never counted
 while(await active(a,pc)<25)await review(a,pc,'edit',{status:'pending'});
 await assert.rejects(()=>review(a,pc,'edit',{status:'pending'}),/directory_capacity/);
 await review(a,pc,'unpublish',{status:'pending'});                  // withdrawals are exempt and uncounted
 await review(b,pb,'edit',{status:'pending'});                       // another owner is unaffected (B1)
 for(const p of [await project(a),await project(a),await project(a)])while(await active(a,p)<25&&await active(a)<100)await review(a,p,'edit',{status:'pending'});
 assert.equal(await active(a),100);
 const fresh=await project(a);
 await assert.rejects(()=>review(a,fresh,'edit',{status:'pending'}),/directory_capacity/);
 await review(a,pc,'unpublish',{status:'pending'});
 await review(b,pb,'edit',{status:'pending'});

 // Directory listing slots: 250 per owner, and past 1000 platform slots an owner holding more than 62 may not grow.
 const holders=[];
 for(let o=0;o<4;o++){const u=await owner();holders.push(u);for(let n=0;n<10;n++)await setDraft(await project(u),25);}
 const full=holders[0],extra=await project(full);
 await assert.rejects(()=>setDraft(extra,1),/directory_capacity/);
 const [first]=(await raw.prepare("SELECT d.project_id FROM directories d JOIN projects p ON p.id=d.project_id WHERE p.owner_user_id=? AND json_array_length(d.draft_json)=25 LIMIT 1").bind(full).all()).results;
 await setDraft(first.project_id,24);await setDraft(extra,1);        // shrinking elsewhere frees owner room
 const small=await owner(),smallProjects=[await project(small),await project(small),await project(small)];
 await setDraft(smallProjects[0],25);await setDraft(smallProjects[1],25);await setDraft(smallProjects[2],12);
 await assert.rejects(()=>setDraft(smallProjects[2],13),/directory_capacity/);
 await setDraft(smallProjects[2],0);                                 // removing listings is never refused

 // Project cleanup removes rows and receipts; no receipt is needed.
 await run('DELETE FROM projects WHERE id=?',pa);
 assert.equal(await count('SELECT count(*) n FROM directory_reviews WHERE project_id=?',pa),0);
 assert.equal(await count('SELECT count(*) n FROM review_receipts WHERE project_id=?',pa),0);
 console.log('Review receipts passed: sealed receipt binding and immutability, guarded compaction (window, live reference, holds, expiry, supersession), active-only capacity with exempt withdrawals, other owners unaffected, directory live identity and per-owner slot cap.');
}finally{await store.close();}
