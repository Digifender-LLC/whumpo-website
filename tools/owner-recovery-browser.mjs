// Opt-in loopback acceptance using synthetic credentials and disposable actual D1.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {resolve,sep} from 'node:path';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const dir=await mkdtemp('/tmp/whumpo-recovery-browser-'),origin='http://localhost:8168',root=resolve('dist');let proxy,server,input;
let finish;const finished=new Promise(resolve=>{finish=resolve});
try{
 const b=await build({stdin:{contents:"export {default as platform} from './src/index';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});const {platform,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB,user=crypto.randomUUID(),now=new Date().toISOString(),requests=[];
 await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,'recovery-browser@example.test',now).run();await db.prepare('INSERT INTO recovery_codes VALUES(?,?,?)').bind(user,await hashToken('a'.repeat(64)),now).run();
 for(const [id,name] of [['lost-key','Lost phone'],['kept-key','Backup-'+ 'x'.repeat(73)]])await db.prepare("INSERT INTO passkeys(id,user_id,public_key,counter,name,created_at) VALUES(?,?,'synthetic',0,?,?)").bind(id,user,name,now).run();
 const env={...proxy.env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};let loseFirst=true;
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8168'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(url.pathname==='/_acceptance/finish'){res.writeHead(200,{'content-type':'text/plain'}).end('Checking disposable recovery state.');finish();return;}
  if(url.pathname.startsWith('/api/')){
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1048576){res.writeHead(413).end();return;}chunks.push(chunk);}
   const response=await platform.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env,{waitUntil(){throw Error('No inference expected')}});
   requests.push({path:url.pathname,method:req.method,status:response.status});
   if(url.pathname==='/api/auth/recover'&&response.status===200&&loseFirst){loseFirst=false;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Synthetic interrupted response'}));return;}
   for(const value of response.headers.getSetCookie())res.appendHeader('set-cookie',value);res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([key])=>key!=='set-cookie')));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?'index.html':decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch{res.writeHead(500,{'content-type':'application/json'}).end('{"error":"Local fixture failed"}');}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8168,'127.0.0.1',done)});input=createInterface({input:process.stdin});
 console.log('Recovery browser ready at '+origin+'/workspace/. Synthetic email recovery-browser@example.test; code is 64 lowercase a characters. Choose Some / Lost phone. First completed response is deliberately hidden. Restart with saved replacement code and choose None, then visit /_acceptance/finish or type finish.');
 input.on('line',line=>{if(line.trim()==='finish')finish()});await finished;
 assert.equal(loseFirst,false);assert.deepEqual((await db.prepare('SELECT id FROM passkeys WHERE user_id=? ORDER BY id').bind(user).all()).results.map(r=>r.id),['kept-key']);
 assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE user_id=? AND action='account.recovered'").bind(user).first()).n,2);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM sessions WHERE user_id=?').bind(user).first()).n,1);
 assert.equal(requests.filter(r=>r.path==='/api/chat'&&r.method==='POST').length,0);
 await writeFile('.secrets/owner-recovery-browser.json',JSON.stringify({checkedAt:new Date().toISOString(),requests,remainingPasskeys:1,recoveryEvents:2,sessions:1},null,2),{mode:0o600});console.log('Recovery browser acceptance passed: saved-code recovery after lost response, exact selected-key removal, two rotations, one final session, no inference.');
}catch(error){console.error(error.message);process.exitCode=1;}finally{input?.close();if(server?.listening)await new Promise(done=>server.close(done));await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
