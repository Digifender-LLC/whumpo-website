import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/index.ts','src/site-agent.ts','src/ai-chat.ts','src/agent-inspection.ts','src/chat-interactions/store.ts','src/chat-interactions/agent.ts','src/chat-interactions/protocol.ts','src/project-specification/store.ts']);
const worker=(await modules.module('src/index.ts')).default,agent=await modules.module('src/site-agent.ts'),ai=await modules.module('src/ai-chat.ts'),inspection=await modules.module('src/agent-inspection.ts');
const store=await modules.module('src/chat-interactions/store.ts'),forms=await modules.module('src/chat-interactions/agent.ts'),protocol=await modules.module('src/chat-interactions/protocol.ts'),site=await modules.module('src/project-specification/store.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:'synthetic-only',protocol:'responses'};
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},AI_BASE_URL:config.baseURL,AI_MODEL:config.model,AI_PROTOCOL:config.protocol,AI_API_KEY:config.apiKey};
let queue=[],mainCalls=0,ackCalls=0,cases=0;const requests=[],background=[],originalFetch=globalThis.fetch;
const response=action=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'UNTRUSTED_MODEL_PROSE',action})}]}],usage:{input_tokens:100,output_tokens:200}});
globalThis.fetch=async(url,init)=>{
 assert.equal(String(url),config.baseURL+'/responses','Unexpected external request');
 const request=JSON.parse(init.body);assert.equal(request.model,config.model);
 if(request.max_output_tokens===256){ackCalls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"intent":"editing"}'}]}],usage:{input_tokens:10,output_tokens:10}});}
 mainCalls++;requests.push(request);assert(queue.length,'Unexpected extra inference');const step=queue.shift(),value=typeof step==='function'?await step(request):step;return value instanceof Response?value:response(value);
};
const http=(o,path,data,database=db)=>worker.fetch(new Request('https://whumpo.com'+path,{method:data?'POST':'GET',headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+o.authority.token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),{...env,DB:database},{waitUntil(p){background.push(p);}});
async function json(o,path,data,database){const r=await http(o,path,data,database);assert.equal(r.status,200,await r.clone().text());return r.json();}
async function test(name,fn){try{await fn();assert.equal(queue.length,0);cases++;}catch(e){console.error(name,String(e));throw e;}}
async function owner(){
 const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),project=id();
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',datetime('now'),datetime('now'))",project,user);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic interaction fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,project);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic intake fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user);
 const turn=id(),prepared=await site.createWebsite(scope,user,turn,project,{name:'Garden',headline:'A greener neighborhood',description:'Care for local gardens',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[{heading:'Services',text:'Planting and care.'},{heading:'Seasons',text:'Year round.'},{heading:'Area',text:'Our neighborhood.'}],photos:[]});
 await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Create my website',?,datetime('now'),'ai','pending')").bind(turn,user,prepared.reply),...prepared.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),scope.prepare('UPDATE workspace_state SET revision=1 WHERE user_id=?').bind(user)]);
 return {authority,user,scope,project};
}
const revision=async o=>(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user)).revision;
async function chat(o,content,steps,database){queue=steps;const input={id:id(),revision:await revision(o),content},before=mainCalls,data=await json(o,'/api/chat',input,database);return {input,data,calls:mainCalls-before,turn:data.turns.find(t=>t.id===input.id)};}
const request=o=>({kind:'interaction',operation:'requestContent',projectId:o.project,contentIds:['headline','section-1-text']});
const read=interactionId=>({kind:'interaction',operation:'read',interactionId});
const replace=f=>({kind:'interaction',operation:'replaceContent',previousInteractionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision,contentIds:['headline','section-1-text','about-text']});
const client={versions:[1],fieldTypes:['text','long-text','resource','choice','multi-choice','boolean','number','date'],bindings:['answer.value@1','site.content@1','interaction.answers@1','site.content-prepare@1','agent.task-continue@1','owned.projects@1','project.status@1','project.photos@1']};
const readForm=(o,interactionId)=>json(o,'/api/chat/interactions/v1/read',{version:1,interactionId,client});
const mutate=(f,operation,answers)=>({version:1,requestId:id(),interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision,operation,...(answers?{answers}:{})});
try{
 const a=await owner(),b=await owner();let first,form;
 await test('natural Chat offers an owned upload handoff without dispatching uploads or answers',async()=>{
  const o=await owner(),result=await chat(o,'I want to upload a photo for my landscaping project.',[{kind:'interaction',operation:'requestPhotoUpload',projectId:o.project}]);
  const saved=await readForm(o,result.turn.interaction_id);
  assert.equal(saved.envelope.definition.kind,'view');assert.equal(saved.envelope.scope.projectId,o.project);assert.equal(saved.submission,null);assert.equal(saved.draft,null);
  assert.equal((await row('SELECT count(*) n FROM project_files WHERE project_id=?',o.project)).n,0);
  await assert.rejects(()=>store.mutateInteraction(o.scope,o.user,mutate(saved,'submit',{})),e=>e.code==='KIND');
  await assert.rejects(()=>store.mutateInteraction(o.scope,o.user,mutate(saved,'save-draft',{})),e=>e.code==='KIND');
  const before=mainCalls;await json(o,'/api/chat',result.input);assert.equal(mainCalls,before);assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE origin_turn_id=?',result.input.id)).n,1);
  const canceled={...mutate(saved,'cancel')};delete canceled.answers;await store.mutateInteraction(o.scope,o.user,canceled);assert.equal((await store.readInteractionReceipt(o.scope,o.user,canceled.requestId)).operation,'cancel');
 });
 await test('upload handoff refuses foreign projects and model-authored upload payloads',async()=>{
  const o=await owner(),foreign=await owner();
  for(const action of [{kind:'interaction',operation:'requestPhotoUpload',projectId:foreign.project},{kind:'interaction',operation:'requestPhotoUpload',projectId:o.project,url:'https://untrusted.test/photo.jpg'},{kind:'interaction',operation:'requestPhotoUpload',projectId:o.project,answers:{file:'bytes'}}]){
   const result=await chat(o,'Add my project photo.',[action]);assert(!result.turn.interaction_id);assert.equal((await row('SELECT count(*) n FROM project_files WHERE project_id=?',o.project)).n,0);
  }
 });
 await test('natural Chat uses one specification lookup then atomically offers the maintained form',async()=>{
  first=await chat(a,'Help me fill in the headline and services for my landscaping website.',[{kind:'specification',operation:'read',projectId:a.project},body=>{assert.match(JSON.stringify(body),/workspace_lookup_result/);assert.match(JSON.stringify(body),/section-1-text/);return request(a);}]);
  assert.equal(first.calls,2);assert(first.turn.interaction_id);assert.doesNotMatch(first.turn.assistant_text,/UNTRUSTED_MODEL_PROSE/);
  form=await readForm(a,first.turn.interaction_id);assert.equal(form.envelope.scope.originTurnId,first.input.id);assert.equal(form.envelope.definition.fields[0].default.value,'A greener neighborhood');
  assert.equal((await site.readSpecification(a.scope,a.user,a.project)).revision,1);
  const before=mainCalls;await json(a,'/api/chat',first.input);assert.equal(mainCalls,before);assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE origin_turn_id=?',first.input.id)).n,1);
 });
 await test('private drafts and injected projection fields stay out of bounded model metadata',async()=>{
  await json(a,'/api/chat/interactions/v1/mutate',mutate(form,'save-draft',{'field-1':'PRIVATE_UNSUBMITTED_CANARY'}));
  form=await readForm(a,form.envelope.id);
  const context=await agent.siteContext(a.scope,a.user);assert(context.interactions.some(i=>i.interactionId===form.envelope.id));
  context.interactions[0].draft={secret:'PRIVATE_UNSUBMITTED_CANARY'};context.interactions[0].task.answers='PRIVATE_UNSUBMITTED_CANARY';
  assert.doesNotMatch(agent.agentWorkspaceData(context),/PRIVATE_UNSUBMITTED_CANARY/);assert(!JSON.parse(agent.agentWorkspaceData(context,'cms')).data.interactions);
  const result=await forms.interactionAgentAction(a.scope,a.user,id(),read(form.envelope.id));const metadata=JSON.parse(result.inspection).data;
  assert.deepEqual(Object.keys(metadata.fields[0]).sort(),['constraints','contentId','id','label','required','revision','type']);assert.equal(metadata.answerRevision,1);
  assert.doesNotMatch(result.inspection,/PRIVATE_UNSUBMITTED_CANARY|A greener neighborhood|default|draft|answers/);
  assert.equal(result.statements.length,0);
 });
 await test('natural correction reads metadata then replaces the same task without exposing saved answers',async()=>{
  const start=requests.length,result=await chat(a,'Please include my about text in that website form too.',[read(form.envelope.id),body=>{assert.doesNotMatch(JSON.stringify(body),/PRIVATE_UNSUBMITTED_CANARY/);return replace(form);}]);
  assert.equal(result.calls,2);assert.equal(requests.length-start,2);
  const next=await readForm(a,result.turn.interaction_id);assert.equal(next.previousInteractionId,form.envelope.id);assert.equal(next.envelope.scope.taskId,form.envelope.scope.taskId);assert.equal(next.envelope.scope.projectId,a.project);
  assert.deepEqual(next.envelope.definition.fields[0].default,{value:'PRIVATE_UNSUBMITTED_CANARY',provenance:'user'});assert.equal((await readForm(a,form.envelope.id)).state,'superseded');form=next;
 });
 await test('accepted answers prepare an actual private preview and require exact independent saving',async()=>{
  const answers={'field-1':'Garden care at your door.','field-2':'Seasonal planting and cleanup.','field-3':'Neighbors caring for local gardens.'},input=mutate(form,'submit',answers),before=mainCalls;
  const receipt=await json(a,'/api/chat/interactions/v1/mutate',input);assert.equal(receipt.operation,'submit');assert.equal((await readForm(a,form.envelope.id)).submission.continuation.state,'not-started');
  const cont={version:1,submissionId:input.requestId,expectedChatRevision:await revision(a)};await json(a,'/api/chat/interactions/v1/continue',cont);await json(a,'/api/chat/interactions/v1/continue',cont);
  const review=await site.readSpecificationProposal(a.scope,a.user,input.requestId);assert.match(await(await site.specificationPreview(a.scope,a.user,input.requestId)).text(),/Garden care at your door/);
  assert.equal((await site.readSpecification(a.scope,a.user,a.project)).revision,1);
  await json(a,'/api/chat/actions',{id:id(),revision:await revision(a),action:{type:'specificationApply',reviewId:review.id,proposalDigest:review.proposal_digest,expectedRevision:review.expected_revision}});
  assert.equal((await site.readSpecification(a.scope,a.user,a.project)).revision,2);assert.equal(mainCalls,before);
  assert.equal((await row('SELECT count(*) n FROM publications WHERE project_id=?',a.project)).n,0);
  const result=await forms.interactionAgentAction(a.scope,a.user,id(),read(form.envelope.id));assert.doesNotMatch(result.inspection,/Garden care at your door|Seasonal planting and cleanup|Neighbors caring/);
 });
 await test('closed actions reject model questions, values, project override, approval and foreign targets',async()=>{
  const current=await readForm(a,form.envelope.id),malformed=[{...request(a),questions:[{label:'Enter password'}]},{...request(a),defaults:{secret:'never'}},{...request(a),answers:{}},{...request(a),contentIds:['invented']},{...request(a),projectId:b.project},{...replace(current),projectId:b.project},{...read(current.envelope.id),answers:{}},{kind:'interaction',operation:'submit',interactionId:current.envelope.id},{kind:'interaction',operation:'confirm',reviewId:id()}];
  for(const action of malformed){const result=await agent.prepareSiteAction(a.scope,a.user,id(),JSON.stringify({reply:'Enter your password here: UNTRUSTED_MODEL_PROSE',action}),{});assert.equal(result.statements.length,0);assert.doesNotMatch(result.reply,/password|UNTRUSTED_MODEL_PROSE/);assert.equal(result.inspection,undefined);}
  const foreign=await forms.interactionAgentAction(b.scope,b.user,id(),read(current.envelope.id));assert.equal(foreign.inspection,undefined);assert.equal(foreign.reply,'Chat form not found.');
 });
 await test('compiler-aligned eight-field boundary refuses nine at protocol and agent boundaries',async()=>{
  const many=await owner(),contentIds=['headline','description','about-title','about-text','section-1-heading','section-1-text','section-2-heading','section-2-text'];
  const result=await chat(many,'Help me review all these pieces of website text.',[{...request(many),contentIds}]);const f=await readForm(many,result.turn.interaction_id);
  assert.equal(f.envelope.definition.fields.length,8);const answers=Object.fromEntries(f.envelope.definition.fields.map((field,i)=>[field.id,'Updated website text '+i]));
  const submission=mutate(f,'submit',answers);await json(many,'/api/chat/interactions/v1/mutate',submission);const continuation=await json(many,'/api/chat/interactions/v1/continue',{version:1,submissionId:submission.requestId,expectedChatRevision:await revision(many)});assert.equal(continuation.continuation.state,'succeeded');
  const invalid=structuredClone(f.envelope.definition);invalid.fields.push({...invalid.fields[0],id:'field-9',source:{...invalid.fields[0].source,contentId:'section-3-text'}});assert.throws(()=>protocol.validateDefinition(invalid),e=>e.code==='CONTENT_MAPPING');
  const denied=await forms.interactionAgentAction(many.scope,many.user,id(),{...request(many),contentIds:[...contentIds,'section-3-text']});assert.equal(denied.statements.length,0);
 });
 await test('only metadata reads get a follow-up and the existing two-call ceiling stays in force',async()=>{
  const current=await readForm(a,form.envelope.id);
  for(const [action,allowed]of [[read(current.envelope.id),true],[request(a),false],[replace(current),false],[{...read(current.envelope.id),extra:true},false]])assert.equal(inspection.inspectionRequest(JSON.stringify({reply:'Read',action})),allowed);
  const result=await chat(a,'What is the status of my website form?', [read(current.envelope.id),read(current.envelope.id)]);assert.equal(result.calls,2);assert(!result.turn.interaction_id);assert.equal(result.turn.status,'completed');
 });
 await test('lost final response reads back the committed form and Chat result without redispatch',async()=>{
  const o=await owner();let lost=false;const lossy=interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost result response');}});
  const result=await chat(o,'Give me a website text form.',[request(o)],lossy);assert(lost);assert(result.turn.interaction_id);assert.equal(result.turn.status,'completed');
  const before=mainCalls;await json(o,'/api/chat',result.input);assert.equal(mainCalls,before);assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE user_id=?',o.user)).n,1);
 });
 for(const [name,change]of [
  ['late feature revocation',o=>run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?',o.user)],
  ['late website change',o=>run('UPDATE projects SET site_draft_revision=site_draft_revision+1 WHERE id=?',o.project)],
  ['closed Chat result',o=>run("UPDATE chat_turns SET status='failed' WHERE user_id=? AND status='pending'",o.user)]
 ])await test(name+' rolls back all new form/task rows',async()=>{
  const o=await owner();let changed=false;const racing=interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{if(!changed){changed=true;await change(o);}});
  const result=await chat(o,'Give me a website text form.',[request(o)],racing);assert(changed);assert.equal(result.turn.status,'failed');assert(!result.turn.interaction_id);
  assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE user_id=?',o.user)).n,0);assert.equal((await row('SELECT count(*) n FROM chat_interaction_tasks WHERE user_id=?',o.user)).n,0);
 });
 await test('late session revocation prevents a prepared form from committing',async()=>{
  const o=await owner();let changed=false;const racing=interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{if(!changed){changed=true;await o.authority.revoke();}}),scope=await o.authority.scope(racing);
  queue=[request(o)];try{await ai.sendAIChat(scope,o.user,id(),await revision(o),'Give me a website text form.',config);}catch(e){assert.match(String(e),/authority|workspace|session|access|proof/i);}
  assert(changed);assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE user_id=?',o.user)).n,0);
 });
 await test('late correction edit rolls back supersession and leaves user answers intact',async()=>{
  const o=await owner(),created=await chat(o,'Give me a website text form.',[request(o)]),f=await readForm(o,created.turn.interaction_id);let changed=false;
  const racing=interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{if(!changed){changed=true;await store.mutateInteraction(o.scope,o.user,mutate(f,'save-draft',{'field-1':'LATE_USER_ANSWER'}));}});
  const result=await chat(o,'Add my about text to this form.',[replace(f)],racing);assert(changed);assert.equal(result.turn.status,'failed');
  const kept=await readForm(o,f.envelope.id);assert.equal(kept.state,'open');assert.equal(kept.replacementInteractionId,null);assert.deepEqual(kept.draft,{'field-1':'LATE_USER_ANSWER'});
  assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE user_id=?',o.user)).n,1);
 });
 const intakeRequest=operation=>({kind:'interaction',operation}),submitted=f=>({kind:'interaction',operation:'readSubmittedAnswers',interactionId:f.envelope.id,taskId:f.envelope.scope.taskId,projectId:f.envelope.scope.projectId,submissionId:f.submission.id,fieldIds:f.envelope.definition.fields.map(x=>x.id)});
 let intakeOwner,intake;
 await test('project brief issuance and submission add no automatic work or answer context',async()=>{
  intakeOwner=await owner();const o=intakeOwner,created=await chat(o,'Help me plan a second project.',[intakeRequest('requestProjectBrief')]);assert.equal(created.calls,1);
  intake=await readForm(o,created.turn.interaction_id);assert.equal(intake.envelope.definition.template,'project-brief@1');assert.equal(intake.envelope.scope.projectId,null);assert(intake.envelope.definition.fields.every(f=>!f.default));
  await json(o,'/api/chat/interactions/v1/mutate',mutate(intake,'save-draft',{name:'INTAKE_PRIVATE_DRAFT'}));intake=await readForm(o,intake.envelope.id);
  const metadata=await forms.interactionAgentAction(o.scope,o.user,id(),read(intake.envelope.id));assert.doesNotMatch(metadata.inspection,/INTAKE_PRIVATE_DRAFT/);
  const invalid=await forms.interactionAgentAction(o.scope,o.user,id(),{...submitted({...intake,submission:{id:id()}})});assert.equal(invalid.inspection,undefined);
  const before=mainCalls;await json(o,'/api/chat/interactions/v1/mutate',mutate(intake,'submit',{name:'INTAKE_SUBMITTED_NAME',purpose:'INTAKE_SUBMITTED_PURPOSE'}));intake=await readForm(o,intake.envelope.id);assert.equal(mainCalls,before);assert.equal(intake.submission.continuation,null);
  assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',o.user)).n,1);
  const context=await agent.siteContext(o.scope,o.user);assert.equal(context.submittedForms.length,1);context.submittedForms[0].answers='INTAKE_SUBMITTED_PURPOSE';
  const projected=agent.agentWorkspaceData(context);assert.doesNotMatch(projected,/INTAKE_PRIVATE_DRAFT|INTAKE_SUBMITTED_NAME|INTAKE_SUBMITTED_PURPOSE/);assert(projected.includes(intake.submission.id));assert(!JSON.parse(agent.agentWorkspaceData(context,'cms')).data.submittedForms);
 });
 await test('explicit submitted intake lookup shares only that snapshot in one bounded followup',async()=>{
  const o=intakeOwner,result=await chat(o,'Use the project brief I saved to help me plan the next step.',[body=>{assert.doesNotMatch(JSON.stringify(body),/INTAKE_SUBMITTED_NAME|INTAKE_SUBMITTED_PURPOSE|INTAKE_PRIVATE_DRAFT/);return submitted(intake);},body=>{const text=JSON.stringify(body);assert.match(text,/INTAKE_SUBMITTED_NAME/);assert.match(text,/INTAKE_SUBMITTED_PURPOSE/);assert.doesNotMatch(text,/INTAKE_PRIVATE_DRAFT/);return null;}]);
  assert.equal(result.calls,2);assert.equal(result.turn.status,'completed');const saved=await row('SELECT result_text FROM agent_inspections WHERE turn_id=?',result.input.id);assert.deepEqual(JSON.parse(saved.result_text).data.answers,{name:'INTAKE_SUBMITTED_NAME',purpose:'INTAKE_SUBMITTED_PURPOSE'});
  const before=mainCalls;await json(o,'/api/chat',result.input);assert.equal(mainCalls,before);assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',o.user)).n,1);
 });
 await test('failed or uncertain model followup preserves submitted answers and exact receipt without redispatch',async()=>{
  for(const expected of ['failed','uncertain']){
   const o=await owner(),created=await chat(o,'Help me plan another project.',[intakeRequest('requestProjectBrief')]);let f=await readForm(o,created.turn.interaction_id);
   const answers={name:'Retained garden',purpose:'Keep these details through an interrupted planning reply.'},input=mutate(f,'submit',answers),receipt=await json(o,'/api/chat/interactions/v1/mutate',input);f=await readForm(o,f.envelope.id);
   const result=await chat(o,'Use my saved project brief.',[submitted(f),body=>{
    assert.match(JSON.stringify(body),/Keep these details/);
    if(expected==='uncertain')throw Error('Synthetic response lost');
    return Response.json({error:{message:'Synthetic request rejected'}},{status:400});
   }]);
   assert.equal(result.calls,2);assert.equal(result.turn.status,expected);
   const before=mainCalls;assert.deepEqual((await readForm(o,f.envelope.id)).submission,f.submission);
   assert.deepEqual(await json(o,'/api/chat/interactions/v1/receipt',{version:1,requestId:input.requestId}),receipt);
   assert.deepEqual(await json(o,'/api/chat/interactions/v1/mutate',input),receipt);
   await json(o,'/api/chat',result.input);assert.equal(mainCalls,before);
   assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',o.user)).n,1);
   assert.equal(await row('SELECT id FROM chat_interaction_continuations WHERE id=?',input.requestId),null);
  }
 });
 await test('submitted lookup refuses mismatched identity, unowned forms, completed turns and forged action data',async()=>{
  const o=intakeOwner;
  for(const bad of [{...submitted(intake),taskId:id()},{...submitted(intake),submissionId:id()},{...submitted(intake),answers:{name:'forged'}},{...intakeRequest('requestProjectBrief'),questions:['Secret?']},{...intakeRequest('requestProjectSelection'),projectId:b.project}]){
   assert.equal((await forms.interactionAgentAction(o.scope,o.user,id(),bad)).inspection,undefined);
  }
  assert.equal((await forms.interactionAgentAction(b.scope,b.user,id(),submitted(intake))).inspection,undefined);
  assert.equal((await forms.interactionAgentAction(o.scope,o.user,intake.envelope.scope.originTurnId,submitted(intake))).inspection,undefined);
  const result=await chat(o,'Use my saved brief.',[{...submitted(intake),submissionId:id()},body=>{assert.doesNotMatch(JSON.stringify(body),/INTAKE_SUBMITTED_NAME|INTAKE_SUBMITTED_PURPOSE/);return null;}]);assert.equal(result.calls,2);
 });
 await test('project selection resolves current ownership and never retargets existing forms',async()=>{
  const o=await owner(),created=await chat(o,'Which of my projects should we work on?', [intakeRequest('requestProjectSelection')]);let f=await readForm(o,created.turn.interaction_id);
  assert.equal(f.envelope.definition.template,'project-select@1');assert.equal(f.draft,null);
  await json(o,'/api/chat/interactions/v1/mutate',mutate(f,'submit',{project:o.project}));f=await readForm(o,f.envelope.id);
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','read','private-test-acceptance','synthetic owned resource fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.user);
  const resources=await json(o,'/api/chat/interactions/v1/resources',{version:1,interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,fieldId:'project',limit:20,before:null});assert.deepEqual(resources.items,[{id:o.project,name:'Garden',photo:null}]);
  const result=await chat(o,'What project did I choose?', [submitted(f),body=>{const lookup=JSON.parse(JSON.parse(body.input.at(-1).content).result);assert.deepEqual(lookup.data.selectedProject,{id:o.project,name:'Garden'});assert.equal(lookup.data.answers,undefined);return null;}]);assert.equal(result.calls,2);
  await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Another project','Keep workspace admission','draft',datetime('now'),datetime('now'))",id(),o.user);
  await run('UPDATE projects SET owner_user_id=? WHERE id=?',b.user,o.project);
  const removed=await chat(o,'Use the project I selected.',[submitted(f),body=>{assert.doesNotMatch(JSON.stringify(body),/selectedProject/);return null;}]);assert.equal(removed.calls,2);
  assert.equal((await store.readInteraction(o.scope,o.user,f.envelope.id)).submission.answers.project,o.project);
 });
 const replaceIntake=f=>({kind:'interaction',operation:'replaceProjectIntake',previousInteractionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision});
 await test('writing style uses the existing bounded lookup, immutable corrections and zero automatic followup',async()=>{
  const o=await owner(),created=await chat(o,'Show me a few choices for how my website should sound.',[intakeRequest('requestWritingStyle')]);assert.equal(created.calls,1);
  let f=await readForm(o,created.turn.interaction_id);assert.equal(f.envelope.definition.template,'choice@1');assert.equal(f.envelope.definition.fields[0].default,undefined);
  await json(o,'/api/chat/interactions/v1/mutate',mutate(f,'save-draft',{tone:'friendly'}));f=await readForm(o,f.envelope.id);
  const draftMetadata=await forms.interactionAgentAction(o.scope,o.user,id(),read(f.envelope.id));assert.equal(JSON.parse(draftMetadata.inspection).data.template,'choice@1');assert.doesNotMatch(draftMetadata.inspection,/default|\"answers\"/);assert.deepEqual(JSON.parse(draftMetadata.inspection).data.fields[0].constraints.options.map(o=>o.id),['friendly','professional','straightforward']);
  assert.equal((await forms.interactionAgentAction(o.scope,o.user,id(),submitted({...f,submission:{id:id()}}))).inspection,undefined);
  const before=mainCalls;await json(o,'/api/chat/interactions/v1/mutate',mutate(f,'submit',{tone:'friendly'}));f=await readForm(o,f.envelope.id);assert.equal(mainCalls,before);assert.equal(f.submission.continuation,null);
  const references=JSON.parse(agent.agentWorkspaceData(await agent.siteContext(o.scope,o.user))).data.submittedForms;
  assert.deepEqual(references,[{interactionId:f.envelope.id,taskId:f.envelope.scope.taskId,projectId:f.envelope.scope.projectId,submissionId:f.submission.id,fields:f.envelope.definition.fields.map(x=>({id:x.id})),template:'choice@1'}]);
  const readback=await chat(o,'Use the style I saved.',[submitted(f),body=>{const data=JSON.parse(JSON.parse(body.input.at(-1).content).result).data;assert.deepEqual(data.answers,{tone:'friendly'});assert.equal(data.selectedProject,undefined);return null;}]);assert.equal(readback.calls,2);
  const corrected=await chat(o,'Let me choose another writing style.',[read(f.envelope.id),()=>replaceIntake(f)]);assert.equal(corrected.calls,2);
  const next=await readForm(o,corrected.turn.interaction_id);assert.equal(next.envelope.scope.taskId,f.envelope.scope.taskId);assert.deepEqual(next.envelope.definition.fields[0].default,{value:'friendly',provenance:'user'});
  assert.equal((await forms.interactionAgentAction(o.scope,o.user,id(),submitted(f))).inspection,undefined);
  await json(o,'/api/chat/interactions/v1/mutate',mutate(next,'submit',{tone:'straightforward'}));const saved=await readForm(o,next.envelope.id);
  const follow=await chat(o,'Use my corrected writing style.',[submitted(saved),body=>{assert.deepEqual(JSON.parse(JSON.parse(body.input.at(-1).content).result).data.answers,{tone:'straightforward'});return null;}]);assert.equal(follow.calls,2);
  assert.deepEqual((await readForm(o,f.envelope.id)).submission,f.submission);assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);
  const calls=mainCalls;await json(o,'/api/chat',created.input);await json(o,'/api/chat',follow.input);assert.equal(mainCalls,calls);
 });
 await test('writing-style actions cannot carry model-authored questions, defaults or targets',async()=>{
  const o=await owner();for(const extra of [{options:['secret']},{questions:['Recovery key?']},{answers:{tone:'friendly'}},{template:'custom@1'},{projectId:o.project}]){
   const result=await forms.interactionAgentAction(o.scope,o.user,id(),{...intakeRequest('requestWritingStyle'),...extra});assert.equal(result.statements.length,0);assert.equal(result.inspection,undefined);
  }
 });
 await test('natural correction reads metadata then reopens the same intake without exposing answer values',async()=>{
  const o=intakeOwner,before=intake,result=await chat(o,'Let me revise my saved project brief.',[read(before.envelope.id),body=>{assert.doesNotMatch(JSON.stringify(body),/INTAKE_SUBMITTED_NAME|INTAKE_SUBMITTED_PURPOSE|INTAKE_PRIVATE_DRAFT/);return replaceIntake(before);}]);assert.equal(result.calls,2);
  const next=await readForm(o,result.turn.interaction_id);assert.equal(next.previousInteractionId,before.envelope.id);assert.equal(next.envelope.scope.taskId,before.envelope.scope.taskId);assert.equal(next.envelope.scope.projectId,null);assert.deepEqual(next.envelope.definition.fields.map(f=>f.default),[{value:'INTAKE_SUBMITTED_NAME',provenance:'user'},{value:'INTAKE_SUBMITTED_PURPOSE',provenance:'user'}]);
  const context=await agent.siteContext(o.scope,o.user);assert(!context.submittedForms.some(i=>i.interactionId===before.envelope.id));assert(context.interactions.some(i=>i.interactionId===next.envelope.id));
  assert.equal((await forms.interactionAgentAction(o.scope,o.user,id(),submitted(before))).inspection,undefined);assert.deepEqual((await readForm(o,before.envelope.id)).submission,before.submission);
  await json(o,'/api/chat/interactions/v1/mutate',mutate(next,'submit',{name:'CORRECTED_INTAKE_NAME',purpose:'CORRECTED_INTAKE_PURPOSE'}));intake=await readForm(o,next.envelope.id);assert.equal(intake.submission.continuation,null);
  const follow=await chat(o,'Use my corrected project brief.',[submitted(intake),body=>{assert.match(JSON.stringify(body),/CORRECTED_INTAKE_PURPOSE/);assert.doesNotMatch(JSON.stringify(body),/INTAKE_SUBMITTED_PURPOSE/);return null;}]);assert.equal(follow.calls,2);assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',o.user)).n,1);
 });
 await test('agent correction rejects answer injection and wrong-template substitution',async()=>{
  const o=intakeOwner;
  for(const bad of [{...replaceIntake(intake),answers:{name:'forged'}},{...replaceIntake(intake),questions:['Secret?']},{...replaceIntake(intake),template:'project-select@1'},{...replaceIntake(intake),projectId:b.project}]){
   const result=await forms.interactionAgentAction(o.scope,o.user,id(),bad);assert.equal(result.statements.length,0);assert.equal(result.inspection,undefined);
  }
  assert.equal((await forms.interactionAgentAction(a.scope,a.user,id(),replaceIntake(form))).statements.length,0);
  assert.equal(inspection.inspectionRequest(JSON.stringify({reply:'Revise',action:replaceIntake(intake)})),false);
 });
 await test('lost Chat correction acknowledgment preserves one successor without redispatch',async()=>{
  const o=await owner(),created=await chat(o,'Help me plan another project.',[intakeRequest('requestProjectBrief')]),f=await readForm(o,created.turn.interaction_id);let lost=false;
  const lossy=interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost correction Chat result');}}),result=await chat(o,'Reopen that project brief.',[replaceIntake(f)],lossy);assert(lost);assert(result.turn.interaction_id);assert.equal(result.turn.status,'completed');
  const before=mainCalls;await json(o,'/api/chat',result.input);assert.equal(mainCalls,before);assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE previous_interaction_id=?',f.envelope.id)).n,1);
 });
 const proposal=(f,changes)=>({kind:'interaction',operation:'proposeAnswers',previousInteractionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision,changes});
 await test('prose corrections use one metadata lookup and create unapproved scoped suggestions',async()=>{
  const o=await owner(),created=await chat(o,'Help with the headline and service text.',[request(o)]);let f=await readForm(o,created.turn.interaction_id);
  await store.mutateInteraction(o.scope,o.user,mutate(f,'save-draft',{'field-1':'PRIVATE_ORIGINAL_HEADLINE','field-2':'PRIVATE_RETAINED_SERVICE'}));f=await readForm(o,f.envelope.id);
  const result=await chat(o,'Propose a shorter headline for that form.',[read(f.envelope.id),body=>{assert.doesNotMatch(JSON.stringify(body),/PRIVATE_ORIGINAL_HEADLINE|PRIVATE_RETAINED_SERVICE/);return proposal(f,{'field-1':'PROPOSED_HEADLINE_CANARY'});}]);
  assert.equal(result.calls,2);assert.doesNotMatch(result.turn.assistant_text,/UNTRUSTED_MODEL_PROSE/);assert.match(result.turn.assistant_text,/Review the suggestions/);
  let next=await readForm(o,result.turn.interaction_id);assert.equal(next.previousInteractionId,f.envelope.id);assert.equal(next.envelope.scope.taskId,f.envelope.scope.taskId);assert.equal(next.envelope.scope.projectId,o.project);assert.equal(next.submission,null);assert.equal(next.draft,null);
  assert.deepEqual(next.envelope.definition.fields.map(x=>x.default),[{value:'PROPOSED_HEADLINE_CANARY',provenance:'suggested'},{value:'PRIVATE_RETAINED_SERVICE',provenance:'user'}]);assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);
  const context=agent.agentWorkspaceData(await agent.siteContext(o.scope,o.user));assert.doesNotMatch(context,/PRIVATE_ORIGINAL_HEADLINE|PRIVATE_RETAINED_SERVICE|PROPOSED_HEADLINE_CANARY/);
  assert.doesNotMatch(await (await http(o,'/api/chat/history?before=10000')).text(),/PRIVATE_ORIGINAL_HEADLINE|PRIVATE_RETAINED_SERVICE|PROPOSED_HEADLINE_CANARY/);
  const chain=await chat(o,'Also suggest a shorter services description.',[read(next.envelope.id),body=>{assert.doesNotMatch(JSON.stringify(body),/PRIVATE_RETAINED_SERVICE|PROPOSED_HEADLINE_CANARY/);return proposal(next,{'field-2':'PROPOSED_SERVICES_CANARY'});}]);
  next=await readForm(o,chain.turn.interaction_id);assert(next.envelope.definition.fields.every(x=>x.default.provenance==='suggested'));
  const before=mainCalls;await json(o,'/api/chat',chain.input);assert.equal(mainCalls,before);assert.equal((await row('SELECT count(*) n FROM chat_interaction_submissions WHERE interaction_id=?',next.envelope.id)).n,0);
  const answers={'field-1':'PROPOSED_HEADLINE_CANARY','field-2':'PROPOSED_SERVICES_CANARY'},saved=mutate(next,'submit',answers);await json(o,'/api/chat/interactions/v1/mutate',saved);assert.equal(mainCalls,before);
  await json(o,'/api/chat/interactions/v1/continue',{version:1,submissionId:saved.requestId,expectedChatRevision:await revision(o)});assert.equal(mainCalls,before);assert.match(await(await site.specificationPreview(o.scope,o.user,saved.requestId)).text(),/PROPOSED_HEADLINE_CANARY/);assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);
 });
 await test('proposed intake answers stay distinct from immutable submitted information',async()=>{
  const o=await owner(),created=await chat(o,'Help plan another project.',[intakeRequest('requestProjectBrief')]);let f=await readForm(o,created.turn.interaction_id);
  await json(o,'/api/chat/interactions/v1/mutate',mutate(f,'submit',{name:'Original garden',purpose:'PRIVATE_PURPOSE_BEFORE_PROPOSAL'}));f=await readForm(o,f.envelope.id);
  const result=await chat(o,'Change the proposed name to Garden Studio.',[read(f.envelope.id),()=>proposal(f,{name:'Garden Studio'})]),next=await readForm(o,result.turn.interaction_id);
  assert.deepEqual(next.envelope.definition.fields.map(x=>x.default),[{value:'Garden Studio',provenance:'suggested'},{value:'PRIVATE_PURPOSE_BEFORE_PROPOSAL',provenance:'user'}]);assert.equal(next.submission,null);assert.equal(next.envelope.scope.projectId,null);
  assert.deepEqual((await readForm(o,f.envelope.id)).submission,f.submission);assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',o.user)).n,1);
  assert.equal((await forms.interactionAgentAction(o.scope,o.user,id(),submitted(f))).inspection,undefined);
  assert.equal((await forms.interactionAgentAction(o.scope,o.user,id(),submitted({...next,submission:{id:id()}}))).inspection,undefined);
 });
 await test('proposal action rejects injection, stale versions, invalid values and forged scope',async()=>{
  const o=await owner(),created=await chat(o,'Choose a writing style.',[intakeRequest('requestWritingStyle')]),f=await readForm(o,created.turn.interaction_id);
  for(const bad of [{...proposal(f,{tone:'friendly'}),projectId:b.project},{...proposal(f,{tone:'friendly'}),labels:['Recovery key?']},proposal(f,{}),proposal(f,{tone:'invented'}),proposal(f,{tone:['friendly']}),proposal(f,{password:'secret'}),proposal(f,{tone:null}),{...proposal(f,{tone:'friendly'}),expectedAnswerRevision:5},{...proposal(f,{tone:'friendly'}),definitionDigest:'0'.repeat(64)},proposal(form,{'field-1':'foreign'})]){
   const result=await forms.interactionAgentAction(o.scope,o.user,id(),bad);assert.equal(result.statements.length,0);assert.equal(result.inspection,undefined);
  }
  assert.equal(inspection.inspectionRequest(JSON.stringify({reply:'Propose',action:proposal(f,{tone:'professional'})})),false);
  const result=await chat(o,'Make it professional.',[read(f.envelope.id),()=>proposal(f,{tone:'professional'})]),next=await readForm(o,result.turn.interaction_id);assert.deepEqual(next.envelope.definition.fields[0].default,{value:'professional',provenance:'suggested'});
 });
 await test('lost proposal Chat acknowledgment recovers one successor without another inference',async()=>{
  const o=await owner(),created=await chat(o,'Help plan another project.',[intakeRequest('requestProjectBrief')]),f=await readForm(o,created.turn.interaction_id);let lost=false;
  const lossy=interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost proposal Chat result');}}),result=await chat(o,'Suggest Garden Studio as the name.',[proposal(f,{name:'Garden Studio'})],lossy);assert(lost);assert(result.turn.interaction_id);assert.equal(result.turn.status,'completed');
  const before=mainCalls;await json(o,'/api/chat',result.input);assert.equal(mainCalls,before);assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE previous_interaction_id=?',f.envelope.id)).n,1);
 });
 await test('custom planning selects questions and exposes only requested submitted fields to one followup',async()=>{
  const o=await owner(),fields=[{id:'area',questionId:'service-area',required:true},{id:'mobile',questionId:'visits-customers',required:true},{id:'radius',questionId:'travel-radius',required:true,when:{fieldId:'mobile',equals:true}}];
  const created=await chat(o,'Help me plan the service area and travel details for this website.',[{kind:'interaction',operation:'requestInformation',projectId:o.project,purpose:'site.services@1',fields}]);assert.equal(created.calls,1);
  let f=await readForm(o,created.turn.interaction_id);assert.equal(f.envelope.definition.template,'custom@1');assert.equal(f.envelope.definition.purpose,'site.services@1');assert.equal(f.envelope.scope.projectId,o.project);
  await json(o,'/api/chat/interactions/v1/mutate',mutate(f,'save-draft',{area:'CUSTOM_PRIVATE_DRAFT',mobile:true,radius:10}));f=await readForm(o,f.envelope.id);
  assert.doesNotMatch(agent.agentWorkspaceData(await agent.siteContext(o.scope,o.user)),/CUSTOM_PRIVATE_DRAFT/);
  const before=mainCalls;await json(o,'/api/chat/interactions/v1/mutate',mutate(f,'submit',{area:'CUSTOM_UNSELECTED_AREA',mobile:true,radius:35}));f=await readForm(o,f.envelope.id);assert.equal(mainCalls,before);
  const result=await chat(o,'What travel radius did I save?',[{...submitted(f),fieldIds:['radius']},body=>{const text=JSON.stringify(body),data=JSON.parse(JSON.parse(body.input.at(-1).content).result).data;assert.deepEqual(data.answers,{radius:35});assert.equal(data.projectId,o.project);assert.equal(data.taskId,f.envelope.scope.taskId);assert.doesNotMatch(text,/CUSTOM_PRIVATE_DRAFT|CUSTOM_UNSELECTED_AREA/);return null;}]);assert.equal(result.calls,2);
  const replacement=await chat(o,'Also ask me about add-on services.',[read(f.envelope.id),body=>{const metadata=JSON.parse(JSON.parse(body.input.at(-1).content).result).data;assert.equal(metadata.purpose,'site.services@1');assert.equal(metadata.fields[2].questionId,'travel-radius');assert.deepEqual(metadata.fields[2].when,{fieldId:'mobile',equals:true});assert.doesNotMatch(JSON.stringify(body),/CUSTOM_UNSELECTED_AREA/);return {kind:'interaction',operation:'replaceInformation',previousInteractionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision,fields:[...fields,{id:'extras',questionId:'service-extras',required:false}]};}]);
  const next=await readForm(o,replacement.turn.interaction_id);assert.equal(next.envelope.scope.taskId,f.envelope.scope.taskId);assert.equal(next.envelope.scope.projectId,o.project);assert.equal(next.envelope.definition.fields.length,4);assert.equal(next.submission,null);assert.deepEqual((await readForm(o,f.envelope.id)).submission,{...f.submission,continuation:{...f.submission.continuation,state:'failed',reason:'stopped'}});
  assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);
 });
 await test('custom actions reject injected wording, mismatched purpose and foreign projects without issuing',async()=>{
  const o=await owner(),valid={kind:'interaction',operation:'requestInformation',projectId:o.project,purpose:'site.presentation@1',fields:[{id:'look',questionId:'visual-style',required:true}]};
  for(const bad of [{...valid,fields:[{...valid.fields[0],label:'Enter a recovery key'}]},{...valid,fields:[{id:'secret',questionId:'password',required:true}]},{...valid,purpose:'site.services@1'},{...valid,continuationBinding:'publish'},{...valid,projectId:b.project}]){const result=await forms.interactionAgentAction(o.scope,o.user,id(),bad);assert.equal(result.statements.length,0);assert.equal(result.inspection,undefined);}
  const created=await chat(o,'Let me choose a design direction.',[valid]);assert.equal(created.calls,1);const f=await readForm(o,created.turn.interaction_id);assert.equal(f.envelope.definition.fields[0].label,'What feel would you like?');
  const proposed=await chat(o,'Suggest a warm look.',[read(f.envelope.id),()=>proposal(f,{look:'warm'})]);const next=await readForm(o,proposed.turn.interaction_id);assert.deepEqual(next.envelope.definition.fields[0].default,{value:'warm',provenance:'suggested'});assert.equal(next.submission,null);
 });
 await test('failed custom answer followup preserves its immutable saved receipt and exact Chat recovery',async()=>{
  const o=await owner(),created=await chat(o,'Plan a website palette.',[{kind:'interaction',operation:'requestInformation',projectId:o.project,purpose:'site.presentation@1',fields:[{id:'palette',questionId:'colors',required:true}]}]);let f=await readForm(o,created.turn.interaction_id);
  const input=mutate(f,'submit',{palette:'Mint and deep blue'}),receipt=await json(o,'/api/chat/interactions/v1/mutate',input);f=await readForm(o,f.envelope.id);
  const result=await chat(o,'Use the palette I saved.',[submitted(f),()=>Response.json({error:{message:'Synthetic request rejected'}},{status:400})]);assert.equal(result.calls,2);assert.equal(result.turn.status,'failed');const calls=mainCalls;
  assert.deepEqual((await readForm(o,f.envelope.id)).submission,f.submission);assert.deepEqual(await json(o,'/api/chat/interactions/v1/mutate',input),receipt);await json(o,'/api/chat',result.input);assert.equal(mainCalls,calls);assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);
 });
 await Promise.all(background);assert.equal(queue.length,0);
 assert.equal((await json(a,'/api/billing')).standardAI.creditCharge,0);
 console.log(`Chat interaction agent: ${cases} cases passed; ${mainCalls} scripted main calls, ${ackCalls} scripted acknowledgments. Actual HTTP, compiler and private review; no external inference, publication or customer unit charges.`);
}finally{await Promise.allSettled(background);globalThis.fetch=originalFetch;await fixture.close();}
