import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {validateDescriptor} from '../tools/prototypes/workload-placement.mjs';
Error.stackTraceLimit=0;
// WH-129 content collections module over the directory service. Actual handlers (visitor gateway POST /modules, the
// workspace-origin owner module route, the module engine, the directory Chat reviews, the public site host and the
// directory export route) run against the complete current schema in disposable SQLite, or local D1 with --d1, with two
// owners/projects. Every identity and listing is synthetic. No model, provider or network is used: fetch throws.
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network or inference is available');};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const {appGateway}=m,{exportCollectionSnapshot,collectionsExportHook,collectionsRestoreHook}=m.sharedModuleCollections;
const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const contentInstance={id:'listings',kind:'content',...pins('content'),dependencies:[],config:{collections:[{id:'directory',type:'directory-listing@1'}]}};

// Variant bundles change exactly one trusted catalog fact (withdrawn kind or a different digest) around the same handlers.
async function variant(replace){
 const plugin={name:'catalog-variant',setup(b){b.onLoad({filter:/src[\\/]project-specification[\\/]catalog\.ts$/},async args=>{const source=await readFile(args.path,'utf8'),changed=replace(source);assert.notEqual(changed,source);return {contents:changed,loader:'ts'};});}};
 const out=await build({stdin:{contents:`export {sendChatControl} from './src/chat';export {handleModuleRequest} from './src/shared-modules/api';export {exportCollectionSnapshot,prepareCollectionRestore} from './src/shared-modules/collections';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[plugin],logLevel:'silent'});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].contents).toString('base64'));
}
const withdrawn=await variant(s=>s.replace("modulePin('content','available')","modulePin('content','withdrawn')"));
const restaged=await variant(s=>s.replace("digest:compilerArtifacts.modules[kind].module}","digest:kind==='content'?'0'.repeat(64):compilerArtifacts.modules[kind].module}"));
const compilerWithdrawn=await variant(s=>s.replace(/(id:'project-content',version:[0-9]+,digest:compilerArtifacts.compiler,state:)'available'/,"$1'withdrawn'"));

const revision=async o=>(await m.readChat(o.scope,o.user)).state.revision;
async function control(o,action){const turn=id();return {id:turn,...await m.sendChatControl(o.scope,o.user,{id:turn,revision:await revision(o),action})};}
async function chat(o,content){const turn=id(),r=await m.sendChat(o.scope,o.user,{id:turn,revision:await revision(o),content});assert.equal(r.status,200,JSON.stringify(r));return turn;}
async function confirm(o,reviewId,kind='directory'){const r=await control(o,{type:'confirm',kind,reviewId});assert.equal(r.status,200,JSON.stringify(r));}
async function activation(o,instanceId,action='activate'){
 const r=await control(o,{type:'moduleActivationReview',projectId:o.project,instanceId,action});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',r.id);
 const a=await control(o,{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision});assert.equal(a.status,200,a.error);
}
const instance=o=>row('SELECT i.*,a.state,a.revision activation_revision FROM module_instances i JOIN module_activations a ON a.instance_id=i.id WHERE i.project_id=? AND i.local_id=?',o.project,'listings');
async function owner(name){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,name+' '+id().slice(0,6),'A community directory');
 for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-129 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,'core.editing',operation);
 const o={...actor,scope,user,...site,host:'https://app-'+site.project+'.whumpo.site'};
 const saved=await configureFixtureModules(scope,user,site.project,[contentInstance]);o.version=saved.version;
 await confirm(o,await chat(o,'/publish '+o.version),'site');
 return o;
}
const envelope=(resource,{target={collectionId:'directory'},input=null,configRevision=resource.config_revision,requestId=null,operation='collections.readPublic'}={})=>({api:'whumpo-modules',version:1,operation,resourceId:resource.id,configRevision,requestId,target,input});
/** Visitor origin through the actual gateway, anonymous unless a cookie is given. */
async function gateway(o,payload,cookie=''){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.9','content-type':'application/json',origin:o.host,cookie},body:JSON.stringify(payload)}),env);
 assert.equal(response.headers.get('access-control-allow-origin'),null);
 return {status:response.status,body:await response.json()};
}
/** Workspace origin through the actual platform Worker with the owner's workspace session cookie. */
async function workspace(o,path,{method='GET',payload}={}){
 const response=await m.worker.fetch(new Request('https://whumpo.com'+path,{method,headers:{cookie:`__Host-whumpo_session=${o.token}`,origin:'https://whumpo.com',...(payload?{'content-type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined}),{...(fixture.env??{}),...env},{waitUntil(){}});
 return {status:response.status,body:await response.json()};
}
const publicJSON=async o=>{const r=await m.host.fetch(new Request('https://'+o.project+'.whumpo.site/directory.json'),{...(fixture.env??{}),...env});return r.status===200?r.json():r.status;};
const fails=async(promise,code,_why)=>{await assert.rejects(promise,e=>{assert.equal(e?.code,code,String(e?.stack??e));return true;});};
const ownerPrincipal=o=>({kind:'owner',userId:o.user,projectId:o.project});

try{
 const a=await owner('Community'),b=await owner('Other tenant');
 let resource;

 await check('an unregistered collection is not found; activation registers the directory as the content instance',async()=>{
  assert.equal(await row('SELECT 1 x FROM module_instances WHERE project_id=?',a.project),null);
  const missing=await gateway(a,envelope({id:id(),config_revision:1}));assert.equal(missing.status,404);assert.equal(missing.body.code,'not_found');
  await activation(a,'listings');await activation(b,'listings');
  resource=await instance(a);assert.equal(resource.kind,'content');assert.equal(resource.state,'active');
  // The descriptor names the eligible project directory data set and the maintained export hook.
  const descriptor=validateDescriptor(JSON.parse(resource.descriptor_json));
  assert.deepEqual(descriptor.ownership.data,[{id:'directories',classId:'directories',subject:'project',export:'eligible'}]);
  assert.deepEqual(descriptor.lifecycle,{exportFormat:1,exportHook:collectionsExportHook,deleteHook:'project-cascade',restoreHook:collectionsRestoreHook,migrateHook:'migration-required',portability:'platform-only'});
  assert.equal(JSON.stringify(descriptor).includes(a.user),false);
 });

 let listing;
 await check('public reads return only the approved snapshot, the same as the public directory JSON',async()=>{
  const unpublished=await gateway(a,envelope(resource));assert.equal(unpublished.status,409);assert.equal(unpublished.body.code,'unavailable');
  listing=await chat(a,`/directory-add ${a.project} | Garden club | Saturday mornings | https://example.com/`);await confirm(a,listing);
  assert.equal((await gateway(a,envelope(resource))).status,409,'a private draft is never served');
  await confirm(a,await chat(a,'/directory-publish '+a.project));
  const read=await gateway(a,envelope(resource));assert.equal(read.status,200,JSON.stringify(read.body));
  assert.equal(read.body.receipt,null);assert.equal(read.body.requestId,null);
  assert.deepEqual(Object.keys(read.body.result).sort(),['collectionId','listings','name','publishedAt','type']);
  const pub=await publicJSON(a);
  assert.deepEqual(read.body.result,{collectionId:'directory',type:'directory-listing@1',name:pub.name,publishedAt:pub.publishedAt,listings:pub.listings});
  assert.deepEqual(read.body.result.listings,[{id:listing,title:'Garden club',description:'Saturday mornings',url:'https://example.com/'}]);
  // A later private draft edit changes neither public read; drafts, revisions and history never appear.
  await confirm(a,await chat(a,`/directory-edit ${a.project} ${listing} | Private rename | Draft only | https://example.org/`));
  const again=await gateway(a,envelope(resource)),text=JSON.stringify(again.body);
  assert.deepEqual(again.body.result,read.body.result);for(const word of ['Private rename','Draft only','revision','snapshotId','history'])assert.ok(!text.includes(word),word);
  // The owner reads the same public snapshot through the workspace-origin module route.
  const own=await workspace(a,`/api/projects/${a.project}/modules`,{method:'POST',payload:envelope(resource)});assert.equal(own.status,200,JSON.stringify(own.body));assert.deepEqual(own.body.result,read.body.result);
  // A visitor or workspace cookie gains nothing: the result is the same public snapshot.
  assert.deepEqual((await gateway(a,envelope(resource),`__Host-whumpo_session=${a.token}`)).body.result,read.body.result);
 });

 await check('envelope, target, stale configRevision and foreign resources refuse',async()=>{
  const cases=[[envelope(resource,{target:{collectionId:'other'}}),404,'not_found'],[envelope(resource,{target:null}),404,'not_found'],[envelope(resource,{target:{collectionId:'directory',extra:1}}),400,'invalid_request'],
   [envelope(resource,{input:{}}),400,'invalid_request'],[envelope(resource,{requestId:id()}),400,'invalid_request'],[envelope(resource,{target:{collectionId:'directory',projectId:b.project}}),400,'invalid_request'],
   [envelope(resource,{configRevision:resource.config_revision+1}),409,'stale_configuration'],[envelope(resource,{operation:'records.get'}),404,'not_found'],[{...envelope(resource),version:2},400,'client_update_required']];
  for(const [payload,status,code] of cases){const r=await gateway(a,payload);assert.equal(r.status,status,JSON.stringify([payload,r.body]));assert.equal(r.body.code,code);}
  // b's resource through a's visitor origin and owner route, and a's resource for owner b, are one generic not_found.
  const foreign=await instance(b);
  assert.equal((await gateway(a,envelope(foreign))).body.code,'not_found');
  assert.equal((await workspace(a,`/api/projects/${a.project}/modules`,{method:'POST',payload:envelope(foreign)})).body.code,'not_found');
  await fails(m.sharedModules.handleModuleRequest(b.scope,ownerPrincipal({...b,project:a.project}),envelope(resource)),'not_found');
  // b has no published directory: its own collection is unavailable and never shows a's listings.
  assert.equal((await gateway(b,envelope(foreign))).body.code,'unavailable');
 });

 await check('withdrawn and restaged catalog pins refuse public reads',async()=>{
  await fails(withdrawn.handleModuleRequest(db,{kind:'public',projectId:a.project},envelope(resource)),'unavailable');
  await fails(restaged.handleModuleRequest(db,{kind:'public',projectId:a.project},envelope(resource)),'stale_module_version');
  await fails(withdrawn.handleModuleRequest(a.scope,ownerPrincipal(a),envelope(resource)),'unavailable');
 });

 await check('disable stops module serving; directory offline and parent website restore stop it too',async()=>{
  await activation(a,'listings','disable');
  assert.equal((await gateway(a,envelope(resource))).body.code,'unavailable');
  assert.equal((await m.sharedModules.handleModuleRequest(a.scope,ownerPrincipal(a),envelope(resource))).result.collectionId,'directory','owner reads outlive disable');
  await activation(a,'listings');resource=await instance(a);assert.equal((await gateway(a,envelope(resource))).status,200);
  await confirm(a,await chat(a,'/directory-off '+a.project));
  assert.equal((await gateway(a,envelope(resource))).body.code,'unavailable');assert.equal(await publicJSON(a),404);
  await confirm(a,await chat(a,'/directory-publish '+a.project));assert.equal((await gateway(a,envelope(resource))).status,200);
  await confirm(a,await chat(a,'/restore '+a.version),'site');
  assert.equal((await gateway(a,envelope(resource))).body.code,'unavailable');assert.equal(await publicJSON(a),404);
  await confirm(a,await chat(a,'/directory-publish '+a.project));assert.equal((await gateway(a,envelope(resource))).status,200);
 });

 await check('the export hook is the current directory export, owner-only, in every state, with import validation',async()=>{
  const history=await m.directory.directoryHistory(a.scope,a.user,a.project),snapshot=history.snapshots[0].id;
  const http=await workspace(a,`/api/projects/${a.project}/directory/snapshots/${snapshot}/export`);assert.equal(http.status,200);
  const exported=await exportCollectionSnapshot(a.scope,a.user,a.project,resource.id,resource.config_revision,snapshot);
  assert.deepEqual(exported,http.body);assert.equal(exported.format,'whumpo-directory');assert.equal(exported.schemaVersion,1);
  assert.equal(exported.snapshot.listingsSha256,await m.hashToken(JSON.stringify(exported.listings)));
  const valid=await m.directory.validateDirectoryExport(structuredClone(exported));assert.deepEqual(valid,{projectId:a.project,snapshotId:snapshot,listings:exported.listings});
  for(const tamper of [x=>{x.listings[0].title='Changed';},x=>{x.snapshot.listingsSha256='0'.repeat(64);},x=>{x.format='whumpo-records';},x=>{x.schemaVersion=2;},x=>{x.extra=true;},x=>{x.listings.push({id:'not-a-uuid',title:'x',description:'',url:''});},x=>{x.listings[0].url='javascript:alert(1)';}]){
   const copy=structuredClone(exported);tamper(copy);await assert.rejects(m.directory.validateDirectoryExport(copy),{status:400});
  }
  await fails(exportCollectionSnapshot(b.scope,b.user,a.project,resource.id,resource.config_revision,snapshot),'not_found');
  await fails(exportCollectionSnapshot(a.scope,a.user,a.project,(await instance(b)).id,resource.config_revision,snapshot),'not_found');
  await fails(exportCollectionSnapshot(a.scope,a.user,a.project,resource.id,resource.config_revision+1,snapshot),'stale_configuration');
  await fails(exportCollectionSnapshot(a.scope,a.user,a.project,resource.id,resource.config_revision,id()),'not_found');
  // Owner export stays intact with the pin withdrawn or restaged and while the instance is disabled.
  // Each variant bundle has its own workspace admission module, so its scope is admitted from the same session.
  const variantScope=async v=>v.admitWorkspace(db,await v.resolveIdentity(db,{version:1,client:'web',kind:'session',token:a.token}));
  for(const v of [withdrawn,restaged])assert.deepEqual(await v.exportCollectionSnapshot(await variantScope(v),a.user,a.project,resource.id,resource.config_revision,snapshot),exported);
  await fails(withdrawn.exportCollectionSnapshot(db,a.user,a.project,resource.id,resource.config_revision,snapshot),'proof_required','a raw database without workspace admission is refused');
  await activation(a,'listings','disable');
  assert.deepEqual(await exportCollectionSnapshot(a.scope,a.user,a.project,resource.id,resource.config_revision,snapshot),exported);
  await activation(a,'listings');resource=await instance(a);
  // A descriptor that names no export hook refuses (hooks resolve only from the maintained table).
  const saved=resource.descriptor_json;
  try{await run('UPDATE module_instances SET descriptor_json=? WHERE id=?',saved.replace(collectionsExportHook,'other-export-v1'),resource.id);
   await fails(exportCollectionSnapshot(a.scope,a.user,a.project,resource.id,resource.config_revision,snapshot),'unavailable');}
  finally{await run('UPDATE module_instances SET descriptor_json=? WHERE id=?',saved,resource.id);}
 });

 await check('approved custom hostnames serve the exact public directory, with tenant, lease and parent-publication fences',async()=>{
  const hostname='directory.example.test',claim=id(),connection=id(),soon=new Date(Date.now()+3600000).toISOString();
  await run("INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,'synthetic-domain-proof',?,datetime('now'))",claim,a.project,hostname,soon);
  await run("INSERT INTO domain_connections(id,user_id,claim_id,project_id,hostname,zone_id,target,proof_hash,state,created_at,expires_at) VALUES(?,?,?,?,?,'synthetic-zone','hosting.whumpo.site','synthetic-hash','review',datetime('now'),?)",connection,a.user,claim,a.project,hostname,soon);
  await run("UPDATE domain_connections SET state='provisioning',provider_id=? WHERE id=?",id(),connection);
  const get=(path='/directory.json',method='GET',host=hostname)=>m.host.fetch(new Request('https://'+host+path,{method}),{...fixture.env,...env});
  assert.equal((await get()).status,404,'A reviewed but inactive mapping serves no directory');
  await run("UPDATE domain_connections SET state='active',serve_until=?,provider_status='active',ssl_status='active' WHERE id=?",soon,connection);
  const snapshot=await publicJSON(a),read=await get();assert.equal(read.status,200);assert.deepEqual(await read.json(),snapshot);assert.equal(read.headers.get('cache-control'),'no-store');assert.equal(read.headers.get('access-control-allow-origin'),'*');
  const sharedHTML=await m.host.fetch(new Request('https://'+a.project+'.whumpo.site/directory'),{...fixture.env,...env});assert.equal(await (await get('/directory')).text(),await sharedHTML.text());
  const head=await get('/directory.json','HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');
  for(const path of ['/api/chat','/directory/history','/directory/','/s/'+b.project+'/directory.json'])assert.equal((await get(path)).status,404,path);
  assert.equal((await get('/directory.json','POST')).status,405);assert.equal((await get('/directory.json','GET','foreign.example.test')).status,404);
  await confirm(a,await chat(a,`/directory-edit ${a.project} ${listing} | Custom-domain private draft | Hidden draft`));assert.deepEqual(await (await get()).json(),snapshot,'Private draft edits never leak to custom domains');
  await confirm(a,await chat(a,'/restore '+a.version),'site');assert.equal((await get()).status,404,'Restoring the parent invalidates its directory publication');
  await confirm(a,await chat(a,'/directory-publish '+a.project));assert.deepEqual(await (await get()).json(),await publicJSON(a));
  await run("UPDATE domain_connections SET serve_until='2000-01-01T00:00:00.000Z' WHERE id=?",connection);assert.equal((await get()).status,404);
  await run("UPDATE domain_connections SET serve_until=?,state='disconnecting' WHERE id=?",soon,connection);assert.equal((await get()).status,404,'Disconnecting is immediately offline');
  await run("UPDATE domain_connections SET state='active' WHERE id=?",connection);await confirm(a,await chat(a,'/directory-off '+a.project));assert.equal((await get()).status,404);
  await confirm(a,await chat(a,'/directory-publish '+a.project));assert.equal((await get()).status,200);
 });

 await check('content restore hook prepares the existing exact private review, with scope, current pins, replay and commit fences',async()=>{
  const live=await publicJSON(a),original=await m.directory.directorySnapshot(a.scope,a.user,a.project,listing);
  resource=await instance(a);const action={type:'collectionRestoreReview',projectId:a.project,resourceId:resource.id,configRevision:resource.config_revision,snapshotId:listing};
  for(const bad of [{...action,listings:[]},{...action,configRevision:0},{...action,snapshotId:'bad'},{...action,resourceId:a.project,extra:true}])assert.ok(!m.chatControl(bad));
  assert.equal((await control(b,action)).status,404);assert.equal((await control(a,{...action,resourceId:(await instance(b)).id})).status,404);
  assert.equal((await control(a,{...action,configRevision:resource.config_revision+1})).status,409);assert.equal((await control(a,{...action,snapshotId:id()})).status,404);
  await fails(m.sharedModuleCollections.prepareCollectionRestore(db,a.user,id(),a.project,resource.id,resource.config_revision,listing),'proof_required');
  for(const [variant,code] of [[withdrawn,'unavailable'],[restaged,'stale_module_version']]){
   const scoped=await variant.admitWorkspace(db,await variant.resolveIdentity(db,{version:1,client:'web',kind:'session',token:a.token}));
   await fails(variant.prepareCollectionRestore(scoped,a.user,id(),a.project,resource.id,resource.config_revision,listing),code);
  }
  await activation(a,'listings','disable');
  const before=(await m.directory.readDirectory(a.scope,a.user,a.project)).revision,input={id:id(),revision:await revision(a),action};
  const prepared=await m.sendChatControl(a.scope,a.user,input);assert.equal(prepared.status,200,prepared.error);assert.equal((await m.sendChatControl(a.scope,a.user,input)).status,200);
  const review=await row('SELECT * FROM directory_reviews WHERE id=?',input.id);assert.equal(review.source_review_id,listing);assert.equal(review.kind,'edit');assert.equal(review.status,'pending');assert.equal(review.digest,original.digest);
  assert.equal((await m.directory.readDirectory(a.scope,a.user,a.project)).revision,before);assert.deepEqual(await publicJSON(a),live,'Prepare publishes nothing');
  assert.equal((await m.readChat(a.scope,a.user)).turns.find(t=>t.id===input.id).directory_confirmation_id,input.id);
  // A current review never outruns a later trusted catalog withdrawal or restage at confirmation.
  for(const variant of [withdrawn,restaged,compilerWithdrawn]){
   const scoped=await variant.admitWorkspace(db,await variant.resolveIdentity(db,{version:1,client:'web',kind:'session',token:a.token}));
   const denied=await variant.sendChatControl(scoped,a.user,{id:id(),revision:await revision(a),action:{type:'confirm',kind:'directory',reviewId:input.id}});
   assert.equal(denied.status,409,JSON.stringify(denied));assert.equal((await m.directory.readDirectory(a.scope,a.user,a.project)).revision,before);
  }
  // Admission repeats resource revision and exact source even for a forged internal statement.
  const forged=id(),rev=await revision(a)+1;await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,action_json) VALUES(?,?,?,'Synthetic stale restore','',datetime('now'),?)",forged,a.user,rev,JSON.stringify({...action,configRevision:action.configRevision+1}));await run('UPDATE workspace_state SET revision=? WHERE user_id=?',rev,a.user);
  await assert.rejects(run("INSERT INTO directory_reviews(id,user_id,project_id,kind,snapshot_json,digest,expected_revision,publication_revision,expires_at,source_review_id) SELECT ?,user_id,project_id,kind,snapshot_json,digest,expected_revision,publication_revision,expires_at,source_review_id FROM directory_reviews WHERE id=?",forged,input.id),/directory_changed/);
  // Hook withdrawal after preparation is checked again inside confirmation; no partial draft or Chat receipt.
  await run("UPDATE module_instances SET descriptor_json=json_set(descriptor_json,'$.lifecycle.restoreHook','unsupported') WHERE id=?",resource.id);
  assert.equal((await control(a,{type:'confirm',kind:'directory',reviewId:input.id})).status,409);assert.equal((await m.directory.readDirectory(a.scope,a.user,a.project)).revision,before);
  await run('UPDATE module_instances SET descriptor_json=? WHERE id=?',resource.descriptor_json,resource.id);
  const approval={id:id(),revision:await revision(a),action:{type:'confirm',kind:'directory',reviewId:input.id}};assert.equal((await m.sendChatControl(a.scope,a.user,approval)).status,200);assert.equal((await m.sendChatControl(a.scope,a.user,approval)).status,200);
  assert.deepEqual((await m.directory.readDirectory(a.scope,a.user,a.project)).draft,original.listings);assert.deepEqual(await publicJSON(a),live,'Restored draft remains private until separate publication');
  assert.equal((await m.directory.readDirectory(a.scope,a.user,a.project)).revision,before+1);assert.equal((await instance(a)).state,'inactive');
  await activation(a,'listings');resource=await instance(a);
  const stale=await control(a,action);assert.equal(stale.status,200);await confirm(a,await chat(a,`/directory-edit ${a.project} ${listing} | Newest private draft | Current`));
  assert.equal((await control(a,{type:'confirm',kind:'directory',reviewId:stale.id})).status,409,'Concurrent draft change requires a fresh exact restore review');
 });

 await check('owner edits keep the existing directory reviews; the module adds no write, staff path or model surface',async()=>{
  for(const [operation,write] of Object.entries(m.modulePolicy.moduleOperations))if(operation.startsWith('collections.'))assert.equal(write.write,false,operation);
  assert.deepEqual(Object.keys(m.sharedModuleCollections.collectionsHandlers),['collections.readPublic']);
  // The site agent does not advertise module operations (owner decision, October 4, 2026).
  const prompt=m.agentPrompt({})+m.agentPrompt({},'website');for(const word of ['collections.readPublic','whumpo-modules','modules.put','modules.remove'])assert.ok(!prompt.includes(word),word);
  const inference=/^src\/(ai|ai-chat|ai-gateway|acknowledgment|site-agent|agent-[a-z-]+|standard-ai[a-z-]*|chat|backend-chat|app-upgrade-chat|app-recovery-chat|app-page-design)\.ts$|^src\/chat-interactions\/(agent|agent-request|model-continuation|continuation)\.ts$/;
  for(const entry of ['src/shared-modules/collections.ts','src/shared-modules/api.ts']){
   const out=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false,metafile:true,logLevel:'silent'});
   assert.deepEqual(Object.keys(out.metafile.inputs).filter(p=>inference.test(p)),[],entry+' reaches owner-maintenance inference');
   for(const name of ['AI_GATEWAY','OPENAI','ANTHROPIC','sendAIChat','agentPrompt','siteContext'])assert.ok(!out.outputFiles[0].text.includes(name),entry+' references '+name);
  }
  // Project deletion cascades the instance with the directory it governs.
  await run('DELETE FROM projects WHERE id=?',b.project);
  assert.equal(await row('SELECT 1 x FROM module_instances WHERE project_id=?',b.project),null);assert.equal(await row('SELECT 1 x FROM directories WHERE project_id=?',b.project),null);
  assert.equal(network,0);
 });

 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 process.stdout.write(`Shared module collections passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'} — directory as the content-collections instance, collections.readPublic through the visitor and workspace origins returning only the approved snapshot (equal to the public directory JSON), draft/offline/parent-restore/disable refusals, envelope/target/stale configRevision/foreign refusals, withdrawn and restaged pins, the descriptor export hook equal to the directory export with import validation and owner export in every state, approved custom-host snapshot parity and lease/parent-publication fences, exact lifecycle restore adapter with current pin/resource/ancestry guards, existing directory reviews as the only write path, project cascade and a static no-inference check. No network, model or provider use.\n`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}
