import assert from 'node:assert/strict';
import {releaseProvider} from '../tools/release-provider.mjs';
import {schemaInventorySQL} from '../tools/current-schema.mjs';
import {configFiles,workerOrder} from '../tools/release-manifest.mjs';
import {readFile} from 'node:fs/promises';

// Exercise the actual operator observer against synthetic provider responses.
// Metadata only: no CMS instance or other external service is invoked.
const configs=Object.fromEntries(await Promise.all(workerOrder.map(async role=>[role,JSON.parse(await readFile(configFiles[role],'utf8'))])));
const current=configs.platform.d1_databases[0].database_id,old='11111111-1111-4111-8111-111111111111';
let active=old,retired=false,missingBinding=false,targetInitialized=false,differentRegistry=false;
const reads=[];
const api=async(path,body)=>{
 const worker=/^\/workers\/scripts\/whumpo-(runtime|apps|sites|platform)\/(deployments|versions\/v-[a-z]+)$/.exec(path);
 if(worker){
  const [,role,operation]=worker;
  if(operation==='deployments')return {result:{deployments:[{versions:[{version_id:'v-'+role,percentage:100}]}]}};
  const bindings=role==='runtime'||(role==='platform'&&missingBinding)?[]:[{type:'d1',name:'DB',id:role==='platform'?active:current}];
  return {result:{annotations:{'workers/tag':'fixture-'+role},resources:{bindings}}};
 }
 const query=/^\/d1\/database\/([a-f0-9-]+)\/query$/.exec(path);assert.ok(query,'Unexpected synthetic endpoint');
 const id=query[1];reads.push({id,sql:body.sql});
 if(id===old&&retired)throw Error('Retired database unavailable');
 let results;
 if(body.sql===schemaInventorySQL)results=targetInitialized?[{type:'table',name:'fixture',tbl_name:'fixture',sql:'CREATE TABLE fixture(id TEXT)'}]:[];
 else {assert.match(body.sql,/FROM cms_instances/);results=id===current&&differentRegistry?[{project_id:'different-fixture'}]:[];}
 return {success:true,result:[{success:true,results}]};
};
const driver=await releaseProvider(process.cwd(),{api});
const manifest={accountId:configs.platform.account_id,controlDatabaseId:current,workers:Object.fromEntries(workerOrder.map(role=>[role,{name:'whumpo-'+role}])),before:{workers:{platform:{databases:[{binding:'DB',id:old}]}}}};
await driver.observe(manifest);assert.equal(reads.filter(r=>r.sql!==schemaInventorySQL).at(-1).id,old);
targetInitialized=true;reads.length=0;await driver.observe(manifest);
assert.deepEqual(reads.filter(r=>r.sql!==schemaInventorySQL).map(r=>r.id),[old,current]);
differentRegistry=true;await assert.rejects(()=>driver.observe(manifest),/Replacement database CMS registry differs/);differentRegistry=false;
// Once the platform is current, removing the old database cannot break status.
active=current;retired=true;reads.length=0;
assert.deepEqual((await driver.observe(manifest)).cms,[]);assert.ok(reads.every(r=>r.id===current));
await driver.observe();assert.ok(reads.every(r=>r.id===current));
// No fallback from a missing active binding/database, nor cross-account/target observation.
missingBinding=true;await assert.rejects(()=>driver.observe(manifest),/Active platform database binding is missing/);missingBinding=false;
active=old;await assert.rejects(()=>driver.observe(manifest),/Retired database unavailable/);
await assert.rejects(()=>driver.observe({...manifest,accountId:'f'.repeat(32)}),/another account/);
await assert.rejects(()=>driver.observe({...manifest,controlDatabaseId:old}),/differs from current/);
console.log('Release provider passed: active database authority before/after cutover, retired database independence, registry drift and missing/cross-target refusals.');
