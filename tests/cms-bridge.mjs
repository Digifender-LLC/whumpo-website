// Owner-deferred CMS acceptance. Current-schema setup only; do not run without resumption.
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const {module,identity}=await currentFixtureModules(["src/cms-bridge.ts", "src/cms-gateway.ts"]);
const {signCMSRequest,verifyCMSRequest,cmsRequestAllowed}=await module('src/cms-bridge.ts'),{cmsGateway}=await module('src/cms-gateway.ts');
const dir=await mkdtemp('/tmp/whumpo-cms-bridge-');
const store=await databaseFixture({d1:true,r2:true}),db=store.db,id=()=>crypto.randomUUID();
const config={projectId:id(),ownerId:id(),secret:'local-fixture-key-'.repeat(4),origin:'https://cms.test'},env={DB:db,WHUMPO_CMS_PROJECT_ID:config.projectId,WHUMPO_CMS_OWNER_ID:config.ownerId,WHUMPO_CMS_BRIDGE_KEY:config.secret,WHUMPO_CMS_ORIGIN:config.origin};
let dispatches=0;const dispatch=async()=>{dispatches++;return Response.json({ok:true},{headers:{'set-cookie':'must-not-leave-gateway=1'}});},setup={title:'Fixture',tagline:'CMS test',includeContent:false},path='/_emdash/api/setup';
const execute=async(r,environment=env,handler=dispatch)=>cmsGateway(r,environment,handler);
try{
 const valid=await signCMSRequest(config,path,id(),setup);assert.equal((await verifyCMSRequest(valid,config)).path,path);
 for(const changed of [{...config,ownerId:id()},{...config,projectId:id()},{...config,secret:'different'.repeat(10)},{...config,origin:'https://other.test'}])await assert.rejects(verifyCMSRequest(valid,changed));
 await assert.rejects(verifyCMSRequest(valid,config,Date.now()+61000));
 await assert.rejects(verifyCMSRequest(await signCMSRequest(config,path,id(),setup,Date.now()+61000),config));
 const altered=new Request(valid.url,{method:'POST',headers:valid.headers,body:JSON.stringify({...setup,title:'Forged'})});await assert.rejects(verifyCMSRequest(altered,config));
 const changedPath=new Request(config.origin+'/_emdash/api/auth/me',{method:'POST',headers:valid.headers,body:JSON.stringify(setup)});await assert.rejects(verifyCMSRequest(changedPath,config));
 const cookie=new Request(valid);cookie.headers.set('cookie','emdash_session=fixture');await assert.rejects(verifyCMSRequest(cookie,config));
 assert.equal((await execute(new Request(config.origin+path))).status,403);assert.equal((await execute(valid,{})).status,503);assert.equal(dispatches,0);
 for(const blocked of ['/','/_emdash/api/setup/admin','/_emdash/api/plugins','/_emdash/api/content/posts'])assert.equal(cmsRequestAllowed('POST',blocked,JSON.stringify(setup)),false);
 assert.equal((await execute(await signCMSRequest(config,path,id(),{...setup,includeContent:true}))).status,403);assert.equal(dispatches,0);
 const run=id(),r=await execute(await signCMSRequest(config,path,run,setup));assert.equal(r.status,200);assert.equal(r.headers.has('set-cookie'),false);
 assert.equal((await execute(await signCMSRequest(config,path,run,setup))).status,200);assert.equal(dispatches,1);
 assert.equal((await execute(await signCMSRequest(config,path,run,{...setup,title:'Changed'}))).status,409);assert.equal(dispatches,1);
 const concurrent=id();await Promise.all(Array.from({length:6},async()=>execute(await signCMSRequest(config,path,concurrent,setup))));assert.equal(dispatches,2);
 const unknown=id();assert.equal((await execute(await signCMSRequest(config,path,unknown,setup),env,async()=>{dispatches++;throw Error('uncertain');})).status,409);
 assert.equal((await execute(await signCMSRequest(config,path,unknown,setup))).status,409);assert.equal(dispatches,3);
 // Lost reservation acknowledgement must not dispatch a write.
 const lossy=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const s=target.prepare(sql);if(!sql.startsWith('INSERT INTO _whumpo_requests'))return s;return {bind(...args){const bound=s.bind(...args);return {async run(){await bound.run();throw Error('lost acknowledgment');}};}};};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 const lost=id();assert.equal((await execute(await signCMSRequest(config,path,lost,setup),{...env,DB:lossy})).status,409);assert.equal(dispatches,3);
 const invalid=id();assert.equal((await execute(await signCMSRequest(config,path,invalid,setup),env,async()=>new Response('x'.repeat(65537),{headers:{'content-type':'application/json'}}))).status,502);
 assert.equal((await execute(await signCMSRequest(config,path,invalid,setup))).status,409);assert.equal(dispatches,3);
 console.log('CMS bridge checks passed: owner/project/origin/method/body signatures, expiry, cookie denial, operation bounds, replay/conflict, concurrent dispatch-once, lost acknowledgment and unknown-outcome handling.');
}finally{await store.close();await rm(dir,{recursive:true,force:true});}
