// WH-004 slice 3 regression: exact-review lifecycle on the platform's own reviews, through the real handlers.
// Local SQLite (default) or local D1 (`--d1`); synthetic accounts and a stub runtime service; no network.
// Closes evidence gaps recorded in docs/boundary-audit.json:
//   3. confirming an expired application-page, backend-form, module-activation or upgrade-check review is
//      refused and changes nothing (DNS, hosting, proof-removal and GitHub backup are in boundary-provider-reviews);
//   7. application-page review immutability, and a stale revision refuses an application upgrade and rollback.
// Every refusal has a negative control: an identical, unexpired review prepared from the same state is admitted
// after the refused one (so the refusal can only be explained by the property under test).
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db,id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const {backend,appActivation:activation,appPages:pages,backendForms:forms,appMigrationChecks:migration,appMigrationApproval:approvals,appProgramRollback:rollback,appDocumentRecovery:recovery}=m;
// The runtime Worker is a service binding and is not under test: this stub evaluates the reviewed source in-process.
const service={fetch:async(_url,init)=>{
 const body=JSON.parse(init.body),fn=new Function('return ('+body.source.replace(/^\s*export\s+default\s+/,'')+');')();
 return Response.json({ok:true,value:fn(body.input)});
}};
async function owner(){const a=await workspaceFixture(db,m);return {id:a.account,scope:await a.scope()};}
async function project(o,name='Lifecycle'){
 const p=id();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,'','draft',?,?)").bind(p,o.id,name,now(),now()).run();return p;
}
const scalar=async(sql,...values)=>(await db.prepare(sql).bind(...values).first()).n;
const refused=(promise,status)=>assert.rejects(promise,e=>e.status===status||(console.error('unexpected rejection',e),false));
/** Moves only the fixture clock boundary of one review row: drops its immutability trigger, sets an expiry in the
 * past and restores the trigger text immediately. The commit-time expiry guard under test is never touched. */
async function expire(table,review,trigger){
 const saved=await db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=?").bind(trigger).first();
 assert.ok(saved?.sql,'trigger '+trigger+' exists');
 await db.prepare('DROP TRIGGER '+trigger).run();
 try{await db.prepare(`UPDATE ${table} SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?`).bind(review).run();}
 finally{await db.prepare(saved.sql).run();}
 assert.ok(await db.prepare("SELECT 1 x FROM sqlite_master WHERE type='trigger' AND name=?").bind(trigger).first(),'trigger restored');
}
/** Runs `fn` with the process clock moved back so a review the real handler prepares is already expired. */
async function atPast(ms,fn){const clock=Date.now;Date.now=()=>clock()-ms;try{return await fn();}finally{Date.now=clock;}}
const a=await owner();
async function application(o,name){
 const p=await project(o,name),version=id(),test=id();
 await backend.saveBackend(o.scope,o.id,p,version,'export default ({state,input})=>({state:input,result:"saved"})');
 await backend.testBackend(o.scope,service,o.id,p,version,test,{state:{},input:{}});
 await enableFixtureVisitorAccess(o.scope,o.id,p);
 return {project:p,version,test};
}
async function toggle(o,app,enabled,version=app.version,test=app.test){
 const review=id();await activation.prepareApplication(o.scope,o.id,app.project,review,enabled?'enable':'disable',enabled?version:null,enabled?test:null);await activation.confirmApplication(o.scope,o.id,review);
}
try{
 const app=await application(a,'Pages');
 await toggle(a,app,true);
 const first={title:'First page',description:'Synthetic first page',buttonLabel:'Save',fields:[{key:'note',label:'Note',type:'text'}]};
 const second={...first,title:'Second page'};
 const live=()=>db.prepare('SELECT config_json,revision FROM app_live_pages WHERE project_id=?').bind(app.project).first();
 const settings=()=>db.prepare('SELECT revision,review_id FROM app_page_settings WHERE project_id=?').bind(app.project).first();
 const initial=id();await pages.prepareAppPage(a.scope,a.id,app.project,initial,first);await pages.confirmAppPage(a.scope,a.id,initial);
 const before={live:await live(),settings:await settings()};
 assert.equal(JSON.parse(before.live.config_json).title,'First page');

 // 3. App-page review expiry. R1 is expired and R2 is identical and unexpired, both from the same page revision.
 const r1=id(),r2=id();
 await pages.prepareAppPage(a.scope,a.id,app.project,r1,second);await pages.prepareAppPage(a.scope,a.id,app.project,r2,second);
 await expire('app_page_reviews',r1,'app_page_immutable');
 await refused(pages.confirmAppPage(a.scope,a.id,r1),409);
 assert.deepEqual({live:await live(),settings:await settings()},before,'an expired page review changed nothing');
 assert.equal((await pages.readAppPageReview(a.scope,a.id,r1)).status,'pending');
 const applied=await pages.confirmAppPage(a.scope,a.id,r2);
 assert.equal(applied.status,'applied','negative control: the unexpired review from the same revision applies');
 assert.equal(JSON.parse((await live()).config_json).title,'Second page');
 assert.equal((await settings()).revision,before.settings.revision+1);

 // 7. Application-page review immutability: a reused ID cannot carry a different form, and a stored review cannot be rewritten.
 const bound=id(),third={...first,title:'Third page'};
 const saved=await pages.prepareAppPage(a.scope,a.id,app.project,bound,third);
 assert.deepEqual(await pages.prepareAppPage(a.scope,a.id,app.project,bound,third),saved,'negative control: the same ID and form replays the same review');
 await refused(pages.prepareAppPage(a.scope,a.id,app.project,bound,{...third,title:'Rewritten page'}),409);
 await refused(pages.prepareAppPage(a.scope,a.id,app.project,bound,null),409);
 assert.deepEqual(await pages.readAppPageReview(a.scope,a.id,bound),saved,'the reused ID left the stored review unchanged');
 for(const [column,value] of [['config_json',JSON.stringify(second)],['base_revision',99],['program_revision',99],['expires_at','2099-01-01T00:00:00.000Z'],['project_id',id()]])
  await assert.rejects(db.prepare(`UPDATE app_page_reviews SET ${column}=? WHERE id=?`).bind(value,bound).run(),/app_page_immutable|FOREIGN KEY|constraint/,'direct rewrite of '+column);
 await assert.rejects(db.prepare("UPDATE app_page_reviews SET status='pending' WHERE id=?").bind(r2).run(),/app_page_immutable/,'an applied review cannot return to pending');
 assert.deepEqual(await pages.readAppPageReview(a.scope,a.id,bound),saved,'direct rewrites left the stored review unchanged');
 assert.equal(await scalar('SELECT count(*) n FROM app_page_reviews WHERE id=?',bound),1);
 console.log('Application page reviews: expiry refused with no change and the unexpired twin applies; reused IDs and direct rewrites cannot alter a stored review.');

 // 3. Backend-form review expiry (a "form off" review needs only ownership, so it isolates the expiry predicate).
 const formProject=await project(a,'Forms');
 const formSettings=()=>db.prepare('SELECT revision,review_id FROM backend_form_settings WHERE project_id=?').bind(formProject).first();
 const f1=id(),f2=id();
 await forms.prepareBackendForm(a.scope,a.id,formProject,f1,null);await forms.prepareBackendForm(a.scope,a.id,formProject,f2,null);
 const formBefore=await formSettings();
 await expire('backend_form_reviews',f1,'backend_form_immutable');
 await refused(forms.confirmBackendForm(a.scope,a.id,f1),409);
 assert.deepEqual(await formSettings(),formBefore,'an expired form review changed nothing');
 assert.equal((await forms.readBackendFormReview(a.scope,a.id,f1)).status,'pending');
 assert.equal((await forms.confirmBackendForm(a.scope,a.id,f2)).status,'applied','negative control: the unexpired twin applies');
 assert.equal((await formSettings()).revision,formBefore.revision+1);
 console.log('Backend form reviews: an expired review is refused with no change; the unexpired twin applies.');

 // 3. Module-activation review expiry. Reviews are stored with unix-second expiry ten minutes ahead and the apply
 // preflight compares it with the process clock; the committing trigger repeats the check with the database clock,
 // which this test cannot move. R1 is applied with the process clock moved past its expiry, its identical twin R2
 // at the real time. (Identity freshness is evaluated by the database clock, so it does not confound this.)
 const moduleProject=await project(a,'Modules');
 await enableFixtureVisitorAccess(a.scope,a.id,moduleProject);
 const control=async action=>{const turn=id(),revision=(await m.readChat(a.scope,a.id)).state.revision;return {turn,result:await m.sendChatControl(a.scope,a.id,{id:turn,revision,action})};};
 const moduleReview=async()=>{
  const prepared=await control({type:'moduleActivationReview',projectId:moduleProject,instanceId:'visitors',action:'disable'});
  assert.equal(prepared.result.status,200,JSON.stringify(prepared.result));
  return db.prepare('SELECT * FROM module_activation_reviews WHERE id=?').bind(prepared.turn).first();
 };
 const moduleState=()=>db.prepare("SELECT ac.state,ac.revision FROM module_activations ac JOIN module_instances i ON i.id=ac.instance_id WHERE i.project_id=? AND i.local_id='visitors'").bind(moduleProject).first();
 const moduleApply=row=>control({type:'moduleActivationApply',reviewId:row.id,reviewDigest:row.review_digest,expectedRevision:row.expected_activation_revision});
 const [expiring,twin]=[await moduleReview(),await moduleReview()];
 const moduleBefore=await moduleState();assert.equal(moduleBefore.state,'active');
 const lapsed=await atPast(-(expiring.expires_at*1000-Date.now()+1000),()=>moduleApply(expiring));
 assert.equal(lapsed.result.status,409,'a module review past its expiry is refused: '+JSON.stringify(lapsed.result));
 assert.match(lapsed.result.error,/changed or expired/);
 assert.deepEqual(await moduleState(),moduleBefore,'an expired module review changed nothing');
 assert.equal(await scalar('SELECT count(*) n FROM module_activation_applies WHERE review_id=?',expiring.id),0);
 const moduleApplied=await moduleApply(twin);
 assert.equal(moduleApplied.result.status,200,'negative control: the identical review applied before its expiry is admitted: '+JSON.stringify(moduleApplied.result));
 assert.equal((await moduleState()).state,'inactive');
 console.log('Module activation reviews: a review past its expiry is refused with no change; the identical unexpired twin disables the module.');

 // 7 and 3. Application upgrade: stale revision and expiry refuse the confirmation; a current twin is admitted.
 async function upgradeFixture(name){
  const p=await project(a,name),f={project:p,old:id(),target:id(),converter:id(),oldTest:id(),targetTest:id(),people:[id(),id()]};
  await backend.saveBackend(a.scope,a.id,p,f.old,'export default ({state,input})=>({state:input,result:"saved"})');
  await backend.testBackend(a.scope,service,a.id,p,f.old,f.oldTest,{state:{},input:{}});
  await backend.saveBackend(a.scope,a.id,p,f.target,'export default ({state,input})=>({state:{...state,note:input.note},result:"saved"})');
  await backend.testBackend(a.scope,service,a.id,p,f.target,f.targetTest,{state:{schema:2},input:{note:'synthetic'}},{expected:{state:{schema:2,note:'synthetic'},result:'saved'}});
  await backend.saveBackend(a.scope,a.id,p,f.converter,'export default ({state})=>({state:{schema:2,note:state.note}})');
  await enableFixtureVisitorAccess(a.scope,a.id,p);
  await toggle(a,{project:p},true,f.old,f.oldTest);
  for(const person of f.people){
   await db.prepare("INSERT INTO app_visitors(id,project_id,access_id) SELECT ?,?,id FROM module_instances WHERE project_id=? AND kind='access'").bind(person,p,p).run();
   await db.prepare('UPDATE app_documents SET revision=1,state_json=? WHERE visitor_id=?').bind(JSON.stringify({note:'private-'+person}),person).run();
  }
  await toggle(a,{project:p},false);
  return f;
 }
 const space=f=>db.prepare('SELECT version_id,enabled,revision,migration_id,rollback_id FROM app_spaces WHERE project_id=?').bind(f.project).first();
 const documents=async f=>(await db.prepare('SELECT visitor_id,revision,state_json FROM app_documents WHERE visitor_id IN(SELECT id FROM app_visitors WHERE project_id=?) ORDER BY visitor_id').bind(f.project).all()).results;
 async function readyCheck(f){
  const check=id();await migration.beginMigrationCheck(a.scope,a.id,f.project,check,f.target,f.converter,f.targetTest);
  let progress;for(let i=0;i<4;i++)progress=await migration.advanceMigrationCheck(a.scope,service,a.id,check);
  assert.equal(progress.state,'ready');return check;
 }
 const upgradeState=async check=>(await migration.readMigrationCheck(a.scope,a.id,check)).state;
 // Expiry: U1 expires, its twin U2 (same base state) applies.
 const e=await upgradeFixture('Upgrade expiry');
 const u1=await readyCheck(e),u2=await readyCheck(e);
 const untouched={space:await space(e),documents:await documents(e)};
 await expire('app_migration_checks',u1,'app_migration_check_immutable');
 assert.equal(await upgradeState(u1),'changed','an expired check is no longer current');
 await refused(approvals.confirmMigration(a.scope,a.id,u1,'UPGRADE'),409);
 assert.deepEqual({space:await space(e),documents:await documents(e)},untouched,'an expired upgrade review changed nothing');
 assert.equal(await scalar('SELECT count(*) n FROM app_migration_approvals WHERE id=?',u1),0);
 assert.equal((await approvals.confirmMigration(a.scope,a.id,u2,'UPGRADE')).state,'applied','negative control: the unexpired twin applies');
 assert.equal((await space(e)).version_id,e.target);
 // Stale revision: the application is reopened and closed again after the review was prepared.
 const s=await upgradeFixture('Upgrade stale');
 const u3=await readyCheck(s);
 const staleBefore={space:await space(s),documents:await documents(s)};
 await toggle(a,{project:s.project},true,s.old,s.oldTest);await toggle(a,{project:s.project},false);
 const bumped=await space(s);
 assert.equal(bumped.version_id,staleBefore.space.version_id);assert.equal(bumped.enabled,0);assert.ok(bumped.revision>staleBefore.space.revision,'the application revision moved');
 assert.equal(await upgradeState(u3),'changed','a check prepared at an older revision is no longer current');
 await refused(approvals.confirmMigration(a.scope,a.id,u3,'UPGRADE'),409);
 assert.deepEqual({space:await space(s),documents:await documents(s)},{space:bumped,documents:staleBefore.documents},'a stale upgrade review changed nothing');
 assert.equal(await scalar('SELECT count(*) n FROM app_migration_approvals WHERE id=?',u3),0);
 const u4=await readyCheck(s);
 assert.equal((await approvals.confirmMigration(a.scope,a.id,u4,'UPGRADE')).state,'applied','negative control: a review prepared at the current revision applies');
 assert.equal((await space(s)).version_id,s.target);
 console.log('Application upgrade reviews: an expired or stale-revision review is refused with no change; a current twin applies.');

 // 7. Application rollback: a stale revision refuses the confirmation. The upgraded application `s` holds the
 // pre-upgrade recovery point u4, so rolling back to it is a program-and-data restore.
 const rb1=id();await rollback.prepareProgramRollback(a.scope,a.id,s.project,u4,rb1);
 assert.equal((await rollback.readProgramRollback(a.scope,a.id,rb1)).state,'ready');
 const rollbackBefore={space:await space(s),documents:await documents(s)};
 await toggle(a,{project:s.project},true,s.target,s.targetTest);await toggle(a,{project:s.project},false);
 const moved=await space(s);
 assert.equal(moved.version_id,rollbackBefore.space.version_id);assert.ok(moved.revision>rollbackBefore.space.revision);
 assert.equal((await rollback.readProgramRollback(a.scope,a.id,rb1)).state,'changed');
 await refused(rollback.confirmProgramRollback(a.scope,a.id,rb1,'ROLLBACK'),409);
 assert.deepEqual({space:await space(s),documents:await documents(s)},{space:moved,documents:rollbackBefore.documents},'a stale rollback review changed nothing');
 assert.equal(await scalar("SELECT count(*) n FROM app_restore_reviews WHERE id=? AND status='applied'",rb1),0);
 const rb2=id();await rollback.prepareProgramRollback(a.scope,a.id,s.project,u4,rb2);
 assert.equal((await rollback.confirmProgramRollback(a.scope,a.id,rb2,'ROLLBACK')).state,'applied','negative control: a review prepared at the current revision applies');
 assert.equal((await space(s)).version_id,s.old);
 console.log('Application rollback reviews: a stale-revision review is refused with no change; a current twin restores the earlier program.');
}catch(error){console.error(String(error?.stack??error).split('\n').filter(line=>!line.includes('data:text/javascript')).join('\n'));process.exitCode=1;}
finally{await store.close?.();}
