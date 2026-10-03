import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
const modules=await currentFixtureModules(['src/index.ts','src/chat-interactions/store.ts','src/chat-interactions/view-cards.ts','src/chat-interactions/view-definition.ts','src/chat-interactions/protocol.ts','src/chat-interactions/agent.ts','src/chat-interactions/agent-request.ts','src/chat-interactions/history.ts','src/workspace-layout.ts','src/workspace-view-bindings.ts']);
const [worker,store,cards,definitions,protocol,agent,requests,history,layout,bindings]=await Promise.all(['src/index.ts','src/chat-interactions/store.ts','src/chat-interactions/view-cards.ts','src/chat-interactions/view-definition.ts','src/chat-interactions/protocol.ts','src/chat-interactions/agent.ts','src/chat-interactions/agent-request.ts','src/chat-interactions/history.ts','src/workspace-layout.ts','src/workspace-view-bindings.ts'].map(f=>modules.module(f)));
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();let cases=0,network=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Unexpected inference or provider call');};
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const test=async(name,fn)=>{try{await fn();cases++;}catch(error){console.error(name);throw error;}};
async function owner(){
 const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),project=id(),grants=[];
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','PRIVATE_PURPOSE_CANARY','draft',datetime('now'),datetime('now'))",project,user);
 for(const projectId of [null,project])for(const [feature,operation] of [['core.editing','read'],['core.editing','prepare'],['core.insights','read']]){const grant=id();grants.push({id:grant,projectId,feature,operation});await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic temporary view',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",grant,user,projectId,feature,operation);}
 return {authority,user,scope,project,grants};
}
async function origin(o){const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Show my project overview here','Pending',datetime('now'),'ai','pending' FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);return turn;}
const view=(projectId,widgets=['projects','activity','storage','traffic','usage','performance'])=>({version:1,projectId,widgets,shortcuts:[]});
async function issue(o,v=view(o.project)){
 const turn=await origin(o),plan=await store.prepareWorkspaceView(o.scope,o.user,{originTurnId:turn,view:v});
 await o.scope.batch([...plan.statements,o.scope.prepare("UPDATE chat_turns SET status='completed',assistant_text='Here is your overview.' WHERE id=?").bind(turn)]);
 return store.readInteraction(o.scope,o.user,plan.interactionId);
}
const input=(f,kind='projects')=>({version:1,interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,kind});
const cancel=f=>({version:1,requestId:id(),interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision,operation:'cancel'});
const client={versions:[1],fieldTypes:[],bindings:Object.keys(protocol.bindings)};
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
async function http(o,path,data,status=200,originValue='https://whumpo.com'){
 const r=await worker.default.fetch(new Request('https://whumpo.com/api/chat/interactions/v1/'+path,{method:'POST',headers:{origin:originValue,'content-type':'application/json',...(o?{cookie:'__Host-whumpo_session='+o.authority.token}:{})},body:JSON.stringify(data)}),env,{waitUntil(){throw Error('Unexpected background work');}}),body=await r.json();assert.equal(r.status,status,JSON.stringify(body));assert.match(r.headers.get('cache-control'),/no-store/);return body;
}
try{
 await test('agent issuance prepares no writes; immutable view and final reply commit together',async()=>{
  const o=await owner(),turn=await origin(o),v=view(o.project),action={kind:'interaction',operation:'showView',view:v};assert(requests.interactionActionRequest(action));
  const planned=await agent.interactionAgentAction(o.scope,o.user,turn,action);assert(planned.statements.length);assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE user_id=?',o.user)).n,0);
  await assert.rejects(()=>o.scope.batch([...planned.statements,o.scope.prepare('INSERT INTO chat_interaction_checks(denied) VALUES(1)')]));assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE user_id=?',o.user)).n,0);
  await o.scope.batch([...planned.statements,o.scope.prepare("UPDATE chat_turns SET status='completed',assistant_text=? WHERE id=?").bind(planned.reply,turn)]);
  const saved=await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',turn),f=await store.readInteraction(o.scope,o.user,saved.id);assert.deepEqual(f.envelope.definition.workspaceView,v);assert.equal(f.envelope.definition.kind,'view');assert.equal(f.submission,null);
  assert.equal((await store.prepareWorkspaceView(o.scope,o.user,{originTurnId:turn,view:v})).statements.length,0);
  await assert.rejects(()=>store.prepareWorkspaceView(o.scope,o.user,{originTurnId:turn,view:view(o.project,['usage'])}),e=>e.code==='request_conflict');
 });
 await test('requested correction stays in the same task and scope and rejects stale replacements',async()=>{
  const o=await owner(),f=await issue(o),v=view(o.project,['projects','traffic']),turn=await origin(o),request={originTurnId:turn,previousInteractionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:0,view:v};
  assert(requests.interactionActionRequest({kind:'interaction',operation:'replaceView',...Object.fromEntries(Object.entries(request).filter(([k])=>k!=='originTurnId'))}));
  const planned=await store.prepareReplacementWorkspaceView(o.scope,o.user,request);assert.equal((await store.readInteraction(o.scope,o.user,f.envelope.id)).state,'open');await o.scope.batch(planned.statements);
  const updated=await store.readInteraction(o.scope,o.user,planned.interactionId),old=await store.readInteraction(o.scope,o.user,f.envelope.id);assert.equal(updated.envelope.scope.taskId,f.envelope.scope.taskId);assert.equal(updated.previousInteractionId,f.envelope.id);assert.deepEqual(updated.envelope.definition.workspaceView,v);assert.equal(old.state,'superseded');assert.equal(old.replacementInteractionId,updated.envelope.id);
  await http(o,'view-component',input(f),409);assert.equal((await http(o,'view-component',input(updated))).status,'ready');
  assert.equal((await store.prepareReplacementWorkspaceView(o.scope,o.user,request)).statements.length,0);
  await assert.rejects(async()=>store.prepareReplacementWorkspaceView(o.scope,o.user,{...request,originTurnId:await origin(o)}),e=>e.code==='interaction_changed');
  await assert.rejects(async()=>store.prepareReplacementWorkspaceView(o.scope,o.user,{...request,originTurnId:await origin(o),previousInteractionId:updated.envelope.id,definitionDigest:updated.envelope.definitionDigest,view:view(null)}),e=>e.code==='adapter_unavailable');
 });
 await test('temporary and saved views use identical definitions, bindings and scoped facts',async()=>{
  const o=await owner(),f=await issue(o),v=f.envelope.definition.workspaceView;
  await layout.mutateLayout(o.scope,o.user,{version:1,requestId:id(),expectedRevision:0,operation:'createPage',page:{id:'tab-overview',label:'Garden',view:v}});
  for(const kind of v.widgets){const a=await http(o,'view-component',input(f,kind)),b=await bindings.readSavedViewComponent(o.scope,o.user,{version:1,pageId:'tab-overview',revision:1,kind});assert.equal(a.binding,b.binding);assert.equal(a.status,b.status);assert.deepEqual(a.data,b.data);assert.doesNotMatch(JSON.stringify(a),/PRIVATE_PURPOSE_CANARY/);}
  const read=await http(o,'read',{version:1,interactionId:f.envelope.id,client});assert.equal(read.envelope.definitionDigest,f.envelope.definitionDigest);
  const account=await issue(o,view(null));assert.equal((await http(o,'view-component',input(account))).binding,'workspace.projects@1');
  assert.deepEqual((await http(o,'view-component',input(account))).data.items.map(p=>p.projectId),[o.project]);
 });
 await test('forged definitions, bindings, actions, selectors and mismatched scopes are rejected',async()=>{
  const o=await owner(),f=await issue(o),base=definitions.workspaceViewDefinition(view(o.project));
  for(const change of [{html:'<iframe/>'},{version:0},{widgets:['query']},{shortcuts:['project']},{url:'https://example.invalid'},{projectId:id(),query:'SELECT secrets'}])assert.equal(requests.interactionActionRequest({kind:'interaction',operation:'showView',view:{...view(o.project),...change}}),false);
  for(const patch of [{title:'Custom executable title'},{cards:[{id:'projects',binding:'project.status@1',display:'workspace',limit:1,reviewId:null}]},{submitBinding:'interaction.answers@1'},{fields:[{}]}])assert.throws(()=>protocol.validateDefinition({...base,...patch}));
  const {definitionDigest,...unsigned}=f.envelope;await assert.rejects(()=>protocol.sealDefinition({...unsigned,scope:{...unsigned.scope,projectId:id()}}));
  for(const patch of [{query:'SELECT secrets'},{projectId:id()},{binding:'project.status@1'},{kind:'constructor'}])await http(o,'view-component',{...input(f),...patch},patch.kind?404:400);
  await http(o,'view-component',{...input(f),definitionDigest:'0'.repeat(64)},409);await http(o,'view-component',{...input(f),version:0},409);
  await http(o,'read',{version:1,interactionId:f.envelope.id,client:{...client,bindings:client.bindings.filter(b=>b!=='owner.activity@1')}},409);
  for(const operation of ['submit','save-draft'])await http(o,'mutate',{...cancel(f),operation,answers:{}},400);
 });
 await test('identity, CSRF and foreign-owner access cannot read or dismiss views',async()=>{
  const a=await owner(),b=await owner(),f=await issue(a);
  await http(null,'view-component',input(f),401);await http(a,'view-component',input(f),403,'https://foreign.test');await http(b,'view-component',input(f),404);await http(b,'mutate',cancel(f),404);
  await assert.rejects(async()=>store.prepareWorkspaceView(b.scope,b.user,{originTurnId:await origin(b),view:view(a.project)}));
 });
 await test('lost dismissal acknowledgment recovers one receipt and never reopens the view',async()=>{
  const o=await owner(),f=await issue(o),r=cancel(f);let lost=false;
  const scoped=await o.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interaction_requests/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Synthetic lost commit acknowledgment');}}));
  const receipt=await store.mutateInteraction(scoped,o.user,r);assert(lost);assert.equal(receipt.requestId,r.requestId);assert.deepEqual(await http(o,'mutate',r),receipt);await http(o,'read',{version:1,interactionId:f.envelope.id,client},410);await http(o,'view-component',input(f),410);
  assert.equal((await row('SELECT count(*) n FROM chat_interaction_requests WHERE interaction_id=?',f.envelope.id)).n,1);
  const removed=await row('SELECT state,envelope_json,draft_json FROM chat_interactions WHERE id=?',f.envelope.id);assert.deepEqual({...removed},{state:'canceled',envelope_json:null,draft_json:'{}'});
  const replay=await store.prepareWorkspaceView(o.scope,o.user,{originTurnId:f.envelope.scope.originTurnId,view:f.envelope.definition.workspaceView});assert.equal(replay.statements.length,0);
  const facts=await history.interactionHistory(o.scope,o.user,[f.envelope.scope.originTurnId]);assert.equal(facts.get(f.envelope.scope.originTurnId).state,'removed');
 });
 await test('late read revocation returns denied facts; current owner can still dismiss',async()=>{
  const o=await owner(),f=await issue(o);let revoked=false;
  const scoped=await o.authority.scope(interceptDatabase(db,/^SELECT .* FROM project_service_status /,async()=>{},async()=>{if(!revoked){revoked=true;await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND operation=\'read\'',o.user);}}));
  const c=await cards.readTemporaryViewComponent(scoped,o.user,input(f));assert(revoked);assert.equal(c.status,'denied');assert.equal(c.data,null);await http(o,'mutate',cancel(f));
 });
 await test('dismissal during read discards facts and cannot be reversed by a late response',async()=>{
  const o=await owner(),f=await issue(o);let dismissed=false;
  const scoped=await o.authority.scope(interceptDatabase(db,/^SELECT .* FROM project_service_status /,async()=>{},async()=>{if(!dismissed){dismissed=true;await store.mutateInteraction(o.scope,o.user,cancel(f));}}));
  await assert.rejects(()=>cards.readTemporaryViewComponent(scoped,o.user,input(f)),e=>e.code==='draft_removed');assert(dismissed);
 });
 await test('late project or identity loss invalidates current reads and issuance',async()=>{
  const o=await owner(),other=await owner(),f=await issue(o);let moved=false;
  const scoped=await o.authority.scope(interceptDatabase(db,/^SELECT .* FROM project_service_status /,async()=>{},async()=>{if(!moved){moved=true;await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);}}));
  await assert.rejects(()=>cards.readTemporaryViewComponent(scoped,o.user,input(f)),e=>e.code==='not_found');
  const a=await owner(),turn=await origin(a),plan=await store.prepareWorkspaceView(a.scope,a.user,{originTurnId:turn,view:view(a.project)});await a.authority.revoke();await assert.rejects(()=>a.scope.batch(plan.statements));assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE user_id=?',a.user)).n,0);
 });
 await test('unavailable reads neither mutate state nor dispatch effects; fresh reads recover',async()=>{
  const o=await owner(),f=await issue(o);const scoped=await o.authority.scope(interceptDatabase(db,/^SELECT .* FROM project_service_status /,async()=>{throw Error('Synthetic read outage');}));
  assert.equal((await cards.readTemporaryViewComponent(scoped,o.user,input(f))).status,'unavailable');assert.equal((await http(o,'view-component',input(f))).status,'ready');
  assert.equal((await row('SELECT count(*) n FROM chat_interaction_requests WHERE user_id=?',o.user)).n,0);
  for(const table of ['chat_interaction_submissions','chat_interaction_continuations','inference_calls','standard_ai_requests','publications'])assert.equal((await row('SELECT count(*) n FROM '+table)).n,0);
 });
 assert.equal(network,0);console.log(`Temporary Chat views: ${cases} domain/HTTP cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; atomic issuance, common facts, closed definitions, isolation, durable dismissal/replay, late revocation and zero read effects. No model or CMS tests.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
