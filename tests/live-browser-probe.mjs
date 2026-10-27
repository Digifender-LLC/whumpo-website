import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
let mode='ok';const seen=[];
const page=(body,head='')=>`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="manifest" href="/manifest.webmanifest">${head}</head><body>${body}</body></html>`;
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://x');seen.push(req.method+' '+url.pathname);
 const send=(type,body,status=200)=>res.writeHead(status,{'content-type':type}).end(body);
 if(req.method==='POST'){req.resume();return send('application/json','{}');}
 if(url.pathname==='/api/health')return send('application/json','{"status":"ok"}');
 if(url.pathname==='/manifest.webmanifest')return send('application/manifest+json','{"name":"Stub"}');
 if(url.pathname==='/turnstile-stub')return send('text/html',page('<p>stub</p>'));
 if(url.pathname==='/'||url.pathname==='/workspace/'){
  const extra=mode==='external'?'<script src="http://203.0.113.9/x.js"></script>':mode==='state'?'<script>fetch("/api/auth/identity/v1/state",{method:"POST",body:"{}"}).catch(()=>{})</script>':mode==='console'?'<script>console.error("boom")</script>':'';
  return send('text/html',page('<h1>Stub</h1><iframe title="Widget containing a Cloudflare security challenge" src="/turnstile-stub"></iframe><script>const post=(p,b)=>fetch(p,{method:"POST",headers:{"content-type":"application/json"},body:b}).catch(()=>{});post("/api/auth/identity/v1/config",JSON.stringify({version:1}));</script>'+extra));
 }
 send('text/plain','nf',404);
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const probe=(...args)=>run(process.execPath,['tools/live-browser-probe.mjs',...args]).then(r=>({code:0,...r}),e=>({code:e.code,stdout:e.stdout,stderr:e.stderr}));
try{
 let r=await probe();assert.equal(r.code,1);
 r=await probe('--live','http://example.com');assert.equal(r.code,1);
 r=await probe('--live',origin);assert.equal(r.code,0,r.stdout+r.stderr);
 const ok=JSON.parse(r.stdout);assert.equal(ok.attention,false);assert.deepEqual(ok.blocked,[]);
 for(const n of ['heading_visible@390','heading_visible@1280','no_horizontal_scroll@390','no_horizontal_scroll@1280','turnstile_iframe','console_errors','csp_violations','health','manifest'])assert.ok(ok.checks.some(c=>c.check===n&&c.state==='ok'),n);
 assert.ok(seen.includes('POST /api/auth/identity/v1/config'),'config POST reaches the origin');
 assert.ok(seen.every(s=>s.startsWith('GET ')||s==='POST /api/auth/identity/v1/config'),'only GETs and the config POST reach the origin');
 mode='state';r=await probe('--live',origin);assert.equal(r.code,2);
 assert.ok(JSON.parse(r.stdout).blocked.some(b=>b.reason==='api_write'&&b.url.endsWith('/api/auth/identity/v1/state')));
 assert.ok(!seen.includes('POST /api/auth/identity/v1/state'),'state POST is aborted');
 mode='external';r=await probe('--live',origin);assert.equal(r.code,2);
 const ext=JSON.parse(r.stdout);assert.ok(ext.blocked.some(b=>b.reason==='foreign_host'));assert.ok(ext.checks.some(c=>c.check==='no_blocked_requests'&&c.state==='failed'));
 mode='console';r=await probe('--live',origin);assert.equal(r.code,2);
 assert.ok(JSON.parse(r.stdout).checks.some(c=>c.check==='console_errors'&&c.state==='failed'));
 console.log('live-browser-probe tests passed');
}finally{server.close();}
