// Opt-in loopback acceptance using synthetic credentials and disposable actual D1.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {resolve,sep} from 'node:path';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const dir=await mkdtemp('/tmp/whumpo-standard-billing-browser-'),origin='http://localhost:8169',root=resolve('dist');let proxy,server,input;
let finish;const finished=new Promise(resolve=>{finish=resolve});
try{
 const b=await build({stdin:{contents:"export {default as platform} from './src/index';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});const {platform,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB,user=crypto.randomUUID(),now=new Date().toISOString(),requests=[];
 const token='e'.repeat(64);
 await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,'standard-billing@example.test',now).run();
 await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(token),user,new Date(Date.now()+3600000).toISOString(),now).run();
 const env={...proxy.env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 const call=(path,method,body)=>platform.fetch(new Request(origin+path,{method,headers:{origin,cookie:'whumpo_session='+token,'content-type':'application/json'},body:JSON.stringify(body)}),env,{waitUntil(){throw Error('No inference expected')}});
 assert.equal((await call('/api/profile','PATCH',{revision:0,name:'Billing tester',avatar_id:'sun'})).status,200);
 assert.equal((await call('/api/onboarding','PUT',{revision:0,stage:'review',project_name:'Synthetic Bakery',idea:'A fictional bakery project',audience:'Neighbors',preferred_theme:'forest'})).status,200);
 assert.equal((await call('/api/onboarding/complete','POST',{revision:1})).status,200);
 const project=(await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(user).first()).id;
 // Synthetic accounting rows for visual acceptance; no provider is called.
 await db.prepare('UPDATE usage_periods SET allowance=0 WHERE user_id=?').bind(user).run();
 for(const state of ['completed','uncertain']){
  const id=crypto.randomUUID();await db.prepare('INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,?,?)').bind(id,user,'a'.repeat(64),now,now).run();
  await db.prepare("UPDATE standard_ai_requests SET state='dispatched' WHERE id=?").bind(id).run();
  if(state==='completed')await db.prepare("UPDATE standard_ai_requests SET state='completed',input_tokens=100,output_tokens=20 WHERE id=?").bind(id).run();
  else await db.prepare("UPDATE standard_ai_requests SET state='uncertain' WHERE id=?").bind(id).run();
 }

 server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8169'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(url.pathname==='/_acceptance/start'){res.writeHead(302,{'set-cookie':'whumpo_session='+token+'; HttpOnly; SameSite=Lax; Path=/','location':'/workspace/billing'}).end();return;}
  if(url.pathname==='/_acceptance/finish'){res.writeHead(200,{'content-type':'text/plain'}).end('Checking disposable billing state.');finish();return;}
  if(url.pathname.startsWith('/api/')){
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1048576){res.writeHead(413).end();return;}chunks.push(chunk);}
   const response=await platform.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env,{waitUntil(){throw Error('No inference expected')}});
   requests.push({path:url.pathname,method:req.method,status:response.status});
   for(const value of response.headers.getSetCookie())res.appendHeader('set-cookie',value);res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([key])=>key!=='set-cookie')));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?'index.html':decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch{res.writeHead(500,{'content-type':'application/json'}).end('{"error":"Local fixture failed"}');}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8169,'127.0.0.1',done)});input=createInterface({input:process.stdin});
 console.log('Standard billing browser ready: '+origin+'/_acceptance/start . Inspect Billing and Dashboard, then send finish on stdin.');
 input.on('line',line=>{if(line.trim()==='finish')finish()});await finished;
 assert.ok(requests.some(r=>r.path==='/api/billing'&&r.method==='GET'&&r.status===200));
 assert.ok(requests.every(r=>r.method==='GET'));
 for(const table of ['inference_calls','publications','usage_operations'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 await writeFile('.secrets/standard-billing-browser.json',JSON.stringify({checkedAt:new Date().toISOString(),requests,inferenceCalls:0,publications:0,customerUsageOperations:0},null,2),{mode:0o600});
 console.log('Standard billing browser passed: authenticated billing read, no mutations, no inference, publication or customer usage operations.');
}catch(error){console.error(error.message);process.exitCode=1;}finally{input?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
