import {createFixtureWebsite} from './current-site-fixture.mjs';
// Disposable HTTP server, D1/R2 and actual QuickJS. Never seeds a shared/live environment.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
export async function backendHttpFixture(){
 const dir=await mkdtemp('/tmp/whumpo-backend-http-');let proxy,runtime,server;
 const dispose=async()=>{if(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}await runtime?.dispose();await proxy?.dispose();await rm(dir,{recursive:true,force:true});};
 try{
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir+'/runtime'],{stdio:'pipe',maxBuffer:16*1024*1024});
  const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
  runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:dir+'/runtime',modules:[{type:'ESModule',path:dir+'/runtime/worker.js'},...(await readdir(dir+'/runtime')).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/runtime/'+p}))],compatibilityDate:'2026-09-29'}));
  proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});
  const bundle=await build({stdin:{resolveDir:process.cwd(),contents:"export {default as platform} from './src/index';export {default as sites} from './src/site-host';export {hashToken} from './src/security';export {sendChat,readChat} from './src/chat';"},bundle:true,format:'esm',platform:'node',write:false});
  const {platform,sites,hashToken,sendChat,readChat}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
  const env={...proxy.env,ENVIRONMENT:'local',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:{fetch:(request,init)=>runtime.dispatchFetch(request,init)}};
  let base;
  server=createServer(async(req,res)=>{try{
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const request=new Request(base+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)});
   const pending=[];
   const response=await (new URL(request.url).pathname.startsWith('/s/')?sites:platform).fetch(request,env,{waitUntil(task){pending.push(task);}});
   await Promise.all(pending);
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  }catch{res.writeHead(500);res.end('Fixture handler failed');}});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});base='http://127.0.0.1:'+server.address().port;
  async function seedBackend(project,id,source,cookie){
   const imported=crypto.randomUUID(),path='/api/projects/'+project+'/backends';
   const post=(url,body)=>fetch(base+url,{method:'POST',headers:{origin:base,cookie,'content-type':'application/json'},body:JSON.stringify(body)});
   const response=await post(path,{id:imported,source});assert.equal(response.status,202,await response.clone().text());
   assert.equal((await post(path+'/'+imported+'/test',{id:crypto.randomUUID(),input:null})).status,404);
   assert.equal(await proxy.env.DB.prepare('SELECT id FROM backend_versions WHERE id=?').bind(imported).first(),null);
   // Distinct, trusted synthetic version. This does NOT promote the quarantined import.
   await proxy.env.DB.prepare('INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,?,?,?)').bind(id,project,source,await hashToken(source),new Date().toISOString()).run();
  }
  async function firstProject(cookie,name,idea){
   const call=async(path,body,method=body===undefined?'GET':'POST')=>{const r=await fetch(base+'/api'+path,{method,headers:{origin:base,cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});assert.equal(r.status,200,await r.clone().text());return r.json();};
   const denied=await fetch(base+'/api/chat',{headers:{cookie}});assert.equal(denied.status,409);
   await call('/profile',{revision:0,name:'Synthetic owner',avatar_id:'planet'},'PATCH');
   const welcome=await call('/onboarding');
   await call('/onboarding',{revision:welcome.state.revision,stage:'review',project_name:name,idea,audience:'Synthetic testing',preferred_theme:'ocean'},'PUT');
   await call('/onboarding/complete',{revision:welcome.state.revision+1});
   await call('/chat');
   return (await call('/projects')).projects[0].id;
  }
  async function seedChat(cookie,content){const token=cookie.split('=')[1],user=(await proxy.env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash=?').bind(await hashToken(token)).first()).user_id;const state=await readChat(proxy.env.DB,user),id=crypto.randomUUID();const result=await sendChat(proxy.env.DB,user,{id,revision:state.state.revision,content});assert.equal(result.status,200);return id;}
  async function seedWebsite(cookie,project){const token=cookie.split('=')[1],user=(await proxy.env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash=?').bind(await hashToken(token)).first()).user_id;return createFixtureWebsite(proxy.env.DB,user,project,{name:'Neighborhood orders',headline:'Neighborhood orders',description:'A small order calculator',theme:'ocean',aboutTitle:'About',aboutText:'Synthetic orders',sections:[],photos:[]});}
  return {base,seedBackend,firstProject,seedChat,seedWebsite,dispose};
 }catch(error){await dispose();throw error;}
}
