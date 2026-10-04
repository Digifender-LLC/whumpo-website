import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
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
const {appAuth:auth,appActivation,appGateway,appLifecycle,moduleAccess,sharedModules}=m,{saveBackend,testBackend}=m.backend;
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
 // The existing visitor application owns visitor identity in this slice (passkeys, invitations, recovery, sessions).
 const version=id(),test=id(),review=id();
 await saveBackend(scope,user,site.project,version,'export default ({state,input})=>({state:input,result:state})');
 await testBackend(scope,runtime,user,site.project,version,test,{state:{},input:{}});
 await appActivation.prepareApplication(scope,user,site.project,review,'enable',version,test);await appActivation.confirmApplication(scope,user,review);
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
 const v1=await visitor(a),v2=await visitor(a),v3=await visitor(a),bv=await visitor(b);
 await configure(a,[accessInstance(),recordsInstance]);await activation(a,'members');await activation(a,'requests');
 await configure(b,[accessInstance()]);await activation(b,'members');
 let access=await instance(a,'members'),records=await instance(a,'requests');const theirs=await instance(b,'members');

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
  for(const t of ['module_access_states','module_access_roles','module_access_role_reviews'])assert.equal((await row(`SELECT count(*) n FROM ${t} WHERE project_id=?`,b.project)).n,0,t);
 });

 await check('access paths never reach owner-maintenance inference',async()=>{
  const inference=/^src\/(ai|ai-chat|ai-gateway|acknowledgment|site-agent|agent-[a-z-]+|standard-ai[a-z-]*|chat|backend-chat|app-upgrade-chat|app-recovery-chat|app-page-design)\.ts$|^src\/chat-interactions\/(agent|agent-request|model-continuation|continuation)\.ts$/;
  for(const entry of ['src/shared-modules/access.ts','src/shared-modules/access-roles.ts','src/app-gateway.ts']){
   const out=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false,metafile:true,logLevel:'silent'});
   assert.deepEqual(Object.keys(out.metafile.inputs).filter(p=>inference.test(p)),[],entry+' reaches owner-maintenance inference');
   for(const name of ['AI_GATEWAY','OPENAI','ANTHROPIC','sendAIChat','agentPrompt'])assert.ok(!out.outputFiles[0].text.includes(name),entry+' references '+name);
  }
  assert.equal(network,0);
 });

 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 for(const secret of [v1.session,v1.recoveryCode])assert.ok(!logs.join('\n').includes(secret));
 process.stdout.write(`Shared module access passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'} — instances saved through the exact owner specification review, access.me on the visitor origin with signed passkey visitors, workspace/foreign/anonymous cookie refusals, owner access.list and access.roles@1, exact grant/revoke reviews with recent sign-in, readback and replay without re-grant, one-winner races, in-flight revocation inside the commit, revoked/erased visitors, plan loss, disable, closure and cascades, and a static no-inference check. No network, model or provider use.\n`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}
