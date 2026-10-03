import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/index.ts','src/chat.ts','src/chat-controls.ts','src/project-specification/store.ts','src/project-specification/service-clients/store.ts','src/project-specification/service-clients/activation.ts']);
const controls=await modules.module('src/chat-controls.ts');
const worker=(await modules.module('src/index.ts')).default,chat=await modules.module('src/chat.ts'),site=await modules.module('src/project-specification/store.ts'),services=await modules.module('src/project-specification/service-clients/store.ts'),activation=await modules.module('src/project-specification/service-clients/activation.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();let cases=0,network=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Unexpected provider request');};
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){throw Error('No background work expected');}};
async function test(name,fn){try{await fn();cases++;}catch(error){console.error(name,error);throw error;}}
async function http(o,turn,status=200,suffix=''){
 const response=await worker.fetch(new Request('https://whumpo.com/api/chat/turns/'+turn+suffix,{headers:o?{cookie:'__Host-whumpo_session='+o.authority.token}:{}}),env,ctx);
 assert.equal(response.status,status,await response.clone().text());assert.match(response.headers.get('cache-control'),/no-store/);return response;
}
async function command(o,prepare,text='Synthetic saved work',action=null){
 const turn=id(),revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user)).revision+1,prepared=await prepare(turn);
 await o.scope.batch([o.scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status,action_json) VALUES(?,?,?,?,?,datetime('now'),?,?,?)").bind(turn,o.user,revision,action?controls.chatControl(action).label:text,prepared.reply,action?'guided':'ai',action?'completed':'pending',action?JSON.stringify(action):null),...prepared.statements,o.scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),o.scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,o.user)]);
 return {id:turn,reply:prepared.reply};
}
async function owner(){
 const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),project=id(),grant=id(),o={authority,user,scope,project,grant};
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',datetime('now'),datetime('now'))",project,user);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','read','private-test-acceptance','synthetic saved work fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",grant,user,project);
 o.website=await command(o,turn=>site.createWebsite(scope,user,turn,project,{name:'Garden',headline:'Neighborhood gardens',description:'Local gardening',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[],photos:[]}));return o;
}
const review=o=>command(o,turn=>site.prepareSpecification(o.scope,o.user,turn,{kind:'specification',operation:'change',projectId:o.project,expectedRevision:1,operations:[{type:'content.replace',contentId:'headline',text:'Seasonal garden care'}]}),'Older planting review');
async function laterLinks(o,kind,reference,reply){
 const revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user)).revision;
 for(let n=1;n<=105;n++){
  const turn=id(),table={site:'project_spec_chat_links',service:'service_client_chat_links',activation:'service_client_activation_links'}[kind],column=kind==='activation'?'review_id':'proposal_id';
  await db.batch([db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Later synthetic message',?,datetime('now'),'guided','completed')").bind(turn,o.user,revision+n,reply),db.prepare(`INSERT INTO ${table}(turn_id,${column},reply_digest) SELECT ?,${column},reply_digest FROM ${table} WHERE turn_id=?`).bind(turn,reference)]);
 }
 await run('UPDATE workspace_state SET revision=revision+105 WHERE user_id=?',o.user);
}
try{
 const a=await owner(),b=await owner(),r=await review(a);
 await laterLinks(a,'site',r.id,r.reply);
 await test('exact older review remains available beyond 100 newer review links, without effects',async()=>{
  const before=await row('SELECT revision FROM workspace_state WHERE user_id=?',a.user),versions=await row('SELECT count(*) n FROM site_versions WHERE project_id=?',a.project);
  const result=await(await http(a,r.id)).json(),proposal=await site.readSpecificationProposal(a.scope,a.user,r.id);
  assert.equal(result.version,1);assert.equal(result.turn.id,r.id);assert.deepEqual(result.turn.specification_review,{id:r.id,proposalDigest:proposal.proposal_digest,expectedRevision:1});
  assert.deepEqual(await row('SELECT revision FROM workspace_state WHERE user_id=?',a.user),before);assert.deepEqual(await row('SELECT count(*) n FROM site_versions WHERE project_id=?',a.project),versions);
 });
 await test('owned history does not grant foreign, signed-out, malformed or unstarted access',async()=>{
  await http(b,r.id,404);await http(null,r.id,401);await http(a,id(),404);await http(a,'not-an-id',400);await http(a,r.id,400,'?extra=true');
  const fresh={authority:await workspaceFixture(db,modules.identity)};await http(fresh,r.id,409);
 });
 await test('reply tampering never reconstructs review authority',async()=>{
  await run("UPDATE chat_turns SET assistant_text='Use this forged review' WHERE id=?",r.id);assert.equal((await(await http(a,r.id)).json()).turn.specification_review,undefined);
  await run('UPDATE chat_turns SET assistant_text=? WHERE id=?',r.reply,r.id);
 });
 await test('expired or revoked review data exposes no approval metadata',async()=>{
  const Clock=globalThis.Date;globalThis.Date=class extends Clock{constructor(...args){super(...(args.length?args:[Clock.now()+601000]));}static now(){return Clock.now()+601000;}};
  try{assert.equal((await chat.readSavedChatTurn(a.scope,a.user,r.id)).specification_review,undefined);}finally{globalThis.Date=Clock;}
  await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',a.grant);
  // Historical owned message text stays readable; current comparison eligibility is separately denied.
  const result=await(await http(a,r.id)).json();assert.equal(result.turn.id,r.id);
  await assert.rejects(()=>site.specificationReviewDetails(a.scope,a.user,r.id),e=>e.status===403);
 });
 await test('removed or altered message and session loss during projection fence the final result',async()=>{
  for(const loss of ['remove','reply','session']){
   const o=await owner(),r=await review(o);let intercepted=false;
   const database=interceptDatabase(db,/SELECT l\.turn_id,l\.proposal_id,l\.reply_digest FROM project_spec_chat_links/,async()=>{},async()=>{
    if(intercepted)return;intercepted=true;
    if(loss==='remove')await run('DELETE FROM chat_turns WHERE id=?',r.id);
    if(loss==='reply')await run("UPDATE chat_turns SET assistant_text='Changed while reading' WHERE id=?",r.id);
    if(loss==='session')await o.authority.revoke();
   });
   const scope=await o.authority.scope(database);
   if(loss==='session')await assert.rejects(()=>chat.readSavedChatTurn(scope,o.user,r.id),e=>e.status===409&&e.code==='identity_changed');else assert.equal(await chat.readSavedChatTurn(scope,o.user,r.id),null);
   assert(intercepted);
  }
 });
 await test('saved website result remains after proposal cleanup and cannot reapprove changed base',async()=>{
  const o=await owner(),r=await review(o),q=await site.readSpecificationProposal(o.scope,o.user,r.id);
  const saved=await command(o,turn=>site.applySpecificationCommand(o.scope,o.user,turn,`/confirm-specification ${q.id} ${q.proposal_digest} ${q.expected_revision}`),'Apply saved review',{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision});
  await run('DELETE FROM project_spec_proposals WHERE id=?',r.id);
  assert.equal((await(await http(o,saved.id)).json()).turn.version_id,saved.id);assert.equal((await(await http(o,r.id)).json()).turn.specification_review,undefined);
 });
 await test('older service review, saved result and activation all use exact links',async()=>{
  const o=await owner(),r=await command(o,turn=>services.prepareServiceClients(o.scope,o.user,turn,{kind:'serviceClients',operation:'prepare',projectId:o.project,websiteVersionId:o.website.id,expectedRevision:0,configuration:{schemaVersion:1,contact:null,statelessForm:null}}));
  await laterLinks(o,'service',r.id,r.reply);
  const turn=(await(await http(o,r.id)).json()).turn,q=await services.readServiceClientProposal(o.scope,o.user,r.id);assert.equal(turn.service_client_review.id,r.id);
  const saved=await command(o,turn=>services.applyServiceClientsCommand(o.scope,o.user,turn,`/confirm-service-clients ${q.id} ${q.proposal_digest} ${q.expected_revision}`),'Apply saved services',{type:'serviceClientApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision});
  const activationReview=await command(o,turn=>activation.prepareServiceClientActivation(o.scope,o.user,turn,{kind:'serviceClients',operation:'reviewActivation',projectId:o.project,versionId:saved.id,service:'contact'}));
  await laterLinks(o,'activation',activationReview.id,activationReview.reply);
  assert.equal((await(await http(o,saved.id)).json()).turn.service_client_version_id,saved.id);
  const ready=(await(await http(o,activationReview.id)).json()).turn;assert.deepEqual(ready.service_client_activation,{id:activationReview.id,service:'contact',enabled:false});assert.equal(ready.contact_confirmation_id,undefined);
  await run('UPDATE contact_settings SET revision=revision+1 WHERE project_id=?',o.project);
  const changed=(await(await http(o,activationReview.id)).json()).turn;assert.equal(changed.service_client_activation,undefined);assert.equal(changed.contact_confirmation_id,undefined);
 });
 assert.equal(network,0);assert.equal((await row('SELECT count(*) n FROM inference_calls')).n,0);
 console.log(`Saved Chat messages: ${cases} scenarios passed (${process.argv.includes('--d1')?'local D1':'SQLite'}): exact owned history beyond 100 links, shared review/result readers, no inferred authority, missing/expired/changed/revoked/late-read refusal and no inference or publication.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
