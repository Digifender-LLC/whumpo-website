import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';

// Schema batch 3b (WH-127 form attachments) over the current schema on disposable in-memory SQLite and, with --d1, actual local D1: the
// module_record_files table, its indexes and three triggers, the loosened module_record_admit (decision D6: a public form never takes
// uploads) and the admission matrix of module_record_file_admit, written as raw statements the way src/shared-modules/records.ts batches
// them. The behaviour through the module engine is tests/form-attachments.mjs. Synthetic rows only.
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results,one=async(sql,...v)=>{const r=await db.prepare(sql).bind(...v).first();return r&&{...r};};
const rejects=(p,re,m)=>assert.rejects(p,re,m);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const digest=()=>(id()+id()).replaceAll('-','').slice(0,64),at=Math.floor(Date.now()/1000),iso=new Date().toISOString();
const sha=c=>c.repeat(64);

async function project(){
 const user=id();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-29')",user,user+'@example.test');
 const p=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Attachments','Synthetic','draft',?,?)",p,user,iso,iso);
 const instance=(resource,local,kind,config,dependencies)=>run("INSERT INTO module_instances(id,project_id,local_id,kind,module_digest,schema_digest,config_json,config_digest,descriptor_json,descriptor_digest,dependencies_json,config_revision,source_version_id,source_spec_digest,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,'{}',?,?,1,?,?,?,?)",
  resource,p,local,kind,sha('a'),sha('b'),JSON.stringify(config),sha('c'),sha('d'),JSON.stringify(dependencies),id(),sha('e'),at,at);
 const access=id(),files=id(),records=id();
 const collection={id:'mine',read:'submitter',upload:['visitor'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:null};
 await instance(access,'members','access',{roles:['staff'],enrollment:'invitation'},[]);
 await instance(files,'media','files',{collections:[collection,{...collection,id:'other'},{...collection,id:'library',read:'owner',upload:['owner']}]},[access]);
 // `public-photo` can never pass the specification validator; it is written directly to prove the schema refuses it on its own (D6).
 await instance(records,'requests','records',{retentionDays:30,schemas:[{id:'request',fieldsRevision:1,fields:[],staffWrite:[]}],
  forms:[{id:'photo-form',recordId:'request',submit:'visitor',uploadCollectionId:'mine'},{id:'plain-form',recordId:'request',submit:'visitor',uploadCollectionId:null},{id:'public-photo',recordId:'request',submit:'public',uploadCollectionId:'mine'}],views:[]},[access,files]);
 for(const resource of [access,files,records])await run("INSERT INTO module_activations(instance_id,state,revision,review_id,descriptor_digest,config_revision,updated_at) VALUES(?,'active',1,?,?,1,?)",resource,id(),sha('d'),at);
 const visitor=async()=>{const v=id();await run("INSERT INTO app_visitors(id,project_id,access_id) VALUES(?,?,?)",v,p,access);return v;};
 return {user,p,access,files,records,visitor};
}
const upload=async(o,visitor,{collection='mine',files=o.files}={})=>{
 const file=id(),key=`photos/${o.p}/${file}.jpg`;
 await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at,handoff_json) VALUES(?,?,'Visitor upload',?,?,10,1,1,'ready',?,'null')",file,o.p,key,digest(),iso);
 await run("INSERT INTO module_files(file_id,instance_id,project_id,collection_id,uploader_kind,visitor_id,request_id,created_at) VALUES(?,?,?,?,'visitor',?,?,?)",file,files,o.p,collection,visitor,id(),at);
 return file;
};
const recordSQL="INSERT INTO module_records(id,instance_id,project_id,schema_id,form_id,fields_revision,submitter_kind,visitor_id,values_json,revision,created_request_id,last_request_id,created_at,updated_at,expires_at) VALUES(?,?,?,'request',?,1,?,?,'{}',1,?,?,unixepoch(),unixepoch(),unixepoch()+2592000)";
const record=(o,visitor,{form='photo-form',kind='visitor',request=id(),entry=id()}={})=>({entry,request,statement:db.prepare(recordSQL).bind(entry,o.records,o.p,form,kind,kind==='public'?null:visitor,request,request)});
const link=(o,{entry,request},file)=>db.prepare('INSERT INTO module_record_files(entry_id,file_id,instance_id,project_id,request_id) VALUES(?,?,?,?,?)').bind(entry,file,o.records,o.p,request);
const submit=(o,visitor,files,opts)=>{const r=record(o,visitor,opts);return db.batch([r.statement,...files.map(f=>link(o,r,f))]).then(()=>r.entry);};
const count=(table,where='1=1',...v)=>one(`SELECT count(*) n FROM ${table} WHERE ${where}`,...v).then(r=>r.n);

// Visitor enrolment needs a reviewed activation (module_activation_reviews, written only by the Chat controls); this suite seeds visitors directly,
// so that one admission trigger is off for the seed and restored in finally. Every trigger under test stays on.
const enrol=await one("SELECT sql FROM sqlite_master WHERE name='app_visitor_admit'");await run('DROP TRIGGER app_visitor_admit');
try{
 await check('the table, its indexes and triggers exist; module_record_admit loses its upload refusal',async()=>{
  const o=await project(),v1=await o.visitor(),v2=await o.visitor();
  const names=(await all("SELECT type,name FROM sqlite_master WHERE name LIKE 'module\\_record\\_file%' ESCAPE '\\' ORDER BY type,name")).map(r=>r.type+':'+r.name);
  assert.deepEqual(names,['index:module_record_files_instance','index:module_record_files_project',
   'table:module_record_files','trigger:module_record_file_admit','trigger:module_record_file_immutable','trigger:module_record_files_removed']);
  const fks=await all("SELECT \"from\",\"table\",on_delete FROM pragma_foreign_key_list('module_record_files') ORDER BY \"from\"");
  assert.deepEqual(fks.map(r=>[r.from,r.table,r.on_delete]),[['entry_id','module_records','CASCADE'],['file_id','module_files','CASCADE'],['instance_id','module_instances','CASCADE'],['project_id','projects','CASCADE']]);
  assert.deepEqual((await all("SELECT name FROM pragma_table_info('module_record_files') ORDER BY cid")).map(r=>r.name),['entry_id','file_id','instance_id','project_id','request_id']);
 });
 await check('own recent uploads attach with the record in one batch (one to four)',async()=>{
  const o=await project(),v1=await o.visitor(),v2=await o.visitor();
  const files=[await upload(o,v1),await upload(o,v1),await upload(o,v1),await upload(o,v1)];
  const entry=await submit(o,v1,files);
  assert.deepEqual((await all('SELECT file_id FROM module_record_files WHERE entry_id=? ORDER BY file_id',entry)).map(r=>r.file_id),[...files].sort());
  const plain=await submit(o,v1,[await upload(o,v1)],{});assert.ok(plain);
  await submit(o,v1,[],{form:'photo-form'});await submit(o,v1,[],{form:'plain-form'});
 });
 await check('a fifth attachment is refused, and the whole batch rolls back',async()=>{
  const o=await project(),v1=await o.visitor(),v2=await o.visitor();
  const files=[];for(let i=0;i<4;i++)files.push(await upload(o,v1));
  const r=record(o,v1);await db.batch([r.statement,...files.map(f=>link(o,r,f))]);
  const fifth=await upload(o,v1);
  await rejects(run('INSERT INTO module_record_files(entry_id,file_id,instance_id,project_id,request_id) VALUES(?,?,?,?,?)',r.entry,fifth,o.records,o.p,r.request),/module_request_limited/);
  const sixBatch=record(o,v1),six=[];for(let i=0;i<5;i++)six.push(await upload(o,v1));
  await rejects(db.batch([sixBatch.statement,...six.map(f=>link(o,sixBatch,f))]),/module_request_limited/);
  assert.equal(await count('module_records','id=?',sixBatch.entry),0);assert.equal(await count('module_record_files','entry_id=?',sixBatch.entry),0);
 });
 await check('a foreign file is refused: another visitor, another project, the wrong collection, an owner row, an unattached or a mutated record',async()=>{
  const o=await project(),v1=await o.visitor(),v2=await o.visitor();
  const other=await project(),theirs=await upload(o,v2),elsewhere=await upload(other,await other.visitor()),wrong=await upload(o,v1,{collection:'other'}),mine=await upload(o,v1);
  for(const file of [theirs,elsewhere,wrong])await rejects(submit(o,v1,[file]),/module_request_forbidden/,file);
  await rejects(submit(o,v1,[id()]),/module_request_forbidden/,'unknown file');
  await rejects(submit(o,v1,[mine],{form:'plain-form'}),/module_request_forbidden/,'a form without an upload collection');
  await rejects(submit(o,v1,[mine],{kind:'staff'}),/module_request_forbidden|module_request_unavailable|CHECK/,'submitter kind must match the upload');
  // An owner-filed photo (no visitor) is not a submitter upload.
  const ownerFile=id();await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at,handoff_json) VALUES(?,?,'Owner photo',?,?,10,1,1,'ready',?,'null')",ownerFile,o.p,`photos/${o.p}/${ownerFile}.jpg`,digest(),iso);
  await run("INSERT INTO module_files(file_id,instance_id,project_id,collection_id,uploader_kind,visitor_id,request_id,created_at) VALUES(?,?,?,'library','owner',NULL,?,?)",ownerFile,o.files,o.p,id(),at);
  await rejects(submit(o,v1,[ownerFile]),/module_request_forbidden/,'owner photo');
  // Only the new record of this request: a later link to an old record, or with another request id, is refused.
  const entry=await submit(o,v1,[mine]),late=await upload(o,v1);
  await rejects(run('INSERT INTO module_record_files(entry_id,file_id,instance_id,project_id,request_id) VALUES(?,?,?,?,?)',entry,late,o.records,o.p,id()),/module_request_forbidden/);
  const stored=await one('SELECT created_request_id r FROM module_records WHERE id=?',entry);
  await run('UPDATE module_records SET revision=2,last_request_id=?,updated_at=unixepoch() WHERE id=?',id(),entry);
  await rejects(run('INSERT INTO module_record_files(entry_id,file_id,instance_id,project_id,request_id) VALUES(?,?,?,?,?)',entry,late,o.records,o.p,stored.r),/module_request_forbidden/,'only revision 1');
  await rejects(submit(o,v1,[mine]),/UNIQUE|PRIMARY/,'an upload attaches once');
 });
 await check('a file written more than 60 seconds ago is refused',async()=>{
  const o=await project(),v1=await o.visitor(),v2=await o.visitor();
  const old=await upload(o,v1),trigger=await one("SELECT sql FROM sqlite_master WHERE name='module_file_immutable'");
  await run('DROP TRIGGER module_file_immutable');
  try{await run('UPDATE module_files SET created_at=unixepoch()-61 WHERE file_id=?',old);}finally{await run(trigger.sql);}
  await rejects(submit(o,v1,[old]),/module_request_stale/);
  const fresh=await upload(o,v1);await submit(o,v1,[fresh]);
 });
 await check('a public form never takes uploads (D6), and ordinary forms still admit records',async()=>{
  const o=await project(),v1=await o.visitor(),v2=await o.visitor();
  await rejects(run(recordSQL,id(),o.records,o.p,'public-photo','public',null,id(),id()),/module_request_unavailable/);
  await rejects(db.prepare(recordSQL).bind(id(),o.records,o.p,'public-photo','visitor',v1,sha('1').slice(0,36),sha('1').slice(0,36)).run(),/module_request_unavailable/,'whoever submits');
  assert.ok(await submit(o,v1,[],{form:'plain-form'}));
 });
 await check('links are immutable; deleting an attached upload removes only its link; deleting the record deletes the photos',async()=>{
  const o=await project(),v1=await o.visitor(),v2=await o.visitor();
  const files=[await upload(o,v1),await upload(o,v1)],entry=await submit(o,v1,files);
  await rejects(run('UPDATE module_record_files SET request_id=? WHERE entry_id=?',id(),entry),/module_request_immutable/);
  await run('DELETE FROM project_files WHERE id=?',files[0]);
  assert.deepEqual((await all('SELECT file_id FROM module_record_files WHERE entry_id=?',entry)).map(r=>r.file_id),[files[1]]);assert.equal(await count('module_records','id=?',entry),1);
  await run('DELETE FROM module_records WHERE id=?',entry);
  assert.equal(await count('module_record_files','entry_id=?',entry),0);assert.equal(await count('project_files','id=?',files[1]),0);assert.equal(await count('module_files','file_id=?',files[1]),0);
  assert.equal(await count('file_cleanup','object_key=?',`photos/${o.p}/${files[1]}.jpg`),1,'the object is queued for cleanup');
  // Unattached uploads are untouched by a record delete.
  const kept=await upload(o,v1);await run('DELETE FROM module_records WHERE id=?',await submit(o,v1,[],{}));assert.equal(await count('project_files','id=?',kept),1);
 });
 await check('a safety hold refuses the record delete and keeps its photos; erasing the visitor or the project removes everything',async()=>{
  const o=await project(),v1=await o.visitor(),v2=await o.visitor();
  const v=await o.visitor(),file=await upload(o,v),entry=await submit(o,v,[file]);
  const held=await project(),hv=await held.visitor(),hfile=await upload(held,hv),hentry=await submit(held,hv,[hfile]);
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES('case-wh127-att',?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",held.user);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-wh127-att','case-wh127-att',?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",held.user,held.p);
  await rejects(run('DELETE FROM module_records WHERE id=?',hentry),/safety_preservation_hold|safety_hold/);
  assert.equal(await count('project_files','id=?',hfile),1);assert.equal(await count('module_record_files','entry_id=?',hentry),1);assert.equal(await count('module_records','id=?',hentry),1);
  await run('DELETE FROM app_visitors WHERE id=?',v);
  assert.equal(await count('module_records','id=?',entry),0);assert.equal(await count('project_files','id=?',file),0);assert.equal(await count('module_record_files','entry_id=?',entry),0);
  await run('DELETE FROM projects WHERE id=?',o.p);
  for(const t of ['module_records','module_files','module_record_files','project_files'])assert.equal(await count(t,'project_id=?',o.p),0,t);
 });
 console.log(`Schema batch 3b: ${cases} cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; module_record_files, its admission matrix (own, recent, same collection, dependency files instance, four at most), the public-form refusal (D6), immutability, and removal of attached photos with the record. No provider call.`);
}finally{await run(enrol.sql);await fixture.close();}
