import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
import {validateDescriptor} from '../tools/prototypes/workload-placement.mjs';
Error.stackTraceLimit=0;
// WH-095 conversion summary: the owner-only GET .../module-records/R/S/conversions over current records and lead rows (no events, no history), through the actual platform Worker, with two owners. Synthetic data, no network.
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

const conv=(o,resource,opts,q='')=>workspace(o,`/api/projects/${o.project}/module-records/${resource.id}/request/conversions${q}`,opts);
const grantRead=o=>run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'business.conversions','read','private-test-acceptance','synthetic WH-095 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.user,o.project);
const stageOf=async(o,resource)=>(await conv(o,resource)).body;
try{
 const a=await owner(),b=await owner();
 for(const o of [a,b]){await configureFixtureModules(o.scope,o.user,o.project,[accessInstance,recordsInstance()]);await activation(o,'members');await activation(o,'requests');}
 const v1=await visitor(a),bv=await visitor(b),records=await instance(a,'requests'),theirs=await instance(b,'requests');
 const submit=async(o,resource,v)=>{const r=await gateway(o,submission(resource),v);assert.equal(r.status,200,JSON.stringify(r.body));return r.body.result.entryId;};
 const e1=await submit(a,records,v1),e2=await submit(a,records,v1),e3=await submit(a,records,v1);await submit(b,theirs,bv);
 await run('DROP TRIGGER module_instance_update');// disposable database: the only way to age an instance, since created_at is immutable
 await run('UPDATE module_instances SET created_at=unixepoch()-86400*40 WHERE id IN (?,?)',records.id,theirs.id);
 const lead=(o,resource,entry,rev,stage)=>ownerCall(o,leadEdit(resource,entry,rev,{stage}));
 for(const o of [a,b])await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'business.leads','confirm','private-test-acceptance','synthetic WH-095 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),o.user,o.project);

 await check('without business.conversions no figure is returned, not even zero',async()=>{
  const r=await conv(a,records);assert.equal(r.status,200);assert.equal(r.body.eligible,false);assert.ok(!('stages' in r.body)&&!('submitted' in r.body));
 });
 await grantRead(a);
 await check('known counts: a record with no lead row is New, current stages are counted, duplicates add nothing',async()=>{
  assert.equal((await lead(a,records,e1,0,'won')).status,200);assert.equal((await lead(a,records,e2,0,'contacted')).status,200);
  const sent=submission(records);await gateway(a,sent,v1);await gateway(a,sent,v1);// the same request id twice: one record
  const r=await stageOf(a,records);assert.equal(r.eligible,true);assert.equal(r.submitted,4);assert.deepEqual(r.stages,{new:2,contacted:1,qualified:0,won:1,lost:0});
  assert.equal(r.windowDays,30);assert.equal(r.keptDays,30);assert.equal(r.partial,false,'The instance is older than the window');
  assert.deepEqual(Object.keys(r).sort(),['eligible','keptDays','partial','recordId','resourceId','since','stages','submitted','windowDays']);
 });
 await check('a stage reversal lowers the count, and a removed or expired record leaves it',async()=>{
  assert.equal((await lead(a,records,e1,1,'contacted')).status,200);assert.equal((await stageOf(a,records)).stages.won,0);
  assert.equal((await stageOf(a,records)).stages.contacted,2);
  assert.equal((await ownerCall(a,envelope(records,'records.remove',{target:{recordId:'request',entryId:e2}}))).status,200);assert.equal((await stageOf(a,records)).submitted,3);
  await run('DROP TRIGGER module_record_update');await run('DROP TRIGGER safety_hold_module_record_frozen');await run('UPDATE module_records SET created_at=unixepoch()-31*86400,updated_at=unixepoch()-31*86400,expires_at=unixepoch()-86400 WHERE id=?',e3);assert.equal((await stageOf(a,records)).submitted,2);
 });
 await check('a form younger than the window reads as a partial period',async()=>{
  await run('UPDATE module_instances SET created_at=unixepoch()-86400*3 WHERE id=?',records.id);
  const r=await stageOf(a,records);assert.equal(r.partial,true);assert.equal(r.since.slice(0,10),new Date(Date.now()-3*86400000).toISOString().slice(0,10));
 });
 await check('another owner sees nothing of this project, and their own figures are separate',async()=>{
  assert.equal((await workspace(b,`/api/projects/${a.project}/module-records/${records.id}/request/conversions`)).status,404);
  assert.equal((await workspace(b,`/api/projects/${b.project}/module-records/${records.id}/request/conversions`)).status,404);
  assert.equal((await conv(b,theirs)).body.eligible,false);await grantRead(b);const r=await stageOf(b,theirs);assert.equal(r.submitted,1);assert.equal(r.stages.new,1);
  assert.equal((await conv(a,records,{cookie:v1.cookie})).status,401);
  assert.equal((await conv(a,records,undefined,'?x=1')).status,400);
  assert.equal((await workspace(a,`/api/projects/${a.project}/module-records/${records.id}/nothing/conversions`)).status,404);
 });
 await check('stages and counts never reach Chat bindings or the owner summary',async()=>{
  const summary=JSON.stringify(await ownerSummary(a));assert.ok(!/won|stages|conversion|contacted/i.test(summary),summary);
  assert.ok(!logs.join('\n').match(/"won"/),'No figure logged');assert.equal(network,0);
 });
 process.stdout.write(`Record conversions passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'} - owner-only read of current stages in the last 30 days, no figure without business.conversions, reversal and removal and expiry lower the count, partial period for a young form, tenant and visitor refusals, nothing in Chat bindings.\n`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}
