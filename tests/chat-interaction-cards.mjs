import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/index.ts','src/chat-interactions/store.ts','src/chat-interactions/cards.ts','src/chat-interactions/card-shape.ts','src/chat-interactions/protocol.ts','src/project-specification/store.ts','src/workspace-dashboard.ts']);
const worker=(await modules.module('src/index.ts')).default,store=await modules.module('src/chat-interactions/store.ts'),cards=await modules.module('src/chat-interactions/cards.ts'),shape=await modules.module('src/chat-interactions/card-shape.ts'),protocol=await modules.module('src/chat-interactions/protocol.ts'),site=await modules.module('src/project-specification/store.ts'),dashboard=await modules.module('src/workspace-dashboard.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();let cases=0,network=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Unexpected inference/provider request');};
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
async function test(name,fn){try{await fn();cases++;}catch(error){console.error(name,error);throw error;}}
async function owner(){
 const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),project=id(),readGrant=id();
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','PRIVATE_PURPOSE_CANARY','draft',datetime('now'),datetime('now'))",project,user);
 for(const operation of ['read','prepare'])await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing',?,'private-test-acceptance','synthetic card fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",operation==='read'?readGrant:id(),user,project,operation);
 const turn=id(),prepared=await site.createWebsite(scope,user,turn,project,{name:'Garden',headline:'Neighborhood gardens',description:'Local gardening',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[],photos:[]});
 await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Create a site',?,datetime('now'),'ai','pending')").bind(turn,user,prepared.reply),...prepared.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),scope.prepare('UPDATE workspace_state SET revision=1 WHERE user_id=?').bind(user)]);
 return {authority,user,scope,project,readGrant};
}
async function origin(o){const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) SELECT ?,user_id,revision+1,'Change the headline','Review this form',datetime('now') FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);return turn;}
async function issue(o){return store.issueContentBrief(o.scope,o.user,{originTurnId:await origin(o),projectId:o.project,contentIds:['headline']});}
const input=f=>({version:1,interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,cardId:'project-status'});
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){}};
async function http(o,path,data,status=200,originValue='https://whumpo.com'){
 const r=await worker.fetch(new Request('https://whumpo.com/api/chat/interactions/v1/'+path,{method:'POST',headers:{origin:originValue,'content-type':'application/json',...(o?{cookie:'__Host-whumpo_session='+o.authority.token}:{})},body:JSON.stringify(data)}),env,ctx),body=await r.json();assert.equal(r.status,status,JSON.stringify(body));return {body,response:r};
}
const mut=f=>({version:1,requestId:id(),interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest,expectedAnswerRevision:f.answerRevision,operation:'cancel'});
try{
 const a=await owner(),b=await owner(),f=await issue(a);
 await test('maintained status binds the same project and rejects incomplete client capabilities',async()=>{
  assert.deepEqual(f.envelope.definition.cards,[{id:'project-status',binding:'project.status@1',display:'status',limit:1,reviewId:null}]);
  const client={versions:[1],fieldTypes:['text','long-text'],bindings:Object.keys(protocol.bindings)};
  await http(a,'read',{version:1,interactionId:f.envelope.id,client});
  await http(a,'read',{version:1,interactionId:f.envelope.id,client:{...client,bindings:client.bindings.filter(b=>b!=='project.status@1')}},409);
 });
 await test('actual HTTP returns only owned bounded facts without reads causing mutations',async()=>{
  const before=await row('SELECT revision FROM workspace_state WHERE user_id=?',a.user),count=await row('SELECT count(*) n FROM chat_interaction_requests WHERE user_id=?',a.user);
  const {body,response}=await http(a,'card',input(f));assert(shape.readProjectStatusCard(body));assert.match(response.headers.get('cache-control'),/no-store/);
  assert.deepEqual(body.data,{projectId:a.project,name:'Garden',state:'draft',websitePublished:false});assert.equal(body.status,'ready');assert.equal(body.source,'project_service_status');
  assert.doesNotMatch(JSON.stringify(body),/PRIVATE_PURPOSE_CANARY|answer|draft_json|billing|credential|approval|binding.*confirm/);
  assert.deepEqual(await row('SELECT revision FROM workspace_state WHERE user_id=?',a.user),before);assert.deepEqual(await row('SELECT count(*) n FROM chat_interaction_requests WHERE user_id=?',a.user),count);
  const rows=await dashboard.readProjectStatuses(a.scope,a.user);assert.equal(rows.results.length,1);assert.equal(rows.results[0].id,a.project);assert.deepEqual((await dashboard.readProjectStatuses(a.scope,a.user,b.project)).results,[]);
 });
 await test('refresh reads current saved status without fabricating publication from project text',async()=>{
  await run("UPDATE projects SET name='Updated garden',status='live' WHERE id=?",a.project);
  const {body}=await http(a,'card',input(f));assert.equal(body.data.name,'Updated garden');assert.equal(body.data.state,'draft');assert.equal(body.data.websitePublished,false);
  await run("UPDATE projects SET status='building' WHERE id=?",a.project);assert.equal((await http(a,'card',input(f))).body.data.state,'building');
 });
 await test('foreign owners, invalid origin, forged cards, digests and versions are refused',async()=>{
  await http(b,'card',input(f),404);await http(null,'card',input(f),401);await http(a,'card',input(f),403,'https://foreign.test');
  for(const [patch,status] of [[{cardId:'arbitrary'},409],[{definitionDigest:'0'.repeat(64)},409],[{version:0},409],[{binding:'workspace.projects@1'},400],[{projectId:b.project},400],[{query:'SELECT secret'},400]])await http(a,'card',{...input(f),...patch},status);
 });
 await test('missing eligibility reports denied with no retained data and leaves the form usable',async()=>{
  const o=await owner(),form=await issue(o);await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.readGrant);
  const c=(await http(o,'card',input(form))).body;assert.equal(c.status,'denied');assert.equal(c.data,null);assert(shape.readProjectStatusCard(c));assert.equal((await store.readInteraction(o.scope,o.user,form.envelope.id)).state,'open');
 });
 await test('failed domain read reports unavailable rather than an empty or unpublished result',async()=>{
  const scoped=await a.authority.scope(interceptDatabase(db,/^SELECT .* FROM project_service_status /,async()=>{throw Error('Synthetic status outage');}));
  const c=await cards.readInteractionCard(scoped,a.user,input(f));assert.equal(c.status,'unavailable');assert.equal(c.data,null);assert(shape.readProjectStatusCard(c));
 });
 await test('late eligibility loss removes fetched status from the response',async()=>{
  const o=await owner(),form=await issue(o);let revoked=false;
  const scoped=await o.authority.scope(interceptDatabase(db,/^SELECT .* FROM project_service_status /,async()=>{},async()=>{if(!revoked){revoked=true;await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.readGrant);}}));
  const c=await cards.readInteractionCard(scoped,o.user,input(form));assert(revoked);assert.equal(c.status,'denied');assert.equal(c.data,null);
 });
 await test('project transfer during a read cannot return the former owner data',async()=>{
  const o=await owner(),form=await issue(o);let moved=false;
  const scoped=await o.authority.scope(interceptDatabase(db,/^SELECT .* FROM project_service_status /,async()=>{},async()=>{if(!moved){moved=true;await run('UPDATE projects SET owner_user_id=? WHERE id=?',b.user,o.project);}}));
  await assert.rejects(()=>cards.readInteractionCard(scoped,o.user,input(form)),e=>e.status===404);assert(moved);
 });
 await test('discarded and superseded forms do not restore live card authority',async()=>{
  const o=await owner(),discarded=await issue(o);await store.mutateInteraction(o.scope,o.user,mut(discarded));await http(o,'card',input(discarded),410);
  const older=await issue(o);await store.replaceContentBrief(o.scope,o.user,{originTurnId:await origin(o),previousInteractionId:older.envelope.id,definitionDigest:older.envelope.definitionDigest,expectedAnswerRevision:older.answerRevision,contentIds:['headline']});await http(o,'card',input(older),409);
 });
 await test('current display facts reject unknown fields, invented metrics and executable destinations',async()=>{
  const c=(await http(a,'card',input(f))).body;
  for(const change of [d=>d.version=0,d=>d.approval={id:id()},d=>d.href='javascript:alert(1)',d=>d.source='model',d=>d.status='empty',d=>d.asOf='yesterday',d=>d.data.websitePublished=0,d=>d.data.state='healthy',d=>d.data.secret='canary',d=>{d.status='unavailable';}]){const value=structuredClone(c);change(value);assert.equal(shape.readProjectStatusCard(value),null);}
 });
 assert.equal(network,0);console.log(`Chat display cards: ${cases} scenarios passed (${process.argv.includes('--d1')?'local D1':'SQLite'}); actual HTTP, scoped shared project projection, current binding/client refusal, refresh, denied/unavailable states, late revocation/transfer, no effects or inference. No publication, CMS functional test or deployment.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
