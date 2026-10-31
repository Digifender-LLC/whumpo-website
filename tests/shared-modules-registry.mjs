import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules,changeFixtureWebsite,proposeFixtureWebsite,applyFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {validateDescriptor} from '../tools/prototypes/workload-placement.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
Error.stackTraceLimit=0;
// WH-125 module instance registry, exact owner activation reviews and the shared module request engine. Actual
// platform handlers (Chat controls, resolver, policy, commit triggers, view binding) run against the complete
// current schema in disposable SQLite, or local D1 with --d1. Every identity, configuration and submitted value is
// synthetic. No model, provider or network is used: AI configuration is absent and fetch throws.
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const say=text=>process.stdout.write(text+'\n');
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network or inference is available');};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const marker='VISITOR-VALUE-'+id().slice(0,8).toUpperCase(),label='LABEL-'+id().slice(0,8).toUpperCase();
const {ModuleError}=m.modulePolicy;

// Variant bundles change exactly one trusted catalog fact (withdrawn kind or a different digest) around the same handlers.
async function variant(replace){
 const plugin={name:'catalog-variant',setup(b){b.onLoad({filter:/src[\\/]project-specification[\\/]catalog\.ts$/},async args=>{const source=await readFile(args.path,'utf8'),changed=replace(source);assert.notEqual(changed,source);return {contents:changed,loader:'ts'};});}};
 const out=await build({stdin:{contents:`export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';export {hashToken,newSessionToken} from './src/security';
  export {readChat,sendChatControl} from './src/chat';export {handleModuleRequest} from './src/shared-modules/api';export {readModuleInstances} from './src/shared-modules/registry';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[plugin]});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].contents).toString('base64'));
}
const withdrawn=await variant(s=>s.replace("modulePin('records','available')","modulePin('records','withdrawn')"));
const restaged=await variant(s=>s.replace("digest:compilerArtifacts.modules[kind].module}","digest:kind==='records'?'0'.repeat(64):compilerArtifacts.modules[kind].module}"));

async function owner({plan='personal',grants=false}={}){
 const actor=await workspaceFixture(db,m),scope=await actor.scope();
 if(plan)await paidPlan(db,actor.account,plan);
 const site=await createFixtureProject(scope,actor.account,'Garden studio '+id().slice(0,6),'Neighborhood garden care');
 if(grants)for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-125 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),actor.account,site.project,feature,operation);
 return {...actor,scope,user:actor.account,...site};
}
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const accessInstance={id:'members',kind:'access',...pins('access'),dependencies:[],config:{roles:['staff'],enrollment:'invitation'}};
const recordFields=[{key:'name',label,type:'text',optional:false,read:'owner'},{key:'note',label:'Note',type:'text',optional:true,read:'staff'}];
const recordsInstance=(fields=recordFields,fieldsRevision=1)=>({id:'requests',kind:'records',...pins('records'),dependencies:['members'],
 config:{retentionDays:90,schemas:[{id:'request',fieldsRevision,fields,staffWrite:[]}],forms:[{id:'request-form',recordId:'request',submit:'public',uploadCollectionId:null}],views:[]}});
/** Instances reach the saved head only through the real owner path (project-content@6): an exact modules.put review
 * prepared as the AI turn's statements, then the recent-sign-in specificationApply control. */
const configure=(o,instances)=>configureFixtureModules(o.scope,o.user,o.project,instances);
const headSpec=async o=>JSON.parse((await row('SELECT v.spec_json FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=?',o.project)).spec_json);
/** Direct seed, used once below and only because no owner path can produce it: a destructive (migration) change is
 * refused when the specification is saved and when it is restored, so the activation layer's independent migration
 * refusal is reachable only by rewriting the head in this disposable database. Returns an undo. */
async function seedHead(o,instances){
 const head=await row('SELECT h.version_id,v.spec_json,v.spec_digest FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=?',o.project);
 const spec=m.validateSpecification({...JSON.parse(head.spec_json),instances}),trigger=await row("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='project_spec_version_immutable'");
 const write=async(json,digest)=>{await run('DROP TRIGGER project_spec_version_immutable');try{await run('UPDATE project_spec_versions SET spec_json=?,spec_digest=? WHERE version_id=?',json,digest,head.version_id);}finally{await run(trigger.sql);}};
 await write(JSON.stringify(spec),await m.jsonDigest(spec));return ()=>write(head.spec_json,head.spec_digest);
}
const revision=async(o,scope=o.scope,mod=m)=>(await mod.readChat(scope,o.user)).state.revision;
async function control(o,action,{scope=o.scope,mod=m,turn=id()}={}){return {id:turn,...await mod.sendChatControl(scope,o.user,{id:turn,revision:await revision(o,scope,mod),action})};}
async function review(o,instanceId,action,options){const r=await control(o,{type:'moduleActivationReview',projectId:o.project,instanceId,action},options);assert.equal(r.status,200,r.error);return row('SELECT * FROM module_activation_reviews WHERE id=?',r.id);}
const applyAction=r=>({type:'moduleActivationApply',reviewId:r.id,reviewDigest:r.review_digest,expectedRevision:r.expected_activation_revision});
async function apply(o,r,options){return control(o,applyAction(r),options);}
async function activate(o,instanceId){const r=await review(o,instanceId,'activate'),a=await apply(o,r);assert.equal(a.status,200,a.error);return r;}
const instance=(o,localId)=>row('SELECT i.*,a.state,a.revision activation_revision FROM module_instances i JOIN module_activations a ON a.instance_id=i.id WHERE i.project_id=? AND i.local_id=?',o.project,localId);
const envelope=(resource,operation,{target=null,input=null,requestId=undefined,configRevision=resource.config_revision}={})=>({api:'whumpo-modules',version:1,operation,resourceId:resource.id,configRevision,requestId:requestId===undefined?(m.modulePolicy.moduleOperations[operation].write?id():null):requestId,target,input});
const submitHandler=async(_db,ctx)=>({statements:[],result:{accepted:true,formId:ctx.request.target.formId}});
const handlers={'forms.submit':submitHandler,'records.get':async(_db,ctx)=>({fields:ctx.decision.fields,scope:ctx.decision.scope}),'access.list':async()=>({staff:0})};
// Synthetic public writes pass an explicit admitted hook; the visitor gateway's real admission (Turnstile, allowance) is
// covered by tests/shared-modules-records.mjs. Without the hook a public write is unavailable (asserted below).
const publicCall=(o,input,h=handlers,mod=m,options={publicAdmission:async()=>{}})=>(mod.sharedModules?.handleModuleRequest??mod.handleModuleRequest)(db,{kind:'public',projectId:o.project},input,h,options);
const ownerCall=(o,input,h=handlers,scope=o.scope)=>m.sharedModules.handleModuleRequest(scope,{kind:'owner',userId:o.user,projectId:o.project},input,h);
const fails=async(promise,code)=>{await assert.rejects(promise,e=>{assert.ok(typeof e?.code==='string'&&typeof e?.category==='string'&&Number.isInteger(e?.status),String(e?.stack??e));assert.equal(e.code,code,e.message);return true;});};
const submission=(resource,extra={})=>envelope(resource,'forms.submit',{target:{formId:'request-form'},input:{name:marker,note:marker},...extra});

try{
 const a=await owner({plan:null,grants:true}),b=await owner(),starter=await owner({plan:'starter'});
 let access,records;

 await check('owner activation review, recent sign-in, readback and Chat card',async()=>{
  const saved=await configure(a,[accessInstance,recordsInstance()]);
  // The exact private-save review binds the module rows and the classified review set; nothing is active yet.
  const envelope=JSON.parse(saved.review.envelope_json);assert.deepEqual(envelope.requiredReviews,['permissions','schema']);
  assert.deepEqual(JSON.parse(saved.review.diff_json).map(r=>r.label),['Module members','Module requests']);
  assert.match((await m.readChat(a.scope,a.user)).turns.find(t=>t.id===saved.review.id).assistant_text,/This review also covers: permissions .*; schema .*\.[\s\S]*own activation review/);
  assert.deepEqual((await headSpec(a)).instances.map(i=>i.id),['members','requests']);
  assert.equal((await row('SELECT count(*) n FROM module_instances WHERE project_id=?',a.project)).n,0,'Saving configuration activates nothing');
  // A dependent cannot activate before its dependency; nothing is reviewed.
  const early=await control(a,{type:'moduleActivationReview',projectId:a.project,instanceId:'requests',action:'activate'});
  assert.equal(early.status,409);assert.match(early.error,/members/);assert.equal((await row('SELECT count(*) n FROM module_activation_reviews WHERE project_id=?',a.project)).n,0);
  const r=await review(a,'members','activate');
  assert.equal(r.expected_config_revision,0);assert.equal(r.next_config_revision,1);assert.equal(r.expected_activation_revision,0);assert.equal(r.feature_id,'core.editing');
  const card=(await m.readChat(a.scope,a.user)).turns.find(t=>t.id===r.id);
  assert.deepEqual(card.module_activation_review,{id:r.id,reviewDigest:r.review_digest,expectedRevision:0,action:'activate',instanceId:'members',kind:'access'});
  assert.doesNotMatch(card.assistant_text,new RegExp(label));
  // Stale passkey proof cannot apply; a recent one applies exactly once.
  const stale=await workspaceSession(db,m,{account:a.user,credential:a.credential},-700),staleScope=await stale.scope();
  await assert.rejects(()=>m.sendChatControl(staleScope,a.user,{id:id(),revision:0,action:applyAction(r)}),e=>e.status===401);
  const tampered=await control(a,{...applyAction(r),reviewDigest:'f'.repeat(64)});assert.equal(tampered.status,409);
  const applied=await apply(a,r);assert.equal(applied.status,200,applied.error);
  access=await instance(a,'members');assert.equal(access.state,'active');
  // Restore is classified with the same hook table: returning to the module-free first version would now drop an
  // activated instance (never-activated removal is covered in its own group below).
  const headRevision=(await row('SELECT revision FROM project_spec_heads WHERE project_id=?',a.project)).revision;
  await assert.rejects(m.prepareSpecification(a.scope,a.user,id(),{kind:'specification',operation:'restore',projectId:a.project,expectedRevision:headRevision,versionId:a.version}),e=>e.status===422);assert.equal(access.config_revision,1);assert.equal(access.activation_revision,1);assert.equal(access.id,r.resource_id);
  // Lost acknowledgement: the same turn reads back; a new turn for the same review reads the saved receipt only.
  assert.equal((await m.sendChatControl(a.scope,a.user,{id:applied.id,revision:(await revision(a))-1,action:applyAction(r)})).status,200);
  const again=await apply(a,r);assert.equal(again.status,200);
  assert.match((await m.readChat(a.scope,a.user)).turns.find(t=>t.id===again.id).assistant_text,/already applied/);
  assert.equal((await row('SELECT count(*) n FROM module_activation_applies WHERE review_id=?',r.id)).n,1);
  assert.equal((await instance(a,'members')).activation_revision,1);
  assert.equal((await m.readChat(a.scope,a.user)).turns.find(t=>t.id===r.id).module_activation_review,undefined,'An applied review no longer offers a control');
  const rr=await activate(a,'requests');assert.equal(rr.feature_id,'core.forms');assert.equal(rr.widening,1);
  records=await instance(a,'requests');assert.deepEqual(JSON.parse(records.dependencies_json),[access.id]);
  const descriptor=validateDescriptor(JSON.parse(records.descriptor_json));
  assert.deepEqual(descriptor.ref,{projectId:a.project,resourceId:records.id});assert.deepEqual(descriptor.dependencies.map(d=>d.ref.resourceId),[access.id]);
  assert.equal(records.descriptor_digest,await m.jsonDigest(descriptor));assert.doesNotMatch(records.descriptor_json,new RegExp(a.user));
  // Re-activating an unchanged active module is refused rather than reviewed.
  assert.equal((await control(a,{type:'moduleActivationReview',projectId:a.project,instanceId:'requests',action:'activate'})).status,400);
 });

 await check('request envelope and client_update_required',async()=>{
  const good=submission(records);
  for(const [bad,code] of [[{...good,version:2},'client_update_required'],[{...good,api:'other'},'client_update_required'],[{...good,operation:'records.export'},'client_update_required'],
   [{...good,extra:1},'invalid_request'],[{...good,requestId:null},'invalid_request'],[{...good,target:{formId:'request-form',projectId:b.project}},'invalid_request'],
   [{...good,input:{approved:true}},'invalid_request'],[{...envelope(records,'records.get',{target:{recordId:'request'}}),requestId:id()},'invalid_request'],[null,'invalid_request']])
   await fails(publicCall(a,bad),code);
  assert.equal(new ModuleError('client_update_required').status,400);assert.equal(new ModuleError('stale_configuration').category,'stale');
  assert.equal((await rows('SELECT * FROM module_request_receipts')).length,0);
 });

 await check('public serving: idempotent receipts, changed-input replay and concurrent winner',async()=>{
  const first=submission(records),result=await publicCall(a,first);
  assert.deepEqual(result.result,{accepted:true,formId:'request-form'});assert.equal(result.receipt.replayed,false);
  const replay=await publicCall(a,first);assert.equal(replay.receipt.replayed,true);assert.deepEqual(replay.result,result.result);assert.equal(replay.receipt.createdAt,result.receipt.createdAt);
  await fails(publicCall(a,{...first,input:{name:'changed',note:marker}}),'request_conflict');
  // A different principal reusing the ID is a conflict, never a readback of someone else's receipt.
  await fails(m.sharedModules.handleModuleRequest(db,{kind:'visitor',projectId:a.project,visitorId:id(),sessionHash:'0'.repeat(64),accessInstanceId:id(),roles:[],accessRevision:1},first,handlers),'request_conflict');
  // Policy runs before any receipt is revealed: an owner cannot use the public form path at all.
  await fails(ownerCall(a,first),'forbidden');
  const racing=submission(records),both=await Promise.all([publicCall(a,racing),publicCall(a,racing)]);
  assert.deepEqual(both.map(r=>r.result),[both[0].result,both[0].result]);assert.equal(both.filter(r=>r.receipt.replayed).length,1);
  assert.equal((await row('SELECT count(*) n FROM module_request_receipts WHERE request_id=?',racing.requestId)).n,1);
  // Unknown storage outcome reads back; a handler that fails before commit leaves nothing.
  await assert.rejects(publicCall(a,submission(records),{'forms.submit':async()=>({statements:[db.prepare('INSERT INTO module_activations(instance_id) VALUES(NULL)')],result:{accepted:true}})}),e=>e.code==='unresolved');
  // Not-yet-delivered operations are unavailable after the full resolver and policy pass, never a fallback.
  await fails(publicCall(a,submission(records),{}),'unavailable');
  // A public write without the receiving host's public intake admission is unavailable before its handler runs.
  await fails(publicCall(a,submission(records),handlers,m,{}),'unavailable');
  await fails(publicCall(a,envelope(records,'records.get',{target:{recordId:'request'}})),'forbidden');
  await fails(publicCall(a,submission(records,{target:{formId:'missing'}})),'not_found');
  await fails(publicCall(a,envelope(access,'access.list')),'forbidden');
 });

 await check('foreign scope, stale configRevision and inactive instances inside every handler',async()=>{
  await configure(b,[accessInstance]);await activate(b,'members');const theirs=await instance(b,'members');
  // Foreign resources are one generic not_found for public, owner and review handlers.
  await fails(publicCall(b,submission(records)),'not_found');
  await fails(ownerCall(b,envelope(records,'records.get',{target:{recordId:'request'}})),'not_found');
  await fails(ownerCall(a,envelope(theirs,'access.list'),handlers,a.scope),'not_found');
  await fails(m.sharedModules.handleModuleRequest(b.scope,{kind:'owner',userId:b.user,projectId:a.project},envelope(records,'records.get',{target:{recordId:'request'}}),handlers),'not_found');
  const foreignReview=await control(b,{type:'moduleActivationReview',projectId:a.project,instanceId:'requests',action:'disable'});assert.equal(foreignReview.status,404);
  const pending=await review(a,'requests','disable');
  const foreignApply=await control(b,applyAction(pending));assert.equal(foreignApply.status,404);
  assert.equal((await row('SELECT count(*) n FROM module_activation_applies WHERE review_id=?',pending.id)).n,0);
  // Stale configRevision fails before the handler, and inside the commit if it changes mid-request.
  await fails(publicCall(a,submission(records,{configRevision:records.config_revision+1})),'stale_configuration');
  await fails(ownerCall(a,envelope(records,'records.get',{target:{recordId:'request'},configRevision:2})),'stale_configuration');
  const bump=await variantBump(records);
  await fails(publicCall(a,submission(records),{'forms.submit':async(d,c)=>{await bump();return submitHandler(d,c);}}),'stale_configuration');
  await restoreRevision(records);
  // A disable that commits while a request is in flight wins: the receipt trigger refuses.
  await fails(publicCall(a,submission(records),{'forms.submit':async(d,c)=>{await run("UPDATE module_activations SET state='inactive',revision=revision+1 WHERE instance_id=?",records.id);return submitHandler(d,c);}}),'unavailable');
  await run("UPDATE module_activations SET state='active',revision=revision+1 WHERE instance_id=?",records.id);
  records=await instance(a,'requests');assert.equal(records.activation_revision,3);
  assert.equal((await publicCall(a,submission(records))).receipt.replayed,false);
  // The disable review was prepared against activation revision 1; after the moves it can no longer apply.
  const stalePending=await apply(a,pending);assert.equal(stalePending.status,409);
  assert.equal((await row('SELECT count(*) n FROM module_activation_applies WHERE review_id=?',pending.id)).n,0);
  // Disabling the dependency stops dependents for non-owners; owner reads stay available in every state.
  const off=await apply(a,await review(a,'members','disable'));assert.equal(off.status,200,off.error);
  await fails(publicCall(a,submission(records)),'unavailable');
  assert.deepEqual((await ownerCall(a,envelope(records,'records.get',{target:{recordId:'request'}}))).result,{fields:['name','note'],scope:'all'});
  await activate(a,'members');access=await instance(a,'members');assert.equal(access.activation_revision,3);
  assert.equal((await publicCall(a,submission(records))).receipt.replayed,false);
  // A visitor principal without a current session and access revision (WH-126 visitorPredicate) cannot commit.
  await fails(m.sharedModules.handleModuleRequest(db,{kind:'visitor',projectId:a.project,visitorId:id(),sessionHash:'0'.repeat(64),accessInstanceId:access.id,roles:[],accessRevision:1},submission(records),handlers),'forbidden');
 });

 await check('withdrawn and stale pins fail closed while owner disable and reads remain',async()=>{
  const ws=await workspaceSession(db,withdrawn,{account:a.user,credential:a.credential}),wScope=await ws.scope();
  await fails(publicCall(a,submission(records),handlers,withdrawn),'unavailable');
  const facts=await withdrawn.readModuleInstances(wScope,a.user,a.project);
  assert.equal(facts.items.find(i=>i.localId==='requests').catalog,'withdrawn');assert.equal(facts.items.find(i=>i.localId==='requests').serving,false);
  const blocked=await control(a,{type:'moduleActivationReview',projectId:a.project,instanceId:'requests',action:'activate'},{scope:wScope,mod:withdrawn});
  assert.equal(blocked.status,409);assert.match(blocked.error,/withdrawn/);
  const rs=await workspaceSession(db,restaged,{account:a.user,credential:a.credential}),rScope=await rs.scope();
  await fails(publicCall(a,submission(records),handlers,restaged),'stale_module_version');
  assert.equal((await restaged.readModuleInstances(rScope,a.user,a.project)).items.find(i=>i.localId==='requests').catalog,'stale');
  // Owner disable remains reachable under the withdrawn catalog.
  const d=await review(a,'requests','disable',{scope:wScope,mod:withdrawn});
  assert.equal((await apply(a,d,{scope:wScope,mod:withdrawn})).status,200);assert.equal((await instance(a,'requests')).state,'inactive');
  await activate(a,'requests');records=await instance(a,'requests');
 });

 await check('configuration changes advance configRevision; migrations are refused',async()=>{
  await configure(a,[accessInstance,recordsInstance([...recordFields,{key:'extra',label:'Extra',type:'text',optional:true,read:'owner'}],2)]);
  const facts=await m.moduleRegistry.readModuleInstances(a.scope,a.user,a.project);assert.equal(facts.items.find(i=>i.localId==='requests').configChanged,true);
  const r=await review(a,'requests','activate');assert.equal(r.expected_config_revision,1);assert.equal(r.next_config_revision,2);assert.equal(r.widening,0);
  assert.equal((await apply(a,r)).status,200);records=await instance(a,'requests');assert.equal(records.config_revision,2);assert.equal(records.state,'active');
  await fails(publicCall(a,submission({...records,config_revision:1})),'stale_configuration');
  assert.equal((await publicCall(a,submission(records))).receipt.replayed,false);
  // The owner save path refuses a destructive change before anything is reviewed or saved.
  const before=await headSpec(a),proposals=(await row('SELECT count(*) n FROM project_spec_proposals WHERE project_id=?',a.project)).n;
  await assert.rejects(configure(a,[accessInstance,recordsInstance([recordFields[0]],2)]),e=>e.status===422);
  assert.deepEqual(await headSpec(a),before);assert.equal((await row('SELECT count(*) n FROM project_spec_proposals WHERE project_id=?',a.project)).n,proposals);
  // Defense in depth (direct seed, see seedHead): activation independently refuses a migration-bearing head.
  const undo=await seedHead(a,[accessInstance,recordsInstance([recordFields[0]],2)]);
  try{const removed=await control(a,{type:'moduleActivationReview',projectId:a.project,instanceId:'requests',action:'activate'});assert.equal(removed.status,409);assert.match(removed.error,/migration/);}finally{await undo();}
  assert.deepEqual(await headSpec(a),before);
 });

 await check('concurrent activation and disable have one winner',async()=>{
  await configure(a,[accessInstance,recordsInstance([...recordFields,{key:'extra',label:'Extra',type:'text',optional:true,read:'owner'},{key:'more',label:'More',type:'text',optional:true,read:'owner'}],3)]);
  const reactivate=await review(a,'requests','activate'),disable=await review(a,'requests','disable');
  assert.equal(reactivate.expected_activation_revision,disable.expected_activation_revision);
  assert.equal((await apply(a,disable)).status,200);
  const loser=await apply(a,reactivate);assert.equal(loser.status,409);assert.match(loser.error,/fresh review/);
  assert.equal((await instance(a,'requests')).state,'inactive');assert.equal((await instance(a,'requests')).config_revision,2);
  // Two confirmations of one review race: the database admits one receipt.
  const once=await review(a,'requests','activate'),state=await revision(a);
  const results=await Promise.all([id(),id()].map(turn=>m.sendChatControl(a.scope,a.user,{id:turn,revision:state,action:applyAction(once)})));
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await row('SELECT count(*) n FROM module_activation_applies WHERE review_id=?',once.id)).n,1);
  records=await instance(a,'requests');assert.equal(records.state,'active');assert.equal(records.config_revision,3);
 });

 await check('plan loss blocks activation but keeps owner read, disable and published serving',async()=>{
  // A widening-free configuration change is prepared while included, then inclusion ends before it is applied.
  await configure(a,[accessInstance,recordsInstance([...recordFields,{key:'extra',label:'Extra',type:'text',optional:true,read:'owner'},{key:'more',label:'More',type:'text',optional:true,read:'owner'},{key:'later',label:'Later',type:'text',optional:true,read:'owner'}],4)]);
  const pendingActivation=await review(a,'requests','activate');assert.equal(pendingActivation.next_config_revision,4);
  await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?',a.user);
  const denied=await apply(a,pendingActivation);assert.equal(denied.status,403);assert.match(denied.error,/disable stay available/);
  assert.equal((await instance(a,'requests')).config_revision,3);
  const newReview=await control(a,{type:'moduleActivationReview',projectId:a.project,instanceId:'requests',action:'activate'});assert.equal(newReview.status,403);
  // Published serving of the active instance does not depend on the owner's subscription.
  assert.equal((await publicCall(a,submission(records))).receipt.replayed,false);
  const view=await m.readViewBinding(a.scope,a.user,'modules',a.project);
  assert.equal(view.status,'ready');assert.ok(view.data.items.every(i=>i.canActivate===false));
  assert.deepEqual(view.data.items.map(i=>[i.localId,i.state,i.serving,i.configChanged]),[['members','active',true,false],['requests','active',true,true]]);
  assert.equal((await ownerCall(a,envelope(records,'records.get',{target:{recordId:'request'}}))).result.scope,'all');
  const off=await apply(a,await review(a,'requests','disable'));assert.equal(off.status,200,'Disable needs only identity and ownership');
  await fails(publicCall(a,submission(records)),'unavailable');
  // Starter includes core.forms/core.editing through invoice coverage; the same journey activates there.
  await configure(starter,[accessInstance]);await activate(starter,'members');assert.equal((await instance(starter,'members')).state,'active');
 });

 await check('paid owner serving continues after plan loss; revocation stops owner handlers',async()=>{
  await configure(b,[accessInstance,recordsInstance()]);await activate(b,'requests');const theirs=await instance(b,'requests');
  // Test-only clock substitute: end the synthetic invoice interval in this disposable database.
  const invoice=await row('SELECT id FROM stripe_paid_invoices WHERE user_id=?',b.user),triggers=await rows("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND tbl_name='stripe_paid_invoices'");
  for(const t of triggers)await run('DROP TRIGGER '+t.name);
  try{await run('UPDATE stripe_paid_invoices SET starts_at=unixepoch()-100,ends_at=unixepoch()-1 WHERE id=?',invoice.id);}finally{for(const t of triggers)await run(t.sql);}
  assert.equal((await publicCall(b,submission(theirs))).receipt.replayed,false,'Published serving outlives plan loss');
  assert.equal((await control(b,{type:'moduleActivationReview',projectId:b.project,instanceId:'requests',action:'activate'})).status,403);
  await b.revoke();
  await assert.rejects(()=>m.sendChatControl(b.scope,b.user,{id:id(),revision:0,action:{type:'moduleActivationReview',projectId:b.project,instanceId:'requests',action:'disable'}}),e=>[401,409].includes(e.status));
  await assert.rejects(()=>ownerCall(b,envelope(theirs,'records.get',{target:{recordId:'request'}})),e=>[401,409].includes(e.status)&&e.code!=='stale_configuration');
  await assert.rejects(()=>ownerCall(b,submission(theirs)),e=>[401,409].includes(e.status)&&e.code!=='request_conflict');
  assert.equal((await publicCall(b,submission(theirs))).receipt.replayed,false,'Owner session revocation is not visitor serving');
 });

 await check('never-activated instances are removable through the exact review; activated ones are refused',async()=>{
  const c=await owner({plan:null,grants:true}),remove=instanceId=>({type:'modules.remove',instanceId});
  const savedVersions=async()=>(await row('SELECT count(*) n FROM project_spec_versions WHERE project_id=?',c.project)).n;
  // Restore to the module-free first version drops two never-activated instances: allowed, no review class.
  await configure(c,[accessInstance,recordsInstance()]);
  const back=await proposeFixtureWebsite(c.scope,c.user,c.project,{versionId:c.version});assert.deepEqual(JSON.parse(back.envelope_json).requiredReviews,[]);
  assert.equal((await applyFixtureWebsite(c.scope,c.user,back)).status,200);assert.deepEqual((await headSpec(c)).instances,[]);
  // modules.remove: one exact comparison row (configuration before, nothing after) and a reply naming the removal.
  await configure(c,[accessInstance,recordsInstance()]);
  const q=await proposeFixtureWebsite(c.scope,c.user,c.project,[remove('requests')]);
  assert.deepEqual(JSON.parse(q.diff_json).map(r=>[r.label,r.before!==null,r.after]),[['Module requests',true,null]]);assert.deepEqual(JSON.parse(q.envelope_json).requiredReviews,[]);
  const reply=(await m.readChat(c.scope,c.user)).turns.find(t=>t.id===q.id).assistant_text;
  assert.match(reply,/Removes the saved configuration of never-activated module requests/);assert.doesNotMatch(reply,/saved inactive/);assert.doesNotMatch(reply,new RegExp(label));
  // A foreign owner cannot prepare or apply it.
  await assert.rejects(m.prepareSpecification(starter.scope,starter.user,id(),{kind:'specification',operation:'change',projectId:c.project,expectedRevision:q.expected_revision,operations:[remove('requests')]}),e=>e.status===404);
  await assert.rejects(control(starter,{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision}),e=>e.status===404);
  assert.equal((await applyFixtureWebsite(c.scope,c.user,q)).status,200);assert.deepEqual((await headSpec(c)).instances.map(i=>i.id),['members']);
  // A dependency cannot be removed while a dependent remains (validation), and an activated instance never can.
  await configure(c,[accessInstance,recordsInstance()]);
  await assert.rejects(proposeFixtureWebsite(c.scope,c.user,c.project,[remove('members')]),e=>e.status===422);
  await activate(c,'members');const versions=await savedVersions();
  for(const change of [[remove('requests'),remove('members')],{versionId:c.version}])await assert.rejects(proposeFixtureWebsite(c.scope,c.user,c.project,change),e=>e.status===422);
  assert.equal(await savedVersions(),versions);
  // Race: a removal reviewed while `requests` was never activated cannot apply after it is activated; the
  // module_instance_spec_retained trigger repeats the decision inside the commit.
  const pending=await proposeFixtureWebsite(c.scope,c.user,c.project,[remove('requests')]);
  await activate(c,'requests');
  const late=await applyFixtureWebsite(c.scope,c.user,pending);assert.equal(late.status,409);
  assert.equal(await savedVersions(),versions);assert.deepEqual((await headSpec(c)).instances.map(i=>i.id),['members','requests']);
  assert.equal((await instance(c,'requests')).state,'active');
  // Disabled is still ever-activated: removal stays MIGRATION_REQUIRED until a WH-077 export exists.
  assert.equal((await apply(c,await review(c,'requests','disable'))).status,200);
  await assert.rejects(changeFixtureWebsite(c.scope,c.user,c.project,[remove('requests')]),e=>e.status===422);
  const head=await row('SELECT v.* FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=?',c.project);
  await assert.rejects(()=>run('INSERT INTO project_spec_versions(version_id,project_id,revision,proposal_id,spec_json,spec_digest,lock_json,manifest_json,manifest_digest) VALUES(?,?,?,?,?,?,?,?,?)',id(),c.project,head.revision+1,id(),JSON.stringify({...JSON.parse(head.spec_json),instances:[]}),head.spec_digest,head.lock_json,head.manifest_json,head.manifest_digest),/specification_changed/);
 });

 await check('applied review history never exhausts capacity; pending reviews stay bounded',async()=>{
  // Synthetic history: 500 applied copies of the starter's activation review (admission triggers lifted, test-only).
  const original=await row("SELECT r.* FROM module_activation_reviews r JOIN module_activation_applies a ON a.review_id=r.id WHERE r.project_id=? LIMIT 1",starter.project);
  const columns=(await rows('PRAGMA table_info(module_activation_reviews)')).map(c=>c.name).filter(c=>c!=='id');
  const applyColumns=(await rows('PRAGMA table_info(module_activation_applies)')).map(c=>c.name).filter(c=>!['id','review_id'].includes(c));
  const lifted=await rows("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('module_activation_review_admit','module_activation_apply_admit','module_activation_apply')");
  const copies=(prefix,n,pending)=>run(`INSERT INTO module_activation_reviews(id,${columns.join(',')}) WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<${n})
   SELECT printf('${prefix}%07x-0000-4000-8000-%012d',i,i),${columns.map(c=>pending&&c==='created_at'?'unixepoch()':pending&&c==='expires_at'?'unixepoch()+500':c).join(',')} FROM n,module_activation_reviews WHERE id=?`,original.id);
  for(const t of lifted)await run('DROP TRIGGER '+t.name);
  try{
   await copies('a',500,false);
   await run(`INSERT INTO module_activation_applies(id,review_id,${applyColumns.join(',')}) SELECT 'b'||substr(r.id,2),r.id,${applyColumns.map(c=>'a.'+c).join(',')} FROM module_activation_reviews r,module_activation_applies a WHERE r.id LIKE 'a%-0000-4000-8000-%' AND r.project_id=? AND a.review_id=?`,starter.project,original.id);
  }finally{for(const t of lifted)await run(t.sql);}
  assert.ok((await row('SELECT count(*) n FROM module_activation_reviews WHERE project_id=?',starter.project)).n>500);
  // The owner can still disable and re-activate: applied history does not count.
  const off=await review(starter,'members','disable');assert.equal((await apply(starter,off)).status,200);
  assert.equal((await instance(starter,'members')).state,'inactive');
  // WH-181: 25 pending (unapplied, unexpired) reviews refuse another activation (disable is exempt).
  const admit=lifted.find(t=>t.name==='module_activation_review_admit'),immutable=(await rows("SELECT sql FROM sqlite_master WHERE name='module_activation_review_immutable'"))[0].sql;
  await run('DROP TRIGGER module_activation_review_admit');try{await copies('c',25,true);}finally{await run(admit.sql);}
  assert.notEqual((await control(starter,{type:'moduleActivationReview',projectId:starter.project,instanceId:'members',action:'activate'})).status,200);
  // Expired pending reviews stop counting and need no deletion (a retained row leaves only with its sealed receipt).
  await assert.rejects(()=>run("DELETE FROM module_activation_reviews WHERE id LIKE 'c%-0000-4000-8000-%'"),/module_activation_receipt_retained/);
  await run('DROP TRIGGER module_activation_review_immutable');
  try{await run("UPDATE module_activation_reviews SET created_at=unixepoch()-7300,expires_at=unixepoch()-7000 WHERE id LIKE 'c%-0000-4000-8000-%'");}finally{await run(immutable);}
  await activate(starter,'members');assert.equal((await instance(starter,'members')).state,'active');
 });

 await check('visitor values stay out of Chat, model context and receipts; closure and cascades',async()=>{
  for(const t of ['chat_turns','module_request_receipts','module_activation_reviews','module_instances','activity_events']){
   const dump=JSON.stringify(await rows('SELECT * FROM '+t));assert.ok(!dump.includes(marker),t);
  }
  const turns=JSON.stringify((await m.readChat(a.scope,a.user)).turns);assert.ok(!turns.includes(marker));assert.ok(!turns.includes(label));
  const facts=JSON.stringify(await m.readViewBinding(a.scope,a.user,'modules',a.project));assert.ok(!facts.includes(label));assert.ok(!facts.includes(marker));
  assert.equal((await m.readViewBinding(a.scope,a.user,'modules',b.project)).status,'unavailable');
  assert.equal((await m.readViewBinding(a.scope,a.user,'modules',null)).status,'unavailable');
  const inventory=await accountClosureInventory(db,a.user);
  assert.equal(inventory.counts.moduleInstances,2);assert.equal(inventory.counts.moduleActivationReceipts,(await row('SELECT count(*) n FROM module_activation_applies WHERE user_id=?',a.user)).n);
  assert.equal(inventory.counts.moduleRequestReceipts,(await row('SELECT count(*) n FROM module_request_receipts WHERE project_id=?',a.project)).n);assert.ok(inventory.counts.moduleRequestReceipts>3);
  await assert.rejects(()=>run('DELETE FROM module_activation_reviews WHERE id IN(SELECT review_id FROM module_activation_applies WHERE user_id=?)',a.user),/module_activation_receipt_retained/);
  await assert.rejects(()=>run("UPDATE module_instances SET kind='files' WHERE project_id=?",a.project),/module_instance_immutable/);
  await run('DELETE FROM projects WHERE id=?',a.project);
  for(const t of ['module_instances','module_activation_reviews','module_request_receipts'])assert.equal((await row(`SELECT count(*) n FROM ${t} WHERE project_id=?`,a.project)).n,0,t);
  assert.equal((await row('SELECT count(*) n FROM module_activation_applies WHERE user_id=?',a.user)).n,0);
 });

 await check('module paths never reach owner-maintenance inference',async()=>{
  const inference=/^src\/(ai|ai-chat|ai-gateway|acknowledgment|site-agent|agent-[a-z-]+|standard-ai[a-z-]*|chat|backend-chat|app-upgrade-chat|app-recovery-chat|app-page-design)\.ts$|^src\/chat-interactions\/(agent|agent-request|model-continuation|continuation)\.ts$/;
  for(const entry of ['src/shared-modules/api.ts','src/shared-modules/registry.ts','src/shared-modules/policy.ts','src/shared-modules/activation.ts']){
   const out=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false,metafile:true,logLevel:'silent'});
   const inputs=Object.keys(out.metafile.inputs);
   assert.ok(inputs.length>0);assert.deepEqual(inputs.filter(p=>inference.test(p)),[],entry+' reaches owner-maintenance inference');
   const text=out.outputFiles[0].text;
   for(const name of ['AI_GATEWAY','OPENAI','ANTHROPIC','sendAIChat','agentPrompt','siteContext'])assert.ok(!text.includes(name),entry+' references '+name);
  }
  assert.equal(network,0,'No inference, provider or network call happened during module paths');
 });

 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 assert.ok(!logs.join('\n').includes(marker));
 say(`Shared module registry passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'} — instances saved through the exact owner specification review (classified reviews, destructive save/restore refused, never-activated removal allowed and refused once activated, including the commit-time race), exact owner activation/disable reviews with recent sign-in, readback and one-winner races, configRevision/pin/activation guards in the committing statements, envelope and client_update_required, two-owner foreign scope, revocation, withdrawn/stale pins, plan loss, idempotent receipts, closure and cascades, and a static no-inference check. No network, model or provider use; no visitor value stored or logged.`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}

async function variantBump(resource){
 return async()=>{await run('UPDATE module_instances SET config_revision=config_revision+1,config_digest=? WHERE id=?','e'.repeat(64),resource.id);};
}
async function restoreRevision(resource){
 const t=await row("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='module_instance_update'");
 await run('DROP TRIGGER module_instance_update');
 try{await run('UPDATE module_instances SET config_revision=?,config_digest=? WHERE id=?',resource.config_revision,resource.config_digest,resource.id);}finally{await run(t.sql);}
}
