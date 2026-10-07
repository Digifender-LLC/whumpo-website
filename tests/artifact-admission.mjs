// WH-014 benign local verification of the single fail-closed artifact gate (src/artifact-admission.ts and the
// artifact_screening_holds view/triggers). Synthetic source, synthetic required decisions and a fake runtime only.
// This proves recorded-hold denial at each final write; it is not detector or scanner acceptance.
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,enableFixtureVisitorAccess,createFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,{worker:platform}=m;
const {saveBackend,testBackend}=m.backend,{backendAction}=m.backendChat,{quarantineBackendImport}=m.backendImports;
const {prepareBackendPublication,confirmBackendPublication,publicBackend}=m.backendPublication;
const {prepareApplication,confirmApplication,readApplication}=m.appActivation,{issueAppSession,transitionAppData}=m.appData;
const {prepareNomination,consentNomination,withdrawNomination}=m.backendNominations;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),held=e=>e.status===423&&/held for safety review/.test(e.message);
let calls=0,checks=0;const check=async(label,fn)=>{try{await fn();checks++;}catch(error){error.message=label+': '+error.message;throw error;}};
const runtime={fetch:async(_url,init)=>{calls++;const body=JSON.parse(init.body);const input=body.input;return Response.json({ok:true,value:input&&typeof input==='object'&&'state'in input?{state:input.state,result:null}:input});}};
// A required decision under a retired policy version: a policy change never releases it.
const hold=(user,digest,kind='generated_artifact')=>db.prepare("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,?,?,'synthetic-retired-policy',1,1,'risk_or_missing_history',100,60)").bind(user,kind,digest).run();
async function account(){const authority=await workspaceFixture(db,m),user=authority.account,project=id(),scope=await authority.scope();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Artifact fixture','','draft',?,?)").bind(project,user,now(),now()).run();return {authority,user,project,scope};}
async function version(a,source){const v=id(),run=id();const saved=await saveBackend(a.scope,a.user,a.project,v,source);await testBackend(a.scope,runtime,a.user,a.project,v,run,{state:{},input:{}});return {v,run,digest:saved.digest};}
const publicCall=a=>publicBackend(new Request(`https://${a.project}.whumpo.site/backend`,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'198.18.0.'+(1+checks)},body:'{"state":{},"input":{}}'}),db,runtime,a.project);
// Run a hook immediately before one statement executes, to model a hold recorded concurrently with a final write.
const racing=(prefix,before)=>interceptDatabase(db,{test:q=>q.startsWith(prefix)},before);
try{
 const a=await account(),b=await account();
 await check('pasted or regenerated source with quarantined import bytes cannot become a runnable version on any writer',async()=>{
  const source='export default input => input; // SYNTHETIC_QUARANTINED_IMPORT';
  const imported=await quarantineBackendImport(a.scope,a.user,a.project,id(),source);assert.equal(imported.usable,false);
  await assert.rejects(backendAction(a.scope,a.user,id(),{kind:'backend',operation:'create',projectId:a.project,source}),held);
  await assert.rejects(saveBackend(a.scope,a.user,a.project,id(),source),e=>e.status===409);
  await assert.rejects(db.prepare('INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,?,?,?)').bind(id(),a.project,source,imported.digest,now()).run(),/artifact_held/);
  // Another owner's quarantine does not hold unrelated tenants' identical bytes, and nothing executed.
  const other=await saveBackend(b.scope,b.user,b.project,id(),source);assert.equal(other.digest,imported.digest);
  assert.equal(Number((await db.prepare('SELECT count(*) n FROM backend_versions WHERE digest=? AND project_id=?').bind(imported.digest,a.project).first()).n),0);
 });
 const live=await version(a,'export default input => input; // SYNTHETIC_LIVE_PROGRAM'),pub=id();
 await prepareBackendPublication(a.scope,a.user,a.project,pub,'publish',live.v,live.run);await confirmBackendPublication(a.scope,a.user,pub);
 const pendingPublish=id(),pendingSource=await version(a,'export default input => input; // SYNTHETIC_PENDING_PROGRAM');
 assert.equal((await publicCall(a)).status,200);
 await check('a supplemental not-required decision is not a hold; a later escalation holds every execution and publication path',async()=>{
  await db.prepare("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-current-policy',0,0,'not_sampled',5,10)").bind(a.user,live.digest).run();
  assert.equal((await publicCall(a)).status,200);
  await db.prepare("UPDATE content_screening_decisions SET required=1,escalation_reason='risk_or_missing_history',escalated_at=? WHERE user_id=? AND digest=?").bind(now(),a.user,live.digest).run();
  const before=calls;
  assert.equal((await publicCall(a)).status,404);
  const reply=(await backendAction(a.scope,a.user,id(),{kind:'backend',operation:'check',versionId:live.v,input:{state:{},input:{}},expected:{state:{},result:null}},runtime)).reply;assert.match(reply,/held for safety review/);
  const http=await platform.fetch(new Request(`https://whumpo.com/api/projects/${a.project}/backends/${live.v}/test`,{method:'POST',headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+a.authority.token,'content-type':'application/json'},body:JSON.stringify({id:id(),input:{}})}),{...store.env,DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:runtime},{});
  assert.equal(http.status,423);
  // The raw tester is still refused by the backend_runs trigger at reservation.
  await assert.rejects(testBackend(a.scope,runtime,a.user,a.project,live.v,id(),{}));
  await assert.rejects(prepareBackendPublication(a.scope,a.user,a.project,id(),'publish',live.v,live.run),held);
  assert.equal(calls,before,'no held program executed');
  // Critical withdrawal stays available.
  const off=id();await prepareBackendPublication(a.scope,a.user,a.project,off,'unpublish',live.v,null);assert.equal((await confirmBackendPublication(a.scope,a.user,off)).status,'applied');
  assert.equal(Number((await db.prepare("SELECT count(*) n FROM content_screening_decisions WHERE digest=? AND required=1").bind(live.digest).first()).n),1);
  await assert.rejects(db.prepare('UPDATE content_screening_decisions SET required=0 WHERE digest=?').bind(live.digest).run(),/content_screening_immutable/);
 });
 await check('a hold recorded concurrently with publication confirmation wins at commit',async()=>{
  await prepareBackendPublication(a.scope,a.user,a.project,pendingPublish,'publish',pendingSource.v,pendingSource.run);
  const raced=racing("UPDATE backend_publication_reviews SET status='applied'",()=>hold(a.user,pendingSource.digest));
  await assert.rejects(confirmBackendPublication(await a.authority.scope(raced),a.user,pendingPublish),held);
  assert.equal((await db.prepare('SELECT status FROM backend_publication_reviews WHERE id=?').bind(pendingPublish).first()).status,'pending');
  assert.equal((await publicCall(a)).status,404);
 });
 const c=await account();await enableFixtureVisitorAccess(c.scope,c.user,c.project);
 const program=await version(c,'export default ({state}) => ({state,result:null}); // SYNTHETIC_APP'),enable=id();
 await prepareApplication(c.scope,c.user,c.project,enable,'enable',program.v,program.run);await confirmApplication(c.scope,c.user,enable);
 const visitor=id();await db.prepare("INSERT INTO app_visitors(id,project_id,access_id) SELECT ?,?,id FROM module_instances WHERE project_id=? AND kind='access'").bind(visitor,c.project,c.project).run();
 const token=await issueAppSession(db,visitor);assert.equal((await transitionAppData(db,runtime,token,c.project,id(),0,{})).state,'complete');
 const second=await version(c,'export default ({state}) => ({state,result:null}); // SYNTHETIC_SECOND'),pendingEnable=id();
 await check('an application program held after activation stops visitor execution; held programs cannot be authorized or nominated',async()=>{
  await hold(c.user,program.digest);const before=calls;
  await assert.rejects(transitionAppData(db,runtime,token,c.project,id(),1,{}),e=>e.status===503);assert.equal(calls,before);
  await assert.rejects(db.prepare("INSERT INTO app_runs(id,visitor_id,project_id,version_id,session_hash,request_hash,base_revision,program_revision) VALUES(?,?,?,?,?,?,1,1)").bind(id(),visitor,c.project,program.v,'a'.repeat(64),'b'.repeat(64)).run(),/artifact_held/);
  await assert.rejects(prepareApplication(c.scope,c.user,c.project,id(),'enable',program.v,program.run),held);
  await assert.rejects(prepareNomination(c.scope,c.user,id(),program.v),held);
  const off=id();await prepareApplication(c.scope,c.user,c.project,off,'disable',null,null);await confirmApplication(c.scope,c.user,off);
  assert.equal((await readApplication(c.scope,c.user,c.project)).configuration.enabled,0);
 });
 await check('reviews prepared before a hold cannot be confirmed afterwards (application activation and nomination consent)',async()=>{
  await prepareApplication(c.scope,c.user,c.project,pendingEnable,'enable',second.v,second.run);
  const nomination=id();await prepareNomination(c.scope,c.user,nomination,second.v);
  await hold(c.user,second.digest,'imported_code');
  await assert.rejects(confirmApplication(c.scope,c.user,pendingEnable),held);
  await assert.rejects(consentNomination(c.scope,c.user,nomination,'NOMINATE'),held);
  await assert.rejects(db.prepare("UPDATE app_activation_reviews SET status='applied' WHERE id=?").bind(pendingEnable).run(),/artifact_held/);
  assert.equal((await withdrawNomination(c.scope,c.user,nomination)).state,'withdrawn');
  assert.equal((await readApplication(c.scope,c.user,c.project)).configuration.enabled,0);
 });
 await check('held versions disappear from live application pages and website forms views',async()=>{
  assert.equal(Number((await db.prepare('SELECT count(*) n FROM held_backend_versions WHERE id IN (?,?,?)').bind(program.v,second.v,live.v).first()).n),3);
  assert.equal(await db.prepare('SELECT 1 FROM app_live_pages WHERE project_id=?').bind(c.project).first(),null);
 });
 await check('migration checks cannot target or transform with a held program (SQL final write)',async()=>{
  await assert.rejects(db.prepare("INSERT INTO app_migration_checks(id,user_id,project_id,from_version,to_version,transform_version,test_id,base_revision,roster_json) VALUES(?,?,?,?,?,?,?,1,'[]')").bind(id(),c.user,c.project,program.v,second.v,second.v,second.run).run(),/artifact_held/);
 });
 await check('generated website versions are held by their exact rendered HTML digest at publication',async()=>{
  const d=await account();await createFixtureWebsite(d.scope,d.user,d.project,{name:'Synthetic bakery',headline:'Synthetic bakery',description:'Benign fixture',theme:'ocean',aboutTitle:'About',aboutText:'Synthetic text',sections:[],photos:[]});
  const site=await db.prepare('SELECT id,digest FROM site_versions WHERE project_id=?').bind(d.project).first();
  assert.equal(await db.prepare('SELECT 1 FROM project_spec_held WHERE version_id=?').bind(site.id).first(),null);
  await hold(d.user,site.digest);
  assert.ok(await db.prepare('SELECT 1 FROM project_spec_held WHERE version_id=?').bind(site.id).first());
  await assert.rejects(db.prepare('INSERT INTO publications(project_id,revision,version_id) VALUES(?,1,?)').bind(d.project,site.id).run(),/specification_held/);
 });
 console.log(`Artifact admission passed (${checks} checks): quarantined-import laundering refused on Chat, direct and SQL writers; supplemental not-required decisions are not holds; escalation and retired-policy holds deny owner tests (Chat/HTTP/raw), publication, public execution, visitor execution, activation, nomination, migration and website publication; concurrent holds win at commit; withdrawal, disable and unpublish stay available; decisions cannot be lowered. Synthetic local fixtures only.`);
}finally{await store.close();}
