import {mkdtemp,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {execFileSync,spawn} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const dir=await mkdtemp('/tmp/whumpo-passkeys-http-');let proxy,server;
try{
 const built=await build({entryPoints:['src/index.ts'],bundle:true,platform:'node',format:'esm',write:false});
 const {default:platform}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});
 const env={...proxy.env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const response=await platform.fetch(new Request('http://localhost:8787'+req.url,{method:req.method,headers:req.headers,...(req.method!=='GET'?{body:Buffer.concat(chunks)}:{})}),env,{waitUntil(){throw Error('Unexpected background work')}});for(const value of response.headers.getSetCookie())res.appendHeader('set-cookie',value);res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([key])=>key!=='set-cookie')));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.statusCode=500;res.end('{"error":"Fixture request failed"}');}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',resolve)});
 const child=spawn(process.execPath,['tests/passkeys.mjs'],{stdio:'inherit',env:{...process.env,TELLUMO_TEST_URL:'http://localhost:8787'}});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve)});if(code!==0)throw Error('Passkey HTTP acceptance failed');
}catch(error){console.error(error.message);process.exitCode=1;}finally{if(server?.listening)await new Promise(r=>server.close(r));await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
