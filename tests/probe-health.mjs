// WH-007 G11 slice: the synthetic health probe against a local loopback stub only. Any other fetch target fails the test.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {probeHealth,probeTarget} from '../tools/probe-health.mjs';
let mode='ok';const seen=[];
const server=createServer((req,res)=>{
 seen.push({method:req.method,url:req.url,cookie:req.headers.cookie,authorization:req.headers.authorization});
 if(mode==='ok'){res.writeHead(200,{'content-type':'application/json'});res.end('{"status":"ok"}');}
 else if(mode==='down'){res.writeHead(503,{'content-type':'text/plain'});res.end('unavailable');}
 else if(mode==='wrong'){res.writeHead(200,{'content-type':'application/json'});res.end('{"status":"degraded"}');}
 else if(mode==='redirect'){res.writeHead(302,{location:'https://example.invalid/'});res.end();}
 else if(mode==='large'){res.writeHead(200,{'content-type':'application/json'});res.end('{"status":"ok","pad":"'+'x'.repeat(8192)+'"}');}
 else if(mode==='slow'){setTimeout(()=>{res.writeHead(200);res.end('{"status":"ok"}');},1500);}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const original=globalThis.fetch;
globalThis.fetch=(input,init)=>{if(!String(input).startsWith(origin+'/'))throw Error('Probe test must not use the network: '+input);return original(input,init);};
try{
 for(const bad of ['http://example.com','https://user:pass@example.com','https://example.com/path','https://example.com/?q=1','https://example.com/#x','ftp://example.com','not a url','javascript:alert(1)'])assert.throws(()=>probeTarget(bad),/Invalid probe target/,bad);
 assert.equal(probeTarget('https://whumpo.example/'),'https://whumpo.example');
 await assert.rejects(probeHealth(origin,{timeoutMs:5}),/Invalid probe timeout/);
 let report=await probeHealth(origin);assert.equal(report.attention,false);assert.deepEqual(report.checks.map(c=>[c.check,c.state,c.status]),[['platform','ok',200]]);
 assert.deepEqual(seen.at(-1),{method:'GET',url:'/api/health',cookie:undefined,authorization:undefined});
 const expect=async(m,failure,status)=>{mode=m;const r=await probeHealth(origin,{timeoutMs:500});assert.equal(r.attention,true,m);assert.equal(r.checks[0].failure,failure,m);assert.equal(r.checks[0].status,status,m);};
 await expect('down','unexpected_status',503);
 await expect('wrong','unexpected_body',200);
 await expect('redirect','unexpected_status',302);
 await expect('large','unexpected_body',200);
 await expect('slow','timeout',null);
 assert.ok(seen.every(r=>r.method==='GET'&&r.url==='/api/health'),'Read-only GET of the health path only');
 await new Promise(resolve=>server.close(resolve));
 report=await probeHealth(origin,{timeoutMs:500});assert.equal(report.checks[0].failure,'unreachable');
 console.log('Health probe passed against a loopback stub: bare-origin targets only, read-only GET without credentials, no redirect following, bounded body, timeout and unreachable handling. No external network.');
}finally{globalThis.fetch=original;server.closeAllConnections?.();server.close();}
