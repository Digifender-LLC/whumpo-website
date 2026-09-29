import assert from 'node:assert/strict';
const base=process.env.TELLUMO_TEST_URL||'http://localhost:8787';assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
const headers={origin:base,'content-type':'application/json'};
async function account(){const r=await fetch(base+'/api/auth/register',{method:'POST',headers,body:JSON.stringify({email:crypto.randomUUID()+'@example.com',password:crypto.randomUUID()+'local-test'})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
const cookie=await account(),other=await account();
const post=(path,data,session=cookie,origin=base)=>fetch(base+path,{method:'POST',headers:{...headers,origin,cookie:session},body:JSON.stringify(data)});
const project=await (await post('/api/projects',{name:'Backend HTTP fixture'})).json(),pid=project.project.id;
const path='/api/projects/'+pid+'/backends',version=crypto.randomUUID(),rid=crypto.randomUUID();
assert.equal((await post(path,{id:version,source:'export default input=>({total:input.values.reduce((a,b)=>a+b,0)})'})).status,201);
assert.equal((await fetch(base+path)).status,401);
assert.equal((await fetch(base+path,{headers:{cookie:other}})).status,404);
assert.equal((await post(path,{id:crypto.randomUUID(),source:'export default ()=>1'},cookie,'https://evil.example')).status,403);
const run=await post(path+'/'+version+'/test',{id:rid,input:{values:[2,3,7]}});assert.equal(run.status,200);const result=await run.json();assert.deepEqual(result.result,{ok:true,value:{total:12}});
assert.deepEqual(await (await post(path+'/'+version+'/test',{id:rid,input:{values:[2,3,7]}})).json(),result);
assert.equal((await post(path+'/'+version+'/test',{id:rid,input:{values:[1]}})).status,409);
assert.equal((await post(path+'/'+version+'/test',{id:crypto.randomUUID(),input:{}},other)).status,404);
const hostile=crypto.randomUUID();await post(path,{id:hostile,source:'export default ()=>{while(true){}}'});const bad=await (await post(path+'/'+hostile+'/test',{id:crypto.randomUUID(),input:null})).json();assert.deepEqual(bad.result,{ok:false,error:'work_limit'});
const recovery=await (await post(path+'/'+version+'/test',{id:crypto.randomUUID(),input:{values:[1,2]}})).json();assert.deepEqual(recovery.result,{ok:true,value:{total:3}});
console.log('HTTP backend checks passed with actual bound runtime: authentication, ownership, CSRF, immutable saves, execution, replay, conflict and post-exhaustion recovery.');
