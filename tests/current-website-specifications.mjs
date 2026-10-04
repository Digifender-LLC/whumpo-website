import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import assert from 'node:assert/strict';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {unzipSync} from 'fflate';
import {sqliteD1} from './sqlite-d1.mjs';
Error.stackTraceLimit=0;
const m=await currentSiteFixtureHandlers(),owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
const {db,sql,close}=await sqliteD1(),id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),owner=id(),other=id(),project=id(),foreignProject=id();
const config={name:'Garden',headline:'A greener neighborhood',description:'Local landscaping',theme:'ocean',aboutTitle:'Our work',aboutText:'We care for local gardens.',sections:[],photos:[]};
const ai={baseURL:'https://provider.test/v1',apiKey:'fixture',model:'fixture',protocol:'responses'};
const fetch=globalThis.fetch;let queue=[],calls=0;
globalThis.fetch=async(url,options)=>{assert.equal(String(url),ai.baseURL+'/responses');calls++;assert.ok(queue.length,'Unexpected model call');return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Here is the requested work.',action:queue.shift()})}]}],usage:{input_tokens:200,output_tokens:100}});};
async function ask(action,user=owner,requestId=id()){
 const revision=(await m.readChat(scope(user),user)).state.revision;queue.push(action);assert.equal((await m.sendConversation(scope(user),user,{id:requestId,revision,content:'Please make the requested website change.'},ai)).status,200);
 const turn=(await m.readChat(scope(user),user)).turns.find(t=>t.id===requestId);assert.ok(turn);return {turn,revision};
}
async function apply(review,database=scope(owner)){const request={id:id(),revision:(await m.readChat(scope(owner),owner)).state.revision,action:{type:'specificationApply',reviewId:review.id,proposalDigest:review.proposalDigest,expectedRevision:review.expectedRevision}};return {request,result:await m.sendChatControl(database,owner,request)};}
try{
 for(const user of [owner,other]){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());await m.readChat(scope(user),user);sql.prepare("UPDATE workspace_state SET step='ready' WHERE user_id=?").run(user);}
 for(const [p,u] of [[project,owner],[foreignProject,other]])sql.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',?,?)").run(p,u,now(),now());
 const first=await ask({kind:'specification',operation:'create',projectId:project,config});assert.equal(first.turn.status,'completed',first.turn.assistant_text);assert.equal(first.turn.version_id,first.turn.id);
 const saved=await m.readSpecification(scope(owner),owner,project);assert.equal(saved.revision,1);assert.equal(saved.specification.schemaVersion,3);assert.deepEqual(saved.specification.instances,[]);assert.deepEqual(saved.specification.pages[0].photos,[]);assert.equal(saved.otherDraftChanges,false);
 assert.equal(sql.prepare('SELECT count(*) n FROM project_spec_creations WHERE project_id=?').get(project).n,1);
 assert.equal((await m.ownedPreview({DB:scope(owner)},owner,first.turn.id)).status,200);assert.ok(await m.ownedExport(scope(owner),owner,first.turn.id));
 const initialCalls=calls;assert.equal((await m.sendConversation(scope(owner),owner,{id:first.turn.id,revision:first.revision,content:'Please make the requested website change.'},ai)).status,200);assert.equal(calls,initialCalls);
 const duplicate=await ask({kind:'specification',operation:'create',projectId:project,config});assert.match(duplicate.turn.assistant_text,/already has a website/);assert.equal((await m.readSpecification(scope(owner),owner,project)).revision,1);
 for(const action of [{kind:'preview',projectId:project,config},{kind:'edit',baseVersionId:first.turn.id,changes:{theme:'clay'}},{kind:'specification',operation:'import',projectId:project,expectedRevision:1,versionId:first.turn.id}]){await ask(action);assert.equal((await m.readSpecification(scope(owner),owner,project)).revision,1);}
 const foreign=await ask({kind:'specification',operation:'create',projectId:project,config},other);assert.match(foreign.turn.assistant_text,/not found/);
 const change={kind:'specification',operation:'change',projectId:project,expectedRevision:1,operations:[{type:'design.setTheme',theme:'clay'},{type:'pages.setSections',pageId:'home',sections:[{heading:'Services',text:'Care and planting.'}]}]};
 const prepared=await ask(change);assert.equal(prepared.turn.status,'completed',prepared.turn.assistant_text);assert.ok(prepared.turn.specification_review,prepared.turn.assistant_text);
 assert.equal((await m.readSpecification(scope(owner),owner,project)).revision,1);assert.match(await(await m.specificationPreview(scope(owner),owner,prepared.turn.id)).text(),/Care and planting/);
 const competing=await ask({...change,operations:[{type:'design.setTheme',theme:'forest'}]});assert.ok(competing.turn.specification_review);
 let lost=false;const lossy=await owners.get(owner).scope(interceptDatabase(db,/^INSERT INTO project_spec_applies/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost response after commit');}}));
 const approved=await apply(prepared.turn.specification_review,lossy);assert.equal(approved.result.status,200);assert.ok(lost);assert.equal((await m.readSpecification(scope(owner),owner,project)).revision,2);
 assert.equal((await m.sendChatControl(scope(owner),owner,approved.request)).status,200);assert.equal((await m.readSpecification(scope(owner),owner,project)).revision,2);
 await assert.rejects(apply(competing.turn.specification_review),e=>e.status===409);
 const restored=await ask({kind:'specification',operation:'restore',projectId:project,expectedRevision:2,versionId:first.turn.id});assert.ok(restored.turn.specification_review);assert.equal((await apply(restored.turn.specification_review)).result.status,200);assert.equal((await m.readSpecification(scope(owner),owner,project)).revision,3);
 const created=await ask({kind:'project',purpose:'A second landscaping project',config:{...config,name:'Second garden'}});assert.equal(created.turn.status,'completed',created.turn.assistant_text);assert.equal((await m.readSpecification(scope(owner),owner,created.turn.id)).revision,1);
 const publication=await ask({kind:'review',operation:'publish',targetId:first.turn.id});assert.equal(publication.turn.confirmation_id,publication.turn.id);assert.equal((await m.sendChatControl(scope(owner),owner,{id:id(),revision:(await m.readChat(scope(owner),owner)).state.revision,action:{type:'confirm',kind:'site',reviewId:publication.turn.id}})).status,200);
 assert.equal((await m.host.fetch(new Request('https://'+project+'.whumpo.site/'),{DB:db})).status,200);
 const oldProject=id(),old=id();sql.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Obsolete','Testing','draft',?,?)").run(oldProject,owner,now(),now());
 const row=sql.prepare('SELECT * FROM site_versions WHERE id=?').get(first.turn.id);sql.prepare('INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at,source) VALUES(?,?,?,?,?,?,?,?)').run(old,oldProject,row.component_id,row.config_json,row.html,row.digest,now(),'ai');
 await assert.rejects(m.ownedExport(scope(owner),owner,old),e=>e.status===409);await assert.rejects(m.ownedPreview({DB:scope(owner)},owner,old),e=>e.status===409);
 const retired=m.currentCompilerLock();retired.compiler.version=1;await assert.rejects(m.compileProjectSpecification(saved.specification,retired),e=>e.code==='COMPILER_LOCK_MISMATCH');
 const version1={...saved.specification,schemaVersion:1};await assert.rejects(m.compileProjectSpecification(version1,m.currentCompilerLock()),e=>e.code==='UNSUPPORTED_VERSION');
 // Schema 2 / project-content@2 were reset at the schema 3 cutover: no reader, lock or SQL admission remains.
 const schema2={...saved.specification,schemaVersion:2,records:[],forms:[],files:[],access:{roles:[]}};delete schema2.instances;await assert.rejects(m.compileProjectSpecification(schema2,m.currentCompilerLock()),e=>e.code==='UNSUPPORTED_VERSION');
 const lock2=m.currentCompilerLock();lock2.compiler.version=2;lock2.schemaVersion=2;await assert.rejects(m.compileProjectSpecification(saved.specification,lock2),e=>e.code==='COMPILER_LOCK_MISMATCH');
 const savedRow=sql.prepare('SELECT * FROM project_spec_versions WHERE version_id=?').get(first.turn.id);
 assert.throws(()=>sql.prepare('INSERT INTO project_spec_versions(version_id,project_id,revision,proposal_id,spec_json,spec_digest,lock_json,manifest_json,manifest_digest) VALUES(?,?,?,?,?,?,?,?,?)').run(id(),project,99,id(),JSON.stringify(schema2),savedRow.spec_digest,savedRow.lock_json,savedRow.manifest_json,savedRow.manifest_digest),/specification_current_required/);
 assert.throws(()=>sql.prepare('INSERT INTO project_spec_versions(version_id,project_id,revision,proposal_id,spec_json,spec_digest,lock_json,manifest_json,manifest_digest) VALUES(?,?,?,?,?,?,?,?,?)').run(id(),project,99,id(),savedRow.spec_json,savedRow.spec_digest,JSON.stringify(lock2),savedRow.manifest_json,savedRow.manifest_digest),/specification_current_required/);
 // project-content@3/@4 snapshots were reset at the project-content@5 cutover: the lock and SQL admission both refuse them.
 for(const prior of [3,4]){
  const old=m.currentCompilerLock();old.compiler.version=prior;await assert.rejects(m.compileProjectSpecification(saved.specification,old),e=>e.code==='COMPILER_LOCK_MISMATCH');
  assert.throws(()=>sql.prepare('INSERT INTO project_spec_versions(version_id,project_id,revision,proposal_id,spec_json,spec_digest,lock_json,manifest_json,manifest_digest) VALUES(?,?,?,?,?,?,?,?,?)').run(id(),project,99,id(),savedRow.spec_json,savedRow.spec_digest,JSON.stringify(old),savedRow.manifest_json,savedRow.manifest_digest),/specification_current_required/);
 }
 // Current photos remain reviewed, owned and digest-verified. These are explicitly synthetic
 // safety receipts for boundary testing; no scanning provider or detector is exercised.
 const objects=new Map(),files={get:async key=>{const value=objects.get(key);return value?{size:value.bytes.length,customMetadata:{sha256:value.digest},body:new ReadableStream(),arrayBuffer:async()=>value.bytes.slice().buffer}:null;}};
 async function photo(p,approved=true,expires=new Date(Date.now()+3600000).toISOString()){
  const key=id(),bytes=new TextEncoder().encode('synthetic-photo-'+key),digest=await m.hashToken(new TextDecoder().decode(bytes));objects.set(key,{bytes,digest});
  sql.prepare("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,'Fixture photo',?,?,?,1,1,'ready',?)").run(key,p,key,digest,bytes.length,now());
  if(approved)sql.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-fixture',expires_at=? WHERE file_id=?").run(expires,key);
  return key;
 }
 const good=await photo(project),pending=await photo(project,false),expired=await photo(project,true,'2000-01-01T00:00:00.000Z'),foreignPhoto=await photo(foreignProject),wrongProject=await photo(created.turn.id);
 const photos=[{id:good,alt:'Tidy garden'}];
 for(const key of [pending,expired,foreignPhoto,wrongProject]){
  const refused=await ask({kind:'specification',operation:'change',projectId:project,expectedRevision:3,operations:[{type:'pages.setPhotos',pageId:'home',photos:[{id:key,alt:'Photo'}]}]});assert.equal(refused.turn.specification_review,undefined);assert.match(refused.turn.assistant_text,/unavailable or held/);
 }
 const adding=await ask({kind:'specification',operation:'change',projectId:project,expectedRevision:3,operations:[{type:'pages.setPhotos',pageId:'home',photos}]});assert.ok(adding.turn.specification_review);
 const inline=await m.specificationPreview(scope(owner),owner,adding.turn.id,false,files);assert.match(await inline.text(),/src="data:image\/jpeg;base64,/);assert.match(inline.headers.get('content-security-policy'),/img-src data:/);
 await assert.rejects(m.specificationPreview(scope(other),other,adding.turn.id,false,files),e=>e.status===404);
 const correct=objects.get(good);objects.set(good,{...correct,bytes:new Uint8Array(correct.bytes.length)});await assert.rejects(m.specificationPreview(scope(owner),owner,adding.turn.id,false,files),e=>e.status===503);objects.set(good,correct);
 const photoSaved=await apply(adding.turn.specification_review);assert.equal(photoSaved.result.status,200);const photoVersion=photoSaved.request.id;
 assert.equal(sql.prepare('SELECT component_id FROM site_versions WHERE id=?').get(photoVersion).component_id,'photo-page@1');
 const archive=unzipSync(await m.ownedExport(scope(owner),owner,photoVersion,files));assert.deepEqual(archive['public/assets/'+good+'.jpg'],correct.bytes);
 assert.match(await(await m.ownedPreview({DB:db,FILES:files},owner,photoVersion)).text(),/data:image\/jpeg/);
 const pub=await ask({kind:'review',operation:'publish',targetId:photoVersion});assert.equal((await m.sendChatControl(scope(owner),owner,{id:id(),revision:(await m.readChat(scope(owner),owner)).state.revision,action:{type:'confirm',kind:'site',reviewId:pub.turn.id}})).status,200);
 const asset=()=>m.host.fetch(new Request('https://'+project+'.whumpo.site/assets/'+good+'.jpg'),{DB:db,FILES:files});assert.deepEqual(new Uint8Array(await(await asset()).arrayBuffer()),correct.bytes);
 const removing=await ask({kind:'specification',operation:'change',projectId:project,expectedRevision:4,operations:[{type:'pages.setPhotos',pageId:'home',photos:[]}]});assert.equal((await apply(removing.turn.specification_review)).result.status,200);
 assert.equal((await m.readSpecification(scope(owner),owner,project)).specification.pages[0].component,'site-page@1');assert.equal((await asset()).status,200,'Private edits must not change the published pointer');
 // A photo revoked after validation aborts the complete save, including its success turn.
 const late=await ask({kind:'specification',operation:'change',projectId:project,expectedRevision:5,operations:[{type:'pages.setPhotos',pageId:'home',photos}]});const q=late.turn.specification_review,lateTurn=id();
 const preparedLate=await m.applySpecificationCommand(scope(owner),owner,lateTurn,`/confirm-specification ${q.id} ${q.proposalDigest} ${q.expectedRevision}`);
 sql.prepare("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?").run(good);
 await assert.rejects(scope(owner).batch([scope(owner).prepare('INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,action_json) VALUES(?,?,?,?,?,?,?)').bind(lateTurn,owner,(await m.readChat(scope(owner),owner)).state.revision+1,'Save reviewed website changes',preparedLate.reply,now(),JSON.stringify({type:'specificationApply',reviewId:q.id,proposalDigest:q.proposalDigest,expectedRevision:q.expectedRevision})),...preparedLate.statements]),/photo_safety_required/);
 for(const [table,key] of [['chat_turns','id'],['site_versions','id'],['project_spec_applies','id'],['project_spec_versions','version_id']])assert.equal(sql.prepare(`SELECT ${key} FROM ${table} WHERE ${key}=?`).get(lateTurn),undefined);
 assert.equal((await m.readSpecification(scope(owner),owner,project)).revision,5);assert.equal((await asset()).status,404);
 // A first draft carrying photos saves all references in its creation transaction.
 const newProject=id();sql.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Photos','Testing','draft',?,?)").run(newProject,owner,now(),now());
 const firstPhoto=await photo(newProject),initialPhoto=await ask({kind:'specification',operation:'create',projectId:newProject,config:{...config,photos:[{id:firstPhoto,alt:'Garden'}]}});assert.equal(initialPhoto.turn.version_id,initialPhoto.turn.id);assert.equal(sql.prepare('SELECT count(*) n FROM version_photos WHERE version_id=?').get(initialPhoto.turn.id).n,1);
 // Competing initial writes are prepared before either commits. Only one can establish a head.
 const racingProject=id();sql.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Race','Testing','draft',?,?)").run(racingProject,owner,now(),now());
 const firstTurn=id(),secondTurn=id(),requests=await Promise.all([m.createWebsite(scope(owner),owner,firstTurn,racingProject,config),m.createWebsite(scope(owner),owner,secondTurn,racingProject,config)]);
 const initialBatch=(turn,prepared,action=null)=>[scope(owner).prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at,action_json) VALUES(?,?,?,'Create my website',?,'ai','pending',?,?)").bind(turn,owner,(awaitRevision++),prepared.reply,now(),action),...prepared.statements,scope(owner).prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),scope(owner).prepare('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?').bind(owner)];
 let awaitRevision=(await m.readChat(scope(owner),owner)).state.revision+1;
 await scope(owner).batch(initialBatch(firstTurn,requests[0]));await assert.rejects(scope(owner).batch(initialBatch(secondTurn,requests[1])),/specification_changed/);
 assert.equal(sql.prepare('SELECT count(*) n FROM site_versions WHERE project_id=?').get(racingProject).n,1);assert.equal(sql.prepare('SELECT id FROM chat_turns WHERE id=?').get(secondTurn),undefined);
 // Known held content cannot get an initial receipt, including a hold added after preparation.
 const heldProject=id();sql.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Hold','Testing','draft',?,?)").run(heldProject,other,now(),now());
 const heldTurn=id(),heldDraft=await m.createWebsite(scope(other),other,heldTurn,heldProject,config),compiled=await m.compileNewWebsite(config);
 sql.prepare("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-policy',1,1,'risk_or_missing_history',100,60)").run(other,compiled.specificationDigest);
 await assert.rejects(scope(other).batch([scope(other).prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES(?,?,100,'Create my website',?,'ai','pending',?)").bind(heldTurn,other,heldDraft.reply,now()),...heldDraft.statements]),/specification_held/);
 assert.equal(sql.prepare('SELECT id FROM site_versions WHERE id=?').get(heldTurn),undefined);assert.equal(sql.prepare('SELECT id FROM chat_turns WHERE id=?').get(heldTurn),undefined);
 // Immutable creation receipts and parent cleanup use the same retention policy as reviewed saves.
 assert.throws(()=>sql.prepare('DELETE FROM project_spec_creations WHERE project_id=?').run(newProject),/specification_receipt_retained/);
 sql.prepare('DELETE FROM projects WHERE id=?').run(newProject);assert.equal(sql.prepare('SELECT id FROM project_spec_creations WHERE project_id=?').get(newProject),undefined);
 // The 25-version limit rolls back approval atomically; removing an old version frees one slot.
 const capped=await createFixtureProject(scope(owner),owner,'Capacity fixture','Synthetic website capacity');
 for(let n=2;n<=25;n++)await changeFixtureWebsite(scope(owner),owner,capped.project,[{type:'content.replace',contentId:'headline',text:'Version '+n}]);
 const fullReview=(await ask({kind:'specification',operation:'change',projectId:capped.project,expectedRevision:25,operations:[{type:'content.replace',contentId:'headline',text:'Version 26'}]})).turn.specification_review;
 const beforeFull=(await m.readChat(scope(owner),owner)).state.revision,blocked=await apply(fullReview);
 assert.equal(blocked.result.status,409);assert.equal((await m.readChat(scope(owner),owner)).state.revision,beforeFull);
 assert.equal((await m.readSpecification(scope(owner),owner,capped.project)).revision,25);
 for(const [table,key] of [['chat_turns','id'],['site_versions','id'],['project_spec_applies','id']])assert.equal(sql.prepare(`SELECT ${key} FROM ${table} WHERE ${key}=?`).get(blocked.request.id),undefined);
 const deletion=await ask({kind:'versionRemovalReview',versionId:capped.version});assert.equal(deletion.turn.version_confirmation_id,deletion.turn.id);
 assert.equal((await m.sendChatControl(scope(owner),owner,{id:id(),revision:(await m.readChat(scope(owner),owner)).state.revision,action:{type:'confirm',kind:'version',reviewId:deletion.turn.id}})).status,200);
 assert.equal((await apply(fullReview)).result.status,200);assert.equal((await m.readSpecification(scope(owner),owner,capped.project)).revision,26);
 assert.equal(sql.prepare('SELECT count(*) n FROM site_versions WHERE project_id=?').get(capped.project).n,25);
 assert.equal(queue.length,0);
 console.log('Current website specifications passed: direct first/project creation, atomic head/receipts, retired action/schema/lock refusal, reviewed edits/forward restore, competing reviews, lost-response replay, private export/preview, publication, photo ownership/clearance/integrity and late-revocation rollback, competing first creation, late content holds, receipt retention, quota rollback/slot recovery and foreign isolation. Actual handlers with disposable SQLite and scripted inference.');
}finally{globalThis.fetch=fetch;close();}
