import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
import {validateDescriptor} from '../tools/prototypes/workload-placement.mjs';
Error.stackTraceLimit=0;
// WH-128 files and galleries module. Actual handlers (visitor gateway POST /modules/upload and /modules, the workspace
// owner route, the module engine, files handlers, commit triggers, the existing photo safety receipt/approval view, photo
// removal review and safety holds) run against the complete current schema: disposable SQLite with an in-memory private
// bucket, or local D1 and local R2 with --d1. Two owners/projects; synthetic images, identities and clearances only (no
// scanner). No model, provider or network is used: fetch throws.
const d1=process.argv.includes('--d1');
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(d1?{d1:true,r2:true}:{}),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network or inference is available');};
/** In-memory stand-in for the private R2 bucket in SQLite mode (create-only put, get, head, delete, list). */
function memoryBucket(){
 const objects=new Map(),object=(key,o)=>({key,size:o.bytes.length,customMetadata:o.meta,uploaded:o.uploaded,body:{cancel:async()=>{}},arrayBuffer:async()=>o.bytes.slice().buffer});
 return {
  async put(key,bytes,options={}){if(options.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;objects.set(key,{bytes:new Uint8Array(bytes),meta:options.customMetadata??{},uploaded:new Date()});return object(key,objects.get(key));},
  async get(key){const o=objects.get(key);return o?object(key,o):null;},async head(key){const o=objects.get(key);return o?object(key,o):null;},
  async delete(keys){for(const key of [keys].flat())objects.delete(key);},
  async list({prefix=''}={}){return {objects:[...objects].filter(([k])=>k.startsWith(prefix)).map(([k,o])=>object(k,o)),truncated:false};},
 };
}
const FILES=d1?fixture.env.FILES:memoryBucket();
const dir=await mkdtemp('/tmp/whumpo-module-files-');
execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(80,120,60)).save(sys.argv[1]+'/a.jpg'); Image.new('RGB',(40,30),(20,40,200)).save(sys.argv[1]+'/b.jpg')",dir]);
const jpegA=new Uint8Array(await readFile(dir+'/a.jpg')),jpegB=new Uint8Array(await readFile(dir+'/b.jpg'));await rm(dir,{recursive:true,force:true});
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const {appAuth:auth,appActivation,appGateway,appLifecycle}=m,{saveBackend,testBackend}=m.backend;
const runtime={fetch:async()=>Response.json({ok:true,value:{state:{},result:{}}})};
const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:runtime,FILES};
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const accessInstance={id:'members',kind:'access',...pins('access'),dependencies:[],config:{roles:['staff'],enrollment:'invitation'}};
const collection=(id,read,upload,gallery)=>({id,read,upload,maxBytes:1048576,mediaTypes:['image/jpeg'],gallery});
const filesInstance={id:'media',kind:'files',...pins('files'),dependencies:['members'],config:{collections:[
 collection('intake','staff',['staff'],{audience:'staff'}),collection('mine','submitter',['visitor'],{audience:'visitor'}),collection('private','owner',['staff'],null),collection('library','owner',['owner'],null)]}};
const hex=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');

async function owner(){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,'Studio '+id().slice(0,6),'Photo studio');
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-128 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,feature,operation);
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
async function chat(o,content){const turn=id();return {turn,result:await m.sendChat(o.scope,o.user,{id:turn,revision:await revision(o),content})};}
async function activation(o,instanceId,action='activate'){
 const r=await control(o,{type:'moduleActivationReview',projectId:o.project,instanceId,action});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',r.id);
 const a=await control(o,{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision});assert.equal(a.status,200,a.error);
}
async function setRole(o,visitorId,action){
 const r=await control(o,{type:'accessRoleReview',projectId:o.project,instanceId:'members',visitorId,action});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_access_role_reviews WHERE id=?',r.id);
 const a=await control(o,{type:'accessRoleApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_access_revision});assert.equal(a.status,200,a.error);
}
const instance=(o,localId)=>row('SELECT i.*,a.state FROM module_instances i JOIN module_activations a ON a.instance_id=i.id WHERE i.project_id=? AND i.local_id=?',o.project,localId);
const envelope=(resource,operation,{target=null,input=null,requestId}={})=>({api:'whumpo-modules',version:1,operation,resourceId:resource.id,configRevision:resource.config_revision,requestId:requestId??(m.modulePolicy.moduleOperations[operation].write?id():null),target,input});
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function upload(o,payload,v,bytes=jpegA,{contentType='image/jpeg',header=b64(payload)}={}){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules/upload',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.40','content-type':contentType,origin:o.host,cookie:v?.cookie??'','whumpo-module-request':header},body:bytes}),env);
 return {status:response.status,body:await response.json()};
}
async function gateway(o,payload,v){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.41','content-type':'application/json',origin:o.host,cookie:v?.cookie??''},body:JSON.stringify(payload)}),env);
 assert.equal(response.headers.get('access-control-allow-origin'),null);
 const image=response.headers.get('content-type')==='image/jpeg';
 return {status:response.status,headers:response.headers,body:image?null:await response.json(),bytes:image?new Uint8Array(await response.arrayBuffer()):null};
}
async function ownerCall(o,payload){
 const response=await m.worker.fetch(new Request(`https://whumpo.com/api/projects/${o.project}/modules`,{method:'POST',headers:{cookie:`__Host-whumpo_session=${o.token}`,origin:'https://whumpo.com','content-type':'application/json'},body:JSON.stringify(payload)}),{...(fixture.env??{}),...env},{waitUntil(){}});
 return {status:response.status,body:await response.json()};
}
const put=async(resource,collectionId,bytes=jpegA,extra={})=>envelope(resource,'files.putBytes',{target:{collectionId},input:{mediaType:'image/jpeg',byteLength:bytes.length,sha256:await hex(bytes),...extra}});
const galleryOf=(resource,collectionId)=>envelope(resource,'files.gallery',{target:{collectionId}});
const readOf=(resource,collectionId,fileId)=>envelope(resource,'files.read',{target:{collectionId,fileId}});
const approve=fileId=>run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-clearance',expires_at=? WHERE file_id=?",new Date(Date.now()+3600000).toISOString(),fileId);

try{
 const a=await owner(),b=await owner();
 await check('over-wide galleries are rejected before any configuration is saved',async()=>{
  const head=JSON.parse((await row('SELECT v.spec_json FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=?',a.project)).spec_json);
  const wide=[collection('x','owner',['staff'],{audience:'staff'}),collection('x','staff',['staff'],{audience:'visitor'})];
  for(const c of wide)assert.throws(()=>m.validateSpecification({...head,instances:[accessInstance,{...filesInstance,config:{collections:[c]}}]}),e=>e.code==='FIELD_FORBIDDEN');
  m.validateSpecification({...head,instances:[accessInstance,filesInstance]});
 });
 await configureFixtureModules(a.scope,a.user,a.project,[accessInstance,filesInstance]);await activation(a,'members');await activation(a,'media');
 await configureFixtureModules(b.scope,b.user,b.project,[accessInstance,filesInstance]);await activation(b,'members');await activation(b,'media');
 const staff=await visitor(a),plain=await visitor(a),other=await visitor(a),bv=await visitor(b);
 await setRole(a,staff.visitorId,'grant');
 const media=await instance(a,'media'),theirs=await instance(b,'media');
 let first;

 await check('staff-only upload is the collection role policy; names, prefixes and keys grant nothing',async()=>{
  const ok=await put(media,'intake'),sent=await upload(a,ok,staff);assert.equal(sent.status,200,JSON.stringify(sent.body));
  assert.deepEqual(Object.keys(sent.body.result).sort(),['collectionId','fileId','safety']);assert.equal(sent.body.result.safety,'pending');first=sent.body.result.fileId;
  const file=await row('SELECT * FROM project_files WHERE id=?',first),link=await row('SELECT * FROM module_files WHERE file_id=?',first);
  assert.equal(file.status,'ready');assert.equal(file.object_key,`photos/${a.project}/${first}.jpg`);assert.match(file.name,/^Staff upload [0-9a-f]{8}$/);assert.equal(file.handoff_json,'null');
  assert.equal(link.uploader_kind,'staff');assert.equal(link.visitor_id,staff.visitorId);assert.equal(link.collection_id,'intake');
  assert.equal((await row('SELECT state FROM project_photo_safety WHERE file_id=?',first)).state,'pending','Every upload gets a pending safety receipt atomically');
  const object=await FILES.get(file.object_key);assert.equal(object.size,file.size);assert.equal(await hex(new Uint8Array(await object.arrayBuffer())),file.digest);
  assert.ok(!JSON.stringify(sent.body).includes('photos/'),'Object keys stay server-only');
  // Exact replay reads the receipt back without a second object; the same request id with other bytes conflicts.
  const replay=await upload(a,ok,staff);assert.equal(replay.body.receipt.replayed,true);assert.equal(replay.body.result.fileId,first);
  assert.equal((await row("SELECT count(*) n FROM module_files WHERE instance_id=?",media.id)).n,1);
  assert.equal((await upload(a,{...(await put(media,'intake',jpegB)),requestId:ok.requestId},staff,jpegB)).body.code,'request_conflict');
  // Plain visitors, anonymous callers, foreign visitors, a workspace cookie and the owner are refused by the policy.
  for(const [v,code] of [[plain,'forbidden'],[null,'forbidden'],[bv,'forbidden'],[{cookie:`__Host-whumpo_session=${a.token}`},'forbidden']])assert.equal((await upload(a,await put(media,'intake'),v)).body.code,code);
  assert.equal((await upload(b,await put(media,'intake'),bv)).body.code,'not_found');
  assert.equal((await ownerCall(a,await put(media,'intake'))).body.code,'forbidden');
  assert.equal((await upload(a,await put(media,'mine'),staff)).body.code,'forbidden','Staff are not visitors for a visitor-only collection');
  // Caller-supplied locations or names are refused or ignored; a different declared digest or length is refused.
  for(const target of [{collectionId:'intake',path:'photos/x'},{collectionId:'intake',prefix:'photos/'},{collectionId:'intake',bucket:'whumpo-files'}])assert.equal((await upload(a,{...(await put(media,'intake')),target},staff)).body.code,'invalid_request');
  assert.equal((await upload(a,await put(media,'intake',jpegA,{name:'evil.jpg'}),staff)).body.code,'invalid_request');
  assert.equal((await upload(a,await put(media,'intake',jpegB),staff,jpegA)).body.code,'invalid_request');
  assert.equal((await upload(a,{...(await put(media,'intake')),input:{mediaType:'image/png',byteLength:jpegA.length,sha256:await hex(jpegA)}},staff)).body.code,'invalid_request');
  const svg=new TextEncoder().encode('<svg onload="alert(1)"></svg>');assert.equal((await upload(a,await put(media,'intake',svg),staff,svg)).body.code,'invalid_request');
  assert.equal((await upload(a,await put(media,'intake'),staff,jpegA,{contentType:'image/png'})).status,415);
  assert.equal((await upload(a,await put(media,'intake'),staff,jpegA,{header:'not base64!'})).body.code,'invalid_request');
  assert.equal((await upload(a,await envelope(media,'files.gallery',{target:{collectionId:'intake'}}),staff)).body.code,'invalid_request','Only files.putBytes on the upload route');
  assert.equal((await gateway(a,await put(media,'intake'),staff)).body.code,'invalid_request','files.putBytes never on the JSON route');
  assert.equal((await row("SELECT count(*) n FROM module_files WHERE instance_id=?",media.id)).n,1);
  // Revoking the staff role ends upload authority at the next decision.
  await setRole(a,staff.visitorId,'revoke');assert.equal((await upload(a,await put(media,'intake'),staff)).body.code,'forbidden');await setRole(a,staff.visitorId,'grant');
 });

 await check('held, blocked and tampered files are never served; approved bytes are re-hashed',async()=>{
  const fresh=await instance(a,'media');
  assert.deepEqual((await gateway(a,galleryOf(fresh,'intake'),staff)).body.result.items,[],'Pending files are not in galleries');
  assert.equal((await gateway(a,readOf(fresh,'intake',first),staff)).body.code,'unavailable');
  const ownerView=await ownerCall(a,galleryOf(fresh,'intake'));assert.equal(ownerView.status,200);assert.deepEqual(ownerView.body.result.items.map(i=>[i.fileId,i.safety,i.uploadedBy]),[[first,'pending','staff']]);
  assert.equal((await ownerCall(a,readOf(fresh,'intake',first))).body.code,'unavailable','No byte read on the workspace origin');
  await approve(first);
  const listed=await gateway(a,galleryOf(fresh,'intake'),staff);assert.deepEqual(listed.body.result.items.map(i=>i.fileId),[first]);assert.equal(listed.body.result.items[0].safety,undefined);
  const bytes=await gateway(a,readOf(fresh,'intake',first),staff);assert.equal(bytes.status,200);
  assert.equal(await hex(bytes.bytes),(await row('SELECT digest FROM project_files WHERE id=?',first)).digest);
  assert.match(bytes.headers.get('content-security-policy'),/sandbox/);assert.equal(bytes.headers.get('cache-control'),'private, no-store');assert.equal(bytes.headers.get('x-content-type-options'),'nosniff');
  // Plain visitors cannot read a staff collection; foreign projects learn nothing.
  assert.equal((await gateway(a,readOf(fresh,'intake',first),plain)).body.code,'forbidden');
  assert.equal((await gateway(a,galleryOf(fresh,'intake'),null)).body.code,'forbidden');
  assert.equal((await gateway(b,readOf(theirs,'intake',first),bv)).body.code,'forbidden');
  assert.equal((await gateway(a,readOf(fresh,'private',first),staff)).body.code,'forbidden','An owner-read collection is not served to staff');
  // A changed stored object fails the digest check instead of being served.
  const key=(await row('SELECT object_key FROM project_files WHERE id=?',first)).object_key;
  await FILES.put(key,jpegB,{httpMetadata:{contentType:'image/jpeg'}});
  assert.equal((await gateway(a,readOf(fresh,'intake',first),staff)).body.code,'unavailable');
 });

 await check('visitor collection: own uploads only, blocked never served, galleries scoped',async()=>{
  const fresh=await instance(a,'media');
  const mine=(await upload(a,await put(fresh,'mine'),plain)).body.result.fileId,theirsFile=(await upload(a,await put(fresh,'mine',jpegB),other,jpegB)).body.result.fileId;
  assert.equal((await row('SELECT uploader_kind FROM module_files WHERE file_id=?',mine)).uploader_kind,'visitor');
  await approve(mine);await approve(theirsFile);
  assert.deepEqual((await gateway(a,galleryOf(fresh,'mine'),plain)).body.result.items.map(i=>i.fileId),[mine]);
  assert.equal((await gateway(a,readOf(fresh,'mine',theirsFile),plain)).body.code,'not_found');
  assert.equal((await gateway(a,readOf(fresh,'mine',mine),plain)).status,200);
  await run("UPDATE project_photo_safety SET state='blocked',csam_check='unknown',sexual_check='matched',scanner_reference='synthetic-block',expires_at=NULL WHERE file_id=?",theirsFile).catch(async()=>{
   await run('DELETE FROM project_photo_safety WHERE file_id=?',theirsFile);await run("INSERT INTO project_photo_safety(file_id,user_id,digest,policy_version,state,sexual_check) SELECT ?,owner_user_id,(SELECT digest FROM project_files WHERE id=?),'2026-09-30','blocked','matched' FROM projects WHERE id=?",theirsFile,theirsFile,a.project);});
  assert.equal((await gateway(a,readOf(fresh,'mine',theirsFile),other)).body.code,'unavailable');
  assert.deepEqual((await gateway(a,galleryOf(fresh,'mine'),other)).body.result.items,[]);
 });

 await check('files export serializer: owner-only, approved exact-digest bytes only, visitor-scoped slice, validated import shape',async()=>{
  const {exportFiles,validateFilesExport}=m.moduleFilesExport,fails=async(promise,code)=>{await assert.rejects(promise,e=>{assert.equal(e?.code,code,String(e?.stack??e));return true;});};
  const fresh=await instance(a,'media'),descriptor=validateDescriptor(JSON.parse(fresh.descriptor_json));
  assert.equal(descriptor.lifecycle.exportHook,'files-export-v1');assert.deepEqual(descriptor.ownership.data.map(x=>[x.classId,x.subject,x.export]),[['module-files','visitor','separate-approval']]);
  const approvedMine=(await rows("SELECT mf.file_id FROM module_files mf JOIN project_files f ON f.id=mf.file_id JOIN approved_project_photos s ON s.id=f.id AND s.digest=f.digest WHERE mf.instance_id=? AND mf.collection_id='mine' ORDER BY mf.created_at DESC,mf.file_id DESC",fresh.id)).map(r=>r.file_id);
  const heldMine=(await row("SELECT count(*) n FROM module_files mf JOIN project_files f ON f.id=mf.file_id WHERE mf.instance_id=? AND mf.collection_id='mine' AND NOT EXISTS(SELECT 1 FROM approved_project_photos s WHERE s.id=f.id AND s.digest=f.digest)",fresh.id)).n;
  assert.ok(approvedMine.length>=1&&heldMine>=1,'The collection holds approved and blocked files');
  const exported=await exportFiles(a.scope,FILES,a.user,a.project,fresh.id,fresh.config_revision,{collectionId:'mine'});
  assert.equal(exported.format,'whumpo-module-files');assert.deepEqual(exported.files.map(f=>f.fileId),approvedMine);assert.equal(exported.withheld,heldMine);assert.equal(exported.next,null);
  for(const f of exported.files){
   const saved=await row('SELECT digest,size FROM project_files WHERE id=?',f.fileId),bytes=Buffer.from(f.bytes,'base64');
   assert.equal(f.sha256,saved.digest);assert.equal(bytes.length,saved.size);assert.equal(await hex(bytes),saved.digest);assert.equal(f.uploadedBy,'visitor');
  }
  const text=JSON.stringify(exported);assert.ok(!text.includes('photos/'),'No object key');assert.ok(!text.includes('synthetic-clearance')&&!text.includes('synthetic-block'),'No scanner reference');assert.ok(!/Visitor upload/.test(text),'No file name');
  const valid=await validateFilesExport(JSON.parse(text));assert.equal(valid.files.length,exported.files.length);
  // The visitor-subject slice holds only that visitor's own approved uploads; the other visitor's blocked file is withheld.
  const mine=await exportFiles(a.scope,FILES,a.user,a.project,fresh.id,fresh.config_revision,{collectionId:'mine',visitorId:plain.visitorId});
  assert.ok(mine.files.length>=1&&mine.files.every(f=>f.visitorId===plain.visitorId));
  const theirs=await exportFiles(a.scope,FILES,a.user,a.project,fresh.id,fresh.config_revision,{collectionId:'mine',visitorId:other.visitorId});assert.deepEqual(theirs.files,[]);assert.equal(theirs.withheld,1);
  const tampers=[x=>{x.files[0].bytes=Buffer.from(jpegB).toString('base64');},x=>{x.files[0].size+=1;},x=>{x.files[0].uploadedBy='owner';},x=>{x.files[0].mediaType='image/png';},
   x=>{x.files[0].bytes=Buffer.from('<svg/>').toString('base64');},x=>{x.extra=1;},x=>{x.schemaVersion=2;},x=>{x.files.push({...x.files[0]});},x=>{x.withheld=-1;},x=>{x.filesSha256='0'.repeat(64);}];
  for(const tamper of tampers){const copy=JSON.parse(text);tamper(copy);await fails(validateFilesExport(copy),'invalid_request');}
  const scoped=JSON.parse(JSON.stringify(mine));scoped.subject.visitorId=other.visitorId;await fails(validateFilesExport(scoped),'invalid_request');
  // A stored object that no longer matches its approved digest fails the export instead of being skipped or served.
  await fails(exportFiles(a.scope,FILES,a.user,a.project,fresh.id,fresh.config_revision,{collectionId:'intake'}),'unavailable');
  // Foreign owners, other kinds, stale revisions, unknown collections, foreign visitors, bad cursors and a raw database are refused.
  const members=await instance(a,'members');
  await fails(exportFiles(b.scope,FILES,b.user,a.project,fresh.id,fresh.config_revision,{collectionId:'mine'}),'not_found');
  await fails(exportFiles(a.scope,FILES,a.user,a.project,members.id,members.config_revision,{collectionId:'mine'}),'not_found');
  await fails(exportFiles(a.scope,FILES,a.user,a.project,fresh.id,fresh.config_revision+1,{collectionId:'mine'}),'stale_configuration');
  await fails(exportFiles(a.scope,FILES,a.user,a.project,fresh.id,fresh.config_revision,{collectionId:'missing'}),'not_found');
  await fails(exportFiles(a.scope,FILES,a.user,a.project,fresh.id,fresh.config_revision,{collectionId:'mine',visitorId:bv.visitorId}),'not_found');
  await fails(exportFiles(a.scope,FILES,a.user,a.project,fresh.id,fresh.config_revision,{collectionId:'mine',after:'not a cursor'}),'invalid_request');
  await fails(exportFiles(db,FILES,a.user,a.project,fresh.id,fresh.config_revision,{collectionId:'mine'}),'proof_required');
  await run("UPDATE module_instances SET descriptor_json=json_set(descriptor_json,'$.lifecycle.exportHook',NULL) WHERE id=?",fresh.id);
  await fails(exportFiles(a.scope,FILES,a.user,a.project,fresh.id,fresh.config_revision,{collectionId:'mine'}),'unavailable');
  await run('UPDATE module_instances SET descriptor_json=? WHERE id=?',fresh.descriptor_json,fresh.id);
 });

 await check('existing owner photos as an owner collection and a published gallery through the exact reviews',async()=>{
  const fresh=await instance(a,'media'),ownerPhoto=async name=>{const fileId=id();const r=await m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':encodeURIComponent(name)},body:jpegA}),{...env,DB:a.scope},a.user,a.project,fileId);assert.equal(r.status,'ready');return fileId;};
  const p1=await ownerPhoto('Garden one'),p2=await ownerPhoto('Garden two'),p3=await ownerPhoto('Garden held');
  const foreign=(await m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':'Other'},body:jpegB}),{...env,DB:b.scope},b.user,b.project,id())).id;
  const digest=async fileId=>(await row('SELECT digest FROM project_files WHERE id=?',fileId)).digest;
  const file=async(fileId,collectionId='library',extra={})=>envelope(fresh,'files.putBytes',{target:{collectionId},input:{fileId,sha256:await digest(fileId),...extra}});
  const before={rows:(await row('SELECT count(*) n FROM project_files')).n,objects:d1?null:(await FILES.list({prefix:'photos/'})).objects.length};
  // The owner files an existing photo by id and exact digest: no bytes, no second row or object.
  const filing=await file(p1),filed=await ownerCall(a,filing);assert.equal(filed.status,200,JSON.stringify(filed.body));
  assert.deepEqual(filed.body.result,{fileId:p1,collectionId:'library',safety:'pending'});
  const link=await row('SELECT * FROM module_files WHERE file_id=?',p1);assert.equal(link.uploader_kind,'owner');assert.equal(link.visitor_id,null);assert.equal(link.collection_id,'library');
  assert.equal((await row('SELECT count(*) n FROM project_files')).n,before.rows,'No duplicate photo row');
  if(!d1)assert.equal((await FILES.list({prefix:'photos/'})).objects.length,before.objects,'No duplicate object');
  assert.equal((await ownerCall(a,filing)).body.receipt.replayed,true);
  // Refusals: wrong digest, already filed, a module upload, another project's photo, a collection without owner upload, staff.
  assert.equal((await ownerCall(a,{...(await file(p2)),input:{fileId:p2,sha256:'0'.repeat(64)}})).body.code,'invalid_request');
  assert.equal((await ownerCall(a,await file(p1))).body.code,'invalid_request');
  const moduleUpload=(await row("SELECT file_id FROM module_files WHERE project_id=? AND uploader_kind!='owner' LIMIT 1",a.project)).file_id;
  assert.equal((await ownerCall(a,{...(await file(p2)),input:{fileId:moduleUpload,sha256:await digest(moduleUpload)}})).body.code,'not_found');
  assert.equal((await ownerCall(a,{...(await file(p2)),input:{fileId:foreign,sha256:await digest(foreign)}})).body.code,'not_found');
  assert.equal((await ownerCall(a,await file(p2,'intake'))).body.code,'forbidden');
  assert.equal((await ownerCall(a,{...(await file(p2)),input:{fileId:p2,sha256:await digest(p2),name:'x'}})).body.code,'invalid_request');
  assert.equal((await upload(a,await file(p2),staff)).body.code,'forbidden','Staff cannot use the owner collection');
  assert.equal((await gateway(a,galleryOf(fresh,'library'),staff)).body.code,'forbidden','An owner-read collection is not served to staff');
  await assert.rejects(()=>run("INSERT INTO module_files VALUES(?,?,?,'library','owner',?,?,unixepoch())",p2,fresh.id,a.project,staff.visitorId,id()),/CHECK|module_request/);
  // Filed photos stay in the owner's library, Chat and model context; module uploads stay out.
  const listed=await m.listPhotos(a.scope,a.user,a.project);assert.ok(listed.files.some(f=>f.id===p1));assert.ok(!listed.files.some(f=>f.id===moduleUpload));
  assert.ok(JSON.stringify(await m.siteContext(a.scope,a.user)).includes(p1));
  // The owner gallery shows every filed photo with its safety state; the gallery control refuses held photos.
  assert.equal((await ownerCall(a,await file(p2))).status,200);assert.equal((await ownerCall(a,await file(p3))).status,200);
  const ownerView=await ownerCall(a,galleryOf(fresh,'library'));assert.deepEqual(ownerView.body.result.items.map(i=>[i.uploadedBy,i.safety]).sort(),[['owner','pending'],['owner','pending'],['owner','pending']]);
  const gallery={type:'galleryPageReview',projectId:a.project,instanceId:'media',collectionId:'library',pageId:'home'};
  for(const action of [{...gallery,photos:[p1]},{...gallery,pageId:'Home'},{...gallery,projectId:'x'},{type:'galleryPageReview',projectId:a.project}])assert.ok(!m.chatControl(action));
  const held=await control(a,gallery);assert.equal(held.status,409);assert.match(held.error,/no approved photos/);
  await approve(p1);await approve(p2);
  assert.equal((await control(a,{...gallery,collectionId:'intake'})).status,403,'Only an owner collection');
  assert.equal((await control(a,{...gallery,collectionId:'missing'})).status,404);
  assert.equal((await control(b,gallery)).status,404,'A foreign owner cannot use the collection');
  assert.equal((await control(a,{...gallery,pageId:'nowhere'})).status>=400,true);
  const prepared=await control(a,gallery);assert.equal(prepared.status,200,prepared.error);
  const q=await row('SELECT * FROM project_spec_proposals WHERE id=?',prepared.id),spec=JSON.parse(q.spec_json),home=spec.pages.find(p=>p.id==='home');
  assert.equal(home.component,'photo-page@1');assert.deepEqual(home.photos.map(p=>p.id).sort(),[p1,p2].sort(),'Approved owner-filed photos only, never the held one');
  assert.deepEqual(home.photos.map(p=>p.alt).sort(),['Garden one','Garden two']);
  assert.equal(await row('SELECT 1 FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=? AND v.spec_digest=?',a.project,q.spec_digest),null,'Preparing saves nothing');
  // Inside the commit: a proposal bound to a galleryPageReview turn is exactly the head with that page's photos replaced
  // by approved owner-filed photos of that collection.
  const synthetic=async(o,action)=>{const t=id(),r=await revision(o)+1;await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,action_json) VALUES(?,?,?,'Synthetic gallery turn','',strftime('%Y-%m-%dT%H:%M:%fZ','now'),?)",t,o.user,r,JSON.stringify(action));await run('UPDATE workspace_state SET revision=? WHERE user_id=?',r,o.user);return t;};
  const copy=(turnId,specJSON)=>run('INSERT INTO project_spec_proposals SELECT ?,user_id,project_id,operation,expected_revision,draft_revision,base_version_id,target_version_id,base_digest,request_hash,proposal_digest,spec_digest,manifest_digest,policy_version,expires_at,?,lock_json,manifest_json,config_json,html,html_digest,diff_json,envelope_json FROM project_spec_proposals WHERE id=?',turnId,specJSON,q.id);
  const page=photos=>JSON.stringify({...spec,pages:spec.pages.map(p=>p.id==='home'?{...p,photos}:p)});
  for(const tampered of [page([{id:p3,alt:'Held'}]),page([{id:moduleUpload,alt:'Visitor'}]),page([...home.photos,{id:foreign,alt:'Foreign'}]),JSON.stringify({...spec,name:'Renamed'}),page([])])
   await assert.rejects(copy(await synthetic(a,gallery),tampered),/specification_changed/);
  await assert.rejects(copy(await synthetic(a,{...gallery,collectionId:'intake'}),q.spec_json),/specification_changed/,'Another collection admits nothing');
  await copy(await synthetic(a,gallery),q.spec_json);
  // Module uploads can never become website photos, even approved and by a direct insert.
  await approve(moduleUpload).catch(()=>{});
  await assert.rejects(()=>run('INSERT INTO version_photos(version_id,file_id,position,alt) SELECT version_id,?,3,? FROM project_spec_heads WHERE project_id=?',moduleUpload,'x',a.project),/version_photo_owner|UNIQUE|PRIMARY/);
  // Saving is the existing recent-sign-in specificationApply; publication is the existing exact publication review.
  const saved=await control(a,{type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision});assert.equal(saved.status,200,saved.error);
  const head=await row('SELECT version_id FROM project_spec_heads WHERE project_id=?',a.project);
  assert.deepEqual((await rows('SELECT file_id FROM version_photos WHERE version_id=? ORDER BY position',head.version_id)).map(r=>r.file_id).sort(),[p1,p2].sort());
  const site=path=>m.host.fetch(new Request(`https://${a.project}.whumpo.site${path}`),{...env,DB:db});
  assert.equal((await site(`/assets/${p1}.jpg`)).status,404,'Not public before the publication review');
  const review=await chat(a,'/publish '+head.version_id);assert.equal(review.result.status,200,JSON.stringify(review.result));
  const confirmed=await chat(a,'/confirm '+review.turn);assert.equal(confirmed.result.status,200,JSON.stringify(confirmed.result));
  const html=await (await site('/')).text();for(const p of [p1,p2])assert.ok(html.includes(`assets/${p}.jpg`));assert.ok(!html.includes(p3));
  const served=await site(`/assets/${p1}.jpg`);assert.equal(served.status,200);assert.equal(await hex(new Uint8Array(await served.arrayBuffer())),await digest(p1));
  assert.equal((await site(`/assets/${p3}.jpg`)).status,404,'A held photo is never served');
  // WH-013: a later block stops public delivery of the published gallery photo at once.
  await run("UPDATE project_photo_safety SET state='blocked',csam_check='unknown',sexual_check='matched',scanner_reference='synthetic-block',expires_at=NULL WHERE file_id=?",p2);
  assert.equal((await site(`/assets/${p2}.jpg`)).status,404);
  const prompt=m.agentPrompt({})+m.agentPrompt({},'website');for(const word of ['galleryPageReview','review-collection-gallery','files.putBytes'])assert.ok(!prompt.includes(word),word);
 });

 await check('module uploads stay out of the owner photo library, Chat and model context',async()=>{
  const ids=(await rows("SELECT file_id FROM module_files WHERE project_id=? AND uploader_kind!='owner'",a.project)).map(r=>r.file_id);assert.ok(ids.length>=3);
  const listed=await m.listPhotos(a.scope,a.user,a.project);assert.ok(!listed.files.some(f=>ids.includes(f.id)));
  const context=JSON.stringify(await m.siteContext(a.scope,a.user)),inspected=await m.inspectWorkspace(a.scope,a.user,'photos');
  for(const fileId of ids){assert.ok(!context.includes(fileId));assert.ok(!inspected.includes(fileId));}
  assert.ok(!JSON.stringify(await m.readChat(a.scope,a.user)).includes(ids[0]));
 });

 await check('removal uses the exact photo review, respects safety holds; visitor erasure removes their uploads',async()=>{
  const fresh=await instance(a,'media');
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at) VALUES('case-wh128',?,'intake-1','human:reviewer',unixepoch())",a.user);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-wh128','case-wh128',?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",a.user,a.project);
  const review=await chat(a,'/delete-photo '+first);assert.equal(review.result.status,200);
  // The confirmation is refused inside the commit (safety_preservation_hold), so nothing is removed.
  await chat(a,'/confirm-photo-delete '+review.turn).then(r=>assert.notEqual(r.result.status,200),e=>assert.match(String(e),/safety_preservation_hold/));
  assert.equal((await row('SELECT count(*) n FROM module_files WHERE file_id=?',first)).n,1,'Held module uploads are retained');
  await assert.rejects(()=>run('DELETE FROM project_files WHERE id=?',first),/safety_preservation_hold/);
  await run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id='hold-wh128'");
  const again=await chat(a,'/delete-photo '+first),done=await chat(a,'/confirm-photo-delete '+again.turn);assert.equal(done.result.status,200,JSON.stringify(done.result));
  assert.equal((await row('SELECT count(*) n FROM module_files WHERE file_id=?',first)).n,0);assert.ok(await row('SELECT 1 FROM file_cleanup WHERE object_key=?',`photos/${a.project}/${first}.jpg`));
  assert.equal((await gateway(a,readOf(fresh,'intake',first),staff)).body.code,'not_found');
  // The uploading visitor's reviewed erasure removes their uploads and queues the objects.
  const theirs=(await rows('SELECT file_id FROM module_files WHERE visitor_id=?',other.visitorId)).map(r=>r.file_id);assert.ok(theirs.length);
  const erase=await appLifecycle.prepareAppDeletion(db,other.session,a.project);await appLifecycle.deleteAppAccount(db,other.session,a.project,erase.id,erase.revision,'DELETE');
  for(const fileId of theirs){assert.equal(await row('SELECT 1 FROM project_files WHERE id=?',fileId),null);assert.ok(await row('SELECT 1 FROM file_cleanup WHERE object_key=?',`photos/${a.project}/${fileId}.jpg`));}
 });

 await check('caps, direct writes refused, closure counts and cascades',async()=>{
  const fresh=await instance(b,'media'),v=await visitor(b);let limited=0,accepted=0;
  for(let n=0;n<11;n++){const r=await upload(b,await put(fresh,'mine'),v);if(r.status===429){assert.equal(r.body.code,'limited');limited++;}else{assert.equal(r.status,200,JSON.stringify(r.body));accepted++;}}
  assert.equal(accepted,10);assert.equal(limited,1);
  const f=await row('SELECT f.* FROM project_files f JOIN module_files mf ON mf.file_id=f.id WHERE f.project_id=? LIMIT 1',b.project);
  await assert.rejects(()=>run('UPDATE module_files SET collection_id=? WHERE file_id=?','intake',f.id),/module_request_immutable/);
  await assert.rejects(()=>run("INSERT INTO module_files VALUES(?,?,?,'intake','staff',?,?,unixepoch())",f.id,media.id,b.project,bv.visitorId,id()),/module_request|UNIQUE|PRIMARY|FOREIGN KEY/);
  const inventory=await accountClosureInventory(db,b.user);assert.equal(inventory.counts.moduleFiles,(await row('SELECT count(*) n FROM module_files WHERE project_id=?',b.project)).n);assert.ok(inventory.counts.moduleFiles>=10);
  for(const t of ['module_request_receipts','module_files','chat_turns','activity_events'])assert.ok(!JSON.stringify(await rows('SELECT * FROM '+t)).includes('photos/'+b.project+'/x'),t);
  // An owner photo filed into b's owner collection survives instance removal; only its collection row goes.
  const ownerFiled=(await row("SELECT f.id,f.digest FROM project_files f WHERE f.project_id=? AND NOT EXISTS(SELECT 1 FROM module_files mf WHERE mf.file_id=f.id)",b.project));
  assert.equal((await ownerCall(b,envelope(fresh,'files.putBytes',{target:{collectionId:'library'},input:{fileId:ownerFiled.id,sha256:ownerFiled.digest}}))).status,200);
  const uploaded=(await rows("SELECT file_id FROM module_files WHERE project_id=? AND uploader_kind!='owner'",b.project)).map(r=>r.file_id);
  await run('DELETE FROM module_instances WHERE project_id=?',b.project);
  assert.ok(await row('SELECT 1 FROM project_files WHERE id=?',ownerFiled.id),'Instance removal never removes owner photos');
  assert.equal((await row('SELECT count(*) n FROM module_files WHERE project_id=?',b.project)).n,0);
  for(const fileId of uploaded)assert.equal(await row('SELECT 1 FROM project_files WHERE id=?',fileId),null,'Instance removal never leaves module uploads behind as owner photos');
  assert.ok((await row("SELECT count(*) n FROM file_cleanup WHERE project_id=?",b.project)).n>=10,'Instance removal queues module objects');
 });

 await check('files paths never reach owner-maintenance inference',async()=>{
  const inference=/^src\/(ai|ai-chat|ai-gateway|acknowledgment|site-agent|agent-[a-z-]+|standard-ai[a-z-]*|chat|backend-chat|app-upgrade-chat|app-recovery-chat|app-page-design)\.ts$|^src\/chat-interactions\/(agent|agent-request|model-continuation|continuation)\.ts$/;
  for(const entry of ['src/shared-modules/files.ts','src/shared-modules/files-export.ts','src/shared-modules/files-gallery.ts','src/shared-modules/api.ts','src/app-gateway.ts']){
   const out=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false,metafile:true,logLevel:'silent'});
   assert.deepEqual(Object.keys(out.metafile.inputs).filter(p=>inference.test(p)),[],entry+' reaches owner-maintenance inference');
  }
  const prompt=m.agentPrompt({})+m.agentPrompt({},'website');for(const word of ['files.putBytes','files.gallery','modules.put'])assert.ok(!prompt.includes(word),word);
  assert.equal(network,0);
 });

 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 process.stdout.write(`Shared module files passed: ${cases} groups on ${d1?'local D1 and local R2':'SQLite with an in-memory private bucket'} — over-wide gallery rejection, staff-only upload by collection role policy through the visitor upload route (plain visitor, anonymous, foreign, workspace-cookie, owner and revoked staff refused; caller locations and names refused; declared digest/length/type checked; replay and conflict), pending safety receipt on every upload, held/blocked/tampered files never served, approved bytes re-hashed, own-scope visitor galleries, existing owner photos filed into an owner collection by id and exact digest (no duplicate row or object; module uploads, foreign photos, wrong digests and non-owner collections refused; filed photos stay in the owner library and survive instance removal), a published gallery through the typed galleryPageReview control, the exact specification review (tampered proposals refused inside the commit), specificationApply and the exact publication review with approved exact-digest photos only and a later block stopping delivery, module uploads refused as website photos, the owner files export serializer (approved re-hashed bytes only, withheld count, visitor-scoped slice, tamper-checked import validation), exclusion from the owner photo library and model context, exact photo removal review under and after a safety hold, visitor erasure, caps, direct-write refusals, closure counts, instance-removal cascade and a static no-inference check. Synthetic clearances only; no scanner, network, model or provider.\n`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}
