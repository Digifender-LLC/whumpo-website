import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {request as httpRequest} from 'node:http';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules,changeFixtureWebsite,applyFixtureWebsite,enableFixtureVisitorAccess,fixtureVisitorSQL} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
import {initializeFixtureKeys,fixtureKeyring,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import {inferenceReach} from './helpers/maintainer-inference.mjs';
import * as reference from '../tools/prototypes/portable-export.mjs';
Error.stackTraceLimit=0;
// WH-187 portable project bundle (`whumpo-portable-export` v1, `portable-filter@1`, docs/portable-exports.md) through the
// actual platform Worker routes (/api/account/v1/portable/{prepare,download}) and the actual section reader, against the
// complete current schema in disposable SQLite, or local D1 with --d1. Every bundle is re-read by the frozen WH-186
// reference reader (tools/prototypes/portable-export.mjs), served by its static loader and booted in a
// permission-restricted child process. Synthetic identities, photos, records, source and markers only; no provider, model
// or network is used and private object storage is an in-memory stand-in. The pure composer and the section reader are
// then mutation-checked: each deliberately broken copy must be caught by its named check.
const d1=process.argv.includes('--d1');
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const say=text=>process.stdout.write(text+'\n');
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network is allowed');};
const objects=new Map(),FILES={
 get:async key=>{const bytes=objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer,body:{cancel:async()=>{}}}:null;},
 head:async key=>objects.has(key)?{size:objects.get(key).length}:null,put:async()=>assert.fail('No upload in this suite'),delete:async key=>{objects.delete(key);},list:async()=>({objects:[],truncated:false}),
};
const runtime={fetch:async(_url,init)=>{const input=JSON.parse(init.body).input;return Response.json({ok:true,value:input&&typeof input==='object'&&'state'in input?{state:input.state,result:null}:input});}};
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},FILES,BACKEND_RUNTIME:runtime};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),run=(q,...p)=>db.prepare(q).bind(...p).run();
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const has=(bytes,marker)=>Buffer.from(bytes).includes(Buffer.from(marker));
const throwsCode=async(fn,code)=>{await assert.rejects(async()=>fn(),e=>{assert.equal(e?.code,code,String(e?.stack??e));return true;});};
const base='https://whumpo.com';
const call=(actor,path,data,method='POST')=>m.worker.fetch(new Request(base+'/api'+path,{method,headers:{origin:base,cookie:'__Host-whumpo_session='+actor.token,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env,{waitUntil:()=>{}});
const account=(actor,action,data={})=>call(actor,'/account/v1/'+action,{version:1,...data});
const ok=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const refused=async(response,status,code)=>{const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));assert.equal(body.code,code);return body;};
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const uploads={id:'uploads',kind:'files',...pins('files'),dependencies:['visitors'],config:{collections:[{id:'drop',read:'owner',upload:['visitor'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:null}]}};
const enquiries={id:'enquiries',kind:'records',...pins('records'),dependencies:[],config:{retentionDays:90,schemas:[{id:'enquiry',fieldsRevision:1,fields:[{key:'message',label:'Message',type:'text',optional:false,read:'owner'}],staffWrite:[]}],forms:[{id:'ask',recordId:'enquiry',submit:'public',uploadCollectionId:null}],views:[]}};
const readerKills={killed:0,total:0};
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const NEVER=['PENDING-BYTES-MARKER','BLOCKED-BYTES-MARKER','HELD-BYTES-MARKER','EXPIRED-RECORD-MARKER','UNCLEARED-SOURCE-MARKER','CONTACT-MESSAGE-MARKER','DNS-PROOF-MARKER','HOLD-BASIS-MARKER','PENDING-UPLOAD-MARKER','PENDING-FILED-MARKER'];

async function owner(proofOffset=-5,name='Shine Mobile Detailing',purpose='Mobile car detailing'){
 const actor=await workspaceFixture(db,m,id(),proofOffset),scope=await actor.scope();
 const site=await createFixtureProject(scope,actor.account,name,purpose);
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-187 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),actor.account,site.project,feature,operation);
 return {...actor,scope,user:actor.account,...site};
}
async function photo(o,label,state='pending'){
 const file=id(),bytes=new Uint8Array([0xff,0xd8,0xff,0xe0,...Buffer.from(label+'-'+file)]),key=`photos/${o.project}/${file}.jpg`;objects.set(key,bytes);
 await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,?,?,?,?,10,10,'ready',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",file,o.project,'photo.jpg',key,sha(bytes),bytes.length);
 await setPhoto(file,state);
 return {file,bytes,key};
}
/** `held`: an approval receipt that is no longer current (expired), so the exact digest is held pending a fresh check. */
async function setPhoto(file,state){
 if(state==='approved')await run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-clearance',expires_at=? WHERE file_id=?",new Date(Date.now()+3600000).toISOString(),file);
 if(state==='held')await run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-clearance',expires_at='2026-01-01T00:00:00.000Z' WHERE file_id=?",file);
 if(state==='blocked')await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",file);
}
async function control(o,action){const turn=id(),revision=(await m.readChat(o.scope,o.user)).state.revision;const r=await m.sendChatControl(o.scope,o.user,{id:turn,revision,action});assert.equal(r.status,200,r.error);return turn;}
async function activate(o,instanceId){
 const turn=await control(o,{type:'moduleActivationReview',projectId:o.project,instanceId,action:'activate'});
 const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',turn);
 await control(o,{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision});
}
async function prepare(o,data){return (await ok(await account(o,'portable/prepare',{requestId:id(),visitorData:false,projectId:o.project,...data}))).review;}
async function download(o,review){
 const response=await account(o,'portable/download',{reviewId:review.id,reviewDigest:review.digest});
 assert.equal(response.status,200,response.status===200?'':await response.clone().text());
 for(const [k,v] of [['content-type','application/zip'],['cache-control','private, no-store'],['x-content-type-options','nosniff']])assert.equal(response.headers.get(k),v);
 const bytes=new Uint8Array(await response.arrayBuffer()),digest=response.headers.get('x-whumpo-bundle-sha256');
 assert.equal(sha(bytes),digest,'The out-of-band receipt digest is the SHA-256 of the whole file');
 assert.equal(Number(response.headers.get('content-length')),bytes.length);
 // The frozen WH-186 reader is the only decoder: receipt digest, canonical packaging, checksums, tiers and report.
 const bundle=reference.readBundle(bytes,{expectedSha256:digest});
 return {bytes,digest,...bundle,text:k=>Buffer.from(bundle.contents.get(k)).toString()};
}
const portable=async(o,data={})=>download(o,await prepare(o,data));
/** The same reader and composer the route uses, over the same rows, with an explicit cutoff (deterministic comparisons). */
async function compose(o,{visitorData=false,cutoff='2026-10-09T00:00:00.000Z',impl=m,scope=o.scope}={}){
 const source=await impl.portableExport.readPortableProject({DB:scope,FILES},o.user,o.project,visitorData);
 return impl.portableBundle.composePortableBundle(source,{ownerId:o.user,projectId:o.project,visitorData,cutoff});
}
const withoutCutoff=bundle=>reference.canonicalJSON({...bundle.manifest,snapshot:{...bundle.manifest.snapshot,cutoff:null}});
async function preservationHold(o,scope,file){
 const caseId='case-wh187-'+id().slice(0,8),hold='hold-wh187-'+id().slice(0,8);
 await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",caseId,o.user);
 await run("INSERT OR IGNORE INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) VALUES('grant-test-approver','human:approver','preservation_approver','human:test-administrator',unixepoch())");
 await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,file_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,?,?,?,'HOLD-BASIS-MARKER','human:approver',unixepoch(),unixepoch()+86400)",hold,caseId,o.user,scope,scope==='account'?null:o.project,file??null);
 return ()=>run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?",hold);
}
const screeningHold=(user,digest)=>run("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-retired-policy',1,1,'risk_or_missing_history',100,60)",user,digest);
/** A first website saved through the same database admission as createWebsite, with an edited page (staff audience or a
 * page that needs Whumpo routes). The compiler never produces these; the fixture proves the filter, not the compiler. */
async function rawWebsite(o,{audience='public',edit=html=>html,marker}){
 const project=id(),turn=id(),now=new Date().toISOString(),name='Raw fixture '+id().slice(0,6);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,?,'draft',?,?)",project,o.user,name,'Raw fixture',now,now);
 const compiled=await m.compileNewWebsite({name,headline:marker,description:'Raw fixture',theme:'ocean',aboutTitle:'About',aboutText:'Raw fixture',sections:[],photos:[]});
 const spec=structuredClone(compiled.specification);spec.pages[0].audience=audience;
 const html=edit(compiled.artifacts[0].html),specDigest=await m.jsonDigest(spec);
 const manifest={...compiled.manifest,specificationDigest:specDigest,artifacts:[{...compiled.manifest.artifacts[0],digest:sha(html),bytes:Buffer.byteLength(html)}]};
 const revision=(await m.readChat(o.scope,o.user)).state.revision;
 await db.batch([
  db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES(?,?,?,'Synthetic raw website fixture','','ai','pending',?)").bind(turn,o.user,revision+1,now),
  db.prepare("INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at,source) VALUES(?,?,'site-page@1',?,?,?,?,'ai')").bind(turn,project,JSON.stringify({name}),html,sha(html),now),
  db.prepare('INSERT INTO project_spec_versions(version_id,project_id,revision,proposal_id,spec_json,spec_digest,lock_json,manifest_json,manifest_digest) VALUES(?,?,1,?,?,?,?,?,?)').bind(turn,project,turn,JSON.stringify(spec),specDigest,JSON.stringify(compiled.manifest.lock),JSON.stringify(manifest),await m.jsonDigest(manifest)),
  db.prepare('INSERT INTO project_spec_creations(id,user_id,project_id,request_hash,version_id) VALUES(?,?,?,?,?)').bind(turn,o.user,project,'c'.repeat(64),turn),
  db.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),
  db.prepare('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?').bind(o.user),
 ]);
 return {...o,project};
}

// ---------- Clean-environment boot of a real bundle with the frozen reference loader ----------
const prototypePath=fileURLToPath(new URL('../tools/prototypes/portable-export.mjs',import.meta.url));
async function bootBundle(bytes,digest,manifest){
 const dir=mkdtempSync(join(tmpdir(),'whumpo-portable-wh187-'));
 try{
  const own=join(dir,'bundle');mkdirSync(own);const zip=join(own,'export.zip');writeFileSync(zip,bytes);
  const child=spawn(process.execPath,['--permission',`--allow-fs-read=${own}`,`--allow-fs-read=${prototypePath}`,prototypePath,'boot',zip,digest],{env:{},cwd:own,stdio:['pipe','pipe','pipe']});
  const lines=[];let buffer='',stderr='';const waiters=[];
  child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stderr.on('data',d=>{stderr+=d;});
  child.stdout.on('data',d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){lines.push(JSON.parse(buffer.slice(0,i)));buffer=buffer.slice(i+1);waiters.splice(0).forEach(w=>w());}});
  const exited=new Promise(resolve=>child.once('exit',resolve));
  const next=()=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('boot timeout '+stderr)),15000);const take=()=>{if(lines.length){clearTimeout(timer);resolve(lines.shift());}else waiters.push(take);};take();});
  const get=(port,path)=>new Promise((resolve,reject)=>{const req=httpRequest({host:'127.0.0.1',port,path,agent:false},res=>{const parts=[];res.on('data',c=>parts.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts)}));});req.on('error',reject);req.end();});
  const ready=await next();
  try{
   assert.equal(ready.ready,true,JSON.stringify(ready)+stderr);
   assert.deepEqual(ready.selfTest,{network:'fired',socket:'fired',filesystem:'fired',childProcess:'denied',fsWrite:'denied',environment:0});
   for(const f of manifest.files.filter(f=>f.tier==='static'&&f.path!=='site/public/_headers')){
    const r=await get(ready.port,'/'+f.path.slice('site/public/'.length));
    assert.equal(r.status,200,f.path);assert.equal(sha(r.body),f.sha256,'Served bytes match the manifest: '+f.path);
   }
   for(const path of ['/manifest.json','/data/directory.json','/specification/specification.json','/api/v1/me','/modules'])assert.equal((await get(ready.port,path)).status,404,path);
  }finally{child.stdin.write('stop\n');}
  assert.deepEqual(await next(),{stopped:true,outboundAttempts:0});assert.equal(await exited,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
}

let a,b;
try{
 await initializeFixtureKeys(db);
 a=await owner();b=await owner(-5,'TENANT-B-PRIVATE-MARKER','TENANT-B-PRIVATE-MARKER purpose');
 const page=await photo(a,'PAGE-PHOTO','approved'),unused=await photo(a,'APPROVED-UNUSED','approved'),pending=await photo(a,'PENDING-BYTES-MARKER'),
  blocked=await photo(a,'BLOCKED-BYTES-MARKER','blocked'),heldPhoto=await photo(a,'HELD-BYTES-MARKER','held');
 const photoB=await photo(b,'TENANT-B-PRIVATE-MARKER','approved');
 // A photo website, a records instance with a public form, and the standard owner photo collection; all through the
 // owner review paths. Then the website is published so public records can be admitted.
 await changeFixtureWebsite(a.scope,a.user,a.project,[{type:'pages.setPhotos',pageId:'home',photos:[{id:page.file,alt:'Clean blue hatchback'}]}]);
 await configureFixtureModules(a.scope,a.user,a.project,[enquiries]);await activate(a,'enquiries');
 {const turn=await control(a,{type:'filesModuleReview',projectId:a.project});const q=await m.readSpecificationProposal(a.scope,a.user,turn);const applied=await applyFixtureWebsite(a.scope,a.user,q);assert.equal(applied.status,200,applied.error);}
 await activate(a,'photos');
 await enableFixtureVisitorAccess(a.scope,a.user,a.project);
 await configureFixtureModules(a.scope,a.user,a.project,[enquiries,uploads]);await activate(a,'uploads');
 assert.equal((await run('INSERT INTO publications(project_id,revision,version_id) SELECT id,1,(SELECT version_id FROM project_spec_heads WHERE project_id=projects.id) FROM projects WHERE id=?',a.project)).meta.changes,1);
 const instance=async local=>row('SELECT * FROM module_instances WHERE project_id=? AND local_id=?',a.project,local);
 const records=await instance('enquiries'),media=await instance('photos');
 const record=async message=>{const r=id();await run("INSERT INTO module_records(id,instance_id,project_id,schema_id,form_id,fields_revision,submitter_kind,visitor_id,values_json,revision,created_request_id,last_request_id,created_at,updated_at,expires_at) VALUES(?,?,?,'enquiry','ask',1,'public',NULL,?,1,?,?,unixepoch(),unixepoch(),unixepoch()+90*86400)",r,records.id,a.project,JSON.stringify({message}),r,r);return r;};
 const live=await record('VISITOR-VALUE-MARKER'),expired=await record('EXPIRED-RECORD-MARKER');
 {const trigger=await row("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='module_record_update'");await run('DROP TRIGGER module_record_update');
  // Test-only clock substitute in this disposable database: age one record past its 90-day window.
  try{await run('UPDATE module_records SET created_at=unixepoch()-91*86400,updated_at=unixepoch()-91*86400,expires_at=unixepoch()-86400 WHERE id=?',expired);}finally{await run(trigger.sql);}}
 const filed=await photo(a,'OWNER-FILED-PHOTO','approved'),filedPending=await photo(a,'PENDING-FILED-MARKER');
 for(const f of [filed,filedPending])await run("INSERT INTO module_files(file_id,instance_id,project_id,collection_id,uploader_kind,visitor_id,request_id,created_at) VALUES(?,?,?,'library','owner',NULL,?,unixepoch())",f.file,media.id,a.project,id());
 // Visitor-subject uploads into a visitor collection (approved and pending): only with the separate visitor-data choice.
 const visitor=id(),drop=await instance('uploads');await run(fixtureVisitorSQL,visitor,a.project,a.project);
 const upload=async(label,state)=>{const f=await photo(a,label,state);await run("INSERT INTO module_files(file_id,instance_id,project_id,collection_id,uploader_kind,visitor_id,request_id,created_at) VALUES(?,?,?,'drop','visitor',?,?,unixepoch())",f.file,drop.id,a.project,visitor,id());return f;};
 const visitorUpload=await upload('VISITOR-UPLOAD-MARKER','approved');await upload('PENDING-UPLOAD-MARKER');
 // Credential-table and restricted fixtures that must never be read into a bundle.
 const tokenSecret='gho_SYNTHETIC_WH187_'+id().slice(0,8),ciphertext=await fixtureCiphertext(fixtureKeyring(),`whumpo:github:token:${a.user}:token-wh187`,tokenSecret);
 await run("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES('token-wh187',?,?,'2027-01-01','active')",a.user,ciphertext);
 await run("INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,'shine.example','DNS-PROOF-MARKER',strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 day'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",id(),a.project);
 await run('INSERT INTO contact_settings(project_id,revision,enabled,publication_revision) VALUES(?,1,1,1)',a.project);
 await run("INSERT INTO contact_submissions(id,project_id,settings_revision,request_hash,name,email,message,created_at,expires_at) VALUES(?,?,1,?,'Visitor','visitor@example.invalid','CONTACT-MESSAGE-MARKER',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+30 days'))",id(),a.project,'d'.repeat(64));
 // Reviewed custom function source: saved, privately tested and published through the actual backend handlers.
 const {saveBackend,testBackend}=m.backend,{prepareBackendPublication,confirmBackendPublication}=m.backendPublication;
 const programSource='export default input => input; // CLEARED-PROGRAM-SOURCE',programVersion=id(),programRun=id();
 const program=await saveBackend(a.scope,a.user,a.project,programVersion,programSource);
 await testBackend(a.scope,runtime,a.user,a.project,programVersion,programRun,{state:{},input:{}});
 {const pub=id();await prepareBackendPublication(a.scope,a.user,a.project,pub,'publish',programVersion,programRun);await confirmBackendPublication(a.scope,a.user,pub);}

 let first;
 await check('owner bundle from the actual route passes the frozen reader byte for byte, with exact versions and only cleared content',async()=>{
  first=await portable(a);
  const {manifest}=first;
  assert.equal(manifest.format,'whumpo-portable-export');assert.equal(manifest.formatVersion,1);assert.equal(manifest.filter,'portable-filter@1');
  assert.deepEqual(manifest.project,{projectId:a.project,name:'Shine Mobile Detailing'});
  const head=await row('SELECT h.version_id,v.spec_digest,v.spec_json,v.lock_json FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=?',a.project);
  assert.deepEqual({...manifest.snapshot,cutoff:undefined},{cutoff:undefined,specificationVersionId:head.version_id,specificationDigest:head.spec_digest});
  const lock=JSON.parse(head.lock_json);
  assert.deepEqual(manifest.versions.compiler,{name:'project-content',version:5,digest:lock.compiler.digest});
  assert.deepEqual(manifest.versions.components.map(c=>c.id),['photo-page@1','site-page@1']);
  assert.deepEqual(manifest.versions.modules.map(x=>[x.localId,x.kind,x.module.name,x.schema.name,x.module.digest]),[['enquiries','records','module-records','records-data',pins('records').module.digest],['photos','files','module-files','files-data',pins('files').module.digest],['uploads','files','module-files','files-data',pins('files').module.digest],['visitors','access','module-access','access-data',pins('access').module.digest]]);
  assert.equal((await m.moduleAccessExport.validateAccessRolesExport(JSON.parse(first.text('data/access/visitors/roles.json')))).projectId,a.project,'The WH-126 validator accepts the staff role list');
  assert.deepEqual(JSON.parse(first.text('specification/specification.json')),JSON.parse(head.spec_json));
  assert.equal(await m.jsonDigest(JSON.parse(first.text('specification/specification.json'))),head.spec_digest);
  // Static tier: the saved homepage, its approved photo and the shared static-site headers, re-scanned by the reader.
  assert.deepEqual(manifest.claims.runnable,['static-site']);
  const site=await row('SELECT html,digest FROM site_versions WHERE id=?',head.version_id);
  assert.equal(first.text('site/public/index.html'),site.html);assert.equal(sha(first.contents.get('site/public/index.html')),site.digest);
  assert.ok(Buffer.from(first.contents.get(`site/public/assets/${page.file}.jpg`)).equals(Buffer.from(page.bytes)));
  assert.ok(first.text('site/public/_headers').includes("img-src 'self' data:"));
  assert.ok(Buffer.from(first.contents.get(`data/media/${unused.file}.jpg`)).equals(Buffer.from(unused.bytes)));
  assert.ok(Buffer.from(first.contents.get(`data/media/${filed.file}.jpg`)).equals(Buffer.from(filed.bytes)),'Owner-filed photos stay in the owner library');
  assert.equal(first.text('source/backend/program.js'),programSource);
  const programJSON=JSON.parse(first.text('source/backend/program.json'));assert.deepEqual([programJSON.format,programJSON.sha256,programJSON.engine],['whumpo-backend-source',program.digest,'quickjs']);
  // Not cleared: pending, blocked and held (expired-approval) photos and the pending owner-filed photo, one generic count.
  assert.deepEqual(manifest.exclusions,[{category:'contact-inbox-separate-export',count:1},{category:'credentials-and-sessions',count:null},{category:'not-cleared',count:4},{category:'visitor-dataset-not-requested',count:3}]);
  for(const marker of [...NEVER,'VISITOR-VALUE-MARKER','VISITOR-UPLOAD-MARKER'])assert.equal(has(first.bytes,marker),false,marker);
  assert.equal(manifest.files.some(f=>f.path.startsWith('data/records/')||f.path.startsWith('data/files/')),false);
  const report=Object.fromEntries(manifest.unavailable.map(e=>[e.capability,e]));
  assert.equal(report['content-pages'].status,'runnable');assert.equal(report.records.status,'data-only');assert.equal(report.forms.status,'unavailable');assert.equal(report.access.used,true);
  assert.deepEqual(report.records.resources,[records.id]);assert.equal(report['maintainer-ai'].status,'unavailable');
  for(const capability of ['contact-inbox','domains','connectors','custom-functions'])assert.equal(report[capability].used,['contact-inbox','domains','custom-functions'].includes(capability),capability);
  // The frozen reader's static loader serves exactly the claimed subset.
  const handle=reference.createStaticHandler(first);
  assert.equal(Buffer.from(handle('GET','/').body).toString(),site.html);
  assert.ok(Buffer.from(handle('GET',`/assets/${page.file}.jpg`).body).equals(Buffer.from(page.bytes)));
  for(const path of ['/manifest.json','/source/backend/program.js','/data/directory.json'])assert.equal(handle('GET',path).status,404,path);
  await bootBundle(first.bytes,first.digest,manifest);
 });

 let visitorBundle;
 await check('visitor datasets only with the separate choice: retained records and cleared module files, through the real serializers',async()=>{
  visitorBundle=await portable(a,{visitorData:true});
  const {manifest}=visitorBundle;
  assert.equal(manifest.scope.visitorData,true);
  const recordsDoc=JSON.parse(visitorBundle.text('data/records/enquiries/enquiry.json'));
  assert.deepEqual(recordsDoc.records.map(r=>r.entryId),[live],'Expired records are never exported');
  assert.equal((await m.moduleRecordsExport.validateRecordsExport(recordsDoc)).records.length,1,'The WH-127 import validator accepts the bundle data set');
  const filesDoc=JSON.parse(visitorBundle.text('data/files/photos/library.json'));
  assert.deepEqual(filesDoc.files.map(f=>[f.id,f.sha256]),[[filed.file,sha(filed.bytes)]]);
  assert.ok(Buffer.from(visitorBundle.contents.get(`data/files/photos/library/${filed.file}.jpg`)).equals(Buffer.from(filed.bytes)));
  const dropDoc=JSON.parse(visitorBundle.text('data/files/uploads/drop.json'));
  assert.deepEqual(dropDoc.files.map(f=>[f.id,f.uploadedBy,f.visitorId]),[[visitorUpload.file,'visitor',visitor]]);
  assert.ok(Buffer.from(visitorBundle.contents.get(`data/files/uploads/drop/${visitorUpload.file}.jpg`)).equals(Buffer.from(visitorUpload.bytes)));
  assert.equal(first.manifest.files.some(f=>f.path.includes(visitorUpload.file)),false,'Visitor uploads are not owner library photos');
  assert.equal(has(visitorBundle.bytes,'VISITOR-VALUE-MARKER'),true);assert.equal(has(visitorBundle.bytes,'VISITOR-UPLOAD-MARKER'),true);
  for(const marker of NEVER)assert.equal(has(visitorBundle.bytes,marker),false,marker);
  // The library count and the owner collection's withheld count each report the pending owner-filed photo once; the
  // pending visitor upload is counted only in its collection.
  assert.equal(manifest.exclusions.find(e=>e.category==='not-cleared').count,6);
  assert.equal(manifest.exclusions.some(e=>e.category==='visitor-dataset-not-requested'),false);
 });

 await check('two tenants: the other owner, other projects and credential tables never appear; foreign owners are refused',async()=>{
  for(const bundle of [first,visitorBundle])for(const secret of ['TENANT-B-PRIVATE-MARKER',b.user,b.project,photoB.file,tokenSecret,ciphertext,a.token,b.token,a.credential,a.authority,page.key,'object_key','token_hash','ciphertext','DNS-PROOF-MARKER','CONTACT-MESSAGE-MARKER'])
   assert.equal(has(bundle.bytes,secret),false,'Bundle leaked '+secret.slice(0,24));
  await refused(await account(b,'portable/prepare',{requestId:id(),projectId:a.project,visitorData:false}),404,'not_found');
  await refused(await account(b,'portable/prepare',{requestId:id(),projectId:id(),visitorData:false}),404,'not_found');
  const review=await prepare(a);
  await refused(await account(b,'portable/download',{reviewId:review.id,reviewDigest:review.digest}),409,'stale_review');
  const bBundle=await portable(b);
  for(const marker of [a.project,'Shine Mobile Detailing',page.file,'VISITOR-VALUE-MARKER'])assert.equal(has(bBundle.bytes,marker),false,marker);
  assert.equal(bBundle.manifest.project.projectId,b.project);
  // The reader cannot be pointed at another owner's project either.
  await throwsCode(()=>m.portableExport.readPortableProject({DB:b.scope,FILES},b.user,a.project,false),'not_found');
  await throwsCode(async()=>m.portableBundle.composePortableBundle(await m.portableExport.readPortableProject({DB:a.scope,FILES},a.user,a.project,false),{ownerId:b.user,projectId:a.project,visitorData:false,cutoff:'2026-10-09T00:00:00.000Z'}),'FORBIDDEN');
 });

 await check('exact review: owner-only, single use, replay, wrong digest, stale binding, stale proof and cross-format refusals like the account export',async()=>{
  const review=await prepare(a);
  assert.equal(review.format,'whumpo-portable-export');assert.equal(review.projectId,a.project);assert.equal(review.visitorData,false);
  assert.ok(review.excludes.some(x=>/Passkeys/.test(x)));assert.ok(!JSON.stringify(review).match(/hold|preserv|safety/i),'The review never reveals a hold');
  await refused(await account(a,'portable/download',{reviewId:review.id,reviewDigest:'0'.repeat(64)}),409,'stale_review');
  await refused(await account(a,'portable/prepare',{requestId:review.id,projectId:a.project,visitorData:true}),409,'request_conflict');
  const replay=await ok(await account(a,'portable/prepare',{requestId:review.id,projectId:a.project,visitorData:false}));assert.equal(replay.review.digest,review.digest);
  // An account export review is not a portable review and the reverse; neither attempt consumes the other review.
  await refused(await account(a,'export/download',{reviewId:review.id,reviewDigest:review.digest}),409,'stale_review');
  const accountReview=(await ok(await account(a,'export/prepare',{requestId:id(),visitorData:false}))).review;
  await refused(await account(a,'portable/download',{reviewId:accountReview.id,reviewDigest:accountReview.digest}),409,'stale_review');
  assert.ok(await row('SELECT 1 x FROM account_lifecycle_reviews WHERE id=?',accountReview.id));
  await refused(await account(a,'export/prepare',{requestId:review.id,visitorData:false}),409,'request_conflict');
  await download(a,review);
  await refused(await account(a,'portable/download',{reviewId:review.id,reviewDigest:review.digest}),409,'stale_review');
  // Stale passkey proof: prepare needs none, download refuses until reauthentication.
  const stale={...await workspaceSession(db,m,{account:a.account,credential:a.credential},-3600),project:a.project},staleReview=await prepare(stale);
  await refused(await account(stale,'portable/download',{reviewId:staleReview.id,reviewDigest:staleReview.digest}),401,'proof_required');
  // A content change after the review makes it stale.
  const changing=await prepare(a);
  await changeFixtureWebsite(a.scope,a.user,a.project,[{type:'content.replace',contentId:'about-title',text:'About Shine'}]);
  await refused(await account(a,'portable/download',{reviewId:changing.id,reviewDigest:changing.digest}),409,'stale_review');
  for(const bad of [{version:2,requestId:id(),projectId:a.project,visitorData:false},{version:1,requestId:id(),visitorData:false},{version:1,requestId:id(),projectId:'x',visitorData:false},{version:1,requestId:id(),projectId:a.project,visitorData:'yes'},{version:1,requestId:id(),projectId:a.project,visitorData:false,extra:1}])
   await refused(await call(a,'/account/v1/portable/prepare',bad),400,'invalid_request');
  assert.equal((await call(a,'/account/v1/portable/prepare',undefined,'GET')).status,404);
 });

 await check('shared per-account allowance: downloads and photo reads are charged and capped like the account export',async()=>{
  const usage=async()=>({...await row("SELECT downloads,photo_reads FROM account_export_usage WHERE user_id=? AND period=strftime('%Y-%m','now')",b.user)});
  const before=await usage();await portable(b);const after=await usage();
  assert.deepEqual(after,{downloads:before.downloads+1,photo_reads:before.photo_reads+1});
  await run('UPDATE account_export_usage SET downloads=10 WHERE user_id=?',b.user);
  const capped=await prepare(b);
  await refused(await account(b,'portable/download',{reviewId:capped.id,reviewDigest:capped.digest}),409,'request_conflict');
  assert.ok(await row('SELECT 1 x FROM account_lifecycle_reviews WHERE id=?',capped.id),'An exhausted allowance keeps the review');
  await run('UPDATE account_export_usage SET downloads=0,photo_reads=5000 WHERE user_id=?',b.user);
  await refused(await account(b,'portable/download',{reviewId:capped.id,reviewDigest:capped.digest}),503,'unavailable');
  await run('UPDATE account_export_usage SET downloads=0,photo_reads=0 WHERE user_id=?',b.user);
 });

 await check('deterministic bytes: the route bundle equals the composer over the same rows and cutoff; reordered rows change nothing',async()=>{
  const routed=await portable(a);
  const again=await compose(a,{cutoff:routed.manifest.snapshot.cutoff});
  assert.ok(Buffer.from(again.bytes).equals(Buffer.from(routed.bytes)),'Route bytes are the deterministic composer output');assert.equal(again.sha256,routed.digest);
  const source=await m.portableExport.readPortableProject({DB:a.scope,FILES},a.user,a.project,true),options={ownerId:a.user,projectId:a.project,visitorData:true,cutoff:'2026-10-09T00:00:00.000Z'};
  const x=await m.portableBundle.composePortableBundle(source,options);
  const reversed={...source,photos:[...source.photos].reverse(),instances:[...source.instances].reverse(),records:[...source.records].reverse(),files:source.files.map(f=>({...f,files:[...f.files].reverse()})).reverse(),programs:[...source.programs].reverse()};
  assert.equal((await m.portableBundle.composePortableBundle(reversed,options)).sha256,x.sha256);
  assert.notEqual((await m.portableBundle.composePortableBundle(source,{...options,cutoff:'2026-10-09T00:00:01.000Z'})).sha256,x.sha256);
  const raw=Buffer.from(x.bytes);assert.equal(raw.readUInt16LE(10),0);assert.equal(raw.readUInt16LE(12),0x21);assert.equal(raw.readUInt16LE(8),0);
  const names=reference.unpackEntries(x.bytes).map(([p])=>p);assert.equal(names[0],'manifest.json');
  for(let i=2;i<names.length;i++)assert.ok(names[i-1]<names[i],names[i]);
 });

 await check('hold non-disclosure: a held photo, a preservation hold and a later hold are indistinguishable from other uncleared items',async()=>{
  // A pending photo, then the same photo with a held (no longer current) approval: byte-identical bundles.
  const pendingBundle=await compose(a);await setPhoto(pending.file,'held');const heldBundle=await compose(a);
  assert.ok(Buffer.from(heldBundle.bytes).equals(Buffer.from(pendingBundle.bytes)));
  // Restricted preservation holds (project and object scope) never change what an owner can export, so they are
  // undetectable; their identifiers and legal basis never appear.
  const releaseProject=await preservationHold(a,'project'),releaseObject=await preservationHold(a,'object',unused.file);
  const preserved=await compose(a);
  assert.ok(Buffer.from(preserved.bytes).equals(Buffer.from(heldBundle.bytes)),'A preservation hold leaves the bundle byte-identical');
  // A hold placed after the review applies at download without making the review stale or visible.
  const review=await prepare(a);await releaseProject();await releaseObject();
  const routed=await download(a,review);assert.equal(withoutCutoff(routed),withoutCutoff(await compose(a,{cutoff:routed.manifest.snapshot.cutoff})));
  for(const bundle of [preserved,routed])for(const marker of ['HOLD-BASIS-MARKER','case-wh187','hold-wh187','safety','preserv'])assert.equal(has(bundle.bytes,marker),false,marker);
  assert.ok(routed.manifest.exclusions.every(e=>!/hold|held|safety|case|preserv/i.test(e.category)));
 });

 await check('screening-held and unreviewed source are the same generic exclusion; a held published program is never exported',async()=>{
  const cleared=await compose(a);assert.ok(cleared.manifest.files.some(f=>f.path==='source/backend/program.js'));
  await screeningHold(a.user,program.digest);
  const held=await compose(a);
  assert.equal(held.manifest.files.some(f=>f.path.startsWith('source/')),false);assert.equal(has(held.bytes,'CLEARED-PROGRAM-SOURCE'),false);
  assert.equal(held.manifest.exclusions.find(e=>e.category==='not-cleared').count,cleared.manifest.exclusions.find(e=>e.category==='not-cleared').count+1);
  await readerMutants(a,program);
  // Unpublishing leaves a saved but never reviewed program: the bundle is byte-identical to the held one.
  const off=id();await prepareBackendPublication(a.scope,a.user,a.project,off,'unpublish',programVersion,null);await confirmBackendPublication(a.scope,a.user,off);
  assert.ok(Buffer.from((await compose(a)).bytes).equals(Buffer.from(held.bytes)),'Held and uncleared source are indistinguishable');
 });

 await check('a held saved website is not exported; staff pages are not served; a page that needs Whumpo routes is never runnable',async()=>{
  const d=await owner(-5,'Held website','HELD-SPEC-MARKER garden care');
  const head=await row('SELECT s.digest FROM project_spec_heads h JOIN site_versions s ON s.id=h.version_id WHERE h.project_id=?',d.project);
  const before=await portable(d);assert.equal(has(before.bytes,'HELD-SPEC-MARKER'),true);
  await screeningHold(d.user,head.digest);
  const held=await portable(d);
  assert.equal(has(held.bytes,'HELD-SPEC-MARKER'),false);assert.deepEqual(held.manifest.claims.runnable,[]);
  assert.equal(held.manifest.files.some(f=>f.path.startsWith('specification/')||f.path.startsWith('site/')),false);
  assert.equal(held.manifest.exclusions.find(e=>e.category==='not-cleared').count,1,'One held saved version, one generic count');
  assert.equal(held.manifest.unavailable.find(e=>e.capability==='content-pages').status,'data-only');
  const staff=await rawWebsite(a,{audience:'staff',marker:'STAFF-PAGE-MARKER'}),staffBundle=await portable(staff);
  assert.equal(staffBundle.manifest.files.some(f=>f.path.startsWith('site/')),false);assert.deepEqual(staffBundle.manifest.claims.runnable,[]);
  assert.deepEqual(staffBundle.manifest.exclusions.find(e=>e.category==='staff-page-not-served'),{category:'staff-page-not-served',count:1});
  assert.ok(JSON.parse(staffBundle.text('specification/specification.json')).content.some(c=>c.text==='STAFF-PAGE-MARKER'),'Staff page text stays in the specification');
  assert.equal(staffBundle.manifest.unavailable.find(e=>e.capability==='access').used,true);
  const dynamic=await rawWebsite(a,{edit:html=>html.replace('</body>','<script>fetch("/modules",{method:"POST"})</script></body>'),marker:'DYNAMIC-PAGE'}),dynamicBundle=await portable(dynamic);
  assert.deepEqual(dynamicBundle.manifest.claims.runnable,[]);
  assert.equal(dynamicBundle.manifest.unavailable.find(e=>e.capability==='content-pages').status,'data-only');
  assert.ok(dynamicBundle.manifest.files.filter(f=>f.path.startsWith('site/public/')).every(f=>f.tier==='source'));
  // Forging the claim is refused by the reader, which re-scans instead of trusting the manifest.
  const entries=new Map(reference.unpackEntries(dynamicBundle.bytes)),mf=JSON.parse(Buffer.from(entries.get('manifest.json')).toString());
  mf.claims.runnable=['static-site'];mf.unavailable.find(e=>e.capability==='content-pages').status='runnable';for(const f of mf.files)if(f.path.startsWith('site/public/'))f.tier='static';
  entries.delete('manifest.json');
  await throwsCode(()=>reference.readBundle(reference.packEntries([['manifest.json',Buffer.from(reference.canonicalJSON(mf))],...[...entries.entries()].sort(([x],[y])=>x<y?-1:1)])),'FALSE_RUNNABLE_CLAIM');
  await throwsCode(()=>reference.createStaticHandler(dynamicBundle),'NO_RUNNABLE_CLAIM');
 });

 await check('bounds fail closed: an oversized data set is refused with nothing partial, after consuming the single-use review',async()=>{
  for(let n=0;n<200;n++)await record('BULK-'+n);
  const review=await prepare(a,{visitorData:true});
  await refused(await account(a,'portable/download',{reviewId:review.id,reviewDigest:review.digest}),413,'bundle_too_large');
  await refused(await account(a,'portable/download',{reviewId:review.id,reviewDigest:review.digest}),409,'stale_review');
  assert.equal((await portable(a)).manifest.scope.visitorData,false,'Owner data without visitor datasets still exports');
 });

 await check('no model, Chat or agent path reaches the portable route; no network, no logging of private values',async()=>{
  for(const entry of ['src/account-lifecycle/portable.ts','src/account-lifecycle/portable-bundle.ts','src/account-lifecycle/project-sections.ts'])assert.deepEqual(await inferenceReach(entry),[],entry);
  for(const file of ['src/chat-controls.ts','src/site-agent.ts','src/workspace-shortcuts.ts','src/chat.ts','src/ai-chat.ts'])assert.ok(!/portable|account-lifecycle|account\/v1/.test(readFileSync(file,'utf8')),file);
  const bundle=readFileSync('src/account-lifecycle/portable-bundle.ts','utf8');
  assert.equal(/\bDate\.now\(|Math\.random\(|new Date\(\)|crypto\.randomUUID|\bfetch\(|\.prepare\(|FILES/.test(bundle),false,'The composer reads no clock, randomness, network, database or storage');
  assert.deepEqual([...bundle.matchAll(/^import .* from '([^']+)';$/gm)].map(x=>x[1]),['../project-specification/v2/json','../static-site-headers']);
 });

 assert.equal(network,0,'No provider or network call was made');
 assert.ok(!logs.join('\n').match(/VISITOR-VALUE-MARKER|gho_SYNTHETIC|CLEARED-PROGRAM-SOURCE/),'No private value was logged');
 const composerKills=await composerMutants();
 say(`Portable export passed: ${cases} groups on ${d1?'local D1':'disposable SQLite'} (actual /api/account/v1/portable routes and section reader; every bundle re-read by the frozen WH-186 reader and booted in a permission-restricted process; two tenants; held, pending, blocked and preservation-held media; staff, held and dynamic pages; expired records; uncleared and held source; credential tables; shared review, single use and allowance) and ${composerKills.checks} composer checks; ${composerKills.killed}/${composerKills.total} composer mutants and ${readerKills.killed}/${readerKills.total} reader mutants caught by their named checks. No network, model or provider.`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;for(const k of consoleMethods)console[k]=originals[k];await fixture.close();}

// ---------- Reader mutation check: each broken section reader must be caught on the same database state ----------
async function mutantBundle(file,find,replace){
 const text=readFileSync(file,'utf8');
 assert.equal(text.split(find).length,2,`mutant must match ${file} exactly once: ${find.slice(0,60)}`);
 const plugin={name:'mutant',setup(b){b.onLoad({filter:new RegExp(file.replace(/[.*+?^${}()|[\]\\/]/g,'\\$&')+'$')},()=>({contents:text.replace(find,()=>replace),loader:'ts'}));}};
 const out=await build({stdin:{contents:`export * as portableExport from './src/account-lifecycle/portable';export * as portableBundle from './src/account-lifecycle/portable-bundle';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[plugin],logLevel:'silent'});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
}
async function readerMutants(o,program){
 // Named checks over the current database state (a published program now screening-held; approved photos).
 const named={
  'preservation hold indistinguishable':async impl=>{
   const scope=impl.admitWorkspace(db,await impl.resolveIdentity(db,{version:1,client:'web',kind:'session',token:o.token}));
   const before=await compose(o,{impl,scope});const release=await preservationHold(o,'project');
   try{assert.ok(Buffer.from((await compose(o,{impl,scope})).bytes).equals(Buffer.from(before.bytes)));}finally{await release();}
  },
  'held source never exported':async impl=>{
   const scope=impl.admitWorkspace(db,await impl.resolveIdentity(db,{version:1,client:'web',kind:'session',token:o.token}));
   const bundle=await compose(o,{impl,scope});assert.equal(bundle.manifest.files.some(f=>f.path.startsWith('source/')),false);assert.equal(has(bundle.bytes,'CLEARED-PROGRAM-SOURCE'),false);
  },
  'unapproved media never exported':async impl=>{
   const scope=impl.admitWorkspace(db,await impl.resolveIdentity(db,{version:1,client:'web',kind:'session',token:o.token}));
   const bundle=await compose(o,{impl,scope});for(const marker of ['PENDING-BYTES-MARKER','BLOCKED-BYTES-MARKER','HELD-BYTES-MARKER'])assert.equal(has(bundle.bytes,marker),false,marker);
  },
 };
 const mutants=[
  ['preservation-held photos withheld (hold disclosed)','src/account-lifecycle/project-sections.ts',"AND ${ownerLibrarySQL} AND ${approvedPhotoSQL} ORDER BY f.created_at,f.id","AND ${ownerLibrarySQL} AND ${approvedPhotoSQL} AND f.id NOT IN (SELECT file_id FROM safety_held_files) ORDER BY f.created_at,f.id",'preservation hold indistinguishable'],
  ['preservation-held project counted','src/account-lifecycle/project-sections.ts',"WHERE f.project_id=? AND ${ownerLibrarySQL} AND NOT (f.status='ready' AND ${approvedPhotoSQL})","WHERE f.project_id=? AND ${ownerLibrarySQL} AND (NOT (f.status='ready' AND ${approvedPhotoSQL}) OR f.project_id IN (SELECT project_id FROM safety_held_projects))",'preservation hold indistinguishable'],
  ['held published source exported','src/account-lifecycle/portable.ts','if(published&&published.held!==1)programs.push','if(published)programs.push','held source never exported'],
  ['library read ignores approval','src/account-lifecycle/project-sections.ts',"f.status='ready' AND ${ownerLibrarySQL} AND ${approvedPhotoSQL} ORDER BY","f.status='ready' AND ${ownerLibrarySQL} ORDER BY",'unapproved media never exported'],
 ];
 for(const [name,file,find,replace,killer] of mutants){
  readerKills.total++;
  const impl=await mutantBundle(file,find,replace);
  let caught=null;for(const [check,fn] of Object.entries(named)){try{await fn(impl);}catch(error){caught={check,error};break;}}
  assert.ok(caught,`reader mutant survived: ${name}`);
  assert.equal(caught.check,killer,`reader mutant "${name}" was caught by an unexpected check: ${caught.check} (${caught.error.message})`);
  if(process.env.PORTABLE_EXPLAIN==='1')originals.log(`${name} => ${caught.check}: ${String(caught.error.message).split('\n')[0]}`);
  readerKills.killed++;
 }
 // The unmutated reader passes every named check.
 for(const fn of Object.values(named))await fn(m);
}

// ---------- Pure composer: synthetic rows, the frozen reader, and a mutation check of the permission filter ----------
async function composerMutants(){
 const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222',CUTOFF='2026-10-08T12:00:00.000Z';
 const U=n=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`,day=n=>new Date(Date.parse(CUTOFF)-n*86400000).toISOString();
 const jpeg=label=>new Uint8Array(Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.from(label),Buffer.from([0xff,0xd9])]));
 const pinOf=name=>({name,version:1,digest:sha(name)});
 async function synthetic({audience='public',held=false,html}={}){
  const spec={schemaVersion:3,name:'Shine',design:{theme:'ocean'},modules:[{id:'content',version:2},{id:'notifications',version:1}],
   content:[{id:'headline',text:held?'HELD-SPEC-MARKER':'Shine'},{id:'team',text:'Team schedule note is owner configuration'}],
   pages:[{id:'home',path:'/',component:'photo-page@1',audience,photos:[{id:U(1),alt:'Car'}]}],instances:[],integrations:[],rules:[{id:'notify'}]};
  const page=html??`<!doctype html><html><head><title>Shine</title></head><body><h1>${audience==='staff'?'STAFF-PAGE-MARKER':'Shine'}</h1><img src="assets/${U(1)}.jpg" alt="Car"></body></html>`;
  const photo=(n,label,projectId=A,cleared=true)=>{const bytes=jpeg(label);return {id:U(n),projectId,digest:sha(bytes),bytes,cleared};};
  const file=(n,label,projectId=A,cleared=true)=>({...photo(n,label,projectId,cleared),uploadedBy:'visitor',visitorId:U(30),width:10,height:10,createdAt:day(1)});
  const R=U(20),F=U(21),X=U(22),C=U(23);
  const record=(n,message,createdAt,expiresAt)=>({entryId:U(n),formId:'ask',fieldsRevision:1,submittedBy:'public',visitorId:null,revision:1,createdAt,updatedAt:createdAt,expiresAt,values:{message}});
  return {ownerId:'owner-a',project:{id:A,ownerId:'owner-a',name:'Shine'},
   specification:{projectId:A,versionId:U(90),digest:await m.jsonDigest(spec),json:JSON.stringify(spec),schemaVersion:3,compiler:pinOf('project-content'),components:[{id:'site-page@1',digest:sha('s')},{id:'photo-page@1',digest:sha('p')}],held},
   site:{projectId:A,versionId:U(90),component:'photo-page@1',html:page,digest:sha(page),photos:[{fileId:U(1),projectId:A}]},
   photos:[photo(1,'PAGE-PHOTO'),photo(2,'APPROVED-UNUSED'),photo(3,'PENDING-BYTES-MARKER',A,false),photo(4,'HELD-BYTES-MARKER',A,false),photo(5,'FOREIGN-ROW-MARKER',B)],withheldPhotos:1,
   directory:{projectId:A,document:{format:'whumpo-directory',schemaVersion:1,project:{id:A,name:'Shine'},snapshot:{id:U(10),appliedAt:day(2),kind:'publish',restoredFrom:null,listingsSha256:sha('l')},listings:[{id:U(11),title:'Main Street',description:'',url:''}]}},
   instances:[{resourceId:R,projectId:A,localId:'enquiries',kind:'records',configRevision:1,module:pinOf('module-records'),schema:pinOf('records-data'),forms:true},
    {resourceId:F,projectId:A,localId:'media',kind:'files',configRevision:1,module:pinOf('module-files'),schema:pinOf('files-data'),forms:false},
    {resourceId:X,projectId:A,localId:'visitors',kind:'access',configRevision:1,module:pinOf('module-access'),schema:pinOf('access-data'),forms:false},
    {resourceId:C,projectId:A,localId:'directory',kind:'content',configRevision:1,module:pinOf('module-collections'),schema:pinOf('collections-data'),forms:false},
    {resourceId:U(24),projectId:B,localId:'foreign',kind:'records',configRevision:1,module:pinOf('module-records'),schema:pinOf('records-data'),forms:true}],
   roles:[{resourceId:X,projectId:A,document:{format:'whumpo-access-roles',schemaVersion:1,project:{id:A},instance:{resourceId:X,localId:'visitors',configRevision:1,accessRevision:1,staffRole:true},roles:[{visitorId:U(31),role:'staff',state:'granted',accessRevision:1,grantedAt:day(9),updatedAt:day(9)}],rolesSha256:sha('r')}}],
   records:[{resourceId:R,projectId:A,schemaId:'enquiry',retentionDays:90,document:{format:'whumpo-module-records',schemaVersion:1,project:{id:A},instance:{resourceId:R,localId:'enquiries',configRevision:1,retentionDays:90},
    schema:{recordId:'enquiry',fieldsRevision:1,fields:[{key:'message',label:'Message',type:'text',optional:false,read:'owner'}]},subject:null,
    records:[record(40,'VISITOR-VALUE-MARKER',day(1),day(-89)),record(41,'EXPIRED-RECORD-MARKER',day(100),day(10))],next:null,recordsSha256:sha('x')}},
    {resourceId:U(24),projectId:B,schemaId:'enquiry',retentionDays:90,document:{format:'whumpo-module-records',schemaVersion:1,project:{id:B},instance:{resourceId:U(24)},records:[record(42,'FOREIGN-ROW-MARKER',day(1),day(-89))],next:null}}],
   files:[{resourceId:F,projectId:A,collectionId:'library',withheld:1,complete:true,files:[file(50,'VISITOR-UPLOAD-MARKER'),file(51,'PENDING-UPLOAD-MARKER',A,false),file(52,'FOREIGN-ROW-MARKER',B)]}],
   programs:[{id:'backend',projectId:A,source:'export default i=>i; // CLEARED-SOURCE',digest:sha('export default i=>i; // CLEARED-SOURCE'),cleared:true},
    {id:'application',projectId:A,source:'// UNCLEARED-SOURCE-MARKER',digest:sha('// UNCLEARED-SOURCE-MARKER'),cleared:false},
    {id:'foreign',projectId:B,source:'// FOREIGN-ROW-MARKER',digest:sha('// FOREIGN-ROW-MARKER'),cleared:true}],
   frontends:[{id:'booking',projectId:A,files:{'index.html':'<form id="b"></form><script>fetch(\'/modules\',{method:\'POST\'})</script>'}},{id:'plain',projectId:A,files:{'index.html':'<p>Plain</p>'}},{id:'foreign',projectId:B,files:{'index.html':'FOREIGN-ROW-MARKER'}}],
   presence:{contactInbox:true,connectors:true,domains:true,forms:true,customFunctions:true},resources:{customFunctions:[U(60)]}};
 }
 const options={ownerId:'owner-a',projectId:A,visitorData:false,cutoff:CUTOFF};
 async function suite(impl){
  let count=0;const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
  const build=async(over={},opts={})=>impl.composePortableBundle(over.source??await synthetic(over),{...options,...opts});
  let baseBundle,visitors;
  await test('deterministic bundle',async()=>{
   baseBundle=await build();visitors=await build({},{visitorData:true});
   const again=await build();assert.ok(Buffer.from(again.bytes).equals(Buffer.from(baseBundle.bytes)));
   const s=await synthetic();const reversed={...s,photos:[...s.photos].reverse(),instances:[...s.instances].reverse(),programs:[...s.programs].reverse(),frontends:[...s.frontends].reverse(),records:[...s.records].reverse()};
   assert.equal((await build({source:reversed})).sha256,baseBundle.sha256);
   const raw=Buffer.from(baseBundle.bytes);assert.equal(raw.readUInt16LE(12),0x21);assert.equal(raw.readUInt16LE(10),0);
   const names=reference.unpackEntries(baseBundle.bytes).map(([p])=>p);for(let i=2;i<names.length;i++)assert.ok(names[i-1]<names[i]);
  });
  await test('reader conformance',async()=>{
   for(const bundle of [baseBundle,visitors]){const read=reference.readBundle(bundle.bytes,{expectedSha256:bundle.sha256});assert.equal(read.manifest.formatVersion,1);}
   const handle=reference.createStaticHandler(reference.readBundle(baseBundle.bytes));assert.equal(handle('GET','/').status,200);assert.equal(handle('GET',`/assets/${U(1)}.jpg`).status,200);
  });
  await test('other tenant',async()=>{
   await throwsCode(()=>build({},{ownerId:'owner-b'}),'FORBIDDEN');
   await throwsCode(()=>build({},{projectId:B}),'FORBIDDEN');
   for(const bundle of [baseBundle,visitors])for(const marker of ['FOREIGN-ROW-MARKER',B])assert.equal(has(bundle.bytes,marker),false,marker);
   assert.equal(baseBundle.manifest.versions.modules.some(x=>x.localId==='foreign'),false);
  });
  await test('platform secrets and credentials',async()=>{
   const s=await synthetic();s.directory.document.listings[0].sessionCookie='x';await throwsCode(()=>build({source:s}),'SECRET_FIELD');
   const t=await synthetic();t.roles[0].document.apiKey='x';await throwsCode(()=>build({source:t}),'SECRET_FIELD');
   assert.ok(baseBundle.manifest.exclusions.some(e=>e.category==='credentials-and-sessions'&&e.count===null));
  });
  await test('private, unapproved and held',async()=>{
   for(const bundle of [baseBundle,visitors])for(const marker of ['PENDING-BYTES-MARKER','HELD-BYTES-MARKER','UNCLEARED-SOURCE-MARKER','EXPIRED-RECORD-MARKER','PENDING-UPLOAD-MARKER'])assert.equal(has(bundle.bytes,marker),false,marker);
   const staff=await build({audience:'staff'});
   assert.equal(has(staff.bytes,'STAFF-PAGE-MARKER'),false);assert.ok(staff.manifest.exclusions.some(e=>e.category==='staff-page-not-served'&&e.count===1));
   assert.equal(has(staff.bytes,'Team schedule note is owner configuration'),true);
   const heldSpec=await build({held:true});assert.equal(has(heldSpec.bytes,'HELD-SPEC-MARKER'),false);assert.equal(heldSpec.manifest.files.some(f=>f.path.startsWith('site/')),false);
  });
  await test('hold non-disclosure',async()=>{
   // A held photo row the reader returned and a photo the reader only counted give byte-identical bundles.
   const s=await synthetic();s.photos=s.photos.filter(p=>p.id!==U(4));s.withheldPhotos++;
   assert.equal((await build({source:s})).sha256,baseBundle.sha256);
   assert.ok(baseBundle.manifest.exclusions.every(e=>!/hold|held|safety|case/i.test(e.category)));
   // pending and held photos, the withheld photo and the uncleared program: one generic count.
   assert.equal(baseBundle.manifest.exclusions.find(e=>e.category==='not-cleared').count,4);
  });
  await test('visitor datasets need separate approval',async()=>{
   assert.equal(has(baseBundle.bytes,'VISITOR-VALUE-MARKER'),false);assert.equal(has(baseBundle.bytes,'VISITOR-UPLOAD-MARKER'),false);
   assert.equal(baseBundle.manifest.exclusions.find(e=>e.category==='visitor-dataset-not-requested').count,2);
   assert.equal(has(visitors.bytes,'VISITOR-VALUE-MARKER'),true);assert.equal(has(visitors.bytes,'VISITOR-UPLOAD-MARKER'),true);
   const doc=JSON.parse(Buffer.from(new Map(reference.unpackEntries(visitors.bytes)).get('data/records/enquiries/enquiry.json')).toString());
   assert.deepEqual(doc.records.map(r=>r.entryId),[U(40)]);assert.equal(doc.recordsSha256,sha(JSON.stringify(doc.records)),'Digest over the stored canonical form');
  });
  await test('tier labelling',async()=>{
   assert.deepEqual(baseBundle.manifest.claims.runnable,['static-site']);
   assert.deepEqual(baseBundle.manifest.frontends.map(f=>[f.id,f.runnable,f.requires.length>0]),[['booking',false,true],['plain',false,true]]);
   const dynamic=await build({html:'<p>x</p><script>fetch("/modules")</script>'});
   assert.deepEqual(dynamic.manifest.claims.runnable,[]);assert.equal(dynamic.manifest.files.some(f=>f.tier==='static'),false);
   for(const html of ['<a href="https://app-x.whumpo.site/">x</a>','<img src="/api/v1/photo">','<form action="/contact">'])assert.deepEqual((await build({html})).manifest.claims.runnable,[],html);
  });
  await test('unavailable-feature report',async()=>{
   const report=baseBundle.manifest.unavailable;
   assert.deepEqual(report.map(e=>e.capability),['access','automation','connectors','contact-inbox','content-collections','content-pages','custom-functions','domains','files','forms','maintainer-ai','notifications','records']);
   for(const e of report){assert.ok(e.used,e.capability);assert.ok(e.customerActions.length>0);}
   assert.deepEqual(report.find(e=>e.capability==='custom-functions').resources,[U(60)]);
   assert.deepEqual(baseBundle.manifest.reconfigure.map(r=>r.capability),['access','connectors','content-pages','domains','forms','notifications']);
  });
  await test('bounds fail closed',async()=>{
   const s=await synthetic();s.programs[0].source='x'.repeat(2*1024*1024+1);s.programs[0].digest=sha(s.programs[0].source);await throwsCode(()=>build({source:s}),'BUNDLE_TOO_LARGE');
   const t=await synthetic();t.records[0].document.next='more';await throwsCode(()=>build({source:t},{visitorData:true}),'BUNDLE_TOO_LARGE');
   const u=await synthetic();u.files[0].complete=false;await throwsCode(()=>build({source:u},{visitorData:true}),'BUNDLE_TOO_LARGE');
   await throwsCode(()=>impl.packEntries(Array.from({length:4097},(_,n)=>[`f${n}`,new Uint8Array()])),'BUNDLE_TOO_LARGE');
   const v=await synthetic();v.instances[0].localId='../x';await throwsCode(()=>build({source:v}),'UNSAFE_PATH');
  });
  return count;
 }
 const checks=await suite(m.portableBundle);
 const file='src/account-lifecycle/portable-bundle.ts',source=readFileSync(file,'utf8');
 const mutants=[
  ['owner not checked',"check(typeof ownerId==='string'&&ownerId.length>0&&source.ownerId===ownerId&&source.project.ownerId===ownerId,'FORBIDDEN','owner');",'','other tenant'],
  ['foreign rows accepted','const owned=(item:{projectId:string}|null|undefined)=>!!item&&item.projectId===projectId;','const owned=(item:{projectId:string}|null|undefined)=>!!item;','other tenant'],
  ['unapproved media exported','return !!p&&p.cleared&&jpeg(p.bytes)','return !!p&&jpeg(p.bytes)','private, unapproved and held'],
  ['staff page served',"if(page.audience!=='public'){exclude('staff-page-not-served');used.add('access');continue;}",'','private, unapproved and held'],
  ['held specification exported',' if(spec.held)exclude(notCleared);\n else{',' if(false)exclude(notCleared);\n else{','private, unapproved and held'],
  ['expired records exported','const retained=doc.records.filter(r=>Date.parse(r.expiresAt)>at&&at-Date.parse(r.createdAt)<set.retentionDays*86400000);','const retained=doc.records;','private, unapproved and held'],
  ['uncleared source exported','if(!program.cleared||program.source===null','if(program.source===null','private, unapproved and held'],
  ['uncleared module files exported',"if(!f.cleared||!jpeg(f.bytes)","if(!jpeg(f.bytes)",'private, unapproved and held'],
  ['withheld photos not counted','exclude(notCleared,source.withheldPhotos);','','hold non-disclosure'],
  ['visitor scope ignored',"   if(!visitorData){exclude('visitor-dataset-not-requested');continue;}\n   for(const set of source.records","   for(const set of source.records",'visitor datasets need separate approval'],
  ['credential keys allowed','if(credentialKey.test(key))return `.${key}`;','','platform secrets and credentials'],
  ['tier scan disabled','return {runnable:list.length===0,requires:list};','return {runnable:true,requires:list};','tier labelling'],
  ['clean frontend left without requirements',"requires:verdict.requires.length?verdict.requires:['whumpo-managed-capability']",'requires:verdict.requires','reader conformance'],
  ['report omits a capability','const report=capabilities.map(capability=>{','const report=capabilities.filter(c=>c!==\'maintainer-ai\').map(capability=>{','reader conformance'],
  ['entries not sorted','const sorted=[...files.entries()].sort(([a],[b])=>byPath(a,b));','const sorted=[...files.entries()];','deterministic bundle'],
  ['archive timestamp not fixed','const DOS_TIME=0,DOS_DATE=0x21','const DOS_TIME=0,DOS_DATE=0x22','deterministic bundle'],
  ['object keys not canonicalised','for(const key of Object.keys(value).sort(byPath))out[key]','for(const key of Object.keys(value))out[key]','reader conformance'],
  ['file bound not enforced',"check(bytes.length<=portableBounds.fileBytes,'BUNDLE_TOO_LARGE',path);",'','bounds fail closed'],
  ['partial records accepted',"check(doc.next===null,'BUNDLE_TOO_LARGE',`records ${instance.localId}/${set.schemaId}`);",'','bounds fail closed'],
 ];
 let killed=0;
 for(const [name,find,replace,killer] of mutants){
  assert.equal(source.split(find).length,2,`composer mutant "${name}" must match exactly once`);
  const plugin={name:'mutant',setup(b){b.onLoad({filter:/portable-bundle\.ts$/},()=>({contents:source.replace(find,()=>replace),loader:'ts'}));}};
  const out=await build({stdin:{contents:`export * from './${file}';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,plugins:[plugin],logLevel:'silent'});
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
  await assert.rejects(suite(mutant),e=>{
   if(process.env.PORTABLE_EXPLAIN==='1')originals.log(`${name} => ${e.message}: ${String(e.cause?.message).split('\n')[0]}`);
   assert.ok(e.message===killer,`composer mutant "${name}" was caught by an unexpected check: ${e.message} (${e.cause?.message})`);return true;
  },`composer mutant survived: ${name}`);killed++;
 }
 return {checks,killed,total:mutants.length};
}
