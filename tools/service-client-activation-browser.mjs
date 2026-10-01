// Opt-in, disposable loopback acceptance. No real provider or customer site is used.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
export async function serviceClientActivationBrowser({platform,host,env,db,account,contactReview,ctx,setInference}){
 const origin='http://localhost:8174',canonical=`https://${account.project}.whumpo.site`,root=resolve('dist'),requests=[];
 let done,fail;const finished=new Promise((resolve,reject)=>{done=resolve;fail=reject;});
 const server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8174'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(url.pathname==='/_acceptance/start'){res.writeHead(302,{'set-cookie':'tellumo_session='+account.token+'; HttpOnly; SameSite=Lax; Path=/','location':'/workspace'}).end();return;}
  if(url.pathname==='/_acceptance/finish'){res.writeHead(200,{'content-type':'text/plain'}).end('Checking the disposable journey.');done();return;}
  const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1048576){res.writeHead(413).end();return;}chunks.push(chunk);}const body=Buffer.concat(chunks);
  let response;
  if(url.pathname.startsWith('/api/')){
   // This is an in-process test harness with a throwing/scripted provider, not local dev.
   if(req.method==='POST')setInference(url.pathname==='/api/chat');
   if(!['GET','HEAD'].includes(req.method)&&req.headers.origin!==origin){res.writeHead(403).end();return;}
   const headers=new Headers(req.headers);if(headers.has('origin'))headers.set('origin','https://whumpo.com');headers.set('host','whumpo.com');
   response=await platform.fetch(new Request('https://whumpo.com'+url.pathname+url.search,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body})}),env,ctx);
   const data=body.length?JSON.parse(body.toString()):{};
   requests.push({path:url.pathname,method:req.method,status:response.status,...(url.pathname==='/api/chat/actions'?{action:data.action}:{}),...(url.pathname==='/api/chat'&&req.method==='POST'?{content:data.content}:{})});
  }else if(url.pathname==='/visitor'&&req.method==='GET'){
   setInference(false);const actual=await host.fetch(new Request(canonical+'/'),env),headers=new Headers(actual.headers);
   // Substitute only this disposable project's origin. Keep the compiled script/hash intact.
   headers.set('content-security-policy',headers.get('content-security-policy').replaceAll(canonical,origin));
   response=new Response((await actual.text()).replaceAll(canonical,origin),{status:actual.status,headers});
   requests.push({path:'/visitor',method:'GET',status:response.status});
  }else if(url.pathname===`/backend/${account.backendReview}`&&['POST','OPTIONS'].includes(req.method)){
   setInference(false);assert.equal(req.headers.cookie,undefined,'Visitor requests must omit the workspace cookie');
   response=await host.fetch(new Request(canonical+url.pathname,{method:req.method,headers:req.headers,...(req.method==='POST'?{body}:{})}),env);
   requests.push({path:url.pathname,method:req.method,status:response.status,...(req.method==='POST'?{input:JSON.parse(body.toString()),result:await response.clone().json()}:{}),cookieSent:false});
  }else{
   if(req.method!=='GET'){res.writeHead(405).end();return;}
   const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?'index.html':decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
   const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',webp:'image/webp',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);return;
  }
  for(const value of response.headers.getSetCookie())res.appendHeader('set-cookie',value);res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([key])=>key!=='set-cookie')));res.end(Buffer.from(await response.arrayBuffer()));
 }catch(error){if(error.code==='ENOENT'){res.writeHead(404).end();return;}res.writeHead(500,{'content-type':'application/json'}).end('{"error":"Local fixture failed"}');fail(error);}});
 const timeout=setTimeout(()=>fail(Error('Browser acceptance timed out')),15*60*1000);
 try{
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8174,'127.0.0.1',resolve);});
  console.log('Service activation browser ready: '+origin+'/_acceptance/start . Review and approve contact, ask to turn on the saved website tool, review and approve it, use /visitor, then visit /_acceptance/finish.');
  await finished;
  const approvals=requests.filter(r=>r.path==='/api/chat/actions'&&r.method==='POST');assert.equal(approvals.length,2);assert.ok(approvals.every(r=>r.status===200));
  assert.deepEqual(approvals[0].action,{type:'confirm',kind:'contact',reviewId:contactReview});
  assert.equal(approvals[1].action.type,'confirm');assert.equal(approvals[1].action.kind,'backendForm');
  const {results:reviews}=await db.prepare('SELECT a.id,a.service,a.version_id,s.status FROM service_client_activation_reviews a JOIN service_client_activation_state s ON s.id=a.id WHERE a.project_id=?').bind(account.project).all();
  assert.equal(reviews.length,2);assert.ok(reviews.every(r=>r.status==='applied'));
  assert.ok(reviews.some(r=>r.service==='statelessForm'&&r.id===approvals[1].action.reviewId));
  for(const review of reviews)for(const suffix of ['preview','diff'])assert.ok(requests.some(r=>r.path===`/api/service-client-activations/${review.id}/${suffix}`&&r.status===200));
  const messages=requests.filter(r=>r.path==='/api/chat'&&r.method==='POST');assert.equal(messages.length,1);assert.ok(messages[0].content&&!messages[0].content.startsWith('/'));
  const visitors=requests.filter(r=>r.path.startsWith('/backend/')&&r.method==='POST');assert.equal(visitors.length,1);assert.equal(visitors[0].status,200);assert.deepEqual(visitors[0].input,{hours:3,extra:true});assert.deepEqual(visitors[0].result,{ok:true,value:{estimate:100}});
  await mkdir('.secrets',{recursive:true});await writeFile('.secrets/service-client-activation-browser.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'Actual React on loopback with disposable D1, scripted model interpretation and isolated QuickJS; strict loopback origin checked before in-process canonical API mapping; project origin substituted for visitor browser networking',requests,reviews},null,2),{mode:0o600});
  console.log('Service activation browser passed: separate exact approvals, four private review pages, one natural-language request, credential-free visitor execution.');
 }finally{clearTimeout(timeout);if(server.listening)await new Promise(done=>server.close(done));}
}
