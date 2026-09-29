import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {saveBackend,testBackend,equalBackendJSON}=await module('src/backend-versions.ts'),{backendAction,backendChatCommand}=await module('src/backend-chat.ts'),{compareBackends}=await module('src/backend-diff.ts'),{prepareBackendPublication}=await module('src/backend-publication.ts'),{prepareApplication}=await module('src/app-activation.ts');
for(const [a,b,equal] of [[{a:1,b:[2,null]},{b:[2,null],a:1},true],[[1,2],[2,1],false],[{},[],false],[1,'1',false],[null,false,false],[{x:null},{},false],[JSON.parse('{"__proto__":1}'),{},false],[JSON.parse('{"__proto__":1}'),JSON.parse('{"__proto__":1}'),true]])assert.equal(equalBackendJSON(a,b),equal);
assert.equal(equalBackendJSON(JSON.parse('['.repeat(3000)+'0'+']'.repeat(3000)),JSON.parse('['.repeat(3000)+'0'+']'.repeat(3000))),true);
const dir=await mkdtemp('/tmp/whumpo-backend-checks-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB,id=()=>crypto.randomUUID();
const user=id(),project=id(),version=id();let calls=0;
const service={fetch:async(url,init)=>{calls++;const payload=JSON.parse(init.body);assert.deepEqual(Object.keys(payload),['version','source','input']);return Response.json({ok:true,value:payload.input});}};
try{
 await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',new Date().toISOString()).run();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Checks','','draft',?,?)").bind(project,user,new Date().toISOString(),new Date().toISOString()).run();
 await saveBackend(db,user,project,version,'export default input=>input');
 const run=id(),input={state:{n:1},result:'saved'},expected={result:'saved',state:{n:1}};
 const passed=await testBackend(db,service,user,project,version,run,input,{expected});assert.equal(passed.result.ok,true);assert.equal(passed.result.check.status,'passed');assert.equal(passed.result.check.expectedSHA256.length,64);assert.ok(!('expected' in passed.result.check));
 assert.deepEqual(await testBackend(db,service,user,project,version,run,input,{expected}),passed);assert.equal(calls,1);
 await assert.rejects(testBackend(db,service,user,project,version,run,input,{expected:{bad:true}}),e=>e.status===409);
 await assert.rejects(testBackend(db,service,user,project,version,run,input),e=>e.status===409);
 const failedId=id(),failed=await testBackend(db,service,user,project,version,failedId,input,{expected:{state:{n:2},result:'saved'}});assert.equal(failed.result.ok,false);assert.equal(failed.result.error,'expectation_failed');assert.equal(failed.result.check.status,'failed');assert.deepEqual(failed.result.value,input);
 assert.equal((await compareBackends(db,user,version,version)).latestTest.verification,'expected_output');assert.equal((await compareBackends(db,user,version,version)).latestTest.status,'failed');
 await assert.rejects(prepareBackendPublication(db,user,project,id(),'publish',version,failedId),e=>e.status===409);
 await assert.rejects(prepareApplication(db,user,project,id(),'enable',version,failedId),e=>e.status===409);
 assert.equal((await prepareBackendPublication(db,user,project,id(),'publish',version,run)).status,'pending');
 assert.equal((await prepareApplication(db,user,project,id(),'enable',version,run)).status,'pending');
 const concurrent=id(),before=calls;await Promise.all(Array.from({length:5},()=>testBackend(db,service,user,project,version,concurrent,null,{expected:null})));assert.equal(calls,before+1);
 const large=await testBackend(db,service,user,project,version,id(),'x'.repeat(8190),{expected:'y'.repeat(16382)});assert.equal(large.result.check.status,'failed');
 // Maximum runtime output plus check metadata still fits the immutable receipt.
 const max=await testBackend(db,{fetch:()=>Response.json({ok:true,value:'x'.repeat(16382)})},user,project,version,id(),null,{expected:'x'.repeat(16382)});assert.equal(max.result.check.status,'passed');
 const beforeInvalid=calls;for(const invalid of [undefined,'x'.repeat(16383),1n])await assert.rejects(testBackend(db,service,user,project,version,id(),null,{expected:invalid}),e=>e.status===400);assert.equal(calls,beforeInvalid);
 await assert.rejects(testBackend(db,service,id(),project,version,id(),null,{expected:null}),e=>e.status===404);
 const fault=await testBackend(db,{fetch:()=>Response.json({ok:false,error:'work_limit'},{status:422})},user,project,version,id(),null,{expected:1});assert.equal(fault.result.check.status,'not_run');assert.equal(fault.result.ok,false);
 const action=await backendAction(db,user,id(),{kind:'backend',operation:'check',versionId:version,input:[1,2],expected:[2,1]},service);assert.match(action.reply,/Expected-output check: failed/);assert.deepEqual(action.statements,[]);
 assert.match(await backendChatCommand(db,user,id(),`/check-backend ${version} {"input":null,"expected":null}`,service)(),/Expected-output check: passed/);
 assert.throws(()=>backendChatCommand(db,user,id(),`/check-backend ${version} {"input":1}`,service),e=>e.status===400);
 await assert.rejects(backendAction(db,user,id(),{kind:'backend',operation:'check',versionId:version,input:null,expected:null,extra:true},service),e=>e.status===400);
 let lost=true;const lossy=new Proxy(db,{get(t,k){if(k==='prepare')return sql=>{const statement=t.prepare(sql);if(!sql.startsWith('INSERT INTO backend_runs'))return statement;return {bind(...args){const bound=statement.bind(...args);return {async run(){const result=await bound.run();if(lost){lost=false;throw Error('lost ack');}return result;}};}};};const v=t[k];return typeof v==='function'?v.bind(t):v;}});
 const uncertain=id(),beforeLost=calls;assert.equal((await testBackend(lossy,service,user,project,version,uncertain,1,{expected:1})).state,'running');assert.equal((await testBackend(db,service,user,project,version,uncertain,1,{expected:1})).state,'running');assert.equal(calls,beforeLost);
 console.log('Expected-output checks passed: exact JSON semantics, saved verdict, ownership, payload bounds, idempotency, lost acknowledgment, chat/model actions and failed-check publication/activation rejection.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
