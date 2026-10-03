import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
const modules=await currentFixtureModules(['src/index.ts','src/workspace-layout.ts','src/workspace-view-bindings.ts','src/workspace-view-data.ts','src/chat-interactions/store.ts','src/chat-interactions/view-cards.ts','src/project-specification/store.ts']);
const [worker,layout,bindings,shape,interactions,cards,site]=await Promise.all(['src/index.ts','src/workspace-layout.ts','src/workspace-view-bindings.ts','src/workspace-view-data.ts','src/chat-interactions/store.ts','src/chat-interactions/view-cards.ts','src/project-specification/store.ts'].map(p=>modules.module(p)));
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID(),run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
let cases=0,network=0;const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Unexpected provider or inference');};
const test=async(name,fn)=>{try{await fn();cases++;}catch(error){console.error(name);throw error;}};
async function origin(o,text='Review the website'){
 const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,?,'Pending',datetime('now'),'ai','pending' FROM workspace_state WHERE user_id=?",turn,text,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);return turn;
}
async function commit(o,turn,prepared){await o.scope.batch([...prepared.statements,o.scope.prepare("UPDATE chat_turns SET status='completed',assistant_text=? WHERE id=?").bind(prepared.reply??'Overview',turn)]);}
async function owner(name='Garden'){
 const authority=await workspaceFixture(db,modules.identity),o={authority,user:authority.account,scope:await authority.scope(),project:id(),readGrant:id()};
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",o.user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,'PRIVATE_PURPOSE_CANARY','draft',datetime('now'),datetime('now'))",o.project,o.user,name);
 for(const project of [null,o.project])for(const operation of ['read','prepare'])await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing',?,'private-test-acceptance','synthetic review view',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",project&&operation==='read'?o.readGrant:id(),o.user,project,operation);
 const turn=await origin(o);await commit(o,turn,await site.createWebsite(o.scope,o.user,turn,o.project,{name,headline:'Neighborhood gardens',description:'Local garden care',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[],photos:[]}));
 await layout.mutateLayout(o.scope,o.user,{version:1,requestId:id(),expectedRevision:0,operation:'createPage',page:{id:'tab-reviews',label:'Website reviews',view:view(o.project)}});
 await layout.mutateLayout(o.scope,o.user,{version:1,requestId:id(),expectedRevision:1,operation:'setDashboard',view:view(null)});
 return o;
}
const view=projectId=>({version:1,projectId,widgets:['reviews'],shortcuts:[]});
async function review(o,text='Garden change'){
 const turn=await origin(o),prepared=await site.prepareSpecification(o.scope,o.user,turn,{kind:'specification',operation:'change',projectId:o.project,expectedRevision:1,operations:[{type:'content.replace',contentId:'headline',text}]});await commit(o,turn,prepared);return turn;
}
async function temporary(o){const turn=await origin(o),plan=await interactions.prepareWorkspaceView(o.scope,o.user,{originTurnId:turn,view:view(o.project)});await commit(o,turn,plan);return interactions.readInteraction(o.scope,o.user,plan.interactionId);}
const input=(pageId='tab-reviews')=>({version:1,pageId,revision:2,kind:'reviews'});
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
async function http(o,path,data,status=200){const r=await worker.default.fetch(new Request('https://whumpo.com/api/'+path,{method:data?'POST':'GET',headers:{origin:'https://whumpo.com','content-type':'application/json',...(o?{cookie:'__Host-whumpo_session='+o.authority.token}:{})},...(data?{body:JSON.stringify(data)}:{})}),env,{waitUntil(){throw Error('Unexpected background effect');}}),body=await r.json();assert.equal(r.status,status,JSON.stringify(body));return body;}
const read=(o,pageId='tab-reviews',scope=o.scope)=>bindings.readSavedViewComponent(scope,o.user,input(pageId));
try{
 await test('Chat and saved pages share exact owned review identities without copied comparison bytes',async()=>{
  const o=await owner(),r=await review(o,'<script>REVIEW_TEXT_CANARY()</script>'),f=await temporary(o);
  const saved=await http(o,'workspace/views/v1/component',input()),inline=await http(o,'chat/interactions/v1/view-component',{version:1,interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,kind:'reviews'});
  assert.equal(saved.status,'ready');assert.equal(saved.binding,'workspace.reviews@1');assert.deepEqual(saved.data,inline.data);assert(shape.readViewComponentData(saved));
  const comparison=await http(o,'specification-reviews/'+r+'/details');assert.deepEqual(saved.data.items,[{review:comparison.review,project:comparison.project,operation:comparison.operation,expiresAt:comparison.expiresAt}]);
  assert(comparison.changes[0].after.includes('REVIEW_TEXT_CANARY'));assert.doesNotMatch(JSON.stringify(saved),/REVIEW_TEXT_CANARY|PRIVATE_PURPOSE_CANARY|approve|html|url|credential/);
 });
 await test('bounded account/project queues exclude foreign owners and show at most five recent reviews',async()=>{
  const a=await owner(),b=await owner('FOREIGN_NAME_CANARY');await review(b,'Foreign');const ids=[];for(let n=0;n<7;n++)ids.push(await review(a,'Change '+n));
  const v=await read(a,'dashboard');assert.equal(v.status,'ready');assert.deepEqual(v.data.items.map(i=>i.review.id),ids.slice(-5).reverse());assert(!JSON.stringify(v).includes('FOREIGN_NAME_CANARY'));assert.equal((await read(b)).data.items.length,1);
  assert.equal((await row('SELECT count(*) n FROM project_spec_proposals WHERE user_id=?',a.user)).n,7,'Reading may not prune history');
 });
 await test('project denial removes names from account queue and denies the scoped component',async()=>{
  const o=await owner('DENIED_NAME_CANARY');await review(o);await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.readGrant);
  const account=await read(o,'dashboard');assert.equal(account.status,'ready');assert.deepEqual(account.data,{items:[],denied:1,unavailable:0});assert(!JSON.stringify(account).includes('DENIED_NAME_CANARY'));
  const project=await read(o);assert.equal(project.status,'denied');assert.equal(project.data,null);
 });
 await test('safety holds and stale proposals stay visibly unavailable and never expose comparisons',async()=>{
  const o=await owner(),r=await review(o),q=await site.readSpecificationProposal(o.scope,o.user,r);
  await run("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-policy',1,1,'risk_or_missing_history',100,60)",o.user,q.spec_digest);
  const held=await read(o);assert.deepEqual(held.data,{items:[],denied:0,unavailable:1});await http(o,'specification-reviews/'+r+'/details',null,423);
  const a=await owner(),old=await review(a);await run('UPDATE projects SET site_draft_revision=site_draft_revision+1 WHERE id=?',a.project);assert.equal((await read(a)).data.unavailable,1);await http(a,'specification-reviews/'+old+'/details',null,409);
 });
 await test('late review deletion, feature loss and ownership transfer remove ready facts',async()=>{
  for(const loss of ['review','feature','project']){
   const o=await owner('LATE_NAME_CANARY'),b=await owner(),r=await review(o);let hit=false;
   const scoped=await o.authority.scope(interceptDatabase(db,/^SELECT q\.\* FROM project_spec_proposals /,async()=>{},async()=>{if(hit)return;hit=true;if(loss==='review')await run('DELETE FROM project_spec_proposals WHERE id=?',r);else if(loss==='feature')await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.readGrant);else await run('UPDATE projects SET owner_user_id=? WHERE id=?',b.user,o.project);}));
   const v=await read(o,'dashboard',scoped);assert(hit);assert(!JSON.stringify(v).includes('LATE_NAME_CANARY'));assert(!v.data?.items?.length);
  }
 });
 await test('page changes or temporary dismissal during review reads invalidate the containing view',async()=>{
  const o=await owner();await review(o);let changed=false;
  const scoped=await o.authority.scope(interceptDatabase(db,/^SELECT q\.\* FROM project_spec_proposals /,async()=>{},async()=>{if(!changed){changed=true;await layout.mutateLayout(o.scope,o.user,{version:1,requestId:id(),expectedRevision:2,operation:'removePage',pageId:'tab-reviews'});}}));
  await assert.rejects(()=>read(o,'tab-reviews',scoped),e=>e.code==='workspace_layout_changed');assert(changed);
  const a=await owner();await review(a);const f=await temporary(a);let dismissed=false;
  const late=await a.authority.scope(interceptDatabase(db,/^SELECT q\.\* FROM project_spec_proposals /,async()=>{},async()=>{if(!dismissed){dismissed=true;await interactions.mutateInteraction(a.scope,a.user,{version:1,requestId:id(),interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:0,operation:'cancel'});}}));
  await assert.rejects(()=>cards.readTemporaryViewComponent(late,a.user,{version:1,interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,kind:'reviews'}),e=>e.code==='draft_removed');
 });
 await test('expired review validation removes candidate facts and read outage is not an empty queue',async()=>{
  const o=await owner();await review(o);const RealDate=globalThis.Date;
  globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[RealDate.now()+601000]));}static now(){return RealDate.now()+601000;}};
  try{const v=await read(o);assert.equal(v.status,'ready');assert.deepEqual(v.data,{items:[],denied:0,unavailable:1});}finally{globalThis.Date=RealDate;}
  const scoped=await o.authority.scope(interceptDatabase(db,/^SELECT q\.id FROM project_spec_proposals /,async()=>{throw Error('Synthetic queue outage');}));const v=await read(o,'tab-reviews',scoped);assert.equal(v.status,'unavailable');assert.equal(v.data,null);assert.equal((await read(o)).data.items.length,1);
 });
 await test('closed client data refuses authority, scope, stale versions, extra and expired facts',async()=>{
  const o=await owner();await review(o);const v=await read(o);assert(shape.readViewComponentData(v));
  for(const change of [x=>x.data.items[0].approve=true,x=>x.data.items[0].review.url='https://foreign.test',x=>x.data.items[0].project.id=id(),x=>x.data.items[0].expiresAt=x.asOf,x=>x.version=0,x=>x.data.items.push(x.data.items[0]),x=>x.data.denied=-1,x=>x.data.unavailable=6]){const x=structuredClone(v);change(x);assert.equal(shape.readViewComponentData(x),null);}
  await http(null,'workspace/views/v1/component',input(),401);await http(o,'workspace/views/v1/component',{...input(),reviewId:id()},400);
 });
 await test('read and detail paths preserve domain state with maintainer inference unavailable',async()=>{
  const o=await owner(),r=await review(o),before={versions:await row('SELECT count(*) n FROM site_versions'),applies:await row('SELECT count(*) n FROM project_spec_applies'),layout:await layout.readLayout(o.scope,o.user)};
  for(let n=0;n<2;n++){await read(o);await http(o,'specification-reviews/'+r+'/details');}
  assert.deepEqual(await row('SELECT count(*) n FROM site_versions'),before.versions);assert.deepEqual(await row('SELECT count(*) n FROM project_spec_applies'),before.applies);assert.deepEqual(await layout.readLayout(o.scope,o.user),before.layout);
  for(const table of ['inference_calls','standard_ai_requests','publications'])assert.equal((await row('SELECT count(*) n FROM '+table)).n,0);
 });
 assert.equal(network,0);console.log(`Workspace review bindings: ${cases} cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; same exact review authority, bounded owned queue, per-project denial, holds/expiry/stale/late changes, closed facts and zero effects/inference. No scanner or CMS functional tests.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
