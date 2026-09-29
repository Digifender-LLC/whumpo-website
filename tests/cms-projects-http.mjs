import assert from 'node:assert/strict';
const base=process.env.WHUMPO_TEST_URL||'http://localhost:8787';assert.ok(['localhost','127.0.0.1'].includes(new URL(base).hostname));
async function account(){const r=await fetch(base+'/api/auth/register',{method:'POST',headers:{origin:base,'content-type':'application/json'},body:JSON.stringify({email:crypto.randomUUID()+'@example.test',password:crypto.randomUUID()+'-fixture'})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
const cookie=await account(),other=await account();
async function post(path,data,session=cookie,origin=base){return fetch(base+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie:session},body:JSON.stringify(data)});}
const project=(await (await post('/api/projects',{name:'CMS HTTP fixture'})).json()).project.id;
const id=crypto.randomUUID(),body={id,projectId:project,title:'Private blog',tagline:'Updates'};
assert.equal((await fetch(base+'/api/cms')).status,401);
assert.equal((await post('/api/cms/setup-reviews',body,other)).status,404);
assert.equal((await post('/api/cms/setup-reviews',body,cookie,'https://evil.example')).status,403);
const review=await post('/api/cms/setup-reviews',body);assert.equal(review.status,200);assert.equal((await review.json()).status,'pending');
const read=async()=> (await fetch(base+'/api/cms',{headers:{cookie}})).json();assert.equal((await read()).instances.length,0);
assert.equal((await post('/api/cms/setup-reviews/'+id+'/confirm',{},other)).status,404);
assert.equal((await post('/api/cms/setup-reviews/'+id+'/confirm',{})).status,200);assert.equal((await post('/api/cms/setup-reviews/'+id+'/confirm',{})).status,200);
const result=await read();assert.equal(result.instances.length,1);assert.equal(result.instances[0].state,'queued');assert.equal(result.instances[0].title,body.title);
assert.equal((await fetch(base+'/api/cms/setup-reviews/'+id,{headers:{cookie:other}})).status,404);
console.log('CMS setup HTTP passed: authentication, ownership, CSRF, prepare-only review and replay-safe queued confirmation.');

assert.equal((await fetch(base+'/api/cms/'+project+'/status')).status,401);
assert.equal((await fetch(base+'/api/cms/'+project+'/status',{headers:{cookie:other}})).status,404);
assert.equal((await fetch(base+'/api/cms/'+project+'/status',{headers:{cookie}})).status,404);
console.log('CMS status HTTP passed: authentication, foreign-owner denial and uninitialized-instance denial.');

const previewPath=base+'/api/cms/'+project+'/content/'+id+'/preview';
assert.equal((await fetch(previewPath)).status,401);assert.equal((await fetch(previewPath,{headers:{cookie:other}})).status,404);assert.equal((await fetch(previewPath,{headers:{cookie}})).status,404);
console.log('CMS preview HTTP access checks passed.');
