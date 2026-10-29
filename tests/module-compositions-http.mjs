// WH-070: composition source served on the visitor origin through the real visitor host and gateway, in-process.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {currentSiteFixtureHandlers,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db,{appHost,moduleCompositions}=m;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
try{
const authority=await workspaceFixture(db,m),user=authority.account,scope=await authority.scope(),a=id(),b=id();
for(const [p,n] of [[a,'A'],[b,'B']])await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,'','draft',?,?)").bind(p,user,'Compositions '+n,now(),now()).run();
await enableFixtureVisitorAccess(scope,user,a); // project B has no access module instance
const env={DB:db,...store.env,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:{fetch:async()=>Response.json({ok:true})},ASSETS:{fetch:async()=>new Response('x')}};
const get=(project,path,init={})=>appHost.fetch(new Request('https://app-'+project+'.whumpo.site'+path,{method:'GET',...init}),env);
for(const name of ['staff-portal','visitor-intake']){
 const fixture=await readFile(new URL('./fixtures/module-compositions/'+name+'.mjs',import.meta.url),'utf8');
 const r=await get(a,'/compositions/'+name+'.js');
 assert.equal(r.status,200);assert.equal(await r.text(),fixture,name+' is served byte-for-byte from the fixture');
 assert.match(r.headers.get('content-type'),/^text\/javascript/);
 for(const [k,v] of [['cache-control','private, no-store'],['x-content-type-options','nosniff'],['cross-origin-resource-policy','same-origin'],['x-frame-options','DENY']])assert.equal(r.headers.get(k),v,k);
 assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);
 assert.ok(!r.headers.has('set-cookie'),'source carries no authority');
 const head=await get(a,'/compositions/'+name+'.js',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 assert.equal((await get(b,'/compositions/'+name+'.js')).status,404,'a project without an access module gets nothing');
 assert.equal((await get(id(),'/compositions/'+name+'.js')).status,404,'unknown project');
}
for(const p of ['/compositions/missing.js','/compositions/__proto__.js','/compositions/constructor.js','/compositions/staff-portal.mjs','/compositions/staff-portal.js/x'])assert.equal((await get(a,p)).status,404,p);
assert.equal((await get(a,'/compositions/staff-portal.js?x=1')).status,400);
for(const method of ['POST','PUT','DELETE'])assert.equal((await get(a,'/compositions/staff-portal.js',{method,headers:{origin:'https://app-'+a+'.whumpo.site'}})).status,405,method);
assert.equal((await get(a,'/compositions/staff-portal.js',{headers:{origin:'https://evil.example'}})).status,403);
assert.equal((await get(a,'/compositions/staff-portal.js',{headers:{'sec-fetch-site':'cross-site'}})).status,403);
// Other HEAD requests stay refused: HEAD is not a new way into the gateway.
assert.equal((await get(a,'/config',{method:'HEAD'})).status,405);
assert.equal((await appHost.fetch(new Request('https://app-'+a+'.whumpo.site/compositions/staff-portal.js'),{...env,API_LIMITER:{limit:async()=>({success:false})}})).status,429,'the gateway limiter applies');
// Drafts are never served; live is.
moduleCompositions['staff-portal'].status='draft';
try{assert.equal((await get(a,'/compositions/staff-portal.js')).status,404);assert.equal((await get(a,'/compositions/staff-portal.js',{method:'HEAD'})).status,404);assert.equal((await get(a,'/compositions/visitor-intake.js')).status,200);}
finally{moduleCompositions['staff-portal'].status='published';}
moduleCompositions['staff-portal'].status='live';
try{assert.equal((await get(a,'/compositions/staff-portal.js')).status,200);}finally{moduleCompositions['staff-portal'].status='published';}
}finally{await store.close?.();}
console.log('Module composition serving passed: both fixtures byte-exact, GET/HEAD only, drafts and unknown/foreign projects 404, headers and Origin gates.');
