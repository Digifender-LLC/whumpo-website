// Local UI acceptance only: real Worker handlers, in-memory SQLite, synthetic session.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {resolve,sep} from 'node:path';
import {comparisonFixture} from '../tests/fixtures/comparison-state.mjs';
const f=await comparisonFixture(),before=f.state(),root=resolve('dist'),origin='http://localhost:8176',requests=[],originalFetch=globalThis.fetch;let server,input,done;
const finished=new Promise(resolve=>{done=resolve;});
try{
 globalThis.fetch=async()=>{throw Error('External network is disabled in this fixture');};
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8176'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(url.pathname==='/_fixture'&&req.method==='GET'){
   res.writeHead(200,{'content-type':'text/html','cache-control':'no-store'}).end('<h1>Private comparison checks</h1><p>Actual local handlers, synthetic account. No inference or publication.</p><form method="post" action="/_fixture/start"><button>Use the synthetic account</button></form><form method="post" action="/_fixture/logout"><button>End synthetic session</button></form><ul>'+Object.entries({fresh:'Open current review',expired:'Open expired review',missing:'Open unavailable comparison'}).map(([key,label])=>'<li><a href="'+f.paths[key]+'">'+label+'</a></li>').join('')+'</ul>');return;
  }
  if(req.method==='POST'&&['/_fixture/start','/_fixture/logout'].includes(url.pathname)){
   res.writeHead(303,{'set-cookie':'whumpo_session='+(url.pathname.endsWith('/start')?f.token:'')+'; HttpOnly; SameSite=Lax; Path=/'+(url.pathname.endsWith('/logout')?'; Max-Age=0':''),location:'/_fixture'}).end();return;
  }
  if(req.method!=='GET'){res.writeHead(405).end();return;}
  if(url.pathname.startsWith('/api/')){
   const response=await f.worker.fetch(new Request('https://whumpo.com'+url.pathname+url.search,{headers:req.headers}),f.env,f.ctx);
   requests.push({path:url.pathname,status:response.status,contentType:response.headers.get('content-type')});res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?'index.html':decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch(error){res.writeHead(error.code==='ENOENT'?404:500).end('Local fixture unavailable');console.error('Fixture request failed:',error.message);}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(8176,'127.0.0.1',resolve);});
 input=createInterface({input:process.stdin});input.on('line',line=>{if(line.trim()==='finish')done();});
 console.log('Comparison recovery ready at '+origin+'/_fixture. Type finish after browser checks.');
 await finished;
 for(const [key,status] of [['fresh',200],['expired',409],['missing',404],['fresh',401]])assert.ok(requests.some(r=>r.path===f.paths[key]&&r.status===status&&r.contentType.startsWith('text/html')),'Missing '+key+' '+status+' browser read');
 assert.ok(requests.some(r=>r.path==='/api/chat'&&r.status===200));assert.equal(f.state(),before);
 await writeFile('.secrets/comparison-recovery-browser.json',JSON.stringify({checkedAt:new Date().toISOString(),scope:'Actual Worker with in-memory SQLite and synthetic session; document navigation and keyboard only; no real authentication, inference, provider, scanner or publication',requests,reviewAndPublicationStateUnchanged:true},null,2),{mode:0o600});
 console.log('Comparison browser evidence passed: current/expired/missing/signed-out HTML statuses, returned Chat, unchanged review/version/publication state.');
}finally{input?.close();if(server?.listening)await new Promise(resolve=>server.close(resolve));globalThis.fetch=originalFetch;f.close();}
