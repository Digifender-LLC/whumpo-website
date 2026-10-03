import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/index.ts','src/site-agent.ts','src/ai-chat.ts','src/agent-inspection.ts','src/chat-interactions/store.ts','src/chat-interactions/agent.ts','src/chat-interactions/protocol.ts','src/project-specification/store.ts','src/chat-interactions/task-context.ts','src/chat-interactions/model-continuation.ts']);
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
async function saved(o){
 const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Plan my landscaping service area','Tell me where you work.',datetime('now'),'ai','completed' FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
 const form=await store.issueInformation(o.scope,o.user,{originTurnId:turn,projectId:o.project,purpose:'site.services@1',fields});
 const mutation={version:1,requestId:id(),interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{area:'SUBMITTED_PUBLIC_SERVICE_AREA'}};
 const receipt=await json(o,'/api/chat/interactions/v1/mutate',mutation);
 return {form:await store.readInteraction(o.scope,o.user,form.envelope.id),mutation,receipt};
}
async function follow(o,f,steps=[],database){queue=steps;const input={version:1,submissionId:f.submission.id,expectedChatRevision:await revision(o)},before=mainCalls,data=await json(o,'/api/chat/interactions/v1/continue',input,database);return {data,input,calls:mainCalls-before};}
const read=o=>({kind:'specification',operation:'read',projectId:o.project});
const change=o=>({kind:'specification',operation:'change',projectId:o.project,expectedRevision:1,operations:[{type:'content.replace',contentId:'section-1-text',text:'SUBMITTED_PUBLIC_SERVICE_AREA'}]});
const state=async f=>(await row('SELECT * FROM chat_interaction_continuations WHERE id=?',f.submission.id));
async function noEffect(o,f){assert.equal((await row('SELECT count(*) n FROM project_spec_proposals WHERE id=?',f.submission.id)).n,0);assert.equal((await site.readSpecification(o.scope,o.user,o.project)).revision,1);}
try{
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
  const prepared=await taskContext.prepareInformationTask(o.scope,o.user,request.requestId);assert.equal(prepared.data.taskId,form.envelope.scope.taskId);assert.equal(prepared.data.pendingReviews.length,1);assert.equal(prepared.data.pendingReviews[0].reviewId,form.submission.id);assert.deepEqual(prepared.data.skippedFieldIds,['mobile']);assert.deepEqual(prepared.data.openQuestions,[]);assert.equal(prepared.data.submittedAnswers.length,1);assert.equal(prepared.data.submittedAnswers[0].answer,'Corrected public area');
 });
 console.log(`Chat model continuation: ${cases} actual-handler scenarios passed; ${mainCalls} scripted main calls, ${ackCalls} ack calls. No external model, publication or payment.`);
}finally{globalThis.fetch=originalFetch;await Promise.allSettled(background);await fixture.close();}
