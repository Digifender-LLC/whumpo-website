import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/index.ts','src/project-specification/store.ts','src/project-specification/review-display.ts']);
const worker=(await modules.module('src/index.ts')).default,store=await modules.module('src/project-specification/store.ts'),shape=await modules.module('src/project-specification/review-display.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();let cases=0,network=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Unexpected provider request');};
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
async function test(name,fn){try{await fn();cases++;}catch(error){console.error(name,error);throw error;}}
async function owner(){
 const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),project=id(),grant=id();
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','PRIVATE_PURPOSE_CANARY','draft',datetime('now'),datetime('now'))",project,user);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','read','private-test-acceptance','synthetic comparison fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",grant,user,project);
 const turn=id(),prepared=await store.createWebsite(scope,user,turn,project,{name:'Garden',headline:'Neighborhood gardens',description:'Local gardening',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[{heading:'Services',text:'Garden care.'}],photos:[]});
 await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Create a site',?,datetime('now'),'ai','pending')").bind(turn,user,prepared.reply),...prepared.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),scope.prepare('UPDATE workspace_state SET revision=1 WHERE user_id=?').bind(user)]);
 return {authority,user,scope,project,grant};
}
async function review(o,operations=[{type:'content.replace',contentId:'headline',text:'<script>comparisonCanary()</script>'},{type:'pages.setSections',pageId:'home',sections:[]}]){
 const turn=id(),revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user)).revision+1;
 const prepared=await store.prepareSpecification(o.scope,o.user,turn,{kind:'specification',operation:'change',projectId:o.project,expectedRevision:1,operations});
 await o.scope.batch([o.scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Change the page',?,datetime('now'),'ai','pending')").bind(turn,o.user,revision,prepared.reply),...prepared.statements,o.scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),o.scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,o.user)]);
 return turn;
}
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){}};
async function http(o,reviewId,status=200,suffix='details'){
 const response=await worker.fetch(new Request('https://whumpo.com/api/specification-reviews/'+reviewId+'/'+suffix,{headers:o?{cookie:'__Host-whumpo_session='+o.authority.token}:{}}),env,ctx);
 assert.equal(response.status,status,await response.clone().text());return response;
}
try{
 const a=await owner(),b=await owner(),r=await review(a);
 await test('private actual HTTP returns the exact owned review comparison without mutations',async()=>{
  const before=await row('SELECT revision FROM workspace_state WHERE user_id=?',a.user),count=await row('SELECT count(*) n FROM site_versions WHERE project_id=?',a.project);
  const response=await http(a,r),display=await response.json(),proposal=await store.readSpecificationProposal(a.scope,a.user,r);
  assert.match(response.headers.get('cache-control'),/no-store/);assert(shape.readSpecificationReviewDisplay(display));
  assert.deepEqual(display.review,{id:r,proposalDigest:proposal.proposal_digest,expectedRevision:1});assert.deepEqual(display.project,{id:a.project,name:'Garden'});assert.deepEqual(display.changes,JSON.parse(proposal.diff_json));assert.equal(display.changes.length,3);
  assert.equal(display.changes[0].before,'Neighborhood gardens');assert.equal(display.changes[0].after,'<script>comparisonCanary()</script>');assert.equal(display.changes[1].after,null);
  assert.doesNotMatch(JSON.stringify(display),/PRIVATE_PURPOSE_CANARY|html_digest|request_hash|credential|approve|https:/);
  assert.deepEqual(await row('SELECT revision FROM workspace_state WHERE user_id=?',a.user),before);assert.deepEqual(await row('SELECT count(*) n FROM site_versions WHERE project_id=?',a.project),count);
 });
 await test('existing protected comparison and preview still use the same review',async()=>{
  for(const suffix of ['preview','diff']){const res=await http(a,r,200,suffix);assert.match(res.headers.get('content-security-policy'),/sandbox;/);assert.match(res.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await res.text(),/&lt;script&gt;comparisonCanary/);}
 });
 await test('a proposed site rename does not relabel the owned target project',async()=>{
  const o=await owner(),r=await review(o,[{type:'project.setName',name:'Proposed site name'}]),display=await(await http(o,r)).json();
  assert.equal(display.project.name,'Garden');assert.deepEqual(display.changes,[{label:'Site name',before:'Garden',after:'Proposed site name'}]);
 });
 await test('unauthenticated, foreign, unknown and nonexact requests are refused',async()=>{
  await http(null,r,401);await http(b,r,404);await http(a,id(),404);await http(a,r,400,'details?arbitrary=true');
 });
 await test('expired reviews cannot return comparison facts',async()=>{
  const RealDate=globalThis.Date;globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[RealDate.now()+601000]));}static now(){return RealDate.now()+601000;}};
  try{await assert.rejects(()=>store.specificationReviewDetails(a.scope,a.user,r),e=>e.status===409);}finally{globalThis.Date=RealDate;}
 });
 await test('revoked read grants return no comparison data',async()=>{
  const o=await owner(),r=await review(o);await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.grant);const res=await http(o,r,403);assert(!await res.text().then(t=>t.includes('comparisonCanary')));
 });
 await test('late removal, transfer, eligibility and session loss fence the result',async()=>{
  for(const loss of ['remove','transfer','grant','session']){
   const o=await owner(),r=await review(o);let reads=0,changed=false;
   const scoped=await o.authority.scope(interceptDatabase(db,/^SELECT q\.\* FROM project_spec_proposals /,async()=>{},async()=>{
    if(++reads!==(loss==='remove'?1:2))return;changed=true;
    if(loss==='remove')await run('DELETE FROM project_spec_proposals WHERE id=?',r);
    if(loss==='transfer')await run('UPDATE projects SET owner_user_id=? WHERE id=?',b.user,o.project);
    if(loss==='grant')await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',o.grant);
    if(loss==='session')await o.authority.revoke();
   }));
   await assert.rejects(()=>store.specificationReviewDetails(scoped,o.user,r),e=>[401,403,404,409].includes(e.status));assert(changed,loss);
  }
 });
 await test('existing safety holds block comparison reads without invoking a scanner',async()=>{
  const o=await owner(),r=await review(o),q=await store.readSpecificationProposal(o.scope,o.user,r);
  await run("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-policy',1,1,'risk_or_missing_history',100,60)",o.user,q.spec_digest);await http(o,r,423);
 });
 await test('current display rejects unknown shapes and authority or destination injection',async()=>{
  const display=await(await http(a,r)).json();
  const large={...display,changes:[{label:'One',before:'a'.repeat(16384),after:'b'.repeat(16384)},{label:'Two',before:'c'.repeat(16300),after:'d'.repeat(16300)}]};
  assert(Buffer.byteLength(JSON.stringify(large.changes))<65536);assert(Buffer.byteLength(JSON.stringify(large))>65536);assert(shape.readSpecificationReviewDisplay(large),'Identity overhead must not reject a valid bounded comparison');
  for(const mutate of [d=>d.version=0,d=>d.source='model',d=>d.url='https://foreign.test',d=>d.approval={id:r},d=>d.project.secret='canary',d=>d.review.proposalDigest='bad',d=>d.changes[0].html='<b>code</b>',d=>d.changes.push(d.changes[0]),d=>d.expiresAt=d.observedAt,d=>d.observedAt='now']){const value=structuredClone(display);mutate(value);assert.equal(shape.readSpecificationReviewDisplay(value),null);}
  assert.equal(shape.readSpecificationReviewIdentity({...display.review,approve:true}),null);
 });
 assert.equal(network,0);console.log(`Specification review details: ${cases} scenarios passed (${process.argv.includes('--d1')?'local D1':'SQLite'}); exact private comparison, protected preview, ownership/expiry/feature/safety/late-session checks and no mutations or inference. No scanner or deployment.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
