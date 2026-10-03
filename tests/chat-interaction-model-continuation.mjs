import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/index.ts','src/site-agent.ts','src/ai-chat.ts','src/agent-inspection.ts','src/chat-interactions/store.ts','src/chat-interactions/agent.ts','src/chat-interactions/protocol.ts','src/project-specification/store.ts','src/chat-interactions/task-context.ts','src/chat-interactions/model-continuation.ts','src/publications.ts']);
const worker=(await modules.module('src/index.ts')).default,agent=await modules.module('src/site-agent.ts'),ai=await modules.module('src/ai-chat.ts'),inspection=await modules.module('src/agent-inspection.ts');
const store=await modules.module('src/chat-interactions/store.ts'),forms=await modules.module('src/chat-interactions/agent.ts'),protocol=await modules.module('src/chat-interactions/protocol.ts'),site=await modules.module('src/project-specification/store.ts');
const fixture=await databaseFixture({allowedArguments:['--intake-only','--reviews-only','--publications-only','--observations-only','--media-only','--consent-only']}),{db}=fixture,id=()=>crypto.randomUUID();
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:'synthetic-only',protocol:'responses'};
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},AI_BASE_URL:config.baseURL,AI_MODEL:config.model,AI_PROTOCOL:config.protocol,AI_API_KEY:config.apiKey};
let queue=[],mainCalls=0,ackCalls=0,cases=0;const requests=[],background=[],originalFetch=globalThis.fetch,originalWarn=console.warn,warnings=[];
console.warn=(message)=>{warnings.push(String(message));};
const response=action=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'UNTRUSTED_MODEL_PROSE',action})}]}],usage:{input_tokens:100,output_tokens:200}});
globalThis.fetch=async(url,init)=>{
 assert.equal(String(url),config.baseURL+'/responses','Unexpected external request');
 const request=JSON.parse(init.body);assert.equal(request.model,config.model);
 if(request.max_output_tokens===256){ackCalls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"intent":"editing"}'}]}],usage:{input_tokens:10,output_tokens:10}});}
 mainCalls++;requests.push(request);assert(queue.length,'Unexpected extra inference');const step=queue.shift(),value=typeof step==='function'?await step(request):step;return value instanceof Response?value:response(value);
};
const http=(o,path,data,database=db)=>worker.fetch(new Request('https://whumpo.com'+path,{method:data?'POST':'GET',headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+o.authority.token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),{...env,DB:database},{waitUntil(p){background.push(p);}});
async function json(o,path,data,database){const r=await http(o,path,data,database);assert.equal(r.status,200,await r.clone().text());return r.json();}
async function test(name,fn){if(process.argv.includes('--consent-only')&&!name.startsWith('task-consent '))return;if(process.argv.includes('--media-only')&&!name.startsWith('task-media '))return;if(process.argv.includes('--observations-only')&&!name.startsWith('task-observation '))return;if(process.argv.includes('--publications-only')&&!name.startsWith('task-publication '))return;if(process.argv.includes('--reviews-only')&&!name.startsWith('task-review '))return;if(process.argv.includes('--intake-only')&&!name.startsWith('new-project '))return;try{const existing=(name.startsWith('task-media ')||name.startsWith('task-consent '))?new Set((await db.prepare('SELECT id FROM users').all()).results.map(u=>u.id)):null;await fn();assert.equal(queue.length,0);cases++;if(existing)for(const u of (await db.prepare('SELECT id FROM users').all()).results)if(!existing.has(u.id))await run('DELETE FROM users WHERE id=?',u.id);}catch(e){console.error(name,String(e));throw e;}}
async function owner(withWebsite=true){
 const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),project=id();
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',datetime('now'),datetime('now'))",project,user);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic interaction fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,project);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic intake fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user);
 if(!withWebsite)return {authority,user,scope,project};
 const turn=id(),prepared=await site.createWebsite(scope,user,turn,project,{name:'Garden',headline:'A greener neighborhood',description:'Care for local gardens',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[{heading:'Services',text:'Planting and care.'},{heading:'Seasons',text:'Year round.'},{heading:'Area',text:'Our neighborhood.'}],photos:[]});
 await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Create my website',?,datetime('now'),'ai','pending')").bind(turn,user,prepared.reply),...prepared.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),scope.prepare('UPDATE workspace_state SET revision=1 WHERE user_id=?').bind(user)]);
 return {authority,user,scope,project};
}
const revision=async o=>(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user)).revision;
async function chat(o,content,steps,database){queue=steps;const input={id:id(),revision:await revision(o),content},before=mainCalls,data=await json(o,'/api/chat',input,database);return {input,data,calls:mainCalls-before,turn:data.turns.find(t=>t.id===input.id)};}

const taskContext=await modules.module('src/chat-interactions/task-context.ts'),continuation=await modules.module('src/chat-interactions/model-continuation.ts');
const client={versions:[1],fieldTypes:['text','long-text','boolean'],bindings:['answer.value@1','interaction.answers@1','agent.task-continue@1']};
const fields=[{id:'area',questionId:'service-area',required:true},{id:'mobile',questionId:'visits-customers',required:false}];
async function saved(o,questions=fields,answers={area:'SUBMITTED_PUBLIC_SERVICE_AREA'},purpose='site.services@1'){
 const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Plan my landscaping service area','Tell me where you work.',datetime('now'),'ai','completed' FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
 const form=await store.issueInformation(o.scope,o.user,{originTurnId:turn,projectId:o.project,purpose,fields:questions});
 const mutation={version:1,requestId:id(),interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers};
 const receipt=await json(o,'/api/chat/interactions/v1/mutate',mutation);
 return {form:await store.readInteraction(o.scope,o.user,form.envelope.id),mutation,receipt};
}
async function savedSelection(o,request='Change the services on my landscaping website to include seasonal care.'){
 const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,?,'Choose your project.',datetime('now'),'ai','completed' FROM workspace_state WHERE user_id=?",turn,request,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
 const f=await store.issueProjectIntake(o.scope,o.user,{originTurnId:turn,template:'project-select@1'});
 const mutation={version:1,requestId:id(),interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{project:o.project}};
 const before=mainCalls,receipt=await json(o,'/api/chat/interactions/v1/mutate',mutation);assert.equal(mainCalls,before,'Saving selection alone must not infer');
 return {form:await store.readInteraction(o.scope,o.user,f.envelope.id),mutation,receipt};
}
const newBrief={name:'Neighborhood Garden',purpose:'A website for local seasonal planting services.'};
const newWebsite=()=>({kind:'project',purpose:newBrief.purpose,config:{name:newBrief.name,headline:'Seasonal garden care',description:'Local planting services',theme:'forest',aboutTitle:'Our work',aboutText:'Care for gardens through the seasons.',sections:[{heading:'Services',text:'Planting and seasonal care.'}],photos:[]}});
async function savedBrief(o,answers=newBrief,request='Build another website for my seasonal planting business.'){
 const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,?,'Tell me about your project.',datetime('now'),'ai','completed' FROM workspace_state WHERE user_id=?",turn,request,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
 const f=await store.issueProjectIntake(o.scope,o.user,{originTurnId:turn,template:'project-brief@1'}),mutation={version:1,requestId:id(),interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers};
 const before=mainCalls;await json(o,'/api/chat/interactions/v1/mutate',mutation);assert.equal(mainCalls,before);assert.equal(await row('SELECT id FROM projects WHERE id=?',f.envelope.scope.taskId),null);
 return {form:await store.readInteraction(o.scope,o.user,f.envelope.id),mutation,target:f.envelope.scope.taskId};
}
async function grantNew(o,target){await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic new project fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.user,target);}
async function correctBrief(o,form,answers=newBrief){
 const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Correct the new project brief','Review these answers.',datetime('now'),'ai','completed' FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
 const f=await store.replaceProjectIntake(o.scope,o.user,{originTurnId:turn,previousInteractionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:form.answerRevision});
 await store.mutateInteraction(o.scope,o.user,{version:1,requestId:id(),interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers});return store.readInteraction(o.scope,o.user,f.envelope.id);
}
async function follow(o,f,steps=[],database){queue=steps;const input={version:1,submissionId:f.submission.id,expectedChatRevision:await revision(o)},before=mainCalls,data=await json(o,'/api/chat/interactions/v1/continue',input,database);return {data,input,calls:mainCalls-before};}
const read=o=>({kind:'specification',operation:'read',projectId:o.project});
const change=o=>({kind:'specification',operation:'change',projectId:o.project,expectedRevision:1,operations:[{type:'content.replace',contentId:'section-1-text',text:'SUBMITTED_PUBLIC_SERVICE_AREA'}]});
const state=async f=>(await row('SELECT * FROM chat_interaction_continuations WHERE id=?',f.submission.id));
async function noEffect(o,f){assert.equal((await row('SELECT count(*) n FROM project_spec_proposals WHERE id=?',f.submission.id)).n,0);assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);}
async function selectedPhoto(o,name='Selected garden'){
 const f=id();await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,?,?,?,1024,640,480,'ready',datetime('now'))",f,o.project,name,'PRIVATE_PHOTO_KEY/'+f,'a'.repeat(64));
 await run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-task-photo',expires_at=? WHERE file_id=?",new Date(Date.now()+3600000).toISOString(),f);return f;
}
const photoFields=[{id:'photos',questionId:'gallery-photos',required:true}];
try{
 await test('selected approved photos reach only their task context and prepare a private photo review',async()=>{
  const o=await owner(),photo=await selectedPhoto(o),other=await selectedPhoto(o,'UNSELECTED_PHOTO_CANARY'),{form}=await saved(o,photoFields,{photos:[photo]},'site.presentation@1');
  const action={kind:'specification',operation:'change',projectId:o.project,expectedRevision:1,operations:[{type:'pages.setPhotos',pageId:'home',photos:[{id:photo,alt:'A garden described by its owner.'}]}]};
  const result=await follow(o,form,[body=>{const text=JSON.stringify(body);assert.match(text,/Selected garden/);assert.doesNotMatch(text,/PRIVATE_PHOTO_KEY|UNSELECTED_PHOTO_CANARY/);assert(!text.includes(other));return read(o);},action]);
  assert.equal(result.data.continuation.state,'succeeded');assert.equal(result.calls,2);assert.equal((await site.readSpecificationProposal(o.scope,o.user,form.submission.id)).project_id,o.project);assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);assert.equal((await row('SELECT count(*) n FROM publications WHERE project_id=?',o.project)).n,0);
  await run('DELETE FROM users WHERE id=?',o.user);
 });
 await test('clearance loss before the inspection commit prevents the second task dispatch',async()=>{
  const o=await owner(),photo=await selectedPhoto(o),{form}=await saved(o,photoFields,{photos:[photo]},'site.presentation@1');let changed=false;
  const racing=interceptDatabase(db,/^INSERT INTO agent_inspections/,async()=>{changed=true;await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",photo);});
  const result=await follow(o,form,[read(o)],racing);assert(changed);assert.equal(result.calls,1);assert.equal(result.data.continuation.state,'failed');await noEffect(o,form);assert.deepEqual((await store.readInteraction(o.scope,o.user,form.envelope.id)).submission.answers,{photos:[photo]});
  await run('DELETE FROM users WHERE id=?',o.user);
 });
 await test('clearance loss during task inference fences the final effect and task memory',async()=>{
  const o=await owner(),photo=await selectedPhoto(o),{form}=await saved(o,photoFields,{photos:[photo]},'site.presentation@1');
  const result=await follow(o,form,[read(o),async()=>{await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",photo);return change(o);}]);
  assert.equal(result.data.continuation.state,'failed');assert.equal(result.calls,2);await noEffect(o,form);assert.equal((await row('SELECT count(*) n FROM chat_task_progress WHERE submission_id=?',form.submission.id)).n,0);
  await run('DELETE FROM users WHERE id=?',o.user);
 });
 await test('selected-answer photo lookup retains its guards through ordinary Chat inference',async()=>{
  const o=await owner(),photo=await selectedPhoto(o),{form}=await saved(o,photoFields,{photos:[photo]},'site.presentation@1'),e=form.envelope;
  const action={kind:'interaction',operation:'readSubmittedAnswers',interactionId:e.id,taskId:e.scope.taskId,projectId:o.project,submissionId:form.submission.id,fieldIds:['photos']};
  const result=await chat(o,'Read the photos I selected for the website.',[action,async body=>{assert.match(JSON.stringify(body),/selectedPhotos/);assert.doesNotMatch(JSON.stringify(body),/PRIVATE_PHOTO_KEY/);await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",photo);return null;}]);
  assert.equal(result.calls,2);assert.equal(result.turn.status,'failed');assert.doesNotMatch(result.turn.assistant_text,/UNTRUSTED_MODEL_PROSE/);assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);
  await run('DELETE FROM users WHERE id=?',o.user);
 });
 await test('submit/read/reload/replay never dispatch; configured unavailability keeps start explicit',async()=>{
  const o=await owner(),before=mainCalls,{form,receipt,mutation}=await saved(o);assert.equal(form.submission.continuation.state,'not-started');
  await json(o,'/api/chat/interactions/v1/read',{version:1,interactionId:form.envelope.id,client});await json(o,'/api/chat/interactions/v1/mutate',mutation);assert.deepEqual(await json(o,'/api/chat/interactions/v1/receipt',{version:1,requestId:mutation.requestId}),receipt);
  await assert.rejects(()=>continuation.continueInformationTask(o.scope,o.user,form.submission.id,0),e=>e.status===503);
  assert.equal(mainCalls,before);assert.equal((await state(form)).state,'not-started');await noEffect(o,form);
 });
 await test('task context minimizes answers, pins project, and prepares one exact private review',async()=>{
  const o=await owner(),{form}=await saved(o),other=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'OTHER_PROJECT_CANARY','OTHER_PURPOSE_CANARY','draft',datetime('now'),datetime('now'))",other,o.user);
  const noise=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'UNRELATED_CHAT_CANARY','UNRELATED_REPLY_CANARY',datetime('now'),'ai','completed' FROM workspace_state WHERE user_id=?",noise,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
  const inspect=body=>{const text=JSON.stringify(body);assert.match(text,/SUBMITTED_PUBLIC_SERVICE_AREA/);assert.doesNotMatch(text,/OTHER_PROJECT_CANARY|OTHER_PURPOSE_CANARY|UNRELATED_CHAT_CANARY|UNRELATED_REPLY_CANARY/);return read(o);};
  const result=await follow(o,form,[inspect,body=>{assert.match(JSON.stringify(body),/workspace_lookup_result/);return change(o);}]);assert.equal(result.calls,2);assert.equal(result.data.continuation.state,'succeeded');
  const turn=await row('SELECT * FROM chat_turns WHERE id=?',form.submission.id);assert.equal(turn.ai_context_allowed,0);assert.equal(turn.status,'completed');assert.equal(turn.mode,'ai');
  const q=await site.readSpecificationProposal(o.scope,o.user,form.submission.id);assert.equal(q.project_id,o.project);assert.match(await(await site.specificationPreview(o.scope,o.user,q.id)).text(),/SUBMITTED_PUBLIC_SERVICE_AREA/);assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);
  assert.equal((await row('SELECT count(*) n FROM publications WHERE project_id=?',o.project)).n,0);assert.equal((await row('SELECT state FROM standard_ai_requests WHERE id=?',form.submission.id)).state,'completed');
  const before=mainCalls;await json(o,'/api/chat/interactions/v1/continue',result.input);await json(o,'/api/chat/interactions/v1/reconcile',{version:1,submissionId:form.submission.id});assert.equal(mainCalls,before);
  assert.equal((await row('SELECT count(*) n FROM inference_calls WHERE turn_id=?',form.submission.id)).n,1);
 });
 await test('reply-only continuation succeeds in one call without website side effects',async()=>{const o=await owner(),{form}=await saved(o),result=await follow(o,form,[null]);assert.equal(result.calls,1);assert.equal(result.data.continuation.state,'succeeded');await noEffect(o,form);});
 await test('ordinary Chat cannot borrow submission identity before or after completion',async()=>{const o=await owner(),{form}=await saved(o);for(const finished of [false,true]){if(finished)await follow(o,form,[null]);const r=await http(o,'/api/chat',{id:form.submission.id,revision:finished?(await row('SELECT revision FROM chat_turns WHERE id=?',form.submission.id)).revision-1:await revision(o),content:taskContext.taskContinuationContent});assert.equal(r.status,409);} });
 await test('old client, foreign owner and stale workspace revision refuse before inference',async()=>{
  const o=await owner(),foreign=await owner(),{form}=await saved(o),before=mainCalls;
  assert.equal((await http(o,'/api/chat/interactions/v1/read',{version:1,interactionId:form.envelope.id,client:{...client,bindings:client.bindings.filter(b=>b!=='agent.task-continue@1')}})).status,409);
  assert.equal((await http(foreign,'/api/chat/interactions/v1/continue',{version:1,submissionId:form.submission.id,expectedChatRevision:await revision(foreign)})).status,404);
  assert.equal((await http(o,'/api/chat/interactions/v1/continue',{version:1,submissionId:form.submission.id,expectedChatRevision:0})).status,409);assert.equal(mainCalls,before);assert.equal((await state(form)).state,'not-started');
 });
 await test('stopping unstarted task is terminal and retains exact answers',async()=>{const o=await owner(),{form}=await saved(o);await json(o,'/api/chat/interactions/v1/stop',{version:1,submissionId:form.submission.id});const result=await follow(o,form);assert.equal(result.calls,0);assert.equal(result.data.continuation.reason,'stopped');assert.deepEqual((await store.readInteraction(o.scope,o.user,form.envelope.id)).submission.answers,form.submission.answers);});
 for(const unknown of [false,true])await test((unknown?'unknown':'rejected')+' model outcome preserves answers and never redispatches',async()=>{
  const o=await owner(),{form,mutation,receipt}=await saved(o);const result=await follow(o,form,[()=>{if(unknown)throw Error('Synthetic response lost');return Response.json({error:{message:'Synthetic rejection'}},{status:400});}]);assert.equal(result.data.continuation.state,unknown?'unknown':'failed');
  const before=mainCalls;await json(o,'/api/chat/interactions/v1/continue',result.input);assert.deepEqual(await json(o,'/api/chat/interactions/v1/receipt',{version:1,requestId:mutation.requestId}),receipt);
  await json(o,'/api/chat/interactions/v1/reconcile',{version:1,submissionId:form.submission.id});assert.equal((await state(form)).state,'failed');assert.equal(mainCalls,before);assert.equal((await row('SELECT state FROM standard_ai_requests WHERE id=?',form.submission.id)).state,'uncertain');await noEffect(o,form);
 });
 for(const point of ['first','second'])await test('out-of-task action refused on '+point+' provider response',async()=>{const o=await owner(),other=await owner(),{form}=await saved(o);const result=await follow(o,form,[...(point==='second'?[read(o)]:[]),change(other)]);assert.equal(result.data.continuation.state,'failed');await noEffect(o,form);});
 for(const action of [{kind:'interaction',operation:'requestProjectBrief'},{kind:'specification',operation:'restore',projectId:id(),expectedRevision:1,versionId:id()},{kind:'domain',operation:'prepare',projectId:id(),hostname:'synthetic.invalid'}])await test('task action whitelist excludes '+action.kind+'/'+action.operation,async()=>{const o=await owner(),{form}=await saved(o);const r=await follow(o,form,[action]);assert.equal(r.data.continuation.state,'failed');await noEffect(o,form);});
 await test('duplicate start while provider runs reads pending receipt; stop does not release in-flight work',async()=>{
  const o=await owner(),{form}=await saved(o);let entered,release;const reached=new Promise(r=>entered=r),hold=new Promise(r=>release=r);const running=follow(o,form,[async()=>{entered();await hold;return null;}]);await reached;
  const before=mainCalls,duplicate=await json(o,'/api/chat/interactions/v1/continue',{version:1,submissionId:form.submission.id,expectedChatRevision:await revision(o)});assert.equal(duplicate.continuation.state,'pending');assert.equal((await json(o,'/api/chat/interactions/v1/stop',{version:1,submissionId:form.submission.id})).continuation.state,'pending');assert.equal(mainCalls,before);release();assert.equal((await running).data.continuation.state,'succeeded');
 });
 await test('lost claim acknowledgment leaves one recoverable reservation and no dispatch',async()=>{
  const o=await owner(),{form}=await saved(o);let lost=false;const lossy=interceptDatabase(db,/INSERT INTO standard_ai_requests/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost claim acknowledgment');}});
  const result=await follow(o,form,[],lossy);assert(lost);assert.equal(result.data.continuation.state,'pending');assert.equal(result.calls,0);
  await run("UPDATE chat_turns SET created_at='2026-01-01T00:00:00Z' WHERE id=?",form.submission.id);await json(o,'/api/chat/interactions/v1/reconcile',{version:1,submissionId:form.submission.id});assert.equal((await state(form)).state,'failed');assert.equal((await row('SELECT state FROM standard_ai_requests WHERE id=?',form.submission.id)).state,'released');
 });
 await test('lost final acknowledgment recovers the committed proposal exactly once',async()=>{
  const o=await owner(),{form}=await saved(o);let lost=false;const lossy=interceptDatabase(db,/INSERT INTO project_spec_proposals/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost result acknowledgment');}});const result=await follow(o,form,[read(o),change(o)],lossy);assert(lost);assert.equal(result.data.continuation.state,'succeeded');const before=mainCalls;await json(o,'/api/chat/interactions/v1/continue',result.input);assert.equal(mainCalls,before);
 });
 await test('late feature loss before dispatch atomically releases reserved work',async()=>{
  const o=await owner(),{form}=await saved(o);let raced=false;const racing=interceptDatabase(db,/UPDATE standard_ai_requests SET state='dispatched'/,async()=>{if(!raced){raced=true;await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?',o.user);}});const result=await follow(o,form,[],racing);assert(raced);assert.equal(result.calls,0);assert.equal(result.data.continuation.state,'failed');assert.equal((await row('SELECT state FROM standard_ai_requests WHERE id=?',form.submission.id)).state,'released');
 });
 await test('late task revision change fences prepared effects but keeps observed token costs',async()=>{
  const o=await owner(),{form}=await saved(o);let raced=false;const racing=interceptDatabase(db,/INSERT INTO project_spec_proposals/,async()=>{if(!raced){raced=true;await run('UPDATE chat_interaction_tasks SET revision=revision+1 WHERE id=?',form.envelope.scope.taskId);}});const result=await follow(o,form,[read(o),change(o)],racing);assert(raced);assert.equal(result.data.continuation.state,'failed');assert.equal((await row('SELECT state FROM standard_ai_requests WHERE id=?',form.submission.id)).state,'completed');await noEffect(o,form);
 });
 await test('timeout reconciliation fences a late provider result without losing or replaying answers',async()=>{
  const o=await owner(),{form}=await saved(o);const result=await follow(o,form,[async()=>{await run("UPDATE chat_turns SET created_at='2026-01-01T00:00:00Z' WHERE id=?",form.submission.id);const checked=await json(o,'/api/chat/interactions/v1/reconcile',{version:1,submissionId:form.submission.id});assert.equal(checked.continuation.state,'failed');return change(o);}]);assert.equal(result.data.continuation.state,'failed');await noEffect(o,form);
 });

 await test('a new project can create its first private website without publishing',async()=>{
  const o=await owner(false),{form}=await saved(o),config={name:'Garden',headline:'Local care',description:'Landscaping services',theme:'forest',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[{heading:'Area',text:'SUBMITTED_PUBLIC_SERVICE_AREA'}],photos:[]};
  const r=await follow(o,form,[{kind:'specification',operation:'create',projectId:o.project,config}]);assert.equal(r.data.continuation.state,'succeeded');assert.equal((await row('SELECT version_id FROM project_spec_creations WHERE id=?',form.submission.id)).version_id,form.submission.id);assert.equal((await row('SELECT count(*) n FROM publications WHERE project_id=?',o.project)).n,0);
 });
 await test('late revoked session fences final work; a fresh session recovers the same saved receipt',async()=>{
  const o=await owner(),{form}=await saved(o);let revoked=false;const racing=interceptDatabase(db,/INSERT INTO project_spec_proposals/,async()=>{if(!revoked){revoked=true;await o.authority.revoke();}});queue=[read(o),change(o)];
  const currentScope=await o.authority.scope(racing),rev=await revision(o);
  await assert.rejects(()=>continuation.continueInformationTask(currentScope,o.user,form.submission.id,rev,config),/authority|workspace|session|access|proof/i);
  assert(revoked);assert.equal((await row('SELECT count(*) n FROM project_spec_proposals WHERE id=?',form.submission.id)).n,0);
  const fresh=await workspaceSession(db,modules.identity,{account:o.user,credential:o.authority.credential});o.authority=fresh;o.scope=await fresh.scope();
  await run("UPDATE chat_turns SET created_at='2026-01-01T00:00:00Z' WHERE id=?",form.submission.id);const result=await json(o,'/api/chat/interactions/v1/reconcile',{version:1,submissionId:form.submission.id});assert.equal(result.continuation.state,'failed');assert.deepEqual((await store.readInteraction(o.scope,o.user,form.envelope.id)).submission.answers,form.submission.answers);
 });
 await test('same-task correction carries pending domain reviews and excludes skipped defaults',async()=>{
  const o=await owner(),{form}=await saved(o);await follow(o,form,[read(o),change(o)]);
  const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Adjust the service area','Review the correction.',datetime('now'),'ai','completed' FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
  const next=await store.replaceInformation(o.scope,o.user,{originTurnId:turn,previousInteractionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:form.answerRevision,fields});
  const request={version:1,requestId:id(),interactionId:next.envelope.id,definitionDigest:next.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{area:'Corrected public area'}};await store.mutateInteraction(o.scope,o.user,request);
  const prepared=await taskContext.prepareInformationTask(o.scope,o.user,request.requestId);assert.equal(prepared.data.taskId,form.envelope.scope.taskId);assert.equal(prepared.data.websiteResults.items.length,1);assert.equal(prepared.data.websiteResults.items[0].reviewId,form.submission.id);assert.deepEqual(prepared.data.skippedFieldIds,['mobile']);assert.deepEqual(prepared.data.openQuestions,[]);assert.equal(prepared.data.submittedAnswers.length,1);assert.equal(prepared.data.submittedAnswers[0].answer,'Corrected public area');
 });
 const taskReply=(reply,action=null,taskState={state:'active',summary:'',openQuestions:[]})=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply,action,taskState})}]}],usage:{input_tokens:100,output_tokens:200}});
 const resume=f=>({kind:'interaction',operation:'resumeTask',taskId:f.envelope.scope.taskId,projectId:f.projectId??f.envelope.scope.projectId,submissionId:f.submission.id});
 const progress=async f=>{const r=await row('SELECT p.* FROM chat_task_progress p WHERE submission_id=? AND NOT EXISTS(SELECT 1 FROM chat_task_progress child WHERE child.previous_turn_id=p.turn_id)',f.submission.id);return r&&{...r,openQuestions:JSON.parse(r.questions_json)};};
 const waiting={state:'active',summary:'TASK_SUMMARY_CANARY: Service area is supplied. Seasonal timing is unresolved.',openQuestions:[{id:'season',question:'TASK_QUESTION_CANARY: Which season should visitors see?'}]};
 await test('later natural replies recover bounded task questions and summary without unrelated context',async()=>{
  const o=await owner(),{form}=await saved(o);await follow(o,form,[taskReply('Which season should visitors see?',null,waiting)]);
  const refs=await taskContext.taskReferences(o.scope,o.user);assert.equal(refs.length,1);assert.equal(refs[0].openQuestionCount,1);assert.equal(refs[0].hasPendingReview,false);assert.doesNotMatch(JSON.stringify(refs),/CANARY/);const projected=agent.agentWorkspaceData({...await agent.siteContext(o.scope,o.user),taskReferences:refs.map(r=>({...r,privateFutureField:'UNEXPECTED_TASK_VALUE_CANARY'}))});assert.doesNotMatch(projected,/UNEXPECTED_TASK_VALUE_CANARY/);
  const other=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'OTHER_PROJECT_CANARY','OTHER_PURPOSE_CANARY','draft',datetime('now'),datetime('now'))",other,o.user);
  const answer=await chat(o,'Spring only. Keep the seasonal task open.',[body=>{const text=JSON.stringify(body);assert.match(text,/taskReferences/);assert.doesNotMatch(text,/TASK_SUMMARY_CANARY|TASK_QUESTION_CANARY|SUBMITTED_PUBLIC_SERVICE_AREA/);return resume(form);},body=>{
   const text=JSON.stringify(body);assert.match(text,/TASK_SUMMARY_CANARY|TASK_QUESTION_CANARY/);assert.match(text,/SUBMITTED_PUBLIC_SERVICE_AREA/);assert.match(text,/workspace_lookup_result/);assert.match(text,/Spring only/);assert.doesNotMatch(text,/OTHER_PROJECT_CANARY|OTHER_PURPOSE_CANARY/);
   return taskReply('Spring it is. Anything else?',null,{state:'active',summary:'SPRING_DECISION_CANARY: Spring only; supplied area stays unchanged.',openQuestions:[]});
  }]);assert.equal(answer.calls,2);assert.equal(answer.turn.status,'completed');assert.equal((await progress(form)).turn_id,answer.input.id);assert.equal((await row('SELECT ai_context_allowed FROM chat_turns WHERE id=?',answer.input.id)).ai_context_allowed,0);
  const again=await chat(o,'Finish the same task with that seasonal choice.',[resume(form),body=>{const text=JSON.stringify(body);assert.match(text,/SPRING_DECISION_CANARY/);assert.doesNotMatch(text,/TASK_QUESTION_CANARY/);return taskReply('Your private review is ready.',change(o),{state:'finished',summary:'Spring choice and supplied area are planned; the website change still needs review.',openQuestions:[]});}]);assert.equal(again.calls,2);assert.equal(again.turn.status,'completed');assert.equal((await progress(form)).state,'finished');assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);
  const prepared=await taskContext.prepareInformationTask(o.scope,o.user,form.submission.id,true);assert(prepared.data.websiteResults.items.some(r=>r.reviewId===again.input.id));assert.deepEqual(prepared.data.openQuestions,[]);
  const before=mainCalls;await json(o,'/api/chat',again.input);assert.equal(mainCalls,before);assert.deepEqual((await store.readInteraction(o.scope,o.user,form.envelope.id)).submission.answers,form.submission.answers);
 });
 await test('unrelated conversation does not automatically copy task memory or answers',async()=>{
  const o=await owner(),{form}=await saved(o);await follow(o,form,[taskReply('Which season?',null,waiting)]);
  const result=await chat(o,'What can you help me with?',[body=>{const text=JSON.stringify(body);assert.doesNotMatch(text,/TASK_SUMMARY_CANARY|TASK_QUESTION_CANARY|SUBMITTED_PUBLIC_SERVICE_AREA/);return null;}]);assert.equal(result.calls,1);assert.equal((await progress(form)).turn_id,form.submission.id);
 });
 await test('skip cancel and explicit resume retain immutable submitted answers',async()=>{
  const o=await owner(),{form}=await saved(o);await follow(o,form,[taskReply('Which season?',null,waiting)]);
  const skipped=await chat(o,'Skip the season question for this task.',[resume(form),taskReply('We can leave it unspecified.',null,{state:'active',summary:'Season intentionally skipped.',openQuestions:[]})]);assert.equal(skipped.calls,2);assert.deepEqual((await progress(form)).openQuestions,[]);
  await chat(o,'Cancel this website task.',[resume(form),taskReply('The task is stopped. Your saved answers remain.',null,{state:'canceled',summary:'Owner stopped this task; no website change.',openQuestions:[]})]);assert.equal((await progress(form)).state,'canceled');
  await chat(o,'Resume the website planning task.',[resume(form),body=>{assert.match(JSON.stringify(body),/canceled/);return taskReply('We can continue.',null,{state:'active',summary:'Owner resumed; season stays unspecified.',openQuestions:[]});}]);assert.equal((await progress(form)).state,'active');assert.deepEqual((await store.readInteraction(o.scope,o.user,form.envelope.id)).submission.answers,form.submission.answers);await noEffect(o,form);
 });
 for(const mismatch of ['owner','project','task'])await test('resume refuses altered '+mismatch+' scope before the second model call',async()=>{
  const o=await owner(),other=await owner(),{form}=await saved(o);await follow(o,form,[null]);const a=resume(form);if(mismatch==='project')a.projectId=other.project;if(mismatch==='task')a.taskId=id();const result=await chat(mismatch==='owner'?other:o,'Continue the task.',[a]);assert.equal(result.calls,1);assert.equal(result.turn.status,'failed');assert.equal((await progress(form)).turn_id,form.submission.id);
 });
 for(const bad of [{...waiting,approval:true},{...waiting,openQuestions:[...waiting.openQuestions,...waiting.openQuestions]},{...waiting,summary:'x'.repeat(1001)},{state:'finished',summary:'done',openQuestions:waiting.openQuestions}])await test('invalid bounded task memory refuses the whole result',async()=>{
  const o=await owner(),{form}=await saved(o);const result=await follow(o,form,[taskReply('Bad memory.',null,bad)]);assert.equal(result.data.continuation.state,'failed');assert.equal(await progress(form),null);await noEffect(o,form);
 });
 await test('ordinary Chat cannot store task memory without selecting an admitted task',async()=>{const o=await owner(),r=await chat(o,'Hello.',[taskReply('Hello.',null,waiting)]);assert.equal(r.turn.status,'failed');assert.equal((await row('SELECT count(*) n FROM chat_task_progress WHERE user_id=?',o.user)).n,0);});
 await test('superseded and unstarted submissions cannot be resumed through general Chat',async()=>{
  const o=await owner(),{form}=await saved(o);let r=await chat(o,'Continue this task.',[resume(form)]);assert.equal(r.calls,1);assert.equal(r.turn.status,'failed');await follow(o,form,[null]);
  const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Correct my form','Here it is.',datetime('now'),'ai','completed' FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
  await store.replaceInformation(o.scope,o.user,{originTurnId:turn,previousInteractionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:form.answerRevision,fields});assert.deepEqual(await taskContext.taskReferences(o.scope,o.user),[]);
  r=await chat(o,'Continue the old task.',[resume(form)]);assert.equal(r.calls,1);assert.equal(r.turn.status,'failed');
 });
 await test('failed resumed inference preserves previous questions and exact replay never redispatches',async()=>{
  const o=await owner(),{form}=await saved(o);await follow(o,form,[taskReply('Which season?',null,waiting)]);const r=await chat(o,'Spring.',[resume(form),()=>{throw Error('Synthetic second response lost');}]);assert.equal(r.calls,2);assert.equal(r.turn.status,'uncertain');assert.equal((await row('SELECT status FROM inference_calls WHERE id=?',r.input.id)).status,'uncertain');assert.equal((await progress(form)).turn_id,form.submission.id);const before=mainCalls;await json(o,'/api/chat',r.input);assert.equal(mainCalls,before);assert.equal((await row('SELECT ai_context_allowed FROM chat_turns WHERE id=?',r.input.id)).ai_context_allowed,0);
 });
 await test('revoked eligibility before the task lookup fences the second request',async()=>{
  const o=await owner(),{form}=await saved(o);await follow(o,form,[null]);let revoked=false;const racing=interceptDatabase(db,/INSERT INTO agent_inspections/,async()=>{if(!revoked){revoked=true;await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?',o.user);}});
  const r=await chat(o,'Continue this website task.',[resume(form)],racing);assert(revoked);assert.equal(r.calls,1);assert.equal(r.turn.status,'failed');assert.equal((await progress(form)).turn_id,form.submission.id);
 });
 await test('task revision change fences both new memory and prepared edits',async()=>{
  const o=await owner(),{form}=await saved(o);await follow(o,form,[null]);let changed=false;const racing=interceptDatabase(db,/INSERT INTO project_spec_proposals/,async()=>{if(!changed){changed=true;await run('UPDATE chat_interaction_tasks SET revision=revision+1 WHERE id=?',form.envelope.scope.taskId);}});
  const r=await chat(o,'Continue with the supplied area.',[resume(form),taskReply('Prepared.',change(o),{state:'finished',summary:'A review is prepared.',openQuestions:[]})],racing);assert(changed);assert.equal(r.turn.status,'failed');assert.equal((await progress(form)).turn_id,form.submission.id);assert.equal((await row('SELECT count(*) n FROM project_spec_proposals WHERE id=?',r.input.id)).n,0);
 });
 await test('lost final response retains one immutable progress receipt and review',async()=>{
  const o=await owner(),{form}=await saved(o);await follow(o,form,[null]);let lost=false;const lossy=interceptDatabase(db,/INSERT INTO chat_task_progress/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost task result acknowledgment');}});
  const r=await chat(o,'Continue with the area.',[resume(form),taskReply('Prepared.',change(o),{state:'finished',summary:'Review awaits owner.',openQuestions:[]})],lossy);assert(lost);assert.equal(r.turn.status,'completed');assert.equal((await progress(form)).turn_id,r.input.id);const before=mainCalls;await json(o,'/api/chat',r.input);assert.equal(mainCalls,before);await assert.rejects(()=>run("UPDATE chat_task_progress SET summary='changed' WHERE turn_id=?",r.input.id),/chat_task_progress_immutable/);
 });
 await test('resumed task cannot switch project or recursively start another task',async()=>{
  const o=await owner(),other=await owner(),{form}=await saved(o);await follow(o,form,[null]);for(const action of [change(other),resume(form)]){const r=await chat(o,'Continue this task.',[resume(form),taskReply('Wrong action.',action,waiting)]);assert.equal(r.calls,2);assert.equal(r.turn.status,'failed');assert.equal((await progress(form)).turn_id,form.submission.id);}
 });
 await test('cancellation cannot carry a website change',async()=>{
  const o=await owner(),{form}=await saved(o);await follow(o,form,[null]);const r=await chat(o,'Cancel this task.',[resume(form),taskReply('Canceled.',change(o),{state:'canceled',summary:'Canceled.',openQuestions:[]})]);assert.equal(r.turn.status,'failed');assert.equal((await progress(form)).state,'active');assert.equal((await row('SELECT count(*) n FROM project_spec_proposals WHERE id=?',r.input.id)).n,0);
 });
 // Every scenario owns its fixtures; clear the earlier group before the bounded account cap.
 await run('DELETE FROM users');
 await test('project selection continues original request with only the chosen project and an exact private review',async()=>{
  const o=await owner(),other=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'UNSELECTED_PROJECT_CANARY','UNSELECTED_PURPOSE_CANARY','draft',datetime('now'),datetime('now'))",other,o.user);
  const {form,mutation,receipt}=await savedSelection(o);assert.equal(form.envelope.scope.projectId,null);
  const current=await taskContext.prepareInformationTask(o.scope,o.user,form.submission.id);assert.equal(current.form.projectId,o.project);assert.equal(current.data.purpose,'project.selection@1');assert.equal(current.data.submittedAnswers[0].answer,o.project);
  const result=await follow(o,form,[body=>{const text=JSON.stringify(body);assert.match(text,/seasonal care/);assert.match(text,/project.selection@1/);assert.doesNotMatch(text,/UNSELECTED_PROJECT_CANARY|UNSELECTED_PURPOSE_CANARY/);return read(o);},change(o)]);
  assert.equal(result.calls,2);assert.equal(result.data.continuation.state,'succeeded');assert.equal((await row('SELECT project_id FROM project_spec_proposals WHERE id=?',form.submission.id)).project_id,o.project);assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);assert.equal((await row('SELECT count(*) n FROM publications WHERE project_id=?',o.project)).n,0);
  const before=mainCalls;await json(o,'/api/chat/interactions/v1/continue',result.input);await json(o,'/api/chat/interactions/v1/reconcile',{version:1,submissionId:form.submission.id});assert.deepEqual(await json(o,'/api/chat/interactions/v1/mutate',mutation),receipt);assert.equal(mainCalls,before);
  const refs=await taskContext.taskReferences(o.scope,o.user);assert.equal(refs[0].projectId,o.project);assert.equal(refs[0].purpose,'project.selection@1');assert.equal(refs[0].hasPendingReview,true);
  const prepared=await taskContext.prepareInformationTask(o.scope,o.user,form.submission.id,true);assert.equal(prepared.data.websiteResults.items[0].reviewId,form.submission.id);
  const continued=await chat(o,'Is that prepared seasonal-care change still waiting for approval? Do not change anything.',[body=>{assert.match(JSON.stringify(body),/hasPendingReview/);assert.doesNotMatch(JSON.stringify(body),/proposalDigest/);return resume({...form,projectId:o.project});},body=>{assert(JSON.stringify(body).includes(form.submission.id));assert.match(JSON.stringify(body),/websiteResults/);assert.doesNotMatch(JSON.stringify(body),/UNSELECTED_PROJECT_CANARY|UNSELECTED_PURPOSE_CANARY/);return taskReply('Your existing review is ready.',null,{state:'finished',summary:'Seasonal work remains in the exact pending review.',openQuestions:[]});}]);assert.equal(continued.turn.status,'completed');
 });
 await test('pending-review hints exclude other tasks owners expired and applied reviews',async()=>{
  const o=await owner(),foreign=await owner(),{form}=await savedSelection(o),foreignForm=(await savedSelection(foreign)).form;
  await follow(o,form,[read(o),change(o)]);await follow(foreign,foreignForm,[read(foreign),change(foreign)]);
  const other=(await savedSelection(o,'Plan a different gardening task without changing anything.')).form;
  await follow(o,other,[taskReply('This other task has no change review.')]);
  const refs=await taskContext.taskReferences(o.scope,o.user);
  assert.equal(refs.length,2);assert.equal(refs.find(r=>r.taskId===form.envelope.scope.taskId).hasPendingReview,true);assert.equal(refs.find(r=>r.taskId===other.envelope.scope.taskId).hasPendingReview,false);
  const projected=agent.agentWorkspaceData({...await agent.siteContext(o.scope,o.user),taskReferences:refs});assert.match(projected,/hasPendingReview/);assert(!projected.includes(foreignForm.submission.id));assert.doesNotMatch(JSON.stringify(refs),/reviewId|proposalDigest|expiresAt/);
  // Advance only SQL reads' ISO clock past the ten-minute review expiry. The
  // current schema/rows stay untouched; the seven-day task remains available.
  const laterDb={prepare:q=>db.prepare(q.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')","strftime('%Y-%m-%dT%H:%M:%fZ','now','+11 minutes')")),batch:s=>db.batch(s)},later=await o.authority.scope(laterDb);
  const expiredRefs=await taskContext.taskReferences(later,o.user);assert.equal(expiredRefs.length,2);assert(expiredRefs.every(r=>!r.hasPendingReview));assert.deepEqual((await taskContext.prepareInformationTask(later,o.user,form.submission.id,true)).data.websiteResults.items.map(r=>r.state),['expired']);
  const q=await site.readSpecificationProposal(o.scope,o.user,form.submission.id);
  await json(o,'/api/chat/actions',{id:id(),revision:await revision(o),action:{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision}});
  assert((await taskContext.taskReferences(o.scope,o.user)).every(r=>!r.hasPendingReview));assert.deepEqual((await taskContext.prepareInformationTask(o.scope,o.user,form.submission.id,true)).data.websiteResults.items.map(r=>r.state),['saved']);assert.equal((await taskContext.taskReferences(foreign.scope,foreign.user))[0].hasPendingReview,true);
 });
 for(const lost of ['account','project','transfer','delete'])await test('selected project refuses '+lost+' authority loss before model dispatch',async()=>{
  const o=await owner(),other=await owner(),{form}=await savedSelection(o),before=mainCalls;
  if(lost==='account'||lost==='project')await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND project_id IS ?',o.user,lost==='project'?o.project:null);
  else if(lost==='transfer')await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);
  else await run('DELETE FROM projects WHERE id=?',o.project);
  const result=await http(o,'/api/chat/interactions/v1/continue',{version:1,submissionId:form.submission.id,expectedChatRevision:await revision(o)});assert([403,404,409].includes(result.status),await result.text());assert.equal(mainCalls,before);assert.equal((await state(form)).state,'not-started');
 });
 for(const boundary of ['dispatch','lookup','result'])for(const lost of ['account','project','transfer'])await test('selected '+lost+' permission race is fenced at '+boundary,async()=>{
  const o=await owner(),other=await owner(),{form}=await savedSelection(o);let raced=false;
  const pattern=boundary==='dispatch'?/UPDATE standard_ai_requests SET state='dispatched'/:boundary==='lookup'?/INSERT INTO agent_inspections/:/INSERT INTO project_spec_proposals/;
  const racing=interceptDatabase(db,pattern,async()=>{if(raced)return;raced=true;if(lost==='transfer')await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);else await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND project_id IS ?',o.user,lost==='project'?o.project:null);});
  const result=await follow(o,form,boundary==='dispatch'?[]:boundary==='lookup'?[read(o)]:[read(o),change(o)],racing);assert(raced);assert.equal(result.data.continuation.state,'failed');assert.equal(result.calls,boundary==='dispatch'?0:boundary==='lookup'?1:2);assert.equal((await row('SELECT count(*) n FROM project_spec_proposals WHERE id=?',form.submission.id)).n,0);
 });
 await test('correcting project choice keeps old reviews bound and excludes them from the new target',async()=>{
  const o=await owner(),{form}=await savedSelection(o);await follow(o,form,[read(o),change(o)]);
  const second=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Second garden','Another garden','draft',datetime('now'),datetime('now'))",second,o.user);
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic selection correction',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.user,second);
  const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Choose my other project instead','Review the corrected selection.',datetime('now'),'ai','completed' FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
  const corrected=await store.replaceProjectIntake(o.scope,o.user,{originTurnId:turn,previousInteractionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:form.answerRevision});
  const submission=id();await store.mutateInteraction(o.scope,o.user,{version:1,requestId:submission,interactionId:corrected.envelope.id,definitionDigest:corrected.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{project:second}});
  const current=await taskContext.prepareInformationTask(o.scope,o.user,submission);assert.equal(current.form.projectId,second);assert.equal(current.data.taskId,form.envelope.scope.taskId);assert.deepEqual(current.data.websiteResults.items,[]);assert.equal((await row('SELECT project_id FROM project_spec_proposals WHERE id=?',form.submission.id)).project_id,o.project);assert.deepEqual((await store.readInteraction(o.scope,o.user,form.envelope.id)).submission.answers,{project:o.project});assert.deepEqual(await taskContext.taskReferences(o.scope,o.user),[]);
 });
 await test('ordinary submitted-selection inspection retains ownership guards through the model result',async()=>{
  const o=await owner(),other=await owner(),{form}=await savedSelection(o),e=form.envelope;
  const result=await chat(o,'Which project did I choose?',[{kind:'interaction',operation:'readSubmittedAnswers',interactionId:e.id,taskId:e.scope.taskId,projectId:null,submissionId:form.submission.id,fieldIds:['project']},async()=>{await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);return null;}]);
  assert.equal(result.calls,2);assert.equal(result.turn.status,'failed');assert.doesNotMatch(result.turn.assistant_text,/UNTRUSTED_MODEL_PROSE/);assert.equal((await state(form)).state,'not-started');
 });
 await test('selected task preserves unavailable and stopped receipts without model calls',async()=>{
  const o=await owner(),{form}=await savedSelection(o),before=mainCalls;
  await assert.rejects(()=>continuation.continueInformationTask(o.scope,o.user,form.submission.id,2,undefined),e=>e.status===503);assert.equal((await state(form)).state,'not-started');assert.equal(mainCalls,before);
  await json(o,'/api/chat/interactions/v1/stop',{version:1,submissionId:form.submission.id});const stopped=await follow(o,form);assert.equal(stopped.data.continuation.reason,'stopped');assert.equal(stopped.calls,0);
 });
 await test('lost selected-project result acknowledgment recovers exactly once',async()=>{
  const o=await owner(),{form}=await savedSelection(o);let lost=false;const lossy=interceptDatabase(db,/INSERT INTO project_spec_proposals/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost selection result acknowledgment');}});
  const result=await follow(o,form,[read(o),change(o)],lossy);assert(lost);assert.equal(result.data.continuation.state,'succeeded');const before=mainCalls;await json(o,'/api/chat/interactions/v1/continue',result.input);assert.equal(mainCalls,before);
 });
 for(const action of [{kind:'project',purpose:'Unrequested project',config:{}},{kind:'backend',operation:'list',projectId:id()},{kind:'review',operation:'publish',targetId:id()}])await test('selected website task rejects '+action.kind+' effects',async()=>{
  const o=await owner(),{form}=await savedSelection(o);const result=await follow(o,form,[action]);assert.equal(result.data.continuation.state,'failed');await noEffect(o,form);
 });
 await run('DELETE FROM users');
 await test('new-project brief creates one private draft with an immutable task-bound result',async()=>{
  const o=await owner(),{form,target,mutation}=await savedBrief(o);const before=await taskContext.prepareInformationTask(o.scope,o.user,form.submission.id);assert.equal(before.newProject,true);assert.deepEqual(before.context.projects,[]);
  const r=await follow(o,form,[body=>{const text=JSON.stringify(body);assert.match(text,/Neighborhood Garden/);assert.match(text,/not-created/);assert.doesNotMatch(text,/SUBMITTED_PUBLIC_SERVICE_AREA|A greener neighborhood/);return newWebsite();}]);assert.equal(r.calls,1);assert.equal(r.data.continuation.state,'succeeded');
  assert.equal((await row('SELECT name,purpose FROM projects WHERE id=? AND owner_user_id=?',target,o.user)).purpose,newBrief.purpose);assert.equal((await site.readSpecification(o.scope,o.user,target)).revision,1);assert.equal((await row('SELECT created_project_id FROM chat_task_progress WHERE turn_id=?',form.submission.id)).created_project_id,target);assert.equal((await row('SELECT count(*) n FROM publications WHERE project_id=?',target)).n,0);
  const calls=mainCalls;await json(o,'/api/chat/interactions/v1/continue',r.input);await json(o,'/api/chat/interactions/v1/mutate',mutation);await json(o,'/api/chat/interactions/v1/reconcile',{version:1,submissionId:form.submission.id});assert.equal(mainCalls,calls);assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',o.user)).n,2);
  await assert.rejects(()=>run('UPDATE chat_task_progress SET created_project_id=NULL WHERE turn_id=?',form.submission.id),/immutable/);await assert.rejects(()=>run('DELETE FROM chat_task_progress WHERE turn_id=?',form.submission.id),/retained/);
  await run('DELETE FROM users WHERE id=?',o.user);assert.equal(await row('SELECT turn_id FROM chat_task_progress WHERE task_id=?',target),null);assert.equal(await row('SELECT id FROM projects WHERE id=?',target),null);
 });
 await test('new-project clarification resumes before creation and retains the same target after creation',async()=>{
  const o=await owner(),{form,target}=await savedBrief(o);await follow(o,form,[taskReply('Which season should we feature?',null,{state:'active',summary:'Name and purpose supplied; season not specified.',openQuestions:[{id:'season',question:'Which season should we feature?'}]})]);assert.equal(await row('SELECT id FROM projects WHERE id=?',target),null);
  const refs=await taskContext.taskReferences(o.scope,o.user);assert.equal(refs[0].projectId,target);assert.equal(refs[0].purpose,'project.intake@1');assert.doesNotMatch(JSON.stringify(refs),/Name and purpose/);
  const resumed=await chat(o,'Spring, for this new project.',[resume({...form,projectId:target}),body=>{assert.match(JSON.stringify(body),/Spring/);assert.match(JSON.stringify(body),/not-created/);return newWebsite();}]);assert.equal(resumed.turn.status,'completed');assert.equal((await row('SELECT created_project_id FROM chat_task_progress WHERE turn_id=?',resumed.input.id)).created_project_id,target);
  await grantNew(o,target);const again=await chat(o,'Continue this new-project task and show the planned next step.',[resume({...form,projectId:target}),body=>{assert.match(JSON.stringify(body),/Seasonal garden care/);return null;}]);assert.equal(again.turn.status,'completed');assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',o.user)).n,2);
 });
 await test('new-project corrected brief preserves created target and requires a separate change review',async()=>{
  const o=await owner(),{form,target}=await savedBrief(o);await follow(o,form,[newWebsite()]);await grantNew(o,target);
  const corrected=await correctBrief(o,form,{...newBrief,name:'Renamed Garden'}),task=await taskContext.prepareInformationTask(o.scope,o.user,corrected.submission.id);assert.equal(task.newProject,false);assert.equal(task.form.projectId,target);assert.equal(task.hasWebsite,true);assert.equal(task.data.websiteState,'saved');
  const changed={kind:'specification',operation:'change',projectId:target,expectedRevision:1,operations:[{type:'project.setName',name:'Renamed Garden'}]};const r=await follow(o,corrected,[{kind:'specification',operation:'read',projectId:target},changed]);assert.equal(r.data.continuation.state,'succeeded');assert.equal((await row('SELECT project_id FROM project_spec_proposals WHERE id=?',corrected.submission.id)).project_id,target);assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',o.user)).n,2);assert.equal((await site.readSpecification(o.scope,o.user,target)).revision,1);assert.deepEqual((await store.readInteraction(o.scope,o.user,form.envelope.id)).submission.answers,newBrief);
 });
 for(const lost of ['delete','transfer'])await test('new-project '+lost+' retains creation evidence and refuses recreation',async()=>{
  const o=await owner(),other=await owner(),{form,target}=await savedBrief(o);await follow(o,form,[newWebsite()]);await grantNew(o,target);
  if(lost==='delete')await run('DELETE FROM projects WHERE id=?',target);else await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,target);
  const corrected=await correctBrief(o,form),before=mainCalls;await assert.rejects(()=>taskContext.prepareInformationTask(o.scope,o.user,corrected.submission.id),e=>[403,404].includes(e.status));assert.equal(mainCalls,before);assert.equal((await row('SELECT created_project_id FROM chat_task_progress WHERE turn_id=?',form.submission.id)).created_project_id,target);assert.deepEqual(await taskContext.taskReferences(o.scope,o.user),[]);
 });
 for(const boundary of ['dispatch','result'])await test('new-project account permission race at '+boundary+' commits no project',async()=>{
  const o=await owner(),{form,target}=await savedBrief(o);let raced=false;const racing=interceptDatabase(db,boundary==='dispatch'?/UPDATE standard_ai_requests SET state='dispatched'/:/INSERT INTO projects/,async()=>{if(!raced){raced=true;await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND project_id IS NULL',o.user);}});
  const r=await follow(o,form,boundary==='dispatch'?[]:[newWebsite()],racing);assert(raced);assert.equal(r.data.continuation.state,'failed');assert.equal(await row('SELECT id FROM projects WHERE id=?',target),null);assert.equal((await row('SELECT count(*) n FROM chat_task_progress WHERE task_id=?',target)).n,0);
 });
 await test('new-project late task change rolls back both creation and result custody',async()=>{
  const o=await owner(),{form,target}=await savedBrief(o);let raced=false;const racing=interceptDatabase(db,/INSERT INTO projects/,async()=>{if(!raced){raced=true;await run('UPDATE chat_interaction_tasks SET revision=revision+1 WHERE id=?',target);}});const r=await follow(o,form,[newWebsite()],racing);assert(raced);assert.equal(r.data.continuation.state,'failed');assert.equal(await row('SELECT id FROM projects WHERE id=?',target),null);
 });
 await test('new-project corrected brief rejects recreating its existing website',async()=>{
  const o=await owner(),{form,target}=await savedBrief(o);await follow(o,form,[newWebsite()]);await grantNew(o,target);
  const corrected=await correctBrief(o,form,{...newBrief,name:'Renamed Garden'}),bad={kind:'specification',operation:'create',projectId:target,config:{...newWebsite().config,name:'Renamed Garden'}};
  const r=await follow(o,corrected,[body=>{assert.match(JSON.stringify(body),/already created its project and first private website/);return bad;}]);
  assert.equal(r.data.continuation.state,'failed');assert.equal(JSON.parse(warnings.at(-1)).reason,'task_action');assert.equal((await site.readSpecification(o.scope,o.user,target)).revision,1);assert.equal((await row('SELECT name FROM projects WHERE id=?',target)).name,newBrief.name);assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',o.user)).n,2);
  await run('DELETE FROM users WHERE id=?',o.user);
 });
 await test('new-project lost final acknowledgment recovers its creation without replay',async()=>{
  const o=await owner(),{form,target}=await savedBrief(o);let lost=false;const lossy=interceptDatabase(db,/INSERT INTO projects/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost new-project acknowledgment');}});const r=await follow(o,form,[newWebsite()],lossy);assert(lost);assert.equal(r.data.continuation.state,'succeeded');const before=mainCalls;await json(o,'/api/chat/interactions/v1/continue',r.input);assert.equal(mainCalls,before);assert.equal((await row('SELECT count(*) n FROM projects WHERE id=?',target)).n,1);
 });
 await test('new-project unsupported workload can remain a question without a substitute website',async()=>{
  const o=await owner(),{form,target}=await savedBrief(o,{name:'Video tool',purpose:'A video processing server.'},'Create a video processing service.');const r=await follow(o,form,[body=>{assert.match(JSON.stringify(body),/Never replace an application, CMS or provider request with a website/);return taskReply('This website adapter cannot create the video service. No project was created.',null,{state:'active',summary:'Video processing needs an admitted workload adapter; no website substitution.',openQuestions:[]});}]);assert.equal(r.data.continuation.state,'succeeded');assert.equal(await row('SELECT id FROM projects WHERE id=?',target),null);
 });
 for(const change of ['name','purpose','other-project','publish'])await test('new-project task rejects '+change+' substitutions',async()=>{
  const o=await owner(),{form,target}=await savedBrief(o);let action=newWebsite();if(change==='name')action.config.name='Unrequested name';if(change==='purpose')action.purpose='Unrequested purpose';if(change==='other-project')action={kind:'specification',operation:'read',projectId:o.project};if(change==='publish')action={kind:'review',operation:'publish',targetId:o.project};const r=await follow(o,form,[action]);assert.equal(r.data.continuation.state,'failed');assert.equal(await row('SELECT id FROM projects WHERE id=?',target),null);
  const warning=JSON.parse(warnings.at(-1));assert.equal(warning.event,'ai_proposal_rejected');assert.equal(warning.reason,change==='name'?'task_name':change==='purpose'?'task_purpose':'task_action');assert.equal(warning.task,'project-intake');
 });
 for(const [defect,reason]of [['extra-action-key','project_shape'],['missing-config-field','project_config'],['invalid-task-memory','task_progress'],['missing-task-questions','task_progress'],['invalid-envelope','proposal_shape']])await test('new-project rejection reports only fixed diagnostics for '+defect,async()=>{
  const o=await owner(),{form,target}=await savedBrief(o),action=newWebsite(),canary='PRIVATE_MODEL_DIAGNOSTIC_CANARY';let response;
  if(defect==='extra-action-key')action[canary]=canary;
  if(defect==='missing-config-field'){delete action.config.photos;action.config.aboutText=canary;}
  if(defect==='invalid-task-memory')response=taskReply(canary,action,{state:canary,summary:canary,openQuestions:[]});
  if(defect==='missing-task-questions')response=taskReply(canary,action,{state:'finished',summary:canary});
  if(defect==='invalid-envelope')response=taskReply('',action);
  const before=warnings.length,r=await follow(o,form,[response??action]);
  assert.equal(r.data.continuation.state,'failed');assert.equal(await row('SELECT id FROM projects WHERE id=?',target),null);assert.equal(warnings.length,before+1);
  const warning=JSON.parse(warnings.at(-1));assert.equal(warning.reason,reason);assert.equal(warning.task,'project-intake');
  assert.deepEqual(Object.keys(warning).sort(),['elapsedMs','event','operation','reason','task']);assert.doesNotMatch(warnings.at(-1),/PRIVATE_MODEL_DIAGNOSTIC_CANARY|Neighborhood Garden|seasonal planting|synthetic-only|UNTRUSTED_MODEL_PROSE/);
  const calls=mainCalls;await json(o,'/api/chat/interactions/v1/continue',r.input);assert.equal(mainCalls,calls);assert.equal(warnings.length,before+1);
  await run('DELETE FROM users WHERE id=?',o.user);
 });
 // Routine review/result cases own new isolated accounts; keep the fixture cap bounded.
 await run('DELETE FROM users');
 const confirm=async(o,reviewId)=>{const q=await site.readSpecificationProposal(o.scope,o.user,reviewId);return json(o,'/api/chat/actions',{id:id(),revision:await revision(o),action:{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision}});};
 const confirmAdmitted=async(o,reviewId)=>{
  // Simulate completion of an already admitted user confirmation during inference.
  // A new HTTP confirmation is normally serialized behind the pending Chat turn.
  const q=await site.readSpecificationProposal(o.scope,o.user,reviewId),turn=id(),next=await revision(o)+1;
  const action={type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision};
  const prepared=await site.applySpecificationCommand(o.scope,o.user,turn,`/confirm-specification ${q.id} ${q.proposal_digest} ${q.expected_revision}`);
  await o.scope.batch([o.scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status,action_json) VALUES(?,?,?,'Confirm exact private review',?,datetime('now'),'guided','completed',?)").bind(turn,o.user,next,prepared.reply,JSON.stringify(action)),...prepared.statements,o.scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(next,o.user)]);
 };
 const reopen=f=>({kind:'specification',operation:'review',reviewId:f.submission.id});
 await test('task-review reopens the exact task review and retains a private-save outcome after candidate cleanup',async()=>{
  const o=await owner(),{form}=await savedSelection(o);await follow(o,form,[read(o),change(o)]);
  const again=await chat(o,'Show me that task’s prepared change again so I can review it.',[resume({...form,projectId:o.project}),body=>{const text=JSON.stringify(body);assert.match(text,/websiteResults/);assert(text.includes(form.submission.id));return taskReply('Open that exact review.',reopen(form));}]);
  assert.equal(again.turn.status,'completed');assert.equal(again.turn.specification_review.id,form.submission.id);assert.equal((await progress(form)).turn_id,again.input.id);assert.equal((await row('SELECT count(*) n FROM project_spec_proposals WHERE user_id=?',o.user)).n,1);assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);
  const calls=mainCalls;await json(o,'/api/chat',again.input);assert.equal(mainCalls,calls);
  await confirm(o,form.submission.id);const receipt=await row('SELECT id,version_id,revision FROM project_spec_applies WHERE proposal_id=?',form.submission.id);
  // Disposal is normal proposal cleanup; immutable saved versions/receipts survive.
  await run('DELETE FROM project_spec_proposals WHERE id=?',form.submission.id);
  const data=(await taskContext.prepareInformationTask(o.scope,o.user,form.submission.id,true)).data;
  assert.deepEqual(data.websiteResults.items,[{reviewId:form.submission.id,state:'saved',receiptId:receipt.id,versionId:receipt.version_id,revision:2,savedAt:(await row('SELECT created_at FROM project_spec_applies WHERE id=?',receipt.id)).created_at}]);assert.equal((await taskContext.taskReferences(o.scope,o.user))[0].hasPendingReview,false);
  const status=await chat(o,'Did I save the change in that same task?', [resume({...form,projectId:o.project}),body=>{assert(JSON.stringify(body).includes(receipt.id));return taskReply('Your exact private save completed at revision 2. Publication is separate.');}]);assert.equal(status.turn.status,'completed');assert.equal(status.turn.specification_review,undefined);assert.equal((await row('SELECT count(*) n FROM publications WHERE project_id=? AND version_id IS NOT NULL',o.project)).n,0);
 });
 for(const wrong of ['same-project-other-task','other-project','foreign-owner'])await test('task-review refuses '+wrong+' even when the requested review exists',async()=>{
  const o=await owner(),{form}=await savedSelection(o);await follow(o,form,[read(o),change(o)]);
  const other=wrong==='same-project-other-task'?o:await owner();if(wrong==='other-project')await run('UPDATE projects SET owner_user_id=? WHERE id=?',o.user,other.project);
  const otherScope=wrong==='other-project'?{...o,project:other.project}:other;
  if(wrong==='other-project')await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic other target',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.user,other.project);
  const wrongForm=(await savedSelection(otherScope)).form;await follow(otherScope,wrongForm,[read(otherScope),change(otherScope)]);
  const r=await chat(o,'Reopen the first task’s review.',[resume({...form,projectId:o.project}),taskReply('UNTRUSTED_WRONG_REVIEW',reopen(wrongForm))]);assert.equal(r.turn.status,'failed');assert.doesNotMatch(r.turn.assistant_text,/UNTRUSTED_WRONG_REVIEW/);assert.equal(r.turn.specification_review,undefined);assert.equal(await row('SELECT * FROM project_spec_chat_links WHERE turn_id=?',r.input.id),null);assert.equal((await progress(form)).turn_id,form.submission.id);
 });
 for(const changeDuring of ['save','delete'])await test('task-review late '+changeDuring+' returns an honest unavailable review without a new effect',async()=>{
  const o=await owner(),{form}=await savedSelection(o);await follow(o,form,[read(o),change(o)]);
  const r=await chat(o,'Show the prepared change again.',[resume({...form,projectId:o.project}),async()=>{if(changeDuring==='save')await confirmAdmitted(o,form.submission.id);else await run('DELETE FROM project_spec_proposals WHERE id=?',form.submission.id);return taskReply('UNTRUSTED_READY_REVIEW',reopen(form));}]);assert.equal(r.turn.status,'completed');assert.doesNotMatch(r.turn.assistant_text,/UNTRUSTED_READY_REVIEW/);assert.match(r.turn.assistant_text,/changed or expired|not found/);assert.equal(r.turn.specification_review,undefined);assert.equal(await row('SELECT * FROM project_spec_chat_links WHERE turn_id=?',r.input.id),null);assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,changeDuring==='save'?2:1);
 });
 await test('task-review cannot turn a known pending review into model approval',async()=>{
  const o=await owner(),{form}=await savedSelection(o);await follow(o,form,[read(o),change(o)]);const q=await site.readSpecificationProposal(o.scope,o.user,form.submission.id);
  const r=await chat(o,'Show me that change.',[resume({...form,projectId:o.project}),taskReply('UNTRUSTED_APPROVAL',{kind:'specification',operation:'apply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision})]);assert.equal(r.turn.status,'failed');assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);assert.equal(await row('SELECT id FROM project_spec_applies WHERE proposal_id=?',q.id),null);
 });
 await test('task-review a different saved change invalidates the old pending proposal',async()=>{
  const o=await owner(),{form}=await savedSelection(o);await follow(o,form,[read(o),change(o)]);
  const other=(await savedSelection(o)).form;await follow(o,other,[read(o),change(o)]);await confirm(o,other.submission.id);
  const task=await taskContext.prepareInformationTask(o.scope,o.user,form.submission.id,true);assert.deepEqual(task.data.websiteResults.items,[{reviewId:form.submission.id,state:'changed'}]);assert.equal(taskContext.informationTaskProposalFailure(JSON.stringify({reply:'changed',action:reopen(form)}),task),'task_target');assert(!JSON.stringify(task.data.websiteResults).includes(other.submission.id));
 });
 await test('task-review expired candidates are explicit and cannot be reopened',async()=>{
  const o=await owner(),{form}=await savedSelection(o);await follow(o,form,[read(o),change(o)]);
  const laterDb={prepare:q=>db.prepare(q.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')","strftime('%Y-%m-%dT%H:%M:%fZ','now','+11 minutes')")),batch:s=>db.batch(s)},later=await o.authority.scope(laterDb);
  const task=await taskContext.prepareInformationTask(later,o.user,form.submission.id,true);assert.deepEqual(task.data.websiteResults.items,[{reviewId:form.submission.id,state:'expired'}]);assert.equal(taskContext.informationTaskProposalFailure(JSON.stringify({reply:'expired',action:reopen(form)}),task),'task_target');
 });
 // Publication adapter fixtures are entirely local, including simulated public hosting.
 await run('DELETE FROM users');
 const publicationGrant=async(o,operations=['read','prepare'])=>{for(const operation of operations)await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.publication',?,'private-test-acceptance','synthetic publication task',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.user,o.project,operation);};
 const publicationAction=(operation,targetId)=>({kind:'review',operation,targetId});
 const savedVersion=async o=>(await site.readSpecification(o.scope,o.user,o.project)).versionId;
 const publicationConfirm=async(o,reviewId)=>json(o,'/api/chat/actions',{id:id(),revision:await revision(o),action:{type:'confirm',kind:'site',reviewId}});
 const publicationState=async o=>{const r=await row('SELECT version_id,revision FROM publications WHERE project_id=?',o.project);return r?{...r}:null;};
 async function publicationTask(o,operation='publish',targetId){
  await publicationGrant(o);const {form}=await savedSelection(o,'Prepare the exact website publication review.');
  const target=targetId??await savedVersion(o);assert(target);
  const result=await follow(o,form,[publicationAction(operation,target)]);
  assert.equal(result.data.continuation.state,'succeeded');return form;
 }
 await test('task-publication publish reopen restore withdraw and historical results stay in the original task',async()=>{
  const o=await owner(),v1=await savedVersion(o),form=await publicationTask(o);
  assert.deepEqual(await publicationState(o),{version_id:null,revision:0});
  const again=await chat(o,'Show that publication review again.',[resume({...form,projectId:o.project}),body=>{
   const text=JSON.stringify(body);assert(text.includes('publicationResults'));assert(text.includes(form.submission.id));return taskReply('UNTRUSTED_REVIEW_READY',publicationAction('reopen',form.submission.id));
  }]);
  assert.equal(again.turn.status,'completed');assert.equal(again.turn.confirmation_id,form.submission.id);assert.doesNotMatch(again.turn.assistant_text,/UNTRUSTED/);
  assert.equal((await row('SELECT count(*) n FROM publication_actions WHERE user_id=?',o.user)).n,1);
  const calls=mainCalls;await json(o,'/api/chat',again.input);assert.equal(mainCalls,calls);
  await publicationConfirm(o,form.submission.id);assert.deepEqual(await publicationState(o),{version_id:v1,revision:1});
  const repeated=await publicationConfirm(o,form.submission.id);assert.match(repeated.turns.at(-1).assistant_text,/already applied/);assert.equal((await publicationState(o)).revision,1);
  const changed=(await savedSelection(o)).form;await follow(o,changed,[read(o),change(o)]);await confirm(o,changed.submission.id);const v2=await savedVersion(o);assert.notEqual(v1,v2);
  const publish=await chat(o,'Publish the latest saved private version in that first task.',[resume({...form,projectId:o.project}),taskReply('Prepare exact publication.',publicationAction('publish',v2))]);
  assert.equal(publish.turn.confirmation_id,publish.input.id);await publicationConfirm(o,publish.input.id);assert.deepEqual(await publicationState(o),{version_id:v2,revision:2});
  const restore=await chat(o,'Restore the original saved version to the public site.',[resume({...form,projectId:o.project}),taskReply('Prepare exact restore.',publicationAction('restore',v1))]);
  assert.equal(restore.turn.confirmation_id,restore.input.id);assert.deepEqual(await publicationState(o),{version_id:v2,revision:2});
  await publicationConfirm(o,restore.input.id);assert.deepEqual(await publicationState(o),{version_id:v1,revision:3});assert.equal(await savedVersion(o),v2,'Public restore must not rewind the private editing head');
  const off=await chat(o,'Take the site from that same task offline.',[resume({...form,projectId:o.project}),taskReply('Prepare withdrawal.',publicationAction('unpublish',o.project))]);
  assert.equal(off.turn.confirmation_id,off.input.id);assert.equal((await publicationState(o)).version_id,v1);await publicationConfirm(o,off.input.id);
  assert.deepEqual(await publicationState(o),{version_id:null,revision:4});
  const current=(await taskContext.prepareInformationTask(o.scope,o.user,form.submission.id,true)).data.publicationResults;
  assert.equal(current.current.versionId,null);assert.equal(current.current.privateVersionId,v2);assert.deepEqual(current.versions.map(v=>v.privateRevision),[2,1]);assert.equal(current.items[0].kind,'unpublish');assert.equal(current.items[0].state,'applied');assert.equal(current.items[0].resultRevision,4);
  const status=await chat(o,'Did that withdrawal finish?', [resume({...form,projectId:o.project}),taskReply('The recorded withdrawal completed. Your saved versions are still private.')]);
  assert.equal(status.turn.status,'completed');assert.equal(status.turn.confirmation_id,null);assert.equal((await row('SELECT count(*) n FROM publication_actions WHERE user_id=?',o.user)).n,4);
 });
 for(const wrong of ['same-project-other-task','other-project','foreign-owner'])await test('task-publication rejects '+wrong+' review and never creates a link',async()=>{
  const o=await owner(),form=await publicationTask(o),other=wrong==='same-project-other-task'?o:await owner();
  if(wrong==='other-project'){await run('UPDATE projects SET owner_user_id=? WHERE id=?',o.user,other.project);await grantNew(o,other.project);}
  const target=wrong==='other-project'?{...o,project:other.project}:other;
  const otherForm=await publicationTask(target);
  const r=await chat(o,'Open the first task’s publication review.',[resume({...form,projectId:o.project}),taskReply('UNTRUSTED_FOREIGN_REVIEW',publicationAction('reopen',otherForm.submission.id))]);
  assert.equal(r.turn.status,'failed');assert.doesNotMatch(r.turn.assistant_text,/UNTRUSTED_FOREIGN/);assert.equal(await row('SELECT * FROM publication_chat_links WHERE turn_id=?',r.input.id),null);assert.equal((await publicationState(o)).revision,0);
 });
 for(const invalid of ['foreign-version','unobserved-version','confirm','extra-field'])await test('task-publication rejects '+invalid+' action',async()=>{
  const o=await owner(),form=await publicationTask(o),other=await owner();let action=publicationAction('restore',invalid==='foreign-version'?await savedVersion(other):id());
  if(invalid==='confirm')action={type:'confirm',kind:'site',reviewId:form.submission.id};
  if(invalid==='extra-field')action={...publicationAction('publish',await savedVersion(o)),approved:true};
  const r=await chat(o,'Review the task publication.',[resume({...form,projectId:o.project}),taskReply('UNTRUSTED_ACTION',action)]);
  assert.equal(r.turn.status,'failed');assert.equal((await row('SELECT count(*) n FROM publication_actions WHERE user_id=?',o.user)).n,1);assert.equal((await publicationState(o)).revision,0);
 });
 for(const boundary of ['missing-read','missing-prepare','revoked-during-inference'])await test('task-publication '+boundary+' cannot disclose or prepare a result',async()=>{
  const o=await owner(),form=await publicationTask(o);
  if(boundary!=='revoked-during-inference')await run("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND feature_id='core.publication' AND operation=?",o.user,boundary==='missing-read'?'read':'prepare');
  const context=(await taskContext.prepareInformationTask(o.scope,o.user,form.submission.id,true)).data.publicationResults;
  if(boundary==='missing-read'){assert.equal(context.state,'denied');assert.equal(context.items.length,0);assert.equal(context.versions.length,0);assert.equal(context.current,null);}
  if(boundary==='missing-prepare')assert.equal(context.canPrepare,false);
  const r=await chat(o,'Open the saved publication review.',[resume({...form,projectId:o.project}),async()=>{
   if(boundary==='revoked-during-inference')await run("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND feature_id='core.publication'",o.user);
   return taskReply('UNTRUSTED_DENIED',publicationAction('reopen',form.submission.id));
  }]);assert.equal(r.turn.status,'failed');assert.doesNotMatch(r.turn.assistant_text,/UNTRUSTED_DENIED/);assert.equal(await row('SELECT * FROM publication_chat_links WHERE turn_id=?',r.input.id),null);
 });
 await test('task-publication applied and superseded reviews cannot be reopened',async()=>{
  const o=await owner(),form=await publicationTask(o),second=await publicationTask(o);await publicationConfirm(o,second.submission.id);
  const task=await taskContext.prepareInformationTask(o.scope,o.user,form.submission.id,true);assert.equal(task.data.publicationResults.items[0].state,'changed');
  assert.equal(taskContext.informationTaskProposalFailure(JSON.stringify({reply:'reopen',action:publicationAction('reopen',form.submission.id)}),task),'task_target');
  const applied=await taskContext.prepareInformationTask(o.scope,o.user,second.submission.id,true);assert.equal(applied.data.publicationResults.items[0].state,'applied');assert.equal(taskContext.informationTaskProposalFailure(JSON.stringify({reply:'reopen',action:publicationAction('reopen',second.submission.id)}),applied),'task_target');
 });
 await test('task-publication expiry is explicit and never extends the review',async()=>{
  const o=await owner(),form=await publicationTask(o);
  const laterDb={prepare:q=>db.prepare(q.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')","strftime('%Y-%m-%dT%H:%M:%fZ','now','+11 minutes')")),batch:s=>db.batch(s)},later=await o.authority.scope(laterDb);
  const task=await taskContext.prepareInformationTask(later,o.user,form.submission.id,true);assert.equal(task.data.publicationResults.items[0].state,'expired');assert.equal(taskContext.informationTaskProposalFailure(JSON.stringify({reply:'expired',action:publicationAction('reopen',form.submission.id)}),task),'task_target');
 });
 await test('task-publication late removal produces an unavailable response without another review',async()=>{
  const o=await owner(),form=await publicationTask(o);
  const r=await chat(o,'Reopen the pending publication.',[resume({...form,projectId:o.project}),async()=>{await run('DELETE FROM publication_actions WHERE id=?',form.submission.id);return taskReply('UNTRUSTED_READY',publicationAction('reopen',form.submission.id));}]);
  assert.equal(r.turn.status,'completed');assert.match(r.turn.assistant_text,/not found/);assert.equal(r.turn.confirmation_id,null);assert.equal(await row('SELECT * FROM publication_chat_links WHERE turn_id=?',r.input.id),null);assert.equal((await publicationState(o)).revision,0);
 });


 await test('task-publication exact review link is checked atomically after model preparation',async()=>{
  const o=await owner(),form=await publicationTask(o);let removed=false;
  const racing=interceptDatabase(db,/^INSERT INTO publication_chat_links/,async()=>{removed=true;await run('DELETE FROM publication_actions WHERE id=?',form.submission.id);});
  const r=await chat(o,'Open that exact pending publication review.',[resume({...form,projectId:o.project}),taskReply('UNTRUSTED_STALE',publicationAction('reopen',form.submission.id))],racing);
  assert(removed);assert.equal(r.turn.status,'failed');assert.doesNotMatch(r.turn.assistant_text,/UNTRUSTED_STALE/);assert.equal(await row('SELECT * FROM publication_chat_links WHERE turn_id=?',r.input.id),null);assert.equal((await progress(form)).turn_id,form.submission.id);assert.equal((await publicationState(o)).revision,0);
 });
 await test('task-publication approval during inference cannot produce another confirmation',async()=>{
  const o=await owner(),form=await publicationTask(o),publication=await modules.module('src/publications.ts');
  const r=await chat(o,'Reopen the publication from that task.',[resume({...form,projectId:o.project}),async()=>{
   const turn=id(),next=await revision(o)+1,action={type:'confirm',kind:'site',reviewId:form.submission.id};
   const prepared=await publication.publicationCommand(o.scope,o.user,turn,'/confirm '+form.submission.id);
   await o.scope.batch([o.scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status,action_json) VALUES(?,?,?,'Confirm publication',?,datetime('now'),'guided','completed',?)").bind(turn,o.user,next,prepared.reply,JSON.stringify(action)),...prepared.statements,o.scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(next,o.user)]);
   return taskReply('UNTRUSTED_PENDING',publicationAction('reopen',form.submission.id));
  }]);assert.equal(r.turn.status,'completed');assert.match(r.turn.assistant_text,/changed or expired/);assert.equal(r.turn.confirmation_id,null);assert.equal((await publicationState(o)).revision,1);assert.equal(await row('SELECT * FROM publication_chat_links WHERE turn_id=?',r.input.id),null);
 });
 await test('task-publication immutable links reject foreign ownership at the storage boundary',async()=>{
  const o=await owner(),form=await publicationTask(o),other=await owner(),otherForm=await publicationTask(other);
  await assert.rejects(run('UPDATE publication_chat_links SET review_id=? WHERE turn_id=?',otherForm.submission.id,form.submission.id),/publication_changed/);
  const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,99,'fixture','fixture',datetime('now'),'ai','pending')",turn,o.user);
  await assert.rejects(run('INSERT INTO publication_chat_links VALUES(?,?)',turn,otherForm.submission.id),/publication_changed/);
  assert.equal((await row('SELECT review_id FROM publication_chat_links WHERE turn_id=?',form.submission.id)).review_id,form.submission.id);
 });


 for(const provider of ['github','cloudflare'])await test('task-consent exact '+provider+' handoff retains task and never authorizes',async()=>{
  const o=await owner(),{form}=await savedSelection(o,'Show connection controls for this website task.');
  const result=await follow(o,form,[{kind:'interaction',operation:'requestConnection',projectId:o.project,provider}]);assert.equal(result.data.continuation.state,'succeeded');
  const issued=await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',form.submission.id),handoff=await store.readInteraction(o.scope,o.user,issued.id);
  assert.equal(handoff.envelope.scope.projectId,o.project);assert.equal(handoff.envelope.definition.cards[0].binding,'connection.'+provider+'@1');assert.equal((await row('SELECT task_id FROM chat_task_progress WHERE turn_id=?',form.submission.id)).task_id,form.envelope.scope.taskId);
  const calls=mainCalls;await follow(o,form);assert.equal(mainCalls,calls);assert.equal(await row('SELECT 1 FROM '+provider+'_oauth_states WHERE user_id=?',o.user),null);assert.equal(await row('SELECT 1 FROM connection_oauth_exchanges WHERE user_id=?',o.user),null);await noEffect(o,form);
 });
 for(const invalid of ['foreign-project','account-scope','approval','provider'])await test('task-consent rejects '+invalid,async()=>{
  const o=await owner(),other=await owner(),{form}=await savedSelection(o,'Show connection controls for this website task.');
  const action={kind:'interaction',operation:'requestConnection',projectId:o.project,provider:'github'};
  if(invalid==='foreign-project')action.projectId=other.project;if(invalid==='account-scope')action.projectId=null;if(invalid==='approval')action.approve=true;if(invalid==='provider')action.provider='arbitrary';
  const result=await follow(o,form,[action]);assert.equal(result.data.continuation.state,'failed');assert.equal(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',form.submission.id),null);assert.equal(await row('SELECT 1 FROM github_oauth_states WHERE user_id=?',o.user),null);await noEffect(o,form);
 });
 await test('task-consent late editing denial prevents issuance',async()=>{
  const o=await owner(),{form}=await savedSelection(o,'Show connection controls for this website task.');
  const result=await follow(o,form,[async()=>{await run("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND feature_id='core.editing' AND operation='prepare'",o.user);return {kind:'interaction',operation:'requestConnection',projectId:o.project,provider:'cloudflare'};}]);
  assert.equal(result.data.continuation.state,'failed');assert.equal(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',form.submission.id),null);assert.equal(await row('SELECT 1 FROM cloudflare_oauth_states WHERE user_id=?',o.user),null);
 });

 const photoAction=o=>({kind:'interaction',operation:'requestPhotoUpload',projectId:o.project});
 async function mediaTask(o){
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','read','private-test-acceptance','synthetic task media',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.user,o.project);
  const {form}=await savedSelection(o,'Add a photo to this website task.');const shown=await follow(o,form,[photoAction(o)]);assert.equal(shown.data.continuation.state,'succeeded');
  const handoff=await store.readInteraction(o.scope,o.user,(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',form.submission.id)).id);
  return {f:{...form,projectId:o.project},handoff};
 }
 async function uploadedFor(o,h,status='pending',name='TASK_PHOTO_CANARY'){
  const file=id();await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at,handoff_json) VALUES(?,?,?,?,?,1024,640,480,?,datetime('now'),?)",file,o.project,name,'PRIVATE_TASK_PHOTO_KEY/'+file,'c'.repeat(64),status,JSON.stringify({interactionId:h.envelope.id,definitionDigest:h.envelope.definitionDigest}));return file;
 }
 const media=(o,f)=>taskContext.prepareInformationTask(o.scope,o.user,f.submission.id,true).then(t=>t.data.photoResults);
 await test('task-media exact task uploader, metadata results and replay preserve website and original task',async()=>{
  const o=await owner(),{f,handoff}=await mediaTask(o),file=await uploadedFor(o,handoff);
  assert.equal((await row('SELECT task_id FROM chat_task_progress WHERE turn_id=?',f.submission.id)).task_id,f.envelope.scope.taskId);
  assert.deepEqual((await media(o,f)).items.map(p=>({id:p.id,status:p.status,safety:p.safetyStatus})),[{id:file,status:'pending',safety:'pending'}]);
  await run("UPDATE project_files SET status='ready' WHERE id=?",file);
  const result=await chat(o,'Did that task’s photo finish uploading?', [resume(f),body=>{const text=JSON.stringify(body);assert.match(text,/TASK_PHOTO_CANARY/);assert.doesNotMatch(text,/PRIVATE_TASK_PHOTO_KEY/);assert(!text.includes('c'.repeat(64)));return taskReply('Your photo is saved privately and held. It has not changed the website.');}]);
  assert.equal(result.turn.status,'completed');assert.equal((await row('SELECT task_id FROM chat_task_progress WHERE turn_id=?',result.input.id)).task_id,f.envelope.scope.taskId);const calls=mainCalls;await json(o,'/api/chat',result.input);assert.equal(mainCalls,calls);await noEffect(o,f);
 });
 await test('task-media excludes direct uploads, other tasks and other projects',async()=>{
  const o=await owner(),{f,handoff}=await mediaTask(o),other=await mediaTask(o),foreign=await owner(),foreignTask=await mediaTask(foreign);
  const own=await uploadedFor(o,handoff,'ready'),hidden=await uploadedFor(o,other.handoff,'ready','OTHER_TASK_PHOTO');await uploadedFor(foreign,foreignTask.handoff,'ready','FOREIGN_PHOTO');await selectedPhoto(o,'DIRECT_UPLOAD_PHOTO');
  const data=await media(o,f);assert.deepEqual(data.items.map(p=>p.id),[own]);assert(!JSON.stringify(data).includes(hidden));
  const result=await chat(o,'What about that first photo?', [resume(f),body=>{assert.doesNotMatch(JSON.stringify(body),/OTHER_TASK_PHOTO|FOREIGN_PHOTO|DIRECT_UPLOAD_PHOTO/);return taskReply('The task photo is saved privately and held.');}]);assert.equal(result.turn.status,'completed');await noEffect(o,f);
 });
 await test('task-media dismissed handoff retains file outcomes and does not recreate uploads',async()=>{
  const o=await owner(),{f,handoff}=await mediaTask(o),file=await uploadedFor(o,handoff,'ready');await store.mutateInteraction(o.scope,o.user,{version:1,requestId:id(),interactionId:handoff.envelope.id,definitionDigest:handoff.envelope.definitionDigest,expectedAnswerRevision:0,operation:'cancel'});
  assert.equal((await media(o,f)).items[0].id,file);const r=await chat(o,'Is the photo from that task still saved?', [resume(f),taskReply('The photo remains saved privately and held after the uploader was dismissed.')]);assert.equal(r.turn.status,'completed');assert.equal((await row('SELECT count(*) n FROM project_files WHERE project_id=?',o.project)).n,1);await noEffect(o,f);
 });
 await test('task-media denied reads carry no photo facts',async()=>{
  const o=await owner(),{f,handoff}=await mediaTask(o);await uploadedFor(o,handoff,'ready');await run("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND feature_id='core.editing' AND operation='read'",o.user);
  assert.equal((await media(o,f)).state,'denied');const r=await chat(o,'What is the status of that task photo?', [resume(f),body=>{assert.doesNotMatch(JSON.stringify(body),/TASK_PHOTO_CANARY/);return taskReply('I cannot read the photo’s current status with your access.');}]);assert.equal(r.turn.status,'completed');
 });
 for(const invalid of ['foreign','other-owned','extra-field','upload-bytes'])await test('task-media rejects '+invalid+' upload action',async()=>{
  const o=await owner(),{f}=await mediaTask(o),a=photoAction(o);
  if(invalid==='foreign')a.projectId=(await owner()).project;
  if(invalid==='other-owned'){a.projectId=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Other','Other','draft',datetime('now'),datetime('now'))",a.projectId,o.user);}
  if(invalid==='extra-field')a.url='https://example.invalid/photo.jpg';if(invalid==='upload-bytes')a.operation='uploadPhoto';
  const r=await chat(o,'Show an uploader for that task.',[resume(f),taskReply('UNTRUSTED_UPLOAD',a)]);assert.equal(r.turn.status,'failed');assert.doesNotMatch(r.turn.assistant_text,/UNTRUSTED_UPLOAD/);assert.equal(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',r.input.id),null);await noEffect(o,f);
 });
 for(const change of ['remove','clearance','read-revoked','owner-transfer'])await test('task-media late '+change+' fences model reply',async()=>{
  const o=await owner(),{f,handoff}=await mediaTask(o),file=await uploadedFor(o,handoff,'ready'),other=await owner();
  const result=await chat(o,'Tell me whether that photo can be used.',[resume(f),async()=>{
   if(change==='remove')await run('DELETE FROM project_files WHERE id=?',file);
   if(change==='clearance')await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",file);
   if(change==='read-revoked')await run("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND feature_id='core.editing' AND operation='read'",o.user);
   if(change==='owner-transfer')await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);
   return taskReply('UNTRUSTED_STALE_PHOTO');}]);assert.equal(result.turn.status,'failed');assert.doesNotMatch(result.turn.assistant_text,/UNTRUSTED_STALE_PHOTO/);assert.equal(await row('SELECT turn_id FROM chat_task_progress WHERE turn_id=?',result.input.id),null);
 });
 await test('task-media upload metadata is not selection or clearance authority for website changes',async()=>{
  const o=await owner(),{f,handoff}=await mediaTask(o),file=await uploadedFor(o,handoff,'ready');
  const r=await chat(o,'Put the uploaded photo on the website now.',[resume(f),taskReply('UNTRUSTED_UNCLEARED_USE',{kind:'specification',operation:'change',projectId:o.project,expectedRevision:1,operations:[{type:'pages.setPhotos',pageId:'home',photos:[{id:file,alt:'An invented description'}]}]})]);
  assert.notEqual(r.turn.assistant_text,'UNTRUSTED_UNCLEARED_USE');assert.equal(await row('SELECT id FROM project_spec_proposals WHERE id=?',r.input.id),null);await noEffect(o,f);
 });
 const observationGrant=async(o,project=o.project)=>{for(const feature of ['core.editing','core.insights'])await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,'read','private-test-acceptance','synthetic task observations',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.user,project,feature);};
 const overview=o=>({kind:'interaction',operation:'showView',view:{version:1,projectId:o.project,widgets:['projects','traffic'],shortcuts:[]}});
 async function observedTask(o){await observationGrant(o);const {form}=await savedSelection(o,'Show status and page requests for my selected gardening website.');await follow(o,form,[null]);return {...form,projectId:o.project};}
 const observations=async(o,f)=>(await taskContext.prepareInformationTask(o.scope,o.user,f.submission.id,true)).data.projectObservations;
 const countTraffic=async(o,count=7)=>run("INSERT INTO site_traffic_daily(project_id,day,requests) VALUES(?,date('now'),?) ON CONFLICT(project_id,day) DO UPDATE SET requests=excluded.requests",o.project,count);
 await test('task-observation exact project facts, overview and refresh preserve the original continuation',async()=>{
  const o=await owner(),f=await observedTask(o),other=await owner();await countTraffic(o);await countTraffic(other,999);
  const before=await observations(o,f);assert.equal(before.projects.status,'ready');assert.equal(before.projects.data.items[0].websitePublished,false);assert.equal(before.traffic.data.rows.reduce((n,r)=>n+r.requests,0),7);assert(!JSON.stringify(before).includes(other.project));assert.match(before.trafficNotice,/not unique visitors/);
  const shown=await chat(o,'Show that project’s status and traffic here.',[resume(f),body=>{assert(JSON.stringify(body).includes('projectObservations'));assert(JSON.stringify(body).includes('successful_html_requests'));return taskReply('UNTRUSTED_METRICS',overview(o));}]);
  assert.equal(shown.turn.status,'completed');assert.doesNotMatch(shown.turn.assistant_text,/UNTRUSTED_METRICS/);
  assert.equal((await row('SELECT task_id FROM chat_task_progress WHERE turn_id=?',shown.input.id)).task_id,f.envelope.scope.taskId);
  const v=await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',shown.input.id),view=await store.readInteraction(o.scope,o.user,v.id);
  assert.deepEqual(view.envelope.definition.workspaceView,overview(o).view);assert.equal((await store.readInteraction(o.scope,o.user,f.envelope.id)).state,'submitted');
  const input={version:1,interactionId:v.id,definitionDigest:view.envelope.definitionDigest,kind:'traffic'},calls=mainCalls;
  const displayed=await json(o,'/api/chat/interactions/v1/view-component',input);assert.deepEqual(displayed.data,before.traffic.data);
  await countTraffic(o,12);assert.equal((await json(o,'/api/chat/interactions/v1/view-component',input)).data.rows[0].requests,12);
  await json(o,'/api/chat',shown.input);assert.equal(mainCalls,calls);assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE origin_turn_id=?',shown.input.id)).n,1);
  const current=await chat(o,'How many page requests for that task now?', [resume(f),taskReply('There are 12 recorded page requests, including repeats and bots.')]);assert.equal(current.turn.status,'completed');await noEffect(o,f);
 });
 for(const unavailable of ['missing','malformed','outage','denied'])await test('task-observation '+unavailable+' telemetry is unknown and never a zero count',async()=>{
  const o=await owner(),f=await observedTask(o);await countTraffic(o,8);const metadata=await row('SELECT enabled_at FROM site_traffic_metadata WHERE id=1');
  let database=o.scope;
  if(unavailable==='missing')await run('DELETE FROM site_traffic_metadata');
  if(unavailable==='malformed')await run("UPDATE site_traffic_metadata SET enabled_at='invalid-time' WHERE id=1");
  if(unavailable==='outage')database=await o.authority.scope(interceptDatabase(db,/^SELECT t.project_id,t.day,t.requests/,()=>{throw Error('Synthetic telemetry outage');}));
  if(unavailable==='denied')await run("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND feature_id='core.insights'",o.user);
  try{
   const data=(await taskContext.prepareInformationTask(database,o.user,f.submission.id,true)).data.projectObservations;
   assert.equal(data.projects.status,'ready');assert.equal(data.traffic.status,unavailable==='denied'?'denied':'unavailable');assert.equal(data.traffic.data,null);
   assert.equal(data.projects.data.items[0].websitePublished,false);
  }finally{await run('INSERT INTO site_traffic_metadata VALUES(1,?) ON CONFLICT(id) DO UPDATE SET enabled_at=excluded.enabled_at',metadata.enabled_at);}
 });
 await test('task-observation empty available telemetry is a measured empty window',async()=>{
  const o=await owner(),f=await observedTask(o),data=await observations(o,f);assert.equal(data.traffic.status,'ready');assert.deepEqual(data.traffic.data.rows,[]);assert.equal(data.traffic.data.days,30);assert(data.traffic.data.enabledAt);
 });
 for(const invalid of ['account','foreign','other-owned','extra-widget','shortcut','invented-metric','recursive'])await test('task-observation rejects '+invalid+' view outside the admitted task',async()=>{
  const o=await owner(),f=await observedTask(o),action=overview(o);
  if(invalid==='account')action.view.projectId=null;
  if(invalid==='foreign')action.view.projectId=(await owner()).project;
  if(invalid==='other-owned'){const target=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Other','Other','draft',datetime('now'),datetime('now'))",target,o.user);action.view.projectId=target;}
  if(invalid==='extra-widget')action.view.widgets.push('storage');
  if(invalid==='shortcut')action.view.shortcuts=['project'];
  if(invalid==='invented-metric')action.view.metrics={visitors:999};
  if(invalid==='recursive')Object.assign(action,{operation:'requestProjectSelection'});
  const r=await chat(o,'Show this task’s overview.',[resume(f),taskReply('UNTRUSTED_OUT_OF_SCOPE',action)]);assert.equal(r.turn.status,'failed');assert.doesNotMatch(r.turn.assistant_text,/UNTRUSTED_OUT_OF_SCOPE/);assert.equal(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',r.input.id),null);await noEffect(o,f);
 });
 for(const when of ['dispatch','response','commit'])await test('task-observation access loss at '+when+' fences facts and views',async()=>{
  const o=await owner(),f=await observedTask(o);await countTraffic(o);const revoke=()=>run("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND feature_id='core.insights'",o.user);
  let database=db;const steps=[resume(f)];
  if(when==='dispatch')database=interceptDatabase(db,/^INSERT INTO agent_inspections/,revoke);
  else{steps.push(async()=>{if(when==='response')await revoke();return taskReply('UNTRUSTED_REVOKED_FACT',overview(o));});if(when==='commit')database=interceptDatabase(db,/^INSERT INTO chat_interactions\(/,revoke);}
  const r=await chat(o,'Show traffic in the same task.',steps,database);assert.equal(r.turn.status,'failed');assert.doesNotMatch(r.turn.assistant_text,/UNTRUSTED_REVOKED_FACT/);assert.equal(r.calls,when==='dispatch'?1:2);assert.equal(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',r.input.id),null);await noEffect(o,f);
 });
 await test('task-observation ordinary traffic lookup shares typed scope and guards',async()=>{
  const o=await owner(),other=await owner();await observationGrant(o);await countTraffic(o,4);await countTraffic(other,77);
  const action={kind:'inspect',scope:'traffic',targetId:o.project};assert(inspection.inspectionRequest(JSON.stringify({reply:'Check the recorded page requests.',action})));
  const direct=await agent.prepareSiteAction(o.scope,o.user,id(),JSON.stringify({reply:'Read traffic.',action}),await agent.siteContext(o.scope,o.user));const data=JSON.parse(direct.inspection);assert.equal(data.observation.status,'ready');assert.equal(data.observation.data.rows[0].requests,4);assert(!direct.inspection.includes(other.project));assert(direct.inspectionGuards.length);
  const r=await chat(o,'How much traffic does my gardening site have?', [action,async()=>{await run("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND feature_id='core.insights'",o.user);return null;}]);assert.equal(r.turn.status,'failed');assert.doesNotMatch(r.turn.assistant_text,/UNTRUSTED_MODEL_PROSE/);
 });

 await test('task-observation ordinary account traffic discards facts after project ownership changes',async()=>{
  const o=await owner(),other=await owner();await observationGrant(o,null);await countTraffic(o,5);
  const r=await chat(o,'How many page requests across my sites?', [{kind:'inspect',scope:'traffic'},async()=>{await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);return null;}]);
  assert.equal(r.turn.status,'failed');assert.doesNotMatch(r.turn.assistant_text,/UNTRUSTED_MODEL_PROSE/);
 });
 console.log(`Chat model continuation: ${cases} actual-handler scenarios passed; ${mainCalls} scripted main calls, ${ackCalls} ack calls. No external model, remote customer publication or payment.`);
}finally{globalThis.fetch=originalFetch;await Promise.allSettled(background);console.warn=originalWarn;await fixture.close();}
