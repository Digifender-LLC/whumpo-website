import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {isChallengePost,decideRequest,turnstileProof,classifyConsole} from '../tools/live-browser-probe.mjs';
const run=promisify(execFile);
// The route handler calls decideRequest for every request; real https targets are out of reach offline, so it is exercised directly.
const H='https://whumpo.com',u=x=>new URL(x);
assert.equal(decideRequest('GET',u('https://brunhild.challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/i/x'),H).allow,true);
assert.deepEqual(decideRequest('GET',u('https://other.cloudflare.com/cdn-cgi/challenge-platform/x'),H),{allow:false,reason:'foreign_host'});
assert.equal(decideRequest('GET',u('https://brunhild.challenges.cloudflare.com/other'),H).allow,false);
assert.equal(decideRequest('GET',u('https://brunhild.challenges.cloudflare.com/cdn-cgi/challenge-platform/x'),'http://127.0.0.1:1').allow,false);
assert.equal(decideRequest('POST',u('https://brunhild.challenges.cloudflare.com/cdn-cgi/challenge-platform/x'),H).allow,false);
assert.deepEqual(decideRequest('POST',u('https://evil.example/collect'),H,'{}'),{allow:false,reason:'non_get'});
assert.deepEqual(decideRequest('POST',u('http://203.0.113.9/api/x'),'http://127.0.0.1:1','{}'),{allow:false,reason:'api_write'});
assert.deepEqual(decideRequest('POST',u(H+'/api/auth/identity/v1/login/options'),H,'{"version":1}'),{allow:false,reason:'api_write'});
assert.equal(decideRequest('POST',u(H+'/api/auth/identity/v1/state'),H,'{"version":1}').allow,true);
const cf=p=>new URL('https://challenges.cloudflare.com'+p);
assert.ok(isChallengePost('POST',cf('/cdn-cgi/challenge-platform/h/b/fo/x'),'https://whumpo.com'));
assert.ok(!isChallengePost('POST',cf('/turnstile/v0/api.js'),'https://whumpo.com'));
assert.ok(!isChallengePost('POST',cf('/cdn-cgi/challenge-platform'),'https://whumpo.com'));
assert.ok(!isChallengePost('POST',new URL('https://evil.example/cdn-cgi/challenge-platform/x'),'https://whumpo.com'));
assert.ok(!isChallengePost('POST',cf('/cdn-cgi/challenge-platform/x'),'http://127.0.0.1:1'));
assert.ok(!isChallengePost('PUT',cf('/cdn-cgi/challenge-platform/x'),'https://whumpo.com'));
assert.deepEqual(turnstileProof({iframe:true,input:false,scriptLoaded:false}),{ok:true,via:'iframe'});
assert.deepEqual(turnstileProof({iframe:false,input:true,scriptLoaded:true}),{ok:true,via:'response_input'});
assert.equal(turnstileProof({iframe:false,input:true,scriptLoaded:false}).ok,false);
assert.equal(turnstileProof({iframe:false,input:false,scriptLoaded:true}).ok,false);
const K={knownUrls:new Set(['https://js.stripe.com/v3/pricing-table.js']),scriptLoaded:true},F='Failed to load resource: net::ERR_FAILED';
assert.ok(classifyConsole({text:F,url:'https://js.stripe.com/v3/pricing-table.js?x=1'},K));
assert.equal(classifyConsole({text:F,url:'https://js.stripe.com/v3/other.js'},K),null);
assert.equal(classifyConsole({text:F,url:''},K),null);
assert.equal(classifyConsole({text:F+' extra',url:'https://js.stripe.com/v3/pricing-table.js'},K),null);
assert.ok(classifyConsole({text:"Connecting to 'data:,' violates the following Content Security Policy directive: \"connect-src 'self'\".",url:''},K));
assert.ok(classifyConsole({text:"Fetch API cannot load data:,. Refused to connect because it violates the document's Content Security Policy.",url:''},K));
assert.equal(classifyConsole({text:"Connecting to 'data:,' violates the following Content Security Policy directive: x",url:''},{...K,scriptLoaded:false}),null);
assert.equal(classifyConsole({text:"Connecting to 'data:text/html,x' violates the following Content Security Policy directive: x",url:''},K),null);
assert.equal(classifyConsole({text:"Fetch API cannot load data:image/png;base64,AA. Refused to connect because it violates the document's Content Security Policy.",url:''},K),null);
// Loopback cannot fake a challenges.cloudflare.com console location, so the turnstile_internal_log rule is tested as a pure function.
const N='%c%d font-size:0;color:transparent NaN',CF='https://challenges.cloudflare.com/turnstile/v0/g/abc/api.js';
assert.equal(classifyConsole({text:N,url:CF},K),'turnstile_internal_log');
assert.equal(classifyConsole({text:N,url:CF},{...K,scriptLoaded:false}),null);
assert.equal(classifyConsole({text:N,url:'http://127.0.0.1:1/app.js'},K),null);
assert.equal(classifyConsole({text:N,url:''},K),null);
// failed or aborted api.js load (scriptLoaded false): its own ERR_FAILED and the Turnstile noise stay real errors
const FL={...K,scriptLoaded:false};
assert.equal(classifyConsole({text:F,url:'https://challenges.cloudflare.com/turnstile/v0/api.js'},FL),null);
assert.equal(classifyConsole({text:"Fetch API cannot load data:,. Refused to connect because it violates the document's Content Security Policy.",url:CF},FL),null);
assert.equal(turnstileProof({iframe:false,input:true,scriptLoaded:false}).ok,false);
assert.equal(classifyConsole({text:N,url:'https://challenges.cloudflare.com.evil.example/x.js'},K),null);
assert.equal(classifyConsole({text:N,url:'https://other.challenges.cloudflare.com/x.js'},K),null);
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
  const extra=mode==='external'?'<script src="http://203.0.113.9/x.js"></script>':mode==='state'?'<script>fetch("/api/auth/identity/v1/login/options",{method:"POST",headers:{"content-type":"application/json"},body:"{\\"version\\":1}"}).catch(()=>{})</script>':mode==='badstate'?'<script>fetch("/api/auth/identity/v1/state",{method:"POST",body:"{\\"version\\":2}"}).catch(()=>{})</script>':mode==='stripe'?'<script>fetch("https://js.stripe.com/v3/pricing-table.js").catch(()=>{})</script>':mode==='stripescript'?'<script src="https://js.stripe.com/v3/pricing-table.js"></script>':mode==='stripemixed'?'<script src="https://js.stripe.com/v3/pricing-table.js"></script><script src="http://203.0.113.9/x.js"></script>':mode==='notfound'?'<script src="/missing.js"></script>':mode==='datacsp'?'<script>console.error("Fetch API cannot load data:,. Refused to connect because it violates the document\'s Content Security Policy.")</script>':mode==='datacspts'?'<script>fetch("https://challenges.cloudflare.com/turnstile/v0/api.js").catch(()=>{})</script><script>console.error("Fetch API cannot load data:,. Refused to connect because it violates the document\'s Content Security Policy.")</script>':mode==='console'?'<script>console.error("boom")</script>':'';
  return send('text/html',page('<h1>Stub</h1>'+(mode==='decoy'?'<input type="hidden" name="cf-turnstile-response">':'<iframe title="Widget containing a Cloudflare security challenge" src="/turnstile-stub"></iframe>')+'<script>const post=(p,b)=>fetch(p,{method:"POST",headers:{"content-type":"application/json"},body:b}).catch(()=>{});post("/api/auth/identity/v1/config",JSON.stringify({version:1}));post("/api/auth/identity/v1/state",JSON.stringify({version:1}));</script>'+extra));
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
 assert.ok(seen.includes('POST /api/auth/identity/v1/state'),'state POST reaches the origin');
 assert.ok(seen.every(s=>s.startsWith('GET ')||s==='POST /api/auth/identity/v1/config'||s==='POST /api/auth/identity/v1/state'),'only GETs and the two read POSTs reach the origin');
 mode='state';r=await probe('--live',origin);assert.equal(r.code,2);
 assert.ok(JSON.parse(r.stdout).blocked.some(b=>b.reason==='api_write'&&b.url.endsWith('/api/auth/identity/v1/login/options')));
 assert.ok(!seen.includes('POST /api/auth/identity/v1/login/options'),'other identity POSTs are aborted');
 mode='badstate';r=await probe('--live',origin);assert.equal(r.code,2);
 assert.ok(JSON.parse(r.stdout).blocked.some(b=>b.reason==='api_write'&&b.url.endsWith('/v1/state')),'state POST with a different body is aborted');
 mode='stripe';r=await probe('--live',origin);const st=JSON.parse(r.stdout);
 assert.deepEqual(st.blocked,[]);assert.ok(st.knownBlocked.some(b=>b.url==='https://js.stripe.com/v3/pricing-table.js'));assert.ok(st.checks.some(c=>c.check==='no_blocked_requests'&&c.state==='ok'));
 mode='external';r=await probe('--live',origin);assert.equal(r.code,2);
 const ext=JSON.parse(r.stdout);assert.ok(ext.blocked.some(b=>b.reason==='foreign_host'));assert.ok(ext.checks.some(c=>c.check==='no_blocked_requests'&&c.state==='failed'));
 mode='console';r=await probe('--live',origin);assert.equal(r.code,2);
 assert.ok(JSON.parse(r.stdout).checks.some(c=>c.check==='console_errors'&&c.state==='failed'));
  const consoleCheck=j=>j.checks.filter(c=>c.check==='console_errors');
 mode='stripescript';r=await probe('--live',origin);let j=JSON.parse(r.stdout);
 assert.ok(consoleCheck(j).every(c=>c.state==='ok'),'aborted known block ERR_FAILED is not a console error');
 assert.ok(j.knownConsole.some(k=>k.reason==='probe_aborted_known_block'&&k.text===F),'knownConsole lists it');
 mode='stripemixed';r=await probe('--live',origin);j=JSON.parse(r.stdout);
 assert.ok(consoleCheck(j).some(c=>c.state==='failed'&&c.count>=1),'unrelated aborted ERR_FAILED still fails');
 mode='notfound';r=await probe('--live',origin);j=JSON.parse(r.stdout);
 assert.ok(consoleCheck(j).some(c=>c.state==='failed'),'same-origin 404 still fails');assert.deepEqual(j.knownConsole,[]);
 mode='datacsp';r=await probe('--live',origin);j=JSON.parse(r.stdout);
 assert.ok(consoleCheck(j).some(c=>c.state==='failed'),'data:, refusal without Turnstile script still fails');assert.deepEqual(j.knownConsole,[]);
 // Loopback cannot serve a 2xx api.js from challenges.cloudflare.com, so the success path is covered by the pure-function tests and the live run.
 // Here api.js is requested but aborted: not loaded, so the data:, refusal is NOT exempt and the check fails.
 mode='datacspts';r=await probe('--live',origin);j=JSON.parse(r.stdout);
 assert.ok(consoleCheck(j).some(c=>c.state==='failed'&&c.sample.some(t=>t.startsWith('Fetch API cannot load data:,'))),'requested-but-failed api.js does not exempt data:, refusal');assert.deepEqual(j.knownConsole,[]);
 mode='decoy';r=await probe('--live',origin);
 assert.ok(JSON.parse(r.stdout).checks.some(c=>c.check==='turnstile_iframe'&&c.state==='failed'&&c.failure==='iframe_missing'),'decoy input without script fails');
 console.log('live-browser-probe tests passed');
}finally{server.close();}
