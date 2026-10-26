import assert from 'node:assert/strict';
// Owner-deferred CMS acceptance. Current Worker HTTP routes over disposable local D1.
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,completeWelcome} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
const {module,identity}=await currentFixtureModules(['src/index.ts']),{default:platform}=await module('src/index.ts');
const store=await databaseFixture({d1:true}),db=store.db,base='https://whumpo.com';
const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
const call=(url,options)=>platform.fetch(new Request(url,options),env,{waitUntil(){throw Error('No background work expected');}});
async function account(){const owner=await workspaceFixture(db,identity);await completeWelcome(db,owner.account);return '__Host-whumpo_session='+owner.token;}
try{
const cookie=await account(),other=await account();
async function post(path,data,session=cookie,origin=base){return call(base+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie:session},body:JSON.stringify(data)});}
const project=(await (await post('/api/projects',{name:'CMS HTTP fixture'})).json()).project.id;
const id=crypto.randomUUID(),body={id,projectId:project,title:'Private blog',tagline:'Updates'};
assert.equal((await call(base+'/api/cms')).status,401);
assert.equal((await post('/api/cms/setup-reviews',body,other)).status,404);
assert.equal((await post('/api/cms/setup-reviews',body,cookie,'https://evil.example')).status,403);
const review=await post('/api/cms/setup-reviews',body);assert.equal(review.status,200);assert.equal((await review.json()).status,'pending');
const read=async()=> (await call(base+'/api/cms',{headers:{cookie}})).json();assert.equal((await read()).instances.length,0);
assert.equal((await post('/api/cms/setup-reviews/'+id+'/confirm',{},other)).status,404);
assert.equal((await post('/api/cms/setup-reviews/'+id+'/confirm',{})).status,200);assert.equal((await post('/api/cms/setup-reviews/'+id+'/confirm',{})).status,200);
const result=await read();assert.equal(result.instances.length,1);assert.equal(result.instances[0].state,'queued');assert.equal(result.instances[0].title,body.title);
assert.equal((await call(base+'/api/cms/setup-reviews/'+id,{headers:{cookie:other}})).status,404);
console.log('CMS setup HTTP passed: authentication, ownership, CSRF, prepare-only review and replay-safe queued confirmation.');

assert.equal((await call(base+'/api/cms/'+project+'/status')).status,401);
assert.equal((await call(base+'/api/cms/'+project+'/status',{headers:{cookie:other}})).status,404);
assert.equal((await call(base+'/api/cms/'+project+'/status',{headers:{cookie}})).status,404);
console.log('CMS status HTTP passed: authentication, foreign-owner denial and uninitialized-instance denial.');

const previewPath=base+'/api/cms/'+project+'/content/'+id+'/preview';
assert.equal((await call(previewPath)).status,401);assert.equal((await call(previewPath,{headers:{cookie:other}})).status,404);assert.equal((await call(previewPath,{headers:{cookie}})).status,404);
console.log('CMS preview HTTP access checks passed.');

}finally{await store.close();}
