Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {backendHttpFixture} from './backend-http-fixture.mjs';
const fixture=await backendHttpFixture(),base=fixture.base;
try {
async function call(path,method='GET',body,cookie=''){const response=await fetch(base+'/api'+path,{method,headers:{origin:base,cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
const account=()=>fixture.account();
const owner=await account(),other=await account(),created=await call('/projects','POST',{name:'Synthetic diff',purpose:'HTTP acceptance'},owner);assert.equal(created.status,201);const project=created.data.project.id,old=crypto.randomUUID(),next=crypto.randomUUID();for(const [id,source]of [[old,'export default input=>input+1'],[next,'export default input=>input+2']])await fixture.seedBackend(project,id,source,owner);
const path='/backend-versions/'+next+'/compare/'+old;assert.equal((await call(path)).status,401);assert.equal((await call(path,'GET',undefined,other)).status,404);const result=await call(path,'GET',undefined,owner);assert.equal(result.status,200);assert.equal(result.data.latestTest.status,'untested');assert.deepEqual(result.data.changes.added,['export default input=>input+2']);const chat=await call('/chat','GET',undefined,owner);assert.equal((await call('/chat','POST',{id:crypto.randomUUID(),revision:chat.data.state.revision,content:`/backend-diff ${next} ${old}`},owner)).status,503);const updated=await call('/chat','GET',undefined,owner);assert.equal(updated.data.state.revision,chat.data.state.revision);await fixture.assertNoInference();console.log('Backend diff HTTP passed: anonymous/foreign denial, exact code comparison, public literal-command refusal with unavailable inference and no inference dispatch.');

} finally {await fixture.dispose();}
