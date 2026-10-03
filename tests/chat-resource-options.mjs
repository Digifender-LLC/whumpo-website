import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/chat-interactions/resource-options.ts','src/chat-interactions/resource-shape.ts']);
const {readOwnedResourceOptions:read}=await modules.module('src/chat-interactions/resource-options.ts'),{readResourcePage}=await modules.module('src/chat-interactions/resource-shape.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID(),run=(q,...p)=>db.prepare(q).bind(...p).run();let cases=0,network=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Unexpected provider request');};
async function owner(){const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope();return {authority,user,scope};}
async function grant(o,projectId){const g=id();await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','read','private-test-acceptance','synthetic resource option test',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",g,o.user,projectId);return g;}
async function project(o,name='Garden'){const p=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,'PRIVATE_PURPOSE_CANARY','draft',datetime('now'),datetime('now'))",p,o.user,name);return p;}
async function photo(p,name,state='pending'){
 const f=id();await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,?,?,?,1024,640,480,'ready',datetime('now'))",f,p,name,'PRIVATE_R2_KEY/'+f,'a'.repeat(64));
 // Existing trusted fixture clearance only. No detector, upload or image bytes.
 if(state==='approved'||state==='expired')await run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-resource-fixture',expires_at=? WHERE file_id=?",new Date(Date.now()+(state==='expired'?-3600000:3600000)).toISOString(),f);
 if(state==='blocked')await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",f);
 return f;
}
async function test(name,fn){try{await fn();cases++;}catch(e){console.error(name,e);throw e;}}
try{
 await test('bounded project pages contain only current owned names and IDs',async()=>{
  const a=await owner(),b=await owner();await grant(a,null);for(const name of ['Alpha','Alpha','Garden','Zebra'])await project(a,name);await project(b,'FOREIGN_CANARY');
  let before=null;const items=[];do{const p=await read(a.scope,a.user,'projects',null,before,2);assert(p.items.length<=2);items.push(...p.items);before=p.nextBefore;}while(before);
  assert.deepEqual(items.map(p=>p.name),['Alpha','Alpha','Garden','Zebra']);assert(items.every(p=>p.photo===null));assert.equal(new Set(items.map(p=>p.id)).size,4);assert.doesNotMatch(JSON.stringify(items),/CANARY|purpose|key/);
 });
 await test('photo options use exact-project ready clearance with no bytes or keys',async()=>{
  const a=await owner(),b=await owner(),p=await project(a),other=await project(a),foreign=await project(b);await grant(a,p);
  const ids=[];for(const name of ['A','A','B'])ids.push(await photo(p,name,'approved'));
  for(const state of ['pending','blocked','expired'])await photo(p,'UNAVAILABLE_'+state,state);
  await photo(other,'OTHER_PROJECT_CANARY','approved');await photo(foreign,'FOREIGN_CANARY','approved');
  const first=await read(a.scope,a.user,'photos',p,null,2),second=await read(a.scope,a.user,'photos',p,first.nextBefore,2),items=[...first.items,...second.items];
  assert.deepEqual(items.map(p=>p.name),['A','A','B']);assert.deepEqual(items.map(p=>p.id).sort(),ids.sort());assert.equal(second.nextBefore,null);assert(items.every(p=>JSON.stringify(p.photo)===JSON.stringify({width:640,height:480,size:1024})));assert.doesNotMatch(JSON.stringify(items),/CANARY|UNAVAILABLE|PRIVATE_R2_KEY|digest|scanner/);
 });
 await test('missing read eligibility, foreign project and unsupported query inputs refuse',async()=>{
  const a=await owner(),b=await owner(),p=await project(b);await assert.rejects(()=>read(a.scope,a.user,'projects',null,null,20),e=>e.status===403);await grant(a,null);
  await assert.rejects(()=>read(a.scope,a.user,'photos',p,null,20),e=>e.status===403);
  for(const args of [['photos',null,null,20],['projects',p,null,20],['projects',null,null,21],['projects',null,{id:id(),name:'X',query:'*'},20],['secrets',null,null,20]])await assert.rejects(()=>read(a.scope,a.user,...args));
 });
 await test('late project transfer, deletion or rename cannot return an earlier list',async()=>{
  for(const mode of ['transfer','delete','rename']){
   const a=await owner(),b=await owner(),p=await project(a);await grant(a,null);let changed=false;
   const scoped=await a.authority.scope(interceptDatabase(db,/^SELECT id,name FROM projects/,async()=>{},async()=>{if(changed)return;changed=true;await(mode==='transfer'?run('UPDATE projects SET owner_user_id=? WHERE id=?',b.user,p):mode==='delete'?run('DELETE FROM projects WHERE id=?',p):run("UPDATE projects SET name='Changed' WHERE id=?",p));}));
   await assert.rejects(()=>read(scoped,a.user,'projects',null,null,20),e=>e.code==='REFERENCE');assert(changed);
  }
 });
 await test('late photo clearance revocation removes eligibility before return',async()=>{
  const a=await owner(),p=await project(a),f=await photo(p,'Garden','approved');await grant(a,p);let revoked=false;
  const scoped=await a.authority.scope(interceptDatabase(db,/^SELECT f.id,f.name,f.size/,async()=>{},async()=>{if(revoked)return;revoked=true;await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",f);}));
  await assert.rejects(()=>read(scoped,a.user,'photos',p,null,20),e=>e.code==='REFERENCE');assert(revoked);
 });
 await test('late session and feature revocation refuse metadata',async()=>{
  for(const mode of ['session','feature']){const a=await owner();await project(a);const g=await grant(a,null);let revoked=false;
   const scoped=await a.authority.scope(interceptDatabase(db,/^SELECT id,name FROM projects/,async()=>{},async()=>{if(revoked)return;revoked=true;await(mode==='session'?a.authority.revoke():run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',g));}));
   await assert.rejects(()=>read(scoped,a.user,'projects',null,null,20));assert(revoked);
  }
 });
 await test('closed page shape refuses destinations, unknown data, duplicate choices and malformed cursors',async()=>{
  const p={version:1,interactionId:id(),definitionDigest:'a'.repeat(64),fieldId:'photos',collection:'photos',items:[{id:id(),name:'Garden',photo:{width:640,height:480,size:1024}}],nextBefore:null};assert(readResourcePage(p));
  for(const mutate of [p=>p.url='https://foreign.test',p=>p.items[0].photo.url='data:...',p=>p.items.push(p.items[0]),p=>p.items[0].photo.size=0,p=>p.collection='projects',p=>p.nextBefore={id:id(),name:'Missing'},p=>p.version=0,p=>p.definitionDigest='old',p=>p.fieldId='constructor']){const copy=structuredClone(p);mutate(copy);assert.equal(readResourcePage(copy),null);}
  p.nextBefore={id:p.items[0].id,name:p.items[0].name};assert(readResourcePage(p));
 });
 assert.equal(network,0);console.log(`Owned resource adapters: ${cases} cases passed (${process.argv.includes('--d1')?'local D1':'SQLite'}). Scoped metadata paging, existing synthetic photo clearance, late ownership/eligibility/session checks and closed shapes. No image bytes, scanner, new form admission or deployment.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
