import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,scopes=new Map(),scope=user=>scopes.get(user);
const {readBackendState,readBackendReview,prepareBackendState,confirmBackendState,backendStateHistory,exportBackendState,restoreBackendState}=m.backendState;
const {saveBackend}=m.backend,{backendAction,backendChatCommand}=m.backendChat;
const id=()=>crypto.randomUUID();
async function account(){const authority=await workspaceFixture(db,m),user=authority.account,project=id(),version=id(),now=new Date().toISOString();scopes.set(user,await authority.scope());await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Counter','','draft',?,?)").bind(project,user,now,now).run();await saveBackend(scope(user),user,project,version,'export default ({state,input})=>({state:{count:(state.count??0)+input.add},result:"Prepared"})');return {...authority,user,project,version};}
let calls=0;const service={fetch:async(_url,init)=>{calls++;const {input:{state,input}}=JSON.parse(init.body);return Response.json({ok:true,value:{state:{count:(state.count??0)+input.add},result:'Prepared'}});}};
const prepare=(a,r=id(),input={add:1},runtime=service,connection)=>prepareBackendState(connection??scope(a.user),runtime,a.user,a.project,a.version,r,input);
async function lossy(a,prefix){let lost=false;return a.scope(interceptDatabase(db,{test:q=>q.startsWith(prefix)},async()=>{},async()=>{if(!lost){lost=true;throw Error('lost acknowledgment');}}));}

try{
 const a=await account(),b=await account();
 assert.deepEqual((await readBackendState(scope(a.user),a.user,a.project)).state,{});
 await assert.rejects(readBackendState(scope(b.user),b.user,a.project),e=>e.status===404);
 const review=await prepare(a);assert.equal(review.status,'ready');assert.equal(calls,1);
 assert.deepEqual((await readBackendState(scope(a.user),a.user,a.project)).state,{});
 await assert.rejects(readBackendReview(scope(b.user),b.user,review.id),e=>e.status===404);
 await assert.rejects(confirmBackendState(scope(b.user),b.user,review.id),e=>e.status===404);
 assert.equal((await prepare(a,review.id)).status,'ready');assert.equal(calls,1);
 await assert.rejects(prepare(a,review.id,{add:9}),e=>e.status===409);
 await assert.rejects(db.prepare('UPDATE backend_state_reviews SET after_json=? WHERE id=?').bind('{"count":999}',review.id).run(),/immutable/);
 await assert.rejects(db.prepare('UPDATE backend_state SET state_json=? WHERE project_id=?').bind('{"count":999}',a.project).run(),/review_required/);
 // Competing reviews share the same base; only one can apply.
 const other=await prepare(a),competing=await Promise.allSettled([confirmBackendState(scope(a.user),a.user,review.id),confirmBackendState(scope(a.user),a.user,other.id)]);
 assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);assert.equal(competing.filter(x=>x.status==='rejected').length,1);
 assert.deepEqual(await readBackendState(scope(a.user),a.user,a.project),{projectId:a.project,revision:1,state:{count:1}});
 const winner=competing.find(x=>x.status==='fulfilled').value;
 await Promise.all(Array.from({length:6},()=>confirmBackendState(scope(a.user),a.user,winner.id)));assert.equal((await readBackendState(scope(a.user),a.user,a.project)).revision,1);
 // Lost review acknowledgment safely continues through the independent execution reservation.
 const lostReview=await prepare(a,id(),{add:2},service,await lossy(a,'INSERT INTO backend_state_reviews'));assert.equal(lostReview.status,'ready');
 const applied=await confirmBackendState(await lossy(a,"UPDATE backend_state_reviews SET status='applied'"),a.user,lostReview.id);assert.equal(applied.status,'applied');assert.equal((await readBackendState(scope(a.user),a.user,a.project)).state.count,3);
 // Expiry is enforced in SQLite, not merely by the caller's clock.
 const expired=id(),snapshot=await db.prepare('SELECT * FROM backend_state WHERE project_id=?').bind(a.project).first();
 await db.prepare("INSERT INTO backend_state_reviews(id,user_id,project_id,version_id,base_revision,before_json,input_json,expires_at) VALUES(?,?,?,?,?,?,'{}','2000-01-01T00:00:00.000Z')").bind(expired,a.user,a.project,a.version,snapshot.revision,snapshot.state_json).run();
 await db.prepare("UPDATE backend_state_reviews SET status='ready',after_json='{}',result_json='null' WHERE id=?").bind(expired).run();await assert.rejects(confirmBackendState(scope(a.user),a.user,expired),e=>e.status===409);
 // Invalid output is a failed immutable review, never a partial state write.
 for(const value of [{state:{count:100}},{state:{},result:null,extra:true},{state:'x'.repeat(4100),result:null},null]){const bad=await prepare(a,id(),{}, {fetch:async()=>Response.json({ok:true,value})});assert.equal(bad.status,'failed');await assert.rejects(confirmBackendState(scope(a.user),a.user,bad.id),e=>e.status===409);}
 assert.equal((await readBackendState(scope(a.user),a.user,a.project)).state.count,3);
 // Concurrent retry of preparation executes the guest once.
 const r=id(),before=calls;await Promise.all(Array.from({length:6},()=>prepare(a,r,{add:4})));assert.equal(calls,before+1);assert.equal((await readBackendReview(scope(a.user),a.user,r)).status,'ready');
 // Agent can prepare/read, but cannot confirm by action or extra field.
 const action={kind:'backend',operation:'reviewState',versionId:b.version,input:{add:8}},rid=id();const proposal=await backendAction(scope(b.user),b.user,rid,action,service);assert.match(proposal.reply,/Nothing has been applied/);
 assert.deepEqual((await readBackendState(scope(b.user),b.user,b.project)).state,{});
 await assert.rejects(backendAction(scope(b.user),b.user,id(),{...action,confirm:true},service),e=>e.status===400);
 await assert.rejects(backendAction(scope(b.user),b.user,id(),{kind:'backend',operation:'confirmState',reviewId:rid},service),e=>e.status===400);
 // The chat layer receipts an agent-prepared review's reply (linkChatReviewReply); this unit fixture has no turn, so seed the same rows.
 const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(proposal.reply)))].map(x=>x.toString(16).padStart(2,'0')).join('');
 await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'review',?,?,'ai','completed')").bind(rid,b.user,proposal.reply,new Date().toISOString()).run();
 await db.prepare("INSERT INTO chat_review_receipts(turn_id,user_id,kind,review_id,reply_digest) VALUES(?,?,'backendState',?,?)").bind(rid,b.user,rid,digest).run();
 assert.match(await backendChatCommand(scope(b.user),b.user,id(),'/confirm-backend-state '+rid,service)(),/Applied data review/);
 assert.equal((await readBackendState(scope(b.user),b.user,b.project)).state.count,8);
 assert.match((await backendAction(scope(b.user),b.user,id(),{kind:'backend',operation:'state',projectId:b.project},service)).reply,/"count":8/);
 // Restoration uses exact applied snapshots, without dispatching historical code.
 const history=await backendStateHistory(scope(a.user),a.user,a.project);assert.equal(history.currentRevision,2);assert.equal(history.snapshots.length,2);
 const exported=await exportBackendState(scope(a.user),a.user,lostReview.id);assert.deepEqual(exported.before.data,{count:1});assert.deepEqual(exported.after.data,{count:3});assert.equal(exported.after.sha256.length,64);assert.equal('input_json'in exported,false);
 await assert.rejects(exportBackendState(scope(b.user),b.user,lostReview.id),e=>e.status===404);
 await assert.rejects(exportBackendState(scope(a.user),a.user,r),e=>e.status===409);
 await assert.rejects(restoreBackendState(scope(b.user),b.user,id(),lostReview.id),e=>e.status===404);
 await assert.rejects(restoreBackendState(scope(a.user),a.user,id(),r),e=>e.status===409);
 const dispatches=calls,restoreId=id(),restored=await restoreBackendState(scope(a.user),a.user,restoreId,lostReview.id,'before');
 assert.equal(restored.status,'ready');assert.equal(restored.restore_side,'before');assert.equal(restored.after_json,'{"count":1}');assert.equal((await readBackendState(scope(a.user),a.user,a.project)).state.count,3);
 await assert.rejects(restoreBackendState(scope(a.user),a.user,restoreId,lostReview.id,'after'),e=>e.status===409);
 await assert.rejects(prepare(a,restoreId,null),e=>e.status===409);
 await assert.rejects(db.prepare('UPDATE backend_state_reviews SET restore_review_id=? WHERE id=?').bind(winner.id,restoreId).run(),/immutable/);
 const staleRestore=await restoreBackendState(scope(a.user),a.user,id(),winner.id,'after');
 await confirmBackendState(scope(a.user),a.user,restoreId);assert.equal((await readBackendState(scope(a.user),a.user,a.project)).state.count,1);
 await assert.rejects(confirmBackendState(scope(a.user),a.user,staleRestore.id),e=>e.status===409);
 const reset=await restoreBackendState(scope(a.user),a.user,id(),winner.id,'before');await confirmBackendState(scope(a.user),a.user,reset.id);assert.deepEqual((await readBackendState(scope(a.user),a.user,a.project)).state,{});assert.equal((await readBackendState(scope(a.user),a.user,a.project)).revision,4);
 const concurrentRestore=id();const repeated=await Promise.all(Array.from({length:6},()=>restoreBackendState(scope(a.user),a.user,concurrentRestore,lostReview.id,'after')));assert.ok(repeated.every(x=>x.after_json==='{"count":3}'));
 await confirmBackendState(await lossy(a,"UPDATE backend_state_reviews SET status='applied'"),a.user,concurrentRestore);await confirmBackendState(scope(a.user),a.user,concurrentRestore);assert.equal((await readBackendState(scope(a.user),a.user,a.project)).revision,5);assert.equal(calls,dispatches);
 assert.equal((await backendStateHistory(scope(a.user),a.user,a.project)).snapshots[0].restore_review_id,lostReview.id);
 // Database refuses a restore reservation targeting another tenant and a forged replacement.
 await assert.rejects(db.prepare("INSERT INTO backend_state_reviews(id,user_id,project_id,version_id,base_revision,before_json,input_json,restore_review_id,restore_side) VALUES(?,?,?,?,5,'{\"count\":3}','null',?,'after')").bind(id(),a.user,a.project,a.version,rid).run(),/restore_source/);
 const forged=id();await db.prepare("INSERT INTO backend_state_reviews(id,user_id,project_id,version_id,base_revision,before_json,input_json,restore_review_id,restore_side) VALUES(?,?,?,?,5,'{\"count\":3}','null',?,'after')").bind(forged,a.user,a.project,a.version,winner.id).run();
 await assert.rejects(db.prepare("UPDATE backend_state_reviews SET status='ready',after_json='{}',result_json='null' WHERE id=?").bind(forged).run(),/restore_immutable/);
 console.log('Backend state recovery checks passed: applied-only snapshots, scoped export, before/after recovery, initial-state recovery, stale rejection, replay, lost acknowledgment and no runtime dispatch.');
 console.log('Backend state checks passed: owner separation, immutable exact reviews, CAS race, replay, lost acknowledgments, expiry, invalid output and agent/user authority separation.');
}finally{await store.close();}
