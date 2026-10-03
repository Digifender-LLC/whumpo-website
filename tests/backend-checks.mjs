import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function owner(user=crypto.randomUUID()){if(!owners.has(user)){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());}return user;}
const {saveBackend,testBackend,equalBackendJSON}=m.backend,{backendAction,backendChatCommand}=m.backendChat,{compareBackends}=m.backendDiff,{prepareBackendPublication}=m.backendPublication,{prepareApplication}=m.appActivation;
for(const [a,b,equal] of [[{a:1,b:[2,null]},{b:[2,null],a:1},true],[[1,2],[2,1],false],[{},[],false],[1,'1',false],[null,false,false],[{x:null},{},false],[JSON.parse('{"__proto__":1}'),{},false],[JSON.parse('{"__proto__":1}'),JSON.parse('{"__proto__":1}'),true]])assert.equal(equalBackendJSON(a,b),equal);
assert.equal(equalBackendJSON(JSON.parse('['.repeat(3000)+'0'+']'.repeat(3000)),JSON.parse('['.repeat(3000)+'0'+']'.repeat(3000))),true);
const id=()=>crypto.randomUUID();
const user=id(),project=id(),version=id();let calls=0;
const service={fetch:async(url,init)=>{calls++;const payload=JSON.parse(init.body);assert.deepEqual(Object.keys(payload),['version','source','input']);return Response.json({ok:true,value:payload.input});}};
try{
 await owner(user);const foreign=await owner();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Checks','','draft',?,?)").bind(project,user,new Date().toISOString(),new Date().toISOString()).run();
 await saveBackend(scope(user),user,project,version,'export default input=>input');
 const run=id(),input={state:{n:1},result:'saved'},expected={result:'saved',state:{n:1}};
 const passed=await testBackend(scope(user),service,user,project,version,run,input,{expected});assert.equal(passed.result.ok,true);assert.equal(passed.result.check.status,'passed');assert.equal(passed.result.check.expectedSHA256.length,64);assert.ok(!('expected' in passed.result.check));
 assert.deepEqual(await testBackend(scope(user),service,user,project,version,run,input,{expected}),passed);assert.equal(calls,1);
 await assert.rejects(testBackend(scope(user),service,user,project,version,run,input,{expected:{bad:true}}),e=>e.status===409);
 await assert.rejects(testBackend(scope(user),service,user,project,version,run,input),e=>e.status===409);
 const failedId=id(),failed=await testBackend(scope(user),service,user,project,version,failedId,input,{expected:{state:{n:2},result:'saved'}});assert.equal(failed.result.ok,false);assert.equal(failed.result.error,'expectation_failed');assert.equal(failed.result.check.status,'failed');assert.deepEqual(failed.result.value,input);
 assert.equal((await compareBackends(scope(user),user,version,version)).latestTest.verification,'expected_output');assert.equal((await compareBackends(scope(user),user,version,version)).latestTest.status,'failed');
 await assert.rejects(prepareBackendPublication(scope(user),user,project,id(),'publish',version,failedId),e=>e.status===409);
 await assert.rejects(prepareApplication(scope(user),user,project,id(),'enable',version,failedId),e=>e.status===409);
 assert.equal((await prepareBackendPublication(scope(user),user,project,id(),'publish',version,run)).status,'pending');
 assert.equal((await prepareApplication(scope(user),user,project,id(),'enable',version,run)).status,'pending');
 const concurrent=id(),before=calls;await Promise.all(Array.from({length:5},()=>testBackend(scope(user),service,user,project,version,concurrent,null,{expected:null})));assert.equal(calls,before+1);
 const large=await testBackend(scope(user),service,user,project,version,id(),'x'.repeat(8190),{expected:'y'.repeat(16382)});assert.equal(large.result.check.status,'failed');
 // Maximum runtime output plus check metadata still fits the immutable receipt.
 const max=await testBackend(scope(user),{fetch:()=>Response.json({ok:true,value:'x'.repeat(16382)})},user,project,version,id(),null,{expected:'x'.repeat(16382)});assert.equal(max.result.check.status,'passed');
 const beforeInvalid=calls;for(const invalid of [undefined,'x'.repeat(16383),1n])await assert.rejects(testBackend(scope(user),service,user,project,version,id(),null,{expected:invalid}),e=>e.status===400);assert.equal(calls,beforeInvalid);
 await assert.rejects(testBackend(scope(foreign),service,foreign,project,version,id(),null,{expected:null}),e=>e.status===404);
 const fault=await testBackend(scope(user),{fetch:()=>Response.json({ok:false,error:'work_limit'},{status:422})},user,project,version,id(),null,{expected:1});assert.equal(fault.result.check.status,'not_run');assert.equal(fault.result.ok,false);
 const action=await backendAction(scope(user),user,id(),{kind:'backend',operation:'check',versionId:version,input:[1,2],expected:[2,1]},service);assert.match(action.reply,/Expected-output check: failed/);assert.deepEqual(action.statements,[]);
 assert.match(await backendChatCommand(scope(user),user,id(),`/check-backend ${version} {"input":null,"expected":null}`,service)(),/Expected-output check: passed/);
 assert.throws(()=>backendChatCommand(scope(user),user,id(),`/check-backend ${version} {"input":1}`,service),e=>e.status===400);
 await assert.rejects(backendAction(scope(user),user,id(),{kind:'backend',operation:'check',versionId:version,input:null,expected:null,extra:true},service),e=>e.status===400);
 let lost=true;const lossy=await owners.get(user).scope(interceptDatabase(db,/^INSERT INTO backend_runs/,async()=>{},async()=>{if(lost){lost=false;throw Error('lost acknowledgment');}}));
 const uncertain=id(),beforeLost=calls;assert.equal((await testBackend(lossy,service,user,project,version,uncertain,1,{expected:1})).state,'running');assert.equal((await testBackend(scope(user),service,user,project,version,uncertain,1,{expected:1})).state,'running');assert.equal(calls,beforeLost);
 console.log('Expected-output checks passed: exact JSON semantics, saved verdict, ownership, payload bounds, idempotency, lost acknowledgment, chat/model actions and failed-check publication/activation rejection.');
}finally{await store.close();}
