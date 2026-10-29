import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
const paths=['src/index.ts','src/service-safety.ts','src/backend-versions.ts','src/backend-publication.ts','src/app-activation.ts','src/app-pages.ts','src/app-auth.ts','src/app-data.ts','src/app-host.ts','src/site-host.ts','src/chat.ts','src/project-specification/store.ts','src/project-specification/catalog.ts','src/project-specification/v2/json.ts'];
const modules=await currentFixtureModules(paths),all=await Promise.all(paths.map(p=>modules.module(p)));
const [platform,safety,backend,publication,activation,pages,auth,data,appHost,siteHost,chat,specStore,catalog,specJSON]=all;
// WH-126 visitor access fixture helpers run on this same bundle (admission capabilities are bundle-private).
const handlers={readChat:chat.readChat,sendChatControl:chat.sendChatControl,createWebsite:specStore.createWebsite,prepareSpecification:specStore.prepareSpecification,readSpecificationProposal:specStore.readSpecificationProposal,jsonDigest:specJSON.jsonDigest,moduleCatalog:catalog.moduleCatalog};
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID(),run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
let calls=0,network=0,cases=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('No provider request permitted');};
const runtime={fetch:async(_url,init)=>{calls++;return Response.json({ok:true,value:{state:{},result:JSON.parse(init.body).input}});}};
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:runtime,ASSETS:{fetch:async()=>new Response('<main>Synthetic visitor shell</main>',{headers:{'content-type':'text/html'}})}},ctx={waitUntil(){throw Error('No background work expected');}};
async function test(name,fn){try{await fn();cases++;}catch(e){console.error(name,e);throw e;}}
async function http(o,path='',method='GET',body,status=200,origin='https://whumpo.com'){
 const response=await platform.default.fetch(new Request('https://whumpo.com/api/workspace/service-safety/reviews'+path,{method,headers:{...(o?{cookie:'__Host-whumpo_session='+o.authority.token}:{}),origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,ctx);
 assert.equal(response.status,status,await response.clone().text());assert.match(response.headers.get('cache-control'),/no-store/);return response.json();
}
const form={title:'Garden notebook',description:'Synthetic notes',buttonLabel:'Save',fields:[{key:'note',label:'Note',type:'text'}]};
async function owner(){
 const authority=await workspaceFixture(db,modules.identity),o={authority,user:authority.account,scope:await authority.scope(),project:id(),version:id(),run:id()};
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",o.user);await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden notebook','Garden care','draft',datetime('now'),datetime('now'))",o.project,o.user);
 await backend.saveBackend(o.scope,o.user,o.project,o.version,'export default ({state,input})=>({state:input,result:state})');
 await backend.testBackend(o.scope,runtime,o.user,o.project,o.version,o.run,{state:{},input:{}});
 await republish(o,'backend');await enableFixtureVisitorAccess(o.scope,o.user,o.project,{handlers});const app=id();await activation.prepareApplication(o.scope,o.user,o.project,app,'enable',o.version,o.run);await activation.confirmApplication(o.scope,o.user,app);await republish(o,'application');
 return o;
}
async function republish(o,kind){const review=id();if(kind==='backend'){await publication.prepareBackendPublication(o.scope,o.user,o.project,review,'publish',o.version,o.run);await publication.confirmBackendPublication(o.scope,o.user,review);}else{await pages.prepareAppPage(o.scope,o.user,o.project,review,form);await pages.confirmAppPage(o.scope,o.user,review);}return review;}
async function prepare(o,kind){const resource=(await safety.safetyResources(o.scope,o.user,[o.project])).find(r=>r.kind===kind);const input={version:1,id:id(),kind,projectId:o.project,expectedRevision:resource.revision,programRevision:resource.programRevision,versionId:resource.versionId};return {input,...await http(o,'','POST',input)};}
const confirm={version:1,confirmation:'TAKE_OFFLINE'},saved=(kind,id)=>'/'+kind+'/'+id;
const publicApp=o=>appHost.default.fetch(new Request('https://app-'+o.project+'.whumpo.site/'),env);
const publicBackend=o=>siteHost.default.fetch(new Request('https://'+o.project+'.whumpo.site/backend',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}),env);
try{
 const a=await owner(),b=await owner();
 await test('metadata minimization, strict protocol and owner/identity gates',async()=>{
  const resources=await safety.safetyResources(a.scope,a.user,[a.project]);assert.equal(resources.length,2);assert(resources.every(r=>r.published));assert(!JSON.stringify(resources).includes('export default'));
  const r=await prepare(a,'backend');assert(!JSON.stringify(r.review).includes('source'));assert.deepEqual((await http(a,'','POST',r.input)).review,r.review);
  await http(null,saved('backend',r.input.id),'GET',undefined,401);await http(b,saved('backend',r.input.id),'GET',undefined,404);await http(b,saved('backend',r.input.id)+'/confirm','POST',confirm,404);
  await http(a,'?project='+b.project+'&kind=backend','GET',undefined,404);await http(a,'?project='+a.project+'&kind=backend&kind=application','GET',undefined,400);
  await http(a,'','POST',{...r.input,extra:true},400);await http(a,'','POST',{...r.input,kind:'publish'},400);await http(a,'','POST',{...r.input,expectedRevision:99},409);
  await http(a,saved('backend',r.input.id)+'/confirm','POST',{},400);await http(a,saved('backend',r.input.id)+'/confirm','POST',confirm,403,'https://foreign.invalid');
  await http({authority:await workspaceFixture(db,modules.identity)},saved('backend',r.input.id),'GET',undefined,409);
  for(const kind of ['backend','application']){const publicationId=await republish(a,kind);await http(a,saved(kind,publicationId)+'/confirm','POST',confirm,404);}
 });
 await test('withdrawals affect only the exact service, retain data and cannot withdraw a later publication',async()=>{
  const o=await owner();assert.equal((await publicBackend(o)).status,200);assert.equal((await publicApp(o)).status,200);
  // Existing visitor authority and data are private fixtures; withdrawal stops the application surface and keeps the
  // document. Visitor sign-in belongs to the access instance (WH-126), so sessions and pending sign-ins are kept.
  const visitor=id();await run("INSERT INTO app_visitors(id,project_id,access_id) SELECT ?,?,id FROM module_instances WHERE project_id=? AND kind='access'",visitor,o.project,o.project);
  const token=await data.issueAppSession(db,visitor);assert.deepEqual(await data.readAppData(db,token,o.project),{revision:0,state:{}});
  await auth.appPasskeyOptions(db,o.project,'login',false,'');assert((await row('SELECT count(*) n FROM app_auth_challenges WHERE project_id=?',o.project)).n>0);
  const endpoint=await prepare(o,'backend'),app=await prepare(o,'application');const callsBefore=calls;
  const result=await Promise.all([http(o,saved('backend',endpoint.input.id)+'/confirm','POST',confirm),http(o,saved('backend',endpoint.input.id)+'/confirm','POST',confirm)]);assert(result.every(r=>r.review.state==='applied'));
  assert.equal((await publicBackend(o)).status,404);assert.equal((await publicApp(o)).status,200);assert.equal(calls,callsBefore);assert.equal((await row('SELECT revision FROM backend_publications WHERE project_id=?',o.project)).revision,2);
  const appResults=await Promise.all([http(o,saved('application',app.input.id)+'/confirm','POST',confirm),http(o,saved('application',app.input.id)+'/confirm','POST',confirm)]);assert(appResults.every(r=>r.review.state==='applied'));
  assert.equal((await publicApp(o)).status,404);assert.equal((await row('SELECT count(*) n FROM app_sessions WHERE visitor_id=?',visitor)).n,1);
  assert.ok((await row('SELECT count(*) n FROM app_auth_challenges WHERE project_id=?',o.project)).n>0);assert.equal((await row('SELECT count(*) n FROM app_documents WHERE visitor_id=?',visitor)).n,1);assert.equal((await row('SELECT count(*) n FROM backend_versions WHERE id=?',o.version)).n,1);
  for(const kind of ['backend','application']){const r=kind==='backend'?endpoint:app;await republish(o,kind);const old=await http(o,saved(kind,r.input.id)+'/confirm','POST',confirm);assert.equal(old.review.state,'applied');assert.equal(old.review.publishedNow,true);}
  assert.equal((await publicBackend(o)).status,200);assert.equal((await publicApp(o)).status,200);
 });
 await test('withdrawing a page stops an admitted visitor transition from saving',async()=>{
  const o=await owner(),visitor=id(),operation=id();await run("INSERT INTO app_visitors(id,project_id,access_id) SELECT ?,?,id FROM module_instances WHERE project_id=? AND kind='access'",visitor,o.project,o.project);
  const token=await data.issueAppSession(db,visitor),review=await prepare(o,'application');let release,started;
  const ready=new Promise(done=>{started=done;}),held={fetch:async()=>{started();await new Promise(done=>{release=done;});return Response.json({ok:true,value:{state:{note:'Must not save'},result:'Saved'}});}};
  const pending=data.transitionAppData(db,held,token,o.project,operation,0,{note:'Must not save'});
  await ready;await http(o,saved('application',review.input.id)+'/confirm','POST',confirm);release();
  assert.equal((await pending).state,'conflict');assert.deepEqual({...await row('SELECT revision,state_json FROM app_documents WHERE visitor_id=?',visitor)},{revision:0,state_json:'{}'});
  assert.equal((await publicApp(o)).status,404);
 });
 await test('source integrity remains required for publishing, but not for negative withdrawal',async()=>{
  const o=await owner(),off=await prepare(o,'backend'),publish=await republish(o,'backend');
  const brokenRead={prepare:q=>({bind:(...args)=>({first:async()=>{const value=await db.prepare(q).bind(...args).first();return value?{...value,source:'damaged source'}:value;}})})};
  assert.equal((await publication.readBackendPublicationReview(brokenRead,o.user,off.input.id)).operation,'unpublish');
  await assert.rejects(()=>publication.readBackendPublicationReview(brokenRead,o.user,publish),e=>e.status===409);
 });
 await test('stale publication/program snapshots and expired reviews cannot act',async()=>{
  for(const kind of ['backend','application']){
   const o=await owner(),r=await prepare(o,kind);await republish(o,kind);
   assert.equal((await http(o,saved(kind,r.input.id))).review.state,'changed');await http(o,saved(kind,r.input.id)+'/confirm','POST',confirm,409);
   await http(o,'','POST',{...r.input,id:id()},409);
   const fresh=await prepare(o,kind),Clock=globalThis.Date;globalThis.Date=class extends Clock{constructor(...args){super(...(args.length?args:[Clock.now()+601000]));}static now(){return Clock.now()+601000;}};
   try{assert.equal((await http(o,saved(kind,fresh.input.id))).review.state,'expired');await http(o,saved(kind,fresh.input.id)+'/confirm','POST',confirm,409);}finally{globalThis.Date=Clock;}
  }
  const o=await owner(),r=await prepare(o,'application'),disable=id();await activation.prepareApplication(o.scope,o.user,o.project,disable,'disable',null,null);await activation.confirmApplication(o.scope,o.user,disable);
  await http(o,saved('application',r.input.id)+'/confirm','POST',confirm,409);
 });
 await test('saved direct and existing handler reviews are discoverable without inference or automatic writes',async()=>{
  for(const kind of ['backend','application']){
   const o=await owner(),existing=id();
   for(let i=0;i<22;i++)await prepare(o,kind);
   if(kind==='backend')await publication.prepareBackendPublication(o.scope,o.user,o.project,existing,'unpublish',o.version,null);else await pages.prepareAppPage(o.scope,o.user,o.project,existing,null);const before=calls;let after=null,ids=[];
   do{const list=await http(o,'?kind='+kind+'&project='+o.project+(after?'&after='+after:''));ids.push(...list.reviews.map(r=>r.id));after=list.next;}while(after);
   // WH-182: these are withdrawals of one target; each newer one supersedes the older and admission seals the older away, so storage stays bounded at two rows.
   assert.equal(ids.length,2);assert.equal(new Set(ids).size,2);assert(ids.includes(existing));assert.equal(calls,before);
   assert.equal((await http(o,saved(kind,existing)+'/confirm','POST',confirm)).review.state,'applied');
  }
 });
 await test('session revocation at the effect transaction prevents either withdrawal',async()=>{
  for(const kind of ['backend','application']){
   const o=await owner(),r=await prepare(o,kind);let intercepted=false;
   const wrapped=interceptDatabase(db,kind==='backend'?/UPDATE backend_publication_reviews SET status='applied'/:/UPDATE app_page_reviews SET status='applied'/,async()=>{intercepted=true;await o.authority.revoke();});const scope=await o.authority.scope(wrapped);
   await assert.rejects(()=>safety.confirmServiceSafetyReview(scope,o.user,kind,r.input.id,confirm),e=>e.code==='identity_changed');assert(intercepted);
   assert.equal((await publicApp(o)).status,200);assert.equal((await publicBackend(o)).status,200);
  }
 });
 assert.equal(network,0);assert.equal((await row('SELECT count(*) n FROM inference_calls')).n,0);
 // Only the WH-126 visitor access fixture (exact specification save and module activation controls) writes Chat turns.
 assert.equal((await row("SELECT count(*) n FROM chat_turns WHERE user_text<>'Synthetic current website fixture' AND coalesce(json_extract(action_json,'$.type'),'') NOT IN ('accessModuleReview','specificationApply','moduleActivationReview','moduleActivationApply')")).n,0);
 console.log(`Service safety: ${cases} scenario groups passed (${process.argv.includes('--d1')?'local D1':'SQLite'}): strict owned metadata, actual public-route withdrawal, retained visitor documents and access-instance sign-in, exact/replayed/stale/expired reviews, shared handler recovery and transaction-time identity. Runtime responses are synthetic; zero maintainer/provider calls.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
