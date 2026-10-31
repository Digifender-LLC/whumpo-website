import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
// WH-127 form attachments (schema batch 3b): a records form with an upload collection takes up to four of the submitter's own
// recent uploads in the same atomic batch as the record. Actual handlers (visitor gateway /modules/upload and /modules, the
// module engine, records and files handlers, module_record_file_admit, the removal trigger, the owner export) run against the
// complete current schema on disposable SQLite with an in-memory bucket, or local D1 and R2 with --d1. Synthetic data only.
const d1=process.argv.includes('--d1');
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(d1?{d1:true,r2:true}:{}),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network or inference is available');};
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
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-form-attachments-');
// Distinct bytes per image: the same cleaned digest may not be stored twice by one project, so every upload differs.
execFileSync('python3',['-c',"from PIL import Image; import sys\nfor i in range(24): Image.new('RGB',(32+i,24),(80+i*20,120,60)).save(sys.argv[1]+'/%d.jpg'%i)",dir]);
const jpegs=[];for(let i=0;i<24;i++)jpegs.push(new Uint8Array(await readFile(`${dir}/${i}.jpg`)));await rm(dir,{recursive:true,force:true});
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const {appAuth:auth,appGateway}=m;
const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:{fetch:async()=>Response.json({ok:true,value:{state:{},result:{}}})},FILES};
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const accessInstance={id:'members',kind:'access',...pins('access'),dependencies:[],config:{roles:['staff'],enrollment:'invitation'}};
const collection=(id,read,upload,gallery)=>({id,read,upload,maxBytes:1048576,mediaTypes:['image/jpeg'],gallery});
const filesInstance={id:'media',kind:'files',...pins('files'),dependencies:['members'],config:{collections:[collection('mine','submitter',['visitor'],{audience:'visitor'}),collection('other','submitter',['visitor'],null)]}};
const fields=[{key:'name',label:'Name',type:'text',optional:false,read:'owner'}];
const recordsInstance={id:'requests',kind:'records',...pins('records'),dependencies:['members','media'],config:{retentionDays:30,
 schemas:[{id:'request',fieldsRevision:1,fields,staffWrite:[]}],
 forms:[{id:'plain-form',recordId:'request',submit:'visitor',uploadCollectionId:null},{id:'photo-form',recordId:'request',submit:'visitor',uploadCollectionId:'mine'},{id:'public-form',recordId:'request',submit:'public',uploadCollectionId:null}],views:[]}};
const hex=async bytes=>Buffer.from(await crypto.subtle.digest('SHA-256',bytes)).toString('hex');
const b64=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const envelope=(resource,operation,{target=null,input=null,requestId}={})=>({api:'whumpo-modules',version:1,operation,resourceId:resource.id,configRevision:resource.config_revision,requestId:requestId??(m.modulePolicy.moduleOperations[operation].write?id():null),target,input});

async function owner(){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,'Photos '+id().slice(0,6),'Repair photos');
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic form attachments fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,feature,operation);
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
const instance=(o,localId)=>row('SELECT i.*,a.state FROM module_instances i JOIN module_activations a ON a.instance_id=i.id WHERE i.project_id=? AND i.local_id=?',o.project,localId);
async function gateway(o,payload,v){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.41','content-type':'application/json',origin:o.host,cookie:v?.cookie??''},body:JSON.stringify(payload)}),env);
 return {status:response.status,body:await response.json()};
}
async function upload(o,v,bytes,collectionId='mine'){
 const payload=envelope(o.media,'files.putBytes',{target:{collectionId},input:{mediaType:'image/jpeg',byteLength:bytes.length,sha256:await hex(bytes)}});
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules/upload',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.40','content-type':'image/jpeg',origin:o.host,cookie:v.cookie,'whumpo-module-request':b64(payload)},body:bytes}),env);
 const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));return body.result.fileId;
}
async function ownerCall(o,payload){
 const response=await m.worker.fetch(new Request(`https://whumpo.com/api/projects/${o.project}/modules`,{method:'POST',headers:{cookie:`__Host-whumpo_session=${o.token}`,origin:'https://whumpo.com','content-type':'application/json'},body:JSON.stringify(payload)}),{...(fixture.env??{}),...env},{waitUntil(){}});
 return {status:response.status,body:await response.json()};
}
const submit=(records,form,attachments,values={name:'Synthetic name'},requestId)=>envelope(records,'forms.submit',{target:{formId:form},input:{values,...(attachments?{attachments}:{})},requestId});
const links=entry=>rows('SELECT file_id FROM module_record_files WHERE entry_id=? ORDER BY file_id',entry).then(r=>r.map(x=>x.file_id));
const code=r=>r.body.code;

try{
 const a=await owner(),b=await owner();
 for(const o of [a,b]){await configureFixtureModules(o.scope,o.user,o.project,[accessInstance,filesInstance,recordsInstance]);await activation(o,'members');await activation(o,'media');await activation(o,'requests');}
 a.media=await instance(a,'media');b.media=await instance(b,'media');
 const records=await instance(a,'requests'),theirs=await instance(b,'requests');
 const v1=await visitor(a),v2=await visitor(a),bv=await visitor(b);
 let n=0;const next=()=>jpegs[n++];
 let entry,files;

 await check('a visitor attaches their own recent uploads; the record, event and links commit together',async()=>{
  files=[await upload(a,v1,next()),await upload(a,v1,next())];
  const sent=await gateway(a,submit(records,'photo-form',files),v1);assert.equal(sent.status,200,JSON.stringify(sent.body));
  entry=sent.body.result.entryId;
  assert.deepEqual(await links(entry),[...files].sort());
  const l=await row('SELECT * FROM module_record_files WHERE file_id=?',files[0]);
  assert.equal(l.instance_id,records.id);assert.equal(l.project_id,a.project);assert.equal(l.request_id,sent.body.requestId);
  assert.equal((await row("SELECT count(*) n FROM module_record_events WHERE entry_id=? AND event='form.accepted'",entry)).n,1);
  assert.equal(code(await gateway(a,submit(records,'photo-form',[files[0]]),v1)),'request_conflict','An upload attaches to one record only');
 });

 await check('a lost reply replays the saved receipt: one record, the same links',async()=>{
  const fresh=await upload(a,v1,next()),request=submit(records,'photo-form',[fresh]);
  const first=await gateway(a,request,v1),again=await gateway(a,request,v1);
  assert.equal(again.body.receipt.replayed,true);assert.equal(again.body.result.entryId,first.body.result.entryId);
  assert.deepEqual(await links(first.body.result.entryId),[fresh]);
  assert.equal((await row('SELECT count(*) n FROM module_records WHERE created_request_id=?',request.requestId)).n,1);
  // A resend that changes the attachments is a conflict, never a second record.
  assert.equal((await gateway(a,{...request,input:{...request.input,attachments:[]}},v1)).body.code,'request_conflict');
 });

 await check('a foreign file is refused: another visitor, another project, an owner-less or wrong collection',async()=>{
  const x=await upload(a,v2,next()),y=await upload(b,bv,next()),z=await upload(a,v1,next(),'other');
  for(const f of [x,y,z]){
   const sent=await gateway(a,submit(records,'photo-form',[f]),v1);assert.equal(sent.body.code,'forbidden',f);
  }
  assert.equal((await row('SELECT count(*) n FROM module_record_files WHERE file_id IN (?,?,?)',x,y,z)).n,0);
  assert.equal((await gateway(a,submit(records,'photo-form',[id()]),v1)).body.code,'forbidden','An unknown file id');
  // A refused attachment aborts the whole batch: no record, no event.
  assert.equal((await row("SELECT count(*) n FROM module_records WHERE project_id=? AND values_json LIKE '%refused-batch%'",a.project)).n,0);
  const rejected=await gateway(a,submit(records,'photo-form',[x],{name:'refused-batch'}),v1);assert.equal(rejected.status,403);
  assert.equal((await row("SELECT count(*) n FROM module_records WHERE values_json LIKE '%refused-batch%'")).n,0);
 });

 await check('a file written more than 60 seconds ago is refused',async()=>{
  const old=await upload(a,v1,next()),trigger=await row("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='module_file_immutable'");
  await run('DROP TRIGGER module_file_immutable');
  try{await run('UPDATE module_files SET created_at=unixepoch()-120 WHERE file_id=?',old);}finally{await run(trigger.sql);}
  const sent=await gateway(a,submit(records,'photo-form',[old]),v1);assert.equal(code(sent),'stale_configuration');
  assert.equal((await row('SELECT count(*) n FROM module_record_files WHERE file_id=?',old)).n,0);
 });

 await check('a fifth attachment is refused by the handler and, past four, by the trigger',async()=>{
  const v=await visitor(a),five=[];for(let i=0;i<5;i++)five.push(await upload(a,v,next()));
  assert.equal(code(await gateway(a,submit(records,'photo-form',five),v)),'invalid_request');
  const sent=await gateway(a,submit(records,'photo-form',five.slice(0,4)),v);assert.equal(sent.status,200,JSON.stringify(sent.body));
  assert.equal((await links(sent.body.result.entryId)).length,4);
  await assert.rejects(()=>run('INSERT INTO module_record_files(entry_id,file_id,instance_id,project_id,request_id) VALUES(?,?,?,?,?)',sent.body.result.entryId,five[4],records.id,a.project,sent.body.requestId),/module_request_limited/);
 });

 await check('attachments need a form with an upload collection, distinct ids, and never ride a public form',async()=>{
  const f=await upload(a,v1,next());
  assert.equal(code(await gateway(a,submit(records,'plain-form',[f]),v1)),'invalid_request','Form without an upload collection');
  assert.equal(code(await gateway(a,submit(records,'photo-form',[f,f]),v1)),'invalid_request','Duplicate ids');
  assert.equal(code(await gateway(a,submit(records,'photo-form',['not-an-id']),v1)),'invalid_request');
  assert.equal(code(await gateway(a,submit(records,'photo-form',{0:f}),v1)),'invalid_request','Not an array');
  assert.equal((await gateway(a,submit(records,'photo-form',[]),v1)).status,200,'An empty list is a plain submission');
  assert.equal(code(await gateway(a,submit(records,'public-form',[f]),v1)),'invalid_request');
  // D6 in the schema itself: a public form that somehow has an upload collection admits no record at all.
  const cfg=JSON.parse(records.config_json);cfg.forms.push({id:'public-photo',recordId:'request',submit:'public',uploadCollectionId:'mine'});
  const insert=(form,rid=id())=>run("INSERT INTO module_records(id,instance_id,project_id,schema_id,form_id,fields_revision,submitter_kind,visitor_id,values_json,revision,created_request_id,last_request_id,created_at,updated_at,expires_at) VALUES(?,?,?,'request',?,1,'visitor',?,'{\"name\":\"raw\"}',1,?,?,unixepoch(),unixepoch(),unixepoch()+86400*30)",id(),records.id,a.project,form,v1.visitorId,rid,rid);
  await run('UPDATE module_instances SET config_json=? WHERE id=?',JSON.stringify(cfg),records.id);
  try{
   await assert.rejects(()=>insert('public-photo'),/module_request_unavailable/);
   await insert('photo-form');
  }finally{await run('UPDATE module_instances SET config_json=? WHERE id=?',records.config_json,records.id);}
 });

 await check('the export lists attachment ids and validates them',async()=>{
  const {exportRecords,validateRecordsExport}=m.moduleRecordsExport,current=await instance(a,'requests');
  const out=await exportRecords(a.scope,a.user,a.project,current.id,current.config_revision,{recordId:'request'});
  assert.deepEqual(out.records.find(r=>r.entryId===entry).attachments,[...files].sort());
  assert.ok(out.records.some(r=>r.attachments.length===0));
  await validateRecordsExport(JSON.parse(JSON.stringify(out)));
  const bad=JSON.parse(JSON.stringify(out));bad.records.find(r=>r.entryId===entry).attachments.push('x');
  await assert.rejects(()=>validateRecordsExport(bad),e=>e.code==='invalid_request');
  const stripped=JSON.parse(JSON.stringify(out));delete stripped.records[0].attachments;
  await assert.rejects(()=>validateRecordsExport(stripped),e=>e.code==='invalid_request');
 });

 await check('removing the record deletes its links and attached photos; an unattached upload stays',async()=>{
  const kept=await upload(a,v1,next());
  const removed=await ownerCall(a,envelope(records,'records.remove',{target:{recordId:'request',entryId:entry}}));assert.equal(removed.status,200,JSON.stringify(removed.body));
  assert.deepEqual(await links(entry),[]);
  for(const f of files){
   assert.equal(await row('SELECT 1 x FROM project_files WHERE id=?',f),null);assert.equal(await row('SELECT 1 x FROM module_files WHERE file_id=?',f),null);
   assert.ok(await row("SELECT 1 x FROM file_cleanup WHERE object_key=?",`photos/${a.project}/${f}.jpg`),'The object is queued for cleanup');
  }
  assert.ok(await row('SELECT 1 x FROM project_files WHERE id=?',kept));
 });

 await check('an erased visitor takes their records and attached photos with them',async()=>{
  const v=await visitor(a),f=await upload(a,v,next()),sent=await gateway(a,submit(records,'photo-form',[f]),v);assert.equal(sent.status,200,JSON.stringify(sent.body));
  await run('DELETE FROM app_visitors WHERE id=?',v.visitorId);
  assert.equal(await row('SELECT 1 x FROM module_records WHERE id=?',sent.body.result.entryId),null);
  assert.equal(await row('SELECT 1 x FROM project_files WHERE id=?',f),null);
  assert.deepEqual(await links(sent.body.result.entryId),[]);
 });

 await check('an object-scope hold freezes one record and never stops another tenant\'s expiry or the receipt prune',async()=>{
  const va=await visitor(a),fa=await upload(a,va,next()),sa=await gateway(a,submit(records,'photo-form',[fa]),va);assert.equal(sa.status,200,JSON.stringify(sa.body));
  const vb=await visitor(b);b.media=await instance(b,'media');const fb=await upload(b,vb,next()),sb=await gateway(b,submit(theirs,'photo-form',[fb]),vb);assert.equal(sb.status,200,JSON.stringify(sb.body));
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES('case-obj',?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",a.user);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,file_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-obj','case-obj',?,'object',?,?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",a.user,a.project,fa);
  // The held record cannot be overwritten or cleared by the owner (handler message) or by any SQL update (trigger); an unheld record of the same tenant can.
  const before=(await row('SELECT values_json,revision FROM module_records WHERE id=?',sa.body.result.entryId));
  for(const changes of [{name:'overwritten'},{name:null}]){
   const refused=await ownerCall(a,envelope(records,'records.update',{target:{recordId:'request',entryId:sa.body.result.entryId,revision:before.revision,changes}}));
   assert.equal(code(refused),'unavailable');assert.match(refused.body.error,/safety review is open/);
  }
  await assert.rejects(()=>run("UPDATE module_records SET values_json='{}',revision=revision+1,last_request_id=? WHERE id=?",'9'.repeat(36),sa.body.result.entryId),/safety_preservation_hold/);
  assert.deepEqual(await row('SELECT values_json,revision FROM module_records WHERE id=?',sa.body.result.entryId),before);
  // Age both records and one receipt past their windows (test-only clock substitute: the immutability triggers are lifted and restored).
  const lifted=await rows("SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN ('module_record_update','safety_hold_module_record_frozen','module_request_receipt_immutable')");
  for(const t of lifted)await run('DROP TRIGGER '+t.name);
  try{
   await run('UPDATE module_records SET created_at=unixepoch()-40*86400,updated_at=unixepoch()-40*86400,expires_at=unixepoch()-86400 WHERE id IN (?,?)',sa.body.result.entryId,sb.body.result.entryId);
   await run("UPDATE module_request_receipts SET created_at=unixepoch()-40*86400 WHERE instance_id=? AND request_id=?",theirs.id,sb.body.requestId);
  }finally{for(const t of lifted)await run(t.sql);}
  const {cleanupModuleRecords,cleanupModuleRequestReceipts}=m.sharedModuleRecords&&{...m.sharedModuleRecords,...m.sharedModules};
  await cleanupModuleRecords(db);await cleanupModuleRequestReceipts(db);
  assert.ok(await row('SELECT 1 x FROM module_records WHERE id=?',sa.body.result.entryId),'The held record stays');
  assert.ok(await row('SELECT 1 x FROM project_files WHERE id=?',fa),'The held file stays');
  assert.equal(await row('SELECT 1 x FROM module_records WHERE id=?',sb.body.result.entryId),null,'Another tenant\'s expired record is removed');
  assert.equal(await row('SELECT 1 x FROM project_files WHERE id=?',fb),null);
  assert.equal(await row('SELECT 1 x FROM module_request_receipts WHERE instance_id=? AND request_id=?',theirs.id,sb.body.requestId),null,'The receipt prune ran');
  await run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id='hold-obj'");
  await cleanupModuleRecords(db);assert.equal(await row('SELECT 1 x FROM module_records WHERE id=?',sa.body.result.entryId),null,'Expiry resumes after release');
 });

 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 process.stdout.write(`Form attachments passed: ${cases} groups on ${d1?'local D1':'SQLite'} — own recent uploads attached atomically with the record, lost-reply replay, foreign/stale/over-cap/public refusals, export, and removal of attached photos with the record.\n`);
}catch(error){originals.error(String(error.stack||error));process.exitCode=1;}
finally{for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;await fixture.close();}
