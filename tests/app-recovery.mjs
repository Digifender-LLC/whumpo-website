import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function owner(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());return authority;}
async function loseResponse(user,pattern){let lost=false;return owners.get(user).scope(interceptDatabase(db,pattern,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost acknowledgment');}}));}
const {appRecoveryChatActions,describeAppRestore,worker:platform,sendChat,readChat}=m,{backendAction}=m.backendChat,recovery=m.appDocumentRecovery,backend=m.backend,activation=m.appActivation,data=m.appData;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const service={fetch:async(_url,init)=>Response.json({ok:true,value:{state:JSON.parse(init.body).input.input,result:'saved'}})};
try{
 const user=id(),other=id(),project=id(),version=id(),run=id();
 for(const u of [user,other])await owner(u);
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Recovery','','draft',?,?)").bind(project,user,now(),now()).run();
 await backend.saveBackend(scope(user),user,project,version,'export default ({state,input})=>({state:input,result:"saved"})');await backend.testBackend(scope(user),service,user,project,version,run,{state:{},input:{}});
 async function toggle(enabled){const review=id();await activation.prepareApplication(scope(user),user,project,review,enabled?'enable':'disable',enabled?version:null,enabled?run:null);await activation.confirmApplication(scope(user),user,review);}
 await toggle(true);
 async function visitor(){const v=id();await db.prepare('INSERT INTO app_visitors(id,project_id) VALUES(?,?)').bind(v,project).run();return {id:v,token:await data.issueAppSession(db,v)};}
 const a=await visitor(),b=await visitor();
 await data.transitionAppData(db,service,a.token,project,id(),0,{private:'original A'});await data.transitionAppData(db,service,b.token,project,id(),0,{private:'original B'});
 const point=id();await recovery.createRecoveryPoint(scope(user),user,project,point);
 await assert.rejects(recovery.listRecoveryPoints(scope(other),other,project),e=>e.status===404);
 assert.equal((await recovery.listRecoveryPoints(scope(user),user,project))[0].retainedDocuments,2);
 assert.ok(!JSON.stringify(await recovery.listRecoveryPoints(scope(user),user,project)).includes('original A'));
 await assert.rejects(db.prepare("UPDATE app_recovery_documents SET state_json='{}' WHERE point_id=?").bind(point).run());await assert.rejects(db.prepare('DELETE FROM app_recovery_documents WHERE point_id=?').bind(point).run());
 await assert.rejects(recovery.prepareAppRestore(scope(user),user,project,point,id()),e=>e.status===409);
 await data.transitionAppData(db,service,a.token,project,id(),1,{private:'new A'});await data.transitionAppData(db,service,b.token,project,id(),1,{private:'new B'});
 await toggle(false);
 const review=id();assert.equal((await recovery.prepareAppRestore(scope(user),user,project,point,review)).documents,2);
 await assert.rejects(recovery.confirmAppRestore(scope(user),user,project,review,'restore'),e=>e.status===400);await assert.rejects(recovery.confirmAppRestore(scope(other),other,project,review,'RESTORE'),e=>e.status===404);
 // Force failure on the second document: the first document and review must roll back.
 await db.exec(`CREATE TRIGGER recovery_fixture_fail BEFORE UPDATE ON app_documents WHEN NEW.visitor_id='${b.id}' BEGIN SELECT RAISE(ABORT,'fixture'); END;`);
 await assert.rejects(recovery.confirmAppRestore(scope(user),user,project,review,'RESTORE'),e=>e.status===409);
 assert.equal((await db.prepare('SELECT revision FROM app_documents WHERE visitor_id=?').bind(a.id).first()).revision,2);await db.exec('DROP TRIGGER recovery_fixture_fail');
 const lossy=await loseResponse(user,/^UPDATE app_restore_reviews/);
 assert.equal((await recovery.confirmAppRestore(lossy,user,project,review,'RESTORE')).status,'applied');
 assert.ok((await Promise.all([1,2,3].map(()=>recovery.confirmAppRestore(scope(user),user,project,review,'RESTORE')))).every(r=>r.status==='applied'));
 for(const [v,value] of [[a,'original A'],[b,'original B']]){const d=await db.prepare('SELECT * FROM app_documents WHERE visitor_id=?').bind(v.id).first();assert.equal(d.revision,3);assert.equal(JSON.parse(d.state_json).private,value);}
 assert.equal((await db.prepare('SELECT attempts FROM app_daily_usage WHERE project_id=?').bind(project).first()).attempts,4);
 assert.equal((await db.prepare('SELECT enabled FROM app_spaces WHERE project_id=?').bind(project).first()).enabled,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM app_sessions').first()).n,0);
 // Changing an active roster invalidates a review; revoked snapshots are removed.
 const stale=id();await recovery.prepareAppRestore(scope(user),user,project,point,stale);
 await db.prepare('UPDATE app_visitors SET revoked=1 WHERE id=?').bind(b.id).run();
 assert.equal((await db.prepare('SELECT count(*) n FROM app_recovery_documents WHERE visitor_id=?').bind(b.id).first()).n,0);
 await assert.rejects(recovery.confirmAppRestore(scope(user),user,project,stale,'RESTORE'),e=>e.status===409);
 await db.prepare('DELETE FROM app_visitors WHERE id=?').bind(b.id).run();
 const fresh=id();assert.equal((await recovery.prepareAppRestore(scope(user),user,project,point,fresh)).documents,1);assert.ok((await Promise.all([1,2,3].map(()=>recovery.confirmAppRestore(scope(user),user,project,fresh,'RESTORE')))).every(r=>r.status==='applied'));assert.equal(await db.prepare('SELECT id FROM app_visitors WHERE id=?').bind(b.id).first(),null);
 // Expired reviews cannot apply, even with an unchanged disabled app.
 const expired=id();await db.prepare("INSERT INTO app_restore_reviews(id,user_id,project_id,point_id,base_revision,roster_json,expires_at) SELECT ?,?,?,?,a.revision,r.roster_json,'2000-01-01T00:00:00.000Z' FROM app_spaces a JOIN app_recovery_rosters r ON r.project_id=a.project_id WHERE a.project_id=?").bind(expired,user,project,point,project).run();await assert.rejects(recovery.confirmAppRestore(scope(user),user,project,expired,'RESTORE'),e=>e.status===409);
 // Erasure of an active visitor also cascades saved documents without resurrection.
 await db.prepare('DELETE FROM app_visitors WHERE id=?').bind(a.id).run();assert.equal((await recovery.listRecoveryPoints(scope(user),user,project))[0].retainedDocuments,0);
 await toggle(true);const c=await visitor();await toggle(false);await assert.rejects(recovery.prepareAppRestore(scope(user),user,project,point,id()),e=>e.status===409);
 await assert.rejects(db.prepare('INSERT INTO app_recovery_documents SELECT ?,visitor_id,revision,state_json FROM app_documents WHERE visitor_id=?').bind(point,c.id).run());
 // Replaying a snapshot request never captures the later roster.
 await recovery.createRecoveryPoint(scope(user),user,project,point);assert.equal((await recovery.listRecoveryPoints(scope(user),user,project))[0].retainedDocuments,0);
 // Connected authenticated Chat controls, with no model or provider dispatch.
 const token=owners.get(user).token,staleToken=(await workspaceSession(db,m,owners.get(user),-700)).token;
 const env={DB:db,FILES:store.env.FILES,ENVIRONMENT:'local',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){throw Error('Unexpected AI work');}};
 const call=(body,cookie=token,origin='http://localhost')=>platform.fetch(new Request('http://localhost/api/chat'+(body?'/actions':''),{method:body?'POST':'GET',headers:{origin,cookie:'__Host-whumpo_session='+cookie,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
 // Disposable fixture preparation uses the internal adapter; restore approvals use the public typed route.
 async function chat(content,request=id()){
  const state=await readChat(scope(user),user),parts=content.split(' ');
  if(parts[0]==='/confirm-app-restore'){
   const response=await call({id:request,revision:state.state.revision,action:{type:'appRestore',projectId:parts[1],reviewId:parts[2],confirmation:parts[3]}});assert.equal(response.status,200,await response.clone().text());
  }else assert.equal((await sendChat(scope(user),user,{id:request,revision:state.state.revision,content})).status,200);
  return (await readChat(scope(user),user)).turns.find(t=>t.id===request).assistant_text;
 }
 const saved=id();assert.match(await chat('/save-app-recovery '+project,saved),/Saved private application recovery/);
 const reviewed=id();assert.match(await chat(`/review-app-restore ${project} ${saved}`,reviewed),/Replace the saved documents of 1/);
 const readyChat=await(await call()).json();assert.equal(readyChat.turns.find(t=>t.id===reviewed).app_restore_review.state,'ready');
 const pendingText=readyChat.turns.find(t=>t.id===reviewed).assistant_text;
 const forged=[{id:reviewed,user_text:'fixture',assistant_text:pendingText+' Changed',status:'completed'},{id:reviewed,user_text:'fixture',assistant_text:pendingText,status:'pending'},{id:id(),user_text:'fixture',assistant_text:pendingText,status:'completed'}];await appRecoveryChatActions(scope(user),user,forged);assert.ok(forged.every(t=>!t.app_restore_review));
 const foreign=[{id:reviewed,user_text:'fixture',assistant_text:pendingText,status:'completed'}];await appRecoveryChatActions(scope(other),other,foreign);assert.ok(!foreign[0].app_restore_review);
 const expiredRow=await recovery.readAppRestore(scope(user),user,project,expired),expiredTurn={id:id(),user_text:`/app-restore-review ${project} ${expired}`,assistant_text:describeAppRestore(expiredRow),status:'completed'};await appRecoveryChatActions(scope(user),user,[expiredTurn]);assert.equal(expiredTurn.app_restore_review,undefined,'Command text without a saved receipt cannot select a review');
 await chat(`/app-restore-review ${project} ${expired}`,expiredTurn.id);const expiredSaved=(await readChat(scope(user),user)).turns.find(t=>t.id===expiredTurn.id);assert.equal(expiredSaved.app_restore_review.state,'expired');
 const listing=await chat('/app-recovery '+project);assert.ok(listing.includes(saved));assert.ok(!listing.includes(c.id));
 await assert.rejects(backendAction(scope(user),user,id(),{kind:'backend',operation:'confirmAppRestore',projectId:project,targetId:reviewed}));
 assert.match((await backendAction(scope(user),user,id(),{kind:'backend',operation:'appRestoreReview',projectId:project,targetId:reviewed})).reply,/Status: pending/);
 const request={id:id(),revision:0,action:{type:'appRestore',projectId:project,reviewId:reviewed,confirmation:'RESTORE'}};
 assert.equal((await call(request,'')).status,401);assert.equal((await call(request,token,'https://foreign.test')).status,403);
 assert.equal((await call(request,staleToken)).status,401);
 assert.match(await chat(`/confirm-app-restore ${project} ${reviewed} RESTORE`),/Status: applied/);
 const appliedChat=await(await call()).json();assert.equal(appliedChat.turns.find(t=>t.id===reviewed).app_restore_review.state,'applied');
 const doomed=id();await chat(`/review-app-restore ${project} ${saved}`,doomed);
 assert.match(await chat(`/remove-app-recovery ${project} ${saved} REMOVE`),/removed/);
 const changedChat=await(await call()).json();assert.equal(changedChat.turns.find(t=>t.id===doomed).app_restore_review.state,'changed');assert.equal(changedChat.turns.find(t=>t.id===reviewed).app_restore_review.state,'applied');
 assert.equal((await db.prepare('SELECT count(*) n FROM app_recovery_documents WHERE point_id=?').bind(saved).first()).n,0);
 assert.equal((await recovery.createRecoveryPoint(scope(user),user,project,saved)).removed,1);
 await assert.rejects(recovery.confirmAppRestore(scope(user),user,project,doomed,'RESTORE'),e=>e.status===409);
 assert.deepEqual(await recovery.removeRecoveryPoint(scope(user),user,project,saved,'REMOVE'),{id:saved,removed:true});
 assert.equal((await db.prepare('SELECT count(*) n FROM inference_calls').first()).n,0);
 console.log('Recovery Chat passed: owned metadata, internal save/review/remove and typed restore approval, unknown model-confirm refusal, origin/anonymous/stale-session denial, tombstone replay and removed-point rejection; zero inference.');
 console.log('Application recovery passed: atomic snapshots/restoration, private summaries, sealed documents, disabled-only review, owner/confirmation guards, lost-response and concurrent replay, rollback on partial failure, monotonic revisions, preserved usage, roster conflicts, revoked/erased document removal and no identity resurrection.');
}finally{await store.close();}
