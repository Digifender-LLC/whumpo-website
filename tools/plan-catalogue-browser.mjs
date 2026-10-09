// Opt-in loopback acceptance using synthetic credentials and disposable actual D1.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createInterface} from 'node:readline';
import {resolve,sep} from 'node:path';
import {build} from 'esbuild';
import {databaseFixture} from '../tests/helpers/current-database.mjs';
import {workspaceFixture} from '../tests/helpers/workspace-identity.mjs';
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-plan-catalogue-browser-'),origin='http://localhost:8787',root=resolve('dist');let fixture,server,input;
let finish;const finished=new Promise(resolve=>{finish=resolve});
try{
 const b=await build({stdin:{contents:"export {default as platform} from './src/index';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 const {platform}=m;
 fixture=await databaseFixture({d1:true,r2:true});const db=fixture.db,authority=await workspaceFixture(db,m),user=authority.account,token=authority.token,now=new Date().toISOString(),requests=[];
 const env={...fixture.env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 const call=(path,method,body)=>platform.fetch(new Request(origin+path,{method,headers:{origin,cookie:'__Host-whumpo_session='+token,'content-type':'application/json'},body:JSON.stringify(body)}),env,{waitUntil(){throw Error('No inference expected')}});
 assert.equal((await call('/api/profile','PATCH',{revision:0,name:'Plan tester',avatar_id:'sun'})).status,200);
 assert.equal((await call('/api/onboarding','PUT',{revision:0,stage:'review',prompt:'review',project_name:'Synthetic Bakery',idea:'A fictional bakery project',audience:'Neighbors',preferred_theme:'forest'})).status,200);
 assert.equal((await call('/api/onboarding/complete','POST',{revision:1})).status,200);
 assert.equal((await call('/api/workspace/capacity','PUT',{revision:0,preferred_plan:'personal',billing_interval:'year',draft_overage_cents:0})).status,200);

 server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8787'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(url.pathname==='/_acceptance/start'){res.writeHead(302,{'set-cookie':'__Host-whumpo_session='+token+'; Secure; HttpOnly; SameSite=Lax; Path=/','location':'/workspace/settings'}).end();return;}
  if(url.pathname==='/_acceptance/finish'){res.writeHead(200,{'content-type':'text/plain'}).end('Checking disposable plan preferences.');finish();return;}
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
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done)});input=createInterface({input:process.stdin});
 console.log('Plan catalogue browser ready: '+origin+' and /_acceptance/start. Inspect pricing and Settings, save Business Pro then Creator, reload, and finish at /_acceptance/finish. Synthetic account, no provider configuration.');
 input.on('line',line=>{if(line.trim()==='finish')finish()});await finished;
 const saved=await db.prepare('SELECT preferred_plan,billing_interval FROM capacity_preferences WHERE user_id=?').bind(user).first();
 assert.equal(saved.preferred_plan,'personal');assert.equal(saved.billing_interval,'year');
 assert.ok(requests.filter(r=>r.path==='/api/workspace/capacity'&&r.method==='PUT'&&r.status===200).length>=2);
 assert.ok(requests.every(r=>r.method==='GET'||r.path==='/api/workspace/capacity'&&r.method==='PUT'||r.method==='POST'&&['/api/auth/identity/v1/state','/api/auth/identity/v1/config'].includes(r.path)));
 for(const table of ['inference_calls','publications','stripe_paid_invoices'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 await writeFile('.secrets/plan-catalogue-browser.json',JSON.stringify({checkedAt:new Date().toISOString(),requests,preferences:saved,noInferencePublicationOrBilling:true},null,2),{mode:0o600});
 console.log('Plan catalogue browser passed: persisted personal preference after two saves, no inference, publication, grant or Stripe invoice.');

}catch(error){console.error(error.message);process.exitCode=1;}finally{input?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await fixture?.close();await rm(dir,{recursive:true,force:true});}
