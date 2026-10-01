// Explicit local acceptance: actual handlers and disposable D1, scripted inference only.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {resolve,sep} from 'node:path';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const dir=await mkdtemp('/tmp/whumpo-owner-journey-'),origin='http://localhost:8175',root=resolve('dist');
const originalFetch=globalThis.fetch,background=[],requests=[];let proxy,server,input,finish;
const finished=new Promise(resolve=>{finish=resolve;});let lose='',providerCalls=0,ackCalls=0,earlyWorkspaceReads=0;
try{
 const b=await build({stdin:{contents:"export {default as platform} from './src/index';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
 const {platform,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB,user=crypto.randomUUID(),token=(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-',''),now=new Date().toISOString();
 await db.prepare("INSERT INTO users VALUES(?,?,'00','passkey-only',?)").bind(user,'owner-journey@example.invalid',now).run();
 await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(token),user,new Date(Date.now()+3600000).toISOString(),now).run();
 const env={DB:db,FILES:proxy.env.FILES,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},AI_BASE_URL:'https://opencode.ai/zen/go/v1',AI_MODEL:'muse-spark-1.3-contributor',AI_PROTOCOL:'responses',AI_API_KEY:'synthetic-only-no-real-credential'},ctx={waitUntil:p=>background.push(p)};
 globalThis.fetch=async(url,init)=>{
  assert.equal(String(url),'https://opencode.ai/zen/go/v1/responses','External request refused');const body=JSON.parse(init.body),ack=body.max_output_tokens===256;let action;
  assert.ok(!init.body.includes('PRIVATE_BIO_FIXTURE'));
  if(ack)ackCalls++;else{
   providerCalls++;const project=await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(user).first();assert.ok(project);
   if(providerCalls===1)action={kind:'specification',operation:'create',projectId:project.id,config:{name:'River Garden',headline:'A greener neighborhood',description:'Friendly local garden care.',theme:'forest',aboutTitle:'Our garden studio',aboutText:'Landscaping for our neighbors.',sections:[],photos:[]}};
   else if(providerCalls===2)action={kind:'specification',operation:'change',projectId:project.id,expectedRevision:1,operations:[{type:'content.replace',contentId:'headline',text:'Thoughtful gardens, happy neighbors'}]};
   else if(providerCalls===3||providerCalls===4){const version=await db.prepare('SELECT id FROM site_versions WHERE project_id=? ORDER BY created_at DESC,id DESC LIMIT 1').bind(project.id).first();action={kind:'review',operation:'publish',targetId:version.id};}
   else assert.fail('Unexpected model request');
  }
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(ack?{intent:'editing'}:{reply:'Local scripted interpretation',action})}]}],usage:{input_tokens:100,output_tokens:100}});
 };
 const json=(res,status,data)=>res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'}).end(JSON.stringify(data));
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8175'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(url.pathname==='/_fixture'){
   res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'}).end('<h1>Disposable owner journey</h1><p>Actual local handlers; synthetic account and inference; no external calls.</p>'+['start','lose-profile','lose-welcome','lose-completion','finish'].map(action=>`<form method="post" action="/_fixture/${action}"><button>${{'start':'Enter synthetic invited session','lose-profile':'Lose next profile save response','lose-welcome':'Lose next welcome save response','lose-completion':'Lose completion response','finish':'Finish journey checks'}[action]}</button></form>`).join(''));return;
  }
  if(url.pathname.startsWith('/_fixture/')&&req.method==='POST'){
   const action=url.pathname.split('/').at(-1);
   if(action==='start'){res.writeHead(303,{'set-cookie':'tellumo_session='+token+'; HttpOnly; SameSite=Lax; Path=/','location':'/workspace'}).end();return;}
   if(['lose-profile','lose-welcome','lose-completion'].includes(action))lose=action.slice(5);
   else if(action==='finish'){res.writeHead(200,{'content-type':'text/plain'}).end('Checking disposable evidence.');finish();return;}
   else{res.writeHead(404).end();return;}
   res.writeHead(303,{location:'/_fixture'}).end();return;
  }
  if(url.pathname.startsWith('/api/')){
   const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>1048576){res.writeHead(413).end();return;}chunks.push(chunk);}const body=Buffer.concat(chunks);
   if(['/api/chat','/api/workspace/dashboard'].includes(url.pathname)&&!(await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(user).first()))earlyWorkspaceReads++;
   if(req.headers.origin&&req.headers.origin!==origin){res.writeHead(403).end();return;}
   // Exercise test-mode inference only through an intercepted synthetic transport.
   const headers=new Headers(req.headers);if(headers.has('origin'))headers.set('origin','https://whumpo.com');
   const response=await platform.fetch(new Request('https://whumpo.com'+url.pathname+url.search,{method:req.method,headers,...(['GET','HEAD'].includes(req.method)?{}:{body})}),env,ctx);
   const kind=url.pathname==='/api/profile'&&req.method==='PATCH'?'profile':url.pathname==='/api/onboarding'&&req.method==='PUT'?'welcome':url.pathname==='/api/onboarding/complete'?'completion':'';
   const lost=lose&&kind===lose&&response.status===200;
   requests.push({path:url.pathname,method:req.method,status:response.status,lost:!!lost,...(url.pathname==='/api/chat/actions'?{action:JSON.parse(body).action}:{})});
   if(lost){lose='';return json(res,503,{error:'The connection dropped after saving. Your details may already be saved.'});}
   for(const value of response.headers.getSetCookie())res.appendHeader('set-cookie',value);res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([key])=>key!=='set-cookie')));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?'index.html':decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',webp:'image/webp',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch(e){if(e.code==='ENOENT'){res.writeHead(404).end();return;}console.error('Fixture request failed:',e.message);if(!res.headersSent)json(res,500,{error:'Local fixture failed'});else res.end();}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8175,'127.0.0.1',done);});
 input=createInterface({input:process.stdin});input.on('line',line=>{if(line.trim()==='finish')finish();});
 console.log('Owner journey ready at '+origin+' and /_fixture. Sign in through the synthetic-session fixture control, complete welcome, draft/edit/review/preview with natural Chat and keyboard. Approve the private website edit before requesting publication review. No real credentials or inference. Let the first review expire naturally before reloading it and requesting a fresh review.');
 await finished;await Promise.all(background);
 const count=async table=>Number((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n);
 assert.equal(earlyWorkspaceReads,0);assert.equal(await count('projects'),1);assert.equal(await count('site_versions'),2);assert.equal(providerCalls,4);
 assert.equal((await db.prepare('SELECT version_id FROM publications LIMIT 1').first())?.version_id,null,'Journey stops at review; nothing published');
 assert.ok(requests.some(r=>r.lost&&r.path==='/api/profile'));assert.ok(requests.some(r=>r.lost&&r.path==='/api/onboarding'));assert.ok(requests.some(r=>r.lost&&r.path==='/api/onboarding/complete'));
 assert.ok(requests.some(r=>r.path.startsWith('/api/publication-reviews/')&&r.status===409));assert.ok(requests.some(r=>r.path.startsWith('/api/publication-reviews/')&&r.status===200));
 assert.equal(requests.filter(r=>r.path==='/api/chat/actions').length,1);assert.equal(requests.find(r=>r.path==='/api/chat/actions').action.type,'specificationApply');
 await mkdir('.secrets',{recursive:true});await writeFile('.secrets/owner-journey-browser.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'Actual local platform handlers and disposable D1; scripted inference, synthetic signed-in account; no real authentication ceremony/customer publication',earlyWorkspaceReads,projects:1,versions:2,providerCalls,ackCalls,requests},null,2),{mode:0o600});
 console.log('Owner journey passed: welcome recovery, one private project, two private versions, four scripted calls, fresh/expired reviews, no publication or early workspace reads.');
}finally{input?.close();if(server?.listening)await new Promise(done=>server.close(done));await Promise.allSettled(background);globalThis.fetch=originalFetch;await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
