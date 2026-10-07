import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {execFileSync} from 'node:child_process';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
import {validateDescriptor} from '../tools/prototypes/workload-placement.mjs';
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

try{
 const a=await owner(),b=await owner();
 await configureFixtureModules(a.scope,a.user,a.project,[accessInstance,recordsInstance()]);await activation(a,'members');await activation(a,'requests');
 await configureFixtureModules(b.scope,b.user,b.project,[accessInstance,recordsInstance()]);await activation(b,'members');await activation(b,'requests');
 const v1=await visitor(a),v2=await visitor(a),s1=await visitor(a),bv=await visitor(b);
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
  // intake fails closed on a deployed host without the Turnstile secret (the admission is covered below).
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

 await check('anonymous public intake reuses the contact admission: Turnstile, connection allowance, publication and atomic caps',async()=>{
  let calls=0;const siteverify=(answer)=>async(url,options)=>{calls++;assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(options.redirect,'manual');
   const body=new URLSearchParams(options.body);assert.equal(body.get('secret'),'fixture-secret');assert.equal(body.get('response'),'fixture-token');return typeof answer==='function'?answer():Response.json(answer);};
  const good=r=>siteverify({success:true,hostname:new URL(a.host).hostname,action:'module-form',cdata:r.id});
  const publicValues=()=>({name:value('public-name'),topic:'visit',urgent:false,count:1});
  // Policy and authorization run before any verification call: visitor/staff forms refuse anonymous callers outright.
  assert.equal((await publicGateway(a,submission(records,'request-form'),{verify:good(records)})).body.code,'forbidden');
  assert.equal((await publicGateway(a,submission(records,'staff-form'),{verify:good(records)})).body.code,'forbidden');
  assert.equal(calls,0);
  // Deployed hosts fail closed without the secret; the token is required; Siteverify must name this host, action and resource.
  assert.equal((await publicGateway(a,submission(records,'public-form'),{secret:undefined,verify:good(records)})).body.code,'unavailable');
  assert.equal((await publicGateway(a,submission(records,'public-form'),{ip:'192.0.2.21',token:'',verify:good(records)})).body.code,'forbidden');
  for(const answer of [{success:false},{success:true,hostname:'evil.example',action:'module-form',cdata:records.id},{success:true,hostname:new URL(a.host).hostname,action:'contact',cdata:records.id},
   {success:true,hostname:new URL(a.host).hostname,action:'module-form',cdata:theirs.id},{success:true,hostname:new URL(b.host).hostname,action:'module-form',cdata:records.id}])
   assert.equal((await publicGateway(a,submission(records,'public-form',publicValues()),{ip:'192.0.2.22',verify:siteverify(answer)})).body.code,'forbidden');
  assert.equal((await publicGateway(a,submission(records,'public-form',publicValues()),{ip:'192.0.2.23',verify:siteverify(()=>new Response('x'.repeat(9000)))})).body.code,'unavailable');
  assert.equal((await publicGateway(a,submission(records,'public-form',publicValues()),{ip:'192.0.2.23',verify:siteverify(()=>new Response(null,{status:302,headers:{location:'https://example.org'}}))})).body.code,'unavailable');
  assert.equal((await publicGateway(a,submission(records,'public-form',publicValues()),{ip:'192.0.2.23',verify:async()=>{throw Error('offline');}})).body.code,'unavailable');
  assert.equal(await row("SELECT count(*) n FROM module_records WHERE submitter_kind='public'").then(r=>r.n),0);
  // A verified anonymous submission still needs a published website (repeated inside the commit).
  assert.equal((await publicGateway(a,submission(records,'public-form',publicValues()),{ip:'192.0.2.24',verify:good(records)})).body.code,'unavailable');
  await publish(a);
  assert.equal((await publicGateway(a,submission(records,'public-form',publicValues()),{ip:'192.0.2.24',verify:good(records)})).body.code,'unavailable','Publication alone cannot activate anonymous intake');
  await activation(a,'requests');
  const ok=submission(records,'public-form',publicValues()),sent=await publicGateway(a,ok,{ip:'192.0.2.24',verify:good(records)});assert.equal(sent.status,200,JSON.stringify(sent.body));
  assert.deepEqual(Object.keys(sent.body.result).sort(),['accepted','entryId','formId']);assert.ok(!markers.some(x=>JSON.stringify(sent.body).includes(x)));
  const saved=await row('SELECT * FROM module_records WHERE id=?',sent.body.result.entryId);assert.equal(saved.submitter_kind,'public');assert.equal(saved.visitor_id,null);
  // An exact replay reads the receipt back without another verification or allowance; a changed payload conflicts.
  const before=calls,replay=await publicGateway(a,ok,{ip:'192.0.2.24',verify:good(records)});assert.equal(replay.body.receipt.replayed,true);assert.equal(calls,before);
  assert.equal((await publicGateway(a,{...ok,input:{values:publicValues()}},{ip:'192.0.2.24',verify:good(records)})).body.code,'request_conflict');
  assert.equal((await publicGateway(a,submission(records,'public-form',{...publicValues(),topic:'other'}),{ip:'192.0.2.25',verify:good(records)})).body.code,'invalid_request');
  // Projection: the owner sees the anonymous record without a visitor id; staff views include it; no visitor owns it.
  const listed=await workspace(a,`/api/projects/${a.project}/module-records/${records.id}/request`),item=listed.body.items.find(i=>i.entryId===saved.id);
  assert.equal(item.submittedBy,'public');assert.equal(item.visitorId,null);assert.ok(Object.hasOwn(item.values,'name'));
  assert.ok((await gateway(a,listView(records,'desk'),s1)).body.result.items.some(i=>i.entryId===saved.id));
  assert.ok(!(await gateway(a,listView(records,'mine'),v1)).body.result.items.some(i=>i.entryId===saved.id));
  assert.equal((await gateway(a,get(records,saved.id),v1)).body.code,'not_found');
  // One connection: the contact allowance (10 per project per UTC day, shared with the contact form, counted before verification).
  let refused=0;for(let n=0;n<11;n++){const r=await publicGateway(a,submission(records,'public-form',publicValues()),{ip:'203.0.113.77',verify:good(records)});if(r.status===429){assert.equal(r.body.code,'limited');refused++;}}
  assert.equal(refused,1);
  assert.ok(!JSON.stringify(await rows('SELECT * FROM public_client_usage')).includes('203.0.113'),'Only hashed client keys are stored');
  // A public-only instance needs no access dependency; the hourly project cap is atomic and owner removal never recycles it.
  const enquiries={id:'enquiries',kind:'records',...pins('records'),dependencies:[],config:{retentionDays:90,schemas:[{id:'enquiry',fieldsRevision:1,fields:[{key:'message',label:'Message',type:'text',optional:false,read:'owner'}],staffWrite:[]}],
   forms:[{id:'ask',recordId:'enquiry',submit:'public',uploadCollectionId:null}],views:[]}};
  await configureFixtureModules(b.scope,b.user,b.project,[accessInstance,recordsInstance(),enquiries]);await publish(b);await activation(b,'enquiries');
  const ask=await instance(b,'enquiries'),askGood=siteverify({success:true,hostname:new URL(b.host).hostname,action:'module-form',cdata:ask.id});
  const askOne=(n)=>publicGateway(b,envelope(ask,'forms.submit',{target:{formId:'ask'},input:{values:{message:value('enquiry')}}}),{ip:`198.51.100.${n}`,verify:askGood});
  const results=await Promise.all(Array.from({length:21},(_,n)=>askOne(n+1)));
  assert.equal(results.filter(r=>r.status===200).length,20);assert.equal(results.filter(r=>r.status===429&&r.body.code==='limited').length,1);
  const oneEntry=results.find(r=>r.status===200).body.result.entryId,removed=await ownerCall(b,envelope(ask,'records.remove',{target:{recordId:'enquiry',entryId:oneEntry}}));assert.equal(removed.status,200);
  assert.equal((await askOne(30)).body.code,'limited','Removal does not recycle the hourly allowance');
  // The operator's contact containment applies to anonymous module intake in the same way.
  await run("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'contact','project',?,0,'operator:fixture','Synthetic containment',?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'))",id(),a.project,'0'.repeat(64));
  assert.equal((await publicGateway(a,submission(records,'public-form',publicValues()),{ip:'192.0.2.26',verify:good(records)})).body.code,'limited');
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
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES('case-wh127',?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",a.user);
  await run("INSERT OR IGNORE INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) VALUES('grant-test-approver','human:approver','preservation_approver','human:test-administrator',unixepoch())"); // holds need a current preservation approver
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
  await assert.rejects(()=>run("INSERT INTO module_records VALUES(?,?,?,'request','request-form',1,'visitor',?,'{}','[]',1,?,?,unixepoch(),unixepoch(),unixepoch()+86400)",id(),theirs.id,a.project,v1.visitorId,id(),id()),/module_request_unavailable/);
 });

 await check('receipt windows: sliding instance cap, owner exemption, per-staff edit cap, replay and 30-day prune',async()=>{
  const r=await instance(a,'requests'),v6=await visitor(a),base=(await gateway(a,submission(r),v6));assert.equal(base.status,200,JSON.stringify(base.body));
  let entry=base.body.result.entryId,rev=1;const replayable=submission(r);assert.equal((await gateway(a,replayable,v2)).status,200);
  // Seed synthetic content-free receipts with the admission trigger lifted (test-only; restored in finally).
  const admit=await row("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='module_request_admit'");
  const seed=(n,age,{kind='visitor',operation='forms.submit',hash="printf('%064d',0)"}={})=>run(`INSERT INTO module_request_receipts
   WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${n})
   SELECT ?,printf('seed-%031d',abs(random())%1000000000000),?,?,?,${hash},printf('%064d',0),?,?,?,?,1,'{}',unixepoch()-? FROM n`,
   r.id,a.project,operation,kind,r.config_revision,r.activation_revision,r.module_digest,r.schema_digest,age);
  const seeded=()=>run("DELETE FROM module_request_receipts WHERE request_id LIKE 'seed-%'");
  await run('DROP TRIGGER module_request_admit');
  try{await seed(20000,25*3600);await seed(40,31*86400);await seed(5000,31*86400,{kind:'owner'});}finally{await run(admit.sql);}
  // A full instance window from yesterday no longer limits: the cap counts only the last 24 hours.
  assert.equal((await gateway(a,submission(r),v6)).status,200,'Receipts older than 24 hours do not count');
  await run('DROP TRIGGER module_request_admit');
  try{await seed(20000,60);}finally{await run(admit.sql);}
  const flooded=await gateway(a,submission(r),v6);assert.equal(flooded.status,429);assert.equal(flooded.body.code,'limited');
  assert.equal((await gateway(a,replayable,v2)).body.receipt.replayed,true,'An exact replay still reads its receipt back at the cap');
  // Owner operations are exempt: edit and removal still commit while visitors are limited.
  const edited=await ownerCall(a,change(r,entry,rev,{count:3}));assert.equal(edited.status,200,JSON.stringify(edited.body));rev++;
  const spare=(await rows("SELECT id FROM module_records WHERE instance_id=? AND visitor_id=? AND id!=? ORDER BY created_at DESC LIMIT 1",r.id,v2.visitorId,entry))[0].id;
  const removed=await ownerCall(a,removal(r,spare));assert.equal(removed.status,200,JSON.stringify(removed.body));
  // Retention prune: receipts past the 30-day replay window go (owner and visitor alike); newer ones stay.
  const before=await row("SELECT count(*) n FROM module_request_receipts WHERE request_id LIKE 'seed-%'").then(x=>x.n);
  await sharedModules.cleanupModuleRequestReceipts(db);
  assert.equal(await row("SELECT count(*) n FROM module_request_receipts WHERE created_at<=unixepoch()-?",sharedModules.moduleReceiptRetentionSeconds).then(x=>x.n),0);
  assert.equal(await row("SELECT count(*) n FROM module_request_receipts WHERE request_id LIKE 'seed-%'").then(x=>x.n),before-5040);
  assert.equal((await gateway(a,replayable,v2)).body.receipt.replayed,true,'Receipts inside the window still replay');
  await seeded();
  // Staff edits: 60 per hour per visitor identity and instance; owner edits and other staff are unaffected.
  const staffEdit=await gateway(a,change(r,entry,rev,{count:4}),s1);assert.equal(staffEdit.status,200,JSON.stringify(staffEdit.body));rev++;
  const own=await row("SELECT principal_hash h FROM module_request_receipts WHERE request_id=?",staffEdit.body.requestId);
  await run('DROP TRIGGER module_request_admit');
  const used=await row("SELECT count(*) n FROM module_request_receipts WHERE instance_id=? AND principal_hash=? AND operation='records.update' AND created_at>unixepoch()-3600",r.id,own.h).then(x=>x.n);
  try{await seed(59-used,60,{operation:'records.update',hash:`'${own.h}'`});}finally{await run(admit.sql);}
  const last=await gateway(a,change(r,entry,rev,{count:5}),s1);assert.equal(last.status,200,JSON.stringify(last.body));rev++;
  const over=await gateway(a,change(r,entry,rev,{count:6}),s1);assert.equal(over.status,429);assert.equal(over.body.code,'limited');
  assert.equal((await ownerCall(a,change(r,entry,rev,{count:6}))).status,200,'Owner edits are not capped');rev++;
  assert.equal((await gateway(a,submission(r,'staff-form'),s1)).status,200,'The edit cap does not limit submissions');
  await seeded();
  const recovered=await gateway(a,change(r,entry,rev,{count:7}),s1);assert.equal(recovered.status,200,JSON.stringify(recovered.body));
 });

 await check('records.summary@1 and the owner records panel routes: counts only, owner only',async()=>{
  const view=await m.readViewBinding(a.scope,a.user,'records-summary',a.project);assert.equal(view.status,'ready',JSON.stringify(view));assert.equal(view.binding,'records.summary@1');
  const item=view.data.items.find(i=>i.localId==='requests');assert.equal(item.resourceId,records.id);assert.equal(item.state,'active');assert.equal(item.configRevision,records.config_revision);assert.equal(item.retentionDays,30);
  const counts=Object.fromEntries((await rows("SELECT submitter_kind k,count(*) n FROM module_records WHERE instance_id=? AND expires_at>unixepoch() GROUP BY submitter_kind",records.id)).map(r=>[r.k,r.n]));
  assert.deepEqual(item.schemas[0].records,{public:counts.public??0,visitor:counts.visitor??0,staff:counts.staff??0});assert.ok(counts.public>0&&counts.visitor>0&&counts.staff>0);
  assert.deepEqual(item.forms.map(f=>[f.formId,f.submit]),[['request-form','visitor'],['staff-form','staff'],['public-form','public']]);assert.deepEqual(item.views.map(v=>v.viewId),['mine','desk']);
  // No value, label, entry id or visitor id in the binding (it may appear in a Chat temporary view and model view facts).
  const text=JSON.stringify(view);for(const x of markers)assert.ok(!text.includes(x));
  for(const leak of [v1.visitorId,first,'Name','Topic'])assert.ok(!text.includes(leak),leak);
  assert.equal((await m.readViewBinding(a.scope,a.user,'records-summary',b.project)).status,'unavailable');
  assert.equal((await m.readViewBinding(b.scope,b.user,'records-summary',a.project)).status,'unavailable');
  // The owner panel reads the same counts and then values from the list route; foreign owners and visitor cookies get nothing.
  const panel=await workspace(a,`/api/projects/${a.project}/module-records`);assert.equal(panel.status,200);assert.deepEqual(panel.body,view.data);
  assert.equal((await workspace(b,`/api/projects/${a.project}/module-records`)).status,404);
  assert.equal((await workspace(a,`/api/projects/${a.project}/module-records`,{cookie:v1.cookie})).status,401);
  // Disabled instances stay readable for the owner; the summary still never needs a paid feature grant.
  await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?',a.user);
  assert.equal((await m.readViewBinding(a.scope,a.user,'records-summary',a.project)).status,'ready');
 });

 await check('records export serializer: owner-only, current revision, visitor-scoped slice, validated import shape',async()=>{
  const {exportRecords,validateRecordsExport}=m.moduleRecordsExport,fails=async(promise,code)=>{await assert.rejects(promise,e=>{assert.equal(e?.code,code,String(e?.stack??e));return true;});};
  const current=await instance(a,'requests'),descriptor=validateDescriptor(JSON.parse(current.descriptor_json));
  assert.equal(descriptor.lifecycle.exportHook,'records-export-v1');assert.deepEqual(descriptor.ownership.data.map(x=>[x.classId,x.subject,x.export]),[['module-records','visitor','separate-approval']]);
  // Owner export needs identity and ownership only: the previous group revoked every feature grant.
  const exported=await exportRecords(a.scope,a.user,a.project,current.id,current.config_revision,{recordId:'request'});
  assert.equal(exported.format,'whumpo-module-records');assert.equal(exported.instance.resourceId,current.id);assert.equal(exported.instance.retentionDays,30);assert.equal(exported.subject,null);
  const live=await rows('SELECT id,values_json,visitor_id,submitter_kind FROM module_records WHERE instance_id=? AND expires_at>unixepoch() AND created_at>unixepoch()-30*86400 ORDER BY created_at DESC,id DESC',current.id);
  assert.ok(live.length>5&&live.length<=200);assert.equal(exported.next,null);
  assert.deepEqual(exported.records.map(r=>r.entryId),live.map(r=>r.id));
  for(const r of exported.records){const saved=live.find(x=>x.id===r.entryId);assert.deepEqual(r.values,JSON.parse(saved.values_json));assert.equal(r.visitorId,saved.visitor_id);assert.equal(r.submittedBy,saved.submitter_kind);}
  assert.deepEqual(exported.schema.fields.map(f=>f.key),JSON.parse(current.config_json).schemas[0].fields.map(f=>f.key));
  const valid=await validateRecordsExport(JSON.parse(JSON.stringify(exported)));assert.equal(valid.records.length,exported.records.length);
  // The visitor-subject slice holds only that visitor's own submissions.
  const mine=await exportRecords(a.scope,a.user,a.project,current.id,current.config_revision,{recordId:'request',visitorId:v1.visitorId});
  assert.deepEqual(mine.subject,{visitorId:v1.visitorId});assert.deepEqual(mine.records.map(r=>r.entryId),live.filter(r=>r.visitor_id===v1.visitorId).map(r=>r.id));assert.ok(mine.records.length>0);
  await validateRecordsExport(JSON.parse(JSON.stringify(mine)));
  const tampers=[x=>{x.records[0].values.urgent='yes';},x=>{x.records[0].values.extra=1;},x=>{x.schemaVersion=2;},x=>{x.extra=1;},x=>{x.records.push({...x.records[0]});},
   x=>{x.records[0].visitorId=null;},x=>{x.records[0].values.topic='other';},x=>{delete x.records[0].values.name;},x=>{x.schema.fields[0].type='email';},x=>{x.instance.retentionDays=60;},x=>{x.recordsSha256='0'.repeat(64);}];
  for(const tamper of tampers){const copy=JSON.parse(JSON.stringify(exported));tamper(copy);await fails(validateRecordsExport(copy),'invalid_request');}
  const scoped=JSON.parse(JSON.stringify(mine));scoped.subject.visitorId=v2.visitorId;await fails(validateRecordsExport(scoped),'invalid_request');
  // Foreign owners, other kinds, stale revisions, unknown schemas, foreign visitors, bad cursors and a raw database are refused.
  await fails(exportRecords(b.scope,b.user,a.project,current.id,current.config_revision,{recordId:'request'}),'not_found');
  await fails(exportRecords(a.scope,a.user,a.project,(await instance(a,'members')).id,(await instance(a,'members')).config_revision,{recordId:'request'}),'not_found');
  await fails(exportRecords(a.scope,a.user,a.project,current.id,current.config_revision+1,{recordId:'request'}),'stale_configuration');
  await fails(exportRecords(a.scope,a.user,a.project,current.id,current.config_revision,{recordId:'missing'}),'not_found');
  await fails(exportRecords(a.scope,a.user,a.project,current.id,current.config_revision,{recordId:'request',visitorId:bv.visitorId}),'not_found');
  await fails(exportRecords(a.scope,a.user,a.project,current.id,current.config_revision,{recordId:'request',after:'not a cursor'}),'invalid_request');
  await fails(exportRecords(db,a.user,a.project,current.id,current.config_revision,{recordId:'request'}),'proof_required');
  // A descriptor that does not name the hook is refused (the hook table is the only authority).
  await run("UPDATE module_instances SET descriptor_json=json_set(descriptor_json,'$.lifecycle.exportHook',NULL) WHERE id=?",current.id);
  await fails(exportRecords(a.scope,a.user,a.project,current.id,current.config_revision,{recordId:'request'}),'unavailable');
  await run('UPDATE module_instances SET descriptor_json=? WHERE id=?',current.descriptor_json,current.id);
 });

 await check('visitor values stay out of Chat, receipts, events and logs; closure counts and cascades',async()=>{
  for(const t of ['chat_turns','module_request_receipts','module_record_events','module_activation_reviews','activity_events']){const dump=JSON.stringify(await rows('SELECT * FROM '+t));for(const x of markers)assert.ok(!dump.includes(x),t);}
  const chat=JSON.stringify(await m.readChat(a.scope,a.user));for(const x of markers)assert.ok(!chat.includes(x));
  for(const kind of ['modules','records-summary']){const view=JSON.stringify(await m.readViewBinding(a.scope,a.user,kind,a.project));for(const x of markers)assert.ok(!view.includes(x));}
  for(const x of markers)assert.ok(!logs.join('\n').includes(x));
  const inventory=await accountClosureInventory(db,a.user);assert.equal(inventory.counts.moduleRecords,await count(a));assert.ok(inventory.counts.moduleRecords>20);
  await run('DELETE FROM module_instances WHERE project_id=?',b.project);
  for(const t of ['module_records','module_record_events'])assert.equal((await row(`SELECT count(*) n FROM ${t} WHERE project_id=?`,b.project)).n,0,t);
 });


 await check('fixed contact records reuse the unchanged inbox, private scope, settings revision and retention',async()=>{
  const c=await owner();await publish(c);
  const turn=id(),review=await m.sendChat(c.scope,c.user,{id:turn,revision:await revision(c),content:'/contact-on '+c.project});assert.equal(review.status,200);
  assert.equal((await m.sendChat(c.scope,c.user,{id:id(),revision:await revision(c),content:'/confirm-contact '+turn})).status,200);
  const contact=await m.contacts.activeContact(db,c.project),message={id:id(),name:value('contact-name'),email:'synthetic@example.invalid',message:'Private <script> & '.repeat(90)};
  await m.contacts.saveContact(db,c.project,contact.revision,message);
  const summary=(await workspace(c,`/api/projects/${c.project}/module-records`)).body,fixed=summary.items.find(i=>i.localId==='contact-inbox');
  assert.ok(fixed);assert.equal(fixed.retentionDays,30);assert.equal(fixed.state,'active');assert.equal(fixed.schemas[0].records.public,1);
  for(const leak of [message.id,message.name,message.message])assert.ok(!JSON.stringify(summary).includes(leak));
  const resource={id:fixed.resourceId,config_revision:fixed.configRevision},request=envelope(resource,'records.get',{target:{recordId:'messages',entryId:message.id}});
  const owned=await ownerCall(c,request);assert.equal(owned.status,200,JSON.stringify(owned.body));assert.deepEqual(owned.body.result.values,{name:message.name,email:message.email,message:message.message.trim()});
  const page=(await workspace(c,`/api/projects/${c.project}/module-records/${fixed.resourceId}/messages`)).body;assert.equal(page.removal,'contact');assert.deepEqual(page.items[0],owned.body.result);
  const inbox=await m.contacts.contactInbox(c.scope,c.user,c.project);assert.equal(inbox.messages[0].message,page.items[0].values.message);
  assert.equal((await ownerCall(c,envelope(resource,'records.view',{target:{viewId:'inbox',cursor:null}}))).body.result.items.length,1);
  assert.equal((await gateway(c,request,null)).body.code,'forbidden');assert.equal((await ownerCall(b,request)).body.code,'not_found');
  assert.equal((await workspace(b,`/api/projects/${c.project}/module-records/${fixed.resourceId}/messages`)).status,404);
  for(const operation of ['forms.submit','records.update','records.remove'])assert.equal((await ownerCall(c,envelope(resource,operation,{target:{recordId:'messages',entryId:message.id}}))).body.code,'forbidden');
  assert.equal((await ownerCall(c,{...request,configRevision:fixed.configRevision+1})).body.code,'stale_configuration');
  await publish(c);assert.equal((await workspace(c,`/api/projects/${c.project}/module-records`)).body.items.find(i=>i.localId==='contact-inbox').state,'inactive');
  assert.equal((await ownerCall(c,request)).status,200,'Existing owner messages survive public intake disable');
  assert.equal((await workspace(c,`/api/contact-messages/${message.id}`,{method:'DELETE'})).status,200);
  assert.equal((await ownerCall(c,request)).body.code,'not_found');assert.ok(await row('SELECT 1 FROM contact_receipts WHERE id=?',message.id),'Original anti-resurrection receipt remains');
 });


 await check('public form activation pins the exact website revision and requires a new review after publication',async()=>{
  const c=await owner();await configureFixtureModules(c.scope,c.user,c.project,[accessInstance,recordsInstance()]);await activation(c,'members');await activation(c,'requests');
  const records=await instance(c,'requests'),v=await visitor(c),principal={kind:'public',projectId:c.project};
  const submit=database=>sharedModules.handleModuleRequest(database,principal,submission(records,'public-form'),undefined,{publicAdmission:async()=>{}});
  assert.equal((await row('SELECT r.publication_revision FROM module_activations a JOIN module_activation_reviews r ON r.id=a.review_id WHERE a.instance_id=?',records.id)).publication_revision,null);
  await publish(c);await fails(submit(db),'unavailable');await activation(c,'requests');
  const pinned=await row('SELECT r.publication_revision FROM module_activations a JOIN module_activation_reviews r ON r.id=a.review_id WHERE a.instance_id=?',records.id);
  assert.equal(pinned.publication_revision,(await row('SELECT revision FROM publications WHERE project_id=?',c.project)).revision);await submit(db);
  await publish(c);await fails(submit(db),'unavailable');assert.equal((await gateway(c,submission(records),v)).status,200,'Signed-in visitor form is independent of website publication');
  const review=await control(c,{type:'moduleActivationReview',projectId:c.project,instanceId:'requests',action:'activate'});assert.equal(review.status,200);
  const stored=await row('SELECT * FROM module_activation_reviews WHERE id=?',review.id);await publish(c);
  const stale=await control(c,{type:'moduleActivationApply',reviewId:stored.id,reviewDigest:stored.review_digest,expectedRevision:stored.expected_activation_revision});assert.equal(stale.status,409);
  await activation(c,'requests');await submit(db);
  const before=(await row('SELECT count(*) n FROM module_records WHERE instance_id=?',records.id)).n;
  const changedDuringCommit=interceptDatabase(db,/^INSERT INTO module_records/,()=>publish(c));
  await fails(submit(changedDuringCommit),'unavailable');assert.equal((await row('SELECT count(*) n FROM module_records WHERE instance_id=?',records.id)).n,before,'Changed publication rolls back the whole request');
 });

 await check('approved own uploads attach atomically; record reads intersect current files scope and safety',async()=>{
  const c=await owner(),d=await owner();
  const media={id:'uploads',kind:'files',...pins('files'),dependencies:['members'],config:{collections:[
   {id:'proofs',read:'submitter',upload:['visitor','staff'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:{audience:'visitor'}},
   {id:'private-proof',read:'owner',upload:['staff'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:null}]}};
  const forms={...recordsInstance(),dependencies:['members','uploads']};forms.config={...forms.config,forms:[
   {id:'request-form',recordId:'request',submit:'visitor',uploadCollectionId:'proofs'},
   {id:'staff-form',recordId:'request',submit:'staff',uploadCollectionId:'private-proof'}]};
  const currentSpec=JSON.parse((await row('SELECT v.spec_json FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=?',c.project)).spec_json);
  assert.throws(()=>m.validateSpecification({...currentSpec,instances:[accessInstance,media,{...forms,config:{...forms.config,forms:[{...forms.config.forms[0],submit:'public'}]}}]}),e=>e.code==='INCOMPATIBLE','Anonymous attachment configuration is refused by the current compiler');
  for(const o of [c,d]){await configureFixtureModules(o.scope,o.user,o.project,[accessInstance,media,forms]);for(const kind of ['members','uploads','requests'])await activation(o,kind);}
  const submitter=await visitor(c),other=await visitor(c),staff=await visitor(c),foreign=await visitor(d);await setRole(c,staff.visitorId,'grant');
  const records=await instance(c,'requests'),files=await instance(c,'uploads'),foreignFiles=await instance(d,'uploads');
  const bytes=new Uint8Array(execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(16,16),(20,40,60)).save(sys.stdout.buffer,format='JPEG')"]));
  const objects=new Map(),FILES={put:async(key,data)=>{objects.set(key,new Uint8Array(data));return {key};},get:async key=>{const data=objects.get(key);return data?{size:data.length,arrayBuffer:async()=>data.slice().buffer,body:{cancel:async()=>{}}}:null;}};
  async function upload(o,resource,v,collectionId='proofs'){
   const payload=envelope(resource,'files.putBytes',{target:{collectionId},input:{mediaType:'image/jpeg',byteLength:bytes.length,sha256:Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex')}});
   const response=await appGateway.applicationGateway(new Request(o.host+'/modules/upload',{method:'POST',headers:{origin:o.host,cookie:v.cookie,'content-type':'image/jpeg','whumpo-module-request':Buffer.from(JSON.stringify(payload)).toString('base64url')},body:bytes}),{...env,FILES});
   const result=await response.json();assert.equal(response.status,200,JSON.stringify(result));return result.result.fileId;
  }
  const approve=file=>run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-attachment',expires_at=? WHERE file_id=?",new Date(Date.now()+3600000).toISOString(),file);
  const block=file=>run("UPDATE project_photo_safety SET state='blocked',sexual_check='matched',scanner_reference='synthetic-attachment-block',expires_at=NULL WHERE file_id=?",file);
  const own=await upload(c,files,submitter),others=await upload(c,files,other),foreignFile=await upload(d,foreignFiles,foreign),privateFile=await upload(c,files,staff,'private-proof');
  const send=(file,who=submitter,form='request-form')=>{const payload=submission(records,form);payload.input.attachments=file===null?[]:[{fileId:file}];return {payload,run:()=>gateway(c,payload,who)};};
  assert.equal((await send(own).run()).body.code,'not_found','Pending uploads cannot be attached');
  assert.equal((await gateway(c,send(null).payload,null)).body.code,'forbidden');
  assert.equal((await ownerCall(c,send(null).payload)).body.code,'forbidden');
  for(const file of [own,others,foreignFile,privateFile])await approve(file);
  for(const file of [others,foreignFile,privateFile])assert.equal((await send(file).run()).body.code,'not_found','Foreign uploader, project and collection are indistinguishable');
  const accepted=send(own),saved=await accepted.run();assert.equal(saved.status,200,JSON.stringify(saved.body));const entry=saved.body.result.entryId;
  assert.equal((await accepted.run()).body.receipt.replayed,true);assert.equal((await gateway(c,{...accepted.payload,input:{...accepted.payload.input,attachments:[]}},submitter)).body.code,'request_conflict');
  for(const attachments of [[{fileId:own},{fileId:own}],Array.from({length:5},()=>({fileId:id()})),[{fileId:own,sha256:'0'.repeat(64)}],null])assert.equal((await gateway(c,{...send(own).payload,input:{...accepted.payload.input,attachments}},submitter)).body.code,'invalid_request');
  assert.equal((await send(null).run()).status,200,'Attachments are optional on a configured form');
  await assert.rejects(()=>run("UPDATE module_records SET attachments_json='[]',revision=revision+1,last_request_id=? WHERE id=?",id(),entry),/module_request_stale/);
  const ownRead=await gateway(c,get(records,entry),submitter);assert.equal(ownRead.body.result.attachments[0].fileId,own);assert.equal(ownRead.body.result.attachments[0].resourceId,files.id);
  assert.equal((await gateway(c,get(records,entry),staff)).body.result.attachments[0].fileId,own);
  assert.equal((await gateway(c,get(records,entry),other)).body.code,'not_found');
  const privateSaved=await send(privateFile,staff,'staff-form').run();assert.equal(privateSaved.status,200,JSON.stringify(privateSaved.body));
  assert.deepEqual((await gateway(c,get(records,privateSaved.body.result.entryId),staff)).body.result.attachments,[],'Reading a record never grants its owner-only file');
  assert.equal((await ownerCall(c,get(records,privateSaved.body.result.entryId))).body.result.attachments[0].fileId,privateFile);
  const exported=await m.moduleRecordsExport.exportRecords(c.scope,c.user,c.project,records.id,records.config_revision,{recordId:'request',visitorId:submitter.visitorId});
  assert.equal(exported.records.find(r=>r.entryId===entry).attachments[0].fileId,own);await m.moduleRecordsExport.validateRecordsExport(exported);
  const changed=structuredClone(exported);changed.records[0].attachments=[{fileId:own,resourceId:files.id,collectionId:'proofs',sha256:'x',configRevision:files.config_revision}];changed.recordsSha256=await m.hashToken(JSON.stringify(changed.records));
  await fails(m.moduleRecordsExport.validateRecordsExport(changed),'invalid_request');
  // Safety changes after preflight still win in the committing trigger. The entire record/event/receipt rolls back.
  const before=(await row('SELECT count(*) n FROM module_records WHERE instance_id=?',records.id)).n;
  const principal=await moduleAccess.visitorPrincipal(db,submitter.session,c.project,records.id);
  assert.equal(principal.kind,'visitor');
  const late=interceptDatabase(db,/^INSERT INTO module_records/,()=>block(own));
  await fails(sharedModules.handleModuleRequest(late,principal,send(own).payload),'stale_configuration');
  assert.equal((await row('SELECT count(*) n FROM module_records WHERE instance_id=?',records.id)).n,before);
  for(const who of [submitter,staff])assert.deepEqual((await gateway(c,get(records,entry),who)).body.result.attachments,[]);
  assert.deepEqual((await ownerCall(c,get(records,entry))).body.result.attachments,[],'Blocked file identifiers disappear for owner too');
  const removable=await upload(c,files,submitter);await approve(removable);const second=await send(removable).run();assert.equal(second.status,200);
  const removing=interceptDatabase(db,/^INSERT INTO module_records/,()=>run('DELETE FROM project_files WHERE id=?',removable));
  await fails(sharedModules.handleModuleRequest(removing,principal,send(removable).payload),'stale_configuration');
  assert.deepEqual((await ownerCall(c,get(records,second.body.result.entryId))).body.result.attachments,[],'Removed uploads leave records intact but no stale link');
  assert.equal((await row('SELECT count(*) n FROM module_records WHERE instance_id=?',records.id)).n,before+1);
  await setRole(c,staff.visitorId,'revoke');assert.equal((await gateway(c,get(records,entry),staff)).body.code,'not_found');
 });

 await check('bounded enquiry authoring: exact owner review, recovery, save, activation, signed submission and private panel',async()=>{
  const c=await owner(),d=await owner(),setup={type:'recordsModuleReview',projectId:c.project,attachment:null};
  const summary=async()=>{const r=await workspace(c,`/api/projects/${c.project}/module-records`);assert.equal(r.status,200);return r.body;};
  assert.equal((await summary()).setup.state,'access-required');assert.equal((await control(c,setup)).status,409);
  await configureFixtureModules(c.scope,c.user,c.project,[accessInstance]);await activation(c,'members');
  assert.deepEqual((await summary()).setup,{state:'not-configured',instanceId:null,attachmentCollections:[]});
  for(const action of [{...setup,schema:{}},{...setup,attachment:{instanceId:'uploads',collectionId:'proofs',fileId:id()}},{...setup,attachment:{}},{...setup,attachment:{instanceId:'bad/id',collectionId:'proofs'}},{type:'recordsModuleReview',projectId:c.project}])assert.ok(!m.chatControl(action));
  assert.equal((await control(d,setup)).status,404);
  const input={id:id(),revision:await revision(c),action:setup};
  const first=await m.sendChatControl(c.scope,c.user,input);assert.equal(first.status,200,first.error);
  const q=await row('SELECT * FROM project_spec_proposals WHERE id=?',input.id),spec=JSON.parse(q.spec_json),standard=spec.instances.at(-1);
  assert.equal(standard.id,'visitor-enquiries');assert.deepEqual(standard.dependencies,['members']);assert.equal(standard.config.retentionDays,90);
  assert.deepEqual(standard.config.schemas[0].fields.map(f=>[f.key,f.read,f.optional]),[['name','submitter',false],['message','submitter',false]]);
  assert.deepEqual(standard.config.schemas[0].staffWrite,[]);assert.equal(standard.config.forms[0].submit,'visitor');assert.equal(standard.config.forms[0].uploadCollectionId,null);
  assert.equal(standard.config.views[0].scope,'own');assert.deepEqual({module:standard.module,schema:standard.schema},pins('records'));
  assert.equal((await m.sendChatControl(c.scope,c.user,input)).status,200,'Lost review response recovers the same turn');
  assert.equal((await row('SELECT count(*) n FROM project_spec_proposals WHERE id=?',input.id)).n,1);
  const synthetic=async(action=setup)=>{const t=id(),r=await revision(c)+1;await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,action_json) VALUES(?,?,?,'Synthetic enquiry setup','',strftime('%Y-%m-%dT%H:%M:%fZ','now'),?)",t,c.user,r,JSON.stringify(action));await run('UPDATE workspace_state SET revision=? WHERE user_id=?',r,c.user);return t;};
  const copy=(turn,json)=>run('INSERT INTO project_spec_proposals SELECT ?,user_id,project_id,operation,expected_revision,draft_revision,base_version_id,target_version_id,base_digest,request_hash,proposal_digest,spec_digest,manifest_digest,policy_version,expires_at,?,lock_json,manifest_json,config_json,html,html_digest,diff_json,envelope_json FROM project_spec_proposals WHERE id=?',turn,json,q.id);
  const tamper=[s=>s.instances.at(-1).config.retentionDays=365,s=>s.instances.at(-1).config.forms[0].submit='public',s=>s.instances.at(-1).config.schemas[0].fields[1].read='owner',s=>s.instances.at(-1).dependencies=[],s=>s.instances.at(-1).config.schemas[0].staffWrite=['message'],s=>s.name='Changed',s=>s.instances[0].config.roles=[]];
  for(const change of tamper){const bad=structuredClone(spec);change(bad);await assert.rejects(copy(await synthetic(),JSON.stringify(bad)),/specification_changed/);}
  await assert.rejects(copy(await synthetic({...setup,projectId:d.project}),q.spec_json),/specification_changed/);
  await copy(await synthetic(),q.spec_json);
  assert.equal(await instance(c,'visitor-enquiries'),null,'Preparation registers no module');
  const save={type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision};
  const saveInput={id:id(),revision:await revision(c),action:save};assert.equal((await m.sendChatControl(c.scope,c.user,saveInput)).status,200);
  assert.equal((await m.sendChatControl(c.scope,c.user,saveInput)).status,200,'Saved response loss is replayed without a second version');
  assert.equal((await row('SELECT count(*) n FROM project_spec_applies WHERE proposal_id=?',q.id)).n,1);
  assert.equal((await summary()).setup.state,'saved');assert.equal(await instance(c,'visitor-enquiries'),null,'Saving does not activate');
  assert.equal((await control(c,setup)).status,400);
  await activation(c,'visitor-enquiries');const records=await instance(c,'visitor-enquiries'),v=await visitor(c),other=await visitor(c);
  const values={name:value('preset-name'),message:value('preset-message')},payload=envelope(records,'forms.submit',{target:{formId:'enquiry'},input:{values}});
  assert.equal((await gateway(c,payload,null)).body.code,'forbidden');assert.equal((await ownerCall(c,payload)).body.code,'forbidden');
  const sent=await gateway(c,payload,v);assert.equal(sent.status,200,JSON.stringify(sent.body));assert.equal((await gateway(c,payload,v)).body.receipt.replayed,true);assert.equal(await count(c),1);
  const entryId=sent.body.result.entryId,read=envelope(records,'records.get',{target:{recordId:'enquiry',entryId}});
  assert.deepEqual((await gateway(c,read,v)).body.result.values,values);assert.equal((await gateway(c,read,other)).body.code,'not_found');
  const ownView=await gateway(c,envelope(records,'records.view',{target:{viewId:'mine',cursor:null}}),v);assert.deepEqual(ownView.body.result.items[0].values,values);
  const panel=(await workspace(c,`/api/projects/${c.project}/module-records/${records.id}/enquiry`)).body;assert.deepEqual(panel.items[0].values,values);
  const facts=await summary();assert.equal(facts.setup.state,'registered');assert.equal(facts.items[0].schemas[0].records.visitor,1);
  for(const v of Object.values(values)){assert.ok(!JSON.stringify(facts).includes(v));assert.ok(!JSON.stringify(await m.readChat(c.scope,c.user)).includes(v));assert.ok(!JSON.stringify(await m.readViewBinding(c.scope,c.user,'records-summary',c.project)).includes(v));}
  assert.equal((await row('SELECT count(*) n FROM publications WHERE project_id=?',c.project)).n,0);assert.equal((await row('SELECT count(*) n FROM module_access_roles WHERE project_id=?',c.project)).n,0);
  await auth.revokeAppVisitor(c.scope,c.user,c.project,v.visitorId);assert.equal((await gateway(c,payload,v)).body.code,'forbidden','Saved receipt cannot revive revoked visitor authority');
  assert.deepEqual((await ownerCall(c,read)).body.result.values,values,'Owner keeps revoked visitor records');
  const prompt=m.agentPrompt({})+m.agentPrompt({},'website');for(const text of ['recordsModuleReview','review-enquiry-setup'])assert.ok(!prompt.includes(text));
 });

 await check('enquiry authoring only selects current same-project visitor uploads and refuses stale reviews or disabled dependencies',async()=>{
  const c=await owner(),d=await owner();
  const files={id:'visitor-files',kind:'files',...pins('files'),dependencies:['members'],config:{collections:[
   {id:'visitor-uploads',read:'submitter',upload:['visitor'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:{audience:'visitor'}},
   {id:'staff-uploads',read:'staff',upload:['staff'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:null},
   {id:'private-uploads',read:'owner',upload:['visitor'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:null}]}};
  for(const o of [c,d]){await configureFixtureModules(o.scope,o.user,o.project,[accessInstance,files]);await activation(o,'members');await activation(o,'visitor-files');}
  const attachment={instanceId:'visitor-files',collectionId:'visitor-uploads'},setup={type:'recordsModuleReview',projectId:c.project,attachment};
  const summary=async()=>(await workspace(c,`/api/projects/${c.project}/module-records`)).body.setup;
  assert.deepEqual((await summary()).attachmentCollections,[attachment]);
  for(const ref of [{...attachment,instanceId:'foreign-files'},{...attachment,collectionId:'missing'},{...attachment,collectionId:'staff-uploads'},{...attachment,collectionId:'private-uploads'}])assert.equal((await control(c,{...setup,attachment:ref})).status,409);
  assert.equal((await control(d,setup)).status,404);
  await activation(c,'visitor-files','disable');assert.deepEqual((await summary()).attachmentCollections,[]);assert.equal((await control(c,setup)).status,409);await activation(c,'visitor-files');
  const first=await control(c,setup);assert.equal(first.status,200,first.error);const q=await row('SELECT * FROM project_spec_proposals WHERE id=?',first.id);
  assert.deepEqual(JSON.parse(q.spec_json).instances.at(-1).dependencies,['members','visitor-files']);assert.equal(JSON.parse(q.spec_json).instances.at(-1).config.forms[0].uploadCollectionId,'visitor-uploads');
  // A newer head restored to the same modules still makes the old exact save stale; it never silently rebases.
  const changed=structuredClone(files);changed.config.collections[0].maxBytes=1048575;
  await configureFixtureModules(c.scope,c.user,c.project,[accessInstance,changed]);assert.deepEqual((await summary()).attachmentCollections,[],'Saved but unactivated file configuration is not offered');assert.equal((await control(c,setup)).status,409);
  await configureFixtureModules(c.scope,c.user,c.project,[accessInstance,files]);
  await assert.rejects(control(c,{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision}),e=>e.status===409,'A changed head requires a fresh exact review');
  const fresh=await control(c,setup);assert.equal(fresh.status,200,fresh.error);const review=await row('SELECT * FROM project_spec_proposals WHERE id=?',fresh.id);
  await activation(c,'visitor-files','disable');
  const turn=id(),r=await revision(c)+1;await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,action_json) VALUES(?,?,?,'Synthetic late dependency','',datetime('now'),?)",turn,c.user,r,JSON.stringify(setup));await run('UPDATE workspace_state SET revision=? WHERE user_id=?',r,c.user);
  await assert.rejects(run('INSERT INTO project_spec_proposals SELECT ?,user_id,project_id,operation,expected_revision,draft_revision,base_version_id,target_version_id,base_digest,request_hash,proposal_digest,spec_digest,manifest_digest,policy_version,expires_at,spec_json,lock_json,manifest_json,config_json,html,html_digest,diff_json,envelope_json FROM project_spec_proposals WHERE id=?',turn,review.id),/specification_changed/,'Disabled files win inside the preparation commit');
  const saved=await control(c,{type:'specificationApply',reviewId:review.id,proposalDigest:review.proposal_digest,expectedRevision:review.expected_revision});assert.equal(saved.status,200,saved.error);
  assert.equal((await control(c,{type:'moduleActivationReview',projectId:c.project,instanceId:'visitor-enquiries',action:'activate'})).status,409,'Saved config never bypasses current inactive dependencies');
  await activation(c,'visitor-files');await activation(c,'visitor-enquiries');
  const records=await instance(c,'visitor-enquiries'),v=await visitor(c),payload=envelope(records,'forms.submit',{target:{formId:'enquiry'},input:{values:{name:value('optional-name'),message:value('optional-message')},attachments:[]}});
  assert.equal((await gateway(c,payload,v)).status,200,'Optional attachments permit an empty list');
  assert.equal((await gateway(c,{...payload,requestId:id(),input:{...payload.input,attachments:[{fileId:id()}]}},v)).body.code,'not_found','Arbitrary foreign refs confer no file authority');
  const principal=await moduleAccess.visitorPrincipal(db,v.session,c.project,records.id);
  const late=interceptDatabase(db,/^INSERT INTO module_records/,()=>auth.revokeAppVisitor(c.scope,c.user,c.project,v.visitorId));
  await fails(sharedModules.handleModuleRequest(late,principal,{...payload,requestId:id()}),'forbidden');assert.equal(await count(c),1,'Authority revocation rolls back the record and receipt');
 });

 await check('records paths never reach owner-maintenance inference',async()=>{
  const inference=/^src\/(ai|ai-chat|ai-gateway|acknowledgment|site-agent|agent-[a-z-]+|standard-ai[a-z-]*|chat|backend-chat|app-upgrade-chat|app-recovery-chat|app-page-design)\.ts$|^src\/chat-interactions\/(agent|agent-request|model-continuation|continuation)\.ts$/;
  for(const entry of ['src/shared-modules/records.ts','src/shared-modules/records-export.ts','src/shared-modules/api.ts','src/app-gateway.ts']){
   const out=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false,metafile:true,logLevel:'silent'});
   assert.deepEqual(Object.keys(out.metafile.inputs).filter(p=>inference.test(p)),[],entry+' reaches owner-maintenance inference');
   for(const name of ['AI_GATEWAY','OPENAI','ANTHROPIC','sendAIChat','agentPrompt','siteContext'])assert.ok(!out.outputFiles[0].text.includes(name),entry+' references '+name);
  }
  // The site agent does not advertise module changes or records (owner decision, October 4, 2026).
  const prompt=m.agentPrompt({})+m.agentPrompt({},'website');for(const word of ['modules.put','modules.remove','records.addField','forms.submit','records.view'])assert.ok(!prompt.includes(word),word);
  assert.equal(network,0);
 });

 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 process.stdout.write(`Shared module records passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'} — visitor/staff submissions through the visitor origin with validation, replay and conflicts, anonymous public intake through the contact admission (Turnstile, connection allowance, publication, atomic hourly cap and containment), field/record projection for owner, staff, submitter and anonymous callers on both origins, records.summary@1 counts and the owner panel routes, the owner records export serializer with its visitor-scoped slice and tamper-checked import validation, fixed contact inbox parity, approved own-upload attachments with current file policy and safety/deletion races, exact public publication review pins, bounded enquiry authoring through exact save and activation with logical attachment selection and lost-response recovery, configured views with bound cursors, staffWrite compare-and-swap updates with one winner and in-flight revocation, owner removal under safety holds, retention expiry, disable, stale configRevision, caps, sliding receipt windows with owner exemption, per-staff edit cap and 30-day receipt prune, revoked/erased visitors, closure counts and a static no-inference check. No network, model or provider use; no visitor value in Chat, receipts, events or logs.\n`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}

