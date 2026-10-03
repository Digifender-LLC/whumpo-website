// Synthetic ready/held metadata only; no detector, image bytes or real inference.
import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/index.ts','src/chat-interactions/store.ts','src/chat-interactions/submitted-context.ts','src/chat-interactions/task-context.ts']);
const store=await modules.module('src/chat-interactions/store.ts'),submitted=await modules.module('src/chat-interactions/submitted-context.ts'),tasks=await modules.module('src/chat-interactions/task-context.ts'),worker=(await modules.module('src/index.ts')).default;
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();let cases=0,network=0;
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Unexpected inference/provider request');};
const fields=[{id:'look',questionId:'visual-style',required:false},{id:'photos',questionId:'gallery-photos',required:false,when:{fieldId:'look',equals:'bold'}}];
const client={versions:[1],fieldTypes:['resource','choice'],bindings:['answer.value@1','interaction.answers@1','agent.task-continue@1','owned.photos@1']};
async function project(user){const p=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Public garden photos','draft',datetime('now'),datetime('now'))",p,user);return p;}
async function owner(){const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),p=await project(user);await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);for(const operation of ['prepare','read'])await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing',?,'private-test-acceptance','synthetic photo selection',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,p,operation);return {authority,user,scope,project:p};}
async function photo(p,name,state='approved'){
 const f=id();await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,?,?,?,1024,640,480,?,datetime('now'))",f,p,name,'PRIVATE_KEY_CANARY/'+f,'a'.repeat(64),state==='uploading'?'pending':'ready');
 if(state==='approved'||state==='expired')await run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-only',expires_at=? WHERE file_id=?",new Date(Date.now()+(state==='expired'?-3600000:3600000)).toISOString(),f);
 if(state==='blocked')await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",f);return f;
}
async function origin(o,pending=false){const t=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Choose photos for this website','Review your choices',datetime('now'),'ai',? FROM workspace_state WHERE user_id=?",t,pending?'pending':'completed',o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);return t;}
async function issue(o){return store.issueInformation(o.scope,o.user,{originTurnId:await origin(o),projectId:o.project,purpose:'site.presentation@1',fields});}
const mutation=(f,operation,answers)=>({version:1,requestId:id(),interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision,operation,...(operation==='cancel'?{}:{answers})});
const lookup=f=>({interactionId:f.envelope.id,taskId:f.envelope.scope.taskId,projectId:f.envelope.scope.projectId,submissionId:f.submission.id,fieldIds:['photos']});
async function replace(o,f,changes){const input={originTurnId:await origin(o),previousInteractionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision};return changes?store.proposeAnswers(o.scope,o.user,{...input,changes}):store.replaceInformation(o.scope,o.user,{...input,fields});}
async function http(o,path,body,status=200){const response=await worker.fetch(new Request('https://whumpo.com/api/chat/interactions/v1/'+path,{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json',cookie:'__Host-whumpo_session='+o.authority.token},body:JSON.stringify(body)}),{DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},{waitUntil(){}});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;}
async function test(name,fn){try{await fn();cases++;}catch(error){console.error(name,error);throw error;}}
try{
 await test('current photo form negotiates its owned binding and lists only same-project approved metadata',async()=>{
  const o=await owner(),other=await owner(),sameOwner=await project(o.user),good=await photo(o.project,'Blue flowers'),f=await issue(o);
  for(const state of ['pending','blocked','expired','uploading'])await photo(o.project,'HIDDEN_'+state,state);
  await photo(other.project,'FOREIGN_PHOTO');await photo(sameOwner,'OTHER_PROJECT');
  await http(o,'read',{version:1,interactionId:f.envelope.id,client});await http(o,'read',{version:1,interactionId:f.envelope.id,client:{...client,bindings:client.bindings.filter(b=>b!=='owned.photos@1')}},409);
  const request={version:1,interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,fieldId:'photos',limit:20,before:null},page=await http(o,'resources',request);
  assert.deepEqual(page.items,[{id:good,name:'Blue flowers',photo:{width:640,height:480,size:1024}}]);assert.equal(page.collection,'photos');assert.doesNotMatch(JSON.stringify(page),/PRIVATE_KEY|digest|HIDDEN|FOREIGN|OTHER_PROJECT/);
  await http(other,'resources',request,404);await http(o,'resources',{...request,fieldId:'look'},409);
 });
 await test('draft/submit reject hidden, foreign, held, removed, duplicate and excessive IDs',async()=>{
  const o=await owner(),other=await owner(),f=await issue(o),good=await photo(o.project,'Good'),wrong=await photo(other.project,'Foreign'),held=await photo(o.project,'Held','pending'),expired=await photo(o.project,'Expired','expired'),same=await photo(await project(o.user),'Other project');
  for(const operation of ['save-draft','submit'])for(const answers of [{look:'warm',photos:[good]},{look:'bold',photos:[wrong]},{look:'bold',photos:[held]},{look:'bold',photos:[expired]},{look:'bold',photos:[same]},{look:'bold',photos:[id()]},{look:'bold',photos:[good,good]},{look:'bold',photos:Array.from({length:5},id)}])await http(o,'mutate',mutation(f,operation,answers),422);
  assert.equal((await store.readInteraction(o.scope,o.user,f.envelope.id)).answerRevision,0);
  await http(o,'mutate',mutation(f,'save-draft',{look:'bold',photos:[good]}));const saved=await store.readInteraction(o.scope,o.user,f.envelope.id);assert.deepEqual(saved.draft,{look:'bold',photos:[good]});assert.doesNotMatch(JSON.stringify(saved),/Good|PRIVATE_KEY/);
  const request=mutation(saved,'submit',{look:'bold',photos:[good]}),receipt=await http(o,'mutate',request);await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",good);
  assert.deepEqual(await http(o,'mutate',request),receipt,'Exact replay returns prior fact, never accesses a photo again');
 });
 await test('late clearance or deletion changes cannot commit a draft or answer',async()=>{
  for(const operation of ['save-draft','submit'])for(const change of ['blocked','removed']){
   const o=await owner(),f=await issue(o),good=await photo(o.project,'Race');let changed=false;
   const scoped=await o.authority.scope(interceptDatabase(db,/^UPDATE chat_interactions SET answer_revision/,async()=>{changed=true;if(change==='removed')await run('DELETE FROM project_files WHERE id=?',good);else await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",good);}));
   await assert.rejects(()=>store.mutateInteraction(scoped,o.user,mutation(f,operation,{look:'bold',photos:[good]})));assert(changed);assert.equal((await store.readInteraction(o.scope,o.user,f.envelope.id)).answerRevision,0);
  }
 });
 await test('submitted processing contains only selected metadata and carries current guards',async()=>{
  const o=await owner(),f=await issue(o),good=await photo(o.project,'Selected flowers'),unselected=await photo(o.project,'UNSELECTED_CANARY');await http(o,'mutate',mutation(f,'submit',{look:'bold',photos:[good]}));const saved=await store.readInteraction(o.scope,o.user,f.envelope.id),turn=await origin(o,true);
  const read=await submitted.readSubmittedAnswers(o.scope,o.user,turn,lookup(saved));assert.deepEqual(read.data.answers,{photos:[good]});assert.deepEqual(read.data.selectedPhotos,[{id:good,project_id:o.project,name:'Selected flowers',width:640,height:480}]);assert.doesNotMatch(JSON.stringify(read.data),/PRIVATE_KEY|UNSELECTED_CANARY|digest/);
  const task=await tasks.prepareInformationTask(o.scope,o.user,saved.submission.id);assert.deepEqual(task.context.photos,read.data.selectedPhotos);assert.doesNotMatch(JSON.stringify(task.context),new RegExp(unselected));
  await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",good);await assert.rejects(()=>o.scope.batch(read.guards));await assert.rejects(()=>submitted.readSubmittedAnswers(o.scope,o.user,turn,lookup(saved)),e=>e.code==='RESOURCE_UNAVAILABLE');await assert.rejects(()=>tasks.prepareInformationTask(o.scope,o.user,saved.submission.id),e=>e.code==='RESOURCE_UNAVAILABLE');
  const text=await submitted.readSubmittedAnswers(o.scope,o.user,turn,{...lookup(saved),fieldIds:['look']});assert.deepEqual(text.data.answers,{look:'bold'});assert.equal(text.data.selectedPhotos,undefined,'Unrequested resources are never loaded');
 });
 await test('correction drops unavailable carried selections but rejects unavailable suggestions',async()=>{
  const o=await owner(),f=await issue(o),good=await photo(o.project,'Earlier selection');await http(o,'mutate',mutation(f,'submit',{look:'bold',photos:[good]}));let saved=await store.readInteraction(o.scope,o.user,f.envelope.id);const snapshot=saved.submission.answers;
  await run('DELETE FROM project_files WHERE id=?',good);await assert.rejects(()=>replace(o,saved,{photos:[good]}),e=>e.code==='RESOURCE_UNAVAILABLE');
  const next=await replace(o,saved);assert.equal(next.envelope.scope.taskId,saved.envelope.scope.taskId);assert.equal(next.envelope.definition.fields.find(x=>x.id==='photos').default,undefined);assert.deepEqual((await store.readInteraction(o.scope,o.user,f.envelope.id)).submission.answers,snapshot);
  const fresh=await photo(o.project,'Fresh choice'),proposed=await replace(o,next,{photos:[fresh]});assert.deepEqual(proposed.envelope.definition.fields.find(x=>x.id==='photos').default,{value:[fresh],provenance:'suggested'});assert.equal(proposed.submission,null);
 });
 await test('selected-field processing guards retain form and feature authority after the read',async()=>{
  for(const change of ['feature','replacement']){
   const o=await owner(),f=await issue(o),good=await photo(o.project,'Selected');await http(o,'mutate',mutation(f,'submit',{look:'bold',photos:[good]}));const saved=await store.readInteraction(o.scope,o.user,f.envelope.id),turn=await origin(o,true),read=await submitted.readSubmittedAnswers(o.scope,o.user,turn,lookup(saved));
   if(change==='feature')await run("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND operation='prepare'",o.user);else await replace(o,saved);
   await assert.rejects(()=>o.scope.batch(read.guards));
  }
 });
 await test('cancel discards selected IDs without removing the independently owned photo',async()=>{
  const o=await owner(),f=await issue(o),good=await photo(o.project,'Retain asset');await http(o,'mutate',mutation(f,'save-draft',{look:'bold',photos:[good]}));const saved=await store.readInteraction(o.scope,o.user,f.envelope.id);await http(o,'mutate',mutation(saved,'cancel'));
  assert.deepEqual({...await row('SELECT envelope_json,draft_json FROM chat_interactions WHERE id=?',f.envelope.id)},{envelope_json:null,draft_json:'{}'});assert(await row('SELECT id FROM project_files WHERE id=?',good));
 });
 assert.equal(network,0);console.log(`Custom Chat photo selection: ${cases} connected scenarios passed; no detector, R2 byte read or inference.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
