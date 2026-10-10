// WH-004 slice 2 regression: cross-tenant refusal on the whumpo-sites Worker, through its real default export.
// Local D1 and synthetic accounts only; the runtime binding is a counting stub and no network is used.
// Closes evidence gaps recorded in docs/boundary-audit.json: another project's site, backend or pinned backend
// publication is not reachable through a project host, and custom domains never reach the public backend.
import assert from 'node:assert/strict';
import {createFixtureProject,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

const m=await currentSiteFixtureHandlers(),{sendChat,readChat,host}=m,store=await databaseFixture({d1:true}),db=store.db,scopes=new Map(),scope=u=>scopes.get(u);
const {prepareBackendPublication:prepare,confirmBackendPublication:confirm}=m.backendPublication,{saveBackend,testBackend}=m.backend;
const id=()=>crypto.randomUUID();let calls=0;
const runtime={fetch:async(_url,init)=>{calls++;return Response.json({ok:true,value:JSON.parse(init.body).input});}};
const env={DB:db,BACKEND_RUNTIME:runtime};
async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function publishSite(user,name){
 const site=await createFixtureProject(scope(user),user,name,'A synthetic '+name+' website.');
 const review=id();let state=await readChat(scope(user),user);await sendChat(scope(user),user,{content:'/publish '+site.version,id:review,revision:state.state.revision});
 state=await readChat(scope(user),user);await sendChat(scope(user),user,{content:'/confirm '+review,id:id(),revision:state.state.revision});
 return site;
}
async function publishBackend(user,project){
 const v=id(),r=id(),rid=id();
 await saveBackend(scope(user),user,project,v,'export default input=>input');
 await testBackend(scope(user),runtime,user,project,v,r,42);
 await prepare(scope(user),user,project,rid,'publish',v,r);await confirm(scope(user),user,rid);return rid;
}
const fetchHost=(url,init={})=>host.fetch(new Request(url,{...init,headers:{'cf-connecting-ip':'198.51.100.'+(1+calls%200),...(init.headers??{})}}),env);
const post=(url)=>fetchHost(url,{method:'POST',headers:{'content-type':'application/json'},body:'{"n":1}'});
try{
 const ua=await account(),ub=await account();
 const a=await publishSite(ua,'Tenant A'),b=await publishSite(ub,'Tenant B');
 assert.equal((await fetchHost(`https://${b.project}.whumpo.site/`)).status,200,'positive control: B is published');
 assert.equal((await fetchHost(`https://${a.project}.whumpo.site/`)).status,200,'positive control: A is published');
 // B's site is not reachable through A's host by path.
 for(const path of ['/s/'+b.project+'/','/s/'+b.project,'/s/'+b.project+'/directory.json','/s/'+b.project+'/cms/'])
  assert.equal((await fetchHost(`https://${a.project}.whumpo.site${path}`)).status,404,path);
 // Backends: B's published backend runs on B's host only.
 const ra=await publishBackend(ua,a.project),rb=await publishBackend(ub,b.project);
 calls=0;
 assert.equal((await post(`https://${b.project}.whumpo.site/backend`)).status,200,'positive control: B backend');
 assert.equal((await post(`https://${a.project}.whumpo.site/backend/${ra}`)).status,200,'positive control: A pinned to its own publication');
 assert.equal(calls,2);
 assert.equal((await post(`https://${a.project}.whumpo.site/s/${b.project}/backend`)).status,405,'B backend by path on A host');
 assert.equal((await post(`https://${a.project}.whumpo.site/backend/${rb}`)).status,404,'B publication pinned on A host');
 // A custom (or unmapped) hostname never reaches a backend, even with a project path.
 for(const url of ['https://www.example.com/backend','https://www.example.com/s/'+b.project+'/backend','https://unclaimed.whumpo.site/backend'])
  assert.equal((await post(url)).status,405,url);
 assert.equal(calls,2,'no refused request reached the runtime');
 console.log('Site isolation: another project\'s published site (and its directory/CMS paths) is not served on a project host; its backend and pinned publication are refused there; custom and unmapped hosts never reach a backend; refused requests never reach the runtime.');
}finally{await store.close();}
