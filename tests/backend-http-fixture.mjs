import {currentSiteFixtureHandlers,createFixtureWebsite,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
// Disposable HTTP server, D1/R2 and actual QuickJS. Never seeds a shared/live environment.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
export async function backendHttpFixture(){
 const dir=await mkdtemp('/tmp/whumpo-backend-http-');let store,runtime,server;
 const dispose=async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await runtime?.dispose();await store?.close();await rm(dir,{recursive:true,force:true});};
 try{
  store=await databaseFixture({d1:true,r2:true});const db=store.db,owners=new Map();
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir+'/runtime'],{stdio:'pipe',maxBuffer:16*1024*1024});
  const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
  runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:dir+'/runtime',modules:[{type:'ESModule',path:dir+'/runtime/worker.js'},...(await readdir(dir+'/runtime')).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/runtime/'+p}))],compatibilityDate:'2026-09-29'}));
  const m=await currentSiteFixtureHandlers(),{worker:platform,host:sites,hashToken,sendChat,readChat}=m;
  const env={...store.env,ENVIRONMENT:'local',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:{fetch:(request,init)=>runtime.dispatchFetch(request,init)}};
  let base;
  server=createServer(async(req,res)=>{try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const request=new Request(base+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
   const pending=[];
   const response=await (new URL(request.url).pathname.startsWith('/s/')?sites:platform).fetch(request,env,{waitUntil(task){pending.push(task);}});
   await Promise.all(pending);
   for(const cookie of response.headers.getSetCookie())res.appendHeader('set-cookie',cookie);res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([name])=>name!=='set-cookie')));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Fixture handler failed');}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base='http://127.0.0.1:'+server.address().port;
  async function seedBackend(project,id,source,cookie){
   const imported=crypto.randomUUID(),path='/api/projects/'+project+'/backends';
   const post=(url,body)=>fetch(base+url,{method:'POST',headers:{origin:base,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
   // The direct import stays quarantined and never becomes runnable. WH-014 holds the owner's exact quarantined bytes in
   // every writer, so the import carries distinct bytes from the trusted version seeded below.
   const quarantined=source+'\n// direct import awaiting review';
   const response=await post(path,{id:imported,source:quarantined});assert.equal(response.status,202,await response.clone().text());
   assert.equal((await post(path+'/'+imported+'/test',{id:crypto.randomUUID(),input:null})).status,404);
   assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(imported).first(),null);
   // Saving the quarantined bytes as a version is refused (no laundering into a runnable version).
   await assert.rejects(db.prepare('INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),project,quarantined,await hashToken(quarantined),new Date().toISOString()).run(),/artifact_held/);
   // Distinct, trusted synthetic version. This does NOT promote the quarantined import.
   await db.prepare('INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,?,?,?)').bind(id,project,source,await hashToken(source),new Date().toISOString()).run();
  }
  async function firstProject(cookie,name,idea){
   const call=async(path,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(base+'/api'+path,{method,headers:{origin:base,cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();};
   const denied=await fetch(base+'/api/chat',{headers:{cookie}});assert.equal(denied.status,409);
   await call('/profile',{revision:0,name:'Synthetic owner',avatar_id:'planet'},'PATCH');
   const welcome=await call('/onboarding');
   await call('/onboarding',{revision:welcome.state.revision,stage:'review',prompt:'review',project_name:name,idea,audience:'Synthetic testing',preferred_theme:'ocean'},'PUT');
   await call('/onboarding/complete',{revision:welcome.state.revision+1});
   await call('/chat');
   return (await call('/projects')).projects[0].id;
  }
  async function account(){const owner=await workspaceFixture(db,m),cookie='__Host-whumpo_session='+owner.token;owners.set(cookie,owner);return cookie;}
  function ownerFor(cookie){const owner=owners.get(cookie);assert.ok(owner,'Use a current fixture account');return owner;}
  async function seedChat(cookie,content){const owner=ownerFor(cookie),user=owner.account,scope=await owner.scope(),state=await readChat(scope,user),id=crypto.randomUUID();const result=await sendChat(scope,user,{id,revision:state.state.revision,content});assert.equal(result.status,200);return id;}
  async function seedWebsite(cookie,project){const owner=ownerFor(cookie);return createFixtureWebsite(await owner.scope(),owner.account,project,{name:'Neighborhood orders',headline:'Neighborhood orders',description:'A small order calculator',theme:'ocean',aboutTitle:'About',aboutText:'Synthetic orders',sections:[],photos:[]});}
  /** WH-126: the project's visitor access module, saved and activated through the real owner path. */
  async function seedVisitorAccess(cookie,project){const owner=ownerFor(cookie);return enableFixtureVisitorAccess(await owner.scope(),owner.account,project);}
  async function assertNoInference(){assert.equal((await db.prepare('SELECT count(*) n FROM inference_calls').first()).n,0);}

  return {base,account,assertNoInference,seedBackend,firstProject,seedChat,seedWebsite,seedVisitorAccess,dispose};
 }catch(error){await dispose();throw error;}
}
