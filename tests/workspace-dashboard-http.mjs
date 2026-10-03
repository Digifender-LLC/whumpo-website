import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const run=(sql,...p)=>db.prepare(sql).bind(...p).run(),row=(sql,...p)=>db.prepare(sql).bind(...p).first();
const base='https://whumpo.com',api='/api/workspace/views/v1',background=[];
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},AI_BASE_URL:'https://opencode.ai/zen/go/v1',AI_MODEL:'muse-spark-1.3-contributor',AI_PROTOCOL:'responses',AI_API_KEY:'synthetic-only'};
let cases=0,mainCalls=0,ackCalls=0,queue=[];const originalFetch=globalThis.fetch;
const test=async(name,fn)=>{try{await fn();assert.equal(queue.length,0);cases++;}catch(error){console.error(name,String(error));throw error;}};
globalThis.fetch=async(url,init)=>{
 assert.equal(String(url),env.AI_BASE_URL+'/responses','Unexpected network request');
 const request=JSON.parse(init.body);assert.equal(request.model,env.AI_MODEL);
 const ack=request.max_output_tokens===256;
 let value;if(ack){ackCalls++;value={intent:'editing'};}else{mainCalls++;assert(queue.length,'Unexpected inference');const next=queue.shift();value={reply:'Untrusted model claim',action:typeof next==='function'?await next(request):next};}
 return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(value)}]}],usage:{input_tokens:100,output_tokens:20}});
};
async function owner(){
 const authority=await workspaceFixture(db,m),user=authority.account,project=id(),grant=id();
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',datetime('now'),datetime('now'))",project,user);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic workspace HTTP',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",grant,user);
 return {authority,user,project,grant};
}
const request=(o,path,data,database=db,origin=base)=>m.worker.fetch(new Request(base+path,{method:data?'POST':'GET',headers:{origin,...(o?{cookie:'__Host-whumpo_session='+o.authority.token}:{}),...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),{...env,DB:database},{waitUntil(p){background.push(p);}});
async function json(o,path,data,database,status=200,origin){const r=await request(o,path,data,database,origin);assert.equal(r.status,status,await r.clone().text());return r.json();}
const view=projectId=>({version:1,projectId,widgets:['projects','activity'],shortcuts:['project']});
const create=o=>({version:1,requestId:id(),expectedRevision:0,operation:'createPage',page:{id:'tab-garden',label:'Garden',view:view(o.project)}});
async function chat(o,action,database=db){queue=[action];const input={id:id(),revision:(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user)).revision,content:'Please create a Garden sidebar page with project status and activity for my landscaping project.'};const result=await json(o,'/api/chat',input,database);return {input,result,turn:result.turns.find(t=>t.id===input.id)};}
try{
 await test('current HTTP routes enforce identity, CSRF, closed input and retired-route rejection',async()=>{
  const o=await owner(),input=create(o);await json(null,api+'/layout',undefined,db,401);
  await json(o,api+'/mutate',input,db,403,'https://untrusted.example');
  await json(o,'/api/workspace/layout',undefined,db,404);
  await json(o,api+'/mutate',{...input,sql:'SELECT *'},db,400);
  const saved=await json(o,api+'/mutate',input);assert.equal(saved.revision,1);
  assert.deepEqual(await json(o,api+'/mutate',input),saved);
  assert.deepEqual(await json(o,api+'/receipt',{version:1,requestId:input.requestId}),saved);
  await json(o,api+'/receipt',{version:1,requestId:input.requestId,ownerId:o.user},db,400);
  await json(o,api+'/mutate',{...input,requestId:id()},db,409);
  const other=await owner();await json(other,api+'/receipt',{version:1,requestId:input.requestId},db,404);
  const foreign=create(other);foreign.page.view.projectId=o.project;await json(other,api+'/mutate',foreign,db,404);
 });
 await test('layout, receipt, history and dashboard reads create no inference calls',async()=>{
  const o=await owner(),input=create(o);await json(o,api+'/mutate',input);const before=mainCalls+ackCalls;
  for(let i=0;i<3;i++){await json(o,api+'/layout');await json(o,api+'/history');await json(o,api+'/receipt',{version:1,requestId:input.requestId});await json(o,'/api/workspace/dashboard');}
  assert.equal(mainCalls+ackCalls,before);assert.equal((await row('SELECT count(*) n FROM chat_turns WHERE user_id=?',o.user)).n,0);
 });
 await test('actual Chat saves one atomic layout/result and exact replay does not call a model',async()=>{
  const o=await owner(),{requestId,...action}=create(o),saved=await chat(o,{kind:'workspace',...action});
  assert.equal(saved.turn.status,'completed');assert.match(saved.turn.assistant_text,/saved/);
  const receipt=await json(o,api+'/receipt',{version:1,requestId:saved.input.id});assert.equal(receipt.revision,1);
  const before=mainCalls+ackCalls;await json(o,'/api/chat',saved.input);assert.equal(mainCalls+ackCalls,before);
  assert.equal((await row('SELECT count(*) n FROM workspace_layout_receipts WHERE user_id=?',o.user)).n,1);
 });
 await test('model cannot choose a different receipt identity or submit a retired whole-layout save',async()=>{
  for(const extra of [{requestId:id()},{operation:'save',layout:{widgets:[],tabs:[]}}]){
   const o=await owner(),{requestId,...action}=create(o),result=await chat(o,{kind:'workspace',...action,...extra});
   assert.equal(result.turn.status,'completed');assert(!result.turn.assistant_text.includes('Untrusted model claim'));
   assert.equal((await json(o,api+'/layout')).revision,0);
  }
 });
 await test('lost final-transaction acknowledgment recovers the saved Chat reply and page exactly once',async()=>{
  const o=await owner(),{requestId,...action}=create(o);let intercepted=false;
  const lossy=interceptDatabase(db,/^INSERT INTO workspace_layout_receipts\(/,async()=>{},async()=>{intercepted=true;throw Error('Lost final transaction response');});
  const result=await chat(o,{kind:'workspace',...action},lossy);assert(intercepted);assert.equal(result.turn.status,'completed');assert.match(result.turn.assistant_text,/saved/);
  assert.equal((await json(o,api+'/layout')).revision,1);assert.equal((await row('SELECT count(*) n FROM workspace_layout_receipts WHERE user_id=?',o.user)).n,1);
 });
 await test('late revision and feature changes produce truthful failed Chat with no proposed page',async()=>{
  for(const kind of ['revision','feature']){
   const o=await owner(),{requestId,...action}=create(o);let intercepted=false;
   const racing=interceptDatabase(db,/^INSERT INTO workspace_layout_receipts\(/,async()=>{
    intercepted=true;if(kind==='feature')await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.grant);
    else {const other=create(o);other.page.id='tab-kept';other.page.label='Keep this page';await m.mutateLayout(await o.authority.scope(),o.user,other);}
   });
   const result=await chat(o,{kind:'workspace',...action},racing);assert(intercepted);assert.equal(result.turn.status,'failed');assert.match(result.turn.assistant_text,/No layout change was saved/);
   const saved=await json(o,api+'/layout');assert.equal(saved.revision,kind==='revision'?1:0);assert(!saved.layout.tabs.some(t=>t.id==='tab-garden'));
   if(kind==='revision')assert.equal(saved.layout.tabs[0].id,'tab-kept');
   await json(o,api+'/receipt',{version:1,requestId:result.input.id},db,404);
  }
 });
 await test('Chat can inspect current receipts before proposing an undo',async()=>{
  const o=await owner(),input=create(o),saved=await json(o,api+'/mutate',input);
  queue=[{kind:'workspace',operation:'read'},request=>{
   assert(JSON.stringify(request).includes(saved.requestId));
   return {kind:'workspace',version:1,expectedRevision:1,operation:'undo',receiptId:saved.requestId};
  }];
  const result=await json(o,'/api/chat',{id:id(),revision:0,content:'Undo the page I just added to my sidebar.'});
  assert.equal(result.turns.at(-1).status,'completed');assert.equal((await json(o,api+'/layout')).revision,2);assert.deepEqual((await json(o,api+'/layout')).layout.tabs,[]);
 });
 await Promise.all(background);
 console.log(`Workspace HTTP/Chat: ${cases} cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; ${mainCalls} scripted main and ${ackCalls} acknowledgment calls. Actual Worker/auth/domain transactions, read-only refresh, lost response and stale effect checks; no live inference or deployment.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
