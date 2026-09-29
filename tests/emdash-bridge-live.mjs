// Local multi-Worker acceptance against the actual built EmDash application.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({entryPoints:['src/cms-bridge.ts'],bundle:true,format:'esm',platform:'node',write:false});const {signCMSRequest,verifyCMSInitialization}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const config={projectId:'11111111-1111-4111-8111-111111111111',ownerId:'22222222-2222-4222-8222-222222222222',secret:'local-cms-bridge-fixture-'.repeat(3),origin:'https://cms.test'};
const base='http://localhost:8799',id=()=>crypto.randomUUID();
async function call(path,body,requestId=id(),identity=config){const request=await signCMSRequest(identity,path,requestId,body);return fetch(base+path,{method:request.method,headers:request.headers,...(body===undefined?{}:{body:await request.text()})});}
assert.equal((await fetch(base+'/_emdash/api/setup/status')).status,403);
assert.equal((await call('/_emdash/api/setup/status',undefined,id(),{...config,ownerId:id()})).status,403);
const before=await call('/_emdash/api/setup/status');assert.equal(before.status,200);const initial=await before.json();assert.equal(initial.data.needsSetup,true,JSON.stringify(initial));
const requestId=id(),body={title:'TownHello CMS bridge fixture',tagline:'Private isolated CMS',includeContent:false};
const setup=await call('/_emdash/api/setup',body,requestId);const setupData=await setup.json();assert.equal(setup.status,200,JSON.stringify(setupData));assert.equal(setupData.data.setupComplete,true);assert.equal(setupData.data.seedComplete,true);
assert.deepEqual(await (await call('/_emdash/api/setup',body,requestId)).json(),setupData);
assert.equal((await call('/_emdash/api/setup',{...body,title:'Forged replay'},requestId)).status,409);
const me=await call('/_emdash/api/auth/me');const owner=await me.json();assert.equal(me.status,200,JSON.stringify(owner));assert.equal(owner.data.email,config.ownerId+'@owners.townhello.invalid');assert.equal(owner.data.role,50);
const collections=await call('/_emdash/api/schema/collections');assert.equal(collections.status,200);const schema=await collections.json();assert.ok(JSON.stringify(schema).includes('posts'));
const after=await (await call('/_emdash/api/setup/status')).json();assert.equal(after.data.needsSetup,false);
assert.equal((await call('/_emdash/api/setup/admin',{email:'attacker@example.test'})).status,403);
assert.equal((await call('/_emdash/api/plugins')).status,403);
assert.equal((await fetch(base+'/_emdash/admin/setup')).status,403);
const service={fetch:async request=>{const u=new URL(request.url);return fetch(base+u.pathname,{method:request.method,headers:request.headers,...(request.method==='POST'?{body:await request.text()}:{}),signal:request.signal});}};assert.deepEqual((await verifyCMSInitialization(service,config)).collections.sort(),['pages','posts']);
console.log('Actual EmDash bridge passed: unsigned/wrong-owner denial, empty-content setup, replay/conflict handling, pinned owner administration, schema reads, setup closed and other management routes denied.');
const shapeBuild=await build({entryPoints:['src/cms-content-shape.ts'],bundle:true,format:'esm',platform:'node',write:false});const {cmsDraftBody}=await import('data:text/javascript;base64,'+Buffer.from(shapeBuild.outputFiles[0].text).toString('base64'));
for(const collection of ['posts','pages']){
 const rid=id(),draftBody=cmsDraftBody('Native '+collection,'A private paragraph. <script>plain text only</script>');
 const created=await call('/_emdash/api/content/'+collection,draftBody,rid),data=await created.json();assert.equal(created.status,201,JSON.stringify(data));assert.equal(data.data.item.status,'draft');
 assert.deepEqual(await (await call('/_emdash/api/content/'+collection,draftBody,rid)).json(),data);
 assert.equal((await call('/_emdash/api/content/'+collection,cmsDraftBody('Changed','Different'),rid)).status,409);
 const item=data.data.item,read=await call('/_emdash/api/content/'+collection+'/'+item.id);assert.equal(read.status,200);assert.equal((await read.json()).data.item.data.title,'Native '+collection);
 assert.equal((await call('/_emdash/api/content/'+collection,{...draftBody,status:'published'})).status,403);
 assert.equal((await call('/_emdash/api/content/'+collection+'/'+item.id+'/publish',{})).status,403);
 assert.equal((await fetch(base+'/posts/'+item.slug)).status,403);
}
console.log('Actual native EmDash drafts passed: posts/pages create, read, exact replay, changed-request conflict, forced draft state and publication denial.');
