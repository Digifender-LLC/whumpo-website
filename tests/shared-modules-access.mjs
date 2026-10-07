import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
import {validateDescriptor,validateManifest} from '../tools/prototypes/workload-placement.mjs';
Error.stackTraceLimit=0;
// WH-126 access module: staff role reviews, the access revision, visitor principals and the visitor-origin module
// route. Actual handlers (Chat controls, visitor passkey enrollment, the visitor gateway, the module engine, commit
// triggers and the owner view binding) run against the complete current schema in disposable SQLite, or local D1 with
// --d1. Every identity and value is synthetic. No model, provider or network is used: fetch throws.
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network or inference is available');};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const {appAuth:auth,appActivation,appGateway,appLifecycle,moduleAccess,moduleAccessExport,sharedModules}=m,{saveBackend,testBackend}=m.backend;
const runtime={fetch:async()=>Response.json({ok:true,value:{state:{},result:{}}})};
const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:runtime};
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const accessInstance=(roles=['staff'])=>({id:'members',kind:'access',...pins('access'),dependencies:[],config:{roles,enrollment:'invitation'}});
const recordsInstance={id:'requests',kind:'records',...pins('records'),dependencies:['members'],config:{retentionDays:90,
 schemas:[{id:'request',fieldsRevision:1,fields:[{key:'name',label:'Name',type:'text',optional:false,read:'owner'},{key:'note',label:'Note',type:'text',optional:true,read:'staff'}],staffWrite:['note']}],
 forms:[{id:'request-form',recordId:'request',submit:'visitor',uploadCollectionId:null}],views:[]}};

async function owner({grants=true}={}){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,'Studio '+id().slice(0,6),'Neighborhood studio');
 if(grants)for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-126 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,feature,operation);
 // WH-126: visitor identity belongs to the access instance, so no visitor application is created here.
 return {...actor,scope,user,...site,host:'https://app-'+site.project+'.whumpo.site'};
}
async function visitor(o){
 const invite=await auth.createAppInvitation(o.scope,o.user,o.project),options=await auth.appPasskeyOptions(db,o.project,'signup',false,invite.code),key=authenticator();
 const result=await auth.appPasskeyVerify(db,o.project,'signup',options.challengeToken,key.registration(options.options),false);
 return {...result,key,cookie:`__Host-whumpo-app-session-${o.project}=${result.session}`};
}
/** Instances reach the saved head only through the real owner path (project-content@5): an exact modules.put review
 * prepared as the AI turn's statements, then the recent-sign-in specificationApply control, before the activation reviews. */
async function configure(o,instances){const saved=await configureFixtureModules(o.scope,o.user,o.project,instances);assert.ok(saved);return saved;}
const revision=async(o,scope=o.scope)=>(await m.readChat(scope,o.user)).state.revision;
async function control(o,action,{scope=o.scope,turn=id()}={}){return {id:turn,...await m.sendChatControl(scope,o.user,{id:turn,revision:await revision(o,scope),action})};}
async function activation(o,instanceId,action='activate'){
 const r=await control(o,{type:'moduleActivationReview',projectId:o.project,instanceId,action});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',r.id);
 const a=await control(o,{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision});assert.equal(a.status,200,a.error);
}
const roleAction=(o,visitorId,action)=>({type:'accessRoleReview',projectId:o.project,instanceId:'members',visitorId,action});
async function roleReview(o,visitorId,action,options){const r=await control(o,roleAction(o,visitorId,action),options);assert.equal(r.status,200,r.error);return row('SELECT * FROM module_access_role_reviews WHERE id=?',r.id);}
const applyAction=r=>({type:'accessRoleApply',reviewId:r.id,reviewDigest:r.review_digest,expectedRevision:r.expected_access_revision});
const applyRole=(o,r,options)=>control(o,applyAction(r),options);
async function setRole(o,visitorId,action){const r=await roleReview(o,visitorId,action),a=await applyRole(o,r);assert.equal(a.status,200,a.error);return r;}
const instance=(o,localId)=>row('SELECT i.*,a.state,a.revision activation_revision FROM module_instances i JOIN module_activations a ON a.instance_id=i.id WHERE i.project_id=? AND i.local_id=?',o.project,localId);
const accessRevision=async o=>(await row('SELECT s.revision FROM module_access_states s JOIN module_instances i ON i.id=s.instance_id WHERE i.project_id=? AND i.local_id=?',o.project,'members')).revision;
const envelope=(resource,operation,{target=null,input=null,configRevision=resource.config_revision,requestId}={})=>({api:'whumpo-modules',version:1,operation,resourceId:resource.id,configRevision,requestId:requestId??(m.modulePolicy.moduleOperations[operation].write?id():null),target,input});
/** The visitor origin, exercised through the actual gateway with the visitor's own cookies. */
async function gateway(o,payload,{cookie='',origin=o.host,host=o.host,method='POST'}={}){
 const response=await appGateway.applicationGateway(new Request(host+'/modules',{method,headers:{'cf-connecting-ip':'192.0.2.7','content-type':'application/json',origin,cookie},body:method==='POST'?JSON.stringify(payload):undefined}),env);
 assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal(response.headers.get('cache-control'),'private, no-store');
 return {status:response.status,body:await response.json()};
}
const me=(o,access,v,options={})=>gateway(o,envelope(access,'access.me'),{cookie:v?.cookie??'',...options});
const fails=async(promise,code)=>{await assert.rejects(promise,e=>{assert.equal(e?.code,code,String(e?.stack??e));return true;});};
const ownerList=(o,access)=>sharedModules.handleModuleRequest(o.scope,{kind:'owner',userId:o.user,projectId:o.project},envelope(access,'access.list'));
const updateHandler=hook=>({'records.update':async(_db,ctx)=>{await hook?.();return {statements:[],result:{updated:Object.keys(ctx.request.target.changes)}};}});

try{
 const a=await owner(),b=await owner();
 await configure(a,[accessInstance(),recordsInstance]);await activation(a,'members');await activation(a,'requests');
 await configure(b,[accessInstance()]);await activation(b,'members');
 let access=await instance(a,'members'),records=await instance(a,'requests');const theirs=await instance(b,'members');
 // Visitors enroll into the access instance itself: neither project has a visitor application.
 const v1=await visitor(a),v2=await visitor(a),v3=await visitor(a),bv=await visitor(b);

 await check('access.me on the visitor origin; anonymous, workspace and foreign cookies get nothing',async()=>{
  assert.equal(await accessRevision(a),1);
  const mine=await me(a,access,v1);assert.equal(mine.status,200,JSON.stringify(mine.body));
  assert.deepEqual(mine.body.result,{roles:[],accessRevision:1});assert.equal(mine.body.receipt,null);
  assert.equal((await me(a,access,null)).body.code,'forbidden');
  // A workspace session cookie never authenticates on the visitor origin, even the project owner's.
  assert.equal((await me(a,access,{cookie:'__Host-whumpo_session='+a.token})).body.code,'forbidden');
  // Another project's visitor: its cookie name does not match, and a renamed cookie has no session in this project.
  assert.equal((await me(a,access,bv)).body.code,'forbidden');
  assert.equal((await me(a,access,{cookie:`__Host-whumpo-app-session-${a.project}=${bv.session}`})).body.code,'forbidden');
  // One project's resource is not reachable from another project's origin.
  assert.equal((await me(b,access,{cookie:`__Host-whumpo-app-session-${b.project}=${bv.session}`})).body.code,'not_found');
  assert.equal((await me(a,access,v1,{origin:'https://whumpo.com'})).status,403);
  assert.equal((await gateway(a,null,{method:'GET',cookie:v1.cookie})).status,404);
  assert.equal((await gateway(a,{...envelope(access,'access.me'),version:2},{cookie:v1.cookie})).body.code,'client_update_required');
  assert.equal((await gateway(a,{...envelope(access,'access.me'),target:{visitorId:v2.visitorId}},{cookie:v1.cookie})).body.code,'invalid_request');
  // Visitors cannot list or change roles; role operations through the module API stay unavailable to everyone.
  assert.equal((await gateway(a,envelope(access,'access.list'),{cookie:v1.cookie})).body.code,'forbidden');
  assert.equal((await gateway(a,envelope(access,'access.confirmRole'),{cookie:v1.cookie})).body.code,'forbidden');
  await fails(sharedModules.handleModuleRequest(a.scope,{kind:'owner',userId:a.user,projectId:a.project},envelope(access,'access.prepareRole')),'unavailable');
 });

 await check('a visitor cookie never authenticates on the workspace origin',async()=>{
  const response=await m.worker.fetch(new Request('https://whumpo.com/api/chat',{headers:{cookie:v1.cookie+'; __Host-whumpo_session='+v1.session,origin:'https://whumpo.com'}}),{...(fixture.env??{}),...env},{waitUntil(){}});
  assert.equal(response.status,401);
 });

 await check('owner access.list and access.roles@1 roster without credentials',async()=>{
  const listed=await ownerList(a,access);assert.equal(listed.result.accessRevision,1);assert.equal(listed.result.staffRole,true);
  assert.deepEqual(listed.result.visitors.map(v=>v.visitorId).sort(),[v1.visitorId,v2.visitorId,v3.visitorId].sort());assert.ok(listed.result.visitors.every(v=>!v.staff&&!v.revoked&&v.staffChangedAt===null));
  const view=await m.readViewBinding(a.scope,a.user,'access-roles',a.project);assert.equal(view.status,'ready');
  assert.equal(view.data.items.length,1);assert.equal(view.data.items[0].localId,'members');assert.equal(view.data.items[0].visitors.length,3);
  assert.ok(m.readViewComponentData(view));
  const dump=JSON.stringify(view);for(const secret of [v1.session,v1.recoveryCode,v2.session])assert.ok(!dump.includes(secret));
  assert.equal((await m.readViewBinding(a.scope,a.user,'access-roles',b.project)).status,'unavailable');
  await fails(ownerList(a,theirs),'not_found');
 });

 let grant;
 await check('exact owner grant review: recent sign-in, readback, replay and Chat card',async()=>{
  const r=await roleReview(a,v1.visitorId,'grant');grant=r;
  assert.equal(r.expected_access_revision,1);assert.equal(r.instance_id,access.id);assert.equal(r.config_revision,access.config_revision);
  const card=(await m.readChat(a.scope,a.user)).turns.find(t=>t.id===r.id);
  assert.deepEqual(card.access_role_review,{id:r.id,reviewDigest:r.review_digest,expectedRevision:1,action:'grant',instanceId:'members',visitorId:v1.visitorId});
  assert.match(card.assistant_text,/no workspace sign-in, Chat, publishing, spending or account management/);
  const stale=await workspaceSession(db,m,{account:a.user,credential:a.credential},-700),staleScope=await stale.scope();
  await assert.rejects(()=>m.sendChatControl(staleScope,a.user,{id:id(),revision:0,action:applyAction(r)}),e=>e.status===401);
  assert.equal((await control(a,{...applyAction(r),reviewDigest:'f'.repeat(64)})).status,409);
  assert.equal((await control(a,{...applyAction(r),expectedRevision:2})).status,409);
  const applied=await applyRole(a,r);assert.equal(applied.status,200,applied.error);
  assert.equal(await accessRevision(a),2);
  assert.deepEqual((await me(a,access,v1)).body.result,{roles:['staff'],accessRevision:2});
  assert.deepEqual((await me(a,access,v2)).body.result,{roles:[],accessRevision:2});
  // Lost acknowledgement: same turn reads back; a new turn reads the saved receipt; nothing applies twice.
  assert.equal((await m.sendChatControl(a.scope,a.user,{id:applied.id,revision:(await revision(a))-1,action:applyAction(r)})).status,200);
  const again=await applyRole(a,r);assert.equal(again.status,200);
  assert.match((await m.readChat(a.scope,a.user)).turns.find(t=>t.id===again.id).assistant_text,/already applied/);
  assert.equal((await row('SELECT count(*) n FROM module_access_role_applies WHERE review_id=?',r.id)).n,1);assert.equal(await accessRevision(a),2);
  assert.equal((await m.readChat(a.scope,a.user)).turns.find(t=>t.id===r.id).access_role_review,undefined);
  assert.equal((await control(a,roleAction(a,v1.visitorId,'grant'))).status,400);
  // Grants are written only by an applied review.
  await assert.rejects(()=>run("INSERT INTO module_access_roles VALUES(?,?,?,'staff','granted',?,3,unixepoch(),unixepoch())",access.id,v2.visitorId,a.project,id()),/module_access_changed/);
 });

 await check('foreign owners, non-owner workspace accounts and visitors cannot review roles',async()=>{
  assert.equal((await control(b,roleAction(a,v2.visitorId,'grant'))).status,404);
  const pending=await roleReview(a,v2.visitorId,'grant');
  assert.equal((await applyRole(b,pending)).status,404);
  // A workspace account without project ownership (a WH-054 member has no more authority) gets no visitor/staff power.
  const member=await workspaceFixture(db,m),memberScope=await member.scope();
  assert.equal((await m.sendChatControl(memberScope,member.account,{id:id(),revision:0,action:roleAction(a,v2.visitorId,'grant')})).status,404);
  assert.equal((await row('SELECT count(*) n FROM module_access_role_applies WHERE review_id=?',pending.id)).n,0);
  // Cross-project: a visitor of project B cannot be granted in project A, and B's grants do not reach A.
  assert.equal((await control(a,roleAction(a,bv.visitorId,'grant'))).status,404);
  await setRole(b,bv.visitorId,'grant');
  assert.deepEqual((await me(b,theirs,bv)).body.result.roles,['staff']);assert.equal((await me(a,access,bv)).body.code,'forbidden');
  assert.equal((await control(a,{type:'accessRoleReview',projectId:a.project,instanceId:'requests',visitorId:v2.visitorId,action:'grant'})).status,404);
 });

 await check('staff writes commit only under the current role; revocation stops in-flight commits',async()=>{
  const staff=await moduleAccess.visitorPrincipal(db,v1.session,a.project,records.id);
  assert.deepEqual(staff.roles,['staff']);assert.equal(staff.accessInstanceId,access.id);assert.equal(staff.accessRevision,2);
  const update=()=>envelope(records,'records.update',{target:{recordId:'request',changes:{note:true}},input:{}});
  const done=await sharedModules.handleModuleRequest(db,staff,update(),updateHandler());assert.equal(done.receipt.replayed,false);
  // Staff never gain owner-only operations or fields outside staffWrite.
  await fails(sharedModules.handleModuleRequest(db,staff,envelope(records,'records.remove',{target:{recordId:'request'},input:{}}),updateHandler()),'forbidden');
  await fails(sharedModules.handleModuleRequest(db,staff,envelope(records,'records.update',{target:{recordId:'request',changes:{name:true}},input:{}}),updateHandler()),'forbidden');
  const plain=await moduleAccess.visitorPrincipal(db,v2.session,a.project,records.id);assert.deepEqual(plain.roles,[]);
  await fails(sharedModules.handleModuleRequest(db,plain,update(),updateHandler()),'forbidden');
  // A forged staff principal (roles not granted) is refused inside the committing statement.
  await fails(sharedModules.handleModuleRequest(db,{...plain,roles:['staff']},update(),updateHandler()),'forbidden');
  // Revocation committed while a staff write is in flight wins.
  const revoke=await roleReview(a,v1.visitorId,'revoke');
  await fails(sharedModules.handleModuleRequest(db,staff,update(),updateHandler(async()=>{const r=await applyRole(a,revoke);assert.equal(r.status,200,r.error);})),'forbidden');
  assert.equal(await accessRevision(a),3);
  // The earlier principal is fenced on reads too; the next request derives no staff role.
  await fails(sharedModules.handleModuleRequest(db,{...staff,accessInstanceId:access.id},envelope(access,'access.me')),'forbidden');
  assert.deepEqual((await me(a,access,v1)).body.result,{roles:[],accessRevision:3});
  await fails(sharedModules.handleModuleRequest(db,await moduleAccess.visitorPrincipal(db,v1.session,a.project,records.id),update(),updateHandler()),'forbidden');
  // Replaying the original grant (same or new turn) reads its receipt and never re-grants.
  assert.equal((await applyRole(a,grant)).status,200);
  assert.equal((await row("SELECT state FROM module_access_roles WHERE instance_id=? AND visitor_id=?",access.id,v1.visitorId)).state,'revoked');
  assert.deepEqual((await me(a,access,v1)).body.result.roles,[]);
  // The replayed staff write keeps its saved receipt only after current permission is rechecked.
  const replayed=done;await fails(sharedModules.handleModuleRequest(db,await moduleAccess.visitorPrincipal(db,v1.session,a.project,records.id),{...update(),requestId:replayed.requestId},updateHandler()),'forbidden');
 });

 await check('pending reviews from before a change cannot apply; concurrent grants have one winner',async()=>{
  // The v2 grant prepared at access revision 1 is stale after the grant and revoke.
  const old=await row("SELECT * FROM module_access_role_reviews WHERE visitor_id=? AND action='grant' AND NOT EXISTS(SELECT 1 FROM module_access_role_applies x WHERE x.review_id=module_access_role_reviews.id)",v2.visitorId);
  assert.equal((await applyRole(a,old)).status,409);
  const first=await roleReview(a,v2.visitorId,'grant'),second=await roleReview(a,v2.visitorId,'grant');
  const results=await Promise.all([applyRole(a,first),applyRole(a,second)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal(await accessRevision(a),4);assert.deepEqual((await me(a,access,v2)).body.result,{roles:['staff'],accessRevision:4});
 });

 await check('revoked and erased visitors lose staff at the next request',async()=>{
  await setRole(a,v3.visitorId,'grant');const before=await accessRevision(a);
  await auth.revokeAppVisitor(a.scope,a.user,a.project,v2.visitorId);
  assert.equal(await accessRevision(a),before+1);
  assert.equal((await row("SELECT state FROM module_access_roles WHERE visitor_id=?",v2.visitorId)).state,'revoked');
  assert.equal((await me(a,access,v2)).body.code,'forbidden');
  assert.equal((await control(a,roleAction(a,v2.visitorId,'grant'))).status,403);
  assert.ok(!(await ownerList(a,access)).result.visitors.find(v=>v.visitorId===v2.visitorId).staff);
  // The visitor's own reviewed deletion erases identity, grants and role reviews; the revision advances.
  const review=await appLifecycle.prepareAppDeletion(db,v3.session,a.project),rev=await accessRevision(a);
  await appLifecycle.deleteAppAccount(db,v3.session,a.project,review.id,review.revision,'DELETE');
  assert.equal(await accessRevision(a),rev+1);
  for(const t of ['module_access_roles','module_access_role_reviews'])assert.equal((await row(`SELECT count(*) n FROM ${t} WHERE visitor_id=?`,v3.visitorId)).n,0,t);
 });

 await check('plan loss blocks grants but keeps reads and revocation; disable stops serving',async()=>{
  const v4=await visitor(a);await setRole(a,v4.visitorId,'grant');
  await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?',a.user);
  const v5=await visitor(a);
  assert.equal((await control(a,roleAction(a,v5.visitorId,'grant'))).status,403);
  assert.deepEqual((await me(a,access,v4)).body.result.roles,['staff'],'Serving does not depend on the owner subscription');
  // Disabling the access instance stops visitor/staff serving at the next request; owner list and revoke remain.
  await activation(a,'members','disable');const rev=await accessRevision(a);
  assert.equal((await me(a,access,v4)).body.code,'unavailable');
  assert.equal((await ownerList(a,await instance(a,'members'))).result.accessRevision,rev);
  await setRole(a,v4.visitorId,'revoke');assert.equal(await accessRevision(a),rev+1);
  assert.equal((await control(a,roleAction(a,v5.visitorId,'grant'))).status,409);
 });

 // WH-126 identity cutover: a fresh owner whose project has no visitor application at all.
 const c=await owner();await configure(c,[accessInstance()]);await activation(c,'members');const cAccess=await instance(c,'members');
 const jar=new Map();
 async function http(o,path,payload,{method='POST',cookie}={}){
  const headers={'cf-connecting-ip':'192.0.2.8',origin:o.host,'content-type':'application/json',cookie:cookie??[...jar].map(([k,v])=>k+'='+v).join('; ')};
  const response=await appGateway.applicationGateway(new Request(o.host+'/'+path,{method,headers,body:payload===undefined?undefined:JSON.stringify(payload)}),env);
  for(const value of response.headers.getSetCookie()){const pair=value.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}
  return {status:response.status,body:await response.json()};
 }
 let cv;
 await check('visitors and staff exist without a visitor application: enrollment, sign-in, recovery and export through the gateway',async()=>{
  assert.equal(await row('SELECT 1 FROM app_spaces WHERE project_id=?',c.project),null);
  assert.equal(await row('SELECT 1 FROM app_live_pages WHERE project_id=?',c.project),null);
  const invite=await auth.createAppInvitation(c.scope,c.user,c.project),key=authenticator();
  assert.deepEqual(Object.keys(await row('SELECT access_id,activation_revision FROM app_invitations WHERE project_id=?',c.project)),['access_id','activation_revision']);
  assert.equal((await row('SELECT access_id FROM app_invitations WHERE project_id=?',c.project)).access_id,cAccess.id);
  const options=await http(c,'auth/signup/options',{inviteCode:invite.code});assert.equal(options.status,200,JSON.stringify(options.body));
  const signup=await http(c,'auth/signup/verify',{credential:key.registration(options.body.options)});assert.equal(signup.status,200,JSON.stringify(signup.body));
  const visitorRow=await row('SELECT id,access_id FROM app_visitors WHERE project_id=?',c.project);assert.equal(visitorRow.access_id,cAccess.id);
  cv={visitorId:visitorRow.id,key,recoveryCode:signup.body.recoveryCode};
  // The application data surface stays the application's: no page, so no document route.
  assert.equal((await http(c,'data',undefined,{method:'GET'})).status,404);
  assert.deepEqual((await gateway(c,envelope(cAccess,'access.me'),{cookie:'__Host-whumpo-app-session-'+c.project+'='+jar.get('__Host-whumpo-app-session-'+c.project)})).body.result,{roles:[],accessRevision:1});
  await setRole(c,cv.visitorId,'grant');
  const session=()=>({cookie:'__Host-whumpo-app-session-'+c.project+'='+jar.get('__Host-whumpo-app-session-'+c.project)});
  assert.deepEqual((await gateway(c,envelope(cAccess,'access.me'),session())).body.result.roles,['staff']);
  // Sign out, then sign in again with the passkey and recover with the recovery code, all without an application.
  assert.equal((await http(c,'auth/logout',{})).status,200);assert.equal((await gateway(c,envelope(cAccess,'access.me'),session())).body.code,'forbidden');
  const login=await http(c,'auth/login/options',{});assert.equal(login.status,200);
  assert.equal((await http(c,'auth/login/verify',{credential:key.assertion(login.body.options,1)})).status,200);
  assert.deepEqual((await gateway(c,envelope(cAccess,'access.me'),session())).body.result.roles,['staff']);
  const recovered=await http(c,'auth/recover',{code:cv.recoveryCode,nonce:'7'.repeat(64)});assert.equal(recovered.status,200,JSON.stringify(recovered.body));cv.recoveryCode=recovered.body.recoveryCode;
  assert.equal((await row('SELECT count(*) n FROM app_passkeys WHERE visitor_id=?',cv.visitorId)).n,0,'Recovery replaces credentials');
  assert.deepEqual((await gateway(c,envelope(cAccess,'access.me'),session())).body.result.roles,['staff']);
  // The visitor's own export and deletion review are identity operations and need no application either.
  const exported=await appGateway.applicationGateway(new Request(c.host+'/export',{headers:{'cf-connecting-ip':'192.0.2.8',origin:c.host,cookie:session().cookie}}),env);
  assert.equal(exported.status,200);const doc=JSON.parse(await exported.text());assert.equal(doc.format,'whumpo-visitor-export-v1');assert.equal(doc.account.id,cv.visitorId);assert.deepEqual(doc.operations,[]);
  const deletion=await http(c,'account/deletion-review',{});assert.equal(deletion.status,200,JSON.stringify(deletion.body));
  // A workspace cookie still never authenticates as a visitor here.
  assert.equal((await gateway(c,envelope(cAccess,'access.me'),{cookie:'__Host-whumpo_session='+c.token})).body.code,'forbidden');
 });

 await check('disabling the access instance signs every visitor out; old invitations and challenges never re-admit',async()=>{
  const pendingInvite=await auth.createAppInvitation(c.scope,c.user,c.project);
  const challenge=await auth.appPasskeyOptions(db,c.project,'login',false);
  assert.ok((await row('SELECT count(*) n FROM app_sessions s JOIN app_visitors v ON v.id=s.visitor_id WHERE v.project_id=?',c.project)).n>0);
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','confirm','private-test-acceptance','synthetic WH-126 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),c.user,c.project);
  await activation(c,'members','disable');
  assert.equal((await row('SELECT count(*) n FROM app_sessions s JOIN app_visitors v ON v.id=s.visitor_id WHERE v.project_id=?',c.project)).n,0);
  assert.equal((await row('SELECT count(*) n FROM app_auth_challenges WHERE project_id=?',c.project)).n,0);
  await assert.rejects(auth.appPasskeyOptions(db,c.project,'signup',false,pendingInvite.code),e=>e.status===404);
  await assert.rejects(auth.appPasskeyVerify(db,c.project,'login',challenge.challengeToken,cv.key.assertion(challenge.options,2),false),e=>e.status===400);
  await assert.rejects(auth.createAppInvitation(c.scope,c.user,c.project),e=>e.status===409);
  await assert.rejects(()=>run("INSERT INTO app_sessions(token_hash,visitor_id) VALUES(?,?)",'a'.repeat(64),cv.visitorId),/app_session_identity/);
  // Re-activation advances the activation revision: the invitation issued before the disable stays inactive.
  await activation(c,'members');
  await assert.rejects(auth.appPasskeyOptions(db,c.project,'signup',false,pendingInvite.code),e=>e.status===403);
  const fresh=await visitor(c);assert.equal((await row('SELECT access_id FROM app_visitors WHERE id=?',fresh.visitorId)).access_id,cAccess.id);
  // The recovered visitor's old passkey was replaced by recovery; it never signs in again.
  const login=await auth.appPasskeyOptions(db,c.project,'login',false);await assert.rejects(auth.appPasskeyVerify(db,c.project,'login',login.challengeToken,cv.key.assertion(login.options,3),false),e=>e.status===401);
  await assert.rejects(()=>run("INSERT INTO app_visitors(id,project_id,access_id) VALUES(?,?,?)",id(),c.project,access.id),/app_unavailable/);
 });

 await check('one access instance per project; the visitor application consumes it and registers its document resource',async()=>{
  // One project, one visitor sign-in: the specification refuses a second access instance and the registry repeats it.
  await assert.rejects(configure(c,[accessInstance(),{...accessInstance(),id:'second'}]));
  await assert.rejects(()=>run('INSERT INTO module_instances SELECT ?,project_id,?,kind,module_digest,schema_digest,config_json,config_digest,descriptor_json,descriptor_digest,dependencies_json,config_revision,source_version_id,source_spec_digest,created_at,updated_at FROM module_instances WHERE id=?',id(),'second',cAccess.id),/module_activation_access_single/);
  assert.equal((await row("SELECT count(*) n FROM module_instances WHERE project_id=? AND kind='access'",c.project)).n,1);
  // A visitor application needs the project's access instance and binds to it; visitors enrolled earlier keep their identity.
  const d=await owner();const version=id(),test=id(),review=id();
  await saveBackend(d.scope,d.user,d.project,version,'export default ({state,input})=>({state:input,result:state})');
  await testBackend(d.scope,runtime,d.user,d.project,version,test,{state:{},input:{}});
  await assert.rejects(appActivation.prepareApplication(d.scope,d.user,d.project,review,'enable',version,test),e=>e.status===409&&/visitor access module/.test(e.message));
  await configure(d,[accessInstance()]);await activation(d,'members');const dAccess=await instance(d,'members');
  const early=await visitor(d);
  await appActivation.prepareApplication(d.scope,d.user,d.project,review,'enable',version,test);await appActivation.confirmApplication(d.scope,d.user,review);
  const space=await row('SELECT access_id,resource_id,enabled FROM app_spaces WHERE project_id=?',d.project);assert.equal(space.access_id,dAccess.id);assert.equal(space.enabled,1);
  assert.deepEqual(await m.appData.readAppData(db,early.session,d.project),{revision:0,state:{}});
  await assert.rejects(()=>run('UPDATE app_spaces SET access_id=?,revision=revision+1 WHERE project_id=?',theirs.id,d.project),/app_space_identity|app_activation_required/);
  const app=await appActivation.readApplication(d.scope,d.user,d.project);
  assert.deepEqual(app.visitorAccess,{resourceId:dAccess.id,instanceId:'members',state:'active',activationRevision:dAccess.activation_revision});
  const resource=validateDescriptor(app.resource),accessDescriptor=validateDescriptor(JSON.parse(dAccess.descriptor_json));
  assert.equal(resource.kind,'custom-function');assert.equal(resource.ref.resourceId,space.resource_id);
  assert.deepEqual(resource.dependencies.map(x=>x.ref.resourceId),[dAccess.id]);
  assert.equal(resource.module.digest,(await row('SELECT digest FROM backend_versions WHERE id=?',version)).digest);
  assert.deepEqual(resource.ownership.data.map(x=>[x.classId,x.subject,x.export]),[['visitor-app-data','visitor','separate-approval'],['application-recovery','visitor','excluded']]);
  assert.equal(validateManifest([resource,accessDescriptor]).length,2);
  const dump=JSON.stringify(app.resource);for(const secret of [early.session,early.recoveryCode,d.user])assert.ok(!dump.includes(secret));
  // Disabling the access instance leaves the application authorized but unusable until it is active again.
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','confirm','private-test-acceptance','synthetic WH-126 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),d.user,d.project);
  await activation(d,'members','disable');await assert.rejects(m.appData.readAppData(db,early.session,d.project),e=>e.status===401);
  // Enabling an application is refused while its access instance is inactive.
  const again=id();await appActivation.prepareApplication(d.scope,d.user,d.project,id(),'disable',null,null).then(r=>appActivation.confirmApplication(d.scope,d.user,r.id));
  await appActivation.prepareApplication(d.scope,d.user,d.project,again,'enable',version,test);
  await assert.rejects(appActivation.confirmApplication(d.scope,d.user,again),e=>e.status===409);
 });

 await check('roles export serializer: owner-only, current revision, validated import shape, no secrets',async()=>{
  const exported=await moduleAccessExport.exportAccessRoles(a.scope,a.user,a.project,access.id,(await instance(a,'members')).config_revision);
  assert.equal(exported.format,'whumpo-access-roles');assert.equal(exported.instance.resourceId,access.id);assert.equal(exported.instance.accessRevision,await accessRevision(a));
  assert.deepEqual(exported.roles.map(r=>r.visitorId).sort(),(await rows('SELECT visitor_id FROM module_access_roles WHERE instance_id=?',access.id)).map(r=>r.visitor_id).sort());
  assert.deepEqual(exported.roles.map(r=>[r.visitorId,r.state,r.accessRevision]),(await rows('SELECT visitor_id,state,access_revision FROM module_access_roles WHERE instance_id=? ORDER BY visitor_id',access.id)).map(r=>[r.visitor_id,r.state,r.access_revision]));
  assert.ok(exported.roles.some(r=>r.state==='revoked'),'Revocation suppressions are exported');
  const valid=await moduleAccessExport.validateAccessRolesExport(JSON.parse(JSON.stringify(exported)));assert.equal(valid.roles.length,exported.roles.length);
  for(const tamper of [x=>{x.roles[0].state='granted';x.roles[0].visitorId=id();},x=>{x.schemaVersion=2;},x=>{x.extra=1;},x=>{x.roles.push({...x.roles[0]});},x=>{x.instance.staffRole='yes';}]){
   const copy=JSON.parse(JSON.stringify(exported));tamper(copy);await fails(moduleAccessExport.validateAccessRolesExport(copy),'invalid_request');
  }
  await fails(moduleAccessExport.exportAccessRoles(b.scope,b.user,a.project,access.id,access.config_revision),'not_found');
  await fails(moduleAccessExport.exportAccessRoles(a.scope,a.user,a.project,access.id,999),'stale_configuration');
  await fails(moduleAccessExport.exportAccessRoles(a.scope,a.user,a.project,records.id,records.config_revision),'not_found');
  const descriptor=validateDescriptor(JSON.parse((await instance(a,'members')).descriptor_json));
  assert.equal(descriptor.lifecycle.exportHook,'access-roles-export-v1');
  assert.deepEqual(descriptor.ownership.data.map(x=>[x.classId,x.export]),[['visitor-identity','separate-approval'],['project-roles','eligible']]);
  const dump=JSON.stringify(exported);for(const secret of [v1.session,v1.recoveryCode,v2.session])assert.ok(!dump.includes(secret));
 });

 await check('owner visitor access setup: the typed control prepares the exact standard website review; saving and activation stay separate',async()=>{
  const e=await owner(),f=await owner(),setup={type:'accessModuleReview',projectId:e.project};
  assert.deepEqual(await m.accessSetup.readAccessSetup(e.scope,e.user,e.project),{state:'not-configured',instanceId:null});
  // The control carries the project id only; the server chooses the instance. Extra keys or a bad id are not a control.
  for(const action of [{...setup,instanceId:'visitors'},{...setup,config:{roles:['staff']}},{type:'accessModuleReview',projectId:'not-a-project'},{type:'accessModuleReview'}])assert.ok(!m.chatControl(action));
  assert.equal((await control(f,setup)).status,404,'A foreign owner cannot prepare setup');
  assert.equal(await row('SELECT count(*) n FROM project_spec_proposals WHERE project_id=?',e.project).then(r=>r.n),0);
  const prepared=await control(e,setup);assert.equal(prepared.status,200,prepared.error);
  const q=await row('SELECT * FROM project_spec_proposals WHERE id=?',prepared.id),spec=JSON.parse(q.spec_json),standard=spec.instances.at(-1);
  assert.equal(q.operation,'change');assert.deepEqual(JSON.parse(q.envelope_json).requiredReviews,['schema']);
  assert.deepEqual({id:standard.id,kind:standard.kind,dependencies:standard.dependencies,config:standard.config},{id:'visitors',kind:'access',dependencies:[],config:{roles:[],enrollment:'invitation'}});
  assert.deepEqual({module:standard.module,schema:standard.schema},pins('access'),'Current catalog pin');
  assert.deepEqual(JSON.parse(q.diff_json).map(r=>[r.label,r.before]),[['Module visitors',null]]);
  const turn=(await m.readChat(e.scope,e.user)).turns.find(t=>t.id===prepared.id);assert.deepEqual(turn.specification_review,{id:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision});
  assert.equal((await rows('SELECT id FROM module_instances WHERE project_id=?',e.project)).length,0,'Preparing registers nothing');
  // Defense in depth: a proposal bound to an accessModuleReview turn must be exactly the head plus the standard instance.
  const synthetic=async project=>{const t=id(),r=await revision(e)+1;await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,action_json) VALUES(?,?,?,'Synthetic setup turn','',strftime('%Y-%m-%dT%H:%M:%fZ','now'),?)",t,e.user,r,JSON.stringify({type:'accessModuleReview',projectId:project}));await run('UPDATE workspace_state SET revision=? WHERE user_id=?',r,e.user);return t;};
  const copy=(turnId,spec)=>run('INSERT INTO project_spec_proposals SELECT ?,user_id,project_id,operation,expected_revision,draft_revision,base_version_id,target_version_id,base_digest,request_hash,proposal_digest,spec_digest,manifest_digest,policy_version,expires_at,?,lock_json,manifest_json,config_json,html,html_digest,diff_json,envelope_json FROM project_spec_proposals WHERE id=?',turnId,spec,q.id);
  for(const tampered of [{...spec,instances:[...spec.instances.slice(0,-1),{...standard,config:{roles:['staff'],enrollment:'invitation'}}]},{...spec,instances:[...spec.instances.slice(0,-1),{...standard,id:'members'}]},{...spec,name:'Renamed'},{...spec,instances:spec.instances.slice(0,-1)}])
   await assert.rejects(copy(await synthetic(e.project),JSON.stringify(tampered)),/specification_changed/);
  await assert.rejects(copy(await synthetic(f.project),q.spec_json),/specification_changed/,'A setup turn for another project admits nothing');
  await copy(await synthetic(e.project),q.spec_json);
  // Saving is the existing recent-sign-in specificationApply; the instance is saved inactive.
  const saved=await control(e,{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision});assert.equal(saved.status,200,saved.error);
  assert.deepEqual(await m.accessSetup.readAccessSetup(e.scope,e.user,e.project),{state:'saved',instanceId:'visitors'});
  assert.equal((await m.readAppAccess(e.scope,e.user,e.project)).accessSetup.state,'saved');
  const again=await control(e,setup);assert.equal(again.status,400);assert.match(again.error,/already has a visitor access module/);
  await activation(e,'visitors');
  assert.deepEqual(await m.accessSetup.readAccessSetup(e.scope,e.user,e.project),{state:'registered',instanceId:'visitors'});
  assert.equal((await instance(e,'visitors')).state,'active');
  // A project with a non-access module already using the standard id is refused; a project without a website is told why.
  const g=await owner();await configure(g,[{id:'visitors',kind:'content',...pins('content'),dependencies:[],config:{collections:[{id:'directory',type:'directory-listing@1'}]}}]);
  const taken=await control(g,{type:'accessModuleReview',projectId:g.project});assert.equal(taken.status,400);assert.match(taken.error,/already uses the “visitors” id/);
  const h=await workspaceFixture(db,m),hScope=await h.scope(),hProject=id();
  await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'No site','','draft',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",hProject,h.account);
  assert.deepEqual(await m.accessSetup.readAccessSetup(hScope,h.account,hProject),{state:'website-required',instanceId:null});
  const none=await m.sendChatControl(hScope,h.account,{id:id(),revision:(await m.readChat(hScope,h.account)).state.revision,action:{type:'accessModuleReview',projectId:hProject}});assert.equal(none.status,404);assert.match(none.error,/private website first/);
  // The site agent is never told about module operations or this control.
  const prompt=m.agentPrompt({})+m.agentPrompt({},'website');for(const word of ['modules.put','accessModuleReview','review-visitor-access-setup'])assert.ok(!prompt.includes(word),word);
 });

 await check('applied role review history never blocks revoke or grant; pending reviews stay bounded',async()=>{
  const role=await row("SELECT * FROM module_access_roles WHERE project_id=? AND visitor_id=?",b.project,bv.visitorId);
  if(role?.state!=='granted')await setRole(b,bv.visitorId,'grant');
  const original=await row("SELECT r.* FROM module_access_role_reviews r JOIN module_access_role_applies a ON a.review_id=r.id WHERE r.project_id=? AND r.visitor_id=? AND r.action='grant' ORDER BY a.created_at DESC LIMIT 1",b.project,bv.visitorId);
  const columns=(await rows('PRAGMA table_info(module_access_role_reviews)')).map(c=>c.name).filter(c=>c!=='id');
  const applyColumns=(await rows('PRAGMA table_info(module_access_role_applies)')).map(c=>c.name).filter(c=>!['id','review_id'].includes(c));
  const lifted=await rows("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('module_access_role_review_admit','module_access_role_apply_admit','module_access_role_apply')");
  const copies=(prefix,n,pending)=>run(`INSERT INTO module_access_role_reviews(id,${columns.join(',')}) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${n})
   SELECT printf('${prefix}%07x-0000-4000-8000-%012d',i,i),${columns.map(c=>pending&&c==='created_at'?'unixepoch()':pending&&c==='expires_at'?'unixepoch()+500':c).join(',')} FROM n,module_access_role_reviews WHERE id=?`,original.id);
  // Synthetic history: 500 applied copies of the grant (admission triggers lifted, test-only).
  for(const t of lifted)await run('DROP TRIGGER '+t.name);
  try{
   await copies('a',500,false);
   await run(`INSERT INTO module_access_role_applies(id,review_id,${applyColumns.join(',')}) SELECT 'b'||substr(r.id,2),r.id,${applyColumns.map(c=>'a.'+c).join(',')} FROM module_access_role_reviews r,module_access_role_applies a WHERE r.id LIKE 'a%-0000-4000-8000-%' AND r.project_id=? AND a.review_id=?`,b.project,original.id);
  }finally{for(const t of lifted)await run(t.sql);}
  assert.ok((await row('SELECT count(*) n FROM module_access_role_reviews WHERE project_id=?',b.project)).n>500);
  await setRole(b,bv.visitorId,'revoke');assert.deepEqual((await me(b,theirs,bv)).body.result.roles,[]);
  // 500 pending (unapplied, unexpired) reviews still refuse another until they expire or are removed.
  const admit=lifted.find(t=>t.name==='module_access_role_review_admit');
  await run('DROP TRIGGER module_access_role_review_admit');try{await copies('c',500,true);}finally{await run(admit.sql);}
  assert.notEqual((await control(b,roleAction(b,bv.visitorId,'grant'))).status,200);
  await run("DELETE FROM module_access_role_reviews WHERE id LIKE 'c%-0000-4000-8000-%'");
  await setRole(b,bv.visitorId,'grant');assert.deepEqual((await me(b,theirs,bv)).body.result.roles,['staff']);
 });

 await check('closure counts, cascades and no secrets or values in Chat or rows',async()=>{
  const dump=JSON.stringify(await rows('SELECT * FROM chat_turns'))+JSON.stringify(await rows('SELECT * FROM module_access_role_reviews'))+JSON.stringify(await rows('SELECT * FROM module_request_receipts'));
  for(const secret of [v1.session,v1.recoveryCode,v2.session,bv.session])assert.ok(!dump.includes(secret));
  const inventory=await accountClosureInventory(db,a.user);
  assert.equal(inventory.counts.staffRoles,(await row("SELECT count(*) n FROM module_access_roles WHERE project_id=? AND state='granted'",a.project)).n);
  assert.equal(inventory.counts.accessRoleReceipts,(await row('SELECT count(*) n FROM module_access_role_applies WHERE user_id=?',a.user)).n);assert.ok(inventory.counts.accessRoleReceipts>=5);
  await assert.rejects(()=>run('DELETE FROM module_access_role_reviews WHERE id IN(SELECT review_id FROM module_access_role_applies WHERE user_id=?)',a.user),/module_access_receipt_retained/);
  await assert.rejects(()=>run('UPDATE module_access_states SET revision=revision+2 WHERE project_id=?',a.project),/module_access_immutable/);
  // Visitor applications have their own project-deletion path; the instance cascade alone removes every access row.
  await run('DELETE FROM module_instances WHERE project_id=?',b.project);
  for(const t of ['module_access_states','module_access_roles','module_access_role_reviews','app_visitors','app_invitations'])assert.equal((await row(`SELECT count(*) n FROM ${t} WHERE project_id=?`,b.project)).n,0,t);
 });


 await check('owner staff declaration is an exact saved configuration review, separate from activation and grants',async()=>{
  const c=await owner(),d=await owner();await configure(c,[accessInstance([])]);await activation(c,'members');
  const v=await visitor(c),before=await instance(c,'members'),setup={type:'accessStaffReview',projectId:c.project};
  for(const action of [{...setup,roles:['staff']},{...setup,visitorId:v.visitorId},{...setup,instanceId:'members'},{type:'accessStaffReview'}])assert.ok(!m.chatControl(action));
  assert.equal((await control(d,setup)).status,404);
  assert.equal((await control(d,{type:'accessStaffReview',projectId:d.project})).status,404,'Visitor access must exist first');
  const pending=await control(c,setup);assert.equal(pending.status,200,pending.error);
  const q=await row('SELECT * FROM project_spec_proposals WHERE id=?',pending.id),spec=JSON.parse(q.spec_json);
  assert.deepEqual(spec.instances.find(i=>i.kind==='access').config,{roles:['staff'],enrollment:'invitation'});
  assert.ok(JSON.parse(q.envelope_json).requiredReviews.includes('permissions'));
  assert.equal((await row('SELECT count(*) n FROM module_access_roles WHERE project_id=?',c.project)).n,0);
  assert.deepEqual(JSON.parse((await instance(c,'members')).config_json).roles,[],'Preparing cannot activate staff');
  const synthetic=async()=>{const t=id(),r=await revision(c)+1;await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,action_json) VALUES(?,?,?,'Synthetic staff setup','',strftime('%Y-%m-%dT%H:%M:%fZ','now'),?)",t,c.user,r,JSON.stringify(setup));await run('UPDATE workspace_state SET revision=? WHERE user_id=?',r,c.user);return t;};
  const copy=(turn,spec)=>run('INSERT INTO project_spec_proposals SELECT ?,user_id,project_id,operation,expected_revision,draft_revision,base_version_id,target_version_id,base_digest,request_hash,proposal_digest,spec_digest,manifest_digest,policy_version,expires_at,?,lock_json,manifest_json,config_json,html,html_digest,diff_json,envelope_json FROM project_spec_proposals WHERE id=?',turn,spec,q.id);
  for(const altered of [{...spec,name:'Unreviewed change'},{...spec,instances:[{...spec.instances[0],id:'another-access'}]},{...spec,instances:[]}])await assert.rejects(copy(await synthetic(),JSON.stringify(altered)),/specification_changed/);
  await copy(await synthetic(),q.spec_json);
  const save={type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision};
  assert.equal((await control(c,save)).status,200);assert.deepEqual(JSON.parse((await instance(c,'members')).config_json).roles,[],'Saved configuration still needs exact activation');
  assert.equal((await control(c,roleAction(c,v.visitorId,'grant'))).status,403);
  assert.equal((await control(c,setup)).status,400,'An already-saved role is not silently changed or activated');
  await activation(c,'members');const current=await instance(c,'members');assert.equal(current.config_revision,before.config_revision+1);
  assert.deepEqual((await me(c,current,v)).body.result.roles,[],'Declaring and activating staff never assigns it');
  await setRole(c,v.visitorId,'grant');assert.deepEqual((await me(c,current,v)).body.result.roles,['staff']);
  const prompt=m.agentPrompt({})+m.agentPrompt({},'website');assert.ok(!prompt.includes('accessStaffReview'));assert.ok(!prompt.includes('review-visitor-staff-setup'));
 });

 await check('terminal role receipts expire after 90 days without pruning current provenance, bypassing holds or replaying grants',async()=>{
  const c=await owner();await configure(c,[accessInstance()]);await activation(c,'members');const v=await visitor(c),access=await instance(c,'members');
  const grant=await setRole(c,v.visitorId,'grant'),revoke=await setRole(c,v.visitorId,'revoke'),pending=await roleReview(c,v.visitorId,'grant');
  const oldApply=await row('SELECT a.id,t.revision FROM module_access_role_applies a JOIN chat_turns t ON t.id=a.id WHERE a.review_id=?',grant.id);
  const savedRevision=await accessRevision(c),beforeRole=await row('SELECT * FROM module_access_roles WHERE project_id=?',c.project);
  const lifted=await rows("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('module_access_role_review_immutable','module_access_role_apply_immutable')");
  for(const t of lifted)await run('DROP TRIGGER '+t.name);
  try{
   await run('UPDATE module_access_role_reviews SET created_at=unixepoch()-91*86400,expires_at=unixepoch()-91*86400+600 WHERE project_id=?',c.project);
   await run('UPDATE module_access_role_applies SET created_at=unixepoch()-91*86400 WHERE user_id=?',c.user);
  }finally{for(const t of lifted)await run(t.sql);}
  await assert.rejects(()=>run('DELETE FROM module_access_role_reviews WHERE id=?',revoke.id),/module_access_receipt_retained/);
  await assert.rejects(()=>run('DELETE FROM module_access_role_applies WHERE review_id=?',revoke.id),/module_access_receipt_retained/,'Current receipt itself cannot be removed directly');
  const caseId=id(),holdId=id();
  const reviewer=await workspaceFixture(db,m),approver=await workspaceFixture(db,m),reviewerRef='human:'+reviewer.account,approverRef='human:'+approver.account;
  await run("INSERT INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) VALUES(?,?,'preservation_approver',?,unixepoch())",id(),approverRef,reviewerRef);
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'synthetic-role-retention',?,unixepoch(),unixepoch()+31536000)",caseId,c.user,reviewerRef);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,'project',?,'synthetic-basis',?,unixepoch(),unixepoch()+86400)",holdId,caseId,c.user,c.project,approverRef);
  await sharedModules.cleanupModuleRequestReceipts(db);assert.equal((await row('SELECT count(*) n FROM module_access_role_reviews WHERE project_id=?',c.project)).n,3);
  await assert.rejects(()=>run('DELETE FROM module_access_role_reviews WHERE id=?',pending.id),/safety_preservation_hold/);
  await run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by=?,release_ref='synthetic-release' WHERE id=?",approverRef,holdId);
  await sharedModules.cleanupModuleRequestReceipts(db);
  assert.deepEqual((await rows('SELECT id FROM module_access_role_reviews WHERE project_id=?',c.project)).map(r=>r.id),[revoke.id]);
  assert.equal((await row('SELECT count(*) n FROM module_access_role_applies WHERE user_id=?',c.user)).n,1);
  assert.equal(await accessRevision(c),savedRevision);assert.deepEqual(await row('SELECT * FROM module_access_roles WHERE project_id=?',c.project),beforeRole);
  assert.equal((await applyRole(c,grant)).status,404);assert.equal((await applyRole(c,pending)).status,404);
  const replay=await m.sendChatControl(c.scope,c.user,{id:oldApply.id,revision:oldApply.revision-1,action:applyAction(grant)});assert.equal(replay.status,200,'Historical Chat replay recovers its original receipt only');
  assert.deepEqual((await me(c,access,v)).body.result.roles,[]);assert.equal(await accessRevision(c),savedRevision);
  await setRole(c,v.visitorId,'grant');await sharedModules.cleanupModuleRequestReceipts(db);
  assert.deepEqual((await me(c,access,v)).body.result.roles,['staff'],'Only a new exact grant restores authority');
 });

 await check('access paths never reach owner-maintenance inference',async()=>{
  const inference=/^src\/(ai|ai-chat|ai-gateway|acknowledgment|site-agent|agent-[a-z-]+|standard-ai[a-z-]*|chat|backend-chat|app-upgrade-chat|app-recovery-chat|app-page-design)\.ts$|^src\/chat-interactions\/(agent|agent-request|model-continuation|continuation)\.ts$/;
  for(const entry of ['src/shared-modules/access.ts','src/shared-modules/access-roles.ts','src/shared-modules/access-setup.ts','src/app-gateway.ts']){
   const out=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false,metafile:true,logLevel:'silent'});
   assert.deepEqual(Object.keys(out.metafile.inputs).filter(p=>inference.test(p)),[],entry+' reaches owner-maintenance inference');
   for(const name of ['AI_GATEWAY','OPENAI','ANTHROPIC','sendAIChat','agentPrompt'])assert.ok(!out.outputFiles[0].text.includes(name),entry+' references '+name);
  }
  assert.equal(network,0);
 });

 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 for(const secret of [v1.session,v1.recoveryCode])assert.ok(!logs.join('\n').includes(secret));
 process.stdout.write(`Shared module access passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'} — instances saved through the exact owner specification review, access.me on the visitor origin with signed passkey visitors, workspace/foreign/anonymous cookie refusals, owner access.list and access.roles@1, exact grant/revoke reviews with recent sign-in, readback and replay without re-grant, one-winner races, in-flight revocation inside the commit, revoked/erased visitors, plan loss, disable, visitor identity owned by the access instance (gateway enrollment, sign-in, recovery, export and deletion review with no visitor application; disable signs out and old invitations never re-admit; one access instance per project; the application consumes it and its custom-function document descriptor validates against the access descriptor), the owner visitor access setup control (the exact standard website review with its shape repeated in the commit, then the separate save and activation reviews), owner staff declaration through exact save/activation reviews, bounded 90-day superseded receipt cleanup preserving current provenance and holds, the roles export serializer and its import validation, closure and cascades, and a static no-inference check. No network, model or provider use.\n`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}
