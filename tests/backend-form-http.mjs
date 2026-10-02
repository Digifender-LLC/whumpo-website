Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {backendHttpFixture} from './backend-http-fixture.mjs';
const fixture=await backendHttpFixture(),base=fixture.base;
try {

const cookie=await fixture.account();
const post=(path,data,origin=base,session=cookie)=>fetch(base+path,{method:'POST',headers:{origin,cookie:session,'content-type':'application/json'},body:JSON.stringify(data)});
const get=path=>fetch(base+path,{headers:{cookie}});
const chat=content=>fixture.seedChat(cookie,content); // Private fixture setup only; public Chat has no commands.
const project=await fixture.firstProject(cookie,'Neighborhood orders','A small order calculator'),siteVersion=await fixture.seedWebsite(cookie,project),siteReview=await chat('/publish '+siteVersion);await chat('/confirm '+siteReview);
const versionId=crypto.randomUUID(),runId=crypto.randomUUID(),reviewId=crypto.randomUUID(),backendPath='/api/projects/'+project+'/backends';
await fixture.seedBackend(project,versionId,'export default ({quantity,price,express,querySelector:note})=>({total:quantity*price+(express?5:0),note})',cookie);
const run=await post(backendPath+'/'+versionId+'/test',{id:runId,input:{quantity:2,price:12.5,express:true,querySelector:'Example'}});assert.equal(run.status,200);assert.deepEqual((await run.json()).result,{ok:true,value:{total:30,note:'Example'}});
await post('/api/projects/'+project+'/backend-publication',{id:reviewId,operation:'publish',versionId,runId});assert.equal((await post('/api/backend-publication-reviews/'+reviewId+'/confirm',{})).status,200);
const config={title:'Estimate your order',description:'Get an estimate before you place your order.',buttonLabel:'Calculate total',fields:[{key:'quantity',label:'Quantity',type:'number'},{key:'price',label:'Unit price',type:'number'},{key:'express',label:'Add express service ($5)',type:'boolean'},{key:'querySelector',label:'Order note',type:'text'}]},formId=crypto.randomUUID(),formPath='/api/projects/'+project+'/backend-form';
assert.equal((await fetch(base+formPath)).status,401);assert.equal((await post(formPath,{id:formId,config},'https://evil.test')).status,403);
assert.equal((await post(formPath,{id:formId,config})).status,200);
assert.ok(!(await(await fetch(base+'/s/'+project)).text()).includes('townhello-backend-form'));
assert.equal((await post('/api/backend-form-reviews/'+formId+'/confirm',{},'https://evil.test')).status,403);
assert.equal((await post('/api/backend-form-reviews/'+formId+'/confirm',{})).status,200);
const publicPage=await fetch(base+'/s/'+project);assert.equal(publicPage.status,200);assert.ok((await publicPage.text()).includes('townhello-backend-form'));
const before=await post('/api/projects/'+project+'/backend-state',{});assert.equal(before.status,400);
console.log('Local form HTTP fixture passed: real QuickJS calculator, session/origin review protection, private until confirmed. Disposable HTTP fixture; no persistent browser URL.');

} finally {await fixture.dispose();}
