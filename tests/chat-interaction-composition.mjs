import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/chat-interactions/store.ts','src/chat-interactions/composition.ts','src/chat-interactions/submitted-context.ts','src/chat-interactions/agent-request.ts','src/index.ts']);
const store=await modules.module('src/chat-interactions/store.ts'),composition=await modules.module('src/chat-interactions/composition.ts'),context=await modules.module('src/chat-interactions/submitted-context.ts'),actions=await modules.module('src/chat-interactions/agent-request.ts'),worker=(await modules.module('src/index.ts')).default;
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();let cases=0,network=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Unexpected provider/inference request');};
const run=(sql,...v)=>db.prepare(sql).bind(...v).run(),row=(sql,...v)=>db.prepare(sql).bind(...v).first();
const fields=[{id:'area',questionId:'service-area',required:true},{id:'mobile',questionId:'visits-customers',required:true},{id:'radius',questionId:'travel-radius',required:true,when:{fieldId:'mobile',equals:true}},{id:'sizes',questionId:'vehicle-sizes',required:false}];
const client={versions:[1],fieldTypes:['text','long-text','boolean','number','multi-choice','choice','date'],bindings:['answer.value@1','interaction.answers@1','agent.task-continue@1']};
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){}};
async function owner(){const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),project=id(),grant=id();await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Detailing','Public detailing services','draft',datetime('now'),datetime('now'))",project,user);await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic composition',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",grant,user,project);return {authority,user,scope,project,grant};}
async function origin(o,pending=false){const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Plan the public service page','Review details',datetime('now'),'ai',? FROM workspace_state WHERE user_id=?",turn,pending?'pending':'completed',o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);return turn;}
async function issue(o,overrides={},database=o.scope){const input={originTurnId:await origin(o),projectId:o.project,purpose:'site.services@1',fields:structuredClone(fields),...overrides};return {input,form:await store.issueInformation(database,o.user,input)};}
const mutation=(f,operation,answers)=>({version:1,requestId:id(),interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision,operation,...(operation==='cancel'?{}:{answers})});
const replacement=async(o,f)=>({originTurnId:await origin(o),previousInteractionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision,fields:composition.informationQuestions(f.envelope.definition)});
const selected=(f,fieldIds)=>({interactionId:f.envelope.id,taskId:f.envelope.scope.taskId,projectId:f.envelope.scope.projectId,submissionId:f.submission.id,fieldIds});
async function json(o,path,data,status=200){const r=await worker.fetch(new Request('https://whumpo.com/api/chat/'+path,{method:data?'POST':'GET',headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+o.authority.token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env,ctx),body=await r.json();assert.equal(r.status,status,JSON.stringify(body));return body;}
async function test(name,fn){try{await fn();cases++;}catch(e){console.error(name,e);throw e;}}
try{
 await test('the agent composes independent service and presentation question sets with declared meaning',async()=>{
  const service=composition.informationDefinition('site.services@1',fields),design=composition.informationDefinition('site.presentation@1',[{id:'look',questionId:'visual-style',required:true},{id:'launch',questionId:'target-date',required:false}]);
  assert(composition.isInformationDefinition(service));assert(composition.isInformationDefinition(design));assert.equal(service.fields[2].type,'number');assert.equal(design.fields.length,2);assert(!service.fields.some(f=>f.default||f.source));
  for(const bad of [{...service,title:'Your password'},{...service,continuationBinding:'site.content-prepare@1'},{...service,purpose:'site.presentation@1'},{...service,fields:service.fields.map((f,i)=>i?f:{...f,label:'Enter your recovery key'})},{...service,fields:service.fields.map((f,i)=>i===2?{...f,constraints:{min:0,max:10000,step:1}}:f)}])assert.equal(composition.isInformationDefinition(bad),false);
 });
 await test('untrusted descriptors cannot supply questions, options, authority or cross-purpose meanings',async()=>{
  const good={kind:'interaction',operation:'requestInformation',projectId:id(),purpose:'site.services@1',fields};assert(actions.interactionActionRequest(good));
  for(const bad of [{...good,purpose:'credentials@1'},{...good,questions:['Password?']},{...good,fields:[{id:'key',questionId:'recovery-key',required:true}]},{...good,fields:[{...fields[0],label:'Password?'}]},{...good,fields:[{...fields[0],default:{value:'PRIVATE_DEFAULT',provenance:'user'}}]},{...good,fields:[{id:'look',questionId:'visual-style',required:true}]},{...good,fields:[fields[2]]},{...good,fields:[fields[0],{...fields[0],id:'different'}]},{...good,fields:[{...fields[0],binding:'https://example.invalid'}]},{...good,fields:[]}])assert.equal(actions.interactionActionRequest(bad),false);
  assert.equal(actions.interactionActionRequest({kind:'interaction',operation:'readSubmittedIntake',interactionId:id(),taskId:id(),submissionId:id()}),false);
 });
 await test('current HTTP renders an issued project form and recovers exact issue/submit receipts',async()=>{
  const o=await owner(),other=await owner(),{form,input}=await issue(o);
  assert.equal((await store.issueInformation(o.scope,o.user,input)).envelope.id,form.envelope.id);
  await assert.rejects(()=>store.issueInformation(o.scope,o.user,{...input,fields:fields.slice(0,2)}),e=>e.code==='request_conflict');
  const read=await json(o,'interactions/v1/read',{version:1,interactionId:form.envelope.id,client});assert.equal(read.projectName,'Detailing');assert(composition.isInformationDefinition(read.envelope.definition));
  await json(other,'interactions/v1/read',{version:1,interactionId:form.envelope.id,client},404);
  await json(o,'interactions/v1/read',{version:1,interactionId:form.envelope.id,client:{...client,fieldTypes:['text']}},409);
  await json(o,'interactions/v1/mutate',mutation(form,'submit',{area:'Boise',mobile:false,radius:10}),422);
  await json(o,'interactions/v1/mutate',mutation(form,'submit',{area:'Boise',mobile:true}),422);
  const request=mutation(form,'submit',{area:'Boise',mobile:false,sizes:[]}),receipt=await json(o,'interactions/v1/mutate',request);assert.deepEqual(await json(o,'interactions/v1/mutate',request),receipt);
  await json(o,'interactions/v1/mutate',{...request,answers:{area:'Changed',mobile:false}},409);
  const current=await store.readInteraction(o.scope,o.user,form.envelope.id);assert.deepEqual(current.submission.answers,request.answers);assert.equal(current.submission.continuation.state,'not-started');assert.equal((await row('SELECT count(*) n FROM chat_interaction_continuations WHERE id=?',request.requestId)).n,1);
  assert.equal((await json(o,'history?before=10000')).turns.find(t=>t.id===input.originTurnId).interaction.submission.answers.area,'Boise');
 });
 await test('private drafts stay out of locators; selected submitted answers are minimized and pinned',async()=>{
  const o=await owner(),{form}=await issue(o);
  await store.mutateInteraction(o.scope,o.user,mutation(form,'save-draft',{area:'DRAFT_ONLY',mobile:true,radius:10}));assert.deepEqual(await context.submittedReferences(o.scope,o.user),[]);
  let current=await store.readInteraction(o.scope,o.user,form.envelope.id);await store.mutateInteraction(o.scope,o.user,mutation(current,'submit',{area:'PUBLIC_AREA',mobile:true,radius:25,sizes:['car']}));current=await store.readInteraction(o.scope,o.user,form.envelope.id);
  const refs=await context.submittedReferences(o.scope,o.user);assert.equal(refs[0].purpose,'site.services@1');assert.equal(refs[0].projectId,o.project);assert.doesNotMatch(JSON.stringify(refs),/PUBLIC_AREA|DRAFT_ONLY/);
  const turn=await origin(o,true),request=selected(current,['area']),data=await context.readSubmittedAnswers(o.scope,o.user,turn,request);assert.deepEqual(data.answers,{area:'PUBLIC_AREA'});assert.equal(data.projectId,o.project);
  for(const bad of [{...request,projectId:null},{...request,taskId:id()},{...request,submissionId:id()},{...request,fieldIds:['unknown']},{...request,fieldIds:[]},{...request,fieldIds:['area','area']},{...request,answers:{area:'forged'}}])await assert.rejects(()=>context.readSubmittedAnswers(o.scope,o.user,turn,bad));
  await assert.rejects(()=>context.readSubmittedAnswers(o.scope,o.user,id(),request));
 });
 await test('corrections preserve task/project and immutable submissions without rebinding field meanings',async()=>{
  const o=await owner(),{form}=await issue(o);await store.mutateInteraction(o.scope,o.user,mutation(form,'submit',{area:'Public area',mobile:true,radius:20}));const current=await store.readInteraction(o.scope,o.user,form.envelope.id),input=await replacement(o,current);
  for(const fields of [[{id:'area',questionId:'services',required:true}],[{id:'new-area',questionId:'service-area',required:true}]])await assert.rejects(()=>store.replaceInformation(o.scope,o.user,{...input,fields}),e=>e.code==='QUESTION_CHANGED');
  await assert.rejects(()=>store.replaceInformation(o.scope,o.user,{...input,projectId:id()}),e=>e.code==='SHAPE');
  const next=await store.replaceInformation(o.scope,o.user,{...input,fields:[...input.fields,{id:'extras',questionId:'service-extras',required:false}]});assert.equal(next.envelope.scope.taskId,current.envelope.scope.taskId);assert.equal(next.envelope.scope.projectId,o.project);assert.deepEqual(next.envelope.definition.fields[0].default,{value:'Public area',provenance:'user'});assert.equal(next.envelope.definition.fields.at(-1).default,undefined);assert.deepEqual((await store.readInteraction(o.scope,o.user,form.envelope.id)).submission,{...current.submission,continuation:{...current.submission.continuation,state:'failed',reason:'stopped'}});
  await assert.rejects(()=>context.readSubmittedAnswers(o.scope,o.user,id(),selected(current,['area'])));assert.deepEqual(await context.submittedReferences(o.scope,o.user),[]);
 });
 await test('prose proposals use inherited controllers, preserve hidden local defaults and never submit',async()=>{
  const o=await owner(),{form}=await issue(o);await store.mutateInteraction(o.scope,o.user,mutation(form,'save-draft',{area:'Boise',mobile:true,radius:20}));let f=await store.readInteraction(o.scope,o.user,form.envelope.id);
  async function propose(changes){const {fields,...identity}=await replacement(o,f);return store.proposeAnswers(o.scope,o.user,{...identity,changes});}
  f=await propose({radius:35});assert.deepEqual(f.envelope.definition.fields.find(x=>x.id==='radius').default,{value:35,provenance:'suggested'});assert.equal(f.submission,null);
  f=await propose({mobile:false});assert.equal(f.envelope.definition.fields.find(x=>x.id==='radius').default.value,35);
  await assert.rejects(()=>propose({radius:50}),e=>e.code==='HIDDEN_VALUE');
  await store.mutateInteraction(o.scope,o.user,mutation(f,'submit',{area:'Boise',mobile:false}));const current=await store.readInteraction(o.scope,o.user,f.envelope.id);assert(!Object.hasOwn(current.submission.answers,'radius'));
  await assert.rejects(()=>context.readSubmittedAnswers(o.scope,o.user,id(),selected(current,['radius'])),e=>e.code==='FIELD_UNAVAILABLE');
 });
 await test('late feature, owner and session changes refuse committed custom work',async()=>{
  for(const mode of ['feature','owner','session']){
   const o=await owner(),other=await owner(),input={originTurnId:await origin(o),projectId:o.project,purpose:'site.services@1',fields};let changed=false;
   const racing=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{changed=true;if(mode==='feature')await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.grant);else if(mode==='owner')await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);else await o.authority.revoke();}));
   await assert.rejects(()=>store.issueInformation(racing,o.user,input));assert(changed);assert.equal(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',input.originTurnId),null);
  }
 });
 await test('late edits and cancellation prevent replacement; current receipts still recover',async()=>{
  const o=await owner(),{form}=await issue(o),input=await replacement(o,form);let changed=false;
  const racing=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{changed=true;await store.mutateInteraction(o.scope,o.user,mutation(form,'save-draft',{area:'Late edit',mobile:false}));}));
  await assert.rejects(()=>store.replaceInformation(racing,o.user,input));assert(changed);const f=await store.readInteraction(o.scope,o.user,form.envelope.id);assert.equal(f.draft.area,'Late edit');assert.equal(f.replacementInteractionId,null);
  const cancel=mutation(f,'cancel'),receipt=await store.mutateInteraction(o.scope,o.user,cancel);assert.deepEqual(await store.mutateInteraction(o.scope,o.user,cancel),receipt);await assert.rejects(()=>store.replaceInformation(o.scope,o.user,{...input,originTurnId:id(),expectedAnswerRevision:f.answerRevision}),e=>e.status===410);
 });
 await test('lost creation acknowledgment reuses the exact existing form',async()=>{
  const o=await owner();let lost=false;
  const lossy=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost response');}}));
  const {form,input}=await issue(o,{},lossy);assert(lost);assert.equal((await store.issueInformation(o.scope,o.user,input)).envelope.id,form.envelope.id);assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE origin_turn_id=?',input.originTurnId)).n,1);
 });
 await test('submitted answers refuse late replacement before projection',async()=>{
  const o=await owner(),{form}=await issue(o);await store.mutateInteraction(o.scope,o.user,mutation(form,'submit',{area:'CANARY',mobile:false}));const f=await store.readInteraction(o.scope,o.user,form.envelope.id),turn=await origin(o,true),replace=await replacement(o,f);let changed=false;
  const racing=await o.authority.scope(interceptDatabase(db,/^SELECT s.id,s.answers_json/,async()=>{},async()=>{if(!changed){changed=true;await store.replaceInformation(o.scope,o.user,replace);}}));
  await assert.rejects(()=>context.readSubmittedAnswers(racing,o.user,turn,selected(f,['area'])));assert(changed);
 });
 assert.equal(network,0);console.log(`Custom Chat composition: ${cases} cases passed (${process.argv.includes('--d1')?'local D1':'SQLite'}); actual scoped HTTP/storage, typed questions, corrections, selected-answer reads and commit races. No provider, inference, publication or payment.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
