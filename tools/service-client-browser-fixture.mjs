// Opt-in loopback browser continuation of the disposable service-client journey.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
export async function serviceClientBrowser({platform,env,db,account,review,ctx}){
 const origin='http://localhost:8787',root=resolve('dist'),requests=[];let done;const finished=new Promise(resolve=>{done=resolve});
 const server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8787'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(url.pathname==='/_acceptance/start'){res.writeHead(302,{'set-cookie':'__Host-whumpo_session='+account.token+'; Secure; HttpOnly; SameSite=Lax; Path=/','location':'/workspace'}).end();return;}
  if(url.pathname==='/_acceptance/finish'){res.writeHead(200,{'content-type':'text/plain'}).end('Checking the disposable review.');done();return;}
  if(url.pathname.startsWith('/api/')){
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1048576){res.writeHead(413).end();return;}chunks.push(chunk);}const body=Buffer.concat(chunks);
   const response=await platform.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body})}),{...env,ENVIRONMENT:'local'},ctx);
   requests.push({path:url.pathname,method:req.method,status:response.status,...(url.pathname==='/api/chat/actions'?{action:JSON.parse(body.toString()).action}:{})});
   for(const value of response.headers.getSetCookie())res.appendHeader('set-cookie',value);res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([key])=>key!=='set-cookie')));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?'index.html':decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',webp:'image/webp',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch{res.writeHead(500,{'content-type':'application/json'}).end('{"error":"Local fixture failed"}');}});
 const input=createInterface({input:process.stdin});input.on('line',line=>{if(line.trim()==='finish')done();});
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',resolve);});
  console.log('Service settings browser ready: '+origin+'/_acceptance/start . Inspect both review links, save with the keyboard, then visit /_acceptance/finish.');
  await finished;
  const approved=requests.filter(r=>r.path==='/api/chat/actions'&&r.method==='POST');assert.equal(approved.length,1);assert.equal(approved[0].status,200);assert.deepEqual(approved[0].action,{type:'serviceClientApply',reviewId:review.id,proposalDigest:review.proposalDigest,expectedRevision:review.expectedRevision});
  for(const suffix of ['preview','diff'])assert.ok(requests.some(r=>r.path===`/api/service-client-reviews/${review.id}/${suffix}`&&r.status===200));
  const head=await db.prepare('SELECT revision FROM service_client_heads WHERE project_id=?').bind(account.project).first();assert.equal(head.revision,1);assert.equal((await db.prepare('SELECT count(*) n FROM publications WHERE project_id=?').bind(account.project).first()).n,0);assert.equal((await db.prepare('SELECT count(*) n FROM backend_form_settings WHERE project_id=?').bind(account.project).first()).n,0);
  await mkdir('.secrets',{recursive:true});await writeFile('.secrets/service-client-browser.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'Disposable local D1 and scripted interpretation; browser approval of private settings only',requests,revision:head.revision,websitePublications:0,activeForms:0},null,2),{mode:0o600});
  console.log('Service settings browser passed: exact typed approval, both private review links, one private revision, no website publication or form activation.');
 }finally{input.close();if(server.listening)await new Promise(done=>server.close(done));}
}
