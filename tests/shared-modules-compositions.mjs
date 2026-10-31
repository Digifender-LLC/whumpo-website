import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {staffPortal} from './fixtures/module-compositions/staff-portal.mjs';
import {visitorIntake} from './fixtures/module-compositions/visitor-intake.mjs';
import {fields,moduleInstances} from './fixtures/module-compositions/instances.mjs';
Error.stackTraceLimit=0;
// WH-130 connected acceptance. Two synthetic frontend compositions (a staff portal and a visitor intake/gallery page,
// tests/fixtures/module-compositions/) drive the same access, records, files and content instances through the actual
// visitor gateway (POST /modules and /modules/upload), the actual module engine, handlers and commit triggers, the
// workspace-origin owner routes, the Chat activation/role/directory/publication reviews and the photo safety view, over
// the complete current schema: disposable SQLite with an in-memory private bucket, or local D1 and local R2 with --d1.
// Two owners/projects. The harness plays the browser: it resolves the compositions' relative URLs against the visitor
// origin and attaches that origin's cookie, which is what a same-origin page gets; no Worker serves these compositions
// yet (WH-070). Maintenance inference is unavailable: no AI binding exists, global fetch throws, and the only injected
// network is a Siteverify stub. Identities, values, images and clearances are synthetic.
const d1=process.argv.includes('--d1');
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(d1?{d1:true,r2:true}:{}),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network or inference is available');};
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
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-module-compositions-');
execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(80,120,60)).save(sys.argv[1]+'/a.jpg'); Image.new('RGB',(40,30),(20,40,200)).save(sys.argv[1]+'/b.jpg')",dir]);
const jpegA=new Uint8Array(await readFile(dir+'/a.jpg')),jpegB=new Uint8Array(await readFile(dir+'/b.jpg'));await rm(dir,{recursive:true,force:true});
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const {appAuth:auth,appActivation,appGateway}=m,{saveBackend,testBackend}=m.backend;
const runtime={fetch:async()=>Response.json({ok:true,value:{state:{},result:{}}})};
const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:runtime,FILES,TURNSTILE_SECRET:'fixture-secret'};
assert.ok(!Object.keys(env).some(k=>/^(AI|AI_GATEWAY|OPENAI|ANTHROPIC|WORKERS_AI)/.test(k)),'No maintenance inference binding exists');
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const markers=[],value=n=>{const v=`VISITOR-VALUE-${n}-${id().slice(0,8)}`;markers.push(v);return v;};
const hex=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');

// One shared composition of four instances per project, defined once in the fixture the live check also uses.
const {accessInstance,recordsInstance,filesInstance,contentInstance}=moduleInstances(pins);

const revision=async o=>(await m.readChat(o.scope,o.user)).state.revision;
async function control(o,action){const turn=id();return {id:turn,...await m.sendChatControl(o.scope,o.user,{id:turn,revision:await revision(o),action})};}
async function chat(o,content){const turn=id(),r=await m.sendChat(o.scope,o.user,{id:turn,revision:await revision(o),content});assert.equal(r.status,200,JSON.stringify(r));return turn;}
async function confirm(o,reviewId,kind){const r=await control(o,{type:'confirm',kind,reviewId});assert.equal(r.status,200,JSON.stringify(r));}
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
async function owner(name,listing){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,name+' '+id().slice(0,6),'Neighborhood repairs');
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-130 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,feature,operation);
 // WH-126: visitor identity belongs to the access instance; no visitor application is needed.
 const o={...actor,scope,user,...site,host:'https://app-'+site.project+'.whumpo.site'};
 const saved=await configureFixtureModules(scope,user,site.project,[accessInstance,recordsInstance(),filesInstance,contentInstance]);
 await confirm(o,await chat(o,'/publish '+saved.version),'site');
 await confirm(o,await chat(o,`/directory-add ${site.project} | ${listing} | Saturday mornings | https://example.com/`),'directory');
 await confirm(o,await chat(o,'/directory-publish '+site.project),'directory');
 for(const instance of ['members','requests','media','listings'])await activation(o,instance);
 return o;
}
async function visitor(o){
 const invite=await auth.createAppInvitation(o.scope,o.user,o.project),options=await auth.appPasskeyOptions(db,o.project,'signup',false,invite.code),key=authenticator();
 const result=await auth.appPasskeyVerify(db,o.project,'signup',options.challengeToken,key.registration(options.options),false);
 return {...result,cookie:`__Host-whumpo-app-session-${o.project}=${result.session}`};
}
/** What a page composed for this project is given: public resource ids and configuration revisions only. */
async function manifest(o){
 const list=await rows('SELECT id,local_id,config_revision FROM module_instances WHERE project_id=?',o.project);
 return {instances:Object.fromEntries(list.map(r=>[r.local_id,{resourceId:r.id,configRevision:r.config_revision}]))};
}
// The browser: relative URLs resolve against the page's visitor origin, POSTs carry that Origin, and only that origin's
// cookie is attached. Anything the compositions send is recorded for the envelope-shape check.
const sent=[];let siteverifyCalls=0;
const siteverify=o=>async(url,options)=>{siteverifyCalls++;assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');
 const body=new URLSearchParams(options.body),envelope=sent.at(-1).body;assert.equal(body.get('response'),'widget-token');
 return Response.json({success:true,hostname:new URL(o.host).hostname,action:'module-form',cdata:envelope.resourceId});};
function browser(o,v,{page=o}={}){
 return async(input,init={})=>{
  const url=new URL(input,page.host);assert.equal(url.origin,page.host,'Compositions only call their own origin');assert.equal(init.credentials,'same-origin');
  const headers=new Headers(init.headers);headers.set('origin',page.host);headers.set('cf-connecting-ip','192.0.2.'+(10+sent.length%200));
  if(v?.cookie)headers.set('cookie',v.cookie);
  const envelope=url.pathname==='/modules'?JSON.parse(init.body):JSON.parse(Buffer.from(headers.get('whumpo-module-request'),'base64url').toString());
  sent.push({path:url.pathname,body:envelope,headers:[...headers.keys()]});
  const response=await appGateway.applicationGateway(new Request(url,{...init,headers}),env,siteverify(page));
  assert.equal(response.headers.get('access-control-allow-origin'),null);return response;
 };
}
const portal=async(o,v,page=o)=>staffPortal({fetch:browser(o,v,{page}),manifest:await manifest(o)});
const intake=async(o,v,page=o)=>visitorIntake({fetch:browser(o,v,{page}),manifest:await manifest(o)});
/** Raw visitor-origin request: what a direct or hostile client can send, with no composition in between. */
async function raw(o,body,{cookie='',origin=o.host,path='/modules',headers={}}={}){
 const response=await appGateway.applicationGateway(new Request(o.host+path,{method:'POST',headers:{'cf-connecting-ip':'192.0.2.250','content-type':'application/json',origin,cookie,...headers},body:typeof body==='string'?body:JSON.stringify(body)}),env);
 assert.equal(response.headers.get('access-control-allow-origin'),null);
 return {status:response.status,body:await response.json()};
}
async function workspace(o,path,{method='GET',payload,cookie=`__Host-whumpo_session=${o.token}`}={}){
 const response=await m.worker.fetch(new Request('https://whumpo.com'+path,{method,headers:{cookie,origin:'https://whumpo.com',...(payload?{'content-type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined}),{...(fixture.env??{}),...env},{waitUntil(){}});
 return {status:response.status,body:await response.json()};
}
const envelope=(instance,operation,target=null,input=null)=>({api:'whumpo-modules',version:1,operation,resourceId:instance.resourceId,configRevision:instance.configRevision,requestId:m.modulePolicy.moduleOperations[operation].write?id():null,target,input});
const ownerCall=(o,payload)=>workspace(o,`/api/projects/${o.project}/modules`,{method:'POST',payload});
const approve=fileId=>run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-clearance',expires_at=? WHERE file_id=?",new Date(Date.now()+3600000).toISOString(),fileId);
const publicJSON=async o=>{const r=await m.host.fetch(new Request('https://'+o.project+'.whumpo.site/directory.json'),{...(fixture.env??{}),...env});assert.equal(r.status,200);return r.json();};
const request=()=>({name:value('name'),topic:'repair',note:value('note'),urgent:true,count:2});

try{
 const a=await owner('Repair desk','Garden club'),b=await owner('Other tenant','Chess club');
 const staff=await visitor(a),v1=await visitor(a),v2=await visitor(a),bStaff=await visitor(b);
 await setRole(a,staff.visitorId,'grant');await setRole(b,bStaff.visitorId,'grant');
 const sources={staff:await readFile('tests/fixtures/module-compositions/staff-portal.mjs','utf8'),visitor:await readFile('tests/fixtures/module-compositions/visitor-intake.mjs','utf8')};
 let entry,staffFile,visitorFile,publicEntry;

 await check('neither composition contains authentication, authorization, storage or handler code',async()=>{
  for(const [name,source] of Object.entries(sources)){
   const code=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/^\s*\/\/.*$/gm,'');
   const forbidden={imports:/\bimport\b|\brequire\s*\(/,cookies:/cookie/i,browserStorage:/localStorage|sessionStorage|indexedDB|document\./,credentials:/authorization|bearer|passkey|webauthn|navigator\.credentials|session|password|secret/i,
    principals:/projectId|visitorId|ownerId|userId|\broles?\b|approved|isStaff|admin/,sql:/\b(SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\b/,storage:/bucket|objectKey|photos\/|\bR2\b|\bD1\b|\bsql\b|prepare\(/i,
    origins:/https?:\/\/|whumpo\.(site|com)/,crossOrigin:/credentials:\s*'include'|mode:\s*'cors'/,handlers:/new Response|export default|addEventListener\(\s*'fetch'/,inference:/\bai\b|model|prompt|chat/i};
   for(const [what,pattern] of Object.entries(forbidden))assert.ok(!pattern.test(code),`${name} composition contains ${what} code: ${code.match(pattern)?.[0]}`);
   // The only endpoints are the shared module routes on the page's own origin.
   assert.deepEqual([...new Set(code.match(/'\/[^']*'/g))].sort(),["'/modules'","'/modules/upload'"]);
  }
  // Both compositions are written against the one closed operation set, and share the operations they both need.
  const used=s=>new Set([...s.matchAll(/'((?:access|records|forms|files|collections)\.[A-Za-z]+)'/g)].map(x=>x[1]));
  const staffOps=used(sources.staff),visitorOps=used(sources.visitor);
  for(const op of [...staffOps,...visitorOps])assert.ok(Object.hasOwn(m.modulePolicy.moduleOperations,op),op);
  assert.deepEqual([...staffOps].filter(op=>visitorOps.has(op)).sort(),['access.me','collections.readPublic','files.gallery','files.putBytes','files.read','forms.submit','records.get','records.view']);
  assert.notEqual(sources.staff,sources.visitor);
 });

 await check('visitor intake composition: own submissions, own uploads, approved-only gallery and the directory',async()=>{
  const page=await intake(a,v1);
  const me=await page.me();assert.equal(me.ok,true,me.code);assert.deepEqual(me.result.roles,[]);
  const values=request();values.name='<img src=x onerror=alert(1)> '+values.name;
  const accepted=await page.submit(values);assert.equal(accepted.ok,true,accepted.code);entry=accepted.result.entryId;
  assert.ok(!markers.some(x=>JSON.stringify(accepted).includes(x)),'Receipts never echo values');
  const mine=await page.myRequests();assert.deepEqual(mine.result.items.map(i=>i.entryId),[entry]);
  assert.deepEqual(Object.keys(mine.result.items[0].values).sort(),['topic','urgent'],'A visitor sees only submitter fields of their own record');
  assert.deepEqual(Object.keys((await page.myRequest(entry)).result.values).sort(),['topic','urgent']);
  const photo=await page.addPhoto(jpegA);assert.equal(photo.ok,true,photo.code);assert.equal(photo.result.safety,'pending');visitorFile=photo.result.fileId;
  assert.deepEqual((await page.myGallery()).result.items,[],'Stored is not cleared: pending uploads are not listed');
  assert.equal((await page.myPhoto(visitorFile)).code,'unavailable');
  await approve(visitorFile);
  const gallery=await page.myGallery();assert.deepEqual(gallery.result.items.map(i=>i.fileId),[visitorFile]);
  assert.ok(gallery.result.items.every(i=>Object.keys(i).every(k=>['fileId','width','height','size','createdAt','uploadedBy'].includes(k))),'No URL, key or safety detail reaches a visitor');
  const bytes=await page.myPhoto(visitorFile);assert.equal(bytes.ok,true);assert.equal(await hex(bytes.bytes),(await row('SELECT digest FROM project_files WHERE id=?',visitorFile)).digest);
  const directory=await page.directory();assert.deepEqual(directory.result.listings,(await publicJSON(a)).listings);assert.equal(directory.result.listings[0].title,'Garden club');
 });

 await check('staff portal composition over the same instances: desk, staff fields, intake uploads and escaped rendering',async()=>{
  const page=await portal(a,staff);
  assert.deepEqual((await page.me()).result.roles,['staff']);
  const desk=await page.desk(),item=desk.result.items.find(i=>i.entryId===entry);assert.ok(item,'The visitor composition\'s submission is on the staff desk');
  assert.deepEqual(Object.keys(item.values).sort(),['count','note','topic'],'Staff see staff fields, never owner-only fields');
  const html=page.renderDesk(desk.result.items);assert.ok(!html.includes('<img'),'Visitor values render as text');
  const staffNote=value('staff-note'),done=await page.note(entry,1,staffNote);assert.equal(done.ok,true,done.code);assert.deepEqual(done.result,{entryId:entry,revision:2});
  assert.equal((await page.change(entry,2,{name:'changed'})).code,'forbidden','Only staffWrite fields');
  assert.equal((await page.note(entry,1,'late')).code,'stale_configuration','Compare-and-swap on the record revision');
  assert.equal((await page.entry(entry)).result.values.note,staffNote);
  const logged=await page.logCall({name:value('caller'),topic:'visit',urgent:false,count:1});assert.equal(logged.ok,true,logged.code);
  const upload=await page.uploadIntake(jpegB);assert.equal(upload.ok,true,upload.code);staffFile=upload.result.fileId;
  assert.deepEqual((await page.intakeGallery()).result.items,[]);await approve(staffFile);
  assert.deepEqual((await page.intakeGallery()).result.items.map(i=>i.fileId),[staffFile]);
  assert.equal(await hex((await page.intakeImage(staffFile)).bytes),(await row('SELECT digest FROM project_files WHERE id=?',staffFile)).digest,'Approved bytes re-hashed against the cleaned digest');
  assert.deepEqual((await page.directory()).result,(await (await intake(a,v1)).directory()).result,'Both compositions read one approved snapshot');
  // The staff note stays out of the submitter's own view; the owner sees every field and both uploads on the workspace origin.
  assert.deepEqual(Object.keys((await (await intake(a,v1)).myRequest(entry)).result.values).sort(),['topic','urgent']);
  const ownerRead=await ownerCall(a,envelope((await manifest(a)).instances.requests,'records.get',{recordId:'request',entryId:entry}));
  assert.deepEqual(Object.keys(ownerRead.body.result.values).sort(),['count','name','note','topic','urgent']);assert.equal(ownerRead.body.result.values.note,staffNote);
  const ownerGallery=await ownerCall(a,envelope((await manifest(a)).instances.media,'files.gallery',{collectionId:'intake'}));
  assert.deepEqual(ownerGallery.body.result.items.map(i=>[i.fileId,i.safety,i.uploadedBy]),[[staffFile,'approved','staff']]);
 });

 await check('anonymous intake through the visitor composition reuses the contact admission; replay is not re-verified',async()=>{
  const page=await intake(a,null);
  assert.equal((await page.me()).code,'forbidden');assert.equal((await page.submit(request())).code,'forbidden','Visitor forms refuse anonymous callers');
  assert.equal((await page.myRequests()).code,'forbidden');assert.equal(siteverifyCalls,0);
  const requestId=id(),values={name:value('public'),topic:'visit',urgent:false,count:1};
  const accepted=await page.submitAnonymously(values,'widget-token',{requestId});assert.equal(accepted.ok,true,accepted.code);publicEntry=accepted.result.entryId;assert.equal(siteverifyCalls,1);
  const replay=await page.submitAnonymously(values,'widget-token',{requestId});assert.equal(replay.receipt.replayed,true);assert.equal(replay.result.entryId,publicEntry);assert.equal(siteverifyCalls,1);
  assert.equal((await page.submitAnonymously({...values,count:2},'widget-token',{requestId})).code,'request_conflict');
  assert.equal((await page.submitAnonymously(values,'')).code,'forbidden','The Turnstile token is required');
  const desk=await (await portal(a,staff)).desk();assert.equal(desk.result.items.find(i=>i.entryId===publicEntry).submittedBy,'public');
  assert.equal((await (await intake(a,v1)).myRequest(publicEntry)).code,'not_found','No visitor owns an anonymous record');
 });

 await check('cross-user and role refusals through both compositions',async()=>{
  const other=await intake(a,v2),asStaffPortal=await portal(a,v2),anonymousPortal=await portal(a,null);
  assert.deepEqual((await other.myRequests()).result.items,[],'Own scope only');
  assert.equal((await other.myRequest(entry)).code,'not_found');assert.equal((await other.myPhoto(visitorFile)).code,'not_found');
  assert.deepEqual((await other.myGallery()).result.items,[]);
  for(const call of [()=>asStaffPortal.desk(),()=>asStaffPortal.note(entry,2,'x'),()=>asStaffPortal.logCall(request()),()=>asStaffPortal.uploadIntake(jpegA),()=>asStaffPortal.intakeGallery(),()=>asStaffPortal.intakeImage(staffFile),()=>asStaffPortal.entry(entry)])
   assert.ok(['forbidden','not_found'].includes((await call()).code),'A plain visitor has no staff authority through any frontend');
  for(const call of [()=>anonymousPortal.desk(),()=>anonymousPortal.uploadIntake(jpegA),()=>anonymousPortal.intakeGallery()])assert.equal((await call()).code,'forbidden');
  // Staff are not visitors for a visitor-only collection, and the owner never uploads through the visitor collections.
  assert.equal((await (await intake(a,staff)).addPhoto(jpegA)).code,'forbidden');
  assert.equal((await ownerCall(a,envelope((await manifest(a)).instances.requests,'records.view',{viewId:'desk',cursor:null}))).body.code,'forbidden','Owners read through the owner routes, not staff views');
 });

 await check('cross-tenant: compositions and cookies from one project learn nothing on another project\'s origin',async()=>{
  const aOnB=await portal(a,bStaff,b),visitorOnB=await intake(a,bStaff,b);
  for(const call of [()=>aOnB.desk(),()=>aOnB.entry(entry),()=>aOnB.intakeGallery(),()=>aOnB.intakeImage(staffFile),()=>aOnB.uploadIntake(jpegA),()=>aOnB.directory(),()=>visitorOnB.submit(request()),()=>visitorOnB.myPhoto(visitorFile)])
   assert.equal((await call()).code,'not_found');
  const bDesk=await (await portal(b,bStaff)).desk();assert.ok(bDesk.ok);assert.ok(!bDesk.result.items.some(i=>[entry,publicEntry].includes(i.entryId)));
  assert.equal((await (await intake(b,bStaff)).directory()).result.listings[0].title,'Chess club');
  // Project A's visitor cookie on project B's origin is not a session there: anonymous, so refused.
  const bManifest=await manifest(b);
  assert.equal((await raw(b,envelope(bManifest.instances.requests,'records.view',{viewId:'desk',cursor:null}),{cookie:staff.cookie.replace(a.project,b.project)})).body.code,'forbidden');
  assert.equal((await raw(b,envelope(bManifest.instances.members,'access.me'),{cookie:staff.cookie})).body.code,'forbidden');
  // The owner of B cannot reach A's instances from the workspace origin.
  assert.equal((await ownerCall(b,envelope((await manifest(a)).instances.requests,'records.get',{recordId:'request',entryId:entry}))).body.code,'not_found');
 });

 await check('direct API requests get the same checks as the compositions',async()=>{
  const {requests,media,members}=(await manifest(a)).instances;
  assert.equal((await raw(a,{...envelope(requests,'records.view',{viewId:'desk',cursor:null}),version:2},{cookie:staff.cookie})).body.code,'client_update_required');
  for(const key of ['projectId','visitorId','role','roles','approved','path','prefix','bucket','sql'])
   assert.equal((await raw(a,envelope(requests,'records.view',{viewId:'desk',cursor:null,[key]:'x'}),{cookie:v2.cookie})).body.code,'invalid_request',key);
  assert.equal((await raw(a,envelope(requests,'records.view',{viewId:'desk',cursor:null}),{cookie:staff.cookie,origin:'https://evil.example'})).status,403,'Foreign Origin refused');
  assert.equal((await raw(a,envelope(requests,'records.view',{viewId:'desk',cursor:null}),{cookie:`__Host-whumpo_session=${a.token}`})).body.code,'forbidden','A workspace cookie never authenticates on the visitor origin');
  assert.ok([401,403].includes((await workspace(a,`/api/projects/${a.project}/modules`,{method:'POST',payload:envelope(requests,'records.get',{recordId:'request',entryId:entry}),cookie:staff.cookie})).status),'A visitor cookie never authenticates on the workspace origin');
  // Operations in the closed set without a delivered handler are refused after authorization, never improvised.
  assert.equal((await raw(a,envelope(media,'files.prepareUpload',{collectionId:'intake'},{mediaType:'image/jpeg',byteLength:jpegA.length,sha256:await hex(jpegA)}),{cookie:staff.cookie})).body.code,'unavailable');
  for(const [resource,operation,target] of [[media,'files.requestRemoval',{collectionId:'intake',fileId:staffFile}],[members,'access.prepareRole',{visitorId:v1.visitorId}],[members,'access.confirmRole',{}]]){
   const r=await raw(a,envelope(resource,operation,target),{cookie:staff.cookie});assert.ok(r.status>=400&&['unavailable','forbidden','not_found','invalid_request'].includes(r.body.code),operation);
   const o=await ownerCall(a,envelope(resource,operation,target));assert.ok(o.status>=400,operation+' never succeeds for the owner either');
  }
  assert.equal((await raw(a,envelope(media,'files.putBytes',{collectionId:'intake'},{mediaType:'image/jpeg',byteLength:jpegA.length,sha256:await hex(jpegA)}),{cookie:staff.cookie})).body.code,'invalid_request','Uploads only through the upload route');
  assert.equal((await raw(a,envelope(requests,'records.update',{recordId:'request',entryId:entry,revision:2,changes:{name:'changed'}}),{cookie:staff.cookie})).body.code,'forbidden');
  assert.equal((await raw(a,envelope(requests,'records.remove',{recordId:'request',entryId:entry}),{cookie:staff.cookie})).body.code,'forbidden','Removal is owner-only');
 });

 await check('replay and revocation: receipts recheck current permission; revocation wins at the next decision',async()=>{
  const page=await portal(a,staff),requestId=id(),current=(await page.entry(entry)).result.revision;
  const replayed=value('replayed'),first=await page.note(entry,current,replayed,{requestId});assert.equal(first.ok,true,first.code);
  const again=await page.note(entry,current,replayed,{requestId});assert.equal(again.receipt.replayed,true);assert.deepEqual(again.result,first.result);
  assert.equal((await page.note(entry,current,'different',{requestId})).code,'request_conflict');
  await setRole(a,staff.visitorId,'revoke');
  assert.equal((await page.note(entry,current,replayed,{requestId})).code,'forbidden','A replay after revocation does not reveal the old receipt');
  for(const call of [()=>page.desk(),()=>page.uploadIntake(jpegA),()=>page.intakeGallery(),()=>page.intakeImage(staffFile)])assert.equal((await call()).code,'forbidden');
  assert.deepEqual((await page.me()).result.roles,[]);
  await setRole(a,staff.visitorId,'grant');
  assert.ok((await page.desk()).ok);
  // Visitor revocation ends both compositions for that visitor; records stay for the owner.
  const before=await intake(a,v2);assert.ok((await before.submit(request())).ok);
  await auth.revokeAppVisitor(a.scope,a.user,a.project,v2.visitorId);
  for(const call of [()=>before.me(),()=>before.myRequests(),()=>before.submit(request()),()=>before.addPhoto(jpegA)])assert.equal((await call()).code,'forbidden');
  assert.ok((await rows('SELECT 1 FROM module_records WHERE visitor_id=?',v2.visitorId)).length>=1);
  // Disabling the records instance stops records operations in both compositions; files keep serving; the owner still reads.
  await activation(a,'requests','disable');
  assert.equal((await (await intake(a,v1)).myRequests()).code,'unavailable');assert.equal((await (await portal(a,staff)).desk()).code,'unavailable');
  assert.ok((await (await intake(a,v1)).myGallery()).ok);
  assert.equal((await ownerCall(a,envelope((await manifest(a)).instances.requests,'records.get',{recordId:'request',entryId:entry}))).status,200);
  await activation(a,'requests');assert.ok((await (await portal(a,staff)).desk()).ok);
 });

 await check('a configuration change makes an old composition manifest stale instead of misreading',async()=>{
  const stale=await intake(a,v1),staleStaff=await portal(a,staff),old=(await manifest(a)).instances.requests;
  await configureFixtureModules(a.scope,a.user,a.project,[accessInstance,recordsInstance([...fields,{key:'phone',label:'Phone',type:'text',optional:true,read:'staff'}],2),filesInstance,contentInstance]);
  await activation(a,'requests');assert.equal((await manifest(a)).instances.requests.configRevision,old.configRevision+1);
  assert.equal((await stale.submit(request())).code,'stale_configuration');assert.equal((await staleStaff.desk()).code,'stale_configuration');
  assert.ok((await stale.myGallery()).ok,'Other instances are unaffected');
  assert.ok((await (await intake(a,v1)).submit(request())).ok,'A reloaded manifest works');
 });

 await check('visitor values never reach Chat, model context, bindings or receipts',async()=>{
  const summary=await workspace(a,`/api/projects/${a.project}/module-records`);assert.equal(summary.status,200);
  const surfaces=[JSON.stringify(summary.body),JSON.stringify(await m.readChat(a.scope,a.user)),JSON.stringify(await m.siteContext(a.scope,a.user)),
   JSON.stringify(await rows('SELECT * FROM chat_turns')),JSON.stringify(await rows('SELECT * FROM module_request_receipts')),JSON.stringify(await rows('SELECT * FROM module_record_events')),logs.join('\n')];
  for(const surface of surfaces)for(const marker of markers)assert.ok(!surface.includes(marker),'A visitor value leaked');
  const prompt=m.agentPrompt({})+m.agentPrompt({},'website');for(const word of ['modules.put','forms.submit','files.putBytes','records.view','collections.readPublic'])assert.ok(!prompt.includes(word),word);
  // The compositions only ever sent the closed envelope; no authority key travelled in any request they made.
  for(const s of sent){assert.deepEqual(Object.keys(s.body).sort(),['api','configRevision','input','operation','requestId','resourceId','target','version']);assert.ok(!s.headers.includes('authorization'));}
 });

 await check('no public bucket, bearer URL, booking engine or maintainer inference in module or composition paths',async()=>{
  for(const config of ['wrangler.jsonc','wrangler.apps.jsonc','wrangler.sites.jsonc','wrangler.runtime.jsonc']){const text=await readFile(config,'utf8');assert.ok(!/r2\.dev|public_access|presign/i.test(text),config);}
  // LC-06 mechanism (D4): any new statement that deletes or rewrites module-held data must be examined for safety holds before this list grows.
  // Each is backed by a BEFORE DELETE/UPDATE trigger the hold tests execute (records, files via project_files, visitor erasure) or removes no content.
  {const {readdir}=await import('node:fs/promises');const found=[];
   for(const f of (await readdir('src',{recursive:true})).filter(f=>f.endsWith('.ts')))for(const [,verb,table] of (await readFile('src/'+f,'utf8')).matchAll(/(DELETE FROM|UPDATE) (module_records|module_files|module_record_files|module_record_leads|module_record_events|project_files|app_visitors|module_instances|module_access_roles)\b/g))found.push(f+':'+verb+' '+table);
   assert.deepEqual(found.sort(),[
    'app-auth.ts:UPDATE app_visitors',                           // revocation flag only
    'app-lifecycle.ts:DELETE FROM app_visitors',                 // safety_hold_visitor_retained + module cascades; tests/boundary-visitor-deletion-hold.mjs, shared-modules-records.mjs
    'files.ts:UPDATE project_files',                             // pending to ready after the object is stored
    'restore-suppression.ts:DELETE FROM app_visitors',          // WH-019 operator replay on an isolated candidate only (no Worker imports it); hold triggers refuse inside held scope
    'restore-suppression.ts:DELETE FROM module_records',        // same replay, same triggers
    'restore-suppression.ts:DELETE FROM project_files',         // same replay, same triggers
    'restore-suppression.ts:UPDATE app_visitors',               // same replay: revocation flag only
    'restore-suppression.ts:UPDATE module_access_roles',        // same replay: a grant older than the ledger's revocation is revoked
    'shared-modules/files-gallery.ts:DELETE FROM module_files',  // removes the collection link only, never the photo
    'shared-modules/records.ts:DELETE FROM module_records',      // owner removal, held by safety_hold_module_record_retained
    'shared-modules/records.ts:DELETE FROM module_records',      // retention expiry, same trigger and held-project/object filter
    'shared-modules/records.ts:UPDATE module_records',           // records.update, frozen by safety_hold_module_record_frozen
   ].sort());}
  // D4: every closed operation is either handled or permanently replaced, never both and never neither.
  const handled=Object.keys(m.sharedModules.moduleHandlers),replaced=Object.keys(m.modulePolicy.replacedOperations);
  assert.deepEqual([...handled,...replaced].sort(),Object.keys(m.modulePolicy.moduleOperations).sort());
  assert.deepEqual(replaced.sort(),['access.confirmRole','access.prepareRole','files.prepareUpload','files.requestRemoval']);
  assert.deepEqual(Object.keys(m.modulePolicy.moduleOperations).sort(),['access.confirmRole','access.list','access.me','access.prepareRole','collections.readPublic','files.gallery','files.prepareUpload','files.putBytes','files.read','files.requestRemoval','forms.submit','leads.update','records.get','records.remove','records.update','records.view']);
  const inference=/^src\/(ai|ai-chat|ai-gateway|acknowledgment|site-agent|agent-[a-z-]+|standard-ai[a-z-]*|chat|backend-chat|app-upgrade-chat|app-recovery-chat|app-page-design)\.ts$|^src\/chat-interactions\/(agent|agent-request|model-continuation|continuation)\.ts$/;
  for(const entry of ['tests/fixtures/module-compositions/staff-portal.mjs','tests/fixtures/module-compositions/visitor-intake.mjs','src/app-gateway.ts','src/shared-modules/api.ts','src/shared-modules/records.ts','src/shared-modules/files.ts','src/shared-modules/access.ts','src/shared-modules/collections.ts']){
   const out=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false,metafile:true,logLevel:'silent'});
   const inputs=Object.keys(out.metafile.inputs);assert.deepEqual(inputs.filter(p=>inference.test(p)),[],entry+' reaches owner-maintenance inference');
   if(entry.startsWith('tests/'))assert.deepEqual(inputs,[entry],'A composition bundles nothing but itself');
  }
  assert.equal(network,0,'Nothing reached the network');
 });

 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 process.stdout.write(`Shared module compositions passed: ${cases} groups on ${d1?'local D1 and local R2':'SQLite with an in-memory private bucket'} — two synthetic frontends (staff portal, visitor intake/gallery) with no auth, authorization, storage or handler code drive the same access/records/files/content instances of two tenants through the actual visitor gateway, module engine, handlers and commit triggers: own-scope submissions and uploads, approved-only galleries with re-hashed bytes, staff desk/staffWrite/compare-and-swap, anonymous intake through the contact admission with replay not re-verified, cross-user, role, cross-tenant and direct-API refusals, replay rechecks after revocation, staff and visitor revocation, disable, stale manifests, no values in Chat/model context/receipts, no public bucket and no maintainer inference (fetch throws). Synthetic only; no Worker serves the compositions yet (WH-070), no browser, deployment or live acceptance.\n`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}
