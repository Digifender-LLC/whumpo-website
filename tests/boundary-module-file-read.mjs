// WH-004 slice 10 regression: shared-module `files.read` naming a file id outside the caller's collection, by a visitor
// who IS authorized to read that collection, through the mounted visitor gateway (applicationGateway POST /modules, as the
// whumpo-apps Worker calls it) and the real files handler (src/shared-modules/files.ts `read`).
// Cell chosen: docs/boundary-audit.md "Still open (slice 2)": "`files.read` naming a foreign file id by authorized staff"
// (shared-modules family, tenant/target evidence). Slices 3-9 covered owner authority, provider reviews, review lifecycle,
// billing-portal customer, route Origin, custom-domain owner, operator freshness, contact admission, visitor deletion hold
// and (slice 9, PR #317) domain-proof removal SQL; this cell is still open, is cross-tenant, and concerns raw private bytes.
// tests/shared-modules-files.mjs only checks a foreign visitor WITHOUT the role, which the policy table refuses before the
// handler runs; nothing showed that once the policy admits staff, the handler's SQL still pins the file id to the
// envelope's instance, project and collection. Here, with every named file approved (so safety cannot explain a refusal):
//   1. Staff of project A, admitted to A's staff collection, naming project B's approved file id (through A's resource, or
//      B's resource id on A's host) get no bytes; B's staff naming A's file the same way get none.
//   2. The same staff naming a file of their own project in another collection (an owner-read collection they uploaded
//      to themselves, a visitor's own-upload collection, the owner's filed library photo, an unfiled owner photo) get none.
//   3. Every refusal is byte-for-byte the answer for a random file id (no existence oracle) and takes no storage read.
// Controls: each staff member reads their own collection's approved file with 200, bytes equal to the stored digest, and
// one platform read charged. SQLite with an in-memory bucket by default, local D1 and local R2 with --d1. Needs python3
// with Pillow (synthetic JPEGs), like tests/shared-modules-files.mjs. Synthetic identities and clearances; no network.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
const d1=process.argv.includes('--d1');
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(d1?{d1:true,r2:true}:{}),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network is available');};
function memoryBucket(){
 const objects=new Map(),object=(key,o)=>({key,size:o.bytes.length,customMetadata:o.meta,body:{cancel:async()=>{}},arrayBuffer:async()=>o.bytes.slice().buffer});
 return {
  async put(key,bytes,options={}){if(options.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;objects.set(key,{bytes:new Uint8Array(bytes),meta:options.customMetadata??{}});return object(key,objects.get(key));},
  async get(key){const o=objects.get(key);return o?object(key,o):null;},async head(key){const o=objects.get(key);return o?object(key,o):null;},
  async delete(keys){for(const key of [keys].flat())objects.delete(key);},
  async list({prefix=''}={}){return {objects:[...objects].filter(([k])=>k.startsWith(prefix)).map(([k,o])=>object(k,o)),truncated:false};},
 };
}
const FILES=d1?fixture.env.FILES:memoryBucket();
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-boundary-file-read-');
execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(80,120,60)).save(sys.argv[1]+'/a.jpg'); Image.new('RGB',(40,30),(20,40,200)).save(sys.argv[1]+'/b.jpg')",dir]);
const jpegA=new Uint8Array(await readFile(dir+'/a.jpg')),jpegB=new Uint8Array(await readFile(dir+'/b.jpg'));await rm(dir,{recursive:true,force:true});
const row=(q,...p)=>db.prepare(q).bind(...p).first(),run=(q,...p)=>db.prepare(q).bind(...p).run();
const {appAuth:auth,appGateway}=m;
const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:{fetch:async()=>Response.json({ok:true,value:{state:{},result:{}}})},FILES};
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const collection=(cid,read,upload,gallery)=>({id:cid,read,upload,maxBytes:1048576,mediaTypes:['image/jpeg'],gallery});
const accessInstance={id:'members',kind:'access',...pins('access'),dependencies:[],config:{roles:['staff'],enrollment:'invitation'}};
const filesInstance={id:'media',kind:'files',...pins('files'),dependencies:['members'],config:{collections:[
 collection('intake','staff',['staff'],{audience:'staff'}),collection('mine','submitter',['visitor'],{audience:'visitor'}),collection('private','owner',['staff'],null),collection('library','owner',['owner'],null)]}};
const hex=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const approve=fileId=>run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-clearance',expires_at=? WHERE file_id=?",new Date(Date.now()+3600000).toISOString(),fileId);
const reads=async()=>(await row('SELECT coalesce(sum(read_ops),0) n FROM storage_usage')).n;

async function owner(){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,'Studio '+id().slice(0,6),'Photo studio');
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-004 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,feature,operation);
 return {...actor,scope,user,...site,host:'https://app-'+site.project+'.whumpo.site'};
}
async function visitor(o){
 const invite=await auth.createAppInvitation(o.scope,o.user,o.project),options=await auth.appPasskeyOptions(db,o.project,'signup',false,invite.code),key=authenticator();
 const result=await auth.appPasskeyVerify(db,o.project,'signup',options.challengeToken,key.registration(options.options),false);
 return {...result,cookie:`__Host-whumpo-app-session-${o.project}=${result.session}`};
}
const revision=async o=>(await m.readChat(o.scope,o.user)).state.revision;
async function control(o,action){const turn=id();return {id:turn,...await m.sendChatControl(o.scope,o.user,{id:turn,revision:await revision(o),action})};}
async function activation(o,instanceId){
 const r=await control(o,{type:'moduleActivationReview',projectId:o.project,instanceId,action:'activate'});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',r.id);
 const a=await control(o,{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision});assert.equal(a.status,200,a.error);
}
async function grantStaff(o,visitorId){
 const r=await control(o,{type:'accessRoleReview',projectId:o.project,instanceId:'members',visitorId,action:'grant'});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_access_role_reviews WHERE id=?',r.id);
 const a=await control(o,{type:'accessRoleApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_access_revision});assert.equal(a.status,200,a.error);
}
const instance=(o,localId)=>row('SELECT i.* FROM module_instances i WHERE i.project_id=? AND i.local_id=?',o.project,localId);
const envelope=(resource,operation,{target=null,input=null}={})=>({api:'whumpo-modules',version:1,operation,resourceId:resource.id,configRevision:resource.config_revision,requestId:m.modulePolicy.moduleOperations[operation].write?id():null,target,input});
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
async function upload(o,resource,collectionId,v,bytes){
 const payload=envelope(resource,'files.putBytes',{target:{collectionId},input:{mediaType:'image/jpeg',byteLength:bytes.length,sha256:await hex(bytes)}});
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules/upload',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.60','content-type':'image/jpeg',origin:o.host,cookie:v.cookie,'whumpo-module-request':b64(payload)},body:bytes}),env);
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.result.fileId;
}
/** files.read through the visitor gateway, as the visitor page sends it. */
async function fileRead(o,v,resource,collectionId,fileId){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.61','content-type':'application/json',origin:o.host,cookie:v.cookie},body:JSON.stringify(envelope(resource,'files.read',{target:{collectionId,fileId}}))}),env);
 const image=response.headers.get('content-type')==='image/jpeg';
 return {status:response.status,image,text:image?null:await response.text(),bytes:image?new Uint8Array(await response.arrayBuffer()):null};
}
async function ownerPhoto(o,bytes,name){
 const fileId=id(),r=await m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':name},body:bytes}),{...env,DB:o.scope},o.user,o.project,fileId);
 assert.equal(r.status,'ready');return fileId;
}

try{
 const a=await owner(),b=await owner();
 for(const o of [a,b]){await configureFixtureModules(o.scope,o.user,o.project,[accessInstance,filesInstance]);await activation(o,'members');await activation(o,'media');}
 const staffA=await visitor(a),plainA=await visitor(a),staffB=await visitor(b);
 await grantStaff(a,staffA.visitorId);await grantStaff(b,staffB.visitorId);
 const mediaA=await instance(a,'media'),mediaB=await instance(b,'media');
 // Files of every kind, all approved, so a refusal can only come from the file id's binding.
 const intakeA=await upload(a,mediaA,'intake',staffA,jpegA),intakeB=await upload(b,mediaB,'intake',staffB,jpegB);
 const privateA=await upload(a,mediaA,'private',staffA,jpegB),mineA=await upload(a,mediaA,'mine',plainA,jpegB);
 const libraryA=await ownerPhoto(a,jpegB,'Library'),unfiledA=await ownerPhoto(a,jpegB,'Unfiled');
 const filed=await m.worker.fetch(new Request(`https://whumpo.com/api/projects/${a.project}/modules`,{method:'POST',headers:{cookie:`__Host-whumpo_session=${a.token}`,origin:'https://whumpo.com','content-type':'application/json'},
  body:JSON.stringify(envelope(mediaA,'files.putBytes',{target:{collectionId:'library'},input:{fileId:libraryA,sha256:(await row('SELECT digest FROM project_files WHERE id=?',libraryA)).digest}}))}),{...(fixture.env??{}),...env},{waitUntil(){}});
 assert.equal(filed.status,200,'the owner files a library photo');
 for(const f of [intakeA,intakeB,privateA,mineA,libraryA,unfiledA])await approve(f);
 for(const f of [intakeA,intakeB,privateA,mineA,libraryA,unfiledA])assert.ok(await row("SELECT 1 FROM approved_project_photos s JOIN project_files f ON f.id=s.id AND f.digest=s.digest WHERE f.id=?",f),'fixture: every named file is approved');

 // Controls: each staff member reads their own collection's approved file; one platform read is charged.
 for(const [o,v,resource,fileId] of [[a,staffA,mediaA,intakeA],[b,staffB,mediaB,intakeB]]){
  const before=await reads(),ok=await fileRead(o,v,resource,'intake',fileId);
  assert.equal(ok.status,200,'control: authorized staff read their own collection');assert.ok(ok.image);
  assert.equal(await hex(ok.bytes),(await row('SELECT digest FROM project_files WHERE id=?',fileId)).digest);
  assert.equal(await reads(),before+1,'control: one read is charged');
 }

 // Baseline refusal for an id that names no file at all.
 const unknownA=await fileRead(a,staffA,mediaA,'intake',id()),unknownB=await fileRead(b,staffB,mediaB,'intake',id());
 assert.equal(unknownA.image,false);assert.equal(JSON.parse(unknownA.text).code,'not_found');assert.equal(unknownA.text,unknownB.text);
 const refused=async(label,o,v,resource,fileId,expected=unknownA)=>{
  const before=await reads(),r=await fileRead(o,v,resource,'intake',fileId);
  assert.equal(r.image,false,label+': no bytes');assert.equal(r.status,expected.status,label+': status');
  assert.equal(r.text,expected.text,label+': same answer as a random file id');
  assert.equal(await reads(),before,label+': no storage read is taken');
 };
 // 1. Cross-tenant: an approved file of the other project, through the caller's own resource.
 await refused('A staff naming B\'s intake file',a,staffA,mediaA,intakeB);
 await refused('B staff naming A\'s intake file',b,staffB,mediaB,intakeA);
 // ... and through the other project's resource id on the caller's host: never served.
 const viaForeign=await fileRead(a,staffA,mediaB,'intake',intakeB);
 assert.equal(viaForeign.image,false,'B\'s resource id on A\'s host serves no bytes');assert.notEqual(viaForeign.status,200);
 // 2. Same project, other collections: the collection in the envelope bounds the file id.
 await refused('A staff naming their own upload in an owner-read collection',a,staffA,mediaA,privateA);
 await refused('A staff naming a visitor\'s own-upload file',a,staffA,mediaA,mineA);
 await refused('A staff naming the owner\'s filed library photo',a,staffA,mediaA,libraryA);
 await refused('A staff naming an unfiled owner photo',a,staffA,mediaA,unfiledA);

 // The controls still pass after the refusals.
 assert.equal((await fileRead(a,staffA,mediaA,'intake',intakeA)).status,200,'control after the refusals');
 assert.equal(network,0);
 process.stdout.write(`Module file read boundary passed on ${d1?'local D1 and local R2':'SQLite with an in-memory bucket'}: authorized staff naming an approved file of another project (own resource or foreign resource id), or of their own project in another collection (owner-read, visitor-own, owner library, unfiled owner photo), get the random-id not_found with no bytes and no storage read; each staff member's own collection file is served with exact bytes and one read.\n`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}
