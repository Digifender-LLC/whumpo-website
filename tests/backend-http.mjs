Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {backendHttpFixture} from './backend-http-fixture.mjs';
const fixture=await backendHttpFixture(),base=fixture.base;
try {

const headers={origin:base,'content-type':'application/json'};
async function account(){const r=await fetch(base+'/api/auth/register',{method:'POST',headers,body:JSON.stringify({email:crypto.randomUUID()+'@example.com',password:crypto.randomUUID()+'local-test'})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
const cookie=await account(),other=await account();
const post=(path,data,session=cookie,origin=base)=>fetch(base+path,{method:'POST',headers:{...headers,origin,cookie:session},body:JSON.stringify(data)});
const project=await (await post('/api/projects',{name:'Backend HTTP fixture'})).json(),pid=project.project.id;
const path='/api/projects/'+pid+'/backends',version=crypto.randomUUID(),rid=crypto.randomUUID();
await fixture.seedBackend(pid,version,'export default input=>({total:input.values.reduce((a,b)=>a+b,0)})',cookie);
assert.equal((await fetch(base+path)).status,401);
assert.equal((await fetch(base+path,{headers:{cookie:other}})).status,404);
assert.equal((await post(path,{id:crypto.randomUUID(),source:'export default ()=>1'},cookie,'https://evil.example')).status,403);
const run=await post(path+'/'+version+'/test',{id:rid,input:{values:[2,3,7]}});assert.equal(run.status,200);const result=await run.json();assert.deepEqual(result.result,{ok:true,value:{total:12}});
assert.deepEqual(await (await post(path+'/'+version+'/test',{id:rid,input:{values:[2,3,7]}})).json(),result);
assert.equal((await post(path+'/'+version+'/test',{id:rid,input:{values:[1]}})).status,409);
assert.equal((await post(path+'/'+version+'/test',{id:crypto.randomUUID(),input:{}},other)).status,404);
const hostile=crypto.randomUUID();await fixture.seedBackend(pid,hostile,'export default ()=>{while(true){}}',cookie);const bad=await (await post(path+'/'+hostile+'/test',{id:crypto.randomUUID(),input:null})).json();assert.deepEqual(bad.result,{ok:false,error:'work_limit'});
const recovery=await (await post(path+'/'+version+'/test',{id:crypto.randomUUID(),input:{values:[1,2]}})).json();assert.deepEqual(recovery.result,{ok:true,value:{total:3}});
console.log('HTTP backend checks passed with actual bound runtime: authentication, ownership, CSRF, immutable saves, execution, replay, conflict and post-exhaustion recovery.');
const statePath='/api/projects/'+pid+'/backend-state',sv=crypto.randomUUID(),sr=crypto.randomUUID();
await fixture.seedBackend(pid,sv,'export default ({state,input})=>({state:{count:(state.count??0)+input.add},result:"updated"})',cookie);
assert.equal((await fetch(base+statePath)).status,401);
assert.equal((await post(statePath,{id:sr,versionId:sv,input:{add:5}},other)).status,404);
const reviewed=await post(statePath,{id:sr,versionId:sv,input:{add:5}});assert.equal(reviewed.status,200);assert.equal((await reviewed.json()).status,'ready');
const readState=async()=> (await fetch(base+statePath,{headers:{cookie}})).json();assert.equal((await readState()).revision,0);
const confirm='/api/backend-state-reviews/'+sr+'/confirm';
assert.equal((await post(confirm,{},other)).status,404);
assert.equal((await post(confirm,{},cookie,'https://evil.example')).status,403);
assert.equal((await post(confirm,{})).status,200);assert.deepEqual((await readState()).state,{count:5});
assert.equal((await post(confirm,{})).status,200);assert.equal((await readState()).revision,1);
assert.equal((await fetch(base+'/api/backend-state-reviews/'+sr,{headers:{cookie:other}})).status,404);
assert.equal((await (await post(statePath,{id:sr,versionId:sv,input:{add:5}})).json()).status,'applied');assert.equal((await readState()).revision,1);
console.log('HTTP state checks passed with actual bound runtime: review leaves state unchanged, owner-only same-origin confirmation, persistent JSON and replay-safe revision.');
const snapshots='/api/backend-state-snapshots/'+sr;
const exported=await fetch(base+snapshots+'/export',{headers:{cookie}});assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition'),/attachment/);const archive=await exported.json();assert.deepEqual(archive.before.data,{});assert.deepEqual(archive.after.data,{count:5});
assert.equal((await fetch(base+snapshots+'/export',{headers:{cookie:other}})).status,404);
const resetId=crypto.randomUUID();assert.equal((await post(snapshots+'/restore',{id:resetId,side:'before'},other)).status,404);assert.equal((await post(snapshots+'/restore',{id:resetId,side:'before'},cookie,'https://evil.example')).status,403);
const restoreResponse=await post(snapshots+'/restore',{id:resetId,side:'before'});assert.equal(restoreResponse.status,200);assert.equal((await restoreResponse.json()).status,'ready');assert.deepEqual((await readState()).state,{count:5});
assert.equal((await post('/api/backend-state-reviews/'+resetId+'/confirm',{})).status,200);assert.deepEqual((await readState()).state,{});assert.equal((await readState()).revision,2);
const history=await (await fetch(base+statePath+'/history',{headers:{cookie}})).json();assert.equal(history.snapshots.length,2);assert.equal(history.snapshots[0].restore_review_id,sr);
console.log('HTTP state recovery passed: private JSON attachment, owned snapshot restore, CSRF, exact confirmation and revision history.');
const publicationPath='/api/projects/'+pid+'/backend-publication',publicationId=crypto.randomUUID();
assert.equal((await fetch(base+publicationPath)).status,401);
assert.equal((await post(publicationPath,{id:publicationId,operation:'publish',versionId:version,runId:rid},other)).status,404);
assert.equal((await post(publicationPath,{id:publicationId,operation:'publish',versionId:version,runId:rid},cookie,'https://evil.example')).status,403);
assert.equal((await post(publicationPath,{id:publicationId,operation:'publish',versionId:version,runId:rid})).status,200);
const publicationConfirm='/api/backend-publication-reviews/'+publicationId+'/confirm';
assert.equal((await post(publicationConfirm,{},other)).status,404);
assert.equal((await post(publicationConfirm,{},cookie,'https://evil.example')).status,403);
const sites=base;
if(sites){
 assert.ok(['localhost','127.0.0.1'].includes(new URL(sites).hostname));
 const invoke=()=>fetch(sites+'/s/'+pid+'/backend',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({values:[7,11,13]})});
 assert.equal((await invoke()).status,404);
 assert.equal((await post(publicationConfirm,{})).status,200);
 const publicResult=await invoke();assert.equal(publicResult.status,200);assert.deepEqual(await publicResult.json(),{ok:true,value:{total:31}});
 assert.equal(publicResult.headers.get('cache-control'),'no-store');assert.equal(publicResult.headers.get('access-control-allow-origin'),'*');
 const off=crypto.randomUUID();assert.equal((await post(publicationPath,{id:off,operation:'unpublish',versionId:version})).status,200);
 assert.equal((await post('/api/backend-publication-reviews/'+off+'/confirm',{})).status,200);assert.equal((await invoke()).status,404);
 console.log('Public endpoint HTTP acceptance passed: owner/session/origin review boundary, actual bound QuickJS output, anonymous JSON headers and reviewed withdrawal.');
}else{assert.equal((await post(publicationConfirm,{})).status,200);console.log('Publication API boundary passed; set TELLUMO_SITES_TEST_URL for actual public runtime acceptance.');}

// Expected-output assertions use the same private runtime, receipt and quotas.
const checkedId=crypto.randomUUID(),checkPath=path+'/'+version+'/test';
const checked=await post(checkPath,{id:checkedId,input:{values:[2,3,7]},expected:{total:12}});assert.equal(checked.status,200);const checkedResult=await checked.json();assert.equal(checkedResult.result.check.status,'passed');
assert.deepEqual(await (await post(checkPath,{id:checkedId,input:{values:[2,3,7]},expected:{total:12}})).json(),checkedResult);
assert.equal((await post(checkPath,{id:checkedId,input:{values:[2,3,7]},expected:{total:13}})).status,409);
const failedId=crypto.randomUUID(),wrong=await (await post(checkPath,{id:failedId,input:{values:[2,3,7]},expected:{total:13}})).json();assert.equal(wrong.result.ok,false);assert.equal(wrong.result.check.status,'failed');
assert.equal((await post(publicationPath,{id:crypto.randomUUID(),operation:'publish',versionId:version,runId:failedId})).status,409);
assert.equal((await post(checkPath,{id:crypto.randomUUID(),input:null,expected:null},other)).status,404);
const chatBefore=await (await fetch(base+'/api/chat',{headers:{cookie}})).json();const chatRun=crypto.randomUUID();
assert.equal((await post('/api/chat',{id:chatRun,revision:chatBefore.state.revision,content:'/check-backend '+version+' {"input":{"values":[4,5]},"expected":{"total":9}}'})).status,503);
const chatAfter=await (await fetch(base+'/api/chat',{headers:{cookie}})).json();assert.equal(chatAfter.state.revision,chatBefore.state.revision);assert.equal(chatAfter.usage.available,chatBefore.usage.available);
console.log('Expected-output HTTP/runtime checks passed: correct/wrong answers, immutable replay, ownership, failed publication gate and literal-chat rejection while inference is unavailable.');

} finally {await fixture.dispose();}
