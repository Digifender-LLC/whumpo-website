import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/chat-interactions/store.ts','src/chat-interactions/protocol.ts','src/chat-interactions/history-shape.ts','src/index.ts']);
const store=await modules.module('src/chat-interactions/store.ts'),protocol=await modules.module('src/chat-interactions/protocol.ts'),presentation=await modules.module('src/chat-interactions/history-shape.ts'),worker=(await modules.module('src/index.ts')).default;
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();let cases=0,network=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Unexpected inference/provider request');};
const run=(sql,...v)=>db.prepare(sql).bind(...v).run(),row=(sql,...v)=>db.prepare(sql).bind(...v).first();
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){}};
const client={versions:[1],fieldTypes:['text','long-text','resource','choice'],bindings:['answer.value@1','interaction.answers@1','owned.projects@1','agent.task-continue@1']};
async function owner(){const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope();await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);const grant=id();await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic intake fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",grant,user);const readGrant=id();await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','read','private-test-acceptance','synthetic resource fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",readGrant,user);return {authority,user,scope,grant,readGrant};}
async function project(o,name='Garden'){const p=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,'Private purpose canary','draft',datetime('now'),datetime('now'))",p,o.user,name);return p;}
async function origin(o){const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) SELECT ?,user_id,revision+1,'Plan a project','Review these details',datetime('now') FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);return turn;}
async function issue(o,template='project-brief@1',database=o.scope){const input={originTurnId:await origin(o),template};return {input,form:await store.issueProjectIntake(database,o.user,input)};}
const request=(f,operation='submit',answers={name:'Garden',purpose:'A website about gardening.'},revision=f.answerRevision)=>({version:1,requestId:id(),interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:revision,operation,...(operation==='cancel'?{}:{answers})});
const replacement=async(o,f)=>({originTurnId:await origin(o),previousInteractionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision});
const resources=(f,before=null)=>({version:1,interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,fieldId:'project',limit:2,before});
async function http(o,path,data){return worker.fetch(new Request('https://whumpo.com/api/chat/'+path,{method:data?'POST':'GET',headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+o.authority.token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env,ctx);}
async function json(o,path,data,status=200){const r=await http(o,path,data),body=await r.json();assert.equal(r.status,status,JSON.stringify(body));if(path.startsWith('interactions/'))assert.match(r.headers.get('cache-control'),/no-store/);return body;}
const denies=(fn,status=409)=>assert.rejects(fn,e=>e.status===status);
async function test(name,fn){try{await fn();cases++;}catch(e){console.error(name,e);throw e;}}
try{
 await test('cleared required text survives saved drafts and repeated correction without becoming a valid submission',async()=>{
  const o=await owner(),{form}=await issue(o),answers={name:'',purpose:'   '};
  await store.mutateInteraction(o.scope,o.user,request(form,'save-draft',answers));
  let current=await store.readInteraction(o.scope,o.user,form.envelope.id);assert.deepEqual(current.draft,answers);
  for(let n=0;n<2;n++){
   current=await store.replaceProjectIntake(o.scope,o.user,await replacement(o,current));
   assert.deepEqual(Object.fromEntries(current.envelope.definition.fields.map(f=>[f.id,f.default.value])),answers);
   await assert.rejects(()=>store.mutateInteraction(o.scope,o.user,request(current,'submit',answers)),e=>e.code==='TEXT');
  }
 });
 await test('a complete empty draft removes inherited answers throughout a correction chain',async()=>{
  for(const template of ['project-brief@1','project-select@1','choice@1']){
   const o=await owner(),p=await project(o),{form}=await issue(o,template),answers=template==='project-select@1'?{project:p}:template==='choice@1'?{tone:'friendly'}:{name:'Old name',purpose:'Old purpose'};
   await store.mutateInteraction(o.scope,o.user,request(form,'submit',answers));
   const submitted=await store.readInteraction(o.scope,o.user,form.envelope.id),next=await store.replaceProjectIntake(o.scope,o.user,await replacement(o,submitted));
   await store.mutateInteraction(o.scope,o.user,request(next,'save-draft',{}));
   const cleared=await store.readInteraction(o.scope,o.user,next.envelope.id);assert.deepEqual(cleared.draft,{});
   await assert.rejects(()=>store.mutateInteraction(o.scope,o.user,request(cleared,'submit',{})),e=>e.code==='REQUIRED');
   const revised=await store.replaceProjectIntake(o.scope,o.user,await replacement(o,cleared));
   assert(revised.envelope.definition.fields.every(f=>!f.default));
   const again=await store.replaceProjectIntake(o.scope,o.user,await replacement(o,revised));assert(again.envelope.definition.fields.every(f=>!f.default));
   const retained=(await store.readInteraction(o.scope,o.user,form.envelope.id)).submission;assert.deepEqual({...retained,continuation:null},{...submitted.submission,continuation:null});if(template!=='choice@1'){assert.equal(retained.continuation.state,'failed');assert.equal(retained.continuation.reason,'stopped');}
  }
 });
 await test('maintained writing choices reject forged options, unsupported clients and invalid selections',async()=>{
  const o=await owner(),other=await owner();await project(o);await project(other);const {form,input}=await issue(o,'choice@1');
  assert.equal(form.envelope.definition.template,'choice@1');assert.equal(form.envelope.scope.projectId,null);
  assert.deepEqual(form.envelope.definition.fields[0].constraints.options.map(v=>v.id),['friendly','professional','straightforward']);assert.equal(form.envelope.definition.fields[0].default,undefined);
  assert.equal((await store.issueProjectIntake(o.scope,o.user,input)).envelope.id,form.envelope.id);
  for(const extra of [{questions:['Password?']},{options:[{id:'secret',label:'Recovery key'}]},{answers:{tone:'friendly'}}])await assert.rejects(()=>store.issueProjectIntake(o.scope,o.user,{...input,...extra}),e=>e.code==='SHAPE');
  await json(o,'interactions/v1/read',{version:1,interactionId:form.envelope.id,client:{...client,fieldTypes:['text','long-text','resource']}},409);
  for(const operation of ['save-draft','submit'])for(const tone of ['',true,['friendly'],'invented'])await json(o,'interactions/v1/mutate',request(form,operation,{tone}),422);
  await json(o,'interactions/v1/mutate',request(form,'submit',{}),422);
  await json(other,'interactions/v1/mutate',request(form,'submit',{tone:'friendly'}),404);
  assert.equal((await store.readInteraction(o.scope,o.user,form.envelope.id)).draft,null);
 });
 await test('writing preferences retain exact receipts and readable history without starting work',async()=>{
  const o=await owner();await project(o);const {form}=await issue(o,'choice@1'),input=request(form,'submit',{tone:'professional'}),before=await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user);
  const receipt=await json(o,'interactions/v1/mutate',input);assert.deepEqual(await json(o,'interactions/v1/mutate',input),receipt);
  const current=await json(o,'interactions/v1/read',{version:1,interactionId:form.envelope.id,client});assert.deepEqual(current.submission.answers,{tone:'professional'});assert.equal(current.submission.continuation,null);
  await json(o,'interactions/v1/mutate',{...input,answers:{tone:'friendly'}},409);
  await json(o,'interactions/v1/continue',{version:1,submissionId:input.requestId,expectedChatRevision:before.revision},409);
  assert.deepEqual(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user),before);
  assert.equal((await row('SELECT count(*) n FROM chat_interaction_continuations WHERE id=?',input.requestId)).n,0);
  const history=await json(o,'history?before=10000'),fact=history.turns.find(t=>t.id===form.envelope.scope.originTurnId).interaction;
  assert(presentation.readHistoryInteraction(fact));assert.deepEqual(fact.submission.answers,{tone:'professional'});
  assert.deepEqual((await json(o,'export')).turns.find(t=>t.id===form.envelope.scope.originTurnId).interaction.submission.answers,{tone:'professional'});
 });
 await test('fixed maintained issuance and exact origin replay',async()=>{
  const o=await owner(),{form,input}=await issue(o);assert.equal(form.projectName,null);assert.equal(form.envelope.scope.projectId,null);assert.equal(form.envelope.definition.continuationBinding,'agent.task-continue@1');assert.deepEqual(form.envelope.definition.fields.map(f=>f.id),['name','purpose']);
  assert.equal((await store.issueProjectIntake(o.scope,o.user,input)).envelope.id,form.envelope.id);
  await denies(()=>store.issueProjectIntake(o.scope,o.user,{...input,template:'project-select@1'}));
  for(const extra of [{questions:['Password?']},{defaults:{name:'secret'}},{projectId:id()},{template:'custom@1'}])await assert.rejects(()=>store.issueProjectIntake(o.scope,o.user,{...input,...extra}),e=>e.code==='SHAPE');
  const other=await owner();await denies(()=>store.issueProjectIntake(other.scope,other.user,input));await denies(()=>store.readInteraction(other.scope,other.user,form.envelope.id),404);
 });
 await test('saved information has no downstream work and actual HTTP preserves exact receipt',async()=>{
  const o=await owner();await project(o);const {form}=await issue(o),draft=request(form,'save-draft',{name:'Local garden'});
  await json(o,'interactions/v1/mutate',draft);const current=await json(o,'interactions/v1/read',{version:1,interactionId:form.envelope.id,client});assert.deepEqual(current.draft,draft.answers);
  const submit=request(current),before=await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user);const saved=await json(o,'interactions/v1/mutate',submit);assert.equal(saved.requestId,submit.requestId);
  assert.deepEqual(await json(o,'interactions/v1/mutate',submit),saved);await json(o,'interactions/v1/mutate',{...submit,answers:{...submit.answers,name:'Changed'}},409);
  const submitted=await json(o,'interactions/v1/read',{version:1,interactionId:form.envelope.id,client});assert.deepEqual(submitted.submission.answers,submit.answers);assert.equal(submitted.submission.continuation.state,'not-started');assert.equal(submitted.draft,null);
  assert.equal((await row('SELECT count(*) n FROM chat_interaction_continuations WHERE id=?',submit.requestId)).n,1);
  await assert.rejects(()=>run('INSERT INTO chat_interaction_continuations(id) VALUES(?)',submit.requestId),/chat_interaction_changed|UNIQUE/);
  await json(o,'interactions/v1/continue',{version:1,submissionId:submit.requestId,expectedChatRevision:before.revision},503);
  for(const action of ['stop','reconcile']){const result=await json(o,'interactions/v1/'+action,{version:1,submissionId:submit.requestId});assert.equal(result.continuation.reason,'stopped');}
  assert.deepEqual(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user),before);assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',o.user)).n,1);
  const history=await json(o,'history?before=10000'),fact=history.turns.find(t=>t.id===form.envelope.scope.originTurnId).interaction;assert(presentation.readHistoryInteraction(fact));assert.equal(fact.submission.continuation.reason,'stopped');
  assert.equal((await json(o,'export')).turns.find(t=>t.id===form.envelope.scope.originTurnId).interaction.submission.continuation.reason,'stopped');
  assert.deepEqual((await store.listInteractions(o.scope,o.user,{version:1,projectId:null,limit:20,before:null})).items,[]);
 });
 await test('lost issuance and submission acknowledgments recover without duplicate work',async()=>{
  const o=await owner();let issueLost=false,submitLost=false;
  const lossy=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{},async()=>{if(!issueLost){issueLost=true;throw Error('Issue reply lost');}}));
  const {form,input}=await issue(o,'project-brief@1',lossy);assert(issueLost);assert.equal((await store.issueProjectIntake(o.scope,o.user,input)).envelope.id,form.envelope.id);
  const dropping=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interaction_submissions/,async()=>{},async()=>{if(!submitLost){submitLost=true;throw Error('Submit reply lost');}}));
  const submit=request(form),receipt=await store.mutateInteraction(dropping,o.user,submit);assert(submitLost);assert.deepEqual(await store.mutateInteraction(o.scope,o.user,submit),receipt);assert.equal((await row('SELECT count(*) n FROM chat_interaction_submissions WHERE interaction_id=?',form.envelope.id)).n,1);
 });
 await test('owned resource paging exposes only current names and identifiers',async()=>{
  const o=await owner(),other=await owner();for(const n of ['Alpha','Alpha','Garden','Zebra','Zebra'])await project(o,n);await project(other,'FOREIGN_NAME_CANARY');const {form}=await issue(o,'project-select@1');
  const items=[];let before=null;do{const page=await json(o,'interactions/v1/resources',resources(form,before));assert.equal(page.definitionDigest,form.envelope.definitionDigest);assert(page.items.length<=2);items.push(...page.items);before=page.nextBefore;}while(before);
  assert.equal(items.length,5);assert.equal(new Set(items.map(p=>p.id)).size,5);assert.deepEqual(items.map(p=>p.name),['Alpha','Alpha','Garden','Zebra','Zebra']);assert(!JSON.stringify(items).includes('Private purpose canary'));assert(!JSON.stringify(items).includes('FOREIGN_NAME_CANARY'));assert.deepEqual(Object.keys(items[0]).sort(),['id','name','photo']);
  await json(other,'interactions/v1/resources',resources(form),404);
  await json(o,'interactions/v1/resources',{...resources(form),fieldId:'purpose'},409);
  for(const extra of [{limit:21},{before:{name:'Garden',id:'foreign'}},{projectId:id()}])await json(o,'interactions/v1/resources',{...resources(form),...extra},400);
  await json(o,'interactions/v1/resources',{...resources(form),version:0},409);
  await json(o,'interactions/v1/read',{version:1,interactionId:form.envelope.id,client:{...client,fieldTypes:['text','long-text']}},409);
  const empty=await owner();const f=await issue(empty,'project-select@1');assert.deepEqual((await store.listInteractionResources(empty.scope,empty.user,resources(f.form))).items,[]);
 });
 await test('resource reads require current digest, read eligibility and unreplaced form',async()=>{
  const o=await owner();await project(o);const {form}=await issue(o,'project-select@1');
  await json(o,'interactions/v1/resources',{...resources(form),definitionDigest:'0'.repeat(64)},409);
  const missing={...resources(form)};delete missing.definitionDigest;await json(o,'interactions/v1/resources',missing,400);
  await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.readGrant);await json(o,'interactions/v1/resources',resources(form),403);
  await store.replaceProjectIntake(o.scope,o.user,await replacement(o,form));await json(o,'interactions/v1/resources',resources(form),409);
 });
 await test('foreign or removed resource cannot become an answer; accepted selection does not retarget a task',async()=>{
  const o=await owner(),other=await owner(),own=await project(o),foreign=await project(other),{form}=await issue(o,'project-select@1');
  for(const operation of ['save-draft','submit'])for(const selected of [foreign,id()]){const failure=await json(o,'interactions/v1/mutate',request(form,operation,{project:selected}),422);assert.equal(failure.fieldId,'project');assert.equal(failure.code,'resource_unavailable');}
  const submit=request(form,'submit',{project:own});await json(o,'interactions/v1/mutate',submit);const current=await store.readInteraction(o.scope,o.user,form.envelope.id);assert.equal(current.submission.continuation.state,'not-started');assert.equal(current.envelope.scope.projectId,null);assert.equal((await row('SELECT project_id FROM chat_interaction_tasks WHERE id=?',current.envelope.scope.taskId)).project_id,null);
  await run('DELETE FROM projects WHERE id=?',own);assert.deepEqual((await store.readInteraction(o.scope,o.user,form.envelope.id)).submission.answers,{project:own});assert.equal((await store.mutateInteraction(o.scope,o.user,submit)).requestId,submit.requestId);
 });
 await test('selected project ownership is checked again inside the save transaction',async()=>{
  for(const mode of ['transfer','delete']){const o=await owner(),other=await owner(),p=await project(o),{form}=await issue(o,'project-select@1');let changed=false;
   const scoped=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interaction_submissions/,async()=>{changed=true;await(mode==='transfer'?run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,p):run('DELETE FROM projects WHERE id=?',p));}));
   await denies(()=>store.mutateInteraction(scoped,o.user,request(form,'submit',{project:p})));assert(changed);const current=await store.readInteraction(o.scope,o.user,form.envelope.id);assert.equal(current.answerRevision,0);assert.equal(current.submission,null);assert.equal(current.draft,null);
  }
 });
 await test('late form cancellation refuses resource results',async()=>{
  const o=await owner();await project(o);const {form}=await issue(o,'project-select@1');let changed=false;
  const scoped=await o.authority.scope(interceptDatabase(db,/^SELECT id,name FROM projects/,async()=>{},async()=>{changed=true;await store.mutateInteraction(o.scope,o.user,request(form,'cancel'));}));
  await denies(()=>store.listInteractionResources(scoped,o.user,resources(form)),410);assert(changed);await denies(()=>store.readInteraction(o.scope,o.user,form.envelope.id),410);
 });
 await test('late feature revocation rolls back issuance and submission',async()=>{
  for(const phase of ['issue','submit']){const o=await owner(),f=phase==='submit'?(await issue(o)).form:null,turn=await origin(o);let revoked=false;
   const scoped=await o.authority.scope(interceptDatabase(db,phase==='issue'?/^INSERT INTO chat_interactions\(/:/^INSERT INTO chat_interaction_submissions/,async()=>{revoked=true;await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.grant);}));
   await denies(()=>phase==='issue'?store.issueProjectIntake(scoped,o.user,{originTurnId:turn,template:'project-brief@1'}):store.mutateInteraction(scoped,o.user,request(f)));assert(revoked);
   if(f){const current=await store.readInteraction(o.scope,o.user,f.envelope.id);assert.equal(current.state,'open');assert.equal(current.submission,null);await store.mutateInteraction(o.scope,o.user,request(f,'cancel'));}else assert.equal(await row('SELECT id FROM chat_interaction_tasks WHERE origin_turn_id=?',turn),null);
  }
 });
 await test('late session revocation refuses submission without changing stored answers',async()=>{
  const o=await owner(),{form}=await issue(o);let revoked=false;const scoped=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interaction_submissions/,async()=>{revoked=true;await o.authority.revoke();}));
  await assert.rejects(()=>store.mutateInteraction(scoped,o.user,request(form)));assert(revoked);assert.equal((await row('SELECT state FROM chat_interactions WHERE id=?',form.envelope.id)).state,'open');assert.equal(await row('SELECT id FROM chat_interaction_submissions WHERE interaction_id=?',form.envelope.id),null);
 });
 await test('partial draft correction preserves its task and user values across untouched replacements',async()=>{
  const o=await owner();await project(o);const first=(await issue(o)).form;
  await store.mutateInteraction(o.scope,o.user,request(first,'save-draft',{name:'PRIVATE_CORRECTION_CANARY'}));const before=await store.readInteraction(o.scope,o.user,first.envelope.id),input=await replacement(o,before),next=await store.replaceProjectIntake(o.scope,o.user,input);
  assert.equal(next.previousInteractionId,first.envelope.id);assert.equal(next.envelope.scope.taskId,first.envelope.scope.taskId);assert.equal(next.envelope.scope.projectId,null);assert.deepEqual(next.envelope.definition.fields[0].default,{value:'PRIVATE_CORRECTION_CANARY',provenance:'user'});assert.equal(next.envelope.definition.fields[1].default,undefined);assert.equal(next.draft,null);
  const again=await store.replaceProjectIntake(o.scope,o.user,await replacement(o,next));assert.deepEqual(again.envelope.definition.fields[0].default,next.envelope.definition.fields[0].default);assert.equal((await row('SELECT revision FROM chat_interaction_tasks WHERE id=?',again.envelope.scope.taskId)).revision,2);
  const history=await json(o,'history?before=10000');assert(!JSON.stringify(history).includes('PRIVATE_CORRECTION_CANARY'));assert((await json(o,'export')).turns.some(t=>JSON.stringify(t).includes('PRIVATE_CORRECTION_CANARY')));
  const index=await store.listInteractions(o.scope,o.user,{version:1,projectId:null,limit:20,before:null});assert.deepEqual(index.items.map(i=>i.interactionId),[again.envelope.id]);
  await denies(()=>store.mutateInteraction(o.scope,o.user,request(before)));
 });
 await test('correcting a submitted brief preserves its immutable receipt and starts no work',async()=>{
  const o=await owner(),{form}=await issue(o),submit=request(form);const receipt=await store.mutateInteraction(o.scope,o.user,submit),before=await store.readInteraction(o.scope,o.user,form.envelope.id),input=await replacement(o,before),next=await store.replaceProjectIntake(o.scope,o.user,input);
  assert.deepEqual(Object.fromEntries(next.envelope.definition.fields.map(f=>[f.id,f.default.value])),submit.answers);const retained=(await store.readInteraction(o.scope,o.user,form.envelope.id)).submission;assert.deepEqual({...retained,continuation:null},{...before.submission,continuation:null});assert.equal(retained.continuation.reason,'stopped');assert.equal((await store.readInteraction(o.scope,o.user,form.envelope.id)).replacementInteractionId,next.envelope.id);
  assert.deepEqual(await store.mutateInteraction(o.scope,o.user,submit),receipt);const revised=request(next,'submit',{name:'Revised garden',purpose:'A new submitted description.'});await store.mutateInteraction(o.scope,o.user,revised);
  assert.equal((await row('SELECT count(*) n FROM chat_interaction_continuations c JOIN chat_interaction_submissions s ON s.id=c.id WHERE s.user_id=?',o.user)).n,2);assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',o.user)).n,0);
  assert.equal((await store.replaceProjectIntake(o.scope,o.user,input)).envelope.id,next.envelope.id);await denies(()=>store.replaceProjectIntake(o.scope,o.user,{...input,expectedAnswerRevision:0}));
 });
 await test('correction carries owned selection but drops a removed or transferred default',async()=>{
  for(const mode of ['owned','removed','transferred']){const o=await owner(),other=await owner(),p=await project(o),{form}=await issue(o,'project-select@1');await store.mutateInteraction(o.scope,o.user,request(form,'submit',{project:p}));const before=await store.readInteraction(o.scope,o.user,form.envelope.id);
   if(mode==='removed')await run('DELETE FROM projects WHERE id=?',p);if(mode==='transferred')await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,p);
   const next=await store.replaceProjectIntake(o.scope,o.user,await replacement(o,before));assert.deepEqual(next.envelope.definition.fields[0].default,mode==='owned'?{value:p,provenance:'user'}:undefined);assert.equal((await store.readInteraction(o.scope,o.user,form.envelope.id)).submission.answers.project,p);
  }
 });
 await test('selection copied into correction rechecks ownership in the issuance transaction',async()=>{
  const o=await owner(),other=await owner(),p=await project(o),{form}=await issue(o,'project-select@1');await store.mutateInteraction(o.scope,o.user,request(form,'save-draft',{project:p}));const before=await store.readInteraction(o.scope,o.user,form.envelope.id),input=await replacement(o,before);let changed=false;
  const racing=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{changed=true;await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,p);}));
  await denies(()=>store.replaceProjectIntake(racing,o.user,input));assert(changed);assert.equal((await store.readInteraction(o.scope,o.user,form.envelope.id)).state,'open');assert.equal((await row('SELECT revision FROM chat_interaction_tasks WHERE id=?',before.envelope.scope.taskId)).revision,0);
  const retried=await store.replaceProjectIntake(o.scope,o.user,input);assert.equal(retried.envelope.definition.fields[0].default,undefined);
 });
 await test('stale revision, foreign origin/owner and model-supplied correction values cannot issue',async()=>{
  const o=await owner(),other=await owner(),{form}=await issue(o),input=await replacement(o,form);
  for(const bad of [{...input,definitionDigest:'f'.repeat(64)},{...input,expectedAnswerRevision:1},{...input,originTurnId:await origin(other)}])await denies(()=>store.replaceProjectIntake(o.scope,o.user,bad));
  await denies(async()=>store.replaceProjectIntake(other.scope,other.user,{...input,originTurnId:await origin(other)}),404);
  for(const extra of [{answers:{name:'forged'}},{template:'project-select@1'},{projectId:id()},{questions:['Password?']}])await assert.rejects(()=>store.replaceProjectIntake(o.scope,o.user,{...input,...extra}),e=>e.code==='SHAPE');
  assert.equal((await store.readInteraction(o.scope,o.user,form.envelope.id)).state,'open');
 });
 await test('late saved answer, competing correction and cancellation cannot be overwritten',async()=>{
  for(const mode of ['answer','replacement','cancel']){const o=await owner(),{form}=await issue(o),input=await replacement(o,form);let changed=false,winner;
   const racing=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{if(changed)return;changed=true;if(mode==='replacement')winner=await store.replaceProjectIntake(o.scope,o.user,await replacement(o,form));else await store.mutateInteraction(o.scope,o.user,request(form,mode==='answer'?'save-draft':'cancel',{name:'LATE_ANSWER'}));}));
   await denies(()=>store.replaceProjectIntake(racing,o.user,input));assert(changed);assert.equal(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',input.originTurnId),null);
   if(mode==='answer')assert.deepEqual((await store.readInteraction(o.scope,o.user,form.envelope.id)).draft,{name:'LATE_ANSWER'});
   if(mode==='replacement')assert.equal((await store.readInteraction(o.scope,o.user,form.envelope.id)).replacementInteractionId,winner.envelope.id);
   if(mode==='cancel')await denies(()=>store.readInteraction(o.scope,o.user,form.envelope.id),410);
  }
 });
 await test('lost correction response replays exact issue once without losing its task revision',async()=>{
  const o=await owner(),{form}=await issue(o),input=await replacement(o,form);let lost=false;
  const lossy=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost correction reply');}}));
  const next=await store.replaceProjectIntake(lossy,o.user,input);assert(lost);assert.equal((await store.replaceProjectIntake(o.scope,o.user,input)).envelope.id,next.envelope.id);assert.equal((await row('SELECT revision FROM chat_interaction_tasks WHERE id=?',next.envelope.scope.taskId)).revision,1);assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE user_id=?',o.user)).n,2);
 });
 for(const mode of ['feature','session'])await test('late '+mode+' revocation rolls back the complete correction',async()=>{
  const o=await owner(),{form}=await issue(o),input=await replacement(o,form);let revoked=false;
  const racing=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{revoked=true;if(mode==='session')await o.authority.revoke();else await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.grant);}));
  await assert.rejects(()=>store.replaceProjectIntake(racing,o.user,input));assert(revoked);assert.equal((await row('SELECT state FROM chat_interactions WHERE id=?',form.envelope.id)).state,'open');assert.equal((await row('SELECT revision FROM chat_interaction_tasks WHERE id=?',form.envelope.scope.taskId)).revision,0);assert.equal(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',input.originTurnId),null);
 });
 const proposalAccounts=[];
 async function proposalOwner(){const o=await owner();proposalAccounts.push(o.user);return o;}
 async function proposalTest(name,fn){await test(name,async()=>{try{await fn();}finally{for(const user of proposalAccounts.splice(0))await run('DELETE FROM users WHERE id=?',user);}});}
 await proposalTest('unsubmitted proposal chains retain suggested provenance and exact replay',async()=>{
  const o=await proposalOwner(),{form}=await issue(o),input={...await replacement(o,form),changes:{name:'Suggested garden'}};
  let next=await store.proposeAnswers(o.scope,o.user,input);assert.deepEqual(next.envelope.definition.fields[0].default,{value:'Suggested garden',provenance:'suggested'});assert.equal(next.submission,null);
  next=await store.replaceProjectIntake(o.scope,o.user,await replacement(o,next));assert.deepEqual(next.envelope.definition.fields[0].default,{value:'Suggested garden',provenance:'suggested'});
  next=await store.proposeAnswers(o.scope,o.user,{...await replacement(o,next),changes:{purpose:'An editable proposed purpose.'}});assert(next.envelope.definition.fields.every(f=>f.default.provenance==='suggested'));
  await store.mutateInteraction(o.scope,o.user,request(next,'save-draft',{}));next=await store.readInteraction(o.scope,o.user,next.envelope.id);next=await store.replaceProjectIntake(o.scope,o.user,await replacement(o,next));assert(next.envelope.definition.fields.every(f=>!f.default));
  const replay=await store.proposeAnswers(o.scope,o.user,input);assert.equal(replay.previousInteractionId,form.envelope.id);await denies(()=>store.proposeAnswers(o.scope,o.user,{...input,changes:{name:'Different proposal'}}));
 });
 await proposalTest('proposal validation refuses unknown fields, incomplete required values and malformed authority',async()=>{
  const o=await proposalOwner(),other=await proposalOwner(),{form}=await issue(o),input={...await replacement(o,form),changes:{name:'Garden'}};
  for(const changes of [{},{name:''},{name:'x'.repeat(101)},{name:3},{name:['Garden']},{name:null},{password:'private'}])await assert.rejects(()=>store.proposeAnswers(o.scope,o.user,{...input,changes}));
  for(const extra of [{projectId:id()},{fields:[]},{template:'custom@1'}])await assert.rejects(()=>store.proposeAnswers(o.scope,o.user,{...input,...extra}),e=>e.code==='SHAPE');
  await denies(()=>store.proposeAnswers(other.scope,other.user,{...input,originTurnId:id()}),404);await denies(async()=>store.proposeAnswers(o.scope,o.user,{...input,originTurnId:await origin(other)}));
  assert.equal((await store.readInteraction(o.scope,o.user,form.envelope.id)).state,'open');
 });
 await proposalTest('proposed project selection requires fresh ownership at preparation and commit',async()=>{
  const o=await proposalOwner(),other=await proposalOwner(),p=await project(o),foreign=await project(other),{form}=await issue(o,'project-select@1'),input={...await replacement(o,form),changes:{project:p}};
  await assert.rejects(()=>store.proposeAnswers(o.scope,o.user,{...input,changes:{project:foreign}}),e=>e.code==='RESOURCE_UNAVAILABLE');
  let changed=false;const racing=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{changed=true;await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,p);}));
  await denies(()=>store.proposeAnswers(racing,o.user,input));assert(changed);assert.equal((await store.readInteraction(o.scope,o.user,form.envelope.id)).state,'open');assert.equal((await row('SELECT revision FROM chat_interaction_tasks WHERE id=?',form.envelope.scope.taskId)).revision,0);
 });
 for(const mode of ['answer','cancel','feature','session'])await proposalTest('late '+mode+' change rolls back an answer proposal',async()=>{
  const o=await proposalOwner(),{form}=await issue(o),input={...await replacement(o,form),changes:{name:'Suggested name'}};let changed=false;
  const racing=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{changed=true;if(mode==='session')await o.authority.revoke();else if(mode==='feature')await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.grant);else await store.mutateInteraction(o.scope,o.user,request(form,mode==='answer'?'save-draft':'cancel',{name:'Late user answer'}));}));
  await assert.rejects(()=>store.proposeAnswers(racing,o.user,input));assert(changed);assert.equal(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',input.originTurnId),null);assert.equal((await row('SELECT revision FROM chat_interaction_tasks WHERE id=?',form.envelope.scope.taskId)).revision,0);
  if(mode==='answer')assert.deepEqual((await store.readInteraction(o.scope,o.user,form.envelope.id)).draft,{name:'Late user answer'});
 });
 assert.equal(network,0);assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);assert.equal((await row('SELECT count(*) n FROM chat_interaction_checks')).n,0);
 console.log(`Maintained project intake passed: ${cases} actual-handler cases (${process.argv.includes('--d1')?'local D1':'SQLite'}), owned paged selection, atomic scope/feature/session checks, exact loss/replay, saved selection continuation without automatic dispatch and real HTTP/history/export. No model/provider, project creation, activation, browser or deployment acceptance.`);
}catch(error){console.error(error);process.exitCode=1;}finally{globalThis.fetch=originalFetch;await fixture.close();}
