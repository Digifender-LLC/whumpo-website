Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {backendHttpFixture} from './backend-http-fixture.mjs';
const fixture=await backendHttpFixture(),base=fixture.base;
try {

const cookie=await fixture.account(),other=await fixture.account();
const post=(path,data,origin=base,session=cookie)=>fetch(base+path,{method:'POST',headers:{origin,cookie:session,'content-type':'application/json'},body:JSON.stringify(data)});
const get=path=>fetch(base+path,{headers:{cookie}});

const project=await fixture.firstProject(cookie,'Counter application','A simple private counter');
const version=crypto.randomUUID(),run=crypto.randomUUID();const path='/api/projects/'+project;
await fixture.seedBackend(project,version,'export default ({state,input})=>({state:{count:(state.count??0)+input.add},result:"Count saved"})',cookie);
const tested=await post(path+'/backends/'+version+'/test',{id:run,input:{state:{},input:{add:2}}});assert.equal(tested.status,200);assert.deepEqual((await tested.json()).result,{ok:true,value:{state:{count:2},result:'Count saved'}});
await fixture.seedVisitorAccess(cookie,project);
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
const off=crypto.randomUUID();assert.equal((await post(path+'/application',{id:off,operation:'disable'})).status,200);assert.equal((await post('/api/application-reviews/'+off+'/confirm',{})).status,200);assert.equal((await(await get(path+'/application')).json()).configuration.enabled,0);
assert.equal((await post(review+'/confirm',{})).status,200);assert.equal((await(await get(path+'/application')).json()).configuration.enabled,0);
const enabled=crypto.randomUUID();assert.equal((await post(path+'/application',{id:enabled,operation:'enable',versionId:version,runId:run})).status,200);assert.equal((await post('/api/application-reviews/'+enabled+'/confirm',{})).status,200);assert.equal((await(await get(path+'/application')).json()).configuration.enabled,1);
console.log('Application HTTP acceptance passed: real QuickJS transition test, authenticated review/confirmation, cross-owner isolation, CSRF denial, explicit disable and historical confirmation replay. Visitor access remains gated.');

} finally {await fixture.dispose();}
