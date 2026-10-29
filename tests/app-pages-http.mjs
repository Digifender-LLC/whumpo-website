// In-process: connected handlers, SQLite (or --d1) and a stub backend runtime. No fixture file and no host on :8787.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db;
const {appAuth:auth,appPages:pages,appHost}=m,{saveBackend,testBackend}=m.backend,{prepareApplication,confirmApplication}=m.appActivation;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
try{
const authority=await workspaceFixture(db,m),user=authority.account,scope=await authority.scope(),project=id(),version=id(),test=id(),pageId=id();
await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'App pages HTTP fixture','','draft',?,?)").bind(project,user,now(),now()).run();
await saveBackend(scope,user,project,version,'export default ({state,input})=>({state:input,result:"Saved"})');
await testBackend(scope,{fetch:()=>Response.json({ok:true,value:{state:{},result:{}}})},user,project,version,test,{state:{},input:{}});
await enableFixtureVisitorAccess(scope,user,project);
const review=id();await prepareApplication(scope,user,project,review,'enable',version,test);await confirmApplication(scope,user,review);
await pages.prepareAppPage(scope,user,project,pageId,{title:'Private journal',description:'Test',buttonLabel:'Save',fields:[{key:'note',label:'Note',type:'text'}]});await pages.confirmAppPage(scope,user,pageId);
const fixture={pageId,invites:[(await auth.createAppInvitation(scope,user,project)).code,(await auth.createAppInvitation(scope,user,project)).code]};
const origin='https://app-'+project+'.whumpo.site',base=origin;
// Stub runtime returns the submitted input as the new state, as the saved backend does.
const env={DB:db,...store.env,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:{fetch:async(_url,init)=>Response.json({ok:true,value:{state:JSON.parse(init.body).input.input,result:'Saved'}})},ASSETS:{fetch:async()=>new Response(await readFile('public-app/index.html'),{headers:{'content-type':'text/html'}})}};
let requestNumber=0;
function client(){const jar=new Map();return {jar,async request(path,body,settings={}){const response=await appHost.fetch(new Request(base+path,{method:body===undefined?'GET':'POST',headers:{origin:settings.origin??origin,'content-type':'application/json','cf-connecting-ip':`192.0.2.${++requestNumber}`,cookie:settings.cookie??[...jar].map(([k,v])=>k+'='+v).join('; ')},body:body===undefined?undefined:JSON.stringify(body)}),env);for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));}return {status:response.status,headers:response.headers,data:await response.json()};}};}
const first=client(),second=client(),key=authenticator(),otherKey=authenticator();
const page=await appHost.fetch(new Request(base+'/'),env);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);assert.ok((await page.text()).includes('Sign in with a passkey'));
assert.equal((await first.request('/data')).status,401);
assert.equal((await first.request('/auth/login/options',{}, {origin:'https://wrong.example'})).status,403);
async function register(client,key,inviteCode){const options=await client.request('/auth/signup/options',{inviteCode});assert.equal(options.status,200);const response=await client.request('/auth/signup/verify',{credential:key.registration(options.data.options)});assert.equal(response.status,200,JSON.stringify(response.data));assert.equal('session' in response.data,false);return response.data;}
const registration=await register(first,key,fixture.invites[0]);await register(second,otherKey,fixture.invites[1]);
assert.deepEqual((await first.request('/data')).data,{revision:0,state:{}});
const operation=crypto.randomUUID(),input={id:operation,revision:0,pageId:fixture.pageId,input:{note:'A private local test note'}};
const transition=await first.request('/data',input);assert.equal(transition.status,200,JSON.stringify(transition.data));assert.equal(transition.data.state,'complete');assert.equal(transition.data.result.ok,true);assert.equal(transition.data.result.value,'Saved');
assert.deepEqual((await first.request('/data')).data,{revision:1,state:input.input});
assert.deepEqual((await second.request('/data')).data,{revision:0,state:{}});
assert.equal((await second.request('/receipts/'+operation)).status,404);
assert.deepEqual((await first.request('/data',input)).data,transition.data);
assert.equal((await first.request('/data',{...input,id:crypto.randomUUID(),pageId:crypto.randomUUID()})).status,409);
assert.equal((await first.request('/data',{...input,id:crypto.randomUUID(),input:{wrong:'field'}})).status,400);
assert.equal((await first.request('/auth/logout',{})).status,200);assert.equal((await first.request('/data')).status,401);
let options=await first.request('/auth/login/options',{});const login=await first.request('/auth/login/verify',{credential:key.assertion(options.data.options,1)});assert.equal(login.status,200,JSON.stringify(login.data));
const oldCookie=[...first.jar].map(([k,v])=>k+'='+v).join('; '),recovery=await first.request('/auth/recover',{code:registration.recoveryCode,nonce:'5'.repeat(64)});assert.equal(recovery.status,200);assert.notEqual(recovery.data.recoveryCode,registration.recoveryCode);
assert.equal((await first.request('/data',undefined,{cookie:oldCookie})).status,401);
const replacement=authenticator();options=await first.request('/auth/add/options',{});assert.equal(options.status,200);assert.equal((await first.request('/auth/add/verify',{credential:replacement.registration(options.data.options)})).status,200);
assert.deepEqual((await first.request('/data')).data.state,input.input);
const exportCopy=await first.request('/export');assert.equal(exportCopy.status,200);assert.match(exportCopy.headers.get('content-disposition'),/^attachment/);assert.deepEqual(exportCopy.data.document.value,input.input);
const reviewDeletion=await second.request('/account/deletion-review',{});assert.equal(reviewDeletion.status,200);const deletion={id:reviewDeletion.data.id,revision:reviewDeletion.data.revision,confirmation:'DELETE'};assert.equal((await second.request('/account/delete',deletion,{origin:'https://wrong.example'})).status,403);assert.equal((await second.request('/account/delete',deletion)).status,200);assert.equal((await second.request('/account/delete',deletion)).status,200);assert.equal((await second.request('/data')).status,401);assert.equal((await second.request('/export')).status,401);assert.equal((await first.request('/data')).status,200);
}finally{await store.close?.();}
console.log('Application HTTP acceptance passed: in-process gateway and stub runtime, signed passkeys, invite enrollment, two isolated visitors, private receipts, exact retry, field/page guards, logout/login, recovery, replacement passkey, private export, confirmed deletion retry and preserved neighboring data.');
