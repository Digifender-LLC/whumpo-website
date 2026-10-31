import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
import {validateDescriptor} from '../tools/prototypes/workload-placement.mjs';
Error.stackTraceLimit=0;
// WH-093 record leads (schema batch 6): the owner-only module_record_leads table, leads.update, the owner list filters and the counts-only binding. Actual handlers (visitor gateway POST /modules, the workspace-origin owner routes,
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
 // WH-126: visitor identity belongs to the access instance; no visitor application is needed.
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
/** Anonymous visitor-origin request with the public intake admission inputs: connection, Turnstile header and Siteverify. */
async function publicGateway(o,payload,{ip='192.0.2.20',token='fixture-token',verify,secret='fixture-secret'}={}){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules',{method:'POST',headers:{'cf-connecting-ip':ip,'content-type':'application/json',origin:o.host,...(token?{'whumpo-turnstile-response':token}:{})},body:JSON.stringify(payload)}),{...env,TURNSTILE_SECRET:secret},verify);
 return {status:response.status,body:await response.json()};
}
const ownerSummary=async o=>(await m.readViewBinding(o.scope,o.user,'records-summary',o.project)).data;
async function publish(o){
 const head=await row('SELECT version_id FROM project_spec_heads WHERE project_id=?',o.project),chat=async content=>{const turn=id();return {turn,result:await m.sendChat(o.scope,o.user,{id:turn,revision:await revision(o),content})};};
 const review=await chat('/publish '+head.version_id);assert.equal((await chat('/confirm '+review.turn)).result.status,200);
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

const leadEdit=(records,entryId,revision,changes,requestId)=>envelope(records,'leads.update',{target:{recordId:'request',entryId,revision,changes},requestId});
const leadRow=entry=>row('SELECT * FROM module_record_leads WHERE entry_id=?',entry);
const list=(o,resource,query='')=>workspace(o,`/api/projects/${o.project}/module-records/${resource.id}/request${query}`);
const grant=(o,feature='business.leads')=>run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,'confirm','private-test-acceptance','synthetic WH-093 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.user,o.project,feature);
const today=new Date().toISOString().slice(0,10),day=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);

try{
 const a=await owner(),b=await owner();
 for(const o of [a,b]){await configureFixtureModules(o.scope,o.user,o.project,[accessInstance,recordsInstance()]);await activation(o,'members');await activation(o,'requests');}
 const v1=await visitor(a),s1=await visitor(a),bv=await visitor(b);await setRole(a,s1.visitorId,'grant');
 const records=await instance(a,'requests'),theirs=await instance(b,'requests');
 const submit=async(o,resource,v)=>{const r=await gateway(o,submission(resource),v);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.result.entryId;};
 const e1=await submit(a,records,v1),e2=await submit(a,records,v1),e3=await submit(a,records,v1),bEntry=await submit(b,theirs,bv);
 await grant(a);

 await check('duplicate delivery creates one record and no lead row; a record without a row reads as stage new',async()=>{
  const sent=submission(records),first=await gateway(a,sent,v1),again=await gateway(a,sent,v1);
  assert.equal(again.body.receipt.replayed,true);assert.equal(again.body.result.entryId,first.body.result.entryId);
  assert.equal((await row('SELECT count(*) n FROM module_record_leads')).n,0);
  const page=await list(a,records);assert.equal(page.status,200);assert.equal(page.body.leads.editable,true);
  for(const item of page.body.items)assert.deepEqual(item.lead,{stage:'new',note:'',dueDate:null,revision:0});
  await run('DELETE FROM module_records WHERE id=?',first.body.result.entryId);
 });

 await check('owner update: first edit creates the row, edits are revision-checked, receipts and replies carry no lead value',async()=>{
  const note=value('lead-note'),sent=leadEdit(records,e1,0,{stage:'contacted',note,dueDate:day(3)}),r=await ownerCall(a,sent);
  assert.equal(r.status,200,JSON.stringify(r.body));assert.deepEqual(r.body.result,{entryId:e1,revision:1});assert.ok(!JSON.stringify(r.body).includes(note));
  const saved=await leadRow(e1);assert.deepEqual([saved.stage,saved.note,saved.due_date,saved.revision,saved.project_id,saved.instance_id],['contacted',note,day(3),1,a.project,records.id]);
  assert.equal((await ownerCall(a,sent)).body.receipt.replayed,true,'Replay reads the receipt back');assert.equal((await leadRow(e1)).revision,1);
  const receipt=await row('SELECT result_json FROM module_request_receipts WHERE request_id=?',sent.requestId);assert.ok(!receipt.result_json.includes(note));
  // A partial change keeps the other fields; null clears the date; the record itself is untouched.
  const rec=await row('SELECT revision,values_json FROM module_records WHERE id=?',e1);
  const two=await ownerCall(a,leadEdit(records,e1,1,{stage:'qualified'}));assert.equal(two.status,200);
  const three=await ownerCall(a,leadEdit(records,e1,2,{dueDate:null,note:''}));assert.equal(three.status,200);
  const now=await leadRow(e1);assert.deepEqual([now.stage,now.note,now.due_date,now.revision],['qualified','',null,3]);
  assert.deepEqual(await row('SELECT revision,values_json FROM module_records WHERE id=?',e1),rec);
  assert.equal((await row('SELECT count(*) n FROM module_record_events WHERE entry_id=?',e1)).n,1,'A lead write emits no record event');
  const item=(await list(a,records)).body.items.find(i=>i.entryId===e1);assert.deepEqual(item.lead,{stage:'qualified',note:'',dueDate:null,revision:3});
 });

 await check('stale and concurrent updates: one winner, the loser is told to reload and nothing is half-written',async()=>{
  const stale=await ownerCall(a,leadEdit(records,e1,1,{stage:'won'}));assert.equal(stale.status,409);assert.equal(stale.body.code,'stale_configuration');assert.equal((await leadRow(e1)).stage,'qualified');
  const ahead=await ownerCall(a,leadEdit(records,e1,9,{stage:'won'}));assert.equal(ahead.body.code,'stale_configuration');
  const race=await Promise.all([ownerCall(a,leadEdit(records,e2,0,{stage:'contacted'})),ownerCall(a,leadEdit(records,e2,0,{stage:'lost'}))]);
  assert.deepEqual(race.map(x=>x.status).sort(),[200,409],JSON.stringify(race.map(x=>x.body)));assert.equal((await leadRow(e2)).revision,1);
  assert.equal((await row('SELECT count(*) n FROM module_request_receipts WHERE operation=? AND instance_id=?','leads.update',records.id)).n,4,'Refused writes leave no receipt');
  // The trigger repeats the swap for any writer, not only the handler.
  await assert.rejects(()=>run('UPDATE module_record_leads SET stage=?,revision=revision,last_request_id=? WHERE entry_id=?','won',id(),e2),/module_request_stale/);
  await assert.rejects(()=>run('UPDATE module_record_leads SET stage=?,revision=revision+2,last_request_id=? WHERE entry_id=?','won',id(),e2),/module_request_stale/);
  await assert.rejects(()=>run('UPDATE module_record_leads SET project_id=?,revision=revision+1,last_request_id=? WHERE entry_id=?',b.project,id(),e2),/module_request_stale/);
 });

 await check('input validation: closed stages, note and date shapes, exact keys',async()=>{
  const bad=[{},{stage:'hot'},{stage:1},{note:'x'.repeat(2001)},{note:'😀'.repeat(2001)},{note:'bell\u0007'},{note:5},{dueDate:'2026-02-30'},{dueDate:'2026-1-5'},{dueDate:'2019-12-31'},{dueDate:'2101-01-01'},{dueDate:'2026-01-05T00:00:00Z'},{dueDate:5},{extra:1},{stage:'won',visitorId:'x'}];
  for(const changes of bad){const r=await ownerCall(a,leadEdit(records,e3,0,changes));assert.ok([400].includes(r.status),JSON.stringify(changes).slice(0,60)+' '+JSON.stringify(r.body));}
  for(const target of [{recordId:'request',entryId:e3,revision:-1,changes:{stage:'won'}},{recordId:'request',entryId:e3,revision:'0',changes:{stage:'won'}},{recordId:'request',entryId:'nope',revision:0,changes:{stage:'won'}},{recordId:'request',entryId:e3,revision:0,changes:{stage:'won'},extra:1}])
   assert.equal((await ownerCall(a,envelope(records,'leads.update',{target}))).status,400);
  assert.equal((await ownerCall(a,{...leadEdit(records,e3,0,{stage:'won'}),input:{note:'x'}})).status,400);
  assert.equal((await ownerCall(a,envelope(records,'leads.update',{target:{recordId:'other',entryId:e3,revision:0,changes:{stage:'won'}}}))).body.code,'not_found');
  assert.equal(await leadRow(e3),null);
  const long=await ownerCall(a,leadEdit(records,e3,0,{note:'é'.repeat(2000)}));assert.equal(long.status,200,JSON.stringify(long.body));
  await run('UPDATE module_record_leads SET note=?,revision=revision+1,last_request_id=? WHERE entry_id=?','',id(),e3);
  for(const sql of ["INSERT INTO module_record_leads(entry_id,instance_id,project_id,stage,note,due_date,revision,last_request_id,created_at,updated_at) VALUES(?,?,?,'maybe','',NULL,1,?,unixepoch(),unixepoch())"])
   await assert.rejects(()=>run(sql,e2,records.id,a.project,id()),/CHECK|constraint/i);
 });

 await check('lead data is owner-only: visitors, staff, the public and foreign owners are refused, and no lead field is readable through any module read',async()=>{
  const e4=await submit(a,records,v1),hidden=value('hidden'),secret=value('private'),req=leadEdit(records,e4,0,{stage:'won',note:hidden});
  for(const who of [v1,s1])assert.equal((await gateway(a,req,who)).body.code,'forbidden');
  assert.equal((await gateway(a,{...req,requestId:id()})).status>=400,true,'Anonymous callers are refused');
  assert.equal((await workspace(a,`/api/projects/${a.project}/modules`,{method:'POST',payload:req,cookie:v1.cookie})).status,401);
  assert.equal((await ownerCall(b,req)).body.code,'not_found','Foreign owner on a foreign resource');
  assert.equal((await ownerCall(b,leadEdit(theirs,bEntry,0,{stage:'won'}))).body.code,'forbidden','No Business grant');
  await grant(b);
  assert.equal((await ownerCall(b,{...req,resourceId:theirs.id,configRevision:theirs.config_revision})).body.code,'not_found','Foreign record on own resource');
  assert.equal((await list(b,records)).status,404);assert.equal((await workspace(b,`/api/projects/${a.project}/module-records/${records.id}/request`)).status,404);
  assert.equal(await leadRow(e4),null);
  // Cross-project rows cannot be forged in SQL either.
  await assert.rejects(()=>run("INSERT INTO module_record_leads(entry_id,instance_id,project_id,stage,note,due_date,revision,last_request_id,created_at,updated_at) VALUES(?,?,?,'new','',NULL,1,?,unixepoch(),unixepoch())",e4,theirs.id,b.project,id()),/module_request_stale/);
  await assert.rejects(()=>run("INSERT INTO module_record_leads(entry_id,instance_id,project_id,stage,note,due_date,revision,last_request_id,created_at,updated_at) VALUES(?,?,?,'new','',NULL,1,?,unixepoch(),unixepoch())",e4,records.id,b.project,id()),/module_request_stale/);
  // Visitor and staff reads never carry a lead field, even for a record that has a lead.
  await ownerCall(a,leadEdit(records,e4,0,{stage:'lost',note:secret}));
  for(const [who,call] of [[v1,get(records,e4)],[s1,get(records,e4)],[s1,listView(records,'desk')],[v1,listView(records,'mine')]]){
   const r=await gateway(a,call,who);assert.equal(r.status,200,JSON.stringify(r.body));const text=JSON.stringify(r.body);assert.ok(!/lead|stage|lost|dueDate/i.test(text),text);for(const x of [hidden,secret])assert.ok(!text.includes(x));
  }
  assert.equal((await ownerCall(a,get(records,e4))).body.result.lead,undefined,'records.get does not widen to lead data');
 });

 await check('owner list filters: stage, due set/none/overdue by the owner date, bound cursors, closed parameters',async()=>{
  await ownerCall(a,leadEdit(records,e3,2,{stage:'contacted',dueDate:day(-2)}));
  await ownerCall(a,leadEdit(records,e2,1,{stage:'contacted',dueDate:day(-1)}));
  const lost=(await row("SELECT entry_id FROM module_record_leads WHERE stage='lost'")).entry_id;
  const ids=r=>r.body.items.map(i=>i.entryId).sort();
  const stage=await list(a,records,'?stage=contacted');assert.deepEqual(ids(stage),[e2,e3].sort());
  assert.deepEqual(ids(await list(a,records,'?stage=new')).includes(e1),false);
  assert.deepEqual(ids(await list(a,records,'?stage=lost')),[lost]);
  const set=ids(await list(a,records,'?due=set')),none=ids(await list(a,records,'?due=none'));assert.deepEqual(set,[e2,e3].sort());assert.ok(!none.includes(e2)&&none.includes(e1));
  assert.deepEqual(ids(await list(a,records,`?due=overdue&today=${today}`)),[e2,e3].sort());
  assert.deepEqual(ids(await list(a,records,`?due=overdue&today=${day(-2)}`)),[],'Overdue means strictly before the owner date');
  assert.deepEqual(ids(await list(a,records,`?due=overdue&today=${day(-1)}&stage=contacted`)),[e3]);
  await ownerCall(a,leadEdit(records,e3,3,{stage:'won'}));assert.ok(!ids(await list(a,records,`?due=overdue&today=${today}`)).includes(e3),'A won lead is not overdue');
  for(const q of ['?stage=hot','?due=soon','?due=overdue','?today='+today,'?due=set&today='+today,'?due=overdue&today=2026-13-01','?stage=new&stage=won','?x=1'])assert.equal((await list(a,records,q)).status,400,q);
 });

 await check('deleted and expired records cannot be resurrected; removal and expiry take the lead with the record',async()=>{
  const e5=await submit(a,records,v1);assert.equal((await ownerCall(a,leadEdit(records,e5,0,{stage:'contacted',note:value('gone')}))).status,200);
  assert.equal((await ownerCall(a,removal(records,e5))).status,200);
  assert.equal(await leadRow(e5),null,'The lead cascades with the record');
  assert.equal((await ownerCall(a,leadEdit(records,e5,1,{stage:'won'}))).body.code,'not_found');assert.equal((await ownerCall(a,leadEdit(records,e5,0,{stage:'won'}))).body.code,'not_found');
  await assert.rejects(()=>run("INSERT INTO module_record_leads(entry_id,instance_id,project_id,stage,note,due_date,revision,last_request_id,created_at,updated_at) VALUES(?,?,?,'new','',NULL,1,?,unixepoch(),unixepoch())",e5,records.id,a.project,id()),/module_request_stale/);
  assert.equal(await leadRow(e5),null);
  // Retention: the record's window ends, the lead goes with it and the sweep leaves no orphan.
  const e6=await submit(a,records,v1);await ownerCall(a,leadEdit(records,e6,0,{stage:'qualified',note:value('aged')}));
  const triggers=await rows("SELECT sql FROM sqlite_master WHERE type='trigger' AND name IN ('module_record_update','safety_hold_module_record_frozen')");
  await run('DROP TRIGGER module_record_update');await run('DROP TRIGGER safety_hold_module_record_frozen');
  try{await run('UPDATE module_records SET created_at=unixepoch()-31*86400,updated_at=unixepoch()-31*86400,expires_at=unixepoch()-86400 WHERE id=?',e6);}finally{for(const t of triggers)await run(t.sql);}
  assert.equal((await ownerCall(a,leadEdit(records,e6,1,{stage:'won'}))).body.code,'not_found','An expired record is not editable');
  await assert.rejects(()=>run('UPDATE module_record_leads SET stage=?,revision=revision+1,last_request_id=? WHERE entry_id=?','won',id(),e6),/module_request_stale/);
  assert.ok(!(await list(a,records)).body.items.some(i=>i.entryId===e6));
  await m.sharedModuleRecords.cleanupModuleRecords(db);assert.equal(await leadRow(e6),null);
  assert.equal((await row('SELECT count(*) n FROM module_record_leads l LEFT JOIN module_records r ON r.id=l.entry_id WHERE r.id IS NULL')).n,0);
 });

 await check('a safety preservation hold freezes the lead exactly as it freezes the record',async()=>{
  const held=await submit(a,records,v1),free=await submit(a,records,v1);await ownerCall(a,leadEdit(records,held,0,{stage:'contacted',note:value('held-note')}));
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES('case-wh093',?,'intake-93','human:reviewer',unixepoch(),unixepoch()+31536000)",a.user);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-wh093','case-wh093',?,'project',?,'basis-93','human:approver',unixepoch(),unixepoch()+86400)",a.user,a.project);
  const before=await leadRow(held);
  assert.equal((await ownerCall(a,leadEdit(records,held,1,{stage:'won'}))).body.code,'unavailable');assert.equal((await ownerCall(a,leadEdit(records,free,0,{stage:'won'}))).body.code,'unavailable','No first edit under a hold');
  await assert.rejects(()=>run('UPDATE module_record_leads SET stage=?,revision=revision+1,last_request_id=? WHERE entry_id=?','won',id(),held),/safety_preservation_hold/);
  await assert.rejects(()=>run('DELETE FROM module_record_leads WHERE entry_id=?',held),/safety_preservation_hold/);
  await assert.rejects(()=>run("INSERT INTO module_record_leads(entry_id,instance_id,project_id,stage,note,due_date,revision,last_request_id,created_at,updated_at) VALUES(?,?,?,'new','',NULL,1,?,unixepoch(),unixepoch())",free,records.id,a.project,id()),/safety_preservation_hold/);
  await assert.rejects(()=>run('DELETE FROM module_records WHERE id=?',held),/safety_preservation_hold/);
  assert.deepEqual(await leadRow(held),before);assert.equal(await leadRow(free),null);
  assert.equal((await list(a,records)).status,200,'Reading stays open under a hold');
  await run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-93' WHERE id='hold-wh093'");
  assert.equal((await ownerCall(a,leadEdit(records,held,1,{stage:'won'}))).status,200);assert.equal((await ownerCall(a,leadEdit(records,free,0,{stage:'won'}))).status,200);
 });

 await check('Business admission: writes need business.leads on the direct API; plan loss keeps reading, counts and export',async()=>{
  const fresh=await submit(a,records,v1);
  await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND feature_id=?',a.user,'business.leads');
  const refused=await ownerCall(a,leadEdit(records,fresh,0,{stage:'contacted'}));assert.equal(refused.status,403);assert.equal(refused.body.code,'forbidden');assert.match(refused.body.error,/Business plan/);
  assert.equal(await leadRow(fresh),null);
  const page=await list(a,records);assert.equal(page.status,200);assert.equal(page.body.leads.editable,false);assert.ok(page.body.items.some(i=>i.lead.revision>0),'Saved leads stay readable');
  // Records are still removable without the plan.
  const {exportRecords,validateRecordsExport}=m.moduleRecordsExport,exported=await exportRecords(a.scope,a.user,a.project,records.id,records.config_revision,{recordId:'request'});
  const withLead=exported.records.filter(r=>r.lead);assert.ok(withLead.length>=3);assert.ok(withLead.every(r=>r.lead.revision>=1&&['new','contacted','qualified','won','lost'].includes(r.lead.stage)));
  await validateRecordsExport(JSON.parse(JSON.stringify(exported)));
  const rehash=async x=>{x.recordsSha256=(await import('node:crypto')).createHash('sha256').update(JSON.stringify(x.records)).digest('hex');return x;};
  const tampered=await rehash(JSON.parse(JSON.stringify(exported)));tampered.records[0].lead={stage:'hot',note:'',dueDate:null,revision:1};await rehash(tampered);
  await assert.rejects(()=>validateRecordsExport(tampered),e=>e?.code==='invalid_request');
  const slice=await exportRecords(a.scope,a.user,a.project,records.id,records.config_revision,{recordId:'request',visitorId:v1.visitorId});assert.ok(slice.records.length>0&&slice.records.every(r=>r.lead===null),'A visitor-subject slice never carries owner notes');
  await grant(a);assert.equal((await ownerCall(a,leadEdit(records,fresh,0,{stage:'contacted'}))).status,200,'A current grant admits the write again');
 });

 await check('lead data never reaches Chat, views, bindings, receipts, events, logs or the agent prompt',async()=>{
  for(const kind of ['records-leads-summary','leads'])await assert.rejects(()=>m.readViewBinding(a.scope,a.user,kind,a.project),/registered component/,kind);
  const {moduleBindings}=await import('../src/shared-modules/bindings.ts').catch(()=>({moduleBindings:null}));if(moduleBindings)assert.ok(!Object.keys(moduleBindings).some(k=>/lead/i.test(k)));
  for(const t of ['chat_turns','module_request_receipts','module_record_events','module_activation_reviews','activity_events']){const dump=JSON.stringify(await rows('SELECT * FROM '+t));for(const x of markers)assert.ok(!dump.includes(x),t);}
  const chat=JSON.stringify(await m.readChat(a.scope,a.user));for(const x of markers)assert.ok(!chat.includes(x));
  for(const kind of ['modules','records-summary']){const dump=JSON.stringify(await m.readViewBinding(a.scope,a.user,kind,a.project));for(const x of markers)assert.ok(!dump.includes(x),kind);assert.ok(!/lead|stage/i.test(dump),kind);}
  for(const x of markers)assert.ok(!logs.join('\n').includes(x));
  const prompt=m.agentPrompt({})+m.agentPrompt({},'website');for(const word of ['leads.update','leads','lead stage'])assert.ok(!prompt.includes(word),word);
  assert.equal(m.modulePolicy.moduleOperations['leads.update'].write,true);assert.equal(typeof m.sharedModules.moduleHandlers['leads.update'],'function');
  assert.equal(network,0);
 });

 await check('retention expiry across tenants: a held lead outlives its expired record only while held, another tenant is unaffected',async()=>{
  await grant(b);
  const age=async e=>{const ts=await rows("SELECT sql FROM sqlite_master WHERE type='trigger' AND name IN ('module_record_update','safety_hold_module_record_frozen')");await run('DROP TRIGGER module_record_update');await run('DROP TRIGGER safety_hold_module_record_frozen');try{await run('UPDATE module_records SET created_at=unixepoch()-31*86400,updated_at=unixepoch()-31*86400,expires_at=unixepoch()-86400 WHERE id=?',e);}finally{for(const s of ts)await run(s.sql);}};
  for(const scope of ['project','account']){
   const ae=await submit(a,records,v1),be=await submit(b,theirs,bv);
   assert.equal((await ownerCall(a,leadEdit(records,ae,0,{stage:'won',note:'held'}))).status,200);assert.equal((await ownerCall(b,leadEdit(theirs,be,0,{stage:'won',note:'free'}))).status,200);
   await age(ae);await age(be);
   const c='case-x-'+scope,h='hold-x-'+scope;
   await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-x','human:reviewer',unixepoch(),unixepoch()+31536000)",c,a.user);
   await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,?,?,'basis-x','human:approver',unixepoch(),unixepoch()+86400)",h,c,a.user,scope,scope==='project'?a.project:null);
   await m.sharedModuleRecords.cleanupModuleRecords(db);
   assert.ok(await leadRow(ae),'held lead kept '+scope);assert.ok(await row('SELECT 1 x FROM module_records WHERE id=?',ae),'held record kept');
   assert.equal(await leadRow(be),null,'other tenant lead gone '+scope);assert.equal(await row('SELECT 1 x FROM module_records WHERE id=?',be),null);
   await run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='r' WHERE id=?",h);
   await m.sharedModuleRecords.cleanupModuleRecords(db);assert.equal(await leadRow(ae),null,'expires after release '+scope);
  }
 });

 await check('lifecycle: closure counts the leads and project deletion removes them',async()=>{
  const inventory=await accountClosureInventory(db,a.user);assert.equal(inventory.counts.moduleRecordLeads,(await row('SELECT count(*) n FROM module_record_leads WHERE project_id=?',a.project)).n);assert.ok(inventory.counts.moduleRecordLeads>=3);
  await run('DELETE FROM module_instances WHERE project_id=?',b.project);
  assert.equal((await row('SELECT count(*) n FROM module_record_leads WHERE project_id=?',b.project)).n,0);
 });

 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 process.stdout.write(`Record leads passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'} — owner-only leads.update (first edit, partial change, clear), revision compare-and-swap with one winner under concurrency, input bounds, visitor/staff/public/foreign-owner refusals and no lead field on any other read, stage/due/overdue filters on the owner list, deleted/expired records cannot be resurrected, hold freeze, Business admission with plan loss (read and export survive), counts-only Chat binding, closure and lifecycle.\n`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}
