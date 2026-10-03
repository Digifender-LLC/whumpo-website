import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/index.ts','src/workspace-layout.ts','src/workspace-view-bindings.ts','src/workspace-view-data.ts','src/chat-interactions/store.ts','src/chat-interactions/cards.ts','src/project-specification/store.ts']);
const worker=(await modules.module('src/index.ts')).default,layout=await modules.module('src/workspace-layout.ts'),bindings=await modules.module('src/workspace-view-bindings.ts'),shape=await modules.module('src/workspace-view-data.ts'),store=await modules.module('src/chat-interactions/store.ts'),cards=await modules.module('src/chat-interactions/cards.ts'),site=await modules.module('src/project-specification/store.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
let cases=0,network=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Unexpected provider or inference');};
async function test(name,fn){try{await fn();cases++;}catch(error){console.error(name,String(error));throw error;}}
async function owner(){
 const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),project=id(),grants={};
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','PRIVATE_BRIEF_CANARY','draft',?,?)",project,user,now(),now());
 for(const projectId of [null,project])for(const [feature,operation] of [['core.editing','read'],['core.editing','prepare'],['core.insights','read']]){
  const grant=id();grants[(projectId??'account')+feature+operation]=grant;
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic view fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",grant,user,projectId,feature,operation);
 }
 const turn=id(),prepared=await site.createWebsite(scope,user,turn,project,{name:'Garden',headline:'Neighborhood gardens',description:'Local gardening',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[],photos:[]});
 await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Create a site',?,?,'ai','pending')").bind(turn,user,prepared.reply,now()),...prepared.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),scope.prepare('UPDATE workspace_state SET revision=1 WHERE user_id=?').bind(user)]);
 await layout.mutateLayout(scope,user,{version:1,requestId:id(),expectedRevision:0,operation:'createPage',page:{id:'tab-garden',label:'Garden',view:{version:1,projectId:project,widgets:['projects','usage','activity','storage','traffic','performance'],shortcuts:[]}}});
 return {authority,user,scope,project,grants};
}
const input=(kind,pageId='tab-garden',revision=1)=>({version:1,pageId,revision,kind});
const read=(o,kind,scope=o.scope)=>bindings.readSavedViewComponent(scope,o.user,input(kind));
const revoke=(o,feature='core.editing',project=o.project)=>run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.grants[(project??'account')+feature+'read']);
async function form(o){const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) SELECT ?,user_id,revision+1,'Change the headline','Review this form',? FROM workspace_state WHERE user_id=?",turn,now(),o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);return store.issueContentBrief(o.scope,o.user,{originTurnId:turn,projectId:o.project,contentIds:['headline']});}
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
async function http(o,data,status=200,origin='https://whumpo.com',database=db){const r=await worker.fetch(new Request('https://whumpo.com/api/workspace/views/v1/component',{method:'POST',headers:{origin,'content-type':'application/json',...(o?{cookie:'__Host-whumpo_session='+o.authority.token}:{})},body:JSON.stringify(data)}),{...env,DB:database},{waitUntil(){throw Error('No background effect expected');}}),body=await r.json();assert.equal(r.status,status,JSON.stringify(body));assert.match(r.headers.get('cache-control'),/no-store/);return body;}
try{
 await test('Chat and saved page resolve the same project binding and exact facts',async()=>{
  const o=await owner(),f=await form(o),chat=await cards.readInteractionCard(o.scope,o.user,{version:1,interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,cardId:'project-status'}),saved=await http(o,input('projects'));
  assert.equal(saved.binding,chat.binding);assert.deepEqual(saved.data.items,[chat.data]);assert.equal(saved.status,'ready');assert(shape.readViewComponentData(saved));
  assert.doesNotMatch(JSON.stringify(saved),/PRIVATE_BRIEF_CANARY|credential|answer|approval/);
 });
 await test('registered project reads return actual scoped activity, storage and traffic',async()=>{
  const a=await owner(),b=await owner(),activity=id();
  for(const [o,summary,bytes,requests] of [[a,'Planted a garden',1048576,4],[b,'FOREIGN_CANARY',500000,99]]){
   await run('INSERT INTO activity_events VALUES(?,?,?,?,?,?)',o===a?activity:id(),o.user,o.project,'fixture',summary,now());
   await run("INSERT INTO project_files VALUES(?,?,?,?,?, ?,1,1,'ready',?)",id(),o.project,'Metadata only',id(),'a'.repeat(64),bytes,now());
   await run("INSERT INTO site_traffic_daily(project_id,day,requests) VALUES(?,date('now'),?)",o.project,requests);
  }
  const log=await read(a,'activity');assert.equal(log.status,'ready','activity reader');assert(log.data.items.some(x=>x.id===activity&&x.summary==='Planted a garden'));
  assert.deepEqual((await read(a,'storage')).data,{files:1,bytes:1048576});
  const traffic=await read(a,'traffic');assert.equal(traffic.status,'ready','traffic reader');assert.equal(traffic.data.rows.reduce((n,r)=>n+r.requests,0),4);assert.equal(traffic.binding,'project.traffic@1');
  for(const value of [log,traffic,await read(a,'projects')])assert(!JSON.stringify(value).includes('FOREIGN_CANARY'));
  const usage=await read(a,'usage');assert.deepEqual(usage.data,{standardIncluded:true,advancedEnabled:false});
  const performance=await read(a,'performance');assert.equal(performance.status,'unavailable');assert.equal(performance.data,null);
 });
 await test('account cards use current ownership and actual missing data is unavailable',async()=>{
  const o=await owner(),other=await owner();
  const c=await bindings.readSavedViewComponent(o.scope,o.user,input('projects','dashboard'));assert.equal(c.binding,'workspace.projects@1');assert.deepEqual(c.data.items.map(p=>p.projectId),[o.project]);
  await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);assert.equal((await read(o,'projects')).status,'denied');
  const p=await owner(),metadata=await row('SELECT * FROM site_traffic_metadata WHERE id=1');await run('DELETE FROM site_traffic_metadata WHERE id=1');
  assert.equal((await read(p,'traffic')).status,'unavailable');await run('INSERT INTO site_traffic_metadata VALUES(1,?)',metadata.enabled_at);
 });
 await test('HTTP rejects unauthenticated, forged, stale and nonregistered component requests',async()=>{
  const o=await owner();await http(null,input('projects'),401);await http(o,input('projects'),403,'https://foreign.test');
  for(const patch of [{version:0},{query:'SELECT secret'},{projectId:id()},{kind:'constructor'},{kind:'html'},{revision:-1}])await http(o,{...input('projects'),...patch},400);
  await http(o,input('projects','missing'),404);await http(o,input('traffic','dashboard'),404);await http(o,input('projects','tab-garden',0),409);
 });
 await test('project and account feature loss returns denial with no cached facts',async()=>{
  const o=await owner();assert.equal((await read(o,'projects')).status,'ready');await revoke(o);
  for(const kind of ['projects','usage','activity','storage']){const c=await read(o,kind);assert.equal(c.status,'denied');assert.equal(c.data,null);}
  await revoke(o,'core.insights');assert.equal((await read(o,'traffic')).status,'denied');
  await revoke(o,'core.editing',null);assert.equal((await http(o,input('projects','dashboard'))).status,'denied');
 });
 await test('late revocation, transfer and account ownership changes discard fetched facts',async()=>{
  for(const kind of ['feature','project','account']){
   const o=await owner(),other=await owner();let hit=false;
   const scope=await o.authority.scope(interceptDatabase(db,/^SELECT .* FROM project_service_status /,async()=>{},async()=>{hit=true;if(kind==='feature')await revoke(o);else await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);}));
   const c=await bindings.readSavedViewComponent(scope,o.user,input('projects',kind==='account'?'dashboard':'tab-garden'));assert(hit);assert.equal(c.status,kind==='account'?'unavailable':'denied');assert.equal(c.data,null);
  }
 });
 await test('late page changes and identity loss cannot return an old response',async()=>{
  for(const kind of ['layout','identity']){
   const o=await owner();let hit=false;
   const database=interceptDatabase(db,/^SELECT .* FROM project_service_status /,async()=>{},async()=>{hit=true;if(kind==='identity')await o.authority.revoke();else await layout.mutateLayout(o.scope,o.user,{version:1,requestId:id(),expectedRevision:1,operation:'removePage',pageId:'tab-garden'});});
   await http(o,input('projects'),409,'https://whumpo.com',database);assert(hit);
  }
 });
 await test('domain read failure is unavailable and refresh can recover without effects',async()=>{
  const o=await owner(),scope=await o.authority.scope(interceptDatabase(db,/^SELECT .* FROM project_service_status /,async()=>{throw Error('Synthetic query outage');}));
  const unavailable=await read(o,'projects',scope);assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.data,null);
  let writes=0;const readOnly=interceptDatabase(db,/^(?:UPDATE|DELETE|INSERT(?! INTO identity_admission_checks))/,async()=>{writes++;throw Error('Read attempted a write');});
  for(let i=0;i<3;i++)for(const kind of ['projects','activity','storage','usage','traffic','performance'])await http(o,input(kind),200,'https://whumpo.com',readOnly);
  assert.equal(writes,0);assert.equal((await read(o,'projects')).status,'ready');
 });
 await test('client facts refuse extra authority, unknown versions and inconsistent scope',async()=>{
  const o=await owner(),c=await read(o,'projects');
  for(const patch of [{version:0},{approval:id()},{href:'javascript:alert(1)'},{binding:'arbitrary.query@1'},{projectId:id()},{status:'denied'},{data:{items:[{...c.data.items[0],email:'secret'}]}}])assert.equal(shape.readViewComponentData({...c,...patch}),null);
  for(const status of ['denied','unavailable'])assert(shape.readViewComponentData({...c,status,data:null}));
 });
 assert.equal(network,0);
 console.log(`Shared workspace bindings: ${cases} cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; same Chat/page facts, current scope, real measurements, denial/unavailability, late revocation/layout loss, closed output and zero read effects/inference. No CMS functional testing or deployment.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
