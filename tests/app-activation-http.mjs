import assert from 'node:assert/strict';
const base=process.env.WHUMPO_TEST_URL||'http://localhost:8793';assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
async function register(){const response=await fetch(base+'/api/auth/register',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({email:crypto.randomUUID()+'@example.test',password:crypto.randomUUID()+'local-test'})});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];}
const cookie=await register(),other=await register();
const post=(path,data,origin=base,session=cookie)=>fetch(base+path,{method:'POST',headers:{origin,cookie:session,'content-type':'application/json'},body:JSON.stringify(data)});
const get=path=>fetch(base+path,{headers:{cookie}});
async function chat(content){const state=await(await get('/api/chat')).json(),id=crypto.randomUUID(),response=await post('/api/chat',{id,revision:state.state.revision,content});assert.equal(response.status,200,await response.text());return id;}
await chat('A simple private counter');const project=await chat('Counter application');
const version=crypto.randomUUID(),run=crypto.randomUUID();const path='/api/projects/'+project;
assert.equal((await post(path+'/backends',{id:version,source:'export default ({state,input})=>({state:{count:(state.count??0)+input.add},result:"Count saved"})'})).status,201);
const tested=await post(path+'/backends/'+version+'/test',{id:run,input:{state:{},input:{add:2}}});assert.equal(tested.status,200);assert.deepEqual((await tested.json()).result,{ok:true,value:{state:{count:2},result:'Count saved'}});
const id=crypto.randomUUID(),review='/api/application-reviews/'+id;
assert.equal((await fetch(base+path+'/application')).status,401);
assert.equal((await post(path+'/application',{id,operation:'enable',versionId:version,runId:run},'https://evil.test')).status,403);
assert.equal((await post(path+'/application',{id,operation:'enable',versionId:version,runId:run})).status,200);
assert.equal((await(await get(path+'/application')).json()).configuration.enabled,0);
assert.equal((await fetch(base+review,{headers:{cookie:other}})).status,404);
assert.equal((await post(review+'/confirm',{},base,other)).status,404);
assert.equal((await post(review+'/confirm',{},'https://evil.test')).status,403);
assert.equal((await post(review+'/confirm',{})).status,200);
const active=await(await get(path+'/application')).json();assert.equal(active.configuration.enabled,1);assert.equal(active.publicAccessReady,false);
const off=await chat('/disable-application '+project);await chat('/confirm-application '+off);assert.equal((await(await get(path+'/application')).json()).configuration.enabled,0);
assert.equal((await post(review+'/confirm',{})).status,200);assert.equal((await(await get(path+'/application')).json()).configuration.enabled,0);
const guided=await chat('/enable-application '+version+' '+run);await chat('/confirm-application '+guided);assert.equal((await(await get(path+'/application')).json()).configuration.enabled,1);
console.log('Application HTTP acceptance passed: real QuickJS transition test, authenticated review/confirmation, cross-owner isolation, CSRF denial, guided disable and historical confirmation replay. Visitor access remains gated.');
