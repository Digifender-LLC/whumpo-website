import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/index.ts','src/publications.ts','src/project-specification/store.ts','src/site-safety.ts','src/site-host.ts']);
const worker=(await modules.module('src/index.ts')).default,pub=await modules.module('src/publications.ts'),site=await modules.module('src/project-specification/store.ts'),safety=await modules.module('src/site-safety.ts');
const siteHost=(await modules.module('src/site-host.ts')).default;
const visitor=o=>siteHost.fetch(new Request('https://'+o.project+'.whumpo.site/'),{DB:db});
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID(),run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const originalFetch=globalThis.fetch;let network=0,cases=0;globalThis.fetch=async()=>{network++;throw Error('No network call is permitted');};
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){throw Error('No background work is permitted');}};
async function test(name,fn){try{await fn();cases++;}catch(e){console.error(name,e);throw e;}}
async function http(o,path='',method='GET',body,status=200,origin='https://whumpo.com'){
 const response=await worker.fetch(new Request('https://whumpo.com/api/workspace/site-safety'+path,{method,headers:{...(o?{cookie:'__Host-whumpo_session='+o.auth.token}:{}),origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,ctx);
 assert.equal(response.status,status,await response.clone().text());assert.match(response.headers.get('cache-control'),/no-store/);return response.json();
}
async function command(o,prepare,action){const turn=id(),revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user)).revision+1,r=await prepare(turn);await o.scope.batch([o.scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status,action_json) VALUES(?,?,?,'Synthetic website fixture',?,datetime('now'),?,?,?)").bind(turn,o.user,revision,r.reply,action?'guided':'ai',action?'completed':'pending',action?JSON.stringify(action):null),...r.statements,o.scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),o.scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,o.user)]);return turn;}
async function owner(){const auth=await workspaceFixture(db,modules.identity),o={auth,user:auth.account,scope:await auth.scope(),project:id()};await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",o.user);await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Garden care','draft',datetime('now'),datetime('now'))",o.project,o.user);o.version=await command(o,t=>site.createWebsite(o.scope,o.user,t,o.project,{name:'Garden',headline:'Gardens',description:'Garden care',theme:'ocean',aboutTitle:'About',aboutText:'Synthetic gardening',sections:[],photos:[]}));await publish(o);return o;}
async function publish(o){const review=await command(o,t=>pub.publicationCommand(o.scope,o.user,t,'/publish '+o.version));await command(o,t=>pub.publicationCommand(o.scope,o.user,t,'/confirm '+review),{type:'confirm',kind:'site',reviewId:review});return review;}
async function prepare(o){const publication=await row('SELECT revision FROM publications WHERE project_id=?',o.project),input={version:1,id:id(),projectId:o.project,expectedRevision:publication.revision},result=await http(o,'/reviews','POST',input);return {input,...result};}
const confirmation={version:1,confirmation:'UNPUBLISH_WEBSITE'};
try{
 const a=await owner(),b=await owner();
 await test('independent, owned, read-only inventory and strict protocol',async()=>{
  const start=await row('SELECT count(*) n FROM chat_turns');const inventory=await http(a);assert.equal(inventory.projects.length,1);assert.equal(inventory.projects[0].id,a.project);
  await http(null,'','GET',undefined,401);await http(a,'?extra=1','GET',undefined,400);await http(a,'?after='+id()+'&after='+id(),'GET',undefined,400);
  await http(a,'/reviews?project='+b.project,'GET',undefined,404);
  await http({auth:await workspaceFixture(db,modules.identity)},'','GET',undefined,409);
  const wrapped=interceptDatabase(db,/FROM chat_turns|FROM workspace_layout|FROM plan_/i,()=>{throw Error('Unrelated subsystem is unavailable');});
  assert.equal((await safety.siteSafetyInventory(await a.auth.scope(wrapped),a.user,null)).projects[0].id,a.project);
  assert.deepEqual(await row('SELECT count(*) n FROM chat_turns'),start);
 });
 await test('exact review replay, ownership and no publish authority through safety route',async()=>{
  const r=await prepare(a);assert.equal(r.review.state,'pending');assert.equal(r.review.versionId,a.version);
  assert.deepEqual((await http(a,'/reviews','POST',r.input)).review,r.review);
  await http(b,'/reviews/'+r.input.id,'GET',undefined,404);await http(b,'/reviews/'+r.input.id+'/confirm','POST',confirmation,404);
  await http(a,'/reviews','POST',{...r.input,expectedRevision:99},409);await http(b,'/reviews','POST',{...r.input,projectId:b.project},409);
  await http(a,'/reviews','POST',{...r.input,version:0},400);await http(a,'/reviews','POST',{...r.input,extra:true},400);
  await http(a,'/reviews/'+r.input.id+'/confirm','POST',{},400);await http(a,'/reviews/'+r.input.id+'/confirm','POST',confirmation,403,'https://foreign.invalid');
  const publishReview=await command(a,t=>pub.publicationCommand(a.scope,a.user,t,'/publish '+a.version));
  await http(a,'/reviews/'+publishReview+'/confirm','POST',confirmation,404);
 });
 await test('concurrent confirmations share one trigger receipt and stale reviews cannot act',async()=>{
  assert.equal((await visitor(a)).status,200);const one=await prepare(a),two=await prepare(a),before=await row('SELECT count(*) n FROM chat_turns');
  const outcomes=await Promise.all([http(a,'/reviews/'+one.input.id+'/confirm','POST',confirmation),http(a,'/reviews/'+one.input.id+'/confirm','POST',confirmation)]);
  assert(outcomes.every(o=>o.review.state==='applied'));assert.equal((await row('SELECT version_id FROM publications WHERE project_id=?',a.project)).version_id,null);
  assert.equal((await visitor(a)).status,404);assert.equal((await row('SELECT count(*) n FROM activity_events WHERE id=?','publication:'+one.input.id)).n,1);
  await http(a,'/reviews/'+two.input.id+'/confirm','POST',confirmation,409);assert.equal((await http(a,'/reviews/'+two.input.id)).review.state,'changed');
  assert.deepEqual(await row('SELECT count(*) n FROM chat_turns'),before);
  await publish(a);const afterPublish=await row('SELECT * FROM publications WHERE project_id=?',a.project);
  const replay=await http(a,'/reviews/'+one.input.id+'/confirm','POST',confirmation);assert.equal(replay.review.state,'applied');assert.equal(replay.review.versionId,a.version);
  assert.deepEqual(await row('SELECT * FROM publications WHERE project_id=?',a.project),afterPublish);
 });
 await test('a Chat-prepared withdrawal uses the same direct receipt and no second review',async()=>{
  const o=await owner(),review=await command(o,t=>pub.publicationCommand(o.scope,o.user,t,'/unpublish '+o.project));
  const before=await row('SELECT count(*) n FROM publication_actions WHERE project_id=?',o.project),turns=await row('SELECT count(*) n FROM chat_turns WHERE user_id=?',o.user);
  assert.equal((await http(o,'/reviews/'+review)).review.state,'pending');assert((await http(o,'/reviews?project='+o.project)).reviews.some(r=>r.id===review));
  assert.equal((await http(o,'/reviews/'+review+'/confirm','POST',confirmation)).review.state,'applied');
  assert.deepEqual(await row('SELECT count(*) n FROM publication_actions WHERE project_id=?',o.project),before);assert.deepEqual(await row('SELECT count(*) n FROM chat_turns WHERE user_id=?',o.user),turns);
  assert.equal((await visitor(o)).status,404);
 });
 await test('expired reviews and stale displayed preparation are refused',async()=>{
  const expired=id(),publication=await row('SELECT revision FROM publications WHERE project_id=?',a.project);
  await run("INSERT INTO publication_actions(id,user_id,project_id,kind,expected_revision,expires_at) VALUES(?,?,?,'unpublish',?,strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 minute'))",expired,a.user,a.project,publication.revision);
  assert.equal((await http(a,'/reviews/'+expired)).review.state,'expired');await http(a,'/reviews/'+expired+'/confirm','POST',confirmation,409);
  await http(a,'/reviews','POST',{version:1,id:id(),projectId:a.project,expectedRevision:publication.revision-1},409);
 });
 await test('all saved reviews can be found after reload without creating or confirming work',async()=>{
  for(let i=0;i<23;i++)await prepare(a);
  const expected=await row("SELECT count(*) n FROM publication_actions WHERE project_id=? AND kind='unpublish'",a.project);
  let after=null,found=[];do{const page=await http(a,'/reviews?project='+a.project+(after?'&after='+after:''));found.push(...page.reviews.map(r=>r.id));after=page.next;}while(after);
  assert.equal(found.length,expected.n);assert.equal(new Set(found).size,expected.n);
 });
 await test('identity loss immediately before commit rolls back withdrawal',async()=>{
  const o=await owner(),r=await prepare(o);let hit=false;
  const wrapped=interceptDatabase(db,/UPDATE publication_actions SET status='applied'/,async()=>{hit=true;await o.auth.revoke();});
  const scoped=await o.auth.scope(wrapped);await assert.rejects(()=>safety.confirmSiteSafetyReview(scoped,o.user,r.input.id,confirmation),e=>e.code==='identity_changed');
  assert(hit);assert.equal((await row('SELECT version_id FROM publications WHERE project_id=?',o.project)).version_id,o.version);assert.equal((await row('SELECT status FROM publication_actions WHERE id=?',r.input.id)).status,'pending');
 });
 assert.equal(network,0);assert.equal((await row('SELECT count(*) n FROM inference_calls')).n,0);
 console.log(`Website safety: ${cases} scenarios passed (${process.argv.includes('--d1')?'local D1':'SQLite'}): strict owned reads, first-project admission, exact reviews, current identity, replay/concurrency, expiry/drift, paginated recovery, no Chat/provider/inference dependency.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
