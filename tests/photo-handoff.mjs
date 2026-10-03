// Real current handlers, local D1 and private R2. No scanner or inference.
import assert from 'node:assert/strict';
Error.stackTraceLimit=0;
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {databaseFixture} from './helpers/current-database.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const modules=await currentFixtureModules(['src/files.ts','src/chat-interactions/store.ts','src/photo-upload-shape.ts']);
const files=await modules.module('src/files.ts'),forms=await modules.module('src/chat-interactions/store.ts'),shape=await modules.module('src/photo-upload-shape.ts');
const fixture=await databaseFixture({d1:true,r2:true}),{db,env}=fixture,dir=await mkdtemp('/tmp/whumpo-photo-handoff-');
execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(80,120,60)).save(sys.argv[1])",dir+'/photo.jpg']);
const bytes=await readFile(dir+'/photo.jpg'),id=()=>crypto.randomUUID(),run=(q,...v)=>db.prepare(q).bind(...v).run(),row=(q,...v)=>db.prepare(q).bind(...v).first();let cases=0;
async function test(name,fn){try{await fn();cases++;}catch(e){console.error(name);throw e;}}
async function owner(){
 const a=await workspaceFixture(db,modules.identity),user=a.account,project=id(),scope=await a.scope();
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Synthetic','draft',datetime('now'),datetime('now'))",project,user);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic photo handoff',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,project);
 return {...a,user,project,scope,env:{...env,DB:scope}};
}
async function handoff(o){
 const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Add a photo','Private uploader',datetime('now'),'ai','completed' FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
 const plan=await forms.preparePhotoIntake(o.scope,o.user,{originTurnId:turn,projectId:o.project});await o.scope.batch(plan.statements);
 const f=await forms.readInteraction(o.scope,o.user,plan.interactionId);return {interactionId:f.envelope.id,definitionDigest:f.envelope.definitionDigest};
}
const request=(h)=>new Request('https://whumpo.com/api/test',{method:'PUT',headers:{'content-type':'image/jpeg','x-photo-name':'Private garden','x-whumpo-photo-handoff':typeof h==='string'?h:JSON.stringify(h)},body:bytes});
const upload=(o,h,file=id(),e=o.env)=>files.uploadPhoto(request(h),e,o.user,o.project,file);
const cancel=(o,h)=>forms.mutateInteraction(o.scope,o.user,{version:1,requestId:id(),...h,expectedAnswerRevision:0,operation:'cancel'});
const revoke=o=>run("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?",o.user);
try{
 await test('current strict header and exact metadata readback',async()=>{
  const o=await owner(),h=await handoff(o),file=id();await upload(o,h,file);
  const status=await files.readPhotoUpload(o.scope,o.user,o.project,file);assert.deepEqual(status.photo.handoff,h);assert(shape.readPhotoUploadStatus(status));assert.equal(status.photo.safetyStatus,'pending');assert(!JSON.stringify(status).includes('object_key'));
  await assert.rejects(()=>files.readPhoto(o.env,o.user,file),{status:423});
  for(const invalid of ['{}','[]','{"interactionId":"bad"}',JSON.stringify({...h,url:'https://example.invalid'}),JSON.stringify({...h,definitionDigest:'bad'})])await assert.rejects(()=>upload(o,invalid),{status:400});
  const absent=request(h);absent.headers.delete('x-whumpo-photo-handoff');await assert.rejects(()=>files.uploadPhoto(absent,o.env,o.user,o.project,id()),{status:400});
  assert.equal((await row('SELECT count(*) n FROM project_files WHERE project_id=?',o.project)).n,1);
  await assert.rejects(()=>run("UPDATE project_files SET handoff_json='null' WHERE id=?",file),/file_immutable/);
  await assert.rejects(()=>upload(o,null,file),{status:409});const otherHandoff=await handoff(o);await assert.rejects(()=>upload(o,otherHandoff,file),{status:409});
 });
 await test('foreign, wrong project, changed digest and dismissed handoffs dispatch no storage',async()=>{
  const o=await owner(),other=await owner(),h=await handoff(o),foreign=await handoff(other),before=(await env.FILES.list()).objects.length;
  for(const invalid of [foreign,{...h,definitionDigest:'b'.repeat(64)}])await assert.rejects(()=>upload(o,invalid),{status:409});
  await assert.rejects(()=>upload(other,h),{status:409});await cancel(o,h);await assert.rejects(()=>upload(o,h),{status:409});assert.equal((await env.FILES.list()).objects.length,before);
 });
 await test('unreserved direct upload cannot be rebound to a Chat handoff',async()=>{const o=await owner(),file=id();await upload(o,null,file);const otherHandoff=await handoff(o);await assert.rejects(()=>upload(o,otherHandoff,file),{status:409});assert.equal((await files.readPhotoUpload(o.scope,o.user,o.project,file)).photo.handoff,null);});
 await test('lost R2 acknowledgement resumes original reservation after handoff dismissal',async()=>{
  const o=await owner(),h=await handoff(o),file=id();let puts=0;
  const lossy=new Proxy(env.FILES,{get(target,key){if(key==='put')return async(...args)=>{puts++;await target.put(...args);throw Error('Synthetic lost acknowledgement');};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
  await assert.rejects(()=>upload(o,h,file,{...o.env,FILES:lossy}),{status:503});assert.equal((await files.readPhotoUpload(o.scope,o.user,o.project,file)).photo.status,'pending');
  await cancel(o,h);assert.equal((await upload(o,h,file)).status,'ready');assert.equal(puts,1);assert.deepEqual((await files.readPhotoUpload(o.scope,o.user,o.project,file)).photo.handoff,h);
  assert.equal((await row("SELECT count(*) n FROM activity_events WHERE id=?",'file:'+file)).n,1);await assert.rejects(()=>upload(o,h),{status:409});
 });
 for(const change of ['dismiss','revoke','transfer'])await test('late '+change+' refuses the new reservation atomically',async()=>{
  const o=await owner(),other=await owner(),h=await handoff(o),file=id();let fired=false,puts=0;
  const intercepted=interceptDatabase(db,/^INSERT INTO project_files\(/,async()=>{if(fired)return;fired=true;if(change==='dismiss')await cancel(o,h);if(change==='revoke')await revoke(o);if(change==='transfer')await run('UPDATE projects SET owner_user_id=? WHERE id=?',other.user,o.project);});const changed=await modules.identity.admitWorkspace(intercepted,await modules.identity.resolveIdentity(intercepted,{version:1,client:'web',kind:'session',token:o.token}));
  const bucket=new Proxy(env.FILES,{get(target,key){if(key==='put')return async(...args)=>{puts++;return target.put(...args);};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
  await assert.rejects(()=>upload(o,h,file,{...o.env,DB:changed,FILES:bucket}),{status:409});assert.equal(puts,0);assert.equal(await row('SELECT id FROM project_files WHERE id=?',file),null);
 });
 await test('permission loss after bytes arrive preserves unconfirmed recovery without marking ready',async()=>{
  const o=await owner(),h=await handoff(o),file=id();const bucket=new Proxy(env.FILES,{get(target,key){if(key==='put')return async(...args)=>{const result=await target.put(...args);await revoke(o);return result;};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
  await assert.rejects(()=>upload(o,h,file,{...o.env,FILES:bucket}),{status:503});assert.equal((await files.readPhotoUpload(o.scope,o.user,o.project,file)).photo.status,'pending');await assert.rejects(()=>upload(o,h,file),{status:403});assert.equal((await row("SELECT count(*) n FROM activity_events WHERE id=?",'file:'+file)).n,0);
 });
 await test('closed unreserved handoff proves a late upload cannot begin',async()=>{const o=await owner(),h=await handoff(o),file=id();assert.equal((await files.readPhotoUpload(o.scope,o.user,o.project,file,h)).closedHandoff,null);await cancel(o,h);const read=await files.readPhotoUpload(o.scope,o.user,o.project,file,h);assert.equal(read.photo,null);assert.deepEqual(read.closedHandoff,h);assert(shape.readPhotoUploadStatus(read));await assert.rejects(()=>upload(o,h,file),{status:409});assert.equal((await files.readPhotoUpload(o.scope,o.user,o.project,id(),{...h,definitionDigest:'a'.repeat(64)})).closedHandoff,null);});
 console.log(JSON.stringify({suite:'photo-handoff',passed:cases,engine:'current local D1 and private R2',scannerCalls:0,modelCalls:0}));
}finally{await fixture.close();await rm(dir,{recursive:true,force:true});}
