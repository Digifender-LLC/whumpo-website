import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
Error.stackTraceLimit=0;
// WH-127 records and forms module. Actual handlers (visitor gateway POST /modules, the workspace-origin owner routes,
// the module engine, records handlers, commit triggers, retention expiry, Chat role reviews and activation reviews) run
// against the complete current schema in disposable SQLite, or local D1 with --d1, with two owners/projects. Every
// identity and submitted value is synthetic. No model, provider or network is used: fetch throws.
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network or inference is available');};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const {appAuth:auth,appActivation,appGateway,appLifecycle,moduleAccess,sharedModules}=m,{saveBackend,testBackend}=m.backend;
const runtime={fetch:async()=>Response.json({ok:true,value:{state:{},result:{}}})};
const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:runtime};
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const marker=n=>`VISITOR-VALUE-${n}-${id().slice(0,8)}`,markers=[];
const value=n=>{const v=marker(n);markers.push(v);return v;};
const accessInstance={id:'members',kind:'access',...pins('access'),dependencies:[],config:{roles:['staff'],enrollment:'invitation'}};
const fields=[{key:'name',label:'Name',type:'text',optional:false,read:'owner'},
 {key:'topic',label:'Topic',type:'choice',options:[{value:'repair',label:'Repair'},{value:'visit',label:'Visit'}],optional:false,read:'submitter'},
 {key:'note',label:'Note',type:'text',optional:true,read:'staff'},{key:'urgent',label:'Urgent',type:'boolean',optional:false,read:'submitter'},
 {key:'count',label:'Count',type:'number',optional:false,read:'staff'}];
const recordsInstance=(schemaFields=fields,fieldsRevision=1)=>({id:'requests',kind:'records',...pins('records'),dependencies:['members'],config:{retentionDays:30,
 schemas:[{id:'request',fieldsRevision,fields:schemaFields,staffWrite:['note','count']}],
 forms:[{id:'request-form',recordId:'request',submit:'visitor',uploadCollectionId:null},{id:'staff-form',recordId:'request',submit:'staff',uploadCollectionId:null},{id:'public-form',recordId:'request',submit:'public',uploadCollectionId:null}],
 views:[{id:'mine',recordId:'request',audience:'visitor',scope:'own',fields:['topic','urgent'],limit:2},{id:'desk',recordId:'request',audience:'staff',scope:'all',fields:['topic','note','count'],limit:50}]}});

async function owner(){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,'Repair desk '+id().slice(0,6),'Neighborhood repairs');
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-127 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,feature,operation);
 // Visitor identity is still owned by the visitor application in this slice (WH-126 remaining scope).
 const version=id(),test=id(),review=id();
 await saveBackend(scope,user,site.project,version,'export default ({state,input})=>({state:input,result:state})');
 await testBackend(scope,runtime,user,site.project,version,test,{state:{},input:{}});
 await appActivation.prepareApplication(scope,user,site.project,review,'enable',version,test);await appActivation.confirmApplication(scope,user,review);
 return {...actor,scope,user,...site,host:'https://app-'+site.project+'.whumpo.site'};
}
async function visitor(o){
 const invite=await auth.createAppInvitation(o.scope,o.user,o.project),options=await auth.appPasskeyOptions(db,o.project,'signup',false,invite.code),key=authenticator();
 const result=await auth.appPasskeyVerify(db,o.project,'signup',options.challengeToken,key.registration(options.options),false);
 return {...result,cookie:`__Host-whumpo-app-session-${o.project}=${result.session}`};
}
const revision=async o=>(await m.readChat(o.scope,o.user)).state.revision;
async function control(o,action){const turn=id();return {id:turn,...await m.sendChatControl(o.scope,o.user,{id:turn,revision:await revision(o),action})};}
async function activation(o,instanceId,action='activate'){
 const r=await control(o,{type:'moduleActivationReview',projectId:o.project,instanceId,action});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',r.id);
 const a=await control(o,{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision});assert.equal(a.status,200,a.error);
}
async function roleReview(o,visitorId,action){const r=await control(o,{type:'accessRoleReview',projectId:o.project,instanceId:'members',visitorId,action});assert.equal(r.status,200,r.error);return row('SELECT * FROM module_access_role_reviews WHERE id=?',r.id);}
const applyRole=(o,r)=>control(o,{type:'accessRoleApply',reviewId:r.id,reviewDigest:r.review_digest,expectedRevision:r.expected_access_revision});
async function setRole(o,visitorId,action){const a=await applyRole(o,await roleReview(o,visitorId,action));assert.equal(a.status,200,a.error);}
const instance=(o,localId)=>row('SELECT i.*,a.state,a.revision activation_revision FROM module_instances i JOIN module_activations a ON a.instance_id=i.id WHERE i.project_id=? AND i.local_id=?',o.project,localId);
const envelope=(resource,operation,{target=null,input=null,configRevision=resource.config_revision,requestId}={})=>({api:'whumpo-modules',version:1,operation,resourceId:resource.id,configRevision,requestId:requestId??(m.modulePolicy.moduleOperations[operation].write?id():null),target,input});
/** Visitor origin through the actual gateway with the visitor's own cookie. */
async function gateway(o,payload,v){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.9','content-type':'application/json',origin:o.host,cookie:v?.cookie??''},body:JSON.stringify(payload)}),env);
 assert.equal(response.headers.get('access-control-allow-origin'),null);
 return {status:response.status,body:await response.json()};
}
/** Workspace origin through the actual platform Worker with the owner's workspace session cookie. */
async function workspace(o,path,{method='GET',payload,cookie=`__Host-whumpo_session=${o.token}`}={}){
 const response=await m.worker.fetch(new Request('https://whumpo.com'+path,{method,headers:{cookie,origin:'https://whumpo.com',...(payload?{'content-type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined}),{...(fixture.env??{}),...env},{waitUntil(){}});
 return {status:response.status,body:await response.json()};
}
const ownerCall=(o,payload,options)=>workspace(o,`/api/projects/${o.project}/modules`,{method:'POST',payload,...options});
const submission=(records,form='request-form',values)=>envelope(records,'forms.submit',{target:{formId:form},input:{values:values??{name:value('name'),topic:'repair',note:value('note'),urgent:true,count:2}}});
const get=(records,entryId)=>envelope(records,'records.get',{target:{recordId:'request',entryId}});
const listView=(records,viewId,cursor=null)=>envelope(records,'records.view',{target:{viewId,cursor}});
const change=(records,entryId,rev,changes)=>envelope(records,'records.update',{target:{recordId:'request',entryId,revision:rev,changes}});
const removal=(records,entryId)=>envelope(records,'records.remove',{target:{recordId:'request',entryId}});
const fails=async(promise,code)=>{await assert.rejects(promise,e=>{assert.equal(e?.code,code,String(e?.stack??e));return true;});};
const count=o=>row('SELECT count(*) n FROM module_records WHERE project_id=?',o.project).then(r=>r.n);

try{
 const a=await owner(),b=await owner();
 const v1=await visitor(a),v2=await visitor(a),s1=await visitor(a),bv=await visitor(b);
 await configureFixtureModules(a.scope,a.user,a.project,[accessInstance,recordsInstance()]);await activation(a,'members');await activation(a,'requests');
 await configureFixtureModules(b.scope,b.user,b.project,[accessInstance,recordsInstance()]);await activation(b,'members');await activation(b,'requests');
 await setRole(a,s1.visitorId,'grant');
 let records=await instance(a,'requests');const theirs=await instance(b,'requests');
 let first;

 await check('visitor submissions through the visitor origin: validation, replay, conflict and no echoed values',async()=>{
  const ok=submission(records),sent=await gateway(a,ok,v1);assert.equal(sent.status,200,JSON.stringify(sent.body));
  assert.equal(sent.body.result.accepted,true);assert.equal(sent.body.result.formId,'request-form');assert.ok(/^[0-9a-f-]{36}$/.test(sent.body.result.entryId));
  assert.ok(!markers.some(x=>JSON.stringify(sent.body).includes(x)),'The receipt never echoes values');first=sent.body.result.entryId;
  const saved=await row('SELECT * FROM module_records WHERE id=?',first);
  assert.equal(saved.visitor_id,v1.visitorId);assert.equal(saved.submitter_kind,'visitor');assert.equal(saved.revision,1);assert.equal(saved.expires_at-saved.created_at,30*86400);
  // Same requestId and input reads the receipt back; changed input is a conflict; nothing is stored twice.
  const replay=await gateway(a,ok,v1);assert.equal(replay.body.receipt.replayed,true);assert.equal(replay.body.result.entryId,first);
  assert.equal((await gateway(a,{...ok,input:{values:{...ok.input.values,count:3}}},v1)).body.code,'request_conflict');
  // Another visitor reusing the request id is a conflict, never a readback of someone else's receipt.
  assert.equal((await gateway(a,ok,v2)).body.code,'request_conflict');
  const before=await count(a);
  const values=ok.input.values,bad=[{...values,extra:1},{name:values.name,topic:'repair',urgent:true},{...values,topic:'other'},{...values,urgent:'yes'},{...values,count:'2'},
   {...values,name:'x'.repeat(301)},{...values,name:'  '},{...values,note:'bad\u0007'}];
  for(const v of bad){const r=await gateway(a,submission(records,'request-form',v),v1);assert.equal(r.body.code,'invalid_request',JSON.stringify(v).slice(0,80));assert.ok(!JSON.stringify(r.body).includes(values.name));}
  for(const input of [values,{values,more:1},{values:null}])assert.equal((await gateway(a,{...submission(records),input},v1)).body.code,'invalid_request');
  assert.equal((await gateway(a,{...submission(records),target:{formId:'request-form',extra:1}},v1)).body.code,'invalid_request');
  // Optional fields may be omitted and are stored as absent.
  const {note:_,...noNote}=values,minimal=await gateway(a,submission(records,'request-form',{...noNote,name:value('name')}),v2);assert.equal(minimal.status,200);
  assert.equal(JSON.parse((await row('SELECT values_json FROM module_records WHERE id=?',minimal.body.result.entryId)).values_json).note,undefined);
  assert.equal(await count(a),before+1);
  // Audiences: anonymous callers cannot submit a visitor form; plain visitors cannot use a staff form; anonymous public
  // intake is unavailable until it carries the contact admission (Turnstile and caps).
  assert.equal((await gateway(a,submission(records),null)).body.code,'forbidden');
  assert.equal((await gateway(a,submission(records,'staff-form'),v1)).body.code,'forbidden');
  assert.equal((await gateway(a,submission(records,'public-form'),null)).body.code,'unavailable');
  const staffSent=await gateway(a,submission(records,'staff-form'),s1);assert.equal(staffSent.status,200);
  assert.equal((await row('SELECT submitter_kind FROM module_records WHERE id=?',staffSent.body.result.entryId)).submitter_kind,'staff');
  // Foreign: project B's visitor and project B's origin never reach project A's resource.
  assert.equal((await gateway(a,submission(records),bv)).body.code,'forbidden');
  assert.equal((await gateway(b,submission(records),bv)).body.code,'not_found');
  assert.equal((await gateway(a,{...submission(records),configRevision:records.config_revision+1},v1)).body.code,'stale_configuration');
  assert.equal((await gateway(a,{...submission(records),input:{values:{...values,role:'staff'}}},v1)).body.code,'invalid_request');
 });

 await check('records.get projects fields by audience and record scope on both origins',async()=>{
  const ownerRead=await ownerCall(a,get(records,first));assert.equal(ownerRead.status,200,JSON.stringify(ownerRead.body));
  assert.deepEqual(Object.keys(ownerRead.body.result.values).sort(),['count','name','note','topic','urgent']);assert.equal(ownerRead.body.result.visitorId,v1.visitorId);
  const staffRead=await gateway(a,get(records,first),s1);assert.deepEqual(Object.keys(staffRead.body.result.values).sort(),['count','note','topic','urgent']);assert.equal(staffRead.body.result.visitorId,undefined);
  const own=await gateway(a,get(records,first),v1);assert.deepEqual(own.body.result.values,{topic:'repair',urgent:true});
  // Another visitor's record, another project's owner and anonymous callers learn nothing.
  assert.equal((await gateway(a,get(records,first),v2)).body.code,'not_found');
  assert.equal((await gateway(a,get(records,first),null)).body.code,'forbidden');
  assert.equal((await ownerCall(b,get(records,first))).body.code,'not_found');
  assert.equal((await ownerCall(b,get(theirs,first))).body.code,'not_found');
  assert.equal((await workspace(a,`/api/projects/${b.project}/modules`,{method:'POST',payload:get(theirs,first)})).body.code,'not_found');
  // A visitor cookie never authenticates on the workspace origin, and a workspace cookie never on the visitor origin.
  assert.equal((await ownerCall(a,get(records,first),{cookie:v1.cookie})).status,401);
  assert.equal((await gateway(a,get(records,first),{cookie:`__Host-whumpo_session=${a.token}`})).body.code,'forbidden');
  assert.equal((await gateway(a,get(records,id()),v1)).body.code,'not_found');
  assert.equal((await gateway(a,{...get(records,first),target:{recordId:'other',entryId:first}},v1)).body.code,'not_found');
  // Owner dashboard list: every field, newest first, never offered to visitors.
  const listed=await workspace(a,`/api/projects/${a.project}/module-records/${records.id}/request`);assert.equal(listed.status,200);
  assert.ok(listed.body.items.some(i=>i.entryId===first&&Object.hasOwn(i.values,'name')));assert.equal(listed.body.next,null);
  assert.equal((await workspace(b,`/api/projects/${a.project}/module-records/${records.id}/request`)).status,404);
  assert.equal((await workspace(a,`/api/projects/${a.project}/module-records/${records.id}/request?limit=5`)).status,400);
 });

 await check('records.view: configured views, own scope, opaque cursors bound to revisions',async()=>{
  for(let n=0;n<2;n++)assert.equal((await gateway(a,submission(records),v1)).status,200);
  const page1=await gateway(a,listView(records,'mine'),v1);assert.equal(page1.status,200,JSON.stringify(page1.body));
  assert.equal(page1.body.result.items.length,2);assert.ok(page1.body.result.items.every(i=>Object.keys(i.values).every(k=>['topic','urgent'].includes(k))));
  const page2=await gateway(a,listView(records,'mine',page1.body.result.next),v1);assert.equal(page2.body.result.items.length,1);assert.equal(page2.body.result.next,null);
  const mine=[...page1.body.result.items,...page2.body.result.items].map(i=>i.entryId);assert.equal(new Set(mine).size,3);
  assert.deepEqual((await rows('SELECT id FROM module_records WHERE visitor_id=? ORDER BY id',v1.visitorId)).map(r=>r.id).sort(),[...mine].sort());
  // A cursor is bound to its principal; tampering is refused.
  assert.equal((await gateway(a,listView(records,'mine',page1.body.result.next),v2)).body.code,'stale_configuration');
  assert.equal((await gateway(a,listView(records,'mine','!!'),v1)).body.code,'invalid_request');
  const desk=await gateway(a,listView(records,'desk'),s1);assert.ok(desk.body.result.items.length>=5);assert.ok(desk.body.result.items.every(i=>!Object.hasOwn(i.values,'name')));
  assert.equal((await gateway(a,listView(records,'desk'),v1)).body.code,'forbidden');
  assert.equal((await gateway(a,listView(records,'mine'),null)).body.code,'forbidden');
  assert.equal((await ownerCall(a,listView(records,'desk'))).body.code,'forbidden');
  assert.equal((await gateway(a,listView(records,'missing'),v1)).body.code,'not_found');
  // A role change advances the access revision, so cursors from before it are stale.
  await setRole(a,v2.visitorId,'grant');
  assert.equal((await gateway(a,listView(records,'mine',page1.body.result.next),v1)).body.code,'stale_configuration');
  await setRole(a,v2.visitorId,'revoke');
 });

 await check('records.update: staffWrite fields only, compare-and-swap, owner fields, one winner and revocation in flight',async()=>{
  const staffNote=value('staff-note'),done=await gateway(a,change(records,first,1,{note:staffNote}),s1);assert.equal(done.status,200,JSON.stringify(done.body));
  assert.deepEqual(done.body.result,{entryId:first,revision:2});
  assert.equal((await gateway(a,change(records,first,2,{name:'changed'}),s1)).body.code,'forbidden');
  assert.equal((await gateway(a,change(records,first,2,{topic:'visit'}),s1)).body.code,'forbidden');
  assert.equal((await gateway(a,change(records,first,2,{note:'x'}),v1)).body.code,'forbidden');
  assert.equal((await gateway(a,change(records,first,1,{note:'late'}),s1)).body.code,'stale_configuration');
  assert.equal((await gateway(a,change(records,first,2,{count:'many'}),s1)).body.code,'invalid_request');
  assert.equal((await gateway(a,change(records,first,2,{count:null}),s1)).body.code,'invalid_request');
  // Owner may change any field on the workspace origin; null clears an optional field.
  const ownerChange=await ownerCall(a,change(records,first,2,{name:value('owner-name'),note:null}));assert.equal(ownerChange.status,200,JSON.stringify(ownerChange.body));
  const values=JSON.parse((await row('SELECT values_json FROM module_records WHERE id=?',first)).values_json);assert.equal(values.note,undefined);assert.equal(values.count,2);
  // Two writes against the same revision: exactly one commits.
  const racing=await Promise.all([gateway(a,change(records,first,3,{count:5}),s1),gateway(a,change(records,first,3,{count:6}),s1)]);
  assert.deepEqual(racing.map(r=>r.status).sort(),[200,409]);assert.equal((await row('SELECT revision FROM module_records WHERE id=?',first)).revision,4);
  // A revocation that commits while a staff write is in flight wins inside the commit (actual handler wrapped).
  const revoke=await roleReview(a,s1.visitorId,'revoke'),staff=await moduleAccess.visitorPrincipal(db,s1.session,a.project,records.id);
  const wrapped={'records.update':async(d,c)=>{const r=await applyRole(a,revoke);assert.equal(r.status,200,r.error);return sharedModules.moduleHandlers['records.update'](d,c);}};
  await fails(sharedModules.handleModuleRequest(db,staff,change(records,first,4,{count:7}),wrapped),'forbidden');
  assert.equal((await row('SELECT revision FROM module_records WHERE id=?',first)).revision,4);
  assert.equal((await gateway(a,change(records,first,4,{count:7}),s1)).body.code,'forbidden');
  assert.equal((await gateway(a,get(records,first),s1)).body.code,'not_found','A former staff member reads only their own records');
  await setRole(a,s1.visitorId,'grant');
  const events=await rows('SELECT event,revision FROM module_record_events WHERE entry_id=? ORDER BY revision',first);
  assert.deepEqual(events.map(e=>[e.event,e.revision]),[['form.accepted',1],['record.updated',2],['record.updated',3],['record.updated',4]]);
 });

 await check('owner removal, safety holds, retention expiry and disable',async()=>{
  const target=(await gateway(a,submission(records),v2)).body.result.entryId;
  assert.equal((await gateway(a,removal(records,target),s1)).body.code,'forbidden');
  assert.equal((await gateway(a,removal(records,target),v2)).body.code,'forbidden');
  assert.equal((await ownerCall(b,removal(records,target))).body.code,'not_found');
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at) VALUES('case-wh127',?,'intake-1','human:reviewer',unixepoch())",a.user);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-wh127','case-wh127',?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",a.user,a.project);
  assert.equal((await ownerCall(a,removal(records,target))).body.code,'unavailable');
  await assert.rejects(()=>run('DELETE FROM module_records WHERE id=?',target),/safety_preservation_hold/);
  // Retention: age two records past the 30-day window (test-only clock substitute in this disposable database).
  const aged=[target,first],trigger=await row("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='module_record_update'");
  await run('DROP TRIGGER module_record_update');
  try{for(const entry of aged)await run('UPDATE module_records SET created_at=unixepoch()-31*86400,updated_at=unixepoch()-31*86400,expires_at=unixepoch()-86400 WHERE id=?',entry);}finally{await run(trigger.sql);}
  assert.equal((await ownerCall(a,get(records,target))).body.code,'not_found','Expired records are not readable');
  const {cleanupModuleRecords}=m.sharedModuleRecords;
  await cleanupModuleRecords(db);assert.equal((await row('SELECT count(*) n FROM module_records WHERE id IN (?,?)',...aged)).n,2,'Expiry skips the held project');
  await run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id='hold-wh127'");
  await cleanupModuleRecords(db);assert.equal((await row('SELECT count(*) n FROM module_records WHERE id IN (?,?)',...aged)).n,0,'Expiry resumes after release');
  // Owner removal works in every activation state; staff and visitor serving stop when the instance is disabled.
  const later=(await gateway(a,submission(records),v2)).body.result.entryId;
  await activation(a,'requests','disable');records=await instance(a,'requests');
  assert.equal((await gateway(a,submission(records),v2)).body.code,'unavailable');
  assert.equal((await gateway(a,get(records,later),v2)).body.code,'unavailable');
  assert.equal((await ownerCall(a,get(records,later))).status,200);
  const removed=await ownerCall(a,removal(records,later));assert.equal(removed.status,200,JSON.stringify(removed.body));assert.deepEqual(removed.body.result,{entryId:later,removed:true});
  assert.equal((await row('SELECT count(*) n FROM module_records WHERE id=?',later)).n,0);
  assert.equal((await row("SELECT event FROM module_record_events WHERE entry_id=? AND event='record.removed'",later)).event,'record.removed');
  await activation(a,'requests');records=await instance(a,'requests');
 });

 await check('configuration changes: stale configRevision, additive field reported absent',async()=>{
  const old=records;
  await configureFixtureModules(a.scope,a.user,a.project,[accessInstance,recordsInstance([...fields,{key:'phone',label:'Phone',type:'text',optional:true,read:'staff'}],2)]);
  await activation(a,'requests');records=await instance(a,'requests');assert.equal(records.config_revision,old.config_revision+1);
  assert.equal((await gateway(a,submission(old),v1)).body.code,'stale_configuration');
  const before=(await rows('SELECT id FROM module_records WHERE project_id=? AND fields_revision=1',a.project))[0].id;
  assert.equal(Object.hasOwn((await ownerCall(a,get(records,before))).body.result.values,'phone'),false);
  const newer=await gateway(a,submission(records,'request-form',{name:value('name'),topic:'visit',urgent:false,count:1,phone:value('phone')}),v1);assert.equal(newer.status,200);
  assert.equal((await row('SELECT fields_revision FROM module_records WHERE id=?',newer.body.result.entryId)).fields_revision,2);
 });

 await check('caps, revoked and erased visitors, direct writes refused',async()=>{
  const v4=await visitor(a);let limited=0;
  for(let n=0;n<21;n++){const r=await gateway(a,submission(records),v4);if(r.status===429){assert.equal(r.body.code,'limited');limited++;}}
  assert.equal(limited,1);assert.equal((await row('SELECT count(*) n FROM module_records WHERE visitor_id=?',v4.visitorId)).n,20);
  await auth.revokeAppVisitor(a.scope,a.user,a.project,v4.visitorId);
  assert.equal((await gateway(a,listView(records,'mine'),v4)).body.code,'forbidden');
  assert.equal((await row('SELECT count(*) n FROM module_records WHERE visitor_id=?',v4.visitorId)).n,20,'Owner keeps records of a revoked visitor');
  // The visitor's own reviewed erasure removes their submissions with their identity.
  const v5=await visitor(a);assert.equal((await gateway(a,submission(records),v5)).status,200);
  const review=await appLifecycle.prepareAppDeletion(db,v5.session,a.project);await appLifecycle.deleteAppAccount(db,v5.session,a.project,review.id,review.revision,'DELETE');
  assert.equal((await row('SELECT count(*) n FROM module_records WHERE visitor_id=?',v5.visitorId)).n,0);
  // Direct writes outside the engine are refused by the triggers.
  const r=await row('SELECT * FROM module_records WHERE project_id=? LIMIT 1',a.project);
  await assert.rejects(()=>run('UPDATE module_records SET values_json=? WHERE id=?','{}',r.id),/module_request_stale/);
  await assert.rejects(()=>run("INSERT INTO module_record_events VALUES(?,?,?,?,'record.updated',99,unixepoch())",records.id,id(),a.project,r.id),/module_request_stale/);
  await assert.rejects(()=>run("INSERT INTO module_records VALUES(?,?,?,'request','request-form',1,'visitor',?,'{}',1,?,?,unixepoch(),unixepoch(),unixepoch()+86400)",id(),theirs.id,a.project,v1.visitorId,id(),id()),/module_request_unavailable/);
 });

 await check('visitor values stay out of Chat, receipts, events and logs; closure counts and cascades',async()=>{
  for(const t of ['chat_turns','module_request_receipts','module_record_events','module_activation_reviews','activity_events']){const dump=JSON.stringify(await rows('SELECT * FROM '+t));for(const x of markers)assert.ok(!dump.includes(x),t);}
  const chat=JSON.stringify(await m.readChat(a.scope,a.user));for(const x of markers)assert.ok(!chat.includes(x));
  const view=JSON.stringify(await m.readViewBinding(a.scope,a.user,'modules',a.project));for(const x of markers)assert.ok(!view.includes(x));
  for(const x of markers)assert.ok(!logs.join('\n').includes(x));
  const inventory=await accountClosureInventory(db,a.user);assert.equal(inventory.counts.moduleRecords,await count(a));assert.ok(inventory.counts.moduleRecords>20);
  await run('DELETE FROM module_instances WHERE project_id=?',b.project);
  for(const t of ['module_records','module_record_events'])assert.equal((await row(`SELECT count(*) n FROM ${t} WHERE project_id=?`,b.project)).n,0,t);
 });

 await check('records paths never reach owner-maintenance inference',async()=>{
  const inference=/^src\/(ai|ai-chat|ai-gateway|acknowledgment|site-agent|agent-[a-z-]+|standard-ai[a-z-]*|chat|backend-chat|app-upgrade-chat|app-recovery-chat|app-page-design)\.ts$|^src\/chat-interactions\/(agent|agent-request|model-continuation|continuation)\.ts$/;
  for(const entry of ['src/shared-modules/records.ts','src/shared-modules/api.ts','src/app-gateway.ts']){
   const out=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false,metafile:true,logLevel:'silent'});
   assert.deepEqual(Object.keys(out.metafile.inputs).filter(p=>inference.test(p)),[],entry+' reaches owner-maintenance inference');
   for(const name of ['AI_GATEWAY','OPENAI','ANTHROPIC','sendAIChat','agentPrompt','siteContext'])assert.ok(!out.outputFiles[0].text.includes(name),entry+' references '+name);
  }
  // The site agent does not advertise module changes or records (owner decision, October 4, 2026).
  const prompt=m.agentPrompt({})+m.agentPrompt({},'website');for(const word of ['modules.put','modules.remove','records.addField','forms.submit','records.view'])assert.ok(!prompt.includes(word),word);
  assert.equal(network,0);
 });

 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 process.stdout.write(`Shared module records passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'} — visitor/staff submissions through the visitor origin with validation, replay and conflicts, field/record projection for owner, staff, submitter and anonymous callers on both origins, configured views with bound cursors, staffWrite compare-and-swap updates with one winner and in-flight revocation, owner removal under safety holds, retention expiry, disable, stale configRevision, caps, revoked/erased visitors, closure counts and a static no-inference check. No network, model or provider use; no visitor value in Chat, receipts, events or logs.\n`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}

