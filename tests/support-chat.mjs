import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {runUsageReview} from '../tools/usage-review-input.mjs';
Error.stackTraceLimit=0;
// WH-035 Chat help intake and response readback over the actual Worker, Chat orchestration, interaction
// storage and support store. Scripted synthetic inference only; no network, provider or real support message.
const modules=await currentFixtureModules(['src/index.ts','src/agent-inspection.ts','src/chat-interactions/store.ts','src/usage-review-requests.ts','src/chat-interactions/maintained.ts','src/support-shape.ts']);
const worker=(await modules.module('src/index.ts')).default,inspection=await modules.module('src/agent-inspection.ts'),store=await modules.module('src/chat-interactions/store.ts'),service=await modules.module('src/usage-review-requests.ts'),maintained=await modules.module('src/chat-interactions/maintained.ts'),shape=await modules.module('src/support-shape.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:'synthetic-only',protocol:'responses'};
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},AI_BASE_URL:config.baseURL,AI_MODEL:config.model,AI_PROTOCOL:config.protocol,AI_API_KEY:config.apiKey};
const blocked={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
let queue=[],mainCalls=0,cases=0;const requests=[],originalFetch=globalThis.fetch;
const response=action=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'UNTRUSTED_MODEL_PROSE: your request was sent',action})}]}],usage:{input_tokens:100,output_tokens:200}});
globalThis.fetch=async(url,init)=>{
 assert.equal(String(url),config.baseURL+'/responses','Unexpected external request');
 const request=JSON.parse(init.body);
 if(request.max_output_tokens===256)return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"intent":"editing"}'}]}],usage:{input_tokens:10,output_tokens:10}});
 mainCalls++;requests.push(request);assert(queue.length,'Unexpected extra inference');const step=queue.shift(),value=typeof step==='function'?await step(request):step;return value instanceof Response?value:response(value);
};
const http=(o,path,data,config=env)=>worker.fetch(new Request('https://whumpo.com'+path,{method:data?'POST':'GET',headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+o.authority.token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),config,{waitUntil(){}});
async function json(o,path,data,status=200,config=env){const r=await http(o,path,data,config);assert.equal(r.status,status,await r.clone().text());return r.json();}
async function test(name,fn){try{await fn();assert.equal(queue.length,0,'Every scripted step was used');cases++;}catch(e){console.error(name,String(e));throw e;}}
async function owner(){
 const authority=await workspaceFixture(db,modules.identity),user=authority.account;
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',datetime('now'),datetime('now'))",id(),user);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic support fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user);
 return {authority,user,scope:await authority.scope()};
}
const revision=async o=>(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user)).revision;
async function chat(o,content,steps){queue=steps;const input={id:id(),revision:await revision(o),content},before=mainCalls,data=await json(o,'/api/chat',input);return {input,data,calls:mainCalls-before,turn:data.turns.find(t=>t.id===input.id)};}
const client={versions:[1],fieldTypes:['text','long-text'],bindings:['answer.value@1','support.request@1','support.requests@1']};
const readForm=(o,interactionId,status=200,c=client)=>json(o,'/api/chat/interactions/v1/read',{version:1,interactionId,client:c},status);
const mutate=(f,operation,answers)=>({version:1,requestId:id(),interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision,operation,...(answers?{answers}:{})});
const card=(o,f,status=200)=>json(o,'/api/chat/interactions/v1/card',{version:1,interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,cardId:'support-requests'},status);
const supportRows=user=>db.prepare('SELECT id,kind,source,statement,state FROM usage_review_requests WHERE user_id=? ORDER BY created_at').bind(user).all().then(r=>r.results);
const prepared='My website publication has said uncertain for an hour. I did not retry it.';
try{
 const a=await owner(),b=await owner();let form,submitted;
 await test('the owner agent prepares a help form; preparing submits nothing',async()=>{
  const result=await chat(a,'Please ask the Whumpo team about my stuck publication.',[{kind:'interaction',operation:'requestSupport',statement:prepared}]);
  assert.equal(result.calls,1);assert(result.turn.interaction_id,'A form is issued with the reply');
  assert.doesNotMatch(result.turn.assistant_text,/UNTRUSTED_MODEL_PROSE|was sent/,'Server-authored reply; the model cannot claim sending');
  form=await readForm(a,result.turn.interaction_id);const d=form.envelope.definition;
  assert.equal(d.template,'support-request@1');assert.equal(d.submitBinding,'support.request@1');assert.equal(d.continuationBinding,null);assert.equal(form.envelope.scope.projectId,null);
  assert.deepEqual(d.fields.map(f=>[f.id,f.type,f.constraints.maxLength,f.default]),[['statement','long-text',950,{value:prepared,provenance:'suggested'}]]);
  assert.equal(form.state,'open');assert.equal(form.submission,null);assert.deepEqual(await supportRows(a.user),[],'Preparing a form creates no support request');
  // A current client that lacks the support binding is told to update, never given a degraded form.
  const old=await readForm(a,form.envelope.id,409,{...client,bindings:['answer.value@1','interaction.answers@1']});assert.equal(old.code,'client_update_required');
  const before=mainCalls;await readForm(a,form.envelope.id);assert.equal(mainCalls,before,'Reading the form calls no model');
 });
 await test('the model cannot submit, confirm or author the support request',async()=>{
  for(const action of [{kind:'interaction',operation:'requestSupport',statement:'x',submit:true},{kind:'interaction',operation:'submitSupport',statement:'x'},{kind:'interaction',operation:'requestSupport',statement:'x',answers:{statement:'x'}},{kind:'interaction',operation:'requestSupport',statement:'   '},{kind:'interaction',operation:'requestSupport',statement:'x'.repeat(951)},
   {kind:'interaction',operation:'proposeAnswers',previousInteractionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:form.answerRevision,changes:{statement:'MODEL-SENT'}}]){
   const result=await chat(a,'Send it for me.',[action]);assert(!result.turn.interaction_id,JSON.stringify(action));
  }
  assert.equal(inspection.inspectionRequest(JSON.stringify({reply:'r',action:{kind:'interaction',operation:'requestSupport',statement:'x'}})),false,'Preparation is not a lookup');
  assert.deepEqual(await supportRows(a.user),[],'No model action creates a support request');
  // The database refuses a Chat-form support row without the owner's exact submitted form.
  await assert.rejects(()=>run("INSERT INTO usage_review_requests(id,user_id,statement,kind,source) VALUES(?,?,?,'help','chat_form')",id(),a.user,prepared),/usage_review_initial/);
  await assert.rejects(()=>run("INSERT INTO usage_review_requests(id,user_id,statement,kind,source) VALUES(?,?,?,'help','chat_form')",form.envelope.id,a.user,prepared),/usage_review_initial/);
  assert.equal((await readForm(a,form.envelope.id)).state,'open');
 });
 await test('a draft save is not a request; only the owner submit saves it in the existing support store',async()=>{
  const draft=mutate(form,'save-draft',{statement:prepared+' DRAFT'});await json(a,'/api/chat/interactions/v1/mutate',draft);
  assert.deepEqual(await supportRows(a.user),[]);form=await readForm(a,form.envelope.id);
  for(const bad of [{statement:''},{statement:'x'.repeat(951)},{statement:'ok',extra:'no'}])await json(a,'/api/chat/interactions/v1/mutate',mutate(form,'submit',bad),bad.extra?400:422);
  assert.deepEqual(await supportRows(a.user),[]);
  const edited=prepared+' OWNER-EDITED-STATEMENT';submitted=mutate(form,'submit',{statement:edited});
  const receipt=await json(a,'/api/chat/interactions/v1/mutate',submitted);assert.equal(receipt.operation,'submit');
  const rows=await supportRows(a.user);assert.deepEqual(rows.map(r=>({...r})),[{id:submitted.requestId,kind:'help',source:'chat_form',statement:edited,state:'open'}]);
  const page=await json(a,'/api/support/v1');assert.deepEqual(page.requests.map(r=>[r.id,r.kind,r.statement,r.state]),[[submitted.requestId,'help',edited,'open']],'The Support page shows the Chat request');
  form=await readForm(a,form.envelope.id);assert.equal(form.state,'submitted');assert.equal(form.submission.answers.statement,edited);assert.equal(form.submission.continuation,null);
 });
 await test('exact replay recovers the receipt; changed replay conflicts; no duplicate request',async()=>{
  const replay=await json(a,'/api/chat/interactions/v1/mutate',submitted);assert.equal(replay.requestId,submitted.requestId);
  await json(a,'/api/chat/interactions/v1/mutate',{...submitted,answers:{statement:'changed'}},409);
  assert.equal((await supportRows(a.user)).length,1);
 });
 await test('one open help request: a second form cannot be prepared or submitted',async()=>{
  const refused=await chat(a,'Ask support again.',[{kind:'interaction',operation:'requestSupport',statement:'Another question.'}]);
  assert(!refused.turn.interaction_id);assert.match(refused.turn.assistant_text,/already have an open help request/);
  // A form issued before the first submission still cannot open a second request.
  const plan=await store.prepareSupportRequest(a.scope,a.user,{originTurnId:refused.input.id,statement:'x'}).catch(e=>e);assert.equal(plan.code,'support_open');
  const c=await owner(),first=await chat(c,'Help.',[{kind:'interaction',operation:'requestSupport',statement:'First.'}]),second=await chat(c,'More help.',[{kind:'interaction',operation:'requestSupport',statement:'Second.'}]);
  const one=await readForm(c,first.turn.interaction_id),two=await readForm(c,second.turn.interaction_id);
  await json(c,'/api/chat/interactions/v1/mutate',mutate(one,'submit',{statement:'First.'}));
  const conflict=await json(c,'/api/chat/interactions/v1/mutate',mutate(two,'submit',{statement:'Second.'}),409);assert.equal(conflict.code,'support_open');
  assert.equal((await readForm(c,two.envelope.id)).state,'open','The refused form keeps its answers editable');assert.equal((await supportRows(c.user)).length,1);
 });
 await test('another owner cannot read, submit, view or answer through this form',async()=>{
  await readForm(b,form.envelope.id,404);
  await json(b,'/api/chat/interactions/v1/mutate',mutate(form,'submit',{statement:'FOREIGN'}),404);
  await json(b,'/api/support/v1/requests/'+submitted.requestId,undefined,404);
  const result=await chat(b,'Show support request.',[{kind:'interaction',operation:'readSupport',requestId:submitted.requestId},body=>{const text=JSON.stringify(body);assert.doesNotMatch(text,/OWNER-EDITED-STATEMENT|support_requests/,'A foreign lookup exposes nothing to the model');assert.match(text,/Support request not found/);return null;}]);
  assert(!result.turn.interaction_id);
  assert.deepEqual(await supportRows(b.user),[]);
 });
 await test('operator response is read back in Chat: agent lookup, exact view, and a separate customer read',async()=>{
  await runUsageReview(service,db,{action:'answer',account:a.user,id:submitted.requestId,response:'OPERATOR-VISIBLE-RESPONSE: the publication finished; no action needed.',operator:'PRIVATE-OPERATOR-LABEL'},(await runUsageReview(service,db,{action:'answer',account:a.user,id:submitted.requestId,response:'OPERATOR-VISIBLE-RESPONSE: the publication finished; no action needed.',operator:'PRIVATE-OPERATOR-LABEL'})).applyDigest);
  // A support-page usage review keeps its text out of model context.
  await json(a,'/api/support/v1/requests',{version:1,id:id(),kind:'usage_review',statement:'PRIVATE-USAGE-REVIEW-TEXT'});
  let view;
  const result=await chat(a,'Did support answer me?',[
   body=>{const text=JSON.stringify(body);assert.match(text,/\\"unreadResponses\\":1/,'Context carries counts');assert.doesNotMatch(text,/OPERATOR-VISIBLE-RESPONSE|OWNER-EDITED-STATEMENT/,'Context carries no support text');return {kind:'interaction',operation:'readSupport',requestId:null};},
   body=>{const text=JSON.stringify(body);assert.match(text,/support_requests/);assert.match(text,/OWNER-EDITED/);assert.doesNotMatch(text,/PRIVATE-USAGE-REVIEW-TEXT|PRIVATE-OPERATOR-LABEL|answered_by|user_id/);return {kind:'interaction',operation:'showSupport'};}]);
  assert.equal(result.calls,2);assert(result.turn.interaction_id);
  const detail=await chat(a,'What did they say exactly?',[{kind:'interaction',operation:'readSupport',requestId:submitted.requestId},body=>{const text=JSON.stringify(body);assert.match(text,/OPERATOR-VISIBLE-RESPONSE/);assert.match(text,/OWNER-EDITED-STATEMENT/);assert.doesNotMatch(text,/PRIVATE-OPERATOR-LABEL|PRIVATE-USAGE-REVIEW-TEXT/);return null;}]);
  assert.equal(detail.calls,2);
  assert.equal((await json(a,'/api/support/v1/requests/'+submitted.requestId)).request.read.state,'unread','A model lookup is not the owner reading the response');
  view=await readForm(a,result.turn.interaction_id);assert.equal(view.envelope.definition.kind,'view');assert.ok(maintained.isSupportStatusDefinition(view.envelope.definition));
  const before=mainCalls,first=await card(a,view);assert.equal(mainCalls,before,'The view reads no model');
  const shown=first.data.requests.find(r=>r.id===submitted.requestId);assert.equal(shown.publicResponse.startsWith('OPERATOR-VISIBLE-RESPONSE'),true);assert.equal(shown.response.saved,true);assert.equal(shown.delivery.state,'none');assert.equal(shown.read.state,'unread','Reading the card is not a read receipt');
  assert.ok(!JSON.stringify(first).includes('PRIVATE-OPERATOR-LABEL'));
  // The shared client/server card reader refuses unknown or inconsistent shapes instead of rendering them.
  assert.ok(shape.readSupportRequestsCard(first));
  for(const patch of [c=>{c.extra=1;},c=>{c.binding='project.status@1';},c=>{c.data.requests[0].answeredBy='x';},c=>{c.data.requests[0].read={state:'read',at:null};},c=>{c.data.requests[0].delivery={state:'sent'};},c=>{c.data.requests.push(c.data.requests[0]);}]){const copy=structuredClone(first);patch(copy);assert.equal(shape.readSupportRequestsCard(copy),null);}
  await card(b,view,404);
  await json(a,'/api/support/v1/requests/'+submitted.requestId+'/read',{version:1});
  const after=(await card(a,view)).data.requests.find(r=>r.id===submitted.requestId);assert.equal(after.read.state,'read');assert.equal(after.delivery.state,'none','Read is not delivery');
  assert.deepEqual((await json(a,'/api/support/v1/requests/'+submitted.requestId)).request.read.state,'read','Chat and the Support page share one read state');
  // Dismissal is the view's only mutation.
  await json(a,'/api/chat/interactions/v1/mutate',mutate(view,'submit',{}),400);
  const dismiss={...mutate(view,'cancel')};await json(a,'/api/chat/interactions/v1/mutate',dismiss);await card(a,view,410);
 });
 await test('when Chat is unavailable the Support page remains the full fallback',async()=>{
  const c=await owner(),issued=await chat(c,'Help.',[{kind:'interaction',operation:'requestSupport',statement:'CHAT-UNAVAILABLE-CASE'}]),f=await readForm(c,issued.turn.interaction_id);
  const sent=mutate(f,'submit',{statement:'CHAT-UNAVAILABLE-CASE'});await json(c,'/api/chat/interactions/v1/mutate',sent);
  await service.answerUsageReview(db,c.user,sent.requestId,'Reply while Chat is down.','fixture-operator');
  const down=await http(c,'/api/chat',{id:id(),revision:await revision(c),content:'Did support answer?'},blocked);assert.equal(down.status,503);assert.match((await down.json()).support,/status%3Achat_unavailable/);
  const page=await json(c,'/api/support/v1',undefined,200,blocked);assert.equal(page.requests[0].publicResponse,'Reply while Chat is down.');
  assert.equal((await json(c,'/api/support/v1/requests/'+sent.requestId+'/read',{version:1},200,blocked)).request.read.state,'read');
  // Without a finished welcome, Chat forms are closed but the Support page still saves and reads requests.
  const d=await owner();await run('DELETE FROM projects WHERE owner_user_id=?',d.user);
  assert.equal((await json(d,'/api/chat/interactions/v1/read',{version:1,interactionId:id(),client},409)).code,'onboarding_required');
  assert.equal((await json(d,'/api/support/v1/requests',{version:1,id:id(),kind:'help',statement:'Fallback works.'})).request.kind,'help');
 });
 console.log('Support Chat passed ('+cases+' cases): agent-prepared help form, model cannot submit, owner-only submit into the existing support store, exact replay, one-open bound, foreign-owner isolation, agent readback of the owner\'s own help text, exact Chat support view with a separate read receipt, usage-review text excluded from model context, and Support-page fallback when Chat is unavailable or closed.');
}finally{globalThis.fetch=originalFetch;await fixture.close();}
